[← Plans](README.md) · [Stage 1: N22](../stage-1-foundations.md#n22-long-run-balance-tests)

# N22 plan: Long-run balance tests

**In one line:** `npm run sim:years` runs the realm (and, after N25, every person) for years over several seeds with no model, checks every number against bounds that each phase adds, and fails CI when the world collapses or stalls.

**Read first:** [plans README](README.md) sections 2 (determinism), 5 (**a year is 12 days**), 10 (long tests). Needs N18 (deterministic streams), N20 (liveness metrics); gets much more useful after N25 (people) but should be built before it so N25 is tuned with it.

## What exists

- [`scripts/sim-realm.ts`](../../../packages/server/scripts/sim-realm.ts): one seed, `DAYS` days, prints `describeRealm`, `realm.stats` and the most renowned. No checks.
- `realm.stats`: counters (`tally(realm, key)`) for what happened.
- N13 had to be tuned down from 41 factions by hand; `MAX_FACTIONS = 24` in [`realm/director.ts`](../../../packages/server/src/game/realm/director.ts).
- Famine relief exists: [`realm/economy.ts`](../../../packages/server/src/game/realm/economy.ts) buys food when `food < 30` and the treasury can pay. War weariness: `kingdom.weariness`, used in [`diplomacy.ts`](../../../packages/server/src/game/realm/diplomacy.ts) to end wars.
- `config.daysPerYear = 12`: **10 years is 120 days**. A 10-year, 10-seed run is 1,200 realm days. At N19's `dayCoarseMs` budget of 250 ms that's 5 minutes worst case; today's realm-only day is much cheaper.

## Decisions made in this plan

1. **Bounds are data with code checks**, in `server/src/balance/bounds.ts`, each tagged with the phase that added it. A phase that adds a system adds its bounds in the same commit. The runner knows nothing about specific systems.
2. **Sample once a day** into a compact series (`Sample` per day: totals and per-kingdom/per-species numbers). Bounds check the series, so they can say "never", "not for more than N days in a row", "at least once a year", "stays within a band after year 1".
3. **No model, enforced:** the runner uses `NoModelProvider` (throws on any call) and `DIRECTOR=off`, `PLANNING=off`. Anything that needs the model must have a fallback anyway (README section 4).
4. **A warm-up.** Bands are checked after the first year (12 days) so the generator's starting state doesn't trip them.
5. **Break switches for the self-test:** add `config.balance.break: Set<string>` (env `BALANCE_BREAK=no-famine-relief,no-war-fatigue`). Each switch disables one stabiliser in code (`if (!broken("no-famine-relief")) { …relief… }`). They exist only to prove the bounds catch a broken world; tests use them, players never do.
6. **CI and nightly:** a small run in the normal test suite (3 seeds × 5 years = 180 realm days); a nightly GitHub Actions workflow with 10 seeds × 10 years that uploads the JSON report as an artifact.

## Data shapes

```ts
// balance/sample.ts
export interface Sample {
  day: number;
  kingdoms: Record<string, { alive: boolean; places: number; people: number; weariness: number }>;
  species: Record<string, number>;     // living figures (and after N25, people) by species
  population: number; food: { min: number; mean: number }; prosperity: { min: number; mean: number };
  famines: number;                     // settlements with food < 15
  plagues: number;                     // N61; 0 until then
  wars: number; factions: number; factionsByKind: Record<string, number>;
  longChains: number;                  // N20: chains with length > 3 that grew today
  liveness: Record<string, number>;    // N20's metrics
}

// balance/bounds.ts
export interface Bound {
  id: string;                          // "kingdoms-within-cap"
  phase: string;                       // "N13", "N22", "N25"...
  describe: string;                    // for the report
  check(series: Sample[], ctx: { daysPerYear: number; seed: number }): { ok: boolean; detail: string };
}
```

## The first bounds (N22 adds these for what exists today)

| id | rule | why |
|---|---|---|
| `no-kingdom-extinct` | no kingdom falls unless a bound-allowed conquest; by default every starting kingdom survives 10 years | the realm shouldn't collapse to one crown |
| `kingdoms-within-cap` | kingdom count ≤ the cap (12 from the open decisions; the generator makes 3 today, and only N64 adds new kingdoms) | N64 will add kingdoms |
| `species-survive` | each starting species' count > 0 throughout | no species dies out by default |
| `population-band` | after year 1, total population stays within ±50% of the start | neither boom nor bust |
| `food-band` | mean food 30–90 after year 1; no settlement below 15 for more than one year in a row | famine isn't permanent |
| `prosperity-band` | mean prosperity 25–85 after year 1 | |
| `war-not-permanent` | no war lasts more than 3 years; at least one year in ten with no war for each kingdom | weariness works |
| `factions-band` | active factions between 5 and `MAX_FACTIONS`; no kind (gang, cult…) above half | N13's 41-faction problem |
| `chains-each-year` | at least K chains of length > 3 in every year (needs N20) | the world isn't static |
| `liveness-floor` | distinct actions per day ≥ a floor | no stall |

Start each band from what the current game does (run 10 seeds, take the observed range, widen by 20%) and **write the measured range in the bound's comment**. Bounds are a net against regressions, not a design target.

## Steps

### Step 1: the sampler and runner
- `balance/sample.ts`: `sampleWorld(world, store)` → `Sample` (reads realm and, after N25, people counts via SQL).
- `balance/run.ts`: `runYears({ seed, years, onDay? })` → `{ series, stats, timings }`: a fresh world from the seed (realm + materialised people from N18), `advance` a day at a time through the same code the game uses for days (`realmDay` now; N25's people day later: call one `worldDay()` entry point, not the realm directly, so new systems are included automatically).
- Make `worldDay(world, store, day)` the single function that runs everything daily (realm, people, stories, metrics). If the game's server and CLI each run days slightly differently today, unify them through this function first; otherwise `sim:years` tests a different world than the one played.

### Step 2: bounds and the report
- `balance/bounds.ts` with the table above; `checkAll(series)`.
- `scripts/sim-years.ts` and `"sim:years"` in `package.json`: `YEARS=10 SEEDS=1..10 npm run sim:years` (also `SEEDS=1,4,9`). Prints a table per seed (pass/fail per bound with detail), averages of the liveness metrics and realm totals, the run time per seed, and writes `saves/balance-report.json`. Exit 1 if any bound fails.
- `--bound <id>` runs one; `--list` lists them with their phase.

### Step 3: break switches
- `config.balance.break` and `broken(name)`; wire `no-famine-relief` (economy relief) and `no-war-fatigue` (weariness never rises / never ends wars).
- Test: with `no-famine-relief`, `food-band` fails within 10 years on at least one of 3 seeds; with `no-war-fatigue`, `war-not-permanent` fails. If a switch doesn't trip its bound, the bound is too loose or the stabiliser isn't doing anything: investigate, don't just tweak until green.

### Step 4: CI and nightly
- `tests/n22.test.ts`: 3 seeds × 5 years; all bounds pass; must finish in under ~60 s on CI (check the time; reduce to 3 years if needed and say so).
- `.github/workflows/nightly.yml`: `schedule: cron "0 3 * * *"` plus `workflow_dispatch`; runs `YEARS=10 SEEDS=1..10 npm run sim:years`, uploads `saves/balance-report.json` as an artifact. Failures show on the Actions tab.

### Step 5: the habit
- Add to the plans README's "how to work" checklist and each later stage file's phase template: **"Bounds: what this phase adds to `balance/bounds.ts`"**. N25 adds births/deaths bounds (see its plan); N26 adds journey bounds; N28 adds wildlife bounds.
- README: `sim:years`, bounds, break switches.

## Edge cases and traps

- **Determinism is a prerequisite.** If two runs of the same seed differ, bounds flicker. The runner prints the final `worldHash`; a test runs one seed twice and compares.
- **Don't let the runner diverge from the game.** Everything daily goes through `worldDay` (step 1). If you find a system that only runs from `server.ts`, move its daily part into `worldDay`.
- **Bands tuned to pass are useless.** Each bound's comment records the measured range and the date; a later change that needs a band widened must say why in its commit.
- **Time.** If the nightly grows past ~20 minutes, sample fewer seeds or run seeds in parallel processes (`node:child_process`), not threads (the sim isn't thread-safe).

## Tests (`packages/server/tests/n22.test.ts`)

- Same seed twice → same final hash and same series.
- 3 seeds × 5 years → every bound passes.
- `no-famine-relief` → `food-band` fails; `no-war-fatigue` → `war-not-permanent` fails.
- `sim:years` exits 1 on a failing bound (child process with a break switch).

## Done when (mapped)

| Done-when clause | Proved by |
|---|---|
| ten years over ten seeds stay inside every bound | nightly run (and once locally before calling it done) |
| a deliberately broken setting is caught | break-switch tests |

## Slice cut

Not in the slice, but run `sim:years` on the slice's world (Millbrook and its neighbour) to catch N25's births/deaths blowing up before the playtest.

## Out of scope

Tuning the game's feel. Model-based evals (tooling track).
