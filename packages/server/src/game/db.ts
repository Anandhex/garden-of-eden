import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import type { ModelCall } from "../llm/budgeted.js";
import type { Embedder } from "../llm/provider.js";
import type { DirectorLogEntry } from "../director/validator.js";
import type { GameEvent } from "./events.js";
import { cosine, hashedEmbedder } from "./embeddings.js";
import { timed } from "../metrics/timing.js";
import { KnowledgeStore } from "../store/knowledgeStore.js";
import { SocialStore } from "../store/socialStore.js";
import { CareerStore } from "../store/careerStore.js";
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
  /** What each person knows (N33). */
  readonly knowledge: KnowledgeStore;
  /** How people feel about one another and what they hold against each other (N37). */
  readonly social: SocialStore;
  /** What people want from their lives, and the jobs, ranks and seats they have held (N40). */
  readonly careers: CareerStore;

  constructor(file = ":memory:", embedder: Embedder = hashedEmbedder) {
    if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true });
    const { DatabaseSync } = loadSqlite();
    this.db = new DatabaseSync(file);
    this.embedder = embedder;
    applySchema(this.db, file !== ":memory:");
    this.people = new PeopleStore(this.db);
    this.knowledge = new KnowledgeStore(this.db, this.people);
    this.social = new SocialStore(this.db, this.people);
    this.careers = new CareerStore(this.db, this.people);
  }

  close(): void {
    this.db.close();
  }

  /** A new world: forget the old one's history and people. */
  reset(): void {
    this.people.clear();
    this.knowledge.dropCache();
    this.social.dropCache();
    this.careers.dropCache();
    this.db.exec("DELETE FROM events; DELETE FROM memories; DELETE FROM director_log; DELETE FROM relationships; DELETE FROM knowledge; DELETE FROM grievances; DELETE FROM ambitions; DELETE FROM jobs_held; DELETE FROM site_days; DELETE FROM site_seq; DELETE FROM model_calls; DELETE FROM meta;");
  }

  // ---- The save's commit point (N18) ----

  /** Write the pending people and `meta.save_tick = tick` in one transaction. The save file follows (game/save.ts). */
  commit(tick: number): void {
    timed("flush", () => this.people.flush(tick));
  }

  /** The tick the last commit stored, or null. */
  savedTick(): number | null {
    const row = this.db.prepare("SELECT value FROM meta WHERE key = 'save_tick'").get() as { value: string } | undefined;
    return row ? Number(row.value) : null;
  }

  /** Every row of a table in primary key order: the world hash, export and tests read this. */
  dumpTable(table: TableName): Array<Record<string, unknown>> {
    const rows = this.db.prepare(`SELECT * FROM ${table} ORDER BY ${ORDER_BY[table]}`).all() as Array<Record<string, unknown>>;
    if (table === "people" && this.people.pending > 0) {
      // People changed since the last flush are part of the world as it is.
      const now = new Map(rows.map((r) => [String(r.id), r]));
      for (const r of this.people.pendingRows()) now.set(r.id, { ...r });
      return [...now.values()].sort((a, b) => (String(a.id) < String(b.id) ? -1 : 1));
    }
    if (table === "site_seq") {
      const now = new Map(rows.map((r) => [String(r.site), r]));
      for (const q of this.people.pendingSeqs()) now.set(q.site, { ...q });
      return [...now.values()].sort((a, b) => (String(a.site) < String(b.site) ? -1 : 1));
    }
    if (table === "site_days") {
      const now = new Map(rows.map((r) => [`${r.site}|${r.day}`, r]));
      for (const d of this.people.pendingDays()) now.set(`${d.site}|${d.day}`, { ...d });
      return [...now.values()].filter((r) => Number(r.day) >= this.people.pruning).sort((a, b) => (String(a.site) < String(b.site) ? -1 : String(a.site) > String(b.site) ? 1 : Number(a.day) - Number(b.day)));
    }
    return rows;
  }

  /** Replace a table's rows (import). Runs in the caller's transaction. */
  replaceTable(table: TableName, columns: readonly string[], rows: Array<Record<string, unknown>>): void {
    this.people.transaction(() => {
      this.db.exec(`DELETE FROM ${table}`);
      const st = this.db.prepare(`INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`);
      for (const r of rows) st.run(...(columns.map((c) => r[c] ?? null) as Array<string | number | null>));
    });
    if (table === "people") this.people.dropCache();
    if (table === "knowledge") this.knowledge.dropCache();
    if (table === "relationships" || table === "grievances") this.social.dropCache();
    if (table === "ambitions" || table === "jobs_held") this.careers.dropCache();
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
  private archive: ReturnType<DatabaseSyncType["prepare"]> | null = null;

  archiveEvent(e: GameEvent): void {
    this.archive ??= this.db.prepare(
      `INSERT INTO events (id, day, hour, kind, actor, target, details, importance, place, witnesses, known_by, why, caused_by, site, kingdom, seq)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET known_by = excluded.known_by`,
    );
    this.archive.run(e.id, e.day, e.hour, e.kind, e.actor, e.target, e.details, e.importance, e.place ?? null, JSON.stringify(e.witnesses ?? []), JSON.stringify(e.knownBy ?? []), e.why ?? null, e.causedBy ? JSON.stringify(e.causedBy) : null, e.site ?? null, e.kingdom ?? null, seqOf(e.id));
  }

  /** Events newest first, optionally only those after a cursor, or involving someone or somewhere (the admin view: reads only). */
  recentEvents(opts: { limit?: number; person?: string; place?: string; minImportance?: number; noLives?: boolean } = {}): GameEvent[] {
    const where: string[] = [];
    if (opts.noLives) where.push("id NOT LIKE 'l%'");
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

  /** The kind, actor, details and place of every event of these kinds after a day (balance reports: the numbers of births, deaths and weddings). */
  eventsOfKinds(kinds: readonly string[], afterDay: number): Array<{ kind: string; actor: string; details: string; site: string | null; day: number }> {
    return this.db.prepare(`SELECT kind, actor, details, site, day FROM events WHERE day > ? AND kind IN (${kinds.map(() => "?").join(", ")})`).all(afterDay, ...kinds) as Array<{ kind: string; actor: string; details: string; site: string | null; day: number }>;
  }

  /** The deeds townsfolk chose to do on a day in a place (N38): who did what to whom, in the order they were made. */
  choiceDeeds(site: string, day: number): Array<{ kind: string; actor: string; target: string }> {
    return this.db.prepare(`SELECT kind, actor, target FROM events WHERE site = ? AND day = ? AND id LIKE '%-choice:%' ORDER BY hour, id`).all(site, day) as Array<{ kind: string; actor: string; target: string }>;
  }

  /** The latest `limit` events involving someone (as actor or target), oldest first. */
  eventsAbout(who: string, limit = 100): GameEvent[] {
    const rows = this.db
      .prepare(`SELECT * FROM (SELECT *, rowid AS rid FROM events WHERE actor = ? OR target = ? ORDER BY day DESC, hour DESC, seq DESC, rowid DESC LIMIT ?) ORDER BY day, hour, seq, rid`)
      .all(who, who, limit) as Array<Record<string, unknown>>;
    return rows.map(rowToEvent);
  }

  /** One event from the archive. */
  eventById(id: string): GameEvent | null {
    const row = this.db.prepare("SELECT * FROM events WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return row ? rowToEvent(row) : null;
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

  /**
   * Keep an NPC's memories to `keep`: the least important and oldest of their reflections go first (N25b: each life review adds one),
   * then the oldest of the rest. Recall stays quick however long a talker lives.
   */
  pruneMemories(npc: string, keep = 400): number {
    const n = this.memoryCount(npc);
    if (n <= keep) return 0;
    const drop = this.db.prepare("SELECT id FROM memories WHERE npc = ? ORDER BY (kind = 'reflection') DESC, importance ASC, day ASC LIMIT ?").all(npc, n - keep) as Array<{ id: number }>;
    const del = this.db.prepare("DELETE FROM memories WHERE id = ?");
    for (const { id } of drop) del.run(id);
    return drop.length;
  }

  // ---- Life reviews (N25b) ----

  /** One life review's record: what it was given (by hash), what was proposed, and what was applied, clipped and rejected, with reasons. */
  logReview(r: { who: string; day: number; by: "model" | "code"; shock?: string; inputHash: string; proposal: unknown; applied: unknown; clipped: unknown; rejected: unknown }): void {
    this.db
      .prepare("INSERT INTO life_reviews (who, day, by, shock, input_hash, proposal, applied, clipped, rejected) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(r.who, r.day, r.by, r.shock ?? null, r.inputHash, JSON.stringify(r.proposal), JSON.stringify(r.applied), JSON.stringify(r.clipped), JSON.stringify(r.rejected));
  }

  /** A person's reviews, newest first. */
  reviewsOf(who: string, limit = 20): Array<{ id: number; day: number; by: string; shock: string | null; proposal: unknown; applied: unknown; clipped: unknown; rejected: unknown }> {
    const rows = this.db.prepare("SELECT id, day, by, shock, proposal, applied, clipped, rejected FROM life_reviews WHERE who = ? ORDER BY id DESC LIMIT ?").all(who, limit) as unknown as Array<Record<string, string | number | null>>;
    const parse = (s: string | number | null) => (typeof s === "string" ? JSON.parse(s) : null);
    return rows.map((r) => ({ id: Number(r.id), day: Number(r.day), by: String(r.by), shock: r.shock === null ? null : String(r.shock), proposal: parse(r.proposal as string), applied: parse(r.applied as string), clipped: parse(r.clipped as string), rejected: parse(r.rejected as string) }));
  }

  /** How many reviews have been made (all, or by one kind of reviewer). */
  reviewCount(by?: "model" | "code"): number {
    const row = by ? this.db.prepare("SELECT COUNT(*) AS n FROM life_reviews WHERE by = ?").get(by) : this.db.prepare("SELECT COUNT(*) AS n FROM life_reviews").get();
    return Number((row as { n: number }).n);
  }

  memoryCount(npc?: string): number {
    const row = npc ? this.db.prepare("SELECT COUNT(*) AS n FROM memories WHERE npc = ?").get(npc) : this.db.prepare("SELECT COUNT(*) AS n FROM memories").get();
    return Number((row as { n: number }).n);
  }

  // ---- Model calls (N19) ----

  /** Keep one model call: what it was for, how long it took, and whether it was dropped. */
  logModelCall(c: ModelCall): void {
    this.db.prepare("INSERT INTO model_calls (day, kind, ms, prompt_tokens, reply_tokens, dropped, retry, failed) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(c.day, c.kind, Math.round(c.ms * 10) / 10, c.promptTokens, c.replyTokens, c.dropped ? 1 : 0, c.retry ? 1 : 0, c.failed ? 1 : 0);
  }

  /** Calls by kind for one game day (or every day): completed, dropped, average ms. */
  modelCallStats(day?: number): Array<{ kind: string; calls: number; dropped: number; avgMs: number }> {
    const rows = this.db
      .prepare(`SELECT kind, SUM(CASE WHEN dropped = 0 AND failed = 0 AND retry = 0 THEN 1 ELSE 0 END) AS calls, SUM(dropped) AS dropped, AVG(CASE WHEN dropped = 0 AND failed = 0 THEN ms END) AS avg FROM model_calls ${day === undefined ? "" : "WHERE day = ?"} GROUP BY kind ORDER BY kind`)
      .all(...(day === undefined ? [] : [day])) as Array<Record<string, unknown>>;
    return rows.map((r) => ({ kind: String(r.kind), calls: Number(r.calls ?? 0), dropped: Number(r.dropped ?? 0), avgMs: Math.round(Number(r.avg ?? 0)) }));
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
