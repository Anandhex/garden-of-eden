"""Pillow side of compare_mh.anthro_overlay (system python3 -I):  anthro_draw.py <draw.json> <sheet.png>
Measured landmark lines solid (red when g > 1), targets from the Farkas ratios dashed green, eye / nose / mouth widths."""
import sys, json
from PIL import Image, ImageDraw

spec = json.load(open(sys.argv[1]))
RES = 800


def dashed(d, p0, p1, fill, width=1, dash=8):
    (x0, y0), (x1, y1) = p0, p1
    L = max(abs(x1 - x0), abs(y1 - y0))
    n = max(int(L // dash), 1)
    for i in range(0, n, 2):
        a, b = i / n, min((i + 1) / n, 1)
        d.line([(x0 + (x1 - x0) * a, y0 + (y1 - y0) * a), (x0 + (x1 - x0) * b, y0 + (y1 - y0) * b)], fill=fill, width=width)


outs = []
for s in spec:
    im = Image.open(s["raw"]).convert("RGB")
    d = ImageDraw.Draw(im)
    px = RES / s["S"]
    Y = lambda z: RES / 2 - (z - s["cz"]) * px
    X = lambda x: RES / 2 + x * px
    bad = {r[0] for r in s["rows"] if r[3] is not None and r[3] > 1}
    for name, z in s["meas"].items():
        col = (255, 200, 60)
        d.line([(RES * 0.15, Y(z)), (RES * 0.85, Y(z))], fill=col, width=2)
        d.text((RES * 0.15, Y(z) + 2), f"{name}", fill=col)
    for name, z in s["tgt"].items():
        dashed(d, (RES * 0.30, Y(z)), (RES * 0.95, Y(z)), (80, 230, 90), 2, 6)
        d.text((RES * 0.72, Y(z) - 12), f"target {name}", fill=(80, 230, 90))
    if s["view"] == "front":
        (ci, co), mc = s["eye"], s["mc"]
        yy = Y(ci[2]) + 14
        for x0, x1, col, lab in ((ci[0], co[0], (60, 220, 255), "eye"), (-ci[0], ci[0], (255, 150, 40), "gap"),
                                 (-s["nosew"] / 2, s["nosew"] / 2, (255, 200, 120), "nose"), (-abs(mc[0]), abs(mc[0]), (255, 60, 220), "mouth")):
            k = ["eye", "gap", "nose", "mouth"].index(lab)
            y = (yy if lab in ("eye", "gap") else Y(mc[2]) + 12 + 7 * k)
            d.line([(X(min(x0, x1)), y), (X(max(x0, x1)), y)], fill=col, width=3)
            d.text((X(max(x0, x1)) + 4, y - 6), lab, fill=col)
    txt = "  ".join(f"{r[0]} {r[1]}/{r[2]}" + ("!" if r[0] in bad else "") for r in s["rows"] if r[1] is not None)
    d.rectangle([0, RES - 34, RES, RES], fill=(0, 0, 0))
    d.text((6, RES - 32), f"{s['sex']} {s['view']}: solid = measured, green dashed = Farkas target (from nasion and menton)", fill=(255, 255, 255))
    d.text((6, RES - 17), txt[:150], fill=(200, 200, 200))
    im.save(s["out"])
    outs.append(s["out"])
ims = [Image.open(p) for p in outs]
sheet = Image.new("RGB", (2 * RES, ((len(ims) + 1) // 2) * RES), (0, 0, 0))
for i, im in enumerate(ims):
    sheet.paste(im, ((i % 2) * RES, (i // 2) * RES))
sheet.save(sys.argv[2])
