"""Build every garment on the base body, write clothes.blend, export/clothes_manifest.json and the FBX files.

    B=/Applications/Blender.app/Contents/MacOS/Blender
    $B -b -P art3d/characters/clothes/build_clothes.py                  # everything (a few minutes)
    $B -b -P art3d/characters/clothes/build_clothes.py -- only=t_shirt,l_trousers   # subset, no export
"""
import bpy, sys, os, json, math, time
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
CH = os.path.dirname(HERE)
sys.path.insert(0, HERE)
sys.path.insert(0, CH)
import clothes_lib as L  # noqa: E402
import pieces as PC  # noqa: E402
import outfits as OF  # noqa: E402

EXPORT = os.path.join(HERE, "export")
TEX = os.path.join(EXPORT, "textures")
MAT_NAMES = {"Tint": "GC_Tint", "Quilt": "GC_Quilt", "Trim": "GC_Trim", "Leather": "GC_Leather", "Metal": "GC_Metal", "Linen": "GC_Linen", "Stripe": "GC_Stripe", "Plaid": "GC_Plaid"}
MAT_TEX = {"Tint": "detail_weave.png", "Quilt": "detail_quilt.png", "Trim": "trim_stitch.png", "Leather": "detail_leather.png",
           "Metal": "detail_metal.png", "Linen": "detail_weave.png", "Stripe": "detail_stripes.png", "Plaid": "detail_plaid.png"}
MAT_TILE = {"Tint": 0.07, "Quilt": 0.30, "Trim": 0.06, "Leather": 0.14, "Metal": 0.30, "Linen": 0.07, "Stripe": 0.30, "Plaid": 0.32}
MAT_BASE = {"Tint": (0.55, 0.50, 0.42), "Quilt": (0.55, 0.50, 0.42), "Trim": (0.80, 0.62, 0.28), "Leather": (0.36, 0.23, 0.14),
            "Metal": (0.50, 0.54, 0.60), "Linen": (0.86, 0.80, 0.68), "Stripe": (0.55, 0.50, 0.42), "Plaid": (0.55, 0.50, 0.42)}
MAT_ROUGH = {"Tint": 0.95, "Quilt": 0.95, "Trim": 0.9, "Leather": 0.75, "Metal": 0.45, "Linen": 0.95, "Stripe": 0.95, "Plaid": 0.95}
SLOT_ROLE = {"Tint": "tint", "Quilt": "tint", "Trim": "trim", "Leather": "leather", "Metal": "metal", "Linen": "linen", "Stripe": "tint", "Plaid": "tint"}
FBX_GROUPS = {"torso": ["torso"], "arms": ["arms"], "hands": ["hands"], "legs": ["legs", "skirt"], "feet": ["feet"],
              "overlays": ["overlay"], "headwear": ["headwear"]}


def make_materials():
    mats = {}
    for k, name in MAT_NAMES.items():
        m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
        m.use_nodes = True
        nt = m.node_tree
        nt.nodes.clear()
        out = nt.nodes.new("ShaderNodeOutputMaterial")
        bs = nt.nodes.new("ShaderNodeBsdfPrincipled")
        bs.inputs["Roughness"].default_value = MAT_ROUGH[k]
        bs.inputs["Specular IOR Level"].default_value = 0.1 if k != "Metal" else 0.4
        bs.inputs["Metallic"].default_value = 0.0
        tx = nt.nodes.new("ShaderNodeTexImage")
        p = os.path.join(TEX, MAT_TEX[k])
        tx.image = bpy.data.images.load(p, check_existing=True)
        mix = nt.nodes.new("ShaderNodeMix")
        mix.data_type = 'RGBA'
        mix.blend_type = 'MULTIPLY'
        mix.inputs[0].default_value = 1.0
        mix.inputs[7].default_value = (*MAT_BASE[k], 1)
        nt.links.new(tx.outputs["Color"], mix.inputs[6])
        nt.links.new(mix.outputs[2], bs.inputs["Base Color"])
        nt.links.new(bs.outputs[0], out.inputs["Surface"])
        m["tintable"] = SLOT_ROLE[k] in ("tint", "trim")
        m["role"] = SLOT_ROLE[k]
        mats[k] = m
    return mats


def centre_for(P):
    """Cylinder axis per vertex for the UV unwrap."""
    x, y, z = P[:, 0], P[:, 1], P[:, 2]
    cx = np.zeros(len(P))
    cy = np.full(len(P), -0.009)
    arm = (np.abs(x) > 0.17) & (z < 1.37) & (z > 0.7) & (np.abs(x) > 0.1 + 0.0 * z)
    t = np.clip((1.39 - z) / (1.39 - 0.98), 0, 1)
    ax = np.sign(x) * (0.178 + t * (0.406 - 0.178))
    cx = np.where(arm, ax, cx)
    cy = np.where(arm, 0.02 - 0.03 * t, cy)
    leg = (z < 0.9) & ~arm
    cx = np.where(leg, np.sign(x) * 0.085, cx)
    head = z > 1.5
    cy = np.where(head, -0.03, cy)
    return cx, cy


def build_object(g, mats, arm_obj, body):
    P = np.array(g.P)
    nv = len(P)
    tv, bw, dd = g.resolve()
    deltas, wt, P0 = g.deltas_fast(tv, bw, dd)
    me = bpy.data.meshes.new(g.id)
    me.from_pydata([tuple(p) for p in P], [], [tuple(f) for f in g.faces])
    me.update()
    ob = bpy.data.objects.new(g.id, me)
    bpy.context.scene.collection.objects.link(ob)
    # materials (slots in fixed order)
    used = [k for k in MAT_NAMES if k in set(g.fmat)]
    for k in used:
        me.materials.append(mats[k])
    for pi, p in enumerate(me.polygons):
        p.material_index = used.index(g.fmat[pi])
        p.use_smooth = not g.fflat[pi]
    # uvs
    cx, cy = centre_for(P)
    uvl = me.uv_layers.new(name="UVMap")
    ang = np.arctan2(P[:, 0] - cx, -(P[:, 1] - cy))
    for pi, p in enumerate(me.polygons):
        mname = g.fmat[pi]
        tile = MAT_TILE[mname]
        idx = list(p.vertices)
        us = ang[idx].copy()
        for k in range(1, len(us)):
            while us[k] - us[0] > math.pi:
                us[k] -= 2 * math.pi
            while us[k] - us[0] < -math.pi:
                us[k] += 2 * math.pi
        for k, li in enumerate(p.loop_indices):
            vi = idx[k]
            if mname == "Trim" and pi in g.trimuv:
                v = g.trimuv[pi][k]
                uvl.data[li].uv = (us[k] * 0.11 / tile * 1.0, v)
            else:
                uvl.data[li].uv = (us[k] * 0.12 / tile, P[vi, 2] / tile)
    # vertex colour: soft occlusion + painterly variation
    ca = me.color_attributes.new("Col", 'FLOAT_COLOR', 'POINT')
    n0 = np.array([v.normal[:] for v in me.vertices])
    col = 0.93 + 0.07 * (np.sin(P[:, 0] * 41 + P[:, 2] * 23) * np.cos(P[:, 1] * 37 + P[:, 2] * 17))
    col *= 1.0 - 0.14 * np.clip(-n0[:, 2], 0, 1)
    cnt = {}
    for f in g.faces:
        for a, b in zip(f, f[1:] + f[:1]):
            e = (min(a, b), max(a, b))
            cnt[e] = cnt.get(e, 0) + 1
    edge_v = {v for e, c in cnt.items() if c == 1 for v in e}
    for v in edge_v:
        col[v] *= 0.9
    cv = np.stack([col, col, col, np.ones(nv)], 1).astype(np.float32)
    ca.data.foreach_set("color", cv.ravel())
    # weights
    gi = np.argsort(-wt, axis=1)[:, :4]
    wtop = np.take_along_axis(wt, gi, axis=1)
    wtop = wtop / np.maximum(wtop.sum(1, keepdims=True), 1e-9)
    vg = {}
    for v in range(nv):
        for j in range(4):
            w = wtop[v, j]
            if w < 0.01:
                continue
            name = body.groups[gi[v, j]]
            if name not in vg:
                vg[name] = ob.vertex_groups.new(name=name)
            vg[name].add([v], float(w), 'REPLACE')
    # shape keys
    ob.shape_key_add(name="Basis", from_mix=False)
    for k in body.keynames:
        if k not in deltas:
            continue
        kb = ob.shape_key_add(name=k, from_mix=False)
        kb.data.foreach_set("co", (P0 + deltas[k]).ravel())
        kb.slider_min, kb.slider_max = 0.0, 1.0
    ob.parent = arm_obj
    md = ob.modifiers.new("Armature", 'ARMATURE')
    md.object = arm_obj
    return ob, len(deltas)


def deltas_fast(self, tv, bw, dd):
    B = self.B
    nv = len(self.P)
    n0 = (B.N0[tv] * bw[..., None]).sum(1)
    n0 /= np.maximum(np.linalg.norm(n0, axis=1, keepdims=True), 1e-9)
    base = (B.co0[tv] * bw[..., None]).sum(1) + dd[:, None] * n0
    kind = np.array([b[0] for b in self.bind])
    fol = np.where(kind == "f")[0]
    par = np.array([self.bind[i][1] for i in fol], int)
    fac = np.array([self.bind[i][2] for i in fol])
    depth = np.zeros(nv, int)
    for i in fol:
        depth[i] = depth[self.bind[i][1]] + 1
    maxd = depth.max()
    wt = (B.wt[tv] * bw[..., None]).sum(1)
    for lv in range(1, maxd + 1):
        sel = np.where(depth == lv)[0]
        wt[sel] = wt[[self.bind[i][1] for i in sel]]
    out = {}
    for k in B.keynames:
        Pk = (B.keys[k][tv] * bw[..., None]).sum(1)
        nk = (B.Nk[k][tv] * bw[..., None]).sum(1)
        nk /= np.maximum(np.linalg.norm(nk, axis=1, keepdims=True), 1e-9)
        d = Pk + dd[:, None] * nk - base
        d[kind == "f"] = 0
        for lv in range(1, maxd + 1):
            sel = np.where(depth == lv)[0]
            d[sel] = np.array([self.bind[i][2] for i in sel])[:, None] * d[[self.bind[i][1] for i in sel]]
        if np.abs(d).max() > 1e-6:
            out[k] = d
    return out, wt, np.array(self.P)


L.Garment.deltas_fast = deltas_fast


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    only = None
    for a in argv:
        if a.startswith("only="):
            only = a[5:].split(",")
    t0 = time.time()
    bpy.ops.wm.open_mainfile(filepath=os.path.join(CH, "base.blend"))
    body = L.Body()
    PC.B = body
    OF.B = body
    arm_obj = bpy.data.objects["Armature"]
    mats = make_materials()
    coll = bpy.data.collections.new("Clothes")
    bpy.context.scene.collection.children.link(coll)
    meta = {}
    objs = {}
    for pid in PC.ORDER:
        if only and pid not in only:
            continue
        spec = PC.REG[pid]
        g = spec["fn"]()
        g.finalize_materials()
        ob, nkeys = build_object(g, mats, arm_obj, body)
        for c in list(ob.users_collection):
            c.objects.unlink(ob)
        coll.objects.link(ob)
        ob.hide_render = True
        ob.hide_viewport = True
        slots = [k for k in MAT_NAMES if k in set(g.fmat)]
        tris = sum(len(p.vertices) - 2 for p in ob.data.polygons)
        meta[pid] = dict(id=pid, name=spec["name"], slot=spec["slot"], layer=spec["layer"], object=ob.name,
                         hides=g.hides(), cultures=spec["cultures"], classes=spec["classes"], ages=spec["ages"],
                         sexes=["masculine", "feminine"], species=["human", "elf", "dwarf", "halfling", "orc"],
                         colourSlots=sorted({SLOT_ROLE[k] for k in slots}), materials=[MAT_NAMES[k] for k in slots],
                         verts=len(ob.data.vertices), tris=tris, shapeKeys=nkeys, notes=spec["notes"])
        objs[pid] = ob
        print(f"{pid:18s} verts {len(ob.data.vertices):5d} tris {tris:5d} keys {nkeys:2d} hides {meta[pid]['hides']} slots {slots}  [{time.time()-t0:.0f}s]")
    if only:
        bpy.ops.wm.save_as_mainfile(filepath=os.path.join(HERE, "clothes_test.blend"))
        return
    # outfits and manifest
    outfits = OF.OUTFITS
    for o in outfits:
        hid = set()
        for p in o["pieces"]:
            hid |= set(meta[p]["hides"])
        o["hidesRegions"] = sorted(hid)
        o["slots"] = {meta[p]["slot"] + ("_over" if meta[p]["layer"] == "over" and meta[p]["slot"] in ("torso", "arms", "legs") else ""): p for p in o["pieces"]}
    for o in outfits:
        for p in o["pieces"]:
            assert p in meta, (o["id"], p)
    for pid, m in meta.items():
        m["file"] = None
        m["outfits"] = [o["id"] for o in outfits if pid in o["pieces"]]
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(HERE, "clothes.blend"))
    # FBX groups
    arm_name = arm_obj.name
    for fname, slots in FBX_GROUPS.items():
        sel = [objs[p] for p in PC.ORDER if PC.REG[p]["slot"] in slots]
        for o in objs.values():
            o.hide_viewport = False
            o.hide_render = False
        bpy.ops.object.select_all(action='DESELECT')
        arm_obj.select_set(True)
        for o in sel:
            o.select_set(True)
        bpy.context.view_layer.objects.active = arm_obj
        path = os.path.join(EXPORT, f"clothes_{fname}.fbx")
        bpy.ops.export_scene.fbx(
            filepath=path, use_selection=True, object_types={'ARMATURE', 'MESH'},
            apply_unit_scale=True, apply_scale_options='FBX_SCALE_ALL', global_scale=1.0,
            axis_forward='-Z', axis_up='Y', bake_space_transform=False,
            use_mesh_modifiers=True, mesh_smooth_type='FACE', use_mesh_edges=False, use_tspace=False,
            add_leaf_bones=False, primary_bone_axis='Y', secondary_bone_axis='X', armature_nodetype='NULL',
            use_armature_deform_only=False, bake_anim=False, path_mode='STRIP', embed_textures=False, use_custom_props=False)
        for p in PC.ORDER:
            if PC.REG[p]["slot"] in slots:
                meta[p]["file"] = f"clothes_{fname}.fbx"
        print("exported", path, os.path.getsize(path) // 1024, "KB", len(sel), "pieces")
        for o in objs.values():
            o.hide_viewport = True
            o.hide_render = True
    manifest = dict(
        version=1, rig="Armature (55 Humanoid bones, same as export/base_body.fbx)", body="../../export/base_body.fbx",
        fbxSettings="forward -Z, up Y, FBX_SCALE_ALL, no leaf bones, shape keys as BlendShapes; Unity: Humanoid rig, Normals = Calculate or Import, Read/Write on",
        regions={"torso": "Mesh_Torso", "arms": "Mesh_Arms", "hands": "Mesh_Hands", "legs": "Mesh_Legs", "feet": "Mesh_Feet"},
        slots=dict(torso="replaces/overlays Mesh_Torso", arms="Mesh_Arms", hands="Mesh_Hands", legs="Mesh_Legs", feet="Mesh_Feet",
                   skirt="hangs from the waist (long ones hide legs)", overlay="belts, straps, aprons, cloaks, hood, scarf, pouches",
                   headwear="hats/helmets, attach at Socket_Hat (already placed in head space; skinned to Head)"),
        materials={MAT_NAMES[k]: dict(role=SLOT_ROLE[k], baseColour=list(MAT_BASE[k]), texture="textures/" + MAT_TEX[k], tileMetres=MAT_TILE[k],
                                      tintedBy={"tint": "look.tint", "trim": "look.trim"}.get(SLOT_ROLE[k], "fixed"))
                   for k in MAT_NAMES},
        colourRule="Multiply the material's base colour by look.tint (GC_Tint, GC_Quilt, GC_Linen stays cream) or look.trim (GC_Trim); GC_Leather and GC_Metal are fixed.",
        pieces=[meta[p] for p in PC.ORDER if p in meta],
        outfits=[{("class" if k == "class_" else k): v for k, v in o.items()} for o in outfits])
    with open(os.path.join(EXPORT, "clothes_manifest.json"), "w") as f:
        json.dump(manifest, f, indent=1)
    print("manifest written; total", round(time.time() - t0), "s")


main()
