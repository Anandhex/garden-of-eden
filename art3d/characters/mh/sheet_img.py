"""Pillow side of sheets_mh.py (system python3 -I):
  grid <out> <cols> <labels-json> <img>...
  neutral <out> <ref_crop> <ref_face> <fF> <qF> <sF> <fM> <qM> <sM> <bodyF front> <bodyF side> <bodyM front> <bodyM side>
"""
import sys, json
from PIL import Image, ImageDraw

BG = (14, 26, 31)


def label(im, text, xy=(6, 6)):
    d = ImageDraw.Draw(im)
    w = 7 * len(text) + 12
    d.rectangle([xy[0], xy[1], xy[0] + w, xy[1] + 18], fill=(0, 0, 0))
    d.text((xy[0] + 6, xy[1] + 3), text, fill=(255, 255, 255))


def fit(im, h):
    return im.resize((int(im.width * h / im.height), h), Image.LANCZOS)


if sys.argv[1] == "grid":
    out, cols, labels, paths = sys.argv[2], int(sys.argv[3]), json.loads(sys.argv[4]), sys.argv[5:]
    ims = [Image.open(p).convert("RGB") for p in paths]
    w, h = ims[0].size
    rows = (len(ims) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * w, rows * h), BG)
    for i, im in enumerate(ims):
        x, y = (i % cols) * w, (i // cols) * h
        sheet.paste(im, (x, y))
        label(sheet, labels[i], (x + 6, y + 6))
    sheet.save(out)
else:
    out = sys.argv[2]
    p = sys.argv[3:]
    H = 520
    top = [fit(Image.open(x).convert("RGB"), H) for x in p[0:5]]
    mid = [fit(Image.open(x).convert("RGB"), H) for x in p[5:8]]
    bot = [fit(Image.open(x).convert("RGB"), 760) for x in p[8:12]]
    rows = [(top, ["reference (crop, not ours)", "F, reference-like 3/4", "F front", "F 3/4", "F side"]),
            (mid, ["M front", "M 3/4", "M side"]), (bot, ["F front", "F side", "M front", "M side"])]
    W = max(sum(i.width for i in r) for r, _ in rows)
    Ht = sum(r[0].height for r, _ in rows)
    sheet = Image.new("RGB", (W, Ht), BG)
    y = 0
    for r, labs in rows:
        x = 0
        for im, lb in zip(r, labs):
            sheet.paste(im, (x, y))
            label(sheet, lb, (x + 6, y + 6))
            x += im.width
        y += r[0].height
    sheet.save(out)
