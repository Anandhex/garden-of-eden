import type { AdminModelKind } from "@millbrook/shared";
import { budgets, CALL_KINDS, kindRank, type CallKind } from "../budgets.js";
import { estimateTokens } from "./tokens.js";
import type { ChatRequest, ChatResult, GenerateRequest, LLMProvider } from "./provider.js";

/**
 * Model calls with a budget (N19). Every call has a `kind`; each kind has a cap per game day.
 * `BudgetedProvider` wraps the real provider: a call over its kind's cap doesn't happen (it
 * throws `CallDropped`, which `structured()` turns into `null`, so the caller uses its template
 * words), and every call is logged. The player's talk is never dropped.
 */

/** A call that didn't happen because its kind is over its cap for the day. */
export class CallDropped extends Error {
  constructor(readonly kind: CallKind) {
    super(`The ${kind} budget for today is spent.`);
    this.name = "CallDropped";
  }
}

export interface ModelCall {
  day: number;
  kind: CallKind;
  ms: number;
  promptTokens: number;
  replyTokens: number;
  /** Didn't happen: over the day's cap, or shed from a long queue. */
  dropped: boolean;
  /** A second try of the same request (logged, not counted against the cap). */
  retry: boolean;
  /** Started, but threw (aborted for the player, or the model failed). Not counted against the cap. */
  failed: boolean;
}

const KEPT = 300;
/** How much a new duration moves the average of its kind. */
const SMOOTHING = 0.3;

interface Tally {
  day: number;
  calls: number;
  dropped: number;
}

/** What has been asked of the model, by kind and game day. One per game, shared by every provider wrapper. */
export class ModelLedger {
  private readonly today = new Map<CallKind, Tally>();
  private readonly total = new Map<CallKind, { dropped: number; tokensIn: number; tokensOut: number }>();
  private readonly avg = new Map<CallKind, number>();
  private readonly ring: ModelCall[] = [];
  private firstTokens: number[] = [];
  private firstTokenWorst = 0;

  /** `day` is the game day now; `sink` keeps each call (the database's model_calls table). */
  constructor(
    private readonly day: () => number,
    private readonly sink?: (call: ModelCall) => void,
  ) {}

  private tally(kind: CallKind): Tally {
    const d = this.day();
    let t = this.today.get(kind);
    if (!t || t.day !== d) this.today.set(kind, (t = { day: d, calls: 0, dropped: 0 }));
    return t;
  }

  private totals(kind: CallKind) {
    let t = this.total.get(kind);
    if (!t) this.total.set(kind, (t = { dropped: 0, tokensIn: 0, tokensOut: 0 }));
    return t;
  }

  /** Is there room in today's cap for one more call of this kind? Talk always has. */
  admits(kind: CallKind): boolean {
    return kind === "talk" || this.tally(kind).calls < budgets.model.perGameDay[kind];
  }

  callsToday(kind: CallKind): number {
    return this.tally(kind).calls;
  }

  /** Log one call. Completed first tries count against the cap; retries, failures and drops don't. */
  record(call: Omit<ModelCall, "day">): void {
    const full: ModelCall = { day: this.day(), ...call };
    const t = this.tally(call.kind);
    const totals = this.totals(call.kind);
    if (call.dropped) {
      t.dropped++;
      totals.dropped++;
    } else if (!call.failed) {
      if (!call.retry) t.calls++;
      totals.tokensIn += call.promptTokens;
      totals.tokensOut += call.replyTokens;
      const prev = this.avg.get(call.kind);
      this.avg.set(call.kind, prev === undefined ? call.ms : prev + SMOOTHING * (call.ms - prev));
    }
    this.ring.push(full);
    if (this.ring.length > KEPT) this.ring.shift();
    this.sink?.(full);
  }

  /** A queued job of this kind was shed before it ran (the queue was too long). */
  recordDropped(kind: CallKind): void {
    this.record({ kind, ms: 0, promptTokens: 0, replyTokens: 0, dropped: true, retry: false, failed: false });
  }

  /** The player's wait for the first word, ms. */
  recordFirstToken(ms: number): void {
    this.firstTokens.push(ms);
    if (this.firstTokens.length > 50) this.firstTokens.shift();
    this.firstTokenWorst = Math.max(this.firstTokenWorst, ms);
  }

  /** How long a call of this kind takes: a moving average of real ones, or the guess until one has run. */
  avgMs(kind: CallKind): number {
    return this.avg.get(kind) ?? budgets.model.expectedMs[kind];
  }

  /** The last calls, oldest first. */
  recent(): readonly ModelCall[] {
    return this.ring;
  }

  talk(): { last: number; worst: number } | null {
    return this.firstTokens.length === 0 ? null : { last: Math.round(this.firstTokens.at(-1)!), worst: Math.round(this.firstTokenWorst) };
  }

  /** One row per kind, in priority order (the admin Health tab). */
  rows(): AdminModelKind[] {
    return CALL_KINDS.map((kind) => {
      const t = this.tally(kind);
      const totals = this.totals(kind);
      const cap = budgets.model.perGameDay[kind];
      return { kind, callsToday: t.calls, cap: Number.isFinite(cap) ? cap : null, avgMs: Math.round(this.avgMs(kind)), droppedToday: t.dropped, droppedTotal: totals.dropped, tokensIn: totals.tokensIn, tokensOut: totals.tokensOut };
    });
  }
}

/**
 * Wrap a provider so its calls are counted, capped and logged. `abort` and `warmUp`-style extras
 * pass through to the real one. `generate` exists only if the real provider has one, so
 * `structured()` still falls back to chat for providers without.
 */
export class BudgetedProvider implements LLMProvider {
  generate?: (req: GenerateRequest) => Promise<string>;

  constructor(
    private readonly inner: LLMProvider,
    readonly ledger: ModelLedger,
    /** The clock for durations: real time, or the busy-day simulation's virtual one. */
    private readonly now: () => number = () => performance.now(),
  ) {
    if (inner.generate) this.generate = (req) => this.generateBudgeted(req);
  }

  async chat(req: ChatRequest, onText?: (delta: string) => void): Promise<ChatResult> {
    const { kind } = req;
    this.admit(kind, req.attempt);
    const start = this.now();
    let first = -1;
    const watch = (delta: string) => {
      if (first < 0) {
        first = this.now() - start;
        if (kind === "talk") this.ledger.recordFirstToken(first);
      }
      onText?.(delta);
    };
    try {
      const res = await this.inner.chat(req, watch);
      this.ledger.record({
        kind,
        ms: this.now() - start,
        promptTokens: res.stats?.inputTokens ?? estimateTokens(req.system + req.messages.map((m) => m.content).join("")),
        replyTokens: res.stats?.outputTokens ?? estimateTokens(res.text),
        dropped: false,
        retry: (req.attempt ?? 0) > 0,
        failed: false,
      });
      return res;
    } catch (err) {
      this.ledger.record({ kind, ms: this.now() - start, promptTokens: 0, replyTokens: 0, dropped: false, retry: (req.attempt ?? 0) > 0, failed: true });
      throw err;
    }
  }

  private async generateBudgeted(req: GenerateRequest): Promise<string> {
    const { kind } = req;
    this.admit(kind, req.attempt);
    const start = this.now();
    try {
      const text = await this.inner.generate!(req);
      this.ledger.record({ kind, ms: this.now() - start, promptTokens: estimateTokens(req.system + req.prompt), replyTokens: estimateTokens(text), dropped: false, retry: (req.attempt ?? 0) > 0, failed: false });
      return text;
    } catch (err) {
      this.ledger.record({ kind, ms: this.now() - start, promptTokens: 0, replyTokens: 0, dropped: false, retry: (req.attempt ?? 0) > 0, failed: true });
      throw err;
    }
  }

  /** Over the day's cap: log the drop and refuse. A retry of a call that was allowed is always allowed. */
  private admit(kind: CallKind, attempt = 0): void {
    if (attempt > 0 || this.ledger.admits(kind)) return;
    this.ledger.recordDropped(kind);
    throw new CallDropped(kind);
  }

  abort(): void {
    this.inner.abort?.();
  }
}

export { kindRank };
