"""Garment piece definitions (run inside Blender via build_clothes.py).  Every function builds one Garment on the neutral body.

Slots: torso (replaces Mesh_Torso), arms, hands, legs, feet, skirt (hangs from the waist), overlay (belts, straps, aprons, cloaks,
hoods, scarves, pouches), headwear (Socket_Hat).  layer: base (replaces body regions) | over (drawn on top).
"""
import math
import numpy as np
from clothes_lib import Garment, smooth, SEAM

B = None
REG = {}          # id -> dict(meta, fn)
ORDER = []

TH36 = np.linspace(0, 2 * math.pi, 36, endpoint=False)
TH28 = np.linspace(0, 2 * math.pi, 28, endpoint=False)
HIP_C = (0.0, -0.009)
HEAD_C = (0.0, -0.03)
ALL_C = ["highland", "river", "coastal", "forest", "steppe", "imperial"]


def piece(pid, slot, layer, name, cultures=None, classes=None, ages=("child", "adult", "elder"), notes=""):
    def deco(fn):
        REG[pid] = dict(id=pid, slot=slot, layer=layer, name=name, cultures=cultures or ALL_C, classes=classes or [],
                        ages=list(ages), fn=fn, notes=notes)
        ORDER.append(pid)
        return fn
    return deco


def nz(x, y, z, f=1.0):
    return np.sin(x * 57 * f + z * 31 * f + y * 13) * np.cos(y * 73 * f + z * 41 * f + x * 11)


def Z(a): return B.z[a]
def X(a): return B.x[a]
def Y(a): return B.y[a]
def TA(a): return B.tarm[a]
def TL(a): return B.tleg[a]


def G(pid): return Garment(B, pid)


def zband(g, lo, hi):
    g.trim(lambda p: p[:, 2], lo, hi)


def modband(g, period, lo, hi):
    g.trim_cmod(period, lo, hi)


def neckband(g, lo=1.375, hi=1.42, w=0.115):
    g.trim(lambda p: np.where(np.abs(p[:, 0]) < w, p[:, 2], 99.0), lo, hi)


# ================================================================== TORSO
def torso_ease(base, hip=0.0, chest=0.0):
    return lambda a: base + hip * smooth(1.18, 0.93, Z(a)) + chest * smooth(1.12, 1.30, Z(a)) * smooth(1.42, 1.34, Z(a))


@piece("t_shirt", "torso", "base", "Linen shirt", classes=["farmer", "labourer", "smith", "merchant", "traveller", "child", "elder"])
def t_shirt():
    g = G("t_shirt")
    g.region(["torso"], torso_ease(0.011, 0.012, 0.004))
    neckband(g)
    return g


@piece("t_shirt_open", "torso", "base", "Open-neck shirt", classes=["farmer", "merchant", "traveller", "elder"])
def t_shirt_open():
    g = G("t_shirt_open")
    keep = lambda a: ~((Z(a) > 1.325) & (Y(a) < -0.02) & (np.abs(X(a)) < 0.045 + (Z(a) - 1.325) * 0.55))
    g.region(["torso"], torso_ease(0.011, 0.012, 0.004), keep=keep)
    g.opaque = False
    g.trim(lambda p: np.where(p[:, 1] < -0.02, np.abs(p[:, 0]), 9), 0.0, 0.017)
    return g


@piece("t_jerkin", "torso", "base", "Leather jerkin", classes=["farmer", "labourer", "soldier", "traveller", "smith"])
def t_jerkin():
    g = G("t_jerkin")
    g.region(["torso"], torso_ease(0.017, 0.006, 0.004), mat=lambda a: "Leather")
    g.trim(lambda p: np.where(p[:, 1] < -0.02, np.abs(p[:, 0]), 9), 0.0, 0.015)
    return g


@piece("t_bodice", "torso", "base", "Laced bodice", classes=["farmer", "noble", "merchant", "elder", "child"])
def t_bodice():
    g = G("t_bodice")
    g.region(["torso"], torso_ease(0.007, 0.004, 0.002))
    g.trim(lambda p: np.where(p[:, 1] < -0.02, np.abs(p[:, 0]), 9), 0.0, 0.016)
    neckband(g)
    return g


@piece("t_robe_top", "torso", "base", "Robe (upper)", classes=["priest", "scholar", "noble"])
def t_robe_top():
    g = G("t_robe_top")
    g.region(["torso"], torso_ease(0.026, 0.02, 0.006))
    g.trim(lambda p: np.where(p[:, 1] < -0.02, np.abs(p[:, 0]), 9), 0.0, 0.03)
    neckband(g)
    return g


@piece("t_doublet", "torso", "base", "Padded doublet", classes=["merchant", "noble", "scholar"])
def t_doublet():
    g = G("t_doublet")
    g.region(["torso"], torso_ease(0.02, 0.008, 0.01), mat=lambda a: "Quilt" if Z(a).mean() < 1.37 else "Tint")
    g.trim(lambda p: np.where(p[:, 1] < -0.02, np.abs(p[:, 0]), 9), 0.0, 0.014)
    neckband(g)
    return g


@piece("t_deel", "torso", "base", "Wrapped deel coat", cultures=["steppe"], classes=["labourer", "merchant", "noble", "soldier"])
def t_deel():
    g = G("t_deel")
    g.region(["torso"], torso_ease(0.028, 0.012, 0.006))
    g.trim(lambda p: np.where(p[:, 1] < -0.02, np.abs(p[:, 0] + (p[:, 2] - 1.2) * 0.38), 9), 0.0, 0.02)
    neckband(g)
    zband(g, 0.85, 0.9)
    return g


@piece("t_clavus", "torso", "base", "Tunic with stripes", cultures=["imperial", "coastal"], classes=["smith", "noble", "scholar"])
def t_clavus():
    g = G("t_clavus")
    g.region(["torso"], torso_ease(0.015, 0.012, 0.004))
    g.trim(lambda p: np.abs(np.abs(p[:, 0]) - 0.05), 0.0, 0.013)
    return g


@piece("t_jersey", "torso", "base", "Striped jersey", cultures=["coastal"], classes=["labourer", "traveller", "farmer"])
def t_jersey():
    g = G("t_jersey")
    g.region(["torso"], torso_ease(0.009, 0.008, 0.004), mat=lambda a: "Stripe")
    return g


@piece("t_mail", "torso", "base", "Mail hauberk", classes=["guard", "soldier"], ages=("adult", "elder"))
def t_mail():
    g = G("t_mail")
    g.region(["torso"], torso_ease(0.016, 0.01, 0.006), mat=lambda a: "Metal")
    g.trim(lambda p: p[:, 2], 0.85, 0.9)
    return g


@piece("t_breastplate", "torso", "over", "Breastplate", classes=["guard", "soldier"], ages=("adult", "elder"))
def t_breastplate():
    g = G("t_breastplate")
    keep = lambda a: (Z(a) > 1.05) & (Z(a) < 1.335) & (np.abs(X(a)) < 0.2) & (np.abs(X(a)) < 0.2 - 0.06 * smooth(1.2, 1.05, Z(a)))
    g.region(["torso"], lambda a: 0.04 + 0.012 * smooth(1.1, 1.26, Z(a)) * smooth(1.36, 1.28, Z(a)), keep=keep, mat=lambda a: "Metal", lip=0.01)
    g.opaque = False
    return g


@piece("t_vest_quilted", "torso", "over", "Quilted vest", classes=["farmer", "labourer", "merchant", "traveller", "soldier"])
def t_vest_quilted():
    g = G("t_vest_quilted")
    keep = lambda a: (Z(a) > 0.98) & ((np.abs(X(a)) < 0.15) | (Z(a) < 1.24)) & \
        ~((Z(a) > 1.33) & (Y(a) < -0.02) & (np.abs(X(a)) < 0.075 + (Z(a) - 1.33) * 0.5))
    g.region(["torso"], lambda a: 0.027 + 0.005 * smooth(1.1, 1.3, Z(a)), keep=keep, mat=lambda a: "Quilt", lip=0.012)
    g.opaque = False
    g.trim(lambda p: p[:, 2], 0.98, 1.01)
    return g


@piece("t_vest_fur", "torso", "over", "Fur-trimmed vest", cultures=["highland", "forest", "steppe"], classes=["farmer", "traveller", "soldier", "elder"])
def t_vest_fur():
    g = G("t_vest_fur")
    keep = lambda a: (Z(a) > 0.98) & ((np.abs(X(a)) < 0.15) | (Z(a) < 1.24)) & \
        ~((Z(a) > 1.33) & (Y(a) < -0.02) & (np.abs(X(a)) < 0.07 + (Z(a) - 1.33) * 0.5))
    g.region(["torso"], lambda a: 0.034, keep=keep, noise=0.008, lip=0.014)
    g.opaque = False
    return g


@piece("t_rags", "torso", "over", "Ragged shirt", classes=["slave", "elder"])
def t_rags():
    g = G("t_rags")
    keep = lambda a: (Z(a) > 0.98 + 0.07 * nz(X(a), Y(a), Z(a), 1.7)) & ~(nz(X(a), Y(a), Z(a), 2.3) > 0.82)
    g.region(["torso"], lambda a: 0.012 + 0.005 * nz(X(a), Y(a), Z(a), 1.3), keep=keep, lip=0.005)
    g.opaque = False
    return g


# ================================================================== ARMS
def arm_trim(g, lo=0.975, hi=1.04):
    zband(g, lo, hi)


@piece("a_sleeve_long", "arms", "base", "Long sleeve", classes=["farmer", "labourer", "merchant", "traveller", "noble", "soldier", "elder", "child"])
def a_sleeve_long():
    g = G("a_sleeve_long")
    g.region(["arms"], lambda a: 0.013 + 0.004 * smooth(0.2, 0.7, TA(a)))
    arm_trim(g)
    return g


@piece("a_sleeve_fitted", "arms", "base", "Fitted sleeve", classes=["merchant", "noble", "scholar", "soldier", "guard"])
def a_sleeve_fitted():
    g = G("a_sleeve_fitted")
    g.region(["arms"], lambda a: 0.0065)
    arm_trim(g, 0.975, 1.03)
    return g


@piece("a_sleeve_short", "arms", "base", "Short sleeve", classes=["farmer", "labourer", "smith", "child"])
def a_sleeve_short():
    g = G("a_sleeve_short")
    g.region(["arms"], lambda a: 0.015, keep=lambda a: TA(a) < 0.36)
    g.opaque = False
    zband(g, 1.22, 1.26)
    return g


@piece("a_sleeve_rolled", "arms", "base", "Rolled sleeve", classes=["farmer", "labourer", "smith", "child"])
def a_sleeve_rolled():
    g = G("a_sleeve_rolled")
    g.region(["arms"], lambda a: 0.014 + 0.011 * smooth(0.36, 0.5, TA(a)), keep=lambda a: TA(a) < 0.5, lip=0.012)
    g.opaque = False
    zband(g, 1.15, 1.19)
    return g


@piece("a_sleeve_wide", "arms", "base", "Wide hanging sleeve", classes=["priest", "scholar", "noble"])
def a_sleeve_wide():
    g = G("a_sleeve_wide")
    g.region(["arms"], lambda a: 0.02 + 0.075 * TA(a) ** 1.7, keep=lambda a: TA(a) < 0.9, lip=0.012)
    g.opaque = False
    zband(g, 1.0, 1.06)
    return g


@piece("a_sleeve_puffed", "arms", "base", "Puffed sleeve", classes=["noble", "merchant", "child"])
def a_sleeve_puffed():
    g = G("a_sleeve_puffed")
    g.region(["arms"], lambda a: 0.012 + 0.04 * np.sin(np.pi * np.clip(TA(a) / 0.55, 0, 1)) * (TA(a) < 0.55) +
             0.012 * smooth(0.5, 0.58, TA(a)) * smooth(0.95, 0.7, TA(a)))
    arm_trim(g)
    return g


@piece("a_mail", "arms", "base", "Mail sleeve", classes=["guard", "soldier"], ages=("adult", "elder"))
def a_mail():
    g = G("a_mail")
    g.region(["arms"], lambda a: 0.013, keep=lambda a: TA(a) < 0.52, mat=lambda a: "Metal")
    g.opaque = False
    return g


@piece("a_rags", "arms", "base", "Ragged sleeves", classes=["slave", "elder"])
def a_rags():
    g = G("a_rags")
    g.region(["arms"], lambda a: 0.01 + 0.004 * nz(X(a), Y(a), Z(a), 1.4),
             keep=lambda a: TA(a) < 0.34 + 0.14 * nz(X(a), Y(a), Z(a), 1.9), lip=0.004)
    g.opaque = False
    return g


@piece("a_bracer", "arms", "over", "Leather bracers", classes=["smith", "guard", "soldier", "traveller", "labourer"])
def a_bracer():
    g = G("a_bracer")
    g.region(["arms"], lambda a: 0.027, keep=lambda a: (TA(a) > 0.52) & (TA(a) < 0.96), mat=lambda a: "Leather", lip=0.012)
    g.opaque = False
    return g


@piece("a_vambrace", "arms", "over", "Plate vambraces", classes=["guard", "soldier"], ages=("adult", "elder"))
def a_vambrace():
    g = G("a_vambrace")
    g.region(["arms"], lambda a: 0.036 + 0.004 * TA(a), keep=lambda a: (TA(a) > 0.42) & (TA(a) < 0.96), mat=lambda a: "Metal", lip=0.01)
    g.opaque = False
    return g


@piece("a_pauldron", "arms", "over", "Pauldrons", classes=["guard", "soldier"], ages=("adult", "elder"))
def a_pauldron():
    g = G("a_pauldron")
    keep = lambda a: ((np.abs(X(a)) > 0.165) & (Z(a) > 1.275)) & ((TA(a) < 0.26) | (Z(a) > 1.3))
    g.region(["torso", "arms"], lambda a: 0.032, keep=keep, mat=lambda a: "Metal", lip=0.014)
    g.opaque = False
    return g


# ================================================================== HANDS
@piece("h_gloves", "hands", "base", "Leather gloves", classes=["smith", "guard", "soldier", "traveller", "noble", "farmer"])
def h_gloves():
    g = G("h_gloves")
    g.region(["hands"], lambda a: 0.0045, mat=lambda a: "Leather")
    return g


@piece("h_mittens", "hands", "base", "Fur mittens", cultures=["highland", "forest", "steppe"], classes=["farmer", "labourer", "traveller", "elder", "child"])
def h_mittens():
    g = G("h_mittens")
    g.region(["hands"], lambda a: 0.009, noise=0.002)
    return g


@piece("h_gauntlets", "hands", "base", "Plate gauntlets", classes=["guard", "soldier"], ages=("adult", "elder"))
def h_gauntlets():
    g = G("h_gauntlets")
    g.region(["hands", "arms"], lambda a: np.where(Z(a) < 0.978, 0.0065, 0.027), keep=lambda a: (Z(a) < 0.99) | (TA(a) > 0.66),
             mat=lambda a: "Leather" if Z(a).mean() < 0.978 else "Metal")
    g.hides_extra = []
    return g


@piece("h_wraps", "hands", "over", "Wrist wraps", classes=["labourer", "traveller", "smith", "slave"])
def h_wraps():
    g = G("h_wraps")
    g.region(["arms"], lambda a: 0.025, keep=lambda a: TA(a) > 0.82, lip=0.01, mat=lambda a: "Stripe")
    g.opaque = False
    return g


# ================================================================== LEGS
@piece("l_trousers", "legs", "base", "Loose trousers", classes=["farmer", "labourer", "smith", "merchant", "guard", "soldier", "traveller", "scholar", "elder", "child"])
def l_trousers():
    g = G("l_trousers")
    g.region(["legs"], lambda a: 0.013 + 0.007 * smooth(0.5, 0.0, TL(a)) + 0.004 * smooth(0.3, 0.8, TL(a)) * smooth(1.0, 0.85, TL(a)))
    zband(g, 0.117, 0.165)
    return g


@piece("l_leggings", "legs", "base", "Fitted leggings", classes=["noble", "merchant", "soldier", "scholar", "smith", "child"])
def l_leggings():
    g = G("l_leggings")
    g.region(["legs"], lambda a: 0.0065)
    return g


@piece("l_breeches", "legs", "base", "Knee breeches", classes=["farmer", "labourer", "merchant", "traveller"])
def l_breeches():
    g = G("l_breeches")
    g.region(["legs"], lambda a: 0.014 + 0.016 * smooth(0.45, 0.62, TL(a)), keep=lambda a: TL(a) < 0.64, lip=0.012)
    g.opaque = False
    zband(g, 0.38, 0.43)
    return g


@piece("l_baggy", "legs", "base", "Baggy trousers", cultures=["steppe", "coastal", "imperial"], classes=["labourer", "merchant", "noble", "soldier"])
def l_baggy():
    g = G("l_baggy")
    g.region(["legs"], lambda a: 0.032 * smooth(1.0, 0.25, TL(a)) + 0.012 + 0.02 * smooth(0.05, 0.3, TL(a)) * smooth(0.85, 0.5, TL(a)))
    zband(g, 0.117, 0.17)
    return g


@piece("l_shorts", "legs", "base", "Short breeches", classes=["child", "labourer", "farmer"])
def l_shorts():
    g = G("l_shorts")
    g.region(["legs"], lambda a: 0.014, keep=lambda a: TL(a) < 0.3, lip=0.01)
    g.opaque = False
    zband(g, 0.64, 0.69)
    return g


@piece("l_greaves", "legs", "over", "Plate greaves", classes=["guard", "soldier"], ages=("adult", "elder"))
def l_greaves():
    g = G("l_greaves")
    g.region(["legs"], lambda a: 0.04 + 0.006 * smooth(0.45, 0.6, TL(a)), keep=lambda a: (TL(a) > 0.4) & (TL(a) < 0.97),
             mat=lambda a: "Metal", lip=0.01)
    g.opaque = False
    return g


@piece("l_leg_wraps", "legs", "over", "Leg wraps", classes=["labourer", "traveller", "farmer", "slave", "elder"])
def l_leg_wraps():
    g = G("l_leg_wraps")
    g.region(["legs"], lambda a: 0.009, keep=lambda a: TL(a) > 0.68, lip=0.005, mat=lambda a: "Stripe")
    g.opaque = False
    return g


@piece("l_rags", "legs", "base", "Ragged trousers", classes=["slave", "elder"])
def l_rags():
    g = G("l_rags")
    g.region(["legs"], lambda a: 0.011 + 0.005 * nz(X(a), Y(a), Z(a), 1.2), keep=lambda a: TL(a) < 0.44 + 0.14 * nz(X(a), Y(a), Z(a), 1.7),
             lip=0.004)
    g.opaque = False
    return g


# ================================================================== SKIRTS
def skirt(g, ztop, zhem, ease, flare, power=1.2, pleat=0.0, npl=24, wave=0.0):
    bv = B.subbvh("torso", "legs")

    def zfn(s, th):
        h = zhem + wave * math.sin(th * 7)
        return ztop + (h - ztop) * s

    def radd(s, th):
        return ease + flare * s ** power + pleat * math.sin(th * npl) * min(1, s * 3)
    return g.loft(bv, HIP_C, TH36, zfn, radd, 9, hullmode="top", hullmax=True)


@piece("s_skirt_long", "skirt", "over", "Long skirt", classes=["farmer", "merchant", "elder", "noble"], notes="hides legs")
def s_skirt_long():
    g = G("s_skirt_long")
    skirt(g, 0.97, 0.17, 0.034, 0.15, wave=0.01)
    zband(g, 0.15, 0.24)
    g.hides_extra = ["legs"]
    return g


@piece("s_skirt_short", "skirt", "over", "Knee-length skirt", classes=["farmer", "labourer", "child", "slave"])
def s_skirt_short():
    g = G("s_skirt_short")
    skirt(g, 0.97, 0.58, 0.034, 0.1, wave=0.012)
    zband(g, 0.56, 0.63)
    return g


@piece("s_kilt", "skirt", "over", "Pleated kilt", cultures=["highland"], classes=["farmer", "guard", "soldier", "smith", "merchant"])
def s_kilt():
    g = G("s_kilt")
    skirt(g, 0.99, 0.55, 0.034, 0.05, pleat=0.012, npl=26)
    g.fmat = ["Plaid"] * len(g.fmat)
    return g


@piece("s_robe_lower", "skirt", "over", "Robe (lower)", cultures=["imperial", "river", "steppe", "forest", "coastal"], classes=["priest", "scholar", "noble"], notes="hides legs")
def s_robe_lower():
    g = G("s_robe_lower")
    skirt(g, 1.03, 0.14, 0.052, 0.12, power=1.1, pleat=0.008, npl=14)
    zband(g, 0.14, 0.2)
    g.hides_extra = ["legs"]
    return g


@piece("s_dress_skirt", "skirt", "over", "Flared dress skirt", classes=["noble", "merchant", "elder"], notes="hides legs")
def s_dress_skirt():
    g = G("s_dress_skirt")
    skirt(g, 0.99, 0.2, 0.036, 0.26, power=1.25, pleat=0.01, npl=18, wave=0.012)
    zband(g, 0.2, 0.27)
    g.hides_extra = ["legs"]
    return g


@piece("s_tunic_skirt", "skirt", "over", "Tunic skirt (hip-length hem)", classes=["labourer", "farmer", "smith", "traveller", "child", "merchant"])
def s_tunic_skirt():
    g = G("s_tunic_skirt")
    skirt(g, 1.0, 0.6, 0.034, 0.07, wave=0.015)
    zband(g, 0.59, 0.65)
    return g


# ================================================================== FEET
@piece("f_shoes", "feet", "base", "Leather shoes", classes=["merchant", "noble", "scholar", "smith", "farmer", "child"])
def f_shoes():
    g = G("f_shoes")
    g.region(["feet"], lambda a: 0.0055 + 0.004 * smooth(0.0, 0.1, Z(a)), mat=lambda a: "Leather")
    return g


@piece("f_boots_short", "feet", "base", "Short boots", classes=["farmer", "labourer", "smith", "merchant", "guard", "soldier", "traveller", "child"])
def f_boots_short():
    g = G("f_boots_short")
    g.region(["feet", "legs"], lambda a: 0.01 + 0.018 * smooth(0.13, 0.2, Z(a)), keep=lambda a: (Z(a) < 0.3) | np.isin(a, list(B.pv["feet"])),
             mat=lambda a: "Leather", lip=0.012)
    g.opaque = False
    zband(g, 0.27, 0.31)
    g.hides_extra = ["feet"]
    return g


@piece("f_boots_tall", "feet", "base", "Tall boots", classes=["noble", "soldier", "guard", "traveller", "merchant"])
def f_boots_tall():
    g = G("f_boots_tall")
    g.region(["feet", "legs"], lambda a: 0.01 + 0.02 * smooth(0.13, 0.22, Z(a)) + 0.006 * smooth(0.25, 0.5, Z(a)), keep=lambda a: (Z(a) < 0.5) | np.isin(a, list(B.pv["feet"])),
             mat=lambda a: "Leather", lip=0.014)
    g.opaque = False
    zband(g, 0.455, 0.5)
    g.hides_extra = ["feet"]
    return g


@piece("f_sandals", "feet", "base", "Sandals", cultures=["imperial", "coastal", "steppe"], classes=["priest", "labourer", "merchant", "farmer"])
def f_sandals():
    g = G("f_sandals")
    nz0 = B.N0[:, 2]
    g.region(["feet"], lambda a: 0.012, keep=lambda a: nz0[a] < -0.35, mat=lambda a: "Leather", lip=0.004)
    g.region(["feet"], lambda a: 0.009, keep=lambda a: (nz0[a] > -0.3) & (((Y(a) > -0.04) & (Y(a) < -0.012) & (Z(a) > 0.02)) |
                                                                       ((Y(a) > 0.045) & (Z(a) > 0.02) & (Z(a) < 0.1)) |
                                                                       ((Y(a) > -0.125) & (Y(a) < -0.105) & (Z(a) < 0.07))), mat=lambda a: "Leather", lip=0.003)
    g.opaque = False
    return g


@piece("f_sabatons", "feet", "base", "Plate sabatons", classes=["guard", "soldier"], ages=("adult", "elder"))
def f_sabatons():
    g = G("f_sabatons")
    g.region(["feet", "legs"], lambda a: 0.012 + 0.016 * smooth(0.13, 0.2, Z(a)), keep=lambda a: (Z(a) < 0.2) | np.isin(a, list(B.pv["feet"])),
             mat=lambda a: "Metal", lip=0.01)
    g.opaque = False
    g.hides_extra = ["feet"]
    return g


@piece("f_wraps", "feet", "base", "Cloth foot wraps", classes=["labourer", "slave", "priest", "traveller", "elder", "farmer"])
def f_wraps():
    g = G("f_wraps")
    g.region(["feet", "legs"], lambda a: 0.0075, keep=lambda a: (Z(a) < 0.3) | np.isin(a, list(B.pv["feet"])), lip=0.005, mat=lambda a: "Stripe")
    g.opaque = False
    g.hides_extra = ["feet"]
    return g


# ================================================================== OVERLAYS
def strip(g, pts, width, ease, mat="Tint", nrows=14, bvname=("torso",), c=HIP_C, near=0.05, flat=False):
    """Band hugging the torso: pts = [(theta, z), ...] polyline; width in metres."""
    bv = B.subbvh(*bvname)
    P = np.array(pts, float)
    seg = np.linalg.norm(np.diff(P * np.array([0.16, 1.0]), axis=0), axis=1)
    cum = np.concatenate([[0], np.cumsum(seg)])
    cum /= cum[-1]

    def at(v):
        th = np.interp(v, cum, P[:, 0])
        z = np.interp(v, cum, P[:, 1])
        return th, z

    def posfn(u, v):
        th, z = at(v)
        th2, z2 = at(min(v + 0.01, 1.0)) if v < 0.99 else at(v)
        thp, zp = at(max(v - 0.01, 0.0))
        dth, dz = (th2 - thp) * 0.16, (z2 - zp)
        n = math.hypot(dth, dz) or 1.0
        nth, nzv = -dz / n, dth / n
        off = (u - 0.5) * width
        th_ = th + nth * off / 0.16
        z_ = z + nzv * off
        r = B.hull(bv, c[0], c[1], z_, th_)
        if r is None:
            r = 0.17
        r += ease
        return (c[0] + r * math.sin(th_), c[1] - r * math.cos(th_), z_)
    return g.grid(posfn, 2, nrows, mat, near=near, flat=flat)


def beltband(g, z0, z1, ease, mat, thetas=TH36, bvname=("torso", "legs"), nr=2):
    bv = B.subbvh(*bvname)
    return g.loft(bv, HIP_C, thetas, lambda s, th: z0 + (z1 - z0) * s, lambda s, th: ease, nr, mat=mat, hullmode="each")


@piece("o_belt", "overlay", "over", "Leather belt with buckle", classes=["farmer", "labourer", "smith", "merchant", "guard", "soldier", "traveller", "scholar", "child", "noble"])
def o_belt():
    g = G("o_belt")
    beltband(g, 1.05, 1.005, 0.043, "Leather")
    g.opaque = False
    r = B.hull(B.subbvh("torso", "legs"), 0, -0.009, 1.028, 0.0) or 0.12
    g.box((0, -0.009 - r - 0.047, 1.028), (0.05, 0.012, 0.042), "Metal")
    return g


@piece("o_belt_sash", "overlay", "over", "Wide cloth sash", cultures=["steppe", "coastal", "imperial", "river"], classes=["merchant", "noble", "priest", "labourer"])
def o_belt_sash():
    g = G("o_belt_sash")
    beltband(g, 1.12, 0.985, 0.056, "Tint", nr=3)
    zband(g, 0.985, 1.0)
    zband(g, 1.105, 1.12)
    g.opaque = False
    # hanging tail at the left hip
    bv = B.subbvh("torso", "legs")
    r = B.hull(bv, 0, -0.009, 0.99, 1.1) or 0.2
    th = 1.1

    def pos(u, v):
        rr = r + 0.06 + 0.02 * v
        return (rr * math.sin(th) + (u - 0.5) * 0.06 * math.cos(th), -0.009 - rr * math.cos(th) + (u - 0.5) * 0.06 * math.sin(th), 0.99 - 0.3 * v)
    g.grid(pos, 2, 6, "Tint")
    return g


@piece("o_bandolier", "overlay", "over", "Bandolier strap", classes=["soldier", "traveller", "guard"])
def o_bandolier():
    g = G("o_bandolier")
    d = math.radians
    strip(g, [(d(-62), 1.385), (d(-20), 1.28), (d(30), 1.14), (d(80), 0.99)], 0.045, 0.03, "Leather")
    strip(g, [(d(-112), 1.385), (d(-150), 1.28), (d(-200), 1.14), (d(-260), 0.99)], 0.045, 0.03, "Leather")
    g.opaque = False
    return g


@piece("o_apron", "overlay", "over", "Work apron", classes=["farmer", "labourer", "smith", "merchant", "elder"])
def o_apron():
    g = G("o_apron")
    bv = B.subbvh("torso", "legs")
    ytop = {}

    def yfront(x, z):
        loc, nor, idx, dist = bv.ray_cast(__import__("mathutils").Vector((x, -0.6, z)), __import__("mathutils").Vector((0, 1, 0)), 1.0)
        return None if loc is None else loc.y

    def pos(u, v):
        z = 1.29 - 0.84 * v
        w = 0.15 + 0.045 * smooth(1.2, 0.95, z) + 0.05 * smooth(0.95, 0.45, z)
        x = (u - 0.5) * 2 * w
        zc = max(z, 0.97)
        y = yfront(x, zc)
        if y is None:
            y = yfront(x * 0.5, zc) or -0.13
        if z < 0.97:
            y = min(y, -0.115) - 0.04 - 0.13 * (0.97 - z) / 0.5
        else:
            y -= 0.036
        return (x, y, z)
    g.grid(pos, 8, 16, "Tint", near=0.12)
    zband(g, 0.45, 0.52)
    g.opaque = False
    d = math.radians
    strip(g, [(d(-33), 1.285), (d(-22), 1.34), (d(-12), 1.41)], 0.022, 0.022, "Tint", nrows=4, bvname=("torso", "head"))
    strip(g, [(d(33), 1.285), (d(22), 1.34), (d(12), 1.41)], 0.022, 0.022, "Tint", nrows=4, bvname=("torso", "head"))
    beltband(g, 1.015, 0.985, 0.045, "Tint", nr=1)
    return g


@piece("o_tabard", "overlay", "over", "Tabard", classes=["guard", "soldier", "noble"])
def o_tabard():
    g = G("o_tabard")
    bv = B.subbvh("torso", "legs")
    Vc = __import__("mathutils").Vector

    def ysurf(x, z, front):
        if front:
            loc, nor, idx, dist = bv.ray_cast(Vc((x, -0.6, z)), Vc((0, 1, 0)), 1.0)
        else:
            loc, nor, idx, dist = bv.ray_cast(Vc((x, 0.6, z)), Vc((0, -1, 0)), 1.0)
        return None if loc is None else loc.y

    for front in (True, False):
        def pos(u, v, front=front):
            z = 1.36 - 0.8 * v
            w = 0.14 + 0.03 * smooth(1.2, 0.95, z) + 0.05 * smooth(0.95, 0.56, z)
            x = (u - 0.5) * 2 * w * (1 if front else -1)
            zc = max(z, 0.97)
            y = ysurf(x, zc, front)
            if y is None:
                y = ysurf(x * 0.5, zc, front) or (-0.13 if front else 0.12)
            s = -1 if front else 1
            if z < 0.97:
                y = s * max(abs(y), 0.115) + s * (0.07 + 0.09 * (0.97 - z) / 0.5)
            else:
                y += s * 0.07
            return (x, y, z)
        g.grid(pos, 6, 14, "Tint", near=0.12, order=1)
    zband(g, 0.56, 0.62)
    g.opaque = False
    return g


def cloak(g, ztop, zhem, spread, thetas, mat="Tint"):
    bv = B.subbvh("torso", "head")

    def zfn(s, th):
        return ztop + (zhem - ztop) * s + 0.015 * math.sin(th * 5) * s

    def radd(s, th):
        lat = 0.45 + 0.55 * abs(math.sin(th))
        return 0.065 + spread * smooth(0.0, 0.3, s) * lat + 0.11 * s ** 1.4 + 0.014 * math.sin(th * 9) * s

    return g.loft(bv, HIP_C, thetas, zfn, radd, 10, mat=mat, closed=False, hullmode="top", near=0.02)


@piece("o_cloak_long", "overlay", "over", "Long cloak", classes=["traveller", "noble", "soldier", "guard", "elder"])
def o_cloak_long():
    g = G("o_cloak_long")
    cloak(g, 1.385, 0.5, 0.095, np.linspace(0.62, 2 * math.pi - 0.62, 30))
    zband(g, 0.47, 0.55)
    zband(g, 1.34, 1.4)
    g.opaque = False
    g.box((0.0, -0.13, 1.36), (0.03, 0.012, 0.03), "Metal")
    return g


@piece("o_cape_short", "overlay", "over", "Short cape", classes=["noble", "traveller", "merchant", "soldier"])
def o_cape_short():
    g = G("o_cape_short")
    cloak(g, 1.385, 1.08, 0.075, np.linspace(0.5, 2 * math.pi - 0.5, 30))
    zband(g, 1.06, 1.12)
    zband(g, 1.34, 1.4)
    g.opaque = False
    return g


def hoodlike(g, ease_neck, ease_head, mat, open_half=0.85, open_z=1.5, ztop=1.765, trim_edge=True, top_shrink=True):
    bv = B.subbvh("torso", "head")
    z0 = 1.34

    def zfn(s, th):
        return z0 + s * (ztop - z0)

    def radd(s, th):
        return ease_neck + (ease_head - ease_neck) * smooth(0.1, 0.5, s) + 0.035 * smooth(0.35, 0.0, s) * (1 + math.cos(th - math.pi)) / 2

    def rsc(s):
        t = np.clip((z0 + s * (ztop - z0) - 1.725) / max(ztop - 1.725, 1e-3), 0, 1)
        return float(np.sqrt(max(1.0 - t ** 2, 0.0))) if t < 1 else 0.02
    rows = g.loft(bv, HEAD_C, TH36, zfn, radd, 16, mat=mat, closed=True, hullmode="each", rscale=rsc, near=0.02, zq_max=1.735)

    def inopen(c):
        th = math.atan2(c[0] - HEAD_C[0], -(c[1] - HEAD_C[1]))
        return abs(th) < open_half and c[2] > open_z and c[2] < ztop - 0.03
    g.cutfaces(inopen)
    if trim_edge:
        g.trim(lambda p: np.where(p[:, 2] > open_z - 0.02, np.abs(np.arctan2(p[:, 0] - HEAD_C[0], -(p[:, 1] - HEAD_C[1]))), 9), open_half - 0.01, open_half + 0.3)
    return rows


@piece("o_hood", "overlay", "over", "Hood with cowl", cultures=["forest", "highland", "river", "steppe"], classes=["traveller", "priest", "soldier", "elder", "slave"])
def o_hood():
    g = G("o_hood")
    hoodlike(g, 0.06, 0.03, "Tint")
    g.opaque = False
    return g


@piece("o_scarf", "overlay", "over", "Scarf", classes=["traveller", "merchant", "scholar", "elder", "child"])
def o_scarf():
    g = G("o_scarf")
    bv = B.subbvh("head", "torso")
    g.loft(bv, HEAD_C, TH28, lambda s, th: 1.415 + 0.05 * s + 0.01 * math.sin(th * 3), lambda s, th: 0.03 + 0.012 * math.sin(s * math.pi), 3,
           mat="Tint", hullmode="each", near=0.03)
    g.trim(lambda p: p[:, 2], 1.43, 1.445)
    d = math.radians
    strip(g, [(d(22), 1.43), (d(30), 1.25), (d(36), 1.05)], 0.07, 0.04, "Tint", nrows=10, bvname=("torso",))
    g.opaque = False
    return g


@piece("o_collar_fur", "overlay", "over", "Fur collar", cultures=["highland", "steppe", "forest", "imperial"], classes=["noble", "merchant", "soldier", "elder"])
def o_collar_fur():
    g = G("o_collar_fur")
    bv = B.subbvh("torso", "head")
    g.loft(bv, HIP_C, TH36, lambda s, th: 1.40 - 0.07 * s, lambda s, th: 0.03 + 0.03 * math.sin(math.pi * (0.2 + 0.6 * s)) + 0.006 * math.sin(th * 23), 3,
           mat="Tint", hullmode="each", near=0.035, rscale=None)
    g.opaque = False
    return g


@piece("o_pouch", "overlay", "over", "Belt pouch", classes=["merchant", "farmer", "traveller", "soldier", "noble"])
def o_pouch():
    g = G("o_pouch")
    bv = B.subbvh("torso", "legs")
    th = math.radians(62)
    r = B.hull(bv, 0, -0.009, 0.95, th) or 0.2
    cx, cy = (r + 0.03) * math.sin(th), -0.009 - (r + 0.03) * math.cos(th)
    g.box((cx, cy, 0.945), (0.075, 0.05, 0.085), "Leather", rot_z=-th + 0.0)
    g.box((cx + 0.0, cy, 0.99), (0.08, 0.055, 0.02), "Leather", rot_z=-th)
    g.opaque = False
    return g


@piece("o_satchel", "overlay", "over", "Satchel with strap", classes=["scholar", "merchant", "traveller"])
def o_satchel():
    g = G("o_satchel")
    d = math.radians
    strip(g, [(d(-62), 1.385), (d(-20), 1.26), (d(40), 1.1), (d(105), 0.93)], 0.05, 0.03, "Leather", nrows=16)
    bv = B.subbvh("torso", "legs")
    th = d(112)
    r = B.hull(bv, 0, -0.009, 0.92, th) or 0.2
    cx, cy = (r + 0.05) * math.sin(th), -0.009 - (r + 0.05) * math.cos(th)
    g.box((cx, cy, 0.9), (0.13, 0.06, 0.18), "Leather", rot_z=-th)
    g.box((cx, cy, 0.99), (0.14, 0.066, 0.05), "Leather", rot_z=-th)
    g.opaque = False
    return g


@piece("o_toga_drape", "overlay", "over", "Draped over-cloth", cultures=["imperial", "coastal"], classes=["noble", "scholar", "priest"])
def o_toga_drape():
    g = G("o_toga_drape")
    d = math.radians
    strip(g, [(d(58), 1.395), (d(28), 1.25), (d(-10), 1.1), (d(-60), 0.92)], 0.2, 0.034, "Tint", nrows=16)
    strip(g, [(d(118), 1.39), (d(138), 1.15), (d(155), 0.8)], 0.2, 0.034, "Tint", nrows=12)
    beltband(g, 1.0, 0.88, 0.036, "Tint", nr=2)
    zband(g, 0.88, 0.9)
    g.opaque = False
    return g


# ================================================================== HEADWEAR
def dome(g, z0, ztop, ease, mat="Tint", rscale_top=True, extra=None, nr=9, hull_z_cap=1.735):
    bv = B.subbvh("head")

    def zfn(s, th):
        return z0 + s * (ztop - z0)

    def radd(s, th):
        return ease + (extra(s, th) if extra else 0.0)

    def rsc(s):
        t = np.clip((z0 + s * (ztop - z0) - 1.725) / max(ztop - 1.725, 1e-3), 0, 1)
        return float(np.sqrt(max(1.0 - t ** 2, 0.0))) * (0.55 + 0.45 * float(np.sqrt(max(1 - t, 0)))) if t < 1 else 0.02
    return g.loft(bv, HEAD_C, TH28, zfn, radd, nr, mat=mat, hullmode="each", rscale=rsc, near=0.06, zq_max=1.735)


@piece("hw_straw_hat", "headwear", "over", "Wide straw hat", cultures=["river", "coastal", "imperial"], classes=["farmer", "labourer", "traveller"])
def hw_straw_hat():
    g = G("hw_straw_hat")
    dome(g, 1.685, 1.80, 0.02, extra=lambda s, th: 0.01 * s)
    bv = B.subbvh("head")
    for rev, dz in ((False, 0.0), (True, -0.005)):
        g.loft(bv, HEAD_C, TH28, lambda s, th, dz=dz: 1.685 - 0.035 * s * s + dz, lambda s, th: 0.02 + 0.17 * s, 3, mat="Tint", hullmode="top",
               near=0.02, reverse=rev)
    zband(g, 1.69, 1.72)
    g.opaque = False
    return g


@piece("hw_cap_soft", "headwear", "over", "Soft cap", classes=["farmer", "labourer", "merchant", "child", "noble", "scholar"])
def hw_cap_soft():
    g = G("hw_cap_soft")
    dome(g, 1.69, 1.785, 0.016, extra=lambda s, th: 0.014 * smooth(0.3, 1.0, s) * (1 + math.cos(th - math.pi)) / 2 + 0.012 * s)
    bv = B.subbvh("head")
    g.loft(bv, HEAD_C, np.linspace(-0.9, 0.9, 11), lambda s, th: 1.69 - 0.012 * s, lambda s, th: 0.016 + 0.05 * s * (1 - (th / 1.0) ** 2), 2,
           mat="Trim", closed=False, hullmode="top", near=0.02)
    g.opaque = False
    return g


@piece("hw_skullcap", "headwear", "over", "Skullcap", classes=["priest", "scholar", "soldier", "elder", "slave"])
def hw_skullcap():
    g = G("hw_skullcap")
    dome(g, 1.70, 1.77, 0.011)
    zband(g, 1.70, 1.715)
    g.opaque = False
    return g


@piece("hw_helm_open", "headwear", "over", "Open helm with nose guard", classes=["guard", "soldier"], ages=("adult", "elder"))
def hw_helm_open():
    g = G("hw_helm_open")
    dome(g, 1.655, 1.785, 0.014, mat="Metal", extra=lambda s, th: 0.01 * smooth(0.5, 0.0, s))
    zband(g, 1.655, 1.68)
    bv = B.subbvh("head")
    r = B.hull(bv, HEAD_C[0], HEAD_C[1], 1.68, 0.0) or 0.1

    def pos(u, v):
        return ((u - 0.5) * 0.016, HEAD_C[1] - r - 0.014 - 0.006 * v, 1.76 - 0.15 * v)
    g.grid(pos, 1, 4, "Metal", flat=True, near=0.02)
    g.opaque = False
    return g


@piece("hw_circlet", "headwear", "over", "Circlet", classes=["noble"])
def hw_circlet():
    g = G("hw_circlet")
    bv = B.subbvh("head")
    g.loft(bv, HEAD_C, TH28, lambda s, th: 1.70 + 0.026 * s, lambda s, th: 0.012 + 0.004 * math.sin(s * 3.14), 2, mat="Metal", hullmode="each", near=0.02)
    g.box((0, HEAD_C[1] - 0.1, 1.713), (0.018, 0.01, 0.022), "Tint") if False else None
    g.opaque = False
    return g


@piece("hw_turban", "headwear", "over", "Wrapped turban", cultures=["coastal", "steppe", "imperial"], classes=["merchant", "noble", "scholar", "priest"])
def hw_turban():
    g = G("hw_turban")
    dome(g, 1.675, 1.84, 0.03, extra=lambda s, th: 0.03 * math.sin(s * math.pi * 0.8) + 0.008 * math.sin(th * 3 + s * 9))
    zband(g, 1.675, 1.70)
    g.opaque = False
    return g


@piece("hw_fur_cone", "headwear", "over", "Fur-brimmed pointed cap", cultures=["steppe", "highland", "forest"], classes=["noble", "merchant", "labourer", "soldier"])
def hw_fur_cone():
    g = G("hw_fur_cone")
    bv = B.subbvh("head")
    r0 = [B.hull(bv, HEAD_C[0], HEAD_C[1], 1.70, th) or 0.1 for th in TH28]
    g.loft(bv, HEAD_C, TH28, lambda s, th: 1.69 + 0.25 * s, lambda s, th: 0.02 + 0.03 * smooth(0.28, 0.0, s), 8, mat="Tint", hullmode="top",
           base_r=lambda s, th: r0[int(round(th / (2 * math.pi) * 28)) % 28] * (1 - 0.97 * s ** 1.15), near=0.02)
    g.trim(lambda p: p[:, 2], 1.69, 1.74)
    g.opaque = False
    return g


@piece("hw_coif", "headwear", "over", "Mail coif", classes=["guard", "soldier"], ages=("adult", "elder"))
def hw_coif():
    g = G("hw_coif")
    hoodlike(g, 0.05, 0.016, "Metal", open_half=0.78, open_z=1.5, ztop=1.755, trim_edge=False)
    g.opaque = False
    return g
