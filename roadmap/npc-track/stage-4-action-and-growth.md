[← Roadmap](../../ROADMAP.md) · [NPC track overview](README.md)

# Stage 4: Action and growth

Combat and health, quests and growth, crafting and the economy.

## N8: Combat and health

**Status:** ✅ Built (`src/game/abilities.ts`, `status.ts`, `health.ts`, `party.ts`, `loot.ts`; tests in `tests/n8.test.ts`)

**Goal:** fights that use stats, gear, MP and personality, and that can end in more ways than death or running away.

**Mechanics:**
- **Equipment:** weapon and armour slots for the player and NPCs. Armour tier reduces damage. Uses the existing item tiers.
- **MP abilities:** a few per skill, chosen by an NPC's skills (a smith's "heavy blow"), costing MP. They're rolled in code and picked by a combat style in code, never by the model.
- **Combat styles from traits:** aggressive (attacks every turn), cautious (defends when hurt) and cowardly (begs early). Code chooses the move; the model only narrates.
- **Status effects:** bleeding, stunned and weakened. Each lasts N turns and is shown as words in the situation.
- **Non-lethal option:** `/attack` vs `/subdue`. Knocked out is temporary, death is permanent, so the player chooses.
- **Loot:** a dead or subdued NPC drops their inventory. Taking from the unconscious is a witnessed crime (N7).
- **NPC level:** from total skill and stats. It sets fight difficulty and shows as a word ("a seasoned fighter").

**Tasks:**
- [x] `equipment` for NPCs (from `weapon` / `armor` in their file) and the player; armour items with tiers in `ITEMS` (leather armor, chain mail). Fights use what's equipped; armour soaks damage
- [x] Gear level: nobody equips gear above their rank (player rank from level). Checked for NPC and creature files
- [x] Durability: hits wear weapons and armour, worn copies carry it in their key and sell for less, broken gear does nothing; smiths repair for a fee (`/repair`) and mend their own overnight
- [x] Burden: pack slots from strength (gear 1 slot each, goods stack 20), shopkeeper storage (`storage` in NPC files); every transfer checks room
- [x] Wear on creatures' gear: bandits' own cudgels and leather wear and drop as they are; natural weapons dull with age instead and never mend
- [x] The underworld (`src/game/underworld.ts`): bandits with broken weapons buy from dishonest villagers on the black market; strong gangs raid the richest shop, fought out in code (`tests/underworld.test.ts`)
- [x] Raid news for every NPC: `news.bandit_raid` and `news.raid_repelled` in `src/data/world.json` (event-only lore entries), pushed to `world.recentEvents`
- [x] Raids in the player's sight: a raid on the shop where the player is (lodging at the inn, say) is fought with them in it; win and the defenders are grateful, the merchants think better of them, and the town hears
- [x] `src/game/abilities.ts` (heavy blow, quick strike, war cry, guard, second wind, dirty trick), MP costs (the player now has MP, restored by rest), and `src/game/status.ts` (bleeding, stunned, weakened, on guard)
- [x] A combat style picker from traits (aggressive, cautious, cowardly), plus tests for each style with fixed dice
- [x] `/subdue`, an `unconscious` outcome (they come round hours later with a grudge and a revenge goal), loot and `/loot` (a crime if seen)

**Done when:** in tests, a tier-B armoured NPC takes less damage than an unarmoured one, a cowardly NPC begs at 50% HP, and subduing leaves an NPC alive with lootable stock. ✅ (`tests/gear.test.ts` for armour, `tests/n8.test.ts` for the rest)

**Features in this phase:** N8.1 Lasting injuries and illness; N8.2 Companions.

### N8.1: Lasting injuries and illness

Harm that lasts days and changes what an NPC can do.

*Why now:* wounds last a fight, not days.

- **Mechanics:**
  - **Injuries** from fights (N8) or work accidents: a burned hand, a broken arm. Each lowers specific skills (a burned hand: −2 smithing) until healed, heals over days with rest (N0, N6), and heals faster with care (N6.2).
  - **Illness:** catches with a chance per day (more in winter, N6.4), lowers energy and work, and can spread to NPCs who share a place (N6).
  - Both appear as visible state (N4.4) and situation lines, and can create needs and quests ("herbs for a burn" becomes real).
- **Tasks:**
  - [x] `src/game/health.ts`: injuries and illnesses as data, with skill and attribute penalties, healing a day at a time (twice as fast tended), fight injuries, forge accidents, nightly illness (more in winter), spread at a place, and a cure quest while they suffer
  - [x] Link Brena's "Herbs for a burn" quest to an actual burn injury (`cures`)
  - [x] Tests: penalties apply and lift on healing, and illness spreads at the set rate
- **Done when:** Brena's burned hand makes her crafted items worse until you bring the herbs, and they improve once she's healed. ✅ In tests: with the same roll, an iron sword [C] burned, [B] healed. Teaching isn't affected: she still knows what she knows.

### N8.2: Companions

Hire an NPC to come with you.

*Why now:* NPCs can't travel or fight beside you.

- **Mechanics:** offered when trust or respect is high enough, for a daily wage (offer, then confirm). A companion follows you between places (N6), fights beside you (their moves are chosen in code, N8), and has **loyalty**: it rises with good treatment, falls when unpaid or put in danger, and is shaped by traits. Low loyalty means they leave, or turn on you if fear outweighs trust. Their own needs (N6) still apply.
- **Tasks:**
  - [x] `src/game/party.ts`: hire (a gated `offer_companionship` tool), wages each midnight, loyalty, dismiss; companions follow the player (schedule override) but still eat and sleep
  - [x] Companions act automatically in fights (their blows rolled in code; they hold back from killing townsfolk), and `NpcAgent.comment` gives them a line
  - [x] Tests: wages are paid daily, loyalty changes, and an unpaid companion leaves
- **Done when:** Hale comes with you for 10 gold a day, helps in a fight, and walks off after two unpaid days. ✅ In tests. (Since coins (N10) the old "gold" is a silver: his wage is 10 silver, more while he doesn't trust you.)

---

## N9: Quests, growth and story arcs

**Status:** ✅ Built (`src/game/quests.ts`, `gathering.ts`, `src/npc/growth.ts`, `arcs.ts`, `src/director/flavor.ts`; tests in `tests/n9.test.ts`)

**Goal:** quests beyond "bring N items", and a player whose growth opens up the world.

**Mechanics:**
- **New goal types, each checkable in code:**
  - `deliver`: exists
  - `gather`: `/forage` or `/hunt` with your skill, in a place (N6)
  - `craft`: make an item of tier ≥ X
  - `talk_to`: carry a message to another NPC, checked when you talk to them
  - `defeat`: win or subdue a named NPC (N8)
  - `escort`: be with an NPC at a place by an hour
- **Quest chains** with prerequisites (`requires: ["burn_poultice"]`), and **deadlines** using the clock, with failure costing trust or respect.
- **Generated quests with LLM flavour:** code picks the structure (goal, tier, reward from needs). The model only writes the title and the reason, via structured output (`format` + Zod), and the result is checked. A failed check falls back to template text.
- **NPC growth through challenges.** Skills, attributes and traits can improve, but only by overcoming something, never by the model's say-so:
  - **Challenges** are authored in the NPC file (`growth: [{ id, improves, trigger, ... }]`) and checked in code, like quest goals. Examples: Brena forges five tier-C items (smithing), Pell clears his debt (haggling), Hale survives a fight without fleeing (bravery).
  - **Skill tiers with progress.** Each skill keeps its tier (0 untrained to 5 master) plus XP toward the next one. Everyday work and challenges add XP. **Crossing a tier needs a trial:** a harder challenge for that skill, so a master can't come from routine alone.
  - **Attributes** gain +1 on a milestone (capped at 20, a few per NPC level). Max HP and MP rise with endurance and willpower.
  - **Traits drift slowly.** A big event moves a trait by about ±0.05 (surviving a fight raises bravery, being cheated lowers honesty), with a cap per in-game week, and traits never leave 0 to 1. Brena can become braver; she can't turn into a different person overnight.
  - **Saved as changes on top of the file.** The NPC file stays the starting point; the save holds the deltas (N2). A reset drops them.
  - **The model only sees words** ("she's grown sharper at the forge"), and growth shows up as situation lines or news, never as numbers.
  - Higher-level NPCs post higher-tier quests, up to `maxQuestTier`.
- **Player progression:** level-ups give attribute points (`/raise strength`). Skills improve by use, not only by training.

**Tasks:**
- [x] A union of goal types in `QuestObjective` (`deliver`, `gather`, `craft`, `talk_to`, `defeat`, `defeat_npc`, `escort`), with one checker per type in `src/game/quests.ts`
- [x] Gathering: `/forage` (items per place: herbs and pelts by the gate, ore at the camp) and the player's own `/craft` at the forge or the inn's kitchen. (`/hunt` already fights creatures; their loot counts as hunting.)
- [x] Chains (`requires`), deadlines (`deadlineHours`) and failure (trust and respect lost, never offered again)
- [x] `generateQuestFlavor()`: a structured-output call (`LLMProvider.generate`, Ollama's `format`) with a template fallback, run in the background on need quests
- [x] Skill growth from use, for NPCs (XP from work, a fine piece or a hard win is the trial) and the player (practice, a hard success is the trial); level-ups give attribute points (`/raise`)
- [x] `src/npc/growth.ts`: `GrowthChallengeSchema`, per-skill XP and tier trials, attribute milestones (capped at 20 and a few per rank), trait drift with caps (0.05 an event, 0.1 a week, 0.2 a lifetime). Unit tests with fixed dice
- [x] `growth` challenges for Brena, Pell and Hale, and growth deltas in the world save (`state.growth`)

**Done when:** after Brena forges enough tier-C items and passes her trial, her smithing tier rises and the save keeps it. A cowardly NPC who survives a fight gets a little braver, but not past the weekly cap. Brena's "My father's hammer" becomes a working 3-step chain (find out where it is from Pell, defeat the bandit, deliver the hammer), and a level 1 player can't skip ahead.
✅ In tests, with one change: Brena is already a master smith (5), so her five fine blades give a strength milestone instead; the skill trial and the save keeping it are shown with Hale's one-handed (2 → 3). Hale gets braver by 0.05 a fight, capped at 0.1 a week. The hammer chain works and can't be skipped.

**Features in this phase:** N9.1 Personal goal arcs.

### N9.1: Personal goal arcs

An NPC goal becomes a tracked arc with stages, e.g. Brena's "find out what happened to Tomas": *no news → heard a rumour → found a clue → learned the truth*.

*Why now:* `goals` is only flavour text today.

- **Mechanics:** `arcs: [{ id, stages: [{ id, requires, unlocks }] }]` in the NPC file. A stage advances when code sees its requirement: a fact the player passed on (via another NPC or item), a quest done, or a day reached. Stages unlock dialogue lines, quests and secrets.
- **Tasks:**
  - [x] `ArcSchema` and `src/npc/arcs.ts`: stage checks (`told`: a fact the player holds and mentions, `fact`, `quest`, `day`) and unlocks (quests, secrets)
  - [x] Arc progress in the save (`state.arcs`)
  - [x] Tomas arc for Brena (no news → heard a rumour → found a clue → learned the truth), with a stage line in the situation block. The player learns lore facts from what NPCs know (`lore:<id>` in `player.facts`)
  - [x] Tests: each stage fires on the right requirement and only once
- **Done when:** passing on a clue from Pell moves Brena from "no news" to "heard a rumour", and she says so. ✅ In tests: the stage change goes into her situation as "Something just changed: ... React to it."

---

## N10: Crafting and economy

**Status:** ✅ Built (`src/game/economy.ts`, input tiers in `crafting.ts`; tests in `tests/n10.test.ts`)

**Goal:** a small working economy where prices, stock and quality mean something.

**Mechanics:**
- **Input tiers matter:** better ore makes better swords. The output tier comes from the input tier plus a skill roll.
- **Commissions:** order an item ("an iron sword, tier C or better"), pay a deposit, the NPC works on it during their schedule (busy), and you collect it later. Uses the existing jobs.
- **Supply and demand:** prices move with stock (scarce goods cost more), and village demand differs by item.
- **Restocking:** NPCs buy materials from each other or from off-screen traders, which creates real needs for need quests.
- **Repairs:** weapons wear down in fights (N8), and smiths repair them for a fee.

**Tasks:**
- [x] Coins: copper, silver and gold (1 g = 10 s = 100 c), counted in copper in code (`src/game/money.ts`). The model sees and names prices as coin phrases, read back in code; data files use coin phrases. Old saves convert on load (save v4: 1 old gold = 1 silver, so balance is unchanged)
- [x] Rerun `npm run bench`: the trade scenarios now expect coin prices ("1 gold 5 silver"), and five new scenarios cover N7.1, N7.2, N8.2 and N10. `RUNS=3`, qwen3:4b-instruct, 2026-10-11: 47/60. Coin prices 3/3 each (offer, price question); the new ones: Hale offers a bribe 3/3, offers to come along 3/3, Brena offers a commission 3/3, denies a false rumour 1/3 (5/5 on the rerun after the fixes below), Pell passes on a rumour 0/3 (1/5 on the rerun: his replies run long, over the bench's 400-character limit, and hint rather than say it). Two regressions showed up and were fixed: "reveals secret at trust 80" fell to 1/3 because new situation lines (her burn, her arc, her plan) were always on, against design rule 3, so they're now shown only when the talk is about them (rerun: 5/5); and "Hale breaks with proof" fell to 1/3 because naming Pell handed Hale a rumour about Pell, so rumours now come up only when the player asks for gossip or asks about someone (rerun: 5/5). "Knows player can afford" is still the weak one (0/3), as before
- [x] Recipes take input tiers, and output tier = base + skill roll + what the inputs bring (−1 to +2). Orders use the best materials
- [x] `offer_commission` (offered on trade turns), deposits, a pickup flow, and `/collect`
- [x] Price modifiers from stock and demand, computed in `npcPrice` (with the seller's state): the last copies with nothing to make more from +25%, a pile −10%; village demand weights what villagers buy
- [x] Trade between NPCs on schedule (N6 and N7): restocking from neighbours at the same place, and travelling traders on market day (no ore while the mine road is shut)

**Done when:** bringing Brena better ore gets you a better sword, a commission is ready after the right number of hours, and iron sword prices rise when she's out of ore. ✅ In tests (the commission timing in `tests/n5.test.ts`): ore [E] for ore [F] lifts a sword from [D] to [C]; her last sword costs 5 gold instead of 4 with no ore to make another.
