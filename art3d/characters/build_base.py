"""Build the parametric base character for Garden of Eden on the Blender Studio stylised human base meshes (CC0).

    /Applications/Blender.app/Contents/MacOS/Blender -b -P art3d/characters/build_base.py

Deterministic and re-runnable.  Produces  base.blend  and  export/base_body.fbx  (+ export/base_body_meta.json,
export/joint_offsets.json).

Pipeline (see README.md):
  source_mesh.py  read the bundle's male and female bodies, proportion them, decimate per body part with locked part
                  boundaries, map ONE shared topology onto both sexes  (Sex = female - male, exact)
  this file       welded mesh -> UVs -> Humanoid armature from the mesh's own joints -> automatic weights + clean-up ->
                  shape keys (fieldmap.py + shapes.py + species.py) -> split into parts along the artist's seam loops
                  (Head/Torso/Arms/Hands/Legs/Feet + Nose, Ears, Eyes) -> sockets -> joint offsets -> FBX
"""
import bpy, bmesh, sys, os, json, math
import numpy as np
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import common, source_mesh as sm, fieldmap, shapes, species, head_build as hb  # noqa: E402
from shapes import S, G  # noqa: E402

PART_CODE = {"head": 1, "torso": 2, "arms": 3, "hands": 4, "legs": 5, "feet": 6, "nose": 7, "ears": 8}
PART_NAMES = {1: "Mesh_Head", 2: "Mesh_Torso", 3: "Mesh_Arms", 4: "Mesh_Hands", 5: "Mesh_Legs", 6: "Mesh_Feet",
              7: "Part_Nose", 8: "Part_Ear_L", 9: "Part_Ear_R"}
VERT_PRIORITY = ["head", "torso", "arms", "hands", "legs", "feet", "nose", "ears"]


def fresh_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.unit_settings.system = 'METRIC'
    sc.unit_settings.scale_length = 1.0
    return sc


def coords(me):
    a = np.empty(len(me.vertices) * 3, dtype=np.float64)
    me.vertices.foreach_get('co', a)
    return a.reshape(-1, 3)


def make_mesh(R, name, V, faces, part_codes=None):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in V], [], [tuple(f) for f in faces])
    me.update()
    for p in me.polygons:
        p.use_smooth = True
    if part_codes is not None:
        a = me.attributes.new("part", 'INT', 'FACE')
        a.data.foreach_set('value', np.asarray(part_codes, dtype=np.int32))
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    return ob


# ------------------------------------------------------------------ landmarks -> bones
def add_pivot(lm):
    d = lm["elbow"] - lm["shoulder_b"]
    d = d / np.linalg.norm(d)
    lm["pivot"] = lm["shoulder_b"] - d * 0.07
    return lm


def bone_defs(lm):
    """name -> (head, tail, parent) in metres, left side defined and mirrored. A-pose, Blender Z up, front -Y."""
    B = {}

    def b(name, h, t, parent=None):
        B[name] = (Vector(h), Vector(t), parent)
    hip = lm["hip_b"] + np.array([0, 0, 0.05])
    nb = lm["neck_base"]
    top = lm["top"]
    yc = float(lm["head_c"][1])
    hips0 = np.array([0.0, hip[1], hip[2]])
    up = np.array([0.0, nb[1], nb[2] - 0.03])
    pts = [hips0 + (up - hips0) * f for f in (0.0, 0.16, 0.38, 0.68, 1.0)]
    b("Hips", pts[0], pts[1])
    b("Spine", pts[1], pts[2], "Hips")
    b("Chest", pts[2], pts[3], "Spine")
    b("UpperChest", pts[3], pts[4], "Chest")
    head_base = np.array([0.0, yc, lm["chin"] + 0.035])
    b("Neck", up + np.array([0, 0, 0.0]), head_base, "UpperChest")
    b("Head", head_base, [0.0, yc, top], "Neck")
    ear = lm["ear"]
    b("Jaw", [0.0, ear[1] + 0.01, ear[2] - 0.03], [0.0, lm["chin_front"][1] + 0.01, lm["chin"] + 0.005], "Head")
    for sd, sx in (("Left", 1), ("Right", -1)):
        def X(v):
            v = np.asarray(v, float)
            return (sx * v[0], v[1], v[2])
        eye = lm["eye"]
        b(f"{sd}Eye", X((lm["eye_x"], eye[1], eye[2])), X((lm["eye_x"], eye[1] - 0.03, eye[2])), "Head")
        b(f"{sd}Shoulder", X((0.03, nb[1], nb[2] - 0.025)), X(lm["pivot"]), "UpperChest")
        b(f"{sd}UpperArm", X(lm["pivot"]), X(lm["elbow"]), f"{sd}Shoulder")
        b(f"{sd}LowerArm", X(lm["elbow"]), X(lm["wrist"]), f"{sd}UpperArm")
        b(f"{sd}Hand", X(lm["wrist"]), X(lm["palm_end"]), f"{sd}LowerArm")
        for fname in ("Index", "Middle", "Ring", "Little", "Thumb"):
            fp = lm["finger_" + fname]
            parts = ("Proximal", "Intermediate", "Distal")
            for j, part in enumerate(parts):
                par = f"{sd}Hand" if j == 0 else f"{sd}{fname}{parts[j - 1]}"
                b(f"{sd}{fname}{part}", X(fp[j]), X(fp[j + 1]), par)
        hp = lm["hip_b"] + np.array([0, 0, 0.05])
        hp = np.array([hp[0] * 0.9, hp[1], hp[2]])
        ank = lm["ankle_b"] + np.array([0, 0, -0.03])
        b(f"{sd}UpperLeg", X(hp), X(lm["knee"]), "Hips")
        b(f"{sd}LowerLeg", X(lm["knee"]), X(ank), f"{sd}UpperLeg")
        b(f"{sd}Foot", X(ank), X(lm["ball"]), f"{sd}LowerLeg")
        b(f"{sd}Toes", X(lm["ball"]), X(lm["toe_tip"]), f"{sd}Foot")
    return B


def make_armature(lm):
    arm_data = bpy.data.armatures.new("Armature")
    arm = bpy.data.objects.new("Armature", arm_data)
    bpy.context.collection.objects.link(arm)
    bpy.context.view_layer.objects.active = arm
    arm.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    B = bone_defs(lm)
    for name, (h, t, par) in B.items():
        eb = arm_data.edit_bones.new(name)
        eb.head, eb.tail = h, t
    for name, (h, t, par) in B.items():
        if par:
            arm_data.edit_bones[name].parent = arm_data.edit_bones[par]
    for name, (h, t, par) in B.items():
        eb = arm_data.edit_bones[name]
        d = t - h
        eb.align_roll((0, 0, 1) if abs(d.z) < 0.9 * d.length else (0, -1, 0))
    bpy.ops.object.mode_set(mode='OBJECT')
    arm_data.display_type = 'OCTAHEDRAL'
    arm.show_in_front = True
    return arm


# ------------------------------------------------------------------ materials, UVs
FACE_HALF_W = 0.11


def setup_materials_and_uvs(ob, lm, sk_hw, FS):
    """Materials: 0 Skin (body), 1 Skin_Head (head, nose, ears: own UV layout and texture set), 2 Mouth_Inner (cavity).
    Body faces: smart-projected islands packed into the lower-right quadrant as before. Head: head_build.head_uvs()."""
    me = ob.data
    for name, col in (("Skin", (0.93, 0.66, 0.52)), ("Skin_Head", (0.93, 0.66, 0.52)), ("Mouth_Inner", (0.35, 0.10, 0.12))):
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        m.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (*col, 1)
        m.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.8
        me.materials.append(m)
    z0 = lm["chin"] - 0.005
    z1 = z0 + 0.22
    rect = dict(x0=-FACE_HALF_W, x1=FACE_HALF_W, z0=z0, z1=z1)
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.faces.ensure_lookup_table()
    lab = bm.faces.layers.int["part"]
    uv = bm.loops.layers.uv.new("UVMap")
    face_faces = set()
    bag = FS["bag"]
    for fc in bm.faces:
        c = fc.calc_center_median()
        if fc[lab] in (1, 7) and abs(c.x) <= 0.95 * sk_hw and z0 + 0.01 <= c.z <= lm["top"] - 0.05 and fc.normal.y < -0.25 \
                and not all(bag[v.index] for v in fc.verts):
            face_faces.add(fc.index)
    fverts = set()
    for fc in bm.faces:
        if fc.index in face_faces:
            fverts.update(v.index for v in fc.verts)
        if fc[lab] in (1, 7, 8):
            fc.material_index = 2 if all(bag[v.index] for v in fc.verts) else 1
        else:
            fc.material_index = 0
    bm.to_mesh(me)
    bm.free()
    vg = ob.vertex_groups.new(name="Face_Decal")
    vg.add(sorted(fverts), 1.0, 'REPLACE')
    for p in me.polygons:
        p.hide = p.material_index != 0
        p.select = False
    sc = bpy.context.scene
    sc.tool_settings.use_uv_select_sync = True
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_mode(type='FACE')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.004, area_weight=0.0,
                             correct_aspect=True, scale_to_bounds=False)
    bpy.ops.uv.select_all(action='SELECT')
    bpy.ops.uv.pack_islands(rotate=False, margin=0.006)
    bpy.ops.mesh.reveal(select=False)
    bpy.ops.object.mode_set(mode='OBJECT')
    ob.select_set(False)
    uvl = me.uv_layers["UVMap"]
    for p in me.polygons:
        if p.material_index == 0:
            for li in p.loop_indices:
                u, v = uvl.data[li].uv
                uvl.data[li].uv = (0.5 + 0.5 * u, 0.5 * v)
    hb.head_uvs(ob, FS, lm, rect)
    return face_faces, rect


# ------------------------------------------------------------------ weights
def bind_and_weight(ob, arm, lm, h=None):
    for n in ("Jaw", "LeftEye", "RightEye"):
        arm.data.bones[n].use_deform = False
    bpy.ops.object.select_all(action='DESELECT')
    ob.select_set(True)
    arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    zone = {vg.name: [v.index for v in ob.data.vertices if any(g.group == vg.index for g in v.groups)]
            for vg in ob.vertex_groups}
    for vg in list(ob.vertex_groups):
        ob.vertex_groups.remove(vg)
    bpy.ops.object.parent_set(type='ARMATURE_AUTO')
    for n in ("Jaw", "LeftEye", "RightEye"):
        arm.data.bones[n].use_deform = True
    me = ob.data
    names = [b.name for b in arm.data.bones]
    ni = {n: i for i, n in enumerate(names)}
    nv = len(me.vertices)
    W = np.zeros((nv, len(names)))
    for v in me.vertices:
        for g in v.groups:
            nm = ob.vertex_groups[g.group].name
            if nm in ni:
                W[v.index, ni[nm]] = g.weight
    P = coords(me)
    heads = {n: np.array(arm.data.bones[n].head_local) for n in names}
    tails = {n: np.array(arm.data.bones[n].tail_local) for n in names}
    bad = np.where(W.sum(axis=1) < 1e-6)[0]
    pool = [n for n in names if n not in ("Jaw", "LeftEye", "RightEye")]
    for i in bad:
        best, bd = None, 1e9
        for n in pool:
            h, t = heads[n], tails[n]
            d = t - h
            u = np.clip(np.dot(P[i] - h, d) / max(np.dot(d, d), 1e-9), 0, 1)
            dist = np.linalg.norm(P[i] - (h + u * d))
            if dist < bd:
                best, bd = n, dist
        W[i, ni[best]] = 1.0
    print("verts without auto weights (fallback used):", len(bad))
    nbr = [[] for _ in range(nv)]
    for e in me.edges:
        a, b = e.vertices
        nbr[a].append(b)
        nbr[b].append(a)
    finger_cols = [ni[n] for n in names if any(k in n for k in ("Thumb", "Index", "Middle", "Ring", "Little"))]
    smoothable = np.ones(nv, bool)
    hand_zone = (np.abs(P[:, 0]) > lm["wrist"][0] - 0.01) & (P[:, 2] < lm["wrist"][2] + 0.02)
    smoothable[hand_zone] = False
    for _ in range(3):
        Wn = W.copy()
        for i in range(nv):
            if smoothable[i] and nbr[i]:
                Wn[i] = 0.5 * W[i] + 0.5 * W[nbr[i]].mean(axis=0)
        W = Wn
    # jaw: lower-face verts take a share of Head weight
    hi = ni["Head"]
    chin = lm["chin"]
    if h is None:
        jf = S(chin + 0.05, chin + 0.012, P[:, 2]) * S(float(lm["head_c"][1]) - 0.0, float(lm["head_c"][1]) - 0.05, P[:, 1])
    else:
        # harmonic lowerness from face_rig: 0 on the upper lip and above, 1 on the lower lip and chin (the lips are separate
        # surfaces, so the Jaw bone opens a real mouth); smoothstep keeps the cheeks soft
        jf = h * h * (3 - 2 * h)
    j = jf * W[:, hi] * (0.9 if h is None else 0.97)
    W[:, hi] -= j
    W[:, ni["Jaw"]] += j
    for i in range(nv):
        row = W[i]
        if np.count_nonzero(row > 1e-4) > 4:
            keep = np.argsort(row)[-4:]
            m = np.zeros_like(row)
            m[keep] = row[keep]
            row = m
        row[row < 1e-3] = 0
        s = row.sum()
        W[i] = row / s if s > 0 else row
    for vg in list(ob.vertex_groups):
        ob.vertex_groups.remove(vg)
    for n in names:
        ob.vertex_groups.new(name=n)
    for n in names:
        col = W[:, ni[n]]
        vg = ob.vertex_groups[n]
        for i in np.nonzero(col > 0)[0]:
            vg.add([int(i)], float(col[i]), 'REPLACE')
    for zn, idx in zone.items():
        vg = ob.vertex_groups.new(name=zn)
        vg.add(idx, 1.0, 'REPLACE')
    return W, names


# ------------------------------------------------------------------ shape keys
DELTAS = {}
# feminine silhouette added into Sex (2026-11 reference comparison: the bundle's female reads thin and flat next to the
# reference's hourglass). Uses the existing body fields so the parts/clothes transfer keeps working.
SEX_CURVES = {}          # G9: the realistic female scan already has the forms; the stylised-base curve mix is gone


def smooth_zone(fm, faces, nv):
    """Vertices around the shoulder where the arm field and the torso field meet (partial arm weight), dilated twice, with
    their neighbour lists; shape deltas are Laplacian-smoothed there so shoulders stay clean under every key."""
    nbr = [set() for _ in range(nv)]
    for f in faces:
        for i in range(len(f)):
            nbr[f[i]].add(f[(i + 1) % len(f)])
            nbr[f[i]].add(f[i - 1])
    nbr = [np.array(sorted(s)) for s in nbr]
    zone = (fm.w_arm > 0.01) & (fm.w_arm < 0.99)
    for _ in range(3):
        z2 = zone.copy()
        for i in np.nonzero(zone)[0]:
            z2[nbr[i]] = True
        zone = z2
    return zone, nbr


def add_shape_keys(ob, Pm, Pf, fm, faces=None, expr=None):
    if faces is not None:
        zone, nbr = smooth_zone(fm, faces, len(Pm))
        zi = np.nonzero(zone)[0]
    ob.shape_key_add(name="Basis", from_mix=False)
    ob.data.shape_keys.use_relative = True
    for name in SEX_CURVES:                              # fields needed by the feminine curve mix inside Sex
        DELTAS[name] = fm.deltas(name)
    for name in common.ALL_SHAPES:
        if name == "Sex":
            D = Pf - Pm
            for k, wgt in SEX_CURVES.items():           # keys earlier in ALL_SHAPES, already in DELTAS
                D = D + wgt * DELTAS[k]
        elif name in species.SPECIES_SHAPES:
            D = species.delta(name, DELTAS, Pm, fm)
        elif name in common.EXPR_SHAPES:
            D = expr[name]
        else:
            D = fm.deltas(name)
            if faces is not None:
                for _ in range(8):
                    Dn = D.copy()
                    for i in zi:
                        Dn[i] = 0.4 * D[i] + 0.6 * D[nbr[i]].mean(axis=0)
                    D = Dn
        DELTAS[name] = D
        sk = ob.shape_key_add(name=name, from_mix=False)
        sk.slider_min, sk.slider_max = 0.0, 1.0
        sk.data.foreach_set('co', (Pm + D).astype(np.float32).ravel())
        sk.value = 0.0
    ob.data.update()


# ------------------------------------------------------------------ splitting
def srcnormals(src):
    n = np.empty(len(src.data.vertices) * 3, dtype=np.float64)
    src.data.vertex_normals.foreach_get('vector', n)
    return n.reshape(-1, 3)


def set_custom_normals(me, normals):
    me.normals_split_custom_set_from_vertices([tuple(v) for v in normals])


def split_parts(src):
    me = src.data
    attr = me.attributes.new("srcidx", 'INT', 'POINT')
    attr.data.foreach_set('value', np.arange(len(me.vertices), dtype=np.int32))
    N = srcnormals(src)
    parts = {}
    for code, name in PART_NAMES.items():
        ob = src.copy()
        ob.data = src.data.copy()
        ob.name = name
        ob.data.name = name
        bpy.context.collection.objects.link(ob)
        bpy.context.view_layer.objects.active = ob
        ob.select_set(True)
        bpy.ops.object.mode_set(mode='EDIT')
        bm = bmesh.from_edit_mesh(ob.data)
        lab = bm.faces.layers.int["part"]
        if code in (8, 9):
            sg = 1 if code == 8 else -1
            dead = [fc for fc in bm.faces if fc[lab] != 8 or fc.calc_center_median().x * sg <= 0]
        else:
            dead = [fc for fc in bm.faces if fc[lab] != code]
        bmesh.ops.delete(bm, geom=dead, context='FACES')
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
        bmesh.update_edit_mesh(ob.data)
        bpy.ops.object.mode_set(mode='OBJECT')
        ob.select_set(False)
        pm = ob.data
        idx = np.empty(len(pm.vertices), dtype=np.int32)
        pm.attributes["srcidx"].data.foreach_get('value', idx)
        set_custom_normals(pm, N[idx])
        for p in pm.polygons:
            p.use_smooth = True
        used = {p.material_index for p in pm.polygons}
        for mi in sorted(range(len(pm.materials)), reverse=True):
            if mi not in used:
                pm.materials.pop(index=mi)
        if code not in (1, 7):
            if "Face_Decal" in ob.vertex_groups:
                ob.vertex_groups.remove(ob.vertex_groups["Face_Decal"])
            if "FaceDecalUV" in pm.uv_layers:
                pm.uv_layers.remove(pm.uv_layers["FaceDecalUV"])
        base = key_coords(pm, "Basis")
        for kb in list(pm.shape_keys.key_blocks)[1:]:
            k = np.empty(len(pm.vertices) * 3)
            kb.data.foreach_get('co', k)
            if np.abs(k.reshape(-1, 3) - base).max() < 1e-7:
                ob.shape_key_remove(kb)
        pm.attributes.remove(pm.attributes["srcidx"])
        pm.attributes.remove(pm.attributes["part"])
        parts[name] = (ob, idx)
    return parts


def key_coords(me, name):
    k = np.empty(len(me.vertices) * 3)
    me.shape_keys.key_blocks[name].data.foreach_get('co', k)
    return k.reshape(-1, 3)


def make_eye(arm, side, E, lm, fm, Pm, tree_src):
    sd = "L" if side == 0 else "R"
    name = f"Part_Eye_{sd}"
    sx = 1 if side == 0 else -1
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in E["Vm"]], [], [tuple(f) for f in E["tris"]])
    me.update()
    for p in me.polygons:
        p.use_smooth = True
    c = E["Vm"].mean(axis=0)
    r = float(np.abs(E["Vm"][:, 2] - c[2]).max())
    uvl = me.uv_layers.new(name="UVMap")
    for p in me.polygons:
        for li, vi in zip(p.loop_indices, p.vertices):
            v = E["Vm"][vi]
            u = 0.5 + (v[0] - c[0]) * sx / (2 * r)
            w = 0.5 + (v[2] - c[2]) / (2 * r)
            uvl.data[li].uv = (0.5 + 0.25 * (u if sx > 0 else u) + (0.0 if sx > 0 else 0.25), 0.75 + 0.25 * w)
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    me.materials.append(bpy.data.materials["Eye"])
    ob.shape_key_add(name="Basis", from_mix=False)
    # Sex: exact difference of the two eyeball meshes; every other key: the eyeball follows the nearest head vertex
    nearest = int(np.argmin(np.linalg.norm(Pm - c, axis=1)))
    for sname in common.ALL_SHAPES:
        if sname == "Sex":
            D = E["Vf"] - E["Vm"]
        elif sname == "Eye_Big":
            D = (E["Vm"] - c) * 0.16
        else:
            D = np.tile(DELTAS[sname][nearest], (len(E["Vm"]), 1))
        if np.abs(D).max() < 1e-7:
            continue
        sk = ob.shape_key_add(name=sname, from_mix=False)
        sk.slider_min, sk.slider_max = 0.0, 1.0
        sk.data.foreach_set('co', (E["Vm"] + D).astype(np.float32).ravel())
    bone = "LeftEye" if side == 0 else "RightEye"
    vg = ob.vertex_groups.new(name=bone)
    vg.add(list(range(len(me.vertices))), 1.0, 'REPLACE')
    ob.parent = arm
    m = ob.modifiers.new("Armature", 'ARMATURE')
    m.object = arm
    return ob


# ------------------------------------------------------------------ species parts
def boundary_distance(me):
    """distance of every vertex to the nearest open-boundary vertex (the seam loop that must stay fixed)."""
    bm = bmesh.new()
    bm.from_mesh(me)
    bv = [v.co[:] for v in bm.verts if any(e.is_boundary for e in v.link_edges)]
    bm.free()
    P = coords(me)
    if not bv:
        return np.full(len(P), 1.0)
    bv = np.array(bv)
    return np.min(np.linalg.norm(P[:, None, :] - bv[None, :, :], axis=2), axis=1)


def vertex_normals_from_loops(me):
    n = np.zeros((len(me.vertices), 3))
    cn = np.empty(len(me.loops) * 3)
    me.corner_normals.foreach_get('vector', cn)
    cn = cn.reshape(-1, 3)
    for li, l in enumerate(me.loops):
        n[l.vertex_index] += cn[li]
    return n / (np.linalg.norm(n, axis=1, keepdims=True) + 1e-9)


def displaced_variant(base, name, disp_fn):
    """Copy a part, add the same displacement (zero on the seam boundary) to the Basis and every shape key,
    and blend the custom normals with the new geometry away from the seam so the swap stays seamless."""
    ob = base.copy()
    ob.data = base.data.copy()
    ob.name = name
    ob.data.name = name
    bpy.context.collection.objects.link(ob)
    me = ob.data
    P = coords(me)
    d_b = boundary_distance(me)
    w = S(0.004, 0.030, d_b)
    D = disp_fn(P, w)
    old_n = vertex_normals_from_loops(me)
    for kb in me.shape_keys.key_blocks:
        k = np.empty(len(me.vertices) * 3)
        kb.data.foreach_get('co', k)
        kb.data.foreach_set('co', (k.reshape(-1, 3) + D).astype(np.float32).ravel())
    me.update()
    new_n = np.empty(len(me.vertices) * 3)
    me.vertex_normals.foreach_get('vector', new_n)
    new_n = new_n.reshape(-1, 3)
    mix = old_n * (1 - w[:, None]) + new_n * w[:, None]
    mix /= np.linalg.norm(mix, axis=1, keepdims=True) + 1e-9
    set_custom_normals(me, mix)
    return ob


def tusk_part(arm, name, sx, pos, length, radius, DELTAS, Vm, lm):
    bm = bmesh.new()
    bm.loops.layers.uv.verify()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=10, radius1=radius, radius2=radius * 0.15,
                          depth=length, calc_uvs=True)
    M = (Matrix.Translation(pos) @ Matrix.Rotation(math.radians(14), 4, 'X') @ Matrix.Rotation(math.radians(-sx * 6), 4, 'Y')
         @ Matrix.Translation((0, 0, length * 0.5 - 0.006)))
    bmesh.ops.transform(bm, matrix=M, verts=bm.verts)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons:
        p.use_smooth = True
    for l in me.uv_layers[0].data:
        l.uv = (0.5 + 0.25 * l.uv[0], 0.5 + 0.25 * l.uv[1])
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    me.materials.append(bpy.data.materials["Skin"])
    V = coords(me)
    c = V.mean(axis=0)
    ob.shape_key_add(name="Basis", from_mix=False)
    nearest = int(np.argmin(np.linalg.norm(Vm - c, axis=1)))
    for sname in common.ALL_SHAPES:
        D = np.tile(DELTAS[sname][nearest], (len(V), 1))
        if np.abs(D).max() < 1e-6:
            continue
        sk = ob.shape_key_add(name=sname, from_mix=False)
        sk.data.foreach_set('co', (V + D).astype(np.float32).ravel())
    vg = ob.vertex_groups.new(name="Head")
    vg.add(list(range(len(V))), 1.0, 'REPLACE')
    ob.parent = arm
    m = ob.modifiers.new("Armature", 'ARMATURE')
    m.object = arm
    return ob


def species_parts(arm, parts, src, DELTAS, Vm, lm):
    out = []
    ear_l, ear_r, nose = parts["Part_Ear_L"][0], parts["Part_Ear_R"][0], parts["Part_Nose"][0]

    def ear_disp(up, back, out_x, sx):
        def fn(P, w):
            cz = P[:, 2].mean()
            t = S(cz - 0.004, cz + 0.035, P[:, 2]) * w
            D = np.zeros_like(P)
            D[:, 2] = up * t
            D[:, 1] = back * t
            D[:, 0] = sx * out_x * t
            return D
        return fn
    for tag, (up, back, ox) in (("A", (0.040, 0.010, 0.006)), ("B", (0.075, 0.024, 0.012)), ("C", (0.024, 0.004, 0.004))):
        for base, sd, sx in ((ear_l, "L", 1), (ear_r, "R", -1)):
            out.append(displaced_variant(base, f"Part_Ear_Elf_{tag}_{sd}", ear_disp(up, back, ox, sx)))

    def nose_disp(s, dz=0.0, dy=0.0):
        def fn(P, w):
            c = P.mean(axis=0)
            D = (P - c) * (np.array(s) - 1.0) * w[:, None]
            D[:, 2] += dz * w
            D[:, 1] += dy * w
            return D
        return fn
    out.append(displaced_variant(nose, "Part_Nose_Elf", nose_disp((0.80, 1.05, 1.05))))
    out.append(displaced_variant(nose, "Part_Nose_Dwarf", nose_disp((1.30, 1.25, 1.30), dz=-0.002)))
    out.append(displaced_variant(nose, "Part_Nose_Orc", nose_disp((1.45, 0.55, 0.90), dz=-0.004, dy=0.004)))
    # orc tusks on the lower jaw
    eye = lm["eye"]
    mz = lm["chin"] + 0.41 * (eye[2] - lm["chin"])
    P = coords(src.data)
    polys = [tuple(p.vertices) for p in src.data.polygons]
    tree = BVHTree.FromPolygons([Vector(p) for p in P], polys)
    for tag, (length, radius) in (("A", (0.034, 0.0070)), ("B", (0.052, 0.0090))):
        for sd, sx in (("L", 1), ("R", -1)):
            h = tree.ray_cast(Vector((sx * 0.024, -1, mz - 0.012)), Vector((0, 1, 0)))[0]
            pos = Vector((sx * 0.027, (h.y if h else -0.12) + 0.002, mz - 0.016))
            out.append(tusk_part(arm, f"Part_Tusk_{tag}_{sd}", sx, pos, length, radius, DELTAS, Vm, lm))
    return out


# ------------------------------------------------------------------ sockets
def make_sockets(src, arm, lm):
    P = coords(src.data)
    polys = [tuple(p.vertices) for p in src.data.polygons]
    tree = BVHTree.FromPolygons([Vector(p) for p in P], polys)

    def ray(o, d):
        h = tree.ray_cast(Vector(o), Vector(d))
        return h[0] if h[0] is not None else Vector(o)
    sock = {}

    def add(name, pos, bone):
        sock[name] = (Vector(pos), bone)
    eye = lm["eye"]
    mz = lm["chin"] + 0.41 * (eye[2] - lm["chin"])
    for sd, sx in (("L", 1), ("R", -1)):
        add(f"Socket_Eye_{sd}", (sx * lm["eye_x"], eye[1], eye[2]), "Head")
        add(f"Socket_Brow_{sd}", ray((sx * lm["eye_x"], -1, eye[2] + 0.04), (0, 1, 0)), "Head")
        add(f"Socket_Ear_{sd}", (sx * lm["ear"][0], lm["ear"][1], lm["ear"][2]), "Head")
        hz = lm["hip_b"][2] + 0.07
        sel = (np.abs(P[:, 2] - hz) < 0.02) & (P[:, 0] * sx > 0) & (np.abs(P[:, 0]) < 0.22)
        add(f"Socket_Hip_{sd}", (sx * float(np.abs(P[sel, 0]).max()), float(lm["hip_b"][1]), hz), "Hips")
        add(f"Socket_Hand_{sd}", (sx * lm["palm_end"][0], lm["palm_end"][1], lm["palm_end"][2] + 0.05),
            "LeftHand" if sx > 0 else "RightHand")
    add("Socket_Nose", lm["nose_tip"], "Head")
    add("Socket_Mouth", ray((0, -1, mz), (0, 1, 0)), "Head")
    add("Socket_Beard", ray((0, -1, lm["chin"] + 0.02), (0, 1, 0)), "Head")
    top = ray((0, float(lm["head_c"][1]), 3.0), (0, 0, -1))
    add("Socket_Hair", top + Vector((0, 0, -0.02)), "Head")
    add("Socket_Hat", top, "Head")
    add("Socket_Back", ray((0, 1, lm["neck_base"][2] - 0.17), (0, -1, 0)), "UpperChest")
    out = []
    for name, (pos, bone) in sock.items():
        em = bpy.data.objects.new(name, None)
        em.empty_display_type = 'ARROWS'
        em.empty_display_size = 0.03
        bpy.context.collection.objects.link(em)
        em.parent = arm
        em.parent_type = 'BONE'
        em.parent_bone = bone
        bone_mat = arm.matrix_world @ arm.data.bones[bone].matrix_local @ Matrix.Translation((0, arm.data.bones[bone].length, 0))
        em.matrix_parent_inverse = bone_mat.inverted()
        em.matrix_world = Matrix.Translation(pos)
        out.append((name, bone, tuple(round(c, 4) for c in pos)))
    return out


# ------------------------------------------------------------------ export
def export_fbx(path, objs):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.export_scene.fbx(
        filepath=path, use_selection=True, object_types={'ARMATURE', 'MESH', 'EMPTY'},
        apply_unit_scale=True, apply_scale_options='FBX_SCALE_ALL', global_scale=1.0,
        axis_forward='-Z', axis_up='Y', bake_space_transform=False,
        use_mesh_modifiers=True, mesh_smooth_type='FACE', use_mesh_edges=False, use_tspace=False,
        add_leaf_bones=False, primary_bone_axis='Y', secondary_bone_axis='X', armature_nodetype='NULL',
        use_armature_deform_only=False, bake_anim=False, path_mode='COPY', embed_textures=False,
        use_custom_props=False)


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    if "--no-stylise" not in argv:
        import stylise
        sm.STYLISE = stylise.stylise
    src_data = sm.load_source()
    R = sm.build_shared(src_data)
    if "--no-stylise" not in argv:
        print("rest lids (max move):", hb.rest_lids(R, R["lm_male"]))
    fresh_scene()
    Vm, Vf = R["Vm"], R["Vf"]
    faces = R["tris"]
    codes = []
    for f, p in zip(faces, R["part"]):
        codes.append(PART_CODE[p])
    ob = make_mesh(R, "Body_Welded_Source", Vm, faces, codes)
    # per-vertex part (for the field map)
    vpart = ["head"] * len(Vm)
    rank = {p: i for i, p in enumerate(VERT_PRIORITY)}
    best = [99] * len(Vm)
    for f, p in zip(faces, R["part"]):
        for v in f:
            if rank[p] < best[v]:
                best[v] = rank[p]
                vpart[v] = p
    lm = add_pivot(dict(R["lm_male"]))
    lm_f = add_pivot(dict(R["lm_female"]))
    fm = fieldmap.FieldMap(Vm, vpart, lm)
    # eye + skin materials
    mats = {}
    for nm, col in (("Eye", (0.95, 0.95, 0.95)), ("Cornea", (1.0, 1.0, 1.0)), ("Lashes", (0.05, 0.035, 0.03))):
        m = bpy.data.materials.new(nm)
        m.use_nodes = True
        m.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (*col, 1)
        mats[nm] = m
    FS = hb.face_setup(Vm, faces, R["part"], R["eyes"], lm, R)
    face_faces, rect = setup_materials_and_uvs(ob, lm, fm.sk_hw, FS)
    arm = make_armature(lm)
    W, names = bind_and_weight(ob, arm, lm, FS["h"])
    add_shape_keys(ob, Vm, Vf, fm, faces, FS["E"])
    socks = make_sockets(ob, arm, lm)
    eyes = []
    for s in (0, 1):
        eyes += hb.make_eye_hd(arm, s, FS, R["eyes"], DELTAS, common.ALL_SHAPES, common.EXPR_SHAPES, mats)
    for st, prm in hb.LASH_STYLES.items():
        nm = "Part_Lashes" if st == "natural" else f"Part_Lashes_{st.capitalize()}"
        eyes.append(hb.make_lashes(arm, nm, FS, Vm, DELTAS, common.ALL_SHAPES, W, names, mats["Lashes"], style=prm))
    parts = split_parts(ob)
    # landmark vertices of Mesh_Head / Part_Nose (indices into those meshes) for measurements and runtime use
    hidx = {int(w): i for i, w in enumerate(parts["Mesh_Head"][1])}
    nidx = {int(w): i for i, w in enumerate(parts["Part_Nose"][1])}
    FF = FS["F"]
    lmv = {"mouthCorner_L": FF["corners"][1], "mouthCorner_R": FF["corners"][-1], "lipUpperContact": FF["up"], "lipLowerContact": FF["lo"]}
    for side, L in enumerate(FF["lids"]):
        sd = "L" if side == 0 else "R"
        U, D = L["frame"]["upper"], L["frame"]["lower"]
        lmv[f"canthusInner_{sd}"] = int(U[0][0])
        lmv[f"canthusOuter_{sd}"] = int(U[0][-1])
        lmv[f"lidUpper_{sd}"] = int(U[0][np.argmax(Vm[U[0], 2])])
        lmv[f"lidLower_{sd}"] = int(D[0][np.argmin(Vm[D[0], 2])])
    face_lm = {k: {"mesh": "Mesh_Head", "vertex": hidx[int(v)]} for k, v in lmv.items() if int(v) in hidx}
    face_lm["noseTip"] = {"mesh": "Part_Nose", "vertex": nidx.get(int(FF["nose_tip"]), -1)}
    sp_parts = species_parts(arm, parts, ob, DELTAS, Vm, lm)
    # head parts get live normals (no frozen custom normals): face shapes and expressions must re-shade.  Unity: import the head
    # parts with Blend Shape Normals = Calculate; the neck seam normal difference is small (see README weak spots)
    for o in [parts[n][0] for n in ("Mesh_Head", "Part_Nose", "Part_Ear_L", "Part_Ear_R")] + \
            [o for o in sp_parts if o.name.startswith(("Part_Nose", "Part_Ear"))]:
        o.data.normals_split_custom_set([(0.0, 0.0, 0.0)] * len(o.data.loops))
    tot_t = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o, _ in parts.values())
    eye_t = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in eyes)
    print(f"parts: {sum(len(o.data.vertices) for o,_ in parts.values())} verts (welded {len(ob.data.vertices)}), "
          f"{tot_t} tris; eyes {eye_t} tris; height {Vm[:,2].max():.3f} m; female {Vf[:,2].max():.3f} m")
    for n, (o, _) in parts.items():
        print(f"  {n}: {len(o.data.vertices)} verts, {sum(len(p.vertices)-2 for p in o.data.polygons)} tris, "
              f"{len(o.data.shape_keys.key_blocks)-1} shape keys")
    ob.hide_viewport = True
    ob.hide_render = True
    ob.hide_set(True)
    # joint offsets at the bone heads (nearest-vertex delta of every key)
    bn = [b.name for b in arm.data.bones]
    H = np.array([list(arm.data.bones[n].head_local) for n in bn])
    near = [int(np.argmin(np.linalg.norm(Vm - h, axis=1))) for h in H]
    offs = {}
    for sname in common.ALL_SHAPES:
        D = DELTAS[sname]
        d = {n: [round(float(v), 5) for v in D[near[i]]] for i, n in enumerate(bn) if np.abs(D[near[i]]).max() > 5e-5}
        if d:
            offs[sname] = d
    os.makedirs(common.EXPORT_DIR, exist_ok=True)
    with open(os.path.join(common.EXPORT_DIR, "joint_offsets.json"), "w") as fh:
        json.dump({"space": "Blender armature space, metres, shape weight 1.0; Unity = (-x, z, -y)",
                   "restHeads": {n: [round(float(v), 5) for v in H[i]] for i, n in enumerate(bn)},
                   "offsets": offs}, fh, indent=0)
    meta = {
        "faceUvRect": {"u0": 0.0, "v0": 0.5, "u1": 0.5, "v1": 1.0},
        "faceWorldRect": {"x0": rect["x0"], "x1": rect["x1"], "z0": rect["z0"], "z1": rect["z1"]},
        "faceFaces": len(face_faces), "tris": tot_t, "eyeTris": eye_t,
        "landmarks": {k: (np.round(v, 4).tolist() if hasattr(v, "__len__") else round(float(v), 4)) for k, v in lm.items()
                      if not k.startswith("finger")},
        "landmarksFemale": {k: (np.round(v, 4).tolist() if hasattr(v, "__len__") else round(float(v), 4)) for k, v in lm_f.items()
                            if not k.startswith("finger")},
        "parts": {n: {"verts": len(o.data.vertices), "shapeKeys": [k.name for k in o.data.shape_keys.key_blocks[1:]]}
                  for n, (o, _) in parts.items()},
        "sockets": [{"name": n, "bone": b, "pos": p} for n, b, p in socks],
        "speciesParts": [o.name for o in sp_parts],
        "stylise": __import__("stylise").LOG if "stylise" in sys.modules else {},
        "restPose": {"armAngleDeg": round(float(np.degrees(np.arctan2(lm["elbow"][0] - lm["pivot"][0], lm["pivot"][2] - lm["elbow"][2]))), 1)},
        "eyeParts": [o.name for o in eyes],
        "faceLandmarkVerts": face_lm,
        "expressionShapes": common.EXPR_SHAPES,
        "faceRig": {"mouthCorners": [np.round(Vm[FS["F"]["corners"][k]], 4).tolist() for k in (1, -1)],
                    "mouthCentre": np.round(FS["F"]["mouth_c"], 4).tolist(), "mouthWidth": round(FS["F"]["mouth_w"], 4),
                    "eyeCentres": [np.round(c, 4).tolist() for c in FS["centres"]], "eyeRadius": [round(r, 4) for r in FS["radii"]],
                    "mouthCavityVerts": int(FS["bag"].sum()),
                    "innerLipY": round(float(Vm[FS["F"]["ringB"]][np.abs(Vm[FS["F"]["ringB"], 0]) < 0.006, 1].mean()), 5),
                    "cavityDepthY": round(float(np.percentile(Vm[FS["bag"]][np.abs(Vm[FS["bag"], 2] - FS["F"]["mouth_c"][2]) < 0.01, 1], 90)), 5),
                    "lidMargins": [{"upper": np.round(Vm[L["frame"]["upper"][0]], 5).tolist(),
                                    "lower": np.round(Vm[L["frame"]["lower"][0]], 5).tolist()} for L in FS["F"]["lids"]], "jaw": "Jaw bone opens the mouth (lower lip, chin, cavity floor follow it)"},
        "headUv": "Mesh_Head/Part_Nose/Part_Ear_*: UVMap = own 0..1 head layout (Skin_Head texture set); FaceDecalUV = legacy face rect",
        "shapeKeys": common.ALL_SHAPES, "bones": names,
    }
    presets = species.presets(Vm, Vf, DELTAS)
    with open(os.path.join(common.EXPORT_DIR, "species_presets.json"), "w") as fh:
        json.dump(presets, fh, indent=1)
    with open(os.path.join(common.EXPORT_DIR, "base_body_meta.json"), "w") as fh:
        json.dump(meta, fh, indent=1)
    bpy.ops.wm.save_as_mainfile(filepath=common.BLEND_PATH)
    if "--no-export" not in argv:
        objs = [arm] + [o for o, _ in parts.values()] + eyes + sp_parts + [o for o in bpy.data.objects if o.type == 'EMPTY']
        export_fbx(common.FBX_PATH, objs)
        print("exported", common.FBX_PATH, os.path.getsize(common.FBX_PATH), "bytes")


if __name__ == "__main__":
    main()
