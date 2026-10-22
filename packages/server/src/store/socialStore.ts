import type { DatabaseSync, StatementSync } from "node:sqlite";
import type { PeopleStore } from "./peopleStore.js";

/**
 * How people feel about one another (N37): the `relationships` table (one row per pair who have interacted, each row one person's view of
 * another: trust, affection, respect and fear, -100..100, fear 0..100) and the `grievances` table (one row per wrong: who was wronged, by
 * whom, the event behind it, how heavy, since when, and whether it is settled).
 *
 * Rows are written straight to the file, inside the caller's transaction when there is one. `since` on a relationship is the day it was
 * last changed (its decay counts from there: game/chatter/rel.ts).
 */
export interface RelRow {
  a: string;
  b: string;
  trust: number;
  affection: number;
  respect: number;
  fear: number;
  since: number;
}

export interface GrievanceRow {
  id: number;
  who: string;
  against: string;
  /** What caused it: an event ref (`e:<id>`) or a death ref (`d:<id>`). */
  cause_ref: string;
  /** 0..1 when it was made; it fades by the day (game/chatter/grievance.ts). */
  weight: number;
  since: number;
  /** The day it was settled, or null while open. */
  settled: number | null;
}

export class SocialStore {
  private readonly statements = new Map<string, StatementSync>();
  /** Everyone who has a row of their own view (kept up to date), so the daily gossip skips the lookup for people who have none. */
  private holding: Set<string> | null = null;
  /** Everyone with an open grievance (kept up to date), so the daily rules skip the lookup for the many who have none. */
  private aggrieved: Set<string> | null = null;

  constructor(private readonly db: DatabaseSync, private readonly people: PeopleStore) {}

  private sql(text: string): StatementSync {
    let st = this.statements.get(text);
    if (!st) this.statements.set(text, (st = this.db.prepare(text)));
    return st;
  }

  /** Forget what is held in memory (after a reset or an import). */
  dropCache(): void {
    this.holding = null;
    this.aggrieved = null;
  }

  transaction<T>(fn: () => T): T {
    return this.people.transaction(fn);
  }

  // ---- Relationships ----

  /** Everyone whose view of someone is recorded. */
  holders(): ReadonlySet<string> {
    if (!this.holding) this.holding = new Set((this.sql("SELECT DISTINCT a FROM relationships").all() as Array<{ a: string }>).map((r) => r.a));
    return this.holding;
  }

  /** `a`'s view of `b`, as last written (not decayed). */
  rel(a: string, b: string): RelRow | null {
    if (this.holding && !this.holding.has(a)) return null;
    return (this.sql("SELECT a, b, trust, affection, respect, fear, since FROM relationships WHERE a = ? AND b = ?").get(a, b) as RelRow | undefined) ?? null;
  }

  putRel(r: RelRow): void {
    this.sql("INSERT OR REPLACE INTO relationships (a, b, trust, affection, respect, fear, since) VALUES (?, ?, ?, ?, ?, ?, ?)").run(r.a, r.b, r.trust, r.affection, r.respect, r.fear, r.since);
    this.holding?.add(r.a);
  }

  removeRel(a: string, b: string): void {
    this.sql("DELETE FROM relationships WHERE a = ? AND b = ?").run(a, b);
  }

  /** What `a` thinks of everyone they have a view of, by who. */
  relsOf(a: string): RelRow[] {
    return this.sql("SELECT a, b, trust, affection, respect, fear, since FROM relationships WHERE a = ? ORDER BY b").all(a) as unknown as RelRow[];
  }

  /** What others think of `b`, by who. */
  relsAbout(b: string): RelRow[] {
    return this.sql("SELECT a, b, trust, affection, respect, fear, since FROM relationships WHERE b = ? ORDER BY a").all(b) as unknown as RelRow[];
  }

  relCount(a: string): number {
    return Number((this.sql("SELECT COUNT(*) AS n FROM relationships WHERE a = ?").get(a) as { n: number }).n);
  }

  /** The row of `a`'s views that matters least (the weakest feelings, then the oldest), to make room for a new one. */
  weakestOf(a: string): RelRow | null {
    return (this.sql("SELECT a, b, trust, affection, respect, fear, since FROM relationships WHERE a = ? ORDER BY (abs(trust) + abs(affection) + abs(respect) + abs(fear)), since, b LIMIT 1").get(a) as RelRow | undefined) ?? null;
  }

  /** Rows last changed before a day, oldest first, for the pruning pass. */
  staleRels(before: number, limit: number): RelRow[] {
    return this.sql("SELECT a, b, trust, affection, respect, fear, since FROM relationships WHERE since < ? ORDER BY since, a, b LIMIT ?").all(before, limit) as unknown as RelRow[];
  }

  /** Rows of the living people of a place last changed before a day, oldest first (the place's own pruning). */
  staleRelsAt(site: string, before: number, limit: number): RelRow[] {
    return this.sql("SELECT r.a, r.b, r.trust, r.affection, r.respect, r.fear, r.since FROM relationships r JOIN people p ON p.id = r.a WHERE r.since < ? AND p.site = ? ORDER BY r.since, r.a, r.b LIMIT ?").all(before, site, limit) as unknown as RelRow[];
  }

  relTotal(): number {
    return Number((this.sql("SELECT COUNT(*) AS n FROM relationships").get() as { n: number }).n);
  }

  mostRels(): number {
    const r = this.sql("SELECT MAX(n) AS m FROM (SELECT COUNT(*) AS n FROM relationships GROUP BY a)").get() as { m: number | null };
    return r.m ?? 0;
  }

  // ---- Grievances ----

  /** Does `who` hold any grievance open? */
  hasOpen(who: string): boolean {
    if (!this.aggrieved) this.aggrieved = new Set((this.sql("SELECT DISTINCT who FROM grievances WHERE settled IS NULL").all() as Array<{ who: string }>).map((r) => r.who));
    return this.aggrieved.has(who);
  }

  /** Add a grievance. Its id comes from who, whom and what (so the same world gets the same ids however its places were worked out); a clash takes the next free id. */
  addGrievance(g: Omit<GrievanceRow, "id" | "settled"> & { id: number }): GrievanceRow {
    let id = g.id;
    while (this.sql("SELECT 1 AS x FROM grievances WHERE id = ?").get(id) !== undefined) id++;
    const row: GrievanceRow = { ...g, id, settled: null };
    this.sql("INSERT INTO grievances (id, who, against, cause_ref, weight, since, settled) VALUES (?, ?, ?, ?, ?, ?, NULL)").run(row.id, row.who, row.against, row.cause_ref, row.weight, row.since);
    this.aggrieved?.add(row.who);
    return row;
  }

  grievance(id: number): GrievanceRow | null {
    return (this.sql("SELECT id, who, against, cause_ref, weight, since, settled FROM grievances WHERE id = ?").get(id) as GrievanceRow | undefined) ?? null;
  }

  /** Everything `who` holds against anyone, open or settled, oldest first. */
  grievancesOf(who: string): GrievanceRow[] {
    return this.sql("SELECT id, who, against, cause_ref, weight, since, settled FROM grievances WHERE who = ? ORDER BY since, id").all(who) as unknown as GrievanceRow[];
  }

  /** What `who` holds open against `against`. */
  openBetween(who: string, against: string): GrievanceRow[] {
    return this.sql("SELECT id, who, against, cause_ref, weight, since, settled FROM grievances WHERE who = ? AND against = ? AND settled IS NULL ORDER BY since, id").all(who, against) as unknown as GrievanceRow[];
  }

  /** Every open grievance `who` holds. */
  openOf(who: string): GrievanceRow[] {
    return this.sql("SELECT id, who, against, cause_ref, weight, since, settled FROM grievances WHERE who = ? AND settled IS NULL ORDER BY since, id").all(who) as unknown as GrievanceRow[];
  }

  /** Every open grievance held against `against` (by anyone). */
  openAgainst(against: string): GrievanceRow[] {
    return this.sql("SELECT id, who, against, cause_ref, weight, since, settled FROM grievances WHERE against = ? AND settled IS NULL ORDER BY since, id").all(against) as unknown as GrievanceRow[];
  }

  /** The open grievances of the living people of a place, in id order (the place's day reads them all at once). */
  openAt(site: string): GrievanceRow[] {
    return this.sql(
      "SELECT g.id, g.who, g.against, g.cause_ref, g.weight, g.since, g.settled FROM grievances g JOIN people p ON p.id = g.who WHERE g.settled IS NULL AND p.site = ? AND p.death IS NULL ORDER BY g.id",
    ).all(site) as unknown as GrievanceRow[];
  }

  setWeight(id: number, weight: number, since: number): void {
    this.sql("UPDATE grievances SET weight = ?, since = ? WHERE id = ?").run(weight, since, id);
  }

  settle(id: number, day: number): void {
    const g = this.grievance(id);
    if (!g || g.settled !== null) return;
    this.sql("UPDATE grievances SET settled = ? WHERE id = ? AND settled IS NULL").run(day, id);
    if (this.aggrieved && this.openOf(g.who).length === 0) this.aggrieved.delete(g.who);
  }

  /** Counts for the bounds and the admin view. */
  grievanceCounts(): { open: number; settled: number } {
    const r = this.sql("SELECT SUM(CASE WHEN settled IS NULL THEN 1 ELSE 0 END) AS o, SUM(CASE WHEN settled IS NULL THEN 0 ELSE 1 END) AS s FROM grievances").get() as { o: number | null; s: number | null };
    return { open: Number(r.o ?? 0), settled: Number(r.s ?? 0) };
  }

  /** Every grievance made before a day, for the bounds. */
  grievancesBefore(day: number, limit = 5000): GrievanceRow[] {
    return this.sql("SELECT id, who, against, cause_ref, weight, since, settled FROM grievances WHERE since < ? ORDER BY id LIMIT ?").all(day, limit) as unknown as GrievanceRow[];
  }
}
