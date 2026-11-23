"""Render previews of the modular base character (EEVEE, soft stylised shading, warm key + gentle cool rim, soft
contact shadow, reddish skin terminator, no outlines).

    /Applications/Blender.app/Contents/MacOS/Blender -b art3d/characters/base.blend -P art3d/characters/render_preview.py
    ... -- only=neutral,faces,grid,poses,seams     (optional subset)
"""
import bpy, sys, os, math, json
import numpy as np
from mathutils import Vector, Matrix

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import common  # noqa: E402

OUT = common.PREVIEW_DIR
RES = 700
SKIN = (0.93, 0.66, 0.52)


def skin_material(name, base, tex=None, tint=True):
    """Soft stylised skin: wrap-like smooth ramp with a reddish (fake subsurface) terminator, gentle cool rim."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    emi = nt.nodes.new("ShaderNodeEmission")
    diff = nt.nodes.new("ShaderNodeBsdfDiffuse")
    s2r = nt.nodes.new("ShaderNodeShaderToRGB")
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    mul = nt.nodes.new("ShaderNodeMix")
    mul.data_type = 'RGBA'
    mul.blend_type = 'MULTIPLY'
    mul.inputs[0].default_value = 1.0
    lw = nt.nodes.new("ShaderNodeLayerWeight")
    lw.inputs["Blend"].default_value = 0.30
    rramp = nt.nodes.new("ShaderNodeValToRGB")
    add = nt.nodes.new("ShaderNodeMix")
    add.data_type = 'RGBA'
    add.blend_type = 'ADD'
    add.inputs[0].default_value = 1.0
    diff.inputs["Color"].default_value = (1, 1, 1, 1)
    nt.links.new(diff.outputs[0], s2r.inputs[0])
    nt.links.new(s2r.outputs["Color"], ramp.inputs[0])
    e = ramp.color_ramp
    e.interpolation = 'B_SPLINE'
    stops = [(0.0, (0.46, 0.27, 0.40)), (0.16, (0.62, 0.30, 0.36)), (0.34, (0.88, 0.45, 0.40)),
             (0.55, (1.0, 0.76, 0.66)), (0.80, (1.0, 0.91, 0.82)), (1.0, (1.0, 0.95, 0.88))]
    e.elements[0].position, e.elements[0].color = stops[0][0], (*stops[0][1], 1)
    e.elements[1].position, e.elements[1].color = stops[-1][0], (*stops[-1][1], 1)
    for pos, col in stops[1:-1]:
        k = e.elements.new(pos)
        k.color = (*col, 1)
    if tex is not None:
        t = nt.nodes.new("ShaderNodeTexImage")
        t.image = tex
        if tint:
            tm = nt.nodes.new("ShaderNodeMix")
            tm.data_type = 'RGBA'
            tm.blend_type = 'MULTIPLY'
            tm.inputs[0].default_value = 1.0
            tm.inputs[7].default_value = (*base, 1)
            nt.links.new(t.outputs["Color"], tm.inputs[6])
            nt.links.new(tm.outputs[2], mul.inputs[7])
        else:
            nt.links.new(t.outputs["Color"], mul.inputs[7])
    else:
        mul.inputs[7].default_value = (*base, 1)
    nt.links.new(ramp.outputs["Color"], mul.inputs[6])
    nt.links.new(lw.outputs["Facing"], rramp.inputs[0])
    rr = rramp.color_ramp
    rr.interpolation = 'EASE'
    rr.elements[0].position, rr.elements[0].color = 0.0, (0.30, 0.75, 0.90, 1)
    rr.elements[1].position, rr.elements[1].color = 0.45, (0, 0, 0, 1)
    rmul = nt.nodes.new("ShaderNodeMix")
    rmul.data_type = 'RGBA'
    rmul.blend_type = 'MULTIPLY'
    rmul.inputs[0].default_value = 1.0
    rmul.inputs[7].default_value = (0.20, 0.20, 0.20, 1)
    nt.links.new(rramp.outputs["Color"], rmul.inputs[6])
    nt.links.new(mul.outputs[2], add.inputs[6])
    nt.links.new(rmul.outputs[2], add.inputs[7])
    nt.links.new(add.outputs[2], emi.inputs["Color"])
    nt.links.new(emi.outputs[0], out.inputs["Surface"])
    return m


def flat_material(name, col):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    d = nt.nodes.new("ShaderNodeBsdfDiffuse")
    d.inputs["Color"].default_value = (*col, 1)
    nt.links.new(d.outputs[0], out.inputs["Surface"])
    return m


def blob_shadow():
    me = bpy.data.meshes.new("blob")
    me.from_pydata([(-0.5, -0.5, 0), (0.5, -0.5, 0), (0.5, 0.5, 0), (-0.5, 0.5, 0)], [], [(0, 1, 2, 3)])
    ob = bpy.data.objects.new("blob", me)
    bpy.context.collection.objects.link(ob)
    ob.scale = (1.5, 1.0, 1.0)
    ob.location = (0, 0.0, 0.002)
    m = bpy.data.materials.new("Blob")
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    tc = nt.nodes.new("ShaderNodeTexCoord")
    gr = nt.nodes.new("ShaderNodeTexGradient")
    gr.gradient_type = 'SPHERICAL'
    mp = nt.nodes.new("ShaderNodeMapping")
    mp.inputs["Location"].default_value = (-0.5, -0.5, 0)
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].position = 0.0
    ramp.color_ramp.elements[0].color = (0, 0, 0, 1)
    ramp.color_ramp.elements[1].position = 1.0
    ramp.color_ramp.elements[1].color = (0.55, 0.55, 0.55, 1)
    ramp.color_ramp.interpolation = 'EASE'
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs["Color"].default_value = (0.28, 0.14, 0.24, 1)
    tr = nt.nodes.new("ShaderNodeBsdfTransparent")
    mix = nt.nodes.new("ShaderNodeMixShader")
    nt.links.new(tc.outputs["Generated"], mp.inputs["Vector"])
    nt.links.new(mp.outputs[0], gr.inputs["Vector"])
    nt.links.new(gr.outputs["Fac"], ramp.inputs[0])
    nt.links.new(ramp.outputs["Color"], mix.inputs[0])
    nt.links.new(tr.outputs[0], mix.inputs[1])
    nt.links.new(em.outputs[0], mix.inputs[2])
    nt.links.new(mix.outputs[0], out.inputs["Surface"])
    m.surface_render_method = 'DITHERED'
    me.materials.append(m)
    return ob


def face_texture():
    """Decal texture for the head's face rect (brows, lash lines, blush, lip tint) from the stored landmarks.
    The top-right quadrant holds the eyeball texture (iris), see eye_texture()."""
    N = 1024
    img = bpy.data.images.new("face_decal_test", N, N, alpha=True)
    img.colorspace_settings.name = "Linear Rec.709"
    px = np.zeros((N, N, 4), np.float32)
    px[:] = (1.0, 1.0, 1.0, 1)
    meta = json.load(open(os.path.join(common.EXPORT_DIR, "base_body_meta.json")))
    wr = meta["faceWorldRect"]
    lm = meta["landmarks"]
    yy, xx = np.mgrid[0:N, 0:N].astype(np.float32)
    X = wr["x0"] + (xx + 0.5) / N * 2 * (wr["x1"] - wr["x0"])
    Z = wr["z0"] + ((yy + 0.5) / N - 0.5) * 2 * (wr["z1"] - wr["z0"])
    ex, ez, er = lm["eye_x"], lm["eye"][2], lm["eye_r"]
    mz = lm["chin"] + 0.41 * (ez - lm["chin"])
    aa = 0.0005

    def paint(mask, col, alpha=1.0):
        a = np.clip(mask, 0, 1) * alpha
        for k in range(3):
            px[..., k] = px[..., k] * (1 - a) + col[k] * a

    def band(d, w=aa):
        return np.clip(0.5 - d / w, 0, 1)
    for sx in (-1, 1):
        d2 = ((X - sx * (ex + 0.012)) / 0.022) ** 2 + ((Z - (mz + 0.028)) / 0.015) ** 2
        paint(np.exp(-d2 * 1.3), (0.92, 0.38, 0.36), 0.35)                           # blush
        u = (X - sx * ex) * sx
        # Lash line on the measured lid aperture only (centre x 0.036, half width 0.0165, ray-tested on the neutral head).
        # It stops well short of the inner corner and is hard-masked to the eye area, so it can never cross the nose bridge.
        acx, acz, aa_, bb_ = 0.036, ez - 0.0011, 0.0165, 0.0105
        ua = (X - sx * acx) * sx
        lid = acz + bb_ * np.sqrt(np.clip(1 - (ua / aa_) ** 2, 0, 1)) + 0.0022 * np.clip(ua / aa_, -1, 1)
        eye_area = (ua > -0.95 * aa_) & (ua < 1.5 * aa_)
        paint(band(np.abs(Z - lid) - 0.0016) * (np.abs(ua) < aa_) * eye_area, (0.17, 0.09, 0.08), 0.9)
        flick = acz + 0.0095 + 0.0075 * np.clip((ua - 0.9 * aa_) / (0.6 * aa_), 0, 1)
        paint(band(np.abs(Z - flick) - 0.0012) * (ua > 0.9 * aa_) * (ua < 1.5 * aa_), (0.17, 0.09, 0.08), 0.9)
        # brow
        bx = (X - sx * (ex + 0.004)) * sx
        bz = ez + 0.046 + 0.006 * (1 - (bx / 0.026) ** 2) + 0.003 * bx / 0.026
        thick = 0.0048 * np.clip(1.0 - np.abs(bx / 0.028) ** 3, 0, 1) + 0.0008
        paint(band(np.abs(Z - bz) - thick) * (np.abs(bx) < 0.028), (0.26, 0.15, 0.10))
    # lip tint (the lips themselves are sculpted)
    s_ = np.clip(1 - (X / 0.024) ** 2, 0, 1)
    paint(band(np.maximum(np.abs(Z - (mz + 0.0045)) - 0.0075 * s_ ** 0.8, 0)) * (np.abs(X) < 0.024), (0.74, 0.28, 0.30), 0.55)
    paint(band(np.maximum(np.abs(Z - (mz - 0.0075)) - 0.0085 * s_ ** 0.7, 0)) * (np.abs(X) < 0.024), (0.86, 0.36, 0.38), 0.6)
    paint(band(np.abs(Z - mz) - 0.0004) * (np.abs(X) < 0.025), (0.40, 0.13, 0.15), 0.8)
    # eyeball texture in the top-right quadrant: sclera, iris, pupil, glint (left eye [0.5,0.75], right eye [0.75,1])
    for q in (0, 1):
        cu, cv = 0.625 + 0.25 * q, 0.875
        uu = (xx + 0.5) / N - cu
        vv = (yy + 0.5) / N - cv
        rr = np.sqrt(uu ** 2 + vv ** 2)
        inq = (np.abs(uu) <= 0.125) & (np.abs(vv) <= 0.125)
        for k in range(3):
            px[..., k] = np.where(inq, 0.97, px[..., k])
        paint(inq * band(rr - 0.078, 0.003), (0.24, 0.40, 0.42))
        paint(inq * band(rr - 0.046, 0.003), (0.06, 0.06, 0.07))
        g = np.sqrt((uu + 0.03) ** 2 + (vv - 0.035) ** 2)
        paint(inq * band(g - 0.016, 0.003), (1, 1, 1))
    img.pixels.foreach_set(px.ravel())
    img.pack()
    return img


def setup_scene():
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_EEVEE_NEXT'
    sc.render.resolution_x = sc.render.resolution_y = RES
    sc.render.film_transparent = True
    sc.view_settings.view_transform = 'Standard'
    sc.eevee.taa_render_samples = 32
    sc.eevee.use_shadows = True
    w = bpy.data.worlds.new("W")
    sc.world = w
    w.use_nodes = True
    w.node_tree.nodes["Background"].inputs[1].default_value = 0.0
    rig = bpy.data.objects.new("rig", None)
    sc.collection.objects.link(rig)
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    sc.collection.objects.link(cam)
    cam.data.type = 'ORTHO'
    cam.data.clip_end = 50
    cam.parent = rig
    sc.camera = cam
    sun = bpy.data.objects.new("key", bpy.data.lights.new("key", 'SUN'))
    sc.collection.objects.link(sun)
    sun.data.energy = 3.14
    sun.data.angle = math.radians(12)           # soft shadows
    sun.data.color = (1.0, 0.88, 0.68)
    sun.parent = rig
    sun.rotation_euler = (math.radians(58), 0, math.radians(-38))
    blob_shadow()
    return sc, rig, cam


PARTS = ["Mesh_Head", "Mesh_Torso", "Mesh_Arms", "Mesh_Hands", "Mesh_Legs", "Mesh_Feet", "Part_Nose", "Part_Ear_L", "Part_Ear_R",
         "Part_Eye_L", "Part_Eye_R"]


def parts():
    objs = [o for o in bpy.data.objects if o.type == 'MESH' and (o.name.startswith("Mesh_") or o.name.startswith("Part_"))]
    objs.sort(key=lambda o: (not o.name.startswith("Mesh_Head"), o.name))
    return objs


VARIANT_PREFIX = ("Part_Ear_Elf", "Part_Nose_", "Part_Tusk")


def set_visible(names):
    """Show the default parts plus `names`; hide every species variant that is not listed."""
    for o in parts():
        if o.name.startswith(VARIANT_PREFIX):
            o.hide_render = o.name not in names
            o.hide_viewport = o.hide_render
        elif o.name in ("Part_Ear_L", "Part_Ear_R", "Part_Nose"):
            hidden = False
            if o.name == "Part_Nose":
                hidden = any(n.startswith("Part_Nose_") for n in names)
            if o.name in ("Part_Ear_L", "Part_Ear_R"):
                hidden = any(n.startswith("Part_Ear_Elf") for n in names)
            o.hide_render = hidden


def prepare_body():
    arm = bpy.data.objects["Armature"]
    skin = skin_material("SoftSkin", SKIN)
    tex = face_texture()
    face = skin_material("SoftFace", SKIN, tex=tex)
    eye = skin_material("SoftEye", SKIN, tex=tex, tint=False)
    for ob in parts():
        for i in range(len(ob.data.materials)):
            if ob.name.startswith("Part_Eye"):
                ob.data.materials[i] = eye
            elif i == 1 or (ob.name == "Part_Nose" and i == 1):
                ob.data.materials[i] = face
            else:
                ob.data.materials[i] = skin
    bpy.context.scene.render.use_freestyle = False
    set_visible([])
    return parts(), arm


def use_flat_colours():
    cols = [(0.90, 0.35, 0.30), (0.35, 0.65, 0.90), (0.40, 0.80, 0.45), (0.95, 0.80, 0.30), (0.70, 0.45, 0.85),
            (0.95, 0.60, 0.25), (0.8, 0.8, 0.8), (0.8, 0.8, 0.8), (0.8, 0.8, 0.8)]
    pl = [o for o in parts() if o.name.startswith(('Mesh_', 'Part_Ear_L', 'Part_Ear_R', 'Part_Nose', 'Part_Eye'))]
    pl = [o for o in pl if not o.name.startswith(VARIANT_PREFIX)]
    for ob, c in zip(pl, cols * 2):
        m = flat_material("flat_" + ob.name, c)
        for i in range(len(ob.data.materials)):
            ob.data.materials[i] = m


CUR = {}
OFFS = None


def joint_off(name):
    """Joint offset (sum over active shapes) of a bone head, Blender armature space."""
    global OFFS
    if OFFS is None:
        OFFS = json.load(open(os.path.join(common.EXPORT_DIR, "joint_offsets.json")))["offsets"]
    off = Vector((0, 0, 0))
    for k, w in CUR.items():
        d = OFFS.get(k, {}).get(name)
        if d:
            off += Vector(d) * w
    return off


def reset(obs):
    for ob in obs:
        for kb in ob.data.shape_keys.key_blocks[1:]:
            kb.value = 0.0


def setk(obs, **kw):
    reset(obs)
    CUR.clear()
    CUR.update(kw)
    for ob in obs:
        kbs = ob.data.shape_keys.key_blocks
        for k, v in kw.items():
            if k in kbs:
                kbs[k].value = v
    bpy.context.view_layer.update()


def head_center_z(obs):
    dg = bpy.context.evaluated_depsgraph_get()
    head = obs[0].evaluated_get(dg)
    zs = [v.co.z for v in head.data.vertices]
    return max(zs) - 0.125


def shot(sc, rig, cam, path, az=0.0, center_z=0.9, scale=2.05, cx=0.0, pitch=7.0):
    rig.rotation_euler = (0, 0, az)
    p = math.radians(pitch)
    cam.rotation_euler = (math.pi / 2 - p, 0, 0)
    cam.location = (cx, -6 * math.cos(p), center_z + 6 * math.sin(p))
    cam.data.ortho_scale = scale
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)


def load_np(path):
    img = bpy.data.images.load(path)
    w, h = img.size
    a = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)
    bpy.data.images.remove(img)
    return a


def montage(paths, cols, out, crop=None):
    ims = [load_np(p) for p in paths]
    bgc = np.array((0.30, 0.45, 0.50), np.float32)
    ims = [np.concatenate([im[..., :3] * im[..., 3:4] + bgc * (1 - im[..., 3:4]), np.ones_like(im[..., 3:4])], axis=2) for im in ims]
    h, w = ims[0].shape[:2]
    rows = (len(ims) + cols - 1) // cols
    sheet = np.ones((rows * h, cols * w, 4), np.float32)
    sheet[..., :3] = (0.30, 0.45, 0.50)
    for i, im in enumerate(ims):
        r, c = divmod(i, cols)
        sheet[(rows - 1 - r) * h:(rows - r) * h, c * w:(c + 1) * w] = im
    img = bpy.data.images.new("sheet", cols * w, rows * h, alpha=True)
    img.pixels.foreach_set(sheet.ravel())
    img.filepath_raw = out
    img.file_format = 'PNG'
    img.save()
    bpy.data.images.remove(img)
    print("wrote", out)


# ------------------------------------------------------------------ poses
def rot_bone(arm, name, axis, deg, pivot=None):
    """Rotate a pose bone about a world-aligned axis through its (shape-adjusted) head.  The mesh already carries the
    blend shape, so the joint offset only moves the pivot, exactly like re-computing the bind poses in Unity."""
    pb = arm.pose.bones[name]
    bpy.context.view_layer.update()
    if pivot is None:
        K = pb.matrix @ pb.bone.matrix_local.inverted()
        head = arm.matrix_world @ (K @ (pb.bone.head_local + joint_off(name)))
    else:
        head = Vector(pivot)
    R = Matrix.Rotation(math.radians(deg), 4, axis)
    T = Matrix.Translation(head) @ R @ Matrix.Translation(-head)
    pb.matrix = arm.matrix_world.inverted() @ (T @ (arm.matrix_world @ pb.matrix))
    bpy.context.view_layer.update()


def clear_pose(arm):
    for pb in arm.pose.bones:
        pb.location = (0, 0, 0)
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.rotation_euler = (0, 0, 0)
    bpy.context.view_layer.update()


def pose_arms_down(arm):
    clear_pose(arm)
    for sd, sg in (("Left", 1), ("Right", -1)):
        rot_bone(arm, f"{sd}UpperArm", 'Y', sg * 9)
        rot_bone(arm, f"{sd}LowerArm", 'X', -10)
        rot_bone(arm, f"{sd}Shoulder", 'Y', sg * 4)


def pose_walk(arm):
    pose_arms_down(arm)
    rot_bone(arm, "LeftUpperLeg", 'X', -32)
    rot_bone(arm, "LeftLowerLeg", 'X', 8)
    rot_bone(arm, "LeftFoot", 'X', 20)
    rot_bone(arm, "RightUpperLeg", 'X', 18)
    rot_bone(arm, "RightLowerLeg", 'X', 38)
    rot_bone(arm, "RightFoot", 'X', -25)
    rot_bone(arm, "LeftUpperArm", 'X', 24)
    rot_bone(arm, "RightUpperArm", 'X', -24)
    rot_bone(arm, "RightLowerArm", 'X', -25)
    rot_bone(arm, "Spine", 'Z', 6)
    rot_bone(arm, "Chest", 'Z', 6)


def move_world(arm, name, d):
    pb = arm.pose.bones[name]
    bpy.context.view_layer.update()
    M = pb.matrix.copy()
    M.translation = M.translation + Vector(d)
    pb.matrix = M
    bpy.context.view_layer.update()


def pose_sit(arm):
    pose_arms_down(arm)
    hips = arm.pose.bones["Hips"]
    move_world(arm, "Hips", (0, 0, -0.43))
    for sd in ("Left", "Right"):
        rot_bone(arm, f"{sd}UpperLeg", 'X', -88)
        rot_bone(arm, f"{sd}LowerLeg", 'X', 86)
        rot_bone(arm, f"{sd}Foot", 'X', -5)
        rot_bone(arm, f"{sd}LowerArm", 'X', -55)
    rot_bone(arm, "Spine", 'X', 4)
    # put the soles on the floor
    dg = bpy.context.evaluated_depsgraph_get()
    feet = bpy.data.objects["Mesh_Feet"].evaluated_get(dg)
    minz = min(v.co.z for v in feet.data.vertices)
    move_world(arm, "Hips", (0, 0, -minz))


def seat_height():
    dg = bpy.context.evaluated_depsgraph_get()
    t = bpy.data.objects["Mesh_Torso"].evaluated_get(dg)
    return min(v.co.z for v in t.data.vertices)


SPECIES_IDS = ["human", "elf", "dwarf", "halfling", "orc"]
SPECIES_BODIES = [
    ("average", {}), ("thin", dict(Thin=0.7)), ("heavy", dict(Heavy=0.8, Belly=0.4)), ("muscular", dict(Muscle=0.8, Chest_Muscle=0.5)),
    ("old", dict(Age_Old=0.9)), ("round_face", dict(Cheeks_Full=0.8, Face_Short=0.5, Eye_Big=0.4)),
    ("long_face", dict(Face_Long=0.7, Chin_Pointed=0.5, Cheekbones=0.6)), ("strong_jaw", dict(Jaw_Square=0.7, Brow_Ridge=0.6, Chin_Big=0.4)),
]

BODIES = [
    ("tall_thin", dict(Thin=0.8, Height_Legs=1.0, Neck_Long=0.6, Face_Long=0.5)),
    ("short_heavy", dict(Heavy=0.9, Belly=0.4, Face_Short=0.6, Cheeks_Full=0.7, Legs_Thick=0.3)),
    ("muscular", dict(Muscle=1.0, Shoulders=0.8, Chest_Muscle=0.8, Jaw_Square=0.8, Arms_Thick=0.3, Brow_Ridge=0.7)),
    ("old_man", dict(Age_Old=1.0, Thin=0.3, Cheekbones=0.6, Chin_Long=0.4, Forehead_High=0.5)),
    ("old_woman", dict(Sex=1.0, Age_Old=0.9, Heavy=0.3, Belly=0.3, Cheeks_Full=0.3)),
    ("curvy_woman", dict(Sex=1.0, Breast=0.8, Waist_Slim=0.8, Hips=0.8, Butt=0.7, Lips_Full=0.7, Eye_Big=0.7)),
    ("broad_shoulders", dict(Shoulders=1.0, Waist_Slim=0.6, Chest_Muscle=0.5, Height_Legs=0.4, Jaw_Wide=0.4)),
    ("child", dict(Child=1.0, Eye_Big=0.8, Cheeks_Full=0.5)),
    ("long_face", dict(Face_Long=1.0, Chin_Long=0.7, Chin_Pointed=0.4, Nose_Bridge=0.5, Ears_Back=0.6, Thin=0.3)),
    ("round_face", dict(Face_Short=0.8, Cheeks_Full=1.0, Jaw_Wide=0.4, Eye_Big=0.5, Lips_Full=0.5, Heavy=0.4)),
    ("slim_woman", dict(Sex=1.0, Thin=0.6, Height_Legs=0.8, Neck_Long=0.8, Chin_Pointed=0.7, Cheekbones=0.7, Eye_Spacing=0.5)),
    ("stout_woman", dict(Sex=1.0, Heavy=0.8, Breast=0.6, Hips=0.6, Butt=0.5, Waist_Wide=0.4, Face_Short=0.4, Mouth_Wide=0.4)),
]

FACES = [
    ("round_eyes_small_chin", dict(Sex=0.6, Eye_Round=1, Eye_Big=0.6, Chin_Small=0.7, Lips_Pout=0.6, Cheeks_Full=0.5)),
    ("almond_tiltup_bow", dict(Sex=1, Eye_Almond=1, Eye_TiltUp=0.8, Chin_Pointed=0.6, Lips_CupidBow=1, Lips_UpperFull=0.5, Cheekbones=0.7)),
    ("hooded_deep_square", dict(Eye_Hooded=1, Eye_Deep=0.8, Brow_Ridge=0.8, Chin_Big=0.7, Jaw_Square=0.8, Lips_Thin=0.7, Mouth_CornersDown=0.6)),
    ("monolid_wide_chin", dict(Eye_Monolid=1, Eye_Narrow=0.5, Chin_Wide=0.6, Chin_Back=0.4, Lips_LowerFull=0.6, Face_Short=0.4)),
    ("tiltdown_soft_full", dict(Sex=1, Eye_TiltDown=1, Eye_Big=0.7, Lips_Full=0.8, Mouth_CornersUp=0.5, Chin_Narrow=0.5, Face_Long=0.3)),
    ("protruding_forward_chin", dict(Eye_Protrude=1, Eye_Spacing=0.8, Chin_Forward=1, Chin_Long=0.5, Mouth_Wide=0.6, Nose_Bridge=0.6)),
    ("narrow_thin_lips", dict(Eye_Narrow=1, Eye_Height=0.6, Lips_Thin=1, Mouth_Narrow=0.8, Face_Long=0.8, Chin_Pointed=0.4, Cheekbones=0.8)),
    ("full_lips_cleft", dict(Lips_UpperFull=1, Lips_LowerFull=1, Chin_Cleft=1, Chin_Big=0.4, Jaw_Wide=0.5, Mouth_Wide=0.5, Eye_Almond=0.5)),
    ("child_round", dict(Child=1, Eye_Round=1, Eye_Big=1, Chin_Small=1, Cheeks_Full=1, Lips_Pout=0.5)),
    ("old_hooded_corners_down", dict(Age_Old=1, Eye_Hooded=1, Eye_Deep=0.5, Chin_Cleft=0.5, Mouth_CornersDown=1, Lips_Thin=0.6, Cheekbones=0.5)),
    ("heart_face_pout", dict(Sex=1, Chin_Narrow=1, Chin_Pointed=0.6, Forehead_High=0.6, Eye_Round=0.6, Eye_Spacing=0.6, Lips_Pout=0.8, Mouth_CornersUp=0.6)),
    ("strong_square_brow", dict(Jaw_Square=1, Chin_Wide=0.8, Eye_Narrow=0.4, Eye_TiltDown=0.4, Brow_Ridge=1, Lips_LowerFull=0.3, Mouth_Wide=0.7, Muscle=0.5)),
]


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    only = None
    for a in argv:
        if a.startswith("only="):
            only = a[5:].split(",")
    want = lambda k: not only or k in only
    os.makedirs(OUT, exist_ok=True)
    sc, rig, cam = setup_scene()
    obs, arm = prepare_body()
    tmp = os.path.join(OUT, "_tmp")
    os.makedirs(tmp, exist_ok=True)
    arm.data.pose_position = 'POSE'
    clear_pose(arm)

    def tag(p):
        return os.path.join(tmp, p)

    if want("neutral"):
        for nm, kw, cz in (("masculine", {}, 0.88), ("feminine", {"Sex": 1.0}, 0.84)):
            setk(obs, **kw)
            pose_arms_down(arm)
            ps = []
            for v, az in (("front", 0.0), ("q34", math.radians(40)), ("side", math.radians(90))):
                p = tag(f"{nm}_{v}.png")
                shot(sc, rig, cam, p, az=az, center_z=cz, scale=2.0)
                ps.append(p)
            montage(ps, 3, os.path.join(OUT, f"neutral_{nm}_turnaround.png"))
        clear_pose(arm)
        setk(obs)
        shot(sc, rig, cam, os.path.join(OUT, "tpose_front.png"), az=0, center_z=0.9, scale=2.1)
    if want("grid"):
        ps = []
        pose_arms_down(arm)
        for nm, kw in BODIES:
            setk(obs, **kw)
            p = tag(f"grid_{nm}.png")
            shot(sc, rig, cam, p, az=math.radians(25), center_z=0.88, scale=2.05)
            ps.append(p)
        montage(ps, 4, os.path.join(OUT, "variety_grid.png"))
        ps = []
        for nm, kw in BODIES:
            setk(obs, **kw)
            p = tag(f"gridside_{nm}.png")
            shot(sc, rig, cam, p, az=math.radians(90), center_z=0.88, scale=2.05)
            ps.append(p)
        montage(ps, 4, os.path.join(OUT, "variety_grid_side.png"))
        with open(os.path.join(OUT, "variety_grid.json"), "w") as fh:
            json.dump([{"name": n, "shapes": kw} for n, kw in BODIES], fh, indent=1)
        clear_pose(arm)
    if want("faces"):
        sc.render.resolution_x = sc.render.resolution_y = 520
        clear_pose(arm)
        for view, az, fn in (("front", 0.0, "faces_front_grid.png"), ("q34", math.radians(38), "faces_q34_grid.png")):
            ps = []
            for nm, kw in FACES:
                setk(obs, **kw)
                cz = head_center_z(obs)
                p = tag(f"face_{view}_{nm}.png")
                shot(sc, rig, cam, p, az=az, center_z=cz, scale=0.34, pitch=0)
                ps.append(p)
            montage(ps, 4, os.path.join(OUT, fn))
        setk(obs)
        with open(os.path.join(OUT, "faces_grid.json"), "w") as fh:
            json.dump([{"name": n, "shapes": kw} for n, kw in FACES], fh, indent=1)
        sc.render.resolution_x = sc.render.resolution_y = RES
    if want("seams"):
        sc.render.resolution_x = sc.render.resolution_y = 520
        ps = []
        for kw, label in (({}, "neutral"), ({"Sex": 1.0, "Neck_Long": 0.6, "Muscle": 0.4}, "mixed"), ({"Heavy": 1.0, "Age_Old": 0.7}, "heavy_old")):
            setk(obs, **kw)
            pose_arms_down(arm)
            # neck/shoulder, wrist (arm raised to the camera is not needed: arms down puts wrists near the hips), waist/hip, ankle
            dg = bpy.context.evaluated_depsgraph_get()
            def wpos(bone, tail=False):
                pb = arm.pose.bones[bone]
                return arm.matrix_world @ (pb.tail if tail else pb.head)
            neck = wpos("Neck")
            wrist = wpos("LeftHand")
            ankle = wpos("LeftFoot")
            hip = wpos("Hips")
            for nm, pt, az, sc_ in (("neck", neck, 25, 0.30), ("wrist", wrist, 40, 0.20), ("hip", hip + Vector((0, 0, -0.04)), 30, 0.46), ("ankle", ankle + Vector((0, 0, 0.04)), 35, 0.30)):
                p = tag(f"seam_{label}_{nm}.png")
                shot(sc, rig, cam, p, az=math.radians(az), center_z=pt.z, scale=sc_, cx=pt.x * math.cos(math.radians(az)), pitch=0)
                ps.append(p)
        montage(ps, 4, os.path.join(OUT, "seams_closeups.png"))
        clear_pose(arm)
        setk(obs)
        use_flat_colours()
        ps = []
        pose_arms_down(arm)
        for v, az in (("front", 0.0), ("side", math.radians(90))):
            p = tag(f"parts_{v}.png")
            sc.render.resolution_x = sc.render.resolution_y = RES
            shot(sc, rig, cam, p, az=az, center_z=0.88, scale=2.0)
            ps.append(p)
        montage(ps, 2, os.path.join(OUT, "parts_colour_coded.png"))
        clear_pose(arm)
        prepare_body_materials_again()
        sc.render.resolution_x = sc.render.resolution_y = RES
    if want("species"):
        presets = json.load(open(os.path.join(common.EXPORT_DIR, "species_presets.json")))
        sc.render.resolution_x = sc.render.resolution_y = 560
        mats = {}
        for sp in SPECIES_IDS:
            skin_c = tuple(presets[sp]["skin"][0])
            tex = bpy.data.images["face_decal_test"]
            mats[sp] = (skin_material("Skin_" + sp, skin_c), skin_material("Face_" + sp, skin_c, tex=tex), skin_material("Eye_" + sp, SKIN, tex=tex, tint=False))

        tusk_mat = skin_material("Tusk", (0.96, 0.93, 0.82))

        def dress(sp):
            pr = presets[sp]
            names = pr["parts"]["ears"] + pr["parts"]["nose"] + pr["parts"]["extra"]
            set_visible([n for n in names if n.startswith(VARIANT_PREFIX)])
            for o in parts():
                for i in range(len(o.data.materials)):
                    if o.name.startswith("Part_Eye"):
                        o.data.materials[i] = mats[sp][2]
                    elif o.name.startswith("Part_Tusk"):
                        o.data.materials[i] = tusk_mat
                    elif i == 1:
                        o.data.materials[i] = mats[sp][1]
                    else:
                        o.data.materials[i] = mats[sp][0]
        for view, az, fn in (("front", 0.0, "species_neutral_front.png"), ("q34", math.radians(35), "species_neutral_q34.png")):
            ps = []
            for sexn, sexw in (("m", 0.0), ("f", 1.0)):
                for sp in SPECIES_IDS:
                    dress(sp)
                    kw = dict(presets[sp]["shapes"])
                    if sexw:
                        kw["Sex"] = 1.0
                    setk(obs, **kw)
                    sc_ = presets[sp]["rootScaleF" if sexw else "rootScaleM"]
                    arm.scale = (sc_, sc_, sc_)
                    clear_pose(arm)
                    pose_arms_down(arm)
                    p = tag(f"sp_{view}_{sexn}_{sp}.png")
                    shot(sc, rig, cam, p, az=az, center_z=1.08, scale=2.4)
                    ps.append(p)
            montage(ps, 5, os.path.join(OUT, fn))
        ps = []
        for sp in SPECIES_IDS:
            dress(sp)
            setk(obs, **dict(presets[sp]["shapes"]))
            sc_ = presets[sp]["rootScaleM"]
            arm.scale = (sc_, sc_, sc_)
            clear_pose(arm)
            hz = head_center_z(obs) * sc_
            p = tag(f"spf_{sp}.png")
            shot(sc, rig, cam, p, az=math.radians(32), center_z=hz, scale=0.34 * max(sc_, 0.9), pitch=0)
            ps.append(p)
        montage(ps, 5, os.path.join(OUT, "species_faces.png"))
        # a variety grid per species (3/4 view, 8 people each; mixes body, age and face keys, masculine and feminine)
        for sp in SPECIES_IDS:
            dress(sp)
            ps = []
            for i, (nm, kw0) in enumerate(SPECIES_BODIES):
                kw = dict(presets[sp]["shapes"])
                kw.update(kw0)
                if i % 2 == 1:
                    kw["Sex"] = 1.0
                setk(obs, **kw)
                sc_ = presets[sp]["rootScaleF" if kw.get("Sex") else "rootScaleM"]
                arm.scale = (sc_, sc_, sc_)
                clear_pose(arm)
                pose_arms_down(arm)
                p = tag(f"spv_{sp}_{nm}.png")
                hh = presets[sp]["heightM"] * (0.943 if kw.get("Sex") else 1.0)
                shot(sc, rig, cam, p, az=math.radians(28), center_z=0.5 * hh, scale=hh * 1.12 + 0.2)
                ps.append(p)
            montage(ps, 4, os.path.join(OUT, f"species_variety_{sp}.png"))
        arm.scale = (1, 1, 1)
        set_visible([])
        sc.render.resolution_x = sc.render.resolution_y = RES
        prepare_body_materials_again()
        clear_pose(arm)
    if want("poses"):
        stool = bpy.data.objects.new("stool", bpy.data.meshes.new("stool"))
        import bmesh
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1.0)
        bm.to_mesh(stool.data)
        bm.free()
        stool.scale = (0.40, 0.34, 0.04)
        stool.location = (0, 0.0, 0.46)
        stool.data.materials.append(flat_material("Stool", (0.45, 0.32, 0.20)))
        bpy.context.collection.objects.link(stool)
        ps = []
        for tg, kw, fn in (("armsdown", {}, pose_arms_down), ("walk", {}, pose_walk), ("sit", {}, pose_sit),
                           ("armsdown_f", {"Sex": 1.0}, pose_arms_down), ("walk_f", {"Sex": 1.0}, pose_walk),
                           ("sit_f", {"Sex": 1.0}, pose_sit)):
            setk(obs, **kw)
            clear_pose(arm)
            fn(arm)
            stool.hide_render = tg not in ("sit", "sit_f")
            if not stool.hide_render:
                stool.location.z = seat_height() - 0.02
                stool.location.y = 0.0
            p = tag(f"pose_{tg}.png")
            shot(sc, rig, cam, p, az=math.radians(60), center_z=0.88, scale=2.05)
            ps.append(p)
        montage(ps, 3, os.path.join(OUT, "poses.png"))
    for f in os.listdir(tmp):
        os.remove(os.path.join(tmp, f))
    os.rmdir(tmp)


def prepare_body_materials_again():
    skin = skin_material("SoftSkin2", SKIN)
    tex = bpy.data.images["face_decal_test"]
    face = skin_material("SoftFace2", SKIN, tex=tex)
    eye = skin_material("SoftEye2", SKIN, tex=tex, tint=False)
    for ob in parts():
        for i in range(len(ob.data.materials)):
            if ob.name.startswith("Part_Eye"):
                ob.data.materials[i] = eye
            elif i == 1:
                ob.data.materials[i] = face
            else:
                ob.data.materials[i] = skin


if __name__ == "__main__":
    main()
