"""Checkpoint sheets for the MakeHuman base (user gate before parts / clothes / FBX):

    source art3d/characters/mh/mpfb_env.sh
    $B -b -P art3d/characters/mh/build_mh.py              # writes mh/cache/keys.npz
    $B -b -P art3d/characters/mh/sheets_mh.py -- round=<N of the compare round to show as the neutral sheet>

* previews/compare/mh/checkpoint_neutral.png: reference crop, best F and M neutral faces (front, 3/4 like the reference,
  side) and full bodies (front, side), from compare round N.
* previews/compare/mh/checkpoint_variety_bodies.png / _faces.png: 12 people from the blend shapes (species, ages, body
  types, face mixes), MakeHuman hair proxies, true relative heights (species root scale).
People are assembled with person.py from the blend-shape mix (keys.npz = the same keys that are baked into base_mh.blend).
"""
import bpy, os, sys, json, subprocess
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
CHAR = os.path.dirname(HERE)
sys.path.insert(0, HERE)
sys.path.insert(0, CHAR)
import mhcore as mc, landmarks as lmk, stylise_mh as st, person, paint, decals, compare_mh as cm  # noqa: E402
import lookdev as ld  # noqa: E402

OUT = os.path.join(CHAR, "previews", "compare", "mh")
TMP = os.path.join(OUT, "_sheet_tmp")

# (label, shape weights, species id or None, tone, hair, hair colour, eye texture)
PEOPLE = [
    ("human, young woman", {"Sex": 1, "Cheeks_Full": 0.3, "Eye_Almond": 0.4}, None, "T2_fair", "bob02", (0.17, 0.09, 0.05), "eye_green_mh.png"),
    ("human, young man", {"Jaw_Square": 0.5, "Muscle": 0.3}, None, "T3_warm", "short02", (0.05, 0.04, 0.035), "eye_brown_mh.png"),
    ("human, woman about 60, heavier", {"Sex": 1, "Age_Old": 0.75, "Heavy": 0.35, "Belly": 0.3}, None, "T4_tan", "bob01", (0.30, 0.28, 0.27), "eye_brownlight_mh.png"),
    ("human, old man, thin", {"Age_Old": 1.0, "Thin": 0.4, "Brow_Ridge": 0.3, "Nose_Bridge": 0.4}, None, "T2_fair", "short04", (0.42, 0.41, 0.40), "eye_grey_mh.png"),
    ("human, heavy woman", {"Sex": 1, "Heavy": 0.8, "Cheeks_Full": 0.5, "Lips_Full": 0.3}, None, "T5_brown", "afro01", (0.04, 0.03, 0.03), "eye_brown_mh.png"),
    ("human, muscular man", {"Muscle": 1.0, "Shoulders": 0.5, "Chin_Big": 0.4, "Eye_Hooded": 0.4}, None, "T6_deep", "short01", (0.03, 0.025, 0.02), "eye_brown_mh.png"),
    ("elf woman", {"Sex": 1, "Species_Elf": 1.0}, "elf", "T1_light", "long01", (0.55, 0.42, 0.24), "eye_lightblue_mh.png"),
    ("elf man", {"Species_Elf": 1.0, "Eye_TiltUp": 0.3}, "elf", "T2_fair", "ponytail01", (0.12, 0.08, 0.05), "eye_bluegreen_mh.png"),
    ("dwarf man", {"Species_Dwarf": 1.0}, "dwarf", "T3_warm", "short03", (0.30, 0.12, 0.05), "eye_blue_mh.png"),
    ("halfling woman", {"Sex": 1, "Species_Halfling": 1.0}, "halfling", "T3_warm", "braid01", (0.20, 0.11, 0.06), "eye_brownlight_mh.png"),
    ("orc man", {"Species_Orc": 1.0}, "orc", (0.52, 0.62, 0.40), "short02", (0.03, 0.03, 0.03), "eye_brown_mh.png"),
    ("human, tall thin woman", {"Sex": 1, "Thin": 0.6, "Height_Legs": 0.5, "Eye_Round": 0.4, "Mouth_Wide": 0.4}, None, "T6_deep", "short04", (0.05, 0.04, 0.035), "eye_brown_mh.png"),
]


def tone_lip_gloss(tone_rgb, sex, scale=1.0):
    """lip colour multiplier and gloss from the skin tone: rosier on light skin, deeper rose-brown on dark skin; less clear
    coat / specular on darker skin (no plastic look)."""
    lum = float(np.dot(tone_rgb, (0.3, 0.59, 0.11)))
    k = float(np.clip((lum - 0.25) / 0.55, 0, 1))             # 0 = deep, 1 = light
    lip_l = np.array((0.80, 0.52, 0.56) if sex == "F" else (0.86, 0.66, 0.66))
    lip_d = np.array((0.78, 0.58, 0.60) if sex == "F" else (0.84, 0.68, 0.68))
    lip = lip_d + (lip_l - lip_d) * k
    gloss = scale * (0.45 + 0.55 * k)
    return tuple(lip.tolist()), gloss


def assemble(B, lm, R, P, sex, hair, tone, hcol, eye, name="MHP", brow=None, brow_tex=None, brow_gain=None, gloss_scale=None,
             p_open=None, beard=None, greying=0.0):
    """one dressed preview person (decal liner, tint, lash ribbon, snapped brows, MakeHuman hair proxy) from coordinates."""
    import face_cards, look_mh
    look = R["look"][sex]
    prox = {k: (v[sex] if isinstance(v, dict) else v) for k, v in R["proxies"].items()}
    import hair_lib
    hair_prm, base = {}, hair
    if hair in hair_lib.HAIR:                       # a style name (base MakeHuman proxy + deformation, or shells)
        base, _sx, hair_prm = hair_lib.HAIR[hair]
    prox["hair"] = base if base not in ("cap", "curls") else None
    if brow_tex:                                    # brow textures are painted on the eyebrow001 card layout
        if brow_tex.startswith("eyebrow"):
            prox["eyebrows"], brow_tex = brow_tex, None
        else:
            prox["eyebrows"] = "eyebrow001"
    eyes_px = mc.Proxy(mc.proxy_file("eyes", prox["eyes"]))
    dec = decals.apply_image(P, B, lm, eyes_px, look.get("decal"), name=f"Decal_{name}")
    if isinstance(tone, (tuple, list)):
        look_mh.TONE["custom"] = tuple(tone)
        tone = "custom"
    paint_kw = dict(look.get("paint", {}))
    gloss = 1.0
    if gloss_scale is not None:
        lipc, gloss = tone_lip_gloss(look_mh.TONE[tone], sex, gloss_scale)
        paint_kw["lip"] = lipc
    pp = dict(look["person"])
    if eye:
        pp["eye_tex"] = eye
    if hcol is not None:
        pp.update(hair_col=hcol, brow_col=tuple(min(1.0, c * 0.8) for c in hcol))
    if brow_gain is not None:
        pp["brow_gain"] = brow_gain
    person.clear_people()
    rb = face_cards.LashRibbon(B, lm, P, eyes_px, **look.get("ribbon", {})) if prox.get("eyelashes") == "ribbon" else None
    lp = (face_cards.LashProxy(mc.Proxy(mc.proxy_file("eyelashes", prox["eyelashes"])), B, lm, P, **look["lash_proxy"])
          if look.get("lash_proxy") and prox.get("eyelashes") not in (None, "ribbon") else None)
    if lp is None and look.get("blink_lashes") and prox.get("eyelashes") not in (None, "ribbon"):
        lp = face_cards.BlinkLashProxy(mc.Proxy(mc.proxy_file("eyelashes", prox["eyelashes"])), B, lm, P if p_open is None else p_open)
    sf = [f for f, q in zip(lm.faces, lm.fpart) if q == "head"] if look.get("snap_brows") else None
    person.build._lm = lm
    td = face_cards.TearDuct(B, lm, P) if (sex == "F" and look.get("tear_duct", True)) else None
    tint_ = paint.tint(P, lm, B, **paint_kw)
    bcol = hcol if hcol is not None else (0.1, 0.06, 0.04)
    if beard and beard != "none":
        tint_ = hair_lib.stubble_tint(tint_, P, B, lm, beard, bcol)
    tint_ = hair_lib.scalp_tint(tint_, P, B, lm, base, hair_prm, hcol if hcol is not None else bcol)
    objs = person.build(P, prox, name=name, tint=tint_, decal=dec, tone=tone, ribbon=rb, gloss=gloss, tear_duct=td, lash_proxy=lp, teeth_offset=look.get("teeth_offset"),
                        snap_faces=sf, brow_params=dict(look.get("brow_params", {}), **(brow or {})), brow_tex=brow_tex, **pp)
    decals.set_uv(objs["body"], P, B, lm, dec[1])
    if "hair" in objs and hair_prm:
        hair_lib.deform_hair(objs["hair"], P, B, lm, hair_prm)
    if base in ("cap", "curls"):
        objs["hair"] = hair_lib.hair_object(P, B, lm, base, hair_prm, objs.get("rig"), hcol if hcol is not None else bcol,
                                            grey=greying * 0.6, name=f"{name}_hair")
    if beard and beard != "none":
        bo = hair_lib.beard_object(P, B, lm, beard, objs.get("rig"), bcol, name=f"{name}_beard")
        if bo is not None:
            objs["beard"] = bo
    return objs


def img(*a):
    subprocess.run(["python3", "-I", os.path.join(HERE, "sheet_img.py"), *map(str, a)], check=True)


def main():
    a = dict(x.split("=", 1) for x in (sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []))
    rnd = a.get("round")
    os.makedirs(TMP, exist_ok=True)
    R = st.load_recipe()
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    B = mc.Base()
    P0 = B.macro({})
    lm = lmk.Landmarks(B, P0 - [0, 0, P0[B.body_mask, 2].min()])
    B.h.hide_render = B.h.hide_viewport = True
    Z = np.load(os.path.join(mc.CACHE, "keys.npz"))
    basis = Z["_basis"].astype(float)
    species = json.load(open(os.path.join(HERE, "export", "species_presets.json")))
    sc, cam = ld.setup(res=(560, 1150), centre=(0, 0, 1.0))
    eyes_px = mc.Proxy(mc.proxy_file("eyes", R["proxies"]["eyes"]))
    bodies, faces, labels = [], [], []
    for i, (label, w, sp, tone, hair, hcol, eye) in enumerate(PEOPLE):
        sex = "F" if w.get("Sex", 0) > 0.5 else "M"
        w = dict(w)
        w.setdefault(f"Stylise_{sex}", 1.0)
        P = person.mix(Z, w)
        if sp:
            P = P * species[sp]["rootScaleF" if sex == "F" else "rootScaleM"]
        objs = assemble(B, lm, R, P, sex, hair, tone, hcol, eye, name=f"MHP_{i}")
        arm = objs["rig"]
        cm.clear_pose(arm)
        cm.arms_down(arm, 36, bend=0)
        H = float(P[lm.body, 2].max())
        # full body, 3/4, fixed ortho scale (true relative heights)
        sc.render.resolution_x, sc.render.resolution_y = 560, 1150
        cam.data.type = 'ORTHO'
        cam.data.ortho_scale = 2.25
        ld.aim(cam, (0, 0, 1.06), 20, 6.0, elev_deg=0)
        p = os.path.join(TMP, f"body_{i:02d}.png")
        ld.render(p)
        bodies.append(p)
        # face, 3/4 close-up
        sc.render.resolution_x = sc.render.resolution_y = 560
        cam.data.type = 'PERSP'
        E = cm.eval_pts(objs["eyes"])
        t = E.mean(axis=0)
        ld.aim(cam, (0, t[1] + 0.02, t[2] - 0.035), 28, 0.62 * H / 1.7 + 0.2, elev_deg=2, lens=85)
        cm.look_at_camera(arm, cam)
        p = os.path.join(TMP, f"face_{i:02d}.png")
        ld.render(p)
        faces.append(p)
        labels.append(label)
    person.clear_people()
    B.save_cache()
    img("grid", os.path.join(OUT, "checkpoint_variety_bodies.png"), 6, json.dumps(labels), *bodies)
    img("grid", os.path.join(OUT, "checkpoint_variety_faces.png"), 6, json.dumps(labels), *faces)
    if rnd:
        R_ = lambda n: os.path.join(OUT, f"{n}_round{rnd}.png")
        img("neutral", os.path.join(OUT, "checkpoint_neutral.png"), os.path.join(OUT, "reference_face_crop.png"), R_("ref_face"),
            R_("front_face_f"), R_("q34_face_f"), R_("side_face_f"), R_("front_face_m"), R_("q34_face_m"), R_("side_face_m"),
            R_("front_body_f"), R_("side_body_f"), R_("front_body_m"), R_("side_body_m"))


if __name__ == "__main__":
    main()
