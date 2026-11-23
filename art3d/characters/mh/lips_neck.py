"""Lips-and-neck proof sheet (user feedback 2026-11-21): MakeHuman's plain neutral (macros only) next to ours, for F and M:
mouth front / 3/4 / side close-ups, a neck side view, a 3/4 at game-camera distance, and the throat angle
(cervicomental angle: chin point - cervical point - neck base, in the midline profile).

    $B -b -P art3d/characters/mh/lips_neck.py -- out=<png> [tag=...]
"""
import bpy, os, sys, json, math, subprocess
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.dirname(HERE))
import mhcore as mc, landmarks as lmk, stylise_mh as st, compare_mh as cm  # noqa: E402
import lookdev as ld  # noqa: E402


def throat_angle(P, lm):
    b = lm.body
    mid = P[b][np.abs(P[b, 0]) < 1e-4]
    chin = P[lm.chin]
    clav = lm.joint(P, "joint-l-clavicle")
    band = mid[np.abs(mid[:, 2] - clav[2]) < 0.012]
    notch = band[np.argmin(band[:, 1])]
    seg = mid[(mid[:, 2] < chin[2] - 0.003) & (mid[:, 2] > notch[2] + 0.003) & (mid[:, 1] < chin[1] + 0.09)]
    # front profile only: per 2 mm height bin, the most forward vertex
    zb = np.round(seg[:, 2] / 0.002)
    prof = np.array([seg[zb == z][np.argmin(seg[zb == z][:, 1])] for z in np.unique(zb)])
    a, c = chin[1:], notch[1:]
    t = c - a
    n = np.array([t[1], -t[0]]) / np.linalg.norm(t)          # perpendicular in the (y, z) plane
    dist = (prof[:, 1:] - a) @ n
    C = prof[np.argmax(np.abs(dist))]
    v1, v2 = chin[1:] - C[1:], notch[1:] - C[1:]
    ang = math.degrees(math.acos(np.clip(v1 @ v2 / np.linalg.norm(v1) / np.linalg.norm(v2), -1, 1)))
    return ang, chin, C, notch


def main():
    a = dict(x.split("=", 1) for x in (sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []))
    out = a.get("out", "/tmp/lips_neck.png")
    tmp = os.path.join(os.path.dirname(out), "_ln_tmp")
    os.makedirs(tmp, exist_ok=True)
    R = st.load_recipe()
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    B = mc.Base()
    P0 = B.macro({})
    lm = lmk.Landmarks(B, P0 - [0, 0, P0[B.body_mask, 2].min()])
    B.h.hide_render = B.h.hide_viewport = True
    sc, cam = ld.setup(res=(480, 480), centre=(0, 0, 1.0))
    cells, labels, angles = [], [], {}
    for sex in ("F", "M"):
        for variant in ("mh", "ours"):
            if variant == "mh":
                P = B.macro(R[sex]["macro"])
                P = P - [0, 0, P[lm.body, 2].min()]
            else:
                P = st.final(B, lm, R, sex)
            ang, chin, C, notch = throat_angle(P, lm)
            angles[f"{sex}_{variant}"] = round(ang, 1)
            person_ = cm.build_person(B, lm, R, sex, P, hair=True)
            cm.clear_pose(person_["rig"])
            mouth = P[lm.lipContact]
            shots = [("mouth front", (0, mouth[1], mouth[2]), 0, 0.42, 85, 0),
                     ("mouth 3/4", (0, mouth[1], mouth[2]), 38, 0.42, 85, 0),
                     ("mouth side", (0, mouth[1] + 0.03, mouth[2] - 0.01), 90, 0.50, 85, 0),
                     ("neck side", (0, mouth[1] + 0.06, mouth[2] - 0.07), 90, 0.95, 85, 0),
                     ("neck 3/4", (0, mouth[1] + 0.05, mouth[2] - 0.06), 35, 0.95, 85, 0),
                     ("game camera 3/4", (0, 0, P[lm.body, 2].max() * 0.80), 30, 3.2, 50, 8)]
            for name, tgt, az, dist, lens, el in shots:
                ld.aim(cam, tgt, az, dist, elev_deg=el, lens=lens)
                p = os.path.join(tmp, f"{sex}_{variant}_{len(cells):02d}.png")
                ld.render(p)
                cells.append(p)
                labels.append(f"{sex} {'MakeHuman plain' if variant == 'mh' else 'ours'}: {name}" + (f"  throat {ang:.0f} deg" if name == 'neck side' else ""))
            from person import clear_people
            clear_people()
    subprocess.run(["python3", "-I", os.path.join(HERE, "sheet_img.py"), "grid", out, "6", json.dumps(labels), *cells], check=True)
    print("THROAT", json.dumps(angles))
    B.save_cache()


if __name__ == "__main__":
    main()
