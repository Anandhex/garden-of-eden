import type { DatabaseSync, StatementSync } from "node:sqlite";

/**
 * Household goods (N32 decision 4): what a building's household keeps, by the piece of furniture it's in. Nothing is
 * stored for a building nobody has touched; the first touch rolls its goods (game/interior/goods.ts) and writes them.
 */
export interface GoodsRow {
  site: string;
  building: number;
  slot: string;
  item: string;
  qty: number;
  hidden: number;
  owner: string | null;
  ref: string | null;
}

export class GoodsStore {
  private readonly statements = new Map<string, StatementSync>();
  private cache = new Map<string, GoodsRow[]>();

  constructor(private readonly db: DatabaseSync) {}

  private sql(text: string): StatementSync {
    let st = this.statements.get(text);
    if (!st) this.statements.set(text, (st = this.db.prepare(text)));
    return st;
  }

  dropCache(): void {
    this.cache.clear();
  }

  /** A building's goods (with the "_" row that says it was rolled), or null if never touched. */
  of(site: string, building: number): GoodsRow[] | null {
    const key = `${site}|${building}`;
    let rows = this.cache.get(key);
    if (!rows) {
      rows = (this.sql("SELECT * FROM household_goods WHERE site = ? AND building = ? ORDER BY slot, item").all(site, building) as unknown as GoodsRow[]).map((r) => ({ ...r }));
      this.cache.set(key, rows);
    }
    return rows.length > 0 ? rows : null;
  }

  /** Write a building's first goods (and its rolled mark). */
  put(site: string, building: number, rows: Array<Omit<GoodsRow, "site" | "building">>): void {
    const all = [{ slot: "_", item: "_", qty: 0, hidden: 0, owner: null, ref: null }, ...rows].map((r) => ({ ...r, site, building }));
    const st = this.sql("INSERT OR REPLACE INTO household_goods (site, building, slot, item, qty, hidden, owner, ref) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
    for (const r of all) st.run(r.site, r.building, r.slot, r.item, r.qty, r.hidden, r.owner, r.ref);
    this.cache.set(`${site}|${building}`, all);
  }

  /** Take `n` of an item from a slot; returns how many were there to take. */
  take(site: string, building: number, slot: string, item: string, n: number): number {
    const rows = this.of(site, building) ?? [];
    const r = rows.find((x) => x.slot === slot && x.item === item);
    if (!r) return 0;
    const got = Math.min(n, r.qty);
    r.qty -= got;
    if (r.qty <= 0) {
      rows.splice(rows.indexOf(r), 1);
      this.sql("DELETE FROM household_goods WHERE site = ? AND building = ? AND slot = ? AND item = ?").run(site, building, slot, item);
    } else this.sql("UPDATE household_goods SET qty = ? WHERE site = ? AND building = ? AND slot = ? AND item = ?").run(r.qty, site, building, slot, item);
    return got;
  }

  /** How many buildings have goods rows (for the `goods-bounded` bound). */
  touched(): number {
    return Number((this.sql("SELECT COUNT(*) AS n FROM household_goods WHERE slot = '_'").get() as { n: number }).n);
  }
}
