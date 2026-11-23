using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering;

namespace GardenOfEden.Look
{
    /// <summary>One clump of grass: where it stands, which way the ground leans, the colour of the ground under it.</summary>
    public struct GrassSpot
    {
        public Vector3 position;
        public Vector3 normal;
        /// <summary>The ground's colour at the spot, in the colour space the vertex colours use (linear in a linear project).</summary>
        public Color color;
    }

    /// <summary>
    /// A short, dense meadow. Each instance is a clump of soft rounded blades (one small mesh), drawn with
    /// <c>Graphics.RenderMeshInstanced</c> and the ToonGrass shader, carrying the colour of the ground beneath it so the
    /// field and the earth read as one surface. Clumps live in square chunks; each frame only chunks inside
    /// <see cref="drawDistance"/> and the camera frustum are drawn, and a chunk's far side is thinned (the instances are
    /// pre-shuffled, so a prefix is a fair sample): many near the camera, fewer and fewer with distance, none past the range.
    /// Fill it with <see cref="SetSpots"/>.
    /// </summary>
    [AddComponentMenu("GardenOfEden/Look/Grass Field")]
    public sealed class GrassField : MonoBehaviour
    {
        [Header("Rendering")]
        [Tooltip("A material using GardenOfEden/ToonGrass. A private copy is made so the asset is never changed.")]
        public Material material;
        [Tooltip("Camera whose position and frustum decide what is drawn. Empty = Camera.main.")]
        public Camera cameraOverride;
        public bool castShadows = false;
        [Tooltip("Copy drawDistance into the material's _FadeStart/_FadeEnd so blades shrink away before they stop being drawn.")]
        public bool syncShaderFade = true;

        [Header("Clump")]
        [Tooltip("Height of a clump in metres (before the random range). Short, soft grass: about 0.25 to 0.45 m.")]
        public float clumpHeight = 0.30f;
        public Vector2 heightRange = new Vector2(0.68f, 1.3f);
        [Tooltip("Blades in one clump.")]
        [Range(3, 12)] public int bladesPerClump = 6;
        [Tooltip("Half-width of a blade at its root, in clump-height units (0.12 = a 8 cm blade on a 34 cm clump).")]
        public float bladeHalfWidth = 0.085f;
        [Tooltip("How far a clump leans to the ground normal (0 = straight up).")]
        [Range(0f, 1f)] public float tiltToNormal = 0.5f;

        [Header("Culling")]
        public float chunkSize = 8f;
        public float drawDistance = 48f;
        [Tooltip("Beyond this distance the number of clumps per chunk is reduced toward farDensity.")]
        public float thinStartDistance = 12f;
        [Range(0.02f, 1f)] public float farDensity = 0.12f;
        [Tooltip("Blades shrink away over this many metres inside the edge of the loaded land (set it with SetLoadedRect).")]
        public float edgeFade = 12f;
        [Tooltip("Safety cap on the number of clumps held.")]
        public int maxInstances = 450000;

        [Tooltip("Clumps are drawn in this many ground-colour groups (k-means over the colours of the ground under them).")]
        [Range(1, 12)] public int colourGroups = 5;

        sealed class Chunk
        {
            public Matrix4x4[][] data;   // per colour group
            public Bounds bounds;
            public int count;
        }

        struct Inst { public Matrix4x4 m; public int group; }

        sealed class ChunkBuilder
        {
            public readonly List<Inst> list = new List<Inst>();
            public Vector3 min = new Vector3(float.MaxValue, float.MaxValue, float.MaxValue);
            public Vector3 max = new Vector3(float.MinValue, float.MinValue, float.MinValue);
        }

        readonly List<Chunk> _chunks = new List<Chunk>();
        MaterialPropertyBlock[] _blocks = new MaterialPropertyBlock[0];
        static readonly int GroundTintId = Shader.PropertyToID("_GroundTint");
        readonly Plane[] _planes = new Plane[6];
        Mesh _clump;
        Material _runtimeMaterial;
        bool _rectSet;
        int _total;
        int _meshBlades;
        float _meshHalfWidth;

        /// <summary>Number of clumps currently held (all chunks).</summary>
        public int InstanceCount => _total;
        /// <summary>Clumps drawn last frame (after culling and thinning).</summary>
        public int DrawnLastFrame { get; private set; }

        void OnEnable() => EnsureResources();

        void OnDisable()
        {
            if (_runtimeMaterial != null) { Kill(_runtimeMaterial); _runtimeMaterial = null; }
            if (_clump != null) { Kill(_clump); _clump = null; }
        }

        static void Kill(UnityEngine.Object o) { if (Application.isPlaying) Destroy(o); else DestroyImmediate(o); }

        void EnsureResources()
        {
            if (!_rectSet) { _rectSet = true; Shader.SetGlobalVector(GrassRectId, new Vector4(-1e6f, -1e6f, 1e6f, 1e6f)); Shader.SetGlobalFloat(GrassEdgeFadeId, edgeFade); }
            if (_clump == null || _meshBlades != bladesPerClump || !Mathf.Approximately(_meshHalfWidth, bladeHalfWidth))
            {
                if (_clump != null) Kill(_clump);
                _clump = BuildClumpMesh(bladesPerClump, bladeHalfWidth);
                _meshBlades = bladesPerClump; _meshHalfWidth = bladeHalfWidth;
            }
            if (_runtimeMaterial == null && material != null)
                _runtimeMaterial = new Material(material) { enableInstancing = true, hideFlags = HideFlags.HideAndDontSave };
            if (_runtimeMaterial != null && syncShaderFade)
            {
                _runtimeMaterial.SetFloat("_FadeStart", drawDistance * 0.7f);
                _runtimeMaterial.SetFloat("_FadeEnd", drawDistance);
            }
        }

        static readonly int GrassRectId = Shader.PropertyToID("_GrassRect"), GrassEdgeFadeId = Shader.PropertyToID("_GrassEdgeFade");

        /// <summary>The loaded land's rectangle (x0, z0, x1, z1): grass thins out toward its edge so it never ends in a line.</summary>
        public void SetLoadedRect(Vector4 rect)
        {
            Shader.SetGlobalVector(GrassRectId, rect);
            Shader.SetGlobalFloat(GrassEdgeFadeId, edgeFade);
        }

        public void Clear()
        {
            _chunks.Clear();
            _total = 0;
        }

        /// <summary>Replace the meadow with these clumps (deterministic: the same spots give the same grass).</summary>
        public void SetSpots(IList<GrassSpot> spots, int seed = 1337)
        {
            if (spots == null) throw new ArgumentNullException(nameof(spots));
            Clear();
            EnsureResources();
            var rng = new System.Random(seed);
            int n = Mathf.Min(spots.Count, maxInstances);
            var groupOf = GroupColours(spots, n, out Color[] centres);
            _blocks = new MaterialPropertyBlock[centres.Length];
            for (int g = 0; g < centres.Length; g++)
            {
                _blocks[g] = new MaterialPropertyBlock();
                _blocks[g].SetColor(GroundTintId, centres[g]);
            }
            var builders = new Dictionary<Vector2Int, ChunkBuilder>();
            for (int i = 0; i < n; i++) AddClump(builders, rng, spots[i], groupOf[i]);
            foreach (var kv in builders)
            {
                var list = kv.Value.list;
                // Fisher-Yates, so any prefix of each group's array is an evenly spread sample (used for far-distance thinning).
                for (int i = list.Count - 1; i > 0; i--)
                {
                    int j = rng.Next(i + 1);
                    (list[i], list[j]) = (list[j], list[i]);
                }
                var per = new List<Matrix4x4>[centres.Length];
                for (int g = 0; g < per.Length; g++) per[g] = new List<Matrix4x4>();
                foreach (var inst in list) per[inst.group].Add(inst.m);
                var c = new Chunk { data = new Matrix4x4[centres.Length][], count = list.Count };
                for (int g = 0; g < per.Length; g++) c.data[g] = per[g].ToArray();
                c.bounds = new Bounds((kv.Value.min + kv.Value.max) * 0.5f, kv.Value.max - kv.Value.min);
                _chunks.Add(c);
                _total += c.count;
            }
        }

        /// <summary>A small k-means over the spots' colours: which group each belongs to, and the groups' colours.</summary>
        int[] GroupColours(IList<GrassSpot> spots, int n, out Color[] centres)
        {
            int k = Mathf.Clamp(colourGroups, 1, 12);
            var assign = new int[n];
            if (n == 0) { centres = new Color[] { Color.gray }; return assign; }
            k = Mathf.Min(k, n);
            centres = new Color[k];
            var order = new List<int>(n);
            for (int i = 0; i < n; i++) order.Add(i);
            order.Sort((a, b) => spots[a].color.grayscale.CompareTo(spots[b].color.grayscale));
            for (int g = 0; g < k; g++) centres[g] = spots[order[Mathf.Min(n - 1, (int)((g + 0.5f) / k * n))]].color;
            var sum = new Vector3[k]; var cnt = new int[k];
            for (int it = 0; it < 5; it++)
            {
                Array.Clear(sum, 0, k); Array.Clear(cnt, 0, k);
                for (int i = 0; i < n; i++)
                {
                    var c = spots[i].color; int best = 0; float bd = float.MaxValue;
                    for (int g = 0; g < k; g++)
                    {
                        float dr = c.r - centres[g].r, dg = c.g - centres[g].g, db = c.b - centres[g].b, d = dr * dr + dg * dg + db * db;
                        if (d < bd) { bd = d; best = g; }
                    }
                    assign[i] = best; sum[best] += new Vector3(c.r, c.g, c.b); cnt[best]++;
                }
                for (int g = 0; g < k; g++) if (cnt[g] > 0) { var v = sum[g] / cnt[g]; centres[g] = new Color(v.x, v.y, v.z, 1f); }
            }
            return assign;
        }

        void AddClump(Dictionary<Vector2Int, ChunkBuilder> builders, System.Random rng, GrassSpot s, int group)
        {
            var key = new Vector2Int(Mathf.FloorToInt(s.position.x / chunkSize), Mathf.FloorToInt(s.position.z / chunkSize));
            if (!builders.TryGetValue(key, out ChunkBuilder b)) { b = new ChunkBuilder(); builders[key] = b; }
            float h = clumpHeight * Mathf.Lerp(heightRange.x, heightRange.y, (float)rng.NextDouble());
            float yaw = (float)rng.NextDouble() * 360f;
            Vector3 n = s.normal.sqrMagnitude > 0.0001f ? s.normal.normalized : Vector3.up;
            Vector3 axis = Vector3.Slerp(Vector3.up, n, tiltToNormal);
            Quaternion rot = Quaternion.FromToRotation(Vector3.up, axis) * Quaternion.AngleAxis(yaw, Vector3.up);
            float w = h * Mathf.Lerp(0.85f, 1.15f, (float)rng.NextDouble());
            b.list.Add(new Inst { m = Matrix4x4.TRS(s.position, rot, new Vector3(w, h, w)), group = group });
            float top = h + 0.6f;
            b.min = Vector3.Min(b.min, s.position - new Vector3(0.5f, 0.2f, 0.5f));
            b.max = Vector3.Max(b.max, s.position + new Vector3(0.5f, top, 0.5f));
        }

        void Update()
        {
            DrawnLastFrame = 0;
            if (_chunks.Count == 0 || material == null) return;
            EnsureResources();
            if (_runtimeMaterial == null || _clump == null) return;
            Camera cam = cameraOverride != null ? cameraOverride : Camera.main;
            if (cam == null) return;

            Vector3 camPos = cam.transform.position;
            GeometryUtility.CalculateFrustumPlanes(cam, _planes);
            var rp = new RenderParams(_runtimeMaterial)
            {
                layer = gameObject.layer,
                shadowCastingMode = castShadows ? ShadowCastingMode.On : ShadowCastingMode.Off,
                receiveShadows = true,
            };

            // The point the camera looks at matters more than the camera itself (a high, tilted camera is far from the ground).
            Vector3 focus = camPos;
            var gp = new Plane(Vector3.up, Vector3.zero);
            var ray = new Ray(camPos, cam.transform.forward);
            if (gp.Raycast(ray, out float hit) && hit > 0f && hit < 400f) focus = ray.GetPoint(hit);
            float span = Mathf.Max(0.01f, drawDistance - thinStartDistance);

            for (int ci = 0; ci < _chunks.Count; ci++)
            {
                Chunk c = _chunks[ci];
                float dCam = Mathf.Sqrt(c.bounds.SqrDistance(camPos));
                float dFocus = Mathf.Sqrt(c.bounds.SqrDistance(focus));
                float d = Mathf.Min(dCam, dFocus);
                if (d > drawDistance) continue;
                if (!GeometryUtility.TestPlanesAABB(_planes, c.bounds)) continue;
                float far = Mathf.Clamp01((d - thinStartDistance) / span);
                far = far * far * (3f - 2f * far);
                rp.worldBounds = c.bounds;
                for (int g = 0; g < c.data.Length; g++)
                {
                    var arr = c.data[g];
                    int ng = Mathf.CeilToInt(arr.Length * Mathf.Lerp(1f, farDensity, far));
                    if (ng == 0) continue;
                    rp.matProps = _blocks[g];
                    for (int start = 0; start < ng; start += 1023)
                        Graphics.RenderMeshInstanced(rp, _clump, 0, arr, Mathf.Min(1023, ng - start), start);
                    DrawnLastFrame += ng;
                }
            }
        }

        // ------------------------------------------------------------------------------------------------------
        /// <summary>
        /// A clump of soft blades, 1 unit tall: each blade has a wide base, a rounded tip, a gentle forward arc and leans
        /// outward a little. uv = (0..1 across, 0 root .. 1 tip); colour r = a per-blade brightness, g = a per-blade phase.
        /// </summary>
        public static Mesh BuildClumpMesh(int blades, float halfWidth)
        {
            blades = Mathf.Clamp(blades, 1, 16);
            float[] ys = { 0f, 0.42f, 0.76f, 0.94f, 1f };
            float[] ws = { 1f, 0.9f, 0.62f, 0.3f, 0.08f };
            int rows = ys.Length;
            var verts = new List<Vector3>(); var norms = new List<Vector3>(); var uvs = new List<Vector2>(); var cols = new List<Color>(); var tris = new List<int>();
            var rng = new System.Random(4242);
            for (int k = 0; k < blades; k++)
            {
                float ang = (k / (float)blades) * Mathf.PI * 2f + (float)rng.NextDouble() * 0.7f;
                float rad = 1.2f * Mathf.Sqrt((k + 0.5f) / blades) * Mathf.Lerp(0.8f, 1.1f, (float)rng.NextDouble());   // blades spread over a wide disc, so neighbouring clumps overlap into an even lawn
                Vector3 root = new Vector3(Mathf.Cos(ang) * rad, 0f, Mathf.Sin(ang) * rad);
                float bh = Mathf.Lerp(0.55f, 1f, (float)rng.NextDouble());
                float lean = Mathf.Lerp(10f, 30f, (float)rng.NextDouble()) * Mathf.Deg2Rad;
                float faceYaw = ang + (float)(rng.NextDouble() - 0.5) * 1.4f;       // which way the blade faces / leans
                var face = new Vector3(Mathf.Cos(faceYaw), 0f, Mathf.Sin(faceYaw));
                var side = new Vector3(-face.z, 0f, face.x);
                float bw = halfWidth * Mathf.Lerp(0.8f, 1.15f, (float)rng.NextDouble());
                float bright = Mathf.Lerp(0.9f, 1.1f, (float)rng.NextDouble());
                float phase = (float)rng.NextDouble();
                int b0 = verts.Count;
                for (int r = 0; r < rows; r++)
                {
                    float y = ys[r];
                    float hw = bw * ws[r];
                    float bend = y * y * Mathf.Tan(lean) * 0.55f * bh;
                    Vector3 c = root + new Vector3(0f, y * bh, 0f) + face * bend;
                    verts.Add(c - side * hw); verts.Add(c + side * hw);
                    uvs.Add(new Vector2(0f, y)); uvs.Add(new Vector2(1f, y));
                    var nrm = Vector3.Slerp(Vector3.up, -face, 0.35f).normalized;
                    norms.Add(nrm); norms.Add(nrm);
                    var col = new Color(bright, phase, 0f, 1f);
                    cols.Add(col); cols.Add(col);
                }
                for (int r = 0; r < rows - 1; r++)
                {
                    int l0 = b0 + r * 2, r0 = l0 + 1, l1 = l0 + 2, r1 = l0 + 3;
                    tris.Add(l0); tris.Add(l1); tris.Add(r0);
                    tris.Add(r0); tris.Add(l1); tris.Add(r1);
                }
            }
            var mesh = new Mesh { name = "ToonGrassClump", hideFlags = HideFlags.HideAndDontSave };
            mesh.SetVertices(verts); mesh.SetNormals(norms); mesh.SetUVs(0, uvs); mesh.SetColors(cols); mesh.SetTriangles(tris, 0);
            mesh.bounds = new Bounds(new Vector3(0f, 0.5f, 0f), new Vector3(2.8f, 1.2f, 2.8f));
            return mesh;
        }
    }
}
