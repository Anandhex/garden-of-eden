"""Face decals (numpy only): eyebrows, lids/lashes, lips, inner mouth, stubble and eyeball (iris) textures.

All face decals are RGBA float arrays NxN in the base face rect (see ../README.md): x -0.11..0.11 m, z 1.50..1.72 m of the
neutral masculine head, row 0 = lowest z (Blender image order). They only deform with the head's UVs, so they follow every
face blend shape.  Colour rules (documented in parts_manifest.json "textureConventions"):
  brow / stubble / lips : RGB = shading (white..grey), A = coverage, multiply by the colour slot (hair colour, lip tint).
  lids                  : RGB = final colour, A = coverage (liner and shadow colours are part of the look).
  mouth inner           : RGB = final colour (teeth, tongue, dark), A = coverage, not tinted.
  eye iris              : 256x256 per eyeball, RGB = shading, A = tint mask (iris is multiplied by irisColor);
                          sclera, pupil and highlights are final colours with A = 0.
"""
import numpy as np

import json as _json, os as _os
N = 512
X0, X1, Z0, Z1 = -0.11, 0.11, 1.50, 1.72
PX = (X1 - X0) / N                       # 0.43 mm per pixel
EYE = dict(cx=0.0360, cz=1.6255, a=0.0165, bu=0.0105, bl=0.0105)   # measured aperture of the neutral head (ray test)
MZ = 1.5550                              # mouth line
_yy, _xx = np.mgrid[0:N, 0:N].astype(np.float32)
X = X0 + (_xx + 0.5) * PX
Z = Z0 + (_yy + 0.5) * PX
# 2026-11: the painters keep the constants of the previous head ("legacy frame"); the pixel grid is the NEW FaceDecalUV rect
# mapped into that frame (same map as lib.to_old), and the lid aperture is refitted from the new head's modelled lid margins.
try:
    _META = _json.load(open(_os.path.join(_os.path.dirname(_os.path.abspath(__file__)), "..", "export", "base_body_meta.json")))
    _LM = _META["landmarks"]
    _OLD = {"chin": 1.505, "top": 1.75, "half_w": 0.1053, "yc": -0.0759}
    _kz = (_LM["top"] - _LM["chin"]) / (_OLD["top"] - _OLD["chin"])
    _kx = _LM["head_half_w"] / _OLD["half_w"]
    _r = _META["faceWorldRect"]
    _Xn = _r["x0"] + (_xx + 0.5) / N * (_r["x1"] - _r["x0"])
    _Zn = _r["z0"] + (_yy + 0.5) / N * (_r["z1"] - _r["z0"])
    X = (_Xn / _kx).astype(np.float32)
    Z = (_OLD["top"] - (_LM["top"] - _Zn) / _kz).astype(np.float32)
    _m = _META["faceRig"]["lidMargins"][0]
    _U, _D = np.array(_m["upper"]), np.array(_m["lower"])
    _cx = 0.5 * (_U[:, 0].min() + _U[:, 0].max()) / _kx
    _a = 0.5 * (_U[:, 0].max() - _U[:, 0].min()) / _kx * 0.95
    _old_z = lambda z: _OLD["top"] - (_LM["top"] - z) / _kz
    _cz = _old_z(0.5 * (_U[0, 2] + _U[-1, 2]))
    EYE = dict(cx=float(_cx), cz=float(_cz), a=float(_a), bu=float(_old_z(_U[:, 2].max()) - _cz), bl=float(_cz - _old_z(_D[:, 2].min())))
    MZ = float(_old_z(_META["faceRig"]["mouthCentre"][2]))
except Exception as _e:      # meta from an older build: keep the original grid
    print("decals: legacy grid", _e)
AA = 0.00045


def blank():
    return np.zeros((N, N, 4), np.float32)


def cov(d, w=AA):
    return np.clip(0.5 - d / w, 0, 1)


def smooth(t):
    t = np.clip(t, 0, 1)
    return t * t * (3 - 2 * t)


def over(img, a, rgb):
    """composite colour rgb with coverage a (array or scalar) over img (straight alpha)."""
    a = np.clip(a, 0, 1).astype(np.float32)
    oa = img[..., 3]
    na = a + oa * (1 - a)
    k = np.where(na > 1e-6, a / np.maximum(na, 1e-6), 0)
    for c in range(3):
        img[..., c] = img[..., c] * (1 - k) + (rgb[c] if np.isscalar(rgb[c]) else rgb[c]) * k
    img[..., 3] = na
    return img


def hash1(v, seed=0):
    return (np.sin(v * 127.1 + seed * 311.7) * 43758.5453) % 1.0


def noise1(s, seed=0, freq=1.0):
    t = s * freq
    i = np.floor(t)
    f = t - i
    f = f * f * (3 - 2 * f)
    return hash1(i, seed) * (1 - f) + hash1(i + 1, seed) * f


# ---------------------------------------------------------------------------------------------- eyebrows
def brow(p):
    """p: inner (m from midline), length, th (half thickness at thickest), arch, peak (0..1), tilt (z/s slope),
    drop (outer droop), height (z of the inner end), a_in, a_out (end thickness ratios), bushy, gap_scar, sparse,
    skew (arch asymmetry), curve."""
    img = blank()
    s0 = p.get("inner", 0.010)
    L = p.get("length", 0.040)
    zb = p.get("height", 1.6525)
    th = p.get("th", 0.0035)
    arch = p.get("arch", 0.005)
    pk = p.get("peak", 0.55)
    tilt = p.get("tilt", 0.0)
    drop = p.get("drop", 0.0)
    a_in = p.get("a_in", 0.7)
    a_out = p.get("a_out", 0.15)
    bushy = p.get("bushy", 0.0)
    sparse = p.get("sparse", 0.0)
    seed = p.get("seed", 1)
    for sx in (-1, 1):
        s = X * sx
        t = (s - s0) / L
        inside = (t >= -0.02) & (t <= 1.02)
        tc = np.clip(t, 0, 1)
        up = np.where(tc < pk, 1 - ((pk - tc) / max(pk, 1e-3)) ** 2, 1 - ((tc - pk) / max(1 - pk, 1e-3)) ** 2)
        zc = zb + tilt * (tc * L) + arch * np.clip(up, 0, 1) + (-drop) * np.clip((tc - 0.55) / 0.45, 0, 1) ** 2
        w = th * (a_in + (1 - a_in) * smooth(tc / 0.35)) * (1 - (1 - a_out) * smooth((tc - 0.5) / 0.5))
        if bushy:
            w = w * (1 + 0.6 * bushy * (noise1(tc * L, seed, 300) - 0.5) * 1.6)
            zc = zc + 0.6 * bushy * 0.0016 * (noise1(tc * L, seed + 7, 200) - 0.5)
        a = cov(np.abs(Z - zc) - w) * inside
        if bushy:   # hair-like tufts at the top edge
            tuft = (noise1(tc * L, seed + 3, 600) > 0.55) * cov(np.abs(Z - (zc + w + 0.0016)) - 0.0016 * (noise1(tc * L, seed + 4, 500)))
            a = np.maximum(a, tuft * inside * 0.0)
        if sparse:
            a = a * (0.55 + 0.45 * (hash1(np.floor(X / 0.0007) * 3.1 + np.floor(Z / 0.0007) * 7.7, seed) > sparse))
        if p.get("scar"):
            sc = p["scar"]
            sca, scw = sc.get("t", 0.55), sc.get("w", 0.0022)
            band = np.abs((s - (s0 + sca * L)) - sc.get("slope", 0.5) * (Z - zb)) < scw
            a = a * (1 - band * sc.get("on", 1.0) * ((sx == sc.get("side", 1)) or sc.get("side", 1) == 0))
        over(img, a, (1, 1, 1))
    # tiny shading: darker core
    img[..., :3] = np.where(img[..., 3:4] > 0, 0.82 + 0.18 * img[..., 3:4], 1.0)
    return img


# ---------------------------------------------------------------------------------------------- lids and lashes
def _lid_curve(x, side_sx, kind="upper"):
    """z of the aperture's upper/lower edge at world x (for the eye on side side_sx), NaN outside."""
    e = EYE
    u = (x - side_sx * e["cx"]) * side_sx       # outward positive
    q = 1 - (u / e["a"]) ** 2
    ok = q > 0
    r = np.sqrt(np.clip(q, 0, 1))
    z = e["cz"] + (e["bu"] if kind == "upper" else -e["bl"]) * r
    # tilt: outer corner a touch higher
    z = z + 0.0022 * np.clip(u / e["a"], -1, 1)
    return z, u, ok


def lids(p):
    """p keys: line (upper line half width m), flick (outer wing length), lash (count of lash ticks), lash_len, low (lower line width),
    crease, shadow (rgba tuple), shadow_h, bag (under-eye), crow (crow's feet), col (rgb), inner_cut."""
    img = blank()
    col = p.get("col", (0.14, 0.08, 0.07))
    e = EYE
    for sx in (-1, 1):
        zu, u, ok = _lid_curve(X, sx, "upper")
        zl, _, _ = _lid_curve(X, sx, "lower")
        within = ok & (u > -e["a"] * 0.96)
        if p.get("shadow"):
            r, g, b, al = p["shadow"]
            h = p.get("shadow_h", 0.011)
            d = (Z - zu) / h
            rr = np.sqrt(((u - 0.003) / (e["a"] * 1.1)) ** 2 + ((Z - (zu + 0.4 * h)) / (0.75 * h)) ** 2)
            m = smooth(1 - rr) * (Z > zu - 0.0005) * smooth((u + e["a"] * 0.9) / 0.010)
            over(img, m * al, (r, g, b))
        if p.get("line", 0) > 0:
            lw = p["line"]
            wprof = lw * (0.45 + 0.55 * smooth((u + e["a"] * 0.9) / (e["a"] * 1.0))) * (1 - 0.35 * smooth((u - e["a"] * 0.8) / e["a"]))
            over(img, cov(np.abs(Z - (zu + wprof * 0.6)) - wprof) * within, col)
            # thin lead-in towards the inner corner (never across the bridge: stops at 0.96 a)
        if p.get("flick", 0) > 0:
            f = p["flick"]
            uu = u - e["a"] * 0.85
            zf = zu.copy() if np.ndim(zu) else zu
            zc = e["cz"] + e["bu"] * 0.25 + p.get("flick_rise", 0.9) * np.clip(uu, 0, None) * 0.9
            lw = p.get("line", 0.0012) * np.clip(1 - uu / f, 0, 1) ** 0.8 + 0.0003
            over(img, cov(np.abs(Z - zc) - lw) * (uu > 0) * (uu < f), col)
        if p.get("lash", 0) > 0:
            n, ll = p["lash"], p.get("lash_len", 0.006)
            for k in range(n):
                t = (k + 0.5) / n
                ux = -e["a"] * 0.55 + t * e["a"] * 1.7
                xk = sx * e["cx"] + sx * ux
                zk, _, _ = _lid_curve(np.float32(xk), sx, "upper")
                ang = 0.35 + 0.9 * t                  # lashes fan outward
                L = ll * (0.55 + 0.9 * t) * (1 if p.get("lash_style", "up") != "short" else 0.6)
                # a short straight stroke from (xk, zk) in direction (sx*cos? , sin)
                dx, dz = sx * np.sin(ang) * 0.5, np.cos(ang) * 0.9
                rel_x, rel_z = X - xk, Z - float(zk)
                tt = (rel_x * dx + rel_z * dz) / np.hypot(dx, dz) ** 2
                tt = np.clip(tt, 0, L / np.hypot(dx, dz))
                dist = np.hypot(rel_x - tt * dx, rel_z - tt * dz)
                wk = 0.00055 * (1 - 0.6 * tt / (L / np.hypot(dx, dz)))
                over(img, cov(dist - wk, 0.0004), col)
        if p.get("low", 0) > 0:
            lw = p["low"]
            over(img, cov(np.abs(Z - (zl - lw * 0.6)) - lw) * ok * (u > -e["a"] * 0.9) * (u < e["a"] * 0.85) * 0.85, p.get("low_col", col))
        if p.get("crease", 0) > 0:
            c = p["crease"]
            zc = zu + p.get("crease_h", 0.0055)
            over(img, cov(np.abs(Z - zc) - c) * (np.abs(u - 0.002) < e["a"] * 0.95) * 0.65, p.get("crease_col", (0.45, 0.28, 0.24)))
        if p.get("bag", 0) > 0:
            b = p["bag"]
            d = ((u - 0.001) / (e["a"] * 1.05)) ** 2 + ((Z - (e["cz"] - e["bl"] - 0.0075)) / 0.0042) ** 2
            over(img, np.exp(-d * 1.7) * b * (np.abs(u) < e["a"] * 1.2), p.get("bag_col", (0.52, 0.36, 0.42)))
        if p.get("crow", 0) > 0:
            c = p["crow"]
            for ang in (-0.55, -0.05, 0.45):
                ux0 = e["a"] * 1.12
                rel_u = u - ux0
                zc = e["cz"] + 0.0015 + np.tan(ang) * rel_u
                over(img, cov(np.abs(Z - zc) - 0.00045) * (rel_u > 0) * (rel_u < 0.008) * c * 0.35, (0.55, 0.38, 0.33))
    # the decal must never leave the eye area: hard mask around each aperture (guards against the bridge)
    guard = np.zeros((N, N), np.float32)
    for sx in (-1, 1):
        u = (X - sx * e["cx"]) * sx
        guard = np.maximum(guard, ((u > -e["a"] * 1.0) & (u < e["a"] * 2.3) & (np.abs(Z - e["cz"]) < 0.026)).astype(np.float32))
    img[..., 3] *= guard
    return img


# ---------------------------------------------------------------------------------------------- mouths
def lips(p):
    """Lip tint layer (white shading, multiply by the lip colour).  p: w (half width), tu/tl (upper/lower half thickness),
    cupid (dip), corner (smile lift m at corners, negative = frown), skew (smirk), alpha, lower_off, line (crease darkness),
    part (open gap half height), lines (elder lip lines), scar."""
    img = blank()
    w = p.get("w", 0.024)
    tu, tl = p.get("tu", 0.0075), p.get("tl", 0.0085)
    cu = p.get("cupid", 0.0015)
    cor = p.get("corner", 0.0)
    sk = p.get("skew", 0.0)
    part = p.get("part", 0.0)
    mz = MZ + p.get("dz", 0.0)
    xs = X / w
    inside = np.abs(xs) < 1.0
    s = np.clip(1 - xs ** 2, 0, 1)
    zc = mz + cor * np.abs(xs) ** 2 + sk * xs * 0.0 + sk * 0.0042 * xs
    # upper lip: thickness profile with cupid's bow (two humps, dip at the centre)
    bow = 1 - cu / max(tu, 1e-4) * np.exp(-(X / 0.0045) ** 2)
    hu = tu * s ** 0.75 * bow
    hl = tl * s ** 0.65
    alpha = p.get("alpha", 0.72)
    up = cov(np.maximum(Z - (zc + part), 0) - hu * 0 - 0, 0.0004)       # placeholder to keep shapes simple
    lipU = (Z >= zc + part) & (Z <= zc + part + hu)
    lipL = (Z <= zc - part) & (Z >= zc - part - hl)
    edge = lambda d: np.clip(0.5 + d / 0.0005, 0, 1)
    mU = np.clip(edge(hu - (Z - zc - part)) * edge(Z - zc - part), 0, 1) * inside
    mL = np.clip(edge(hl - (zc - part - Z)) * edge(zc - part - Z), 0, 1) * inside
    over(img, mU * alpha * 0.85, (0.95, 0.95, 0.95))
    over(img, mL * alpha, (1.0, 1.0, 1.0))
    # darker crease line (the closed mouth line)
    if p.get("line", 0.8) > 0 and part < 0.0006:
        over(img, cov(np.abs(Z - zc) - 0.00032) * inside * (s ** 0.4) * p.get("line", 0.8) * 0.62, (0.50, 0.50, 0.50))
        # corners tuck
        for sgn in (-1, 1):
            over(img, cov(np.hypot((X - sgn * w * 0.99) / 0.0011, (Z - zc) / 0.0016) - 1) * 0.30 * (np.abs(xs) > 0.9), (0.55, 0.55, 0.55))
    if p.get("lines", 0) > 0:          # elder vertical lip lines
        for k in range(-5, 6):
            xk = k * w / 6.0
            over(img, cov(np.abs(X - xk) - 0.00022) * ((np.abs(Z - mz - 0.0050) < 0.0042 * (1 - abs(k) / 7)) | (np.abs(Z - mz + 0.0075) < 0.003 * (1 - abs(k) / 7))) * (np.abs(xs) < 0.8) * p["lines"] * 0.28, (0.45, 0.45, 0.45))
    if p.get("scar"):
        sc = p["scar"]
        d = np.abs((X - sc.get("x", 0.010)) - sc.get("slope", 0.5) * (Z - mz))
        over(img, cov(d - 0.00042) * (np.abs(Z - mz) < sc.get("len", 0.015)) * sc.get("a", 0.9) * 0.55, (0.62, 0.62, 0.62))
        for kk in range(-3, 4):
            over(img, cov(np.hypot((X - sc.get("x", 0.010) - sc.get("slope", 0.5) * kk * 0.0042) / 0.0013, (Z - mz - kk * 0.0042) / 0.00032) - 1) * 0.5, (0.45, 0.45, 0.45))
    return img


def inner_mouth(p):
    """Final-colour painted open mouth: dark interior, upper teeth, tongue (for expressions with teeth showing)."""
    img = blank()
    w = p.get("w", 0.021)
    gap = p.get("gap", 0.004)          # half height of the opening at the centre
    mz = MZ + p.get("dz", 0.0)
    cor = p.get("corner", 0.0)
    xs = X / w
    s = np.clip(1 - xs ** 2, 0, 1)
    zc = mz + cor * np.abs(xs) ** 2
    up_h = gap * s ** 0.6 * p.get("up", 0.7)
    lo_h = gap * s ** 0.6 * p.get("lo", 1.0)
    inside = (np.abs(xs) < 1.0)
    inside_open = inside & (Z < zc + up_h) & (Z > zc - lo_h)
    m = cov(-np.minimum(zc + up_h - Z, Z - (zc - lo_h)) + 0 * Z, 0.0005) * inside
    m = np.clip(m, 0, 1) if np.isscalar(gap) else m
    mask = inside_open.astype(np.float32)
    over(img, mask, (0.16, 0.05, 0.07))
    teeth = p.get("teeth", "none")
    tc = (0.97, 0.94, 0.86)
    if teeth in ("upper", "both", "grin", "gap", "fangs", "gritted"):
        th_h = np.minimum(gap * s ** 0.6 * p.get("up", 0.7), p.get("teeth_h", 0.0042))
        band = inside_open & (Z > zc + up_h - th_h * 1.4 - 0.0002)
        if p.get("tooth_gap"):
            band &= ~((np.abs(X - p["tooth_gap"]) < 0.0011))
        over(img, band.astype(np.float32), tc)
        # tooth separators
        for k in range(-3, 4):
            over(img, cov(np.abs(X - k * w / 3.6) - 0.00022) * band * 0.6, (0.62, 0.55, 0.50))
        if teeth == "fangs":
            for sgn in (-1, 1):
                fx = sgn * w * 0.48
                tri = (Z < zc + up_h * 0.2) & (Z > zc - gap * 0.9) & (np.abs(X - fx) < 0.0018 * np.clip((Z - (zc - gap * 0.9)) / (gap * 1.1), 0, 1) + 0.0001)
                over(img, tri.astype(np.float32) * inside_open, tc)
    if teeth in ("both", "grin", "gritted"):
        lb = inside_open & (Z < zc - lo_h + np.minimum(lo_h, p.get("teeth_h", 0.0042)) * 0.8)
        over(img, lb.astype(np.float32), (0.93, 0.90, 0.82))
        for k in range(-3, 4):
            over(img, cov(np.abs(X - k * w / 3.3) - 0.00022) * lb * 0.6, (0.62, 0.55, 0.50))
    if p.get("tongue"):
        tg = inside_open & (Z < zc - lo_h * 0.35) & (np.abs(xs) < 0.62) & (Z > zc - lo_h)
        over(img, tg.astype(np.float32) * 0.95, (0.84, 0.36, 0.40))
    img[..., 3] = np.clip(img[..., 3], 0, 1)
    return img


# ---------------------------------------------------------------------------------------------- stubble / beard shadow
def stubble(p):
    img = blank()
    kind = p.get("kind", "full")
    hx = np.abs(X)
    fine = hash1(np.floor(X / 0.00085) * 12.9898 + np.floor(Z / 0.00085) * 78.233, p.get("seed", 1))
    dens = np.zeros_like(X)
    jaw_z = 1.512 + 0.075 * np.clip(hx / 0.1, 0, 1) ** 1.6        # jaw line rises towards the ears
    chin_zone = (Z < 1.545 + 0.002) & (Z > 1.505) & (hx < 0.032)
    cheek_zone = (Z > jaw_z) & (Z < 1.598 - 0.4 * np.clip(hx - 0.03, 0, 1)) & (hx > 0.012) & (hx < 0.104)
    under_nose = (Z > 1.563) & (Z < 1.590) & (hx < 0.022 * (1 - (Z - 1.563) / 0.05))
    below_lip = (Z < 1.548) & (Z > 1.528) & (hx < 0.024)
    if kind == "full":
        dens = np.where(cheek_zone | chin_zone | under_nose, 1.0, 0.0)
        dens = np.where((Z > 1.563) & (hx < 0.02) & ~under_nose, 0, dens)
    elif kind == "light":
        dens = np.where(cheek_zone | chin_zone | under_nose, 0.55, 0.0)
    elif kind == "heavy":
        dens = np.where(cheek_zone | chin_zone | under_nose | ((Z > 1.52) & (hx < 0.085) & (Z < 1.60)), 1.0, 0.0)
    elif kind == "chinstrap":
        dens = np.where(((Z < jaw_z + 0.01) & (Z > jaw_z - 0.003) & (hx > 0.02) & (hx < 0.1)) | chin_zone, 1.0, 0.0)
    elif kind == "goatee":
        dens = np.where(chin_zone | below_lip | ((Z > 1.543) & (Z < 1.567) & (hx < 0.027)), 1.0, 0.0)
        dens = np.where((np.abs(Z - 1.553) < 0.002) & (hx < 0.024), 0, dens)
    elif kind == "moustache":
        dens = np.where((Z > 1.558) & (Z < 1.585) & (hx < 0.032), 1.0, 0.0) * (hx < 0.03 * (1 - 0.6 * np.clip((Z - 1.565) / 0.02, 0, 1)))
    # soft edges
    edge = noise1(X * 90 + Z * 55, p.get("seed", 1), 1.0) * 0.5 + 0.5
    on = (fine < dens * p.get("amount", 0.62) * (0.7 + 0.5 * edge)).astype(np.float32)
    on = np.clip(on * (hash1(np.floor(X / 0.0006) + np.floor(Z / 0.0006) * 31, 5) > 0.15), 0, 1)
    img[..., :3] = 1.0
    img[..., 3] = on * p.get("alpha", 0.55)
    return img


# ---------------------------------------------------------------------------------------------- iris textures (one eyeball, 256 px)
M = 256


def iris(p):
    """p: ri (iris radius, fraction of the half width), pr (pupil radius fraction of iris), pupil (round|slit|hslit|star|keyhole|
    square), pat (smooth|streaks|ring|sectors|flecks|swirl|fire|milky), limbal, hl (highlight style), glow, base_lum, sclera tint."""
    yy, xx = np.mgrid[0:M, 0:M].astype(np.float32)
    u = ((xx + 0.5) / M - 0.5) * 2      # -1..1 (ball diameter)
    v = ((yy + 0.5) / M - 0.5) * 2
    r = np.hypot(u, v)
    th = np.arctan2(v, u)
    ri = p.get("ri", 0.56)
    pr = p.get("pr", 0.42)
    img = np.zeros((M, M, 4), np.float32)
    sc = p.get("sclera", (0.965, 0.955, 0.94))
    img[..., :3] = sc
    # faint warm shading at the rim of the ball (the sclera meets the lids)
    rim = smooth((r - 0.75) / 0.3)
    for c, dv in enumerate((0.09, 0.12, 0.10)):
        img[..., c] -= rim * dv
    img[..., 3] = 0
    aa = 0.015
    disc = np.clip((ri - r) / aa + 0.5, 0, 1)
    pat = p.get("pat", "smooth")
    rn = np.clip(r / ri, 0, 1)
    lum = 0.55 + 0.35 * (1 - rn) ** 1.3                      # lighter around the pupil, darker to the rim
    seed = p.get("seed", 1)
    if pat == "streaks":
        n = noise1(th * 7.0, seed, 1) * 0.5 + noise1(th * 17.0, seed + 3, 1) * 0.5
        lum = lum * (0.78 + 0.45 * n * smooth((rn - 0.15) / 0.3)) + 0.08
    elif pat == "ring":
        lum = lum * 0.9 + 0.30 * np.exp(-((rn - 0.50) / 0.14) ** 2) - 0.12 * np.exp(-((rn - 0.82) / 0.1) ** 2)
    elif pat == "sectors":
        lum = lum * (0.85 + 0.30 * (np.sin(th * 3.0 + seed) > 0.2) * smooth((rn - 0.25) / 0.2))
    elif pat == "flecks":
        f = noise1(th * 11.0 + rn * 3.0, seed, 1) * noise1(rn * 9.0, seed + 1, 1)
        lum = lum * (0.8 + 0.5 * f) + 0.04
    elif pat == "swirl":
        lum = lum * (0.8 + 0.3 * np.sin(th * 5.0 + rn * 7.0 + seed) * smooth((rn - 0.1) / 0.3))
    elif pat == "fire":
        lum = 0.5 + 0.5 * np.exp(-((rn - 0.35) / 0.35) ** 2) + 0.07 * np.sin(th * 9 + seed) * smooth((rn - 0.2) / 0.3)
    elif pat == "milky":
        lum = 0.8 + 0.1 * (1 - rn)
    lim = p.get("limbal", 0.5)
    lum = lum * (1 - lim * smooth((rn - 0.86) / 0.14) * 0.55)
    lum = np.clip(lum, 0, 1.15)
    img[..., 0] = img[..., 0] * (1 - disc) + lum * disc
    img[..., 1] = img[..., 1] * (1 - disc) + lum * disc
    img[..., 2] = img[..., 2] * (1 - disc) + lum * disc
    img[..., 3] = disc
    # pupil
    pp = p.get("pupil", "round")
    prr = ri * pr
    if pp == "round":
        pm = np.clip((prr - r) / aa + 0.5, 0, 1)
    elif pp == "slit":
        d = np.hypot(u / (prr * 0.28), v / (prr * 1.55))
        pm = np.clip((1 - d) / 0.12 + 0.5, 0, 1)
    elif pp == "hslit":
        d = np.hypot(u / (prr * 1.5), v / (prr * 0.55))
        pm = np.clip((1 - d) / 0.12 + 0.5, 0, 1)
    elif pp == "star":
        d = r / (prr * (0.78 + 0.35 * np.abs(np.cos(th * 2.0))))
        pm = np.clip((1 - d) / 0.1 + 0.5, 0, 1)
    elif pp == "keyhole":
        pm = np.maximum(np.clip((prr * 0.7 - np.hypot(u, v + prr * 0.2)) / aa + 0.5, 0, 1),
                        ((np.abs(u) < prr * 0.35) & (v < -prr * 0.1) & (v > -prr * 1.3)).astype(np.float32))
    elif pp == "small":
        pm = np.clip((prr * 0.55 - r) / aa + 0.5, 0, 1)
    elif pp == "big":
        pm = np.clip((prr * 1.5 - r) / aa + 0.5, 0, 1)
    else:
        pm = np.clip((prr - r) / aa + 0.5, 0, 1)
    pm = pm * (1 if pat != "milky" else 0.35)
    pc = p.get("pupil_col", (0.04, 0.04, 0.05))
    for c in range(3):
        img[..., c] = img[..., c] * (1 - pm) + pc[c] * pm
    img[..., 3] = img[..., 3] * (1 - pm)
    if p.get("glow"):                      # glowing rim around the pupil: keep tintable, brighter
        g = np.exp(-((r - prr * 1.25) / (ri * 0.12)) ** 2) * disc * (1 - pm)
        img[..., :3] = np.clip(img[..., :3] + g[..., None] * 0.5, 0, 1.2)
    # highlights (final colour, not tinted)
    hs = p.get("hl", "single")
    spots = []
    if hs == "single":
        spots = [(-0.20, 0.24, 0.085)]
    elif hs == "double":
        spots = [(-0.20, 0.24, 0.085), (0.17, -0.20, 0.04)]
    elif hs == "big":
        spots = [(-0.22, 0.26, 0.12), (0.15, -0.18, 0.045)]
    elif hs == "small":
        spots = [(-0.17, 0.2, 0.045)]
    elif hs == "star":
        spots = [(-0.2, 0.24, 0.07)]
    elif hs == "low":
        spots = [(-0.14, 0.12, 0.06), (0.16, -0.18, 0.03)]
    for (hx, hy, hr) in spots:
        hm = np.clip((hr - np.hypot(u - hx, v - hy)) / 0.012 + 0.5, 0, 1)
        if hs == "star":
            hm = np.maximum(hm, np.clip((0.012 - np.minimum(np.abs(u - hx), np.abs(v - hy))) / 0.006 + 0.5, 0, 1) *
                            (np.hypot(u - hx, v - hy) < hr * 1.8))
        for c in range(3):
            img[..., c] = img[..., c] * (1 - hm) + 1.0 * hm
        img[..., 3] = img[..., 3] * (1 - hm)
    return img
