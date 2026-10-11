/**
 * Background model work (planning, summaries, quest flavour): low priority, one job
 * at a time, and never in the player's way. The moment the player acts, pause()
 * cancels the job in flight (its provider aborts the request) and puts it back in
 * the queue; resume() starts again once the reply is done. On an 8 GB machine there
 * is one model; this keeps it free for conversation.
 */
export interface BackgroundJob {
  /** Same key replaces a queued job (e.g. "plan:brena"). */
  key: string;
  run: () => Promise<void>;
}

export class BackgroundWork {
  private queue: BackgroundJob[] = [];
  private current: BackgroundJob | null = null;
  private paused = false;
  private done = 0;
  private failed = 0;

  constructor(private readonly abort: () => void = () => {}) {}

  add(job: BackgroundJob): void {
    this.queue = this.queue.filter((j) => j.key !== job.key);
    if (this.current?.key !== job.key) this.queue.push(job);
    void this.pump();
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
    return { queued: this.queue.length, running: this.current?.key ?? null, done: this.done, failed: this.failed };
  }

  /** Wait until the queue is empty (tests, and the CLI's /wait which has time to spare). */
  async drain(): Promise<void> {
    while (this.current || (this.queue.length > 0 && !this.paused)) await new Promise((r) => setTimeout(r, 5));
  }

  private async pump(): Promise<void> {
    if (this.current || this.paused) return;
    const job = this.queue.shift();
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
