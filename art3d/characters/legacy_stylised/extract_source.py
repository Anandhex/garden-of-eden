"""One-off: extract the stylised male/female full bodies and their eyeballs from the Blender Studio Human Base Meshes
bundle (CC0) into source/human_base_stylized.blend.  Usage:
  Blender -b -P extract_source.py -- /path/to/human_base_meshes_bundle.blend
"""
import bpy, sys, os
src = sys.argv[sys.argv.index('--') + 1]
out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "source", "human_base_stylized.blend")
bpy.ops.wm.open_mainfile(filepath=src)
keep = {"GEO-body_male_stylized", "GEO-body_female_stylized", "GEO-body_male_stylized.eye.L", "GEO-body_male_stylized.eye.R",
        "GEO-body_female_stylized.eye.L", "GEO-body_female_stylized.eye.R"}
for o in list(bpy.data.objects):
    if o.name not in keep:
        bpy.data.objects.remove(o, do_unlink=True)
for c in list(bpy.data.collections):
    bpy.data.collections.remove(c)
sc = bpy.context.scene
for o in bpy.data.objects:
    sc.collection.objects.link(o)
for blk in (bpy.data.meshes, bpy.data.materials, bpy.data.images, bpy.data.cameras, bpy.data.lights, bpy.data.armatures, bpy.data.curves):
    for d in list(blk):
        if d.users == 0:
            blk.remove(d)
bpy.ops.wm.save_as_mainfile(filepath=out, compress=True)
print("saved", out, os.path.getsize(out))
