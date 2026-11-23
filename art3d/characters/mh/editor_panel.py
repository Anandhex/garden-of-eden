"""Garden of Eden editor panel (N-panel tab "Garden of Eden") for mh/editor.blend.  Loaded by open_editor.sh
(`Blender editor.blend --python editor_panel.py`).  Beginner guide: mh/EDITING.md.

The two people in the file (collections "Woman" and "Man") are copies of the game base (base_mh.blend) with every blend
shape.  The sliders set those blend shapes on the active person (plain words, grouped).  Buttons save the sliders as the
new neutral (recipe.json, with a backup), as a named preset (mh/presets/<name>.json), make a random person, reset,
render previews, and store a free sculpt as a checked shape.
"""
import bpy, os, sys, json, time, shutil
import numpy as np

HERE = os.path.dirname(os.path.abspath(bpy.data.filepath)) if bpy.data.filepath else os.path.dirname(os.path.abspath(__file__))
if not os.path.exists(os.path.join(HERE, "shapes_mh.py")):
    HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import shapes_mh as sh  # noqa: E402

CHAR = os.path.dirname(HERE)
SETS = {"F": "Woman", "M": "Man"}
GROUPS = [
    ("Head shape", ["Skull width", "Skull depth", "Forehead height", "Face length", "Middle face / nose length", "Lower face length",
                    "Brow ridge", "Cheekbones", "Cheek fullness", "Ear size"]),
    ("Eyes", ["Eye length", "Eye gap", "Eye tilt", "Eye openness"]),
    ("Nose", ["Nose width", "Nose bridge"]),
    ("Mouth & lips", ["Mouth width", "Upper lip", "Lower lip", "Cupid's bow"]),
    ("Jaw & chin", ["Jaw width", "Jaw angle", "Chin height", "Chin projection"]),
    ("Neck", ["Neck width", "Neck length"]),
    ("Eyebrows", list(sh.BROW_SLIDERS) + ["Brow density"]),
    ("Body", list(sh.BODY_SLIDERS)),
    ("Look", ["Stylise", "Age"]),
]
ALL_SLIDERS = dict(sh.VARIATION, **sh.BODY_SLIDERS, **sh.BROW_SLIDERS)
ALL_SLIDERS["Brow density"] = ("_brow_density", None)
ALL_SLIDERS["Stylise"] = ("Stylise", None)
ALL_SLIDERS["Age"] = ("Age_Old", None)


def prop_id(name):
    return "s_" + "".join(c if c.isalnum() else "_" for c in name.lower())


def set_objects(sex):
    coll = bpy.data.collections.get(SETS[sex])
    return [o for o in (coll.all_objects if coll else []) if o.type == 'MESH' and o.data.shape_keys]


def slider_values(scene):
    return {n: getattr(scene.goe, prop_id(n)) for n in ALL_SLIDERS}


def weights_from_sliders(sex, vals):
    w = {"Sex": 1.0 if sex == "F" else 0.0}
    for name, v in vals.items():
        pos, neg = ALL_SLIDERS[name]
        if name == "Stylise":
            w[f"Stylise_{sex}"] = v
            continue
        if neg is None or v >= 0:
            w[pos] = w.get(pos, 0.0) + v
        else:
            w[neg] = w.get(neg, 0.0) - v
    for sd in ("L", "R"):                         # the blink correctives (runtime does the same)
        w[f"Fix_EyeRound_Blink_{sd}"] = max(w.get("Eye_Round", 0), 0) * w.get(f"Eye_Blink_{sd}", 0)
    return w


def apply(scene, context=None):
    sex = scene.goe.person
    w = weights_from_sliders(sex, slider_values(scene))
    # brow density: alpha gain of the brow material (0 = default, +1 = denser, -1 = sparse)
    for o in set_objects(sex):
        if "Part_Brows" in o.name and o.material_slots and o.material_slots[0].material:
            for n in o.material_slots[0].material.node_tree.nodes:
                if n.type == 'MATH' and n.operation == 'MULTIPLY':
                    n.inputs[1].default_value = 1.2 * (1 + 0.5 * w.get("_brow_density", 0.0))
    for o in set_objects(sex):
        for kb in o.data.shape_keys.key_blocks[1:]:
            kb.slider_min, kb.slider_max = -1.0, 1.0
            kb.value = float(w.get(kb.name, 0.0))
    coll = bpy.data.collections.get(SETS[sex])
    if coll:
        coll["goe_sliders"] = json.dumps(slider_values(scene))


def _upd(self, context):
    if not context.scene.get("_goe_loading", False):
        apply(context.scene)


def load_person(self, context):
    sc = context.scene
    coll = bpy.data.collections.get(SETS[sc.goe.person])
    vals = json.loads(coll.get("goe_sliders", "{}")) if coll else {}
    sc["_goe_loading"] = True
    for n in ALL_SLIDERS:
        setattr(sc.goe, prop_id(n), float(vals.get(n, 1.0 if n == "Stylise" else 0.0)))
    sc["_goe_loading"] = False
    apply(sc)


ann = {"person": bpy.props.EnumProperty(name="Person", items=[("F", "Woman", ""), ("M", "Man", "")], update=load_person),
       "preset_name": bpy.props.StringProperty(name="Preset name", default="my_preset"),
       "seed": bpy.props.IntProperty(name="Seed", default=1, min=0),
       "sculpt_name": bpy.props.StringProperty(name="Shape name", default="User_Sculpt")}
for n in ALL_SLIDERS:
    lo, hi = (0.0, 1.0) if n in ("Age", "Stylise") else (-1.0, 1.0)
    ann[prop_id(n)] = bpy.props.FloatProperty(name=n, default=1.0 if n == "Stylise" else 0.0, min=lo, max=hi, update=_upd,
                                              description=f"{n}: -1 / +1 = about two standard deviations of real people")
GOEProps = type("GOEProps", (bpy.types.PropertyGroup,), {"__annotations__": ann})


class GOE_OT_save_neutral(bpy.types.Operator):
    bl_idname = "goe.save_neutral"
    bl_label = "Save as neutral"
    bl_description = "Write the sliders into recipe.json as this person's neutral (a backup copy is made first)"

    def execute(self, context):
        sc = context.scene
        sex = sc.goe.person
        path = os.path.join(HERE, "recipe.json")
        os.makedirs(os.path.join(HERE, "backups"), exist_ok=True)
        bak = os.path.join(HERE, "backups", time.strftime("recipe_%Y%m%d_%H%M%S.json"))
        shutil.copy(path, bak)
        R = json.load(open(path))
        vals = {k: round(v, 4) for k, v in slider_values(sc).items() if abs(v) > 1e-4 and k not in ("Stylise", "Age")}
        R[sex]["sliders"] = vals
        json.dump(R, open(path, "w"), indent=1)
        self.report({'INFO'}, f"saved {len(vals)} sliders as the {SETS[sex]} neutral (backup: {os.path.basename(bak)}); rebuild the base to bake them in")
        return {'FINISHED'}


class GOE_OT_save_preset(bpy.types.Operator):
    bl_idname = "goe.save_preset"
    bl_label = "Save as preset"
    bl_description = "Write the sliders to mh/presets/<name>.json (used by person.generate and the variety sheets)"

    def execute(self, context):
        sc = context.scene
        os.makedirs(os.path.join(HERE, "presets"), exist_ok=True)
        name = "".join(c if c.isalnum() or c in "-_" else "_" for c in sc.goe.preset_name) or "preset"
        p = os.path.join(HERE, "presets", name + ".json")
        json.dump({"sex": sc.goe.person, "sliders": {k: round(v, 4) for k, v in slider_values(sc).items() if abs(v) > 1e-4}},
                  open(p, "w"), indent=1)
        self.report({'INFO'}, f"preset saved: {p}")
        return {'FINISHED'}


class GOE_OT_random(bpy.types.Operator):
    bl_idname = "goe.random"
    bl_label = "Random person"
    bl_description = "Draw every slider from the measured spread of real people (person.generate), new seed each click"

    def execute(self, context):
        import person
        sc = context.scene
        sc.goe.seed += 1
        w = person.generate(f"editor-{sc.goe.seed}", sex=sc.goe.person, age=30)
        sc["_goe_loading"] = True
        for name, (pos, neg) in ALL_SLIDERS.items():
            if name == "Stylise":
                continue
            v = w.get(pos, 0.0) - (w.get(neg, 0.0) if neg else 0.0)
            if name == "Brow density":
                v = (w.get("_brow_density", 1.0) - 1.0) / 0.5
            setattr(sc.goe, prop_id(name), float(np.clip(v, -1, 1)))
        sc["_goe_loading"] = False
        apply(sc)
        return {'FINISHED'}


class GOE_OT_reset(bpy.types.Operator):
    bl_idname = "goe.reset"
    bl_label = "Reset"
    bl_description = "All sliders back to the neutral (Stylise 1)"

    def execute(self, context):
        sc = context.scene
        sc["_goe_loading"] = True
        for n in ALL_SLIDERS:
            setattr(sc.goe, prop_id(n), 1.0 if n == "Stylise" else 0.0)
        sc["_goe_loading"] = False
        apply(sc)
        return {'FINISHED'}


class GOE_OT_render(bpy.types.Operator):
    bl_idname = "goe.render_preview"
    bl_label = "Render preview"
    bl_description = "Render front and 3/4 pictures of the active person to previews/editor/"

    def execute(self, context):
        sc = context.scene
        out = os.path.join(CHAR, "previews", "editor")
        os.makedirs(out, exist_ok=True)
        sex = sc.goe.person
        files = []
        for cam_name in ("Cam_Front", "Cam_34"):
            cam = bpy.data.objects.get(f"{cam_name}_{sex}")
            if cam is None:
                continue
            sc.camera = cam
            p = os.path.join(out, f"{SETS[sex].lower()}_{cam_name[4:].lower()}.png")
            sc.render.filepath = p
            bpy.ops.render.render(write_still=True)
            files.append(p)
        self.report({'INFO'}, "rendered: " + ", ".join(files))
        return {'FINISHED'}


class GOE_OT_start_sculpt(bpy.types.Operator):
    bl_idname = "goe.start_sculpt"
    bl_label = "Start sculpt"
    bl_description = "Add an empty 'Sculpt' shape on every part of the active person and make it the one you sculpt on"

    def execute(self, context):
        for o in set_objects(context.scene.goe.person):
            kb = o.data.shape_keys.key_blocks.get("Sculpt") or o.shape_key_add(name="Sculpt", from_mix=False)
            kb.value = 1.0
            o.active_shape_key_index = list(o.data.shape_keys.key_blocks).index(kb)
            o.use_shape_key_edit_mode = True
        self.report({'INFO'}, "sculpt on the 'Sculpt' shape (Sculpt Mode), then press 'Save sculpt as shape'")
        return {'FINISHED'}


def seam_check(objs, name):
    """same positions at rest -> the shape's deltas must match on both sides of every seam."""
    from mathutils.kdtree import KDTree
    data = {}
    for o in objs:
        kb = o.data.shape_keys.key_blocks.get(name)
        P = np.array([v.co[:] for v in o.data.shape_keys.key_blocks[0].data])
        D = (np.array([v.co[:] for v in kb.data]) - P) if kb else np.zeros_like(P)
        data[o.name] = (P, D)
    worst, bad = 0.0, []
    names = list(data)
    for i, a in enumerate(names):
        for b in names[i + 1:]:
            Pb = data[b][0]
            kd = KDTree(len(Pb))
            for j, p in enumerate(Pb):
                kd.insert(p, j)
            kd.balance()
            for ia, p in enumerate(data[a][0]):
                co, jb, d = kd.find(p)
                if d < 1e-6:
                    diff = float(np.abs(data[a][1][ia] - data[b][1][jb]).max())
                    if diff > worst:
                        worst = diff
                    if diff > 1e-5:
                        bad.append((a, ia, b, jb))
    return worst, bad, data


class GOE_OT_save_sculpt(bpy.types.Operator):
    bl_idname = "goe.save_sculpt"
    bl_label = "Save sculpt as shape"
    bl_description = "Store the 'Sculpt' shape under the given name, check (and repair) the seams, export it for the build"

    def execute(self, context):
        sc = context.scene
        objs = set_objects(sc.goe.person)
        if bpy.context.object and bpy.context.object.mode != 'OBJECT':
            bpy.ops.object.mode_set(mode='OBJECT')
        name = "User_" + "".join(c if c.isalnum() else "_" for c in sc.goe.sculpt_name.replace("User_", ""))
        worst, bad, data = seam_check(objs, "Sculpt")
        if bad:
            # repair: both sides get the average delta, so the parts stay welded
            for a, ia, b, jb in bad:
                avg = (data[a][1][ia] + data[b][1][jb]) / 2
                for o_name, idx in ((a, ia), (b, jb)):
                    kb = bpy.data.objects[o_name].data.shape_keys.key_blocks["Sculpt"]
                    kb.data[idx].co = (data[o_name][0][idx] + avg).tolist()
        worst2, bad2, _ = seam_check(objs, "Sculpt")
        os.makedirs(os.path.join(HERE, "sculpts"), exist_ok=True)
        arrs = {}
        for o in objs:
            kb = o.data.shape_keys.key_blocks.get("Sculpt")
            if kb is None:
                continue
            kb.name = name
            kb.value = 1.0
            P = np.array([v.co[:] for v in o.data.shape_keys.key_blocks[0].data])
            D = np.array([v.co[:] for v in kb.data]) - P
            if np.abs(D).max() > 1e-6:
                arrs[o.name.split(".")[0].replace("F_", "").replace("M_", "")] = D.astype(np.float32)
        np.savez_compressed(os.path.join(HERE, "sculpts", name + ".npz"), **arrs)
        msg = (f"saved shape '{name}' on {len(arrs)} parts; seams: {len(bad)} mismatches found" +
               (f", repaired (now {worst2:.1e} m)" if bad else ", all welded") +
               ". Bones and sockets are not moved by sculpting. Rebuild the base to add it to the game file.")
        self.report({'INFO' if not bad2 else 'WARNING'}, msg)
        return {'FINISHED'}


class GOE_OT_mh_human(bpy.types.Operator):
    bl_idname = "goe.mpfb_human"
    bl_label = "Open as MakeHuman human"
    bl_description = "Create an MPFB MakeHuman human with this neutral's macros and targets, for MPFB's full slider panel"

    def execute(self, context):
        sys.path.insert(0, HERE)
        import mhcore as mc
        sex = context.scene.goe.person
        R = json.load(open(os.path.join(HERE, "recipe.json")))
        h = mc.HS().create_human(macro_detail_dict=mc.full_macro(R[sex]["macro"]))
        import stylise_mh as st
        for k, v in st.expand(R[sex]["targets"]).items():
            mc.TS().load_target(h, mc.sys_data("targets", k + ".target.gz"), weight=v, name=k.split("/")[-1])
        h.name = f"MakeHuman_{SETS[sex]}"
        h.location.x = 2.0 if sex == "M" else -2.0
        self.report({'INFO'}, f"{h.name} created: edit it in the MPFB tab, then 'Write MakeHuman targets back'")
        return {'FINISHED'}


class GOE_OT_mh_back(bpy.types.Operator):
    bl_idname = "goe.mpfb_back"
    bl_label = "Write MakeHuman targets back"
    bl_description = "Copy the MPFB human's target weights into recipe.json (backup first)"

    def execute(self, context):
        sex = context.scene.goe.person
        h = bpy.data.objects.get(f"MakeHuman_{SETS[sex]}")
        if h is None or not h.data.shape_keys:
            self.report({'ERROR'}, "press 'Open as MakeHuman human' first")
            return {'CANCELLED'}
        import glob
        path = os.path.join(HERE, "recipe.json")
        os.makedirs(os.path.join(HERE, "backups"), exist_ok=True)
        shutil.copy(path, os.path.join(HERE, "backups", time.strftime("recipe_%Y%m%d_%H%M%S.json")))
        R = json.load(open(path))
        import mhcore as mc
        names = {os.path.basename(p).replace(".target.gz", ""): os.path.relpath(p, mc.sys_data("targets")).replace(".target.gz", "")
                 for p in glob.glob(mc.sys_data("targets", "*", "*.target.gz"))}
        t = {}
        for kb in h.data.shape_keys.key_blocks[1:]:
            if kb.name.startswith("$md") or abs(kb.value) < 1e-4:
                continue
            if kb.name in names:
                t[names[kb.name]] = round(kb.value, 4)
        R[sex]["targets"] = t
        json.dump(R, open(path, "w"), indent=1)
        self.report({'INFO'}, f"{len(t)} MakeHuman targets written to recipe.json; rebuild the base")
        return {'FINISHED'}


class GOE_PT_panel(bpy.types.Panel):
    bl_label = "Garden of Eden"
    bl_idname = "GOE_PT_panel"
    bl_space_type = 'VIEW_3D'
    bl_region_type = 'UI'
    bl_category = "Garden of Eden"

    def draw(self, context):
        g = context.scene.goe
        L = self.layout
        L.prop(g, "person", expand=True)
        for title, names in GROUPS:
            box = L.box()
            box.label(text=title)
            for n in names:
                if n in ALL_SLIDERS:
                    box.prop(g, prop_id(n), slider=True)
        b = L.box()
        b.label(text="Save and tools")
        b.operator("goe.save_neutral", icon='FILE_TICK')
        r = b.row()
        r.prop(g, "preset_name", text="")
        r.operator("goe.save_preset", icon='PRESET')
        b.operator("goe.random", icon='MOD_NOISE')
        b.operator("goe.reset", icon='LOOP_BACK')
        b.operator("goe.render_preview", icon='RENDER_STILL')
        s = L.box()
        s.label(text="Free sculpting (advanced)")
        s.operator("goe.start_sculpt", icon='SCULPTMODE_HLT')
        r = s.row()
        r.prop(g, "sculpt_name", text="")
        r.operator("goe.save_sculpt", icon='SHAPEKEY_DATA')
        m = L.box()
        m.label(text="MakeHuman (MPFB) panel")
        m.operator("goe.mpfb_human", icon='OUTLINER_OB_ARMATURE')
        m.operator("goe.mpfb_back", icon='IMPORT')


CLASSES = (GOEProps, GOE_OT_save_neutral, GOE_OT_save_preset, GOE_OT_random, GOE_OT_reset, GOE_OT_render, GOE_OT_start_sculpt,
           GOE_OT_save_sculpt, GOE_OT_mh_human, GOE_OT_mh_back, GOE_PT_panel)


def register():
    for c in CLASSES:
        try:
            bpy.utils.register_class(c)
        except ValueError:
            bpy.utils.unregister_class(c)
            bpy.utils.register_class(c)
    bpy.types.Scene.goe = bpy.props.PointerProperty(type=GOEProps)


register()


def _setup_view():
    """material preview, side bar open on our tab (GUI only)."""
    try:
        for win in bpy.context.window_manager.windows:
            for area in win.screen.areas:
                if area.type == 'VIEW_3D':
                    for sp in area.spaces:
                        if sp.type == 'VIEW_3D':
                            sp.shading.type = 'MATERIAL'
                            sp.show_region_ui = True
        load_person(None, bpy.context)
    except Exception as e:                      # headless or no window yet
        print("editor view setup skipped:", e)
    return None


if not bpy.app.background:
    bpy.app.timers.register(_setup_view, first_interval=0.5)
