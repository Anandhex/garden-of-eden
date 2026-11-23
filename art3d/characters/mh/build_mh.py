"""Build the Garden of Eden base character on MakeHuman (deterministic, re-runnable).

    source art3d/characters/mh/mpfb_env.sh
    $B -b -P art3d/characters/mh/build_mh.py            # -> mh/base_mh.blend + mh/export/*.json   (about 2-3 min)

Pipeline
1. MPFB basemesh (hm08) + macros; recipe.json gives the neutral masculine (basis, Sex 0) and feminine (Sex 1):
   MakeHuman detail targets + our fields + the proportion warp (stylise_mh).
2. Blend shapes with our names (shapes_mh.py): MakeHuman targets / macro changes / fields, transported through the warp.
3. Mesh split at hidden seams into Mesh_Head/Torso/Arms/Hands/Legs/Feet (+ Part_Nose, Part_Ear_L/R), parts from the
   dominant bone of MakeHuman's own Mixamo/Unity weights; seam vertices are the same hm08 vertices on both sides.
   Torso, arms, hands, legs, feet and the teeth are decimated with their boundaries locked; every key, weight and UV is
   carried over by barycentric coordinates on the original triangles.
4. MakeHuman proxies as parts: Part_Eye_L/R (high-poly eyes; Eye + Cornea slots), Part_Lashes, Part_Brows, Teeth, Tongue;
   fitted for every key by their .mhclo rule.
5. Rig: MPFB's Mixamo/Unity rig fitted to the masculine neutral, renamed to our 56 Unity-Humanoid names (Root removed,
   breast / buttock / eyelid helper bones merged into their parents), MakeHuman weights (4 influences).
6. Sockets (16 empties), UVMap (MakeHuman UV) + FaceDecalUV (planar face rect of the old contract), joint offsets,
   species presets, meta.
"""
import bpy, bmesh, os, sys, json, math, time
import numpy as np
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree

HERE = os.path.dirname(os.path.abspath(__file__))
CHAR = os.path.dirname(HERE)
sys.path.insert(0, HERE)
sys.path.insert(0, CHAR)
import mhcore as mc, landmarks as lmk, stylise_mh as st, shapes_mh as sh, measure_mh as mm  # noqa: E402
import common  # noqa: E402

EXPORT = os.path.join(HERE, "export")
BLEND = os.path.join(HERE, "base_mh.blend")
PARTS = ["head", "torso", "arms", "hands", "legs", "feet"]
SMOOTH_BLINK = False
SHAPES = common.ALL_SHAPES + sh.EXTRA_SHAPES          # 75 old names + the variation sliders + Stylise_F / Stylise_M
PART_NAME = {"head": "Mesh_Head", "torso": "Mesh_Torso", "arms": "Mesh_Arms", "hands": "Mesh_Hands", "legs": "Mesh_Legs",
             "feet": "Mesh_Feet", "nose": "Part_Nose", "ear_L": "Part_Ear_L", "ear_R": "Part_Ear_R"}
DECIMATE = {"torso": 0.80, "arms": 0.70, "hands": 0.30, "legs": 0.85, "feet": 0.30, "teeth": 0.15}
BONE_MAP = {"Hips": "Hips", "Spine": "Spine", "Spine1": "Chest", "Spine2": "UpperChest", "Neck": "Neck", "Head": "Head",
            "Jaw": "Jaw", "LeftEye": "LeftEye", "RightEye": "RightEye"}
for s in ("Left", "Right"):
    BONE_MAP.update({f"{s}Shoulder": f"{s}Shoulder", f"{s}Arm": f"{s}UpperArm", f"{s}ForeArm": f"{s}LowerArm", f"{s}Hand": f"{s}Hand",
                     f"{s}UpLeg": f"{s}UpperLeg", f"{s}Leg": f"{s}LowerLeg", f"{s}Foot": f"{s}Foot", f"{s}ToeBase": f"{s}Toes"})
    for mx, ours in (("Thumb", "Thumb"), ("Index", "Index"), ("Middle", "Middle"), ("Ring", "Ring"), ("Pinky", "Little")):
        for i, ph in ((1, "Proximal"), (2, "Intermediate"), (3, "Distal")):
            BONE_MAP[f"{s}Hand{mx}{i}"] = f"{s}{ours}{ph}"
MERGE = {"LeftBreast": "Spine1", "RightBreast": "Spine1", "LeftButtock": "LeftUpLeg", "RightButtock": "RightUpLeg",
         "LeftOrbicularisTop": "Head", "RightOrbicularisTop": "Head", "LeftOrbicularisBottom": "Head",
         "RightOrbicularisBottom": "Head", "Root": "Hips"}


def log(*a):
    print("[build_mh]", *a, flush=True)


# ------------------------------------------------------------------------------------------------ keys
class KeyMaker:
    def __init__(self, B, lm, R):
        self.B, self.lm, self.R = B, lm, R
        self.Ppre = {}
        self.W = {}
        self.P = {}
        for sex in ("M", "F"):
            Ppre, W = st.neutral(B, lm, R, sex)
            self.Ppre[sex], self.W[sex] = Ppre, W
            self.P[sex] = self.ground(W(Ppre))
        self.mac = {s: B.macro(R[s]["macro"]) for s in ("M", "F")}
        hb = [lm.bones.index(b) for b in lm.bones if b.replace("mixamorig:", "") in
              ("Head", "Jaw", "LeftEye", "RightEye", "LeftOrbicularisTop", "RightOrbicularisTop", "LeftOrbicularisBottom",
               "RightOrbicularisBottom")]
        nb = lm.bones.index("mixamorig:Neck")
        self.headw = np.clip(lm.W[:, hb].sum(axis=1) + 0.5 * lm.W[:, nb], 0, 1)

    def ground(self, P):
        return P - [0, 0, P[self.lm.body, 2].min()]

    def transport(self, sex, d, eps=0.05):
        """delta d at the pre-warp neutral -> delta after the warp (local Jacobian by finite difference)."""
        Pp, W = self.Ppre[sex], self.W[sex]
        return (W(Pp + eps * d) - W(Pp)) / eps

    def transport_scale(self, sex, d):
        """delta scaled by the warp's local scale only (no gradient terms): the head scale k inside the head, blended over
        the neck band, the leg stretch on the vertical component below the crotch, the global scale.  Smooth everywhere,
        so local face / neck changes cannot shear the neck."""
        Pp, W = self.Ppre[sex], self.W[sex]
        f = W.s * (1 + (W.k - 1) * st.smoothstep(W.neck_band[0], W.neck_band[1], Pp[:, 2]))
        out = d * f[:, None]
        legs = 1 + (W.a - 1) * (1 - st.smoothstep(W.crotch - 0.06, W.crotch + 0.06, Pp[:, 2]))
        out[:, 2] *= legs
        return out

    def pre_delta(self, spec, sex="M"):
        B, R = self.B, self.R
        d = np.zeros_like(self.Ppre[sex])
        for k, w in st.expand(spec.get("t", {})).items():
            d += w * B.target(k)
        if "macro" in spec:
            src = spec.get("macro_from", sex)
            m = dict(R[src]["macro"])
            m.update(spec["macro"])
            dm = B.macro(m) - self.mac[src]
            if spec.get("mask") == "body":
                # adult head on the changed body: the head region follows the neck rigidly (no shape change)
                # blend over the neck by height (pre-warp space): body change below the neck joint, rigid head above the chin
                nk = self.B.groups["joint-neck"]
                Pp = self.Ppre[sex]
                zn = float(Pp[nk, 2].mean())
                zc = float(Pp[self.lm.chin, 2])
                hw = st.smoothstep(zn - 0.05, zn + 0.01, Pp[:, 2])    # the adult neck and head ride rigidly on the changed shoulders
                dn = dm[nk].mean(axis=0)
                dm = dm * (1 - hw)[:, None] + dn[None, :] * hw[:, None]
                # relax the neck-to-shoulder transition (no folds where the adult neck meets the smaller shoulders)
                band = np.clip(4 * hw * (1 - hw) * 1.5, 0, 1) * self.B.body_mask
                Q = Pp + dm
                dm = st._lap(self.lm, Q, band * 0.6, 30, taubin=True) - Pp
            d += dm
        if "fields" in spec:
            d += st.custom_fields(B, self.lm, self.Ppre[sex] + d, spec["fields"])
        if spec.get("smooth_neck"):
            # relax the key's displacement under the jaw and on the neck (MakeHuman's chin / face-length targets end in a
            # crease there); the face itself keeps the full change
            Pp = self.Ppre[sex]
            chin_z = Pp[self.lm.chin, 2]
            nz = Pp[self.B.groups["joint-neck"], 2].mean()
            band = (1 - st.smoothstep(chin_z + 0.005, chin_z + 0.03, Pp[:, 2])) * st.smoothstep(nz - 0.04, nz, Pp[:, 2])
            band *= (Pp[:, 1] > Pp[self.lm.chin, 1] + 0.004) | (Pp[:, 2] < chin_z)
            d = st._lap(self.lm, d.copy(), np.clip(band, 0, 1) * self.B.body_mask * 0.7, spec["smooth_neck"], taubin=True)
        if spec.get("smooth_head"):
            # low-pass the key's displacement on the head (keeps the age shape, drops MakeHuman's fine wrinkles)
            Pp = self.Ppre[sex]
            sel = np.clip(self.headw * 1.5, 0, 1) * self.B.body_mask
            sel[self.lm.lips] *= 0.3
            D = st._lap(self.lm, d.copy(), sel * 0.6, spec["smooth_head"], taubin=True)
            d = D
        return d

    def key(self, spec, sex="M"):
        """warp the changed pre-warp body with the neutral's warp, its pivots (neck band, crotch) moved with the body, so a
        large change (child, dwarf, halfling) keeps the head scaling on the head and the leg stretch on the legs."""
        d = self.pre_delta(spec, sex)
        if "macro" not in spec:
            # local shape changes: carry the delta through the warp's local Jacobian at each vertex's own position, so
            # features that move into the neck band (a longer chin) are not re-scaled differently from their neighbours
            return self.ground(self.P[sex] + self.transport_scale(sex, d))
        W = self.W[sex]
        g = self.B.groups
        dn = d[g["joint-neck"]].mean(axis=0)
        dc = (d[g["joint-l-upper-leg"]].mean(axis=0) + d[g["joint-r-upper-leg"]].mean(axis=0)) / 2
        W2 = st.Warp(W.s, W.a, W.k, W.crotch + dc[2], W.neck + dn, (W.neck_band[0] + dn[2], W.neck_band[1] + dn[2]), width=W.width)
        return self.ground(W2(self.Ppre[sex] + d))


# ------------------------------------------------------------------------------------------------ geometry helpers
def tris_of(faces):
    T, src = [], []
    for fi, f in enumerate(faces):
        for i in range(1, len(f) - 1):
            T.append((f[0], f[i], f[i + 1]))
            src.append(fi)
    return np.array(T, np.int64), np.array(src)


def bary(p, a, b, c):
    v0, v1, v2 = b - a, c - a, p - a
    d00, d01, d11 = v0 @ v0, v0 @ v1, v1 @ v1
    d20, d21 = v2 @ v0, v2 @ v1
    den = d00 * d11 - d01 * d01
    if abs(den) < 1e-20:
        return np.array([1.0, 0, 0])
    v = (d11 * d20 - d01 * d21) / den
    w = (d00 * d21 - d01 * d20) / den
    return np.array([1 - v - w, v, w])


class Part:
    """one exported mesh: vertices given as barycentric combinations of hm08 (or proxy) source vertices."""

    def __init__(self, name, src_idx, src_w, faces, uvs, mat_idx=None):
        self.name = name
        self.idx = np.asarray(src_idx, np.int64)       # n x 3 source vertex indices
        self.w = np.asarray(src_w, float)               # n x 3 weights
        self.faces = faces                               # list of tuples (local indices)
        self.uvs = uvs                                   # per face loop list of (u, v)
        self.mat_idx = mat_idx or [0] * len(faces)

    def eval(self, P):
        return (P[self.idx] * self.w[:, :, None]).sum(axis=1)


def make_part(name, faces_src, uv_src, keep_order=True):
    """undecimated part from source faces (indices into the source array)."""
    used = sorted({v for f in faces_src for v in f})
    rm = {v: i for i, v in enumerate(used)}
    idx = np.array([[v, v, v] for v in used])
    w = np.tile([1.0, 0.0, 0.0], (len(used), 1))
    faces = [tuple(rm[v] for v in f) for f in faces_src]
    return Part(name, idx, w, faces, uv_src)


def decimate(part, P, ratio, lock_local):
    """decimate a Part (evaluated on P) with the locked local vertices untouched; new vertices are mapped back to the
    original triangles by barycentric coordinates (closest point), so keys / weights / UVs carry over."""
    V = part.eval(P)
    me = bpy.data.meshes.new("dec_" + part.name)
    me.from_pydata(V.tolist(), [], [list(f) for f in part.faces])
    uvl = me.uv_layers.new(name="UVMap")
    flat = [uv for f in part.uvs for uv in f]
    uvl.data.foreach_set("uv", np.array(flat, float).ravel())
    ob = bpy.data.objects.new("dec_" + part.name, me)
    bpy.context.scene.collection.objects.link(ob)
    vg = ob.vertex_groups.new(name="w")
    vg.add(list(range(len(V))), 1.0, 'REPLACE')
    vg.add([int(i) for i in lock_local], 0.0, 'REPLACE')
    md = ob.modifiers.new("d", 'DECIMATE')
    md.ratio = ratio
    md.vertex_group = "w"
    md.vertex_group_factor = 1.0
    md.use_symmetry = True
    md.symmetry_axis = 'X'
    dg = bpy.context.evaluated_depsgraph_get()
    ev = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    NV = np.array([v.co[:] for v in ev.vertices])
    nf = [tuple(p.vertices) for p in ev.polygons]
    euv = np.empty(len(ev.loops) * 2)
    ev.uv_layers[0].data.foreach_get("uv", euv)
    euv = euv.reshape(-1, 2)
    nuvs = [[tuple(euv[l]) for l in range(p.loop_start, p.loop_start + p.loop_total)] for p in ev.polygons]
    # map back
    T, _ = tris_of(part.faces)
    tree = BVHTree.FromPolygons([Vector(v) for v in V], T.tolist())
    idx = np.zeros((len(NV), 3), np.int64)
    w = np.zeros((len(NV), 3))
    from mathutils.kdtree import KDTree
    kd = KDTree(len(V))
    for j, v in enumerate(V):
        kd.insert(v, j)
    kd.balance()
    for i, p in enumerate(NV):
        co, jv, dj = kd.find(p)
        if dj < 2e-5:                         # an original vertex (locked seams and kept vertices): exact copy
            idx[i] = part.idx[jv]
            w[i] = part.w[jv]
            continue
        loc, nrm, ti, dist = tree.find_nearest(Vector(p))
        a, b, c = T[ti]
        bc = bary(np.array(loc), V[a], V[b], V[c])
        bc = np.clip(bc, 0, 1)
        bc /= bc.sum()
        # exact original vertices (locked seams) -> pure copies
        k = int(np.argmax(bc))
        if np.linalg.norm(V[[a, b, c][k]] - p) < 2e-5:
            bc = np.eye(3)[k]
        sidx = part.idx[[a, b, c]]          # each original local vertex maps to source triples
        sw = part.w[[a, b, c]]
        # compose: new vertex = sum_j bc_j * (sum_k sw_jk * src_jk); keep the 3 largest source contributions
        acc = {}
        for j in range(3):
            for kk in range(3):
                if bc[j] * sw[j, kk] > 0:
                    acc[int(sidx[j, kk])] = acc.get(int(sidx[j, kk]), 0.0) + bc[j] * sw[j, kk]
        items = sorted(acc.items(), key=lambda t: -t[1])[:3]
        tot = sum(x for _, x in items)
        for j, (s, x) in enumerate(items):
            idx[i, j] = s
            w[i, j] = x / tot
        for j in range(len(items), 3):
            idx[i, j] = items[0][0]
    bpy.data.objects.remove(ob)
    bpy.data.meshes.remove(me)
    bpy.data.meshes.remove(ev)
    return Part(part.name, idx, w, nf, nuvs)


def boundary_local(faces):
    from collections import Counter
    ec = Counter()
    for f in faces:
        for i in range(len(f)):
            ec[tuple(sorted((f[i], f[(i + 1) % len(f)])))] += 1
    return sorted({v for e, c in ec.items() if c == 1 for v in e})


# ------------------------------------------------------------------------------------------------ main build
def fresh():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    for coll in (bpy.data.meshes, bpy.data.armatures, bpy.data.materials, bpy.data.images):
        for x in list(coll):
            if x.users == 0:
                coll.remove(x)


def split_body(B, lm):
    """faces of each exported part (hm08 indices) and per-face UVs."""
    uv_all = B.uv_all
    faces = {}
    nose_thr = 0.55
    ns = lm.nose_score
    ear_set = {"L": set(lm.ear_L.tolist()), "R": set(lm.ear_R.tolist())}
    for fi, f, p in zip(lm.face_ids, lm.faces, lm.fpart):
        uvs = [tuple(uv_all[B.loop_start[fi] + k]) for k in range(len(f))]
        key = p
        if p == "head":
            if all(v in ear_set["L"] for v in f):
                key = "ear_L"
            elif all(v in ear_set["R"] for v in f):
                key = "ear_R"
            elif all(ns[v] > nose_thr for v in f):
                key = "nose"
        faces.setdefault(key, ([], []))
        faces[key][0].append(f)
        faces[key][1].append(uvs)
    # nose: keep only the largest connected component (the thresholded score may leave islands on the cheeks)
    nf, nu = faces.pop("nose")
    comp = components(nf)
    big = max(comp, key=len)
    keep = set(big)
    faces["nose"] = ([f for i, f in enumerate(nf) if i in keep], [u for i, u in enumerate(nu) if i in keep])
    faces["head"] = (faces["head"][0] + [f for i, f in enumerate(nf) if i not in keep],
                     faces["head"][1] + [u for i, u in enumerate(nu) if i not in keep])
    return faces


def components(faces):
    parent = list(range(len(faces)))

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x
    by_v = {}
    for i, f in enumerate(faces):
        for v in f:
            if v in by_v:
                a, b = find(i), find(by_v[v])
                if a != b:
                    parent[a] = b
            else:
                by_v[v] = i
    groups = {}
    for i in range(len(faces)):
        groups.setdefault(find(i), []).append(i)
    return list(groups.values())


def proxy_part(name, px, faces=None, side=None, Pref=None):
    F = px.faces if faces is None else faces
    uvs = [[tuple(px.uv[t]) if t >= 0 else (0.0, 0.0) for t in ft] for ft in (px.face_uv if faces is None else faces_uv(px, F))]
    part = make_part(name, F, uvs)
    return part


def faces_uv(px, F):
    m = {tuple(f): ft for f, ft in zip(px.faces, px.face_uv)}
    return [m[tuple(f)] for f in F]


def main():
    t0 = time.time()
    fresh()
    R = st.load_recipe()
    B = mc.Base()
    P0 = B.macro({})
    lm = lmk.Landmarks(B, P0 - [0, 0, P0[B.body_mask, 2].min()])
    B.h.hide_render = B.h.hide_viewport = True
    km = KeyMaker(B, lm, R)
    PM, PF = km.P["M"], km.P["F"]
    log("neutrals", round(time.time() - t0, 1), "s; heights M/F", round(PM[lm.body, 2].max(), 3), round(PF[lm.body, 2].max(), 3))
    # ---------------- every key on the full hm08 coordinates
    KEYS = {"Sex": PF}
    for name in SHAPES:
        if name in ("Sex", "Stylise_F", "Stylise_M") or name.startswith("Fix_") or name in sh.BROW:
            continue
        spec = sh.ALL[name]
        KEYS[name] = km.key(spec, "M")
    # Stylise_F / Stylise_M: the local large-form fields (stylise_local.py) evaluated on each neutral, stored on the basis
    import stylise_local
    KEYS["Stylise_F"] = PM + stylise_local.delta(B, lm, PF, R["F"].get("stylise_local", []))
    KEYS["Stylise_M"] = PM + stylise_local.delta(B, lm, PM, R["M"].get("stylise_local", []))
    # closed-lid cleanup: the MakeHuman eye-closure units leave a sharp fold at the outer canthus that catches light as a
    # pale crescent; relax the closed shape around each outer corner (only where the blink moves the skin)
    for sd in ("L", "R"):
        K = KEYS[f"Eye_Blink_{sd}"]
        ci, co, up, lo = lm.eye_frame(PM, sd)
        moved = np.clip(np.linalg.norm(K - PM, axis=1) / 0.0008, 0, 1)
        d = np.linalg.norm(PM - PM[co], axis=1)
        sel = (1 - st.smoothstep(0.003, 0.007, d)) * moved * B.body_mask
        ring = np.zeros(B.n)
        ring[lm.lid[sd]] = 1.0
        ring = np.clip(ring + 0.0, 0, 1)
        ce = PM[B.groups["helper-l-eye" if sd == "L" else "helper-r-eye"]].mean(axis=0)
        near_margin = np.linalg.norm(PM - ce, axis=1) < 0.0175          # lid margins and the eyeball surface: untouched
        sel[near_margin] = 0.0
        KEYS[f"Eye_Blink_{sd}"] = st._lap(lm, K, sel * 0.6, 24, taubin=True) if SMOOTH_BLINK else K
    # corrective keys: a fully opened lid (Eye_Round) must still close with Blink. Fix_EyeRound_Blink_<side> cancels the
    # Eye_Round delta on the vertices that side's blink moves; runtime weight = Eye_Round x Eye_Blink_<side>
    dr = KEYS["Eye_Round"] - PM
    for sd in ("L", "R"):
        ce = PM[B.groups["helper-l-eye" if sd == "L" else "helper-r-eye"]].mean(axis=0)
        m = 1 - st.smoothstep(0.022, 0.030, np.linalg.norm(PM - ce, axis=1))       # the whole lid region of that eye
        KEYS[f"Fix_EyeRound_Blink_{sd}"] = PM - dr * m[:, None]
    for name in sh.BROW:
        KEYS[name] = PM                         # brow keys move only the brow card (build_obj asks the brow proxy)
    B.save_cache()
    np.savez_compressed(os.path.join(mc.CACHE, "keys.npz"), **{k: v.astype(np.float32) for k, v in KEYS.items()}, _basis=PM.astype(np.float32))
    log("keys", len(KEYS), round(time.time() - t0, 1), "s")
    # blink side check: Eye_Blink_L must move the +x (character-left) lid
    for a, b in (("Eye_Blink_L", "Eye_Blink_R"),):
        dl = np.linalg.norm(KEYS[a] - PM, axis=1)
        if PM[dl > 1e-4, 0].mean() < 0:
            KEYS[a], KEYS[b] = KEYS[b], KEYS[a]
            log("blink sides swapped (MakeHuman 'left' = image left)")
    # ---------------- parts
    fs = split_body(B, lm)
    parts = {}
    for key, (F, U) in fs.items():
        parts[key] = make_part(PART_NAME[key], F, U)
    # lock every vertex shared between two parts (the seams) and the hm08 helper-free boundary
    owner = {}
    for key, p in parts.items():
        for v in p.idx[:, 0]:
            owner.setdefault(int(v), set()).add(key)
    seam = {v for v, s in owner.items() if len(s) > 1}
    for key, ratio in DECIMATE.items():
        if key not in parts:
            continue
        p = parts[key]
        lock = [i for i, v in enumerate(p.idx[:, 0]) if int(v) in seam]
        parts[key] = decimate(p, PM, ratio, lock)
    # ---------------- proxies
    prox = {}
    import face_cards
    for kind in ("eyes", "eyelashes", "eyebrows", "teeth", "tongue"):
        v = R["proxies"][kind]
        v = v["F"] if isinstance(v, dict) else v
        if kind == "eyelashes" and v == "ribbon":
            # our solid lash-and-liner ribbon (face_cards.py); the feminine settings, one mesh for both sexes
            PFs = PF + (KEYS["Stylise_F"] - PM)          # the feminine neutral as previewed (Stylise on)
            mov = (np.linalg.norm(KEYS["Eye_Blink_L"] - PM, axis=1) > 0.0015) | (np.linalg.norm(KEYS["Eye_Blink_R"] - PM, axis=1) > 0.0015)
            prox[kind] = face_cards.LashRibbon(B, lm, PFs, eyes_px=mc.Proxy(mc.proxy_file("eyes", R["proxies"]["eyes"])), moving=mov,
                                               recompute=True, **R["look"]["F"].get("ribbon", {}))
            continue
        prox[kind] = mc.Proxy(mc.proxy_file(kind, v))
        if kind == "eyelashes" and R["look"]["F"].get("blink_lashes"):
            prox[kind] = face_cards.BlinkLashProxy(prox[kind], B, lm, PM)
        if kind == "eyelashes" and R["look"]["F"].get("lash_proxy"):
            prox[kind] = face_cards.LashProxy(prox[kind], B, lm, PF + (KEYS["Stylise_F"] - PM), **R["look"]["F"]["lash_proxy"])
        if kind == "teeth" and R["look"]["F"].get("teeth_offset"):
            prox[kind] = face_cards.OffsetProxy(prox[kind], R["look"]["F"]["teeth_offset"])
        if kind == "eyebrows" and R["look"]["F"].get("snap_brows"):
            prox[kind] = face_cards.SnappedProxy(prox[kind], lm, R["look"]["F"].get("brow_params"))
    pe = prox["eyes"]
    Ep = pe.fit(PM)
    eparts = {}
    for side, sx in (("L", 1), ("R", -1)):
        F = [f for f in pe.faces if np.mean(Ep[list(f), 0]) * sx > 0]
        p = make_part(f"Part_Eye_{side}", F, [[tuple(pe.uv[t]) for t in ft] for ft in faces_uv(pe, F)])
        p.mat_idx = [1 if np.mean([pe.uv[t][0] for t in ft]) > 0.8 and np.mean([pe.uv[t][1] for t in ft]) < 0.2 else 0
                     for ft in faces_uv(pe, F)]
        eparts[side] = p
    xparts = {"Part_Lashes": proxy_part("Part_Lashes", prox["eyelashes"]), "Part_Brows": proxy_part("Part_Brows", prox["eyebrows"]),
              "Teeth": proxy_part("Teeth", prox["teeth"]), "Tongue": proxy_part("Tongue", prox["tongue"])}
    if R["look"]["F"].get("tear_duct", True):
        prox["tear_duct"] = face_cards.TearDuct(B, lm, PF + (KEYS["Stylise_F"] - PM))
        xparts["Part_TearDuct"] = proxy_part("Part_TearDuct", prox["tear_duct"])
    PXM = {k: px.fit(PM) for k, px in prox.items()}
    xparts["Teeth"] = decimate(xparts["Teeth"], PXM["teeth"], DECIMATE["teeth"], [])
    # ---------------- rig (MPFB Mixamo/Unity fitted to the masculine neutral)
    arm, W = make_rig(B, lm, PM)
    # ---------------- objects
    mats = {n: mat(n) for n in ("Skin", "Skin_Head", "Eye", "Cornea", "Lashes", "Brows", "Teeth", "Tongue", "TearDuct")}
    objs = {}
    normals = welded_normals(lm, PM)
    for key, p in parts.items():
        ob = build_obj(p, PM, KEYS, None, mats["Skin_Head" if key in ("head", "nose", "ear_L", "ear_R") else "Skin"])
        set_weights(ob, p, W)
        set_normals(ob, p, normals, seam)
        objs[p.name] = ob
    # user sculpts saved by the editor (mh/sculpts/<User_name>.npz: per part, one delta per vertex)
    import glob
    for f in sorted(glob.glob(os.path.join(HERE, "sculpts", "*.npz"))):
        z = np.load(f)
        nm = os.path.splitext(os.path.basename(f))[0]
        for pn in z.files:
            ob = objs.get(pn)
            if ob is not None and len(ob.data.vertices) == len(z[pn]):
                kb = ob.shape_key_add(name=nm, from_mix=False)
                base_co = np.array([v.co[:] for v in ob.data.shape_keys.key_blocks[0].data])
                kb.data.foreach_set("co", (base_co + z[pn]).ravel())
            else:
                log("sculpt", nm, "skipped on", pn, "(vertex count changed)")
    for side, p in eparts.items():
        ob = build_obj(p, Ep, KEYS, pe, [mats["Eye"], mats["Cornea"]])
        set_weights_proxy(ob, p, pe, W)
        objs[p.name] = ob
    for name, kind in (("Part_Lashes", "eyelashes"), ("Part_Brows", "eyebrows"), ("Teeth", "teeth"), ("Tongue", "tongue"),
                       ("Part_TearDuct", "tear_duct")):
        if name not in xparts:
            continue
        p = xparts[name]
        ob = build_obj(p, PXM[kind], KEYS, prox[kind], mats[{"Part_Lashes": "Lashes", "Part_Brows": "Brows",
                                                              "Part_TearDuct": "TearDuct"}.get(name, name)])
        set_weights_proxy(ob, p, prox[kind], W)
        objs[name] = ob
    for ob in objs.values():
        ob.parent = arm
        md = ob.modifiers.new("Armature", 'ARMATURE')
        md.object = arm
    # ---------------- groom (round 24): every head-hair and facial-hair style as its own mesh with the same shape keys
    groom = build_groom(B, lm, PM, KEYS, arm, W, R)
    # FaceDecalUV on head and nose (old contract formula)
    chin = float(PM[lm.chin, 2])
    for n in ("Mesh_Head", "Part_Nose"):
        face_decal_uv(objs[n], chin)
    socks = make_sockets(arm, lm, PM, B)
    # ---------------- outputs
    os.makedirs(EXPORT, exist_ok=True)
    tri = lambda o: sum(len(p.vertices) - 2 for p in o.data.polygons)
    stats = {n: dict(verts=len(o.data.vertices), tris=tri(o), keys=len(o.data.shape_keys.key_blocks) - 1 if o.data.shape_keys else 0)
             for n, o in objs.items()}
    total = sum(s["tris"] for s in stats.values())
    log("tris total", total, json.dumps(stats))
    write_joint_offsets(arm, lm, KEYS, PM)
    write_meta(objs, stats, total, lm, PM, PF, socks, R, B, KEYS, arm, pe)
    write_species(km, KEYS, PM, PF, lm)
    import shutil
    os.makedirs(os.path.join(EXPORT, "textures"), exist_ok=True)
    for f in ("lash_strands.png", "eyelashes02_clean.png", "brow_fine.png", "brow_bushy.png", "brow_groomed.png", "brow_feathered.png",
              "scalp_strands.png", "curl_strands.png", "beard_clumps.png", "hair_fine.png"):
        src = os.path.join(HERE, "textures", f)
        if os.path.exists(src):
            shutil.copy(src, os.path.join(EXPORT, "textures", f))
    for base in sorted({v[0] for v in groom["hair"].values() if v[0] not in (None, "cap", "curls")}):
        tx = mc.Proxy(mc.proxy_file("hair", base)).texture()
        if tx and os.path.exists(tx):
            os.makedirs(os.path.join(EXPORT, "textures", "hair"), exist_ok=True)
            shutil.copy(tx, os.path.join(EXPORT, "textures", "hair", os.path.basename(tx)))
    json.dump(groom["meta"], open(os.path.join(EXPORT, "groom.json"), "w"), indent=1)
    bpy.ops.wm.save_as_mainfile(filepath=BLEND, compress=True)       # the groom keys make it ~100 MB uncompressed
    log("saved", BLEND, round(time.time() - t0, 1), "s")


def groom_name(kind, style):
    return ("Hair_" if kind == "hair" else "Beard_") + "".join(w.capitalize() for w in style.split())


def build_groom(B, lm, PM, KEYS, arm, W, R):
    """Groom collection: one object per hair / facial-hair style (hair_lib.HAIR / BEARDS), each fitted to the masculine
    neutral with every shape key that moves it (Sex, Stylise, head shape, expressions), skinned from the basemesh, under
    an empty "Groom" (child of the armature, so the body budget and key checks stay on the body).  A runtime shows the
    style a person picked (person.generate: _hair, _beard, _hair_col, _greying, _brow_style) and hides the rest.
    Shell styles carry Fade (density) and Layer (0 inner .. 1 outer) colour attributes for the strand-shell shader."""
    import hair_lib as hl, face_cards as fc
    t0 = time.time()
    col = bpy.data.collections.new("Groom")
    bpy.context.scene.collection.children.link(col)
    root = bpy.data.objects.new("Groom", None)
    col.objects.link(root)
    root.parent = arm
    meta = {"note": "one object per style under the Groom empty; show the picked one. Shell styles: alpha = clamp((A - sparse*Layer) "
                    "/ (1 - sparse*Layer)) * gain * Fade, colour = hair colour x strand brightness x mix(dark_in, 1, Layer); "
                    "MakeHuman card styles: texture luminance / mean_lum ^ 1.35 x hair colour, with hair_fine.png along v.",
            "hair": {}, "beards": {}, "brows": {}, "palette": hl.PALETTE,
            "defaults": {"F": {"hair": "ponytail", "beard": "none"}, "M": {"hair": "short side part", "beard": "none"}}}
    out = {"hair": hl.HAIR, "meta": meta}
    jobs = [("hair", s_, v) for s_, v in sorted(hl.HAIR.items()) if v[0] is not None] + \
           [("beard", s_, v) for s_, v in sorted(hl.BEARDS.items()) if v[0] is not None and v[1] > 0]
    for kind, style, v in jobs:
        if kind == "hair":
            base, sexes, prm = v
            if base in ("cap", "curls"):
                px = hl.hair_shell(PM, B, lm, base, prm)
                info = dict(kind="shell", texture="scalp_strands.png" if base == "cap" else "curl_strands.png",
                            gain=1.5 if base == "cap" else 1.7, sparse=0.45 if base == "cap" else 0.62,
                            dark_in=0.6 if base == "cap" else 0.45)
            else:
                px = hl.StyledHair(mc.Proxy(mc.proxy_file("hair", base)), B, lm, prm)
                tx = px.texture()
                info = dict(kind="card", texture="hair/" + os.path.basename(tx) if tx else None,
                            mean_lum=round(hl.tex_mean_lum(tx), 4) if tx else None)
            info.update(base=base, sexes=sexes, params=prm)
        else:
            px = hl.beard_shell(PM, B, lm, style)
            region, thick, layers, tile, gain, grey, hang = v
            info = dict(kind="shell", texture="beard_clumps.png", gain=gain, sparse=0.55, dark_in=0.5, grey=grey, region=region)
        name = groom_name(kind, style)
        p = proxy_part(name, px)
        Pb = px.fit(PM)
        ob = build_obj(p, Pb, KEYS, px, mat(name if info["kind"] == "shell" else "Hair_" + info["base"]))
        col.objects.link(ob)
        bpy.context.scene.collection.objects.unlink(ob)
        set_weights_proxy(ob, p, px, W)
        if hasattr(px, "attributes"):
            idx = p.idx[:, 0]
            for an, val in px.attributes().items():
                a = ob.data.color_attributes.new(an, 'FLOAT_COLOR', 'POINT')
                c = np.ones((len(idx), 4))
                c[:, 0] = c[:, 1] = c[:, 2] = np.asarray(val)[idx]
                a.data.foreach_set("color", c.ravel())
        ob.parent = root
        ob.modifiers.new("Armature", 'ARMATURE').object = arm
        ob["groom_kind"], ob["groom_style"] = kind, style
        ob.hide_render = ob.hide_viewport = True
        tris = sum(len(q.vertices) - 2 for q in ob.data.polygons)
        info.update(object=name, tris=tris, keys=len(ob.data.shape_keys.key_blocks) - 1 if ob.data.shape_keys else 0)
        meta["hair" if kind == "hair" else "beards"][style] = info
        log("groom", name, "tris", tris, "keys", info["keys"], round(time.time() - t0, 1), "s")
    for k in ("bald", "shaved"):
        meta["hair"][k] = dict(kind="none", base=None, sexes=hl.HAIR[k][1], params=hl.HAIR[k][2])
    for k, v in hl.BEARDS.items():
        if v[1] <= 0:
            meta["beards"][k] = dict(kind="skin tint" if v[0] else "none", region=v[0], strength=v[4], grey=v[5])
    for k, (tex, prm, dens) in fc.BROW_STYLES.items():
        meta["brows"][k] = dict(texture=tex + ".png", card="eyebrow001 (Part_Brows)", keys=prm, density=dens)
    return out


def mat(name):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    return m


def build_obj(p, Pbase, KEYS, proxy, materials):
    V = p.eval(Pbase)
    me = bpy.data.meshes.new(p.name)
    me.from_pydata(V.tolist(), [], [list(f) for f in p.faces])
    uvl = me.uv_layers.new(name="UVMap")
    uvl.data.foreach_set("uv", np.array([uv for f in p.uvs for uv in f], float).ravel())
    for poly in me.polygons:
        poly.use_smooth = True
    ob = bpy.data.objects.new(p.name, me)
    bpy.context.scene.collection.objects.link(ob)
    if not isinstance(materials, list):
        materials = [materials]
    for m in materials:
        me.materials.append(m)
    if len(materials) > 1:
        me.polygons.foreach_set("material_index", np.array(p.mat_idx, np.int32))
    ob.shape_key_add(name="Basis", from_mix=False)
    for name in SHAPES:
        K = KEYS[name]
        if name in sh.BROW:
            if not hasattr(proxy, "brow_params"):
                continue
            K = proxy.fit(K, {name: 1.0})
        elif proxy is not None:
            K = proxy.fit(K)
        Vk = p.eval(K)
        dv = Vk - V
        dv[np.abs(dv).max(axis=1) < 2e-6] = 0.0          # drop float noise; any real movement keeps the key on the part
        if not dv.any():
            continue
        Vk = V + dv
        kb = ob.shape_key_add(name=name, from_mix=False)
        kb.data.foreach_set("co", Vk.ravel())
    return ob


def welded_normals(lm, P):
    n = np.zeros_like(P)
    for f in lm.faces:
        pts = P[list(f)]
        c = np.cross(pts[1] - pts[0], pts[2] - pts[0])
        if len(f) == 4:
            c += np.cross(pts[2] - pts[0], pts[3] - pts[0])
        for v in f:
            n[v] += c
    return n / np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-12)


def set_normals(ob, p, normals, seam):
    """custom normals: the welded hm08 normal on seam vertices (identical on both sides), Blender's own elsewhere."""
    me = ob.data
    vn = np.array([v.normal[:] for v in me.vertices])
    pure = (p.w[:, 0] > 0.999999)
    for i in range(len(vn)):
        if pure[i] and int(p.idx[i, 0]) in seam:
            vn[i] = normals[int(p.idx[i, 0])]
    me.normals_split_custom_set_from_vertices(vn.tolist())


def make_rig(B, lm, PM):
    HS = mc.HS()
    h = HS.create_human(mask_helpers=False, feet_on_ground=False, scale=0.1, macro_detail_dict=mc.full_macro({}))
    if h.data.shape_keys:
        h.shape_key_clear()
    h.data.vertices.foreach_set("co", PM.ravel())
    h.data.update()
    arm = HS.add_builtin_rig(h, "mixamo_unity", import_weights=False)
    arm.name = arm.data.name = "Armature"
    arm.location = (0, 0, 0)
    h.parent = None
    bpy.data.objects.remove(h, do_unlink=True)
    bpy.context.view_layer.objects.active = arm
    arm.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    eb = arm.data.edit_bones
    hips = eb["mixamorig:Hips"]
    hips.parent = None
    for b in list(eb):
        short = b.name.replace("mixamorig:", "")
        if short in MERGE or short not in BONE_MAP:
            eb.remove(b)
    for b in eb:
        b.name = BONE_MAP[b.name.replace("mixamorig:", "")]
    bpy.ops.object.mode_set(mode='OBJECT')
    for pb in arm.pose.bones:
        pb.rotation_mode = 'XYZ'
    arm.data.display_type = 'OCTAHEDRAL'
    arm.show_in_front = True
    # weights: MakeHuman's mixamo_unity weights with the merged bones folded into their parents, 4 influences
    names = [b.name for b in arm.data.bones]
    col = {n: i for i, n in enumerate(names)}
    W = np.zeros((B.n, len(names)))
    for j, b in enumerate(lm.bones):
        short = b.replace("mixamorig:", "")
        tgt = BONE_MAP.get(MERGE.get(short, short))
        if tgt is None:
            tgt = BONE_MAP[MERGE[short]]
        W[:, col[tgt]] += lm.W[:, j]
    order = np.argsort(-W, axis=1)
    for i in range(B.n):
        W[i, order[i, 4:]] = 0
    s = W.sum(axis=1, keepdims=True)
    W = np.where(s > 0, W / np.maximum(s, 1e-12), 0)
    W = (names, W)
    return arm, W


def _apply_weights(ob, names, Wv):
    for n in names:
        ob.vertex_groups.new(name=n)
    for i in range(len(Wv)):
        nz = np.nonzero(Wv[i] > 1e-4)[0]
        for j in nz:
            ob.vertex_groups[names[j]].add([i], float(Wv[i, j]), 'REPLACE')


def set_weights(ob, p, W):
    names, Wm = W
    Wv = (Wm[p.idx] * p.w[:, :, None]).sum(axis=1)
    Wv = top4(Wv)
    _apply_weights(ob, names, Wv)


def set_weights_proxy(ob, p, px, W):
    names, Wm = W
    if not hasattr(px, "vi"):                                 # the lash ribbon rides on the head (lids move by shape keys)
        Wp = np.zeros((px.nv, len(names)))
        Wp[:, names.index("Head")] = 1.0
    else:
        Wp = (Wm[px.vi] * px.vw[:, :, None]).sum(axis=1)   # proxy vertex weights from the basemesh (MPFB's rule)
    Wv = (Wp[p.idx] * p.w[:, :, None]).sum(axis=1)
    Wv = top4(Wv)
    _apply_weights(ob, names, Wv)


def top4(Wv):
    order = np.argsort(-Wv, axis=1)
    for i in range(len(Wv)):
        Wv[i, order[i, 4:]] = 0
    s = Wv.sum(axis=1, keepdims=True)
    return np.where(s > 0, Wv / np.maximum(s, 1e-12), 0)


def face_decal_uv(ob, chin):
    me = ob.data
    uv = me.uv_layers.new(name="FaceDecalUV")
    vi = np.empty(len(me.loops), np.int64)
    me.loops.foreach_get("vertex_index", vi)
    V = np.array([v.co[:] for v in me.vertices])
    z0 = chin - 0.005
    u = (V[vi, 0] + 0.11) / 0.22 * 0.5
    v = 0.5 + (V[vi, 2] - z0) / 0.22 * 0.5
    uv.data.foreach_set("uv", np.stack([u, v], axis=1).ravel())
    me.uv_layers.active = me.uv_layers["UVMap"]


def make_sockets(arm, lm, P, B):
    body_t, _ = tris_of(lm.faces)
    tree = BVHTree.FromPolygons([Vector(p) for p in P], body_t.tolist())

    def ray(o, d):
        h = tree.ray_cast(Vector(o), Vector(d))
        return np.array(h[0]) if h[0] is not None else np.array(o)
    eyeL = P[B.groups["helper-l-eye"]].mean(axis=0)
    earL = P[lm.ear_L].mean(axis=0)
    nose = lm.nose_set(0.5)
    ntip = P[nose][np.argmin(P[nose, 1])]
    top = ray((0, float(eyeL[1]) + 0.06, 3.0), (0, 0, -1))
    hand = lm.joint(P, "joint-l-hand")
    fing = lm.joint(P, "joint-l-finger-3-1")
    sock = {}
    for sd, sx in (("L", 1), ("R", -1)):
        e = eyeL * [sx, 1, 1]
        sock[f"Socket_Eye_{sd}"] = (e, "Head")
        sock[f"Socket_Brow_{sd}"] = (ray((e[0], -1, e[2] + 0.03), (0, 1, 0)), "Head")
        sock[f"Socket_Ear_{sd}"] = (earL * [sx, 1, 1], "Head")
        hip = lm.joint(P, "joint-l-upper-leg") * [sx, 1, 1]
        hz = hip[2] + 0.05
        sel = (np.abs(P[:, 2] - hz) < 0.02) & (P[:, 0] * sx > 0) & (np.abs(P[:, 0]) < 0.25) & B.body_mask
        sock[f"Socket_Hip_{sd}"] = (np.array([sx * float(np.abs(P[sel, 0]).max()), hip[1], hz]), "Hips")
        sock[f"Socket_Hand_{sd}"] = (((hand + fing) / 2) * [sx, 1, 1], "LeftHand" if sx > 0 else "RightHand")
    sock["Socket_Nose"] = (ntip, "Head")
    sock["Socket_Mouth"] = (ray((0, -1, float(P[lm.lipContact, 2])), (0, 1, 0)), "Head")
    sock["Socket_Beard"] = (ray((0, -1, float(P[lm.chin, 2]) + 0.015), (0, 1, 0)), "Head")
    sock["Socket_Hair"] = (top - [0, 0, 0.02], "Head")
    sock["Socket_Hat"] = (top, "Head")
    clav = lm.joint(P, "joint-l-clavicle")
    sock["Socket_Back"] = (ray((0, 1, float(clav[2]) - 0.15), (0, -1, 0)), "UpperChest")
    out = []
    for name, (pos, bone) in sock.items():
        em = bpy.data.objects.new(name, None)
        em.empty_display_type = 'ARROWS'
        em.empty_display_size = 0.03
        bpy.context.scene.collection.objects.link(em)
        em.parent = arm
        em.parent_type = 'BONE'
        em.parent_bone = bone
        bm_ = arm.matrix_world @ arm.data.bones[bone].matrix_local @ Matrix.Translation((0, arm.data.bones[bone].length, 0))
        em.matrix_parent_inverse = bm_.inverted()
        em.matrix_world = Matrix.Translation(Vector(pos))
        out.append((name, bone, [round(float(c), 4) for c in pos]))
    return out


def bone_sources(lm):
    """hm08 vertex sets that define each bone head (MPFB rig JSON: joint cube or vertex)."""
    rj = mc.rig_json()
    out = {}
    for full, d in rj.items():
        short = full.replace("mixamorig:", "")
        if short not in BONE_MAP:
            continue
        h = d["head"]
        if h.get("strategy") == "CUBE":
            out[BONE_MAP[short]] = lm.B.groups[h["cube_name"]]
        elif h.get("strategy") == "VERTEX":
            out[BONE_MAP[short]] = np.array([h["vertex_index"]])
        else:
            out[BONE_MAP[short]] = None
    return out


def write_joint_offsets(arm, lm, KEYS, PM):
    src = bone_sources(lm)
    heads = {b.name: [round(v, 5) for v in b.head_local] for b in arm.data.bones}
    offs = {}
    for name, K in KEYS.items():
        d = {}
        for b in heads:
            s = src.get(b)
            if s is None:
                continue
            dv = (K[s] - PM[s]).mean(axis=0)
            if np.abs(dv).max() > 5e-5:
                d[b] = [round(float(x), 5) for x in dv]
        if d:
            offs[name] = d
    json.dump({"space": "Blender armature space, metres, shape weight 1.0; Unity = (-x, z, -y)",
               "source": "MakeHuman joint helper cubes (MPFB rig.mixamo_unity.json head strategies)",
               "restHeads": heads, "offsets": offs}, open(os.path.join(EXPORT, "joint_offsets.json"), "w"), indent=0)


def landmarks_of(lm, P, B):
    j = lambda n: lm.joint(P, n)
    sh = j("joint-l-shoulder")
    el = j("joint-l-elbow")
    d = (el - sh) / np.linalg.norm(el - sh)
    nose = lm.nose_set(0.5)
    out = dict(top=P[lm.body, 2].max(), chin=P[lm.chin, 2], wrist=j("joint-l-hand"), elbow=el, shoulder_b=sh, pivot=sh - d * 0.07,
               knee=j("joint-l-knee"), ankle_b=j("joint-l-ankle"), hip_b=j("joint-l-upper-leg"), neck_base=j("joint-neck"),
               sternal_notch=np.array([0.0, float(P[lm.body][np.abs(P[lm.body, 0]) < 0.003][:, 1].min()), float(j("joint-l-clavicle")[2])]),
               eye=P[B.groups["helper-l-eye"]].mean(axis=0), eye_x=float(P[B.groups["helper-l-eye"]].mean(axis=0)[0]),
               ear=P[lm.ear_L].mean(axis=0), nose_tip=P[nose][np.argmin(P[nose, 1])], head_c=j("joint-head"),
               palm_end=j("joint-l-finger-3-1"))
    return {k: (np.round(v, 4).tolist() if hasattr(v, "__len__") else round(float(v), 4)) for k, v in out.items()}


def write_meta(objs, stats, total, lm, PM, PF, socks, R, B, KEYS, arm, pe):
    meta = {
        "base": "MakeHuman hm08 via MPFB 2.0.18 (CC0 data); see art3d/characters/mh/README.md",
        "faceUvRect": {"u0": 0.0, "v0": 0.5, "u1": 0.5, "v1": 1.0},
        "tris": total, "parts": {n: dict(s, shapeKeys=[k.name for k in o.data.shape_keys.key_blocks[1:]] if o.data.shape_keys else [])
                                 for (n, s), o in zip(stats.items(), objs.values())},
        "landmarks": landmarks_of(lm, PM, B), "landmarksFemale": landmarks_of(lm, PF, B),
        "sockets": [{"name": n, "bone": b, "pos": p} for n, b, p in socks],
        "shapeKeys": SHAPES, "variationSliders": sh.VARIATION, "bodySliders": sh.BODY_SLIDERS,
        "sliderRange": "variation keys are bipolar: weight -1..+1, +1 = about +2 SD of the measured value", "expressionShapes": common.EXPR_SHAPES,
        "bones": [b.name for b in arm.data.bones],
        "faceRig": {"eyeCentres": [np.round(PM[B.groups[g]].mean(axis=0), 4).tolist() for g in ("helper-l-eye", "helper-r-eye")],
                    "eyeRadius": [round(float((pe.fit(PM)[:, 0].max() - pe.fit(PM)[:, 0].min()) / 4), 4)] * 2,
                    "irisFrac": 0.53, "jaw": "Jaw bone opens the mouth (MakeHuman weights)"},
        "uv": "UVMap = MakeHuman's standard body UV on every body part (one atlas, MakeHuman skins and masks fit it); "
              "FaceDecalUV on Mesh_Head and Part_Nose = the old planar face rect (u 0..0.5, v 0.5..1).",
        "restPose": "MakeHuman default A-pose (arms about 45 degrees down)",
        "recipe": R,
    }
    json.dump(meta, open(os.path.join(EXPORT, "base_body_meta.json"), "w"), indent=1)


def write_species(km, KEYS, PM, PF, lm):
    old = json.load(open(os.path.join(CHAR, "export", "species_presets.json")))
    hM = float(PM[lm.body, 2].max())
    hF = float(PF[lm.body, 2].max())
    out = {}
    for sid, d in old.items():
        key = None if sid == "human" else f"Species_{sid.capitalize()}"
        if key and key in KEYS:
            mhM = float(KEYS[key][lm.body, 2].max())
            mhF = mhM * hF / hM
        else:
            mhM, mhF = hM, hF
        e = dict(d)
        e["shapes"] = {key: 1.0} if key else {}
        e["meshHeightM"], e["meshHeightF"] = round(mhM, 4), round(mhF, 4)
        e["rootScaleM"] = round(d["heightM"] / mhM, 4)
        e["rootScaleF"] = round(d["heightF"] / mhF, 4)
        e["parts"] = {"ears": ["Part_Ear_L", "Part_Ear_R"], "nose": ["Part_Nose"], "extra": []}
        out[sid] = e
    json.dump(out, open(os.path.join(EXPORT, "species_presets.json"), "w"), indent=1)


if __name__ == "__main__":
    main()
