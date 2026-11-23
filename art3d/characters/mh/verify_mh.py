"""Checks on mh/base_mh.blend (the contract Unity depends on; ../README.md):
bones (56 Unity-Humanoid names incl. Jaw and eyes, one root), shape-key names, 16 sockets, seams (every vertex shared by two
body parts: same position, same weights, same delta in every key, same custom normal), triangle budget.

    $B -b art3d/characters/mh/base_mh.blend -P art3d/characters/mh/verify_mh.py
"""
import bpy, os, sys, json
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import common  # noqa: E402

BODY = ["Mesh_Head", "Mesh_Torso", "Mesh_Arms", "Mesh_Hands", "Mesh_Legs", "Mesh_Feet", "Part_Nose", "Part_Ear_L", "Part_Ear_R"]
old = json.load(open(os.path.join(os.path.dirname(HERE), "export", "base_body_meta.json")))
ok = True


def check(cond, msg):
    global ok
    print(("PASS " if cond else "FAIL ") + msg)
    ok &= bool(cond)


arm = bpy.data.objects["Armature"]
names = [b.name for b in arm.data.bones]
check(sorted(names) == sorted(old["bones"]), f"bones: {len(names)} == old contract {len(old['bones'])}; missing {set(old['bones']) - set(names)}, extra {set(names) - set(old['bones'])}")
check([b.name for b in arm.data.bones if b.parent is None] == ["Hips"], "single root Hips")
socks = [o for o in bpy.data.objects if o.name.startswith("Socket_")]
check(len(socks) == 16 and {s["name"] for s in old["sockets"]} == {o.name for o in socks}, f"sockets {len(socks)} with the old names")
keys = set()
for o in bpy.data.objects:
    if o.type == 'MESH' and o.data.shape_keys and o.parent == arm:
        keys |= {k.name for k in o.data.shape_keys.key_blocks[1:] if not k.name.startswith('User_')}
sys.path.insert(0, HERE)
import shapes_mh  # noqa: E402
want = set(common.ALL_SHAPES) | set(shapes_mh.EXTRA_SHAPES)
check(keys == want, f"shape keys {len(keys)} == {len(want)} (75 old + {len(shapes_mh.EXTRA_SHAPES)} new); missing {want - keys}")


def data(o):
    me = o.data
    P = np.array([v.co[:] for v in me.vertices])
    gi = {g.index: g.name for g in o.vertex_groups}
    W = [{gi[g.group]: round(g.weight, 6) for g in v.groups if g.weight > 1e-6} for v in me.vertices]
    K = {k.name: np.array([d.co[:] for d in k.data]) - P for k in me.shape_keys.key_blocks[1:]}
    me_n = np.array([l.normal[:] for l in me.loops])
    vi = np.array([l.vertex_index for l in me.loops])
    N = np.zeros_like(P)
    N[vi] = me_n
    return P, W, K, N


D = {n: data(bpy.data.objects[n]) for n in BODY}
pos_d = w_d = k_d = n_d = 0.0
pairs = 0
for i, a in enumerate(BODY):
    for b in BODY[i + 1:]:
        Pa, Pb = D[a][0], D[b][0]
        from mathutils.kdtree import KDTree
        kd = KDTree(len(Pb))
        for j, p in enumerate(Pb):
            kd.insert(p, j)
        kd.balance()
        for ia, p in enumerate(Pa):
            co, jb, d = kd.find(p)
            if d < 1e-6:
                pairs += 1
                pos_d = max(pos_d, d)
                wa, wb = D[a][1][ia], D[b][1][jb]
                w_d = max(w_d, max(abs(wa.get(k, 0) - wb.get(k, 0)) for k in set(wa) | set(wb)))
                for kn in set(D[a][2]) | set(D[b][2]):
                    da = D[a][2][kn][ia] if kn in D[a][2] else np.zeros(3)
                    db = D[b][2][kn][jb] if kn in D[b][2] else np.zeros(3)
                    dd = float(np.abs(da - db).max())
                    if dd > k_d:
                        worst = (a, b, kn, ia, jb, dd, float(np.abs(da).max()))
                    k_d = max(k_d, dd)
                n_d = max(n_d, float(np.abs(D[a][3][ia] - D[b][3][jb]).max()))
check(pairs > 300, f"seam vertex pairs {pairs}")
check(w_d < 1e-5, f"seam weights max diff {w_d:.2e}")
print("worst", worst if k_d > 0 else None)
check(k_d < 1e-6, f"seam shape-key deltas max diff {k_d:.2e}")
check(n_d < 2e-3, f"seam normals max diff {n_d:.2e}")
tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in bpy.data.objects if o.type == 'MESH' and o.parent == arm)
check(15000 <= tris <= 22000, f"triangles {tris} within 15-22k")
# groom (round 24): one object per hair / facial-hair style under the Groom empty, skinned, keyed, within a per-style budget
groom = bpy.data.objects.get("Groom")
gm = json.load(open(os.path.join(HERE, "export", "groom.json"))) if os.path.exists(os.path.join(HERE, "export", "groom.json")) else {}
check(groom is not None and groom.parent == arm, "Groom empty under the armature")
want_g = [v["object"] for d in ("hair", "beards") for v in gm.get(d, {}).values() if "object" in v]
gobs = [o for o in bpy.data.objects if o.parent == groom] if groom else []
check(len(want_g) > 40 and sorted(want_g) == sorted(o.name for o in gobs), f"groom objects {len(gobs)} == groom.json {len(want_g)}")
bad = [o.name for o in gobs if not any(m.type == 'ARMATURE' and m.object == arm for m in o.modifiers) or not o.vertex_groups]
check(not bad, f"groom objects skinned to the armature; bad {bad}")
gt = {o.name: sum(len(p.vertices) - 2 for p in o.data.polygons) for o in gobs}
check(gt and max(gt.values()) <= 12000, f"groom triangles per style max {max(gt.values()) if gt else 0} <= 12000 (total {sum(gt.values())})")
nos = [o.name for o in gobs if not o.data.shape_keys or "Sex" not in o.data.shape_keys.key_blocks]
check(not nos, f"every groom style follows the Sex key; missing {nos}")
print("VERIFY", "OK" if ok else "FAILED")
