# llm-game: LLM-driven NPCs

RPG characters that talk with a local language model (Ollama), and act in the game through tools the game checks.

**The core rule:** the model does the talking and *proposes* actions. The game's code decides what actually happens: every price, dice roll, trade, secret and quest is checked or worked out in code. The model is never trusted to keep track of state or do maths.

## Run it

```bash
npm install
ollama pull qwen3:4b-instruct   # once; Ollama must be running
npm run web                     # build the browser game, then play at http://localhost:3000
npm run chat                    # or play in the terminal, starting with the head of the start town
npm run chat -- <name> --name=Ash  # start by talking to someone of that name in the start town, as Ash
```

NPCs speak with your browser's voices out of the box. For Piper's neural voices (needs Python 3, ~80 MB download, ~270 MB of memory while playing):

```bash
npm run voices:install          # once
npm run web:voices              # Piper and the game together; Ctrl+C stops both
```

| Script | What it does |
|---|---|
| `npm run web` | Build the browser game, then play: a generated world begins at the gate of a start town the seed picks; walk around it and talk to everyone (`PORT=3001` to change port, `-- --new` for a fresh game, `REALM_SEED=7` for a particular world) |
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
| `npm run sim:realm -- --check` | The realm run plus each step's timing against its budget (`budgets.ts`); exits 1 if one is over (N19) |
| `npm run bench:busy [-- --days 30 --slow 3 --extra quest-flavor=40]` | A busy week of model work (plans, summaries, chronicle, retells, flavour, and you talking) against the budgets, in virtual time: queue length, waits, what was dropped, your first-word time. `-- --live` runs one compressed day against Ollama (N19) |
| `npm run bench:storage` | A realm of about 50,000 people in a real database file: times the save and the load of the player's place, and fails past 1 s and 2 s (`PEOPLE=100000` for more) |
| `npm run world:export -- <out.mbworld>` / `npm run world:import -- <file> [--to save.json] [--force]` | A whole world (the save and every database table) as one gzipped file, and back into a new save (never over the current one without `--force`). The admin Health tab has a download button for the running game |
| `npm run bench:voice [-- --lines 8]` | What Piper voices cost next to the language model: latency per sentence, real-time factor, memory. Starts Piper itself if it's installed; results in `saves/bench/` |
| `npm run gen -- <template> [--seed N] [--no-model]` | Print a person made from a template (`farmer`, `guard`, `merchant`, `child`, `smith`, `innkeeper`, `bandit`): code rolls the numbers from the seed, the model writes the words. Checked by the schema and the lint. The game makes people itself as places are met (N25a); this is for looking at what a template gives (N11.1) |
| `npm run check-npcs` | The authoring check (T5): every template and 120 generated people (seeds 1–10) through the schema and the lint, and the depth pools. Run it after changing a template or `data/templates/depth/` |
| `npm run bench:style [-- --npc <id>]` | The blind voice test (T15) on a generated cast: the same ten lines to every NPC, and a code classifier tells who's speaking; plus no AI talk, no `<situation>` leaks, no romance from a minor, and invented names. Results in `saves/bench/` |
| `npm run bench:reviews` | How well the model reviews a life (N25b): a few things happen to a generated town's people and each talker is reviewed by the real model, three to a call; reports what the checks accepted, clipped and rejected, and why (`SEED`, `ROUNDS`) |
| `npm run replay -- <file>` | Inspect a recorded transcript (T3) |
| `npm run typecheck` | TypeScript check (all three packages) |

### Project layout

An npm workspaces monorepo:

| Package | What's in it |
|---|---|
| [`packages/server`](packages/server) | The game: NPC agents, rules, saves, the director, the CLI ([`cli.ts`](packages/server/src/cli.ts)) and the HTTP server ([`web/server.ts`](packages/server/src/web/server.ts)), with its tests and scripts. Paths like `src/npc/...` below are in here. |
| [`packages/client`](packages/client) | The browser game: a [Phaser 3](https://phaser.io) world view ([`WorldScene.ts`](packages/client/src/world/WorldScene.ts)), DOM side panels ([`ui/`](packages/client/src/ui)) and voices ([`voice/`](packages/client/src/voice)), built with Vite |
| [`packages/shared`](packages/shared) | What both sides agree on: the HTTP types ([`protocol.ts`](packages/shared/src/protocol.ts)), typed game events ([`events.ts`](packages/shared/src/events.ts)), the townsfolk's day and talk ([`crowd.ts`](packages/shared/src/crowd.ts), N16), the sentence splitter for speech, NPC voice settings, grid paths |

Model and settings are in [`src/config.ts`](packages/server/src/config.ts). Override with `NPC_MODEL` and `OLLAMA_HOST` in `.env` (see [`.env.example`](.env.example)). Voices: `PIPER_URL` (a running Piper server's `/synthesize`), `PIPER_BIN`, `PIPER_VOICES` (default `voices`), `PIPER_PORT` (for the npm scripts, default 5055); `FILLER_AFTER_MS` (default 3000, `0` turns filler lines off). Also: `DIRECTOR=off` (no nightly chronicle), `PLANNING=off` (no off-screen plans), `SUMMARIES=off` (no conversation summaries), `EMBED_MODEL` (default `nomic-embed-text`) and `DB_FILE` (default `saves/world.db`). Families: `ADMIN=on` (skip the this-machine check on `/admin`, N17), `NPC_MARRIAGE=off` (no courting or births among NPCs), `PREGNANCY_DAYS` (default 9); the rest is `config.family`.

For recall by meaning, optionally pull a small embedding model: `ollama pull nomic-embed-text` (~270 MB). Without it, a hashed bag of words stands in (no download, works offline).

## A world without a centre (N25a)

No place is special and nobody is hand-written. The world is generated from a seed (`REALM_SEED`, or rolled when the world is made), and every settlement, every talking person and every system works the same way wherever it is. The only thing the player's place has that others lack is detail: it runs hour by hour, the rest run a coarse day and catch up when you arrive, with the same results.

- **The start town is picked by the seed** ([`realm/start.ts`](packages/server/src/game/realm/start.ts)): a village or town with an inn, a smithy and two roads, preferring one with a beast pack, a dungeon or a gang nearby. A new game begins at 08:00 at its gate, and its head has work to give from the town's needs. (Choosing the town yourself comes with N39.)
- **Everyone who talks is generated** and kept in one registry ([`talkers.ts`](packages/server/src/game/talkers.ts)), each with the place they belong to: a place's head and best-known people when it is first met, a townsperson you speak to, someone who rose from the crowd, a child born to talkers. They are made from templates by their role (`farmer`, `merchant`, `guard`, `smith`, `innkeeper`, `child`, `bandit`) with their name, rank, age, office, faction and deeds from the realm, and the facts of their lives from the people database. The six NPC files of the early versions are test fixtures only (`packages/server/tests/fixtures/`); the game never loads a persona file. Millbrook, Brena, Pell and the rest are gone from the code, data, prompts and client, and [`centre.test.ts`](packages/server/tests/centre.test.ts) fails if they come back (or if a site id is compared to a constant).
- **Per-place state** ([`site.ts`](packages/server/src/game/site.ts)): creatures and spawn ledger, spawn rules made in play, news and what the place has heard, raid day, need cooldowns. `recentEvents`, `lastRaidDay`, `newsDays`, `chronicleDay`, `extraSpawnRules` and `spawns` on a saved world are the player's place's own. Spawn rules come from the realm by den kind ([`realm/spawnrules.ts`](packages/server/src/game/realm/spawnrules.ts)); all lore is generated ([`realm/lore.ts`](packages/server/src/game/realm/lore.ts): `place.<site>`, `place.<site>.<thing>`, `realm.*`, news by delivery); the realm's needs, arrivals (raiders, refugees, caravans) and news run for any place the player is in.
- **Arriving** ([`Town.activate`](packages/server/src/game/town.ts)): the people there are caught up on the days away ([`catchup.ts`](packages/server/src/game/catchup.ts): fed, rested, healed, restocked, no job half done), what the realm sent happens, news arrives on the place's own clock, haunts are stocked, and each talker gets one life review covering the time away (N25b).
- **Generated depth** ([`npc/depth/`](packages/server/src/npc/depth)): so the mechanics of N4–N9 (secrets and cover stories, fears and loves, dilemmas, arcs, signature moves, hire terms) have material without anyone writing it. When someone becomes a talker, code writes their depth at once from their real facts ([`facts.ts`](packages/server/src/npc/depth/facts.ts): family, deeds, debts, their town's conditions, their outlook as a townsperson, true things that could be secrets) and seeded pools ([`data/templates/depth/`](packages/server/src/data/templates/depth), no people named in them), and, in the background (`persona-story` call, 30 a game day, about a minute each with qwen3:4b), the model writes their story and words from the same facts. A new town's notables are many, so a long queue sheds the rest and they are asked for again on later days, three a day, the player's place first; the nightly chronicle ranks ahead of stories and reviews in the queue. Code checks every field of the reply ([`validate.ts`](packages/server/src/npc/depth/validate.ts): an invented name, a secret that isn't a real candidate, a dead spouse alive, romance for a child, a crime the record doesn't bear out) and keeps its own for any field that fails; the model never sets a number (relationships, services, prices, hire terms and the effects of a dilemma are code's). A secret the player has been told, a dilemma settled or an arc moved is never swapped under them. `DIRECTOR=off` or an over-budget day: code's words stand. Tests: [`n25a.test.ts`](packages/server/tests/n25a.test.ts).
- **Saves:** version 14, a clean break (N26 Part E; the user chose no migration): an older save (and `deaths.json`) is renamed aside and a new world begins. Deaths live on people rows and in the registry.

## Lives that change (N25b)

Every person's opinions, feelings, wants, grudges, secrets and story keep changing with what happens to them, to the people close to them and in their town. A review gathers only what the person knows, and **the model proposes, code decides**: it never states a fact, a price or a number.

- **When:** every `REVIEW_EVERY_DAYS` days (default 3; each person's day is a seeded offset, so a town's reviews are spread over the days), and the **same day** something big hits their life. A big event has a weight (death in the family 9, enslaved 9, war declared or town besieged 8, famine 8, plague 8, a raid on the town 7, attacked or robbed 7, a lord replaced 6, wedding or birth 6) times how close it is to them (themselves 1, family 0.8, close friends and master 0.6, for a town-wide event everyone in the town, for a war the whole kingdom); `SHOCK_IMPACT` (default 5) or more is a **shock** and gets the larger limits. A neighbour's death (4.5) is not a shock; a friend's (5.4) is. Wired today: a town's raid, war, famine or plague beginning, a death or wedding in the family, and the player attacking, robbing or killing someone; the other weights wait for the systems that make those events (slavery changes, crackdowns, a lord replaced). ([`impact.ts`](packages/server/src/npc/review/impact.ts))
- **Who proposes:** talkers with the player (and companions) by the model, `REVIEW_BATCH` (default 3) to one call with a section each, so what one person knows never reaches another ([`model.ts`](packages/server/src/npc/review/model.ts); `life-review` call, 10 a game day; about 25 s for a batch of three with qwen3:4b on the M2: a town of thirty talkers is three or four calls a day, `npm run bench:reviews` measures it); a place on arrival, once; talkers elsewhere only on a shock or every third cycle when the queue has room. When the model is off (`DIRECTOR=off` or `REVIEWS=off`; `REVIEWS=none` turns every review off, code's too), over budget, shed from a long queue, or gives nothing usable, **code's rules** make the same kinds of change from the same input ([`rules.ts`](packages/server/src/npc/review/rules.ts)): a deed done to someone close moves how they see whoever did it (and a deep one leaves grief, a grudge, a wish to avenge, a line in their story), opinions are pulled toward what the people they trust think (only people who hold a view count, and it settles back so a town can't run to the extremes), a famine or raid worries them and sours them on whoever rules and may make a poor person want to leave, time wears a grudge down.
- **What they are given** ([`inputs.ts`](packages/server/src/npc/review/inputs.ts)): the events they witnessed or heard of since their last review (each weighed once), their older memories closest in meaning to those (embeddings), the people close to them with what *those* people think of the same things and how far they are believed, their town's conditions in words, their own views, rumours, true things that could become secrets, and their arcs. Each review also becomes a memory, found by meaning next time.
- **What may change** (twelve fixed kinds): an opinion (trust, affection, respect, fear: of the player, a person, their lord, a faction, a place), a lasting feeling, a want (leave, avenge, pay a debt, protect, make amends...), dropping one, a grudge or forgiveness, a new fear or love, a secret (only a real candidate from their facts), believing or dismissing a rumour, a step in an arc, a line added to their story. **The checks** ([`validate.ts`](packages/server/src/npc/review/validate.ts)) reject a change that cites something they weren't given, names someone they don't know, goes against a fact (forgiving a grudge nobody holds), or breaks a content rule (nothing romantic or adult for a child), and clip or drop what is over the limits (6 changes, ±10 on an opinion or ±20 in a shock, one new want, secret, fear or arc step per review). The same checks take code's proposals.
- **Applying** ([`apply.ts`](packages/server/src/npc/review/apply.ts)) goes through what the game already reads: the relationship axes, `npcRelations`, emotions, grudges, rumours' accuracy, arcs, and the persona's fears, loves, secrets and story. A want weighs less each review and fades. Each review is one event (`changed-mind`, `new-goal`, `new-fear`, `secret-made` or `story-turn`, known to the person alone) with the reasons, and a row in `life_reviews` with what was proposed, applied, clipped and rejected and why. The conversation prompt carries what is on their mind.
- **Everyone else** changes by the same kinds of rules in the people's day ([`people/outlook.ts`](packages/server/src/game/people/outlook.ts)), kept in one small JSON on their row (`people.outlook`): how they see whoever rules their place, their mood, what they want (to leave: only the free classes; to see a death in the family answered) and a grudge. Everyone is reviewed every few days and the whole town the day a raid, war, famine or plague begins; a family the day one of them dies. Households that want to leave go first when a place sends people away. The same rules run in a lazy catch-up and give the same people. Someone who later becomes a talker keeps their outlook, and the model is told it.
- **Look at it:** a talker's admin card has a *Life reviews* section (when, who made it, what changed and why, what was not applied and why) and their wants; a townsperson's has an *Outlook*. `npm run bench:reviews` measures the model's acceptance rate; `npm run bench:busy` includes the review load. Tests: [`n25b.test.ts`](packages/server/tests/n25b.test.ts).

## What an NPC can do

> **A note on names.** The sections below were written when the game had six hand-written NPCs: Brena the smith, Old Pell the innkeeper, Corporal Hale, Rook the bandit leader, Wren and Pip the child. They are now **test fixtures** (`packages/server/tests/fixtures/`), used by the tests of one NPC's mechanics, and the examples keep their names because the tests do. Nothing in the game is about them: a generated smith, innkeeper, guard, bandit or child has the same abilities, from their template and their depth ([A world without a centre](#a-world-without-a-centre-n25a)).

### Talk in character
- Has a personality, speech style, backstory, goals and things they know, all written in their NPC file. These become the system prompt.
- Each turn they're told what's true right now in a `<situation>` block: the time, place, recent news, their mood, HP, how much they trust you, and your money. Stock, your items, what they can teach and their quests are only added when you talk about trade, training or work. Showing everything every turn made the small model noticeably worse.
- Remember earlier lines in the conversation. Long conversations drop their oldest exchanges to stay inside the model's context window (about 3,000 tokens), so the system prompt is never lost.
- The world is saved after every action (`--new` starts fresh). It is two files that go together: `saves/world.json` (the player, the clock, the cast, the realm; compact JSON, written to a temp file and renamed into place) and `saves/world.db` (SQLite: every one of the realm's tens of thousands of people, the event log, memories). Each save records the same tick in both, and a pair from different moments is refused with a clear message rather than guessed at. A save from before version 11 is renamed to `world.v<old>.bak.json` and a new world begins. Run one game at a time: `saves/.lock` stops a second from writing the same saves.

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

### Know only what the world says they know ([`realm/lore.ts`](packages/server/src/game/realm/lore.ts))
- **One source of truth, generated:** places (`place.<site>`, and the things in them, `place.<site>.<thing>`: its inn, forge, hall, named for the building on its map and who keeps it), kingdoms, factions and dungeons (`realm.*`), people who matter, and news (`news.<id>`), each with a dotted id. There is no lore file: the realm makes it as places are met.
- **Each NPC has knowledge scopes** (`knows`): which lore they know, and how sure they are (`certain` or `rumour`). Everyone knows their own place for certain, their neighbours' places, and the realm by rumour; news only when it has reached their place. (The fixtures know the fixed lore in `tests/fixtures/world.json`.)
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
- Each NPC has a schedule: a smith works the forge 6–20, eats at the inn (and pays the innkeeper), and sleeps at home. Hunger and energy tick every hour; a starving NPC goes to eat, an exhausted one to bed, a broke one works through supper. Hungry or tired, they say so and get short-tempered.
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
- **Children** (the `child` template; the fixture Pip in the tests): about ten years old, run errands round the square (two small quests) and knows the news for certain and everything else as rumour. A minor (design rule 7): never romance (the schema, the rules and the prompt all refuse it), never attacked (`minorsCanBeAttacked` is off), and never starts a fight either (no `attack_player` tool for a minor).
- **Courtship and marriage** ([`family.ts`](packages/server/src/game/family.ts)): each midnight, two unmarried NPCs of courting age (two years after they're grown: 18 for humans) who like (affection 50+) and trust (20+) each other both ways, aren't kin, are no more than 15 years apart and haven't sworn off love (`romance.open: false`) start walking out together. Each night they grow closer; after six nights they marry. A quarrel ends it. Weddings are news for the whole village and a memory for both. Time together (an evening at the inn, a day at the square) slowly builds affection and some trust between NPCs who aren't enemies, so new couples form over weeks of play. NPC files can start a world married (`spouse`, both ways). Turn it off with `NPC_MARRIAGE=off`.
- **Marrying the player** (`/propose`, or the *Ask to marry* button): only with `ROMANCE=on`, an NPC open to romance, at the last romance stage, and neither of you married. The NPC answers in their own words; code already decided.
- **Children**: a married couple, both adults, may start expecting (15% a night) up to three children, with 12 days' rest between, while the town has fewer than 14 living NPCs. The child is born nine days later as a new NPC (their file lives in the save): a baby at home, then at five a child who runs errands round the square (the model writes their personality and voice then, from what they inherited), then grown at their species' adult age. A child of the player counts too. Pip, a child from the files, grows up the same way (her grown file is kept in the save).
- **What runs in the blood**: attributes are the parents' average, give or take 2; traits are a blend, nudged a little; potential follows the stronger parent, give or take a rank. Each parent's skills at tier 2 or better may pass on as **talents** (40% at tier 2 up to 100% at 5, three at most): talents learn 1.5x faster, and on growing up the child comes into half the parent's tier. A grown child takes up the working parent's trade and hours, and if a parent dies with no successor named, the eldest grown child inherits the stock and purse.
- **What they say about it**: a family line ("Your husband is Corporal Hale. Your children: Tam (6), Pip (a baby).") reaches the prompt only when the talk is about family or family is present (design rule 3). `/family` and the World tab list the town's marriages, courtships, children on the way and children.

### A wider realm (N13, [`src/game/realm/`](packages/server/src/game/realm))
The world is a realm that lives on its own, a day at a time, all in code with the world's dice: no model call, and the same seed gives the same realm (`npm run sim:realm` runs one for 120 days and prints what happened). `REALM=off` keeps a single village.
- **One seed, one world** (N18): a world has a seed (`REALM_SEED`, or rolled once when it is made) and every system rolls from its own stream of it (`streamFor`, [`dice.ts`](packages/server/src/game/dice.ts)), so adding a roll to one system never changes another's results; event ids are `e<day>-<hour>-<seq>` from a counter in the save. Two worlds of one seed are the same after 30 days, down to the database (`worldHash`, tested). What stays on `Math.random` is marked `// real time, not simulation`.
- **Everyone is in the database** (N18): when a world is made every settlement's people are rolled once ([`rosterFor`](packages/server/src/game/realm/townsfolk.ts) is only the generator) and stored in `saves/world.db`; from then on the table is the truth, read by place (`rosterFromStore`) and written back in batches at each save. The save file keeps no townsperson.
- **Kingdoms, cities, towns, villages and hamlets** ([`generate.ts`](packages/server/src/game/realm/generate.ts)): three kingdoms of 10–12 places each, joined by roads. Each village sits under a town under its kingdom's capital. 190+ named people (*figures*, [`figures.ts`](packages/server/src/game/realm/figures.ts)): every place's head (elder, village head, mayor, lord, king or queen), captains, merchants, smiths, priests, hunters, adventurers, bandit chiefs, and the best-known farmers, miners and carters of each place. They talk when you meet them. They age, gain XP and break through ranks by the same rules as everyone (`life.ts`), and die of it or in fights.
- **Prosperity, building and moving** ([`economy.ts`](packages/server/src/game/realm/economy.ts)): each place has people, food, coin, prosperity and buildings (farms, market, walls, smithy, inn, temple, guild hall, barracks, mine, granary). Farms and the season feed it; markets and mines earn; prosperity follows food, coin, safety and taxes. A place with coin builds what it needs most (walls after a raid, farms when hungry, a market when rich). People are born when fed and safe and starve when not; they move to better places a road away, and so do ambitious figures. A place that grows is promoted (hamlet → village → town → city); one that empties is abandoned.
- **Hierarchy and taxes** ([`politics.ts`](packages/server/src/game/realm/politics.ts)): every head answers to the head of the place above, up to the crown, and every faction has its own ranks (guildmaster, master, journeyman; chief, lieutenant, cutthroat…). Every 7 days each place pays a share of its coffers up the chain (more in war). A head too poor, greedy or disloyal falls behind; the liege sends men to collect, and a strong, stubborn place breaks away, founds rebels, and its crown comes for it. A dead head is replaced by their heir; a close, ambitious rival may refuse and found rebels.
- **Factions, guilds and splits** ([`factions.ts`](packages/server/src/game/realm/factions.ts)): crowns, guilds (adventurers, merchants, smiths, thieves…), associations, gangs, rebels, cults and orders, with a leader, members, a seat and halls in other places. They earn, recruit people who suit them, open halls, pick a new leader when theirs dies, and **split** when an ambitious, disloyal lieutenant is strong enough: the new faction takes followers, coin, halls and a grudge.
- **Treaties, raids and wars** ([`diplomacy.ts`](packages/server/src/game/realm/diplomacy.ts)): treaties between any two parties, a person, a village, a faction or a kingdom: non-aggression, mutual defence (allies' men join the fight), trade (both earn more), tribute, and service (a sword for a kingdom, for a wage). Breaking one costs renown and goodwill. Hungry, poor or greedy villages and gangs raid weaker neighbours they have no treaty with, for food and coin. Kingdoms that hate each other go to war: a battle every 3 days at the border, places captured, allies joining, until one side wins or both are worn out and sign a peace with tribute.
- **Beasts and dungeons** ([`wilds.ts`](packages/server/src/game/realm/wilds.ts)): packs breed in spring and summer while the land feeds them, attack when they grow too many, and are culled by hunters (more with a bounty up). Dungeons fill up while nobody clears them and spill out past 85 danger; adventurers delve them level by level for treasure and renown, or die there. Every place's own wolves and horses breed on the map too.
- **Rising from the crowd** ([`rise.ts`](packages/server/src/game/realm/rise.ts)): the villagers on the map are the place's commoners, by name, and what happens to them happens to them. A creature that breaks through a rank or wins three fights earns a name (a wolf becomes Greyfang and leads the pack); a nameless fighter who wins a raid or battle may step out of the crowd as a new figure. A person of the player's place who rises far enough becomes a **talking NPC**, made from a template (a bandit's or a farmer's) with their own rank, age and deeds (their file lives in the save).
- **An active director** ([`director.ts`](packages/server/src/game/realm/director.ts)): each morning it reads what every place needs and pushes something, at most three a day, each logged with its reason: a gang where people starve, rebels where taxes bleed a poor place, an adventurers' company where monsters gather, a merchants' guild where the market thrives, a farmers' association in a hungry village, a pact for the raided, a trade road between friendly crowns, a grain caravan for the hungry, a bounty on beasts and dungeons, a sword for hire in a war. A place's needs become **work**: wolves breeding → its head wants three culled; raiders about → Hale wants two dealt with; the Old Mine Deeps filling up → Hale wants it cleared (a new quest goal, `clear`); walls going up → Brena wants iron; low stores → Pell wants herbs for the pot. The model only writes words: it may rename a new faction and give it a creed, and retell big news from away as folk would say it, both through the invented-name check; code's words stand otherwise.
- **News travels** ([`news.ts`](packages/server/src/game/realm/news.ts)): a war three days away is three days old when it reaches a place. What happens in a place everyone there knows; news from away comes with travellers to the innkeeper and whoever is at the inn or the gate, as a rumour (the guard hears of raids and wars), and gossip carries it on. Every place has its own news clock.
- **Talkers are figures too** ([`sync.ts`](packages/server/src/game/realm/sync.ts)): a guard answers to their captain, a gang's chief leads it in the realm, a head answers to the place above. A raid on a place brings raiders to its road that night; a pack too big sends wolves to the forest edge; refugees come down the west road; a grain caravan stocks the inn; while its kingdom is at war, the place pays more tax, and blades, armour and food cost more.
- **Death is news, not telepathy** ([`deathNews.ts`](packages/server/src/game/deathNews.ts), N13.0): when an NPC dies, only those who saw it, were there or are family know at once. Everyone else hears it from gossip, maybe only as a rumour, and grieves (or turns on you) then. Until they hear, they think the dead are alive, and say so if you ask.
- **You in the realm:** join the adventurers' guild (`/joinguild`, 5 silver) and `/delve` a dungeon near a place (from its mouth, up the road to it: N15): level by level, your level, strength, weapon, skill and armour against what lives there; treasure and XP for each level won, a beating for each lost, and out you crawl below 30% HP. Clear it for the bounty. Delving earns renown, and renown your rank in the guild (apprentice, journeyman, master).

### Travel the realm (N14, [`travel.ts`](packages/server/src/game/realm/travel.ts), [`sites.ts`](packages/server/src/web/sites.ts), [`notables.ts`](packages/server/src/game/realm/notables.ts))
- **Go anywhere the roads go:** in the terminal, `/travel <place>` and `/routes` take the shortest road route in one go and the realm lives the hours (the place you left is caught up when you come back; your companions come with you; a big beast pack, a gang or a war may stop you, fought in code). In the browser the road is walked ([the open road, N26](#the-open-road-n26)): the Realm tab's *Walk to* button sets where you're bound and sends you out of the gate.
- **Every place is somewhere:** its own map, made from what's built there (the head's hall, an inn, smithy, market hall, temple, guild hall, barracks, granary, houses by size, walls with gates), the same on every visit. Its head and best-known people are about, as NPCs you can talk to, trade with, take work from or fight. They're made from templates by their role, with their own name, rank, age, office, superior, faction and deeds, and they know their place and the realm by rumour, but not another place's news unless it reached them. A head with a dungeon nearby wants it cleared. Kill one and it's a realm death: a successor follows, and word spreads.
- `/delve` works at the mouth of any dungeon you walk to.

### The open road (N26)

The land between places is walkable. Roads, rivers and the places beside them are made from the realm's seed; the server sends the browser the road data once (`GET /api/road/data`) and both make every 64 × 64 tile chunk with the same pure function, so a stretch of road looks the same every time and on both sides.

- **Scale** ([`scale.ts`](packages/shared/src/road/scale.ts)): three chosen numbers, the rest follow. A day's walk is about **7 real minutes** of walking (10 steps a second, 4,200 steps, 93 tiles to a realm map unit), and passes 10 game hours: a road step is a seventh of a game minute, shorter than a village step, so the clock runs faster on the road. Rain slows steps ×1.2, a storm ×1.4, snow ×1.5; hunger and weariness slow them too.
- **Walking:** WASD / arrows, click a tile, or **Walk** (the Realm tab's *Walk to* first sets where you're bound): it follows the road and stops for anything that happens (a choice, a fight, a person, being hurt, arriving). Walk off a village's west edge to leave; step onto a settlement's gate to go in. The header says which road you are on, how far each way and how far to where you're going.
- **The land** ([`chunk.ts`](packages/shared/src/road/chunk.ts), [`generateRoads.ts`](packages/server/src/game/road/generateRoads.ts)): the terrain of the nearest place bent by noise (plains, valley, forest, hills, marsh, coast), roads bent round it between each pair's gates, rivers from the hills to the coast, a **bridge** (with a keeper and a toll) where a main road crosses, a **ford** or a **ferry** on a lane. Beside the road: milestones and signposts, farmsteads (buy bread and milk, ask for water), wayside shrines (pray), toll gates at the kingdoms' borders, and **waystation inns** about every day and a half along main roads: each is a hamlet with its own map, innkeeper and people (they live by the same rules as any place), joined to the road by a short lane, and a bed there brings your rest back.
- **People on the road** ([`journeys.ts`](packages/server/src/game/road/journeys.ts), [`trips/`](packages/server/src/game/road/trips), [`day.ts`](packages/server/src/game/road/day.ts), [`exchange.ts`](packages/server/src/game/road/exchange.ts)): nobody is made up for the road. Every traveller is a row of the `people` table, marked `away` for the length of a journey (their town's crowd skips them, they still count in its people, still age and can die, and a death on the road is recorded where it happened). They go for real reasons, picked from the table by job and circumstance: farmers and craftspeople to the market of a town on its market day, a town's merchant with its carters and hired guards on a caravan, someone to see kin in another place, labourers to look for work (some find it and stay), clergy and the devout on pilgrimage, guards on patrol, a clerk carrying the taxes, crown couriers with great news, the delving adventurers themselves, and households moving: they set out, walk the days between, and only then live in the new place. Travellers resting at a town or an inn are in its crowd and can be talked to. News spreads by people: a place hears of something when it happens there or when a traveller brings it; travellers carry what their place knew when they set out and swap it at every stop (inns most of all), couriers carry the great news, and the chain of who carried it where is in the record (admin: Roads tab). Parties that pass a gang's ambush or a pack's ground sometimes meet it off screen: robbed, hurt or killed on their own rows, with news of it. Each journey is a record in the save (`realm.journeys`) whose position at a minute is a pure function of it (`positionAt`, `placeAt`), so the browser draws them where the server has them. Talk to anyone (E or click): they become talking NPCs who remember you; a merchant sells; a courier knows the news they carry before the place you are in has heard it. *Travel with them* (safer, at their pace) or *rob a caravan* (a crime and news: the goods never arrive). Save v14.
- **Situations** ([`situations.ts`](packages/server/src/game/road/situations.ts), data in [`data/situations/`](packages/server/src/data/situations/)): 14 of them (a broken cart, someone hurt, a toll on a lane, a flooded ford, a beast, a child alone, a merchant's bargain, a funeral, a patrol looking for someone, a peddler, a wagon in the mud, wolves at night, a talker at the roadside, papers checked once N58 gives crackdowns). Whether a stretch of road has one today is rolled from the day and the stretch, so everyone who passes sees the same broken cart. Each choice works through the game's own systems (money, items, health, reputation, standing, an NPC's trust, supplies, time, a fight) and is recorded as an event; what comes of it comes back days later as an event *linked to your choice* ("the one you helped got home", "somebody passed them by"). Pack grounds and gang ambushes are places on the map too: walk into one and the fight starts, once a day.
- **Supplies and nights:** food, water and rest (0 to 100) fall on the road, not in a place; a meal (*Eat* in the pack), a drink at a river, well or farm, a night's sleep bring them back; low, you're slower; at nothing, it costs blood. **Camp** makes a fire off the road for the night (a watch if companions are with you, who talk by the fire); things come to a fire, and a horse with nobody watching can be taken.
- **Mounts and carts:** a horse (2× ground for the same time) or a cart (1.3×, carries more) costs coin where they're sold; they eat, tire and can go lame (a farrier mends them).
- **Fast travel only as a choice:** along roads you have already walked end to end, and it still stops for anything worth stopping for: a party on the road, a situation rolled for that stretch that day, a pack's ground, nightfall in the open, an empty belly, a toll you can't pay, or the end of what you know. A paid **coach** between towns on the main roads skips a stretch you don't know, for a fare, sleeping at the inns.
- **Tests and bounds:** `packages/server/tests/n26.test.ts` (and `packages/shared/tests/` for the pure parts); `checkRoadBounds` ([`bounds.ts`](packages/server/src/game/road/bounds.ts)): roads neither empty nor clogged, every piece of news reaches every place its roads lead to, most caravans arrive.

### Around each place (N15, [`sites.ts`](packages/server/src/web/sites.ts))
- **The village is the village:** every place's map is made by the same generator from what is built there (its hall, inn, forge, houses, a paddock), so only the village is on it.
- **Localities:** what's around a place is on maps of its own. Every place has its woods. A road leads out when a gang is seated there (to its camp) or a dungeon lies near (to its mouth). Around a place with a gang and a dungeon: the road (the gang that works it, where hired men lie in wait), the gang's camp off it, the dungeon's mouth at its end, and the woods with the wolf pack. NPCs whose day takes them there (a gang's chief at their camp) are on those maps, not the village's; forage herbs and pelts in the woods and ore at the mine. In the terminal, `/go woods`, `/go road`, `/go mine`.
- **Every place's notables talk:** its head, captain, innkeeper, smith and best-known people are about as talking NPCs, made from templates by their role, with their offices and what the place says about them. Whoever succeeds them talks too.
- **Everyone remembers:** talks with the people of other places are summarised into the same long-term store and recalled by meaning, like the cast's, after a restart too.
- **Other places' wilds are alive** ([`haunts.ts`](packages/server/src/game/realm/haunts.ts)): another place's woods hold its realm pack (wolves, bears, boars or giant spiders, up to five at once, its named alpha among them) and a gang's camp its members by name. Kill a beast and the pack is one fewer (with a share of any bounty on it); kill a named one and it's a realm death, and word spreads.
- **Delve from the mouth:** go down into a dungeon from its mouth (it is at the end of the road to it). `/delve` and the Realm tab tell you where to go.

### Crowds and classes (N16, [`crowd.ts`](packages/shared/src/crowd.ts), [`townsfolk.ts`](packages/server/src/game/realm/townsfolk.ts))
- **Places are their size:** a hamlet is a clearing with a few cottages; a village bigger; a town, a city and a capital are walled grids of streets with a plaza and a well, a market square, inns, smithies, temples, manors and hundreds of houses (a capital is 96×64 tiles, with a palace). The view follows you.
- **Everyone is there:** every one of a place's people is on its map (a capital's three thousand and more), each with a name, an age, a class, a job, a home, a workplace and maybe a master and a faction, the same people every visit. Point at someone for who they are and what they're doing; point at a building for who's inside. The World tab counts them by class.
- **They live their day, minute by minute:** up at dawn, the walk to work, a breather at the well, a midday break at the inn or the market, errands, an evening out for some, home to bed. Slaves work dawn to dark; serfs owe the lord their days; nobles pay calls and attend court; guards stand watches round the clock; children play in the square. Storms keep the outdoor trades in; the festival fills the square.
- **Classes and laws:** slave, serf, commoner, craftsman, merchant, cleric, gentry, noble, royal. One kingdom keeps serfs, the next keeps slaves (who live in their master's house), the third keeps neither (`kingdom.laws`, set when the realm is made).
- **They talk to each other** (bubbles over a few at a time): the low-born greet their betters first and bow; nobles sneer; a master orders and a slave obeys; serfs grumble about the tithe, commoners about the lord's taxes when no lord's about, nobles about the insolent commons; children play; rival factions trade insults, the crown's people look down on the guilds and the guilds answer back; and the news.
- **Talk to anyone:** press `E` by a townsperson or click them, and they become a full talking NPC (with their class, master, faction and what they think of the other classes), remembered in the save. **Only traders sell:** stallholders, merchants, innkeepers, bakers, weavers, cobblers, tailors and potters.
- **Time flows while you stand about:** a game minute every 2 seconds, so the town keeps moving (not while you talk, fight or walk). The header's ⏸ Time button makes time wait for you; `TIME_FLOW_SECONDS=0` turns it off on the server.
- **Talkers take breaks:** a long working day has an hour's break in the middle (a smith eats at the inn at 13:00; the guard stays on the gate), and nobody stands frozen to one tile.

### Live a whole life (N25, [`src/game/people/`](packages/server/src/game/people))

Every townsperson in the database now ages, marries, has children, moves and dies, by code, the same way at every level of detail. A place's **population is the count of its living people**.

- **A day** ([`world.ts`](packages/server/src/game/people/world.ts), [`step.ts`](packages/server/src/game/people/step.ts)): after the realm's day, each place's conditions are written (`site_days`: food, prosperity, hunger, crowding, raids, beasts, the day's casualty orders), households move between places, then each live place's people live the day in roster order: birthdays (coming of age gets a job; the old retire), a birth when a woman's time comes, the day's chance of dying (old age, illness, accident, hunger, crowding), conceiving if married, able and with room, and matches for the unmarried. Every roll comes from a stream named by who and when (`streamFor(seed, "life", id, day)`), so the same day gives the same result whenever it is worked out.
- **Marriage:** class closeness (same class 1, one rank apart 0.4, further 0.05), age (within 15 years) and faction friendliness; never minors, never close kin (parents, siblings, grandparents, cousins: [`rules.ts`](packages/server/src/game/people/rules.ts), shared with the cast's families). A match across two ranks becomes a higher-importance event. Where slavery is lawful a slave's marriage needs the master's leave. A child is born with a blend of both parents' traits and potential, and a class by the kingdom's laws.
- **Deaths** are one typed record for everyone (`old-age`, `illness`, `famine`, `battle`, `siege`, `raid`, `execution`, `murder`, `beast`, `accident`, `childbirth`; `missing` is a state, not a death), with the event and killer when known. Raids, battles and beasts no longer subtract a number: they order casualties, and code picks who falls (fighters first in a raid, farmers and hunters to a beast). Hunger kills the old, the very young and the unfree first. A talking townsperson and their row die together, whichever dies first.
- **Moving:** famine, a fresh raid or crowding send whole households (couples with their minor children) to a better neighbour; an emptied place sends everyone; an empty village draws settlers from a crowded neighbour. Houses are fixed per place (`settlement.houses`) and grow only when a crowded place with coin builds them, so nobody's home moves under them.
- **Rising:** a young person of promise from a notable house, or by luck, becomes a realm figure when they come of age; a figure who grew up as a townsperson and makes enough of a name becomes a talking NPC with both parents named in their file, in any place and with no cap (in the player's place they are about; another place's are met in their own town).
- **Levels of detail:** coarse (once a day, in a batch) is the default for every place; the place the player is in keeps each event's hour so it is shown when its hour comes; places in `PEOPLE_LAZY` are only worked out on demand (`catchUp`), with the same result. Look at it with `PEOPLE_LIVE=all|slice|off|id,id` (default `all`; `slice` is the start town and its nearest neighbour; without a database the realm keeps counting heads).
- **See it:** `npm run sim:lives` (`DAYS=240 SEED=7`, `-- --check`) prints the age pyramid, birth and death rates, marriages and the five balance bounds; the admin view shows a person's deaths and (via events) their births, weddings and moves. Tests: `tests/n25.test.ts`.

### Remember the long run (optional items, [`db.ts`](packages/server/src/game/db.ts))
- **Conversation summaries** ([`summary.ts`](packages/server/src/director/summary.ts)): when old exchanges drop out of the context window, or a conversation ends, one structured call turns them into 1–5 short memories. They're marked, capped below any code event, never gossiped, and change no state.
- **Recall by meaning:** summaries go into a SQLite store with an embedding; when you talk to someone again, the old talks closest in meaning to what you just said come back to them ("From earlier talks with them you recall: ...").
- **Off-screen planning** ([`planning.ts`](packages/server/src/director/planning.ts)): once a day each NPC makes one short call to set its plans from its memories and goals. Flavour only: a situation line; code never acts on it.
- **Never in your way:** plans, summaries, quest write-ups and the chronicle run in the background on their own connection, and are cancelled (and retried later) the moment you act.
- **Budgets** (N19, [`src/budgets.ts`](packages/server/src/budgets.ts)): one small local model serves everything, so every model call has a *kind* and each kind a daily cap: `talk` (never limited), `summary` 40, `plan` 30, `chronicle` 8, `retell` 4, `faction-name` 3, `child-words` 2, `quest-flavor` 6. Over its cap a call doesn't happen and the caller's template words stand, so nothing depends on the model answering. The background queue runs summaries first, then plans, the chronicle and flavour; if its estimated wait passes two minutes it drops flavour first (never a summary), and your own conversation always pre-empts it. Tick times (a game hour 50 ms, a realm day 250 ms, the database write 50 ms) and the capital's per-frame work (4 ms) are numbers there too. Every number can be overridden for an experiment (`BUDGET_TICK_DAY_MS=0 npm run sim:realm -- --check` fails on purpose); tests multiply the time limits by `PERF_SLACK` (set it to 3 on a slow or busy machine). The admin Health tab shows each budget and how close it is.

#### Checking the frame rate
CI can't draw, so `client/tests/frame.test.ts` times the work the browser does for a capital's crowd (positions every frame, everyone's place once a game minute). The real 60 fps check is by hand: start `npm run web`, open the game with **`?fps=1`** on the address (`http://localhost:3000/?fps=1`), travel to the realm's capital, and watch the box in the corner for a minute with the crowd out: green is 58 fps or more with no frame past 34 ms, amber is 45 or more, red is below. Record anything that isn't green in the roadmap.

### Watch the whole world (N17, [`src/admin/`](packages/server/src/admin), [`client/src/admin/`](packages/client/src/admin))
Run `npm run web` and open **`/admin`** (this machine only: the server listens on `127.0.0.1`, and the admin routes also check the caller's address; `ADMIN=on` skips that check, for use behind your own proxy). It is a second page that shows the world as it really is, spoilers and all, and it **changes nothing except the clock**.
- **Realm:** the map (kingdom colours, roads, dungeons, beast packs, dashed war fronts, rings for war and raids), the totals, every place with its people by class, prosperity, food, coffers and head, the wars, treaties and factions. Click a place for its card.
- **Events:** every event in the world, newest first, in a list that draws only what is on screen: your game's events (all of them, from the database), the realm's news, and what the director pushed, each with the **why** behind it (a war's cause, why a head was picked, the director's reason). Filter by source, importance, place, faction, kind or person; click a row for who and why. It updates every two seconds.
- **Search:** anyone by name, class, job, role, place or faction: the cast, notables (alive and dead), the townsfolk of every settlement (a query on the database), beasts, the player, and places.
- **Pinned:** pin people, places or the player (kept in your browser, not in the save). A card shows where they are and what they are doing, needs and feelings, goals and grudges, relationships, what they know or believe and who told them, family and a timeline with reasons. A townsperson in another town shows their **day, hour by hour**, and **Follow on map** draws their town with everyone in it. Pinning the player lists every rumour about them, who holds it and how sure they are, and what each person feels about them.
- **Health:** how long each step takes (the realm's day and its parts, the village hour, saving), each budget with how close it is (green under 75%, amber under 100%, red over), the model calls today by kind against their caps, the background queue and your first-word time, counts, and the numbers `npm run sim:realm` prints.
- **Time:** ⏸ Pause stops the game's clock running on its own; +1 hour, +1 day and Fast-forward (up to 30 days) let time pass exactly as if you had waited. Each is logged to the director's log as `admin-time`, so it shows in the event stream.

## Play in the browser (`npm run web`)

A top-down map of the start town where you walk and talk without the terminal. The server ([`src/web/server.ts`](packages/server/src/web/server.ts)) wraps the same `NpcAgent` and rules as the CLI, so everything above works; the browser ([`packages/client`](packages/client)) only draws and sends what you do.

- **Move** with WASD or the arrow keys, or click a tile to walk there (one game minute per step; the village keeps living as time passes). The tile under the mouse is outlined; the cursor changes over someone you can talk to or fight.
- **NPCs follow their day:** they walk between the forge, the inn, the gate and the square (and out to the camp, the road, the mine or the woods, on those maps), and fade out indoors when they go home or to bed. Night darkens the map; rain, storms and snow fall when the weather says so.
- **Companions walk in your footsteps**, a tile or two behind you, and step aside when you turn back.
- **Talk** by clicking a villager, or press `E` next to one. They may speak first. Replies stream into the chat and into a speech bubble over their head as the model writes them; if someone else is nearby they may chime in, in italics. Walking away ends the conversation.
- **No dead air:** a "…" bubble shows the moment you speak. If the model hasn't said a word after 3 seconds (`FILLER_AFTER_MS`), the NPC says a short filler line from their file ("Hold on.", "Ah, now...") while it keeps thinking.
- **You see what happens** (typed events, below): a mood shows as an emote over their head (😊 😠 😨), coin and items float up from whoever gained or lost them, the Inventory tab glows when something lands in your pack, a hit flashes its target (and shakes the screen when it's you), and a new job offer gets a ❗.
- **Say it your way:** the dropdown next to the chat box switches between Say, Persuade, Intimidate, Haggle and Lie. Rolls show in the chat. Or **speak**: hold the 🎙 button (or `V` when you're not typing), talk, and let go.
- **Offers** (quests, sales, purchases, training, favours, amends, rooms and healing) appear as Accept/Decline cards. Nothing costs you until you accept.
- **Buttons:** Hand in quests, Train…, Wares, Repair…, Look, Introduce yourself, Give…, Ask a favour…, Order… / Collect order, Repay loan, Steal…, Pay fine / Give yourself up (at a guard), Dismiss (a companion), Flee, Ability… (in a fight), Subdue, Attack, and one-click opening lines. Dilemmas, hires and orders appear as cards. Click someone lying dead or out cold to loot them.
- **Side panel:** your look, attributes (with +1 buttons for level points), MP, statuses and ailments, skills, inventory, quests (and failed ones), your journal by NPC, a World tab: reputation, bounty, factions (Join), who's travelling with you, and the chronicle, and a **Realm tab** ([`realm.ts`](packages/client/src/ui/realm.ts)): a map of the kingdoms and their towns and villages (click one for its people, coffers, buildings, head and taxes), the adventurers' guild (Join) and dungeons in reach (Delve), wars, treaties, factions with their ranks, notable people and who they answer to, beasts, dungeons, the realm's news (and whether your place has heard it yet) and what the director pushed. The server sends the whole realm on `GET /api/realm`. **Header:** clock, weather and season, HP, MP, money, Forage, Craft…, Sneak, Wait 1h/4h, ▶ Simulate, 🔊 Voices, New game, model status (and how many actions are waiting).
- **Simulate mode** ([`simulate.ts`](packages/client/src/simulate.ts)): press **▶ Simulate** and the village lives on its own while you watch. The player does nothing; the clock keeps moving (1h every 3s, 1h every second, 4h every half second, or a day every half second) through the same village tick as Wait, so NPCs work, trade, train, rank up, court, marry, age and die, creatures come and go, and bandits raid. The feed shows what happened (the clock pill shows the time, so there's no "Time passes" line per step) and the World tab's chronicle fills up. It pauses while a fight is on (time can't pass mid-fight) and stops when you press a key or click the map.
- **One thing at a time, in line:** on 8 GB Ollama runs one reply at a time, so the server queues actions ([`queue.ts`](packages/server/src/web/queue.ts)) instead of turning a second one away. Past 8 waiting it asks you to try again.
- Saves to the same `saves/world.json` as the CLI, after every action. `PORT=3001 npm run web` changes the port; `npm run web -- --new` starts fresh.
- **Walk out of the village** (N15): signposts on the map's edge lead out of the village. In a place with a road out, north up the road (and from there to a gang's camp or a dungeon's mouth) and east into the woods. Step onto one and you're on that place's own map, 15 minutes' walk later; step back to return.
- **Crowds** (N16): every one of a place's people walks its streets (see *Crowds and classes* above); the view is 26×18 tiles and follows you round bigger places. Time flows while you stand about (⏸ Time to make it wait).
- Limits: there is no `/use` button yet. Maps are drawn in code from the place (no image files); a village's size depends on what it is (a hamlet 26×18, a capital 96×64), the localities are 26×18.

**Typed events** ([`events.ts`](packages/shared/src/events.ts), [`turnEvents.ts`](packages/server/src/game/turnEvents.ts)): every action's stream ends with what changed, worked out by comparing the game state before and after (so every path reports the same way, model or not): `mood_changed`, `trust_changed`, `item_moved`, `gold_moved` (paired up: what you lost and the NPC gained went from you to them), `hp_changed`, `attack`, `quest_offered`, `npc_busy`, `npc_died`, `following`. The CLI prints them after each command as `[events] …`.

**The HTTP API** (types in [`protocol.ts`](packages/shared/src/protocol.ts)): `GET /api/state`, `GET /api/crowd` (everyone who lives on the map you're on, N16), `POST /api/tick` (a minute passes while you stand about, N16), `POST /api/move`, `POST /api/act` (newline-delimited JSON: `text`, `filler`, `queued`, `note`, `system`, `event`, … then `done` with the new state), `GET /api/quote`, `POST /api/new`, `GET /api/voice`, `POST /api/speak`; and for the admin page (N17, this machine only; types in [`admin.ts`](packages/shared/src/admin.ts)) `GET /api/admin/{overview,clock,health,events,event,search,card,pinned,player,crowd}` and `POST /api/admin/time`.

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
| `/realm [place]` | The realm: kingdoms, wars, factions, treaties, your place (or any place: its people, coffers, buildings, head and who they answer to) |
| `/factions all`, `/news` | Every faction in the realm with its ranks and halls; realm news that has reached your place |
| `/joinguild`, `/delve [dungeon]` | Join the adventurers' guild (5 silver); delve a dungeon within a day of where you are |
| `/routes`, `/travel <place>` | Where the roads go from here, how long and what's on them; go there (the world lives the hours) |
| `/family` | Marriages, courtships, children on the way, and the children born in play, with their gifts |
| `/propose` | Ask the NPC you're talking to to marry you (needs `ROMANCE=on`, and being together) |
| `/state` | Everything about you and the NPC (debug) |
| `/trust <n>` | Set trust (testing shortcut) |
| `/save` | Save now (it also saves after every action) |
| `/quit` | Leave |

Free commands (`/state`, `/quests`, `/where`, `/go`, `/look`, `/journal`, `/wait`, `/use`, `/save`, `/factions`, `/reputation`, `/raise`, `/join`, `/party`, `/dismiss`, `/chronicle`, `/family`, `/forage`, `/craft`, `/sneak`, `/loot`, `/realm`, `/news`, `/joinguild`, `/delve`, `/routes`, `/travel`) work even when the NPC is busy or not there.

## People, and adding a kind of person

Nobody is written by hand: people are made from templates as places are met (N25a). To add a **kind of person**, add a template in [`src/data/templates/`](packages/server/src/data/templates) (copy `smith.json`: ranges for age, rank, traits, attributes, skills, stock, money and prices; a schedule; voices; fallback words), map it to a realm role in [`realm/notables.ts`](packages/server/src/game/realm/notables.ts) (`TEMPLATE_FOR`) or a townsperson job in [`realm/townsfolk.ts`](packages/server/src/game/realm/townsfolk.ts), and add pool entries for it in [`src/data/templates/depth/`](packages/server/src/data/templates/depth) (fears, loves, quirks, secrets, dilemmas, arcs, what the town says of them, each with a `when` and no people named). `npm run gen -- <template>` shows what it gives; `npm run check-npcs` checks the templates, the pools and 120 generated people against the schema and the lint.

For **a test of one NPC's mechanics**, the six fixtures in `packages/server/tests/fixtures/npcs/` (`makeTown()`, `fixtureNpc()` in `tests/helpers.ts`) are the only hand-written files; tests of the world use generated worlds (`makeWorldTown()`, `talkerByJob()`) and pick people by job, never by name. Every persona, fixture or generated, has the same shape:

| Field | Notes |
|---|---|
| `species`, `age`, `tier`, `potential` | Species (default `human`, must be one that talks), age in years at the start, starting rank, and the highest rank they can ever reach (same as `tier` = never grows) |
| `name`, `role`, `personality`, `speechStyle`, `backstory`, `goals` | Goes into the system prompt. Don't put secrets here (including in `goals`) |
| `knows` | Which lore they know: `{ "place.ashby.*": "certain", "realm.*": "rumour" }` (generated people get theirs from [`realm/lore.ts`](packages/server/src/game/realm/lore.ts)). An exact id, `x.*` (x and everything under it) or `*`; the most specific wins. A scope that matches nothing fails to load |
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
| `faction`, `successor`, `successorOf` | A faction kind (`gang`, `guard`, `merchants`: [`src/data/factions/kinds/`](packages/server/src/data/factions/kinds)); who takes over when they die; a successor waits out of the world until then (generated people have none: an adult child inherits, `family.ts`) |
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
    depth/            generated depth for every talker: facts.ts (what is true), fallback.ts + pools.ts (code's words), story.ts + validate.ts (the model's, checked) (N25a)
    review/           lives that change: inputs, rules, model, validate, apply, impact (N25b)
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
    deathNews.ts      who knows of a death, and when: news, not telepathy (N13.0)
    site.ts talkers.ts catchup.ts   per-place state, the one registry of talking people, catching a place up (N25a)
    reviews.ts        life reviews for talkers: when, who proposes, batching, applying (N25b)
    people/           townsfolk lives (N25): step.ts (a day), outlook.ts (how they change, N25b), migration.ts ...
    road/             the open road (N26): generateRoads.ts, walk.ts, play.ts, journeys.ts, day.ts, exchange.ts, encounters.ts, presence.ts, trips/,
                      situations.ts, threats.ts, needs.ts, mounts.ts, camp.ts, fast.ts, coach.ts, caravans.ts, bounds.ts
    realm/            the wider realm (N13): types.ts (schemas), generate.ts, figures.ts, economy.ts, politics.ts,
                      factions.ts, diplomacy.ts, military.ts, wilds.ts, rise.ts, director.ts, news.ts,
                      day.ts (one day of it), view.ts (/realm and the Realm tab), names.ts, log.ts,
                      travel.ts (routes, the road), notables.ts (a place's talking people), start.ts (the start town),
                      lore.ts (all lore, generated), needs.ts, arrivals.ts, spawnrules.ts, sync.ts (N25a),
                      townsfolk.ts (everyone who lives in a place, their classes and their files, N16)
  director/           the world director: chronicle.ts, validator.ts, revenge.ts, and background work
                      (planning.ts, summary.ts, flavor.ts, background.ts, structured.ts)
  data/templates/     farmer, guard, merchant, child (N11.1), bandit (N13.7), smith, innkeeper (N25a); depth/ (fears, loves, quirks, secrets, dilemmas, arcs, reputation)
  data/factions/kinds/ guard.json, merchants.json, gang.json: ranks, discounts and attitudes by kind
  data/creatures/     wolf.json, bandit.json, horse.json, villager.json
  world/world.ts      the bare test world, the player and starting creatures
  world/species.ts    species: lifespans, rank caps, learn rates
  web/
    server.ts         HTTP server for the browser game: state, movement, streamed NPC turns
    map.ts            what every map shares: tiles, sizes, looks drawn from a seeded palette (N15)
    sites.ts          a map for every place and its localities, made from the realm, sized to the place (N14-N16)
web/                  browser client (index.html, game.js, style.css), no build step
tests/                unit tests (fake model) + live.test.ts (real model)
scripts/bench.ts      behaviour pass rates against the real model
scripts/bench-traits.ts  do attack and flee rates follow traits? (real model)
scripts/sim.ts        trait rules with seeded dice and a scripted model
scripts/bench-director.ts  the world director against the real model
scripts/generate-npc.ts  npm run gen: print a person made from a template (N11.1)
scripts/generated.ts     the generated cast the benchmark and simulation scripts run on (N25a)
scripts/bench-reviews.ts npm run bench:reviews: the model's life reviews against the checks (N25b)
scripts/check-npcs.ts    npm run check-npcs: the authoring check (T5), on templates and generated people
scripts/bench-style.ts   npm run bench:style: the blind voice test and consistency checks (T15)
scripts/sim-realm.ts     npm run sim:realm: a seeded run of the realm, for balance (N13)
scripts/bench-storage.ts npm run bench:storage: 50,000 people saved and loaded against a budget (N18)
scripts/bench-busy.ts    npm run bench:busy: a busy week of model work against the budgets (N19)
budgets.ts               every budget: model calls by kind, tick and frame times, queue wait (N19)
llm/budgeted.ts          BudgetedProvider and ModelLedger: counts, caps and logs every model call (N19)
metrics/                 timing ring buffers (N17), checkBudgets (N19), the busy-week simulation (N19)
scripts/world.ts         npm run world:export / world:import: a whole world as one file (N18)
store/                   people in SQLite: schema, PeopleStore (batches), materialise, export/import, lock (N18)
```

See [ROADMAP.md](ROADMAP.md) for what's done and what's next.
