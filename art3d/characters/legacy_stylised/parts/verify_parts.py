"""Re-import every parts FBX into a fresh scene and check: bones (Humanoid names, 55), shape keys, vertex groups subset of bones,
nose/ear boundary loops identical to the default parts, parts' sizes.   Blender -b -P parts/verify_parts.py"""
import bpy, os, sys, json
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import common
EX = os.path.join(HERE, "export")
HUM = None


def load(path):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.fbx(filepath=path, automatic_bone_orientation=False)
    arms = [o for o in bpy.data.objects if o.type == 'ARMATURE']
    meshes = {o.name: o for o in bpy.data.objects if o.type == 'MESH'}
    return arms, meshes


def pts(o):
    n = len(o.data.vertices)
    a = np.empty(n * 3)
    o.data.vertices.foreach_get('co', a)
    return (np.array(o.matrix_world) @ np.c_[a.reshape(-1, 3), np.ones(n)].T).T[:, :3]


def boundary_idx(o):
    import bmesh
    bm = bmesh.new()
    bm.from_mesh(o.data)
    ids = sorted(v.index for v in bm.verts if any(e.is_boundary for e in v.link_edges))
    bm.free()
    return ids


arms, base = load(common.FBX_PATH)
bones = [b.name for b in arms[0].data.bones]
BASE_BONES = set(bones)
print("base bones", len(bones))
ref = {}
for nm in ("Part_Nose", "Part_Ear_L", "Part_Ear_R"):
    o = base[nm]
    P = pts(o)
    b = boundary_idx(o)
    ref[nm] = {tuple(np.round(P[i], 4)): i for i in b}
ref_keys = {nm: [k.name for k in base[nm].data.shape_keys.key_blocks] for nm in ("Part_Nose", "Part_Ear_L")}
report = {}
ok = True
for fn, pat, rname in (("parts_noses.fbx", "Nose_", "Part_Nose"), ("parts_ears.fbx", "Ear_", None), ("parts_hair.fbx", "Hair_", None),
                       ("parts_beards.fbx", "Beard_", None), ("parts_mouth.fbx", "", None), ("parts_brows.fbx", "Brow_", None)):
    arms, meshes = load(os.path.join(EX, fn))
    bn = [b.name for b in arms[0].data.bones]
    miss = sorted(BASE_BONES - set(bn))
    extra = sorted(set(bn) - BASE_BONES)
    r = dict(file=fn, size_kb=os.path.getsize(os.path.join(EX, fn)) // 1024, bones=len(bn), bonesMissing=miss, bonesExtra=extra, meshes=len(meshes))
    maxk, vgbad, nokeys, tris = 0, 0, 0, 0
    uv_ok, cards, expr_keys = 0, 0, 0
    bdiff = 0.0
    bnd_fail = 0
    for nm, o in meshes.items():
        sk = o.data.shape_keys
        k = len(sk.key_blocks) - 1 if sk else 0
        maxk = max(maxk, k)
        nokeys += (k == 0)
        vgbad += sum(1 for g in o.vertex_groups if g.name not in BASE_BONES)
        tris += sum(len(p.vertices) - 2 for p in o.data.polygons)
        assert any(m.type == 'ARMATURE' for m in o.modifiers), nm
        uv_ok += ("UVMap" in o.data.uv_layers)
        cards += any((ms.material and ms.material.name.startswith(("HairCards", "BeardCards"))) for ms in o.material_slots)
        expr_keys += bool(sk and any(kb.name in common.EXPR_SHAPES for kb in sk.key_blocks))
        if rname or nm.startswith("Ear_"):
            rn = rname or ("Part_Ear_L" if nm.endswith("_L") else "Part_Ear_R")
            P = pts(o)
            b = boundary_idx(o)
            got = {tuple(np.round(P[i], 4)) for i in b}
            if got != set(ref[rn].keys()):
                bnd_fail += 1
    r.update(maxShapeKeys=maxk, meshesWithoutKeys=nokeys, badVertexGroups=vgbad, tris=tris, boundaryLoopMismatches=bnd_fail,
             meshesWithUV=uv_ok, meshesWithStrandCards=cards, meshesWithExpressionKeys=expr_keys)
    if fn in ("parts_hair.fbx", "parts_beards.fbx"):
        ok &= (uv_ok == len(meshes) and cards == len(meshes))
    if fn == "parts_brows.fbx":
        ok &= (uv_ok == len(meshes) == 30 and expr_keys == 30)
    if rname or fn == "parts_ears.fbx":
        pass
    ok &= (not miss and not extra and vgbad == 0 and bnd_fail == 0)
    report[fn] = r
    print(json.dumps(r))
# base sockets present in base fbx
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=common.FBX_PATH, automatic_bone_orientation=False)
socks = sorted(o.name for o in bpy.data.objects if o.type == 'EMPTY' and o.name.startswith("Socket_"))
print("sockets in base FBX:", socks)
report["sockets"] = socks
report["ok"] = bool(ok)
print("VERIFY", "OK" if ok else "FAILED")
json.dump(report, open(os.path.join(EX, "verify_report.json"), "w"), indent=1)
