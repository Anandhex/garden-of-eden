# Species definitions for monsters.py (exec'd inside it; shares its namespace).
# Coordinates are base-mesh metres before the final height scale (human head ~0.21 m wide, 1.75 m tall).


def hu(ctx):
    return head_frame(ctx)


def finish_part(ctx, ob, swatch, bone="Head"):
    set_swatch(ob, swatch)
    if not ob.vertex_groups:
        weight_all(ob, bone, ctx["arm"])
    ob.data.materials.clear()
    ob.data.materials.append(ctx["mat"])
    return ob


def snout(ctx, name, length, w0, h0, w1, h1, dz=0.0, droop=0.0, expo=2.3, swatch="skin", nose=True, nose_r=0.02, jaw=0.0):
    """Muzzle lofted forward (-Y) from the nose; w/h = full widths/heights. Optional nose pad."""
    hf = head_frame(ctx)
    y0 = hf["nose"].y + 0.03
    z0 = hf["nose"].z + dz
    rings = []
    ts = [0.0, 0.3, 0.6, 0.85, 0.96, 1.0]
    rd = [1.0, 1.0, 1.0, 0.97, 0.82, 0.55]
    for t, k in zip(ts, rd):
        c = (0, y0 - (length + 0.03) * t, z0 - droop * t * t)
        w = (w0 + (w1 - w0) * t) / 2 * k
        h = (h0 + (h1 - h0) * t) / 2 * k
        rings.append((c, w, h))
    ob = loft(name, ctx["arm"], rings, ctx["mat"], expo=expo)
    finish_part(ctx, ob, swatch)
    out = [ob]
    if nose:
        c = rings[-1][0]
        pad = ellipsoid_mesh(name + "Nose", (c[0], c[1] - nose_r * 0.4, c[2] + rings[-1][2] * 0.35), (nose_r * 1.4, nose_r * 0.9, nose_r), seg=10, rings=5)
        weight_all(pad, "Head", ctx["arm"]); finish_part(ctx, pad, "dark"); out.append(pad)
    return out


def horns(ctx, name, up, out_, back, r, curve, swatch="horn", z=0.0, y=0.0, x=0.0, tip_r=0.008):
    hf = head_frame(ctx)
    res = []
    for sgn, side in ((1, "L"), (-1, "R")):
        base = Vector((sgn * (hf["hw"] * 0.55 + x), hf["top"].y + 0.03 + y, hf["top"].z - 0.04 + z))
        tip = base + Vector((sgn * out_, back, up))
        h = cone_mesh("%s_%s" % (name, side), base, tip, r, tip_r, sides=8, rings=5, bend=Vector((sgn * curve[0], curve[1], curve[2])))
        weight_all(h, "Head", ctx["arm"]); finish_part(ctx, h, swatch); res.append(h)
    return res


def ears_blob(ctx, name, size, out_, up, tilt=0.0, swatch="skin", fl=0.25, y=0.0):
    hf = head_frame(ctx)
    res = []
    for sgn, side in ((1, "L"), (-1, "R")):
        c = Vector((sgn * (hf["hw"] + out_), hf["ear_l"].y + y, hf["ear_l"].z + up))
        e = ellipsoid_mesh("%s_%s" % (name, side), tuple(c), (size * fl, size * 0.55, size), seg=10, rings=6)
        for v in e.data.vertices:   # lean outwards
            v.co.x += sgn * (v.co.z - c.z) * tilt
        weight_all(e, "Head", ctx["arm"]); finish_part(ctx, e, swatch); res.append(e)
    return res


def tail(ctx, name, length, r0, r1, nseg=4, droop=0.12, curl=0.0, bone_prefix="Tail", swatch="skin", sway=0.0):
    arm = ctx["arm"]
    hips = arm.data.bones["Hips"].head_local
    by = skin_back_y(ctx["body"], hips.z - 0.02)
    start = Vector((0, by - 0.02, hips.z - 0.03))
    pts = [start]
    seg = length / nseg
    for i in range(1, nseg + 1):
        t = i / nseg
        pts.append(start + Vector((sway * math.sin(t * 3) * 0.2, seg * i * 0.95, -droop * t - 0.0 + curl * t * t)))
    specs = []
    for i in range(nseg):
        specs.append(("%s%d" % (bone_prefix, i + 1), pts[i], pts[i + 1], "Hips" if i == 0 else "%s%d" % (bone_prefix, i)))
    add_bones(arm, specs)
    radii = [r0 + (r1 - r0) * (i / nseg) for i in range(nseg + 1)]
    ob = tube(name, arm, pts, radii, [s[0] for s in specs], ctx["mat"], sides=8, flat=1.0)
    set_swatch(ob, swatch)
    ob.data.materials.clear(); ob.data.materials.append(ctx["mat"])
    return [ob]


def xhuman(ctx, part, pivot, scale=(1, 1, 1), rot=(0, 0, 0), move=(0, 0, 0)):
    o = ctx["M"].get(part)
    if o:
        xform_part(o, pivot, scale, rot, move)
    return o


def ear_pairs(ctx, kind, scale, rot, move=(0, 0, 0), name="Ear"):
    """Scale/rotate the human or elf ears (L/R) about their own base."""
    hf = head_frame(ctx)
    for sgn, side in ((1, "L"), (-1, "R")):
        o = ctx["M"].get("Part_%s_%s" % (kind, side))
        if not o:
            continue
        piv = hf["ear_l"] if sgn > 0 else hf["ear_r"]
        r = (rot[0], sgn * rot[1], rot[2])
        xform_part(o, piv, scale, r, (sgn * move[0], move[1], move[2]))


# --------------------------------------------------------------------------- GOBLIN
def goblin_parts(ctx):
    ear_pairs(ctx, "Ear_Elf_A", (1.15, 1.35, 2.1), (0, math.radians(32), 0), (0.008, 0, 0.012))
    xhuman(ctx, "Part_Nose_Orc", head_frame(ctx)["nose"], (1.25, 1.3, 1.25), (0, 0, 0), (0, -0.004, 0.003))
    return []


SPECIES["goblin"] = dict(
    height=1.05, skin="#7d9254", belly="#a6b078", seed=3, human_parts=["Part_Ear_Elf_A_L", "Part_Ear_Elf_A_R", "Part_Nose_Orc"],
    bake=dict(Thin=0.75, Species_Orc=0.35, Belly=0.25, Age_Old=0.15),
    bones=merge({"Head": (1.45, 1.4, 1.45), "Neck": (1, 0.8, 1)}, both("UpperArm", (1.1, 1.18, 1.1)), both("Hand", (1.3, 0.85, 1.3)),
                both("UpperLeg", (1.0, 0.8, 1.0)), both("Foot", (1.15, 1.15, 1.15))),
    iris="#d8c030", iris_rim="#7a6a18", pupil=(0.036, 0.05), sclera="#e8e2c0", brow_h=0.046, brow_w=0.007, brow_tilt=0.004,
    mouth_w=0.04, lip="#5b6a38", line="#2a2c18", parts=goblin_parts)

# --------------------------------------------------------------------------- HOBGOBLIN
def hobgoblin_parts(ctx):
    ear_pairs(ctx, "Ear_Elf_A", (1.0, 1.15, 1.5), (0, math.radians(18), 0), (0.003, 0, 0.0))
    xhuman(ctx, "Part_Nose_Orc", head_frame(ctx)["nose"], (0.95, 1.0, 1.0))
    return []


SPECIES["hobgoblin"] = dict(
    height=1.85, skin="#a8643f", belly="#c18a5e", seed=5, human_parts=["Part_Ear_Elf_A_L", "Part_Ear_Elf_A_R", "Part_Nose_Orc"],
    bake=dict(Muscle=0.75, Chest_Muscle=0.6, Species_Orc=0.55, Jaw_Wide=0.5, Brow_Ridge=0.5, Waist_Wide=0.2),
    bones=merge({"Head": (1.02, 1.02, 1.02)}, both("Hand", (1.1, 1.0, 1.1))),
    iris="#c88a2a", iris_rim="#6a3e14", pupil=(0.04, 0.042), sclera="#ead6b0", brow_h=0.036, brow_w=0.008, brow_tilt=-0.004,
    mouth_w=0.036, lip="#7a3f2c", line="#2b1810", parts=hobgoblin_parts)

# --------------------------------------------------------------------------- KOBOLD
def kobold_parts(ctx):
    hf = head_frame(ctx)
    out = []
    out += snout(ctx, "Snout", 0.105, 0.075, 0.07, 0.05, 0.045, dz=-0.012, droop=0.008, expo=2.4, swatch="skin", nose_r=0.011)
    out += horns(ctx, "Horn", 0.075, 0.025, -0.035, 0.016, (0.01, -0.02, 0.0), swatch="horn", x=-0.01, tip_r=0.004)
    out += ears_blob(ctx, "Ear", 0.045, 0.01, 0.03, tilt=0.5, swatch="accent", fl=0.3)
    out += tail(ctx, "Tail", 0.62, 0.045, 0.012, nseg=4, droop=0.05, curl=0.12, swatch="skin")
    return out


SPECIES["kobold"] = dict(
    height=0.95, skin="#a2603f", belly="#d0a070", accent="#7a4430", horn="#d8c8a0", seed=7, snout=True, human_parts=[],
    bake=dict(Thin=0.9, Face_Long=0.0, Age_Old=0.1),
    bones=merge({"Head": (1.15, 1.2, 1.15), "Neck": (1, 0.8, 1)}, both("UpperArm", (0.9, 1.0, 0.9)), both("Hand", (1.0, 1.0, 1.0)),
                both("UpperLeg", (1, 0.82, 1)), both("Foot", (1.1, 1.1, 1.1))),
    iris="#e0a020", iris_rim="#8a4a10", pupil=(0.014, 0.065), iris_r=0.082, sclera="#e8d8a0", brow_h=0.045, brow_w=0.006, brow_tilt=0.002,
    mouth=False, line="#2a1810", parts=kobold_parts)

# --------------------------------------------------------------------------- GNOLL
def gnoll_parts(ctx):
    hf = head_frame(ctx)
    out = []
    out += snout(ctx, "Snout", 0.12, 0.11, 0.085, 0.07, 0.06, dz=-0.012, droop=0.01, expo=2.3, swatch="skin", nose_r=0.017)
    out += ears_blob(ctx, "Ear", 0.065, 0.015, 0.075, tilt=0.35, swatch="skin", fl=0.28)
    # mane: ridge of flat spikes from the crown down the spine
    arm = ctx["arm"]
    items = []
    chain = [("Head", hf["top"].z - 0.01, 0.0), ("Neck", 1.50, 0.0), ("UpperChest", 1.38, 0.0), ("Chest", 1.22, 0.0), ("Spine", 1.08, 0.0)]
    for bn, z, _ in chain:
        by = skin_back_y(ctx["body"] + [ctx["head"]], z)
        if by < -5:
            by = hf["back"].y
        items.append((bn, Vector((0, by - 0.012, z)), Vector((0, by + 0.05, z + 0.075)), 0.028))
    out.append(spike_row("Mane", arm, items, ctx["mat"], flat=0.3))
    set_swatch(out[-1], "hair")
    out += tail(ctx, "Tail", 0.4, 0.04, 0.03, nseg=3, droop=0.18, swatch="hair")
    return out


SPECIES["gnoll"] = dict(
    height=2.0, skin="#b8985c", hair="#4a3624", dark="#2a1e18", seed=11, snout=True, human_parts=[],
    bake=dict(Muscle=0.45, Thin=0.35, Age_Old=0.55, Chest_Muscle=0.4),
    bones=merge({"Head": (1.05, 1.05, 1.05)}, both("UpperArm", (1, 1.1, 1)), both("UpperLeg", (1, 0.95, 1))),
    pattern=("spots", "#3d2c1c", 320, 0.0065), pattern_alpha=0.8,
    iris="#d8a020", iris_rim="#7a4a10", pupil=(0.035, 0.035), sclera="#e0d0a0", brow_h=0.038, brow_w=0.007, brow_tilt=-0.003,
    mouth=False, line="#241810", parts=gnoll_parts)

# --------------------------------------------------------------------------- LIZARDFOLK
def lizard_parts(ctx):
    hf = head_frame(ctx)
    out = []
    out += snout(ctx, "Snout", 0.15, 0.1, 0.07, 0.075, 0.05, dz=-0.02, droop=0.0, expo=3.0, swatch="skin", nose=False)
    for sgn, side in ((1, "L"), (-1, "R")):   # nostril bumps
        e = ellipsoid_mesh("Nostril_" + side, (sgn * 0.016, hf["nose"].y - 0.17, hf["nose"].z - 0.0), (0.009, 0.01, 0.007), seg=8, rings=4)
        weight_all(e, "Head", ctx["arm"]); finish_part(ctx, e, "dark"); out.append(e)
    # head crest: three swept spines
    items = []
    for i, dy in enumerate((0.0, 0.035, 0.07)):
        items.append(("Head", Vector((0, hf["top"].y + 0.0 + dy, hf["top"].z - 0.02 - 0.01 * i)),
                      Vector((0, hf["top"].y + 0.07 + dy, hf["top"].z + 0.04 - 0.02 * i)), 0.022))
    c = spike_row("Crest", ctx["arm"], items, ctx["mat"], flat=0.25); set_swatch(c, "spine"); out.append(c)
    # back spines
    items = []
    for bn, z in (("Neck", 1.50), ("UpperChest", 1.36), ("Chest", 1.22), ("Spine", 1.07), ("Hips", 0.95)):
        by = skin_back_y(ctx["body"] + [ctx["head"]], z)
        if by < -5:
            by = hf["back"].y
        items.append((bn, Vector((0, by - 0.01, z)), Vector((0, by + 0.04, z + 0.055)), 0.022))
    sp_ = spike_row("Spines", ctx["arm"], items, ctx["mat"], flat=0.25); set_swatch(sp_, "spine"); out.append(sp_)
    out += tail(ctx, "Tail", 1.0, 0.085, 0.015, nseg=5, droop=0.2, curl=0.05, swatch="skin")
    return out


SPECIES["lizardfolk"] = dict(
    height=1.85, skin="#6a8460", belly="#c8c08a", spine="#8a6a40", dark="#243020", seed=13, snout=True, human_parts=[],
    bake=dict(Muscle=0.4, Thin=0.2, Chest_Muscle=0.3),
    bones=merge({"Head": (0.98, 1.0, 0.98)}, both("Hand", (1.1, 1.0, 1.1))),
    pattern=("patches", "#506a4a", 60, 0.03), pattern_alpha=0.6,
    iris="#e8c030", iris_rim="#7a5a10", pupil=(0.012, 0.07), iris_r=0.085, sclera="#d8d090", brow_h=0.05, brow_w=0.006, brow_tilt=-0.003,
    mouth=False, line="#1c2616", parts=lizard_parts)

# --------------------------------------------------------------------------- MINOTAUR
def minotaur_parts(ctx):
    hf = head_frame(ctx)
    out = []
    out += snout(ctx, "Muzzle", 0.085, 0.14, 0.12, 0.12, 0.095, dz=-0.025, droop=0.012, expo=2.4, swatch="skin", nose=False)
    pad = ellipsoid_mesh("NosePad", (0, hf["nose"].y - 0.105, hf["nose"].z - 0.045), (0.05, 0.022, 0.034), seg=10, rings=5)
    weight_all(pad, "Head", ctx["arm"]); finish_part(ctx, pad, "dark"); out.append(pad)
    # nose ring
    ring = tube("NoseRing", ctx["arm"], [(0.0 + 0.012 * math.cos(a), hf["nose"].y - 0.125, hf["nose"].z - 0.062 - 0.02 * math.sin(a)) for a in [i * 0.5 for i in range(9)]],
                [0.004] * 9, ["Head"] * 8, ctx["mat"], sides=5)
    set_swatch(ring, "dark"); out.append(ring)
    out += horns(ctx, "Horn", 0.16, 0.2, -0.02, 0.04, (0.0, -0.03, 0.17), swatch="horn", x=0.015, z=0.0, tip_r=0.012)
    out += ears_blob(ctx, "Ear", 0.06, 0.02, 0.045, tilt=1.1, swatch="skin", fl=0.3, y=-0.005)
    out += tail(ctx, "Tail", 0.55, 0.03, 0.012, nseg=3, droop=0.3, swatch="hair")
    return out


SPECIES["minotaur"] = dict(
    height=2.45, skin="#6e4c38", hair="#33231a", horn="#d6c8a6", dark="#241a16", seed=17, snout=True, human_parts=[],
    bake=dict(Muscle=1.0, Chest_Muscle=1.0, Heavy=0.3, Arms_Thick=0.6, Shoulders=0.6, Belly=0.15),
    bones=merge({"Head": (1.1, 1.1, 1.1), "Neck": (1.3, 1.0, 1.3)}, both("Hand", (1.2, 1.0, 1.2))),
    pattern=("patches", "#563a2a", 90, 0.03), pattern_alpha=0.6,
    iris="#7a4a28", iris_rim="#2a1810", pupil=(0.05, 0.03), sclera="#d8ccb0", brow_h=0.036, brow_w=0.009, brow_tilt=-0.004,
    mouth=False, line="#1c120e", parts=minotaur_parts)

# --------------------------------------------------------------------------- OGRE
def ogre_parts(ctx):
    hf = head_frame(ctx)
    ear_pairs(ctx, "Ear", (1.2, 1.3, 1.4), (0, math.radians(10), 0), (0.006, 0, 0))
    xhuman(ctx, "Part_Nose_Orc", hf["nose"], (1.3, 1.4, 1.35), (0, 0, 0), (0, -0.005, -0.003))
    for nm in ("Part_Tusk_A_L", "Part_Tusk_A_R"):
        xhuman(ctx, nm, hf["chin"], (1.2, 1.2, 1.4))
    return []


SPECIES["ogre"] = dict(
    height=2.6, skin="#a3a068", belly="#c0bd8c", seed=19, human_parts=["Part_Ear_L", "Part_Ear_R", "Part_Nose_Orc", "Part_Tusk_A_L", "Part_Tusk_A_R"],
    bake=dict(Heavy=1.0, Belly=1.0, Arms_Thick=0.7, Legs_Thick=0.6, Species_Orc=0.7, Age_Old=0.1),
    bones=merge({"Head": (0.86, 0.86, 0.86)}, both("Hand", (1.35, 1.2, 1.35)), both("UpperLeg", (1.1, 0.85, 1.1)), both("Foot", (1.2, 1.2, 1.2))),
    pattern=("patches", "#8a8a52", 60, 0.03), pattern_alpha=0.5,
    iris="#8a6a30", iris_rim="#3a2a10", pupil=(0.03, 0.03), iris_r=0.06, sclera="#d8d0a8", brow_h=0.034, brow_w=0.01, brow_tilt=-0.006,
    mouth_w=0.04, lip="#7a5a40", line="#2a2414", parts=ogre_parts)

# --------------------------------------------------------------------------- TROLL
def troll_parts(ctx):
    hf = head_frame(ctx)
    ear_pairs(ctx, "Ear", (1.1, 1.0, 1.9), (0, math.radians(35), 0), (0.004, 0, 0.012))
    xhuman(ctx, "Part_Nose_Orc", hf["nose"], (1.6, 1.8, 1.5), (0, 0, 0), (0, -0.01, -0.004))
    for nm in ("Part_Tusk_A_L", "Part_Tusk_A_R"):
        xhuman(ctx, nm, hf["chin"], (1.5, 1.4, 1.9))
    out = []
    # mossy tufts / stone knobs on shoulders and back
    items = []
    for sgn, side in ((1, "L"), (-1, "R")):
        items.append(("LeftShoulder" if sgn > 0 else "RightShoulder", Vector((sgn * 0.18, 0.02, 1.38)), Vector((sgn * 0.22, 0.03, 1.5)), 0.045))
    for bn, z in (("UpperChest", 1.33), ("Chest", 1.2), ("Spine", 1.07)):
        by = skin_back_y(ctx["body"], z)
        items.append((bn, Vector((0.0, by - 0.01, z)), Vector((0.0, by + 0.05, z + 0.06)), 0.04))
    k = spike_row("Knobs", ctx["arm"], items, ctx["mat"], flat=0.9); set_swatch(k, "accent"); out.append(k)
    return out


SPECIES["troll"] = dict(
    height=2.9, skin="#6f7e64", accent="#587046", belly="#8a9578", seed=23, human_parts=["Part_Ear_L", "Part_Ear_R", "Part_Nose_Orc", "Part_Tusk_A_L", "Part_Tusk_A_R"],
    bake=dict(Muscle=0.6, Heavy=0.35, Age_Old=0.75, Species_Orc=0.8, Arms_Thick=0.4, Belly=0.3),
    bones=merge({"Head": (0.92, 0.92, 0.92)}, both("UpperArm", (1.0, 1.3, 1.0)), both("LowerArm", (1.1, 1.15, 1.1)), both("Hand", (1.4, 0.85, 1.4)),
                both("UpperLeg", (1.0, 0.92, 1.0)), both("Foot", (1.2, 1.2, 1.2))),
    pattern=("patches", "#4c6440", 90, 0.03), pattern_alpha=0.75,
    iris="#c8402a", iris_rim="#5a1a10", pupil=(0.03, 0.045), iris_r=0.065, sclera="#d8d0a0", brow_h=0.03, brow_w=0.011, brow_tilt=-0.008,
    mouth_w=0.045, lip="#5a4a3a", line="#202818", parts=troll_parts)

# --------------------------------------------------------------------------- GIANT
def giant_parts(ctx):
    hf = head_frame(ctx)
    ear_pairs(ctx, "Ear", (1.1, 1.1, 1.15), (0, 0, 0))
    xhuman(ctx, "Part_Nose", hf["nose"], (1.25, 1.3, 1.25))
    out = []
    # shaggy beard and brow: simple lofted blobs
    b = ellipsoid_mesh("Beard", (0, hf["chin"].y + 0.015, hf["chin"].z - 0.025), (0.085, 0.07, 0.085), seg=12, rings=6)
    weight_all(b, "Head", ctx["arm"]); finish_part(ctx, b, "hair"); out.append(b)
    return out


SPECIES["giant"] = dict(
    height=4.6, skin="#b08c6c", hair="#6a5844", seed=29, human_parts=["Part_Ear_L", "Part_Ear_R", "Part_Nose"],
    bake=dict(Muscle=0.55, Heavy=0.35, Chest_Muscle=0.5, Brow_Ridge=0.8, Jaw_Wide=0.6, Cheeks_Full=0.3, Age_Old=0.2),
    bones=merge({"Head": (0.97, 0.97, 0.97)}, both("Hand", (1.1, 1.0, 1.1))),
    pattern=("patches", "#9a7658", 70, 0.03), pattern_alpha=0.5,
    iris="#6a8aa0", iris_rim="#2a3a4a", pupil=(0.04, 0.04), sclera="#e6dcc6", brow_h=0.036, brow_w=0.01, brow_tilt=-0.004,
    mouth_w=0.036, lip="#8a5a48", line="#2a2018", parts=giant_parts)

# --------------------------------------------------------------------------- HARPY
def harpy_parts(ctx):
    arm, hf = ctx["arm"], head_frame(ctx)
    out = []
    mat = ctx["mat"]
    bones = arm.data.bones
    # ---- bird legs: thin shins, talons, thigh feather trousers
    for sgn, side in ((1, "Left"), (-1, "Right")):
        foot = bones[side + "Foot"]
        toes = bones[side + "Toes"]
        a = foot.head_local
        gz = toes.tail_local.z
        for k, ang in enumerate((-0.38, 0.0, 0.38)):
            tip = Vector((a.x + math.sin(ang) * 0.17 * -sgn * -1, a.y - 0.20 * math.cos(ang), gz + 0.012))
            o = cone_mesh("Toe_%s%d" % (side[0], k), Vector((a.x, a.y - 0.01, a.z - 0.03)), tip, 0.014, 0.004, sides=6, rings=2, bend=Vector((0, 0, -0.03)))
            weight_all(o, side + "Foot", arm); finish_part(ctx, o, "claw"); out.append(o)
        o = cone_mesh("Toe_%s_back" % side[0], Vector((a.x, a.y, a.z - 0.03)), Vector((a.x, a.y + 0.09, gz + 0.012)), 0.013, 0.004, sides=6, rings=2)
        weight_all(o, side + "Foot", arm); finish_part(ctx, o, "claw"); out.append(o)
        st = tube("Shank_" + side[0], arm, [(a.x, a.y + 0.005, 0.19), (a.x, a.y - 0.0, 0.09), (a.x, a.y - 0.02, gz + 0.03)], [0.026, 0.02, 0.017],
                  [side + "Foot", side + "Foot"], mat, sides=6)
        finish_part(ctx, st, "skin2"); out.append(st)
        ul = bones[side + "UpperLeg"]
        c = ul.head_local.lerp(ul.tail_local, 0.5) + Vector((0, 0.012, 0))
        e = ellipsoid_mesh("Trouser_" + side[0], tuple(c), (0.082, 0.088, 0.2), seg=12, rings=6)
        weight_all(e, side + "UpperLeg", arm); finish_part(ctx, e, "feather2"); out.append(e)
        # lower fringe of feathers
        for i in range(5):
            ang = i / 4 * math.pi + math.pi / 2
            base = c + Vector((math.cos(ang) * 0.06, math.sin(ang) * 0.07, -0.15))
            f = wings.feather("TroF_%s%d" % (side[0], i), base, (0, 0.2 * math.sin(ang), -1), 0.13, 0.04, (1, 0, 0), mat=None)
            weight_all(f, side + "UpperLeg", arm); finish_part(ctx, f, "feather2"); out.append(f)
    # ---- tail feathers
    hips = bones["Hips"].head_local
    by = skin_back_y(ctx["body"], hips.z)
    for i in range(7):
        a = (i - 3) / 3 * 0.55
        f = wings.feather("TailF%d" % i, Vector((0, by - 0.01, hips.z + 0.0)), (math.sin(a), 0.75, -0.55), 0.42 - 0.03 * abs(i - 3), 0.07, (math.cos(a), -math.sin(a), 0), mat=None)
        weight_all(f, "Hips", arm); finish_part(ctx, f, "feather" if i % 2 else "feather2"); out.append(f)
    # ---- head crest feathers
    for i in range(5):
        a = (i - 2) / 2 * 0.5
        f = wings.feather("Crest%d" % i, Vector((math.sin(a) * 0.05, hf["top"].y + 0.0, hf["top"].z - 0.03)), (math.sin(a) * 0.4, 0.8, 0.45), 0.17, 0.034, (1, 0, 0), mat=None)
        weight_all(f, "Head", arm); finish_part(ctx, f, "feather3"); out.append(f)
    # ---- wings
    uc = bones["UpperChest"]
    by = skin_back_y(ctx["body"], 1.33)
    specs = []
    wing_objs = []
    paths = {}
    for sgn, S_ in ((1, "L"), (-1, "R")):
        S0 = Vector((sgn * 0.075, by - 0.005, 1.33))
        E = S0 + Vector((sgn * 0.26, 0.08, 0.14))
        W = E + Vector((sgn * 0.30, 0.10, 0.16))
        H = W + Vector((sgn * 0.26, 0.08, 0.10))
        paths[S_] = (S0, E, W, H)
        specs += [("Wing_Upper_" + S_, S0, E, "UpperChest"), ("Wing_Fore_" + S_, E, W, "Wing_Upper_" + S_),
                  ("Wing_Hand_" + S_, W, H, "Wing_Fore_" + S_)]
    add_bones(arm, specs)
    for sgn, S_ in ((1, "L"), (-1, "R")):
        S0, E, W, H = paths[S_]
        bn = ["Wing_Upper_" + S_, "Wing_Fore_" + S_, "Wing_Hand_" + S_]
        spar = tube("Spar_" + S_, arm, [S0, E, W, H], [0.026, 0.02, 0.014, 0.006], bn, mat, sides=6)
        set_swatch(spar, "feather3"); wing_objs.append(spar)
        segs = [(S0, E, bn[0], 4, 0.55, 0.45, 0.22), (E, W, bn[1], 7, 0.62, 0.70, 0.30), (W, H, bn[2], 6, 0.72, 0.62, 0.36)]
        for si, (a, b, bone, cnt, L0, L1, wd) in enumerate(segs):
            lead = (b - a).normalized()
            for i in range(cnt):
                t = (i + 0.5) / cnt
                base = a.lerp(b, t) + Vector((0, 0.01, 0))
                L = L0 + (L1 - L0) * t
                d = Vector((0, 1.0, -0.22)) + lead * 0.35
                f = wings.feather("WF_%s%d_%d" % (S_, si, i), base, d, L * (0.6 if si == 0 else 1.0), 0.115, lead)
                weight_all(f, bone, arm); set_swatch(f, "feather" if (i % 2 == 0) else "feather2"); wing_objs.append(f)
        # second (under) row of shorter coverts
        for si, (a, b, bone, cnt, L0, L1, wd) in enumerate(segs[:2]):
            lead = (b - a).normalized()
            for i in range(cnt + 1):
                t = i / cnt
                base = a.lerp(b, t) + Vector((0, 0.0, 0.02))
                d = Vector((0, 1.0, -0.1)) + lead * 0.25
                f = wings.feather("WC_%s%d_%d" % (S_, si, i), base, d, 0.26, 0.09, lead)
                weight_all(f, bone, arm); set_swatch(f, "feather3"); wing_objs.append(f)
    w = join(wing_objs, "Wings")
    w.data.materials.clear(); w.data.materials.append(mat)
    out.append(w)
    return out


def harpy_clips(arm):
    names = [b.name for b in arm.data.bones if b.name.startswith("Wing_")]
    arm.animation_data_create()
    act = bpy.data.actions.new("Wings_Flap")
    arm.animation_data.action = act
    reset_p = wings.reset_pose
    for f, ang in ((1, 0), (8, -38), (16, 0), (24, 30), (32, 0)):
        reset_p(arm)
        for sgn, S_ in ((1, "L"), (-1, "R")):
            wings.pose_rot(arm, "Wing_Upper_" + S_, 'Y', sgn * ang)
            wings.pose_rot(arm, "Wing_Fore_" + S_, 'Y', sgn * ang * 0.5)
            wings.pose_rot(arm, "Wing_Hand_" + S_, 'Y', sgn * ang * 0.4)
        wings.key_pose(arm, f, names)
    act.use_fake_user = True
    arm.animation_data.action = None
    wings.reset_pose(arm)


SPECIES["harpy"] = dict(
    height=1.6, skin="#c79b7b", belly="#d8b496", feather="#8a6a4e", feather2="#6a4e3a", feather3="#b09470", claw="#3a2e28", seed=31, drop=["Mesh_Feet"],
    human_parts=["Part_Ear_L", "Part_Ear_R", "Part_Nose"],
    bake=dict(Sex=1.0, Thin=0.35),
    bones=merge({"Head": (1.02, 1.02, 1.02)}, both("LowerLeg", (0.55, 1.0, 0.55)), both("Hand", (1.0, 1.0, 1.0))),
    iris="#d8a828", iris_rim="#6a4a10", pupil=(0.032, 0.032), iris_r=0.082, sclera="#ece4d0", brow_h=0.04, brow_w=0.005, brow_tilt=0.003,
    mouth_w=0.03, lip="#9a5a50", line="#3a2a22", parts=harpy_parts, clips=harpy_clips)
