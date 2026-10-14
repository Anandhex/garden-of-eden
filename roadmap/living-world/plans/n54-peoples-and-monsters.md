[← Plans](README.md) · [Stage 5: N54](../stage-5-power-and-conflict.md#n54-peoples-and-monsters)

# N54 plan: Peoples and monsters

**In one line:** species become data files with body, life, **intelligence**, **way of living**, temperament and **stances toward every other species**; the realm generator places their settlements, bands, lairs, kingdoms and factions with N13's own types (so the same economy, politics, treaties, raids and wars run them); a small share of beast-minded individuals are **clever** and can talk; each kingdom has a **policy per species** for living among its people; dragons are few, ancient and enormous. This is the largest Stage 5 phase; it's split into four parts that can each be finished and played.

**Read first:** [plans README](README.md) sections 2, 4, 12, 13, 14 (`species:<id>` policy), 17. Needs N13 (the realm), N27 (POIs: warrens, lairs, steadings; step 0 if missing), N53 (each people gets a culture template). Uses N28 (tracks and signs), N26 (travellers of other peoples), N37 (prejudice in chatter), N42 (dragon-slayer jobs), N43 (hoards), N51 (peoples' magic), N55 (armies), N67 (reputation by people).

## What exists

- **Species** ([`world/species.ts`](../../../packages/server/src/world/species.ts)): `SPECIES` as code (human, elf, dwarf, halfling, orc as talkers; wolf, horse, bear, boar, spider as beasts) with ages, `maxTier`, `learnRate`, `talks`.
- **The realm** ([`realm/generate.ts`](../../../packages/server/src/game/realm/generate.ts)): human kingdoms, settlements, factions, packs (beasts with `near`, count, cap), dungeons, gangs; figures have `species`.
- **Kingdoms** have laws and opinions of each other; **treaties** and **wars** are between parties (`k:`, `s:`, `f:`, `p:`).
- **Townsfolk** have `species` on the row (all human today), shared `Townsperson` drawn by the crowd.
- **Creatures** ([`data/creatures/`](../../../packages/server/src/data/creatures/)) are fight templates.

## Decisions made in this plan

1. **Species are data.** `server/src/data/peoples/*.json` (move `SPECIES` there; `speciesOf` reads the files). Fields: `body` (size, strength, toughness, `adultAge`, `elderAge`, `maxAge`, `maxTier`, `learnRate`), `mind` (`beast` | `cunning` | `reasoning`, and `cleverShare` for beast/cunning kinds: the share of individuals who can talk), `living` (`settled` | `nomadic` | `solitary` | `hoard` | `hive`), `habitat` (terrains, climate band from N30's climate, under-mountain, marsh), `temperament` (aggression, greed, sociability, xenophobia), `stances` (a number per other species: −100..100, the old hatreds and friendships), `culture` (an N53 template id) and `magic` (an N51 school), `creature` (a fight template for when one is met), `sizeClass` (for maps: a giant is 2×2 tiles, a dragon 3×3).
   Starting list (the stage file's): goblins, hobgoblins, orcs, ogres, trolls, hill/frost/stone giants, dragons, kobolds, gnolls, lizardfolk, harpies, centaurs, minotaurs, plus elves, dwarves, halflings, humans.
2. **Settlements, bands, lairs and kingdoms are N13's types.** A goblin warren is a `Settlement` (kind by size, `species: "goblin"` on the settlement: one new field), with a head (a figure), buildings by species (a warren has no market but a `pit`; extend `BUILDINGS` with species-specific ones or map to existing: a dwarf hold's `smithy` and `mine` are high), people (N25 rows with `species`); a **nomadic** band is a settlement with `nomadic: { route: posList, season }` that moves along its route by season (N30); a **solitary** creature (a dragon, a troll at a bridge, an ogre in a cave) is a **figure** with a lair POI (N27) and a hoard (`wealth` + notable items: N43); a **kingdom** of a people is a `Kingdom` with `species`, its crown faction, laws (N16's `kingdomLaws`, N45/N48 policies) and armies (N55).
3. **Generation by habitat.** After human kingdoms, the generator places peoples where their habitat fits and humans are thin: dwarves under mountains (hills/stone, a hold with a mine), elves in deep forest, goblins in hills near human mines, orc kingdoms in the east or wherever the steppe/hills band is (by seed), centaurs on plains (nomadic), lizardfolk in marshes, frost giants in the high north (N30's climate band), dragons in peaks (1–3 per realm: the overview's default), trolls at river crossings in wild country, ogres in caves. Counts by realm size; config `PEOPLES=off` keeps a human-only realm for tests that need it.
4. **Intentions are N13's needs and the director's pushes**, with temperament weights: trade, raid, conquer, hoard, be left alone, revenge for an old war (a stance below −60 plus a past war). The director gets kinds for them (a goblin chief's plan to take the mine = a raid target with a goal; an orc warlord gathering tribes = a faction merge; a dragon's raids for tribute). All with reasons, logged.
5. **Relations between peoples** use the existing treaty and war machinery: stances seed kingdoms' and settlements' `opinion` toward settlements of other species; new treaty kind `tribute_to_beast` (a hamlet pays a dragon or a troll); alliances of convenience (goblins serving an ogre: `service`; orcs hiring giants: `service` with pay); a weak group seeks a stronger one's protection (`mutual_defense`, scored by fear and stance).
6. **Clever individuals.** For beast/cunning species, each individual born or generated rolls `clever` with `cleverShare` (goblins 5%, trolls 2%, wolves 0.5%, dragons: old ones nearly always). Clever ones can become **talkers** (N11 templates per species in `data/templates/`, with depth by N25a's facts: their view of humans and of their own kind), and rise by N13's rules.
7. **Living among humans** is a policy (section 14): `species:<id>` per kingdom = `welcome | limited | slaves_only | banned`, chosen by the ruler's traits, the kingdom's history with that people (wars, raids), the state faith (N50), and stances; changeable with news. `limited` means a quarter of the town (a zone in the map), a tax, no arms (a law: N48); `slaves_only` only where slavery is law. Non-human residents are rows with their species, jobs and class by the policy; chatter shows **prejudice** (N37's hostility roll gets the speakers' stances; a bigoted human sneers at a goblin; a tolerant one greets).
8. **In the land:** their settlements and lairs on the realm map and as N27 POIs; their tracks and signs (N28's signs table by species); travellers of other peoples on roads (N26's sources: dwarf merchants, orc mercenaries, centaur traders; journeys by their own kingdoms); their cultures and tongues (N53 templates per people).
9. **Dragons:** figures of species dragon, tier S–SSS, age centuries, a lair in peaks, a hoard (copper and notable items), a **raid** that burns a hamlet (N31's `burned` marks; N62's fire if built), **tribute** demands (a treaty: pay each tax day or be burned), bargains (a clever dragon talks: a talker), and **dragon-slayer** jobs (N42) with renown so large that a dead dragon is realm news for years (importance 10; N68's song). Rules keep dragons rare and slow: a raid at most every few seasons per dragon; long sleeps.
10. **For the player:** trade, ally, fight or live among them; a non-human companion (a clever goblin hireling, N8); **reputation by people** (N67 builds per-place and per-faction reputation; this phase adds per-species: deeds against a people lower it with all of them who hear).

## Parts

### Part A: species as data (build first)
- **A1.** `data/peoples/*.json` with the schema; move `SPECIES`; `speciesOf` reads files; `check-npcs`. Test: every file passes; existing tests unchanged (humans etc. identical).
- **A2.** Creature templates and talker templates per species (goblin, orc, troll, giant, dragon, centaur…); size classes in the client (multi-tile sprites).

### Part B: the realm generates peoples
- **B1.** Habitat-based placement of settlements, bands, lairs and kingdoms; species on settlements, kingdoms and rows; nomadic routes. Test (done-when part): the realm generates a goblin warren in the hills near the start town (fixed seed or the search helper), an orc kingdom in the east, a nomadic centaur herd moving with the seasons and a dragon in the northern peaks.
- **B2.** Nomadic movement by season (N30), with arrivals at places on the route (trade or raid).
- **B3.** Population and economy for non-human places through the same `economyDay` with species modifiers (goblins breed fast and farm little).

### Part C: relations, intentions, policies
- **C1.** Stances into opinions; new treaty kinds; alliances of convenience. Test (done-when part): the goblins raid the mine road and make a pact with an ogre (a `service` treaty).
- **C2.** Intentions in the director; wars between peoples with the existing war code. Test (done-when part): the orc kingdom wars with the dwarves and the dwarves seek help from a human crown (a `mutual_defense` request; accepted or refused by the crown's interest).
- **C3.** `species:<id>` policies; non-human residents in human places; prejudice in chatter. Test (done-when part): a clever goblin lives in the liege town's outer quarter because its kingdom tolerates goblins (`limited`), while the slave kingdom keeps orcs only as slaves (`slaves_only`).

### Part D: clever ones, dragons, the player
- **D1.** Clever rolls, talker templates, rising. Test (done-when part): a clever goblin talks with the player (a talker with species goblin and a goblin's view in its persona).
- **D2.** Dragons: lairs, hoards, raids, tribute, bargains, slayer jobs. Test (done-when part): the dragon burns a hamlet, demands tribute, and the hamlet's head pays (a `tribute_to_beast` treaty).
- **D3.** Reputation by species; non-human companions; trade with peoples.

### Part E: admin and docs
- Admin: peoples, their places and kingdoms, stances, policies per kingdom. README: the peoples of the realm.

## Balance bounds

- `no-extinction`: no species wiped out by default in a long run.
- `dragons-bounded`: dragon raids per year per dragon under a cap; no dragon flattens more than one place a year.
- `peoples-coexist`: some human–non-human treaties exist in most realms (not only war).

## Edge cases and traps

- **Performance:** more settlements means a slower realm day (N26 noted waystations doubled it). Measure `bench` before and after Part B; keep the realm day inside N19's budget (lazy non-human places, coarse grain for bands).
- **Talking species and the model:** a goblin talker's persona must state how they speak (the template), and the invented-name check must know goblin names (the culture's word list).
- **Rows with species:** N25's life step uses `speciesOf(row.species)` for ages; check every place that assumes human ages.
- **Packs vs peoples:** wolves stay packs (beasts); a clever wolf is a figure who leads a pack (N13's alpha), and may talk.

## Tests (`packages/server/tests/n54.test.ts`)

The done-when ones, on fixed seeds found by the section 12 helper:
- The realm generates a goblin warren in the hills near the start town, an orc kingdom in the east, a nomadic centaur herd that moves with the seasons and a dragon in the northern peaks.
- The goblins raid the mine road and make a pact with an ogre.
- The orc kingdom wars with the dwarves and the dwarves seek help from a human crown.
- A clever goblin talks with the player and lives in the liege town's outer quarter because its kingdom tolerates goblins, while the slave kingdom keeps orcs only as slaves.
- The dragon burns a hamlet, demands tribute, and the hamlet's head pays.

## Done when (mapped)

| Done-when clause | Proved by |
|---|---|
| goblin warren near Millbrook, orc kingdom in the east, nomadic centaur herd, dragon in the northern peaks | B1 test |
| the goblins raid the mine road and make a pact with an ogre | C1 test |
| the orc kingdom wars with the dwarves and the dwarves seek help from a human crown | C2 test |
| a clever goblin talks with the player and lives in Highdale's outer quarter …; the slave kingdom keeps orcs only as slaves | C3 + D1 tests |
| the dragon burns a hamlet, demands tribute, and the hamlet's head pays | D2 test |

## Questions for the user

1. Which peoples are in by default? The overview's default is the full list with dragons rare (1–3 per realm). Should any be off by default (minotaurs, harpies)?
2. Should humans still be the majority everywhere, or can a realm generate mostly non-human kingdoms?

**Save:** the next save version (species on settlements and kingdoms, nomadic routes, `species:` policies, new treaty kinds; a realm made before this has no non-humans until a new world: offer a new world, since adding peoples to a running realm would need moving people out of the way).

## Slice cut

Not in the slice.

## Out of scope

Armies of these peoples (N55 makes all armies real). New peoples founding kingdoms in play (N64).
