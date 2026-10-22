[← Plans](README.md) · [Stage 2: N30](../stage-2-everyone-lives.md#n30-seasons-and-the-farming-year)

# N30 plan: Seasons and the farming year

**In one line:** one calendar module says where in the year a day falls; the realm's food becomes a farming year (sown in spring, grown in summer, harvested in autumn, eaten through winter); weather becomes regional (colder north and high up); and prices, the crowd's day, roads, beasts, festivals and the map all read the season.

**Read first:** [plans README](README.md) sections 5 (a year is 48 days: this phase switches it), 7, 17 (what a daily rule may read). Needs N25 (people who starve read `site_days`), N26 with Part E (roads with terrain along them, journeys of real people, news swapped at inns). N28 already reads `seasonOf`/`dayOfYear`, so keep those names working.

## What exists

- [`weather.ts`](../../../packages/server/src/game/weather.ts): `SEASONS`, `dayOfYear(day)`, `seasonOf(day)` (four equal parts of `config.daysPerYear`, **12 days by default, so a season is 3 days**), `weatherOn(day)` (one weather for the **whole realm**, hashed from the day: clear, rain, storm, snow), `isCold(day)`.
- Food: `settlement.food` 0..100 ("how full the granaries are"), changed daily in `economyDay` ([`realm/economy.ts`](../../../packages/server/src/game/realm/economy.ts)) by farms level, population and buying from neighbours; `FAMINE` line; famine feeds deaths (N25 `site_days.famine`) and migration.
- Prices: `priceFactor(item, world)` ([`events-calendar.ts`](../../../packages/server/src/game/events-calendar.ts)) for war, cold (pelts), raids; demand prices by stock (`stockFactor` in [`economy.ts`](../../../packages/server/src/game/economy.ts)).
- Festival: only midsummer, on the first summer day (`townEventsOn`); the crowd fills the square on `d.festival` ([`shared/crowd.ts`](../../../packages/shared/src/crowd.ts) `CrowdDay.festival`).
- Roads: `roadDataOf(realm)` ([`road/generateRoads.ts`](../../../packages/server/src/game/road/generateRoads.ts)) has road polylines; chunks know biomes (hills etc.); journeys' timelines are formulas along routes (`shared/road/journey.ts`).

## Decisions made in this plan

1. **The calendar is shared and pure.** `packages/shared/src/calendar.ts`: `yearOf(day, dpy)`, `dayOfYear`, `yearFraction(day, dpy)` (0..1, what N28's species calendars use), `seasonOf`, `seasonDay(day)` (1st, 2nd, 3rd day of the season), `daylight(day, dpy, latitude)` → `{ rise, set }` in minutes. The year becomes **48 days** (`config.daysPerYear` 12 → 48: four 12-day seasons; plans README §5). The server's `weather.ts` re-exports these with `config.daysPerYear`, so nothing that imports them breaks, and every season-reader moves to 12-day seasons at once.
2. **Weather becomes regional, still a pure hash.** `weatherAt(seed, day, pos)`: a **climate** per point from the realm's y (north is colder: the top fifth of the map has snow in late autumn, the bottom fifth almost never) and terrain (hills colder and windier, coast wetter), then the day's roll from a regional hash (`hashUnit` of seed, day and a coarse 4×3 grid cell, so neighbouring places usually share weather, and a storm can cover one region and not another). `weatherOn(day)` stays as "the weather at the start town" for old callers; new code calls `weatherAt`. Adds a `fog` weather (autumn mornings, marsh and coast).
3. **The farming year is a curve, not a switch.** Each settlement's daily food change = `produce(season, seasonDay, farms, weather, labour) − eat(population)`, where produce is ~0 in winter, small in spring (sowing costs seed), small in summer (gardens, milk), and a **harvest** spread over the autumn days (most of the year's food). Bad weather at harvest (storm, rain two days running) cuts it; a drought (N62) cuts it later. `labour`: the share of the place's farmers and labourers alive and not at war (N55 makes levies matter). Tuned so a normal place ends winter around 25–35 food and a bad year dips under `FAMINE` in late winter. **Settlement gains `harvest: { year, yield }`** so news and the admin can say "a poor harvest".
4. **Prices follow stores.** `priceFactor` gets the place's `food`: food items cost `1 + max(0, (50 − food) / 50)` (up to ×2 near empty) and a bit less after a good harvest. "Bread costs more in late winter" falls out of this.
5. **The crowd's day follows daylight.** `CrowdDay` gains `rise`, `set` and `season`. Work starts at sunrise (clamped 5:00–8:00) and outdoor work ends at sunset; in winter people are indoors more (`outFor` lower), at harvest farmers work late (the `harvest` flag). This is in shared crowd code, so the browser and server agree.
6. **High roads close with snow, as a pure function.** `roadDataOf` marks a road **high** if its path crosses hills chunks above a height threshold. `roadOpen(seed, road, day)`: closed after two days of snow at the pass in winter, reopens after two days without snow (all from `weatherAt`, so the same everywhere and replayable). Closed roads: route planning skips them (`route` and the road graph); journeys leaving that day pick another route or wait, so news (carried by travellers) goes the long way round or waits too; on the map the pass has a snowdrift barrier. Mud: rain on a road's last two days gives walking ×1.2 (N26 already slows rain days; extend it to "rain recently").
7. **Beasts in winter.** Packs are hungrier: `packsDay` attack chance ×1.5 in winter, and winter attacks favour herds and the edges of places. True migration and population cycles are N60's.
8. **Four festivals per kingdom**, on the second day of each season: planting (spring), midsummer, harvest home (autumn), midwinter. `townEventsOn` returns `festival` with a `festivalId`. Each changes what the crowd does that evening (all in the square), what the inn sells, and N53 later gives each culture its own names and customs. With 12-day seasons this is a festival every 12 days (decided 2026-10-23: a 48-day year, so Question 1 is moot; keep all four).
9. **The map shows the season.** Client: a tint per season, snow on tiles when it has snowed in the last days (from `weatherAt`, no server data), bare brown fields in winter, green in spring and summer, stooks in autumn after the harvest day, leafless deciduous trees in winter.

## Steps

### Step 1: shared calendar
- **Done before N40 by the [migration guide](migration-2026-10-23-one-year-ageless-player.md) part A** (order decided 2026-10-23); if it is already built, this step only checks the tests below still pass. Otherwise follow part A (inventory, retune order, expected test failures). `config.daysPerYear` default 12 → 48 and `shared/src/calendar.ts`, re-exported from `weather.ts`. Retune what is stated per day (plans README §5: conception, seeking, famine, `pregnancyDays` 36, `restDays` 48, courtship) and rerun `sim:lives` until N25's bounds hold; retune the season windows in `chatter/bounds.ts` and `choice/bounds.ts` (now 12 days). Tests: day 1 is spring day 1; day 13 is summer day 1; a person born on day 1 is 1 on day 49; `yearFraction` steps evenly; `daylight` is longest at midsummer.

### Step 2: regional weather
- `weatherAt(seed, day, pos)` in `shared/src/weather.ts` (the browser draws snow from it); `climateOf(pos, terrain)`. Callers that know a place switch to it (needs, crowd day, road walking, situations' `when.weather`).
- Test: over a simulated year the north sees snow and the south doesn't; two neighbouring places share the weather on most days; same seed, same weather.

### Step 3: the farming year
- `game/realm/harvest.ts`: `produce(s, day, realm)`, used by `economyDay`. Settlement `harvest` field (save bump). News on a poor or a bumper harvest.
- `SiteDay` gains `season` and `harvest` (bad/normal/good), for townsfolk rules (N25b outlook: a bad harvest is a worry).
- Test (`n30.test.ts`): over a simulated year the start town's food rises through autumn and falls through winter; a forced storm on harvest days gives a poorer year.

### Step 4: prices
- `priceFactor` reads the place's food for food items. Test: bread at the start town costs more on the last winter day than on the first day after harvest.

### Step 5: the crowd's seasons
- `CrowdDay.rise/set/season/harvest` and the schedule changes in `crowd.ts`. Test (client and shared): the first worker leaves home later in winter than in summer; fewer people outdoors on a winter evening.

### Step 6: roads that close
- `high` roads in `roadDataOf`; `roadOpen`; route, journeys and walking respect it; the pass barrier tile on the client; the road bar says "the high road over the X hills is snowed in".
- Test: find a high road on a fixed seed; it closes after the snow days and reopens; a journey created on a closed day goes another way; news from beyond the pass reaches the far side later while it's closed.

### Step 7: festivals
- `festivalOn(day, kingdom)`, four kinds; the crowd fills the square for each; inn specials; news line in the place ("the harvest home tonight").
- Test: on each festival day the evening square holds most of the free people of the place (the existing midsummer test, extended to all four).

### Step 8: the map in seasons
- `client/src/world/season.ts`: tints, snow overlay, field stages, tree states, from the calendar and `weatherAt`.
- Play: run a year with the admin fast-forward; check snow, fields, festivals.

### Step 9: docs
- README: the year, the harvest, closures. Admin: a "season and stores" line per place in the overview.

## Balance bounds

- `no-permanent-famine`: no living place is under `FAMINE` for more than a season in a normal year.
- `harvest-matters`: food at the end of winter is lower than after harvest in at least 80% of places.
- `roads-reopen`: no high road is closed for more than a season.

## Edge cases and traps

- **`config.daysPerYear` can change.** Every rule uses `yearFraction`/`seasonDay`, never "day 9". A test runs the year at 12 and at 48 days per year.
- **Lazy places:** harvest is computed by `economyDay` for every settlement already, so `site_days` stays the bridge (section 17).
- **Weather everywhere vs at the player:** messages, situations, needs and the sound (N29) must use the player's position's weather, not `weatherOn`. Grep for `weatherOn(` and decide each one.
- **Journeys already on a road that closes behind them** keep their formula (they crossed before it closed or are past the pass); only departures are rerouted. A traveller *at* the pass when it closes: let them through (it's a formula), it's rare and invisible.

## Tests (`packages/server/tests/n30.test.ts`, `packages/shared/tests/calendar.test.ts`)

The done-when ones:
- Over a simulated year the start town's stores rise at harvest and fall in winter.
- Bread costs more in late winter.
- A high road closes with snow and reopens.
- Each season's festival fills the square.

## Done when (mapped)

| Done-when clause | Proved by |
|---|---|
| Millbrook's stores rise at harvest and fall in winter | step 3 test |
| bread costs more in late winter | step 4 test |
| a high road closes with snow and reopens | step 6 test |
| each season's festival fills the square | step 7 test |

## Questions for the user

1. ~~With 12 days a year, four festivals is one every third day.~~ Answered 2026-10-23 by the 48-day year: seasons are 12 days, so four festivals are one every 12 days; keep all four.
2. ~~Should a longer year (say 48 days) be the default?~~ Answered 2026-10-23: yes, one 48-day year for everything (plans README §5).

**Save:** the next save version: `Settlement.harvest`. Everything else is derived (weather, closures, festivals).

## Realism notes (2026-10-23)

From the [realism review](../README.md#realism-gaps-review-2026-10-23); not decided or built yet.

- **Gap 1, one 48-day year (decided 2026-10-23):** this phase switches the year (decision 1, step 1). Tune every rule here on 12-day seasons: snow closes a pass for a few days of a 12-day winter, sowing and the harvest spread over several days each, food stores last a 12-day winter and `FAMINE` bites late in it, festivals every 12 days.
- **Gap 2, famine relief:** relief should be grain someone carries (an N26 trade or crown journey from a place with stores), not a number added to stores; the N22 `no-famine-relief` switch then turns those journeys off.
- **Gap 6, hands for the harvest:** the yield should scale with working adults at harvest, so a village whose men are levied (N55), dead of plague (N61) or fled (N59) brings in less.

## Slice cut

Not in the slice.

## Out of scope

Droughts and floods (N62). Animal migration and populations (N60). Culture-specific festivals (N53). Crop choice by farmers.
