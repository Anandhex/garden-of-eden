[← Plans](README.md) · [Stage 7: N65](../stage-7-the-player-in-the-world.md#n65-the-players-view)

# N65 plan: The player's view

**In one line:** one **journal** for the player built only from what they know (N24's `player.known`, N33's knowledge, N34's followed people, N43's items, N27's map): news heard (with who told them and how sure), stories they know, quests, their own deeds; **people** they know with last-seen places and how they seem to feel; a **world map** that fills in as they visit or hear of places, roads, borders and wars "as last heard"; **places** with what they know of each (head, mood, prices, dangers), each fact dated and sourced.

**Read first:** [plans README](README.md) section 3 (the rule this phase is made of), 11, 18. Needs N24 (`player.known`, `playerKnows`; step 0 if missing), N34 (followed people, `lastKnown`). Uses N20 (stories, if built), N27 (the player's map of POIs), N28 (bestiary and herbarium tabs), N33 (sources and variants), N36 (moods), N43 (items' known history), N63 (finds and new places), N64 (kingdoms and borders as last heard).

## What exists

- **The journal** ([`journal.ts`](../../../packages/server/src/game/journal.ts)): `JOURNAL_KINDS`, `note`, `journalFor`, `journalByNpc`: notes the game writes, grouped by NPC.
- **The client:** a sheet ([`ui/sheet.ts`](../../../packages/client/src/ui/sheet.ts)), modals, the realm tab ([`ui/realm.ts`](../../../packages/client/src/ui/realm.ts), [`realmMap.ts`](../../../packages/client/src/realmMap.ts)) that today draws the realm map from server data (check what it shows: the whole realm or what's known).
- **The admin view** (N17) shows the truth; the player's view must never call admin code.

## Decisions made in this plan

1. **One read model:** `server/src/view/` (new area, beside `admin/`) builds every player-facing page from **knowledge only**: `playerJournal(world)`, `playerPeople(world)`, `playerMap(world)`, `playerPlaces(world)`. A lint test fails if any file in `view/` imports from `admin/` or reads `realm.*`/`rowOf` directly instead of through `playerKnows`/the known records (allowed list of imports).
2. **Every fact carries its provenance:** `{ text, day, source: "saw" | "told:<who>" | "letter:<who>" | "overheard:<place>" | "read" | "map", sure: "certain" | "fairly sure" | "rumour" | "doubtful" }` (from accuracy). The UI shows it small under each line.
3. **The journal** has tabs: **News** (heard, newest first, grouped by place and by person followed; filter by sureness), **Stories** (N20 stories the player knows enough parts of: a chain where the player knows ≥ 2 links, told in the player's known version), **Quests** (active, done, failed; from N42's jobs the player held), **Deeds** (the player's own: events with actor player, as the world remembers them: how many know), **Bestiary/Herbarium** (N28), **Items** (N43 notable items they've held or heard of).
4. **People:** everyone the player has met or heard of (knowledge refs about persons): name, what they are (as known), last seen/heard (N34's `lastKnown` for all, not only followed: a cheap per-person record updated when knowledge about them is learned), how they seem to feel about the player (bucketed from the relationship as **perceived**: the last few interactions' tone, not the true numbers), family and allegiances as known, and news about them. Followed people pinned on top.
5. **The map fills in.** `player.map` (N27) extended: places **visited** (full detail as of the last visit), places **heard of** (a dot and a name at the told position, roads as told), roads walked (N26's `walked`), regions seen (fog), borders and wars **as last heard** (a kingdom's extent as of the news the player has: a dated layer; a war shown with "as of day N"). The browser's realm map draws only this (replacing whatever it draws from the truth today).
6. **Places:** for each known place: head, kingdom, size, mood (as last seen or heard), prices (the player's last seen prices at its market, dated), dangers (packs, gangs, outbreaks heard of), its people the player knows, its news.

## Steps

### Step 1: the read model and the lint
- `view/` with the four builders; the import lint test; provenance on every fact.
- Test: nothing in `view/` imports `admin/`; a far event the player hasn't heard is absent.

### Step 2: the journal
- Tabs; sources and sureness; stories (if N20 is built; else the tab is hidden).
- Test (done-when part): after a week of play (scripted), the journal lists the rumours the player heard with their sources.

### Step 3: people
- Per-person `lastKnown` for all known people; perceived feelings; pages.
- Test (done-when part): a person's page shows a stale location until the player learns where they went.

### Step 4: the map
- `player.map` extended; the realm map in the browser draws only known places, roads, borders and wars as last heard.
- Test (done-when part): the map shows a far city only once someone has told them of it.

### Step 5: places
- Place pages with dated facts.
- Test: prices shown are the last seen, dated, even after they changed.

### Step 6: the client; docs
- `ui/journal.ts` with the tabs; people and place pages; the map. Play: a week; check every page shows only known things. README.

## Balance bounds

None (a view).

## Edge cases and traps

- **Existing UI that reads the truth:** the realm tab and realm map today; the sheet may show realm facts. Audit `ui/*.ts` and the endpoints they call; route them through `view/`.
- **Size:** `player.known` grows forever; cap per kind (keep the newest few hundred news, all people, all places) and summarise old news by place.
- **Perceived feelings** must not leak the true numbers (no exact values in the payload).

## Tests (`packages/server/tests/n65.test.ts`)

The done-when ones:
- After a week of play the journal lists the rumours the player heard with their sources.
- The map shows a far city only once someone has told them of it.
- A person's page shows a stale location until the player learns where they went.

## Done when (mapped)

| Done-when clause | Proved by |
|---|---|
| the journal lists the rumours the player heard with their sources | step 2 test |
| the map shows a far city only once someone has told them of it | step 4 test |
| a person's page shows a stale location until the player learns where they went | step 3 test |

**Save:** the next save version (`player.map` extended, per-person `lastKnown` for known people).

## Slice cut

Not in the slice.

## Out of scope

Editing notes by the player (could follow: free-text notes per person and place). The chronicle (N68 adds the realm's chronicle as the player knows it).
