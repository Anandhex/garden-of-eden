"""EEVEE look-development stage for the characters (2026-11 face rework), matching the art-direction reference staging:
warm key, cool blue-teal rim, dark teal gradient backdrop with a soft contact shadow, SSS skin with the baked texture sets,
eyeballs under a glossy cornea, alpha-tested lash/brow/hair cards.  Imported by render_faces.py, parts/render_people.py etc.
"""
import bpy, os, sys, math, json
import numpy as np
from mathutils import Vector, Matrix

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import common  # noqa: E402

TEX = os.path.join(common.EXPORT_DIR, "textures")
SKIN = os.path.join(TEX, "skin")
TONES = json.load(open(os.path.join(SKIN, "skin_tones.json"))) if os.path.exists(os.path.join(SKIN, "skin_tones.json")) else {}


def srgb(c):
    c = np.asarray(c, float)
    return tuple(np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4).tolist())


def img(path, colour=True):
    name = os.path.basename(path)
    im = bpy.data.images.get(name)
    if im is None or im.filepath != path:
        im = bpy.data.images.load(path, check_existing=True)
    im.colorspace_settings.name = "sRGB" if colour else "Non-Color"
    return im


# ------------------------------------------------------------------------------------------------ materials
def _new(name):
    m = bpy.data.materials.get(name)
    if m:
        m.name = name + "_old"           # keep slots valid until assign() replaces them (removing would empty the slots)
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    return m, m.node_tree, m.node_tree.nodes["Principled BSDF"]


def _tex(nt, path, colour=True, uv="UVMap"):
    t = nt.nodes.new("ShaderNodeTexImage")
    t.image = img(path, colour)
    if uv != "UVMap":
        u = nt.nodes.new("ShaderNodeUVMap")
        u.uv_map = uv
        nt.links.new(u.outputs[0], t.inputs[0])
    return t


def _skin_common(bs, sss=0.22):
    bs.inputs["Subsurface Weight"].default_value = sss
    bs.inputs["Subsurface Radius"].default_value = (1.0, 0.38, 0.22)
    bs.inputs["Subsurface Scale"].default_value = 0.006
    bs.inputs["Specular IOR Level"].default_value = 0.38
    bs.inputs["Sheen Weight"].default_value = 0.08
    bs.inputs["Sheen Roughness"].default_value = 0.45
    bs.inputs["Sheen Tint"].default_value = (1.0, 0.85, 0.80, 1)


def skin_head_material(tone="T2_fair", name=None):
    m, nt, bs = _new(name or f"LD_SkinHead_{tone}")
    alb = _tex(nt, os.path.join(SKIN, f"head_albedo_{tone}.png"))
    ao = _tex(nt, os.path.join(SKIN, "head_ao.png"), False)
    mix = nt.nodes.new("ShaderNodeMix")
    mix.data_type = 'RGBA'
    mix.blend_type = 'MULTIPLY'
    mix.inputs["Factor"].default_value = 0.55
    nt.links.new(alb.outputs["Color"], mix.inputs[6])
    nt.links.new(ao.outputs["Color"], mix.inputs[7])
    nt.links.new(mix.outputs[2], bs.inputs["Base Color"])
    nt.links.new(mix.outputs[2], bs.inputs["Subsurface Radius"]) if False else None
    rough = _tex(nt, os.path.join(SKIN, "head_roughness.png"), False)
    nt.links.new(rough.outputs["Color"], bs.inputs["Roughness"])
    nm = _tex(nt, os.path.join(SKIN, "head_normal.png"), False)
    nmap = nt.nodes.new("ShaderNodeNormalMap")
    nmap.inputs["Strength"].default_value = 0.3
    nt.links.new(nm.outputs["Color"], nmap.inputs["Color"])
    nt.links.new(nmap.outputs["Normal"], bs.inputs["Normal"])
    _skin_common(bs)
    return m


def skin_body_material(tone="T2_fair", name=None):
    m, nt, bs = _new(name or f"LD_SkinBody_{tone}")
    base = TONES.get(tone, {}).get("base", (0.93, 0.72, 0.60))
    bs.inputs["Base Color"].default_value = (*srgb(base), 1)
    bs.inputs["Roughness"].default_value = 0.56
    # gentle procedural mottling + micro bump so the body reads as the same skin as the head
    noise = nt.nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 900.0
    noise.inputs["Detail"].default_value = 3.0
    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.08
    bump.inputs["Distance"].default_value = 0.0003
    nt.links.new(noise.outputs["Fac"], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], bs.inputs["Normal"])
    _skin_common(bs)
    return m


def eye_material(path=None, name="LD_Eye"):
    m, nt, bs = _new(name)
    t = _tex(nt, path or os.path.join(TEX, "eye_default.png"))
    nt.links.new(t.outputs["Color"], bs.inputs["Base Color"])
    bs.inputs["Roughness"].default_value = 0.35
    bs.inputs["Subsurface Weight"].default_value = 0.15
    bs.inputs["Subsurface Radius"].default_value = (1.0, 0.5, 0.4)
    bs.inputs["Subsurface Scale"].default_value = 0.002
    bs.inputs["Specular IOR Level"].default_value = 0.2
    return m


def cornea_material(name="LD_Cornea"):
    m, nt, bs = _new(name)
    nt.nodes.remove(bs)
    out = nt.nodes["Material Output"]
    gl = nt.nodes.new("ShaderNodeBsdfGlossy")
    gl.inputs["Roughness"].default_value = 0.02
    tr = nt.nodes.new("ShaderNodeBsdfTransparent")
    fr = nt.nodes.new("ShaderNodeFresnel")
    fr.inputs["IOR"].default_value = 1.45
    mx = nt.nodes.new("ShaderNodeMixShader")
    mth = nt.nodes.new("ShaderNodeMath")
    mth.operation = 'MULTIPLY_ADD'
    mth.inputs[1].default_value = 1.6
    mth.inputs[2].default_value = 0.10
    nt.links.new(fr.outputs[0], mth.inputs[0])
    nt.links.new(mth.outputs[0], mx.inputs[0])
    nt.links.new(tr.outputs[0], mx.inputs[1])
    nt.links.new(gl.outputs[0], mx.inputs[2])
    nt.links.new(mx.outputs[0], out.inputs[0])
    m.surface_render_method = 'BLENDED'
    m.use_backface_culling = False
    return m


def card_material(path, name, colour=None, rough=0.55, aniso=0.0, dither=True):
    """alpha-tested strand cards (lashes, brows, hair). colour multiplies the texture."""
    m, nt, bs = _new(name)
    t = _tex(nt, path)
    if colour is not None:
        mul = nt.nodes.new("ShaderNodeMix")
        mul.data_type = 'RGBA'
        mul.blend_type = 'MULTIPLY'
        mul.inputs["Factor"].default_value = 1.0
        nt.links.new(t.outputs["Color"], mul.inputs[6])
        mul.inputs[7].default_value = (*srgb(colour), 1)
        nt.links.new(mul.outputs[2], bs.inputs["Base Color"])
    else:
        nt.links.new(t.outputs["Color"], bs.inputs["Base Color"])
    nt.links.new(t.outputs["Alpha"], bs.inputs["Alpha"])
    bs.inputs["Roughness"].default_value = rough
    bs.inputs["Specular IOR Level"].default_value = 0.35
    m.surface_render_method = 'DITHERED'
    m.use_backface_culling = False
    return m


def flat_material(name, col, rough=0.5, sss=0.0):
    m, nt, bs = _new(name)
    bs.inputs["Base Color"].default_value = (*srgb(col), 1)
    bs.inputs["Roughness"].default_value = rough
    bs.inputs["Subsurface Weight"].default_value = sss
    bs.inputs["Subsurface Radius"].default_value = (1.0, 0.3, 0.2)
    bs.inputs["Subsurface Scale"].default_value = 0.003
    return m


# ------------------------------------------------------------------------------------------------ stage
def backdrop(sc, scale=1.0):
    """cyclorama: floor + curved wall, teal gradient (lighter behind the subject), receives the contact shadow."""
    import bmesh
    bm = bmesh.new()
    W, D, Hh, R = 14.0, 7.0, 9.0, 2.5
    nx = 40
    prof = []
    for k in range(10):
        prof.append((-D + k * (D - 0.0) / 9 * 0.999 + 0.0, 0.0))
    prof = [(-D + (D + 2.0) * k / 12, 0.0) for k in range(13)]          # floor from front (-D) to y=2
    for k in range(1, 13):
        a = k / 12 * math.pi / 2
        prof.append((2.0 + R * math.sin(a), R * (1 - math.cos(a))))
    for k in range(1, 6):
        prof.append((2.0 + R, R + (Hh - R) * k / 5))
    rows = []
    for (y, z) in prof:
        rows.append([bm.verts.new(((i / nx - 0.5) * W, y, z)) for i in range(nx + 1)])
    for j in range(len(rows) - 1):
        for i in range(nx):
            bm.faces.new((rows[j][i], rows[j][i + 1], rows[j + 1][i + 1], rows[j + 1][i]))
    me = bpy.data.meshes.new("Backdrop")
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons:
        p.use_smooth = True
    ob = bpy.data.objects.new("Backdrop", me)
    sc.collection.objects.link(ob)
    ob.scale = (scale, scale, scale)
    m, nt, bs = _new("LD_Backdrop")
    tc = nt.nodes.new("ShaderNodeTexCoord")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(tc.outputs["Object"], sep.inputs[0])
    # radial gradient around (0, wall, 1.3 m)
    vec = nt.nodes.new("ShaderNodeVectorMath")
    vec.operation = 'SUBTRACT'
    vec.inputs[1].default_value = (0.6, 4.0, 2.2)
    nt.links.new(tc.outputs["Object"], vec.inputs[0])
    sc_ = nt.nodes.new("ShaderNodeVectorMath")
    sc_.operation = 'MULTIPLY'
    sc_.inputs[1].default_value = (0.20, 0.09, 0.20)
    nt.links.new(vec.outputs[0], sc_.inputs[0])
    ln = nt.nodes.new("ShaderNodeVectorMath")
    ln.operation = 'LENGTH'
    nt.links.new(sc_.outputs[0], ln.inputs[0])
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].position = 0.0
    ramp.color_ramp.elements[0].color = (*srgb((0.22, 0.52, 0.56)), 1)
    ramp.color_ramp.elements[1].position = 1.0
    ramp.color_ramp.elements[1].color = (*srgb((0.06, 0.14, 0.19)), 1)
    nt.links.new(ln.outputs["Value"], ramp.inputs[0])
    nt.links.new(ramp.outputs[0], bs.inputs["Base Color"])
    nt.links.new(ramp.outputs[0], bs.inputs["Emission Color"])
    bs.inputs["Emission Strength"].default_value = 0.85
    bs.inputs["Roughness"].default_value = 0.95
    bs.inputs["Specular IOR Level"].default_value = 0.1
    me.materials.append(m)
    return ob


def area(sc, name, loc, target, energy, col, size):
    ld = bpy.data.lights.new(name, 'AREA')
    ld.energy = energy
    ld.color = col
    ld.size = size
    ld.shape = 'DISK'
    ob = bpy.data.objects.new(name, ld)
    sc.collection.objects.link(ob)
    ob.location = loc
    d = Vector(target) - Vector(loc)
    ob.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    return ob


def setup(res=(1200, 1200), centre=(0, 0, 1.0), key=1.0, figure_scale=1.0):
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_EEVEE_NEXT'
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.resolution_percentage = 100
    sc.render.film_transparent = False
    ee = sc.eevee
    ee.taa_render_samples = 64
    ee.use_shadows = True
    ee.shadow_ray_count = 2
    ee.shadow_step_count = 8
    ee.use_raytracing = True
    ee.ray_tracing_options.resolution_scale = '1'
    ee.use_volumetric_shadows = False
    sc.view_settings.view_transform = 'AgX'
    sc.view_settings.look = 'AgX - Punchy'
    sc.view_settings.exposure = 0.0
    w = sc.world or bpy.data.worlds.new("World")
    sc.world = w
    w.use_nodes = True
    bg = w.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = (*srgb((0.10, 0.20, 0.24)), 1)
    bg.inputs["Strength"].default_value = 0.35
    for o in [o for o in bpy.data.objects if o.type in ('LIGHT', 'CAMERA') or o.name == "Backdrop"]:
        bpy.data.objects.remove(o, do_unlink=True)
    backdrop(sc)
    c = Vector(centre)
    s = figure_scale
    area(sc, "Key", c + Vector((-1.6, -2.2, 1.6)) * s, c, 120 * key * s * s, (1.0, 0.86, 0.72), 1.6 * s)
    area(sc, "Rim", c + Vector((1.7, 1.6, 0.9)) * s, c, 220 * key * s * s, (0.30, 0.72, 1.0), 1.0 * s)
    area(sc, "RimL", c + Vector((-1.8, 1.4, 0.6)) * s, c, 120 * key * s * s, (0.40, 0.72, 0.95), 1.0 * s)
    area(sc, "Fill", c + Vector((1.8, -1.6, 0.2)) * s, c, 45 * key * s * s, (0.62, 0.78, 0.92), 2.5 * s)
    cam = bpy.data.objects.new("Cam", bpy.data.cameras.new("Cam"))
    sc.collection.objects.link(cam)
    sc.camera = cam
    return sc, cam


def aim(cam, target, az_deg, dist, elev_deg=4.0, lens=85, shift=(0, 0)):
    """camera on a circle around target: az 0 = front (-Y), positive = to the character's left (+X)."""
    a, e = math.radians(az_deg), math.radians(elev_deg)
    t = Vector(target)
    cam.location = t + Vector((math.sin(a) * math.cos(e), -math.cos(a) * math.cos(e), math.sin(e))) * dist
    d = t - cam.location
    cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    cam.data.lens = lens
    cam.data.shift_x, cam.data.shift_y = shift
    cam.data.clip_start = 0.01


# ------------------------------------------------------------------------------------------------ the person
BASE_VISIBLE = ("Mesh_Head", "Mesh_Torso", "Mesh_Arms", "Mesh_Hands", "Mesh_Legs", "Mesh_Feet", "Part_Nose", "Part_Ear_L", "Part_Ear_R",
                "Part_Eye_L", "Part_Eye_R", "Part_Cornea_L", "Part_Cornea_R", "Part_Lashes")


def show_only(names):
    names = set(names)
    for o in bpy.data.objects:
        if o.type == 'MESH' and o.name != "Backdrop":
            o.hide_render = o.name not in names
            o.hide_viewport = o.name not in names


def set_keys(weights):
    for o in bpy.data.objects:
        if o.type == 'MESH' and o.data.shape_keys:
            for k in o.data.shape_keys.key_blocks[1:]:
                k.value = float(weights.get(k.name, 0.0))


def assign(tone="T2_fair", eye_tex=None, lash_tex=None, lash_col=(0.05, 0.035, 0.03)):
    head = skin_head_material(tone)
    body = skin_body_material(tone)
    mouth = flat_material("LD_Mouth", (0.38, 0.12, 0.13), 0.45, 0.2)
    eye = eye_material(eye_tex)
    cor = cornea_material()
    lash = card_material(lash_tex or os.path.join(TEX, "lashes_default.png"), "LD_Lashes", colour=None, rough=0.5)
    for o in bpy.data.objects:
        if o.type != 'MESH':
            continue
        for i, ms in enumerate(o.material_slots):
            nm = ms.material.name if ms.material else ""
            if nm.startswith(("Skin_Head", "LD_SkinHead")):
                ms.material = head
            elif nm.startswith(("Skin", "LD_SkinBody")):
                ms.material = body
            elif nm.startswith(("Mouth_Inner", "LD_Mouth")):
                ms.material = mouth
            elif nm.startswith(("Eye", "LD_Eye")):
                ms.material = eye
            elif nm.startswith(("Cornea", "LD_Cornea")):
                ms.material = cor
            elif nm.startswith(("Lashes", "LD_Lashes")):
                ms.material = lash
    return dict(head=head, body=body, eye=eye, cornea=cor, lash=lash, mouth=mouth)


def pose_bone(arm, name, rot_xyz_deg):
    pb = arm.pose.bones[name]
    pb.rotation_mode = 'XYZ'
    pb.rotation_euler = tuple(math.radians(v) for v in rot_xyz_deg)


def clear_pose(arm):
    for pb in arm.pose.bones:
        pb.rotation_mode = 'XYZ'
        pb.rotation_euler = (0, 0, 0)
        pb.location = (0, 0, 0)


def head_target(z_off=0.0):
    """evaluated eye centre of the visible person (for framing face shots)."""
    dg = bpy.context.evaluated_depsgraph_get()
    pts = []
    for n in ("Part_Eye_L", "Part_Eye_R"):
        o = bpy.data.objects[n].evaluated_get(dg)
        me = o.to_mesh()
        pts += [o.matrix_world @ v.co for v in me.vertices]
        o.to_mesh_clear()
    c = sum(pts, Vector()) / len(pts)
    return Vector((0.0, c.y, c.z + z_off))


def render(path):
    sc = bpy.context.scene
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)


# ------------------------------------------------------------------------------------------------ hair, cards, brows
HAIR_TEX = os.path.join(HERE, "parts", "export", "textures", "hair")


def hair_material(colour, name="LD_Hair"):
    """shell: strand tile on flow UVs x colour x vertex Shade; soft edge alpha = clamp((tex.a - (1 - Shade.a)) * 3)."""
    m, nt, bs = _new(name)
    t = _tex(nt, os.path.join(HAIR_TEX, "hair_strands.png"))
    vc = nt.nodes.new("ShaderNodeVertexColor")
    vc.layer_name = "Shade"
    mul = nt.nodes.new("ShaderNodeMix")
    mul.data_type = 'RGBA'
    mul.blend_type = 'MULTIPLY'
    mul.inputs["Factor"].default_value = 1.0
    nt.links.new(t.outputs["Color"], mul.inputs[6])
    nt.links.new(vc.outputs["Color"], mul.inputs[7])
    mul2 = nt.nodes.new("ShaderNodeMix")
    mul2.data_type = 'RGBA'
    mul2.blend_type = 'MULTIPLY'
    mul2.inputs["Factor"].default_value = 1.0
    nt.links.new(mul.outputs[2], mul2.inputs[6])
    mul2.inputs[7].default_value = (*srgb(colour), 1)
    nt.links.new(mul2.outputs[2], bs.inputs["Base Color"])
    inv = nt.nodes.new("ShaderNodeMath")
    inv.operation = 'SUBTRACT'
    inv.inputs[0].default_value = 1.0
    nt.links.new(vc.outputs["Alpha"], inv.inputs[1])
    sub = nt.nodes.new("ShaderNodeMath")
    sub.operation = 'SUBTRACT'
    nt.links.new(t.outputs["Alpha"], sub.inputs[0])
    nt.links.new(inv.outputs[0], sub.inputs[1])
    mm = nt.nodes.new("ShaderNodeMath")
    mm.operation = 'MULTIPLY'
    mm.use_clamp = True
    mm.inputs[1].default_value = 3.0
    nt.links.new(sub.outputs[0], mm.inputs[0])
    nt.links.new(mm.outputs[0], bs.inputs["Alpha"])
    nm = _tex(nt, os.path.join(HAIR_TEX, "hair_strands_normal.png"), False)
    nmap = nt.nodes.new("ShaderNodeNormalMap")
    nmap.inputs["Strength"].default_value = 0.7
    nt.links.new(nm.outputs["Color"], nmap.inputs["Color"])
    nt.links.new(nmap.outputs["Normal"], bs.inputs["Normal"])
    tg = nt.nodes.new("ShaderNodeTangent")
    tg.direction_type = 'UV_MAP'
    tg.uv_map = "UVMap"
    nt.links.new(tg.outputs[0], bs.inputs["Tangent"])
    bs.inputs["Anisotropic"].default_value = 0.6
    bs.inputs["Anisotropic Rotation"].default_value = 0.25
    bs.inputs["Roughness"].default_value = 0.40
    bs.inputs["Specular IOR Level"].default_value = 0.55
    bs.inputs["Specular Tint"].default_value = (*srgb(np.clip(np.array(colour) * 1.5 + 0.2, 0, 1)), 1)
    bs.inputs["Sheen Weight"].default_value = 0.25
    bs.inputs["Subsurface Weight"].default_value = 0.0
    m.surface_render_method = 'DITHERED'
    m.use_backface_culling = False
    return m


def strand_card_material(colour, path, name):
    m = card_material(path, name, colour=np.clip(np.array(colour) * 0.8, 0, 1), rough=0.65)
    bs = m.node_tree.nodes["Principled BSDF"]
    bs.inputs["Specular IOR Level"].default_value = 0.12
    bs.inputs["Sheen Weight"].default_value = 0.0
    return m


def assign_hair(objs, colour, tag="h"):
    hm = hair_material(colour, f"LD_Hair_{tag}")
    hc = strand_card_material(colour, os.path.join(HAIR_TEX, "hair_cards.png"), f"LD_HairCards_{tag}")
    bc = strand_card_material(colour, os.path.join(HAIR_TEX, "beard_cards.png"), f"LD_BeardCards_{tag}")
    for o in objs:
        for ms in o.material_slots:
            n = ms.material.name if ms.material else ""
            if n.startswith(("HairCards", "LD_HairCards")):
                ms.material = hc
            elif n.startswith(("BeardCards", "LD_BeardCards")):
                ms.material = bc
            else:
                ms.material = hm


def assign_brow(ob, colour, tag="b"):
    tex = ob.get("texture") or ""
    path = os.path.join(HERE, "parts", tex) if tex else os.path.join(HERE, "parts", "export", "textures", "brows_hd", "brow_01.png")
    m = strand_card_material(np.clip(np.array(colour) * 0.9, 0, 1), path, f"LD_Brow_{tag}")
    for ms in ob.material_slots:
        ms.material = m
