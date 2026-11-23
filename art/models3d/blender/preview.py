"""Render front/side/back previews of a GLB and print mesh stats.

blender -b -P blender/preview.py -- <in.glb> <out_prefix>
Writes <out_prefix>_front.png, _side.png, _back.png.
"""
import math
import sys

import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]
src, prefix = argv[0], argv[1]

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)

meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
pts = [o.matrix_world @ Vector(c) for o in meshes for c in o.bound_box]
lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
size = hi - lo
centre = (lo + hi) / 2
for o in meshes:
    me = o.data
    print(f"MESH {o.name}: verts={len(me.vertices)} faces={len(me.polygons)} "
          f"mats={[m.name for m in me.materials if m]} armature={o.find_armature()}")
print(f"BOUNDS lo={tuple(round(v, 3) for v in lo)} hi={tuple(round(v, 3) for v in hi)} "
      f"size={tuple(round(v, 3) for v in size)}")

scene = bpy.context.scene
scene.render.engine = "BLENDER_EEVEE_NEXT" if "BLENDER_EEVEE_NEXT" in {
    e.identifier for e in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items
} else "BLENDER_EEVEE"
scene.render.resolution_x = 640
scene.render.resolution_y = 800
scene.render.film_transparent = False
world = bpy.data.worlds.new("w")
world.use_nodes = True
world.node_tree.nodes["Background"].inputs[0].default_value = (0.55, 0.57, 0.6, 1)
world.node_tree.nodes["Background"].inputs[1].default_value = 1.0
scene.world = world

sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
sun.data.energy = 3
sun.rotation_euler = (math.radians(50), 0, math.radians(30))
scene.collection.objects.link(sun)

cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
cam.data.type = "ORTHO"
cam.data.ortho_scale = max(size.z, size.x, size.y) * 1.1
scene.collection.objects.link(cam)
scene.camera = cam

dist = max(size) * 3
for name, angle in (("front", 0), ("side", 90), ("back", 180)):
    a = math.radians(angle)
    # glTF imports with -Y as the model's front in Blender.
    cam.location = centre + Vector((dist * math.sin(a), -dist * math.cos(a), 0))
    cam.rotation_euler = (math.radians(90), 0, a)
    scene.render.filepath = f"{prefix}_{name}.png"
    bpy.ops.render.render(write_still=True)
print("RENDERED", prefix)
