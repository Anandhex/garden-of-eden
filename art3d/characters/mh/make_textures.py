"""Derived preview textures from the MakeHuman system assets (system python3 + Pillow; deterministic).

    python3 -I art3d/characters/mh/make_textures.py <mpfb user data dir>

* eyes: the MakeHuman eye textures with the iris enlarged (IRIS_SCALE, radial resample around each iris centre, soft
  blend into the sclera) and a slightly darker limbal ring -> mh/textures/eye_<colour>.png
* lashes: the MakeHuman lash cards with a denser alpha (dilate + blur + gain) -> mh/textures/<name>_dense.png
"""
import os, sys
import numpy as np
from PIL import Image, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "textures")
IRIS_SCALE = 1.12
CENTRES = ((303.2, 722.3), (732.0, 312.6))          # iris centres of the MakeHuman 1024 eye layout (measured)
R_IRIS = 92.0                                        # iris radius incl. the limbal ring, px


def bigger_iris(src, dst):
    a = np.asarray(Image.open(src).convert("RGBA")).astype(np.float64)
    H, W = a.shape[:2]
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float64)
    out = a.copy()
    for cx, cy in CENTRES:
        dx, dy = xx - cx, yy - cy
        r = np.hypot(dx, dy)
        R1 = R_IRIS * IRIS_SCALE
        m = r < R1 * 1.25
        # inside R1: sample the original at r / scale; between R1 and 1.25 R1: blend back to the original sclera
        s = np.where(r < R1, 1.0 / IRIS_SCALE, 1.0)
        sx = cx + dx * s
        sy = cy + dy * s
        xi = np.clip(sx.round().astype(int), 0, W - 1)
        yi = np.clip(sy.round().astype(int), 0, H - 1)
        samp = a[yi, xi]
        w = np.clip((R1 * 1.04 - r) / (R1 * 0.08), 0, 1)[..., None]
        blended = samp * w + a * (1 - w)
        # limbal ring: darken a band at the iris edge
        ring = np.exp(-((r - R1 * 0.93) / (R1 * 0.06)) ** 2)[..., None]
        blended[..., :3] *= 1 - 0.45 * ring
        out[m] = blended[m]
        # sclera towards the eye corners: slightly darker and pinker (no flat white running to a blunt edge)
        mm = (r > R1 * 1.1) & (r < R1 * 5.0)
        corner = np.clip((np.abs(dx) - R1 * 1.8) / (R1 * 1.6), 0, 1) ** 1.3
        rim = np.clip((r - R1 * 2.4) / (R1 * 1.6), 0, 1)
        f = np.maximum(corner, 0.6 * rim)[..., None]
        out[..., :3] = np.where(mm[..., None], out[..., :3] * (1 - f * np.array([0.12, 0.30, 0.28])), out[..., :3])
    Image.fromarray(np.clip(out, 0, 255).astype(np.uint8)).save(dst)


def dense_lashes(src, dst, grow=3, blur=1.0, gain=1.5, lower=0.55):
    """upper lash rows (top half of the MakeHuman card layout) denser; the lower rows (bottom half) kept thin."""
    im = Image.open(src).convert("RGBA")
    a0 = np.asarray(im.getchannel("A")).astype(np.float64)
    al = im.getchannel("A").filter(ImageFilter.MaxFilter(grow)).filter(ImageFilter.GaussianBlur(blur))
    a1 = np.asarray(al).astype(np.float64) * gain
    H = a0.shape[0]
    rows = np.arange(H)[:, None] / H
    a = np.where(rows < 0.5, a1, a0 * lower)
    al = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))
    rgb = Image.new("RGB", im.size, (10, 8, 7))
    rgb.putalpha(al)
    rgb.save(dst)


def lash_strands(dst, W=1024, H=256, seed=7, n=520, lower=False):
    """alpha texture of clumped, tapered lash strands: u = along the lid (0 inner corner, 1 outer), v = root (bottom of the
    image) to tip (top).  Strands are denser and longer in the outer part, slightly curved, gathered in small clumps."""
    from PIL import ImageDraw
    rng = np.random.default_rng(seed)
    im = Image.new("L", (W * 2, H * 2), 0)          # 2x supersampling
    d = ImageDraw.Draw(im)
    S = 2
    clumps = rng.uniform(0, 1, n // 5) ** 0.75
    for k in range(n):
        c = clumps[k % len(clumps)]
        u = np.clip(c + rng.normal(0, 0.012), 0, 1)
        length = 0.70 + 0.30 * rng.random()
        if lower:
            length *= 0.8
        x0 = u * W
        bend = rng.normal(0.0, 0.04) * W + (u - 0.5) * 0.08 * W
        pts = []
        steps = 12
        for i in range(steps + 1):
            t = i / steps
            pts.append(((x0 + bend * t * t) * S, (H - t * length * H * 0.98) * S))
        for i in range(steps):
            w = max(0.4, (1 - i / steps) ** 1.5 * (1.7 if not lower else 1.4)) * S
            d.line([pts[i], pts[i + 1]], fill=255, width=int(round(w)))
    # dark root band (the lash line itself)
    d.rectangle([0, (H - 6) * S, W * S, H * S], fill=255)
    al = im.resize((W, H), Image.LANCZOS).filter(ImageFilter.GaussianBlur(0.5))
    rgb = Image.new("RGB", (W, H), (12, 9, 8))
    rgb.putalpha(al)
    rgb.save(dst)


BROW_VARIANTS = {
    # name: strands, width px, length px, angle spread, blur, envelope grow (px), uniform angle
    "brow_fine": (750, 1.2, 16, 10, 0.4, -1, False),
    "brow_bushy": (1900, 1.15, 21, 13, 0.55, 1, False),       # round 24: more, finer strands (was 1000 x 1.8 px: patchy)
    "brow_groomed": (900, 1.4, 20, 5, 0.0, -1, True),
    "brow_feathered": (800, 1.2, 30, 25, 1.4, 3, False),
}


def brow_textures(src, out_dir):
    """3-4 extra brow alpha textures on the eyebrow001 card layout (same UVs): hair strands painted inside eyebrow001's own
    brow envelopes (top brow: head on the left; bottom brow: head on the right), angled from steep at the head to flat
    at the tail."""
    from PIL import ImageDraw
    al0 = np.asarray(Image.open(src).convert("RGBA"))[..., 3].astype(np.float64)
    H, W = al0.shape
    for name, (n, wpx, L, spread, blur, grow, uniform) in BROW_VARIANTS.items():
        rng = np.random.default_rng(abs(hash(name)) % 2 ** 32 if False else sum(map(ord, name)))
        env = Image.fromarray((al0 > 30).astype(np.uint8) * 255)
        if grow > 0:
            env = env.filter(ImageFilter.MaxFilter(2 * grow + 1))
        elif grow < 0:
            env = env.filter(ImageFilter.MinFilter(-2 * grow + 1))
        E = np.asarray(env) > 0
        S = 2
        im = Image.new("L", (W * S, H * S), 0)
        d = ImageDraw.Draw(im)
        for half, head_left in ((slice(0, H // 2), True), (slice(H // 2, H), False)):
            ys, xs = np.nonzero(E[half])
            ys = ys + half.start
            if len(xs) == 0:
                continue
            x0, x1 = xs.min(), xs.max()
            for k in range(n):
                i = rng.integers(len(xs))
                x, y = float(xs[i]), float(ys[i])
                t = (x - x0) / max(x1 - x0, 1) if head_left else (x1 - x) / max(x1 - x0, 1)
                ang = (25.0 if uniform else 70.0 - 55.0 * t) + rng.normal(0, spread)
                a = np.radians(ang)
                dirx = np.cos(a) * (1 if head_left else -1)
                l = L * (0.6 + 0.4 * rng.random()) * (1.0 - 0.4 * t)
                xe, ye = x + dirx * l, y - np.sin(a) * l
                d.line([(x * S, y * S), (xe * S, ye * S)], fill=int(170 + 85 * rng.random()), width=max(1, int(round(wpx * S))))
        al = im.resize((W, H), Image.LANCZOS)
        if blur > 0:
            al = al.filter(ImageFilter.GaussianBlur(blur))
        # soft edges like the original: fade with a blurred copy of eyebrow001's own coverage (no blocky card edges)
        soft = Image.fromarray(np.clip(al0 * 1.6, 0, 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(2 * max(grow, 0) + 3))
        soft = np.asarray(soft.filter(ImageFilter.GaussianBlur(5)), dtype=np.float64) / 255.0
        A = np.asarray(al, dtype=np.float64) * np.clip(soft * 1.3, 0, 1)
        # fade the head end of each brow (no square inner end where the card is thickened)
        xx = np.arange(W)[None, :].astype(np.float64)
        for half, head_left in ((slice(0, H // 2), True), (slice(H // 2, H), False)):
            cols = np.nonzero((al0[half] > 30).any(axis=0))[0]
            if len(cols) == 0:
                continue
            x0, x1 = cols.min(), cols.max()
            t = (xx - x0) / max(x1 - x0, 1) if head_left else (x1 - xx) / max(x1 - x0, 1)
            A[half] *= np.clip(t / 0.10, 0, 1) ** 1.5
        al = Image.fromarray(np.clip(A, 0, 255).astype(np.uint8))
        rgb = Image.new("RGB", (W, H), (255, 255, 255))
        rgb.putalpha(al)
        rgb.save(os.path.join(out_dir, name + ".png"))


def clean_lashes(src, dst):
    """MakeHuman lash card texture (same UV layout) made crisp: strands thresholded and sharpened, root-dark colour."""
    im = Image.open(src).convert("RGBA")
    a = np.asarray(im.getchannel("A")).astype(np.float64)
    a = np.clip((a - 45.0) * 1.9, 0, 255)
    al = Image.fromarray(a.astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.35))
    rgb = Image.new("RGB", im.size, (8, 6, 5))
    rgb.putalpha(al)
    rgb.save(dst)


def beard_strands(dst, W=512, n=5200, seed=11):
    """tiling alpha of short, slightly curved facial-hair strands (wraps at the edges)."""
    from PIL import ImageDraw
    rng = np.random.default_rng(seed)
    S = 2
    im = Image.new("L", (W * S, W * S), 0)
    d = ImageDraw.Draw(im)
    for k in range(n):
        x, y = rng.uniform(0, W), rng.uniform(0, W)
        L = rng.uniform(10, 22)
        a = np.radians(-90 + rng.normal(0, 18))
        for ox in (-W, 0, W):
            for oy in (-W, 0, W):
                x0, y0 = x + ox, y + oy
                x1, y1 = x0 + np.cos(a) * L, y0 - np.sin(a) * L * -1
                d.line([(x0 * S, y0 * S), (x1 * S, y1 * S)], fill=int(150 + 105 * rng.random()), width=S)
    al = im.resize((W, W), Image.LANCZOS)
    rgb = Image.new("RGB", (W, W), (255, 255, 255))
    rgb.putalpha(al)
    rgb.save(dst)


def _strand_sheet(W, seed, draw):
    """tiling RGBA strand sheet: draw(d, rng, put) calls put(points, width, brightness); points wrap around the edges."""
    from PIL import ImageDraw
    rng = np.random.default_rng(seed)
    S = 2
    A = Image.new("L", (W * S, W * S), 0)
    L = Image.new("L", (W * S, W * S), 0)
    da, dl = ImageDraw.Draw(A), ImageDraw.Draw(L)

    def put(pts, width, bright, alpha=255):
        for ox in (-W, 0, W):
            for oy in (-W, 0, W):
                q = [((x + ox) * S, (y + oy) * S) for x, y in pts]
                da.line(q, fill=int(alpha), width=max(1, int(round(width * S))), joint="curve")
                dl.line(q, fill=int(255 * bright), width=max(1, int(round(width * S))), joint="curve")
    draw(rng, put)
    a = A.resize((W, W), Image.LANCZOS)
    l = np.asarray(L.resize((W, W), Image.LANCZOS), dtype=np.float64)
    av = np.asarray(a, dtype=np.float64)
    lum = np.where(av > 1, l / np.maximum(av, 1) * 255, 200)          # un-premultiply the brightness
    rgb = np.clip(np.stack([lum] * 3, -1), 0, 255).astype(np.uint8)
    im = Image.fromarray(rgb, "RGB")
    im.putalpha(a)
    return im


def scalp_strands(dst, W=512, n=9000, seed=21):
    """short scalp hair (caps for crops / receding / thinning): strands along +v (front to crown), slight lean."""
    def draw(rng, put):
        for _ in range(n):
            x, y = rng.uniform(0, W), rng.uniform(0, W)
            L = rng.uniform(12, 26)
            a = np.radians(90 + rng.normal(0, 9))
            bend = rng.normal(0, 2.5)
            pts = [(x + np.cos(a) * L * t + bend * t * t, y - np.sin(a) * L * t) for t in (0, 0.5, 1)]
            put(pts, rng.uniform(0.8, 1.3), rng.uniform(0.55, 1.0), rng.uniform(170, 255))
    _strand_sheet(W, seed, draw).save(dst)


def beard_clumps(dst, W=512, clumps=2600, seed=31):
    """facial hair: clumps of 4-9 strands whose roots spread and whose tips meet (wavy, flowing down -v)."""
    def draw(rng, put):
        for _ in range(clumps):
            tx, ty = rng.uniform(0, W), rng.uniform(0, W)            # the clump tip
            base = np.radians(-90 + rng.normal(0, 20))
            L = rng.uniform(14, 28)
            for _k in range(int(rng.integers(4, 10))):
                a = base + rng.normal(0, 0.10)
                l = L * rng.uniform(0.75, 1.1)
                rx = tx - np.cos(a) * l + rng.normal(0, 3.0)         # root, spread around the clump axis
                ry = ty + np.sin(a) * l
                w = rng.normal(0, 1.2)
                pts = [(rx + (tx - rx) * t + w * np.sin(np.pi * t), ry + (ty - ry) * t) for t in np.linspace(0, 1, 6)]
                put(pts, rng.uniform(0.9, 1.4), rng.uniform(0.5, 1.0), rng.uniform(190, 255))
    _strand_sheet(W, seed, draw).save(dst)


def curl_strands(dst, W=512, n=5200, seed=41):
    """coily / curly hair: small open loops and spirals in every direction (afros, curly bob)."""
    def draw(rng, put):
        for _ in range(n):
            x, y = rng.uniform(0, W), rng.uniform(0, W)
            r = rng.uniform(3.5, 8.5)
            a0 = rng.uniform(0, 2 * np.pi)
            sweep = rng.uniform(3.5, 7.5) * (1 if rng.random() < 0.5 else -1)
            ts = np.linspace(0, 1, 14)
            rr = r * (1 - 0.35 * ts)
            pts = [(x + rr[i] * np.cos(a0 + sweep * t) + 4 * t, y + rr[i] * np.sin(a0 + sweep * t)) for i, t in enumerate(ts)]
            put(pts, rng.uniform(0.9, 1.5), rng.uniform(0.5, 1.0), rng.uniform(180, 255))
    _strand_sheet(W, seed, draw).save(dst)


def hair_fine(dst, W=512, n=2600, seed=51):
    """fine, long, near-vertical strands (tiles along v): laid over the MakeHuman hair cards so they read as strands."""
    def draw(rng, put):
        for _ in range(n):
            x, y = rng.uniform(0, W), rng.uniform(0, W)
            L = rng.uniform(80, 300)
            dx = rng.normal(0, 3.0)
            pts = [(x + dx * t + 1.5 * np.sin(t * 3 + x), y + L * t) for t in np.linspace(0, 1, 6)]
            put(pts, rng.uniform(0.7, 1.4), rng.uniform(0.35, 1.0), rng.uniform(150, 255))
    _strand_sheet(W, seed, draw).save(dst)


def main():
    ud = sys.argv[1]
    os.makedirs(OUT, exist_ok=True)
    for c in ("brown", "brownlight", "bluegreen", "blue", "green", "grey", "deepblue", "lightblue", "ice"):
        p = os.path.join(ud, "eyes", "materials", f"{c}_eye.png")
        if os.path.exists(p):
            bigger_iris(p, os.path.join(OUT, f"eye_{c}.png"))
            import shutil
            shutil.copy(p, os.path.join(OUT, f"eye_{c}_mh.png"))     # MakeHuman's own texture, untouched (round 20)
    lash_strands(os.path.join(OUT, "lash_strands.png"))
    beard_strands(os.path.join(OUT, "beard_strands.png"))
    scalp_strands(os.path.join(OUT, "scalp_strands.png"))
    beard_clumps(os.path.join(OUT, "beard_clumps.png"))
    curl_strands(os.path.join(OUT, "curl_strands.png"))
    hair_fine(os.path.join(OUT, "hair_fine.png"))
    for n in ("eyelashes01", "eyelashes02", "eyelashes03"):
        clean_lashes(os.path.join(ud, "eyelashes", n, n + ".png"), os.path.join(OUT, f"{n}_clean.png"))
    brow_textures(os.path.join(ud, "eyebrows", "eyebrow001", "eyebrow001.png"), OUT)
    for n in ("eyelashes01", "eyelashes02", "eyelashes03"):
        dense_lashes(os.path.join(ud, "eyelashes", n, n + ".png"), os.path.join(OUT, f"{n}_dense.png"))


if __name__ == "__main__":
    main()
