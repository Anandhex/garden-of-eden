# MakeHuman base (G9, 2026-11-17)

The character base rebuilt on **MakeHuman** (hm08 base mesh, targets, proxies, rig weights), driven headless through the
**MPFB 2** Blender extension. Replaces the scan-based base of `../build_base.py` (kept for reference, untouched). Licences and
versions: `../CREDITS.md`. Comparison rounds: `../previews/compare/report.md`, section "MakeHuman base".

Status: **user checkpoint**. Base, blend shapes, rig, split, sockets and JSONs are built and verified; the FBX export, the
30-variant part sets, clothes and the Unity import are NOT redone yet (the old `../export/base_body.fbx` is still the scan base).

## Install (project-local, nothing in the user's global Blender config)

```
# one time: MPFB 2.0.18 from extensions.blender.org into art3d/characters/tools/blender_user/
export BLENDER_USER_RESOURCES=$PWD/art3d/characters/tools/blender_user
B=/Applications/Blender.app/Contents/MacOS/Blender
$B -b --factory-startup --command extension install-file -r user_default -e add-on-mpfb-v2.0.18.zip
# the MakeHuman system assets (CC0): copy eyes/ eyebrows/ eyelashes/ teeth/ tongue/ hair/ proxymeshes/ packs/ from
# makehuman_system_assets_cc0.zip into
#   art3d/characters/tools/blender_user/extensions/.user/user_default/mpfb/data/
```
`BLENDER_USER_RESOURCES` points Blender's config, scripts and extensions at that folder (Blender 4.2+), so MPFB is enabled
there and nowhere else. `mh/mpfb_env.sh` sets it (and `$B`): `source art3d/characters/mh/mpfb_env.sh`.
`tools/blender_user/` (152 MB) and `mh/cache/` are git-ignored; re-create them with the steps above.
MPFB runs headless without problems: the scripts import its services (`bl_ext.user_default.mpfb.services.*`).

## Rebuild

```
source art3d/characters/mh/mpfb_env.sh
python3 -I art3d/characters/mh/make_textures.py art3d/characters/tools/blender_user/extensions/.user/user_default/mpfb/data
$B -b -P art3d/characters/mh/solve_body.py          # optional: re-solve the body-width weights in recipe.json
$B -b -P art3d/characters/mh/build_mh.py            # base_mh.blend + export/*.json + cache/keys.npz   (about 10 s)
$B -b art3d/characters/mh/base_mh.blend -P art3d/characters/mh/verify_mh.py
$B -b -P art3d/characters/mh/compare_mh.py -- round=<N> prev=<N-1> note="..."   # G9 protocol round (about 1 min)
$B -b -P art3d/characters/mh/check_ranges.py        # eye / mouth / ear ranges of the face keys -> export/key_ranges.json
$B -b -P art3d/characters/mh/sheets_mh.py -- round=<N>                            # checkpoint sheets (about 2 min)
```
Deterministic: no randomness; MakeHuman target deltas are cached in `cache/targets.npz` (pure function of the files).

## Files

| file | what |
|---|---|
| `mhcore.py` | MPFB access: basemesh + macros (`Base.macro`), target files (`Base.target`), `.mhclo` proxies (`Proxy.fit` = MPFB's fitting rule), rig JSON / weights, `.target` writer |
| `landmarks.py` | fixed hm08 vertex sets: parts from the dominant Mixamo/Unity weight, nose (nose-target region), ears/lips (MPFB groups), lid ring, chin, subnasale, lip points |
| `recipe.json` | the neutral F and M: macros, MakeHuman detail targets, our fields, warp targets, proxies, preview looks |
| `stylise_mh.py` | neutral = macros + targets + custom fields (eye scale, lids, mannequin smoothing, soften) + proportion warp (height, heads tall, crotch) |
| `targets/stylise_{f,m}.target` | the whole stylise delta of each neutral as a MakeHuman target (loads on a plain MPFB human with the recipe's macros) |
| `shapes_mh.py` | the 75 blend shapes as MakeHuman recipes (targets, macro changes, expression units, fields) |
| `build_mh.py` | keys, split, decimation, proxies, rig, weights, sockets, UVs, JSONs -> `base_mh.blend`, `export/` |
| `verify_mh.py` | bones, sockets, key names, seams (position, weights, every key, normals), triangle budget |
| `measure_mh.py` | the G9 metrics on hm08 (same names as `../measure.py`; eye opening by ray casting) |
| `compare_mh.py`, `look_round.py` | comparison round (G9 section 5) / quick looks; `person.py`, `look_mh.py`, `paint.py`, `decals.py` = preview person, materials, skin tint, eye-liner/crease decal |
| `make_textures.py`, `textures/` | eye textures with a 1.12x iris, denser lash cards (from the MakeHuman textures) |
| `face_cards.py` | the lash-and-liner ribbon and brow-card snapping |
| `solve_body.py` | least-squares body widths (MakeHuman measure targets) |
| `sheets_mh.py`, `sheet_img.py` | checkpoint sheets |

## Hand editing (editor kit)

`open_editor.sh` opens `editor.blend` (built by `make_editor.py`) in the Blender GUI with the project-local MPFB and the
"Garden of Eden" side panel (`editor_panel.py`): grouped plain-word sliders on the woman / man, Save as neutral (into
`recipe.json` under `<sex>.sliders`, backup in `backups/`), Save as preset (`presets/<name>.json`, used by
`person.generate`), Random person, Reset, Render preview (`previews/editor/`), Start / Save sculpt (stored as a `User_*`
shape, seams checked and repaired, exported to `sculpts/`, added by the next build), and a bridge to MPFB's own panel.
Beginner guide: `EDITING.md`. Headless test: `$B -b mh/editor.blend -P mh/editor_panel.py -P mh/test_editor.py`.

Other new tools: `stylise_local.py` (Stylise_F / Stylise_M fields), `bake_face.py` (face texture set), `proofs_mh.py`
(slider sweeps, expressions / visemes, generated people, blink check, male features crop), `lips_neck.py` (lips-and-neck
sheet with the throat angle), `anthro_draw.py` (measured-landmark overlay), `person.generate` / `person.mix`.

## What is MakeHuman and what is ours

| From MakeHuman / MPFB (CC0 data) | Ours (scripts here) |
|---|---|
| hm08 base mesh (eyelids, lips, inner mouth, ears, hands, feet), UV layout, vertex groups (lips, ears, nipples, joint helpers) | the recipe weights, the proportion warp, fields: eye scale/seat, lid slide over the iris, brow flatten, cheek and nasolabial soften (Taubin), mannequin smoothing; the lash-and-liner ribbon (`face_cards.py`, rooted on MakeHuman's lash helper line) |
| macros (gender, age, muscle, weight, proportions, cup size, firmness) | shape-key recipes with our names, `Sex` = F neutral - M neutral |
| ~150 detail targets used (eyes, nose, mouth, ears, chin, cheeks, forehead, head, neck, torso, hips, limbs) and the expression units (blink, smile, brows ...) | split into our parts, decimation with locked seams, key / weight / UV transfer |
| proxies: high-poly eyes, eyebrow001/008 (brows snapped flat onto the skin), teeth_base, tongue01, (eyelashes01-03 optional), hair (bob01/02, short01-04, long01, ponytail01, braid01, afro01) | iris-enlarged eye textures, denser lash alpha, preview materials, liner/crease decal, tint |
| Mixamo/Unity rig and its weights | bone renaming to our 55 Unity names, merged helper bones, 4 influences, sockets, joint offsets, species presets |

## Contract changes for the Unity agent (vs `../README.md`)

1. **Rig**: same 55 names (incl. `Jaw`, `LeftEye`, `RightEye`), `Hips` the only root; bones from MakeHuman's Mixamo/Unity rig
   (Mixamo `Spine/Spine1/Spine2` = our `Spine/Chest/UpperChest`). Rest pose = MakeHuman's A-pose, arms about 45 degrees down
   (was 35). Breast, buttock and eyelid helper bones of that rig are merged into `Chest`/`*UpperLeg`/`Head`.
2. **Parts**: `Mesh_Head/Torso/Arms/Hands/Legs/Feet`, `Part_Nose`, `Part_Ear_L/R` keep their names; the nose and ear seam loops
   are new (MakeHuman topology), so the old nose/ear variant parts (`Part_Ear_Elf_*`, `Part_Nose_Elf/Dwarf/Orc`) and
   `Part_Tusk_*` are **not built**: elf ears and species noses are now done by the `Species_*` keys on the same parts.
3. **Eyes / mouth**: `Part_Eye_L/R` = MakeHuman high-poly eyes with two material slots `Eye` + `Cornea` (no separate
   `Part_Cornea_*`); `Part_Lashes` = our solid lash-and-liner ribbon (opaque, dark `Lashes` material, no alpha; one mesh for
   both sexes, Head-weighted, follows the blink keys), **new** `Part_Brows` (MakeHuman card with alpha, snapped onto the skin),
   **new** `Teeth` and `Tongue` (names start with Teeth / Tongue as `PersonBuilder` expects). The liner itself is a face decal
   (FaceDecalUV). No lash style variants yet.
   Face texture set on FaceDecalUV: `export/textures/face_paint_{f,m}.png` (RGBA, over the skin: liner and wing, lid
   crease, soft painted brows) and `face_tint_{f,m}.png` (RGB, multiply: lip tint darker at the lip line and corners, blush).
   Base skin = the tone colour. **New (round 17): `face_mask_{f,m}.png`** (RGB, linear, FaceDecalUV): **R = lip gloss**
   (1 on the lips, strongest at the lower-lip centre and upper-lip tubercle; shader: roughness lerp 0.52 -> 0.28,
   specular up, a thin clear coat 0.3 x R), G = blush amount, B = reserved (0). Previews use the same values from the
   `FaceMask` vertex colour.
   **`Part_Lashes` (round 19): MakeHuman's eyelashes02 proxy** again (fitted by its .mhclo rule, weights from the
   basemesh), lengthened and curled by `face_cards.LashProxy` (short at the inner corner, longest at about 2/3, shorter at
   the outer corner, tips bent away from the eye; lower lashes 0.6x); material `Lashes` uses
   `export/textures/eyelashes02_clean.png` (MakeHuman's lash texture thresholded / sharpened, same UVs). Teeth are set back
   1.5 mm and down 0.8 mm (`face_cards.OffsetProxy`, recipe `look.teeth_offset`) so no teeth line shows between closed lips.
   Superseded (round 18): upper and lower strips of 3 rows (root, middle, tip) rooted on the lid margins (fixed hm08
   vertices that the blink moves, so they follow Blink and every face key), strands perpendicular to the lid edge and
   curling away from the eye; length short at both corners, longest at about 68 %; **no 3D wing** (the wing is only painted
   in face_paint). Material `Lashes` now needs the alpha texture `export/textures/lash_strands.png` (UV: u along the lid,
   v root 0 -> tip 1; alpha-tested or dithered, dark colour).
   **New `Part_TearDuct`** (round 18): two small pink lenses in the inner eye corners, material `TearDuct` (pink, roughness
   about 0.12, slightly translucent), Head-weighted, anchored on the inner-canthus vertices so it follows the blink and
   face keys. The eye textures darken and pink towards the corners (`mh/textures/eye_*.png`).
   **Brow textures**: `Brows` material texture per style: MakeHuman eyebrow001 or `brow_fine`, `brow_bushy`,
   `brow_groomed`, `brow_feathered` (`export/textures/`, all on the eyebrow001 card UVs). Lip colour and gloss come from
   the skin tone (`sheets_mh.tone_lip_gloss`: deeper rose on dark skin, gloss 0.45-1.0 x 0.75 for generated people).
4. **UVs**: `UVMap` (UV0) = MakeHuman's standard body UV on every body part (one atlas); `FaceDecalUV` (UV1) on `Mesh_Head`
   and `Part_Nose` = the old planar face rect (u 0..0.5, v 0.5..1, same formula, z0 = chin - 0.005 of the masculine neutral).
   Order is the same as before (UV0 skin set, UV1 decals), but the **head skin texture set must be re-baked** for the
   MakeHuman layout. Materials: `Skin`, `Skin_Head` (head, nose, ears, inner mouth), `Eye`, `Cornea`, `Lashes`, `Brows`,
   `Teeth`, `Tongue` (no `Mouth_Inner`).
5. **Blend shapes**: the 75 old names plus 12 new ones (87 in all; `shapes_mh.EXTRA_SHAPES`):
   - `Stylise_F`, `Stylise_M`: the soft animated-film look (local large-form fields, `stylise_local.py`). Neutral woman =
     `Sex` 1 + `Stylise_F` 1; neutral man = `Stylise_M` 1. Without them the face is MakeHuman-realistic.
   - measured-variation sliders `Var_LowerFace`, `Var_NoseLength` (= middle face), `Var_Forehead`, `Var_NoseWidth`,
     `Var_EarSize`, `Var_SkullWidth`, `Var_SkullDepth`, `Var_NeckWidth`.
   - correctives `Fix_EyeRound_Blink_L/R`: runtime weight = `Eye_Round` x `Eye_Blink_L/R` (so a fully opened lid still
     closes); the blink sheet checks every risky combination (`previews/compare/mh/blink_check.json`).
   - **Bipolar weights**: every key listed in `shapes_mh.VARIATION` / `BODY_SLIDERS` is used from -1 to +1 (1 = about 2 SD
     of real faces); Unity must not clamp blend-shape weights at 0. Several old keys were rescaled so that 1 = 2 SD
     (`shapes_mh._SCALE`): `Face_Long/Short`, `Jaw_*`, `Chin_Long/Forward/Back`, `Cheeks_Full`, `Cheekbones`, `Brow_Ridge`,
     `Eye_Big`, `Eye_Spacing`, `Eye_Tilt*`, `Lips_UpperFull/LowerFull/CupidBow`, `Nose_Bridge`, `Neck_Long`.
   - eyebrow keys on `Part_Brows` only: `Brow_Height`, `Brow_Thick`, `Brow_Length`, `Brow_Arch`, `Brow_ArchPos`,
     `Brow_Tilt`, `Brow_Gap` (bipolar, `face_cards.deform_brow`); brow density = alpha gain of the `Brows` material (0.6-1.6)
     and brow colour = hair colour x 0.8-1.15, both per person from `person.generate` (`_brow_density`, `_brow_colour`,
     `_brow_style` = one of the 8 `face_cards.BROW_STYLES` presets; all use the eyebrow001 texture).
   - `User_*` keys: hand sculpts saved in the editor (`mh/sculpts/`), optional, weight 0 by default.
   Normals: custom normals on every body part, seam vertices carry the welded normal.
6. **Budget**: 21,538 triangles in all (head 6,696, eyes 2 x 1,020, teeth 1,068, see `export/base_body_meta.json`).
7. **JSONs**: `export/joint_offsets.json` (same format; offsets from MakeHuman's joint helper cubes), `export/species_presets.json`
   (same format, root scales recomputed), `export/base_body_meta.json` (landmarks, sockets, parts, recipe; the old
   `faceLandmarkVerts` block is replaced by the hm08 landmark indices in `landmarks.py`).
