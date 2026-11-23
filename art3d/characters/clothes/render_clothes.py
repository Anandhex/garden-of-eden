"""Previews of the clothes (EEVEE, soft stylised shading, same set-up as ../render_preview.py).

    B=/Applications/Blender.app/Contents/MacOS/Blender
    $B -b art3d/characters/clothes/clothes.blend -P art3d/characters/clothes/render_clothes.py -- only=lineup,extremes,species,pieces
    ... -- test=t_shirt,a_sleeve_long      (quick look at some pieces on the neutral body, uses clothes_test.blend if given)
"""
import bpy, sys, os, math, json
import numpy as np
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
CH = os.path.dirname(HERE)
sys.path.insert(0, CH)
sys.path.insert(0, HERE)
import render_preview as rp  # noqa: E402
import common  # noqa: E402

OUT = os.path.join(HERE, "previews")
os.makedirs(OUT, exist_ok=True)
rp.RES = 640
ROLE_TILE = {"GC_Tint": 0.07, "GC_Quilt": 0.30, "GC_Trim": 0.06, "GC_Leather": 0.14, "GC_Metal": 0.30, "GC_Linen": 0.07, "GC_Stripe": 0.3, "GC_Plaid": 0.32}
TEXF = {"GC_Tint": "detail_weave.png", "GC_Quilt": "detail_quilt.png", "GC_Trim": "trim_stitch.png", "GC_Leather": "detail_leather.png",
        "GC_Metal": "detail_metal.png", "GC_Linen": "detail_weave.png", "GC_Stripe": "detail_stripes.png", "GC_Plaid": "detail_plaid.png"}
FIXED = {"GC_Leather": (0.40, 0.26, 0.16), "GC_Metal": (0.50, 0.54, 0.60), "GC_Linen": (0.86, 0.80, 0.68)}


def hexrgb(h):
    h = h.lstrip("#")
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(x ** 2.2 for x in c)


def cloth_material(name, col, texname):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    emi = nt.nodes.new("ShaderNodeEmission")
    diff = nt.nodes.new("ShaderNodeBsdfDiffuse")
    s2r = nt.nodes.new("ShaderNodeShaderToRGB")
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    mul = nt.nodes.new("ShaderNodeMix"); mul.data_type = 'RGBA'; mul.blend_type = 'MULTIPLY'; mul.inputs[0].default_value = 1
    tm = nt.nodes.new("ShaderNodeMix"); tm.data_type = 'RGBA'; tm.blend_type = 'MULTIPLY'; tm.inputs[0].default_value = 1
    vc = nt.nodes.new("ShaderNodeVertexColor"); vc.layer_name = "Col"
    vm = nt.nodes.new("ShaderNodeMix"); vm.data_type = 'RGBA'; vm.blend_type = 'MULTIPLY'; vm.inputs[0].default_value = 1
    tx = nt.nodes.new("ShaderNodeTexImage")
    tx.image = bpy.data.images.load(os.path.join(HERE, "export", "textures", texname), check_existing=True)
    tm.inputs[7].default_value = (*col, 1)
    lw = nt.nodes.new("ShaderNodeLayerWeight"); lw.inputs["Blend"].default_value = 0.3
    rr = nt.nodes.new("ShaderNodeValToRGB")
    add = nt.nodes.new("ShaderNodeMix"); add.data_type = 'RGBA'; add.blend_type = 'ADD'; add.inputs[0].default_value = 1
    rmul = nt.nodes.new("ShaderNodeMix"); rmul.data_type = 'RGBA'; rmul.blend_type = 'MULTIPLY'; rmul.inputs[0].default_value = 1
    rmul.inputs[7].default_value = (0.16, 0.2, 0.2, 1)
    diff.inputs["Color"].default_value = (1, 1, 1, 1)
    nt.links.new(diff.outputs[0], s2r.inputs[0])
    nt.links.new(s2r.outputs["Color"], ramp.inputs[0])
    e = ramp.color_ramp
    e.interpolation = 'B_SPLINE'
    stops = [(0.0, (0.52, 0.42, 0.52)), (0.22, (0.74, 0.62, 0.66)), (0.5, (1.05, 0.94, 0.88)), (0.8, (1.18, 1.1, 1.0)), (1.0, (1.24, 1.16, 1.04))]
    e.elements[0].position, e.elements[0].color = stops[0][0], (*stops[0][1], 1)
    e.elements[1].position, e.elements[1].color = stops[-1][0], (*stops[-1][1], 1)
    for pos, c in stops[1:-1]:
        k = e.elements.new(pos); k.color = (*c, 1)
    nt.links.new(tx.outputs["Color"], tm.inputs[6])
    nt.links.new(tm.outputs[2], vm.inputs[6])
    nt.links.new(vc.outputs["Color"], vm.inputs[7])
    nt.links.new(ramp.outputs["Color"], mul.inputs[6])
    nt.links.new(vm.outputs[2], mul.inputs[7])
    nt.links.new(lw.outputs["Facing"], rr.inputs[0])
    r = rr.color_ramp; r.interpolation = 'EASE'
    r.elements[0].position, r.elements[0].color = 0.0, (0.30, 0.75, 0.90, 1)
    r.elements[1].position, r.elements[1].color = 0.45, (0, 0, 0, 1)
    nt.links.new(rr.outputs["Color"], rmul.inputs[6])
    nt.links.new(mul.outputs[2], add.inputs[6])
    nt.links.new(rmul.outputs[2], add.inputs[7])
    nt.links.new(add.outputs[2], emi.inputs["Color"])
    nt.links.new(emi.outputs[0], out.inputs["Surface"])
    return m


_MC = {}


def preview_mat(gcname, tint, trim):
    key = (gcname, tint, trim)
    if key not in _MC:
        if gcname in ("GC_Tint", "GC_Quilt", "GC_Stripe", "GC_Plaid"):
            col = hexrgb(tint)
        elif gcname == "GC_Trim":
            col = hexrgb(trim)
        else:
            col = tuple(x ** 2.2 for x in FIXED[gcname])
        _MC[key] = cloth_material(f"pv_{gcname}_{len(_MC)}", col, TEXF[gcname])
    return _MC[key]


def garments():
    c = bpy.data.collections.get("Clothes")
    return {o.name: o for o in c.objects} if c else {}


def show(obs_on, tint="#6b6f4a", trim="#8a3b2e"):
    G = garments()
    for n, o in G.items():
        on = n in obs_on
        o.hide_render = not on
        o.hide_viewport = not on
        if on:
            for s in o.material_slots:
                s.material = preview_mat(s.material.name if not s.material.name.startswith("pv_") else s.material["gc"], tint, trim)
                s.material["gc"] = s.material.name  # no-op safety
    return G


def assign(G, names, tint, trim):
    for n, o in G.items():
        on = n in names
        o.hide_render = not on
        o.hide_viewport = not on
        if on:
            for i, s in enumerate(o.material_slots):
                gc = o.get("gcmats")[i]
                s.material = preview_mat(gc, tint, trim)


def remember(G):
    for o in G.values():
        o["gcmats"] = [s.material.name for s in o.material_slots]


def apply_body(obs, kw):
    rp.setk(obs, **kw)


def scale_rig(arm, s):
    arm.scale = (s, s, s)
    bpy.context.view_layer.update()


def skin_for(col):
    pass


def body_objs():
    bo = [o for o in rp.parts() if o.data.shape_keys]
    return bo


def render_body(sc, rig, cam, path, kw, names, tint, trim, G, hide_regions, az=0.0, scale=2.0, cz=0.9, species="human", sex_default=None):
    bobs = body_objs()
    gobs = [G[n] for n in names if n in G and G[n].data.shape_keys]
    allobs = bobs + gobs
    rp.reset(allobs)
    rp.CUR.clear()
    rp.CUR.update(kw)
    for ob in allobs:
        kbs = ob.data.shape_keys.key_blocks
        for k, v in kw.items():
            if k in kbs:
                kbs[k].value = v
    # hide body regions that are covered
    reg = {"torso": "Mesh_Torso", "arms": "Mesh_Arms", "hands": "Mesh_Hands", "legs": "Mesh_Legs", "feet": "Mesh_Feet"}
    for r, n in reg.items():
        bpy.data.objects[n].hide_render = r in hide_regions
    assign(G, names, tint, trim)
    bpy.context.view_layer.update()
    rp.shot(sc, rig, cam, path, az=math.radians(az), center_z=cz, scale=scale)


def meta():
    return json.load(open(os.path.join(HERE, "export", "clothes_manifest.json")))


SPECIES = json.load(open(os.path.join(CH, "export", "species_presets.json")))
EARS = {"elf": ["Part_Ear_Elf_A_L", "Part_Ear_Elf_A_R", "Part_Nose_Elf"], "dwarf": ["Part_Nose_Dwarf"], "orc": ["Part_Nose_Orc"]}


def set_species(sid, sex):
    rp.set_visible(EARS.get(sid, []))
    sp = SPECIES[sid]
    return sp["rootScaleF" if sex == "feminine" else "rootScaleM"]


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    opts = {a.split("=")[0]: a.split("=")[1] for a in argv if "=" in a}
    only = opts.get("only", "lineup,extremes,species,pieces").split(",")
    sc, rig, cam = rp.setup_scene()
    bobs, arm = rp.prepare_body()
    G = garments()
    remember(G)
    arm = bpy.data.objects["Armature"]
    rp.pose_arms_down(arm)
    paths = []
    if "test" in opts:
        names = opts["test"].split(",")
        m = None
        hides = set()
        for k, kw, nm in (("a", {}, "neutral"), ("b", dict(Sex=1, Breast=0.8, Belly=0.3, Hips=0.6), "fem")):
            for az in (0.0, 90.0):
                p = os.path.join(OUT, f"_test_{nm}_{int(az)}.png")
                render_body(sc, rig, cam, p, kw, names, "#6b6f4a", "#8a3b2e", G, [], az=az)
                paths.append(p)
        rp.montage(paths, 4, os.path.join(OUT, "_test.png"))
        return
    M = meta()
    P = {p["id"]: p for p in M["pieces"]}
    OFT = {o["id"]: o for o in M["outfits"]}

    def outfit_hides(o):
        h = set()
        for pid in o["pieces"]:
            h |= set(P[pid]["hides"])
        return h

    def outfit_body(o, variant=0):
        sexes = ["masculine", "feminine"]
        sex = o["sex"] if o["sex"] != "any" else sexes[variant % 2]
        kw = {}
        if sex == "feminine":
            kw.update(Sex=1.0, Breast=0.45 + 0.1 * (variant % 3), Hips=0.3)
        if o["age"] == "child":
            kw.update(Child=1.0)
        if o["age"] == "elder":
            kw.update(Age_Old=0.9, Heavy=0.15)
        return sex, kw

    if "lineup" in only:
        outs = M["outfits"]
        ims = []
        for i, o in enumerate(outs):
            sex, kw = outfit_body(o, i)
            p = os.path.join(OUT, f"_o_{o['id']}.png")
            rig.scale = (1, 1, 1)
            render_body(sc, rig, cam, p, kw, o["pieces"], o["tint"], o["trim"], G, outfit_hides(o), az=-25.0, scale=2.0)
            ims.append(p)
        for k in range(0, len(ims), 12):
            rp.montage(ims[k:k + 12], 6, os.path.join(OUT, f"outfits_{k // 12 + 1}.png"))
        # also a full-size set of 6 turnarounds
        for oid in ("guard_imperial_m", "noble_imperial_f", "priest_imperial_m", "traveller_forest_m", "merchant_steppe_m", "farmer_river_f"):
            o = OFT[oid]
            sex, kw = outfit_body(o, 0)
            q = []
            for az in (-30.0, 60.0, 150.0, 240.0):
                p = os.path.join(OUT, f"_t_{oid}_{int(az)}.png")
                render_body(sc, rig, cam, p, kw, o["pieces"], o["tint"], o["trim"], G, outfit_hides(o), az=az, scale=2.0)
                q.append(p)
            rp.montage(q, 4, os.path.join(OUT, f"turn_{oid}.png"))
    if "species" in only:
        for oid in ("farmer_river_f", "guard_imperial_m"):
            o = OFT[oid]
            ims = []
            for sid in ("human", "elf", "dwarf", "halfling", "orc"):
                sex, kw = outfit_body(o, 0)
                kw = dict(kw)
                if sid != "human":
                    kw["Species_" + sid.capitalize()] = 1.0
                rs = set_species(sid, sex)
                rig.scale = (1, 1, 1)
                arm.scale = (rs, rs, rs)
                bpy.context.view_layer.update()
                p = os.path.join(OUT, f"_s_{oid}_{sid}.png")
                render_body(sc, rig, cam, p, kw, o["pieces"], o["tint"], o["trim"], G, outfit_hides(o), az=-25.0, scale=2.4, cz=1.0)
                ims.append(p)
            arm.scale = (1, 1, 1)
            rp.set_visible([])
            rp.montage(ims, 5, os.path.join(OUT, f"species_{oid}.png"))
    if "closeups" in only:
        stacks = [("heavy_belly", dict(Heavy=1.0, Belly=1.0, Waist_Wide=0.6, Butt=0.5)), ("thin", dict(Thin=1.0, Height_Legs=0.6)),
                  ("breast_curvy", dict(Sex=1.0, Breast=1.0, Waist_Slim=1.0, Hips=1.0, Butt=1.0)),
                  ("dwarf", dict(Species_Dwarf=1.0, Heavy=0.6)), ("halfling", dict(Species_Halfling=1.0, Belly=0.7)),
                  ("orc", dict(Species_Orc=1.0, Muscle=1.0, Chest_Muscle=1.0))]
        for oid in ("farmer_river_f", "guard_imperial_m", "merchant_river_m", "traveller_coastal_f"):
            o = OFT[oid]
            ims = []
            for nm, kw in stacks:
                p = os.path.join(OUT, f"_c_{oid}_{nm}.png")
                sid = "orc" if "Species_Orc" in kw else "dwarf" if "Species_Dwarf" in kw else "halfling" if "Species_Halfling" in kw else "human"
                rs = set_species(sid, "feminine" if kw.get("Sex") else "masculine")
                arm.scale = (rs, rs, rs)
                bpy.context.view_layer.update()
                hh = {"human": 1.0, "dwarf": 0.78, "halfling": 0.66, "orc": 1.2}[sid]
                render_body(sc, rig, cam, p, kw, o["pieces"], o["tint"], o["trim"], G, outfit_hides(o), az=-25.0, scale=1.5 * hh, cz=1.0 * hh)
                ims.append(p)
            arm.scale = (1, 1, 1)
            rp.set_visible([])
            rp.montage(ims, 6, os.path.join(OUT, f"closeups_{oid}.png"))
    if "extremes" in only:
        stacks = [("heavy_belly", dict(Heavy=1.0, Belly=1.0, Waist_Wide=0.6, Butt=0.5)), ("thin", dict(Thin=1.0, Height_Legs=0.6)),
                  ("breast_curvy", dict(Sex=1.0, Breast=1.0, Waist_Slim=1.0, Hips=1.0, Butt=1.0)),
                  ("muscle", dict(Muscle=1.0, Shoulders=1.0, Chest_Muscle=1.0, Arms_Thick=1.0, Legs_Thick=1.0)),
                  ("dwarf", dict(Species_Dwarf=1.0, Heavy=0.6)), ("halfling", dict(Species_Halfling=1.0, Belly=0.7)),
                  ("orc", dict(Species_Orc=1.0, Muscle=1.0, Chest_Muscle=1.0)), ("old_heavy", dict(Age_Old=1.0, Heavy=0.8, Belly=0.8, Sex=1.0, Breast=0.6))]
        for oid in ("guard_imperial_m", "noble_imperial_f", "priest_imperial_m", "farmer_river_f"):
            o = OFT[oid]
            ims = []
            for nm, kw in stacks:
                p = os.path.join(OUT, f"_e_{oid}_{nm}.png")
                sid = "orc" if "Species_Orc" in kw else "dwarf" if "Species_Dwarf" in kw else "halfling" if "Species_Halfling" in kw else "human"
                rs = set_species(sid, "feminine" if kw.get("Sex") else "masculine")
                arm.scale = (rs, rs, rs)
                bpy.context.view_layer.update()
                render_body(sc, rig, cam, p, kw, o["pieces"], o["tint"], o["trim"], G, outfit_hides(o), az=-25.0, scale=2.3, cz=1.0)
                ims.append(p)
            arm.scale = (1, 1, 1)
            rp.set_visible([])
            rp.montage(ims, 4, os.path.join(OUT, f"extremes_{oid}.png"))
    if "pieces" in only:
        ids = [p["id"] for p in M["pieces"]]
        ims = []
        for pid in ids:
            p = os.path.join(OUT, f"_p_{pid}.png")
            render_body(sc, rig, cam, p, {}, [pid], "#7a7a5a", "#a8452e", G, [], az=-30.0, scale=2.0)
            ims.append(p)
        for k in range(0, len(ims), 20):
            rp.montage(ims[k:k + 20], 10, os.path.join(OUT, f"pieces_{k // 20 + 1}.png"))


main()
