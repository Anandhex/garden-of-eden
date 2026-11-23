"""Pillow helpers for compare.py (system python3):  compose <out> <h> <labels-json> <img>...  |  crop <in> <out> x0,y0,x1,y1 w,h"""
import sys, json
from PIL import Image, ImageDraw

if sys.argv[1] == "crop":
    box = tuple(int(v) for v in sys.argv[4].split(","))
    size = tuple(int(v) for v in sys.argv[5].split(","))
    Image.open(sys.argv[2]).convert("RGB").crop(box).resize(size, Image.LANCZOS).save(sys.argv[3])
else:
    out, h, labels, paths = sys.argv[2], int(sys.argv[3]), json.loads(sys.argv[4]), sys.argv[5:]
    ims = [Image.open(p).convert("RGB") for p in paths]
    ims = [im.resize((int(im.width * h / im.height), h), Image.LANCZOS) for im in ims]
    canvas = Image.new("RGB", (sum(im.width for im in ims), h), (20, 20, 20))
    d = ImageDraw.Draw(canvas)
    x = 0
    for i, im in enumerate(ims):
        canvas.paste(im, (x, 0))
        if i < len(labels):
            d.rectangle([x, 0, x + 7 * len(labels[i]) + 12, 20], fill=(0, 0, 0))
            d.text((x + 6, 4), labels[i], fill=(255, 255, 255))
        x += im.width
    canvas.save(out)
