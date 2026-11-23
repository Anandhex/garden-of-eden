// Procedural characters and creatures: chunky low-poly bodies built from MeshBuilder, vertex-coloured, with separate
// limb meshes (pivoting at the shoulder/hip) so they can swing when walking. Limb meshes are cached by colour; the
// body mesh is unique per actor (it carries that actor's skin, hair and clothes).
using System.Collections.Generic;
using UnityEngine;
using GardenOfEden.Net;

namespace GardenOfEden.World
{
    public sealed class ActorModel
    {
        public Mesh body;
        public bool ownsBody = true;
        public readonly List<LimbPart> limbs = new List<LimbPart>();
        public float height = 1.7f;
        public float radius = 0.3f;
        /// <summary>Species size, multiplied with look.size.</summary>
        public float scale = 1f;
        public bool quadruped, spider, upright;
    }

    public struct LimbPart
    {
        public Mesh mesh;
        public Vector3 pivot;
        public float phase;     // 0 or PI: which leg pair
        public float amp;       // swing amplitude in degrees
        public bool arm;
    }

    public static class ActorModels
    {
        static readonly Dictionary<string, Mesh> limbCache = new Dictionary<string, Mesh>();
        static readonly int[] Skin = { 0xf1c9a5, 0xe0ac84, 0xc68863, 0x9a6a47, 0x6f4a32 };
        static readonly int[] Hair = { 0x2b2118, 0x5a3a22, 0x8a5a2b, 0xc9a24f, 0x8d8d90, 0x3a2a2a };

        static Mesh Cached(string key, System.Func<MeshBuilder> make)
        {
            if (limbCache.TryGetValue(key, out var m) && m != null) return m;
            m = make().ToMesh(key);
            limbCache[key] = m;
            return m;
        }

        public static Color ParseTint(string hex, uint seed)
        {
            if (!string.IsNullOrEmpty(hex) && ColorUtility.TryParseHtmlString(hex, out var c)) return new Color(c.r, c.g, c.b, 1f);
            float h = (seed % 360) / 360f;
            return Color.HSVToRGB(h, 0.35f, 0.7f);
        }

        // ------------------------------------------------------------------ people

        public static ActorModel Person(Actor a, bool isPlayer)
        {
            uint seed = Hash.Str(a.id);
            Color tint = ParseTint(a.look.tint, seed);
            Color trim = string.IsNullOrEmpty(a.look.trim) ? Pal.Mul(tint, 0.6f) : ParseTint(a.look.trim, seed);
            bool noble = a.HasFlag(ActorFlag.Noble), hostile = a.HasFlag(ActorFlag.Hostile);
            Color skin = Pal.Rgb(Skin[(seed >> 3) % Skin.Length]);
            Color hair = Pal.Rgb(Hair[(seed >> 7) % Hair.Length]);
            Color pants = Color.Lerp(Pal.Mul(tint, 0.45f), Pal.Rgb(0x6a5440), 0.55f);
            if (a.HasFlag(ActorFlag.Lowborn)) { tint = Color.Lerp(tint, Pal.Rgb(0x8a7a62), 0.5f); }

            var m = new ActorModel { height = 1.75f, radius = 0.28f, upright = true };
            var b = new MeshBuilder();
            b.Frustum(new Vector3(0, 0.76f, 0), 0.2f, 0.17f, 0.62f, 8, tint);
            b.Frustum(new Vector3(0, 0.76f, 0), 0.205f, 0.205f, 0.08f, 8, trim, false);
            b.Frustum(new Vector3(0, 1.3f, 0), 0.19f, 0.15f, 0.07f, 8, noble ? trim : Pal.Mul(tint, 1.1f));
            b.Blob(new Vector3(0, 1.55f, 0), new Vector3(0.16f, 0.18f, 0.16f), skin, 8, 5);
            b.Blob(new Vector3(0, 1.62f, -0.02f), new Vector3(0.175f, 0.15f, 0.175f), hair, 8, 4, 0.08f, (int)seed);
            Color eye = hostile ? Pal.Rgb(0xd62f2f) : Pal.Rgb(0x2a2420);
            b.Blob(new Vector3(-0.06f, 1.56f, 0.145f), new Vector3(0.025f, 0.03f, 0.02f), eye, 4, 2);
            b.Blob(new Vector3(0.06f, 1.56f, 0.145f), new Vector3(0.025f, 0.03f, 0.02f), eye, 4, 2);
            if (noble) b.Frustum(new Vector3(0, 1.7f, 0), 0.165f, 0.15f, 0.1f, 8, trim);
            if (isPlayer)
            {
                // A cloak and a pack so you can find yourself in a crowd.
                b.Box(new Vector3(-0.2f, 0.85f, -0.27f), new Vector3(0.2f, 1.4f, -0.17f), Pal.Rgb(0xc9503f));
                b.Box(new Vector3(-0.12f, 0.9f, -0.34f), new Vector3(0.12f, 1.2f, -0.26f), Pal.Rgb(0x8a6544));
            }
            m.body = b.ToMesh("person body " + a.id);

            string legKey = "leg|" + ColorUtility.ToHtmlStringRGB(pants);
            Mesh leg = Cached(legKey, () =>
            {
                var lb = new MeshBuilder();
                lb.Frustum(new Vector3(0, -0.8f, 0), 0.07f, 0.09f, 0.8f, 6, pants);
                lb.Blob(new Vector3(0, -0.77f, 0.04f), new Vector3(0.08f, 0.05f, 0.13f), Pal.Rgb(0x4a382a), 6, 2);
                return lb;
            });
            string armKey = "arm|" + ColorUtility.ToHtmlStringRGB(tint) + "|" + ColorUtility.ToHtmlStringRGB(skin);
            Mesh arm = Cached(armKey, () =>
            {
                var ab = new MeshBuilder();
                ab.Frustum(new Vector3(0, -0.55f, 0), 0.05f, 0.065f, 0.55f, 6, tint);
                ab.Blob(new Vector3(0, -0.6f, 0), new Vector3(0.055f, 0.06f, 0.055f), skin, 5, 3);
                return ab;
            });
            m.limbs.Add(new LimbPart { mesh = leg, pivot = new Vector3(-0.1f, 0.8f, 0), phase = 0f, amp = 38f });
            m.limbs.Add(new LimbPart { mesh = leg, pivot = new Vector3(0.1f, 0.8f, 0), phase = Mathf.PI, amp = 38f });
            m.limbs.Add(new LimbPart { mesh = arm, pivot = new Vector3(-0.24f, 1.33f, 0), phase = Mathf.PI, amp = 30f, arm = true });
            m.limbs.Add(new LimbPart { mesh = arm, pivot = new Vector3(0.24f, 1.33f, 0), phase = 0f, amp = 30f, arm = true });
            return m;
        }

        // ------------------------------------------------------------------ creatures

        struct Quad
        {
            public int body; public float len, w, legLen, legR, headR, snout, tail, neckUp, scale;
            public bool ears, tusks, mane, spikes;
        }

        public static ActorModel Creature(Actor a)
        {
            string id = a.look.sprite ?? "creature/beast";
            uint seed = Hash.Str(a.id);
            Color tintOverride = string.IsNullOrEmpty(a.look.tint) ? Color.clear : ParseTint(a.look.tint, seed);
            switch (id)
            {
                case "creature/spider": return Spider(a, tintOverride);
                case "creature/wolf": return Four(a, new Quad { body = 0x8a8c92, len = 0.95f, w = 0.3f, legLen = 0.48f, legR = 0.05f, headR = 0.17f, snout = 0.18f, tail = 0.45f, ears = true, scale = 1f }, tintOverride);
                case "creature/bear": return Four(a, new Quad { body = 0x5e4333, len = 1.15f, w = 0.55f, legLen = 0.5f, legR = 0.11f, headR = 0.25f, snout = 0.17f, tail = 0.12f, ears = true, scale = 1.25f }, tintOverride);
                case "creature/boar": return Four(a, new Quad { body = 0x4d3a2f, len = 0.9f, w = 0.4f, legLen = 0.3f, legR = 0.06f, headR = 0.2f, snout = 0.22f, tail = 0.15f, ears = true, tusks = true, mane = true, scale = 1f }, tintOverride);
                case "creature/horse": return Four(a, new Quad { body = 0x9a6a3f, len = 1.3f, w = 0.4f, legLen = 0.85f, legR = 0.065f, headR = 0.17f, snout = 0.32f, tail = 0.6f, neckUp = 0.5f, ears = true, mane = true, scale = 1f }, tintOverride);
                default: return Four(a, new Quad { body = 0x6e4f80, len = 1.0f, w = 0.4f, legLen = 0.45f, legR = 0.07f, headR = 0.2f, snout = 0.2f, tail = 0.5f, ears = true, spikes = true, scale = 1.1f }, tintOverride);
            }
        }

        static ActorModel Four(Actor a, Quad q, Color tintOverride)
        {
            Color c = tintOverride.a > 0f ? tintOverride : Pal.Rgb(q.body);
            Color dark = Pal.Mul(c, 0.6f);
            float bodyH = q.w * 0.95f;
            float yBody = q.legLen + bodyH * 0.35f;
            var b = new MeshBuilder();
            b.Blob(new Vector3(0, yBody, 0), new Vector3(q.w * 0.6f, bodyH * 0.62f, q.len * 0.55f), c, 8, 4, 0.04f, (int)Hash.Str(a.id));
            b.Blob(new Vector3(0, yBody - bodyH * 0.2f, 0), new Vector3(q.w * 0.5f, bodyH * 0.4f, q.len * 0.45f), Pal.Lighten(c, 0.18f), 7, 3);
            float headY = yBody + q.neckUp + bodyH * 0.2f, headZ = q.len * 0.5f + q.headR * 0.5f + q.neckUp * 0.25f;
            if (q.neckUp > 0f) b.Frustum(new Vector3(0, yBody, q.len * 0.3f), q.w * 0.35f, q.w * 0.2f, q.neckUp, 6, c, true);
            b.Blob(new Vector3(0, headY, headZ), new Vector3(q.headR, q.headR * 0.95f, q.headR * 1.1f), c, 7, 4);
            b.Blob(new Vector3(0, headY - q.headR * 0.2f, headZ + q.headR * 0.8f + q.snout * 0.3f), new Vector3(q.headR * 0.5f, q.headR * 0.45f, q.snout), Pal.Lighten(c, 0.1f), 6, 3);
            b.Blob(new Vector3(0, headY - q.headR * 0.12f, headZ + q.headR * 0.8f + q.snout * 0.9f), new Vector3(q.headR * 0.18f, q.headR * 0.14f, q.headR * 0.14f), Pal.Rgb(0x1f1a18), 4, 2);
            Color eye = a.HasFlag(ActorFlag.Hostile) ? Pal.Rgb(0xe03a2f) : Pal.Rgb(0x1f1a18);
            b.Blob(new Vector3(-q.headR * 0.55f, headY + q.headR * 0.2f, headZ + q.headR * 0.65f), Vector3.one * q.headR * 0.14f, eye, 4, 2);
            b.Blob(new Vector3(q.headR * 0.55f, headY + q.headR * 0.2f, headZ + q.headR * 0.65f), Vector3.one * q.headR * 0.14f, eye, 4, 2);
            if (q.ears)
            {
                b.Spike(new Vector3(-q.headR * 0.6f, headY + q.headR * 0.7f, headZ - 0.02f), new Vector3(-q.headR * 0.7f, headY + q.headR * 1.7f, headZ - 0.05f), q.headR * 0.28f, dark, 4);
                b.Spike(new Vector3(q.headR * 0.6f, headY + q.headR * 0.7f, headZ - 0.02f), new Vector3(q.headR * 0.7f, headY + q.headR * 1.7f, headZ - 0.05f), q.headR * 0.28f, dark, 4);
            }
            if (q.tusks)
            {
                b.Spike(new Vector3(-q.headR * 0.35f, headY - q.headR * 0.45f, headZ + q.headR * 1.2f), new Vector3(-q.headR * 0.5f, headY + q.headR * 0.05f, headZ + q.headR * 1.35f), 0.025f, Pal.Rgb(0xf1ead6), 3);
                b.Spike(new Vector3(q.headR * 0.35f, headY - q.headR * 0.45f, headZ + q.headR * 1.2f), new Vector3(q.headR * 0.5f, headY + q.headR * 0.05f, headZ + q.headR * 1.35f), 0.025f, Pal.Rgb(0xf1ead6), 3);
            }
            if (q.mane) for (int i = 0; i < 5; i++) b.Blob(new Vector3(0, yBody + bodyH * 0.55f + q.neckUp * (0.2f + i * 0.15f), q.len * (0.35f - i * 0.1f)), new Vector3(0.05f, 0.1f, 0.1f), dark, 4, 2);
            if (q.spikes) for (int i = 0; i < 5; i++) b.Spike(new Vector3(0, yBody + bodyH * 0.5f, q.len * (0.35f - i * 0.17f)), new Vector3(0, yBody + bodyH * 0.5f + 0.22f, q.len * (0.3f - i * 0.17f)), 0.05f, Pal.Rgb(0xd9c9a0), 4);
            b.Spike(new Vector3(0, yBody + bodyH * 0.1f, -q.len * 0.5f), new Vector3(0, yBody + bodyH * 0.2f + q.tail * 0.3f, -q.len * 0.5f - q.tail), q.w * 0.14f, c, 4);

            var m = new ActorModel { body = b.ToMesh("creature body " + a.id), height = (headY + q.headR * 1.5f), radius = q.len * 0.5f * q.scale, quadruped = true };
            string legKey = "qleg|" + ColorUtility.ToHtmlStringRGB(c) + "|" + q.legLen.ToString("0.00") + "|" + q.legR.ToString("0.000");
            Mesh leg = Cached(legKey, () =>
            {
                var lb = new MeshBuilder();
                lb.Frustum(new Vector3(0, -q.legLen, 0), q.legR * 0.75f, q.legR, q.legLen, 6, Pal.Mul(c, 0.9f));
                lb.Blob(new Vector3(0, -q.legLen + 0.02f, 0.02f), new Vector3(q.legR * 0.95f, 0.04f, q.legR * 1.4f), Pal.Mul(c, 0.5f), 5, 2);
                return lb;
            });
            float lz = q.len * 0.32f, lx = q.w * 0.38f;
            m.limbs.Add(new LimbPart { mesh = leg, pivot = new Vector3(-lx, q.legLen, lz), phase = 0f, amp = 32f });
            m.limbs.Add(new LimbPart { mesh = leg, pivot = new Vector3(lx, q.legLen, lz), phase = Mathf.PI, amp = 32f });
            m.limbs.Add(new LimbPart { mesh = leg, pivot = new Vector3(-lx, q.legLen, -lz), phase = Mathf.PI, amp = 32f });
            m.limbs.Add(new LimbPart { mesh = leg, pivot = new Vector3(lx, q.legLen, -lz), phase = 0f, amp = 32f });
            m.scale = q.scale;
            return m;
        }

        static ActorModel Spider(Actor a, Color tintOverride)
        {
            Color c = tintOverride.a > 0f ? tintOverride : Pal.Rgb(0x2f2733);
            var b = new MeshBuilder();
            b.Blob(new Vector3(0, 0.38f, 0.12f), new Vector3(0.24f, 0.2f, 0.28f), c, 7, 4, 0.05f, 3);
            b.Blob(new Vector3(0, 0.45f, -0.3f), new Vector3(0.3f, 0.26f, 0.36f), Pal.Lighten(c, 0.05f), 7, 4, 0.05f, 4);
            b.Blob(new Vector3(0, 0.5f, -0.3f), new Vector3(0.1f, 0.05f, 0.14f), Pal.Rgb(0x8f2f3a), 5, 2);
            for (int i = 0; i < 4; i++) b.Blob(new Vector3(-0.075f + 0.05f * (i % 2) * 1.5f, 0.45f, 0.36f), Vector3.one * 0.03f, Pal.Rgb(0xe03a2f), 4, 2);
            b.Spike(new Vector3(-0.06f, 0.3f, 0.36f), new Vector3(-0.06f, 0.18f, 0.5f), 0.025f, c, 3);
            b.Spike(new Vector3(0.06f, 0.3f, 0.36f), new Vector3(0.06f, 0.18f, 0.5f), 0.025f, c, 3);
            var m = new ActorModel { body = b.ToMesh("spider body " + a.id), height = 0.8f, radius = 0.5f, spider = true };
            foreach (int s in new[] { -1, 1 })
            {
                string key = "sleg|" + s + "|" + ColorUtility.ToHtmlStringRGB(c);
                int ss = s;
                Mesh leg = Cached(key, () =>
                {
                    var lb = new MeshBuilder();
                    Vector3 knee = new Vector3(ss * 0.4f, 0.18f, 0f);
                    lb.Spike(Vector3.zero, knee, 0.03f, Pal.Mul(c, 1.1f), 3);
                    lb.Spike(knee, new Vector3(ss * 0.68f, -0.36f, 0f), 0.026f, Pal.Mul(c, 0.9f), 3);
                    return lb;
                });
                for (int i = 0; i < 4; i++)
                    m.limbs.Add(new LimbPart { mesh = leg, pivot = new Vector3(s * 0.14f, 0.38f, 0.28f - i * 0.17f), phase = ((i + (s > 0 ? 1 : 0)) % 2) * Mathf.PI, amp = 22f });
            }
            return m;
        }

        // ------------------------------------------------------------------ other

        public static ActorModel Fx(Actor a)
        {
            var b = new MeshBuilder();
            var m = new ActorModel { height = 0.8f, radius = 0.3f };
            if (a.look.sprite == "fx/grave")
            {
                Color stone = Pal.Rgb(0xa8a69f);
                b.Box(new Vector3(-0.25f, 0, -0.08f), new Vector3(0.25f, 0.65f, 0.08f), stone);
                b.Blob(new Vector3(0, 0.65f, 0), new Vector3(0.25f, 0.2f, 0.08f), Pal.Mul(stone, 1.05f), 7, 3);
                b.Blob(new Vector3(0, 0.07f, 0.45f), new Vector3(0.3f, 0.12f, 0.55f), Pal.Rgb(0x6f5a44), 7, 3, 0.1f, 9);
            }
            else
            {
                Color c = ParseTint(a.look.tint, Hash.Str(a.id));
                b.Blob(new Vector3(0, 0.6f, 0), Vector3.one * 0.14f, Pal.Lighten(c, 0.5f), 6, 3);
            }
            m.body = b.ToMesh("fx " + a.id);
            return m;
        }

        public static ActorModel For(Actor a, bool isPlayer)
        {
            string s = a.look != null ? a.look.sprite : null;
            if (ArtIds.IsFx(s)) return Fx(a);
            if (ArtIds.IsCreature(s) || a.kind == ActorKind.Creature) return Creature(a);
            return Person(a, isPlayer);
        }
    }
}
