[← Roadmap](../../ROADMAP.md) · [NPC track overview](README.md)

# Stage 5: A growing town

More people and a director that watches the town.

## N11: Growing the cast

**Status:** ✅ Built (2026-10-11). Tests in `tests/n11.test.ts`; benchmarks `npm run bench:style` (T15's blind voice test) and two new `npm run bench` scenarios.

**Goal:** more NPCs without hand-writing each one, and the NPC types the game still lacks.

**Features in this phase:** N11.1 NPCs from templates; N11.2 A child NPC; N11.3 Families (added: marriage, children, inheritance).

### N11.1: NPCs from templates

More townsfolk without writing every one by hand.

*Why now:* every NPC is written by hand.

- **Mechanics:**
  - **Templates** in `src/data/templates/*.json` (farmer, guard, merchant, child) give ranges for stats, skills, traits, stock, schedule and buys.
  - **Code rolls the numbers** with a seeded RNG (T3).
  - **The model writes only the name, backstory, speech style and appearance,** using Ollama's `format` with the NPC schema, so the result is checked. On failure it retries once, then falls back to template text.
  - **Generated NPCs are saved (N2) and become ordinary NPC files,** so nothing about them is random on reload. Templates respect content limits (rule 7): a child template is marked `minor`.
- **Tasks:**
  - [x] `TemplateSchema` ([`templates.ts`](../../packages/server/src/npc/templates.ts)), and a generator in `scripts/generate-npc.ts`: `npm run gen -- farmer [--seed N] [--no-model] [--dry]`. Rolls use `seededRng` (mulberry32, `game/dice.ts`) in a fixed order. The model also writes personality and goals (`IdentitySchema`); a taken name, or an adult word in a child's file, counts as a failure. Gear is only rolled at or below the rolled rank
  - [x] Validate every generated NPC with the full schema and T5's checks. T5's lint ([`lint.ts`](../../packages/server/src/npc/lint.ts), `npm run check-npcs`) was built for this; it found that template personality words could contradict the rolled traits ("earnest" with honesty 0.4), so words the numbers don't back are dropped (from the model's answer too)
  - [x] Tests: the same seed and template give the same numbers; the model changes only the words; a failed model call retries once and falls back cleanly; 60 seeds of every template pass the schema and the lint
  - [x] Generated NPCs need no map edits: an NPC with no spot in `map.ts` stands on a free tile near each place (`spotAt`, `npcSpot`); the web server no longer refuses them
- **Done when:** `npm run gen -- farmer` writes a new NPC file that passes every check, and the farmer works in the chat with no hand edits. ✅ `npm run gen -- farmer --seed 3` (qwen3:4b-instruct): "Eli Thorne", words by the model in 26 s (it includes loading the model; later runs took 12-23 s), same numbers as `--no-model`; the file passes `check-npcs`, and a test talks to a generated farmer through `NpcAgent` with no edits. No farmer file is kept in `src/data/npcs/`: the cast stays hand-tuned, and `gen` makes one when wanted.

### N11.2: A child NPC

*Why now:* planned since the first NPCs, but it needs the content limits (design rule 7) and N5.6's `minor` rules in place first.

- [x] Settle the content limits in `config.ts` and the `minor` rules (no romance; the chosen combat rule) before writing the file. **Chosen combat rule:** a minor is kept out of fights both ways: `minorsCanBeAttacked: false` (the player can't attack or subdue them; the browser hides the buttons), and a minor never gets `attack_player`, however provoked. The schema refuses a minor open to romance, married, or past their species' adult age; the lint refuses a minor who's a guard, a hireling, in armour or `dropsOnDeath`
- [x] A child NPC with a distinct voice, a small role in the town (errands, rumours) and tests that every limit holds: **Pip Hollis** ([`pip.json`](../../packages/server/src/data/npcs/pip.json)), ten, made from the child template and polished by hand. She lives at the inn under Old Pell's care, runs errands round the square (two G-tier quests), knows the news for certain and the rest as rumour, and has a small secret. A higher, quicker voice (pitch 1.45, Piper speaker 3, faster). Not a rumour *source* in the lore (`hearsRumours`): Pell kept pointing players to a ten-year-old for lore he hadn't heard of
- **Done when:** the child NPC passes the voice benchmark (T15), and the tests prove no romance tools or lines and the chosen combat rule. ✅ `npm run bench:style` (2026-10-11, qwen3:4b-instruct): Pip recognised 10/10 by the code classifier, no AI talk, no situation leaks, no romance. Tests: no romance even with `ROMANCE=on`, full affection and `romance.open` forced; no `attack_player` when provoked; `playerAttack` refused with HP and trust unchanged; never courts, marries or is proposed to. On the full run every NPC passed: Brena 9/10, Hale 9/10, Pell 9/10, Pip 10/10, Rook 8/10, Wren 9/10. (A first run had Hale at 3/10, mostly taken for Pell: at ten lines a run, the test is noisy.)

### N11.3: Families (added)

The user asked for marriage, and children who might get skills from their parents. All rules in code ([`family.ts`](../../packages/server/src/game/family.ts)); the model only hears words.

- **Courtship and marriage.** Each midnight, two unmarried NPCs of courting age (two years past grown: 18 for humans, so nobody courts the day they come of age) who like (affection 50+) and trust (20+) each other both ways, aren't kin, are within 15 years of age, and haven't sworn off love (`romance.open: false`) start walking out together, and grow closer each night; after six nights they marry. A quarrel (affection under 35) ends it. Weddings are news and a memory for both. NPC files may start married (`spouse`, both ways). `NPC_MARRIAGE=off` turns it off.
- **The player** marries only with `ROMANCE=on`, an NPC open to romance, at the last romance stage, neither married (`/propose`, the *Ask to marry* button). Code decides; the NPC answers in words (`NpcAgent.hear`). A child or romance-off proposal never reaches the model.
- **Children.** A married couple, both adults, may start expecting (15% a night), up to three children, 12 days' rest between, under a town cap of 14 living NPCs (8 GB: every NPC is a prompt). Born nine days later as an NPC whose file lives in the save (save v8, `family.born`, checked by the persona schema on load): a baby at home (off the map), at five a child on the child template's schedule (the model writes their words then, in the background, else the template's), and grown at the species' adult age.
- **Inheritance.** Attributes: the parents' average, give or take 2. Traits: a blend, nudged ±0.15. Potential: the stronger parent's, give or take a rank. **Talents:** each parent skill at tier 2+ passes on with 20% per tier (three at most): 1.5x skill XP (`TALENT_XP` in `growth.ts`), and on growing up half the parent's tier. A grown child takes the working parent's trade, hours, prices and storage; with no `successor`, the eldest grown child inherits when a parent dies (`succession.ts`). The player can be a parent; the player's skills pass on the same way.
- **Time together.** NPC trust used to have no way up. The roll in `gossip.ts` that already warmed affection between NPCs sharing a place now also builds trust, up to 40 (`FAMILIAR_TRUST`), never between enemies, and draws no extra dice. A no-model simulation of 240 days (the cast plus a generated farmer, merchant and guard, seeds 1 and 2): Hale married the generated guard within about three weeks, Pip married the farmer two years after coming of age, and each couple had three children, most with a talent.
- **Minors grow up.** File minors age like anyone (Pip is 16 by day 73 at 12 days a year), so at adulthood they lose `minor` too; the grown file is kept in the save over the original. Babies stay home whatever happens (no festival or empty purse takes them out: `schedule.ts`).
- **Words.** `describeFamily` ("Your husband is Corporal Hale. Your children: Tam (6), Pip (a baby).") reaches the situation only on family talk or with family present (design rule 3). `/family` and the World tab list it all.
- **Tasks:**
  - [x] Marriages, courtships, children on the way and born NPC files in the save (v8); older saves start with the files' marriages
  - [x] `Town.addNpc` / `replaceNpc`: births and growing up add and swap agents mid-game; the CLI and server read `town.ids`, so a child born in play can be talked to. Births on a multi-day `/wait` get the right birthday (a test caught the end-of-wait day)
  - [x] Tests: courting, marrying, quarrels, the gates (age gap, kin, sworn off, minors, switched off), proposals, births through `passHours`, inheritance ranges and determinism, talents' faster XP, caps, growing up, save and load, a grown child's inheritance, the player as a parent, and the gated family line
  - [x] Bench: "Brena names her husband" and "Pip turns romance aside" in `npm run bench`. `RUNS=5`, qwen3:4b-instruct, 2026-10-11: Pip turns romance aside 5/5; Brena names her husband 3/5 (the misses answered without saying "husband" or "married"). The rest of the bench after N11: 89/100 on the 20 older scenarios, in line with earlier runs. The weak spots are the same as before: "knows player can afford" 2/5, and "Pell passes on a rumour" 0/5, where his replies run past 400 characters ("too long" ×5)

---

## N12: The world director

**Status:** ⬜ After N5, N7 and N9. The event log (N12.1) and revenge (N12.2) can start any time

**Goal:** the world tells its own stories. What NPCs and creatures do (fights, raids, thefts, deaths) becomes news, lore, new quests, grudges and slow changes in character, without anyone writing them by hand.

**The rule (design rule 1, again):** a **director** model call *proposes*; code *decides*. The director never changes state. Its proposals go through a validator that accepts or rejects each one and logs why. Anything that can be a rule (who wants revenge, how much a trait moves) is a rule in code; the director only writes the words and picks among options code offers.

**Features in this phase:** N12.1 The event log; N12.2 Revenge and grudges as goals; N12.3 The nightly chronicle; N12.4 Director quests; N12.5 Character drift.

### N12.1: The event log

Everything that happens, recorded by code as typed events: `{ id, day, hour, kind: "fight" | "raid" | "theft" | "death" | "sale" | "quest" | ..., who, against, where, outcome, importance }`. Saved, with old low-importance events pruned. Memory (N5), gossip (N7) and the director all read from it; nothing parses the model's words to make one.

- [x] `src/game/events.ts`: `recordEvent`, importance set in code at each hook, pruning (least important first, past 300); a Zod `EventSchema` checks events on load (save v7). Every event is also archived in SQLite (`game/db.ts`)
- [~] Hooks wherever state changes for a reason: player actions (N5), killings, knock-outs, looting, theft, crimes paid, dilemmas, trade between NPCs, deaths and successions, revenge, hires, raids the player fought in. NPC and creature fights among themselves still only reach the log as news lines
- [x] Witnesses: who saw it (the scene's NPCs, set in code). Only witnesses know an event at first (`knownBy`); gossip (N7) spreads it

### N12.2: Revenge and grudges as goals

Being attacked, robbed or humiliated gives an NPC a **revenge goal**, in code. Their traits decide what they do with it: high temper and bravery confront you; low bravery hires bandits, spreads rumours or refuses to trade; high forgiveness lets it fade. Making amends (N5) clears it.

- [x] `goals` in state, with `kind: "revenge"`, a target and a strength that fades by `forgiveness` (`director/revenge.ts`)
- [x] Revenge actions decided by traits and acted on at the next midnight: refusing service (a grudge), a rumour about the player (N7.1), an ambush by hired bandits (an expiring spawn rule with `ambush: true`, waiting on the road), a confrontation (an opening line, and their patience gone)
- [x] Tests: the same attack on Brena, Hale and Rook leads to three different responses, decided by traits (confront, rumour, ambush)

### N12.3: The nightly chronicle

At midnight (or during `/wait`), code picks the 3–5 most important events of the day and makes **one small director call per event**, with tools:
- `add_lore` (a news or history entry): the id must be new; it may only name people and places already in the lore (the invented-name check, `unknownNames`); who knows it is set by code from the witnesses, never by the model. New lore starts as **rumour** for everyone but witnesses.
- `add_news`: a `"event": true` entry pushed to `recentEvents`, for things everyone hears.

Caps: at most N new entries a day; news expires after a few days unless something refers to it; near-duplicates of recent entries are rejected. Runs only while the player isn't mid-conversation, on the same `qwen3:4b-instruct` (one model on 8 GB).

- [x] `src/director/chronicle.ts`, its tools and Zod schemas, and the validator (`director/validator.ts`) with an accept/reject log (the last 50 in the save, every one in SQLite)
- [x] Lore that grows during play saved per world (`world.lore`), merged with `world.json` at load (`setDynamicLore`); witnesses know it for certain, everyone else as a rumour; news expires after 3 days
- [x] Bench: `npm run bench:director`, seeded event days; counts rejected proposals, invented names and lore close to the world file. 10 days (seed 3, qwen3:4b-instruct): 10 accepted, 12 rejected (unknown NPCs, ids taken, an invented name, a quest from someone not involved); no invented names got through. Two fixes it found: events now read as sentences ("Traveler was caught stealing from Brena", not a bare kind, which the model read backwards), and ids are normalised in code

### N12.4: Director quests

From an event and an NPC's goals or needs, the director proposes a quest: title, description, why they want it. Code checks the objective is one it can check (`deliver`, `defeat`, later `escort`), sets the tier from what's asked, and pays the reward from the giver's own purse. "Bandits stole my best blade; bring it back" after a raid is the model case.

- [x] `propose_quest` tool and validator (a living giver who was in the event, a checkable goal, the tier from what's asked, the reward from their purse, one at a time); director quests go on the NPC's `questBoard` like need quests
- [x] Defeat quests come with a spawn rule (their quarry turns up while the quest is taken)

### N12.5: Character drift

The director may propose a trait shift with a reason that names an event ("Hale grew braver after holding the gate in the raid"). Code checks the event is real and involves them, and caps it (±0.05 per event, ±0.2 over a lifetime from their authored traits). Personality *text* and speech style never change: the system prompt stays identical turn to turn (prompt caching) and the character keeps their voice.

- [x] `propose_trait_shift`, validated (the NPC was in an important event) and capped (`driftTrait`); shifts saved in state; `traitsOf(persona, state)` reads authored + drift, and every rule passes the state
- [x] Tests: no shift without a qualifying event; caps hold over a thousand nights (tests, and a line per NPC in `npm run sim`)

- **Done when:** over 30 simulated days, the chronicle adds lore that passes the invented-name check every time, every director quest is completable in code, and an NPC attacked by the player acts on it the next day, in a way that differs by their traits. ✅ In `tests/n12.test.ts`, with a scripted director that proposes good and bad entries.
