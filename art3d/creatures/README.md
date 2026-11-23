# Garden of Eden creatures (Blender 4.3, FBX for Unity)

3D bodies for every non-human species in `packages/server/src/world/species.ts` and `data/peoples/peoples.json`.
Look: `roadmap/game/plans/g8-art-direction.md` (soft stylised 3D, matte, warm key plus cool rim, muted earthy palette, big simple forms).
FBX conventions as in `art3d/characters`: Y-up, 1 unit = 1 m, creature faces +Z in Unity (-Y in Blender), scale baked (no object scale),
smooth normals stored (Unity: Normals = Import), no leaf bones. Materials are plain matte base-colour materials (or, for humanoids,
one textured atlas); the soft look in `previews/` is a preview shader (see `lib.soft_material`), Unity needs its own wrap-light shader.

## Rebuild
```
B=/Applications/Blender.app/Contents/MacOS/Blender
$B -b -P art3d/creatures/animals.py [-- wolf dog ...]      # pack animals + derived animals + dragon
$B -b -P art3d/creatures/birds.py                           # crow, heron (generated)
$B -b -P art3d/creatures/monsters.py [-- goblin ...]        # humanoid peoples + harpy
$B -b -P art3d/creatures/centaur.py
$B -b -P art3d/creatures/verify_export.py                   # re-imports every FBX: size, tris, bones, clips
$B -b -P art3d/creatures/previews.py -- lineup out.png w=2600 h=640 pose=walk human wolf ...   (also: sheet N, faces N)
```
Files: `lib.py` (helpers, family palette, soft preview shader), `animals.py`, `birds.py`, `monsters.py` + `monster_species.py`
(species table: proportions, baked shape mix, parts, atlas), `centaur.py`, `wings.py` (feathers, membrane wings, clip posing),
`previews.py`, `verify_export.py`. Set `KEEP_BLEND=1` to also save `blend/<name>.blend`. `source/` = downloaded CC0 inputs
(see `CREDITS.md`). Exports in `export/` (about 97 MB: baked clips make the animal FBXs about 4 MB each); `export/*_meta.json` has tris/bones/clips.

## Humanoid peoples (Unity Humanoid rig, CC0 humanoid clips retarget)
Built from the shared base body (snapshot in `source/human_base/`): the same 55 Humanoid bone names, hidden-seam parts
(`<name>_Head/Torso/Arms/Hands/Legs/Feet`), eyes as separate parts, painted face decal. Per species: rest-pose bone scaling for proportions,
a baked mix of the base shapes (Heavy, Belly, Muscle, Species_Orc, ... with the matching skeleton joint offsets from `joint_offsets.json`),
species parts as separate meshes, a 1024 atlas (`export/textures/<name>_atlas.png`: skin + pattern bottom-right, face decal top-left,
eyeballs top-right, flat swatches bottom-left that the generated parts are UV-mapped to).
Blend shapes kept on the body meshes (same names as `art3d/characters`, 0..1, additive): `Belly, Heavy, Thin, Muscle, Chest_Muscle,
Arms_Thick, Legs_Thick, Waist_Wide, Age_Old, Shoulders` (size/bulk/belly/age) plus face `Jaw_Wide, Brow_Ridge, Face_Long, Cheeks_Full, Eye_Big`.
`Age_Old` and `Shoulders` move joints (offsets in `source/human_base/joint_offsets.json`, apply at the final scale divided by the
"scale_applied" value in `monsters_meta.json`). Parts carry no shape keys. No animation clips except generated `Tail_Sway` / `Wings_Flap`
(additive-style layers on the extra bones). Tris about 13.5-14.4k each (the shared base body alone is about 13k: over the 12k target, see weak spots).

| File | Height | Parts (separate meshes) | Extra bones | Notes |
|---|---|---|---|---|
| goblin.fbx | 1.05 m | big pointed ears (elf ear scaled), orc nose, eyes | none | green, thin, long arms, big head |
| hobgoblin.fbx | 1.85 m | pointed ears, orc nose | none | orange-brown, muscular, strong jaw/brow |
| kobold.fbx | 0.95 m | Snout, SnoutNose, Horn L/R, Ear L/R, Tail | Tail1-4 | rust red, slit eyes |
| gnoll.fbx | 2.0 m | Snout, SnoutNose, Ear L/R, Mane (spike row), Tail | Tail1-3 | tan with dark spots, hunched |
| lizardfolk.fbx | 1.85 m | Snout, Nostrils, Crest, Spines, Tail | Tail1-5 | olive scales, slit eyes |
| minotaur.fbx | 2.45 m | Muzzle, NosePad, NoseRing, Horn L/R, Ear L/R, Tail | Tail1-3 | brown, very muscular |
| ogre.fbx | 2.6 m | ears, orc nose, tusks A | none | heavy, belly, small head, big hands |
| troll.fbx | 2.9 m | ears, orc nose, tusks A, Knobs | none | long arms, hunched, mossy patches |
| giant.fbx | 4.6 m | ears, nose, Beard | none | muscular, brow ridge |
| harpy.fbx | 1.6 m (wingspan about 2 m) | Wings (feathers + spars), Toes/Shanks (talons), thigh feathers, tail feathers, head crest | Wing_Upper/Fore/Hand L/R | Sex shape baked, thin bird shins; `Wings_Flap` clip |

## Centaur (Generic rig, centaur.fbx, about 2.3 m tall, 1.5 m at the withers, 11.8k tris)
Quaternius horse body (neck and head removed) plus the base body's torso/arms/hands/head (no legs) scaled 1.2x, joined into one armature
(99 bones: horse AnimalArmature + human bones from `Spine` up, `Spine` parented to the horse `Torso3`). Parts: Horse, Torso, Arms, Hands, Head, Ears,
Eyes, Nose, HairCap, Mane. Horse clips: Idle, Idle_2, Walk, Run, Attack, Attack_Kick, Death, HitReact_L/R, Eat. The human half does not retarget (generic rig); layer arm/head
animation with an avatar mask on the human bones. No blend shapes.

## Animals (Generic rig, pack clips kept)
Clips (all frame-baked, Y-up): Idle, Idle_2, Walk, Run (pack "Gallop"), Attack, Death, HitReact_L/R, Eat, Eat_Low (Kick for horse/deer/goat/centaur). Rig = Quaternius `AnimalArmature`
(Body, Back, Torso..Torso3, Neck1-3, Head, Ear1-4 L/R, Front/Back Shoulder/UpperLeg/LowerLeg, foot helper bones FF/FFB/IK*, Tail1-8); pole targets removed.
No blend shapes (apply colour/size variation with Unity scale and material tint).

| File | Source | Withers / size | Tris | Bones | Extra |
|---|---|---|---|---|---|
| wolf.fbx | Quaternius Wolf (CC0) | 0.80 m | 1,962 | 47 | |
| dog.fbx | Quaternius ShibaInu (CC0) | 0.52 m | 1,950 | 42 | |
| fox.fbx | Quaternius Fox (CC0) | 0.36 m | 1,848 | 47 | |
| horse.fbx | Quaternius Horse (CC0) | 1.50 m | 2,182 | 46 | Attack_Kick |
| deer.fbx | Quaternius Deer (CC0) | 0.98 m | 2,098 | 42 | Attack_Kick |
| bear.fbx | derived from Wolf: wider head/body/legs, short tail, round ears, brown | 1.05 m | 1,962 | 47 | generated by re-proportioning |
| boar.fbx | derived from Wolf: short heavy legs, big snout, small ears | 0.80 m | 2,318 | 47 | parts: Tusk L/R, Snout, Mane (bristle ridge) |
| goat.fbx | derived from Deer: shorter legs, thicker body | 0.70 m | 2,278 | 42 | parts: Horn L/R, Beard |
| hare.fbx | derived from Fox: long ears (Ear bones x2.1), long hind legs, short tail | 0.26 m | 1,848 | 47 | |
| dragon.fbx | derived from Wolf: long head/neck/tail, heavy limbs, plus generated horns, spines, tail blade, membrane wings | 2.8 m withers, span 9.6 m | 3,196 | 57 | wing bones WingA/WingB/Finger1-3 L/R; clip `Wings_Flap` |
| spider.fbx | Quaternius Spider (Easy Enemy, CC0) | span 1.6 m | 2,712 | 37 | clips Idle, Walk, Attack, Death, Jump |
| adder.fbx | Quaternius Snake (Easy Enemy, CC0) | 0.75 m long | 1,618 | 14 | clips Idle, Slither, Attack, Strike |
| crow.fbx | generated (`birds.py`) | 0.47 m long, span 0.7 m | 1,430 | 18 | clips Idle, Walk, Peck, Fly |
| heron.fbx | generated (`birds.py`) | 0.98 m tall | 1,510 | 20 | clips Idle, Walk, Peck, Fly |

Generated bird rig: Root, Body, Neck1-n, Head, Tail, Wing1-3 L/R, Thigh/Shin/Foot L/R; wings folded at rest, `Fly` spreads and flaps them.

## Free sources vs generated
Free sources (CC0, Quaternius): wolf, dog, fox, horse, deer, spider, adder as-is (recoloured/scaled); bear, boar, goat, hare, dragon and the horse half of the centaur are
re-proportioned from them. Humanoid peoples, the human half of harpy/centaur: the CC0 Blender Studio base body (via `art3d/characters`), shaped and extended by script.
Fully generated: crow, heron, all parts (horns, tusks, snouts, ears, tails, spines, wings, feathers, beard, manes), all textures and the extra clips.

## Previews (`previews/`)
`lineup_monsters.png` (all peoples, centaur, dragon and a human at real scale), `lineup_animals.png` (all animals plus human, walk frame),
`closeups_monster_faces.png` / `closeups_monster_faces2.png` (heads), `closeups_animals.png` (normalised sheet).

## Weak spots
- Humanoids are 13.5-14.4k tris (the base body is 13k; target was 3-12k). To cut: decimate hands/feet LODs or drop eye/ear parts.
- Pack animals are about 2k tris, faceted low poly: smoothed normals soften it but silhouettes are still blocky; bear and boar both look like heavy wolves
  (tusks/snout on the boar are small), the hare reads as a long-eared fox, goat as a short deer.
- Derived animals keep the donor's walk/run cycles (no bear/boar-specific gait); boar and bear legs are not shortened/lengthened for foot-slide correction.
- Dragon is a thickened wolf (paws, not claws), wings are single-layer membranes skinned by distance (some stretching in the Flap clip); no fly body animation, only the wing clip.
- Centaur: torso/chest join is a plain overlap (no blend), human half has no animation of its own, hair is a cap + tube. No blend shapes.
- Humanoid monsters are nude (clothes come from the human clothing pipeline, not fitted to these proportions); snouted species keep the human jaw bone (no snout jaw animation),
  legs are plantigrade (no digitigrade for gnoll/kobold/lizardfolk), parts carry no face shape keys, ears/nose are the human parts scaled.
- Birds and the harpy wings are simple lofted/leaf geometry; bird clips are procedural and basic. The preview shader is not the Unity shader; textures are flat-colour atlases with soft patterns only.
- `source/human_base/` is a snapshot of the characters pipeline taken 2026-11-06; re-copy `art3d/characters/export/*` to refresh when that pipeline changes.
