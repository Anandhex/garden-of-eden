// Buildings as massing (a port of iso/massing.ts + buildings.ts to real 3D): hollow walls with window and door
// cut-ins, a floor slab, pitched roof with overhang and roof tiles in bands, chimney, inn sign, timber framing - all
// chosen from the building's kind, template and id hash. A building is several parts so the interior can be shown:
//   Body (ground floor), Floor1..n (upper storeys, each with its ceiling slab), Roof (roof + chimney + gables),
//   Glow (lit window panes). When the player is inside, the roof and every storey above the player's floor hide.
// Stalls, tents, camps, carts, heaps and loot are small single meshes with no interior.
using System.Collections.Generic;
using UnityEngine;
using GardenOfEden.Net;

namespace GardenOfEden.World
{
    public sealed class BuildingHandle : MonoBehaviour
    {
        public int id;
        public Building data;
    }

    public sealed class BuildingView
    {
        public Building data;
        public string sig;
        public GameObject root;
        public GameObject roof, glow;
        public readonly List<GameObject> floors = new List<GameObject>();   // index 0 = floor 1
        public Collider collider;
        /// <summary>Every wall/roof renderer (not the glowing panes): what the occlusion fade drives.</summary>
        public readonly List<MeshRenderer> renderers = new List<MeshRenderer>();
        public MeshRenderer glowRenderer;
        /// <summary>Props that belong to this building (its door, stairs...), drawn with the patch but fading with it.</summary>
        public readonly List<MeshRenderer> attached = new List<MeshRenderer>();
        public Mesh[] meshes = new Mesh[0];
        public int floorCount = 1;
        /// <summary>World footprint box (x0, z0, x1, z1) used to keep walkers out of walls.</summary>
        public Vector4 box;
        public float top;
        public Vector3 chimney;
        public bool solid = true;
        bool inside;

        public void SetInside(bool value, int floor)
        {
            inside = value;
            if (roof != null) roof.SetActive(!value);
            for (int i = 0; i < floors.Count; i++) floors[i].SetActive(!value || i + 1 <= floor);
            if (collider != null) collider.enabled = !value;
        }

        public bool Inside => inside;
        public void SetLit(bool lit) { if (glow != null) glow.SetActive(lit); }

        // ---- occlusion fade (World/Occlusion.cs) ----
        static readonly int FadeId = Shader.PropertyToID("_Fade"), CutPlaneId = Shader.PropertyToID("_CutPlane"), CutFadeId = Shader.PropertyToID("_CutFade");
        static MaterialPropertyBlock block;
        float fade, cutFade;
        Vector4 cutPlane = new Vector4(0, 0, 0, 100000f);

        public float Fade => fade;
        public float CutFade => cutFade;
        public Vector4 CutPlane => cutPlane;

        /// <summary>Dither the whole building by <paramref name="f"/> (0..1) and/or the walls on the camera side of the plane by <paramref name="cutF"/>. Zero clears the property block (back to SRP-batched).</summary>
        public void SetFade(float f, Vector4 plane, float cutF)
        {
            f = f < 0.003f ? 0f : f;
            cutF = cutF < 0.003f ? 0f : cutF;
            if (Mathf.Approximately(f, fade) && Mathf.Approximately(cutF, cutFade) && (cutF <= 0f || plane == cutPlane)) return;
            fade = f; cutFade = cutF;
            if (cutF > 0f) cutPlane = plane;
            if (block == null) block = new MaterialPropertyBlock();
            bool clear = f <= 0f && cutF <= 0f;
            if (!clear)
            {
                block.Clear();
                block.SetFloat(FadeId, f);
                block.SetVector(CutPlaneId, cutF > 0f ? cutPlane : new Vector4(0, 0, 0, 100000f));
                block.SetFloat(CutFadeId, cutF);
            }
            for (int i = 0; i < renderers.Count; i++)
            {
                var r = renderers[i];
                if (r == null) continue;
                if (clear) r.SetPropertyBlock(null); else r.SetPropertyBlock(block);
            }
            for (int i = 0; i < attached.Count; i++) ApplyFade(attached[i]);
            if (glowRenderer != null) glowRenderer.enabled = f < 0.35f;
        }

        /// <summary>Give a renderer this building's current fade (used when a prop attaches after the fade began).</summary>
        public void ApplyFade(MeshRenderer r)
        {
            if (r == null) return;
            if (fade <= 0f && cutFade <= 0f) { r.SetPropertyBlock(null); return; }
            if (block == null) block = new MaterialPropertyBlock();
            block.Clear();
            block.SetFloat(FadeId, fade);
            block.SetVector(CutPlaneId, cutFade > 0f ? cutPlane : new Vector4(0, 0, 0, 100000f));
            block.SetFloat(CutFadeId, cutFade);
            r.SetPropertyBlock(block);
        }

        public void Destroy()
        {
            if (root != null) UnityEngine.Object.Destroy(root);
            foreach (var m in meshes) if (m != null) UnityEngine.Object.Destroy(m);
        }
    }

    public sealed partial class BuildingBuilder
    {

        readonly WorldView world;
        readonly TileGrid grid;
        readonly Transform root;
        public readonly Dictionary<int, BuildingView> views = new Dictionary<int, BuildingView>();
        public bool dirty = true;
        readonly HashSet<int> seen = new HashSet<int>();
        readonly List<int> gone = new List<int>();

        const float Inset = 0.15f, T = 0.25f;

        public BuildingBuilder(WorldView world, TileGrid grid, Transform root)
        {
            this.world = world;
            this.grid = grid;
            this.root = root;
        }

        public void Clear()
        {
            foreach (var v in views.Values) v.Destroy();
            views.Clear();
            dirty = true;
        }

        /// <summary>Build, rebuild or remove views to match the mirror's buildings. Skips ones whose land hasn't come.</summary>
        public void Sync(IList<Building> list)
        {
            dirty = false;
            seen.Clear();
            foreach (var b in list)
            {
                seen.Add(b.id);
                if (!Ready(b)) { dirty = true; continue; }
                string sig = Sig(b);
                if (views.TryGetValue(b.id, out var old))
                {
                    if (old.sig == sig) { old.data = b; if (old.root != null) { var h = old.root.GetComponent<BuildingHandle>(); if (h != null) h.data = b; } continue; }
                    old.Destroy();
                    views.Remove(b.id);
                }
                views[b.id] = Build(b, sig);
            }
            gone.Clear();
            foreach (var id in views.Keys) if (!seen.Contains(id)) gone.Add(id);
            foreach (var id in gone) { views[id].Destroy(); views.Remove(id); }
        }

        /// <summary>Hand each building the prop renderers (door, stairs...) the patches drew for it, so Occlusion fades them together.</summary>
        public void AttachProps(IEnumerable<PatchView> patchViews)
        {
            foreach (var v in views.Values) v.attached.RemoveAll(r => r == null);
            foreach (var pv in patchViews)
                foreach (var kv in pv.attached)
                {
                    if (kv.Value == null || !views.TryGetValue(kv.Key, out var bv) || bv.attached.Contains(kv.Value)) continue;
                    bv.attached.Add(kv.Value);
                    bv.ApplyFade(kv.Value);
                }
        }

        bool Ready(Building b)
        {
            int bx = Mathf.FloorToInt((float)b.x), by = Mathf.FloorToInt((float)b.y);
            return grid.Has(bx, by) && grid.Has(Mathf.FloorToInt((float)(b.x + b.w) - 0.01f), by) && grid.Has(bx, Mathf.FloorToInt((float)(b.y + b.h) - 0.01f))
                   && grid.Has(Mathf.FloorToInt((float)(b.x + b.w) - 0.01f), Mathf.FloorToInt((float)(b.y + b.h) - 0.01f));
        }

        string Sig(Building b)
        {
            Rect r = Footprint(b);
            float baseY = Mathf.Max(Mathf.Max(grid.GroundY(r.xMin, r.yMin), grid.GroundY(r.xMax, r.yMin)), Mathf.Max(grid.GroundY(r.xMin, r.yMax), grid.GroundY(r.xMax, r.yMax)));
            return b.id + "|" + b.x + "," + b.y + "," + b.w + "," + b.h + "|" + b.kind + "|" + b.template + "|" + b.style + "|" + b.color + "|" + (b.door == null ? "" : b.door.x + "," + b.door.y)
                   + "|" + Mathf.RoundToInt(baseY * 10f) + "|" + (world.manifest != null) + "|" + LocaleSig();
        }

        string LocaleSig()
        {
            var loc = world.Mirror?.map?.locale;
            return loc == null ? "" : loc.terrain + "," + Mathf.RoundToInt((float)loc.wealth * 20f) + "," + loc.size;
        }

        static Rect Footprint(Building b)
        {
            float ts = WorldView.TileSize;
            float x0 = (float)b.x * ts + Inset, z0 = (float)b.y * ts + Inset;
            float x1 = (float)(b.x + b.w) * ts - Inset, z1 = (float)(b.y + b.h) * ts - Inset;
            return Rect.MinMaxRect(x0, z0, x1, z1);
        }

        // ------------------------------------------------------------------ build

        BuildingView Build(Building b, string sig)
        {
            var view = new BuildingView { data = b, sig = sig };
            Rect r = Footprint(b);
            float x0 = r.xMin, x1 = r.xMax, z0 = r.yMin, z1 = r.yMax;
            float cx = (x0 + x1) * 0.5f, cz = (z0 + z1) * 0.5f;
            view.root = new GameObject("building " + b.id + " " + b.kind);
            view.root.transform.SetParent(root, false);
            view.root.layer = WorldLayers.Building;
            var handle = view.root.AddComponent<BuildingHandle>();
            handle.id = b.id;
            handle.data = b;
            view.box = new Vector4(x0, z0, x1, z1);
            uint h = Hash.Str(b.id.ToString()) ^ Hash.H((int)b.x, (int)b.y, 17);

            float baseY = Mathf.Max(Mathf.Max(grid.GroundY(x0, z0), grid.GroundY(x1, z0)), Mathf.Max(grid.GroundY(x0, z1), grid.GroundY(x1, z1)));
            float minY = Mathf.Min(Mathf.Min(grid.GroundY(x0, z0), grid.GroundY(x1, z0)), Mathf.Min(grid.GroundY(x0, z1), grid.GroundY(x1, z1)));
            float drop = baseY - minY + 0.45f;

            if (world.manifest != null && world.manifest.TryGet("building/" + b.kind, out var entry))
            {
                var inst = UnityEngine.Object.Instantiate(entry.prefab, view.root.transform);
                inst.transform.position = new Vector3(cx, baseY, cz) + entry.offset;
                inst.transform.localScale = Vector3.one * entry.scale;
                if (entry.fitFootprint)
                {
                    var rends = inst.GetComponentsInChildren<Renderer>();
                    if (rends.Length > 0)
                    {
                        Bounds bb = rends[0].bounds;
                        for (int i = 1; i < rends.Length; i++) bb.Encapsulate(rends[i].bounds);
                        if (bb.size.x > 0.01f && bb.size.z > 0.01f)
                            inst.transform.localScale = new Vector3(inst.transform.localScale.x * (x1 - x0) / bb.size.x, inst.transform.localScale.y, inst.transform.localScale.z * (z1 - z0) / bb.size.z);
                    }
                }
                view.top = baseY + 4f;
                view.chimney = new Vector3(cx, baseY + 4f, cz);
                AddCollider(view, x0, x1, z0, z1, baseY, 3f);
                return view;
            }

            var meshes = new List<Mesh>();
            switch (b.kind)
            {
                case "market": BuildMarket(view, b, h, x0, x1, z0, z1, baseY, minY, meshes); return Finish(view, meshes, x0, x1, z0, z1, baseY);
                case "tent": BuildTent(view, b, h, x0, x1, z0, z1, baseY, meshes); return Finish(view, meshes, x0, x1, z0, z1, baseY);
                case "fire": BuildFire(view, h, cx, cz, baseY, meshes); return Finish(view, meshes, x0, x1, z0, z1, baseY);
                case "cart": BuildCart(view, h, cx, cz, baseY, meshes); return Finish(view, meshes, x0, x1, z0, z1, baseY);
                case "heap": BuildHeap(view, h, x0, x1, z0, z1, baseY, meshes); return Finish(view, meshes, x0, x1, z0, z1, baseY);
                case "loot": BuildLoot(view, h, cx, cz, baseY, meshes); return Finish(view, meshes, x0, x1, z0, z1, baseY);
            }

            return BuildHouse(view, b, h, x0, x1, z0, z1, baseY, drop, meshes);
        }

        BuildingView Finish(BuildingView v, List<Mesh> meshes, float x0, float x1, float z0, float z1, float baseY, float height = 2.5f)
        {
            v.meshes = meshes.ToArray();
            if (v.top <= 0f) v.top = baseY + height;
            if (v.collider == null) AddCollider(v, x0, x1, z0, z1, baseY, height);
            return v;
        }

        void AddCollider(BuildingView v, float x0, float x1, float z0, float z1, float baseY, float height)
        {
            if (!world.buildingColliders) return;
            var bc = v.root.AddComponent<BoxCollider>();
            bc.center = new Vector3((x0 + x1) * 0.5f, baseY + height * 0.5f, (z0 + z1) * 0.5f);
            bc.size = new Vector3(x1 - x0, height, z1 - z0);
            v.collider = bc;
        }

        GameObject AddPart(BuildingView v, MeshBuilder mb, string name, List<Mesh> meshes, bool glow)
        {
            if (mb.VertexCount == 0) return null;
            var mesh = mb.ToMesh(name + " " + v.data.id);
            meshes.Add(mesh);
            var go = new GameObject(name);
            go.transform.SetParent(v.root.transform, false);
            go.layer = WorldLayers.Building;
            go.AddComponent<MeshFilter>().sharedMesh = mesh;
            var mr = go.AddComponent<MeshRenderer>();
            mr.sharedMaterial = glow ? Mats.Glow() : Mats.Toon();
            if (glow) v.glowRenderer = mr; else v.renderers.Add(mr);
            if (glow) { mr.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off; mr.receiveShadows = false; }
            return go;
        }

        // ------------------------------------------------------------------ small kinds

        void BuildMarket(BuildingView view, Building b, uint h, float x0, float x1, float z0, float z1, float baseY, float minY, List<Mesh> meshes)
        {
            var mb = new MeshBuilder();
            float len = x1 - x0;
            int n = Mathf.Max(1, Mathf.FloorToInt(len / 2.6f));
            float sw = len / n;
            Color cloth = Pal.Hex(b.color, Pal.Rgb(0xc9503f));
            if (Pal.Hex(b.color, Color.magenta) == Color.magenta) cloth = Pal.Rgb(new[] { 0xc9503f, 0x3f7fb0, 0xd0a23f, 0x5aa062 }[h % 4]);
            Color wood = Pal.Rgb(0x8a6544);
            mb.Box(new Vector3(x0, minY - 0.3f, z0), new Vector3(x1, baseY + 0.03f, z1), Pal.Rgb(0xb5a98c));
            for (int i = 0; i < n; i++)
            {
                float a = x0 + i * sw + 0.15f, c = x0 + (i + 1) * sw - 0.15f;
                float zf = z1 - 0.5f, zb = Mathf.Max(z0 + 0.5f, z1 - 2.2f);
                foreach (var px in new[] { a, c - 0.1f })
                {
                    mb.Box(new Vector3(px, baseY, zf - 0.1f), new Vector3(px + 0.1f, baseY + 2.2f, zf), wood);
                    mb.Box(new Vector3(px, baseY, zb), new Vector3(px + 0.1f, baseY + 2.6f, zb + 0.1f), wood);
                }
                int stripes = Mathf.Max(2, Mathf.RoundToInt((c - a) / 0.35f));
                float stw = (c - a) / stripes;
                for (int s = 0; s < stripes; s++)
                {
                    Color col = s % 2 == 0 ? cloth : Pal.Rgb(0xf1e8d2);
                    float sx = a + s * stw;
                    mb.Quad(new Vector3(sx, baseY + 2.2f, zf + 0.25f), new Vector3(sx + stw, baseY + 2.2f, zf + 0.25f), new Vector3(sx + stw, baseY + 2.6f, zb), new Vector3(sx, baseY + 2.6f, zb), col, Vector3.up);
                    mb.Quad(new Vector3(sx, baseY + 2.2f, zf + 0.25f), new Vector3(sx + stw, baseY + 2.2f, zf + 0.25f), new Vector3(sx + stw, baseY + 2.1f, zf + 0.25f), new Vector3(sx, baseY + 2.1f, zf + 0.25f), col, Vector3.forward);
                }
                mb.Box(new Vector3(a, baseY, zf - 0.55f), new Vector3(c, baseY + 0.95f, zf - 0.05f), wood, Pal.Rgb(0xb08a5c));
                for (int g = 0; g < 4; g++)
                {
                    float gx = a + 0.2f + g * (c - a - 0.5f) / 3f;
                    Color gc = Pal.Rgb(new[] { 0xd9453f, 0xe3b53a, 0x6aa84f, 0xd98a3a, 0xa0679a }[(int)((h + g * 3 + i) % 5)]);
                    mb.Blob(new Vector3(gx + 0.12f, baseY + 1.08f, zf - 0.3f), new Vector3(0.13f, 0.12f, 0.13f), gc, 5, 3, 0.1f, g + i);
                }
                mb.Box(new Vector3(a + 0.1f, baseY, zb + 0.15f), new Vector3(a + 0.6f, baseY + 0.5f, zb + 0.65f), Pal.Rgb(0x9a7a52), Pal.Rgb(0xb89868));
            }
            view.top = baseY + 2.7f;
            view.chimney = new Vector3((x0 + x1) * 0.5f, view.top, (z0 + z1) * 0.5f);
            view.solid = false;
            AddSingle(view, mb, meshes);
        }

        void BuildTent(BuildingView view, Building b, uint h, float x0, float x1, float z0, float z1, float baseY, List<Mesh> meshes)
        {
            var mb = new MeshBuilder();
            float cx = (x0 + x1) * 0.5f, cz = (z0 + z1) * 0.5f;
            bool alongX = (x1 - x0) >= (z1 - z0);
            float L = alongX ? x1 - x0 : z1 - z0, D = alongX ? z1 - z0 : x1 - x0;
            float H = Mathf.Clamp(D * 0.6f, 1.6f, 2.6f);
            Color cloth = Pal.Hex(b.color, Pal.Rgb(0xd9c9a0));
            if (Pal.Hex(b.color, Color.magenta) == Color.magenta) cloth = Pal.Rgb(h % 2 == 0 ? 0xd9c9a0 : 0xb9573f);
            mb.SetTransform(Matrix4x4.TRS(new Vector3(cx, baseY, cz), Quaternion.Euler(0, alongX ? 0f : 90f, 0), Vector3.one));
            float Lh = L * 0.5f, Dh = D * 0.5f;
            mb.Quad(new Vector3(-Lh, 0, Dh), new Vector3(Lh, 0, Dh), new Vector3(Lh, H, 0), new Vector3(-Lh, H, 0), cloth, new Vector3(0, 1, 1));
            mb.Quad(new Vector3(-Lh, 0, -Dh), new Vector3(Lh, 0, -Dh), new Vector3(Lh, H, 0), new Vector3(-Lh, H, 0), Pal.Mul(cloth, 0.9f), new Vector3(0, 1, -1));
            mb.Tri(new Vector3(-Lh, 0, -Dh), new Vector3(-Lh, 0, Dh), new Vector3(-Lh, H, 0), Pal.Mul(cloth, 0.85f), Vector3.left);
            mb.Tri(new Vector3(Lh, 0, -Dh), new Vector3(Lh, 0, Dh), new Vector3(Lh, H, 0), Pal.Mul(cloth, 0.95f), Vector3.right);
            mb.Tri(new Vector3(Lh + 0.01f, 0, -Dh * 0.32f), new Vector3(Lh + 0.01f, 0, Dh * 0.32f), new Vector3(Lh + 0.01f, H * 0.62f, 0), Pal.Rgb(0x2b231c), Vector3.right);
            mb.Box(new Vector3(-Lh - 0.15f, 0, -0.04f), new Vector3(-Lh - 0.08f, H + 0.25f, 0.04f), Pal.Rgb(0x6a4a35));
            mb.Box(new Vector3(Lh + 0.08f, 0, -0.04f), new Vector3(Lh + 0.15f, H + 0.25f, 0.04f), Pal.Rgb(0x6a4a35));
            mb.ResetTransform();
            view.top = baseY + H;
            view.chimney = new Vector3(cx, baseY + H, cz);
            AddSingle(view, mb, meshes);
        }

        void BuildFire(BuildingView view, uint h, float cx, float cz, float baseY, List<Mesh> meshes)
        {
            var mb = new MeshBuilder();
            float y = grid.GroundY(cx, cz);
            for (int i = 0; i < 7; i++)
            {
                float a = i * Mathf.PI * 2f / 7f;
                mb.Blob(new Vector3(cx + Mathf.Cos(a) * 0.5f, y + 0.1f, cz + Mathf.Sin(a) * 0.5f), new Vector3(0.17f, 0.13f, 0.15f), Pal.Rgb(i % 2 == 0 ? 0x8f8e8a : 0x777672), 5, 2, 0.2f, i);
            }
            mb.Frustum(new Vector3(cx, y, cz), 0.45f, 0.45f, 0.03f, 8, Pal.Rgb(0x2e2a26));
            for (int i = 0; i < 3; i++)
            {
                mb.SetTransform(Matrix4x4.TRS(new Vector3(cx, y + 0.06f, cz), Quaternion.Euler(0, i * 60f + h % 30, 0), Vector3.one));
                mb.Box(new Vector3(-0.4f, 0, -0.06f), new Vector3(0.4f, 0.13f, 0.06f), Pal.Rgb(0x5a3f2b));
                mb.ResetTransform();
            }
            mb.Frustum(new Vector3(cx, y + 0.1f, cz), 0.22f, 0f, 0.6f, 6, Pal.Rgb(0xff8a3a));
            mb.Frustum(new Vector3(cx, y + 0.1f, cz), 0.12f, 0f, 0.4f, 5, Pal.Rgb(0xffd466));
            view.top = y + 0.7f;
            view.chimney = new Vector3(cx, y + 0.7f, cz);
            view.solid = false;
            AddSingle(view, mb, meshes);
        }

        void BuildCart(BuildingView view, uint h, float cx, float cz, float baseY, List<Mesh> meshes)
        {
            var mb = new MeshBuilder();
            float y = grid.GroundY(cx, cz);
            Color wood = Pal.Rgb(0x8a6544), dark = Pal.Rgb(0x5f4430);
            mb.SetTransform(Matrix4x4.TRS(new Vector3(cx, y, cz), Quaternion.Euler(0, h % 40 - 20f, 0), Vector3.one));
            mb.Box(new Vector3(-0.85f, 0.45f, -0.5f), new Vector3(0.85f, 0.55f, 0.5f), wood, Pal.Rgb(0xa88256));
            mb.Box(new Vector3(-0.85f, 0.55f, -0.5f), new Vector3(0.85f, 0.95f, -0.42f), wood);
            mb.Box(new Vector3(-0.85f, 0.55f, 0.42f), new Vector3(0.85f, 0.95f, 0.5f), wood);
            mb.Box(new Vector3(-0.85f, 0.55f, -0.5f), new Vector3(-0.77f, 0.95f, 0.5f), wood);
            mb.Box(new Vector3(0.85f, 0.4f, -0.35f), new Vector3(1.9f, 0.46f, -0.28f), dark);
            mb.Box(new Vector3(0.85f, 0.4f, 0.28f), new Vector3(1.9f, 0.46f, 0.35f), dark);
            mb.Blob(new Vector3(-0.1f, 0.78f, 0), new Vector3(0.55f, 0.3f, 0.32f), Pal.Rgb(0xd5b24c), 6, 3, 0.1f, 3);
            foreach (var wz in new[] { -0.56f, 0.56f })
            {
                mb.SetTransform(Matrix4x4.TRS(new Vector3(cx, y, cz), Quaternion.Euler(0, h % 40 - 20f, 0), Vector3.one) * Matrix4x4.TRS(new Vector3(0.1f, 0.42f, wz), Quaternion.Euler(90, 0, 0), Vector3.one));
                mb.Frustum(new Vector3(0, -0.04f, 0), 0.42f, 0.42f, 0.08f, 8, dark, true, 0f, true);
                mb.Frustum(new Vector3(0, -0.06f, 0), 0.1f, 0.1f, 0.12f, 6, Pal.Rgb(0xa88256));
            }
            mb.ResetTransform();
            view.top = y + 1f;
            view.chimney = new Vector3(cx, y + 1f, cz);
            AddSingle(view, mb, meshes);
        }

        void BuildHeap(BuildingView view, uint h, float x0, float x1, float z0, float z1, float baseY, List<Mesh> meshes)
        {
            var mb = new MeshBuilder();
            float cx = (x0 + x1) * 0.5f, cz = (z0 + z1) * 0.5f;
            float R = Mathf.Min(x1 - x0, z1 - z0) * 0.35f;
            int[] cols = { 0x7d6a55, 0x8f8a80, 0x5f5248, 0x9a8466, 0x6b625a };
            for (int i = 0; i < 6; i++)
            {
                float a = Hash.F((int)h, i, 1) * 6.28f, d = Hash.F((int)h, i, 2) * R * 0.8f;
                float x = cx + Mathf.Cos(a) * d, z = cz + Mathf.Sin(a) * d;
                float rr = R * (0.35f + 0.35f * Hash.F((int)h, i, 3));
                mb.Blob(new Vector3(x, grid.GroundY(x, z) + rr * 0.35f, z), new Vector3(rr, rr * 0.7f, rr), Pal.Rgb(cols[(int)((h + i) % 5)]), 6, 3, 0.3f, i + (int)h, 0.3f);
            }
            view.top = baseY + R;
            view.chimney = new Vector3(cx, baseY + R, cz);
            view.solid = false;
            AddSingle(view, mb, meshes);
        }

        void BuildLoot(BuildingView view, uint h, float cx, float cz, float baseY, List<Mesh> meshes)
        {
            var mb = new MeshBuilder();
            float y = grid.GroundY(cx, cz);
            mb.Blob(new Vector3(cx - 0.25f, y + 0.22f, cz), new Vector3(0.25f, 0.24f, 0.22f), Pal.Rgb(0xb89868), 6, 3, 0.1f, 1);
            mb.Box(new Vector3(cx + 0.05f, y, cz - 0.2f), new Vector3(cx + 0.5f, y + 0.3f, cz + 0.2f), Pal.Rgb(0x8a6544), Pal.Rgb(0xb08a5c));
            mb.Blob(new Vector3(cx + 0.28f, y + 0.34f, cz), new Vector3(0.12f, 0.05f, 0.1f), Pal.Rgb(0xf2c94c), 5, 2);
            view.top = y + 0.5f;
            view.chimney = new Vector3(cx, y + 0.5f, cz);
            view.solid = false;
            AddSingle(view, mb, meshes);
        }


        /// <summary>How far to push a walker at (x, z) so it is not drawn inside a wall (a doorway, mid-step): out of the nearest face, the front preferred.</summary>
        public Vector2 NudgeOut(float x, float z)
        {
            const float margin = 0.2f;
            foreach (var v in views.Values)
            {
                if (!v.solid || v.Inside) continue;
                Vector4 b = v.box;   // x0, z0, x1, z1
                if (x <= b.x - margin || x >= b.z + margin || z <= b.y - margin || z >= b.w + margin) continue;
                float dL = x - (b.x - margin), dR = (b.z + margin) - x, dB = z - (b.y - margin), dF = (b.w + margin) - z - 0.05f;
                float m = Mathf.Min(Mathf.Min(dL, dR), Mathf.Min(dB, dF));
                if (m == dF) return new Vector2(0f, dF + 0.05f);
                if (m == dB) return new Vector2(0f, -dB);
                if (m == dL) return new Vector2(-dL, 0f);
                return new Vector2(dR, 0f);
            }
            return Vector2.zero;
        }

        /// <summary>The building whose tile rectangle holds this point (tile coordinates, a tile's middle is +0.5), or null.</summary>
        public BuildingView AtTile(double x, double y)
        {
            foreach (var v in views.Values)
            {
                var b = v.data;
                if (x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h) return v;
            }
            return null;
        }


        void AddSingle(BuildingView view, MeshBuilder mb, List<Mesh> meshes)
        {
            var go = AddPart(view, mb, "body", meshes, false);
            view.floorCount = 0;
            if (go == null) return;
        }
    }
}
