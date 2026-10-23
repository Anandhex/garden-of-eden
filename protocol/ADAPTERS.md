# Writing an adapter (Unity, Unreal, or anything else)

An adapter draws what the game server sends and turns the player's input into intents. It holds **no game rules**:
no pathfinding, no "can I talk to them", no clocks, no sentences about the game. The protocol is in
[README.md](README.md). There are two working examples in this repo:

- [`packages/client/src/core/`](../packages/client/src/core) (under 400 lines, no engine code): the connection, a
  mirror of the latest frame and UI, and the `EngineAdapter` interface. Port this first; it's the same in any
  language.
- [`packages/client/src/adapter/canvas/`](../packages/client/src/adapter/canvas) (about 300 lines, no art): the
  smallest whole adapter. It walks, talks, fights, travels and simulates through the protocol alone.
  [`adapter/web/`](../packages/client/src/adapter/web) is the full one (Phaser and DOM).

## Steps

1. **Generate the types** from [`schema/`](schema/) with any JSON Schema code generator:
   - C#: NJsonSchema or quicktype;
   - C++: quicktype;
   - Unreal: the generated C++ into USTRUCTs, or the Json module by hand.

   Start with `server-msg.json` and `intent.json`. Messages are tagged unions on `t`.
2. **Open the socket** to `ws://<host>:3000/ws`. In Unity use NativeWebSocket or System.Net.WebSockets; in Unreal,
   the WebSockets module. Then send:

   ```json
   { "t": "hello", "version": 1, "view": { "w": 26, "h": 18 }, "engine": "unity" }
   ```

   `view` is how many tiles your camera shows. Expect `hello`, then a whole `frame`, then a whole `ui`.
3. **Keep a mirror** as the core does (`core/mirror.ts`):
   - **Patches.** Cache them by key. A frame only sends ones you don't have yet. On a frame with `whole: true`, drop
     everything (a new map).
   - **Actors.** Apply them by id: `upsert` replaces, `move` (`[id, x, y]`) sets the place, `routes` gives some
     movers a route, `remove` deletes.
   - **Panels.** `buildings`, `lights`, `signs` and the `ui` panels come whole when they change: replace them.
   - **The feed.** `feed` messages append to `ui.feed.lines` (keep the last 200).
4. **Draw.**
   - **Ground.** From the patches: `TERRAIN_IDS[ground[i]]` and `OBJECT_IDS[objects[i]]` are art ids
     (`terrain/grass`, `props/tree`).
   - **Actors.** Draw each one at its tile. `look.sprite` is an art id (`people/body`, `creature/wolf`,
     `fx/grave`), `look.tint` the clothes colour, `look.trim` a highlight (nobles), `look.size` a scale (children).
   - **Art you don't have yet.** Keep your own manifest from art ids to your assets, with a fallback per family
     (`terrain/`, `people/`, `creature/`…), so an id you don't know never draws as nothing.
   - **Walking.** Tween an actor to its new place over about `stepMs` per tile (townsfolk can be slower). When a
     mover has a route in `routes`, go through its tiles; never pathfind.
   - **Labels.** Show `label` up close or when hovered, `shortLabel` from afar (travellers, beasts), and the
     `prompt` text under its `target`. Hover text is `tip`. Highlight the prompt's target.
   - **Light and weather.** From `ambience.light` and `ambience.weather`; lit windows and lamps from `lights`.
   - **Speech.** `speech` messages go to a bubble over the speaker and into the chat log. `chatter` and `gossip`
     are bubbles over townsfolk.
5. **Panels.** Lay out `ui` with your UI kit (Unity UI Toolkit, UMG). Every string is in the model, so never build
   a sentence. Every button is a `UiAction`: send its `intent` when pressed, and grey it out when `enabled` is
   false. While `header.busy`, grey the chat's input. A `prompt` message is a modal question: send
   `{ t: "answer", prompt: id, option }`.
6. **Input → intents.**

   | Input | Intent |
   |---|---|
   | arrow keys | `step` |
   | a click on the world | `click` with the tile under the pointer: work it out from your camera, and add your origin if you rebased it |
   | E | `interact` |
   | F | `fight` |
   | R | `flee` |
   | Escape | `close` in a chat, else `cancel` |
   | the chat box | `say` |
   | the window hidden or shown | `view { hidden }` |

7. **Voices.** A `speech` message carries the NPC's `voice` (`NpcVoice`: language, pitch, rate, and a Piper model
   and speaker). Either:
   - send each sentence to `POST /api/speak` `{ npc, text }` and play the WAV it returns; or
   - use your platform's text-to-speech with the voice's settings.

   Speech-to-text (a mic) is yours too: it ends in a `say` intent.
8. **Reconnect** with backoff (0.5 s, 1 s, 2 s … up to 8 s), sending `hello` again. The server sends the whole
   screen back. On `replaced`, stop and tell the player.

## Building without a game running

Record a session (`npm run frames:record`) and play the `.jsonl` file back instead of opening the socket. Each line
is `{ at, msg }`: hand `msg` to your receive function at `at` ms. Everything above works the same, except that
intents go nowhere. This is the way to build a renderer (G6, or a 2.5D prototype) against real frames without the
brain.

## Checking your adapter

- Walk with the keys, and see the ground and the townsfolk follow.
- Click someone across the map: the server walks the player there and opens the chat. Say something: "…", then
  the words stream, then they're done.
- Press F next to a beast, and see the fight clock count down.
- Open the Realm tab, walk to a place: the map turns into the road and the server walks it.
- Press Simulate: hours pass, and a key takes over.
- Reload: the same screen comes back.

If you ever need something the protocol doesn't carry, the protocol is what's missing. Add it to
`shared/src/view/schema.ts` and the server's view layer, run `npm run schema`, and bump `PROTOCOL_VERSION` if old
clients would misread the change.
