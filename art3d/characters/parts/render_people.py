"""EEVEE preview sheets of whole people built from the parts (2026-11 face rework), same staging as ../lookdev.py.

    Blender -b art3d/characters/parts/parts.blend -P art3d/characters/parts/render_people.py -- only=people,species,expressions,eyes,hair,brows,beards [seed=7]

Sheets go to previews/: random_people_24.png (+ .json with every pick), species_faces_turnaround.png, expressions_visemes.png,
eye_closeup.png, hair_sheet_<n>.png, brows_sheet.png, beards_sheet.png.
"""
import bpy, os, sys, json, math, subprocess
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__))
CHAR = os.path.dirname(HERE)
sys.path.insert(0, CHAR)
sys.path.insert(0, HERE)
import lookdev as ld   # noqa: E402
import specs           # noqa: E402

PREV = os.path.join(HERE, "previews")
MAN = json.load(open(os.path.join(HERE, "export", "parts_manifest.json")))
PRESETS = json.load(open(os.path.join(CHAR, "export", "species_presets.json")))
TMP = os.path.join(PREV, "_tmp")

FACE_KEYS = ["Face_Long", "Face_Short", "Jaw_Wide", "Jaw_Square", "Cheeks_Full", "Cheekbones", "Eye_Big", "Eye_Round", "Eye_Almond",
             "Eye_Narrow", "Eye_Hooded", "Eye_TiltUp", "Eye_TiltDown", "Chin_Small", "Chin_Big", "Chin_Pointed", "Chin_Forward",
             "Lips_Full", "Lips_Thin", "Lips_UpperFull", "Lips_LowerFull", "Mouth_Wide", "Mouth_Narrow", "Nose_Bridge", "Brow_Ridge"]
TONES = {"human": ["T1_pale", "T2_fair", "T3_medium", "T4_olive", "T5_brown", "T6_deep"], "elf": ["T1_pale", "T2_fair", "T3_medium"],
         "dwarf": ["T2_fair", "T3_medium", "T4_olive"], "halfling": ["T2_fair", "T3_medium", "T4_olive", "T5_brown"], "orc": ["orc_green"]}
BASE = ["Mesh_Head", "Mesh_Torso", "Mesh_Arms", "Mesh_Hands", "Mesh_Legs", "Mesh_Feet", "Part_Eye_L", "Part_Eye_R", "Part_Cornea_L", "Part_Cornea_R"]


def parts_of(cat):
    return [p for p in MAN["parts"] if p["category"] == cat]


def ok(p, sp, sex, age):
    return sp in p.get("species", [sp]) and sex in p.get("sexes", [sex]) and age in p.get("ages", [age])


def person(seed, sp=None, sex=None, age=None, neutral=False):
    rng = np.random.default_rng(seed)
    sp = sp or rng.choice(["human"] * 5 + ["elf", "dwarf", "halfling", "orc"])
    sex = sex or rng.choice(["M", "F"])
    age = age or rng.choice(["adult"] * 6 + ["elder"] * 2 + ["child"])
    w = {}
    pre = PRESETS[sp]["shapes"]
    w.update(pre)
    w["Sex"] = 1.0 if sex == "F" else 0.0
    if age == "elder":
        w["Age_Old"] = 0.8
    if age == "child":
        w["Child"] = 0.9
    if not neutral:
        for k in rng.choice(FACE_KEYS, size=4, replace=False):
            w[k] = w.get(k, 0) + float(rng.uniform(0.15, 0.55))
        for k in rng.choice(["Heavy", "Thin", "Muscle", "Neck_Long"], size=1):
            w[k] = w.get(k, 0) + float(rng.uniform(0.1, 0.4))
    tone = str(rng.choice(TONES[sp]))
    hair_pal = list(specs.HAIR_COLOURS)
    if sp == "orc":
        hc = str(rng.choice(["black", "green_orc", "dark_brown"]))
    elif age == "elder":
        hc = str(rng.choice(["grey", "silver", "white", "platinum"]))
    else:
        hc = str(rng.choice(["black", "dark_brown", "brown", "chestnut", "auburn", "ginger", "blonde", "copper_red", "blue_black"]))
    pick = lambda cat: (lambda c: c[rng.integers(len(c))] if c else None)([p for p in parts_of(cat) if ok(p, sp, sex, age)])
    out = dict(seed=int(seed), species=sp, sex=sex, age=age, tone=tone, hairColour=hc, shapes=w,
               eyes=pick("eyes"), brows=pick("eyebrows"), mouth=pick("mouths"),
               hair=pick("hair") if rng.random() > (0.12 if sex == "M" else 0.0) else None)
    if out["hair"] and out["hair"]["name"].endswith("_hat"):
        out["hair"] = pick("hair")
    out["beard"] = None
    if sex == "M" and age != "child" and sp != "elf" and rng.random() < (0.85 if sp == "dwarf" else 0.45):
        out["beard"] = [p for p in parts_of("beards") if ok(p, sp, sex, age) and not p.get("decal")]
        out["beard"] = out["beard"][rng.integers(len(out["beard"]))] if out["beard"] else None
    if neutral:
        out["mouth"] = None
    return out


def apply(P, expr=None, jaw=0.0, look=(0, 0)):
    arm = bpy.data.objects["Armature"]
    sp = P["species"]
    nose = {"elf": "Part_Nose_Elf", "dwarf": "Part_Nose_Dwarf", "orc": "Part_Nose_Orc"}.get(sp, "Part_Nose")
    ears = ["Part_Ear_Elf_A_L", "Part_Ear_Elf_A_R"] if sp == "elf" else ["Part_Ear_L", "Part_Ear_R"]
    eye = P["eyes"]
    lash = eye.get("lashMesh", "Part_Lashes") if eye else "Part_Lashes"
    names = BASE + [nose] + ears + [lash]
    if sp == "orc":
        names += ["Part_Tusk_A_L", "Part_Tusk_A_R"]
    hair_objs = []
    if P["hair"]:
        hair_objs += P["hair"]["meshObjects"]
    if P["beard"]:
        hair_objs += P["beard"]["meshObjects"]
    brow = P["brows"]["meshObjects"][0] if P["brows"] else None
    teeth = None
    if P.get("mouth") and P["mouth"].get("teethMesh"):
        teeth = P["mouth"]["teethMesh"]
    teeth = teeth or "Teeth_01_even"
    ld.show_only(names + hair_objs + ([brow] if brow else []) + [teeth, "Tongue_01"])
    w = dict(P["shapes"])
    if P.get("mouth"):
        for k, v in P["mouth"]["preset"]["shapes"].items():
            w[k] = w.get(k, 0) + v
        for k, v in P["mouth"]["preset"]["expression"].items():
            w[k] = w.get(k, 0) + v
        jaw = max(jaw, P["mouth"]["preset"]["jawOpenDeg"])
    if expr:
        for k, v in expr.items():
            w[k] = w.get(k, 0) + v
    ld.set_keys(w)
    eye_tex = os.path.join(HERE, eye["textures"]["eyeball"]) if eye else None
    lash_tex = os.path.normpath(os.path.join(HERE, eye["textures"]["lashes"])) if eye else None
    M = ld.assign(P["tone"], eye_tex=eye_tex, lash_tex=lash_tex)
    ld.assign_hair([bpy.data.objects[n] for n in hair_objs], specs.HAIR_COLOURS[P["hairColour"]], tag="p")
    if brow:
        ld.assign_brow(bpy.data.objects[brow], specs.HAIR_COLOURS[P["hairColour"]], tag="p")
    if P.get("mouth"):
        tint = specs.LIP_TINTS[P["mouth"]["colourSlots"][0]["default"]]
        lip_tint(M["head"], tint)
    teeth_m = ld.flat_material("LD_Teeth", (0.93, 0.90, 0.82), 0.35, 0.1)
    tongue_m = ld.flat_material("LD_Tongue", (0.78, 0.36, 0.38), 0.4, 0.3)
    for o in bpy.data.objects:
        if o.name.startswith("Teeth_"):
            o.material_slots[0].material = teeth_m
        if o.name.startswith("Tongue_"):
            o.material_slots[0].material = tongue_m
        if o.name.startswith("Part_Tusk"):
            o.material_slots[0].material = teeth_m
    ld.clear_pose(arm)
    arm.data.pose_position = 'POSE'
    ld.pose_bone(arm, "Jaw", (jaw, 0, 0))
    for b in ("LeftEye", "RightEye"):
        ld.pose_bone(arm, b, (look[1], 0, look[0]))
    rs = PRESETS[sp]["rootScaleF" if P["sex"] == "F" else "rootScaleM"]
    arm.scale = (rs, rs, rs)
    bpy.context.view_layer.update()


def lip_tint(mat, tint, amt=0.75):
    """lipTint through the head lip mask (preview of the Unity rule: lerp(albedo, luma x tint, mask x 0.8))."""
    nt = mat.node_tree
    bs = nt.nodes["Principled BSDF"]
    src = bs.inputs["Base Color"].links[0].from_socket
    mask = ld._tex(nt, os.path.join(ld.SKIN, "head_lipmask.png"), False)
    mix = nt.nodes.new("ShaderNodeMix")
    mix.data_type = 'RGBA'
    mix.blend_type = 'MULTIPLY'
    mul = nt.nodes.new("ShaderNodeMath")
    mul.operation = 'MULTIPLY'
    mul.inputs[1].default_value = amt * 0.8
    nt.links.new(mask.outputs["Color"], mul.inputs[0])
    nt.links.new(mul.outputs[0], mix.inputs["Factor"])
    nt.links.new(src, mix.inputs[6])
    mix.inputs[7].default_value = (*ld.srgb(np.clip(np.array(tint) * 1.25, 0, 1)), 1)
    nt.links.new(mix.outputs[2], bs.inputs["Base Color"])


def montage(paths, cols, out, labels=None, cell=None):
    args = ["python3", "-I", os.path.join(HERE, "montage_img.py"), out, str(cols), json.dumps(labels or []), *paths]
    subprocess.run(args, check=True)


def face_shot(cam, az=28.0, dist=0.72, elev=3.0, zoff=-0.035, lens=85):
    t = ld.head_target(0.0)
    ld.aim(cam, (0, t.y + 0.02, t.z + zoff), az, dist, elev_deg=elev, lens=lens)


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    only, seed = None, 7
    for a in argv:
        if a.startswith("only="):
            only = a[5:].split(",")
        if a.startswith("seed="):
            seed = int(a[5:])
    want = lambda k: not only or k in only
    os.makedirs(TMP, exist_ok=True)
    sc, cam = ld.setup(res=(520, 560), centre=(0, 0, 1.55), figure_scale=0.55)
    sc.eevee.taa_render_samples = 48
    if want("people"):
        rows, paths, labels = [], [], []
        for i in range(24):
            P = person(seed * 1000 + i)
            apply(P)
            face_shot(cam, az=28 if i % 2 == 0 else -28, dist=0.80)
            p = os.path.join(TMP, f"people_{i:02d}.png")
            ld.render(p)
            paths.append(p)
            labels.append(f"{i+1:02d} {P['species']} {P['sex']} {P['age']} {P['tone'][:2]}")
            rows.append({k: (v["id"] if isinstance(v, dict) and "id" in v else v) for k, v in P.items()})
        montage(paths, 6, os.path.join(PREV, "random_people_24.png"), labels)
        json.dump(rows, open(os.path.join(PREV, "random_people_24.json"), "w"), indent=1)
    if want("species"):
        paths, labels = [], []
        for sp, sex in (("human", "M"), ("human", "F"), ("elf", "F"), ("dwarf", "M"), ("halfling", "F"), ("orc", "M")):
            P = person(11, sp=sp, sex=sex, age="adult", neutral=True)
            P["hair"] = None
            P["beard"] = None
            P["tone"] = {"human": "T2_fair" if sex == "M" else "T3_medium", "elf": "T1_pale", "dwarf": "T2_fair", "halfling": "T3_medium", "orc": "orc_green"}[sp]
            P["brows"] = [b for b in parts_of("eyebrows") if b["name"] == ("soft_arch" if sex == "F" else "thick_natural")][0]
            P["eyes"] = parts_of("eyes")[0 if sp != "elf" else 7]
            apply(P)
            for az in (0, 35, 90):
                face_shot(cam, az=az, dist=0.70)
                p = os.path.join(TMP, f"species_{sp}_{sex}_{az}.png")
                ld.render(p)
                paths.append(p)
                labels.append(f"{sp} {sex} {az}deg")
        montage(paths, 6, os.path.join(PREV, "species_faces_turnaround.png"), labels)
    if want("expressions"):
        paths, labels = [], []
        P = person(5, sp="human", sex="F", age="adult", neutral=True)
        P["hair"] = [h for h in parts_of("hair") if h["name"] == "bob"][0] if [h for h in parts_of("hair") if h["name"] == "bob"] else parts_of("hair")[0]
        P["tone"] = "T3_medium"
        P["brows"] = parts_of("eyebrows")[0]
        P["eyes"] = parts_of("eyes")[8]
        P["hairColour"] = "copper_red"
        EX = [("neutral", {}, 0), ("Jaw_Open (bone 12)", {}, 12), ("Mouth_Smile", {"Mouth_Smile": 1, "Eye_Squint": 0.35}, 0),
              ("smile + jaw", {"Mouth_Smile": 1, "Mouth_E": 0.4, "Eye_Squint": 0.4}, 7), ("Mouth_Frown", {"Mouth_Frown": 1, "Brow_Sad": 0.5}, 0),
              ("Mouth_O", {"Mouth_O": 1}, 7), ("Mouth_E", {"Mouth_E": 1}, 4), ("Mouth_MBP", {"Mouth_MBP": 1}, 0),
              ("Brow_Up", {"Brow_Up": 1}, 0), ("Brow_Down (anger)", {"Brow_Down": 1, "Mouth_Frown": 0.4, "Eye_Squint": 0.3}, 0),
              ("Brow_Sad", {"Brow_Sad": 1, "Mouth_Frown": 0.3}, 0), ("Eye_Blink_L/R", {"Eye_Blink_L": 1, "Eye_Blink_R": 1}, 0),
              ("Eye_Blink_L (wink)", {"Eye_Blink_L": 1, "Mouth_Smile": 0.5}, 0), ("Eye_Squint", {"Eye_Squint": 1}, 0),
              ("Cheek_Puff", {"Cheek_Puff": 1, "Mouth_MBP": 0.6}, 0), ("surprise", {"Brow_Up": 1, "Mouth_O": 0.5}, 14)]
        for name, ex, jaw in EX:
            apply(P, expr=ex, jaw=jaw)
            face_shot(cam, az=18, dist=0.62)
            p = os.path.join(TMP, f"expr_{len(paths):02d}.png")
            ld.render(p)
            paths.append(p)
            labels.append(name)
        montage(paths, 8, os.path.join(PREV, "expressions_visemes.png"), labels)
    if want("eyes"):
        paths, labels = [], []
        for i, idx in enumerate((0, 4, 7, 10, 13, 15)):
            P = person(3, sp="human" if idx not in (7, 13) else ("elf" if idx == 7 else "orc"), sex="F" if i % 2 else "M", age="adult", neutral=True)
            P["eyes"] = parts_of("eyes")[idx]
            P["hair"] = None
            P["beard"] = None
            apply(P, look=(8 if i % 2 else -6, 4))
            t = ld.head_target(0.0)
            ld.aim(cam, (0.028 if True else 0, t.y - 0.01, t.z + 0.003), 12, 0.24, elev_deg=3, lens=85)
            p = os.path.join(TMP, f"eye_{i}.png")
            ld.render(p)
            paths.append(p)
            labels.append(P["eyes"]["name"])
        montage(paths, 3, os.path.join(PREV, "eye_closeup.png"), labels)
    if want("hair"):
        hairs = [h for h in parts_of("hair") if not h["name"].endswith("_hat")]
        cols = ["dark_brown", "blonde", "copper_red", "black", "chestnut", "auburn", "platinum", "brown"]
        paths, labels = [], []
        for i, h in enumerate(hairs):
            P = person(21 + i, sp="human", sex="F" if "feminine" in h["tags"] else ("M" if "masculine" in h["tags"] else ("F" if i % 2 else "M")),
                       age="adult", neutral=True)
            P["hair"] = h
            P["beard"] = None
            P["hairColour"] = cols[i % len(cols)]
            apply(P)
            face_shot(cam, az=35 if i % 2 == 0 else -35, dist=0.95, zoff=0.0)
            p = os.path.join(TMP, f"hair_{i:02d}.png")
            ld.render(p)
            paths.append(p)
            labels.append(f"{i+1:02d} {h['name']}")
        montage(paths, 6, os.path.join(PREV, "hair_sheet.png"), labels)
    if want("brows") or want("beards"):
        for cat in [c for c in ("brows", "beards") if want(c)]:
            items = parts_of("eyebrows") if cat == "brows" else [b for b in parts_of("beards") if not b.get("decal")]
            paths, labels = [], []
            for i, it in enumerate(items):
                P = person(31 + i, sp="human", sex="M" if cat == "beards" else ("F" if i % 2 else "M"), age="adult", neutral=True)
                P["hair"] = None
                if cat == "brows":
                    P["brows"] = it
                    P["beard"] = None
                else:
                    P["beard"] = it
                P["hairColour"] = ["dark_brown", "brown", "auburn", "black", "blonde", "grey"][i % 6]
                apply(P)
                if cat == "brows":
                    t = ld.head_target(0.0)
                    ld.aim(cam, (0, t.y, t.z + 0.012), 15, 0.40, elev_deg=4, lens=85)
                else:
                    face_shot(cam, az=30, dist=0.85, zoff=-0.07)
                p = os.path.join(TMP, f"{cat}_{i:02d}.png")
                ld.render(p)
                paths.append(p)
                labels.append(f"{i+1:02d} {it['name']}")
            montage(paths, 6, os.path.join(PREV, f"{cat}_sheet.png"), labels)


if __name__ == "__main__":
    main()
