"""Paint every decal / texture of the decal categories to export/textures/<cat>/*.png   (run in Blender or plain python+numpy).
    Blender -b -P parts/build_decals.py
"""
import os, sys, json
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import numpy as np
import decals, specs

TEX = os.path.join(HERE, "export", "textures")


def save(arr, path):
    try:
        from lib import save_png
        save_png(arr, path)
    except Exception:
        raise


def build(write=True):
    cache = {}
    for c in ("brows", "lids", "eyes", "mouths", "mouths_inner", "stubble"):
        os.makedirs(os.path.join(TEX, c), exist_ok=True)
    for i, b in enumerate(specs.BROWS):
        cache[f"brow_{i+1:02d}"] = decals.brow(dict(b["p"], seed=i + 1))
    for k, v in specs.LIDS.items():
        cache[f"lid_{k}"] = decals.lids({kk: vv for kk, vv in v.items() if kk not in ("lash", "lash_len")})   # lashes are 3D cards now
    for i, e in enumerate(specs.EYES):
        cache[f"eye_{i+1:02d}"] = decals.iris(e["iris"])
    for i, m in enumerate(specs.MOUTHS):
        cache[f"mouth_{i+1:02d}"] = decals.lips(m["lips"])
        if m["inner"]:
            cache[f"mouthin_{i+1:02d}"] = decals.inner_mouth(m["inner"])
    for i, s in enumerate(specs.STUBBLE):
        cache[f"stubble_{i+1:02d}"] = decals.stubble(s["p"])
    if write:
        for k, a in cache.items():
            sub = {"brow": "brows", "lid": "lids", "eye": "eyes", "mouth": "mouths", "mouthin": "mouths_inner", "stubble": "stubble"}[k.split("_")[0]]
            save(a, os.path.join(TEX, sub, k + ".png"))
    return cache


if __name__ == "__main__":
    import time
    t = time.time()
    c = build()
    print("decals", len(c), round(time.time() - t, 1), "s")
