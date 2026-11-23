// No hard world edge: a client-only ring of distant land round the loaded patches. It is built so the loaded land's edge
// is not a line anywhere:
//  * heights: the ring starts at the edge's own height, carries on at the edge's own slope (a saturating extension of the
//    gradient taken just inside the edge), and only then lets its rolling noise in (over ~10-260 m) and the mountains rise
//    (from ~120 m, full by ~620 m);
//  * colour: the same GroundLook function the patches use (with the real slope), so meadow, dry patches, sage and
//    wildflower dabs carry straight on;
//  * detail: a fine mesh (12 m cells) for the 430 m round the player and a coarse one (36 m) out to 1.5 km, joined crack-free;
//    and cheap baked trees, bushes and rocks scattered over the near ring (forest patches, density fading with distance),
//    drawn with the same prop meshes as the loaded land.
// The fog (DayNight, linear, blue-ish) turns the far mountains into soft layers. Deterministic from the map id; world-fixed
// lattices centred near the player so nothing swims; rebuilt when the loaded land or the window changes.
using System.Collections.Generic;
using UnityEngine;
using GardenOfEden.Net;

namespace GardenOfEden.World
{
    [DefaultExecutionOrder(150)]
    public sealed class HorizonRing : MonoBehaviour
    {
        public float halfExtent = 1500f;
        public float cell = 36f;
        [Tooltip("The fine inner mesh: half extent (a multiple of the coarse cell) and its cell size (the coarse cell divided by 3).")]
        public float innerHalf = 432f;
        public float innerCell = 12f;
        public float snap = 144f;
        public float farClip = 3200f;
        [Header("Scatter (trees, bushes, rocks)")]
        public bool scatter = true;
        public float scatterRadius = 560f;
        public float scatterCell = 13f;

        WorldView world;
        Mesh coarse, fine;
        GameObject coarseGo, fineGo;
        readonly List<GameObject> propGos = new List<GameObject>();
        readonly List<Mesh> propMeshes = new List<Mesh>();
        PropLibrary props;
        int lastVersion = -1;
        Vector2Int lastCentre = new Vector2Int(int.MinValue, 0);
        string lastMap;
        float next;
        uint seed;

        void Awake() => world = GetComponent<WorldView>();

        void OnDestroy()
        {
            Kill(coarse); Kill(fine); Kill(coarseGo); Kill(fineGo);
            ClearProps();
        }

        static void Kill(Object o) { if (o != null) { if (Application.isPlaying) Destroy(o); else DestroyImmediate(o); } }

        void ClearProps()
        {
            foreach (var g in propGos) Kill(g);
            foreach (var m in propMeshes) Kill(m);
            propGos.Clear(); propMeshes.Clear();
        }

        void LateUpdate()
        {
            var cam = Camera.main;
            if (cam != null && cam.farClipPlane < farClip) cam.farClipPlane = farClip;
            if (world == null) return;
            // A rebuild is spread over three frames (near mesh, far mesh, scatter) so it never costs one long frame.
            if (stage > 0)
            {
                var g = world.Grid;
                if (!g.LoadedRect(out Vector4 r2)) { stage = 0; return; }
                if (stage == 1) BuildLevel(g, r2, cx0, cz0, Mathf.RoundToInt(halfExtent * 2f / cell), cell, new Vector4(fx0, fz0, fx1, fz1), ref coarse, ref coarseGo, "horizon ring (far)", false);
                else if (scatter) BuildScatter(g, r2, ccx, ccz);
                stage = stage == 1 ? 2 : 0;
                return;
            }
            if (Time.unscaledTime < next) return;
            next = Time.unscaledTime + 0.4f;
            var grid = world.Grid;
            if (!grid.LoadedRect(out Vector4 rect)) return;
            Vector3 f = world.FocusPoint;
            var centre = new Vector2Int(Mathf.RoundToInt(f.x / snap), Mathf.RoundToInt(f.z / snap));
            string mapId = world.Mirror?.map?.id ?? "";
            if (grid.Version == lastVersion && centre == lastCentre && mapId == lastMap) return;
            lastVersion = grid.Version; lastCentre = centre; lastMap = mapId;
            seed = Hash.Str(mapId);
            ccx = centre.x * snap; ccz = centre.y * snap;
            // The fine mesh covers [fx0, fx1] x [fz0, fz1]; the coarse mesh leaves that window out.
            fx0 = Mathf.Round((ccx - innerHalf) / cell) * cell; fz0 = Mathf.Round((ccz - innerHalf) / cell) * cell;
            fx1 = fx0 + innerHalf * 2f; fz1 = fz0 + innerHalf * 2f;
            cx0 = Mathf.Round((ccx - halfExtent) / cell) * cell; cz0 = Mathf.Round((ccz - halfExtent) / cell) * cell;
            BuildLevel(grid, rect, fx0, fz0, Mathf.RoundToInt(innerHalf * 2f / innerCell), innerCell, null, ref fine, ref fineGo, "horizon ring (near)", true);
            stage = 1;
        }

        int stage;
        float ccx, ccz, fx0, fz0, fx1, fz1, cx0, cz0;

        int Salt(int k) => (int)(seed & 0x7fffff) + k * 131;

        // ------------------------------------------------------------------------------------------------------
        void BuildLevel(TileGrid grid, Vector4 rect, float x0, float z0, int n, float cellSize, Vector4? hole, ref Mesh mesh, ref GameObject go, string name, bool isFine)
        {
            int vn = n + 1;
            var h = new float[vn * vn];
            var dist = new float[vn * vn];
            var xs = new float[vn * vn];
            var zs = new float[vn * vn];
            var edges = new float[vn * vn];
            for (int j = 0; j < vn; j++)
                for (int i = 0; i < vn; i++)
                {
                    float x = x0 + i * cellSize, z = z0 + j * cellSize;
                    float dx = Mathf.Max(rect.x - x, 0f, x - rect.z), dz = Mathf.Max(rect.y - z, 0f, z - rect.w);
                    float d = Mathf.Sqrt(dx * dx + dz * dz);
                    if (d <= 0f)
                    {
                        // Inside the loaded land: pull the vertex out to the land's edge, so the ring meets the real ground exactly.
                        float el = x - rect.x, er = rect.z - x, et = z - rect.y, eb = rect.w - z;
                        float em = Mathf.Min(Mathf.Min(el, er), Mathf.Min(et, eb));
                        const float tuck = 0.8f;   // a little under the edge, so no crack opens between the ring and the ground's lip
                        if (em == el) x = rect.x + tuck; else if (em == er) x = rect.z - tuck; else if (em == et) z = rect.y + tuck; else z = rect.w - tuck;
                    }
                    xs[j * vn + i] = x; zs[j * vn + i] = z;
                    dist[j * vn + i] = d;
                    h[j * vn + i] = HeightAt(grid, rect, x, z, d, out edges[j * vn + i]);
                }

            if (isFine)
            {
                // The window's border vertices between coarse lattice points lie on the straight line between them, so the
                // coarse mesh (which has only the lattice points) meets this one without a crack.
                int ratio = Mathf.RoundToInt(cell / cellSize);
                for (int k = 0; k < vn; k++)
                    if (k % ratio != 0)
                    {
                        int k0 = k - k % ratio, k1 = Mathf.Min(k0 + ratio, n);
                        float u = (k - k0) / (float)(k1 - k0);
                        h[k] = Mathf.Lerp(h[k0], h[k1], u);                                   // j = 0 row
                        h[n * vn + k] = Mathf.Lerp(h[n * vn + k0], h[n * vn + k1], u);        // j = n row
                        h[k * vn] = Mathf.Lerp(h[k0 * vn], h[k1 * vn], u);                    // i = 0 column
                        h[k * vn + n] = Mathf.Lerp(h[k0 * vn + n], h[k1 * vn + n], u);        // i = n column
                    }
            }

            var verts = new Vector3[vn * vn];
            var norms = new Vector3[vn * vn];
            var cols = new Color[vn * vn];
            for (int j = 0; j < vn; j++)
                for (int i = 0; i < vn; i++)
                {
                    int k = j * vn + i;
                    float hl = h[j * vn + Mathf.Max(i - 1, 0)], hr = h[j * vn + Mathf.Min(i + 1, n)];
                    float hd = h[Mathf.Max(j - 1, 0) * vn + i], hu = h[Mathf.Min(j + 1, n) * vn + i];
                    var nrm = new Vector3(-(hr - hl) / (2f * cellSize), 1f, -(hu - hd) / (2f * cellSize)).normalized;
                    verts[k] = new Vector3(xs[k], h[k], zs[k]);
                    norms[k] = nrm;
                    cols[k] = Pal.Vtx(ColourAt(xs[k], zs[k], h[k], edges[k], 1f - nrm.y, dist[k]));
                }
            var tris = new int[n * n * 6];
            int t = 0;
            for (int j = 0; j < n; j++)
                for (int i = 0; i < n; i++)
                {
                    int a = j * vn + i, b = a + 1, c = a + vn + 1, d = a + vn;
                    // skip cells wholly under the loaded land
                    if (dist[a] <= 0f && dist[b] <= 0f && dist[c] <= 0f && dist[d] <= 0f) continue;
                    if (hole.HasValue)
                    {
                        // skip cells wholly inside the fine mesh's window
                        var hr = hole.Value;
                        float cx0 = x0 + i * cellSize, cz0 = z0 + j * cellSize;
                        if (cx0 >= hr.x - 0.01f && cx0 + cellSize <= hr.z + 0.01f && cz0 >= hr.y - 0.01f && cz0 + cellSize <= hr.w + 0.01f) continue;
                    }
                    if (((i + j) & 1) == 0) { tris[t++] = a; tris[t++] = d; tris[t++] = c; tris[t++] = a; tris[t++] = c; tris[t++] = b; }
                    else { tris[t++] = a; tris[t++] = d; tris[t++] = b; tris[t++] = d; tris[t++] = c; tris[t++] = b; }
                }
            System.Array.Resize(ref tris, t);

            if (mesh == null) mesh = new Mesh { name = name, indexFormat = UnityEngine.Rendering.IndexFormat.UInt32 };
            mesh.Clear();
            mesh.vertices = verts; mesh.normals = norms; mesh.colors = cols;
            mesh.SetTriangles(tris, 0, true);
            if (go == null)
            {
                go = new GameObject(name);
                go.transform.SetParent(world.transform, false);
                go.AddComponent<MeshFilter>().sharedMesh = mesh;
                var mr = go.AddComponent<MeshRenderer>();
                mr.sharedMaterial = Mats.Ground();
                mr.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
                mr.receiveShadows = false;
            }
        }

        // ------------------------------------------------------------------------------------------------------
        float HeightAt(TileGrid grid, Vector4 rect, float x, float z, float d) => HeightAt(grid, rect, x, z, d, out _);

        float HeightAt(TileGrid grid, Vector4 rect, float x, float z, float d, out float edge)
        {
            // Nearest point of the loaded land, and the land's own height and slope there.
            float qx = Mathf.Clamp(x, rect.x, rect.z), qz = Mathf.Clamp(z, rect.y, rect.w);
            edge = grid.GroundY(qx, qz);
            float ext = 0f;
            if (d > 0f)
            {
                var outward = new Vector2(x - qx, z - qz) / d;
                const float probe = 14f;
                float px = Mathf.Clamp(qx - outward.x * probe, rect.x, rect.z), pz = Mathf.Clamp(qz - outward.y * probe, rect.y, rect.w);
                float run = Mathf.Max(1f, Mathf.Sqrt((qx - px) * (qx - px) + (qz - pz) * (qz - pz)));
                float g = Mathf.Clamp((edge - grid.GroundY(px, pz)) / run, -0.4f, 0.4f);
                const float L = 70f;   // the slope carries on for about this far, then the land is level-ish
                ext = g * L * (1f - Mathf.Exp(-d / L));
            }
            float n1 = N2(x, z, 520f, Salt(1)), n2 = N2(x, z, 190f, Salt(2)), n3 = N2(x, z, 75f, Salt(3)), n4 = N2(x, z, 30f, Salt(4));
            float roll = 26f * (n2 - 0.3f) + 6f * (n3 - 0.5f) + 2f * (n4 - 0.5f);
            float ridge = 1f - (n2 * 2f - 1f) * (n2 * 2f - 1f);   // smooth (an abs() here made a sharp crease)
            float peaks = Smooth(0.30f, 0.80f, n1) * (120f + 80f * ridge + 30f * n3);
            float near = Smooth(10f, 260f, d);
            float far = Smooth(120f, 620f, d);
            // Near the land the ring is the edge's own profile; farther out the edge's stripes (which would crease along the
            // rectangle's extension lines) give way to the land's overall height, which then eases down toward the lowlands.
            float mid = grid.GroundY((rect.x + rect.z) * 0.5f, (rect.y + rect.w) * 0.5f);
            float baseH = Mathf.Lerp(Mathf.Lerp(edge, mid, Smooth(30f, 320f, d)), mid * 0.5f + 6f, Smooth(300f, 1000f, d));
            ext *= 1f - Smooth(90f, 320f, d);
            return baseH + ext + roll * near + peaks * far;
        }

        /// <summary>Value noise averaged with a rotated, slightly larger copy of itself: no lattice-aligned creases in the hills.</summary>
        static float N2(float x, float z, float cell, int salt)
        {
            const float c = 0.8f, sn = 0.6f;   // 37 degrees
            return 0.5f * (GroundLook.Noise(x, z, cell, salt) + GroundLook.Noise(x * c - z * sn + 1234f, x * sn + z * c - 777f, cell * 1.13f, salt + 7));
        }

        static float Smooth(float a, float b, float x) { float t = Mathf.Clamp01((x - a) / (b - a)); return t * t * (3f - 2f * t); }

        static Color ColourAt(float x, float z, float y, float edgeY, float slope, float d)
        {
            // Heights are relative to the loaded land's edge (the whole world may stand at any elevation).
            // Foothills use the meadow's colours (the very function the patches use); higher up olive woods, then slate rock and pale caps.
            float rel = y - edgeY;
            Color meadow = GroundLook.Surface(0, x, z, slope * 0.3f * (1f - Smooth(60f, 200f, d)), Mathf.Min(y, edgeY + 12f));
            Color wood = Pal.Rgb(0x66845a), rock = Pal.Rgb(0x9a9088), cap = Pal.Rgb(0xe9eef3);
            float woodT = Smooth(30f, 80f, rel), rockT = Smooth(95f, 140f, rel) + Smooth(0.22f, 0.45f, slope) * 0.7f, capT = Smooth(150f, 190f, rel) * (1f - Smooth(0.35f, 0.6f, slope));
            Color c = Color.Lerp(meadow, wood, woodT);
            c = Color.Lerp(c, rock, Mathf.Clamp01(rockT));
            c = Color.Lerp(c, cap, capT);
            return c;
        }

        // ------------------------------------------------------------------------------------------------------
        // Trees, bushes and rocks: world-fixed cells, one candidate each (deterministic), baked into a few combined meshes.
        const int Chunk = 128;

        void BuildScatter(TileGrid grid, Vector4 rect, float cx, float cz)
        {
            ClearProps();
            if (props == null) props = new PropLibrary { lowDetail = true };
            var builders = new Dictionary<Vector2Int, MeshBuilder>();
            float sc = scatterCell, r = scatterRadius;
            int i0 = Mathf.FloorToInt((cx - r) / sc), i1 = Mathf.CeilToInt((cx + r) / sc), j0 = Mathf.FloorToInt((cz - r) / sc), j1 = Mathf.CeilToInt((cz + r) / sc);
            for (int j = j0; j <= j1; j++)
                for (int i = i0; i <= i1; i++)
                {
                    float x = (i + 0.15f + 0.7f * Hash.F(i, j, Salt(11))) * sc, z = (j + 0.15f + 0.7f * Hash.F(i, j, Salt(12))) * sc;
                    float dc = Mathf.Sqrt((x - cx) * (x - cx) + (z - cz) * (z - cz));
                    if (dc > r) continue;
                    float dx = Mathf.Max(rect.x - x, 0f, x - rect.z), dz = Mathf.Max(rect.y - z, 0f, z - rect.w);
                    float d = Mathf.Sqrt(dx * dx + dz * dz);
                    if (d < 1.5f) continue;
                    // density: forest patches (rich), open meadow with the odd tree (sparse); thins with distance and with altitude
                    float forest = Smooth(0.52f, 0.68f, GroundLook.Noise(x, z, 95f, Salt(13)) * 0.7f + GroundLook.Noise(x, z, 33f, Salt(14)) * 0.3f);
                    float dens = Mathf.Lerp(0.11f, 0.6f, forest) * (1f - Smooth(220f, 560f, d)) * Mathf.Min(1f, d / 6f);
                    float pick = Hash.F(i, j, Salt(15));
                    if (pick > dens) continue;
                    float y = HeightAt(grid, rect, x, z, d, out float edgeY);
                    if (pick > dens * (1f - Smooth(30f, 55f, y - edgeY))) continue;   // fewer trees up the slopes
                    float hl = HeightAt(grid, rect, x - 3f, z, Mathf.Max(d - 3f, 0.1f)), hr = HeightAt(grid, rect, x + 3f, z, d + 3f);
                    if (Mathf.Abs(hr - hl) > 3.2f) continue;      // too steep for trees
                    float kind = Hash.F(i, j, Salt(16));
                    string id = kind < (forest > 0.5f ? 0.82f : 0.52f) ? "props/tree" : kind < 0.88f ? "props/bush" : "props/rock";
                    uint v = Hash.H(i, j, Salt(17));
                    var src = props.Get(id, v);
                    if (src == null) continue;
                    float scale = Mathf.Lerp(0.9f, 1.5f, Hash.F(i, j, Salt(18))) * (id == "props/tree" ? Mathf.Lerp(1f, 1.5f, Smooth(40f, 300f, d)) : 1f);
                    float j1c = (Hash.F(i, j, Salt(19)) - 0.5f) * 0.16f, j2c = (Hash.F(i, j, Salt(20)) - 0.5f) * 0.16f, j3c = (Hash.F(i, j, Salt(21)) - 0.5f) * 0.16f;
                    var key = new Vector2Int(Mathf.FloorToInt(x / Chunk), Mathf.FloorToInt(z / Chunk));
                    if (!builders.TryGetValue(key, out var mb)) { mb = new MeshBuilder(); builders[key] = mb; }
                    mb.Append(src, Matrix4x4.TRS(new Vector3(x, y - 0.12f, z), Quaternion.Euler(0f, Hash.F(i, j, Salt(22)) * 360f, 0f), Vector3.one * scale), new Color(1f + j1c, 1f + j2c, 1f + j3c, 1f));
                }
            foreach (var kv in builders)
            {
                var m = kv.Value.ToMesh("ring props " + kv.Key);
                m.RecalculateBounds();
                var g = new GameObject("ring props");
                g.transform.SetParent(world.transform, false);
                g.AddComponent<MeshFilter>().sharedMesh = m;
                var mr = g.AddComponent<MeshRenderer>();
                mr.sharedMaterial = Mats.Toon();
                mr.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
                mr.receiveShadows = false;
                propGos.Add(g); propMeshes.Add(m);
            }
        }
    }
}
