# llm-game: LLM-driven NPCs

RPG characters that talk with a local language model (Ollama), and act in the game through tools the game checks.

**The core rule:** the model does the talking and *proposes* actions. The game's code decides what actually happens: every price, dice roll, trade, secret and quest is checked or worked out in code. The model is never trusted to keep track of state or do maths.

## Run it

```bash
npm install
ollama pull qwen3:4b-instruct   # once; Ollama must be running
npm run web                     # play in the browser at http://localhost:3000
npm run chat                    # talk to Brena the blacksmith
npm run chat -- pell            # talk to Old Pell the innkeeper
```

| Script | What it does |
|---|---|
| `npm run web` | Play in the browser: walk around Millbrook and talk to everyone (`PORT=3001` to change port, `-- --new` for a fresh game) |
| `npm run chat [-- <npc>]` | Talk to an NPC in the terminal |
| `npm test` | Unit tests (no model needed, fast) |
| `npm run test:live` | Tests against the real model (needs Ollama) |
| `npm run bench [-- <models...>]` | Pass rates on key behaviours, to compare models and prompt changes |
| `npm run bench:traits [-- <npcs...>]` | Real-model check that each NPC's attack and flee rates follow their traits (slow: ~10 min at `RUNS=3`) |
| `npm run sim [-- <npcs...>]` | What each NPC's traits do, with seeded dice and a scripted model (no Ollama, instant) |
| `npm run typecheck` | TypeScript check |

Model and settings are in [`src/config.ts`](src/config.ts). Override with `NPC_MODEL` and `OLLAMA_HOST` in `.env`.

## What an NPC can do

### Talk in character
- Has a personality, speech style, backstory, goals and things they know, all written in their NPC file. These become the system prompt.
- Each turn they're told what's true right now in a `<situation>` block: the time, place, recent news, their mood, HP, how much they trust you, and your gold. Stock, your items, what they can teach and their quests are only added when you talk about trade, training or work. Showing everything every turn made the small model noticeably worse.
- Remember earlier lines in the conversation. Long conversations drop their oldest exchanges to stay inside the model's context window (about 3,000 tokens), so the system prompt is never lost.
- The world is saved to `saves/world.json` after every action (`--new` starts fresh).

### Have a personality that changes the rules
Each NPC file has `traits` from 0 to 1. The model only sees them as words ("quick-tempered, cowardly"); the numbers drive rules in [`traits.ts`](src/npc/traits.ts):

| Trait | What it changes |
|---|---|
| `temper` | Insults before they attack (5 when placid, 2 for a hothead), and how much trust each insult costs |
| `bravery` | When they may flee, how hard their morale check is, and what a scared NPC does when cut off: a coward begs, the braver fight on |
| `honesty` | Dishonest NPCs may lie instead of revealing a secret, and stick to the lie for the rest of the day |
| `generosity` | Gifts to players they trust (`give_item`, once a day, cheap things), and a bonus on quest rewards |
| `sociability` | How long their replies may be |
| `forgiveness` | How fast a grudge (negative trust) fades, each night |
| `greed` (top-level field) | Training fees, buy prices, and greed eases once debts are paid |

`npm run sim` prints what each NPC's traits add up to.

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
- **Failure:** annoys them (persuade) or makes them angry (intimidate). A failed threat counts as an insult towards their patience.
- **Retries are limited:** each failure makes the next attempt 2 harder, and after 3 failures of a kind they refuse until the next day.

### Keep secrets
- A secret is **never in the prompt**, so at low trust they can't leak it, because they don't know it.
- Above trust 50 they get a `reveal_secret` tool, and only then are they told the secret to tell you in their own words.
- **Dishonest NPCs may lie** instead (rolled in code from `honesty`): they keep the secret and stick to their story until the next day.

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
- **Rewards** are gold, XP (by tier) and trust. Generous NPCs add a bonus, fixed when you take the quest. `/turnin` hands in finished quests.
- For now every quest is "bring N of an item", because that's the only kind the game can check.

### Make things and run a business (`/wait`)
- They craft with recipes based on their skills: smithing turns iron ore into horseshoes, daggers and swords; Pell brews ale and cooks stew.
- **Higher skill can produce higher-tier items:** a master smith often makes iron sword [B]s.
- **The clock runs in minutes.** Talking takes about 2 minutes a turn, a trade 5, a fight round 1; `/wait` and lessons take hours.
- **When time passes,** in working hours (6:00–20:00) they may start crafting or sell stock to villagers, but not while you're talking to them.
- **While crafting they're busy** and can't be talked to until the job's done, to the minute.
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
  - **They lose patience:** after enough insults in a row (2–5, from their `temper`) while they're still annoyed or angry, they may attack you.
  - **You attack them** with `/attack`.
- **A fight goes on until someone ends it.** They strike every turn automatically, rolled in code. A fight ends when:
  - **they break:** when badly hurt, a morale check (willpower, harder for cowards) decides whether they lose their nerve. A scared NPC tries to run; if you cut them off, a coward begs for mercy and a braver one fights on, cornered
  - **they stop:** if you beg or apologise and they choose to (`end_fight`)
  - **you run** (`/flee`), or someone dies
- **Death is permanent.** It's saved to the world save and `saves/deaths.json`, and a dead NPC can never be loaded again. Start a `--new` world (and delete `saves/deaths.json`) to undo it while testing.
- **If you lose** (0 HP), by default you're **knocked out**: the NPC takes a quarter of your gold, 8 hours pass, you wake with 25% HP, and the NPC remembers beating you. Set `PLAYER_DEFEAT=permadeath` to make losing end the world instead.

### Heal
- **Everyone heals with time:** a little HP and MP each hour, more while asleep (21:00–6:00), and more with high endurance (HP) and willpower (MP). Nobody heals mid-fight.
- **Healing items:** `wild herbs` heal 5 HP, a `healing salve` 20 (higher tiers heal more). Pell sells salves and mixes more from herbs. `/use <item>` uses one of yours; mid-fight it costs your turn.
- **NPCs treat themselves** when below half HP, if they have something: in a fight they use it instead of attacking.
- **Below half HP an NPC won't trade or teach** until they've healed.

## Play in the browser (`npm run web`)

A top-down map of Millbrook where you walk and talk without the terminal. The server ([`src/web/server.ts`](src/web/server.ts)) wraps the same `NpcAgent` and rules as the CLI, so everything above works; the browser only draws and sends what you do.

- **Move** with WASD or the arrow keys, or click a tile to walk there (one game minute per step; the village keeps living as time passes).
- **Talk** by clicking a villager, or press `E` next to one. Replies stream in as the model writes them. Walking away ends the conversation.
- **Say it your way:** the dropdown next to the chat box switches between Say, Persuade, Intimidate and Haggle. Rolls show in the chat.
- **Offers** (quests, sales, purchases, training) appear as Accept/Decline cards. Nothing costs you until you accept.
- **Buttons:** Hand in quests, Train… (shows the price, asks to confirm), Wares, Flee, Attack, and one-click opening lines.
- **Side panel:** attributes, skills, inventory, quests and journal. **Header:** clock, HP, gold, Wait 1h/4h, New game, model status.
- Saves to the same `saves/world.json` as the CLI, after every action. `PORT=3001 npm run web` changes the port; `npm run web -- --new` starts fresh.
- Limits: NPCs stand still (schedules are N6), one action runs at a time, and there is no `/use` button yet.

## Commands (terminal)

| Command | |
|---|---|
| *(anything else)* | Say it to the NPC |
| `/haggle <words>` | Haggle over price |
| `/persuade <words>`, `/intimidate <words>` | Social checks |
| `/attack`, `/flee` | Fight, or run from a fight |
| `/train <skill> [hours]` | Pay for a lesson (asks first) |
| `/turnin` | Hand in finished quests |
| `/wait <hours>` | Let time pass: you rest and heal, the NPC may craft or sell |
| `/use <item>` | Use a healing item from your inventory |
| `/quests` | Your level, XP and active quests |
| `/skills` | Your skills, and what this NPC can teach and for how much |
| `/state` | Everything about you and the NPC (debug) |
| `/trust <n>` | Set trust (testing shortcut) |
| `/save` | Save now (it also saves after every action) |
| `/quit` | Leave |

Free commands (`/state`, `/skills`, `/quests`, `/wait`, `/use`, `/save`) work even when the NPC is busy.

## Adding an NPC

Create `src/data/npcs/<id>.json` (copy [`brena.json`](src/data/npcs/brena.json)) and run it with `npm run chat -- <id>`. The tests check every file in that folder. To see them in the browser game, also give them a spot in [`src/web/map.ts`](src/web/map.ts) (`NPC_SPOTS`); the web server refuses to start if an NPC has none.

| Field | Notes |
|---|---|
| `name`, `role`, `personality`, `speechStyle`, `backstory`, `goals`, `knowledge` | Goes into the system prompt. Don't put secrets here (including in `goals`) |
| `greed` (0–1), `greedWhenDebtFree` | Marks up training fees and marks down buy prices at low trust |
| `traits` | `temper`, `bravery`, `honesty`, `generosity`, `sociability`, `forgiveness`, each 0–1 (missing ones are 0.5). See "Have a personality" above |
| `fallbackLine` | Optional. What they say if the model fails twice in a row |
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
    traits.ts         personality traits and the rule each one drives
    skills.ts, stats.ts, state.ts, types.ts
  game/               rules that don't need the model
    dice.ts items.ts training.ts quests.ts levels.ts crafting.ts
    simulation.ts clock.ts debts.ts deaths.ts healing.ts save.ts
  data/npcs/          brena.json, pell.json, hale.json
  world/world.ts      demo world and player
  web/
    server.ts         HTTP server for the browser game: state, movement, streamed NPC turns
    map.ts            Millbrook tile map, buildings and where each NPC stands
web/                  browser client (index.html, game.js, style.css), no build step
tests/                unit tests (fake model) + live.test.ts (real model)
scripts/bench.ts      behaviour pass rates against the real model
scripts/bench-traits.ts  do attack and flee rates follow traits? (real model)
scripts/sim.ts        trait rules with seeded dice and a scripted model
```

See [ROADMAP.md](ROADMAP.md) for what's done and what's next.
