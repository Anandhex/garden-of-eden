"""Build mh/editor.blend (the hand-editing file) from mh/base_mh.blend:

    $B -b art3d/characters/mh/base_mh.blend -P art3d/characters/mh/make_editor.py

Two copies of the game base with every blend shape: collection "Woman" (Sex 1, Stylise_F 1) on the left and "Man"
(Stylise_M 1) on the right, the look-dev lights and backdrop, the face texture set (export/textures/face_*), eye textures,
lash ribbon, brows, a front and a 3/4 camera per person.  The panel (editor_panel.py) is loaded by open_editor.sh.
"""
import bpy, os, sys, json
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.dirname(HERE))
import lookdev as ld, look_mh as lk  # noqa: E402

TEX = os.path.join(HERE, "export", "textures")
OFFSET = {"F": -0.45, "M": 0.45}


def img(path):
    im = bpy.data.images.load(path, check_existing=True)
    return im


def skin_head(sex, tone):
    m, nt, bs = lk._mat(f"Skin_Head_{sex}")
    base = lk.TONE[tone]
    rgb = nt.nodes.new("ShaderNodeRGB")
    rgb.outputs[0].default_value = (*ld.srgb(base), 1)
    uv = nt.nodes.new("ShaderNodeUVMap")
    uv.uv_map = "FaceDecalUV"
    tint = nt.nodes.new("ShaderNodeTexImage")
    tint.image = img(os.path.join(TEX, f"face_tint_{sex.lower()}.png"))
    tint.extension = 'EXTEND'
    paint = nt.nodes.new("ShaderNodeTexImage")
    paint.image = img(os.path.join(TEX, f"face_paint_{sex.lower()}.png"))
    paint.extension = 'CLIP'
    for t in (tint, paint):
        nt.links.new(uv.outputs[0], t.inputs[0])
    mul = nt.nodes.new("ShaderNodeMix")
    mul.data_type = 'RGBA'
    mul.blend_type = 'MULTIPLY'
    mul.inputs["Factor"].default_value = 1.0
    nt.links.new(rgb.outputs[0], mul.inputs[6])
    nt.links.new(tint.outputs["Color"], mul.inputs[7])
    over = nt.nodes.new("ShaderNodeMix")
    over.data_type = 'RGBA'
    nt.links.new(paint.outputs["Alpha"], over.inputs["Factor"])
    nt.links.new(mul.outputs[2], over.inputs[6])
    nt.links.new(paint.outputs["Color"], over.inputs[7])
    nt.links.new(over.outputs[2], bs.inputs["Base Color"])
    mask = nt.nodes.new("ShaderNodeTexImage")
    mask.image = img(os.path.join(TEX, f"face_mask_{sex.lower()}.png"))
    mask.image.colorspace_settings.name = "Non-Color"
    nt.links.new(uv.outputs[0], mask.inputs[0])
    sep = nt.nodes.new("ShaderNodeSeparateColor")
    nt.links.new(mask.outputs["Color"], sep.inputs[0])
    rr = nt.nodes.new("ShaderNodeMapRange")
    rr.inputs["To Min"].default_value, rr.inputs["To Max"].default_value = 0.52, 0.40
    nt.links.new(sep.outputs[0], rr.inputs["Value"])
    ld._skin_common(bs)
    nt.links.new(rr.outputs["Result"], bs.inputs["Roughness"])
    cw = nt.nodes.new("ShaderNodeMath")
    cw.operation = 'MULTIPLY'
    cw.inputs[1].default_value = 0.08
    nt.links.new(sep.outputs[0], cw.inputs[0])
    nt.links.new(cw.outputs[0], bs.inputs["Coat Weight"])
    bs.inputs["Coat Roughness"].default_value = 0.12
    return m
    bs.inputs["Roughness"].default_value = 0.52
    ld._skin_common(bs)
    return m


def main():
    sc = bpy.context.scene
    arm0 = bpy.data.objects["Armature"]
    parts0 = [o for o in bpy.data.objects if o.type == 'MESH' and o.parent == arm0]
    socks0 = [o for o in bpy.data.objects if o.name.startswith("Socket_")]
    R = json.load(open(os.path.join(HERE, "recipe.json")))
    for sex, cname in (("F", "Woman"), ("M", "Man")):
        coll = bpy.data.collections.new(cname)
        sc.collection.children.link(coll)
        arm = arm0.copy()
        arm.data = arm0.data.copy()
        arm.name = f"{sex}_Armature"
        coll.objects.link(arm)
        tone = "T2_fair" if sex == "F" else "T3_warm"
        mats = {"Skin": lk.skin(tone, name=f"Skin_{sex}"), "Skin_Head": skin_head(sex, tone),
                "Eye": lk.eye(os.path.join(HERE, "textures", "eye_bluegreen.png" if sex == "F" else "eye_brown.png"), name=f"Eye_{sex}"),
                "Cornea": lk.cornea(name=f"Cornea_{sex}"), "Lashes": lk.card(os.path.join(HERE, "textures", "eyelashes02_clean.png"), f"Lashes_{sex}", colour=(0.015, 0.011, 0.009), alpha_gain=1.4, solid=True),
                "Teeth": lk.flat(f"Teeth_{sex}", (0.93, 0.89, 0.80), 0.35), "TearDuct": lk.flat(f"TearDuct_{sex}", (0.80, 0.50, 0.50), 0.18, 0.5), "Tongue": lk.flat(f"Tongue_{sex}", (0.72, 0.33, 0.33), 0.45, 0.2)}
        brow_png = os.path.join(HERE, "..", "tools", "blender_user", "extensions", ".user", "user_default", "mpfb", "data", "eyebrows",
                                R["proxies"]["eyebrows"][sex], R["proxies"]["eyebrows"][sex] + ".png")
        mats["Brows"] = lk.card(os.path.abspath(brow_png), f"Brows_{sex}", colour=tuple(R["look"][sex]["person"]["brow_col"]),
                                alpha_gain=R["look"][sex]["person"].get("brow_gain", 1.2), solid=True)
        for o0 in parts0:
            o = o0.copy()
            o.data = o0.data.copy()
            o.name = f"{sex}_{o0.name}"
            coll.objects.link(o)
            o.parent = arm
            for md in o.modifiers:
                if md.type == 'ARMATURE':
                    md.object = arm
            if o.data.color_attributes.get("Tint") is None:
                lk.set_tint(o, np.ones((len(o.data.vertices), 3)))
            for i, slot in enumerate(o.material_slots):
                nm = slot.material.name if slot.material else ""
                key = nm.split(".")[0]
                if key == "Skin_Head" and "FaceDecalUV" not in o.data.uv_layers:
                    key = "Skin"                      # ears: no face texture coordinates
                if key in mats:
                    o.material_slots[i].material = mats[key]
            if o.data.shape_keys:
                for kb in o.data.shape_keys.key_blocks[1:]:
                    kb.slider_min, kb.slider_max = -1.0, 1.0
                    kb.value = {"Sex": 1.0 if sex == "F" else 0.0, f"Stylise_{sex}": 1.0}.get(kb.name, 0.0)
            # live normals in the editor (shapes change the face): drop the frozen custom normals of the copy
            if o.data.has_custom_normals:
                o.data.free_normals_split() if hasattr(o.data, "free_normals_split") else None
        for s0 in socks0:
            s = s0.copy()
            s.name = f"{sex}_{s0.name}"
            s.parent = arm
            coll.objects.link(s)
            s.hide_viewport = True
        arm.location.x = OFFSET[sex]
        coll["goe_sliders"] = json.dumps({"Stylise": 1.0})
    # armatures stay (the rig) but hidden in the view; drop the MakeHuman helper object left by the build
    for sex in ("F", "M"):
        a = bpy.data.objects[f"{sex}_Armature"]
        a.show_in_front = False
        a.hide_set(True) if bpy.context.view_layer.objects.get(a.name) else None
        a.hide_viewport = True
    for o in [o for o in bpy.data.objects if o.name.startswith("MH_Base")]:
        bpy.data.objects.remove(o, do_unlink=True)
    # remove the originals
    for o in parts0 + socks0 + [arm0]:
        bpy.data.objects.remove(o, do_unlink=True)
    # stage: look-dev lights + backdrop, cameras per person
    scc, cam0 = ld.setup(res=(900, 900), centre=(0, 0, 1.2))
    bpy.data.objects.remove(cam0, do_unlink=True)
    for sex in ("F", "M"):
        arm = bpy.data.objects[f"{sex}_Armature"]
        eye_z = 1.53 if sex == "F" else 1.65
        x = OFFSET[sex]
        for name, az in (("Cam_Front", 0), ("Cam_34", 32)):
            cam = bpy.data.objects.new(f"{name}_{sex}", bpy.data.cameras.new(f"{name}_{sex}"))
            sc.collection.objects.link(cam)
            ld.aim(cam, (x, -0.10, eye_z - 0.04), az, 0.9, elev_deg=2, lens=85)
    sc.camera = bpy.data.objects["Cam_34_F"]
    sc.render.resolution_x = sc.render.resolution_y = 900
    # viewport: material preview, looking at both faces
    for area in getattr(bpy.context.screen, "areas", []) if bpy.context.screen else []:
        pass
    bpy.ops.file.make_paths_relative() if False else None
    out = os.path.join(HERE, "editor.blend")
    bpy.ops.wm.save_as_mainfile(filepath=out, relative_remap=True)
    print("EDITOR", out)


if __name__ == "__main__":
    main()
