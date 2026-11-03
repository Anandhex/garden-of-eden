import type { DatabaseSync, StatementSync } from "node:sqlite";

/**
 * Items with a history (N43): one row a notable item. Few (most items stay plain stacks), so all are read once and kept in memory,
 * written straight through.
 */
export interface NotableRow {
  id: string;
  /** The kind of item ("iron sword"). */
  base: string;
  tier: string;
  /** Its name, once it has earned one ("Greyfang's Bane"), and who gave it ("model", "template", "maker"). */
  name: string | null;
  named_by: string | null;
  /** Who made it (a person, figure or persona id, or a name), when known. */
  maker: string | null;
  made_day: number;
  made_site: string | null;
  /** A person row, a figure, a persona id, "player", `site:<id>` (where it lies: a hoard, a grave, a ruin), or null (lost). */
  holder: string | null;
  holder_since: number;
  /** 0..100: what its deeds have made of it. */
  fame: number;
  /** JSON HistoryEntry[] (capped: the first, every deed, the last twelve). */
  history: string;
  /** JSON { day, where, how } when lost. */
  lost: string | null;
}

export class NotableStore {
  private readonly statements = new Map<string, StatementSync>();
  private rows: Map<string, NotableRow> | null = null;

  constructor(private readonly db: DatabaseSync) {}

  private sql(text: string): StatementSync {
    let st = this.statements.get(text);
    if (!st) this.statements.set(text, (st = this.db.prepare(text)));
    return st;
  }

  dropCache(): void {
    this.rows = null;
  }

  private all(): Map<string, NotableRow> {
    return (this.rows ??= new Map((this.sql("SELECT * FROM notable_items ORDER BY id").all() as unknown as NotableRow[]).map((r) => [r.id, { ...r }])));
  }

  get(id: string): NotableRow | undefined {
    return this.all().get(id);
  }

  list(filter?: (r: NotableRow) => boolean): NotableRow[] {
    const out = [...this.all().values()];
    return filter ? out.filter(filter) : out;
  }

  heldBy(holder: string): NotableRow[] {
    return this.list((r) => r.holder === holder);
  }

  put(r: NotableRow): void {
    this.all().set(r.id, { ...r });
    this.sql("INSERT OR REPLACE INTO notable_items (id, base, tier, name, named_by, maker, made_day, made_site, holder, holder_since, fame, history, lost) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(r.id, r.base, r.tier, r.name, r.named_by, r.maker, r.made_day, r.made_site, r.holder, r.holder_since, r.fame, r.history, r.lost);
  }
}
