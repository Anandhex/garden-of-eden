"""TRELLIS.2 GLB -> watertight, retopologised, baked, rigged game character.

blender -b -P blender/process.py -- <in.glb> <out_dir> <name> [--height 1.7] [--faces 10000] [--tex 2048] [--no-rig]

Steps
  1. import, scale so the model is --height metres tall, feet on the ground, facing -Y
  2. voxel remesh (watertight, manifold) then QuadriFlow quad retopology to --faces quads
  3. smart-UV the low mesh, bake base colour + normal from the original (Cycles)
  4. (humanoids) build a humanoid skeleton fitted to measured landmarks and skin it
     with automatic weights; bone names follow the Mixamo/Unity-Humanoid convention
  5. write <name>.blend, <name>.glb (web client) and <name>.fbx (Unity)
"""
import argparse
import math
import os
import sys

import bmesh
import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]
ap = argparse.ArgumentParser()
ap.add_argument("src")
ap.add_argument("out_dir")
ap.add_argument("name")
ap.add_argument("--height", type=float, default=1.7)
ap.add_argument("--faces", type=int, default=12000)
ap.add_argument("--tex", type=int, default=2048)
ap.add_argument("--voxel", type=float, default=0.004)
ap.add_argument("--no-rig", action="store_true")
a = ap.parse_args(argv)
os.makedirs(a.out_dir, exist_ok=True)


def log(*m):
    print("[process]", *m, flush=True)


def select_only(*objs, active=None):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = active or objs[0]


# ---------------------------------------------------------------- 1. import
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.context.preferences.filepaths.save_version = 0
bpy.ops.import_scene.gltf(filepath=a.src)
meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
select_only(*meshes)
if len(meshes) > 1:
    bpy.ops.object.join()
high = bpy.context.view_layer.objects.active
high.name = "high"
bpy.ops.object.parent_clear(type="CLEAR_KEEP_TRANSFORM")
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
for o in list(bpy.context.scene.objects):
    if o is not high:
        bpy.data.objects.remove(o, do_unlink=True)

me = high.data
zs = [v.co.z for v in me.vertices]
s = a.height / (max(zs) - min(zs))
high.scale = (s, s, s)
bpy.ops.object.transform_apply(scale=True)
xs = [v.co.x for v in me.vertices]
ys = [v.co.y for v in me.vertices]
zmin = min(v.co.z for v in me.vertices)
high.location = (-(min(xs) + max(xs)) / 2, -(min(ys) + max(ys)) / 2, -zmin)
bpy.ops.object.transform_apply(location=True)
log(f"high: {len(me.vertices)} verts, {len(me.polygons)} faces, scaled x{s:.3f}")

# ---------------------------------------------------------------- 2. remesh + retopo
low = high.copy()
low.data = high.data.copy()
low.name = a.name
bpy.context.scene.collection.objects.link(low)
select_only(low)
low.data.materials.clear()
low.data.remesh_voxel_size = a.voxel
low.data.use_remesh_preserve_volume = True
bpy.ops.object.voxel_remesh()
log(f"voxel remesh: {len(low.data.polygons)} faces (watertight)")

def tidy(obj):
    """Merge doubles, drop loose bits, make normals consistent (QuadriFlow needs it)."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(obj.data)
    bm.free()


# QuadriFlow silently refuses non-manifold input, and decimation can break
# manifoldness, so thin in steps and retry until it takes.
ok = False
backup = low.data.copy()
for pre in (60000, 40000, 100000, 25000):
    low.data = backup.copy()
    if len(low.data.polygons) > pre:
        mod = low.modifiers.new("pre", "DECIMATE")
        mod.ratio = pre / len(low.data.polygons)
        bpy.ops.object.modifier_apply(modifier=mod.name)
    tidy(low)
    before = len(low.data.polygons)
    try:
        bpy.ops.object.quadriflow_remesh(
            target_faces=a.faces, use_preserve_sharp=False, use_preserve_boundary=False,
            use_mesh_symmetry=False, smooth_normals=False, seed=0,
        )
    except RuntimeError as e:
        log("quadriflow error:", e)
    after = len(low.data.polygons)
    ok = after != before and after < a.faces * 2
    log(f"quadriflow from {before} faces -> {after} ({'ok' if ok else 'refused'})")
    if ok:
        break
if not ok:
    low.data = backup.copy()
    log("falling back to decimate")
    mod = low.modifiers.new("dec", "DECIMATE")
    mod.ratio = (a.faces * 2) / max(1, len(low.data.polygons))
    bpy.ops.object.modifier_apply(modifier=mod.name)

bm = bmesh.new()
bm.from_mesh(low.data)
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
non_manifold = sum(1 for e in bm.edges if not e.is_manifold)
bm.to_mesh(low.data)
bm.free()
bpy.ops.object.shade_smooth()
tris = sum(len(p.vertices) - 2 for p in low.data.polygons)
log(f"low: {len(low.data.polygons)} faces ({tris} tris), non-manifold edges={non_manifold}, quadriflow={ok}")

# ---------------------------------------------------------------- 3. UV + bake
select_only(low)
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.select_all(action="SELECT")
bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.004)
bpy.ops.uv.pack_islands(margin=0.004)
bpy.ops.object.mode_set(mode="OBJECT")

mat = bpy.data.materials.new(a.name)
mat.use_nodes = True
nt = mat.node_tree
bsdf = nt.nodes["Principled BSDF"]
bsdf.inputs["Roughness"].default_value = 0.75
low.data.materials.append(mat)


def bake_image(label, colorspace):
    img = bpy.data.images.new(f"{a.name}_{label}", a.tex, a.tex, alpha=False)
    img.colorspace_settings.name = colorspace
    node = nt.nodes.new("ShaderNodeTexImage")
    node.image = img
    node.label = label
    return node


col_node = bake_image("basecolor", "sRGB")
nrm_node = bake_image("normal", "Non-Color")

scene = bpy.context.scene
scene.render.engine = "CYCLES"
try:
    prefs = bpy.context.preferences.addons["cycles"].preferences
    prefs.compute_device_type = "METAL"
    prefs.get_devices()
    for d in prefs.devices:
        d.use = True
    scene.cycles.device = "GPU"
except Exception as e:  # CPU is fine, just slower
    log("GPU bake unavailable:", e)
scene.cycles.samples = 4
bake = scene.render.bake
bake.use_selected_to_active = True
bake.use_cage = False
bake.cage_extrusion = 0.02
bake.max_ray_distance = 0.05
bake.margin = 8

select_only(high, low, active=low)
for node, kind in ((col_node, "DIFFUSE"), (nrm_node, "NORMAL")):
    for n in nt.nodes:
        n.select = False
    node.select = True
    nt.nodes.active = node
    if kind == "DIFFUSE":
        bake.use_pass_direct = False
        bake.use_pass_indirect = False
        bake.use_pass_color = True
    bpy.ops.object.bake(type=kind)
    path = os.path.abspath(os.path.join(a.out_dir, f"{a.name}_{node.label}.png"))
    node.image.filepath_raw = path
    node.image.file_format = "PNG"
    node.image.save()
    node.image = bpy.data.images.load(path, check_existing=False)
    node.image.colorspace_settings.name = "Non-Color" if kind == "NORMAL" else "sRGB"
    log("baked", path)

nt.links.new(col_node.outputs["Color"], bsdf.inputs["Base Color"])
nmap = nt.nodes.new("ShaderNodeNormalMap")
nt.links.new(nrm_node.outputs["Color"], nmap.inputs["Color"])
nt.links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])

bpy.data.objects.remove(high, do_unlink=True)

# ---------------------------------------------------------------- 4. rig
def slice_verts(zlo, zhi):
    return [low.matrix_world @ v.co for v in low.data.vertices if zlo <= v.co.z <= zhi]


def landmarks(H):
    """Measure a front-facing A-pose humanoid (feet at z=0, facing -Y)."""
    L = {}
    # Legs: centroid of each side in the boot band (below any cape).
    band = slice_verts(0.08 * H, 0.16 * H)
    for side, sgn in (("Left", 1), ("Right", -1)):
        pts = [p for p in band if p.x * sgn > 0.01 * H]
        c = sum(pts, Vector()) / len(pts)
        L[f"{side}LegX"] = c.x
        L[f"{side}LegY"] = c.y
        toes = [p for p in slice_verts(0, 0.04 * H) if p.x * sgn > 0]
        L[f"{side}ToeY"] = min(p.y for p in toes)
    # Hands: furthest-out vertices in the arm band.
    arm = slice_verts(0.38 * H, 0.70 * H)
    for side, sgn in (("Left", 1), ("Right", -1)):
        pts = sorted((p for p in arm if p.x * sgn > 0), key=lambda p: -p.x * sgn)
        tip = pts[0]
        near = [p for p in pts if (p - tip).length < 0.06 * H]
        L[f"{side}HandTip"] = tip
        L[f"{side}Hand"] = sum(near, Vector()) / len(near)
    # Torso depth centre at chest height, ignoring the cape (front half only).
    chest = [p for p in slice_verts(0.70 * H, 0.74 * H) if abs(p.x) < 0.08 * H]
    L["ChestY"] = (min(p.y for p in chest) + max(p.y for p in chest)) / 2 if chest else 0
    return L


def strip_arm_weights_from_cape(arm_obj, H, cy):
    """Cloth hanging behind the body (a cape) must follow the spine and legs, not the
    arms: bone heat happily gives it arm weight because the arms are the nearest bones."""
    arm_bones = {b.name for b in arm_obj.data.bones
                 if any(k in b.name for k in ("Arm", "Hand", "Shoulder"))}
    idx = {g.index: g.name for g in low.vertex_groups}
    groups = {g.name: g for g in low.vertex_groups}
    behind = cy + 0.06 * H
    changed = 0
    for v in low.data.vertices:
        if v.co.y <= behind or v.co.z > 0.80 * H:
            continue
        ws = {idx[g.group]: g.weight for g in v.groups}
        if not any(n in arm_bones for n in ws):
            continue
        keep = {n: w for n, w in ws.items() if n not in arm_bones and w > 0}
        if not keep:
            keep = {("Spine2" if v.co.z > 0.67 * H else "Spine" if v.co.z > 0.55 * H else "Hips"): 1.0}
        total = sum(keep.values())
        for n in ws:
            groups[n].remove([v.index])
        for n, w in keep.items():
            groups[n].add([v.index], w / total, "REPLACE")
        changed += 1
    log(f"cape: moved {changed} vertices off the arm bones")


def build_rig(H):
    L = landmarks(H)
    cy = L["ChestY"]
    arm_obj = bpy.data.objects.new("Armature", bpy.data.armatures.new("Armature"))
    bpy.context.scene.collection.objects.link(arm_obj)
    select_only(arm_obj)
    bpy.ops.object.mode_set(mode="EDIT")
    eb = arm_obj.data.edit_bones

    def bone(name, head, tail, parent=None, connect=False):
        b = eb.new(name)
        b.head, b.tail = Vector(head), Vector(tail)
        if parent:
            b.parent = eb[parent]
            b.use_connect = connect
        return b

    hip_z = 0.53 * H
    bone("Hips", (0, cy, hip_z), (0, cy, 0.60 * H))
    bone("Spine", (0, cy, 0.60 * H), (0, cy, 0.67 * H), "Hips", True)
    bone("Spine1", (0, cy, 0.67 * H), (0, cy, 0.74 * H), "Spine", True)
    bone("Spine2", (0, cy, 0.74 * H), (0, cy, 0.82 * H), "Spine1", True)
    bone("Neck", (0, cy, 0.82 * H), (0, cy, 0.87 * H), "Spine2", True)
    bone("Head", (0, cy, 0.87 * H), (0, cy, 1.0 * H), "Neck", True)

    for side, sgn in (("Left", 1), ("Right", -1)):
        sh = Vector((sgn * 0.11 * H, cy, 0.805 * H))
        hand = L[f"{side}Hand"]
        tip = L[f"{side}HandTip"]
        # wrist sits a hand-length back from the hand centre toward the shoulder
        wrist = hand + (sh - hand).normalized() * 0.04 * H
        elbow = sh.lerp(wrist, 0.5) + Vector((0, 0.015 * H, 0))  # slight bend back
        bone(f"{side}Shoulder", (sgn * 0.02 * H, cy, 0.79 * H), sh, "Spine2")
        bone(f"{side}Arm", sh, elbow, f"{side}Shoulder", True)
        bone(f"{side}ForeArm", elbow, wrist, f"{side}Arm", True)
        bone(f"{side}Hand", wrist, tip, f"{side}ForeArm", True)

        lx, ly = L[f"{side}LegX"], L[f"{side}LegY"]
        top = Vector((sgn * 0.09 * H, cy, hip_z - 0.02 * H))
        ankle = Vector((lx, ly + 0.01 * H, 0.05 * H))
        knee = top.lerp(ankle, 0.5) + Vector((0, -0.01 * H, 0))  # slight bend forward
        bone(f"{side}UpLeg", top, knee, "Hips")
        bone(f"{side}Leg", knee, ankle, f"{side}UpLeg", True)
        ball = Vector((lx, L[f"{side}ToeY"] + 0.05 * H, 0.015 * H))
        bone(f"{side}Foot", ankle, ball, f"{side}Leg", True)
        bone(f"{side}ToeBase", ball, Vector((lx, L[f"{side}ToeY"], 0.015 * H)), f"{side}Foot", True)

    for b in eb:  # consistent rolls: Z axis forward-ish for limbs
        b.roll = 0
    bpy.ops.armature.select_all(action="SELECT")
    bpy.ops.armature.calculate_roll(type="GLOBAL_NEG_Y")
    bpy.ops.object.mode_set(mode="OBJECT")

    # Bone heat needs a clean, closed, evenly spaced surface. Solve it on a coarse
    # voxel proxy of the mesh, then copy the weights onto the real mesh.
    proxy = low.copy()
    proxy.data = low.data.copy()
    proxy.name = "weight_proxy"
    bpy.context.scene.collection.objects.link(proxy)
    proxy.modifiers.clear()
    select_only(proxy)
    proxy.data.remesh_voxel_size = 0.012 * H / a.height
    bpy.ops.object.voxel_remesh()
    select_only(proxy, arm_obj, active=arm_obj)
    bpy.ops.object.parent_set(type="ARMATURE_AUTO")
    pw = sum(1 for v in proxy.data.vertices if v.groups)
    log(f"proxy {len(proxy.data.polygons)} faces, weighted {pw}/{len(proxy.data.vertices)}")

    if pw > 0.95 * len(proxy.data.vertices):
        for b in arm_obj.data.bones:
            low.vertex_groups.new(name=b.name)
        dt = low.modifiers.new("weights", "DATA_TRANSFER")
        dt.object = proxy
        dt.use_vert_data = True
        dt.data_types_verts = {"VGROUP_WEIGHTS"}
        dt.vert_mapping = "POLYINTERP_NEAREST"
        dt.layers_vgroup_select_src = "ALL"
        dt.layers_vgroup_select_dst = "NAME"
        select_only(low)
        bpy.ops.object.modifier_apply(modifier=dt.name)
        bpy.ops.object.vertex_group_limit_total(group_select_mode="ALL", limit=4)
        bpy.ops.object.vertex_group_normalize_all(lock_active=False)
    else:
        log("proxy bone heat failed; using envelope weights")
        select_only(low, arm_obj, active=arm_obj)
        bpy.ops.object.parent_set(type="ARMATURE_ENVELOPE")
    bpy.data.objects.remove(proxy, do_unlink=True)
    strip_arm_weights_from_cape(arm_obj, H, cy)

    select_only(low, arm_obj, active=arm_obj)
    bpy.ops.object.parent_set(type="ARMATURE_NAME") if not low.find_armature() else None
    if not low.find_armature():
        mod = low.modifiers.new("Armature", "ARMATURE")
        mod.object = arm_obj
        low.parent = arm_obj
    weighted = sum(1 for v in low.data.vertices if v.groups)
    log(f"rig: {len(arm_obj.data.bones)} bones, weighted verts {weighted}/{len(low.data.vertices)}")
    if weighted < 0.95 * len(low.data.vertices):
        log("WARNING: automatic weights missed some vertices")
    return arm_obj


rig = None
if not a.no_rig:
    # Bone-heat weighting fails at human scale (tiny distances); solve at 10x, then
    # scale armature + mesh back together, which keeps the skin binding intact.
    K = 10.0
    for v in low.data.vertices:
        v.co *= K
    rig = build_rig(a.height * K)
    rig.scale = (1 / K, 1 / K, 1 / K)
    bpy.context.view_layer.update()
    select_only(rig, low, active=rig)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    zmax = max((low.matrix_world @ v.co).z for v in low.data.vertices)
    log(f"rescaled rig; mesh height now {zmax:.3f} m")

# ---------------------------------------------------------------- 5. export
base = os.path.join(a.out_dir, a.name)
bpy.ops.wm.save_as_mainfile(filepath=base + ".blend")
select_only(*([low] + ([rig] if rig else [])))
bpy.ops.export_scene.gltf(
    filepath=base + ".glb", export_format="GLB", use_selection=True,
    export_yup=True, export_skins=True, export_animations=False,
    export_image_format="JPEG", export_jpeg_quality=90,
)
bpy.ops.export_scene.fbx(
    filepath=base + ".fbx", use_selection=True, object_types={"ARMATURE", "MESH"},
    add_leaf_bones=False, path_mode="COPY", embed_textures=True,
    bake_anim=False, apply_scale_options="FBX_SCALE_ALL",
)
log("wrote", base + ".blend/.glb/.fbx")
