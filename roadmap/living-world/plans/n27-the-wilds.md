[← Plans](README.md) · [Stage 2: N27](../stage-2-everyone-lives.md#n27-the-wilds)

# N27 plan: The wilds

> **N26F (planned 2026-10-24) brings parts of this plan forward:** decision 3 and step 8 (the woods, camp and mine move onto the road, their maps kept as interiors), step 1 for places near a road (`roadsidePlaces`, using this plan's `Poi` type and ids), and step 2 for packs and gangs as road territories (a pack's den is a cave in its territory). If N26F is built first, build the rest of this plan on top of it: extend `poi.ts` off-road and reuse its territories for lairs and camps.

**In one line:** the chunk world from N26 extends off the road; points of interest are placed by seed and by the realm's real state (a pack's lair where the pack is, a gang's camp where the gang is); the player finds them, can get lost, and nothing is on their map until they find it or hear of it.

**Read first:** [plans README](README.md) sections 2, 3 (the player's map is knowledge), 7. Needs N26 (chunks, `chunkAt`, the time scale, the player's needs, `player.road` position) and N24 (`playerKnows`/`playerLearns`).

## What exists

- N26: the global tile grid, `chunkAt(seed, road, cx, cy)` (shared, pure), biomes from settlements' terrains plus noise, chunk overrides in SQLite, walking between chunks, the player's needs, nights and weather.
- N15 localities: each settlement's woods, its gang's camp, the mine road and old mine are separate 26×18 maps (`areasOf`, `siteMap(site, area, realm)` in [`sites.ts`](../../../packages/server/src/web/sites.ts)); their creatures come from `haunts` ([`realm/haunts.ts`](../../../packages/server/src/game/realm/haunts.ts)) synced with the realm's packs and gangs.
- Realm state with places: `realm.dungeons` (pos, near), `realm.packs` (near), gangs (factions of kind `gang` with a `seat`), wars with `battles[].at`, abandoned settlements (`abandoned: true`), figures with deaths (N25's typed death records, with site).
- Skills: `foraging`, `hunting` exist ([`npc/skills.ts`](../../../packages/server/src/npc/skills.ts)); no survival/navigation skill.
- Foraging today: `forage(player, rng, day)` in [`gathering.ts`](../../../packages/server/src/game/gathering.ts) gives herbs/pelts/ore by place.

## Decisions made in this plan

1. **Off-road is the same chunk world.** No new map system: `chunkAt` already generates every chunk; off-road chunks simply have no road. What N27 adds is **points of interest (POIs)**, **interiors** for some of them, **discovery**, and **navigation**.
2. **Two sources of POIs.**
   - **Seeded POIs** (static, from the world seed): caves, standing stones, groves, herb patches, ore outcrops, ruins of places that never were in the realm's record (old, nameless), hermits' huts. Placed by `poisInChunk(seed, cx, cy, biome)` with a density per biome, deterministic. Each has an id `p:<cx>:<cy>:<k>`.
   - **State POIs** (from the realm, can change): a pack's **lair** (in the wild nearest the pack's `near` settlement, in a biome its species likes), a gang's **camp** (near its seat, off-road, hidden), a dungeon's **mouth** (at `dungeon.pos`), **abandoned villages** (an abandoned settlement's footprint becomes ruins), **old battlefields** (each battle's `at` → a field near that settlement with graves), **graves** of named dead (N25 records with site and cause), and later N59's hidden runaway camps and N63's explorers' finds. These are computed from the realm each day into a `pois` table (`id, kind, cx, cy, x, y, ref, since, until`).
3. **Localities fold into the chunk world.** N15's woods/camp/mine maps become POIs and interiors in the chunk world: a settlement's woods are the forest chunks around it, its gang's camp is the camp POI, its mine road is a side road. Keep their current maps as the camp's and mine's **interiors** (entered from the POI), so their layouts and tests survive. Migrate in a separate step at the end of this phase, with N15's tests updated deliberately; until then, both exist (localities reachable from the village as today).
4. **The player's map is knowledge.** `player.map`: known POIs, known road segments, known chunks (fog of war). A POI is shown when found (walked within sight), heard of (an NPC told them, N24 `playerLearns(poiRef, "told")`), or read on a bought map. The admin view shows all POIs at once (it's the truth).
5. **Getting lost is a state, rolled by code.** Off-road, each game hour without a map of the area, a guide in the party, or a successful check (`check(rng, wisdom, target, survival skill)`; add a `survival` skill to `SKILLS`), the player may become **lost**: the minimap hides their position, the header says "You're not sure where you are", and walking drifts (each step has a chance to turn ±1 from the intended direction). Being lost ends when they reach a road, a known POI, a landmark visible from afar (standing stones, a river they can follow), or pass a later check. Night, fog/storm and marsh make the target harder.
6. **Discovery is news when it matters.** Finding a POI the realm cares about (an ore outcrop, a ruin, a dungeon, a hidden camp) records an event (`discovered`, actor player) and lets the player **report** it (tell a settlement's head: N63 later turns reports into new mines and settlements; for now a reward and a lore entry), **sell** the location (to a merchant or the guild), or **keep** it.
7. **POI names come from code first.** Templates per kind ("the Hollow Cave", "the Grey Stones"); the model may give a better name through N19's budget (`place-name`) with the invented-name check; the template stands if the model is off or over budget.

## Data shapes

```ts
// shared/src/road/poi.ts
export interface Poi { id: string; kind: PoiKind; cx: number; cy: number; x: number; y: number; name: string; ref?: string /* pack, faction, dungeon, battle, person, settlement */; interior?: string /* interior map key */; hidden?: number /* 0..1: how hard to spot */ }
export const POI_KINDS = ["cave", "ruin", "abandoned-village", "battlefield", "grave", "standing-stones", "grove", "hermit-hut", "shrine", "lair", "camp", "dungeon-mouth", "herb-patch", "ore-outcrop"] as const;

// player
player.map: { pois: Record<string, { day: number; how: "found" | "told" | "map" }>; chunks: string[] /* "cx:cy" seen */; segments: string[] }
player.lost?: { since: number }
```

SQLite: `pois(id PRIMARY KEY, kind, cx, cy, x, y, ref, name, since, until)` with index on `(cx, cy)`; `chunks_seen` for the player could be large: store as a compact bitset per region rather than strings once it passes a few thousand.

## Steps

### Step 1: seeded POIs in chunks
- `shared/src/road/poi.ts`: `poisInChunk(seed, cx, cy, biome)`; draw them in the chunk (features with sprites); they block or don't as their kind says.
- Test: same chunk → same POIs; densities per biome within expected counts over a 20×20 chunk area.

### Step 2: state POIs from the realm
- `game/road/statePois.ts`: daily from the realm: lairs for packs, camps for gangs, dungeon mouths, abandoned villages, battlefields, graves of the named dead (a figure or renowned person whose death record has a site: a grave in that settlement's graveyard, or at the battlefield if they died in battle). Upsert into `pois`; end ones whose source is gone (a pack wiped out → its lair empties, `until = day`; leave the place, empty).
- **Positioning rule:** "exactly where the realm says". A lair is placed by seed within the pack's range (chunks near its `near` settlement, in a biome its species likes), and stays there while the pack exists. The haunts code (N15) uses the same position for where the pack's beasts are, so meeting the pack and finding its lair agree.
- Test: a pack's lair is within its settlement's range and moves only if the pack is replaced; a gang's camp is near its seat; a hidden runaway camp hook exists for N59 (an empty source list today).

### Step 3: interiors
- Caves, ruins, abandoned villages, camps, dungeon mouths, hermits' huts have interiors: small generated maps (reuse `sites.ts` layout code; add cave and ruin layouts), keyed by POI id and seeded by it. Entering and leaving as with localities.
- Ruins with a story: an abandoned village's ruin holds its last people's graves (N25 death records of those who died there) and a clue (a note, a burnt hall) from the realm's history (why it was abandoned: famine, raid, war: from its last events).
- Battlefields: graves with names and causes from N25/N55 death records; old gear (low-value loot).
- Test: a battlefield's graves name people who died in that battle.

### Step 4: discovery and the player's map
- Spotting: each step, POIs within sight radius (by biome: plains far, forest near; night nearer) and `hidden` check (perception: wisdom + skill) become found.
- `player.map` updates; the client's minimap and the Realm tab draw known POIs and seen chunks only.
- NPCs who know a place (hunters know lairs and groves near home; a hermit knows the caves; gang members know their camp) can tell the player about it: give those NPCs lore entries for the POIs they'd know (knowledge scopes as N3), and when used in conversation, `playerLearns`.
- Maps as items: a merchant sells "a map of the <region>" listing the region's seeded POIs and roads (not hidden ones); using it adds them to `player.map` as `how: "map"`. The player can draw a map (an item listing what they've found) and sell it.
- Test: a POI is not on the player's map until found or told; the admin view lists it at once.

### Step 5: reporting finds
- `discovered` events. Reporting an ore outcrop or ruin to a settlement's head (talking NPC, new action `report_find`): reward from the treasury by value, a lore entry for the place, and an N63 hook (`finds` table: `{ poi, reportedTo, day }`) that N63 will turn into a mine project or an expedition. Selling the location to a merchant or guild: they get the lore; it may become known to others (gossip).
- Test: reporting the outcrop to the mayor pays and records the find.

### Step 6: getting lost
- `survival` skill added to `SKILLS` (with words and trainers where it fits: hunters can teach it).
- Lost rules (decision 5); a guide (hire a hunter, a companion with survival) prevents it; following a river or reaching a landmark ends it.
- Client: minimap hidden when lost; drift applied by the server (the client asks to step east; the server may move north-east and says why: "You lose the path in the reeds.").
- Test: in the marsh at night without a guide, the player becomes lost within a few hours (seeded); with a guide, never.

### Step 7: living wilds and people out there
- People in the wilds are real: hunters and herb gatherers from nearby settlements go out by day (N16's crowd already sends hunters and miners out through exits: give them **wild journeys** to real spots: N26's journey type with a wild destination; after N26 Part E these are people marked `away` like any traveller, skipped by their town's crowd while out and back the same day), prospectors, hermits (a person row living at a hermit's hut POI: `site = "p:<id>"`), outlaws at camps (gang members, positions from the camp), explorers on N63 trips later.
- Beasts move in their range by day/night (N28 adds the light wildlife; N27 handles packs as today).
- Harsher weather off-road (needs fall faster); nights are dangerous (more beast encounters near lairs).

### Step 8: fold the localities in
- Make each settlement's woods the forest chunks around its footprint; the camp and mine become POIs with N15's maps as interiors; exits from village maps lead onto the chunk world instead of to separate locality maps.
- Update N15 tests on purpose (the maps still exist, entered differently). Check Rook's camp, the Old Mine Deeps' mouth, and the wolves still work as before.

### Step 9: docs
- README: exploring off-road, the map, getting lost, reporting finds.

## Balance bounds

- `pois-band`: state POIs per settlement within a band (no realm covered in lairs).
- `finds-reported`: not required; just count.

## Edge cases and traps

- **Hidden things must stay hidden from the client.** The client generates seeded POIs itself (it has the seed and code), so seeded POIs can't be secret from a determined player. That's acceptable for caves and stones. **State POIs that are secrets** (hidden camps, runaways) must come only from the server, and only once the player knows them. Never send the `pois` table wholesale.
- **Admin vs player maps:** same drawing code, different data source. Test the player endpoint returns only known POIs.
- **Graves of the cast** (Brena, if she dies) should be in Millbrook's graveyard; graves need a graveyard per settlement (a site-map feature: add to `sites.ts` layouts).
- **Lost drift vs path-finding:** the client's click-to-walk path-finder will fight the drift. When lost, disable long click-walks (one step at a time, or short hops).
- **Interior keys are POI ids:** if a POI ends (lair empties), keep its interior reachable (an empty lair).

## Tests (`packages/server/tests/n27.test.ts`)

- Seeded POIs deterministic; state POIs follow the realm (pack → lair; pack gone → empty lair).
- Leaving the road east of Millbrook (fixed seed), within a set walk: a cave not on the player's map is found; a ruin from an old war with a named grave; an ore outcrop reported to the mayor.
- Lost in the marsh at night without a guide; not with one.
- A hidden camp is exactly where the realm's gang is seated (and N59's runaway camp test is added in N59).
- The player endpoint never returns an unknown hidden POI.

## Done when (mapped)

| Done-when clause | Proved by |
|---|---|
| leaving the road east of Millbrook the player finds a cave not on any map, a ruin from an old war with a named grave, and an ore outcrop they can report to the mayor | fixed-seed walk test (pick the seed with `sim:realm` and a POI dump script) |
| they get lost in the marsh at night without a guide | lost test |
| a hidden runaway camp is found exactly where the realm says the runaways are | gang-camp version now; runaway version in N59 |

## Slice cut

Not in the slice.

## Out of scope

Animals and plants beyond packs (N28). Seasons changing the land (N30). Founding settlements from finds (N63).
