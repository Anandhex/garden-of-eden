"""Data tables for the decal based categories (eyes, lids, eyebrows, mouths, stubble) and shared palettes.
Every entry becomes one part in parts_manifest.json."""

HAIR_COLOURS = {
    "black": (0.055, 0.048, 0.050), "blue_black": (0.040, 0.048, 0.085), "dark_brown": (0.15, 0.09, 0.055),
    "brown": (0.28, 0.165, 0.085), "chestnut": (0.38, 0.20, 0.10), "auburn": (0.46, 0.17, 0.075),
    "ginger": (0.64, 0.28, 0.09), "blonde": (0.78, 0.60, 0.28), "platinum": (0.88, 0.82, 0.70),
    "grey": (0.55, 0.55, 0.56), "silver": (0.72, 0.74, 0.78), "white": (0.90, 0.90, 0.88),
    "green_orc": (0.10, 0.16, 0.08), "copper_red": (0.55, 0.12, 0.08),
}
IRIS_COLOURS = {
    "brown": (0.45, 0.27, 0.13), "dark_brown": (0.22, 0.12, 0.07), "hazel": (0.55, 0.42, 0.18), "green": (0.30, 0.55, 0.30),
    "blue": (0.30, 0.52, 0.80), "grey": (0.55, 0.60, 0.65), "amber": (0.80, 0.55, 0.12), "violet": (0.55, 0.35, 0.75),
    "red": (0.80, 0.15, 0.12), "gold": (0.95, 0.80, 0.20), "teal": (0.18, 0.60, 0.60), "ice": (0.50, 0.72, 0.92),
    "orange": (0.92, 0.45, 0.10), "black": (0.12, 0.10, 0.10), "pale_blue": (0.62, 0.74, 0.86),
}
LIP_TINTS = {
    "natural": (0.80, 0.42, 0.40), "rose": (0.86, 0.46, 0.50), "red": (0.76, 0.16, 0.19), "berry": (0.50, 0.15, 0.28),
    "pale": (0.84, 0.58, 0.52), "dark": (0.46, 0.26, 0.25), "plum": (0.55, 0.28, 0.38), "orc": (0.32, 0.30, 0.22),
    "peach": (0.92, 0.55, 0.46),
}

# ------------------------------------------------------------------ lids / lashes (decals on the eye area only)
LIDS = {
    "none": {},
    "thin_liner": dict(line=0.0009, flick=0.0045),
    "lashes_soft": dict(line=0.0012, lash=7, lash_len=0.0050),
    "lashes_heavy": dict(line=0.0020, lash=9, lash_len=0.0075, flick=0.0060),
    "kohl": dict(line=0.0020, low=0.0016, col=(0.10, 0.07, 0.07)),
    "winged": dict(line=0.0013, flick=0.0110, flick_rise=1.1),
    "smoky": dict(shadow=(0.42, 0.30, 0.30, 0.50), line=0.0010),
    "smoky_plum": dict(shadow=(0.45, 0.20, 0.40, 0.55), line=0.0010, lash=5, lash_len=0.004),
    "tired": dict(line=0.0008, bag=0.55),
    "elder": dict(line=0.0007, bag=0.5, crow=0.8, crease=0.0006),
    "child": dict(line=0.0006, lash=4, lash_len=0.0035),
    "orc_rim": dict(line=0.0028, low=0.0020, col=(0.09, 0.13, 0.07)),
    "elf_flick": dict(line=0.0009, flick=0.0100, lash=5, lash_len=0.0065),
    "crease": dict(line=0.0009, crease=0.0007),
}


def _b(name, tags, **kw):
    return dict(name=name, tags=tags, p=kw)


# ------------------------------------------------------------------ eyebrows (30)
BROWS = [
    _b("soft_arch", ["common", "any"]),
    _b("straight_thick", ["masculine", "common"], arch=0.0012, th=0.0042),
    _b("thin_arched", ["feminine", "gentle"], th=0.0016, arch=0.006, peak=0.6),
    _b("elf_high_swept", ["elf", "feminine", "noble"], th=0.0014, arch=0.008, tilt=0.004, length=0.046, height=1.657),
    _b("bushy_elder", ["elder", "rustic"], th=0.0050, bushy=0.9, a_out=0.5, drop=0.003, length=0.044),
    _b("unibrow", ["rustic", "dwarf"], inner=-0.007, th=0.0040, arch=0.003),
    _b("heavy_orc", ["orc", "brute"], th=0.0060, tilt=0.006, a_in=1.0, a_out=0.4, arch=0.001),
    _b("sad_slant", ["gentle", "worried"], tilt=-0.0045, arch=0.002, th=0.0030),
    _b("angry_slant", ["stern", "soldier"], tilt=0.0065, arch=0.002, th=0.0042),
    _b("short_stub", ["child", "common"], length=0.028, th=0.0040),
    _b("long_flat", ["feminine", "elder"], length=0.050, th=0.0025, arch=0.003, peak=0.45),
    _b("tapered_fine", ["feminine", "noble"], th=0.0026, arch=0.0055, a_in=0.9, a_out=0.05),
    _b("scarred_left", ["fighter", "rogue"], th=0.0036, scar=dict(t=0.45, w=0.0026, slope=0.6, side=1)),
    _b("scarred_right", ["fighter", "rogue"], th=0.0036, scar=dict(t=0.55, w=0.0026, slope=-0.6, side=-1)),
    _b("sparse_thin_elder", ["elder", "frail"], th=0.0022, sparse=0.35, drop=0.004),
    _b("square_bold", ["masculine", "smith"], th=0.0046, arch=0.0006, a_in=1.0, a_out=0.8, length=0.042),
    _b("round_curved", ["gentle", "child"], arch=0.007, peak=0.5, drop=0.006, th=0.0030),
    _b("low_flat_heavy", ["brute", "stern"], height=1.648, th=0.0046, arch=0.0015),
    _b("raised_high", ["noble", "surprised"], height=1.660, arch=0.006, th=0.0032),
    _b("broken_gap", ["fighter", "rogue"], th=0.0034, scar=dict(t=0.5, w=0.0032, slope=0.1, side=0)),
    _b("wild_feathered", ["rustic", "wanderer"], bushy=1.4, th=0.0042, tilt=0.002),
    _b("pencil_thin_long", ["courtly", "feminine"], th=0.0010, length=0.052, arch=0.004),
    _b("comma_dwarf", ["dwarf", "heavy"], th=0.0062, length=0.036, a_out=0.3, drop=0.004),
    _b("dramatic_arch", ["courtly", "performer"], arch=0.0100, peak=0.45, th=0.0030),
    _b("child_light", ["child"], th=0.0018, length=0.034, arch=0.003),
    _b("thick_natural", ["common", "masculine"], th=0.0048, arch=0.0045),
    _b("wide_set", ["gentle", "common"], inner=0.016, length=0.036, th=0.0032),
    _b("tail_up", ["rogue", "elf"], tilt=0.003, arch=0.003, a_out=0.5, drop=-0.004, th=0.0030),
    _b("gnarled_elder", ["elder", "hermit"], bushy=0.6, th=0.0040, drop=0.005, sparse=0.2),
    _b("soft_square", ["common", "gentle"], th=0.0038, arch=0.002, peak=0.4),
]


# ------------------------------------------------------------------ eyes (30 looks)
def _e(name, colour, lid, tags, **iris):
    return dict(name=name, colour=colour, lid=lid, tags=tags, iris=iris)


EYES = [
    _e("brown_classic", "brown", "thin_liner", ["common"], pat="smooth", pupil="round", hl="single"),
    _e("dark_brown_deep", "dark_brown", "lashes_soft", ["common", "feminine"], pat="ring", pupil="round", hl="single", seed=2),
    _e("hazel_streaks", "hazel", "lashes_soft", ["common"], pat="streaks", pupil="round", hl="double", seed=3),
    _e("green_flecks", "green", "thin_liner", ["common"], pat="flecks", pupil="round", hl="single", seed=4),
    _e("blue_clear", "blue", "lashes_heavy", ["feminine", "noble"], pat="smooth", pupil="round", hl="big", ri=0.58),
    _e("grey_steel", "grey", "kohl", ["stern", "northern"], pat="streaks", pupil="round", hl="small", seed=5),
    _e("amber_warm", "amber", "none", ["common"], pat="streaks", pupil="round", hl="single", seed=6),
    _e("violet_elf", "violet", "elf_flick", ["elf"], pat="swirl", pupil="round", hl="star", seed=7),
    _e("teal_ring", "teal", "winged", ["feminine", "courtly"], pat="ring", pupil="round", hl="double"),
    _e("black_deep", "black", "tired", ["common", "weary"], pat="smooth", pupil="small", hl="small", ri=0.52),
    _e("cat_green", "green", "winged", ["elf", "rogue"], pat="streaks", pupil="slit", hl="double", seed=8),
    _e("cat_amber", "amber", "kohl", ["rogue", "beastkin"], pat="fire", pupil="slit", hl="single"),
    _e("goat_gold", "gold", "none", ["wanderer", "fey"], pat="flecks", pupil="hslit", hl="single", seed=9),
    _e("orc_red", "red", "orc_rim", ["orc"], pat="fire", pupil="small", hl="small", ri=0.5),
    _e("orc_yellow", "gold", "orc_rim", ["orc"], pat="smooth", pupil="round", hl="small", glow=True, ri=0.5),
    _e("elder_milky", "pale_blue", "elder", ["elder"], pat="milky", pupil="round", hl="low", ri=0.55),
    _e("elder_brown_tired", "brown", "elder", ["elder"], pat="smooth", pupil="small", hl="low", ri=0.52),
    _e("child_wide_blue", "blue", "child", ["child"], pat="smooth", pupil="round", hl="big", ri=0.62, pr=0.38),
    _e("child_big_brown", "brown", "child", ["child"], pat="ring", pupil="round", hl="big", ri=0.62, pr=0.40),
    _e("smoky_hazel", "hazel", "smoky", ["feminine", "courtly"], pat="ring", pupil="round", hl="double", seed=11),
    _e("plum_shadow_green", "green", "smoky_plum", ["feminine", "courtly"], pat="swirl", pupil="round", hl="double", seed=12),
    _e("star_blue", "blue", "lashes_heavy", ["feminine"], pat="sectors", pupil="round", hl="star", seed=13),
    _e("pale_ice", "ice", "thin_liner", ["northern", "elf"], pat="smooth", pupil="small", hl="single", ri=0.54),
    _e("brown_sleepy", "dark_brown", "tired", ["weary", "common"], pat="smooth", pupil="round", hl="low", ri=0.50),
    _e("fire_orange", "orange", "kohl", ["fey", "wanderer"], pat="fire", pupil="round", hl="small"),
    _e("green_gold_crease", "green", "crease", ["common"], pat="sectors", pupil="round", hl="single", seed=14),
    _e("brown_flecks_wide", "brown", "lashes_soft", ["common"], pat="flecks", pupil="round", hl="double", ri=0.60, seed=15),
    _e("hazel_sectors", "hazel", "crease", ["common"], pat="sectors", pupil="round", hl="single", seed=16),
    _e("square_gold", "gold", "none", ["dwarf", "fey"], pat="smooth", pupil="square", hl="single", ri=0.55),
    _e("keyhole_violet", "violet", "elf_flick", ["fey", "elf"], pat="swirl", pupil="keyhole", hl="double", seed=17),
]


# ------------------------------------------------------------------ mouths (30)
def _m(name, tint, tags, teeth_mesh="even", lips=None, inner=None):
    return dict(name=name, tint=tint, tags=tags, teethMesh=teeth_mesh, lips=lips or {}, inner=inner)


MOUTHS = [
    _m("neutral_soft", "natural", ["common"]),
    _m("thin_stern", "pale", ["stern", "masculine"], lips=dict(tu=0.0042, tl=0.0050, cupid=0.0004, alpha=0.6, line=1.0)),
    _m("full_pout", "rose", ["feminine"], lips=dict(tu=0.0090, tl=0.0108, cupid=0.0018, w=0.022)),
    _m("cupid_bow", "red", ["feminine", "courtly"], lips=dict(tu=0.0085, tl=0.0095, cupid=0.0030, w=0.023)),
    _m("wide_smile_closed", "natural", ["friendly"], lips=dict(w=0.028, corner=0.0045, tu=0.0070, tl=0.0085)),
    _m("small_prim", "peach", ["feminine", "prim"], lips=dict(w=0.017, tu=0.0060, tl=0.0070, cupid=0.002)),
    _m("downturned_grim", "dark", ["stern", "grim"], lips=dict(corner=-0.0042, tu=0.0050, tl=0.0060, line=1.0)),
    _m("smirk", "natural", ["rogue"], lips=dict(skew=0.5, corner=0.0020, tu=0.0070, tl=0.0080)),
    _m("full_wide", "rose", ["feminine", "friendly"], lips=dict(w=0.029, tu=0.0090, tl=0.0105)),
    _m("thin_wide", "pale", ["masculine", "stern"], lips=dict(w=0.028, tu=0.0038, tl=0.0046, line=1.0)),
    _m("upper_full", "natural", ["common"], lips=dict(tu=0.0095, tl=0.0060, cupid=0.0022)),
    _m("lower_full", "natural", ["common", "sulky"], lips=dict(tu=0.0055, tl=0.0115)),
    _m("smile_teeth", "natural", ["friendly", "joyful"],
       lips=dict(part=0.0030, w=0.024, corner=0.0035, tu=0.0050, tl=0.0060, alpha=0.65),
       inner=dict(gap=0.0036, teeth="upper", corner=0.0035, w=0.0235, up=0.9, lo=0.8)),
    _m("broad_grin", "rose", ["joyful", "performer"],
       lips=dict(part=0.0045, w=0.028, corner=0.0060, tu=0.0050, tl=0.0060, alpha=0.65),
       inner=dict(gap=0.0055, teeth="both", corner=0.0060, w=0.0275, up=0.9, lo=0.9)),
    _m("gap_tooth_grin", "natural", ["rustic", "joyful"], teeth_mesh="gap",
       lips=dict(part=0.0035, w=0.026, corner=0.0040, tu=0.0055, tl=0.0065, alpha=0.65),
       inner=dict(gap=0.0040, teeth="gap", tooth_gap=0.0, corner=0.0040, w=0.0255, up=0.9, lo=0.7)),
    _m("open_laugh", "red", ["joyful", "performer"],
       lips=dict(part=0.0070, w=0.026, corner=0.0050, tu=0.0050, tl=0.0060, alpha=0.65),
       inner=dict(gap=0.0095, teeth="upper", corner=0.0050, w=0.0255, up=0.7, lo=1.2, tongue=True)),
    _m("snarl_fangs", "dark", ["orc", "brute", "feral"], teeth_mesh="fangs",
       lips=dict(part=0.0040, w=0.026, corner=-0.0030, tu=0.0045, tl=0.0060, alpha=0.65),
       inner=dict(gap=0.0050, teeth="fangs", corner=-0.0030, w=0.0255, up=0.9, lo=0.9)),
    _m("gritted_teeth", "pale", ["angry", "soldier"],
       lips=dict(part=0.0030, w=0.025, tu=0.0040, tl=0.0050, alpha=0.5),
       inner=dict(gap=0.0036, teeth="gritted", w=0.0245, up=0.9, lo=0.9)),
    _m("slightly_open", "natural", ["common", "gentle"], lips=dict(part=0.0016, tu=0.0070, tl=0.0090, line=0.0),
       inner=dict(gap=0.0018, w=0.0210, up=1.0, lo=1.0)),
    _m("scarred_lip", "natural", ["fighter", "rogue"], lips=dict(scar=dict(x=0.010, slope=0.45, len=0.013), tu=0.0065, tl=0.0080)),
    _m("elder_lines", "pale", ["elder"], lips=dict(lines=0.7, tu=0.0045, tl=0.0055, alpha=0.55)),
    _m("elder_sunken", "dark", ["elder", "toothless"], teeth_mesh="none",
       lips=dict(lines=0.5, w=0.020, tu=0.0035, tl=0.0050, corner=-0.0025, alpha=0.5)),
    _m("child_small", "peach", ["child"], lips=dict(w=0.016, tu=0.0070, tl=0.0085, cupid=0.0018, alpha=0.6)),
    _m("rouge_red", "red", ["courtly", "feminine"], lips=dict(tu=0.0082, tl=0.0092, cupid=0.0025, alpha=0.85)),
    _m("dark_berry", "berry", ["courtly", "feminine"], lips=dict(tu=0.0078, tl=0.0090, cupid=0.0022, alpha=0.88)),
    _m("pale_nude", "pale", ["feminine", "gentle"], lips=dict(tu=0.0075, tl=0.0088, alpha=0.45)),
    _m("harelip_scar", "natural", ["rustic", "outcast"], lips=dict(scar=dict(x=0.0, slope=0.05, len=0.016, a=0.9), tu=0.0065, tl=0.0080)),
    _m("orc_wide_dark", "orc", ["orc"], teeth_mesh="fangs", lips=dict(w=0.030, tu=0.0070, tl=0.0095, corner=-0.0035, alpha=0.9)),
    _m("elf_fine", "plum", ["elf", "feminine"], lips=dict(w=0.020, tu=0.0062, tl=0.0070, cupid=0.0030, alpha=0.7)),
    _m("dwarf_firm_wide", "dark", ["dwarf", "masculine"], lips=dict(w=0.027, tu=0.0055, tl=0.0070, line=1.0, alpha=0.6)),
]

# ------------------------------------------------------------------ stubble / shadow decals (tinted by hair colour)
STUBBLE = [
    dict(name="stubble_light", p=dict(kind="light", seed=1), tags=["masculine", "common"]),
    dict(name="stubble_full", p=dict(kind="full", seed=2), tags=["masculine", "common"]),
    dict(name="stubble_heavy", p=dict(kind="heavy", seed=3, alpha=0.7), tags=["masculine", "rustic", "brute"]),
    dict(name="stubble_chinstrap", p=dict(kind="chinstrap", seed=4), tags=["masculine", "rogue"]),
    dict(name="stubble_goatee", p=dict(kind="goatee", seed=5), tags=["masculine", "rogue"]),
    dict(name="stubble_moustache", p=dict(kind="moustache", seed=6), tags=["masculine", "common"]),
]
