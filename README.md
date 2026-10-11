# llm-game: LLM-driven NPCs

RPG characters that talk with a local language model (Ollama), and act in the game through tools the game checks.

**The core rule:** the model does the talking and *proposes* actions. The game's code decides what actually happens: every price, dice roll, trade, secret and quest is checked or worked out in code. The model is never trusted to keep track of state or do maths.

## Run it

```bash
npm install
ollama pull qwen3:4b-instruct   # once; Ollama must be running
npm run web                     # build the browser game, then play at http://localhost:3000
npm run chat                    # or play in the terminal, starting at Brena's forge
npm run chat -- pell --name=Ash # start at Old Pell's inn, as Ash
```

NPCs speak with your browser's voices out of the box. For Piper's neural voices (needs Python 3, ~80 MB download, ~270 MB of memory while playing):

```bash
npm run voices:install          # once
npm run web:voices              # Piper and the game together; Ctrl+C stops both
```

| Script | What it does |
|---|---|
| `npm run web` | Build the browser game, then play: walk around Millbrook and talk to everyone (`PORT=3001` to change port, `-- --new` for a fresh game) |
| `npm run web:voices` | The same, with Piper started first and the game speaking through it. Ctrl+C stops both |
| `npm run dev [-- --voices]` | Work on the browser game: the game server (restarts on change) and Vite (reloads on change) at http://localhost:5173 (`CLIENT_PORT` to change). `--voices` starts Piper too |
| `npm run build` | Build the browser game into `packages/client/dist` (the server serves it) |
| `npm run voices:install` | Once, for Piper voices: a Python venv in `.venv-piper/` with `piper-tts`, and the voice models the NPC files name, in `voices/`. Safe to run again |
| `npm run voices` | Run Piper's server on its own (`PIPER_PORT`, default 5055), for `PIPER_URL` or another tool |
| `npm run chat [-- <npc>] [--name=<you>]` | Play in the terminal, starting where that NPC is |
| `npm test` | Unit tests (no model needed, fast) |
| `npm run test:live` | Tests against the real model (needs Ollama) |
| `npm run bench [-- <models...>]` | Pass rates on key behaviours, to compare models and prompt changes |
| `npm run bench:traits [-- <npcs...>]` | Real-model check that each NPC's attack and flee rates follow their traits (slow: ~10 min at `RUNS=3`) |
| `npm run sim [-- <npcs...>]` | What each NPC's traits do, with seeded dice and a scripted model (no Ollama, instant): combat style, revenge plan, and trait drift over a thousand nights |
| `npm run bench:director` | The world director against the real model: seeded event days, accepted and rejected proposals, invented names (`DAYS=30 SEED=7`) |
| `npm run bench:voice [-- --lines 8]` | What Piper voices cost next to the language model: latency per sentence, real-time factor, memory. Starts Piper itself if it's installed; results in `saves/bench/` |
| `npm run gen -- <template> [--seed N] [--no-model] [--dry]` | A new NPC from a template (`farmer`, `guard`, `merchant`, `child`): code rolls the numbers from the seed, the model writes the words. Checked, then written to `src/data/npcs/` (N11.1) |
| `npm run check-npcs` | The authoring check (T5): every NPC file and template through the schema and the lint. The CLI and the web server run the same lint at startup |
| `npm run bench:style [-- --npc <id>]` | The blind voice test (T15): the same ten lines to every NPC, and a code classifier tells who's speaking; plus no AI talk, no `<situation>` leaks, no romance from a minor, and invented names. Results in `saves/bench/` |
| `npm run replay -- <file>` | Inspect a recorded transcript (T3) |
| `npm run typecheck` | TypeScript check (all three packages) |

### Project layout

An npm workspaces monorepo:

| Package | What's in it |
|---|---|
| [`packages/server`](packages/server) | The game: NPC agents, rules, saves, the director, the CLI ([`cli.ts`](packages/server/src/cli.ts)) and the HTTP server ([`web/server.ts`](packages/server/src/web/server.ts)), with its tests and scripts. Paths like `src/npc/...` below are in here. |
| [`packages/client`](packages/client) | The browser game: a [Phaser 3](https://phaser.io) world view ([`WorldScene.ts`](packages/client/src/world/WorldScene.ts)), DOM side panels ([`ui/`](packages/client/src/ui)) and voices ([`voice/`](packages/client/src/voice)), built with Vite |
| [`packages/shared`](packages/shared) | What both sides agree on: the HTTP types ([`protocol.ts`](packages/shared/src/protocol.ts)), typed game events ([`events.ts`](packages/shared/src/events.ts)), the sentence splitter for speech, NPC voice settings, grid paths |

Model and settings are in [`src/config.ts`](packages/server/src/config.ts). Override with `NPC_MODEL` and `OLLAMA_HOST` in `.env` (see [`.env.example`](.env.example)). Voices: `PIPER_URL` (a running Piper server's `/synthesize`), `PIPER_BIN`, `PIPER_VOICES` (default `voices`), `PIPER_PORT` (for the npm scripts, default 5055); `FILLER_AFTER_MS` (default 3000, `0` turns filler lines off). Also: `DIRECTOR=off` (no nightly chronicle), `PLANNING=off` (no off-screen plans), `SUMMARIES=off` (no conversation summaries), `EMBED_MODEL` (default `nomic-embed-text`) and `DB_FILE` (default `saves/world.db`). Families: `NPC_MARRIAGE=off` (no courting or births among NPCs), `PREGNANCY_DAYS` (default 9); the rest is `config.family`.

For recall by meaning, optionally pull a small embedding model: `ollama pull nomic-embed-text` (~270 MB). Without it, a hashed bag of words stands in (no download, works offline).

## What an NPC can do

### Talk in character
- Has a personality, speech style, backstory, goals and things they know, all written in their NPC file. These become the system prompt.
- Each turn they're told what's true right now in a `<situation>` block: the time, place, recent news, their mood, HP, how much they trust you, and your money. Stock, your items, what they can teach and their quests are only added when you talk about trade, training or work. Showing everything every turn made the small model noticeably worse.
- Remember earlier lines in the conversation. Long conversations drop their oldest exchanges to stay inside the model's context window (about 3,000 tokens), so the system prompt is never lost.
- The world is saved to `saves/world.json` after every action (`--new` starts fresh).

### Have a personality that changes the rules
Each NPC file has `traits` from 0 to 1. The model only sees them as words ("quick-tempered, cowardly"); the numbers drive rules in [`traits.ts`](packages/server/src/npc/traits.ts):

| Trait | What it changes |
|---|---|
| `temper` | Insults before they attack (5 when placid, 2 for a hothead), and how much trust each insult costs |
| `bravery` | When they may flee, how hard their morale check is, what a scared NPC does when cut off (a coward begs, the braver fight on), and how much a threat scares them |
| `honesty` | Dishonest NPCs may lie instead of revealing a secret, keep cover stories until broken, and spot your lies better |
| `generosity` | Gifts to players they trust (`give_item`, once a day, cheap things), a bonus on quest rewards, and how readily and how much they lend |
| `sociability` | How long their replies may be, how often they gossip and chime in, and an evening ale |
| `forgiveness` | How fast negative trust, bad memories, bad feelings and grudges fade |
| `greed` (top-level field) | Training fees, buy prices, and greed eases once debts are paid |

`npm run sim` prints what each NPC's traits add up to.

### Feel things and remember how you treat them
- **Mood:** happy, neutral, annoyed, angry, afraid or sad. Insults and compliments change it. A few hours after you leave, it drifts back to how they feel in themselves (their feelings, then hunger and tiredness).
- **Four relationship axes** ([`relationship.ts`](packages/server/src/npc/relationship.ts)), all moved in code:
  - **Trust** (−100 to 100): unlocks secrets, gifts, training tiers and hidden quests.
  - **Fear** (0 to 100): from threats, attacks and your rank above theirs. A won intimidation only buys a discount if they're scared enough; brave NPCs are shaken, not cheaper.
  - **Respect** (−100 to 100): from finished quests and your rank. C-tier and higher quests, and expert and master training, need it.
  - **Affection** (−100 to 100): from time together, gifts and help. Friends give 10% off, close friends 15%. Romance is off unless you set `ROMANCE=on`, and never with an NPC marked `minor`.
- **Memory** ([`memory.ts`](packages/server/src/npc/memory.ts)): what you did is written down by code (an insult, a purchase, an attack, a quest), with an importance that fades; bad memories fade at their `forgiveness`. The three that weigh most come up each turn: "Yesterday, they insulted you: …".
- **Lasting emotions** ([`emotions.ts`](packages/server/src/npc/emotions.ts)): resentment, embarrassment, pride, gratitude, grief. An insult in front of others stings for days; a masterwork leaves them proud.
- **Grudges:** attack someone and they won't trade with or teach you until it fades or you make amends: say sorry and they name a fine, or bring a gift or finish a job for them.
- **Fears and loves:** mention the mayor to Pell and he's frightened; give Brena stew or a well-made blade and she warms to you far faster than coins would. Your journal notes what you find out.
- **Your name:** they call you a stranger until you tell them ("I'm Ash", or `/introduce`), and the model never sees your real name until then. Names spread as gossip: Pell may hear it from Brena over supper.
- **They notice you:** a bloody sword, a bad wound, fine gear, money. Once an encounter, one thing at a time.

### Sell to you
- They offer an item at a price, and **nothing changes hands until you say yes** (a y/n prompt).
- They can't offer below their price floor or offer items they don't have, and they won't make an offer you can't afford.
- When you're shopping, they're told which items you can afford, worked out in code.

### Buy from you
- They only buy what fits their trade (each NPC has a `buys` list).
- They pay half an item's value, and less if they're greedy and don't trust you. You still confirm with y/n.
- **What they buy goes back on sale.** It shows in their wares at their list price, or at its full value if they have none (they paid half). The exception is materials for their own work, like Brena's iron ore or Pell's brewing herbs: those are kept, and the wares list says why.
- They need room for it (see Burden below).

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

### Know only what the world says they know ([`src/data/world.json`](packages/server/src/data/world.json))
- **One source of truth:** places, people (including ones you never meet, like the mayor and Tomas), history and news, each with an id like `people.mayor.household`.
- **Each NPC has knowledge scopes** (`knows`): which lore they know, and how sure they are (`certain` or `rumour`). Brena knows the mine road but not the mayor's household; Pell knows nearly everything, some of it only as rumour.
- **Code picks the lore your line is about** (by keyword, at most 3 lines a turn) and adds it to the situation block. **Nothing outside their scope is ever shown**, and asking about something they don't know gets a line telling them to say so, often with a lead ("Old Pell might know"). A name that isn't in the world at all ("the ruins of Kargoth") gets the same treatment.
- **Today's events are lore ids** (`world.recentEvents`), so NPCs only hear of events the game put there. Event entries (`"event": true`, like a raid) never come up from a keyword lookup.
- `npm run bench` flags any reply that names a person or place that isn't in the lore (`unknownNames` in [`src/npc/knowledge.ts`](packages/server/src/npc/knowledge.ts)).

### Keep secrets
- A secret is **never in the prompt**, so at low trust they can't leak it, because they don't know it.
- Above trust 50 they get a `reveal_secret` tool, and only then are they told the secret to tell you in their own words.
- **Dishonest NPCs may lie** instead (rolled in code from `honesty`): they keep the secret and stick to their story until the next day.
- **Cover stories** ([`secrets.ts`](packages/server/src/npc/secrets.ts)): some secrets have a `cover`. Hale tells you he was on patrol, however much he trusts you, until something breaks it: proof you carry, a fact you learned (Pell's own secret about who hid in his cellar), or beating him in a `/intimidate` that day. Then the truth comes out at any trust.

### Lie to them (`/lie <claim>`)
- Your charisma + speechcraft against their perception, plus insight (dishonest NPCs spot lies better), easier if they trust you.
- Believed: they take it as true (the game knows it isn't). Spotted: trust and respect drop, and they remember. A believed lie can come out later: each night there's a chance, more if it names someone they could check with.

### Ask favours (`/ask <lend_gold|vouch|hide_item|warn_me> [item]`)
- Code decides from trust, fear, respect and generosity, and sets the terms; you confirm. A loan is a promise to repay by a date (`/repay`): break it and they remember. Every favour leaves you owing one, and a day later they'll ask for it back.

### Keep promises, and make them keep theirs
- **Commissions** (`/commission <item>`, `/collect`): pay half up front and they make it in their working hours. They name a time from the work alone, so a late order can run late; then they apologise without being asked and take 20% off.

### Live a day ([`schedule.ts`](packages/server/src/game/schedule.ts), [`needs.ts`](packages/server/src/game/needs.ts), [`village.ts`](packages/server/src/game/village.ts))
- Each NPC has a schedule: Brena works the forge 6–20, eats at the Gilded Goose (and pays Pell), and sleeps at home. Hunger and energy tick every hour; a starving NPC goes to eat, an exhausted one to bed, a broke one works through supper. Hungry or tired, they say so and get short-tempered.
- You can only talk to someone where they are, and not while they sleep. The whole village lives together when time passes: suppers, an ale for the sociable, gossip.
- **Signature moves:** Brena has a good forge day 3 days in 20, and her next piece comes out a tier better. Pell keeps a strong salve under the bar for trusted regulars.
- **Services:** Pell rents rooms (you sleep till 6:00 and wake healed) and tends wounds.
- **They speak first** when they have a reason: a job they gave you, a promise due, a grudge, a favour to call in, news, or a first greeting. Once per reason, not every turn.
- **Weather, seasons and town events:** four seasons over the year (`DAYS_PER_YEAR`), weather by day, a market every seventh day, a midsummer festival. Pelts are dear in winter; after a raid, weapons and ore cost more and the mine road is shut.
- **Group scenes:** with several NPCs at one place, the one you name answers, and at most one other may chime in. Each hears what the others just said.

### Remember it for you (`/journal [npc]`)
- Your journal fills itself from what happens: secrets told and cover stories heard, what they love and fear, promises, who knows your name, quests and lies.

### Teach one skill (`/train`, or just ask)
- Each NPC teaches **only their specialty** (`teaches`): Brena teaches smithing, Pell teaches haggling.
- They can't teach past their own level, and **trust limits how far they'll take you**:

  | Trust | Teaches up to |
  |---|---|
  | 0 | apprentice |
  | 20 | adept |
  | 40 | expert |
  | 60 | master |

- **Price:** 5 silver per hour per tier being taught. Greedy NPCs charge more when they don't trust you.
- **Time:** each tier takes longer to reach (4, 8, 12, 16, then 20 hours).
- Lessons move the clock forward, and the fee goes into the teacher's purse.

### Give quests (ask for work)
- **Tiers G → SSS.** Each tier needs a minimum player level (G 1, F 2, E 3, D 5, C 7, B 10, A 13, S 16, SS 20, SSS 25). Ask for something above your level and they refuse.
- **Some quests stay hidden** until they trust you enough.
- **Each NPC has a highest quest tier,** so not everyone has high-level work.
- **Quests come from two places:**
  - **Written ones** in their NPC file. Some send you to another NPC.
  - **Ones made from their needs**, like "short of iron ore, bring 8". The reward comes from their own purse, so a broke NPC offers no paid work.
- **Rewards** are money, XP (by tier) and trust. Generous NPCs add a bonus, fixed when you take the quest. `/turnin` hands in finished quests.
- **Two kinds of objective,** both checked in code: `deliver` ("bring 3 wild herbs") and `defeat` ("kill or drive off 3 bandits"). Killing or routing a creature of that kind counts towards it; `/quests` shows how far along you are. Corporal Hale's "Trouble on the mine road" is one, and taking it brings the bandits out (see spawn rules below).

### Make things and run a business (`/wait`)
- They craft with recipes based on their skills: smithing turns iron ore into horseshoes, daggers and swords; Pell brews ale and cooks stew.
- **Higher skill can produce higher-tier items:** a master smith often makes iron sword [B]s.
- **The clock runs in minutes.** Talking takes about 2 minutes a turn, a trade 5, a fight round 1; `/wait` and lessons take hours.
- **When time passes,** in working hours (6:00–20:00) they may start crafting or sell stock to villagers, but not while you're talking to them.
- **While crafting they're busy** and can't be talked to until the job's done, to the minute.
- They only make (and only ask for materials for) things they actually sell.

### Have money, and debts
- **Coins:** copper, silver and gold. **1 gold = 10 silver = 100 copper.** A loaf of bread is 1 silver, a dagger 1 gold 5 silver, an iron sword 4 gold; you start with 5 gold. The game counts everything in copper ([`src/game/money.ts`](packages/server/src/game/money.ts)), so sums and discounts are exact.
- **NPCs talk in coins.** The model is shown every price and purse as coins ("1 gold 5 silver"), and names prices in its tool calls the same way; the game reads them back into copper, and a bare number ("15") is sent back as unclear. In tests with `qwen3:4b-instruct`, Brena offered "2 silver" for a horseshoe on the first try.
- Each NPC has a purse. Your purchases, fees and their village sales go into it, and quest rewards come out of it.
- **Debts:** an NPC with a debt pays it down with anything above their reserve whenever they earn. Pell owes the mayor 20 gold.
- **Pell gets less greedy** once he's paid it off.
- Debts are secrets. The model only hears about one through `reveal_secret`, along with the current balance.

### Gear, durability and burden
Same rules for you and for NPCs ([`src/game/gear.ts`](packages/server/src/game/gear.ts)).
- **Equipment:** a weapon slot and an armour slot. Fights use what's equipped, not what's in your pack. `/equip`, `/unequip` and `/gear` in the terminal; Equip / Take off in the browser's Inventory tab.
- **Gear level:** you can't equip gear above your rank. Your rank comes from your level, the same steps as quests: G at level 1, F at 2, E at 3, D at 5, C at 7, B at 10... so a dagger [E] needs level 3 and an iron sword [D] level 5. NPCs use their own rank: Hale (F) fights with a cudgel and leather armour, and carries a dagger he can't wield yet. NPC and creature files are checked for it.
- **Armour:** leather armor (F, soaks 1 damage a hit) and chain mail (D, soaks 3); higher tiers soak more. A hit always does at least 1. Bandits wear leather and sometimes drop it.
- **Durability:** every hit wears the weapon that lands it and the armour that takes it. Worn gear shows it, e.g. `iron sword [D] (12/50)`, is worth less (down to a quarter when broken), and stacks apart from new copies. A broken weapon is as good as fists; broken armour stops nothing. Better tiers last longer.
- **Repairs:** a smith (anyone with smithing, so Brena) mends gear for half the value the wear took off: `/repair weapon`, `/repair armor` or `/repair <item>`, or Repair… in the browser. It takes 30 minutes, and she says something as she hands it back. Smith NPCs mend their own gear overnight.
- **Burden:** packs have slots. Each piece of gear takes a slot; other goods stack 20 to a slot. Pack slots come from strength: 10 + 2 × the strength modifier (you: 12; Brena: 16; Pell, whose age has him at strength 6: 6). Equipped gear is worn, not packed.
- **Shopkeepers have storage:** a chest or bag with its own slots on top of their pack (Brena's forge chest 12, Pell's storeroom 16, Hale's satchel 4). That's where their stock lives.
- **A full pack takes nothing more:** you can't buy, be given, or loot what won't fit (loot you can't carry is left behind), an NPC won't buy from you or take quest goods without room, and won't start crafting what they'd have nowhere to put.

### Fight
- **Stats:** HP, MP and eight attributes, each from 1 to 20.
- **Skills:** 15 of them, each from 0 to 5. Combat skills and evasion affect hit rolls.
- **Weapons:** each has a damage die, a skill and a tier. Higher tiers do more damage. You fight with what you have equipped (see Gear above).
- **What starts a fight:**
  - **They lose patience:** after enough insults in a row (2–5, from their `temper`) while they're still annoyed or angry, they may attack you.
  - **You attack them** with `/attack`.
- **The combat clock:** in any fight (NPC or creature) you have `COMBAT_TICK_SECONDS` (default 6) real seconds to act. If you don't, your turn is lost ("You hesitate.") and your opponent strikes again, rolled in code with no model call. The browser shows a countdown bar under you; the terminal prompt shows the seconds. Set it to 0 to turn the clock off.
- **A fight goes on until someone ends it.** They strike every turn automatically, rolled in code. A fight ends when:
  - **they break:** when badly hurt, a morale check (willpower, harder for cowards) decides whether they lose their nerve. A scared NPC tries to run; if you cut them off, a coward begs for mercy and a braver one fights on, cornered
  - **they stop:** if you beg or apologise and they choose to (`end_fight`)
  - **you run** (`/flee`), or someone dies
- **Death is permanent.** It's saved to the world save and `saves/deaths.json`, and a dead NPC can never be loaded again. Start a `--new` world (and delete `saves/deaths.json`) to undo it while testing.
- **If you lose** (0 HP), by default you're **knocked out**: the NPC takes a quarter of your money, 8 hours pass, you wake with 25% HP, and the NPC remembers beating you. Set `PLAYER_DEFEAT=permadeath` to make losing end the world instead.

### Grow in rank, earn titles, age, and die of old age
- **Everyone has a rank**, G to SSS (the same letters as items and quests): talking NPCs and creatures alike. Brena is C, Pell E, Hale F.
- **Not everyone can grow.** Each has a `potential`, the highest rank they'll ever reach. Brena can reach A, Hale D; Old Pell is already at his peak (E). Each creature rolls its own potential when it spawns, so some wolves never get past F.
- **XP only makes them ready.** They earn XP for living through a day, finishing a craft, selling to villagers, teaching you, and winning or surviving fights. XP stops at what the next rank needs (100 × rank number: G→F 100, F→E 200, ...).
- **A challenge breaks them through.** Once ready, they rise only by overcoming something at least their own rank: beating (or driving off) an opponent of their rank or higher (your rank comes from your level: 1 → G, 2 → F, 3 → E, 5 → D, 7 → C, 10 → B, ...), or making a piece of that tier or better. Teaching and daily life never raise a rank. A rank adds max HP (and MP) and +1 to their two best attributes, and the NPC remembers how they did it.
- **Titles** ([`src/game/titles.ts`](packages/server/src/game/titles.ts)) are earned by deeds, in code: *Giant-slayer* (beat a foe 2+ ranks above, +1 willpower), *Death-cheater* (won a fight at 15% HP or less, +1 endurance), *Veteran* (5 fights won, +1 strength), *Master Artisan* (made an A-tier piece, +1 intelligence), and *the Renowned / Hero / Legend / Myth* for ranks A, S, SS and SSS. The NPC hears its titles every turn.
- **You earn titles too**, from the same table, with the bonus added to your attributes: *Giant-slayer* (kill, rout or make beg a foe 2+ ranks above your rank), *Death-cheater* (win at 15% HP or less), *Veteran* (5 fights won), *the Reliable* (5 quests finished, +1 charisma), and the rank titles as your level climbs. Winning means the opponent died, ran or begged, against an NPC or a creature. `/quests` shows your rank and titles, and NPCs are told what you're known as ("Traveler is known as Giant-slayer.").
- **Species set the limits.** Each NPC and creature has a species ([`src/world/species.ts`](packages/server/src/world/species.ts)): human, elf, dwarf, halfling, orc, wolf, horse, bear. A species caps every member's potential (wolves top out at B, horses at D), how fast they learn, and how long they live.
- **Age is a stat.** NPCs age on the world calendar (`DAYS_PER_YEAR`, default 12 in-game days per year). Young ones learn faster but are weaker; from elder age (60 for humans) strength, agility and endurance fade, willpower and intelligence rise a little, max HP drops, and learning slows. Pell, at 68, is already an elder.
- **Natural death.** Past elder age, each midnight there's a small chance they die in their sleep, rising with age and certain at the species' max age (95 for humans). It's permanent, recorded like a killing (`killedBy: "old age"`).
- The NPC sees one line about itself each turn: "You: 68-year-old human (getting old), rank E." (plus ", known as Veteran" once it has titles).

### Creatures (non-talking NPCs)
- **Stat blocks with no model:** wolves, bandits, a horse and villagers ([`src/data/creatures/`](packages/server/src/data/creatures/)). Each has stats, skills, a natural attack or weapon, a loot table, and pre-written barks instead of speech. A new world spawns 3 wolves, 3 bandits and a horse; they're saved in `world.creatures`.
- **They live by the same rules:** they age, earn XP, need a challenge to rank up, earn titles, and die of old age. `/creatures` lists them with their growth.
- **They grow without you**, all rolled in code ([`src/game/creatures.ts`](packages/server/src/game/creatures.ts)):
  - **Hunts and raids:** each day a wolf may hunt a deer (rank F) or a wild boar (E), and a bandit may raid a merchant cart (E). Success is a challenge at that rank; failure costs a fifth of their HP.
  - **Rivalry:** some days two of a kind fight for dominance (wolves often, bandits rarely). Nobody dies; the winner overcame the loser's rank.
  - **Hard winters:** at the turn of a year, sometimes (35%). Every creature rolls endurance: surviving it is a challenge at their own rank; failing costs half their HP, and kills the very old.
  - **Newcomers:** when a kind is below its starting numbers, a young one may arrive each day.
  - In the browser, the big news (breakthroughs, titles, deaths, winters, newcomers) shows in the side feed.
- **Rook, the bandit leader, is a full NPC** at his camp at the north end of the mine road, mixed in with bandit stat blocks. He holds Brena's father's hammer: buy it back, talk him round, or kill him and take it (and his purse). Taking Brena's "My father's hammer" brings three of his men out to guard him.
- **Spawn rules** ([`src/data/spawns.json`](packages/server/src/data/spawns.json), [`src/game/spawning.ts`](packages/server/src/game/spawning.ts)) bring more out by place, time, event or quest: a crowd of villagers in the square by day, wolves at the forest edge at night, a bandit after the cart attack, three bandits once you take Hale's quest. Each group turns up once per window; when the window ends, survivors move on.
- **Fighting them** runs entirely in code, no model: your swing, their morale, their bite. Kills drop loot; a creature that beats you or drives you off grows from it.
- **Their gear wears like yours.** Each bandit has his own cudgel and leather armour, which wear with every blow (in fights with you, rivalry duels and cart raids) and drop as they are when he dies, along with his purse and anything he stole. Bandits have no smith: what breaks stays broken, and a bandit without a working weapon fights with his fists. Teeth and claws aren't gear: they never wear from fighting and can't be mended, but they dull with age (elder animals bite for 1 less, very old ones for 2).

### The underworld ([`src/game/underworld.ts`](packages/server/src/game/underworld.ts))
Every night at 02:00, rolled in code:
- **The black market:** a bandit whose weapon is broken or gone tries to buy one, in secret, from a villager dishonest enough to deal (honesty under 0.5) who has one he can wield. The gang pays 1.5× the price from its purses, which cart raids fill. Brena won't; Hale, who stocks and buys daggers, will. The seller remembers it; you only hear a rumour. Selling daggers to Hale can arm the bandits.
- **Raids:** when at least 3 armed bandits clearly outmatch a shop's defenders (the shopkeeper plus any NPC with `"guard": true`, so Hale), they may band together and raid the richest shop. The fight wears everyone's gear. Winners carry off up to 3 pieces (gear first, then the dearest goods), arming themselves with weapons they can use, and a quarter of the shop's money; kill them to get it back. Losers run (and come back the next day); some may die. Villagers are beaten, never killed. Both sides gain XP and challenges, and the people involved remember it.
  - **XP for you:** a kill is worth 40% of a quest of the creature's rank (a rank-F wolf: 20 XP), halved for each rank it's below yours; running one off is worth half. It can level you up (and earn rank titles).
  - **Browser:** wolves roam the south-east meadow, bandits the north road, a horse by the inn. Each shows its rank. **Wolves and bandits jump you when you come close.** `F` (or click) to fight, `R` to run; you can't walk off or wait mid-fight. One you escaped from leaves you be for 30 minutes.
  - **Terminal:** `/hunt <creature>` swings once, `/escape <creature>` runs.
  - **If one drops you**, the same `PLAYER_DEFEAT` rule as NPCs: knocked out for 8 hours and wake at 25% HP (bandits take a quarter of your money; the creature goes off with its prize until the next day), or permadeath.

### Heal
- **Everyone heals with time:** a little HP and MP each hour, more while asleep (21:00–6:00), and more with high endurance (HP) and willpower (MP). Nobody heals mid-fight.
- **Healing items:** `wild herbs` heal 5 HP, a `healing salve` 20 (higher tiers heal more). Pell sells salves and mixes more from herbs. `/use <item>` uses one of yours; mid-fight it costs your turn.
- **NPCs treat themselves** when below half HP, if they have something: in a fight they use it instead of attacking.
- **Below half HP an NPC won't trade or teach** until they've healed.

### Know each other, and talk about you (N7: [`social.ts`](packages/server/src/npc/social.ts), [`gossip.ts`](packages/server/src/game/gossip.ts))
- **NPC-to-NPC relationships** on the same four axes, from each NPC file (`relationships`): Brena and Pell are friends, Pell fears Rook, Hale and Brena don't think much of each other. Suppers, trade and time together warm them a little.
- **Gossip:** NPCs at the same place pass on what they know: your name, what you did to them (an attack, a theft, a kindness), rumours about each other, and news. Listeners believe friends more. Hear that you hurt a friend and trust drops hard.
- **Witnesses:** whoever was there when something happened saw it, and remembers. Only witnesses know at first; gossip spreads it.
- **Reputation** ([`reputation.ts`](packages/server/src/game/reputation.ts)): every NPC who learns what you did moves the town's view of you (trust, fear, respect, liking). Strangers start from half of it, plus respect for deed titles. `/reputation`.
- **Wary prices:** someone who distrusts you, or whose faction you've crossed, charges more (up to 40%) and pays less.
- **Rumours about NPCs** ([`rumours.ts`](packages/server/src/game/rumours.ts)): what folk say about someone (`reputationFacts`: true, exaggerated or false), lose accuracy each retelling. Ask Pell for gossip and he'll tell you Brena's a thief; ask Brena and she denies it, angrily. Your journal notes which turned out true.
- **Crime** ([`crime.ts`](packages/server/src/game/crime.ts)): attacking, killing, stealing or looting a villager is a crime once a guard knows (he saw it, or heard). There's a bounty; Hale brings it up, won't deal with you, and at a high enough bounty tries to arrest you. `/payfine` or `/surrender` (hours in the cells) to a guard. Hurting bandits isn't a crime.
- **Moral dilemmas** ([`dilemmas.ts`](packages/server/src/game/dilemmas.ts)): Hale offers a cut to look the other way while a smuggler's cart goes through; once Brena has told you about the key, she asks you to lie to the mayor. Each choice has code-set effects (money, trust, fear, faction standing). Choose with the buttons or `/choose <option>`.
- **Factions** ([`src/data/factions/`](packages/server/src/data/factions)): the village guard, the merchants, Rook's gang. What you do to a member moves your standing with their faction, and with their rivals the other way. Ranks, a member's discount, quests for friends only, wary members when you've crossed them. `/factions`, `/join <faction>`.
- **Death has consequences** ([`succession.ts`](packages/server/src/game/succession.ts)): your jobs for them fail, it's news to everyone, friends grieve, and if you did it, friends turn on you. Brena's apprentice **Wren** takes over the forge, most of the stock and her unfinished work, and won't serve Brena's killer, ever.
- **Theft and stealth** ([`stealth.ts`](packages/server/src/game/stealth.ts)): `/steal <item>` rolls agility + sneak against their perception: easy while they're busy at work, easier asleep, hard face to face, harder with others watching. `/sneak` first helps. Get caught and it's anger, a grudge, and a crime. Stolen goods are remembered: wear them in front of the owner, or sell them to the owner or a friend, and you may be found out.

### Fight with style, and get hurt (N8)
- **Combat styles** from traits ([`abilities.ts`](packages/server/src/game/abilities.ts)): aggressive (Brena: heavy blows, a war cry against anyone who outranks her), cautious (guards and catches breath when hurt), cowardly (Hale and Pell: dirty tricks, a salve if they have one, then begging at half health). Code picks every move; the model only talks.
- **MP abilities** for NPCs and you: heavy blow, quick strike (opens a bleeding wound), war cry (weakens), guard (halves the next blow), second wind (heals), dirty trick (stuns). From your skills; `/ability <name>` (shows yours) or Ability… in a fight. MP comes back with rest.
- **Status effects** ([`status.ts`](packages/server/src/game/status.ts)): bleeding, stunned, weakened, on guard. They tick each turn and show as words.
- **`/subdue`** knocks someone out instead of killing them: they come round hours later with a grudge. **`/loot <npc>`** takes from the knocked-out or the dead; it's a crime if anyone sees.
- **Lasting injuries and illness** ([`health.ts`](packages/server/src/game/health.ts)): a burned hand (−2 smithing), a broken arm, a deep cut... from hard blows or a slip at the forge. They heal a day at a time, faster when tended, and the sufferer asks for the cure. Brena starts with a burned hand: her work is worse until you bring the herbs for "Herbs for a burn". Fevers and winter coughs are caught at night (more in winter), sap energy and work, and spread to those who share a place.
- **Companions** ([`party.ts`](packages/server/src/game/party.ts)): ask someone to come along ("Would you come with me? I can pay.") and, if they trust or respect you enough, they name a daily wage. They follow you, strike your foes each round, eat and sleep, and have loyalty: it rises with pay, falls when unpaid or when a fight goes badly. Two unpaid days and Hale walks off, or turns on you if he fears you more than he trusts you. `/party`, `/dismiss`.
- **Raids in your sight:** if bandits raid the shop you're at (lodging at the inn, say), you fight beside the defenders.

### Grow, and have goals (N9)
- **Quest goals**, each checked in code: `deliver`, `gather` (pick it yourself with `/forage` at a place), `craft` (make it yourself with `/craft` at the forge or the inn's kitchen), `talk_to` (carry a message; delivered when you talk to them), `defeat` (creatures), `defeat_npc`, `escort` (bring the horse to the gate before the deadline; on the map it follows you).
- **Chains and deadlines:** "My father's hammer" is three steps (ask Pell who has it, beat Rook, bring it home) and you can't skip ahead. A missed deadline fails the quest and costs trust and respect.
- **Generated quest write-ups:** need quests get a title and reason from the model (structured output, checked; invented names are refused), with the template as fallback.
- **NPC growth** ([`growth.ts`](packages/server/src/npc/growth.ts)): skills gain XP from work, but crossing a tier takes a trial (a fine piece, a hard fight won). Challenges in the NPC file (Hale: survive a fight → a little braver, win two → one-handed XP; Pell: clear his debt → more generous; Brena: five fine blades → stronger). Traits drift at most 0.05 an event, 0.1 a week, 0.2 a lifetime. NPCs post harder work as they rise in rank.
- **Your growth:** each level gives an attribute point (`/raise <attribute>`, or +1 buttons in the Character tab; endurance adds max HP). Skills improve by use too, but crossing a tier by use takes a hard success.
- **Personal arcs** ([`arcs.ts`](packages/server/src/npc/arcs.ts)): Brena's "what happened to Tomas" moves from no news → a rumour (tell her what Pell knows) → a clue (ask Hale at the gate) → the truth (what Rook hides), unlocking quests on the way.

### Run an economy (N10, [`economy.ts`](packages/server/src/game/economy.ts))
- **Better materials, better work:** the output tier is the item's base, plus a skill roll, plus what the inputs bring. Orders get the best ore in the chest. Give Brena ore [D] and commission a sword.
- **Prices follow stock:** the last copies of something a maker can't make more of (no materials) cost 25% more; a pile of it costs less. Village demand differs by item (horseshoes always sell, chain mail rarely).
- **Restocking:** NPCs short of materials buy from whoever sells them at the same place, and from a travelling trader on market day (no ore while the mine road is shut).
- **Commissions by talk:** ask Brena to make something to order and she offers it (`offer_commission`); the game sets price, deposit and time.

### The world tells its own stories (N12, [`src/director/`](packages/server/src/director))
- **The event log** keeps who did what to whom, where, and who saw it; checked on load. The save keeps the 300 most important; the database keeps all of them.
- **Revenge as a goal** ([`revenge.ts`](packages/server/src/director/revenge.ts)): attack or rob someone and they want revenge, acted on the next night in their own way: Brena confronts you, Hale spreads lies about you, Rook sends men to ambush you on the road. It fades at their forgiveness; amends clear it.
- **The nightly chronicle** ([`chronicle.ts`](packages/server/src/director/chronicle.ts)): at midnight the day's biggest events each get one small director call with tools (`add_news`, `add_lore`, `propose_quest`, `propose_trait_shift`). The director proposes; [`validator.ts`](packages/server/src/director/validator.ts) decides: new ids only, no invented names, no near-duplicates, quests only with checkable goals and rewards from the giver's purse, trait shifts only for someone in the event and within the caps. Witnesses know new lore for certain; everyone else as a rumour. News expires after a few days. `/chronicle` and the World tab show it.

### Grow the cast: templates, a child, and families (N11)
- **NPCs from templates** ([`templates.ts`](packages/server/src/npc/templates.ts), [`src/data/templates/`](packages/server/src/data/templates)): a template gives ranges for age, rank, traits, attributes, skills, stock, money and prices, plus a schedule and voices. Code rolls them with a seeded RNG (the same seed always gives the same numbers); the model writes only the name, personality, speech, backstory, looks and goals, through Ollama's `format` and a schema. A bad answer, a taken name, or (for a child) anything adult is a failure: one retry, then the template's own words. Personality words that the rolled traits contradict ("brave" with low bravery) are dropped. `npm run gen -- farmer` writes an ordinary NPC file; generated NPCs get a map spot at their workplace automatically.
- **Pip, a child** ([`pip.json`](packages/server/src/data/npcs/pip.json)): ten years old, runs errands round the square (two small quests) and knows the news for certain and everything else as rumour. A minor (design rule 7): never romance (the schema, the rules and the prompt all refuse it), never attacked (`minorsCanBeAttacked` is off), and never starts a fight either (no `attack_player` tool for a minor).
- **Courtship and marriage** ([`family.ts`](packages/server/src/game/family.ts)): each midnight, two unmarried NPCs of courting age (two years after they're grown: 18 for humans) who like (affection 50+) and trust (20+) each other both ways, aren't kin, are no more than 15 years apart and haven't sworn off love (`romance.open: false`) start walking out together. Each night they grow closer; after six nights they marry. A quarrel ends it. Weddings are news for the whole village and a memory for both. Time together (an evening at the inn, a day at the square) slowly builds affection and some trust between NPCs who aren't enemies, so new couples form over weeks of play. NPC files can start a world married (`spouse`, both ways). Turn it off with `NPC_MARRIAGE=off`.
- **Marrying the player** (`/propose`, or the *Ask to marry* button): only with `ROMANCE=on`, an NPC open to romance, at the last romance stage, and neither of you married. The NPC answers in their own words; code already decided.
- **Children**: a married couple, both adults, may start expecting (15% a night) up to three children, with 12 days' rest between, while the town has fewer than 14 living NPCs. The child is born nine days later as a new NPC (their file lives in the save): a baby at home, then at five a child who runs errands round the square (the model writes their personality and voice then, from what they inherited), then grown at their species' adult age. A child of the player counts too. Pip, a child from the files, grows up the same way (her grown file is kept in the save).
- **What runs in the blood**: attributes are the parents' average, give or take 2; traits are a blend, nudged a little; potential follows the stronger parent, give or take a rank. Each parent's skills at tier 2 or better may pass on as **talents** (40% at tier 2 up to 100% at 5, three at most): talents learn 1.5x faster, and on growing up the child comes into half the parent's tier. A grown child takes up the working parent's trade and hours, and if a parent dies with no successor named, the eldest grown child inherits the stock and purse.
- **What they say about it**: a family line ("Your husband is Corporal Hale. Your children: Tam (6), Pip (a baby).") reaches the prompt only when the talk is about family or family is present (design rule 3). `/family` and the World tab list the town's marriages, courtships, children on the way and children.

### Remember the long run (optional items, [`db.ts`](packages/server/src/game/db.ts))
- **Conversation summaries** ([`summary.ts`](packages/server/src/director/summary.ts)): when old exchanges drop out of the context window, or a conversation ends, one structured call turns them into 1–5 short memories. They're marked, capped below any code event, never gossiped, and change no state.
- **Recall by meaning:** summaries go into a SQLite store with an embedding; when you talk to someone again, the old talks closest in meaning to what you just said come back to them ("From earlier talks with them you recall: ...").
- **Off-screen planning** ([`planning.ts`](packages/server/src/director/planning.ts)): once a day each NPC makes one short call to set its plans from its memories and goals. Flavour only: a situation line; code never acts on it.
- **Never in your way:** plans, summaries, quest write-ups and the chronicle run in the background on their own connection, and are cancelled (and retried later) the moment you act.

## Play in the browser (`npm run web`)

A top-down map of Millbrook where you walk and talk without the terminal. The server ([`src/web/server.ts`](packages/server/src/web/server.ts)) wraps the same `NpcAgent` and rules as the CLI, so everything above works; the browser ([`packages/client`](packages/client)) only draws and sends what you do.

- **Move** with WASD or the arrow keys, or click a tile to walk there (one game minute per step; the village keeps living as time passes). The tile under the mouse is outlined; the cursor changes over someone you can talk to or fight.
- **NPCs follow their day:** they walk between the forge, the inn, the gate, the square and the camp, and fade out indoors when they go home or to bed. Night darkens the map; rain, storms and snow fall when the weather says so.
- **Companions walk in your footsteps**, a tile or two behind you, and step aside when you turn back.
- **Talk** by clicking a villager, or press `E` next to one. They may speak first. Replies stream into the chat and into a speech bubble over their head as the model writes them; if someone else is nearby they may chime in, in italics. Walking away ends the conversation.
- **No dead air:** a "…" bubble shows the moment you speak. If the model hasn't said a word after 3 seconds (`FILLER_AFTER_MS`), the NPC says a short filler line from their file ("Hold on.", "Ah, now...") while it keeps thinking.
- **You see what happens** (typed events, below): a mood shows as an emote over their head (😊 😠 😨), coin and items float up from whoever gained or lost them, the Inventory tab glows when something lands in your pack, a hit flashes its target (and shakes the screen when it's you), and a new job offer gets a ❗.
- **Say it your way:** the dropdown next to the chat box switches between Say, Persuade, Intimidate, Haggle and Lie. Rolls show in the chat. Or **speak**: hold the 🎙 button (or `V` when you're not typing), talk, and let go.
- **Offers** (quests, sales, purchases, training, favours, amends, rooms and healing) appear as Accept/Decline cards. Nothing costs you until you accept.
- **Buttons:** Hand in quests, Train…, Wares, Repair…, Look, Introduce yourself, Give…, Ask a favour…, Order… / Collect order, Repay loan, Steal…, Pay fine / Give yourself up (at a guard), Dismiss (a companion), Flee, Ability… (in a fight), Subdue, Attack, and one-click opening lines. Dilemmas, hires and orders appear as cards. Click someone lying dead or out cold to loot them.
- **Side panel:** your look, attributes (with +1 buttons for level points), MP, statuses and ailments, skills, inventory, quests (and failed ones), your journal by NPC, and a World tab: reputation, bounty, factions (Join), who's travelling with you, and the chronicle. **Header:** clock, weather and season, HP, MP, money, Forage, Craft…, Sneak, Wait 1h/4h, 🔊 Voices, New game, model status (and how many actions are waiting).
- **One thing at a time, in line:** on 8 GB Ollama runs one reply at a time, so the server queues actions ([`queue.ts`](packages/server/src/web/queue.ts)) instead of turning a second one away. Past 8 waiting it asks you to try again.
- Saves to the same `saves/world.json` as the CLI, after every action. `PORT=3001 npm run web` changes the port; `npm run web -- --new` starts fresh.
- Limits: there is no `/use` button yet, and the map is fixed (26×18 tiles, drawn in code: no image files).

**Typed events** ([`events.ts`](packages/shared/src/events.ts), [`turnEvents.ts`](packages/server/src/game/turnEvents.ts)): every action's stream ends with what changed, worked out by comparing the game state before and after (so every path reports the same way, model or not): `mood_changed`, `trust_changed`, `item_moved`, `gold_moved` (paired up: what you lost and the NPC gained went from you to them), `hp_changed`, `attack`, `quest_offered`, `npc_busy`, `npc_died`, `following`. The CLI prints them after each command as `[events] …`.

**The HTTP API** (types in [`protocol.ts`](packages/shared/src/protocol.ts)): `GET /api/state`, `POST /api/move`, `POST /api/act` (newline-delimited JSON: `text`, `filler`, `queued`, `note`, `system`, `event`, … then `done` with the new state), `GET /api/quote`, `POST /api/new`, `GET /api/voice`, `POST /api/speak`.

## NPC voices

NPCs can speak their lines aloud, sentence by sentence as the reply streams in ([`speaker.ts`](packages/client/src/voice/speaker.ts)): the first sentence plays while the model writes the next. Stage directions (`*wipes her hands*`) aren't read out. Talking (or speaking into the mic) cuts them off. 🔊 Voices in the header turns them off, sets the volume and lets you hear each NPC.

- **By default the browser speaks**, with its own voices: no download and no memory next to the language model. Each NPC file says how they sound, and the browser picks the first preferred voice it has, else one in their language and gender (on-device voices first), a different one per NPC where it can:

  ```json
  "voice": { "lang": "en-GB", "pitch": 0.85, "rate": 0.95, "gender": "female",
             "browser": ["Serena", "Martha", "Google UK English Female"],
             "piper": { "model": "en_GB-semaine-medium", "speaker": 0, "lengthScale": 1.05 } },
  "fillerLines": ["Hm.", "Hold on.", "Let me think."]
  ```

- **Optionally, Piper** (a small local neural voice) for voices that sound the same on every machine. The server then makes the audio (`POST /api/speak`, cached), and falls back to the browser for a line it can't make. One multi-speaker model (`en_GB-semaine-medium`, four speakers: 0 Prudence, 1 Spike, 2 Obadiah, 3 Poppy) covers the whole cast, so only one voice model is in memory:

  ```bash
  npm run voices:install    # once: .venv-piper/ and voices/en_GB-semaine-medium
  npm run web:voices        # or: npm run dev -- --voices
  ```

  Then 🔊 Voices → "Use the server's Piper voices" (on by default when Piper is up). To run Piper yourself, `npm run voices` and start the game with `PIPER_URL=http://127.0.0.1:5055/synthesize` (or put that in `.env`). Without a server, `PIPER_BIN` can point at the standalone `piper` program from Piper's releases (run once per sentence, so slower: the model loads each time), with the `.onnx` and `.onnx.json` files in `voices/`.

  **What it costs** (`npm run bench:voice`, 8 GB M2, model loaded): 0.1–0.6 s per sentence, about a tenth of the time it takes to say it, so the next sentence is always ready; ~270 MB of memory; no clear slowdown to the language model. On 8 GB with a browser open that memory is the real cost, which is why the browser's voices are the default.
- **Speaking to NPCs** (push-to-talk, [`mic.ts`](packages/client/src/voice/mic.ts)) uses the browser's speech recognition, so no second model shares the 8 GB. It asks for on-device recognition where the browser has it; otherwise the browser's own speech service hears the audio (Chrome sends it to Google). Chrome, Edge and Safari have it; Firefox doesn't, and the 🎙 button stays hidden. With "Send what I say straight away" off, the words wait in the box for you to check.

## Commands (terminal)

| Command | |
|---|---|
| *(anything else)* | Say it to the NPC you're with (name someone here to talk to them instead) |
| `/go <place>`, `/where` | Walk to the forge, inn, square, gate or camp; see where everyone is |
| `/to <npc>` | Turn to someone here |
| `/look [npc\|me]` | How they (or you) look right now. No model call |
| `/introduce` | Tell them your name |
| `/give <item\|money>` | Give a gift: `/give stew`, `/give 5 silver` |
| `/lie <claim>` | Tell a lie (rolled) |
| `/ask <favour> [item]` | Ask a favour: `lend_gold`, `vouch`, `hide_item <item>`, `warn_me` |
| `/repay`, `/retrieve` | Pay back a loan; take back what they hid for you |
| `/commission <item>`, `/collect` | Order something they make (asks first); pick it up |
| `/journal [npc]` | What you've learned, by NPC |
| `/haggle <words>` | Haggle over price |
| `/persuade <words>`, `/intimidate <words>` | Social checks |
| `/attack`, `/flee` | Fight, or run from a fight |
| `/train <skill> [hours]` | Pay for a lesson (asks first) |
| `/turnin` | Hand in finished quests |
| `/wait <hours>` | Let time pass: you rest and heal, and the whole village lives those hours |
| `/use <item>` | Use a healing item from your inventory |
| `/gear` | What you wear and carry: equipment, durability, pack slots |
| `/equip <item>`, `/unequip <weapon\|armor>` | Equip gear from your pack (if your level allows), or put it away (if there's room) |
| `/repair <weapon\|armor\|item>` | Pay a smith to mend gear (asks first) |
| `/quests` | Your level, XP and active quests |
| `/skills` | Your skills, and what this NPC can teach and for how much |
| `/creatures` | Every creature in the world: age, rank, growth, HP |
| `/hunt <creature>`, `/escape <creature>` | Fight a creature (one round), or run from it. No model involved |
| `/steal <item>`, `/sneak` | Try to lift something from the NPC you're with; try to move unseen here |
| `/loot <npc> [item]` | Take from someone dead or knocked out (a crime if seen) |
| `/subdue`, `/ability <name>` | Fight to knock out, not kill; use an MP ability (`/ability` lists yours) |
| `/choose <option>` | Answer a dilemma an NPC put to you |
| `/payfine`, `/surrender` | Settle a bounty with a guard: coin, or hours in the cells |
| `/factions`, `/join <faction>`, `/reputation` | Standing with the guard, the merchants and Rook's gang; join one; how the town sees you |
| `/party`, `/dismiss [npc]` | Who's travelling with you; let a companion go |
| `/forage`, `/craft <item>` | Gather where things grow (by the gate); make something yourself (smithing at the forge, the rest at the inn) |
| `/raise <attribute>` | Spend a level's attribute point |
| `/chronicle` | What the world director recorded lately, and why proposals were turned down |
| `/family` | Marriages, courtships, children on the way, and the children born in play, with their gifts |
| `/propose` | Ask the NPC you're talking to to marry you (needs `ROMANCE=on`, and being together) |
| `/state` | Everything about you and the NPC (debug) |
| `/trust <n>` | Set trust (testing shortcut) |
| `/save` | Save now (it also saves after every action) |
| `/quit` | Leave |

Free commands (`/state`, `/quests`, `/where`, `/go`, `/look`, `/journal`, `/wait`, `/use`, `/save`, `/factions`, `/reputation`, `/raise`, `/join`, `/party`, `/dismiss`, `/chronicle`, `/family`, `/forage`, `/craft`, `/sneak`, `/loot`) work even when the NPC is busy or not there.

## Adding an NPC

The quick way: `npm run gen -- <template>` (see N11 above), then edit the file if you like. By hand: create `src/data/npcs/<id>.json` (copy [`brena.json`](packages/server/src/data/npcs/brena.json)) and run it with `npm run chat -- <id>`. The tests and `npm run check-npcs` check every file in that folder, and the CLI and web server won't start if one fails. In the browser game an NPC with no spot in [`src/web/map.ts`](packages/server/src/web/map.ts) stands on a free tile near each place; to choose where, add them to `NPC_SPOTS` and `PLACE_SPOTS`.

| Field | Notes |
|---|---|
| `species`, `age`, `tier`, `potential` | Species (default `human`, must be one that talks), age in years at the start, starting rank, and the highest rank they can ever reach (same as `tier` = never grows) |
| `name`, `role`, `personality`, `speechStyle`, `backstory`, `goals` | Goes into the system prompt. Don't put secrets here (including in `goals`) |
| `knows` | Which lore from [`world.json`](packages/server/src/data/world.json) they know: `{ "millbrook.*": "certain", "people.tomas.sighting": "rumour" }`. An exact id, `x.*` (x and everything under it) or `*`; the most specific wins. A scope that matches nothing fails to load |
| `greed` (0–1), `greedWhenDebtFree` | Marks up training fees and marks down buy prices at low trust |
| `traits` | `temper`, `bravery`, `honesty`, `generosity`, `sociability`, `forgiveness`, each 0–1 (missing ones are 0.5). See "Have a personality" above |
| `fallbackLine` | Optional. What they say if the model fails twice in a row |
| `stats` | `maxHp`, `maxMp` and 8 attributes (1–20) |
| `skills`, `teaches` | Tiers 0–5. `teaches` is their one trainable skill (defaults to their best) |
| `weapon`, `armor` | Items from [`ITEMS`](packages/server/src/game/items.ts): a weapon, and optional armour, both at or below the NPC's `tier` |
| `storage` | Optional. A shopkeeper's chest or bag: `{ "name": "the forge chest", "slots": 12 }`. Their starting inventory must fit pack + storage |
| `startingInventory`, `prices`, `buys`, `startingMoney` | Item names, optionally with a tier: `"iron sword [B]"`. Amounts (`prices`, `startingMoney`, quest `reward.money`, debts) are coin phrases like `"1 gold 5 silver"` or `"15s"`, or whole copper |
| `secrets` | `{ id, about, text }`. `about` is a vague hint the model sees at high trust. Optional `cover` (the story they tell instead), `keywords` and `breaksWith`: `[{ "item": … }, { "fact": "pell.hale_cellar" }, { "check": "intimidate" }]` |
| `appearance` | What they look like; wounds, soot, weapons and tiredness are added in code |
| `quirks` | `[{ "when": { "activity": ["work"], "topic": ["sword"] }, "line": "…" }]`. Conditions: `activity`, `place`, `topic`, `nearby` (NPC ids), `mood`, `hours`, `hurt`; all must hold |
| `fears`, `loves` | `[{ "name": "the mayor", "words": ["mayor"], "item"?, "minTier"?, "npc"? }]` |
| `schedule` | `[{ "from": 6, "to": 20, "activity": "work", "place": "forge" }, …]` covering all 24 hours. Activities: `work`, `eat`, `socialise`, `sleep`, `travel`; places: `forge`, `inn`, `square`, `gate`, `camp`, `home` |
| `signature` | `{ "trigger": "good_work_day" \| "trusted_regular", "effect": "masterwork" \| "hidden_stock", "items"?, "minTrust"?, "describe" }` |
| `services` | `[{ "kind": "lodging", "price": "8 silver" }]`: `heal` and `lodging` need a price |
| `minor`, `romance` | `minor: true` rules out romance (the schema refuses `romance.open` or a `spouse` on a minor), being attacked (by default) and starting fights; the lint refuses a minor who's a guard, a hireling or in armour. `romance.open: false` also means they never court other NPCs |
| `spouse`, `parents`, `talents` | Family (N11.3): married at the start (the spouse must name them back); parents' ids (`"player"` allowed), so kin never court; skills that come easily (1.5x skill XP). Children born in play also get `inherited` and `bornOnDay` |
| `template` | The template the NPC was made from, if any |
| `debts`, `reserveMoney` | Optional. Paid down automatically from earnings |
| `dropsOnDeath` | Optional. Killed by the player, they drop their pack and purse (the bandit leader). Leave it off for shopkeepers |
| `maxQuestTier`, `quests` | Highest tier they give, and written quests. Goals: `deliver`, `defeat` (creature kind), `defeat_npc`, `gather` (item, place), `craft` (item, `minTier`), `talk_to` (npc, message), `escort` (who, to). Optional `requires` (a chain), `deadlineHours`, `cures` (an injury the delivery heals), `minStanding` (with their faction) |
| `relationships` | How they feel about other NPCs: `{ "pell": { "trust": 30, "affection": 40 } }` |
| `reputationFacts` | What folk say about them: `{ id, text, truth: "true" \| "exaggerated" \| "false", keywords, knownBy?, correction? }` |
| `dilemmas` | `{ id, offer, keywords, minTrust?, afterSecret?, options: [{ id, label, effects: { trust?, fear?, respect?, affection?, money?, items?, standing?, reputation?, memory } }] }` |
| `faction`, `successor`, `successorOf` | Faction id (or list them as members in `src/data/factions/`); who takes over when they die; a successor waits out of the world until then |
| `hire` | `{ "wage": "10 silver", "minTrust"?, "minRespect"? }`: they'll come along as a companion |
| `growth` | Challenges: `{ id, describe, trigger: { kind: "craft" \| "debt_cleared" \| "survive_fight" \| "win_fight" \| "sell" \| "quest_done", ... }, improves: { skill?, attribute?, trait? }, repeat? }` |
| `arcs` | Personal goal arcs: `{ id, name, stages: [{ id, line, requires?: { told?, fact?, quest?, day? }, unlocks?, journal? }] }` |
| `injuries` | Injuries they start with (`burned_hand`, `broken_arm`, ...) |

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
    knowledge.ts      world lore: scopes, keyword lookup, events, the invented-name check
    memory.ts         witnessed facts that fade, and recall
    relationship.ts   trust, fear, respect, affection; grudges, friendship, romance and content rules
    emotions.ts       lasting feelings, and the mood they settle into
    secrets.ts        cover stories and what breaks them
    quirks.ts         habits shown when their condition holds
    names.ts          learning the player's name, and hiding it from the model until then
    appearance.ts     how NPCs and the player look, and what NPCs notice
    triggers.ts       fears, loves and gifts
    initiative.ts     when an NPC speaks first
    moodPrefix.ts     strips "Annoyed." when the model writes its mood instead of calling the tool
    traits.ts         personality traits and the rule each one drives (plus drift from growth)
    social.ts         how NPCs feel about each other
    growth.ts         skill XP and trials, attribute milestones, capped trait drift; the player's growth
    arcs.ts           personal goal arcs and what each stage unlocks
    templates.ts      NPCs from templates: seeded numbers, model-written words, template fallback (N11.1)
    lint.ts           the authoring check (T5): what the schema can't see
    skills.ts, stats.ts, state.ts, types.ts
  game/               rules that don't need the model
    dice.ts items.ts training.ts quests.ts levels.ts crafting.ts
    simulation.ts clock.ts debts.ts deaths.ts healing.ts save.ts
    money.ts          copper/silver/gold: formatting, reading coin phrases, the data schema
    life.ts           ranks, potential, challenges, age stages and natural death, for NPCs and creatures
    titles.ts         titles earned by deeds, and their bonuses
    gear.ts           equipment, gear level, durability and repairs, pack slots and storage
    creatures.ts      non-talking NPCs: templates, spawning, code-only fights, gear and loot
    spawning.ts       spawn rules: creatures by place, time, event or quest
    underworld.ts     at night: bandits buying weapons on the black market, and raids on shops
    events.ts         the event log
    schedule.ts needs.ts village.ts   places, schedules, hunger and energy, the village living together
    gossip.ts         what NPCs tell each other: deeds, rumours, news; what witnesses remember
    rumours.ts reputation.ts crime.ts factions.ts dilemmas.ts stealth.ts succession.ts   the social web (N7)
    abilities.ts status.ts health.ts party.ts loot.ts   fighting, injuries and illness, companions (N8)
    gathering.ts      the player's own foraging and crafting
    economy.ts        stock and demand prices, restocking, village demand (N10)
    family.ts         courtship, marriage, children, inheritance and growing up (N11.3)
    town.ts           the town as a whole: time passing and its consequences, shared by CLI and browser
    db.ts embeddings.ts   the long-term SQLite store and recall by meaning
    scene.ts          group conversations: who's addressed, who chimes in
    favours.ts commitments.ts commissions.ts services.ts deception.ts journal.ts
    signature.ts      each NPC's signature move
    weather.ts events-calendar.ts   seasons, weather, market days, festivals, raid days
  director/           the world director: chronicle.ts, validator.ts, revenge.ts, and background work
                      (planning.ts, summary.ts, flavor.ts, background.ts, structured.ts)
  data/npcs/          brena.json, pell.json, hale.json, rook.json (the bandit leader), wren.json (Brena's successor), pip.json (the errand girl)
  data/templates/     farmer.json, guard.json, merchant.json, child.json (N11.1)
  data/factions/      guard.json, merchants.json, bandits.json
  data/creatures/     wolf.json, bandit.json, horse.json, villager.json
  data/world.json     world lore: places, people, history, news
  data/spawns.json    spawn rules
  world/world.ts      demo world, player and starting creatures
  world/species.ts    species: lifespans, rank caps, learn rates
  web/
    server.ts         HTTP server for the browser game: state, movement, streamed NPC turns
    map.ts            Millbrook tile map, buildings and where each NPC stands
web/                  browser client (index.html, game.js, style.css), no build step
tests/                unit tests (fake model) + live.test.ts (real model)
scripts/bench.ts      behaviour pass rates against the real model
scripts/bench-traits.ts  do attack and flee rates follow traits? (real model)
scripts/sim.ts        trait rules with seeded dice and a scripted model
scripts/bench-director.ts  the world director against the real model
scripts/generate-npc.ts  npm run gen: a new NPC file from a template (N11.1)
scripts/check-npcs.ts    npm run check-npcs: the authoring check (T5)
scripts/bench-style.ts   npm run bench:style: the blind voice test and consistency checks (T15)
```

See [ROADMAP.md](ROADMAP.md) for what's done and what's next.
