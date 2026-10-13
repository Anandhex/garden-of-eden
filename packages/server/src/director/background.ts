import { budgets, kindRank, PROTECTED_KINDS, type CallKind } from "../budgets.js";

/**
 * Background model work (planning, summaries, quest flavour): low priority, one job
 * at a time, and never in the player's way. The moment the player acts, pause()
 * cancels the job in flight (its provider aborts the request) and puts it back in
 * the queue; resume() starts again once the reply is done. On an 8 GB machine there
 * is one model; this keeps it free for conversation.
 *
 * N19: every job has a `kind`, and the queue runs the most protected kind first (summaries,
 * then plans, then the chronicle, then flavour; FIFO within a kind). When the estimated wait
 * for everything queued passes `maxQueueWaitMs`, the least protected jobs are dropped, newest
 * first, until it doesn't: a dropped job's `fallback` runs (its template words stand) and the
 * model never hears of it. Summaries are never dropped for being busy.
 */
export interface BackgroundJob {
  /** Same key replaces a queued job (e.g. "plan:brena"). */
  key: string;
  /** What the job's model call is for: its priority, and its place in the wait estimate. */
  kind: CallKind;
  run: () => Promise<void>;
  /** Run instead of `run` if the job is dropped without running (the queue was too long). */
  fallback?: () => void;
}

export interface BackgroundOptions {
  /** How long a job of this kind is expected to take (the ledger's moving average). */
  avgMs?: (kind: CallKind) => number;
  /** Estimated queue wait past which flavour is dropped. */
  maxWaitMs?: number;
  /** A job was dropped without running. */
  onDrop?: (job: BackgroundJob) => void;
}

export class BackgroundWork {
  private queue: BackgroundJob[] = [];
  private current: BackgroundJob | null = null;
  private paused = false;
  private done = 0;
  private failed = 0;
  private dropped = 0;
  private readonly avgMs: (kind: CallKind) => number;
  private readonly maxWaitMs: number;
  private readonly onDrop?: (job: BackgroundJob) => void;

  constructor(
    private readonly abort: () => void = () => {},
    o: BackgroundOptions = {},
  ) {
    this.avgMs = o.avgMs ?? ((kind) => budgets.model.expectedMs[kind]);
    this.maxWaitMs = o.maxWaitMs ?? budgets.model.maxQueueWaitMs;
    this.onDrop = o.onDrop;
  }

  add(job: BackgroundJob): void {
    this.queue = this.queue.filter((j) => j.key !== job.key);
    if (this.current?.key !== job.key) this.queue.push(job);
    this.shed();
    void this.pump();
  }

  /** How long everything running and queued is expected to take, ms. */
  estimatedWait(): number {
    return (this.current ? this.avgMs(this.current.kind) : 0) + this.queue.reduce((sum, j) => sum + this.avgMs(j.kind), 0);
  }

  /** The player is acting: stop the job in flight (it goes back on the queue). */
  pause(): void {
    this.paused = true;
    if (this.current) {
      this.queue.unshift(this.current);
      this.abort();
    }
  }

  resume(): void {
    this.paused = false;
    void this.pump();
  }

  get stats() {
    return { queued: this.queue.length, running: this.current?.key ?? null, done: this.done, failed: this.failed, dropped: this.dropped, estimatedWaitMs: Math.round(this.estimatedWait()), maxWaitMs: this.maxWaitMs };
  }

  /** The keys waiting, in the order they will run. */
  queued(): string[] {
    const order = this.queue.map((j, i) => ({ j, i })).sort((a, b) => kindRank(a.j.kind) - kindRank(b.j.kind) || a.i - b.i);
    return order.map((x) => x.j.key);
  }

  /** Wait until the queue is empty (tests, and the CLI's /wait which has time to spare). */
  async drain(): Promise<void> {
    while (this.current || (this.queue.length > 0 && !this.paused)) await new Promise((r) => setTimeout(r, 5));
  }

  /** Too long a queue: drop the least protected jobs, newest first, until the wait is bearable. */
  private shed(): void {
    while (this.estimatedWait() > this.maxWaitMs) {
      let worst = -1;
      for (let i = 0; i < this.queue.length; i++) {
        const j = this.queue[i]!;
        if (PROTECTED_KINDS.includes(j.kind)) continue;
        if (worst < 0 || kindRank(j.kind) >= kindRank(this.queue[worst]!.kind)) worst = i;
      }
      if (worst < 0) return;
      const [job] = this.queue.splice(worst, 1);
      this.dropped++;
      job!.fallback?.();
      this.onDrop?.(job!);
    }
  }

  /** The next job: the most protected kind, first in line among equals. */
  private next(): BackgroundJob | undefined {
    let best = -1;
    for (let i = 0; i < this.queue.length; i++) if (best < 0 || kindRank(this.queue[i]!.kind) < kindRank(this.queue[best]!.kind)) best = i;
    return best < 0 ? undefined : this.queue.splice(best, 1)[0];
  }

  private async pump(): Promise<void> {
    if (this.current || this.paused) return;
    const job = this.next();
    if (!job) return;
    this.current = job;
    try {
      await job.run();
      this.done++;
    } catch {
      // A cancelled job was already put back by pause(); anything else is dropped.
      if (!this.paused) this.failed++;
    } finally {
      this.current = null;
      if (!this.paused) void this.pump();
    }
  }
}
