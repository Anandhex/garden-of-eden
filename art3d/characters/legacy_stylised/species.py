"""Species presets for the talking peoples (packages/server/src/world/species.ts): human, elf, dwarf, halfling, orc.

Each non-human species is ONE extra shape key (`Species_<Id>`) on the shared topology: a fixed mix of the existing body/face
keys (so it composes with them) plus a few species-only fields (hands, feet, nose, jaw).  Human is the base (all keys 0).
Heights are set with a uniform root scale (see export/species_presets.json) so the joint offsets stay small.
"""
import numpy as np
from shapes import S, G

SPECIES_SHAPES = ["Species_Elf", "Species_Dwarf", "Species_Halfling", "Species_Orc"]

# weight of each existing key inside the species key (negative = opposite direction)
MIX = {
    "Species_Elf": {"Thin": 0.55, "Height_Legs": 0.55, "Neck_Long": 0.9, "Face_Long": 0.35, "Chin_Pointed": 0.30,
                    "Cheekbones": 0.8, "Eye_Big": 0.35, "Eye_Almond": 0.7, "Eye_TiltUp": 0.55, "Lips_Thin": 0.25,
                    "Jaw_Wide": -0.35, "Nose_Bridge": 0.35, "Arms_Thick": -0.25, "Shoulders": -0.3, "Cheeks_Full": -0.3},
    "Species_Dwarf": {"Heavy": 0.5, "Muscle": 0.5, "Shoulders": 0.5, "Arms_Thick": 0.45, "Legs_Thick": 0.7,
                      "Chest_Muscle": 0.5, "Waist_Wide": 0.5, "Height_Legs": -0.8, "Neck_Long": -0.6, "Brow_Ridge": 0.5,
                      "Jaw_Wide": 0.45, "Jaw_Square": 0.5, "Chin_Big": 0.4, "Cheeks_Full": 0.3, "Face_Short": 0.3},
    "Species_Halfling": {"Child": 0.35, "Cheeks_Full": 0.9, "Heavy": 0.3, "Eye_Big": 0.25, "Eye_Round": 0.3,
                         "Chin_Small": 0.3, "Lips_Pout": 0.3, "Height_Legs": -0.2, "Neck_Long": -0.4},
    "Species_Orc": {"Heavy": 0.35, "Muscle": 0.6, "Shoulders": 0.5, "Chest_Muscle": 0.55, "Arms_Thick": 0.4,
                    "Legs_Thick": 0.45, "Neck_Long": -0.6, "Brow_Ridge": 1.0, "Jaw_Square": 1.0, "Jaw_Wide": 0.6,
                    "Chin_Big": 0.9, "Chin_Forward": 0.9, "Chin_Wide": 0.5, "Mouth_Wide": 0.5, "Face_Short": 0.3,
                    "Eye_Narrow": 0.3, "Eye_Deep": 0.5, "Lips_LowerFull": 0.5, "Forehead_High": -0.4, "Nose_Bridge": -0.4},
}
# target heights in metres of a masculine adult at Sex 0 (feminine ~ 94 %)
HEIGHT_M = {"human": 1.75, "elf": 1.95, "dwarf": 1.30, "halfling": 1.05, "orc": 2.05}


def _extra(name, fm, Pm):
    """Species-only displacement fields in real space, built from the virtual-space coordinates of the field map."""
    Pv = fm.Pv
    X, Y, Z = Pv[:, 0], Pv[:, 1], Pv[:, 2]
    ax, s = np.abs(X), np.sign(X)
    D = np.zeros((len(Pm), 3))
    hand = (fm.w_arm > 0.5) & (ax > 0.62)
    foot = Z < 0.10
    nose = G(X, 0, 0.03) * G(Z, 1.585, 0.035) * (Y < 0.0) * (Z > 1.54)
    if name == "Species_Dwarf":
        w = S(0.64, 0.70, ax) * (fm.w_arm > 0.5)
        cw = np.array([0.0, 0.0, 1.366])
        D_v = np.zeros_like(Pv)
        D_v[:, 0] = s * (ax - 0.70) * 0.28 * w
        D_v[:, 1] = Y * 0.20 * w
        D_v[:, 2] = (Z - 1.366) * 0.28 * w
        D = np.einsum('nij,nj->ni', fm.Jinv, D_v)
    elif name == "Species_Halfling":
        w = S(0.12, 0.04, Z)
        D_v = np.zeros_like(Pv)
        D_v[:, 0] = (ax - 0.09) * s * 0.20 * w
        D_v[:, 1] = Y * 0.20 * w
        D = np.einsum('nij,nj->ni', fm.Jinv, D_v)
        D += 0.0
    elif name == "Species_Orc":
        D_v = np.zeros_like(Pv)
        # flatter, wider nose, forward lower jaw teeth line, bigger hands
        hw = S(0.64, 0.70, ax) * (fm.w_arm > 0.5)
        D_v[:, 0] += s * (ax - 0.70) * 0.18 * hw
        D_v[:, 2] += (Z - 1.366) * 0.18 * hw
        D_v[:, 1] += Y * 0.12 * hw
        D = np.einsum('nij,nj->ni', fm.Jinv, D_v)
    elif name == "Species_Elf":
        D_v = np.zeros_like(Pv)
        hw = S(0.64, 0.70, ax) * (fm.w_arm > 0.5)
        D_v[:, 0] += s * (ax - 0.70) * 0.12 * hw       # longer hands
        D_v[:, 1] += -Y * 0.10 * hw
        D = np.einsum('nij,nj->ni', fm.Jinv, D_v)
    return D


def delta(name, DELTAS, Pm, fm):
    D = np.zeros((len(Pm), 3))
    for k, w in MIX[name].items():
        D += w * DELTAS[k]
    D += _extra(name, fm, Pm)
    return D


# preview / runtime skin ranges (linear sRGB-ish display colours) and which swappable parts each people uses
SKIN = {
    "human": [[0.93, 0.66, 0.52], [0.62, 0.40, 0.30], [0.98, 0.78, 0.66]],
    "elf": [[0.96, 0.80, 0.70], [0.88, 0.72, 0.60], [0.92, 0.82, 0.78]],
    "dwarf": [[0.90, 0.60, 0.48], [0.80, 0.52, 0.40], [0.95, 0.70, 0.56]],
    "halfling": [[0.94, 0.68, 0.54], [0.85, 0.58, 0.44], [0.98, 0.76, 0.62]],
    "orc": [[0.50, 0.66, 0.38], [0.56, 0.60, 0.50], [0.42, 0.56, 0.36]],
}
PARTS = {
    "human": {"ears": ["Part_Ear_L", "Part_Ear_R"], "nose": ["Part_Nose"], "extra": []},
    "elf": {"ears": ["Part_Ear_Elf_A_L", "Part_Ear_Elf_A_R"], "earVariants": ["A", "B", "C"], "nose": ["Part_Nose_Elf"], "extra": []},
    "dwarf": {"ears": ["Part_Ear_L", "Part_Ear_R"], "nose": ["Part_Nose_Dwarf"], "extra": []},
    "halfling": {"ears": ["Part_Ear_L", "Part_Ear_R"], "nose": ["Part_Nose"], "extra": []},
    "orc": {"ears": ["Part_Ear_L", "Part_Ear_R"], "nose": ["Part_Nose_Orc"], "extra": ["Part_Tusk_A_L", "Part_Tusk_A_R"],
            "tuskVariants": ["A", "B"]},
}


def presets(Vm, Vf, DELTAS):
    """species_presets.json: shape weights, uniform root scale to reach the target height, skin ranges, parts."""
    out = {}
    for sp in ("human", "elf", "dwarf", "halfling", "orc"):
        key = "Species_" + sp.capitalize()
        D = DELTAS[key] if key in DELTAS else 0.0
        hm = float((Vm + D)[:, 2].max())
        hf = float((Vf + D)[:, 2].max())
        out[sp] = {
            "shapes": {key: 1.0} if key in DELTAS else {},
            "heightM": HEIGHT_M[sp], "heightF": round(HEIGHT_M[sp] * 0.943, 3),
            "meshHeightM": round(hm, 4), "meshHeightF": round(hf, 4),
            "rootScaleM": round(HEIGHT_M[sp] / hm, 4), "rootScaleF": round(HEIGHT_M[sp] * 0.943 / hf, 4),
            "skin": SKIN[sp], "parts": PARTS[sp],
        }
    return out
