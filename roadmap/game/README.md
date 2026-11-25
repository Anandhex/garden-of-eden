[← Roadmap](../../ROADMAP.md)

# Game track (G1–G10)

The playable game around the NPCs. G1 can run in parallel with the NPC track once N2 exists. G5 and G6 have build guides in [plans/](plans/); build them in that order, then the [48-day year migration](../living-world/plans/migration-2026-10-23-one-year-ageless-player.md) (✅ part A built 2026-10-23), then N40.

**Where the track stands (audit, 2026-11-16):** G1, G5, G6 and G7 are built. On 2026-11-04 the user set the web looks aside ("not feeling it" with 2.5D) for a desktop client in real 3D, and that is the work in hand: [G8](#g8-the-unity-client), the Unity client, and [G9](#g9-characters-face-and-body), its characters. G2–G4 (game feel, performance, shipping) are still open and were written for the browser; they need a second look for a desktop build (see G8's list).

---

## G1: Connect to a real game

**Status:** ✅ Built. A Phaser 3 client in an npm-workspaces monorepo; `npm run web` builds and serves it, `npm run dev` runs it with live reload.

Goal: NPCs living in a playable 2D scene.

**Architecture:** a Node server in the middle, even though Ollama is local. The server owns game state (so the browser can't cheat), and it's the one place you'd later swap Ollama for a hosted model.

```
Browser (Phaser 3 + DOM panels)  ──HTTP, NDJSON stream──▶  Node server (node:http)  ──▶  Ollama (localhost:11434)
   draws, input, voices                   owns NpcAgent + game state, queue
```

- [x] Pick an engine: **Phaser 3** (3.90). The world view is one scene ([`WorldScene.ts`](../../packages/client/src/adapter/web/world/WorldScene.ts)) with textures drawn in code (no image files); the chat, sheet and dialogs stay DOM ([`ui/`](../../packages/client/src/ui)), because text input and long lists are easier there. Keys are read by the page, not Phaser, so typing in the chat never moves you
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

---

## G5: A switchable client

**Status:** ✅ Built 2026-10-23. **Build guide:** [plans/g5-a-switchable-client.md](plans/g5-a-switchable-client.md) (with what was built and where it differs). **Protocol:** [protocol/](../../protocol/README.md).

Goal: the client can be web, Unity or Unreal, with as little logic in it as possible. The server is the brain and decides everything; a client only draws and sends what the player wants.

```
Adapter (Phaser + DOM today; Unity, Unreal later)  ──WebSocket, JSON (schema in protocol/)──▶  Node server: rules, clocks, walking, frames, UI model
   draws, tweens, input → intents, voices                                                  ──▶  Ollama
```

- [x] One versioned protocol (zod in `shared/src/view/`, JSON Schema in `protocol/schema/`): frames, events, speech, UI model, prompts from the server; intents from the client
- [x] A WebSocket session per player that holds the view box, history, prompts, clocks and walks ([`server/src/view/`](../../packages/server/src/view))
- [x] The frame builder: crowd, travellers and terrain placed on the server for the view box only
- [x] Intents the server resolves: click, interact, fight, flee, walk to, travel
- [x] The clocks on the server: time flow, Simulate, the fight clock, the model check
- [x] Panels as data with every string written by the server; feed and chat history kept by the server
- [x] The web client split into `core/` and `adapter/web/`; the client's simulation, terrain, placement, pathfinding and clock code deleted; an import test guards the line
- [x] A recorder (`npm run frames:record`) and a second, plain-canvas adapter to prove the protocol; `protocol/ADAPTERS.md` for Unity and Unreal

**Done when:** the web game plays as before with none of that logic in the browser, and the plain-canvas adapter can walk, talk, fight, travel and simulate through the protocol alone.

---

## G6: The look

**Status:** 🟡 Built 2026-10-23 (uncommitted); the renderer checkpoint is decided: stay on Phaser for now. **Build guide:** [plans/g6-the-look.md](plans/g6-the-look.md) ([Built](plans/g6-the-look.md#built-2026-10-23) and [checkpoint](plans/g6-the-look.md#checkpoint-step-7-decided-stay-on-phaser)).

Goal: crisp pixel art now, built so the 2.5D HD look (upright sprites in a lit scene with depth blur) is a renderer swap later.

- [x] Art looked up by id (`shared/src/view/art.ts`), a manifest per adapter, code-drawn art as the fallback
- [x] An art pipeline: 64 px source shown at 32 px, Tiled tilesets with autotiles and building templates (the maps stay generated; sources are 16 px text art packed ×4)
- [~] The first art pass: terrain, buildings, tinted people with four-way walks, creatures (one template per kind except houses, which have three)
- [x] Four layers (ground, buildings, props, actors) and roofs that fade
- [x] Light2D: ambient light by time and weather, lit windows, lamps and fires sent by the server as facts
- [~] Depth and atmosphere: y-sorting, foreground parallax, blur, weather effects, at 60 fps (frame time measured by stepping the loop; the `?fps=1` check on the test laptop is still to do)
- [x] Checkpoint: stay on Phaser, or prototype 2.5D HD in Three.js or Unity against G5 recordings (decided 2026-10-23: stay on Phaser; Three.js first when the HD look is wanted; taken up 2026-11-03 as [G7](#g7-isometric-hd-2d))

**Done when:** the game looks like real pixel art with light at night, and the renderer checkpoint is decided and written down.

---

## G7: Isometric HD-2D

**Status:** ✅ Built 2026-11-03, parts A and B. Set aside on 2026-11-04 for full 3D ([G8](#g8-the-unity-client)); it stays in the web client as a view. **Build guide:** [plans/g7-isometric-hd2d.md](plans/g7-isometric-hd2d.md) ([Built](plans/g7-isometric-hd2d.md#built-2026-11-03)).

Goal: the world in 2.5D, "HD-2D and isometric mixed": a lit diorama seen from a corner, in Three.js beside Phaser.

- [x] A second world view in Three.js (`adapter/web/iso/`), chosen in the header (🧊 2.5D / ▦ Flat) or `?view=`; 2.5D is the default
- [x] Isometric camera turning in quarter turns (Q/E), wheel zoom, keys that follow the screen
- [x] Buildings as boxes with gable roofs from their templates; billboards for people, beasts and trees; sun shadows, lamp light, lit windows
- [x] Atmosphere: haze and fog, rain, snow, fireflies, dust, chimney smoke, bloom and tilt-shift blur
- [x] Part B: the land's height sent by the server (hills, banks, levelled building pads) and the 2.5D ground following it
- [x] Part B: upper floors with stairs in inns, halls, manors, palaces, guildhalls and bigger houses
- [x] Part B: low-poly models for rocks, furniture, signposts, shrines, stairs, campfires and bridge decks
- [x] Part B: new art: side walls and gables per material, earth banks, stairs

**Done when:** the game opens in a lit isometric 2.5D world that plays exactly like the flat one, with height, upper floors and models.

---

## G8: The Unity client

**Status:** 🟡 In progress since 2026-11-04. **Art direction:** [plans/g8-art-direction.md](plans/g8-art-direction.md) (the one look everything follows). There is no build guide for the client itself; this section is its record.

Goal: the game as a desktop app in soft stylised 3D (the user's reference: a stylised open world, smooth matte shading, no outlines), drawn by Unity from the same server. The game is called **Garden of Eden**.

**Why Unity:** the machine is an M2 with 8 GB and Unity was installed; Unreal 5 is a poor fit on it. G5 made this a new adapter, not a rewrite: the TypeScript server still decides everything and the client only draws frames and sends intents over `/ws` ([protocol/](../../protocol/README.md)).

**What exists** (`unity/GardenOfEden`, Unity 6000.3 URP, about 12,000 lines of C# in `Assets/Game/`; checked by file on 2026-11-16):

- [x] `Net/`: the connection, the frame mirror, intents, and the UI model parsed from the server (`GameClient`, `Mirror`, `Frame`, `Intents`, `UiModel`)
- [x] `World/`: ground patches from tiles, buildings from templates with roofs and per-culture architecture styles, props, a horizon ring, occlusion, a light pool
- [x] `World/Characters/`: people built from a recipe (parts, face, colours by id), creatures, speaking
- [x] `Look/`: day and night, wind, a grass field, a performance probe
- [x] `Play/`: the camera rig, keyboard movement (click-to-move was removed at the user's request), and a HUD that draws the server's panels generically (`Hud.RenderSections`), so a new panel needs no client code
- [x] `Editor/SceneBootstrap`: builds the scene, materials and URP settings from scratch, the same every time
- [~] The look: characters are being redone (G9, paused 2026-11-22). The world had a G8 pass on 2026-11-22 (below); buildings are still the procedural massing with steeper roofs, not a full G8 redo
- [ ] Sound: N29's soundscape and the voices (T14) live in the web client; there is no audio script in `Assets/Game/`
- [x] World look pass (2026-11-22; details in `Assets/Game/World/README.md`, "World look pass"; screenshots in `unity/GardenOfEden/Screenshots/world/`): soft-shaded trees (oak, elm, poplar, fir), bushes and rocks, all code-built (CC0 nature packs are faceted, which the art direction rules out); wind sway and back-light on foliage; foliage dissolves near the camera and between camera and player; painterly ground breakup from world-space noise; SSAO; deeper tinted shadows; a warmer grade; snow cover on ground, roofs and canopies from `ambience.snow`; rain and snow particles; a bluer, readable night; steeper roofs with thick eaves; no towers from 2x3 cottages; no door frames left alone in fields; labels at a steady screen size
- [x] The hard edge when zoomed out: already gone before this pass (the client asks for a 64×44 view, the horizon ring and fog carry the land to 1.5 km)
- [ ] Still open in the look: far meadows read as one flat green from the top zoom (grass draws to 48 m; the ground breakup helps only a little); canopy tops lean lime in strong sun; buildings are boxy with plain walls, no per-culture G8 redo yet; street props (fences, carts, barrels, wells, stalls) are still the old flat-shaded boxes; evening and night are dark; the HUD has not been reviewed
- [ ] Server view gap (not a rule change): land patches stream wider than buildings, so houses at the edge of the land have no body yet (their doors are now hidden until they arrive)
- [ ] Performance (editor play mode, M2, day, close camera, 2026-11-22): about 121 fps (8.3 ms avg, worst 24 ms), 1.6 M triangles, 364 batches, graphics memory 391 MB; at the start crowd with grass about 87 fps and 4.3 M triangles, of which grass is about 1.4 M and the skinned people about 0.84 M (the characters are the biggest mesh cost)
- [x] A way to run it written down: `npm run unity:server -w packages/server`, then Play in `Main.unity` (in `Assets/Game/Play/README.md`)
- [ ] A check against the protocol: a test that the C# message types still match `protocol/schema` (today they are kept in step by hand)
- [ ] G2–G4 for desktop: content settings, memory with Unity and the model both open on 8 GB (not measured), a packaged build that starts the server

**Rules** (user, 2026-11-04 and 2026-11-16): one agent at a time in the Unity project, never a copy of it; reuse free CC0 assets first and make only what is missing; bought or downloaded packs that don't fit the art direction are placeholders.

**Done when:** a new game can be played start to finish in the Unity client with nothing missing that the web client has (talk, trade, fights, panels, sound), at a steady frame rate on the M2, and it looks like the art direction page.

---

## G9: Characters (face and body)

**Status:** 🟡 Planned 2026-11-16; work package 0 of 9 nearly done. **Build guide:** [plans/g9-characters-face-body-plan.md](plans/g9-characters-face-body-plan.md).

Goal: our own townsfolk, built in Blender (`art3d/characters/`), that match the reference's style, proportions and render quality: one body on one Humanoid rig with blend shapes, and about thirty options each for hair, beards, brows, eyes, mouths, noses and ears, mixed by a hash of the person's id.

- [~] WP0: safety copy and sources (left: `CREDITS.md`, two empty folders)
- [ ] WP1: comparison harness and baseline (needs the reference image put in place by the user; kept out of git)
- [ ] WP2–WP3: rebase on the realistic bodies, then the stylise pass
- [ ] WP4–WP5: face rig, eyes, lashes, teeth; blend shapes and ages
- [ ] WP6–WP8: species presets, UVs and skin, the part sets
- [ ] WP9: export, docs, Unity hand-off

**Not planned yet** (each needs its own plan after G9): clothes by class and culture; animation beyond the free CC0 clips; buildings, props and land in the G8 style; creatures and the other peoples (N54's twelve species have data on the server and scripts in `art3d/creatures/`, but no place in a plan).

**Done when:** the plan's stop criteria are met at its user gates, and a street of fifty different people in Unity reads as one cast in one style.

---

## G10: Regional building styles (the web views)

**Status:** ✅ Built 2026-11-23 (`tests/g10.test.ts`). No save bump and no schema change: the style is worked out from the realm each frame.

Goal: towns that look like where they are. Every place used to wear the same thirteen templates in the same straw, plaster and grey shingles; now a place is built the way its people build, with what its land gives them, so a coastal port, a highland village and a forest steading look nothing alike.

- [x] **Culture picks the roofs** (the kingdom's culture, N53): heather thatch and slate in the highlands, straw thatch on the river plains, red tiles on the coast and in the imperial south, sod roofs and bark shingles in the northern forests, felt on the steppe
- [x] **The land picks the walls** of ordinary houses: fieldstone in the hills, logs in the forest, whitewash on the coast, wattle and daub under reed thatch in the marsh, timber and plaster on the plains and in the valleys
- [x] **Some peoples insist on their own walls** wherever they live: the coast folk whitewash, the imperial south builds ochre stucco houses and brick halls, the steppe lives in round felt tents and builds halls of sun-dried brick
- [x] **Rich places** (cities and capitals) roof their cottages in the culture's fine roof (a river city in shingles, not straw)
- [x] **Other peoples build their own way** (N54): a dwarf hold in dark dressed stone and slate, orc lodges of hide on rough logs, goblin mud huts under turf, elven living roofs on hewn logs, centaur felt tents
- [x] **The culture's colours** paint the tinted roofs and market awnings of a human place
- [x] New art: 16 materials made from the old ones by `recolor=` and `swap=` in the art sheets (`npm run art`), with their side walls, gables and doors for the 2.5D view
- [x] One code path for every adapter: the server sends `<template>~<style>`, and `templateById()` (shared `view/styles.ts`) gives the styled template; an adapter that knows no styles drops the `~…`
- [x] Tests, this roadmap

**Done when:** in one realm at least four looks appear, each place's look names its kingdom's culture and its own land, another people's hold builds its own way, and every styled template wears only frames the packed art has.

Later: building shapes per culture (round towers, stilt houses on the marsh, long halls), not only materials; the wilds' and roads' buildings (waystations, hermits' huts) in the local style.

This is the 2D and 2.5D web views' look. The Unity client (G8) reads the same `style` the server sends on each building (`cultureStyle`), and its 3D buildings follow its own art direction.
