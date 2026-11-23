"""Helpers shared by the part builders (run inside Blender with base.blend open)."""
import bpy, bmesh, os, sys, json, math
import numpy as np
from mathutils import Vector, Matrix
from mathutils.kdtree import KDTree

HERE = os.path.dirname(os.path.abspath(__file__))
CHAR = os.path.dirname(HERE)
sys.path.insert(0, CHAR)
import common  # noqa: E402

EXPORT = os.path.join(HERE, "export")
PREVIEWS = os.path.join(HERE, "previews")
TEX = os.path.join(EXPORT, "textures")
PARTS_BLEND = os.path.join(HERE, "parts.blend")
META = json.load(open(os.path.join(common.EXPORT_DIR, "base_body_meta.json")))
LM = META["landmarks"]

# ---- legacy frame (2026-11): the hair/beard/decal builders were tuned on the previous (decimated, 7.1-head) masculine head.
# They keep generating in that frame; gen.py maps head queries into it and add_part() maps results back onto the new head.
OLD_HEAD = {"chin": 1.505, "top": 1.75, "half_w": 0.1053, "yc": -0.0759}
_kz = (LM["top"] - LM["chin"]) / (OLD_HEAD["top"] - OLD_HEAD["chin"])
_kx = LM["head_half_w"] / OLD_HEAD["half_w"]
_yc_new = LM["head_c"][1]


def to_new(P):
    P = np.array(P, float)
    Q = P.copy()
    Q[..., 0] = P[..., 0] * _kx
    Q[..., 1] = _yc_new + (P[..., 1] - OLD_HEAD["yc"]) * _kx
    Q[..., 2] = LM["top"] - (OLD_HEAD["top"] - P[..., 2]) * _kz
    return Q


def to_old(P):
    P = np.array(P, float)
    Q = P.copy()
    Q[..., 0] = P[..., 0] / _kx
    Q[..., 1] = OLD_HEAD["yc"] + (P[..., 1] - _yc_new) / _kx
    Q[..., 2] = OLD_HEAD["top"] - (LM["top"] - P[..., 2]) / _kz
    return Q


def S(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def coords(me):
    n = len(me.vertices)
    a = np.empty(n * 3)
    me.vertices.foreach_get('co', a)
    return a.reshape(-1, 3)


def key_coords(ob, name):
    n = len(ob.data.vertices)
    a = np.empty(n * 3)
    ob.data.shape_keys.key_blocks[name].data.foreach_get('co', a)
    return a.reshape(-1, 3)


class Body:
    """Neutral body data used for the nearest-vertex transfer of shape keys and weights."""
    def __init__(self):
        self.src = bpy.data.objects["Body_Welded_Source"]
        self.arm = bpy.data.objects["Armature"]
        self.head = bpy.data.objects["Mesh_Head"]
        me = self.src.data
        self.P = coords(me)
        self.keys = [k.name for k in me.shape_keys.key_blocks[1:]]
        self.D = {k: key_coords(self.src, k) - self.P for k in self.keys}
        self.kd = KDTree(len(self.P))
        for i, p in enumerate(self.P):
            self.kd.insert(Vector(p), i)
        self.kd.balance()
        self.groups = [g.name for g in self.src.vertex_groups]
        gi = {g.index: g.name for g in self.src.vertex_groups}
        self.W = [dict() for _ in range(len(self.P))]
        for v in me.vertices:
            for g in v.groups:
                if g.weight > 1e-4 and gi[g.group] != "Face_Decal":
                    self.W[v.index][gi[g.group]] = g.weight
        # head mesh (for shells)
        self.HP = coords(self.head.data)
        self.HD = {k.name: key_coords(self.head, k.name) - self.HP for k in self.head.data.shape_keys.key_blocks[1:]}

    def nearest(self, pts, k=4):
        idx = np.zeros((len(pts), k), int)
        wt = np.zeros((len(pts), k))
        for i, p in enumerate(pts):
            res = self.kd.find_n(Vector(p), k)
            d = np.array([r[2] for r in res])
            idx[i] = [r[1] for r in res]
            w = 1.0 / (d + 0.004) ** 2
            wt[i] = w / w.sum()
        return idx, wt

    def deltas(self, pts, anchors=None, thresh=3e-4):
        """transferred shape-key deltas {name: (n,3)} for points (anchors = surface points they grow from)."""
        idx, wt = self.nearest(pts if anchors is None else anchors)
        out = {}
        for k, D in self.D.items():
            d = (D[idx] * wt[..., None]).sum(axis=1)
            if np.abs(d).max() > thresh:
                out[k] = d
        return out

    def weights(self, pts, bones, anchors=None):
        """dict bone -> array of weights restricted to `bones`, normalised; fallback Head."""
        idx, wt = self.nearest(pts if anchors is None else anchors)
        W = {b: np.zeros(len(pts)) for b in bones}
        for i in range(len(pts)):
            for j in range(idx.shape[1]):
                for b, w in self.W[idx[i, j]].items():
                    if b in W:
                        W[b][i] += w * wt[i, j]
        tot = sum(W.values())
        for i in np.where(tot < 1e-4)[0]:
            W["Head" if "Head" in W else bones[0]][i] = 1.0
        tot = sum(W.values())
        for b in bones:
            W[b] = W[b] / tot
        return W


_BODY = None


def body():
    global _BODY
    if _BODY is None:
        _BODY = Body()
    return _BODY


def get_material(name, col=(0.8, 0.8, 0.8)):
    m = bpy.data.materials.get(name)
    if m is None:
        m = bpy.data.materials.new(name)
        m.diffuse_color = (*col, 1)
        m.use_nodes = True
    return m


def add_part(name, V, F, bones, mat, anchors=None, uv=None, smooth=True, vcol=None, thresh=3e-4, hide=True, normals=None,
             keys=None, collection=None, weights=None, frame="legacy"):
    """Create a skinned part object. V (n,3) neutral positions, F list of faces. Weights/keys by transfer from the body.
    frame='legacy': V/anchors are in the old head frame (see to_new); 'new': already on the current head."""
    b = body()
    if frame == "legacy":
        V = to_new(V)
        anchors = None if anchors is None else to_new(anchors)
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(map(float, v)) for v in V], [], [tuple(int(i) for i in f) for f in F])
    me.update()
    for p in me.polygons:
        p.use_smooth = smooth
    if uv is not None:
        l = me.uv_layers.new(name="UVMap")
        for p in me.polygons:
            for li, vi in zip(p.loop_indices, p.vertices):
                l.data[li].uv = tuple(uv[vi]) if np.ndim(uv[0]) else tuple(uv[li])
    if vcol is not None:
        ca = me.color_attributes.new("Shade", 'BYTE_COLOR', 'POINT')
        for i, c in enumerate(vcol):
            ca.data[i].color = (c[0], c[1], c[2], 1.0) if len(c) == 3 else tuple(c)
    ob = bpy.data.objects.new(name, me)
    (collection or bpy.context.collection).objects.link(ob)
    me.materials.append(mat)
    # weights
    W = weights if weights is not None else b.weights(V, bones, anchors)
    for bn in bones:
        vg = ob.vertex_groups.new(name=bn)
        idx = np.where(W[bn] > 0.003)[0]
        for i in idx:
            vg.add([int(i)], float(W[bn][i]), 'REPLACE')
    # shape keys
    dl = b.deltas(V, anchors, thresh)
    if keys is not None:
        dl = {k: v for k, v in dl.items() if k in keys}
    if dl:
        ob.shape_key_add(name="Basis", from_mix=False)
        for k in b.keys:
            if k in dl:
                sk = ob.shape_key_add(name=k, from_mix=False)
                sk.slider_min, sk.slider_max = 0.0, 1.0
                sk.data.foreach_set('co', (V + dl[k]).astype(np.float32).ravel())
    ob.parent = b.arm
    m = ob.modifiers.new("Armature", 'ARMATURE')
    m.object = b.arm
    if normals is not None:
        me.normals_split_custom_set_from_vertices([tuple(v) for v in normals])
    ob["gd_category"] = ""
    return ob


def save_png(arr, path):
    h, w = arr.shape[:2]
    img = bpy.data.images.new("tmp_png", w, h, alpha=True)
    img.colorspace_settings.name = "Non-Color"
    img.pixels.foreach_set(np.clip(arr, 0, 1).astype(np.float32).ravel())
    img.filepath_raw = path
    img.file_format = 'PNG'
    img.save()
    bpy.data.images.remove(img)


def export_fbx(path, objs):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
        o.hide_set(False)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.export_scene.fbx(
        filepath=path, use_selection=True, object_types={'ARMATURE', 'MESH', 'EMPTY'},
        apply_unit_scale=True, apply_scale_options='FBX_SCALE_ALL', global_scale=1.0,
        axis_forward='-Z', axis_up='Y', bake_space_transform=False,
        use_mesh_modifiers=True, mesh_smooth_type='FACE', use_mesh_edges=False, use_tspace=False,
        add_leaf_bones=False, primary_bone_axis='Y', secondary_bone_axis='X', armature_nodetype='NULL',
        use_armature_deform_only=False, bake_anim=False, path_mode='COPY', embed_textures=False,
        use_custom_props=False)


# ---------------------------------------------------------------------------------------------- welded variants of nose/ear parts
def boundary_distance(me):
    bm = bmesh.new()
    bm.from_mesh(me)
    bv = [v.co[:] for v in bm.verts if any(e.is_boundary for e in v.link_edges)]
    bm.free()
    P = coords(me)
    bv = np.array(bv)
    return np.min(np.linalg.norm(P[:, None, :] - bv[None, :, :], axis=2), axis=1)


def vertex_normals_from_loops(me):
    n = np.zeros((len(me.vertices), 3))
    cn = np.empty(len(me.loops) * 3)
    me.corner_normals.foreach_get('vector', cn)
    cn = cn.reshape(-1, 3)
    for li, l in enumerate(me.loops):
        n[l.vertex_index] += cn[li]
    return n / (np.linalg.norm(n, axis=1, keepdims=True) + 1e-9)


def variant(base, name, disp_fn, ramp=(0.002, 0.016)):
    """Copy `base` (a part with open boundary loop + shape keys), add the displacement D = disp_fn(P, w) (w = 0 on the boundary
    loop, 1 inside) to the Basis and every shape key (so all head shapes keep working), blend custom normals back to the
    default part's normals towards the rim.  The boundary loop stays bit-identical to the default part's."""
    ob = base.copy()
    ob.data = base.data.copy()
    ob.name = name
    ob.data.name = name
    bpy.context.collection.objects.link(ob)
    me = ob.data
    P = coords(me)
    d_b = boundary_distance(me)
    w = S(ramp[0], ramp[1], d_b)
    D = disp_fn(P, w) * w[:, None] if disp_fn is not None else np.zeros_like(P)
    old_n = vertex_normals_from_loops(me)
    for kb in me.shape_keys.key_blocks:
        k = np.empty(len(me.vertices) * 3)
        kb.data.foreach_get('co', k)
        kb.data.foreach_set('co', (k.reshape(-1, 3) + D).astype(np.float32).ravel())
    me.update()
    new_n = np.empty(len(me.vertices) * 3)
    me.vertex_normals.foreach_get('vector', new_n)
    new_n = new_n.reshape(-1, 3)
    wn = S(0.0, 0.5, w)[:, None] * 0 + w[:, None]
    mix = old_n * (1 - wn) + new_n * wn
    mix /= np.linalg.norm(mix, axis=1, keepdims=True) + 1e-9
    me.normals_split_custom_set_from_vertices([tuple(v) for v in mix])
    return ob
