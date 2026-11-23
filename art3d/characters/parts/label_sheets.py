"""Stamp index labels onto the preview sheets (system python + Pillow):  python3 label_sheets.py [name ...]"""
import json, os, sys, glob
from PIL import Image, ImageDraw, ImageFont
P = os.path.join(os.path.dirname(os.path.abspath(__file__)), "previews")
names = sys.argv[1:] or [os.path.basename(f)[:-5] for f in glob.glob(P + "/*.json")]
try:
    font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 15)
except Exception:
    font = None
for n in names:
    jf = os.path.join(P, n + ".json")
    if not os.path.exists(jf):
        continue
    j = json.load(open(jf))
    if "labels" not in j:
        continue
    pf = os.path.join(P, j["file"])
    im = Image.open(pf).convert("RGB")
    cols = j["cols"]
    rows = (len(j["labels"]) + cols - 1) // cols
    cw, ch = im.size[0] // cols, im.size[1] // rows
    d = ImageDraw.Draw(im)
    for i, t in enumerate(j["labels"]):
        r, c = divmod(i, cols)
        d.rectangle([c * cw + 3, r * ch + 3, c * cw + 3 + 8 * len(t) + 8, r * ch + 22], fill=(20, 30, 35))
        d.text((c * cw + 7, r * ch + 5), t, fill=(240, 240, 235), font=font)
    im.save(pf)
    print("labelled", pf)
