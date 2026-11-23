"""Garment construction toolkit (Blender 4.3, run inside Blender).

A garment is a mesh whose every vertex is *bound* to the neutral body (`Body_Welded_Source`, all 63 shape keys):
  'w'  welded body vertex + offset along its normal   (region-replacing pieces; exact, watertight across seams)
  's'  nearest body surface point (barycentric) + offset along the interpolated normal   (loft rows near the body)
  'f'  follower of another garment vertex with a factor (hems, cloth hanging free of the body)
Every blend shape of the body then becomes a blend shape of the garment: delta = (key surface point + d * key normal)
minus the same at rest.  Skin weights are copied the same way.  So garments follow Sex, Breast, Belly, Heavy, species, ...
"""
import bpy, bmesh, math, os, sys
import numpy as np
from mathutils import Vector, kdtree
from mathutils.bvhtree import BVHTree

SEAM = 0.006          # offset of region pieces at the shared seam loops (identical for every garment => watertight)
PARTS = {"torso": "Mesh_Torso", "arms": "Mesh_Arms", "hands": "Mesh_Hands", "legs": "Mesh_Legs", "feet": "Mesh_Feet",
         "head": "Mesh_Head"}


def smooth(a, b, x):
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def vnormals(P, T):
    a, b, c = P[T[:, 0]], P[T[:, 1]], P[T[:, 2]]
    fn = np.cross(b - a, c - a)
    N = np.zeros_like(P)
    for i in range(3):
        np.add.at(N, T[:, i], fn)
    return N / np.maximum(np.linalg.norm(N, axis=1, keepdims=True), 1e-12)


class Body:
    def __init__(self):
        W = bpy.data.objects["Body_Welded_Source"]
        me = W.data
        self.W = W
        self.n = len(me.vertices)
        kb = me.shape_keys.key_blocks
        self.co0 = np.array([v.co[:] for v in kb["Basis"].data])
        me.calc_loop_triangles()
        self.tris = np.array([t.vertices[:] for t in me.loop_triangles])
        self.keynames = [k.name for k in kb if k.name != "Basis"]
        self.keys = {k.name: np.array([v.co[:] for v in k.data]) for k in kb if k.name != "Basis"}
        self.N0 = vnormals(self.co0, self.tris)
        self.Nk = {k: vnormals(P, self.tris) for k, P in self.keys.items()}
        cen = self.co0.mean(0)
        assert np.mean(np.sum((self.co0 - cen) * self.N0, axis=1)) > 0, "normals point inward"
        self.groups = [g.name for g in W.vertex_groups]
        self.wt = np.zeros((self.n, len(self.groups)), np.float32)
        for v in me.vertices:
            for g in v.groups:
                self.wt[v.index, g.group] = g.weight
        kd = kdtree.KDTree(self.n)
        for i, p in enumerate(self.co0):
            kd.insert(p, i)
        kd.balance()
        self.pp = {}      # part -> list of polys (welded indices)
        self.pv = {}      # part -> set of welded verts
        self.pseam = {}
        for key, name in PARTS.items():
            o = bpy.data.objects[name]
            mp = []
            for v in o.data.vertices:
                p, i, d = kd.find(v.co)
                assert d < 1e-4, (name, d)
                mp.append(i)
            polys = [tuple(mp[i] for i in p.vertices) for p in o.data.polygons]
            self.pp[key] = polys
            self.pv[key] = set(mp)
            cnt = {}
            for poly in polys:
                for a, b in zip(poly, poly[1:] + poly[:1]):
                    e = (min(a, b), max(a, b))
                    cnt[e] = cnt.get(e, 0) + 1
            self.pseam[key] = {v for e, c in cnt.items() if c == 1 for v in e}
        self.allseam = set().union(*self.pseam.values())
        self.bvh = BVHTree.FromPolygons([tuple(p) for p in self.co0], [tuple(t) for t in self.tris])
        self.sub = {}
        self.x, self.y, self.z = self.co0[:, 0], self.co0[:, 1], self.co0[:, 2]
        self.tarm = np.clip((1.36 - self.z) / (1.36 - 0.98), 0, 1)
        self.tleg = np.clip((0.90 - self.z) / (0.90 - 0.12), 0, 1)

    def subbvh(self, *parts):
        k = tuple(parts)
        if k not in self.sub:
            polys = [p for pt in parts for p in self.pp[pt]]
            self.sub[k] = BVHTree.FromPolygons([tuple(p) for p in self.co0], polys)
        return self.sub[k]

    def hull(self, bvh, cx, cy, z, th, rmax=0.7):
        """Outer surface radius from the axis (cx,cy) at height z and angle th (0 = front -Y, + toward character-left +X)."""
        d = Vector((math.sin(th), -math.cos(th), 0))
        o = Vector((cx, cy, z)) + d * rmax
        loc, nor, idx, dist = bvh.ray_cast(o, -d, rmax + 0.3)
        if loc is None:
            return None
        return (Vector((loc.x - cx, loc.y - cy, 0))).length


class Garment:
    def __init__(self, B, gid):
        self.B, self.id = B, gid
        self.P, self.bind = [], []
        self.faces, self.fmat, self.fflat = [], [], []
        self.uvfn = None
        self.trimrules = []
        self.wcache = {}
        self.covered = {k: set() for k in PARTS}
        self.hides_extra = []
        self.opaque = True
        self.trimuv = {}

    # --- vertices
    def vw(self, widx, off):
        key = (widx, round(off, 5))
        if key in self.wcache:
            return self.wcache[key]
        B = self.B
        self.P.append(B.co0[widx] + B.N0[widx] * off)
        self.bind.append(("w", widx, off))
        self.wcache[key] = len(self.P) - 1
        return self.wcache[key]

    def vf(self, pos, parent, fac):
        self.P.append(np.asarray(pos, float))
        self.bind.append(("f", parent, fac))
        return len(self.P) - 1

    def vs(self, pos):
        self.P.append(np.asarray(pos, float))
        self.bind.append(("s",))
        return len(self.P) - 1

    def vauto(self, pos, prev=None, fac=0.92, near=0.03):
        """Surface-bound if outside and close to the body, else follower of `prev`."""
        pos = np.asarray(pos, float)
        loc, nor, idx, dist = self.B.bvh.find_nearest(Vector(pos))
        if loc is not None and dist < near and (Vector(pos) - loc).dot(nor) > 0.0 or prev is None:
            return self.vs(pos)
        return self.vf(pos, prev, fac)

    def face(self, vs, mat="Tint", flat=False):
        self.faces.append(tuple(vs))
        self.fmat.append(mat)
        self.fflat.append(flat)

    # --- region pieces
    def region(self, parts, ease, keep=None, mat=None, taper=0.05, lip=0.007, flat=False, minoff=0.004, noise=0.0, inner_clamp=True):
        """Offset copy of body region faces.  ease(widx array)->offset array.  keep(widx array)->bool array of kept verts."""
        B = self.B
        polys = []
        for pt in parts:
            for poly in B.pp[pt]:
                if keep is not None:
                    ia = np.array(poly)
                    if not keep(ia).all():
                        continue
                polys.append((pt, poly))
        # boundary of the chosen faces
        cnt = {}
        for pt, poly in polys:
            for a, b in zip(poly, poly[1:] + poly[:1]):
                e = (min(a, b), max(a, b))
                cnt[e] = cnt.get(e, 0) + 1
        bedges = [e for e, c in cnt.items() if c == 1]
        bverts = {v for e in bedges for v in e}
        seamv = bverts & B.allseam
        if seamv:
            kd = kdtree.KDTree(len(seamv))
            for k, v in enumerate(seamv):
                kd.insert(B.co0[v], k)
            kd.balance()
        used = sorted({v for _, poly in polys for v in poly})
        arr = np.array(used)
        e = np.broadcast_to(np.asarray(ease(arr), float), arr.shape).copy()
        if "legs" in parts and inner_clamp:
            inner = (np.sign(B.x[arr]) * B.N0[arr, 0] < -0.35) & (B.z[arr] < 0.9) & (np.abs(B.x[arr]) < 0.14)
            e = np.where(inner, np.minimum(e, 0.011), e)
        if noise:
            e = e + noise * (np.sin(B.x[arr] * 90 + B.z[arr] * 47) * np.cos(B.y[arr] * 73 + B.z[arr] * 31))
        off = {}
        for v, ev in zip(used, e):
            if seamv:
                d = kd.find(B.co0[v])[2]
                s = float(smooth(0.0, taper, d))
                ev = SEAM + (ev - SEAM) * s
            off[v] = max(ev, minoff if v not in seamv else SEAM)
        emat = {}
        for pt, poly in polys:
            self.covered[pt].add(poly)
            idx = [self.vw(v, off[v]) for v in poly]
            m = mat(np.array(poly)) if mat else "Tint"
            self.face(idx, m, flat)
            m0 = m if isinstance(m, str) else m[0]
            for a, b in zip(poly, poly[1:] + poly[:1]):
                emat[(min(a, b), max(a, b))] = m0
        # lips on cut edges (not seams)
        if lip:
            for a, b in bedges:
                if a in B.allseam and b in B.allseam:
                    continue
                oa, ob = off[a], off[b]
                ia, ib = self.vw(a, oa), self.vw(b, ob)
                # orientation: find the face using edge a->b
                ja, jb = self.vw(a, max(oa - lip, 0.0015)), self.vw(b, max(ob - lip, 0.0015))
                fwd = False
                for pt, poly in polys:
                    for p, q in zip(poly, poly[1:] + poly[:1]):
                        if (p, q) == (a, b):
                            fwd = True
                lm = emat.get((min(a, b), max(a, b)), "Tint")
                if fwd:
                    self.face((ib, ia, ja, jb), lm)
                else:
                    self.face((ia, ib, jb, ja), lm)
        return self

    # --- lofts
    def loft(self, bvh, c, thetas, zfn, radd, nr, mat=None, closed=True, rtop_z=None, fac=0.92, near=0.03, hullmode="top",
             flat=False, rmax=0.7, ringmat=None, base_r=None, rscale=None, reverse=False, zq_max=None, hullmax=False):
        """Rings i=0..nr (s=i/nr), vertices at angle th: z = zfn(s,th), radius = base + radd(s,th).
        hullmode 'top': base = body hull radius at ring 0 (kept for all rings); 'each': hull at each ring's own height."""
        cx, cy = c
        rows = []
        r_top = None
        if zfn(1.0, 0.0) > zfn(0.0, 0.0):
            reverse = not reverse
        for i in range(nr + 1):
            s = i / nr
            row = []
            rr = []
            for j, th in enumerate(thetas):
                z = zfn(s, th)
                if zq_max is not None:
                    z = min(z, zq_max)
                if hullmode == "each" or r_top is None or hullmax:
                    r = self.B.hull(bvh, cx, cy, z, th, rmax)
                else:
                    r = r_top[j]
                rr.append(r)
            if r_top is None or hullmode == "each" or hullmax:
                # fill misses
                good = [r for r in rr if r is not None]
                fb = (np.mean(good) if good else 0.15)
                rr = [r if r is not None else fb for r in rr]
                if r_top is None:
                    r_top = list(rr)
            for j, th in enumerate(thetas):
                z = zfn(s, th)
                base_each = rr[j] if hullmode == "each" else (max(r_top[j], rr[j]) if hullmax else r_top[j])
                r = base_each * (rscale(s) if rscale else 1.0) + radd(s, th)
                if base_r is not None:
                    r = base_r(s, th) + radd(s, th)
                pos = (cx + r * math.sin(th), cy - r * math.cos(th), z)
                prev = rows[-1][j] if rows else None
                row.append(self.vauto(pos, prev, fac, near))
            rows.append(row)
        n = len(thetas)
        for i in range(nr):
            m = (ringmat(i / nr) if ringmat else (mat or "Tint"))
            rng = range(n) if closed else range(n - 1)
            for j in rng:
                a, b = rows[i][j], rows[i][(j + 1) % n]
                c2, d2 = rows[i + 1][(j + 1) % n], rows[i + 1][j]
                # winding so normals point outward (th increasing = counter-clockwise seen from above? 0=front, + toward +X => clockwise)
                self.face((a, b, c2, d2) if reverse else (a, d2, c2, b), m, flat)
        return rows

    def cutfaces(self, pred):
        keep = []
        for fi, f in enumerate(self.faces):
            c = np.mean([self.P[i] for i in f], axis=0)
            if not pred(c):
                keep.append(fi)
        self.faces = [self.faces[i] for i in keep]
        self.fmat = [self.fmat[i] for i in keep]
        self.fflat = [self.fflat[i] for i in keep]

    def grid(self, posfn, nu, nv, mat="Tint", prevfac=0.92, near=0.03, flat=False, order=1):
        """Parametric surface: posfn(u,v)->xyz, u in 0..1 (nu+1 columns), v in 0..1 (nv+1 rows from the top)."""
        rows = []
        for i in range(nv + 1):
            row = []
            for j in range(nu + 1):
                pos = posfn(j / nu, i / nv)
                prev = rows[-1][j] if rows else None
                row.append(self.vauto(pos, prev, prevfac, near))
            rows.append(row)
        for i in range(nv):
            for j in range(nu):
                a, b, c2, d2 = rows[i][j], rows[i][j + 1], rows[i + 1][j + 1], rows[i + 1][j]
                self.face((a, d2, c2, b) if order > 0 else (a, b, c2, d2), mat, flat)
        return rows

    def box(self, center, size, mat="Leather", anchor=None, flat=True, rot_z=0.0):
        """Rigid box: first vertex surface-bound, others follow it with factor 1 (moves with the body point)."""
        cx, cy, cz = center
        sx, sy, sz = [s / 2 for s in size]
        c, s = math.cos(rot_z), math.sin(rot_z)
        pts = []
        for ix in (-1, 1):
            for iy in (-1, 1):
                for iz in (-1, 1):
                    dx, dy = ix * sx, iy * sy
                    pts.append((cx + dx * c - dy * s, cy + dx * s + dy * c, cz + iz * sz))
        v0 = self.vs(pts[0])
        ids = [v0] + [self.vf(p, v0, 1.0) for p in pts[1:]]
        # indices: bits (ix,iy,iz)
        def V(ix, iy, iz):
            return ids[(ix > 0) * 4 + (iy > 0) * 2 + (iz > 0)]
        quads = [((-1, -1, -1), (-1, 1, -1), (-1, 1, 1), (-1, -1, 1)), ((1, -1, -1), (1, -1, 1), (1, 1, 1), (1, 1, -1)),
                 ((-1, -1, -1), (-1, -1, 1), (1, -1, 1), (1, -1, -1)), ((-1, 1, -1), (1, 1, -1), (1, 1, 1), (-1, 1, 1)),
                 ((-1, -1, -1), (1, -1, -1), (1, 1, -1), (-1, 1, -1)), ((-1, -1, 1), (-1, 1, 1), (1, 1, 1), (1, -1, 1))]
        for q in quads:
            self.face([V(*p) for p in q][::-1], mat, flat)
        return ids

    # --- finish
    def trim(self, fn, lo, hi, axis="z"):
        """Faces whose mean fn(pos) lies in [lo,hi] become Trim; uv v across the band, u along."""
        self.trimrules.append((fn, lo, hi, axis))

    def trim_cmod(self, period, lo, hi):
        self.cmod = getattr(self, "cmod", []) + [(period, lo, hi)]

    def finalize_materials(self):
        self.trimuv = {}
        for fi, f in enumerate(self.faces):
            pts = np.array([self.P[i] for i in f])
            for period, lo, hi in getattr(self, "cmod", []):
                zc = pts[:, 2].mean()
                m = zc % period
                if lo <= m <= hi:
                    self.fmat[fi] = "Trim"
                    self.trimuv[fi] = np.clip(np.full(len(f), (m - lo) / (hi - lo)), 0.02, 0.98)
            for fn, lo, hi, axis in self.trimrules:
                vals = fn(pts)
                m = vals.mean()
                if lo <= m <= hi and (vals >= lo - 0.004).all() and (vals <= hi + 0.004).all():
                    self.fmat[fi] = "Trim"
                    v = np.clip((vals - lo) / (hi - lo), 0.02, 0.98)
                    self.trimuv[fi] = v
                    break

    def resolve(self):
        """Compute rest-space binding: closest body points for 's' vertices; returns per vertex (tri verts, bary, d)."""
        B = self.B
        nv = len(self.P)
        tv = np.zeros((nv, 3), int)
        bw = np.zeros((nv, 3))
        dd = np.zeros(nv)
        for i, b in enumerate(self.bind):
            if b[0] == "w":
                tv[i] = b[1]
                bw[i] = (1, 0, 0)
                dd[i] = b[2]
            elif b[0] == "s":
                pos = Vector(self.P[i])
                loc, nor, ti, dist = B.bvh.find_nearest(pos)
                t = B.tris[ti]
                A, Bv, C = B.co0[t[0]], B.co0[t[1]], B.co0[t[2]]
                p = np.array(loc)
                v0, v1, v2 = Bv - A, C - A, p - A
                d00, d01, d11 = v0 @ v0, v0 @ v1, v1 @ v1
                d20, d21 = v2 @ v0, v2 @ v1
                den = d00 * d11 - d01 * d01
                if abs(den) < 1e-14:
                    w = np.array([1.0, 0, 0])
                else:
                    v = (d11 * d20 - d01 * d21) / den
                    ww = (d00 * d21 - d01 * d20) / den
                    w = np.array([1 - v - ww, v, ww])
                tv[i] = t
                bw[i] = w
                n = (B.N0[t] * w[:, None]).sum(0)
                n /= max(np.linalg.norm(n), 1e-9)
                dd[i] = float((self.P[i] - p) @ n)
        return tv, bw, dd

    def deltas(self, tv, bw, dd):
        """dict key -> (nv,3) delta, and weights (nv,ngroups)."""
        B = self.B
        nv = len(self.P)
        P0 = np.array(self.P)
        n0 = (B.N0[tv] * bw[..., None]).sum(1)
        n0 /= np.maximum(np.linalg.norm(n0, axis=1, keepdims=True), 1e-9)
        base = (B.co0[tv] * bw[..., None]).sum(1) + dd[:, None] * n0
        surf = np.array([b[0] != "f" for b in self.bind])
        out = {}
        for k in B.keynames:
            Pk = (B.keys[k][tv] * bw[..., None]).sum(1)
            nk = (B.Nk[k][tv] * bw[..., None]).sum(1)
            nk /= np.maximum(np.linalg.norm(nk, axis=1, keepdims=True), 1e-9)
            d = Pk + dd[:, None] * nk - base
            d[~surf] = 0
            for i, b in enumerate(self.bind):
                if b[0] == "f":
                    d[i] = b[2] * d[b[1]]
            if np.abs(d).max() > 1e-6:
                out[k] = d
        wt = (B.wt[tv] * bw[..., None]).sum(1)
        for i, b in enumerate(self.bind):
            if b[0] == "f":
                wt[i] = wt[b[1]]
        return out, wt, P0

    def hides(self):
        B = self.B
        res = []
        if not self.opaque:
            return list(self.hides_extra)
        for k in ("torso", "arms", "hands", "legs", "feet"):
            tot = len(B.pp[k])
            if tot and len(self.covered[k]) >= 0.97 * tot:
                res.append(k)
        for k in self.hides_extra:
            if k not in res:
                res.append(k)
        return res
