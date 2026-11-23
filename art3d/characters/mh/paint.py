"""Per-vertex skin tint for previews (and the bake source for the head texture later): lip colour from MakeHuman's `lips`
group, soft blush on cheeks, nose tip and ears, a darker lid line along the upper lash line.  Multipliers on the tone."""
import numpy as np
import mhcore as mc


def smooth(vals, faces, n, it=1):
    """one-ring averaging over the face graph (it passes)."""
    nb = [set() for _ in range(n)]
    for f in faces:
        for a in f:
            nb[a].update(f)
    for _ in range(it):
        new = vals.copy()
        for i in range(n):
            if nb[i]:
                new[i] = vals[list(nb[i])].mean(axis=0)
        vals = new
    return vals


def tint(P, lm, B, lip=(0.80, 0.50, 0.54), blush=0.55, liner=0.0, sex=1.0):
    n = len(P)
    T = np.ones((n, 3))
    # subtle natural lip tint, darker along the lip line and into the corners (no bright band)
    w = np.zeros(n)
    w[lm.lips] = 1.0
    w = smooth(w[:, None], lm.faces, n, it=2)[:, 0]
    sto = P[lm.lipContact]
    line = np.exp(-((P[:, 2] - sto[2]) / 0.0018) ** 2)
    for v in (lm.mouthCorner_L, lm.mouthCorner_R):
        line = np.maximum(line, 0.6 * np.exp(-(np.linalg.norm(P - P[v], axis=1) / 0.004) ** 2))
    line *= w
    lipc = np.array(lip)
    T = T * (1 - w[:, None]) + lipc * w[:, None]
    T = T * (1 - 0.22 * line[:, None] * np.array([0.6, 1.0, 1.0]))
    # blush: cheeks below the outer eye, nose tip, ears
    b = np.zeros(n)
    for g in ("helper-l-eye", "helper-r-eye"):
        c = P[B.groups[g]].mean(axis=0)
        r = np.linalg.norm(P[B.groups[g]] - c, axis=1).mean()
        cc = c + np.array([0.6 * r * np.sign(c[0]), -1.2 * r, -2.1 * r])
        d = np.linalg.norm(P - cc, axis=1)
        b = np.maximum(b, np.exp(-(d / (1.9 * r)) ** 2))
    nose = lm.nose_set(0.5)
    tip = P[nose][np.argmin(P[nose, 1])]
    b = np.maximum(b, 0.7 * np.exp(-(np.linalg.norm(P - tip, axis=1) / 0.012) ** 2))
    ears = np.zeros(n)
    ears[B.groups["ears"]] = 0.6
    b = np.maximum(b, ears)
    b *= blush
    T *= (1 - b[:, None] * np.array([0.0, 0.26, 0.24]))
    return T


def face_mask(P, lm, B):
    """per-vertex face mask (contract channel layout, also baked to export/textures/face_mask_<f|m>.png):
    R = lip gloss (1 on the lips, soft edge, strongest on the lower-lip centre and the upper-lip tubercle),
    G = blush amount (cheeks, nose, ears), B = 0 (reserved)."""
    n = len(P)
    w = np.zeros(n)
    w[lm.lips] = 1.0
    w = smooth(w[:, None], lm.faces, n, it=1)[:, 0]
    sto = P[lm.lipContact]
    centre = np.exp(-(np.abs(P[:, 0]) / 0.012) ** 2)
    g = w * (0.65 + 0.35 * centre)
    blush = np.zeros(n)
    for gname in ("helper-l-eye", "helper-r-eye"):
        c = P[B.groups[gname]].mean(axis=0)
        r = np.linalg.norm(P[B.groups[gname]] - c, axis=1).mean()
        cc = c + np.array([0.6 * r * np.sign(c[0]), -1.2 * r, -2.1 * r])
        blush = np.maximum(blush, np.exp(-(np.linalg.norm(P - cc, axis=1) / (1.9 * r)) ** 2))
    M = np.zeros((n, 3))
    M[:, 0] = np.clip(g, 0, 1)
    M[:, 1] = np.clip(blush, 0, 1)
    return M
