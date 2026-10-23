[← Plans](README.md) · [Realism gaps](../README.md#realism-gaps-review-2026-10-23)

# Migration: one 48-day year, an ageless player, quick travel (decided 2026-10-23)

**In one line:** three decisions from the 2026-10-23 realism review change code that is already built. This guide says what each one touches in the built code, what to change, in what order, what to retune, and how to check it, so an agent can do the switch without rereading the whole discussion.

**Read first:** [plans README](README.md) sections 1 (old saves are thrown away), 2 (determinism), **5 and 5a** (the decisions themselves), 10 (testing patterns). The realism review in the [living-world README](../README.md#realism-gaps-review-2026-10-23).

| Decision | Built code affected | When |
|---|---|---|
| **A. One clock, a 48-day year** (`config.daysPerYear` 12 → 48, four 12-day seasons, lives included) | yes: ~20 source files, 9 test files, `sim:lives` | ✅ **built 2026-10-23** (after G5 and G6, before N40): see [What was done](#what-was-done-2026-10-23) |
| **B. The player doesn't age and comes back from death** | almost none: the player has no age today, and losing a fight is already a knockout | with N49 step 6 / N66; part B0 now |
| **C. Quiet travel is quick** (fast travel on known roads, quick walking) | `road/fast.ts`, `road/walk.ts`, the walk | an N26 follow-up, **after G5** (G5 moves walking to the server, so C2 is server-only) |

**Order (decided 2026-10-23):** G5, then G6, then **A**, then N40. Do **A** on its own commit: it is the only one that can break many tests, and it must be judged by the numbers (`sim:lives`, N25/N37/N38 bounds), not by eye.

---

## Part A: one 48-day year

> ✅ **Built 2026-10-23.** The tables below are the plan as written; [What was done](#what-was-done-2026-10-23) at the end of this part says what changed, including four rules the dry run found that the tables missed (the economy's food swing, raids, beast attacks and the tax day).

### What exists

- `config.daysPerYear` ([`config.ts`](../../../packages/server/src/config.ts)) defaults to 12, overridable by env `DAYS_PER_YEAR`. **Use the env to dry-run the switch before changing the default.**
- Everything that reads it falls in three groups. Read each group's rule before touching code.

**1. Follows the year on its own (stated per year, converted to days): no change, but its behaviour in days changes 4×.**

| File | What | After the switch |
|---|---|---|
| [`game/life.ts`](../../../packages/server/src/game/life.ts) | `ageOn`, `createLife` (`bornOnDay = day − age × dpy`), `dailyDeathChance` (`1 − (1 − yearly)^(1/dpy)`) | right as is |
| [`game/people/rates.ts`](../../../packages/server/src/game/people/rates.ts) | `LIVES.yearly` hazards → daily via `hazardsFor` (cache key includes dpy) | right as is |
| [`game/people/rules.ts`](../../../packages/server/src/game/people/rules.ts) | `ageFrom`, `isBirthday` | right as is |
| [`game/people/rising.ts`](../../../packages/server/src/game/people/rising.ts), [`realm/townsfolk.ts`](../../../packages/server/src/game/realm/townsfolk.ts), [`family.ts`](../../../packages/server/src/game/family.ts) `ageOf` | ages from `born_day` | right as is |
| [`realm/townsfolk.ts`](../../../packages/server/src/game/realm/townsfolk.ts):262 | roster cache rebuilt once a year (for ages) | now every 48 days: fine |
| [`people/world.ts`](../../../packages/server/src/game/people/world.ts):60 | lazy catch-up in chunks of a year, timed against `budgets.yearCatchupMs` | a chunk is 48 days: **re-measure** `yearCatchupMs` ([`budgets.ts`](../../../packages/server/src/budgets.ts)) |
| [`people/report.ts`](../../../packages/server/src/game/people/report.ts):54 | "this year" stats window | 48 days: fine |
| [`creatures.ts`](../../../packages/server/src/game/creatures.ts) `isYearTurn` | beasts age and face the hard winter once a year | once per 48 days: fine (one clock, no split) |

**2. Reads the season (`weather.ts` `seasonOf` / `dayOfYear`): seasons go from 3 days to 12.** No code change; behaviour stretches. Check each for rules tuned to short seasons.

| File | What to check |
|---|---|
| [`weather.ts`](../../../packages/server/src/game/weather.ts) | `seasonOf`, `dayOfYear`, `isCold` (winter or snow): winter is now 12 days of cold |
| [`events-calendar.ts`](../../../packages/server/src/game/events-calendar.ts) | the summer festival on the first day of summer: once per 48 days now |
| [`realm/economy.ts`](../../../packages/server/src/game/realm/economy.ts) | `SEASON_FOOD` (winter ×0.75) and the winter granary: winter lasts 4× longer, so **stores fall further**; check famine rates in `sim:realm` |
| [`realm/wilds.ts`](../../../packages/server/src/game/realm/wilds.ts), [`realm/rise.ts`](../../../packages/server/src/game/realm/rise.ts) | packs breed and notables rise only in spring/summer: same share of the year, fine |
| `road/camp.ts`, `caravans.ts`, `fast.ts`, `play.ts`, `situations.ts` | season-weighted situations and camp cold: a whole 12-day winter of cold camps |
| [`people/outlook.ts`](../../../packages/server/src/game/people/outlook.ts) | its own `seasonOf(ctx, site, from, to)` is a review window, not the calendar: unaffected |
| `game/schedule.ts`, `choice/talker.ts`, `npc/persona.ts`, `admin/folk.ts`, `cli.ts`, `web/server.ts`, `town.ts` | display or schedule by season: fine |

**3. Stated per day, or a window derived from the year: must be retuned by hand.** This is the real work.

| Where | Today | Why it breaks | Change to |
|---|---|---|---|
| `config.family.pregnancyDays` | 9 ("three quarters of a 12-day year") | a year is 48 now | **36** (keep the comment's rule: ¾ of a year) |
| `config.family.restDays` | 12 (a year) | | **48**, or state it as `daysPerYear` |
| `config.family.courtshipNights` | 6 | courting is "a few weeks"; 6 nights is 1/8 of a 48-day year | leave, or scale; check N11 tests |
| `config.family.conceptionChance` | 0.15 / night (the cast) | 4× more nights per year → 4× the births per year | ÷4 (≈ 0.04), then check the cast cap (`maxPopulation` 14) |
| `LIVES.conception` | 0.03 / day (townsfolk) | same | ÷4 (≈ 0.0075), then `sim:lives` |
| `LIVES.seeking` | 0.02 / day | 4× more matches per year | ÷4 (≈ 0.005), then `sim:lives` |
| `LIVES.famineDaily` | 0.012 / day | famine days per year 4× → famine kills 4× more per famine year | ÷4 (≈ 0.003), then `sim:realm` famine deaths |
| `people/migration.ts` daily shares (frightened/starving leavers, roomy places drawing) | per day | 4× the moves per year | ÷4, then `sim:lives` migration counts |
| `chatter/grievance.ts` `halfLifeOf` | ¼–1¼ years | stated in years → now 12–60 days instead of 3–15 | **decide**: grudges in years (realistic, lasts longer in play) or keep the day counts (`12 × …`). Default: keep in years; retune `grievances-settle` |
| `chatter/rel.ts` `HALF_LIFE_YEARS` 2, prune "untouched for a year" | 24 → 96 days | relationship rows live 4× longer: more rows in SQLite | keep in years; watch `MAX_RELS` and the table size in N18's bench |
| `chatter/bounds.ts` `grievances-settle` (older than a year), `revenge-bounded` (per season = dpy/4) | 12 and 3 days | windows 4× longer, caps scale with them | re-check thresholds (revenge cap is per season: allow 4× or restate per 12 days) |
| `choice/bounds.ts` `violence-rare` (per season = dpy/4; cap = 0.1 × fights/day × season) | 3 days | cap scales with the window, fine; check | re-run N38's bounds |
| `choice/weights.ts` `DAY_COOLDOWNS.travel` 3, hour cooldown `24 × 3 × 4` | "once a season" | a season is 12 days now | `travel: 12` (state it as `daysPerYear / 4`) |
| `config.review.everyDays` 3 (N25b) | a season | a review per 3 days = 16 per year | leave in days (reviews are about recent events, and cost model calls: N19); check `review` budgets |
| `director/chronicle.ts` `NEWS_DAYS` 3 | days | news is "recent" in days | leave |
| `game/catchup.ts` (rest heals at most "a month") | days | | leave |
| `people/conditions.ts` `KEEP_DAYS` 60 (site_days kept) | > a year | lazy catch-up of up to a year needs 48 days | leave (60 ≥ 48); raise if a place may lag more than a year |
| `sim-lives.ts` `DAYS` default 120 (10 years) | 10 years | only 2.5 years now | default `10 × daysPerYear` |
| `people/bounds.ts` bands (births 25–40, deaths 15–25 per 1,000 a year, children 30–45%) | per year | per year: unchanged targets | the targets stay; the rates above are tuned to hit them |

### Steps

1. **Dry run.** `DAYS_PER_YEAR=48 npm test` and `DAYS_PER_YEAR=48 DAYS=480 npm run sim:lives`. Save both outputs; the failures listed in [Expected test failures](#expected-test-failures) below are the baseline.
2. **Change the default** in `config.ts` to 48 and the comments that say "12-day year" (`config.ts` family block, `people/rates.ts` header, `chatter/grievance.ts` header, `species.ts`, `npc/types.ts`).
3. **Retune group 3** in the order of the table: family config, then `LIVES`, then migration, then chatter and choice. After each, rerun `sim:lives` (`DAYS=480`, a few seeds) until N25's bands in `people/bounds.ts` hold; then `sim:realm` for famine.
4. **Re-measure budgets**: `budgets.yearCatchupMs` (a year is 4× more days) and N18/N19 benches (`bench-storage`, `bench-busy`); relationship rows live longer.
5. **Fix tests** (below). Tests that compute with `config.daysPerYear` mostly pass; tests with literal days that meant "a year" or "a season" need restating in `config.daysPerYear`. Don't loosen a bound to make a test pass: fix the rate.
6. **Docs**: root README's time section, the N25/N25b/N37/N38 sections in the stage files that quote day counts ("3-day seasons", "120 days"), and `docs/` if they quote the year. Mark the migration done at the top of this file and in plans README §5.

### Expected test failures

From `DAYS_PER_YEAR=48 npx vitest run` on 2026-10-23, before any retune: **5 failed, 1,182 passed, 9 skipped** (61 files, ~12 minutes). Everything else, including every test that computes with `config.daysPerYear`, already passes.

| Test | Fails with | Cause | Fix |
|---|---|---|---|
| `n25.test.ts:103` N25.3 "a village lives ten years" | `expected 2 to be 10` | **Confirmed:** the loop runs a literal 120 days ("10 years" at 12 days); at 48 that's 2.5 years, so the 30-year-old ages 2, not 10 | test: state the span as `10 * config.daysPerYear`, or keep 120 days and expect `120 / config.daysPerYear` years; keep the fast run short (it loops a whole village daily) |
| `n25.test.ts:214` N25.5 "lives a year for every place" | `deathRate` 115.4 per 1,000 a year, bound < 60 | **A real retune finding:** deaths per year double. Per-year hazards scale correctly, so the extra deaths come from rules stated per day: `LIVES.famineDaily` (and a 12-day winter in `realm/economy.ts` `SEASON_FOOD` draining stores further, so more famine days), plus crowding/plague multipliers | **don't loosen the bound.** Retune group 3 (`famineDaily` ÷4 first), rerun `sim:lives`; check famine days per year in `sim:realm` |
| `n17.test.ts:174` N17.3 "a war, a death and a director push" | no war with a reason in the event stream | **Not yet found.** The test world runs a fixed number of days; with 12-day seasons fewer wars start in that window. Suspects: `realm/politics.ts` / `diplomacy.ts` war rolls fed by food or unrest (a long winter changes both), or the higher death rate above | rerun after the `LIVES` retune first; if it still fails, log war starts per day in `sim:realm` at 12 vs 48 and compare |
| `n26e.test.ts:77` N26 Part E "over 60 days every person on a road is a row" | bound `roads-not-empty`: 2 on the road at day 61 (needs ≥ 3) | **Not yet found.** Trip sources (`road/trips/*.ts`) don't read the season or the year directly. Suspects: fewer people (the death rate above), a whole 12-day winter of snow (`play.ts` `WEATHER_SLOW` 1.5, journeys taking longer and fewer leaving), or market and caravan trips depending on stores | rerun after the `LIVES` retune; then count journeys started per day at 12 vs 48 |
| `n33.test.ts:279` N33 step 4 "a death reaches the liege town only through a traveller" | the news never reaches the liege town within days 3–14 | **Likely the same as n26e:** fewer travellers between the two towns in a fixed 12-day window | fix n26e first; if it passes and this doesn't, widen the window in days (a news trip is plain days, so the window shouldn't need to scale with the year) |

The last three likely share one cause. Do the `LIVES` retune before chasing them one by one.

### Traps

- **Determinism holds** (seeds, streams): the same seed still gives the same world; it is just a different world from the 12-day one. Tests that pin a hash or a specific person's life (N18, N25) must re-pin, saying so in the commit.
- **Old saves:** a save made at 12 days has people whose `born_day` was set for 12-day years; at 48 they suddenly look 4× younger. Old saves are disposable (section 1): start a new world after the switch; no save bump needed unless N30 bumps anyway.
- **Don't change two things at once:** switch the year and retune; don't fold N30's farming curve into the same commit.
- **The player:** has no age, so nothing to do (part B).
- **Tests run longer:** anything that loops "a year" of days is 4× longer. Keep fast tests on short loops (a season), and put year-long runs behind `LONG=1` (N22).

### Done when

- `config.daysPerYear` is 48 by default; the full suite passes; `sim:lives` for 10 years (480 days) on 3 seeds holds every N25 band; `sim:realm` famine deaths are in their band; N37/N38 bounds pass; budgets re-measured; docs say 48.

### What was done (2026-10-23)

**The rule:** anything that should happen so many times *a year* is now stated over a year and taken a day at a time, through two helpers in [`weather.ts`](../../../packages/server/src/game/weather.ts): `dailyChance(yearly)` for a chance and `perDay(perYear)` for an amount (with `seasonDays()` for "a season"). Changing `config.daysPerYear` again leaves what happens in a year the same. Stories told in days stay in days: wars (`WAR_CHANCE`, `BATTLE_EVERY`), journeys and their trips, news and gossip windows (`TELL_WINDOW`, `FORGET_DAYS`, `NEWS_DAYS`), courtship nights, reviews every 3 days, cooldowns in hours.

| Where | Was | Now |
|---|---|---|
| `config.daysPerYear` | 12 | **48** (env `DAYS_PER_YEAR` still overrides) |
| `config.family` | `conceptionChance` 0.15 a night, `pregnancyDays` 9, `restDays` 12 | `conceptionYearly` 0.86, `pregnancyDays` ¾ of a year (36), `restDays` a year (48); `courtshipNights` stays 6 |
| `people/rates.ts` `LIVES` | `conception` 0.03, `seeking` 0.02, `famineDaily` 0.012 (per day) | `conception` 0.31, `seeking` 0.22, `famineYearly` 0.135 (per year; `conceptionDaily()`, `seekingDaily()`) |
| `people/migration.ts` | fleeing 0.012, better 0.003, packed 0.008, `HOMESTEAD` 0.012 (per day) | `FLEEING_SHARE` 0.144, `BETTER_SHARE` 0.036, `PACKED_SHARE` 0.096, `HOMESTEAD` 0.144 (per year, `perDay`) |
| `realm/economy.ts` (found by the dry run) | food moved `(ratio − 1) × 40` a day, granary +1.5 a winter day: a 12-day winter emptied the stores (10 years: starved 531, 66 places abandoned) | `FOOD_SWING` 480 a year, `GRANARY_WINTER` 4.5 a winter; `GROWTH`, `STARVING_SHARE`, `FLEEING_SHARE`, `BETTER_SHARE` per year (for places whose people are a number) |
| `realm/politics.ts` `TAX_DAYS` (found by the dry run) | 7: taxes ~1.7 times a 12-day year, 7 times a 48-day one, and each missed tax day can bring the liege's men ("unpaid taxes" was 87% of all raids) | **twice a year** (`daysPerYear / 2`, 24 days); tributes, wages and the tax clerk's trip go with it |
| `realm/diplomacy.ts` raids (found) | a pressed place raids at 0.04 a day, a gang at 0.1 | `RAID_YEARLY` 0.39, `GANG_RAID_YEARLY` 0.72 |
| `realm/wilds.ts` beast attacks (found) | 0.25 a day, at most every 5 days | `BEAST_ATTACK_YEARLY` 0.97, rest `BEAST_REST` 5/12 of a year (20 days) |
| `choice/weights.ts` | `travel` cooldown 3 days / 288 hours | a season (`seasonDays()`: 12 days / 288 hours) |
| `chatter/bounds.ts`, `choice/bounds.ts` | `Math.floor(dpy / 4)` | `seasonDays()`; the caps per season are unchanged and pass |
| `chatter/grievance.ts`, `chatter/rel.ts` | half-lives in years | kept in years (decided default): grudges and feelings last 4× longer in days |
| `sim:lives`, `sim:realm` | 120 days by default | ten years (`10 × daysPerYear`, 480 days) |
| `budgets.yearCatchupMs` | 1,500 ms | kept: a year of catch-up is now ~1.1 s for the biggest capital (4,149 people), ~0.5 s for a city (0.4 s and 0.2 s before) |

**The numbers (ten years, seed 1):**

| | 12-day year (120 days) | 48-day year, before the retune | 48-day year, after (480 days) |
|---|---|---|---|
| `sim:realm` starved / abandoned / raids | 80 / 13 / 237 | 531 / 66 / 894 | 78 / 15 / 288 |
| `sim:lives` births / deaths per 1,000, children-adults-elders, abandoned | 38.8 / 34.4, 32-54-14%, 43 | (N25.5: deaths 115 per 1,000) | 35.8 / 28.8, 32-54-14%, 40 |

`sim:lives` at 480 days holds every N25 bound on seeds 1, 2 and 3 (births 35.8–39.4, deaths 28.8–30.1 per 1,000; the pyramid 32-54-14% on all three).

**Tests changed** (restated in years or in the days the rule really uses; no bound loosened): N13.6's lucky roll is under the day's share of the yearly attack chance; N17.3 has a village break away on day 1 (the first war of a 48-day year comes after three missed tax days, about day 93: day 22 at 12 days, the same ~1.9 years); N25.3 lives three years (`3 × daysPerYear`) and expects people three years older; N26 Part E checks the road bounds on the day it reached (it read day 61 after a 25-day run) and waits two and a half years for an ambush (about 1.75 a year now, 1.4 before); N33 step 4 kills someone a few days before the first tax day (news is told for 6 days, and the clerk goes on day 24) and picks a traveller with nothing fresher to tell.

---

## Part B: the player doesn't age and comes back from death

### What exists

- **No age.** `PlayerState` ([`npc/types.ts`](../../../packages/server/src/npc/types.ts)) has no `bornOnDay` or age; nothing ages the player. **Nothing to remove.**
- **Losing a fight** follows `config.playerDefeat` (env `PLAYER_DEFEAT`): `knockout` by default. Creatures: `creatureBeatsPlayer` ([`creatures.ts`](../../../packages/server/src/game/creatures.ts)) wakes the player hours later at a quarter HP, robbed of a share of coin. Talkers: the `knocked out` outcome in `NpcAgent.ts`, handled in `web/server.ts` `afterTurn` and the CLI (`passHours(knockoutRecoveryHours)`, full HP).
- **`permadeath`** sets `player.death = { day, hour, killedBy }` (`creatures.ts`, `NpcAgent.ts`); the CLI (`cli.ts` 117, 613, 1274) and the web server treat the save as over.
- Illness and injury (N8.1, `game/health.ts`) affect the player but don't kill.

### What changes

- **B0 (now, small):** nothing in code. The knockout default already behaves like "never really dies". Keep `permadeath` as the opt-in.
- **B1 (with N49 step 6):** a real death (from a setback that ends in death, starvation, drowning, an execution) calls one function, `playerComesBack(world, death)`: the player wakes a day later where they last slept (`player.lastSlept`: new, set by inn, home and camp sleep) or at the nearest temple (N50), at low HP; what they carried that day is dropped at the place they fell as a **lost pack** (an item cache others can loot; N43 items keep their history); witnesses get a knowledge row "came back from the dead" (N33). `player.death` is only set under `permadeath`.
- **B2 (N66):** no age, no heir handover (steps 6–7 changed in the [N66 plan](n66-the-players-own-life.md)); the will stays for property.
- **Save:** `player.lastSlept` in the next save bump.
- **Tests:** a player killed in a setback comes back at the inn they last slept in, the pack is at the place of death, a witness knows; `permadeath` still ends the save.

---

## Part C: quiet travel is quick (N26 follow-up)

### What exists

- [`road/fast.ts`](../../../packages/server/src/game/road/fast.ts): `routeFromHere`, `canFast` (true only if the **first stretch ahead is in `player.walked`**), `fastTravel` (runs the clock along walked stretches; stops for parties, a situation rolled for the stretch, threat ground, nightfall in the open, hunger, a toll, or the end of what was walked).
- [`road/walk.ts`](../../../packages/server/src/game/road/walk.ts) records `player.walked` (segment ids, `<road>#<i>`) as the player walks a stretch end to end; a jump (coach, fall) doesn't count.
- Scale: [`shared/src/road/scale.ts`](../../../packages/shared/src/road/scale.ts) `REAL_MINUTES_PER_DAY_WALK = 7` (user's call, 2026-10-13; stays).

### What changes

- **C1, fast travel on known roads:** add `knownRoad(player, roadId)`: true if any stretch is walked, or the road is in `player.knownRoads` (new: filled when the player learns of a road from gossip about a place along it (N33 `player.known`), buys a map, or is told the way by a traveller or innkeeper). `canFast` and `fastTravel` use known stretches instead of walked ones; every other stop stays. Stretches crossed by fast travel are added to `walked`.
- **C2, quick walking:** a server-side `quietFactor` (config, default 4) by which the clock and the player's walk speed up while nothing is in view: no party within sight, no situation or threat on the current stretch, no place gate in view; drop to 1 at once when any appears. The client's walk animation reads the factor from the road state it already gets (no per-step messages).
- **Save:** `player.knownRoads` in the next save bump.
- **Tests:** a road heard of but never walked can be fast-travelled and still stops at a rolled situation; quick walking drops to normal when a party comes into view; arriving takes the same game time either way (only real time changes).
