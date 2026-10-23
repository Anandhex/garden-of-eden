import type { DatabaseSync, StatementSync } from "node:sqlite";
import type { PeopleStore } from "./peopleStore.js";

/**
 * Ambitions and careers (N40): the `ambitions` table (one row per person: what they want from their life, how far up its ladder they are,
 * and how close to the next rung) and the `jobs_held` table (a career's history: every job, rank and seat someone has held, with the days
 * they took it and left it; an open row has no `to_day`).
 *
 * Rows are written straight to the file, inside the caller's transaction when there is one. Both are read every day for every live
 * person, so they are held in memory (ambitions all, jobs only the open ones) after the first read and kept up to date as they change.
 */
export interface AmbitionRow {
  who: string;
  /** An `AmbitionKind` (game/ambition/kinds.ts). */
  kind: string;
  /** What it is about: a trade, a guild (faction id), a seat, a person, a place; or null. */
  target: string | null;
  /** 0..1 toward the next rung, as last measured. */
  progress: number;
  /** The day they took it up. */
  since: number;
  /** The rung of the ladder reached (0 is the first). */
  step: number;
  /** How much they want it now, 0..1 (game/ambition/situations.ts moves it). */
  strength: number;
  /** 0..1: how blocked they feel; at a head it turns into something (game/ambition/situations.ts). */
  frustration: number;
  /** How they are going about it (a `Route`), or null for the ordinary way. */
  route: string | null;
  /** JSON `Urgent`: a short-term want that takes over while it lasts, or null. */
  urgent: string | null;
}

/** Defaults for the fields a new ambition starts with. */
export const AMBITION_DEFAULTS = { strength: 0.6, frustration: 0, route: null, urgent: null } as const;

export interface JobRow {
  who: string;
  /** "smith:journeyman", "apprentice:smith", "farmer", "seat:<seat id>" (game/ambition/careers.ts names them). */
  job: string;
  site: string;
  from_day: number;
  to_day: number | null;
}

export class CareerStore {
  private readonly statements = new Map<string, StatementSync>();
  private ambitions: Map<string, AmbitionRow> | null = null;
  private open: Map<string, JobRow[]> | null = null;

  constructor(private readonly db: DatabaseSync, private readonly people: PeopleStore) {}

  private sql(text: string): StatementSync {
    let st = this.statements.get(text);
    if (!st) this.statements.set(text, (st = this.db.prepare(text)));
    return st;
  }

  /** Forget what is held in memory (after a reset or an import). */
  dropCache(): void {
    this.ambitions = null;
    this.open = null;
  }

  transaction<T>(fn: () => T): T {
    return this.people.transaction(fn);
  }

  // ---- Ambitions ----

  private held(): Map<string, AmbitionRow> {
    if (!this.ambitions) {
      const rows = this.sql("SELECT who, kind, target, progress, since, step, strength, frustration, route, urgent FROM ambitions ORDER BY who").all() as unknown as AmbitionRow[];
      this.ambitions = new Map(rows.map((r) => [r.who, { ...r }]));
    }
    return this.ambitions;
  }

  ambitionOf(who: string): AmbitionRow | null {
    return this.held().get(who) ?? null;
  }

  /** Write someone's ambition (a new one, or the old one moved on). */
  setAmbition(r: AmbitionRow): void {
    const unit = (n: number) => Math.round(Math.max(0, Math.min(1, n)) * 1000) / 1000;
    const row = { ...r, progress: unit(r.progress), strength: unit(r.strength), frustration: unit(r.frustration) };
    const was = this.held().get(r.who);
    if (was && (["kind", "target", "progress", "since", "step", "strength", "frustration", "route", "urgent"] as const).every((k) => was[k] === row[k])) return;
    this.sql("INSERT OR REPLACE INTO ambitions (who, kind, target, progress, since, step, strength, frustration, route, urgent) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(row.who, row.kind, row.target, row.progress, row.since, row.step, row.strength, row.frustration, row.route, row.urgent);
    this.held().set(row.who, row);
  }

  removeAmbition(who: string): void {
    if (!this.held().has(who)) return;
    this.sql("DELETE FROM ambitions WHERE who = ?").run(who);
    this.held().delete(who);
  }

  /** Every ambition, by who (the bounds and the admin's counts). */
  allAmbitions(): AmbitionRow[] {
    return [...this.held().values()].sort((a, b) => (a.who < b.who ? -1 : 1));
  }

  // ---- Jobs held ----

  private openRows(): Map<string, JobRow[]> {
    if (!this.open) {
      const rows = this.sql("SELECT who, job, site, from_day, to_day FROM jobs_held WHERE to_day IS NULL ORDER BY who, from_day, job").all() as unknown as JobRow[];
      this.open = new Map();
      for (const r of rows) this.open.set(r.who, [...(this.open.get(r.who) ?? []), { ...r }]);
    }
    return this.open;
  }

  /** What someone holds now (jobs, ranks, seats), oldest first. */
  openJobs(who: string): readonly JobRow[] {
    return this.openRows().get(who) ?? [];
  }

  /** Take up a job, a rank or a seat (nothing happens if it is already held). */
  startJob(who: string, job: string, site: string, day: number): void {
    if (this.openJobs(who).some((j) => j.job === job)) return;
    this.sql("INSERT INTO jobs_held (who, job, site, from_day, to_day) VALUES (?, ?, ?, ?, NULL)").run(who, job, site, day);
    this.openRows().set(who, [...this.openJobs(who), { who, job, site, from_day: day, to_day: null }]);
  }

  /** Leave a job (the row is kept, with the day they left). */
  endJob(who: string, job: string, day: number): void {
    const now = this.openJobs(who);
    if (!now.some((j) => j.job === job)) return;
    this.sql("UPDATE jobs_held SET to_day = ? WHERE who = ? AND job = ? AND to_day IS NULL").run(day, who, job);
    const left = now.filter((j) => j.job !== job);
    if (left.length > 0) this.openRows().set(who, left);
    else this.openRows().delete(who);
  }

  /** A career, every row, oldest first. */
  history(who: string): JobRow[] {
    return this.sql("SELECT who, job, site, from_day, to_day FROM jobs_held WHERE who = ? ORDER BY from_day, job").all(who) as unknown as JobRow[];
  }

  /** Who holds each seat of a place now (open `seat:` rows), by seat job. */
  seatHolders(site: string): Map<string, string> {
    const out = new Map<string, string>();
    for (const [who, rows] of [...this.openRows()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) for (const r of rows) if (r.site === site && r.job.startsWith("seat:") && !out.has(r.job)) out.set(r.job, who);
    return out;
  }

  /** Everyone holding an open job that starts with `prefix` (a seat of a guild, a shop of a trade). */
  holdersOf(prefix: string): Array<{ who: string; row: JobRow }> {
    const out: Array<{ who: string; row: JobRow }> = [];
    for (const [who, rows] of this.openRows()) for (const r of rows) if (r.job.startsWith(prefix)) out.push({ who, row: r });
    return out.sort((a, b) => (a.who < b.who ? -1 : 1));
  }

  /** The last day a job was left (a seat falling vacant), or null if nobody ever left it; and whether anyone ever held it. */
  lastHeld(job: string): { ever: boolean; left: number | null } {
    const r = this.sql("SELECT COUNT(*) AS n, MAX(to_day) AS left FROM jobs_held WHERE job = ?").get(job) as { n: number; left: number | null };
    return { ever: Number(r.n) > 0, left: r.left === null ? null : Number(r.left) };
  }

  /** Counts for the admin and the bounds. */
  jobCounts(): { open: number; closed: number } {
    const r = this.sql("SELECT SUM(CASE WHEN to_day IS NULL THEN 1 ELSE 0 END) AS o, SUM(CASE WHEN to_day IS NULL THEN 0 ELSE 1 END) AS c FROM jobs_held").get() as { o: number | null; c: number | null };
    return { open: Number(r.o ?? 0), closed: Number(r.c ?? 0) };
  }

  /** Rows of jobs left or taken in a stretch of days (the bounds read a year's churn). */
  changesBetween(from: number, to: number): JobRow[] {
    return this.sql("SELECT who, job, site, from_day, to_day FROM jobs_held WHERE (from_day BETWEEN ?1 AND ?2) OR (to_day BETWEEN ?1 AND ?2) ORDER BY who, from_day, job").all(from, to) as unknown as JobRow[];
  }
}
