[← Plans](README.md) · [Stage 2: N26F](../stage-2-everyone-lives.md#n26f-a-road-worth-walking)

# N26F plan: A road worth walking

Asked for 2026-10-24, after playing: "the travelling between villages is kind of boring, there are no monsters, no events, it's like a dead road, and things around a village can be placed around the roads rather than accessible via the village". Decided the same day: **realistic creatures only** (animals and outlaws; fantasy creatures wait for N54), and **plan first**.

**In one line:** the road gets something to see or do about every minute of real walking; packs and gangs hold **stretches of road** (not single points) and their members are **on the map** as creatures you see coming and fight there; realistic wildlife is drawn along the way and can be hunted; small **roadside places** (a shrine, a ruin, a cave, an ore outcrop, a herb patch) sit by the road; and a village's **woods, gang camp and mine move out onto the road**, so you walk to them instead of picking them from the village edge.

**Read first:** [plans README](README.md) **Part 3 (sections 21–29), which every playtest phase follows**, and sections 2, 7 (shared code), 9 (performance), 16 (save). Needs N26 with Part E (built). It brings forward parts of three later plans, and they then build on it instead of redoing it:

- [N27](n27-the-wilds.md) decision 3 and step 8 (localities fold into the chunk world), step 1 (seeded POIs, only the ones near a road) and step 2 (lairs and camps, only as road territories). N27 keeps discovery, the player's map, getting lost, reporting finds and everything off-road.
- [N28](n28-fauna-and-flora.md) decisions 2 and 3 (light wildlife, promoted when hunted), for a short list of realistic animals. N28 keeps the species files, plants, bestiary, lookalikes and new skills.
- Nothing from [N54](n54-peoples-and-monsters.md): no fantasy creatures.

## Why the road feels dead (what the code does today)

Measured from the code on 2026-10-24. A day's walk is 4,200 steps, about 7 real minutes, so the player covers roughly **600 tiles per real minute**.

1. **Threats are points.** [`threats.ts`](../../../packages/server/src/game/road/threats.ts) gives each pack one spot, 20 tiles across, on the first road out of its `near` settlement (sorted by road id), and each gang one spot, 11 tiles across. Most journeys never pass one. Roads that aren't first in that sort order never get a threat at all.
2. **Threats aren't seen.** When the player does walk into one, `fightOnRoad` fights it in code and returns lines of text. Nothing is drawn: the road has no creatures (`town.road` has no creature list; only locality maps stock them through [`haunts.ts`](../../../packages/server/src/game/realm/haunts.ts)).
3. **Situations are rare.** [`situations.ts`](../../../packages/server/src/game/road/situations.ts) rolls once per stretch between waypoints (`SITUATION_CHANCE = 0.5`). Stretches shorter than 500 tiles get nothing, and a roll whose actors can't be found among nearby travellers or the nearest inn gives **nothing** (`actorsFor` returns null). On a quiet road that's most rolls. A day's walk usually holds 0 or 1 situations.
4. **There's nothing along the way.** Chunks have biome features (trees, rocks, water) and crossings, but no places to stop at.
5. **The village's surroundings are menu exits.** [`areasOf`](../../../packages/server/src/web/sites.ts) gives every settlement a woods (exit on the east edge of the village map), and a road, camp and mine area when there's a gang or dungeon. They are separate 26×18 maps that aren't anywhere on the road.

## The rule: every person is tracked

The user's rule, restated 2026-10-24: **every NPC in the game is someone who exists.** Anyone who walks, talks, fights, works, guards, robs, is hired or dies is a `people` row or a realm figure, with a name, a home, a job, and a place in the world when not on screen. Nothing in this phase makes a person for a scene. In particular:

- **Travellers, situation actors, commuters, ore carters, watch guards and sellswords** are existing rows picked by job and place. A `sellsword` is a job those rows take, like any job; hiring moves a row, it never makes one.
- **Gang members** on the road are the gang's member figures by name, as `haunts.ts` does in the camp. A gang fight on or off the screen hurts or kills particular members, never a "strength" with nobody in it.
- **Pack beasts are tracked too** (asked 2026-10-24: "can't the wolves in a pack evolve into named NPCs?"). Every wolf, bear, boar and spider in a pack is a `beasts` row (decision 14), so the wolf that bit you yesterday is the same wolf today, and any of them can rise to a named figure. Only light wildlife that nobody owns (deer, hares, crows) stays seeded and untracked until it's hunted.
- **A guard test enforces it** (step 0b): every creature made from a person template (`bandit`, `villager`, `guard`, `farmer` and any later one) on any map or on the road must carry a `figure` or a person id that exists and is alive, and every situation actor and commuter must be a row. It runs in the full suite and as a balance bound (`nobody-made-up`).

### Made-up people in the code today (fixed in step 0b)

Found 2026-10-24. These break the rule now and are fixed first:

| Where | What it makes | Fix |
|---|---|---|
| [`realm/arrivals.ts:63`](../../../packages/server/src/game/realm/arrivals.ts) | a raid spawns 1–5 nameless `bandit` creatures at the gate | the raiders are members of the raiding gang (`e.by`), by name; they leave or die on their rows |
| [`realm/arrivals.ts:71`](../../../packages/server/src/game/realm/arrivals.ts) | refugees spawn as 1–4 nameless `villager` creatures | drop it: Part E's migration already brings refugees as real rows on a journey; draw those |
| [`realm/spawnrules.ts:25`](../../../packages/server/src/game/realm/spawnrules.ts) | a gang's night lookout is a nameless `bandit` | one of the gang's members, picked by the day's stream, is the lookout |
| [`director/revenge.ts:107`](../../../packages/server/src/director/revenge.ts) | a revenge ambush hires 2 nameless `bandit`s | the one seeking revenge comes with real people: their kin or friends (N37 relationships), or members of a gang near them, paid from their own coin |
| [`realm/travel.ts:174`](../../../packages/server/src/game/realm/travel.ts) | "deserters from the war", a faceless foe | soldiers of the warring side, from that kingdom's real rows, marked deserted (N55 later gives them a full story); if none can be found, no meeting |
| [`realm/travel.ts:160`](../../../packages/server/src/game/realm/travel.ts) `gangFoe` | a gang fought as a number | the fight picks the members present; losses fall on those rows |

## Decisions made in this plan

1. **A beat about every real minute.** The target is **5 to 10 things on a day's walk** (4,200 tiles), spaced at least 300 tiles apart: one or two situations with people, two to four wildlife sightings, one or two roadside places, and on wild roads up to one hostile meeting. A test walks fixed-seed roads and checks this band (balance bound `road-beats`). Near towns and on patrolled roads, fewer hostiles; far from settlements, in forest, hills and marsh, more.
2. **Every beat is true to the world.** The N26 Part E rule stands: nobody is made up. People in situations are real rows. Wolves are members of a real pack, bandits are members of a real gang (the people or figures `haunts.ts` already uses). Signs are only shown where the thing really is: wolf tracks inside a pack's territory, smoke from a real camp, a fresh grave only from a real death record on that road. The only seeded things are what has no state: wildlife that isn't hunted, and old places with no owner (stones, ruins, caves).
3. **Packs and gangs hold territories.** A threat becomes a **territory**: a stretch of road (from distance `t0` to `t1` along one road) plus a band either side, `width` tiles wide. A pack's territory is one or two stretches on roads within its range of `near` (every road out of it is a candidate, not just the first), picked by seed from the pack id, favouring biomes the species likes (wolves forest and hills, boars forest, bears hills and forest, spiders forest and marsh). A gang's territory is a stretch on a road out of its seat, typically 600 to 1,500 tiles long, at a bend or in woods. The off-screen journeys in [`encounters.ts`](../../../packages/server/src/game/road/encounters.ts) use the same territories, so a party that is robbed was robbed where the player could have been.
4. **Hostiles are creatures on the road map.** When the player is inside a territory, the server stocks the road with that pack's or gang's members as real `Creature`s near the player, the same way `stockHaunts` stocks the woods: at most `MAX_ON_MAP`, never more than the pack's `count`, the alpha by name, gang members by name. They come from off-screen, are drawn, approach, and are fought **on the map** with the combat locality maps already use. What happens goes back to the realm as it does in the woods: a wolf killed is one fewer in the pack (and a bounty share), a gang member killed is a death on their row. Leaving the territory (or fleeing far enough) unstocks them; survivors go back to the pack's count.
5. **When they come out.** Each territory has a chance per game hour the player spends inside it, by time and kind: packs hunt mostly at dusk, night and dawn (wolves), bears and boars by day; gangs by day on the road, less in rain. `dailyChance`/`perDay` rules from the 48-day migration apply to anything rolled per day. At most one hostile meeting per territory per day for the player (`road.met` stays). Strength still matters: a pack below 60% of its `cap` or a gang with no members doesn't come out, as today.
6. **The player has choices before the fight.** A hostile group is seen first (at the sight distance of the country: plains far, forest near, night nearer), with a line ("Wolves, four of them, in the trees to the north"). The player can turn back, leave the road and go round (slower; N27 adds getting lost), keep walking and fight, or, with a gang, pay their toll (the existing `toll_demanded` situation, now started by the gang's own members). Animals that aren't hungry (a bear by day with nothing near its cubs) may just watch.
7. **Wildlife is light.** Realistic animals that nobody owns are drawn, not simulated, as N28 decision 2 says: `wildlifeAt(seed, road, t0, t1, day, hour)` in shared code (`packages/shared/src/road/wildlife.ts`), the same on server and client, nothing stored or sent per animal. First list: **deer, hare, fox, crow (flocks), heron (by water), adder (warm days), boar (lone, not a pack)**. Deer and hares bolt when the player comes close; crows lift off; an adder bites if stepped on. Hunting one **promotes** it to a full creature (N28 decision 3: id `a:<road>:<t>:<k>:<day>`, recorded in a small `taken` list so it isn't drawn again that day). Their meat, hides and feathers come from creature templates added for them (deer, hare, fox, adder, heron, crow), using `hunting`.
8. **Roadside places are N27 POIs, near the road only.** `roadsidePlaces(seed, road)` in `packages/shared/src/road/poi.ts` places, by seed and by the country at each spot, about one place per 700 tiles, 6 to 30 tiles off the road and visible from it. They use N27's `Poi` type and id scheme, so N27 extends them off-road later. Kinds in this phase:
   - **shrine:** pray for a small blessing (a needs boost or a short buff), once a day; a wayside offering bowl that a real person may have left coin in (rare, from journeys that passed);
   - **standing stones:** a landmark (named on the roadbar), nothing to take;
   - **ruin:** an old, nameless ruin with a small interior (low-value loot, maybe a beast den);
   - **cave:** a small interior, sometimes a pack's den when the cave is in its territory (then the pack's young and the alpha are there);
   - **herb patch:** forage with the existing `forage` from [`gathering.ts`](../../../packages/server/src/game/gathering.ts), regrows after some days;
   - **ore outcrop:** mine with a pick (existing ore items), regrows slowly;
   - **abandoned cart or camp site:** a little loot, only where a real robbery or death happened on this road (from `encounters.ts` events), otherwise not placed.
   No hermits' huts here: a hermit must be a real person row, which is N27 step 7's work.
9. **The village's surroundings move onto the road.** The woods, the gang's camp, the mine road and the mine become **places on the road out of the village**, entered from the road, and their existing N15 maps stay as their **interiors** (layouts, haunts and tests survive):
   - **the woods:** a woods-edge place on the road out of the village whose country is most wooded, 150 to 400 tiles out, with a path sign ("Path into Ashby Woods");
   - **the gang's camp:** hidden off the road inside the gang's territory, reached by a faint track, shown only once the player has seen it or been told (N33's `playerLearns`); a gang member met in the territory may be followed back to it;
   - **the mine:** there are two kinds, and both go on the road. The **old mine** is the dungeon (`realm.dungeons`, beasts in its deeps). The **working mine** is the settlement's `mine` building (hill towns start with one), where its miners work. Each gets a spur track off the nearest road (drawn in chunks as a track, not a realm road), with the mine mouth at its end: the old mine's at the dungeon's `pos`, the working mine's 300 to 800 tiles out in the hills nearest the town. The old "road out of" area becomes the old mine's track and is dropped as a separate map.
   On the village map, the woods exit and the road-area exit go away; every exit leads onto the road (as the west edge does today). Leaving an interior puts the player back on the road where they went in. `areasOf` stays as the list of interiors a place has; what changes is where they are entered from.
10. **Situations every stretch, and a fallback.** Stretches become fixed lengths of about 1,200 tiles along each road (independent of waypoints), each rolled once a day. When the rolled situation's actors can't be found, the roll falls back to a situation that needs no one (`flooded_ford`, `wagon_in_mud`, `broken_cart` with an empty cart, a new `fallen_tree`, a new `washed_out_road`) instead of nothing. New situations with real actors: `herders_with_flock` (people of the nearest farm), `hunters_on_the_road` (hunters from the nearest town on a wild journey, who know the local territories and say so), `pilgrims` (travellers bound for a shrine).
11. **Signs before the thing.** Some beats are signs that something is ahead, all from real state: fresh tracks and a carcass inside a pack's territory; smoke and a dropped knife near a gang's camp; crows over a fresh grave of a real death on this road; a milestone with the real distance to the next place. They're map features with a line when passed. This makes the road readable: the player learns that tracks mean wolves ahead.
12. **People go to work along the road.** Added 2026-10-24: "if the mine is along the road, the people commuting to it can be seen". Today a miner's routine is `out:exit_road` in [`townsfolk.ts`](../../../packages/server/src/game/realm/townsfolk.ts): they walk off the village map and are gone until evening. Now they walk the road to the working mine and back, and the player meets them doing it. The same goes for hunters to the woods-edge and carters taking ore to town.
   - **Commutes aren't journeys.** A town's miners going out every day would flood `realm.journeys`, so a commute is computed: `commutesOf(site, day)` takes the town's people rows with the job (the same rows its crowd uses) and gives each a schedule: leave town around 06:00 to 07:00, walk the road and spur at `WALK_PACE`, work at the mine, walk back around 16:00 to 17:00. A position at a minute is a pure function, like N16's crowd, worked out only for places near the player. Nothing is saved, and they stay "at work" to their town's crowd as today.
   - **What the player sees.** A line of miners on the spur in the morning, picks on shoulders; an ore cart each afternoon (a carter row with the day's ore, from the mine's real output in the economy); miners at the mine mouth by day, who can be talked to (they are talkers like any traveller) and know the local territories.
   - **The mine is worth guarding.** Ore carts and miners' pay are cargo, so a gang whose territory crosses the spur or the road to town robs them off-screen (through `encounters.ts`, with the cart as cargo) and on-screen when the player is there.
13. **Guards and hired swords on the route.** Added the same day: "guards along the route, or mercenaries they have hired". The town that owns a working mine posts guards to it, and hires mercenaries when it has too few of its own.
   - **Who guards.** The town's own `guard` rows first (patrol trips already take guards from `athome`). The **mine watch** is two to four guards on a rota: one at a watch post where the spur leaves the road, the rest at the mine mouth, walking out and back with the miners as a commute (decision 12). They're real rows and fight beside miners and the player.
   - **Hired swords.** A new job, `sellsword`, for people in cities and towns with a barracks (added to the job mix in `townsfolk.ts`, a few per place, with fighting skills). A town with too few guards for its watch hires sellswords from the nearest place that has them, paid a daily wage from its `treasury`. A hired sellsword lives at the town while hired (a Part E migration journey there and back, so the arrival can be seen) and is released when the coin runs out or the danger has passed. N69's offices and ledgers later take over the wage (a captain hires, the treasurer pays); until then a plain treasury debit with a `hired` event.
   - **When to post and hire.** Once a week (a `perDay` rule, so the 48-day year holds), the town checks the danger to its mine: a gang territory crossing the spur or the road to town, robberies of its carts in the last 12 days, beasts killed near the mine. No danger: one guard at the post. Some: the full watch. More than its guards can cover: hire sellswords, if the treasury can pay 12 days of wages. Every change is news in the town ("The mine watch is doubled after the cart was taken on the hill road").
   - **It changes the danger.** Guards on a stretch count against the gang's chance to strike, the same way a patrol does in `encounters.ts`, so a guarded spur is safer and `road-danger` reflects it. A gang that keeps losing to the watch may move its territory (a new stretch drawn from the seed and the day it moved).
   - **The player can be hired.** The town offers the watch's wage to the player through N38's action menu (a `hire_on` action at the watch post or with the town's head): a day's guard duty walking out with the miners, paid at the end, with a fight if the gang strikes. This is a hook for N40's careers (a `guard` seat); keep it a day's work for now.

14. **Every pack beast is someone, and can rise.** Today `realm.packs[id].count` is a number, and [`haunts.ts`](../../../packages/server/src/game/realm/haunts.ts) makes "wolf 1", "wolf 2" for the map. Only the alpha is a figure. [`rise.ts`](../../../packages/server/src/game/realm/rise.ts) already names a creature that wins `NAMED_AFTER_WINS` (3) fights ("Greyfang"), but a wolf spawned from a count is gone after the visit, so it rarely gets there.
   - **Rows, not a count.** A `beasts` table holds each pack member: id, pack, species, sex, born day, mother, its life (stats, tier, xp, like a creature's), wounds and scars, wins, kills (who), and died (day, how, by whom). `count` becomes the number of living rows. A pack's young are born as rows with a mother; old age, hunger, hunters and fights kill rows. The realm's pack rules in [`wilds.ts`](../../../packages/server/src/game/realm/wilds.ts) (breeding, thinning, culls, attacks) act on rows instead of the number.
   - **The same beasts everywhere.** The woods, a den cave and a pack's road stretch all draw from the same rows. A creature on any map carries its `beast` id; what happens to it (a wound, a scar, a win, a death) is written back to its row. A wolf you wounded and drove off is still limping by the road two days later.
   - **How a beast rises.** A row becomes a named realm figure (the existing `makeFigure` path with `beastName` and `epithet`) when it: wins 3 fights (as now); kills a person (it's remembered by that person's kin and town: "the wolf that took Hal Mercer"); survives a fight with the player or a hunting party twice; or reaches great age. A named beast gets news, can carry a bounty under its own name, and people talk about it through N33's knowledge. Scars and deeds set its epithet ("Old Notch", "the One-Eyed").
   - **Leadership.** When the alpha dies, the strongest named member, or else the oldest grown one, takes the pack (`crownAlpha`, with news). A pack can split when it grows past its `cap` and has two named beasts: one leads some rows away to a new territory (a new pack near another settlement).
   - **Hunted for something.** A named beast that has killed people is a quest the town can post ("Kill Old Notch", from N38's quest kinds), and hunters from the town may go after it on a real journey.

## Data shapes

```ts
// shared/src/road/territory.ts (pure, from the realm's ids and the road data; also used by the admin view)
export interface Territory {
  id: string;                     // "pack:<id>" | "gang:<id>"
  kind: "pack" | "gang";
  road: string;                   // road id
  t0: number; t1: number;         // tiles along the road
  width: number;                  // tiles either side
  near: string;                   // settlement id
  camp?: RoadPoint;               // gangs: where the camp is (off the road, inside the band)
  den?: string;                   // packs: the cave POI id that is its den, if one is in the stretch
}

// shared/src/road/wildlife.ts
export interface Wild { id: string; kind: "deer" | "hare" | "fox" | "crow" | "heron" | "adder" | "boar"; x: number; y: number; n: number /* group size */; }
export function wildlifeAt(seed: number, road: RoadPath, t0: number, t1: number, day: number, hour: number): Wild[];

// shared/src/road/poi.ts (N27's type, started here)
export interface Poi { id: string; kind: PoiKind; cx: number; cy: number; x: number; y: number; name: string; ref?: string; interior?: string; hidden?: number }
export function roadsidePlaces(seed: number, data: RoadData, road: RoadPath): Poi[];

// server: town.road (RoadPlay) gains
creatures: Record<string, Creature>;  // hostiles and promoted wildlife near the player, not saved (rebuilt from territories)
// player.road gains
taken: Record<string, number>;        // promoted/killed wildlife id → day (pruned after 2 days)
used: Record<string, number>;         // POI id → day used (shrine prayed, herbs picked, ore mined)
```

```ts
// server: game/road/commute.ts (decision 12)
export interface Commute { person: string; job: "miner" | "hunter" | "carter" | "guard"; from: string; to: string /* POI id: mine, woods-edge, watch post */; out: number; back: number /* minutes */; cargo?: Record<string, number> }
export function commutesOf(realm: Realm, people: PeopleStore, site: string, day: number): Commute[];

// realm: SettlementState gains (decision 13)
watch?: { mine: string; guards: string[] /* person ids */; hired: Array<{ person: string; from: string; wage: number; since: number; until: number }>; level: 0 | 1 | 2; checked: number /* day */ };
```

`sellsword` joins the job list (`realm/types.ts`). `watch` is optional on the settlement, so old realms load with no watch.

SQLite gains one table (decision 14), next to the people tables in `server/src/store/`:

```sql
beasts(id PRIMARY KEY, pack, species, sex, born, mother, life JSON, wounds JSON, wins, kills JSON, figure /* set once named */, died, died_how, died_by)
-- index on (pack, died)
```

A few hundred rows in a realm (packs cap around 8 to 12). This is a **save version bump** (the next version, with a real migration that turns each pack's `count` into that many rows of mixed ages, the alpha's row pointing at its figure). Old saves are disposable, so a clean break is also fine if the migration gets awkward. Territories, wildlife and roadside places are derived from the seed and the realm and cached like `roadDataOf`. `player.road` fields are optional with defaults.

## Steps

### Step 0: check what can be reused
- Confirm locality-map combat (creatures approaching, the attack action, the death and loot path, `haunts.ts` writing back to the pack) can run with `town.road.creatures` as the creature list. If combat assumes a `SiteState`, add a thin adapter rather than a second combat system. Write down what was found in the stage file's **What differs**.

### Step 0b: nobody made up
- Fix each row of the table in **The rule** above.
- Add the guard test (`tests/nobody-made-up.test.ts`): run a fixed-seed realm for a few days with the player walking, entering localities and meeting raids; check every person-template creature, situation actor and commuter against the people store and figures. Add `nobody-made-up` to `road/bounds.ts`.
- Tests: a raid on the start town brings named members of the raiding gang; refugees at the gate are rows from the place they fled; a revenge ambush is led by the person who wants revenge, with named helpers.

### Step 0c: pack beasts as rows
- The `beasts` table, the save migration, and `wilds.ts`'s pack rules moved onto rows (decision 14). `count` is kept as a cached number for code that only reads it.
- `stockHaunts` and `settleHaunts` stock and settle by beast id; the creature's `beast` id links it back. Rising, leadership and splitting as in decision 14.
- Admin view: a pack's card lists its beasts (age, scars, wins, kills); named ones link to their figure.
- Tests: a wolf wounded in the woods is the same wolf, still wounded, met on the road the next day; a wolf that kills a traveller is named, with news naming the dead; when the alpha dies the strongest named member leads; a pack's young have a mother in the pack; `count` always equals the living rows.

### Step 1: territories
- `shared/src/road/territory.ts`: `territoriesOf(realm-ids, data)` (decision 3). `threats.ts` becomes a wrapper over it and is later deleted; `encounters.ts` uses territories for off-screen meetings (keep `MEET_CHANCE` per territory passed).
- Admin view: draw territories on the realm map (stretches coloured by pack or gang), so they can be checked by eye.
- Tests: every live pack and gang has a territory; a pack's territories are within its range of `near` and in liked country where there is some; the same seed gives the same territories; a wiped-out pack's territory is gone the next day; an off-screen robbery happens inside a gang's stretch.

### Step 2: hostiles on the map
- `game/road/hostiles.ts`: while walking, for each territory the player is in, roll per game hour (decision 5); on a hit, stock members as creatures 40 to 70 tiles away, out of sight, and have them approach. Sighting line when they come into sight (decision 6). Unstock on leaving; write results back to the realm through the same functions `haunts.ts` uses.
- Gang members who meet the player start `toll_demanded` with themselves as actors (real rows); refusing starts the fight.
- Client: `RoadLayer` draws `town.road.creatures` with the existing creature sprites; the combat HUD works as on locality maps.
- Tests: walking a fixed-seed wolf territory at night meets wolves of that pack by name; killing one lowers the pack's count by one; fleeing 120 tiles unstocks them and their count is unchanged; a weak pack doesn't come out; at most one meeting per territory per day.

### Step 3: wildlife
- `shared/src/road/wildlife.ts` (decision 7) and creature templates `deer`, `hare`, `fox`, `adder`, `heron`, `crow` in `data/creatures/` (stats, loot, `fleeAt`; only the adder and a cornered boar fight back). Sprites through the G6 art pipeline (`npm run art`): one template per animal.
- Client draws wildlife from the same function; flee behaviour runs on the client for light animals and is not sent. Attacking one asks the server to promote it; the server recomputes `wildlifeAt` to check it's really there.
- Tests: the same seed, road, day and hour give the same animals on server and client (shared code); a hunted deer is gone for the rest of the day and gives meat and a hide; herons only by water, adders only on warm days.

### Step 4: roadside places
- `shared/src/road/poi.ts`: `roadsidePlaces` (decision 8), drawn as chunk features with sprites. Interiors for ruin and cave from the `sites.ts` layout code (add a cave and a small ruin layout), keyed and seeded by POI id. Shrine, herb patch and ore outcrop are used in place through N38's action menu (new actions `pray`, `gather`, `mine` in `server/src/game/choice/actions/`), recorded in `player.road.used`.
- A pack's den is the cave inside its territory if there is one (decision 8); its interior holds the alpha and young, stocked by `stockHaunts`.
- Tests: about one place per 700 tiles over a long fixed road (within a band); the same seed gives the same places; a shrine can be prayed at once a day; picked herbs regrow after their days; an abandoned cart is only placed where a robbery was recorded.

### Step 5: the village's surroundings on the road
- Decision 9: place the woods-edge, the hidden camp and the mine spur for every settlement that has them. Village map exits: remove the woods and road-area exits; all exits lead onto the road. Entering a place loads its existing locality map as an interior; leaving returns to the road point.
- The camp is shown on the road only once the player knows it (`playerKnows`), and is drawn by the server, never seeded on the client (N27's rule that secret places come only from the server).
- Update N15's tests on purpose (the maps are the same; how they are reached changes). Check the gang camp, the mine's deeps and the wolves of the woods still work as before.
- Tests: from the start town, the woods are reached by walking out along the road, not from the village map; the camp isn't on the client until known; leaving the mine puts the player on the spur track.

### Step 5b: commuters, the mine watch and hired swords
- `game/road/commute.ts` (decision 12): `commutesOf` for miners to the working mine, hunters to the woods-edge, the afternoon ore cart; drawn and talkable like travellers near the player. The miner and hunter routines in `townsfolk.ts` keep saying `out:...`; only where they go while out changes.
- `game/road/watch.ts` (decision 13): the weekly danger check, posting the town's guards, hiring `sellsword` rows with a wage from the treasury, releasing them, news for each change. Watch guards are commuters too. `encounters.ts` counts the watch on the spur like a patrol.
- The `hire_on` action for the player (N38's menu).
- Admin view: a place's card shows its mine watch, who is hired from where and the wage; the realm map draws the watch post.
- Tests: miners of a hill town are on the spur at 06:30 and at the mine at noon (by name); the ore cart carries that day's output; a gang territory over the spur makes the town post its full watch within a week; a town with two guards and coin hires sellswords from the nearest city, who arrive by a journey and are paid daily from the treasury; with no coin it can't hire and says so in its news; the watch beats a small gang off-screen and is news; the player hired for a day is paid at the end.

### Step 6: situations every stretch, signs and new situations
- Fixed 1,200-tile stretches and the no-actor fallback (decision 10); the new situation files (`fallen_tree`, `washed_out_road`, `herders_with_flock`, `hunters_on_the_road`, `pilgrims`), checked by `check-npcs` as now.
- Signs (decision 11) as chunk features from territories, camps, death records and distances.
- Tests: a stretch whose actors can't be found gets a no-actor situation; tracks appear only inside a pack's territory; a fresh grave's name is a real death on that road.

### Step 7: tune and bound
- `road/bounds.ts` gains `road-beats` (5 to 10 beats per day's walk on fixed-seed roads, at least 300 tiles apart) and `road-danger` (hostile meetings per day's walk: about 0 within 400 tiles of a town, 0.5 to 2 on wild roads; a fresh player with starting gear survives a lone-wolf or two-bandit meeting most of the time).
- Play a day's walk between the start town and its liege town in the browser, and adjust densities.

### Step 8: docs
- README: what's on the road, territories and signs, hunting, roadside places, where the woods and camp went. Stage file: tick N26F, **What differs**. Note in N27 and N28 which of their steps are done.

## Balance bounds

- `road-beats`: 5 to 10 beats per day's walk, spaced at least 300 tiles apart.
- `road-danger`: as in step 7; also that pack counts don't drain from the player's road kills faster than packs regrow over a 48-day year of normal travel.
- `territories-sane`: no road more than 40% covered by territories; every pack and gang has one.
- `watch-paid`: no treasury goes negative from wages; hired sellswords per realm stay within the number of sellsword rows.

## Edge cases and traps

- **Fast travel and the coach** skip the map. They keep meeting territories as off-screen encounters (`encounters.ts`), so danger doesn't vanish when skipping.
- **The CLI's `/travel`** has no map. It keeps its time skip, now rolling territories it passes instead of the two old rolls.
- **Two territories overlap** (a pack and a gang on the same stretch): both can come out, never on the same game hour.
- **Night sight** isn't built (N26 "Not built"). Sighting distance at night should still be shorter, through the sighting line's distance rule, even before the sky is drawn darker.
- **Crowds of creatures:** `MAX_ON_MAP` per territory, and at most 8 road creatures in total near the player, so a busy stretch can't flood the frame.
- **Client and server disagree about wildlife** if either side's inputs drift (hour, weather). The server is the judge when promoting; a "the deer is gone" line covers a miss.
- **Escort and companions:** companions fight road hostiles as they fight in the woods (`companionPower` is replaced by real companion creatures on the map, if step 0 finds that's how locality combat works).
- **Commuters and the crowd:** a miner on the spur must not also be in their town's crowd. They are already out (the `out:exit_road` routine); the commute only decides where they are drawn. A miner killed on the spur dies on their row and leaves the crowd for good.
- **Hiring drains small treasuries:** a cap of a third of the treasury on wages a year; past it, the town lets the watch thin and says so. `watch-paid` checks no treasury goes negative.
- **Sellswords are people, not a number:** each hire is a row moving town, as Part E's rule asks. A city with no sellswords left can't supply more, so hiring in a bad year is a real shortage.
- **Settlements without roads** (waystation hamlets are `s.way` and have no roads of their own): skip them for woods, camp and mine placement.

## Tests (`packages/server/tests/n26f.test.ts`, `packages/shared/tests/territory.test.ts`, `packages/shared/tests/wildlife.test.ts`)

- Territories: deterministic, follow the realm, used by both the player and off-screen journeys.
- Hostiles: met on the map by name, results written back, fleeing, weak packs stay in.
- Wildlife: shared and deterministic, promotion, `taken`.
- Roadside places: density band, use once a day, regrowth, carts only from real robberies.
- Localities on the road: woods reached by walking, camp hidden until known, interiors unchanged.
- Beats: a fixed-seed day's walk between two towns has 5 to 10 beats.

## Done when (mapped)

| Done-when clause | Proved by |
|---|---|
| a day's walk between the start town and its liege town has 5 to 10 things to see or do, spaced through the walk | beats test (`road-beats`) |
| walking a wolf pack's stretch at dusk, the player sees the wolves coming and fights them on the map; one killed is one fewer in the pack | hostiles test |
| a gang demands a toll by its members' names on its own stretch, and a party robbed off-screen was robbed on the same stretch | hostiles + territories tests |
| the player hunts a deer by the road and gets meat and a hide | wildlife test |
| a wolf that kills someone on the road gets a name, is talked about, and leads the pack when the alpha dies | pack beasts test |
| the start town's woods, its gang's camp and its mine are reached by walking along the road, not from the village edge | localities test |
| in a hill town's morning the player passes its miners walking to the mine, and the mine has guards on the route; with a gang about, the town hires sellswords it pays from its treasury | commuters and watch tests |

## Slice cut

In the slice: steps 1 to 3 and 6 on the road between the start town and its liege town. Steps 4 and 5 for the start town only, so the woods are on the road from the first hour (N39 can then point the player down the road to them).

## Out of scope

Fantasy creatures (N54). Off-road exploration, the player's map and fog, getting lost, reporting finds, hermits (N27). Plants beyond herb patches, the bestiary, lookalikes, fishing (N28). Seasons changing which animals are about (N30; until then use `seasonOf(day)` lightly, e.g. no adders in winter). Sounds for any of it (N29).
