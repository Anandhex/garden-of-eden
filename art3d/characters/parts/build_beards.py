"""24 beard/moustache meshes (+ 6 stubble decals in specs.STUBBLE) on Head/Jaw: a clumped shell grown from the lower-face polygons
(so it follows chin/jaw/lips shapes and the Jaw bone through transferred keys and weights) plus moustache tubes, drapes and braids."""
import numpy as np, math
from lib import *
import gen
from gen import HC, norm, smooth01, MB, sweep, ellipsoid, cone, drape, frame_from, surf
from build_hair import lock, x_braid

MZ = 1.5535
JAWB = ["Head", "Jaw", "Neck", "UpperChest", "Chest"]


def jaw_line(ax):
    return 1.488 + 0.095 * (ax / 0.1) ** 1.7


def region(r):
    cheeks, chin, mous, side = r.get("cheeks", False), r.get("chin", None), r.get("mous", False), r.get("side", False)
    cx0, ctop = r.get("cx0", 0.03), r.get("ctop", 1.60)
    cw = r.get("cw", 0.040)
    mw = r.get("mw", 0.034)

    def sel(c):
        ax = abs(c[0])
        z = c[2]
        if c[1] > 0.0:
            return False
        if ax < 0.0285 and MZ - 0.0105 < z < MZ + 0.0095:       # leave the lips free
            return False
        if ax > 0.055 and ((c[1] + 0.017) / 0.046) ** 2 + ((z - 1.615) / 0.060) ** 2 < 1:
            return False
        jl = jaw_line(ax) - r.get("under", 0.0)
        ok = False
        if chin is not None and ax < cw and jl < z < chin:
            ok = True
        if cheeks and ax >= cx0 and jl < z < ctop - 0.04 * (ax < 0.05) - 0.012 * (1 - ax / 0.1):
            ok = True
        if mous and ax < mw and MZ + 0.0095 < z < 1.578 and ax > 0.0:
            ok = True
        if side and ax > 0.072 and 1.575 < z < r.get("side_top", 1.64):
            ok = True
        if r.get("neck") and ax < 0.05 and 1.47 < z < 1.505:
            ok = True
        return ok
    return sel


def chunk(P, N_, warp, Nc):
    # chunky clumps across the face (variation in x and z)
    return np.tanh(2.0 * np.sin(Nc * P[:, 0] * 22 + warp * np.sin(P[:, 2] * 70) + P[:, 2] * 55))


def beard_shell(r, seed=1):
    sel = region(r)
    t0, tc = r.get("t", 0.008), r.get("tchin", 0.012)
    amp, Nc, warp = r.get("amp", 0.003), r.get("N", 3.0), r.get("warp", 2.0)

    def off(P, N_):
        ax = np.abs(P[:, 0])
        chin_w = smooth01(0.06, 0.0, ax) * smooth01(1.552, 1.51, P[:, 2])
        o = t0 + (tc - t0) * chin_w + r.get("tmous", 0.0) * smooth01(1.556, 1.57, P[:, 2]) * smooth01(0.04, 0.02, ax) * (P[:, 2] > 1.556)
        o = o + amp * chunk(P, N_, warp, Nc) * 0.7 + r.get("down", 0.0) * smooth01(1.53, 1.495, P[:, 2]) * chin_w
        return np.maximum(o, 0.002)
    V, F, bnd, V0, N0 = gen.shell(sel, off, edge_fade=(0.55, 0.85))
    cl = chunk(V0, N0, warp, Nc)
    sh = np.clip(0.76 + 0.24 * cl - 0.08 * bnd, 0.4, 1.0)
    return V, F, sh


def moustache(mb, half=0.030, w=0.0075, droop=0.006, curl=0.0, z0=1.5655, thick=0.0075, tail=0.0, out_off=0.0035):
    for sd in (-1, 1):
        n = 9
        pts, nrm = [], []
        for i in range(n):
            s = i / (n - 1)
            x = sd * (0.0015 + s * half)
            z = z0 - droop * s ** 1.4 + curl * s ** 3 - tail * smooth01(0.6, 1.0, s)
            p, nn = surf(x, z)
            if p is None:
                p, nn = np.array([x, -0.14, z]), np.array([0, -1.0, 0])
            pts.append(p + nn * (thick * 0.55 + out_off))
            nrm.append(nn)
        pts = np.array(pts)
        s = np.linspace(0, 1, n)
        wv = w * (1 - 0.55 * s ** 2) * (0.7 + 0.3 * smooth01(0, 0.2, s))
        tv = thick * (1 - 0.4 * s ** 2)
        V, F, S = sweep(pts, wv, tv, sides=8, up=np.array(nrm), shade=np.linspace(0.75, 1.0, n))
        mb.add(V, F, S)


def chin_drape(mb, rng, xs, z, length, w, t, n=1, wobble=0.0, g=0.9, spread=0.0, shade=(0.7, 1.0), forward=0.35):
    for x in xs:
        for k in range(n):
            xx = x + (rng.random() - 0.5) * spread
            p, nn = surf(xx, z)
            if p is None:
                continue
            a = p + nn * 0.006
            lock(mb, a, nn * forward + np.array([0, 0, -1.0]), length * (0.85 + 0.3 * rng.random()), w, t, rng, steps=12, gravity=g, stiff=0.5,
                 wobble=wobble, shade=shade, margin=0.010)


def goatee_tip(mb, length=0.04, w=0.014, z=1.515):
    p, nn = surf(0.0, z)
    path = np.array([p + nn * 0.004, p + nn * 0.010 + np.array([0, 0.004, -length * 0.5]), p + nn * 0.010 + np.array([0, 0.008, -length])])
    t = np.linspace(0, 1, 6)
    pp = np.array([np.interp(t, np.linspace(0, 1, 3), path[:, k]) for k in range(3)]).T
    V, F, S = sweep(pp, np.linspace(w, w * 0.25, 6), np.linspace(w * 0.8, w * 0.2, 6), sides=8, up=np.array([0, -1.0, 0]), shade=np.linspace(0.8, 1.0, 6))
    mb.add(V, F, S)


# name, tags, region, shell params, extras
BEARDS = [
    ("moustache_pencil", ["courtly", "rogue"], dict(mous=True, mw=0.026), dict(t=0.0035, tchin=0.0035, amp=0.0008), [("must", dict(half=0.026, w=0.0035, thick=0.0035, droop=0.002))], False),
    ("moustache_chevron", ["common", "soldier"], dict(mous=True, mw=0.030), dict(t=0.006, tchin=0.006), [("must", dict(half=0.030, w=0.0085, thick=0.0075, droop=0.006))], False),
    ("moustache_walrus", ["rustic", "elder"], dict(mous=True, mw=0.034), dict(t=0.008, tchin=0.008), [("must", dict(half=0.038, w=0.012, thick=0.010, droop=0.014, tail=0.004))], False),
    ("moustache_handlebar", ["courtly", "performer"], dict(mous=True, mw=0.024), dict(t=0.005, tchin=0.005), [("must", dict(half=0.042, w=0.0075, thick=0.0075, droop=0.002, curl=0.020))], False),
    ("fu_manchu", ["scholar", "elder", "warrior"], dict(mous=True, mw=0.028), dict(t=0.005, tchin=0.005),
     [("must", dict(half=0.034, w=0.0085, thick=0.0075, droop=0.0, tail=0.0)), ("fm_tails", {})], False),
    ("goatee_small", ["common", "rogue"], dict(chin=1.542, cw=0.020), dict(t=0.007, tchin=0.011, amp=0.002), [], False),
    ("goatee_long_pointed", ["noble", "elder", "scholar"], dict(chin=1.545, cw=0.022), dict(t=0.007, tchin=0.011), [("tip", dict(length=0.075, w=0.016))], False),
    ("soul_patch", ["performer", "rogue"], dict(chin=1.543, cw=0.009, under=-0.012), dict(t=0.006, tchin=0.008, amp=0.001), [], False),
    ("van_dyke", ["noble", "courtly"], dict(chin=1.544, cw=0.020, mous=True, mw=0.028),
     dict(t=0.007, tchin=0.011), [("must", dict(half=0.030, w=0.0065, thick=0.006, droop=0.003, curl=0.003)), ("tip", dict(length=0.035, w=0.013))], False),
    ("chinstrap", ["rogue", "soldier"], dict(cheeks=True, cx0=0.05, ctop=1.545, chin=1.535, cw=0.05), dict(t=0.005, tchin=0.006), [], False),
    ("mutton_chops", ["soldier", "elder", "rustic"], dict(cheeks=True, cx0=0.055, ctop=1.612, side=True, side_top=1.64), dict(t=0.010, tchin=0.010, amp=0.0035), [], False),
    ("sideburns", ["common", "masculine"], dict(side=True, side_top=1.64, cheeks=True, cx0=0.082, ctop=1.585), dict(t=0.010, tchin=0.010, amp=0.003), [], False),
    ("beard_short_full", ["common", "worker", "masculine"], dict(cheeks=True, ctop=1.598, chin=1.548, cw=0.04, mous=True, mw=0.034, side=True),
     dict(t=0.008, tchin=0.014, tmous=0.002), [], False),
    ("beard_trimmed_neat", ["merchant", "noble", "masculine"], dict(cheeks=True, ctop=1.585, chin=1.546, cw=0.04, mous=True, mw=0.03, side=True),
     dict(t=0.007, tchin=0.011, amp=0.0015, N=2.0), [], False),
    ("beard_long_chest", ["elder", "wanderer", "scholar"], dict(cheeks=True, ctop=1.598, chin=1.548, cw=0.045, mous=True, mw=0.034, side=True, neck=True, under=0.01),
     dict(t=0.010, tchin=0.016, amp=0.004), [("cdrape", dict(xs=[-0.025, -0.008, 0.008, 0.025], z=1.514, length=0.22, w=0.026, t=0.012))], True),
    ("beard_elder_white_long", ["elder", "wizard", "sage"], dict(cheeks=True, ctop=1.60, chin=1.548, cw=0.045, mous=True, mw=0.034, side=True, neck=True, under=0.01),
     dict(t=0.010, tchin=0.016, amp=0.004), [("cdrape", dict(xs=[-0.03, -0.018, -0.006, 0.006, 0.018, 0.03], z=1.512, length=0.40, w=0.026, t=0.013, wobble=0.1))], True),
    ("beard_forked", ["warrior", "noble", "wanderer"], dict(cheeks=True, ctop=1.592, chin=1.548, cw=0.04, mous=True, mw=0.032, side=True),
     dict(t=0.008, tchin=0.013), [("cdrape", dict(xs=[-0.016, 0.016], z=1.512, length=0.20, w=0.028, t=0.013, forward=0.2))], True),
    ("beard_dwarf_two_braids", ["dwarf", "warrior"], dict(cheeks=True, ctop=1.60, chin=1.548, cw=0.045, mous=True, mw=0.034, side=True, neck=True, under=0.01),
     dict(t=0.010, tchin=0.016, amp=0.004), [("cbraid", dict(xs=[-0.018, 0.018], z=1.513, length=0.30, seg=10, w=0.017))], True),
    ("beard_dwarf_braid_single", ["dwarf", "smith"], dict(cheeks=True, ctop=1.592, chin=1.548, cw=0.04, mous=True, mw=0.03, side=True),
     dict(t=0.009, tchin=0.014), [("cbraid", dict(xs=[0.0], z=1.513, length=0.36, seg=13, w=0.022)), ("must", dict(half=0.032, w=0.010, thick=0.009, droop=0.010))], True),
    ("beard_viking", ["warrior", "northern", "wanderer"], dict(cheeks=True, ctop=1.60, chin=1.548, cw=0.045, mous=True, mw=0.036, side=True, neck=True, under=0.01),
     dict(t=0.010, tchin=0.015, amp=0.004),
     [("cbraid", dict(xs=[-0.022, 0.022], z=1.513, length=0.24, seg=9, w=0.015)), ("cdrape", dict(xs=[0.0], z=1.512, length=0.20, w=0.028, t=0.013)),
      ("must", dict(half=0.038, w=0.011, thick=0.009, droop=0.012, tail=0.006))], True),
    ("balbo", ["merchant", "performer", "noble"], dict(chin=1.546, cw=0.032, mous=True, mw=0.026), dict(t=0.006, tchin=0.010), [("must", dict(half=0.028, w=0.007, thick=0.006, droop=0.003))], False),
    ("neckbeard", ["common", "worker"], dict(chin=1.505, cw=0.05, neck=True, under=0.03, cheeks=True, cx0=0.05, ctop=1.52), dict(t=0.007, tchin=0.011, amp=0.002), [], False),
    ("beard_wild_unkempt", ["hermit", "wanderer", "orc"], dict(cheeks=True, ctop=1.605, chin=1.548, cw=0.045, mous=True, mw=0.036, side=True, neck=True, under=0.012),
     dict(t=0.012, tchin=0.018, amp=0.008, N=4.0, warp=3.0), [("spikes", dict(n=16))], False),
    ("scraggly_chin", ["elder", "orc", "frail"], dict(chin=1.543, cw=0.024), dict(t=0.004, tchin=0.006, amp=0.0015),
     [("cdrape", dict(xs=[-0.008, 0.0, 0.008], z=1.513, length=0.07, w=0.008, t=0.006, wobble=0.1))], False),
]


def compile_beard(i):
    name, tags, reg, sp, extras, long_ = BEARDS[i]
    rng = np.random.default_rng(300 + i)
    mb = MB()
    if reg:
        V, F, sh = beard_shell(dict(reg, **sp), seed=i)
        if len(V):
            mb.add(V, F, sh)
    for kind, p in extras:
        if kind == "must":
            moustache(mb, **p)
        elif kind == "cdrape":
            chin_drape(mb, rng, p["xs"], p["z"], p["length"], p["w"], p["t"], wobble=p.get("wobble", 0.0), forward=p.get("forward", 0.35))
        elif kind == "cbraid":
            for x in p["xs"]:
                pt, nn = surf(x, p["z"])
                a = pt + nn * 0.008
                pts = drape(a, nn * 0.3 + np.array([0, 0, -1.0]), p["length"], steps=14, gravity=0.9, stiff=0.5, margin=0.012)
                x_braid(mb, dict(path=pts, seg=p["seg"], w=p["w"]), rng)
        elif kind == "tip":
            goatee_tip(mb, **p)
        elif kind == "fm_tails":
            for sd in (-1, 1):
                pt, nn = surf(sd * 0.030, 1.552)
                pts = drape(pt + nn * 0.006, nn * 0.4 + np.array([sd * 0.1, 0, -1.0]), 0.12, steps=8, gravity=1.0, stiff=0.5, margin=0.010)
                s = np.linspace(0, 1, len(pts))
                V, F, S = sweep(pts, 0.009 * (1 - 0.5 * s), 0.008 * (1 - 0.4 * s), sides=8, up=np.array([0, -1.0, 0]), shade=np.linspace(0.75, 1.0, len(pts)))
                mb.add(V, F, S)
        elif kind == "spikes":
            P, N, polys = gen.head_mesh()
            sel = region(dict(reg))
            idx = [k for k in range(len(P)) if P[k][2] < 1.57 and P[k][2] > 1.50 and P[k][1] < 0.0 and abs(P[k][0]) < 0.1 and sel(P[k])]
            for k in range(p["n"]):
                if not idx:
                    break
                j = idx[rng.integers(len(idx))]
                d = norm(N[j] * 0.6 + np.array([0, 0, -0.9]) + (rng.random(3) - 0.5) * 0.4)
                V, F = cone(P[j] + N[j] * 0.006, d, 0.04 + 0.03 * rng.random(), 0.012, seg=5)
                mb.add(V, F, np.linspace(0.6, 1.0, len(V)))
    return mb.result()


def build():
    out = []
    mat = get_material("Hair", (0.3, 0.18, 0.09))
    for i, (name, tags, reg, sp, extras, long_) in enumerate(BEARDS):
        V, F, S = compile_beard(i)
        oname = f"Beard_{i+1:02d}_{name}"
        vc = [(s * 0.95,) * 3 for s in S]
        bones = JAWB if long_ else ["Head", "Jaw", "Neck"]
        ob = add_part(oname, V, F, bones, mat, vcol=vc)
        ob["gd_category"] = "beard"
        out.append(dict(obj=oname, id=f"beard_{i+1:02d}_{name}", name=name, tags=tags, long=long_, bones=bones, tris=sum(len(f) - 2 for f in F)))
    return out
