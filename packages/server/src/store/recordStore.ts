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
  /**
   * Ids by kind and place. A place's day asks for its own secrets, demands, feuds and soldiers: reading every record of the kind in the
   * realm (and parsing each) for each place grew with the realm's past, to a sixth of a whole-realm day by its third year.
   */
  private byKindSite: Map<string, Set<string>> | null = null;
  /** Go up with every change to a kind (and every drop of what is held), so a caller can keep something it worked out from them. */
  private epoch = 0;
  private versions = new Map<string, number>();
  versionOf(kind: string): string {
    return `${this.epoch}:${this.versions.get(kind) ?? 0}`;
  }
  private bump(kind: string): void {
    this.versions.set(kind, (this.versions.get(kind) ?? 0) + 1);
  }

  constructor(private readonly db: DatabaseSync) {}

  private sql(text: string): StatementSync {
    let st = this.statements.get(text);
    if (!st) this.statements.set(text, (st = this.db.prepare(text)));
    return st;
  }

  dropCache(): void {
    this.rows = null;
    this.byKind = null;
    this.byKindSite = null;
    this.epoch++;
  }

  private all(): Map<string, RecordRow> {
    if (!this.rows) {
      this.rows = new Map((this.sql("SELECT * FROM records ORDER BY id").all() as unknown as RecordRow[]).map((r) => [r.id, { ...r }]));
      this.byKind = new Map();
      this.byKindSite = new Map();
      for (const r of this.rows.values()) this.index(r);
    }
    return this.rows;
  }

  private index(r: RecordRow): void {
    let s = this.byKind!.get(r.kind);
    if (!s) this.byKind!.set(r.kind, (s = new Set()));
    s.add(r.id);
    const k = siteKey(r.kind, r.site);
    let at = this.byKindSite!.get(k);
    if (!at) this.byKindSite!.set(k, (at = new Set()));
    at.add(r.id);
  }

  private unindex(r: RecordRow): void {
    this.byKind!.get(r.kind)?.delete(r.id);
    this.byKindSite!.get(siteKey(r.kind, r.site))?.delete(r.id);
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
    return this.listOf(rows, [...(this.byKind!.get(kind) ?? [])], filter);
  }

  /** Every record of a kind at a place, in id order, optionally filtered (what `list` with `r.site === site` gives, read by the place). */
  listAt<T = Record<string, unknown>>(kind: string, site: string, filter?: (r: Rec<T>) => boolean): Array<Rec<T>> {
    const rows = this.all();
    return this.listOf(rows, [...(this.byKindSite!.get(siteKey(kind, site)) ?? [])], filter);
  }

  /** Records of a kind at a place still open. */
  openAt<T = Record<string, unknown>>(kind: string, site: string, filter?: (r: Rec<T>) => boolean): Array<Rec<T>> {
    return this.listAt<T>(kind, site, (r) => r.ended === null && (!filter || filter(r)));
  }

  private listOf<T>(rows: Map<string, RecordRow>, unsorted: string[], filter?: (r: Rec<T>) => boolean): Array<Rec<T>> {
    const ids = unsorted.sort();
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
    const was = this.all().get(row.id);
    this.bump(row.kind);
    if (was && was.kind !== row.kind) this.bump(was.kind);
    if (was) this.unindex(was);
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
    this.unindex(r);
    this.bump(r.kind);
    this.sql("DELETE FROM records WHERE id = ?").run(id);
  }
}

const siteKey = (kind: string, site: string | null): string => `${kind}\u0000${site ?? ""}`;

function parse<T>(r: RecordRow): Rec<T> {
  return { ...r, data: (r.data ? JSON.parse(r.data) : {}) as T };
}
