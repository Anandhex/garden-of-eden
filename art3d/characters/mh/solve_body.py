"""Least-squares solve of the body-width targets (shoulders, waist, hips, neck in head heights) for the F and M neutrals
by the MakeHuman measure targets (torso/measure-*-dist|circ, neck/measure-neck-circ); writes the weights into recipe.json.

    source mh/mpfb_env.sh; $B -b -P art3d/characters/mh/solve_body.py
"""
import bpy, os, sys, json
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import mhcore as mc, landmarks as lmk, measure_mh as mm, stylise_mh as st  # noqa: E402

VARS = [("torso/measure-shoulder-dist", "shoulder_w_over_head_h"), ("torso/measure-waist-circ", "waist_w_over_head_h"),
        ("torso/measure-hips-circ", "hip_w_over_head_h"), ("neck/measure-neck-circ", "neck_w_over_head_h")]


def signed(t, w):
    return {t + ("-incr" if w >= 0 else "-decr"): abs(w)}


def main():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    R = st.load_recipe()
    T = json.load(open(os.path.join(os.path.dirname(HERE), "compare_targets.json")))["body_face"]
    B = mc.Base()
    P0 = B.macro({})
    lm = lmk.Landmarks(B, P0 - [0, 0, P0[B.body_mask, 2].min()])
    for sex in ("F", "M"):
        r = R[sex]
        for t, _ in VARS:
            for s in ("-incr", "-decr"):
                r["targets"].pop(t + s, None)
        x = np.zeros(len(VARS))

        def evalx(x):
            rr = json.loads(json.dumps(R))
            for (t, _), w in zip(VARS, x):
                rr[sex]["targets"].update(signed(t, w))
            Pp, W = st.neutral(B, lm, rr, sex)
            bf, lo, geo = mm.measure(W(Pp), lm)
            return np.array([bf[k] for _, k in VARS])
        tgt = np.array([T[k][sex] for _, k in VARS])
        for it in range(3):
            f0 = evalx(x)
            J = np.zeros((len(VARS), len(VARS)))
            for j in range(len(VARS)):
                dx = x.copy()
                dx[j] += 0.3
                J[:, j] = (evalx(dx) - f0) / 0.3
            step = np.linalg.lstsq(J, tgt - f0, rcond=None)[0]
            x = np.clip(x + step, -1.0, 1.0)
            print(sex, it, "now", np.round(f0, 3), "target", tgt, "x", np.round(x, 3))
        for (t, _), w in zip(VARS, x):
            R[sex]["targets"].update(signed(t, round(float(w), 3)))
        print(sex, "final", np.round(evalx(x), 3))
    json.dump(R, open(os.path.join(HERE, "recipe.json"), "w"), indent=1)
    B.save_cache()


if __name__ == "__main__":
    main()
