import type { DatabaseSync, StatementSync } from "node:sqlite";
import type { FieldEvent, FieldEventKind } from "@millbrook/shared";

/**
 * Fields (N26G): who holds each plot and how it's fenced (`plots`), what was sown where (`sowings`), and what happened to it
 * (`field_events`, with the tiles). A plot's shape is the layout's (shared farm/layout.ts, from the seed), so only what can
 * change is stored. Events older than a year are folded into `plot_years` (yield and losses by cause) to keep the table
 * small. All held in memory per place after the first read, and written straight through.
 */
export interface PlotRow {
  id: string;
  site: string;
  /** "hh:<site>:<home>" (a household), "lord:<figure>", "temple:<site>", "commons". */
  holder: string;
  fence: number;
}

export interface SowingRow {
  plot: string;
  crop: string;
  day: number;
  year: number;
}

export interface PlotYear {
  plot: string;
  year: number;
  reaped: number;
  lost: string;
}

export class FarmStore {
  private readonly statements = new Map<string, StatementSync>();
  private plots = new Map<string, Map<string, PlotRow>>();
  private sowings = new Map<string, Map<string, SowingRow>>();
  private events = new Map<string, FieldEvent[]>();
  private byPlot = new Map<string, Map<string, FieldEvent[]>>();

  constructor(private readonly db: DatabaseSync) {}

  private sql(text: string): StatementSync {
    let st = this.statements.get(text);
    if (!st) this.statements.set(text, (st = this.db.prepare(text)));
    return st;
  }

  dropCache(): void {
    this.plots.clear();
    this.sowings.clear();
    this.events.clear();
    this.byPlot.clear();
  }

  // ---- Plots ----

  plotsOf(site: string): Map<string, PlotRow> {
    let m = this.plots.get(site);
    if (!m) {
      m = new Map((this.sql("SELECT id, site, holder, fence FROM plots WHERE site = ? ORDER BY id").all(site) as unknown as PlotRow[]).map((r) => [r.id, { ...r }]));
      this.plots.set(site, m);
    }
    return m;
  }

  addPlots(rows: PlotRow[]): void {
    const st = this.sql("INSERT OR REPLACE INTO plots (id, site, holder, fence) VALUES (?, ?, ?, ?)");
    for (const r of rows) {
      st.run(r.id, r.site, r.holder, r.fence);
      this.plotsOf(r.site).set(r.id, { ...r });
    }
  }

  setPlot(site: string, id: string, patch: Partial<Pick<PlotRow, "holder" | "fence">>): void {
    const r = this.plotsOf(site).get(id);
    if (!r) return;
    Object.assign(r, patch);
    this.sql("UPDATE plots SET holder = ?, fence = ? WHERE id = ?").run(r.holder, r.fence, id);
  }

  // ---- Sowings ----

  sowingsOf(site: string): Map<string, SowingRow> {
    let m = this.sowings.get(site);
    if (!m) {
      m = new Map();
      for (const r of this.sql("SELECT s.plot, s.crop, s.day, s.year FROM sowings s JOIN plots p ON p.id = s.plot WHERE p.site = ? ORDER BY s.plot, s.year").all(site) as unknown as SowingRow[]) m.set(`${r.plot}|${r.year}`, { ...r });
      this.sowings.set(site, m);
    }
    return m;
  }

  sowingOf(site: string, plot: string, year: number): SowingRow | undefined {
    return this.sowingsOf(site).get(`${plot}|${year}`);
  }

  sow(site: string, r: SowingRow): void {
    this.sql("INSERT OR REPLACE INTO sowings (plot, crop, day, year) VALUES (?, ?, ?, ?)").run(r.plot, r.crop, r.day, r.year);
    this.sowingsOf(site).set(`${r.plot}|${r.year}`, { ...r });
  }

  // ---- Events ----

  eventsOf(site: string): FieldEvent[] {
    let list = this.events.get(site);
    if (!list) {
      list = (this.sql("SELECT plot, day, kind, tiles, by, amount FROM field_events WHERE site = ? ORDER BY id").all(site) as Array<{ plot: string; day: number; kind: string; tiles: string; by: string; amount: number }>).map((r) => ({ plot: r.plot, day: r.day, kind: r.kind as FieldEventKind, tiles: JSON.parse(r.tiles) as number[], by: r.by, amount: r.amount }));
      this.events.set(site, list);
    }
    return list;
  }

  eventsOfPlot(site: string, plot: string): FieldEvent[] {
    let m = this.byPlot.get(site);
    if (!m) {
      m = new Map();
      for (const e of this.eventsOf(site)) m.set(e.plot, [...(m.get(e.plot) ?? []), e]);
      this.byPlot.set(site, m);
    }
    return m.get(plot) ?? [];
  }

  record(site: string, e: FieldEvent): void {
    this.sql("INSERT INTO field_events (site, plot, day, kind, tiles, by, amount) VALUES (?, ?, ?, ?, ?, ?, ?)").run(site, e.plot, e.day, e.kind, JSON.stringify(e.tiles), e.by, e.amount);
    const copy = { ...e, tiles: [...e.tiles] };
    this.eventsOf(site).push(copy);
    const m = this.byPlot.get(site);
    if (m) m.set(e.plot, [...(m.get(e.plot) ?? []), copy]);
  }

  /** Fold a place's events older than `before` into per-plot yearly summaries. */
  fold(site: string, before: number, yearOf: (day: number) => number): number {
    const old = this.eventsOf(site).filter((e) => e.day < before);
    if (old.length === 0) return 0;
    const sums = new Map<string, { reaped: number; lost: Record<string, number> }>();
    for (const e of old) {
      const k = `${e.plot}|${yearOf(e.day)}`;
      const s = sums.get(k) ?? { reaped: 0, lost: {} };
      if (e.kind === "harvest") s.reaped += e.amount;
      else if (e.kind !== "sow" && e.kind !== "weed") s.lost[e.kind] = (s.lost[e.kind] ?? 0) + e.amount;
      sums.set(k, s);
    }
    const st = this.sql("INSERT OR REPLACE INTO plot_years (plot, year, reaped, lost) VALUES (?, ?, ?, ?)");
    for (const [k, s] of sums) {
      const [plot, year] = k.split("|");
      st.run(plot!, Number(year), s.reaped, JSON.stringify(s.lost));
    }
    this.sql("DELETE FROM field_events WHERE site = ? AND day < ?").run(site, before);
    this.events.set(site, this.eventsOf(site).filter((e) => e.day >= before));
    this.byPlot.delete(site);
    return old.length;
  }

  /** A place's year, folded: what each plot reaped and lost. */
  yearOfSite(site: string, year: number): PlotYear[] {
    return this.sql("SELECT y.plot, y.year, y.reaped, y.lost FROM plot_years y JOIN plots p ON p.id = y.plot WHERE p.site = ? AND y.year = ? ORDER BY y.plot").all(site, year) as unknown as PlotYear[];
  }

  yearsOf(plot: string): PlotYear[] {
    return this.sql("SELECT plot, year, reaped, lost FROM plot_years WHERE plot = ? ORDER BY year").all(plot) as unknown as PlotYear[];
  }
}
