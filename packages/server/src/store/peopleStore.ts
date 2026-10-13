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
  /** JSON death record (game/people/death.ts), or null while alive (N25). */
  death: string | null;
  /** JSON { father, due } while she is expecting a child (N25). */
  expecting: string | null;
  /** The day of her last child's birth. */
  last_birth: number | null;
  /**
   * The last day this person's life step ran, or the day they were born or arrived (N25): the step of a day
   * only touches people whose `stepped_day` is before it, which is what makes catching up resumable.
   */
  stepped_day: number;
  /** Bumped by every flush that writes the row. */
  rev: number;
}

/** Where a place is up to (N25): the next ids and roster positions to hand out, never reused, and the last day its people were stepped. */
export interface SiteSeq {
  site: string;
  next_id: number;
  next_n: number;
  stepped: number;
}

/** What daily rules need of a person, without traits and the rest. */
export type CoarsePerson = Pick<PersonRow, "id" | "site" | "n" | "name" | "gender" | "born_day" | "cls" | "job" | "home" | "work" | "master" | "master_id" | "faction" | "persona" | "rev">;
const COARSE = "id, site, n, name, gender, born_day, cls, job, home, work, master, master_id, faction, persona, rev";

const COLUMNS = TABLES.people;
const INSERT = `INSERT OR REPLACE INTO people (${COLUMNS.join(", ")}) VALUES (${COLUMNS.map(() => "?").join(", ")})`;

/** Columns whose change leaves a place's roster as it was. */
const QUIET = new Set(["persona", "traits", "expecting", "last_birth", "stepped_day", "spouse", "mother", "father", "figure"]);
const values = (r: PersonRow) => COLUMNS.map((c) => r[c]) as Array<string | number | null>;
const escapeLike = (q: string) => q.replace(/[\\%_]/g, (c) => `\\${c}`);

export class PeopleStore {
  /** People changed since the last flush, by id (the patched row). */
  private readonly dirty = new Map<string, PersonRow>();
  /** The ids in `dirty` that are not in the file yet (born or arrived since the last flush). */
  private readonly fresh = new Set<string>();
  /** Which dirty people are in which place now, so reading a place needn't scan every change. */
  private readonly dirtyAt = new Map<string, Set<string>>();
  /**
   * The living people of each place that has been read, in roster order, kept up to date as people change: a
   * day's step reads a place's people, and reading 25,000 rows back out of SQLite every day would cost more
   * than working them out. (About 400 bytes a person; the file is still the truth.)
   */
  private readonly sites = new Map<string, Map<string, PersonRow>>();
  /** Living people of each place, kept up to date as people change (null until first needed). */
  private alive: Map<string, number> | null = null;
  /** Conditions written since the last flush (`site|day` to JSON), and the places' counters. */
  private readonly days = new Map<string, string>();
  private readonly seqs = new Map<string, SiteSeq>();
  private readonly seqDirty = new Set<string>();
  private pruneBefore = 0;
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
    if (this.alive) for (const r of rows) if (r.death === null) this.alive.set(r.site, (this.alive.get(r.site) ?? 0) + 1);
    for (const r of rows) this.sites.get(r.site)?.set(r.id, r);
    for (const site of new Set(rows.map((r) => r.site))) this.touch(site);
  }

  /** Change a person. Nothing is written until `flush`. Returns the patched row, or null for nobody. */
  update(id: string, patch: Partial<Omit<PersonRow, "id" | "rev">>): PersonRow | null {
    const row = this.get(id);
    if (!row) return null;
    const next = { ...row, ...patch };
    this.setDirty(row, next);
    // A place's roster shows who is there, not who has been talked to or their traits.
    if (Object.keys(patch).some((k) => !QUIET.has(k))) {
      this.touch(row.site);
      if (patch.site !== undefined && patch.site !== row.site) this.touch(patch.site);
    }
    return next;
  }

  /** Children a woman has had with a man, living or dead (the file's, and those born since the last flush). */
  childCount(mother: string, father: string | null): number {
    const row = this.sql("SELECT COUNT(*) AS n FROM people WHERE mother = ? AND father IS ?").get(mother, father) as { n: number };
    let n = Number(row.n);
    for (const id of this.fresh) {
      const r = this.dirty.get(id)!;
      if (r.mother === mother && r.father === father) n++;
    }
    return n;
  }

  /** The children of a person (as mother or as father), living or dead, in the order they were born. */
  childrenOf(parent: string): PersonRow[] {
    const rows = this.sql("SELECT * FROM people WHERE mother = ?1 OR father = ?1 ORDER BY born_day, id").all(parent) as unknown as PersonRow[];
    const out = new Map(rows.map((r) => [r.id, this.dirty.get(r.id) ?? r]));
    for (const id of this.fresh) {
      const r = this.dirty.get(id)!;
      if (r.mother === parent || r.father === parent) out.set(id, r);
    }
    return [...out.values()].sort((a, b) => a.born_day - b.born_day || (a.id < b.id ? -1 : 1));
  }

  /** A person who isn't in the file yet (a birth): held with the other changes and written by `flush`. */
  add(row: PersonRow): void {
    this.setDirty(null, row);
    this.fresh.add(row.id);
    this.touch(row.site);
  }

  private setDirty(before: PersonRow | null, next: PersonRow): void {
    this.warm();
    const was = before && before.death === null ? before.site : null;
    const now = next.death === null ? next.site : null;
    if (was !== now) {
      if (was !== null) this.alive!.set(was, (this.alive!.get(was) ?? 1) - 1);
      if (now !== null) this.alive!.set(now, (this.alive!.get(now) ?? 0) + 1);
    }
    if (before && before.site !== next.site) this.dirtyAt.get(before.site)?.delete(next.id);
    // The read copies of the places: a living person stays where they are in the order, a leaver or a dead one drops out, a newcomer goes last.
    if (before) {
      const was = this.sites.get(before.site);
      if (was && (next.death !== null || next.site !== before.site)) was.delete(next.id);
    }
    if (next.death === null) this.sites.get(next.site)?.set(next.id, next);
    this.dirty.set(next.id, next);
    let at = this.dirtyAt.get(next.site);
    if (!at) this.dirtyAt.set(next.site, (at = new Set()));
    at.add(next.id);
  }

  /** Count the living in each place from the file, before the first change (so the counts can then follow the changes). */
  private warm(): void {
    if (this.alive) return;
    const rows = this.sql("SELECT site, COUNT(*) AS n FROM people WHERE death IS NULL GROUP BY site").all() as Array<{ site: string; n: number }>;
    this.alive = new Map(rows.map((r) => [r.site, Number(r.n)]));
  }

  /** How many people are alive in a place now, changes not yet written included. */
  livingCount(site: string): number {
    this.warm();
    return this.alive!.get(site) ?? 0;
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
      const putDay = this.sql("INSERT OR REPLACE INTO site_days (site, day, data) VALUES (?, ?, ?)");
      for (const [key, data] of this.days) {
        const at = key.lastIndexOf("|");
        putDay.run(key.slice(0, at), Number(key.slice(at + 1)), data);
      }
      const putSeq = this.sql("INSERT OR REPLACE INTO site_seq (site, next_id, next_n, stepped) VALUES (?, ?, ?, ?)");
      for (const site of this.seqDirty) {
        const q = this.seqs.get(site)!;
        putSeq.run(q.site, q.next_id, q.next_n, q.stepped);
      }
      if (this.pruneBefore > 0) this.sql("DELETE FROM site_days WHERE day < ?").run(this.pruneBefore);
      this.sql("INSERT INTO meta (key, value) VALUES ('save_tick', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(String(tick));
    });
    this.dirty.clear();
    this.fresh.clear();
    this.dirtyAt.clear();
    this.days.clear();
    this.seqDirty.clear();
    this.pruneBefore = 0;
    return rows.length;
  }

  // ---- Reading ----

  get(id: string): PersonRow | null {
    return this.dirty.get(id) ?? ((this.sql("SELECT * FROM people WHERE id = ?").get(id) as PersonRow | undefined) ?? null);
  }

  /** People in the file (and the newly born or arrived waiting to be written), living or dead. Counts a place as it was last written, plus those added since. */
  count(site?: string): number {
    const row = site === undefined ? this.sql("SELECT COUNT(*) AS n FROM people").get() : this.sql("SELECT COUNT(*) AS n FROM people WHERE site = ?").get(site);
    let n = Number((row as { n: number }).n);
    for (const id of this.fresh) if (site === undefined || this.dirty.get(id)?.site === site) n++;
    return n;
  }

  /** The living people of a place, in order. `coarse` leaves out traits, relations and death records. */
  loadSite(site: string, detail: "full" | "coarse" = "full"): PersonRow[] | CoarsePerson[] {
    const held = this.sites.get(site);
    if (held) return [...held.values()];
    if (detail === "full") return this.readSite(site);
    return this.readSite(site, "coarse");
  }

  /** Read a place's living people from the file (and the changes waiting), and keep them for next time (a full read). */
  private readSite(site: string, detail: "full" | "coarse" = "full"): PersonRow[] {
    const rows = this.sql(`SELECT ${detail === "full" ? "*" : COARSE} FROM people WHERE site = ? AND death IS NULL ORDER BY n, id`).all(site) as unknown as PersonRow[];
    const at = this.dirtyAt.get(site);
    if (this.dirty.size === 0) return this.keep(site, rows, detail);
    // What's waiting to be flushed is newer than the file: someone may have died or left, and others were born or arrived.
    const out: PersonRow[] = [];
    const seen = new Set<string>();
    for (const r of rows) {
      seen.add(r.id);
      const now = this.dirty.get(r.id) ?? r;
      if (now.site === site && now.death === null) out.push(now);
    }
    if (at) for (const id of at) if (!seen.has(id)) {
      const now = this.dirty.get(id)!;
      if (now.site === site && now.death === null) out.push(now);
    }
    return this.keep(site, at && at.size > 0 ? out.sort((a, b) => a.n - b.n || (a.id < b.id ? -1 : 1)) : out, detail);
  }

  private keep(site: string, rows: PersonRow[], detail: "full" | "coarse"): PersonRow[] {
    if (detail === "full") this.sites.set(site, new Map(rows.map((r) => [r.id, r])));
    return rows;
  }

  // ---- Conditions and counters (N25) ----

  /** Write a place's conditions for a day. Held until `flush`. */
  putSiteDay(site: string, day: number, data: unknown): void {
    this.days.set(`${site}|${day}`, JSON.stringify(data));
  }

  /** A place's conditions on a day, or null if none were written (or they were pruned). */
  siteDay<T>(site: string, day: number): T | null {
    const held = this.days.get(`${site}|${day}`);
    if (held !== undefined) return JSON.parse(held) as T;
    const row = this.sql("SELECT data FROM site_days WHERE site = ? AND day = ?").get(site, day) as { data: string } | undefined;
    return row ? (JSON.parse(row.data) as T) : null;
  }

  /** Every written day of a place, oldest first (the admin chart). */
  siteDays<T>(site: string, from = 0): Array<{ day: number; data: T }> {
    const rows = this.sql("SELECT day, data FROM site_days WHERE site = ? AND day >= ? ORDER BY day").all(site, from) as Array<{ day: number; data: string }>;
    const out = new Map(rows.map((r) => [r.day, JSON.parse(r.data) as T]));
    for (const [key, data] of this.days) {
      const at = key.lastIndexOf("|");
      if (key.slice(0, at) === site && Number(key.slice(at + 1)) >= from) out.set(Number(key.slice(at + 1)), JSON.parse(data) as T);
    }
    return [...out].sort((a, b) => a[0] - b[0]).map(([day, data]) => ({ day, data }));
  }

  /** Forget conditions from before `day` (at the next flush). */
  pruneSiteDays(day: number): void {
    this.pruneBefore = Math.max(this.pruneBefore, day);
    for (const key of [...this.days.keys()]) if (Number(key.slice(key.lastIndexOf("|") + 1)) < day) this.days.delete(key);
  }

  /** The counters of a place; made from its people the first time. */
  seq(site: string): SiteSeq {
    let q = this.seqs.get(site);
    if (q) return q;
    const row = this.sql("SELECT site, next_id, next_n, stepped FROM site_seq WHERE site = ?").get(site) as SiteSeq | undefined;
    if (row) q = { ...row };
    else {
      // The ids of a place run on from its highest, whoever has since left or died: ids are never reused.
      const prefix = `t_${site}_`;
      const ids = this.sql("SELECT id FROM people WHERE id LIKE ? ESCAPE '\\'").all(`${escapeLike(prefix)}%`) as Array<{ id: string }>;
      let top = -1;
      for (const { id } of ids) top = Math.max(top, Number(id.slice(prefix.length)) || 0);
      for (const id of this.fresh) if (id.startsWith(prefix)) top = Math.max(top, Number(id.slice(prefix.length)) || 0);
      const n = this.sql("SELECT MAX(n) AS n FROM people WHERE site = ?").get(site) as { n: number | null };
      q = { site, next_id: top + 1, next_n: Number(n.n ?? -1) + 1, stepped: 0 };
      for (const id of this.dirtyAt.get(site) ?? []) q.next_n = Math.max(q.next_n, this.dirty.get(id)!.n + 1);
    }
    this.seqs.set(site, q);
    return q;
  }

  /** Change a place's counters (held until `flush`). */
  setSeq(site: string, patch: Partial<Omit<SiteSeq, "site">>): SiteSeq {
    const q = Object.assign(this.seq(site), patch);
    this.seqDirty.add(site);
    return q;
  }

  /** The rows of the counters and conditions not yet written (the world hash and export see the world as it is). */
  pendingSeqs(): SiteSeq[] {
    return [...this.seqDirty].map((s) => ({ ...this.seqs.get(s)! }));
  }
  pendingDays(): Array<{ site: string; day: number; data: string }> {
    return [...this.days].map(([key, data]) => ({ site: key.slice(0, key.lastIndexOf("|")), day: Number(key.slice(key.lastIndexOf("|") + 1)), data }));
  }
  get pruning(): number {
    return this.pruneBefore;
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
    this.fresh.clear();
    this.dirtyAt.clear();
    this.alive = null;
    this.sites.clear();
    this.days.clear();
    this.seqs.clear();
    this.seqDirty.clear();
    this.pruneBefore = 0;
    this.rev.clear();
  }

  /** Forget everyone (a new world). */
  clear(): void {
    this.dropCache();
    this.db.exec("DELETE FROM people");
  }
}
