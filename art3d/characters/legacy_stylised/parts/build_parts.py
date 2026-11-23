"""Build every part on top of base.blend and save parts.blend + FBX files + manifest.
    Blender -b art3d/characters/base.blend -P art3d/characters/parts/build_parts.py -- [only=noses_ears,mouth,hair,beards] [--no-export]
"""
import sys, os, json, time, importlib
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import bpy
from lib import *

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
only = None
for a in argv:
    if a.startswith("only="):
        only = a[5:].split(",")
want = lambda k: not only or k in only
R = {}
t0 = time.time()
if want("noses_ears"):
    import build_nose_ear
    R["nose_ear"] = build_nose_ear.build()
    print("noses/ears", round(time.time() - t0, 1))
if want("hair"):
    import build_hair
    R["hair"] = build_hair.build()
    print("hair", round(time.time() - t0, 1))
if want("beards"):
    import build_beards
    R["beards"] = build_beards.build()
    print("beards", round(time.time() - t0, 1))
if want("brows"):
    import build_brows
    R["brows"] = build_brows.build()
    print("brows", round(time.time() - t0, 1))
if want("hair") or want("beards"):
    import cards
    R["cards"] = cards.finish_all()
    print("cards", round(time.time() - t0, 1))
if want("mouth"):
    import build_mouth
    R["mouth"] = build_mouth.build()
    print("mouth", round(time.time() - t0, 1))
bpy.ops.wm.save_as_mainfile(filepath=PARTS_BLEND)
if "--no-export" not in argv and not only:
    import build_manifest
    man = build_manifest.make(R)
    print("manifest", man["counts"])
    arm = bpy.data.objects["Armature"]
    def objs(prefixes):
        return [arm] + [o for o in bpy.data.objects if o.type == 'MESH' and o.name.startswith(prefixes)]
    for fn, pre in (("parts_noses.fbx", ("Nose_",)), ("parts_ears.fbx", ("Ear_",)), ("parts_hair.fbx", ("Hair_",)),
                    ("parts_beards.fbx", ("Beard_",)), ("parts_mouth.fbx", ("MouthIn_", "Teeth_", "Tongue_")),
                    ("parts_brows.fbx", ("Brow_",))):
        o = objs(pre)
        export_fbx(os.path.join(EXPORT, fn), o)
        print("exported", fn, len(o) - 1, "meshes", os.path.getsize(os.path.join(EXPORT, fn)) // 1024, "KB")
print("saved", PARTS_BLEND)
