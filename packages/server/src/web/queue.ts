/**
 * The request queue (G1). On 8 GB, Ollama runs one generation at a time, and the
 * game's state must only change one action at a time, so actions take turns here
 * instead of a second one being turned away while a reply streams.
 */
export class QueueFullError extends Error {
  constructor(limit: number) {
    super(`Too many actions waiting (${limit}). Try again in a moment.`);
  }
}

export class ActionQueue {
  private tail: Promise<unknown> = Promise.resolve();
  /** Actions accepted and not finished: the one running plus those waiting. */
  private active = 0;

  constructor(private readonly maxWaiting: number) {}

  /** True while an action runs (or is about to). */
  get busy(): boolean {
    return this.active > 0;
  }

  /** Actions waiting behind the one running. */
  get length(): number {
    return Math.max(0, this.active - 1);
  }

  /**
   * Run `job` once everything queued before it has finished. `onQueued` hears how many
   * are ahead of it when it has to wait. Throws QueueFullError when the line is full.
   */
  run<T>(job: () => Promise<T> | T, onQueued?: (ahead: number) => void): Promise<T> {
    if (this.busy && this.length >= this.maxWaiting) return Promise.reject(new QueueFullError(this.maxWaiting));
    const ahead = this.active;
    this.active++;
    if (ahead > 0) onQueued?.(ahead);
    const result = this.tail.then(() => job()).finally(() => this.active--);
    // A failed job mustn't stop the ones after it.
    this.tail = result.catch(() => undefined);
    return result;
  }
}
