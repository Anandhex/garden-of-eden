[← Roadmap](../../ROADMAP.md) · [Living world overview](README.md)

# Stage 2: Everyone lives

Every person is real and the year has a rhythm: they age, marry, die, gossip and feel, and it shows on the map.

## N25: Townsfolk lives

**Status:** ✅ Built (2026-10-13)

**Implementation plan:** [plans/n25-townsfolk-lives.md](plans/n25-townsfolk-lives.md)

**Changed by N26 Part E (2026-10-14):** migration becomes a journey (depart, walk, arrive); see [N26 Part E](plans/n26-the-open-road.md#part-e-everyone-on-the-road-is-someone-rework-asked-for-2026-10-14).

**Goal:** ordinary townsfolk age, marry, have children and die, so a place's population is a count of real people, and a townsperson's child can grow up to become a named or talking NPC.

**The rules:** levels of detail, all in code, no model calls:
- **Full detail:** the place the player is in, and pinned NPCs (N17): hourly.
- **Coarse:** other places: still individuals, updated once a day in batches.
- **Lazy catch-up:** a place nobody has looked at for a while fast-forwards when the player arrives or something there needs checking (seeded, so the result is the same either way).

- [x] **Ageing:** every person ages yearly, with species age bands as for the named cast (N3.3)
- [x] **Marriage:** partners matched within a place, weighted by class, age and relationship; cross-class matches are rare and become gossip. Reuses N11's courtship and marriage rules at coarse grain
- [x] **Births:** children inherit traits and some skills (N11's inheritance)
- [x] **Deaths:** old age, famine, raids, wars, beasts, illness, each tied to the realm event that caused it; a death is news (N13.0)
- [x] **A typed death record for everyone:** `cause` (battle, siege, raid, execution, illness, famine, old age, beast, murder, accident, …), with the event, place and killer when known, replacing N13's free-text cause and the nameless `bury` count. Missing is a state of its own. N55 adds the war details on top
- [x] **The population number becomes a count:** roster changes replace N16's "only the population number changes"; a growing town still adds to the end, so existing people keep their place
- [x] **Migration as people:** N13's moves to better places move named townsfolk, with their family
- [x] **Rising:** a notable's child, or a child with strong inherited traits, goes through N13's rise rules and can become a named or talking NPC; lineage kept, so the admin view can trace who came from whom
- [x] Births, deaths and moves stored in N18's people tables (no migration of older saves: they're set aside, user decision 2026-10-13)
- [x] Tests, README, this roadmap

- **Done when** (all proved in `tests/n25.test.ts`, except the 60 fps check, which is N19's frame test plus the by-hand `?fps=1` check): over 10 simulated years a village's people age, marry, have children and die, the population figure equals the living roster, a born townsperson rises to a talking NPC with their parents in their file, a famine kills people in the place it struck, and a capital still runs at 60 fps.

**How it's built:** [`server/src/game/people/`](../../packages/server/src/game/people): `rules.ts` (age, courting age, kin check, trait inheritance, shared with `family.ts`), `death.ts` (typed `DeathRecord`), `conditions.ts` (a place's day, written to `site_days`), `rates.ts` (every number, with the measured results), `step.ts` (one place's day), `casualties.ts`, `migration.ts` (households, settlers), `rising.ts`, `world.ts` (`lifeDay`, `catchUp`, `advanceWorld`), `bounds.ts` (the five balance bounds), `index.ts` (lineage, `killPerson`). Database schema 3 adds `expecting`, `last_birth`, `stepped_day`, `site_days` and `site_seq`; save v12 adds `settlement.houses`, `realm.casualties` and a figure's `death` and `person` (a v11 save loads as it is). `PeopleStore` keeps a read copy of each place's living people (about 400 bytes each), births and arrivals wait for the save's flush like every other change, and `livingCount` follows them. Measured on the M2 (seed 1, 24,000 people in 36 places): about 63 ms a game day for everyone, 7 ms of it moves; `npm run sim:lives`.

**Where it differs from the plan:**
- Couples may have up to **6** children (`LIVES.maxChildren`), not the cast's 3: with three the realm cannot grow. The cast keeps its own pool and cap.
- A lazy place is only equal in its people, counters and events; the realm's coin reads its *population number*, which is as of its last catch-up, so lazy is for budgets only (nothing is lazy by default: coarse for everyone fits the budget).
- Rising: every figure who grew up as a townsperson and makes enough of a name talks, with **no cap** (user decision 2026-10-13). Millbrook's join the cast; another place's are kept with the visitors (`v_` ids) and are about only when the player is in their town.
- `site_days` is left out of the world hash (it is pruned on its own schedule); `people.rev` is left out too, since it counts saves.
- Cross-place marriage and illness (N61) are out of scope, as planned. Pinned-NPC full detail uses the place the player is in; pins wait for N34.
- Balance is measured, not perfect: children are 40-45% of a growing realm and about a third of the small hamlets empty over 40 years (the old model lost about a quarter). Tuning continues with N22's `sim:years`.

## N25a: A world without a centre

**Status:** ✅ Built (2026-10-13)

**Implementation plan:** [plans/n25a-a-world-without-a-centre.md](plans/n25a-a-world-without-a-centre.md)

**Goal:** the user's words: "I want the game to be not centric around Millbrook." No code or data knows Millbrook exists, and there are **no hand-written NPCs** (user decision 2026-10-13: no scenarios, no authored NPCs). Every settlement and every talking person is generated from the seed and runs the same systems; the only special place is where the player is, for detail, never for rules.

**What exists:** two tiers of place. Millbrook has the full simulation (six hand-written NPCs on an hourly day, creatures and spawn rules, town events, the underworld, quest boards fed by the realm's needs, news delivery, a chronicle); every other place has a thinner copy beside it (`visitors`, `haunts`, Millbrook's news clock). `HOME_ID` has 89 uses in 21 files; "Millbrook" is in 80 files; the cast is named in 34 source files and every server test file; world-level fields (`creatures`, `spawns`, `lastRaidDay`, `recentEvents`, `atWar`, `realm.home`) are really Millbrook's.

**The rules:** never compare a site id to a constant; per-site state in `world.sites`; one registry of talking people, all generated, each with a site; the active site (the player's) runs hourly, the rest run the coarse day and catch up on arrival with the same results; a lint test keeps the centre and the cast from coming back. The start town is picked by the seed; choosing it is N39's.

- [x] **The centre lint:** a test that counts `HOME_ID`, "Millbrook", the cast's names, `atHome(`, `world.creatures`, `realm.home` in code and data, with ceilings that only go down, ending at zero
- [x] **The player always has a site** and the world a `startSite`; no `?? HOME_ID` fallbacks
- [x] **Per-site state:** creatures (Millbrook's and the haunts merged), spawn ledger and rules, raid day, what's going on in town, arrivals from the realm; `atWar` computed per site
- [x] **The active site runs everything:** creatures, spawn rules, the underworld, restocking, gossip, town events (a market day per site) wherever the player is; `atHome()` gone
- [x] **One registry of talking people:** notables of every site, townsfolk spoken to, risers and children are all generated talkers with a site; off-screen talkers catch up on arrival; deaths on people rows, not `deaths.json`
- [x] **Generated depth:** secrets from real facts, cover stories, fears and loves, relationships from family and neighbours, reputation facts, signature moves and services by job, hire terms, successors, dilemmas and arcs, quirks; in code from pools, with model words optional, so the N4–N9 mechanics still have material
- [x] **Millbrook and the cast removed:** no hand-placed village, mayor, captain, gang or dungeon; no persona files, Millbrook lore, named faction files or Millbrook spawn rules in the game; the start town picked by the seed with a generated opening; `HOME_ID` deleted
- [x] **Maps, places, townsfolk, lore and the realm without a home:** areas and names generated for every site; place words from the site; one lore scheme (`place.<site>.*`) and `knowsFor`; news on each place's own clock (N24 step 2b); `needsOf(site)`, arrivals on any site, risers from any site; spawn rules generated by den kind; faction files become faction kinds
- [x] **Words:** templates, prompts, children's backstories, the client and the CLI name the site and its real people
- [x] Save v13 as a clean break: older saves (and `deaths.json`) are set aside, no migration (user decision 2026-10-13)
- [x] Tests on generated worlds (people picked by job, never by name); the six old NPC files kept only as test fixtures for NPC-mechanics unit tests, never loaded by the game (user decision 2026-10-13)
- [x] Tests, README, this roadmap (the vertical slice becomes "the start town and its liege town")

- **Done when:** the centre lint passes at zero; the game loads no persona file and every talker is generated with the depth the N4–N9 mechanics need; for three seeds a new world starts in a seed-picked town and plays a full day with the same systems everywhere (talking notables, a quest from the town's needs, traders, creatures, raids arriving on the map, the underworld where it applies, news on the town's own clock); leaving a town for a week and coming back finds its people mid-day; old saves are set aside.

**Built:** the centre lint (`tests/centre.test.ts`, every ceiling 0), `startSite`, per-site state, the active site and `activate` catch-up, one registry of talkers (`world.talkers`), generated lore (`realm/lore.ts`), needs, arrivals and spawn rules for any place, faction kinds, templates for smith and innkeeper, save v13, generated depth with a model-written story and a code fallback, and every benchmark and simulation script on a generated cast (`scripts/generated.ts`). Played in the browser: a new world starts in a seed-picked town, its head and notables are generated people with their depth, and conversation works with the real model.

**Differences from the plan:** (1) *Successors*: generated people have no dormant `successor`; an adult child inherits (`family.ts`) and a death leaves a gap the realm fills, so nothing waits out of the world. (2) *The three hand-written dilemma and arc kinds* are pool entries by kind (`data/templates/depth/dilemmas.json`, `arcs.json`); the model chooses a kind and writes the words, code supplies every effect, and an arc waits only on days (so every stage is reachable). (3) The model's stories are queued only when the town has a background model (`Town` option `stories`), so a test or a `DIRECTOR=off` game never makes a call. (4) Priority inside the `persona-story` kind is first come, first served (the player's place is met first, so its people are first in the queue); a story shed from a long queue is asked for again, three a day, the player's place first. Measured with qwen3:4b a story takes about a minute, so `persona-story` costs 60 s in the budgets and `chronicle` ranks ahead of it and of `life-review` (the plan had it after both). (5) Step 9's 48 test files: the world-level tests were moved to generated worlds; the fixtures remain for NPC-mechanics tests, as decided.

## N25b: Lives that change

**Status:** ✅ Built (2026-10-13)

**Implementation plan:** [plans/n25b-lives-that-change.md](plans/n25b-lives-that-change.md)

**Goal:** the user's words: change people's "opinions and their life surrounding … periodically; this applies to all the NPCs", using "the embeddings and their relations with other NPCs … and also recent events in the place they live". Every person's opinions, feelings, goals, grudges, secrets and story keep changing with what happens to them, to the people close to them, and in their town.

**The rules:** code gathers what the person knows (events they saw or heard of, their memories recalled by meaning through embeddings, what their family, friends and rivals think and have been through, their town's recent events and conditions); for talking NPCs **the model proposes** changes in a periodic **life review**, each citing its reasons; **code checks** every proposal (real refs only, things they know, no invented names, limits per review, content rules) and applies it through the existing systems; everyone else changes by **code rules** from the same inputs (social pull toward the views of people they trust, moods from their town's conditions, goals from triggers). The model never decides a fact, a price or a number.

- [x] **Review inputs:** what the person knows since their last review; memories recalled by meaning (embeddings); the people who matter to them, with their views and recent lives; their town's events and conditions; their current opinions
- [x] **Code rules for everyone:** social pull, moods from conditions, goals from triggers, grudges and forgiveness; the fallback whenever the model is off or over budget
- [x] **The model's review** (`life-review` call kind) with a fixed proposal format: opinion, emotion, goal, grudge, forgive, fear, love, secret (from real facts), belief, arc step, story line
- [x] **Checks and limits:** refs from the input only, known subjects, ranges, invented-name check, content rules, per-review caps; clip and log
- [x] **Applying:** through the existing relationship, emotion, goal, grudge, rumour and arc code; each change an event with its why and causes; each review stored as a reflection memory with an embedding, so later reviews recall it
- [x] **When: batched every few days, at once for big events** (user decision 2026-10-13): everyone is reviewed every `REVIEW_EVERY_DAYS` (default 3), spread across the days; a war, a famine, a plague, a raid on their town, being attacked or robbed, or a death in the family triggers a review **that same day**, scaled by how close it is to them (themselves, family, friends, town, kingdom); talkers' reviews go several people per model call; one catch-up review on arrival elsewhere; townsfolk by code on the same schedule
- [x] **Admin:** a person's review history (each review: who made it, what changed and why, what was not applied) and how they see their lord and others; a townsperson's outlook. (A chart of views over time is not built.)
- [x] Balance bounds (opinions neither frozen nor runaway, goals churn, grudges settle, secrets real): they belong to N22's bound list, which is not built yet; the mechanisms that keep them are (limits per review, the settle toward nothing, goals that fade, grudges that expire, secrets only from real candidates)
- [x] Tests, README, this roadmap

- **Done when:** after the player robs a woman's brother, her trust in the player falls at her next review though she didn't see it (her brother told her), and her friend's falls a little later through social pull; when war is declared on a kingdom, everyone in it changes that same day; a famine worsens most of a town's mood and some decide to move; a widow's backstory gains a line about her husband's death; every change shows in the admin view with the review that made it; with the model off everyone still changes, and with it on a busy week stays inside N19's budgets without slowing conversation.

**Built:** `npc/review/` (types, inputs, rules, model, validate, apply, impact), `game/reviews.ts` (the scheduler), `game/people/outlook.ts` (townsfolk), the `life-review` call kind, `life_reviews` and `people.outlook` in the database (schema version 4), five new event kinds, admin sections, `npm run bench:reviews` and the review load in `bench:busy`. 48 tests in `tests/n25b.test.ts`, including the done-when scenarios.

**Differences from the plan:** (1) *Townsfolk opinions* live in one small JSON on their `people` row (`outlook`) rather than in the sparse `relationships`, `grievances` and `ambitions` tables: it travels with the row through the batch flush, the hash, export and lazy catch-up for nothing, and what they hold (how they see whoever rules, mood, one want, one grudge) is what a review of someone who doesn't talk needs; the three tables stay empty for N46 and N52. (2) Only the plain conditions flags and the famine line are read from a place's recorded days (never the levels of food and prosperity), because a lazy place's levels drift from a live one's through the realm's coin (N25.9): that keeps a lazy catch-up equal to daily. (3) Code's reviews of talkers run in one go (no waiting), so a world played without the model is the same every run; only the reflection memories (an embedding call each) land a moment later (`town.reviews.idle()`). (4) The shock sources wired today: a town's raid, war, famine or plague beginning; a death or wedding in a family; the player attacking, robbing or killing someone. The other weights (enslaved, lost post, a lord replaced, crackdown, birth) are in `impact.ts` for the systems that will make those events. (5) A shock that lands while the same person is being reviewed waits its turn; priority inside the kind is first come, first served. (6) The model's reply is held to a flat JSON Schema (`ModelReplySchema`) and each change is read on its own; a person missing from the reply, or with nothing usable in it, gets code's rules.

## N26: The open road

**Status:** ✅ Built (parts A–D, then Part E on 2026-10-14: everyone on the road is a real, trackable person, news travels by people through the inns, and people make real trips and migrate by need; see **What differs** below). Save v14 (a clean break, the user's call: no migration).

**Implementation plan:** [plans/n26-the-open-road.md](plans/n26-the-open-road.md)

**Goal:** travel is a journey, not a time skip. The player walks the realm between places through a world that is there: roads, people on them, roadside places, night, weather and things to stop for. A trip takes real playing time and is full of interaction.

**What exists:** N14's travel picks a route, skips the hours the distance takes (`hoursFor`, `TRAVEL_PER_DAY`) and rolls at most two encounters, fought in code. Between places there is nothing to walk through; N15's localities are the only maps outside a village.

**The rules:** the realm between places becomes walkable maps (chunks), generated with a seed from the realm's terrain, roads and rivers, so a stretch of road looks the same every time. A set **travel time scale** makes a day's walk take several real minutes of play (about 7 of walking), not hours and not an instant. To get that at the normal walking speed, a road tile passes *less* game time than a village tile, so the clock runs faster on the road (user decision 2026-10-13). Everything met on the road is real: travellers are the realm's people actually moving (N33's carriers, caravans, armies, adventurers, runaways), not spawned for the moment.

- [x] **Walkable realm:** chunk maps between places, by terrain (plains, forest, hills, marsh, coast), with the road through them, rivers, bridges, fords and ferries; walk from one chunk into the next; N14's routes become the roads on these maps
- [x] **Time on the road:** a travel time scale per tile; day and night, weather (N30) that slows and soaks; the header shows the day and how far to the next place
- [x] **People on the road:** merchants and caravans, pilgrims, messengers, patrols, refugees from a war (N55), runaways (N59), adventurer parties (N42), bandits; all real and on their own journeys. They can be talked to, traded with, travelled with, robbed or helped, and they carry and give news (N33)
- [x] **Roadside places:** inns and waystations, farmsteads, hamlets, shrines, toll gates, milestones and signposts, crossroads, bridges with keepers, ferry crossings; each with people living there (N16) and its own small happenings
- [x] **Situations, not just fights:** a broken cart, an injured traveller, a toll demanded, papers checked under a crackdown (N58), a quarantine line (N61), a flooded ford, a beast on the road, an ambush; each a choice with consequences on the normal systems
- [x] **Nights:** find an inn or camp; a fire, a watch, rest (N6's needs), night sounds and night encounters; companions talk by the fire (N8's companions)
- [x] **Supplies and mounts:** food and water run down; buy, forage or hunt on the way; walk, ride a horse, take a cart or a river boat, each with a speed and a cost, and horses that need care and can be stolen
- [x] **Travelling with others:** join a caravan for safety, take an escort job (N42), hire a guide
- [x] **Fast travel only as a choice:** only along roads the player has already walked, and it still stops for anything worth stopping for (N35); a paid coach or boat as the in-world way to skip a known stretch
- [x] Performance: chunks streamed and simulated by level of detail (N25), inside N19's budgets
- [x] Tests, README, this roadmap
- [x] **Part E: everyone on the road is someone** (user request 2026-10-14; [plan](plans/n26-the-open-road.md#part-e-everyone-on-the-road-is-someone-rework-asked-for-2026-10-14)): no traveller is made up for a journey; every party member is a person row (or a figure with one) the admin view can find, pin and follow; people can be `away` from home without leaving it, and nobody is in two places at once
- [x] **Real trips with real reasons:** farmers to market and back, caravans run by a town's own merchants, carters and guards, visits to kin in other places, labourers seeking work (some stay), pilgrims, patrols of a town's guards, tax collectors carrying the coin, crown couriers, adventurers who are the delving figures themselves (the delve happens when they arrive), refugees from war or famine
- [x] **Visitors in towns and inns:** travellers staying in a town or at an inn are in its crowd and can be talked to
- [x] **Migration as a journey:** households depart, walk the days between and only then become residents; destinations weigh food, prosperity, safety, crowding, kin already there, work and law, across kingdoms for the free
- [x] **News by people, through inns:** the computed relay goes; a place hears news only when a traveller brings it; travellers swap news at the inns along the road; couriers carry great news; the chain of who carried it is in the record
- [x] **Off-screen meetings:** journeys passing a gang's ambush or a hungry pack are resolved in code (robberies, injuries, deaths on real people, news of it); patrols make roads safer
- [x] **Situations with people who are really there:** actors are travellers near that stretch of road or residents of the nearest roadside place; no suitable person, no situation

- **Done when:** walking from Millbrook to Highdale takes a set number of real minutes over several chunk maps; on the way the player meets real travellers (one carries news the player didn't have), stops at a roadside inn for the night, helps or ignores someone in trouble with consequences later, and sees the same road again on the way back; fast travel is offered only for the stretch already walked. **Part E done when:** over 60 days every person on every road is a person row the admin view can find and follow, nobody is in two places at once, people go to market, visit kin, seek work, migrate toward better places and arrive days later, news reaches a town only when someone brings it (swapped at inns along the way, couriers for great news), and a caravan robbed off-screen changes the realm.

**Built:** `packages/shared/src/road/` (scale, noise, types, geometry, graph, chunk, journey), `packages/server/src/game/road/` (generateRoads, waystations, ground, walk, hud, play, journeys, paths, presence, exchange, encounters, day, trips/ (market, caravan, kin, work, pilgrimage, patrol, officials, couriers, config, common), situations, threats, needs, mounts, camp, fast, coach, caravans, bounds), `admin/roads.ts`, the admin page's Roads tab, 14 situation files in `data/situations/`, the client's `RoadLayer`, `travellers.ts`, `roadData.ts`, `ui/roadbar.ts`, `tests/n26.test.ts` (28 tests, including each done-when of A–D) and `tests/n26e.test.ts` (20 tests: Part E).

**What differs from the plan:**
1. *Road data is derived, not saved:* a pure function of the realm's seed, its settlements' positions and its road list (`roadDataOf`, cached), so nothing was added to the save for it and there are no chunk overrides yet (nothing changes a tile). The player's place on the road is global tile coordinates (`player.road`), not `{cx, cy, x, y}`; the chunk is derived.
2. *Waystations are hamlets:* instead of a new "w:" site kind, each inn is a settlement of kind hamlet (`Settlement.way`) beside the road with a lane to it, so it has people who live (N25), an innkeeper, a map, news and everything else for free. They have no roads in the graph. This is 60 or so more places in a realm; the realm's day is about twice as slow (about 20 ms), and world generation is faster than before (roads are only built once).
3. *Journeys are in the save* (`realm.journeys` since Part E, a few hundred records) rather than a SQLite table with a chunk index; the browser is sent the ones within 900 tiles. Every member of a party is a `people` row marked `away` (Part E; nobody is made up), or, for adventurers, the delving realm figure.
4. *Messengers and `reachesAt`:* built first as a relay along the real roads; **replaced by [Part E](plans/n26-the-open-road.md#part-e-everyone-on-the-road-is-someone-rework-asked-for-2026-10-14)**: the relay and the invented messengers are gone, `reachesAt(realm, news, site)` is the day the place first heard it or `null` (not yet), and news is carried by real travellers and swapped at the inns.
5. *Part E, what differs from its plan:* (a) journeys, what each place has heard (`realm.heard`: place → news id → [day, told from, journey]) and tax coin in transit (`realm.transit`) live in the **realm**, not on `SiteState`/`world`, so lazy places and sims hear and send too; `SiteState.newsSeen` stays what a place has *told* its talkers. (b) A round trip is one journey with a turn (`journey.turn`), and `placeAt(journey, minute)` says whether they are on the road, at an inn or visiting a town; visitors are rows from other places added to a town's crowd by `rosterFromStore`. (c) Migration departs households as journeys (`departHouseholds`) and applies the move on the day after they arrive (`arriveHouseholds`); with no road or no room for a journey the move is made at once, as before. (d) Places that send trips are brought up to yesterday first (`ensure`), so a lazy place gives the same trips as a daily one; the N25.9 lazy test now uses seed 2 (seeds where a lazy place's lagging population moves coin were never equal). (e) Tax coin goes with a clerk and is handed over when he reaches the lord (a day later if nobody can be sent), so coin climbs the chain a level a trip instead of all at once. (f) Adventurers are the delving figures (`Figure.away`); the delve is fought on arrival. (g) A new job `courier` in capitals and cities; great news (importance 7+) that reaches one is sent to the kingdom's towns on a tour. (h) Kin trips only start once families span places (the first people have no kin yet), so they are rare early. (i) The admin Roads tab lists every journey (people clickable, news with its chain); a person's card and a place's card show who is away and who is visiting; pinned travellers are drawn on the realm map. Bounds: `roads-not-empty`, `roads-not-clogged`, `news-reaches`, `nobody-twice`, `trips-return`, `migration-follows-need` (`road/bounds.ts`).
6. *Encounters:* the two-roll system is gone from the web game (a pack's ground and a gang's ambush are places); the CLI's `/travel` keeps the old time skip, since it has no screen to walk on.
7. *Not built:* river boats (the realm has few places on a river), the "ferry" as a boat you ride (it is a ford with a ferryman's toll), companions' night lines by the model (they are code's words), the darker sight at night (the sky darkens as before), `ROAD=slice` (the whole realm is walkable).

## N27: The wilds

**Status:** ⬜ Planned

**Implementation plan:** [plans/n27-the-wilds.md](plans/n27-the-wilds.md)

**Goal:** off the road the world is open to explore: places to find, ways to get lost, and things no one has told the player about.

**The rules:** the land away from roads is walkable chunks too (N26), by terrain, with points of interest placed by seed and by the realm's state (a pack's lair where its pack lives, a hidden camp where a gang or liberation group really is). Nothing is on the player's map until they find it or hear of it (N65).

- [ ] **Points of interest:** caves, ruins, abandoned villages (N13's emptied hamlets), old battlefields (N55), standing stones, groves, hermits' huts, shrines, beast lairs, hidden camps (N15, N59), dungeon mouths, herb patches and ore outcrops
- [ ] **Discovery:** finding a place puts it on the player's map and is news if it matters; an ore outcrop or a ruin the player finds is an N63 find they can tell a settlement about (or sell, or keep)
- [ ] **Getting lost and finding the way:** off-road travel is slower; without a map, a guide or skill the player can lose their bearings; maps bought from merchants or drawn by the player
- [ ] **Living wilds:** game and beasts move by ecology (N60), seasons change the land (N30), weather is harsher, nights are dangerous
- [ ] **People out there:** hunters, prospectors, hermits, outlaws, runaways in hiding, explorers on N63 trips; each real and somewhere for a reason
- [ ] **Secrets in the land:** ruins with a story from the realm's history (N68), a lost camp with clues to what happened, a grave with a name
- [ ] Tests, README, this roadmap

- **Done when:** leaving the road east of Millbrook the player finds a cave not on any map, a ruin from an old war with a named grave, and an ore outcrop they can report to the mayor; they get lost in the marsh at night without a guide; a hidden runaway camp is found exactly where the realm says the runaways are.

## N28: Fauna and flora

**Status:** ⬜ Planned

**Implementation plan:** [plans/n28-fauna-and-flora.md](plans/n28-fauna-and-flora.md)

**Goal:** the land is full of living things: many animals and plants, different in every terrain and season, that the player and NPCs notice, use, hunt, gather, fear and learn about.

**What exists:** creatures are a short list made for fighting (wolves, bears, boars, giant spiders, horses, bandits; N3.2, N13.6). Herbs, pelts and ore come from foraging (N15) as items, not as living things on the map.

**The rules:** species are data files (like creatures and templates), each with the terrains and seasons it lives in, how common it is, how it behaves, what it eats or needs, and what it's good for. Where each lives on a map is placed by seed from terrain, season and the realm's state (N60's populations), so the land looks and behaves the same on every visit and changes with the year. Most wildlife is light: drawn and simulated cheaply (N19's budgets), and only becomes a full creature when hunted, provoked or tamed.

- [ ] **Animals by terrain:** in the forest deer, boar, foxes, badgers, owls, woodpeckers; in the hills goats, eagles, hares; in marshes herons, frogs, eels, midges; on plains rabbits, partridges, skylarks; on coasts and rivers gulls, otters, fish, crabs; in caves bats and stranger things; around villages cats, dogs, rats, crows, pigeons and livestock
- [ ] **Behaviour:** herds and flocks, grazing and fleeing, nests and dens, day and night animals, birdsong at dawn, migration with the seasons (N30), animals that follow the plough or raid the grain store
- [ ] **Plants by terrain and season:** trees (oak, ash, pine, birch, willow, fruit trees), flowers and grasses, herbs, mushrooms, berries, reeds, crops in the fields; budding, flowering, fruiting and dying back through the year (N30)
- [ ] **Uses:** food, medicine and poison (N8's injuries and illness, N61's plague cures), dyes, timber, fibre, hides and feathers, alchemy and crafting (N10); rare ones worth a lot and sought on the quest market (N42)
- [ ] **Signs in the land:** tracks, droppings, broken branches, a silent wood before a predator; skill shows the player what they mean
- [ ] **Hunting, fishing, gathering and taming:** traps, bows, nets, rods; seasons when it's forbidden or a lord's right (N48's poaching); taming a dog, a hawk or a horse; NPC hunters, herbalists, foragers and fishers doing the same for their living (N38, N40)
- [ ] **Knowledge:** a bestiary and herbarium in the player's journal (N65) that fills in as they see, are told about or study species; herbalists and hunters can teach; wrong identification has consequences (the wrong mushroom)
- [ ] **In culture and belief:** sacred animals and trees, omens from birds (N50), regional dishes (N53), animals in songs and names (N68)
- [ ] **Beyond the ordinary:** rare and strange creatures and plants in deep wilds and dungeons, with legends about them, seen by few
- [ ] Tests, README, this roadmap

- **Done when:** a walk through the woods east of Millbrook shows deer that flee, birds at dawn and different flowers in spring and autumn; the player tracks a boar by its signs, gathers a herb that cures a fever and a mushroom that sickens them, fishes the river, and tames a stray dog; the bestiary has the species they've met; an NPC herbalist goes out at the right season for a rare root and sells it.

## N29: A soundscape

**Status:** ⬜ Planned

**Implementation plan:** [plans/n29-a-soundscape.md](plans/n29-a-soundscape.md)

**Goal:** the world sounds alive: places, times, weather, crowds and wildlife each have their own sound.

**The rules:** ambient sound is chosen in the client from state the client already has (place, area, time, weather, N16's crowd nearby, N28's wildlife, N36's mood), so it costs no server time. Speech stays with the existing voices (Piper, T14).

- [ ] **Place and time:** birdsong at dawn, a busy market by day, crickets and owls at night, a silent street under curfew (N58), bells from the temple
- [ ] **Weather and season:** rain on roofs and on the road (N26), wind in the hills, snow's hush, thunder (N30)
- [ ] **Crowds and work:** murmur by crowd size, the smith's hammer, the mill, carts, livestock, children playing
- [ ] **Wildlife:** each species' calls where it lives (N28); a wood going quiet before a predator
- [ ] **Events:** battle at a distance, a fire's roar and shouting (N62), a festival's music, a bard in the inn (N41)
- [ ] **Mood:** a grieving town is quieter (N36)
- [ ] Volume and mix settings; off by default in tests
- [ ] Tests, README, this roadmap

- **Done when:** standing in Millbrook's square from dawn to night the sound changes with the hour and the crowd, rain is heard on the roofs in a storm, the woods have birdsong by day and owls by night and go quiet when wolves are near, and a curfew night is silent but for the watch.

## N30: Seasons and the farming year

**Status:** ⬜ Planned

**Implementation plan:** [plans/n30-seasons-and-the-farming-year.md](plans/n30-seasons-and-the-farming-year.md)

**Goal:** the year has a rhythm that every system follows.

**The rules:** the calendar decides the season; the season changes what code does: food made, prices, schedules, travel, beasts and festivals. Seeded weather (N6) is weighted by season.

- [ ] Planting, growing, harvest and winter: farm output by season, stores that run down over winter, a lean late winter
- [ ] Prices follow stores (N10's demand prices); hunger in a bad winter feeds N13's starvation and migration and N56's grievances
- [ ] Schedules by season: long days at harvest, short days in winter, townsfolk (N16) indoors more
- [ ] Travel: snow closes high roads, mud slows them; beasts migrate and are hungrier in winter
- [ ] Seasonal festivals in every kingdom (planting, midsummer, harvest home, midwinter), filling squares as N16's festival does
- [ ] The season shows on the map (snow, bare fields, harvest stooks)
- [ ] Tests, README, this roadmap

- **Done when:** over a simulated year Millbrook's stores rise at harvest and fall in winter, bread costs more in late winter, a high road closes with snow and reopens, and each season's festival fills the square.

## N31: Visible consequences on the map

**Status:** ⬜ Planned

**Implementation plan:** [plans/n31-visible-consequences.md](plans/n31-visible-consequences.md)

**Goal:** what happened can be seen where it happened.

**The rules:** a place's map is still generated from a seed (N15), and its **marks** (damage, works in progress, graves) are laid over it from the realm's state. Marks fade or are repaired over time in code.

- [ ] Burned and broken buildings after a raid, fire (N62) or war, repaired as the place rebuilds (N13 building)
- [ ] Scaffolding while something is built; the new building when it's done
- [ ] A graveyard that grows, each grave with a real name and date (from N25's deaths); hover to read it
- [ ] Empty stalls and thin crowds in a famine; extra guards and empty streets under a curfew (N58); banners of a new ruler or faction
- [ ] Smoke from chimneys, lit windows at night by who's home (N16's roster)
- [ ] Tests, README, this roadmap

- **Done when:** after a raid on Millbrook the player sees burned houses that are rebuilt over the following weeks, the graveyard has a grave for each person killed, and the market's stalls empty during a famine.

## N32: Interiors and homes

**Status:** ⬜ Planned

**Implementation plan:** [plans/n32-interiors-and-homes.md](plans/n32-interiors-and-homes.md)

**Goal:** buildings can be entered, and a home shows who lives there.

**The rules:** every building gets an interior map, generated by seed from its kind and its owner's class, wealth and trade (N16's roster), so a serf's hovel, a merchant's house and a lord's hall differ and stay the same between visits. Belongings are kept per household, cheaply (N18), and become real items when touched.

- [ ] **Interiors:** homes, workshops, inns, temples, halls, shops, prisons (N48), guild halls; rooms, furniture and goods by wealth and trade
- [ ] **Belongings:** what a household owns, where it's kept; hidden things (coin under a floorboard, letters, N46's secrets in a drawer)
- [ ] **Life indoors:** people at home by their day (N16), eating, sleeping, working, quarrelling; family scenes
- [ ] **Trespass:** locked doors, people who notice an intruder, guards called (N7's theft and stealth, N48)
- [ ] **Change:** homes show fortune and misfortune (a new table after a good year, bare rooms in famine, damage after a raid, N31); the player's own home (N66) furnished by them
- [ ] Tests, README, this roadmap

- **Done when:** the player walks into a serf's hovel and a merchant's house in Millbrook and they look as different as their owners are; at night the family is asleep inside; the player finds a hidden letter in the mayor's desk that is one of his real secrets, and a servant who sees them raises the alarm.

## N33: Gossip for everyone

**Status:** ⬜ Planned

**Implementation plan:** [plans/n33-gossip-for-everyone.md](plans/n33-gossip-for-everyone.md)

**Goal:** every person in the world takes part in gossip, not just the cast and the people the player has talked to, and news travels between places with real carriers.

**The rules:** pairwise checks for every person every hour won't scale, so:
- **Who meets:** people are grouped by where they actually are (workplace, inn, market, home, from N16's `CrowdSim`); pairs are sampled within a group, weighted by sociability and relationship.
- **What they know:** each townsperson keeps a compact record (news id, accuracy, who told them, when), not full memories. Full memories start when they become a talking NPC, seeded from that record.

- [ ] Group-based meeting and pair sampling for townsfolk, at the level of detail from N25
- [ ] Compact knowledge per person; credence from trust and affection as in N7 (`credence`)
- [ ] **Between places:** news travels with carriers (real travellers, caravans, migrants, adventurers, crown couriers: N26 Part E, swapped at inns and stops); it arrives late and can be distorted
- [ ] Retelling loses accuracy (N7's rumours), now for everyone
- [ ] Townsfolk's knowledge carries into their persona when the player first talks to them
- [ ] Tests, README, this roadmap

- **Done when:** a death in Millbrook reaches a labourer in Highdale only after a caravan or traveller has gone between them; a townsperson the player has never met can tell the player a rumour, slightly wrong; 3,000 people in a capital gossip without dropping below 60 fps.

## N34: Following people in the game

**Status:** ⬜ Planned

**Implementation plan:** [plans/n34-following-people.md](plans/n34-following-people.md)

**Goal:** the player can follow people they care about from inside the game, and hears about them as news reaches them.

**The rules:** the in-game version of N17's pin, bound by what the player knows (N24): following someone means news of them is noticed and kept when it reaches the player, not that the player sees them.

- [ ] Follow friends, family, rivals, a nemesis (N44), a famous adventurer
- [ ] Word of them when it arrives ("your brother made sergeant", "Greyfang was seen near Highdale"), with source and how sure
- [ ] Letters: followed people (and the player) can send and receive them by carriers (N33)
- [ ] A followed list in the journal (N65) with each person's last known whereabouts
- [ ] Tests, README, this roadmap

- **Done when:** the player follows a friend who leaves for Highdale, hears weeks later from a caravan that she married there, and gets a letter from her that arrives days after she sent it.

## N35: Moving through time

**Status:** ⬜ Planned

**Implementation plan:** [plans/n35-moving-through-time.md](plans/n35-moving-through-time.md)

**Goal:** the player gets past the slow parts of a big simulation without missing what matters.

**The rules:** waiting and travelling run the world fast (N25's levels of detail and catch-up) and stop when something happens that the player would care about: to them, to people they follow (N34), or where they are.

- [ ] "Wake me when…": something happens to someone I follow, a person arrives, a job is posted, a season turns, a set time
- [ ] Fast travel only along roads already walked (N26), and it stops for real events on the road (people, situations, news from a passing traveller)
- [ ] Skip days or a season, with a summary of what the player heard while time passed
- [ ] Tests, README, this roadmap

- **Done when:** the player waits "until something happens to someone I follow" and is woken when their friend in Highdale falls ill; a season skip ends with a short list of the news they heard; fast travel stops for a gang on the road.

## N36: The mood of a place

**Status:** ⬜ Planned

**Implementation plan:** [plans/n36-the-mood-of-a-place.md](plans/n36-the-mood-of-a-place.md)

**Goal:** a place has a shared mood that people feel and act on.

**The rules:** a place's mood (grief, fear, anger, joy, hope, unease) is computed in code from recent events weighted by how many there felt them, and decays. It shifts chatter, prices, willingness to help, N38's scoring and N58's unrest.

- [ ] Mood from events: a massacre (grief), a curfew (fear), a tax hike (anger), a good harvest or a victory (joy)
- [ ] Mood in chatter, NPC personas, prices and how strangers (the player) are treated
- [ ] Mood on the map and in the admin view
- [ ] Tests, README, this roadmap

- **Done when:** after a raid kills several people Millbrook is in grief, its chatter and prices show it and it fades over weeks; a festival after a good harvest lifts it to joy.
