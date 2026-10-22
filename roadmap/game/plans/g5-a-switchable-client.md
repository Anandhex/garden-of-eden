[← Game track](../README.md#g5-a-switchable-client) · [G6: the look](g6-the-look.md)

# G5 plan: A switchable client (the brain and the view)

Asked for 2026-10-23: "I want the systems client to be more like an adapter switch to Unity, Unreal or stay on web. I want as little logic as possible to stay in the UI." Order decided the same day: **G5 first (make the client switchable), then G6 (the look), then the [48-day year migration](../../living-world/plans/migration-2026-10-23-one-year-ageless-player.md) part A, then back to features (N40).**

**In one line:** the server becomes **the brain** and the only place that decides anything. It sends the client **what to draw** (frames), **what happened** (events and speech) and **what to show in the panels** (a UI model with every string already written). The client sends back only **intents** (step, click a tile, interact, say, act). All of this goes over **one versioned protocol on a WebSocket**, published as JSON Schema. The Phaser + DOM client becomes the first **adapter**. A Unity or Unreal client is then another adapter written against the same schema: it needs no game rules, only drawing and input.

**Read first:** the [game track](../README.md) (G1: how the client was built), [`protocol.ts`](../../../packages/shared/src/protocol.ts) (today's snapshot), the [plans README](../../living-world/plans/README.md) sections 2–4 (tests, determinism, where code lives). Nothing in the living-world track depends on G5. Every later phase gets cheaper with it, because a feature is then written once, on the server.

## What exists

The server owns every rule, but the browser still works out a lot of the world, and a Unity or Unreal client would have to port that code to C# or C++:

| File | What the browser decides today | Where it goes |
|---|---|---|
| [`crowd.ts`](../../../packages/client/src/crowd.ts) | Runs the whole shared `CrowdSim` (1,236 lines) every game minute to place every townsperson; works out who is nearest (`nearestFolk`), who is a full NPC (`promoted`), who stands on a tile (`folkAt`); writes `describeFolk` and `gossipBubble` text | server frame builder |
| [`roadData.ts`](../../../packages/client/src/roadData.ts) | Builds the open-road terrain from noise (`chunkAt`, 64×64 chunks) and decides what is solid (`solidAt`) | server frame builder (the server already has `chunkAt` in `game/road/ground.ts`) |
| [`travellers.ts`](../../../packages/client/src/travellers.ts) | Fetches journeys and places the people on the road (`journeyLine`, `partyAt`), finds the nearest traveller | server frame builder (the server already places them in `admin/roads.ts`) |
| [`game.ts`](../../../packages/client/src/game.ts) | Decides what a click means (`clickTile`: fight, loot with a confirm, talk, or walk), what E talks to (`nearestTalker`), talk range, "too far" lines, pathfinding (`findPath`, `playerPath`), route planning on the road (`routeTo`, `shortestWay`), the auto-walk loop (`autoWalk`), walking away ends the chat | server intents |
| [`simulate.ts`](../../../packages/client/src/simulate.ts) | The Simulate loop (hours per tick, pause between ticks), when the game pauses for a fight (`heldBy`) | server clocks |
| [`main.ts`](../../../packages/client/src/main.ts) | The time-flow ticker (a game minute every few seconds, and when it pauses), the fight poll (500 ms), the "is Ollama up yet" poll (15 s), the key map | server clocks; the key map stays (input is the adapter's job) |
| [`store.ts`](../../../packages/client/src/store.ts) | Chat logs per NPC, which news was already shown (`lastNewsId`), the fight countdown | server session |
| [`world/WorldScene.ts`](../../../packages/client/src/world/WorldScene.ts), [`CrowdLayer.ts`](../../../packages/client/src/world/CrowdLayer.ts) | Mostly drawing, but also calls `findPath` to animate a walker round obstacles, picks which crowd chats to show, checks `isHostile` and `CLASS_RANK` | drawing stays; the rules go to the frame |

The transport is plain HTTP: `GET /api/state`, `POST /api/move`, `POST /api/act` (an NDJSON stream), `POST /api/tick`, `GET /api/crowd`, `GET /api/road/data`, `GET /api/road/journeys`, `GET /api/realm`, `POST /api/speak`, `GET /api/voice`, `GET /api/quote`, `POST /api/new` ([`web/server.ts`](../../../packages/server/src/web/server.ts)). The client pulls, so it needs timers to see anything change.

Good news: positions are already in world units (tiles; travellers are fractional global tiles), not screen pixels, and the typed events (T13) are already a clean "what happened" stream.

## Decisions made in this plan

1. **The rule of the line.** An adapter may decide **how** to show something, never **what is true or allowed**. Tweening, sprites, layout, colours, sound mixing, the key map: the adapter's. Who is where, who can be talked to, what a click does, whether time passes, every sentence that states a game fact: the server's. If an adapter would need an `if` about the game, the server sends the answer instead.
2. **One protocol, defined once.** Zod schemas in `packages/shared/src/view/` (shared gains `zod` as a dependency, the same version as the server). TypeScript types come from them (`z.infer`). `npm run schema` writes JSON Schema to `protocol/schema/` with `z.toJSONSchema`, so Unity (C#) and Unreal (C++) types can be generated with any JSON Schema code generator, and a test fails if the committed schema is out of date. `PROTOCOL_VERSION` (an integer) goes in the `hello` message. The server refuses a client with a different major version and says why.
3. **One WebSocket per player**, at `/ws`, using the `ws` package (Node 22 has a WebSocket client but no server; `ws` is small, has no dependencies, and Unity (NativeWebSocket) and Unreal (its WebSockets module) both talk to it). Messages are JSON, one per frame of the socket. The HTTP API stays for tests, the CLI and the admin page while G5 is built, and `/api/act`, `/api/move` and `/api/tick` are removed in the last step.
4. **A `ViewSession` per connection** (`server/src/view/session.ts`) holds everything a view needs that isn't the game's state: the view box, the frame last sent (to send changes only), the feed and chat history, pending prompts, the session's clocks and its walk. A second connection to the same save takes the session over and the first is told `replaced`. Nothing in a session is saved: it is rebuilt from the game on connect, so **no save bump**.
5. **The server runs the clocks.** Time flow, Simulate, the fight clock and walking all run in the session and push frames. Adapters have no game timers. (Animation timers are fine: that's drawing.)
6. **The server walks the player.** `moveTo {x,y}` and `travel` make the server plan the path and step it at `STEPS_PER_SECOND`, sending a frame per step, and stop on anything that would stop `autoWalk` today (a person, a choice, a fight, damage, arriving, a new map). Any other intent cancels the walk. Arrow keys stay one `step` each.
7. **Frames carry the view box only.** The box is the adapter's viewport (it sends `view {w,h}` in tiles; today 26×18) plus a margin of 6 tiles. Terrain goes as **patches** (16×16 tiles, keyed `map:px:py` or `road:px:py`) that the adapter caches, so a patch is sent once until it changes. Actors in the box go every frame they change. This replaces "compute it all locally to save bandwidth": a frame is a few KB, and walking already makes one round trip per step.
8. **Strings come from the server.** Labels, tooltips, the E prompt ("E: talk to Ada Lowe"), feed lines, chat entries, menu labels, confirm texts. The adapter never assembles a sentence about the game. (Localisation, later, is then a server concern too.)
9. **Panels are data, not HTML.** The UI model says what each panel holds (`header`, `sheet` tabs, `chat`, `feed`, `modal`, `realm`, `roadbar`), with actions as `{ id, label, enabled, intent }`. Each adapter draws panels its own way (DOM, Unity UI Toolkit, UMG). The realm map stays `RealmView` data that the adapter draws.
10. **Voice.** Speech arrives as text deltas with the NPC's voice id. An adapter either plays the server's Piper audio (`POST /api/speak` stays as plain HTTP, since a binary blob doesn't belong on the JSON socket) or uses its platform's own text-to-speech. The microphone (speech to text) is the adapter's, and it produces a `say` intent.
11. **The admin page is out of scope.** It is a web tool for the developer. It keeps its HTTP API and may keep using `CrowdSim` in `admin/follow.ts`.
12. **The web client splits in two:** `client/src/core/` (connect, keep the latest frame and UI model, send intents: engine-free TypeScript and the reference for other engines, target under 400 lines) and `client/src/adapter/web/` (Phaser world plus DOM panels). `core/` imports from `@millbrook/shared` **only `view/*`**, and a test enforces it.

## Data shapes

```ts
// packages/shared/src/view/  (zod; types shown)
type ServerMsg =
  | { t: "hello"; version: number; session: string }
  | { t: "frame"; seq: number; frame: Frame }            // whole on connect and on a new map, changes after
  | { t: "event"; event: GameEvent }                      // T13, unchanged
  | { t: "speech"; npc: string; voice: NpcVoice | null; delta?: string; filler?: string; done?: true; thinking?: true }
  | { t: "ui"; ui: Partial<UiModel> }                     // changed panels only
  | { t: "prompt"; id: string; title: string; body: string; options: Array<{ id: string; label: string }> }
  | { t: "replaced" } | { t: "error"; text: string };

interface Frame {
  map: { id: string; name: string; kind: "place" | "road"; w: number | null; h: number | null };
  box: { x0: number; y0: number; x1: number; y1: number };       // tiles, world units
  patches?: Array<{ key: string; x0: number; y0: number; ground: number[]; objects: number[]; layer?: "ground" | "buildings" | "props" }>;
  buildings?: Array<{ id: number; x: number; y: number; w: number; h: number; kind: string; lit: boolean; label: string }>;
  actors: { upsert: Actor[]; remove: string[] };
  player: { id: "player"; x: number; y: number };
  ambience: { light: number; timeOfDay: string; weather: string; season: string };  // 0..1 daylight; G6 lights read it
  prompt: string | null;                                           // "E: talk to Ada Lowe"
  stepMs: number;                                                  // how long a move should take to animate
}

interface Actor {
  id: string;                          // npc id, person id, creature uid, "player"
  kind: "player" | "npc" | "folk" | "traveller" | "creature" | "companion";
  x: number; y: number;                // tiles; fractional allowed (travellers)
  facing?: "n" | "e" | "s" | "w";
  look: { sprite: string; tint?: string; size?: number };        // G6 maps `sprite` to art
  label: string | null;                // shown when near or hovered
  tip: string;                         // hover text, already written
  hp?: number;                         // 0..1
  mood?: string;                       // "happy" ... → an emote
  flags: Array<"hostile" | "dead" | "unconscious" | "engaged" | "quest" | "busy" | "inside">;
  bubble?: string;                     // crowd chatter or gossip line to show now
  route?: Array<{ x: number; y: number }>;  // the tiles to animate through (no pathfinding in the adapter)
}

type Intent =
  | { t: "hello"; version: number; view: { w: number; h: number }; engine: string }
  | { t: "view"; w: number; h: number }
  | { t: "step"; dx: -1 | 0 | 1; dy: -1 | 0 | 1 }
  | { t: "moveTo"; x: number; y: number }
  | { t: "click"; x: number; y: number }                 // the server resolves: fight, loot (prompt), talk, walk
  | { t: "interact" }                                    // E
  | { t: "fight" } | { t: "flee" }                       // F, R
  | { t: "say"; mode: "say" | "do" | string; text: string }
  | { t: "act"; action: string; args?: Record<string, unknown> }   // forage, sneak, wait, craft, travel, quote...
  | { t: "close" }                                       // leave the conversation
  | { t: "answer"; prompt: string; option: string }
  | { t: "time"; flow: boolean }
  | { t: "simulate"; speed: "off" | "slow" | "normal" | "fast" | "days" }
  | { t: "cancel" }
  | { t: "newGame" };

interface UiModel {
  header: { clock: string; place: string; hp: string; coin: string; busy: boolean; actions: UiAction[]; time: { flows: boolean; shown: boolean }; simulate: { speed: string; note: string | null } };
  feed: { lines: Array<{ id: number; kind: string; text: string }> };            // last 200
  chat: { open: false } | { open: true; npc: string; name: string; log: Array<{ kind: string; text: string }>; modes: UiAction[]; menu: UiAction[] };
  sheet: { tabs: Array<{ id: string; label: string; sections: Array<{ title: string; rows: Array<{ text: string; actions?: UiAction[] }> }> }> };
  roadbar: { shown: boolean; text: string; actions: UiAction[] } ;
  realm: RealmView | null;            // drawn by the adapter
  modal: { kind: "situation" | "craft" | "voices"; title: string; body: string; actions: UiAction[] } | null;
}
interface UiAction { id: string; label: string; enabled: boolean; why?: string; intent: Intent }
```

## Steps

Each step keeps the web game playable. Do them in order.

### Step 1: the protocol package

`shared/src/view/` with the schemas above, `index.ts` re-exporting them, `PROTOCOL_VERSION = 1`. `npm run schema` writes `protocol/schema/server-msg.json` and `protocol/schema/intent.json`. Add a short `protocol/README.md`: what each message means, the rule of the line, and the order of messages on connect (`hello` → `hello` → whole `frame` → whole `ui`).

### Step 2: the socket and the session

`ws` in the server. `server/src/view/session.ts` (`ViewSession`), `server/src/view/socket.ts` (upgrade on `/ws`, parse each intent with zod and answer bad ones with `error`, one session per save, `replaced`). Intents go through the existing request queue ([`queue.ts`](../../../packages/server/src/web/queue.ts)) so a socket and an HTTP call never race. Wire `act` and `step` to the code the HTTP routes already call; the stream events become `speech`, `event` and `ui` messages.

### Step 3: the frame builder

`server/src/view/frame.ts`: `buildFrame(game, session) → Frame` and `diffFrame(prev, next)`. Port into it, from the client: crowd placement for the box (`CrowdSim.all`, `chats`, gossip bubbles, `promoted`), travellers (`partyAt` over the journeys in the box), road terrain patches (`chunkAt` from `game/road/ground.ts`, cut to 16×16), map terrain patches, building `lit` (anyone inside after dark), labels, tips (`describeFolk` moves here), the E prompt (`nearestTalker` moves here). Animated walking for NPCs: send `route` (the server already knows their path) instead of the adapter calling `findPath`. The web client switches to drawing from frames; `crowd.ts`, `roadData.ts` and `travellers.ts` are deleted at the end of this step.

### Step 4: intents that need deciding

`server/src/view/intents.ts`: `click` (port `clickTile`, including the loot confirm as a `prompt`), `interact` (`nearestTalker` then open), `fight`/`flee` (`nearestCreature`), `moveTo` and `travel` (port `playerPath`, `routeTo`, `walk`, `autoWalk` into a `Walk` held by the session, cancelled by any other intent), `close`, and "you walk away" when a step takes the player out of talk range. Lines like "You are too far from Ada." go to the feed from here.

### Step 5: the clocks

In the session: time flow (today's `postTick` rules: not while talking, working, walking, simulating, fighting or held, and only while the adapter says it is visible: add `{ t: "view", hidden: true }`), Simulate (`SPEEDS`, `heldBy`), the fight clock (push a frame and `ui` when the opponent's turn plays, instead of the 500 ms poll), and the model check (push `ui` when Ollama comes up, instead of the 15 s poll). The time-flow on/off choice is kept per save in the session store (it was `localStorage`).

### Step 6: the UI model and history

`server/src/view/ui.ts`: `buildUi(game, session) → UiModel` and changed-panel diffs. Move into it: the feed and chat history (from `store.logs`), news replay without repeats (from `lastNewsId`), the header's busy state (from `setBusy`), the chat's modes and the N38 action menu, the sheet's tabs (port the text-building parts of [`ui/sheet.ts`](../../../packages/client/src/ui/sheet.ts), [`ui/realm.ts`](../../../packages/client/src/ui/realm.ts), [`ui/roadbar.ts`](../../../packages/client/src/ui/roadbar.ts), [`ui/modals.ts`](../../../packages/client/src/ui/modals.ts) into rows and actions). `newGame`'s confirm becomes a `prompt`.

### Step 7: split the web client

`client/src/core/` (connection with reconnect and backoff, the frame and UI mirror, `send(intent)`, an `EngineAdapter` interface) and `client/src/adapter/web/` (today's Phaser scene and DOM panels, reading only the mirror):

```ts
// client/src/core/adapter.ts
export interface EngineAdapter {
  start(core: Core): void;                 // core.send(intent), core.frame, core.ui
  frame(f: Frame, changed: FrameChange): void;
  event(e: GameEvent): void;
  speech(s: SpeechMsg): void;
  ui(u: UiModel, changed: Array<keyof UiModel>): void;
  prompt(p: PromptMsg): void;
}
```

Delete `game.ts`, `simulate.ts`, `store.ts` and `api.ts` (their remains are in `core/`). The key map, mouse to tile and the voice playback stay in the adapter.

### Step 8: guard the line, and a recorder

- `client/tests/imports.test.ts` (or in the server's vitest run): no file under `client/src/core` or `client/src/adapter` imports anything from `@millbrook/shared` but `view/*` and `GameEvent`; specifically none of `CrowdSim`, `findPath`, `chunkAt`, `partyAt`, `journeyLine`, `shortestWay`, `tileDistance`, `isHostile`, `CLASS_RANK`.
- `npm run frames:record -- <minutes>` writes every server message of a scripted session to `protocol/recordings/*.jsonl`; `core` can replay a file instead of a socket (`?replay=<file>`). G6 and any Unity or Unreal prototype develop against recordings without running the brain.

### Step 9: a second adapter, to prove it

A plain `<canvas>` adapter (`client/src/adapter/canvas/`, no Phaser, squares and text, under 500 lines) that plays the whole game through `core`. If it needed anything not in the protocol, the protocol is missing something: fix the protocol, not the adapter. Then write `protocol/ADAPTERS.md`: how to write a Unity or Unreal adapter (generate types from the schema, open the socket, send `hello`, keep the patch cache, draw actors, tween along `route`, map keys to intents, play `speech`). An optional Unity spike (a scene that connects and draws coloured quads from frames) belongs in `clients/unity/` if wanted, and is not needed for done.

## Edge cases and traps

- **The step feels slow.** It doesn't get slower than now: a step is already a round trip. Don't add client prediction in G5 (it needs solidity rules in the adapter). If it's needed later, send a `solid` bit per tile in patches and let the adapter predict, then snap to the frame.
- **Hover tooltips can't wait for a round trip.** That's why every actor carries its `tip`. Buildings carry `label`. Hovering empty ground shows nothing.
- **Frames per minute in Simulate "days" mode** can be many. Throttle frames to 20 a second; the UI to 5 a second; always send the last one.
- **The queue.** A walk's steps and a chat line must not interleave wrongly. Every intent goes through the queue; a walk yields between steps; `say` cancels a walk first.
- **Crowd chats were picked for the camera's box.** The server now picks them for the session's box: the same rule, one place.
- **A full NPC and the same townsperson** must not both be sent (the old `promoted` check): the frame builder sends one actor per person id.
- **Changing maps** (an exit, a fast travel): a whole frame, patches cleared, the old actors removed.
- **Reconnect** must give back the same screen: the session rebuilds the frame and UI from the game and its history, so a reload shows the chat you were in.
- **Two tabs open:** the newer takes over and the older shows "Playing in another window".
- **Admin's follow view** keeps `CrowdSim` in the browser; that is allowed (decision 11), and the import test skips `client/src/admin/`.
- **Determinism:** nothing in `view/` may change the game or draw from the game's dice streams. A test runs the same intents with and without a socket attached and compares the save hash.

## Tests (`packages/server/tests/g5.test.ts`)

1. **Schema:** the committed JSON Schema equals what `npm run schema` makes now.
2. **Handshake:** connect, `hello` with the right version → `hello`, a whole frame, a whole UI; a wrong version → `error` and close.
3. **Headless play, protocol only** (a test adapter that only reads messages and sends intents, with the fake model from `server.test.ts`): walk with `step`; `click` a townsperson's tile far away → the server walks the player there (frames show the player moving) and opens the chat; `say` a line → `speech` deltas then `done`; `close`; `click` a dead NPC → a loot `prompt`; `answer` it → the item is in the sheet's inventory tab.
4. **Clocks:** with time flowing, frames arrive with no intents sent and the clock string moves on; it stops while talking and when the view is hidden. `simulate normal` → hours pass; a fight holds it with the note "paused: you're in a fight".
5. **Road:** start a journey with `act travel` → the server walks the road; a traveller met stops the walk; frames hold road patches and traveller actors with fractional positions.
6. **Frames are small:** a step on a busy town map sends under 8 KB; standing still for a game minute sends only the actors that moved.
7. **Reconnect:** drop the socket mid-chat, reconnect → the chat panel is open with the same log.
8. **Same game with or without a view:** the save hash after a scripted run is the same with a socket attached and without.
9. **The import guard** (step 8).

## Done when

- The web game plays exactly as before, but the browser runs **no simulation, terrain, placement, pathfinding, targeting or clock code**: `crowd.ts`, `roadData.ts`, `travellers.ts`, `game.ts`, `simulate.ts`, `store.ts` and `api.ts` are gone, and the import test passes.
- The second adapter (plain canvas) can walk, talk, fight, travel and simulate with only the protocol.
- `protocol/schema/*.json`, `protocol/README.md` and `protocol/ADAPTERS.md` exist, and a recording replays in the web adapter with no server running.
- `npm test`, `npm run typecheck` and `npm run bench` pass; the G1 done-when (walk to someone, buy something, see it in the inventory) still works in the browser.

## Out of scope

- Multiplayer (several players in one world). The session is per player, so the shape allows it later, but nothing here builds it.
- Client prediction and lag smoothing beyond tweening.
- New art, lighting or 2.5D: that is [G6](g6-the-look.md).
- Porting the admin page.
