# The view protocol (G5)

The game server is **the brain**: it holds every rule, runs every clock and decides everything. A client is an
**adapter** that draws what the server sends and sends back what the player wants. The web game (Phaser and DOM),
the plain canvas page and a future Unity or Unreal client all speak this one protocol, over one WebSocket.

- **Source of truth:** the zod schemas in [`packages/shared/src/view/schema.ts`](../packages/shared/src/view/schema.ts).
  TypeScript types come from them.
- **JSON Schema** for other languages: [`schema/`](schema/) (`intent.json`, `server-msg.json`, `frame.json`,
  `ui-model.json`). `npm run schema` writes these files, and a test fails if they fall behind the zod schemas.
- **Version:** `PROTOCOL_VERSION` (now `1`) is in both `hello` messages. The server refuses a client on another
  version, says why, and closes with code `4001`.
- **Writing an adapter:** [ADAPTERS.md](ADAPTERS.md).

## The rule of the line

An adapter may decide **how** to show something, never **what is true or allowed**.

The adapter decides: tweening, sprites, layout, colours, sound mixing and the key map.

The server decides:
- who is where, and who can be talked to;
- what a click does, and whether time passes;
- every sentence that states a game fact.

If an adapter would need an `if` about the game, the server sends the answer instead. A test guards this for the
web client: no file under `packages/client/src/core` or `packages/client/src/adapter` imports anything from
`@millbrook/shared` except its `view` entry, and none uses `CrowdSim`, `findPath`, `chunkAt`, `partyAt` and the
like.

## The connection

`ws://<host>/ws`: one WebSocket per player. Each message is one JSON object.

On connect:

1. The client sends `hello` `{ version, view: { w, h }, engine }`. `view` is the viewport in tiles; the web
   adapter's is 26×18.
2. The server answers with `hello` `{ version, session }`.
3. Then a **whole** frame (`frame` with `whole: true`).
4. Then the **whole** UI model (`ui`, every panel, the feed included).

Anything sent before `hello` gets an `error`. So does a message that doesn't match the schema; the session goes on.

There is one session per save. A newer connection takes the session over: the older socket gets `replaced` and is
closed with code `4000`. The session (feed, chat logs, open dialog, realm selection) outlives a socket, so a reload
gives back the same screen. Nothing in the session is saved except the time-flow switch (in `<save>.view.json`).

## Server → adapter

| Message | Meaning |
|---|---|
| `hello` | The protocol version and a session id. |
| `frame` | What to draw. Whole on connect and on a new map, changes after (see below). `seq` counts frames. |
| `event` | Something happened, for the screen to animate: the typed game events (`GameEvent`, [`events.ts`](../packages/shared/src/events.ts)): moods, trust, items and coin moving, HP, attacks, quests, deaths. |
| `speech` | An NPC talking: `thinking` (show "…"), then `delta` text as it streams, then `done`. A `filler` is a short line said while the model is slow. `voice` is how they sound (`NpcVoice`). |
| `ui` | Panels that changed, whole (`header`, `chat`, `sheet`, `roadbar`, `realm`, `modal`, `cast`; `feed` only on connect). |
| `feed` | New lines at the end of the feed. |
| `prompt` | A question for the player (a confirm, a price): answer with `answer { prompt, option }`. |
| `replaced` | Another window took the session over. |
| `error` | A message refused, or a problem to show. |

### The frame

Positions are **tiles** (world units), not pixels. Travellers on the road may stand between tiles (fractional).

- `map`: id, name, `kind` (`place` or `road`) and size (`null` on the road, which has no edge).
- `box`: the tiles in view, which is the adapter's viewport plus 6 tiles on each side.
- `patches`: terrain in 16×16 pieces, keyed `<map>:<px>:<py>`. Each has row-by-row `ground` (indices into
  `TERRAIN_IDS`) and `objects` (indices into `OBJECT_IDS`, 0 = nothing) from
  [`art.ts`](../packages/shared/src/view/art.ts). **A patch is sent once per map: keep a cache.** A new map clears it.
- `buildings`, `lights`, `signs`: the ones in the box, sent whole whenever they change. Whether a window is `lit`
  is a fact (someone is home after dark); how it glows is up to the adapter.
- `actors`:
  - `upsert`: actors new or changed in more than their place, sent whole.
  - `move`: actors that only moved, as compact `[id, x, y]` (a busy town moves hundreds a minute).
  - `routes`: `{ id, route }` for some of the movers: the tiles to walk through, so an adapter never pathfinds.
  - `remove`: actors gone from the box.

  An actor carries what to draw (`look.sprite`, an art id, with a `tint`, a `trim` and a `size`), `label`,
  `shortLabel` (shown from afar), `tip` (hover text, already written), `hp` (0–1) and `flags`.
- `player`: where the camera follows.
- `ambience`: `light` (0 night … 1 day), time of day, weather, season.
- `prompt`: "E: talk to Ada Lowe", with the actor it's under (`target`) and a `tone`. Its target is the one to
  highlight.
- `fight`: seconds left to act, and the turn length. Count down locally between frames.
- `chatter`: crowd exchanges to show now. `a` says `lines[0]`, `b` answers with `lines[1]`. `hot` marks a
  quarrel; `bow` means `a` bows.
- `gossip`: something a townsperson just passed on, as a bubble.
- `stepMs`: how long a step should take to animate.

The server picks what goes in a frame for the box, so the adapter never filters by rules. The crowd's chatter is
picked there too (quarrels first, then nearest, spaced so the bubbles don't overlap).

### The UI model

Every panel is data, and every sentence is already written. A button is a `UiAction`: `{ id, label, enabled, why?,
style?, input?, intent }`. Pressing it sends `intent` as it is. With `input`, put the text box's value into
`intent.args[input.arg]` first (giving coin: "5 silver").

| Panel | Holds |
|---|---|
| `header` | Place, clock, weather, HP, MP, coin, the model's state and banner, `busy` (an action is running: grey the inputs), the header's actions, the time-flow switch, Simulate (speed, the note, the speeds on offer). |
| `feed` | The last 200 lines. |
| `chat` | `{ open: false }`, or the NPC's name, role and stats, the log, offers to accept or decline, quick lines, the modes of speech (say, persuade, …) and the tools. |
| `sheet` | Tabs (Character, Inventory, Quests, World, Realm) of sections of rows: text, an optional value, a progress `bar` (0–1) and buttons. |
| `roadbar` | On the road: where, how far, supplies (`need` 0–100) and what can be done here. |
| `realm` | The realm map's data (`RealmView` plus `here` and `selected`), for the adapter to draw. Picking a place sends `select { what: "realm", id }`. |
| `modal` | A dialog the server opened (training, wares, repairs, give, favours, orders, steal, abilities, craft, a situation on the road), or `null`. |
| `cast` | Who speaks, with a sample line and their voice, for voice settings. |

## Adapter → server (intents)

| Intent | Meaning |
|---|---|
| `hello` | Start, as above. |
| `view` | The viewport changed (`w`, `h`), or the window was hidden or shown (`hidden`). Time doesn't flow while hidden. |
| `step` `{ dx, dy }` | One step (arrow keys). |
| `click` `{ x, y }` | The player clicked a tile. The server decides what it means: fight, loot (asks first), talk (walking up first, following if they move), or walk there. |
| `moveTo` `{ x, y }` | Walk there and nothing else. |
| `interact` | E: talk to whoever is nearest in reach. |
| `fight`, `flee` | F and R. |
| `say` `{ mode, text }` | A line in the open chat (`mode`: say, persuade, intimidate, haggle, lie). A line said while the last reply is still coming waits its turn. |
| `act` `{ action, args }` | Any action, as the UI model's buttons send them. |
| `panel` `{ panel }` | Open a dialog by name, or close it (`null`). |
| `select` `{ what, id }` | Pick something in a panel (a place on the realm map). |
| `close` | Leave the conversation. |
| `answer` `{ prompt, option }` | Answer a prompt. |
| `time` `{ flow }` | Let time flow while standing about, or make it wait. |
| `simulate` `{ speed }` | `off`, `slow`, `normal`, `fast` or `days`. |
| `cancel` | Stop a walk or Simulate, close a dialog. |
| `newGame` | Start again (asks first). |

Any intent but `view` and `answer` stops a walk; moving, clicking or acting stops Simulate.

## Beside the socket

- `GET /api/voice` and `POST /api/speak` `{ npc, text }` → WAV: the server's Piper voice, for adapters that play
  it. The audio is a binary blob, so it stays plain HTTP. Adapters may use their platform's speech instead.
- `GET /api/state`: the whole game, read-only, for tests and debugging.
- The admin page (`/admin`, `/api/admin/*`) is a web tool for the developer and isn't part of this protocol.

## Recordings

`npm run frames:record -- [minutes] [name]` plays a scripted session against a real server, on a new world with a
fake model. It writes every server message to [`recordings/<name>.jsonl`](recordings/), one `{ at, msg }` per line
(`at` is ms from the start). The script looks about town, walks up to someone and talks, stands about while time
flows, then sets out on the road.

To play one back with no game server running: `npm run frames:play` (the Vite dev server), then open
`http://localhost:5173/?replay=/recordings/<name>.jsonl`, or `canvas.html?replay=…` for the plain adapter. The
core plays the messages with their own timing and ignores intents.
