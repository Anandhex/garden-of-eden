"""Checks of the full-resolution face (2026-11 rework) on base.blend; writes export/verify_face.json.

    Blender -b art3d/characters/base.blend -P art3d/characters/verify_face.py

  * head budget (tris), materials, UV layers, landmarks
  * the Jaw bone opens the lips (gap between the lip contact vertices at 12 degrees) and the cavity stays behind the lips
  * Eye_Blink_L/R close the lids (upper/lower lid landmark distance), at Sex 0 and Sex 1
  * every expression key exists on Mesh_Head and stays small on the body; nose/lashes carry the keys they need
  * neck seam: Mesh_Head and Mesh_Torso share identical seam vertices, weights and shape-key deltas
"""
import bpy, os, sys, json, math
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import common  # noqa: E402

META = json.load(open(os.path.join(common.EXPORT_DIR, "base_body_meta.json")))
R = {}


def ev(name):
    dg = bpy.context.evaluated_depsgraph_get()
    o = bpy.data.objects[name].evaluated_get(dg)
    me = o.to_mesh()
    P = np.array([(o.matrix_world @ v.co)[:] for v in me.vertices])
    o.to_mesh_clear()
    return P


def keys(w):
    for o in bpy.data.objects:
        if o.type == 'MESH' and o.data.shape_keys:
            for k in o.data.shape_keys.key_blocks[1:]:
                k.value = w.get(k.name, 0.0)


arm = bpy.data.objects["Armature"]
arm.data.pose_position = 'POSE'
head = bpy.data.objects["Mesh_Head"]
me = head.data
R["head"] = dict(verts=len(me.vertices), tris=sum(len(p.vertices) - 2 for p in me.polygons), materials=[m.name for m in me.materials],
                 uvLayers=[u.name for u in me.uv_layers], shapeKeys=len(me.shape_keys.key_blocks) - 1)
R["face_parts_tris"] = {n: sum(len(p.vertices) - 2 for p in bpy.data.objects[n].data.polygons)
                        for n in ("Part_Nose", "Part_Ear_L", "Part_Ear_R", "Part_Eye_L", "Part_Cornea_L", "Part_Lashes")}
lm = META["faceLandmarkVerts"]
iu, il = lm["lipUpperContact"]["vertex"], lm["lipLowerContact"]["vertex"]
res = {}
for sex in (0.0, 1.0):
    keys({"Sex": sex})
    pb = arm.pose.bones["Jaw"]
    pb.rotation_mode = 'XYZ'
    gaps = {}
    for deg in (0, 6, 12, 18):
        pb.rotation_euler = (math.radians(deg), 0, 0)
        bpy.context.view_layer.update()
        P = ev("Mesh_Head")
        gaps[deg] = round(float(np.linalg.norm(P[iu] - P[il])) * 1000, 2)
    pb.rotation_euler = (0, 0, 0)
    bl = {}
    for side in ("L", "R"):
        a, b = lm[f"lidUpper_{side}"]["vertex"], lm[f"lidLower_{side}"]["vertex"]
        keys({"Sex": sex})
        bpy.context.view_layer.update()
        o0 = float(np.linalg.norm(ev("Mesh_Head")[a] - ev("Mesh_Head")[b]))
        keys({"Sex": sex, f"Eye_Blink_{side}": 1.0})
        bpy.context.view_layer.update()
        P = ev("Mesh_Head")
        bl[side] = dict(open_mm=round(o0 * 1000, 2), closed_mm=round(float(np.linalg.norm(P[a] - P[b])) * 1000, 2))
    res["F" if sex else "M"] = dict(lipGap_mm_by_jaw_deg=gaps, blink=bl)
keys({})
R["mouth_and_lids"] = res
# expression keys
names = [k.name for k in me.shape_keys.key_blocks[1:]]
R["expressionKeysOnHead"] = {k: (k in names) for k in common.EXPR_SHAPES}
B = np.array([v.co[:] for v in me.vertices])
R["expressionMaxMove_mm"] = {}
for k in common.EXPR_SHAPES:
    kb = me.shape_keys.key_blocks.get(k)
    if kb:
        D = np.array([d.co[:] for d in kb.data]) - B
        R["expressionMaxMove_mm"][k] = round(float(np.linalg.norm(D, axis=1).max()) * 1000, 2)
R["expressionKeysOnBody"] = {n: [k.name for k in bpy.data.objects[n].data.shape_keys.key_blocks[1:] if k.name in common.EXPR_SHAPES]
                             for n in ("Mesh_Torso", "Mesh_Arms", "Part_Nose", "Part_Lashes", "Part_Eye_L")}
# neck seam
T = bpy.data.objects["Mesh_Torso"]
PH = {tuple(np.round(v.co, 6)): v.index for v in me.vertices}
PT = {tuple(np.round(v.co, 6)): v.index for v in T.data.vertices}
common_pts = sorted(set(PH) & set(PT))
dk = 0.0
for kb in me.shape_keys.key_blocks[1:]:
    kt = T.data.shape_keys.key_blocks.get(kb.name)
    for p in common_pts:
        a = np.array(kb.data[PH[p]].co) - np.array(me.vertices[PH[p]].co)
        b = (np.array(kt.data[PT[p]].co) - np.array(T.data.vertices[PT[p]].co)) if kt else np.zeros(3)
        dk = max(dk, float(np.abs(a - b).max()))


def wts(o, i):
    return {o.vertex_groups[g.group].name: g.weight for g in o.data.vertices[i].groups if not o.vertex_groups[g.group].name.startswith(("Face_", "zone"))}


dw = 0.0
for p in common_pts:
    a, b = wts(head, PH[p]), wts(T, PT[p])
    for k in set(a) | set(b):
        if k in [bn.name for bn in arm.data.bones]:
            dw = max(dw, abs(a.get(k, 0) - b.get(k, 0)))
R["neckSeam"] = dict(sharedVerts=len(common_pts), maxShapeKeyDelta=dk, maxWeightDiff=round(dw, 6))
checks = {
    "head_tris_in_6k_8k": 6000 <= R["head"]["tris"] <= 8000,
    "jaw_opens_lips_M": res["M"]["lipGap_mm_by_jaw_deg"][12] > 6.0,
    "jaw_opens_lips_F": res["F"]["lipGap_mm_by_jaw_deg"][12] > 6.0,
    "blink_closes_M": all(v["closed_mm"] < 2.0 for v in res["M"]["blink"].values()),
    "blink_closes_F": all(v["closed_mm"] < 2.5 for v in res["F"]["blink"].values()),
    "all_expression_keys": all(R["expressionKeysOnHead"].values()),
    "no_expression_on_body": not R["expressionKeysOnBody"]["Mesh_Torso"] and not R["expressionKeysOnBody"]["Mesh_Arms"],
    "neck_seam_identical": R["neckSeam"]["sharedVerts"] >= 30 and R["neckSeam"]["maxShapeKeyDelta"] < 1e-5 and R["neckSeam"]["maxWeightDiff"] < 1e-4,
}
R["checks"] = checks
R["allPassed"] = all(checks.values())
json.dump(R, open(os.path.join(common.EXPORT_DIR, "verify_face.json"), "w"), indent=1)
print(json.dumps(R, indent=1))
