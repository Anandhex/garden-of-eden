"""Make the grayscale detail maps (multiplied by the tint colour) from the CC0 ambientCG colour maps in source/ambientcg,
plus a generated stitch-trim map.  Run: python3 -I prep_textures.py   (needs Pillow, numpy)"""
import os, numpy as np
from PIL import Image
H = os.path.dirname(os.path.abspath(__file__))
SRC, OUT = os.path.join(H, "source", "ambientcg"), os.path.join(H, "export", "textures")
os.makedirs(OUT, exist_ok=True)

def detail(name, out, lo, hi, size=512, sat=0.0, tintc=None):
    im = Image.open(os.path.join(SRC, name + "_1K-JPG_Color.jpg")).convert("RGB").resize((size, size), Image.LANCZOS)
    a = np.asarray(im, np.float32) / 255
    l = a @ np.array([0.3, 0.59, 0.11], np.float32)
    l = (l - np.percentile(l, 2)) / max(np.percentile(l, 98) - np.percentile(l, 2), 1e-3)
    l = np.clip(l, 0, 1)
    v = lo + (hi - lo) * l
    rgb = np.stack([v, v, v], -1)
    if tintc is not None:
        rgb = rgb * np.array(tintc, np.float32)
    Image.fromarray((np.clip(rgb, 0, 1) * 255).astype(np.uint8)).save(os.path.join(OUT, out))

detail("Fabric030", "detail_weave.png", 0.80, 1.0)
detail("Fabric048", "detail_quilt.png", 0.62, 1.0)
detail("Fabric026", "detail_cord.png", 0.70, 1.0)
detail("Leather011", "detail_leather.png", 0.55, 1.0)
detail("Metal032", "detail_metal.png", 0.80, 1.0)

# stitch trim map (generated): flat band, two dashed stitch rows, soft edge shading; v across the band, u along it
W, Hh = 128, 128
t = np.ones((Hh, W), np.float32) * 0.96
yy = np.arange(Hh)[:, None] / Hh
for row in (0.14, 0.86):
    m = (np.abs(yy - row) < 0.018) & (((np.arange(W)[None, :] // 8) % 2) == 0)
    t[m] = 0.55
edge = np.minimum(yy, 1 - yy)
t *= 0.82 + 0.18 * np.clip(edge / 0.25, 0, 1)
Image.fromarray((np.stack([t, t, t], -1) * 255).astype(np.uint8)).save(os.path.join(OUT, "trim_stitch.png"))
# two-tone stripe and plaid maps (generated): weave detail times a band pattern; multiplied by the tint colour
wv = np.asarray(Image.open(os.path.join(OUT, "detail_weave.png")).convert("L"), np.float32) / 255
n = wv.shape[0]
t = (np.arange(n) / n)[:, None]
band = np.where((t * 4) % 1.0 < 0.5, 1.0, 0.56)
stripes = wv * band
Image.fromarray((np.repeat(stripes[:, :, None], 3, 2).clip(0, 1) * 255).astype(np.uint8)).save(os.path.join(OUT, "detail_stripes.png"))
u = (np.arange(n) / n)[None, :]
bh = np.where((t * 3) % 1.0 < 0.22, 0.62, 1.0)
bw = np.where((u * 3 + 0.35) % 1.0 < 0.12, 0.7, 1.0)
thin = np.where((t * 6 + 0.1) % 1.0 < 0.06, 0.82, 1.0) * np.where((u * 6 + 0.2) % 1.0 < 0.06, 0.82, 1.0)
plaid = wv * bh * bw * thin
Image.fromarray((np.repeat(plaid[:, :, None], 3, 2).clip(0, 1) * 255).astype(np.uint8)).save(os.path.join(OUT, "detail_plaid.png"))
print("ok")
