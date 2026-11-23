"""Procedural textures for eyes, lashes, brows and hair strands (2026-11 face rework).  Plain python3 + numpy + Pillow.

    python3 art3d/characters/tex_gen.py            # default eye + lash textures into export/textures/
Other scripts import the painters (parts/ builds 30 eyes, lash styles, 30 brows, hair strand atlases).

Conventions: PNG, sRGB colour, straight alpha.  Eye: planar front projection of the eyeball, centre (0.5, 0.5), eyeball radius
= 0.5 in UV, iris radius = face_rig.IRIS_FRAC * 0.5.  Lashes: top half = upper lid (root at v 0.5, tips at v 1), bottom half
= lower lid (root at v 0.5, tips at v 0); u runs from the inner to the outer corner.
"""
import os, math
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
TEX = os.path.join(HERE, "export", "textures")
IRIS_FRAC = 0.40


def _rng(seed):
    return np.random.default_rng(seed)


def _smooth(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def _noise2(h, w, scale, seed, octaves=4):
    """fractal value noise (h, w) in 0..1, periodic in x (for polar maps)."""
    r = _rng(seed)
    out = np.zeros((h, w))
    amp, tot = 1.0, 0.0
    for o in range(octaves):
        gh, gw = max(2, int(h / scale * 2 ** o)), max(2, int(w / scale * 2 ** o))
        g = r.random((gh + 1, gw))
        g = np.concatenate([g, g[:, :1]], axis=1)
        im = Image.fromarray((g * 255).astype(np.uint8)).resize((w + w // gw, h), Image.BICUBIC)
        out += amp * np.asarray(im, float)[:, :w] / 255.0
        tot += amp
        amp *= 0.5
    return out / tot


def save_rgba(rgb, alpha, path):
    rgb = np.clip(rgb, 0, 1)
    a = np.ones(rgb.shape[:2]) if alpha is None else np.clip(alpha, 0, 1)
    arr = np.dstack([rgb, a])
    os.makedirs(os.path.dirname(path), exist_ok=True)
    Image.fromarray((arr * 255 + 0.5).astype(np.uint8), "RGBA" if alpha is not None else "RGBA").save(path)


# ------------------------------------------------------------------------------------------------ eyes
def eye_texture(iris=(0.30, 0.45, 0.62), iris2=None, pattern="smooth", pupil="round", pupil_size=0.36, sclera=(0.93, 0.90, 0.86),
                limbal=0.65, veins=0.5, glow=False, seed=1, res=512):
    """RGB eyeball texture (display colours). iris2 = inner (collarette) colour, default a warmer lighter version of iris."""
    iris = np.array(iris, float)
    iris2 = np.array(iris2, float) if iris2 is not None else np.clip(iris * np.array([1.25, 1.12, 0.85]) + 0.06, 0, 1)
    sclera = np.array(sclera, float)
    y, x = np.mgrid[0:res, 0:res]
    u = (x + 0.5) / res - 0.5
    v = 0.5 - (y + 0.5) / res
    r = np.sqrt(u * u + v * v) * 2            # 0 centre .. 1 eyeball silhouette
    th = np.arctan2(v, u)
    ri = IRIS_FRAC                             # iris radius in r units
    rn = r / ri                                # 0..1 inside the iris
    # ---- sclera: warm white, pinker and slightly darker towards the corners, soft blue-grey near the limbus
    col = np.ones((res, res, 3)) * sclera
    edge = _smooth(0.45, 1.0, r)
    col = col * (1 - 0.10 * edge[..., None]) + np.array([0.85, 0.55, 0.52]) * (0.18 * edge)[..., None]
    col = col * (1 - 0.06 * _smooth(1.6, 1.05, rn)[..., None]) + np.array([0.70, 0.74, 0.82]) * (0.05 * _smooth(1.6, 1.05, rn))[..., None]
    # veins: thin branching red lines from the edge inward
    if veins > 0:
        img = Image.new("L", (res * 2, res * 2), 0)
        d = ImageDraw.Draw(img)
        rg = _rng(seed + 7)
        for k in range(int(26 * veins)):
            a0 = rg.uniform(-math.pi, math.pi)
            # most veins at the inner/outer corners (left/right), few top/bottom
            a0 = rg.choice([0.0, math.pi]) + rg.normal(0, 0.55)
            rr = 0.98
            pts = []
            a = a0
            while rr > ri * 1.25:
                pts.append(((0.5 + 0.5 * rr * math.cos(a)) * res * 2, (0.5 - 0.5 * rr * math.sin(a)) * res * 2))
                rr -= rg.uniform(0.02, 0.05)
                a += rg.normal(0, 0.06)
                if rg.random() < 0.1:
                    break
            if len(pts) > 1:
                d.line(pts, fill=int(255 * rg.uniform(0.35, 0.8)), width=max(1, int(rg.uniform(1, 2.5))))
        vm = np.asarray(img.filter(ImageFilter.GaussianBlur(1.2)).resize((res, res), Image.LANCZOS), float) / 255.0
        vm *= _smooth(ri * 1.15, ri * 1.6, r) * 0.55
        col = col * (1 - vm[..., None]) + np.array([0.75, 0.30, 0.30]) * vm[..., None]
    # ---- iris
    fib = _noise2(res, 720, 6, seed, 3)       # polar map: rows = radius, cols = angle
    polar_r = np.clip(rn, 0, 1) * (res - 1)
    polar_t = ((th + math.pi) / (2 * math.pi)) * 719
    fibres = fib[polar_r.astype(int), polar_t.astype(int) % 720]
    fine = _noise2(res, 1440, 2, seed + 3, 2)[polar_r.astype(int), (polar_t * 2).astype(int) % 1440]
    ic = iris[None, None] * (0.75 + 0.5 * fibres[..., None])
    ic = ic * (0.9 + 0.2 * fine[..., None])
    coll = _smooth(0.75, 0.40, rn) * _smooth(pupil_size * 0.9, pupil_size + 0.08, rn)          # collarette ring around the pupil
    ic = ic * (1 - coll[..., None] * 0.6) + iris2[None, None] * (coll[..., None] * 0.6) * (0.85 + 0.3 * fibres[..., None])
    if pattern in ("streaks", "sectors"):
        st = 0.5 + 0.5 * np.sin(th * (24 if pattern == "streaks" else 6) + 3 * fibres)
        ic = ic * (0.8 + 0.35 * st[..., None])
    if pattern == "flecks":
        fl = _smooth(0.82, 0.92, _noise2(res, res, 10, seed + 9, 2))
        ic = ic * (1 - fl[..., None] * 0.6) + np.array([0.80, 0.60, 0.25]) * (fl[..., None] * 0.6)
    if pattern == "ring":
        ring = _smooth(0.55, 0.65, rn) * _smooth(0.85, 0.72, rn)
        ic = ic * (1 - 0.35 * ring[..., None])
    if pattern == "milky":
        ic = ic * 0.55 + np.array([0.80, 0.82, 0.85]) * 0.45
    if pattern in ("fire", "swirl"):
        sw = 0.5 + 0.5 * np.sin(th * 5 + rn * (9 if pattern == "swirl" else 3) + 4 * fibres)
        ic = ic * (0.7 + 0.6 * sw[..., None])
    # limbal ring (dark soft edge) and a darker outer iris band
    lim = _smooth(0.78, 1.0, rn) * limbal
    ic = ic * (1 - lim[..., None] * 0.75)
    # pupil
    if pupil == "slit":
        pr = np.sqrt((u / (ri * 0.5) / 0.22) ** 2 + (v / (ri * 0.5) / 0.95) ** 2) * 0.5
        pm = _smooth(0.52, 0.47, pr)
    elif pupil == "horizontal":
        pr = np.sqrt((u / (ri * 0.5) / 0.95) ** 2 + (v / (ri * 0.5) / 0.30) ** 2) * 0.5
        pm = _smooth(0.52, 0.47, pr)
    else:
        ps = pupil_size * (0.75 if pupil == "small" else 1.0)
        pm = _smooth(ps + 0.035, ps - 0.02, rn)
    ic = ic * (1 - pm[..., None]) + np.array([0.015, 0.012, 0.012]) * pm[..., None]
    im = _smooth(1.0, 0.975, rn)
    col = col * (1 - im[..., None]) + ic * im[..., None]
    if glow:
        g = _smooth(1.0, 0.2, rn)
        col = np.clip(col + iris * g[..., None] * 0.5, 0, 1)
    return np.clip(col, 0, 1)


# ------------------------------------------------------------------------------------------------ strands (lashes, brows, hair)
def strand_layer(res_w, res_h, strands, colour=(0.05, 0.035, 0.03), ss=3, blur=0.6):
    """strands: list of (points [(u,v)...] in 0..1 with v up, width_root_px, width_tip_px, shade). Returns rgb, alpha."""
    W, H = res_w * ss, res_h * ss
    a_img = Image.new("L", (W, H), 0)
    s_img = Image.new("L", (W, H), 0)
    da = ImageDraw.Draw(a_img)
    ds = ImageDraw.Draw(s_img)
    for pts, w0, w1, shade in strands:
        n = len(pts)
        for k in range(n - 1):
            t = k / max(n - 2, 1)
            w = max(1, int(round((w0 + (w1 - w0) * t) * ss)))
            p0 = (pts[k][0] * W, (1 - pts[k][1]) * H)
            p1 = (pts[k + 1][0] * W, (1 - pts[k + 1][1]) * H)
            al = int(255 * (1.0 - 0.35 * t))
            da.line([p0, p1], fill=al, width=w)
            ds.line([p0, p1], fill=int(255 * shade), width=w)
    a_img = a_img.filter(ImageFilter.GaussianBlur(blur * ss)).resize((res_w, res_h), Image.LANCZOS)
    s_img = s_img.filter(ImageFilter.GaussianBlur(blur * ss)).resize((res_w, res_h), Image.LANCZOS)
    a = np.asarray(a_img, float) / 255.0
    sh = np.asarray(s_img, float) / 255.0
    rgb = np.array(colour)[None, None] * (0.6 + 0.8 * sh[..., None])
    return np.clip(rgb, 0, 1), a


def lash_texture(style="natural", seed=3, res=512, colour=(0.020, 0.015, 0.013)):
    """upper lashes in the top half, lower lashes in the bottom half."""
    rg = _rng(seed)
    dens = {"natural": 1.0, "full": 1.6, "sparse": 0.55, "long": 1.1, "wing": 1.3, "short": 0.9}.get(style, 1.0)
    strands = []
    n_up = int(150 * dens)
    for i in range(n_up):
        u = rg.uniform(0.0, 1.0)
        clump = math.floor(u * 40) / 40 + 0.012
        u = 0.7 * u + 0.3 * clump
        L = rg.uniform(0.75, 1.0) * (0.55 + 0.45 * math.sin(min(u, 1) * math.pi * 0.85) ** 0.7)
        if style == "short":
            L *= 0.7
        if style == "wing":
            L *= 0.7 + 0.6 * u ** 2
        lean = (u - 0.35) * 0.12 + rg.normal(0, 0.025)
        pts = []
        for k in range(7):
            t = k / 6
            pts.append((u + lean * t * t, 0.5 + 0.49 * L * t))
        strands.append((pts, 2.2, 0.6, rg.uniform(0.3, 0.7)))
    # dense short root fringe = the dark lash line
    for i in range(int(260 * dens)):
        u = rg.uniform(0.0, 1.0)
        L = rg.uniform(0.10, 0.26)
        pts = [(u + rg.normal(0, 0.004) * (k / 3), 0.5 + 0.49 * L * (k / 3)) for k in range(4)]
        strands.append((pts, 3.0, 1.2, rg.uniform(0.1, 0.3)))
    for i in range(int(70 * dens)):
        u = rg.uniform(0.08, 0.98)
        L = rg.uniform(0.5, 1.0) * (0.35 + 0.65 * math.sin(u * math.pi) ** 0.7)
        lean = (u - 0.5) * 0.10 + rg.normal(0, 0.03)
        pts = [(u + lean * (k / 5) ** 2, 0.5 - 0.48 * L * (k / 5)) for k in range(6)]
        strands.append((pts, 1.6, 0.5, rg.uniform(0.3, 0.7)))
    return strand_layer(res, res, strands, colour, blur=0.5)




# ------------------------------------------------------------------------------------------------ brows (card textures)
BROW_H = 0.0125          # half height of the brow card in metres (card spans the brow centreline +- BROW_H)


def brow_texture(p, res_w=1024, res_h=256, seed=1):
    """Two rows: top half (v 0.5..1) = flush layer, bottom half (v 0..0.5) = lifted layer with fewer, longer hairs.
    u = 0 at the inner end, 1 at the outer end; within a row the card centreline is at the row middle.  Hairs grow from the lower
    edge of the brow shape: near the inner end they point up, further out they lie along the brow towards the temple."""
    rg = _rng(seed)
    L = p.get("length", 0.040)
    th = p.get("th", 0.0035)
    a_in, a_out = p.get("a_in", 0.7), p.get("a_out", 0.15)
    bushy, sparse = p.get("bushy", 0.0), p.get("sparse", 0.0)
    scar = p.get("scar")
    rgb_all, a_all = [], []
    for layer in (0, 1):
        strands = []
        n = int((1100 if layer == 0 else 320) * (1 - 0.6 * sparse) * (1 + 0.4 * bushy) * (th / 0.0035) ** 0.6)
        for i in range(n):
            t = rg.uniform(0.0, 1.0) ** (1.0 if rg.random() < 0.7 else 0.8) * 1.02 - 0.02
            w = th * (a_in + (1 - a_in) * _smooth(0, 0.35, t)) * (1 - (1 - a_out) * _smooth(0.5, 1.0, t))
            if scar and abs(t - scar.get("t", 0.5)) < scar.get("w", 0.0025) / L * 1.3:
                continue
            # root anywhere in the lower 80 % of the band, hair length ~ band height
            base_v = rg.uniform(-w, w * 0.6)
            ang_deg = 80 - 62 * _smooth(0.0, 0.35, t) + rg.normal(0, 8 + 10 * bushy)   # angle above the brow axis
            ang = math.radians(ang_deg)
            hl = (w * 1.3 + 0.0016) * rg.uniform(0.6, 1.1) * (1.3 if layer else 1.0) * (1 + 0.5 * bushy)
            curve = rg.normal(0, 0.25)
            pts = []
            for k in range(6):
                s = k / 5
                a = ang - curve * s * 0.6
                du = math.cos(a) * hl * s / L
                dv = math.sin(a) * hl * s
                pts.append((min(max(t + du, 0.0), 1.0), dv + base_v))
            # to texture space of this row
            row = [(u, (0.5 if layer == 0 else 0.0) + 0.25 + 0.25 * v / BROW_H) for u, v in pts]
            strands.append((row, 2.6 if layer == 0 else 2.0, 0.8, rg.uniform(0.25, 0.75)))
        rgb, a = strand_layer(res_w, res_h, strands, colour=(1.0, 1.0, 1.0), ss=2, blur=0.45)
        if layer == 0:
            # soft underlying mass so the brow reads as a shape, not a scribble
            uu = (np.arange(res_w) + 0.5) / res_w
            ww = th * (a_in + (1 - a_in) * _smooth(0, 0.35, uu)) * (1 - (1 - a_out) * _smooth(0.5, 1.0, uu)) * (1 - 0.6 * sparse)
            vv = (np.arange(res_h)[::-1] + 0.5) / res_h               # image rows top = v 1
            vrow = (vv - 0.75) / 0.25 * BROW_H                         # metres from the centreline in the flush row
            band = np.clip(1 - np.abs(vrow[:, None] - 0.0004) / (ww[None, :] * 1.05 + 1e-6), 0, 1)
            band = band ** 0.6 * 0.55 * (vv[:, None] > 0.5)
            if scar:
                gap = np.abs(uu - scar.get("t", 0.5)) < scar.get("w", 0.0025) / L * 1.3
                band[:, gap] = 0
            a = np.clip(a + band * (1 - a), 0, 1)
        rgb_all.append(rgb)
        a_all.append(a)
    a = np.clip(a_all[0] + a_all[1], 0, 1)
    rgb = np.where(a_all[0][..., None] > 0.01, rgb_all[0], rgb_all[1])
    rgb = 0.55 + 0.45 * (rgb - rgb.min()) / (np.ptp(rgb) + 1e-6)       # greyscale, multiplied by the hair colour
    return rgb, a


# ------------------------------------------------------------------------------------------------ hair
def hair_strand_tile(res_w=512, res_h=1024, seed=5):
    """tileable strand texture for the hair/beard shells: RGB = strand brightness (multiply by hair colour),
    A = breakup for the soft edges (shader: alpha = clamp((A - (1 - vertexAlpha)) * 3)).  Also returns a height map."""
    rg = _rng(seed)
    x = np.arange(res_w)
    h = np.zeros((res_h, res_w))
    # vertical strands: per column random brightness with slow drift along v, clumps every ~40 px
    base = _noise2(res_w, res_h, 16, seed, 3).T[:res_h, :res_w] if False else None
    cols = rg.random(res_w)
    clump = 0.5 + 0.5 * np.sin(x / res_w * 2 * math.pi * 12 + 3 * rg.random())
    for k in range(3):
        cols = 0.5 * cols + 0.25 * np.roll(cols, 1) + 0.25 * np.roll(cols, -1) if k == 0 else cols
    drift = _noise2(res_h, res_w, 40, seed + 1, 3)
    h = cols[None, :] * 0.6 + 0.25 * clump[None, :] + 0.08 * (drift - 0.5)
    fine = _rng(seed + 2).random(res_w)
    h = h + 0.25 * fine[None, :]
    h = (h - h.min()) / np.ptp(h)
    # dark gaps between clumps (~3 mm) so the strands read at game distance
    gap = 0.5 + 0.5 * np.sin(x / res_w * 2 * math.pi * 10 + 2.0 * np.sin(x / res_w * 2 * math.pi * 3))
    h = np.clip(0.75 * h + 0.25 * gap[None, :] ** 3, 0, 1)
    rgb = np.repeat((0.32 + 0.80 * h)[..., None], 3, axis=2)
    # breakup: strand tips at different heights
    tipv = rg.random(res_w)
    vv = np.arange(res_h)[:, None] / res_h
    a = np.clip(0.35 + 0.65 * (0.6 * cols[None, :] + 0.4 * tipv[None, :]) * np.ones_like(vv), 0, 1)
    # normal map from h (strands as ridges across u)
    dhx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * 0.5
    dhy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * 0.5
    k = 2.5
    n = np.dstack([-dhx * k, dhy * k, np.ones_like(h)])
    n /= np.linalg.norm(n, axis=2, keepdims=True)
    return np.clip(rgb, 0, 1), a, n * 0.5 + 0.5


def hair_card_atlas(res=1024, seed=9, kind="hair"):
    """4 columns of strand clumps (u 0..0.25, ...), root at v=0, tips at v=1.  kind 'beard' = curlier, shorter."""
    rg = _rng(seed)
    strands = []
    for col in range(4):
        n = 70 if kind == "hair" else 90
        for i in range(n):
            u0 = col * 0.25 + 0.03 + rg.uniform(0, 0.19)
            L = rg.uniform(0.55, 0.98)
            wav = rg.normal(0, 0.010 if kind == "hair" else 0.03)
            freq = rg.uniform(1, 3) if kind == "hair" else rg.uniform(4, 9)
            ph = rg.uniform(0, 6)
            conv = (col * 0.25 + 0.125 - u0) * rg.uniform(0.2, 0.6)        # clump: tips converge
            pts = []
            for k in range(14):
                t = k / 13
                pts.append((u0 + conv * t + wav * math.sin(freq * t * math.pi + ph), 0.01 + 0.97 * L * t))
            strands.append((pts, 2.6 if kind == "hair" else 2.2, 0.5, rg.uniform(0.2, 0.9)))
    rgb, a = strand_layer(res, res, strands, colour=(1.0, 1.0, 1.0), ss=2, blur=0.4)
    rgb = 0.55 + 0.45 * (rgb - rgb.min()) / (np.ptp(rgb) + 1e-6)
    return rgb, a


def save_normal(n, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    Image.fromarray((np.clip(n, 0, 1) * 255 + 0.5).astype(np.uint8), "RGB").save(path)


LASH_STYLES = {"natural": {}, "full": {}, "sparse": {}, "long": {}, "wing": {}, "short": {}}


PTEX = os.path.join(HERE, "parts", "export", "textures")


def build_all(out=TEX, pout=PTEX):
    """every generated texture of the face rework: base (eye_default, lashes) in export/textures, parts in parts/export/textures."""
    import sys
    sys.path.insert(0, os.path.join(HERE, "parts"))
    import specs
    save_rgba(eye_texture(), None, os.path.join(out, "eye_default.png"))
    for st in LASH_STYLES:
        rgb, a = lash_texture(st, seed=3 + len(st))
        save_rgba(rgb, a, os.path.join(out, "lashes", f"lashes_{st}.png"))
    rgb, a = lash_texture("natural")
    save_rgba(rgb, a, os.path.join(out, "lashes_default.png"))
    for i, e in enumerate(specs.EYES):
        ir = e["iris"]
        col = specs.IRIS_COLOURS[e["colour"]]
        pup = {"hslit": "horizontal", "keyhole": "round", "square": "horizontal"}.get(ir.get("pupil", "round"), ir.get("pupil", "round"))
        rgb = eye_texture(iris=col, pattern=ir.get("pat", "smooth"), pupil=pup, pupil_size=0.36 if ir.get("pupil") != "small" else 0.30,
                          glow=bool(ir.get("glow")), seed=ir.get("seed", i + 1), veins=0.25 if "elder" in e["tags"] else 0.15)
        save_rgba(rgb, None, os.path.join(pout, "eyes_hd", f"eye_{i+1:02d}.png"))
    for i, b in enumerate(specs.BROWS):
        rgb, a = brow_texture(b["p"], seed=i + 1)
        save_rgba(rgb, a, os.path.join(pout, "brows_hd", f"brow_{i+1:02d}.png"))
    rgb, a, n = hair_strand_tile()
    save_rgba(rgb, a, os.path.join(pout, "hair", "hair_strands.png"))
    save_normal(n, os.path.join(pout, "hair", "hair_strands_normal.png"))
    for kind in ("hair", "beard"):
        rgb, a = hair_card_atlas(kind=kind, seed=9 if kind == "hair" else 19)
        save_rgba(rgb, a, os.path.join(pout, "hair", f"{kind}_cards.png"))
    print("textures written to", out)


if __name__ == "__main__":
    build_all()
