[← Plans](README.md) · [Stage 1: N20](../stage-1-foundations.md#n20-stories-drama-and-liveness-metrics)

# N20 plan: Stories, drama and liveness metrics

**In one line:** every event records what caused it; code walks those links to find the best chains and keeps them as stories; a drama manager (off until N38) can hurry or move threads already in motion; and daily numbers say how alive the world is.

**Read first:** [plans README](README.md) sections 2 (deterministic ids), 4 (model writes only words). Needs N18 (the `events.caused_by` column, deterministic ids) and N17 (admin view to show it).

## What exists

- `GameEvent` ([`events.ts`](../../../packages/server/src/game/events.ts)) has no cause. `recordEvent(world, event)` is called from many places (grep `recordEvent(`: actions, crime, gossip, family, quests, the director, creatures, health…).
- Realm events are `RealmNews` (`realmNews(realm, day, at, kind, text, importance, names)` in [`realm/log.ts`](../../../packages/server/src/game/realm/log.ts)) and `DirectorPush` (`logPush`). Also no cause.
- N12's director: [`director/chronicle.ts`](../../../packages/server/src/director/chronicle.ts) writes a nightly chronicle; [`director/revenge.ts`](../../../packages/server/src/director/revenge.ts) makes revenge goals from grudges (a natural cause link: the grudge's event → the revenge).
- The realm director ([`realm/director.ts`](../../../packages/server/src/game/realm/director.ts)) picks pushes from `candidates()` with reasons and cooldowns.
- N18 added `events.caused_by` (JSON array) and `seq`, and deterministic ids.

## Decisions made in this plan

1. **One id space for everything that happened.** Refs with a prefix: `e:<GameEvent.id>`, `n:<RealmNews.id>`, `d:<push id>`. Give `DirectorPush` an `id` (it has none). Every cause link is a ref, so a game event can be caused by realm news (a famine → a theft) and the other way round.
2. **Many causes, not one.** `causedBy: string[]` (most have 0 or 1; a revolt can have a grudge and a famine). Keep at most 3; if more, keep the most important.
3. **Causes are set by the code that makes the event, explicitly where it can, by scope where it can't.** Explicit: `recordEvent(world, { …, causedBy: [ref] })`. Scope: a small stack in `events.ts`, `withCause(ref, () => { … })`, so everything recorded inside inherits the cause without threading a parameter through ten functions (for example, a raid's deaths, loot and fleeing). Always `try/finally` to pop. The simulation is synchronous, so a module-level stack is safe; **never** hold a cause scope across an `await` (model calls) — assert that in `withCause` by checking the stack is empty at the start of every async entry point (request handlers, background jobs).
4. **Stories are found by code and stored.** A story is a chain (a path in the cause graph) with a score. The model only writes its title and a two-sentence summary from the facts given, through N19's budget (`story-title`), with a template fallback ("The miller's feud: an insult, a grudge, an ambush.").
5. **The drama manager only touches what's already in motion.** It works on **threads**: things with a progress value and a threshold that code already tracks (a grudge's weight toward revenge, a pack's count toward its cap, a caravan's ETA, a dungeon's danger toward spill). It may (a) bring a threshold forward a little, or (b) choose, among targets the code would already allow, the one nearest the player. It never creates an event or a thread. Off by default until N38 (`DRAMA=on` turns it on early for tests); `DRAMA=off` always wins.

## Data shapes

```ts
// events.ts
export interface GameEvent { …; causedBy?: string[]; why?: string }   // why from N17
// realm/types.ts
RealmNewsSchema: add causedBy: z.array(z.string()).max(3).optional(), people (N17), why (N17)
DirectorPushSchema: add id: z.string(), causedBy optional

// server/src/stories/types.ts
export interface Story {
  id: string;                // st<day>-<seq>
  refs: string[];            // the chain, oldest first
  sink: string;              // the last ref (what the story "ends" with so far)
  score: number;
  people: string[]; places: string[];
  deaths: number;
  title: string; summary: string; worded: "model" | "template";
  firstDay: number; lastDay: number;
  open: boolean;             // still growing (its sink got a new effect within N days)
}
```

SQLite: `stories(id PRIMARY KEY, sink, score, data JSON, first_day, last_day, open)`, `story_refs(story, ref)` (index on `ref`, to find the stories an event is in), `metrics_daily(day PRIMARY KEY, data JSON)`, `drama_log(id, day, thread, action, reason, ok)`. Index `events(caused_by)` is useless on JSON; add an `event_causes(ref, cause)` table (both indexed) written alongside each event, so walking *forward* (what did this cause?) is one query.

## Steps

### Step 1: cause links on every event
- Add `causedBy` to `GameEvent`, `EventSchema`, `RealmNews`, `DirectorPush`; `withCause` and `currentCauses()` in `events.ts`; `recordEvent` and `realmNews` merge explicit causes with the scope's.
- `WorldStore.archiveEvent` writes `caused_by` and `event_causes` rows. Realm news gets archived too now (into `events` with `source = 'realm'`, or a parallel `realm_events` table: pick one; recommended: the same `events` table with a `source` column, so one query walks both).
- **Wire causes in the places that matter most first** (one commit each, with a test each):
  1. Grudge → revenge (`director/revenge.ts`): revenge goal and its events caused by the grudge's event.
  2. Insult/attack → grudge (where grudges are made from events in `npc/relationship.ts`/actions).
  3. Gossip: a retold event's `rumour` event caused by the original.
  4. Crime → guard/fine/`theft-caught`.
  5. Realm: raid → deaths/loot/`bury` news; war declared → battles → war end; famine (food low) → migration, unrest; succession → faction split.
  6. Director push → whatever it caused (the push's id as scope).
  7. Family: courtship → marriage → expecting → birth.
- Grep every `recordEvent(` and `realmNews(` call; for each, decide: explicit cause, inherited from scope, or truly uncaused (weather, a roll). Leave a short comment where it's deliberately uncaused. Keep a checklist in the PR.

### Step 2: walking chains, and the admin view
- `server/src/stories/graph.ts`: `causesOf(ref)`, `effectsOf(ref)` (SQL on `event_causes`), `chainBack(ref, maxDepth)`, `chainForward(ref, maxDepth)` (breadth-first, with a visited set: graphs can have diamonds).
- Admin (N17): on an event's detail, "Caused by" and "Led to" lists, clickable both ways, and "Show whole chain" (draw as an indented tree; a full graph layout isn't needed).

### Step 3: the story detector
- Runs once a game day (after `realmDay`), in code, no model: take events of the last day with importance ≥ 6 or a death, walk back up to 8 steps, and score each maximal path:
  `score = length×2 + Σ renown/20 of people in it + deaths×3 + distinct places×2 + (player involved ? 3 : 0)`, all weights in `stories/score.ts` as named constants.
- Keep paths with length ≥ 3. Merge: if a new path contains an existing story's chain, extend that story (same id, new sink) instead of making a new one. Keep the top K (e.g. 200) by score; close stories whose sink hasn't grown for 2 game years.
- Wording: for new or grown stories above a score bar, queue a `story-title` job (N19); the template fallback names the first and last events and the main person. The model's title passes the invented-name check (`inventedWords`, names allowed: people and places in the chain).
- Admin: a Stories panel, best first, click to see the chain.

### Step 4: stories as rumours and in the chronicle
- A story whose sink event an NPC knows (`knowsEvent`) can be told as a rumour: create a rumour keyed `story.<id>` with the summary as text, accuracy from how many of the chain's events the teller knows. Hook into gossip ([`gossip.ts`](../../../packages/server/src/game/gossip.ts) `gossipTogether`) as one more thing to pass on, with its own chance. Tellers phrase it (their prompt gets the story's summary as something they heard).
- Chronicle: `runChronicle` gets the day's best new or grown story as an input fact. N68 builds the realm history on this later.

### Step 5: liveness metrics
- `server/src/metrics/liveness.ts`: `livenessFor(day)` from the events table:
  - distinct (actor, kind) pairs that day ("distinct actions per day");
  - stories with length > 3 that grew that day;
  - named NPCs (cast + figures with renown ≥ 25) whose status changed (role, faction, home, alive, married);
  - events that reached the player (witnessed or `player` in `knownBy`; after N24, `player.known` learned that day);
  - quiet hours near the player: hours with no event of importance ≥ 4 at the player's site.
- Store in `metrics_daily`; show the last 30 days as small charts in the admin view; `sim:realm` prints averages at the end.

### Step 6: the drama manager (built, off by default)
- `server/src/stories/drama.ts`. **Threads** come from adapters, one per kind, each returning `{ id, kind, progress, threshold, eta?, near: site, canHurry: boolean, targets?: string[] }`:
  - grudges (weight vs the revenge threshold in `director/revenge.ts`),
  - packs (`count` vs `cap`, the attack rule in `wilds.ts`),
  - dungeons (`danger` vs `DANGER_SPILL`),
  - caravans and journeys (from N26; adapter returns nothing until then),
  - (N38 adds NPC plans; N56 adds grievances).
- Each game day: if the player's site has had more than `QUIET_DAYS` (e.g. 2) days without an event of importance ≥ 5 within a day's travel, pick the thread with the smallest remaining gap whose site is within reach, and apply **one** nudge: `progress += min(gap, NUDGE_MAX)` or, when the thread chooses a target, prefer the allowed target nearest the player. Each adapter implements its own `hurry(thread, amount)` and `preferTarget(thread, site)` in terms of the system's existing state (e.g. a pack's `count` +1; a grudge's weight +5), so the system then acts by its own rules.
- Cap: at most one nudge per `DRAMA_EVERY_DAYS` (e.g. 3); log every nudge (and every considered-and-skipped one at debug level) to `drama_log` with its reason ("quiet for 3 days near Millbrook; the wolf pack of the Ashwood is 2 short of raiding"), and give the nudge a ref (`d:`) so what follows is caused by it.
- `DRAMA=off` (config) → never runs. Until N38, default off; a test turns it on.

### Step 7: docs
- README: what stories are, where to see them, `DRAMA`, the metrics. Stage file ticks and How it's built.

## Edge cases and traps

- **Cause scopes leaking across awaits** (decision 3). A leaked scope makes later unrelated events "caused by" an old one. Test: an event recorded in a request after a scoped block has no cause.
- **Cycles.** Bad wiring could make A cause B cause A. Refuse a cause whose ref is newer than (or equal to) the event being recorded; ids are ordered by `(day, hour, seq)`, so this is a cheap check.
- **The 300-event cap in the save.** Chains must walk the **store**, not `world.events`, or old links vanish.
- **Over-linking.** If everything in a raid is caused by the raid and the raid by the director, every story starts at the director. Score director pushes as weight 0 in a chain's length, and show them as "the director nudged this" rather than as a story step.
- **The drama manager and determinism.** It reads the player's site, so worlds with different players diverge; that's expected and fine. It must use its own stream (`streamFor(seed, "drama", day)`).

## Tests (`packages/server/tests/n20.test.ts`)

- Causes: an insult → a grudge → a revenge goal → an ambush: each event's `causedBy` is the previous one's ref; `chainBack(ambush)` returns all four.
- Scope: events inside `withCause` inherit; after it, none; a throw inside still pops.
- No cycles: recording an event caused by a newer ref is refused (throws in tests, logs in production).
- 60-day run (fixed seed, model off): at least N stories with length ≥ 3, and every step of every story has a cause link to the previous step (walk them).
- Story growth: a chain that gets a new effect extends the same story id.
- Story as rumour: an NPC who knows the sink event can pass the story on; one who doesn't, can't.
- Drama: player idle in a quiet village with a pack 2 short of its cap nearby, `DRAMA=on`: within `DRAMA_EVERY_DAYS × 2` days, a nudge is logged with a reason and the pack raids; with `DRAMA=off`, no nudge and the metrics differ (quiet hours higher).
- Metrics: a hand-built day of events gives the expected numbers.

## Done when (mapped)

| Done-when clause | Proved by |
|---|---|
| a 60-day run produces stories whose every step links to its cause | 60-day test |
| the admin view shows the chain behind a revolt back to the first insult | admin chain view + causes test (revolts arrive in N56; until then test the chain behind a raid or an ambush, and add the revolt test in N56) |
| with the player idle in a quiet village, the drama manager brings an existing thread to them within a few days and logs why | drama test |
| the metrics differ between `DRAMA=off` and on | drama test |

## Slice cut

Not in the slice, but step 1 (cause links) is cheap if done while the slice's systems are being written, and costly to retrofit. Recommended: add `causedBy` and `withCause` during the slice and wire them in every new system as it's built.

## Out of scope

The player-facing "you caused this" (N21). Songs and legends (N68). Revolts themselves (N56).
