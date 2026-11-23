# G8 art direction: one look for the Unity client

Every character, building, prop and shader in `unity/GardenOfEden` follows this page. If two things look like they came
from different games, one of them is wrong.

## The look

Soft stylised 3D, like a modern animated film or a stylised fantasy game: realistic anatomy gently exaggerated, smooth
simple forms, soft matte shading. The user's reference (2026-11-04, a stylised Blender fantasy mage by another artist) is
the target for *qualities* only; never copy its character. An earlier 2D cel reference is superseded.

- **Light.** Soft, smooth gradients (wrap lighting, wide soft terminator), not hard cel bands. Warm key light, a gentle
  cool cyan/blue rim and bounce, soft contact shadows. Shadows are tinted (warm purple-brown or cool blue), never black.
  Skin has a soft warm falloff (fake subsurface: reddish terminator) and a blush on cheeks, nose and knuckles.
- **Line.** No ink outlines by default; silhouettes read through rim light and value contrast. Outlines stay as an
  off-by-default option.
- **Colour.** Muted, earthy base colours (olive, navy, oxblood, leather browns, slate) with one or two warm accents
  (gold trim, red hair, glowing bits). Matte materials, low specular; metals soft and warm.
- **Shape.** Big simple forms, smooth surfaces, a few crisp details (stitching, straps, trim). Silhouettes first.

## People

- **Proportions.** About 8 heads tall (adult human 8.0–8.2, as measured on the reference on 2026-11-16; plan G9; to be
  confirmed by the user at G9's first gate). Small head, long legs, slim waist, gently stylised realistic anatomy; slender
  hands with long fingers. Small chin and clean jaw; necks slender.
- **Faces.** Large almond-shaped eyes (decal or textured eye parts, so they can blink and look), small nose, wide lips of
  moderate fullness (user 2026-11-16: wider, not bigger), small ears,
  defined brows. Hair as large simple chunks with a few strands/braids. Ears, noses, hair, beards, brows, eyes, mouths are
  swappable parts.
- **Body is modular on one rig.** One Humanoid armature. The body is split at hidden seams into Head (neck seam),
  Torso, Arms, Hands (wrist), Legs, Feet (ankle) with identical seam vertices, normals and weights, so clothes can replace
  regions. Chest, breast, belly, waist, hips and butt are blend shapes on Torso/Legs, not separate meshes.
- **Variety comes from parameters, not from different packs.** Blend shapes for sex, height/legs, shoulders,
  chest/breast, waist, belly, hips/butt, limb thickness, muscle, thin/heavy, age; face blend shapes for face length, jaw,
  cheeks, eye shape (round, almond, narrow, hooded, monolid, tilted up/down, deep-set) with size and spacing, chin (small,
  big, wide, narrow, forward, receding, cleft, pointed, long), and lips/mouth (upper and lower fullness, thin, wide,
  narrow, cupid's bow, corners up/down, pout). About 30 options each for hair, beards, brows, eyes, mouths, noses and ears,
  mixed by a stable hash of the person's id plus their age, sex, class and culture.
- **Clothes.** Layered practical outfits per class and culture (quilted vests, tunics, dresses, robes, aprons, leather
  straps and belts, cloaks, boots, armour pieces), fitted to the body blend shapes. Colours from `look.tint`/`look.trim`.
- **Rig.** Unity Humanoid naming so shared animation sets retarget to everyone (CC0 clips now; Kimodo later).

## Matching the reference

The user wants characters "aligned as closely as possible" to the reference image (style, proportions, render quality),
while staying our own varied people. Every face/body iteration renders a matching 3/4 pose and a face close-up next to the
reference, scores the differences (head-to-body ratio, leg length, shoulder/waist/hip ratios, neck, hands, eye size and
spacing, nose, lips, jaw, skin shading, hair) in `art3d/characters/previews/compare/report.md`, and closes the biggest
gaps first.

User decisions at Gate 1 (2026-11-16): women keep more width (waist about 1 head, hips about 1.5 heads; slim, never
skeletal); women shorter than men (about 1.65 m vs 1.78 m); eyes must match the reference's (almond, upturned, heavy upper
lid over the iris, dark lash/liner mass, little white showing, set in the socket, not bulging); a longer, slim nose bridge;
small ears kept; nothing uncanny.
User decisions at the MakeHuman checkpoint (2026-11-17): eyes were "frog eyes": the opening is now 0.20-0.21 (women) / 0.19-0.20
(men) of head width, one eye width apart, seated in the socket, the upper lid over the top of the iris, a solid thin
lash-and-liner shape with a small flick (no strand lashes); cheeks one soft volume (no facets or hollows); a flat brow
ridge with thin brows lying on the skin.

## Buildings and the world

Same soft light and palette as the people, no ink outlines by default. Chunky readable forms, slightly exaggerated
(steeper roofs, thicker eaves, bulging chimneys), matte surfaces with soft gradients. Each culture gets its own architecture, all
drawn in this one style.

## Where things live

- Blender sources and scripts: `art3d/` (characters in `art3d/characters/`), run headless with
  `/Applications/Blender.app/Contents/MacOS/Blender -b -P <script>`. Exports are FBX into
  `unity/GardenOfEden/Assets/Game/Art/`.
- Bought or downloaded packs that don't fit this page are placeholders only.
