"""The G9 measurements (plan 5.3 and 11.4, same names and definitions as ../measure.py) on the MakeHuman base.

Works on numpy coordinates of the whole hm08 mesh (no Blender objects needed): parts come from the dominant rig bone,
the nose from the nose-target region, the ears from MPFB's `ears` group, the eye corners from the lid ring around the
eyeball (landmarks.py).  Scoring uses ../measure.py: score().
"""
import numpy as np


def _dense(P, faces):
    if not faces:
        return P[:0]
    T = []
    for f in faces:
        for i in range(1, len(f) - 1):
            T.append((f[0], f[i], f[i + 1]))
    T = np.array(T)
    a, b, c = P[T[:, 0]], P[T[:, 1]], P[T[:, 2]]
    out = []
    k = 6
    for i in range(k + 1):
        for j in range(k + 1 - i):
            u, v = i / k, j / k
            out.append(a * u + b * v + c * (1 - u - v))
    return np.concatenate(out)


def Wd(P, z, h=0.008, ax=0, cond=None):
    m = np.abs(P[:, 2] - z) < h
    if cond is not None:
        m &= cond
    return float(P[m, ax].max() - P[m, ax].min()) if m.any() else 0.0


def eye_aperture(P, lm, eye_coords, eye_faces, side="L", step=0.0004):
    """visible eye opening seen from the front: rays along +Y onto the eyeball; a cell is open when the eyeball is hit before
    the head skin.  Returns inner corner, outer corner, top, bottom (3D points on the front plane of the eye)."""
    from mathutils.bvhtree import BVHTree
    from mathutils import Vector
    hf = [f for f, q in zip(lm.faces, lm.fpart) if q == "head"]
    used = sorted({v for f in hf for v in f})
    rm = {v: i for i, v in enumerate(used)}
    skin = BVHTree.FromPolygons([Vector(p) for p in P[used]], [[rm[v] for v in f] for f in hf])
    sx = 1 if side == "L" else -1
    sel = [f for f in eye_faces if np.mean(eye_coords[list(f), 0]) * sx > 0]
    ev = sorted({v for f in sel for v in f})
    em = {v: i for i, v in enumerate(ev)}
    E = eye_coords[ev]
    eye = BVHTree.FromPolygons([Vector(p) for p in E], [[em[v] for v in f] for f in sel])
    xs = np.arange(E[:, 0].min(), E[:, 0].max(), step)
    zs = np.arange(E[:, 2].min(), E[:, 2].max(), step)
    y0 = E[:, 1].min() - 0.1
    open_ = []
    for x in xs:
        for z in zs:
            o = Vector((x, y0, z))
            he = eye.ray_cast(o, Vector((0, 1, 0)))
            if he[0] is None:
                continue
            hs = skin.ray_cast(o, Vector((0, 1, 0)))
            if hs[0] is None or hs[3] > he[3] - 1e-5:
                open_.append((x, he[0].y, z))
    O = np.array(open_)
    eye_aperture.cells = O
    if len(O) == 0:
        c = E.mean(axis=0)
        return c, c, c, c
    ax = np.abs(O[:, 0])
    ci = O[ax <= ax.min() + step * 1.5].mean(axis=0)
    co = O[ax >= ax.max() - step * 1.5].mean(axis=0)
    xc = (ci[0] + co[0]) / 2
    colm = O[np.abs(O[:, 0] - xc) < step * 1.5]
    top = colm[np.argmax(colm[:, 2])]
    bot = colm[np.argmin(colm[:, 2])]
    return ci, co, top, bot


def measure(P, lm, eyeL=None, iris_frac=0.45, sex=0.0, aperture=None):
    """P: hm08 coordinates (metres, Z up, front -Y).  eyeL: coordinates of the left eyeball proxy (radius).
    Returns (body_face, loomis, geo) with the keys of ../measure.py."""
    vp = lm.vpart
    body = lm.body
    nose = lm.nose_set(0.45)
    nose_mask = np.zeros(len(P), bool)
    nose_mask[nose] = True
    ear_mask = np.zeros(len(P), bool)
    ear_mask[lm.ear_L] = ear_mask[lm.ear_R] = True
    bmask = np.zeros(len(P), bool)
    bmask[body] = True
    Hm = bmask & (vp == "head") & ~nose_mask & ~ear_mask
    H = P[Hm]
    fparts = {}
    for p in ("torso", "legs", "arms"):
        fparts[p] = [f for f, q in zip(lm.faces, lm.fpart) if q == p]
    T = np.concatenate([P[bmask & (vp == "torso")], _dense(P, fparts["torso"])])
    L = np.concatenate([P[bmask & (vp == "legs")], _dense(P, fparts["legs"])])
    A = np.concatenate([P[bmask & (vp == "arms")], _dense(P, fparts["arms"])])
    Ft = P[bmask & (vp == "feet")]
    Hd = P[bmask & (vp == "hands")]
    allv = np.concatenate([P[bmask & (vp == "head")], T, L, Ft])
    z0, z1 = allv[:, 2].min(), allv[:, 2].max()
    ht = z1 - z0
    chin = P[lm.chin, 2]
    hh = z1 - chin
    ci, co, lu, ll = aperture if aperture is not None else (P[i] for i in lm.eye_frame(P, "L"))
    eyez = (ci[2] + co[2]) / 2
    headw = max(Wd(H, z) for z in np.arange(chin + 0.08, z1 - 0.02, 0.005))
    facew = Wd(H, eyez - 0.02, cond=H[:, 1] < H[:, 1].mean())
    mc_, mcr = P[lm.mouthCorner_L], P[lm.mouthCorner_R]
    mz = mc_[2]
    jaww = Wd(H, mz - 0.012, cond=H[:, 1] < -0.02 + H[:, 1].mean() * 0)
    chinw = Wd(H, chin + 0.012, cond=H[:, 1] < P[lm.chin, 1] + 0.03)
    N = P[nose]
    ntip = N[np.argmin(N[:, 1])]
    al = N[N[:, 1] < ntip[1] + 0.016]
    nosew = float(al[:, 0].max() - al[:, 0].min())
    # subnasale: deepest (max y) point of the front midline profile between the nose tip and the upper lip top
    midb = P[body][np.abs(P[body, 0]) < 1e-4]
    lt_z = P[lm.lipTop, 2]
    prof = midb[(midb[:, 2] > lt_z) & (midb[:, 2] < ntip[2]) & (midb[:, 1] < ntip[1] + 0.03)]
    zb_ = np.round(prof[:, 2] / 0.001)
    front = np.array([prof[zb_ == z][np.argmin(prof[zb_ == z][:, 1])] for z in np.unique(zb_)])
    # subnasale: the deepest corner of the front midline profile between the nose tip and the upper lip's vermilion top
    # (largest distance behind the tip-to-lip line); robust for upturned and long noses alike
    midb2 = P[body][np.abs(P[body, 0]) < 1e-4]
    ltp = P[lm.lipTop]
    cand = midb2[(midb2[:, 2] < ntip[2]) & (midb2[:, 2] > ltp[2]) & (midb2[:, 1] < ntip[1] + 0.03)]
    zb3 = np.round(cand[:, 2] / 0.0008)
    prof3 = np.array([cand[zb3 == z][np.argmin(cand[zb3 == z][:, 1])] for z in np.unique(zb3)])
    a3, b3 = ntip[1:], ltp[1:]
    t3 = (b3 - a3) / np.linalg.norm(b3 - a3)
    n3 = np.array([-t3[1], t3[0]])
    dd3 = (prof3[:, 1:] - a3) @ n3
    sub = float(prof3[np.argmax(np.abs(dd3)), 2])
    ear = P[lm.ear_L]
    crotch_cands = P[bmask & ((vp == "torso") | (vp == "legs")) & (np.abs(P[:, 0]) < 0.004) & (P[:, 2] < z0 + 0.6 * ht)]
    crotch = float(crotch_cands[:, 2].max()) if len(crotch_cands) else float(T[:, 2].min())
    # crotch: highest midline point of the gap between the legs = lowest midline torso/leg vertex above the knees
    mid = P[bmask & (np.abs(P[:, 0]) < 0.004) & (P[:, 2] > z0 + 0.3 * ht) & (P[:, 2] < z0 + 0.6 * ht)]
    crotch = float(mid[:, 2].min()) if len(mid) else crotch
    TL = np.concatenate([T, L])
    zs = np.arange(crotch - 0.05, T[:, 2].max(), 0.005)
    wx = np.array([Wd(TL, z) for z in zs])
    clav = lm.joint(P, "joint-l-clavicle")
    neckbase = float(clav[2])
    m = (zs > crotch - 0.02) & (zs < crotch + 0.16)
    hip_i = np.argmax(np.where(m, wx, 0))
    hipw, hipz = wx[hip_i], zs[hip_i]
    zt = np.arange(hipz + 0.08, hipz + 0.32, 0.005)
    wt = np.array([Wd(T, z, cond=np.abs(T[:, 0]) < 0.2) for z in zt])
    wt = np.where(wt > 0.03, wt, 9)
    wi = np.argmin(wt)
    waistw, waistz = wt[wi], zt[wi]
    waistd, hipd = Wd(T, waistz, ax=1), Wd(TL, hipz, ax=1)
    zb = np.arange(waistz + 0.08, neckbase - 0.08, 0.005)
    db = np.array([Wd(T, z, ax=1, cond=np.abs(T[:, 0]) < 0.15) for z in zb])
    bi = np.argmax(db)
    bustd, bustz = db[bi], zb[bi]
    bustw = Wd(T, bustz, cond=np.abs(T[:, 0]) < 0.19)
    shw = float(2 * np.abs(T[T[:, 2] > neckbase - 0.14][:, 0]).max())
    HN = np.concatenate([P[bmask & (vp == "head")], T])
    zn = np.arange(neckbase + 0.01, chin - 0.005, 0.004)
    nw = [Wd(HN, z, h=0.006, cond=np.abs(HN[:, 0]) < 0.09) for z in zn]
    neckw = min([x for x in nw if x > 0.03] or [0.0])
    wrist = lm.joint(P, "joint-l-hand")
    el = lm.joint(P, "joint-l-elbow")
    sh = lm.joint(P, "joint-l-shoulder")
    hl = Hd[Hd[:, 0] > 0]
    handlen = float(np.linalg.norm(hl - wrist, axis=1).max())
    knee, ankle = lm.joint(P, "joint-l-knee")[2], lm.joint(P, "joint-l-ankle")[2]
    Lp = L[L[:, 0] > 0]

    def lw(z):
        mm = np.abs(Lp[:, 2] - z) < 0.01
        return float(Lp[mm, 0].max() - Lp[mm, 0].min()) if mm.any() else 0
    thigh = max(lw(z) for z in np.arange(knee + 0.12, crotch - 0.03, 0.01))
    calf = max(lw(z) for z in np.arange(ankle + 0.1, knee - 0.06, 0.01))
    kneew = lw(knee)
    anklew = min([x for x in [lw(z) for z in np.arange(ankle, ankle + 0.08, 0.01)] if x > 0] or [0.0])
    armlen = float(np.linalg.norm(el - sh) + np.linalg.norm(wrist - el))
    d = (el - sh) / np.linalg.norm(el - sh)
    pivot = sh - d * 0.07
    wrist_hang = pivot[2] - float(np.linalg.norm(el - pivot) + np.linalg.norm(wrist - el))
    footlen = float(Ft[:, 1].max() - Ft[:, 1].min())
    ew = float(np.linalg.norm(co - ci))
    eh = float(lu[2] - ll[2])
    inter = float(abs(ci[0]) * 2)
    er = float((eyeL[:, 0].max() - eyeL[:, 0].min()) / 2) if eyeL is not None else 0.012
    lt, lb = P[lm.lipTop], P[lm.lipBottom]
    mw = float(abs(mc_[0] - mcr[0]))
    r = dict(height=ht, head_h=hh, heads_tall=ht / hh, head_w_over_h=headw / hh, face_w_over_head_h=facew / hh,
             jaw_w_over_face_w=jaww / facew, chin_w_over_face_w=chinw / facew, neck_w_over_head_h=neckw / hh,
             neck_len_over_head_h=(chin - neckbase) / hh, shoulder_w_over_head_h=shw / hh, bust_w_over_head_h=bustw / hh,
             bust_depth_over_head_h=bustd / hh, waist_w_over_head_h=waistw / hh, hip_w_over_head_h=hipw / hh,
             waist_over_hip=waistw / hipw, waist_over_shoulder=waistw / shw, hip_over_shoulder=hipw / shw,
             chest_depth_over_w=bustd / max(bustw, 1e-6), waist_depth_over_w=waistd / waistw, hip_depth_over_w=hipd / hipw,
             crotch_over_height=(crotch - z0) / ht, knee_over_height=(knee - z0) / ht, thigh_w_over_head_h=thigh / hh,
             calf_w_over_head_h=calf / hh, knee_w_over_head_h=kneew / hh, ankle_w_over_head_h=anklew / hh,
             arm_len_over_height=armlen / ht, wrist_hang_vs_crotch=(wrist_hang - crotch) / ht,
             hand_len_over_head_h=handlen / hh, foot_len_over_head_h=footlen / hh,
             eye_w_over_head_h=ew / hh, eye_w_over_face_w=ew / facew, eye_h_over_w=eh / ew,
             eye_tilt_deg=float(np.degrees(np.arctan2(co[2] - ci[2], co[0] - ci[0]))), inter_over_eye_w=inter / ew,
             iris_d_over_eye_w=2 * iris_frac * er / ew, eyeball_d_over_head_h=2 * er / hh, eyeball_d_over_eye_w=2 * er / ew,
             eye_line_from_top=(z1 - eyez) / hh, nose_w_over_face_w=nosew / facew, nose_w_over_inter=nosew / inter,
             nose_len_over_head_h=(ci[2] - sub) / hh,
             mouth_w_over_face_w=mw / facew, mouth_w_over_nose_w=mw / nosew,
             ear_h_over_head_h=float(ear[:, 2].max() - ear[:, 2].min()) / hh,
             ear_stickout_over_head_w=float(ear[:, 0].max() - headw / 2) / headw,
             lip_h_over_mouth_w=float(lt[2] - lb[2]) / mw, lip_h_over_head_h=float(lt[2] - lb[2]) / hh)
    # ---------------- Loomis (fractions of head height from the crown)
    top = z1
    col = H[(np.abs(H[:, 0] - (ci[0] + co[0]) / 2) < 0.008) & (H[:, 2] > lu[2] + 0.004) & (H[:, 2] < lu[2] + 0.05) & (H[:, 1] < ci[1] + 0.02)]
    brow = col[np.argmin(col[:, 1])]
    midH = H[(np.abs(H[:, 0]) < 0.006) & (H[:, 1] < H[:, 1].mean() - 0.03)]
    lipc = P[lm.lipContact]
    eart, earb = ear[:, 2].max(), ear[:, 2].min()
    earf, earbk = ear[:, 1].min(), ear[:, 1].max()
    yfront = min(midH[:, 1].min(), ntip[1])
    yback = H[:, 1].max()
    q = ear[:, 1:3] - ear[:, 1:3].mean(axis=0)
    _, evec = np.linalg.eigh(q.T @ q)
    ax_ = evec[:, -1]
    if ax_[1] < 0:
        ax_ = -ax_
    tilt = float(np.degrees(np.arctan2(ax_[0], ax_[1])))
    f = lambda z: (top - z) / hh
    lo = dict(brow_line=f(brow[2]), eye_line=f(eyez), eye_between_brow_and_nose=(brow[2] - eyez) / (brow[2] - sub),
              nose_tip=f(ntip[2]), nose_base=f(sub), mouth_line=f(lipc[2]),
              lower_over_middle_third=(sub - chin) / (brow[2] - sub), ear_top=f(eart), ear_bottom=f(earb), ear_h=(eart - earb) / hh,
              ear_front_depth=(earf - yfront) / (yback - yfront), ear_tilt_deg=tilt,
              head_w_over_h=headw / hh, head_depth_over_h=(yback - yfront) / hh,
              eye_w_over_head_w=ew / headw, gap_over_head_w=inter / headw, nose_w_over_head_w=nosew / headw,
              mouth_w_over_head_w=mw / headw, mouth_w_over_pupil=mw / float(abs(ci[0] + co[0])),
              lip_top=f(lt[2]), lip_bottom=f(lb[2]))
    # ---------------- measured anthropometry (Farkas 2005 landmarks; replaces the Loomis rows, see g9 11)
    midf = P[body][np.abs(P[body, 0]) < 1e-4]
    zb2 = np.round(midf[:, 2] / 0.0015)
    frontp = {}
    for z in np.unique(zb2):
        q = midf[zb2 == z]
        frontp[z] = q[np.argmin(q[:, 1])]
    fp = np.array(list(frontp.values()))
    seg = fp[(fp[:, 2] > eyez - 0.004) & (fp[:, 2] < brow[2])]
    nasion = seg[np.argmax(seg[:, 1])]                      # deepest front-profile point between the brows and the nose
    scalp = P[lm.B.groups["scalp"]]
    sc_mid = scalp[(np.abs(scalp[:, 0]) < 0.01) & (scalp[:, 1] < yfront + 0.06)]
    hairline_z = float(sc_mid[:, 2].min()) if len(sc_mid) else float(top - 0.25 * hh)
    pupil = abs(ci[0] + co[0])
    upper = hairline_z - nasion[2]
    middle = nasion[2] - sub
    lower = sub - chin
    an = dict(lower_over_middle=lower / middle, upper_over_middle=upper / middle,
              eye_len_over_gap=ew / inter, nose_w_over_gap=nosew / inter, mouth_over_nose_w=mw / nosew,
              mouth_over_pupil=mw / pupil, mouth_line_in_lower=(sub - lipc[2]) / lower,
              head_h_over_w=hh / headw, face_over_head_h=(nasion[2] - chin) / hh, eye_w_over_head_w=ew / headw,
              upper_lip_over_lower_lip=(lt[2] - lipc[2]) / max(lipc[2] - lb[2], 1e-6))
    lo.update({k: v for k, v in an.items()})
    geo_an = dict(nasion=float(nasion[2]), hairline=hairline_z, nasion_y=float(nasion[1]))
    geo = dict(**geo_an, top=float(top), chin=float(chin), hh=float(hh), yfront=float(yfront), yback=float(yback), brow=float(brow[2]),
               eye=float(eyez), sub=float(sub), lip=float(lipc[2]), ntip=[float(x) for x in ntip], eart=float(eart), earb=float(earb),
               earf=float(earf), earbk=float(earbk), width=float(headw), eye_ci=[float(x) for x in ci], eye_co=[float(x) for x in co],
               mc=[float(x) for x in mc_], nosew=nosew, lt=float(lt[2]), lb=float(lb[2]), tilt=tilt,
               earc=[float(x) for x in ear.mean(axis=0)], crotch=float(crotch), z0=float(z0), height=float(ht))
    rd = lambda d: {k: round(float(v), 3) for k, v in d.items()}
    return rd(r), rd(lo), geo
