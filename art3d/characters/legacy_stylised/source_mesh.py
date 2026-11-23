"""Step 1 of build_base: read the Blender Studio stylised male/female bodies (CC0), proportion them to the art direction,
decimate per body part with locked part boundaries and map one shared topology onto both sexes.

Everything here is numpy + a little bmesh/bpy; no scene state is kept.
"""
import bpy, bmesh, os, math
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree
from mathutils.interpolate import poly_3d_calc

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "source", "human_base_stylized.blend")

# artist face-set id -> part (face sets are shared by the left and right side)
PART_OF_SET = {}
for s in (6, 44, 27, 28, 37, 46, 47, 48, 49):
    PART_OF_SET[s] = "head"          # neck + skull + face (cut at the base of the neck)
PART_OF_SET[29] = "ears"
PART_OF_SET[45] = "nose"
for s in (258, 259, 260):
    PART_OF_SET[s] = "torso"         # pelvis, abdomen/chest, shoulder caps
for s in (262, 263):
    PART_OF_SET[s] = "arms"
for s in [273, 359] + list(range(272, 287)):
    PART_OF_SET[s] = "hands"
for s in (256, 257):
    PART_OF_SET[s] = "legs"
for s in [288] + list(range(316, 323)):
    PART_OF_SET[s] = "feet"

# phalange face sets of one hand (proximal, intermediate, distal) per finger; thumb uses the metacarpal set first
FINGER_SETS = {
    "Index": (278, 283, 282), "Middle": (277, 279, 272), "Ring": (280, 274, 275), "Little": (281, 286, 276),
    "Thumb": (359, 285, 284),
}
PALM_SET = 273
TOE_SETS = tuple(range(317, 323))

# fraction of body height for the landmarks (from the target proportions: 7+ heads, long legs, slender neck)
FRAC = {"ankle": 0.052, "knee": 0.286, "hip": 0.503, "neck_base": 0.811, "chin": 0.860}
# per-sex overrides (2026-11 reference comparison): masculine head to 7.5 heads tall (the feminine source already measures ~7.8)
FRAC_SEX = {"male": {"chin": 0.8667, "neck_base": 0.815}, "female": {}}
HAND_SCALE = 0.90        # slender hands: hands were 0.91 head heights wrist-to-fingertip, the reference reads about 0.8
# decimation ratio (output tris / input tris) per part
# head, nose and ears keep the artist's full-resolution quads (ratio 1.0 = no decimation): open lips with the mouth cavity,
# eyelid folds, lid crease, nostrils and the ear helix all survive (2026-11 face rework; 0.62 used to seal the lips)
RATIO = {"head": 1.0, "ears": 1.0, "nose": 1.0, "torso": 0.46, "arms": 0.50, "hands": 0.60, "legs": 0.42, "feet": 0.52}
EYE_RATIO = 0.22


def load_source():
    bpy.ops.wm.open_mainfile(filepath=SRC)
    out = {}
    for sex in ("male", "female"):
        o = bpy.data.objects[f"GEO-body_{sex}_stylized"]
        me = o.data
        P = np.array([(o.matrix_world @ v.co)[:] for v in me.vertices], dtype=np.float64)
        F = [tuple(p.vertices) for p in me.polygons]
        ids = np.array([d.value for d in me.attributes[".sculpt_face_set"].data])
        eyes = []
        for s in "LR":
            e = bpy.data.objects[f"GEO-body_{sex}_stylized.eye.{s}"]
            eyes.append((np.array([(e.matrix_world @ v.co)[:] for v in e.data.vertices], dtype=np.float64),
                         [tuple(p.vertices) for p in e.data.polygons]))
        cx = 0.5 * (P[:, 0].min() + P[:, 0].max())
        P[:, 0] -= cx
        for E, _ in eyes:
            E[:, 0] -= cx
        out[sex] = dict(P=P, F=F, ids=ids, eyes=eyes)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    return out


def verts_of(F, ids, sets):
    s = set()
    sets = set(sets)
    for f, k in zip(F, ids):
        if k in sets:
            s.update(f)
    return s


def boundary(F, ids, a, b):
    return verts_of(F, ids, a) & verts_of(F, ids, b)


def landmarks(P, F, ids, eyes):
    """Joint / landmark positions of one (possibly warped) body. Left side = +X. Returns dict of np arrays."""
    L = lambda vs: [v for v in vs if P[v, 0] > 0]
    cen = lambda vs: P[list(vs)].mean(axis=0)
    head_sets = [s for s, p in PART_OF_SET.items() if p in ("head", "ears", "nose") and s != 6]
    hv = list(verts_of(F, ids, head_sets))
    lm = {}
    lm["sole"] = float(P[:, 2].min())
    lm["top"] = float(P[:, 2].max())
    lm["chin"] = float(P[hv, 2].min())
    lm["neck_base"] = cen(boundary(F, ids, [6], [258, 259, 260]))
    lm["neck_top"] = cen(boundary(F, ids, [6], head_sets))
    lm["shoulder_b"] = cen(L(boundary(F, ids, [260], [263])))     # seam between shoulder cap and upper arm
    lm["elbow"] = cen(L(boundary(F, ids, [263], [262])))
    lm["wrist"] = cen(L(boundary(F, ids, [262], [273])))
    lm["hip_b"] = cen(L(boundary(F, ids, [258], [256])))           # seam between pelvis and thigh
    lm["knee"] = cen(L(boundary(F, ids, [256], [257])))
    lm["ankle_b"] = cen(L(boundary(F, ids, [257], [288])))
    lm["ball"] = cen(L(boundary(F, ids, [316], list(TOE_SETS))))
    toe_v = L(verts_of(F, ids, TOE_SETS))
    lm["toe_tip"] = P[toe_v][np.argmin(P[toe_v][:, 1])]
    lm["eye"] = 0.5 * (eyes[0][0].mean(axis=0) + eyes[1][0].mean(axis=0) * np.array([-1, 1, 1]))
    lm["eye_x"] = float(eyes[0][0].mean(axis=0)[0])
    lm["eye_r"] = float(0.5 * (eyes[0][0][:, 2].max() - eyes[0][0][:, 2].min()))
    lm["ear"] = cen(L(verts_of(F, ids, [29])))
    nose_v = list(verts_of(F, ids, [45]))
    lm["nose"] = cen(nose_v)
    lm["nose_tip"] = P[nose_v][np.argmin(P[nose_v][:, 1])]
    # head width / centre
    hvl = np.array(hv)
    lm["head_half_w"] = float(np.abs(P[hvl, 0]).max())
    lm["head_c"] = cen(hv)
    lm["chin_front"] = P[hvl][np.argmin(P[hvl][:, 2] + 0.02 * P[hvl][:, 1])]
    lm["height"] = lm["top"] - lm["sole"]
    # hand/finger joints
    palm_b = {}
    for fname, sets in FINGER_SETS.items():
        pts = []
        prev = [PALM_SET]
        for i, s in enumerate(sets):
            b = L(boundary(F, ids, prev, [s]))
            pts.append(cen(b))
            prev = [s]
        last = L(verts_of(F, ids, [sets[-1]]))
        # tip: vertex of the distal set farthest from the last joint
        d = np.linalg.norm(P[last] - pts[-1], axis=1)
        pts.append(P[last][np.argmax(d)])
        lm["finger_" + fname] = np.array(pts)           # 3 joints + tip
    lm["palm_end"] = cen(L(boundary(F, ids, [PALM_SET], [s for k in ("Index", "Middle", "Ring", "Little") for s in FINGER_SETS[k][:1]])))
    return lm


def make_warp(lm, H, sex):
    """Return f(P) -> P' that proportions the body: piecewise-linear z map through the landmarks, head and neck scaled in x/y."""
    zs = [lm["sole"], lm["ankle_b"][2] - 0.03, lm["knee"][2], lm["hip_b"][2], lm["neck_base"][2], lm["chin"], lm["top"]]
    fr = dict(FRAC, **FRAC_SEX.get(sex, {}))
    zt = [0.0, fr["ankle"] * H, fr["knee"] * H, fr["hip"] * H, fr["neck_base"] * H, fr["chin"] * H, H]
    head_scale = (H - fr["chin"] * H) / (lm["top"] - lm["chin"])
    yc = lm["head_c"][1]
    zs_a, zt_a = np.array(zs), np.array(zt)

    def S(a, b, x):
        t = np.clip((x - a) / (b - a), 0, 1)
        return t * t * (3 - 2 * t)

    def warp(P):
        P = P.copy()
        z = P[:, 2]
        s = 1 + (head_scale - 1) * S(lm["neck_base"][2], lm["chin"] + 0.01, z)
        P[:, 0] *= s
        P[:, 1] = yc + (P[:, 1] - yc) * s
        P[:, 2] = np.interp(z, zs_a, zt_a)
        return P
    warp.head_scale = head_scale
    warp.zs, warp.zt = zs_a, zt_a
    return warp


def scale_hands(P, lm, k, hand_v):
    """scale both hands about the wrist (smooth ramp starting at the wrist seam so the arm part is untouched)."""
    P = P.copy()
    for sx in (1, -1):
        wr = lm["wrist"] * np.array([sx, 1, 1])
        el = lm["elbow"] * np.array([sx, 1, 1])
        ax = (wr - el) / np.linalg.norm(wr - el)
        t = (P - wr) @ ax                                   # distance past the wrist along the forearm axis
        side = np.zeros(len(P), bool)
        side[hand_v] = True
        side &= (P[:, 0] * sx) > 0.05
        w = np.clip(t / 0.03, 0, 1)
        w = w * w * (3 - 2 * w) * side
        P += ((wr + (P - wr) * k) - P) * w[:, None]
    return P


def tri_list(F):
    T = []
    for f in F:
        for i in range(1, len(f) - 1):
            T.append((f[0], f[i], f[i + 1]))
    return T


def decimate_part(P, F, keep_faces, ratio, lock_verts):
    """Decimate a face subset with the vertices in lock_verts untouched. Returns (V, polys).  ratio >= 1 keeps the faces."""
    if ratio >= 1.0:
        used = sorted({v for fi in keep_faces for v in F[fi]})
        rm = {v: i for i, v in enumerate(used)}
        return P[used].astype(np.float32).astype(np.float64), [tuple(rm[v] for v in F[fi]) for fi in keep_faces]  # float32 like Blender
    bm = bmesh.new()
    vmap = {}
    for fi in keep_faces:
        for v in F[fi]:
            if v not in vmap:
                vmap[v] = bm.verts.new(P[v])
    bm.verts.ensure_lookup_table()
    for fi in keep_faces:
        bm.faces.new([vmap[v] for v in F[fi]])
    me = bpy.data.meshes.new("dec")
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new("dec", me)
    bpy.context.collection.objects.link(ob)
    vg = ob.vertex_groups.new(name="w")
    inv = {i: v for i, (v, _) in enumerate(vmap.items())}
    keys = list(vmap.keys())
    allv = list(range(len(keys)))
    vg.add(allv, 1.0, 'REPLACE')
    lock = [i for i, v in enumerate(keys) if v in lock_verts]
    vg.add(lock, 0.0, 'REPLACE')
    md = ob.modifiers.new("d", 'DECIMATE')
    md.ratio = ratio
    md.vertex_group = "w"
    md.vertex_group_factor = 1.0
    dg = bpy.context.evaluated_depsgraph_get()
    ev = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    V = np.array([v.co[:] for v in ev.vertices], dtype=np.float64)
    T = [tuple(p.vertices) for p in ev.polygons]
    bpy.data.objects.remove(ob)
    bpy.data.meshes.remove(me)
    bpy.data.meshes.remove(ev)
    return V, T


def build_shared(src):
    """Warp both sexes, decimate the male per part (boundaries locked), map the same topology onto the female.

    Returns dict: V_male (N,3), V_female (N,3), tris (list), part (per tri), eyes (per side: V_m, V_f, tris), lm_male, lm_female.
    """
    heights = {"male": 1.75, "female": 1.65}
    warped = {}
    lms = {}
    for sex in ("male", "female"):
        d = src[sex]
        lm0 = landmarks(d["P"], d["F"], d["ids"], d["eyes"])
        w = make_warp(lm0, heights[sex], sex)
        P = w(d["P"])
        eyes = [(w(E), Fe) for E, Fe in d["eyes"]]
        hand_v = np.array(sorted(verts_of(d["F"], d["ids"], [k for k, p in PART_OF_SET.items() if p == "hands"])))
        P = scale_hands(P, landmarks(P, d["F"], d["ids"], eyes), HAND_SCALE, hand_v)
        lms[sex] = landmarks(P, d["F"], d["ids"], eyes)
        warped[sex] = dict(P=P, F=d["F"], ids=d["ids"], eyes=eyes, warp=w)
    M, Fm = warped["male"]["P"], warped["male"]["F"]
    ids = warped["male"]["ids"]
    part_of_face = np.array([PART_OF_SET[k] for k in ids])
    parts = sorted(set(part_of_face.tolist()))
    # vertices shared between parts are locked
    vert_parts = {}
    for fi, f in enumerate(Fm):
        for v in f:
            vert_parts.setdefault(v, set()).add(part_of_face[fi])
    lock = {v for v, ps in vert_parts.items() if len(ps) > 1}
    Vs, Ts, Ps = [], [], []
    keymap = {}
    gverts = []

    def gid(p):
        k = (round(p[0], 6), round(p[1], 6), round(p[2], 6))
        if k not in keymap:
            keymap[k] = len(gverts)
            gverts.append(p)
        return keymap[k]
    tris, tpart = [], []
    for part in parts:
        keep = [i for i, p in enumerate(part_of_face) if p == part]
        V, T = decimate_part(M, Fm, keep, RATIO[part], lock)
        for t in T:
            tris.append(tuple(gid(V[i]) for i in t))
            tpart.append(part)
    Vm = np.array(gverts)
    # map onto the female through barycentric coordinates on the original (undecimated) male triangulation
    T0 = tri_list(Fm)
    tree = BVHTree.FromPolygons([Vector(p) for p in M], T0)
    Pf = warped["female"]["P"]
    Vf = np.zeros_like(Vm)
    from mathutils.kdtree import KDTree
    kd = KDTree(len(M))
    for i, p in enumerate(M):
        kd.insert(Vector(p), i)
    kd.balance()
    for i, p in enumerate(Vm):
        _, j, dd = kd.find(Vector(p))
        if dd < 1e-6:                       # an original vertex (all of the undecimated head): exact copy
            Vf[i] = Pf[j]
            continue
        loc, nrm, ti, dist = tree.find_nearest(Vector(p))
        a, b, c = T0[ti]
        w = poly_3d_calc([Vector(M[a]), Vector(M[b]), Vector(M[c])], loc)
        Vf[i] = w[0] * Pf[a] + w[1] * Pf[b] + w[2] * Pf[c]
    # eyeballs: same trick on each eyeball
    eyes_out = []
    for side in range(2):
        Em, Fe = warped["male"]["eyes"][side]
        Ef, _ = warped["female"]["eyes"][side]
        V, T = decimate_part(Em, Fe, list(range(len(Fe))), EYE_RATIO, set())
        T0e = tri_list(Fe)
        tr = BVHTree.FromPolygons([Vector(p) for p in Em], T0e)
        Vef = np.zeros_like(V)
        for i, p in enumerate(V):
            loc, nrm, ti, dist = tr.find_nearest(Vector(p))
            a, b, c = T0e[ti]
            w = poly_3d_calc([Vector(Em[a]), Vector(Em[b]), Vector(Em[c])], loc)
            Vef[i] = w[0] * Ef[a] + w[1] * Ef[b] + w[2] * Ef[c]
        eyes_out.append(dict(Vm=V, Vf=Vef, tris=T))
    return dict(Vm=Vm, Vf=Vf, tris=tris, part=np.array(tpart), eyes=eyes_out, lm_male=lms["male"], lm_female=lms["female"],
                warp_male=warped["male"]["warp"], heights=heights)
