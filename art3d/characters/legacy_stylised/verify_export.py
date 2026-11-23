"""Re-import export/base_body.fbx into a fresh scene and report bones, meshes, blend shapes and seam consistency.

    /Applications/Blender.app/Contents/MacOS/Blender -b -P art3d/characters/verify_export.py
"""
import bpy, os, sys
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import common  # noqa: E402

HUMANOID = ["Hips", "Spine", "Chest", "UpperChest", "Neck", "Head", "Jaw", "LeftEye", "RightEye"]
for sd in ("Left", "Right"):
    HUMANOID += [f"{sd}{n}" for n in ("Shoulder", "UpperArm", "LowerArm", "Hand", "UpperLeg", "LowerLeg", "Foot", "Toes")]
    for f in ("Thumb", "Index", "Middle", "Ring", "Little"):
        HUMANOID += [f"{sd}{f}{p}" for p in ("Proximal", "Intermediate", "Distal")]

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=common.FBX_PATH, automatic_bone_orientation=False)
arms = [o for o in bpy.data.objects if o.type == 'ARMATURE']
meshes = [o for o in bpy.data.objects if o.type == 'MESH']
empties = [o for o in bpy.data.objects if o.type == 'EMPTY']
print("armatures:", [a.name for a in arms])
bones = [b.name for a in arms for b in a.data.bones]
print("bones:", len(bones))
missing = [n for n in HUMANOID if n not in bones]
print("humanoid bones missing:", missing)
print("extra bones:", [b for b in bones if b not in HUMANOID])
tot_t = 0
parts = {}
for m in sorted(meshes, key=lambda o: o.name):
    sk = [k.name for k in m.data.shape_keys.key_blocks] if m.data.shape_keys else []
    t = sum(len(p.vertices) - 2 for p in m.data.polygons)
    tot_t += t
    ng = len([g for g in m.vertex_groups])
    mod = [x.type for x in m.modifiers]
    print(f"mesh {m.name}: verts {len(m.data.vertices)} tris {t} blendshapes {max(len(sk)-1,0)} vgroups {ng} modifiers {mod} "
          f"custom normals {m.data.has_custom_normals} parent {m.parent.name if m.parent else None}")
    parts[m.name] = m
print("total tris", tot_t)
allkeys = set()
for m in meshes:
    if m.data.shape_keys:
        allkeys |= {k.name for k in m.data.shape_keys.key_blocks[1:]}
exp = set(common.ALL_SHAPES)
print("blend shapes in FBX:", len(allkeys), "| expected missing:", sorted(exp - allkeys), "| unexpected:", sorted(allkeys - exp))
print("sockets (empties):", sorted(e.name for e in empties))
print("face rework meshes present:", {n: n in parts for n in ("Part_Cornea_L", "Part_Cornea_R", "Part_Lashes", "Part_Lashes_Full", "Part_Lashes_Wing")})
if "Mesh_Head" in parts:
    h = parts["Mesh_Head"]
    print("Mesh_Head: tris", sum(len(p.vertices) - 2 for p in h.data.polygons), "materials", [m.name for m in h.data.materials],
          "uv layers", [u.name for u in h.data.uv_layers], "expression keys",
          sorted(k.name for k in h.data.shape_keys.key_blocks if k.name in common.EXPR_SHAPES))
    print("  (head parts carry live normals by design: 'custom normals False' on Mesh_Head/Part_Nose/Part_Ear_* is expected)")
# overall size (rest, meshes in world space)
allv = np.concatenate([np.array([(m.matrix_world @ v.co)[:] for v in m.data.vertices]) for m in meshes if m.name.startswith("Mesh_")])
print("bbox min", allv.min(axis=0).round(3), "max", allv.max(axis=0).round(3))


def seam(a, b, label):
    A, B = parts[a], parts[b]
    pa = {tuple(np.round(A.matrix_world @ v.co, 5)): i for i, v in enumerate(A.data.vertices)}
    pb = {tuple(np.round(B.matrix_world @ v.co, 5)): i for i, v in enumerate(B.data.vertices)}
    common_pts = set(pa) & set(pb)
    # normals (custom split normals -> per vertex average of loop normals)
    def vnorm(M):
        M.data.calc_normals_split() if hasattr(M.data, "calc_normals_split") else None
        n = np.zeros((len(M.data.vertices), 3))
        for l in M.data.loops:
            n[l.vertex_index] += np.array(l.normal)
        return n / (np.linalg.norm(n, axis=1, keepdims=True) + 1e-9)
    na, nb = vnorm(A), vnorm(B)
    dn = max((np.linalg.norm(na[pa[p]] - nb[pb[p]]) for p in common_pts), default=0)
    # weights
    def w(M, i):
        return {M.vertex_groups[g.group].name: round(g.weight, 4) for g in M.data.vertices[i].groups}
    dw = 0
    for p in common_pts:
        wa, wb = w(A, pa[p]), w(B, pb[p])
        for k in set(wa) | set(wb):
            dw = max(dw, abs(wa.get(k, 0) - wb.get(k, 0)))
    # shape keys on seam verts
    dk = 0
    if A.data.shape_keys and B.data.shape_keys:
        ka, kb = A.data.shape_keys.key_blocks, B.data.shape_keys.key_blocks
        for k in ka:
            if k.name in kb and k.name != "Basis":
                for p in common_pts:
                    dk = max(dk, (np.array(k.data[pa[p]].co) - np.array(kb[k.name].data[pb[p]].co)).__abs__().max())
    print(f"seam {label}: {len(common_pts)} shared vertices | max normal diff {dn:.5f} | max weight diff {dw:.5f} | max shape-key diff {dk:.6f}")


for a_, b_, lab in (("Mesh_Head", "Mesh_Torso", "head/torso (neck)"), ("Mesh_Torso", "Mesh_Arms", "torso/arms (shoulder cap)"),
                    ("Mesh_Arms", "Mesh_Hands", "arms/hands (wrist)"), ("Mesh_Torso", "Mesh_Legs", "torso/legs (hip)"),
                    ("Mesh_Legs", "Mesh_Feet", "legs/feet (ankle)"), ("Mesh_Head", "Part_Nose", "head/nose"),
                    ("Mesh_Head", "Part_Ear_L", "head/ear L"), ("Mesh_Head", "Part_Ear_R", "head/ear R"),
                    ("Mesh_Head", "Part_Ear_Elf_B_L", "head/elf ear B L (variant)"), ("Mesh_Head", "Part_Nose_Orc", "head/orc nose (variant)")):
    if a_ in parts and b_ in parts:
        seam(a_, b_, lab)
    else:
        print("seam", lab, "missing mesh")
