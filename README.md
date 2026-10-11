# llm-game: LLM-driven NPCs

RPG characters that talk with a local language model (Ollama), and act in the game through tools the game checks.

**The core rule:** the model does the talking and *proposes* actions. The game's code decides what actually happens: every price, dice roll, trade, secret and quest is checked or worked out in code. The model is never trusted to keep track of state or do maths.

## Run it

```bash
npm install
ollama pull qwen3:4b-instruct   # once; Ollama must be running
npm run web                     # play in the browser at http://localhost:3000
npm run chat                    # start at Brena's forge
npm run chat -- pell --name=Ash # start at Old Pell's inn, as Ash
```

| Script | What it does |
|---|---|
| `npm run web` | Play in the browser: walk around Millbrook and talk to everyone (`PORT=3001` to change port, `-- --new` for a fresh game) |
| `npm run chat [-- <npc>] [--name=<you>]` | Play in the terminal, starting where that NPC is |
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
- Each turn they're told what's true right now in a `<situation>` block: the time, place, recent news, their mood, HP, how much they trust you, and your money. Stock, your items, what they can teach and their quests are only added when you talk about trade, training or work. Showing everything every turn made the small model noticeably worse.
- Remember earlier lines in the conversation. Long conversations drop their oldest exchanges to stay inside the model's context window (about 3,000 tokens), so the system prompt is never lost.
- The world is saved to `saves/world.json` after every action (`--new` starts fresh).

### Have a personality that changes the rules
Each NPC file has `traits` from 0 to 1. The model only sees them as words ("quick-tempered, cowardly"); the numbers drive rules in [`traits.ts`](src/npc/traits.ts):

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
- **Four relationship axes** ([`relationship.ts`](src/npc/relationship.ts)), all moved in code:
  - **Trust** (−100 to 100): unlocks secrets, gifts, training tiers and hidden quests.
  - **Fear** (0 to 100): from threats, attacks and your rank above theirs. A won intimidation only buys a discount if they're scared enough; brave NPCs are shaken, not cheaper.
  - **Respect** (−100 to 100): from finished quests and your rank. C-tier and higher quests, and expert and master training, need it.
  - **Affection** (−100 to 100): from time together, gifts and help. Friends give 10% off, close friends 15%. Romance is off unless you set `ROMANCE=on`, and never with an NPC marked `minor`.
- **Memory** ([`memory.ts`](src/npc/memory.ts)): what you did is written down by code (an insult, a purchase, an attack, a quest), with an importance that fades; bad memories fade at their `forgiveness`. The three that weigh most come up each turn: "Yesterday, they insulted you: …".
- **Lasting emotions** ([`emotions.ts`](src/npc/emotions.ts)): resentment, embarrassment, pride, gratitude, grief. An insult in front of others stings for days; a masterwork leaves them proud.
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

### Know only what the world says they know ([`src/data/world.json`](src/data/world.json))
- **One source of truth:** places, people (including ones you never meet, like the mayor and Tomas), history and news, each with an id like `people.mayor.household`.
- **Each NPC has knowledge scopes** (`knows`): which lore they know, and how sure they are (`certain` or `rumour`). Brena knows the mine road but not the mayor's household; Pell knows nearly everything, some of it only as rumour.
- **Code picks the lore your line is about** (by keyword, at most 3 lines a turn) and adds it to the situation block. **Nothing outside their scope is ever shown**, and asking about something they don't know gets a line telling them to say so, often with a lead ("Old Pell might know"). A name that isn't in the world at all ("the ruins of Kargoth") gets the same treatment.
- **Today's events are lore ids** (`world.recentEvents`), so NPCs only hear of events the game put there. Event entries (`"event": true`, like a raid) never come up from a keyword lookup.
- `npm run bench` flags any reply that names a person or place that isn't in the lore (`unknownNames` in [`src/npc/knowledge.ts`](src/npc/knowledge.ts)).

### Keep secrets
- A secret is **never in the prompt**, so at low trust they can't leak it, because they don't know it.
- Above trust 50 they get a `reveal_secret` tool, and only then are they told the secret to tell you in their own words.
- **Dishonest NPCs may lie** instead (rolled in code from `honesty`): they keep the secret and stick to their story until the next day.
- **Cover stories** ([`secrets.ts`](src/npc/secrets.ts)): some secrets have a `cover`. Hale tells you he was on patrol, however much he trusts you, until something breaks it: proof you carry, a fact you learned (Pell's own secret about who hid in his cellar), or beating him in a `/intimidate` that day. Then the truth comes out at any trust.

### Lie to them (`/lie <claim>`)
- Your charisma + speechcraft against their perception, plus insight (dishonest NPCs spot lies better), easier if they trust you.
- Believed: they take it as true (the game knows it isn't). Spotted: trust and respect drop, and they remember. A believed lie can come out later: each night there's a chance, more if it names someone they could check with.

### Ask favours (`/ask <lend_gold|vouch|hide_item|warn_me> [item]`)
- Code decides from trust, fear, respect and generosity, and sets the terms; you confirm. A loan is a promise to repay by a date (`/repay`): break it and they remember. Every favour leaves you owing one, and a day later they'll ask for it back.

### Keep promises, and make them keep theirs
- **Commissions** (`/commission <item>`, `/collect`): pay half up front and they make it in their working hours. They name a time from the work alone, so a late order can run late; then they apologise without being asked and take 20% off.

### Live a day ([`schedule.ts`](src/game/schedule.ts), [`needs.ts`](src/game/needs.ts), [`village.ts`](src/game/village.ts))
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
- **Coins:** copper, silver and gold. **1 gold = 10 silver = 100 copper.** A loaf of bread is 1 silver, a dagger 1 gold 5 silver, an iron sword 4 gold; you start with 5 gold. The game counts everything in copper ([`src/game/money.ts`](src/game/money.ts)), so sums and discounts are exact.
- **NPCs talk in coins.** The model is shown every price and purse as coins ("1 gold 5 silver"), and names prices in its tool calls the same way; the game reads them back into copper, and a bare number ("15") is sent back as unclear. In tests with `qwen3:4b-instruct`, Brena offered "2 silver" for a horseshoe on the first try.
- Each NPC has a purse. Your purchases, fees and their village sales go into it, and quest rewards come out of it.
- **Debts:** an NPC with a debt pays it down with anything above their reserve whenever they earn. Pell owes the mayor 20 gold.
- **Pell gets less greedy** once he's paid it off.
- Debts are secrets. The model only hears about one through `reveal_secret`, along with the current balance.

### Gear, durability and burden
Same rules for you and for NPCs ([`src/game/gear.ts`](src/game/gear.ts)).
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
- **Titles** ([`src/game/titles.ts`](src/game/titles.ts)) are earned by deeds, in code: *Giant-slayer* (beat a foe 2+ ranks above, +1 willpower), *Death-cheater* (won a fight at 15% HP or less, +1 endurance), *Veteran* (5 fights won, +1 strength), *Master Artisan* (made an A-tier piece, +1 intelligence), and *the Renowned / Hero / Legend / Myth* for ranks A, S, SS and SSS. The NPC hears its titles every turn.
- **You earn titles too**, from the same table, with the bonus added to your attributes: *Giant-slayer* (kill, rout or make beg a foe 2+ ranks above your rank), *Death-cheater* (win at 15% HP or less), *Veteran* (5 fights won), *the Reliable* (5 quests finished, +1 charisma), and the rank titles as your level climbs. Winning means the opponent died, ran or begged, against an NPC or a creature. `/quests` shows your rank and titles, and NPCs are told what you're known as ("Traveler is known as Giant-slayer.").
- **Species set the limits.** Each NPC and creature has a species ([`src/world/species.ts`](src/world/species.ts)): human, elf, dwarf, halfling, orc, wolf, horse, bear. A species caps every member's potential (wolves top out at B, horses at D), how fast they learn, and how long they live.
- **Age is a stat.** NPCs age on the world calendar (`DAYS_PER_YEAR`, default 12 in-game days per year). Young ones learn faster but are weaker; from elder age (60 for humans) strength, agility and endurance fade, willpower and intelligence rise a little, max HP drops, and learning slows. Pell, at 68, is already an elder.
- **Natural death.** Past elder age, each midnight there's a small chance they die in their sleep, rising with age and certain at the species' max age (95 for humans). It's permanent, recorded like a killing (`killedBy: "old age"`).
- The NPC sees one line about itself each turn: "You: 68-year-old human (getting old), rank E." (plus ", known as Veteran" once it has titles).

### Creatures (non-talking NPCs)
- **Stat blocks with no model:** wolves, bandits, a horse and villagers ([`src/data/creatures/`](src/data/creatures/)). Each has stats, skills, a natural attack or weapon, a loot table, and pre-written barks instead of speech. A new world spawns 3 wolves, 3 bandits and a horse; they're saved in `world.creatures`.
- **They live by the same rules:** they age, earn XP, need a challenge to rank up, earn titles, and die of old age. `/creatures` lists them with their growth.
- **They grow without you**, all rolled in code ([`src/game/creatures.ts`](src/game/creatures.ts)):
  - **Hunts and raids:** each day a wolf may hunt a deer (rank F) or a wild boar (E), and a bandit may raid a merchant cart (E). Success is a challenge at that rank; failure costs a fifth of their HP.
  - **Rivalry:** some days two of a kind fight for dominance (wolves often, bandits rarely). Nobody dies; the winner overcame the loser's rank.
  - **Hard winters:** at the turn of a year, sometimes (35%). Every creature rolls endurance: surviving it is a challenge at their own rank; failing costs half their HP, and kills the very old.
  - **Newcomers:** when a kind is below its starting numbers, a young one may arrive each day.
  - In the browser, the big news (breakthroughs, titles, deaths, winters, newcomers) shows in the side feed.
- **Rook, the bandit leader, is a full NPC** at his camp at the north end of the mine road, mixed in with bandit stat blocks. He holds Brena's father's hammer: buy it back, talk him round, or kill him and take it (and his purse). Taking Brena's "My father's hammer" brings three of his men out to guard him.
- **Spawn rules** ([`src/data/spawns.json`](src/data/spawns.json), [`src/game/spawning.ts`](src/game/spawning.ts)) bring more out by place, time, event or quest: a crowd of villagers in the square by day, wolves at the forest edge at night, a bandit after the cart attack, three bandits once you take Hale's quest. Each group turns up once per window; when the window ends, survivors move on.
- **Fighting them** runs entirely in code, no model: your swing, their morale, their bite. Kills drop loot; a creature that beats you or drives you off grows from it.
- **Their gear wears like yours.** Each bandit has his own cudgel and leather armour, which wear with every blow (in fights with you, rivalry duels and cart raids) and drop as they are when he dies, along with his purse and anything he stole. Bandits have no smith: what breaks stays broken, and a bandit without a working weapon fights with his fists. Teeth and claws aren't gear: they never wear from fighting and can't be mended, but they dull with age (elder animals bite for 1 less, very old ones for 2).

### The underworld ([`src/game/underworld.ts`](src/game/underworld.ts))
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

## Play in the browser (`npm run web`)

A top-down map of Millbrook where you walk and talk without the terminal. The server ([`src/web/server.ts`](src/web/server.ts)) wraps the same `NpcAgent` and rules as the CLI, so everything above works; the browser only draws and sends what you do.

- **Move** with WASD or the arrow keys, or click a tile to walk there (one game minute per step; the village keeps living as time passes).
- **NPCs follow their day:** they move between the forge, the inn, the gate, the square and the camp, and vanish indoors when they go home or to bed.
- **Talk** by clicking a villager, or press `E` next to one. They may speak first. Replies stream in as the model writes them; if someone else is nearby they may chime in, in italics. Walking away ends the conversation.
- **Say it your way:** the dropdown next to the chat box switches between Say, Persuade, Intimidate, Haggle and Lie. Rolls show in the chat.
- **Offers** (quests, sales, purchases, training, favours, amends, rooms and healing) appear as Accept/Decline cards. Nothing costs you until you accept.
- **Buttons:** Hand in quests, Train…, Wares, Repair…, Look, Introduce yourself, Give…, Ask a favour…, Order… / Collect order, Repay loan, Flee, Attack, and one-click opening lines.
- **Side panel:** your look, attributes, skills, inventory, quests and your journal by NPC. **Header:** clock, weather and season, HP, money, Wait 1h/4h, New game, model status.
- Saves to the same `saves/world.json` as the CLI, after every action. `PORT=3001 npm run web` changes the port; `npm run web -- --new` starts fresh.
- Limits: one action runs at a time, and there is no `/use` button yet.

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
| `/state` | Everything about you and the NPC (debug) |
| `/trust <n>` | Set trust (testing shortcut) |
| `/save` | Save now (it also saves after every action) |
| `/quit` | Leave |

Free commands (`/state`, `/quests`, `/where`, `/go`, `/look`, `/journal`, `/wait`, `/use`, `/save`) work even when the NPC is busy or not there.

## Adding an NPC

Create `src/data/npcs/<id>.json` (copy [`brena.json`](src/data/npcs/brena.json)) and run it with `npm run chat -- <id>`. The tests check every file in that folder. To see them in the browser game, also give them a spot in [`src/web/map.ts`](src/web/map.ts) (`NPC_SPOTS`, and `PLACE_SPOTS` for the places their schedule takes them); the web server refuses to start if an NPC has none.

| Field | Notes |
|---|---|
| `species`, `age`, `tier`, `potential` | Species (default `human`, must be one that talks), age in years at the start, starting rank, and the highest rank they can ever reach (same as `tier` = never grows) |
| `name`, `role`, `personality`, `speechStyle`, `backstory`, `goals` | Goes into the system prompt. Don't put secrets here (including in `goals`) |
| `knows` | Which lore from [`world.json`](src/data/world.json) they know: `{ "millbrook.*": "certain", "people.tomas.sighting": "rumour" }`. An exact id, `x.*` (x and everything under it) or `*`; the most specific wins. A scope that matches nothing fails to load |
| `greed` (0–1), `greedWhenDebtFree` | Marks up training fees and marks down buy prices at low trust |
| `traits` | `temper`, `bravery`, `honesty`, `generosity`, `sociability`, `forgiveness`, each 0–1 (missing ones are 0.5). See "Have a personality" above |
| `fallbackLine` | Optional. What they say if the model fails twice in a row |
| `stats` | `maxHp`, `maxMp` and 8 attributes (1–20) |
| `skills`, `teaches` | Tiers 0–5. `teaches` is their one trainable skill (defaults to their best) |
| `weapon`, `armor` | Items from [`ITEMS`](src/game/items.ts): a weapon, and optional armour, both at or below the NPC's `tier` |
| `storage` | Optional. A shopkeeper's chest or bag: `{ "name": "the forge chest", "slots": 12 }`. Their starting inventory must fit pack + storage |
| `startingInventory`, `prices`, `buys`, `startingMoney` | Item names, optionally with a tier: `"iron sword [B]"`. Amounts (`prices`, `startingMoney`, quest `reward.money`, debts) are coin phrases like `"1 gold 5 silver"` or `"15s"`, or whole copper |
| `secrets` | `{ id, about, text }`. `about` is a vague hint the model sees at high trust. Optional `cover` (the story they tell instead), `keywords` and `breaksWith`: `[{ "item": … }, { "fact": "pell.hale_cellar" }, { "check": "intimidate" }]` |
| `appearance` | What they look like; wounds, soot, weapons and tiredness are added in code |
| `quirks` | `[{ "when": { "activity": ["work"], "topic": ["sword"] }, "line": "…" }]`. Conditions: `activity`, `place`, `topic`, `nearby` (NPC ids), `mood`, `hours`, `hurt`; all must hold |
| `fears`, `loves` | `[{ "name": "the mayor", "words": ["mayor"], "item"?, "minTier"?, "npc"? }]` |
| `schedule` | `[{ "from": 6, "to": 20, "activity": "work", "place": "forge" }, …]` covering all 24 hours. Activities: `work`, `eat`, `socialise`, `sleep`, `travel`; places: `forge`, `inn`, `square`, `gate`, `camp`, `home` |
| `signature` | `{ "trigger": "good_work_day" \| "trusted_regular", "effect": "masterwork" \| "hidden_stock", "items"?, "minTrust"?, "describe" }` |
| `services` | `[{ "kind": "lodging", "price": "8 silver" }]`: `heal` and `lodging` need a price |
| `minor`, `romance` | `minor: true` rules out romance (the schema refuses `romance.open` on a minor) and, by default, being attacked |
| `debts`, `reserveMoney` | Optional. Paid down automatically from earnings |
| `dropsOnDeath` | Optional. Killed by the player, they drop their pack and purse (the bandit leader). Leave it off for shopkeepers |
| `maxQuestTier`, `quests` | Highest tier they give, and written quests (`deliver` an item, or `defeat` a creature kind) |

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
    traits.ts         personality traits and the rule each one drives
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
    gossip.ts         what NPCs tell each other about the player
    scene.ts          group conversations: who's addressed, who chimes in
    favours.ts commitments.ts commissions.ts services.ts deception.ts journal.ts
    signature.ts      each NPC's signature move
    weather.ts events-calendar.ts   seasons, weather, market days, festivals, raid days
  data/npcs/          brena.json, pell.json, hale.json, rook.json (the bandit leader)
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
```

See [ROADMAP.md](ROADMAP.md) for what's done and what's next.
