"""Re-import every clothes_*.fbx into a fresh scene and check bones, meshes, blend shapes, vertex groups, armature modifier.

    /Applications/Blender.app/Contents/MacOS/Blender -b -P art3d/characters/clothes/verify_clothes_export.py
"""
import bpy, os, sys, json, glob
HERE = os.path.dirname(os.path.abspath(__file__))
M = json.load(open(os.path.join(HERE, "export", "clothes_manifest.json")))
expect = {p["object"]: p for p in M["pieces"]}
base_bones = None
allgood = True
for f in sorted(glob.glob(os.path.join(HERE, "export", "clothes_*.fbx"))):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.fbx(filepath=f, automatic_bone_orientation=False)
    arms = [o for o in bpy.data.objects if o.type == 'ARMATURE']
    meshes = [o for o in bpy.data.objects if o.type == 'MESH']
    bones = sorted(b.name for a in arms for b in a.data.bones)
    if base_bones is None:
        # compare with the base body FBX bones
        bpy.ops.wm.read_factory_settings(use_empty=True)
        bpy.ops.import_scene.fbx(filepath=os.path.join(os.path.dirname(HERE), "export", "base_body.fbx"), automatic_bone_orientation=False)
        base_bones = sorted(b.name for a in bpy.data.objects if a.type == 'ARMATURE' for b in a.data.bones)
        bpy.ops.wm.read_factory_settings(use_empty=True)
        bpy.ops.import_scene.fbx(filepath=f, automatic_bone_orientation=False)
        arms = [o for o in bpy.data.objects if o.type == 'ARMATURE']
        meshes = [o for o in bpy.data.objects if o.type == 'MESH']
    probs = []
    if bones != base_bones:
        probs.append("bones differ from base_body.fbx")
    nk = 0
    for m in meshes:
        e = expect.get(m.name) or expect.get(m.name.split(".")[0])
        if not e:
            probs.append("unexpected mesh " + m.name)
            continue
        k = len(m.data.shape_keys.key_blocks) - 1 if m.data.shape_keys else 0
        nk += k
        if k != e["shapeKeys"]:
            probs.append(f"{m.name}: {k} shape keys, expected {e['shapeKeys']}")
        if not any(md.type == 'ARMATURE' for md in m.modifiers):
            probs.append(m.name + ": no armature modifier")
        if len(m.vertex_groups) == 0:
            probs.append(m.name + ": no vertex groups")
        if len(m.data.vertices) != e["verts"]:
            probs.append(f"{m.name}: verts {len(m.data.vertices)} vs {e['verts']}")
    want = sum(1 for p in M["pieces"] if p["file"] == os.path.basename(f))
    if len(meshes) != want:
        probs.append(f"meshes {len(meshes)} vs manifest {want}")
    print(f"{os.path.basename(f):26s} armatures {len(arms)} bones {len(bones)} meshes {len(meshes)} shapekeys total {nk}  ->", "OK" if not probs else probs)
    allgood &= not probs
print("ALL OK" if allgood else "PROBLEMS")
