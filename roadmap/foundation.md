[← Roadmap](../ROADMAP.md)

# Foundation (built)

## F1: First conversation

**Status:** ✅ Built

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

## F2: Stronger NPCs and actions

**Status:** ✅ Built

Goal: NPCs feel distinct, and the action system can't be exploited.

- [x] Add more personas: Old Pell, a greedy innkeeper, and Hale, a cowardly, dishonest guard (N1). Pick one with `npm run chat -- pell`. A child NPC moves to N11.2, after the content limits (design rule 7)
- [x] Validate personas: a Zod `PersonaSchema` at startup (N1), and tests that check every NPC file
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
- [~] Try to break it. **Done:** free-item, low-trust-secret, price-question-sale and "SSS quest at level 1" attempts are covered by tests and the benchmark. **Rest moved to T12** (prompt-injection tests)
- [x] Keep player text **out of** the system prompt
- [x] **Consent for anything that costs the player:** the NPC only *offers* (items, purchases, lessons, quests), and nothing happens until the player says yes

**Concepts:** tool calling, schema validation, why rules in code beat rules in the prompt.
**Done when:** none of your jailbreak attempts gets a free item or a secret below the trust threshold.

---

## F3: RPG systems

**Status:** ✅ Built. The rules for each are in [README.md](../README.md).

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
- **More quest goals:** done in N9 (gather, craft, talk_to, defeat_npc, escort).
- **One NPC per session:** `/wait` only simulates the NPC you're talking to.
- **A completable "My father's hammer":** done: Rook holds it, and it's a three-step chain (N3.2, N9).
- **Using MP:** abilities now spend it (N8); there's still no magic as such.
- **Separate copies of the same item:** two iron sword [B]s are just a count of 2, not individual items.

---

## F4: Testing and evals

**Status:** ✅ Built. More in the tooling track.

- [x] Unit tests for the game rules: 269 tests, with fixed dice so every roll is exact
- [x] **Fake provider:** `FakeProvider` in `tests/npcAgent.test.ts` scripts model replies to test the turn loop, offers, fights and quests
- [x] **Scenario evals:** `npm run bench` (8 scenarios against the real model, pass rates; about 37/40 lately) and `npm run test:live` (9 behaviour tests)
- [x] Rerun the evals after every prompt change and model switch. This caught most of the problems listed under "Lessons learned"
