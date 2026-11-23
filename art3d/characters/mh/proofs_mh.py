"""Proof sheets for the slider / expression checkpoint (needs mh/cache/keys.npz from build_mh.py):

    $B -b -P art3d/characters/mh/proofs_mh.py -- [only=sweeps,expressions,generated,blink,features_m]

* sweeps_face_{f,m}.png / sweeps_body.png: every slider at min / neutral / max (Stylise applied)
* expressions.png: blink, smile, frown, surprise, angry and the visemes AA EE OH OO MBP FV, F and M, front and 3/4
* generated_16.png: 16 people from person.generate (8 women, 8 men, ages 20-75, mixed cultures)
* blink_check.json: visible eye opening with Eye_Blink_L/R = 1 on top of risky slider combinations (must be ~0)
* features_m.png: the masculine reference-like 3/4 and its feature crops next to the reference's
Writes into previews/compare/mh/.
"""
import bpy, os, sys, json, math, subprocess
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
CHAR = os.path.dirname(HERE)
sys.path.insert(0, HERE)
sys.path.insert(0, CHAR)
import mhcore as mc, landmarks as lmk, stylise_mh as st, person, compare_mh as cm, sheets_mh as shs, measure_mh as mm  # noqa
import lookdev as ld  # noqa: E402

OUT = os.path.join(CHAR, "previews", "compare", "mh")
TMP = os.path.join(OUT, "_proof_tmp")
HAIR = {"F": ("ponytail01", (0.17, 0.09, 0.05)), "M": ("short02", (0.07, 0.05, 0.04))}
EYE = {"F": "eye_brown_mh.png", "M": "eye_brown_mh.png"}

FACE_SWEEPS = [("face length", "Face_Long", "Face_Short"), ("jaw width", "Jaw_Wide", None), ("jaw angle", "Jaw_Square", None),
               ("chin height", "Chin_Long", None), ("chin projection", "Chin_Forward", "Chin_Back"),
               ("cheeks", "Cheeks_Full", None), ("cheekbones", "Cheekbones", None), ("eye size", "Eye_Big", None),
               ("eye spacing", "Eye_Spacing", None), ("eye tilt", "Eye_TiltUp", "Eye_TiltDown"),
               ("eye openness", "Eye_Round", "Eye_Narrow"), ("nose length", "Var_NoseLength", None),
               ("nose width", "Var_NoseWidth", None), ("lip fullness", "Lips_Full", "Lips_Thin"),
               ("mouth width", "Mouth_Wide", "Mouth_Narrow"), ("ear size", "Var_EarSize", None),
               ("lower face", "Var_LowerFace", None), ("forehead", "Var_Forehead", None)]
BODY_SWEEPS = [("sex", None, None, "F"), ("height", "Height_Legs", None, "F"), ("waist", "Waist_Wide", "Waist_Slim", "F"),
               ("breast", "Breast", None, "F"), ("belly", "Belly", None, "F"), ("hips + butt", "Hips|Butt", None, "F"),
               ("shoulders", "Shoulders", None, "M"), ("muscle", "Muscle", None, "M"), ("weight", "Heavy", "Thin", "M"),
               ("age", "Age_Old", None, "F"), ("age", "Age_Old", None, "M")]
EXPR = [("neutral", {}, 0), ("blink", {"Eye_Blink_L": 1, "Eye_Blink_R": 1}, 0), ("smile", {"Mouth_Smile": 1, "Eye_Squint": 0.3}, 0),
        ("frown", {"Mouth_Frown": 1, "Brow_Sad": 0.5}, 0), ("surprise", {"Brow_Up": 1, "Mouth_O": 0.3}, 12),
        ("angry", {"Brow_Down": 1, "Mouth_Frown": 0.4, "Eye_Squint": 0.4}, 0), ("viseme AA", {}, 18),
        ("viseme EE", {"Mouth_E": 1}, 5), ("viseme OH", {"Mouth_O": 0.6}, 12), ("viseme OO", {"Mouth_O": 1}, 3),
        ("viseme MBP", {"Mouth_MBP": 1}, 0), ("viseme FV", {"Mouth_MBP": 0.35, "Mouth_E": 0.3}, 3)]


def grid(out, cols, labels, paths):
    subprocess.run(["python3", "-I", os.path.join(HERE, "sheet_img.py"), "grid", out, str(cols), json.dumps(labels), *paths], check=True)


def neutral_w(sex):
    return {"Sex": 1.0 if sex == "F" else 0.0, f"Stylise_{sex}": 1.0}


def slider(w, pos, neg, v):
    w = dict(w)
    keys = pos.split("|")
    if v >= 0 or neg is None:
        for k in keys:
            w[k] = w.get(k, 0) + v
    else:
        w[neg] = w.get(neg, 0) - v
    return w


class Stage:
    def __init__(self):
        for o in list(bpy.data.objects):
            bpy.data.objects.remove(o, do_unlink=True)
        self.R = st.load_recipe()
        self.B = mc.Base()
        P0 = self.B.macro({})
        self.lm = lmk.Landmarks(self.B, P0 - [0, 0, P0[self.B.body_mask, 2].min()])
        self.B.h.hide_render = self.B.h.hide_viewport = True
        self.Z = np.load(os.path.join(mc.CACHE, "keys.npz"))
        self.sc, self.cam = ld.setup(res=(420, 420), centre=(0, 0, 1.0))
        os.makedirs(TMP, exist_ok=True)
        self.n = 0

    def person(self, w, sex, hair=True, tone="T2_fair"):
        P = person.mix(self.Z, w)
        Po = person.mix(self.Z, {k: v for k, v in w.items() if not k.startswith("Eye_Blink")})
        h, hc = HAIR[sex]
        objs = shs.assemble(self.B, self.lm, self.R, P, sex, h if hair else None, tone, hc, EYE[sex], name="MHP_p", p_open=Po)
        cm.clear_pose(objs["rig"])
        return P, objs

    def shot(self, objs, P, kind, az=0, res=420, jaw=0):
        arm = objs["rig"]
        if jaw:
            cm.rot_world(arm, "Jaw", (1, 0, 0), jaw)
        sc, cam = self.sc, self.cam
        if kind == "face":
            sc.render.resolution_x = sc.render.resolution_y = res
            cam.data.type = 'PERSP'
            E = cm.eval_pts(objs["eyes"])
            t = E.mean(axis=0)
            ld.aim(cam, (0, t[1] + 0.02, t[2] - 0.04), az, 0.78, elev_deg=2, lens=85)
            cm.look_at_camera(arm, cam)
        else:
            sc.render.resolution_x, sc.render.resolution_y = int(res * 0.5), res
            cam.data.type = 'ORTHO'
            cam.data.ortho_scale = 2.0
            ld.aim(cam, (0, 0, 0.95), az, 6.0, elev_deg=0)
        p = os.path.join(TMP, f"s{self.n:04d}.png")
        self.n += 1
        ld.render(p)
        cam.data.type = 'PERSP'
        return p


def sweeps(S):
    for sex in ("F", "M"):
        paths, labels = [], []
        for label, pos, neg in FACE_SWEEPS:
            for v, tag in ((-1, "min"), (0, "neutral"), (1, "max")):
                w = slider(neutral_w(sex), pos, neg, v)
                P, objs = S.person(w, sex)
                paths.append(S.shot(objs, P, "face", az=20, res=360))
                labels.append(f"{label} {tag}")
        grid(os.path.join(OUT, f"sweeps_face_{sex.lower()}.png"), 9, labels, paths)
    paths, labels = [], []
    for label, pos, neg, sex in BODY_SWEEPS:
        for v, tag in ((-1, "min"), (0, "neutral"), (1, "max")):
            if label == "sex":
                s_ = {-1: 0.0, 0: 0.5, 1: 1.0}[v]
                w = {"Sex": s_, "Stylise_F": s_, "Stylise_M": 1 - s_}
                sx = "F" if s_ >= 0.5 else "M"
            else:
                vv = max(v, 0) if label == "age" or pos in ("Breast",) else v
                w = slider(neutral_w(sex), pos, neg, vv * (1.0 if label != "age" else 1.0))
                if label == "age" and v == 0:
                    w["Age_Old"] = 0.5
                sx = sex
            P, objs = S.person(w, sx)
            cm.arms_down(objs["rig"], 36, bend=0)
            paths.append(S.shot(objs, P, "body", az=20, res=700))
            labels.append(f"{label} {tag}" + (f" ({sex})" if label != "sex" else ""))
    grid(os.path.join(OUT, "sweeps_body.png"), 9, labels, paths)


def expressions(S):
    paths, labels = [], []
    for sex in ("F", "M"):
        for az in (0, 32):
            for label, w_, jaw in EXPR:
                w = dict(neutral_w(sex), **w_)
                P, objs = S.person(w, sex)
                paths.append(S.shot(objs, P, "face", az=az, res=320, jaw=jaw))
                labels.append(f"{sex} {label}" + (" 3/4" if az else ""))
    grid(os.path.join(OUT, "expressions.png"), 12, labels, paths)


def generated(S):
    paths, labels = [], []
    ages = [20, 24, 28, 33, 40, 48, 58, 70]
    cultures = ["north", "south", "east", "west", None]
    tones = ["T1_light", "T2_fair", "T3_warm", "T4_tan", "T5_brown", "T6_deep"]
    hairs = {"F": ["bob02", "ponytail01", "braid01", "bob01", "long01", "afro01", "short04", "ponytail01"],
             "M": ["short02", "short01", "short03", "short04", "short02", "afro01", "short01", "short04"]}
    for sex in ("F", "M"):
        for i, age in enumerate(ages):
            pid = f"town-{sex}-{i}"
            cu = cultures[(i * 3 + (sex == "M")) % len(cultures)]
            w = person.generate(pid, sex=sex, age=age, culture=cu)
            P = person.mix(S.Z, w)
            grey = age >= 58
            hc = (0.40, 0.39, 0.38) if grey else [(0.17, 0.09, 0.05), (0.05, 0.04, 0.035), (0.32, 0.20, 0.10), (0.10, 0.06, 0.04)][i % 4]
            objs = shs.assemble(S.B, S.lm, S.R, P, sex, hairs[sex][i], tones[(i * 5 + (sex == "M") * 2) % 6], hc,
                                ["eye_brown_mh.png", "eye_green_mh.png", "eye_blue_mh.png", "eye_brownlight_mh.png", "eye_grey_mh.png"][i % 5], name="MHP_g")
            cm.clear_pose(objs["rig"])
            paths.append(S.shot(objs, P, "face", az=24, res=400))
            labels.append(f"{'woman' if sex == 'F' else 'man'} {age}, {cu or 'mixed'}")
    grid(os.path.join(OUT, "generated_16.png"), 8, labels, paths)


def blink(S):
    eyes_px = mc.Proxy(mc.proxy_file("eyes", S.R["proxies"]["eyes"]))
    combos = {"neutral": {}, "Eye_Big": {"Eye_Big": 1}, "Eye_Round": {"Eye_Round": 1}, "Eye_Big+Round": {"Eye_Big": 1, "Eye_Round": 1}, "Eye_Big+Round0.6": {"Eye_Big": 1, "Eye_Round": 0.6},
              "Eye_Big0.5+Round": {"Eye_Big": 0.5, "Eye_Round": 1},
              "Age_Old": {"Age_Old": 1}, "Eye_Protrude": {"Eye_Protrude": 1}, "Eye_TiltUp": {"Eye_TiltUp": 1},
              "Eye_Big-1": {"Eye_Big": -1}, "Species_Elf": {"Species_Elf": 1}, "Species_Orc": {"Species_Orc": 1},
              "Heavy": {"Heavy": 1}, "Cheeks_Full": {"Cheeks_Full": 1}}
    res = {}
    for sex in ("F", "M"):
        for name, extra in combos.items():
            w = dict(neutral_w(sex), **extra)
            P_open = person.mix(S.Z, w)
            P_shut = person.mix(S.Z, dict(w, Eye_Blink_L=1, Eye_Blink_R=1))
            o = []
            for P in (P_open, P_shut):
                E = eyes_px.fit(P)
                mm.eye_aperture(P, S.lm, E, eyes_px.faces, side="L", step=0.0004)
                o.append(0 if mm.eye_aperture.cells is None else len(mm.eye_aperture.cells))
            res[f"{sex} {name}"] = dict(open_cells=o[0], blink_cells=o[1], closed=o[1] <= max(2, 0.01 * o[0]))
            print("BLINK", sex, name, o, flush=True)
    json.dump(res, open(os.path.join(OUT, "blink_check.json"), "w"), indent=1)


def features_m(S):
    w = neutral_w("M")
    P, objs = S.person(w, "M")
    arm = objs["rig"]
    cm.pose_ref(arm)
    sc, cam = S.sc, S.cam
    sc.render.resolution_x = sc.render.resolution_y = 720
    E = cm.eval_pts(objs["eyes"])
    t = E.mean(axis=0)
    ld.aim(cam, (0, t[1] + 0.02, t[2] - 0.03), -6, 0.80, elev_deg=-14, lens=85)
    cm.look_at_camera(arm, cam)
    p = os.path.join(OUT, "ref_face_m_proof.png")
    ld.render(p)
    E = cm.eval_pts(objs["eyes"])
    eyes_ours = cm.project(cam, [E[E[:, 0] < t[0]].mean(axis=0), E[E[:, 0] >= t[0]].mean(axis=0)])
    crop = os.path.join(OUT, "reference_face_crop.png")
    x0, y0, x1, y1 = cm.REF_FACE_BOX
    k = 720 / (x1 - x0)
    fl = cm.REFLM["face"]
    ne = [(fl["near_eye_inner"][i] + fl["near_eye_outer"][i]) / 2 for i in range(2)]
    fe = [(fl["far_eye_inner"][i] + fl["far_eye_outer"][i]) / 2 for i in range(2)]
    ref_eyes = [((q[0] - x0) * k, (q[1] - y0) * k) for q in (fe, ne)]
    boxes = [["eyes", [150, 220, 470, 380]], ["eye (near)", [280, 230, 440, 360]], ["nose", [170, 260, 340, 430]],
             ["mouth", [170, 380, 400, 510]], ["face", [100, 120, 540, 580]]]
    cm.img_tool("overlay", crop, p, os.path.join(OUT, "features_m_overlay_face.png"), json.dumps(ref_eyes), json.dumps(eyes_ours), json.dumps(boxes))


def main():
    a = dict(x.split("=", 1) for x in (sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []))
    only = a.get("only", "blink,features_m,expressions,sweeps,generated").split(",")
    S = Stage()
    for name in only:
        globals()[name](S)
        print("DONE", name, flush=True)
    S.B.save_cache()


if __name__ == "__main__":
    main()
