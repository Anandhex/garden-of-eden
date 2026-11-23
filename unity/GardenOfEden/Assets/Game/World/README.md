# World (GardenOfEden.World)

The 3D world view. It draws what the server's frames say, using only code-built meshes (no art needed yet). It reads a
`GameClient`'s `Mirror` and never changes game state.

## Setup

1. Put a `WorldView` (Add Component > Garden of Eden > World View) on an empty GameObject. It finds the `GameClient`,
   `DayNight` and `GrassField` in the scene if you leave them empty.
2. Materials: shared vertex-coloured material from the shader `GardenOfEden/ToonLit` (white base colour; the colour is
   in the vertex colours, which ToonLit multiplies in). Water uses `GardenOfEden/ToonWater`. If ToonLit is missing it
   falls back to URP/Lit (works, but vertex colours do not show, so everything is white) and logs a warning.
3. Optional: create a `PropManifest` (Assets > Create > Garden of Eden > Prop Manifest) and assign it.

## The contract (what other code can rely on)

| Member | Meaning |
|---|---|
| `WorldView.TileSize` = 1.5 | metres per tile |
| `WorldView.HeightScale` = 1.2 | metres per tile of height (server: eighths of a tile, 0..40) |
| `static TileToWorld(x, y, height)` | x to X, y to Z, `height` (tiles of height, as `Mirror.HeightAt`) times HeightScale to Y. Gives the tile's **middle**, so the server's integer tile maps to where someone stands |
| `static WorldToTile(Vector3)` / `WorldToTileIndex` | the inverse (continuous / floored) |
| `GroundHeightAt(worldX, worldZ)` | height of the drawn ground in metres (over the same triangles as the mesh, so exact; continuous). Unloaded land returns the last height known |
| `TryGetActor(id, out Transform)` | the actor's root transform (feet position, `ActorHandle` on it) |
| `PlayerActorId`, `event PlayerChanged` | who the player is (below) |
| `PlayerInside`, `PlayerFloor`, `SetPlayerFloor(int)` | interior state |
| `Buildings`, `ActorRoot`, `FocusPoint` | for helpers |

**Player id**: the frame's `player.id` when an actor with that id exists, otherwise the first actor with kind `"player"`,
otherwise `"player"`. Re-evaluated after every frame and actor add/remove; `PlayerChanged` fires on change.

Raycast picking: actors carry an `ActorHandle` (id, data) and a capsule collider; buildings a `BuildingHandle` and box
collider; terrain patches a mesh collider (turn off with `generateColliders` / `buildingColliders`).

## The pieces

| File | What |
|---|---|
| `WorldView.cs` | wiring, units, per-frame loop (patch queue, buildings sync, interior state, grass, lights) |
| `TileGrid.cs` | patches indexed by tile; smooth corner heights; `GroundY` |
| `PatchBuilder.cs` | per patch: ground mesh (smooth heights, colours blended between tiles), water mesh (flat plane, `ToonWater`), one combined props mesh (1 draw call), grass points to `GrassField`; neighbours rebuild when a patch arrives |
| `PropLibrary.cs` | procedural props per art id (trees, rocks, reeds, furniture, walls, doors, stairs, crops, bush, fence, well...) with 4 variants each; unknown ids fall back by family |
| `BuildingBuilder.cs` | massing by kind/template/id hash; walls with window and door cut-ins, roof with overhang and tile bands, chimney, inn sign; stalls, tents, camps, carts, heaps, loot |
| `ActorModels.cs`, `ActorViews.cs` | people and creatures (wolf, bear, boar, horse, spider, beast, grave), route tweening at about `stepMs` per tile, facing, limb swing, lie down when dead/unconscious, name labels, fade-out on removal, target ring |
| `Characters/` | every person and creature, from the Blender character system (`art3d/`). `PersonCatalog` parses the manifests (parts, clothes, species presets, joint offsets, base meta); `PersonRecipe` picks everything deterministically from (id, species, sex, age, class/job, culture, tint, trim), each category on its own hashed stream; `PersonBuilder` bakes the picks into ONE skinned mesh (skin / cloth+solid hair / optional alpha hair-card submeshes; blend shapes and joint offsets applied on the CPU, bindposes recomputed; live expression shapes kept) plus a 512 per-person atlas (skin, blush, decals, irises); `PersonFactory` queues and caches builds under a per-frame budget (`ActorViews.BuildBudgetMs`, nearest first); `PersonFace` blinks, opens the jaw and drives visemes while `Speaking` says the person talks (speech, chatter, gossip); `ArmRelax` lowers the KayKit clips' wide arms. Creatures: prefabs from `CharacterKit.creatures` (humanoid monsters on the shared Humanoid controller with `CreatureLayers` tail/wing sway; animals Generic with their own clips). Shaders `GardenOfEden/Character` and `GardenOfEden/Hair` (Look/Shaders, shared `CharacterLighting.hlsl`). Re-run the import with Garden of Eden > Build Character System (`CharacterImport.Build`): it re-copies `art3d/` exports, re-imports and rebuilds the kit. The old `CharacterManifest`/`CharacterPuppet` placeholder bodies are only the fallback |
| `LightPool.cs` | 16 pooled URP point lights for the nearest lamps/windows/fires/forges; fires flicker |
| `MeshKit.cs`, `Style.cs` | MeshBuilder primitives, hashing, palette, shared materials |
| `PropManifest.cs` | art id to prefab overrides |

Ambience: `Mirror.AmbienceChanged` is forwarded to `DayNight.ApplyAmbience(light, timeOfDay, weather, season, snow)`.

## Replacing procedural meshes with real models

Create a `PropManifest` asset and add entries (`artId` + `prefab`). Keys:

- Object ids from `ArtIds.OBJECT_IDS`, e.g. `props/tree`, `props/rock`, `buildings/wall`, `props/bed`. Prefab origin is the
  tile's foot centre; one metre = one metre; a tile is 1.5 m. `scale`, `offset`, `randomYaw` apply per instance.
  Prefab props are instantiated one by one under the patch (procedural ones are merged into one mesh), so keep
  counts sensible for trees.
- Actor art ids (`people/body`, `people/player`, `creature/wolf`, `fx/grave`...): the prefab replaces the procedural body
  (no limb swing; give it an Animator of your own). Origin at the feet, facing +Z.
- Whole buildings: `building/<kind>` (`building/inn`, `building/house`, `building/smithy`, `building/hall`...). Set
  `fitFootprint` to stretch it to the building's footprint. Procedural interiors/roof are then not built.

An entry with a null prefab keeps the procedural one. To change a procedural shape, edit its method in `PropLibrary`
(props), `BuildingBuilder` (buildings) or `ActorModels` (actors).

## Notes and limits

- World coordinates are tile coordinates times 1.5 m with no floating origin; roads far from 0 stay precise to
  millimetres for tens of kilometres.
- Props are baked per patch, so instancing support in the shader is not needed. Colour variation is vertex colour.
- Terrain colours are static per terrain id (no season tint); snow cover is a shader effect (`_SnowAmount`, below).
- `frame.signs` and `frame.marks` (burned/ruin/grave/banner...) are not drawn yet. Chimney smoke is not drawn
  (`BuildingView.chimney` has the point).
- The frame carries no floor number, so `PlayerFloor` stays 0 until something calls `SetPlayerFloor`; indoors the roof
  and all upper storeys hide.

## Relief, ground, grass, horizon, labels (terrain pass)

- **Relief**: the server sends `relief` per patch (`view/height.ts` reliefAt: valleys and hills of tens of metres in the open,
  a gentle roll inside a place with a hill rim, banks that ease down to water, building pads blended into the land).
  `TileGrid.Corner` smooths it with a 4x4 kernel, eases streets and roads toward the wider lie of the land, caches corners, and
  clamps beyond the loaded land. `GroundHeightAt` still reads exactly the drawn triangles.
- **Ground** (`GroundLook.cs`): colour is a function of the world position (noise-varied greens, dry patches, wildflower
  dabs, sage on the heights, dirt then rock on steep faces); `PatchBuilder` builds shared vertices on a half-tile lattice
  and a skirt on the loaded land's open edges.
- **Grass** (`Look/GrassField.cs`, `ToonGrass.shader`): clumps of ~7 soft rounded blades, ~0.2-0.4 m, `grassClumpsPerTile`
  (12) per grass tile, coloured from `GroundLook` (k-means into 8 colour groups, one `_GroundTint` per draw), thinned by
  distance, wind waves from `Wind` (`_WindOffset`).
- **Horizon** (`HorizonRing.cs`): a client-only lattice of far land (seeded by `Mirror.map.id`) from the loaded land's edge
  out to 1.5 km; fog = the sky's horizon colour. Camera far clip is raised to 3200.
- **Props that belong to a building** (door, stairs, bar, thatch) are drawn apart per building (`PatchView.attached`) and handed
  to `BuildingView.attached` by `BuildingBuilder.AttachProps`, so `Occlusion` fades them with the building.
- **Labels**: `ActorViews.ChooseLabels` shows at most 5, nearest first (the interaction target always), never the player's,
  none overlapping on screen, none behind a building, faded with distance.

## World look pass (G8, 2026-11-22)

- **Foliage** (`PropLibrary.Tree/Bush/Rock`): soft-shaded shapes from `MeshBuilder.SoftBlob` (smooth icosphere, lumpy, normals
  bent round a shared canopy centre so the lobes shade as one mass, dark olive underneath to warm green on top) and `SoftTube`
  (tapered smooth trunks, branches, fir cones). Variants: round oak, broad elm, tall poplar, layered fir; trees ~4-6 m.
  `PropLibrary.lowDetail` (the horizon ring) uses one subdivision less. Foliage ids (`PropLibrary.IsFoliage`) go into a
  separate per-patch mesh drawn with `Mats.Foliage()`: ToonLit with `_SWAY` (UV0.x = sway weight, Wind.cs globals; shadow and
  depth passes sway too), back-light translucency, half-strength SSAO, and a dither fade near the camera and in a soft tube
  between the camera and the player (`_GoeFocus`, set by `WorldView` each frame).
- **Ground** (`Mats.Ground()`): ToonLit `_GROUND_DETAIL`: world-space value noise at four scales (meadow-wide drifts toward
  straw-olive and deep green, soft blotches, fine grain near the camera), pebbly specks and dust streaks on earth. No textures.
- **Snow**: `DayNight` publishes `_SnowAmount`; ToonLit whitens up-facing surfaces (ground, roofs, canopy tops) with a noisy
  edge, ToonGrass pales the blades. **Rain/snow particles**: `WeatherParticles` makes two camera-riding systems at play start
  when `DayNight` has none (material `Look/Materials/Weather.mat`).
- **Light**: SSAO renderer feature (bootstrap `EnsureSsao`, downsampled, low samples) read by ToonLit
  (`_SCREEN_SPACE_OCCLUSION`); deeper tinted shadow colour (`Mats.SoftLook`); cool rim scaled by sky light so it does not glow
  at night; brighter blue moon and night ambient; post grade: white balance +6, lavender shadows / warm highlights, saturation +2.
- **Buildings**: roofs steeper (x1.22 gable, x1.3 hip, 0.75-1.75), eaves +0.16 m and about twice as thick (`BuildingRoof.Thick`);
  the two-storey threshold is really ~3x3 tiles now (2x3 cottages stay one storey, no towers).
- **Doors**: a door or stairs whose house has not streamed in is not drawn (no door frames alone in a field); the patch rebuilds
  when buildings change.
- **Labels**: about constant size on screen (`scale = dist/10`, larger glyphs).
- Editor tools: Garden of Eden > Apply World Look (URP + SSAO + post profile), > Update Main Scene Look (weather material,
  night light, camera start zoom 0.2 into the saved scene).
