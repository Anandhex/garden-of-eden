import type { DatabaseSync, StatementSync } from "node:sqlite";

/**
 * Marks on a place's map (N31): what happened there that can be seen. One row a mark, read per place and kept in memory
 * after the first read, written straight through. A mark that has ended keeps its row (`ends`), so the admin can see
 * what was; graves never end (they fade: `data.faded`).
 */
export interface MarkRow {
  id: string;
  site: string;
  /** burned, ruin, scaffold, grave. */
  kind: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** The building it sits on (an index into the place's map), if any. */
  building: number | null;
  /** Why: the realm ref of what did it ("raid:34:ashby"), or a person's id for a grave. */
  ref: string | null;
  /** The words on hover: a grave's name and death. */
  label: string | null;
  since: number;
  /** The day it ended (repaired, built), or null while it lasts. */
  ends: number | null;
  data: string | null;
}

export class MarkStore {
  private readonly statements = new Map<string, StatementSync>();
  private bySite = new Map<string, Map<string, MarkRow>>();

  constructor(private readonly db: DatabaseSync) {}

  private sql(text: string): StatementSync {
    let st = this.statements.get(text);
    if (!st) this.statements.set(text, (st = this.db.prepare(text)));
    return st;
  }

  dropCache(): void {
    this.bySite.clear();
  }

  /** Every mark of a place, ended ones too. */
  of(site: string): Map<string, MarkRow> {
    let m = this.bySite.get(site);
    if (!m) {
      m = new Map((this.sql("SELECT * FROM marks WHERE site = ? ORDER BY since, id").all(site) as unknown as MarkRow[]).map((r) => [r.id, { ...r }]));
      this.bySite.set(site, m);
    }
    return m;
  }

  /** The marks standing on a day. */
  active(site: string, day: number): MarkRow[] {
    return [...this.of(site).values()].filter((r) => r.since <= day && (r.ends === null || r.ends > day));
  }

  get(site: string, id: string): MarkRow | undefined {
    return this.of(site).get(id);
  }

  /** Add a mark (a mark with that id already there is left alone). True if it is new. */
  add(row: MarkRow): boolean {
    const m = this.of(row.site);
    if (m.has(row.id)) return false;
    m.set(row.id, { ...row });
    this.sql("INSERT OR IGNORE INTO marks (id, site, kind, x, y, w, h, building, ref, label, since, ends, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(row.id, row.site, row.kind, row.x, row.y, row.w, row.h, row.building, row.ref, row.label, row.since, row.ends, row.data);
    return true;
  }

  /** End a mark on a day (repaired, finished). */
  end(site: string, id: string, day: number): void {
    const r = this.of(site).get(id);
    if (!r || r.ends !== null) return;
    r.ends = day;
    this.sql("UPDATE marks SET ends = ? WHERE id = ?").run(day, id);
  }

  /** Change a mark's words and data (a grave fading). */
  update(site: string, id: string, patch: Partial<Pick<MarkRow, "label" | "data" | "ends">>): void {
    const r = this.of(site).get(id);
    if (!r) return;
    Object.assign(r, patch);
    this.sql("UPDATE marks SET label = ?, data = ?, ends = ? WHERE id = ?").run(r.label, r.data, r.ends, id);
  }
}
