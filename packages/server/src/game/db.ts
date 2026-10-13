import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import type { Embedder } from "../llm/provider.js";
import type { DirectorLogEntry } from "../director/validator.js";
import type { GameEvent } from "./events.js";
import { cosine, hashedEmbedder } from "./embeddings.js";
import { PeopleStore } from "../store/peopleStore.js";
import { applySchema, ORDER_BY, type TableName } from "../store/schema.js";

/**
 * The long-term store (SQLite, built into Node: node:sqlite). The world save
 * (saves/world.json) is the source of truth for the cast and the realm; this holds
 * what grows without bound (N18: every person, in `people`, saved by place in
 * batches: store/peopleStore.ts) and what is only ever searched:
 * - **events**: every event ever recorded (the save keeps the 300 most important);
 * - **memories**: conversation summaries and other recall-only notes, each with an
 *   embedding, so an NPC can recall an old talk by meaning, not just by keyword;
 * - **director_log**: every proposal the world director made, accepted or not.
 *
 * Embeddings come from a local model when it's pulled (config.embedModel), else a
 * hashed bag of words (game/embeddings.ts). Vectors from different embedders aren't
 * compared: each row records which made it.
 */

// node:sqlite still prints an "experimental" warning on load in Node 22; it's expected here.
function loadSqlite(): { DatabaseSync: typeof DatabaseSyncType } {
  const emit = process.emitWarning;
  process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
    const text = typeof warning === "string" ? warning : warning.message;
    if (/SQLite is an experimental feature/.test(text)) return;
    return (emit as (...a: unknown[]) => void).call(process, warning, ...rest);
  }) as typeof process.emitWarning;
  try {
    return createRequire(import.meta.url)("node:sqlite") as { DatabaseSync: typeof DatabaseSyncType };
  } finally {
    process.emitWarning = emit;
  }
}

export interface MemoryRow {
  id: number;
  npc: string;
  day: number;
  kind: string;
  text: string;
  importance: number;
  score?: number;
}

/**
 * Below this similarity a memory isn't really about the same thing. Embedding models
 * score related sentences higher than a bag of words does, so each has its own bar.
 */
export const RECALL_SIMILARITY = { hashed: 0.2, model: 0.55 } as const;
const recallBar = (embedder: string) => (embedder === "hashed" ? RECALL_SIMILARITY.hashed : RECALL_SIMILARITY.model);

export class WorldStore {
  private readonly db: DatabaseSyncType;
  embedder: Embedder;
  /** Every person of every place (N18). */
  readonly people: PeopleStore;

  constructor(file = ":memory:", embedder: Embedder = hashedEmbedder) {
    if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true });
    const { DatabaseSync } = loadSqlite();
    this.db = new DatabaseSync(file);
    this.embedder = embedder;
    applySchema(this.db, file !== ":memory:");
    this.people = new PeopleStore(this.db);
  }

  close(): void {
    this.db.close();
  }

  /** A new world: forget the old one's history and people. */
  reset(): void {
    this.people.clear();
    this.db.exec("DELETE FROM events; DELETE FROM memories; DELETE FROM director_log; DELETE FROM relationships; DELETE FROM knowledge; DELETE FROM grievances; DELETE FROM ambitions; DELETE FROM jobs_held; DELETE FROM meta;");
  }

  // ---- The save's commit point (N18) ----

  /** Write the pending people and `meta.save_tick = tick` in one transaction. The save file follows (game/save.ts). */
  commit(tick: number): void {
    this.people.flush(tick);
  }

  /** The tick the last commit stored, or null. */
  savedTick(): number | null {
    const row = this.db.prepare("SELECT value FROM meta WHERE key = 'save_tick'").get() as { value: string } | undefined;
    return row ? Number(row.value) : null;
  }

  /** Every row of a table in primary key order: the world hash, export and tests read this. */
  dumpTable(table: TableName): Array<Record<string, unknown>> {
    const rows = this.db.prepare(`SELECT * FROM ${table} ORDER BY ${ORDER_BY[table]}`).all() as Array<Record<string, unknown>>;
    if (table !== "people" || this.people.pending === 0) return rows;
    // People changed since the last flush are part of the world as it is.
    const now = new Map(rows.map((r) => [String(r.id), r]));
    for (const r of this.people.pendingRows()) now.set(r.id, { ...r });
    return [...now.values()].sort((a, b) => (String(a.id) < String(b.id) ? -1 : 1));
  }

  /** Replace a table's rows (import). Runs in the caller's transaction. */
  replaceTable(table: TableName, columns: readonly string[], rows: Array<Record<string, unknown>>): void {
    this.people.transaction(() => {
      this.db.exec(`DELETE FROM ${table}`);
      const st = this.db.prepare(`INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`);
      for (const r of rows) st.run(...(columns.map((c) => r[c] ?? null) as Array<string | number | null>));
    });
    if (table === "people") this.people.dropCache();
  }

  /** Set a `meta` value. */
  setMeta(key: string, value: string): void {
    this.db.prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
  }

  meta(key: string): string | null {
    const row = this.db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  // ---- Events ----

  /** Keep an event for good (insert, or update who knows it). */
  archiveEvent(e: GameEvent): void {
    this.db
      .prepare(
        `INSERT INTO events (id, day, hour, kind, actor, target, details, importance, place, witnesses, known_by, why, caused_by, site, kingdom, seq)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET known_by = excluded.known_by`,
      )
      .run(e.id, e.day, e.hour, e.kind, e.actor, e.target, e.details, e.importance, e.place ?? null, JSON.stringify(e.witnesses ?? []), JSON.stringify(e.knownBy ?? []), e.why ?? null, e.causedBy ? JSON.stringify(e.causedBy) : null, e.site ?? null, e.kingdom ?? null, seqOf(e.id));
  }

  /** Events newest first, optionally only those after a cursor, or involving someone or somewhere (the admin view: reads only). */
  recentEvents(opts: { limit?: number; person?: string; place?: string; minImportance?: number } = {}): GameEvent[] {
    const where: string[] = [];
    const args: Array<string | number> = [];
    if (opts.person) {
      where.push("(actor = ? OR target = ?)");
      args.push(opts.person, opts.person);
    }
    if (opts.place) {
      where.push("place = ?");
      args.push(opts.place);
    }
    if (opts.minImportance !== undefined) {
      where.push("importance >= ?");
      args.push(opts.minImportance);
    }
    const rows = this.db.prepare(`SELECT * FROM events ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY day DESC, hour DESC, seq DESC, rowid DESC LIMIT ?`).all(...args, opts.limit ?? 500) as Array<Record<string, unknown>>;
    return rows.map(rowToEvent);
  }

  /** Every event involving someone (as actor or target), oldest first. */
  eventsAbout(who: string, limit = 100): GameEvent[] {
    const rows = this.db.prepare(`SELECT * FROM events WHERE actor = ? OR target = ? ORDER BY day, hour, seq, rowid LIMIT ?`).all(who, who, limit) as Array<Record<string, unknown>>;
    return rows.map(rowToEvent);
  }

  eventCount(): number {
    return Number((this.db.prepare("SELECT COUNT(*) AS n FROM events").get() as { n: number }).n);
  }

  // ---- Memories (recall by meaning) ----

  async addMemory(npc: string, day: number, kind: string, text: string, importance: number): Promise<void> {
    const [vector] = await this.embedder.embed([text]);
    this.db.prepare(`INSERT INTO memories (npc, day, kind, text, importance, embedder, vector) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(npc, day, kind, text, importance, this.embedder.name, JSON.stringify(vector));
  }

  /** An NPC's memories closest in meaning to `query`, best first, above the embedder's bar. */
  async recall(npc: string, query: string, k = 2): Promise<MemoryRow[]> {
    const rows = this.db.prepare(`SELECT id, npc, day, kind, text, importance, vector FROM memories WHERE npc = ? AND embedder = ?`).all(npc, this.embedder.name) as unknown as Array<MemoryRow & { vector: string }>;
    if (rows.length === 0) return [];
    const [q] = await this.embedder.embed([query]);
    return rows
      .map(({ vector, ...r }) => ({ ...r, score: cosine(q!, JSON.parse(vector) as number[]) }))
      .filter((r) => r.score >= recallBar(this.embedder.name))
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
  }

  memoryCount(npc?: string): number {
    const row = npc ? this.db.prepare("SELECT COUNT(*) AS n FROM memories WHERE npc = ?").get(npc) : this.db.prepare("SELECT COUNT(*) AS n FROM memories").get();
    return Number((row as { n: number }).n);
  }

  // ---- The director ----

  logDirector(e: DirectorLogEntry): void {
    this.db.prepare(`INSERT INTO director_log (day, kind, ok, reason, proposal, event) VALUES (?, ?, ?, ?, ?, ?)`).run(e.day, e.kind, e.ok ? 1 : 0, e.reason, e.proposal, e.event ?? null);
  }

  /** Every decision the director's proposals got, oldest first. */
  directorEntries(): DirectorLogEntry[] {
    const rows = this.db.prepare("SELECT day, kind, ok, reason, proposal, event FROM director_log ORDER BY id").all() as Array<Record<string, unknown>>;
    return rows.map((r) => ({ day: Number(r.day), kind: r.kind as DirectorLogEntry["kind"], ok: Number(r.ok) === 1, reason: String(r.reason), proposal: String(r.proposal), ...(r.event ? { event: String(r.event) } : {}) }));
  }

  directorStats(): { accepted: number; rejected: number } {
    const row = this.db.prepare("SELECT SUM(ok) AS a, COUNT(*) AS n FROM director_log").get() as { a: number | null; n: number };
    return { accepted: Number(row.a ?? 0), rejected: Number(row.n) - Number(row.a ?? 0) };
  }
}

/** The sequence number in an event id (`e<day>-<hour>-<seq>`), for ordering events within an hour. */
function seqOf(id: string): number | null {
  const m = /-(\d+)$/.exec(id);
  return m ? Number(m[1]) : null;
}

function rowToEvent(r: Record<string, unknown>): GameEvent {
  return {
    id: String(r.id),
    day: Number(r.day),
    hour: Number(r.hour),
    kind: r.kind as GameEvent["kind"],
    actor: String(r.actor),
    target: String(r.target),
    details: String(r.details),
    importance: Number(r.importance),
    ...(r.place ? { place: String(r.place) } : {}),
    ...(r.why ? { why: String(r.why) } : {}),
    ...(r.caused_by ? { causedBy: JSON.parse(String(r.caused_by)) as string[] } : {}),
    ...(r.site ? { site: String(r.site) } : {}),
    ...(r.kingdom ? { kingdom: String(r.kingdom) } : {}),
    witnesses: JSON.parse(String(r.witnesses ?? "[]")) as string[],
    knownBy: JSON.parse(String(r.known_by ?? "[]")) as string[],
  };
}
