[← Roadmap](../../ROADMAP.md) · [Living world overview](README.md)

# Stage 1: Foundations

See the world, keep it fast and stable, and know what the player knows. Everything after is watched, measured and tuned through this.

## N17: The admin world view

**Status:** ✅ Built (2026-10-13), apart from "simulated at full detail", which waits for N25

**Implementation plan:** [plans/n17-admin-world-view.md](plans/n17-admin-world-view.md)

**Goal:** an administrator's view of the whole world, separate from the game: see what is happening everywhere and why, and pin an NPC, the player or a place to follow them.

**The rules:** read-only, with one exception: the time controls (pause, step, fast-forward) act on the live game, because the user wants them in the admin panel (decided 2026-10-13). They run the same code as the player waiting and are logged. It shows the truth (what really happened), not what the player knows. It reads the same state and event log the game uses; it never changes them. A separate page (`/admin`), not a tab in the game.

- [x] **Realm overview:** a live map with kingdom borders, settlements, roads, armies, packs and caravans; per place population (by class), prosperity, food, coin; current wars, treaties and factions
- [x] **Event stream:** every event in the realm, filterable by place, faction, person, type and importance, each with its **why** (the director's reason, an NPC's decision and the options it weighed once N38 exists)
- [x] **Search:** anyone by name, class, job, place or faction (cast, notables, townsfolk, beasts)
- [~] **Pinning:** pin NPCs, the player or a place. A pinned NPC shows: where they are and what they're doing now; needs, emotions, goals and grudges; relationships; what they know or believe and who told them; family tree; a timeline of what they've done and why. A pinned NPC is simulated at full detail (N25) wherever they are *(not yet: until N25 gives the townsfolk lives, a pinned townsperson's day is worked out on demand from the roster, the map and the clock, which needs no simulation, and pinning cannot change what happens)*
- [x] **Pinning the player:** what each NPC currently believes about the player (rumours, reputation, grudges, debts), and who believes what
- [x] **Time controls:** pause, step an hour or a day, fast-forward; the camera can follow a pinned NPC *(a townsperson is picked out on their town's map; the talking cast's spots belong to the live game, so for them the town is shown without a marker)*
- [x] **Health:** tick timings, counts (fights, factions, kingdoms, population), the numbers `sim:realm` prints, so tuning can be done live
- [x] Tests, README, this roadmap

- **Done when:** the admin page shows the realm map and its numbers; the event stream shows a war, a death and a director push with their reasons; pinning a townsperson in another town shows their day hour by hour; pinning the player shows a rumour about them and who believes it; nothing on the admin page changes the save except the time controls, which move the clock just as the player waiting would, and are logged.

**How it's built:** the data side is [`server/src/admin/`](../../packages/server/src/admin): plain functions of an `AdminContext` (`world()`, `town()`, `store`, `queueLength()`, `time`) that only read: [`overview.ts`](../../packages/server/src/admin/overview.ts) (the map layer, totals, people by class a few places a request), [`events.ts`](../../packages/server/src/admin/events.ts) (game events from the database, realm news and the director's pushes and log, made alike as `AdminEvent`s with a `why`, filters and a `day:hour:rank:n` cursor), [`search.ts`](../../packages/server/src/admin/search.ts) (the cast, figures, beasts, the player, places, and a lazy per-settlement index of townsfolk built within a time budget, so a first search may say `complete: false`), [`person.ts`](../../packages/server/src/admin/person.ts) and [`player.ts`](../../packages/server/src/admin/player.ts) (cards as titled sections; a townsperson's 24 hours from `CrowdSim`; who believes which rumour about the player), [`health.ts`](../../packages/server/src/admin/health.ts) with [`metrics/timing.ts`](../../packages/server/src/metrics/timing.ts) (ring buffers; `realmDay` and its steps, `passHours`, `persist` are timed), and [`time.ts`](../../packages/server/src/admin/time.ts). Routes are in [`web/routes/admin.ts`](../../packages/server/src/web/routes/admin.ts): `GET /api/admin/*` only (anything else is 405, except `POST /api/admin/time`), local machine only unless `ADMIN=on` (403 otherwise), and `/admin` serves the second page. The time controls run `passHours` through the same `ActionQueue` as the player's wait and write an `admin-time` entry to the director's log; pause is a server flag that makes `/api/tick` do nothing. News and events got an optional `why` (and news a `people` list of figure ids, found when it is written), filled where code makes a choice: a war's cause, a treaty's reason, how a head was picked, a raid's grievance, a death's cause, the director's reason (copied onto the news it caused). `worldHash` ([`game/hash.ts`](../../packages/server/src/game/hash.ts)) is the proof nothing is written. The page is [`client/admin.html`](../../packages/client/admin.html) with [`src/admin/`](../../packages/client/src/admin) (a second Vite entry the game never imports; `tests/n17.test.ts` greps the game's scripts for `/api/admin`); the map is drawn by [`realmMap.ts`](../../packages/client/src/realmMap.ts), shared with the game's Realm tab. Pins live in the browser's `localStorage`, never in the save.

- **Left for later:** armies in the field and caravans (N55, N26) have no place on the map yet; budgets (N19) and cause chains (N20) have named empty slots in the health panel and the event detail; the cast's on-map positions, needs and emotions for townsfolk (N25), ambitions and choices (N37, N38) show as "not built yet" sections on the cards.
- **Run it:** `npm run web`, then open `http://localhost:3000/admin`. (Under `npm run dev` the page is `/admin.html` on the Vite port.)

## N18: Scale and storage

**Status:** ⬜ Planned

**Implementation plan:** [plans/n18-scale-and-storage.md](plans/n18-scale-and-storage.md)

**Goal:** the save holds tens of thousands of real people and their state without slowing down.

**What exists:** `saves/world.json` holds the whole game state and is loaded and saved as one piece; `saves/world.db` (SQLite) holds the growing logs, memories with embeddings and the director's log. N16's townsfolk are rolled from a seed and only kept when spoken to.

**The rules:** from N25 on, every person is real and changes, so their state moves into SQLite, by place, loaded when that place is simulated in detail and written back in batches. `world.json` keeps the small top-level state (player, clock, realm summary). The seeded roster stays the starting point; the database holds what has changed since.

- [ ] Tables for people (identity, life, family links), relationships, knowledge records, grievances, ambitions, jobs held; indexed by place and id
- [ ] Load by place and level of detail (N25); write in batches at the end of a tick; no full-save rewrite per hour
- [ ] Save version 11 for both files, as a clean break: older saves are set aside and a new world starts (user decision 2026-10-13: old saves don't matter). Migrations from v11 onward, each tested
- [ ] An export and import of a whole world (for bug reports and seeded test fixtures)
- [ ] Tests, README, this roadmap

- **Done when:** a realm with 50,000 people saves in under a second and loads the player's place in under two; a pre-v11 save is set aside and a new world starts; an exported world imports and replays identically with the same seed.

## N19: Performance and model-call budgets

**Status:** ⬜ Planned

**Implementation plan:** [plans/n19-performance-and-budgets.md](plans/n19-performance-and-budgets.md)

**Goal:** every later phase has limits it can't quietly break: frame rate, tick time and how much the one local model is asked to do.

**The rules:** budgets are numbers in config and checks in tests and `bench`, not hopes. On the M2 with 8 GB, one 3–4B model serves every call, so the background queue has a daily cap and a priority order for what's dropped first.

- [ ] Tick budgets: a game hour at full detail, a game day at coarse detail, a year of lazy catch-up (N25), each in milliseconds; `sim:realm` and a perf test fail when they're exceeded
- [ ] Frame budget: 60 fps in a capital with everyone drawn (N16's check, kept in CI)
- [ ] Model-call budget per game day, by kind (conversation, summaries, daily plans, chronicle, creeds, songs, story titles); talking always wins, then summaries; flavour (songs, creeds, titles) drops first and falls back to template words
- [ ] `bench` measures the queue's length and wait under a busy day
- [ ] The admin view (N17) shows the budgets and how close each is
- [ ] Tests, README, this roadmap

- **Done when:** a busy simulated week stays inside every budget; pushing the queue past its cap drops flavour first and the player's conversation still starts within the first-token target (G3).

## N20: Stories, drama and liveness metrics

**Status:** ⬜ Planned

**Implementation plan:** [plans/n20-stories-drama-liveness.md](plans/n20-stories-drama-liveness.md)

**Goal:** the emergent drama is noticed. Code finds chains of events that caused each other and surfaces the best as stories; a drama manager keeps something brewing near the player; the admin view measures how alive the world is.

**The rules:** every event records what caused it (a parent event id, or the decision that made it), so chains are a graph walk in code. The drama manager never invents events: it only speeds up or moves nearer things already in motion (a grudge close to its threshold, a pack about to raid, a caravan on the road). The model writes only a story's title and summary, from the facts code gives it.

- [ ] **Causes on every event:** a `causedBy` link on events from N12's log onward; the admin view (N17) can walk a chain both ways
- [ ] **Story detector:** finds causal chains (insult → grudge → ambush → revolt), scores them by length, the renown of who's in them, deaths and how many places they touch, and keeps the best as stories
- [ ] Stories in the admin view, in N68's chronicle, and as rumours NPCs tell ("did you hear how the miller's feud ended?")
- [ ] **Drama manager** (switched on once N38 makes NPCs act; until then it stays off): when nothing of note has happened near the player for a while, nudge an existing thread forward or toward them; capped, logged with its reason, `DRAMA=off` turns it off
- [ ] **Liveness metrics:** distinct actions per day, chains longer than three steps, named NPCs whose status changed, events that reached the player, quiet hours near the player; shown in the admin view and printed by `sim:realm`
- [ ] Tests, README, this roadmap

- **Done when:** a 60-day run produces stories whose every step links to its cause; the admin view shows the chain behind a revolt back to the first insult; with the player idle in a quiet village, the drama manager brings an existing thread to them within a few days and logs why; the metrics differ between `DRAMA=off` and on.

## N21: Callbacks to the player's choices

**Status:** ⬜ Planned

**Implementation plan:** [plans/n21-callbacks.md](plans/n21-callbacks.md)

**Goal:** the player sees when the world's events trace back to something they did.

**The rules:** N20's cause links are walked back from notable events; if a chain reaches a player action within a few steps, the player is told, through a person who'd know or the journal (N65), never more than the player could learn.

- [ ] Find chains that reach a player action (sparing, killing, stealing, a promise, a gift, a rumour spread)
- [ ] Tell the player in the world: an NPC says it ("you spared Odo; he leads the revolt now"), a song names them (N68), or the journal links it
- [ ] Rate-limited and only for chains that matter (renown, deaths, places touched)
- [ ] Tests, README, this roadmap

- **Done when:** the serf the player spared leads a revolt a season later and someone tells the player so; the bread the player stole is traced in the journal to the riot it helped start.

## N22: Long-run balance tests

**Status:** ⬜ Planned

**Implementation plan:** [plans/n22-long-run-balance.md](plans/n22-long-run-balance.md)

**Goal:** the realm neither collapses nor stalls over years of play.

**The rules:** seeded 5- and 10-year runs over several seeds, with no model calls, checked against bounds. Every new phase adds its own bounds (N13 had to be tuned down from 41 factions; this makes that automatic).

- [ ] `sim:years` runs a realm for N years over K seeds and reports N20's liveness metrics and realm totals
- [ ] Bounds: no species or kingdom dies out by default; kingdom count stays within the cap (N64); population, food and prosperity stay in bands; famine, plague and war aren't permanent; factions neither explode nor vanish; at least some long causal chains every year
- [ ] Runs in CI on a few seeds, and nightly on more
- [ ] Tests, README, this roadmap

- **Done when:** ten years over ten seeds stay inside every bound, and a deliberately broken setting (no famine relief, no war fatigue) is caught by the check.

## N23: Sharing worlds

**Status:** ⬜ Planned

**Implementation plan:** [plans/n23-sharing-worlds.md](plans/n23-sharing-worlds.md)

**Goal:** worlds and their stories can be shared and replayed.

**The rules:** built on N18's export and import. A world seed and its chronicle are enough to replay the world exactly; snapshots let a story be replayed from a chosen day.

- [ ] Export a world: seed, settings, snapshots, chronicle (N68) and stories (N20)
- [ ] Replay from a chosen day as an observer (admin view) or as a new player
- [ ] A shareable chronicle (read-only, the truth or what one player knew)
- [ ] Used as playtest and bug-report material (the vertical slice, N22)
- [ ] Tests, README, this roadmap

- **Done when:** a world is exported, imported on another machine and replayed from day 40 identically; its chronicle reads the same in both.

## N24: Global reporting

**Status:** ⬜ Planned

**Implementation plan:** [plans/n24-global-reporting.md](plans/n24-global-reporting.md)

**Goal:** the player's feed covers the whole realm, not just Millbrook, without spoiling what the player shouldn't know yet.

**The rules:** the player's feed shows what **the player** knows: events they saw, and news once it has reached them (N13.0's death news, carried as in N33). The admin view (N17) shows the truth. These two stay separate.

- [ ] Feed scopes: **here**, **my kingdom**, **everywhere**, filtered by importance so it doesn't flood
- [ ] Events about pinned NPCs always show (in the admin view at once; in the player's feed once known)
- [ ] Fix: the feed reports Millbrook's daily trades while the player is in another place (from N16's "left as it is")
- [ ] **Every place has its own news clock** (added 2026-10-13): news reaches each place after the days travellers take from where it happened, and the talking people of every place know only what has reached their place. Today they all go by Millbrook's clock: a visitor's file knows all realm news that has reached Millbrook, so people in the town where something happened hear of it late, and far-off people know Millbrook's news too early
- [ ] Tests, README, this roadmap

- **Done when:** a war in a far kingdom appears in the player's "everywhere" feed only after its news reaches them, and in the admin view at once; standing in Highdale shows Highdale's trades, not Millbrook's; someone in the town where something happened knows it that day, and someone in a town farther away learns it only when it reaches them, not when it reaches Millbrook.
