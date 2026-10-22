[← Plans](README.md) · [Stage 2: N35](../stage-2-everyone-lives.md#n35-moving-through-time)

# N35 plan: Moving through time

**In one line:** one "pass time until…" engine runs the world forward an hour at a time (a day at a time when nothing near is happening), checks a list of **wake conditions** after each step, and stops at the first one that's true; waiting, sleeping, skipping days or a season, and fast travel all use it; what the player heard meanwhile is gathered into a short summary.

**Read first:** [plans README](README.md) sections 2, 3, 9, 17. Needs N26 (fast travel already stops for things on the road: [`road/fast.ts`](../../../packages/server/src/game/road/fast.ts)), N34 (the followed list and flagged news). Uses N24's `playerLearns` (step 0 if missing) and N33 (news reaches the player's place by carriers while they wait).

## What exists

- **Waiting:** the web action `wait` passes up to N hours (`passHours` in [`web/server.ts`](../../../packages/server/src/web/server.ts) → `Town.passHours` in [`town.ts`](../../../packages/server/src/game/town.ts)); on the road, `wait` and `camp` go through `town.road.camp(hours)`. No condition, no summary beyond the log lines.
- **Fast travel** ([`road/fast.ts`](../../../packages/server/src/game/road/fast.ts)): along walked roads, stops for a party on the road, a situation, a threat's ground, nightfall, hunger, a toll, the end of what was walked. Its stop checks are written inside it.
- **Realm days** run in `advanceRealm`; places other than the player's are lazy or live by day (N25); the player's place runs hour by hour.
- **Budgets** (N19): model calls during a long skip must be dropped to fallbacks (they'd take forever).

## Decisions made in this plan

1. **One engine:** `game/time/pass.ts` `passUntil(town, { maxHours, conditions, mode })` → `{ hours, stoppedBy?: WakeHit, heard: KnownRef[], log }`. It steps **an hour at a time** while anything near the player could happen (people in the player's place awake, on the road), and **a day at a time** (realm day + places' steps) when the player sleeps somewhere safe or skips days and no condition needs hours. After each step it checks conditions in priority order.
2. **Wake conditions are data:** `{ kind, params }` with a check function each in `game/time/wake.ts`:
   - `followed`: something is learned about anyone the player follows (N34's flag fired), optionally a kind filter (illness, death, marriage, rank).
   - `arrives`: a person arrives at the player's place (a followed person, any traveller, a named person).
   - `job`: a job is posted at this place's board (N42's board later; today's `questBoard`/need quests).
   - `season`: the season turns; `time`: a set hour/day; `festival`, `market`.
   - **Always on** (can't be turned off): danger to the player (an attack, a raid on this place, fire), someone wants to talk to the player (N67), the player's needs critical, a crime against the player.
3. **Fast travel uses the same engine.** `fast.ts` keeps its stop reasons, but as wake conditions passed to `passUntil` with mode `travel` (it advances position along the route each step). The "news from a passing traveller" stop becomes the `followed`/"news the player doesn't know of weight ≥ X" condition, evaluated by the same code.
4. **Skips are capped and summarised.** "Skip a day", "skip until the season turns" (at most a season: 12 days on the 48-day year, plans README §5). While skipping, model calls of low priority are dropped to fallbacks (N19 `budgeted.ts` gets a `skipping` flag), the client shows a progress bar, and the server streams progress. The summary lists what the player **heard** (refs learned during the skip, newest first, up to ~12, grouped: about people you follow; about this place; from afar), plus what they did (slept at the inn, ate) and money spent.
5. **Where the player is while waiting:** in a place, at a chosen spot (the inn: costs a bed for nights; home: N66; the street: rest is poor); on the road, camping (N26). The needs model (N26 D1) runs as normal.
6. **Determinism:** the engine changes nothing about the world's rolls; it calls the same `passHours`/`realmDay` the clock already does. A test runs "wait 24 hours" and "wait until X" that stops at hour 24 and compares world hashes.

## Data shapes

```ts
type WakeCondition =
  | { kind: "followed"; who?: string; what?: Array<"ill" | "dead" | "married" | "moved" | "rank" | "any"> }
  | { kind: "arrives"; who?: string } | { kind: "job"; minTier?: string } | { kind: "season" } | { kind: "time"; at: number }
  | { kind: "festival" } | { kind: "market" };
interface PassResult { hours: number; stoppedBy?: { kind: string; text: string; ref?: string }; heard: Array<{ ref: string; text: string; sure: string; source: string }>; spent: number; log: string[] }
```

## Steps

### Step 1: the engine
- `game/time/pass.ts` and `wake.ts` with the always-on conditions; hour vs day stepping; the summary builder from `playerLearns` calls during the run (a collector).
- `wait` (web and CLI) goes through it.
- Test: waiting 24 hours equals passing 24 hours (world hash); a raid on the player's place stops a long wait.

### Step 2: "wake me when…"
- The UI: a Wait dialog with the conditions (followed person / anyone followed; arrival; job; season; time), a maximum, and where to wait.
- Test (done-when): the player waits "until something happens to someone I follow" (max a season) and is woken when their friend in the liege town falls ill, at the hour the news reaches the player (not the hour she fell ill).

### Step 3: skips and the summary
- Skip a day / until the season turns; progress events; the summary panel; the budget's skipping mode.
- Test (done-when): a season skip ends with a short list of the news heard, each with source and sureness.

### Step 4: fast travel on the engine
- Move `fast.ts`'s stop checks to wake conditions with mode `travel`; keep its tests passing.
- Test (done-when): fast travel stops for a gang on the road (a gang's ambush ground or a bandit party on the walked stretch).

### Step 5: docs
- README: waiting, skipping, what wakes you.

## Edge cases and traps

- **Hour stepping in a big town** is the expensive part; a long wait at full detail in a capital must stay inside the budget. When the player sleeps (inn, home), step the place at day grain too (its people are asleep; the crowd at night needs no hours).
- **Stopping mid-step:** a condition true "during" an hour stops after that hour; the summary says when it happened.
- **News learned while asleep:** the player learns overheard news only when awake and in company (N34's overhearing happens once a day when awake). Waking conditions about news therefore fire at breakfast, which feels right.
- **Fast travel refactor** must not change N26's results: run `n26.test.ts` before and after.

## Tests (`packages/server/tests/n35.test.ts`)

The done-when ones:
- Waiting "until something happens to someone I follow" wakes the player when their friend in the liege town falls ill (when the news arrives).
- A season skip ends with a short list of the news heard.
- Fast travel stops for a gang on the road.

## Done when (mapped)

| Done-when clause | Proved by |
|---|---|
| waits "until something happens to someone I follow" and is woken when their friend in Highdale falls ill | step 2 test |
| a season skip ends with a short list of the news they heard | step 3 test |
| fast travel stops for a gang on the road | step 4 test |

**Save:** none (a wait in progress isn't saved; a save during one saves where it stopped).

## Realism notes (2026-10-23)

From the [realism review](../README.md#realism-gaps-review-2026-10-23).

- **Gap 1, one 48-day year (decided 2026-10-23):** with lives 4× slower in game days, skips are how the player sees generations. Add **"the years pass"**: skip a season or a year (several in a row allowed, each confirmed), on N25's lazy catch-up so it stays fast; the summary says what changed in people (births, deaths, marriages, who grew up, who rose) as well as news. The player doesn't age (plans README §5a), so nothing about them stops a long skip.

## Slice cut

Not in the slice.

## Out of scope

Skipping years (with N66's ageing, a later phase may allow it). Time travel or replays (N23).
