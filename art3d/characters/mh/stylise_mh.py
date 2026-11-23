"""Neutral feminine / masculine coordinates from recipe.json: MakeHuman macros + MakeHuman detail targets (the face and body
"stylise" weights) + one smooth spatial proportion warp (height, head size, leg length).

The warp is a pure function of position with parameters fixed at the neutral, so every blend shape can be pushed through
the same map (key coords = warp(pre + MakeHuman delta)) and stays consistent with the neutral.  The neutral's total
stylise delta (targets + warp) is also written as a MakeHuman .target file (mh/targets/stylise_<sex>.target), so the
look can be loaded on a plain MakeHuman / MPFB human as well.
"""
import os, json
import numpy as np
import mhcore as mc

HERE = os.path.dirname(os.path.abspath(__file__))


def load_recipe():
    return json.load(open(os.path.join(HERE, "recipe.json")))


def expand(targets):
    """'eyes/*-eye-scale-incr': w  ->  both l- and r- files.  Keys starting with '!' are skipped (notes)."""
    out = {}
    for k, w in targets.items():
        if k.startswith("!") or abs(w) < 1e-9:
            continue
        if "*-" in k:
            for s in ("l-", "r-"):
                kk = k.replace("*-", s)
                out[kk] = out.get(kk, 0.0) + w
        else:
            out[k] = out.get(k, 0.0) + w
    return out


def apply_targets(B, P, targets):
    P = P.copy()
    for k, w in expand(targets).items():
        P += w * B.target(k)
    return P


def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def soft_min(z, c, d):
    """C1 'min(z, c)' with a quadratic blend of half width d."""
    out = np.where(z < c - d, z, c)
    m = (z >= c - d) & (z <= c + d)
    t = z[m] - (c - d)
    out = out.astype(float)
    out[m] = (c - d) + t - t * t / (4 * d)
    return out


class Warp:
    """p -> p': uniform scale s (feet stay on the ground), leg stretch a below the crotch, head scale k about the neck."""

    def __init__(self, s=1.0, a=1.0, k=1.0, crotch=0.8, neck=(0.0, 0.0, 1.4), neck_band=(1.30, 1.40), lift=0.0,
                 width=None):
        self.s, self.a, self.k = s, a, k
        self.crotch = crotch
        self.neck = np.array(neck, float)
        self.neck_band = neck_band
        self.width = width or []

    def __call__(self, P):
        P = np.array(P, float)
        # 1. local width fields (x scale about the midline in a height band), before the vertical changes
        for (z0, z1, z2, z3, kx, ky) in self.width:
            w = smoothstep(z0, z1, P[:, 2]) * (1 - smoothstep(z2, z3, P[:, 2]))
            P[:, 0] *= 1 + (kx - 1) * w
            P[:, 1] = P[:, 1] * (1 + (ky - 1) * w)
        # 2. head scale about the neck point, fading over the neck band
        w = smoothstep(self.neck_band[0], self.neck_band[1], P[:, 2])[:, None]
        P = self.neck + (P - self.neck) * (1 + (self.k - 1) * w)
        # 3. leg stretch: z' = z + (a - 1) * softmin(z, crotch)
        P[:, 2] = P[:, 2] + (self.a - 1) * soft_min(P[:, 2], self.crotch, 0.06)
        # 4. uniform scale about the ground point
        P = P * self.s
        return P

    def params(self):
        return dict(s=self.s, a=self.a, k=self.k, crotch=self.crotch, neck=self.neck.tolist(), neck_band=list(self.neck_band),
                    width=self.width)


def quick(P, lm):
    """height, head height, crotch height (fast numbers for the warp solve)."""
    b = lm.body
    z0 = P[b, 2].min()
    top = P[b, 2].max()
    chin = P[lm.chin, 2]
    mid = P[b][(np.abs(P[b, 0]) < 0.004)]
    ht = top - z0
    mid = mid[(mid[:, 2] > z0 + 0.3 * ht) & (mid[:, 2] < z0 + 0.6 * ht)]
    return ht, top - chin, mid[:, 2].min() - z0


def solve_warp(P, lm, height, heads, crotch_frac, width=None):
    """parameters so that the warped neutral has the wanted height, heads-tall and crotch height (fixed-point iteration)."""
    z0 = P[lm.body, 2].min()
    P = P - [0, 0, z0]
    ht, hh, cz = quick(P, lm)
    chin = P[lm.chin, 2]
    nb = lm.joint(P, "joint-neck")
    neck = (0.0, float(nb[1]), float(chin - 0.02))
    band = (float(nb[2]), float(chin - 0.005))
    s, a, k = 1.0, 1.0, 1.0
    for _ in range(40):
        W = Warp(s, a, k, cz, neck, band, width=width)
        Q = W(P)
        h1, hh1, c1 = quick(Q, lm)
        k *= ((h1 / heads) / hh1) ** 0.7
        a *= (crotch_frac / (c1 / h1)) ** 0.9
        s *= (height / h1) ** 0.9
    W = Warp(s, a, k, cz, neck, band, width=width)
    return W, P


def custom_fields(B, lm, P, fields):
    """our own stylise fields (deltas on the hm08 topology), evaluated on the current coordinates:
    eye_scale: scale the eye region (eyeball helper, lids, socket) about each eyeball centre, smooth falloff
               {s: uniform, sx: extra x, sz: extra z, r1: full-effect radius / eyeball radius, r2: zero radius / eyeball radius}
    """
    D = np.zeros_like(P)
    for f in fields:
        if f["type"] == "eye_scale":
            for g in ("helper-l-eye", "helper-r-eye"):
                E = B.groups[g]
                c = P[E].mean(axis=0)
                r = np.linalg.norm(P[E] - c, axis=1).mean()
                d = np.linalg.norm(P - c, axis=1)
                w = 1 - smoothstep(f.get("r1", 1.3) * r, f.get("r2", 2.4) * r, d)
                S = np.array([f["s"] * f.get("sx", 1.0), f["s"] * f.get("sy", 1.0), f["s"] * f.get("sz", 1.0)])
                D += ((P - c) * (S - 1) + np.array(f.get("move", [0, 0, 0])) * [1 if g[7] == "l" else -1, 1, 1]) * w[:, None]
        elif f["type"] == "mannequin":
            # smooth mannequin (plan G9 'mannequin rule'): Laplacian-smooth the nipples and the groin of both sexes
            Q = P + D
            n = len(Q)
            sel = np.zeros(n)
            for g in ("nipple", "nippleTip"):
                for side in (1, -1):
                    idx = B.groups[g][Q[B.groups[g], 0] * side > 0]
                    cc = Q[idx].mean(axis=0)
                    d = np.linalg.norm(Q - cc, axis=1)
                    sel = np.maximum(sel, 1 - smoothstep(f.get("nipple_r", 0.018), f.get("nipple_r", 0.018) * 2.2, d))
            hips = (lm.joint(Q, "joint-l-upper-leg") + lm.joint(Q, "joint-r-upper-leg")) / 2
            gc = np.array([0.0, hips[1] - 0.05, hips[2] - 0.06])
            d = np.linalg.norm((Q - gc) * [1.0, 1.0, 0.8], axis=1)
            sel = np.maximum(sel, (1 - smoothstep(f.get("groin_r", 0.05), f.get("groin_r", 0.05) * 1.8, d)) * (Q[:, 1] < hips[1]))
            sel[~lm.B.body_mask] = 0
            nb = getattr(lm, "_nb", None)
            if nb is None:
                rows, cols = [], []
                for fc in lm.faces:
                    for i in range(len(fc)):
                        a_, b_ = fc[i], fc[(i + 1) % len(fc)]
                        rows += [a_, b_]
                        cols += [b_, a_]
                E = np.unique(np.stack([rows, cols], axis=1), axis=0)
                deg = np.bincount(E[:, 0], minlength=n).astype(float)
                lm._nb = (E, deg)
                nb = lm._nb
            E, deg = nb
            X = Q.copy()
            for _ in range(f.get("iters", 40)):
                S = np.zeros_like(X)
                np.add.at(S, E[:, 0], X[E[:, 1]])
                L = S / np.maximum(deg, 1)[:, None]
                X = X + (L - X) * (0.6 * sel)[:, None]
            D += X - Q
        elif f["type"] == "soften":
            # stylised soft skin: Laplacian smoothing around the mouth corners / nasolabial folds (no creases)
            Q = P + D
            sel = np.zeros(len(Q))
            if f.get("region", "mouth") == "mouth":
                for v in (lm.mouthCorner_L, lm.mouthCorner_R):
                    c = Q[v] + np.array([np.sign(Q[v, 0]) * 0.006, 0.004, 0.012])
                    d = np.linalg.norm(Q - c, axis=1)
                    sel = np.maximum(sel, 1 - smoothstep(f.get("r", 0.022), f.get("r", 0.022) * 1.8, d))
            elif f.get("region") == "eyelids":
                # upper lids and under-eye: smooth MakeHuman's age ridges; lid margins (within 1.25 r) untouched
                for g in ("helper-l-eye", "helper-r-eye"):
                    E = B.groups[g]
                    ce = Q[E].mean(axis=0)
                    r = np.linalg.norm(Q[E] - ce, axis=1).mean()
                    d = np.linalg.norm(Q - ce, axis=1)
                    sel = np.maximum(sel, smoothstep(1.25 * r, 1.6 * r, d) * (1 - smoothstep(2.1 * r, 2.7 * r, d)) * (Q[:, 1] < ce[1] + 0.2 * r))
            else:
                # cheeks: one soft volume from under the eye to the jaw; lids, nose and lips protected
                for g in ("helper-l-eye", "helper-r-eye"):
                    E = B.groups[g]
                    ce = Q[E].mean(axis=0)
                    r = np.linalg.norm(Q[E] - ce, axis=1).mean()
                    c = ce + np.array([np.sign(ce[0]) * 0.5 * r, -0.6 * r, -2.6 * r])
                    d = np.linalg.norm((Q - c) * [1.0, 1.0, 0.8], axis=1)
                    sel = np.maximum(sel, 1 - smoothstep(f.get("r", 0.03), f.get("r", 0.03) * 1.7, d))
                    sel *= smoothstep(1.25 * r, 1.7 * r, np.linalg.norm(Q - ce, axis=1))
                sel *= (1 - np.clip(lm.nose_score * 2.0, 0, 1))
                # keep the jaw, chin and mouth out (the chin landmark drives the head-size solve)
                zl = Q[lm.lipContact, 2]
                sel *= smoothstep(zl + 0.002, zl + 0.014, Q[:, 2])
            sel[lm.lips] *= 0.2
            sel[~lm.B.body_mask] = 0
            D += _lap(lm, Q, sel * f.get("k", 0.5), f.get("iters", 12), taubin=f.get("taubin", False)) - Q
        elif f["type"] == "brow_flatten":
            # push the brow ridge back (side / 3/4 views: the brow must not stick out); smooth bump above each eye
            Q = P + D
            for g in ("helper-l-eye", "helper-r-eye"):
                E = B.groups[g]
                c = Q[E].mean(axis=0)
                r = np.linalg.norm(Q[E] - c, axis=1).mean()
                bc = c + np.array([np.sign(c[0]) * 0.15 * r, -0.6 * r, 1.9 * r])
                d = np.linalg.norm((Q - bc) / np.array([2.0 * r, 2.5 * r, 1.1 * r]), axis=1)
                w = np.exp(-d * d * 1.5) * (Q[:, 1] < c[1])
                w[~lm.B.body_mask] = 0
                D[:, 1] += f.get("amount", 0.0015) * w
        elif f["type"] == "lids":
            # rotate the upper lid down over the iris / the lower lid up, about each eyeball centre's x axis, so the lids
            # slide on the eyeball; full effect at the lid margins, fading towards the brow and cheek
            for g in ("helper-l-eye", "helper-r-eye"):
                E = B.groups[g]
                c = P[E].mean(axis=0)
                r = np.linalg.norm(P[E] - c, axis=1).mean()
                Q = P + D - c
                d = np.linalg.norm(Q, axis=1)
                near = (1 - smoothstep(f.get("r1", 1.2) * r, f.get("r2", 2.1) * r, d)) * (Q[:, 1] < 0.2 * r) * lm.B.body_mask
                for key, sgn, lo_, hi_ in (("upper", 1, -0.25, 0.15), ("lower", -1, -0.15, 0.25)):
                    ang = np.radians(f.get(key, 0.0))
                    if ang == 0:
                        continue
                    if sgn > 0:
                        w = near * smoothstep(lo_ * r, hi_ * r, Q[:, 2])
                    else:
                        w = near * (1 - smoothstep(-hi_ * r, -lo_ * r, Q[:, 2]))
                    a = sgn * ang * w
                    ca, sa = np.cos(a), np.sin(a)
                    y2 = Q[:, 1] * ca - Q[:, 2] * sa
                    z2 = Q[:, 1] * sa + Q[:, 2] * ca
                    D[:, 1] += (y2 - Q[:, 1]) * (w > 0)
                    D[:, 2] += (z2 - Q[:, 2]) * (w > 0)
                    Q = P + D - c
                yaw = np.radians(f.get("lower_yaw", 0.0))
                if yaw:
                    # turn the lower lid about the eyeball's vertical axis: its lowest point moves toward the ear (almond)
                    sx = 1.0 if g == "helper-l-eye" else -1.0
                    w = near * (1 - smoothstep(-0.15 * r, 0.25 * r, Q[:, 2]))
                    a = sx * yaw * w
                    ca, sa = np.cos(a), np.sin(a)
                    x2 = Q[:, 0] * ca - Q[:, 1] * sa
                    y2 = Q[:, 0] * sa + Q[:, 1] * ca
                    D[:, 0] += (x2 - Q[:, 0]) * (w > 0)
                    D[:, 1] += (y2 - Q[:, 1]) * (w > 0)
                    Q = P + D - c
    return D


def _lap(lm, Q, sel, iters, taubin=False):
    n = len(Q)
    nb = getattr(lm, "_nb", None)
    if nb is None:
        rows, cols = [], []
        for fc in lm.faces:
            for i in range(len(fc)):
                a_, b_ = fc[i], fc[(i + 1) % len(fc)]
                rows += [a_, b_]
                cols += [b_, a_]
        E = np.unique(np.stack([rows, cols], axis=1), axis=0)
        deg = np.bincount(E[:, 0], minlength=n).astype(float)
        lm._nb = nb = (E, deg)
    E, deg = nb
    X = Q.copy()
    for it in range(iters):
        S = np.zeros_like(X)
        np.add.at(S, E[:, 0], X[E[:, 1]])
        f = 1.0 if (not taubin or it % 2 == 0) else -1.06      # Taubin: shrink then inflate (smooths without losing volume)
        X = X + (S / np.maximum(deg, 1)[:, None] - X) * (sel * f)[:, None]
    return X


def apply_sliders(B, P, r):
    """the editor's 'Save as neutral' sliders (recipe[sex]["sliders"]): each slider adds its blend-shape recipe
    (MakeHuman targets and macro changes; custom lid fields of Eye_Round / Eye_Hooded are not included) at its value."""
    sl = r.get("sliders") or {}
    if not sl:
        return P
    import shapes_mh as sh
    table = dict(sh.VARIATION, **sh.BODY_SLIDERS)
    P = P.copy()
    base_m = None
    for name, v in sl.items():
        if name not in table or abs(v) < 1e-6:
            continue
        pos, neg = table[name]
        key, w = (pos, v) if (neg is None or v >= 0) else (neg, -v)
        spec = sh.ALL[key]
        for k, tw in expand(spec.get("t", {})).items():
            P += w * tw * B.target(k)
        if "macro" in spec:
            m0 = dict(r["macro"])
            m1 = dict(m0, **spec["macro"])
            P += w * (B.macro(m1) - B.macro(m0))
    return P


def neutral(B, lm, recipe, sex):
    """pre-warp coordinates (macro + targets + custom fields, feet on the ground) and the solved warp for 'F' or 'M'."""
    r = recipe[sex]
    P = B.macro(r["macro"])
    P = apply_targets(B, P, r["targets"])
    P = apply_sliders(B, P, r)
    P = P + custom_fields(B, lm, P, r.get("fields", []))
    P = P - [0, 0, P[lm.body, 2].min()]
    st = r["stylise"]
    W, P = solve_warp(P, lm, st["height"], st["heads"], st["crotch"], width=[tuple(x) for x in st.get("width", [])])
    return P, W


def final(B, lm, recipe, sex, stylise=None):
    """final neutral coordinates; with the local Stylise fields applied unless stylise is False
    (default: recipe["preview_stylise"], true)."""
    Ppre, W = neutral(B, lm, recipe, sex)
    P = W(Ppre)
    if stylise is None:
        stylise = recipe.get("preview_stylise", True)
    if stylise:
        import stylise_local
        P = P + stylise_local.delta(B, lm, P, recipe[sex].get("stylise_local", []))
    return P


def write_stylise_target(B, recipe, sex, P_pre_targets, P_final):
    os.makedirs(os.path.join(HERE, "targets"), exist_ok=True)
    path = os.path.join(HERE, "targets", f"stylise_{sex.lower()}.target")
    mc.write_target(path, P_final - P_pre_targets, header=f"total stylise delta for the {sex} neutral relative to the MakeHuman "
                    f"macro human {json.dumps(recipe[sex]['macro'])}; apply at weight 1 on that macro setting")
    return path
