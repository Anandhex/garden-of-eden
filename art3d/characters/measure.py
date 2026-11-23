"""Measurements of the neutral person in rest pose (G9 plan sections 5.3 and 11.4), shared by compare.py and loomis_overlay.py.

Body and face ratios follow previews/compare/plan/measure_ours_3d.py (dense triangle sampling of torso, legs and arms, so the
slices do not depend on decimation); Loomis positions follow previews/compare/plan/loomis/measure_round7_loomis.py
(fractions of head height down from the crown).  Scoring: g = |ours - target| / tol, ">=" rows g = 0 when met else
(limit - ours) / 0.1.  Targets live in compare_targets.json.
"""
import bpy, os, json, math
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
DENSE = ('Mesh_Torso', 'Mesh_Legs', 'Mesh_Arms')


def meta():
    return json.load(open(os.path.join(HERE, "export", "base_body_meta.json")))


def ev(n, dense=False):
    dg = bpy.context.evaluated_depsgraph_get()
    o = bpy.data.objects[n].evaluated_get(dg)
    me = o.to_mesh()
    P = np.array([(o.matrix_world @ v.co)[:] for v in me.vertices])
    if dense:
        me.calc_loop_triangles()
        T = np.array([t.vertices[:] for t in me.loop_triangles])
        a, b, c = P[T[:, 0]], P[T[:, 1]], P[T[:, 2]]
        out = [P]
        k = 6
        for i in range(k + 1):
            for j in range(k + 1 - i):
                u, v = i / k, j / k
                out.append(a * u + b * v + c * (1 - u - v))
        P = np.concatenate(out)
    o.to_mesh_clear()
    return P


def setk(w):
    for o in bpy.data.objects:
        if o.type == 'MESH' and o.data.shape_keys:
            for k in o.data.shape_keys.key_blocks[1:]:
                k.value = float(w.get(k.name, 0.0))


def W(P, z, h=0.008, ax=0, cond=None):
    m = np.abs(P[:, 2] - z) < h
    if cond is not None:
        m &= cond
    return float(P[m, ax].max() - P[m, ax].min()) if m.any() else 0.0


def _lm(M, E, k):
    d = M["faceLandmarkVerts"].get(k)
    if not d or d["vertex"] < 0:
        return None
    return E[d["mesh"]][d["vertex"]]


def measure(weights, sex_key=None):
    """all body, face and Loomis numbers for the shape weights (rest pose).  Returns (body_face, loomis, geo)."""
    M = meta()
    arm = bpy.data.objects["Armature"]
    old = arm.data.pose_position
    arm.data.pose_position = 'REST'
    setk(weights)
    bpy.context.view_layer.update()
    sex = float(weights.get("Sex", 0.0))
    names = ["Mesh_Head", "Mesh_Torso", "Mesh_Arms", "Mesh_Hands", "Mesh_Legs", "Mesh_Feet", "Part_Nose", "Part_Ear_L"]
    E = {n: ev(n, n in DENSE) for n in names}
    H, T, L, Ft, A, Hd = E["Mesh_Head"], E["Mesh_Torso"], E["Mesh_Legs"], E["Mesh_Feet"], E["Mesh_Arms"], E["Mesh_Hands"]
    allv = np.concatenate([H, T, L, Ft])
    z0, z1 = allv[:, 2].min(), allv[:, 2].max()
    ht = z1 - z0
    front = H[H[:, 1] < H[:, 1].mean() - 0.02]
    chin = front[np.abs(front[:, 0]) < 0.02][:, 2].min()
    hh = z1 - chin
    hv = lambda k: _lm(M, E, k)
    ci, co, lu, ll = hv("canthusInner_L"), hv("canthusOuter_L"), hv("lidUpper_L"), hv("lidLower_L")
    eyez = (ci[2] + co[2]) / 2
    headw = max(W(H, z) for z in np.arange(chin + 0.08, z1 - 0.02, 0.005))
    facew = W(H, eyez - 0.02, cond=H[:, 1] < H[:, 1].mean())
    mc, mcr = hv("mouthCorner_L"), hv("mouthCorner_R")
    mz = mc[2]
    jaww = W(H, mz - 0.012, cond=H[:, 1] < -0.02)
    chinw = W(H, chin + 0.012, cond=H[:, 1] < -0.04)
    N = E["Part_Nose"]
    ntip = N[np.argmin(N[:, 1])]
    if "sternal_notch" in M["landmarks"]:            # G9 scan nose: alar width and the true subnasale (see source_mesh)
        al = N[N[:, 1] < ntip[1] + 0.016]
        nosew = float(al[:, 0].max() - al[:, 0].min())
        nm = N[(np.abs(N[:, 0]) < 0.004) & (N[:, 1] < ntip[1] + 0.04)]
        sub = float(nm[:, 2].min())
    else:
        nosew = float(N[:, 0].max() - N[:, 0].min())
        sub = N[np.abs(N[:, 0]) < 0.004][:, 2].min()
    ear = E["Part_Ear_L"]
    TL = np.concatenate([T, L])
    crotch = T[np.abs(T[:, 0]) < 0.004][:, 2].min() if np.any(np.abs(T[:, 0]) < 0.004) else T[:, 2].min()
    zs = np.arange(crotch - 0.05, T[:, 2].max(), 0.005)
    wx = np.array([W(TL, z) for z in zs])
    LMK0 = M["landmarks"] if sex < 0.5 else M["landmarksFemale"]
    if "sternal_notch" in LMK0:          # G9 scan base: the neck seam rises at the back, use the sternal notch
        neckbase = float(LMK0["sternal_notch"][2])
    else:
        neckbase = float(np.median(T[T[:, 2] > T[:, 2].max() - 0.01][:, 2]))
    m = (zs > crotch - 0.02) & (zs < crotch + 0.16)
    hip_i = np.argmax(np.where(m, wx, 0))
    hipw, hipz = wx[hip_i], zs[hip_i]
    zt = np.arange(hipz + 0.08, hipz + 0.32, 0.005)
    wt = np.array([W(T, z, cond=np.abs(T[:, 0]) < 0.2) for z in zt])
    wt = np.where(wt > 0.03, wt, 9)
    wi = np.argmin(wt)
    waistw, waistz = wt[wi], zt[wi]
    waistd, hipd = W(T, waistz, ax=1), W(TL, hipz, ax=1)
    zb = np.arange(waistz + 0.08, neckbase - 0.08, 0.005)
    db = np.array([W(T, z, ax=1, cond=np.abs(T[:, 0]) < 0.15) for z in zb])
    bi = np.argmax(db)
    bustd, bustz = db[bi], zb[bi]
    bustw = W(T, bustz, cond=np.abs(T[:, 0]) < 0.19)
    shw = float(2 * np.abs(T[T[:, 2] > neckbase - 0.14][:, 0]).max())     # torso part only (shoulder caps), as the planner
    HN = np.concatenate([H, T])
    zn = np.arange(neckbase + 0.01, chin - 0.005, 0.004)
    nw = [W(HN, z, h=0.006, cond=np.abs(HN[:, 0]) < 0.09) for z in zn]
    neckw = min([x for x in nw if x > 0.03] or [0.0])
    LMK = M["landmarks"] if sex < 0.5 else M["landmarksFemale"]
    wrist = np.array(LMK["wrist"])
    hl = Hd[Hd[:, 0] > 0]
    handlen = float(np.linalg.norm(hl - wrist, axis=1).max())
    knee, ankle = LMK["knee"][2], LMK["ankle_b"][2]
    Lp = L[L[:, 0] > 0]

    def lw(z):
        mm = np.abs(Lp[:, 2] - z) < 0.01
        return float(Lp[mm, 0].max() - Lp[mm, 0].min()) if mm.any() else 0
    thigh = max(lw(z) for z in np.arange(knee + 0.12, crotch - 0.03, 0.01))
    calf = max(lw(z) for z in np.arange(ankle + 0.1, knee - 0.06, 0.01))
    kneew = lw(knee)
    anklew = min([x for x in [lw(z) for z in np.arange(ankle, ankle + 0.08, 0.01)] if x > 0] or [0.0])
    sh, el = np.array(LMK["shoulder_b"]), np.array(LMK["elbow"])
    armlen = float(np.linalg.norm(el - sh) + np.linalg.norm(wrist - el))
    pivot = np.array(LMK.get("pivot", LMK["shoulder_b"]))
    # wrist when the arm hangs straight down from the shoulder pivot
    wrist_hang = pivot[2] - float(np.linalg.norm(el - pivot) + np.linalg.norm(wrist - el))
    footlen = float(Ft[:, 1].max() - Ft[:, 1].min())
    ew = float(np.linalg.norm(co - ci))
    eh = float(lu[2] - ll[2])
    inter = float(abs(ci[0]) * 2)
    er = M["faceRig"]["eyeRadius"][0]
    iris_frac = M["faceRig"].get("irisFrac", 0.40)
    lt, lb = hv("lipTop"), hv("lipBottom")
    r = dict(height=ht, head_h=hh, heads_tall=ht / hh, head_w_over_h=headw / hh, face_w_over_head_h=facew / hh,
             jaw_w_over_face_w=jaww / facew, chin_w_over_face_w=chinw / facew, neck_w_over_head_h=neckw / hh,
             neck_len_over_head_h=(chin - neckbase) / hh, shoulder_w_over_head_h=shw / hh, bust_w_over_head_h=bustw / hh,
             bust_depth_over_head_h=bustd / hh, waist_w_over_head_h=waistw / hh, hip_w_over_head_h=hipw / hh,
             waist_over_hip=waistw / hipw, waist_over_shoulder=waistw / shw, hip_over_shoulder=hipw / shw,
             chest_depth_over_w=bustd / max(bustw, 1e-6), waist_depth_over_w=waistd / waistw, hip_depth_over_w=hipd / hipw,
             crotch_over_height=(crotch - z0) / ht, knee_over_height=(knee - z0) / ht, thigh_w_over_head_h=thigh / hh,
             calf_w_over_head_h=calf / hh, knee_w_over_head_h=kneew / hh, ankle_w_over_head_h=anklew / hh,
             thigh_over_hip=thigh / hipw, knee_over_hip=kneew / hipw, calf_over_hip=calf / hipw, ankle_over_hip=anklew / hipw,
             arm_len_over_height=armlen / ht, wrist_hang_vs_crotch=(wrist_hang - crotch) / ht,
             hand_len_over_head_h=handlen / hh, foot_len_over_head_h=footlen / hh,
             eye_w_over_head_h=ew / hh, eye_w_over_face_w=ew / facew, eye_h_over_w=eh / ew,
             eye_tilt_deg=float(np.degrees(np.arctan2(co[2] - ci[2], co[0] - ci[0]))), inter_over_eye_w=inter / ew,
             iris_d_over_eye_w=2 * iris_frac * er / ew, eyeball_d_over_head_h=2 * er / hh, eyeball_d_over_eye_w=2 * er / ew,
             eye_line_from_top=(z1 - eyez) / hh, nose_w_over_face_w=nosew / facew, nose_w_over_inter=nosew / inter,
             nose_len_over_head_h=(ci[2] - sub) / hh,
             mouth_w_over_face_w=float(abs(mc[0] - mcr[0])) / facew, mouth_w_over_nose_w=float(abs(mc[0] - mcr[0])) / nosew,
             ear_h_over_head_h=float(ear[:, 2].max() - ear[:, 2].min()) / hh,
             ear_stickout_over_head_w=float(ear[:, 0].max() - headw / 2) / headw)
    if lt is not None and lb is not None:
        r["lip_h_over_mouth_w"] = float(lt[2] - lb[2]) / float(abs(mc[0] - mcr[0]))
        r["lip_h_over_head_h"] = float(lt[2] - lb[2]) / hh
    # ---------------- Loomis (fractions of head height from the crown)
    top = z1
    col = H[(np.abs(H[:, 0] - (ci[0] + co[0]) / 2) < 0.008) & (H[:, 2] > lu[2] + 0.004) & (H[:, 2] < lu[2] + 0.05) & (H[:, 1] < -0.05)]
    brow = col[np.argmin(col[:, 1])]
    mid = H[(np.abs(H[:, 0]) < 0.006) & (H[:, 1] < -0.05)]
    lipc = hv("lipUpperContact")
    eart, earb = ear[:, 2].max(), ear[:, 2].min()
    earf, earbk = ear[:, 1].min(), ear[:, 1].max()
    yfront = min(mid[:, 1].min(), ntip[1])
    yback = H[:, 1].max()
    # ear tilt: principal axis of the ear in the side (y, z) plane, degrees back from vertical
    q = ear[:, 1:3] - ear[:, 1:3].mean(axis=0)
    ev_, evec = np.linalg.eigh(q.T @ q)
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
              mouth_w_over_head_w=float(abs(mc[0] - mcr[0])) / headw,
              mouth_w_over_pupil=float(abs(mc[0] - mcr[0])) / float(abs(ci[0] + co[0])))
    if lt is not None and lb is not None:
        lo["lip_top"], lo["lip_bottom"] = f(lt[2]), f(lb[2])
    geo = dict(top=float(top), chin=float(chin), hh=float(hh), yfront=float(yfront), yback=float(yback), brow=float(brow[2]),
               eye=float(eyez), sub=float(sub), lip=float(lipc[2]), ntip=[float(x) for x in ntip], eart=float(eart), earb=float(earb),
               earf=float(earf), earbk=float(earbk), width=float(headw), eye_ci=[float(x) for x in ci], eye_co=[float(x) for x in co],
               mc=[float(x) for x in mc], nosew=nosew, lt=None if lt is None else float(lt[2]), lb=None if lb is None else float(lb[2]),
               tilt=tilt, earc=[float(x) for x in ear.mean(axis=0)])
    arm.data.pose_position = old
    rd = lambda d: {k: round(float(v), 3) for k, v in d.items()}
    return rd(r), rd(lo), geo


def score(values, targets, sex):
    """[(group, metric, ours, target, tol, weight, g)], weighted mean g."""
    rows = []
    for grp in ("body_face", "loomis"):
        for name, t in targets[grp].items():
            ours = values[grp].get(name)
            tgt = t["F"] if sex == "F" else t["M"]
            if ours is None or tgt is None:
                rows.append((grp, name, ours, tgt, t.get("tol"), t["w"], None))
                continue
            if isinstance(tgt, str) and tgt.startswith(">="):
                lim = float(tgt[2:])
                g = 0.0 if ours >= lim else (lim - ours) / 0.1
            else:
                g = abs(ours - tgt) / t["tol"]
            rows.append((grp, name, ours, tgt, t.get("tol"), t["w"], round(g, 2)))
    sc = [r for r in rows if r[6] is not None]
    wm = sum(r[5] * r[6] for r in sc) / max(sum(r[5] for r in sc), 1e-9)
    return rows, round(wm, 3)
