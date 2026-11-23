"""Preview stage for the parts: composes a face atlas from the decals, assigns soft materials, shows a person
(shape weights + parts + colours), renders grids. Import from render scripts running inside Blender (base.blend/parts.blend)."""
import bpy, os, sys, math, json
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__))
CHAR = os.path.dirname(HERE)
sys.path.insert(0, CHAR)
sys.path.insert(0, HERE)
import render_preview as rp   # noqa: E402
import decals, specs          # noqa: E402

N = decals.N
SKIN_DEFAULT = (0.93, 0.66, 0.52)


class Stage:
    def __init__(self, res=520):
        self.sc, self.rig, self.cam = rp.setup_scene()
        self.sc.render.resolution_x = self.sc.render.resolution_y = res
        self.arm = bpy.data.objects["Armature"]
        self.arm.data.pose_position = 'POSE'
        self.atlas = bpy.data.images.new("face_atlas", 1024, 1024, alpha=True)
        self.atlas.colorspace_settings.name = "Linear Rec.709"
        self.atlas.pack()
        self.skin = rp.skin_material("PSkin", SKIN_DEFAULT)
        self.face = rp.skin_material("PFace", SKIN_DEFAULT, tex=self.atlas)
        self.eye = rp.skin_material("PEye", SKIN_DEFAULT, tex=self.atlas, tint=False)
        self.hair = self._hair_material("PHair")
        for m in (self.skin, self.face, self.eye, self.hair):
            self._rim(m)
        self.teeth = rp.flat_material("PTeeth", (0.95, 0.92, 0.84))
        self.mouth = rp.flat_material("PMouth", (0.16, 0.05, 0.07))
        self.mouth.use_backface_culling = True
        self.tongue = rp.flat_material("PTongue", (0.80, 0.34, 0.38))
        self.cache = {}
        bpy.context.scene.render.use_freestyle = False
        for o in bpy.data.objects:
            if o.type == 'MESH' and o.name == "Body_Welded_Source":
                o.hide_render = o.hide_viewport = True
        self.all = [o for o in bpy.data.objects if o.type == 'MESH' and o.name != "Body_Welded_Source"]
        self._assign()
        rp.clear_pose(self.arm)

    # ------------------------------------------------------------------ materials
    def _hair_material(self, name):
        m = rp.skin_material(name, (1, 1, 1))
        nt = m.node_tree
        nodes = list(nt.nodes)
        ramp = [n for n in nodes if n.bl_idname == 'ShaderNodeValToRGB'][0]
        e = ramp.color_ramp
        stops = [(0.0, (0.30, 0.26, 0.40)), (0.18, (0.42, 0.34, 0.46)), (0.40, (0.70, 0.62, 0.66)), (0.62, (0.95, 0.90, 0.86)),
                 (0.85, (1.0, 1.0, 0.98)), (1.0, (1.0, 1.0, 1.0))]
        while len(e.elements) > 2:
            e.elements.remove(e.elements[-1])
        e.elements[0].position, e.elements[0].color = stops[0][0], (*stops[0][1], 1)
        e.elements[1].position, e.elements[1].color = stops[-1][0], (*stops[-1][1], 1)
        for pos, col in stops[1:-1]:
            k = e.elements.new(pos)
            k.color = (*col, 1)
        mixes = [n for n in nodes if n.bl_idname == 'ShaderNodeMix']
        mul = mixes[0]
        attr = nt.nodes.new("ShaderNodeVertexColor")
        attr.layer_name = "Shade"
        tm = nt.nodes.new("ShaderNodeMix")
        tm.data_type = 'RGBA'
        tm.blend_type = 'MULTIPLY'
        tm.inputs[0].default_value = 1.0
        tm.inputs[7].default_value = (0.3, 0.2, 0.1, 1)
        nt.links.new(attr.outputs["Color"], tm.inputs[6])
        nt.links.new(tm.outputs[2], mul.inputs[7])
        m["tint_node"] = tm.name
        return m

    @staticmethod
    def _rim(m, strength=0.5):
        """the base preview adds a cyan term that lifts dark colours (hair, brows, irises) towards teal; keep it for the
        silhouette only (facing ramp reversed) and weaker, so pigment colours read true."""
        ramps = [n for n in m.node_tree.nodes if n.bl_idname == 'ShaderNodeValToRGB']
        rr = ramps[1]
        e = rr.color_ramp
        e.elements[0].position, e.elements[0].color = 0.0, (0, 0, 0, 1)
        e.elements[1].position, e.elements[1].color = 1.0, (0.30 * strength, 0.75 * strength, 0.9 * strength, 1)
        k = e.elements.new(0.62)
        k.color = (0, 0, 0, 1)

    def set_hair_colour(self, rgb):
        r = tuple(float(c) ** 2.2 for c in rgb)
        self.hair.node_tree.nodes[self.hair["tint_node"]].inputs[7].default_value = (*r, 1)

    def _skin_nodes(self, mat, tex):
        mixes = [n for n in mat.node_tree.nodes if n.bl_idname == 'ShaderNodeMix']
        return mixes[2] if tex else mixes[0]

    def set_skin(self, rgb):
        for mat, tex in ((self.skin, False), (self.face, True)):
            self._skin_nodes(mat, tex).inputs[7].default_value = (*rgb, 1)

    def _assign(self):
        for ob in self.all:
            n = ob.name
            for i in range(len(ob.data.materials)):
                mn = ob.data.materials[i].name if ob.data.materials[i] else ""
                if n.startswith("Part_Eye"):
                    ob.data.materials[i] = self.eye
                elif n.startswith(("Hair_", "Beard_", "Brow3D_")):
                    ob.data.materials[i] = self.hair
                elif n.startswith("Teeth_"):
                    ob.data.materials[i] = self.teeth
                elif n.startswith("MouthIn_"):
                    ob.data.materials[i] = self.mouth
                elif n.startswith("Tongue_"):
                    ob.data.materials[i] = self.tongue
                elif mn.startswith("Face") or (i == 1 and n in ("Mesh_Head", "Part_Nose") or (i == 1 and n.startswith("Nose_"))):
                    ob.data.materials[i] = self.face
                else:
                    ob.data.materials[i] = self.skin

    # ------------------------------------------------------------------ atlas
    def decal(self, key):
        if key not in self.cache:
            import build_decals
            self.cache = build_decals.build(write=False)
        return self.cache[key]

    def compose(self, brow=None, lid=None, eye=None, mouth=None, stubble=None, hair_rgb=(0.25, 0.15, 0.08), lip_rgb=(0.8, 0.42, 0.4),
                iris_rgb=None, brow_rgb=None, blush=0.35, brows_off=False):
        face = np.ones((N, N, 4), np.float32)
        face[..., 3] = 1
        # blush
        ex, ez = decals.EYE["cx"], decals.EYE["cz"]
        mz = decals.MZ
        for sx in (-1, 1):
            d2 = ((decals.X - sx * (ex + 0.002)) / 0.022) ** 2 + ((decals.Z - (mz + 0.032)) / 0.015) ** 2
            a = np.exp(-d2 * 1.3) * blush
            for c, v in enumerate((0.92, 0.38, 0.36)):
                face[..., c] = face[..., c] * (1 - a) + v * a

        def lay(arr, tint=None, mult=1.0):
            if arr is None:
                return
            a = arr[..., 3:4] * mult
            rgb = arr[..., :3] if tint is None else arr[..., :3] * np.array(tint, np.float32)
            face[..., :3] = face[..., :3] * (1 - a) + rgb * a
        if stubble is not None:
            lay(self.decal(f"stubble_{stubble:02d}"), hair_rgb)
        if brow is not None:
            lay(self.decal(f"brow_{brow:02d}"), brow_rgb or hair_rgb)
        if lid is not None:
            lay(self.decal(f"lid_{lid}"))
        if mouth is not None:
            lay(self.decal(f"mouth_{mouth:02d}"), lip_rgb)
            k = f"mouthin_{mouth:02d}"
            self.decal(k) if False else None
            if k in self.cache:
                lay(self.cache[k])
        atlas = np.ones((1024, 1024, 4), np.float32)
        atlas[512:, :512] = face
        if eye is not None:
            ir = self.decal(f"eye_{eye:02d}").copy()
            tint = np.array(iris_rgb if iris_rgb is not None else specs.IRIS_COLOURS[specs.EYES[eye - 1]["colour"]], np.float32)
            a = ir[..., 3:4]
            rgb = ir[..., :3] * (1 - a + a * tint)
            q = np.concatenate([rgb, np.ones_like(a)], axis=2)
            atlas[768:1024, 512:768] = q
            atlas[768:1024, 768:1024] = q
        atlas[..., :3] = np.power(np.clip(atlas[..., :3], 0, 1), 2.2)       # decal values are display (sRGB-ish) colours
        self.atlas.pixels.foreach_set(atlas.ravel())
        self.atlas.update()

    # ------------------------------------------------------------------ visibility / shapes
    def show(self, names):
        names = set(names)
        base = {"Mesh_Head", "Mesh_Torso", "Mesh_Arms", "Mesh_Hands", "Mesh_Legs", "Mesh_Feet", "Part_Eye_L", "Part_Eye_R"}
        if not any(n.startswith("Nose_") or n.startswith("Part_Nose") for n in names):
            base.add("Part_Nose")
        if not any(n.startswith("Ear_") or n.startswith("Part_Ear") for n in names):
            base |= {"Part_Ear_L", "Part_Ear_R"}
        for o in self.all:
            vis = o.name in base or o.name in names
            o.hide_render = not vis
            o.hide_viewport = not vis
        self.vis = [o for o in self.all if not o.hide_render]

    def shapes(self, **kw):
        rp.CUR.clear()
        rp.CUR.update(kw)
        for ob in self.all:
            sk = ob.data.shape_keys
            if not sk:
                continue
            for kb in sk.key_blocks[1:]:
                kb.value = kw.get(kb.name, 0.0)
        bpy.context.view_layer.update()

    def head_z(self):
        dg = bpy.context.evaluated_depsgraph_get()
        head = bpy.data.objects["Mesh_Head"].evaluated_get(dg)
        return max(v.co.z for v in head.data.vertices) - 0.125

    def shot(self, path, az=0.0, cz=None, scale=0.34, pitch=0.0, cx=0.0):
        rp.shot(self.sc, self.rig, self.cam, path, az=az, center_z=self.head_z() if cz is None else cz, scale=scale, pitch=pitch, cx=cx)


def label_sheet(path, labels, cols, font_px=18):
    """Draw index labels on a montage with PIL when available (system python), no-op otherwise."""
    try:
        from PIL import Image, ImageDraw
    except Exception:
        return False
    im = Image.open(path).convert("RGB")
    W, H = im.size
    rows = (len(labels) + cols - 1) // cols
    cw, ch = W // cols, H // rows
    d = ImageDraw.Draw(im)
    for i, t in enumerate(labels):
        r, c = divmod(i, cols)
        d.text((c * cw + 8, r * ch + 6), t, fill=(255, 255, 255))
    im.save(path)
    return True
