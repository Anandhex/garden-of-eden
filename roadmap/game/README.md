[← Roadmap](../../ROADMAP.md)

# Game track (G1–G4)

The playable game around the NPCs. G1 can run in parallel with the NPC track once N2 exists.

---

## G1: Connect to a real game

**Status:** ✅ Built. A Phaser 3 client in an npm-workspaces monorepo; `npm run web` builds and serves it, `npm run dev` runs it with live reload.

Goal: NPCs living in a playable 2D scene.

**Architecture:** a Node server in the middle, even though Ollama is local. The server owns game state (so the browser can't cheat), and it's the one place you'd later swap Ollama for a hosted model.

```
Browser (Phaser 3 + DOM panels)  ──HTTP, NDJSON stream──▶  Node server (node:http)  ──▶  Ollama (localhost:11434)
   draws, input, voices                   owns NpcAgent + game state, queue
```

- [x] Pick an engine: **Phaser 3** (3.90). The world view is one scene ([`WorldScene.ts`](../../packages/client/src/world/WorldScene.ts)) with textures drawn in code (no image files); the chat, sheet and dialogs stay DOM ([`ui/`](../../packages/client/src/ui)), because text input and long lists are easier there. Keys are read by the page, not Phaser, so typing in the chat never moves you
- [x] Set up a monorepo: `packages/server`, `packages/client`, `packages/shared` (types). npm workspaces; `shared` is TypeScript source both sides import. The snapshot type in [`protocol.ts`](../../packages/shared/src/protocol.ts) is checked against what the server builds
- [~] Server: streams NPC text back as newline-delimited JSON from `POST /api/act`, then a final `done` event with the new state. Kept NDJSON over `fetch` instead of SSE (it streams per request, which SSE doesn't), and plain `node:http` instead of Fastify (no dependency needed)
- [x] **Request queue** ([`queue.ts`](../../packages/server/src/web/queue.ts)): actions, moves and new games take turns instead of a second one getting a 409; a waiting request hears its place in line (`queued`), and past 8 waiting the server answers 429. The combat clock waits for the queue too
- [x] **Warm-up:** the first call after loading a model is slow. Send a tiny request when the game starts, and set `keep_alive: "30m"` so the model stays in memory
- [x] Client: walk up to an NPC → press E → dialogue box. Render streamed text as it arrives (typewriter effect for free), in the chat and in a speech bubble over the NPC
- [x] Apply actions in the client, from typed events (T13): mood → an emote over the NPC, items and coin float from whoever lost or gained them and the Inventory tab glows, attacks lunge and flash (and shake the screen when you're hit), job offers get a ❗. Companions (N8.2; there's no `set_following` tool, hiring is how someone follows you) walk the player's trail a tile or two behind, worked out on the server so talk range and blocking agree
- [x] NPCs walk between places along a path instead of jumping; arrivals and departures fade. Night darkens the map; rain, storms and snow fall
- [~] Build `WorldSnapshot` from real game state: location and nearby things come from the NPC's map spot; time is real. Player position isn't in the prompt yet (design rule 3: it would be a new always-on line)
- [x] Hide latency: a "…" bubble shows the moment you speak, and after 3 s with no first token the NPC says a filler line from their file (G2 timeout budget)
- [x] Tests for the server: [`server.test.ts`](../../packages/server/tests/server.test.ts) boots the real server with no model and a fake Piper, and checks the state, the queue (three moves at once, each applied once), streaming and voices

**Done when:** you can walk to Brena in the browser, buy a sword, and see it in your inventory UI. ✅ Checked in the browser on 2026-10-11: clicked Brena, walked there, asked for an iron sword, accepted the 4-gold offer; the sword showed in the Inventory tab (and the stream carried `item_moved` and `gold_moved`).

---

## G2: Game feel and guardrails

**Status:** 🟡 Partly done

- [~] Reply length: the prompt asks for 1–2 sentences and `num_predict` is 150. Pell still runs long sometimes
- [~] Errors: "Ollama not running" is caught at startup, and API errors print a message. **Not yet:** in-character fallback lines
- [~] Clean up output: leading mood labels are stripped. **Not yet:** `<think>` tags, quotes, "Brena:" prefixes
- [x] NPCs say the *real* offer terms: text written before the game set the terms is dropped, and the tool result says "Say exactly these terms: …"
- [x] Timeout budget: if no first token in ~3s, show a filler line and keep waiting (`fillerLines` per NPC, `FILLER_AFTER_MS`)
- [ ] Content settings: a per-game content rating in the system prompt (e.g. "no graphic violence")
- [x] Player-facing log of NPC actions and rolls (`[persuade succeeded] (rolled 14+3=17 vs 13)`, `[Brena attacks] …`)
- [ ] Barks: short one-liners triggered by events (player draws a sword nearby). Use prewritten lines. They're instant and free

---

## G3: Performance on 8 GB

**Status:** 🟡 Mostly done

Local models are free, so the cost is **speed and memory**.

- [~] **Log every call:** the provider returns token counts and duration (`stats`), and the benchmark reports average seconds per turn. `npm run bench:voice` measures time to first token and a whole reply, with and without Piper running. **Not yet:** a per-call log in the game
- [~] Set targets, e.g. first token under 1.5s and a full line under 4s, and check against them. Measured 2026-10-11 (`npm run bench:voice`, `qwen3:4b-instruct`, a 2–3 sentence reply): first token 205–332 ms, whole reply 2.7–3.9 s, so both targets are met. **Not yet:** a check that fails when they're missed. The game hides what's left: a "…" bubble at once, a filler line after 3 s (G2), and speech that starts on the first sentence (T14)
- [x] Compare models on the same test lines (`npm run bench -- <models...>`). Results are in "Setup" above
- [x] Keep `num_ctx` as small as works: 4096 (3.5 GB loaded, down from 3.8 GB at 8192)
- [x] Only one chat model loaded at a time. Check with `ollama ps`
- [~] Close heavy apps while testing. Watch memory pressure in Activity Monitor; if it goes yellow or red, use a smaller model. `npm run bench:voice` prints macOS's free-memory figure before and after; on 2026-10-11 it was 16–36% free with 3.5 GB of swap in use, before Piper started. Measure process memory with `footprint`, not `ps` RSS (see Lessons)
- [ ] **When local isn't enough:** add a second `LLMProvider` for a free hosted tier (Groq, Gemini, or OpenRouter `:free` models) and use it for the tasks where quality matters most, like memory summaries

---

## G4: Ship

**Status:** ⬜

The big question: **where does the model run for players?**

- [ ] **Option A, desktop game:** package it with Electron or Tauri and ask players to install Ollama (or bundle it). Free to run, but players need a decent machine
- [ ] **Option B, web game:** run the server with a hosted provider through your `LLMProvider`. Free tiers have rate limits, so plan for paid usage if people actually play
- [ ] Per-player rate limits on the server, whichever option you choose
- [ ] Telemetry: latency to first token, action failure rate, how often fallback lines fire
- [ ] Privacy: if you use a hosted provider, tell players their dialogue is sent to an AI service
