"""Ranges of the face keys at weight 1 on the feminine and masculine neutral (eye width / head width 0.22-0.30, mouth width /
head width 0.38-0.54, ear height / head height 0.17-0.24).  Needs mh/cache/keys.npz (build_mh.py).

    $B -b -P art3d/characters/mh/check_ranges.py
"""
import bpy, os, sys, json
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import mhcore as mc, landmarks as lmk, measure_mh as mm, stylise_mh as st  # noqa: E402

for o in list(bpy.data.objects):
    bpy.data.objects.remove(o, do_unlink=True)
B = mc.Base()
P0 = B.macro({})
lm = lmk.Landmarks(B, P0 - [0, 0, P0[B.body_mask, 2].min()])
Z = np.load(os.path.join(mc.CACHE, "keys.npz"))
basis = Z["_basis"].astype(float)
R = st.load_recipe()
eyes = mc.Proxy(mc.proxy_file("eyes", R["proxies"]["eyes"]))
rows = []
for sexw in (1.0, 0.0):
    for key in ("neutral", "Eye_Big", "Eye_Spacing", "Eye_Round", "Eye_Narrow", "Mouth_Wide", "Mouth_Narrow", "Ears_Back", "Species_Elf", "Species_Orc"):
        P = basis + sexw * (Z["Sex"] - basis)
        if key != "neutral":
            P = P + (Z[key] - basis)
        E = eyes.fit(P)
        try:
            ap = mm.eye_aperture(P, lm, E, eyes.faces, step=0.0005)
            bf, lo, _ = mm.measure(P, lm, E[E[:, 0] > 0], aperture=ap)
        except Exception as ex:
            print("RANGE", key, "not measurable:", ex)
            continue
        rows.append(("F" if sexw else "M", key, lo["eye_w_over_head_w"], lo["gap_over_head_w"], bf["eye_h_over_w"], lo["mouth_w_over_head_w"], bf["ear_h_over_head_h"]))
        print("RANGE", rows[-1])
json.dump(rows, open(os.path.join(HERE, "export", "key_ranges.json"), "w"), indent=0)
