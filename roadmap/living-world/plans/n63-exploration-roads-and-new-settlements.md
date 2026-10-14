[← Plans](README.md) · [Stage 6: N63](../stage-6-a-changing-world.md#n63-exploration-roads-and-new-settlements)

# N63 plan: Exploration, roads and new settlements

**In one line:** prospectors, hunters, guild adventurers and the player go on **exploration trips** into unexplored land within a day's reach; a trip rolls for a **find** weighted by terrain (and the player finds N27's POIs by walking); a find is news and a place on the realm map; a nearby settlement can **claim** it, **build a road** to it with labour and time (a new edge in the travel graph and new road geometry), work it (a mine), and, with spare settlers, **found a hamlet** there that grows by N13's size bands and gets maps, localities and townsfolk like every other place.

**Read first:** [plans README](README.md) sections 2, 3 (discoveries on the player's map only once heard of: the overview's default), 9, 17. Needs N26 (road data derived from the realm: `roadDataOf`), N27 (POIs and discovery; step 0 per section 11), N60 (deposits running out that start prospecting). Uses N25 (settlers are households that migrate), N31 (fixed layouts for new places), N33 (finds as news), N42 (surveys as jobs), N53 (place names in the culture's style), N64 (a new settlement can break away).

## What exists

- **Road data is derived** ([`road/generateRoads.ts`](../../../packages/server/src/game/road/generateRoads.ts) `roadDataOf(realm)`): a pure function of the seed, settlements' positions and their `roads` lists, cached by a key over all settlements; waystations are the one saved part (hamlets with `way`). Adding a road or settlement re-derives everything.
- **The travel graph:** `route(realm, from, to)` over `settlement.roads` ([`realm/travel.ts`](../../../packages/server/src/game/realm/travel.ts)); journeys read it (and so, after N26 Part E, does news, since travellers carry it).
- **Settlements** grow and shrink by size bands (`KIND_POPULATION`), build buildings including `mine` ([`realm/economy.ts`](../../../packages/server/src/game/realm/economy.ts)); abandoned ones exist; `breakAway`.
- **Migration** of households (N25) to roomier places; `HOMESTEAD` in [`people/migration.ts`](../../../packages/server/src/game/people/migration.ts) (check what it does: it may already found homesteads).
- After N27: POIs (ore outcrops, ruins, dungeon mouths) and discovery; after N60: deposits.

## Decisions made in this plan

1. **Trips:** an `explore` action (N38, grain day) for prospectors (a new job, or miners and hunters with the ambition), hunters, guild adventurers (an N42 `survey` job posted by heads wanting a mine or land), and explorers by ambition; at most a few trips per settlement per season (the overview's default). A trip is a **wild journey** (N26/N27: off-road, a few days) into a chunk region within a day's reach that the settlement hasn't explored (`explored(site)`: a set of regions), with risks (beasts, getting lost: N27's rules; deaths possible).
2. **Finds are weighted by terrain** and the land's own seeded POIs: a trip to a region reveals the region's POIs of value (N27's seeded ore outcrops, timber stands, peat, herbs, salt, fish, ruins, dungeon mouths) with a chance by skill; if N27's POIs exist, finds **are** those POIs (so the player and NPCs find the same things); otherwise a roll by terrain (ore in hills, timber in forest, peat and herbs in marsh, fish and salt on the coast, ruins or a dungeon mouth anywhere) creates a find record with a position in the region.
3. **A discovery** is an event and realm news (importance by kind and size), and a **realm map entry**: `realm.finds[id] = { kind, pos, region, size, foundBy, day, claimedBy?, worked? }`. The admin sees it at once; the **player's map shows it only once they've heard of it** (N24/N27's knowledge rule).
4. **Claiming and working:** the nearest settlement whose head wants it (by need: a mine when its deposit runs low (N60), timber when building, land when crowded) claims it (news; disputes if two claim: a stance hit, maybe a raid); working it needs a road or a short haul: a `mine` find can be worked as the settlement's mine at reduced yield until a road exists.
5. **Roads are built.** A **road project** from the settlement to the find (or between two settlements: trade partners without a road, N13's director pushes): cost in coin and labour (labourers and serfs assigned: their work target is the road; a crowd job), time by length and terrain (days per map unit by terrain), progress daily. Visible on the walkable map **while being built** (a partial road: the polyline up to the progress point, with workers and a camp at the head). When done, the road is added to `settlement.roads` (a new edge in the graph), routes and travel times change, trade and caravans and raids use it.
   **Geometry stability:** today, adding a road re-derives the whole road data. **Each road's polyline must be a pure function of its own endpoints and the seed** (not of the order of others), and waystations along existing roads must not move. Verify `buildRoadData` is per-road; if any part depends on global order (river crossings, waystation spacing), fix it first (step 1). A test: adding a road leaves every existing road's polyline and every waystation byte-equal.
6. **New settlements:** a claimed find with a road and **spare settlers** (households from places with food above a line and crowding above another: N25's migration picks households who want to move) becomes a **hamlet**: a new `Settlement` (kind hamlet, `founded: { day, from, find }`, the parent as liege by default, the culture's place name: N53, or the model's `place-name` through the invented-name check), with a footprint, a fixed-layout map (N31), localities and townsfolk who are the settlers' rows (moved, not generated), plus a few generated to fill roles (a head chosen among the settlers by renown). It grows by N13's size bands; it pays its liege; it can break away (N13, N56) and so lead to N64.
7. **The map grows.** New settlements, roads and finds are in the realm save (settlements already are; finds new); road data re-derives (stable by decision 5); the browser gets new road data when the version changes (`roadData` endpoint with a version).

## Steps

### Step 1: stable road geometry
- Audit `buildRoadData` for global-order dependencies; make each road and its crossings and waystation spacing per-road; the stability test.
- Test: add a road between two existing settlements in a test realm: all existing roads, crossings and waystations unchanged.

### Step 2: trips and finds
- `explore` action and survey jobs; wild journeys; finds from N27's POIs (or terrain rolls); `realm.finds`; news.
- Test (done-when part): over a simulated year the start town's prospectors find iron in the hills (a fixed seed with hills near).

### Step 3: claiming and working
- Claims, disputes; working at reduced yield without a road.
- Test: the find is claimed by the start town and worked.

### Step 4: building roads
- Road projects with labour and time; partial roads on the map; completion adds the edge; routes change.
- Test (done-when part): a road is built to the find; a route that used to go around now uses it (shorter travel time).

### Step 5: new settlements
- Settlers' households, founding, maps and townsfolk, the liege, growth.
- Test (done-when part): a mine is worked and a hamlet founded there; the player can travel to it (it's on the road graph; walking there in a test arrives).

### Step 6: the player's map and discoveries
- Finds and new places on the player's map only once heard of; the player's own finds (N27) can be reported to a head, sold or kept, and reporting starts the claim.
- Test (done-when part): the new hamlet shows on the player's map once they've heard of it, not before.

### Step 7: admin and docs
- Admin: finds, claims, road projects, new places. README.

## Balance bounds

- `exploration-rate`: trips per settlement per season within the default.
- `new-places-bounded`: new hamlets per decade under a cap; the realm doesn't fill up.
- `roads-finish`: road projects finish or are abandoned with a reason.

## Edge cases and traps

- **Road data cache key** covers all settlements; it's fine to recompute, but it must be fast enough for the realm day (a new road once in a while) and the browser must refetch (versioned).
- **Footprints overlapping** existing roads or rivers: a new hamlet's site must be chosen where its footprint is clear (N26's rule: the footprint wins; pick a spot that doesn't cut a road).
- **Lazy-place catch-up** for settlers' origin places: households leave after `ensureCurrent` (as N25 migration).
- **Determinism:** trips, finds and founding use per-settlement streams.

## Tests (`packages/server/tests/n63.test.ts`)

The done-when one, as a year-long scenario on a fixed seed: the start town's prospectors find iron in the hills, a road is built, a mine is worked and a hamlet founded there, which the player can travel to and which shows on their map once they've heard of it.

## Done when (mapped)

| Done-when clause | Proved by |
|---|---|
| Millbrook's prospectors find iron in the hills | step 2 test |
| a road is built | step 4 test |
| a mine is worked and a hamlet founded there | steps 3, 5 tests |
| which the player can travel to | step 5 test |
| and which shows on their map once they've heard of it | step 6 test |

**Save:** the next save version (`realm.finds`, `settlement.founded`, road projects in the realm).

## Slice cut

Not in the slice.

## Out of scope

Sea exploration and islands. Players founding a settlement directly (they can claim a find and bring settlers with a faction: N57, and N64 covers founding kingdoms).
