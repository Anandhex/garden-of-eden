"""Generated birds (crow, heron): procedural low-poly body + simple Generic rig + basic clips (Idle, Walk, Peck, Fly).

    Blender -b -P art3d/creatures/birds.py -- [crow heron]

Real-world size in metres, Blender axes (faces -Y). Rest pose = standing, wings folded.
"""
import bpy, sys, os, math, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib
from lib import *
import wings

META = {}

P = {
    "crow": dict(body=(0.075, 0.15, 0.075), pitch=18, leg=0.11, leg_r=0.007, neck_len=0.06, neck_pts=[(0, -0.11, 0.05), (0, -0.16, 0.10), (0, -0.19, 0.145)],
                 head=(0.036, 0.055, 0.04), beak=(0.07, 0.022, 0.0), tail_len=0.2, tail_w=0.1, wing_len=0.3, wing_w=0.07,
                 col=dict(body="#2b2b33", belly="#34343c", head="#2b2b33", wing="#23232b", tail="#23232b", beak="#1e1e22", leg="#2a2622", eye="#e8e0cc", sheen="#3d4560"),
                 span=0.95, toe=0.05),
    "heron": dict(body=(0.085, 0.22, 0.095), pitch=38, leg=0.46, leg_r=0.009, neck_len=0.36, neck_pts=[(0, -0.14, 0.12), (0, -0.2, 0.22), (0, -0.14, 0.34), (0, -0.2, 0.46), (0, -0.28, 0.54)],
                  head=(0.03, 0.065, 0.032), beak=(0.17, 0.022, 0.0), tail_len=0.13, tail_w=0.07, wing_len=0.5, wing_w=0.1,
                  col=dict(body="#8c98a2", belly="#d4d6d0", head="#e6e6e0", wing="#6f7c88", tail="#6f7c88", beak="#c8a24a", leg="#8a7a4a", eye="#e0c040", sheen="#aab4bc", crest="#2a2e36"),
                  span=1.7, toe=0.1),
}


def build(name):
    p = P[name]
    reset()
    c = p["col"]
    mats = {k: make_mat("%s_%s" % (name, k), srgb(v)) for k, v in c.items()}
    gz = p["leg"]
    rx, ry, rz = p["body"]
    bc = Vector((0, 0, gz + rz * 0.8))
    pitch = math.radians(p["pitch"])
    # ---- armature
    arm_d = bpy.data.armatures.new("Armature"); arm = bpy.data.objects.new("Armature", arm_d)
    bpy.context.collection.objects.link(arm)
    npts = [Vector(q) + Vector((0, 0, gz * 0.0)) + Vector((0, 0, gz)) for q in p["neck_pts"]]
    npts = [Vector((q.x, q.y + 0.0, q.z + rz * 0.2)) for q in npts]
    hb = npts[-1]
    specs = [("Root", (0, 0, 0), (0, 0, 0.05), None), ("Body", bc + Vector((0, ry * 0.5, 0)), bc + Vector((0, -ry * 0.5, 0.02)), "Root")]
    nb = []
    for i in range(len(npts) - 1):
        specs.append(("Neck%d" % (i + 1), npts[i], npts[i + 1], "Body" if i == 0 else "Neck%d" % i)); nb.append("Neck%d" % (i + 1))
    head_dir = Vector((0, -1, 0.05)).normalized()
    specs.append(("Head", hb, hb + head_dir * p["head"][1] * 2.2, nb[-1]))
    shoulder_z = bc.z + rz * 0.35
    tail_base = Vector((0, ry * 0.85, bc.z - 0.01))
    specs.append(("Tail", tail_base, tail_base + Vector((0, p["tail_len"], -0.04)), "Body"))
    for sgn, S_ in ((1, "L"), (-1, "R")):
        sh = Vector((sgn * rx * 0.85, -ry * 0.1, shoulder_z))
        L = p["wing_len"]
        specs += [("Wing1_" + S_, sh, sh + Vector((sgn * 0.01, L * 0.45, -0.02)), "Body"),
                  ("Wing2_" + S_, sh + Vector((sgn * 0.01, L * 0.45, -0.02)), sh + Vector((sgn * 0.012, L * 0.8, -0.03)), "Wing1_" + S_),
                  ("Wing3_" + S_, sh + Vector((sgn * 0.012, L * 0.8, -0.03)), sh + Vector((sgn * 0.014, L * 1.0, -0.04)), "Wing2_" + S_)]
        hip = Vector((sgn * rx * 0.55, bc.y + ry * 0.1, bc.z - rz * 0.6))
        knee = Vector((sgn * rx * 0.55, hip.y + 0.02, hip.z - (hip.z) * 0.45))
        ankle = Vector((sgn * rx * 0.55, hip.y - 0.005, 0.03))
        specs += [("Thigh_" + S_, hip, knee, "Body"), ("Shin_" + S_, knee, ankle, "Thigh_" + S_),
                  ("Foot_" + S_, ankle, ankle + Vector((0, -p["toe"], -0.025)), "Shin_" + S_)]
    lib.add_bones(arm, specs)
    objs = []
    # ---- body (ellipsoid pitched)
    body = ellipsoid_mesh("%s_Body" % name, (0, 0, 0), (rx, ry, rz), seg=14, rings=8, mat=mats["body"])
    for v in body.data.vertices:
        co = v.co.copy()
        # pitch the body about X (tail down): rotate in YZ
        y = co.y * math.cos(pitch) - co.z * math.sin(pitch) * -1 * 0
        co2 = Vector((co.x, co.y * math.cos(pitch) + co.z * math.sin(pitch), -co.y * math.sin(pitch) + co.z * math.cos(pitch)))
        # front (-y) raised: -y * sin -> +z when pitch>0 ; tail down
        v.co = co2 + bc
    # belly colour on lower half
    belly = mats["belly"]
    body.data.materials.append(belly)
    for pg in body.data.polygons:
        zc = sum(body.data.vertices[i].co.z for i in pg.vertices) / len(pg.vertices)
        if zc < bc.z - rz * 0.1:
            pg.material_index = 1
    weight_all(body, "Body", arm)
    objs.append(body)
    # ---- neck: skinned tube
    radii = [rx * 0.7] + [p["head"][0] * (0.75 if name == "heron" else 0.95)] * (len(npts) - 1)
    if name == "crow":
        radii = [rx * 0.75, 0.04, 0.034]
    neck = tube("%s_Neck" % name, arm, npts, radii, nb, mats["head" if name == "heron" else "body"], sides=8)
    objs.append(neck)
    # ---- head + beak
    hx, hy, hz = p["head"]
    hc = hb + head_dir * hy * 0.8
    head = ellipsoid_mesh("%s_Head" % name, tuple(hc), (hx, hy, hz), seg=10, rings=6, mat=mats["head"])
    weight_all(head, "Head", arm); objs.append(head)
    bl = p["beak"][0]
    bs = hb + head_dir * hy * 1.4
    beak = cone_mesh("%s_Beak" % name, bs + Vector((0, 0, -0.004)), bs + head_dir * bl + Vector((0, 0, -0.012 if name == "crow" else -0.02)), hx * 0.55, 0.003, sides=6, rings=3, mat=mats["beak"], flat=0.8)
    weight_all(beak, "Head", arm); objs.append(beak)
    for sgn in (1, -1):
        eye = ellipsoid_mesh("%s_Eye%s" % (name, "L" if sgn > 0 else "R"), (sgn * hx * 0.85, hc.y - hy * 0.35, hc.z + hz * 0.25), (0.006, 0.006, 0.006), seg=6, rings=4, mat=mats["eye"])
        weight_all(eye, "Head", arm); objs.append(eye)
    if "crest" in mats:
        for i in range(3):
            f = wings.feather("%s_Crest%d" % (name, i), hc + Vector(((i - 1) * 0.008, hy * 0.2, hz * 0.7)), (0, 0.9, 0.12 - 0.05 * i), 0.16 - 0.03 * i, 0.012, (1, 0, 0), thick=0.002, mat=mats["crest"])
            weight_all(f, "Head", arm); objs.append(f)
        # black eye-stripe
    # ---- tail feathers
    for i in range(5):
        a = (i - 2) / 2 * 0.28
        f = wings.feather("%s_TailF%d" % (name, i), tail_base, (math.sin(a), 0.95, -0.28), p["tail_len"] * (1.0 - 0.1 * abs(i - 2)), p["tail_w"] * 0.4, (1, 0, 0), thick=0.003, mat=mats["tail"])
        weight_all(f, "Tail", arm); objs.append(f)
    # ---- wings: folded along the body; layered feathers
    for sgn, S_ in ((1, "L"), (-1, "R")):
        sh = Vector((sgn * rx * 0.85, -ry * 0.1, shoulder_z))
        L = p["wing_len"]
        for layer in range(2):
            for i in range(8):
                t = i / 7
                base = sh + Vector((sgn * (0.006 + 0.004 * layer), L * 0.05 + L * 0.55 * t, -0.01 - 0.018 * layer - 0.01 * t))
                bone = "Wing1_" + S_ if t < 0.5 else "Wing2_" + S_
                ln = L * (0.45 + 0.35 * t) * (1 - 0.25 * layer)
                f = wings.feather("%s_W%s%d_%d" % (name, S_, layer, i), base, (sgn * 0.05, 1.0, -0.08 - 0.05 * t), ln, p["wing_w"] * 0.85, (1, 0, 0), thick=0.003,
                                  mat=mats["wing"])
                weight_all(f, bone, arm); objs.append(f)
        cov = ellipsoid_mesh("%s_WingCov%s" % (name, S_), tuple(sh + Vector((sgn * 0.01, L * 0.25, -0.01))), (0.014, L * 0.3, 0.05), seg=8, rings=5, mat=mats["sheen"] if "sheen" in mats else mats["wing"])
        weight_all(cov, "Wing1_" + S_, arm); objs.append(cov)
    # ---- legs and toes
    for sgn, S_ in ((1, "L"), (-1, "R")):
        hip = Vector((sgn * rx * 0.55, bc.y + ry * 0.1, bc.z - rz * 0.6))
        knee = Vector((sgn * rx * 0.55, hip.y + 0.02, hip.z - hip.z * 0.45))
        ankle = Vector((sgn * rx * 0.55, hip.y - 0.005, 0.03))
        th = tube("%s_Thigh%s" % (name, S_), arm, [hip, knee, ankle], [p["leg_r"] * 2.4, p["leg_r"] * 1.1, p["leg_r"]], ["Thigh_" + S_, "Shin_" + S_], mats["leg"], sides=6)
        objs.append(th)
        for k, ang in enumerate((-0.45, 0.0, 0.45)):
            tip = Vector((ankle.x + math.sin(ang) * p["toe"], ankle.y - math.cos(ang) * p["toe"], 0.006))
            o = cone_mesh("%s_Toe%s%d" % (name, S_, k), ankle, tip, p["leg_r"] * 0.9, 0.003, sides=5, rings=2, mat=mats["leg"])
            weight_all(o, "Foot_" + S_, arm); objs.append(o)
        o = cone_mesh("%s_ToeB%s" % (name, S_), ankle, Vector((ankle.x, ankle.y + p["toe"] * 0.5, 0.006)), p["leg_r"] * 0.9, 0.003, sides=5, rings=2, mat=mats["leg"])
        weight_all(o, "Foot_" + S_, arm); objs.append(o)
    shade = lambda: None
    # smooth shading
    for o in objs:
        for pg in o.data.polygons:
            pg.use_smooth = True
    # ---- clips
    bn = [b.name for b in arm.data.bones]
    arm.animation_data_create()

    def clip(nm, frames, fn, loop_end=None):
        act = bpy.data.actions.new(nm)
        arm.animation_data.action = act
        for f, v in frames:
            wings.reset_pose(arm)
            fn(v)
            wings.key_pose(arm, f, bn)
        act.use_fake_user = True
        arm.animation_data.action = None
        wings.reset_pose(arm)

    def idle(v):
        wings.pose_rot(arm, "Body", 'X', 2.0 * v)
        for i in range(len(nb)):
            wings.pose_rot(arm, nb[i], 'X', -3.0 * v)
        wings.pose_rot(arm, "Head", 'Z', 14 * (v if abs(v) < 2 else 0))
    clip("Idle", [(1, 0), (20, 1), (40, 0), (60, -1), (80, 0)], idle)

    def walk(v):
        wings.pose_rot(arm, "Thigh_L", 'X', 28 * v); wings.pose_rot(arm, "Thigh_R", 'X', -28 * v)
        wings.pose_rot(arm, "Shin_L", 'X', -12 * max(0, v)); wings.pose_rot(arm, "Shin_R", 'X', 12 * min(0, v))
        for b in nb:
            wings.pose_rot(arm, b, 'X', 5 * v)
    clip("Walk", [(1, 0), (6, 1), (12, 0), (18, -1), (24, 0)], walk)

    def peck(v):
        for i, b in enumerate(nb):
            wings.pose_rot(arm, b, 'X', 38 * v / len(nb) * 1.6)
        wings.pose_rot(arm, "Head", 'X', 20 * v)
    clip("Peck", [(1, 0), (6, 1), (12, 0), (18, 1), (24, 0), (36, 0)], peck)

    def fly(v):
        for sgn, S_ in ((1, "L"), (-1, "R")):
            wings.pose_rot(arm, "Wing1_" + S_, 'Z', -sgn * 80)
            wings.pose_rot(arm, "Wing1_" + S_, 'Y', sgn * 38 * v)
            wings.pose_rot(arm, "Wing2_" + S_, 'Y', sgn * 22 * v)
            wings.pose_rot(arm, "Wing3_" + S_, 'Y', sgn * 16 * v)
        for S_ in "LR":
            wings.pose_rot(arm, "Thigh_" + S_, 'X', -60); wings.pose_rot(arm, "Shin_" + S_, 'X', 50)
    clip("Fly", [(1, -1), (8, 0), (16, 1), (24, 0), (32, -1)], fly)
    arm.name = "Armature"; arm_d.name = "Armature"
    smooth_normals(objs)
    out = os.path.join(EXPORT, name + ".fbx")
    export_fbx(out, [arm] + objs, 1.0, True)
    META[name] = dict(kind="bird", tris=sum(tri_count(o) for o in objs), bones=len(arm.data.bones), size_kb=os.path.getsize(out) // 1024,
                      parts=[o.name for o in objs][:8] + ["..."], anims=["Idle", "Walk", "Peck", "Fly"], span_m=p["span"], rig="Generic (generated)")
    if os.environ.get("KEEP_BLEND"):
        os.makedirs(os.path.join(HERE, "blend"), exist_ok=True)
        bpy.ops.wm.save_as_mainfile(filepath=os.path.join(HERE, "blend", name + ".blend"))
    print("BUILT", name, META[name])


if __name__ == "__main__":
    which = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else list(P)
    os.makedirs(os.path.join(HERE, "blend"), exist_ok=True)
    for n in which:
        build(n)
    pth = os.path.join(EXPORT, "animals_meta.json")
    old = json.load(open(pth)) if os.path.exists(pth) else {}
    old.update(META)
    json.dump(old, open(pth, "w"), indent=1)
