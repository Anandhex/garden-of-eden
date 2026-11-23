"""Head hair, facial hair and brow styles for the MakeHuman base (round 23, reworked in round 24).

Head hair comes in three kinds:
* MakeHuman CC0 hair proxies (fitted by their .mhclo rule, so they follow every head shape key), optionally changed by
  smooth deformations of the fitted proxy: length, volume (puff) and "fringe" (a fringe that hung over one eye is lifted
  to sit on the forehead above the brows, so both eyes stay visible).
* shell hair ("cap" and "curls"): layered shells over the scalp skin itself (hm08 head faces, offset along the skin
  normal), with a tiling strand alpha (scalp_strands / curl_strands), a soft per-vertex density (the hairline fades over
  about a centimetre; receding temples and a thinning crown are lower density, not cut faces) and outer layers that get
  sparser (soft silhouette).  Shells are single-sided with outward normals (backface culling), so no inner side shows.
  Used for receding / thinning hair and for afros and curly hair (MakeHuman's afro card showed its grid).
* bald / shaved: no mesh, a scalp tint on the skin.
Every shell style also darkens the scalp under it to the hair colour (like stubble), so gaps read as dense roots, not skin.

Facial hair (men) uses the same shells over the beard region (beard_clumps texture, 4-6 layers, outer layers hang
down a little), so beards follow the jaw, the lips and every expression / viseme key exactly; the lips and a margin
around the mouth are never part of a shell, so the mouth opens without opening into the beard.  Stubble is paint on the
skin (a darker tint in the beard region).

Every shell / styled proxy has the proxy interface used by build_mh.py (vi, vw, faces, face_uv, uv, nv, fit(P)), so the
contract build bakes the same styles, with the same shape keys, into base_mh.blend (collection Groom).
"""
import os
import numpy as np
import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
TEX = os.path.join(HERE, "textures")

# name: base (MakeHuman proxy, "cap", "curls" or None = bald), sexes, parameters
HAIR = {
    # women
    "bob": ("bob01", "F", {"fringe": 1.0}),
    "bob short": ("bob02", "F", {"fringe": 1.0}),
    "bob chin": ("bob01", "F", {"length": 0.8, "fringe": 1.0}),
    "long": ("long01", "F", {}),
    "long shoulder": ("long01", "F", {"length": 0.6}),
    "long full": ("long01", "F", {"puff": 1.06}),
    "ponytail": ("ponytail01", "FM", {}),
    "ponytail short": ("ponytail01", "F", {"length": 0.7}),
    "braid": ("braid01", "F", {"fringe": 1.0}),
    "braid short": ("braid01", "F", {"length": 0.75, "fringe": 1.0}),
    "pixie": ("short03", "F", {"fringe": 1.0}),
    "pixie full": ("short03", "F", {"puff": 1.06, "fringe": 1.0}),
    "afro": ("curls", "FM", {"thick": 0.055}),
    "afro short": ("curls", "FM", {"thick": 0.024}),
    "curly bob": ("curls", "F", {"thick": 0.04, "drop": 0.025}),
    "cropped": ("short04", "FM", {}),
    # men
    "short side part": ("short01", "M", {}),
    "short full": ("short01", "M", {"puff": 1.05}),
    "short": ("short02", "M", {}),
    "short tight": ("short02", "M", {"puff": 1.01}),
    "short messy": ("short02", "M", {"puff": 1.07}),
    "crew": ("short04", "M", {"puff": 1.02}),
    "buzz": ("short04", "M", {"puff": 1.0, "scalp": 0.3}),
    "receding short": ("cap", "M", {"thick": 0.006, "front": 0.3, "temple": 0.9}),
    "receding crop": ("cap", "M", {"thick": 0.004, "front": 0.5, "temple": 1.0}),
    "thinning crown": ("cap", "M", {"thick": 0.005, "front": 0.12, "temple": 0.35, "crown": 0.9}),
    "long tied": ("ponytail01", "M", {"length": 0.85}),
    "long loose": ("long01", "M", {"length": 0.7}),
    "tousled": ("cap", "M", {"thick": 0.013, "layers": 6}),         # round 24: replaces "shaggy" (a stiff MakeHuman sweep)
    "bald": (None, "M", {}),
    "shaved": (None, "FM", {"scalp": 0.25}),
}

BEARDS = {
    # name: region, thickness (m), layers, texture tiles per metre, alpha gain, grey (0..1), hang (m, outer layer down)
    "none": (None, 0, 0, 0, 0, 0, 0),
    "stubble": ("full", 0.0, 0, 0, 0.8, 0, 0),
    "stubble light": ("full", 0.0, 0, 0, 0.55, 0, 0),
    "stubble grey": ("full", 0.0, 0, 0, 0.7, 0.6, 0),
    "short beard": ("full", 0.004, 5, 7.0, 1.7, 0, 0.0015),
    "short beard grey": ("full", 0.004, 5, 7.0, 1.7, 0.55, 0.0015),
    "full beard": ("full_long", 0.008, 6, 4.5, 1.8, 0, 0.004),
    "full beard grey": ("full_long", 0.008, 6, 4.5, 1.8, 0.55, 0.004),
    "moustache": ("moustache", 0.0045, 5, 7.0, 1.9, 0, 0.003),
    "moustache grey": ("moustache", 0.0045, 5, 7.0, 1.9, 0.55, 0.003),
    "goatee": ("goatee", 0.005, 5, 6.0, 1.8, 0, 0.002),
    "goatee and moustache": ("goatee_m", 0.0045, 5, 6.0, 1.8, 0, 0.0025),
    "goatee grey": ("goatee_m", 0.0045, 5, 6.0, 1.8, 0.55, 0.0025),
    "chin strap": ("strap", 0.003, 4, 7.0, 1.7, 0, 0.001),
    "sideburns": ("sideburns", 0.003, 4, 7.0, 1.7, 0, 0.001),
    "mutton chops": ("chops", 0.0045, 5, 6.0, 1.8, 0, 0.002),
    "beard no moustache": ("full_nom", 0.0045, 5, 6.0, 1.7, 0, 0.002),
}


def styles_for(sex):
    return sorted(k for k, v in HAIR.items() if sex in v[1])


# ------------------------------------------------------------------------------------------------ head frame
def head_frame(P, B, lm):
    """reference points of this head (all from fixed hm08 vertices, so they follow every shape key)."""
    eye_z = float(P[B.groups["helper-l-eye"]].mean(axis=0)[2])
    ear = P[lm.ear_L].mean(axis=0)
    ear_top = float(P[lm.ear_L, 2].max())
    top = P[lm.crown]
    hc = np.array([0.0, ear[1] - 0.008, ear_top + 0.015])
    return dict(eye_z=eye_z, ear=ear, ear_top=ear_top, top=top, hc=hc)


def _head_mask(lm, B):
    return (lm.vpart == "head") & B.body_mask


def scalp_weight(P, B, lm, front=0.0, temple=0.0, crown=0.0, soft=0.009, extend=0.0):
    """hair density 0..1 on every hm08 vertex (0 off the scalp).  The natural hairline is a curve over the azimuth
    (front of the forehead about 7 cm above the eye line, temple corners, sideburns down to the ear centre, around the
    ear, nape at the back); front / temple raise the front hairline (a receding M), crown thins the top of the back of the
    head.  soft = width of the hairline fade (m); extend lowers the whole hairline (m; shells that grow outwards)."""
    F = head_frame(P, B, lm)
    e, hc, ez, et = F["eye_z"], F["hc"], F["ear"][2], F["ear_top"]
    x, y, z = P[:, 0], P[:, 1], P[:, 2]
    th = np.degrees(np.arctan2(np.abs(x), hc[1] - y))            # 0 = straight ahead, 180 = back of the head
    kt = np.array([0, 25, 45, 62, 78, 92, 108, 130, 180.0])
    kz = np.array([e + 0.070, e + 0.066, e + 0.058, e + 0.040, ez + 0.002, et + 0.004, et - 0.012, ez - 0.035, ez - 0.058])
    zh = np.interp(th, kt, kz) - extend
    w = np.clip((z - zh) / soft + 0.5, 0, 1)
    w = w * w * (3 - 2 * w)
    if front > 0 or temple > 0:
        # receding: the front hairline moves back over the top of the head (sagittal elevation angle, 0 = ahead,
        # 90 = straight up), most at the temples (an M); the natural front hairline sits at about 30 degrees
        ph = np.degrees(np.arctan2(z - hc[2], hc[1] - y))
        ph = np.where(ph < -90, ph + 360, ph)
        sector = np.clip((80.0 - th) / 20.0, 0, 1) * (ph < 100)
        lim = 30.0 + front * 26.0 + temple * 18.0 * np.exp(-((th - 38.0) / 15.0) ** 2) * np.clip(front * 2.5, 0.4, 1)
        wr = np.clip((ph - lim) / (np.degrees(soft / 0.09) * 1.4) + 0.5, 0, 1)
        wr = wr * wr * (3 - 2 * wr)
        w *= 1 - sector * (1 - wr)
    if crown > 0:
        d = P - (hc + np.array([0.0, 0.045, 0.072]))
        w *= 1 - crown * 0.95 * np.exp(-(np.linalg.norm(d, axis=1) / 0.05) ** 2)
        w *= 1 - 0.3 * crown * np.exp(-(np.abs(x) / 0.035) ** 2) * np.clip((z - hc[2] - 0.04) / 0.03, 0, 1)
    w[~_head_mask(lm, B)] = 0.0
    return w


# ------------------------------------------------------------------------------------------------ shells
_FA = {}


def vertex_normals(lm, P):
    """area-weighted vertex normals over the hm08 faces (vectorised; same result as stylise_local.normals)."""
    key = id(lm)
    if key not in _FA:
        tri = np.array([f[:3] for f in lm.faces], np.int64)
        quad = np.array([f for f in lm.faces if len(f) == 4], np.int64)
        _FA[key] = (tri, quad, np.array([len(f) == 4 for f in lm.faces]))
    tri, quad, isq = _FA[key]
    c = np.cross(P[tri[:, 1]] - P[tri[:, 0]], P[tri[:, 2]] - P[tri[:, 0]])
    if len(quad):
        c[isq] += np.cross(P[quad[:, 2]] - P[quad[:, 0]], P[quad[:, 3]] - P[quad[:, 0]])
    n = np.zeros_like(P)
    for k in range(3):
        np.add.at(n, tri[:, k], c)
    if len(quad):
        np.add.at(n, quad[:, 3], c[isq])
    return n / np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-12)


def _smooth_normals(lm, P, used_mask, it):
    N = vertex_normals(lm, P)
    if it <= 0:
        return N
    nb = {}
    for f in lm.faces:
        if any(used_mask[v] for v in f):
            for v in f:
                nb.setdefault(v, set()).update(f)
    for _ in range(it):
        M = N.copy()
        for v, s in nb.items():
            M[v] = N[list(s)].mean(axis=0)
        N = M / np.maximum(np.linalg.norm(M, axis=1, keepdims=True), 1e-12)
    return N


class ShellHair:
    """layered hair shells over hm08 skin faces.  w: density per hm08 vertex (0..1; faces with any w > 0.02 are used,
    vertices at w = 0 fade out), thick: thickness per hm08 vertex (m).  uv: "sphere" (strands run from the forehead over
    the top to the crown whorl) or "front" (strands run down the face).  hang: outer layer moved down by this much (m).
    fit(P) gives the shell vertices for any coordinates (every shape key), like a MakeHuman proxy."""

    def __init__(self, P, B, lm, w, thick, layers=4, inner=0.12, uv="sphere", tile=6.0, hang=0.0, smooth_n=0,
                 exclude=None, name="shell", seed=7):
        self.B, self.lm, self.name = B, lm, name
        self.layers, self.inner, self.hang, self.smooth_n = layers, inner, hang, smooth_n
        w = np.asarray(w, float)
        ex = np.zeros(len(P), bool) if exclude is None else exclude
        faces = [f for f, q in zip(lm.faces, lm.fpart) if q == "head" and max(w[v] for v in f) > 0.02
                 and not any(ex[v] for v in f)]
        used = sorted({v for f in faces for v in f})
        self.used = np.array(used, np.int64)
        rm = {v: i for i, v in enumerate(used)}
        nu = len(used)
        self.nu = nu
        rng = np.random.default_rng(seed)
        self.wv = w[self.used] * (0.88 + 0.12 * rng.random(nu))      # a little density noise (no even felt)
        self.tv = np.asarray(thick, float)[self.used] if np.ndim(thick) else np.full(nu, float(thick))
        self.mask = np.zeros(len(P), bool)
        self.mask[self.used] = True
        F1 = [tuple(rm[v] for v in f) for f in faces]
        self.faces = [tuple(i + k * nu for i in f) for k in range(layers) for f in F1]
        self.nv = nu * layers
        self.layer = np.repeat(np.array([inner + (1 - inner) * k / max(layers - 1, 1) for k in range(layers)]), nu)
        self.fade = np.tile(self.wv, layers)
        self.vi = np.tile(self.used, layers)[:, None]
        self.vw = np.ones((self.nv, 1))
        # UVs, from the reference coordinates, per loop (so the sphere seam can be unwrapped per face)
        Q = P[self.used]
        if uv == "sphere":
            F_ = head_frame(P, B, lm)
            a = np.array([0.0, -0.6, -0.8])                       # pole in the face; the opposite pole is the crown whorl
            e1 = np.array([1.0, 0.0, 0.0])
            e2 = np.cross(a, e1)
            d = Q - F_["hc"]
            r = np.linalg.norm(d, axis=1, keepdims=True)
            d = d / r
            al = np.arccos(np.clip(d @ a, -1, 1))
            be = np.arctan2(d @ e1, d @ e2)                       # 0 = towards the top of the head; +-pi = under the chin
            R0 = 0.09
            UV = np.stack([be, al], axis=1)
            self.face_uv, self.uv = [], []
            for k in range(layers):
                sh = np.array([0.31, 0.17]) * k + (0.0, -0.004 * tile * k)
                for f in F1:
                    b_ = UV[list(f), 0].copy()
                    if b_.max() - b_.min() > np.pi:
                        b_[b_ < 0] += 2 * np.pi
                    loop = []
                    for j, i in enumerate(f):
                        u = b_[j] * np.sin(UV[i, 1]) * R0 * tile + sh[0]
                        v = UV[i, 1] * R0 * tile + sh[1]
                        self.uv.append((u, v))
                        loop.append(len(self.uv) - 1)
                    self.face_uv.append(tuple(loop))
        else:
            self.face_uv, self.uv = [], []
            for k in range(layers):
                sh = np.array([0.37, 0.23]) * k
                for f in F1:
                    loop = []
                    for i in f:
                        q = Q[i]
                        self.uv.append((q[0] * tile + q[1] * tile * 0.3 + sh[0], q[2] * tile + sh[1]))
                        loop.append(len(self.uv) - 1)
                    self.face_uv.append(tuple(loop))
        self.uv = np.array(self.uv)

    def fit(self, P):
        P = np.asarray(P, float)
        N = _smooth_normals(self.lm, P, self.mask, self.smooth_n)[self.used]
        base = P[self.used]
        out = np.empty((self.nv, 3))
        for k in range(self.layers):
            f = self.inner + (1 - self.inner) * k / max(self.layers - 1, 1)
            t = self.tv * f
            out[k * self.nu:(k + 1) * self.nu] = base + N * t[:, None] + np.array([0, 0, -self.hang]) * f ** 2
        return out

    def texture(self):
        return None

    def attributes(self):
        return {"Fade": self.fade, "Layer": self.layer}


def shell_material(name, tex, colour, grey=0.0, gain=1.6, sparse=0.6, rough=0.78, dark_in=0.55):
    """strand-shell material: texture alpha x density (Fade) with outer layers sparser; colour x strand brightness, darker
    inner layers; grey = share of white strands (salt and pepper, strand by strand)."""
    import lookdev as ld
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bs = nt.nodes["Principled BSDF"]
    N = nt.nodes.new
    L = nt.links.new
    t = N("ShaderNodeTexImage")
    t.image = bpy.data.images.load(tex, check_existing=True)
    t.interpolation = 'Cubic'
    fa, la = N("ShaderNodeAttribute"), N("ShaderNodeAttribute")
    fa.attribute_name, la.attribute_name = "Fade", "Layer"
    # alpha = clamp((A - sparse * layer) / (1 - sparse * layer)) * gain * fade
    m1 = N("ShaderNodeMath"); m1.operation = 'MULTIPLY'; m1.inputs[1].default_value = sparse
    L(la.outputs["Fac"], m1.inputs[0])
    s1 = N("ShaderNodeMath"); s1.operation = 'SUBTRACT'
    L(t.outputs["Alpha"], s1.inputs[0]); L(m1.outputs[0], s1.inputs[1])
    s2 = N("ShaderNodeMath"); s2.operation = 'SUBTRACT'; s2.inputs[0].default_value = 1.0
    L(m1.outputs[0], s2.inputs[1])
    dv = N("ShaderNodeMath"); dv.operation = 'DIVIDE'; dv.use_clamp = True
    L(s1.outputs[0], dv.inputs[0]); L(s2.outputs[0], dv.inputs[1])
    g = N("ShaderNodeMath"); g.operation = 'MULTIPLY'; g.inputs[1].default_value = gain; g.use_clamp = True
    L(dv.outputs[0], g.inputs[0])
    fd = N("ShaderNodeMath"); fd.operation = 'MULTIPLY'; fd.use_clamp = True
    L(g.outputs[0], fd.inputs[0]); L(fa.outputs["Fac"], fd.inputs[1])
    L(fd.outputs[0], bs.inputs["Alpha"])
    # colour: hair colour (or white for the grey share of strands) x strand brightness x depth (inner layers darker)
    c = N("ShaderNodeRGB"); c.outputs[0].default_value = (*ld.srgb(colour), 1)
    wc = N("ShaderNodeRGB"); wc.outputs[0].default_value = (*ld.srgb((0.60, 0.58, 0.55)), 1)
    sep = N("ShaderNodeSeparateColor"); L(t.outputs["Color"], sep.inputs[0])
    gr = N("ShaderNodeMapRange")                                  # strand brightness 0.5..1 -> grey pick
    gr.inputs["From Min"].default_value = 1.0 - grey * 0.5 - 0.02
    gr.inputs["From Max"].default_value = 1.0 - grey * 0.5 + 0.02
    gr.inputs["To Min"].default_value = 0.0
    gr.inputs["To Max"].default_value = 1.0 if grey > 0 else 0.0
    L(sep.outputs[0], gr.inputs["Value"])
    mx = N("ShaderNodeMix"); mx.data_type = 'RGBA'
    L(gr.outputs["Result"], mx.inputs["Factor"]); L(c.outputs[0], mx.inputs[6]); L(wc.outputs[0], mx.inputs[7])
    br = N("ShaderNodeMapRange")                                  # brightness 0.5..1 -> 0.7..1.15
    br.inputs["From Min"].default_value, br.inputs["From Max"].default_value = 0.5, 1.0
    br.inputs["To Min"].default_value, br.inputs["To Max"].default_value = 0.7, 1.15
    L(sep.outputs[0], br.inputs["Value"])
    dp = N("ShaderNodeMapRange")                                  # layer 0..1 -> dark_in..1
    dp.inputs["To Min"].default_value, dp.inputs["To Max"].default_value = dark_in, 1.0
    L(la.outputs["Fac"], dp.inputs["Value"])
    k = N("ShaderNodeMath"); k.operation = 'MULTIPLY'
    L(br.outputs["Result"], k.inputs[0]); L(dp.outputs["Result"], k.inputs[1])
    mul = N("ShaderNodeVectorMath"); mul.operation = 'SCALE'
    L(mx.outputs[2], mul.inputs[0]); L(k.outputs[0], mul.inputs["Scale"])
    L(mul.outputs[0], bs.inputs["Base Color"])
    bs.inputs["Roughness"].default_value = rough
    bs.inputs["Specular IOR Level"].default_value = 0.18
    m.surface_render_method = 'DITHERED'
    m.use_backface_culling = True
    return m


_LUM = {}


def tex_mean_lum(path):
    """mean linear luminance of a hair texture where it is opaque (MakeHuman hair textures differ a lot in brightness)."""
    if path in _LUM:
        return _LUM[path]
    im = bpy.data.images.load(path, check_existing=True)
    a = np.empty(im.size[0] * im.size[1] * 4, np.float32)
    im.pixels.foreach_get(a)
    a = a.reshape(-1, 4)[::7]
    rgb = np.where(a[:, :3] <= 0.04045, a[:, :3] / 12.92, ((a[:, :3] + 0.055) / 1.055) ** 2.4)
    lum = rgb @ np.array([0.2126, 0.7152, 0.0722])
    sel = a[:, 3] > 0.5
    _LUM[path] = float(max(lum[sel].mean() if sel.any() else 0.2, 1e-3))
    return _LUM[path]


def hair_material(tex, name, colour, grey=0.0):
    """MakeHuman hair card material: the texture's own brightness pattern (normalised, a little more contrast) x the
    person's hair colour, so every style shows the same colour whatever its texture's own tint."""
    import look_mh as lk, lookdev as ld
    m = lk.card(tex, name, colour=None, rough=0.72, alpha_gain=1.15, clip=0.06)
    nt = m.node_tree
    bs = nt.nodes["Principled BSDF"]
    t = [n for n in nt.nodes if n.type == 'TEX_IMAGE'][0]
    bw = nt.nodes.new("ShaderNodeRGBToBW")
    nt.links.new(t.outputs["Color"], bw.inputs[0])
    dv = nt.nodes.new("ShaderNodeMath"); dv.operation = 'DIVIDE'; dv.inputs[1].default_value = tex_mean_lum(tex)
    nt.links.new(bw.outputs[0], dv.inputs[0])
    pw = nt.nodes.new("ShaderNodeMath"); pw.operation = 'POWER'; pw.inputs[1].default_value = 1.35
    nt.links.new(dv.outputs[0], pw.inputs[0])
    cl = nt.nodes.new("ShaderNodeClamp"); cl.inputs["Max"].default_value = 2.2
    nt.links.new(pw.outputs[0], cl.inputs[0])
    # fine strands along the card's v (MakeHuman hair textures run their strands along v): brightness and broken edges
    fx = nt.nodes.new("ShaderNodeTexImage")
    fx.image = bpy.data.images.load(os.path.join(TEX, "hair_fine.png"), check_existing=True)
    uvn = nt.nodes.new("ShaderNodeTexCoord")
    mp = nt.nodes.new("ShaderNodeMapping")
    mp.inputs["Scale"].default_value = (9.0, 2.5, 1.0)
    nt.links.new(uvn.outputs["UV"], mp.inputs["Vector"])
    nt.links.new(mp.outputs["Vector"], fx.inputs["Vector"])
    fb = nt.nodes.new("ShaderNodeMapRange")                       # strand brightness -> 0.72..1.15
    fb.inputs["From Min"].default_value, fb.inputs["From Max"].default_value = 0.35, 1.0
    fb.inputs["To Min"].default_value, fb.inputs["To Max"].default_value = 0.72, 1.15
    sp = nt.nodes.new("ShaderNodeSeparateColor")
    nt.links.new(fx.outputs["Color"], sp.inputs[0])
    nt.links.new(sp.outputs[0], fb.inputs["Value"])
    fm = nt.nodes.new("ShaderNodeMath"); fm.operation = 'MULTIPLY'
    nt.links.new(cl.outputs[0], fm.inputs[0]); nt.links.new(fb.outputs["Result"], fm.inputs[1])
    cl = fm
    # alpha: where the card is already thin (edges, tips) the fine strands break it up; solid areas stay solid
    aout = bs.inputs["Alpha"].links[0].from_socket
    a3 = nt.nodes.new("ShaderNodeMath"); a3.operation = 'POWER'; a3.inputs[1].default_value = 3.0
    nt.links.new(aout, a3.inputs[0])
    am = nt.nodes.new("ShaderNodeMix"); am.data_type = 'FLOAT'
    nt.links.new(a3.outputs[0], am.inputs["Factor"])
    nt.links.new(fx.outputs["Alpha"], am.inputs[2])
    am.inputs[3].default_value = 1.0
    a4 = nt.nodes.new("ShaderNodeMath"); a4.operation = 'MULTIPLY'; a4.use_clamp = True
    nt.links.new(aout, a4.inputs[0]); nt.links.new(am.outputs[0], a4.inputs[1])
    nt.links.new(a4.outputs[0], bs.inputs["Alpha"])
    col = np.array(colour, float)
    if grey > 0:
        col = col * (1 - grey) + np.array((0.70, 0.68, 0.64)) * grey
    c = nt.nodes.new("ShaderNodeRGB"); c.outputs[0].default_value = (*ld.srgb(col), 1)
    sc = nt.nodes.new("ShaderNodeVectorMath"); sc.operation = 'SCALE'
    nt.links.new(c.outputs[0], sc.inputs[0]); nt.links.new(cl.outputs[0], sc.inputs["Scale"])
    nt.links.new(sc.outputs[0], bs.inputs["Base Color"])
    bs.inputs["Specular IOR Level"].default_value = 0.2
    return m


# ------------------------------------------------------------------------------------------------ MakeHuman hair, styled
def deform_coords(V, P, B, lm, prm):
    """length / puff / fringe on fitted hair coordinates V (any shape key: P = that key's hm08 coordinates)."""
    if not prm:
        return V
    V = np.array(V, float)
    F = head_frame(P, B, lm)
    top = F["top"]
    head_c = np.array([0.0, top[1], top[2] - 0.11])
    eye_z = F["eye_z"]
    if prm.get("puff"):
        V = head_c + (V - head_c) * prm["puff"]
    if prm.get("length") and prm["length"] != 1.0:
        z0 = eye_z - 0.02
        below = V[:, 2] < z0
        V[below, 2] = z0 - (z0 - V[below, 2]) * prm["length"]
    if prm.get("fringe"):
        V = lift_fringe(V, P, B, lm, prm["fringe"])
    return V


_KD = {}


def lift_fringe(V, P, B, lm, amount=1.0):
    """hair hanging in front of the face below the brow tops is gathered up onto the forehead (a fringe above the brows):
    both eyes stay free.  Then every hair vertex near the front of the face is kept at least 3 mm off the skin."""
    from mathutils.kdtree import KDTree
    import stylise_local as sl
    F = head_frame(P, B, lm)
    eye_z = F["eye_z"]
    zlim = eye_z + 0.036                                          # just above the brow tops
    hc = F["hc"]
    x, y, z = V[:, 0], V[:, 1], V[:, 2]
    ax = np.clip((0.072 - np.abs(x)) / 0.014, 0, 1)                # whole face width, fading out at the temples
    ay = np.clip(((hc[1] - 0.03) - y) / 0.02, 0, 1)               # only in front of the face
    k = ax * ay * amount
    low = z < zlim
    nz = zlim - (zlim - z) * 0.10
    V[:, 2] = np.where(low, z + (nz - z) * k, z)
    # keep off the skin (head faces only)
    head = np.nonzero(_head_mask(lm, B))[0]
    kd = KDTree(len(head))
    for i, v in enumerate(head):
        kd.insert(P[v], i)
    kd.balance()
    N = vertex_normals(lm, P)
    front = (V[:, 1] < hc[1] - 0.02) & (V[:, 2] < zlim + 0.03)
    for i in np.nonzero(front)[0]:
        co, j, dist = kd.find(V[i])
        s = head[j]
        d = float(np.dot(V[i] - P[s], N[s]))
        if d < 0.003:
            V[i] += N[s] * (0.003 - d)
    return V


class StyledHair:
    """a MakeHuman hair proxy plus the style's deformation (proxy interface; fit(P) for any shape key)."""

    def __init__(self, px, B, lm, prm):
        self.px, self.B, self.lm, self.prm = px, B, lm, dict(prm)
        self.vi, self.vw, self.faces, self.face_uv, self.uv, self.nv = px.vi, px.vw, px.faces, px.face_uv, px.uv, px.nv

    def fit(self, P):
        return deform_coords(self.px.fit(P), np.asarray(P, float), self.B, self.lm, self.prm)

    def texture(self):
        return self.px.texture()


def hair_shell(P, B, lm, base, prm):
    """ShellHair for a "cap" or "curls" style."""
    if base == "cap":
        w = scalp_weight(P, B, lm, prm.get("front", 0), prm.get("temple", 0), prm.get("crown", 0), soft=0.012)
        return ShellHair(P, B, lm, w, prm.get("thick", 0.005) * (0.45 + 0.55 * w), layers=prm.get("layers", 4), inner=0.15,
                         uv="sphere", tile=3.2 if prm.get("thick", 0.005) < 0.008 else 2.2, smooth_n=1 if prm.get("thick", 0) > 0.008 else 0,
                         hang=0.004 if prm.get("thick", 0) > 0.008 else 0.0, name="cap")
    # curls: thickness grows over 3 cm inside the hairline (round, soft silhouette); "drop" adds volume low at the sides
    w = scalp_weight(P, B, lm, soft=0.010, extend=0.004)
    wt = scalp_weight(P, B, lm, soft=0.045, extend=-0.01)
    T = prm.get("thick", 0.05) * (0.18 + 0.82 * wt)
    if prm.get("drop"):
        F = head_frame(P, B, lm)
        T = T + prm["drop"] * np.clip((F["ear_top"] + 0.03 - P[:, 2]) / 0.05, 0, 1) * w
    layers = int(np.clip(round(prm.get("thick", 0.05) / 0.006), 4, 9))
    return ShellHair(P, B, lm, w, T, layers=layers, inner=0.06, uv="sphere", tile=5.0, smooth_n=3, name="curls")


def scalp_tint(T, P, B, lm, base, prm, col):
    """darker scalp under shell hair (and for shaved / buzz), in the hair colour: gaps read as roots, not skin."""
    if base in ("cap", "curls"):
        w = scalp_weight(P, B, lm, prm.get("front", 0), prm.get("temple", 0), prm.get("crown", 0), soft=0.012)
        k = 0.75 if base == "cap" else 0.9
    elif prm.get("scalp"):
        w = scalp_weight(P, B, lm, soft=0.012)
        k = prm["scalp"] * 2.0
    elif base is not None:                                         # under MakeHuman hair: gaps show roots, not pale skin
        w = scalp_weight(P, B, lm, soft=0.015)
        k = 0.5
    else:
        return T
    shadow = np.clip(np.array(col, float) * 1.6 + 0.12, 0, 1)
    k = np.clip(w * k, 0, 1)[:, None]
    return T * (1 - k) + T * shadow * k


def deform_hair(ob, P, B, lm, prm):
    """apply a style's deformation to a fitted MakeHuman hair object in the scene (rest coordinates)."""
    if not prm or ob is None:
        return
    me = ob.data
    V = np.array([v.co[:] for v in me.vertices])
    V = deform_coords(V, np.asarray(P, float), B, lm, prm)
    me.vertices.foreach_set("co", V.ravel())
    me.update()


# ------------------------------------------------------------------------------------------------ facial hair
def vermilion(P, lm):
    """the red of the lips only: hm08's lip group also covers the philtrum up to the nose; keep its part below the upper
    vermilion border (lip contact + 4 mm)."""
    m = np.zeros(len(P), bool)
    m[lm.lips] = True
    return m & (P[:, 2] < P[lm.lipContact, 2] + 0.004)


def _moustache(head, x, y, z, lc, sub, mcx, lips, lm):
    """a real moustache: the whole upper-lip skin from the vermilion border up to the nose base, out to the mouth
    corners, with the ends turning down a little past the corners (chevron)."""
    ax = np.abs(x)
    lips = lips & (z < lc[2] + 0.004)                               # vermilion only (see vermilion())
    nostril = (lm.nose_score > 0.5) & (z > sub - 0.001)
    m = head & ~lips & (z > lc[2] - 0.001) & (z < sub + 0.004) & (ax < mcx + 0.003) & (y < lc[1] + 0.016) & ~nostril
    m |= head & ~lips & (ax > mcx - 0.005) & (ax < mcx + 0.006) & (z > lc[2] - 0.008) & (z < sub + 0.002) & (y < lc[1] + 0.02)
    return m


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
        else:
            m |= _moustache(head, x, y, z, lc, sub, mcx, lips, lm)
    elif region == "moustache":
        m = _moustache(head, x, y, z, lc, sub, mcx, lips, lm)
    elif region in ("goatee", "goatee_m"):
        m = head & (z < lb[2] - 0.001) & (z > chin[2] - 0.012) & (np.abs(x) < 0.016 + (z - chin[2]).clip(0) * 0.2) & (y < chin[1] + 0.025) & away
        if region == "goatee_m":
            m |= _moustache(head, x, y, z, lc, sub, mcx, lips, lm)
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


def lip_distance(P, lm, B):
    from mathutils.kdtree import KDTree
    head = _head_mask(lm, B)
    d = np.full(len(P), 9.0)
    kd = KDTree(len(lm.lips))
    for i, v in enumerate(lm.lips):
        kd.insert(P[v], i)
    kd.balance()
    for i in np.nonzero(head)[0]:
        d[i] = kd.find(P[i])[2]
    return d


def beard_weight(P, B, lm, region):
    """soft beard density per hm08 vertex: the region mask, smoothed (soft edges), never on the lips / nostrils."""
    import paint
    m = region_mask(P, B, lm, region).astype(float)
    w = paint.smooth(m[:, None], lm.faces, len(P), it=1 if region in ("moustache", "goatee", "goatee_m", "sideburns") else 2)[:, 0]
    w = np.clip(w * 1.25, 0, 1)
    lips = vermilion(P, lm)
    sub = P[lm.subnasale, 2]
    w[lips | ((lm.nose_score > 0.5) & (P[:, 2] > sub - 0.001))] = 0.0
    return w, lips


def beard_shell(P, B, lm, style):
    region, thick, layers, tile, gain, grey, hang = BEARDS[style]
    if region is None or thick <= 0:
        return None
    w, lips = beard_weight(P, B, lm, region)
    T = thick * (0.35 + 0.65 * w)
    if region == "full_long":
        chin = P[lm.chin]
        T = T * (1 + 1.1 * np.clip((chin[2] + 0.02 - P[:, 2]) / 0.04, 0, 1))
    return ShellHair(P, B, lm, w, T, layers=layers, inner=0.1, uv="front", tile=tile, hang=hang, exclude=lips, name="beard")


def shell_object(sh, P, name, mat, arm=None, lm=None):
    """scene object for a ShellHair (or any proxy-like with face_uv / attributes) at coordinates P."""
    V = sh.fit(P)
    me = bpy.data.meshes.new(name)
    me.from_pydata(V.tolist(), [], [list(f) for f in sh.faces])
    uvl = me.uv_layers.new(name="UVMap")
    uvl.data.foreach_set("uv", np.array([tuple(sh.uv[t]) for ft in sh.face_uv for t in ft], float).ravel())
    for nm, val in sh.attributes().items():
        a = me.color_attributes.new(nm, 'FLOAT_COLOR', 'POINT')
        c = np.ones((len(V), 4))
        c[:, 0] = c[:, 1] = c[:, 2] = val
        a.data.foreach_set("color", c.ravel())
        at = me.attributes.new(nm + "_f", 'FLOAT', 'POINT')
        at.data.foreach_set("value", np.asarray(val, np.float32))
    for p in me.polygons:
        p.use_smooth = True
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    ob["mh_person"] = 1
    me.materials.append(mat)
    if arm is not None and lm is not None:
        for j, b in enumerate(lm.bones):
            wv = lm.W[sh.vi[:, 0], j]
            nz = np.nonzero(wv > 1e-4)[0]
            if len(nz):
                g = ob.vertex_groups.new(name=b)
                for k in nz:
                    g.add([int(k)], float(wv[k]), 'REPLACE')
        ob.parent = arm
        ob.modifiers.new("Armature", 'ARMATURE').object = arm
    return ob


def beard_colour(col):
    """beards run a touch warmer / lighter than the head hair."""
    c = np.array(col, float)
    return tuple(np.clip(c * np.array((1.06, 1.0, 0.94)) + 0.01, 0, 1).tolist())


def beard_object(P, B, lm, style, arm, col, name="MHP_beard"):
    """facial hair shell object (or None); vertices follow their hm08 skin vertices (weights from the basemesh)."""
    sh = beard_shell(P, B, lm, style)
    if sh is None:
        return None
    region, thick, layers, tile, gain, grey, hang = BEARDS[style]
    print("BEARD", style, region, sh.nu, "verts x", layers, flush=True)
    c = np.array(beard_colour(col))
    if grey:                                                        # grey: the base darkens towards mid grey, plus white strands
        c = c * (1 - 0.7 * grey) + 0.7 * grey * np.array((0.50, 0.48, 0.45))
    mat = shell_material(f"MH_Beard_{name}", os.path.join(TEX, "beard_clumps.png"), tuple(c), grey=grey * 0.45, gain=gain,
                         sparse=0.55, rough=0.8, dark_in=0.5)
    return shell_object(sh, P, name, mat, arm, lm)


def hair_object(P, B, lm, base, prm, arm, col, grey=0.0, name="MHP_hair"):
    sh = hair_shell(P, B, lm, base, prm)
    tex = os.path.join(TEX, "scalp_strands.png" if base == "cap" else "curl_strands.png")
    mat = shell_material(f"MH_HairShell_{name}", tex, col, grey=grey, gain=1.5 if base == "cap" else 1.7,
                         sparse=0.45 if base == "cap" else 0.62, rough=0.75, dark_in=0.45 if base == "curls" else 0.6)
    print("HAIRSHELL", base, sh.nu, "verts x", sh.layers, flush=True)
    return shell_object(sh, P, name, mat, arm, lm)


def stubble_tint(T, P, B, lm, style, col):
    """darken the skin in the beard region for stubble (visible on the jaw, chin and upper lip) and under every beard."""
    region, thick, layers, tile, gain, grey, hang = BEARDS[style]
    if region is None:
        return T
    import paint
    m = region_mask(P, B, lm, "full" if thick <= 0 else region).astype(float)
    m = paint.smooth(m[:, None], lm.faces, len(P), it=2)[:, 0]
    c = np.array(col, float)
    if grey:
        c = c * (1 - grey) + grey * np.array((0.62, 0.60, 0.57))
    k = float(np.clip(gain, 0, 1)) if thick <= 0 else 0.85
    shadow = np.clip(c * 1.5 + 0.10, 0, 1)                       # the hair colour, as a skin multiplier
    if thick <= 0:                                                  # stubble: a clearly darker, slightly cool shadow
        shadow = np.clip(c * 1.0 + 0.13, 0, 1)
        shadow = shadow * 0.8 + 0.2 * shadow.mean() * np.array((0.95, 1.0, 1.06))
    return T * (1 - (m * k)[:, None]) + (T * shadow) * (m * k)[:, None]


# natural hair colours (sRGB): black .. blonde, muted auburn / red rarer
PALETTE = {
    "black": (0.055, 0.047, 0.042), "soft black": (0.095, 0.072, 0.058), "dark brown": (0.16, 0.105, 0.072),
    "brown": (0.25, 0.165, 0.105), "light brown": (0.36, 0.26, 0.165), "dark blonde": (0.48, 0.37, 0.24),
    "blonde": (0.64, 0.53, 0.36), "auburn": (0.30, 0.15, 0.09), "red": (0.42, 0.21, 0.11),
}
_PAL_KEYS = list(PALETTE)
_PAL_W = {
    None: [2.0, 2.5, 3.0, 2.5, 1.1, 0.7, 0.35, 0.35, 0.12],
    "dark": [6.0, 4.0, 2.0, 0.6, 0.1, 0.0, 0.0, 0.05, 0.0],
    "north": [0.5, 1.0, 2.0, 2.5, 2.0, 1.5, 0.9, 0.7, 0.3],
    "west": [1.2, 2.0, 3.0, 2.8, 1.4, 0.9, 0.4, 0.45, 0.15],
}


def hair_colour(rng, culture, tone_lum, age):
    """natural hair colour from the person: mostly black / dark brown / brown, some blonde, rarer muted auburn or red;
    darker on darker skin and in the south / east, lighter possible in the north / west; greying from about 40 as a mix
    with grey-white (salt and pepper).  Returns (srgb colour, greying 0..1)."""
    key = "dark" if (culture in ("south", "east") or tone_lum < 0.45) else (culture if culture in _PAL_W else None)
    p = np.array(_PAL_W[key], float)
    c = np.array(PALETTE[_PAL_KEYS[int(rng.choice(len(p), p=p / p.sum()))]])
    g = float(np.clip((age - 40) / 32.0 + rng.normal(0, 0.1), 0, 1))
    grey = np.array((0.78, 0.76, 0.72)) if g > 0.85 else np.array((0.56, 0.54, 0.51))
    return tuple((c * (1 - g * 0.85) + grey * g * 0.85).tolist()), g
