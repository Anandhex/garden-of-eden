# Play: control, camera and HUD (GardenOfEden.Play)

The server is authoritative. This layer sends intents and draws what the ui model says. It has no rules, no
pathfinding and composes no game sentences.

## Running it

1. Start the game server for Unity (port 3000, a fake model, no Ollama needed), from the repo root:
   `npm run unity:server -w packages/server` (or `npx tsx packages/server/scripts/unity-server.mts`; `PORT=` to change it).
   It prints `READY 3000`.
2. Open `unity/GardenOfEden` in Unity 6000.3, open `Assets/Game/Scenes/Main.unity` and press Play. `GameClient` connects to
   `localhost:3000`.

## Scene setup
One GameObject each (all find their neighbours automatically):
- `GameClient` (Net) and the `WorldView` (World).
- On the Camera: `CameraRig`.
- Any object: `PlayerControl`.
- Any object: `Hud` (a `UIDocument` is added; panel settings, `Hud.uxml` and `Hud.uss` load from `Resources/` when not assigned).
  For the best theme assign a PanelSettings asset (Create > UI Toolkit > Panel Settings Asset); otherwise one is made at runtime.
- `PlayInput` is created on demand and loads `Resources/GardenOfEdenInput.inputactions` (action map `Player`).

## Controls
| Input | Action |
|---|---|
| WASD / arrows / left stick | Move (relative to the camera yaw) |
| Right mouse (hold) / right stick | Orbit yaw and pitch (cursor locked only while held) |
| Scroll / d-pad up-down | Zoom: one curve from ~4 m over-the-shoulder to ~40 m, ~55 degree overview |
| Left click | Nothing in the world (no click-to-move) |
| E | Interact with the prompt target |
| F / R | Fight / flee |
| Tab | Sheet and panels |
| Esc | Leave the text box, else close the sheet, else close the chat, else cancel the walk |

## Input to intents
- Movement: the camera-relative direction is matched to the best of 8 tile directions, using the tile-to-world
  basis measured from `WorldView.TileToWorld` (no axis convention assumed). `step {dx,dy}` is sent every
  `max(stepMs, cadenceFactor / WorldView.WalkTilesPerSecond)` while held, i.e. just before the smoothed avatar reaches its tile, so walking is continuous.
- Interact/fight/flee: `interact`, `fight`, `flee`. The prompt line shown is `frame.prompt.text`.
- Esc: `close` while a chat is open, else `cancel`.
- Chat box: `say {mode,text}`; modes come from `chat.modes`; the row is disabled while `header.busy`.
- Questions (`prompt` messages): one button per option sends `answer {prompt,option}`.
- Panel buttons: `GameClient.Press(action)` sends `action.intent` (with the text box value in `args[input.arg]` when the action has an `input`).
- Header: simulate speeds (`simulate {speed}`) with the model's labels; time toggle (`time {flow}`) uses play/pause glyphs.

## Extending panels
Panels are generic: `Hud.RenderSections` draws any `UiSection` (title, rows with text, value, bar, actions).
- New content in an existing panel: change nothing here, the server model carries it.
- A new panel key: add an element to `Hud.uxml`, find it in `TryBind`, add a branch in `OnUi` and a `Render...` method
  that builds rows with `RenderSections` / `MakeAction`. Style with classes in `Hud.uss` (`panel`, `btn`, `ui-row`, `title`, `dim`).
- Never write sentences in code; use the model's text, or glyphs for pure controls.

## Known gaps
- Realm map panel (`ui.realm`) is not drawn. Voice (cast/TTS) is not here.
- Fonts: dynamic OS serif (Georgia/Palatino/Times) is requested at runtime; no font asset is shipped.
- Not compiled or run: first import may need small API fixes (UI Toolkit/Input System versions).
