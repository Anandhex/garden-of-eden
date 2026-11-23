"""Cards-plus-shell finish for hair and beards (2026-11 face rework), run after build_hair / build_beards.

For every Hair_* / Beard_* mesh:
  * UVMap = flow UVs: u = arc length around the head axis / TILE_U, v = height / TILE_V, so the strand texture
    (export/textures/hair/hair_strands.png, tileable) runs down the head; the pole at the crown becomes the whorl.
  * colour attribute 'Shade' alpha = soft edge: 0 where the shell meets the skin (hairline, beard edge), 1 a few mm above it.
    Shader: alpha = clamp((tex.a - (1 - vertex.a)) * 3); the strand breakup in tex.a makes the hairline soft and stranded.
  * strand cards (alpha-tested, export/textures/hair/{hair,beard}_cards.png, 4 clump columns) scattered over the surface and
    along the edges, following the flow, slightly lifted, carrying the shell's normals so they shade like the hair mass.
    They are joined into the same object as material slot 1 (HairCards); weights and shape keys by transfer like the shell.
"""
import bpy, bmesh, math, zlib
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree
from lib import *

TILE_U, TILE_V = 0.03, 0.10


def _bvh_body():
    ob = bpy.data.objects["Body_Welded_Source"]
    V = [Vector(v.co) for v in ob.data.vertices]
    return BVHTree.FromPolygons(V, [tuple(p.vertices) for p in ob.data.polygons])


_TREE = None


def skin_tree():
    global _TREE
    if _TREE is None:
        _TREE = _bvh_body()
    return _TREE


def flow_uv(P):
    c = np.array(LM["head_c"])
    v = P - c
    phi = np.arctan2(v[:, 0], -v[:, 1])
    r = 0.095
    return np.stack([phi * r / TILE_U, (P[:, 2] - 1.0) / TILE_V], axis=1)


def flow_dir(P, N):
    """local strand direction: down the surface, radially away from the crown on top of the head."""
    crown = np.array([0.0, LM["head_c"][1] + 0.025, LM["top"]])
    down = np.array([0, 0, -1.0])
    out = P - crown
    out /= np.linalg.norm(out, axis=1, keepdims=True) + 1e-9
    top = np.clip((P[:, 2] - (LM["top"] - 0.07)) / 0.05, 0, 1)[:, None]
    d = down * (1 - top) + out * top
    d = d - (d * N).sum(1, keepdims=True) * N
    return d / (np.linalg.norm(d, axis=1, keepdims=True) + 1e-9)


def taubin(ob, iters=4, lam=0.5, mu=-0.53):
    """volume-preserving smoothing of the hair/beard mesh (open-boundary vertices fixed); the same offset goes into every key."""
    me = ob.data
    P = np.array([v.co[:] for v in me.vertices])
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.verts.ensure_lookup_table()
    nbr = [[e.other_vert(v).index for e in v.link_edges] for v in bm.verts]
    fixed = np.array([any(e.is_boundary for e in v.link_edges) for v in bm.verts])
    bm.free()
    Q = P.copy()
    for _ in range(iters):
        for f in (lam, mu):
            L = np.array([Q[n].mean(axis=0) - Q[i] if n else np.zeros(3) for i, n in enumerate(nbr)])
            L[fixed] = 0
            Q = Q + f * L
    D = Q - P
    if me.shape_keys:
        for kb in me.shape_keys.key_blocks:
            k = np.empty(len(P) * 3)
            kb.data.foreach_get('co', k)
            kb.data.foreach_set('co', (k.reshape(-1, 3) + D).astype(np.float32).ravel())
    else:
        me.vertices.foreach_set('co', Q.astype(np.float32).ravel())
    me.update()


def finish(ob, kind="hair", n_cards=60, card_len=(0.035, 0.07), card_w=(0.010, 0.016), seed=1, cards_mat=None, bones=None):
    me = ob.data
    taubin(ob)
    P = np.array([v.co[:] for v in me.vertices])
    N = np.array([v.normal[:] for v in me.vertices])
    # ---- flow UVs
    uv = flow_uv(P)
    if "UVMap" not in me.uv_layers:
        me.uv_layers.new(name="UVMap")
    ul = me.uv_layers["UVMap"]
    for p in me.polygons:
        us = [uv[v] for v in p.vertices]
        # keep a face on one side of the phi seam (back of the head)
        u0 = us[0][0]
        span = 2 * math.pi * 0.095 / TILE_U
        for li, vi in zip(p.loop_indices, p.vertices):
            u, v = uv[vi]
            if u - u0 > span / 2:
                u -= span
            elif u0 - u > span / 2:
                u += span
            ul.data[li].uv = (u, v)
    # ---- soft edge alpha: open boundary of the shell (hairline, beard edge) = 0, rising over three edge rings
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.verts.ensure_lookup_table()
    ring = np.full(len(P), 99)
    front = [v.index for v in bm.verts if any(e.is_boundary for e in v.link_edges)]
    for r in range(4):
        nxt = []
        for i in front:
            if ring[i] > r:
                ring[i] = r
                nxt += [e.other_vert(bm.verts[i]).index for e in bm.verts[i].link_edges]
        front = [i for i in set(nxt) if ring[i] == 99]
    bm.free()
    alpha = np.array([0.0, 0.40, 0.75, 0.92] + [1.0] * 96)[np.minimum(ring, 99)]
    ca = me.color_attributes.get("Shade")
    if ca is None:
        ca = me.color_attributes.new("Shade", 'BYTE_COLOR', 'POINT')
    cols = np.empty(len(P) * 4, np.float32)
    ca.data.foreach_get('color', cols)
    cols = cols.reshape(-1, 4)
    cols[:, 3] = alpha
    ca.data.foreach_set('color', cols.ravel())
    if n_cards <= 0:
        return ob
    # ---- cards: area-weighted samples, more along the edges (alpha < 0.8) and on the outer silhouette
    rng = np.random.default_rng(seed)
    tris = []
    for p in me.polygons:
        vs = list(p.vertices)
        for k in range(1, len(vs) - 1):
            tris.append((vs[0], vs[k], vs[k + 1]))
    tris = np.array(tris)
    A = np.linalg.norm(np.cross(P[tris[:, 1]] - P[tris[:, 0]], P[tris[:, 2]] - P[tris[:, 0]]), axis=1) * 0.5
    edge = 1 - alpha[tris].mean(axis=1)
    wsel = A * (0.6 + 2.5 * edge)
    wsel /= wsel.sum()
    pick = rng.choice(len(tris), size=n_cards, p=wsel)
    CV, CF, CUV, CN = [], [], [], []
    for ci, ti in enumerate(pick):
        a, b, c = tris[ti]
        r1, r2 = rng.random(), rng.random()
        if r1 + r2 > 1:
            r1, r2 = 1 - r1, 1 - r2
        p0 = P[a] + (P[b] - P[a]) * r1 + (P[c] - P[a]) * r2
        n0 = N[a] + N[b] + N[c]
        n0 /= np.linalg.norm(n0)
        d0 = flow_dir(p0[None], n0[None])[0]
        side = np.cross(n0, d0)
        side /= np.linalg.norm(side) + 1e-9
        L = rng.uniform(*card_len)
        W = rng.uniform(*card_w)
        twist = rng.normal(0, 0.25)
        lift = rng.uniform(0.0008, 0.0020)
        col = rng.integers(0, 4)
        base = len(CV)
        segs = 4
        for k in range(segs + 1):
            t = k / segs
            # follows the surface flow, peels away towards the tip (flyaways at the edges)
            d = d0 * math.cos(twist * t) + side * math.sin(twist * t)
            q = p0 + d * L * t + n0 * (lift + (0.002 + 0.004 * edge[ti]) * t * t)
            ws = W * (1 - 0.35 * t)
            for sgn in (-1, 1):
                CV.append(q + side * ws * 0.5 * sgn)
                CUV.append((col * 0.25 + (0.0 if sgn < 0 else 0.25), t))
                CN.append(n0)
        for k in range(segs):
            i0 = base + 2 * k
            CF.append((i0, i0 + 1, i0 + 3, i0 + 2))
    CV = np.array(CV)
    cob = add_part(ob.name + "_cards_tmp", CV, CF, bones or [vg.name for vg in ob.vertex_groups], cards_mat, uv=np.array(CUV),
                   normals=np.array(CN), frame="new")
    # same colour layer so the join keeps both
    cca = cob.data.color_attributes.new("Shade", 'BYTE_COLOR', 'POINT')
    for i in range(len(CV)):
        cca.data[i].color = (1.0, 1.0, 1.0, 1.0)
    bpy.ops.object.select_all(action='DESELECT')
    ob.hide_set(False)
    cob.hide_set(False)
    ob.select_set(True)
    cob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.join()
    return ob


def finish_all():
    hair_cards = get_material("HairCards", (0.3, 0.18, 0.09))
    beard_cards = get_material("BeardCards", (0.3, 0.18, 0.09))
    out = {}
    for ob in [o for o in bpy.data.objects if o.type == 'MESH' and o.name.startswith(("Hair_", "Beard_"))]:
        nm = ob.name
        is_beard = nm.startswith("Beard_")
        tris = sum(len(p.vertices) - 2 for p in ob.data.polygons)
        size = max(ob.dimensions)
        if is_beard:
            n, L, W = int(28 + 60 * min(size / 0.2, 1.0)), (0.015, 0.035), (0.008, 0.013)
        else:
            long_ = size > 0.30
            n, L, W = (90 if long_ else 60), ((0.05, 0.11) if long_ else (0.03, 0.06)), (0.012, 0.018)
        finish(ob, "beard" if is_beard else "hair", n_cards=n, card_len=L, card_w=W, seed=zlib.crc32(nm.encode()) % 10000,
               cards_mat=beard_cards if is_beard else hair_cards)
        out[nm] = dict(cards=n, trisAfter=sum(len(p.vertices) - 2 for p in ob.data.polygons), trisShell=tris)
    return out
