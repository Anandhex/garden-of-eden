// Builds what a patch looks like: a smooth vertex-coloured ground mesh, a flat water mesh, one combined props mesh
// (trees, rocks, furniture, crops, decor - one draw call), prefab overrides from the PropManifest, and the grass
// points handed to GrassField. A patch is rebuilt when a neighbour arrives (corner heights and colours blend across
// patch edges), a few per frame.
using System.Collections.Generic;
using UnityEngine;
using GardenOfEden.Net;

namespace GardenOfEden.World
{
    public sealed class PatchView
    {
        public string key;
        public Patch patch;
        public GameObject go;
        public Mesh ground, water, props, foliage;
        public MeshCollider collider;
        public readonly List<GameObject> prefabs = new List<GameObject>();
        /// <summary>Props that belong to a building (its door, stairs, awning...): drawn apart so they fade with it (see BuildingBuilder.AttachProps).</summary>
        public readonly List<KeyValuePair<int, MeshRenderer>> attached = new List<KeyValuePair<int, MeshRenderer>>();
        public readonly List<Mesh> attachedMeshes = new List<Mesh>();
        public readonly List<GardenOfEden.Look.GrassSpot> grass = new List<GardenOfEden.Look.GrassSpot>();
        /// <summary>A door or stairs here had no building yet (buildings stream in a narrower window than land): rebuild when buildings change.</summary>
        public bool orphanDoors;

        public void Destroy()
        {
            if (go != null) UnityEngine.Object.Destroy(go);
            if (ground != null) UnityEngine.Object.Destroy(ground);
            if (water != null) UnityEngine.Object.Destroy(water);
            if (props != null) UnityEngine.Object.Destroy(props);
            if (foliage != null) UnityEngine.Object.Destroy(foliage);
            foreach (var m in attachedMeshes) if (m != null) UnityEngine.Object.Destroy(m);
        }
    }

    public sealed class PatchBuilder
    {
        readonly WorldView world;
        readonly TileGrid grid;
        readonly Transform root;
        readonly PropLibrary library = new PropLibrary();
        public readonly Dictionary<string, PatchView> views = new Dictionary<string, PatchView>();

        public PatchBuilder(WorldView world, TileGrid grid, Transform root)
        {
            this.world = world;
            this.grid = grid;
            this.root = root;
        }

        public void Clear()
        {
            foreach (var v in views.Values) v.Destroy();
            views.Clear();
        }

        public void Remove(string key)
        {
            if (views.TryGetValue(key, out var v)) { v.Destroy(); views.Remove(key); }
        }

        public PatchView Build(Patch p)
        {
            string key = Mirror.PatchKey(p.x0, p.y0);
            Remove(key);
            var view = new PatchView { key = key, patch = p };
            view.go = new GameObject("patch " + key);
            view.go.transform.SetParent(root, false);
            views[key] = view;

            BuildGround(view);
            BuildWater(view);
            BuildProps(view);
            return view;
        }

        // ---------------------------------------------------------------- ground

        void BuildGround(PatchView view)
        {
            var p = view.patch;
            int w = p.w, h = p.h;
            float ts = WorldView.TileSize;
            // Shared vertices on a half-tile lattice (2w+1 by 2h+1): the colour is finer than the tiles and continuous,
            // the heights are the very same triangles GroundY uses, so feet and grass meet the mesh exactly.
            int vw = 2 * w + 1, vh = 2 * h + 1;
            var verts = new Vector3[vw * vh];
            var norms = new Vector3[vw * vh];
            var cols = new Color[vw * vh];
            const float d = 0.9f;
            for (int gz = 0; gz < vh; gz++)
            {
                for (int gx = 0; gx < vw; gx++)
                {
                    float wx = (p.x0 + gx * 0.5f) * ts, wz = (p.y0 + gz * 0.5f) * ts;
                    float y = grid.GroundY(wx, wz);
                    float dx = (grid.GroundY(wx + d, wz) - grid.GroundY(wx - d, wz)) / (2f * d);
                    float dz = (grid.GroundY(wx, wz + d) - grid.GroundY(wx, wz - d)) / (2f * d);
                    var n = new Vector3(-dx, 1f, -dz).normalized;
                    int vi = gz * vw + gx;
                    verts[vi] = new Vector3(wx, y, wz);
                    norms[vi] = n;

                    // The tiles that meet at this vertex: one inside a tile, two on an edge, four at a corner.
                    int tx0 = p.x0 + (gx >> 1) - ((gx & 1) == 0 ? 1 : 0), tx1 = p.x0 + (gx >> 1);
                    int tz0 = p.y0 + (gz >> 1) - ((gz & 1) == 0 ? 1 : 0), tz1 = p.y0 + (gz >> 1);
                    float slope = 1f - n.y;
                    Color acc = Color.black; int cnt = 0;
                    for (int tz = tz0; tz <= tz1; tz++)
                        for (int tx = tx0; tx <= tx1; tx++)
                        {
                            int g = grid.Ground(tx, tz);
                            if (g < 0) continue;
                            acc += GroundLook.Surface(g, wx, wz, slope, y); cnt++;
                        }
                    if (cnt == 0) acc = GroundLook.Surface(0, wx, wz, slope, y); else acc /= cnt;
                    acc.a = 1f;
                    cols[vi] = Pal.Vtx(acc);
                }
            }

            var tris = new List<int>(w * h * 24);
            for (int ty = 0; ty < h; ty++)
            {
                for (int tx = 0; tx < w; tx++)
                {
                    bool even = (((p.x0 + tx) + (p.y0 + ty)) & 1) == 0;
                    for (int sj = 0; sj < 2; sj++)
                        for (int si = 0; si < 2; si++)
                        {
                            int i = tx * 2 + si, j = ty * 2 + sj;
                            int a = j * vw + i, b = a + 1, c = a + vw + 1, dd = a + vw;
                            if (even) { tris.Add(a); tris.Add(dd); tris.Add(c); tris.Add(a); tris.Add(c); tris.Add(b); }
                            else { tris.Add(a); tris.Add(dd); tris.Add(b); tris.Add(dd); tris.Add(c); tris.Add(b); }
                        }
                }
            }

            // A skirt down from every edge of the loaded land (where no neighbouring patch has come): the horizon ring
            // meets the ground there, and no sky shows through a crack.
            var vl = new List<Vector3>(verts); var nl = new List<Vector3>(norms); var cl = new List<Color>(cols);
            void Skirt(bool missing, int count, System.Func<int, int> at, bool flip)
            {
                if (!missing) return;
                int b0 = vl.Count;
                for (int k = 0; k < count; k++)
                {
                    int vi = at(k);
                    vl.Add(verts[vi] + Vector3.down * 4f); nl.Add(norms[vi]); cl.Add(cols[vi]);
                }
                for (int k = 0; k < count - 1; k++)
                {
                    int a = at(k), b = at(k + 1), c = b0 + k + 1, d = b0 + k;
                    // both windings: the skirt shows from either side and never lets the sky through
                    tris.Add(a); tris.Add(b); tris.Add(c); tris.Add(a); tris.Add(c); tris.Add(d);
                    tris.Add(a); tris.Add(c); tris.Add(b); tris.Add(a); tris.Add(d); tris.Add(c);
                }
            }
            Skirt(!grid.Has(p.x0 - 1, p.y0), vh, k => k * vw, false);                 // west edge
            Skirt(!grid.Has(p.x0 + w, p.y0), vh, k => k * vw + vw - 1, true);         // east edge
            Skirt(!grid.Has(p.x0, p.y0 - 1), vw, k => k, true);                       // north edge
            Skirt(!grid.Has(p.x0, p.y0 + h), vw, k => (vh - 1) * vw + k, false);      // south edge

            var mesh = new Mesh { name = "ground " + view.key };
            mesh.SetVertices(vl);
            mesh.SetNormals(nl);
            mesh.SetColors(cl);
            mesh.SetTriangles(tris, 0, true);
            view.ground = mesh;

            var go = new GameObject("ground");
            go.transform.SetParent(view.go.transform, false);
            go.AddComponent<MeshFilter>().sharedMesh = mesh;
            var mr = go.AddComponent<MeshRenderer>();
            mr.sharedMaterial = Mats.Ground();
            mr.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            if (world.generateColliders) view.collider = go.AddComponent<MeshCollider>();
            if (view.collider != null) view.collider.sharedMesh = mesh;
        }

        // ---------------------------------------------------------------- water

        void BuildWater(PatchView view)
        {
            var p = view.patch;
            var verts = new List<Vector3>();
            var norms = new List<Vector3>();
            var uvs = new List<Vector2>();
            var tris = new List<int>();
            float ts = WorldView.TileSize;
            float y = WorldView.WaterY;
            for (int j = 0; j < p.h; j++)
            {
                for (int i = 0; i < p.w; i++)
                {
                    int g = grid.Ground(p.x0 + i, p.y0 + j);
                    if (!TileGrid.IsWaterLike(g)) continue;
                    float x0 = (p.x0 + i) * ts, z0 = (p.y0 + j) * ts, x1 = x0 + ts, z1 = z0 + ts;
                    int b = verts.Count;
                    verts.Add(new Vector3(x0, y, z0)); verts.Add(new Vector3(x1, y, z0)); verts.Add(new Vector3(x1, y, z1)); verts.Add(new Vector3(x0, y, z1));
                    for (int k = 0; k < 4; k++) { norms.Add(Vector3.up); uvs.Add(new Vector2(verts[b + k].x, verts[b + k].z) * 0.25f); }
                    tris.Add(b); tris.Add(b + 3); tris.Add(b + 2);
                    tris.Add(b); tris.Add(b + 2); tris.Add(b + 1);
                }
            }
            if (verts.Count == 0) return;
            var mesh = new Mesh { name = "water " + view.key };
            mesh.SetVertices(verts);
            mesh.SetNormals(norms);
            mesh.SetUVs(0, uvs);
            mesh.SetTriangles(tris, 0, true);
            view.water = mesh;
            var go = new GameObject("water");
            go.transform.SetParent(view.go.transform, false);
            go.AddComponent<MeshFilter>().sharedMesh = mesh;
            var mr = go.AddComponent<MeshRenderer>();
            mr.sharedMaterial = Mats.Water();
            mr.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            mr.receiveShadows = false;
        }

        // ---------------------------------------------------------------- props, decor, grass

        void BuildProps(PatchView view)
        {
            var p = view.patch;
            var mb = new MeshBuilder();
            var fb = new MeshBuilder();   // trees, bushes, reeds, flowers, crops: the swaying foliage material
            Dictionary<int, MeshBuilder> attached = null;
            float ts = WorldView.TileSize;
            for (int j = 0; j < p.h; j++)
            {
                for (int i = 0; i < p.w; i++)
                {
                    int tx = p.x0 + i, ty = p.y0 + j;
                    int idx = p.IndexOf(tx, ty);
                    int g = idx < p.ground.Length ? p.ground[idx] : 0;
                    int o = idx < p.objects.Length ? p.objects[idx] : 0;
                    string obj = ArtIds.Object(o);
                    if (obj != null)
                    {
                        var target = mb;
                        if (Attaches(obj))
                        {
                            int bid = world.BuildingIdAt(tx, ty);
                            if (bid >= 0)
                            {
                                if (attached == null) attached = new Dictionary<int, MeshBuilder>();
                                if (!attached.TryGetValue(bid, out target)) { target = new MeshBuilder(); attached[bid] = target; }
                            }
                            else if (obj == "buildings/door" || obj == "buildings/stairs")
                            {
                                // its house has not streamed in: no door frame standing alone in a field
                                view.orphanDoors = true;
                                continue;
                            }
                        }
                        if (target == mb && PropLibrary.IsFoliage(obj)) target = fb;
                        Place(view, target, obj, tx, ty, Hash.H(tx, ty, 1));
                        continue;
                    }

                    if (g == 6) { Place(view, fb, "props/crop", tx, ty, Hash.H(tx, ty, 2)); continue; }
                    if (g == 5)
                    {
                        if (Hash.F(tx, ty, 3) < 0.22f) Place(view, fb, "props/reeds", tx, ty, Hash.H(tx, ty, 4));
                        continue;
                    }
                    if (g == 0 || g == 4)
                    {
                        float r = Hash.F(tx, ty, 6);
                        if (r < world.decorDensity && !world.BuildingNear(tx, ty))
                        {
                            float s = r / Mathf.Max(0.0001f, world.decorDensity);
                            string id = s < 0.5f ? "props/bush" : s < 0.85f ? "props/flowers" : "props/rock";
                            Place(view, PropLibrary.IsFoliage(id) ? fb : mb, id, tx, ty, Hash.H(tx, ty, 7));
                        }
                        if (world.grass != null && !world.BuildingNear(tx, ty)) AddGrass(view, tx, ty, g);
                    }
                }
            }
            if (attached != null)
                foreach (var kv in attached)
                {
                    if (kv.Value.VertexCount == 0) continue;
                    var am = kv.Value.ToMesh("building props " + kv.Key);
                    view.attachedMeshes.Add(am);
                    var ago = new GameObject("building props " + kv.Key);
                    ago.transform.SetParent(view.go.transform, false);
                    ago.layer = WorldLayers.Building;
                    ago.AddComponent<MeshFilter>().sharedMesh = am;
                    var amr = ago.AddComponent<MeshRenderer>();
                    amr.sharedMaterial = Mats.Toon();
                    view.attached.Add(new KeyValuePair<int, MeshRenderer>(kv.Key, amr));
                }
            if (mb.VertexCount > 0)
            {
                var mesh = mb.ToMesh("props " + view.key);
                view.props = mesh;
                var go = new GameObject("props");
                go.transform.SetParent(view.go.transform, false);
                go.AddComponent<MeshFilter>().sharedMesh = mesh;
                var mr = go.AddComponent<MeshRenderer>();
                mr.sharedMaterial = Mats.Toon();
            }
            if (fb.VertexCount > 0)
            {
                var mesh = fb.ToMesh("foliage " + view.key);
                mesh.bounds = new Bounds(mesh.bounds.center, mesh.bounds.size + new Vector3(1f, 0.5f, 1f));   // room for the sway
                view.foliage = mesh;
                var go = new GameObject("foliage");
                go.transform.SetParent(view.go.transform, false);
                go.AddComponent<MeshFilter>().sharedMesh = mesh;
                go.AddComponent<MeshRenderer>().sharedMaterial = Mats.Foliage();
            }
        }

        /// <summary>Props that belong to the building they stand at: its door, stairs, bar and thatch.</summary>
        static bool Attaches(string id) => id == "buildings/door" || id == "buildings/stairs" || id == "props/bar" || id == "props/thatch";

        void Place(PatchView view, MeshBuilder mb, string id, int tx, int ty, uint seed)
        {
            var pl = library.PlaceFor(id);
            float ts = WorldView.TileSize;
            float jx = pl.jitter > 0 ? (Hash.F((int)seed, 1) - 0.5f) * 2f * pl.jitter : 0f;
            float jz = pl.jitter > 0 ? (Hash.F((int)seed, 2) - 0.5f) * 2f * pl.jitter : 0f;
            float wx = (tx + 0.5f + jx) * ts, wz = (ty + 0.5f + jz) * ts;
            float y = pl.snapGround
                ? Mathf.Min(Mathf.Min(grid.Corner(tx, ty), grid.Corner(tx + 1, ty)), Mathf.Min(grid.Corner(tx, ty + 1), grid.Corner(tx + 1, ty + 1)))
                : world.GroundHeightAt(wx, wz);
            float yaw = pl.yaw ? Hash.F((int)seed, 3) * 360f : 0f;
            float scale = Mathf.Lerp(pl.scaleMin, pl.scaleMax, Hash.F((int)seed, 4));

            if (world.manifest != null && world.manifest.TryGet(id, out var e))
            {
                var inst = UnityEngine.Object.Instantiate(e.prefab, view.go.transform);
                inst.transform.position = new Vector3(wx, y, wz) + e.offset;
                inst.transform.rotation = Quaternion.Euler(0, e.randomYaw ? Hash.F((int)seed, 3) * 360f : 0f, 0);
                inst.transform.localScale = Vector3.one * (e.scale * scale);
                view.prefabs.Add(inst);
                return;
            }

            var src = library.Get(id, seed >> 4);
            if (src == null) return;
            float j1 = (Hash.F((int)seed, 5) - 0.5f) * 0.16f, j2 = (Hash.F((int)seed, 6) - 0.5f) * 0.16f, j3 = (Hash.F((int)seed, 7) - 0.5f) * 0.16f;
            var tint = pl.jitter > 0 ? new Color(1f + j1, 1f + j2, 1f + j3, 1f) : Color.white;
            mb.Append(src, Matrix4x4.TRS(new Vector3(wx, y, wz), Quaternion.Euler(0, yaw, 0), Vector3.one * scale), tint);
        }

        /// <summary>Clumps of grass on a grass tile: dense, none steeper than the ground can hold it, fewer where the tile meets a road or water.</summary>
        void AddGrass(PatchView view, int tx, int ty, int ground)
        {
            float perTile = world.grassClumpsPerTile;
            if (perTile <= 0f) return;
            float edge = 1f;
            for (int k = 0; k < 4; k++)
            {
                int g = grid.Ground(tx + (k == 0 ? -1 : k == 1 ? 1 : 0), ty + (k == 2 ? -1 : k == 3 ? 1 : 0));
                if (g >= 0 && g != 0 && g != 4 && g != 5) edge *= 0.72f;
            }
            float want = perTile * edge;
            int n = Mathf.FloorToInt(want);
            if (Hash.F(tx, ty, 93) < want - n) n++;
            float ts = WorldView.TileSize;
            for (int k = 0; k < n; k++)
            {
                float wx = (tx + Hash.F(tx * 31 + k, ty, 91)) * ts, wz = (ty + Hash.F(tx, ty * 31 + k, 92)) * ts;
                float y = world.GroundHeightAt(wx, wz);
                const float d = 0.6f;
                float dx = (world.GroundHeightAt(wx + d, wz) - world.GroundHeightAt(wx - d, wz)) / (2f * d);
                float dz = (world.GroundHeightAt(wx, wz + d) - world.GroundHeightAt(wx, wz - d)) / (2f * d);
                var nrm = new Vector3(-dx, 1f, -dz).normalized;
                float slope = 1f - nrm.y;
                if (slope > 0.2f && Hash.F(tx * 7 + k, ty, 94) < Mathf.Clamp01((slope - 0.2f) / 0.12f)) continue;   // too steep: bare earth and rock
                view.grass.Add(new GardenOfEden.Look.GrassSpot { position = new Vector3(wx, y, wz), normal = nrm, color = Pal.Vtx(GroundLook.Surface(ground, wx, wz, slope, y)) });
            }
        }
    }
}
