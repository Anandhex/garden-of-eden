import type { WorldStore } from "../db.js";
import type { JobRow, JobStatus } from "../../store/jobStore.js";

/**
 * The market's records (N42 decisions 1-3): a job is one row, posted at a board, open to the player and every NPC alike. Whoever claims it
 * first holds it until it is done, failed, given up or past its deadline; a job failed, given up or run out goes straight back on the
 * board (with a shorter deadline) while what it was for is still there.
 */

export const DEADLINE = 12;
/** A re-posted job's deadline is shorter. */
export const REPOST_DEADLINE = 8;

export interface Posting {
  id: string;
  site: string;
  board?: string;
  kind: string;
  giver?: string | null;
  title: string;
  target?: string | null;
  tier: string;
  reward: number;
  day: number;
  deadline?: number;
  ref?: string | null;
}

/** Post a job (or leave one that is already up alone). Returns the row. */
export function post(store: Pick<WorldStore, "jobs">, p: Posting): JobRow {
  const had = store.jobs.job(p.id);
  if (had) return had;
  const row: JobRow = { id: p.id, site: p.site, board: p.board ?? `board:${p.site}`, kind: p.kind, giver: p.giver ?? null, title: p.title, target: p.target ?? null, tier: p.tier, reward: Math.max(0, Math.round(p.reward)), posted: p.day, deadline: p.day + (p.deadline ?? DEADLINE), holder: null, claimed_day: null, status: "open", result: null, ref: p.ref ?? null };
  store.jobs.putJob(row);
  return row;
}

/** First come: a job that is open becomes held by `holder`. False if someone else has it. */
export function claim(store: Pick<WorldStore, "jobs">, id: string, holder: string, day: number, result?: Record<string, unknown>): boolean {
  const j = store.jobs.job(id);
  if (!j || j.status !== "open") return false;
  store.jobs.putJob({ ...j, holder, claimed_day: day, status: "held", result: result ? JSON.stringify(result) : null });
  return true;
}

export const resultOf = (j: Pick<JobRow, "result">): Record<string, unknown> => (j.result ? (JSON.parse(j.result) as Record<string, unknown>) : {});

/** Done: who did it and how. */
export function complete(store: Pick<WorldStore, "jobs">, id: string, by: string, day: number, how: string): void {
  const j = store.jobs.job(id);
  if (!j) return;
  store.jobs.putJob({ ...j, holder: by, status: "done", result: JSON.stringify({ ...resultOf(j), by, day, how }) });
}

/**
 * Back on the board: the holder failed, gave up, or let the deadline pass. The failure is remembered in the result; the job is open again
 * the same day with a shorter deadline, unless `still` says what it was for is gone (then it stays closed with that status).
 */
export function reopen(store: Pick<WorldStore, "jobs">, id: string, day: number, status: Exclude<JobStatus, "open" | "held" | "done">, how: string, still = true): void {
  const j = store.jobs.job(id);
  if (!j) return;
  const r = resultOf(j);
  const past = [...((r.past as unknown[]) ?? []), { holder: j.holder, status, how, day }].slice(-6);
  if (!still) {
    store.jobs.putJob({ ...j, status, result: JSON.stringify({ ...r, past, how, day }) });
    return;
  }
  store.jobs.putJob({ ...j, holder: null, claimed_day: null, status: "open", deadline: day + REPOST_DEADLINE, result: JSON.stringify({ past }) });
}

/** The jobs on a place's boards (open and held), newest first. */
export function boardOf(store: Pick<WorldStore, "jobs">, site: string): JobRow[] {
  return store.jobs.list((j) => j.site === site && (j.status === "open" || j.status === "held")).sort((a, b) => b.posted - a.posted || a.id.localeCompare(b.id));
}

/** Jobs that end long ago are dropped, so the table stays small. */
export function pruneJobs(store: Pick<WorldStore, "jobs">, day: number, keepDays = 60): void {
  for (const j of store.jobs.list((x) => (x.status === "done" || x.status === "failed" || x.status === "expired") && x.deadline < day - keepDays)) store.jobs.removeJob(j.id);
}
