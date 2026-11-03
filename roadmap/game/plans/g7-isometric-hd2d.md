[← Game track](../README.md#g7-isometric-hd-2d) · [G6: The look](g6-the-look.md)

# G7 plan: Isometric HD-2D (the world in 2.5D)

Asked for 2026-11-03: "it would be more interesting if the world is more of 2.5D rather than top down", then "can I not mix HD-2D and isometric view?". Yes: **isometric is a camera, HD-2D is a way of drawing**, so the two mix. G7 draws the world as a small lit diorama seen from a corner: real 3D ground and buildings, the pixel-art people, beasts and trees standing in it as upright sprites, sun shadows, glowing lights, fog and the tilt-shift blur that HD-2D games are known for. It is G6's checkpoint (step 7) taken up: **a second world renderer in Three.js**, not a new engine. Unity or Unreal are not needed (the reasons are under Decisions).

**In one line:** a Three.js world view beside the Phaser one, chosen in the header (`🧊 2.5D` / `▦ Flat`) or with `?view=iso|flat`; the same frames, art ids, templates and lights; an orthographic camera turned 45° and tilted down 35°, turnable in quarter turns (Q/E); buildings as boxes with gable roofs dressed in the template's own tiles; billboards for everything that stands; real sun and lamp light; DOM labels and bubbles over it.

**Read first:** [G5](g5-a-switchable-client.md) (the frame and the adapter's rules), [G6](g6-the-look.md) (art ids, the manifest, templates, `lights`, `ambience`). G7 changes **only the web adapter**. No rules, no frame fields, no save bump.

## What exists

- The web adapter ([`adapter/web/main.ts`](../../../packages/client/src/adapter/web/main.ts)) owns panels, voice, sound and keys; Phaser's `WorldScene` draws the world and has a small surface: `frame(change, f)`, `event(e)`, `speech(npc, text, opts)`, `setLook`, `lookNow`.
- Art: `npm run art` packs 16 px text sprites ×4 into `public/art/<sheet>.png` + Phaser atlas JSON; `art/sheets.json` gives each frame's logical size and foot. A person is 16×20 (1¼ tiles), a tile 16×16.
- Templates (`shared/view/templates.ts`) give a building's roof rows (`*_top`, `*_mid`, `*_near`, each `_l/_m/_r`), its front wall row (with `_win` windows and the door), props on the roof or front wall, and lights.
- Light facts (`lights`, `ambience`) and their look ([`lightPlan.ts`](../../../packages/client/src/adapter/web/world/lightPlan.ts)) are Phaser-free and reusable.
- The server sends a box of `view` tiles round the player (clamped to 80×60).

## Decisions made in this plan

1. **Three.js, in the web adapter.** HD-2D is a lit 3D scene of flat sprites with shadows, bloom and depth blur. Three.js does all of it in the browser at this scale (a few hundred sprites). Unity would add editor tooling and native builds but heavy web builds; Unreal is for realistic 3D and has no web build. G5's protocol keeps a Unity adapter possible later. Three.js is pinned (`three@0.187.0`).
2. **One adapter, two world views.** `WorldView` is the interface both worlds implement; `main.ts` loads one with a dynamic import, so the flat view never loads Three.js and the 2.5D view never loads Phaser. The choice is this browser's setting (`millbrook-view`), `?view=` overrides it for a visit, and 2.5D is the default.
3. **Isometric camera, turnable.** Orthographic, yaw 45° + 90°·turn, pitch 35°, following the player smoothly; the wheel zooms (clamped). Q and E turn a quarter, eased. **Keys follow the screen:** W is always the grid direction that goes up-right on screen, so turning the camera never turns the controls inside out.
4. **World units are tiles.** Tile (x, y) is the box x..x+1, z = y..y+1 on the ground (y up). Road maps keep G6's moving origin (re-centred past 2 500 tiles) so the GPU keeps small numbers.
5. **Buildings are boxes dressed in their template.** Walls 2 tiles high: the lower band is the template's front row (door, windows), the upper band the same row with the door made plain. The back repeats the front without a door; the sides run the edge and middle pieces; a door on another side is drawn on that side. A gable roof along the front, its slopes drawn from the `mid` and `near` roof rows, its ridge from `top`, tinted like G6. Faces are composed once per building into a canvas texture from the atlas, at the art's own pixel size, nearest-neighbour. A template with no roof (a camp's fire) stands its tiles up as billboards instead.
6. **The box stands inset, and people in a doorway step out of it.** The box is inset a third of a tile from the building's rectangle. An actor whose tile is inside a box (on its door, mid-walk through it) is drawn just outside the nearest face: drawing only, the tile is still the server's.
7. **Everything that stands is a billboard that faces the camera's yaw:** trees, rocks, signposts, props, doors and gates (instanced, one draw per frame name), people and beasts (one mesh each), all casting sun shadows (alpha-tested). A person's four layers are **baked** once per look (body, tinted clothes, hair, trim) into a small canvas of all twelve walk frames, so a crowd costs one draw a person.
8. **Town walls are blocks** (1.5 tiles high, `wall_face` on the sides, `wall_top` on top), instanced.
9. **Light:** a hemisphere light for the ambient colour (`ambientOf`), a sun whose height and colour follow `ambience.light` and the time of day and whose shadow box follows the player; the nearest 8 lights that are on get a real point light (flickering like G6), every light that is on gets an additive halo; lit windows are emissive panes on the facade.
10. **Atmosphere (the ✨ button):** fog by weather and season, rain and snow as falling points round the camera, fireflies on warm clear nights, chimney smoke, snow lying as a white tint on the ground; post-processing of bloom and tilt-shift blur (the HD-2D band in focus round the player). Atmosphere off turns all of it off but the weather itself.
11. **Words stay crisp in the DOM:** names, bubbles, the E/F prompt, the fight clock, floating numbers, emotes, signs and the tooltip are HTML over the canvas, placed by projecting their 3D point each frame.
12. **Clicks:** a ray from the pointer hits the actors' billboards first (the nearest), then the ground; the tile goes to the server as `click`, as before. The tile under the pointer is outlined on the ground.
13. **Bigger view box:** the diamond on screen covers more tiles than the flat view, so the 2.5D view asks for `view` 40×40.

## Steps

1. **Switch and interface.** `adapter/web/worldView.ts` (`WorldView`, `viewPref`, `saveViewPref`); `main.ts` loads the chosen world; a header button flips it (and reloads). Phaser's `startWorld` returns its scene as a `WorldView`.
2. **Pure layout, testable without WebGL** (`adapter/web/iso/`): `camera.ts` (yaw per turn, screen keys to grid steps, the camera's offset), `massing.ts` (a building's box, faces, roof rows, decals and billboards from `dress`; the doorway nudge; whether a building hides the player), `bake.ts` (tinting and stacking a person's layers on pixels).
3. **The atlas** (`iso/atlas.ts`): load the six sheets and their atlas JSON; a frame's UV rect and logical size; draw a frame into a canvas (for faces and bakes); a fallback colour for a missing frame (warned once, never empty).
4. **The scene** (`iso/IsoWorld.ts`): renderer, camera, follow, zoom, Q/E, resize; the ground pool round the player (one merged mesh of tile quads, the Wang corner tiles over it, water shimmer, a dark plane off a place's edge); props and town walls instanced.
5. **Buildings** (`iso/buildings.ts`): boxes, roofs, decals, chimneys, window panes lit by the server's window lights, the plain block for an unknown template; fading a building that stands between the camera and the player.
6. **Actors** (`iso/actors.ts`): baked looks, walking along the server's route at G6's speeds, four-way facing turned by the camera, the bob, lunge, flash, fades, size; beasts trotting, graves.
7. **Light and atmosphere** (`iso/lights.ts`, `iso/atmosphere.ts`): as in decisions 9–10; marks (N31) as soot on the ground, graves as stones, banners and scaffolds as billboards.
8. **Overlay** (`iso/overlay.ts`): decision 11, with G6's rules for whose name shows.
9. **Tests and docs**: `g7.test.ts`; this file's Built section; the game track; `art/README.md` on how art is used in 2.5D.

## Edge cases and traps

- **Pixel art on 3D faces** must stay crisp: nearest filtering, no mipmaps, faces composed at the art's own pixel size.
- **Shadow acne and peter-panning:** a small bias, and the shadow box kept tight round the player (re-centred in whole tiles so shadows don't swim).
- **A camera turn mid-walk:** keys read the turn when pressed; sprites' facing is turned by the camera so "walking north" looks right from every side.
- **Hidden tab:** the loop pauses with the page like Phaser's; nothing is lost because the frame state is the core's.
- **No WebGL:** the 2.5D view says so and offers the flat view.
- **Light budget:** 8 real point lights; halos are free.
- **Big towns:** buildings are rebuilt only when their shape changes (G6's key); props and walls are instanced; the person bake is cached by look.

## Tests

- The camera: every turn's keys map W/A/S/D to four different grid steps and W is up-right on screen; turning four times comes back.
- Massing: a 4×4 house makes a box inset in its rectangle with a door on its front face and a window pane where the template has one; a door on the left wall is drawn on the left face; a roofless template stands as billboards; the doorway nudge puts an actor on the door tile outside the box; a building between the camera and the player hides them.
- The bake: tints multiply only the layer's own pixels and layers stack in order.
- The view preference: `?view=flat` beats the saved setting, which beats the default.
- The adapter: `three` is only imported under `adapter/web/iso/`, Phaser only under `adapter/web/world/`, and neither in `core/`.

## Done when

- The game opens in 2.5D by default: a lit isometric diorama, buildings with walls and roofs from the templates, people and trees standing in it with shadows, the camera turning with Q/E and zooming with the wheel.
- Walking, clicking, talking, fighting, bubbles, names, the prompt and the fight clock work as in the flat view, which is one click away.
- Night shows lit windows, lamps and fires; weather and seasons show; atmosphere toggles.
- `npm test` and `npm run typecheck` pass.

## Part B: height, upper floors, models and new art

Asked for on 2026-11-03, the same day: "Terrain height and multi-storey interiors; 3D models; new art. I want this
too to be built." Part A's out-of-scope list, taken up. Height and upper floors are **facts** (G5's rule), so the
server sends them and every adapter draws the same land and the same floors; models and art are the adapter's.

### Decisions

14. **Height is in the patch.** `PatchSchema` gains `height`: one small integer a tile, in eighths of a tile
    (0–40), row by row, made by the server's view layer from the seed and the tile (`view/height.ts`): open land
    rolls gently; hills rise a tile or more; water lies low with sloping banks down to it; fords and marsh sit just
    above the water; roads and paths are smoothed into the land round them. In a place, the land rolls less, and a
    building's rectangle and a tile round it are levelled to one pad (so doors meet the ground). Interiors are flat.
    No rule reads height: walking, sight and travel are as before. A patch without `height` is flat (old recordings).
15. **The 2.5D ground follows it.** Each tile corner stands at the average of the four tiles round it, so the land
    is a smooth surface without steps; a steep quad shows the new **bank** art (earth) instead of grass. People,
    sprites, models, lights, marks and the words above them stand on the surface (`heightAt`, bilinear). A building
    stands on its pad on a stone plinth that reaches down into the slope. Clicks hit the ground mesh, not a plane.
    The flat view ignores height.
16. **Upper floors.** The shared interior generator gives inns, halls, manors, palaces, castles, guildhalls and
    merchants' and craftsmen's houses an **upper floor**: the same footprint, its own rooms (bedrooms, a solar,
    a store), furnished by the same rules, with **stairs** on the same tile of both floors. The ground floor's layout
    is unchanged. Furniture and rooms carry their `floor`; `interiorWalkable` and `spotFor` take the floor, so people
    asleep are upstairs in their beds. The player's `inside` has a `floor`; stepping onto the stairs changes floor
    ("You go up the stairs."). Searching, taking and who's there are per floor. The frame's map id names the floor,
    so a view starts the new floor over. The stairs are a new map object, `buildings/stairs`.
17. **Low-poly models** in the 2.5D view, by art id (`iso/models.ts`): rocks, barrels, chests, tables, benches,
    beds, shelves, counters, anvils, altars, hearths, milestones, signposts, shrines, the stairs, bridges' plank
    decks and a camp's fire. Built in code from boxes, cylinders and cones, coloured from the art palette, instanced
    per id. People, beasts and trees stay sprites (HD-2D). An id without a model is a sprite, as before.
18. **New art** (art/sprites, `npm run art`): side walls for each wall material (`buildings/<material>_side`,
    plain with its framing), gable ends (`buildings/<material>_gable`), earth banks (`terrain/bank_0`, `_1`) and the
    stairs (`buildings/stairs`). Massing uses the side and gable art when it exists, else the front's plain piece.

### Steps

10. Height: `view/height.ts`, the patch field, `npm run schema`, `Mirror.heightAt`; the ground, actors, sprites,
    buildings, lights and overlay standing on it; clicks on the mesh.
11. Art: the new sprites, ids in `art.ts`, the web manifests, `npm run art`.
12. Upper floors: shared generator, `inside.ts` (floor, stairs, per-floor search and people), the server's
    inside view and frame, the flat view's stairs, tests in n32 and g7.
13. Models: `iso/models.ts`, used by the ground's objects, buildings' standing props and the bridge.

### Tests (Part B)

- Height: same seed and tile, same height; water lies below the land round it; a building's pad is level; heights
  stay in range; the frame's patches carry them and validate.
- Upper floors: an inn has two floors with stairs on the same walkable tile of both; a hovel has one; the ground floor
  is the same as before; beds upstairs are where `spotFor` puts sleepers; walking onto the stairs changes floor;
  searching only reaches furniture on your floor.
- Models: every model id is an art id, and builds a geometry with vertex colours.
- Art: the new ids are in `art.ts`, both manifests and the sheets (the G6 test).

## Out of scope

- A Unity or Unreal adapter.
- Height as a rule (climbing costs, sight over hills, falling).
- Cellars, and upper floors seen from outside through windows.

## Built (2026-11-03)

Built in one session, parts A and B, uncommitted. What is where:

- **The switch:** [`worldView.ts`](../../../packages/client/src/adapter/web/worldView.ts) (`WorldView`, which both
  worlds implement) and [`viewPref.ts`](../../../packages/client/src/adapter/web/viewPref.ts); `main.ts` imports the
  chosen world dynamically, so each view is its own bundle; the header's `#view-btn` switches and reloads.
- **The 2.5D view:** [`adapter/web/iso/`](../../../packages/client/src/adapter/web/iso/): `IsoWorld.ts` (the scene,
  camera, input, frame handling), `camera.ts` and `massing.ts` and `bake.ts` (pure, tested), `atlas.ts`, `ground.ts`,
  `terrain.ts`, `billboards.ts`, `models.ts`, `buildings.ts`, `actors.ts`, `lights.ts`, `atmosphere.ts`, `marks.ts`,
  `overlay.ts`. `three@0.187.0` is pinned.
- **Height:** the server's [`view/height.ts`](../../../packages/server/src/view/height.ts); `PatchSchema.height`;
  `Mirror.heightAt`. In a place the rolls are small (a tile and a quarter at most) and buildings sit on pads; on the
  road hills reach about three and a half tiles.
- **Upper floors:** [`shared/src/interior/generate.ts`](../../../packages/shared/src/interior/generate.ts)
  (`floors`, `upper`, `stairs`, `floorTiles`, `furnitureOn`, `ITILE.stairs`); `InsideState.floor` and the stairs in
  [`inside.ts`](../../../packages/server/src/game/interior/inside.ts); `InsideView.floor`/`floors`; each floor is its
  own map (`in:<site>:<building>:1`). The flat view draws the stairs too (`buildings/stairs` is an object id).
- **Tests:** `g7.test.ts` (camera, massing, bake, view choice, renderer separation, height, upper floors, models, art)
  and the stairs walk in `n32.test.ts`.

Deviations from the plan:

- The camera comes in closer inside a building (zoom 1.9) and goes back out at the door; not planned, but rooms were
  small at the street's zoom.
- Off a place's map is a dark plane at ground level; the land doesn't fall away at the edge.
- `PCFShadowMap` (Three.js 0.187 has dropped the soft variant).
- Furniture models face the room's front; they don't turn to the wall they stand by.
