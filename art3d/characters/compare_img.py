"""Pillow helpers for compare.py (system python3):  compose <out> <h> <labels-json> <img>...  |  crop <in> <out> x0,y0,x1,y1 w,h"""
import sys, json
from PIL import Image, ImageDraw

if sys.argv[1] == "overlay":
    # overlay <ref_crop> <ours> <out> <ref_eyes_json> <our_eyes_json>: similarity transform mapping our two eye centres onto the reference's
    import math
    ref = Image.open(sys.argv[2]).convert("RGB")
    ours = Image.open(sys.argv[3]).convert("RGB")
    (ra, rb), (oa, ob) = json.loads(sys.argv[5]), json.loads(sys.argv[6])
    vr = (rb[0] - ra[0], rb[1] - ra[1])
    vo = (ob[0] - oa[0], ob[1] - oa[1])
    s = math.hypot(*vr) / max(math.hypot(*vo), 1e-6)
    ang = math.atan2(vr[1], vr[0]) - math.atan2(vo[1], vo[0])
    c, sn = math.cos(ang) * s, math.sin(ang) * s
    # inverse map for Image.transform: ours = A^-1 (ref - ra) + oa
    det = c * c + sn * sn
    ic, isn = c / det, -sn / det
    a, b = ic, -isn
    d, e = isn, ic
    cx = oa[0] - (a * ra[0] + b * ra[1])
    cy = oa[1] - (d * ra[0] + e * ra[1])
    warped = ours.transform(ref.size, Image.AFFINE, (a, b, cx, d, e, cy), resample=Image.BILINEAR)
    Image.blend(ref, warped, 0.5).save(sys.argv[4])
    if len(sys.argv) > 7:
        # feature crops: reference row over ours (same frame after the eye alignment)
        boxes = json.loads(sys.argv[7])
        H = 260
        cells = []
        for name, bx in boxes:
            r_ = ref.crop(tuple(bx))
            o_ = warped.crop(tuple(bx))
            w = int(r_.width * H / r_.height)
            cells.append((name, r_.resize((w, H), Image.LANCZOS), o_.resize((w, H), Image.LANCZOS)))
        W = sum(c[1].width for c in cells)
        sheet = Image.new("RGB", (W, 2 * H + 20), (16, 32, 38))
        dr = ImageDraw.Draw(sheet)
        x = 0
        for name, r_, o_ in cells:
            sheet.paste(r_, (x, 0))
            sheet.paste(o_, (x, H + 20))
            dr.text((x + 4, H + 4), name + ": reference (top) / ours (bottom)", fill=(255, 255, 255))
            x += r_.width
        sheet.save(sys.argv[4].replace("_overlay_face", "_features"))
elif sys.argv[1] == "crop":
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
