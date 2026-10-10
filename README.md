# llm-game: LLM-driven NPCs

RPG characters that talk with a local language model (Ollama), and act in the game through tools the game checks.

**The core rule:** the model does the talking and *proposes* actions. The game's code decides what actually happens: every price, dice roll, trade, secret and quest is checked or worked out in code. The model is never trusted to keep track of state or do maths.

## Run it

```bash
npm install
ollama pull qwen3:4b-instruct   # once; Ollama must be running
npm run chat                    # talk to Brena the blacksmith
npm run chat -- pell            # talk to Old Pell the innkeeper
```

| Script | What it does |
|---|---|
| `npm run chat [-- <npc>]` | Talk to an NPC in the terminal |
| `npm test` | Unit tests (no model needed, fast) |
| `npm run test:live` | Tests against the real model (needs Ollama) |
| `npm run bench [-- <models...>]` | Pass rates on key behaviours, to compare models and prompt changes |
| `npm run typecheck` | TypeScript check |

Model and settings are in [`src/config.ts`](src/config.ts). Override with `NPC_MODEL` and `OLLAMA_HOST` in `.env`.

## What an NPC can do

### Talk in character
- Has a personality, speech style, backstory, goals and things they know, all written in their NPC file. These become the system prompt.
- Each turn they're told what's true right now in a `<situation>` block: the time, place, recent news, their mood, HP, how much they trust you, and your gold. Stock, your items, what they can teach and their quests are only added when you talk about trade, training or work. Showing everything every turn made the small model noticeably worse.
- Remember earlier lines in the conversation. Nothing carries over between runs yet, except deaths.

### Feel things and remember how you treat them
- **Mood:** happy, neutral, annoyed, angry, afraid or sad. Insults and compliments change it.
- **Trust:** from −100 to 100. It's moved by mood changes, purchases, sales, lessons, quests and checks, all in code. Trust unlocks secrets, better training and hidden quests.

### Sell to you
- They offer an item at a price, and **nothing changes hands until you say yes** (a y/n prompt).
- They can't offer below their price floor or offer items they don't have, and they won't make an offer you can't afford.
- When you're shopping, they're told which items you can afford, worked out in code.

### Buy from you
- They only buy what fits their trade (each NPC has a `buys` list).
- They pay half an item's value, and less if they're greedy and don't trust you. You still confirm with y/n.

### Haggle (`/haggle`)
- You roll charisma + haggling against their intelligence + haggling.
- The more you win by, the bigger the discount. A pending offer gets cheaper on the spot.
- Their own haggling skill shrinks every discount you win.
- After 3 failed haggles they won't budge until the next sale.

### Be persuaded or intimidated (`/persuade`, `/intimidate`)
- You roll charisma + speechcraft (persuade) or strength + intimidation (intimidate), against their willpower + the same skill.
- **Persuasion that works:** they're won over, more inclined to agree to what you asked, and give a discount.
- **Intimidation that works:** they're afraid of you and give a bigger discount.
- **Failure:** annoys them (persuade) or makes them angry (intimidate).

### Keep secrets
- A secret is **never in the prompt**, so at low trust they can't leak it, because they don't know it.
- Above trust 50 they get a `reveal_secret` tool, and only then are they told the secret to tell you in their own words.

### Teach one skill (`/train`, or just ask)
- Each NPC teaches **only their specialty** (`teaches`): Brena teaches smithing, Pell teaches haggling.
- They can't teach past their own level, and **trust limits how far they'll take you**:

  | Trust | Teaches up to |
  |---|---|
  | 0 | apprentice |
  | 20 | adept |
  | 40 | expert |
  | 60 | master |

- **Price:** 5 gold per hour per tier being taught. Greedy NPCs charge more when they don't trust you.
- **Time:** each tier takes longer to reach (4, 8, 12, 16, then 20 hours).
- Lessons move the clock forward, and the fee goes into the teacher's purse.

### Give quests (ask for work)
- **Tiers G → SSS.** Each tier needs a minimum player level (G 1, F 2, E 3, D 5, C 7, B 10, A 13, S 16, SS 20, SSS 25). Ask for something above your level and they refuse.
- **Some quests stay hidden** until they trust you enough.
- **Each NPC has a highest quest tier,** so not everyone has high-level work.
- **Quests come from two places:**
  - **Written ones** in their NPC file. Some send you to another NPC.
  - **Ones made from their needs**, like "short of iron ore, bring 8". The reward comes from their own purse, so a broke NPC offers no paid work.
- **Rewards** are gold, XP (by tier) and trust. `/turnin` hands in finished quests.
- For now every quest is "bring N of an item", because that's the only kind the game can check.

### Make things and run a business (`/wait`)
- They craft with recipes based on their skills: smithing turns iron ore into horseshoes, daggers and swords; Pell brews ale and cooks stew.
- **Higher skill can produce higher-tier items:** a master smith often makes iron sword [B]s.
- **When time passes,** in working hours (6:00–20:00) they may start crafting or sell stock to villagers.
- **While crafting they're busy** and can't be talked to until the job's done.
- They only make (and only ask for materials for) things they actually sell.

### Have money, and debts
- Each NPC has a purse. Your purchases, fees and their village sales go into it, and quest rewards come out of it.
- **Debts:** an NPC with a debt pays it down with anything above their reserve whenever they earn. Pell owes the mayor 200 gold.
- **Pell gets less greedy** once he's paid it off.
- Debts are secrets. The model only hears about one through `reveal_secret`, along with the current balance.

### Fight
- **Stats:** HP, MP and eight attributes, each from 1 to 20.
- **Skills:** 15 of them, each from 0 to 5. Combat skills and evasion affect hit rolls.
- **Weapons:** each has a damage die, a skill and a tier. Higher tiers do more damage.
- **What starts a fight:**
  - **They lose patience:** after 3 insults in a row while they're still annoyed or angry, they may attack you.
  - **You attack them** with `/attack`.
- **A fight goes on until someone ends it.** They strike every turn automatically, rolled in code. A fight ends when:
  - **they flee:** when badly hurt, a morale check (willpower) decides whether they run
  - **they stop:** if you beg or apologise and they choose to (`end_fight`)
  - **you run** (`/flee`), or someone dies
- **Death is permanent.** It's saved to `saves/deaths.json`, and a dead NPC can never be loaded again. Delete that file to undo it while testing.

## Commands

| Command | |
|---|---|
| *(anything else)* | Say it to the NPC |
| `/haggle <words>` | Haggle over price |
| `/persuade <words>`, `/intimidate <words>` | Social checks |
| `/attack`, `/flee` | Fight, or run from a fight |
| `/train <skill> [hours]` | Pay for a lesson (asks first) |
| `/turnin` | Hand in finished quests |
| `/wait <hours>` | Let time pass (the NPC may craft or sell) |
| `/quests` | Your level, XP and active quests |
| `/skills` | Your skills, and what this NPC can teach and for how much |
| `/state` | Everything about you and the NPC (debug) |
| `/trust <n>` | Set trust (testing shortcut) |
| `/quit` | Leave |

Free commands (`/state`, `/skills`, `/quests`, `/wait`) work even when the NPC is busy.

## Adding an NPC

Create `src/data/npcs/<id>.json` (copy [`brena.json`](src/data/npcs/brena.json)) and run it with `npm run chat -- <id>`. The tests check every file in that folder.

| Field | Notes |
|---|---|
| `name`, `role`, `personality`, `speechStyle`, `backstory`, `goals`, `knowledge` | Goes into the system prompt. Don't put secrets here (including in `goals`) |
| `greed` (0–1), `greedWhenDebtFree` | Marks up training fees and marks down buy prices at low trust |
| `stats` | `maxHp`, `maxMp` and 8 attributes (1–20) |
| `skills`, `teaches` | Tiers 0–5. `teaches` is their one trainable skill (defaults to their best) |
| `weapon` | An item from [`ITEMS`](src/game/items.ts) that's a weapon |
| `startingInventory`, `prices`, `buys`, `startingGold` | Item names, optionally with a tier: `"iron sword [B]"` |
| `secrets` | `{ id, about, text }`. `about` is a vague hint the model sees at high trust |
| `debts`, `reserveGold` | Optional. Paid down automatically from earnings |
| `maxQuestTier`, `quests` | Highest tier they give, and written quests (`deliver` objectives) |

## Project layout

```
src/
  cli.ts              the terminal game loop and commands
  config.ts           model and settings
  llm/                LLMProvider interface + Ollama implementation (the only code that knows about Ollama)
  npc/
    NpcAgent.ts       one NPC: turn loop, tool calls, offers, fights, topics
    actions.ts        tools the model can call, and the rules that check them
    persona.ts        system prompt and <situation> block
    moodPrefix.ts     strips "Annoyed." when the model writes its mood instead of calling the tool
    skills.ts, stats.ts, state.ts, types.ts
  game/               rules that don't need the model
    dice.ts items.ts training.ts quests.ts levels.ts crafting.ts
    simulation.ts clock.ts debts.ts deaths.ts
  data/npcs/          brena.json, pell.json
  world/world.ts      demo world and player
tests/                unit tests (fake model) + live.test.ts (real model)
scripts/bench.ts      behaviour pass rates against the real model
```

See [ROADMAP.md](ROADMAP.md) for what's done and what's next.
