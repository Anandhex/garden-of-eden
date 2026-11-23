# Swappable head parts (Garden of Eden, Blender 4.3)

About 30 options each for eyes, eyebrows, mouths, noses, ears, hair and beards/facial hair, all fitted to the one base head
(`../README.md`). Look: `roadmap/game/plans/g8-art-direction.md` (soft stylised 3D, big simple hair chunks, matte).
Nothing here modifies the base pipeline; parts are built on `base.blend` and saved as `parts/parts.blend`.

## Rebuild
```
B=/Applications/Blender.app/Contents/MacOS/Blender
$B -b art3d/characters/parts/../base.blend -P art3d/characters/parts/build_decals.py         # 117 PNGs  -> export/textures/ (3 s)
$B -b art3d/characters/base.blend -P art3d/characters/parts/build_parts.py                    # meshes, parts.blend, 5 FBX, manifest (30 s)
$B -b art3d/characters/parts/parts.blend -P art3d/characters/parts/render_parts.py -- only=brows,eyes,lids,mouths,stubble,noses,ears,hair,beards,mouthparts,people
python3 art3d/characters/parts/label_sheets.py                                                # index labels on the sheets (Pillow)
$B -b -P art3d/characters/parts/verify_parts.py                                               # re-imports every FBX
```
`only=noses_ears,hair,beards,mouth` and `--no-export` work on `build_parts.py`; `PEOPLE_SEED=n` changes the random people sheet.

## Files
`decals.py` (numpy painters: brows, lids/lashes, lips, inner mouth, stubble, iris), `specs.py` (tables of all decal parts + colour
palettes), `build_decals.py`, `lib.py` (body data, nearest-vertex transfer of weights and shape keys, `variant()` for welded parts),
`build_nose_ear.py`, `gen.py` (hair geometry: scalp shell from the head's own polygons, sweeps, drapes that collide with the real
body mesh), `build_hair.py`, `build_beards.py`, `build_mouth.py`, `build_manifest.py`, `build_parts.py`, `preview.py` + `render_parts.py`
(preview stage), `label_sheets.py`, `verify_parts.py`.
Outputs: `export/parts_manifest.json`, `export/parts_{noses,ears,hair,beards,mouth}.fbx`, `export/textures/{brows,lids,eyes,mouths,mouths_inner,stubble}/*.png`,
`export/verify_report.json`, `previews/*.png`.

## What is in it
| Category | Count | How |
|---|---|---|
| Eyes | 30 looks | iris/pupil/highlight texture on the real `Part_Eye_L/R` (256 px, alpha = iris tint mask, 15 iris colours, patterns smooth/streaks/ring/sectors/flecks/swirl/fire/milky, pupils round/slit/horizontal/square/keyhole/small, highlights) plus one of 14 lid/lash decal styles (liner, soft/heavy lashes, wing, kohl, smoky, tired, elder crow's feet, child, orc rim, elf flick, crease). |
| Eyebrows | 30 | 512 px decals (thin, arched, straight, unibrow, bushy elder, sparse, scarred left/right, broken, orc, dwarf, elf swept...), hair-colour tinted |
| Mouths | 30 | lips decal (shape, cupid, smile/frown, smirk, elder lines, scars, tints) + 7 with an untinted painted open mouth (teeth, fangs, gap, tongue); teeth style per mouth |
| Mouth parts | 8 meshes | `MouthIn_01` cavity (inside-out), `Tongue_01`, `Teeth_01..06` (even, gap, fangs, broken, small, buck). Upper teeth on `Head`, lower teeth and tongue on `Jaw`, cavity split by height. Opening `Jaw` moves them (checked, `previews/mouth_parts_cutaway.png`). |
| Noses | 30 meshes | displaced copies of `Part_Nose`; boundary loop (30 verts) bit-identical; all 41 shape keys carried (incl. dwarf, orc, elf) |
| Ears | 30 pairs | displaced copies of `Part_Ear_L/R` (22-vert loop identical): sizes, lobes, protruding, elf short/long/leaf/swept, orc, notched, cauliflower, bat |
| Hair | 30 styles + 8 hat variants | scalp shell grown from the head polygons with chunky clumps, plus drapes (locks that fall over head, neck, shoulders), fringes, buns, tails, braids, curls, spikes, mohawk, dreads; skinned to Head (+Neck/UpperChest/Chest/Spine for long hair); up to 60 transferred shape keys |
| Beards | 24 meshes + 6 stubble decals | shell on the lower face (mouth left free) + moustache tubes, goatee tips, drapes and braids; skinned Head/Jaw/Neck |

All meshes carry the base head's shape keys by nearest-vertex transfer (4 nearest, inverse-square distance), only keys that move the part
by more than 0.3 mm; vertex weights are transferred the same way (hair and beards use a bone subset, normalised). A vertex colour
layer `Shade` carries per-chunk shading (multiply with the hair colour). The face decals ride the head UVs (u 0..0.5, v 0.5..1), so they
follow every face shape and all 12 eye-shape keys.

## Colour slots and texture conventions
In `parts_manifest.json` (`textureConventions`, `palettes`): hair colour (14 named colours) for hair, beards, brows, stubble; iris
colour (15) for eyes; lip tint (9) for lips; skin for noses/ears. Decal PNGs hold display (sRGB) values. Layer order: skin, blush,
stubble, brow, lids, lips, inner mouth.

## Unity
Each FBX holds the base Armature (same 55 bones, verified) plus its meshes, same export settings as `base_body.fbx` (forward -Z, up Y,
no leaf bones, custom normals). Import with Rig = Humanoid (copy the base avatar), Normals = Import, Blend Shape Normals = None,
Read/Write on. Point each `SkinnedMeshRenderer`'s bones at the character's bones by name and copy blend-shape weights by name. Sockets are
documented for the manifest; because every part is modelled at its rest position and skinned, no socket transform is needed. Decal
layers are composited by the shader onto the face rect; the manifest gives every file.

## Weak spots
- No free asset was reused (see `../CREDITS.md`): MakeHuman/MPFB packs are fitted to MakeHuman's own mesh, our head has a different topology.
- The base head's lips are a closed sculpted surface: the jaw can move the teeth/tongue/cavity, but nothing is visible through the closed lip
  seam. Painted open-mouth decals cover grins and laughs; a real talking mouth needs a lip slit cut into `Mesh_Head` (base pipeline).
- Hairline and beard edges follow head polygons (smoothed along the edge): slightly stepped at some angles, soft but visible on `undercut`,
  `top_knot`, `tonsure`. Long hair is stiff stacks of locks (no strand cards, no physics bones yet; `physicsFriendly` flags the long styles).
- Hair over a body needs the body's neutral shape: strands collide with the neutral body mesh, not with extreme `Heavy`/`Muscle` stacks.
- Noses/ears are displaced copies, so extreme settings (orc flat, ear notches) are faceted at the head's resolution; notches are dents, not cuts.
- Eyebrows are decals only (no 3D cards); `square_bold` is intentionally blocky. Shape keys are copies of nearest-vertex deltas, not retopologised.
- Hat variants drop the top volume (buns, quiff, spikes, curls), hats with ear holes are needed for elf/orc ears.
