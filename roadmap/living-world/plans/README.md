[← Living world overview](../README.md) · [Stage 1](../stage-1-foundations.md) · [Stage 2](../stage-2-everyone-lives.md) · [Stage 3](../stage-3-npcs-choose.md) · [Stage 4](../stage-4-society.md) · [Stage 5](../stage-5-power-and-conflict.md) · [Stage 6](../stage-6-a-changing-world.md) · [Stage 7](../stage-7-the-player-in-the-world.md)

# Implementation plans, N17–N68

Written 2026-10-13 (N17–N28) and 2026-10-14 (N29–N68). These are build guides for every phase of the living world track, for a coding agent (Sonnet, Opus) or a person picking up a phase cold. The stage files say **what** each phase is and when it's done. These plans say **how**: what exists now, which files to touch, the data shapes, the order of steps, the traps, and the tests that prove it.

Read this page first. It holds the rules every phase shares; the phase plans assume them and don't repeat them. Sections 1–10 are for every phase; sections 11–20 were added with the N29–N68 plans and hold the building blocks those phases share (read them before any phase from N29 on).

**Migration for built code:** [one 48-day year, an ageless player, quick travel](migration-2026-10-23-one-year-ageless-player.md) (decided 2026-10-23) says what the switch changes in code already built (N6, N11, N25, N25b, N26, N37, N38), in what order, what to retune and which tests break. Do its part A before or with N30 step 1.

**Before N40 (decided 2026-10-23), in this order:** the game track's [G5, a switchable client](../../game/plans/g5-a-switchable-client.md), then [G6, the look](../../game/plans/g6-the-look.md), then the migration's part A (the 48-day clock), alone. Then N40. After G5, a phase that shows something new in the game adds it to the server's frame or UI model (`server/src/view/`), never to client code: the client only draws.

| Phase | Plan | Builds on | Vertical slice? |
|---|---|---|---|
| N17 | [The admin world view](n17-admin-world-view.md) | (nothing new) | ✅ cut down |
| N18 | [Scale and storage](n18-scale-and-storage.md) | N17's hash check | ✅ cut down |
| N19 | [Performance and model-call budgets](n19-performance-and-budgets.md) | N17, N18 | ✅ built, all steps |
| N20 | [Stories, drama and liveness metrics](n20-stories-drama-liveness.md) | N18's event table | |
| N21 | [Callbacks to the player's choices](n21-callbacks.md) | N20, N24 | |
| N22 | [Long-run balance tests](n22-long-run-balance.md) | N18, N20, N25 | |
| N23 | [Sharing worlds](n23-sharing-worlds.md) | N18, N20 | |
| N24 | [Global reporting](n24-global-reporting.md) | N17, N18 | |
| N25 | [Townsfolk lives](n25-townsfolk-lives.md) | N18 | ✅ built (steps 1-10; see the stage file for what differs) |
| N25a | [A world without a centre](n25a-a-world-without-a-centre.md) | N18, N25 (N24 step 2b, or absorbs it) | ✅ before N26 (built) |
| N25b | [Lives that change](n25b-lives-that-change.md) | N18, N19, N25, N25a | ✅ the two towns (built) |
| N26 | [The open road](n26-the-open-road.md) | N18, N19, N25, N25a | ✅ built (all four parts; the whole realm walkable, see the stage file for what differs) · Part E (real travellers, news by people) ✅ built 2026-10-14 |
| N27 | [The wilds](n27-the-wilds.md) | N26 | |
| N28 | [Fauna and flora](n28-fauna-and-flora.md) | N26, N27 | |
| N29 | [A soundscape](n29-a-soundscape.md) | N16, N26 (N28, N36 when built) | |
| N30 | [Seasons and the farming year](n30-seasons-and-the-farming-year.md) | N25, N26 | |
| N31 | [Visible consequences on the map](n31-visible-consequences.md) | N25, N30 | |
| N32 | [Interiors and homes](n32-interiors-and-homes.md) | N16, N18, N31 | |
| N33 | [Gossip for everyone](n33-gossip-for-everyone.md) | N18, N24 (stub), N25, N26 | ✅ built 2026-10-14 (all steps; N24 steps 1 only as its step 0) |
| N34 | [Following people in the game](n34-following-people.md) | N24, N33 | |
| N35 | [Moving through time](n35-moving-through-time.md) | N26, N34 | |
| N36 | [The mood of a place](n36-the-mood-of-a-place.md) | N20 (causes), N25b | |
| N37 | [Chatter with consequences](n37-chatter-with-consequences.md) | N25b, N33 | ✅ built 2026-10-14 (all steps; schema 7, save still v15) |
| N38 | [NPCs as living players](n38-npcs-as-living-players.md) | N18, N19, N37 | ✅ built 2026-10-22 (all steps; no save or schema bump) |
| N39 | [The first hour](n39-the-first-hour.md) | N33, N37, N38 | |
| N40 | [Ambitions and careers](n40-ambitions-and-careers.md) | N38 | ✅ slice |
| N69 | [Offices, treasuries and renown](n69-offices-treasuries-and-renown.md) | N37, N38 (with N40) | planned 2026-10-22; build right after N40 |
| N41 | [Leisure and contests](n41-leisure-and-contests.md) | N37, N38, N40 | |
| N42 | [A shared quest market and adventurer grades](n42-shared-quest-market.md) | N38, N40 | |
| N43 | [Items with a history](n43-items-with-a-history.md) | N20, N33 | |
| N44 | [A nemesis](n44-a-nemesis.md) | N37, N38, N40, N42 | |
| N45 | [Family feuds and inheritance](n45-family-feuds-and-inheritance.md) | N25, N37, N40 | |
| N46 | [Secrets, spies and blackmail](n46-secrets-spies-and-blackmail.md) | N33, N38, N45 | |
| N47 | [The underworld](n47-the-underworld.md) | N38, N46 | |
| N48 | [Law and trials](n48-law-and-trials.md) | N45 (law book), N46, N47 | |
| N49 | [Setbacks instead of game over](n49-setbacks-instead-of-game-over.md) | N48 | |
| N50 | [Belief](n50-belief.md) | N33, N38, N48 | |
| N51 | [Magic](n51-magic.md) | N48, N50 | |
| N52 | [Shaping what people believe](n52-shaping-what-people-believe.md) | N33, N46, N48, N50 | |
| N53 | [Cultures and languages](n53-cultures-and-languages.md) | N30, N33 | |
| N54 | [Peoples and monsters](n54-peoples-and-monsters.md) | N13, N27, N53 | |
| N55 | [Armies, soldiers and the war dead](n55-armies-soldiers-and-the-war-dead.md) | N25, N26, N40 | |
| N56 | [Grievances and uprisings](n56-grievances-and-uprisings.md) | N37, N38, N55 | |
| N57 | [Player-led factions](n57-player-led-factions.md) | N38, N56 | |
| N58 | [Kingdoms react to unrest](n58-kingdoms-react-to-unrest.md) | N33, N48, N56 | |
| N59 | [Runaways and liberation](n59-runaways-and-liberation.md) | N26, N27, N56, N58 | |
| N60 | [Ecology](n60-ecology.md) | N28 | |
| N61 | [Epidemics](n61-epidemics.md) | N25, N33 | |
| N62 | [Disasters](n62-disasters.md) | N30, N31 | |
| N63 | [Exploration, roads and new settlements](n63-exploration-roads-and-new-settlements.md) | N26, N27, N60 | |
| N64 | [New kingdoms](n64-new-kingdoms.md) | N56, N59, N63 | |
| N65 | [The player's view](n65-the-players-view.md) | N24, N34 | |
| N66 | [The player's own life](n66-the-players-own-life.md) | N32, N40, N45 | |
| N67 | [NPCs come to you, and reputation by place](n67-npcs-come-to-you.md) | N33, N38 | |
| N68 | [Legends, songs and the realm's history](n68-legends-songs-and-history.md) | N20, N33 | |

The vertical slice (see the [overview](../README.md#milestone-the-vertical-slice)) builds N17 → N18 → N25 → N25a → N25b → N26 → N33 → N37 → N38 → N40 first, for the start town, its liege town and the road between. Each plan has a **Slice cut** section that says what that phase needs for the slice and what waits.

---

## 1. Old saves are thrown away (user decision, 2026-10-13)

The user said older saves don't matter. So:

- **N18 starts save version 11 as a clean break.** `loadWorld` sees `version < 11` and does **not** migrate: it renames the file to `world.v<old>.bak.json` (rename, don't delete, so nothing is lost by accident), resets `world.db` (`WorldStore.reset()`), and starts a new world. The player sees one line: "Your old save is from an older version; a new world has begun (the old file is kept as …)."
- **Delete the upgrade chain** in [`save.ts`](../../../packages/server/src/game/save.ts): `upgradeMoney`, `moveMoney`, `scale`, `COPPER_PER_OLD_GOLD`, the `raw.version < N` branches in `upgradeSave`, and the tests that load old fixtures (look in `tests/save.test.ts` and the `nX.test.ts` files for "older save" tests). Keep the history comment on `SAVE_VERSION`; add "11: clean break, older saves are set aside (N18)".
- **From v11 on, migrations are real again.** Every later save change bumps the version and adds a migration with a test from v11. "Throw away old saves" is a one-time decision, not a habit.
- **The roadmap's save items change:** N18's "tested from every past version (v10 onward)" and N25's "an older save keeps its people" are struck in the stage files.
- Because of the clean break, **design the schema for later phases now** where it's cheap: N18 adds the columns N20 (`caused_by`, `why`) and N24 (`site`, `kingdom`) need, so they don't each cost another version.

## 2. Determinism: a seed gives the same world, always

Every plan leans on this. Today it doesn't fully hold, and N18 fixes it before anything else is built on top.

**What's wrong today:**
- One RNG stream feeds everything: `Town` holds `this.rng` (defaulting to `Math.random`, [`town.ts:137`](../../../packages/server/src/game/town.ts)) and passes it to `advanceRealm`, `breedCreatures`, `familyNight` and the rest. Add a single roll anywhere and every later roll in the day changes. Lazy catch-up (N25) and replays (N23) can't work like that.
- `recordEvent` makes ids from `Date.now()` ([`events.ts`](../../../packages/server/src/game/events.ts)), so the same run gives different ids.
- `Math.random` and `Date.now()` are also used in `server.ts`, `cli.ts`, `NpcAgent.ts`, `save.ts` and `tts.ts`.

**The rule from N18 on:**
- **Named streams.** Add `streamFor(seed: number, ...keys: Array<string | number>): Rng` to [`dice.ts`](../../../packages/server/src/game/dice.ts): `seededRng(seedFrom([seed, ...keys].join(":")))`. Every system takes its own stream per day: `streamFor(realm.seed, "realm", day, "packs")`, per person where it matters: `streamFor(seed, "life", personId, day)`. Adding a system then can't change another's rolls.
- **No wall clock in the simulation.** `Date.now()` is allowed only for real-time things (time flowing in the browser, perf timers, the combat timer, log timestamps). Never in an id, a roll or anything saved that the simulation reads.
- **Deterministic ids.** Events: `e<day>-<hour>-<seq>`, where `seq` is a counter in the save (`world.nextEventSeq`). Same for any new id (stories, journeys, people born in play).
- **Stable iteration order.** `Object.values(record)` follows insertion order, which differs after a load if anything was inserted in a different order. Where order changes outcomes (who gets matched, who dies first), sort by id first.
- **The model's words never decide.** If a model call's result changes state (a faction's name does; a chronicle line doesn't), the result is recorded (N23's input journal) so a replay doesn't need the model.
- **Check it with a hash.** N18 adds `worldHash(world, store)`: sha256 of canonical JSON (sorted keys) of the save plus sorted dumps of the database tables that hold state. Tests run the same seed twice and compare hashes. N17 uses it to prove the admin view changes nothing; N22, N23 and N25 use it everywhere.

## 3. Truth and knowledge are two different views

- **The truth:** what really happened. The event log, the realm, the people table. The admin view (N17) shows it.
- **What someone knows:** each NPC's `knownBy` on events, lore, rumours (today), and the player's own knowledge (N24 adds `player.known`). The player's feed, journal and map only ever show the player's knowledge.
- Never let a player-facing feature read the truth directly. Every player-facing query goes through one function (`playerKnows(ref)`, N24). Tests assert a far event is invisible to the player until its news arrives.

## 4. Code decides, the model only writes words

Unchanged from every phase before. For these twelve phases the model writes, at most: story titles and summaries (N20), how an NPC phrases a callback (N21), place and POI names (N27, through the invented-name check in [`realm/director.ts`](../../../packages/server/src/game/realm/director.ts) `inventedWords`), and flavour text. Each has a **template fallback** that works with the model off (`DIRECTOR=off`, `PLANNING=off`), and tests run with the model off. N19's budget can turn any flavour call into its fallback at any moment, so no feature may *depend* on the model answering.

## 5. Time: one clock, a 48-day year

Decided 2026-10-23 ([realism gap 1](../README.md#realism-gaps-review-2026-10-23)): `config.daysPerYear` becomes **48** (it was 12), with four **12-day seasons**. One clock for everything: weather, the farming year, festivals, travel, news, armies, ageing, births, careers, how fast grudges fade. So "10 years" in a done-when is **480 game days**, a season is 12 days, a pregnancy is 36 days and a generation (~20 years) is ~960 days. Keep every rule in `config.daysPerYear`, never a literal 12, 48 or 365. When a plan says "a year", compute it. (Two clocks, a 48-day calendar beside a 12-day life year, were considered the same day and dropped: ages and dates would disagree.)

What it means:

- **Lives are 4× slower in game days.** Generations turn over through **time that passes faster where nothing happens**: sleeping skips the night, fast travel and "wait until" skip empty days (N35), and N35's **"the years pass"** skip runs a season or a year at once on N25's lazy catch-up. The player doesn't age (section 5a), so they can watch generations come and go.
- **Retune what is stated per day.** Rules stated per year and turned into daily chances (`people/rates.ts`, `life.ts` `dailyDeathChance`) follow `daysPerYear` on their own. Rules stated per day don't: `LIVES.conception`, `seeking`, `famineDaily`, `config.family.pregnancyDays` (9 → 36) and `restDays` (12 → 48), `courtshipNights`, and anything in N37/N38 counted in days. Grudge and relationship fades (`chatter/grievance.ts`, `chatter/rel.ts`) are in years, so they last 4× longer in days: check that's wanted. The "season = daysPerYear / 4" windows in `chatter/bounds.ts` and `choice/bounds.ts` become 12 days; retune those bounds. Rerun `npm run sim:lives` until N25's bounds hold.
- **Long tests run 4× more days** (N22: a 10-year, 10-seed run is 4,800 realm days); at N25's 20–60 ms a coarse day that's still a few minutes, nightly rather than per commit.
- ✅ **Built 2026-10-23**, alone, after G6 and before N40, following the [migration guide](migration-2026-10-23-one-year-ageless-player.md) part A ([what was done](migration-2026-10-23-one-year-ageless-player.md#what-was-done-2026-10-23)). No save bump of its own (old saves are disposable, section 1; a save from before just has older people than it should).
- **How to state a rule:** something that happens so many times a year is stated over the year and taken a day at a time with `weather.ts` `dailyChance(yearly)` (a chance) or `perDay(perYear)` (an amount); a season is `seasonDays()`. Stories told in days (a war, a journey, how long news is told) stay in days.

### 5a. The player doesn't age, and comes back from death

Decided 2026-10-23 (built code: [migration guide](migration-2026-10-23-one-year-ageless-player.md) part B). The player has no age and never dies of age. When they die (a fight, the law, nature) they comes back: they wake a day later where they last slept (home, an inn) or at a temple (N50 can make it a shrine of their faith), at low HP; what they carried stays where they fell, for others to take or for them to recover; and people who saw them die talk about it ("came back from the dead"), which can make them feared or revered. N49's setbacks (capture, ransom, prison, slavery) still come first where someone would rather keep them alive. `PLAYER_DEFEAT=permadeath` stays as an option. There is no heir handover (N66); the player's children grow up as people like any other.

Clock: `world.day`, `world.hour`, `world.minute`. A game minute passes every 2 real seconds while the player stands about (`TIME_FLOW_SECONDS`); a step on a map is a game minute (`MINUTES_PER_STEP`). The realm runs a day at a time (`realmDay`).

## 6. One way to name a person

Three kinds of people exist today, with three id styles:

| Kind | Id | Lives in | Example |
|---|---|---|---|
| The cast (talking NPCs from files, born in play, risen, visitors) | persona id | `npcStates`, `family.born`, `risen`, `visitors` | `brena`, `t_millbrook_12` once spoken to |
| Realm figures (notables, rulers, beasts with names) | figure id | `realm.figures` | `f_123` |
| Townsfolk (N16) | `t_<site>_<n>` | rolled by `rosterFor`, not saved | `t_thornby_841` |

N18 moves townsfolk into SQLite and N25 makes them live. From N18 on, add one facade, `server/src/game/people/index.ts`: `personRef(id)` → `{ kind, id }`, `getPerson(ref)`, `nameOf(ref)`, `isAlive(ref)`, `placeOf(ref)`. Everything new (admin search, pins, stories, death records, lineage) speaks in person refs through it, not in one of the three stores directly. Don't merge the stores in these phases; it isn't needed and it's a big risky change.

## 7. Where code goes

- [`server.ts`](../../../packages/server/src/web/server.ts) is 1,571 lines with routes as an `if` chain. **Don't grow it.** New routes go in `packages/server/src/web/routes/<area>.ts` as `(req, res, ctx) => boolean` handlers (true = handled), called from one line in the `if` chain. `ctx` gives read access to `world`, `town`, `store`. Move nothing old unless the phase needs it.
- New server areas: `server/src/admin/` (N17), `server/src/store/` (N18's people tables; leave `game/db.ts` for events and memories), `server/src/metrics/` (N19, N20), `server/src/stories/` (N20, N21), `server/src/game/people/` (N25), `server/src/game/road/` (N26, N27), `server/src/game/nature/` (N28).
- **Shared code** (anything the browser must compute the same way: chunk generation, wildlife placement, a traveller's position at a time) goes in `packages/shared/src/`, exactly like [`crowd.ts`](../../../packages/shared/src/crowd.ts). Pure functions of (seed, data, time). The server is still the authority: it re-computes and checks anything the client claims.
- **Shapes sent over the wire** go in `packages/shared/src/protocol.ts` or a new `shared/src/admin.ts`, typed, so client and server can't disagree.
- **Data** (species, roadside situations, balance bounds) is JSON in `server/src/data/<kind>/` with a zod schema, checked by `npm run check-npcs` (extend [`check-npcs.ts`](../../../packages/server/scripts/check-npcs.ts)) so CI catches a bad file.

## 8. How to work through a phase (for an agent)

1. Read the stage file's section for the phase, then its plan here, then every file the plan's **What exists** names. Don't start writing until you've read them; the plans name real functions, but the code may have moved since 2026-10-13. If a name in a plan no longer exists, find what replaced it before going on.
2. If the plan has **Questions for the user**, ask them first, unless the stage file's **Open decisions** already answers them.
3. Build in the plan's step order. Each step is sized to be one commit that leaves `npm run typecheck` and `npm test` green. Don't batch steps.
4. Write the step's tests with the step, not at the end. Tests are deterministic: fixed seeds, `DIRECTOR=off`, `PLANNING=off`, a stub LLM (`FakeProvider` in [`tests/helpers.ts`](../../../packages/server/tests/helpers.ts) returns canned replies; add a `NoModelProvider` there that throws, for code that must make no call).
5. Never weaken an existing test to make a step pass. If an old test really is wrong now (it tests save migration, which N18 deletes), delete it on purpose and say so in the commit.
6. Finish with the **Done when** check, ticked in the stage file (`[x]`, `[~]` for partly), the phase's status line, the ROADMAP.md status row, and README.md's "what NPCs can do" if players see something new. Write a **How it's built** paragraph under the phase in the stage file, like N14–N16 have.
7. **No site is special and nobody is hand-written** (from N25a): never compare a site id to a constant; every place and person is generated; test people are picked by job, not by name.
8. Play it. Anything a player sees gets checked in the browser (`npm run web`), not just in tests. Say what you saw.

**Commands:** `npm run typecheck`, `npm test`, `npm run check-npcs`, `npm run build`, `npm run sim:realm`, `npm run bench`, `npm run web`. CI runs typecheck, check-npcs, build and test ([`ci.yml`](../../../.github/workflows/ci.yml)).

## 9. Performance on the target machine

The game runs on an **M2 with 8 GB**, with one 3–4B model (`qwen3:4b-instruct`, 3.5 GB loaded) and maybe Piper. Memory is the tight resource. Rules of thumb for these phases:

- Never hold every person's full state in memory when only one place is being looked at. 50,000 small rows is fine in SQLite; 50,000 objects with nested arrays in the Node heap is ~100 MB and a slow `JSON.stringify`.
- Per-tick work must be O(people in view) at full detail and O(people) with a tiny constant at coarse detail. Anything O(people²) (matching, gossip pairs) is bucketed by place first.
- Anything the browser draws must come from data it already has (a roster, a seed, the clock) and shared code, not from per-step messages. N16's crowd is the model to copy.

## 10. Testing patterns

- One test file per phase: `packages/server/tests/n17.test.ts` … `n28.test.ts`; client logic in `packages/client/tests/`, shared logic in `packages/shared/tests/`.
- Each **Done when** clause becomes at least one test, named after the clause, so a reader can map them.
- Perf tests: take the median of a few runs and multiply the budget by `PERF_SLACK` (default 1, CI sets 3). They must not flake.
- Long runs (years, 50k people) go in `describe.runIf(process.env.LONG === "1")` locally and in a nightly CI job (N22 adds it), with a small version always on.
- Use `worldHash` for "nothing changed" and "same result" checks instead of comparing a few fields.

---

# Part 2: rules for N29–N68

Added 2026-10-14 with the N29–N68 plans. Everything in sections 1–10 still holds. These sections are the building blocks that many later phases share, so they are built once, by the first phase that needs them, and reused after that.

## 11. Where things stand, and the pieces that are missing

**Built (2026-10-23):** N17, N18, N19, N25, N25a, N25b, N26, N33, N37, N38 and N40 (see each stage file's **What differs**). **Not built:** N20–N24 (except `player.known`, `playerKnows` and `playerLearns`, built as N33's step 0 in `game/playerKnowledge.ts`), N27 and N28.

**N26 Part E is built on top of N26 (2026-10-14, save v14)** ([plan](n26-the-open-road.md#part-e-everyone-on-the-road-is-someone-rework-asked-for-2026-10-14), asked for 2026-10-14): every traveller is a real person row (`people.away` while on a journey), migrants arrive on the day their journey does, the messenger relay (`relay.ts`) is deleted, and **news spreads by people**: travellers carry what their place knew when they left (`journey.carries`) and swap it with places at every stop, inns most of all; `reachesAt(news, site)` becomes "the day the place first heard it, or not yet". **The N29–N68 plans assume Part E, which is built.** Where the plans say `SiteState.newsSeen` with a day, read `realm.heard[site][newsId]` (see the stage file's What differs). Where a plan says a journey, a traveller or a carrier, it means a real person on a Part E journey; where it says a place heard news, it means Part E's `newsSeen` day. N33 then makes that knowledge per person instead of per place. Several later plans lean on small parts of those phases. **The rule:** if a phase needs a part that doesn't exist yet, it builds that part (only that part, as written in its own plan) as **step 0**, and says so in the stage file. It doesn't build its own version.

| Missing piece | From | Needed by | Step 0 to build |
|---|---|---|---|
| `causedBy` on every event and realm news, the `withCause(ref, fn)` scope | [N20](n20-stories-drama-liveness.md) step 1 | N36, N37, N43, N44, N45, N56, N58, N68, and every "linked by cause" done-when | N20 step 1 only (the field already exists on `GameEvent`, unfilled) |
| Stories (chains of causes, scored) | N20 steps 2–4 | N68 (legends), N39 (incident hooks), N65 (journal stories) | N20 steps 2–4 |
| `player.known`, `playerKnows(ref)`, `playerLearns(ref, how, from)` | [N24](n24-global-reporting.md) steps 1–3 | N33, N34, N35, N43, N52, N63, N65, N67 | **Step 1 is built** (N33, `game/playerKnowledge.ts`: functions on `PlayerState`, not the table, so `NpcAgent` needs no store; refs are `n:<newsId>`, `d:<personId>`, `e:<eventId>`). Steps 2–3 (`deliverToPlayer`, the feed reading only knowledge) are not. Step 2b is done by N26 Part E. |
| The balance bounds runner | [N22](n22-long-run-balance.md) | every plan's **Balance bounds** list | Until N22 exists, put a phase's bounds in `game/<area>/bounds.ts` returning `Bound[]`, like [`road/bounds.ts`](../../../packages/server/src/game/road/bounds.ts), and check them at the end of a long test run. N22 gathers them into one list later. |
| Points of interest off the road (`pois`) | [N27](n27-the-wilds.md) steps 1–2 | N51 (ley lines, stones), N54 (lairs, warrens), N55 (battlefields), N59 (hidden camps), N62 (mines), N63 (finds) | N27 steps 1–2 |
| Species as data, `wildlifeAt` | [N28](n28-fauna-and-flora.md) steps 1–2 | N29 (animal calls), N60 (ecology) | N28 steps 1–2 |

## 12. Names in the done-whens

Since N25a nothing is authored, so the stage files' names are roles, not things to look up:

| Stage files say | Means | Tests find it with |
|---|---|---|
| Millbrook | the start town | `world.startSite` |
| Highdale | the start town's liege town (a day's walk) | `realm.settlements[start].liege`, or the nearest town above it |
| the Gilded Goose | the start town's inn | the building of kind `inn` on its map |
| the free kingdom | a kingdom with neither slaves nor serfs | `k.laws.slavery === false && k.laws.serfdom === false` |
| the slave kingdom | a kingdom with slavery | `k.laws.slavery === true` |
| Greyfang, Odo, Hale, "the mayor" | generated people of that role | pick by job, role or class, never by name |

The first phase that needs them adds `pickTestPlaces(world)` and `pickTestPerson(world, site, { job | role | cls })` to [`tests/helpers.ts`](../../../packages/server/tests/helpers.ts) and every later test uses them. If a seed lacks the kingdom a done-when needs (say, no slave kingdom), the test searches a short fixed list of seeds for one that has it, and that list lives in the helper.

## 13. The action menu is the spine of Stages 3–7

**Built (N38, 2026-10-22), in `server/src/game/choice/`.** What it looks like as built: `ActionDef.apply(ctx, option, why, host)` returns what the hour needs (`plan`, `sell`, `intent`) and does its deeds through `host.deed(...)` (events, feelings, grievances, goods), so one action serves a talker (`talker.ts`), a townsperson (`day.ts`) and the player (`player.ts`). To add an action: a file in `actions/`, a line in `ACTIONS` (`registry.ts`), its weights in `weights.ts`, a cooldown, a test; give it `habit: [...]` only if it is something the schedule already does. Scores are `scored(["label", value], ...)` so the reason is free. Violent actions say `violent: true`. The rest of this section is the original plan.

N38 builds **one action menu** for talkers, townsfolk and the player. After N38, every phase that adds something people *do* (bet at dice, take a job, blackmail, preach, enlist, run away, seek out the player) adds it as an **action** in that menu. It doesn't add its own little loop. The shape (detailed in the [N38 plan](n38-npcs-as-living-players.md)):

```ts
// server/src/game/choice/types.ts
export interface ActionDef {
  id: string;                         // "work", "gossip", "insult", "take_job", "blackmail", "enlist", "flee_master"…
  grain: "hour" | "day";              // talkers in the active place choose hourly; townsfolk choose daily
  who: "talker" | "townsfolk" | "both";
  violent?: true;                     // behind config.choice.violence
  available(ctx: ChoiceCtx): Option[];          // concrete options ({ action, target?, place?, item? })
  score(ctx: ChoiceCtx, o: Option): Scored;     // { score, parts: Array<[string, number]> } – the parts are the "why"
  apply(ctx: ChoiceCtx, o: Option): void;       // changes state through the normal systems and records an event with `why`
}
```

- Actions live one per file in `server/src/game/choice/actions/`, registered in `choice/registry.ts`, so a phase adds a file and a line.
- A phase that comes **before** N38 (N29–N37) does its work in code rules that N38 later turns into actions. Its plan says which.
- Score parts are named (`"hunger 0.6"`, `"grudge vs t_ashby_12 0.4"`, `"cautious −0.3"`), and the admin view shows them as the reason.

## 14. Kingdom policies: one mechanism for every law

Many phases give kingdoms a rule that a ruler picks, can change, and that play follows: inheritance (N45), crimes and punishments (N48), state faith and persecution (N50), magic per school (N51), how other peoples are treated (N54), levies (N55), the answer to unrest (N58), runaways (N59), and the laws a new kingdom is born with (N64). `laws.slavery`/`laws.serfdom` already exist. **Build one mechanism, in N45, and let the others add keys:**

```ts
// server/src/game/realm/policy.ts
kingdom.policy: Partial<Record<PolicyKey, { value: string; since: number; until?: number; why: string }>>
decidePolicy(realm, kingdomId, key, day, rng, pressures): PolicyChange | null   // ruler traits + opinion + pressures → value, logged as realm news kind "policy" with why
policyOf(realm, kingdomId, key): string    // with the key's default when unset
```

- Each key is declared once (`POLICY_KEYS` in `policy.ts`, with its values, its default and the function that scores the values for a ruler), so the admin view can list every kingdom's laws in one table.
- A change is always news (kind `policy`), with a `why` that names the pressure ("the queen banned necromancy after the plague in Ashby, 9 days ago").
- `until` gives temporary policies (curfews, crackdowns) that run out unless they are renewed (N58).
- Per-kingdom-pair policies (runaways: N59) use the key `runaways:<otherKingdom>`.
- Save: `KingdomSchema` gains `policy` (default `{}`), one migration, made in N45.

## 15. The empty tables are filled phase by phase

N18 made tables that are still empty. Who fills them, so two phases don't both claim one:

| Table | Filled by | Rule |
|---|---|---|
| `knowledge(who, ref, learned_day, source, accuracy, variant)` | N33 ✅ | what townsfolk know (news refs, deaths, later secrets from N46). Capped per person (keep the 24 most worth telling). `variant` is which detail was changed in the telling (`game/gossip/describe.ts`). The player's own knowledge is `player.known` in the save, not here. |
| `relationships(a, b, trust, affection, respect, fear, since)` | N37 ✅ | one person's view of another, only for pairs who have interacted (`since` is the day it last changed); written only through `adjustRel` (`game/chatter/rel.ts`: fades with a half-life of two years, pruned when every axis is under 3 and a year untouched, at most 50 a person); `credenceOf` is how gossip reads it |
| `grievances(id, who, against, cause_ref, weight, since, settled)` | N37 ✅ | every wrong; add only through `addGrievance` (`chatter/grievance.ts`; the id comes from who, whom and what so places worked out in a different order agree), read the weight through `weightOn(g, day)` (it fades by its owner's forgiveness), settle with `settle`/`easeGrievances`/`settleAll`. N45 makes them pass to children, N56 sums them by oppressor, N58 counts them by place |
| `ambitions(who, kind, target, progress, since, step, strength, frustration, route, urgent)` | N40 ✅ | one row per person (and per talker with no row, under their persona id); written only through `CareerStore.setAmbition` (game/ambition/day.ts picks and moves it); `step` is the rung of the kind's ladder (`ambition/kinds.ts`) |
| `jobs_held(who, job, site, from_day, to_day)` | N40 ✅ | a career history: `apprentice:<trade>`, `<trade>:journeyman`, `<trade>:master`, `shop:<site>:<trade>`, `land:<site>`, `seat:<seat id>` (a seat held is an open row: `ambition/seats.ts`), or a plain job; an open row has no `to_day`. N55 writes military service here too (`job = "soldier:<rank>"`) |

New tables after these: add them to `TABLES` and `ORDER_BY` in [`store/schema.ts`](../../../packages/server/src/store/schema.ts) (so the world hash, export and import include them) with a migration.

## 16. Save and schema versions from here on

The save is at **v15** and the database at **schema 9** (N40 and its follow-up, 2026-10-23; schema 7 was N37's, 2026-10-14). Every phase that adds saved state bumps the save version, the schema version or both, **with a real migration and a test from the version before** (the clean breaks at v11 and v13 were one-time decisions). If a phase would rather start clean, ask the user first. Each plan has a **Save** line saying what it adds. Two phases in a row may share a bump if they're built together.

## 17. Three grains of detail, and what a daily rule may read

- **The player's place:** hour by hour; talkers act, the crowd walks (N16), and N38's hourly menu runs for talkers there.
- **Live places** (`PEOPLE_LIVE`): one step a day per person ([`people/step.ts`](../../../packages/server/src/game/people/step.ts)).
- **Lazy places:** caught up when the player arrives, and they must give the same result as a live place.

So **any new daily rule for townsfolk must be a pure function of their rows, their place's `site_days` and the day**. When a rule needs more of the realm (the season's stores, a curfew, the mood, a plague), add a field to `SiteDay` in [`people/conditions.ts`](../../../packages/server/src/game/people/conditions.ts), written by the realm's day, and read that. Several plans add one (N30 `season`, `stores`; N36 `mood`; N58 `curfew`, `crackdown`; N61 `plague`, already there but unfilled; N62 `disaster`). A test in each such phase checks a live place and a lazy place give the same world hash.

## 18. Client work goes in layers

The browser draws from data it already has (N16's rule). New visual systems are their own Phaser layer like [`CrowdLayer.ts`](../../../packages/client/src/world/CrowdLayer.ts) and [`RoadLayer.ts`](../../../packages/client/src/world/RoadLayer.ts) (`world/MarksLayer.ts`, `world/InteriorLayer.ts`, `audio/` for sound); panels go in `client/src/ui/`; settings go in a small prefs module like [`voice/prefs.ts`](../../../packages/client/src/voice/prefs.ts); admin views go in [`client/src/admin/views/`](../../../packages/client/src/admin/views/). Logic the browser and server must agree on (placement, positions, what a sound bed is) goes in `packages/shared/src/` and is tested there.

## 19. New model call kinds

Each phase that wants words from the model adds a **call kind** to N19's budgets ([`budgets.ts`](../../../packages/server/src/budgets.ts)) with a priority, a token cap and a **template fallback**, and works the same with the model off. The kinds these plans add:

| Kind | Phase | Priority | Fallback |
|---|---|---|---|
| `chatter-line` (an insult, a sneer) | N37 | low | line tables by interaction and class |
| `choice-reason` (why an NPC did it, only when asked or pinned) | N38 | low | the score parts in words |
| `letter` | N34 | low | letter templates |
| `incident-line` | N39 | high (the first minutes matter) | incident templates |
| `banter` | N41 | lowest | none: no line |
| `item-name`, `item-legend` | N43 | low | "the <maker>'s <kind>", template legend |
| `taunt` | N44 | normal | templated from the meeting log |
| `hearing` | N48 | normal | the verdict's reasons as a clerk's record |
| `creed`, `sermon` | N50 | low | creed templates by tenet |
| `spell-words` | N51 | lowest | the effect in plain words |
| `culture-names` (a new culture's words) | N53/N64 | low, once per culture | syllable tables |
| `band-creed` | N56/N57 | low | creed templates by grievance |
| `song`, `tale`, `era-name` | N68 | low | templated verses and names from the facts |

Every name the model invents goes through the invented-name check (`inventedWords` in [`realm/director.ts`](../../../packages/server/src/game/realm/director.ts)).

## 20. Suggested order, and when to stop and play

1. **Finish the vertical slice:** N33 → N37 → N38 → N40 (with N24 steps 1–3 and N20 step 1 as their step 0s). Then **play it and revise this track** (the overview's milestone). Don't start N29+ phases outside the slice before that playtest; the playtest may cut or merge them.
2. Then Stage 2's rest (N27, N28, N29–N32, N34–N36), with N20–N24 where the plans need them.
3. Then Stages 3–7 in order. Stop and play after each stage, write down what feels alive and what is noise, and change the next stage's plans from that before building it.

The plans for N29–N68 were written before the slice was played. They are a good starting point, not a contract: if a playtest shows a phase is noise, cut it and record why in the stage file.
