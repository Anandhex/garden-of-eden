"""Category grids and the random people sheet.
    Blender -b parts/parts.blend -P parts/render_parts.py -- only=brows,eyes,mouths,lids,stubble,noses,ears,hair,beards,people
"""
import bpy, os, sys, math, json, random
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import preview as pv, specs, decals
import render_preview as rp

OUT = os.path.join(HERE, "previews")
TMP = os.path.join(OUT, "_tmp")
HAIRC = specs.HAIR_COLOURS


def sheet(st, name, items, cols, fn, az=0.0, cz=None, scale=0.34, pitch=0.0, cx=0.0, res=400, labels=None):
    """items: list of labels; fn(i) configures the stage for item i (and returns az override or None)."""
    os.makedirs(TMP, exist_ok=True)
    st.sc.render.resolution_x = st.sc.render.resolution_y = res
    ps = []
    for i, it in enumerate(items):
        o = fn(i)
        p = os.path.join(TMP, f"{name}_{i:02d}.png")
        st.shot(p, az=az if not isinstance(o, dict) or "az" not in o else o["az"], cz=cz, scale=scale, pitch=pitch, cx=cx)
        ps.append(p)
    out = os.path.join(OUT, name + ".png")
    rp.montage(ps, cols, out)
    json.dump({"file": name + ".png", "cols": cols, "labels": labels or items}, open(os.path.join(OUT, name + ".json"), "w"))
    return out


FACE_GROUPS = [["Face_Long", "Face_Short"], ["Jaw_Wide", "Jaw_Square"], ["Cheeks_Full", "Cheekbones"], ["Forehead_High"], ["Brow_Ridge"],
               ["Eye_Big", "Eye_Round", "Eye_Almond", "Eye_Narrow", "Eye_Hooded", "Eye_Monolid"], ["Eye_TiltUp", "Eye_TiltDown"], ["Eye_Spacing"],
               ["Eye_Deep", "Eye_Protrude"], ["Chin_Pointed", "Chin_Long", "Chin_Small", "Chin_Big", "Chin_Wide", "Chin_Narrow", "Chin_Forward", "Chin_Back", "Chin_Cleft"],
               ["Lips_Full", "Lips_Thin", "Lips_Pout", "Lips_UpperFull", "Lips_LowerFull", "Lips_CupidBow"], ["Mouth_Wide", "Mouth_Narrow"],
               ["Mouth_CornersUp", "Mouth_CornersDown"], ["Nose_Bridge"], ["Ears_Back"]]
SPECIES_KEY = {"elf": "Species_Elf", "dwarf": "Species_Dwarf", "halfling": "Species_Halfling", "orc": "Species_Orc"}
HAIR_BY = {"human": ["black", "dark_brown", "brown", "chestnut", "auburn", "ginger", "blonde", "blue_black"],
           "elf": ["blonde", "platinum", "silver", "black", "copper_red", "brown"], "dwarf": ["ginger", "auburn", "brown", "black", "copper_red", "grey"],
           "halfling": ["brown", "chestnut", "ginger", "blonde", "dark_brown"], "orc": ["black", "green_orc", "dark_brown", "blue_black"]}


def people(st, seed=7, n=24):
    man = json.load(open(os.path.join(HERE, "export", "parts_manifest.json")))
    presets = json.load(open(os.path.join(os.path.dirname(HERE), "export", "species_presets.json")))
    P = man["parts"]
    rng = random.Random(seed)
    plan = []
    species_cycle = ["human"] * 11 + ["elf"] * 4 + ["dwarf"] * 3 + ["orc"] * 3 + ["halfling"] * 3
    rng.shuffle(species_cycle)
    ages = ["adult"] * 15 + ["elder"] * 5 + ["child"] * 4
    rng.shuffle(ages)
    sexes = ["M", "F"] * 12
    rng.shuffle(sexes)

    def weight(p, want):
        return 1.0 + 2.0 * len(set(p["tags"]) & want)

    def pick(cat, sp, sx, ag, want, extra=lambda p: True):
        c = [p for p in P if p["category"] == cat and sp in p["species"] and sx in p["sexes"] and ag in p["ages"] and not p["id"].endswith("_hat") and extra(p)]
        if not c:
            c = [p for p in P if p["category"] == cat and not p["id"].endswith("_hat") and extra(p)]
        return rng.choices(c, weights=[weight(p, want) for p in c])[0]
    out = []
    for i in range(n):
        sp, ag, sx = species_cycle[i], ages[i], sexes[i]
        if sp == "halfling" and ag == "child":
            ag = "adult"
        want = {sp, "feminine" if sx == "F" else "masculine"} | ({"elder"} if ag == "elder" else set()) | ({"child"} if ag == "child" else set())
        want |= set(rng.sample(["common", "noble", "rustic", "rogue", "soldier", "scholar", "wanderer", "merchant", "courtly", "worker", "warrior"], 2))
        shapes = {"Sex": (0.0 if sx == "M" else 1.0) * (0.9 + 0.1 * rng.random()) if sx == "F" else 0.0}
        if sp in SPECIES_KEY:
            shapes[SPECIES_KEY[sp]] = 1.0
        if ag == "elder":
            shapes["Age_Old"] = 0.6 + 0.4 * rng.random()
        if ag == "child":
            shapes["Child"] = 1.0
        for g in FACE_GROUPS:
            if rng.random() < 0.42:
                shapes[rng.choice(g)] = round(0.25 + 0.6 * rng.random(), 2)
        hairc = rng.choice(HAIR_BY[sp])
        if ag == "elder":
            hairc = rng.choice(["grey", "silver", "white", "grey", hairc])
        skins = presets[sp]["skin"]
        a, b = rng.sample(skins, 2)
        t = rng.random()
        skin = tuple(a[k] * (1 - t) + b[k] * t for k in range(3))
        hair = pick("hair", sp, sx, ag, want)
        if sp == "orc" and rng.random() < 0.6:
            hair = pick("hair", sp, sx, ag, want | {"orc"})
        nose = pick("noses", sp, sx, ag, want)
        ear = pick("ears", sp, sx, ag, want)
        eye = pick("eyes", sp, sx, ag, want)
        brow = pick("eyebrows", sp, sx, ag, want)
        mouth = pick("mouths", sp, sx, ag, want)
        beard = None
        if sx == "M" and ag != "child" and rng.random() < (0.95 if sp == "dwarf" else 0.55):
            beard = pick("beards", sp, sx, ag, want)
        out.append(dict(i=i, species=sp, sex=sx, age=ag, shapes=shapes, hair=hair, hairc=hairc, skin=skin, nose=nose, ear=ear, eye=eye, brow=brow, mouth=mouth, beard=beard))
    labels, rec = [], []

    def show(i):
        pe = out[i]
        names = []
        names += pe["hair"]["meshObjects"] + pe["nose"]["meshObjects"] + pe["ear"]["meshObjects"]
        if pe["beard"] and pe["beard"]["meshObjects"]:
            names += pe["beard"]["meshObjects"]
        st.show(names)
        st.set_skin(pe["skin"])
        hc = specs.HAIR_COLOURS[pe["hairc"]]
        st.set_hair_colour(hc)
        eid = int(pe["eye"]["id"].split("_")[1])
        bid = int(pe["brow"]["id"].split("_")[1])
        mid = int(pe["mouth"]["id"].split("_")[1])
        sub = None
        if pe["beard"] and pe["beard"].get("decal"):
            sub = int(pe["beard"]["id"].split("_")[2])
        lip = specs.LIP_TINTS[pe["mouth"]["colourSlots"][0]["default"]]
        if pe["sex"] == "M" and pe["species"] != "orc":
            lip = tuple(c * 0.85 + 0.1 for c in lip)
        st.compose(brow=bid, eye=eid, lid=pe["eye"]["lidStyle"], mouth=mid, stubble=sub, hair_rgb=hc, lip_rgb=lip, blush=0.30 if pe["species"] != "orc" else 0.05)
        st.shapes(**pe["shapes"])
        rec.append(dict(i=pe["i"], species=pe["species"], sex=pe["sex"], age=pe["age"], shapes=pe["shapes"], hair=pe["hair"]["id"], hairColour=pe["hairc"], nose=pe["nose"]["id"],
                        ears=pe["ear"]["id"], eyes=pe["eye"]["id"], brows=pe["brow"]["id"], mouth=pe["mouth"]["id"], beard=(pe["beard"]["id"] if pe["beard"] else None)))
    focus = os.environ.get("PEOPLE_FOCUS")
    if focus:
        k = int(focus) - 1
        pe = out[k]
        show(k)
        eid = int(pe["eye"]["id"].split("_")[1])
        print("FOCUS", pe["eye"]["id"], pe["eye"]["lidStyle"], pe["brow"]["id"], pe["mouth"]["id"], pe["hair"]["id"], pe["beard"] and pe["beard"]["id"])
        variants = [dict(), dict(lid="none"), dict(brow=None), dict(lid="none", brow=None, mouth=None)]
        for vi, v in enumerate(variants):
            kw = dict(brow=int(pe["brow"]["id"].split("_")[1]), eye=eid, lid=pe["eye"]["lidStyle"], mouth=int(pe["mouth"]["id"].split("_")[1]),
                      hair_rgb=specs.HAIR_COLOURS[pe["hairc"]])
            kw.update(v)
            st.compose(**kw)
            st.shot(os.path.join(OUT, f"focus_{vi}.png"), az=math.radians(-22), cx=0.049, cz=1.63, scale=0.2, pitch=0)
        return out
    lab = [f"{i+1:02d} {o['species']} {o['sex']} {o['age']}" for i, o in enumerate(out)]
    sheet(st, "random_people_24", lab, 6, show, az=math.radians(-22), cx=0.0, cz=None, scale=0.52, res=380, labels=lab)
    json.dump(rec, open(os.path.join(OUT, "random_people_24_parts.json"), "w"), indent=1)


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    only = None
    for a in argv:
        if a.startswith("only="):
            only = a[5:].split(",")
    want = lambda k: not only or k in only
    st = pv.Stage()
    st.show([])
    base_hair = HAIRC["brown"]
    st.set_hair_colour(base_hair)
    st.shapes()
    if want("brows"):
        def f(i):
            st.compose(brow=i + 1, eye=1, lid="thin_liner", mouth=1, hair_rgb=HAIRC["chestnut"])
        sheet(st, "brows_grid", [b["name"] for b in specs.BROWS], 6, f, cz=1.645, scale=0.17,
              labels=[f"{i+1:02d} {b['name']}" for i, b in enumerate(specs.BROWS)])
    if want("eyes"):
        keys = list(specs.LIDS)

        def f(i):
            e = specs.EYES[i]
            st.compose(brow=1, eye=i + 1, lid=e["lid"], mouth=1, hair_rgb=HAIRC["dark_brown"])
        sheet(st, "eyes_grid", [e["name"] for e in specs.EYES], 6, f, cz=1.634, scale=0.15,
              labels=[f"{i+1:02d} {e['name']}" for i, e in enumerate(specs.EYES)])
    if want("lids"):
        keys = list(specs.LIDS)

        def f(i):
            st.compose(brow=1, eye=3, lid=keys[i], hair_rgb=HAIRC["dark_brown"])
        sheet(st, "lids_grid", keys, 7, f, cz=1.634, scale=0.15, labels=keys)
    if want("mouths"):
        def f(i):
            m = specs.MOUTHS[i]
            st.compose(brow=1, eye=1, lid="thin_liner", mouth=i + 1, lip_rgb=specs.LIP_TINTS[m["tint"]], hair_rgb=HAIRC["brown"])
        sheet(st, "mouths_grid", [m["name"] for m in specs.MOUTHS], 6, f, cz=1.555, scale=0.115,
              labels=[f"{i+1:02d} {m['name']}" for i, m in enumerate(specs.MOUTHS)])
    if want("stubble"):
        def f(i):
            st.compose(brow=1, eye=1, lid="thin_liner", mouth=1, stubble=i + 1, hair_rgb=HAIRC["black"])
        sheet(st, "stubble_grid", [s["name"] for s in specs.STUBBLE], 3, f, cz=1.58, scale=0.24, res=420)
    if want("noses") or want("ears"):
        import build_nose_ear as bne
        st.compose(brow=1, eye=1, lid="thin_liner", mouth=1, hair_rgb=HAIRC["brown"])
    if want("noses"):
        nm = [f"Nose_{i+1:02d}_{n[0]}" for i, n in enumerate(bne.NOSES)]
        lab = [f"{i+1:02d} {n[0]}" for i, n in enumerate(bne.NOSES)]
        sheet(st, "noses_grid_q34", nm, 6, lambda i: st.show([nm[i]]), az=math.radians(-40), cx=-0.14 * math.sin(math.radians(-40)), cz=1.595, scale=0.15, labels=lab)
        sheet(st, "noses_grid_front", nm, 6, lambda i: st.show([nm[i]]), az=0.0, cz=1.595, scale=0.15, labels=lab)
        sheet(st, "noses_grid_side", nm, 6, lambda i: st.show([nm[i]]), az=math.radians(-90), cx=0.14, cz=1.595, scale=0.15, labels=lab)
    if want("ears"):
        nm = [[f"Ear_{i+1:02d}_{n[0]}_L", f"Ear_{i+1:02d}_{n[0]}_R"] for i, n in enumerate(bne.EARS)]
        lab = [f"{i+1:02d} {n[0]}" for i, n in enumerate(bne.EARS)]
        sheet(st, "ears_grid_side", nm, 6, lambda i: st.show(nm[i]), az=math.radians(75), cx=0.005, cz=1.62, scale=0.17, labels=lab)
        sheet(st, "ears_grid_back", nm, 6, lambda i: st.show(nm[i]), az=math.radians(180), cz=1.62, scale=0.30, labels=lab)
    if want("hair"):
        import build_hair as bh
        st.compose(brow=1, eye=1, lid="thin_liner", mouth=1, hair_rgb=HAIRC["chestnut"])
        st.set_hair_colour(HAIRC["chestnut"])
        names = [f"Hair_{i+1:02d}_{s[0]}" for i, s in enumerate(bh.STYLES)]
        lab = [f"{i+1:02d} {s[0]}" for i, s in enumerate(bh.STYLES)]
        sheet(st, "hair_grid_q34", names, 6, lambda i: st.show([names[i]]), az=math.radians(-35), cz=1.52, scale=0.56, res=380, labels=lab)
        sheet(st, "hair_grid_back", names, 6, lambda i: st.show([names[i]]), az=math.radians(180), cz=1.52, scale=0.56, res=380, labels=lab)
        sheet(st, "hair_grid_front", names, 6, lambda i: st.show([names[i]]), az=0.0, cz=1.52, scale=0.56, res=380, labels=lab)
    if want("beards"):
        import build_beards as bb
        st.compose(brow=1, eye=1, lid="thin_liner", mouth=1, hair_rgb=HAIRC["brown"])
        st.set_hair_colour(HAIRC["brown"])
        names = [f"Beard_{i+1:02d}_{s[0]}" for i, s in enumerate(bb.BEARDS)]
        lab = [f"{i+1:02d} {s[0]}" for i, s in enumerate(bb.BEARDS)]
        sheet(st, "beards_grid_q34", names, 6, lambda i: st.show([names[i]]), az=math.radians(-30), cz=1.50, scale=0.40, res=380, labels=lab)
        sheet(st, "beards_grid_front", names, 6, lambda i: st.show([names[i]]), az=0.0, cz=1.50, scale=0.40, res=380, labels=lab)
    if want("mouthparts"):
        import build_mouth as bm
        arm = bpy.data.objects["Armature"]
        jb = arm.pose.bones["Jaw"]
        jb.rotation_mode = 'XYZ'
        names, lab = [], []
        for ang in (0, 22):
            for i, (s_, _) in enumerate(bm.STYLES):
                names.append((f"Teeth_{i+1:02d}_{s_}", ang))
                lab.append(f"{s_} jaw {ang} deg")

        def f(i):
            nm, ang = names[i]
            st.show(["MouthIn_01", "Tongue_01", nm])
            bpy.data.objects["Mesh_Head"].hide_render = True
            jb.rotation_euler = (math.radians(ang), 0, 0)
            bpy.context.view_layer.update()
        sheet(st, "mouth_parts_cutaway", names, 6, f, az=math.radians(-25), cx=0.0486, cz=1.553, scale=0.07, res=380, labels=lab)
        jb.rotation_euler = (0, 0, 0)
    if want("people"):
        people(st, seed=int(os.environ.get("PEOPLE_SEED", "7")))
    st.shapes()
    st.compose(brow=1, eye=1, lid="thin_liner", mouth=1)


if __name__ == "__main__":
    main()
