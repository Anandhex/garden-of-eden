[← Plans](README.md) · [Stage 1: N19](../stage-1-foundations.md#n19-performance-and-model-call-budgets)

# N19 plan: Performance and model-call budgets

**In one line:** tick time, frame time and model calls each get a number in config, a measurement in code, and a check that fails; when the model is over budget, flavour falls back to template words and talking always goes first.

**Read first:** [plans README](README.md) sections 4 (fallbacks), 9 (the machine). Needs N17's timing module (`server/src/metrics/timing.ts`) and N18's storage.

## What exists

- **Background model work:** [`director/background.ts`](../../../packages/server/src/director/background.ts) `BackgroundWork`: a FIFO of `{ key, run }` jobs, one at a time; `pause()` aborts the job in flight when the player acts and puts it back; `resume()` after the reply. Jobs queued from [`town.ts`](../../../packages/server/src/game/town.ts): `retell:<news>` (`retellNews`), `faction-name:<id>` (`nameFaction`), child words (`writeChildWords`), `flavor:<npc>` (`flavorBoard`), the chronicle (`runChronicle`), `plan:<npc>` (`planDay`), conversation summaries (`summariseConversation`). All go through `this.bgLlm`.
- **Conversation:** `NpcAgent` calls `this.llm.chat(...)` with streaming; the web server queues player actions in `ActionQueue` ([`web/queue.ts`](../../../packages/server/src/web/queue.ts)).
- **Provider:** `LLMProvider` ([`llm/provider.ts`](../../../packages/server/src/llm/provider.ts)): `chat`, optional `generate`, optional `abort`. `OllamaProvider` returns token counts and duration (`stats`).
- **Targets already measured (G3):** first token 205–332 ms, whole reply 2.7–3.9 s against targets of 1.5 s and 4 s (`npm run bench:voice`). No check fails when missed.
- **Frame rate:** N16 checked 60 fps in a 3,158-person capital **by hand in the browser**. Nothing in CI.
- `npm run bench` compares models on test lines; `sim:realm` prints realm numbers.

## Decisions made in this plan

1. **One budgets file:** `server/src/budgets.ts`, plain numbers with comments saying where each came from. Env overrides for experiments (`BUDGET_TICK_HOUR_MS=…`). Tests and scripts import it; no number is repeated elsewhere.
2. **Every model call has a kind.** Make `kind` required at the type level so the compiler finds every call site: wrap the provider in `BudgetedProvider` whose `chat(req & { kind: CallKind }, …)` won't compile without it. Kinds and their order (first = most protected):
   1. `talk` (player conversation; never dropped, never delayed by others)
   2. `summary` (conversation summaries: memory depends on them)
   3. `plan` (daily plans)
   4. `chronicle`
   5. `retell` (news retold in a voice)
   6. `faction-name`, `child-words`, `quest-flavor`
   7. later phases add: `story-title` (N20), `callback-line` (N21), `place-name` (N27), `creed`, `song` (later stages)
3. **What "over budget" does:** each kind has a daily cap (per game day). Over the cap, or when the queue's estimated wait passes a limit, a call of that kind **doesn't happen**: the caller gets `null` and uses its template fallback. Every caller of a droppable kind must already have one (README section 4); this phase checks that each does.
4. **Dropping order:** when the queue is too long, drop from the bottom of the list up: flavour (6, then 5, 4) first, then `plan` (fallback: the schedule without a model plan, which already works with `PLANNING=off`), never `summary` unless it's over its own cap (fallback: a code summary from the turn's events), never `talk`.
5. **Frame budget in CI by proxy.** Real fps needs a GPU and a browser. In CI, measure the work the browser does per frame in Node: `CrowdSim.all()` for a capital at a minute, plus `CrowdLayer`'s per-frame logic with Phaser stubbed. Budget: under 4 ms per frame on CI (16.7 ms is a whole 60 fps frame; leave room for drawing). Keep the real 60 fps check as a documented manual step in the browser, with a dev overlay (`?fps=1` shows Phaser's `game.loop.actualFps` and the worst frame in the last 10 s). Optional later: Playwright with `--use-gl=swiftshader`, but software GL fps doesn't mean much; don't block on it.
6. **Tick budgets measured on the M2, enforced loosely in CI.** CI machines differ; tests multiply by `PERF_SLACK` (CI: 3). `sim:realm --check` and `bench` use the real numbers and are run locally before a phase is called done.

## The budgets (first numbers; tune with measurements)

```ts
export const budgets = {
  tick: {
    hourFullMs: 50,        // one game hour at full detail: the player's site + pinned people (N25)
    dayCoarseMs: 250,      // one game day for the whole realm at coarse detail
    yearCatchupMs: 1500,   // one year (config.daysPerYear days) of lazy catch-up for one place
    flushMs: 50,           // N18's batch write at the end of a tick (the browser stutters past this)
  },
  frame: { capitalCrowdMs: 4, targetFps: 60 },
  model: {
    perGameDay: { summary: 40, plan: 30, chronicle: 1, retell: 4, "faction-name": 3, "child-words": 2, "quest-flavor": 6 },
    maxQueueWaitMs: 30_000,   // past this estimated wait, drop flavour
    talkFirstTokenMs: 1500,   // G3's target
  },
};
```

These are guesses until step 2 measures. Record the measured values (and the machine) in a comment beside each.

## Steps

### Step 1: `BudgetedProvider` and call kinds
- `server/src/llm/budgeted.ts`: wraps an `LLMProvider`. `chat(req, onText)` requires `req.kind`. It: counts calls, tokens and time per kind per game day; refuses (returns `null` through a `tryChat` variant) when the kind's cap is hit; records each call `{ day, kind, ms, promptTokens, replyTokens, dropped? }` in a ring buffer and a SQLite table `model_calls` (G3's "per-call log in the game").
- Thread `kind` through: `structured()` in [`director/structured.ts`](../../../packages/server/src/director/structured.ts) gets a `kind` param; each director module passes its own. `NpcAgent` passes `talk`. `runChronicle` passes `chronicle`.
- **Audit every caller of a droppable kind for a fallback.** List them in the PR description. Where one is missing, write the template fallback (most exist because `DIRECTOR=off`/`PLANNING=off` already work).
- Test: with a cap of 1 `retell` per day, the second retell that day uses the fallback text and is logged as dropped.

### Step 2: priorities in the background queue
- `BackgroundJob` gains `kind: CallKind`. `BackgroundWork` picks the next job by priority (stable: FIFO within a priority), not plain FIFO.
- Estimated wait: keep a moving average of duration per kind; `estimatedWait()` = sum of queued jobs' averages. When it passes `maxQueueWaitMs`, `add()` drops new jobs of the lowest priorities (and prunes queued ones of those kinds), calling their fallback immediately.
- `talk` is never in this queue: it pre-empts it (already: `pause()`/`resume()`). Add a test that a queued `chronicle` doesn't delay the player's first token: with a fake provider that takes 2 s per background call, a `talk` started mid-job gets its first token after the abort, not after 2 s.

### Step 3: tick timings with budgets
- Wrap with N17's `timed()`: `passHours` per hour at full detail, `realmDay`, lazy catch-up (N25 adds it; leave the wrapper ready), `flush()`.
- `checkBudgets(snapshot)` → list of `{ name, budget, p95, over }`.
- `sim:realm --check`: after the run, print the timing table and exit 1 if a p95 is over budget. Add `--check` to the script's header comment.
- A vitest perf test (always on, small): 30 days of the realm at coarse detail; median day time under `dayCoarseMs × PERF_SLACK`.

### Step 4: the frame proxy
- `packages/client/tests/frame.test.ts`: build the capital roster and map from a fixed seed (the server's generator is in the server package; either export a fixture JSON from a server test and commit it, or move the pure generator bits into `shared`). Time `CrowdSim.all(day, minute, d)` plus the per-frame position interpolation code from `CrowdLayer` (factor it into a pure function if it's tangled with Phaser) for 600 consecutive frames; the median per-frame time must be under `capitalCrowdMs × PERF_SLACK`.
- Dev overlay in the game client: `?fps=1` shows actual fps and the worst frame time in the last 10 s.
- Document the manual 60 fps check (open the capital, all people drawn, watch the overlay for 60 s) in the README's testing section.

### Step 5: bench the queue
- Extend `npm run bench` (or add `bench:busy`): simulate a busy game day with a fake provider whose latency matches the real model's measured averages (from `model_calls` or G3's numbers), queue that day's background jobs (plans for every NPC, summaries, chronicle, retells), and run a player conversation every few minutes. Report: queue length over time, wait per kind, how many of each kind were dropped, and the player's first-token times. With `--live`, use Ollama.

### Step 6: budgets in the admin view
- N17's health panel shows each tick timing beside its budget (green under 75%, amber under 100%, red over), and each model kind's calls today / cap, average ms, dropped count. Add the queue's current length and estimated wait.

### Step 7: docs
- README: the budgets, how to run `sim:realm --check` and `bench:busy`, the manual fps check, and `PERF_SLACK`.

## Edge cases and traps

- **A game day isn't a real day.** Caps reset when `world.day` changes. A fast-forward of 30 days could queue 30 days of plans at once: don't. Only queue plans for "today" when the day arrives; days skipped in a fast-forward use the fallback (`PLANNING=off` behaviour) and that's correct.
- **Abort leaves partial output.** A dropped or aborted structured call must not half-apply: callers apply results only after a full, schema-valid reply (they already do via zod; keep it that way).
- **Perf tests flake** when the machine is busy. Median of several runs, generous slack in CI, and never assert on a single sample.
- **Timing wrappers cost time.** `performance.now()` is cheap; don't wrap per-person functions, only per-system ones.
- **Don't count retries as separate calls** for caps; do log them.

## Tests (`packages/server/tests/n19.test.ts`, `packages/client/tests/frame.test.ts`)

- Each kind's cap drops the next call to its fallback and logs `dropped`.
- Priority: a queue of [quest-flavor, plan, summary] runs summary, plan, quest-flavor.
- Over-wait: with fake latencies making the wait > `maxQueueWaitMs`, new flavour jobs are dropped at once and `summary` still runs.
- Talk pre-empts: first token arrives within the fake provider's first-token time after a background job is aborted.
- A busy simulated week (fake provider, 7 days, a few talks a day) stays inside every cap and tick budget.
- Frame proxy under budget for the capital.
- `sim:realm --check` exits 1 when a budget is set impossibly low (run the script as a child process with `BUDGET_TICK_DAY_MS=0`).

## Done when (mapped)

| Done-when clause | Proved by |
|---|---|
| a busy simulated week stays inside every budget | busy-week test, `bench:busy` |
| pushing the queue past its cap drops flavour first | over-wait test |
| the player's conversation still starts within the first-token target (G3) | talk pre-empts test; `bench:busy --live` on the M2 |

## Slice cut

Not in the slice. If the slice's playtest feels slow, do steps 1–2 early (kinds and priorities); they're small.

## Out of scope

Choosing a different model. Running two models. Batching model calls.
