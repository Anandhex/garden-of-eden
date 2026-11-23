"""Shared helpers for the Garden of Eden creature pipeline (Blender 4.3, headless).

Conventions (same as art3d/characters): Blender Z up, creature faces -Y, left = +X, 1 unit = 1 m.
FBX export: forward -Z, up Y => Unity Y-up, facing +Z.
"""
import bpy, os, sys, math, colorsys
from mathutils import Vector, Matrix

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "source")
EXPORT = os.path.join(HERE, "export")
PREV = os.path.join(HERE, "previews")


# ---------------------------------------------------------------- scene helpers
def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def deselect():
    bpy.context.view_layer.update()
    for o in list(bpy.data.objects):
        try:
            o.select_set(False)
        except Exception:
            pass


def activate(o):
    deselect()
    bpy.context.view_layer.objects.active = o
    o.select_set(True)


def mode(m):
    bpy.ops.object.mode_set(mode=m)


def import_fbx(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.fbx(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    arm = [o for o in new if o.type == 'ARMATURE'][0]
    meshes = [o for o in new if o.type == 'MESH']
    return arm, meshes


def tri_count(o):
    return sum(len(p.vertices) - 2 for p in o.data.polygons)


def join(meshes, name):
    meshes = list(meshes)
    if len(meshes) == 1:
        meshes[0].name = name
        return meshes[0]
    deselect()
    for m in meshes:
        m.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.join()
    o = bpy.context.view_layer.objects.active
    o.name = name
    return o


# ---------------------------------------------------------------- colours / materials (family palette)
def mute(rgb, sat=0.78, val=0.92, warm=0.03):
    """Pull a colour towards the muted earthy family palette."""
    h, s, v = colorsys.rgb_to_hsv(*rgb[:3])
    s *= sat
    v = min(1.0, v * val)
    r, g, b = colorsys.hsv_to_rgb(h, s, v)
    return (min(1, r + warm), min(1, g + warm * 0.5), max(0, b - warm * 0.5))


def srgb(hexstr):
    """Hex -> linear RGB tuple."""
    h = hexstr.lstrip('#')
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple((x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4) for x in c)


def make_mat(name, rgb, rough=0.85, emissive=None):
    """Matte Principled material (what Unity imports as base colour; low specular, high roughness)."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*rgb[:3], 1)
    bsdf.inputs["Roughness"].default_value = rough
    for k in ("Specular IOR Level", "Specular"):
        if k in bsdf.inputs:
            bsdf.inputs[k].default_value = 0.08
    if emissive:
        bsdf.inputs["Emission Color"].default_value = (*emissive[:3], 1)
        bsdf.inputs["Emission Strength"].default_value = 1.0
    m.diffuse_color = (*rgb[:3], 1)
    return m


def base_image(mat):
    if mat and mat.use_nodes:
        for n in mat.node_tree.nodes:
            if n.type == 'TEX_IMAGE' and n.image:
                return n.image
    return None


def base_color(mat):
    if mat and mat.use_nodes:
        for n in mat.node_tree.nodes:
            if n.type == 'BSDF_PRINCIPLED':
                return tuple(n.inputs["Base Color"].default_value)[:3]
    return (0.6, 0.6, 0.6)


def set_slot_colors(mesh_obj, table, default_mute=True):
    """table: {slot-material-name-substring: (hex or rgb) } ; others are muted; slots get fresh matte materials named
    '<mesh>_<oldname>' so each species owns its materials."""
    for i, slot in enumerate(mesh_obj.material_slots):
        old = slot.material
        oname = old.name if old else "mat%d" % i
        col = base_color(old)
        hit = None
        for key, val in table.items():
            if key.lower() in oname.lower():
                hit = val
                break
        if hit is not None:
            col = srgb(hit) if isinstance(hit, str) else hit
        elif default_mute:
            col = mute(col)
        slot.material = make_mat("%s_%s" % (mesh_obj.name, oname.split('.')[0] + (".%d" % i if i else "")), col)


# ---------------------------------------------------------------- geometry helpers
def new_mesh_obj(name, verts, faces, mat=None, parent=None):
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.update()
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    if mat:
        me.materials.append(mat)
    for p in me.polygons:
        p.use_smooth = True
    return ob


def cone_mesh(name, base, tip, r0, r1=0.0, sides=8, bend=None, rings=4, mat=None, flat=None):
    """Tapered (optionally bent) horn/tusk/spike from base to tip. bend: Vector offset applied quadratically.
    r1 is radius at the tip. flat: optional (ratio) squash of the ring in the local 2nd axis."""
    base, tip = Vector(base), Vector(tip)
    ax = (tip - base)
    L = ax.length
    d = ax.normalized()
    up = Vector((0, 0, 1)) if abs(d.z) < 0.9 else Vector((1, 0, 0))
    u = d.cross(up).normalized()
    v = d.cross(u).normalized()
    bend = Vector(bend) if bend is not None else Vector((0, 0, 0))
    verts, faces = [], []
    for ri in range(rings + 1):
        t = ri / rings
        c = base + ax * t + bend * (t * t)
        r = r0 + (r1 - r0) * t
        for s in range(sides):
            a = 2 * math.pi * s / sides
            k = flat if flat else 1.0
            verts.append(tuple(c + u * math.cos(a) * r + v * math.sin(a) * r * k))
    for ri in range(rings):
        for s in range(sides):
            a = ri * sides + s
            b = ri * sides + (s + 1) % sides
            faces.append((a, b, b + sides, a + sides))
    tipc = len(verts)
    verts.append(tuple(base + ax + bend))
    for s in range(sides):
        a = rings * sides + s
        b = rings * sides + (s + 1) % sides
        faces.append((a, b, tipc))
    ob = new_mesh_obj(name, verts, faces, mat)
    return ob


def ellipsoid_mesh(name, center, radii, seg=10, rings=6, mat=None):
    verts, faces = [], []
    cx, cy, cz = center
    for ri in range(1, rings):
        th = math.pi * ri / rings
        for s in range(seg):
            ph = 2 * math.pi * s / seg
            verts.append((cx + radii[0] * math.sin(th) * math.cos(ph), cy + radii[1] * math.sin(th) * math.sin(ph),
                          cz + radii[2] * math.cos(th)))
    top = len(verts); verts.append((cx, cy, cz + radii[2]))
    bot = len(verts); verts.append((cx, cy, cz - radii[2]))
    for ri in range(rings - 2):
        for s in range(seg):
            a = ri * seg + s; b = ri * seg + (s + 1) % seg
            faces.append((a, b, b + seg, a + seg))
    for s in range(seg):
        faces.append((top, (s + 1) % seg, s))
        o = (rings - 2) * seg
        faces.append((bot, o + s, o + (s + 1) % seg))
    return new_mesh_obj(name, verts, faces, mat)


def weight_all(obj, bone, arm):
    """Rigid-bind the whole mesh to one bone and add the Armature modifier."""
    vg = obj.vertex_groups.new(name=bone)
    vg.add(list(range(len(obj.data.vertices))), 1.0, 'REPLACE')
    obj.parent = arm
    m = obj.modifiers.new("Armature", 'ARMATURE')
    m.object = arm


def to_arm_space_world(obj, arm):
    """Mesh objects created in world space; keep world transform when parenting (identity parent inverse because arm at origin)."""
    obj.parent = arm


def shade_smooth(o):
    for p in o.data.polygons:
        p.use_smooth = True


# ---------------------------------------------------------------- vertex deform helpers (rest pose, bone-weight driven)
def bone_segments(arm):
    """Return {bone: (head, tail)} in world space (armature at identity)."""
    M = arm.matrix_world
    return {b.name: (M @ b.head_local, M @ b.tail_local) for b in arm.data.bones}


def closest_on_seg(p, a, b):
    ab = b - a
    L2 = ab.length_squared
    if L2 < 1e-12:
        return a.copy(), 0.0
    t = max(0.0, min(1.0, (p - a).dot(ab) / L2))
    return a + ab * t, t


def radial_scale(mesh, arm, factors, along=None):
    """Inflate/deflate mesh around bones. factors: {bone: k} radial scale about the bone axis, weighted by vertex weight.
    along: {bone: k} scale along the bone axis about the bone head."""
    segs = bone_segments(arm)
    idx = {vg.index: vg.name for vg in mesh.vertex_groups}
    me = mesh.data
    inv = mesh.matrix_world.inverted()
    for v in me.vertices:
        p = mesh.matrix_world @ v.co
        d = Vector((0, 0, 0))
        for g in v.groups:
            nm = idx.get(g.group)
            if nm in segs and g.weight > 0:
                a, b = segs[nm]
                c, t = closest_on_seg(p, a, b)
                rad = p - c
                if factors.get(nm) is not None:
                    d += rad * (factors[nm] - 1.0) * g.weight
                if along and along.get(nm) is not None:
                    ax = (b - a)
                    if ax.length > 1e-9:
                        s = (p - a).dot(ax.normalized())
                        d += ax.normalized() * s * (along[nm] - 1.0) * g.weight
        v.co = inv @ (p + d)


def scale_verts_by_group(mesh, group_names, center, factor_vec):
    """Scale vertices (weight-blended) about a point."""
    idx = {vg.index: vg.name for vg in mesh.vertex_groups}
    inv = mesh.matrix_world.inverted()
    for v in mesh.data.vertices:
        w = sum(g.weight for g in v.groups if idx.get(g.group) in group_names)
        if w <= 0:
            continue
        w = min(w, 1.0)
        p = mesh.matrix_world @ v.co
        q = Vector((center[0] + (p.x - center[0]) * factor_vec[0], center[1] + (p.y - center[1]) * factor_vec[1],
                    center[2] + (p.z - center[2]) * factor_vec[2]))
        v.co = inv @ (p.lerp(q, w))


def apply_pose_as_rest(arm, meshes):
    """Apply current pose to the mesh through the Armature modifier and make it the new rest pose."""
    for m in meshes:
        activate(m)
        # apply armature modifiers (no shape keys expected)
        for mod in list(m.modifiers):
            if mod.type == 'ARMATURE':
                bpy.ops.object.modifier_apply(modifier=mod.name)
    activate(arm)
    bpy.ops.object.mode_set(mode='POSE')
    bpy.ops.pose.armature_apply(selected=False)
    bpy.ops.object.mode_set(mode='OBJECT')
    for m in meshes:
        mod = m.modifiers.new("Armature", 'ARMATURE')
        mod.object = arm


# ---------------------------------------------------------------- animation helpers
def clean_action_names(arm, keep_map):
    """keep_map {old-suffix: new name}; delete the others. Names in the FBX look like 'Armature|Armature|Walk'."""
    for a in list(bpy.data.actions):
        suf = a.name.split('|')[-1]
        if suf in keep_map:
            a.name = keep_map[suf]
        else:
            bpy.data.actions.remove(a)


def scale_action_locations(factor):
    for a in bpy.data.actions:
        for fc in a.fcurves:
            if fc.data_path.endswith('.location'):
                for kp in fc.keyframe_points:
                    kp.co.y *= factor
                    kp.handle_left.y *= factor
                    kp.handle_right.y *= factor
                fc.update()


def drop_unweighted_bones(arm, meshes, protect=()):
    """Delete bones that carry no weights and have no weighted descendants (IK/pole helpers); prune their fcurves."""
    used = set()
    for m in meshes:
        for vg in m.vertex_groups:
            used.add(vg.name)
    keep = set(protect)
    for b in arm.data.bones:
        if b.name in used:
            keep.add(b.name)
            p = b.parent
            while p:
                keep.add(p.name)
                p = p.parent
    activate(arm)
    mode('EDIT')
    for eb in list(arm.data.edit_bones):
        if eb.name not in keep:
            arm.data.edit_bones.remove(eb)
    mode('OBJECT')
    names = {b.name for b in arm.data.bones}
    for a in bpy.data.actions:
        for fc in list(a.fcurves):
            if fc.data_path.startswith('pose.bones["'):
                bn = fc.data_path.split('"')[1]
                if bn not in names:
                    a.fcurves.remove(fc)


def strip_constraints(arm):
    for pb in arm.pose.bones:
        for c in list(pb.constraints):
            pb.constraints.remove(c)


def bake_scale(arm, meshes, s):
    """Bake a uniform scale into mesh vertices, bone rest positions and animation translations (object scales stay 1)."""
    if abs(s - 1.0) < 1e-9:
        return
    for m in meshes:
        for v in m.data.vertices:
            v.co *= s
        if m.data.shape_keys:
            for kb in m.data.shape_keys.key_blocks:
                for p in kb.data:
                    p.co *= s
        m.data.update()
    activate(arm)
    mode('EDIT')
    orig = {eb.name: (eb.head.copy(), eb.tail.copy()) for eb in arm.data.edit_bones}
    for eb in arm.data.edit_bones:       # (connected children follow their parent's tail, so assign from the snapshot)
        eb.head = orig[eb.name][0] * s
        eb.tail = orig[eb.name][1] * s
    mode('OBJECT')
    scale_action_locations(s)


# ---------------------------------------------------------------- export
def export_fbx(path, objs, global_scale=1.0, with_anim=True):
    deselect()
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    kw = dict(filepath=path, use_selection=True, object_types={'ARMATURE', 'MESH', 'EMPTY'},
              global_scale=global_scale, apply_unit_scale=True, apply_scale_options='FBX_SCALE_ALL',
              axis_forward='-Z', axis_up='Y', bake_space_transform=False, add_leaf_bones=False,
              primary_bone_axis='Y', secondary_bone_axis='X', armature_nodetype='NULL', mesh_smooth_type='OFF',
              use_mesh_modifiers=False, bake_anim=with_anim, path_mode='COPY', embed_textures=True)
    if with_anim:
        kw.update(bake_anim_use_all_actions=True, bake_anim_use_nla_strips=False, bake_anim_force_startend_keying=True,
                  bake_anim_simplify_factor=0.0, bake_anim_step=1.0)
    bpy.ops.export_scene.fbx(**kw)


def push_all_actions_to_nla(arm):
    """Make sure every action is exported as its own take."""
    if arm.animation_data is None:
        arm.animation_data_create()
    for a in bpy.data.actions:
        a.use_fake_user = True


# ---------------------------------------------------------------- preview shading (art direction: soft matte, warm key, cool rim)
def soft_material(name, base, warm_shadow=(0.50, 0.36, 0.46), image=None):
    """Smooth ramp (wide soft terminator, tinted shadows) + gentle cool rim. Emission trick as in art3d/characters."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    emi = nt.nodes.new("ShaderNodeEmission")
    diff = nt.nodes.new("ShaderNodeBsdfDiffuse")
    s2r = nt.nodes.new("ShaderNodeShaderToRGB")
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    mul = nt.nodes.new("ShaderNodeMix"); mul.data_type = 'RGBA'; mul.blend_type = 'MULTIPLY'; mul.inputs[0].default_value = 1
    add = nt.nodes.new("ShaderNodeMix"); add.data_type = 'RGBA'; add.blend_type = 'ADD'; add.inputs[0].default_value = 1
    lw = nt.nodes.new("ShaderNodeLayerWeight"); lw.inputs["Blend"].default_value = 0.30
    rramp = nt.nodes.new("ShaderNodeValToRGB")
    rmul = nt.nodes.new("ShaderNodeMix"); rmul.data_type = 'RGBA'; rmul.blend_type = 'MULTIPLY'; rmul.inputs[0].default_value = 1
    diff.inputs["Color"].default_value = (1, 1, 1, 1)
    nt.links.new(diff.outputs[0], s2r.inputs[0])
    nt.links.new(s2r.outputs["Color"], ramp.inputs[0])
    e = ramp.color_ramp
    e.interpolation = 'B_SPLINE'
    w = warm_shadow
    stops = [(0.0, w), (0.18, (w[0] + 0.1, w[1] + 0.02, w[2] + 0.04)), (0.40, (0.82, 0.68, 0.70)), (0.62, (0.97, 0.90, 0.86)),
             (0.85, (1.0, 0.97, 0.92)), (1.0, (1.0, 0.98, 0.94))]
    e.elements[0].position, e.elements[0].color = stops[0][0], (*stops[0][1], 1)
    e.elements[1].position, e.elements[1].color = stops[-1][0], (*stops[-1][1], 1)
    for pos, col in stops[1:-1]:
        k = e.elements.new(pos); k.color = (*col, 1)
    if image is not None:
        t = nt.nodes.new("ShaderNodeTexImage"); t.image = image
        nt.links.new(t.outputs["Color"], mul.inputs[7])
    else:
        mul.inputs[7].default_value = (*base[:3], 1)
    nt.links.new(ramp.outputs["Color"], mul.inputs[6])
    nt.links.new(lw.outputs["Facing"], rramp.inputs[0])
    rr = rramp.color_ramp
    rr.interpolation = 'EASE'
    rr.elements[0].position, rr.elements[0].color = 0.0, (0.30, 0.70, 0.90, 1)
    rr.elements[1].position, rr.elements[1].color = 0.5, (0, 0, 0, 1)
    rmul.inputs[7].default_value = (0.17, 0.17, 0.17, 1)
    nt.links.new(rramp.outputs["Color"], rmul.inputs[6])
    nt.links.new(mul.outputs[2], add.inputs[6])
    nt.links.new(rmul.outputs[2], add.inputs[7])
    nt.links.new(add.outputs[2], emi.inputs["Color"])
    nt.links.new(emi.outputs[0], out.inputs["Surface"])
    return m


def to_soft_preview(objs):
    """Replace every material of the given mesh objects with its soft-shaded equivalent (for rendering only)."""
    cache = {}
    for o in objs:
        if o.type != 'MESH':
            continue
        for slot in o.material_slots:
            m = slot.material
            key = m.name if m else None
            if key not in cache:
                cache[key] = soft_material("soft_" + str(key), base_color(m), image=base_image(m))
            slot.material = cache[key]


def blob_shadow(scale=(1.5, 1.0)):
    me = bpy.data.meshes.new("blob")
    me.from_pydata([(-0.5, -0.5, 0), (0.5, -0.5, 0), (0.5, 0.5, 0), (-0.5, 0.5, 0)], [], [(0, 1, 2, 3)])
    ob = bpy.data.objects.new("blob", me)
    bpy.context.collection.objects.link(ob)
    ob.scale = (scale[0], scale[1], 1)
    ob.location = (0, 0, 0.002)
    m = bpy.data.materials.new("Blob"); m.use_nodes = True
    nt = m.node_tree; nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    tc = nt.nodes.new("ShaderNodeTexCoord")
    gr = nt.nodes.new("ShaderNodeTexGradient"); gr.gradient_type = 'SPHERICAL'
    mp = nt.nodes.new("ShaderNodeMapping"); mp.inputs["Location"].default_value = (-0.5, -0.5, 0)
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].position = 0.0; ramp.color_ramp.elements[0].color = (0, 0, 0, 1)
    ramp.color_ramp.elements[1].position = 1.0; ramp.color_ramp.elements[1].color = (0.6, 0.6, 0.6, 1)
    ramp.color_ramp.interpolation = 'EASE'
    em = nt.nodes.new("ShaderNodeEmission"); em.inputs["Color"].default_value = (0.28, 0.14, 0.24, 1)
    tr = nt.nodes.new("ShaderNodeBsdfTransparent")
    mix = nt.nodes.new("ShaderNodeMixShader")
    nt.links.new(tc.outputs["Generated"], mp.inputs["Vector"])
    nt.links.new(mp.outputs[0], gr.inputs["Vector"])
    nt.links.new(gr.outputs["Fac"], ramp.inputs[0])
    nt.links.new(ramp.outputs["Color"], mix.inputs[0])
    nt.links.new(em.outputs[0], mix.inputs[2]); nt.links.new(tr.outputs[0], mix.inputs[1])
    nt.links.new(mix.outputs[0], out.inputs["Surface"])
    ob.data.materials.append(m)
    ob.visible_shadow = False
    return ob


def setup_render(res=(1400, 700)):
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_EEVEE_NEXT'
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.film_transparent = False
    sc.view_settings.view_transform = 'Standard'
    sc.eevee.taa_render_samples = 24
    sc.eevee.use_shadows = True
    w = bpy.data.worlds.new("W"); sc.world = w; w.use_nodes = True
    bg = w.node_tree.nodes["Background"]
    bg.inputs[0].default_value = (0.80, 0.78, 0.76, 1)   # warm light grey backdrop
    bg.inputs[1].default_value = 1.0
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    sc.collection.objects.link(cam)
    cam.data.type = 'PERSP'
    cam.data.lens = 70
    cam.data.clip_end = 400
    sc.camera = cam
    sun = bpy.data.objects.new("key", bpy.data.lights.new("key", 'SUN'))
    sc.collection.objects.link(sun)
    sun.data.energy = 3.14
    sun.data.angle = math.radians(12)
    sun.data.color = (1.0, 0.88, 0.68)
    sun.rotation_euler = (math.radians(55), 0, math.radians(-38))
    # ground: soft light plane receiving the shadow
    me = bpy.data.meshes.new("ground")
    S = 200
    me.from_pydata([(-S, -S, 0), (S, -S, 0), (S, S, 0), (-S, S, 0)], [], [(0, 1, 2, 3)])
    g = bpy.data.objects.new("ground", me)
    sc.collection.objects.link(g)
    g.data.materials.append(soft_material("ground", (0.78, 0.74, 0.70), warm_shadow=(0.55, 0.46, 0.52)))
    return sc, cam


def aim(cam, target, az_deg, el_deg, dist):
    az, el = math.radians(az_deg), math.radians(el_deg)
    # az 0 = looking at the creature's front (creature faces -Y so camera sits at -Y)
    pos = Vector(target) + Vector((math.sin(az) * math.cos(el), -math.cos(az) * math.cos(el), math.sin(el))) * dist
    cam.location = pos
    d = Vector(target) - pos
    cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()


def smooth_normals(objs, angle_deg=65):
    """Soft look: smooth shading with sharp edges only above angle_deg (stored as normals in the FBX)."""
    for o in objs:
        if o.type != 'MESH':
            continue
        activate(o)
        bpy.ops.object.shade_smooth_by_angle(angle=math.radians(angle_deg))


def add_bones(arm, specs):
    """specs: [(name, head, tail, parent)] added in one edit session (world == armature space)."""
    activate(arm)
    mode('EDIT')
    for name, h, t, parent in specs:
        b = arm.data.edit_bones.new(name)
        b.head, b.tail = Vector(h), Vector(t)
        if parent:
            b.parent = arm.data.edit_bones[parent]
        b.use_deform = True
    mode('OBJECT')


def surface_top(meshes, y, x_half=0.25, y_half=0.15):
    best = -9
    for m in meshes:
        for v in m.data.vertices:
            if abs(v.co.x) < x_half and abs(v.co.y - y) < y_half:
                best = max(best, v.co.z)
    return best


def tube(name, arm, pts, radii, bones, mat, sides=8, flat=1.0, cap=True):
    """Tapered skinned tube along the polyline pts; ring i is weighted between bones[i-1] and bones[i] (bones[j] drives the
    segment pts[j] -> pts[j+1])."""
    pts = [Vector(p) for p in pts]
    verts, faces, wts = [], [], []
    n = len(pts)
    for i, p in enumerate(pts):
        t = (pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]).normalized()
        up = Vector((0, 0, 1)) if abs(t.z) < 0.9 else Vector((1, 0, 0))
        u = t.cross(up).normalized(); v = t.cross(u).normalized()
        for s in range(sides):
            a = 2 * math.pi * s / sides
            verts.append(tuple(p + u * math.cos(a) * radii[i] + v * math.sin(a) * radii[i] * flat))
            if i == 0:
                wts.append({bones[0]: 1.0})
            elif i == n - 1:
                wts.append({bones[-1]: 1.0})
            else:
                wts.append({bones[i - 1]: 0.5, bones[i]: 0.5})
    for i in range(n - 1):
        for s in range(sides):
            a = i * sides + s; b = i * sides + (s + 1) % sides
            faces.append((a, b, b + sides, a + sides))
    if cap:
        c = len(verts); verts.append(tuple(pts[-1] + (pts[-1] - pts[-2]).normalized() * radii[-1] * 0.6)); wts.append({bones[-1]: 1.0})
        for s in range(sides):
            a = (n - 1) * sides + s; b = (n - 1) * sides + (s + 1) % sides
            faces.append((a, b, c))
    ob = new_mesh_obj(name, verts, faces, mat)
    for i, w in enumerate(wts):
        for bn, val in w.items():
            vg = ob.vertex_groups.get(bn) or ob.vertex_groups.new(name=bn)
            vg.add([i], val, 'REPLACE')
    ob.parent = arm
    mod = ob.modifiers.new("Armature", 'ARMATURE'); mod.object = arm
    return ob


