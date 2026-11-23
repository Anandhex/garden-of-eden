"""Hair / facial hair / brow sheets (round 23).

    $B -b -P art3d/characters/mh/proofs_hair.py -- [only=hair,beards,talk,brows,people]
"""
import bpy, os, sys
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.dirname(HERE))
import proofs_mh as pm, person, sheets_mh as shs, compare_mh as cm, hair_lib as hl, face_cards as fc  # noqa: E402
import lookdev as ld  # noqa: E402

OUT = pm.OUT
A = {}
COLS = [hl.PALETTE[k] for k in ("black", "dark brown", "brown", "soft black", "light brown", "dark blonde", "dark brown", "auburn")]


def shot(S, objs, az, res=300, dist=0.62, jaw=0):
    arm = objs["rig"]
    cm.clear_pose(arm)
    if jaw:
        cm.rot_world(arm, "Jaw", (1, 0, 0), jaw)
    E = cm.eval_pts(objs["eyes"])
    t = E.mean(axis=0)
    S.sc.render.resolution_x = S.sc.render.resolution_y = res
    S.cam.data.type = 'PERSP'
    ld.aim(S.cam, (0, t[1] + 0.04, t[2] - 0.02), az, dist, elev_deg=4, lens=85)
    p = os.path.join(pm.TMP, f"h{S.n:04d}.png")
    S.n += 1
    ld.render(p)
    return p


def hair(S):
    for sex in ("F", "M"):
        P = person.mix(S.Z, pm.neutral_w(sex))
        paths, labels = [], []
        for i, st in enumerate(hl.styles_for(sex)):
            if A.get("styles") and st not in A["styles"].split("|"):
                continue
            col = COLS[i % len(COLS)]
            objs = shs.assemble(S.B, S.lm, S.R, P, sex, st, "T2_fair" if sex == "F" else "T3_warm", col, pm.EYE[sex], name="MHP_h")
            for az in (0, 35):
                paths.append(shot(S, objs, az))
                labels.append(f"{st}" + (" 3/4" if az else ""))
        if paths:
            pm.grid(os.path.join(OUT, A.get("prefix", "") + f"hair_{sex.lower()}.png"), 8, labels, paths)


def beards(S):
    P = person.mix(S.Z, pm.neutral_w("M"))
    paths, labels = [], []
    for i, b in enumerate(sorted(hl.BEARDS)):
        if A.get("beards") and b not in A["beards"].split("|"):
            continue
        if b == "none":
            continue
        col = COLS[(i * 3) % len(COLS)]
        objs = shs.assemble(S.B, S.lm, S.R, P, "M", "short", "T3_warm", col, pm.EYE["M"], name="MHP_b", beard=b)
        for az in (0, 40):
            paths.append(shot(S, objs, az, dist=0.55))
            labels.append(b + (" 3/4" if az else ""))
    pm.grid(os.path.join(OUT, A.get("prefix", "") + "facial_hair.png"), 8, labels, paths)


def talk(S):
    paths, labels = [], []
    for b in ("full beard", "goatee and moustache", "moustache", "short beard"):
        for lab, extra, jaw in (("neutral", {}, 0), ("AA", {}, 16), ("OH", {"Mouth_O": 0.7}, 10), ("EE", {"Mouth_E": 1.0}, 4),
                                ("smile", {"Mouth_Smile": 1.0}, 0), ("frown", {"Mouth_Frown": 1.0}, 0)):
            P = person.mix(S.Z, dict(pm.neutral_w("M"), **extra))
            objs = shs.assemble(S.B, S.lm, S.R, P, "M", "short", "T3_warm", (0.10, 0.06, 0.04), pm.EYE["M"], name="MHP_t", beard=b)
            paths.append(shot(S, objs, 25, dist=0.5, jaw=jaw))
            labels.append(f"{b}: {lab}")
    pm.grid(os.path.join(OUT, "facial_hair_talking.png"), 6, labels, paths)


def brows(S):
    paths, labels = [], []
    for sex in ("F", "M"):
        P = person.mix(S.Z, pm.neutral_w(sex))
        for i, (name, (tex, prm, dens)) in enumerate(fc.BROW_STYLES.items()):
            col = COLS[i % len(COLS)]
            objs = shs.assemble(S.B, S.lm, S.R, P, sex, None, "T2_fair", col, pm.EYE[sex], name="MHP_br",
                                brow=dict(S.R["look"][sex]["brow_params"], **{k: prm.get(k, 0) for k in prm}), brow_tex=tex,
                                brow_gain=1.2 * dens)
            E = cm.eval_pts(objs["eyes"])
            t = E.mean(axis=0)
            S.sc.render.resolution_x, S.sc.render.resolution_y = 420, 260
            ld.aim(S.cam, (0, t[1], t[2] + 0.012), 10, 0.30, elev_deg=3, lens=85)
            p = os.path.join(pm.TMP, f"b{S.n:04d}.png")
            S.n += 1
            ld.render(p)
            paths.append(p)
            labels.append(f"{sex} {name}")
    pm.grid(os.path.join(OUT, "brows_grid.png"), 8, labels, paths)


def people(S):
    tones = ["T1_light", "T2_fair", "T3_warm", "T4_tan", "T5_brown", "T6_deep"]
    cultures = ["north", "south", "east", "west", None]
    for sex in ("F", "M"):
        paths, labels = [], []
        for i, age in enumerate([19, 24, 29, 34, 41, 49, 58, 70]):
            cu = cultures[(i * 3 + (sex == "M")) % 5]
            w = person.generate(f"hair-{sex}-{i}", sex=sex, age=age, culture=cu)
            P = person.mix(S.Z, w)
            style = w.get("_brow_style", "soft arch")
            objs = shs.assemble(S.B, S.lm, S.R, P, sex, w["_hair"], tones[(i * 5 + (sex == "M")) % 6], w["_hair_col"],
                                ["eye_brown_mh.png", "eye_green_mh.png", "eye_blue_mh.png", "eye_brownlight_mh.png"][i % 4], name="MHP_g",
                                brow={k: w[k] for k in fc.BROW_KEYS if k in w}, brow_tex=fc.BROW_STYLES[style][0],
                                brow_gain=1.2 * w.get("_brow_density", 1.0), gloss_scale=0.75, beard=w.get("_beard"),
                                greying=w.get("_greying", 0.0))
            paths.append(shot(S, objs, 25, res=380))
            labels.append(f"{age}, {w['_hair']}" + (f", {w['_beard']}" if sex == "M" else ""))
        pm.grid(os.path.join(OUT, f"people_hair_{sex.lower()}.png"), 4, labels, paths)


if __name__ == "__main__":
    a = dict(x.split("=", 1) for x in (sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []))
    A.update(a)
    S = pm.Stage()
    for n in a.get("only", "hair,beards,talk,brows,people").split(","):
        globals()[n](S)
        print("DONE", n, flush=True)
