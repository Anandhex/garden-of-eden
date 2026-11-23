"""Blend shape deltas for the base body, as vectorised displacement fields over the rest-pose coordinates.

Every function takes numpy arrays X, Y, Z (rest pose, masculine basis, metres; +X = character left, -Y = front)
and returns (dx, dy, dz).  Shapes are relative shape keys (0..1) and are additive, so the amplitudes are kept
moderate so that combinations stay sane.
"""
import numpy as np


def S(a, b, x):
    """smoothstep from a (0) to b (1); works for a > b too."""
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def G(x, c, s):
    return np.exp(-0.5 * ((x - c) / s) ** 2)


def band(x, a0, a1, b0, b1):
    return S(a0, a1, x) * (1 - S(b0, b1, x))


Z0 = np.zeros(1)


class F:
    """Region weights shared by all shapes."""

    def __init__(self, X, Y, Z):
        self.X, self.Y, self.Z = X, Y, Z
        self.ax = np.sqrt(X * X + 0.003 ** 2) - 0.003   # smooth |X| (no kink on the midline)
        self.s = np.tanh(X / 0.006)          # smooth sign: a hard sign(X) creased the face midline (fields with s * g at x = 0)
        self.arm = S(0.17, 0.25, self.ax) * S(1.15, 1.25, Z)            # arms incl. hands (T-pose)
        self.armtube = S(0.20, 0.30, self.ax) * (1 - S(0.66, 0.72, self.ax)) * S(1.15, 1.25, Z)
        self.leg = S(0.12, 0.22, Z) * (1 - S(0.88, 0.96, Z))             # thighs..ankles
        self.front = S(0.0, -0.05, Y)
        self.back = S(0.0, 0.05, Y)
        self.head = S(1.465, 1.50, Z) * (1 - self.arm)
        self.torso = band(Z, 0.90, 0.96, 1.38, 1.43) * (1 - self.arm)


EYE_X = 0.040      # x of the eye centre in the virtual space (set by fieldmap)
Z_CHIN = 1.495
Z_EYE = 1.625
Z_MOUTH = 1.548
Z_BUST = 1.268
Z_WAIST = 1.095
Z_SHOULDER = 1.366


def zero(f):
    z = np.zeros_like(f.X)
    return z.copy(), z.copy(), z.copy()


def breast_g(f, sig=0.045):
    return np.exp(-((f.ax - 0.080) ** 2 + (f.Z - Z_BUST) ** 2) / (2 * sig ** 2)) * f.front * (1 - f.arm)


# ---------------------------------------------------------------- basis sculpt (anatomy on top of the skin mannequin)
def base_sculpt(f):
    dx, dy, dz = zero(f)
    X, Y, Z, ax, s = f.X, f.Y, f.Z, f.ax, f.s
    # glutes, calves, thighs, ribcage, trapezius: the side-view curves a straight skin tube lacks
    dy += 0.030 * G(Z, 0.885, 0.065) * G(X, 0, 0.11) * f.back
    dz += 0.004 * G(Z, 0.885, 0.065) * G(X, 0, 0.11) * f.back
    dy += 0.016 * G(Z, 0.36, 0.075) * f.back * f.leg
    dy += -0.006 * G(Z, 0.72, 0.12) * f.front * f.leg
    dy += -0.014 * G(Z, 1.27, 0.07) * f.front * (1 - f.arm)
    dy += 0.010 * G(Z, 1.30, 0.07) * f.back * (1 - f.arm)             # shoulder blades
    dy += -0.006 * G(Z, 1.04, 0.06) * f.back * (1 - f.arm)             # lumbar curve (waist back in)
    g = np.exp(-((ax - 0.11) ** 2) / (2 * 0.055 ** 2) - ((Z - 1.395) / 0.03) ** 2 / 2)
    dz += 0.026 * g * (1 - f.arm)                                       # trapezius slope
    dy += 0.008 * G(Z, 1.69, 0.05) * f.back * f.head                    # skull back
    dz += -0.018 * S(0.14, 0.23, ax) * S(1.34, 1.38, Z) * (1 - S(1.44, 1.46, Z)) * (1 - S(0.26, 0.34, ax))  # shoulder slope
    # slightly large head (stylised): scale about the head centre
    hs = 0.0 * f.head
    dx += X * hs
    dy += (Y - 0.012) * hs
    dz += (Z - 1.60) * hs
    # head: flatten the front slightly and give the cranium width
    dx += X * 0.03 * G(Z, 1.64, 0.05) * f.head
    return dx, dy, dz


# ---------------------------------------------------------------- body shapes
def sh_sex(f):
    X, Y, Z, ax, s = f.X, f.Y, f.Z, f.ax, f.s
    dx, dy, dz = zero(f)
    # vertical remap: legs, torso, head each a little shorter  (1.75 m -> ~1.65 m)
    zn = np.where(Z <= 0.90, 0.945 * Z,
         np.where(Z <= 1.495, 0.8505 + 0.955 * (Z - 0.90), 0.8505 + 0.955 * 0.595 + 0.95 * (Z - 1.495)))
    dz += zn - Z
    # shoulders narrower, arms a bit shorter and slimmer
    dx += -s * 0.014 * f.arm
    dx += -s * 0.065 * np.clip(ax - 0.17, 0, None) * f.arm
    dy += -Y * 0.08 * f.armtube
    dz += -(Z - Z_SHOULDER) * 0.08 * f.armtube
    # ribcage / waist / hips
    dx += -X * 0.075 * band(Z, 1.12, 1.22, 1.36, 1.43) * (1 - f.arm)
    dx += -s * 0.012 * band(Z, 1.30, 1.36, 1.42, 1.46) * (1 - f.arm)
    dx += -X * 0.07 * band(Z, 1.00, 1.06, 1.12, 1.18) * (1 - f.arm)
    dy += -Y * 0.06 * band(Z, 1.00, 1.06, 1.12, 1.18) * (1 - f.arm)
    hw = S(0.55, 0.88, Z) * (1 - S(0.98, 1.07, Z)) * (1 - f.arm)
    dx += s * 0.024 * hw
    dy += 0.012 * G(Z, 0.885, 0.07) * G(X, 0, 0.12) * f.back                # butt
    dy += -0.034 * breast_g(f)
    dz += 0.004 * breast_g(f)
    dx += s * 0.005 * breast_g(f)
    # legs: slimmer calves, fuller upper thighs stay
    lw = f.leg * G(Z, 0.30, 0.18)
    dx += -(X - s * 0.085) * 0.07 * lw
    dy += -Y * 0.07 * lw
    # neck and head: softer, slightly smaller
    dx += -X * 0.09 * band(Z, 1.40, 1.44, 1.50, 1.53) * (1 - f.arm)
    dy += -(Y - 0.01) * 0.09 * band(Z, 1.40, 1.44, 1.50, 1.53) * (1 - f.arm)
    dx += -X * 0.05 * f.head
    dy += -(Y - 0.01) * 0.04 * f.head
    jw = band(Z, 1.495, 1.52, 1.58, 1.62) * f.head
    dx += -X * 0.07 * jw
    dz += 0.004 * jw * f.front
    dy += 0.004 * G(Z, 1.668, 0.016) * f.front * f.head                    # softer brow
    return dx, dy, dz


def sh_height_legs(f):
    dx, dy, dz = zero(f)
    dz += 0.070 * S(0.15, 0.85, f.Z)
    return dx, dy, dz


def sh_shoulders(f):
    dx, dy, dz = zero(f)
    dx += f.s * 0.030 * f.arm
    dx += f.X * 0.16 * band(f.Z, 1.25, 1.33, 1.40, 1.45) * (1 - f.arm)
    dz += 0.004 * f.arm * G(f.ax, 0.18, 0.06)
    return dx, dy, dz


def sh_chest_muscle(f):
    dx, dy, dz = zero(f)
    g = G(f.ax, 0.075, 0.06) * G(f.Z, 1.285, 0.05) * f.front * (1 - f.arm)
    dy += -0.022 * g
    dx += f.X * 0.05 * band(f.Z, 1.15, 1.25, 1.34, 1.40) * (1 - f.arm)
    dy += -f.Y * 0.04 * band(f.Z, 1.15, 1.25, 1.34, 1.40) * (1 - f.arm)
    dz += 0.004 * g
    return dx, dy, dz


def sh_breast(f):
    dx, dy, dz = zero(f)
    g = breast_g(f)
    dy += -0.042 * g
    dz += 0.006 * g
    dx += f.s * 0.008 * g
    return dx, dy, dz


def _waist(f, k):
    dx, dy, dz = zero(f)
    w = band(f.Z, 0.97, 1.05, 1.13, 1.22) * (1 - f.arm)
    dx += f.X * 0.14 * k * w
    dy += f.Y * 0.11 * k * w
    return dx, dy, dz


def sh_waist_slim(f):
    return _waist(f, -1)


def sh_waist_wide(f):
    return _waist(f, 1)


def sh_belly(f):
    dx, dy, dz = zero(f)
    g = G(f.Z, 1.065, 0.075) * G(f.X, 0, 0.10) * f.front * (1 - f.arm)
    dy += -0.058 * g
    dz += -0.010 * g
    return dx, dy, dz


def sh_hips(f):
    dx, dy, dz = zero(f)
    w = S(0.55, 0.90, f.Z) * (1 - S(0.98, 1.07, f.Z)) * (1 - f.arm)
    dx += f.s * 0.028 * w
    return dx, dy, dz


def sh_butt(f):
    dx, dy, dz = zero(f)
    g = G(f.Z, 0.885, 0.07) * G(f.X, 0, 0.11) * f.back
    dy += 0.042 * g
    dz += 0.008 * g
    return dx, dy, dz


def _arms(f, k):
    dx, dy, dz = zero(f)
    dy += f.Y * k * f.armtube
    dz += (f.Z - Z_SHOULDER) * k * f.armtube
    return dx, dy, dz


def _legs(f, k):
    dx, dy, dz = zero(f)
    dx += (f.X - f.s * 0.085) * k * f.leg
    dy += f.Y * k * f.leg
    return dx, dy, dz


def sh_arms_thick(f):
    return _arms(f, 0.34)


def sh_legs_thick(f):
    return _legs(f, 0.30)


def sh_muscle(f):
    dx, dy, dz = zero(f)
    a = _arms(f, 0.14)
    l = _legs(f, 0.0)
    wl = f.leg * (0.6 * G(f.Z, 0.72, 0.13) + 0.8 * G(f.Z, 0.36, 0.09))
    dx += a[0] + (f.X - f.s * 0.085) * 0.14 * wl
    dy += a[1] + f.Y * 0.14 * wl
    dz += a[2]
    c = band(f.Z, 1.15, 1.25, 1.34, 1.40) * (1 - f.arm)
    dx += f.X * 0.05 * c
    dy += -0.010 * G(f.ax, 0.07, 0.06) * G(f.Z, 1.285, 0.05) * f.front * (1 - f.arm)
    dx += f.s * 0.012 * f.arm * G(f.ax, 0.20, 0.05)                          # deltoids
    dx += -f.X * 0.04 * band(f.Z, 1.00, 1.06, 1.12, 1.18) * (1 - f.arm)        # V taper
    dx += f.X * 0.12 * band(f.Z, 1.41, 1.45, 1.50, 1.53) * (1 - f.arm)         # neck / trapezius
    dz += 0.006 * G(f.ax, 0.09, 0.04) * G(f.Z, 1.395, 0.03) * (1 - f.arm)
    return dx, dy, dz


def sh_thin(f):
    dx, dy, dz = zero(f)
    a = _arms(f, -0.22)
    l = _legs(f, -0.22)
    dx += l[0]
    dy += a[1] + l[1]
    dz += a[2]
    dx += -f.X * 0.13 * f.torso
    dy += -f.Y * 0.12 * f.torso
    dx += -f.X * 0.10 * band(f.Z, 1.41, 1.45, 1.50, 1.53) * (1 - f.arm)
    return dx, dy, dz


def sh_heavy(f):
    dx, dy, dz = zero(f)
    a = _arms(f, 0.30)
    l = _legs(f, 0.32)
    dx += l[0]
    dy += a[1] + l[1]
    dz += a[2]
    dx += f.X * 0.20 * f.torso
    dy += f.Y * 0.22 * f.torso
    g = G(f.Z, 1.06, 0.08) * G(f.X, 0, 0.12) * f.front * (1 - f.arm)
    dy += -0.030 * g
    dx += f.X * 0.12 * band(f.Z, 1.40, 1.45, 1.50, 1.53) * (1 - f.arm)
    dx += f.X * 0.10 * band(f.Z, 1.50, 1.54, 1.62, 1.66) * f.head          # fuller cheeks
    dz += -0.008 * G(f.Z, 1.50, 0.02) * f.front * f.head * G(f.X, 0, 0.05)  # soft chin
    return dx, dy, dz


def sh_age_old(f):
    dx, dy, dz = zero(f)
    t = S(1.0, 1.5, f.Z)
    dy += -0.085 * t ** 1.5
    dy += -0.040 * S(1.45, 1.53, f.Z)
    dz += -0.018 * t - 0.010 * S(1.45, 1.53, f.Z)
    dz += -0.014 * f.arm * G(f.ax, 0.22, 0.12)
    g = breast_g(f)
    dz += -0.014 * g
    dy += -0.008 * G(f.Z, 1.06, 0.08) * G(f.X, 0, 0.12) * f.front * (1 - f.arm)
    dx += -f.X * 0.04 * band(f.Z, 1.41, 1.45, 1.50, 1.53) * (1 - f.arm)
    dx += -f.X * 0.05 * f.torso
    return dx, dy, dz


def sh_child(f):
    X, Y, Z, ax, s = f.X, f.Y, f.Z, f.ax, f.s
    dx, dy, dz = zero(f)
    zleg, ztorso_top = 0.78, 0.702 + 0.595 * 0.88
    zn = np.where(Z <= 0.90, zleg * Z, np.where(Z <= 1.495, 0.702 + 0.88 * (Z - 0.90), ztorso_top))
    hs = 1.13
    head = Z > 1.495
    zn = np.where(head, ztorso_top + hs * (Z - 1.495), zn)
    dz += zn - Z
    # head bigger, face features rounder
    hm = S(1.47, 1.52, Z) * (1 - f.arm)
    dx += X * (hs - 1) * hm
    dy += (Y - 0.01) * (hs - 1) * hm
    # arms shorter and thinner; torso narrower, rounder
    dx += -s * 0.22 * np.clip(ax - 0.17, 0, None) * f.arm
    dx += -s * 0.02 * f.arm
    dy += -Y * 0.10 * f.armtube
    dz += -(Z - Z_SHOULDER) * 0.10 * f.armtube
    dx += -X * 0.10 * f.torso
    dy += -0.014 * G(Z, 1.06, 0.1) * G(X, 0, 0.12) * f.front * (1 - f.arm)
    dx += -(X - s * 0.085) * 0.05 * f.leg
    return dx, dy, dz


def sh_neck_long(f):
    dx, dy, dz = zero(f)
    dz += 0.040 * S(1.43, 1.51, f.Z) * (1 - f.arm)
    dx += -f.X * 0.06 * band(f.Z, 1.40, 1.44, 1.50, 1.53) * (1 - f.arm)
    return dx, dy, dz


# ---------------------------------------------------------------- face shapes
def chin_w(f):
    return (1 - S(1.52, 1.64, f.Z)) * S(1.475, 1.505, f.Z) * S(0.03, -0.03, f.Y) * f.head


def sh_face_long(f):
    dx, dy, dz = zero(f)
    dz += -0.020 * chin_w(f)
    dz += 0.006 * S(1.66, 1.74, f.Z) * f.head
    return dx, dy, dz


def sh_face_short(f):
    dx, dy, dz = zero(f)
    dz += 0.022 * chin_w(f)
    dz += -0.004 * S(1.66, 1.74, f.Z) * f.head
    return dx, dy, dz


def sh_jaw_wide(f):
    dx, dy, dz = zero(f)
    jw = band(f.Z, 1.495, 1.53, 1.58, 1.62) * S(0.06, -0.04, f.Y) * f.head
    dx += f.X * 0.17 * jw
    return dx, dy, dz


def sh_jaw_square(f):
    dx, dy, dz = zero(f)
    jw = band(f.Z, 1.495, 1.52, 1.56, 1.60) * S(0.05, -0.03, f.Y) * f.head
    dx += f.X * 0.12 * jw
    dz += -0.013 * S(0.03, 0.065, f.ax) * jw
    dz += 0.004 * (1 - S(0.0, 0.04, f.ax)) * jw
    return dx, dy, dz


def sh_chin_pointed(f):
    dx, dy, dz = zero(f)
    cw = (1 - S(1.515, 1.575, f.Z)) * S(0.0, -0.04, f.Y) * S(1.48, 1.51, f.Z) * f.head
    dx += -f.X * 0.38 * cw
    dy += -0.012 * cw
    dz += -0.008 * cw
    return dx, dy, dz


def sh_chin_long(f):
    dx, dy, dz = zero(f)
    cw = (1 - S(1.515, 1.575, f.Z)) * S(0.0, -0.04, f.Y) * S(1.48, 1.51, f.Z) * f.head
    dz += -0.024 * cw
    dy += -0.004 * cw
    return dx, dy, dz


def sh_cheeks_full(f):
    dx, dy, dz = zero(f)
    g = np.exp(-((f.ax - 0.062) ** 2 + (f.Z - 1.565) ** 2) / (2 * 0.035 ** 2)) * f.front * f.head
    dx += f.s * 0.011 * g
    dy += -0.012 * g
    return dx, dy, dz


def sh_cheekbones(f):
    dx, dy, dz = zero(f)
    g1 = np.exp(-((f.ax - 0.078) ** 2 + (f.Z - 1.605) ** 2) / (2 * 0.03 ** 2)) * f.head
    g2 = np.exp(-((f.ax - 0.052) ** 2 + (f.Z - 1.552) ** 2) / (2 * 0.03 ** 2)) * f.front * f.head
    dx += f.s * 0.008 * g1 - f.s * 0.007 * g2
    dz += 0.004 * g1
    dy += -0.003 * g1 * f.front
    return dx, dy, dz


def sh_forehead_high(f):
    dx, dy, dz = zero(f)
    dz += 0.026 * S(1.60, 1.72, f.Z) * f.head
    dy += -0.005 * G(f.Z, 1.69, 0.04) * f.front * f.head
    return dx, dy, dz


def sh_eye_big(f):
    dx, dy, dz = zero(f)
    r2 = (f.ax - EYE_X) ** 2 + (f.Z - Z_EYE) ** 2
    g = np.exp(-r2 / (2 * 0.032 ** 2)) * f.front * f.head
    dx += (f.ax - EYE_X) * f.s * 0.28 * g
    dz += (f.Z - Z_EYE) * 0.28 * g
    return dx, dy, dz


def sh_eye_spacing(f):
    dx, dy, dz = zero(f)
    dx += f.s * 0.008 * G(f.Z, Z_EYE, 0.04) * S(0.0, -0.04, f.Y) * f.head
    return dx, dy, dz


def sh_brow_ridge(f):
    dx, dy, dz = zero(f)
    dy += -0.013 * G(f.Z, 1.668, 0.016) * (1 - S(0.05, 0.085, f.ax)) * f.front * f.head
    return dx, dy, dz


def sh_nose_bridge(f):
    dx, dy, dz = zero(f)
    g = G(f.X, 0, 0.02) * G(f.Z, 1.60, 0.03) * f.front * f.head
    dy += -0.008 * g
    return dx, dy, dz


def sh_mouth_wide(f):
    dx, dy, dz = zero(f)
    mg = G(f.Z, Z_MOUTH, 0.02) * f.front * (1 - S(0.05, 0.08, f.ax)) * f.head
    dx += f.X * 0.22 * mg
    return dx, dy, dz


def sh_lips_full(f):
    dx, dy, dz = zero(f)
    g = G(f.Z, 1.546, 0.016) * f.front * (1 - S(0.035, 0.06, f.ax)) * f.head
    dy += -0.008 * g
    return dx, dy, dz


def sh_ears_back(f):
    dx, dy, dz = zero(f)
    g = G(f.Z, 1.60, 0.035) * S(0.05, 0.075, f.ax) * f.head
    dy += 0.014 * g
    dx += -f.s * 0.003 * g
    return dx, dy, dz


FUNCS = {
    "Height_Legs": sh_height_legs, "Shoulders": sh_shoulders, "Chest_Muscle": sh_chest_muscle,
    "Breast": sh_breast, "Waist_Slim": sh_waist_slim, "Waist_Wide": sh_waist_wide, "Belly": sh_belly,
    "Hips": sh_hips, "Butt": sh_butt, "Arms_Thick": sh_arms_thick, "Legs_Thick": sh_legs_thick,
    "Muscle": sh_muscle, "Thin": sh_thin, "Heavy": sh_heavy, "Age_Old": sh_age_old, "Child": sh_child,
    "Neck_Long": sh_neck_long,
    "Face_Long": sh_face_long, "Face_Short": sh_face_short, "Jaw_Wide": sh_jaw_wide,
    "Jaw_Square": sh_jaw_square, "Chin_Pointed": sh_chin_pointed, "Chin_Long": sh_chin_long,
    "Cheeks_Full": sh_cheeks_full, "Cheekbones": sh_cheekbones, "Forehead_High": sh_forehead_high,
    "Eye_Big": sh_eye_big, "Eye_Spacing": sh_eye_spacing, "Brow_Ridge": sh_brow_ridge,
    "Nose_Bridge": sh_nose_bridge, "Mouth_Wide": sh_mouth_wide, "Lips_Full": sh_lips_full,
    "Ears_Back": sh_ears_back,
}


# ---------------------------------------------------------------- eye shapes (act on the eye-socket / decal area)
def eye_g(f):
    ex = f.ax - EYE_X                       # >0 toward the outer corner
    ez = f.Z - Z_EYE
    g = np.exp(-(ex ** 2) / (2 * 0.034 ** 2) - ez ** 2 / (2 * 0.026 ** 2)) * f.front * f.head
    return ex, ez, g


def sh_eye_round(f):
    dx, dy, dz = zero(f); ex, ez, g = eye_g(f)
    dz += ez * 0.32 * g
    dx += -f.s * ex * 0.10 * g
    return dx, dy, dz


def sh_eye_almond(f):
    dx, dy, dz = zero(f); ex, ez, g = eye_g(f)
    dx += f.s * ex * 0.14 * g
    dz += -ez * 0.08 * g + 0.0025 * np.clip(ex / 0.03, -1, 1) * g
    return dx, dy, dz


def sh_eye_narrow(f):
    dx, dy, dz = zero(f); ex, ez, g = eye_g(f)
    dz += -ez * 0.38 * g
    return dx, dy, dz


def sh_eye_hooded(f):
    dx, dy, dz = zero(f); ex, ez, g = eye_g(f)
    dz += -0.007 * S(-0.004, 0.022, ez) * g
    dy += -0.002 * S(0.0, 0.03, ez) * g
    return dx, dy, dz


def sh_eye_monolid(f):
    dx, dy, dz = zero(f); ex, ez, g = eye_g(f)
    dz += -0.008 * S(-0.006, 0.020, ez) * g - ez * 0.12 * g
    dy += 0.004 * S(0.015, 0.04, ez) * g
    dx += f.s * ex * 0.06 * g
    return dx, dy, dz


def sh_eye_tilt_up(f):
    dx, dy, dz = zero(f); ex, ez, g = eye_g(f)
    dz += 0.0085 * np.clip(ex / 0.03, -1.2, 1.2) * g
    return dx, dy, dz


def sh_eye_tilt_down(f):
    dx, dy, dz = zero(f); ex, ez, g = eye_g(f)
    dz += -0.0085 * np.clip(ex / 0.03, -1.2, 1.2) * g
    return dx, dy, dz


def sh_eye_deep(f):
    dx, dy, dz = zero(f); ex, ez, g = eye_g(f)
    dy += 0.0050 * g
    dy += -0.003 * G(f.Z, 1.664, 0.012) * (1 - S(0.05, 0.085, f.ax)) * f.front * f.head
    return dx, dy, dz


def sh_eye_protrude(f):
    dx, dy, dz = zero(f); ex, ez, g = eye_g(f)
    dy += -0.006 * g
    return dx, dy, dz


def sh_eye_height(f):
    dx, dy, dz = zero(f)
    g = G(f.Z, Z_EYE + 0.01, 0.05) * (1 - S(0.065, 0.09, f.ax)) * f.front * f.head
    dz += 0.012 * g
    return dx, dy, dz


# ---------------------------------------------------------------- chin shapes
def chin_g(f):
    return (1 - S(1.515, 1.575, f.Z)) * S(0.0, -0.04, f.Y) * S(1.48, 1.51, f.Z) * f.head


def sh_chin_small(f):
    dx, dy, dz = zero(f); cw = chin_g(f)
    dx += -f.X * 0.20 * cw
    dy += -(f.Y + 0.035) * 0.20 * cw
    dz += -(f.Z - 1.530) * 0.20 * cw
    return dx, dy, dz


def sh_chin_big(f):
    dx, dy, dz = zero(f); cw = chin_g(f)
    dx += f.X * 0.22 * cw
    dy += (f.Y + 0.035) * 0.22 * cw
    dz += (f.Z - 1.530) * 0.22 * cw - 0.004 * cw
    return dx, dy, dz


def sh_chin_wide(f):
    dx, dy, dz = zero(f); cw = chin_g(f)
    dx += f.X * 0.32 * cw
    return dx, dy, dz


def sh_chin_narrow(f):
    dx, dy, dz = zero(f); cw = chin_g(f)
    dx += -f.X * 0.30 * cw
    return dx, dy, dz


def sh_chin_forward(f):
    dx, dy, dz = zero(f); cw = chin_g(f)
    dy += -0.015 * cw
    return dx, dy, dz


def sh_chin_back(f):
    dx, dy, dz = zero(f); cw = chin_g(f)
    dy += 0.013 * cw
    return dx, dy, dz


def sh_chin_cleft(f):
    dx, dy, dz = zero(f)
    g = G(f.X, 0, 0.010) * G(f.Z, 1.522, 0.014) * f.front * f.head
    dy += 0.0065 * g
    dy += -0.0025 * G(f.ax, 0.020, 0.010) * G(f.Z, 1.522, 0.014) * f.front * f.head
    return dx, dy, dz


# ---------------------------------------------------------------- lips / mouth shapes
def lip_x(f):
    return f.front * (1 - S(0.035, 0.06, f.ax)) * f.head


def sh_lips_upper_full(f):
    dx, dy, dz = zero(f)
    g = G(f.Z, 1.554, 0.008) * lip_x(f)
    dy += -0.006 * g
    dz += 0.0018 * g
    return dx, dy, dz


def sh_lips_lower_full(f):
    dx, dy, dz = zero(f)
    g = G(f.Z, 1.537, 0.009) * lip_x(f)
    dy += -0.007 * g
    dz += -0.0018 * g
    return dx, dy, dz


def sh_lips_thin(f):
    dx, dy, dz = zero(f)
    g = G(f.Z, 1.546, 0.015) * lip_x(f)
    dy += 0.004 * g
    dz += -(f.Z - 1.546) * 0.28 * g
    return dx, dy, dz


def sh_mouth_narrow(f):
    dx, dy, dz = zero(f)
    mg = G(f.Z, Z_MOUTH, 0.02) * f.front * (1 - S(0.05, 0.08, f.ax)) * f.head
    dx += -f.X * 0.22 * mg
    return dx, dy, dz


def sh_lips_cupid_bow(f):
    dx, dy, dz = zero(f)
    g = G(f.Z, 1.557, 0.006) * lip_x(f)
    dz += 0.0035 * g * G(f.ax, 0.009, 0.007)
    dy += -0.004 * g * G(f.ax, 0.009, 0.007)
    dz += -0.0025 * g * G(f.ax, 0.0, 0.004)       # central dip
    return dx, dy, dz


def sh_mouth_corners_up(f):
    dx, dy, dz = zero(f)
    dz += 0.006 * S(0.012, 0.032, f.ax) * G(f.Z, 1.546, 0.012) * lip_x(f)
    return dx, dy, dz


def sh_mouth_corners_down(f):
    dx, dy, dz = zero(f)
    dz += -0.006 * S(0.012, 0.032, f.ax) * G(f.Z, 1.546, 0.012) * lip_x(f)
    return dx, dy, dz


def sh_lips_pout(f):
    dx, dy, dz = zero(f)
    g = G(f.Z, 1.546, 0.017) * lip_x(f)
    dy += -0.009 * g
    dx += -f.X * 0.05 * g
    return dx, dy, dz


FUNCS.update({
    "Eye_Round": sh_eye_round, "Eye_Almond": sh_eye_almond, "Eye_Narrow": sh_eye_narrow, "Eye_Hooded": sh_eye_hooded,
    "Eye_Monolid": sh_eye_monolid, "Eye_TiltUp": sh_eye_tilt_up, "Eye_TiltDown": sh_eye_tilt_down,
    "Eye_Deep": sh_eye_deep, "Eye_Protrude": sh_eye_protrude, "Eye_Height": sh_eye_height,
    "Chin_Small": sh_chin_small, "Chin_Big": sh_chin_big, "Chin_Wide": sh_chin_wide, "Chin_Narrow": sh_chin_narrow,
    "Chin_Forward": sh_chin_forward, "Chin_Back": sh_chin_back, "Chin_Cleft": sh_chin_cleft,
    "Lips_UpperFull": sh_lips_upper_full, "Lips_LowerFull": sh_lips_lower_full, "Lips_Thin": sh_lips_thin,
    "Mouth_Narrow": sh_mouth_narrow, "Lips_CupidBow": sh_lips_cupid_bow, "Mouth_CornersUp": sh_mouth_corners_up,
    "Mouth_CornersDown": sh_mouth_corners_down, "Lips_Pout": sh_lips_pout,
})
