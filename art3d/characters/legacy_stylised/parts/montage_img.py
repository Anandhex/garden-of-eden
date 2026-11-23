"""Pillow montage for render_people.py (system python3):  montage_img.py <out> <cols> <labels-json> <img>..."""
import sys, json
from PIL import Image, ImageDraw
out, cols, labels, paths = sys.argv[1], int(sys.argv[2]), json.loads(sys.argv[3]), sys.argv[4:]
ims = [Image.open(p).convert("RGB") for p in paths]
w, h = ims[0].size
rows = (len(ims) + cols - 1) // cols
canvas = Image.new("RGB", (cols * w, rows * h), (16, 32, 38))
d = ImageDraw.Draw(canvas)
for i, im in enumerate(ims):
    x, y = (i % cols) * w, (i // cols) * h
    canvas.paste(im.resize((w, h)), (x, y))
    if i < len(labels):
        d.rectangle([x, y, x + 7 * len(labels[i]) + 10, y + 18], fill=(0, 0, 0))
        d.text((x + 5, y + 3), labels[i], fill=(255, 255, 255))
canvas.save(out)
