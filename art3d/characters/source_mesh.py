"""Step 1 of build_base (G9 rebase): read the Blender Studio REALISTIC male/female bodies (CC0, Human Base Meshes v1.4.1:
GEO-body_male_realistic / GEO-body_female_realistic, identical topology, 102 sculpt face sets), proportion them to the targets of
roadmap/game/plans/g9-characters-face-body-plan.md (8.2 / 8.0 heads, crotch 0.485 / 0.480, knee 0.275 / 0.272, neck, arm
hang, hand length), run the stylise pass (stylise.py) on the full-resolution neutral of each sex, then decimate per body part
with locked part boundaries and map ONE shared topology onto both sexes (Sex = female - male, exact).

Everything here is numpy + a little bmesh/bpy; no scene state is kept.
"""
import bpy, bmesh, os, math
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree
from mathutils.interpolate import poly_3d_calc

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "source", "human_base_realistic.blend")

# face-set id -> part (sets are per side on the realistic bodies; ids measured on the female, identical on the male)
PART_OF_SET = {}
for s in (17, 2, 3, 8, 22):
    PART_OF_SET[s] = "head"          # head and neck (17), eye surrounds (2 L, 3 R), lips (8), inner mouth (22)
PART_OF_SET[7] = "nose"
PART_OF_SET[4] = PART_OF_SET[5] = "ears"
for s in (1, 19, 18):
    PART_OF_SET[s] = "torso"         # chest + shoulders, abdomen, pelvis
for s in (20, 21, 11, 12):
    PART_OF_SET[s] = "arms"          # upper arms (21 L, 20 R), forearms (12 L, 11 R)
for s in [9, 10] + list(range(64, 104)):
    PART_OF_SET[s] = "hands"         # palms (9 L, 10 R), phalanges and nails
for s in (23, 24, 15, 16):
    PART_OF_SET[s] = "legs"          # thighs (24 L, 23 R), shins (15 L, 16 R)
for s in [13, 14] + list(range(25, 64)):
    PART_OF_SET[s] = "feet"          # feet (14 L, 13 R), soles and toes
HEAD_SETS = (17, 2, 3, 8, 22, 7, 4, 5)
# left side (+X) sets used for the landmarks (right side mirrored)
L_SETS = dict(upper_arm=21, forearm=12, palm=9, thigh=24, shin=15, foot=14, eye_surround=2, ear=4,
              toes=tuple(range(46, 64)) + (25,))
FINGER_SETS = {       # proximal, intermediate, distal (+ nail) of the left hand, ordered from the palm
    "Index": (76, 77, 78, 79), "Middle": (72, 73, 74, 75), "Ring": (68, 69, 70, 71), "Little": (64, 65, 66, 67),
    "Thumb": (80, 81, 82, 83)}
PALM_SET = 9
TORSO_SETS = (1, 19, 18)

# proportion targets (G9 plan WP2): heights and the 8-head canon with slightly long legs
TARGET = {"male": dict(H=1.78, heads=8.0, crotch=0.480, knee=0.272, neck=0.32, hand=0.80),
          "female": dict(H=1.65, heads=8.2, crotch=0.485, knee=0.275, neck=0.36, hand=0.76)}
# decimation ratio (output tris / input tris) per part; head, nose, ears keep the full scan topology (lids, lips, inner mouth)
RATIO = {"head": 1.0, "ears": 1.0, "nose": 1.0, "torso": 1.0, "arms": 0.69, "hands": 0.93, "legs": 1.0, "feet": 0.33}
EYE_RATIO = 0.45


def load_source():
    bpy.ops.wm.open_mainfile(filepath=SRC)
    out = {}
    for sex in ("male", "female"):
        o = bpy.data.objects[f"GEO-body_{sex}_realistic"]
        me = o.data                                     # base level (Multires not applied)
        P = np.array([(o.matrix_world @ v.co)[:] for v in me.vertices], dtype=np.float64)
        F = [tuple(p.vertices) for p in bpy.data.objects["GEO-body_male_realistic"].data.polygons]   # one face list (male order)
        ids = np.array([d.value for d in bpy.data.objects["GEO-body_male_realistic"].data.attributes[".sculpt_face_set"].data])
        if sex == "female":
            Ff = [frozenset(p.vertices) for p in me.polygons]
            assert all(frozenset(a) == b for a, b in zip(F, Ff)), "male/female realistic topology differs"
        eyes = []
        for s in "LR":
            e = bpy.data.objects[f"GEO-body_{sex}_realistic.eye.{s}"]
            eyes.append((np.array([(e.matrix_world @ v.co)[:] for v in e.data.vertices], dtype=np.float64),
                         [tuple(p.vertices) for p in e.data.polygons]))
        cx = 0.5 * (P[:, 0].min() + P[:, 0].max())
        P[:, 0] -= cx
        for E, _ in eyes:
            E[:, 0] -= cx
        out[sex] = dict(P=P, F=F, ids=ids, eyes=eyes)
    # symmetrise both scans with one mirror-partner map (left/right identical; midline vertices on x = 0)
    mir = mirror_map(out["male"]["P"], out["male"]["F"])
    for sex in ("male", "female"):
        d = out[sex]
        P = d["P"]
        Q = P[mir] * np.array([-1, 1, 1])
        d["P"] = 0.5 * (P + Q)
        d["P"][mir == np.arange(len(P)), 0] = 0.0
        E0, E1 = d["eyes"][0][0], d["eyes"][1][0]
        if len(E0) == len(E1):
            m0 = 0.5 * (E0.mean(axis=0) + E1.mean(axis=0) * np.array([-1, 1, 1]))
            for k, (E, Fe) in enumerate(d["eyes"]):
                sgn = 1 if k == 0 else -1
                E += (m0 * np.array([sgn, 1, 1])) - E.mean(axis=0)
        d["mirror"] = mir
    split_lips(out)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    return out


def mirror_map(P, F):
    """index of the mirror partner of every vertex (nearest to the reflected position, refined by greedy unique matching)."""
    from mathutils.kdtree import KDTree
    kd = KDTree(len(P))
    for i, p in enumerate(P):
        kd.insert(Vector(p), i)
    kd.balance()
    mir = np.empty(len(P), int)
    dist = np.empty(len(P))
    for i, p in enumerate(P):
        _, j, d = kd.find(Vector((-p[0], p[1], p[2])))
        mir[i], dist[i] = j, d
    bad = int(np.sum(mir[mir] != np.arange(len(P))))
    print(f"mirror map: max partner distance {dist.max()*1000:.1f} mm, non-reciprocal {bad}")
    # non-reciprocal pairs: keep the reciprocal partner where possible, else treat as self (snapped to the midline only if |x| small)
    for i in np.nonzero(mir[mir] != np.arange(len(P)))[0]:
        if abs(P[i, 0]) < 0.002:
            mir[i] = i
    return mir


SPLIT_COUNT = [0]
SPLIT_INFO = {}


def split_lips(out):
    """The scan's lips touch along the lower lip's inner edge (border of face sets 22 = lower lip/chin/jaw and 8 = inner
    mouth); that border also climbs up and back inside the cheeks at its ends.  Cut a slit along its visible, nearly level
    part (within 8 mm of the midline contact height): duplicate the interior vertices and hand the copies to the faces below
    the line, so the Jaw opens the mouth.  The segment's ends are the visible mouth corners.  Same cut on both sexes."""
    d0 = out["male"]
    P, F, ids = d0["P"], d0["F"], d0["ids"]
    border = sorted(boundary(F, ids, [8], [22]))
    zc = float(P[[v for v in border if abs(P[v, 0]) < 0.002], 2].mean())
    line = [v for v in border if P[v, 2] < zc + 0.008]
    xs = P[line, 0]
    corners = {line[int(np.argmin(xs))], line[int(np.argmax(xs))]}
    inner = [v for v in line if v not in corners]
    order = np.argsort(P[line, 0])
    lx, lz = P[line, 0][order], P[line, 2][order]
    n0 = len(P)
    dup = {v: n0 + k for k, v in enumerate(inner)}
    inner_set = set(inner)
    newF, moved = [], 0
    for f in F:
        if inner_set & set(f):
            c = P[list(f)].mean(axis=0)
            if c[2] < np.interp(c[0], lx, lz) - 1e-6:
                f = tuple(dup.get(v, v) for v in f)
                moved += 1
        newF.append(f)
    for sex in ("male", "female"):
        d = out[sex]
        d["P"] = np.vstack([d["P"], d["P"][inner]])
        d["F"] = newF
        mir = d["mirror"]
        mext = np.concatenate([mir, np.zeros(len(inner), int)])
        for v, nv in dup.items():
            mext[nv] = dup.get(mir[v], mir[v])
        d["mirror"] = mext
    SPLIT_COUNT[0] = len(inner)
    SPLIT_INFO.update(upper=list(inner), lower=[dup[v] for v in inner], corners=sorted(corners))
    print(f"lip slit: {len(line)} vertices of {len(border)} ({len(inner)} split), corners x {P[sorted(corners), 0].round(4).tolist()}, "
          f"{moved} faces moved to the lower side")


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
    """Joint / landmark positions of one (possibly warped) body. Left side = +X. Returns dict of np arrays / floats."""
    L = lambda vs: [v for v in vs if P[v, 0] > 0]
    cen = lambda vs: P[list(vs)].mean(axis=0)
    hv = np.array(sorted(verts_of(F, ids, HEAD_SETS)))
    lm = {}
    lm["sole"] = float(P[:, 2].min())
    lm["top"] = float(P[:, 2].max())
    mouth = np.array(sorted(verts_of(F, ids, [8])))
    lm["mouth"] = cen(mouth)
    mid = hv[np.abs(P[hv, 0]) < 0.004]
    # chin: lowest midline point of the face under the mouth before the throat turns back
    below = mid[(P[mid, 2] < lm["mouth"][2] - 0.01) & (P[mid, 2] > lm["mouth"][2] - 0.09)]
    pog = below[np.argmin(P[below, 1])]                       # most forward point of the chin
    cand = below[P[below, 1] < P[pog, 1] + 0.025]
    lm["chin"] = float(P[cand, 2].min())
    lm["chin_front"] = P[pog]
    torso_v = verts_of(F, ids, TORSO_SETS)
    lm["neck_base"] = cen(verts_of(F, ids, [17]) & torso_v)
    nb = sorted(verts_of(F, ids, [17]) & torso_v)
    nbm = [v for v in nb if abs(P[v, 0]) < 0.006] or nb
    lm["sternal_notch"] = P[nbm][np.argmin(P[nbm, 1])]
    neck = hv[(np.abs(P[hv, 2] - (lm["chin"] - 0.012)) < 0.006) & (np.abs(P[hv, 0]) < 0.07)]
    lm["neck_top"] = np.array([0.0, P[neck, 1].mean(), lm["chin"] - 0.012])
    lm["shoulder_b"] = cen(L(boundary(F, ids, TORSO_SETS, [L_SETS["upper_arm"]])))
    lm["elbow"] = cen(L(boundary(F, ids, [L_SETS["upper_arm"]], [L_SETS["forearm"]])))
    lm["wrist"] = cen(L(boundary(F, ids, [L_SETS["forearm"]], [PALM_SET])))
    lm["hip_b"] = cen(L(boundary(F, ids, [18], [L_SETS["thigh"]])))
    tv = np.array(sorted(torso_v))
    lm["crotch"] = float(P[tv[np.abs(P[tv, 0]) < 0.004], 2].min())
    lm["knee"] = cen(L(boundary(F, ids, [L_SETS["thigh"]], [L_SETS["shin"]])))
    lm["ankle_b"] = cen(L(boundary(F, ids, [L_SETS["shin"]], [L_SETS["foot"]])))
    lm["ball"] = cen(L(boundary(F, ids, [L_SETS["foot"]], list(L_SETS["toes"]))) or L(verts_of(F, ids, list(L_SETS["toes"]))))
    toe_v = L(verts_of(F, ids, L_SETS["toes"]))
    lm["toe_tip"] = P[toe_v][np.argmin(P[toe_v][:, 1])]
    lm["eye"] = 0.5 * (eyes[0][0].mean(axis=0) + eyes[1][0].mean(axis=0) * np.array([-1, 1, 1]))
    lm["eye_x"] = float(eyes[0][0].mean(axis=0)[0])
    lm["eye_r"] = float(0.5 * (eyes[0][0][:, 2].max() - eyes[0][0][:, 2].min()))
    lm["ear"] = cen(L(verts_of(F, ids, [L_SETS["ear"]])))
    nose_v = list(verts_of(F, ids, [7]))
    lm["nose"] = cen(nose_v)
    lm["nose_tip"] = P[nose_v][np.argmin(P[nose_v][:, 1])]
    # subnasale: deepest (most posterior) midline point of the nose part below the tip (the scan's nose set runs down the
    # philtrum, so its lowest vertex is not the nose base)
    # subnasale = the nose/lip face-set border on the midline (lowest front vertex of the nose part; the nose set also lines
    # the nasal cavity, so only its front 4 cm count)
    nm = [v for v in nose_v if abs(P[v, 0]) < 0.004 and P[v, 1] < lm["nose_tip"][1] + 0.04]
    lm["subnasale"] = P[nm][np.argmin(P[nm, 2])] if nm else lm["nose_tip"]
    skull = hv[(P[hv, 2] > lm["chin"] + 0.06)]
    ears = verts_of(F, ids, [4, 5])
    skull = np.array([v for v in skull if v not in ears])
    lm["head_half_w"] = float(np.abs(P[skull, 0]).max())
    hc = hv[P[hv, 2] > lm["chin"]]
    lm["head_c"] = cen(hc)
    lm["height"] = lm["top"] - lm["sole"]
    lm["head_h"] = lm["top"] - lm["chin"]
    for fname, sets in FINGER_SETS.items():
        pts = []
        prev = [PALM_SET]
        for s in sets[:3]:
            b = L(boundary(F, ids, prev, [s]))
            pts.append(cen(b))
            prev = [s]
        last = L(verts_of(F, ids, list(sets[2:])))
        d = np.linalg.norm(P[last] - pts[-1], axis=1)
        pts.append(P[last][np.argmax(d)])
        lm["finger_" + fname] = np.array(pts)
    lm["palm_end"] = cen(L(boundary(F, ids, [PALM_SET], [FINGER_SETS[k][0] for k in ("Index", "Middle", "Ring", "Little")])))
    lm["pivot"] = lm["shoulder_b"] - (lm["elbow"] - lm["shoulder_b"]) / np.linalg.norm(lm["elbow"] - lm["shoulder_b"]) * 0.07
    return lm


def S(a, b, x):
    t = np.clip((np.asarray(x, float) - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def make_warp(lm, sex):
    """f(P) -> P': piecewise-linear z map through sole, ankle, knee, crotch, neck base (sternal notch), chin, top to the targets;
    head and neck scaled in x/y with the head; body x/y untouched (widths come from the stylise pass)."""
    t = TARGET[sex]
    H = t["H"]
    hh = H / t["heads"]
    chin_t = H - hh
    neck_t = chin_t - t["neck"] * hh
    zs = [lm["sole"], lm["ankle_b"][2], lm["knee"][2], lm["crotch"], lm["sternal_notch"][2], lm["chin"], lm["top"]]
    ank_frac = (lm["ankle_b"][2] - lm["sole"]) / (lm["knee"][2] - lm["sole"])
    zt = [0.0, ank_frac * t["knee"] * H, t["knee"] * H, t["crotch"] * H, neck_t, chin_t, H]
    head_scale = hh / (lm["top"] - lm["chin"])
    yc = lm["head_c"][1]
    zs_a, zt_a = np.array(zs), np.array(zt)

    def warp(P):
        P = P.copy()
        z = P[:, 2]
        s = 1 + (head_scale - 1) * S(lm["sternal_notch"][2], lm["chin"] + 0.01, z)
        P[:, 0] *= s
        P[:, 1] = yc + (P[:, 1] - yc) * s
        P[:, 2] = np.interp(z, zs_a, zt_a)
        return P
    warp.head_scale = head_scale
    warp.zs, warp.zt = zs_a, zt_a
    return warp


def _axis_scale(P, origin, axis, k, mask, ramp0, ramp1):
    """stretch points along axis about origin by k (only the component along the axis), ramped in by distance along it."""
    t = (P - origin) @ axis
    w = S(ramp0, ramp1, t) * mask
    return P + ((k - 1) * t * w)[:, None] * axis[None, :]


def fit_arms_hands(P, F, ids, eyes, sex):
    """arm length so the wrist hangs level with the crotch, then hand length (wrist to fingertip) to the target."""
    t = TARGET[sex]
    for side in (1, -1):
        lm = landmarks(P, F, ids, eyes)
        mir = np.array([side, 1, 1])
        piv, el, wr = lm["pivot"] * mir, lm["elbow"] * mir, lm["wrist"] * mir
        hang = float(np.linalg.norm(el - piv) + np.linalg.norm(wr - el))
        want = piv[2] - lm["crotch"]
        k = want / hang
        arm_sets = [k_ for k_, p in PART_OF_SET.items() if p in ("arms", "hands")]
        av = np.zeros(len(P), bool)
        av[list(verts_of(F, ids, arm_sets))] = True
        av &= (P[:, 0] * side) > 0.05
        ax = (wr - piv) / np.linalg.norm(wr - piv)
        sh = lm["shoulder_b"] * mir
        P = _axis_scale(P, sh, ax, k, av | (((P[:, 0] * side) > 0.10) & (np.abs(P[:, 2] - sh[2]) < 0.12)), 0.0, 0.06)
    for side in (1, -1):
        lm = landmarks(P, F, ids, eyes)
        mir = np.array([side, 1, 1])
        wr = lm["wrist"] * mir
        hv = np.array(sorted(verts_of(F, ids, [k_ for k_, p in PART_OF_SET.items() if p == "hands"])))
        hv = hv[(P[hv, 0] * side) > 0]
        hl = np.linalg.norm(P[hv] - wr, axis=1).max()
        k = t["hand"] * lm["head_h"] / hl
        m = np.zeros(len(P), bool)
        m[hv] = True
        el = lm["elbow"] * mir
        ax = (wr - el) / np.linalg.norm(wr - el)
        tt = (P - wr) @ ax
        w = S(-0.005, 0.02, tt) * m
        P = P + ((wr + (P - wr) * k) - P) * w[:, None]
    return P


def tri_list(F):
    T = []
    for f in F:
        for i in range(1, len(f) - 1):
            T.append((f[0], f[i], f[i + 1]))
    return T


def decimate_part(P, F, keep_faces, ratio, lock_verts):
    """Decimate a face subset with the vertices in lock_verts untouched. Returns (V, polys).  ratio >= 1 keeps the faces."""
    decimate_part.used = None
    if ratio >= 1.0:
        used = sorted({v for fi in keep_faces for v in F[fi]})
        rm = {v: i for i, v in enumerate(used)}
        decimate_part.used = used
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


STYLISE = None            # set by build_base to stylise.stylise (WP3); None = proportioned scan only


def build_shared(src):
    """Warp both sexes, decimate the male per part (boundaries locked), map the same topology onto the female.

    Returns dict: V_male (N,3), V_female (N,3), tris (list), part (per tri), eyes (per side: V_m, V_f, tris), lm_male, lm_female.
    """
    heights = {s: TARGET[s]["H"] for s in ("male", "female")}
    warped = {}
    lms = {}
    raw = {}
    for sex in ("male", "female"):
        d = src[sex]
        lm0 = landmarks(d["P"], d["F"], d["ids"], d["eyes"])
        raw[sex] = lm0
        w = make_warp(lm0, sex)
        P = w(d["P"])
        eyes = [(w(E), Fe) for E, Fe in d["eyes"]]
        P = fit_arms_hands(P, d["F"], d["ids"], eyes, sex)
        if STYLISE is not None:
            P, eyes = STYLISE(P, d["F"], d["ids"], eyes, landmarks(P, d["F"], d["ids"], eyes), sex)
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

    dups = set(range(len(src["male"]["P"]) - SPLIT_COUNT[0], len(src["male"]["P"])))

    def gid(p, tag=0):
        k = (round(p[0], 6), round(p[1], 6), round(p[2], 6), tag)
        if k not in keymap:
            keymap[k] = len(gverts)
            gverts.append(p)
        return keymap[k]
    tris, tpart = [], []
    src2w = {}
    for part in parts:
        keep = [i for i, p in enumerate(part_of_face) if p == part]
        V, T = decimate_part(M, Fm, keep, RATIO[part], lock)
        used = decimate_part.used
        for t in T:
            tris.append(tuple(gid(V[i], int(used is not None and used[i] in dups)) for i in t))
            tpart.append(part)
        if used is not None:
            for i, srcv in enumerate(used):
                src2w[srcv] = gid(V[i], int(srcv in dups))
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
    sets_w = {}
    for nm, sets in (("inner_mouth", [8]), ("lips", [22]), ("eye_surround", [2, 3]), ("nose", [7])):
        sv = verts_of(Fm, ids, sets)
        sets_w[nm] = np.array(sorted(src2w[v] for v in sv if v in src2w))
    slit = {k: [src2w[v] for v in vs] for k, vs in SPLIT_INFO.items() if isinstance(vs, list)}
    return dict(Vm=Vm, Vf=Vf, tris=tris, part=np.array(tpart), eyes=eyes_out, sets=sets_w, slit=slit, lm_male=lms["male"], lm_female=lms["female"],
                warp_male=warped["male"]["warp"], heights=heights, raw_lm=raw,
                full=dict(F=warped["male"]["F"], ids=warped["male"]["ids"], Pm=warped["male"]["P"], Pf=warped["female"]["P"]))
