// Bakes a PersonRecipe into one skinned mesh and one small atlas texture.
//
// Why a bake and not live blend shapes: a person's body never changes shape, so the blend shape weights (body, face, species, age),
// the joint offsets and the hidden-body-regions are applied once on the CPU and the parts (body regions, nose, ears, eyes, hair,
// beard, clothes) are merged into ONE mesh with two submeshes: skin (all skin, eyes, nose, ears, plus the face decals baked into a
// per-person 512 atlas) and cloth (all garments and hair, coloured by vertex colour from look.tint/trim, detail texture picked per
// vertex from one shared Texture2DArray). Two draw calls per person, no blend shape cost at run time, and the result is cached.
//
// Bones: the person rig is the 55-bone Humanoid armature; joint-moving shapes (height, legs, shoulders, sex, age...) move the bones'
// rest positions (joint_offsets.json), so the bindposes are recomputed from those positions (bindpose = bone.worldToLocal) and the
// rig instance gets the same rest positions.
using System;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering;

namespace GardenOfEden.World
{
    /// <summary>The result of a bake: shared by every instance of the same person.</summary>
    public sealed class BuiltPerson
    {
        public string key;
        public Mesh mesh;
        public Material skinMat, hairMat;
        /// <summary>Live blend shapes kept on the baked mesh (blink, visemes) by name -> index.</summary>
        public readonly Dictionary<string, int> liveShapes = new Dictionary<string, int>();
        /// <summary>What each submesh is: 0 skin, 1 cloth and solid hair, 2 alpha-tested hair cards.</summary>
        public int[] subKinds = { 0 };
        public Texture2D atlas;
        public Vector3[] bonePos;      // rest world positions per rig bone index (root at the origin)
        public float rootScale, height;
        public int refs, lastUse;
        public int tris, verts;
        public PersonRecipe recipe;
        public void Destroy()
        {
            if (mesh != null) UnityEngine.Object.Destroy(mesh);
            if (skinMat != null) UnityEngine.Object.Destroy(skinMat);
            if (hairMat != null) UnityEngine.Object.Destroy(hairMat);
            if (atlas != null) UnityEngine.Object.Destroy(atlas);
        }
    }

    public static class PersonBuilder
    {
        public const int AtlasSize = 512;
        // Atlas layout (v up, 512 px): face decals u 0..0.5, v 0.5..1; left eye u 0.5..0.75, v 0.75..1; right eye u 0.75..1, v 0.75..1.
        const int FaceX = 0, FaceY = 256, FaceSize = 256, EyeSize = 128, EyeLX = 256, EyeLY = 384, EyeRX = 384, EyeRY = 384;

        // ------------------------------------------------------------------ decals

        static readonly Dictionary<string, Color32[]> decals = new Dictionary<string, Color32[]>();

        /// <summary>A decal PNG (Resources/Decals/...) averaged down to size x size; cached.</summary>
        static Color32[] Decal(string manifestPath, int size)
        {
            if (string.IsNullOrEmpty(manifestPath)) return null;
            string key = manifestPath + "@" + size;
            if (decals.TryGetValue(key, out var c)) return c;
            string res = manifestPath.Replace("export/textures/", "Decals/");
            if (res.EndsWith(".png")) res = res.Substring(0, res.Length - 4);
            var tex = Resources.Load<Texture2D>(res);
            if (tex == null) { Debug.LogWarning("PersonBuilder: decal not found " + res); decals[key] = null; return null; }
            var src = tex.GetPixels32();
            int sw = tex.width, sh = tex.height;
            var dst = new Color32[size * size];
            int fx = Mathf.Max(1, sw / size), fy = Mathf.Max(1, sh / size);
            for (int y = 0; y < size; y++)
                for (int x = 0; x < size; x++)
                {
                    int r = 0, g = 0, b = 0, a = 0, w = 0;
                    for (int j = 0; j < fy; j++)
                        for (int i = 0; i < fx; i++)
                        {
                            var p = src[(y * fy + j) * sw + x * fx + i];
                            r += p.r * p.a; g += p.g * p.a; b += p.b * p.a; a += p.a; w++;
                        }
                    if (a > 0) dst[y * size + x] = new Color32((byte)(r / a), (byte)(g / a), (byte)(b / a), (byte)(a / w));
                    else
                    {
                        // fully transparent block: keep the colour of the first texel (the eye PNGs use RGB for the sclera under alpha 0)
                        var p0 = src[(y * fy) * sw + x * fx];
                        dst[y * size + x] = new Color32(p0.r, p0.g, p0.b, 0);
                    }
                }
            Resources.UnloadAsset(tex);
            decals[key] = dst;
            return dst;
        }

        static Color32[] atlasBuf = new Color32[AtlasSize * AtlasSize];

        static Color32 C32(Color c) => new Color32((byte)Mathf.RoundToInt(Mathf.Clamp01(c.r) * 255f), (byte)Mathf.RoundToInt(Mathf.Clamp01(c.g) * 255f), (byte)Mathf.RoundToInt(Mathf.Clamp01(c.b) * 255f), 255);

        // Layer a decal over the atlas: out = lerp(dst, rgb * tint, alpha). tint null = final colours.
        static void Over(Color32[] dst, int rx, int ry, int size, Color32[] src, Color? tint)
        {
            if (src == null) return;
            float tr = tint.HasValue ? tint.Value.r : 1f, tg = tint.HasValue ? tint.Value.g : 1f, tb = tint.HasValue ? tint.Value.b : 1f;
            for (int y = 0; y < size; y++)
            {
                int di = (ry + y) * AtlasSize + rx, si = y * size;
                for (int x = 0; x < size; x++, di++, si++)
                {
                    var s = src[si];
                    if (s.a == 0) continue;
                    float a = s.a / 255f;
                    var d = dst[di];
                    dst[di] = new Color32((byte)(d.r + (s.r * tr - d.r) * a), (byte)(d.g + (s.g * tg - d.g) * a), (byte)(d.b + (s.b * tb - d.b) * a), 255);
                }
            }
        }

        static void Blush(Color32[] dst, Color skin, float strength)
        {
            // soft deeper-skin patches on the cheeks and the nose tip, in the face rect's world coordinates (x -0.11..0.11, z 1.50..1.72)
            Color deep = new Color(Mathf.Clamp01(skin.r * 1.08f + 0.04f), skin.g * 0.78f, skin.b * 0.74f);
            void Spot(float cx, float cz, float rad, float a)
            {
                float fu = (cx + 0.11f) / 0.22f, fv = (cz - 1.50f) / 0.22f;
                int px = Mathf.RoundToInt(fu * FaceSize), py = Mathf.RoundToInt(fv * FaceSize);
                int r = Mathf.CeilToInt(rad / 0.22f * FaceSize);
                for (int y = -r; y <= r; y++)
                    for (int x = -r; x <= r; x++)
                    {
                        int ax = px + x, ay = py + y;
                        if (ax < 0 || ay < 0 || ax >= FaceSize || ay >= FaceSize) continue;
                        float d = Mathf.Sqrt(x * x + y * y) / r;
                        if (d >= 1f) continue;
                        float k = (1f - d * d); k *= k; k *= a * strength;
                        int i = (FaceY + ay) * AtlasSize + FaceX + ax;
                        var c = dst[i];
                        dst[i] = new Color32((byte)(c.r + (deep.r * 255f - c.r) * k), (byte)(c.g + (deep.g * 255f - c.g) * k), (byte)(c.b + (deep.b * 255f - c.b) * k), 255);
                    }
            }
            Spot(-0.060f, 1.570f, 0.030f, 0.8f); Spot(0.060f, 1.570f, 0.030f, 0.8f); Spot(0f, 1.592f, 0.016f, 0.7f);
        }

        static Texture2D MakeAtlas(PersonRecipe r)
        {
            var buf = atlasBuf;
            var skin = C32(r.skin);
            for (int i = 0; i < buf.Length; i++) buf[i] = skin;
            Blush(buf, r.skin, r.species == "orc" ? 0.25f : 1f);
            // eyes first (own quadrant), then the face layers in the manifest's order: stubble, brow, lids, lips, inner mouth
            if (r.eye != null && r.eye.textures.TryGetValue("iris", out var irisPath))
            {
                var iris = Decal(irisPath, EyeSize);
                if (iris != null)
                {
                    var eye = new Color32[EyeSize * EyeSize];
                    for (int i = 0; i < eye.Length; i++)
                    {
                        var p = iris[i];
                        float a = p.a / 255f;
                        // out = rgb * lerp(1, iris, A)
                        float rr = p.r / 255f * Mathf.Lerp(1f, r.iris.r, a), gg = p.g / 255f * Mathf.Lerp(1f, r.iris.g, a), bb = p.b / 255f * Mathf.Lerp(1f, r.iris.b, a);
                        eye[i] = new Color32((byte)(Mathf.Clamp01(rr) * 255f), (byte)(Mathf.Clamp01(gg) * 255f), (byte)(Mathf.Clamp01(bb) * 255f), 255);
                    }
                    Over(buf, EyeLX, EyeLY, EyeSize, eye, null);
                    Over(buf, EyeRX, EyeRY, EyeSize, eye, null);
                }
            }
            if (r.beardDecal != null) Over(buf, FaceX, FaceY, FaceSize, Decal(r.beardDecal.texture, FaceSize), r.hair);
            if (r.brow != null) Over(buf, FaceX, FaceY, FaceSize, Decal(r.brow.texture, FaceSize), r.hair);
            if (r.eye != null && r.eye.textures.TryGetValue("lids", out var lidPath)) Over(buf, FaceX, FaceY, FaceSize, Decal(lidPath, FaceSize), null);
            if (r.mouth != null)
            {
                if (r.mouth.textures.TryGetValue("lips", out var lipPath)) Over(buf, FaceX, FaceY, FaceSize, Decal(lipPath, FaceSize), r.lip);
                if (r.mouth.textures.TryGetValue("inner", out var inner) || r.mouth.textures.TryGetValue("mouthInner", out inner)) Over(buf, FaceX, FaceY, FaceSize, Decal(inner, FaceSize), null);
            }
            var tex = new Texture2D(AtlasSize, AtlasSize, TextureFormat.RGBA32, true, false) { name = "person atlas", wrapMode = TextureWrapMode.Clamp, filterMode = FilterMode.Bilinear, anisoLevel = 4 };
            tex.SetPixels32(buf);
            tex.Apply(true, true);
            return tex;
        }

        // ------------------------------------------------------------------ garment colours

        static readonly Color Leather = new Color(0.36f, 0.23f, 0.14f), Metal = new Color(0.5f, 0.54f, 0.6f), Linen = new Color(0.86f, 0.8f, 0.68f);

        static Color PieceTint(PersonRecipe r, ClothPiece p)
        {
            Color t = r.tint, tr = r.trim;
            switch (p.slot)
            {
                case "legs": return Color.Lerp(t * 0.6f, new Color(0.42f, 0.33f, 0.25f), 0.5f);
                case "skirt": return Color.Lerp(t, tr, 0.15f) * 0.92f;
                case "feet": return t * 0.55f;
                case "hands": return t * 0.7f;
                case "overlay": return p.id == "o_apron" ? Color.Lerp(t, Color.white, 0.4f) : Color.Lerp(t, tr, 0.3f);
                case "headwear": return Color.Lerp(t, tr, 0.35f);
                case "torso": return p.layer == "base" ? t : Color.Lerp(t, tr, 0.35f) * 0.88f;
                default: return t;
            }
        }

        static void ClothColour(string mat, PersonRecipe r, ClothPiece p, out Color c, out int slice)
        {
            Color tint = p != null ? PieceTint(r, p) : r.tint;
            switch (mat)
            {
                case "GC_Tint": c = tint; slice = 0; break;
                case "GC_Quilt": c = tint; slice = 1; break;
                case "GC_Trim": c = r.trim; slice = 2; break;
                case "GC_Leather": c = Leather; slice = 3; break;
                case "GC_Metal": c = Metal; slice = 4; break;
                case "GC_Linen": c = Linen; slice = 0; break;
                case "GC_Stripe": c = tint; slice = 5; break;
                case "GC_Plaid": c = tint; slice = 6; break;
                default: c = tint; slice = 15; break;
            }
        }

        // ------------------------------------------------------------------ merging

        sealed class Group
        {
            public readonly List<Vector3> pos = new List<Vector3>(); public readonly List<Vector3> nrm = new List<Vector3>();
            public readonly List<Vector2> uv = new List<Vector2>(); public readonly List<Vector2> uv1 = new List<Vector2>(); public readonly List<Color32> col = new List<Color32>();
            public readonly List<BoneWeight> bw = new List<BoneWeight>(); public readonly List<int> tris = new List<int>();
            public readonly Dictionary<string, Dictionary<int, Vector3>> live = new Dictionary<string, Dictionary<int, Vector3>>();
            public Texture tex;      // hair group: the card texture
        }

        /// <summary>Blend shapes that stay live on the baked mesh (driven at run time by PersonFace): blinks, visemes, an open mouth.</summary>
        public static bool IsLiveShape(string n)
        {
            if (string.IsNullOrEmpty(n)) return false;
            if (PersonCatalog.ExpressionShapes.Contains(n)) return true;
            string l = n.ToLowerInvariant();
            return l.Contains("blink") || l.StartsWith("eyes_closed") || l.StartsWith("eye_closed") || l.StartsWith("lid_close") || l.StartsWith("viseme") || l.StartsWith("v_")
                || l == "mouth_open" || l == "jaw_open" || l.StartsWith("mouth_open");
        }

        static readonly Color TeethCol = new Color(0.93f, 0.89f, 0.80f), CavityCol = new Color(0.30f, 0.09f, 0.09f), TongueCol = new Color(0.72f, 0.33f, 0.33f);

        static Vector3[] displaced = new Vector3[0];

        static void Displace(PartData part, Dictionary<string, float> weights)
        {
            int n = part.pos.Length;
            if (displaced.Length < n) displaced = new Vector3[Mathf.Max(n, displaced.Length * 2)];
            Array.Copy(part.pos, displaced, n);
            foreach (var kv in weights)
            {
                if (!part.shapes.TryGetValue(kv.Key, out var sd)) continue;
                float w = kv.Value;
                var idx = sd.idx; var d = sd.d;
                for (int k = 0; k < idx.Length; k++) displaced[idx[k]] += d[k] * w;
            }
        }

        static int[] remap = new int[0];

        // Emit every submesh of the part into the groups. kind: 0 body skin, 1 hair/beard, 2 cloth, 3 eye, 4 mouth interior.
        static void Emit(PartData part, Group skinG, Group clothG, Group hairG, PersonRecipe r, ClothPiece piece, int kind)
        {
            Displace(part, r.shapes);
            int n = part.pos.Length;
            if (remap.Length < n) remap = new int[Mathf.Max(n, remap.Length * 2)];
            bool isHair = kind == 1;
            Color mouthCol = part.name.StartsWith("Teeth") ? TeethCol : part.name.StartsWith("Tongue") ? TongueCol : CavityCol;
            for (int s = 0; s < part.tris.Length; s++)
            {
                string mat = part.mats[s];
                string ml = mat.ToLowerInvariant();
                bool card = part.tex != null && part.tex[s] != null && (isHair || ml.Contains("hair") || ml.Contains("brow") || ml.Contains("lash") || ml.Contains("card"));
                bool skinKind = !card && !(mat.StartsWith("GC_") || isHair);
                var g = card ? hairG : skinKind ? skinG : clothG;
                if (card && hairG.tex == null) hairG.tex = part.tex[s];
                Color cc = Color.white; int slice = 0;
                if (card) cc = r.hair;
                else if (!skinKind) { if (isHair) { cc = r.hair; slice = 15; } else ClothColour(mat, r, piece, out cc, out slice); }
                Color lin = cc.linear;
                for (int i = 0; i < n; i++) remap[i] = -1;
                var tri = part.tris[s];
                for (int t = 0; t < tri.Length; t++)
                {
                    int v = tri[t];
                    int o = remap[v];
                    if (o < 0)
                    {
                        o = g.pos.Count; remap[v] = o;
                        g.pos.Add(displaced[v]); g.nrm.Add(part.nrm[v]); g.bw.Add(part.bw[v]);
                        // new head layout: the decals and irises ride the legacy face rect (UV1), the skin texture set the head's own UVs (UV0)
                        if (part.uv2 != null && skinKind) { g.uv.Add(part.uv2[v]); g.uv1.Add(part.uv[v]); }
                        else { g.uv.Add(part.uv[v]); g.uv1.Add(new Vector2(-1f, -1f)); }
                        if (card) g.col.Add(new Color32((byte)(Mathf.Clamp01(lin.r) * 255f), (byte)(Mathf.Clamp01(lin.g) * 255f), (byte)(Mathf.Clamp01(lin.b) * 255f), 255));
                        else if (skinKind)
                        {
                            if (kind == 4) { var ml2 = mouthCol; g.col.Add(new Color32((byte)(ml2.r * 255f), (byte)(ml2.g * 255f), (byte)(ml2.b * 255f), 128)); }
                            else g.col.Add(new Color32(255, 255, 255, kind == 3 ? (byte)0 : (byte)255));
                        }
                        else
                        {
                            float sh = 1f;
                            if (isHair && part.col != null) sh = Mathf.Clamp(part.col[v].r / 255f, 0.35f, 1f);
                            g.col.Add(new Color32((byte)(Mathf.Clamp01(lin.r * sh) * 255f), (byte)(Mathf.Clamp01(lin.g * sh) * 255f), (byte)(Mathf.Clamp01(lin.b * sh) * 255f), (byte)(slice * 16 + 8)));
                        }
                    }
                    g.tris.Add(o);
                }
                // live shapes (blink, visemes): keep their deltas for the merged mesh
                foreach (var kv in part.shapes)
                {
                    if (!IsLiveShape(kv.Key)) continue;
                    if (!g.live.TryGetValue(kv.Key, out var dict)) g.live[kv.Key] = dict = new Dictionary<int, Vector3>();
                    var sd = kv.Value;
                    for (int k = 0; k < sd.idx.Length; k++) { int o = remap[sd.idx[k]]; if (o >= 0) dict[o] = sd.d[k]; }
                }
            }
        }

        static Vector3 OffsetOf(PersonCatalog cat, PersonRecipe r, string bone)
        {
            Vector3 d = Vector3.zero;
            foreach (var kv in r.shapes)
                if (cat.jointOffsets.TryGetValue(kv.Key, out var m) && m.TryGetValue(bone, out var o)) d += o * kv.Value;
            return d;
        }

        static string FbxKeyOf(string file) => string.IsNullOrEmpty(file) ? "base_body" : System.IO.Path.GetFileNameWithoutExtension(file);

        /// <summary>The bake. Yields between steps so the factory can spread it over frames.</summary>
        public static IEnumerator Build(PersonRecipe r, PersonCatalog cat, PartLibrary lib, CharacterKit kit, Action<BuiltPerson> done)
        {
            var skinG = new Group(); var clothG = new Group(); var hairG = new Group();
            var rig = lib.rig;

            // 1. which parts
            var want = new List<(string fbx, string obj, ClothPiece piece, int kind)>();   // kind: 0 body, 1 hair, 2 cloth, 3 eye, 4 mouth
            void Body(string region, string obj) { if (!r.hides.Contains(region)) want.Add(("base_body", obj, null, 0)); }
            want.Add(("base_body", "Mesh_Head", null, 0));
            Body("torso", "Mesh_Torso"); Body("arms", "Mesh_Arms"); Body("hands", "Mesh_Hands"); Body("legs", "Mesh_Legs"); Body("feet", "Mesh_Feet");
            want.Add(("base_body", "Part_Eye_L", null, 3)); want.Add(("base_body", "Part_Eye_R", null, 3));
            want.Add((r.noseFbx, r.noseObj, null, 0));
            want.Add((r.earFbx, r.earL, null, 0)); want.Add((r.earFbx, r.earR, null, 0));
            foreach (var x in r.extraBody) want.Add(("base_body", x, null, 0));
            foreach (var x in cat.eyeParts)
            {
                if (x == "Part_Eye_L" || x == "Part_Eye_R") continue;
                string xl = x.ToLowerInvariant();
                if (xl.Contains("cornea")) continue;   // clear shells over the irises: not drawn (an opaque one would hide the iris)
                want.Add(("base_body", x, null, xl.Contains("lash") ? 1 : 0));
            }
            foreach (var x in cat.baseExtra)
            {
                string xl = x.ToLowerInvariant();
                want.Add(("base_body", x, null, xl.Contains("hair") || xl.Contains("brow") || xl.Contains("lash") ? 1 : 0));
            }
            // the mouth interior (seen when the jaw opens through a lip slit): cavity, tongue and the mouth's teeth
            if (cat.mouthParts.Count > 0)
            {
                string teeth = r.mouth != null && !string.IsNullOrEmpty(r.mouth.teethMesh) ? r.mouth.teethMesh : null;
                foreach (var mp in cat.mouthParts)
                {
                    if (mp.meshObjects.Length == 0) continue;
                    string o = mp.meshObjects[0];
                    if (mp.kind == "teeth" && o != teeth) continue;
                    want.Add((FbxKeyOf(mp.file), o, null, 4));
                }
            }
            if (!string.IsNullOrEmpty(r.hairObj)) want.Add(("parts_hair", r.hairObj, null, 1));
            if (!string.IsNullOrEmpty(r.beardObj)) want.Add(("parts_beards", r.beardObj, null, 1));
            foreach (var p in r.pieces) want.Add((System.IO.Path.GetFileNameWithoutExtension(p.file), p.obj, p, 2));

            // 2. extract (each first-use extraction is one step) and emit
            foreach (var w in want)
            {
                bool cached = lib.Has(w.fbx, w.obj);
                var part = lib.Get(w.fbx, w.obj);
                if (part == null) { if (w.kind == 0 && w.obj == "Mesh_Head") { done(null); yield break; } continue; }
                Emit(part, skinG, clothG, hairG, r, w.piece, w.kind);
                if (!cached) yield return null;
            }
            yield return null;

            // 3. joints: new rest positions, then bindposes
            var bonePos = new Vector3[rig.names.Length];
            for (int i = 0; i < bonePos.Length; i++) bonePos[i] = rig.restPos[i] + OffsetOf(cat, r, rig.names[i]);
            var bind = new Matrix4x4[bonePos.Length];
            for (int i = 0; i < bonePos.Length; i++) bind[i] = Matrix4x4.TRS(bonePos[i], rig.restRot[i], rig.restScale[i]).inverse;

            // 4. the mesh: skin submesh, then cloth (with solid hair), then alpha-tested hair cards if any
            var groups = new List<Group> { skinG };
            if (clothG.pos.Count > 0) groups.Add(clothG);
            if (hairG.pos.Count > 0) groups.Add(hairG);
            int total = 0; foreach (var g in groups) total += g.pos.Count;
            var mesh = new Mesh { name = "person " + r.spec.id };
            if (total > 65000) mesh.indexFormat = IndexFormat.UInt32;
            var pos = new Vector3[total]; var nrm = new Vector3[total]; var uv = new Vector2[total]; var uv1 = new Vector2[total]; var col = new Color32[total]; var bw = new BoneWeight[total];
            var offs = new int[groups.Count];
            int at = 0;
            for (int gi = 0; gi < groups.Count; gi++)
            {
                var g = groups[gi]; offs[gi] = at;
                g.pos.CopyTo(pos, at); g.nrm.CopyTo(nrm, at); g.uv.CopyTo(uv, at); g.uv1.CopyTo(uv1, at); g.col.CopyTo(col, at); g.bw.CopyTo(bw, at);
                at += g.pos.Count;
            }
            mesh.vertices = pos; mesh.normals = nrm; mesh.uv = uv; mesh.colors32 = col;
            if (kit.skinNormal != null) mesh.uv2 = uv1;
            mesh.subMeshCount = groups.Count;
            for (int gi = 0; gi < groups.Count; gi++)
            {
                var g = groups[gi];
                var tl = new List<int>(g.tris.Count);
                foreach (var t in g.tris) tl.Add(t + offs[gi]);
                mesh.SetTriangles(tl, gi, false);
            }
            mesh.boneWeights = bw;
            mesh.bindposes = bind;
            // live blend shapes
            var liveNames = new SortedSet<string>();
            foreach (var g in groups) foreach (var k in g.live.Keys) liveNames.Add(k);
            var built = new BuiltPerson();
            built.subKinds = new int[groups.Count];
            for (int gi = 0; gi < groups.Count; gi++) built.subKinds[gi] = groups[gi] == skinG ? 0 : groups[gi] == clothG ? 1 : 2;
            foreach (var name in liveNames)
            {
                var d = new Vector3[total];
                for (int gi = 0; gi < groups.Count; gi++)
                    if (groups[gi].live.TryGetValue(name, out var dict)) foreach (var kv in dict) d[kv.Key + offs[gi]] = kv.Value;
                mesh.AddBlendShapeFrame(name, 100f, d, null, null);
                built.liveShapes[name] = mesh.blendShapeCount - 1;
            }
            var b = new Bounds(pos[0], Vector3.zero);
            for (int i = 1; i < pos.Length; i++) b.Encapsulate(pos[i]);
            b.Expand(new Vector3(0.9f, 0.5f, 0.9f));
            mesh.bounds = b;
            yield return null;

            // 5. the atlas and the material
            var atlas = MakeAtlas(r);
            var mat = new Material(kit.skinTemplate) { name = "person skin " + r.spec.id };
            mat.SetTexture("_BaseMap", atlas);
            if (kit.skinNormal != null)
            {
                mat.SetTexture("_SkinNormal", kit.skinNormal); mat.EnableKeyword("_SKINMAPS"); mat.SetFloat("_UseSkinMaps", 1f);
                if (kit.skinMask != null) mat.SetTexture("_SkinMask", kit.skinMask);
                // the head albedo of the nearest skin tone, divided by its base colour in the shader: the person keeps their own colour
                int best = -1; float bd = float.MaxValue;
                for (int i = 0; i < kit.skinTones.Count; i++)
                {
                    var c = kit.skinTones[i].baseColour; float d = (c.r - r.skin.r) * (c.r - r.skin.r) + (c.g - r.skin.g) * (c.g - r.skin.g) + (c.b - r.skin.b) * (c.b - r.skin.b);
                    if (kit.skinTones[i].albedo != null && d < bd) { bd = d; best = i; }
                }
                if (best >= 0) { mat.SetTexture("_SkinAlbedo", kit.skinTones[best].albedo); mat.SetColor("_SkinAlbedoBase", kit.skinTones[best].baseColour); }
            }
            if (hairG.pos.Count > 0 && kit.hairTemplate != null)
            {
                built.hairMat = new Material(kit.hairTemplate) { name = "person hair " + r.spec.id };
                if (hairG.tex != null) built.hairMat.SetTexture("_BaseMap", hairG.tex);
            }
            mesh.UploadMeshData(liveNames.Count == 0);
            built.key = r.spec.Key(); built.mesh = mesh; built.skinMat = mat; built.atlas = atlas; built.bonePos = bonePos; built.rootScale = r.rootScale; built.height = r.height; built.recipe = r; built.verts = total;
            int tc = 0; foreach (var g in groups) tc += g.tris.Count; built.tris = tc / 3;
            done(built);
        }
    }
}
