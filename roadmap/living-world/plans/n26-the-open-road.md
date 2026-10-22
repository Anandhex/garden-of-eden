[← Plans](README.md) · [Stage 2: N26](../stage-2-everyone-lives.md#n26-the-open-road)

# N26 plan: The open road

**In one line:** the land between places becomes walkable chunk maps generated from the realm by seed; travellers on it are the realm's real people on real journeys, placed by a formula of time like the crowd; roadside places have residents; nights, supplies, mounts and situations make a trip something to play, and fast travel is only along roads already walked.

**Read first:** [plans README](README.md) sections 2 (determinism), 7 (shared code), 9 (performance). Needs N18 (storage), N19 (budgets), N25 (people who can travel and live at roadside places). This is the largest phase in the set; it's split into four parts that can each be finished and played.

## What exists

- **Travel today** ([`realm/travel.ts`](../../../packages/server/src/game/realm/travel.ts)): `route(realm, from, to)` (Dijkstra over `settlement.roads`, straight lines between settlement positions), `hoursFor(distance)` with `TRAVEL_PER_DAY = 45` map units, `setOut(…)` rolls up to `MAX_ENCOUNTERS = 2` (packs, gangs, wars) fought in code, then `arrive`. The server's `Town.setOutFor`/`arriveAt` lets the world live the hours.
- **The realm map:** `REALM_W × REALM_H = 1000 × 700` units; settlements have `pos`, `terrain` (valley, hills, forest, plains, coast, marsh) and `roads` (ids). No rivers, no road shapes, no terrain between places.
- **Site maps** ([`web/sites.ts`](../../../packages/server/src/web/sites.ts)): `siteMap(site, area, realm)` → `SiteMap` (tiles, buildings, exits, dens, zones), seeded per place and area; localities (woods, mine road, camp, mine) are 26×18 maps reached through edge exits, `AREA_WALK_MINUTES = 15`. Tile types: `grass | path | water | tree | wall | door` ([`web/map.ts`](../../../packages/server/src/web/map.ts)).
- **Movement:** the client walks a path one step at a time, each step a `POST /api/move` the server validates (`move(dx, dy)`); a step is one game minute (`MINUTES_PER_STEP`); the player's sprite animates a step in 80 ms, so walking runs at roughly 8–12 steps per real second including the round trip.
- **Time:** a game minute every 2 real seconds standing about; the realm advances a day at a time.
- **The crowd** ([`shared/src/crowd.ts`](../../../packages/shared/src/crowd.ts)): positions are a pure function of roster, map and clock, computed the same way on server and client; nothing per step goes over the wire. **Copy this pattern for travellers.**
- Weather: `weatherOn(day)`, `seasonOf(day)` ([`weather.ts`](../../../packages/server/src/game/weather.ts)). **The player has no needs today** (no hunger, thirst or fatigue in `PlayerState`); only the cast has them ([`needs.ts`](../../../packages/server/src/game/needs.ts)). Part D adds the player's.
- **Names are seeded.** The roadmap says "Highdale", but no settlement is fixed with that name (seed 1's Millbrook neighbours are Oakhurst and Raldale). Millbrook's liege town is generated a day's walk away ([`generate.ts`](../../../packages/server/src/game/realm/generate.ts)). **Use "Millbrook's liege town" wherever the roadmap says Highdale**, or fix a seed for the slice and use its name.

## Decisions made in this plan

1. **Coordinates.** One global tile grid over the realm: `TILES_PER_UNIT` tiles per realm map unit. A chunk is `CHUNK = 64 × 64` tiles. Chunk `(cx, cy)` covers realm units `[cx·64/TPU, (cx+1)·64/TPU)`. The player's position between places is `{ cx, cy, x, y }` (tile in chunk); in a place, it's the site map as today. `player.site = null` while on the road; add `player.road?: { cx, cy, x, y }`.
2. **The time scale is a choice of real minutes; everything else follows.** Pick `REAL_MINUTES_PER_DAY_WALK` (open decision: default 5–10; start at 7). With a measured walking rate `STEPS_PER_SECOND` (≈ 10 when holding a direction; measure it), a day's walk is `tiles = 7 × 60 × 10 = 4,200` steps. A day's walk is `TRAVEL_PER_DAY = 45` units, so `TILES_PER_UNIT ≈ 93`. If a day's walk is ~10 hours of walking (the rest is rest), each step on the road is `600 / 4,200 ≈ 0.14` game minutes.
   **This contradicts the stage file's "a tile takes more game time than in a village"** (a village step is 1 game minute). Both can't hold with walking at the same speed: if a road tile took more than a minute, a day's walk would be under 600 steps, about a minute of real time. **Decided (user, 2026-10-13): the real-minutes target wins** (it's what the player feels), so road tiles take *less* game time than village tiles, and the header shows the clock moving faster on the road. The stage file has been updated to match. Keep all three numbers in `server/src/game/road/scale.ts` with the derivation in a comment, so changing one recomputes the others.
3. **Chunks are generated, not stored.** `chunkAt(seed, realmRoadData, cx, cy)` in `packages/shared/src/road/chunk.ts`: a pure function returning tiles and features. Same input → same chunk, on server and client. The server sends the client the realm's road data once (roads, rivers, waystations); the client generates chunks itself. Only changes (a felled tree? no; a built bridge, a burnt inn) are stored, as **overrides** per chunk in SQLite (`chunk_overrides(cx, cy, x, y, tile)`), rare.
4. **The realm gains road geometry.** Roads stop being straight lines: at realm generation, each road becomes a polyline (`roadPaths: Record<roadId, Array<{x, y}>>`) bent by noise around hills and marsh; rivers are generated as polylines from hills to coast; where a road crosses a river: a bridge (with a keeper) on main roads, a ford or ferry on small ones; waystations (inns) about every half to whole day's walk on main roads; farmsteads, shrines, milestones, signposts at junctions, toll gates at kingdom borders. All in `realm.road` (new schema part), generated once. v11 is a clean break, so this is just generation.
5. **Terrain per tile** from the nearest settlements' terrains blended with noise (value noise from the seed); biomes: plains, forest, hills, marsh, coast, river, road, bridge, ford, field, farmyard. Extend `Tile` with the new kinds and draw them in the client (`textures.ts`).
6. **Travellers are journeys, positioned by formula.** A journey: `{ id, party: personRefs[], kind, from, to, path: roadIds, depart: absMinute, pace: tilesPerMinute, stops: [{ at, minutes }], purpose, cargo? }`. Its position at time t is a pure function (distance along path = pace × time moving, minus stops). Nothing simulates them step by step. The client computes the positions of journeys in its loaded chunks from the journey list the server sends for those chunks (`GET /api/road/journeys?chunks=…`), like the crowd. When the player interacts with a traveller, the server computes the same position and checks it.
7. **Who travels is the realm's real activity, as journeys:**
   - **Caravans** from trade (`tradeTreaties`, markets), between settlements on trade roads; with merchants (people rows) and guards.
   - **Messengers / news carriers:** news spreads outward from where it happened as a relay: a carrier journey along each road out of that place, and at each settlement it reaches, new carriers along that place's other roads (only for news important enough to carry that far; cap the relay depth by importance). The relay's arrival at a place **is** N24's `reachesAt(news, site)` for that place, so every place's news clock (N24 step 2b) and the carriers on the road agree. Make `reachesAt` read the relay's arrival times once N26 exists, so the two can't disagree. Carriers carry and give news (N33 hooks into this; for N26 the player learns news from a carrier met on the road: `playerLearns(ref, "told", carrier)`).
   - **Patrols** along a kingdom's roads; **pilgrims** to temples; **refugees** from war (N25's migrations become journeys: households walking); **adventurer parties** going to delve (`dungeonsDay`'s delves); **bandits** don't travel: they hold an ambush spot near their camp on a road.
   - **Migrants** (N25 households) walk, so a migration takes days, and the household is on the road meanwhile.
   Journeys are created by the realm day (for the next day's departures) and stored in a table; finished ones pruned.
8. **Encounters become things you meet.** The old two-roll encounter system goes. A pack's hunting ground, a gang's ambush point, an army's march are features or journeys on the map. Walking into their range starts the existing fight code. Fast travel (decision 10) stops for them.
9. **Situations are data.** `server/src/data/situations/*.json`: `{ id, where: ["road", "ford", "bridge", …], when: { weather?, season?, night?, crackdown? }, chance, actors: [...roles], choices: [{ id, label, requires?, outcome: effects[] }] }`, with effects in the normal systems (money, items, relationship, reputation, an event with a cause, a journey delayed, a person injured). Rolled per road segment per day with `streamFor(seed, "situation", segment, day)`, so a broken cart is in the same place for everyone who passes that day. Schema-checked by `check-npcs`.
10. **Fast travel:** `player.walked: Set<segmentId>` (a segment = a road between two consecutive waypoints: settlement, waystation, junction, bridge). Fast travel is offered only along a path made entirely of walked segments. It runs time forward along the route; before each segment it checks for anything worth stopping for (a journey or feature of interest within range, a situation rolled for that segment that day, a news carrier with news the player doesn't know, nightfall without shelter) and stops there. Paid coaches (between towns on main roads) and river boats skip known *and* unknown stretches for money, and stop only at their own stops.

## Questions for the user (ask before Part A)

1. ~~The time scale~~: answered 2026-10-13: a day's walk is about 7 real minutes of walking, and road steps pass less game time than village steps (decision 2).
2. Is holding a direction key the main way to walk long roads, or click-to-walk far ahead? (Affects whether we need a "keep walking along the road" auto-walk.)
3. Should the slice's road be Millbrook → its liege town (a day's walk), or a specific seeded neighbour?

## Part A: the walkable realm (the slice needs this)

### A1. Road geometry in the realm
- `game/road/generateRoads.ts` called from `generateRealm`: road polylines, rivers, crossings (bridge/ford/ferry), waystations, farmsteads, milestones, signposts, toll gates. Add to `RealmSchema` as `road: { paths, rivers, crossings, places }`.
- Place a settlement's **footprint** on the global grid (its site map's size in tiles, centred on its position).
- Test: every road path starts and ends at its settlements' footprints; every river crossing on a road has a crossing; same seed → same geometry.

### A2. Chunk generation (shared)
- `shared/src/road/noise.ts` (seeded value noise; no dependencies), `shared/src/road/chunk.ts`: `chunkAt(seed, road, cx, cy)` → `{ tiles: Uint8Array (64×64 tile kinds), features: [...], exits? }`. Rasterise road polylines (2–3 tiles wide for main roads), rivers (with banks), crossings; terrain by blended biome + noise; trees in forest, rocks in hills, reeds in marsh.
- Pure and fast: a chunk in under ~5 ms on the M2 (the client generates 9 at a time).
- Test: same chunk twice is byte-equal; chunk edges line up (the road tile at the right edge of chunk (3,2) continues at the left edge of (4,2)); a road is walkable end to end between two settlements (path-find across chunks in a test).

### A3. Walking between chunks and places
- Server: `player.road`; `move(dx, dy)` on the road checks the chunk tile (with overrides) instead of a site map; crossing a chunk edge changes `cx/cy`; stepping onto a settlement's footprint enters its site map (at the matching gate), and leaving a site map by its road exit puts the player on the road at the footprint's edge. Localities (woods, mine road…) stay as they are for now; N27 decides whether they merge into the chunk world.
- Each road step advances the clock by the road step time (decision 2), via the same `walkMinutes`/`passHours` paths so the world lives it.
- Client: a road mode in `WorldScene`: a tilemap per loaded chunk (3×3 around the player), loaded/unloaded as the player moves; the camera follows; the header shows day, time, and "≈ N hours to <next place>" along the road.
- The Realm tab's "Travel here" now means "set a destination": it shows the route and a "walk" button that auto-walks along the road (question 2), stopping when something happens.
- Test: walk (programmatically) from Millbrook's gate to the liege town along the road; it takes about `tiles` steps and about the expected game hours; the realm advanced that many days.

### A4. Performance
- Only the 3×3 chunks near the player are generated on the client; the server generates a chunk only to validate moves (cache the last 9).
- Inside N19's budgets: chunk generation, journeys in view, and the step round trip.

## Part B: people on the road (the slice needs B1–B3)

### B1. Journeys
- `game/road/journeys.ts`: the journey type, `positionAt(journey, absMinute)` (shared, in `shared/src/road/journey.ts`), creation in the realm day for tomorrow's departures, a SQLite table `journeys` with an index on the chunks each journey passes (`journey_chunks(journey, cx, cy)`), pruning of finished journeys.
- `GET /api/road/journeys?chunks=cx:cy,…` → journeys passing those chunks today (with party names, kind).

### B2. Sources of journeys
- Caravans (trade), messengers (news: make `reachesAt` the carrier's arrival), patrols, pilgrims, adventurers to dungeons, N25's migrant households and refugees. Each source is a small function in `road/sources/*.ts`, so it's testable alone.
- Bandit ambush points: a feature on the road segment nearest the gang's seat, active by the gang's activity.

### B3. Meeting travellers
- Client draws journey parties at `positionAt` in loaded chunks, with names and kind on hover ("Merchant caravan of the Gold Road, to Ashcross").
- Talk to a traveller: they're people rows; talking makes them a talking NPC like a townsperson (`townsfolkPersona`, with "on the road to X" in their file). They know the news they carry (carrier) and what they saw.
- Trade with merchants (only traders sell, as N16); travel with a caravan (the player's pace locks to it; safer: bandits weigh the caravan's guards); rob or help (normal crime/reputation systems; a robbed caravan is an event with consequences: the trade it carried doesn't arrive).
- Test: on the road from Millbrook, the player meets a carrier with news they don't know; talking to them makes the player know it (N24).

## Part C: roadside places, situations, nights

### C1. Roadside places
- Waystation inns, farmsteads, shrines, bridges with keepers, ferries, toll gates: each a small site map (reuse `sites.ts`' generator with new small layouts) entered from its road footprint, with residents as people rows (`site = "w:<id>"`, created at world generation with N18's materialisation and living by N25's rules: a roadside site is a tiny place).
- The inn sells food, drink and a bed (meals and rest restore the player's needs, D1); news is exchanged there (travellers staying the night are there in the evening: journeys stop at waystations).
- Toll gates charge by kingdom; milestones/signposts show distances on hover.

### C2. Situations
- The data format (decision 9), 10–15 starting situations: broken cart, injured traveller, toll demanded, papers checked (hook for N58 crackdowns; off until then), flooded ford (after rain), beast on the road, ambush (the gang's ambush point), lost child, a merchant offering a deal, a funeral procession, a patrol searching for an outlaw.
- Each choice's effects go through normal systems and record an event (caused by the situation), so N20/N21 can trace "you helped the carter; the carter later…".
- Test: each situation file passes the schema; a helped injured traveller records an event and changes the relationship; ignoring them, a later event (they died or arrived) is linked.

### C3. Nights and weather
- Darkness reduces sight (fewer tiles drawn clearly; journeys stop at night except messengers); camping: a "camp" action off the road, a fire, a watch (companions take turns), rest; night encounters roll by segment and hour.
- Weather slows walking on bad days (rain: step time ×1.2; snow ×1.5; storm: rest advised) and soaks (needs). Use `weatherOn(day)` until N30.
- Companions talk by the fire: one background line per companion per night from N8's companions (template words unless the budget allows a model line).

## Part D: supplies, mounts, fast travel

### D1. Supplies
- The player gets needs for the first time: `player.needs = { food, water, rest }` (0–100), modelled on the cast's [`needs.ts`](../../../packages/server/src/game/needs.ts). They fall per game hour on the road and in the wilds; in a place they're topped up by meals at the inn or home (keep town play free of chores: only decay outside places). Buy at inns and markets, forage (N28 later; today's foraging until then), hunt. Low values give penalties through statuses (`status.ts`): slower steps, worse checks; at zero, HP loss. Do D1 before C1's inn so a bed and a meal mean something.

### D2. Mounts and carts
- Horse (2× pace), cart (1.3× pace, carries goods), river boat (fixed routes, paid). A horse needs feed and rest, can go lame, can be stolen at night (an event). Mount state on the player.

### D3. Fast travel
- `player.walked` segments recorded as the player completes them.
- `fastTravel(to)`: allowed only along walked segments; steps segment by segment, running the world forward; stops on decision 10's triggers with a message ("You stop: a caravan is camped at the Willow Ford inn.").
- Paid coach and boat (decision 10).
- Test: fast travel is offered for the walked stretch only; it stops when a situation is rolled on its path that day.

### D4. Docs and play
- README: walking the realm, the time scale, fast travel rules.
- Play it: walk Millbrook → liege town and back; write down what's fun and what's empty, and bring that to the slice's notes.

## Part E: everyone on the road is someone (rework, asked for 2026-10-14)

**Status: built 2026-10-14** (save v14, a clean break as the user chose). What differs from this plan is in the stage file's **What differs**, item 5.

**The user's words:** "I don't want random travellers in the world … everyone should be present via the database and can be tracked; the news spreads from the inns along the road; people travel to nearby villages, cities, hamlets and kingdoms; some migrate based on prosperity or their needs."

### What N26 built that this changes
- **Travellers are made up for the journey.** `sources.ts` makes caravans, patrols, pilgrims, adventurers and messengers with `hand()`: a random name and role from the journey's stream (`personName`), not a person in the `people` table. Talking to one makes a talker `v_<journey>_<k>` under the pseudo-site `"road"` (`travellers.ts`, `personaOnRoad` builds a figure in a scratch realm and throws it away). Road situations make actors the same way (`x_<key>_<n>`, `Town.meetRoadPerson`).
- **Migrants are real but in two places at once.** N25's `moveHouseholds` (people/migration.ts) changes their `site` to the new town **on the day they leave**; then `recordMove` → `walkers()` sets the same people walking the road for days. So they live in the new town (and are counted, stepped and drawn there) while also on the road.
- **News follows a computed relay, not people.** `relay.ts` runs a shortest-time search from where news happened, with a "fresh messenger" per hop; `reachesAt` reads it; messenger journeys are drawn to match it. Whether anyone actually carried it doesn't matter.
- **Adventurers on the road aren't the ones who delve.** `dungeonsDay` (realm/wilds.ts) delves with figures the same day, wherever they are; the adventurer journeys are other, invented people.
- **Off-screen, travellers meet nothing.** Packs and gangs threaten only the player (`threats.ts`); a caravan walks through an ambush untouched.

### Decisions
1. **Every traveller is a person row (or a realm figure that has one).** A journey's party is a list of **person refs**, never made-up names. Nobody is created for a journey. The `Traveller` type keeps `name`/`role` only as a cache for drawing; `person` becomes required. `hand()`, `personaOnRoad`'s scratch figure, `travellerId` (`v_<journey>_<k>`), `ROAD_SITE` and `x_` actors are deleted.
2. **Being away is state on the person, not a second copy.** New column `people.away` (JSON or null): `{ journey, since, purpose, returns: boolean }`. While away:
   - their `site` stays their **home** (a round trip) or their **old home** (a migration, until they arrive);
   - their home town's crowd, roster and hourly day **skip them** (`rosterAt` filters `away`), but they still count as its people;
   - where they are right now is the journey's formula (`positionAt`): on a road, staying the night at an inn, or visiting a town;
   - they still age, can die, marry nobody, and have a life review (N25b) like anyone; their death while away is a death **on the road** (`DeathRecord.site` = the road or the inn where it happened).
   Talkers (`world.talkers`) keep their persona id and home `site`; `placeOf` reads `away` and the journey.
3. **Visitors appear in the towns they visit.** A town's roster for the crowd = its people not away + **visitors**: people whose journey has them staying there now (a market day, a night at the inn, a visit to kin). Visitors get a short plan (`CrowdSim`): market or the person they came to see by day, the inn by night. They can be talked to (they're talkers or become talkers, as anyone). The inns along the road (waystation hamlets) host the travellers stopping for the night the same way.
4. **Why people travel: real reasons from their row, their town and their kin.** Each source picks **real people** by job, class and circumstance, at their own seeded stream (`streamFor(seed, "trips", site, day, kind)`), and only free people go (serfs and slaves travel only with or for their masters; runaways are N59):
   | Trip | Who goes (from the `people` table) | Where | Comes back? |
   |---|---|---|---|
   | **Market** | farmers, stallholders, weavers, potters of villages and hamlets | the liege town or the nearest town on its market day (N25a per-site market days) | yes, next day |
   | **Caravan** | a merchant of the town + carters/porters of the same town + guards (job `guard`) hired from it | a town or city within a few days, by trade treaties and prices | yes, after selling |
   | **Visiting kin** | anyone with a living spouse, parent, child or sibling in another place (N25 rows: migration splits families) | that place | yes, after a few days |
   | **Seeking work** | grown labourers and porters without work, apprentices without a master, in a poor or crowded place | a richer town within reach | sometimes not: if they find work, it becomes a **migration** (decision 5) |
   | **Pilgrimage** | clergy and devout commoners (traits; N50 later) | a place with a bigger temple | yes |
   | **Patrol** | the town's guards (job `guard`) and their captain figure | the crown's roads within its kingdom | yes, a loop |
   | **Officials** | the tax collector (a clerk of the liege) on tax days, carrying the coin `taxDay` moves; a lord's steward | the vassal places and back | yes |
   | **Couriers** | crown couriers (a new job `courier` in capitals and cities, posts like innkeepers) for news of importance ≥ 7 | along the kingdom's roads to each town | yes |
   | **Adventurers** | the guild's adventurers: the **same figures** `dungeonsDay` picks for a delve | the dungeon's mouth; the delve resolves **when they arrive**, not the day they're picked | the survivors |
   | **Migration** | households (N25: food, raids, crowding, a poor place vs a richer one, a review's `move` goal, N25b) | the place they chose | **no**: they become residents on arrival (decision 5) |
   | **Refugees** | everyone free who can walk from a place at war, besieged or starving | the nearest safe place, across a border if that's nearer | maybe, when it's safe |
   Each source has a daily cap and a share of the population (config in one table), tuned by N22's bounds so roads are neither empty nor clogged.
5. **Migration is a journey with an arrival.** N25's daily decision (who leaves, where to) stays in `migration.ts`, but `moveHouseholds` no longer changes `site` at departure. It **departs** them (sets `away` with `returns: false`) and launches the journey; on the **arrival day** (from the journey's timeline) the people step applies the move to both places (`ensureCurrent` both first, as now: house, `n`, work, servant ties). Population counts stay at the old place until arrival. The choice of destination is scored from needs: food, prosperity, safety (war, raids), crowding, **kin already there**, work demand (jobs the destination is short of), and law (a free person won't move into a slave kingdom's lower class; N59 later for runaways). Crossing into another kingdom is allowed for the free (a toll at the border, `tollGates`).
6. **News spreads by people, through inns.** The relay goes. A piece of news is **known by places** (`SiteState.newsSeen` with the day) and **carried by travellers** (`journey.carries`):
   - When news happens at a place, that place knows it at once.
   - A traveller leaving a place carries what it knows that's recent enough and important enough (fresh news first, at most `CARRY_MAX`, e.g. 6 items; importance ≥ 3; at most `STALE_DAYS` old).
   - **At every stop** (a night at a waystation inn, a visit, the destination) the place and the travellers there **exchange**: the place learns what they carry, and they pick up what it knows. Inns along the road are where news jumps from one traveller to another: a westbound carter tells an eastbound pilgrim at the Willow Ford inn, who carries it on.
   - Crown couriers carry important news (decision 4) so a king's death reaches every town of the kingdom within days, even on quiet roads.
   - The day a place hears a piece of news is simply when the first carrier arrives with it: `reachesAt(news, site)` becomes `site.newsSeen[id]?.day ?? null` (known or not yet). Nothing predicts the future.
   - The exchange runs once a day, realm-wide, after the journeys of the day: collect every stop of every journey that day from their timelines, sort by minute (then journey id), and apply exchanges in order. Deterministic, realm-wide (so lazy places don't matter), and cheap (a few hundred journeys × a few stops).
   - The player learns news the same way (N24): in a place, what it knows; on the road or at an inn, what the travellers they talk to or share a common room with carry.
7. **Off-screen meetings on the road are resolved in code.** Each day, journeys that pass a gang's ambush or a hungry pack's ground (`threats.ts`) roll an encounter (weighted by party size, guards, and the gang's strength), resolved like realm fights: robbery (cargo and coin gone: the caravan's trade doesn't arrive; the tax collector's coin goes to the gang), injuries and deaths on real rows (death records with the gang or pack as killer), or the travellers turning back. Each is an event at that road, with news that spreads by decision 6. Patrols on a road lower the odds and can fight the gang.
8. **Situations use people who are really there.** A situation is rolled only if someone suitable is near that stretch of road that day: a traveller whose journey is within range (a broken cart is a caravan's; an injured traveller is a real walker; a toll demanded is the toll keeper of that gate, a resident of the nearest waystation; a funeral is a real death of a nearby place), else a resident of the nearest roadside place. No suitable person → no situation that day. Outcomes act on those rows (injury, money, relationship, death), and on their journey (delayed, turned back).
9. **Everyone can be tracked.** The admin view (N17): a traveller's card shows "on the road from A to B, near the Willow Ford inn, arriving day N, carrying 3 pieces of news; trip: visiting her brother in B"; search finds people on the road; pinning follows them along the road (the admin map draws pinned people's position from the journey formula); a **Roads** panel lists journeys by kind with their parties (each clickable). A place's card shows who of its people are away and who's visiting.
10. **Save:** v14 as a clean break (journeys and people change shape; `away` is a new column, DB schema +1). Per the user's earlier choice, no migration from v13; say so at the top of the step and ask if that's still wanted.

### Steps
**E1. People can be away.** `people.away` (DB schema migration in `store/schema.ts`), `PeopleStore.depart(ids, away)` / `returnHome(ids)` (through the flush, N18 rule); `rosterAt` and the crowd skip the away; talkers' `placeOf` reads it; admin cards show it. Tests: an away person isn't on their town's map, still counts in its population, still ages and can die; a death while away has the road as its site.

**E2. Journeys of real people.** `Traveller.person` required; `launch` takes person refs and calls `depart`; when a journey ends (arrival with `returns: false`, or back home) `returnHome` or the migration arrival runs. Delete `hand()`, `travellerId`, `ROAD_SITE`, `personaOnRoad`'s scratch figure, `x_` actors, `Town.meetRoadPerson`; talking to a traveller enrols the person as a talker (`Town.enrol`, the same path as a townsperson). Update the client's `travellers.ts` to the person refs. Tests: every party member of every journey over 30 days is a living person row or a figure with one; talking to a traveller twice is the same talker, who remembers.

**E3. Trip sources (decision 4).** Rewrite `sources.ts` as one module per trip kind under `road/trips/` (`market.ts`, `caravan.ts`, `kin.ts`, `work.ts`, `pilgrimage.ts`, `patrol.ts`, `officials.ts`, `couriers.ts`, `adventurers.ts`, `refugees.ts`), each picking real people from the `people` table with its own stream, with caps in `road/trips/config.ts`. Add the `courier` job (posts in capitals and cities, `realm/townsfolk.ts`). Tax collectors carry the coin (`politics.ts` `taxDay` moves it when they arrive, not at once). Adventurers: `dungeonsDay` schedules an **expedition** (the party figures depart), and the delve resolves on arrival. Tests: market-day traffic into a town with farmers of its villages, who are home the next day; a person with kin in another town visits them; a caravan's merchant is a merchant of its origin; a delve happens on the day its party reaches the dungeon.

**E4. Visitors in towns and inns (decision 3).** `rosterAt(site)` adds visitors from journeys staying there; `CrowdSim` plans for visitors (market/kin by day, inn by night); waystation inns host overnight travellers. Tests: on its market day a town's crowd holds visiting farmers; at night the inn holds the caravan staying over; the visitors can be talked to.

**E5. Migration as a journey (decision 5).** Split `moveHouseholds` into `departHouseholds` (choose, set `away`, launch) and `arriveHouseholds` (on the arrival day, both places current, apply the move); the destination score adds kin, work demand, safety and law; refugees across borders. N25's equivalence test (coarse/full/lazy) must still pass: departures and arrivals are realm-wide daily steps. Tests: a household leaving a famine is on the road for the days the road takes and only then appears in the new town's roster and population; a household with a son in a richer town goes there; nobody is in two places at once (a check over a 60-day run).

**E6. News by people, through inns (decision 6).** Delete `relay.ts` and messenger relay journeys; `newsSeen` gets days; `carries` filled at departure; the daily `exchangeNews(day)` over all stops in time order; `reachesAt` returns the known day or null; N24's player learning and N25b's inputs read the new place knowledge. Update every caller of `reachesAt`/`relayDay` that expected a future day (admin "reaches day", tests): show "not heard yet" instead. Tests: news from a town reaches its neighbour only after a traveller from there arrives, and a town two roads away hears it through a traveller who heard it at an inn in between (assert the chain: who carried it where, from the exchange log); a king's death reaches every town of the kingdom within N days through couriers; a town with no traffic doesn't hear (and N22's bound below makes sure that's rare).

**E7. Off-screen encounters (decision 7)** and **E8. Situations with real people (decision 8).** Tests: a caravan passing a strong gang's ambush is sometimes robbed (its cargo never arrives, the gang's wealth rises, the news spreads); a patrol on the road lowers that rate; every situation's actors are real rows near that stretch of road.

**E9. Tracking (decision 9).** Admin traveller card, search for people on the road, pinned travellers drawn on the admin map, the Roads panel, a place's away/visiting lists. Tests (N17's read-only hash test extended).

**E10. Docs, bounds, tests.** Stage file ticks and "What differs" updated; README (who travels and why, how news spreads); bounds below; the centre lint gains `hand(`, `personaOnRoad`, `x_` ids, `ROAD_SITE`.

### Balance bounds (add)
- `roads-not-empty` / `roads-not-clogged`: journeys per road segment within a band; at least some traffic on every road out of a town each week.
- `news-reaches`: news of importance ≥ 7 reaches every connected town of its kingdom within a band of days; most news of importance ≥ 5 reaches the neighbours within a band.
- `nobody-twice`: no person is away on two journeys, or away and also in a crowd.
- `trips-return`: most round-trippers are home within their trip's length plus a margin (the rest died or settled, both with events).
- `migration-follows-need`: net migration flows from poorer, hungrier, more dangerous places to better ones over a year.

### Done when (Part E)
- Over a 60-day run, every person on every road is a person row (or a figure with one) that the admin view can find, pin and follow; nobody is made up for a journey and nobody is in two places at once.
- Farmers walk to market and back, merchants run caravans of their own town's people, people visit kin elsewhere, labourers go looking for work and some stay, households migrate toward better places and arrive days later, refugees flee a war.
- News reaches a town only when someone brings it: through travellers swapping news at the inns along the road, and couriers for great news; the admin view can show the chain of who carried it.
- A caravan robbed off-screen by a gang changes the realm (no cargo, a richer gang, news of it).

## Balance bounds (add in `balance/bounds.ts`)

- `journeys-band`: active journeys per road segment within a band (roads are neither empty nor clogged).
- `news-arrives`: every news item's carrier arrives (none lost forever unless robbed/killed, which is an event).
- `caravans-complete`: most caravans arrive; robbed ones are rare and recorded.

## Edge cases and traps

- **The client and server must generate identical chunks.** Pure functions in `shared`, no `Math.random`, no floating-point edge cases in thresholds (use integer noise). A test compares a server-generated chunk with the same function run in the client test suite.
- **Chunk seams:** rasterise roads and rivers in global tile coordinates and clip per chunk; never per chunk with local randomness.
- **Settlement footprints overlapping roads or rivers:** the footprint wins; roads end at its gate.
- **Journeys and determinism:** journeys are created by the realm day with its streams; their positions are formulas. If the player blocks a road (stands in the way), journeys don't stop for them (they're formulas); make journey parties step around the player visually only.
- **A traveller who is also a talking NPC** (a merchant the player knows) must be in one place at once: their persona's location is their journey's position. `npcPlace` for a person on a journey returns "on the road to X".
- **Time flowing on the road:** `/api/tick` while standing still on the road must use the same rules as in town.
- **Performance of `positionAt` for many journeys:** only journeys indexed to the loaded chunks are sent; the client computes ≤ a few dozen positions per frame.
- **The old encounter tests** (N14) will break when two-roll encounters go. Replace them with tests of the new meeting mechanics; don't keep both systems.

## Tests (`packages/server/tests/n26.test.ts`, `packages/shared/tests/road.test.ts`)

Listed per part above. The done-when ones:
- Walking from Millbrook to the liege town takes the set number of real minutes (computed from steps × the measured step rate) over several chunks.
- On the way, a real traveller carries news the player didn't have.
- The player stops at a roadside inn for the night (rest, a bed, news).
- Helping or ignoring someone in trouble has consequences later (an event linked by cause).
- The same road on the way back: chunk hashes equal.
- Fast travel offered only for the walked stretch.

## Done when (mapped)

| Done-when clause | Proved by |
|---|---|
| walking from Millbrook to Highdale takes a set number of real minutes over several chunk maps | A3 test (liege town for "Highdale") + play |
| meets real travellers (one carries news the player didn't have) | B3 test |
| stops at a roadside inn for the night | C1/C3 test + play |
| helps or ignores someone in trouble with consequences later | C2 test |
| sees the same road again on the way back | chunk determinism test |
| fast travel is offered only for the stretch already walked | D3 test |

## Realism notes (2026-10-23)

From the [realism review](../README.md#realism-gaps-review-2026-10-23); not decided or built yet.

- **Gap 1, one 48-day year (decided 2026-10-23):** journeys and news delays stay in plain days; a 3-day trip is now a quarter of a season. Built code that reads `seasonOf` (`road/camp.ts`, `caravans.ts`, `fast.ts`, `play.ts`, `situations.ts`) gets 12-day seasons with N30 step 1: re-check season-weighted situations and camp cold.
- **Quiet travel is quick (decided 2026-10-23), a follow-up to D3 ([migration guide](migration-2026-10-23-one-year-ageless-player.md) part C):** (1) fast travel (`canFast`, `routeFromHere` in `road/fast.ts`) works on any road the player **knows of**, walked or not: heard of in gossip (N33 knowledge), on a bought map, or told by a traveller; it still stops for parties, situations, threats, nightfall, hunger and tolls, and a road first crossed this way is marked walked. (2) **Quick walking:** while the player walks, the clock and the walk run faster (3–5×, config) when nothing is in view, and drop to normal as soon as a traveller, a situation, a threat or a place comes into view. The 7-minute day's walk stays the pace for walking by choice. Tests: a heard-of road can be fast-travelled and still stops at a rolled situation; quick walking drops to normal when a party comes into view.
- **Gap 2, goods that move:** carts and caravans have `cargo?` but nothing fills it from one place's surplus to another's shortage. A trade journey should load goods bought at the start (lowering stock there), sell them at the end (raising stock, lowering prices), and pick its route by the price gap merchants *know of* (N33 knowledge, not the truth). A robbed caravan then really leaves a shortage.

## Slice cut

Part A in full for the one road; Part B with caravans, messengers and migrants; Part C's inn and two or three situations; nights simply (rest at the inn); no mounts or fast travel. The rest of the realm keeps N14's time-skip travel during the slice (behind `ROAD=slice`, a list of road ids that are walkable).

## Out of scope

Off-road exploration (N27). Wildlife on the road beyond packs and beasts (N28). Seasons changing the land (N30). Wars blocking roads properly (N55). Crackdowns at toll gates (N58). Quarantine lines (N61).
