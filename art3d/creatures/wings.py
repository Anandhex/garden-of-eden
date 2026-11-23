"""Wing builders shared by harpy, dragon and birds (Blender 4.3 headless, imported by other scripts).

feather()        one thin solid feather (tapered leaf), used in rows along wing bones
membrane_wing()  bat/dragon wing: bone spars + skinned membrane
"""
import bpy, bmesh, math
from mathutils import Vector
import lib
from lib import new_mesh_obj


def feather(name, base, direction, length, width, width_axis, thick=0.004, mat=None, taper=0.55):
    """Thin leaf-shaped feather. width_axis is the in-plane direction across the feather."""
    d = Vector(direction).normalized()
    w = (Vector(width_axis) - d * Vector(width_axis).dot(d))
    if w.length < 1e-6:
        w = Vector((1, 0, 0))
    w.normalize()
    n = w.cross(d).normalized()
    B = Vector(base)
    pts = [B - w * width * 0.35, B + w * width * 0.35, B + d * length * taper + w * width * 0.5,
           B + d * length, B + d * length * taper - w * width * 0.5]
    hs = [0.4, 0.4, 1.0, 0.0, 1.0]
    top = [tuple(p + n * thick * h) for p, h in zip(pts, hs)]
    bot = [tuple(p - n * thick * h) for p, h in zip(pts, hs)]
    verts = top + bot
    m = len(pts)
    faces = [tuple(range(m)), tuple(reversed(range(m, 2 * m)))]
    for i in range(m):
        j = (i + 1) % m
        faces.append((i, j, m + j, m + i))
    return new_mesh_obj(name, verts, faces, mat)


def bind_nearest(ob, arm, bone_names, soft=0.06, extra_fixed=None):
    """Weight every vertex of ob to the two nearest bone segments (inverse-square distance)."""
    segs = {b: (arm.data.bones[b].head_local.copy(), arm.data.bones[b].tail_local.copy()) for b in bone_names}
    for v in ob.data.vertices:
        p = ob.matrix_world @ v.co
        ds = []
        for b, (a, t) in segs.items():
            c, _ = lib.closest_on_seg(p, a, t)
            ds.append(((p - c).length, b))
        ds.sort()
        pick = ds[:2]
        ws = [1.0 / (d + soft) ** 2 for d, _ in pick]
        tot = sum(ws)
        for (d, b), w in zip(pick, ws):
            vg = ob.vertex_groups.get(b) or ob.vertex_groups.new(name=b)
            vg.add([v.index], w / tot, 'ADD')
    ob.parent = arm
    mod = ob.modifiers.new("Armature", 'ARMATURE')
    mod.object = arm


def membrane_wing(name, arm, pts, tris, mat, cuts=3, thick=0.006, bones=None):
    """pts {label: Vector}, tris [(a,b,c)] of labels -> subdivided solid membrane skinned to the spar bones."""
    labels = list(pts.keys())
    verts = [tuple(pts[l]) for l in labels]
    faces = [tuple(labels.index(x) for x in t) for t in tris]
    ob = new_mesh_obj(name, verts, faces, mat)
    bm = bmesh.new(); bm.from_mesh(ob.data)
    bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=cuts, use_grid_fill=True)
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    bm.to_mesh(ob.data); bm.free()
    mod = ob.modifiers.new("Solid", 'SOLIDIFY'); mod.thickness = thick; mod.offset = 0
    lib.activate(ob)
    bpy.ops.object.modifier_apply(modifier=mod.name)
    for p in ob.data.polygons:
        p.use_smooth = True
    if bones:
        bind_nearest(ob, arm, bones)
    return ob


def pose_rot(arm, bone, axis, deg):
    """Rotate a pose bone about a world axis through its head (composes on the current pose)."""
    from mathutils import Matrix
    pb = arm.pose.bones[bone]
    head = arm.matrix_world @ pb.head
    R = Matrix.Translation(head) @ Matrix.Rotation(math.radians(deg), 4, axis) @ Matrix.Translation(-head)
    pb.matrix = arm.matrix_world.inverted() @ (R @ arm.matrix_world @ pb.matrix)
    bpy.context.view_layer.update()


def key_pose(arm, frame, bones):
    for b in bones:
        pb = arm.pose.bones[b]
        pb.rotation_mode = 'QUATERNION'
        pb.keyframe_insert("rotation_quaternion", frame=frame)
        pb.keyframe_insert("location", frame=frame)


def reset_pose(arm, bones=None):
    for pb in (arm.pose.bones if bones is None else [arm.pose.bones[b] for b in bones]):
        pb.location = (0, 0, 0)
        pb.rotation_mode = 'QUATERNION'
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.scale = (1, 1, 1)
    bpy.context.view_layer.update()
