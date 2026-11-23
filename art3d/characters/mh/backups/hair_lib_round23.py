"""Head hair, facial hair and brow styles for the MakeHuman base (round 23).

Head hair: the 10 MakeHuman CC0 hair proxies (fitted by their .mhclo rule, so they follow every head shape key) plus
variants made from them by smooth deformations of the fitted proxy: length (shorter / longer), volume (puff), a receding
hairline (faces removed at the front of the scalp) and "bald" (no hair object; a soft scalp shadow only).  No new hair
meshes were modelled: no other CC0 hair on the MakeHuman topology was found without an account.

Facial hair (men): shells made from the head skin itself (the hm08 faces of a region, offset along the skin normal, with a
tiling strand alpha texture), so they follow the jaw, the lips and every expression / viseme key exactly; the lips and a
margin around the mouth are never part of a shell, so the mouth opens without opening into the beard.  Stubble is paint
on the skin (a darker tint in the beard region).
"""
import os
import numpy as np
import bmesh
import bpy

HERE = os.path.dirname(os.path.abspath(__file__))

# name: base MakeHuman proxy (None = bald), sexes, deformation
HAIR = {
    # women
    "bob": ("bob01", "F", {}),
    "bob short": ("bob02", "F", {}),
    "bob chin": ("bob01", "F", {"length": 0.8}),
    "long": ("long01", "F", {}),
    "long shoulder": ("long01", "F", {"length": 0.6}),
    "long full": ("long01", "F", {"puff": 1.06}),
    "ponytail": ("ponytail01", "FM", {}),
    "ponytail short": ("ponytail01", "F", {"length": 0.7}),
    "braid": ("braid01", "F", {}),
    "braid short": ("braid01", "F", {"length": 0.75}),
    "pixie": ("short03", "F", {}),
    "pixie full": ("short03", "F", {"puff": 1.08}),
    "afro": ("afro01", "FM", {}),
    "afro short": ("afro01", "FM", {"length": 0.55, "puff": 0.94}),
    "curly bob": ("afro01", "F", {"length": 0.85, "puff": 1.03}),
    "cropped": ("short04", "FM", {}),
    # men
    "short side part": ("short01", "M", {}),
    "short full": ("short01", "M", {"puff": 1.05}),
    "short": ("short02", "M", {}),
    "short tight": ("short02", "M", {"puff": 1.01}),
    "short messy": ("short02", "M", {"puff": 1.07}),
    "crew": ("short04", "M", {"puff": 1.02}),
    "buzz": ("short04", "M", {"puff": 1.0, "scalp": 0.3}),
    "receding short": ("short02", "M", {"recede": 0.45}),
    "receding crop": ("short04", "M", {"recede": 0.5}),
    "thinning crown": ("short01", "M", {"recede": 0.7}),
    "long tied": ("ponytail01", "M", {"length": 0.85}),
    "long loose": ("long01", "M", {"length": 0.7}),
    "shaggy": ("short03", "M", {"puff": 1.1}),
    "bald": (None, "M", {}),
    "shaved": (None, "FM", {"scalp": 0.25}),
}

BEARDS = {
    # name: region, offset (m), alpha gain, grey
    "none": (None, 0, 0, 0),
    "stubble": ("full", 0.0, 0.6, 0),
    "stubble light": ("full", 0.0, 0.38, 0),
    "short beard": ("full", 0.0025, 0.9, 0),
    "full beard": ("full_long", 0.006, 1.1, 0),
    "full beard grey": ("full_long", 0.006, 1.1, 1),
    "short beard grey": ("full", 0.0025, 0.9, 1),
    "moustache": ("moustache", 0.0025, 1.0, 0),
    "moustache grey": ("moustache", 0.0025, 1.0, 1),
    "goatee": ("goatee", 0.0028, 1.0, 0),
    "goatee and moustache": ("goatee_m", 0.0028, 1.0, 0),
    "chin strap": ("strap", 0.002, 1.0, 0),
    "sideburns": ("sideburns", 0.0018, 1.0, 0),
    "mutton chops": ("chops", 0.0025, 1.0, 0),
    "beard no moustache": ("full_nom", 0.003, 0.95, 0),
    "stubble grey": ("full", 0.0, 0.5, 1),
    "goatee grey": ("goatee_m", 0.0028, 1.0, 1),
}


def styles_for(sex):
    return sorted(k for k, v in HAIR.items() if sex in v[1])


# ------------------------------------------------------------------------------------------------ head hair
def deform_hair(ob, P, B, lm, prm):
    """apply length / puff / recede to a fitted hair object (rest coordinates)."""
    if not prm or ob is None:
        return
    me = ob.data
    V = np.array([v.co[:] for v in me.vertices])
    top = P[lm.crown]
    head_c = np.array([0.0, (P[lm.body][:, 1].min() + P[lm.body][:, 1].max()) / 2 * 0 + top[1], top[2] - 0.11])
    eye_z = P[B.groups["helper-l-eye"]].mean(axis=0)[2]
    if prm.get("puff"):
        V = head_c + (V - head_c) * prm["puff"]
    if prm.get("length") and prm["length"] != 1.0:
        z0 = eye_z - 0.02
        below = V[:, 2] < z0
        V[below, 2] = z0 - (z0 - V[below, 2]) * prm["length"]
        # pulled-up strands move in towards the neck a little, so they do not float off the shoulders
        k = np.clip((z0 - V[:, 2]) / 0.15, 0, 1) * (1 - prm["length"]) * 0.0
        V[:, 0] *= 1 - k * 0.1
    me.vertices.foreach_set("co", V.ravel())
    me.update()
    if prm.get("recede"):
        # sink the front of the hairline under the scalp instead of cutting faces: the skin hides it, and the
        # hairline becomes the smooth line where the hair shell meets the scalp (no jagged cut edges)
        r = prm["recede"]
        yfront = V[:, 1].min()
        depth = (V[:, 1] - yfront) / 0.18
        lim = r * (0.6 + 0.4 * np.clip(np.abs(V[:, 0]) / 0.05, 0, 1))
        w = np.clip((lim - depth) / 0.12 + 0.5, 0, 1)
        w *= np.clip((V[:, 2] - (eye_z + 0.045)) / 0.02, 0, 1)
        w *= V[:, 1] < top[1] + 0.02
        w = w * w * (3 - 2 * w)
        V = head_c + (V - head_c) * (1 - 0.22 * w)[:, None]
        me.vertices.foreach_set("co", V.ravel())
        me.update()


# ------------------------------------------------------------------------------------------------ facial hair
def region_mask(P, B, lm, region):
    """1 = beard skin, over all hm08 vertices (head only); lips + 2.5 mm and the nostrils are never included."""
    n = len(P)
    head = (lm.vpart == "head") & B.body_mask
    x, y, z = P[:, 0], P[:, 1], P[:, 2]
    lc, lt, lb = P[lm.lipContact], P[lm.lipTop], P[lm.lipBottom]
    mcx = abs(P[lm.mouthCorner_L, 0])
    sub = P[lm.subnasale, 2]
    chin = P[lm.chin]
    ear = P[lm.ear_L].mean(axis=0)
    front = y < ear[1] + 0.005
    lips = np.zeros(n, bool)
    lips[lm.lips] = True
    d_lip = np.full(n, 9.0)
    from mathutils.kdtree import KDTree
    kd = KDTree(len(lm.lips))
    for i, v in enumerate(lm.lips):
        kd.insert(P[v], i)
    kd.balance()
    for i in np.nonzero(head)[0]:
        d_lip[i] = kd.find(P[i])[2]
    away = d_lip > 0.0025
    nose = lm.nose_score > 0.3
    cheek_line = z < sub - 0.002 + (np.abs(x) - 0.02).clip(0) * 0.9          # beard line rises towards the ears
    under = z > chin[2] - 0.035                                              # down onto the throat
    jaw_side = np.abs(x) < ear[0] - 0.008
    m = np.zeros(n, bool)
    if region in ("full", "full_long", "full_nom"):
        m = head & front & cheek_line & under & jaw_side & away & ~nose
        if region == "full_nom":
            m &= ~((z > lc[2]) & (np.abs(x) < mcx + 0.006))
    elif region == "moustache":
        m = head & (z > lc[2] + 0.003) & (z < lc[2] + 0.017) & (np.abs(x) < mcx + 0.005) & (y < lc[1] + 0.012) & ~lips & ~(lm.nose_score > 0.35)
    elif region in ("goatee", "goatee_m"):
        m = head & (z < lb[2] - 0.001) & (z > chin[2] - 0.012) & (np.abs(x) < 0.016 + (z - chin[2]).clip(0) * 0.2) & (y < chin[1] + 0.025) & away
        if region == "goatee_m":
            m |= head & (z > lc[2] + 0.003) & (z < lc[2] + 0.017) & (np.abs(x) < mcx + 0.005) & (y < lc[1] + 0.012) & ~lips & ~(lm.nose_score > 0.35)
    elif region == "strap":
        full = head & front & cheek_line & under & jaw_side & away
        m = full & ((z < chin[2] + 0.012 + (np.abs(x) / ear[0]) * (ear[2] - chin[2]) * 0.9 - 0.004)) & (np.abs(x) > 0.004 * 0) & \
            (z < chin[2] + 0.02 + (np.abs(x) / ear[0]) * (ear[2] - 0.01 - chin[2]))
        m &= ~(head & (z > chin[2] + 0.006) & (np.abs(x) < 0.025) & (y < chin[1] + 0.01))
    elif region == "sideburns":
        m = head & (np.abs(x) > ear[0] - 0.018) & (np.abs(x) < ear[0] + 0.004) & (y < ear[1] - 0.002) & (y > ear[1] - 0.02) & \
            (z < ear[2] + 0.025) & (z > ear[2] - 0.022)
    elif region == "chops":
        m = head & front & cheek_line & under & away & ~nose & (np.abs(x) > mcx + 0.012) & jaw_side
        m |= head & (np.abs(x) > ear[0] - 0.018) & (np.abs(x) < ear[0] + 0.004) & (y < ear[1] - 0.002) & (y > ear[1] - 0.02) & \
            (z < ear[2] + 0.025) & (z > ear[2] - 0.03)
    return m


_TEX = {}


def strand_texture(path):
    """tiling alpha texture of short hair strands (generated, deterministic)."""
    if os.path.exists(path):
        return path
    from PIL import Image, ImageDraw, ImageFilter      # only with Pillow (system python); Blender calls make it first
    raise RuntimeError("run make_textures.py first: " + path)


def beard_object(P, B, lm, style, arm, col, name="MHP_beard"):
    """facial hair shell object (or None); vertices follow their hm08 skin vertices (weights from the basemesh)."""
    region, off, gain, grey = BEARDS[style]
    if region is None or off <= 0:
        return None
    m = region_mask(P, B, lm, region).astype(float)
    import paint
    if region.startswith("full") or region in ("chops", "strap"):
        m = paint.smooth(m[:, None], lm.faces, len(P), it=2)[:, 0] > 0.45   # rounder region edges
    else:
        m = m > 0.5                                                          # thin regions (moustache, goatee): as masked
    print("BEARD", style, region, int(m.sum()), "verts", flush=True)
    need = 1 if region == "moustache" or region == "goatee_m" else len(f_ := (0, 0, 0, 0)) - 1
    faces = [f for f in lm.faces if sum(bool(m[v]) for v in f) >= (need if need == 1 else len(f) - 1)]
    if not faces:
        return None
    used = sorted({v for f in faces for v in f})
    rm = {v: i for i, v in enumerate(used)}
    import stylise_local as sl
    N = sl.normals(lm, P)
    # thickness tapers at the region border (soft edge) and is thicker on the chin for the long beard
    border = np.zeros(len(P))
    nb = {v: set() for v in used}
    for f in faces:
        for v in f:
            nb[v].update(f)
    from collections import Counter
    ec = Counter()
    for f in faces:
        for i in range(len(f)):
            ec[tuple(sorted((f[i], f[(i + 1) % len(f)])))] += 1
    edge_v = {v for e, c in ec.items() if c == 1 for v in e}
    t = np.array([off * (0.35 if v in edge_v else 1.0) for v in used])
    if region == "full_long":
        chin = P[lm.chin]
        t *= 1 + 1.2 * np.clip((chin[2] + 0.02 - P[used, 2]) / 0.04, 0, 1)
    # two layers (inner at 45 % of the thickness) give density without a solid look
    V = np.concatenate([P[used] + N[used] * (0.45 * t)[:, None], P[used] + N[used] * t[:, None]])
    nu = len(used)
    F = [[rm[v] for v in f] for f in faces]
    me = bpy.data.meshes.new(name)
    me.from_pydata(V.tolist(), [], F + [[i + nu for i in f] for f in F])
    uv = me.uv_layers.new(name="UVMap")
    vi = np.empty(len(me.loops), np.int64)
    me.loops.foreach_get("vertex_index", vi)
    Q = V[vi]
    lay = (vi >= nu).astype(float) * 0.37                       # second layer: shifted tiles (no moire)
    uv.data.foreach_set("uv", np.stack([Q[:, 0] * 11 + Q[:, 1] * 3 + lay, Q[:, 2] * 11 + lay * 0.6], axis=1).ravel())
    # soft border: alpha fades over the outer two rings of the region
    fade = np.ones(len(used))
    ring1 = np.array([v in edge_v for v in used])
    nbr = {v: set() for v in used}
    for f in faces:
        for v in f:
            nbr[v].update(f)
    ring2 = np.array([(not ring1[i]) and any(u in edge_v for u in nbr[v]) for i, v in enumerate(used)])
    fade[ring1] = 0.0
    fade[ring2] = 0.5
    fa = me.color_attributes.new("Fade", 'FLOAT_COLOR', 'POINT')
    cc = np.ones((2 * nu, 4))
    cc[:, 0] = np.concatenate([fade, fade])
    fa.data.foreach_set("color", cc.ravel())
    for p in me.polygons:
        p.use_smooth = True
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    ob["mh_person"] = 1
    import look_mh as lk
    c = np.array(col, float)
    if grey:
        c = c * 0.35 + np.array((0.42, 0.41, 0.40)) * 0.65
    mat = lk.card(os.path.join(HERE, "textures", "beard_strands.png"), f"MH_Beard_{name}", colour=tuple(c * 0.75), rough=0.85,
                  alpha_gain=gain * 2.6, solid=True)
    nt = mat.node_tree
    bs = nt.nodes["Principled BSDF"]
    bs.inputs["Specular IOR Level"].default_value = 0.08
    src = bs.inputs["Alpha"].links[0].from_socket
    vc = nt.nodes.new("ShaderNodeVertexColor")
    vc.layer_name = "Fade"
    sep = nt.nodes.new("ShaderNodeSeparateColor")
    nt.links.new(vc.outputs["Color"], sep.inputs[0])
    mul = nt.nodes.new("ShaderNodeMath")
    mul.operation = 'MULTIPLY'
    nt.links.new(src, mul.inputs[0])
    nt.links.new(sep.outputs[0], mul.inputs[1])
    nt.links.new(mul.outputs[0], bs.inputs["Alpha"])
    me.materials.append(mat)
    if arm is not None:
        for j, b in enumerate(lm.bones):
            w = np.concatenate([lm.W[used, j], lm.W[used, j]])
            nz = np.nonzero(w > 1e-4)[0]
            if len(nz):
                g = ob.vertex_groups.new(name=b)
                for k in nz:
                    g.add([int(k)], float(w[k]), 'REPLACE')
        ob.parent = arm
        ob.modifiers.new("Armature", 'ARMATURE').object = arm
    return ob


def stubble_tint(T, P, B, lm, style, col):
    """darken the skin tint in the beard region for stubble styles (and under every beard, so no skin shows through)."""
    region, off, gain, grey = BEARDS[style]
    if region is None:
        return T
    m = region_mask(P, B, lm, "full" if off <= 0 else region).astype(float)
    import paint
    m = paint.smooth(m[:, None], lm.faces, len(P), it=2)[:, 0]
    c = np.array(col, float)
    if grey:
        c = c * 0.4 + 0.6 * np.array((0.45, 0.44, 0.43))
    k = float(np.clip(gain, 0, 1)) * (1.0 if off <= 0 else 0.7)
    shadow = np.clip(c * 2.0 + 0.25, 0, 1)                      # the hair colour, as a skin multiplier
    return T * (1 - (m * k)[:, None]) + (T * shadow) * (m * k)[:, None]


def hair_colour(rng, culture, tone_lum, age):
    """natural hair colour from the person: darker on darker skin and in the south / east, blond and red possible in the
    north / west, greying from about 40."""
    pal = [(0.05, 0.04, 0.035), (0.10, 0.06, 0.04), (0.17, 0.09, 0.05), (0.26, 0.15, 0.08), (0.36, 0.24, 0.12),
           (0.55, 0.40, 0.22), (0.34, 0.11, 0.05)]
    p = np.array([3, 3, 2.5, 1.5, 0.8, 0.5, 0.4])
    if culture in ("south", "east") or tone_lum < 0.45:
        p = np.array([6, 3, 1.5, 0.5, 0.1, 0.05, 0.05])
    elif culture in ("north",):
        p = np.array([1, 1.5, 2, 2, 1.8, 1.5, 0.8])
    c = np.array(pal[int(rng.choice(len(pal), p=p / p.sum()))])
    g = float(np.clip((age - 38) / 30.0 + rng.normal(0, 0.12), 0, 1))
    grey = np.array((0.62, 0.61, 0.60)) if g > 0.85 else np.array((0.42, 0.41, 0.40))
    return tuple((c * (1 - g) + grey * g).tolist()), g
