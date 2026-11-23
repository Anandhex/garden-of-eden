"""Face decals for the MakeHuman head (previews now, the texture bake later): an eye liner with an outer flick along the
visible upper lid edge, a thin outer lower line and a soft lid-crease shade, painted in a planar front projection
(attribute UV 'FaceDecalUV' on the body; mask attribute 'DecalMask' = front-facing head skin).

The lid edges come from the visible eye opening (measure_mh.eye_aperture ray casting), so the decal follows any eye shape.
"""
import bpy, os
import numpy as np
import mhcore as mc
import measure_mh as mm

SIZE = 1024
SPAN = 0.26            # metres covered by the decal square


def frame(P, B):
    c = (P[B.groups["helper-l-eye"]].mean(axis=0) + P[B.groups["helper-r-eye"]].mean(axis=0)) / 2
    return float(c[2] - 0.04)


def to_px(x, z, zc):
    return (x / SPAN + 0.5) * SIZE, (0.5 - (z - zc) / SPAN) * SIZE


def seg_dist(px, py, A, Bp):
    ax, ay = A
    bx, by = Bp
    vx, vy = bx - ax, by - ay
    L2 = vx * vx + vy * vy + 1e-9
    t = np.clip(((px - ax) * vx + (py - ay) * vy) / L2, 0, 1)
    return np.hypot(px - ax - t * vx, py - ay - t * vy), t


def stroke(img, pts, widths, col, alpha=1.0, soft=1.2):
    """draw a variable-width polyline (pixels) into img (H x W x 4, float, premultiplied-free 'over')."""
    H, W = img.shape[:2]
    pts = np.asarray(pts, float)
    x0, y0 = np.floor(pts.min(axis=0) - max(widths) - 4).astype(int)
    x1, y1 = np.ceil(pts.max(axis=0) + max(widths) + 4).astype(int)
    x0, y0 = max(x0, 0), max(y0, 0)
    x1, y1 = min(x1, W - 1), min(y1, H - 1)
    yy, xx = np.mgrid[y0:y1 + 1, x0:x1 + 1].astype(float)
    cov = np.zeros_like(xx)
    for i in range(len(pts) - 1):
        d, t = seg_dist(xx, yy, pts[i], pts[i + 1])
        w = widths[i] * (1 - t) + widths[i + 1] * t
        cov = np.maximum(cov, np.clip((w / 2 - d) / soft + 0.5, 0, 1))
    a = cov * alpha
    sub = img[y0:y1 + 1, x0:x1 + 1]
    sub[..., :3] = sub[..., :3] * (1 - a[..., None]) + np.array(col) * a[..., None]
    sub[..., 3] = sub[..., 3] + a * (1 - sub[..., 3])


def blob(img, cx, cy, rx, ry, col, alpha, ang=0.0):
    H, W = img.shape[:2]
    yy, xx = np.mgrid[0:H, 0:W].astype(float)
    ca, sa = np.cos(ang), np.sin(ang)
    u = ((xx - cx) * ca + (yy - cy) * sa) / rx
    v = (-(xx - cx) * sa + (yy - cy) * ca) / ry
    a = np.exp(-(u * u + v * v) * 2.0) * alpha
    img[..., :3] = img[..., :3] * (1 - a[..., None]) + np.array(col) * a[..., None]
    img[..., 3] = img[..., 3] + a * (1 - img[..., 3])


def paint(P, B, lm, eyes_px, style=None):
    """RGBA float image and the frame centre z."""
    st = dict(liner=1.0, liner_w=(0.25, 1.5), flick=0.30, flick_angle=24, lower=0.5, shade=0.35,
              liner_col=(0.06, 0.035, 0.03), shade_col=(0.62, 0.40, 0.42))
    st.update(style or {})
    zc = frame(P, B)
    img = np.zeros((SIZE, SIZE, 4))
    E = eyes_px.fit(P)
    pxm = SIZE / SPAN / 1000.0           # pixels per millimetre
    if st.get("brow_shadow", 0) > 0 and st.get("brow"):
        # soft painted brow under the brow cards: natural, fuller brows without thick cards
        bp = mc.Proxy(mc.proxy_file("eyebrows", st["brow"]))
        Q = bp.fit(P)
        if st.get("brow_params"):
            import face_cards
            Q = face_cards.deform_brow(Q, st["brow_params"])      # paint under the raised brow card, not the old position
        for sx in (1, -1):
            q = Q[Q[:, 0] * sx > 0]
            xs = np.linspace(np.abs(q[:, 0]).min(), np.abs(q[:, 0]).max(), 12)
            pts, ws = [], []
            for k, x in enumerate(xs):
                sel = q[np.abs(np.abs(q[:, 0]) - x) < (xs[1] - xs[0])]
                if len(sel) == 0:
                    continue
                pts.append(to_px(sx * x, float(sel[:, 2].mean()), zc))
                t = k / (len(xs) - 1)
                ws.append(pxm * st.get("brow_w", 3.2) * (1.0 - 0.55 * t ** 1.5))
            if len(pts) > 2:
                stroke(img, pts, ws, st.get("brow_col", (0.20, 0.13, 0.09)), st["brow_shadow"], soft=1.6 * pxm)
    for side in ("L", "R"):
        mm.eye_aperture(P, lm, E, eyes_px.faces, side=side, step=0.00025)
        O = mm.eye_aperture.cells
        if O is None or len(O) < 10:
            continue
        sx = 1 if side == "L" else -1
        xs = np.unique(np.round(O[:, 0] / 0.00025).astype(int))
        up, lo = [], []
        for xi in xs:
            col = O[np.round(O[:, 0] / 0.00025).astype(int) == xi]
            up.append((col[0, 0], col[:, 2].max()))
            lo.append((col[0, 0], col[:, 2].min()))
        up = np.array(sorted(up, key=lambda p: abs(p[0])))      # inner -> outer
        lo = np.array(sorted(lo, key=lambda p: abs(p[0])))
        k = max(len(up) // 14, 1)
        up_s, lo_s = up[::k], lo[::k]
        ew = abs(up[-1, 0] - up[0, 0])
        eh = (up[:, 1] - lo[:, 1]).max()
        # crease shade above the lid
        cxm = (up[0, 0] + up[-1, 0]) / 2
        czm = up[:, 1].max() + 0.30 * eh
        bx, by = to_px(cxm + sx * 0.08 * ew, czm, zc)
        blob(img, bx, by, 0.55 * ew * 1000 * pxm, 0.42 * eh * 1000 * pxm, st["shade_col"], st["shade"], ang=-sx * 0.12)
        if st.get("crease", 0) > 0:
            # lid crease: a soft darker arc above the upper lid edge, following its shape
            pts = [to_px(x, z + st.get("crease_h", 0.42) * eh * (0.55 + 0.45 * np.sin(np.pi * min(max(abs(x - up_s[0][0]) / max(ew, 1e-6), 0), 1))), zc)
                   for x, z in up_s[int(len(up_s) * 0.1):]]
            stroke(img, pts, [0.9 * pxm] * len(pts), st.get("crease_col", (0.42, 0.25, 0.25)), st["crease"], soft=0.9 * pxm)
        if st["liner"] > 0:
            n = len(up_s)
            start = int(n * 0.12)
            pts = [to_px(x, z + st.get("liner_dz", 0.0002), zc) for x, z in up_s[start:]]
            w0, w1 = st["liner_w"]
            ws = [(w0 + (w1 - w0) * (i / max(len(pts) - 1, 1)) ** 1.4) * pxm for i in range(len(pts))]
            # flick: out and up from the outer corner
            ox, oz = up_s[-1]
            a = np.radians(st["flick_angle"])
            L = st["flick"] * ew
            fx, fz = ox + sx * L * np.cos(a), oz + L * np.sin(a)
            pts += [to_px((ox + fx) / 2, (oz + fz) / 2 + 0.0002, zc), to_px(fx, fz, zc)]
            ws += [ws[-1] * 0.7, 0.15 * pxm]
            stroke(img, pts, ws, st["liner_col"], st["liner"])
        if st["lower"] > 0:
            n = len(lo_s)
            pts = [to_px(x, z - 0.0001, zc) for x, z in lo_s[int(n * 0.45):]]
            ws = [(0.15 + 0.35 * i / max(len(pts) - 1, 1)) * pxm for i in range(len(pts))]
            stroke(img, pts, ws, st["liner_col"], st["lower"])
    return img, zc


def apply_image(P, B, lm, eyes_px, style=None, name="Decal"):
    """(bpy image, frame centre z)"""
    img, zc = paint(P, B, lm, eyes_px, style)
    im = bpy.data.images.get(name)
    if im:
        bpy.data.images.remove(im)
    im = bpy.data.images.new(name, SIZE, SIZE, alpha=True, float_buffer=False)
    im.pixels.foreach_set(np.flipud(img).astype(np.float32).ravel())
    im.pack()
    return im, zc


def set_uv(ob, P, B, lm, zc):
    """FaceDecalUV + DecalMask on the MPFB body object (rest coordinates P)."""
    me = ob.data
    uv = me.uv_layers.get("FaceDecalUV") or me.uv_layers.new(name="FaceDecalUV")
    vi = np.empty(len(me.loops), np.int64)
    me.loops.foreach_get("vertex_index", vi)
    u = P[vi, 0] / SPAN + 0.5
    v = (P[vi, 2] - zc) / SPAN + 0.5
    uv.data.foreach_set("uv", np.stack([u, v], axis=1).ravel())
    me.uv_layers.active = me.uv_layers[0]
    # mask: head part, in front of the ears, facing forward
    N = np.array([v.normal[:] for v in me.vertices])
    near_eye = np.zeros(len(P), bool)
    for g in ("helper-l-eye", "helper-r-eye"):
        c = P[B.groups[g]].mean(axis=0)
        near_eye |= np.linalg.norm(P - c, axis=1) < 0.03
    m = (lm.vpart == "head") & ((N[:, 1] < -0.05) | (near_eye & (N[:, 1] < 0.35))) & \
        (P[:, 1] < P[B.groups["helper-l-eye"], 1].mean() + 0.02)
    a = me.color_attributes.get("DecalMask") or me.color_attributes.new("DecalMask", 'FLOAT_COLOR', 'POINT')
    c = np.zeros((len(me.vertices), 4))
    c[:, 0] = m
    c[:, 3] = 1
    a.data.foreach_set("color", c.ravel())
