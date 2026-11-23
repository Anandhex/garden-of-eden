"""Humanoid monster peoples built from the Garden of Eden base body (snapshot in source/human_base/, Blender Studio CC0 mesh).

    Blender -b -P art3d/creatures/monsters.py -- [species ...]      (default: all)

One Unity-Humanoid armature (55 bones, same names as art3d/characters) per creature plus extra non-humanoid bones (tail, wings),
so the CC0 humanoid clips retarget. Per species: proportions (rest-pose bone scaling), baked body shape mix, a small set of
remaining blend shapes (variety), species parts as separate meshes (ears, snouts, horns, tusks, tails, spines), a painted
skin/face/eye atlas.
"""
import bpy, sys, os, math, json, random
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib
from lib import *

SNAP = os.path.join(SRC, "human_base", "base_body.fbx")
META = json.load(open(os.path.join(SRC, "human_base", "base_body_meta.json")))
JO = json.load(open(os.path.join(SRC, "human_base", "joint_offsets.json")))["offsets"]
LM = META["landmarks"]
TEXDIR = os.path.join(EXPORT, "textures")

BODY = ["Mesh_Head", "Mesh_Torso", "Mesh_Arms", "Mesh_Hands", "Mesh_Legs", "Mesh_Feet"]
# shape keys that stay on the body meshes as variety (everything else is baked or removed)
KEEP_KEYS = ["Belly", "Heavy", "Thin", "Muscle", "Chest_Muscle", "Arms_Thick", "Legs_Thick", "Waist_Wide", "Age_Old",
             "Shoulders", "Jaw_Wide", "Brow_Ridge", "Face_Long", "Cheeks_Full", "Eye_Big"]
RESULTS = {}


# ------------------------------------------------------------------ loading / shaping
def load_base(keep_parts, drop=()):
    reset()
    bpy.ops.import_scene.fbx(filepath=SNAP)
    arm = bpy.data.objects["Armature"]
    for o in list(bpy.data.objects):
        if o.type == 'EMPTY' or (o.type == 'MESH' and (o.name in drop or (o.name not in BODY and o.name not in keep_parts))):
            bpy.data.objects.remove(o)
    meshes = {o.name: o for o in bpy.data.objects if o.type == 'MESH'}
    head = meshes["Mesh_Head"]
    # landmark vertex indices (nearest vertex of the neutral head)
    idx = {}
    wm = head.matrix_world
    pts = [wm @ v.co for v in head.data.vertices]
    def nearest(p):
        p = Vector(p)
        return min(range(len(pts)), key=lambda i: (pts[i] - p).length_squared)
    idx["eye_l"] = nearest(LM["eye"])
    idx["eye_r"] = nearest((-LM["eye"][0], LM["eye"][1], LM["eye"][2]))
    idx["ear_l"] = nearest(LM["ear"])
    idx["ear_r"] = nearest((-LM["ear"][0], LM["ear"][1], LM["ear"][2]))
    idx["nose"] = nearest(LM["nose"])
    idx["nose_tip"] = nearest(LM["nose_tip"])
    idx["chin"] = nearest(LM["chin_front"])
    idx["top"] = max(range(len(pts)), key=lambda i: pts[i].z)
    idx["back"] = min(range(len(pts)), key=lambda i: -pts[i].y)
    idx["side_l"] = max(range(len(pts)), key=lambda i: pts[i].x)
    arm["lm_idx"] = json.dumps(idx)
    return arm, meshes, idx


def lm(head, idx, name):
    return head.matrix_world @ head.data.vertices[idx[name]].co


def bake_shapes(meshes, bake):
    """Add weight*(key - basis) of each baked shape into the Basis (and shift all other keys by the same delta)."""
    for m in meshes:
        sk = m.data.shape_keys
        if not sk:
            continue
        kb = sk.key_blocks
        n = len(m.data.vertices)
        def arr(k):
            a = np.zeros(n * 3, np.float32); k.data.foreach_get("co", a); return a
        basis = arr(kb[0])
        delta = np.zeros_like(basis)
        for nm, w in bake.items():
            if nm in kb:
                delta += w * (arr(kb[nm]) - basis)
        if not delta.any():
            continue
        for k in kb:
            k.data.foreach_set("co", arr(k) + delta)
        m.data.vertices.foreach_set("co", basis + delta)
        m.data.update()


def prune_keys(meshes, keep):
    for m in meshes:
        sk = m.data.shape_keys
        if not sk:
            continue
        for k in list(sk.key_blocks)[1:]:
            if k.name not in keep:
                m.shape_key_remove(k)
        if len(m.data.shape_keys.key_blocks) == 1:
            m.shape_key_remove(m.data.shape_keys.key_blocks[0])


def drop_keys(objs):
    for m in objs:
        if m.data.shape_keys:
            m.shape_key_clear()


def apply_joint_offsets(arm, bake):
    """Move bones the way the baked shapes move the skeleton (joint_offsets.json: Blender axes, per shape at weight 1)."""
    off = {}
    for sh, w in bake.items():
        for b, d in JO.get(sh, {}).items():
            cur = off.get(b, Vector((0, 0, 0)))
            off[b] = cur + Vector(d) * w
    if not off:
        return
    activate(arm)
    mode('EDIT')
    eb = arm.data.edit_bones
    orig = {b.name: (b.head.copy(), b.tail.copy(), [c.name for c in b.children if c.use_connect]) for b in eb}
    for n, (h, t, conn) in orig.items():
        dh = off.get(n, Vector((0, 0, 0)))
        dt = off.get(conn[0], dh) if conn else dh
        eb[n].head = h + dh
        eb[n].tail = t + dt
    mode('OBJECT')


def restyle_keys(arm, meshes, scales):
    """Rest-pose bone scaling for meshes that carry shape keys: evaluates every kept key under the scaled pose, writes the
    results back as the new basis/keys, then applies the pose as the new rest pose."""
    if not scales:
        return
    activate(arm)
    for pb in arm.pose.bones:
        pb.location = (0, 0, 0); pb.rotation_quaternion = (1, 0, 0, 0); pb.scale = (1, 1, 1)
    for n, s in scales.items():
        arm.pose.bones[n].scale = s
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    for m in meshes:
        sk = m.data.shape_keys
        n = len(m.data.vertices)
        def ev():
            bpy.context.view_layer.update()
            e = m.evaluated_get(bpy.context.evaluated_depsgraph_get())
            a = np.zeros(n * 3, np.float32)
            e.data.vertices.foreach_get("co", a)
            return a
        if not sk:
            m.data.vertices.foreach_set("co", ev()); m.data.update(); continue
        kb = sk.key_blocks
        for k in kb:
            k.value = 0.0
        base = ev()
        res = {}
        for k in list(kb)[1:]:
            k.value = 1.0
            res[k.name] = ev()
            k.value = 0.0
        kb[0].data.foreach_set("co", base)
        for k in list(kb)[1:]:
            k.data.foreach_set("co", res[k.name])
        m.data.vertices.foreach_set("co", base)
        m.data.update()
    # drop the armature modifier effect: set pose as rest
    mode_prev = bpy.context.object.mode if bpy.context.object else 'OBJECT'
    activate(arm)
    bpy.ops.object.mode_set(mode='POSE')
    bpy.ops.pose.armature_apply(selected=False)
    bpy.ops.object.mode_set(mode='OBJECT')


def unify_normals(meshes):
    """Smooth normals computed over the welded body (parts share seam vertices, so seams stay invisible)."""
    acc = {}
    def key(p):
        return (round(p.x * 2000), round(p.y * 2000), round(p.z * 2000))
    for m in meshes:
        me = m.data
        W = m.matrix_world
        for poly in me.polygons:
            n = W.to_3x3() @ poly.normal * poly.area
            for vi in poly.vertices:
                k = key(W @ me.vertices[vi].co)
                acc[k] = acc.get(k, Vector((0, 0, 0))) + n
    for m in meshes:
        me = m.data
        W = m.matrix_world
        vn = []
        for v in me.vertices:
            n = acc.get(key(W @ v.co), Vector((0, 0, 1)))
            n = (W.to_3x3().inverted() @ n)
            vn.append(n.normalized() if n.length > 0 else Vector((0, 0, 1)))
        for p in me.polygons:
            p.use_smooth = True
        try:
            me.normals_split_custom_set_from_vertices([tuple(n) for n in vn])
        except Exception as e:
            print("normals", e)


# ------------------------------------------------------------------ extra bones, tubes, parts
def add_bones(arm, specs):
    """specs: [(name, head, tail, parent)] added in one edit session."""
    activate(arm)
    mode('EDIT')
    for name, h, t, parent in specs:
        b = arm.data.edit_bones.new(name)
        b.head, b.tail = Vector(h), Vector(t)
        if parent:
            b.parent = arm.data.edit_bones[parent]
        b.use_deform = True
    mode('OBJECT')


def loft(name, arm, rings, mat, bone="Head", sides=14, expo=2.0):
    """rings: [(center, rx, rz)] along any direction; superellipse cross-sections in the XZ plane (expo 2 = ellipse, >2 boxier).
    Closed with a fan at the last ring; first ring left open (hidden in the head)."""
    verts, faces = [], []
    for c, rx, rz in rings:
        for s in range(sides):
            a = 2 * math.pi * s / sides
            ca, sa = math.cos(a), math.sin(a)
            x = rx * math.copysign(abs(ca) ** (2 / expo), ca)
            z = rz * math.copysign(abs(sa) ** (2 / expo), sa)
            verts.append((c[0] + x, c[1], c[2] + z))
    n = len(rings)
    for i in range(n - 1):
        for s in range(sides):
            a = i * sides + s; b = i * sides + (s + 1) % sides
            faces.append((a, b, b + sides, a + sides))
    c = Vector(rings[-1][0]) + (Vector(rings[-1][0]) - Vector(rings[-2][0])).normalized() * rings[-1][1] * 0.15
    ci = len(verts); verts.append(tuple(c))
    for s in range(sides):
        a = (n - 1) * sides + s; b = (n - 1) * sides + (s + 1) % sides
        faces.append((b, a, ci))
    ob = new_mesh_obj(name, verts, faces, mat)
    weight_all(ob, bone, arm)
    return ob


def xform_part(ob, pivot, scale=(1, 1, 1), rot=(0, 0, 0), move=(0, 0, 0), mirror_x=False):
    """Scale about pivot, rotate (euler, about pivot) and move the vertices of a part in place."""
    R = Euler(rot).to_matrix()
    for v in ob.data.vertices:
        p = v.co - Vector(pivot)
        p = Vector((p.x * scale[0], p.y * scale[1], p.z * scale[2]))
        p = R @ p
        v.co = p + Vector(pivot) + Vector(move)
    ob.data.update()


from mathutils import Euler  # noqa: E402


def skin_back_y(meshes, z, width=0.04):
    best = -9
    for m in meshes:
        for v in m.data.vertices:
            if abs(v.co.x) < width and abs(v.co.z - z) < 0.03:
                best = max(best, v.co.y)
    return best


def skin_front_y(meshes, z, width=0.04):
    best = 9
    for m in meshes:
        for v in m.data.vertices:
            if abs(v.co.x) < width and abs(v.co.z - z) < 0.03:
                best = min(best, v.co.y)
    return best


def spike_row(name, arm, items, mat, flat=0.35):
    """items: [(bone, base, tip, radius)] flat cones each rigid to its bone."""
    objs = []
    for bn, base, tip, r in items:
        o = cone_mesh(name + "_" + bn, base, tip, r, 0.0, sides=4, rings=1, mat=mat, flat=flat)
        weight_all(o, bn, arm)
        objs.append(o)
    return join(objs, name)


# ------------------------------------------------------------------ atlas texture
def paint_atlas(spec, name):
    N = 1024
    img = bpy.data.images.new(name + "_atlas", N, N, alpha=False)
    img.colorspace_settings.name = "sRGB"
    px = np.zeros((N, N, 4), np.float32)
    base = np.array(srgb_to_lin(spec["skin"]), np.float32)
    px[..., :3] = base
    px[..., 3] = 1
    rng = np.random.RandomState(spec.get("seed", 1))
    yy, xx = np.mgrid[0:N, 0:N].astype(np.float32)
    # gentle large-scale tone variation on the body quadrant (matte, not noisy)
    low = rng.rand(16, 16).astype(np.float32)
    big = np.kron(low, np.ones((N // 16, N // 16), np.float32))
    for _ in range(3):
        big = (big + np.roll(big, 3, 0) + np.roll(big, -3, 1) + np.roll(big, 5, 1)) / 4
    for k in range(3):
        px[..., k] *= (0.96 + 0.08 * big)
    def paint(mask, col, alpha=1.0):
        a = np.clip(mask, 0, 1) * alpha
        for k in range(3):
            px[..., k] = px[..., k] * (1 - a) + col[k] * a
    def band(d, w=0.0005):
        return np.clip(0.5 - d / w, 0, 1)
    # spots / patches over the whole sheet (gnoll spots, troll moss, lizard stripes)
    pat = spec.get("pattern")
    if pat:
        kind, col, cnt, rad = pat
        col = srgb_to_lin(col)
        mask = np.zeros((N, N), np.float32)
        for _ in range(cnt):
            cx, cy = rng.rand() * N, rng.rand() * N
            r = rad * N * (0.5 + rng.rand())
            if kind == "spots":
                mask = np.maximum(mask, np.clip(1 - np.sqrt(((xx - cx) / r) ** 2 + ((yy - cy) / (r * 0.8)) ** 2), 0, 1) ** 0.4 > 0.5)
            else:  # soft patches
                mask = np.maximum(mask, np.clip(1 - np.sqrt(((xx - cx) / (r * 2)) ** 2 + ((yy - cy) / (r * 2)) ** 2), 0, 1) ** 1.5)
        mask *= ((xx >= N / 2) & (yy < N / 2))
        paint(mask, col, spec.get("pattern_alpha", 0.85))
    # ---- swatches (bottom-left quadrant, 4x4 flat colour cells, uv-assigned to generated parts)
    sw = swatches(spec)
    for k, col in enumerate(sw):
        cx, cy = (k % 4) * 128, (k // 4) * 128
        px[cy:cy + 128, cx:cx + 128, :3] = srgb_to_lin(col)
    # ---- face decal (u 0..0.5, v 0.5..1)  world rect x +-0.11, z 1.50..1.72 of the neutral head
    wr = META["faceWorldRect"]
    X = wr["x0"] + (xx + 0.5) / N * 2 * (wr["x1"] - wr["x0"])
    Z = wr["z0"] + ((yy + 0.5) / N - 0.5) * 2 * (wr["z1"] - wr["z0"])
    inface = (xx < N / 2) & (yy >= N / 2)
    ex, ez, er = LM["eye_x"], LM["eye"][2], LM["eye_r"]
    mz = LM["chin"] + 0.41 * (ez - LM["chin"])
    dark = srgb_to_lin(spec.get("line", "#2b211c"))
    for sx in (-1, 1):
        bx = (X - sx * (ex + 0.004)) * sx
        bz = ez + spec.get("brow_h", 0.040) + 0.006 * (1 - (bx / 0.026) ** 2) - spec.get("brow_tilt", 0.0) * bx / 0.026
        thick = spec.get("brow_w", 0.0055) * np.clip(1.0 - np.abs(bx / 0.030) ** 3, 0, 1) + 0.0008
        paint(band(np.abs(Z - bz) - thick) * (np.abs(bx) < 0.03) * inface, dark, 0.85)
        # lower lid line / eye socket shadow
        d2 = ((X - sx * ex) / 0.034) ** 2 + ((Z - (ez - 0.004)) / 0.024) ** 2
        paint(np.exp(-d2 * 1.4) * inface, srgb_to_lin(spec.get("socket", "#5a4036")), 0.32)
    if spec.get("mouth", True):
        w = spec.get("mouth_w", 0.034)
        s_ = np.clip(1 - (X / w) ** 2, 0, 1)
        paint(band(np.abs(Z - (mz + 0.002 * (1 - s_ ** 0.5) * spec.get("mouth_curve", 1))) - 0.0016) * (np.abs(X) < w) * inface, dark, 0.9)
        lip = srgb_to_lin(spec.get("lip", "#7a4a40"))
        paint(band(np.maximum(np.abs(Z - mz + 0.001) - 0.0055 * s_ ** 0.8, 0)) * (np.abs(X) < w) * inface, lip, 0.45)
    # ---- eyeballs in the top-right quadrant (left [0.5,0.75], right [0.75,1.0])
    for q in (0, 1):
        cu, cv = 0.625 + 0.25 * q, 0.875
        uu = (xx + 0.5) / N - cu
        vv = (yy + 0.5) / N - cv
        inq = (np.abs(uu) <= 0.125) & (np.abs(vv) <= 0.125)
        rr = np.sqrt(uu ** 2 + vv ** 2)
        scl = srgb_to_lin(spec.get("sclera", "#e8e0cc"))
        for k in range(3):
            px[..., k] = np.where(inq, scl[k], px[..., k])
        iris = spec.get("iris", "#b0903a")
        ir = spec.get("iris_r", 0.078)
        paint(inq * band(rr - ir, 0.004), srgb_to_lin(iris))
        paint(inq * band(rr - ir, 0.004) * np.clip((rr / ir) ** 3, 0, 1), srgb_to_lin(spec.get("iris_rim", "#5a4420")), 0.7)
        pw, ph = spec.get("pupil", (0.040, 0.040))
        paint(inq * band(np.sqrt((uu / pw) ** 2 + (vv / ph) ** 2) - 1.0, 0.06), srgb_to_lin("#15110f"))
        g = np.sqrt((uu + 0.03) ** 2 + (vv - 0.035) ** 2)
        paint(inq * band(g - 0.014, 0.003), (1, 1, 1), 0.9)
    img.pixels.foreach_set(np.ascontiguousarray(px, dtype=np.float32).ravel())
    os.makedirs(TEXDIR, exist_ok=True)
    img.filepath_raw = os.path.join(TEXDIR, name + "_atlas.png")
    img.file_format = 'PNG'
    img.save()
    return img


def swatches(spec):
    skin = spec["skin"]
    return [skin, spec.get("horn", "#cfc4aa"), spec.get("ivory", "#e6dec8"), spec.get("dark", "#2e2622"), spec.get("hair", "#4a3a2e"),
            spec.get("spine", "#7a6a50"), spec.get("claw", "#3d342e"), spec.get("mouth_in", "#6a3a38"), spec.get("belly", skin),
            spec.get("accent", skin), spec.get("feather", skin), spec.get("feather2", skin), spec.get("feather3", skin),
            spec.get("tail_tip", skin), spec.get("skin2", skin), spec.get("skin3", skin)]


SW = dict(skin=0, horn=1, ivory=2, dark=3, hair=4, spine=5, claw=6, mouth_in=7, belly=8, accent=9, feather=10, feather2=11,
          feather3=12, tail_tip=13, skin2=14, skin3=15)


def set_swatch(ob, key):
    k = SW[key] if isinstance(key, str) else key
    u, v = ((k % 4) * 0.125 + 0.0625) * 1.0, ((k // 4) * 0.125 + 0.0625)
    uv = ob.data.uv_layers.new(name="UVMap") if not ob.data.uv_layers else ob.data.uv_layers[0]
    for l in ob.data.loops:
        uv.data[l.index].uv = (u, v)


def srgb_to_lin(c):
    if isinstance(c, str):
        h = c.lstrip('#')
        c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(c[:3])


def textured_mat(name, img):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    t = nt.nodes.new("ShaderNodeTexImage"); t.image = img
    nt.links.new(t.outputs["Color"], b.inputs["Base Color"])
    b.inputs["Roughness"].default_value = 0.85
    for k in ("Specular IOR Level", "Specular"):
        if k in b.inputs:
            b.inputs[k].default_value = 0.08
    return m


# ------------------------------------------------------------------ the species
def S(**kw):
    return kw


def both(name, val):
    return {"Left" + name: val, "Right" + name: val}


def merge(*ds):
    o = {}
    for d in ds:
        o.update(d)
    return o


SPECIES = {}


def build(name):
    sp = SPECIES[name]
    keep_parts = ["Part_Eye_L", "Part_Eye_R"] + sp.get("human_parts", [])
    arm, M, idx = load_base(keep_parts, sp.get('drop', ()))
    body = [M[n] for n in BODY if n in M]
    allm = list(M.values())
    head = M["Mesh_Head"]
    # 1. bake the species body mix, then move the skeleton the same way
    bake_shapes(allm, sp.get("bake", {}))
    apply_joint_offsets(arm, sp.get("bake", {}))
    # parts do not carry shape keys (they are scaled/posed per species); the body keeps the variety keys
    parts_h = [o for o in allm if o.name.startswith("Part_")]
    drop_keys(parts_h)
    prune_keys(body, KEEP_KEYS)
    # 2. proportions
    restyle_keys(arm, allm, sp.get("bones", {}))
    # 3. soft normals over the welded body
    if "pre_parts" in sp:
        sp["pre_parts"](arm, M, idx)
    # 4. look
    img = paint_atlas(sp, name)
    mat = textured_mat(name + "_Skin", img)
    for m in allm:
        for slot in m.material_slots:
            slot.material = mat
    extra = []
    ctx = dict(arm=arm, M=M, idx=idx, head=head, body=body, mat=mat, sp=sp, name=name)
    if "parts" in sp:
        extra = sp["parts"](ctx) or []
    # 5. height -> final scale
    top = max(v.co.z for v in head.data.vertices)
    s = sp["height"] / top
    everything = allm + extra
    unify_normals([o for o in allm])
    # rename
    for o in allm + extra:
        base = o.name.replace("Mesh_", "").replace("Part_", "")
        o.name = name + "_" + base
    arm.name = "Armature"; arm.data.name = "Armature"
    bake_scale(arm, everything, s)
    if 'clips' in sp:
        sp['clips'](arm)
    add_tail_clip(arm)
    out = os.path.join(EXPORT, name + ".fbx")
    export_fbx(out, [arm] + everything, 1.0, with_anim=bool(bpy.data.actions))
    tris = sum(tri_count(o) for o in everything)
    keys = sorted({k.name for m in body if m.data.shape_keys for k in m.data.shape_keys.key_blocks[1:]})
    RESULTS[name] = dict(kind="humanoid", height_m=sp["height"], tris=tris, bones=len(arm.data.bones),
                         blendshapes=keys, parts=[o.name for o in everything if not o.name.split('_', 1)[1] in
                                                  ("Head", "Torso", "Arms", "Hands", "Legs", "Feet")],
                         size_kb=os.path.getsize(out) // 1024, scale_applied=round(s, 4),
                         extra_bones=[b.name for b in arm.data.bones if b.name.startswith(('Tail', 'Wing'))])
    if os.environ.get("KEEP_BLEND"):
        os.makedirs(os.path.join(HERE, "blend"), exist_ok=True)
        bpy.ops.wm.save_as_mainfile(filepath=os.path.join(HERE, "blend", name + ".blend"))
    print("BUILT", name, RESULTS[name])
    return arm, everything


def add_tail_clip(arm):
    tails = sorted([b.name for b in arm.data.bones if b.name.startswith("Tail")])
    if not tails:
        return
    arm.animation_data_create()
    act = bpy.data.actions.new("Tail_Sway")
    arm.animation_data.action = act
    for i, bn in enumerate(tails):
        pb = arm.pose.bones[bn]
        pb.rotation_mode = 'XYZ'
        for f, a in ((1, 0.0), (30, 1.0), (60, 0.0), (90, -1.0), (120, 0.0)):
            pb.rotation_euler = (0, 0, math.radians(7 * a) * (1 + i * 0.4))
            pb.keyframe_insert("rotation_euler", frame=f)
        pb.rotation_euler = (0, 0, 0)
    for fc in act.fcurves:
        for k in fc.keyframe_points:
            k.interpolation = 'BEZIER'
    arm.animation_data.action = None
    # make it visible to the exporter
    act.use_fake_user = True


# ---------------------------- helpers used by species part builders
def ear_part(ctx, src, side, scale, rot, move=(0, 0, 0)):
    """Copy a human ear part (L/R) as a swappable mesh, scaled about the ear landmark."""
    pass


def head_frame(ctx):
    h = ctx["head"]; i = ctx["idx"]
    d = dict(eye_l=lm(h, i, "eye_l"), eye_r=lm(h, i, "eye_r"), ear_l=lm(h, i, "ear_l"), ear_r=lm(h, i, "ear_r"),
             nose=lm(h, i, "nose"), tip=lm(h, i, "nose_tip"), chin=lm(h, i, "chin"), top=lm(h, i, "top"),
             back=lm(h, i, "back"), side=lm(h, i, "side_l"))
    d["hw"] = d["side"].x                      # half width
    d["hh"] = d["top"].z - d["chin"].z         # head height (chin..crown)
    return d


def keep_human(ctx, names, scale=None, rot=None, move=None, pivot_lm=None):
    """Return the named human parts, optionally transformed about a landmark. Others are deleted."""
    pass


import wings
exec(open(os.path.join(HERE, "monster_species.py")).read())

if __name__ == "__main__":
    which = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else list(SPECIES)
    os.makedirs(os.path.join(HERE, "blend"), exist_ok=True)
    for n in which:
        build(n)
    p = os.path.join(EXPORT, "monsters_meta.json")
    old = json.load(open(p)) if os.path.exists(p) else {}
    old.update(RESULTS)
    json.dump(old, open(p, "w"), indent=1)
