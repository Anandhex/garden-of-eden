[← Game track](../README.md#g6-the-look) · [G5: a switchable client](g5-a-switchable-client.md)

# G6 plan: The look (pixel art now, 2.5D HD later)

Asked for 2026-10-23, after G5: "it's more of 2.5D HD, but I am okay with the first approach now." The first approach is crisp pixel-art top-down 2D in Phaser. The goal is 2.5D HD (Octopath-style: flat upright sprites in a lit scene with depth blur). **G6 builds the first look in a way that makes the second one a renderer swap, not a rebuild.** It comes after G5; then the [48-day year migration](../../living-world/plans/migration-2026-10-23-one-year-ageless-player.md) part A; then back to features (N40).

**In one line:** replace the shapes drawn in code with **real art at twice the display size**, kept on **separate layers** (ground, buildings, props, characters), with the world in **world units** and **light sources sent by the server**; add **Phaser's Light2D** for night, windows, lamps and fires, then **depth and atmosphere** (y-sorting, foreground parallax, blur); then hold a **checkpoint**: stay on Phaser, or prototype the 2.5D HD look in Three.js or Unity against G5's recordings.

**Read first:** [G5](g5-a-switchable-client.md) (the frame, actors' `look`, `ambience`, recordings). G6 changes **only the adapter, the art and a few frame fields**. It changes no rules, so it needs no save bump and no change to the living-world plans.

## What exists

- Every texture is drawn in code at start-up ([`world/textures.ts`](../../../packages/client/src/world/textures.ts), `makeTextures`, `TILE = 32`): no image files. Characters are coloured shapes with an `ORIGINS` tint.
- Layers by depth number, not by kind: actors at `10 + y/TILE`, the hover at 5, night at 500, weather at 600, labels at 700 ([`WorldScene.ts`](../../../packages/client/src/world/WorldScene.ts), [`CrowdLayer.ts`](../../../packages/client/src/world/CrowdLayer.ts)). Night is one dark rectangle over everything.
- The open road is a pool of tile sprites keyed by ground id and object ([`RoadLayer.ts`](../../../packages/client/src/world/RoadLayer.ts), `OBJECTS`).
- Positions are tiles already (world units), and G5 sends them that way.
- **The maps are generated, not authored.** Towns, localities and the road all come from the seed (see [Generated world, no authored NPCs](../../living-world/plans/n25a-a-world-without-a-centre.md)). So Tiled can't be used to draw whole maps. It is used for **tilesets, autotile rules and building or prop templates** that the generator places.

## Decisions made in this plan

1. **Art at 2×.** Source art is 64 px per tile and is shown at 32 px for the pixel-art look (nearest-neighbour, `pixelArt: true`). It stays sharp now and holds up under light and a closer camera later. A sprite sheet per family: `terrain`, `buildings`, `props`, `people`, `creatures`, `fx`.
2. **Art is looked up by id.** The frame's `actor.look.sprite` and patch tile ids name art (`people/farmer_f`, `creature/wolf`), never Phaser keys. `client/src/adapter/web/art/manifest.json` maps ids to sheets and frames, with fallbacks (`people/*` → the code-drawn figure). A Unity or Three.js adapter keeps its own manifest for the same ids. The id list lives in `shared/src/view/art.ts` so the server and every adapter agree.
3. **Four layers, named in the protocol.** `ground` (terrain, roads, water), `buildings` (walls and roofs: roofs fade when the player is behind or inside), `props` (trees, fences, carts, lamps: y-sorted with characters), `actors`. Patches say their layer (G5's `layer` field). Depth blur, parallax and lighting all need this split.
4. **Light comes from the server as facts.** The frame gains `lights: Array<{ id, x, y, kind: "window" | "lamp" | "fire" | "torch" | "forge" | "magic", on: boolean }>`. Whether a window is lit is a fact of the simulation (someone is home and awake), so the server says it; how it glows is the adapter's choice. `ambience.light` (0..1 daylight) drives the ambient level.
5. **Tiled for pieces, not maps.** `art/tiled/` holds Tiled tilesets with Wang (autotile) sets for grass, path, water and walls, and Tiled maps of **templates**: a house, a smithy, an inn, a farm plot, a market stall. The server's town generator places templates by kind; the template file says which tiles go on which layer. Templates are read by a server script into `shared/src/view/templates.json` so every adapter gets the same layout.
6. **Light2D now, not a 3D engine.** Phaser 3's Light2D pipeline lights sprites and tiles (with normal maps where we have them). It gives windows, lamp pools and fires at night without leaving Phaser. Normal maps are optional per sprite; flat lighting is the fallback.
7. **Phaser stays the web renderer unless the checkpoint says otherwise.** The checkpoint (step 7) is a decision, made by playing, not assumed now.

## Steps

### Step 1: art ids and the manifest

`shared/src/view/art.ts` (every id the frame can send, by family) and the frame builder sends them (`look.sprite`, patch ids). The web adapter's manifest maps every id to today's code-drawn textures first, so nothing changes on screen. A test: every id the frame builder can produce is in `art.ts`, and every id in `art.ts` is in the web manifest.

### Step 2: the art pipeline

`art/` at the repo root: source files, `art/tiled/` (tilesets and templates), and `npm run art` packing sheets into `client/public/art/` (texture atlases, JSON frames). Load them in the adapter's preload; keep the code-drawn textures as the fallback per id. Write `art/README.md`: the 64 px grid, the palette, naming, how to add a sprite.

### Step 3: the first art pass

Terrain (grass, path, water, wall, tree, door, the road's ground ids), the common buildings, and people as a base body plus tinted clothes by `look.tint` (so thousands of townsfolk don't need thousands of sprites), creatures for the species that exist. Four-direction walk cycles (2–4 frames) for people, using `facing` from the frame.

### Step 4: layers and roofs

Split the scene into the four layers (step 3's decision): ground under everything; props and actors y-sorted together; roofs over actors and faded when the player is under them. Labels and bubbles stay on top. The night rectangle goes in step 5.

### Step 5: Light2D

Turn on the Light2D pipeline for ground, buildings, props and actors. Ambient colour and level from `ambience` (dawn warm, noon white, dusk orange, night blue). A light per `lights` entry in view, flicker for fire and torch, pooled to a budget (Phaser's light limit; nearest first). Weather dims ambient. Delete the night rectangle. The frame builder sends `lights` (windows from building occupancy after dark, lamps and fires from templates).

### Step 6: depth and atmosphere

Foreground props (tree canopies, the near edge of a roof) on a parallax layer that drifts a little against the camera; a soft blur on the far and near layers (Phaser's FX pipeline, behind a setting); light shafts or fog by weather and season; fireflies and dust as `fx`. Keep 60 fps on the test laptop (N19's `?fps=1` overlay), with a setting to turn atmosphere off.

### Step 7: checkpoint, then the 2.5D HD prototype

Play it and decide. If Phaser is enough, stop here. If not, build a **prototype adapter** against G5's recordings (no brain needed): **Three.js** with an orthographic camera tilted about 30°, ground as textured planes, buildings as simple boxes with the same art, characters as upright billboards, real shadows and depth of field; or **Unity** 2D with URP 2D lights and post-processing, reading the same JSON. Both use the same art ids and templates, and each has its own manifest. Write down the result in this file and in the game track: which renderer, and why.

## Edge cases and traps

- **Thousands of townsfolk, few sprites.** Tint layered sprites (body, clothes, hair) instead of drawing every person; batch by atlas.
- **Light budget.** Phaser limits the lights per pipeline. Send only lights in the box; the adapter lights the nearest and lets far windows use an emissive frame without a real light.
- **Generated towns look samey.** Templates with variants (2–4 per building kind) and a deterministic pick by building id, so a town looks the same every visit.
- **Pixel shimmer when the camera moves.** Round the camera to whole screen pixels; tween in screen pixels.
- **Art that the adapter doesn't have yet** shows the fallback, never an empty space or an error.
- **No rules in the adapter**, still: whether a roof fades depends on where the player is (drawing), but whether a door is locked is the server's.

## Tests

- `art.ts` covers every id the frame builder makes; the web manifest covers every id in `art.ts` (step 1).
- Templates load and every template tile is in a tileset (step 2).
- A frame at night on a town map holds lit windows for occupied houses and none for empty ones (step 5).
- A replayed recording draws with no missing-art warnings in the console.
- The 60 fps check from N19 on a busy town at night with atmosphere on.

## Done when

- The game looks like real pixel art: the art from step 3, four-way walking, roofs that fade, and nothing drawn in code except as a fallback.
- At night, houses with people awake have lit windows, lamps and fires glow, and the ambient light follows the time of day and the weather.
- The checkpoint is decided and written down. If the decision was a prototype, it plays a recording in the 2.5D HD look.
- `npm test` and the 60 fps check pass.

## Out of scope

- Real 3D models, physics or navigation meshes.
- Animation beyond walk cycles and the existing event effects (lunge, flash, float).
- Sound (that is [N29](../../living-world/plans/n29-a-soundscape.md)).

## Built (2026-10-23)

Built in one session after G5, uncommitted. What is where:

- **Art pipeline:** [`art/`](../../../art/README.md). Sprites are pixel art written as text (`art/sprites/*.txt`, one
  character a pixel from [`palette.txt`](../../../art/palette.txt)), 16 px a tile. `npm run art`
  ([`art/pack.ts`](../../../art/pack.ts), PNG by [`art/png.ts`](../../../art/png.ts) with node's zlib, no new
  dependency) packs them ×4 (64 px a tile) into `packages/client/public/art/<sheet>.png` + Phaser JSON frames,
  writes the frame index the adapter imports, the Tiled tilesets (`art/tiled/*.tsj`, with Wang sets) and
  `packages/shared/src/view/templates.json` from the Tiled templates (`art/tiled/templates/*.tmj`).
- **The first art pass:** 252 frames. Terrain for every `TERRAIN_IDS` entry (variants for grass, path, road,
  water), 64 generated corner tiles where grass meets path, road, water and sand; every `OBJECT_IDS` prop; 59 building
  tiles (thatch, shingle and canvas roofs; plaster, stone and plank walls, windows, doors, forge, stalls, tents,
  campfire, cart, loot, spoil, town walls, gate, porch); one person body in four directions × three steps, split
  into body, clothes, hair and trim layers (tinted by `look.tint`, a hair pick, `look.trim`); wolf, bear, boar,
  spider, horse and a tintable stand-in beast (two trot frames each way); fx (grave, shadow, marker, rain, snow,
  lit-window frames, glow, fireflies, dust, fog, light shafts, near leaves).
- **Templates:** 13 (three houses, inn, smithy, hall for hall/palace/temple/guildhall/barracks/manor, market,
  farm, and tent, camp, cart, loot, heap for the localities' unkinded things, matched by name).
  [`templates.ts`](../../../packages/shared/src/view/templates.ts): `templateFor` (a stable pick by map and
  building) and `dress` (a 9-slice stretch to any size: roof, front wall, door, porch, props, lights, windows).
- **Frame fields:** a building's `template` and `door`; `lights` per window of its template plus the template's
  lamps, fires and forge, with `on` as facts ([`frame.ts`](../../../packages/server/src/view/frame.ts)
  `buildingLights`); `facing` for the two in a conversation. Ground under a building is `terrain/yard`.
  `npm run schema` rerun. No rules or saves changed.
- **The adapter** ([`adapter/web/world/`](../../../packages/client/src/adapter/web/world)): `depth.ts` (the layers),
  `ground.ts` (tile pool, the half-tile Wang grid, y-sorted props, town walls by their south neighbour, water
  shimmer), `buildings.ts` (templates; roofs fade while the player is under or behind), `actors.ts` (layered
  people with four-way walks, creatures, labels and bubbles on top), `lighting.ts` + `lightPlan.ts` (Light2D),
  `atmosphere.ts`, `look.ts` (the setting). [`art.ts`](../../../packages/client/src/adapter/web/art.ts) is the
  manifest: `SHEET_ART` (ids → frames) over `MANIFEST` (the code-drawn fallback, per id).
- **Tests:** [`g6.test.ts`](../../../packages/server/tests/g6.test.ts), 12 tests.

### Deviations from the plan

- **Sources are text, not 64 px paintings.** Decided before the build: 16 px art written as characters, scaled ×4
  to 64 px, shown at 32 px with nearest-neighbour. Same on-screen result as the plan's "art at 2×", and reviewable
  in a diff. A later HD pass can replace a sheet with real 64 px art under the same frame names.
- **The manifest is TypeScript** (`adapter/web/art.ts` over a generated `art/sheets.json`), not a hand-written
  `manifest.json`.
- **Tilesets are generated** by the packer (tile numbers kept stable from the old `.tsj`); the templates are Tiled
  maps, first written by a script, then edited in Tiled.
- **Templates dress buildings only.** Decided before the build: the town generator, the map tiles and solidity are
  unchanged (they feed the crowd sim and the tests). Variants: three for houses, one for each other kind (the plan
  said 2–4 per kind). [~]
- **No `layer` field on patches.** The adapter puts terrain on the ground layer and props on the sorted layer by
  family; buildings get their layers from their template.
- **Facing** is sent only while two are in a conversation; everyone else faces the way they walk (drawing).
  Creatures are drawn from the side (east, west); going north or south they keep their last side.
- **Light budget 24** real lights (Phaser `maxLights`), nearest the player; every light that's on also glows with
  an additive halo, and lit windows show their lit frame, so far lights still read. No normal maps (flat Light2D).
- **The night rectangle is gone.** Night is Light2D's ambient, so it needs WebGL; on Phaser's Canvas fallback the
  world stays at day brightness.
- **Blur** is a pre-FX blur on the near leaves only (behind the atmosphere setting); no blur on a far layer, since a
  top-down town has none.
- **The 60 fps check** could not be read off `?fps=1` here: the browser pane was hidden, so the browser paused the
  page's animation. Instead the Phaser loop was stepped by hand in the page: over 480 frames in Wilcross at night,
  atmosphere on, a frame took 1.1 ms median, 4.3 ms at the 95th percentile and 13.3 ms at worst (budget 16.7). On
  the way there, two fixes: buildings redraw only when their shape changes (not on every new tip), and the water
  shimmer swaps only water tiles. The real check on the test laptop, in a capital at night, is still to do. [~]
- **The recording** `protocol/recordings/town-and-road.jsonl` was recorded again with the new fields; it replays
  with no `[art]` warnings (checked in the browser and in the test).

## Checkpoint (step 7): decided, stay on Phaser

**Recommendation: stay on Phaser for now, and do not build the 2.5D prototype yet.** The step builds the prototype
only if playing shows Phaser isn't enough, and so far it holds up: lit windows, lamps, fires and the ambient
light read well at night, roofs fade, and the frame budget has plenty of room. What G6 set up makes the swap
cheap when it is wanted: the server sends art ids, templates, lights and facing as facts; the art has stable
frame names; recordings play with no server.

When the 2.5D HD look becomes the priority (after the 48-day migration and N40, or sooner if playing says so),
prototype it in **Three.js** first, not Unity: it stays in this repo's web stack, plays the G5 recordings as they
are, reuses `templates.ts` (`dress()` gives roof and wall boxes directly) and the sheets as billboard textures,
and needs no C# port. Unity (URP 2D lights) is the choice only if a native build is wanted anyway.

**Decided 2026-10-23 by the user: stay on Phaser for now.** No 2.5D prototype is built; when the HD look becomes the priority, the Three.js prototype above is the first step.
