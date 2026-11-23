# Credits and licences (art3d/characters)

## Used

### MakeHuman base (2026-11-17): MPFB 2 + MakeHuman system assets (art3d/characters/mh/)
- **MPFB 2.0.18** (Blender extension, maintainer Joel Palmius, MakeHuman community). Code licence GPL-3.0-or-later
  (`blender_manifest.toml`): used as a tool only, never shipped. Its bundled data (hm08 base mesh `data/3dobjs/base.obj`,
  all targets `data/targets/**`, rigs and weights `data/rigs/standard/*.json`, mesh metadata) is the MakeHuman data released
  as **CC0** (weights files: `"license": "CC0"`; base mesh and targets: MakeHuman's CC0 release of September 2020).
  URL: https://extensions.blender.org/add-ons/mpfb/ ->
  https://extensions.blender.org/download/sha256:c075b3e9b94b8e5556a5f03f4653602d02ea306de08126e8f55ed6dee28a2dad/add-on-mpfb-v2.0.18.zip
  (also https://github.com/makehumancommunity/mpfb2 release v2.0.18, 2026-10-11). Size 45,956,992 bytes, sha256 c075b3e9...2dad.
  Installed into the project-local `tools/blender_user/` (see `mh/README.md`), not the user's Blender config.
- **MakeHuman system assets** (`makehuman_system_assets_cc0.zip`): https://files.makehumancommunity.org/asset_packs/makehuman_system_assets/makehuman_system_assets_cc0.zip
  Size 280,737,770 bytes, sha256 b542127a8e25547c7c29c19f2d1d2adb9a664c80396ecd694095dbc8028a0107. Licence **CC0**: all 94 entries
  of the pack's `packs/makehuman_system_assets.json` say `"license": "CC0"`, and every file header says "This asset was explicitly
  released as CC0 in september 2020" (copyright holders then: Data Collection AB, Joel Palmius, Jonas Hauquier). Used: eyes
  (high-poly + eye materials), eyebrows (eyebrow008, eyebrow012), eyelashes (01-03), teeth_base, tongue01, hair proxies (bob01,
  bob02, short01-04, long01, ponytail01, braid01, afro01) for previews; clothes and skins not used. Copied (69 MB) into the
  local MPFB user data folder.
- Downloaded 2026-11-17 without login into a fresh scratch folder. Modified by us: target weights, our stylise fields and
  warp (written back as MakeHuman targets `mh/targets/stylise_{f,m}.target`), split/decimation, renamed rig, iris-enlarged
  eye textures and denser lash alpha (`mh/textures/`, derived from the CC0 textures).

### G9 rebase (2026-11-16): same bundle, realistic objects
From the same Human Base Meshes bundle v1.4.1 (CC0, Blender Studio; URL and licence below), re-downloaded 2026-11-16 without
login (50,643,039 bytes zip). `extract_source.py` writes `source/human_base_realistic.blend` (30.6 MB) with only:
`GEO-body_male_realistic`, `GEO-body_female_realistic` (Multires level 3 and sculpt face sets kept) and their `.eye.L/.R`,
`GEO-head_animation_realistic` with `.iris.L/R` and `.sclera.L/R`, `Head - Generic Topology` (shape keys used as stylisation
directions), `Head - Planar` (plane simplification target), `Jaw - Realistic` (teeth and gums), `Eye - Realistic`.
Excluded by the user's pick: the stylised bodies and `Head - Stylized`. Modified by us: proportioned, stylised by script
(landmark fields and donor-delta transfer), decimated per part, rigged, shape-keyed (see README.md).

### Human Base Meshes bundle v1.4.1 (Blender Studio and community artists)
- What: stylised full-body male and female base meshes (12,500 quads each, identical topology, face sets per body region),
  and the stylised eyeball meshes. Everything in `source/human_base_stylized.blend` comes from there (stylised
  `GEO-body_male_stylized`, `GEO-body_female_stylized` and their `.eye.L/.R`); the rest of the bundle is not used.
- URL: https://www.blender.org/download/demo/asset-bundles/human-base-meshes/human-base-meshes-bundle-v1.4.1.zip
  (redirects to https://mirror.blender.org/demo/asset-bundles/human-base-meshes/human-base-meshes-bundle-v1.4.1.zip);
  listed at https://www.blender.org/download/demo-files/#assets
- Licence: CC0 / public domain. The bundle's own README (kept in `source/BUNDLE_README.txt`) says: "All provided assets are
  public domain under the CC0 license." (`source/BUNDLE_License.txt` is boilerplate about the Rain Rig, which is not used.)
- Size: 50,643,039 bytes (48.3 MiB) zip, one `.blend` plus thumbnails; we keep only the 1.3 MB extract in `source/`.
- Downloaded 2026-11-04 without login. Modified by us: posed/proportioned for the 7-7.5 head target, decimated per body
  region, re-topologised seams, blend shapes, rig, UVs (see README.md).

### ambientCG fabric, leather and metal maps (CC0) - used by the clothes (`clothes/`)
- What: five 1K colour maps, converted to grayscale detail textures (`clothes/export/textures/detail_*.png`, multiplied by the tint
  colour in the garment materials): Fabric030 (plain weave, `detail_weave`, also base of the stripe and plaid maps), Fabric048
  (quilting, `detail_quilt`), Fabric026 (cord, `detail_cord`, spare), Leather011 (`detail_leather`), Metal032 (`detail_metal`).
  Kept in `clothes/source/ambientcg/` (4.9 MB total); the conversion is `clothes/prep_textures.py`.
- Author: ambientCG (Lennart Demes), https://ambientcg.com/a/Fabric030 (and /Fabric048, /Fabric026, /Leather011, /Metal032)
- Licence: CC0 1.0 (text in `clothes/source/AMBIENTCG_LICENSE.txt`). Size: 11.1 + 6.6 + 8.0 + 5.6 + 3.7 MB zips, only the colour jpgs kept.
- Downloaded 2026-11-08 without login. Modified by us: grayscale, contrast-normalised, resized to 512, banded for stripes/plaid.

## Clothes (art3d/characters/clothes): generated, not reused
All 70 garment meshes are generated by script from the base body surface (offset shells, lofts, grids; see `clothes/clothes_lib.py`,
`pieces.py`), skinned and shape-keyed by transfer from the body. The trim stitch map is generated (`prep_textures.py`).
Free-resource search log for clothes (2026-11-06 to 2026-11-08):
- KayKit Character Pack Adventures 1.0 (CC0, GitHub KayKit-Game-Assets): contains weapons, shields, props and whole characters
  only, no separable clothing, and its chunky low-poly flat style does not match; not used.
- MakeHuman / MPFB clothes packs (CC0 mhclo assets): not reachable as plain files from GitHub without the asset manager (the
  asset repositories queried returned nothing); the proxies would also need refitting from the MakeHuman base mesh. Not used.
- Quaternius and Sketchfab CC0/CC-BY: not searched in depth (no standalone clothing matching this rig and look was found among the packs checked); not used.

## Generated by script in this repo
Rig, weights, 59 blend shapes (except `Sex`, which is the difference between the bundle's male and female meshes), joint
offsets, face-decal UV layout and preview shaders/face texture. No other third-party assets are included.

## Considered, not downloaded (for the next steps)
- MakeHuman / MPFB asset packs (CC0): eyebrows, eyelashes, teeth/tongue, hair and clothes proxies. https://www.makehumancommunity.org/
- Poly Haven and ambientCG (CC0) skin/cloth/leather textures.
- Quaternius / KayKit (CC0) rigged references.

## Free-resource search log (2026-11-06)
Searched for CC0/CC-BY fantasy-race base meshes and parts (elf ears, orc tusks, dwarf/halfling bodies) without login. Found only: paid
packs (CGTrader, Cubebrush), free Gumroad elf ears with unclear licence and checkout, Sloyd CC-BY whole characters on other rigs,
and generic human CC0 bases. None fit our rig/topology, so elf ears, nose variants and orc tusks are generated from our own parts.

## Head parts (art3d/characters/parts, 2026-11-08)
All meshes, decals and iris textures in `parts/` are generated by the scripts in that folder (numpy + bmesh) on top of our own base head;
no third-party file was copied. Free-resource search done first (nothing downloaded):
- MakeHuman asset packs (https://static.makehumancommunity.org/assets/assetpacks.html): Hair 01 (CC0, low-poly stylised), Eyebrows 01 (CC0, by
  Mindfront), Eyelashes 01 (CC0), Bodyparts 05 (CC0, beards and moustaches), MakeHuman system assets (CC0: teeth, eyes, proxies); Hair 02/03,
  Bodyparts 06 and system eye materials 03 are CC-BY. Not used: the proxies are fitted to MakeHuman's own base mesh and UVs (different topology
  from ours), brows/lashes are textured cards for that mesh, and hair/beards would each need re-fitting and restyling to our big-chunk look.
  Download sizes are not listed on the index page. Candidate for a later fitting pass (credit would be author, URL above, CC0/CC-BY per pack).
- Poly Haven / ambientCG (CC0) textures: nothing needed (matte flat shading with per-chunk vertex colour).
