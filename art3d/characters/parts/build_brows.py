"""30 eyebrows as alpha-tested hair cards (2026-11 face rework; replaces the flat brow decals).

Each style (specs.BROWS, same parameters as the old decal painter: inner, length, height, th, arch, peak, tilt, drop, a_in,
a_out, bushy, sparse, scar) becomes one mesh Brow_<nn>_<name> with both brows: per side a flush card (0.5 mm off the skin) and
a lifted card (1.4 mm, fewer longer hairs) that follow the brow centreline projected onto the face.  Texture
export/textures/brows_hd/brow_<nn>.png (RGB greyscale x hair colour, A coverage; flush layer v 0.5..1, lifted layer v 0..0.5).
Weights and shape keys (Brow_Up/Down/Sad, Brow_Ridge, Forehead_High, Eye_*...) by transfer from the head.
"""
import numpy as np, math
from lib import *
import gen, specs
from gen import surf

BROW_H = 0.0125
N_ALONG = 16


def centreline(p, sx):
    s0 = p.get("inner", 0.010)
    L = p.get("length", 0.040)
    zb = p.get("height", 1.6525)
    arch = p.get("arch", 0.005)
    pk = p.get("peak", 0.55)
    tilt = p.get("tilt", 0.0)
    drop = p.get("drop", 0.0)
    out = []
    for i in range(N_ALONG):
        t = i / (N_ALONG - 1)
        up = 1 - ((pk - t) / max(pk, 1e-3)) ** 2 if t < pk else 1 - ((t - pk) / max(1 - pk, 1e-3)) ** 2
        z = zb + tilt * (t * L) + arch * max(up, 0.0) - drop * max((t - 0.55) / 0.45, 0) ** 2
        out.append((sx * (s0 + t * L), z, t))
    return out


def brow_mesh(p):
    V, F, UV, NR = [], [], [], []
    for sx in (1, -1):
        cl = centreline(p, sx)
        for layer, (off, v0) in enumerate(((0.0005, 0.5), (0.0014, 0.0))):
            base = len(V)
            for (x, z, t) in cl:
                rows = []
                for k, dv in enumerate((-BROW_H, 0.0, BROW_H)):
                    pt, nn = surf(x, z + dv)
                    if pt is None:
                        pt, nn = np.array([x, -0.12, z + dv]), np.array([0, -1.0, 0])
                    lift = off * (1.0 if layer == 0 else (0.6 + 0.8 * (k / 2)))   # lifted layer peels off upwards
                    V.append(pt + nn * lift)
                    NR.append(nn)
                    UV.append((t, v0 + 0.5 * (k / 2)))
            n = len(cl)
            for i in range(n - 1):
                for k in range(2):
                    a = base + i * 3 + k
                    b = base + (i + 1) * 3 + k
                    f = (a, b, b + 1, a + 1)
                    F.append(f if sx > 0 else f[::-1])
    return np.array(V), F, np.array(UV), np.array(NR)


def build():
    out = []
    for i, b in enumerate(specs.BROWS):
        mat = get_material(f"Brow_{i+1:02d}", (0.2, 0.12, 0.07))
        V, F, UV, NR = brow_mesh(b["p"])
        name = f"Brow_{i+1:02d}_{b['name']}"
        ob = add_part(name, V, F, ["Head"], mat, uv=UV, normals=NR)       # legacy frame (same constants as the old decals)
        ob["gd_category"] = "eyebrows"
        ob["texture"] = f"export/textures/brows_hd/brow_{i+1:02d}.png"
        out.append(dict(obj=name, tris=sum(len(f) - 2 for f in F)))
    return out
