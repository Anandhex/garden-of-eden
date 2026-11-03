import type { DatabaseSync, StatementSync } from "node:sqlite";

/**
 * The records of Stages 4–6 (N45–N64): disputes over estates, feuds between families, secrets and who holds them, cases and trials,
 * spies' reports, thieves' dens, outbreaks, expeditions. One table, one row a record, typed by `kind`: few rows next to the people table
 * (a few per place), so all are read once and kept in memory and written straight through, like the notable items (N43).
 *
 * `a` and `b` are the two sides a record is between (people, families, kingdoms), `site` where it is, `data` its own JSON, `since` the
 * day it began, `status` where it stands ("open", "settled", "won"...), `ended` the day it closed.
 */
export interface RecordRow {
  id: string;
  kind: string;
  site: string | null;
  a: string | null;
  b: string | null;
  data: string;
  since: number;
  status: string;
  ended: number | null;
}

/** A record with its data parsed. */
export interface Rec<T = Record<string, unknown>> extends Omit<RecordRow, "data"> {
  data: T;
}

const COLS = ["id", "kind", "site", "a", "b", "data", "since", "status", "ended"] as const;

export class RecordStore {
  private readonly statements = new Map<string, StatementSync>();
  private rows: Map<string, RecordRow> | null = null;
  private byKind: Map<string, Set<string>> | null = null;

  constructor(private readonly db: DatabaseSync) {}

  private sql(text: string): StatementSync {
    let st = this.statements.get(text);
    if (!st) this.statements.set(text, (st = this.db.prepare(text)));
    return st;
  }

  dropCache(): void {
    this.rows = null;
    this.byKind = null;
  }

  private all(): Map<string, RecordRow> {
    if (!this.rows) {
      this.rows = new Map((this.sql("SELECT * FROM records ORDER BY id").all() as unknown as RecordRow[]).map((r) => [r.id, { ...r }]));
      this.byKind = new Map();
      for (const r of this.rows.values()) this.index(r);
    }
    return this.rows;
  }

  private index(r: RecordRow): void {
    let s = this.byKind!.get(r.kind);
    if (!s) this.byKind!.set(r.kind, (s = new Set()));
    s.add(r.id);
  }

  get<T = Record<string, unknown>>(id: string): Rec<T> | undefined {
    const r = this.all().get(id);
    return r ? parse<T>(r) : undefined;
  }

  has(id: string): boolean {
    return this.all().has(id);
  }

  /** Every record of a kind, in id order, optionally filtered. */
  list<T = Record<string, unknown>>(kind: string, filter?: (r: Rec<T>) => boolean): Array<Rec<T>> {
    const rows = this.all();
    const ids = [...(this.byKind!.get(kind) ?? [])].sort();
    const out: Array<Rec<T>> = [];
    for (const id of ids) {
      const r = parse<T>(rows.get(id)!);
      if (!filter || filter(r)) out.push(r);
    }
    return out;
  }

  /** Records of a kind still open (no `ended`). */
  open<T = Record<string, unknown>>(kind: string, filter?: (r: Rec<T>) => boolean): Array<Rec<T>> {
    return this.list<T>(kind, (r) => r.ended === null && (!filter || filter(r)));
  }

  count(kind: string): number {
    this.all();
    return this.byKind!.get(kind)?.size ?? 0;
  }

  put<T>(r: Rec<T>): void {
    const row: RecordRow = { ...r, data: JSON.stringify(r.data ?? {}) };
    this.all().set(row.id, row);
    this.index(row);
    this.sql(`INSERT OR REPLACE INTO records (${COLS.join(", ")}) VALUES (${COLS.map(() => "?").join(", ")})`).run(...(COLS.map((c) => row[c] ?? null) as Array<string | number | null>));
  }

  /** Change a record (merging `data`). */
  patch<T>(id: string, p: Partial<Omit<Rec<T>, "id" | "data">> & { data?: Partial<T> }): Rec<T> | undefined {
    const cur = this.get<T>(id);
    if (!cur) return undefined;
    const next: Rec<T> = { ...cur, ...p, data: { ...cur.data, ...(p.data ?? {}) } as T };
    this.put(next);
    return next;
  }

  /** Close a record. */
  end(id: string, day: number, status: string, data?: Record<string, unknown>): void {
    this.patch(id, { ended: day, status, ...(data ? { data } : {}) });
  }

  remove(id: string): void {
    const r = this.all().get(id);
    if (!r) return;
    this.rows!.delete(id);
    this.byKind!.get(r.kind)?.delete(id);
    this.sql("DELETE FROM records WHERE id = ?").run(id);
  }
}

function parse<T>(r: RecordRow): Rec<T> {
  return { ...r, data: (r.data ? JSON.parse(r.data) : {}) as T };
}
