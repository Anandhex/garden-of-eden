"""30 noses and 30 ear pairs, made from the default Part_Nose / Part_Ear_L / Part_Ear_R by displacing the interior only."""
import numpy as np
from lib import *

# ---------------------------------------------------------------- noses
# params: sx sy sz (scale about centre; sy = projection from the face), tip_up/tip_down (m), tip (tip bulb scale), bump (bridge hump, m),
# hook (tip drop + bridge), crook (x shear at the bridge, m), flare (nostril wings, m), pinch (narrow the tip), dip (bridge dip)
NOSES = [
    ("average", [], {}),
    ("button", ["child", "feminine", "halfling"], dict(sx=0.86, sy=0.86, sz=0.82, tip_up=0.003, tip=1.12)),
    ("hooked", ["elder", "witch", "rogue"], dict(hook=0.010, bump=0.004, sz=1.12, sx=0.92)),
    ("broad", ["common", "worker"], dict(sx=1.30, flare=0.004)),
    ("narrow", ["noble", "feminine"], dict(sx=0.78, sz=1.05)),
    ("upturned", ["feminine", "child"], dict(tip_up=0.007, sz=0.92)),
    ("roman", ["noble", "masculine"], dict(bump=0.007, sz=1.10, sy=1.06)),
    ("flat", ["common", "brawler"], dict(sy=0.68, sx=1.08)),
    ("long", ["elder", "noble"], dict(sz=1.26, sx=0.95)),
    ("crooked", ["fighter", "rustic"], dict(crook=0.008, sx=1.0)),
    ("snub", ["child", "common"], dict(sz=0.80, tip_up=0.005, sy=0.9)),
    ("aquiline", ["noble", "masculine"], dict(bump=0.005, sy=1.12, sx=0.90, sz=1.1)),
    ("bulbous", ["drinker", "rustic"], dict(tip=1.45, sx=1.1)),
    ("wide_bridge", ["common"], dict(bridge_w=1.3, sy=0.9)),
    ("pointed_tip", ["feminine", "sly"], dict(pinch=0.45, sy=1.06, sx=0.88)),
    ("pug", ["child", "feminine"], dict(sy=0.80, sz=0.78, tip_up=0.005)),
    ("big_straight", ["masculine", "heavy"], dict(sx=1.10, sy=1.22, sz=1.16)),
    ("small_straight", ["feminine", "child"], dict(sx=0.86, sy=0.86, sz=0.86)),
    ("drooping", ["elder", "weary"], dict(tip_down=0.008, sz=1.12, sx=1.0)),
    ("broken", ["fighter", "rogue"], dict(crook=0.006, dip=0.003, sx=1.12)),
    ("nubby", ["child"], dict(sx=0.80, sy=0.80, sz=0.76, tip_up=0.004)),
    ("high_bridge", ["noble"], dict(bump=0.004, sy=1.16, sx=0.9)),
    ("wide_nostrils", ["common", "worker"], dict(flare=0.012, sx=1.12)),
    ("thin_pinched", ["stern", "elder"], dict(sx=0.72, flare=-0.003, sz=1.06)),
    ("elf_fine", ["elf"], dict(sx=0.80, sy=1.05, sz=1.05, tip_up=0.002, pinch=0.25)),
    ("elf_long", ["elf"], dict(sx=0.75, sz=1.22, sy=1.10, pinch=0.4)),
    ("dwarf_bulb", ["dwarf"], dict(sx=1.32, sy=1.26, sz=1.30, tip=1.35, tip_down=0.003)),
    ("dwarf_broad", ["dwarf"], dict(sx=1.45, sy=1.10, sz=1.12, flare=0.010)),
    ("orc_flat", ["orc"], dict(sx=1.45, sy=0.68, sz=0.92, flare=0.010)),
    ("orc_snout", ["orc"], dict(sx=1.35, sy=0.80, sz=0.80, tip_up=0.010, flare=0.012)),
]


def bell(t, c, w):
    return np.exp(-((t - c) / w) ** 2)


def nose_fn(prm):
    def fn(P, w):
        c = np.array([0.0, P[:, 1].mean(), P[:, 2].mean()])
        zmin, zmax = P[:, 2].min(), P[:, 2].max()
        ymin, ymax = P[:, 1].min(), P[:, 1].max()
        t = (P[:, 2] - zmin) / (zmax - zmin)                 # 0 bottom (tip) .. 1 bridge top
        f = (ymax - P[:, 1]) / (ymax - ymin)                 # 0 against the face .. 1 most forward
        D = np.zeros_like(P)
        sx, sy, sz = prm.get("sx", 1.0), prm.get("sy", 1.0), prm.get("sz", 1.0)
        D[:, 0] += (sx - 1) * P[:, 0]
        D[:, 1] += (sy - 1) * (P[:, 1] - ymax)
        D[:, 2] += (sz - 1) * (P[:, 2] - c[2])
        if "bridge_w" in prm:
            D[:, 0] += (prm["bridge_w"] - 1) * P[:, 0] * S(0.3, 0.9, t)
        if "tip" in prm:
            k = prm["tip"] - 1
            tipw = S(0.45, 1.0, f) * S(0.55, 0.05, t)
            D[:, 0] += k * P[:, 0] * tipw
            D[:, 1] -= k * 0.5 * (ymax - P[:, 1]) * tipw
            D[:, 2] += k * (P[:, 2] - zmin - 0.008) * 0.5 * tipw
        if "pinch" in prm:
            tipw = S(0.4, 1.0, f) * S(0.6, 0.1, t)
            D[:, 0] -= prm["pinch"] * P[:, 0] * tipw * 0.6
            D[:, 1] -= prm["pinch"] * 0.006 * tipw
        if "tip_up" in prm:
            D[:, 2] += prm["tip_up"] * S(0.5, 1.0, f) * S(0.7, 0.0, t) * 1.4
        if "tip_down" in prm:
            D[:, 2] -= prm["tip_down"] * S(0.5, 1.0, f) * S(0.7, 0.0, t) * 1.4
        if "bump" in prm:
            D[:, 1] -= prm["bump"] * bell(t, 0.62, 0.16) * (0.4 + 0.6 * f)
        if "dip" in prm:
            D[:, 1] += prm["dip"] * bell(t, 0.6, 0.12)
        if "hook" in prm:
            h = prm["hook"]
            D[:, 1] -= h * 0.5 * bell(t, 0.62, 0.16) * (0.4 + 0.6 * f)
            D[:, 2] -= h * S(0.5, 1.0, f) * S(0.7, 0.0, t) * 1.2
            D[:, 1] += h * 0.5 * S(0.5, 1.0, f) * S(0.5, 0.0, t)
        if "crook" in prm:
            D[:, 0] += prm["crook"] * S(0.0, 1.0, t) * (0.3 + 0.7 * f)
        if "flare" in prm:
            D[:, 0] += prm["flare"] * np.sign(P[:, 0]) * S(0.45, 0.0, t) * (1 - f) * 1.3
        return D
    return fn


# ---------------------------------------------------------------- ears
# params: s (uniform), sy (depth), sz (height), protrude (m outward at the rim), lobe (m: lengthen the lobe), tip_up (raise the top),
# point (taper the top towards a point), back (swept back, m at the top), notch=(y,z,r,depth) normalised notch at the rim,
# bumps (cauliflower), flatten, lean (tilt of the top)
EARS = [
    ("average", [], {}),
    ("small", ["child", "common"], dict(s=0.82, protrude=0.002)),
    ("large", ["common", "elder"], dict(s=1.22, protrude=0.003)),
    ("big_lobes", ["elder", "common"], dict(lobe=0.014, s=1.05)),
    ("attached", ["common", "gentle"], dict(lobe=-0.004, protrude=-0.002)),
    ("protruding", ["child", "rustic"], dict(protrude=0.014, s=1.05)),
    ("flat_back", ["noble", "feminine"], dict(protrude=-0.005, s=0.95)),
    ("round_big", ["child", "gentle"], dict(sy=1.18, sz=1.10, s=1.08, protrude=0.004)),
    ("tall_narrow", ["noble", "elder"], dict(sz=1.22, sy=0.84)),
    ("pointed_small", ["halfling", "fey"], dict(point=0.55, tip_up=0.012)),
    ("elf_short", ["elf"], dict(tip_up=0.040, point=0.5, back=0.010, protrude=0.003)),
    ("elf_long_swept", ["elf", "noble"], dict(tip_up=0.075, point=0.7, back=0.026, protrude=0.006)),
    ("elf_leaf", ["elf", "fey"], dict(tip_up=0.030, point=0.35, protrude=0.004, sy=1.05)),
    ("elf_drooping", ["elf", "elder"], dict(tip_up=0.050, point=0.6, back=0.030, lean=-0.012)),
    ("half_elf", ["elf", "common"], dict(tip_up=0.018, point=0.3, back=0.004)),
    ("orc_large_pointed", ["orc"], dict(s=1.15, point=0.5, tip_up=0.028, protrude=0.008)),
    ("orc_notched", ["orc", "fighter"], dict(s=1.12, point=0.4, tip_up=0.020, protrude=0.006, notch=(0.0, 0.55, 0.26, 0.009))),
    ("orc_torn", ["orc", "fighter"], dict(s=1.10, point=0.3, tip_up=0.015, notch=(-0.1, 0.8, 0.34, 0.012), bumps=0.0015)),
    ("notched_top", ["fighter", "rogue"], dict(notch=(0.0, 0.95, 0.26, 0.009))),
    ("notched_lobe", ["fighter", "rogue"], dict(notch=(0.0, -0.8, 0.26, 0.008), lobe=0.004)),
    ("cauliflower", ["fighter", "brawler"], dict(bumps=0.0032, s=1.04, protrude=0.004)),
    ("stub_child", ["child"], dict(s=0.78, protrude=0.006)),
    ("elder_long_lobe", ["elder"], dict(lobe=0.022, s=1.06, sz=1.06)),
    ("pinned_back", ["noble", "feminine"], dict(protrude=-0.007, s=0.9)),
    ("dwarf_thick", ["dwarf"], dict(sy=1.10, sz=0.96, protrude=0.005, s=1.05)),
    ("halfling_pointy", ["halfling"], dict(tip_up=0.010, point=0.45, protrude=0.003, s=0.95)),
    ("bat_ear", ["goblin", "fey"], dict(sz=1.25, protrude=0.011, tip_up=0.026, point=0.4)),
    ("cupped", ["gentle", "child"], dict(protrude=0.007, back=-0.006, s=1.05)),
    ("elf_swept_back", ["elf", "feminine"], dict(tip_up=0.045, point=0.6, back=0.040, protrude=0.002)),
    ("elf_scarred", ["elf", "fighter"], dict(tip_up=0.050, point=0.6, back=0.012, notch=(0.0, 0.75, 0.28, 0.008))),
]


def ear_fn(prm, sx):
    def fn(P, w):
        cy, cz = P[:, 1].mean(), P[:, 2].mean()
        xmin, xmax = (P[:, 0].min(), P[:, 0].max()) if sx > 0 else (P[:, 0].max(), P[:, 0].min())
        zmin, zmax = P[:, 2].min(), P[:, 2].max()
        ymin, ymax = P[:, 1].min(), P[:, 1].max()
        o = (P[:, 0] - xmin) / (xmax - xmin)             # 0 against the head .. 1 outer rim
        o = np.clip(o, 0, 1)
        t = (P[:, 2] - cz) / ((zmax - zmin) / 2)         # -1 lobe .. +1 top
        D = np.zeros_like(P)
        s = prm.get("s", 1.0)
        sy, sz = prm.get("sy", 1.0) * s, prm.get("sz", 1.0) * s
        D[:, 1] += (sy - 1) * (P[:, 1] - cy) * 1.0
        D[:, 2] += (sz - 1) * (P[:, 2] - cz) * 1.0
        D[:, 0] += sx * (s - 1) * abs(P[:, 0] - xmin) * 0.6
        if "protrude" in prm:
            D[:, 0] += sx * prm["protrude"] * S(0.0, 1.0, o) ** 0.8
        top = S(0.2, 1.0, t)
        low = S(-0.1, -1.0, t)
        if "tip_up" in prm:
            D[:, 2] += prm["tip_up"] * top ** 1.5
        if "point" in prm:
            pm = prm["point"]
            D[:, 1] -= (P[:, 1] - cy) * pm * top ** 1.3
            D[:, 0] -= sx * 0.004 * pm * top
        if "back" in prm:
            D[:, 1] += prm["back"] * top ** 1.4
        if "lean" in prm:
            D[:, 0] += sx * prm["lean"] * top
        if "lobe" in prm:
            D[:, 2] -= prm["lobe"] * low ** 1.2
        if "notch" in prm:
            ny, nz, nr, nd = prm["notch"]
            ty = cy + ny * (ymax - ymin) / 2
            tz = cz + nz * (zmax - zmin) / 2
            # notch at the rim on the outer side: vertices near that point are pulled in and slightly cut inward
            d = np.hypot((P[:, 1] - ty) / ((ymax - ymin) / 2), (P[:, 2] - tz) / ((zmax - zmin) / 2))
            k = np.clip(1 - d / nr, 0, 1) ** 1.3 * S(0.35, 1.0, o)
            D[:, 0] -= sx * nd * 2.8 * k
            D[:, 2] -= np.sign(nz) * nd * 0.8 * k * 0 + (-nd * 0.3 * k * np.sign(nz))
        if "bumps" in prm:
            n = np.sin(P[:, 1] * 530 + P[:, 2] * 310) * np.sin(P[:, 2] * 470 - P[:, 1] * 260)
            D[:, 0] += sx * prm["bumps"] * n * S(0.2, 1.0, o)
        return D
    return fn


def build():
    out = {"noses": [], "ears": []}
    b = bpy.data.objects
    nose0, earL, earR = b["Part_Nose"], b["Part_Ear_L"], b["Part_Ear_R"]
    for i, (nm, tags, prm) in enumerate(NOSES):
        name = f"Nose_{i+1:02d}_{nm}"
        ob = variant(nose0, name, nose_fn(prm) if prm else None, ramp=(0.002, 0.018))
        ob["gd_category"] = "nose"
        out["noses"].append((name, nm, tags))
    for i, (nm, tags, prm) in enumerate(EARS):
        names = []
        for sd, base, sx in (("L", earL, 1), ("R", earR, -1)):
            name = f"Ear_{i+1:02d}_{nm}_{sd}"
            ob = variant(base, name, ear_fn(prm, sx) if prm else None, ramp=(0.002, 0.014))
            ob["gd_category"] = "ear"
            names.append(name)
        out["ears"].append((names, nm, tags))
    return out
