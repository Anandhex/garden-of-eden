"""Our upper lash-and-liner ribbon and the brow-card snapping (round 12, user feedback: no fuzzy strand lashes, brows flat).

LashRibbon: a thin solid strip hugging the upper lid, rooted on MakeHuman's own upper lash helper line
(`helper-{l,r}-eyelashes-2`, the root edge that touches the lid), widening towards the outer corner and ending in a small
flick out and up.  Like a MakeHuman proxy it is a function of the hm08 coordinates (`fit(P)`), so it follows every blend
shape.  It replaces the MakeHuman strand lash cards (eyelashes01-03 stay available as an option).

snap_cards(): pulls card vertices (the MakeHuman brow proxy) onto the skin plus a small lift, so brows lie flat.
"""
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree
from mathutils.kdtree import KDTree


class LashRibbon:
    """solid lash-and-liner ribbon rooted ON the lid margins (round 17).

    The roots are fixed hm08 vertices of the lid margin where the lid meets the eyeball, found once on a reference shape
    (Pref) from the visible eye opening (measure_mh.eye_aperture): for every column of the opening, the skin vertex nearest
    to the edge point on the eyeball.  So the ribbon follows every blend shape and the blink exactly.
    Upper ribbon: from near the inner corner (almost zero width) to the outer corner, thickest in the outer third, curving
    up and out, with a wing that continues the lash line from the outer corner.  Lower ribbon (optional): a few short thin
    lashes along the outer half of the lower lid."""
    name = "lash_ribbon"
    _last = {}

    def __init__(self, B, lm, Pref, eyes_px=None, width=(0.00005, 0.0011), flick=0.0030, flick_angle=18.0, lift=0.0002,
                 tuck=0.0002, n=28, front=0.0004, start=0.03, lower=0.0, lower_width=0.00035, recompute=False, moving=None, **_ignored):
        import measure_mh as mm
        import mhcore as mc
        self.B, self.lm = B, lm
        self.width, self.flick, self.flick_angle, self.lift, self.tuck, self.n = width, flick, flick_angle, lift, tuck, n
        self.front, self.lower, self.lower_width = front, lower, lower_width
        if eyes_px is None:
            eyes_px = mc.Proxy(mc.proxy_file("eyes", "high-poly"))
        E = eyes_px.fit(Pref)
        head_all = np.array([v for v in lm.body if lm.vpart[v] == "head"])
        self.sides = []
        for sd, eg in (("L", "helper-l-eye"), ("R", "helper-r-eye")):
            # only lid skin hugging the eyeball (moves with the blink), never the fold or canthus skin around it
            ce = Pref[B.groups[eg]].mean(axis=0)
            rr = np.linalg.norm(Pref[B.groups[eg]] - ce, axis=1).mean()
            head = head_all[np.linalg.norm(Pref[head_all] - ce, axis=1) < 1.18 * rr]
            if moving is not None:                         # upper roots: only skin the blink actually moves (the upper lid)
                head_up = head[moving[head]]
            else:
                head_up = head
            kd_up = KDTree(len(head_up))
            for i, v in enumerate(head_up):
                kd_up.insert(Pref[v], i)
            kd_up.balance()
            kd = KDTree(len(head))
            for i, v in enumerate(head):
                kd.insert(Pref[v], i)
            kd.balance()
            import json as _j, os as _o
            cf = _o.path.join(_o.path.dirname(_o.path.abspath(__file__)), "cache", "lash_roots.json")
            O = None
            if recompute or not _o.path.exists(cf):
                mm.eye_aperture(Pref, lm, E, eyes_px.faces, side=sd, step=0.0003)
                O = mm.eye_aperture.cells
            if O is None or len(O) < 20:
                # closed or nearly closed eyes: reuse the last open eye's root vertices (same topology for everyone)
                if sd not in LashRibbon._last or True:
                    import json as _j, os as _o
                    f = _o.path.join(_o.path.dirname(_o.path.abspath(__file__)), "cache", "lash_roots.json")
                    d = _j.load(open(f))[sd]
                    LashRibbon._last[sd] = dict(side=sd, up=[tuple(x) for x in d["up"]], lo=[tuple(x) for x in d["lo"]],
                                                eye=B.groups[eg])
                self.sides.append(dict(LashRibbon._last[sd]))
                continue
            cols = np.round(O[:, 0] / 0.0003).astype(int)
            up, lo = [], []
            for c in sorted(set(cols.tolist()), key=lambda c: abs(c)):
                q = O[cols == c]
                up.append(q[np.argmax(q[:, 2])])
                lo.append(q[np.argmin(q[:, 2])])
            def roots(edge, dz, kd=kd, head=head):
                """edge point on the eyeball -> the posterior lid-margin vertex -> the ANTERIOR margin vertex (the most
                forward skin vertex within 1.8 mm that is not further from the opening), where lashes grow"""
                out = []
                for p in edge:
                    co, i, d = kd.find((p[0], p[1] - 0.0008, p[2] + dz))
                    best = int(head[i])
                    if not out or out[-1] != best:
                        out.append(best)
                return out
            ur = roots(up, 0.0003, kd_up, head_up)
            lr = roots(lo[len(lo) // 2:], -0.0003)
            self.sides.append(dict(side=sd, up=self._stations(Pref, ur, start, n), lo=self._stations(Pref, lr, 0.0, max(n // 2, 4)),
                                   eye=B.groups[eg]))
            LashRibbon._last[sd] = self.sides[-1]
            try:
                import json as _j, os as _o
                f = _o.path.join(_o.path.dirname(_o.path.abspath(__file__)), "cache", "lash_roots.json")
                d = _j.load(open(f)) if _o.path.exists(f) else {}
                d[sd] = dict(up=[[int(a), int(b), float(t)] for a, b, t in self.sides[-1]["up"]],
                             lo=[[int(a), int(b), float(t)] for a, b, t in self.sides[-1]["lo"]])
                _j.dump(d, open(f, "w"))
            except OSError:
                pass
        # topology: per side, an upper strip of 3 rows (root, middle, tip) and a lower strip of 3 rows; no wing
        self.faces, uv = [], []
        off = 0
        for s_ in self.sides:
            for key, on in (("up", True), ("lo", self.lower > 0)):
                if not on:
                    continue
                m = len(s_[key])
                for r in range(2):
                    for k in range(m - 1):
                        a = off + r * m + k
                        self.faces.append((a, a + 1, a + m + 1, a + m) if key == "up" else (a, a + m, a + m + 1, a + 1))
                for r, v in enumerate((0.0, 0.5, 1.0)):
                    uv += [(k / (m - 1), v) for k in range(m)]
                off += 3 * m
        self.uv = np.array(uv)
        self.face_uv = [list(f) for f in self.faces]
        self.nv = off

    @staticmethod
    def _stations(P, root, start, n):
        R = P[root]
        L = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(R, axis=0), axis=1))])
        st = []
        for t in np.linspace(start * L[-1], L[-1], n):
            j = min(np.searchsorted(L, t, side="right") - 1, len(root) - 2)
            a = (t - L[j]) / max(L[j + 1] - L[j], 1e-9)
            st.append((root[j], root[j + 1], float(np.clip(a, 0, 1))))
        return st

    def _strip(self, P, st, c, length, up_side=True):
        """3 rows following the lid margin: root just behind the lid edge, strands perpendicular to the edge (away from the
        eyeball, a little forward), curling further away from the eyeball; length by the profile."""
        R = np.array([P[a] * (1 - t) + P[b] * t for a, b, t in st])
        m = len(R)
        T = np.gradient(R, axis=0)
        T /= np.maximum(np.linalg.norm(T, axis=1, keepdims=True), 1e-12)
        rad = R - c
        rad /= np.linalg.norm(rad, axis=1, keepdims=True)
        n = rad - (rad * T).sum(axis=1, keepdims=True) * T          # away from the eyeball, perpendicular to the lid edge
        n /= np.linalg.norm(n, axis=1, keepdims=True)
        fwd = np.array([0.0, -1.0, 0.0])
        f = fwd - (fwd @ T.T)[:, None] * T if False else np.tile(fwd, (m, 1)) - (T @ fwd)[:, None] * T
        d1 = n * 0.35 + f * 0.95
        d1 /= np.linalg.norm(d1, axis=1, keepdims=True)
        # curl: in the plane of the lash, turning away from the eye (up for the upper lid, down for the lower lid); it
        # rotates with the lid, so closed lashes rest pointing down-forward with a slight curl
        u = np.cross(d1, T)
        u /= np.maximum(np.linalg.norm(u, axis=1, keepdims=True), 1e-12)
        if (u[len(u) // 2, 2] < 0) == up_side:
            u = -u
        d2 = d1 * 0.6 + u * 0.8
        d2 /= np.linalg.norm(d2, axis=1, keepdims=True)
        root = R + fwd * self.front - d1 * self.tuck
        mid = root + d1 * (length * 0.45)[:, None]
        return root, mid, mid + d2 * (length * 0.55)[:, None]

    def fit(self, P):
        out = []
        for s in self.sides:
            c = P[s["eye"]].mean(axis=0)
            m = len(s["up"])
            t = np.linspace(0, 1, m)
            a_, b_ = 1.7, 0.8                     # length profile: short at both corners, longest at ~68 %
            prof = (t ** a_) * ((1 - t) ** b_)
            prof = 0.12 + 0.88 * prof / prof.max()
            out += list(self._strip(P, s["up"], c, self.width[1] * prof, True))
            if self.lower > 0:
                ml = len(s["lo"])
                tl = np.linspace(0, 1, ml)
                pl = 0.25 + 0.75 * np.sin(np.pi * np.clip(tl * 0.85 + 0.1, 0, 1))
                out += list(self._strip(P, s["lo"], c, self.lower_width * self.lower * pl, False))
        return np.concatenate(out)


BROW_KEYS = ["Brow_Height", "Brow_Thick", "Brow_Length", "Brow_Arch", "Brow_ArchPos", "Brow_Tilt", "Brow_Gap"]
BROW_STYLES = {
    # name: (brow texture, slider preset, density).  One card (eyebrow001 UVs); textures: MakeHuman eyebrow001 or our
    # brow_fine / brow_bushy / brow_groomed / brow_feathered painted on the same layout (make_textures.py).
    "soft arch": ("eyebrow001", {}, 1.0),
    "straight": ("brow_groomed", {"Brow_Arch": -0.9, "Brow_Tilt": -0.3, "Brow_Thick": 0.2}, 1.0),
    "high arch": ("brow_fine", {"Brow_Arch": 0.9, "Brow_ArchPos": 0.3, "Brow_Height": 0.3, "Brow_Thick": -0.2}, 0.9),
    "thick natural": ("brow_bushy", {"Brow_Thick": 0.4, "Brow_Gap": -0.2}, 1.05),
    "thin": ("brow_fine", {"Brow_Thick": -0.8, "Brow_Arch": 0.3}, 0.8),
    "short tail": ("brow_feathered", {"Brow_Length": -0.9, "Brow_Thick": 0.2}, 1.0),
    "angled": ("brow_groomed", {"Brow_Arch": 0.6, "Brow_ArchPos": 0.7, "Brow_Tilt": 0.4}, 1.05),
    "low flat": ("brow_bushy", {"Brow_Height": -0.1, "Brow_Arch": -0.6, "Brow_Thick": 0.1}, 0.95),   # round 24: was -0.5 (sat on the lashes)
}


def deform_brow(Q, params):
    """parametric brow deformation of fitted brow-card vertices Q (both sides), weights -1..1 (1 ~ 2 SD):
    Brow_Height raise, Brow_Thick thicker, Brow_Length longer tail, Brow_Arch higher arch, Brow_ArchPos peak further out,
    Brow_Tilt tail up, Brow_Gap inner ends further apart."""
    if not params or not any(abs(v) > 1e-9 for v in params.values()):
        return Q
    Q = Q.copy()
    g = lambda k: float(params.get(k, 0.0))
    for sx in (1, -1):
        m = Q[:, 0] * sx > 0
        q = Q[m]
        ax = np.abs(q[:, 0])
        x0, x1 = ax.min(), ax.max()
        t = (ax - x0) / max(x1 - x0, 1e-9)
        bins = np.clip((t * 10).astype(int), 0, 9)
        zc_b = np.array([q[bins == b, 2].mean() if np.any(bins == b) else np.nan for b in range(10)])
        idx = np.arange(10)
        ok = ~np.isnan(zc_b)
        zc = np.interp(t * 10 - 0.5, idx[ok], zc_b[ok])
        v = q[:, 2] - zc
        z = zc + v * (1 + 0.65 * g("Brow_Thick"))
        bump = lambda p: np.clip(1 - ((t - p) / 0.45) ** 2, 0, None)
        z += 0.0045 * g("Brow_Height")
        z += 0.0035 * g("Brow_Arch") * bump(0.66)
        z += 0.0035 * g("Brow_ArchPos") * (bump(0.82) - bump(0.62))
        z += 0.0035 * g("Brow_Tilt") * (t - 0.35)
        nx = ax + 0.0060 * g("Brow_Length") * t ** 1.5 + 0.0045 * g("Brow_Gap") * (1 - t)
        # the tail of a longer brow follows the skull: pull it back a little as it goes out
        y = q[:, 1] + 0.004 * g("Brow_Length") * t ** 2
        q[:, 0] = sx * nx
        q[:, 1] = y
        q[:, 2] = z
        Q[m] = q
    return Q


def snap_cards(Q, P, faces, lift=0.0006):
    """move card vertices Q onto the skin surface given by P/faces (closest point) plus `lift` along the skin normal."""
    used = sorted({v for f in faces for v in f})
    rm = {v: i for i, v in enumerate(used)}
    tree = BVHTree.FromPolygons([Vector(p) for p in P[used]], [[rm[v] for v in f] for f in faces])
    out = Q.copy()
    for i, q in enumerate(Q):
        loc, nrm, idx, d = tree.find_nearest(Vector(q))
        if loc is not None:
            if nrm.y > 0.3:              # back-facing hit (inside a fold): keep the card point
                continue
            out[i] = np.array(loc) + np.array(nrm) * lift
    return out


class SnappedProxy:
    """a MakeHuman card proxy whose fitted vertices are snapped onto the head skin (brows); optional brow deformation."""

    def __init__(self, px, lm, brow_params=None):
        self.px, self.lm = px, lm
        self.brow_params = brow_params or {}
        self.vi, self.vw = px.vi, px.vw
        self.faces, self.face_uv, self.uv, self.nv = px.faces, px.face_uv, px.uv, px.nv
        self.head_faces = [f for f, q in zip(lm.faces, lm.fpart) if q == "head"]

    def fit(self, P, extra=None):
        prm = dict(self.brow_params)
        for k, v in (extra or {}).items():
            prm[k] = prm.get(k, 0.0) + v
        return snap_cards(deform_brow(self.px.fit(P), prm), P, self.head_faces)

    def texture(self):
        return self.px.texture()


class TearDuct:
    """small pink tear-duct (caruncle) lens in each inner eye corner, between the lids, in front of the eyeball's inner
    edge.  Anchored on the inner-canthus vertex of the lid ring and the eyeball centre (fixed hm08 vertices), so it follows
    Blink, the face keys and the eye sliders.  Exported as `Part_TearDuct` (material `TearDuct`, Head-weighted)."""
    name = "tear_duct"

    def __init__(self, B, lm, Pref, size=(0.0017, 0.0010, 0.0016), seg=6, rings=4):
        self.B, self.lm = B, lm
        self.size = size
        import measure_mh as mm, mhcore as mc
        eyes_px = mc.Proxy(mc.proxy_file("eyes", "high-poly"))
        E = eyes_px.fit(Pref)
        head = np.array([v for v in lm.body if lm.vpart[v] == "head"])
        self.anchor = []
        for sd, eg in (("L", "helper-l-eye"), ("R", "helper-r-eye")):
            mm.eye_aperture(Pref, lm, E, eyes_px.faces, side=sd, step=0.0003)
            O = mm.eye_aperture.cells
            if O is None or len(O) < 20:
                ci, co, up, lo = lm.eye_frame(Pref, sd)
                p = Pref[ci]
            else:
                p = O[np.argmin(np.abs(O[:, 0]))]           # the visible inner corner, on the eyeball
            v = int(head[np.argmin(np.linalg.norm(Pref[head] - p, axis=1))])
            self.anchor.append((v, B.groups[eg], p - Pref[v]))
        # lenses per side: caruncle (fuller pink bump) and plica semilunaris (thin flat crescent on the eyeball, eye side)
        self.lenses = [((0.0, 0.0, 0.0), size), ((0.0018, 0.0001, 0.0), (0.0005, 0.0006, 0.0030))]
        V, F = [], []
        for k in range(2 * len(self.lenses)):
            off = len(V)
            V.append((0, 0, 1))
            for i in range(1, rings):
                th = np.pi * i / rings
                for j in range(seg):
                    ph = 2 * np.pi * j / seg
                    V.append((np.sin(th) * np.cos(ph), np.sin(th) * np.sin(ph), np.cos(th)))
            V.append((0, 0, -1))
            last = len(V) - 1
            for j in range(seg):
                F.append((off, off + 1 + j, off + 1 + (j + 1) % seg))
            for i in range(rings - 2):
                for j in range(seg):
                    a = off + 1 + i * seg + j
                    b = off + 1 + i * seg + (j + 1) % seg
                    F.append((a, a + seg, b + seg, b))
            base = off + 1 + (rings - 2) * seg
            for j in range(seg):
                F.append((base + j, last, base + (j + 1) % seg))
        self.unit = np.array(V, float)
        self.faces = F
        self.face_uv = [list(f) for f in F]
        self.uv = np.zeros((len(V), 2)) + 0.5
        self.nv = len(V)
        self.per = len(V) // (2 * len(self.lenses))

    def fit(self, P):
        out = []
        nl = len(self.lenses)
        for k, (v, eye, off) in enumerate(self.anchor):
            sx = 1 if k == 0 else -1
            # sits in the tear lake: at the visible inner corner, a little towards the nose and in front of the eyeball
            pos = P[v] + off + np.array([sx * 0.0004, -0.0011, -0.0001])
            for j, (lo, sz) in enumerate(self.lenses):
                i = k * nl + j
                U = self.unit[i * self.per:(i + 1) * self.per] * np.array(sz)
                out.append(pos + np.array([sx * lo[0], lo[1], lo[2]]) + U)
        return np.concatenate(out)


class LashProxy:
    """MakeHuman's own eyelash proxy (fitted by its .mhclo rule, so it sits on the lids and follows the blink) with the
    lashes lengthened and curled: every lash vertex is moved away from its root (the card vertex nearest the lid skin)
    by a length profile along the lid (short at the inner corner, longest at about 2/3, shorter at the outer corner) and
    bent away from the eyeball (upwards for the upper lid when open, down-forward when closed).  Lower lashes are scaled
    by `lower`.  Exposes vi / vw / faces / uv like a Proxy, so weights and blend shapes work the same way."""

    def __init__(self, px, B, lm, Pref, length=1.6, inner=0.35, outer=0.8, curl=0.55, lower=0.8):
        self.px, self.B, self.lm = px, B, lm
        self.vi, self.vw, self.faces, self.face_uv, self.uv, self.nv = px.vi, px.vw, px.faces, px.face_uv, px.uv, px.nv
        self.length, self.inner, self.outer, self.curl, self.lower = length, inner, outer, curl, lower
        Q = px.fit(Pref)
        head = np.array([v for v in lm.body if lm.vpart[v] == "head"])
        kd = KDTree(len(head))
        for i, v in enumerate(head):
            kd.insert(Pref[v], i)
        kd.balance()
        d = np.array([kd.find(q)[2] for q in Q])
        self.eyes = [B.groups["helper-l-eye"], B.groups["helper-r-eye"]]
        cl = Pref[self.eyes[0]].mean(axis=0)
        # roots: per connected card, its vertices closest to the skin
        from collections import defaultdict
        adj = defaultdict(set)
        for f in px.faces:
            for a in f:
                adj[a].update(f)
        comp = -np.ones(len(Q), int)
        c = 0
        for s0 in range(len(Q)):
            if comp[s0] >= 0:
                continue
            st = [s0]
            while st:
                v = st.pop()
                if comp[v] >= 0:
                    continue
                comp[v] = c
                st += list(adj[v])
            c += 1
        self.root = np.arange(len(Q))
        self.isroot = np.zeros(len(Q), bool)
        for k in range(c):
            idx = np.nonzero(comp == k)[0]
            thr = d[idx].min() + 0.6 * (np.percentile(d[idx], 50) - d[idx].min())
            r = idx[d[idx] <= thr]
            self.isroot[r] = True
            for v in idx:
                if not self.isroot[v]:
                    self.root[v] = r[np.argmin(np.linalg.norm(Q[r] - Q[v], axis=1))]
        self.side = np.where(Q[:, 0] > 0, 0, 1)
        ez = Pref[self.eyes[0]].mean(axis=0)[2]
        self.upper = Q[self.root, 2] > ez - 0.001
        self.t = np.zeros(len(Q))
        for sd in (0, 1):
            for up in (True, False):
                m = (self.side == sd) & (self.upper == up)
                if m.any():
                    ax = np.abs(Q[self.root[m], 0])
                    self.t[m] = (ax - ax.min()) / max(ax.max() - ax.min(), 1e-9)
        self.d0 = np.linalg.norm(Q - Q[self.root], axis=1)
        self.dmax = np.maximum(np.array([self.d0[comp == comp[v]].max() for v in range(len(Q))]), 1e-9)

    def fit(self, P):
        Q = self.px.fit(P)
        R = Q[self.root]
        D = Q - R
        t = self.t
        a_, b_ = 1.7, 0.8
        prof = (t ** a_) * ((1 - t) ** b_)
        prof /= ((a_ / (a_ + b_)) ** a_) * ((b_ / (a_ + b_)) ** b_)
        L = np.where(t < 0.66, self.inner + (self.length - self.inner) * prof,
                     self.outer + (self.length - self.outer) * prof)
        L = np.where(self.upper, L, self.lower * (0.6 + 0.4 * np.sin(np.pi * t)))
        out = R + D * L[:, None]
        # curl away from the eyeball: outward radial direction, more at the tips
        for sd in (0, 1):
            c = P[self.eyes[sd]].mean(axis=0)
            m = self.side == sd
            rad = R[m] - c
            rad /= np.maximum(np.linalg.norm(rad, axis=1, keepdims=True), 1e-12)
            frac = (self.d0[m] / self.dmax[m]) ** 1.6
            sign = np.where(self.upper[m], 1.0, 0.6)[:, None]
            out[m] += rad * (self.curl * frac * self.d0[m] * L[m])[:, None] * sign
        out[self.isroot] = Q[self.isroot]
        return out

    def texture(self):
        return self.px.texture()


class OffsetProxy:
    """a proxy moved by a fixed offset in the head frame (teeth set back and down a little behind closed lips)."""

    def __init__(self, px, offset):
        self.px, self.offset = px, np.asarray(offset, float)
        self.vi, self.vw, self.faces, self.face_uv, self.uv, self.nv = px.vi, px.vw, px.faces, px.face_uv, px.uv, px.nv

    def fit(self, P):
        return self.px.fit(P) + self.offset

    def texture(self):
        return self.px.texture()


class BlinkLashProxy:
    """MakeHuman's lash proxy, unchanged when the eye is open; when the lid moves (blink, half-closed), each lash turns
    with its root about the eyeball's horizontal axis instead of keeping its open direction (no bunching / fanning).
    Pref = the same person's open-eye coordinates: at P == Pref the result is exactly the MakeHuman fit."""

    def __init__(self, px, B, lm, Pref):
        self.px, self.B, self.lm = px, B, lm
        self.vi, self.vw, self.faces, self.face_uv, self.uv, self.nv = px.vi, px.vw, px.faces, px.face_uv, px.uv, px.nv
        self.Pref = np.asarray(Pref, float)
        Q = px.fit(self.Pref)
        head = np.array([v for v in lm.body if lm.vpart[v] == "head"])
        kd = KDTree(len(head))
        for i, v in enumerate(head):
            kd.insert(self.Pref[v], i)
        kd.balance()
        # each lash vertex follows the lid vertex nearest to its card's root (the card vertex nearest the skin)
        d = np.array([kd.find(q)[2] for q in Q])
        from collections import defaultdict
        adj = defaultdict(set)
        for f in px.faces:
            for a in f:
                adj[a].update(f)
        comp = -np.ones(len(Q), int)
        c = 0
        for s0 in range(len(Q)):
            if comp[s0] >= 0:
                continue
            st = [s0]
            while st:
                v = st.pop()
                if comp[v] >= 0:
                    continue
                comp[v] = c
                st += list(adj[v])
            c += 1
        self.anchor = np.zeros(len(Q), int)
        for k in range(c):
            idx = np.nonzero(comp == k)[0]
            for v in idx:
                # nearest root of this card along the lid: the card vertex with the smallest skin distance near v
                near = idx[np.argsort(np.linalg.norm(Q[idx] - Q[v], axis=1))[:6]]
                r = near[np.argmin(d[near])]
                self.anchor[v] = int(head[kd.find(Q[r])[1]])
        self.side = np.where(Q[:, 0] > 0, 0, 1)
        self.eyes = [B.groups["helper-l-eye"], B.groups["helper-r-eye"]]
        self.Q0 = Q
        self.rootmask = d <= np.percentile(d, 30)             # lash vertices at the lid margin (they follow the lid)

    def fit(self, P):
        """upper lashes turn rigidly with the upper lid about the eyeball's horizontal axis (the lid's mean rotation,
        from the upper lid-margin vertices); lower lashes keep the MakeHuman fit."""
        P = np.asarray(P, float)
        Q = self.px.fit(P)
        out = Q.copy()
        for sd, key in ((0, "L"), (1, "R")):
            m = self.side == sd
            c0 = self.Pref[self.eyes[sd]].mean(axis=0)
            c1 = P[self.eyes[sd]].mean(axis=0)
            up = m & (self.Q0[:, 2] > c0[2] - 0.001)
            r = up & self.rootmask
            a0 = self.Q0[r] - c0
            a1 = Q[r] - c1
            ra = np.arctan2(a1[:, 2], -a1[:, 1]) - np.arctan2(a0[:, 2], -a0[:, 1])
            if np.abs(ra).max() < 1e-5:
                continue
            # per lash vertex: the mean angle of the 8 nearest margin roots (varies smoothly along the lid)
            R0 = self.Q0[r]
            dd = np.linalg.norm(self.Q0[up][:, None, :] - R0[None, :, :], axis=2)
            nn = np.argsort(dd, axis=1)[:, :8]
            ang = ra[nn].mean(axis=1)
            off = self.Q0[up] - c0
            ca, sa = np.cos(ang), np.sin(ang)
            u, z = -off[:, 1], off[:, 2]
            u2, z2 = u * ca - z * sa, u * sa + z * ca
            new = c1 + np.stack([off[:, 0], -u2, z2], axis=1)
            w = np.clip(np.abs(ang) / 0.05, 0, 1)[:, None]
            out[up] = Q[up] * (1 - w) + new * w
        return out

    def texture(self):
        return self.px.texture()
