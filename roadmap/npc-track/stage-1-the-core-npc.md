[← Roadmap](../../ROADMAP.md) · [NPC track overview](README.md)

# Stage 1: The core NPC

Fixes, personality, saves and what NPCs know: the base everything else stands on.

## N0: Fixes in what exists

**Status:** ✅ Built (`src/game/healing.ts`, `src/llm/tokens.ts`, minute clock in `src/game/simulation.ts`, tests in `tests/n0.test.ts`)

Gaps in the current mechanics that the later phases would build on top of. Each is small.

**Mechanics and tasks:**

- **Healing and rest.** HP and MP never come back today: after a fight Brena stays at 26/90 for good.
  - [x] Regenerate HP and MP per hour in `passTime`: slow while awake, faster asleep (N6). The rate comes from endurance and willpower. Awake 2 HP / 1 MP an hour, asleep (21:00–6:00) 5 / 3, plus the attribute modifier. Nobody heals mid-fight. The player rests on `/wait` (`restPlayer`)
  - [x] Healing items: `wild herbs` heal a little (5); a `healing salve` (new item, made by alchemy) heals more (20, scaled by tier). `/use <item>` for the player, and NPCs use their own when hurt: on the hour, and in a fight instead of attacking. Pell sells salves and mixes them from herbs
  - [x] An NPC below half HP won't trade or train ("I'm in no state for this") until they've healed. Shown as a situation line; the trade and training tools are withheld and refused in code
  - [x] Tests: HP over a `/wait`, and items heal by the right amount and are used up
- **Limit retries on social checks.** `/haggle` stops after 3 failures, but `/persuade` and `/intimidate` can be retried until the dice land.
  - [x] Each failure raises the next target by 2, and after 3 failures the NPC refuses that kind of check until the next in-game day (`config.maxSocialFailuresPerDay`, `config.socialFailurePenalty`)
  - [x] Failed intimidation also counts as a provocation (it already sets anger)
  - [x] Tests: the rising target and the daily reset
- **Keep conversations inside the context window.** History grows forever, but the context is 4,096 tokens. Past that, Ollama silently drops the *start*, which includes the system prompt.
  - [x] Count tokens per request using `prompt_eval_count` from the last reply, plus a rough estimate for the new message. The larger of that and a full character-based estimate is used, so a low count (prompt caching) can't hide growth
  - [x] Over a budget (about 3,000 tokens), drop the oldest whole exchanges. Never split a tool call from its result, and never drop the system prompt. Later, summarise them into memory facts (N5) instead of discarding them
  - [x] Test: a 60-turn fake conversation keeps the request under budget, keeps the system prompt, and leaves no orphaned tool results
- **A finer clock.** The clock moves in whole hours, and talking costs no time. Schedules (N6) and deadlines (N9) need more.
  - [x] Store minutes. Each conversation turn takes ~2 minutes, a trade ~5 and a fight round ~1 (`config.turnMinutes`). `/wait` still takes hours. While the player is talking to them, an NPC heals and finishes jobs but doesn't start new work
  - [x] Crafting jobs and schedules finish at the right minute (`CraftJob.until` is an absolute minute; saves upgrade to version 2)
  - [x] Tests: 30 turns move the clock about an hour, and a job that ends at 16:00 frees the NPC at 16:00
- **What happens when the player loses.** At 0 HP the game simply ends, and nothing is saved.
  - [x] Decide the rule, and make it a config option: (a) **knocked out**: wake up later with some gold or items taken, and the NPC remembers winning; or (b) **permanent death** of the save, like NPC deaths. `config.playerDefeat` / `PLAYER_DEFEAT`
  - [x] Recommended: (a) by default. It keeps the world going, and the event becomes a memory (N5). Knocked out: the NPC takes 25% of your gold, 8 hours pass (the NPC heals and works), you wake with 25% HP, and the NPC remembers it in its situation block
  - [x] Tests for whichever rule is chosen (both are tested)
- **Decide on `following`.** The field has been in the NPC state since the Foundation but nothing uses it.
  - [x] Either remove it, or keep it as the start of companions (N8.2). Don't leave it half-used: it adds a confusing situation line. **Removed**

**Also fixed on the way:** a saved NPC that had fled (or that you fled from, or that knocked you out) ended the next conversation before it started; now each start is a new encounter (`startEncounter`). NPCs that fled stayed `inCombat`. A model failure retry repeated words already shown to the player; now it only retries if nothing was shown.

**Done when:** after a fight, `/wait 8` brings both sides back up; persuasion can't be retried more than 3 times a day; a 60-turn conversation still follows the persona rules at the end; and losing a fight has a defined, tested result. ✅ All four are tests in `tests/n0.test.ts` (the 60-turn one checks the system prompt is sent unchanged on every request).

---

## N1: Personality traits that drive the rules

**Status:** ✅ Built (`src/npc/traits.ts`, `src/npc/personaSchema.ts`, Hale the guard; tests in `tests/traits.test.ts`)

**Goal:** two NPCs with the same stats behave differently because of their traits, and the differences come from code, not prompt wording.

**Mechanics:** a `traits` block in each NPC file, each value from 0 to 1. Every trait has at least one rule in code:

| Trait | Drives (in code) | Replaces today's fixed | Function |
|---|---|---|---|
| `greed` | Training markup, buy prices, haggling (exists) | — | `effectiveGreed` |
| `temper` | Insults before attacking (high temper: 2, low: 5); how much trust each insult costs | `PROVOKE_LIMIT = 3` | `provokeLimit`, `insultTrustFactor` |
| `bravery` | Morale target when hurt; whether a scared NPC flees, begs or fights | `MORALE_TARGET = 15` | `fleeAt`, `moraleTarget`, `begsWhenCornered` |
| `honesty` | Whether they can lie: a low-honesty NPC may deny a secret even after revealing it (a new `lie` outcome) | — | `lieChance` |
| `generosity` | Gifts to trusted players (new `give_item` gated on trust and generosity), quest reward bonus | — | `giftTrust`, `maxGiftValue`, `questRewardBonus` |
| `sociability` | How much gossip they pass on (N7), how chatty they are | — | `replyTokenFactor`, `replyLength` (gossip: N7) |
| `forgiveness` | How fast grudges fade (N5) | — | `grudgeFadePerDay` (trust only; memories: N5) |

How the new rules work:
- **Scared NPCs:** a failed morale check means they try to run (agility + evasion against the player). If they're cut off, a coward (bravery < 0.5) begs and the fight stops; anyone braver fights on, cornered.
- **Lies:** when `reveal_secret` is called, a dishonest NPC may lie instead (`lie: true` in the result). The secret stays unrevealed, and they stick to the lie for the rest of the day (a situation line reminds them).
- **Gifts:** `give_item` is offered only on trade talk, at or above `giftTrust`, for items worth up to `maxGiftValue`, once a day. Every limit is rechecked in code.
- **Quest bonus:** generous NPCs (above 0.5) add up to 25% to quest gold, fixed when the quest is accepted.
- **Chattiness:** sociable NPCs get a bigger reply token budget and are told "2-3 short sentences".
- **Grudges:** negative trust recovers towards 0 every midnight, by 4 to 20 a day.

**Tasks:**
- [x] Add `PersonaSchema` (Zod) and validate every NPC file **at startup**. This finishes the Foundation's validation item
- [x] Add `traits` with defaults (0.5), in `src/npc/traits.ts`, with one function per rule (`provokeLimit(traits)`, `moraleTarget(traits)`, …)
- [x] Switch the existing constants to trait-based functions, and keep Brena's current behaviour as her trait values
- [x] Show traits to the model only as words in the system prompt ("quick-tempered, brave, honest"), never as numbers
- [x] Add a third NPC with very different traits, e.g. a cowardly, dishonest guard, to prove traits matter
- [x] Give every trait in the table at least one rule in code (temper's trust cost, bravery's flee/beg/fight, honesty, generosity, sociability, forgiveness), with tests
- [x] `npm run sim`: what each NPC's traits add up to, with seeded dice; `npm run bench:traits`: attack and flee rates with the real model

**Done when:** in tests with fixed dice, a high-temper NPC attacks after 2 insults and a low-temper one after 5, and a cowardly NPC flees at a HP level where a brave one fights on. On the benchmark, each NPC's attack and flee rates follow their traits.
✅ Fixed-dice tests in `tests/traits.test.ts`. Benchmark (`npm run bench:traits`, `RUNS=3`, qwen3:4b-instruct, 2026-10-10): "traits followed". Hale (limit 2) attacked after 3.0 insults on average, Brena and Pell (limit 3) after 4.0 and 5.0, and the game refused every early attack. In fights, Hale broke at 44% HP and Pell at 41% (mostly begging when cornered); Brena held on to 27% or fought on. The model usually needs one turn past the limit before it chooses to attack. `npm run bench` stayed at 38/40.

---

## N2: Saving NPCs and the player

**Status:** ✅ Built. CLI and browser game (G1) share one world save, including the player's map position

**Goal:** nothing resets between runs. This has to come first, because memory, grudges and schedules mean nothing if they're lost on restart.

**Mechanics:**
- One save file per world: `saves/world.json`, with a `version` field so old saves can be upgraded.
- **Saved:** every NPC's `NpcState` (trust, mood, HP, gold, stock, debts, job, quest board), the player (level, XP, gold, inventory, skills, quests) and the clock.
- Deaths move into the world save (keep importing `saves/deaths.json` once).
- Autosave after every action that changes state. Load on start, or start a new world.

**Tasks:**
- [x] `src/game/save.ts`: `saveWorld()`, `loadWorld()`, `newWorld()`, plus a Zod schema for the save format
- [x] A versioned world container holding the clock, player and NPC states
- [x] CLI: `/save`, autosave, `--new` to start fresh, and reuse the current NPC choice
- [x] Tests: a save → load round-trip, a full-session round-trip (inventory, quests, trust, part-paid debt, map position), one-time deaths import, and compatibility with missing newer fields
- [x] Browser: autosave, `--new`, and all NPCs in one saved world

**Done when:** buy a sword, raise trust, accept a quest and quit. After restarting, everything is the same, and Pell's debt is still part-paid. ✅ Covered by `tests/save.test.ts`.

---

## N3: World knowledge and non-talking NPCs

**Status:** ✅ Built. Later items listed here belong to other phases (N5, N7, N9)

**Goal:** two foundations every later phase leans on. NPCs only know what the world file says they know, so they stop inventing places and people. And opponents, animals and crowds exist as stat blocks with no model calls, so combat quests and guards have something to fight.

**Features in this phase:** N3.1 What NPCs know (world lore); N3.2 Creatures and other non-talking NPCs; N3.3 Ranks, species and age.

### N3.1: What NPCs know (world lore)

**Status:** ✅ Built (`src/data/world.json`, `src/npc/knowledge.ts`, `tests/knowledge.test.ts`)

One source of truth for the world, and NPCs who admit what they don't know.

*Why now:* nothing stops an NPC inventing places, people or history.

- **Mechanics:**
  - A shared `src/data/world.json`: places, people (including people the player never meets, like the mayor and Tomas), history and current news, each with an id.
  - Each NPC gets **knowledge scopes**: which lore they know (`knows: ["millbrook.*", "mine_road", "tomas"]`), and how well (`rumour` or `certain`). A blacksmith knows the mine road; she doesn't know the mayor's household.
  - On a question, code picks the few relevant lore entries (by keyword, like trade talk) and adds them as situation lines. **Nothing outside the NPC's scope is ever shown.**
  - A firm rule in the system prompt: *"If it isn't in what you know, say you don't know, or that someone else might. Never make up names, places or events."*
  - "Who would know" hints: lore entries can name who knows more ("Old Pell hears all the rumours"), so "I don't know" becomes a lead instead of a dead end.
- **As built:**
  - Scopes are a map, `knows: { "millbrook.*": "certain", "people.tomas.sighting": "rumour" }`: an exact id, `x.*` or `*`, and the most specific wins. A scope matching nothing fails the NPC file.
  - A line's lore is scored by keyword: an entry's own words count double, its parents' once, so "Tomas?" brings up Pell's rumour about him. Not knowing is only admitted for what the player named (own words), because "you know nothing about Tomas seen in the city" would leak that there's news.
  - Proper names in the player's line that aren't in the world at all ("Kargoth") get "You've never heard of Kargoth. Say you don't know; Old Pell might." The referral is the known person marked `hearsRumours`.
  - The system prompt no longer lists knowledge, only "Who might know more: Old Pell (every rumour in the village); ..." from person entries with `knowsMore`. A list of every known name was tried first, but it put "the mayor" in Brena's prompt, next to her secret.
  - Lore marked `"event": true` (the cart attack, raids) reaches NPCs only through `world.recentEvents`, never a lookup, so nobody "remembers" a raid that hasn't happened. Old saves' event text is mapped to ids on load.
- **Tasks:**
  - [x] `LoreSchema` and `src/data/world.json`, moving today's per-NPC `knowledge` lines into it
  - [x] `src/npc/knowledge.ts`: scopes, keyword lookup, and at most 3 lines per turn (rule 3)
  - [x] A consistency check for T15: `unknownNames` flags a capitalised word that isn't a lore name, alias or NPC name (sentence openers are skipped). `npm run bench` counts it as a problem in every scenario
  - [x] Give every world event a game-side id; NPCs can only refer to events that were injected, never invent them
  - [x] Bench scenarios: ask about something outside the NPC's scope and expect "don't know"; ask about the mayor's wife and expect no invented name
  - [x] NPCs learning lore in play (told by the player or another NPC), saved per NPC (`state.learned`, `knowsOf`): N7
- **Done when:** asked about a place that isn't in the lore, Brena says she doesn't know and points you to Pell, 8 out of 10 times, and the invented-name check finds nothing across the benchmark. ✅ `RUNS=10 npm run bench`: unknown place 10/10, the mayor's wife 10/10 (both "Don't know. Old Pell might."), score 89/100. The only invented name flagged was a false positive ("Tomas—last"), since fixed. On the eight older scenarios the score matched the commit before N3.1 (69/80 both); secret reveal moved 9 → 7/10 and "no secret at trust 0" 10 → 9/10, within noise at 10 runs but worth watching. "Knows player can afford" was already failing before (0/10, now 3/10).

### N3.2: Creatures and other non-talking NPCs

Opponents and crowds that need no language model.

*Why now:* every NPC is a full talking character today.

- **Mechanics:**
  - A lighter kind of NPC: a **stat block** (HP, attributes, skills, weapon, armour), **traits** for combat style (N8), a **loot table**, and an optional faction (N7.3). No persona, and no model calls.
  - Uses: wolves on the road, the bandits from Brena's story, a guard patrol, a horse to escort, a crowd of villagers.
  - **Spawned by code:** by place and time (N6), events (N6.4) or quests (N9).
  - **Lines without a model:** non-talking NPCs use pre-written barks from a list (G2).
  - **One bandit leader can be a full NPC** while the rest are stat blocks. Mixing both is the point.
- **Tasks:**
  - [x] `CreatureSchema` and `src/data/creatures/*.json` (wolf, bandit, horse, villager). Each has a species, rank, age range, loot table and barks
  - [x] Combat against creatures with no model call (`fightCreature`, `fleeCreature`), morale and fleeing, and loot (items and gold) on defeat
  - [x] Creatures saved in `world.creatures`; a new world spawns `DEMO_SPAWNS`. They age, heal and rank up as time passes (`passCreatureTime`), and `/creatures` lists them
  - [x] A way to fight them: `/hunt` and `/escape` in the CLI; creatures roaming dens on the browser map, ambushes by aggressive kinds, `F` / `R` to fight or run, defeat by `PLAYER_DEFEAT`
  - [x] Their own challenges: daily hunts and raids, rivalry duels, hard winters; and young newcomers that refill thinned-out kinds
  - [x] Player XP for killing (or routing) creatures, scaled by their rank against the player's (`creatureXp`)
  - [x] Combat clock (`COMBAT_TICK_SECONDS`): a player who doesn't act in time loses the turn and the opponent (NPC or creature) strikes, in code. Server-side timer in the browser game (client polls and shows a countdown), prompt timeout in the CLI
  - [x] Spawning rules by place, time, event and quest (`src/data/spawns.json`, `src/game/spawning.ts`): each group turns up once per window, survivors move on when it ends, and the save remembers which creature came from which rule (`world.spawns`). Places are dens on the browser map
  - [x] `defeat` quests that target a creature kind: kills and routs count (`recordCreatureDefeat`), turn-in pays out in code with no items. Hale's "Trouble on the mine road" (3 bandits) spawns its quarry when taken
  - [x] The bandit leader as a full NPC: Rook (`src/data/npcs/rook.json`), at his camp on the mine road, holding Brena's father's hammer (he can't wield it; he'll sell it back for 9 gold). Taking "My father's hammer" brings out three bandit guards at the camp (spawn rule `rook_guards`). Kill him and you take his pack and purse (`dropsOnDeath`, his file only: shopkeepers drop nothing). Talk, buy, intimidate or fight: only he calls the model (`tests/banditLeader.test.ts`)
  - [~] A horse to escort: Pell's "A horse for the road" (N9 escort goal). A guard patrol is still to do
  - [x] Tests: a wolf fight runs entirely in code (`tests/creatures.test.ts`)
- **Done when:** "My father's hammer" sends you to fight three bandit stat blocks and their leader, who is a full NPC, and only the leader ever calls the model. ✅ In tests (`tests/banditLeader.test.ts`).

### N3.3: Ranks, potential, titles, species and age

**Status:** ✅ Built (`src/game/life.ts`, `src/world/species.ts`, `tests/life.test.ts`)

Every being, talking or not, grows, ages and can die of old age, all in code.

- **Mechanics:**
  - **Rank** G → SSS for every NPC and creature (`tier` in the file, `life.tier` in the save), up to a **potential** (`potential` in NPC files; a `[min, max]` range rolled per spawn for creatures). At potential they never grow: Pell is at his peak.
  - **XP makes them ready, a challenge raises them.** XP from a day lived (2), crafting (4 per output tier step), village sales (1), teaching (2/hour), winning a fight (30 + 5 × player level) and surviving one (10), capped at 100 × rank number. Once ready, only a **challenge** at least their own rank breaks them through: winning (or driving off the player) against an opponent of that rank (player rank from level, `rankForLevel`), or crafting a piece of that tier. Each rank: +10% of authored max HP (and MP), +1 to the two best attributes, and a memory of how.
  - **Titles** (`src/game/titles.ts`), earned in code: Giant-slayer, Death-cheater, Veteran, Master Artisan, and rank titles for A/S/SS/SSS. Deed titles add +1 to an attribute.
  - **Species** cap every potential (wolf B, horse D, halfling S, dwarf and orc SS, human and elf SSS), set the learn rate (orcs fast, elves slow) and the lifespan. Only talking species can be persona NPCs; any species can be a creature (bandits are human stat blocks).
  - **Age** comes from a birth day and `config.daysPerYear` (`DAYS_PER_YEAR`, default 48 since 2026-10-23; it was 12). Stages: young (weaker, learns ×1.5), adult, elder (body −2, mind +1, 85% HP, learns ×0.5), venerable (body −4, 60% HP, learns ×0.25). `statsOf()` gives authored stats + growth + age; every rule uses it.
  - **Natural death:** past elder age, a roll each midnight: yearly chance ((age − elder) / (max − elder))², spread over the year; certain at max age. Recorded permanently with `killedBy: "old age"`.
  - The model gets one line: "You: 68-year-old human (getting old), rank E."
- **Tasks:**
  - [x] `life.ts`: ranks, potential, readiness, challenges (`overcome`), growth, age stages, mortality; shared by NPCs and creatures
  - [x] `titles.ts`: deed and rank titles with bonuses, shown to the NPC and in the browser
  - [x] Player titles from the same table: fights won against NPCs and creatures (died, fled or begged), quests finished, level-based rank. Bonuses go onto the player's attributes; NPCs are told what the player is known as (`tests/titles.test.ts`)
  - [x] Titles feeding reputation (N7): strangers give respect for deed titles on a first meeting (`firstImpression`)
  - [~] More challenges: growth challenges in NPC files (quests done, fights survived, debts cleared: N9). A rival NPC and surviving a disaster are still to do
  - [x] `species.ts` and `species`, `age`, `tier`, `potential` in NPC files, checked by the schema
  - [x] XP hooks in crafting, sales, training, fights and the midnight tick; challenge hooks in crafting and fights
  - [x] Save version 3: NPC `life`, `deathCause`, creatures. Older saves get a life at their authored age on load, and HP trimmed to fit
  - [x] Browser shows species, age, stage, rank, growth (peak / ready / XP) and titles in the chat header
  - [x] Rerun `npm run bench` and `npm run bench:traits`: bench 89/100 (see N3.1); traits followed for all four NPCs (Hale and Pell break at 44% and 35% HP, Brena and Rook fight on; everyone attacks right after their insult limit)
  - [x] Successors (N7.4) and a death ripple for NPCs who die of old age (`game/succession.ts`, run by `Town.consequences`)
  - [x] Rank-gated content: an NPC gives quests up to a rank above their own (`questTierCap`); they teach up to their own (grown) skill
  - [ ] Before any young *talking* NPC: the `minor` content rule (design rule 7)
- **Done when:** ✅ in tests, teaching makes Brena ready but only forging a B-tier sword raises her, Pell never grows, a wolf only breaks through by downing a player of its rank, titles add their bonus once, Pell is weaker as an elder, and NPCs and wolves die of old age at their species' max age.
