[← Living world overview](../README.md) · [Stage 1](../stage-1-foundations.md) · [Stage 2](../stage-2-everyone-lives.md)

# Implementation plans, N17–N28

Written 2026-10-13. These are build guides for **N17–N28** (all of Stage 1 and the first four phases of Stage 2), for a coding agent (Sonnet, Opus) or a person picking up a phase cold. The stage files say **what** each phase is and when it's done. These plans say **how**: what exists now, which files to touch, the data shapes, the order of steps, the traps, and the tests that prove it.

Read this page first. It holds the rules every phase shares; the phase plans assume them and don't repeat them.

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
| N26 | [The open road](n26-the-open-road.md) | N18, N19, N25, N25a | ✅ built (all four parts; the whole realm walkable, see the stage file for what differs) |
| N27 | [The wilds](n27-the-wilds.md) | N26 | |
| N28 | [Fauna and flora](n28-fauna-and-flora.md) | N26, N27 | |

The vertical slice (see the [overview](../README.md#milestone-the-vertical-slice)) builds N17 → N18 → N25 → N25a → N25b → N26 first, for the start town, its liege town and the road between. Each plan has a **Slice cut** section that says what that phase needs for the slice and what waits.

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

## 5. Time: a year is 12 days

`config.daysPerYear` is **12** by default ([`config.ts`](../../../packages/server/src/config.ts)). So "10 years" in a done-when is **120 game days**, "a season" is 3 days, and a pregnancy is 9 days. Keep every rule in days via `config.daysPerYear`, never a literal 365 or 12. When a plan says "a year", compute it.

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
