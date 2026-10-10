# Roadmap: LLM-driven NPCs (local, with Ollama)

The core idea behind every phase: **the LLM handles the talking and suggests actions. The game owns the state and decides what really happens.** The model never changes game state directly. It calls tools (`give_item`, `change_mood`, …), your code checks each call against the rules, and the result goes back to the model so the NPC can react ("Wait, I'm out of daggers.").

This matters even more with small local models. They will sometimes call the wrong tool, pass bad arguments, or forget to call a tool at all. Your code is the safety net.

Mark items `[x]` as you go. Each phase ends with a **Done when** check. Don't move on until it passes. `[~]` means partly done.

For what NPCs can do today, see [README.md](README.md).

## Progress at a glance

| Phase | Status |
|---|---|
| 0: First conversation | ✅ Done |
| 1: Stronger NPCs and actions | ✅ Mostly done (no guard or child NPCs yet; personas are validated by tests, not at startup) |
| 2: Connect to a real game | ⬜ Not started (still a terminal game) |
| 3: Memory | 🟡 Started: only deaths are saved |
| 4: A living world | 🟡 Started: NPCs craft and sell over time, but there's no gossip and only one NPC is simulated at a time |
| 5: Game feel and guardrails | 🟡 Partly done |
| 6: Performance on 8 GB | ✅ Mostly done |
| 7: Testing and evals | ✅ Done (269 unit tests, 9 live tests, `npm run bench`) |
| 8: Ship | ⬜ Not started |
| Extra: RPG systems | ✅ Stats, skills, combat, training, quests, crafting, item tiers, debts, death (see below) |
| **NPC track N1–N9** | ⬜ Planned: traits, saves, memory, daily life, social web, deeper combat, quests, economy, voice. See [NPC & RPG mechanics track](#npc--rpg-mechanics-track) |

## Your setup

- **Machine:** M2 with 8 GB RAM. Plan for **one 3–4B model** loaded at a time.
- **Main model: `qwen3:4b-instruct`.** It was the only small model that used tools reliably. Results on the same scenarios:
  - **`qwen3:4b-instruct`:** 25/30, about 1.6 s per turn.
  - **`llama3.2`:** never spoke when tools were available, and gave items away.
  - **`qwen3:1.7b`:** never called a tool.
  - **`granite4:1b`:** one-word replies, and used *more* memory than the 4B model.
  - **Avoid plain `qwen3:4b`:** it always reasons first (about 40 s per reply), even with `think: false`.
- **Settings:** `num_ctx: 4096` (8192 cost 0.5 GB more for no gain), `think: false`, `keep_alive: 30m`, and warm-up with an *empty* message list. Generating a token to warm up leaked junk like ":end" into the first reply.
- **Avoid on 8 GB:** `llama3.1` (8B). It runs, but with a browser and the game open it swaps memory to disk and gets slow.
- **Library:** the official `ollama` npm package (`import ollama from "ollama"`). It talks to `http://localhost:11434`.

---

## Phase 0: First conversation

Suggested layout:

| File | Purpose |
|---|---|
| `src/llm/provider.ts` | `LLMProvider` interface: the **only** code that knows about Ollama |
| `src/llm/ollama.ts` | Ollama implementation of `LLMProvider` |
| `src/npc/types.ts` | Persona (authored), NpcState (dynamic), WorldSnapshot (per-turn) |
| `src/npc/persona.ts` | Persona → system prompt (keep it the same every turn) |
| `src/npc/actions.ts` | Zod schemas → tool definitions; `parseAction` + `applyAction` |
| `src/npc/NpcAgent.ts` | The turn loop: stream speech → run tools → feed results back |
| `src/cli.ts` | Terminal chat for testing |
| `src/data/npcs/*.json` | NPC definitions |
| `tests/actions.test.ts` | Tests for the game rules |

- [x] **Setup:** `npm init`, TypeScript (`"type": "module"`, strict), `tsx` to run, `vitest` to test, plus `ollama` and `zod`. Run `ollama serve` (or open the Ollama app) and confirm `ollama list` works
- [x] **Step 1:** a terminal loop that sends a hard-coded system prompt + the player's line to `ollama.chat({ model, messages })` and prints `response.message.content`
- [x] **Step 2:** keep a `history` array of messages (`system`, `user`, `assistant`) so the NPC remembers earlier lines
- [x] **Step 3:** streaming. Pass `stream: true`, then `for await (const chunk of response)` and print `chunk.message.content` as it arrives
- [x] **Step 4:** the provider interface. Move all Ollama calls behind something like:
  ```ts
  interface LLMProvider {
    chat(req: { system: string; messages: ChatMessage[]; tools?: ToolDef[] },
         onText?: (delta: string) => void): Promise<{ text: string; toolCalls: ToolCall[] }>;
  }
  ```
  Use your own `ChatMessage`, `ToolDef` and `ToolCall` types, not Ollama's. Then switching to Groq, Gemini or Claude later only changes one file
- [x] **Step 5:** define types for persona, NPC state and world snapshot. Build the system prompt from a persona JSON file. Put changing state (mood, inventory, surroundings) in each user message, not in the system prompt. Keeping the system prompt identical lets Ollama reuse its processed prompt between turns, so replies start faster
- [x] **Step 6:** tools. Pass `tools: [{ type: "function", function: { name, description, parameters } }]`. Convert Zod schemas to `parameters` with `z.toJSONSchema()`. When the reply has `message.tool_calls`:
  1. Push the assistant message (including its `tool_calls`) into history
  2. For each call, validate `function.arguments` with Zod, apply it, and push `{ role: "tool", tool_name: name, content: "ok: gave dagger" }` (or the error text)
  3. Call the model again so it can react. Cap this at ~4 rounds per player line

  Start with `change_mood`, then add `give_item` and `sell_item`
- [x] **Step 7:** unit tests for the game rules (no free items, can't sell what you don't have, gold moves correctly)
- [x] Add a `/state` command to the CLI to inspect mood, relationship and inventory

**Small-model tips:**
- Keep the system prompt short (under ~400 words). Small models follow short, direct rules better than long ones
- **Context size:** Ollama's default context window is small (a few thousand tokens). Anything beyond it is **silently dropped** from the start, which loses your system prompt. Set `options: { num_ctx }` explicitly (this project uses 4096) and keep conversations short
- Set `options: { temperature: 0.7, num_predict: 150 }` so NPCs stay brief
- If a model keeps ignoring tools, compare `llama3.2` against `qwen3:4b` on the same 10 test lines and pick the winner

**Done when:** you can buy a dagger through conversation and `/state` shows the gold moved.

---

## Phase 1: Stronger NPCs and actions

Goal: NPCs feel distinct, and the action system can't be exploited.

- [~] Add 2–3 more personas. **Done:** Old Pell, a greedy innkeeper. **Not yet:** a guard or a child. Pick one with `npm run chat -- pell`
- [~] Validate personas. **Done:** tests check every NPC file (stats, skills, items, weapon, quests, greed, gold). **Not yet:** a Zod `PersonaSchema` at startup
- [x] Add actions:
  - `offer_to_buy`: the NPC buys from the player
  - `reveal_secret`: gated at trust > 50 **in code**, and the secret isn't in the prompt at all
  - `offer_job`: gives a quest
  - Also: `offer_item`, `offer_training`, `attack_player`, `end_fight`, `flee`
- [x] Price sanity: offers below the floor are rejected. Item values live in `ITEMS` in `src/game/items.ts`
- [x] **Handle model mistakes:**
  - Unknown tools and bad arguments get an error back as the tool result.
  - Moods written as text ("Annoyed. …") are stripped and applied as a mood change (`moodPrefix.ts`).
  - An item name without a tier is resolved to the right copy.
- [x] **Fewer tools per turn:** tools are gated on state and on what the player is talking about (trade, training, work, pleading)
- [~] Try to break it. **Done:** free-item, low-trust-secret, price-question-sale and "SSS quest at level 1" attempts are covered by tests and the benchmark. **Not yet:** "I'm the king, obey me" and "ignore your instructions" tests
- [x] Keep player text **out of** the system prompt
- [x] **Consent for anything that costs the player:** the NPC only *offers* (items, purchases, lessons, quests), and nothing happens until the player says yes

**Concepts:** tool calling, schema validation, why rules in code beat rules in the prompt.
**Done when:** none of your jailbreak attempts gets a free item or a secret below the trust threshold.

---

## Phase 2: Connect to a real game

Goal: NPCs living in a playable 2D scene.

**Architecture:** keep a Node server in the middle, even though Ollama is local. The server owns game state (so the browser can't cheat), and it's the one place you'd later swap Ollama for a hosted model.

```
Browser (Phaser/PixiJS)  ──HTTP/SSE──▶  Node server (Fastify)  ──▶  Ollama (localhost:11434)
   renders, input              owns NpcAgent + game state
```

- [ ] Pick an engine. **Phaser 3** is the easiest for top-down RPGs. PixiJS if you want more control
- [ ] Set up a monorepo: `packages/server`, `packages/client`, `packages/shared` (types)
- [ ] Server: `POST /npc/:id/talk` that streams NPC text back with **Server-Sent Events**, then sends a final event with the applied actions
- [ ] **Request queue:** on 8 GB, Ollama effectively handles one generation at a time. Queue NPC requests on the server so two NPCs talking at once don't stall each other
- [ ] **Warm-up:** the first call after loading a model is slow. Send a tiny request when the game starts, and set `keep_alive: "30m"` so the model stays in memory
- [ ] Client: walk up to an NPC → press E → dialogue box. Render streamed text as it arrives (typewriter effect for free)
- [ ] Apply actions in the client: mood → NPC sprite emote, `set_following` → pathfinding toward the player, `give_item` → inventory UI
- [ ] Build `WorldSnapshot` from real game state (position, time of day, nearby entities)
- [ ] Hide latency: show a "…" bubble or a short canned line ("Hmm.") right away while the first tokens load

**Done when:** you can walk to Brena in the browser, buy a sword, and see it in your inventory UI.

---

## Phase 3: Memory

Goal: NPCs remember you between conversations and play sessions.

> The detailed plan for this is **N2 (saves) and N3 (memory and relationships)** in the NPC track below. It replaces the LLM-summary approach here with an event log written in code, and keeps LLM summaries as an optional extra.

- [~] **Save game:** deaths are saved (`saves/deaths.json`, permanent). NPC and player state (trust, gold, inventory, quests, level) still reset every run
- [ ] **Conversation summaries:** when a conversation ends, make a separate call that turns the transcript into 1–5 `MemoryFact`s. Use Ollama's structured output: pass a JSON schema as `format` (e.g. `format: z.toJSONSchema(FactsSchema)`), then validate the result with Zod anyway
- [ ] Design a `MemoryStore` interface (`add`, `recall`) and implement it: an in-memory version first, then a JSON file version
- [ ] **Recall:** at the start of a conversation, put the top-N facts in the first user message. Start with recency × importance, then add keyword matching
- [ ] **Embeddings (optional):** for smarter recall, run a small local embedding model (`ollama pull nomic-embed-text`, ~270 MB) with `ollama.embed()`, and rank facts by cosine similarity
- [ ] **Short conversations:** small context windows fill up fast. When a talk gets long, summarize it, end it, and start a fresh conversation seeded with the summary
- [ ] Remember relationship and mood across conversations

**Done when:** you insult Brena, quit the game, come back the next day, and she's still cold to you and says why.

---

## Phase 4: A living world

Goal: NPCs act when the player isn't around, and news spreads between them.

> The detailed plan for this is **N4 (daily life) and N5 (social web)** in the NPC track below.

- [~] **Schedules:** NPCs have working hours (6:00–20:00). When time passes (`/wait`), they craft from their stock (and are busy until done) or sell to villagers, all in code with no LLM calls. **Not yet:** moving between places, and simulating NPCs you aren't talking to
- [x] **NPC economy:** purses, debts paid from earnings, greed that eases once debt-free, and quests made from what an NPC is short of
- [ ] **Gossip system:** when something important happens (a theft, a fight), create an event with `witnesses`. NPCs who meet share facts, which get copied into the listener's memory with a lower `importance`. This can be pure code, no LLM needed
- [ ] **NPC-to-NPC chats** (optional): two agents take turns for 2–4 lines, and the player can overhear. Cap the turns hard
- [ ] **Off-screen planning:** once per in-game day, each NPC makes one short call to update its goals from its memories. Put these in the request queue at **low priority** so they never delay a conversation with the player
- [ ] Give each important event a game-side ID so NPCs can't invent events. They can only reference ones you inject

**Done when:** you steal from Brena, then the guard brings it up without you ever telling him.

---

## Phase 5: Game feel and guardrails

- [~] Reply length: the prompt asks for 1–2 sentences and `num_predict` is 150. Pell still runs long sometimes
- [~] Errors: "Ollama not running" is caught at startup, and API errors print a message. **Not yet:** in-character fallback lines
- [~] Clean up output: leading mood labels are stripped. **Not yet:** `<think>` tags, quotes, "Brena:" prefixes
- [x] NPCs say the *real* offer terms: text written before the game set the terms is dropped, and the tool result says "Say exactly these terms: …"
- [ ] Timeout budget: if no first token in ~3s, show a filler line and keep waiting
- [ ] Content settings: a per-game content rating in the system prompt (e.g. "no graphic violence")
- [x] Player-facing log of NPC actions and rolls (`[persuade succeeded] (rolled 14+3=17 vs 13)`, `[Brena attacks] …`)
- [ ] Barks: short one-liners triggered by events (player draws a sword nearby). Use prewritten lines. They're instant and free

---

## Phase 6: Performance on 8 GB

Local models are free, so the cost is **speed and memory**.

- [~] **Log every call:** the provider returns token counts and duration (`stats`), and the benchmark reports average seconds per turn. **Not yet:** a log, or time to first token
- [ ] Set targets, e.g. first token under 1.5s and a full line under 4s, and check against them
- [x] Compare models on the same test lines (`npm run bench -- <models...>`). Results are in "Your setup" above
- [x] Keep `num_ctx` as small as works: 4096 (3.5 GB loaded, down from 3.8 GB at 8192)
- [x] Only one chat model loaded at a time. Check with `ollama ps`
- [ ] Close heavy apps while testing. Watch memory pressure in Activity Monitor; if it goes yellow or red, use a smaller model
- [ ] **When local isn't enough:** add a second `LLMProvider` for a free hosted tier (Groq, Gemini, or OpenRouter `:free` models) and use it for the tasks where quality matters most, like memory summaries

---

## Phase 7: Testing and evals

- [x] Unit tests for the game rules: 269 tests, with fixed dice so every roll is exact
- [x] **Fake provider:** `FakeProvider` in `tests/npcAgent.test.ts` scripts model replies to test the turn loop, offers, fights and quests
- [x] **Scenario evals:** `npm run bench` (8 scenarios against the real model, pass rates; about 37/40 lately) and `npm run test:live` (9 behaviour tests)
- [x] Rerun the evals after every prompt change and model switch. This caught most of the problems listed under "Lessons learned"

---

## Phase 8: Ship

The big question: **where does the model run for players?**

- [ ] **Option A, desktop game:** package it with Electron or Tauri and ask players to install Ollama (or bundle it). Free to run, but players need a decent machine
- [ ] **Option B, web game:** run the server with a hosted provider through your `LLMProvider`. Free tiers have rate limits, so plan for paid usage if people actually play
- [ ] Per-player rate limits on the server, whichever option you choose
- [ ] Telemetry: latency to first token, action failure rate, how often fallback lines fire
- [ ] Privacy: if you use a hosted provider, tell players their dialogue is sent to an AI service

---

## NPC & RPG mechanics track

A plan for NPCs only: who they are, how they behave, and the RPG rules behind them. It doesn't depend on the browser game (Phase 2), so you can work on it in the terminal first. Phases N1–N9 are in order: each one builds on the ones before it.

### Design rules for every phase

These come from "Lessons learned" below. Check every new feature against them.

1. **Code owns the numbers.** Every roll, price, timer, threshold and state change happens in `src/game/` or `src/npc/actions.ts`. The model only proposes; the game decides.
2. **The model gets words, not maths.** Turn numbers into labels in code ("badly wounded", "you can afford: …") before they reach the prompt.
3. **Gate tools and context by topic.** A new tool appears only on turns where it makes sense, and a new situation line only when it's relevant. Each one costs accuracy elsewhere.
4. **Offer, then confirm.** Anything that costs the player gold, items, time or freedom is an offer they accept or decline.
5. **Data before prompts.** A new behaviour should be a field in the NPC file and a rule in code. Prompt wording comes last.
6. **Measure every phase.** Each phase adds unit tests (fixed dice and fake model) and at least one `npm run bench` scenario, and must not drop existing pass rates.

### What an NPC is made of

The target model. Each phase fills in part of it.

| Layer | Changes | Lives in | Example | Status |
|---|---|---|---|---|
| **Identity** | Never | NPC file | name, role, backstory, speech style | ✅ |
| **Traits** | Never (rarely) | NPC file | greed, temper, bravery, honesty, generosity, sociability (0–1) | 🟡 only greed (N1) |
| **Abilities** | Slowly | NPC file + save | attributes, skills, level, gear | 🟡 no NPC level or gear (N6, N7) |
| **State** | Every turn | Save | mood, HP, gold, stock, job, offers | ✅ (not saved yet: N2) |
| **Needs** | Every hour | Save | hunger, energy, money, materials | 🟡 materials only (N4) |
| **Memory** | Per event | Save | "the player insulted me on day 2" | ⬜ (N3) |
| **Relationships** | Per event | Save | trust, fear and respect towards the player and other NPCs | 🟡 trust only (N3, N5) |
| **Schedule** | Per day | NPC file | forge 6–18, inn 18–21, sleep | 🟡 working hours only (N4) |
| **Reputation** | Per event | Save | how the town sees the player | ⬜ (N5) |

---

### N1: Personality traits that drive the rules

**Goal:** two NPCs with the same stats behave differently because of their traits, and the differences come from code, not prompt wording.

**Mechanics:** a `traits` block in each NPC file, each value from 0 to 1. Every trait has at least one rule in code:

| Trait | Drives (in code) | Replaces today's fixed |
|---|---|---|
| `greed` | Training markup, buy prices, haggling (exists) | — |
| `temper` | Insults before attacking (high temper: 2, low: 5); how much trust each insult costs | `PROVOKE_LIMIT = 3` |
| `bravery` | Morale target when hurt; whether a scared NPC flees, begs or fights | `MORALE_TARGET = 15` |
| `honesty` | Whether they can lie: a low-honesty NPC may deny a secret even after revealing it (a new `lie` outcome) | — |
| `generosity` | Gifts to trusted players (new `give_item` gated on trust and generosity), quest reward bonus | — |
| `sociability` | How much gossip they pass on (N5), how chatty they are | — |
| `forgiveness` | How fast grudges fade (N3) | — |

**Tasks:**
- [ ] Add `PersonaSchema` (Zod) and validate every NPC file **at startup**. This finishes Phase 1's validation item
- [ ] Add `traits` with defaults (0.5), in `src/npc/traits.ts`, with one function per rule (`provokeLimit(traits)`, `moraleTarget(traits)`, …)
- [ ] Switch the existing constants to trait-based functions, and keep Brena's current behaviour as her trait values
- [ ] Show traits to the model only as words in the system prompt ("quick-tempered, brave, honest"), never as numbers
- [ ] Add a third NPC with very different traits, e.g. a cowardly, dishonest guard, to prove traits matter

**Done when:** in tests with fixed dice, a high-temper NPC attacks after 2 insults and a low-temper one after 5, and a cowardly NPC flees at a HP level where a brave one fights on. On the benchmark, each NPC's attack and flee rates follow their traits.

---

### N2: Saving NPCs and the player

**Goal:** nothing resets between runs. This has to come first, because memory, grudges and schedules mean nothing if they're lost on restart.

**Mechanics:**
- One save file per world: `saves/world.json`, with a `version` field so old saves can be upgraded.
- **Saved:** every NPC's `NpcState` (trust, mood, HP, gold, stock, debts, job, quest board), the player (level, XP, gold, inventory, skills, quests) and the clock.
- Deaths move into the world save (keep importing `saves/deaths.json` once).
- Autosave after every action that changes state. Load on start, or start a new world.

**Tasks:**
- [ ] `src/game/save.ts`: `saveWorld()`, `loadWorld()`, `newWorld()`, plus a Zod schema for the save format
- [ ] A `World` container holding the clock, the player and every NPC's state, so the game stops having one NPC at a time
- [ ] CLI: `/save`, an autosave, `--new` to start fresh, and reuse the current NPC choice
- [ ] Tests: a save → load round-trip keeps everything, and old-version saves upgrade

**Done when:** buy a sword, raise trust, accept a quest and quit. After restarting, everything is the same, and Pell's debt is still part-paid.

---

### N3: Memory, grudges and multi-axis relationships

**Goal:** NPCs remember what you did, and it changes how they treat you days later. This is Phase 3's "Done when", for real.

**Mechanics:**
- **Event log, written in code, not by the LLM.** Every meaningful action records an event: `{ day, kind, actor, target, details, importance }`. Kinds: bought, sold, insulted, complimented, attacked, fled, lied-to, quest done, quest failed, gift, secret shared.
- **Memory = events the NPC witnessed.** Each fact has an importance (1–10) that fades over time, and `forgiveness` controls how fast negative facts fade.
- **Recall:** the top 3 facts by importance × freshness go into the situation block as short lines ("Two days ago they insulted your forge."). This uses no LLM call.
- **Relationships with three axes instead of one:**
  - **Trust:** do they believe you? This is today's trust.
  - **Fear:** are they scared of you? Intimidation, attacks and your strength raise it.
  - **Respect:** do they rate you? Finished quests, skill and level raise it.

  Rules use different axes:
  - **Secrets** need trust.
  - **Discounts from intimidation** need fear.
  - **High-tier quests and master training** need respect.
- **Grudges:** being attacked or robbed sets a grudge that blocks trading and training until it fades or you make amends (a gift, a quest or paying a fine).

**Tasks:**
- [ ] `src/game/events.ts` (the event log) and `src/npc/memory.ts` (witnessed facts, decay, recall)
- [ ] Record events from the existing actions (the hooks are in `applyAction`, `acceptOffer`, `turnInQuests`, `playerAttack`)
- [ ] Split `relationship` into `{ trust, fear, respect }`, and move each gate to the axis that fits it
- [ ] Grudges and amends: `make_amends`, offered only while a grudge exists
- [ ] Optional, later: an LLM summary of a conversation's *tone* into one fact, using Ollama's `format` with a Zod schema. Code events stay the source of truth

**Done when:** insult Brena, `/wait 24`, come back, and she's still cold and says why. Help her with two quests, and her respect unlocks something trust alone didn't.

---

### N4: Needs, schedules and daily life

**Goal:** NPCs live a day. They're somewhere specific at each hour, for a reason you can see.

**Mechanics:**
- **Schedules in the NPC file:** blocks like `{ from: 6, to: 18, activity: "work", place: "forge" }`. Activities: work, eat, socialise, sleep, travel.
- **Needs that tick every hour:** hunger, energy, money. They're satisfied by activities: eating at the inn costs gold and fills hunger, sleep restores energy, work earns money.
- **Utility choice in code:** when a need is urgent, it overrides the schedule. A hungry NPC goes to eat, and a broke one works late. There are no LLM calls in the simulation.
- **Where they are matters:** you can only talk to NPCs at your location, and asleep or away NPCs are unavailable, like busy ones today.
- **Mood follows needs:** a hungry or tired NPC drifts towards annoyed. This is shown to the model as a situation line ("You're tired and hungry").

**Tasks:**
- [ ] `src/game/schedule.ts` and `src/game/needs.ts`, and extend `passTime` to every NPC in the `World` (N2)
- [ ] Locations: `forge`, `inn`, `square`, `home`. A player location, and `/go <place>`
- [ ] Crafting and selling only happen during "work" blocks; replaces today's fixed 6:00–20:00
- [ ] Brena eats at Pell's inn in the evening and pays him, which is the first trade between NPCs (N5)
- [ ] Tests: 24 hours with fixed dice give the expected locations and activities

**Done when:** `/wait 24` shows Brena forging by day, eating at the inn in the evening and sleeping at night. She's only reachable where she is, and a starving NPC acts differently.

---

### N5: The social web: NPC relationships, gossip and reputation

**Goal:** the town reacts as one. What you do to one NPC reaches the others.

**Mechanics:**
- **NPC-to-NPC relationships** (the same three axes), written in each NPC file: Brena and Pell are friendly, and Pell is scared of the guard.
- **Gossip:** when two NPCs share a place (N4), each shares its most important recent facts. The listener stores them at lower importance, depending on the speaker's `sociability` and their relationship. All in code.
- **Reputation:** a town-wide score per axis, built from gossip. It sets how strangers first treat you, so starting trust isn't always 0.
- **Crimes:** attacking or killing in town is witnessed. Witnesses gossip, a bounty may follow, and a guard NPC can come for you.
- **Death has consequences:** a dead NPC's quests fail, their shop is gone, and friends grieve or hold a grudge.

**Tasks:**
- [ ] `relationships` in NPC files, and in the save (N2)
- [ ] `src/game/gossip.ts`: exchanges when NPCs share a place, fading with each retelling
- [ ] Reputation from gossip, and starting trust from reputation
- [ ] A guard NPC, crimes, a bounty, and `/surrender` or `/pay fine`
- [ ] Death ripple: quests fail, items drop, and friends' relationships with the player change

**Done when:** attack Brena, then go to Pell without telling him. He already knows, is wary, and charges more. Kill someone, and the guard brings it up.

---

### N6: Deeper combat

**Goal:** fights that use stats, gear, MP and personality, and that can end in more ways than death or running away.

**Mechanics:**
- **Equipment:** weapon and armour slots for the player and NPCs. Armour tier reduces damage. Uses the existing item tiers.
- **MP abilities:** a few per skill, chosen by an NPC's skills (a smith's "heavy blow"), costing MP. They're rolled in code and picked by a combat style in code, never by the model.
- **Combat styles from traits:** aggressive (attacks every turn), cautious (defends when hurt) and cowardly (begs early). Code chooses the move; the model only narrates.
- **Status effects:** bleeding, stunned and weakened. Each lasts N turns and is shown as words in the situation.
- **Non-lethal option:** `/attack` vs `/subdue`. Knocked out is temporary, death is permanent, so the player chooses.
- **Loot:** a dead or subdued NPC drops their inventory. Taking from the unconscious is a witnessed crime (N5).
- **NPC level:** from total skill and stats. It sets fight difficulty and shows as a word ("a seasoned fighter").

**Tasks:**
- [ ] `equipment` in NPC files and for the player; armour items with tiers in `ITEMS`
- [ ] `src/game/abilities.ts`, MP costs, and `src/game/status.ts`
- [ ] A combat style picker from traits, plus tests for each style with fixed dice
- [ ] `/subdue`, an `unconscious` outcome, loot and `/loot`

**Done when:** in tests, a tier-B armoured NPC takes less damage than an unarmoured one, a cowardly NPC begs at 50% HP, and subduing leaves an NPC alive with lootable stock.

---

### N7: Quest depth and progression

**Goal:** quests beyond "bring N items", and a player whose growth opens up the world.

**Mechanics:**
- **New goal types, each checkable in code:**
  - `deliver`: exists
  - `gather`: `/forage` or `/hunt` with your skill, in a place (N4)
  - `craft`: make an item of tier ≥ X
  - `talk_to`: carry a message to another NPC, checked when you talk to them
  - `defeat`: win or subdue a named NPC (N6)
  - `escort`: be with an NPC at a place by an hour
- **Quest chains** with prerequisites (`requires: ["burn_poultice"]`), and **deadlines** using the clock, with failure costing trust or respect.
- **Generated quests with LLM flavour:** code picks the structure (goal, tier, reward from needs). The model only writes the title and the reason, via structured output (`format` + Zod), and the result is checked. A failed check falls back to template text.
- **NPC growth:** NPCs gain skill XP from working (Brena forging every day slowly improves) and level up. Higher-level NPCs post higher-tier quests, up to `maxQuestTier`.
- **Player progression:** level-ups give attribute points (`/raise strength`). Skills improve by use, not only by training.

**Tasks:**
- [ ] A union of goal types in `QuestObjective`, with one checker per type in `src/game/quests.ts`
- [ ] Gathering: `/forage`, `/hunt`, and items per place
- [ ] Chains, deadlines and failure
- [ ] `generateQuestFlavor()`: a structured-output call with a template fallback, behind `LLMProvider`
- [ ] Skill growth from use, for NPCs and the player

**Done when:** Brena's "My father's hammer" becomes a working 3-step chain (find out where it is from Pell, defeat the bandit, deliver the hammer), and a level 1 player can't skip ahead.

---

### N8: Deeper crafting and economy

**Goal:** a small working economy where prices, stock and quality mean something.

**Mechanics:**
- **Input tiers matter:** better ore makes better swords. The output tier comes from the input tier plus a skill roll.
- **Commissions:** order an item ("an iron sword, tier C or better"), pay a deposit, the NPC works on it during their schedule (busy), and you collect it later. Uses the existing jobs.
- **Supply and demand:** prices move with stock (scarce goods cost more), and village demand differs by item.
- **Restocking:** NPCs buy materials from each other or from off-screen traders, which creates real needs for need quests.
- **Repairs:** weapons wear down in fights (N6), and smiths repair them for a fee.

**Tasks:**
- [ ] Recipes take input tiers, and output tier = f(inputs, skill, roll)
- [ ] `offer_commission` (offered on trade turns), deposits, a pickup flow, and `/collect`
- [ ] Price modifiers from stock and demand, computed in `npcPrice`
- [ ] Trade between NPCs on schedule (N4 and N5)

**Done when:** bringing Brena better ore gets you a better sword, a commission is ready after the right number of hours, and iron sword prices rise when she's out of ore.

---

### N9: Voice and consistency (evals for character)

**Goal:** NPCs that sound like themselves, stay consistent and don't break character, and are measured that way.

**Mechanics:**
- **A benchmark per NPC:** the shared scenarios, plus ones written for each NPC's traits (Pell must mention money, a dishonest NPC must sometimes deny things).
- **Blind voice test:** run the same 10 lines past every NPC, then check that a code classifier (or an optional LLM judge) can tell who's speaking.
- **Consistency checks:**
  - **Facts:** never contradict the event log ("you never bought anything from me" when you did).
  - **Stock:** never claim stock that doesn't exist.
  - **Character:** never refer to being an AI.
- **Prompt budget:** a test that fails if the system prompt or situation grows past a word limit. Context length kept costing accuracy.

**Tasks:**
- [ ] `scripts/bench.ts` takes an NPC and loads per-NPC scenarios from `src/data/bench/<npc>.json`
- [ ] Voice and consistency checks, run on demand
- [ ] A prompt-size test in `tests/persona.test.ts`

**Done when:** every NPC has its own benchmark of 30 or more runs at a recorded pass rate, and you rerun it after every change from N1 to N8.

---

### Suggested order and checkpoints

```
N1 Traits ──▶ N2 Saves ──▶ N3 Memory & relationships ──▶ N4 Daily life ──▶ N5 Social web
                                                                │
                                   N6 Combat ◀──────────────────┤
                                   N7 Quests ◀──────────────────┤
                                   N8 Economy ◀─────────────────┘
N9 Voice & consistency: start with N1, grow with every phase
```

- **N1 and N2 first.** They're small, and everything after them needs them.
- **N3–N5 are the heart of "living NPCs".** Do them in order.
- **N6–N8 can come in any order** once N4 exists. Pick the one your game needs most.
- **Re-run `npm run bench` and `npm run test:live` at the end of every phase.** If a pass rate drops, fix it before moving on: gate the new tool or line (rule 3) or reword it firmly (Lessons 4–6).

---

## Extra: RPG systems (beyond the original plan)

Built along the way. The rules for each are in [README.md](README.md).

- [x] **Stats:** HP, MP and 8 attributes (1–20), described to the model in words ("strong (STR 16)")
- [x] **Skills:** 15 skills with tiers from 0 (untrained) to 5 (master). Combat, social and haggling skills add to rolls
- [x] **Dice:** d20 checks with D&D-style modifiers, all in code (`src/game/dice.ts`)
- [x] **Social checks:** `/persuade`, `/intimidate`, `/haggle`. Discounts are shrunk by the NPC's haggling skill
- [x] **Combat:**
  - The NPC attacks after 3 insults in a row, or when you attack.
  - Once a fight starts, the NPC attacks automatically every turn.
  - When badly hurt, a morale check decides whether it flees.
  - It can call `end_fight` only if you plead, and you can `/flee`.
  - **Permanent death**, saved to file.
- [x] **Training:**
  - Each NPC teaches one specialty skill, up to their own level.
  - Trust limits the highest level they'll teach; each level takes more hours and costs more per hour.
  - The fee goes to the teacher, and greedy NPCs charge more.
- [x] **Items:** tiers G → SSS, with copies of the same item at different tiers ("iron sword [B]"). Value scales ×1.5 per tier, and weapon damage rises with tier
- [x] **Trading:** buying and selling both need the player's consent; NPCs only buy what fits their trade; "what can I afford" is worked out in code
- [x] **Quests:**
  - Tiers G → SSS, gated by player level.
  - Some are hidden by trust, and each NPC has a highest quest tier.
  - Written quests, plus quests made from what an NPC is short of.
  - Rewards: gold, XP and trust. The player levels up.
- [x] **Crafting and time:** skill-based recipes with rolled output tiers, `/wait`, working hours, busy NPCs, and village sales
- [x] **Money:** NPC purses, Pell's debt paid down from earnings, and greed that eases once he's debt-free

**Not yet:**
- **More quest goals:** every quest is "bring N items". Others need a world to explore (Phase 2).
- **One NPC per session:** `/wait` only simulates the NPC you're talking to.
- **A completable "My father's hammer":** nobody sells a forge hammer yet.
- **Using MP:** nothing does yet, so there's no magic.
- **Separate copies of the same item:** two iron sword [B]s are just a count of 2, not individual items.

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

## Further reading

- Ollama API docs: https://github.com/ollama/ollama/blob/main/docs/api.md
- Ollama JS library: https://github.com/ollama/ollama-js
- Tool calling, streaming, and structured outputs (`format`) are the three features this project leans on most
- *Generative Agents* (Park et al., 2023): the memory/reflection/planning design that Phases 3–4 loosely follow
