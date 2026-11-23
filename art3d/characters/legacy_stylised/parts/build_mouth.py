"""Inner mouth (dark cavity), tongue and teeth on the Jaw bone: upper teeth weighted to Head, lower teeth / tongue to Jaw, the cavity
split between both.  Teeth styles: even, gap, fangs, broken, small, buck.  Opening the Jaw bone (talking) moves lower teeth and tongue."""
import numpy as np, math
from lib import *
import gen
from gen import ellipsoid

# 2026-11: fitted to the real mouth cavity of the full-resolution head (lip contact from the face rig), built in the new frame
_FR = META["faceRig"]
MZ = _FR["mouthCentre"][2]
MY = _FR.get("innerLipY", _FR["mouthCentre"][1] + 0.006) - 0.0062   # so that the teeth front sits 1 mm behind the inner lip ring
MHW = _FR["mouthWidth"] / 2
STYLES = [("even", ["common"]), ("gap", ["rustic"]), ("fangs", ["orc", "feral", "vampire"]), ("broken", ["outcast", "fighter", "elder"]),
          ("small", ["child", "elf"]), ("buck", ["rustic", "comic"])]


def rot_z(a):
    c, s = math.cos(a), math.sin(a)
    return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1.0]])


def teeth_mesh(style, seed=1):
    rng = np.random.default_rng(seed)
    V, F, Z = [], [], []
    n = 10
    for row in ("up", "lo"):
        for i in range(n):
            u = (i - (n - 1) / 2) / ((n - 1) / 2)             # -1..1
            x = u * MHW * 0.74 * (0.9 if row == "lo" else 1.0)
            if style == "gap" and row == "up" and abs(u) < 0.2:
                x += np.sign(u) * 0.0014
            y = MY + 0.0062 + (0.0012 if row == "lo" else 0.0) + 48 * x * x + (-0.003 if (style == "buck" and row == "up") else 0.0)
            wx = 0.0017 if abs(u) < 0.45 else 0.0015
            hz = (0.0042 if abs(u) < 0.25 else (0.0036 if abs(u) < 0.6 else 0.0034)) if row == "up" else 0.0030
            if style == "small":
                hz *= 0.75
                wx *= 0.85
            if style == "broken" and rng.random() < 0.35:
                hz *= 0.55 if rng.random() < 0.6 else 0.0
            if hz <= 0:
                continue
            zc = MZ + 0.0033 + (0.0042 - hz) * 0.5 if row == "up" else MZ - 0.0038
            if row == "up":
                zc = MZ - 0.0005 + hz
            else:
                zc = MZ - 0.0007 - hz
            if style == "fangs" and abs(u) > 0.5 and abs(u) < 0.7:
                ext = 0.0058 if row == "up" else 0.004
                if row == "up":
                    zc -= ext * 0.5
                else:
                    zc += ext * 0.5
                hz += ext * 0.5
            if style == "buck" and row == "lo":
                hz *= 0.8
            v, f = ellipsoid((x, y, zc), (wx, 0.0028, hz), rot=rot_z(math.atan(110 * x)), seg=7, rings=5)
            o = sum(len(a) for a in V)
            V.append(v)
            F += [tuple(i + o for i in q) for q in f]
    return np.concatenate(V), F


def build():
    out = []
    mats = {"mouth": get_material("MouthDark", (0.16, 0.05, 0.07)), "teeth": get_material("Teeth", (0.95, 0.92, 0.84)),
            "tongue": get_material("Tongue", (0.8, 0.34, 0.38))}
    # cavity
    V, F = ellipsoid((0, MY + 0.026, MZ - 0.002), (0.012, 0.010, 0.007), seg=12, rings=8)   # small dark throat shadow (the head has its own cavity now)
    F = [tuple(reversed(f)) for f in F]            # inside-out: the cavity is only visible from inside the mouth
    wj = gen.smooth01(MZ + 0.003, MZ - 0.004, V[:, 2])
    ob = add_part("MouthIn_01", V, F, ["Head", "Jaw"], mats["mouth"], weights={"Head": 1 - wj, "Jaw": wj}, frame="new")
    ob["gd_category"] = "mouth_interior"
    out.append(dict(obj="MouthIn_01", kind="interior", bones=["Head", "Jaw"], tris=sum(len(f) - 2 for f in F)))
    V, F = ellipsoid((0, MY + 0.017, MZ - 0.0062), (0.0125, 0.012, 0.0030), seg=10, rings=6)
    ob = add_part("Tongue_01", V, F, ["Jaw"], mats["tongue"], weights={"Jaw": np.ones(len(V))}, frame="new")
    ob["gd_category"] = "tongue"
    out.append(dict(obj="Tongue_01", kind="tongue", bones=["Jaw"], tris=sum(len(f) - 2 for f in F)))
    for i, (st, tags) in enumerate(STYLES):
        V, F = teeth_mesh(st, seed=i + 1)
        wj = gen.smooth01(MZ - 0.0002, MZ - 0.0012, V[:, 2])
        name = f"Teeth_{i+1:02d}_{st}"
        ob = add_part(name, V, F, ["Head", "Jaw"], mats["teeth"], weights={"Head": 1 - wj, "Jaw": wj}, frame="new")
        ob["gd_category"] = "teeth"
        out.append(dict(obj=name, kind="teeth", style=st, tags=tags, bones=["Head", "Jaw"], tris=sum(len(f) - 2 for f in F)))
    return out
