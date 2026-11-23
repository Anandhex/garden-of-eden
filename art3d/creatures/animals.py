"""Build the animal creatures (Blender 4.3 headless):
    /Applications/Blender.app/Contents/MacOS/Blender -b -P art3d/creatures/animals.py -- [species ...]

Pack animals (wolf, dog, fox, horse, deer, spider, adder) come from Quaternius CC0 packs (source/quaternius/), kept on their
generic rigs with their animations. bear, boar, goat, hare, dragon are re-proportioned from the same rigs (rest-pose bone
scaling + weight-driven mesh inflation) and get generated parts (tusks, horns, wings, spines). Birds are generated (birds.py).
"""
import bpy, sys, os, math, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib
from lib import *

QA = os.path.join(SRC, "quaternius", "ultimate_animated_animals")
QE = os.path.join(SRC, "quaternius", "easy_enemy")

ANIMS = {"Idle": "Idle", "Idle_2": "Idle_2", "Eating": "Eat", "Walk": "Walk", "Gallop": "Run", "Attack": "Attack",
         "Attack_Headbutt": "Attack", "Attack_Kick": "Attack_Kick", "Death": "Death",
         "Idle_HitReact_Left": "HitReact_L", "Idle_HitReact_Right": "HitReact_R", "Idle_Headlow": "Eat_Low",
         "Idle_2_HeadLow": "Eat_Low", "Jump_ToIdle": None}

META = {}


def withers_z(mesh, groups=("Torso", "Torso2", "Torso3", "Back", "FrontShoulder.L", "FrontShoulder.R")):
    """Height of the withers: highest vertex that is dominantly weighted to the trunk/shoulder groups (not head/ears/tail)."""
    idx = {vg.index: vg.name for vg in mesh.vertex_groups}
    best = 0.0
    for v in mesh.data.vertices:
        if v.groups:
            g = max(v.groups, key=lambda g: g.weight)
            if idx.get(g.group) in groups:
                best = max(best, (mesh.matrix_world @ v.co).z)
    return best


def restyle(arm, meshes, scales):
    """Rest-pose bone scaling. scales {bone: (sx, sy, sz)} in bone-local axes (Y along the bone); children inherit."""
    if arm.animation_data:
        arm.animation_data.action = None
    activate(arm)
    mode('POSE')
    for pb in arm.pose.bones:
        pb.location = (0, 0, 0)
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.scale = (1, 1, 1)
    for n, s in scales.items():
        if n in arm.pose.bones:
            arm.pose.bones[n].scale = s
    mode('OBJECT')
    apply_pose_as_rest(arm, meshes)


def drop_ground(arm, meshes):
    """Translate everything so the lowest vertex sits at z = 0 (applied into mesh/bones, no object offset)."""
    zmin = min((m.matrix_world @ v.co).z for me in meshes for m in [me] for v in m.data.vertices)
    activate(arm)
    mode('EDIT')
    orig = {eb.name: (eb.head.copy(), eb.tail.copy()) for eb in arm.data.edit_bones}
    for eb in arm.data.edit_bones:
        eb.head = orig[eb.name][0] - Vector((0, 0, zmin))
        eb.tail = orig[eb.name][1] - Vector((0, 0, zmin))
    mode('OBJECT')
    for m in meshes:
        for v in m.data.vertices:
            v.co.z -= zmin


def finish(name, arm, meshes, extra, shoulder_m, rig_note, dims_target=None, keep_anims=True):
    """Final cleanup + export. meshes = skinned body mesh objects, extra = additional part objects (already parented)."""
    allm = list(meshes) + list(extra)
    drop_unweighted_bones(arm, allm)
    sh = withers_z(meshes[0]) if arm.data.bones.get("FrontUpperLeg.L") else None
    s = (shoulder_m / sh) if sh else 1.0
    if dims_target:
        s = dims_target(arm, allm)
    arm.name = "Armature"
    arm.data.name = "Armature"
    for o in allm:
        o.name = o.name if o.name.startswith(name) else name + "_" + o.name
    root = [o for o in allm][0]
    tris = sum(tri_count(o) for o in allm)
    os.makedirs(EXPORT, exist_ok=True)
    path = os.path.join(EXPORT, name + ".fbx")
    smooth_normals(allm)
    bake_scale(arm, allm, s)
    export_fbx(path, [arm] + allm, global_scale=1.0, with_anim=keep_anims)
    META[name] = dict(tris=tris, bones=len(arm.data.bones), scale_applied=round(s, 4), rig=rig_note,
                      parts=[o.name for o in allm], anims=sorted(a.name for a in bpy.data.actions),
                      size_kb=os.path.getsize(path) // 1024)
    if os.environ.get("KEEP_BLEND"):
        os.makedirs(os.path.join(HERE, "blend"), exist_ok=True)
        bpy.ops.wm.save_as_mainfile(filepath=os.path.join(HERE, "blend", name + ".blend"))
    print("BUILT", name, META[name])


def load_pack(path, name, keep=ANIMS):
    reset()
    arm, meshes = import_fbx(path)
    body = [m for m in meshes if "Horns" not in m.name]
    horns = [m for m in meshes if "Horns" in m.name]
    for m in horns:
        bpy.data.objects.remove(m)
    mesh = join(body, name + "_Body")
    # drop extra clips and rename
    clean_action_names(arm, {k: v for k, v in keep.items() if v})
    arm.animation_data_create()
    return arm, mesh


def rename_mats(mesh, name):
    pass


# ------------------------------------------------------------------ species
def plain(name, path, shoulder_m, colors):
    arm, mesh = load_pack(path, name)
    set_slot_colors(mesh, colors)
    finish(name, arm, [mesh], [], shoulder_m, "Generic (AnimalArmature)")


def build_wolf():
    plain("wolf", os.path.join(QA, "Wolf.fbx"), 0.80,
          {"Main_Light": "#b4ab9a", "Main": "#7b756d", "Nose": "#2e2a29", "Eyes": "#2a2420"})


def build_dog():
    plain("dog", os.path.join(QA, "ShibaInu.fbx"), 0.52,
          {"Main_Light": "#dccfb4", "Main": "#b4854f", "Black": "#3a2f29", "Eyes_White": "#e6dccb", "Eyes_Black": "#2a2420",
           "Eyes_Pupil": "#241e1a"})


def build_fox():
    plain("fox", os.path.join(QA, "Fox.fbx"), 0.36,
          {"Main_Light": "#e4d8c0", "Main": "#b8643a", "Black": "#35302d", "Grey": "#8b857d", "Eyes": "#2a2420"})


def build_horse():
    plain("horse", os.path.join(QA, "Horse.fbx"), 1.50,
          {"Main_Dark": "#5a3d2c", "Main_Light": "#957159", "Main": "#7b5239", "Hooves": "#3b332d", "Hair": "#2e2723",
           "Muzzle": "#6a5243", "Eye_White": "#e2d8c8", "Eye_Black": "#241e1a"})


def build_deer():
    plain("deer", os.path.join(QA, "Deer.fbx"), 0.98,
          {"Main_Dark": "#6e4d34", "Main_Light": "#d9c6a4", "Main": "#9b6e46", "Hooves": "#3b332d", "Muzzle": "#c4ad8c",
           "Eye_Lighter": "#8a6a48", "Eye_Black": "#241e1a", "Eye_White": "#e2d8c8"})


def build_spider():
    reset()
    arm, meshes = import_fbx(os.path.join(QE, "Spider.fbx"))
    mesh = join(meshes, "spider_Body")
    clean_action_names(arm, {"Spider_Idle": "Idle", "Spider_Walk": "Walk", "Spider_Attack": "Attack",
                             "Spider_Death": "Death", "Spider_Jump": "Jump"})
    set_slot_colors(mesh, {"Material.001": "#8f3a30", "Material": "#3b3836"})
    drop_unweighted_bones(arm, [mesh])
    # giant spider: leg span ~1.6 m
    def dims(arm, ms):
        w = max(ms[0].dimensions)
        return 1.6 / w
    finish("spider", arm, [mesh], [], 0, "Generic (SpiderArmature)", dims_target=dims)


def build_adder():
    reset()
    arm, meshes = import_fbx(os.path.join(QE, "Snake.fbx"))
    mesh = join(meshes, "adder_Body")
    clean_action_names(arm, {"Snake_Idle": "Idle", "Snake_Walk": "Slither", "Snake_Attack": "Attack", "Snake_Jump": "Strike"})
    set_slot_colors(mesh, {"DarkGreen": "#5c5540", "LightGreen": "#8e8466", "Yellow": "#b59a4a", "DarkRed": "#3b2b26",
                           "Red": "#9a4a3c", "Teeth": "#e6dccb", "Purple": "#9a4a3c"})
    def dims(arm, ms):
        return 0.75 / max(ms[0].dimensions)
    finish("adder", arm, [mesh], [], 0, "Generic (SnakeArmature)", dims_target=dims)


def build_hare():
    arm, mesh = load_pack(os.path.join(QA, "Fox.fbx"), "hare")
    ear = {}
    for s in "LR":
        ear["Ear1." + s] = (0.85, 2.1, 0.85)
    restyle(arm, [mesh], {**ear, "Tail1": (0.5, 0.45, 0.5), "BackLeg.L": (1, 1.25, 1), "BackLeg.R": (1, 1.25, 1),
                          "Head": (0.9, 0.78, 0.9)})
    radial_scale(mesh, arm, {"Torso": 1.2, "Torso2": 1.25, "Torso3": 1.2, "Back": 1.2, "BackUpperLeg.L": 1.25,
                             "BackUpperLeg.R": 1.25, "BackLeg.L": 1.2, "BackLeg.R": 1.2})
    set_slot_colors(mesh, {"Main_Light": "#e3d6bd", "Main": "#9b8366", "Black": "#2f2a27", "Grey": "#7d7468", "Eyes": "#2a2420"})
    drop_ground(arm, [mesh])
    finish("hare", arm, [mesh], [], 0.26, "Generic (AnimalArmature, hare proportions)")


def build_bear():
    arm, mesh = load_pack(os.path.join(QA, "Wolf.fbx"), "bear")
    restyle(arm, [mesh], {"Head": (1.2, 0.8, 1.2), "Tail1": (0.5, 0.3, 0.5), "Ear1.L": (1.1, 0.55, 1.1), "Ear1.R": (1.1, 0.55, 1.1),
                          "Neck1": (1.3, 0.9, 1.3)})
    k = {"Torso": 1.4, "Torso2": 1.5, "Torso3": 1.5, "Back": 1.4, "Neck1": 1.2, "Neck2": 1.2}
    for s in "LR":
        k.update({"FrontUpperLeg." + s: 1.55, "FrontLowerLeg." + s: 1.5, "FrontShoulder." + s: 1.5,
                  "BackUpperLeg." + s: 1.6, "BackLowerLeg." + s: 1.5, "BackLeg." + s: 1.5, "BackShoulder." + s: 1.5})
    radial_scale(mesh, arm, k)
    set_slot_colors(mesh, {"Main_Light": "#9a7a58", "Main": "#7a5a3c", "Nose": "#2a2422", "Eyes": "#241e1a"})
    drop_ground(arm, [mesh])
    finish("bear", arm, [mesh], [], 1.05, "Generic (AnimalArmature, bear proportions)")


def build_boar():
    arm, mesh = load_pack(os.path.join(QA, "Wolf.fbx"), "boar")
    sc = {"Head": (1.25, 0.9, 1.25), "Tail1": (0.7, 0.35, 0.7), "Ear1.L": (1.0, 0.5, 1.0), "Ear1.R": (1.0, 0.5, 1.0),
          "FrontUpperLeg.L": (1, 0.72, 1), "FrontUpperLeg.R": (1, 0.72, 1), "BackLeg.L": (1, 0.75, 1), "BackLeg.R": (1, 0.75, 1)}
    restyle(arm, [mesh], sc)
    k = {"Torso": 1.35, "Torso2": 1.5, "Torso3": 1.45, "Back": 1.3, "Neck1": 1.3, "Neck2": 1.25, "Neck3": 1.2}
    for s in "LR":
        k.update({"FrontUpperLeg." + s: 1.2, "FrontLowerLeg." + s: 1.15, "BackUpperLeg." + s: 1.3, "BackLowerLeg." + s: 1.15})
    radial_scale(mesh, arm, k)
    set_slot_colors(mesh, {"Main_Light": "#6b5848", "Main": "#4e4034", "Nose": "#2a2220", "Eyes": "#241e1a"})
    drop_ground(arm, [mesh])
    # tusks + snout disc (separate swappable parts, rigid to Head)
    head = arm.data.bones["Head"]
    hh, ht = head.head_local, head.tail_local
    mat = make_mat("boar_tusk", srgb("#e0d6bf"))
    parts = []
    fwd = (ht - hh)
    for sgn, nm in ((1, "L"), (-1, "R")):
        base = (hh + fwd * 0.82) + Vector((sgn * 0.17, 0.0, -0.08))
        tip = base + Vector((sgn * 0.10, -0.08, 0.34))
        t = cone_mesh("boar_Tusk_" + nm, base, tip, 0.05, 0.012, sides=6, bend=Vector((sgn * 0.06, -0.12, 0.08)), mat=mat)
        weight_all(t, "Head", arm); parts.append(t)
    snout = ellipsoid_mesh("boar_Snout", tuple(hh + fwd * 1.0 + Vector((0, -0.05, -0.02))), (0.2, 0.09, 0.15), seg=10, rings=5,
                           mat=make_mat("boar_snout", srgb("#4a3a34")))
    weight_all(snout, "Head", arm); parts.append(snout)
    # bristle ridge
    ridge = make_ridge("boar_Mane", arm, ["Neck3", "Neck2", "Neck1", "Torso3", "Torso2", "Torso", "Back"], 0.16, 0.05,
                       make_mat("boar_bristle", srgb("#2f2622")))
    parts.append(ridge)
    finish("boar", arm, [mesh], parts, 0.80, "Generic (AnimalArmature, boar proportions)")


def make_ridge(name, arm, bones, height, width, mat, offset_up=0.0):
    """Row of flat spikes along a chain of bones, each rigid to its bone."""
    objs = []
    for bn in bones:
        b = arm.data.bones[bn]
        h, t = b.head_local, b.tail_local
        up = Vector((0, 0, 1))
        for f in (0.2, 0.7):
            c = h.lerp(t, f)
            # find the top of the mesh near here is unknown: approximate with the bone being on the spine line
            base = c + up * offset_up
            tip = base + up * height + (t - h).normalized() * (-0.03)
            o = cone_mesh(name + "_" + bn + str(f), base, tip, width, 0.0, sides=4, rings=1, mat=mat, flat=0.35)
            weight_all(o, bn, arm)
            objs.append(o)
    return join(objs, name)


def build_goat():
    arm, mesh = load_pack(os.path.join(QA, "Deer.fbx"), "goat")
    restyle(arm, [mesh], {"FrontUpperLeg.L": (1, 0.8, 1), "FrontUpperLeg.R": (1, 0.8, 1), "BackLeg.L": (1, 0.82, 1),
                          "BackLeg.R": (1, 0.82, 1), "Tail1": (1.1, 0.6, 1.1), "Head": (1.0, 0.85, 1.0),
                          "Ear1.L": (1.0, 0.7, 1.0), "Ear1.R": (1.0, 0.7, 1.0), "Neck1": (1.1, 0.85, 1.1)})
    k = {"Torso": 1.2, "Torso2": 1.3, "Torso3": 1.25, "Back": 1.2, "Neck1": 1.15, "Neck2": 1.1}
    radial_scale(mesh, arm, k)
    set_slot_colors(mesh, {"Main_Dark": "#5a4a3c", "Main_Light": "#d9ceb6", "Main": "#bdae92", "Hooves": "#3a322c",
                           "Muzzle": "#c8bba0", "Eye_Lighter": "#b8a060", "Eye_Black": "#241e1a", "Eye_White": "#e2d8c8"})
    drop_ground(arm, [mesh])
    head = arm.data.bones["Head"]
    hh, ht = head.head_local, head.tail_local
    fwd = ht - hh
    mat = make_mat("goat_horn", srgb("#a89878"))
    parts = []
    for sgn, nm in ((1, "L"), (-1, "R")):
        base = hh + fwd * 0.25 + Vector((sgn * 0.07, 0.04, 0.12))
        tip = base + Vector((sgn * 0.12, 0.40, 0.35))
        h = cone_mesh("goat_Horn_" + nm, base, tip, 0.05, 0.008, sides=7, bend=Vector((sgn * 0.04, 0.22, -0.12)), mat=mat)
        weight_all(h, "Head", arm); parts.append(h)
    beard = cone_mesh("goat_Beard", hh + fwd * 0.9 + Vector((0, 0, -0.1)), hh + fwd * 0.82 + Vector((0, 0.04, -0.4)), 0.045, 0.01,
                      sides=6, mat=make_mat("goat_beard", srgb("#8a7a64")))
    weight_all(beard, "Head", arm); parts.append(beard)
    finish("goat", arm, [mesh], parts, 0.70, "Generic (AnimalArmature, goat proportions)")


def build_dragon():
    import wings
    arm, mesh = load_pack(os.path.join(QA, "Wolf.fbx"), "dragon")
    sc = {"Head": (1.35, 1.75, 1.35), "Neck1": (1.25, 1.35, 1.25), "Ear1.L": (0.5, 0.35, 0.5), "Ear1.R": (0.5, 0.35, 0.5),
          "Tail1": (1.45, 1.9, 1.45)}
    restyle(arm, [mesh], sc)
    k = {"Torso": 1.75, "Torso2": 1.85, "Torso3": 1.8, "Back": 1.7, "Neck1": 1.5, "Neck2": 1.4, "Neck3": 1.35}
    for i in range(1, 9):
        k["Tail%d" % i] = 2.1 - 0.17 * i
    for s_ in "LR":
        k.update({"FrontUpperLeg." + s_: 1.6, "FrontLowerLeg." + s_: 1.5, "FrontShoulder." + s_: 1.6, "BackUpperLeg." + s_: 1.8, "BackLowerLeg." + s_: 1.5, "BackLeg." + s_: 1.6})
    radial_scale(mesh, arm, k)
    set_slot_colors(mesh, {"Main_Light": "#b9aa7e", "Main": "#5d6f50", "Nose": "#2c2a24", "Eyes": "#d8a020"})
    drop_ground(arm, [mesh])
    B = arm.data.bones
    mat_body = make_mat("dragon_horn", srgb("#cdbfa0"))
    mat_spine = make_mat("dragon_spine", srgb("#4d4a38"))
    mat_mem = make_mat("dragon_membrane", srgb("#8a5f52"))
    mat_spar = make_mat("dragon_spar", srgb("#4a4034"))
    parts = []
    # horns + cheek spikes
    hb = B["Head"]
    hh, ht = hb.head_local, hb.tail_local
    fwd = (ht - hh)
    for sgn, nm in ((1, "L"), (-1, "R")):
        base = hh + fwd * 0.05 + Vector((sgn * 0.26, 0.18, 0.28))
        tip = base + Vector((sgn * 0.35, 0.95, 0.55))
        h = cone_mesh("dragon_Horn_" + nm, base, tip, 0.12, 0.012, sides=8, rings=5, bend=Vector((sgn * 0.12, 0.15, 0.3)), mat=mat_body)
        weight_all(h, "Head", arm); parts.append(h)
        base2 = hh + fwd * 0.4 + Vector((sgn * 0.32, 0.25, -0.05))
        c = cone_mesh("dragon_Cheek_" + nm, base2, base2 + Vector((sgn * 0.35, 0.45, -0.1)), 0.06, 0.005, sides=6, rings=3, mat=mat_body)
        weight_all(c, "Head", arm); parts.append(c)
    # spines along neck, back and tail
    chain = ["Neck3", "Neck2", "Neck1", "Torso3", "Torso2", "Torso", "Back", "Tail1", "Tail2", "Tail3", "Tail4", "Tail5", "Tail6"]
    sp_objs = []
    for i, bn in enumerate(chain):
        b = B[bn]
        for f in (0.25, 0.75):
            c = b.head_local.lerp(b.tail_local, f)
            top = surface_top([mesh], c.y)
            if bn.startswith("Tail"):
                top = c.z + 0.2 * (2.1 - 0.17 * int(bn[4:]))
            h = 0.30 + 0.25 * math.sin(min(1, i / 6) * math.pi) if not bn.startswith("Tail") else 0.28 - 0.025 * int(bn[4:])
            base = Vector((0, c.y, top - 0.06))
            o = cone_mesh("sp_%s%d" % (bn, int(f * 4)), base, base + Vector((0, 0.18, max(0.1, h))), 0.09, 0.0, sides=4, rings=1, mat=mat_spine, flat=0.4)
            weight_all(o, bn, arm); sp_objs.append(o)
    parts.append(join(sp_objs, "dragon_Spines"))
    # tail tip blade
    t8 = B["Tail8"]
    tb = cone_mesh("dragon_TailBlade", t8.head_local, t8.tail_local + Vector((0, 0.9, 0.0)), 0.2, 0.0, sides=4, rings=2, mat=mat_spine, flat=0.3)
    weight_all(tb, "Tail8", arm); parts.append(tb)
    # ---- wings
    wz = withers_z(mesh)
    t2 = B["Torso2"].head_local
    specs = []
    P = {}
    for sgn, s_ in ((1, "L"), (-1, "R")):
        S0 = Vector((sgn * 0.25, t2.y + 0.1, wz - 0.1))
        E = S0 + Vector((sgn * 1.0, 0.3, 0.55))
        W = E + Vector((sgn * 1.4, 0.4, 0.35))
        T1 = W + Vector((sgn * 1.8, 0.2, 0.25))
        T2 = W + Vector((sgn * 1.5, 1.5, 0.0))
        T3 = W + Vector((sgn * 0.9, 2.4, -0.4))
        Hh = Vector((sgn * 0.5, B["Back"].head_local.y + 0.4, wz - 0.7))
        P[s_] = (S0, E, W, T1, T2, T3, Hh)
        specs += [("WingA_" + s_, S0, E, "Torso2"), ("WingB_" + s_, E, W, "WingA_" + s_),
                  ("Finger1_" + s_, W, T1, "WingB_" + s_), ("Finger2_" + s_, W, T2, "WingB_" + s_), ("Finger3_" + s_, W, T3, "WingB_" + s_)]
    add_bones(arm, specs)
    wing_parts = []
    for sgn, s_ in ((1, "L"), (-1, "R")):
        S0, E, W, T1, T2, T3, Hh = P[s_]
        bn = ["WingA_" + s_, "WingB_" + s_, "Finger1_" + s_, "Finger2_" + s_, "Finger3_" + s_]
        pts = {"S": S0, "E": E, "W": W, "T1": T1, "T2": T2, "T3": T3, "H": Hh}
        tris = [("S", "E", "W"), ("S", "W", "H"), ("W", "T1", "T2"), ("W", "T2", "T3"), ("W", "T3", "H")]
        # bone-to-body anchor for the root and hip vertices
        mem = wings.membrane_wing("dragon_Membrane_" + s_, arm, pts, tris, mat_mem, cuts=3, thick=0.02, bones=bn + ["Torso2", "Back"])
        wing_parts.append(mem)
        sp1 = tube("dragon_Arm_" + s_, arm, [S0, E, W], [0.2, 0.15, 0.1], bn[:2], mat_spar, sides=6)
        wing_parts.append(sp1)
        for fi, T in enumerate((T1, T2, T3)):
            fp = tube("dragon_Finger%d_%s" % (fi + 1, s_), arm, [W, W.lerp(T, 0.5), T], [0.08, 0.055, 0.015], [bn[2 + fi]] * 2, mat_spar, sides=5)
            wing_parts.append(fp)
    parts.append(join(wing_parts, "dragon_Wings"))
    # clips
    arm.animation_data_create()
    nm = [b.name for b in arm.data.bones if b.name.startswith(("WingA", "WingB", "Finger"))]
    act = bpy.data.actions.new("Wings_Flap")
    arm.animation_data.action = act
    for f, ang in ((1, 0), (10, -34), (20, 0), (30, 28), (40, 0)):
        wings.reset_pose(arm)
        for sgn, s_ in ((1, "L"), (-1, "R")):
            wings.pose_rot(arm, "WingA_" + s_, 'Y', sgn * ang)
            wings.pose_rot(arm, "WingB_" + s_, 'Y', sgn * ang * 0.5)
            for i in (1, 2, 3):
                wings.pose_rot(arm, "Finger%d_%s" % (i, s_), 'Y', sgn * ang * 0.4)
        wings.key_pose(arm, f, nm)
    act.use_fake_user = True
    arm.animation_data.action = None
    wings.reset_pose(arm)
    finish("dragon", arm, [mesh], parts, 2.8, "Generic (AnimalArmature + wing bones)")


BUILDERS = dict(wolf=build_wolf, dog=build_dog, fox=build_fox, horse=build_horse, deer=build_deer, spider=build_spider,
                adder=build_adder, hare=build_hare, bear=build_bear, boar=build_boar, goat=build_goat, dragon=build_dragon)

if __name__ == "__main__":
    which = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else list(BUILDERS)
    os.makedirs(os.path.join(HERE, "blend"), exist_ok=True)
    for n in which:
        BUILDERS[n]()
    p = os.path.join(HERE, "export", "animals_meta.json")
    old = json.load(open(p)) if os.path.exists(p) else {}
    old.update(META)
    json.dump(old, open(p, "w"), indent=1)
