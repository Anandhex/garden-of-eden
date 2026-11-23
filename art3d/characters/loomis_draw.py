"""Pillow side of loomis_overlay.py (system python3):  loomis_draw.py <draw.json> <sheet.png>"""
import sys, json
from PIL import Image, ImageDraw

spec = json.load(open(sys.argv[1]))
RES = 800


def dashed(d, p0, p1, fill, width=1, dash=8):
    (x0, y0), (x1, y1) = p0, p1
    L = max(abs(x1 - x0), abs(y1 - y0))
    n = int(L // dash)
    for i in range(0, n, 2):
        a, b = i / n, min((i + 1) / n, 1)
        d.line([(x0 + (x1 - x0) * a, y0 + (y1 - y0) * a), (x0 + (x1 - x0) * b, y0 + (y1 - y0) * b)], fill=fill, width=width)


outs = []
for s in spec:
    im = Image.open(s["raw"]).convert("RGB")
    d = ImageDraw.Draw(im)
    g, S, cz = s["geo"], s["S"], s["cz"]
    hh, top = g["hh"], g["top"]
    px = RES / S
    Y = lambda z: RES / 2 - (z - cz) * px                       # world z -> image row
    side = s["view"] == "side"
    X = (lambda y: RES / 2 + (y - s["cy"]) * px) if side else (lambda x: RES / 2 + x * px)
    zf = lambda f: top - f * hh                                  # fraction -> world z
    gmap = {r[1]: r[6] for r in s["rows"]}
    # classic lines (dashed white)
    for name, f in (("hairline", s["classic"]["hairline"]), ("brow", s["classic"]["brow"]), ("eye", s["classic"]["eye"]),
                    ("nose base", s["classic"]["nose_base"]), ("mouth", s["classic"]["mouth"])):
        y = Y(zf(f))
        dashed(d, (0, y), (RES, y), (235, 235, 235), 1)
        d.text((4, y - 11), f"Loomis {name} {f:.3f}", fill=(235, 235, 235))
    # target lines (dashed green)
    for name, f in s["target"].items():
        if name.startswith("ear"):
            continue
        y = Y(zf(f))
        dashed(d, (RES * 0.35, y), (RES, y), (80, 230, 90), 2, 6)
        d.text((RES - 150, y + 1), f"target {name} {f:.3f}", fill=(80, 230, 90))
    # measured lines (solid)
    lo = s["loomis"]
    meas = [("crown", 0.0, (255, 230, 60), None), ("chin", 1.0, (255, 230, 60), None), ("brow", lo["brow_line"], (255, 150, 40), "brow_line"),
            ("eye", lo["eye_line"], (60, 220, 255), "eye_line"), ("nose base", lo["nose_base"], (255, 150, 40), "nose_base"),
            ("mouth", lo["mouth_line"], (255, 60, 220), "mouth_line")]
    if "lip_top" in lo:
        meas += [("lip top", lo["lip_top"], (255, 120, 230), "lip_top"), ("lip bottom", lo["lip_bottom"], (255, 120, 230), "lip_bottom")]
    for name, f, col, key in meas:
        gg = gmap.get(key)
        c = (255, 40, 40) if (gg is not None and gg > 1) else col
        y = Y(zf(f))
        d.line([(RES * 0.12, y), (RES * 0.88, y)], fill=c, width=1 if name.startswith("lip") else 2)
        d.text((RES * 0.12, y + 2), f"{name} {f:.3f}" + ("" if gg is None else f"  g={gg}"), fill=c)
    # cranium ball: diameter 0.857 hh, top at the crown
    R = 0.857 * hh / 2
    bcz = top - R
    if not side:
        bx0, bx1 = X(-R), X(R)
        d.ellipse([bx0, Y(bcz + R), bx1, Y(bcz - R)], outline=(200, 200, 255), width=1)
        for sx in (-1, 1):
            xc = X(sx * 0.745 * R)
            dashed(d, (xc, Y(bcz + 0.66 * R)), (xc, Y(bcz - 0.66 * R)), (200, 200, 255), 1, 5)
        d.line([(X(0), Y(top)), (X(0), Y(g["chin"]))], fill=(200, 200, 255), width=1)
        # five eyes ruler under the chin
        yr = Y(g["chin"]) + 18
        w = g["width"]
        for i in range(6):
            xx = X(-w / 2 + i * w / 5)
            d.line([(xx, yr - 5), (xx, yr + 5)], fill=(235, 235, 235))
        d.line([(X(-w / 2), yr), (X(w / 2), yr)], fill=(235, 235, 235))
        ci, co, mc = g["eye_ci"], g["eye_co"], g["mc"]
        for x0, x1, col, lab in ((ci[0], co[0], (60, 220, 255), "eye"), (-ci[0], ci[0], (255, 150, 40), "gap"),
                                 (-g["nosew"] / 2, g["nosew"] / 2, (255, 200, 120), "nose"), (-abs(mc[0]), abs(mc[0]), (255, 60, 220), "mouth")):
            yy = yr + 10 + 9 * ["eye", "gap", "nose", "mouth"].index(lab)
            d.line([(X(min(x0, x1)), yy), (X(max(x0, x1)), yy)], fill=col, width=3)
            d.text((X(max(x0, x1)) + 4, yy - 6), lab, fill=col)
    else:
        bcy = g["yback"] - R                                       # ball tangent to the back of the skull
        d.ellipse([X(bcy - R), Y(bcz + R), X(bcy + R), Y(bcz - R)], outline=(200, 200, 255), width=1)
        r2 = R * 2 / 3
        d.ellipse([X(bcy - r2), Y(bcz + r2), X(bcy + r2), Y(bcz - r2)], outline=(170, 170, 255), width=1)
        d.line([(X(bcy), Y(top)), (X(bcy), Y(g["chin"]))], fill=(200, 200, 255), width=1)
        # ear box and target band
        tb = s["target"]
        y0, y1 = Y(zf(tb.get("ear_top", 0.46))), Y(zf(tb.get("ear_bottom", 0.66)))
        band = Image.new("RGBA", im.size, (0, 0, 0, 0))
        ImageDraw.Draw(band).rectangle([X(g["earf"]) - 6, y0, X(g["earbk"]) + 6, y1], fill=(80, 230, 90, 50))
        im = Image.alpha_composite(im.convert("RGBA"), band).convert("RGB")
        d = ImageDraw.Draw(im)
        gg = max([v for k, v in gmap.items() if k in ("ear_top", "ear_bottom", "ear_h") and v is not None] or [0])
        c = (255, 40, 40) if gg > 1 else (80, 230, 90)
        d.rectangle([X(g["earf"]), Y(g["eart"]), X(g["earbk"]), Y(g["earb"])], outline=c, width=2)
        import math
        ec = g["earc"]
        t = math.radians(g["tilt"])
        L = (g["eart"] - g["earb"]) * 0.6
        d.line([(X(ec[1] - math.sin(t) * L), Y(ec[2] - math.cos(t) * L)), (X(ec[1] + math.sin(t) * L), Y(ec[2] + math.cos(t) * L))], fill=c, width=1)
        d.text((X(g["earbk"]) + 4, Y(g["eart"])), f"ear {lo['ear_top']:.2f}-{lo['ear_bottom']:.2f} tilt {g['tilt']:.0f}", fill=c)
    d.rectangle([0, RES - 18, RES, RES], fill=(0, 0, 0))
    d.text((6, RES - 15), f"{s['sex'].upper()} {s['view']}   white dashed = classic Loomis, green dashed = target, solid = measured (red: g > 1)", fill=(255, 255, 255))
    im.save(s["out"])
    outs.append(s["out"])
ims = [Image.open(p) for p in outs]
cols = 2
rows = (len(ims) + 1) // 2
sheet = Image.new("RGB", (cols * RES, rows * RES), (0, 0, 0))
for i, im in enumerate(ims):
    sheet.paste(im, ((i % cols) * RES, (i // cols) * RES))
sheet.save(sys.argv[2])
