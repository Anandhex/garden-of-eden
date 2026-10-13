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

## Slice cut

Part A in full for the one road; Part B with caravans, messengers and migrants; Part C's inn and two or three situations; nights simply (rest at the inn); no mounts or fast travel. The rest of the realm keeps N14's time-skip travel during the slice (behind `ROAD=slice`, a list of road ids that are walkable).

## Out of scope

Off-road exploration (N27). Wildlife on the road beyond packs and beasts (N28). Seasons changing the land (N30). Wars blocking roads properly (N55). Crackdowns at toll gates (N58). Quarantine lines (N61).
