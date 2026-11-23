"""WP3 stylise pass (G9 plan sections WP3 and 11.6): pushes the proportioned realistic scan of each sex to the targets of
compare_targets.json with smooth landmark-driven fields, on the full-resolution welded neutral BEFORE decimation and before
any blend shape is evaluated.  Deterministic: every step is a function of landmarks measured on the current positions.

Order (11.6): skull width/depth -> Loomis vertical layout of the face (brow, eye, nose base, mouth lines between crown and
chin, moved with smooth fields so the thirds stay continuous) -> eyes (aperture size, spacing, tilt; lids and eyeball scaled
together about the eyeball centre and set back so the cornea stays in the face) -> nose width -> mouth width -> chin width ->
ears (size, band, flat to the head) -> neck -> body widths (shoulders, waist, hips, legs and arms about their own axes, depth
kept in proportion to width) -> light Laplacian smoothing of the body (2 mm cap).
"""
import numpy as np
from mathutils import Vector
from mathutils.kdtree import KDTree

T = {  # targets per sex (fractions of head height from the crown unless named otherwise)
    "female": dict(brow=0.39, eye=0.53, nose_base=0.70, mouth=0.81, eye_w=0.182, eye_gap=1.0, tilt=9.0, nose_w=0.22, mouth_w=0.46,
                   chin_w=0.30, ear_h=0.20, ear_top=0.46, stick=0.03, neck_w=0.35, head_w=0.70, head_d=0.86,
                   shoulder=1.62, waist=1.00, hip=1.50),           # Gate 1 (user): keep more width, slim not skeletal
    "male": dict(brow=0.40, eye=0.52, nose_base=0.71, mouth=0.81, eye_w=0.168, eye_gap=1.0, tilt=5.0, nose_w=0.26, mouth_w=0.46,
                 chin_w=0.40, ear_h=0.21, ear_top=0.45, stick=0.04, neck_w=0.50, head_w=0.70, head_d=0.88,
                 shoulder=2.05, waist=1.25, hip=1.42)}           # Gate 1: waist above 27 cm
LOG = {}


def S(a, b, x):
    t = np.clip((np.asarray(x, float) - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def pchip(x, y, xq):
    """monotone cubic interpolation (Fritsch-Carlson): no kinks at the control lines, no overshoot."""
    h = np.diff(x)
    d = np.diff(y) / h
    m = np.zeros(len(x))
    m[0], m[-1] = d[0], d[-1]
    for k in range(1, len(x) - 1):
        if d[k - 1] * d[k] > 0:
            w1, w2 = 2 * h[k] + h[k - 1], h[k] + 2 * h[k - 1]
            m[k] = (w1 + w2) / (w1 / d[k - 1] + w2 / d[k])
    i = np.clip(np.searchsorted(x, xq) - 1, 0, len(x) - 2)
    t = (xq - x[i]) / h[i]
    h00, h10, h01, h11 = 2 * t ** 3 - 3 * t ** 2 + 1, t ** 3 - 2 * t ** 2 + t, -2 * t ** 3 + 3 * t ** 2, t ** 3 - t ** 2
    return h00 * y[i] + h10 * h[i] * m[i] + h01 * y[i + 1] + h11 * h[i] * m[i + 1]


def _kd(P):
    kd = KDTree(len(P))
    for i, p in enumerate(P):
        kd.insert(Vector(p), i)
    kd.balance()
    return kd


def dist_to(P, idx):
    """distance of every point to the nearest vertex of idx."""
    kd = _kd(P[idx])
    return np.array([kd.find(Vector(p))[2] for p in P])


EDGES = None


def width_at(P, z, mask, h=None):
    """exact width of the cross-section at height z: x-extent of the intersections of mask edges with the plane z."""
    a, b = EDGES[:, 0], EDGES[:, 1]
    m = mask[a] & mask[b]
    za, zb = P[a, 2], P[b, 2]
    hit = m & (((za - z) * (zb - z)) <= 0) & (za != zb)
    if not hit.any():
        return 0.0
    tt = (z - za[hit]) / (zb[hit] - za[hit])
    x = P[a[hit], 0] + (P[b[hit], 0] - P[a[hit], 0]) * tt
    return float(x.max() - x.min())


def stylise(P, F, ids, eyes, lm, sex):
    import source_mesh as sm
    global EDGES
    t = T[sex]
    P = P.copy()
    ed = set()
    for f in F:
        for i in range(len(f)):
            a_, b_ = f[i], f[(i + 1) % len(f)]
            ed.add((min(a_, b_), max(a_, b_)))
    EDGES = np.array(sorted(ed))
    eyes = [(E.copy(), Fe) for E, Fe in eyes]
    log = LOG.setdefault(sex, {})
    vs = lambda sets: np.array(sorted(sm.verts_of(F, ids, sets)))
    head_v = vs(sm.HEAD_SETS)
    is_head = np.zeros(len(P), bool)
    is_head[head_v] = True
    ears_v = vs([4, 5])
    nose_v = vs([7])
    top, chin = lm["top"], lm["chin"]
    hh = top - chin
    frac = lambda z: (top - z) / hh
    zf = lambda f: top - f * hh
    yc = float(lm["head_c"][1])
    above_neck = S(chin - 0.03, chin + 0.01, P[:, 2]) * is_head

    _c = sm.SPLIT_INFO["corners"]
    log["mouth_corners_start"] = [round(float(x), 4) for x in P[_c, 0]] + [round(float(P[_c[0], 2]), 4)]
    log["mouth_line_x_range"] = [round(float(P[sm.SPLIT_INFO["upper"], 0].min()), 4), round(float(P[sm.SPLIT_INFO["upper"], 0].max()), 4)]
    # ---------------- 0. flatten the mouth: the scan's lip border climbs towards the nose at its ends; lay it on the mouth line
    # ---------------- 1. skull width and depth (head above the chin, ears ride along)
    skull = is_head & (P[:, 2] > chin + 0.05)
    skull[ears_v] = False
    cur_w = max(width_at(P, z, skull) for z in np.arange(chin + 0.08, top - 0.02, 0.005))
    front_y = P[is_head & (np.abs(P[:, 0]) < 0.01), 1].min()
    cur_d = P[is_head, 1].max() - front_y
    kx, ky = t["head_w"] * hh / cur_w, t["head_d"] * hh / cur_d
    P[:, 0] += P[:, 0] * (kx - 1) * above_neck
    P[:, 1] += (P[:, 1] - yc) * (ky - 1) * above_neck
    for E, _ in eyes:
        E[:, 0] *= kx
        E[:, 1] = yc + (E[:, 1] - yc) * ky
    log["skull"] = dict(kx=round(kx, 3), ky=round(ky, 3))

    ec = 0.5 * (eyes[0][0].mean(axis=0) + eyes[1][0].mean(axis=0) * np.array([-1, 1, 1]))
    d_eye = 0.0
    split = sm.SPLIT_INFO
    no_ears = is_head.copy()
    no_ears[ears_v] = False
    facew = width_at(P, ec[2] + d_eye - 0.02, no_ears & (P[:, 1] < yc))
    log["facew_cm"] = round(facew * 100, 2)
    log.setdefault("mw_trace", []).append(round(float(abs(P[sm.SPLIT_INFO["corners"][0], 0] - P[sm.SPLIT_INFO["corners"][1], 0])), 4))
    # ---------------- 3. eyes: aperture width, spacing, tilt (lids + socket + eyeball scaled together)
    # measured on the left eye (+X); the right eye gets the mirrored transform (the base is symmetric)
    import face_rig as fr
    E0 = eyes[0][0]
    c0 = E0.mean(axis=0)
    r0 = float(0.5 * (E0[:, 2].max() - E0[:, 2].min()))
    head_faces = [f for f, k in zip(F, ids) if k in sm.HEAD_SETS]
    Tp = fr.Topo(P, head_faces, ["head"] * len(head_faces), ("head",))
    L0 = fr._find_lids(Tp, [c0], [r0])[0]
    fr0 = fr.lid_frames(P, L0)
    cin0, cout0 = int(fr0["upper"][0][0]), int(fr0["upper"][0][-1])
    w_cur = float(np.linalg.norm(P[cout0] - P[cin0]))
    tilt_cur = float(np.degrees(np.arctan2(P[cout0, 2] - P[cin0, 2], abs(P[cout0, 0] - P[cin0, 0]))))
    mid_x0 = 0.5 * (P[cin0, 0] + P[cout0, 0])
    for side, sid in ((0, 2), (1, 3)):
        E = eyes[side][0]
        c = E.mean(axis=0)
        r = float(0.5 * (E[:, 2].max() - E[:, 2].min()))
        sx = 1 if c[0] > 0 else -1
        surround = vs([sid])
        w_t = t["eye_w"] * hh
        s = w_t / w_cur
        gap = t["eye_gap"] * w_t
        cx_new = sx * (gap / 2 + w_t / 2 + (c0[0] - mid_x0) * s)
        cnew = np.array([cx_new, c[1] + (s - 1) * r * 0.40, c[2]])
        th = np.radians(t["tilt"] - tilt_cur) * sx
        ct, st = np.cos(th), np.sin(th)

        R0 = 0.62 * w_cur                      # lids and socket region (radius from the eyeball centre)
        lid_t = max(R0 - r, 0.002)             # lid thickness kept: radius r_ball*s + (dist - r_ball)
        R1 = s * r + lid_t + 0.018             # beyond: monotone fall-off to identity

        rb = r

        def tf(Q, full=False):
            rel = Q - c
            r = np.linalg.norm(rel, axis=1) + 1e-12
            if full:
                rn = r * s
                w = np.ones(len(Q))
            else:
                inner = np.where(r < rb, r * s, s * rb + (r - rb))            # eyeball scaled, lid offset kept
                R0n = s * rb + (R0 - rb)
                rn = np.where(r < R0, inner, np.where(r < R1, R1 - (R1 - r) * (R1 - R0n) / (R1 - R0), r))
                w = np.clip(1 - (r - R0) / (R1 - R0), 0, 1)
                w = w * w * (3 - 2 * w)
            q = rel * (rn / r)[:, None]
            x, z = q[:, 0].copy(), q[:, 2].copy()
            thw = th * w
            q[:, 0], q[:, 2] = x * np.cos(thw) - z * np.sin(thw), x * np.sin(thw) + z * np.cos(thw)
            return c + q + (cnew - c)[None, :] * w[:, None]
        m = is_head.copy()
        m[ears_v] = False
        P = np.where(m[:, None], tf(P), P)
        eyes[side] = (tf(E, full=True), eyes[side][1])
        log[f"eye_{side}"] = dict(scale=round(s, 3), w_before=round(w_cur / hh, 3), tilt_before=round(tilt_cur, 1))

    corners = split["corners"]
    mw0 = abs(P[corners[0], 0] - P[corners[1], 0])
    log.setdefault("mw_trace", []).append(round(float(abs(P[sm.SPLIT_INFO["corners"][0], 0] - P[sm.SPLIT_INFO["corners"][1], 0])), 4))
    # ---------------- 4. nose width (alar width; nose part + a short falloff onto the cheeks)
    lmn = sm.landmarks(P, F, ids, eyes)
    tip = lmn["nose_tip"]
    al = nose_v[(P[nose_v, 1] < tip[1] + 0.016) & (P[nose_v, 2] > lmn['subnasale'][2] - 0.002)]
    nw = float(P[al, 0].max() - P[al, 0].min())
    k = t["nose_w"] * facew / nw
    d = dist_to(P, nose_v)
    w = np.where(np.isin(np.arange(len(P)), nose_v), 1.0, S(0.008, 0.0, d)) * is_head
    w *= S(lmn["subnasale"][2] - 0.012, lmn["subnasale"][2] + 0.008, P[:, 2])     # soft over the philtrum (a sharp mask creased it)
    P[:, 0] += P[:, 0] * (k - 1) * w
    log["nose_k"] = round(k, 3)

    log.setdefault("mw_trace", []).append(round(float(abs(P[sm.SPLIT_INFO["corners"][0], 0] - P[sm.SPLIT_INFO["corners"][1], 0])), 4))
    # ---------------- 5. mouth width (corners move out; the middle stretches less)
    mw = abs(P[corners[0], 0] - P[corners[1], 0])
    log["mouth_w_before_over_facew"] = round(mw / facew, 3)
    mz = float(P[split["corners"], 2].mean())
    k = t["mouth_w"] * facew / mw
    half = mw / 2
    zone = S(0.032, 0.010, np.abs(P[:, 2] - mz)) * S(half * 2.3, half * 1.0, np.abs(P[:, 0])) * S(yc, yc - 0.04, P[:, 1]) * is_head
    prof = (np.abs(P[:, 0]) / half) ** 1.3                    # 0 at the middle, 1 at the corners
    P[:, 0] += np.sign(P[:, 0]) * half * (k - 1) * np.clip(prof, 0, 1.6) * zone
    P[:, 1] += (k - 1) * half * 0.35 * np.clip(prof, 0, 1.6) ** 2 * zone     # corners follow the dental arch back
    log["mouth_k"] = round(k, 3)

    # ---------------- 6. chin width
    chin_zone = S(mz - 0.006, chin + 0.006, P[:, 2]) * S(yc - 0.01, yc - 0.05, P[:, 1]) * is_head * S(chin - 0.012, chin, P[:, 2])
    cw = width_at(P, chin + 0.015, no_ears & (P[:, 1] < yc - 0.02))
    log["chin_w_before_over_facew"] = round(cw / facew, 3)
    if cw > 0:
        k = t["chin_w"] * facew / cw
        P[:, 0] += P[:, 0] * (min(k, 1.3) - 1) * chin_zone
        log["chin_k"] = round(k, 3)

    # ---------------- 7. ears: size, Loomis band, flat to the head
    for sid, sx in ((4, 1), (5, -1)):
        ev = vs([sid])
        bnd = np.array(sorted(sm.boundary(F, ids, [sid], [17])))
        a = P[bnd].mean(axis=0)
        h_cur = float(P[ev, 2].max() - P[ev, 2].min())
        s = t["ear_h"] * hh / h_cur
        q = a + (P[ev] - a) * s
        q[:, 2] += zf(t["ear_top"]) - q[:, 2].max()
        hw = t["head_w"] * hh / 2
        out = np.abs(q[:, 0]) - hw
        stick_now = out.max()
        f = max(t["stick"] * 2 * hw, 0.001) / max(stick_now, 1e-4)
        q[:, 0] = np.where(out > 0, sx * (hw + out * min(f, 1.0)), q[:, 0])
        Dv = q - P[ev]
        d = dist_to(P, ev)
        kd = _kd(P[ev])
        near = np.array([kd.find(Vector(p))[1] for p in P])
        w = np.where(np.isin(np.arange(len(P)), ev), 1.0, S(0.018, 0.0, d)) * is_head
        P = P + Dv[near] * w[:, None]
        log[f"ear_{sid}"] = dict(scale=round(s, 3), h_before=round(h_cur / hh, 3))

    # ---------------- 7b. upper-lid crease: a soft fold about 40 % of the aperture height above the upper lid margin
    import face_rig as fr
    head_faces = [f for f, k in zip(F, ids) if k in sm.HEAD_SETS]
    Tp = fr.Topo(P, head_faces, ["head"] * len(head_faces), ("head",))
    cs = [eyes[k][0].mean(axis=0) for k in (0, 1)]
    rs = [float(0.5 * (eyes[k][0][:, 2].max() - eyes[k][0][:, 2].min())) for k in (0, 1)]
    for L in fr._find_lids(Tp, cs, rs):
        LF = fr.lid_frames(P, L)
        up = P[LF["upper"][0]]
        ap_h = float(up[:, 2].max() - P[LF["lower"][0]][:, 2].min())
        crease = up + np.array([0, 0.0015, 0.42 * ap_h])
        near = np.nonzero(is_head & (np.linalg.norm(P - L["c"], axis=1) < 0.05))[0]
        dd = np.min(np.linalg.norm(P[near][:, None, :] - crease[None, :, :], axis=2), axis=1)
        above = P[near, 2] > np.interp(P[near, 0] * L["sx"], up[:, 0] * L["sx"], up[:, 2]) + 0.001
        P[near, 1] += 0.0011 * np.exp(-(dd / 0.0020) ** 2) * above
    # ---------------- 7c. nose: a defined, longer, slim bridge from between the brows, small slightly upturned tip
    lmn = sm.landmarks(P, F, ids, eyes)
    tip, sub = lmn["nose_tip"], lmn["subnasale"]
    ecz = 0.5 * (cs[0][2] + cs[1][2])
    nas_z = ecz + 0.006
    tt = np.clip((nas_z - P[:, 2]) / max(nas_z - tip[2], 1e-3), 0, 1)
    band = is_head & (P[:, 2] < nas_z + 0.01) & (P[:, 2] > tip[2] - 0.004) & (P[:, 1] < yc - 0.03)
    gx = np.exp(-(P[:, 0] / 0.0075) ** 2)
    P[:, 1] -= 0.0030 * np.sin(np.pi * np.clip(tt * 0.92, 0, 1)) ** 0.7 * gx * band            # bridge forward
    P[:, 0] *= 1 - 0.18 * band * np.exp(-(P[:, 0] / 0.012) ** 2) * (tt < 0.85)                # slimmer bridge
    tipz = np.exp(-np.sum((P - tip) ** 2 * np.array([1.0, 0.6, 1.0]), axis=1) / (2 * 0.008 ** 2)) * is_head
    P[:, 2] -= 0.0025 * tipz                                                                  # tip a little lower (longer nose)
    P[:, 1] -= 0.0010 * tipz
    log["nose_bridge"] = dict(nasion_z=round(float(nas_z), 4), tip_before=[round(float(x), 4) for x in tip])
    # ---------------- Loomis vertical layout (after every feature step; twice so the lines land on target)
    for it in range(3):
        P = loomis_layout(P, F, ids, eyes, lm, t, is_head, head_v, yc, log, f"pass{it}")
    # ---------------- 8. neck width
    sn = lm["sternal_notch"][2]
    nz = np.arange(sn + 0.01, chin - 0.01, 0.004)
    neck_mask = np.zeros(len(P), bool)
    neck_mask[head_v] = True
    ws = [width_at(P, z, neck_mask & (np.abs(P[:, 0]) < 0.09)) for z in nz]
    ws = [x for x in ws if x > 0.03]
    if ws:
        k = t["neck_w"] * hh / min(ws)
        ncy = float(P[neck_mask & (np.abs(P[:, 2] - (sn + chin) / 2) < 0.01), 1].mean())
        wz = S(sn - 0.03, sn + 0.015, P[:, 2]) * (1 - S(chin - 0.03, chin + 0.005, P[:, 2]))
        wz *= (np.abs(P[:, 0]) < 0.12)
        P[:, 0] += P[:, 0] * (k - 1) * wz
        P[:, 1] += (P[:, 1] - ncy) * (k - 1) * wz
        log["neck_k"] = round(k, 3)

    # ---------------- 9. body widths (z bands), depth in proportion
    torso_v = vs(sm.TORSO_SETS)
    leg_v = vs([23, 24, 15, 16, 13, 14] + list(range(25, 64)))
    arm_v = vs([20, 21, 11, 12, 9, 10] + list(range(64, 104)))
    lmn = sm.landmarks(P, F, ids, eyes)
    tor = np.zeros(len(P), bool)
    tor[torso_v] = True
    tor_legs = tor.copy()
    tor_legs[leg_v] = True
    crotch = lmn["crotch"]
    zs = np.arange(crotch - 0.02, crotch + 0.16, 0.005)
    hip_z = zs[int(np.argmax([width_at(P, z, tor_legs) for z in zs]))]
    hip_w = max(width_at(P, z, tor_legs) for z in zs)
    zt = np.arange(hip_z + 0.08, hip_z + 0.32, 0.005)
    nonarm = ~is_head
    nonarm[arm_v] = False
    wt = np.array([width_at(P, z, nonarm & (np.abs(P[:, 0]) < 0.2)) for z in zt])
    wt = np.where(wt > 0.03, wt, 9)
    waist_z, waist_w = zt[int(np.argmin(wt))], float(wt.min())
    band = P[torso_v]
    sh_w = float(2 * np.abs(band[band[:, 2] > sn - 0.14, 0]).max())
    k_sh, k_w, k_h = t["shoulder"] * hh / sh_w, t["waist"] * hh / waist_w, t["hip"] * hh / hip_w
    zb = [crotch - 0.30, hip_z, waist_z, sn - 0.12, sn - 0.03]
    kb = [k_h, k_h, k_w, k_sh, k_sh]
    kz = np.interp(P[:, 2], zb, kb)
    tor_y = float(np.median(P[torso_v, 1]))
    body = ~is_head
    body[arm_v] = False
    leg_mask = np.zeros(len(P), bool)
    leg_mask[leg_v] = True
    # torso (and the very top of the legs) about the midline; legs about their own axis below the crotch
    lw = S(crotch + 0.04, crotch - 0.06, P[:, 2]) * leg_mask
    side = np.sign(P[:, 0])
    hipb_x = abs(lmn["hip_b"][0])
    knee_x = abs(lmn["knee"][0])
    axis_x = side * np.interp(P[:, 2], [lmn["ankle_b"][2], lmn["knee"][2], crotch], [abs(lmn["ankle_b"][0]), knee_x, hipb_x * 0.75])
    Pt = P.copy()
    Pt[:, 0] = P[:, 0] * kz
    Pt[:, 1] = tor_y + (P[:, 1] - tor_y) * kz
    leg_y = np.interp(P[:, 2], [lmn["ankle_b"][2], lmn["knee"][2], crotch], [lmn["ankle_b"][1], lmn["knee"][1], lmn["hip_b"][1]])
    Pl = P.copy()
    Pl[:, 0] = axis_x * k_h + (P[:, 0] - axis_x) * k_h     # the legs move in with the hips and thin by the same factor
    Pl[:, 1] = leg_y + (P[:, 1] - leg_y) * k_h
    feet = np.zeros(len(P), bool)
    feet[vs([13, 14] + list(range(25, 64)))] = True
    Pl[feet, 0] = P[feet, 0] + (axis_x[feet] * k_h - axis_x[feet])
    Pl[feet, 1] = P[feet, 1]
    neckblend = 1 - S(sn - 0.02, sn + 0.02, P[:, 2])
    Pn = Pt * (1 - lw[:, None]) + Pl * lw[:, None]
    P = np.where(body[:, None], P + (Pn - P) * neckblend[:, None], P)
    # arms: shift with the shoulder, thin about their own axis by the shoulder factor
    for sx in (1, -1):
        mir = np.array([sx, 1, 1])
        piv = lmn["pivot"] * mir
        wr = lmn["wrist"] * mir
        am = np.zeros(len(P), bool)
        am[arm_v] = True
        am &= (P[:, 0] * sx) > 0
        shift = piv[0] * (k_sh - 1)
        ax = (wr - piv) / np.linalg.norm(wr - piv)
        rel = P - piv
        along = rel @ ax
        radial = rel - along[:, None] * ax
        hand = np.zeros(len(P), bool)
        hand[vs([9, 10] + list(range(64, 104)))] = True
        thin = np.where(hand, 1.0, min(k_sh, 1.0) ** 0.5)
        Pa = piv + along[:, None] * ax + radial * thin[:, None]
        Pa[:, 0] += shift
        wa = am * S(-0.02, 0.05, along)
        P = P + (Pa - P) * wa[:, None]
        # shoulder cap: shift in with the arm
        cap = tor & ((P[:, 0] * sx) > 0.6 * abs(piv[0])) & (np.abs(P[:, 2] - piv[2]) < 0.10)
        P[cap, 0] += shift * S(0.6 * abs(piv[0]), abs(piv[0]), np.abs(P[cap, 0]))
    log["body"] = dict(k_shoulder=round(k_sh, 3), k_waist=round(k_w, 3), k_hip=round(k_h, 3),
                       before_cm=dict(shoulder=round(sh_w * 100, 1), waist=round(waist_w * 100, 1), hip=round(hip_w * 100, 1)),
                       after_cm=dict(shoulder=round(t["shoulder"] * hh * 100, 1), waist=round(t["waist"] * hh * 100, 1),
                                     hip=round(t["hip"] * hh * 100, 1)))

    # ---------------- 10. light smoothing of the body (face, hands, feet masked), displacement capped at 2 mm
    nbr = [set() for _ in range(len(P))]
    for f in F:
        for i in range(len(f)):
            nbr[f[i]].add(f[i - 1])
            nbr[f[i]].add(f[(i + 1) % len(f)])
    nbr = [np.array(sorted(n)) for n in nbr]
    sm_mask = ~is_head & ~hand & ~feet
    Q = P.copy()
    for _ in range(3):
        for lam in (0.5, -0.53):
            L = np.array([Q[n].mean(axis=0) - Q[i] if len(n) else np.zeros(3) for i, n in enumerate(nbr)])
            Q = Q + lam * L * sm_mask[:, None]
    D = Q - P
    n = np.linalg.norm(D, axis=1, keepdims=True)
    P = P + D * np.minimum(1.0, 0.002 / (n + 1e-12))
    return P, eyes


def loomis_layout(P, F, ids, eyes, lm, t, is_head, head_v, yc, log, tag):
    """move the face lines (brow, eye, nose base, mouth) to the target fractions with a smooth piecewise-linear z map on the
    front of the head (crown and chin fixed); the eyeballs follow the eye line."""
    import source_mesh as sm
    top, chin = lm["top"], lm["chin"]
    hh = top - chin
    frac = lambda z: (top - z) / hh
    zf = lambda f: top - f * hh
    lmn = sm.landmarks(P, F, ids, eyes)
    ec = 0.5 * (eyes[0][0].mean(axis=0) + eyes[1][0].mean(axis=0) * np.array([-1, 1, 1]))
    col = head_v[(np.abs(P[head_v, 0] - ec[0]) < 0.008) & (P[head_v, 2] > ec[2] + 0.012) & (P[head_v, 2] < ec[2] + 0.07) & (P[head_v, 1] < yc)]
    brow_z = P[col[np.argmin(P[col, 1])], 2]
    mouth_z = float(P[[v for v in sm.SPLIT_INFO["upper"] if abs(P[v, 0]) < 0.003], 2].mean())
    cur = [0.0, frac(brow_z), frac(ec[2]), frac(lmn["subnasale"][2]), frac(mouth_z), 1.0]
    tgt = [0.0, t["brow"], t["eye"], t["nose_base"], t["mouth"], 1.0]
    face_front = S(yc + 0.015, yc - 0.035, P[:, 1]) * is_head * S(chin - 0.03, chin, P[:, 2])
    fz = frac(P[:, 2])
    newf = pchip(np.array(cur), np.array(tgt), np.clip(fz, 0, 1))
    P = P.copy()
    P[:, 2] += (zf(newf) - P[:, 2]) * face_front * (fz < 1.0)
    for E, _ in eyes:
        E[:, 2] += zf(t["eye"]) - ec[2]
    log["loomis_" + tag] = [round(c, 3) for c in cur]
    return P


def flatten_mouth(P, is_head, yc, log):
    """move the slit (upper and lower copies alike) onto a nearly level line at the midline contact height (corners 1 mm
    lower: slightly tucked); the upper-lip skin above and the lower lip below follow with a vertical fall-off, so the
    philtrum stays natural and the corners become the true mouth corners."""
    import source_mesh as sm
    sp = sm.SPLIT_INFO
    line = np.array(sp["upper"] + sp["corners"])
    zc = float(P[[v for v in line if abs(P[v, 0]) < 0.002], 2].mean())
    lx = P[line, 0]
    o = np.argsort(lx)
    lx, lz = lx[o], P[line, 2][o]
    half = float(np.abs(lx).max())
    target = zc - 0.001 * (lx / half) ** 2
    dzl = target - lz                                   # <= 0 where the border climbs
    near = is_head & (np.abs(P[:, 0]) < half * 1.35) & (P[:, 1] < yc - 0.02)
    xq = np.clip(P[:, 0], lx[0], lx[-1])
    dz_line = np.interp(xq, lx, dzl) * S(half * 1.35, half * 0.95, np.abs(P[:, 0]))
    zline = np.interp(xq, lx, lz)
    above = P[:, 2] - zline
    w = np.where(above >= 0, S(0.016, 0.0, above), S(-0.010, 0.0, above))
    P = P.copy()
    P[:, 2] += dz_line * w * near
    log["mouth_flatten_mm"] = round(float(-dzl.min()) * 1000, 1)
    return P
