"""Quick look round: neutral F and M from recipe.json, face front / 3/4 / side and body front on the look-dev stage.

    source mh/mpfb_env.sh; $B -b -P art3d/characters/mh/look_round.py -- out=<dir> [sex=F,M] [shots=face,body] [hair=0]
"""
import bpy, os, sys, json
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.dirname(HERE))
import mhcore as mc, landmarks as lmk, measure_mh as mm, stylise_mh as st, person, paint  # noqa: E402
import lookdev as ld  # noqa: E402


def args():
    a = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    d = {}
    for x in a:
        k, v = x.split("=", 1)
        d[k] = v
    return d


def setup_all():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    B = mc.Base()
    P0 = B.macro({})
    P0 = P0 - [0, 0, P0[B.body_mask, 2].min()]
    lm = lmk.Landmarks(B, P0)
    B.h.hide_render = True
    B.h.hide_viewport = True
    return B, lm


def neutral_final(B, lm, R, sex):
    Ppre, W = st.neutral(B, lm, R, sex)
    return st.final(B, lm, R, sex), Ppre, W


def metrics(B, lm, P, eyes_px):
    E = eyes_px.fit(P)
    ap = mm.eye_aperture(P, lm, E, eyes_px.faces, step=0.0005)
    return mm.measure(P, lm, E[E[:, 0] > 0], aperture=ap)


def main():
    a = args()
    out = a.get("out", "/tmp")
    os.makedirs(out, exist_ok=True)
    sexes = a.get("sex", "F,M").split(",")
    shots = a.get("shots", "face,body").split(",")
    R = st.load_recipe()
    B, lm = setup_all()
    T = json.load(open(os.path.join(os.path.dirname(HERE), "compare_targets.json")))
    eyes_px = mc.Proxy(mc.proxy_file("eyes", R["proxies"]["eyes"]))
    sc, cam = ld.setup(res=(720, 720), centre=(0, 0, 1.0))
    for sex in sexes:
        P, Ppre, W = neutral_final(B, lm, R, sex)
        bf, lo, geo = metrics(B, lm, P, eyes_px)
        rows = []
        for grp, vals in (("body_face", bf), ("anthro", lo)):
            for k, t in T[grp].items():
                if k.startswith("_"):
                    continue
                tg = t[sex]
                g = None
                if isinstance(tg, str):
                    g = 0.0 if vals[k] >= float(tg[2:]) else (float(tg[2:]) - vals[k]) / 0.1
                elif vals.get(k) is not None:
                    g = abs(vals[k] - tg) / t["tol"]
                rows.append((k, vals.get(k), tg, None if g is None else round(g, 2)))
        print(f"METRICS {sex}", json.dumps(rows))
        prox = {k: (v[sex] if isinstance(v, dict) else v) for k, v in R["proxies"].items()}
        if a.get("hair", "1") == "0":
            prox["hair"] = None
        person.clear_people()
        import compare_mh
        objs = compare_mh.build_person(B, lm, R, sex, P, hair=a.get("hair", "1") != "0")
        dg = bpy.context.evaluated_depsgraph_get()
        c = P[B.groups["helper-l-eye"]].mean(axis=0) * [0, 1, 1]
        tag = a.get("tag", "")
        if "face" in shots:
            sc.render.resolution_x = sc.render.resolution_y = 720
            cam.data.type = 'PERSP'
            for name, az, el in (("front", 0, 2), ("q34", 32, 2), ("side", 90, 2), ("ref", 38, -12)):
                ld.aim(cam, (0, c[1] + 0.02, c[2] - 0.03), az, 0.80, elev_deg=el, lens=85)
                ld.render(os.path.join(out, f"{tag}{sex}_face_{name}.png"))
        if "body" in shots:
            sc.render.resolution_x, sc.render.resolution_y = 700, 1244
            H = float(P[lm.body, 2].max())
            cam.data.type = 'ORTHO'
            cam.data.ortho_scale = H * 1.08
            for name, az in (("front", 0), ("side", 90)):
                ld.aim(cam, (0, 0, H * 0.5), az, 6.0, elev_deg=0)
                ld.render(os.path.join(out, f"{tag}{sex}_body_{name}.png"))
            cam.data.type = 'PERSP'
    B.save_cache()


if __name__ == "__main__":
    main()
