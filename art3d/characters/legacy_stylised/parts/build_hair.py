"""30 hairstyles (+ hat variants) as skinned meshes on the Head (and Neck/Chest for long hair). Big simple chunks:
a clumped scalp shell grown from the head's own polygons plus locks (draped tubes), buns, tails, braids, curls, spikes.
Shape keys and weights are transferred from the body (nearest vertices), so hair follows Face_Long, Forehead_High etc."""
import numpy as np, math
from lib import *
import gen
from gen import HC, norm, smooth01, sdf, MB, sweep, ellipsoid, cone, drape, frame_from, to_polar

LONG_BONES = ["Head", "Neck", "UpperChest", "Chest", "Spine"]


def on_head(zrel, phi, off=0.006):
    d = np.array([math.sin(phi), -math.cos(phi), 0.0])
    z = HC[2] + zrel
    lo, hi = 0.02, 0.25
    for _ in range(26):
        mid = (lo + hi) / 2
        p = np.array([HC[0] + d[0] * mid, HC[1] + d[1] * mid, z])
        if sdf(p)[0] > off:
            hi = mid
        else:
            lo = mid
    p = np.array([HC[0] + d[0] * hi, HC[1] + d[1] * hi, z])
    return p, d


# ------------------------------------------------------------------ cap (scalp shell)
def clump(P, N_, warp):
    v = P - HC
    phi = np.arctan2(v[:, 0], -v[:, 1])
    th = np.arccos(np.clip(v[:, 2] / (np.linalg.norm(v, axis=1) + 1e-9), -1, 1))
    return np.tanh(2.0 * np.sin(N_ * phi + warp * np.sin(3.0 * th) + 2.1 * th))


def cap_shell(c, seed=1, hat=False):
    hf, hs, hb = c.get("hf", 0.09), c.get("hs", 0.05), c.get("hb", -0.05)
    hm = c.get("hm", None)
    ceil = c.get("ceil", 9.0)
    xs = [0, 0.6, 1.2, 1.57, 2.3, 3.14]
    ys = [hf, hm if hm is not None else (hf + hs) / 2 + 0.01, c.get("hq", hs + 0.02), hs, (hs + hb) / 2 + 0.01, hb]
    ears = c.get("ears", False)
    patchy = c.get("patchy", 0.0)
    rng = np.random.default_rng(seed)

    def sel(cen):
        z, phi = to_polar(cen)
        hl = np.interp(abs(phi), xs, ys)
        if z < hl or z > ceil:
            return False
        if not ears and abs(cen[0]) > 0.055:
            if ((cen[1] + 0.017) / 0.046) ** 2 + ((cen[2] - 1.615) / 0.060) ** 2 < 1:
                return False
        if patchy:
            n = math.sin(cen[0] * 55 + 2.3) * math.sin(cen[1] * 50 - 1.1) + math.sin(cen[2] * 60 + cen[0] * 30)
            if n < patchy and z > hl + 0.015:
                return False
        return True
    thick, amp, Nc, warp = c.get("thick", 0.008), c.get("amp", 0.003), c.get("N", 9), c.get("warp", 2.0)
    vol = c.get("vol", 0.0) * (0.35 if hat else 1.0)
    volb = c.get("volb", 0.0)

    def off(P, N_):
        z, phi = to_polar(P)
        cl = clump(P, Nc, warp)
        o = thick + vol * smooth01(0.02, 0.14, z) + volb * smooth01(1.5, 2.8, np.abs(phi)) * smooth01(-0.05, 0.08, z)
        o = o + amp * cl * (0.4 + 0.6 * smooth01(hs, hs + 0.05, z))
        return np.maximum(o, 0.0022)
    V, F, bnd, V0, N0 = gen.shell(sel, off)
    cl = clump(V0, Nc, warp)
    shade = np.clip(0.74 + 0.26 * cl - 0.10 * bnd, 0.4, 1.0)
    return V, F, shade, V0, N0


# ------------------------------------------------------------------ extras
def lock(mb, anchor, d0, length, w, t, rng, steps=12, gravity=0.8, stiff=0.5, wobble=0.0, shade=(0.62, 1.0), margin=0.010, sides=8):
    side = np.array([math.cos(rng.random() * 6), math.sin(rng.random() * 6), 0.0])
    pts = drape(anchor, d0, length, steps=steps, gravity=gravity, stiff=stiff, margin=margin, rng=rng, wobble=wobble, side=side)
    s = np.linspace(0, 1, len(pts))
    wv = w * (1 - 0.45 * s ** 1.6)
    tv = t * (1 - 0.35 * s ** 1.5)
    sh = shade[0] + (shade[1] - shade[0]) * s + (rng.random() - 0.5) * 0.08
    V, F, S = sweep(pts, wv, tv, sides=sides, shade=sh)
    mb.add(V, F, S)
    return pts


def x_drape(mb, p, rng):
    n = p["n"]
    phis = p["phis"] if not isinstance(p["phis"], tuple) else np.linspace(p["phis"][0], p["phis"][1], n)
    for i in range(n):
        phi = phis[i] + (rng.random() - 0.5) * p.get("jit", 0.06)
        z0 = p["z0"] + (rng.random() - 0.5) * p.get("zjit", 0.02)
        a, d = on_head(z0, phi, 0.006)
        out = np.array([d[0], d[1], 0.0])
        L = p["length"] * (1 + (rng.random() - 0.5) * p.get("ljit", 0.25))
        lock(mb, a, out * p.get("out", 0.35) + np.array([0, 0, -1.0]) * 0.5, L, p.get("w", 0.022), p.get("t", 0.010), rng,
             steps=p.get("steps", 12), gravity=p.get("g", 0.8), stiff=p.get("stiff", 0.5), wobble=p.get("wobble", 0.0),
             shade=p.get("shade", (0.62, 1.0)), margin=p.get("margin", 0.010))


def x_fringe(mb, p, rng):
    n = p["n"]
    for i in range(n):
        phi = p.get("phi0", -0.7) + (p.get("phi1", 0.7) - p.get("phi0", -0.7)) * (i + 0.5) / n + (rng.random() - 0.5) * 0.05
        a, d = on_head(p.get("z0", 0.105), phi, 0.005)
        fwd = np.array([d[0], d[1], 0.0])
        sweepv = np.array([p.get("sweep", 0.0), 0, 0])
        L = p.get("length", 0.07) * (1 + (rng.random() - 0.5) * 0.3)
        lock(mb, a, fwd * p.get("out", 0.9) + sweepv + np.array([0, 0, -0.5]), L, p.get("w", 0.020), p.get("t", 0.009), rng,
             steps=9, gravity=p.get("g", 0.9), stiff=p.get("stiff", 0.7), margin=0.008, shade=(0.75, 1.0))


def x_ponytail(mb, p, rng):
    a, d = on_head(p["z"], math.pi, 0.004)
    for k in range(p.get("n", 3)):
        off = (k - (p.get("n", 3) - 1) / 2) * 0.016
        aa = a + np.array([off, 0.0, 0.004 * k])
        lock(mb, aa, np.array([0, 0.9, 0.0]) + np.array([off * 4, 0, -p.get("rise", -0.3)]), p["length"] * (1 - 0.06 * abs(k - 1)),
             p.get("w", 0.026), p.get("t", 0.020), rng, steps=14, gravity=p.get("g", 1.0), stiff=p.get("stiff", 0.9), margin=0.012,
             wobble=p.get("wobble", 0.0), shade=(0.7, 1.0), sides=9)
    # tie
    V, F = ellipsoid(a + np.array([0, 0.012, 0.0]), (0.034, 0.016, 0.020), seg=8, rings=5)
    mb.add(V, F, 0.45)


def x_bun(mb, p, rng):
    V, F = ellipsoid(p["pos"], p["r"], seg=10, rings=7)
    mb.add(V, F, 0.92)
    # swirl band
    c = np.asarray(p["pos"])
    r = np.asarray(p["r"])
    V, F = ellipsoid(c + np.array([0, 0, -r[2] * 0.15]), (r[0] * 1.06, r[1] * 1.06, r[2] * 0.30), seg=10, rings=4)
    mb.add(V, F, 0.62)
    if p.get("tie"):
        V, F = ellipsoid(c + np.array([0, 0, -r[2] * 0.85]), (r[0] * 0.65, r[1] * 0.65, r[2] * 0.22), seg=8, rings=4)
        mb.add(V, F, 0.4)


def x_braid(mb, p, rng):
    pts = p["path"] if "path" in p else None
    if pts is None:
        a, d = on_head(p["z0"], p["phi"], 0.008)
        pts = drape(a, np.array(p.get("d0", [0, 0.2, -1.0])), p["length"], steps=16, gravity=p.get("g", 1.0), stiff=p.get("stiff", 0.6), margin=0.012)
    n = p.get("seg", 12)
    L = np.cumsum(np.r_[0, np.linalg.norm(np.diff(pts, axis=0), axis=1)])
    w = p.get("w", 0.018)
    for i in range(n):
        s = (i + 0.5) / n * L[-1]
        c = np.array([np.interp(s, L, pts[:, k]) for k in range(3)])
        s2 = min(s + L[-1] / n * 0.5, L[-1])
        c2 = np.array([np.interp(s2, L, pts[:, k]) for k in range(3)])
        tan = norm(c2 - c + 1e-9)
        R = frame_from(tan, up=c - HC)
        side = R[:, 0] * w * 0.38 * (1 if i % 2 == 0 else -1)
        taper = 1 - 0.55 * (i / n) ** 1.5
        V, F = ellipsoid(c + side, (w * taper, L[-1] / n * 0.75, w * 0.82 * taper), rot=R, seg=8, rings=5)
        mb.add(V, F, 0.74 + 0.22 * (i % 2))
    V, F = ellipsoid(pts[-1], (0.011, 0.011, 0.009), seg=6, rings=4)
    mb.add(V, F, 0.45)


def x_spheres(mb, p, P, N_, rng):
    z, phi = to_polar(P)
    idx = [i for i in range(len(P)) if z[i] > p.get("zmin", 0.03) and (abs(phi[i]) > p.get("phimin", 0.0))]
    if not idx:
        return
    for k in range(p["n"]):
        i = idx[rng.integers(len(idx))]
        r = p["r"] * (0.8 + 0.5 * rng.random())
        c = P[i] + N_[i] * (p.get("lift", 0.012) + r * 0.5) + (rng.random(3) - 0.5) * 0.008
        V, F = ellipsoid(c, (r, r, r * 0.9), seg=7, rings=5)
        mb.add(V, F, 0.7 + 0.3 * rng.random())


def x_spikes(mb, p, P, N_, rng):
    z, phi = to_polar(P)
    idx = [i for i in range(len(P)) if z[i] > p.get("zmin", 0.07)]
    for k in range(p["n"]):
        i = idx[rng.integers(len(idx))]
        d = norm(N_[i] * 0.8 + np.array([(rng.random() - 0.5) * 0.7, (rng.random() - 0.5) * 0.7, 0.4]))
        base = P[i] + N_[i] * 0.004
        V, F = cone(base, d, p.get("len", 0.07) * (0.7 + 0.6 * rng.random()), p.get("r", 0.016), seg=6)
        mb.add(V, F, np.linspace(0.6, 1.0, len(V)))


def x_mohawk(mb, p, rng):
    n = p.get("n", 9)
    c = np.array([0.0, -0.062, 1.612])
    for i in range(n):
        s = i / (n - 1)
        al = math.radians(28 + 128 * s)
        base = c + np.array([0, -0.112 * math.cos(al), 0.122 * math.sin(al)])
        nrm = norm(np.array([0, -math.cos(al) / 0.118, math.sin(al) / 0.128]))
        up = norm(nrm * 0.6 + np.array([0, 0.15 + 0.35 * s, 1.0]) * 0.8)
        V, F = cone(base, up, p.get("len", 0.085) * (1 - 0.35 * abs(s - 0.4)), p.get("r", 0.021), seg=6)
        mb.add(V, F, np.linspace(0.65, 1.0, len(V)))


def x_quiff(mb, p, rng):
    R = frame_from(np.array([0, -1.0, 0.45]))
    V, F = ellipsoid((0, -0.100, 1.752), (0.056, 0.060, 0.030), rot=R, seg=10, rings=7)
    mb.add(V, F, 0.95)
    V, F = ellipsoid((0, -0.150, 1.750), (0.040, 0.034, 0.022), rot=R, seg=8, rings=6)
    mb.add(V, F, 0.85)


EXTRA = dict(drape=x_drape, fringe=x_fringe, ponytail=x_ponytail, bun=x_bun, braid=x_braid, mohawk=x_mohawk, quiff=x_quiff)
TOP = {"bun_top", "topknot", "mohawk", "quiff", "afro"}

# ------------------------------------------------------------------ styles
CAP_STD = dict(hf=0.090, hs=0.050, hb=-0.050, thick=0.009, amp=0.0045, N=9)

STYLES = [
    # name, tags, sexes, ages, cap, extras, flags
    ("buzz_crop", ["soldier", "common", "masculine", "child"], dict(hf=0.085, hs=0.045, hb=-0.04, thick=0.0035, amp=0.0008, N=14), []),
    ("short_crop", ["common", "masculine", "worker"], dict(CAP_STD), []),
    ("side_part", ["common", "masculine", "merchant"], dict(CAP_STD, thick=0.010, amp=0.004, N=7, vol=0.006),
     [("fringe", dict(n=4, phi0=-0.7, phi1=0.5, length=0.055, sweep=0.35, z0=0.11, out=0.6))]),
    ("quiff", ["noble", "masculine", "young"], dict(CAP_STD, thick=0.007, vol=0.006), [("quiff", {})]),
    ("slick_back", ["noble", "courtly", "masculine"], dict(CAP_STD, thick=0.009, amp=0.004, N=11, warp=0.5),
     [("drape", dict(n=8, phis=(2.5, 3.8), z0=-0.03, length=0.08, w=0.02, t=0.009, out=0.2))]),
    ("undercut", ["young", "rogue", "masculine"], dict(hf=0.09, hs=0.078, hb=0.015, thick=0.008, amp=0.005, N=8, vol=0.016), []),
    ("mohawk", ["fighter", "outcast", "orc"], dict(hf=0.105, hs=0.095, hb=0.055, thick=0.004, amp=0.001, N=12), [("mohawk", dict(n=9))]),
    ("bowl_cut", ["rustic", "child", "common"], dict(hf=0.082, hs=0.0, hb=-0.015, thick=0.011, amp=0.003, N=10),
     [("fringe", dict(n=9, phi0=-0.95, phi1=0.95, length=0.058, z0=0.105, out=0.5, g=1.0))]),
    ("bob_cut", ["courtly", "feminine", "merchant"], dict(hf=0.09, hs=-0.01, hb=-0.03, thick=0.010, amp=0.003, N=9),
     [("drape", dict(n=26, phis=(1.2, 5.08), z0=0.02, length=0.14, w=0.030, t=0.011, out=0.25, ljit=0.1)),
      ("fringe", dict(n=6, phi0=-0.6, phi1=0.6, length=0.05, sweep=-0.25))]),
    ("long_straight", ["feminine", "elf", "noble"], dict(hf=0.09, hs=0.03, hb=-0.03, thick=0.008, amp=0.003, N=9),
     [("drape", dict(n=30, phis=(1.2, 5.08), z0=0.03, length=0.50, w=0.026, t=0.010, out=0.2, steps=14))]),
    ("long_wavy", ["feminine", "wanderer"], dict(hf=0.09, hs=0.03, hb=-0.03, thick=0.009, amp=0.004, N=8, vol=0.006),
     [("drape", dict(n=28, phis=(1.2, 5.08), z0=0.03, length=0.46, w=0.030, t=0.012, out=0.3, wobble=0.35, steps=16)),
      ("fringe", dict(n=4, phi0=-0.5, phi1=0.5, length=0.05, sweep=0.3))]),
    ("shoulder_layered", ["feminine", "common", "merchant"], dict(hf=0.09, hs=0.02, hb=-0.03, thick=0.009, amp=0.003, N=9),
     [("drape", dict(n=28, phis=(1.2, 5.08), z0=0.03, length=0.22, w=0.028, t=0.011, out=0.3, ljit=0.35)),
      ("fringe", dict(n=5, phi0=-0.7, phi1=0.6, length=0.06, sweep=-0.3))]),
    ("ponytail_high", ["young", "common", "feminine", "soldier"], dict(CAP_STD, thick=0.009), [("ponytail", dict(z=0.07, length=0.36, rise=-0.55))]),
    ("ponytail_low", ["common", "worker", "masculine", "feminine"], dict(CAP_STD, thick=0.009, hb=-0.04), [("ponytail", dict(z=-0.035, length=0.32, rise=0.2))]),
    ("bun_top", ["feminine", "scholar", "common"], dict(CAP_STD, thick=0.009), [("bun", dict(pos=(0, 0.005, 1.775), r=(0.048, 0.046, 0.040), tie=True))]),
    ("bun_low", ["feminine", "elder", "noble"], dict(CAP_STD, thick=0.009, hb=-0.04), [("bun", dict(pos=(0, 0.092, 1.575), r=(0.052, 0.040, 0.044)))]),
    ("braid_single", ["feminine", "rustic", "young"], dict(CAP_STD, thick=0.009), [("braid", dict(z0=-0.01, phi=3.0, length=0.48, seg=13, d0=[0.2, 0.5, -1]))]),
    ("braids_two", ["feminine", "child", "rustic"], dict(CAP_STD, thick=0.009, hs=0.04),
     [("braid", dict(z0=0.0, phi=2.05, length=0.40, seg=11, d0=[0.5, -0.2, -1])), ("braid", dict(z0=0.0, phi=-2.05, length=0.40, seg=11, d0=[-0.5, -0.2, -1]))]),
    ("crown_braid", ["feminine", "noble", "elder"], dict(CAP_STD, thick=0.009), [("crown", {})]),
    ("curly_short", ["common", "any"], dict(CAP_STD, thick=0.007, amp=0.002), [("curls", dict(n=70, r=0.019, zmin=0.05))]),
    ("curly_long", ["feminine", "wanderer"], dict(CAP_STD, thick=0.008, hs=0.02),
     [("curls", dict(n=60, r=0.024, zmin=0.05)), ("drape", dict(n=16, phis=(1.2, 5.08), z0=0.02, length=0.32, w=0.032, t=0.020, wobble=0.6, out=0.4))]),
    ("afro", ["any", "performer"], dict(hf=0.095, hs=0.02, hb=-0.02, thick=0.020, amp=0.012, N=24, vol=0.05, volb=0.02), [("curls", dict(n=60, r=0.030, zmin=0.0, lift=0.025))]),
    ("receding", ["elder", "masculine", "common"], dict(hf=0.130, hm=0.125, hs=0.045, hb=-0.05, thick=0.008, amp=0.003, N=9), []),
    ("elder_thin", ["elder", "frail", "any"], dict(hf=0.11, hm=0.095, hq=0.06, hs=0.0, hb=-0.05, thick=0.004, amp=0.0015, N=10, patchy=0.25),
     [("drape", dict(n=8, phis=(1.25, 5.03), z0=0.02, length=0.20, w=0.012, t=0.006, out=0.3, g=1.0, shade=(0.8, 1.0)))]),
    ("tonsure", ["monk", "scholar", "elder"], dict(hf=0.056, hm=0.056, hq=0.07, hs=-0.01, hb=-0.065, thick=0.009, amp=0.004, N=9, ceil=0.056), []),
    ("top_knot", ["warrior", "masculine", "noble"], dict(hf=0.09, hs=0.082, hb=0.02, thick=0.007, amp=0.003, N=9),
     [("bun", dict(pos=(0, -0.005, 1.782), r=(0.034, 0.034, 0.034), tie=True)), ("topknot_tail", {})]),
    ("tied_back", ["worker", "rustic", "any"], dict(CAP_STD, thick=0.010, hs=0.03, warp=0.5, amp=0.004, N=11),
     [("ponytail", dict(z=-0.045, length=0.18, rise=0.4, n=3, w=0.022))]),
    ("dreadlocks", ["wanderer", "outcast", "performer"], dict(CAP_STD, thick=0.008),
     [("dreads", dict(n=34))]),
    ("messy_tousled", ["young", "rogue", "common"], dict(CAP_STD, thick=0.012, amp=0.007, N=8, vol=0.008),
     [("spikes", dict(n=14, len=0.06, r=0.016)), ("fringe", dict(n=5, phi0=-0.6, phi1=0.6, length=0.06, sweep=0.2))]),
    ("wild_long", ["elder", "wanderer", "hermit", "orc"], dict(hf=0.09, hs=0.03, hb=-0.03, thick=0.011, amp=0.006, N=8, vol=0.012),
     [("drape", dict(n=26, phis=(1.2, 5.08), z0=0.03, length=0.52, w=0.030, t=0.014, out=0.35, wobble=0.3, steps=16, ljit=0.3)),
      ("fringe", dict(n=5, phi0=-0.9, phi1=0.9, length=0.07, sweep=0.1, z0=0.1))]),
]
HAT_TOP = {"quiff", "bun_top", "top_knot", "mohawk", "afro", "messy_tousled", "curly_short", "curly_long"}


def compile_style(idx, hat=False):
    name, tags, cap, extras = STYLES[idx]
    rng = np.random.default_rng(100 + idx)
    mb = MB()
    V, F, shade, V0, N0 = cap_shell(cap, seed=idx, hat=hat)
    mb.add(V, F, shade)
    for kind, p in extras:
        if hat and name in HAT_TOP and kind in ("quiff", "bun", "mohawk", "spikes", "curls", "topknot_tail"):
            continue
        if kind in EXTRA:
            EXTRA[kind](mb, p, rng)
        elif kind == "curls":
            x_spheres(mb, p, V, norm(V - HC), rng)
        elif kind == "spikes":
            x_spikes(mb, p, V, norm(V - HC), rng)
        elif kind == "dreads":
            for i in range(p["n"]):
                ring = i % 3
                phi = (i / p["n"]) * 2 * math.pi * 1.0 + rng.random() * 0.08
                if abs(((phi + math.pi) % (2 * math.pi)) - math.pi) < 0.75:   # keep the face clear
                    continue
                a, d = on_head(0.06 - 0.03 * ring + rng.random() * 0.02, phi, 0.006)
                lock(mb, a, np.array([d[0], d[1], 0]) * 0.35 + np.array([0, 0, -0.6]), 0.30 + 0.16 * rng.random() - 0.04 * ring, 0.0095, 0.0095, rng,
                     steps=12, gravity=0.9, stiff=0.5, wobble=0.15, shade=(0.55, 0.95), sides=9)
        elif kind == "crown":
            n = 17
            pts = np.array([on_head(0.088 + 0.012 * math.sin(i / (n - 1) * 3.14), -2.45 + 4.9 * i / (n - 1), 0.015)[0] for i in range(n)])
            x_braid(mb, dict(path=pts, seg=18, w=0.015), rng)
        elif kind == "topknot_tail":
            pts = np.array([[0, -0.005, 1.795], [0, 0.03, 1.80], [0, 0.065, 1.78], [0, 0.085, 1.745]])
            t = np.linspace(0, 1, 8)
            pp = np.array([np.interp(t, np.linspace(0, 1, 4), pts[:, k]) for k in range(3)]).T
            V2, F2, S2 = sweep(pp, np.linspace(0.016, 0.006, 8), np.linspace(0.016, 0.006, 8), sides=8, shade=np.linspace(0.75, 1, 8))
            mb.add(V2, F2, S2)
    return mb.result()


def build():
    out = []
    mat = get_material("Hair", (0.3, 0.18, 0.09))
    for i, (name, tags, cap, extras) in enumerate(STYLES):
        long_ = any(k in ("drape", "ponytail", "braid", "dreads", "crown") and (p.get("length", 0.1) > 0.15 if isinstance(p, dict) else False)
                    for k, p in extras)
        bones = LONG_BONES if long_ else ["Head", "Neck"]
        has_top = name in HAT_TOP
        for hat in ([False, True] if has_top else [False]):
            V, F, S = compile_style(i, hat=hat)
            oname = f"Hair_{i+1:02d}_{name}" + ("_hat" if hat else "")
            vc = [(s * 0.95, s * 0.95, s * 0.95) for s in S]
            ob = add_part(oname, V, F, bones, mat, vcol=vc)
            ob["gd_category"] = "hair"
            out.append(dict(obj=oname, id=f"hair_{i+1:02d}_{name}", name=name, tags=tags, hat=hat, hasTop=has_top, long=long_, tris=sum(len(f) - 2 for f in F),
                            bones=bones))
    return out
