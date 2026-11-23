"""Assemble a renderable MakeHuman person in the scene through MPFB: basemesh with our coordinates, the Mixamo/Unity rig
fitted by MPFB with its weights, and the proxies (eyes, brows, lashes, teeth, tongue, hair) fitted and rigged by MPFB.
Used by the comparison rounds and the checkpoint sheets (the contract build is build_mh.py)."""
import bpy, os, sys
import numpy as np
import mhcore as mc
import look_mh as lk

KINDS = {"eyes": "Eyes", "eyebrows": "Eyebrows", "eyelashes": "Eyelashes", "teeth": "Teeth", "tongue": "Tongue", "hair": "Hair"}


def clear_people():
    for o in list(bpy.data.objects):
        if o.get("mh_person") or o.name.startswith("MHP_"):
            bpy.data.objects.remove(o, do_unlink=True)
    for m in list(bpy.data.meshes):
        if m.users == 0:
            bpy.data.meshes.remove(m)
    for a in list(bpy.data.armatures):
        if a.users == 0:
            bpy.data.armatures.remove(a)


def build(P, proxies, name="MHP", tint=None, tone="T2_fair", hair_col=(0.20, 0.11, 0.06), brow_col=(0.16, 0.09, 0.05),
          lash_col=(0.02, 0.015, 0.012), eye_tex=None, rig=True, offset=(0, 0, 0), decal=None, lash_tex=None,
          brow_gain=1.2, lash_gain=1.6, ribbon=None, snap_faces=None, brow_params=None, brow_tex=None,
          gloss=True, tear_duct=None, lash_proxy=None, teeth_offset=None):
    """P: hm08 coordinates (19158 x 3).  proxies: {kind: asset name or None}.  Returns dict of objects."""
    HS = mc.HS()
    h = HS.create_human(mask_helpers=True, detailed_helpers=True, extra_vertex_groups=True, feet_on_ground=False, scale=0.1,
                        macro_detail_dict=mc.full_macro({}))
    if h.data.shape_keys:
        h.shape_key_clear()
    h.data.vertices.foreach_set("co", np.asarray(P, float).ravel())
    h.data.update()
    h.name = name + "_Body"
    h["mh_person"] = 1
    out = {"body": h}
    arm = None
    if rig:
        arm = HS.add_builtin_rig(h, "mixamo_unity")
        arm.name = name + "_Rig"
        arm["mh_person"] = 1
        out["rig"] = arm
    for kind, asset in proxies.items():
        if not asset or (kind == "eyelashes" and asset == "ribbon"):
            continue
        f = mc.proxy_file(kind, asset)
        o = HS.add_mhclo_asset(f, h, asset_type=KINDS[kind], subdiv_levels=0, material_type="MAKESKIN", set_up_rigging=rig)
        o.name = f"{name}_{kind}"
        o["mh_person"] = 1
        out[kind] = o
        for md in o.modifiers:
            if md.type == 'SUBSURF':
                md.levels = md.render_levels = 0
    # materials
    sk = lk.skin(tone, name=f"MH_Skin_{name}", decal=decal[0] if decal else None)
    h.data.materials.clear()
    h.data.materials.append(sk)
    import paint as _paint, landmarks as _lmk
    if gloss and getattr(build, "_lm", None) is not None:
        Mk = _paint.face_mask(np.asarray(P, float), build._lm, build._lm.B)
        Mk[:, 0] *= float(gloss)
        lk.set_mask(h, Mk)
    else:
        lk.set_mask(h, np.zeros((len(h.data.vertices), 3)))
    if tint is not None:
        lk.set_tint(h, tint)
    else:
        lk.set_tint(h, np.ones((len(h.data.vertices), 3)))
    if "eyes" in out:
        px = mc.Proxy(mc.proxy_file("eyes", proxies["eyes"]))
        tex = eye_tex or mc.user_data("eyes", "materials", "brown_eye.png")
        if not os.path.isabs(tex):
            tex = os.path.join(os.path.dirname(os.path.abspath(__file__)), "textures", tex)
        em = lk.eye(tex, name=f"MH_Eye_{name}")
        me = out["eyes"].data
        me.materials.clear()
        me.materials.append(em)
        me.materials.append(lk.cornea(name=f"MH_Cornea_{name}"))
        uv = np.empty(len(me.loops) * 2)
        me.uv_layers.active.data.foreach_get("uv", uv)
        uv = uv.reshape(-1, 2)
        for p in me.polygons:
            u = uv[p.loop_start:p.loop_start + p.loop_total].mean(axis=0)
            p.material_index = 1 if (u[0] > 0.8 and u[1] < 0.2) else 0
    for kind, col, gain in (("eyelashes", lash_col, lash_gain), ("eyebrows", brow_col, brow_gain), ("hair", hair_col, 1.0)):
        if kind in out:
            px = mc.Proxy(mc.proxy_file(kind, proxies[kind]))
            tex = px.texture()
            if kind == "eyebrows" and brow_tex:
                tex = (os.path.join(os.path.dirname(os.path.abspath(__file__)), "textures", brow_tex + ".png") if brow_tex.startswith("brow_")
                       else mc.user_data("eyebrows", brow_tex, brow_tex + ".png"))
            if kind == "eyelashes" and lash_tex:
                tex = os.path.join(os.path.dirname(os.path.abspath(__file__)), "textures", lash_tex)
            m = lk.card(tex, f"MH_{kind}_{name}", colour=col if kind != "hair" else None, rough=0.7 if kind != "hair" else 0.55,
                        alpha_gain=gain, solid=kind != "hair", clip=0.18 if kind == "eyebrows" else 0.0)
            if kind == "hair":
                import hair_lib
                m = hair_lib.hair_material(tex, f"MH_{kind}_{name}", col)
            out[kind].data.materials.clear()
            out[kind].data.materials.append(m)
    if "teeth" in out:
        out["teeth"].data.materials.clear()
        out["teeth"].data.materials.append(lk.flat(f"MH_Teeth_{name}", (0.93, 0.89, 0.80), 0.35))
    if "tongue" in out:
        out["tongue"].data.materials.clear()
        out["tongue"].data.materials.append(lk.flat(f"MH_Tongue_{name}", (0.72, 0.33, 0.33), 0.45, 0.2))
    if proxies.get("eyelashes") == "ribbon" and ribbon is not None:
        out["eyelashes"] = ribbon_object(ribbon, P, f"{name}_eyelashes", arm, lash_col)
    if lash_proxy is not None and "eyelashes" in out:
        me_ = out["eyelashes"].data
        me_.vertices.foreach_set("co", lash_proxy.fit(np.asarray(P, float)).ravel())
        me_.update()
    if teeth_offset is not None and "teeth" in out:
        me_ = out["teeth"].data
        co_ = np.array([v.co[:] for v in me_.vertices]) + np.asarray(teeth_offset)
        me_.vertices.foreach_set("co", co_.ravel())
        me_.update()
    if tear_duct is not None:
        V = tear_duct.fit(np.asarray(P, float))
        me = bpy.data.meshes.new(f"{name}_tearduct")
        me.from_pydata(V.tolist(), [], [list(f) for f in tear_duct.faces])
        for p_ in me.polygons:
            p_.use_smooth = True
        ob = bpy.data.objects.new(f"{name}_tearduct", me)
        bpy.context.scene.collection.objects.link(ob)
        ob["mh_person"] = 1
        me.materials.append(lk.flat(f"MH_TearDuct_{name}", (0.80, 0.50, 0.50), 0.18, 0.5))
        if arm is not None:
            vg = ob.vertex_groups.new(name="mixamorig:Head")
            vg.add(list(range(len(V))), 1.0, 'REPLACE')
            ob.parent = arm
            ob.modifiers.new("Armature", 'ARMATURE').object = arm
        out["tear_duct"] = ob
    if snap_faces is not None and "eyebrows" in out:
        import face_cards
        me = out["eyebrows"].data
        Q = np.array([v.co[:] for v in me.vertices])
        Q = face_cards.snap_cards(face_cards.deform_brow(Q, brow_params or {}), np.asarray(P, float), snap_faces)
        me.vertices.foreach_set("co", Q.ravel())
        me.update()
    top = arm if arm else h
    top.location = offset
    return out


def ribbon_object(rb, P, name, arm, col):
    V = rb.fit(np.asarray(P, float))
    me = bpy.data.meshes.new(name)
    me.from_pydata(V.tolist(), [], [list(f) for f in rb.faces])
    for p in me.polygons:
        p.use_smooth = True
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    ob["mh_person"] = 1
    import os as _os
    m = lk.card(_os.path.join(_os.path.dirname(_os.path.abspath(__file__)), "textures", "lash_strands.png"), f"MH_Ribbon_{name}",
                colour=col, rough=0.5, alpha_gain=2.0, solid=True)
    me.uv_layers.new(name="UVMap").data.foreach_set("uv", np.array([tuple(rb.uv[i]) for f in rb.faces for i in f], float).ravel())
    me.materials.append(m)
    if arm is not None:
        vg = ob.vertex_groups.new(name="mixamorig:Head")
        vg.add(list(range(len(V))), 1.0, 'REPLACE')
        ob.parent = arm
        md = ob.modifiers.new("Armature", 'ARMATURE')
        md.object = arm
    return ob


# ------------------------------------------------------------------------------------------------ person generator
CULTURE_MEANS = {
    # mean shifts in slider units (1 = 2 SD), so groups look related without looking extreme
    "north": {"Skull depth": 0.2, "Nose bridge": 0.3, "Eye openness": 0.1, "Height / legs": 0.2},
    "south": {"Nose width": 0.3, "Upper lip": 0.25, "Lower lip": 0.3, "Cheek fullness": 0.15},
    "east": {"Eye openness": -0.25, "Nose bridge": -0.3, "Cheekbones": 0.25, "Skull width": 0.2},
    "west": {"Lower face length": 0.15, "Nose length": 0.2},
}


def generate(person_id, sex="F", age=30, species="human", culture=None, sd=0.4, body_sd=0.35, preset=None):
    """blend-shape weights for one person: every variation slider ~ N(mean, sd) clamped to -1..1 (= +-2 SD of the
    measured adult value); seeded by the person id, means shifted by sex, age, species and culture.  A preset
    (mh/presets/<name>.json, written by the editor) adds its slider values to the means."""
    import zlib, json as _json, os as _os
    import shapes_mh as sh
    rng = np.random.default_rng(zlib.crc32(f"{person_id}".encode()))
    w = {"Sex": 1.0 if sex == "F" else 0.0, f"Stylise_{sex}": 1.0}
    means = dict(CULTURE_MEANS.get(culture, {}))
    if preset:
        p = preset if isinstance(preset, dict) else _json.load(open(_os.path.join(_os.path.dirname(_os.path.abspath(__file__)),
                                                                                     "presets", preset + ".json")))
        for k, v in p.get("sliders", {}).items():
            means[k] = means.get(k, 0.0) + v
    if sex == "M":
        means.setdefault("Jaw width", 0.1)
        means.setdefault("Brow ridge", 0.1)
    for group, s_ in ((sh.VARIATION, sd), (sh.BODY_SLIDERS, body_sd)):
        for name, (pos, neg) in sorted(group.items()):
            if sex == "M" and name == "Breast":
                continue
            v = float(np.clip(rng.normal(means.get(name, 0.0), s_), -1.0, 1.0))
            if neg is None:
                w[pos] = w.get(pos, 0.0) + v
            elif v >= 0:
                w[pos] = w.get(pos, 0.0) + v
            else:
                w[neg] = w.get(neg, 0.0) - v
    # eyebrows: a style (texture + preset) then natural variation around it; density / colour factor for the material
    import face_cards as _fc
    styles = sorted(_fc.BROW_STYLES)
    style = styles[int(rng.integers(len(styles)))]
    if sex == "M" and style in ("thin", "high arch"):
        style = "thick natural"
    w["_brow_style"] = style
    for k in _fc.BROW_KEYS:
        v = _fc.BROW_STYLES[style][1].get(k, 0.0) + rng.normal(0.0, 0.3)
        w[k] = float(np.clip(v, -1, 1))
    w["_brow_density"] = float(np.clip(rng.normal(_fc.BROW_STYLES[style][2], 0.15), 0.6, 1.6))
    w["_brow_colour"] = float(np.clip(rng.normal(1.0, 0.08), 0.8, 1.15))
    if sex == "F":
        # lips: narrower ranges (about +-1 SD), upper : lower near 1 : 1.5, fuller lips only on larger faces
        fsize = 0.5 * (w.get("Face_Long", 0.0) - w.get("Face_Short", 0.0) + w.get("Var_SkullWidth", 0.0))
        k = sd / 0.4 if sd > 0 else 0.0           # sd = 0 (presets / tests): exactly the means
        lower = float(np.clip(means.get("Lower lip", 0.0) + rng.normal(0.0, 0.22 * k + 1e-12) + 0.3 * min(fsize, 0.0) * k
                              + 0.15 * max(fsize, 0.0) * k, -0.5, 0.45))
        upper = float(np.clip(means.get("Upper lip", 0.66 * lower) + rng.normal(0.0, 0.08 * k + 1e-12), -0.5, 0.35))
        w["Lips_LowerFull"], w["Lips_UpperFull"] = lower, upper
        mw = float(np.clip(means.get("Mouth width", 0.0) + rng.normal(0.0, 0.22 * k + 1e-12), -0.5, 0.5))
        w.pop("Mouth_Wide", None), w.pop("Mouth_Narrow", None)
        w["Mouth_Wide" if mw >= 0 else "Mouth_Narrow"] = abs(mw)
        # never long and gaunt, never grim
        if w.get("Face_Long", 0) > 0.3:
            w["Face_Long"] = 0.3
        w["Var_LowerFace"] = float(np.clip(w.get("Var_LowerFace", 0.0), -0.5, 0.3))
        w["Brow_Tilt"] = max(w.get("Brow_Tilt", 0.0), -0.2)
        w["Cheeks_Full"] = max(w.get("Cheeks_Full", 0.0), -0.2)
        # a relaxed, friendly default: corners slightly up, brows softened
        w["Mouth_CornersUp"] = w.get("Mouth_CornersUp", 0.0) + 0.22
        w["Brow_Up"] = w.get("Brow_Up", 0.0) + 0.06
        w["Mouth_MBP"] = w.get("Mouth_MBP", 0.0) + 0.2          # lips closed (corners-up parts them slightly)
        w.pop("Mouth_CornersDown", None)
    import hair_lib as _hl
    hs = _hl.styles_for(sex)
    if sex == "M":
        p_bald = float(np.clip((age - 35) / 60.0, 0, 0.35))
        pick = rng.random()
        if pick < p_bald:
            hs_ = ["bald", "receding short", "receding crop", "thinning crown", "shaved"]
        else:
            hs_ = [h for h in hs if h not in ("bald", "receding short", "receding crop", "thinning crown") or age > 40]
        w["_hair"] = hs_[int(rng.integers(len(hs_)))]
        beards = sorted(k for k in _hl.BEARDS if not k.endswith("grey"))
        bp = np.array([4.0 if b == "none" else 1.0 for b in beards])
        b = beards[int(rng.choice(len(beards), p=bp / bp.sum()))]
        if age > 50 and b != "none" and (b + " grey") in _hl.BEARDS and rng.random() < 0.6:
            b = b + " grey"
        w["_beard"] = b
    else:
        w["_hair"] = hs[int(rng.integers(len(hs)))]
        w["_beard"] = "none"
    tone_lum = {"north": 0.75, "west": 0.65, "south": 0.35, "east": 0.6}.get(culture, 0.55)
    hc, grey = _hl.hair_colour(rng, culture, tone_lum, age)
    w["_hair_col"] = hc
    w["_greying"] = grey
    if age >= 35:
        w["Age_Old"] = float(np.clip((age - 35) / 40.0, 0, 1))
    if species and species != "human":
        w[f"Species_{species.capitalize()}"] = 1.0
    return w


def mix(Z, weights):
    """hm08 coordinates for blend-shape weights from keys.npz (basis = masculine neutral)."""
    basis = Z["_basis"].astype(float)
    P = basis.copy()
    weights = dict(weights)
    for sd in ("L", "R"):                     # correctives (the runtime does the same products)
        r, b = max(weights.get("Eye_Round", 0.0), 0.0), weights.get(f"Eye_Blink_{sd}", 0.0)
        if r * b > 0:
            weights[f"Fix_EyeRound_Blink_{sd}"] = r * b
    for k, v in weights.items():
        if k in Z.files and not k.startswith("_") and abs(v) > 1e-6:
            P += v * (Z[k].astype(float) - basis)
    return P
