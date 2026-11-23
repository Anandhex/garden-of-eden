"""MakeHuman core for the Garden of Eden character base (runs inside Blender 4.3 with the project-local MPFB 2 install).

What comes from MakeHuman / MPFB here (all CC0 data, MPFB code GPL, used as a tool only):
* the hm08 base mesh, its vertex groups and joint helpers (MPFB `ObjectService.load_base_mesh` via `HumanService.create_human`),
* the macro system (gender, age, muscle, weight, proportions, height, cup size, firmness, race), evaluated by MPFB
  (`TargetService.reapply_macro_details`),
* every detail / expression target file (`data/targets/**.target.gz`),
* the proxies (eyes, eyebrows, eyelashes, teeth, tongue, hair; `.mhclo` + `.obj`) and their fitting rule
  (the same barycentric + scaled-offset rule as `ClothesService.fit_clothes_to_human`),
* the Mixamo/Unity rig and its weights (`data/rigs/standard/rig.mixamo_unity.json`, `weights.mixamo_unity.json`).

Everything here is deterministic: no randomness, fixed file lists, numpy only.
Blender space: Z up, the character faces -Y, character-left is +X, metres (MPFB scale 0.1 = decimetres to metres).
"""
import bpy, os, sys, gzip, json, math
import numpy as np
from importlib import import_module

HERE = os.path.dirname(os.path.abspath(__file__))
CHAR = os.path.dirname(HERE)
MPFB = "bl_ext.user_default.mpfb"
CACHE = os.path.join(HERE, "cache")


def mpfb(mod, name):
    return getattr(import_module(f"{MPFB}.{mod}"), name)


def HS():
    return mpfb("services.humanservice", "HumanService")


def TS():
    return mpfb("services.targetservice", "TargetService")


def LS():
    return mpfb("services.locationservice", "LocationService")


def HOP():
    return mpfb("entities.objectproperties", "HumanObjectProperties")


def sys_data(*p):
    return os.path.join(LS().get_mpfb_data(""), *p)


def user_data(*p):
    return os.path.join(LS().get_user_data(""), *p)


DEFAULT_MACRO = {"gender": 0.5, "age": 0.5, "muscle": 0.5, "weight": 0.5, "proportions": 0.5, "height": 0.5,
                 "cupsize": 0.5, "firmness": 0.5, "race": {"asian": 0.333, "caucasian": 0.334, "african": 0.333}}


def full_macro(m):
    out = json.loads(json.dumps(DEFAULT_MACRO))
    for k, v in (m or {}).items():
        if k == "race":
            out["race"].update(v)
        else:
            out[k] = v
    return out


# ------------------------------------------------------------------------------------------------ the base mesh
class Base:
    """one MPFB basemesh object; evaluates macro settings and target files to numpy coordinates (19158 x 3, helpers included)."""

    def __init__(self):
        for o in list(bpy.data.objects):
            if o.name.startswith("MH_Base"):
                bpy.data.objects.remove(o, do_unlink=True)
        h = HS().create_human(mask_helpers=False, detailed_helpers=True, extra_vertex_groups=True, feet_on_ground=False,
                              scale=0.1, macro_detail_dict=full_macro({}))
        h.name = "MH_Base"
        self.h = h
        me = h.data
        n = len(me.vertices)
        self.n = n
        self.basis = np.empty(n * 3)
        me.shape_keys.key_blocks[0].data.foreach_get("co", self.basis)
        self.basis = self.basis.reshape(-1, 3)
        self.faces_all = [tuple(p.vertices) for p in me.polygons]
        self.uv_all = None
        uvl = me.uv_layers.active
        if uvl is not None:
            uv = np.empty(len(me.loops) * 2)
            uvl.data.foreach_get("uv", uv)
            self.uv_all = uv.reshape(-1, 2)
        self.loop_start = [p.loop_start for p in me.polygons]
        self.groups = {}
        for vg in h.vertex_groups:
            self.groups[vg.name] = []
        names = {vg.index: vg.name for vg in h.vertex_groups}
        for v in me.vertices:
            for g in v.groups:
                if g.weight > 0.0:
                    self.groups[names[g.group]].append(v.index)
        self.groups = {k: np.array(sorted(v), dtype=np.int64) for k, v in self.groups.items()}
        self.body_mask = np.zeros(n, bool)
        self.body_mask[self.groups["body"]] = True
        self._tcache = {}
        os.makedirs(CACHE, exist_ok=True)
        self._cfile = os.path.join(CACHE, "targets.npz")
        if os.path.exists(self._cfile):
            z = np.load(self._cfile)
            self._tcache = {k: z[k] for k in z.files}
        self._dirty = False

    def mix(self):
        kb = self.h.data.shape_keys.key_blocks
        P = self.basis.copy()
        tmp = np.empty(self.n * 3)
        for k in kb[1:]:
            if abs(k.value) > 1e-9:
                k.data.foreach_get("co", tmp)
                P += k.value * (tmp.reshape(-1, 3) - self.basis)
        return P

    def macro(self, m):
        """coordinates for a macro dict (MPFB's own interpolation of the macro target stack), feet not re-grounded."""
        m = full_macro(m)
        hop = HOP()
        for k, v in m.items():
            if k != "race":
                hop.set_value(k, float(v), entity_reference=self.h)
        for k, v in m["race"].items():
            hop.set_value(k, float(v), entity_reference=self.h)
        TS().reapply_macro_details(self.h, remove_zero_weight_targets=True)
        return self.mix()

    def target(self, rel):
        """delta (n x 3, metres, Blender axes) of a MakeHuman target file, e.g. 'nose/nose-point-up'.  A path ending in
        .target (absolute) loads our own targets.  Cached in mh/cache/targets.npz."""
        key = rel.replace("/", "__")
        if key in self._tcache:
            return self._tcache[key]
        path = rel if rel.endswith(".target") else sys_data("targets", rel + ".target.gz")
        D = read_target(path, self.n)
        self._tcache[key] = D
        self._dirty = True
        return D

    def save_cache(self):
        if self._dirty:
            np.savez_compressed(self._cfile, **self._tcache)
            self._dirty = False


def read_target(path, n):
    op = gzip.open if path.endswith(".gz") else open
    D = np.zeros((n, 3))
    with op(path, "rt") as fh:
        for line in fh:
            s = line.strip()
            if not s or s[0] == "#":
                continue
            p = s.split()
            i = int(p[0])
            # MakeHuman: decimetres, Y up, Z front -> Blender metres (x, -z, y)  (TargetService: "XZY order and -Y")
            D[i] = (float(p[1]) * 0.1, -float(p[3]) * 0.1, float(p[2]) * 0.1)
    return D


def write_target(path, D, header="", eps=1e-6):
    """write a delta (metres, Blender axes) as a MakeHuman .target file (decimetres, x y z with Y up, Z front)."""
    with open(path, "w") as fh:
        fh.write("# Garden of Eden stylise target (generated by art3d/characters/mh; CC0 like the MakeHuman targets)\n")
        if header:
            for l in header.splitlines():
                fh.write("# " + l + "\n")
        for i in np.nonzero(np.abs(D).max(axis=1) > eps)[0]:
            x, y, z = D[i] * 10.0
            fh.write(f"{i} {x:.5f} {z:.5f} {-y:.5f}\n")


# ------------------------------------------------------------------------------------------------ proxies (.mhclo)
class Proxy:
    """a MakeHuman proxy (eyes, eyebrows, eyelashes, teeth, tongue, hair): topology from its .obj, fitting from its .mhclo."""

    def __init__(self, mhclo_path):
        self.path = mhclo_path
        self.dir = os.path.dirname(mhclo_path)
        self.name = os.path.splitext(os.path.basename(mhclo_path))[0]
        self.obj = None
        self.material = None
        self.scale = {}
        self.delete_verts = []
        rows = []
        mode = None
        with open(mhclo_path) as fh:
            for line in fh:
                s = line.strip()
                if not s or s.startswith("#"):
                    continue
                w = s.split()
                if mode == "verts" and (w[0][0].isdigit() or w[0][0] == "-") and len(w) in (1, 9):
                    rows.append(w)
                    continue
                if mode == "delete" and w[0][0].isdigit():
                    for tok in w:
                        if "-" in tok:
                            a, b = tok.split("-")
                            self.delete_verts += list(range(int(a), int(b) + 1))
                        else:
                            self.delete_verts.append(int(tok))
                    continue
                if w[0] == "obj_file":
                    self.obj = os.path.join(self.dir, w[1])
                elif w[0] == "material":
                    self.material = os.path.normpath(os.path.join(self.dir, w[1]))
                elif w[0] in ("x_scale", "y_scale", "z_scale"):
                    self.scale[w[0]] = (int(w[1]), int(w[2]), float(w[3]))
                elif w[0] == "verts":
                    mode = "verts"
                elif w[0] == "delete_verts":
                    mode = "delete"
        self.vi = np.zeros((len(rows), 3), np.int64)
        self.vw = np.zeros((len(rows), 3))
        self.off = np.zeros((len(rows), 3))
        for k, w in enumerate(rows):
            if len(w) == 1:
                self.vi[k] = int(w[0])
                self.vw[k] = (1, 0, 0)
            else:
                self.vi[k] = [int(x) for x in w[:3]]
                self.vw[k] = [float(x) for x in w[3:6]]
                d0, d1, d2 = (float(x) for x in w[6:9])
                self.off[k] = (d0, -d2, d1)         # Mhclo.load: Vector((d0, -d2, d1))
        self._read_obj()

    def _read_obj(self):
        V, VT, F, FT = [], [], [], []
        groups = []
        cur = None
        with open(self.obj) as fh:
            for line in fh:
                if line.startswith("v "):
                    V.append([float(x) for x in line.split()[1:4]])
                elif line.startswith("vt "):
                    VT.append([float(x) for x in line.split()[1:3]])
                elif line.startswith("f "):
                    a, b = [], []
                    for tok in line.split()[1:]:
                        t = tok.split("/")
                        a.append(int(t[0]) - 1)
                        b.append(int(t[1]) - 1 if len(t) > 1 and t[1] else -1)
                    F.append(a)
                    FT.append(b)
                    groups.append(cur)
                elif line.startswith(("g ", "o ", "usemtl ")):
                    cur = line.split(None, 1)[1].strip()
        self.nv = len(V)
        self.faces = F
        self.face_uv = FT
        self.uv = np.array(VT) if VT else None
        self.face_group = groups
        assert self.nv == len(self.vi), (self.name, self.nv, len(self.vi))

    def fit(self, B):
        """proxy coordinates for basemesh coordinates B (n x 3, metres)."""
        sx = sy = sz = 0.1
        if "x_scale" in self.scale:
            a, b, d = self.scale["x_scale"]
            sx = abs(B[a, 0] - B[b, 0]) / d
            a, b, d = self.scale["y_scale"]
            sy = abs(B[a, 2] - B[b, 2]) / d
            a, b, d = self.scale["z_scale"]
            sz = abs(B[a, 1] - B[b, 1]) / d
        P = (B[self.vi] * self.vw[:, :, None]).sum(axis=1)
        P += self.off * np.array([sx, sz, sy])
        return P

    def texture(self):
        """diffuse texture of the proxy's default material (absolute path) or None."""
        if not self.material or not os.path.exists(self.material):
            return None
        with open(self.material) as fh:
            for line in fh:
                w = line.split()
                if w and w[0] == "diffuseTexture":
                    return os.path.normpath(os.path.join(os.path.dirname(self.material), w[1]))
        return None


def proxy_file(kind, name):
    p = user_data(kind, name, name + ".mhclo")
    if os.path.exists(p):
        return p
    return user_data(kind, name, name + ".proxy")


# ------------------------------------------------------------------------------------------------ rig (Mixamo/Unity)
def rig_json(name="mixamo_unity"):
    return json.load(open(sys_data("rigs", "standard", f"rig.{name}.json")))


def rig_weights(name="mixamo_unity"):
    return json.load(open(sys_data("rigs", "standard", f"weights.{name}.json")))
