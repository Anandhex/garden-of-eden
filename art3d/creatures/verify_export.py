"""Re-import every export/*.fbx and print size (m), tris, bones, blend shapes, clips and the displacement of the walk clip.
    Blender -b -P art3d/creatures/verify_export.py -- [names]"""
import bpy, sys, os, glob, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib
names = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [os.path.basename(p)[:-4] for p in sorted(glob.glob(lib.EXPORT + "/*.fbx"))]
rep = {}
for n in names:
    lib.reset()
    arm, meshes = lib.import_fbx(os.path.join(lib.EXPORT, n + ".fbx"))
    from mathutils import Vector
    mn = Vector((1e9,) * 3); mx = Vector((-1e9,) * 3)
    for m in meshes:
        for c in m.bound_box:
            w = m.matrix_world @ Vector(c)
            mn = Vector(map(min, mn, w)); mx = Vector(map(max, mx, w))
    d = mx - mn
    sk = sum(len(m.data.shape_keys.key_blocks) - 1 for m in meshes if m.data.shape_keys)
    tris = sum(lib.tri_count(m) for m in meshes)
    rep[n] = dict(size_m=[round(x, 2) for x in d], tris=tris, bones=len(arm.data.bones), blendshapes=sk,
                  meshes=[m.name for m in meshes], clips=sorted(a.name.split('|')[-1] for a in bpy.data.actions),
                  arm_scale=round(arm.scale[0], 3))
    print(n, rep[n])
json.dump(rep, open(os.path.join(lib.EXPORT, "verify.json") if len(names) > 3 else "/dev/null", "w"), indent=1)
