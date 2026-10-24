[← Plans](README.md) · [Stage 2: N28](../stage-2-everyone-lives.md#n28-fauna-and-flora)

# N28 plan: Fauna and flora

> **N26F (planned 2026-10-24) brings decisions 2 and 3 forward** for seven roadside animals (deer, hare, fox, crow, heron, adder, lone boar): `wildlifeAt` in `packages/shared/src/road/wildlife.ts`, promotion to a creature when hunted, and a `taken` list. If N26F is built first, this plan turns those into species files and generalises `wildlifeAt` off the road instead of writing a second one.

**In one line:** animals and plants are data files; where they are on a map is a pure function of seed, terrain, season and the realm's populations, computed in shared code on server and client; most are light (drawn, never simulated) until hunted, gathered, provoked or tamed; their products feed health, crafting and the economy; the player learns them in a bestiary and herbarium.

**Read first:** [plans README](README.md) sections 2, 7 (shared code), 9 (performance). Needs N26 (chunks, biomes, time scale) and N27 (off-road chunks, POIs, `survival`). N30 (seasons and the farming year) comes later; use `seasonOf(day)`/`dayOfYear(day)` from [`weather.ts`](../../../packages/server/src/game/weather.ts) until then. N60 (ecology populations) comes later; until then, populations are per-biome constants modulated by season.

## What exists

- **Creatures** are fight-ready templates ([`data/creatures/*.json`](../../../packages/server/src/data/creatures/): bandit, bear, boar, horse, spider, villager, wolf) with stats, skills, attack, `fleeAt`, loot, barks, `aggressive`, `hunts`; loaded and spawned by [`creatures.ts`](../../../packages/server/src/game/creatures.ts) and spawn rules ([`spawning.ts`](../../../packages/server/src/game/spawning.ts)); realm packs ([`realm/wilds.ts`](../../../packages/server/src/game/realm/wilds.ts)) for wolves, bears, boars, spiders.
- **Items** ([`items.ts`](../../../packages/server/src/game/items.ts)): `ITEMS` record with tiers; pelts, hides, silk, herbs, ore come from loot and foraging (`forage` in [`gathering.ts`](../../../packages/server/src/game/gathering.ts)) and feed crafting recipes.
- **Health** ([`health.ts`](../../../packages/server/src/game/health.ts)): `ILLNESSES`, `fallIll`, `cure(who, id)`, `tend`, injuries.
- **Skills:** `foraging`, `hunting`; N27 adds `survival`.
- **The journal** ([`journal.ts`](../../../packages/server/src/game/journal.ts)): kinds for notes; no bestiary.
- **Crowd jobs** include `hunter`; hunters walk out through exits (N16).

## Decisions made in this plan

1. **Species are data.** `server/src/data/species/animals/*.json` and `server/src/data/species/plants/*.json`, one file per species, a zod schema in `game/nature/speciesSchema.ts`, checked by `check-npcs` in CI. Start with ~40 animals and ~40 plants covering the stage file's lists; add more later without code changes.
2. **Light by default.** A light animal or plant has no state: its position and stage at a time are computed by `wildlifeAt(seed, cx, cy, absMinute, season)` in `packages/shared/src/nature/`. The client draws them; the server computes the same set only when the player interacts. Nothing per animal is stored or sent per step. Copy N16's crowd pattern.
3. **Promotion.** When the player (or an NPC) hunts, provokes, or tames an animal, it's **promoted** to a full `Creature` (from a creature template linked in the species file: `creature: "deer"`; add templates for huntable/tameable species). The promoted id is the light animal's id (`a:<cx>:<cy>:<k>:<day>`), so the server knows which light animal it was. A killed or tamed light animal is recorded in a small `taken` table (id, day) so it isn't drawn again that day (and, for rare species, the local population is reduced through N60 later).
4. **Plants are per-tile vegetation with a stage.** Each tile's plant cover is seeded by biome; a plant's stage (bud, flower, fruit, seed, dormant) is a function of `dayOfYear` and the species' calendar. Gathering takes from a tile: record `(tile, species, day)` in `gathered` with a regrowth time per species, so a picked patch is empty until it regrows. Overrides are sparse.
5. **Identification is a skill check, and wrong is possible.** Some species have **lookalikes** (a field `lookalike: "deathcap"` on the edible mushroom). Gathering a species the player hasn't identified rolls `foraging` (or `herbalism`, see 6) against its difficulty; a failure gives the lookalike's item without telling the player (the item's display name is what they *think* it is until used or shown to an expert). Eating the wrong mushroom: its real effect (illness, poison status).
6. **New skills:** `herbalism` (identify and prepare plants), `fishing`, `animal_handling` (taming, riding). Add to `SKILLS` with trainers (herbalists, hunters, fishers, stablehands) so they can be taught (N9's training).
7. **NPCs do the same for a living.** New crowd jobs: `herbalist`, `forager`, `fisher` (and `hunter` exists). They go out at the right season to the right biome (wild journeys from N27: real people `away` on a Part E journey, back with their goods), return with goods, and sell them (traders: herbalists and fishers sell). Their yields come from the same species data (the server computes what they'd find with the same functions, deterministically).
8. **Laws on hunting** are a hook now, rules later: `isForbidden(species, place, day, who)` returns false except for a **lord's forest** flag on chunks near a noble's seat (deer there are the lord's) and closed seasons in the species file; N48 (law) gives it teeth (poaching as a crime). For now, poaching in a lord's forest witnessed by a forester/guard records a `crime` event via the existing crime system.

## Species file (example)

```json
{
  "id": "red_deer",
  "kind": "animal",
  "name": "red deer",
  "biomes": { "forest": 1.0, "hills": 0.4, "plains": 0.2 },
  "seasons": { "spring": 1, "summer": 1, "autumn": 1.2, "winter": 0.6 },
  "abundance": 0.3,
  "group": { "min": 2, "max": 7, "kind": "herd" },
  "active": "dawn-dusk",
  "behaviour": { "flees": 8, "grazes": true, "migrates": null },
  "signs": ["tracks", "droppings", "browsed twigs"],
  "creature": "deer",
  "products": [{ "item": "venison", "qty": [2, 4] }, { "item": "deer hide", "qty": 1 }, { "item": "antler", "qty": 1, "chance": 0.5, "season": "autumn" }],
  "hunt": { "skill": "hunting", "difficulty": 12, "tools": ["bow", "trap"] },
  "closedSeason": ["spring"],
  "lordsGame": true,
  "lore": { "omen": null, "sacredTo": null, "dish": "venison stew" },
  "rarity": "common"
}
```

Plants: `{ id, kind: "plant", name, biomes, calendar: { bud: [d0, d1], flower: [...], fruit: [...], dormant: [...] } (days of year as fractions 0..1 so they follow config.daysPerYear), cover, products by stage, lookalike?, identify: { skill, difficulty }, effects: [{ when: "eaten" | "brewed" | "applied", cures?: IllnessId, causes?: IllnessId | status, heals? }], regrowDays, rarity }`.

## Steps

### Step 1: schemas, files and checks
- `game/nature/speciesSchema.ts` (animals and plants), loader `loadSpecies()`, and `check-npcs` validation: biomes exist, products are items in `ITEMS` (add the new items: venison, deer hide, antler, feathers, eel, berries, roots, mushrooms…), creature templates exist for promoted species, lookalikes point at real species, calendars are within 0..1.
- Write the first ~40 + ~40 species files (the stage file's lists per terrain, plus village animals: cats, dogs, rats, crows, pigeons, livestock).
- Test: every species file loads; a broken one fails `check-npcs` with a clear message.

### Step 2: light wildlife placement (shared)
- `shared/src/nature/place.ts`: `wildlifeAt(seed, species[], chunk, absMinute)` → animals in the chunk at that time: groups placed by seed per chunk and day (`streamFor`-style hashing on `(seed, cx, cy, day, species)`), positions moving smoothly within a home range over the day (a closed curve per group, like a crowd plan), filtered by activity time (diurnal/nocturnal/crepuscular), season weights and biome weights.
- The species data the client needs is sent once (`GET /api/species`, cached).
- Performance: a chunk's wildlife computed in < 2 ms; the client keeps at most a few hundred light animals in view.
- Test: deterministic; nocturnal species absent at noon; deer in forest chunks, herons in marsh, gulls on coast; spring vs autumn differ in counts where seasons say.

### Step 3: behaviour near the player (client-side, cosmetic)
- Fleeing: a light animal within its `flees` distance of the player moves away (client-only animation; it rejoins its curve later). Flocks rise together. Birdsong at dawn shows as small "♪" and later N29 sound. A wood "goes quiet" (fewer small birds drawn) within a radius of a predator group (a pack from the realm or a light predator).
- This is cosmetic and doesn't need the server: the server's truth is the curve position. When the player interacts, the server uses the curve position (so a fleeing deer the player clicks is checked at its curve position within a tolerance).

### Step 4: plants and phenology
- `shared/src/nature/plants.ts`: per-tile plant cover by biome and seed; `stageOf(species, dayOfYear)`; drawn as small overlays (flowers in season, berries, fungi after rain in autumn).
- Fields of crops around villages (from `farms` building level): crop stage by the farming calendar (N30 will own it; for now use the species calendar of wheat/barley/rye).
- Test: a spring walk and an autumn walk through the same forest chunk show different flowering species (stage function).

### Step 5: gathering, identification and effects
- Action `gather` on a tile with a plant: skill check by species difficulty; success gives the product by stage; failure on a species with a lookalike may give the lookalike's product **labelled as the intended one** (store the true item key and a `believed` name on the stack; show the believed name to the player until used or identified by an herbalist).
- Effects through health: a fever cure (`cure(player, "fever")` when a willowbark brew is drunk), a poison (status) from the wrong mushroom.
- `gathered` overrides with regrowth.
- Replace today's `forage()` loot tables with species-based gathering where the player is in a chunk; keep `forage()` working in village localities until N27 folds them in.
- Test: gathering a fever herb in season and brewing it cures a fever; a mushroom with a lookalike, with a fixed failing roll, sickens the player; the patch is empty the next day and regrows after `regrowDays`.

### Step 6: signs and tracking
- Each animal group leaves signs along its curve (tracks, droppings, broken branches): drawn only when the player is close and passes a perception/hunting check; clicking a sign shows what it means with skill ("deer, three, passed this morning, heading east").
- "Track" action: follow the trail toward the group's current position (the server reveals the next sign).
- Test: tracking a boar by its signs leads to the boar group.

### Step 7: hunting, fishing, taming
- **Hunting:** promote the target (decision 3), then the existing creature fight with a ranged opening (bow) or a trap (set a trap item on a tile; checked each game hour with the species' chance; catches from the same placement function so it's deterministic).
- **Fishing:** at water tiles with a rod or net; catch from the water's fish species by season and time of day, `fishing` skill.
- **Taming:** dogs (strays in villages), hawks, horses: `animal_handling` checks over several interactions (feeding, patience); success makes a companion animal (N8 companions) with a small set of abilities (a dog warns of ambushes and tracks; a hawk hunts small game; a horse is a mount, N26's D2).
- Laws hook (decision 8).
- Test: fishing the river gives a fish of a species that lives there in that season; taming a stray dog over a few days makes it a companion.

### Step 8: knowledge: bestiary and herbarium
- Journal gets kinds `bestiary` and `herbarium`. An entry is added the first time the player sees a species close (glimpse: name only if skill allows, else "a large brown bird"), is told about it (NPC knowledge, hunters and herbalists have species lore), or studies it (hunting/gathering it, or reading a book). Entries fill in levels: name → habitat and season → uses → lookalikes and dangers.
- Herbalists and hunters can teach (N9 training) and identify an item (an action at their stall: "show"), which reveals a believed-but-wrong item.
- Test: the bestiary lists the species met; showing a wrong mushroom to an herbalist reveals it.

### Step 9: NPCs who live off the land
- New crowd jobs `herbalist`, `forager`, `fisher` in `JOBS`/`JOB_INFO` (shared crowd.ts) with plans that go out in season; their yields computed with the same placement and products; they sell (`sells: true` for herbalist and fisher).
- A rare root sought in its season: an herbalist's plan goes to the biome where it grows at the right time of year, returns with it, and sells it at a high price; the quest market (N42) can later ask for rare species.
- Test (fixed seed): an NPC herbalist goes out at the right season for a rare root and sells it.

### Step 10: culture hooks and strange things
- Species `lore` fields (sacred animals/trees, omens, dishes) are read by later phases (N50 belief, N53 cultures, N68 songs); for now, put a few into NPC lore so they can talk about them.
- Rare and strange species (`rarity: "legendary"`) appear only in deep wilds and dungeon interiors (N27), very rarely, with a legend lore entry; seeing one is an event.

### Step 11: docs
- README: wildlife, gathering, the bestiary; how to add a species file (for authors).

## Balance bounds

- `wildlife-not-empty`: every biome chunk sample has some wildlife in each season.
- `herbalist-income`: NPC herbalists earn within a band (the economy isn't flooded with rare roots).

## Edge cases and traps

- **Light animals and the realm's packs are different things.** Wolves as a realm pack (N13) are real, counted and fought; a lone light wolf would contradict the pack's count. Rule: predators that are realm packs (wolf, bear, boar, giant spider) appear **only** from the pack (haunts/lair positions), never as light wildlife. Light wildlife is everything else.
- **Client/server agreement:** placement is shared code; the server always re-computes before accepting an interaction (a hunted deer must exist at that position and time, within a tolerance for client-side fleeing animation).
- **Performance in a capital:** village animals (cats, pigeons, rats) in a 96×64 capital with 4,000 people: cap light animals drawn in a town view (e.g. 60), inside N19's frame budget.
- **The believed-name trick** must not leak through the UI (tooltips, item keys in network responses). Send the believed name only; the true key stays on the server.
- **Calendar in fractions of the year**, not days, so `config.daysPerYear` changes don't break species files.

## Tests (`packages/server/tests/n28.test.ts`, `packages/shared/tests/nature.test.ts`)

The done-when ones:
- A walk through the woods east of Millbrook: deer present and flee (client logic test with a player approaching), birds active at dawn, different flowers in spring and autumn.
- Tracking a boar by its signs (boar is a realm pack species: use a non-pack huntable species such as a wild goat, or make boar light-only if it isn't a realm pack in that region; decide and note it).
- A fever herb cures a fever; a mushroom sickens.
- Fishing the river.
- Taming a stray dog.
- The bestiary has the species met.
- An NPC herbalist gathers a rare root in season and sells it.

## Done when (mapped)

| Done-when clause | Proved by |
|---|---|
| deer that flee, birds at dawn, different flowers in spring and autumn | steps 2–4 tests + play |
| tracks a boar by its signs | step 6 test (see the pack-species note) |
| gathers a herb that cures a fever and a mushroom that sickens them | step 5 test |
| fishes the river, and tames a stray dog | step 7 tests |
| the bestiary has the species they've met | step 8 test |
| an NPC herbalist goes out at the right season for a rare root and sells it | step 9 test |

## Slice cut

Not in the slice.

## Out of scope

Populations that rise and fall with hunting and food webs (N60). The farming year (N30). Sound (N29). Poaching trials (N48). Animal diseases (N61).
