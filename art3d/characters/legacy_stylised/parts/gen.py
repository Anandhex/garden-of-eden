"""Procedural geometry helpers for hair and beards (numpy + bmesh). All coordinates are Blender world metres at rest, neutral head."""
import numpy as np, bmesh, bpy, math
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree

HC = np.array([0.0, -0.076, 1.605])          # head centre
TOP = 1.75


def norm(v):
    return v / (np.linalg.norm(v, axis=-1, keepdims=True) + 1e-9)


def smooth01(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def sdf(p):
    """approximate signed distance to head + neck + upper body (positive outside)."""
    p = np.atleast_2d(p)
    def ell(c, r):
        q = (p - np.array(c)) / np.array(r)
        return (np.linalg.norm(q, axis=1) - 1) * min(r)
    d = ell((0.0, -0.062, 1.612), (0.104, 0.118, 0.128))
    # neck capsule
    a, b, rad = np.array([0.0, -0.025, 1.38]), np.array([0.0, -0.035, 1.53]), 0.058
    ab = b - a
    t = np.clip(((p - a) @ ab) / (ab @ ab), 0, 1)
    d = np.minimum(d, np.linalg.norm(p - (a + t[:, None] * ab), axis=1) - rad)
    d = np.minimum(d, ell((0.0, 0.0, 1.31), (0.235, 0.115, 0.105)))
    d = np.minimum(d, ell((0.0, 0.0, 1.17), (0.185, 0.115, 0.21)))
    return d


def grad_sdf(p, h=0.004):
    g = np.zeros(3)
    for i in range(3):
        e = np.zeros(3)
        e[i] = h
        g[i] = (sdf(p + e)[0] - sdf(p - e)[0]) / (2 * h)
    return norm(g)


class MB:
    """mesh builder"""
    def __init__(self):
        self.V, self.F, self.S = [], [], []

    def add(self, V, F, shade):
        o = sum(len(v) for v in self.V)
        self.V.append(np.asarray(V, float))
        self.F += [tuple(int(i) + o for i in f) for f in F]
        self.S.append(np.broadcast_to(np.asarray(shade, float), (len(V),)).copy())

    def result(self):
        return np.concatenate(self.V), self.F, np.concatenate(self.S)


def sweep(path, w, t, sides=8, up=None, cap_start=True, shade=None, tip=0.15):
    """tube along path (n,3): half widths w (n), half thickness t (n); ring plane normal to the tangent.  The widest axis is
    s = tangent x up (up defaults to the outward direction from the head centre)."""
    path = np.asarray(path, float)
    n = len(path)
    w = np.broadcast_to(np.asarray(w, float), (n,)).copy()
    t = np.broadcast_to(np.asarray(t, float), (n,)).copy()
    tan = np.zeros_like(path)
    tan[1:-1] = path[2:] - path[:-2]
    tan[0] = path[1] - path[0]
    tan[-1] = path[-1] - path[-2]
    tan = norm(tan)
    V = []
    for i in range(n):
        u = (path[i] - HC) if up is None else (up[i] if np.ndim(up) > 1 else np.asarray(up))
        u = norm(np.asarray(u, float))
        s = np.cross(tan[i], u)
        if np.linalg.norm(s) < 1e-4:
            s = np.cross(tan[i], np.array([0, 1.0, 0]))
        s = norm(s)
        u2 = norm(np.cross(s, tan[i]))
        for k in range(sides):
            a = 2 * math.pi * k / sides
            V.append(path[i] + w[i] * math.cos(a) * s + t[i] * math.sin(a) * u2)
    V = np.array(V)
    F = []
    for i in range(n - 1):
        for k in range(sides):
            a, b = i * sides + k, i * sides + (k + 1) % sides
            F.append((a, b, b + sides, a + sides))
    # end cap (tip point)
    tipv = path[-1] + tan[-1] * max(w[-1], t[-1]) * tip * 2
    V = np.vstack([V, tipv])
    ti = len(V) - 1
    last = (n - 1) * sides
    for k in range(sides):
        F.append((last + k, last + (k + 1) % sides, ti))
    if cap_start:
        V = np.vstack([V, path[0] - tan[0] * 0.002])
        si = len(V) - 1
        for k in range(sides):
            F.append(((k + 1) % sides, k, si))
    sh = np.ones(len(V)) if shade is None else None
    if shade is not None:
        sh = np.concatenate([np.repeat(np.broadcast_to(np.asarray(shade, float), (n,)), sides), [shade[-1] if np.ndim(shade) else shade] * (2 if cap_start else 1)])
    return V, F, sh


def ellipsoid(c, r, rot=None, seg=12, rings=9):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=rings, radius=1.0)
    V = np.array([v.co[:] for v in bm.verts])
    F = [tuple(v.index for v in f.verts) for f in bm.faces]
    bm.free()
    V = V * np.asarray(r)
    if rot is not None:
        V = V @ np.asarray(rot).T
    return V + np.asarray(c), F


def frame_from(tan, up=None):
    tan = norm(np.asarray(tan, float))
    up = np.array([0, 0, 1.0]) if up is None else np.asarray(up, float)
    s = np.cross(tan, up)
    if np.linalg.norm(s) < 1e-4:
        s = np.array([1.0, 0, 0])
    s = norm(s)
    u = norm(np.cross(s, tan))
    return np.stack([s, tan, u], axis=1)     # columns: side, along, up


def cone(base, direction, length, radius, seg=6):
    d = norm(np.asarray(direction, float))
    R = frame_from(d)
    V, F = [], []
    for k in range(seg):
        a = 2 * math.pi * k / seg
        V.append(np.asarray(base) + radius * (math.cos(a) * R[:, 0] + math.sin(a) * R[:, 2]))
    V.append(np.asarray(base) + d * length)
    V.append(np.asarray(base) - d * radius * 0.4)
    for k in range(seg):
        F.append((k, (k + 1) % seg, seg))
        F.append(((k + 1) % seg, k, seg + 1))
    return np.array(V), F


_BODY_BVH = None


def _legacy_vectors(ob):
    import lib
    P = np.array([v.co[:] for v in ob.data.vertices])
    return [Vector(p) for p in lib.to_old(P)]


def collide(p, margin):
    """push point p out of the actual neutral body mesh (BVH on Body_Welded_Source, mapped into the legacy frame)."""
    global _BODY_BVH
    if _BODY_BVH is None:
        ob = bpy.data.objects["Body_Welded_Source"]
        V = _legacy_vectors(ob)
        _BODY_BVH = BVHTree.FromPolygons(V, [tuple(q.vertices) for q in ob.data.polygons])
    for _ in range(3):
        loc, nrm, idx, dist = _BODY_BVH.find_nearest(Vector(p), 0.25)
        if loc is None:
            return p
        loc, nrm = np.array(loc[:]), np.array(nrm[:])
        s = float((p - loc) @ nrm)
        if s < margin:
            p = loc + nrm * margin
        else:
            break
    return p


def drape(anchor, d0, length, steps=14, gravity=0.8, margin=0.010, stiff=0.5, rng=None, wobble=0.0, side=None):
    """a path starting at anchor, initial direction d0, bending down with gravity and sliding over the head/neck/body (sdf)."""
    p = np.asarray(anchor, float).copy()
    d = norm(np.asarray(d0, float))
    ds = length / steps
    pts = [p.copy()]
    for i in range(steps):
        d = norm(d * (1 + stiff) + np.array([0, 0, -gravity]) * (0.35 + 0.65 * (i / steps)))
        if wobble and rng is not None:
            d = norm(d + (side if side is not None else np.array([1.0, 0, 0])) * wobble * math.sin(i * 0.9 + rng.random() * 6))
        p = p + d * ds
        p = collide(p, margin)
        pts.append(p.copy())
    pts = np.array(pts)
    # 2026-11: Chaikin-smooth the path (the collision steps left kinks that read as bent pipes), then re-collide
    for _ in range(2):
        q = [pts[0]]
        for i in range(len(pts) - 1):
            q.append(0.75 * pts[i] + 0.25 * pts[i + 1])
            q.append(0.25 * pts[i] + 0.75 * pts[i + 1])
        q.append(pts[-1])
        pts = np.array(q)
    idx = np.linspace(0, len(pts) - 1, steps * 2 + 1)
    pts = np.array([pts[int(round(i))] for i in idx])
    pts = np.array([pts[0]] + [collide(p, margin * 0.9) for p in pts[1:]])
    return pts


def head_surface():
    ob = bpy.data.objects["Mesh_Head"]
    nose = bpy.data.objects["Part_Nose"]
    V = _legacy_vectors(ob)
    t1 = BVHTree.FromPolygons(V, [tuple(p.vertices) for p in ob.data.polygons])
    V2 = _legacy_vectors(nose)
    t2 = BVHTree.FromPolygons(V2, [tuple(p.vertices) for p in nose.data.polygons])
    return t1, t2


_TREES = None


def surf(x, z, ymin=-1.0):
    """front surface point and normal of the face at (x, z) (ray along +y)."""
    global _TREES
    if _TREES is None:
        _TREES = head_surface()
    best = None
    for t in _TREES:
        h = t.ray_cast(Vector((x, ymin, z)), Vector((0, 1, 0)))
        if h[0] is not None and (best is None or h[0].y < best[0].y):
            best = h
    if best is None:
        return None, None
    return np.array(best[0][:]), np.array(best[1][:])


def to_polar(P):
    v = np.asarray(P) - HC
    phi = np.arctan2(v[..., 0], -v[..., 1])           # 0 front, +-pi/2 sides (+ = character left), pi back
    return v[..., 2], phi


def head_mesh():
    ob = bpy.data.objects["Mesh_Head"]
    me = ob.data
    n = len(me.vertices)
    P = np.empty(n * 3)
    me.vertices.foreach_get('co', P)
    import lib
    P = lib.to_old(P.reshape(-1, 3))
    N = np.empty(n * 3)
    me.vertex_normals.foreach_get('vector', N)
    N = N.reshape(-1, 3)
    skin = {i for i, m in enumerate(me.materials) if m and not m.name.startswith("Mouth")}
    polys = [tuple(p.vertices) for p in me.polygons if p.material_index in skin]     # never grow from the mouth cavity
    return P, N, polys


def shell(sel_poly, off_fn, subdiv=0, edge_fade=(0.45, 0.8)):
    """take the head polygons for which sel_poly(centroid)->bool, offset every vertex along its (smoothed) normal by off_fn(P, N)
    and return V, F, boundary mask.  Edge vertices get thinner so the hair feathers out onto the skin."""
    P, N, polys = head_mesh()
    keep = [p for p in polys if sel_poly(P[list(p)].mean(axis=0))]
    used = sorted({v for p in keep for v in p})
    remap = {v: i for i, v in enumerate(used)}
    V0 = P[used]
    N0 = norm(N[used])
    F = [tuple(remap[v] for v in p) for p in keep]
    # boundary detection
    from collections import Counter
    ec = Counter()
    for f in F:
        for i in range(len(f)):
            a, b = f[i], f[(i + 1) % len(f)]
            ec[(min(a, b), max(a, b))] += 1
    bnd = set()
    for (a, b), c in ec.items():
        if c == 1:
            bnd.add(a)
            bnd.add(b)
    adj = [set() for _ in V0]
    for f in F:
        for i in range(len(f)):
            adj[f[i]].add(f[(i + 1) % len(f)])
            adj[f[(i + 1) % len(f)]].add(f[i])
    ring1 = {v for b in bnd for v in adj[b]} - bnd
    fade = np.ones(len(V0))
    for v in bnd:
        fade[v] = edge_fade[0]
    for v in ring1:
        fade[v] = edge_fade[1]
    # round the polygon staircase along the hairline: slide boundary vertices towards the mean of their boundary neighbours
    bnb = {v: set() for v in bnd}
    for (a, b), c in ec.items():
        if c == 1:
            bnb[a].add(b)
            bnb[b].add(a)
    for _ in range(4):
        newp = V0.copy()
        for v in bnd:
            nb = list(bnb[v])
            if nb:
                newp[v] = 0.5 * V0[v] + 0.5 * V0[nb].mean(axis=0)
        V0 = newp
    # smooth normals a bit
    for _ in range(2):
        N0 = norm(np.array([N0[i] * 0.5 + 0.5 * np.mean([N0[j] for j in adj[i]], axis=0) if adj[i] else N0[i] for i in range(len(V0))]))
    off = off_fn(V0, N0) * fade
    V = V0 + N0 * off[:, None]
    return V, F, np.array([i in bnd for i in range(len(V0))]), V0, N0
