[← Plans](README.md) · [Stage 4: N53](../stage-4-society.md#n53-cultures-and-languages)

# N53 plan: Cultures and languages

**In one line:** each kingdom gets a **culture** generated at realm creation from culture **templates** (data files, like species and creature templates, not hand-written places): its name sounds (syllables for people, places and families), greetings and forms of address, foods and dishes, dress colours, festivals' names and customs (N30), taboos and customs that matter, attitudes to classes and strangers, and a **tongue**; names, chatter, personas, the inn's menu and festivals follow it; strangers from far tongues are harder to talk to and garble news; border places and trade towns **mix** cultures over time.

**Read first:** [plans README](README.md) sections 2, 12 (no authored places: templates are like species files), 14, 17, 19 (`culture-names`). Needs N30 (festivals per kingdom), N33 (gossip: rumours lose accuracy across tongues). Uses N28 (regional dishes from species), N36 (taboos broken anger a place), N37 (how classes treat each other), N50 (faiths tied to cultures), N54 (peoples' cultures), N64 (new kingdoms make a culture).

## What exists

- **Names** from one set of word lists for the whole realm ([`realm/names.ts`](../../../packages/server/src/game/realm/names.ts): `PLACE_START/END`, `KINGDOM_A`, `FEMALE`, `MALE`, `FAMILY`, `placeName`, `personName`, `factionName`); townsfolk names in [`realm/townsfolk.ts`](../../../packages/server/src/game/realm/townsfolk.ts) and N25's births (`surnameOf`).
- **Chatter** ([`shared/crowd.ts`](../../../packages/shared/src/crowd.ts) `chatLines`, `honorific`): one set of greetings and address forms by class.
- **Festivals:** midsummer only (N30 adds four per kingdom).
- **Inn food:** items like `bread loaf`, `ale`, `stew` ([`items.ts`](../../../packages/server/src/game/items.ts)); inn menus by stock.
- **Kingdoms** have a colour and laws; no culture.

## Decisions made in this plan

1. **Culture templates are data:** `server/src/data/cultures/*.json`, 6–8 archetypes (for example: highland, river-plains, coastal traders, northern forest, steppe riders, old imperial), each with: syllable sets for given names (by gender), family names and place names (prefixes, suffixes, patterns); greeting and farewell phrases by class gap; honorifics; dishes (built from items and N28 species: "smoked eel", "barley bannock"); drinks; dress colours (palette for the crowd's sprites); festival names and customs for the four seasons (a fire leap at midsummer, a mask night at midwinter); customs (`guest_right`: refusing hospitality is shameful; `bow_to_elders`; `bare_head_in_temple`) and taboos (`eating_horse`, `whistling_at_night`, `killing_ravens`); attitudes (`strangers`: warm/wary/hostile, `classes`: rigid/loose, `women_in_office`: yes/no as a soft weight, not a hard rule); a tongue (a seed for a word generator).
2. **Each kingdom's culture is generated:** pick a template by region (latitude and terrain of the capital), then **vary** it by seed (drop or swap a few customs, mix in one from a neighbour template, shift the syllables). A culture record goes in `realm.cultures[id]` and each kingdom (and later each people: N54) points at one. The model may name things in the culture's style once (`culture-names` kind: a list of words checked by the invented-name check); syllable tables are the fallback.
3. **Names follow culture.** `personName`, `placeName`, `familyName` take a culture; settlements founded in a kingdom take its place-name pattern; townsfolk and births take their place's culture (mixed by decision 7). Existing worlds: names don't change after generation (a v-bump migration gives existing kingdoms a culture but keeps all names).
4. **Chatter, personas, food and festivals follow culture.** `chatLines` gets the culture's greetings and honorifics (the roster carries a culture id; the browser has the culture's phrase tables from one `GET /api/cultures`); talkers' personas get a culture line ("In Corveth one bows to elders and never whistles after dark."); inn menus list the culture's dishes; festivals use the culture's names and customs (the crowd's festival behaviour picks the custom: fire leap → people gather at a fire spot).
5. **Tongues.** Each culture has a tongue; tongues have a **distance** between them (same family close: from template ancestry). People speak their culture's tongue and maybe one more (traders, border folk, the educated). The player starts knowing their start town's tongue and gets `tongues: Record<id, 0..1>` that grows by time spent among speakers and lessons (a teacher: N9 training). Effects:
   - **Talking:** with a stranger whose tongue the player knows poorly, persuasion checks get a penalty, talkers' replies are simpler (a persona instruction: "You speak little of the stranger's tongue; keep it short and simple"), and some words come through garbled (a client-side display, harmless).
   - **News across tongues:** N33's retelling loss gets a factor by tongue distance between teller and listener, so a rumour from the start town told in a far kingdom loses accuracy faster.
6. **Customs and taboos matter.** Each custom and taboo is a rule checked on actions (the player's and NPCs'): eating a taboo food at the inn, whistling at night, entering a temple armed, refusing a guest's bread. Breaking one in sight of locals: an `insult`-like interaction (N37) toward everyone who saw, a small reputation loss in that place (N67's per-place reputation; until then the town's reputation), the mood (N36) a little. Keeping a custom (bowing to elders, bringing a gift as a guest) earns respect. The player learns customs by being told (talkers' lore) or by mistakes.
7. **Mixing.** Border places and trade towns (many roads, caravans, migrants) **drift**: each place has `culture: { base: id, mix: Record<id, share> }`, moved each season by migrants (N25's moves carry their culture) and trade (caravans' origins), slowly. Names of babies, dishes at the inn and festival customs draw from the mix. A place whose mix crosses a threshold can adopt a custom (news).

## Data shapes

```ts
realm.cultures: Record<string, Culture>; kingdom.culture: string; settlement.culture?: { base: string; mix: Record<string, number> }
interface Culture { id: string; name: string; template: string; tongue: { id: string; family: string; seed: number }; names: NameTables; greetings: …; honorifics: …; dishes: string[]; drinks: string[]; colours: string[]; festivals: Record<Season, { name: string; custom: string }>; customs: string[]; taboos: string[]; attitudes: { strangers: "warm" | "wary" | "hostile"; classes: "rigid" | "loose" } }
player.tongues: Record<string, number>;
```

## Steps

### Step 1: templates and generated cultures
- Schema, 6–8 template files, `check-npcs`; `generateCulture(template, seed, neighbours)`; cultures in the realm; migration for existing saves.
- Test: three kingdoms on a fixed seed have different cultures; same seed → same cultures.

### Step 2: names
- Name generators by culture; new places, people and births use them.
- Test (done-when part): names differ between the three kingdoms (syllable statistics differ; no overlap of family-name sets beyond chance).

### Step 3: chatter, personas, food, festivals
- Roster culture id, phrase tables to the browser, `chatLines` and `honorific` by culture; persona lines; inn menus; festival names and customs.
- Test (done-when parts): greetings, the inn's food and the festival differ between the three kingdoms.

### Step 4: tongues
- Tongues and distances; `player.tongues` and learning; persuasion penalty and simpler replies; N33's loss factor by distance.
- Test (done-when part): a start-town rumour told in a far kingdom loses accuracy faster than one told next door.

### Step 5: customs and taboos
- Rule checks on actions; the player's and NPCs'; effects; learning customs.
- Test (done-when part): breaking a local taboo lowers how people there treat the player (relationship rows of witnesses, place reputation).

### Step 6: mixing
- Seasonal drift by migrants and trade; adoption news.
- Test: a trade town between two kingdoms shows a mix after a few years (babies' names from both).

### Step 7: admin and docs
- Admin: cultures, tongues, mixes per place. README: travelling abroad.

## Balance bounds

- `cultures-distinct`: kingdoms' cultures stay distinguishable (mixing doesn't flatten the realm in a few years).

## Edge cases and traps

- **No authored places or people:** templates are like species: kinds of culture, never named places. Kingdom-specific words are generated.
- **The browser draws dress colours** from the culture palette: shared code, sent once.
- **Old names stay:** never rename a person or place on migration.
- **Persona prompts grow:** keep the culture line to one sentence and the customs list to the two most relevant.

## Tests (`packages/server/tests/n53.test.ts`)

The done-when ones:
- Names, greetings, food at the inn and the festival differ between the three kingdoms.
- A start-town rumour told in a far kingdom loses accuracy faster.
- Breaking a local taboo lowers how people there treat the player.

## Done when (mapped)

| Done-when clause | Proved by |
|---|---|
| names, greetings, food at the inn and the festival differ between the three kingdoms | steps 2–3 tests |
| a Millbrook rumour told in a far kingdom loses accuracy faster | step 4 test |
| breaking a local taboo lowers how people there treat the player | step 5 test |

**Save:** the next save version (`realm.cultures`, `kingdom.culture`, `settlement.culture`, `player.tongues`).

## Slice cut

Not in the slice.

## Out of scope

Peoples' cultures in depth (N54 gives each people a template). Writing systems and books.
