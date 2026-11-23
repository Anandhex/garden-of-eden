"""Procedural face texture set on the contract's FaceDecalUV (UV1) for the feminine and masculine neutral (Stylise on):

    $B -b art3d/characters/mh/base_mh.blend -P art3d/characters/mh/bake_face.py

* export/textures/face_paint_<f|m>.png  RGBA: liner with wing, lid crease, soft painted brows (alpha = coverage; lay it OVER the skin)
* export/textures/face_tint_<f|m>.png   RGB: multiply map for lip tint (darker at the lip line and corners) and blush
Painted in a front projection on the posed neutral (decals.py / paint.py, the same as the previews), then baked through the
mesh (Cycles, emission) onto FaceDecalUV of Mesh_Head and Part_Nose, so it follows the head's own vertices.
Eyes, inner mouth and the lash ribbon are not in it (our eye textures and the ribbon stay separate).
"""
import bpy, os, sys
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.dirname(HERE))
import mhcore as mc, landmarks as lmk, stylise_mh as st, person, decals, paint  # noqa: E402

OUT = os.path.join(HERE, "export", "textures")
RES = 2048


def raster_tint(P, lm, T, zc, size=decals.SIZE):
    """vertex colours T (n x 3) rasterised in the decal front projection (front-facing head triangles)."""
    img = np.ones((size, size, 3))
    zbuf = np.full((size, size), 1e9)
    for f, q in zip(lm.faces, lm.fpart):
        if q != "head":
            continue
        for i in range(1, len(f) - 1):
            tri = [f[0], f[i], f[i + 1]]
            pts = [decals.to_px(P[v, 0], P[v, 2], zc) for v in tri]
            (x0, y0), (x1, y1), (x2, y2) = pts
            den = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2)
            if abs(den) < 1e-9 or den > 0:          # back-facing in the front projection
                continue
            xa, xb = int(max(min(x0, x1, x2), 0)), int(min(max(x0, x1, x2) + 1, size - 1))
            ya, yb = int(max(min(y0, y1, y2), 0)), int(min(max(y0, y1, y2) + 1, size - 1))
            if xb < xa or yb < ya:
                continue
            yy, xx = np.mgrid[ya:yb + 1, xa:xb + 1] + 0.5
            l0 = ((y1 - y2) * (xx - x2) + (x2 - x1) * (yy - y2)) / den
            l1 = ((y2 - y0) * (xx - x2) + (x0 - x2) * (yy - y2)) / den
            l2 = 1 - l0 - l1
            m = (l0 >= 0) & (l1 >= 0) & (l2 >= 0)
            if not m.any():
                continue
            depth = l0 * P[tri[0], 1] + l1 * P[tri[1], 1] + l2 * P[tri[2], 1]
            sub = zbuf[ya:yb + 1, xa:xb + 1]
            m &= depth < sub
            col = l0[..., None] * T[tri[0]] + l1[..., None] * T[tri[1]] + l2[..., None] * T[tri[2]]
            img[ya:yb + 1, xa:xb + 1][m] = col[m]
            sub[m] = depth[m]
    return img


def image(name, arr):
    im = bpy.data.images.get(name)
    if im:
        bpy.data.images.remove(im)
    h, w = arr.shape[:2]
    im = bpy.data.images.new(name, w, h, alpha=True, float_buffer=True)
    a = np.ones((h, w, 4))
    a[..., :arr.shape[2]] = arr
    im.pixels.foreach_set(np.flipud(a).astype(np.float32).ravel())
    return im


def bake(objs, src_img, zc, channel, out_path):
    """emission bake of the projected image (rgb or alpha) onto FaceDecalUV."""
    tgt = bpy.data.images.new("bake_tgt", RES, RES, alpha=True, float_buffer=False)
    tgt.generated_color = (1, 1, 1, 0) if channel == "rgb" else (0, 0, 0, 1)
    for o in objs:
        me = o.data
        m = bpy.data.materials.new("bake_" + o.name)
        m.use_nodes = True
        nt = m.node_tree
        for n in list(nt.nodes):
            nt.nodes.remove(n)
        out = nt.nodes.new("ShaderNodeOutputMaterial")
        em = nt.nodes.new("ShaderNodeEmission")
        tc = nt.nodes.new("ShaderNodeTexCoord")
        sep = nt.nodes.new("ShaderNodeSeparateXYZ")
        nt.links.new(tc.outputs["Object"], sep.inputs[0])
        mu = nt.nodes.new("ShaderNodeMath")
        mu.operation = 'MULTIPLY_ADD'
        mu.inputs[1].default_value = 1.0 / decals.SPAN
        mu.inputs[2].default_value = 0.5
        nt.links.new(sep.outputs[0], mu.inputs[0])
        mv = nt.nodes.new("ShaderNodeMath")
        mv.operation = 'MULTIPLY_ADD'
        mv.inputs[1].default_value = 1.0 / decals.SPAN
        mv.inputs[2].default_value = 0.5 - zc / decals.SPAN
        nt.links.new(sep.outputs[2], mv.inputs[0])
        cmb = nt.nodes.new("ShaderNodeCombineXYZ")
        nt.links.new(mu.outputs[0], cmb.inputs[0])
        nt.links.new(mv.outputs[0], cmb.inputs[1])
        tx = nt.nodes.new("ShaderNodeTexImage")
        tx.image = src_img
        tx.extension = 'CLIP'
        nt.links.new(cmb.outputs[0], tx.inputs[0])
        nt.links.new(tx.outputs["Color" if channel == "rgb" else "Alpha"], em.inputs["Color"])
        nt.links.new(em.outputs[0], out.inputs["Surface"])
        node = nt.nodes.new("ShaderNodeTexImage")
        node.image = tgt
        nt.nodes.active = node
        me.materials.clear()
        me.materials.append(m)
        me.uv_layers.active = me.uv_layers["FaceDecalUV"]
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = 4
    sc.render.bake.margin = 8
    bpy.ops.object.bake(type='EMIT')
    tgt.filepath_raw = out_path
    tgt.file_format = 'PNG'
    tgt.save()
    bpy.data.images.remove(tgt)


def main():
    os.makedirs(OUT, exist_ok=True)
    R = st.load_recipe()
    keep = {o.name for o in bpy.data.objects}
    B = mc.Base()
    P0 = B.macro({})
    lm = lmk.Landmarks(B, P0 - [0, 0, P0[B.body_mask, 2].min()])
    B.h.hide_render = True
    Z = np.load(os.path.join(mc.CACHE, "keys.npz"))
    eyes_px = mc.Proxy(mc.proxy_file("eyes", R["proxies"]["eyes"]))
    heads = []
    for n in ("Mesh_Head", "Part_Nose"):
        # bake through front-facing faces only: FaceDecalUV is a planar front projection, so the inner lid and nostril
        # surfaces overlap the visible skin in UV space and would overwrite it
        o0 = bpy.data.objects[n]
        o = o0.copy()
        o.data = o0.data.copy()
        o.name = "bake_" + n
        bpy.context.scene.collection.objects.link(o)
        o0.hide_render = True
        heads.append(o)
    for sex in ("F", "M"):
        w = {"Sex": 1.0 if sex == "F" else 0.0, f"Stylise_{sex}": 1.0}
        P = person.mix(Z, w)
        look = R["look"][sex]
        dec, zc = decals.paint(P, B, lm, eyes_px, look.get("decal"))
        T = paint.tint(P, lm, B, **look.get("paint", {}))
        timg = raster_tint(P, lm, T, zc)
        mimg = raster_tint(P, lm, paint.face_mask(P, lm, B), zc)
        mimg[(timg == 1).all(axis=2)] = 0.0                 # outside the head: no gloss / blush
        for o in bpy.data.objects:
            if o.type == 'MESH' and o.data.shape_keys:
                for kb in o.data.shape_keys.key_blocks[1:]:
                    kb.value = w.get(kb.name, 0.0)
        for o in heads:
            # faces looking away from the front (inner lids, nostrils, back of the head) get their FaceDecalUV moved out
            # of the image for this bake, so they cannot overwrite the visible skin that shares their UVs
            o0 = bpy.data.objects[o.name[5:]]
            uv0 = o0.data.uv_layers["FaceDecalUV"]
            uv = o.data.uv_layers["FaceDecalUV"]
            dg = bpy.context.evaluated_depsgraph_get()
            ev = o.evaluated_get(dg).to_mesh()
            normals = [p.normal.y for p in ev.polygons]
            o.evaluated_get(dg).to_mesh_clear()
            for p_, ny in zip(o.data.polygons, normals):
                for li in p_.loop_indices:
                    u, v = uv0.data[li].uv
                    uv.data[li].uv = (u + (5.0 if ny > 0.05 else 0.0), v)
        di = image(f"paint_{sex}", dec)
        ti = image(f"tint_{sex}", timg)
        tag = sex.lower()
        bake(heads, ti, zc, "rgb", os.path.join(OUT, f"face_tint_{tag}.png"))
        bake(heads, image(f"mask_{sex}", mimg), zc, "rgb", os.path.join(OUT, f"face_mask_{tag}.png"))
        bake(heads, di, zc, "rgb", os.path.join(OUT, f"_paint_rgb_{tag}.png"))
        bake(heads, di, zc, "alpha", os.path.join(OUT, f"_paint_a_{tag}.png"))
        # combine rgb + alpha with Pillow-free numpy via bpy images
        rgb = bpy.data.images.load(os.path.join(OUT, f"_paint_rgb_{tag}.png"))
        al = bpy.data.images.load(os.path.join(OUT, f"_paint_a_{tag}.png"))
        a = np.array(rgb.pixels[:]).reshape(RES, RES, 4)
        b = np.array(al.pixels[:]).reshape(RES, RES, 4)
        a[..., 3] = b[..., 0]
        outim = bpy.data.images.new(f"face_paint_{tag}", RES, RES, alpha=True)
        outim.pixels.foreach_set(a.astype(np.float32).ravel())
        outim.filepath_raw = os.path.join(OUT, f"face_paint_{tag}.png")
        outim.file_format = 'PNG'
        outim.save()
        for f in (f"_paint_rgb_{tag}.png", f"_paint_a_{tag}.png"):
            os.remove(os.path.join(OUT, f))
        print("BAKED", sex, flush=True)
    B.save_cache()


if __name__ == "__main__":
    main()
