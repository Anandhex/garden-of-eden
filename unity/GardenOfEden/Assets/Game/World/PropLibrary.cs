// The procedural props: each art id gets a few variants, built once from MeshBuilder primitives in metres, origin at
// the foot centre of its tile (a tile is WorldView.TileSize = 1.5 m). Unknown ids fall back by family so nothing
// ever draws as nothing. Variants are baked into one combined mesh per patch by PropBuilder.
using System.Collections.Generic;
using UnityEngine;
using GardenOfEden.Net;

namespace GardenOfEden.World
{
    public sealed class PropLibrary
    {
        public const int Variants = 4;

        /// <summary>Far scatter (the horizon ring): coarser soft shapes, same silhouettes.</summary>
        public bool lowDetail;
        int Sub(int near) => lowDetail ? Mathf.Max(0, near - 1) : near;

        /// <summary>Ids drawn with the foliage material (wind sway, back-light). Their meshes carry sway weights in UV0.x.</summary>
        public static bool IsFoliage(string id) => id == "props/tree" || id == "props/bush" || id == "props/reeds" || id == "props/flowers" || id == "props/crop";

        public struct Place
        {
            public float jitter;      // random offset within the tile, in tiles
            public float scaleMin, scaleMax;
            public bool yaw;          // random spin
            public bool snapGround;   // stand on the lowest corner (walls, furniture) rather than the centre
        }

        readonly Dictionary<string, MeshBuilder[]> cache = new Dictionary<string, MeshBuilder[]>();

        static readonly Color Wood = Pal.Rgb(0x8a6544), WoodDark = Pal.Rgb(0x5f4430), WoodLight = Pal.Rgb(0xb08a5c);
        static readonly Color Stone = Pal.Rgb(0xa5a39b), StoneDark = Pal.Rgb(0x7d7b75), Plaster = Pal.Rgb(0xdccfb4);

        public Place PlaceFor(string id)
        {
            switch (id)
            {
                case "props/tree": return new Place { jitter = 0.28f, scaleMin = 0.68f, scaleMax = 0.98f, yaw = true };
                case "props/rock": return new Place { jitter = 0.25f, scaleMin = 0.8f, scaleMax = 1.35f, yaw = true };
                case "props/reeds": case "props/bush": case "props/flowers": return new Place { jitter = 0.3f, scaleMin = 0.8f, scaleMax = 1.2f, yaw = true };
                case "props/thatch": case "props/shrine": case "props/milestone": case "props/signpost": case "props/well":
                    return new Place { jitter = 0.05f, scaleMin = 0.95f, scaleMax = 1.05f, yaw = false };
                default: return new Place { jitter = 0f, scaleMin = 1f, scaleMax = 1f, yaw = false, snapGround = true };
            }
        }

        /// <summary>The variant mesh for an art id; null if the id draws nothing (an fx id, say).</summary>
        public MeshBuilder Get(string id, uint seed)
        {
            if (string.IsNullOrEmpty(id)) return null;
            if (!cache.TryGetValue(id, out var vs))
            {
                vs = new MeshBuilder[Variants];
                for (int i = 0; i < Variants; i++) vs[i] = Make(id, i);
                cache[id] = vs;
            }
            return vs[(int)(seed % Variants)];
        }

        MeshBuilder Make(string id, int v)
        {
            var b = new MeshBuilder();
            switch (id)
            {
                case "props/tree": Tree(b, v); break;
                case "props/rock": Rock(b, v); break;
                case "props/reeds": Reeds(b, v); b.SwayByHeight(0, 0f, 1.5f, 1f); break;
                case "props/bush": Bush(b, v); break;
                case "props/flowers": Flowers(b, v); b.SwayByHeight(0, 0f, 0.4f, 0.6f); break;
                case "props/crop": Crop(b, v); b.SwayByHeight(0, 0f, 0.6f, 0.35f); break;
                case "props/fence": Fence(b); break;
                case "props/well": Well(b); break;
                case "props/milestone": Milestone(b); break;
                case "props/signpost": Signpost(b); break;
                case "props/shrine": Shrine(b); break;
                case "props/farmhouse": Farmhouse(b, v); break;
                case "props/bar": Bar(b); break;
                case "props/thatch": Thatch(b); break;
                case "buildings/wall": Wall(b, v); break;
                case "buildings/door": DoorFrame(b); break;
                case "buildings/gate": Gate(b); break;
                case "buildings/stairs": Stairs(b); break;
                case "props/bed": Bed(b, v); break;
                case "props/table": Table(b); break;
                case "props/hearth": Hearth(b); break;
                case "props/chest": Chest(b); break;
                case "props/shelf": Shelf(b, v); break;
                case "props/anvil": Anvil(b); break;
                case "props/altar": Altar(b); break;
                case "props/barrel": Barrel(b); break;
                case "props/counter": Counter(b); break;
                case "props/bench": Bench(b); break;
                default:
                    if (ArtIds.IsFx(id)) return null;
                    if (id.StartsWith("buildings/")) Wall(b, v);
                    else Crate(b, v);
                    break;
            }
            return b;
        }

        // ---- nature ----

        // G8 trees: chunky soft canopies (smooth normals bent round the canopy's centre, so the lumps shade as one mass),
        // darker olive underneath and warm yellow-green on top, on a tapered smooth trunk. 4 variants: round oak, broad
        // two-lobed elm, tall poplar, layered fir. About 5-7 m tall at scale 1 (a person is 1.75 m, a tile 1.5 m).
        void Tree(MeshBuilder b, int v)
        {
            int sub = Sub(2);
            Color bark = Pal.Rgb(v % 2 == 0 ? 0x6e5440 : 0x5f4a3a), barkTop = Pal.Mul(bark, 1.12f);
            float lean = (Hash.F(v, 5, 81) - 0.5f) * 0.3f;
            if (v == 2)
            {
                // Fir: soft cones stacked on a straight trunk, each with a rounded drooping skirt; a pointed crown.
                Color deep = Pal.Rgb(0x2f5f45), tip = Pal.Rgb(0x5f8f55);
                b.SoftTube(Vector3.zero, new Vector3(0, 1.4f, 0), 0.24f, 0.17f, 7, bark, barkTop);
                int tiers = 4;
                float y = 1.0f;
                for (int t = 0; t < tiers; t++)
                {
                    float k = 1f - t / (float)tiers;
                    float r = 0.7f + 1.2f * k, hgt = 1.5f + 0.3f * k;
                    Color c = Color.Lerp(deep, tip, t / (float)(tiers - 1) * 0.5f);
                    var skirt = new Vector3(0, y + 0.18f, 0);
                    b.SoftBlob(skirt, new Vector3(r, 0.3f, r), Pal.Mul(c, 0.92f), Sub(1), 0.1f, v * 13 + t, skirt + Vector3.up * 0.6f, 0.2f, 0f, 1f, 0f, -2f, c, 0.3f);
                    b.SoftTube(new Vector3(0, y + 0.1f, 0), new Vector3(0, y + hgt, 0), r * 0.97f, t == tiers - 1 ? 0.03f : r * 0.22f, 10, c, Pal.Mul(Color.Lerp(c, tip, 0.6f), 1.06f), 0f, 0f, true);
                    y += hgt * 0.6f;
                }
                b.SoftTube(new Vector3(0, y + 0.3f, 0), new Vector3(0, y + 1.2f, 0), 0.32f, 0.02f, 8, tip, Pal.Mul(tip, 1.1f));
                b.SwayByHeight(0, 0.8f, y + 1f, 0.9f);
                return;
            }
            Color[] lows = { Pal.Rgb(0x3f6f3a), Pal.Rgb(0x4a7a36), Pal.Rgb(0x3c6a42), Pal.Rgb(0x55803a) };
            Color[] tops = { Pal.Rgb(0x8ab854), Pal.Rgb(0x9cbf55), Pal.Rgb(0x80b562), Pal.Rgb(0xa8c05a) };
            Color low = lows[v % 4], top = tops[v % 4], mid = Color.Lerp(low, top, 0.45f);
            float h = v == 3 ? 2.2f : 1.7f + 0.25f * v;
            Vector3 trunkTop = new Vector3(lean, h, lean * 0.5f);
            b.SoftTube(Vector3.zero, trunkTop, 0.3f, 0.19f, 7, Pal.Mul(bark, 0.9f), barkTop);
            // root flare and two branches into the crown
            b.SoftTube(new Vector3(0, -0.05f, 0), new Vector3(0, 0.35f, 0), 0.42f, 0.27f, 7, Pal.Mul(bark, 0.85f), bark);
            b.SoftTube(trunkTop - Vector3.up * 0.25f, trunkTop + new Vector3(0.75f, 0.75f, 0.2f), 0.12f, 0.06f, 5, bark, barkTop, 0f, 0.3f);
            b.SoftTube(trunkTop - Vector3.up * 0.15f, trunkTop + new Vector3(-0.6f, 0.85f, -0.35f), 0.11f, 0.05f, 5, bark, barkTop, 0f, 0.3f);
            if (v == 3)
            {
                // Poplar: one tall soft flame of leaves.
                var c3 = trunkTop + new Vector3(0, 1.9f, 0);
                b.SoftBlob(c3, new Vector3(1.05f, 2.4f, 1.05f), mid, sub, 0.12f, v * 31, c3 - Vector3.up * 0.8f, 0.6f, h - 0.4f, h + 4.2f, 1f, -2f, top);
                b.SoftBlob(c3 + new Vector3(0.45f, -0.9f, 0.2f), new Vector3(0.75f, 1.2f, 0.7f), mid, Sub(1), 0.12f, v * 31 + 1, c3 - Vector3.up * 0.8f, 0.6f, h - 0.4f, h + 4.2f, 1f, -2f, top);
                return;
            }
            // Oak and elm: a big central mass and a ring of lobes.
            Vector3 cc = trunkTop + new Vector3(0, 1.35f, 0);
            Vector3 nc = cc - Vector3.up * 0.5f;
            float R = v == 1 ? 1.95f : 1.7f;
            b.SoftBlob(cc, new Vector3(R, R * 0.78f, R), mid, sub, 0.1f, v * 17, nc, 0.65f, h - 0.3f, h + 3.4f, 1f, -0.6f, top);
            int lobes = v == 1 ? 6 : 5;
            for (int i = 0; i < lobes; i++)
            {
                float a = (i + Hash.F(v, i, 83) * 0.5f) / lobes * Mathf.PI * 2f;
                float rr = R * (0.72f + 0.15f * Hash.F(v, i, 84));
                float yy = (Hash.F(v, i, 85) - 0.35f) * R * 0.7f;
                var lc = cc + new Vector3(Mathf.Cos(a) * rr, yy, Mathf.Sin(a) * rr * (v == 1 ? 0.8f : 1f));
                float lr = R * (0.5f + 0.18f * Hash.F(v, i, 86));
                b.SoftBlob(lc, new Vector3(lr, lr * 0.82f, lr), mid, Sub(1), 0.12f, v * 17 + i + 1, nc, 0.7f, h - 0.3f, h + 3.4f, 1f, -0.5f, top);
            }
            // a top knob for a rounder silhouette
            b.SoftBlob(cc + new Vector3(0.2f, R * 0.62f, -0.1f), new Vector3(R * 0.62f, R * 0.5f, R * 0.62f), mid, Sub(1), 0.1f, v * 17 + 9, nc, 0.7f, h - 0.3f, h + 3.4f, 1f, -2f, top);
        }

        void Rock(MeshBuilder b, int v)
        {
            Color c = Pal.Rgb(v % 2 == 0 ? 0x9a958c : 0x8a8a84), top = Pal.Rgb(v % 2 == 0 ? 0xb9b3a6 : 0xaaa99f);
            var c0 = new Vector3(0, 0.28f, 0);
            b.SoftBlob(c0, new Vector3(0.68f, 0.5f, 0.58f), c, Sub(1), 0.22f, v + 40, c0, 0.25f, 0, 1, 0, -0.45f, top, 0.4f);
            var c1 = new Vector3(0.55f, 0.12f, 0.32f);
            b.SoftBlob(c1, new Vector3(0.34f, 0.26f, 0.32f), Pal.Mul(c, 0.94f), Sub(1), 0.22f, v + 50, c1, 0.25f, 0, 1, 0, -0.4f, top, 0.4f);
            if (v >= 2) { var c2 = new Vector3(-0.48f, 0.15f, -0.22f); b.SoftBlob(c2, new Vector3(0.38f, 0.3f, 0.34f), Pal.Mul(c, 1.03f), Sub(1), 0.22f, v + 60, c2, 0.25f, 0, 1, 0, -0.4f, top, 0.4f); }
            // a cap of moss on top of the bigger stones
            if (v % 2 == 1) { var cm = c0 + new Vector3(0, 0.36f, 0); b.SoftBlob(cm, new Vector3(0.42f, 0.12f, 0.36f), Pal.Rgb(0x6f8f4a), Sub(0), 0.15f, v + 70, cm, 0.4f, 0, 1, 0, -0.2f, Pal.Rgb(0x8faa55)); }
        }

        static void Reeds(MeshBuilder b, int v)
        {
            for (int i = 0; i < 8; i++)
            {
                float a = Hash.F(v, i, 1) * Mathf.PI * 2f, r = 0.1f + Hash.F(v, i, 2) * 0.4f;
                Vector3 p = new Vector3(Mathf.Cos(a) * r, 0, Mathf.Sin(a) * r);
                float h = 0.9f + Hash.F(v, i, 3) * 0.7f;
                Vector3 lean = new Vector3((Hash.F(v, i, 4) - 0.5f) * 0.3f, 0, (Hash.F(v, i, 5) - 0.5f) * 0.3f);
                b.Spike(p, p + Vector3.up * h + lean, 0.035f, Pal.Rgb(i % 3 == 0 ? 0x9bb35a : 0x7ea24f));
                if (i % 4 == 0) b.Frustum(p + Vector3.up * (h - 0.25f) + lean * 0.8f, 0.05f, 0.04f, 0.28f, 4, Pal.Rgb(0x6b4a33), true);
            }
        }

        void Bush(MeshBuilder b, int v)
        {
            Color low = Pal.Rgb(v % 2 == 0 ? 0x3f6f3a : 0x467a3c), top = Pal.Rgb(v % 2 == 0 ? 0x9cc25a : 0xa8c45e), mid = Color.Lerp(low, top, 0.45f);
            var nc = new Vector3(0, 0.15f, 0);
            b.SoftBlob(new Vector3(0, 0.45f, 0), new Vector3(0.62f, 0.48f, 0.56f), mid, Sub(1), 0.14f, v + 70, nc, 0.6f, 0f, 1.1f, 0.5f, -0.6f, top);
            b.SoftBlob(new Vector3(0.45f, 0.32f, 0.12f), new Vector3(0.42f, 0.34f, 0.4f), mid, Sub(1), 0.14f, v + 71, nc, 0.6f, 0f, 1.1f, 0.5f, -0.6f, top);
            b.SoftBlob(new Vector3(-0.35f, 0.3f, -0.2f), new Vector3(0.38f, 0.3f, 0.36f), mid, Sub(1), 0.14f, v + 72, nc, 0.6f, 0f, 1.1f, 0.5f, -0.6f, top);
            if (v >= 2)
                for (int i = 0; i < 5; i++)
                {
                    var bp = new Vector3(Hash.F(v, i, 9) * 0.9f - 0.45f, 0.6f + Hash.F(v, i, 8) * 0.25f, Hash.F(v, i, 7) * 0.7f - 0.35f);
                    b.SoftBlob(bp, Vector3.one * 0.07f, Pal.Rgb(v == 2 ? 0xd9453f : 0xf2e6c8), 0, 0f, i, bp, 0f, 0f, 1.1f, 0.5f);
                }
        }

        static void Flowers(MeshBuilder b, int v)
        {
            Color[] petals = { Pal.Rgb(0xf4f0e6), Pal.Rgb(0xf2c94c), Pal.Rgb(0xe88fb0), Pal.Rgb(0xa98be0) };
            Color p = petals[v % 4];
            for (int i = 0; i < 6; i++)
            {
                float a = Hash.F(v, i, 11) * 6.28f, r = 0.05f + Hash.F(v, i, 12) * 0.35f;
                Vector3 s = new Vector3(Mathf.Cos(a) * r, 0, Mathf.Sin(a) * r);
                b.Spike(s, s + Vector3.up * 0.3f, 0.015f, Pal.Rgb(0x5f9a45), 3);
                b.Blob(s + Vector3.up * 0.32f, new Vector3(0.07f, 0.04f, 0.07f), p, 5, 2);
            }
        }

        static void Crop(MeshBuilder b, int v)
        {
            Color top = v % 2 == 0 ? Pal.Rgb(0xd8bd4f) : Pal.Rgb(0x73b04a);
            Color side = Pal.Mul(top, 0.8f);
            float h = 0.32f + 0.12f * (v % 3);
            for (int i = 0; i < 4; i++)
            {
                float z = -0.55f + i * 0.37f;
                b.Box(new Vector3(-0.68f, 0, z - 0.1f), new Vector3(0.68f, h, z + 0.1f), side, top);
            }
        }

        static void Fence(MeshBuilder b)
        {
            b.Box(new Vector3(-0.72f, 0, -0.05f), new Vector3(-0.6f, 0.95f, 0.07f), Wood);
            b.Box(new Vector3(0.6f, 0, -0.05f), new Vector3(0.72f, 0.95f, 0.07f), Wood);
            b.Box(new Vector3(-0.75f, 0.55f, -0.03f), new Vector3(0.75f, 0.68f, 0.05f), WoodLight);
            b.Box(new Vector3(-0.75f, 0.25f, -0.03f), new Vector3(0.75f, 0.38f, 0.05f), WoodLight);
        }

        static void Well(MeshBuilder b)
        {
            b.Frustum(Vector3.zero, 0.62f, 0.55f, 0.75f, 8, Stone);
            b.Frustum(new Vector3(0, 0.7f, 0), 0.42f, 0.42f, 0.01f, 8, Pal.Rgb(0x2e4a63));
            b.Box(new Vector3(-0.6f, 0, -0.06f), new Vector3(-0.5f, 1.7f, 0.06f), Wood);
            b.Box(new Vector3(0.5f, 0, -0.06f), new Vector3(0.6f, 1.7f, 0.06f), Wood);
            b.Frustum(new Vector3(0, 1.65f, 0), 0.95f, 0.05f, 0.5f, 4, Pal.Rgb(0xa8553a), true, 45f);
            b.Box(new Vector3(-0.5f, 1.2f, -0.03f), new Vector3(0.5f, 1.28f, 0.03f), WoodDark);
        }

        static void Milestone(MeshBuilder b)
        {
            b.Box(new Vector3(-0.25f, 0, -0.18f), new Vector3(0.25f, 0.85f, 0.18f), Stone);
            b.Box(new Vector3(-0.2f, 0.85f, -0.14f), new Vector3(0.2f, 1.05f, 0.14f), Pal.Mul(Stone, 1.08f));
        }

        static void Signpost(MeshBuilder b)
        {
            b.Box(new Vector3(-0.07f, 0, -0.07f), new Vector3(0.07f, 1.9f, 0.07f), WoodDark);
            b.SetTransform(Matrix4x4.TRS(new Vector3(0.38f, 1.6f, 0), Quaternion.Euler(0, 8, 0), Vector3.one));
            b.Box(new Vector3(-0.45f, -0.12f, -0.03f), new Vector3(0.45f, 0.12f, 0.03f), WoodLight);
            b.SetTransform(Matrix4x4.TRS(new Vector3(-0.32f, 1.25f, 0), Quaternion.Euler(0, -10, 0), Vector3.one));
            b.Box(new Vector3(-0.4f, -0.11f, -0.03f), new Vector3(0.4f, 0.11f, 0.03f), WoodLight);
            b.ResetTransform();
        }

        static void Shrine(MeshBuilder b)
        {
            b.Box(new Vector3(-0.55f, 0, -0.55f), new Vector3(0.55f, 0.25f, 0.55f), Stone);
            b.Box(new Vector3(-0.3f, 0.25f, -0.3f), new Vector3(0.3f, 1.0f, 0.3f), Pal.Mul(Stone, 1.05f));
            b.Box(new Vector3(-0.16f, 0.55f, 0.29f), new Vector3(0.16f, 0.85f, 0.33f), Pal.Rgb(0x34302c));
            b.Frustum(new Vector3(0, 1.0f, 0), 0.62f, 0.04f, 0.42f, 4, Pal.Rgb(0x9a4a3a), true, 45f);
            b.Blob(new Vector3(0, 0.65f, 0.36f), new Vector3(0.06f, 0.07f, 0.04f), Pal.Rgb(0xffc060), 5, 2);
        }

        static void Farmhouse(MeshBuilder b, int v)
        {
            b.Box(new Vector3(-0.6f, 0, -0.55f), new Vector3(0.6f, 0.95f, 0.55f), v % 2 == 0 ? Plaster : Pal.Rgb(0xd9c28f));
            b.Frustum(new Vector3(0, 0.95f, 0), 0.95f, 0.1f, 0.6f, 4, Pal.Rgb(0xb5603f), true, 45f);
            b.Box(new Vector3(-0.14f, 0, 0.54f), new Vector3(0.14f, 0.7f, 0.58f), WoodDark);
        }

        static void Bar(MeshBuilder b)
        {
            b.Box(new Vector3(-0.72f, 0, -0.08f), new Vector3(-0.58f, 1.0f, 0.08f), WoodDark);
            b.Box(new Vector3(0.58f, 0, -0.08f), new Vector3(0.72f, 1.0f, 0.08f), WoodDark);
            b.Box(new Vector3(-0.75f, 0.85f, -0.07f), new Vector3(0.75f, 0.98f, 0.07f), Wood);
            b.Box(new Vector3(-0.75f, 0.45f, -0.05f), new Vector3(0.75f, 0.55f, 0.05f), Wood);
        }

        static void Thatch(MeshBuilder b)
        {
            Color c = Pal.Rgb(0xd5b24c);
            b.Blob(new Vector3(0, 0.55f, 0), new Vector3(0.62f, 0.6f, 0.62f), c, 8, 3, 0.06f, 5);
            b.Frustum(new Vector3(0, 1.0f, 0), 0.4f, 0.0f, 0.5f, 8, Pal.Mul(c, 1.05f));
        }

        // ---- building pieces ----

        static void Wall(MeshBuilder b, int v)
        {
            Color c = v == 1 ? Stone : v == 2 ? Wood : Plaster;
            const float h = 0.75f;
            b.Box(new Vector3(-h, -0.7f, -h), new Vector3(h, 2.6f, h), c);
            b.Box(new Vector3(-h - 0.04f, 2.6f, -h - 0.04f), new Vector3(h + 0.04f, 2.75f, h + 0.04f), Pal.Mul(c, 0.78f));
        }

        static void DoorFrame(MeshBuilder b)
        {
            b.Box(new Vector3(-0.55f, 0, -0.1f), new Vector3(-0.42f, 2.15f, 0.1f), WoodDark);
            b.Box(new Vector3(0.42f, 0, -0.1f), new Vector3(0.55f, 2.15f, 0.1f), WoodDark);
            b.Box(new Vector3(-0.55f, 2.1f, -0.1f), new Vector3(0.55f, 2.3f, 0.1f), WoodDark);
            b.Box(new Vector3(-0.42f, 0, -0.04f), new Vector3(0.42f, 2.1f, 0.04f), Wood);
            b.Box(new Vector3(0.28f, 0.95f, 0.04f), new Vector3(0.34f, 1.05f, 0.08f), Pal.Rgb(0xd8b75a));
        }

        static void Gate(MeshBuilder b)
        {
            b.Box(new Vector3(-0.72f, 0, -0.1f), new Vector3(-0.56f, 1.5f, 0.1f), WoodDark);
            b.Box(new Vector3(0.56f, 0, -0.1f), new Vector3(0.72f, 1.5f, 0.1f), WoodDark);
            for (int i = 0; i < 3; i++) b.Box(new Vector3(-0.58f, 0.25f + i * 0.4f, -0.04f), new Vector3(0.58f, 0.37f + i * 0.4f, 0.04f), Wood);
            b.Box(new Vector3(-0.58f, 0.2f, -0.03f), new Vector3(-0.46f, 1.3f, 0.03f), WoodLight);
            b.Box(new Vector3(0.46f, 0.2f, -0.03f), new Vector3(0.58f, 1.3f, 0.03f), WoodLight);
        }

        static void Stairs(MeshBuilder b)
        {
            const int n = 5;
            for (int i = 0; i < n; i++)
            {
                float z0 = 0.7f - (i + 1) * (1.4f / n);
                b.Box(new Vector3(-0.7f, -0.2f, z0), new Vector3(0.7f, (i + 1) * 0.3f, 0.7f), Wood, Pal.Mul(WoodLight, 1f + 0.02f * i));
            }
        }

        // ---- furniture ----

        static void Bed(MeshBuilder b, int v)
        {
            Color[] blanket = { Pal.Rgb(0xb9503f), Pal.Rgb(0x4f7ab0), Pal.Rgb(0x5f9a5a), Pal.Rgb(0xc9a23f) };
            b.Box(new Vector3(-0.7f, 0, -0.42f), new Vector3(0.7f, 0.3f, 0.42f), Wood);
            b.Box(new Vector3(-0.66f, 0.3f, -0.38f), new Vector3(0.66f, 0.45f, 0.38f), Pal.Rgb(0xf0e8d6));
            b.Box(new Vector3(-0.1f, 0.3f, -0.39f), new Vector3(0.66f, 0.5f, 0.39f), blanket[v % 4]);
            b.Box(new Vector3(-0.62f, 0.45f, -0.28f), new Vector3(-0.3f, 0.55f, 0.28f), Pal.Rgb(0xfbf7ee));
            b.Box(new Vector3(-0.72f, 0, -0.44f), new Vector3(-0.64f, 0.8f, 0.44f), WoodDark);
        }

        static void Table(MeshBuilder b)
        {
            b.Box(new Vector3(-0.55f, 0.7f, -0.36f), new Vector3(0.55f, 0.78f, 0.36f), WoodLight);
            foreach (var sx in new[] { -0.48f, 0.42f })
                foreach (var sz in new[] { -0.3f, 0.24f })
                    b.Box(new Vector3(sx, 0, sz), new Vector3(sx + 0.07f, 0.7f, sz + 0.07f), Wood);
        }

        static void Hearth(MeshBuilder b)
        {
            b.Box(new Vector3(-0.65f, 0, -0.35f), new Vector3(0.65f, 1.0f, 0.3f), Stone);
            b.Box(new Vector3(-0.35f, 0.1f, 0.29f), new Vector3(0.35f, 0.6f, 0.33f), Pal.Rgb(0x2b2622));
            b.Box(new Vector3(-0.2f, 0.12f, 0.31f), new Vector3(0.2f, 0.3f, 0.35f), Pal.Rgb(0xff8a3a));
            b.Box(new Vector3(-0.3f, 1.0f, -0.28f), new Vector3(0.3f, 2.4f, 0.22f), StoneDark);
        }

        static void Chest(MeshBuilder b)
        {
            b.Box(new Vector3(-0.35f, 0, -0.22f), new Vector3(0.35f, 0.4f, 0.22f), Wood);
            b.Box(new Vector3(-0.37f, 0.4f, -0.24f), new Vector3(0.37f, 0.52f, 0.24f), WoodLight);
            b.Box(new Vector3(-0.04f, 0.28f, 0.22f), new Vector3(0.04f, 0.46f, 0.26f), Pal.Rgb(0xd8b75a));
            b.Box(new Vector3(-0.36f, 0, -0.23f), new Vector3(-0.28f, 0.52f, 0.23f), Pal.Rgb(0x4a4a4e));
            b.Box(new Vector3(0.28f, 0, -0.23f), new Vector3(0.36f, 0.52f, 0.23f), Pal.Rgb(0x4a4a4e));
        }

        static void Shelf(MeshBuilder b, int v)
        {
            Color[] items = { Pal.Rgb(0xb9503f), Pal.Rgb(0x4f7ab0), Pal.Rgb(0xd8b75a), Pal.Rgb(0x6aa05a), Pal.Rgb(0xe8dcc0) };
            b.Box(new Vector3(-0.6f, 0, -0.18f), new Vector3(0.6f, 1.7f, -0.1f), WoodDark);
            for (int i = 0; i < 4; i++)
            {
                b.Box(new Vector3(-0.62f, 0.1f + i * 0.45f, -0.2f), new Vector3(0.62f, 0.16f + i * 0.45f, 0.1f), Wood);
                for (int k = 0; k < 4; k++)
                {
                    float x = -0.5f + k * 0.28f + Hash.F(v, i, k) * 0.08f;
                    b.Box(new Vector3(x, 0.16f + i * 0.45f, -0.12f), new Vector3(x + 0.14f, 0.16f + i * 0.45f + 0.12f + Hash.F(v, k, i) * 0.12f, 0.02f), items[(int)(Hash.H(v, i, k) % 5)]);
                }
            }
        }

        static void Anvil(MeshBuilder b)
        {
            Color iron = Pal.Rgb(0x4a4c52);
            b.Box(new Vector3(-0.22f, 0, -0.22f), new Vector3(0.22f, 0.3f, 0.22f), Wood);
            b.Box(new Vector3(-0.16f, 0.3f, -0.12f), new Vector3(0.16f, 0.5f, 0.12f), iron);
            b.Box(new Vector3(-0.38f, 0.5f, -0.14f), new Vector3(0.3f, 0.66f, 0.14f), Pal.Mul(iron, 1.15f));
            b.Frustum(new Vector3(0.3f, 0.58f, 0), 0.08f, 0.02f, 0.01f, 4, iron);
        }

        static void Altar(MeshBuilder b)
        {
            b.Box(new Vector3(-0.55f, 0, -0.35f), new Vector3(0.55f, 0.85f, 0.35f), Pal.Rgb(0xdad6ca));
            b.Box(new Vector3(-0.58f, 0.85f, -0.38f), new Vector3(0.58f, 0.93f, 0.38f), Pal.Rgb(0xece9df));
            b.Box(new Vector3(-0.15f, 0.93f, -0.4f), new Vector3(0.15f, 0.95f, 0.4f), Pal.Rgb(0x8a3a4a));
            b.Frustum(new Vector3(-0.4f, 0.93f, 0), 0.04f, 0.04f, 0.22f, 5, Pal.Rgb(0xf1e6c8));
            b.Frustum(new Vector3(0.4f, 0.93f, 0), 0.04f, 0.04f, 0.22f, 5, Pal.Rgb(0xf1e6c8));
        }

        static void Barrel(MeshBuilder b)
        {
            b.Frustum(Vector3.zero, 0.34f, 0.32f, 0.9f, 8, Wood);
            b.Frustum(new Vector3(0, 0.15f, 0), 0.36f, 0.36f, 0.08f, 8, WoodDark, false);
            b.Frustum(new Vector3(0, 0.65f, 0), 0.36f, 0.34f, 0.08f, 8, WoodDark, false);
        }

        static void Counter(MeshBuilder b)
        {
            b.Box(new Vector3(-0.72f, 0, -0.28f), new Vector3(0.72f, 0.92f, 0.28f), Wood);
            b.Box(new Vector3(-0.76f, 0.92f, -0.32f), new Vector3(0.76f, 1.0f, 0.32f), WoodLight);
        }

        static void Bench(MeshBuilder b)
        {
            b.Box(new Vector3(-0.6f, 0.42f, -0.17f), new Vector3(0.6f, 0.5f, 0.17f), WoodLight);
            b.Box(new Vector3(-0.5f, 0, -0.12f), new Vector3(-0.42f, 0.42f, 0.12f), Wood);
            b.Box(new Vector3(0.42f, 0, -0.12f), new Vector3(0.5f, 0.42f, 0.12f), Wood);
        }

        static void Crate(MeshBuilder b, int v)
        {
            b.Box(new Vector3(-0.3f, 0, -0.3f), new Vector3(0.3f, 0.6f, 0.3f), Wood, WoodLight);
            b.Box(new Vector3(-0.31f, 0.25f, -0.31f), new Vector3(0.31f, 0.33f, 0.31f), WoodDark);
        }
    }
}
