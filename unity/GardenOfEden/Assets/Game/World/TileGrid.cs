// The loaded patches indexed by tile, and the land's height from them. Port of iso/terrain.ts: every tile corner
// stands at the average of the four tiles round it (smooth, no steps); a point between corners is interpolated over the
// same two triangles the terrain mesh uses, so feet meet the drawn ground exactly. Heights come from the server in
// eighths of a tile (Mirror.HeightAt divides by 8); a tile whose patch hasn't come is skipped in the average.
using System.Collections.Generic;
using UnityEngine;
using GardenOfEden.Net;

namespace GardenOfEden.World
{
    public sealed class TileGrid
    {
        public const int P = Mirror.PATCH;
        const int Water = 2;
        const int Bridge = 8;

        readonly Dictionary<long, Patch> map = new Dictionary<long, Patch>();
        float lastKnown;

        public static int FloorDiv(int a, int b)
        {
            int q = a / b;
            if (a % b != 0 && ((a < 0) != (b < 0))) q--;
            return q;
        }

        static long Key(int px, int py) => ((long)px << 32) | (long)(uint)unchecked(py);

        public void Clear() { map.Clear(); cornerCache.Clear(); Version++; lastKnown = 0f; minX = minY = int.MaxValue; maxX = maxY = int.MinValue; }

        /// <summary>Bumped whenever patches are added or dropped.</summary>
        public int Version { get; private set; }

        /// <summary>The loaded land's rectangle in world metres (x0, z0, x1, z1), false when nothing is loaded.</summary>
        public bool LoadedRect(out Vector4 r)
        {
            r = default;
            if (minX > maxX) return false;
            r = new Vector4(minX * WorldView.TileSize, minY * WorldView.TileSize, (maxX + 1) * WorldView.TileSize, (maxY + 1) * WorldView.TileSize);
            return true;
        }

        int minX = int.MaxValue, minY = int.MaxValue, maxX = int.MinValue, maxY = int.MinValue;

        public void Set(Patch p)
        {
            map[Key(FloorDiv(p.x0, P), FloorDiv(p.y0, P))] = p;
            minX = Mathf.Min(minX, p.x0); minY = Mathf.Min(minY, p.y0);
            maxX = Mathf.Max(maxX, p.x0 + p.w - 1); maxY = Mathf.Max(maxY, p.y0 + p.h - 1);
            cornerCache.Clear();
            Version++;
        }

        public Patch Find(int x, int y)
        {
            if (!map.TryGetValue(Key(FloorDiv(x, P), FloorDiv(y, P)), out var p)) return null;
            return p.Contains(x, y) ? p : null;
        }

        public bool Has(int x, int y) => Find(x, y) != null;

        /// <summary>The terrain index at a tile, or -1 when its patch has not come.</summary>
        public int Ground(int x, int y)
        {
            var p = Find(x, y);
            if (p == null) return -1;
            int i = p.IndexOf(x, y);
            return i < p.ground.Length ? p.ground[i] : 0;
        }

        public int Object(int x, int y)
        {
            var p = Find(x, y);
            if (p == null) return 0;
            int i = p.IndexOf(x, y);
            return i < p.objects.Length ? p.objects[i] : 0;
        }

        /// <summary>Tile height in tiles of height; NaN if unknown.</summary>
        public float TileH(int x, int y)
        {
            var p = Find(x, y);
            if (p == null) return float.NaN;
            int i = p.IndexOf(x, y);
            return p.EighthsAt(i) / 8f;
        }

        /// <summary>Set by WorldView: true when a tile is a building's pad (or a tile round it): streets there are not smoothed.</summary>
        public System.Func<int, int, bool> NearBuilding;

        readonly Dictionary<long, float> cornerCache = new Dictionary<long, float>();

        static bool RoadLike(int g) => g == 1 || g == 9 || g == 11;

        /// <summary>
        /// The height of the corner at the top-left of tile (cx, cy), in metres. A soft 4x4 average of the tiles round it
        /// (so the server's coarse steps never show), the lakes' beds sunk, and roads eased toward the wider lie of the land.
        /// </summary>
        public float Corner(int cx, int cy)
        {
            if (minX <= maxX) { cx = Mathf.Clamp(cx, minX, maxX + 1); cy = Mathf.Clamp(cy, minY, maxY + 1); }   // beyond the loaded land the ground keeps its edge height
            long key = ((long)cx << 32) | (long)(uint)unchecked(cy);
            if (cornerCache.TryGetValue(key, out float cached)) return cached;
            float y = ComputeCorner(cx, cy);
            cornerCache[key] = y;
            return y;
        }

        static readonly float[] K4 = { 1f, 3f, 3f, 1f };

        float ComputeCorner(int cx, int cy)
        {
            float sum = 0f, wsum = 0f;
            int water = 0, near = 0, road = 0;
            for (int j = 0; j < 4; j++)
                for (int i = 0; i < 4; i++)
                {
                    int tx = cx - 2 + i, ty = cy - 2 + j;
                    var p = Find(tx, ty);
                    if (p == null) continue;
                    int idx = p.IndexOf(tx, ty);
                    float w = K4[i] * K4[j];
                    sum += w * p.EighthsAt(idx) / 8f;
                    wsum += w;
                    if (i >= 1 && i <= 2 && j >= 1 && j <= 2)
                    {
                        near++;
                        int g = idx < p.ground.Length ? p.ground[idx] : 0;
                        if (g == Water) water++;
                        if (RoadLike(g)) road++;
                    }
                }
            if (wsum <= 0f || near == 0) return lastKnown;
            float y = sum / wsum * WorldView.HeightScale;

            // Streets and roads lie along the land more gently than the fields beside them.
            if (road > 0 && water == 0 && !(NearBuilding != null && (NearBuilding(cx, cy) || NearBuilding(cx - 1, cy - 1) || NearBuilding(cx - 1, cy) || NearBuilding(cx, cy - 1))))
            {
                float s2 = 0f, w2 = 0f;
                for (int j = -3; j <= 3; j++)
                    for (int i = -3; i <= 3; i++)
                    {
                        var p = Find(cx + i, cy + j);
                        if (p == null) continue;
                        s2 += p.EighthsAt(p.IndexOf(cx + i, cy + j)) / 8f;
                        w2 += 1f;
                    }
                if (w2 > 0f) y = Mathf.Lerp(y, s2 / w2 * WorldView.HeightScale, 0.6f * road / 4f + 0.2f);
            }

            lastKnown = y;
            if (water > 0)
            {
                float f = water / 4f;
                y -= WorldView.WaterDepth * f * f;
            }
            else
            {
                y += (Hash.F(cx, cy, 3) - 0.5f) * 0.05f;
            }
            return y;
        }

        /// <summary>The ground height in metres at a world position.</summary>
        public float GroundY(float wx, float wz)
        {
            float tx = wx / WorldView.TileSize, tz = wz / WorldView.TileSize;
            int cx = Mathf.FloorToInt(tx), cy = Mathf.FloorToInt(tz);
            float fx = tx - cx, fz = tz - cy;
            float ha = Corner(cx, cy), hb = Corner(cx + 1, cy), hc = Corner(cx + 1, cy + 1), hd = Corner(cx, cy + 1);
            if (((cx + cy) & 1) == 0)
            {
                if (fz >= fx) return ha * (1f - fz) + hd * (fz - fx) + hc * fx;
                return ha * (1f - fx) + hb * (fx - fz) + hc * fz;
            }
            if (fx + fz <= 1f) return ha * (1f - fx - fz) + hd * fz + hb * fx;
            return hd * (1f - fx) + hc * (fx + fz - 1f) + hb * (1f - fz);
        }

        public static bool IsWaterLike(int ground) => ground == Water || ground == Bridge;
    }
}
