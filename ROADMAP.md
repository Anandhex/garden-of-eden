# Roadmap: LLM-driven NPCs (local, with Ollama)

The core idea behind every phase: **the LLM handles the talking and suggests actions. The game owns the state and decides what really happens.** The model never changes game state directly. It calls tools (`give_item`, `change_mood`, …), your code checks each call against the rules, and the result goes back to the model so the NPC can react ("Wait, I'm out of daggers.").

This matters even more with small local models. They will sometimes call the wrong tool, pass bad arguments, or forget to call a tool at all. Your code is the safety net.

**How this roadmap is organised:**
- **Foundation (F1–F4):** what's already built.
- **NPC track (N0–N16):** who NPCs are and the RPG rules behind them, in build order. Each phase holds all the features that belong to it (numbered like N5.3).
- **Living world track (N17–N68), in seven stages, with a vertical slice first:** the world running on its own: an admin view, everyone living, gossiping and choosing, uprisings, crackdowns, runaways, new settlements and kingdoms, stories, seasons, disease, disasters, ecology, ambitions, feuds, secrets, crime, belief, legends, a world that reaches out to the player, a quest market shared with NPC adventurers, armies of real soldiers, law, cultures, the player's own life, a realm to walk and explore (the open road, the wilds, and rich fauna and flora), other peoples and monsters (goblins, orcs, giants, dragons) with settlements, kingdoms and alliances of their own, magic with rules and laws, items with a history, leisure and contests, interiors and homes, a soundscape, the storage, budgets and balance tests that keep it all running, and what makes the player care: a nemesis, callbacks to their choices, a strong first hour, following people, shaping beliefs, setbacks instead of game over, moving through time and sharing worlds.
- **Tooling track (T1–T15):** tests, simulation, checks and evals that keep the NPC track honest.
- **Game track (G1–G4):** the playable game around the NPCs: browser client, game feel, performance and shipping.

Each track has its own file (see **Where things are** below). Mark items `[x]` as you go, `[~]` for partly done. Each phase ends with a **Done when** check: don't move on until it passes. For what NPCs can do today, see [README.md](README.md).

## Where things are

| Track | File | What's in it |
|---|---|---|
| Foundation (F1–F4) | [roadmap/foundation.md](roadmap/foundation.md) | ✅ First conversation, stronger NPCs, RPG systems, testing |
| NPC track (N0–N16) | [roadmap/npc-track.md](roadmap/npc-track.md) | ✅ Who NPCs are and the RPG rules behind them, through the realm, travel, localities and crowds |
| Living world track (N17–N68) | [roadmap/living-world/](roadmap/living-world/README.md) | ⬜ The vertical slice, then seven stages, one file each: [1 Foundations](roadmap/living-world/stage-1-foundations.md) · [2 Everyone lives](roadmap/living-world/stage-2-everyone-lives.md) · [3 NPCs choose](roadmap/living-world/stage-3-npcs-choose.md) · [4 Society](roadmap/living-world/stage-4-society.md) · [5 Power and conflict](roadmap/living-world/stage-5-power-and-conflict.md) · [6 A changing world](roadmap/living-world/stage-6-a-changing-world.md) · [7 The player in the world](roadmap/living-world/stage-7-the-player-in-the-world.md) |
| Tooling track (T1–T15) | [roadmap/tooling.md](roadmap/tooling.md) | 🟡 Tests, simulation, checks and evals |
| Game track (G1–G4) | [roadmap/game.md](roadmap/game.md) | 🟡 The browser client, game feel, performance, shipping |

**Next up:** the [vertical slice](roadmap/living-world/README.md#milestone-the-vertical-slice), starting with [N17 The admin world view](roadmap/living-world/stage-1-foundations.md#n17-the-admin-world-view).

## Status

| Track | Item | Status |
|---|---|---|
| Foundation | F1 First conversation · F2 Stronger NPCs · F3 RPG systems · F4 Testing | ✅ Built |
| NPC | N0 Fixes in what exists | ✅ Built |
| NPC | N1 Personality traits | ✅ Built (every trait drives a rule; `npm run sim`, `npm run bench:traits`) |
| NPC | N2 Saves | ✅ Built (CLI and browser share `saves/world.json`) |
| NPC | N3 World knowledge and non-talking NPCs | ✅ Lore and knowledge scopes (N3.1); creatures, spawn rules, `defeat` quests and the bandit leader (N3.2); ranks, species and age (N3.3) |
| NPC | N4 Character depth | ✅ Cover stories, quirks, learning your name, appearances and `/look` (`tests/n4.test.ts`) |
| NPC | N5 Memory and relationships | ✅ Event log, memory, four relationship axes, grudges, favours, fears and loves, emotions, lies, promises, friendship, journal (`tests/n5.test.ts`) |
| NPC | N6 Daily life | ✅ Schedules, needs, places, the village living together, signature moves, services, NPCs who speak first, weather and town events, group scenes (`tests/n6.test.ts`) |
| NPC | N7 The social web | ✅ NPC-to-NPC relationships, gossip, witnesses, reputation, crime and the guard, rumours, dilemmas, factions, successors, theft and stealth (`tests/n7.test.ts`) |
| NPC | N8 Combat and health | ✅ Combat styles, MP abilities, statuses, subdue and loot, raids in sight, injuries and illness, companions (`tests/n8.test.ts`) |
| NPC | N9 Quests, growth and story arcs | ✅ Seven goal types, chains, deadlines, quest flavour, skill trials, growth challenges, trait drift, player growth, arcs (`tests/n9.test.ts`) |
| NPC | N10 Crafting and economy | ✅ Input tiers, stock and demand prices, restocking and NPC trade, `offer_commission` (`tests/n10.test.ts`) |
| NPC | N11 Growing the cast | ✅ NPCs from templates (`npm run gen`), Pip the errand girl, and families: courtship, marriage, children who inherit talents and grow up (`tests/n11.test.ts`, `npm run bench:style`) |
| NPC | N12 The world director | ✅ Event log with witnesses, revenge goals, nightly chronicle, director quests, character drift (`tests/n12.test.ts`, `npm run bench:director`) |
| NPC | N13 The wider realm | ✅ Kingdoms, towns and villages, prosperity and building, taxes up the chain, factions and splits, treaties, raids and wars, beasts and dungeons, named risers and new talking NPCs, an active director, death as news (`tests/n13.test.ts`, `npm run sim:realm`) |
| NPC | N14 Travel | ✅ Walk the realm's roads to any place: a map and talking people for every town and village, encounters on the road (`tests/n14.test.ts`) |
| NPC | N15 Localities | ✅ Millbrook's map generated like every place's; the mine road, the bandit camp, the old mine and the woods are maps of their own around it; Millbrook's mayor and guard captain talk; everyone remembers by meaning (`tests/n15.test.ts`, save v10) |
| NPC | N16 Crowds and classes | ✅ Maps sized to the place; every one of a place's people on its map, living their day minute by minute and talking to each other by rank and faction; anyone can be talked to, only traders sell; slaves, serfs, commoners, craftsmen, merchants, clergy, gentry, nobles and royals; the cast's breaks; time flows while you stand about (`tests/n16.test.ts`) |
| Living world · slice | [Milestone: the vertical slice](roadmap/living-world/README.md#milestone-the-vertical-slice) | ⬜ Planned (Millbrook and Highdale; play, then revise) |
| Living world · S1 | [N17 The admin world view](roadmap/living-world/stage-1-foundations.md#n17-the-admin-world-view) | ⬜ Planned (read-only first; pin NPCs, the player or a place) |
| Living world · S1 | [N18 Scale and storage](roadmap/living-world/stage-1-foundations.md#n18-scale-and-storage) | ⬜ Planned |
| Living world · S1 | [N19 Performance and model-call budgets](roadmap/living-world/stage-1-foundations.md#n19-performance-and-model-call-budgets) | ⬜ Planned |
| Living world · S1 | [N20 Stories, drama and liveness metrics](roadmap/living-world/stage-1-foundations.md#n20-stories-drama-and-liveness-metrics) | ⬜ Planned |
| Living world · S1 | [N21 Callbacks to the player's choices](roadmap/living-world/stage-1-foundations.md#n21-callbacks-to-the-players-choices) | ⬜ Planned ("you spared him; he leads the revolt now") |
| Living world · S1 | [N22 Long-run balance tests](roadmap/living-world/stage-1-foundations.md#n22-long-run-balance-tests) | ⬜ Planned |
| Living world · S1 | [N23 Sharing worlds](roadmap/living-world/stage-1-foundations.md#n23-sharing-worlds) | ⬜ Planned |
| Living world · S1 | [N24 Global reporting](roadmap/living-world/stage-1-foundations.md#n24-global-reporting) | ⬜ Planned |
| Living world · S2 | [N25 Townsfolk lives](roadmap/living-world/stage-2-everyone-lives.md#n25-townsfolk-lives) | ⬜ Planned (age, marry, die, rise; levels of detail) |
| Living world · S2 | [N26 The open road](roadmap/living-world/stage-2-everyone-lives.md#n26-the-open-road) | ⬜ Planned (a walkable journey, not a time skip) |
| Living world · S2 | [N27 The wilds](roadmap/living-world/stage-2-everyone-lives.md#n27-the-wilds) | ⬜ Planned (off-road exploration and discovery) |
| Living world · S2 | [N28 Fauna and flora](roadmap/living-world/stage-2-everyone-lives.md#n28-fauna-and-flora) | ⬜ Planned (rich wildlife and plants by terrain and season) |
| Living world · S2 | [N29 A soundscape](roadmap/living-world/stage-2-everyone-lives.md#n29-a-soundscape) | ⬜ Planned (ambient sound by place, time and weather) |
| Living world · S2 | [N30 Seasons and the farming year](roadmap/living-world/stage-2-everyone-lives.md#n30-seasons-and-the-farming-year) | ⬜ Planned |
| Living world · S2 | [N31 Visible consequences on the map](roadmap/living-world/stage-2-everyone-lives.md#n31-visible-consequences-on-the-map) | ⬜ Planned |
| Living world · S2 | [N32 Interiors and homes](roadmap/living-world/stage-2-everyone-lives.md#n32-interiors-and-homes) | ⬜ Planned (enterable buildings that show their owners) |
| Living world · S2 | [N33 Gossip for everyone](roadmap/living-world/stage-2-everyone-lives.md#n33-gossip-for-everyone) | ⬜ Planned |
| Living world · S2 | [N34 Following people in the game](roadmap/living-world/stage-2-everyone-lives.md#n34-following-people-in-the-game) | ⬜ Planned |
| Living world · S2 | [N35 Moving through time](roadmap/living-world/stage-2-everyone-lives.md#n35-moving-through-time) | ⬜ Planned |
| Living world · S2 | [N36 The mood of a place](roadmap/living-world/stage-2-everyone-lives.md#n36-the-mood-of-a-place) | ⬜ Planned |
| Living world · S3 | [N37 Chatter with consequences](roadmap/living-world/stage-3-npcs-choose.md#n37-chatter-with-consequences) | ⬜ Planned (NPC insults and revenge) |
| Living world · S3 | [N38 NPCs as living players](roadmap/living-world/stage-3-npcs-choose.md#n38-npcs-as-living-players) | ⬜ Planned |
| Living world · S3 | [N39 The first hour](roadmap/living-world/stage-3-npcs-choose.md#n39-the-first-hour) | ⬜ Planned (an opening incident from the world's own state) |
| Living world · S3 | [N40 Ambitions and careers](roadmap/living-world/stage-3-npcs-choose.md#n40-ambitions-and-careers) | ⬜ Planned |
| Living world · S3 | [N41 Leisure and contests](roadmap/living-world/stage-3-npcs-choose.md#n41-leisure-and-contests) | ⬜ Planned (tavern games, tournaments, fairs) |
| Living world · S3 | [N42 A shared quest market and adventurer grades](roadmap/living-world/stage-3-npcs-choose.md#n42-a-shared-quest-market-and-adventurer-grades) | ⬜ Planned (NPCs take quests and climb grades) |
| Living world · S3 | [N43 Items with a history](roadmap/living-world/stage-3-npcs-choose.md#n43-items-with-a-history) | ⬜ Planned (named items people recognise) |
| Living world · S3 | [N44 A nemesis](roadmap/living-world/stage-3-npcs-choose.md#n44-a-nemesis) | ⬜ Planned (an enemy who remembers and adapts) |
| Living world · S4 | [N45 Family feuds and inheritance](roadmap/living-world/stage-4-society.md#n45-family-feuds-and-inheritance) | ⬜ Planned |
| Living world · S4 | [N46 Secrets, spies and blackmail](roadmap/living-world/stage-4-society.md#n46-secrets-spies-and-blackmail) | ⬜ Planned |
| Living world · S4 | [N47 The underworld](roadmap/living-world/stage-4-society.md#n47-the-underworld) | ⬜ Planned |
| Living world · S4 | [N48 Law and trials](roadmap/living-world/stage-4-society.md#n48-law-and-trials) | ⬜ Planned |
| Living world · S4 | [N49 Setbacks instead of game over](roadmap/living-world/stage-4-society.md#n49-setbacks-instead-of-game-over) | ⬜ Planned (capture, debt, exile, slavery as new chapters) |
| Living world · S4 | [N50 Belief](roadmap/living-world/stage-4-society.md#n50-belief) | ⬜ Planned |
| Living world · S4 | [N51 Magic](roadmap/living-world/stage-4-society.md#n51-magic) | ⬜ Planned (schools, costs, laws per kingdom) |
| Living world · S4 | [N52 Shaping what people believe](roadmap/living-world/stage-4-society.md#n52-shaping-what-people-believe) | ⬜ Planned |
| Living world · S4 | [N53 Cultures and languages](roadmap/living-world/stage-4-society.md#n53-cultures-and-languages) | ⬜ Planned |
| Living world · S5 | [N54 Peoples and monsters](roadmap/living-world/stage-5-power-and-conflict.md#n54-peoples-and-monsters) | ⬜ Planned (goblins, orcs, giants, dragons…; their settlements, kingdoms and alliances; rare talkers living among humans) |
| Living world · S5 | [N55 Armies, soldiers and the war dead](roadmap/living-world/stage-5-power-and-conflict.md#n55-armies-soldiers-and-the-war-dead) | ⬜ Planned (NPCs enlist and rank up; war dead recorded apart) |
| Living world · S5 | [N56 Grievances and uprisings](roadmap/living-world/stage-5-power-and-conflict.md#n56-grievances-and-uprisings) | ⬜ Planned |
| Living world · S5 | [N57 Player-led factions](roadmap/living-world/stage-5-power-and-conflict.md#n57-player-led-factions) | ⬜ Planned (found, lead and be betrayed) |
| Living world · S5 | [N58 Kingdoms react to unrest](roadmap/living-world/stage-5-power-and-conflict.md#n58-kingdoms-react-to-unrest) | ⬜ Planned |
| Living world · S5 | [N59 Runaways and liberation](roadmap/living-world/stage-5-power-and-conflict.md#n59-runaways-and-liberation) | ⬜ Planned (free kingdoms' runaway policy) |
| Living world · S6 | [N60 Ecology](roadmap/living-world/stage-6-a-changing-world.md#n60-ecology) | ⬜ Planned |
| Living world · S6 | [N61 Epidemics](roadmap/living-world/stage-6-a-changing-world.md#n61-epidemics) | ⬜ Planned |
| Living world · S6 | [N62 Disasters](roadmap/living-world/stage-6-a-changing-world.md#n62-disasters) | ⬜ Planned |
| Living world · S6 | [N63 Exploration, roads and new settlements](roadmap/living-world/stage-6-a-changing-world.md#n63-exploration-roads-and-new-settlements) | ⬜ Planned |
| Living world · S6 | [N64 New kingdoms](roadmap/living-world/stage-6-a-changing-world.md#n64-new-kingdoms) | ⬜ Planned |
| Living world · S7 | [N65 The player's view](roadmap/living-world/stage-7-the-player-in-the-world.md#n65-the-players-view) | ⬜ Planned |
| Living world · S7 | [N66 The player's own life](roadmap/living-world/stage-7-the-player-in-the-world.md#n66-the-players-own-life) | ⬜ Planned |
| Living world · S7 | [N67 NPCs come to you, and reputation by place](roadmap/living-world/stage-7-the-player-in-the-world.md#n67-npcs-come-to-you-and-reputation-by-place) | ⬜ Planned |
| Living world · S7 | [N68 Legends, songs and the realm's history](roadmap/living-world/stage-7-the-player-in-the-world.md#n68-legends-songs-and-the-realms-history) | ⬜ Planned |
| Tooling | T1–T15 | 🟡 **T1–T4 core pieces built; T5 authoring check built (N11); T13 typed events and T14 voices built (Piper measured); T15 blind voice test built (N11.2)** |
| Game | G1 Real game | ✅ Phaser 3 client in an npm-workspaces monorepo (`packages/server`, `packages/client`, `packages/shared`), request queue, typed events animated, latency hidden (`packages/server/tests/server.test.ts`, `uiVoice.test.ts`) |
| Game | G2 Game feel | 🟡 Partly done (filler lines on a slow first token added) |
| Game | G3 Performance | 🟡 Mostly done (first-token time and memory pressure now measured by `npm run bench:voice`) |
| Game | G4 Ship | ⬜ |

## Setup

- **Machine:** M2 with 8 GB RAM. Plan for **one 3–4B model** loaded at a time.
- **Main model: `qwen3:4b-instruct`.** It was the only small model that used tools reliably. Results on the same scenarios:
  - **`qwen3:4b-instruct`:** 25/30, about 1.6 s per turn.
  - **`llama3.2`:** never spoke when tools were available, and gave items away.
  - **`qwen3:1.7b`:** never called a tool.
  - **`granite4:1b`:** one-word replies, and used *more* memory than the 4B model.
  - **Avoid plain `qwen3:4b`:** it always reasons first (about 40 s per reply), even with `think: false`.
- **Settings:** `num_ctx: 4096` (8192 cost 0.5 GB more for no gain), `think: false`, `keep_alive: 30m`, and warm-up with an *empty* message list. Generating a token to warm up leaked junk like ":end" into the first reply.
- **Avoid on 8 GB:** `llama3.1` (8B). It runs, but with a browser and the game open it swaps memory to disk and gets slow.
- **Voices:** the browser's own speech by default (no memory). Piper is optional: one voice model, ~270 MB, 0.1–0.6 s per sentence (T14). With the model, a browser and Piper open, the Mac swaps; close other apps first.
- **Library:** the official `ollama` npm package (`import ollama from "ollama"`). It talks to `http://localhost:11434`.

## Design rules

Every phase in every track follows these. They come from "Lessons learned" at the end.

1. **Code owns the numbers.** Every roll, price, timer, threshold and state change happens in `src/game/` or `src/npc/actions.ts`. The model only proposes; the game decides.
2. **The model gets words, not maths.** Turn numbers into labels in code ("badly wounded", "you can afford: …") before they reach the prompt.
3. **Gate tools and context by topic.** A new tool appears only on turns where it makes sense, and a new situation line only when it's relevant. Each one costs accuracy elsewhere.
4. **Offer, then confirm.** Anything that costs the player gold, items, time or freedom is an offer they accept or decline.
5. **Data before prompts.** A new behaviour should be a field in the NPC file and a rule in code. Prompt wording comes last.
6. **Measure every phase.** Each phase adds unit tests (fixed dice and fake model) and at least one `npm run bench` scenario, and must not drop existing pass rates.
7. **Content limits are rules too.** What the game allows (violence towards whom, romance, mature themes) is set in config and enforced in code, per NPC, before any feature that touches it. NPCs marked `minor` never get romance and follow the chosen combat rule. Decide this before writing a child NPC.

## What an NPC is made of

The target model. Each phase fills in part of it.

| Layer | Changes | Lives in | Example | Status |
|---|---|---|---|---|
| **Identity** | Never | NPC file | name, role, backstory, speech style, appearance | ✅ appearance and quirks (N4) |
| **Traits** | Slowly, from big events (N9) | NPC file + save | greed, temper, bravery, honesty, generosity, sociability, forgiveness (0–1) | ✅ (N1) |
| **Species and age** | Age grows daily | NPC file + save | human, 68 years old (elder): weaker body, slower learning; natural death possible | ✅ (N3.3) |
| **Abilities** | Slowly, by overcoming challenges (N9) | NPC file + save | attributes, skills, rank (G–SSS) up to a potential, titles, gear | ✅ ranks and titles (N3.3), gear (N8), skill trials and attribute milestones (N9) |
| **State** | Every turn | Save | mood, HP, gold, stock, job, offers | ✅ (saved: N2) |
| **Needs** | Every hour | Save | hunger, energy, money, materials | ✅ (N6) |
| **Knowledge** | Per event | World lore + save | what they know of the town, places and people, and how sure they are | ✅ lore scopes (N3.1); the player's name by gossip (N4.3); lore learned in play, rumours about each other (N7); lore the chronicle adds (N12) |
| **Memory** | Per event | Save | "the player insulted me on day 2", the player's name | ✅ importance that fades, recall by weight (N5), the name (N4.3), emotions (N5.3) |
| **Relationships** | Per event | Save | trust, fear, respect and affection towards the player and other NPCs | ✅ towards the player (N5, N5.6) and towards each other (N7) |
| **Health** | Per hour | Save | HP, MP, injuries, illness | ✅ HP and MP (N0), statuses (N8), injuries and illness (N8.1) |
| **Schedule** | Per day | NPC file | forge 6–18, inn 18–21, sleep | ✅ (N6) |
| **Reputation** | Per event | Save | how the town sees the player | ✅ titles (N3.3), the town's view from what people saw and heard, faction standing (N7) |

---

## Order and checkpoints

**The NPC track, in order:**

1. **N0 Fixes:** ✅ done.
2. **N1 Traits:** ✅ done.
3. **N2 Saves:** next (core save/load is in). Memory, grudges and schedules mean nothing if they're lost on restart.
4. **N3 World knowledge and non-talking NPCs:** prerequisites, before the world grows.
5. **N4 Character depth:** cheap data-and-rules features.
6. **N5 Memory and relationships → N6 Daily life → N7 Social web:** the heart of living NPCs. Do them in this order.
7. **N8 Combat and health, N9 Quests and growth, N10 Economy:** any order once N6 exists. Pick the one your game needs most.
8. **N11 Growing the cast:** once the town needs more people.
9. **N12 The world director:** after N5, N7 and N9. Its event log and revenge goals can come earlier; they help N5 and N7 too.
10. **N13 The wider realm:** after N12. N13.0 (death news) first, then N13.1 and the rest in order.
11. **N14 Travel, then N15 Localities:** ✅ both done.
12. **N16 Crowds and classes:** ✅ done.
13. **The living world track (N17–N68), by stage:**
    - **First, the vertical slice:** N17 → N18 → N25 → N26 → N33 → N37 → N38 → N40 for Millbrook, Highdale and the road between; play it and revise this plan before going on. Then finish the stages:
    - **Stage 1: Foundations:** N17 → N18 → N19 → N20 → N21 → N22 → N23 → N24
    - **Stage 2: Everyone lives:** N25 → N26 → N27 → N28 → N29 → N30 → N31 → N32 → N33 → N34 → N35 → N36
    - **Stage 3: NPCs choose:** N37 → N38 → N39 → N40 → N41 → N42 → N43 → N44
    - **Stage 4: Society:** N45 → N46 → N47 → N48 → N49 → N50 → N51 → N52 → N53
    - **Stage 5: Power and conflict:** N54 → N55 → N56 → N57 → N58 → N59
    - **Stage 6: A changing world:** N60 → N61 → N62 → N63 → N64
    - **Stage 7: The player in the world:** N65 → N66 → N67 → N68
    Why this order: the admin view, storage, budgets and balance tests come before the world gets big; people must be real (Stage 2) before they can choose (Stage 3); society and conflict need choosers; the map grows once the people and powers on it are working; the player-facing phases come last, when there's the most to show.

**Alongside:**
- **Tooling:**
  - **T1–T4 any time, the sooner the better.** They make every later phase cheaper to test.
  - **T5, T7, T8, T11 and T12: now** (N1 is done).
  - **T9 after N2, T10 after N9.**
  - **T13 before G1, T14 after G1.** ✅ Both done with G1 (2026-10-11).
  - **T15 grows with every NPC phase.**
- **Game:** G1 can start after N2 and run in parallel with the NPC track. G2–G4 follow G1. ✅ G1 is done; next are the rest of G2 (barks, content settings, output clean-up) and G3's targets as a check.

**At the end of every phase:** run `npm test`, `npm run bench` and `npm run test:live`. If a pass rate drops, fix it before moving on: gate the new tool or line (design rule 3), or reword it firmly (Lessons 4–6).

---

## Lessons learned (small local models)

Things the tests and benchmark showed. Each fix is in the code, with a comment explaining why.

1. **Rules in code, not in the prompt.**
   - Secrets left in the prompt leaked at trust 0.
   - The model got "can 50 gold buy a 40-gold sword?" wrong, so the answer is now worked out in code and handed to it.
2. **Every extra tool makes the model use the others less.**
   - Adding a second tool cut mood changes on insults from 10/10 to 3/10.
   - Showing `offer_to_buy` on every turn cut secret reveals from 5/5 to 1/5.
   - Tools are now only offered when the topic calls for them.
3. **Every extra line of context costs accuracy.** The player's pack, and later the tiered stock list, each cut secret reveals (to 4/10, then 0/10) until they were shown only on trade turns.
4. **Firm wording works:** "ALWAYS call this when …" fixed tools the model kept describing in words instead of calling (`change_mood`, `reveal_secret`, `offer_training`).
5. **Tool names matter:** `offer_quest` was only used when the player said "quest". Renamed `offer_job`, it worked for "work" too.
6. **Watch the wording of rules:** "Each message starts with a `<situation>` block" made the model write one into every reply. "…for you to read; never write one yourself" fixed it.
7. **The model speaks before the game answers.** Prices and terms it says before an offer is checked can be wrong, so that text is dropped and it says the real terms afterwards.
8. **Measure, don't guess:** most of these only showed up as a drop in a pass rate. Run `npm run bench` after every change.
9. **A nudge at the right moment beats a longer prompt (N4–N6).** With the N4–N6 lines in the situation block, Brena stopped calling `reveal_secret` at trust 80 (0/5); taking single lines out didn't bring it back, and taking several out did. What fixed it (8/8) was one line only when the player's words touch the secret: "They're asking about … call reveal_secret first." The same for a broken cover story: Hale came clean 1/3 → 5/5 once the tool's description said he'd been caught out.
10. **Lines mustn't contradict each other.** "You trust them deeply" next to "a stranger you've never met" muddled the model. When two facts pull opposite ways, code should pick the words.

**From the browser game and voices (G1, T14):**

11. **Measure memory the way the OS counts it.** On a Mac under pressure, `ps` RSS read 17 MB for a Piper server whose real footprint was 268 MB: most of its pages were compressed or swapped. `footprint -p <pid>` gives the real figure.
12. **Fill silence, don't just shorten it.** A "…" bubble at once, a filler line after 3 s, and speech from the first sentence cover most of a 3–4 s reply, without touching the model or the prompt.
13. **Check a library against the real thing.** Piper's HTTP server answers on `/synthesize`, not `/`, and needs the `[http]` extra; only running the real server showed it. Tests with fakes passed either way.
14. **npm doesn't pass Ctrl+C on.** A script that starts `npm run web` must stop the whole process group, or the game server keeps running after the script exits.

## Further reading

- Ollama API docs: https://github.com/ollama/ollama/blob/main/docs/api.md
- Ollama JS library: https://github.com/ollama/ollama-js
- Tool calling, streaming, and structured outputs (`format`) are the three features this project leans on most
- *Generative Agents* (Park et al., 2023): the memory/reflection/planning design that Phases 3–4 loosely follow
