[← Plans](README.md) · [Stage 2: N26G](../stage-2-everyone-lives.md#n26g-fields-outside-the-village)

# N26G plan: Fields outside the village

Asked for 2026-10-24: "the farms should be outside the village, and things like farm crops, farm land, the growth of each square need to be tracked, as each can be damaged or destroyed, or things can happen to it, like wild animals grazing."

**In one line:** a settlement's farmland leaves the village map and lies around it in the chunk world, cut into **plots** that each belong to a real household or lord and are worked by real people; every plot's crop, growth and damage is tracked, down to the tile where something happened; deer graze it, boars root it, crows take the seed, storms flatten it, raiders burn it and travellers trample it; and the place's food is what its fields actually yield.

**Read first:** [plans README](README.md) **Part 3 (sections 21–29), which every playtest phase follows**, and sections 2, 7, 9, 16, 17. Needs N26 and [N26F](n26f-a-road-worth-walking.md) (commutes for people who work outside, light wildlife, pack beasts as rows, territories). Uses the 48-day year (built). Fits with [N30](n30-seasons-and-the-farming-year.md): N30 decision 3 says food is a curve by season. This plan makes that curve come from the plots instead, and N30 keeps the calendar, regional weather, prices, festivals and the look of the seasons.

**The rule** (from [N26F](n26f-a-road-worth-walking.md#the-rule-every-person-is-tracked)): everyone who farms, guards, steals or tramples is a real row. Livestock is a count per household (sheep, cows, pigs, goats); a herd animal isn't tracked one by one unless it becomes a beast that matters (a bull that gores someone), the same way pack beasts rise in N26F.

## What exists

- **Fields are a zone on the village map.** [`sites.ts`](../../../packages/server/src/web/sites.ts) cuts a `fields` zone (9 tiles wide, or a fifth of the map in big places) inside the village, and the crowd sends farmers and slaves there.
- **Food is a formula.** `economyDay` in [`realm/economy.ts`](../../../packages/server/src/game/realm/economy.ts) changes `settlement.food` by `0.92 + 0.08 × farms level + 0.02 × workers`, times terrain and season. The `farms` building level is "clearing new fields". Nothing on the ground changes when it rises.
- **People:** farmers, labourers, serfs and slaves are rows with homes and classes (N25, N16). The farmer's routine is `zone:fields`.
- **Beasts and wildlife** from N26F: pack beasts as rows, lone boars and deer as light wildlife, territories.
- **Raids** (`realm/arrivals.ts`) and wars exist, with no effect on land.

## Decisions made in this plan

1. **Farmland is outside, in the chunk world.** Around each settlement's footprint, in rings that follow the terrain: **infields** (ploughed strips nearest the village), **outfields and pasture** further out, **meadow** by water, a **woodlot** at the edge. The amount of land comes from the population and the `farms` level (about one ploughed acre-plot per working adult, more on plains, less in hills and marsh), so a city's fields reach a long way down its roads and a hamlet has a few strips. Roads run through them. The village map keeps only gardens, a pinfold and orchards; its `fields` zone becomes the path out to the fields.
2. **Plots are the unit of ownership; tiles are the unit of damage.** Land is cut into **plots** (strips of about 4×16 tiles in open-field country, closes and paddocks in hills and woodland), each a row: who holds it (a household, the lord's demesne, the temple's glebe, the commons), what's on it, when it was sown, how it's doing. Inside a plot, each **tile** can carry its own mark (trampled, grazed, rooted, burned, flooded, stripped by thieves), stored sparsely, so a boar's path through the barley is the actual tiles it crossed.
3. **Growth is a pure function plus a record of what happened.** A crop's stage on a tile at a minute = `growthAt(crop, sown, day, weather days, care, marks)`, a pure function in shared code (`packages/shared/src/farm/`). The server and browser compute the same field, and nothing is stored per tile per day. What's stored is what *happened*: sowing, weeding, manuring, each damage event (with tiles and cause), harvest. That makes "the growth of each square" exact and replayable without writing 100,000 rows a day.
4. **Crops are data.** `server/src/data/crops/*.json`: wheat, barley, oats, rye, beans and peas, flax, turnips, cabbages, hay (meadow), plus orchard fruit. Each has a calendar in the 48-day year (sow, sprout, grow, ripen, harvest window, rot after), terrain liking, yield per tile, what eats it, frost and flood tolerance, and what it leaves in the soil. Fields rotate (a three-field rotation where the realm's culture uses it: one in winter grain, one in spring grain or beans, one fallow, grazed by the village's beasts).
5. **People do the work, and it shows.** Each plot's holder household works it. Its farmers, labourers, serfs or slaves walk out as N26F commutes (decision 12) to that plot, and their work days are what sow, weed and reap it. Too few hands (people sick, dead, at war, run away) mean late sowing, weeds and crops rotting in the field, and that's visible. Serfs work the lord's demesne on their duty days (a hook for N45's laws). The player can be hired for a day's work (sowing, harvest) through N38's action menu, like N26F's `hire_on`.
6. **What happens to fields.** Each is a damage event with a cause, tiles and a size, rolled where its cause really is:
   - **grazing deer** (light wildlife near woods, at dawn and dusk, more in a hungry winter);
   - **rooting boars**, lone or a sounder (N26F beasts), which tear up a path of tiles;
   - **crows and pigeons** on fresh seed;
   - **livestock** that got out (a household's sheep in a neighbour's beans: a quarrel for N37);
   - **trampling** by travellers off the road, an army on the march, a hunt, or the player;
   - **storm, hail and flood** (from N30's weather when built, `weatherOn` until then), **frost** on early sowing;
   - **blight and rust** in wet years, spreading plot to plot;
   - **fire**, set by raiders (arrivals' raids now burn real plots) or by accident in a dry harvest;
   - **theft**: a hungry person row stripping a plot at night (a crime with witnesses, N25 hunger as the cause).
7. **People protect their fields.** Households and the village answer what hurts them, all as actions of real rows: hedges and fences (a plot field that slows deer and stock), scarecrows and children sent to scare crows, a **hayward** (a new job: a village row who watches the fields, impounds straying stock and reports damage), night watch at harvest, and **hunters sent after a boar** that keeps coming (a real journey into the beast's territory; N26F's named beasts make "the boar of Lowfield" a story). Damage is news and gossip (N33), and a neighbour's stock in your crop is a grievance (N37).
8. **Food is the harvest.** `settlement.food` stops being a formula. Each harvest day adds what was reaped (yield × healthy tiles × care), less the lord's share, tithes and seed kept back. Through the year food falls as people eat it. Places nobody is near are worked out by the same functions with their own events (cheap: a place has tens to a few hundred plots, and damage rolls are per plot per day). N30's prices, famine and migration then read real harvests. `farms` building level becomes "new land cleared": new plots appear at the edge of the fields, cut from the woodlot.
9. **Fields are on the map and the admin view.** The browser draws every plot by its crop and stage, tile by tile (green shoots, tall grain, gold, stubble, bare earth), with damage drawn where it happened (a flattened patch, black stubble, rooted ground). The admin view lists a place's plots (holder, crop, health, events) and shows a field map.

## Data shapes

```ts
// shared/src/farm/types.ts
export interface Plot { id: string; site: string; x: number; y: number; w: number; h: number; kind: "strip" | "close" | "paddock" | "meadow" | "orchard" | "garden"; holder: string /* household id | "lord:<id>" | "temple:<site>" | "commons" */; fence: 0 | 1 | 2 }
export interface Sowing { plot: string; crop: string; day: number; seed: number }
export interface FieldEvent { id: string; plot: string; day: number; minute: number; kind: "sow" | "weed" | "manure" | "harvest" | "graze" | "root" | "seed-eaten" | "stock" | "trample" | "storm" | "hail" | "flood" | "frost" | "blight" | "fire" | "theft"; tiles: number[] /* indexes in the plot */; by?: string /* person, beast, pack, weather */; amount: number }
export function growthAt(plot: Plot, sowing: Sowing | undefined, events: FieldEvent[], day: number, weather: (day: number) => string): Uint8Array /* stage per tile */;
```

SQLite (in `server/src/store/`): `plots(id, site, x, y, w, h, kind, holder, fence)`, `sowings(plot, crop, day, seed)`, `field_events(id, plot, day, minute, kind, tiles, by, amount)` with indexes on `(site)` and `(plot, day)`. Field events older than a year are folded into a per-plot summary row (yield and losses by cause) to keep the table small. Livestock: `herds(household, kind, count, herder, grazing)`: every herd has a real herder (a person row of the household, or a shepherd or swineherd hired by the village) and a place it grazes (a pasture plot or the commons), so a wolf that takes a lamb took it from someone, while someone was watching or wasn't.

Save: a new save version (a migration that lays out plots for every settlement and gives them to households by class; old saves are disposable, so a clean break is fine).

## Steps

### Step 1: lay out the land
- `shared/src/farm/layout.ts`: `fieldsOf(seed, settlement, terrain, roads)` gives the rings and cuts plots, deterministic, avoiding roads, water and the village footprint. `sites.ts` drops the `fields` zone and keeps gardens.
- Give plots to holders: households by class (a free farmer holds strips, a serf holds strips and owes demesne days, a slave holds none, a lord holds the demesne, the temple its glebe), `commons` for pasture.
- Tests: the same seed lays out the same fields; plots don't cross roads or the village; land per working adult within a band by terrain; every household that farms holds at least one plot.

### Step 2: crops and growth
- `data/crops/*.json` with a schema checked in CI; `growthAt` in shared code; the rotation.
- Tests: wheat sown in early spring is ripe in the harvest window and rots if not reaped; a fallow plot grows nothing; server and browser give the same stages (shared equality test, as N26's chunks have).

### Step 3: people work the land
- Farmers' routine `zone:fields` becomes a commute to their household's plot (N26F's `commutesOf`); work days produce `sow`, `weed` and `harvest` events by the rows who did them. Serfs' demesne days. The `hayward` job.
- The player can hire on for a day's field work (N38 action).
- Tests: a household whose farmers die leaves its plot unweeded and its harvest late; demesne strips are worked by serfs on their duty days; a hired player's day of harvest adds to the plot's reaped total.

### Step 4: damage
- `game/farm/damage.ts`: the daily rolls for each cause (decision 6), each from its real source (deer from `wildlifeAt`, boars from N26F beast rows and territories, stock from `herds`, raids from `arrivals.ts`, weather from the day's weather, theft from hungry rows). Each writes a `FieldEvent` with the tiles.
- On the player's screen: a boar or deer seen grazing is the same animal that writes the event; the player can drive it off or hunt it.
- Tests: a boar sounder in a territory by the fields roots a path of tiles at night; deer graze the plot nearest the woods most; a raid burns the plots nearest the road it came by; a hungry person who steals at night is a crime with a witness if the hayward is about.

### Step 5: protection and consequences
- Fences, scarecrows, the hayward impounding stock, night watch at harvest, hunters sent after a beast that keeps coming back (a real journey). News and gossip for damage; a grievance for stock in a neighbour's crop.
- Tests: a fenced plot loses less to deer; after a boar roots three nights running, the town sends hunters into its territory; a household whose sheep ate a neighbour's beans has a grievance against it.

### Step 6: food from the harvest
- `economyDay` reads harvested totals (decision 8); lord's share, tithe, seed; `farms` level clears new plots at the woodlot edge. Lazy places run the same functions.
- Tests: over a simulated year the start town's food rises at harvest and falls through winter; a year with a burned field and a wet harvest ends lower; a place's food equals the sum of its plots' reaped yields less its shares.

### Step 7: the browser and the admin view
- Chunks draw plots by crop and stage per tile, and the marks of damage. Field sprites through the G6 art pipeline (`npm run art`).
- Admin: a place's fields tab (plots, holders, crops, health, events, a field map).

### Step 8: tune, bound and document
- Bounds: `fields-feed` (a normal place feeds itself in a normal year), `losses-band` (losses to beasts and weather between 5% and 30% of a normal year's harvest), `no-orphan-plots` (every plot has a holder that exists).
- README and stage file.

## Edge cases and traps

- **Big places reach far.** A capital's fields run for a long way along its roads. Lay out plots only as far as its population needs, and let roadside places (N26F) and woods sit beyond them.
- **Fields and roads share chunks.** Walking off the road onto a crop is trampling. Keep a small verge either side of a road unplanted, and only count tiles stepped on inside a plot.
- **Performance:** never compute every tile of the realm. `growthAt` runs for plots in view on the browser, and on the server for a plot only when an event or a harvest needs it.
- **Holders change.** When a household dies out, leaves or is evicted, its plots go to its heir, the lord, or the commons (N45 decides inheritance properly later). A plot never has a holder that doesn't exist.
- **Migration of old food.** The first year after the switch must not starve every place: start each place with the food the old formula gave it, and plots already sown for the current season.

## Tests (`packages/server/tests/n26g.test.ts`, `packages/shared/tests/farm.test.ts`)

As listed in each step, plus a fixed-seed year at the start town: plots laid out, sown by named farmers, a boar's path through the barley, a storm, a harvest that becomes the town's food.

## Done when (mapped)

| Done-when clause | Proved by |
|---|---|
| the start town's fields lie outside it along its roads, every plot held by a real household or the lord, and worked by its own people | layout and work tests |
| a boar comes out of the woods at night and roots a path through a named household's barley, and the damage is on the map tile by tile | damage test |
| deer graze the plots nearest the woods; a fence cuts it | protection test |
| the town's food for the year is what its plots yielded, less what was lost and what was owed | food test |

## Slice cut

The start town and its liege town only: layout, two or three crops, the work, boars, deer, storms and the harvest. Blight, theft and fire wait.

## Out of scope

The calendar and weather themselves (N30), droughts and floods as disasters (N62), owning land as the player (N66), inheritance laws (N45), plant species beyond crops (N28), trade in grain beyond what exists.
