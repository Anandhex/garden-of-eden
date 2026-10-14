[← Plans](README.md) · [Stage 6: N62](../stage-6-a-changing-world.md#n62-disasters)

# N62 plan: Disasters

**In one line:** fires, floods, droughts and mine collapses happen with a **daily chance computed from the place** (dense wooden houses, forges and dry weather for fire; rivers and storms for floods; the season for drought; a mine's depth and age for collapses), seeded and logged; each runs by code: a fire **spreads house to house** on the place's real map and is fought by townsfolk; damage leaves N31's marks, kills real people, ruins stores and buildings; rebuilding, migration and the liege's relief or neglect follow; rescues are jobs for the player.

**Read first:** [plans README](README.md) sections 2, 17 (`SiteDay.disaster`). Needs N30 (regional weather and seasons), N31 (fixed layouts, marks, repair). Uses N26 (rivers on the road data: floods), N36 (grief and fear), N42 (rescue jobs), N58 (relief or neglect feeds unrest), N60 (deposits, mine age; drought lowers capacity), N63 (new mines collapse too).

## What exists

- **Raids burn** buildings in the realm (`damageBuilding`), and after N31 houses get `burned` marks with repair by prosperity.
- **Weather** (N30 regional), seasons; rivers in N26's road data (`roadDataOf`: rivers as polylines, crossings).
- **Mines:** the `mine` building and the old mine locality ([`web/sites.ts`](../../../packages/server/src/web/sites.ts) `mine` area), miners as a job.
- **Deaths** with cause `accident` and `famine`; casualty-style picking of the dead among rows (N25).

## Decisions made in this plan

1. **One disaster module** `game/disaster/` with a kind per file: `fire.ts`, `flood.ts`, `drought.ts`, `collapse.ts`. Each has `chance(place, day)` (pure, from the place and `weatherAt`), `start(...)`, a daily (or hourly in the player's place) `step`, and `end`. Started in the realm day with `streamFor(seed, "disaster", kind, site, day)`. Records: `disasters(id, kind, site, start, end, cause, damage JSON, dead JSON, why)`.
2. **Fire** spreads on the **real map**: the place's buildings (fixed layout, N31) are a graph by distance; a fire starts in one building (a forge, an inn's kitchen, a lightning strike in a storm, arson: N38's `burn` action from revenge or rebellion), and each hour it spreads to neighbours with a chance by building material (wooden houses: high; stone: low; by class and place kind: hovels and dense towns burn), wind (weather) and dryness (no rain in recent days); townsfolk **fight it** (people near and awake: a bucket line; the chance to put out a burning building rises with fighters; the guard and a `well` near help). A crowded town spreads more than a hamlet because buildings are closer and wooden. Burned buildings get `burned` marks (N31), the people inside who don't get out die (`accident`, the fire's ref), household goods burn (N32), and the place's stores burn if the granary does.
   In non-player places the fire runs at day grain with the same graph (hours simulated in one go: cheap; tens of buildings).
3. **Flood:** places on or near a river (N26's rivers within a distance) or on the coast; chance by storms and rain over recent days (N30), spring melt; the low-lying part of the place (tiles near the river: a pure function of the map) floods for a few days: buildings there damaged (marks), stores spoiled, roads near closed (N26: fords impassable, bridges risky: the road's open state as N30's high-road closure does), some drowned.
4. **Drought:** a region with too few rain days in spring/summer (from `weatherAt` over the season: deterministic) has a drought: the harvest (N30's `produce`) cut, wells low (water price), ecology capacity down (N60), fire chance up. Drought is regional, announced as news when it bites.
5. **Mine collapse:** chance by the mine's level (deeper = riskier), age (N60 deposit depletion: older shafts), and how hard it's worked; a collapse traps **named miners** (real rows working there that hour: the crowd or day roster) for a few days; each day trapped some die (air, injury); a **rescue** is a job (N42) and an action for the player (dig, shore up, lead a party into the mine area: N15's mine locality or N27 interior) with checks; NPC rescuers try too (miners' families, the guild). The mine is closed until repaired.
6. **Aftermath:** deaths (real people, typed with the disaster ref), ruined stores and buildings (marks, `food` and treasury down), rebuilding (N31 repair rules; a project for public buildings), **migration** (N25: people leave a burned or flooded place more), and **the liege's response**: relief (food and coin sent: a caravan journey, news, the liege's subjects' `lord` axes up) or neglect (no help: grievances against the liege: N56/N58), decided by the liege's traits and treasury, logged with why.
7. **Visible:** fire on the map (flames on buildings, smoke; N29's sound if built: roar and shouting), floodwater tiles, cracked dry fields in a drought, the mine's mouth blocked; news to every place in time.

## Steps

### Step 1: the module and records
- `disasters` table; the start rule in the realm day; chances per kind.
- Test: chances are higher where they should be (a dense wooden town's fire chance > a stone hamlet's on the same dry day).

### Step 2: fire
- Building graph from the fixed layout; spreading by hour; fighting by townsfolk present; deaths, marks, burned goods and stores; day-grain version for other places.
- Test (done-when part): a fire in a crowded town spreads more than one in a hamlet (same start conditions; burned building counts).

### Step 3: marks and rebuilding
- Burned marks, repair by prosperity (N31), projects.
- Test (done-when part): the burned houses show and are rebuilt.

### Step 4: drought and flood
- Drought by region from the season's weather; harvest cut; ecology and fire coupling. Floods by river and storms; low tiles; closures.
- Test (done-when part): a drought hits harvests (food after the harvest lower than a normal year in that region).

### Step 5: mine collapse and rescue
- Collapse rule; trapped miners (named rows); the rescue job; the player's rescue actions in the mine area; NPC rescuers.
- Test (done-when part): a mine collapse traps named miners the player can try to save (a rescue that succeeds with good checks; deaths among those not reached in time).

### Step 6: aftermath; admin; docs
- Migration, relief or neglect with why; admin: disasters by place and their toll. README.

## Balance bounds

- `fires-bounded`: no town burns down entirely more than rarely; most fires are put out after a few buildings.
- `disasters-rare`: per place per decade, a few.
- `relief-sometimes`: lieges help in a share of disasters.

## Edge cases and traps

- **Fire on the player's map** must agree between server and browser: the server owns which buildings burn; the browser draws the flames from the state (marks with a `burning` flag and the hour).
- **Talkers' homes** burning: they move (N31's rule) and may die if inside (protected people are only protected from NPC violence, not fire; but children are rescued first by the rescue rule).
- **Determinism:** spread uses the disaster's stream; the order of buildings is by index.

## Tests (`packages/server/tests/n62.test.ts`)

The done-when ones:
- A fire in a crowded town spreads more than one in a hamlet.
- The burned houses show and are rebuilt.
- A drought hits harvests.
- A mine collapse traps named miners the player can try to save.

## Done when (mapped)

| Done-when clause | Proved by |
|---|---|
| a fire in a crowded town spreads more than one in a hamlet | step 2 test |
| the burned houses show and are rebuilt | step 3 test |
| a drought hits harvests | step 4 test |
| a mine collapse traps named miners the player can try to save | step 5 test |

**Save:** the next schema version (`disasters`); `SiteDay.disaster` (JSON).

## Slice cut

Not in the slice.

## Out of scope

Earthquakes and volcanoes. Fire brigades as a guild (the bucket line is enough).
