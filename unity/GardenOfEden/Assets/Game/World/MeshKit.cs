// Procedural mesh building: a MeshBuilder collects flat-shaded, vertex-coloured triangles (chunky low-poly look) from
// a few primitives (box, frustum, spike, blob) and turns them into a Mesh. Everything the world draws with no art yet
// is made from this. Winding is never trusted: every face is given an "outward" direction and flipped to match it.
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering;

namespace GardenOfEden.World
{
    public sealed class MeshBuilder
    {
        public readonly List<Vector3> V = new List<Vector3>();
        public readonly List<Vector3> N = new List<Vector3>();
        public readonly List<Color> C = new List<Color>();
        public readonly List<Vector2> UV = new List<Vector2>();
        public readonly List<int> T = new List<int>();

        Matrix4x4 m = Matrix4x4.identity;
        Matrix4x4 mn = Matrix4x4.identity;
        bool hasM;

        public int VertexCount => V.Count;

        /// <summary>Everything added after this is transformed by <paramref name="mat"/> (until ResetTransform).</summary>
        public void SetTransform(Matrix4x4 mat)
        {
            m = mat;
            mn = mat.inverse.transpose;
            hasM = true;
        }

        public void ResetTransform()
        {
            m = Matrix4x4.identity;
            mn = Matrix4x4.identity;
            hasM = false;
        }

        public void Clear()
        {
            V.Clear(); N.Clear(); C.Clear(); UV.Clear(); T.Clear();
            ResetTransform();
        }

        Vector3 P(Vector3 p) => hasM ? m.MultiplyPoint3x4(p) : p;
        Vector3 Nrm(Vector3 n) => hasM ? mn.MultiplyVector(n).normalized : n;

        int Vert(Vector3 p, Vector3 n, Color c)
        {
            V.Add(P(p));
            N.Add(Nrm(n));
            C.Add(Pal.Vtx(c));
            UV.Add(Vector2.zero);
            return V.Count - 1;
        }

        // ---- faces ----

        public void Tri(Vector3 a, Vector3 b, Vector3 c, Color col, Vector3 outward)
        {
            Vector3 n = Vector3.Cross(b - a, c - a);
            if (n.sqrMagnitude < 1e-12f) return;
            if (Vector3.Dot(n, outward) < 0f) { var t = b; b = c; c = t; n = -n; }
            n.Normalize();
            int i = Vert(a, n, col);
            Vert(b, n, col);
            Vert(c, n, col);
            T.Add(i); T.Add(i + 1); T.Add(i + 2);
        }

        public void Quad(Vector3 a, Vector3 b, Vector3 c, Vector3 d, Color col, Vector3 outward)
        {
            Vector3 n = Vector3.Cross(c - a, d - b);
            if (n.sqrMagnitude < 1e-12f) return;
            if (Vector3.Dot(n, outward) < 0f) { var t = b; b = d; d = t; n = -n; }
            n.Normalize();
            int i = Vert(a, n, col);
            Vert(b, n, col);
            Vert(c, n, col);
            Vert(d, n, col);
            T.Add(i); T.Add(i + 1); T.Add(i + 2);
            T.Add(i); T.Add(i + 2); T.Add(i + 3);
        }

        // ---- primitives ----

        public void Box(Vector3 min, Vector3 max, Color col, bool bottom = false) => Box(min, max, col, col, bottom);

        public void Box(Vector3 min, Vector3 max, Color col, Color top, bool bottom = false)
        {
            float x0 = min.x, y0 = min.y, z0 = min.z, x1 = max.x, y1 = max.y, z1 = max.z;
            if (x1 <= x0 || y1 <= y0 || z1 <= z0) return;
            Quad(new Vector3(x0, y0, z0), new Vector3(x0, y0, z1), new Vector3(x0, y1, z1), new Vector3(x0, y1, z0), Pal.Mul(col, 0.92f), Vector3.left);
            Quad(new Vector3(x1, y0, z0), new Vector3(x1, y0, z1), new Vector3(x1, y1, z1), new Vector3(x1, y1, z0), Pal.Mul(col, 0.96f), Vector3.right);
            Quad(new Vector3(x0, y0, z0), new Vector3(x1, y0, z0), new Vector3(x1, y1, z0), new Vector3(x0, y1, z0), Pal.Mul(col, 0.94f), Vector3.back);
            Quad(new Vector3(x0, y0, z1), new Vector3(x1, y0, z1), new Vector3(x1, y1, z1), new Vector3(x0, y1, z1), col, Vector3.forward);
            Quad(new Vector3(x0, y1, z0), new Vector3(x1, y1, z0), new Vector3(x1, y1, z1), new Vector3(x0, y1, z1), top, Vector3.up);
            if (bottom) Quad(new Vector3(x0, y0, z0), new Vector3(x1, y0, z0), new Vector3(x1, y0, z1), new Vector3(x0, y0, z1), Pal.Mul(col, 0.7f), Vector3.down);
        }

        public void BoxC(Vector3 centre, Vector3 size, Color col) => Box(centre - size * 0.5f, centre + size * 0.5f, col);

        /// <summary>A cone or cylinder standing on <paramref name="baseCentre"/> (vertical). rTop 0 gives a point.</summary>
        public void Frustum(Vector3 baseCentre, float rBottom, float rTop, float height, int seg, Color col, bool capTop = true, float rotDeg = 0f, bool capBottom = false)
        {
            seg = Mathf.Max(3, seg);
            Vector3 topC = baseCentre + Vector3.up * height;
            float rot = rotDeg * Mathf.Deg2Rad;
            for (int i = 0; i < seg; i++)
            {
                float a0 = rot + i * Mathf.PI * 2f / seg, a1 = rot + (i + 1) * Mathf.PI * 2f / seg;
                Vector3 d0 = new Vector3(Mathf.Cos(a0), 0, Mathf.Sin(a0)), d1 = new Vector3(Mathf.Cos(a1), 0, Mathf.Sin(a1));
                Vector3 mid = (d0 + d1).normalized;
                Vector3 b0 = baseCentre + d0 * rBottom, b1 = baseCentre + d1 * rBottom;
                Vector3 t0 = topC + d0 * rTop, t1 = topC + d1 * rTop;
                float shade = 0.88f + 0.12f * Mathf.Max(0f, Vector3.Dot(mid, new Vector3(0.4f, 0, 0.9f).normalized));
                Color sc = Pal.Mul(col, shade);
                if (rTop <= 0.0001f) Tri(b0, b1, topC, sc, mid + Vector3.up * 0.4f);
                else Quad(b0, b1, t1, t0, sc, mid);
                if (capTop && rTop > 0.0001f) Tri(topC, t0, t1, Pal.Mul(col, 1.08f), Vector3.up);
                if (capBottom) Tri(baseCentre, b0, b1, Pal.Mul(col, 0.7f), Vector3.down);
            }
        }

        /// <summary>A thin cone from a base point to an apex (reeds, leaves, thorns).</summary>
        public void Spike(Vector3 baseCentre, Vector3 apex, float radius, Color col, int seg = 3)
        {
            Vector3 axis = apex - baseCentre;
            if (axis.sqrMagnitude < 1e-8f) return;
            Vector3 ax = axis.normalized;
            Vector3 u = Vector3.Cross(ax, Mathf.Abs(ax.y) > 0.9f ? Vector3.right : Vector3.up).normalized;
            Vector3 v = Vector3.Cross(ax, u);
            for (int i = 0; i < seg; i++)
            {
                float a0 = i * Mathf.PI * 2f / seg, a1 = (i + 1) * Mathf.PI * 2f / seg;
                Vector3 p0 = baseCentre + (u * Mathf.Cos(a0) + v * Mathf.Sin(a0)) * radius;
                Vector3 p1 = baseCentre + (u * Mathf.Cos(a1) + v * Mathf.Sin(a1)) * radius;
                Vector3 mid = (p0 + p1) * 0.5f - baseCentre;
                Tri(p0, p1, apex, Pal.Mul(col, 0.9f + 0.2f * (i % 2)), mid);
            }
        }

        /// <summary>A faceted lumpy ellipsoid (canopies, rocks, bushes, heads). Colour gets lighter towards the top.</summary>
        public void Blob(Vector3 centre, Vector3 radii, Color col, int seg = 7, int rings = 4, float jitter = 0f, int seed = 0, float gradient = 0.22f)
        {
            seg = Mathf.Max(3, seg);
            rings = Mathf.Max(2, rings);
            var pts = new Vector3[(rings + 1) * seg];
            for (int r = 0; r <= rings; r++)
            {
                float phi = Mathf.PI * r / rings;
                for (int s = 0; s < seg; s++)
                {
                    float th = Mathf.PI * 2f * s / seg;
                    float k = 1f;
                    if (jitter > 0f && r > 0 && r < rings) k += jitter * (Hash.F(seed, r, s) - 0.5f) * 2f;
                    pts[r * seg + s] = centre + new Vector3(radii.x * Mathf.Sin(phi) * Mathf.Cos(th), radii.y * Mathf.Cos(phi), radii.z * Mathf.Sin(phi) * Mathf.Sin(th)) * k;
                }
            }
            for (int r = 0; r < rings; r++)
            {
                for (int s = 0; s < seg; s++)
                {
                    int s2 = (s + 1) % seg;
                    Vector3 a = pts[r * seg + s], b = pts[r * seg + s2], c = pts[(r + 1) * seg + s2], d = pts[(r + 1) * seg + s];
                    Vector3 mid = (a + b + c + d) * 0.25f;
                    float t = Mathf.Clamp01(((mid.y - centre.y) / Mathf.Max(0.001f, radii.y) + 1f) * 0.5f);
                    Color fc = Pal.Mul(col, 1f - gradient * 0.5f + gradient * t);
                    if (r == 0) Tri(a, c, d, fc, mid - centre);
                    else if (r == rings - 1) Tri(a, b, c, fc, mid - centre);
                    else Quad(a, b, c, d, fc, mid - centre);
                }
            }
        }

        // ---- soft (smooth-shaded) primitives: the G8 look for foliage and rocks ----

        static readonly Dictionary<int, (Vector3[] v, int[] t)> icoCache = new Dictionary<int, (Vector3[], int[])>();

        /// <summary>A unit icosphere with shared vertices (subdiv 0 = 12 verts, 1 = 42, 2 = 162).</summary>
        static (Vector3[] v, int[] t) Ico(int subdiv)
        {
            if (icoCache.TryGetValue(subdiv, out var c)) return c;
            float g = (1f + Mathf.Sqrt(5f)) * 0.5f;
            var vs = new List<Vector3>
            {
                new Vector3(-1, g, 0), new Vector3(1, g, 0), new Vector3(-1, -g, 0), new Vector3(1, -g, 0),
                new Vector3(0, -1, g), new Vector3(0, 1, g), new Vector3(0, -1, -g), new Vector3(0, 1, -g),
                new Vector3(g, 0, -1), new Vector3(g, 0, 1), new Vector3(-g, 0, -1), new Vector3(-g, 0, 1),
            };
            for (int i = 0; i < vs.Count; i++) vs[i] = vs[i].normalized;
            var ts = new List<int> { 0,11,5, 0,5,1, 0,1,7, 0,7,10, 0,10,11, 1,5,9, 5,11,4, 11,10,2, 10,7,6, 7,1,8,
                                     3,9,4, 3,4,2, 3,2,6, 3,6,8, 3,8,9, 4,9,5, 2,4,11, 6,2,10, 8,6,7, 9,8,1 };
            for (int s = 0; s < subdiv; s++)
            {
                var mid = new Dictionary<long, int>();
                int Mid(int a, int b)
                {
                    long k = a < b ? ((long)a << 32) | (uint)b : ((long)b << 32) | (uint)a;
                    if (mid.TryGetValue(k, out int r)) return r;
                    vs.Add(((vs[a] + vs[b]) * 0.5f).normalized);
                    mid[k] = vs.Count - 1;
                    return vs.Count - 1;
                }
                var nt = new List<int>(ts.Count * 4);
                for (int i = 0; i < ts.Count; i += 3)
                {
                    int a = ts[i], b = ts[i + 1], cc = ts[i + 2];
                    int ab = Mid(a, b), bc = Mid(b, cc), ca = Mid(cc, a);
                    nt.AddRange(new[] { a, ab, ca, b, bc, ab, cc, ca, bc, ab, bc, ca });
                }
                ts = nt;
            }
            c = (vs.ToArray(), ts.ToArray());
            icoCache[subdiv] = c;
            return c;
        }

        /// <summary>
        /// A smooth lumpy ellipsoid with shared vertices and soft normals (leaves, bushes, rocks). The normals lean toward
        /// pointing away from <paramref name="normalCentre"/> by <paramref name="bend"/>, so several blobs round one centre
        /// shade as one soft mass. Colour: darker underneath, lighter on top. UV0.x is the wind sway weight, rising from
        /// <paramref name="swayFrom"/> to <paramref name="swayTo"/> (metres, local Y) up to <paramref name="swayMax"/>.
        /// </summary>
        public void SoftBlob(Vector3 centre, Vector3 radii, Color col, int subdiv, float jitter, int seed, Vector3 normalCentre, float bend,
                             float swayFrom = 0f, float swayTo = 1f, float swayMax = 0f, float flattenBottom = -2f, Color? topCol = null, float gradient = 0.34f)
        {
            var (uv, ut) = Ico(Mathf.Clamp(subdiv, 0, 3));
            int n = uv.Length;
            var pts = new Vector3[n];
            float p1 = Hash.F(seed, 1, 7) * 6.28f, p2 = Hash.F(seed, 2, 7) * 6.28f, p3 = Hash.F(seed, 3, 7) * 6.28f;
            for (int i = 0; i < n; i++)
            {
                Vector3 d = uv[i];
                float k = 1f;
                if (jitter > 0f)
                {
                    float nz = Mathf.Sin(d.x * 3.1f + p1) * 0.5f + Mathf.Sin(d.y * 2.7f + d.z * 1.3f + p2) * 0.35f + Mathf.Sin(d.z * 4.3f - d.x * 2.1f + p3) * 0.25f;
                    k += jitter * nz;
                }
                Vector3 p = new Vector3(d.x * radii.x, d.y * radii.y, d.z * radii.z) * k;
                if (p.y < flattenBottom * radii.y) p.y = Mathf.Lerp(p.y, flattenBottom * radii.y, 0.85f);
                pts[i] = centre + p;
            }
            var nrm = new Vector3[n];
            for (int i = 0; i < ut.Length; i += 3)
            {
                Vector3 fn = Vector3.Cross(pts[ut[i + 1]] - pts[ut[i]], pts[ut[i + 2]] - pts[ut[i]]);
                nrm[ut[i]] += fn; nrm[ut[i + 1]] += fn; nrm[ut[i + 2]] += fn;
            }
            int b0 = V.Count;
            Color top = topCol ?? Pal.Mul(col, 1f + gradient * 0.5f);
            Color bot = Pal.Mul(col, 1f - gradient * 0.6f);
            for (int i = 0; i < n; i++)
            {
                Vector3 geo = nrm[i].sqrMagnitude > 1e-12f ? nrm[i].normalized : uv[i];
                Vector3 rad = (pts[i] - normalCentre);
                rad = rad.sqrMagnitude > 1e-8f ? rad.normalized : geo;
                Vector3 nn = Vector3.Slerp(geo, rad, bend).normalized;
                float t = Mathf.Clamp01(nn.y * 0.5f + 0.5f);
                Color cc = Color.Lerp(bot, top, t * t * (3f - 2f * t));
                V.Add(P(pts[i]));
                N.Add(Nrm(nn));
                C.Add(Pal.Vtx(cc));
                float w = swayMax > 0f ? swayMax * Mathf.Clamp01((pts[i].y - swayFrom) / Mathf.Max(0.01f, swayTo - swayFrom)) : 0f;
                UV.Add(new Vector2(w, 0f));
            }
            for (int i = 0; i < ut.Length; i += 3) { T.Add(b0 + ut[i]); T.Add(b0 + ut[i + 1]); T.Add(b0 + ut[i + 2]); }
        }

        /// <summary>A smooth-shaded tapered cylinder or cone between two points (trunks, branches, conifer tiers).</summary>
        public void SoftTube(Vector3 a, Vector3 b, float ra, float rb, int seg, Color colA, Color colB, float swayA = 0f, float swayB = 0f, bool capTop = false)
        {
            seg = Mathf.Max(3, seg);
            Vector3 ax = b - a;
            if (ax.sqrMagnitude < 1e-8f) return;
            Vector3 axn = ax.normalized;
            Vector3 u = Vector3.Cross(axn, Mathf.Abs(axn.y) > 0.9f ? Vector3.right : Vector3.up).normalized;
            Vector3 v = Vector3.Cross(axn, u);
            float len = ax.magnitude;
            float slopeN = (ra - rb) / len;   // normals tilt up on a taper
            int b0 = V.Count;
            for (int ring = 0; ring < 2; ring++)
            {
                Vector3 c = ring == 0 ? a : b;
                float r = ring == 0 ? ra : rb;
                Color col = ring == 0 ? colA : colB;
                for (int i = 0; i <= seg; i++)
                {
                    float an = i * Mathf.PI * 2f / seg;
                    Vector3 dir = u * Mathf.Cos(an) + v * Mathf.Sin(an);
                    V.Add(P(c + dir * r));
                    N.Add(Nrm((dir + axn * slopeN).normalized));
                    C.Add(Pal.Vtx(col));
                    UV.Add(new Vector2(ring == 0 ? swayA : swayB, 0f));
                }
            }
            for (int i = 0; i < seg; i++)
            {
                int i0 = b0 + i, i1 = b0 + i + 1, j0 = b0 + seg + 1 + i, j1 = b0 + seg + 2 + i;
                T.Add(i0); T.Add(i1); T.Add(j0);
                T.Add(i1); T.Add(j1); T.Add(j0);
            }
            if (capTop && rb > 0.001f)
            {
                int ci = V.Count;
                V.Add(P(b)); N.Add(Nrm(axn)); C.Add(Pal.Vtx(colB)); UV.Add(new Vector2(swayB, 0f));
                for (int i = 0; i < seg; i++) { T.Add(ci); T.Add(b0 + seg + 1 + i); T.Add(b0 + seg + 2 + i); }
            }
        }

        /// <summary>Set the wind sway weight (UV0.x) of every vertex added since <paramref name="from"/> by its height.</summary>
        public void SwayByHeight(int from, float y0, float y1, float max)
        {
            for (int i = from; i < V.Count; i++)
                UV[i] = new Vector2(max * Mathf.Clamp01((V[i].y - y0) / Mathf.Max(0.01f, y1 - y0)), UV[i].y);
        }

        /// <summary>A flat ring on the ground (selection marker).</summary>
        public void Ring(Vector3 centre, float rIn, float rOut, int seg, Color col)
        {
            for (int i = 0; i < seg; i++)
            {
                float a0 = i * Mathf.PI * 2f / seg, a1 = (i + 1) * Mathf.PI * 2f / seg;
                Vector3 d0 = new Vector3(Mathf.Cos(a0), 0, Mathf.Sin(a0)), d1 = new Vector3(Mathf.Cos(a1), 0, Mathf.Sin(a1));
                Quad(centre + d0 * rIn, centre + d1 * rIn, centre + d1 * rOut, centre + d0 * rOut, col, Vector3.up);
            }
        }

        /// <summary>Copy another builder's geometry in, transformed, with a multiplicative colour tint.</summary>
        public void Append(MeshBuilder src, Matrix4x4 mat, Color tint)
        {
            int off = V.Count;
            Matrix4x4 nm = mat.inverse.transpose;
            for (int i = 0; i < src.V.Count; i++)
            {
                V.Add(P(mat.MultiplyPoint3x4(src.V[i])));
                N.Add(Nrm(nm.MultiplyVector(src.N[i]).normalized));
                Color c = src.C[i];
                C.Add(new Color(c.r * tint.r, c.g * tint.g, c.b * tint.b, 1f));
                UV.Add(src.UV[i]);
            }
            for (int i = 0; i < src.T.Count; i++) T.Add(src.T[i] + off);
        }

        public Mesh ToMesh(string name)
        {
            var mesh = new Mesh { name = name };
            if (V.Count > 65000) mesh.indexFormat = IndexFormat.UInt32;
            mesh.SetVertices(V);
            mesh.SetNormals(N);
            mesh.SetColors(C);
            mesh.SetUVs(0, UV);
            mesh.SetTriangles(T, 0, true);
            return mesh;
        }
    }

    /// <summary>Deterministic hashing so the same tile always looks the same on every run.</summary>
    public static class Hash
    {
        public static uint H(int a, int b, int c = 0)
        {
            unchecked
            {
                uint h = 2166136261u;
                h = (h ^ (uint)a) * 16777619u;
                h = (h ^ (uint)b) * 16777619u;
                h = (h ^ (uint)c) * 16777619u;
                h ^= h >> 15; h *= 0x2c1b3c6du; h ^= h >> 12; h *= 0x297a2d39u; h ^= h >> 15;
                return h;
            }
        }

        /// <summary>0..1</summary>
        public static float F(int a, int b, int c = 0) => (H(a, b, c) & 0xFFFFFF) / 16777216f;

        public static uint Str(string s)
        {
            unchecked
            {
                uint h = 2166136261u;
                if (s != null) foreach (char ch in s) h = (h ^ ch) * 16777619u;
                return h;
            }
        }
    }
}

namespace GardenOfEden.World
{
    /// <summary>Physics/render layers the world uses (created by Garden of Eden > Build Main Scene; 0 when missing).</summary>
    public static class WorldLayers
    {
        public const string BuildingName = "Building", PlayerName = "Player";
        static int building = -2, player = -2;
        public static int Building => building != -2 ? building : (building = Mathf.Max(0, LayerMask.NameToLayer(BuildingName)));
        public static int Player => player != -2 ? player : (player = Mathf.Max(0, LayerMask.NameToLayer(PlayerName)));
        public static int BuildingMask => Building == 0 ? 0 : 1 << Building;
        public static int PlayerMask => Player == 0 ? 0 : 1 << Player;
    }
}
