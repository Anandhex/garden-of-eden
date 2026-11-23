"""Woman-only proof sheets (round 17): eye close-ups (front, 3/4, side, blink open / half / closed), lips with gloss,
brow slider sweeps and brow styles, 8 generated women.  Needs mh/cache/keys.npz (build_mh.py).

    $B -b -P art3d/characters/mh/proofs_f.py -- [only=eyes,lips,brows,women]
"""
import bpy, os, sys, json
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.dirname(HERE))
import proofs_mh as pm, person, sheets_mh as shs, compare_mh as cm, face_cards as fc  # noqa: E402
import lookdev as ld  # noqa: E402

OUT = pm.OUT
SEX, PFX = "F", "f"


def eye_cam(S, objs, az, el=2, dist=0.30, res=480, side=1):
    sc, cam = S.sc, S.cam
    sc.render.resolution_x, sc.render.resolution_y = int(res * 1.5), res
    E = cm.eval_pts(objs["eyes"])
    t = E[E[:, 0] * side > 0].mean(axis=0) if side else E.mean(axis=0)
    ld.aim(cam, (t[0], t[1], t[2]), az, dist, elev_deg=el, lens=85)
    cm.look_at_camera(objs["rig"], cam)
    p = os.path.join(pm.TMP, f"f{S.n:04d}.png")
    S.n += 1
    ld.render(p)
    return p


def eyes(S):
    paths, labels = [], []
    # reference row: plain MakeHuman neutral (macros only, default MakeHuman eye texture, MakeHuman lashes, no paint)
    Pm = S.B.macro(S.R[SEX]["macro"])
    Pm = Pm - [0, 0, Pm[S.lm.body, 2].min()]
    prox = {k: (v[SEX] if isinstance(v, dict) else v) for k, v in S.R["proxies"].items()}
    prox["eyelashes"] = "eyelashes02" if SEX == "F" else "eyelashes01"
    prox["hair"] = None
    import person as _p, mhcore as _mc
    _p.clear_people()
    _p.build._lm = S.lm
    objs = _p.build(Pm, prox, name="MHP_plain", eye_tex=_mc.user_data("eyes", "materials", "brown_eye.png"), gloss=False)
    cm.clear_pose(objs["rig"])
    for az, el, lab, side, dist in ((0, 2, "front, both eyes", 0, 0.32), (32, 2, "3/4, near eye", 1, 0.22),
                                    (75, 0, "side, near eye", 1, 0.20), (25, -20, "from below", 1, 0.22)):
        paths.append(eye_cam(S, objs, az, el, dist, side=side))
        labels.append(f"PLAIN MakeHuman: {lab}")
    w = pm.neutral_w(SEX)
    for blink, tag in ((0, "open"), (0.5, "half closed"), (1.0, "closed")):
        ww = dict(w, Eye_Blink_L=blink, Eye_Blink_R=blink)
        P, objs = S.person(ww, SEX)
        for az, el, lab, side, dist in ((0, 2, "front, both eyes", 0, 0.32), (32, 2, "3/4, near eye", 1, 0.22),
                                        (75, 0, "side, near eye", 1, 0.20), (25, -20, "from below", 1, 0.22)):
            paths.append(eye_cam(S, objs, az, el, dist, side=side))
            labels.append(f"{tag}: {lab}")
    pm.grid(os.path.join(OUT, f"{PFX}_eyes_closeup.png"), 4, labels, paths)


def lashes(S):
    """five views (front, 3/4, side, from above, from below) x open / half / closed."""
    paths, labels = [], []
    w = pm.neutral_w(SEX)
    for blink, tag in ((0, "open"), (0.5, "half"), (1.0, "closed")):
        ww = dict(w, Eye_Blink_L=blink, Eye_Blink_R=blink)
        P, objs = S.person(ww, SEX, hair=False)
        for az, el, lab, dist in ((0, 2, "front", 0.20), (35, 2, "3/4", 0.18), (88, 0, "side", 0.16), (20, 55, "from above", 0.18),
                                  (20, -25, "from below", 0.18)):
            paths.append(eye_cam(S, objs, az, el, dist, side=1))
            labels.append(f"{tag}: {lab}")
    pm.grid(os.path.join(OUT, f"{PFX}_lashes.png"), 5, labels, paths)


def teeth(S):
    """open mouth close-ups: teeth must sit behind the lips (no poke-through)."""
    paths, labels = [], []
    for jaw, extra, lab in ((14, {}, "jaw open"), (8, {"Mouth_O": 0.6}, "OH"), (4, {"Mouth_E": 1.0}, "EE"), (0, {"Mouth_Smile": 1.0}, "smile")):
        P, objs = S.person(dict(pm.neutral_w(SEX), **extra), SEX, hair=False)
        cm.rot_world(objs["rig"], "Jaw", (1, 0, 0), jaw)
        m = P[S.lm.lipContact]
        for az in (0, 35):
            S.sc.render.resolution_x, S.sc.render.resolution_y = 480, 360
            ld.aim(S.cam, (0, m[1], m[2] - 0.004), az, 0.26, elev_deg=4, lens=85)
            p = os.path.join(pm.TMP, f"t{S.n:04d}.png")
            S.n += 1
            ld.render(p)
            paths.append(p)
            labels.append(f"{lab} {'3/4' if az else 'front'}")
    pm.grid(os.path.join(OUT, f"{PFX}_teeth.png"), 4, labels, paths)


def anatomy(S):
    """eye anatomy sheet (measured against real-eye anatomy, not the reference) and the brow placement overlay."""
    import subprocess, json as _json
    import measure_mh as mm, mhcore as mc
    P, objs = S.person(pm.neutral_w(SEX), SEX, hair=False)
    lm, B = S.lm, S.B
    eyes_px = mc.Proxy(mc.proxy_file("eyes", S.R["proxies"]["eyes"]))
    E = eyes_px.fit(P)
    EL = E[E[:, 0] > 0]
    er = (EL[:, 0].max() - EL[:, 0].min()) / 2
    # pupil and iris edge from the eye texture's own iris (UV centres of make_textures.CENTRES, radius R_IRIS x IRIS_SCALE)
    vuv = np.zeros((eyes_px.nv, 2))
    for f, ft in zip(eyes_px.faces, eyes_px.face_uv):
        for v, t in zip(f, ft):
            vuv[v] = eyes_px.uv[t]
    left = E[:, 0] > 0
    best = None
    for cu, cv in ((303.2 / 1024, 1 - 722.3 / 1024), (732.0 / 1024, 1 - 312.6 / 1024)):
        dd = np.linalg.norm(vuv - [cu, cv], axis=1)
        dd[~left] = 9
        if best is None or dd.min() < best[0]:
            best = (dd.min(), cu, cv, dd)
    _, cu, cv, dd = best
    cz = E[np.argmin(dd)]
    rim = E[(np.abs(dd - 92 * (1.12 if "_mh" not in S.R["look"][SEX]["person"].get("eye_tex", "") else 1.0) / 1024) < 0.006) & left]
    ir = float(np.median(np.linalg.norm((rim - cz)[:, [0, 2]], axis=1))) if len(rim) else 0.45 * er
    mm.eye_aperture(P, lm, E, eyes_px.faces, side="L", step=0.0002)
    O = mm.eye_aperture.cells
    ax = O[:, 0]
    ci = O[np.argmin(ax)]
    co = O[np.argmax(ax)]
    top = O[np.argmax(O[:, 2])]
    bot = O[np.argmin(O[:, 2])]
    bf, lo, g = mm.measure(P, lm)
    k = (216.0 if SEX == "F" else 232.0) / (g["hh"] * 1000.0)   # real head height (Farkas v-gn, women / men)
    w = abs(co[0] - ci[0]) * 1000 * k
    h = (top[2] - bot[2]) * 1000 * k
    tilt = np.degrees(np.arctan2(co[2] - ci[2], co[0] - ci[0]))
    cover_top = (cz[2] + ir - top[2]) * 1000 * k
    cover_bot = (bot[2] - (cz[2] - ir)) * 1000 * k
    peak_off = (top[0] - cz[0]) * 1000 * k                 # + = towards the ear (left eye is +x)
    low_off = (bot[0] - cz[0]) * 1000 * k
    # brows: lowest edge above the pupil
    Bq = cm.eval_pts(objs["eyebrows"])
    bl = Bq[(Bq[:, 0] > 0) & (np.abs(Bq[:, 0] - cz[0]) < 0.005)]
    brow_low = bl[:, 2].min() if len(bl) else np.nan
    gap = (brow_low - top[2]) * 1000 * k
    lid_vis = h
    nose = lm.nose_set(0.6)
    Nn = P[nose]
    band = Nn[(Nn[:, 2] > P[lm.subnasale, 2]) & (Nn[:, 2] < P[lm.subnasale, 2] + 0.010) & (Nn[:, 0] > 0) & (Nn[:, 0] < 0.03)]
    alar = band[np.argmax(band[:, 0])] if len(band) else Nn[np.argmax(Nn[:, 0])]
    res = dict(opening_w_mm=round(w, 1), opening_h_mm=round(h, 1), w_over_h=round(w / h, 2), tilt_deg=round(tilt, 1),
               iris_covered_top_mm=round(cover_top, 1), iris_lower_lid_mm=round(cover_bot, 1),
               upper_peak_offset_mm=round(peak_off, 1), lower_low_offset_mm=round(low_off, 1),
               brow_gap_above_lid_mm=round(gap, 1))
    print("ANATOMY", _json.dumps(res), flush=True)
    sc, cam = S.sc, S.cam
    items = []
    # front close-up with measurement lines
    sc.render.resolution_x, sc.render.resolution_y = 900, 600
    ld.aim(cam, (cz[0], cz[1], cz[2]), 0, 0.13, elev_deg=0, lens=85)
    cm.look_at_camera(objs["rig"], cam)
    p0 = os.path.join(pm.TMP, "anat_front.png")
    ld.render(p0)
    pr = lambda q: [float(x) for x in cm.project(cam, [q])[0]]
    cen = pr(cz)
    edge = pr(cz + np.array([ir, -er * 0.9, 0]))
    items.append(dict(src=p0, out=p0, lines=[dict(a=pr(ci), b=pr(co), label="width", col=(255, 220, 60)),
                                              dict(a=pr(top), b=pr(bot), label="height", col=(255, 120, 60)),
                                              dict(a=pr(top), b=pr(top + np.array([0, 0, 0.002])), label="upper peak", col=(80, 230, 90)),
                                              dict(a=pr(bot), b=pr(bot - np.array([0, 0, 0.002])), label="lower low", col=(80, 230, 90))],
                      circles=[dict(c=cen, r=abs(edge[0] - cen[0]))],
                      text=[f"opening {w:.1f} x {h:.1f} mm (w/h {w / h:.2f}; target ~30 x 10, w/h 2.8-3.2)  tilt {tilt:.1f} deg (target 4-8)",
                            f"iris covered by upper lid {cover_top:.1f} mm (target 1-2)  lower lid above iris bottom {cover_bot:.1f} mm (target ~0)",
                            f"upper lid peak {peak_off:+.1f} mm from pupil (target slightly nasal = negative)  lower lid low point {low_off:+.1f} mm (target slightly temporal = positive)"]))
    for az, el, lab in ((-18, 8, "inner corner (caruncle, tear lake, plica)"), (62, 4, "outer corner (upper lid over lower)")):
        sc.render.resolution_x, sc.render.resolution_y = 600, 600
        tgt = ci if az < 0 else co
        ld.aim(cam, (tgt[0], tgt[1], tgt[2]), az, 0.08 if az < 0 else 0.07, elev_deg=el, lens=85)
        p = os.path.join(pm.TMP, f"anat_{az}.png")
        ld.render(p)
        items.append(dict(src=p, out=p, text=[lab]))
    subprocess.run(["python3", "-I", os.path.join(HERE, "anatomy_draw.py"), _write(dict(images=items))], check=True)
    pm.grid(os.path.join(OUT, f"{PFX}_eye_anatomy.png"), 3, ["front, measured", "inner corner", "outer corner"], [i["out"] for i in items])
    # brow placement overlay (both eyes)
    sc.render.resolution_x, sc.render.resolution_y = 900, 700
    cm.clear_pose(objs["rig"])
    c0 = np.array([0.0, cz[1], cz[2] + 0.006])
    ld.aim(cam, tuple(c0), 0, 0.42, elev_deg=0, lens=85)
    p = os.path.join(pm.TMP, "brow_overlay.png")
    ld.render(p)
    lines = []
    for sx in (1, -1):
        a = alar * [sx, 1, 1]
        o = co * [sx, 1, 1]
        irx = (cz + np.array([ir, 0, 0])) * [sx, 1, 1]
        lines.append(dict(a=pr(a), b=pr(a + np.array([0, 0, 0.06])), label="inner end (nose wing)", col=(80, 230, 90)))
        ic = ci * [sx, 1, 1]
        lines.append(dict(a=pr(a), b=pr(ic), label="inner corner", col=(160, 200, 255)))
        lines.append(dict(a=pr(irx), b=pr(irx + np.array([0, 0, 0.035])), label="peak", col=(255, 220, 60)))
        dv = (o - a) / np.linalg.norm(o - a)
        lines.append(dict(a=pr(a), b=pr(o + dv * 0.025), label="tail", col=(255, 120, 60)))
    items2 = [dict(src=p, out=os.path.join(OUT, f"{PFX}_brow_placement.png"), lines=lines,
                   text=[f"brow lower edge above the lash line (over the pupil): {gap:.1f} mm; visible lid {lid_vis:.1f} mm "
                         f"(target: gap about 1.5-2x the eye opening height)"])]
    subprocess.run(["python3", "-I", os.path.join(HERE, "anatomy_draw.py"), _write(dict(images=items2))], check=True)
    _json.dump(res, open(os.path.join(OUT, f"{PFX}_eye_anatomy.json"), "w"), indent=1)


def _write(d):
    import json as _json
    p = os.path.join(pm.TMP, "spec.json")
    _json.dump(d, open(p, "w"))
    return p


def lips(S):
    paths, labels = [], []
    P, objs = S.person(pm.neutral_w(SEX), SEX)
    # an extra small light from above-front so the gloss highlight shows
    ldat = bpy.data.lights.new("LipSpec", 'AREA')
    ldat.energy, ldat.size, ldat.color = 6.0, 0.15, (1.0, 0.95, 0.9)
    lo = bpy.data.objects.new("LipSpec", ldat)
    bpy.context.scene.collection.objects.link(lo)
    m = P[S.lm.lipContact]
    lo.location = (0.15, m[1] - 0.45, m[2] + 0.30)
    from mathutils import Vector
    lo.rotation_euler = (Vector(m) - lo.location).to_track_quat('-Z', 'Y').to_euler()
    sc, cam = S.sc, S.cam
    for az, el, lab in ((0, 6, "front"), (30, 6, "3/4"), (70, 4, "side"), (-25, 14, "3/4 from above")):
        sc.render.resolution_x, sc.render.resolution_y = 600, 450
        ld.aim(cam, (0, m[1], m[2]), az, 0.30, elev_deg=el, lens=85)
        p = os.path.join(pm.TMP, f"l{S.n:04d}.png")
        S.n += 1
        ld.render(p)
        paths.append(p)
        labels.append(f"lips with gloss: {lab}")
    bpy.data.objects.remove(lo, do_unlink=True)
    pm.grid(os.path.join(OUT, f"{PFX}_lips.png"), 4, labels, paths)


def brows(S):
    paths, labels = [], []
    w = pm.neutral_w(SEX)
    P = person.mix(S.Z, w)
    for k in fc.BROW_KEYS:
        for v, tag in ((-1, "-1"), (0, "0"), (1, "+1")):
            objs = shs.assemble(S.B, S.lm, S.R, P, "F", None, "T2_fair", (0.17, 0.09, 0.05), pm.EYE["F"], name="MHP_b", brow={k: v})
            cm.clear_pose(objs["rig"])
            paths.append(eye_cam(S, objs, 15, 3, 0.36, res=360, side=0))
            labels.append(f"{k} {tag}")
    pm.grid(os.path.join(OUT, "f_brow_sweeps.png"), 6, labels, paths)
    paths, labels = [], []
    for name, (tex, prm, dens) in fc.BROW_STYLES.items():
        objs = shs.assemble(S.B, S.lm, S.R, P, "F", None, "T2_fair", (0.17, 0.09, 0.05), pm.EYE["F"], name="MHP_b", brow=prm, brow_tex=tex,
                            brow_gain=1.2 * dens)
        cm.clear_pose(objs["rig"])
        paths.append(eye_cam(S, objs, 15, 3, 0.36, res=360, side=0))
        labels.append(f"style: {name}")
    pm.grid(os.path.join(OUT, "f_brow_styles.png"), 4, labels, paths)


def lips_row(S):
    """8 generated women across skin tones: lips only (gloss and lip colour by tone)."""
    paths, labels = [], []
    tones = ["T1_light", "T2_fair", "T3_warm", "T4_tan", "T5_brown", "T6_deep", "T3_warm", "T5_brown"]
    for i, tone in enumerate(tones):
        w = person.generate(f"lips-F-{i}", sex="F", age=28)
        P = person.mix(S.Z, w)
        objs = shs.assemble(S.B, S.lm, S.R, P, "F", None, tone, (0.1, 0.06, 0.04), "eye_brown_mh.png", name="MHP_l", gloss_scale=0.75)
        cm.clear_pose(objs["rig"])
        m = P[S.lm.lipContact]
        S.sc.render.resolution_x, S.sc.render.resolution_y = 480, 360
        ld.aim(S.cam, (0, m[1], m[2]), 25, 0.28, elev_deg=6, lens=85)
        p = os.path.join(pm.TMP, f"r{S.n:04d}.png")
        S.n += 1
        ld.render(p)
        paths.append(p)
        labels.append(f"{tone}")
    pm.grid(os.path.join(OUT, "f_lips_tones.png"), 8, labels, paths)


def brows_game(S):
    """brow sliders -1 / +1 side by side at the in-game camera distance (head and shoulders, 50 mm, about 1.4 m)."""
    paths, labels = [], []
    P = person.mix(S.Z, pm.neutral_w(SEX))
    for k in fc.BROW_KEYS:
        for v in (-1, 1):
            objs = shs.assemble(S.B, S.lm, S.R, P, "F", "ponytail01", "T2_fair", (0.17, 0.09, 0.05), pm.EYE["F"], name="MHP_bg", brow={k: v})
            cm.clear_pose(objs["rig"])
            E = cm.eval_pts(objs["eyes"])
            t = E.mean(axis=0)
            S.sc.render.resolution_x, S.sc.render.resolution_y = 320, 320
            ld.aim(S.cam, (0, t[1], t[2] - 0.08), 20, 0.85, elev_deg=4, lens=50)
            p = os.path.join(pm.TMP, f"g{S.n:04d}.png")
            S.n += 1
            ld.render(p)
            paths.append(p)
            labels.append(f"{k} {v:+d}")
    pm.grid(os.path.join(OUT, "f_brows_game_distance.png"), 6, labels, paths)


def game_lashes(S):
    """front head close-up at a normal game distance: are the lashes visible?"""
    P, objs = S.person(pm.neutral_w(SEX), SEX)
    E = cm.eval_pts(objs["eyes"])
    t = E.mean(axis=0)
    paths = []
    for dist, lab in ((0.9, "game camera, head and shoulders"), (0.5, "game camera, close dialogue")):
        S.sc.render.resolution_x, S.sc.render.resolution_y = 640, 640
        ld.aim(S.cam, (0, t[1], t[2] - 0.04), 0, dist, elev_deg=3, lens=50)
        cm.look_at_camera(objs["rig"], S.cam)
        p = os.path.join(pm.TMP, f"gl{S.n:04d}.png")
        S.n += 1
        ld.render(p)
        paths.append(p)
    pm.grid(os.path.join(OUT, f"{PFX}_lashes_game_distance.png"), 2, ["game camera, head and shoulders", "game camera, close dialogue"], paths)


def women(S):
    _women(S, "town-F-", "f_generated_8.png")
    _women(S, "town2-F-", "f_generated_8_new.png")


def _women(S, prefix, fname):
    paths, labels = [], []
    ages = [19, 23, 27, 31, 38, 45, 56, 68]
    cultures = ["north", "south", "east", "west", None]
    tones = ["T1_light", "T2_fair", "T3_warm", "T4_tan", "T5_brown", "T6_deep"]
    hairs = ["bob02", "ponytail01", "braid01", "bob01", "long01", "afro01", "short04", "ponytail01"]
    hcols = [(0.17, 0.09, 0.05), (0.05, 0.04, 0.035), (0.32, 0.20, 0.10), (0.10, 0.06, 0.04)]
    for i, age in enumerate(ages):
        cu = cultures[(i * 3) % 5]
        w = person.generate(f"{prefix}{i}", sex="F", age=age, culture=cu)
        P = person.mix(S.Z, w)
        hc = (0.40, 0.39, 0.38) if age >= 56 else hcols[i % 4]
        style = w.get("_brow_style", "soft arch")
        objs = shs.assemble(S.B, S.lm, S.R, P, "F", hairs[i], tones[(i * 5) % 6], hc,
                            ["eye_brown_mh.png", "eye_green_mh.png", "eye_blue_mh.png", "eye_brownlight_mh.png", "eye_grey_mh.png"][i % 5],
                            name="MHP_g", brow={k: w[k] for k in fc.BROW_KEYS if k in w}, brow_tex=fc.BROW_STYLES[style][0],
                            brow_gain=1.2 * w.get("_brow_density", 1.0), gloss_scale=0.75)
        cm.clear_pose(objs["rig"])
        paths.append(S.shot(objs, P, "face", az=24, res=420))
        labels.append(f"woman {age}, {cu or 'mixed'}, brows: {style}")
    pm.grid(os.path.join(OUT, fname), 4, labels, paths)


def main():
    a = dict(x.split("=", 1) for x in (sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []))
    global SEX, PFX
    SEX = a.get("sex", "F")
    PFX = SEX.lower()
    S = pm.Stage()
    for name in a.get("only", "anatomy,lashes,eyes,teeth,game_lashes,lips,lips_row,brows,brows_game,women").split(","):
        globals()[name](S)
        print("DONE", name, flush=True)


if __name__ == "__main__":
    main()
