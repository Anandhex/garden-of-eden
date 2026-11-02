import type { DatabaseSync, StatementSync } from "node:sqlite";

/**
 * Pack beasts (N26F decision 14): every wolf, bear, boar and spider in a realm pack is a row of the `beasts` table, so the
 * wolf that bit you yesterday is the same wolf today, and any of them can rise to a named figure. A realm has a few
 * hundred. Rows are written straight to the file and all held in memory after the first read.
 */
export interface BeastRow {
  id: string;
  pack: string;
  species: string;
  sex: "f" | "m";
  /** The day it was born (age comes from this). */
  born: number;
  /** Its mother's row id, when it was born in the pack. */
  mother: string | null;
  /** JSON `Life` (rank, XP, growth, titles, fights won), as a creature's. */
  life: string;
  /** JSON `{ hp: 0..1, scars: string[], survived: number }`: how hurt it is (healing a little each day), its scars, and the fights with people it lived through. */
  wounds: string;
  /** Fights won. */
  wins: number;
  /** JSON array of who it killed: `{ who, name, day }` (people rows, figures, or "player"). */
  kills: string;
  /** The figure it rose to, once named. */
  figure: string | null;
  /** The day it died, how, and by whom; null while alive. */
  died: number | null;
  died_how: string | null;
  died_by: string | null;
}

export interface Wounds {
  hp: number;
  scars: string[];
  survived: number;
}

export interface Kill {
  who: string;
  name: string;
  day: number;
}

export const BEAST_COLUMNS = ["id", "pack", "species", "sex", "born", "mother", "life", "wounds", "wins", "kills", "figure", "died", "died_how", "died_by"] as const;

export const woundsOf = (b: BeastRow): Wounds => ({ hp: 1, scars: [], survived: 0, ...(JSON.parse(b.wounds) as Partial<Wounds>) });
export const killsOf = (b: BeastRow): Kill[] => JSON.parse(b.kills) as Kill[];

export class BeastStore {
  private readonly statements = new Map<string, StatementSync>();
  private rows: Map<string, BeastRow> | null = null;

  constructor(private readonly db: DatabaseSync) {}

  private sql(text: string): StatementSync {
    let st = this.statements.get(text);
    if (!st) this.statements.set(text, (st = this.db.prepare(text)));
    return st;
  }

  dropCache(): void {
    this.rows = null;
  }

  private all(): Map<string, BeastRow> {
    if (!this.rows) {
      const rows = this.sql(`SELECT ${BEAST_COLUMNS.join(", ")} FROM beasts ORDER BY id`).all() as unknown as BeastRow[];
      this.rows = new Map(rows.map((r) => [r.id, { ...r }]));
    }
    return this.rows;
  }

  get(id: string): BeastRow | null {
    return this.all().get(id) ?? null;
  }

  /** The living beasts of a pack, oldest first (then by id). */
  living(pack: string): BeastRow[] {
    return [...this.all().values()].filter((b) => b.pack === pack && b.died === null).sort((a, b) => a.born - b.born || (a.id < b.id ? -1 : 1));
  }

  /** Every row of a pack, the dead too. */
  ofPack(pack: string): BeastRow[] {
    return [...this.all().values()].filter((b) => b.pack === pack);
  }

  count(): number {
    return this.all().size;
  }

  livingCount(pack: string): number {
    let n = 0;
    for (const b of this.all().values()) if (b.pack === pack && b.died === null) n++;
    return n;
  }

  add(row: BeastRow): void {
    this.sql(`INSERT INTO beasts (${BEAST_COLUMNS.join(", ")}) VALUES (${BEAST_COLUMNS.map(() => "?").join(", ")})`).run(...BEAST_COLUMNS.map((c) => row[c]));
    this.all().set(row.id, { ...row });
  }

  update(id: string, patch: Partial<Omit<BeastRow, "id">>): BeastRow | null {
    const r = this.all().get(id);
    if (!r) return null;
    Object.assign(r, patch);
    const cols = Object.keys(patch) as Array<keyof BeastRow>;
    if (cols.length > 0) this.sql(`UPDATE beasts SET ${cols.map((c) => `${c} = ?`).join(", ")} WHERE id = ?`).run(...cols.map((c) => r[c]), id);
    return r;
  }

  clear(): void {
    this.db.exec("DELETE FROM beasts");
    this.rows = new Map();
  }
}
