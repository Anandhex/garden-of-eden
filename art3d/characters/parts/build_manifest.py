"""parts_manifest.json: every part with id, category, object/file, socket, compatibility, tags, colour slots, hat compatibility."""
import json, os
import bpy
import specs, build_nose_ear, build_hair, build_beards, build_mouth
from lib import EXPORT, HERE

ALL_SPECIES = ["human", "elf", "dwarf", "halfling", "orc"]
SPECIES_TAGS = {"elf": ["elf"], "dwarf": ["dwarf"], "orc": ["orc"], "halfling": ["halfling"], "goblin": ["orc", "halfling"], "beastkin": ["human", "orc"]}


def compat(tags, extra_species=None):
    sp = []
    for t in tags:
        sp += SPECIES_TAGS.get(t, [])
    sp = sorted(set(sp), key=ALL_SPECIES.index) if sp else list(ALL_SPECIES)
    if extra_species:
        sp = extra_species
    sexes = ["F"] if ("feminine" in tags and "masculine" not in tags) else (["M"] if ("masculine" in tags and "feminine" not in tags) else ["M", "F"])
    ages = ["child"] if "child" in tags else (["adult", "elder"] if any(t in tags for t in ("elder", "frail", "hermit", "sage", "wizard")) else ["child", "adult", "elder"])
    if "child" in tags and len(tags) > 1 and any(t in tags for t in ("common", "any")):
        ages = ["child", "adult"]
    return dict(species=sp, sexes=sexes, ages=ages)


def nkeys(name):
    ob = bpy.data.objects.get(name)
    return len(ob.data.shape_keys.key_blocks) - 1 if ob is not None and ob.data.shape_keys else 0


def hexc(c):
    return "#%02x%02x%02x" % tuple(int(round(x * 255)) for x in c)


def make(R):
    TX = "export/textures/"
    parts = []
    hair_pal = {k: hexc(v) for k, v in specs.HAIR_COLOURS.items()}
    iris_pal = {k: hexc(v) for k, v in specs.IRIS_COLOURS.items()}
    lip_pal = {k: hexc(v) for k, v in specs.LIP_TINTS.items()}
    LASH_FOR_LID = {"lashes_heavy": "full", "lashes_soft": "natural", "winged": "wing", "elf_flick": "wing", "child": "short",
                    "elder": "sparse", "tired": "sparse", "orc_rim": "short", "smoky_plum": "long", "kohl": "full"}
    # eyes
    for i, e in enumerate(specs.EYES):
        c = compat(e["tags"])
        parts.append(dict(id=f"eye_{i+1:02d}_{e['name']}", category="eyes", name=e["name"], socket=["Socket_Eye_L", "Socket_Eye_R"],
                          meshObjects=["Part_Eye_L", "Part_Eye_R"], file="../export/base_body.fbx",
                          textures=dict(eyeball=f"{TX}eyes_hd/eye_{i+1:02d}.png", makeup=f"{TX}lids/lid_{e['lid']}.png",
                                        lashes=f"../export/textures/lashes/lashes_{LASH_FOR_LID.get(e['lid'], 'natural')}.png"),
                          lashMesh=("Part_Lashes" if LASH_FOR_LID.get(e["lid"], "natural") == "natural"
                                    else "Part_Lashes_" + LASH_FOR_LID.get(e["lid"], "natural").capitalize()),
                          corneaMeshes=["Part_Cornea_L", "Part_Cornea_R"],
                          lidStyle=e["lid"], irisPattern=e["iris"].get("pat"), pupil=e["iris"].get("pupil"), highlight=e["iris"].get("hl"),
                          glow=bool(e["iris"].get("glow")), tags=e["tags"], **c,
                          colourSlots=[dict(slot="irisColor", default=specs.EYES[i]["colour"], defaultHex=iris_pal[e["colour"]], palette="iris",
                                            applies="baked into the eyeball texture (full colour); makeup decal on FaceDecalUV is optional")],
                          blendShapes="Eye_* shapes move the modelled lids, the eyeballs and corneas follow the socket; Eye_Blink_L/R, Eye_Squint close the lids; look = LeftEye/RightEye bones",
                          hat="n/a"))
    # eyebrows
    for i, b in enumerate(specs.BROWS):
        c = compat(b["tags"])
        bo = [o for o in R["brows"] if o["obj"].startswith(f"Brow_{i+1:02d}_")][0]
        parts.append(dict(id=f"brow_{i+1:02d}_{b['name']}", category="eyebrows", name=b["name"], socket=["Socket_Brow_L", "Socket_Brow_R"],
                          meshObjects=[bo["obj"]], file="export/parts_brows.fbx", texture=f"{TX}brows_hd/brow_{i+1:02d}.png",
                          legacyDecal=f"{TX}brows/brow_{i+1:02d}.png", tags=b["tags"], **c, tris=bo["tris"], shapeKeys=nkeys(bo["obj"]),
                          colourSlots=[dict(slot="browColor", default="hair", palette="hair", applies="card texture RGB x colour, A = alpha test (cutoff 0.35)")],
                          blendShapes="hair cards on the skin: follow Brow_Up/Down/Sad, Brow_Ridge, Forehead_High, Eye_* by transferred keys", hat="always compatible"))
    # mouths
    for i, m in enumerate(specs.MOUTHS):
        c = compat(m["tags"])
        lp = m["lips"]
        shp = {}
        w = lp.get("w", 0.022)
        if w > 0.0235:
            shp["Mouth_Wide"] = round(min((w - 0.022) / 0.007, 1.0), 2)
        elif w < 0.0205:
            shp["Mouth_Narrow"] = round(min((0.022 - w) / 0.006, 1.0), 2)
        tu, tl = lp.get("tu", 0.0065), lp.get("tl", 0.008)
        if tu > 0.0075:
            shp["Lips_UpperFull"] = round(min((tu - 0.0065) / 0.003, 1.0), 2)
        if tl > 0.0092:
            shp["Lips_LowerFull"] = round(min((tl - 0.008) / 0.003, 1.0), 2)
        if tu < 0.0052 and tl < 0.0065:
            shp["Lips_Thin"] = round(min((0.0065 - tu) / 0.0025, 1.0), 2)
        if lp.get("cupid", 0) > 0.0019:
            shp["Lips_CupidBow"] = round(min(lp["cupid"] / 0.003, 1.0), 2)
        cn = lp.get("corner", 0.0)
        if cn > 0.001:
            shp["Mouth_CornersUp"] = round(min(cn / 0.005, 1.0), 2)
        elif cn < -0.001:
            shp["Mouth_CornersDown"] = round(min(-cn / 0.005, 1.0), 2)
        expr = {}
        jaw = 0.0
        if m["inner"]:
            g = m["inner"].get("gap", 0.003)
            jaw = round(min(g * 1300, 14.0), 1)
            if cn > 0.002:
                expr["Mouth_Smile"] = round(min(cn / 0.005, 1.0), 2)
            if m["inner"].get("teeth") in ("gritted",):
                expr["Mouth_E"] = 0.8
            expr["Mouth_E"] = max(expr.get("Mouth_E", 0.0), 0.35)
        overlay = f"{TX}mouths/mouth_{i+1:02d}.png" if (lp.get("scar") or lp.get("lines")) else None
        d = dict(id=f"mouth_{i+1:02d}_{m['name']}", category="mouths", name=m["name"], socket=["Socket_Mouth"], meshObjects=[],
                 preset=dict(shapes=shp, expression=expr, jawOpenDeg=jaw, lipMask="export/textures/skin/head_lipmask.png",
                             note="3D mouth: shapes on Mesh_Head + Jaw bone open the real lips; lip colour = lipTint through the head lip mask"),
                 textures=dict(overlay=overlay, legacyLipsDecal=f"{TX}mouths/mouth_{i+1:02d}.png"), tags=m["tags"], **c,
                 teethMesh=(None if m["teethMesh"] == "none" else [o["obj"] for o in R["mouth"] if o.get("style") == m["teethMesh"]][0]),
                 colourSlots=[dict(slot="lipTint", default=m["tint"], defaultHex=lip_pal[m["tint"]], palette="lips",
                                   applies="lerp(albedo, albedo_luma x lipTint, lipMask x 0.8) on the head texture")],
                 blendShapes="preset weights add to the person's own Lips_*/Mouth_* weights; teeth and tongue meshes are skinned to Head/Jaw",
                 hat="always compatible")
        if m["inner"]:
            d["opensTeeth"] = True
        parts.append(d)
    for i, s in enumerate(specs.STUBBLE):
        c = compat(s["tags"])
        parts.append(dict(id=f"beard_stubble_{i+1:02d}_{s['name'][8:]}", category="beards", name=s["name"], socket=["Socket_Beard"], meshObjects=[],
                          texture=f"{TX}stubble/stubble_{i+1:02d}.png", decal=True, tags=s["tags"], **dict(c, sexes=["M"], ages=["adult", "elder"]),
                          colourSlots=[dict(slot="hairColor", default="hair", palette="hair", applies="decal RGB x colour, A = coverage")],
                          hat="always compatible"))
    # noses / ears
    for name, nm, tags in R["nose_ear"]["noses"]:
        c = compat(tags)
        parts.append(dict(id=f"nose_{name[5:7]}_{nm}", category="noses", name=nm, socket=["Socket_Nose"], meshObjects=[name], file="export/parts_noses.fbx",
                          tags=tags, **c, boundary="identical loop of 30 verts as Part_Nose, welds seamlessly", shapeKeys=nkeys(name),
                          colourSlots=[dict(slot="skin", default="skin", applies="Skin/Face materials of the head")], hat="always compatible"))
    for names, nm, tags in R["nose_ear"]["ears"]:
        c = compat(tags)
        parts.append(dict(id=f"ear_{names[0][4:6]}_{nm}", category="ears", name=nm, socket=["Socket_Ear_L", "Socket_Ear_R"], meshObjects=names,
                          file="export/parts_ears.fbx", tags=tags, **c, boundary="identical loop of 22 verts as Part_Ear_L/R", shapeKeys=nkeys(names[0]),
                          colourSlots=[dict(slot="skin", default="skin", applies="Skin material")],
                          hat="pointed elf/orc ears poke through hat brims: use hats with ear holes or hide ear" if any(t in tags for t in ("elf", "orc")) else "always compatible"))
    # hair
    hair_ids = {}
    for h in R["hair"]:
        hair_ids[(h["name"], h["hat"])] = h
    for h in R["hair"]:
        if h["hat"]:
            continue
        hat_v = hair_ids.get((h["name"], True))
        c = compat(h["tags"])
        parts.append(dict(id=h["id"], category="hair", name=h["name"], socket=["Socket_Hair"], meshObjects=[h["obj"]], file="export/parts_hair.fbx",
                          tags=h["tags"], **c, bones=h["bones"], physicsFriendly=h["long"], tris=h["tris"], shapeKeys=nkeys(h["obj"]),
                          colourSlots=[dict(slot="hairColor", default="brown", palette="hair", applies="Hair material (slot 0): hair_strands.png on flow UVs x hairColor x vertex Shade.rgb, alpha = clamp((tex.a - (1 - Shade.a)) * 3); HairCards (slot 1): hair_cards.png x hairColor, alpha test")],
                          hat=dict(compatible=not h["hasTop"], variant=(hat_v["obj"] if hat_v else None),
                                   note="flat/low variant without the top volume (buns, quiff, spikes, curls)" if hat_v else "sits under a hat as is")))
    for h in R["hair"]:
        if h["hat"]:
            parts.append(dict(id=h["id"] + "_hat", category="hair", name=h["name"] + "_hat", socket=["Socket_Hair"], meshObjects=[h["obj"]], file="export/parts_hair.fbx",
                              tags=h["tags"] + ["hat-variant"], **compat(h["tags"]), bones=h["bones"], tris=h["tris"], shapeKeys=nkeys(h["obj"]), variantOf=h["id"],
                              colourSlots=[dict(slot="hairColor", default="brown", palette="hair", applies="Hair material")], hat=dict(compatible=True, variant=None)))
    for b in R["beards"]:
        c = compat(b["tags"])
        parts.append(dict(id=b["id"], category="beards", name=b["name"], socket=["Socket_Beard"], meshObjects=[b["obj"]], file="export/parts_beards.fbx",
                          tags=b["tags"], **dict(c, sexes=["M"], ages=["adult", "elder"]), bones=b["bones"], physicsFriendly=b["long"], tris=b["tris"], shapeKeys=nkeys(b["obj"]),
                          colourSlots=[dict(slot="hairColor", default="brown", palette="hair", applies="Hair material")], hat="always compatible"))
    for o in R["mouth"]:
        parts.append(dict(id=f"mouthpart_{o['obj']}", category="mouthParts", name=o["obj"], socket=["Socket_Mouth"], meshObjects=[o["obj"]], file="export/parts_mouth.fbx",
                          kind=o["kind"], style=o.get("style"), tags=o.get("tags", []), **compat(o.get("tags", [])), bones=o["bones"], tris=o["tris"], shapeKeys=nkeys(o["obj"]),
                          colourSlots=[], hat="always compatible"))
    counts = {}
    for p in parts:
        counts[p["category"]] = counts.get(p["category"], 0) + 1
    man = dict(
        version=1, generated="build_parts.py", units="metres, Blender axes at rest (Z up, face -Y); FBX export Y-up forward -Z like base_body.fbx",
        base=dict(fbx="../export/base_body.fbx", speciesPresets="../export/species_presets.json", meta="../export/base_body_meta.json"),
        unityImport="Rig = Humanoid (copy avatar from base_body), Normals = Import, Read/Write on; Blend Shape Normals = Calculate for head-attached parts (brows, beards, noses, ears, hair) since expressions move them, None is fine for mouth parts; every part FBX contains the base Armature (bone names identical) so renderers can be re-pointed at the character's bones",
        faceDecalRect=dict(u=[0.0, 0.5], v=[0.5, 1.0], worldX=[-0.11, 0.11], worldZ=[1.50, 1.72], texturePixels=512),
        textureConventions=dict(
            brow="RGBA 512, RGB = shading, A = coverage; multiply by browColor (hair palette)",
            lids="RGBA 512, RGB = final colour of liner/shadow/lashes, A = coverage; drawn on the eye aperture only (guard mask, never across the nose bridge)",
            lips="RGBA 512, RGB = shading, A = coverage; multiply by lipTint",
            mouthInner="RGBA 512, final colours (teeth, tongue, dark), composited over lips layer",
            stubble="RGBA 512, A = hair dots; multiply by hair colour",
            iris="(legacy) RGBA 256 tint-mask iris; superseded by eyeball (eyes_hd, 512 RGB, planar front UV 0..1 of Part_Eye_L/R, iris radius 0.2 in UV) under the glossy Part_Cornea_L/R",
            lashes="RGBA 512 strand cards: upper lashes v 0.5..1, lower v 0..0.5; alpha test",
            hair="hair/hair_strands.png (+ _normal) tile on flow UVs (5 cm x 15 cm per tile, v = down the strand); hair/hair_cards.png, beard_cards.png: 4 clump columns, root v 0, tip v 1",
            browCards="brows_hd/brow_nn.png 1024x256: flush layer v 0.5..1, lifted layer v 0..0.5, u inner->outer; RGB greyscale x browColor",
            skin="skin/head_albedo_<tone>.png, head_normal/roughness/ao/cavity/lipmask.png on the head UVMap (see skin/skin_tones.json)",
            layerOrder="skin -> blush -> stubble -> brow -> lids -> lips -> mouthInner",
            colourSpace="PNGs hold display (sRGB) values: import as sRGB"),
        palettes=dict(hair=hair_pal, iris=iris_pal, lips=lip_pal),
        counts=counts,
        parts=parts)
    with open(os.path.join(EXPORT, "parts_manifest.json"), "w") as fh:
        json.dump(man, fh, indent=1)
    return man
