"""Blender side of the full-resolution head (2026-11 face rework), called from build_base.py.

  face_setup()      face rig data on the welded mesh (lip rings, mouth cavity, lowerness, lid frames, expression deltas)
  head_uvs()        the head (+ nose, ears, mouth cavity) gets its own 0..1 UV layout (UVMap) for its texture set, and the
                    legacy planar face rect in a second layer FaceDecalUV (u 0..0.5, v 0.5..1, same formula as before)
  make_eye_hd()     eyeball (sclera + recessed iris, own 0..1 planar UV) and a cornea shell, skinned to the eye bone
  make_lashes()     default eyelash cards (upper + lower, both eyes), alpha-tested strand texture, follow every head key
"""
import bpy, bmesh, math
from mathutils import Vector
import numpy as np
import face_rig as fr

HEAD_PARTS = ("head", "nose", "ears")


def face_setup(Vm, faces, part, eyes, lm, R=None):
    T = fr.Topo(Vm, faces, list(part), HEAD_PARTS)
    centres = [eyes[s]["Vm"].mean(axis=0) for s in (0, 1)]
    radii = [float(eyes[s]["Vm"][:, 2].max() - eyes[s]["Vm"][:, 2].min()) / 2 for s in (0, 1)]
    F = fr.find_face(T, centres, radii, slit=(R or {}).get("slit"))
    bag = fr.mouth_bag(T, F, lm, inner=(R or {}).get("sets", {}).get("inner_mouth"))
    h = fr.lowerness(T, F, lm, bag)
    for L in F["lids"]:
        L["frame"] = fr.lid_frames(Vm, L)
    head_only = np.zeros(len(Vm), bool)
    for f, p in zip(faces, part):
        if p == "head":
            head_only[list(f)] = True
    E = fr.expression_deltas(Vm, T.used, F, h, F["lids"], lm, bag)
    return dict(T=T, F=F, bag=bag, h=h, E=E, centres=centres, radii=radii, head_only=head_only)


# ------------------------------------------------------------------------------------------------ UVs
def head_uvs(ob, FS, lm, face_rect):
    """UVMap for head/nose/ear faces: own layout (back-of-head seam, part borders, mouth cavity island).  Body faces are left
    to the caller.  Adds FaceDecalUV (planar front projection used by the legacy face decals)."""
    me = ob.data
    bag = FS["bag"]
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.faces.ensure_lookup_table()
    bm.edges.ensure_lookup_table()
    lab = bm.faces.layers.int["part"]
    HEADC = (1, 7, 8)
    yc = float(lm["head_c"][1])
    ec = FS["centres"][0]
    chin = float(lm["chin"])
    # face island: the front of the head inside the hairline, temples and jaw line
    def in_face(f):
        c = f.calc_center_median()
        return (f[lab] == 1 and not all(bag[v.index] for v in f.verts) and abs(c.x) < 0.068 and chin - 0.004 < c.z < ec[2] + 0.068
                and c.y < yc - 0.015 + 0.0 and (c.z > chin + 0.012 or c.y < yc - 0.05))
    face_f = {f.index for f in bm.faces if in_face(f)}
    # keep only the component connected to the nose area (drop stray faces)
    for e in bm.edges:
        fs = e.link_faces
        codes = {f[lab] for f in fs}
        a, b = e.verts
        if len(codes) > 1 and codes & set(HEADC):
            e.seam = True                                        # part borders (neck, nose, ears)
        elif len(fs) == 2 and codes == {1} and ((fs[0].index in face_f) != (fs[1].index in face_f)):
            e.seam = True                                        # face island border
        elif codes <= set(HEADC) and abs(a.co.x) < 2e-5 and abs(b.co.x) < 2e-5 and a.co.y > yc + 0.01 and b.co.y > yc + 0.01 \
                and not (bag[a.index] or bag[b.index]):
            e.seam = True                                        # back of the head, neck to crown
        elif codes <= set(HEADC):
            fb = [all(bag[v.index] for v in f.verts) for f in fs]
            if len(fb) == 2 and fb[0] != fb[1]:
                e.seam = True                                    # mouth cavity island
            if all(fb) and abs(a.co.x) < 2e-5 and abs(b.co.x) < 2e-5 and a.co.z < float(lm["chin"]) + 0.01 and b.co.z < float(lm["chin"]) + 0.01:
                e.seam = True                                    # open the throat tube along its midline
    # FaceDecalUV
    dec = bm.loops.layers.uv.new("FaceDecalUV")
    r = face_rect
    for fc in bm.faces:
        if fc[lab] in (1, 7):
            for lp in fc.loops:
                x, _, zz = lp.vert.co
                lp[dec].uv = ((x - r["x0"]) / (r["x1"] - r["x0"]) * 0.5, 0.5 + (zz - r["z0"]) / (r["z1"] - r["z0"]) * 0.5)
    bm.to_mesh(me)
    bm.free()
    me.uv_layers.active = me.uv_layers["UVMap"]
    for p in me.polygons:
        p.hide = me.attributes["part"].data[p.index].value not in HEADC
        p.select = not p.hide
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_mode(type='FACE')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.unwrap(method='ANGLE_BASED', fill_holes=True, correct_aspect=True, margin=0.004)
    bpy.ops.object.mode_set(mode='OBJECT')
    weight_islands(ob, face_f, bag)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.select_all(action='SELECT')
    bpy.ops.uv.pack_islands(rotate=True, scale=True, margin=0.010)
    bpy.ops.mesh.reveal(select=False)
    bpy.ops.object.mode_set(mode='OBJECT')
    ob.select_set(False)
    for p in me.polygons:
        p.hide = False
        p.select = False


ISLAND_WEIGHT = {"face": 2.2, "nose": 2.2, "ear": 1.0, "scalp": 0.65, "bag": 0.22}


def weight_islands(ob, face_f, bag):
    """scale the UV islands so texel density follows ISLAND_WEIGHT (area ratio) before the final pack."""
    me = ob.data
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.faces.ensure_lookup_table()
    lab = bm.faces.layers.int["part"]
    uv = bm.loops.layers.uv["UVMap"]
    todo = {f.index for f in bm.faces if f[lab] in (1, 7, 8)}
    while todo:
        seed = todo.pop()
        isl = [seed]
        q = [seed]
        while q:
            f = bm.faces[q.pop()]
            for e in f.edges:
                if e.seam:
                    continue
                for g in e.link_faces:
                    if g.index in todo:
                        todo.discard(g.index)
                        isl.append(g.index)
                        q.append(g.index)
        fs = [bm.faces[i] for i in isl]
        a3 = sum(f.calc_area() for f in fs)
        a2 = 0.0
        for f in fs:
            pts = [l[uv].uv for l in f.loops]
            for k in range(1, len(pts) - 1):
                a2 += abs((pts[k] - pts[0]).cross(pts[k + 1] - pts[0])) * 0.5
        codes = [f[lab] for f in fs]
        if all(all(bag[v.index] for v in f.verts) for f in fs[:20]):
            kind = "bag"
        elif max(set(codes), key=codes.count) == 7:
            kind = "nose"
        elif max(set(codes), key=codes.count) == 8:
            kind = "ear"
        elif sum(1 for i in isl if i in face_f) > 0.5 * len(isl):
            kind = "face"
        else:
            kind = "scalp"
        k = math.sqrt(ISLAND_WEIGHT[kind] * a3 / max(a2, 1e-12))
        cen = sum((l[uv].uv for f in fs for l in f.loops), Vector((0, 0))) / sum(len(f.loops) for f in fs)
        for f in fs:
            for l in f.loops:
                l[uv].uv = cen + (l[uv].uv - cen) * k * 0.05
    bm.to_mesh(me)
    bm.free()


# ------------------------------------------------------------------------------------------------ eyes, cornea, lashes
def _mesh(name, V, faces, uv=None, mat=None):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(map(float, v)) for v in V], [], [tuple(int(i) for i in f) for f in faces])
    me.update()
    for p in me.polygons:
        p.use_smooth = True
    if uv is not None:
        l = me.uv_layers.new(name="UVMap")
        for p in me.polygons:
            for li, vi in zip(p.loop_indices, p.vertices):
                l.data[li].uv = tuple(uv[vi])
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    if mat is not None:
        for m in (mat if isinstance(mat, (list, tuple)) else [mat]):
            me.materials.append(m)
    return ob


def _keys_follow(ob, V0, per_key):
    ob.shape_key_add(name="Basis", from_mix=False)
    for name, D in per_key:
        if np.abs(D).max() < 1e-7:
            continue
        sk = ob.shape_key_add(name=name, from_mix=False)
        sk.slider_min, sk.slider_max = 0.0, 1.0
        sk.data.foreach_set('co', (V0 + D).astype(np.float32).ravel())


def _skin(ob, arm, groups):
    for bn, idx_w in groups.items():
        vg = ob.vertex_groups.new(name=bn)
        for i, w in idx_w:
            vg.add([int(i)], float(w), 'REPLACE')
    ob.parent = arm
    m = ob.modifiers.new("Armature", 'ARMATURE')
    m.object = arm


def make_eye_hd(arm, side, FS, eyes_R, DELTAS, all_shapes, expr_shapes, mats):
    """Part_Eye_<s> (sclera + iris, materials Eye) and Part_Cornea_<s> (material Cornea)."""
    sd = "L" if side == 0 else "R"
    sx = 1 if side == 0 else -1
    cm = FS["centres"][side]
    rm = FS["radii"][side]
    Ef = eyes_R[side]["Vf"]
    cf = Ef.mean(axis=0)
    rf = float(Ef[:, 2].max() - Ef[:, 2].min()) / 2
    margin = FS["F"]["lids"][side]["margin"]
    out = []
    for kind in ("eye", "cornea"):
        if kind == "eye":
            Vm, faces, uv, reg = fr.eyeball(cm, rm, sx)
            Vf, _, _, _ = fr.eyeball(cf, rf, sx)
            ob = _mesh(f"Part_Eye_{sd}", Vm, faces, uv, mats["Eye"])
        else:
            Vm, faces, uv = fr.cornea(cm, rm, sx)
            Vf, _, _ = fr.cornea(cf, rf, sx)
            ob = _mesh(f"Part_Cornea_{sd}", Vm, faces, uv, mats["Cornea"])
        keys = []
        for name in all_shapes:
            if name in expr_shapes:
                continue
            if name == "Sex":
                D = Vf - Vm
            elif name == "Eye_Big":
                D = (Vm - cm) * 0.16 + DELTAS[name][margin].mean(axis=0) * 0.0
            else:
                D = np.tile(DELTAS[name][margin].mean(axis=0), (len(Vm), 1))
            keys.append((name, D))
        _keys_follow(ob, Vm, keys)
        _skin(ob, arm, {("LeftEye" if side == 0 else "RightEye"): [(i, 1.0) for i in range(len(Vm))]})
        out.append(ob)
    return out


def follow_roots(Vc, roots, c, Vhead, D):
    """deltas for card vertices that hang from head vertices `roots`: rotate about the eye's x axis by the root's elevation
    change, then translate by the residual (works for blink, squint and every face shape)."""
    rel = Vc - c
    r0 = Vhead[roots] - c
    r1 = r0 + D[roots]
    a0 = np.arctan2(r0[:, 2], -r0[:, 1])
    a1 = np.arctan2(r1[:, 2], -r1[:, 1])
    da = a1 - a0
    rot = fr.rot_x(rel, da)
    rot_r0 = fr.rot_x(r0, da)
    return (rot + (r1 - rot_r0)) - rel


def lash_geometry(FS, Vhead, style=None):
    """V, faces, uv, roots, eye index for the lash cards of both eyes (upper + lower)."""
    st = dict(up_len=0.0068, up_curl=0.45, lo_len=0.0030, lo_curl=0.10, rows=4, spread=1.0)
    if style:
        st.update(style)
    Vs, Fs, UVs, Rs, Es = [], [], [], [], []
    off = 0
    for side, L in enumerate(FS["F"]["lids"]):
        for lid, ln, cu in (("upper", st["up_len"], st["up_curl"]), ("lower", st["lo_len"], st["lo_curl"])):
            if ln <= 0:
                continue
            V, faces, uv, roots, t = fr.lash_card(Vhead, L["frame"], lid, length=ln, curl=cu, n_rows=st["rows"], spread=st["spread"])
            # UV: upper lashes in the top half of the lash texture, lower lashes in the bottom half
            uv = uv.copy()
            uv[:, 1] = (0.5 + 0.5 * uv[:, 1]) if lid == "upper" else (0.5 * uv[:, 1])
            if side == 1:
                uv[:, 0] = uv[:, 0]
            Vs.append(V)
            Fs += [tuple(i + off for i in f) for f in faces]
            UVs.append(uv)
            Rs.append(roots)
            Es.append(np.full(len(V), side))
            off += len(V)
    return np.concatenate(Vs), Fs, np.concatenate(UVs), np.concatenate(Rs), np.concatenate(Es)


def make_lashes(arm, name, FS, Vhead, DELTAS, all_shapes, W_rows, bone_names, mat, style=None):
    V, faces, uv, roots, eye = lash_geometry(FS, Vhead, style)
    ob = _mesh(name, V, faces, uv, mat)
    keys = []
    for k in all_shapes:
        D = DELTAS[k]
        out = np.zeros_like(V)
        for side in (0, 1):
            sel = eye == side
            out[sel] = follow_roots(V[sel], roots[sel], FS["centres"][side], Vhead, D)
        keys.append((k, out))
    _keys_follow(ob, V, keys)
    groups = {}
    for i, rt in enumerate(roots):
        row = W_rows[rt]
        for j in np.nonzero(row > 1e-4)[0]:
            groups.setdefault(bone_names[j], []).append((i, row[j]))
    _skin(ob, arm, groups)
    return ob


REST_LID = dict(close_up=0.16, close_lo=0.06)      # Gate 1: heavy upper lid over the top of the iris
# eyelash card styles (Part_Lashes = natural; Part_Lashes_<Style> variants in the base FBX); texture export/textures/lashes/lashes_<style>.png
LASH_STYLES = {
    "natural": {}, "full": dict(up_len=0.0078, lo_len=0.0034), "sparse": dict(up_len=0.0058, lo_len=0.0022),
    "long": dict(up_len=0.0092, up_curl=0.55, lo_len=0.0036), "wing": dict(up_len=0.0075, spread=1.8),
    "short": dict(up_len=0.0045, lo_len=0.0018, up_curl=0.3),
}      # relaxed lids: upper lid covers the top of the iris (art reference)


def rest_lids(R, lm):
    """bake a relaxed lid pose into the shared basis (male and female) before anything else is built."""
    out = {}
    for key, eyes_key in (("Vm", "Vm"), ("Vf", "Vf")):
        V = R[key]
        T = fr.Topo(V, R["tris"], list(R["part"]), HEAD_PARTS)
        centres = [R["eyes"][s][eyes_key].mean(axis=0) for s in (0, 1)]
        radii = [float(R["eyes"][s][eyes_key][:, 2].max() - R["eyes"][s][eyes_key][:, 2].min()) / 2 for s in (0, 1)]
        D = np.zeros_like(V)
        for L in fr._find_lids(T, centres, radii):
            D += fr.lid_deltas(V, T.used, fr.lid_frames(V, L), **REST_LID)
        R[key] = V + D
        out[key] = float(np.abs(D).max())
    return out
