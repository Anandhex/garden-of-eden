/**
 * Budgets (N19): the numbers every later phase has to stay inside. Plain numbers with where
 * each came from; tests, `sim:realm --check`, `bench:busy` and the admin Health tab all read
 * them from here, and no number is repeated elsewhere. Any of them can be overridden for an
 * experiment with an environment variable (BUDGET_TICK_DAY_MS=0 makes the check fail on purpose).
 *
 * The tick numbers are guesses with margin, checked against what an M2 with 8 GB measured (the
 * comment beside each). CI machines differ, so tests multiply by `perfSlack()` (PERF_SLACK).
 */

const num = (name: string, fallback: number): number => {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

/**
 * Every kind of model call, most protected first. The order is the priority: the background
 * queue runs earlier kinds first and, when it is too long, drops from the end of this list up.
 * Later phases add their own at the end (N20 `story-title`, N21 `callback-line`, N27 `place-name`).
 */
export const CALL_KINDS = [
  "talk", // the player's conversation: never dropped, never delayed by anything else
  "summary", // conversation summaries: memory depends on them
  "plan", // daily plans (fallback: the schedule without a model plan)
  "chronicle", // the nightly world director
  "retell", // news retold in a voice (fallback: code's words)
  "faction-name",
  "child-words",
  "quest-flavor",
  "identity", // `npm run gen` writing a new character: not part of play
] as const;
export type CallKind = (typeof CALL_KINDS)[number];

/** 0 is the most protected. */
export const kindRank = (kind: CallKind): number => CALL_KINDS.indexOf(kind);

/** The kinds that are never dropped for being busy: the player's words and the memory of them. */
export const PROTECTED_KINDS: readonly CallKind[] = ["talk", "summary"];

export const budgets = {
  tick: {
    /** One game hour at full detail: the player's site and the people pinned (N25). Measured: ~2 ms for the cast and village. */
    hourFullMs: num("BUDGET_TICK_HOUR_MS", 50),
    /** One game day of the whole realm at coarse detail (the realm's day; everyone's day, `people.day`, is timed alongside and must fit the same limit: tests/n25). Measured: 4 ms median, 7 ms at the 95th (sim:realm, 120 days). */
    dayCoarseMs: num("BUDGET_TICK_DAY_MS", 250),
    /** One year (config.daysPerYear days) of lazy catch-up for one place (N25 fills this in). */
    yearCatchupMs: num("BUDGET_TICK_YEAR_MS", 1500),
    /** The batch write at the end of a tick (N18): the browser stutters past this. Measured: 5 ms for 300 changed people. */
    flushMs: num("BUDGET_TICK_FLUSH_MS", 50),
  },
  frame: {
    /** The work the browser does per frame for a capital's crowd, outside drawing (16.7 ms is a whole 60 fps frame). Measured on the M2: ~0.12 ms a frame for a capital of 3,425. */
    capitalCrowdMs: num("BUDGET_FRAME_MS", 4),
    /** Everyone's place, worked out once a game minute (a burst every TIME_FLOW_SECONDS): one dropped frame, so it must stay about one frame's worth. Measured on the M2: ~17 ms for 3,425 people. */
    capitalMinuteMs: num("BUDGET_FRAME_MINUTE_MS", 25),
    targetFps: 60,
  },
  model: {
    /** Calls per game day. A kind over its cap doesn't happen: the caller uses its template words. */
    perGameDay: {
      talk: Infinity,
      summary: num("BUDGET_CALLS_SUMMARY", 40),
      plan: num("BUDGET_CALLS_PLAN", 30),
      chronicle: num("BUDGET_CALLS_CHRONICLE", 8),
      retell: num("BUDGET_CALLS_RETELL", 4),
      "faction-name": num("BUDGET_CALLS_FACTION_NAME", 3),
      "child-words": num("BUDGET_CALLS_CHILD_WORDS", 2),
      "quest-flavor": num("BUDGET_CALLS_QUEST_FLAVOR", 6),
      identity: num("BUDGET_CALLS_IDENTITY", 10),
    } as Record<CallKind, number>,
    /**
     * Past this estimated wait in the background queue, new flavour is dropped and queued flavour is pruned.
     * A normal day's morning burst (chronicle, 16 plans, 8 quest boards, retells) is about a minute of model
     * time against a game day of 48 real minutes, so two minutes of queue means the model is behind, not busy.
     */
    maxQueueWaitMs: num("BUDGET_QUEUE_WAIT_MS", 120_000),
    /** The player's first token (G3's target, `npm run bench:voice`). */
    talkFirstTokenMs: num("BUDGET_TALK_FIRST_TOKEN_MS", 1500),
    /** How long a call of each kind is guessed to take until real ones are seen (G3: 2.7-3.9 s a whole reply on the M2). */
    expectedMs: {
      talk: 3500,
      summary: 3000,
      plan: 2500,
      chronicle: 3000,
      retell: 2000,
      "faction-name": 1500,
      "child-words": 4000,
      "quest-flavor": 1500,
      identity: 5000,
    } as Record<CallKind, number>,
  },
};

/** How much slower than the M2 a test may be before it fails (CI sets PERF_SLACK=3). */
export function perfSlack(): number {
  return Math.max(1, num("PERF_SLACK", 1));
}

/** The timings the tick budgets apply to: the name `timed()` records under, what it is, and its limit. */
export interface TickBudget {
  name: string;
  label: string;
  ms: number;
}

export function tickBudgets(): TickBudget[] {
  return [
    { name: "passHour", label: "A game hour at full detail", ms: budgets.tick.hourFullMs },
    { name: "realm.day", label: "A realm day at coarse detail", ms: budgets.tick.dayCoarseMs },
    { name: "catchup.year", label: "A year of lazy catch-up (N25)", ms: budgets.tick.yearCatchupMs },
    { name: "flush", label: "The batch write at the end of a tick", ms: budgets.tick.flushMs },
  ];
}
