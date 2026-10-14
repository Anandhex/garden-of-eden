[← Plans](README.md) · [Stage 6: N60](../stage-6-a-changing-world.md#n60-ecology)

# N60 plan: Ecology

**In one line:** each **area** (a settlement's surrounding land, in N26/N27's chunks grouped into regions) keeps **stocks** of prey, predators and plant resources that change each day by a small predator–prey model (prey grow toward the land's carrying capacity, predators eat prey and starve without them), drawn down by hunting, foraging, logging and mining and regrowing slowly or not at all; N28's light wildlife reads the stocks (fewer deer drawn where deer are few), the realm's packs are the predator stocks, and the consequences reach people: empty woods, wolves at the herds, a mine running out that sends prospectors looking (N63).

**Read first:** [plans README](README.md) sections 2, 9, 17. Needs N28 (species data, `wildlifeAt`, the `taken` table; step 0 per section 11 if missing). Uses N13's packs (`packsDay`, `cap`), N27 (regions and POIs: ore outcrops are deposits), N30 (seasons: breeding and winter die-off), N41 (fairs' menageries take nothing), N62 (droughts lower capacity), N63 (exploration finds new deposits).

## What exists

- **Packs** ([`realm/wilds.ts`](../../../packages/server/src/game/realm/wilds.ts) `packsDay`): wolves, bears, boars, spiders per settlement with `count` and `cap` ("how many the land can feed"), breeding, attacks on herds and people, bounties and culls. No prey.
- **Wildlife** after N28: species with biomes, abundance, seasons; light animals placed by a pure function; `taken` records kills and gathers; plants with regrowth (`gathered`).
- **Gathering and hunting:** `forage` ([`gathering.ts`](../../../packages/server/src/game/gathering.ts)), N28's hunting and gathering, NPC hunters, foragers, herbalists.
- **Mines:** `mine` building levels in settlements; dungeons; ore from the mine road. No deposit size.
- **Timber:** none modelled; buildings cost coin only.

## Decisions made in this plan

1. **Regions:** the land is split into ecology **regions** = the area each settlement draws on (its catchment: chunks nearer to it than to any other settlement, capped at a day's walk), plus **wild regions** (catchments of no settlement: deep forest, marsh, high hills) for chunk clusters beyond a day's walk. `regionOf(cx, cy)` is a pure function of road data (Voronoi on settlement positions with a cap).
2. **Stocks per region:** a small record `eco(region, species_group → count, capacity)` for grouped species (to keep it cheap): `deer` (deer, elk), `small_game` (hares, rabbits, partridge), `boar`, `fish`, `wolves`, `bears`, `foxes`, `birds_of_prey`; and resources `timber`, `herbs`, `forage`, `ore` (per deposit). Capacity from biome area (N26's chunk biomes, counted once per region at world creation), season (N30) and weather (drought: N62).
3. **The model** (`game/ecology/step.ts`, daily per region; cheap: a few numbers): discrete Lotka–Volterra with logistic prey: `prey' = prey + r·prey·(1 − prey/K) − a·prey·pred − hunted`, `pred' = pred + b·a·prey·pred − m·pred − culled`, with seasonal breeding pulses (spring births), winter die-off, and caps. Parameters per group in `data/ecology/groups.json`. Randomness from `streamFor(seed, "eco", region, day)` (a small noise term). Tuned so wolves and deer cycle **out of step** over a few years (predator peaks lag prey peaks).
4. **Packs are the predator stocks.** A region's `wolves` count is the sum of its packs' counts (N13), and `packsDay` takes its breeding and starvation from the model: a pack's `cap` follows the prey in its region. Hungry predators (prey low relative to predators) **come for herds and villages**: `packsDay`'s attack chance on livestock and people rises with hunger (N13 attacks exist; this sets their pressure).
5. **People draw on stocks.** Every hunt (player, NPC hunters, crowd hunters by job: daily yields) takes from `deer`/`small_game`/`boar`; foraging and herbalists from `forage`/`herbs`; fishing from `fish`; **logging** (new: villages consume timber for building projects and fuel: a daily draw by population and season, more in winter; a building project needs timber) from `timber`; **mining** from the deposit's `ore`. Yields scale with the stock (a hunter in an overhunted wood brings back less), so overhunting shows as hunger for hunters' families and higher meat prices (N30's food prices).
6. **Light wildlife reads the stocks:** N28's `wildlifeAt` takes a region abundance factor (`stock/capacity`) that scales how many groups are drawn. The browser gets the factor per region once a day with the road data (a tiny map), so empty woods look empty.
7. **Deposits run out.** Each mine has a **deposit** (`ore` remaining, from N27's ore outcrops or generated with the mine); mining at the mine's level draws it down; at low ore the mine's yield falls (economy); at zero the mine closes (the building stays as a ruin mark: N31) and the miners' work moves (N40 careers, migration). Before that, the place's head posts **prospecting** (N63's exploration trips) when the deposit passes a threshold.
8. **Forests cleared:** timber regrows slowly (decades); a region's forest share falls as timber is cut beyond regrowth, which lowers `deer` capacity and changes chunk biomes **only in the browser's drawing of trees** (a tree density factor per region, so cleared land shows stumps and fields) without changing tile walkability (keeps N26's road tests valid).
9. **Visible in the admin:** per region charts of each stock, capacity, draws by cause.

## Steps

### Step 1: regions and stocks
- `regionOf`, region capacities from chunk biomes, `eco` table, initial stocks at world creation (and for an existing save: computed at load by migration).
- Test: every settlement has a region; capacities are higher in forest regions for deer.

### Step 2: the model
- Daily step, parameters, seasonal pulses; packs linked.
- Test (done-when part): over a few simulated years (no hunting) wolf and deer numbers rise and fall out of step (cross-correlation peaks at a positive lag).

### Step 3: people's draws
- Hunts, foraging, fishing, logging, mining draw stocks; yields scale with stock; prices react.
- Test (done-when part): a village that overhunts (force many hunters) finds empty woods (deer near zero) and wolves at its herds (pack attacks on livestock rise).

### Step 4: light wildlife reads stocks
- Abundance factor per region to the browser; `wildlifeAt` scaled.
- Test (shared): fewer deer groups drawn in a depleted region.

### Step 5: deposits and prospectors
- Deposits for mines; draw-down; closing; the prospecting hook (N63).
- Test (done-when part): the start town's mine runs low and its prospectors go looking for more (an N63 exploration trip is set out, or a need/job posted if N63 isn't built).

### Step 6: forests; admin; docs
- Timber draw and regrowth; tree density factor; admin charts. README: nature's balance.

## Balance bounds

- `no-extinction-without-cause`: no group goes to zero in a region without heavy draws.
- `cycles-exist`: predator and prey cycle within bounds (no blow-up, no flat line).
- `eco-cost`: the daily ecology step for the whole realm under 5 ms.

## Edge cases and traps

- **Lotka–Volterra blows up** with big steps: clamp, use small rates, and test the parameters over 50 simulated years (`LONG=1`) and 5 years always.
- **Lazy places:** ecology is a realm-level step (all regions daily), so lazy places see the same stocks; draws by lazy places' hunters are computed in the realm step from their counts by job, not in their catch-up (so the stock isn't drawn twice).
- **N28's light/realm rule** (predators that are realm packs appear only from packs) stays.

## Tests (`packages/server/tests/n60.test.ts`)

The done-when ones:
- Over a few simulated years wolf and deer numbers rise and fall out of step.
- A village that overhunts finds empty woods and wolves at its herds.
- The start town's mine runs low and its prospectors go looking for more.

## Done when (mapped)

| Done-when clause | Proved by |
|---|---|
| wolf and deer numbers rise and fall out of step | step 2 test |
| a village that overhunts finds empty woods and wolves at its herds | step 3 test |
| Millbrook's mine runs low and its prospectors go looking for more | step 5 test |

**Save:** the next schema version (`eco`, `deposits`).

## Slice cut

Not in the slice.

## Out of scope

Animal diseases (N61 could add later). Domestic herd sizes per household (herds are implied by farms). Fishing grounds at sea.
