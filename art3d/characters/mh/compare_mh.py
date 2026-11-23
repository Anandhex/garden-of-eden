"""Comparison round for the MakeHuman base (G9 plan section 5 + 11, same stage, poses, cameras, composites and score rows
as ../compare.py and ../loomis_overlay.py).

    source art3d/characters/mh/mpfb_env.sh
    $B -b -P art3d/characters/mh/compare_mh.py -- round=<N> [prev=<N-1>] [note="..."] [only=measure,renders,loomis]

Writes previews/compare/mh/mh_round<N>_{body,face,overlay_face,features}.png, the raw renders, loomis_mh_round<N>_*.png,
measure_mh_round<N>.json, and appends a 'MakeHuman base, round N' block to previews/compare/report.md.
Neutral F and M come from recipe.json (stylise_mh.neutral); placeholder hair = a MakeHuman hair proxy (CC0).
"""
import bpy, os, sys, json, math, subprocess
import numpy as np
from mathutils import Vector, Matrix
from bpy_extras.object_utils import world_to_camera_view

HERE = os.path.dirname(os.path.abspath(__file__))
CHAR = os.path.dirname(HERE)
sys.path.insert(0, HERE)
sys.path.insert(0, CHAR)
import mhcore as mc, landmarks as lmk, measure_mh as mm, stylise_mh as st, person, paint  # noqa: E402
import lookdev as ld, measure as ms  # noqa: E402

CMP = os.path.join(CHAR, "previews", "compare")
OUT = os.path.join(CMP, "mh")
REF = os.path.join(CMP, "reference.png")
REFLM = json.load(open(os.path.join(CMP, "plan", "reference_landmarks.json")))
REF_FACE_BOX = (500, 180, 680, 360)
RIG = "mixamorig:"
BONE = {"LeftUpperLeg": "LeftUpLeg", "RightUpperLeg": "RightUpLeg", "Spine": "Spine", "Chest": "Spine1", "Neck": "Neck",
        "Head": "Head", "LeftUpperArm": "LeftArm", "RightUpperArm": "RightArm", "LeftLowerArm": "LeftForeArm",
        "RightLowerArm": "RightForeArm", "LeftEye": "LeftEye", "RightEye": "RightEye"}


def img_tool(*a):
    subprocess.run(["python3", "-I", os.path.join(CHAR, "compare_img.py"), *map(str, a)], check=True)


def rot_world(arm, bone, axis, deg):
    pb = arm.pose.bones[RIG + BONE.get(bone, bone)]
    bpy.context.view_layer.update()
    h = arm.matrix_world.inverted() @ (arm.matrix_world @ pb.head)
    R = Matrix.Translation(h) @ Matrix.Rotation(math.radians(deg), 4, Vector(axis)) @ Matrix.Translation(-h)
    pb.matrix = R @ pb.matrix
    bpy.context.view_layer.update()


def clear_pose(arm):
    for pb in arm.pose.bones:
        pb.rotation_mode = 'XYZ'
        pb.rotation_euler = (0, 0, 0)
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.location = (0, 0, 0)
    bpy.context.view_layer.update()


def pose_ref(arm):
    """the reference-like stance of ../compare.py: pose_ref (same rotations, Unity names mapped to the Mixamo bones)."""
    clear_pose(arm)
    rot_world(arm, "LeftUpperLeg", (0, 1, 0), -5)
    rot_world(arm, "RightUpperLeg", (0, 1, 0), 3)
    rot_world(arm, "LeftUpperLeg", (1, 0, 0), -8)
    rot_world(arm, "Spine", (0, 0, 1), -8)
    rot_world(arm, "Chest", (0, 0, 1), -8)
    rot_world(arm, "Neck", (0, 0, 1), -16)
    rot_world(arm, "Head", (0, 0, 1), -18)
    rot_world(arm, "Head", (1, 0, 0), 12)
    rot_world(arm, "Head", (0, 1, 0), -8)
    arms_down(arm)


def arms_down(arm, deg=34, bend=-10):
    for side, sg in (("Left", 1), ("Right", -1)):
        rot_world(arm, f"{side}UpperArm", (0, 1, 0), sg * deg)
        if bend:
            rot_world(arm, f"{side}LowerArm", (1, 0, 0), bend)


def look_at_camera(arm, cam):
    bpy.context.view_layer.update()
    for b in ("LeftEye", "RightEye"):
        pb = arm.pose.bones[RIG + b]
        pb.rotation_mode = 'XYZ'
        pb.rotation_euler = (0, 0, 0)
        bpy.context.view_layer.update()
        head = arm.matrix_world @ pb.head
        tail = arm.matrix_world @ pb.tail
        q = (tail - head).normalized().rotation_difference((cam.location - head).normalized())
        pb.matrix = Matrix.Translation(pb.head) @ q.to_matrix().to_4x4() @ Matrix.Translation(-pb.head) @ pb.matrix
    bpy.context.view_layer.update()


def eval_pts(ob):
    dg = bpy.context.evaluated_depsgraph_get()
    o = ob.evaluated_get(dg)
    me = o.to_mesh()
    P = np.array([(o.matrix_world @ v.co)[:] for v in me.vertices])
    o.to_mesh_clear()
    return P


def project(cam, pts):
    sc = bpy.context.scene
    W, H = sc.render.resolution_x, sc.render.resolution_y
    out = []
    for p in pts:
        v = world_to_camera_view(sc, cam, Vector(p))
        out.append((v.x * W, (1 - v.y) * H))
    return out


def score_rows(vals, T, grp, sex):
    rows = []
    for k, t in T[grp].items():
        tg = t[sex]
        ours = vals.get(k)
        if ours is None:
            rows.append((k, None, tg, None, t["w"]))
            continue
        if isinstance(tg, str):
            lim = float(tg[2:])
            g = 0.0 if ours >= lim else (lim - ours) / 0.1
        else:
            g = abs(ours - tg) / t["tol"]
        rows.append((k, ours, tg, round(g, 2), t["w"]))
    sc = [r for r in rows if r[3] is not None]
    wm = sum(r[4] * r[3] for r in sc) / max(sum(r[4] for r in sc), 1e-9)
    return rows, round(wm, 3)


def args():
    a = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    d = {}
    for x in a:
        k, v = x.split("=", 1)
        d[k] = v
    return d


def main():
    a = args()
    rnd = a.get("round", "0")
    prev = a.get("prev")
    note = a.get("note", "")
    only = a.get("only", "measure,renders,loomis").split(",")
    os.makedirs(OUT, exist_ok=True)
    R = st.load_recipe()
    T = json.load(open(os.path.join(CHAR, "compare_targets.json")))
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    B = mc.Base()
    P0 = B.macro({})
    P0 = P0 - [0, 0, P0[B.body_mask, 2].min()]
    lm = lmk.Landmarks(B, P0)
    B.h.hide_render = B.h.hide_viewport = True
    eyes_px = mc.Proxy(mc.proxy_file("eyes", R["proxies"]["eyes"]))
    neutral = {}
    res = {}
    for sex in ("F", "M"):
        P = st.final(B, lm, R, sex)
        neutral[sex] = P
        E = eyes_px.fit(P)
        ap = mm.eye_aperture(P, lm, E, eyes_px.faces, step=0.0004)
        bf, lo, geo = mm.measure(P, lm, E[E[:, 0] > 0], aperture=ap)
        res[sex] = dict(body_face=bf, loomis=lo, geo=geo)
        if sex in ("F", "M"):
            Pm = B.macro(R[sex]["macro"]); st.write_stylise_target(B, R, sex, Pm - [0, 0, Pm[lm.body, 2].min()], P)
    B.save_cache()
    if "measure" in only:
        rep = [f"\n### MakeHuman base, round {rnd}" + (f": {note}" if note else ""), "",
               "| metric | ours F | target F | g F | ours M | target M | g M | w |", "|---|---|---|---|---|---|---|---|"]
        out = {}
        for grp, title in (("body_face", "body/face rows"), ("anthro", "measured-anthropometry rows")):
            src = "loomis" if grp == "anthro" else grp
            Tg = {grp: {k: v for k, v in T[grp].items() if not k.startswith("_")}}
            rf, wf = score_rows(res["F"][src], Tg, grp, "F")
            rm_, wm_ = score_rows(res["M"][src], Tg, grp, "M")
            if grp == "anthro":
                rep += ["", "| anthropometry row (Farkas) | ours F | target F | g F | ours M | target M | g M | w |", "|---|---|---|---|---|---|---|---|"]
            for x, y in zip(rf, rm_):
                rep.append(f"| {x[0]} | {x[1]} | {x[2]} | {'-' if x[3] is None else x[3]} | {y[1]} | {y[2]} | {'-' if y[3] is None else y[3]} | {x[4]} |")
            rep.append(f"| **weighted mean g ({title})** | | | **{wf}** | | | **{wm_}** | |")
            out[grp] = dict(F=wf, M=wm_)
        with open(os.path.join(CMP, "report.md"), "a") as fh:
            fh.write("\n".join(rep) + "\n")
        json.dump(dict(F=res["F"], M=res["M"], weightedMeanG=out), open(os.path.join(OUT, f"measure_mh_round{rnd}.json"), "w"), indent=1)
        print("WEIGHTED", json.dumps(out))
    if "renders" in only:
        renders(B, lm, R, neutral, rnd, prev)
    if "loomis" in only or "anthro" in only:
        anthro_overlay(B, lm, R, neutral, res, T, rnd)


def build_person(B, lm, R, sex, P, hair=True, name=None, brow=None, brow_tex=None):
    prox = {k: (v[sex] if isinstance(v, dict) else v) for k, v in R["proxies"].items()}
    if not hair:
        prox["hair"] = None
    look = R.get("look", {}).get(sex, {})
    import decals
    eyes_px = mc.Proxy(mc.proxy_file("eyes", prox["eyes"]))
    dec = decals.apply_image(P, B, lm, eyes_px, look.get("decal"), name=f"Decal_{sex}") if look.get("decal") is not None else None
    import face_cards
    rb = face_cards.LashRibbon(B, lm, P, eyes_px, **look.get("ribbon", {})) if prox.get("eyelashes") == "ribbon" else None
    lp = (face_cards.LashProxy(mc.Proxy(mc.proxy_file("eyelashes", prox["eyelashes"])), B, lm, P, **look["lash_proxy"])
          if look.get("lash_proxy") and prox.get("eyelashes") not in (None, "ribbon") else None)
    sf = [f for f, q in zip(lm.faces, lm.fpart) if q == "head"] if look.get("snap_brows") else None
    person.build._lm = lm
    objs = person.build(P, prox, name=name or f"MHP_{sex}", tint=paint.tint(P, lm, B, **look.get("paint", {})), decal=dec,
                        ribbon=rb, tear_duct=face_cards.TearDuct(B, lm, P) if (sex == "F" and look.get("tear_duct", True)) else None, lash_proxy=lp,
                        teeth_offset=look.get("teeth_offset"), snap_faces=sf, brow_params=dict(look.get("brow_params", {}), **(brow or {})),
                        brow_tex=brow_tex, **look.get("person", {}))
    if dec:
        decals.set_uv(objs["body"], P, B, lm, dec[1])
    return objs


def renders(B, lm, R, neutral, rnd, prev):
    sc, cam = ld.setup(res=(1140, 1244), centre=(0, 0, 1.0))
    Rn = lambda n: os.path.join(OUT, f"{n}_round{rnd}.png")
    # ---- F, reference stance
    person.clear_people()
    objs = build_person(B, lm, R, "F", neutral["F"])
    arm = objs["rig"]
    pose_ref(arm)
    H = float(neutral["F"][lm.body, 2].max())
    ld.aim(cam, (0, 0, H * 0.50), -22, 3.0, elev_deg=0.0, lens=50)
    cam.location.z = 0.55 * H
    ld.render(Rn("ref_body"))
    sc.render.resolution_x = sc.render.resolution_y = 720
    E = eval_pts(objs["eyes"])
    t = Vector(E.mean(axis=0))
    ld.aim(cam, (t.x * 0, t.y + 0.02, t.z - 0.03), -6, 0.80, elev_deg=-14, lens=85)
    look_at_camera(arm, cam)
    ld.render(Rn("ref_face"))
    E = eval_pts(objs["eyes"])
    eyes_ours = project(cam, [E[E[:, 0] < t.x].mean(axis=0), E[E[:, 0] >= t.x].mean(axis=0)])
    # ---- F and M rest (arms down a little for the face shots, rest A-pose for the ortho bodies)
    for sex in ("F", "M"):
        person.clear_people()
        objs = build_person(B, lm, R, sex, neutral[sex])
        arm = objs["rig"]
        clear_pose(arm)
        tag = sex.lower()
        sc.render.resolution_x, sc.render.resolution_y = 680, 720
        cam.data.type = 'PERSP'
        E = eval_pts(objs["eyes"])
        t = E.mean(axis=0)
        for name, az in (("front_face", 0), ("q34_face", 32), ("side_face", 90)):
            ld.aim(cam, (0, t[1] + 0.02, t[2] - 0.03), az, 0.80, elev_deg=2, lens=85)
            look_at_camera(arm, cam)
            ld.render(Rn(f"{name}_{tag}"))
        sc.render.resolution_x, sc.render.resolution_y = 700, 1244
        Hh = float(neutral[sex][lm.body, 2].max())
        cam.data.type = 'ORTHO'
        cam.data.ortho_scale = Hh * 1.08
        clear_pose(arm)
        for name, az in (("front_body", 0), ("side_body", 90)):
            ld.aim(cam, (0, 0, Hh * 0.5), az, 6.0, elev_deg=0, lens=50)
            ld.render(Rn(f"{name}_{tag}"))
        cam.data.type = 'PERSP'
    person.clear_people()
    # ---- composites
    pv = lambda n: os.path.join(OUT, f"{n}_round{prev}.png") if prev and os.path.exists(os.path.join(OUT, f"{n}_round{prev}.png")) else None
    body = [REF, Rn("ref_body")] + ([pv("ref_body")] if pv("ref_body") else [])
    img_tool("compose", os.path.join(OUT, f"mh_round{rnd}_body.png"), 1000, json.dumps(["reference", f"MH ref_body round {rnd}", f"round {prev}"]), *body)
    crop = os.path.join(OUT, "reference_face_crop.png")
    img_tool("crop", REF, crop, ",".join(map(str, REF_FACE_BOX)), "720,720")
    face = [crop, Rn("ref_face"), Rn("front_face_f"), Rn("q34_face_f"), Rn("front_face_m"), Rn("q34_face_m")] + ([pv("ref_face")] if pv("ref_face") else [])
    img_tool("compose", os.path.join(OUT, f"mh_round{rnd}_face.png"), 720,
             json.dumps(["reference (crop)", f"MH ref_face round {rnd}", "front F", "3/4 F", "front M", "3/4 M", f"round {prev}"]), *face)
    x0, y0, x1, y1 = REF_FACE_BOX
    k = 720 / (x1 - x0)
    fl = REFLM["face"]
    ne = [(fl["near_eye_inner"][i] + fl["near_eye_outer"][i]) / 2 for i in range(2)]
    fe = [(fl["far_eye_inner"][i] + fl["far_eye_outer"][i]) / 2 for i in range(2)]
    ref_eyes = [((p[0] - x0) * k, (p[1] - y0) * k) for p in (fe, ne)]
    boxes = [["eyes", [150, 220, 470, 380]], ["eye (near)", [280, 230, 440, 360]], ["nose", [170, 260, 340, 430]],
             ["mouth", [170, 380, 400, 510]], ["face", [100, 120, 540, 580]]]
    img_tool("overlay", crop, Rn("ref_face"), os.path.join(OUT, f"mh_round{rnd}_overlay_face.png"), json.dumps(ref_eyes), json.dumps(eyes_ours),
             json.dumps(boxes))


def anthro_overlay(B, lm, R, neutral, res, T, rnd):
    """measured landmarks (solid) against the measured-anthropometry targets (dashed): hairline, nasion, subnasale,
    stomion, menton, eye corners, nose wings, mouth corners; front and side, bald head, flat light."""
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_WORKBENCH'
    sc.display.shading.light = 'STUDIO'
    sc.display.shading.color_type = 'SINGLE'
    sc.display.shading.single_color = (0.80, 0.62, 0.52)
    sc.display.shading.show_cavity = True
    sc.render.resolution_x = sc.render.resolution_y = 800
    sc.view_settings.view_transform = 'Standard'
    sc.view_settings.look = 'None'
    for o in [o for o in bpy.data.objects if o.type in ('CAMERA', 'LIGHT') or o.name == "Backdrop"]:
        o.hide_render = True
    cam = bpy.data.objects.new("anthro_cam", bpy.data.cameras.new("anthro_cam"))
    sc.collection.objects.link(cam)
    sc.camera = cam
    cam.data.type = 'ORTHO'
    draw = []
    A = {k: v for k, v in T["anthro"].items() if not k.startswith("_")}
    for sex in ("F", "M"):
        person.clear_people()
        objs = build_person(B, lm, R, sex, neutral[sex], hair=False)
        for k in ("eyebrows", "eyelashes", "hair"):
            if k in objs:
                objs[k].hide_render = True
        geo, lo = res[sex]["geo"], res[sex]["loomis"]
        hh = geo["hh"]
        cz = (geo["top"] + geo["chin"]) / 2
        S = hh * 1.5
        cam.data.ortho_scale = S
        cy = (geo["yfront"] + geo["yback"]) / 2
        # target heights from the measured ratios, anchored on nasion and menton
        n, me = geo["nasion"], geo["chin"]
        lm_t = A["lower_over_middle"][sex]
        sub_t = me + (n - me) * lm_t / (1 + lm_t)
        tgt = dict(hairline=n + (n - sub_t) * A["upper_over_middle"][sex], subnasale=sub_t,
                   stomion=sub_t - (sub_t - me) * A["mouth_line_in_lower"][sex])
        meas = dict(hairline=geo["hairline"], nasion=n, subnasale=geo["sub"], stomion=geo["lip"], menton=me)
        rows = score_rows(lo, {"anthro": A}, "anthro", sex)[0]
        for view in ("front", "side"):
            if view == "front":
                cam.location = (0, -5, cz)
                cam.rotation_euler = (math.pi / 2, 0, 0)
            else:
                cam.location = (5, cy, cz)
                cam.rotation_euler = (math.pi / 2, 0, math.pi / 2)
            p = os.path.join(OUT, f"anthro_mh_round{rnd}_{sex.lower()}_{view}_raw.png")
            sc.render.filepath = p
            bpy.ops.render.render(write_still=True)
            draw.append(dict(raw=p, out=p.replace("_raw.png", ".png"), view=view, sex=sex, cz=cz, cy=cy, S=S, meas=meas, tgt=tgt,
                             eye=[geo["eye_ci"], geo["eye_co"]], mc=geo["mc"], nosew=geo["nosew"], rows=rows))
    spec = os.path.join(OUT, f"anthro_mh_round{rnd}_draw.json")
    json.dump(draw, open(spec, "w"))
    subprocess.run(["python3", "-I", os.path.join(HERE, "anthro_draw.py"), spec, os.path.join(OUT, f"anthro_mh_round{rnd}_sheet.png")], check=True)
    for d in draw:
        try:
            os.remove(d["raw"])
        except OSError:
            pass
    os.remove(spec)
    person.clear_people()


def loomis(B, lm, R, neutral, res, T, rnd):
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_WORKBENCH'
    sc.display.shading.light = 'STUDIO'
    sc.display.shading.color_type = 'SINGLE'
    sc.display.shading.single_color = (0.80, 0.62, 0.52)
    sc.display.shading.show_cavity = True
    sc.render.resolution_x = sc.render.resolution_y = 800
    sc.view_settings.view_transform = 'Standard'
    sc.view_settings.look = 'None'
    for o in [o for o in bpy.data.objects if o.type in ('CAMERA', 'LIGHT') or o.name == "Backdrop"]:
        o.hide_render = True
    cam = bpy.data.objects.new("loomis_cam", bpy.data.cameras.new("loomis_cam"))
    sc.collection.objects.link(cam)
    sc.camera = cam
    cam.data.type = 'ORTHO'
    draw = []
    for sex in ("F", "M"):
        person.clear_people()
        objs = build_person(B, lm, R, sex, neutral[sex], hair=False)
        for k in ("eyebrows", "eyelashes", "hair"):
            if k in objs:
                objs[k].hide_render = True
        geo, lo = res[sex]["geo"], res[sex]["loomis"]
        rows_ = [("loomis", r[0], r[1], r[2], None, r[4], r[3]) for r in score_rows(lo, T, "loomis", sex)[0]]
        hh = geo["hh"]
        cz = (geo["top"] + geo["chin"]) / 2
        S = hh * 1.5
        cam.data.ortho_scale = S
        cy = (geo["yfront"] + geo["yback"]) / 2
        for view in ("front", "side"):
            if view == "front":
                cam.location = (0, -5, cz)
                cam.rotation_euler = (math.pi / 2, 0, 0)
            else:
                cam.location = (5, cy, cz)
                cam.rotation_euler = (math.pi / 2, 0, math.pi / 2)
            p = os.path.join(OUT, f"loomis_mh_round{rnd}_{sex.lower()}_{view}_raw.png")
            sc.render.filepath = p
            bpy.ops.render.render(write_still=True)
            draw.append(dict(raw=p, out=p.replace("_raw.png", ".png"), view=view, sex=sex.lower(), geo=geo, cz=cz, cy=cy, S=S,
                             classic=T["loomisClassic"], target=T["loomisTargetLines"][sex], rows=rows_, loomis=lo))
    spec = os.path.join(OUT, f"loomis_mh_round{rnd}_draw.json")
    json.dump(draw, open(spec, "w"))
    subprocess.run(["python3", "-I", os.path.join(CHAR, "loomis_draw.py"), spec, os.path.join(OUT, f"loomis_mh_round{rnd}_sheet.png")], check=True)
    for d in draw:
        try:
            os.remove(d["raw"])
        except OSError:
            pass
    os.remove(spec)
    person.clear_people()


if __name__ == "__main__":
    main()
