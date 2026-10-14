import type { DatabaseSync, StatementSync } from "node:sqlite";
import type { PeopleStore } from "./peopleStore.js";

/**
 * What each person knows (N33): a row per item, `ref` saying what (`n:<newsId>`, `d:<personId>`, game/gossip/refs.ts), how accurate their
 * version is (1 is first hand) and which detail was changed in the telling (`variant`, 0 for none), and who told them. The player's own
 * knowledge is not here (it is `player.known`, in the save: game/playerKnowledge.ts).
 *
 * Writes go straight to the file (inside the caller's transaction when there is one): they are small, and the table is read back at once.
 */
export interface KnowledgeRow {
  who: string;
  ref: string;
  learned_day: number;
  /** A person id, `saw` (first hand), or `carrier:<journeyId>`. */
  source: string;
  accuracy: number;
  variant: number;
}

export class KnowledgeStore {
  private readonly statements = new Map<string, StatementSync>();
  /** Everyone who has a row (kept up to date), so a place's day looks at its knowers only. */
  private knowing: Set<string> | null = null;
  /** The rows of people read lately, kept in step with every write (a place's day asks about the same people again and again). Emptied when it grows. */
  private readonly held = new Map<string, KnowledgeRow[]>();

  constructor(private readonly db: DatabaseSync, private readonly people: PeopleStore) {}

  private sql(text: string): StatementSync {
    let st = this.statements.get(text);
    if (!st) this.statements.set(text, (st = this.db.prepare(text)));
    return st;
  }

  /** Forget what is held in memory (after a reset or an import). */
  dropCache(): void {
    this.knowing = null;
    this.held.clear();
  }

  /** Everyone who has any row. */
  knowers(): ReadonlySet<string> {
    if (!this.knowing) this.knowing = new Set((this.sql("SELECT DISTINCT who FROM knowledge").all() as Array<{ who: string }>).map((r) => r.who));
    return this.knowing;
  }

  /** Run `fn` in one transaction (joins the people store's, so a flush never nests inside it). */
  transaction<T>(fn: () => T): T {
    return this.people.transaction(fn);
  }

  /** Everything a person knows, ordered by ref. Not to be changed by the caller. */
  rowsOf(who: string): readonly KnowledgeRow[] {
    let rows = this.held.get(who);
    if (!rows) {
      if (this.held.size > 20000) this.held.clear();
      rows = this.sql("SELECT who, ref, learned_day, source, accuracy, variant FROM knowledge WHERE who = ? ORDER BY ref").all(who) as unknown as KnowledgeRow[];
      this.held.set(who, rows);
    }
    return rows;
  }

  get(who: string, ref: string): KnowledgeRow | null {
    return this.rowsOf(who).find((r) => r.ref === ref) ?? null;
  }

  has(who: string, ref: string): boolean {
    return this.rowsOf(who).some((r) => r.ref === ref);
  }

  countOf(who: string): number {
    return this.rowsOf(who).length;
  }

  /** Add or replace a row. */
  put(row: KnowledgeRow): void {
    this.sql("INSERT OR REPLACE INTO knowledge (who, ref, learned_day, source, accuracy, variant) VALUES (?, ?, ?, ?, ?, ?)").run(row.who, row.ref, row.learned_day, row.source, row.accuracy, row.variant);
    this.knowing?.add(row.who);
    const rows = this.held.get(row.who);
    if (rows) {
      const at = rows.findIndex((r) => r.ref === row.ref);
      const copy = { ...row };
      if (at >= 0) rows[at] = copy;
      else {
        let i = rows.length;
        while (i > 0 && rows[i - 1]!.ref > row.ref) i--;
        rows.splice(i, 0, copy);
      }
    }
  }

  remove(who: string, ref: string): void {
    const rows = this.rowsOf(who) as KnowledgeRow[];
    this.sql("DELETE FROM knowledge WHERE who = ? AND ref = ?").run(who, ref);
    const at = rows.findIndex((r) => r.ref === ref);
    if (at >= 0) rows.splice(at, 1);
    // Exact, so that a world loaded from the file talks the same as the one it was saved from.
    if (rows.length === 0) this.knowing?.delete(who);
  }

  /** Everyone who knows a thing, with their version (the admin view's "who knows it"). */
  holders(ref: string): KnowledgeRow[] {
    return this.sql("SELECT who, ref, learned_day, source, accuracy, variant FROM knowledge WHERE ref = ? ORDER BY learned_day, who").all(ref) as unknown as KnowledgeRow[];
  }

  /** Does anyone living in a place know this? (A join through the people file, as last written.) */
  knownAt(ref: string, site: string): boolean {
    return this.sql("SELECT 1 AS x FROM knowledge k JOIN people p ON p.id = k.who WHERE k.ref = ? AND p.site = ? AND p.death IS NULL LIMIT 1").get(ref, site) !== undefined;
  }

  /** Rows whose teller was a person (not first hand, not a traveller's carrying), for the bounds: the teller must have known it first. */
  toldByPeople(limit: number): KnowledgeRow[] {
    return this.sql("SELECT who, ref, learned_day, source, accuracy, variant FROM knowledge WHERE source LIKE 't\\_%' ESCAPE '\\' ORDER BY who, ref LIMIT ?").all(limit) as unknown as KnowledgeRow[];
  }

  /** How many rows there are, for the bounds. */
  total(): number {
    return Number((this.sql("SELECT COUNT(*) AS n FROM knowledge").get() as { n: number }).n);
  }

  /** The most rows anyone holds. */
  mostHeld(): number {
    const r = this.sql("SELECT MAX(n) AS m FROM (SELECT COUNT(*) AS n FROM knowledge GROUP BY who)").get() as { m: number | null };
    return r.m ?? 0;
  }

  /** The things known and how many people know each, most known first. */
  popular(limit = 20): Array<{ ref: string; n: number }> {
    return this.sql("SELECT ref, COUNT(*) AS n FROM knowledge GROUP BY ref ORDER BY n DESC, ref LIMIT ?").all(limit) as unknown as Array<{ ref: string; n: number }>;
  }
}
