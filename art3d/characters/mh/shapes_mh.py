"""Our blend shapes (names kept from ../common.py) as recipes of MakeHuman targets, macro changes and our own fields.

Every key is evaluated in the masculine neutral's pre-warp space and pushed through its proportion warp:
    key coords = ground(warp_M(P_M_pre + sum(w * MakeHuman target delta) + macro delta + field delta))
`Sex` is the exact feminine neutral minus the masculine neutral.  Weight 1 is the far end of each key's range;
ranges were checked with check_ranges.py (eye width 0.22-0.30, mouth 0.38-0.54, ears 0.17-0.24 of head size).

Spec keys:  t = {MakeHuman target: weight} ('*-' = both sides);  macro = {macro: value} (absolute, replaces the neutral's
value);  macro_from = 'F' to take the macro delta on the feminine macro setting;  mask = 'body' keeps the head out (halfling);
fields = custom stylise fields (stylise_mh.custom_fields).
"""
EU = "expression/units/caucasian/"

BODY = {
    "Height_Legs": dict(t={"legs/upperlegs-height-incr": 1.0, "legs/lowerlegs-height-incr": 1.0}),
    "Shoulders": dict(t={"torso/measure-shoulder-dist-incr": 1.0}),
    "Chest_Muscle": dict(t={"torso/torso-muscle-pectoral-incr": 1.0}),
    "Breast": dict(macro={"cupsize": 1.0}, macro_from="F"),
    "Waist_Slim": dict(t={"torso/measure-waist-circ-decr": 1.0}),
    "Waist_Wide": dict(t={"torso/measure-waist-circ-incr": 1.0}),
    "Belly": dict(t={"stomach/stomach-pregnant-incr": 0.6}),
    "Hips": dict(t={"hip/hip-scale-horiz-incr": 1.0, "torso/measure-hips-circ-incr": 0.5}),
    "Butt": dict(t={"buttocks/buttocks-volume-incr": 1.0}),
    "Arms_Thick": dict(t={"arms/*-upperarm-fat-incr": 1.0, "arms/*-lowerarm-fat-incr": 1.0}),
    "Legs_Thick": dict(t={"legs/*-upperleg-fat-incr": 1.0, "legs/*-lowerleg-fat-incr": 0.7}),
    "Muscle": dict(macro={"muscle": 1.0}),
    "Thin": dict(macro={"weight": 0.0}),
    "Heavy": dict(macro={"weight": 1.0}),
    "Age_Old": dict(macro={"age": 0.875}, smooth_head=40),
    "Child": dict(macro={"age": 0.12}),
    "Neck_Long": dict(t={"neck/neck-scale-vert-incr": 1.0}),
}

FACE = {
    "Face_Long": dict(t={"head/head-scale-vert-incr": 1.0}),
    "Face_Short": dict(t={"head/head-scale-vert-decr": 1.0}),
    "Jaw_Wide": dict(t={"chin/chin-bones-incr": 1.0}),
    "Jaw_Square": dict(t={"head/head-square": 1.0}),
    "Chin_Pointed": dict(t={"chin/chin-triangle": 1.0}),
    "Chin_Long": dict(t={"chin/chin-height-incr": 1.0}),
    "Cheeks_Full": dict(t={"cheek/*-cheek-volume-incr": 1.0}),
    "Cheekbones": dict(t={"cheek/*-cheek-bones-incr": 1.0}),
    "Forehead_High": dict(t={"forehead/forehead-scale-vert-incr": 1.0}),
    "Eye_Big": dict(t={"eyes/*-eye-scale-incr": 1.0}),
    "Eye_Spacing": dict(t={"eyes/*-eye-trans-out": 0.6}),
    "Brow_Ridge": dict(t={"forehead/forehead-nubian-incr": 1.0, "eyebrows/eyebrows-trans-forward": 0.5}),
    "Nose_Bridge": dict(t={"nose/nose-scale-vert-incr": 0.6, "nose/nose-scale-depth-incr": 0.4}),
    "Mouth_Wide": dict(t={"mouth/mouth-scale-horiz-incr": 1.0}),
    "Lips_Full": dict(t={"mouth/mouth-upperlip-volume-incr": 1.0, "mouth/mouth-lowerlip-volume-incr": 1.0}),
    "Ears_Back": dict(t={"ears/*-ear-rot-backward": 0.6, "ears/*-ear-wing-decr": 0.5}),
    "Eye_Round": dict(t={"eyes/*-eye-height2-incr": 1.0}, fields=[{"type": "lids", "upper": -3.0, "lower": -1.0}]),
    "Eye_Almond": dict(t={"eyes/*-eye-corner1-up": 0.4, "eyes/*-eye-height1-decr": 0.5, "eyes/*-eye-height3-decr": 0.5}),
    "Eye_Narrow": dict(t={"eyes/*-eye-height2-decr": 1.0}),
    "Eye_Hooded": dict(t={"eyes/*-eye-eyefold-down": 1.0}, fields=[{"type": "lids", "upper": 3.0}]),
    "Eye_Monolid": dict(t={"eyes/*-eye-epicanthus-in": 1.0, "eyes/*-eye-eyefold-down": 0.7, "eyes/*-eye-eyefold-convex": 0.5}),
    "Eye_TiltUp": dict(t={"eyes/*-eye-corner1-up": 1.0}),
    "Eye_TiltDown": dict(t={"eyes/*-eye-corner1-down": 1.0}),
    "Eye_Deep": dict(t={"eyes/*-eye-push1-in": 0.7, "eyes/*-eye-push2-in": 0.7}),
    "Eye_Protrude": dict(t={"eyes/*-eye-push1-out": 0.7, "eyes/*-eye-push2-out": 0.7}),
    "Eye_Height": dict(t={"eyes/*-eye-trans-up": 1.0}),
    "Chin_Small": dict(t={"chin/chin-prominent-decr": 1.0, "chin/chin-width-decr": 0.6}),
    "Chin_Big": dict(t={"chin/chin-prominent-incr": 1.0, "chin/chin-width-incr": 0.5}),
    "Chin_Wide": dict(t={"chin/chin-width-incr": 1.0}),
    "Chin_Narrow": dict(t={"chin/chin-width-decr": 1.0}),
    "Chin_Forward": dict(t={"chin/chin-prognathism-incr": 1.0}),
    "Chin_Back": dict(t={"chin/chin-prognathism-decr": 1.0}),
    "Chin_Cleft": dict(t={"chin/chin-cleft-incr": 1.0}),
    "Lips_UpperFull": dict(t={"mouth/mouth-upperlip-volume-incr": 1.0, "mouth/mouth-upperlip-height-incr": 0.5}),
    "Lips_LowerFull": dict(t={"mouth/mouth-lowerlip-volume-incr": 1.0, "mouth/mouth-lowerlip-height-incr": 0.5}),
    "Lips_Thin": dict(t={"mouth/mouth-upperlip-volume-decr": 1.0, "mouth/mouth-lowerlip-volume-decr": 1.0}),
    "Mouth_Narrow": dict(t={"mouth/mouth-scale-horiz-decr": 0.4}),
    "Lips_CupidBow": dict(t={"mouth/mouth-cupidsbow-incr": 1.0}),
    "Mouth_CornersUp": dict(t={"mouth/mouth-angles-up": 1.0}),
    "Mouth_CornersDown": dict(t={"mouth/mouth-angles-down": 1.0}),
    "Lips_Pout": dict(t={"mouth/mouth-scale-depth-incr": 1.0}),
}

SPECIES = {
    "Species_Elf": dict(macro={"weight": 0.3}, t={
        "ears/*-ear-shape-pointed": 1.0, "ears/*-ear-scale-vert-incr": 0.8, "ears/*-ear-rot-backward": 0.5,
        "eyes/*-eye-corner1-up": 0.6, "cheek/*-cheek-bones-incr": 0.6, "chin/chin-width-decr": 0.5,
        "neck/neck-scale-vert-incr": 0.5, "head/head-scale-vert-incr": 0.3, "nose/nose-scale-horiz-decr": 0.4}),
    "Species_Dwarf": dict(macro={"muscle": 1.0, "weight": 0.8}, t={
        "legs/upperlegs-height-decr": 1.0, "legs/lowerlegs-height-decr": 1.0, "torso/torso-scale-horiz-incr": 0.6,
        "forehead/forehead-nubian-incr": 1.0, "nose/nose-scale-horiz-incr": 0.6, "nose/nose-volume-incr": 0.7,
        "chin/chin-bones-incr": 0.6, "hands/*-hand-scale-incr": 0.5, "feet/*-foot-scale-incr": 0.3}),
    "Species_Halfling": dict(macro={"age": 0.12}, mask="body", t={
        "cheek/*-cheek-volume-incr": 0.7, "feet/*-foot-scale-incr": 0.6, "ears/*-ear-shape-pointed": 0.3}),
    "Species_Orc": dict(macro={"muscle": 1.0, "weight": 0.75}, t={
        "forehead/forehead-nubian-incr": 1.0, "eyebrows/eyebrows-trans-forward": 1.0, "chin/chin-prognathism-incr": 1.0,
        "chin/chin-bones-incr": 1.0, "head/head-square": 1.0, "nose/nose-scale-depth-decr": 0.7, "nose/nose-flaring-incr": 1.0,
        "nose/nose-nostrils-width-incr": 0.6, "ears/*-ear-shape-pointed": 0.5, "mouth/mouth-scale-horiz-incr": 0.6,
        "eyes/*-eye-scale-decr": 0.2, "torso/torso-scale-horiz-incr": 0.3, "hands/*-hand-scale-incr": 0.6,
        "neck/neck-scale-horiz-decr": 0.6, "neck/measure-neck-circ-decr": 0.6}),
}

EXPR = {
    "Mouth_Smile": dict(t={EU + "mouth-corner-puller": 1.0}),
    "Mouth_Frown": dict(t={EU + "mouth-depression": 1.0}),
    "Mouth_O": dict(t={EU + "mouth-pursing": 0.8, EU + "mouth-protusion": 0.4}),
    "Mouth_E": dict(t={EU + "mouth-retraction": 1.0}),
    "Mouth_MBP": dict(t={EU + "mouth-compression": 0.7}),
    "Brow_Up": dict(t={EU + "eyebrows-left-up": 1.0, EU + "eyebrows-right-up": 1.0}),
    "Brow_Down": dict(t={EU + "eyebrows-left-down": 1.0, EU + "eyebrows-right-down": 1.0}),
    "Brow_Sad": dict(t={EU + "eyebrows-left-inner-up": 1.0, EU + "eyebrows-right-inner-up": 1.0}),
    "Eye_Blink_L": dict(t={EU + "eye-left-closure": 1.0}),
    "Eye_Blink_R": dict(t={EU + "eye-right-closure": 1.0}),
    "Eye_Squint": dict(t={EU + "eye-left-slit": 1.0, EU + "eye-right-slit": 1.0}),
    "Cheek_Puff": dict(t={"cheek/*-cheek-volume-incr": 1.5, EU + "mouth-compression": 0.4}),
}

ALL = {}
for d in (BODY, FACE, SPECIES, EXPR):
    ALL.update(d)

# ---- measured-variation sliders (2026-11-21).  Bipolar: weight -1..+1, +1 = about +2 SD of the measured adult value
# (Farkas), -1 = -2 SD; Unity blend-shape weights may be negative.  Existing keys that already do the job are reused
# (see VARIATION below); these are the new ones.
VAR = {
    "Var_LowerFace": dict(t={"chin/chin-height-incr": 0.6, "mouth/mouth-trans-down": 0.15}),
    "Var_NoseLength": dict(t={"nose/nose-scale-vert-incr": 0.6}),          # = middle-face length
    "Var_Forehead": dict(t={"forehead/forehead-scale-vert-incr": 0.6}),
    "Var_NoseWidth": dict(t={"nose/nose-scale-horiz-incr": 0.6}),
    "Var_EarSize": dict(t={"ears/*-ear-scale-incr": 0.5}),
    "Var_SkullWidth": dict(t={"head/head-scale-horiz-incr": 0.5}),
    "Var_SkullDepth": dict(t={"head/head-back-scale-depth-incr": 0.6}),
    "Var_NeckWidth": dict(t={"neck/measure-neck-circ-incr": 0.6}),
}
ALL.update(VAR)
STYLISE = ["Stylise_F", "Stylise_M"]
FIXES = ["Fix_EyeRound_Blink_L", "Fix_EyeRound_Blink_R"]   # correctives, weight = Eye_Round x Eye_Blink_<side>
BROW = ["Brow_Height", "Brow_Thick", "Brow_Length", "Brow_Arch", "Brow_ArchPos", "Brow_Tilt", "Brow_Gap"]   # on Part_Brows only
EXTRA_SHAPES = list(VAR) + STYLISE + FIXES + BROW          # new names beyond ../common.py ALL_SHAPES (contract change)

# slider -> (positive key, negative key or None for a signed single key); the person generator and the editor use this
VARIATION = {
    "Lower face length": ("Var_LowerFace", None), "Middle face / nose length": ("Var_NoseLength", None),
    "Forehead height": ("Var_Forehead", None), "Eye length": ("Eye_Big", None), "Eye gap": ("Eye_Spacing", None),
    "Eye tilt": ("Eye_TiltUp", "Eye_TiltDown"), "Eye openness": ("Eye_Round", "Eye_Narrow"),
    "Nose width": ("Var_NoseWidth", None), "Nose bridge": ("Nose_Bridge", None), "Mouth width": ("Mouth_Wide", "Mouth_Narrow"),
    "Upper lip": ("Lips_UpperFull", None), "Lower lip": ("Lips_LowerFull", None), "Cupid's bow": ("Lips_CupidBow", None),
    "Chin height": ("Chin_Long", None), "Chin projection": ("Chin_Forward", "Chin_Back"), "Jaw width": ("Jaw_Wide", None),
    "Jaw angle": ("Jaw_Square", None), "Cheekbones": ("Cheekbones", None), "Cheek fullness": ("Cheeks_Full", None),
    "Brow ridge": ("Brow_Ridge", None), "Ear size": ("Var_EarSize", None), "Skull width": ("Var_SkullWidth", None),
    "Skull depth": ("Var_SkullDepth", None), "Neck width": ("Var_NeckWidth", None), "Neck length": ("Neck_Long", None),
    "Face length": ("Face_Long", "Face_Short"),
}
BODY_SLIDERS = {"Height / legs": ("Height_Legs", None), "Shoulders": ("Shoulders", None), "Waist": ("Waist_Wide", "Waist_Slim"),
                "Breast": ("Breast", None), "Belly": ("Belly", None), "Hips": ("Hips", None), "Butt": ("Butt", None),
                "Muscle": ("Muscle", None), "Weight": ("Heavy", "Thin"), "Arms": ("Arms_Thick", None), "Legs": ("Legs_Thick", None)}

# The keys reused as variation sliders were defined with weight 1 = the far end of MakeHuman's range, which is far more
# than 2 SD of real faces; scale their recipes so that 1 = about 2 SD (judged on sweeps_face_*.png, 2026-11-21).
_SCALE = {"Face_Long": 0.5, "Face_Short": 0.5, "Jaw_Wide": 0.5, "Jaw_Square": 0.5, "Chin_Long": 0.4, "Chin_Forward": 0.5,
          "Chin_Back": 0.5, "Cheeks_Full": 0.6, "Cheekbones": 0.6, "Brow_Ridge": 0.6, "Eye_Big": 0.6, "Lips_UpperFull": 0.6,
          "Lips_LowerFull": 0.6, "Lips_CupidBow": 0.6, "Nose_Bridge": 0.6, "Neck_Long": 0.5, "Eye_TiltUp": 0.6,
          "Eye_TiltDown": 0.6, "Eye_Spacing": 0.8}
for _k, _s in _SCALE.items():
    _spec = ALL[_k]
    if "t" in _spec:
        _spec["t"] = {k: v * _s for k, v in _spec["t"].items()}

for _k in ("Chin_Long", "Var_LowerFace", "Face_Long", "Face_Short", "Chin_Forward", "Chin_Back", "Jaw_Wide", "Jaw_Square",
           "Chin_Small", "Chin_Big", "Chin_Pointed", "Chin_Wide", "Chin_Narrow"):
    ALL[_k]["smooth_neck"] = 0

# eyebrow sliders (round 17): shape keys on Part_Brows (face_cards.deform_brow), bipolar -1..+1 (1 ~ 2 SD).  Density and
# colour are material parameters (brow alpha gain 0.6-1.6, colour = hair colour x 0.8-1.15), the style picks the texture.
BROW_SLIDERS = {"Brow height": ("Brow_Height", None), "Brow thickness": ("Brow_Thick", None), "Brow length": ("Brow_Length", None),
                "Brow arch": ("Brow_Arch", None), "Arch position": ("Brow_ArchPos", None), "Brow tilt": ("Brow_Tilt", None),
                "Gap between brows": ("Brow_Gap", None)}
