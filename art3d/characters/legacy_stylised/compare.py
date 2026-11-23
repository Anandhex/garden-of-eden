"""Reference comparison loop (2026-11): matched renders of our neutral feminine/masculine body and face next to the
art-direction reference, plus numeric proportions of our mesh.  The reference measurements are read off the reference image
by hand (see previews/compare/report.md); this script measures OUR side exactly and writes the composites.

    Blender -b art3d/characters/base.blend -P art3d/characters/compare.py -- round=1 [ref=/path/to/reference.png] [only=body,face]
"""
import bpy, os, sys, json, math
import numpy as np
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import common, lookdev as ld  # noqa: E402

OUT = os.path.join(common.PREVIEW_DIR, "compare")
META = json.load(open(os.path.join(common.EXPORT_DIR, "base_body_meta.json")))


def evaluated(names):
    dg = bpy.context.evaluated_depsgraph_get()
    out = {}
    for n in names:
        o = bpy.data.objects[n].evaluated_get(dg)
        me = o.to_mesh()
        out[n] = np.array([(o.matrix_world @ v.co)[:] for v in me.vertices])
        o.to_mesh_clear()
    return out


def measure(sex):
    """proportions of the neutral body (rest pose) at Sex = sex."""
    arm = bpy.data.objects["Armature"]
    arm.data.pose_position = 'REST'
    ld.set_keys({"Sex": sex})
    E = evaluated(["Mesh_Head", "Mesh_Torso", "Mesh_Arms", "Mesh_Hands", "Mesh_Legs", "Mesh_Feet", "Part_Nose", "Part_Eye_L"])
    allv = np.concatenate([E[k] for k in E if k.startswith("Mesh_")])
    zmin, zmax = allv[:, 2].min(), allv[:, 2].max()
    Hh = zmax - zmin
    head = E["Mesh_Head"]
    yc = head[:, 1].mean()
    chin = head[head[:, 1] < yc - 0.02][:, 2].min()
    head_h = zmax - chin
    T = E["Mesh_Torso"]
    legs = E["Mesh_Legs"]
    tl0 = np.concatenate([T, legs])
    crotch = T[np.abs(T[:, 0]) < 0.03][:, 2].min()        # bottom of the pelvis part (crotch)
    # widths per 1 cm slice (torso + legs top), front view
    tl = np.concatenate([T, legs[legs[:, 2] > crotch - 0.02]])
    zs = np.arange(crotch, crotch + 0.55, 0.005)
    width = np.array([2 * np.abs(tl[np.abs(tl[:, 2] - z) < 0.015][:, 0]).max() if np.any(np.abs(tl[:, 2] - z) < 0.015) else 0 for z in zs])
    hip_i = int(np.argmax(width[:int(0.20 / 0.005)]))
    hip_w, hip_z = width[hip_i], zs[hip_i]
    seg = (zs > hip_z + 0.08) & (zs < hip_z + 0.35)
    seg &= width > 0.05
    waist_i = np.nonzero(seg)[0][np.argmin(width[seg])]
    waist_w, waist_z = width[waist_i], zs[waist_i]
    A = np.concatenate([T, E["Mesh_Arms"]])
    neck_base = float(np.median(T[T[:, 2] > T[:, 2].max() - 0.01][:, 2]))
    sh = A[(A[:, 2] > neck_base - 0.12)]
    shoulder_w = 2 * np.abs(sh[:, 0]).max()
    skull = head[(head[:, 2] > chin + 0.10)]
    head_w = 2 * np.abs(skull[:, 0]).max()
    hands = E["Mesh_Hands"]
    hl = hands[hands[:, 0] > 0]
    wrist = np.array(META["landmarks"]["wrist"]) if sex == 0 else np.array(META["landmarksFemale"]["wrist"])
    hand_len = np.linalg.norm(hl - wrist, axis=1).max()
    # face
    lm = META["faceLandmarkVerts"]
    def hv(k):
        d = lm[k]
        return E[d["mesh"]][d["vertex"]]
    eye_w = np.linalg.norm(hv("canthusOuter_L") - hv("canthusInner_L"))
    eye_h = hv("lidUpper_L")[2] - hv("lidLower_L")[2]
    inter = np.linalg.norm(hv("canthusInner_L") - hv("canthusInner_R"))
    face_w = 2 * np.abs(head[np.abs(head[:, 2] - hv("canthusOuter_L")[2] + 0.02) < 0.006][:, 0]).max()
    mouth_w = np.linalg.norm(hv("mouthCorner_L") - hv("mouthCorner_R"))
    nose = E["Part_Nose"]
    nasion = hv("canthusInner_L")[2]
    subnasale = nose[np.abs(nose[:, 0]) < 0.004][:, 2].min()
    brow = hv("lidUpper_L")[2] + 0.012
    face_h = brow - chin
    m = {
        "height_m": Hh, "heads_tall": Hh / head_h, "head_h_m": head_h,
        "crotch_over_height": (crotch - zmin) / Hh,
        "shoulder_w_over_head_h": shoulder_w / head_h, "shoulder_w_over_head_w": shoulder_w / head_w,
        "waist_over_hip": waist_w / hip_w, "hip_w_over_head_h": hip_w / head_h,
        "neck_len_over_head_h": (chin - neck_base) / head_h,
        "hand_len_over_head_h": hand_len / head_h,
        "eye_w_over_face_w": eye_w / face_w, "eye_open_h_over_w": eye_h / eye_w, "eye_gap_over_eye_w": inter / eye_w,
        "nose_len_over_face_h": (nasion - subnasale) / face_h, "mouth_w_over_face_w": mouth_w / face_w,
        "mouth_w_over_eye_gap": mouth_w / inter,
    }
    return {k: round(float(v), 3) for k, v in m.items()}


def arms_down(arm, deg):
    """rotate the upper arms down towards the body (axis found by testing which local axis lowers the hand)."""
    best = {}
    for side in ("Left", "Right"):
        pb = arm.pose.bones[f"{side}UpperArm"]
        pb.rotation_mode = 'XYZ'
        hand = arm.pose.bones[f"{side}Hand"]
        res = []
        for ax in range(3):
            for sg in (1, -1):
                r = [0, 0, 0]
                r[ax] = math.radians(25 * sg)
                pb.rotation_euler = r
                bpy.context.view_layer.update()
                h = arm.matrix_world @ hand.head
                res.append((h.z + 3 * abs(h.y - 0.0) * 0, ax, sg, h.copy()))
        pb.rotation_euler = (0, 0, 0)
        bpy.context.view_layer.update()
        h0 = arm.matrix_world @ hand.head
        cands = [r for r in res if abs(r[3].y - h0.y) < 0.06]
        z, ax, sg, _ = min(cands, key=lambda r: r[0])
        rr = [0, 0, 0]
        rr[ax] = math.radians(deg * sg)
        pb.rotation_euler = rr
        best[side] = (ax, sg)
    bpy.context.view_layer.update()
    return best


def standing(arm, arms=24, forearm=8, legs=3.0):
    ld.clear_pose(arm)
    arm.data.pose_position = 'POSE'
    b = arms_down(arm, arms)
    for side in ("Left", "Right"):
        ax, sg = b[side]
        pb = arm.pose.bones[f"{side}LowerArm"]
        pb.rotation_mode = 'XYZ'
        r = [0, 0, 0]
        r[ax] = math.radians(forearm * sg * 0.5)
        pb.rotation_euler = r
    for side, sg in (("Left", 1), ("Right", -1)):
        pb = arm.pose.bones[f"{side}UpperLeg"]
        pb.rotation_mode = 'XYZ'
        pb.rotation_euler = (0, math.radians(0), math.radians(legs * sg * 0))
    bpy.context.view_layer.update()


def composite(paths, out, h=1000, labels=None):
    """side-by-side composite (runs Pillow in the system python3; Blender's python has no PIL)."""
    import subprocess
    subprocess.run(["python3", "-I", os.path.abspath(__file__).replace("compare.py", "compare_img.py"), "compose", out, str(h),
                    json.dumps(labels or []), *paths], check=True)


def _composite_pil(paths, out, h=1000, labels=None):
    from PIL import Image, ImageDraw
    ims = [Image.open(p).convert("RGB") for p in paths]
    ims = [im.resize((int(im.width * h / im.height), h), Image.LANCZOS) for im in ims]
    W = sum(im.width for im in ims)
    canvas = Image.new("RGB", (W, h), (20, 20, 20))
    x = 0
    d = ImageDraw.Draw(canvas)
    for i, im in enumerate(ims):
        canvas.paste(im, (x, 0))
        if labels:
            d.rectangle([x, 0, x + 8 * len(labels[i]) + 10, 22], fill=(0, 0, 0))
            d.text((x + 5, 5), labels[i], fill=(255, 255, 255))
        x += im.width
    canvas.save(out)


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    rnd, ref, only = "1", None, None
    for a in argv:
        if a.startswith("round="):
            rnd = a[6:]
        elif a.startswith("ref="):
            ref = a[4:]
        elif a.startswith("only="):
            only = a[5:].split(",")
    want = lambda k: not only or k in only
    os.makedirs(OUT, exist_ok=True)
    meas = {"feminine": measure(1.0), "masculine": measure(0.0)}
    json.dump(meas, open(os.path.join(OUT, f"measure_round{rnd}.json"), "w"), indent=1)
    print(json.dumps(meas, indent=1))
    arm = bpy.data.objects["Armature"]
    ld.show_only(ld.BASE_VISIBLE)
    sc, cam = ld.setup(res=(1140, 1244), centre=(0, 0, 1.0), figure_scale=1.0)
    ld.assign("T2_fair")
    paths = []
    if want("body"):
        for tag, sex in (("f", 1.0), ("m", 0.0)):
            ld.set_keys({"Sex": sex})
            standing(arm)
            H = 1.65 if sex else 1.75
            ld.aim(cam, (0, 0, H * 0.52), -22, 3.25, elev_deg=3, lens=50, shift=(0.0, 0.0))
            p = os.path.join(OUT, f"body_{tag}_round{rnd}.png")
            ld.render(p)
            paths.append(p)
        if ref:
            composite([ref] + paths, os.path.join(OUT, f"round{rnd}_body.png"), labels=["reference", "ours feminine", "ours masculine"])
    if want("face"):
        ld.set_keys({"Sex": 1.0})
        standing(arm)
        pb = arm.pose.bones["Head"]
        pb.rotation_mode = 'XYZ'
        sc.render.resolution_x, sc.render.resolution_y = 680, 720
        t = ld.head_target(0.0)
        ld.aim(cam, (0, t.y + 0.02, t.z - 0.01), 32, 0.75, elev_deg=-14, lens=85)
        p = os.path.join(OUT, f"face_f_round{rnd}.png")
        ld.render(p)
        ld.aim(cam, (0, t.y + 0.02, t.z - 0.01), 0, 0.75, elev_deg=2, lens=85)
        p2 = os.path.join(OUT, f"face_f_front_round{rnd}.png")
        ld.render(p2)
        ld.set_keys({"Sex": 0.0})
        t = ld.head_target(0.0)
        ld.aim(cam, (0, t.y + 0.02, t.z - 0.01), 32, 0.80, elev_deg=-14, lens=85)
        p3 = os.path.join(OUT, f"face_m_round{rnd}.png")
        ld.render(p3)
        if ref:
            import subprocess
            rf = os.path.join(OUT, "reference_face_crop.png")
            subprocess.run(["python3", "-I", os.path.join(HERE, "compare_img.py"), "crop", ref, rf, "510,200,680,380", "680,720"], check=True)
            composite([rf, p, p2, p3], os.path.join(OUT, f"round{rnd}_face.png"), h=720,
                      labels=["reference (crop)", "ours feminine 3/4", "ours feminine front", "ours masculine 3/4"])


if __name__ == "__main__":
    main()
