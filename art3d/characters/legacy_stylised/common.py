"""Shared constants for the Garden of Eden base character (Blender 4.3).

Blender space: Z up, the character faces -Y, character-left is +X, 1 unit = 1 m.
FBX export (forward -Z, up Y) turns that into Unity's Y-up, character facing +Z, left = -X.
"""
import os

HERE = os.path.dirname(os.path.abspath(__file__))
EXPORT_DIR = os.path.join(HERE, "export")
PREVIEW_DIR = os.path.join(HERE, "previews")
BLEND_PATH = os.path.join(HERE, "base.blend")
FBX_PATH = os.path.join(EXPORT_DIR, "base_body.fbx")

BODY_SHAPES = [
    "Sex", "Height_Legs", "Shoulders", "Chest_Muscle", "Breast", "Waist_Slim", "Waist_Wide",
    "Belly", "Hips", "Butt", "Arms_Thick", "Legs_Thick", "Muscle", "Thin", "Heavy",
    "Age_Old", "Child", "Neck_Long",
]
FACE_SHAPES = [
    "Face_Long", "Face_Short", "Jaw_Wide", "Jaw_Square", "Chin_Pointed", "Chin_Long",
    "Cheeks_Full", "Cheekbones", "Forehead_High", "Eye_Big", "Eye_Spacing", "Brow_Ridge",
    "Nose_Bridge", "Mouth_Wide", "Lips_Full", "Ears_Back",
    "Eye_Round", "Eye_Almond", "Eye_Narrow", "Eye_Hooded", "Eye_Monolid", "Eye_TiltUp", "Eye_TiltDown",
    "Eye_Deep", "Eye_Protrude", "Eye_Height",
    "Chin_Small", "Chin_Big", "Chin_Wide", "Chin_Narrow", "Chin_Forward", "Chin_Back", "Chin_Cleft",
    "Lips_UpperFull", "Lips_LowerFull", "Lips_Thin", "Mouth_Narrow", "Lips_CupidBow", "Mouth_CornersUp",
    "Mouth_CornersDown", "Lips_Pout",
]
SPECIES_SHAPES = ["Species_Elf", "Species_Dwarf", "Species_Halfling", "Species_Orc"]
# expression / viseme keys (2026-11 face rework); the jaw opens with the Jaw bone, these are combinable with it and each other
EXPR_SHAPES = ["Mouth_Smile", "Mouth_Frown", "Mouth_O", "Mouth_E", "Mouth_MBP", "Brow_Up", "Brow_Down", "Brow_Sad",
               "Eye_Blink_L", "Eye_Blink_R", "Eye_Squint", "Cheek_Puff"]
ALL_SHAPES = BODY_SHAPES + FACE_SHAPES + SPECIES_SHAPES + EXPR_SHAPES

# Face decal UV rectangle (u0, v0, u1, v1) in the 0..1 UV square (v up). Filled in by build_base.
FACE_UV_RECT = (0.02, 0.52, 0.48, 0.98)
