"""Preview materials for the MakeHuman base on the look-dev stage of ../lookdev.py (same lights, camera rules, backdrop).

Skin: the look-dev skin (SSS, sheen, soft micro bump) on the tone colour, multiplied by a per-vertex "Tint" colour
(lip colour, cheek / nose / ear blush, lid shadow, liner) painted from MakeHuman vertex groups and landmarks (paint_tint).
Eyes: the MakeHuman eye texture under a glossy coat.  Lashes, brows, hair: the MakeHuman card textures (alpha).
"""
import bpy, os, sys
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import lookdev as ld  # noqa: E402

TONE = {"T1_light": (0.97, 0.80, 0.70), "T2_fair": (0.95, 0.68, 0.53), "T3_warm": (0.82, 0.58, 0.44),
        "T4_tan": (0.70, 0.47, 0.34), "T5_brown": (0.50, 0.32, 0.23), "T6_deep": (0.33, 0.21, 0.15)}
LIP = (0.72, 0.36, 0.38)


def _mat(name):
    m = bpy.data.materials.get(name)
    if m:
        bpy.data.materials.remove(m)
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    return m, m.node_tree, m.node_tree.nodes["Principled BSDF"]


def skin(tone="T2_fair", name=None, decal=None):
    m, nt, bs = _mat(name or f"MH_Skin_{tone}")
    base = TONE.get(tone, TONE["T2_fair"])
    rgb = nt.nodes.new("ShaderNodeRGB")
    rgb.outputs[0].default_value = (*ld.srgb(base), 1)
    att = nt.nodes.new("ShaderNodeVertexColor")
    att.layer_name = "Tint"
    mix = nt.nodes.new("ShaderNodeMix")
    mix.data_type = 'RGBA'
    mix.blend_type = 'MULTIPLY'
    mix.inputs["Factor"].default_value = 1.0
    nt.links.new(rgb.outputs[0], mix.inputs[6])
    nt.links.new(att.outputs["Color"], mix.inputs[7])
    col_out = mix.outputs[2]
    if decal is not None:
        uvn = nt.nodes.new("ShaderNodeUVMap")
        uvn.uv_map = "FaceDecalUV"
        tx = nt.nodes.new("ShaderNodeTexImage")
        tx.image = decal
        tx.extension = 'CLIP'
        nt.links.new(uvn.outputs[0], tx.inputs[0])
        mk = nt.nodes.new("ShaderNodeVertexColor")
        mk.layer_name = "DecalMask"
        sep = nt.nodes.new("ShaderNodeSeparateColor")
        nt.links.new(mk.outputs["Color"], sep.inputs[0])
        fac = nt.nodes.new("ShaderNodeMath")
        fac.operation = 'MULTIPLY'
        nt.links.new(tx.outputs["Alpha"], fac.inputs[0])
        nt.links.new(sep.outputs[0], fac.inputs[1])
        dm = nt.nodes.new("ShaderNodeMix")
        dm.data_type = 'RGBA'
        nt.links.new(fac.outputs[0], dm.inputs["Factor"])
        nt.links.new(col_out, dm.inputs[6])
        nt.links.new(tx.outputs["Color"], dm.inputs[7])
        col_out = dm.outputs[2]
    nt.links.new(col_out, bs.inputs["Base Color"])
    bs.inputs["Roughness"].default_value = 0.52
    # lip gloss from the FaceMask attribute (R): roughness 0.52 -> 0.28, more specular, a thin clear coat
    fm = nt.nodes.new("ShaderNodeVertexColor")
    fm.layer_name = "FaceMask"
    sepm = nt.nodes.new("ShaderNodeSeparateColor")
    nt.links.new(fm.outputs["Color"], sepm.inputs[0])
    rmap = nt.nodes.new("ShaderNodeMapRange")
    rmap.inputs["To Min"].default_value = 0.52
    rmap.inputs["To Max"].default_value = 0.40
    nt.links.new(sepm.outputs[0], rmap.inputs["Value"])
    nt.links.new(rmap.outputs["Result"], bs.inputs["Roughness"])
    spec = nt.nodes.new("ShaderNodeMapRange")
    spec.inputs["To Min"].default_value = 0.38
    spec.inputs["To Max"].default_value = 0.65
    nt.links.new(sepm.outputs[0], spec.inputs["Value"])
    coat = nt.nodes.new("ShaderNodeMath")
    coat.operation = 'MULTIPLY'
    coat.inputs[1].default_value = 0.08
    nt.links.new(sepm.outputs[0], coat.inputs[0])
    bs.inputs["Coat Roughness"].default_value = 0.12
    _skin_links = (spec, coat)
    noise = nt.nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 900.0
    noise.inputs["Detail"].default_value = 3.0
    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.05
    bump.inputs["Distance"].default_value = 0.0002
    nt.links.new(noise.outputs["Fac"], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], bs.inputs["Normal"])
    ld._skin_common(bs)
    nt.links.new(_skin_links[0].outputs["Result"], bs.inputs["Specular IOR Level"])
    nt.links.new(_skin_links[1].outputs[0], bs.inputs["Coat Weight"])
    return m


def flat(name, col, rough=0.5, sss=0.0):
    m, nt, bs = _mat(name)
    bs.inputs["Base Color"].default_value = (*ld.srgb(col), 1)
    bs.inputs["Roughness"].default_value = rough
    bs.inputs["Subsurface Weight"].default_value = sss
    bs.inputs["Subsurface Radius"].default_value = (1.0, 0.3, 0.2)
    bs.inputs["Subsurface Scale"].default_value = 0.003
    return m


def eye(tex, name="MH_Eye"):
    m, nt, bs = _mat(name)
    t = nt.nodes.new("ShaderNodeTexImage")
    t.image = bpy.data.images.load(tex, check_existing=True)
    ao = nt.nodes.new("ShaderNodeAmbientOcclusion")
    ao.inputs["Distance"].default_value = 0.009
    ao.samples = 16
    mul = nt.nodes.new("ShaderNodeMix")
    mul.data_type = 'RGBA'
    mul.blend_type = 'MULTIPLY'
    mul.inputs["Factor"].default_value = 1.0
    warm = nt.nodes.new("ShaderNodeMix")                 # off-white, slightly warm sclera (never pure white)
    warm.data_type = 'RGBA'
    warm.blend_type = 'MULTIPLY'
    warm.inputs["Factor"].default_value = 1.0
    warm.inputs[7].default_value = (0.93, 0.87, 0.83, 1)
    nt.links.new(t.outputs["Color"], warm.inputs[6])
    t_col = warm.outputs[2]
    nt.links.new(t_col, mul.inputs[6])
    nt.links.new(ao.outputs["Color"], mul.inputs[7])
    nt.links.new(mul.outputs[2], bs.inputs["Base Color"])
    nt.links.new(mul.outputs[2], bs.inputs["Emission Color"])
    bs.inputs["Emission Strength"].default_value = 0.0
    bs.inputs["Emission Strength"].default_value = 0.12
    bs.inputs["Roughness"].default_value = 0.35
    bs.inputs["Specular IOR Level"].default_value = 0.2
    bs.inputs["Subsurface Weight"].default_value = 0.1
    bs.inputs["Subsurface Radius"].default_value = (1.0, 0.5, 0.4)
    bs.inputs["Subsurface Scale"].default_value = 0.002
    return m


def cornea(name="MH_Cornea"):
    """clear coat over the iris: transparent + glossy (fresnel), so the eye gets a crisp highlight."""
    m, nt, bs = _mat(name)
    nt.nodes.remove(bs)
    out = nt.nodes["Material Output"]
    tr = nt.nodes.new("ShaderNodeBsdfTransparent")
    gl = nt.nodes.new("ShaderNodeBsdfGlossy")
    gl.inputs["Roughness"].default_value = 0.03
    fr = nt.nodes.new("ShaderNodeFresnel")
    fr.inputs["IOR"].default_value = 1.38
    mx = nt.nodes.new("ShaderNodeMixShader")
    nt.links.new(fr.outputs[0], mx.inputs[0])
    nt.links.new(tr.outputs[0], mx.inputs[1])
    nt.links.new(gl.outputs[0], mx.inputs[2])
    nt.links.new(mx.outputs[0], out.inputs["Surface"])
    m.surface_render_method = 'BLENDED'
    return m


def card(tex, name, colour=None, rough=0.6, alpha_gain=1.0, solid=False, clip=0.0):
    """alpha-tested card (lashes, brows, hair): texture alpha, colour = texture x colour (if given)."""
    m, nt, bs = _mat(name)
    t = nt.nodes.new("ShaderNodeTexImage")
    t.image = bpy.data.images.load(tex, check_existing=True)
    if colour is not None and solid:
        bs.inputs["Base Color"].default_value = (*ld.srgb(colour), 1)
    elif colour is not None:
        c = nt.nodes.new("ShaderNodeRGB")
        c.outputs[0].default_value = (*ld.srgb(colour), 1)
        mul = nt.nodes.new("ShaderNodeMix")
        mul.data_type = 'RGBA'
        mul.blend_type = 'MULTIPLY'
        mul.inputs["Factor"].default_value = 1.0
        nt.links.new(t.outputs["Color"], mul.inputs[6])
        nt.links.new(c.outputs[0], mul.inputs[7])
        nt.links.new(mul.outputs[2], bs.inputs["Base Color"])
    else:
        nt.links.new(t.outputs["Color"], bs.inputs["Base Color"])
    # alpha: remap so the faint fringe of the card (alpha < clip) disappears, then gain (no grey traces at card edges)
    rmp = nt.nodes.new("ShaderNodeMapRange")
    rmp.clamp = True
    rmp.inputs["From Min"].default_value = clip
    rmp.inputs["From Max"].default_value = 1.0
    nt.links.new(t.outputs["Alpha"], rmp.inputs["Value"])
    mth = nt.nodes.new("ShaderNodeMath")
    mth.operation = 'MULTIPLY'
    mth.use_clamp = True
    mth.inputs[1].default_value = alpha_gain
    nt.links.new(rmp.outputs["Result"], mth.inputs[0])
    nt.links.new(mth.outputs[0], bs.inputs["Alpha"])
    bs.inputs["Roughness"].default_value = rough
    bs.inputs["Specular IOR Level"].default_value = 0.25
    m.surface_render_method = 'DITHERED'
    m.use_backface_culling = False
    return m


def set_mask(ob, rgb):
    me = ob.data
    a = me.color_attributes.get("FaceMask") or me.color_attributes.new("FaceMask", 'FLOAT_COLOR', 'POINT')
    c = np.zeros((len(me.vertices), 4))
    c[:, :3] = rgb
    c[:, 3] = 1
    a.data.foreach_set("color", c.ravel())


def set_tint(ob, rgb):
    """per-vertex Tint colour attribute (n x 3, linear multipliers)."""
    me = ob.data
    a = me.color_attributes.get("Tint")
    if a is None:
        a = me.color_attributes.new("Tint", 'FLOAT_COLOR', 'POINT')
    c = np.ones((len(me.vertices), 4))
    c[:, :3] = rgb
    a.data.foreach_set("color", c.ravel())
