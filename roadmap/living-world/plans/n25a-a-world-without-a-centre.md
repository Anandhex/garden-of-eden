[← Plans](README.md) · [Stage 2: N25a](../stage-2-everyone-lives.md#n25a-a-world-without-a-centre)

# N25a plan: A world without a centre

> **Built 2026-10-13.** Read the plan as the design; what differs in the build is listed under *Built* in [the stage file](../stage-2-everyone-lives.md#n25a-a-world-without-a-centre).

**In one line:** no code or data knows Millbrook exists; there are no hand-written NPCs; every settlement and every talking person is generated from the seed and runs the same systems; the only special place is where the player is (for detail, never for rules); old saves are thrown away.

**User decisions (2026-10-13):**
- "I want the game to be not centric around Millbrook."
- **No scenarios** and **no hand-written or authored NPCs.** Millbrook, Brena, Hale, Pell, Pip, Rook, Wren, Mayor Aldric Voss, Captain Reyna Holt, Rook's gang, the Old Mine Deeps, the Gilded Goose and Millbrook's lore are removed from the game. Every person who talks is generated from templates and the realm.
- **Old saves are thrown away** (save v13 as a clean break, no migration; a second one-time decision).
- **Choosing a starting town comes later.** In this phase the start town is picked by the seed; choosing it moves to [N39 The first hour](../stage-3-npcs-choose.md#n39-the-first-hour).

**Why before N26:** the open road joins places as equals. Built on today's code, N26–N28 would add a third layer of "Millbrook vs everywhere else".

**Read first:** [plans README](README.md) sections 2 (determinism), 4 (fallbacks), 6 (person refs), 7 (where code goes); the [N18](n18-scale-and-storage.md) and [N25](n25-townsfolk-lives.md) plans; [N24](n24-global-reporting.md) step 2b (each place's own news clock), which this phase absorbs if N24 isn't built.

---

## 1. How the game is centred on Millbrook today

The code has **two tiers of place**. Millbrook has the full simulation: six hand-written NPCs on an hourly day, creatures on its maps, spawn rules, town events, an underworld, quest boards fed by the realm's needs, news delivery, a chronicle. **Every other place** has a thinner copy built beside it: `visitors` (generated from templates) instead of the cast, `haunts` instead of `world.creatures`, no spawn rules, no town events, no underworld, Millbrook's news clock.

Counted on 2026-10-13: `HOME_ID` has **89 uses in 21 files**; "Millbrook" appears in **80 files**; the hand-written NPCs are named in **34 source files** and **48 of 48 server test files**.

### A. The id and the "am I home?" branch
| Where | What it does | Becomes |
|---|---|---|
| [`realm/generate.ts`](../../../packages/server/src/game/realm/generate.ts): `HOME_ID = "millbrook"`; Millbrook placed by hand (fixed population 180, buildings, treasury, `mb.home = true`); "Aldric Voss" and "Reyna Holt" made by name; factions `guard`, `merchants`, `bandits` ("Rook's gang") seated there; `addDungeon(…, "the Old Mine Deeps")`; `if (s.home) continue` skips Millbrook's notables because "the talking NPCs" are them | Deleted. The generator treats every settlement the same; the start town is picked from what it generated (decision 5) |
| [`realm/politics.ts`](../../../packages/server/src/game/realm/politics.ts) `s.home && f.name === "Aldric Voss" ? "mayor"` | `leaderRole(s.kind)` for everyone |
| [`realm/types.ts`](../../../packages/server/src/game/realm/types.ts): `Settlement.home`, ROLES comment "Millbrook's own folk", `RealmNews.reaches`/`delivered` ("reaches Millbrook"), `HomeEventSchema`, `Realm.home` | `Settlement.home` goes; news per place (N24 2b); `Realm.home` becomes per-site **arrivals** (decision 8) |
| [`realm/travel.ts`](../../../packages/server/src/game/realm/travel.ts) `siteOf = player.site ?? HOME_ID`; `player.site` "Millbrook when unset" | `player.site` required |
| [`town.ts`](../../../packages/server/src/game/town.ts) `atHome()`: creatures (`world.creatures` vs `haunts`), `localIds()` (the cast vs visitors), `placeOf` ("isn't here" away from home), "You're back in Millbrook.", `world.atWar` from Millbrook's kingdom, `meetHomeNotables`, risers "of Millbrook" | One path for every site: **the active site** (decision 3) |
| [`cli.ts`](../../../packages/server/src/cli.ts) (start NPC `?? "brena"`, "Corporal Hale keeps the gate", "You leave Millbrook"), [`web/server.ts`](../../../packages/server/src/web/server.ts) (`site.home: true` fallback, "Corporal Hale keeps the gate", "isn't in Millbrook", "Millbrook is open at …") | Generic paths; strings name the site, its actual guard, or the game |
| [`admin/`](../../../packages/server/src/admin/): `?? HOME_ID` fallbacks, Millbrook sorted first, the search hint "try … brena" | The player's site or `null`; the player's site first |

### B. World-level state that is really Millbrook's
| Field | What it holds | Becomes (`world.sites[site]`) |
|---|---|---|
| `creatures`, `spawns`, `extraSpawnRules` | Millbrook's creatures, spawn ledger, rules made in play | `site.creatures`, `site.spawns`, `site.rules` |
| `haunts` | everyone else's creatures | merged into `site.creatures` |
| `lastRaidDay` | Millbrook's raid day | `site.lastRaidDay` |
| `recentEvents` | lore ids "going on in town" (starts as `news.cart_attack`) | `site.recentEvents` |
| `atWar` | Millbrook's kingdom at war (prices) | computed per site |
| `newsDays`, delivered flags | Millbrook's news clock | per site (N24 2b) |
| `chronicleDay`, `directorLog` | Millbrook's chronicle | per active site |
| `risen`, `visitors`, `family.born`, the persona files | four stores of talking people | one registry (decision 4) |
| `saves/deaths.json` (`DeathRegistry`) | permanent deaths of the cast, by persona id | death records on people rows (N25 already types them); the file goes |

### C. Systems that only run for Millbrook
| System | Where | Becomes |
|---|---|---|
| The cast's hourly day (schedules, needs, gossip, restocking, crafting, quest boards) | `Town.passHours` → `passVillage(this.members())`, `restock` | the talking people of the **active site** |
| Creatures breeding, raids by night, the underworld (black market, raid planning; "someone in Millbrook is selling weapons to the bandits") | `breedCreatures`, `passCreatureTime(…, DEMO_SPAWNS)`, `passVillageNights` ([`underworld.ts`](../../../packages/server/src/game/underworld.ts)) | active site; the underworld wherever a gang and a smith exist |
| Spawn rules and dens | [`data/spawns.json`](../../../packages/server/src/data/spawns.json) (Millbrook's dens), `DEN_KEYS`, `DEMO_SPAWNS` ([`world/world.ts`](../../../packages/server/src/world/world.ts)) | **generated** rules from what the realm says is at each site, by den **kind** (decision 9) |
| Town events (market every 7th day, festival, raid days, mine road closed) | [`events-calendar.ts`](../../../packages/server/src/game/events-calendar.ts) `townEventsOn(world)` | `townEventsOn(site, day)`, market day offset seeded per site |
| What the realm sends to the map, and the realm's needs as quests | [`realm/home.ts`](../../../packages/server/src/game/realm/home.ts) (`syncCast`, `applyHomeEvents`, `postNeedQuests`, Rook leads the gang), [`realm/director.ts`](../../../packages/server/src/game/realm/director.ts) `homeNeeds` | `syncTalkers(site)`, `applyArrivals(site)`, `needsOf(realm, site, day)` for any site |
| Rising from the crowd | [`realm/rise.ts`](../../../packages/server/src/game/realm/rise.ts) (`f.home === HOME_ID`, "a farmer of Millbrook has made a name") | the active site's crowd |
| News and place lore | [`realm/news.ts`](../../../packages/server/src/game/realm/news.ts) (`local = n.at === HOME_ID`, `realmPlaceLore`), [`realm/log.ts`](../../../packages/server/src/game/realm/log.ts) `reaches` | N24 2b; `placeLoreFor(site)` |
| Maps | [`web/sites.ts`](../../../packages/server/src/web/sites.ts): `areasOf` (Millbrook gets every area), `areaWords`, `village()`/camp layouts (`home` → "Rook's tent", "Stolen carts"), `MILLBROOK_INFO`/`MILLBROOK`; [`web/map.ts`](../../../packages/server/src/web/map.ts) `NPC_LOOKS` (colours and "nearby" words per cast member), `PLAYER_START` "by the west gate of Millbrook's village" | generated for every site; sprite colours from a seeded palette per person |
| Townsfolk generation | [`realm/townsfolk.ts`](../../../packages/server/src/game/realm/townsfolk.ts): no innkeeper/smith at Millbrook ("the cast keeps the inn"), `kingdomLaws` relative to Millbrook's kingdom, `millbrook.*` knowledge | no exceptions; laws stored per kingdom |
| The people of other places | [`realm/visitors.ts`](../../../packages/server/src/game/realm/visitors.ts) (`site !== HOME_ID`, `homeKnows`), [`deathNews.ts`](../../../packages/server/src/game/deathNews.ts) | the one registry |
| Which places live (N25) | [`people/live.ts`](../../../packages/server/src/game/people/live.ts) `PEOPLE_LIVE=slice` = Millbrook + nearest | the start town + nearest |
| Place words | [`schedule.ts`](../../../packages/server/src/game/schedule.ts) `PLACE_NAMES` ("Millbrook forge") | from the site's map |

### D. Hand-written content (all removed from the game)
- **NPC files:** [`data/npcs/`](../../../packages/server/src/data/npcs/) `brena`, `hale`, `pell`, `pip`, `rook`, `wren`. Loaded by `server.ts`, `cli.ts`, `bench-style.ts`, `bench-traits.ts`; `cli.ts` starts with Brena.
- **Lore:** [`data/world.json`](../../../packages/server/src/data/world.json): Millbrook, its forge, the Goose, the gate, the mine road, the cart attack, facts about the cast.
- **Faction files:** [`data/factions/`](../../../packages/server/src/data/factions/) `bandits` ("Rook's gang", members `["rook"]`), `guard`, `merchants`: named, with members.
- **Code that names cast members:** `NPC_LOOKS` (map.ts), `syncCast`'s "Rook leads the gang" (home.ts), "Corporal Hale" (cli, server, client sheet), the family code's "born in Millbrook", and cast ids in `actions.ts`, `quests.ts`, `social.ts`, `knowledge.ts`, `rumours.ts`, `crafting.ts`, `family.ts`, `village.ts`, `training.ts`, `scene.ts`, `gossip.ts`, `factions.ts`, `dilemmas.ts`, `journal.ts`, director modules (mostly comments and examples; some logic: check each).
- **Story content tied to them:** the bandit leader (N3.2), Pip the errand girl (N11), the cart attack opening news, Brena's black-market weapons.
- **Templates** ([`data/templates/`](../../../packages/server/src/data/templates/) farmer, merchant, guard, child, bandit) **stay**: they're generators, not people. Their text mentions Millbrook ("a farmer from the fields east of Millbrook"); that becomes `{place}`.
- **Prompts:** [`npc/templates.ts`](../../../packages/server/src/npc/templates.ts) "a small fantasy village called Millbrook"; [`family.ts`](../../../packages/server/src/game/family.ts) "a young villager of Millbrook".
- **Client:** "Home: Millbrook", "(not heard in Millbrook yet)", "Corporal Hale", the `home` ring on the realm map.
- **Names only (leave):** `@millbrook/shared`, the `millbrook.timeFlows` storage key, temp file names. Those are the project's name. Renaming is out of scope.

### E. What the hand-written NPCs gave that generated ones don't (yet)
Generated personas (`assemblePersona` in [`npc/templates.ts`](../../../packages/server/src/npc/templates.ts)) leave many fields the hand-written files fill: `secrets: []`, and no `fears`, `loves`, `dilemmas`, `arcs`, `relationships`, `reputationFacts`, `signature`, `services`, `hire`, `successor`/`successorOf`, `debts`, `quirks` (check), `injuries`. **Mechanics from N4–N9 read those fields**: cover stories and secrets (N4), fears and loves (N5), dilemmas and successors (N7), signature moves and services (N6), hired companions (N8), arcs (N9). With only generated people, those mechanics would go quiet. **Step 5 of this phase generates them in code**, so removing the hand-written NPCs doesn't remove features.

---

## 2. The target

1. **One kind of place.** Every settlement is a site with the same systems. The engine never compares a site id to a constant.
2. **Everyone is generated.** Every talking person comes from a template plus the realm (their figure or people row: name, age, class, job, family, faction, deeds) plus generated depth (step 5): **the model writes their story and depth from their real history** (backstory, fears, loves, which real secrets they keep, dilemmas, arcs, quirks), code checks it and fills anything missing, and code alone does it when the model is off or over budget. How people change afterwards is [N25b](n25b-lives-that-change.md).
3. **The player's location is the only privileged thing, and only for detail.** The player's site runs hour by hour; every other site runs the coarse day and catches up on arrival with the same results (N25's rule).
4. **The start town is picked by the seed** (decision 5); the player choosing it is N39's job.

---

## 3. Decisions made in this plan

1. **Delete `HOME_ID` and every hand-written person and place.** Each `HOME_ID` use becomes the player's site, a `site` parameter, or `world.startSite` (only for new-game setup and the `slice` config). A **centre lint test** (step 0) keeps it from coming back.
2. **Save v13, a clean break.** `MIN_SAVE_VERSION = 13`: an older save is renamed aside and a new world starts (the code for this exists from N18). `saves/deaths.json` is set aside the same way; deaths live on people rows from now on. Delete the v11→v12 migration code if nothing else uses it.
3. **The active site.** `Town.activeSites()` = the player's site (later N34 may add followed sites). Everything hourly runs for the active sites' talking people, creatures and maps. `atHome()` is deleted. On arrival, `activate(site)` catches the site up: people step (N25 `ensureCurrent`), talking people (coarse catch-up of needs, plans, wages, stock), creatures (the generalised `stockHaunts` logic), arrivals queued while away, news (N24 2b). On leaving, `deactivate(site)` freezes it (`site.lastActive`).
4. **One registry of talking people.** `world.talkers: Record<personaId, { site, persona }>`, replacing `visitors`, `risen`, `family.born` and the persona files. Every persona has a required `site` (home). `localIds()` = talkers whose site is the player's site and who are there now, plus companions. **Who becomes a talker:** a site's notables on first activation (today's `notablesOf` + `visitorPersona`, `MAX_VISITORS = 8`, for every site, the start town included); anyone the player speaks to (`meetTownsperson`); risers (N25); children of talkers. Off-screen talkers don't run hourly; they catch up on activation.
5. **The start town is picked by the seed.** `pickStartSite(realm, seed)`: among villages and towns with an inn, a smithy and at least two roads (so the first hour has a trader, a smith, and somewhere to go), prefer ones with a pack or dungeon near (something to do); pick with `streamFor(seed, "start")`; ties by id. Stored as `world.startSite`; `player.site` starts there, at the gate of its map in the morning. Replace `PLAYER_START`'s Millbrook comment; keep "row 9 gate road" if the generator still guarantees it. `REALM_SEED` makes it reproducible.
6. **A generated opening.** `createDemoWorld` (Millbrook forge, the cart attack) goes. The opening is built from the start town: time 08:00 on day 1, the player at its gate, a starter kit (from today's `createDemoWorld` player block, minus anything Millbrook-specific), `site.recentEvents` = the most important realm news that has reached the town, and one starting quest from `needsOf(realm, startSite)` posted by the town's head (template words). Tests that need a bare world get `createTestWorld()` with no place names.
7. **One lore naming scheme, all generated.** `place.<siteId>` for a place, `place.<siteId>.<thing>` for things in it (its inn, forge, temple, gate, named after the building on its map and who keeps it: "the Red Hart, kept by Odo Barrow"), `news.<id>` for news, `realm.<…>` for kingdoms, factions and dungeons (`dungeon.<id>`). Every talker knows `place.<their site>.*` for certain, neighbours' `place.<id>` for certain, `realm.*` by rumour; news only by delivery (N24 2b). One function, `knowsFor(site, role)`. `data/world.json` is deleted; whatever in it is truly generic (none expected) moves into code-generated lore.
8. **The realm talks to sites.** `homeNeeds` → `needsOf(realm, site, day)`; `postNeedQuests(realm, site, talkers)`; raids, beasts, refugees, caravans and levies queue on the target site's `arrivals` (any site) and apply when it's active (on the map: raiders at night) or as aftermath on catch-up. `kingdomLaws` reads `kingdom.laws`, set at generation (first kingdom serfs, second slaves, third neither, as now, but stored).
9. **Generated spawn rules, by den kind.** Every map places dens by kind (`square`, `gate_road`, `paddock`, `woods_edge`, `deep_woods`, `camp`, `road_ambush`, `mine_mouth`) for the areas it has. Rules come from the realm: a pack near → its species in `deep_woods` (and `woods_edge` when it's hungry); a gang seated → its members at `camp` and `road_ambush`; a paddock → horses; a dungeon → what spills at `mine_mouth` past its danger. That's the haunts logic and the spawn rules merged into one generator; `data/spawns.json`, `DEN_KEYS` names and `DEMO_SPAWNS` go. Rules made in play (the director's, N12) still go in `site.rules`.
10. **Faction files become faction kinds.** `data/factions/{bandits,guard,merchants}.json` → `data/factions/kinds/{gang,guard,merchants}.json`: ranks, discounts, joinability and default attitudes by kind, with no names and no members. Every realm faction of that kind uses them ([`game/factions.ts`](../../../packages/server/src/game/factions.ts) `factionOf` by kind, not by file id).
11. **The hand-written NPC files become test fixtures, not game data** (confirmed by the user, 2026-10-13). 48 test files use Brena, Hale, Pell and Rook to test NPC mechanics (the agent loop, tools, lies, secrets, trade, crafting, fights). Rewriting all of them on generated personas is weeks of work for no player benefit. Move `data/npcs/*.json` to `packages/server/tests/fixtures/npcs/`; the game, the CLI and the scripts never load them; the centre lint fails if anything under `src/` or `scripts/` reads `tests/fixtures`. Tests about *the world* (sites, realm, people, travel, admin) move to generated worlds; tests about *one NPC's mechanics* keep using fixtures.

## Questions for the user

All answered on 2026-10-13: no scenarios, no authored NPCs, throw away saves, starting town later, and **keep the six old NPC files as test fixtures** (decision 11).

---

## 4. Steps

Each step is a commit that leaves `npm run typecheck`, `npm test` and `npm run check-npcs` green. Steps 1–4 are refactors that shouldn't change how a world plays: compare a seed-1 golden run (N18's `worldHash` with a fixed input script) after each, through a projection that maps moved fields to their new places. From step 5 on, worlds change on purpose (Millbrook and the cast are gone), so take a new golden run and say so.

### Step 0: the centre lint
- `tests/centre.test.ts`: scan `packages/{server,shared,client}/src/**/*.ts`, `packages/server/scripts/**/*.ts` and `packages/server/src/data/**/*.json` for: `HOME_ID`, `millbrook`/`Millbrook` (word), the cast's names (`Brena`, `Hale`, `Pell`, `Pip`, `Rook`, `Wren`, `Aldric Voss`, `Reyna Holt`, `Gilded Goose`, `Old Mine Deeps`), `atHome(`, `world.creatures`, `world.haunts`, `realm.home`, `s.home`, `tests/fixtures`. Allowed: the `@millbrook/` package scope and `millbrook.` storage keys.
- Each pattern starts with today's count as a **ceiling**; each step lowers what it earned; the phase ends at 0. Progress is visible and no new centre code lands meanwhile.

### Step 1: the player always has a site; `startSite`
- `PlayerState.site` required; `world.startSite`. For now `startSite = "millbrook"` (it still exists until step 6). Replace every `player.site ?? HOME_ID`/`siteOf` fallback (travel, wilds, admin, server, CLI).
- `PEOPLE_LIVE=slice` = `world.startSite` + its nearest.
- Admin: the player's site first; fallbacks `null`; drop "brena" from the search hint.

### Step 2: per-site state
- `SiteState` in `world.sites` (decision 3's fields: `creatures`, `spawns`, `rules`, `lastRaidDay`, `recentEvents`, `arrivals`, `chronicleDay`, `lastActive`, `needCooldowns`); `siteState(world, site)` creates lazily with deterministic defaults; a non-creating `peekSite()` for the admin view (N17's read-only rule). New saved fields must also be in `newWorld` (N18's rule) or the hash changes on reload.
- Move `creatures`/`spawns`/`extraSpawnRules`/`lastRaidDay`/`recentEvents` behind site accessors, then move the storage. `haunts` merges into `sites[site].creatures`; `stockHaunts`/`settleHaunts` read and write site state.
- `world.atWar` → `atWar(realm, site)` where prices need it.
- Save v13 lands here (decision 2): bump `SAVE_VERSION` and `MIN_SAVE_VERSION`; set aside `deaths.json` with the old save.

### Step 3: the active site runs everything
- `activeSites()`, `activate`, `deactivate`. `creaturesHere()` = the player's site state for every site. `passHours` runs creatures, breeding, risers, spawn rules, the underworld, restocking and gossip for the active site, with its rules and talkers.
- Delete `atHome()` and fix each caller. Arrival line: "You're back in {site}." if `lastActive` is set, else the site's arrival description.
- `townEventsOn(site, day)`: market day = `(day + offset(site)) % MARKET_EVERY === 0` with a seeded offset; festival per kingdom (first day of summer for now); raid days from `site.lastRaidDay`; "mine road closed" per site.
- **The generality suite:** a parametrised test runs the same checks at three sites (a village, a town, a far capital): creatures spawn and fight; a raid arrival happens at night; the market day happens; talkers keep schedules and gossip; the underworld runs where a gang and a smith exist.

### Step 4: one registry of talking people
- Required `persona.site`; `talkersAt(world, site)`; route `localIds`, `placeOf`, `presentAt`, gossip groups, news listeners, quest boards, `meetTownsperson` and notables through it. `meetHomeNotables` and the visitor code become one `meetNotables(site)`, run on activation for every site.
- Merge `visitors`, `risen` and `family.born` storage into `world.talkers`. Persona ids: one scheme for everyone, by origin: `f_<figure>` for notables, `t_<site>_<n>` for townsfolk (keep N16's), children born in play from their people row id.
- Off-screen talkers catch up coarsely on activation (decision 4). A realm death of a talker's figure or people row kills the persona (today true for visitors; now for all). `DeathRegistry` reads and writes people-row death records instead of `deaths.json`.
- `syncCast` → `syncTalkers(site)` (realm figures for talkers of any site; gang leaders come from the realm, never "Rook").
- Tests: a talker of a town keeps their day while the player is there and resumes it after a week away; the same code serves every site.

### Step 5: generated depth for every talker (the model writes it, code checks it, code backs it up)
This is what keeps N4–N9's mechanics alive once the hand-written files are gone (section 1E). **User decision 2026-10-13: the model writes each talker's story and depth when they're created**, from their real history; code supplies the facts beforehand, checks the result, and fills in anything the model doesn't give (or everything, when the model is off or over budget). Changing people over time afterwards is [N25b Lives that change](n25b-lives-that-change.md).

**5a. The facts (code, always).** `server/src/npc/depth/facts.ts`: `factsFor(person)` gathers what's true about them from the realm, their people row and the event store, as a small structured sheet:
- identity: name, age, sex, species, class, job, site, kingdom, faction and rank, master, wealth;
- family: spouse, parents, children, siblings (alive/dead with causes, from N25 rows), recent births/deaths/marriages;
- history: their deeds, events with them as actor or target (crimes, fights, trades, raids survived), places lived (N25 migration), jobs held;
- surroundings: their site's recent events and conditions (`site_days`: famine, raids, war), its lord, its laws (slavery/serfdom), its factions and rivals;
- **secret candidates** from real facts: debts (wealth vs needs), a crime with no witness who told, a hidden tie (a gang or cult member with an honest job), a past they'd hide (born a slave, risen, a runaway once N59 exists), and later affairs (N46). Each candidate carries the event or fact behind it and who already knows.

**5b. The model writes the depth (`kind: "persona-story"`).** One structured call per new talker, queued in the background (N19) as soon as they become a talker; until it returns (or if it never does), the code fallback (5c) is used, so the NPC is never empty. Prompt: the facts sheet + the template's role words; schema (zod) asking for:
- `backstory` (3–5 sentences), `personality` and `speechStyle` lines, `quirks` (2–3), `appearance`;
- `fears` and `loves` (2–3 each, each with a short reason tied to a fact: "wolves: took her brother in the winter of day 30");
- `secrets`: **choose** 0–2 from the secret candidates (by id) and phrase each, plus a `coverStory` for each chosen secret;
- `dilemmas` (1–2) and `arcs` (1): each picks a **trigger kind** from a fixed list (a relationship crossing a value, a debt due, a faction order, a family event, the player's reputation, a site condition) with arguments that refer to real people/places from the sheet; the words are the model's;
- `goals` (2–3), `reputationFacts` (what the town knows about them, from their deeds only).
**Checks before applying** (`server/src/npc/depth/validate.ts`): every name is in the facts sheet (the invented-name check); every secret id is a real candidate; triggers are of known kinds with arguments that exist; no fact contradicted (a living spouse described as dead, a child older than a parent); content rules (minors: no romance, nothing adult; `config.content`); lengths within limits. Fields that fail are replaced by the code fallback for that field only. The accepted result is recorded (N23's input journal) so a replay doesn't need the model.
**Words, not mechanics.** Mechanical fields stay code's: `relationships` (from rows), `signature`/`services` (by job), `hire` (by role, rank and greed), `successor`/`successorOf` (apprentices and children), `prices`/`stock` (template). The model never sets numbers.

**5c. The code fallback (always available).** `server/src/npc/depth/fallback.ts`: the same fields from seeded pools in `data/templates/depth/*.json` (no people in them: phrases by job, trait, class and fact kind), `streamFor(seed, "depth", personaId)`. It's what the NPC has while 5b is queued, when the model is off (`DIRECTOR=off`/`PLANNING=off`) or over budget, and in tests.

**5d. Budgets and order.** Add `persona-story` to `CALL_KINDS` (after `plan`, before `chronicle`), `perGameDay` (start at 30) and `expectedMs` (≈ 5,000). Priority within the kind: talkers at the player's site first, then companions, then everyone else. A town activated with 8 new notables queues 8 calls (≈ 40 s of background model time).

**5e. Wiring.** `assemblePersona` → code fallback at once + queue 5b; the reply patches the persona and records a `persona-written` event (admin can see the old and new words). `check-npcs` validates the pools and the schema.

- Tests (model off and with `FakeProvider` replies): (1) with the model off, 50 generated talkers of seed 1 all have every field from code, and every mechanic has material (secrets with real facts behind them, fears and loves, relationships matching their rows, a successor where an apprentice or adult child exists, dilemmas and arcs whose triggers refer to real state); (2) a good fake reply is applied and journaled; (3) a reply naming an invented person, a non-existent secret id, a dead spouse alive, or romance for a minor has those fields replaced by the fallback; (4) the N4–N9 scenarios that used Brena/Hale reproduce with a generated smith/guard picked by job.

### Step 6: remove Millbrook and the cast from the game
- `generate.ts`: delete the hand-placed Millbrook, Voss, Holt, the seated `guard`/`merchants`/`bandits` factions and the named dungeon; the generator makes villages, notables, gangs and dungeons the same way everywhere. `if (s.home) continue` goes. `politics.ts` "Aldric Voss" goes.
- `pickStartSite` (decision 5) and the generated opening (decision 6) replace `"millbrook"` and `createDemoWorld`.
- Move `data/npcs/*.json` to `tests/fixtures/npcs/` (decision 11); `server.ts`/`cli.ts` stop loading persona files (no `NPC_DIR`); `cli.ts` starts by looking around at the start town instead of opening Brena; `bench-style.ts`/`bench-traits.ts` use generated personas from fixed seeds.
- Delete `data/world.json` (decision 7), `data/spawns.json`, `DEMO_SPAWNS`, `DEN_KEYS` names, `NPC_LOOKS` (sprite colours from a seeded palette per person; "nearby" words from the person's workplace on the map), `MILLBROOK_INFO`, `MILLBROOK`.
- Faction files → faction kinds (decision 10).
- Story content tied to the cast goes: the bandit-leader chain (gang chiefs are realm figures and get normal `defeat` jobs from `needsOf`), Pip's errands (any child talker can run errands if the child template allows it; check N11's code is by template, not by id), the cart-attack news, Brena's black-market weapons (the underworld uses whichever smith talker and gang exist).
- **Delete `HOME_ID`.** Lint ceilings for `HOME_ID`, the cast's names and `Millbrook` in code reach 0 except words (step 8).
- Take a new seed-1 golden run.

### Step 7: maps, places, townsfolk, lore and the realm without a home
- [`web/sites.ts`](../../../packages/server/src/web/sites.ts): `areasOf` from realm data for every site; `areaWords` generic; layouts with generated names (inn names from a pool, "the chief's tent").
- [`schedule.ts`](../../../packages/server/src/game/schedule.ts): `placeWords(site, place)` from the site map; server/CLI use it.
- [`realm/townsfolk.ts`](../../../packages/server/src/game/realm/townsfolk.ts): skip posts held by the site's talkers; laws from `kingdom.laws`.
- Lore scheme and `knowsFor` (decision 7); `placeLoreFor(site)` on activation; absorb N24 step 2b if it isn't built.
- `needsOf`, `postNeedQuests(site)`, `applyArrivals(site)`, `Realm.home` → `SiteState.arrivals` (decision 8); [`rise.ts`](../../../packages/server/src/game/realm/rise.ts) per active site; [`log.ts`](../../../packages/server/src/game/realm/log.ts) `reaches` → `reachesAt(news, site)`.
- Generated spawn rules by den kind (decision 9).
- Tests: raiders aimed at a town arrive on its map at night while the player is there; its head posts a quest when its pack grows; a commoner who wins fights on its map rises and is named; a talker knows their town's forge and lord for certain and far news only when it has reached the town.

### Step 8: words
- Templates: "Millbrook" → `{place}` and `{placeKind}`, filled in `assemblePersona`.
- Prompts ([`npc/templates.ts`](../../../packages/server/src/npc/templates.ts)): "a {placeKind} called {place} in the kingdom of {kingdom}".
- [`family.ts`](../../../packages/server/src/game/family.ts): the child's site. [`underworld.ts`](../../../packages/server/src/game/underworld.ts): the rumour names the site.
- "Corporal Hale keeps the gate" (server, CLI, client sheet) → the site's actual guard talker by name, or "the guard" if there is none.
- Client: "Home: Millbrook" → "{site}, a {kind} of {kingdom}"; drop the realm map's `home` ring (add a `start` marker if wanted); "(not heard in Millbrook yet)" → "(not heard here yet)"; start-up/goodbye lines name the game or the site.
- All lint ceilings at 0.

### Step 9: tests on generated worlds
- `tests/helpers.ts`: `makeWorld({ seed })` builds a generated world (start town by seed); `talkerByJob(world, "smith")` etc. picks generated people by job, never by name.
- World-level tests (sites, realm, travel, admin, people, N13–N25) move to generated worlds. NPC-mechanics tests keep the fixtures (decision 11) through a `fixtureNpc("brena")` helper that makes it obvious they're fixtures.
- The 48 test files: go through each; no assertion is weakened. Where a test relied on the story (Rook's gang on the mine road), rewrite it on the generated equivalent (the gang seated nearest the start town).

### Step 10: docs and roadmap
- README: the world is generated; no authored NPCs; how the start town is picked (`REALM_SEED`); saves before v13 are set aside.
- The roadmap's vertical slice and later stage files use "Millbrook" and "Highdale" as examples; they now read as "the start town" and "its liege town" (the living world README says so once; the plans' rules no longer mention Millbrook).
- The plans README's checklist: "no site is special; no hand-written people."
- N39's stage-file section gains: "the player chooses the start town (or random); deferred from N25a".

### Step 11: done-when check and play
- Play three seeds in the browser: start, talk to the head, take the starting quest, trade, fight something in the woods, travel to a neighbour, come back. Write down anything thin (a generated persona that feels empty) and feed it to step 5's pools.

---

## 5. Edge cases and traps

- **Mechanics that silently stop.** The biggest risk of removing the cast is features that keep passing tests (on fixtures) but never fire in a generated world because no generated persona has the field they read. Step 5's test over 50 generated talkers is the guard; add a check per mechanic ("some talker in seed 1 has a dilemma whose trigger is reachable").
- **Events need a site.** `GameEvent.place` is a `PlaceId` ("forge"), ambiguous once every site has a forge. `recordEvent` always sets `site` (the column exists since N18): the actor's site, else the player's. Gossip and knowledge checks compare `site` too.
- **Lore is a module global** (`setDynamicLore`): ids must be site-qualified (decision 7) so two towns' forges don't collide.
- **Companions** belong to their home site but travel with the player: `site` means home; `placeOf` uses the player's location for companions.
- **Quests that point at places, dens or creatures** carry a `site`; a quest taken in one town can't be finished with another town's wolves.
- **The first hour must still grab the player** without hand-written drama. `pickStartSite` prefers towns with something going on (a pack, a dungeon, a gang, a recent raid). N39 will tune this; note anything dull from step 11's play.
- **Persona generation cost.** Notables are made on activation (up to 8 per site); `deepen` is code, cheap; model rewrites are background and budgeted. A capital activation must stay inside N19's budgets.
- **Admin read-only rule:** use `peekSite()` (non-creating) in admin code.
- **N18 rule:** every new saved field (`sites`, `talkers`, `startSite`) in `newWorld` too.
- **Don't half-generalise.** `site === world.startSite` outside new-game setup and the `slice` config is the same bug renamed; the lint flags it.

## 6. Tests (`packages/server/tests/n25a.test.ts`, plus updates)

- **Centre lint** at zero.
- **Same systems everywhere** (step 3): the three-site suite.
- **Talkers off-screen** (step 4).
- **Generated depth** (step 5): model-written depth applied after checks; bad fields fall back to code; with the model off, 50 talkers still give every mechanic material; N4–N9 scenarios reproduced with generated people picked by job.
- **Arrivals and needs anywhere** (step 7).
- **The start town** (step 6): same seed → same start town; it has an inn, a smithy, two roads; the opening has a quest from its needs.
- **A full day at the start town of three seeds**: talk to the head, take the quest, trade, fight, travel to a neighbour; deterministic hash.
- **No hand-written content loaded:** start the server in a test and assert no file under `tests/fixtures` or `data/npcs` was read (the folder no longer exists in `src/data`).
- **v13 clean break:** a v12 save is set aside with `deaths.json`; a new world starts.

## 7. Done when

- The centre lint passes at zero: no `HOME_ID`, `atHome()`, Millbrook, or cast names in engine code, data, prompts, templates or the client.
- No persona file is loaded by the game; every talking person is generated, with secrets, fears, loves, relationships, dilemmas, arcs, services and successors from code.
- For three seeds, a new world starts in a seed-picked town and plays a full day with the same systems everywhere: talking notables, a quest from the town's needs, traders, creatures from generated spawn rules, raids arriving on the map, the underworld where it applies, news on the town's own clock.
- Leaving a town for a week and coming back finds its people mid-day, caught up.
- Old saves are set aside; the vertical slice and the plans no longer treat Millbrook as a rule.

## 8. Slice cut

All of it, before N26. If time is short, steps 0–4 and 6–7 are the must-haves (one kind of place, no Millbrook); step 5 (generated depth) can follow right after N26 as long as its absence is listed in the slice's playtest notes, because generated people without depth will feel thin.

## 9. Out of scope

Choosing the start town (N39). Renaming the project (`@millbrook/` packages). The player's own home (N66). Following several sites at full detail (N34). Per-kingdom cultures and names (N53).
