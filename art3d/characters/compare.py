"""Reference comparison round (G9 plan section 5): measures, score table, render set, composites.

    Blender -b art3d/characters/base.blend -P art3d/characters/compare.py -- round=<N> [prev=<N-1>] [only=measure,renders] [note="..."]

* measure.py numbers for the neutral F (Sex 1) and M (Sex 0), scored against compare_targets.json (body_face group; the
  Loomis group is scored by loomis_overlay.py), written to previews/compare/measure_round<N>.json and appended to report.md.
* renders through lookdev.py (stage unchanged between rounds): ref_body (F, reference-like stance, 50 mm, low camera),
  ref_face (F, head turned like the reference, 85 mm), front_face / q34_face (F and M), front_body / side_body (F and M, ortho).
* composites (compare_img.py): round<N>_body.png = reference | ref_body | previous; round<N>_face.png = reference crop |
  ref_face | front_face | previous; round<N>_overlay_face.png = ref_face at 50 % over the reference crop, aligned on the eyes.
The reference image is expected at previews/compare/reference.png (copied in by hand from the user's images; never edited).
"""
import bpy, os, sys, json, math, subprocess
import numpy as np
from mathutils import Vector, Matrix
from bpy_extras.object_utils import world_to_camera_view

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import common, lookdev as ld, measure as ms  # noqa: E402

OUT = os.path.join(common.PREVIEW_DIR, "compare")
REF = os.path.join(OUT, "reference.png")
REFLM = json.load(open(os.path.join(OUT, "plan", "reference_landmarks.json")))
REF_FACE_BOX = (500, 180, 680, 360)          # reference crop used for ref_face (720 x 720)


def img_tool(*args):
    subprocess.run(["python3", "-I", os.path.join(HERE, "compare_img.py"), *map(str, args)], check=True)


def rot_world(arm, bone, axis, deg):
    """rotate a pose bone about a world axis through its head (rest-pose armature space = world here)."""
    pb = arm.pose.bones[bone]
    bpy.context.view_layer.update()
    h = pb.head.copy()
    R = Matrix.Translation(h) @ Matrix.Rotation(math.radians(deg), 4, Vector(axis)) @ Matrix.Translation(-h)
    pb.matrix = R @ pb.matrix
    bpy.context.view_layer.update()


def pose_ref(arm, sex=1.0):
    """reference-like stance (G9 5.1, simplified): legs apart, weight back, torso and head turned, arms relaxed down and out."""
    ld.clear_pose(arm)
    arm.data.pose_position = 'POSE'
    bpy.context.view_layer.update()
    rot_world(arm, "LeftUpperLeg", (0, 1, 0), -12)
    rot_world(arm, "RightUpperLeg", (0, 1, 0), 12)
    rot_world(arm, "LeftUpperLeg", (1, 0, 0), -8)
    rot_world(arm, "Spine", (0, 0, 1), -8)
    rot_world(arm, "Chest", (0, 0, 1), -8)
    rot_world(arm, "Neck", (0, 0, 1), -16)            # head turned to her right (about 38 degrees with the torso)
    rot_world(arm, "Head", (0, 0, 1), -18)
    rot_world(arm, "Head", (1, 0, 0), 12)             # tipped back
    rot_world(arm, "Head", (0, 1, 0), -8)
    arms_relaxed(arm)


def arms_relaxed(arm, deg=24):
    """bring the A-pose arms down towards the body (world rotation about the forward axis)."""
    for side, sg in (("Left", 1), ("Right", -1)):
        rot_world(arm, f"{side}UpperArm", (0, 1, 0), sg * deg)
        rot_world(arm, f"{side}LowerArm", (1, 0, 0), -10)


def project(cam, pts):
    sc = bpy.context.scene
    W, H = sc.render.resolution_x, sc.render.resolution_y
    out = []
    for p in pts:
        v = world_to_camera_view(sc, cam, Vector(p))
        out.append((v.x * W, (1 - v.y) * H))
    return out


def eval_pts(name):
    dg = bpy.context.evaluated_depsgraph_get()
    o = bpy.data.objects[name].evaluated_get(dg)
    me = o.to_mesh()
    P = np.array([(o.matrix_world @ v.co)[:] for v in me.vertices])
    o.to_mesh_clear()
    return P


def write_scores(rnd, res, T, note):
    lines = [f"\n## Round {rnd}" + (f": {note}" if note else ""), "",
             "| metric | ours F | target F | g F | ours M | target M | g M | w |", "|---|---|---|---|---|---|---|---|"]
    rowsF, wmF = ms.score({"body_face": res["F"], "loomis": {}}, {"body_face": T["body_face"], "loomis": {}}, "F")
    rowsM, wmM = ms.score({"body_face": res["M"], "loomis": {}}, {"body_face": T["body_face"], "loomis": {}}, "M")
    for a, b in zip(rowsF, rowsM):
        lines.append(f"| {a[1]} | {a[2]} | {a[3]} | {'-' if a[6] is None else a[6]} | {b[2]} | {b[3]} | {'-' if b[6] is None else b[6]} | {a[5]} |")
    lines.append(f"| **weighted mean g (body/face rows)** | | | **{wmF}** | | | **{wmM}** | |")
    with open(os.path.join(OUT, "report.md"), "a") as fh:
        fh.write("\n".join(lines) + "\n")
    return wmF, wmM


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    rnd, prev, only, note = "0", None, None, ""
    for a in argv:
        if a.startswith("round="):
            rnd = a[6:]
        elif a.startswith("prev="):
            prev = a[5:]
        elif a.startswith("only="):
            only = a[5:].split(",")
        elif a.startswith("note="):
            note = a[5:]
    want = lambda k: not only or k in only
    os.makedirs(OUT, exist_ok=True)
    T = json.load(open(os.path.join(HERE, "compare_targets.json")))
    if want("measure"):
        res = {}
        for tag, sex in (("F", 1.0), ("M", 0.0)):
            bf, lo, geo = ms.measure({"Sex": sex})
            res[tag] = bf
        wm = write_scores(rnd, res, T, note)
        json.dump(dict(feminine=res["F"], masculine=res["M"], weightedMeanG=dict(F=wm[0], M=wm[1])),
                  open(os.path.join(OUT, f"measure_round{rnd}.json"), "w"), indent=1)
        print("weighted mean g F/M", wm)
    if not want("renders"):
        return
    arm = bpy.data.objects["Armature"]
    ld.show_only(ld.BASE_VISIBLE)
    sc, cam = ld.setup(res=(1140, 1244), centre=(0, 0, 1.0), figure_scale=1.0)
    ld.assign("T2_fair")
    R = lambda n: os.path.join(OUT, f"{n}_round{rnd}.png")
    # ---- ref_body
    ld.set_keys({"Sex": 1.0})
    pose_ref(arm)
    hair = placeholder_hair("f")
    hair.parent = arm
    hair.parent_type = 'BONE'
    hair.parent_bone = "Head"
    hair.matrix_parent_inverse = (arm.matrix_world @ arm.pose.bones["Head"].matrix).inverted()
    H = 1.65
    ld.aim(cam, (0, 0, H * 0.50), -22, 3.0, elev_deg=0.0, lens=50)
    cam.location.z = 0.55 * H
    ld.render(R("ref_body"))
    # ---- ref_face (eyes converge on the camera)
    sc.render.resolution_x = sc.render.resolution_y = 720
    t = ld.head_target(0.0)
    ld.aim(cam, (t.x, t.y + 0.02, t.z - 0.03), -6, 0.80, elev_deg=-14, lens=85)
    look_at_camera(arm, cam)
    ld.render(R("ref_face"))
    eyes_ours = project(cam, [eval_pts("Part_Eye_R").mean(axis=0), eval_pts("Part_Eye_L").mean(axis=0)])
    # ---- front / q34 faces, front / side bodies (rest pose)
    for tag, sex in (("f", 1.0), ("m", 0.0)):
        ld.set_keys({"Sex": sex})
        ld.clear_pose(arm)
        arm.data.pose_position = 'POSE'
        bpy.context.view_layer.update()
        placeholder_hair(tag)
        sc.render.resolution_x, sc.render.resolution_y = 680, 720
        cam.data.type = 'PERSP'
        t = ld.head_target(0.0)
        for name, az in (("front_face", 0), ("q34_face", 32)):
            ld.aim(cam, (0, t.y + 0.02, t.z - 0.03), az, 0.80, elev_deg=2, lens=85)
            look_at_camera(arm, cam)
            ld.render(R(f"{name}_{tag}"))
        sc.render.resolution_x, sc.render.resolution_y = 700, 1244
        Hh = 1.65 if sex else 1.75
        cam.data.type = 'ORTHO'
        cam.data.ortho_scale = Hh * 1.08
        for name, az in (("front_body", 0), ("side_body", 90)):
            ld.aim(cam, (0, 0, Hh * 0.5), az, 6.0, elev_deg=0, lens=50)
            ld.render(R(f"{name}_{tag}"))
        cam.data.type = 'PERSP'
    ld.clear_pose(arm)
    # ---- composites
    if os.path.exists(REF):
        prevp = lambda n: os.path.join(OUT, f"{n}_round{prev}.png") if prev and os.path.exists(os.path.join(OUT, f"{n}_round{prev}.png")) else None
        body = [REF, R("ref_body")] + ([prevp("ref_body")] if prevp("ref_body") else [])
        img_tool("compose", os.path.join(OUT, f"round{rnd}_body.png"), 1000, json.dumps(["reference", f"ref_body round {rnd}", f"round {prev}"]), *body)
        crop = os.path.join(OUT, "reference_face_crop.png")
        img_tool("crop", REF, crop, ",".join(map(str, REF_FACE_BOX)), "720,720")
        face = [crop, R("ref_face"), R("front_face_f"), R("front_face_m")] + ([prevp("ref_face")] if prevp("ref_face") else [])
        img_tool("compose", os.path.join(OUT, f"round{rnd}_face.png"), 720,
                 json.dumps(["reference (crop)", f"ref_face round {rnd}", "front F", "front M", f"round {prev}"]), *face)
        x0, y0, x1, y1 = REF_FACE_BOX
        k = 720 / (x1 - x0)
        fl = REFLM["face"]
        ne = [(fl["near_eye_inner"][i] + fl["near_eye_outer"][i]) / 2 for i in range(2)]
        fe = [(fl["far_eye_inner"][i] + fl["far_eye_outer"][i]) / 2 for i in range(2)]
        ref_eyes = [((p[0] - x0) * k, (p[1] - y0) * k) for p in (fe, ne)]
        boxes = [["eyes", [150, 220, 470, 380]], ["eye (near)", [280, 230, 440, 360]], ["nose", [170, 260, 340, 430]],
                 ["mouth", [170, 380, 400, 510]], ["face", [100, 120, 540, 580]]]
        img_tool("overlay", crop, R("ref_face"), os.path.join(OUT, f"round{rnd}_overlay_face.png"), json.dumps(ref_eyes), json.dumps(eyes_ours),
                 json.dumps(boxes))


def placeholder_hair(sex):
    """a simple bob-length hair mass grown from the current head (evaluated shape), dark brown: faces are judged as people
    (Gate 1).  Not a game asset."""
    old = bpy.data.objects.get("Placeholder_Hair")
    if old:
        bpy.data.objects.remove(old, do_unlink=True)
    dg = bpy.context.evaluated_depsgraph_get()
    o = bpy.data.objects["Mesh_Head"].evaluated_get(dg)
    me = bpy.data.meshes.new_from_object(o)
    P = np.array([v.co[:] for v in me.vertices])
    top = P[:, 2].max()
    front = P[P[:, 1] < P[:, 1].mean() - 0.03]
    chin = front[np.abs(front[:, 0]) < 0.02][:, 2].min()
    hh = top - chin
    yc = float(P[:, 1].mean())
    import bmesh
    bm = bmesh.new()
    bm.from_mesh(me)
    dead = []
    for f in bm.faces:
        c = f.calc_center_median()
        hair_line = top - (0.16 if c.y < yc - 0.04 else (0.40 if c.y < yc + 0.01 else 0.62)) * hh
        if not (c.z > hair_line and f.normal.z > -0.6 and abs(c.x) < 0.2):
            dead.append(f)
    bmesh.ops.delete(bm, geom=dead, context='FACES')
    for v in bm.verts:
        v.co += v.normal * 0.007
    hm = bpy.data.meshes.new("Placeholder_Hair")
    bm.to_mesh(hm)
    bm.free()
    bpy.data.meshes.remove(me)
    ob = bpy.data.objects.new("Placeholder_Hair", hm)
    bpy.context.scene.collection.objects.link(ob)
    ob.matrix_world = bpy.data.objects["Mesh_Head"].matrix_world
    for p in hm.polygons:
        p.use_smooth = True
    sd = ob.modifiers.new("solid", 'SOLIDIFY')
    sd.thickness = 0.006
    ss = ob.modifiers.new("sub", 'SUBSURF')
    ss.levels = ss.render_levels = 1
    m = ld.flat_material("LD_PlaceholderHair", (0.16, 0.09, 0.055), 0.38)
    hm.materials.append(m)
    return ob


def look_at_camera(arm, cam):
    """eye bones converge on the camera (G9 WP1)."""
    bpy.context.view_layer.update()
    for b in ("LeftEye", "RightEye"):
        pb = arm.pose.bones[b]
        pb.rotation_mode = 'XYZ'
        pb.rotation_euler = (0, 0, 0)
        bpy.context.view_layer.update()
        head = arm.matrix_world @ pb.head
        tail = arm.matrix_world @ pb.tail
        cur = (tail - head).normalized()
        want = (cam.location - head).normalized()
        q = cur.rotation_difference(want)
        pb.matrix = Matrix.Translation(pb.head) @ q.to_matrix().to_4x4() @ Matrix.Translation(-pb.head) @ pb.matrix
    bpy.context.view_layer.update()


if __name__ == "__main__":
    main()
