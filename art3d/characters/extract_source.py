"""One-off: extract the objects used by the G9 pipeline from the Blender Studio Human Base Meshes bundle v1.4.1 (CC0) into
source/human_base_realistic.blend.  Usage:
  Blender -b -P extract_source.py -- /path/to/human_base_meshes_bundle.blend

Kept: the realistic male and female bodies (Multires level 3 and .sculpt_face_set kept, not applied) and their eyes,
the realistic animation head with iris and sclera, 'Head - Generic Topology' (shape keys), 'Head - Planar' (Multires),
'Jaw - Realistic' (teeth and gums), 'Eye - Realistic'.  Names are matched with spaces stripped (the bundle has odd spacing).
The stylised bodies and 'Head - Stylized' are excluded (user's pick, roadmap/game/plans/g9-characters-face-body-plan.md 0.1).
"""
import bpy, sys, os
src = sys.argv[sys.argv.index('--') + 1]
out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "source", "human_base_realistic.blend")
WANT = ["GEO-body_male_realistic", "GEO-body_female_realistic", "GEO-body_male_realistic.eye.L", "GEO-body_male_realistic.eye.R",
        "GEO-body_female_realistic.eye.L", "GEO-body_female_realistic.eye.R", "GEO-head_animation_realistic",
        "GEO-head_animation_realistic.iris.L", "GEO-head_animation_realistic.iris.R", "GEO-head_animation_realistic.sclera.L",
        "GEO-head_animation_realistic.sclera.R", "Head - Generic Topology", "Head - Planar", "Jaw - Realistic", "Eye - Realistic"]
key = lambda n: n.replace(" ", "")
want = {key(n) for n in WANT}
bpy.ops.wm.open_mainfile(filepath=src)
for o in list(bpy.data.objects):
    if key(o.name) not in want or o.type != 'MESH':
        bpy.data.objects.remove(o, do_unlink=True)
for c in list(bpy.data.collections):
    bpy.data.collections.remove(c)
sc = bpy.context.scene
for o in bpy.data.objects:
    sc.collection.objects.link(o)
for _ in range(3):
    for blk in (bpy.data.meshes, bpy.data.materials, bpy.data.images, bpy.data.cameras, bpy.data.lights, bpy.data.armatures,
                bpy.data.curves, bpy.data.node_groups, bpy.data.actions, bpy.data.brushes):
        for d in list(blk):
            if d.users == 0:
                blk.remove(d)
names = sorted(o.name for o in bpy.data.objects)
assert len(names) == len(WANT), names
bpy.ops.wm.save_as_mainfile(filepath=out, compress=True)
print("saved", out, os.path.getsize(out), names)
