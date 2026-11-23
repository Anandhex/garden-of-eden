"""Import an exported rigged GLB, pose it, and render front/side to check skinning.

blender -b -P blender/pose_test.py -- <rigged.glb> <out_prefix>
"""
import math
import sys

import bpy
from mathutils import Euler, Vector

argv = sys.argv[sys.argv.index("--") + 1:]
src, prefix = argv[0], argv[1]

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
arm = next(o for o in bpy.context.scene.objects if o.type == "ARMATURE")
mesh = next(o for o in bpy.context.scene.objects if o.type == "MESH")
print("BONES", [b.name for b in arm.data.bones])
print("GROUPS", len(mesh.vertex_groups), "VERTS", len(mesh.data.vertices))

pose = {
    "LeftArm": (0, 0, -40),       # drop left arm
    "RightArm": (-60, 0, 20),     # raise right arm forward
    "RightForeArm": (0, 0, 60),   # bend right elbow
    "LeftUpLeg": (35, 0, 0),      # step forward
    "LeftLeg": (-50, 0, 0),       # bend left knee
    "Head": (0, 0, 25),           # turn head
    "Spine1": (10, 0, 0),
}
for name, (x, y, z) in pose.items():
    pb = arm.pose.bones.get(name)
    if pb:
        pb.rotation_mode = "XYZ"
        pb.rotation_euler = Euler((math.radians(x), math.radians(y), math.radians(z)))
    else:
        print("MISSING BONE", name)
bpy.context.view_layer.update()

scene = bpy.context.scene
scene.render.engine = "BLENDER_EEVEE_NEXT"
scene.render.resolution_x, scene.render.resolution_y = 640, 800
world = bpy.data.worlds.new("w")
world.use_nodes = True
world.node_tree.nodes["Background"].inputs[0].default_value = (0.55, 0.57, 0.6, 1)
scene.world = world
sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
sun.data.energy = 3
sun.rotation_euler = (math.radians(50), 0, math.radians(30))
scene.collection.objects.link(sun)
cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
cam.data.type = "ORTHO"
cam.data.ortho_scale = 2.0
scene.collection.objects.link(cam)
scene.camera = cam
for name, ang in (("front", 0), ("side", 90)):
    a = math.radians(ang)
    cam.location = Vector((6 * math.sin(a), -6 * math.cos(a), 0.85))
    cam.rotation_euler = (math.radians(90), 0, a)
    scene.render.filepath = f"{prefix}_{name}.png"
    bpy.ops.render.render(write_still=True)
print("RENDERED")
