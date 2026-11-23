"""Face rig for the full-resolution head (2026-11 face rework).

Works on the welded source mesh (numpy positions + polygons + per-face part) before it is split into parts:
  * finds the lip contact loops (the bundle head has separate upper/lower lips that touch, plus a mouth cavity and throat)
    and the eyelid margins (the lids fold into the socket around the eyeball);
  * solves a harmonic "lowerness" field on the head surface (0 above the lip slit, 1 on the lower lip and chin) that drives the
    Jaw weights (so the Jaw bone really opens the mouth) and separates upper/lower lip regions for the expression keys;
  * builds the expression / viseme blend shapes (common.EXPR_SHAPES) as real-space deltas;
  * builds eyeballs (sclera + recessed iris), cornea shells and eyelash cards.
Everything is deterministic numpy; Blender is only used by the caller to make objects.
"""
import math
import numpy as np


def S(a, b, x):
    t = np.clip((np.asarray(x, float) - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


# ------------------------------------------------------------------------------------------------ topology helpers
class Topo:
    def __init__(self, V, faces, face_part=None, parts=("head", "nose", "ears")):
        self.V = np.asarray(V, float)
        n = len(V)
        self.faces = [tuple(f) for f in faces]
        keep = [i for i, p in enumerate(face_part)] if face_part is None else [i for i, p in enumerate(face_part) if p in parts]
        self.fidx = keep
        nbr = [set() for _ in range(n)]
        self.vfaces = [[] for _ in range(n)]
        edges_faces = {}
        for fi in keep:
            f = self.faces[fi]
            for k in range(len(f)):
                a, b = f[k], f[(k + 1) % len(f)]
                nbr[a].add(b)
                nbr[b].add(a)
                self.vfaces[a].append(fi)
                edges_faces.setdefault((min(a, b), max(a, b)), []).append(fi)
        self.nbr = [sorted(s) for s in nbr]
        self.ef = edges_faces
        self.used = np.array([len(s) > 0 for s in nbr])

    def edge_faces(self, a, b):
        return self.ef.get((min(a, b), max(a, b)), [])

    def next_in_loop(self, prev, cur):
        """quad edge-loop continuation: the edge at `cur` that shares no face with edge (prev, cur)."""
        if len(self.nbr[cur]) != 4:
            return None
        bad = set(self.edge_faces(prev, cur))
        for n in self.nbr[cur]:
            if n == prev:
                continue
            if not (set(self.edge_faces(cur, n)) & bad):
                return n
        return None

    def walk_loop(self, start, first, stop=None, max_n=400):
        out = [start, first]
        prev, cur = start, first
        for _ in range(max_n):
            if stop is not None and cur in stop:
                break
            nx = self.next_in_loop(prev, cur)
            if nx is None or nx in out:
                break
            out.append(nx)
            prev, cur = cur, nx
        return out

    def harmonic(self, fixed, iters=1500, mask=None):
        """Jacobi iterations of the graph Laplacian with Dirichlet values `fixed` {vertex: value}; free = used & mask."""
        n = len(self.V)
        x = np.full(n, 0.5)
        fi = np.array(sorted(fixed))
        fv = np.array([fixed[i] for i in fi])
        x[fi] = fv
        free = self.used.copy()
        if mask is not None:
            free &= mask
        free[fi] = False
        rows, cols = [], []
        for i in range(n):
            for j in self.nbr[i]:
                rows.append(i)
                cols.append(j)
        rows, cols = np.array(rows), np.array(cols)
        deg = np.bincount(rows, minlength=n).astype(float)
        deg[deg == 0] = 1
        for _ in range(iters):
            s = np.bincount(rows, weights=x[cols], minlength=n)
            xn = s / deg
            x = np.where(free, xn, x)
        return x


# ------------------------------------------------------------------------------------------------ landmarks of the face
def find_face(T, eye_centres, eye_radius, slit=None):
    """Return dict with lip loops, mouth corners, lid margins and region masks.  slit = {upper, lower, corners} vertex lists
    of a cut lip slit (realistic scan head: from its face sets); without it the touching-lips search of the stylised head runs."""
    V = T.V
    if slit:
        return _find_face_slit(T, eye_centres, eye_radius, slit)
    head = T.used
    mid = head & (np.abs(V[:, 0]) < 2e-5)
    mids = np.nonzero(mid)[0]
    # midline chain graph and the two lip-contact vertices: nearly coincident midline verts far apart along the chain
    adj = {i: [j for j in T.nbr[i] if mid[j]] for i in mids}
    nose_tip = mids[np.argmin(V[mids, 1] + 10 * (V[mids, 2] < eye_centres[0][2] - 0.09))]
    # chain distance from the nose tip (BFS)
    dist = {nose_tip: 0}
    q = [nose_tip]
    while q:
        nq = []
        for a in q:
            for b in T.nbr[a]:                     # graph distance over the whole head surface
                if b not in dist:
                    dist[b] = dist[a] + 1
                    nq.append(b)
        q = nq
    best = None
    zm = eye_centres[0][2]
    cand = [i for i in mids if zm - 0.12 < V[i, 2] < zm - 0.05 and V[i, 1] < V[nose_tip, 1] + 0.05]
    for a in cand:
        for b in cand:
            if a < b and b not in T.nbr[a]:
                d = np.linalg.norm(V[a] - V[b])
                if d < 0.002 and (d < 1e-7 or abs(dist.get(a, 0) - dist.get(b, 0)) > 3):
                    if best is None or d < best[0]:
                        best = (d, a, b)
    _, a, b = best
    nz = lambda v: V[T.nbr[v], 2].mean()          # the upper-lip copy has its neighbours above, the lower-lip copy below
    up, lo = (a, b) if nz(a) > nz(b) else (b, a)

    def lateral(v):
        return [n for n in T.nbr[v] if not mid[n]]

    def lip_loop(v):
        side = {}
        for n in lateral(v):
            sgn = 1 if V[n, 0] > 0 else -1
            side[sgn] = T.walk_loop(v, n)
        return side
    def ring(v):
        """closed edge ring around the mouth opening through v; split into the half containing v and the other half."""
        n = [m for m in lateral(v) if V[m, 0] > 0][0]
        r = T.walk_loop(v, n, max_n=200)
        r = np.array(r)
        x = V[r, 0]
        i_r, i_l = int(np.argmax(x)), int(np.argmin(x))
        a, b = sorted((i_r, i_l))
        inner = list(r[a:b + 1])          # path between the two corners that does not contain index 0 (= v)
        own = list(r[b:]) + list(r[:a + 1])
        return own, inner, r[i_r], r[i_l]
    # ring A passes the upper lip at `up` (its other half is the front of the lower lip), ring B passes the lower lip at `lo`
    a_own, a_other, cR, cL = ring(up)
    b_own, b_other, _, _ = ring(lo)
    upper_set = set(a_own) | set(b_other)
    lower_set = set(a_other) | set(b_own)
    corners = {1: cR, -1: cL}
    upper_set -= {cR, cL}
    lower_set -= {cR, cL}
    out = dict(up=up, lo=lo, upper=np.array(sorted(upper_set)), lower=np.array(sorted(lower_set)), ringB=np.array(sorted(set(b_own) | set(b_other))),
               corners=corners, nose_tip=nose_tip)
    out["mouth_c"] = 0.5 * (V[up] + V[lo])
    out["mouth_w"] = float(abs(V[cR, 0] - V[cL, 0]))
    # ---- eyelid margins: verts that touch the eyeball (inner lid surface), front part, and their outer rim
    lids = []
    for k, c in enumerate(eye_centres):
        c = np.asarray(c, float)
        r = eye_radius[k] if hasattr(eye_radius, "__len__") else eye_radius
        d = np.linalg.norm(V - c, axis=1)
        sx = 1 if c[0] > 0 else -1
        rel = V - c
        contact = head & (np.abs(d - r) < 0.0022) & (rel[:, 1] < -0.25 * r)
        # rim of the opening: contact verts with a neighbour that is farther from the eyeball (outer lid surface)
        rim = [i for i in np.nonzero(contact)[0] if any(d[j] > r + 0.0022 for j in T.nbr[i])]
        rim = np.array(rim)
        # keep the most forward ring: order around the eye by the angle in the x/z plane
        ang = np.arctan2(rel[rim, 2], rel[rim, 0] * sx)
        order = np.argsort(ang)
        rim = rim[order]
        ang = ang[order]
        # bin by angle and keep the most forward (smallest y) vertex per bin = lid margin
        nb = 64
        bins = np.floor((ang + math.pi) / (2 * math.pi) * nb).astype(int)
        margin = []
        for bi in range(nb):
            sel = rim[bins == bi]
            if len(sel):
                margin.append(sel[np.argmin(V[sel, 1])])
        margin = np.array(margin)
        mang = np.arctan2(rel[margin, 2], rel[margin, 0] * sx)
        lids.append(dict(c=c, r=r, sx=sx, contact=np.nonzero(contact)[0], margin=margin, ang=mang,
                         upper=margin[rel[margin, 2] >= 0], lower=margin[rel[margin, 2] < 0]))
    out["lids"] = lids
    return out


def _find_lids(T, eye_centres, eye_radius):
    V = T.V
    head = T.used
    lids = []
    for k, c in enumerate(eye_centres):
        c = np.asarray(c, float)
        r = eye_radius[k] if hasattr(eye_radius, "__len__") else eye_radius
        d = np.linalg.norm(V - c, axis=1)
        sx = 1 if c[0] > 0 else -1
        rel = V - c
        contact = head & (np.abs(d - r) < 0.0022) & (rel[:, 1] < -0.25 * r)
        rim = np.array([i for i in np.nonzero(contact)[0] if any(d[j] > r + 0.0022 for j in T.nbr[i])])
        ang = np.arctan2(rel[rim, 2], rel[rim, 0] * sx)
        order = np.argsort(ang)
        rim, ang = rim[order], ang[order]
        nb = 64
        bins = np.floor((ang + math.pi) / (2 * math.pi) * nb).astype(int)
        margin = np.array([rim[bins == bi][np.argmin(V[rim[bins == bi], 1])] for bi in range(nb) if np.any(bins == bi)])
        mang = np.arctan2(rel[margin, 2], rel[margin, 0] * sx)
        lids.append(dict(c=c, r=r, sx=sx, contact=np.nonzero(contact)[0], margin=margin, ang=mang,
                         upper=margin[rel[margin, 2] >= 0], lower=margin[rel[margin, 2] < 0]))
    return lids


def _find_face_slit(T, eye_centres, eye_radius, slit):
    V = T.V
    up_l, lo_l = np.array(slit["upper"]), np.array(slit["lower"])
    corners = slit["corners"]
    cR = corners[int(np.argmax(V[corners, 0]))]
    cL = corners[int(np.argmin(V[corners, 0]))]
    up = up_l[np.argmin(np.abs(V[up_l, 0]))]
    lo = lo_l[np.argmin(np.abs(V[lo_l, 0]))]
    mids = np.nonzero(T.used & (np.abs(V[:, 0]) < 2e-5))[0]
    nose_tip = mids[np.argmin(V[mids, 1] + 10 * (V[mids, 2] < eye_centres[0][2] - 0.09))]
    out = dict(up=up, lo=lo, upper=up_l, lower=lo_l, ringB=np.concatenate([up_l, lo_l]), corners={1: cR, -1: cL}, nose_tip=nose_tip)
    out["mouth_c"] = 0.5 * (V[up] + V[lo])
    out["mouth_w"] = float(abs(V[cR, 0] - V[cL, 0]))
    out["lids"] = _find_lids(T, eye_centres, eye_radius)
    return out


# ------------------------------------------------------------------------------------------------ regions
def mouth_bag(T, F, lm, inner=None):
    """vertices of the mouth cavity: the scan's inner-mouth face set when given, else a flood fill from the throat
    stopping at the inner lip ring B (stylised head)."""
    V = T.V
    if inner is not None:
        bag = np.zeros(len(V), bool)
        bag[inner] = True
        return bag
    mids = np.nonzero(T.used & (np.abs(V[:, 0]) < 2e-5))[0]
    target = np.array([0.0, float(lm["neck_top"][1]), float(lm["chin"]) + 0.01])
    seed = mids[np.argmin(np.linalg.norm(V[mids] - target, axis=1))]
    stop = set(F["ringB"].tolist())
    seen = {seed}
    q = [seed]
    while q:
        nq = []
        for a in q:
            for b in T.nbr[a]:
                if b not in seen:
                    seen.add(b)
                    if b not in stop:
                        nq.append(b)
        q = nq
    bag = np.zeros(len(V), bool)
    bag[list(seen)] = True
    return bag


def lowerness(T, F, lm, bag):
    """harmonic field: 0 = moves with Head (upper lip, nose, skull, neck), 1 = moves with Jaw (lower lip, chin)."""
    V = T.V
    chin = float(lm["chin"])
    mc = F["mouth_c"]
    fixed = {}
    head_v = np.nonzero(T.used)[0]
    for i in head_v:
        p = V[i]
        if p[2] > mc[2] + 0.022 and not bag[i]:
            fixed[i] = 0.0                              # above the upper lip: nose, cheeks, eyes, skull
        elif p[1] > float(lm["ear"][1]) - 0.005 and not bag[i]:
            fixed[i] = 0.0                              # behind the jaw hinge / back of the head and neck
        elif p[2] < chin - 0.028 and not bag[i]:
            fixed[i] = 0.0                              # neck below the chin
        elif bag[i] and p[2] < chin - 0.005:
            fixed[i] = 0.0                              # throat
        elif (not bag[i]) and chin - 0.004 < p[2] < chin + 0.022 and p[1] < mc[1] + 0.035 and abs(p[0]) < 0.030:
            fixed[i] = 1.0                              # chin
    for i in F["upper"]:
        fixed[int(i)] = 0.0
    for i in F["lower"]:
        fixed[int(i)] = 1.0
    for c in F["corners"].values():
        fixed[int(c)] = 0.5
    h = T.harmonic(fixed, iters=2500)
    return np.clip(h, 0, 1)


# ------------------------------------------------------------------------------------------------ eyes
IRIS_FRAC = 0.40        # iris radius / eyeball radius (stylised: large iris, white still shows at the sides)
CORNEA_BULGE = 0.045    # cornea apex in front of the sclera sphere, fraction of the radius
IRIS_RECESS = 0.07      # iris plane behind the limbus, fraction of the radius


def eyeball(c, r, sx, seg=32, rings=24):
    """Eyeball facing -Y: sphere with a recessed, slightly concave iris disc. Returns V, faces, uv (per vertex), region (0 sclera, 1 iris)."""
    th_i = math.asin(IRIS_FRAC)
    V, uv, reg = [], [], []
    # rings from the front pole (t=0) to the back pole (t=pi); dense near the limbus
    ts = [0.0]
    for k in range(1, 9):
        ts.append(th_i * k / 8)                 # iris
    for k in range(1, rings - 8):
        ts.append(th_i + (math.pi - th_i) * (k / (rings - 9)) ** 1.15)
    for ti, t in enumerate(ts):
        n = 1 if ti == 0 or ti == len(ts) - 1 else seg
        for j in range(n):
            ph = 2 * math.pi * j / seg
            d = np.array([math.sin(t) * math.cos(ph), -math.cos(t), math.sin(t) * math.sin(ph)])
            p = d * r
            if t <= th_i + 1e-9:
                # iris: flat-ish plane behind the limbus, slightly concave towards the pupil
                rr = math.sin(t) * r
                y = -r * math.cos(th_i) + IRIS_RECESS * r * (1 - 0.35 * (rr / (r * IRIS_FRAC)) ** 2) * 0.6 + 0.0
                y = -r * math.cos(th_i) + IRIS_RECESS * r * (0.6 + 0.4 * (1 - rr / (r * IRIS_FRAC)))
                p = np.array([d[0] / max(math.sin(t), 1e-9) * rr if t > 0 else 0.0, y, d[2] / max(math.sin(t), 1e-9) * rr if t > 0 else 0.0])
                reg.append(1)
            else:
                reg.append(0)
            p = p * np.array([1.0, 0.97, 1.0])
            V.append(c + p * np.array([sx, 1, 1]) * np.array([1, 1, 1]))
            uv.append((0.5 + 0.5 * p[0] / r, 0.5 + 0.5 * p[2] / r))
    V = np.array(V)
    faces = []
    starts = [0]
    for ti in range(1, len(ts)):
        starts.append(starts[-1] + (1 if ti - 1 == 0 else seg))
    for ti in range(len(ts) - 1):
        a0, b0 = starts[ti], starts[ti + 1]
        na = 1 if ti == 0 else seg
        nb = 1 if ti + 1 == len(ts) - 1 else seg
        for j in range(seg):
            j1 = (j + 1) % seg
            if na == 1:
                faces.append((a0, b0 + j1, b0 + j) if sx > 0 else (a0, b0 + j, b0 + j1))
            elif nb == 1:
                faces.append((a0 + j, a0 + j1, b0) if sx > 0 else (a0 + j1, a0 + j, b0))
            else:
                f = (a0 + j, a0 + j1, b0 + j1, b0 + j)
                faces.append(f if sx > 0 else f[::-1])
    return V, faces, np.array(uv), np.array(reg)


def cornea(c, r, sx, seg=32, rings=7):
    """Transparent dome over the iris: from just outside the limbus to an apex CORNEA_BULGE*r in front of the sphere."""
    th_c = math.asin(IRIS_FRAC) * 1.12
    y_l = -r * math.cos(th_c) * 0.97
    rl = r * math.sin(th_c)
    apex = -r * (1 + CORNEA_BULGE) * 0.97
    V, uv = [], []
    for k in range(rings + 1):
        t = k / rings                                     # 0 at the apex, 1 at the limbus
        rr = rl * t
        y = apex + (y_l - apex) * t ** 2 * (1.25 - 0.25 * t)
        n = 1 if k == 0 else seg
        for j in range(n):
            ph = 2 * math.pi * j / seg
            p = np.array([rr * math.cos(ph), y, rr * math.sin(ph)])
            V.append(c + p * np.array([sx, 1, 1]))
            uv.append((0.5 + 0.5 * p[0] / r, 0.5 + 0.5 * p[2] / r))
    faces = []
    for k in range(rings):
        a0 = 0 if k == 0 else 1 + (k - 1) * seg
        b0 = 1 + k * seg
        for j in range(seg):
            j1 = (j + 1) % seg
            if k == 0:
                f = (a0, b0 + j1, b0 + j)
            else:
                f = (a0 + j, a0 + j1, b0 + j1, b0 + j)
            faces.append(f if sx > 0 else f[::-1])
    return np.array(V), faces, np.array(uv)


# ------------------------------------------------------------------------------------------------ eyelids (blink) and lashes
def lid_frames(V, L):
    """per eye: margin points sorted from the inner to the outer canthus for the upper and lower lid, with their elevation
    angles about the eye's horizontal axis."""
    c, sx = L["c"], L["sx"]
    m = L["margin"]
    rel = V[m] - c
    xs = rel[:, 0] * sx                     # lateral coordinate (positive = towards the ear)
    i_in, i_out = int(np.argmin(xs)), int(np.argmax(xs))
    ang = L["ang"]                         # angle in the x/z plane, ordered
    order = np.argsort(ang)
    m, rel, xs, ang = m[order], rel[order], xs[order], ang[order]
    # upper lid: angles between the two canthi going over the top
    a_in, a_out = ang[np.argmin(xs)], ang[np.argmax(xs)]
    up = (ang >= min(a_in, a_out)) & (ang <= max(a_in, a_out))
    if rel[up, 2].mean() < rel[~up, 2].mean():
        up = ~up
    can_in, can_out = m[np.argmin(xs)], m[np.argmax(xs)]

    def side(mask):
        idx = m[mask]
        x = xs[mask]
        o = np.argsort(x)
        idx = np.concatenate([[can_in], idx[o], [can_out]])
        idx = list(dict.fromkeys(idx.tolist()))
        rr = V[idx] - c
        return np.array(idx), rr[:, 0] * sx, np.arctan2(rr[:, 2], -rr[:, 1])
    U = side(up)
    D = side(~up)
    return dict(upper=U, lower=D, c=c, sx=sx, r=L["r"])


def _interp(x, xp, fp):
    o = np.argsort(xp)
    return np.interp(x, xp[o], fp[o])


def rot_x(rel, ang):
    """rotate (N,3) about the x axis by ang (radians, positive = upwards elevation)."""
    ca, sa = np.cos(ang), np.sin(ang)
    y, z = rel[:, 1], rel[:, 2]
    # elevation phi = atan2(z, -y): rotating by +ang increases phi
    yn = y * ca + z * sa
    zn = z * ca - y * sa
    return np.stack([rel[:, 0], yn, zn], axis=1)


def lid_deltas(V, mask_head, LF, close_up=1.0, close_lo=0.0, meet=0.30, reach=0.011):
    """Deltas that rotate the upper lid down by close_up and the lower lid up by close_lo of the way to the meeting line.
    Returns (D, angle_up(x), angle_lo(x)) so lashes can be rotated the same way."""
    c, sx, r = LF["c"], LF["sx"], LF["r"]
    Ui, Ux, Ua = LF["upper"]
    Li, Lx, La = LF["lower"]
    rel = V - c
    xs = rel[:, 0] * sx
    # meeting elevation per x
    a_lo_at_u = _interp(Ux, Lx, La)
    meet_u = a_lo_at_u + meet * (Ua - a_lo_at_u)
    rot_u = -(Ua - meet_u) * close_up                       # negative = down
    a_up_at_l = _interp(Lx, Ux, Ua)
    meet_l = La + meet * (a_up_at_l - La)
    rot_l = (meet_l - La) * close_lo
    d = np.linalg.norm(rel, axis=1)
    near = mask_head & (d < r * 1.6) & (rel[:, 1] < 0.35 * r)
    D = np.zeros_like(V)
    idx = np.nonzero(near)[0]
    if len(idx) == 0:
        return D
    P = rel[idx]
    # distance to the upper / lower margin polylines
    du = np.min(np.linalg.norm(P[:, None, :] - (V[Ui] - c)[None], axis=2), axis=1)
    dl = np.min(np.linalg.norm(P[:, None, :] - (V[Li] - c)[None], axis=2), axis=1)
    phi = np.arctan2(P[:, 2], -P[:, 1])
    au = _interp(xs[idx], Ux, Ua)
    al = _interp(xs[idx], Lx, La)
    # a vertex belongs to the upper lid if its elevation is above the meeting line of the open eye (or it is closest to it)
    mid_line = al + meet * (au - al)
    is_up = (phi > mid_line) | ((du < dl) & (np.abs(phi - mid_line) < 0.15))
    wu = S(reach, 0.0012, du) * is_up
    wl = S(reach * 0.8, 0.0012, dl) * (~is_up)
    ang = _interp(xs[idx], Ux, rot_u) * wu + _interp(xs[idx], Lx, rot_l) * wl
    Pn = rot_x(P, ang)
    # keep the lid off the cornea bulge: a little outward push where it moved most
    push = 1.0 + 0.04 * np.abs(ang) / (abs(rot_u).max() + 1e-6) * (wu + wl)
    Pn = Pn * push[:, None]
    D[idx] = Pn - P
    return D


def lash_card(V, LF, lid="upper", length=0.0085, curl=0.55, n_rows=4, density=1.0, lift=0.0009, spread=1.0, wing=0.004):
    """Eyelash card along a lid margin. Returns (Vcard, faces, uv, root_index(per vert: margin vertex), t(per vert 0 root..1 tip))."""
    c, sx, r = LF["c"], LF["sx"], LF["r"]
    idx, xs, ang = LF[lid]
    P = V[idx]
    # resample the margin to an even polyline
    seg = np.linalg.norm(np.diff(P, axis=0), axis=1)
    s = np.concatenate([[0], np.cumsum(seg)])
    n_cols = max(8, int(s[-1] / 0.0018))
    st = np.linspace(s[0] + 0.06 * s[-1] if lid == "upper" else s[0] + 0.18 * s[-1], s[-1] - 0.03 * s[-1], n_cols)
    M = np.stack([np.interp(st, s, P[:, k]) for k in range(3)], axis=1)
    root_of = np.array([idx[np.argmin(np.abs(s - t))] for t in st])
    if lid == "upper" and wing > 0:
        # outer-corner flick: continue the margin past the outer canthus, rising (liner wing)
        tang = M[-1] - M[-2]
        tang /= np.linalg.norm(tang) + 1e-12
        ext = [M[-1] + tang * wing * (k / 3) + np.array([0, 0.0004 * k, 0.0011 * k * wing / 0.004]) for k in (1, 2, 3)]
        M = np.vstack([M, ext])
        root_of = np.concatenate([root_of, [root_of[-1]] * 3])
        n_cols = len(M)
    u = np.linspace(0, 1, len(M))
    # length profile: short at the inner corner, longest about 70 % towards the outer corner
    prof = (0.35 + 0.65 * np.sin(np.clip(u, 0, 1) * math.pi * 0.85) ** 0.8)
    if lid == "upper" and wing > 0:
        prof[-3:] = prof[-4] * np.array([0.8, 0.6, 0.4])
    if lid == "lower":
        prof = 0.45 * (0.3 + 0.7 * np.sin(u * math.pi) ** 0.7)
    Vc, uv, root, tt = [], [], [], []
    for k in range(n_cols):
        p = M[k]
        rel = p - c
        out = rel / np.linalg.norm(rel)                     # radial (out of the eyeball)
        up = np.array([0, 0, 1.0]) if lid == "upper" else np.array([0, 0, -1.0])
        # lashes leave the margin roughly radially, then curl up (or down for the lower lid)
        side = np.array([sx, 0, 0]) * (u[k] - 0.35) * 0.35 * spread
        L = length * prof[k]
        for j in range(n_rows):
            t = j / (n_rows - 1)
            dirv = out * (1 - curl * t) + up * (curl * t * 1.3 + (0.25 if lid == "upper" else 0.02)) + side * t
            dirv /= np.linalg.norm(dirv)
            q = p + out * lift + dirv * L * t
            if j > 0:
                # integrate a curved strand: accumulate along the bending direction
                q = Vc[-1] + dirv * (L / (n_rows - 1))
            Vc.append(q)
            uv.append((u[k], t))
            root.append(root_of[k])
            tt.append(t)
    faces = []
    for k in range(n_cols - 1):
        for j in range(n_rows - 1):
            a = k * n_rows + j
            b = (k + 1) * n_rows + j
            f = (a, b, b + 1, a + 1)
            faces.append(f if (sx > 0) == (lid == "upper") else f[::-1])
    return np.array(Vc), faces, np.array(uv), np.array(root), np.array(tt)


# ------------------------------------------------------------------------------------------------ expression / viseme keys
def expression_deltas(V, head_mask, F, h, lids, lm, bag):
    """dict name -> (N,3) deltas in real space (male basis). h = lowerness (0 upper, 1 lower)."""
    N = len(V)
    out = {}
    X, Y, Z = V[:, 0], V[:, 1], V[:, 2]
    ax, sgn = np.abs(X), np.sign(X)
    hm = head_mask.astype(float)
    mc = F["mouth_c"]
    mw = F["mouth_w"] * 0.5                        # half width
    cR = V[F["corners"][1]]
    front = S(mc[1] + 0.06, mc[1] + 0.02, Y)       # front of the face (not the back of the head)
    skin = hm * (~bag)
    # distances
    dmouth = np.sqrt(((ax) / (mw * 1.25)) ** 2 + ((Z - mc[2]) / 0.016) ** 2)
    lipm = S(1.25, 0.75, dmouth) * front * hm                    # lips and the skin right around them
    corner = np.exp(-((ax - abs(cR[0])) ** 2 + (Z - cR[2]) ** 2) / (2 * 0.010 ** 2)) * front * hm
    cheek = np.exp(-((ax - (abs(cR[0]) + 0.014)) ** 2 + (Z - (mc[2] + 0.026)) ** 2) / (2 * 0.014 ** 2)) * front * skin
    upper = (1 - h) * lipm
    lower = h * lipm
    centre = np.exp(-(X ** 2) / (2 * (mw * 0.55) ** 2))
    eye_z = float(lids[0]["c"][2])
    eye_x = abs(float(lids[0]["c"][0]))

    def zero():
        return np.zeros((N, 3))
    # --- mouth
    D = zero()
    D[:, 0] += sgn * 0.0055 * corner
    D[:, 2] += 0.0050 * corner
    D[:, 1] += 0.0035 * corner
    D[:, 2] += 0.0030 * cheek
    D[:, 1] += -0.0020 * cheek
    D[:, 0] += sgn * 0.0012 * cheek
    D[:, 2] += 0.0008 * upper * (1 - centre) - 0.0004 * lower * centre
    out["Mouth_Smile"] = D
    D = zero()
    D[:, 2] += -0.0050 * corner
    D[:, 0] += sgn * 0.0012 * corner
    D[:, 1] += 0.0006 * corner
    D[:, 2] += -0.0012 * lower * (1 - centre)
    chin = np.exp(-(X ** 2 + (Z - (float(lm["chin"]) + 0.018)) ** 2) / (2 * 0.010 ** 2)) * front * skin
    D[:, 2] += 0.0015 * chin
    out["Mouth_Frown"] = D
    D = zero()                                                 # O / oo: pucker forward, narrow, round opening
    D[:, 0] += -X * 0.38 * lipm
    D[:, 1] += -0.0045 * lipm * (0.6 + 0.4 * centre)
    D[:, 2] += 0.0016 * upper * centre - 0.0026 * lower * centre
    out["Mouth_O"] = D
    D = zero()                                                 # E / ee: wide, lips parted a little
    D[:, 0] += sgn * 0.0050 * corner
    D[:, 1] += 0.0018 * corner
    D[:, 2] += 0.0012 * corner
    D[:, 2] += 0.0013 * upper * centre - 0.0020 * lower * centre
    out["Mouth_E"] = D
    D = zero()                                                 # M B P: lips pressed and slightly rolled in
    D[:, 2] += -0.0009 * upper + 0.0010 * lower
    D[:, 1] += 0.0016 * lipm * centre
    D[:, 0] += -X * 0.06 * lipm
    out["Mouth_MBP"] = D
    D = zero()                                                 # cheeks puffed with air
    puff = np.exp(-((ax - (abs(cR[0]) + 0.018)) ** 2 + (Z - (mc[2] + 0.004)) ** 2) / (2 * 0.017 ** 2)) * front * skin
    D[:, 0] += sgn * 0.0065 * puff
    D[:, 1] += -0.0040 * puff
    D[:, 1] += -0.0012 * lipm * centre
    out["Cheek_Puff"] = D
    # --- brows (skin above the eyes; the brow cards follow by transfer)
    brow = (S(eye_z + 0.012, eye_z + 0.030, Z) * (1 - S(eye_z + 0.060, eye_z + 0.090, Z))
            * (1 - S(eye_x + 0.040, eye_x + 0.060, ax)) * front * skin)
    fore = S(eye_z + 0.02, eye_z + 0.05, Z) * (1 - S(eye_z + 0.10, eye_z + 0.13, Z)) * (1 - S(0.06, 0.09, ax)) * front * skin
    inner = S(eye_x + 0.006, eye_x - 0.018, ax)                # 1 at the inner end of the brow
    outer = S(eye_x - 0.004, eye_x + 0.028, ax)
    D = zero()
    D[:, 2] += 0.0050 * brow + 0.0020 * fore
    D[:, 1] += -0.0006 * brow
    out["Brow_Up"] = D
    D = zero()
    D[:, 2] += -0.0040 * brow * (0.5 + 0.5 * inner)
    D[:, 0] += -sgn * 0.0022 * brow * inner
    D[:, 1] += -0.0012 * brow * inner
    out["Brow_Down"] = D
    D = zero()
    D[:, 2] += 0.0055 * brow * inner - 0.0018 * brow * outer
    D[:, 0] += -sgn * 0.0008 * brow * inner
    out["Brow_Sad"] = D
    # --- lids
    for L, name in ((lids[0], "Eye_Blink_L"), (lids[1], "Eye_Blink_R")):
        out[name] = lid_deltas(V, head_mask, L["frame"], close_up=1.06, close_lo=1.0)
    D = zero()
    for L in lids:
        D += lid_deltas(V, head_mask, L["frame"], close_up=0.18, close_lo=0.55)
    sq = np.exp(-((ax - eye_x) ** 2 + (Z - (eye_z - 0.030)) ** 2) / (2 * 0.012 ** 2)) * front * skin
    D[:, 2] += 0.0022 * sq
    D[:, 1] += -0.0008 * sq
    out["Eye_Squint"] = D
    # the mouth cavity follows the inner lip ring rigidly (falling off with depth) so nothing pokes through the lips/cheeks
    rb = F["ringB"]
    bi = np.nonzero(bag)[0]
    if len(bi):
        d = np.linalg.norm(V[bi][:, None, :] - V[rb][None, :, :], axis=2)
        near = rb[np.argmin(d, axis=1)]
        fall = np.exp(-d.min(axis=1) / 0.012)
        for k in out:
            out[k][bi] = out[k][near] * fall[:, None]
    return out
