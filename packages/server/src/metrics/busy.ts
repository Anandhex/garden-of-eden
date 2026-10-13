import { BackgroundWork } from "../director/background.js";
import { budgets, CALL_KINDS, type CallKind } from "../budgets.js";
import { BudgetedProvider, CallDropped, ModelLedger } from "../llm/budgeted.js";
import type { ChatRequest, ChatResult, LLMProvider } from "../llm/provider.js";

/**
 * A busy stretch of game days, simulated in virtual time (N19), for `npm run bench:busy` and the
 * busy-week test. The real pieces run: the `BudgetedProvider` with its caps, the `ModelLedger`, and
 * the `BackgroundWork` queue with its priorities and shedding. Only the model is a stand-in: one
 * that holds a single slot (like one Ollama on an 8 GB machine), takes as long as the real one did
 * (G3 measured: first word 205-332 ms, a whole reply 2.7-3.9 s), and is cut off when the player acts.
 * Nothing sleeps for real: a week takes milliseconds.
 */

/** Virtual time: timers fire when `advanceTo` reaches them, in order. */
export class VirtualClock {
  now = 0;
  private timers: Array<{ at: number; seq: number; fire: () => void }> = [];
  private seq = 0;

  /** Wait `ms` of virtual time. `cancel` ends the wait early with an error (an aborted request). */
  sleep(ms: number): { promise: Promise<void>; cancel: (err: Error) => void } {
    let cancel!: (err: Error) => void;
    const promise = new Promise<void>((resolve, reject) => {
      const timer = { at: this.now + ms, seq: this.seq++, fire: resolve };
      this.timers.push(timer);
      cancel = (err) => {
        this.timers = this.timers.filter((t) => t !== timer);
        reject(err);
      };
    });
    return { promise, cancel };
  }

  /** Move time forward to `t`, firing everything due on the way and letting the code that waits on it run. */
  async advanceTo(t: number): Promise<void> {
    for (;;) {
      await settle();
      const due = this.timers.filter((x) => x.at <= t).sort((a, b) => a.at - b.at || a.seq - b.seq)[0];
      if (!due) break;
      this.timers = this.timers.filter((x) => x !== due);
      this.now = Math.max(this.now, due.at);
      due.fire();
    }
    this.now = Math.max(this.now, t);
    await settle();
  }
}

/** Let every promise continuation run. */
const settle = () => new Promise<void>((r) => setImmediate(r));

export interface Latency {
  /** Until the first word, ms. */
  first: number;
  /** For the whole reply, ms. */
  total: number;
}

/** G3's measurements for talking; the rest are the budgets' guesses until measured. */
export function defaultLatency(kind: CallKind): Latency {
  return kind === "talk" ? { first: 300, total: 3300 } : { first: 300, total: budgets.model.expectedMs[kind] };
}

/** One model with one slot. A call waits for the slot; `background().abort()` cuts off a background call in flight. */
export class SimModel {
  private busy = false;
  private waiters: Array<() => void> = [];
  private cancelCurrent: ((err: Error) => void) | null = null;
  private currentIsBackground = false;
  readonly calls: Array<{ kind: CallKind; at: number }> = [];

  constructor(
    private readonly clock: VirtualClock,
    private readonly latency: (kind: CallKind) => Latency,
  ) {}

  private async acquire(): Promise<void> {
    while (this.busy) await new Promise<void>((r) => this.waiters.push(r));
    this.busy = true;
  }

  private release(): void {
    this.busy = false;
    this.cancelCurrent = null;
    this.waiters.shift()?.();
  }

  private provider(background: boolean): LLMProvider {
    return {
      chat: async (req: ChatRequest, onText?: (delta: string) => void): Promise<ChatResult> => {
        await this.acquire();
        this.currentIsBackground = background;
        this.calls.push({ kind: req.kind, at: this.clock.now });
        const lat = this.latency(req.kind);
        try {
          const first = this.clock.sleep(lat.first);
          this.cancelCurrent = first.cancel;
          await first.promise;
          onText?.("...");
          const rest = this.clock.sleep(Math.max(0, lat.total - lat.first));
          this.cancelCurrent = rest.cancel;
          await rest.promise;
          return { text: "...", toolCalls: [] };
        } finally {
          this.release();
        }
      },
      abort: () => {
        if (background && this.currentIsBackground) this.cancelCurrent?.(new Error("aborted"));
      },
    };
  }

  /** For the player's conversation: waits for the slot, never cancelled. */
  talk(): LLMProvider {
    return this.provider(false);
  }

  /** For background work: cancelled when the player acts. */
  background(): LLMProvider {
    return this.provider(true);
  }
}

export interface BusyOptions {
  days: number;
  /** Game days are this long in virtual ms (default: a game day at TIME_FLOW_SECONDS=2, 1,440 minutes). */
  dayMs?: number;
  /** The cast and the people about the player, each with a plan a day. */
  planners?: number;
  /** Quest boards written up each day. */
  flavours?: number;
  retellsPerDay?: number;
  /** Batched life-review calls a day (N25b: a town of thirty talkers is three or four a day, three to a call), the shock reviews of a war starting on the fourth day, and the stories of a newly met place's notables on the first (N25a). */
  reviewsPerDay?: number;
  shockReviews?: number;
  stories?: number;
  /** Conversations the player has each day (each ends in a summary). */
  talksPerDay?: number;
  /** Multiply every model latency (a slower model, or a stress test). */
  slow?: number;
  /** Extra background jobs of any kind queued at the start of every day, to push the queue (kind → count). */
  extra?: Partial<Record<CallKind, number>>;
}

export interface KindReport {
  calls: number;
  /** Over the day's cap when it ran: the caller used its template words. */
  capped: number;
  /** Shed from a long queue before it ran. */
  shed: number;
  waitMs: { avg: number; max: number };
}

export interface BusyReport {
  days: number;
  kinds: Record<CallKind, KindReport>;
  /** The most any kind called in one game day, against its cap. */
  peakPerDay: Record<CallKind, number>;
  queue: { maxLength: number; maxEstimatedWaitMs: number };
  firstTokenMs: { avg: number; max: number; samples: number };
  /** The player's replies, whole, ms. */
  talks: number;
  /** How long the run took on its clock (virtual or real), ms. */
  elapsedMs: number;
}

const avg = (xs: number[]) => (xs.length === 0 ? 0 : Math.round(xs.reduce((a, b) => a + b, 0) / xs.length));

/** Run `o.days` busy game days in virtual time against the stand-in model, and report what the budget did. */
export async function simulateBusy(o: BusyOptions): Promise<BusyReport> {
  const dayMs = o.dayMs ?? 1440 * 2000;
  const slow = o.slow ?? 1;
  const clock = new VirtualClock();
  const model = new SimModel(clock, (k) => {
    const l = defaultLatency(k);
    return { first: l.first, total: l.total * slow };
  });
  return runBusy({ now: () => clock.now, advanceTo: (t) => clock.advanceTo(t), talk: model.talk(), background: model.background() }, { ...o, dayMs });
}

/** Where a busy run happens: a clock, and the two providers (the player's, and background work's). */
export interface BusyEnv {
  now(): number;
  /** Let time pass until `t` (virtual: fire the timers; real: wait). */
  advanceTo(t: number): Promise<void>;
  talk: LLMProvider;
  background: LLMProvider;
}

/** The busy days themselves, against any environment (the simulation above, or a live model in real time). */
export async function runBusy(env: BusyEnv, o: BusyOptions & { dayMs: number }): Promise<BusyReport> {
  const dayMs = o.dayMs;
  const clock = { get now() { return env.now(); }, advanceTo: env.advanceTo };
  const ledger = new ModelLedger(() => Math.floor(clock.now / dayMs) + 1);
  const now = () => clock.now;
  const talkLlm = new BudgetedProvider(env.talk, ledger, now);
  const bgLlm = new BudgetedProvider(env.background, ledger, now);
  const waits = Object.fromEntries(CALL_KINDS.map((k) => [k, [] as number[]])) as Record<CallKind, number[]>;
  const capped = Object.fromEntries(CALL_KINDS.map((k) => [k, 0])) as Record<CallKind, number>;
  const shed = { ...capped };
  const calls = { ...capped };
  const perDay = new Map<string, number>();
  let maxLength = 0;
  let maxWait = 0;
  const bg = new BackgroundWork(() => bgLlm.abort?.(), {
    avgMs: (k) => ledger.avgMs(k),
    onDrop: (j) => {
      shed[j.kind]++;
      ledger.recordDropped(j.kind);
    },
  });
  const sample = () => {
    maxLength = Math.max(maxLength, bg.stats.queued);
    maxWait = Math.max(maxWait, bg.estimatedWait());
  };
  const queue = (key: string, kind: CallKind) => {
    const added = clock.now;
    let started = false;
    bg.add({
      key,
      kind,
      run: async () => {
        // A job cut off for the player starts again later: its wait is the time to the first start.
        if (!started) waits[kind].push(clock.now - added);
        started = true;
        try {
          await bgLlm.chat({ kind, system: "s", messages: [{ role: "user", content: key }] });
          calls[kind]++;
          const day = Math.floor(clock.now / dayMs) + 1;
          perDay.set(`${day}:${kind}`, (perDay.get(`${day}:${kind}`) ?? 0) + 1);
        } catch (err) {
          if (err instanceof CallDropped) capped[kind]++;
          else throw err;
        }
      },
    });
    sample();
  };

  const planners = o.planners ?? 16;
  const flavours = o.flavours ?? 6;
  const talks = o.talksPerDay ?? 6;
  const firstTokens: number[] = [];
  let talksDone = 0;
  const talk = async (n: number) => {
    // The player acts: background work makes way, the model answers, then work resumes.
    bg.pause();
    const start = clock.now;
    let first = -1;
    let done = false;
    const reply = talkLlm
      .chat({ kind: "talk", system: "s", messages: [{ role: "user", content: "hi" }] }, () => {
        if (first < 0) first = clock.now - start;
      })
      .then(() => void (done = true));
    // Time has to pass for the reply to come (the driver moves the clock).
    while (!done) await env.advanceTo(clock.now + 100);
    await reply;
    firstTokens.push(first);
    talksDone++;
    bg.resume();
    queue(`summary:${n}`, "summary");
  };

  let talkNo = 0;
  for (let d = 0; d < o.days; d++) {
    const day0 = d * dayMs;
    await env.advanceTo(day0);
    queue(`chronicle:${d}`, "chronicle");
    for (let i = 0; i < planners; i++) queue(`plan:${i}:${d}`, "plan");
    for (let i = 0; i < flavours; i++) queue(`flavor:${i}:${d}`, "quest-flavor");
    for (let i = 0; i < (o.retellsPerDay ?? 2); i++) queue(`retell:${d}:${i}`, "retell");
    // N25b: a town's talkers are reviewed on a cycle (two batched calls a day is about eighteen talkers; thirty people is three or four), and a war starting
    // on the fourth day shocks everyone at once; N25a: a place's new notables get their stories when it is first activated.
    for (let i = 0; i < (o.reviewsPerDay ?? 2); i++) queue(`life-review:${d}:${i}`, "life-review");
    if (d === 3) for (let i = 0; i < (o.shockReviews ?? 4); i++) queue(`life-review:shock:${d}:${i}`, "life-review");
    if (d === 0) for (let i = 0; i < (o.stories ?? 8); i++) queue(`persona-story:${i}`, "persona-story");
    if (d === 2) queue("faction-name:f1", "faction-name");
    if (d === 4) queue("child-words:c1", "child-words");
    for (const [kind, n] of Object.entries(o.extra ?? {}) as Array<[CallKind, number]>) for (let i = 0; i < n; i++) queue(`${kind}:extra:${d}:${i}`, kind);
    // The player talks through the waking hours, evenly.
    for (let t = 0; t < talks; t++) {
      await env.advanceTo(day0 + Math.round(((t + 1) * dayMs * 0.7) / (talks + 1)) + dayMs * 0.15);
      await talk(talkNo++);
      sample();
    }
  }
  // Let the last day's queue run out.
  await env.advanceTo(o.days * dayMs + dayMs);
  await bg.drain();

  const kinds = Object.fromEntries(
    CALL_KINDS.map((k) => [k, { calls: k === "talk" ? talksDone : calls[k], capped: capped[k], shed: shed[k], waitMs: { avg: avg(waits[k]), max: Math.round(Math.max(0, ...waits[k])) } }]),
  ) as Record<CallKind, KindReport>;
  const peakPerDay = Object.fromEntries(CALL_KINDS.map((k) => [k, Math.max(0, ...[...perDay].filter(([key]) => key.endsWith(`:${k}`)).map(([, v]) => v))])) as Record<CallKind, number>;
  peakPerDay.talk = talks;
  return {
    days: o.days,
    kinds,
    peakPerDay,
    queue: { maxLength, maxEstimatedWaitMs: Math.round(maxWait) },
    firstTokenMs: { avg: avg(firstTokens), max: Math.round(Math.max(0, ...firstTokens)), samples: firstTokens.length },
    talks: talksDone,
    elapsedMs: clock.now,
  };
}
