import type { DatabaseSync, StatementSync } from "node:sqlite";
import { TABLES } from "./schema.js";

/**
 * Every person of every place (N18), in SQLite, saved by place in batches. The seeded roster
 * (game/realm/townsfolk.ts `rosterFor`) is only the generator: it rolls a place's people once,
 * when the world is made, and from then on this table is the truth.
 *
 * Writes never touch the file one at a time. `update` patches a person in a small cache and
 * marks them dirty; `flush` writes every dirty row in one transaction together with the tick
 * (`meta.save_tick`), and the save file is renamed into place after it (game/save.ts).
 */

/** A row of `people`. Field names are the column names. */
export interface PersonRow {
  id: string;
  /** Where they live now (a settlement id). */
  site: string;
  /** Order in the place: a growing town adds to the end. */
  n: number;
  name: string;
  gender: string;
  species: string;
  /** Age comes from this and the day, never a stored age. */
  born_day: number;
  cls: string;
  job: string;
  /** Index into the place's map buildings, as it was when they were made. */
  home: number | null;
  work: string | null;
  master: string | null;
  master_id: string | null;
  faction: string | null;
  mother: string | null;
  father: string | null;
  spouse: string | null;
  /** Set when they rose to a realm figure (N25). */
  figure: string | null;
  /** Set when they became a talking NPC: the persona id. */
  persona: string | null;
  /** JSON, small (N25 inheritance). */
  traits: string | null;
  /** JSON death record, or null while alive (N25). */
  death: string | null;
  /** Bumped by every flush that writes the row. */
  rev: number;
}

/** What daily rules need of a person, without traits and the rest. */
export type CoarsePerson = Pick<PersonRow, "id" | "site" | "n" | "name" | "gender" | "born_day" | "cls" | "job" | "home" | "work" | "master" | "master_id" | "faction" | "persona" | "rev">;
const COARSE = "id, site, n, name, gender, born_day, cls, job, home, work, master, master_id, faction, persona, rev";

const COLUMNS = TABLES.people;
const INSERT = `INSERT OR REPLACE INTO people (${COLUMNS.join(", ")}) VALUES (${COLUMNS.map(() => "?").join(", ")})`;

/** Columns whose change leaves a place's roster as it was. */
const QUIET = new Set(["persona", "traits"]);
const values = (r: PersonRow) => COLUMNS.map((c) => r[c]) as Array<string | number | null>;
const escapeLike = (q: string) => q.replace(/[\\%_]/g, (c) => `\\${c}`);

export class PeopleStore {
  /** People changed since the last flush, by id (the patched row). */
  private readonly dirty = new Map<string, PersonRow>();
  /** Bumped when a place's people change: the roster built from them is rebuilt when this moves. */
  private readonly rev = new Map<string, number>();
  private readonly statements = new Map<string, StatementSync>();
  private depth = 0;
  /** Transactions committed (tests: "in one transaction"). */
  commits = 0;

  constructor(private readonly db: DatabaseSync) {}

  private sql(text: string): StatementSync {
    let st = this.statements.get(text);
    if (!st) this.statements.set(text, (st = this.db.prepare(text)));
    return st;
  }

  /** Run `fn` in a transaction: committed if it returns, rolled back if it throws. Nested calls join the outer one. */
  transaction<T>(fn: () => T): T {
    if (this.depth > 0) return fn();
    this.db.exec("BEGIN");
    this.depth++;
    try {
      const out = fn();
      this.db.exec("COMMIT");
      this.commits++;
      return out;
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    } finally {
      this.depth--;
    }
  }

  private touch(site: string): void {
    this.rev.set(site, (this.rev.get(site) ?? 0) + 1);
  }

  /** A number that changes whenever someone in this place is added or changed. */
  revOf(site: string): number {
    return this.rev.get(site) ?? 0;
  }

  // ---- Writing ----

  /** Add many people at once, in one transaction (a new world's first roll, or a place that grew). */
  insertMany(rows: PersonRow[]): void {
    this.transaction(() => {
      const st = this.sql(INSERT);
      for (const r of rows) st.run(...values(r));
    });
    for (const site of new Set(rows.map((r) => r.site))) this.touch(site);
  }

  /** Change a person. Nothing is written until `flush`. Returns the patched row, or null for nobody. */
  update(id: string, patch: Partial<Omit<PersonRow, "id" | "rev">>): PersonRow | null {
    const row = this.get(id);
    if (!row) return null;
    const next = { ...row, ...patch };
    this.dirty.set(id, next);
    // A place's roster shows who is there, not who has been talked to or their traits.
    if (Object.keys(patch).some((k) => !QUIET.has(k))) {
      this.touch(row.site);
      if (patch.site !== undefined && patch.site !== row.site) this.touch(patch.site);
    }
    return next;
  }

  /** The changed rows not yet written (the world hash and export see the world as it is, not as last saved). */
  pendingRows(): PersonRow[] {
    return [...this.dirty.values()];
  }

  /** People waiting to be written. */
  get pending(): number {
    return this.dirty.size;
  }

  /**
   * Write every changed person in one transaction (rev + 1 each), and `meta.save_tick` with them.
   * Returns how many rows were written. Always one transaction, even when nobody changed: the tick moves.
   */
  flush(tick: number): number {
    const rows = [...this.dirty.values()];
    this.transaction(() => {
      const st = this.sql(INSERT);
      for (const r of rows) st.run(...values({ ...r, rev: r.rev + 1 }));
      this.sql("INSERT INTO meta (key, value) VALUES ('save_tick', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(String(tick));
    });
    this.dirty.clear();
    return rows.length;
  }

  // ---- Reading ----

  get(id: string): PersonRow | null {
    return this.dirty.get(id) ?? ((this.sql("SELECT * FROM people WHERE id = ?").get(id) as PersonRow | undefined) ?? null);
  }

  count(site?: string): number {
    const row = site === undefined ? this.sql("SELECT COUNT(*) AS n FROM people").get() : this.sql("SELECT COUNT(*) AS n FROM people WHERE site = ?").get(site);
    return Number((row as { n: number }).n);
  }

  /** The living people of a place, in order. `coarse` leaves out traits, relations and death records. */
  loadSite(site: string, detail: "full" | "coarse" = "full"): PersonRow[] | CoarsePerson[] {
    const rows = this.sql(`SELECT ${detail === "full" ? "*" : COARSE} FROM people WHERE site = ? AND death IS NULL ORDER BY n`).all(site) as unknown as PersonRow[];
    // What's waiting to be flushed is newer than the file.
    return rows.map((r) => this.dirty.get(r.id) ?? r);
  }

  /**
   * People whose name, class, job or faction id contains `q` (those whose name it starts first), or who live in one of
   * `sites` or belong to one of `factions` (the admin search matches place and faction names, which live in the realm).
   */
  search(q: string, opts: { site?: string; sites?: string[]; factions?: string[]; limit?: number } = {}): PersonRow[] {
    const args: Array<string | number> = [`%${escapeLike(q)}%`, `${escapeLike(q)}%`, opts.limit ?? 50];
    const any = ["name LIKE ?1 ESCAPE '\\'", "cls LIKE ?1 ESCAPE '\\'", "job LIKE ?1 ESCAPE '\\'", "faction LIKE ?1 ESCAPE '\\'"];
    const list = (column: string, items: string[] | undefined) => {
      if (!items || items.length === 0) return;
      any.push(`${column} IN (${items.map((it) => `?${args.push(it)}`).join(", ")})`);
    };
    list("site", opts.sites);
    list("faction", opts.factions);
    const where = opts.site ? `(${any.join(" OR ")}) AND site = ?${args.push(opts.site)}` : any.join(" OR ");
    const rows = this.sql(`SELECT * FROM people WHERE ${where} AND death IS NULL ORDER BY (name LIKE ?2 ESCAPE '\\') DESC, name, id LIMIT ?3`).all(...args) as unknown as PersonRow[];
    return rows.map((r) => this.dirty.get(r.id) ?? r);
  }

  /** Drop what's held in memory (after the table was replaced under it). */
  dropCache(): void {
    this.dirty.clear();
    this.rev.clear();
  }

  /** Forget everyone (a new world). */
  clear(): void {
    this.dirty.clear();
    this.rev.clear();
    this.db.exec("DELETE FROM people");
  }
}
