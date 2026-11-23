// Lamps, windows, fires and forges from mirror.lights as a pool of real point lights: only the ones nearest the
// player get a light (default 16 - keeps the M2 happy); the rest are just lit panes/flames. Values are lightPlan.ts's
// LIGHT_LOOK, scaled to metres. Fires flicker; lights ease in and out as they are handed round.
using System.Collections.Generic;
using UnityEngine;
using GardenOfEden.Net;
using ULight = UnityEngine.Light;
using NetLight = GardenOfEden.Net.Light;

namespace GardenOfEden.World
{
    public sealed class LightPool
    {
        struct Look { public Color color; public float radius, intensity, flicker, height; }

        static Look LookOf(string kind)
        {
            switch (kind)
            {
                case "lamp": return new Look { color = Pal.Rgb(0xffd890), radius = 3.2f, intensity = 1.3f, flicker = 0.04f, height = 2.6f };
                case "fire": return new Look { color = Pal.Rgb(0xff8a3a), radius = 3.6f, intensity = 1.6f, flicker = 0.22f, height = 0.7f };
                case "torch": return new Look { color = Pal.Rgb(0xffa050), radius = 2.8f, intensity = 1.4f, flicker = 0.18f, height = 1.9f };
                case "forge": return new Look { color = Pal.Rgb(0xff6a2a), radius = 3.4f, intensity = 1.7f, flicker = 0.16f, height = 1.2f };
                case "magic": return new Look { color = Pal.Rgb(0x8ab8ff), radius = 3.0f, intensity = 1.2f, flicker = 0.1f, height = 1.6f };
                default: return new Look { color = Pal.Rgb(0xffc46a), radius = 2.4f, intensity = 1.1f, flicker = 0f, height = 1.5f };   // window
            }
        }

        sealed class Slot
        {
            public ULight light;
            public string id;
            public Look look;
            public float target, cur, seed;
        }

        struct Cand { public float d; public NetLight l; }

        readonly WorldView world;
        readonly Slot[] slots;
        readonly List<Cand> cands = new List<Cand>();
        readonly HashSet<string> chosen = new HashSet<string>();
        float nextAssign;
        public bool dirty = true;

        public LightPool(WorldView world, Transform root, int count)
        {
            this.world = world;
            slots = new Slot[Mathf.Max(0, count)];
            for (int i = 0; i < slots.Length; i++)
            {
                var go = new GameObject("light " + i);
                go.transform.SetParent(root, false);
                var l = go.AddComponent<ULight>();
                l.type = LightType.Point;
                l.shadows = LightShadows.None;
                l.intensity = 0f;
                l.enabled = false;
                slots[i] = new Slot { light = l };
            }
        }

        public void Clear()
        {
            foreach (var s in slots) { s.id = null; s.target = 0; s.cur = 0; s.light.intensity = 0; s.light.enabled = false; }
            dirty = true;
        }

        static float Flicker(float t, float seed, float amount)
        {
            if (amount <= 0f) return 1f;
            return 1f + amount * (0.55f * Mathf.Sin(t * 9.1f + seed) + 0.3f * Mathf.Sin(t * 23.7f + seed * 2.3f) + 0.15f * Mathf.Sin(t * 3.3f + seed * 0.7f));
        }

        public void Tick(float dt)
        {
            var mirror = world.Mirror;
            float darkness = 0.15f + 0.85f * (1f - Mathf.Clamp01((float)mirror.ambience.light));
            if ((dirty || Time.unscaledTime > nextAssign) && slots.Length > 0)
            {
                dirty = false;
                nextAssign = Time.unscaledTime + 0.25f;
                Assign(mirror);
            }
            float t = Time.time;
            foreach (var s in slots)
            {
                float goal = s.id != null ? s.target * darkness * Flicker(t, s.seed, s.look.flicker) : 0f;
                s.cur = Mathf.Lerp(s.cur, goal, 1f - Mathf.Exp(-6f * dt));
                s.light.intensity = s.cur;
                s.light.enabled = s.cur > 0.01f;
            }
        }

        void Assign(Mirror mirror)
        {
            Vector3 focus = world.FocusPoint;
            cands.Clear();
            foreach (var l in mirror.lights)
            {
                if (!l.on) continue;
                float dx = (float)l.x * WorldView.TileSize - focus.x, dz = (float)l.y * WorldView.TileSize - focus.z;
                cands.Add(new Cand { d = dx * dx + dz * dz, l = l });
            }
            cands.Sort((a, b) => { int c = a.d.CompareTo(b.d); return c != 0 ? c : string.CompareOrdinal(a.l.id, b.l.id); });
            int n = Mathf.Min(cands.Count, slots.Length);
            chosen.Clear();
            for (int i = 0; i < n; i++) chosen.Add(cands[i].l.id);
            // Free the slots whose light is no longer among the nearest.
            foreach (var s in slots) if (s.id != null && !chosen.Contains(s.id)) { s.id = null; }
            var have = new HashSet<string>();
            foreach (var s in slots) if (s.id != null) have.Add(s.id);
            int next = 0;
            for (int i = 0; i < n; i++)
            {
                var l = cands[i].l;
                if (have.Contains(l.id)) continue;
                while (next < slots.Length && slots[next].id != null) next++;
                if (next >= slots.Length) break;
                var s = slots[next];
                s.id = l.id;
                s.look = LookOf(l.kind);
                s.seed = (Hash.Str(l.id) % 1000) * 0.01f;
                s.cur = 0f;
                float wx = (float)l.x * WorldView.TileSize, wz = (float)l.y * WorldView.TileSize;
                s.light.transform.position = new Vector3(wx, world.GroundHeightAt(wx, wz) + s.look.height, wz);
                s.light.color = s.look.color;
                s.light.range = s.look.radius * WorldView.TileSize * 1.8f;
                s.target = s.look.intensity * 2.2f;
                next++;
            }
        }
    }
}
