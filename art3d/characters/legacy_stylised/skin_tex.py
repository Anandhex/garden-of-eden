"""Skin texture sets for the head (2026-11 face rework).

    Blender -b art3d/characters/base.blend -P art3d/characters/skin_tex.py [-- res=2048]

Mesh_Head, Part_Nose and Part_Ear_L/R share one 0..1 UV layout (UVMap, see head_build.head_uvs).  This script
  1. bakes helper maps with Cycles: object-space position, a mask map (mouth cavity, inner lids, part id), AO (eyes in place),
     pointiness (for cavity),
  2. paints in numpy, per texel, from the 3D position: a height field (subtle pores, lip lines, soft creases) and, for every skin
     tone, an albedo with natural variation (redness on nose, cheeks, ears, lips; cooler under/around the eyes and on the jaw;
     neutral on the neck so it meets the flat body colour),
  3. bakes the tangent-space normal map from the height field (Cycles, Bump node) and writes roughness, AO and cavity.
Stylised, not photographic: pores and lines are kept soft (art direction g8).  Outputs: export/textures/skin/*.png + skin_tones.json.
"""
import bpy, os, sys, json, math
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import common  # noqa: E402

OUT = os.path.join(common.EXPORT_DIR, "textures", "skin")
HEAD_OBJS = ["Mesh_Head", "Part_Nose", "Part_Ear_L", "Part_Ear_R"]
META = json.load(open(os.path.join(common.EXPORT_DIR, "base_body_meta.json")))

# display (sRGB) base colours of the tone ranges; 'blush' = how strong the red zones read on that tone
TONES = {
    "T1_pale":   dict(base=(0.96, 0.80, 0.72), red=(0.90, 0.45, 0.42), lip=(0.80, 0.42, 0.44), blush=1.00),
    "T2_fair":   dict(base=(0.92, 0.68, 0.55), red=(0.88, 0.40, 0.36), lip=(0.72, 0.32, 0.36), blush=1.0),
    "T3_medium": dict(base=(0.84, 0.60, 0.45), red=(0.80, 0.38, 0.30), lip=(0.66, 0.33, 0.31), blush=0.75),
    "T4_olive":  dict(base=(0.72, 0.52, 0.36), red=(0.70, 0.34, 0.24), lip=(0.56, 0.29, 0.26), blush=0.60),
    "T5_brown":  dict(base=(0.55, 0.36, 0.24), red=(0.55, 0.24, 0.17), lip=(0.42, 0.21, 0.19), blush=0.50),
    "T6_deep":   dict(base=(0.36, 0.23, 0.16), red=(0.38, 0.16, 0.12), lip=(0.28, 0.14, 0.13), blush=0.45),
    "orc_green": dict(base=(0.50, 0.62, 0.38), red=(0.58, 0.48, 0.30), lip=(0.40, 0.42, 0.30), blush=0.50),
}


def srgb_to_lin(c):
    c = np.asarray(c, float)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def lin_to_srgb(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055)


def S(a, b, x):
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


# ------------------------------------------------------------------------------------------------ numpy 3D value noise
def _hash(ix, iy, iz, seed):
    h = (ix * 374761393 + iy * 668265263 + iz * 1274126177 + seed * 1442695041) & 0xFFFFFFFF
    h = ((h ^ (h >> 13)) * 1274126177) & 0xFFFFFFFF
    return ((h ^ (h >> 16)) & 0xFFFF) / 65535.0


def vnoise(P, freq, seed=0):
    """smooth value noise in [0,1] at points P (N,3) with frequency in cycles per metre."""
    Q = P * freq
    i0 = np.floor(Q).astype(np.int64)
    f = Q - i0
    u = f * f * (3 - 2 * f)
    out = np.zeros(len(P))
    for dx in (0, 1):
        for dy in (0, 1):
            for dz in (0, 1):
                w = (u[:, 0] if dx else 1 - u[:, 0]) * (u[:, 1] if dy else 1 - u[:, 1]) * (u[:, 2] if dz else 1 - u[:, 2])
                out += w * _hash(i0[:, 0] + dx, i0[:, 1] + dy, i0[:, 2] + dz, seed)
    return out


def fbm(P, freq, octaves=4, seed=0):
    a, tot, out = 1.0, 0.0, np.zeros(len(P))
    for o in range(octaves):
        out += a * vnoise(P, freq * 2 ** o, seed + o * 17)
        tot += a
        a *= 0.5
    return out / tot


def cells(P, freq, seed=0):
    """distance to the nearest jittered cell point (Worley F1), ~0 at pore centres."""
    Q = P * freq
    i0 = np.floor(Q).astype(np.int64)
    best = np.full(len(P), 9.0)
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            for dz in (-1, 0, 1):
                c = i0 + np.array([dx, dy, dz])
                jit = np.stack([_hash(c[:, 0], c[:, 1], c[:, 2], seed + k) for k in range(3)], axis=1)
                d = np.linalg.norm(Q - (c + jit), axis=1)
                best = np.minimum(best, d)
    return best


# ------------------------------------------------------------------------------------------------ baking helpers
def setup_bake(res):
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = 1
    sc.render.bake.margin = 16
    sc.render.bake.margin_type = 'EXTEND'
    return sc


def head_objects():
    return [bpy.data.objects[n] for n in HEAD_OBJS]


def bake_to(img, objs, kind, mat_builder):
    """give every object a temporary material whose active image node is img, bake, restore."""
    saved = {}
    for o in objs:
        saved[o.name] = [m for m in o.data.materials]
        m = mat_builder(img)
        o.data.materials.clear()
        o.data.materials.append(m)
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.hide_set(False)
        o.hide_render = False
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    sc = bpy.context.scene
    if kind == 'EMIT':
        bpy.ops.object.bake(type='EMIT', use_clear=True)
    elif kind == 'AO':
        sc.cycles.samples = 96
        bpy.ops.object.bake(type='AO', use_clear=True)
        sc.cycles.samples = 1
    elif kind == 'NORMAL':
        sc.cycles.samples = 4
        bpy.ops.object.bake(type='NORMAL', normal_space='TANGENT', use_clear=True)
        sc.cycles.samples = 1
    for o in objs:
        o.data.materials.clear()
        for m in saved[o.name]:
            o.data.materials.append(m)


def new_image(name, res, float_buf=True):
    img = bpy.data.images.new(name, res, res, alpha=False, float_buffer=float_buf)
    img.colorspace_settings.name = "Non-Color"
    return img


def emit_mat(img, colour_fn):
    m = bpy.data.materials.new("bake_tmp")
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    em = nt.nodes.new("ShaderNodeEmission")
    nt.links.new(em.outputs[0], out.inputs[0])
    colour_fn(nt, em.inputs[0])
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = img
    nt.nodes.active = tex
    return m


def pixels(img):
    a = np.empty(img.size[0] * img.size[1] * 4, dtype=np.float32)
    img.pixels.foreach_get(a)
    return a.reshape(img.size[1], img.size[0], 4)


def save(arr, path, srgb=False, mode="RGB"):
    """arr (H,W,3|1) in 0..1; srgb=True writes display values given LINEAR input."""
    if arr.ndim == 2:
        arr = arr[..., None]
    if srgb:
        arr = lin_to_srgb(arr)
    h, w = arr.shape[:2]
    rgba = np.ones((h, w, 4), dtype=np.float32)
    if arr.shape[2] == 1:
        rgba[..., :3] = arr
    else:
        rgba[..., :3] = arr[..., :3]
    img = bpy.data.images.new("save_tmp", w, h, alpha=False, float_buffer=False)
    img.colorspace_settings.name = "Non-Color"
    img.pixels.foreach_set(np.clip(rgba, 0, 1).ravel())
    img.filepath_raw = path
    img.file_format = 'PNG'
    img.save()
    bpy.data.images.remove(img)


# ------------------------------------------------------------------------------------------------ masks on vertices
def store_masks(objs):
    """float colour attribute 'BakeMask': r = mouth cavity (material Mouth_Inner), g = ear, b = nose."""
    for o in objs:
        me = o.data
        if "BakeMask" in me.color_attributes:
            me.color_attributes.remove(me.color_attributes["BakeMask"])
        ca = me.color_attributes.new("BakeMask", 'FLOAT_COLOR', 'POINT')
        vals = np.zeros((len(me.vertices), 4), np.float32)
        vals[:, 3] = 1
        mi = {i: m.name for i, m in enumerate(me.materials)}
        for p in me.polygons:
            if mi.get(p.material_index, "") == "Mouth_Inner":
                for v in p.vertices:
                    vals[v, 0] = 1
        if o.name.startswith("Part_Ear"):
            vals[:, 1] = 1
        if o.name.startswith("Part_Nose"):
            vals[:, 2] = 1
        ca.data.foreach_set('color', vals.ravel())


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    res = 2048
    for a in argv:
        if a.startswith("res="):
            res = int(a[4:])
    os.makedirs(OUT, exist_ok=True)
    sc = setup_bake(res)
    objs = head_objects()
    for o in bpy.data.objects:
        if o.type == 'MESH':
            o.hide_render = True
    for o in objs:
        o.data.shape_keys.reference_key.value = 0 if False else o.data.shape_keys.reference_key.value
        for k in o.data.shape_keys.key_blocks[1:]:
            k.value = 0.0
    arm = bpy.data.objects["Armature"]
    arm.data.pose_position = 'REST'
    store_masks(objs)
    lo = np.array([-0.15, -0.20, 1.35])
    rng = 0.40

    def pos_col(nt, sock):
        g = nt.nodes.new("ShaderNodeNewGeometry")
        mp = nt.nodes.new("ShaderNodeVectorMath")
        mp.operation = 'MULTIPLY_ADD'
        mp.inputs[1].default_value = (1 / rng,) * 3
        mp.inputs[2].default_value = tuple(-lo / rng)
        nt.links.new(g.outputs["Position"], mp.inputs[0])
        nt.links.new(mp.outputs[0], sock)

    def nrm_col(nt, sock):
        g = nt.nodes.new("ShaderNodeNewGeometry")
        mp = nt.nodes.new("ShaderNodeVectorMath")
        mp.operation = 'MULTIPLY_ADD'
        mp.inputs[1].default_value = (0.5,) * 3
        mp.inputs[2].default_value = (0.5,) * 3
        nt.links.new(g.outputs["Normal"], mp.inputs[0])
        nt.links.new(mp.outputs[0], sock)

    def mask_col(nt, sock):
        a = nt.nodes.new("ShaderNodeVertexColor")
        a.layer_name = "BakeMask"
        nt.links.new(a.outputs["Color"], sock)

    def point_col(nt, sock):
        g = nt.nodes.new("ShaderNodeNewGeometry")
        nt.links.new(g.outputs["Pointiness"], sock)

    maps = {}
    for nm, fn in (("pos", pos_col), ("nrm", nrm_col), ("mask", mask_col), ("point", point_col)):
        img = new_image("bk_" + nm, res)
        bake_to(img, objs, 'EMIT', lambda im, fn=fn: emit_mat(im, fn))
        maps[nm] = pixels(img)[..., :3].copy()
        print("baked", nm)
    # coverage: texels that belong to some island (position map is never exactly 0 inside the head box)
    covered = (np.linalg.norm(maps["pos"].reshape(-1, 3), axis=1) > 1e-4)
    P = (maps["pos"].reshape(-1, 3) * rng + lo)[covered]
    Nn = (maps["nrm"].reshape(-1, 3) * 2 - 1)[covered]
    M = maps["mask"].reshape(-1, 3)[covered]
    PT = maps["point"].reshape(-1, 3)[covered][:, 0]
    # AO with the eyeballs and lashes present (sockets and lash shadow), corneas hidden
    for n in ("Part_Eye_L", "Part_Eye_R"):
        bpy.data.objects[n].hide_render = False
    img = new_image("bk_ao", res)

    def ao_mat(im):
        m = bpy.data.materials.new("bake_ao")
        m.use_nodes = True
        t = m.node_tree.nodes.new("ShaderNodeTexImage")
        t.image = im
        m.node_tree.nodes.active = t
        return m
    sc.world = sc.world or bpy.data.worlds.new("W")
    sc.render.bake.use_selected_to_active = False
    bake_to(img, objs, 'AO', ao_mat)
    ao = pixels(img)[..., 0].reshape(-1)[covered].copy()
    print("baked ao")
    X, Y, Z = P[:, 0], P[:, 1], P[:, 2]
    ax, sgn = np.abs(X), np.sign(X)
    fr_ = META["faceRig"]
    mc = np.array(fr_["mouthCentre"])
    mw = fr_["mouthWidth"] / 2
    ec = np.array(fr_["eyeCentres"][0])
    er = fr_["eyeRadius"][0]
    lm = META["landmarks"]
    chin = lm["chin"]
    nose_tip = np.array(lm["nose_tip"])
    cav = M[:, 0]
    ear = M[:, 1]
    nose = M[:, 2]
    front = S(0.15, 0.55, -Nn[:, 1])
    # ---------------- lips (vermilion) mask, analytic around the mouth: cupid's bow on the upper lip
    xr = np.clip(ax / (mw * 1.02), 0, 1.5)
    up_h = 0.0068 * np.clip(1 - xr ** 2, 0, 1) ** 0.55 + 0.0012 * np.exp(-((ax - 0.0045) / 0.0028) ** 2) - 0.0010 * np.exp(-(X / 0.0022) ** 2)
    lo_h = 0.0085 * np.clip(1 - xr ** 2.2, 0, 1) ** 0.5
    dz = Z - mc[2]
    lips = np.where(dz >= 0, S(up_h + 0.0009, up_h - 0.0009, dz), S(-lo_h - 0.0010, -lo_h + 0.0010, dz))
    lips *= S(1.06, 0.96, xr) * S(mc[1] + 0.03, mc[1] + 0.012, Y) * (1 - cav) * (1 - nose)
    # ---------------- lash line: soft dark band along the upper lid margin (lash roots), lighter on the lower lid
    lash_line = np.zeros(len(P))
    for L in fr_.get("lidMargins", []):
        for key, wid, amt in (("upper", 0.0011, 1.0), ("lower", 0.0007, 0.45)):
            M_ = np.array(L[key])
            if len(M_) < 2:
                continue
            # dense polyline
            t = np.linspace(0, 1, 120)
            seg = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(M_, axis=0), axis=1))])
            Q = np.stack([np.interp(t * seg[-1], seg, M_[:, k]) for k in range(3)], 1)
            from_end = np.minimum(t, 1 - t) * seg[-1]
            near = np.linalg.norm(P - Q.mean(0), axis=1) < 0.05
            idx = np.nonzero(near)[0]
            d = np.full(len(idx), 9.0)
            fade = np.zeros(len(idx))
            for k in range(len(Q)):
                dk = np.linalg.norm(P[idx] - Q[k], axis=1)
                better = dk < d
                d[better] = dk[better]
                fade[better] = min(1.0, from_end[k] / 0.004)
            lash_line[idx] = np.maximum(lash_line[idx], amt * S(wid, wid * 0.3, d) * fade)
    # ---------------- regions
    d_eye = np.sqrt((ax - abs(ec[0])) ** 2 + ((Z - ec[2]) * 1.15) ** 2)
    under_eye = np.exp(-(((ax - abs(ec[0]) - 0.004) / 0.020) ** 2 + ((Z - (ec[2] - 0.024)) / 0.008) ** 2)) * front
    socket = S(er * 1.65, er * 1.05, d_eye) * front * (1 - S(ec[1] + 0.02, ec[1] - 0.01, Y) * 0)
    d_ball = np.linalg.norm(np.stack([ax - abs(ec[0]), Y - ec[1], Z - ec[2]], 1), axis=1)
    to_c = -np.stack([ax - abs(ec[0]), Y - ec[1], Z - ec[2]], 1) / (d_ball[:, None] + 1e-9)
    facing_ball = np.sum(np.stack([np.abs(Nn[:, 0]) * np.sign(Nn[:, 0] * sgn + 1e-9), Nn[:, 1], Nn[:, 2]], 1) * to_c, 1)
    inner_lid = S(er + 0.0025, er + 0.0008, d_ball) * S(0.15, 0.55, facing_ball) * (1 - ear) * (1 - nose)   # wet inner lid
    nose_red = (np.exp(-np.sum((P - nose_tip) ** 2, 1) / (2 * 0.010 ** 2)) * 0.9 + nose * 0.35)
    cheek_c = np.array([0.046, 0, (ec[2] + mc[2]) / 2 - 0.006])
    cheek_red = np.exp(-(((ax - cheek_c[0]) / 0.020) ** 2 + ((Z - cheek_c[2]) / 0.020) ** 2)) * front * (1 - nose)
    chin_red = np.exp(-((X / 0.016) ** 2 + ((Z - (chin + 0.016)) / 0.012) ** 2)) * front
    ear_red = ear * (0.55 + 0.45 * S(0.0, 1.0, PT * 2 - 0.9))
    jaw = (S(mc[2] + 0.005, mc[2] - 0.025, Z) * S(chin - 0.02, chin + 0.005, Z) * (1 - lips) * S(0.01, 0.03, ax + 0.01 * (Z < mc[2])) * 0 +
           S(mc[2] + 0.012, mc[2] - 0.004, Z) * S(chin - 0.03, chin, Z)) * (1 - lips) * (1 - cav)
    forehead = S(ec[2] + 0.035, ec[2] + 0.07, Z) * front
    neck = S(chin + 0.010, chin - 0.025, Z) * (1 - cav) * (1 - S(lm["ear"][1] - 0.02, lm["ear"][1] + 0.02, Y) * 0)
    face_w = 1 - neck                                  # variation fades out on the neck (flat body colour there)
    # ---------------- height field (metres-ish units, scaled later): pores, lip lines, soft creases
    print("noise ...")
    pores = cells(P, 900.0, 3)
    pore_h = -S(0.42, 0.0, pores) * 1.0
    pore_density = 0.55 + 0.45 * (nose_red * 0.8 + cheek_red * 0.6 + forehead * 0.3)
    fine = fbm(P, 1600.0, 2, 11) - 0.5
    lip_lines = np.sin((X * 2 * math.pi / 0.0016) + 2.0 * (fbm(P, 400, 2, 5) - 0.5)) * lips * 0.8
    mottle_h = fbm(P, 180.0, 3, 21) - 0.5
    height = (pore_h * pore_density * (1 - lips) * (1 - neck * 0.6) * 0.55 + fine * 0.30 + lip_lines * 0.5 + mottle_h * 0.4) * (1 - cav)
    height = height * (1 - inner_lid * 0.8)
    # ---------------- roughness: T-zone and lips a bit shinier, cheeks matte (stylised: no oily highlights)
    rough = 0.56 - 0.07 * (nose_red * 0.8 + forehead * 0.5) - 0.17 * lips + 0.05 * cheek_red + 0.04 * (fbm(P, 300, 2, 31) - 0.5)
    rough = np.where(cav > 0.5, 0.35, rough)
    rough = rough - 0.30 * inner_lid
    rough = rough + 0.06 * S(-0.3, 0.0, pore_h) * 0 + 0.05 * (-pore_h) * pore_density * (1 - lips)
    # ---------------- cavity from pointiness (concave = dark)
    pt = PT
    cavity = np.clip(1.0 - S(0.50, 0.38, pt) * 0.6, 0, 1)
    H = W = res

    def img2(a, fill=0.0):
        full = np.full((H * W,) + a.shape[1:], fill, dtype=np.float32)
        full[covered] = a
        return full.reshape(H, W, -1) if a.ndim == 2 else full.reshape(H, W)
    # height map -> normal map (Cycles, bump node on the image)
    hmin, hmax = np.percentile(height, [0.5, 99.5])
    hn = img2(np.clip((height - hmin) / (hmax - hmin), 0, 1), 0.5).reshape(-1)
    himg = new_image("height_tmp", res)
    hp = np.ones((H * W, 4), np.float32)
    hp[:, 0] = hp[:, 1] = hp[:, 2] = hn
    himg.pixels.foreach_set(hp.ravel())
    nimg = new_image("bk_normal", res)

    def nmat(im):
        m = bpy.data.materials.new("bake_n")
        m.use_nodes = True
        nt = m.node_tree
        bs = nt.nodes["Principled BSDF"]
        ht = nt.nodes.new("ShaderNodeTexImage")
        ht.image = himg
        ht.interpolation = 'Cubic'
        bump = nt.nodes.new("ShaderNodeBump")
        bump.inputs["Strength"].default_value = 1.0
        bump.inputs["Distance"].default_value = 0.00035
        nt.links.new(ht.outputs["Color"], bump.inputs["Height"])
        nt.links.new(bump.outputs["Normal"], bs.inputs["Normal"])
        t = nt.nodes.new("ShaderNodeTexImage")
        t.image = im
        nt.nodes.active = t
        return m
    bake_to(nimg, objs, 'NORMAL', nmat)
    normal = pixels(nimg)[..., :3]
    print("baked normal")
    save(normal, os.path.join(OUT, "head_normal.png"))
    save(img2(np.clip(rough, 0.2, 0.9)), os.path.join(OUT, "head_roughness.png"))
    aoc = np.clip(ao, 0, 1) ** 0.8
    save(img2(aoc), os.path.join(OUT, "head_ao.png"))
    save(img2(cavity), os.path.join(OUT, "head_cavity.png"))
    save(img2(lips), os.path.join(OUT, "head_lipmask.png"))
    # ---------------- albedo per tone (linear maths, written as sRGB)
    mott = fbm(P, 60.0, 3, 41) - 0.5
    speck = S(0.80, 0.95, fbm(P, 900.0, 2, 51))
    tones_json = {}
    for tname, t in TONES.items():
        base = srgb_to_lin(t["base"])
        red = srgb_to_lin(t["red"])
        lipc = srgb_to_lin(t["lip"])
        b = t["blush"]
        col = np.tile(base, (len(P), 1))
        def mix(c, target, w):
            return c * (1 - w[:, None]) + np.asarray(target)[None] * w[:, None]
        cool = base * np.array([0.86, 0.84, 0.95])          # slightly bluish/greyish, darker
        warm = base * np.array([1.02, 0.98, 0.88])
        col = mix(col, warm, 0.35 * forehead * face_w)
        col = mix(col, red, b * face_w * np.clip(0.42 * nose_red + 0.40 * cheek_red + 0.22 * chin_red + 0.55 * ear_red, 0, 0.75))
        col = mix(col, cool, face_w * np.clip(0.55 * under_eye + 0.25 * socket + 0.22 * jaw, 0, 0.6))
        col = col * (1 + 0.06 * mott[:, None] * face_w[:, None])
        col = mix(col, base * np.array([0.85, 0.80, 0.78]), 0.25 * speck * face_w * (1 - lips))
        col = mix(col, lipc, np.clip(lips * 0.92, 0, 1))
        col = mix(col, srgb_to_lin((0.78, 0.42, 0.42)) * (0.6 + 0.4 * base.mean() / 0.6), np.clip(inner_lid, 0, 1) * 0.8)
        col = mix(col, srgb_to_lin((0.42, 0.13, 0.15)), cav)
        col = mix(col, srgb_to_lin((0.10, 0.06, 0.05)), 0.85 * lash_line)
        # cavity and AO darken softly (kept mild: real-time AO also applies)
        col = col * (0.82 + 0.18 * cavity)[:, None]
        save(img2(col), os.path.join(OUT, f"head_albedo_{tname}.png"), srgb=True)
        tones_json[tname] = {"base": list(t["base"]), "bodyColour": list(t["base"]), "albedo": f"head_albedo_{tname}.png"}
        print("albedo", tname)
    tones_json["_shared"] = {"normal": "head_normal.png (tangent space, OpenGL +Y)", "roughness": "head_roughness.png (linear)",
                             "ao": "head_ao.png", "cavity": "head_cavity.png", "lipMask": "head_lipmask.png", "uv": "UVMap of Mesh_Head, Part_Nose, Part_Ear_*",
                             "bodyMatch": "albedo fades to the flat tone colour below the jaw so the neck meets the Skin material of the body"}
    json.dump(tones_json, open(os.path.join(OUT, "skin_tones.json"), "w"), indent=1)
    print("done", OUT)


if __name__ == "__main__":
    main()
