"""Preview renders (soft stylised shading, warm key + cool rim, tinted soft shadow, no outlines).

    Blender -b -P art3d/creatures/previews.py -- lineup out.png name1 name2 ...     (real scale, one row, labels)
    Blender -b -P art3d/creatures/previews.py -- sheet out.png cols name1 name2 ...  (each normalised, grid, labels)
Names are export/<name>.fbx; the special name 'human' loads art3d/characters/export/base_body.fbx in an A-pose (1.75 m).
Options (before the names): yaw=-35 pose=walk|rest
"""
import bpy, sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib
from mathutils import Vector

HUMAN = os.path.join(os.path.dirname(lib.HERE), "characters", "export", "base_body.fbx")


def rot_world(arm, name, axis, deg):
    pb = arm.pose.bones[name]
    head = arm.matrix_world @ pb.head
    R = Matrix.Translation(head) @ Matrix.Rotation(math.radians(deg), 4, axis) @ Matrix.Translation(-head)
    pb.matrix = arm.matrix_world.inverted() @ (R @ arm.matrix_world @ pb.matrix)
    bpy.context.view_layer.update()


def pose_human_apose(arm):
    lib.activate(arm)
    lib.mode('POSE')
    rot_world(arm, "LeftUpperArm", 'Y', 62)
    rot_world(arm, "RightUpperArm", 'Y', -62)
    lib.mode('OBJECT')


def bounds(objs):
    mn = Vector((1e9,) * 3); mx = Vector((-1e9,) * 3)
    for m in objs:
        if m.type != 'MESH':
            continue
        dg = bpy.context.evaluated_depsgraph_get()
        ev = m.evaluated_get(dg)
        for v in ev.data.vertices:
            w = m.matrix_world @ v.co
            mn = Vector(map(min, mn, w)); mx = Vector(map(max, mx, w))
    return mn, mx


def load(name, pose):
    """Return list of objects (arm + meshes) of one creature, soft-shaded and posed."""
    before = set(bpy.data.objects)
    path = HUMAN if name == "human" else os.path.join(lib.EXPORT, name + ".fbx")
    bpy.ops.import_scene.fbx(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    arm = next((o for o in new if o.type == 'ARMATURE'), None)
    meshes = [o for o in new if o.type == 'MESH']
    for o in list(new):
        if o.type == 'EMPTY':
            new.remove(o)
            bpy.data.objects.remove(o)
    if name == "human":
        # the body is one skin material per part; give it a muted leather-brown tunic colour split? keep skin tone
        for m in meshes:
            for slot in m.material_slots:
                slot.material = lib.make_mat("human_skin", (0.46, 0.30, 0.23))
    elif arm and arm.animation_data and pose != "rest":
        want = {"walk": "Walk", "idle": "Idle"}.get(pose, "Idle")
        act = next((a for a in bpy.data.actions if a.name.split('|')[-1].startswith(want)), None)
        if act is not None:
            arm.animation_data.action = act
            bpy.context.scene.frame_set(int(act.frame_range[0]) + (int(act.frame_range[1] - act.frame_range[0]) // 3))
    elif arm and arm.animation_data:
        arm.animation_data.action = None
    lib.to_soft_preview(meshes)
    return arm, meshes, new


def label(text, loc, size=0.12, yaw=0.0):
    c = bpy.data.curves.new("t", 'FONT')
    c.body = text
    c.size = size
    c.align_x = 'CENTER'
    o = bpy.data.objects.new("t", c)
    bpy.context.collection.objects.link(o)
    o.location = loc
    o.rotation_euler = (math.radians(90), 0, 0)
    o.data.materials.append(lib.make_mat("lbl", (0.22, 0.17, 0.2), rough=1.0))
    return o


def main():
    a = sys.argv[sys.argv.index('--') + 1:]
    mode, out = a[0], a[1]
    rest = a[2:]
    opts = {}
    names = []
    for r in rest:
        if '=' in r:
            k, v = r.split('='); opts[k] = v
        else:
            names.append(r)
    cols = 1
    if mode in ("sheet", "faces"):
        cols = int(names.pop(0))
    yaw = float(opts.get("yaw", -35))
    pose = opts.get("pose", "walk")
    lib.reset()
    sc, cam = lib.setup_render((int(opts.get("w", 1800)), int(opts.get("h", 700))))
    sc.frame_set(1)
    items = []
    for n in names:
        arm, meshes, new = load(n, pose)
        sc.frame_set(sc.frame_current)
        mn, mx = bounds(meshes)
        items.append((n, arm, meshes, new, mn, mx))
    if mode == "lineup":
        gap = float(opts.get("gap", 0.25))
        x = 0.0
        top = 0.0
        for n, arm, meshes, new, mn, mx in items:
            # rotate about the footprint centre
            c = Vector(((mn.x + mx.x) / 2, (mn.y + mx.y) / 2, mn.z))
            root = bpy.data.objects.new("root", None); sc.collection.objects.link(root)
            for o in new:
                if o.parent is None:
                    o.parent = root
            root.matrix_parent_inverse = Matrix.Identity(4) if False else root.matrix_parent_inverse
            for o in new:
                if o.parent is root:
                    o.location -= c
            ext = max(mx.x - mn.x, mx.y - mn.y)
            footprint = (math.hypot(mx.x - mn.x, mx.y - mn.y)) * 0.92
            root.location = (x + footprint / 2, 0, 0)
            root.rotation_euler = (0, 0, math.radians(yaw))
            label(n, (x + footprint / 2, -footprint / 2 - 0.2, 0.0), size=max(0.07, min(0.18, footprint * 0.12)))
            top = max(top, mx.z - mn.z)
            x += footprint + gap
        total = x
        lib.blob_shadow  # shadows from ground plane only
        w = total
        cam.data.type = 'ORTHO'
        aspect = sc.render.resolution_x / sc.render.resolution_y
        scale = max(w * 1.06, top * 1.45 * aspect)
        cam.data.ortho_scale = scale
        el = 12
        tgt = Vector((w / 2, 0, top * 0.5 + (scale / aspect - top) * 0.0))
        d = Vector((0, -math.cos(math.radians(el)), math.sin(math.radians(el)))) * 80
        cam.location = tgt + d
        cam.rotation_euler = (math.radians(90 - el), 0, 0)
    elif mode == "faces":
        n = len(items)
        rows = (n + cols - 1) // cols
        cell = float(opts.get("cell", 1.0))
        for i, (nm, arm, meshes, new, mn, mx) in enumerate(items):
            r, c_ = divmod(i, cols)
            top = mx.z
            hh = (top - mn.z) * 0.17
            ctr = Vector(((mn.x + mx.x) / 2, 0.0, top - hh * 0.5))
            # horns/hats may rise above; centre on the head box
            s = cell * 0.72 / hh
            root = bpy.data.objects.new("root", None); sc.collection.objects.link(root)
            for o in new:
                if o.parent is None:
                    o.parent = root
            for o in new:
                if o.parent is root:
                    o.location -= ctr
            root.scale = (s, s, s)
            root.location = (c_ * cell, 0, (rows - 1 - r) * cell)
            root.rotation_euler = (0, 0, math.radians(yaw))
            label(nm, (c_ * cell, -cell * 0.0, (rows - 1 - r) * cell - cell * 0.46), size=cell * 0.07)
        aspect = sc.render.resolution_x / sc.render.resolution_y
        cam.data.type = 'ORTHO'
        cam.data.ortho_scale = max(cols * cell, rows * cell * aspect) * 1.02
        cam.location = ((cols - 1) * cell / 2, -60, (rows - 1) * cell / 2)
        cam.rotation_euler = (math.radians(90), 0, 0)
    else:
        n = len(items)
        rows = (n + cols - 1) // cols
        cell = float(opts.get("cell", 2.0))
        for i, (nm, arm, meshes, new, mn, mx) in enumerate(items):
            r, c_ = divmod(i, cols)
            size = max(mx.x - mn.x, mx.y - mn.y, mx.z - mn.z)
            s = cell * 0.62 / size
            ctr = Vector(((mn.x + mx.x) / 2, (mn.y + mx.y) / 2, mn.z))
            root = bpy.data.objects.new("root", None); sc.collection.objects.link(root)
            for o in new:
                if o.parent is None:
                    o.parent = root
            for o in new:
                if o.parent is root:
                    o.location -= ctr
            root.scale = (s, s, s)
            root.location = (c_ * cell, (rows - 1 - r) * cell * float(opts.get('rowgap', 1.0)), 0)
            root.rotation_euler = (0, 0, math.radians(yaw))
            label(nm, (c_ * cell, (rows - 1 - r) * cell * float(opts.get('rowgap', 1.0)) - cell * 0.42, 0.0), size=cell * 0.07)
        cam.data.type = 'ORTHO'
        aspect = sc.render.resolution_x / sc.render.resolution_y
        W = cols * cell
        Hh = rows * cell
        # top-down-ish view onto the grid laid out along +Y (rows go away from the camera)
        el = 30
        cam.data.ortho_scale = max(W * 1.04, (Hh * math.sin(math.radians(el)) + cell * 0.9) * aspect)
        ctr = Vector(((cols - 1) * cell / 2, (rows - 1) * cell / 2, cell * 0.3))
        dist = 80
        cam.location = ctr + Vector((0, -dist * math.cos(math.radians(el)), dist * math.sin(math.radians(el))))
        cam.rotation_euler = (math.radians(90 - el), 0, 0)
    sc.render.filepath = out
    bpy.ops.render.render(write_still=True)


from mathutils import Matrix  # noqa
main()
