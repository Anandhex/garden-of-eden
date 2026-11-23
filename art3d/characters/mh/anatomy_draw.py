"""Pillow side of proofs_f.anatomy (system python3 -I): anatomy_draw.py <spec.json>"""
import sys, json
from PIL import Image, ImageDraw

spec = json.load(open(sys.argv[1]))
for item in spec["images"]:
    im = Image.open(item["src"]).convert("RGB")
    d = ImageDraw.Draw(im)
    for ln in item.get("lines", []):
        (x0, y0), (x1, y1) = ln["a"], ln["b"]
        d.line([(x0, y0), (x1, y1)], fill=tuple(ln.get("col", (255, 220, 60))), width=ln.get("w", 2))
        if ln.get("label"):
            d.text((x1 + 4, y1 - 6), ln["label"], fill=tuple(ln.get("col", (255, 220, 60))))
    for c in item.get("circles", []):
        x, y, r = c["c"][0], c["c"][1], c["r"]
        d.ellipse([x - r, y - r, x + r, y + r], outline=tuple(c.get("col", (60, 220, 255))), width=2)
    y = im.height - 18 * len(item.get("text", [])) - 4
    if item.get("text"):
        d.rectangle([0, y - 4, im.width, im.height], fill=(0, 0, 0))
    for t in item.get("text", []):
        d.text((6, y), t, fill=(255, 255, 255))
        y += 18
    im.save(item["out"])
