"""Stylise_F / Stylise_M: the animated-film look as smooth large-form fields on top of the MakeHuman neutral (local, no GPU).

Every field is a big Gaussian falloff around a landmark (cheek apple, jaw angle, chin, nose, cranium) that moves, scales or
pushes the skin along its normal.  A protection mask keeps the fine anatomy untouched: lid rims (around each eyeball),
the lips' inner line and inner mouth, nostril rims and the ears get weight 0 with a soft edge, so the forms move around
them and Blink / visemes still work.  The fields are evaluated on the final neutral coordinates; the result is a delta that
build_mh.py stores as the blend shapes Stylise_F (evaluated on the feminine neutral) and Stylise_M (masculine neutral).

Field spec (recipe.json -> "<sex>": {"stylise_local": [...]})
  {"at": landmark, "r": radius m, "move": [dx,dy,dz] m, "scale": [sx,sy,sz] about the landmark, "push": m along the normal,
   "sym": true (mirror for _L/_R landmarks), "sq": [ax, ay, az] anisotropic radius factors}
Landmarks: cheek_L (the apple, below the outer eye), cheekbone_L, jaw_L (jaw angle), chin, nose, nose_tip, brow_L, crown,
mouth, temple_L.  _R mirrors.
"""
import numpy as np

import stylise_mh as st


def normals(lm, P):
    n = np.zeros_like(P)
    for f in lm.faces:
        p = P[list(f)]
        c = np.cross(p[1] - p[0], p[2] - p[0])
        if len(f) == 4:
            c += np.cross(p[2] - p[0], p[3] - p[0])
        for v in f:
            n[v] += c
    return n / np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-12)


def eye(B, P, side):
    E = B.groups["helper-l-eye" if side == "L" else "helper-r-eye"]
    c = P[E].mean(axis=0)
    return c, float(np.linalg.norm(P[E] - c, axis=1).mean())


def landmark(B, lm, P, name):
    side = name[-1] if name[-2:] in ("_L", "_R") else None
    s = 1 if side != "R" else -1
    base = name[:-2] if side else name
    cL, r = eye(B, P, "L")
    c = np.array([cL[0] * s, cL[1], cL[2]])
    earL = P[lm.ear_L].mean(axis=0)
    ear = np.array([earL[0] * s, earL[1], earL[2]])
    nose = lm.nose_set(0.5)
    tip = P[nose][np.argmin(P[nose, 1])]
    if base == "cheek":
        return c + np.array([s * 0.35 * r, -0.4 * r, -2.4 * r])
    if base == "cheekbone":
        return c + np.array([s * 1.5 * r, 0.3 * r, -1.5 * r])
    if base == "temple":
        return c + np.array([s * 2.0 * r, 1.5 * r, 1.2 * r])
    if base == "jaw":
        return np.array([ear[0] * 0.80, ear[1] - 0.010, P[lm.chin, 2] + 0.35 * (ear[2] - P[lm.chin, 2])])
    if base == "brow":
        return c + np.array([s * 0.2 * r, -0.4 * r, 2.0 * r])
    if base == "chin":
        return P[lm.chin] + np.array([0, 0, 0.008])
    if base == "nose":
        return (tip + P[lm.subnasale]) / 2 + np.array([0, 0.006, 0.006])
    if base == "nose_tip":
        return tip
    if base == "mouth":
        return P[lm.lipContact]
    if base == "crown":
        top = P[lm.crown]
        return top + np.array([0, 0.03, -0.06])
    raise KeyError(name)


def protect(B, lm, P):
    """1 = free, 0 = protected (lid rims, inner lips / mouth, nostril rims, ears), soft edges."""
    w = np.ones(len(P))
    for sd in ("L", "R"):
        c, r = eye(B, P, sd)
        d = np.linalg.norm(P - c, axis=1)
        w *= st.smoothstep(1.6 * r, 2.3 * r, d)          # round 21: the eye region stays plain MakeHuman
    # inner lips and mouth: vertices behind the lip front, near the mouth line
    lc = P[lm.lipContact]
    mouth = (np.abs(P[:, 0]) < 0.035) & (np.abs(P[:, 2] - lc[2]) < 0.012) & (P[:, 1] > lc[1] + 0.002)
    w[mouth] = 0
    # nostril rims: the lower nose core
    ns = lm.nose_score
    low = P[:, 2] < P[lm.subnasale, 2] + 0.012
    w *= 1 - np.clip((ns - 0.55) * 4, 0, 1) * low
    w[B.groups["ears"]] *= 0.0
    return w


def delta(B, lm, P, fields):
    if not fields:
        return np.zeros_like(P)
    N = normals(lm, P)
    prot = protect(B, lm, P)
    D = np.zeros_like(P)
    body = B.body_mask
    for f in fields:
        names = [f["at"]]
        if f.get("sym", True) and f["at"].endswith("_L"):
            names.append(f["at"][:-2] + "_R")
        for nm in names:
            s = -1 if nm.endswith("_R") else 1
            c = landmark(B, lm, P, nm)
            sq = np.array(f.get("sq", [1, 1, 1]), float)
            d = np.linalg.norm((P - c) / sq, axis=1) / f["r"]
            w = np.exp(-d * d * 2.0)
            wp = w * (prot if f.get("protect", True) else 1.0)
            if "move" in f:
                mv = np.array(f["move"], float) * [s, 1, 1]
                D += wp[:, None] * mv
            if "scale" in f:
                sc = np.array(f["scale"], float)
                D += wp[:, None] * (P - c) * (sc - 1)
            if "push" in f:
                D += (wp * f["push"])[:, None] * N
    # helpers (eyeballs, teeth, tongue anchors) follow the nearby skin: give each helper vertex the mean delta of the
    # body vertices around it so the eyeballs stay seated in the sockets
    helpers = np.nonzero(~body)[0]
    if len(helpers):
        from mathutils.kdtree import KDTree
        bi = np.nonzero(body)[0]
        kd = KDTree(len(bi))
        for i, v in enumerate(bi):
            kd.insert(P[v], i)
        kd.balance()
        for h in helpers:
            near = kd.find_n(P[h], 8)
            idx = [bi[i] for _, i, _ in near]
            D[h] = D[idx].mean(axis=0)
    return D
