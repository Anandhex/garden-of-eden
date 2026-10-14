[← Plans](README.md) · [Stage 7: N68](../stage-7-the-player-in-the-world.md#n68-legends-songs-and-the-realms-history)

# N68 plan: Legends, songs and the realm's history

**In one line:** code picks the biggest events and N20's best stories and makes them **legends**: a record of the facts (who, what, where, when, the named items and the dead); **bards** turn legends into **songs** and **tales** (the model writes the words from the facts, through the invented-name check; templates otherwise) and sing them in inns, where they spread like rumours and **drift** with each retelling; the biggest stories name **eras**; a **chronicle** of the realm can be read (what's known in the game, the truth in the admin); places and **monuments** take names from events; NPCs refer to legends years later.

**Read first:** [plans README](README.md) sections 2, 3, 4, 19 (`song`, `tale`, `era-name`). Needs N20 (causes and stories; step 0 per section 11), N33 (songs spread as knowledge with variants). Uses N41 (bards in inns), N43 (named items in songs), N52 (paid songs: the player's version), N55 (songs of the fallen, war memorials), N62 (disasters), N63/N64 (names on the map), N65 (the chronicle in the journal).

## What exists

- **The nightly chronicle** ([`director/chronicle.ts`](../../../packages/server/src/director/chronicle.ts)): `runChronicle` writes news from the day's events for talkers to talk about (`CHRONICLE_IMPORTANCE`, `NEWS_DAYS`, `expireNews`): short-lived.
- **Realm news** with importance; deaths with records; wars with battles; figures with deeds and renown.
- **Lore** ([`realm/lore.ts`](../../../packages/server/src/game/realm/lore.ts), [`npc/knowledge.ts`](../../../packages/server/src/npc/knowledge.ts)): place lore, realm lore, invented-name checks (`inventedWords`, `knownNameWords`, `unknownNames`).
- After N20: stories (chains of events with scores); after N33: knowledge with variants.

## Decisions made in this plan

1. **A legend is facts.** `legends(id, kind, title, facts JSON, refs JSON, people JSON, places JSON, items JSON, day, weight, era?)`. Made by `legendsDay` from: N20 stories above a score, realm news of importance ≥ 9 (a dragon slain, a capital taken, a revolt that made a kingdom, a great plague, a tournament champion of renown), and deaths of figures of great renown (a hero's last fight). Facts are structured (`{ actor, deed, target, place, day, outcome, dead[], items[] }`) so retellings can drift in code.
2. **Songs and tales from the facts.** A bard (a talker or row with the bard/performer job: N41) composes a **song** about a legend within a season of it (a chance by the bard's skill and the legend's weight and nearness); the song is a record `songs(id, legend, by, made_day, text, variant, reach)` with the words from the model (`song`, low priority: a few verses from the facts; invented-name check on every name) or a **template** ballad from the facts. A **tale** is the same in prose (told by storytellers and old folk).
3. **Songs spread like rumours.** A song is a knowledge ref `g:<songId>` (N33) learned by everyone in a venue where it's sung (the inn on evenings: N41's bard performance), and carried by travelling bards and listeners; retelling **drifts** the facts (N33's variant mechanism on the structured facts: the number of dead grows, the villain's name changes to a better-known one, the place moves to a more famous one), and a bard who learns a drifted version may compose a **new** song from it (variant songs). The truth stays in the legend; the admin shows both.
4. **Eras.** When a legend (or a cluster of legends with shared causes: a war and its battles; a famine and its migrations) passes a high weight, it names an **era**: `eras(id, name, start, end?, legends[])`, e.g. "the Ashford Revolt", "the Long Winter": names from templates (`the <place> <kind>`, `the <adjective> <season>`) or the model (`era-name`). The chronicle groups history by era.
5. **The chronicle:** `chronicleOf(view: "truth" | "player")`: years and eras, with each legend's facts (truth) or the player's known version (player: from their knowledge of songs and news, with sources). In the game it's a book the player reads (a journal tab: N65); in the admin, the truth with links to events.
6. **Monuments and names:** a legend of enough weight at a place may **name** a feature (the Weeping Bridge: a bridge where many died; Greyfang's Hollow: the lair where a famous beast was killed) — the feature's name in road data/POIs (a name override table, so derived data stays derived) and on the player's map once heard; and raise a **monument** (a memorial mark: N31; a statue in a capital for a hero, funded by the crown).
7. **People refer to legends.** Talkers get the top legends they know (by knowledge) in their persona lore ("Everyone knows the song of the Ashford Revolt"); townsfolk chat lines sometimes quote a known song; years later, an NPC asked about the past names the era. The legend's weight decays slowly, so old legends fade unless sung.

## Steps

### Step 1: legends from stories and news
- `legends` table; `legendsDay`; structured facts.
- Test: a revolt that succeeded becomes a legend with its facts.

### Step 2: bards and songs
- Composition by bards (N41's performers; until N41, innkeepers' tales); `song`/`tale` call kinds with templates; the invented-name check.
- Test (done-when part): the revolt becomes a song sung in the liege town's inn within a season.

### Step 3: spreading and drift
- Songs as knowledge refs; venues; drift on structured facts; variant songs.
- Test (done-when part): its details drift with retelling (different variants known in different places; the truth unchanged).

### Step 4: eras and the chronicle
- Era detection and naming; `chronicleOf` for truth and player; the journal tab; the admin view.
- Test (done-when part): the era is named in the chronicle.

### Step 5: names and monuments
- Name overrides for features and POIs; monuments as marks.
- Test: a battle with many dead at a bridge names the bridge.

### Step 6: NPCs refer to legends
- Persona lore; chat lines; decay.
- Test (done-when part): an NPC years later refers to it (a talker made years after the revolt has the era in their lore and names it when asked about the past: the fake model's prompt contains it; the fallback mentions it).

### Step 7: docs
- README: the realm remembers.

## Balance bounds

- `legends-rare`: a few legends per year in the realm; eras every few years.
- `songs-drift-not-explode`: drifted facts stay recognisable (the main actor or the place survives most retellings).

## Edge cases and traps

- **Model words and invented names:** a song must not invent people or places; every capitalised word is checked; templates are the fallback.
- **Derived road data:** names from legends are overrides stored separately; `roadDataOf` stays a pure function plus an override map.
- **The player's legends:** the player's deeds become legends like anyone's; songs paid for by the player (N52) are songs with a bias, marked in the truth view.

## Tests (`packages/server/tests/n68.test.ts`)

The done-when ones:
- A revolt becomes a song sung in the liege town's inn within a season.
- Its details drift with retelling.
- The era is named in the chronicle.
- An NPC years later refers to it.

## Done when (mapped)

| Done-when clause | Proved by |
|---|---|
| a revolt becomes a song sung in a Highdale inn within a season | step 2 test |
| its details drift with retelling | step 3 test |
| the era is named in the chronicle | step 4 test |
| an NPC years later refers to it | step 6 test |

**Save:** the next schema version (`legends`, `songs`, `eras`, name overrides).

## Slice cut

Not in the slice.

## Out of scope

Written books and libraries. Music playback of songs (N29 plays a bard's tune; the words are text).
