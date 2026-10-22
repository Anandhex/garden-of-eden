[← Plans](README.md) · [Stage 2: N25](../stage-2-everyone-lives.md#n25-townsfolk-lives)

# N25 plan: Townsfolk lives

**In one line:** every stored person ages, marries, has children, moves and dies by code, the same way at every level of detail; a place's population is the count of its living people; and a child with the right parents or traits can rise to a figure and a talking NPC.

> **Changed by [N26 Part E](n26-the-open-road.md#part-e-everyone-on-the-road-is-someone-rework-asked-for-2026-10-14) (2026-10-14):** migration becomes a journey. Households **depart** (marked `away`, still counted at the old place) and **arrive** days later, when the move is applied. The choice of destination also weighs kin already there, work, safety and law. People also make round trips (market, kin, work, pilgrimage), so a person can be away from home without leaving it.

**Read first:** [plans README](README.md) sections 2 (determinism: per-person streams), 5 (**a year is 48 days**, from N30 step 1; it was 12 when this was built), 6 (person refs), 9 (performance). Needs N18 (people in SQLite, materialised at world creation, batch writes). Use N22's `sim:years` to tune it.

## What exists

- **People rows** (N18): `people` with `born_day`, `cls`, `job`, `home`, `work`, `master`, `faction`, `mother`, `father`, `spouse`, `figure`, `persona`, `traits`, `death`, all filled once at world creation from `rosterFor`.
- **The cast's family rules** ([`family.ts`](../../../packages/server/src/game/family.ts)): `canCourt`, `wed`, `inherit(a, b, rng)` (traits and talents from two `ParentStock`s), `makeChild`, `childhood`, `adulthood`, `familyNight` (nightly: courtships grow, marriages, conception, births), config in `config.family` (courtship nights 6, max age gap 15, courting 2 years after adult, conception 0.15/night, pregnancy 9 days, rest 12 days, max 3 children, cast cap 14).
- **Life rules** ([`life.ts`](../../../packages/server/src/game/life.ts)): species age bands (`adultAge`, `elderAge`, `maxAge`), `ageStage`, `dailyDeathChance(species, age)`, `liveDay`.
- **Realm figures** age and die (`ageFigures` in [`realm/figures.ts`](../../../packages/server/src/game/realm/figures.ts)), with free-text `deathCause`; `killFigure`; `bury(s, n)` in [`realm/military.ts`](../../../packages/server/src/game/realm/military.ts) just lowers a settlement's population number for nameless dead.
- **Population today is a number** the economy changes ([`realm/economy.ts`](../../../packages/server/src/game/realm/economy.ts) `economyDay`): starvation removes 1.5%, growth adds `GROWTH × prosperity/50`, settlements grow into the next kind (`KIND_POPULATION`), tiny ones are abandoned and their people move.
- **Rising** ([`realm/rise.ts`](../../../packages/server/src/game/realm/rise.ts)): N13's rules for a commoner on Millbrook's map to become a named figure, then a talking NPC (`personaFor`, `TALKER_RENOWN = 30`).
- **Map houses depend on population:** [`sites.ts`](../../../packages/server/src/web/sites.ts) line ~404: `houses = max(2, ceil(population / PER_HOUSE[kind]))`. A growing town gets a different map.
- **Death records for the cast:** [`deaths.ts`](../../../packages/server/src/game/deaths.ts) `DeathRecord { npcId, name, day, hour, killedBy }`; `saves/deaths.json` makes deaths permanent across restarts.

## Decisions made in this plan

1. **Level of detail never changes outcomes.** This is the central rule. A person's life step for a day is a pure function of `(world seed, person id, day, the person's row, the place's conditions that day)`, using `streamFor(seed, "life", personId, day)`. Full, coarse and lazy differ only in *when* the step is computed and how finely its timing is shown:
   - **Coarse** (default for every place): once per game day, in a batch, for every living person.
   - **Full** (the player's site and pinned people's sites): the same daily step, but its events get an hour (drawn from the same stream) and are recorded at that hour, so they can be witnessed; plus anything hourly that only matters when seen (N36 moods, N33 chatter later).
   - **Lazy catch-up:** a place not stepped for a while runs its missed days in order on demand, reading each day's stored conditions. Same function, same streams, so the result is identical to having run it daily.
2. **Build coarse-for-everyone first, measure, then add lazy only if needed.** 25,000–50,000 people × a cheap daily step is likely 20–60 ms per game day, and a game day is many real minutes. If N19's `dayCoarseMs` holds with everyone coarse, lazy catch-up is only needed for big time skips (N35) and `sim:years`. Build the lazy path anyway (it's the same function in a loop), but switch places to it only when the budget says so. Test equivalence either way.
3. **Place conditions are stored per day.** Deaths depend on famine, raids, war and illness at a place on a day. `realmDay` writes a tiny row per settlement per day: `site_days(site, day, food, raided, besieged, at_war, plague, beasts)` (N61 adds illness). Lazy catch-up reads it. Prune rows older than the oldest place that still needs catching up.
4. **Cross-place moves are decided in the realm step, not in catch-up.** Migration (and marriage between places, refugees) is decided once a day for the whole realm, by household, before people's own steps, and applied to both places' rows immediately. Catch-up only ever handles what stays within a place. That removes order dependence.
5. **Population is derived.** `settlement.population` becomes a cached count of living people with `site = id`, refreshed after each day's people step. The economy no longer adds or removes people directly: growth comes from births and arrivals, losses from deaths and departures. The economy's old growth/starvation numbers turn into **rates that feed the life step** (prosperity raises the birth rate; low food raises the death rate and the urge to move). Settlement kind changes still use `KIND_POPULATION` on the derived count.
6. **Houses are buildings, not a population formula.** Freeze each place's house count into the realm (`settlement.houses`), set at generation from today's formula. The map draws exactly that many houses. New houses come from building (a `houses` project in the economy when crowding is high), so a map only changes when a house is built, and new houses are appended so existing house indexes never shift. A person's `home` is a stable house index. Crowding (people per house) is a condition that slows births and pushes people to move.
7. **One typed death record for everyone.**
   ```ts
   export const DEATH_CAUSES = ["old-age", "illness", "famine", "battle", "siege", "raid", "execution", "murder", "beast", "accident", "childbirth", "missing"] as const;
   export interface DeathRecord { cause: DeathCause; day: number; hour?: number; site: string | null; event?: string /* ref */; killer?: string /* person ref */; note?: string }
   ```
   `missing` is a state, not a death: a person can be `missing` and turn up later (N55's war missing). Figures' free-text `deathCause` becomes this type (keep `note` for the old words). The cast's `DeathRegistry` records gain `cause` and `site`. `bury(s, n)` disappears: raids and battles pick real people to die (step 6).
8. **Who's eligible to marry and how matches are made.** Per place, once per game day, in code: single adults of courting age (species `adultAge + config.family.courtingAfterAdult`), never minors, never close kin (parents, siblings, grandparents: check with `mother`/`father` up two generations). Score = class closeness (same class 1.0, one rank apart 0.4, more 0.05) × age closeness (gap ≤ `maxAgeGap`) × existing relationship (once N33/N37 fill relationships) × faction friendliness. Pick with the person's stream. A cross-class match (rank gap ≥ 2) records a `marriage` event with importance raised (gossip, N33). Slaves and serfs marry by their kingdom's laws (`kingdomLaws`): a slave's marriage needs the master's leave (a roll weighted by the master's traits), and children of slaves are slaves where the law says so.
9. **The cast's family stays separate for now.** N11's cast families (`world.family`) keep their nightly rules. A cast member may marry a townsperson later; for N25, keep the two pools apart but share the rule functions (`inherit`, age checks, kin checks) by moving them into `game/people/rules.ts` used by both.

## Data shapes

```sql
-- in N18's schema (add if missing)
ALTER TABLE people ADD COLUMN expecting TEXT;     -- JSON { father, due_day } or NULL
ALTER TABLE people ADD COLUMN last_birth INTEGER;
ALTER TABLE people ADD COLUMN stepped_day INTEGER NOT NULL DEFAULT 0;   -- last day this person's life step ran
CREATE TABLE site_days (site TEXT, day INTEGER, data TEXT, PRIMARY KEY (site, day));
CREATE TABLE lineage (child TEXT PRIMARY KEY, mother TEXT, father TEXT);   -- optional mirror for fast tree walks across kinds
```

`traits` JSON for townsfolk: a small subset that matters to rules (`ambition`, `loyalty`, `greed`, `bravery` like figures; plus `potential` tier). Keep it under ~100 bytes per person.

## The daily step, in order (for one game day)

`worldDay(world, store, day)` (from N22) runs:
1. **The realm day** (`realmDay`): economy (now rate-only for population), taxes, factions, director, raids, wars, packs, dungeons. Raids, battles and beasts no longer lower population by a number; they record **casualty orders** `{ site, cause, count, event ref, killer? }`.
2. **Write `site_days`** for every settlement from the realm's state after step 1.
3. **Realm-wide moves** (decision 4): migration by household from places with bad conditions (food, crowding, war, raids) toward better ones within reach (`neighbours`, `travelDays`), refugees from war, abandoned settlements emptying. Choose households with `streamFor(seed, "migrate", site, day)`; update `site`, `home` (a house with room at the destination, else crowded), and record one `migration` event per household (importance by size).
4. **Casualties:** for each casualty order, pick the dead among the place's people, weighted by role (raids kill fighters and the unlucky; famine kills the old, the young and slaves first; beasts kill farmers and hunters out in the fields), deterministic with `streamFor(seed, "casualty", eventRef)`. Each gets a `DeathRecord` with the event ref and killer.
5. **People steps** for each place due (all places when everyone is coarse): for each living person in id order:
   - **Birthday:** age = `floor((day - born_day) / daysPerYear)`; on a birthday, update stage; a child at `adultAge` comes of age (job assigned from their parents' class and the place's needs; leaves the parents' house if crowded).
   - **Death roll:** `dailyDeathChance(species, age)` × condition multipliers from `site_days` (famine ×3 for the old and young, plague later, crowding ×1.2), floor 0; cause by which factor dominated.
   - **Pregnancy:** if `expecting.due_day === day`: birth (step 6). Else, for a married woman of child-bearing age with room (`last_birth + restDays`, fewer than `maxChildrenPerCouple` with this spouse, the household not over crowding): conception chance per day (config, scaled by prosperity).
6. **Births:** a new person row with id `t_<site>_<next n>` (append; `n` = the place's max + 1, kept in a `site_seq` counter, never reused), `born_day = day`, `mother`, `father`, class by law (usually the parents'; a free mother's child is free in a slave kingdom unless the law says otherwise: keep it in `kingdomLaws`), `traits` by `inherit()` from both parents' rows, home = parents' house. Record `birth` event (importance higher for notable parents).
7. **Marriages:** decision 8, per place.
8. **Rising:** decision 10 below.
9. **Population counts:** recount living people per site; update `settlement.population` and kind.
10. Flush (N18).

### Rising (decision 10)
- Each day, for people who came of age today, or whose traits/potential are high, or whose parent is a figure or a talking NPC: run N13's rise test (`rise.ts`'s rules, generalised from Millbrook's map to any place): a high-potential youth of a notable house becomes a **figure** (`makeFigure` with their name, home, parents' figure ids); a figure who passes `TALKER_RENOWN` becomes a **talking NPC** through `personaFor` with their parents named in their file.
- Keep both links: `people.figure`, `figures[f].person = personId`, and the persona's `parents`. The admin view (N17) traces lineage across kinds with the people facade.

## Steps

### Step 1: rules module and death records
- `server/src/game/people/rules.ts`: move shared pure rules out of `family.ts` (age-from-born-day, courting age, kin check up two generations, `inherit` wrapper for rows). Keep `family.ts` working through them (its tests must pass unchanged).
- `DeathRecord` type and `DEATH_CAUSES` in `game/people/death.ts`; convert `Figure.deathCause` (schema: `death: DeathRecordSchema.optional()`; v11 is a clean break, so no migration) and `DeathRegistry` records.
- Test: kin check refuses siblings and grandparents; `DeathRecord` schema accepts each cause.

### Step 2: houses frozen, homes stable
- `settlement.houses` set at generation (today's formula); `siteMap` draws exactly `houses` houses, appended in a stable order; a `houses` building project in the economy when people per house passes a limit.
- Test: the same settlement with a higher population draws the same houses (same indexes) until a house is built; a built house is appended.

### Step 3: the people step (coarse), births, deaths, ageing
- `game/people/day.ts`: `peopleDay(store, world, site, day)` implementing birthdays, the death roll, pregnancy and births; per-person streams; id-ordered.
- `site_days` written by `realmDay`.
- Test: a place of 200 for 120 days (10 years): people age (a 30-year-old is 40), births and deaths happen at plausible rates (bounds below), every birth has two living-or-dead parents in the table, nobody marries or conceives under age.

### Step 4: marriage
- Daily per place matching (decision 8), with the law checks.
- Test: over 10 years most adults of courting age marry; cross-class matches are rare (< 5%) and each records a `marriage` event with raised importance; no kin marriages; slave marriages follow the law.

### Step 5: the realm stops counting heads
- Economy: replace direct population changes with rates the life step reads (birth multiplier from prosperity, death multiplier from food, move push from food/crowding/war). Remove `bury`; raids/battles/beasts emit casualty orders (step 4 of the daily order).
- `settlement.population` = derived count.
- **Balance:** run `sim:years` (N22) and adjust rates until bounds hold. Add N25's bounds (below). Expect this to take a few iterations; record the chosen numbers and why in comments.
- Test: population figure equals `SELECT COUNT(*) FROM people WHERE site = ? AND death IS NULL` for every settlement, every day of a 120-day run.

### Step 6: casualties and typed deaths
- Casualty picking (weighted by cause), death records with event refs and killers; `death` events (importance by renown) so news and gossip carry them; a famine at a place kills people of that place (test).

### Step 7: migration as people
- Realm-wide household moves (decision 4), refugees from war, abandoned settlements emptying into neighbours. Record `migration` events.
- Test: a famine at one village moves households (whole families: spouse and minor children go together) to a better neighbour; the counts match on both sides.

### Step 8: rising
- Generalise `rise.ts` from Millbrook's map to any person row; links both ways; persona with parents.
- Test (fixed seed): within 10 years, a person born in play becomes a figure and then a talking NPC whose persona names both parents; the admin card shows their lineage.

### Step 9: full detail and lazy catch-up
- Full detail: events from the player's site get an hour from the same stream, recorded at that hour while the player is there (so they're witnessed).
- Lazy: `catchUp(site, toDay)` runs `peopleDay` for each missed day using `site_days`; `stepped_day` per person makes it resumable.
- **Equivalence test** (the most important test in this phase): world A runs every place coarse daily for 60 days; world B runs one village lazily (only caught up at day 60); after day 60 both villages' rows (and the hash) are identical. Same for full detail vs coarse: the same births and deaths on the same days.
- Turn lazy on for places only if N19's budget needs it (decision 2).

### Step 10: perf, docs
- Time `peopleDay` for the whole realm (N19's `dayCoarseMs`); time a year of catch-up for a capital (`yearCatchupMs`); a frame check that the capital still runs at 60 fps (N19's frame proxy plus the manual check: more people means more drawn).
- README: townsfolk now live; where to see it (admin view: a village's population over time, a person's family tree).

## N25's balance bounds (add to `balance/bounds.ts`)

- `births-and-deaths`: over each year after year 1, births per 1,000 people and deaths per 1,000 people are each within a band (start from the measured rates).
- `age-pyramid`: share of children, adults, elders each within a band (no "everyone is 80").
- `marriage-rate`: share of adults of courting age who are married within a band.
- `count-matches-population`: settlement population equals living people, always.
- `no-empty-capitals`: no capital drops below a floor.

## Edge cases and traps

- **Minors.** Never in courting, marriage or conception pools (`config.content` rules apply to townsfolk too). Test explicitly.
- **Incest checks across kinds.** A townsperson's parent may be a figure or a cast NPC; the kin check must walk the facade, not just `people.mother/father`.
- **Iteration order** (README section 2): always `ORDER BY id` (or `n`) when stepping a place, matching, or picking casualties.
- **A dead person in a pinned view or a talking NPC:** when a person who is also a persona dies, the persona dies too (DeathRegistry), and vice versa (an NPC killed in play marks the row dead with cause and killer).
- **Talking townsfolk stay in sync** with their row: age, spouse, children, job, death. Their persona reads from the row each time it's built.
- **Map crowd:** dead people vanish from the crowd and newborns appear at home (children under ~3 stay indoors, `CrowdSim` already keeps young children close). The roster cache per site must refresh when the day's step changed it.
- **Big skips:** a 10-year catch-up of a capital at once could take a second; show a "time passes…" indicator and keep it under N19's `yearCatchupMs` per year.
- **Old-age certainty:** `dailyDeathChance` is certain at `maxAge`; make sure the multiplier can't push a chance above 1 or below 0.

## Tests (`packages/server/tests/n25.test.ts`)

Listed with each step above; the done-when ones:
- 10 simulated years (120 days) for a village: people age, marry, have children and die; population equals the living roster every day.
- A born townsperson rises to a talking NPC with their parents in their file (fixed seed).
- A famine kills people in the place it struck (death records with cause `famine`, site = that place).
- Equivalence: coarse vs lazy vs full give the same hash.
- The capital still runs within the frame budget (proxy test) with its grown population.

## Done when (mapped)

| Done-when clause | Proved by |
|---|---|
| over 10 simulated years a village's people age, marry, have children and die | step 3/4 tests, 120-day run |
| the population figure equals the living roster | step 5 test + `count-matches-population` bound |
| a born townsperson rises to a talking NPC with their parents in their file | step 8 test |
| a famine kills people in the place it struck | step 6 test |
| a capital still runs at 60 fps | N19 frame proxy + manual check |

## Realism notes (2026-10-23)

From the [realism review](../README.md#realism-gaps-review-2026-10-23); not decided or built yet.

- **Gap 1, one 48-day year (decided 2026-10-23):** lives slow 4× in game days. The yearly rates follow `daysPerYear`, but daily ones (`LIVES.conception`, `seeking`, `famineDaily`, pregnancy and rest days) must be retuned with `sim:lives` when N30 step 1 switches the year (plans README §5).
- **Gap 3, health:** townsfolk rows are alive or dead; only the player and the cast carry N8.1's injuries and illness (`game/health.ts`). A follow-up should give rows a compact health state built on the same `INJURIES`/`ILLNESSES` tables (ill, injured, lasting marks), caught by age, season and place (crowding, famine), most of it passing; some changes work and the death roll. N61 layers epidemics on top of this, not beside it.
- **Gap 4, child deaths:** townsfolk already allow 6 children (`LIVES.maxChildren`; the cast's 3 is a memory cap), but `LIVES.yearly` infant 0.035 and child 0.006 mean few children die. Raise the infant and child bands so roughly a third to half die before adulthood in poor places, and retune conception so the population bound still holds. Grief, heirs (N45) and feuds read from this.
- **Gap 5, marriage between places:** the realm step allows it but sets no rate. Add a pull for matches outside the place when few eligible partners are left (scaled by distance and kin at the other place), and forbid close kin (parents, siblings, first cousins by default; a culture policy later, N53).

## Slice cut

For the slice: steps 1–6 and 9 for **Millbrook and its neighbour** (the rest of the realm keeps today's population numbers behind a flag `PEOPLE_LIVE=slice`); migration (7) only between the two; rising (8) can wait. Make the flag a list of site ids so widening to the whole realm is a config change, not a code change.

## Out of scope

Cast-and-townsfolk marriages (later). Gossip about marriages (N33 carries the events). Illness spreading (N61). War details on death records (N55).
