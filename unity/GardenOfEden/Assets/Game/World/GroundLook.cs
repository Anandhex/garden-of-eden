// What the ground looks like at a point: the terrain's own colour, varied by smooth noise in world space (lighter and
// darker greens, a drift between yellow-green and blue-green, dry patches, sparse wildflower tints, paler sage on the
// heights), dirt and then rock on steep faces. Everything is a function of the world position, so there is no tile
// grid at any zoom, and the grass (GrassField) asks the same function so its blades match the ground under them.
// Colours are sRGB (Pal.Rgb); callers convert with Pal.Vtx for vertex colours.
using UnityEngine;

namespace GardenOfEden.World
{
    public static class GroundLook
    {
        static readonly Color Dry = Pal.Rgb(0xc9b66b), Dirt = Pal.Rgb(0xa98d5f), Rock = Pal.Rgb(0x9c9082), RockDark = Pal.Rgb(0x7f7468);
        static readonly Color Sage = Pal.Rgb(0xa8bf86), Lush = Pal.Rgb(0x5f9f5a);
        static readonly Color[] Blooms = { Pal.Rgb(0xe9a3a8), Pal.Rgb(0xf0d56a), Pal.Rgb(0xf2eadb), Pal.Rgb(0xb9a3e0) };

        /// <summary>Smooth value noise 0..1 over a lattice of cell size <paramref name="cell"/> metres.</summary>
        public static float Noise(float x, float z, float cell, int salt)
        {
            x /= cell; z /= cell;
            int ix = Mathf.FloorToInt(x), iz = Mathf.FloorToInt(z);
            float fx = x - ix, fz = z - iz;
            fx = fx * fx * (3f - 2f * fx); fz = fz * fz * (3f - 2f * fz);
            float a = Hash.F(ix, iz, salt), b = Hash.F(ix + 1, iz, salt), c = Hash.F(ix, iz + 1, salt), d = Hash.F(ix + 1, iz + 1, salt);
            return Mathf.Lerp(Mathf.Lerp(a, b, fx), Mathf.Lerp(c, d, fx), fz);
        }

        static float Step(float a, float b, float x) { float t = Mathf.Clamp01((x - a) / (b - a)); return t * t * (3f - 2f * t); }

        public static bool Grassy(int g) => g == 0 || g == 4 || g == 5 || g < 0;

        /// <summary>The ground's colour (sRGB) at a world point. slope = 1 - normal.y (0 flat); y = height in metres.</summary>
        public static Color Surface(int ground, float wx, float wz, float slope, float y)
        {
            Color c = Pal.TerrainBase(ground);
            bool grassy = Grassy(ground);
            float broad = Noise(wx, wz, 19f, 11) - 0.5f, mid = Noise(wx, wz, 6.5f, 23) - 0.5f, fine = Noise(wx, wz, 1.9f, 31) - 0.5f;
            float v = 1f + (grassy ? 0.26f : 0.10f) * broad + (grassy ? 0.09f : 0.04f) * mid + 0.06f * fine;
            c = new Color(c.r * v, c.g * v, c.b * v, 1f);
            if (grassy)
            {
                float hue = Noise(wx, wz, 27f, 41) - 0.5f;                      // yellow-green <-> blue-green
                c = new Color(c.r * (1f + 0.22f * hue), c.g * (1f + 0.02f * hue), c.b * (1f - 0.40f * hue), 1f);
                float high = Mathf.Clamp01((y - 4f) / 18f);
                float dry = Step(0.56f, 0.82f, Noise(wx, wz, 12f, 51)) * (0.30f + 0.70f * high);
                c = Color.Lerp(c, Dry, dry * 0.6f);
                c = Color.Lerp(c, Sage, high * 0.30f);
                float low = Mathf.Clamp01((3f - y) / 3f);
                c = Color.Lerp(c, Lush, low * 0.25f);
                if (ground == 0 && slope < 0.12f)
                {
                    // Wildflowers: small dabs, only inside meadow-wide patches.
                    float dab = Step(0.80f, 0.92f, Noise(wx, wz, 1.25f, 61)) * Step(0.50f, 0.70f, Noise(wx, wz, 11f, 62));
                    if (dab > 0f) c = Color.Lerp(c, Blooms[Hash.H(Mathf.FloorToInt(wx / 1.25f), Mathf.FloorToInt(wz / 1.25f), 63) % (uint)Blooms.Length], dab * 0.38f);
                }
            }
            if (ground != 2 && ground != 8)
            {
                float sl = slope + 0.04f * mid;
                float dirt = Step(0.07f, 0.17f, sl) * (grassy ? 0.65f : 0.25f);
                c = Color.Lerp(c, Dirt, dirt);
                float rock = Step(0.17f, 0.32f, sl);
                c = Color.Lerp(c, Color.Lerp(Rock, RockDark, Step(0.4f, 0.6f, Noise(wx, wz, 2.6f, 71))), rock * 0.9f);
            }
            return new Color(Mathf.Clamp01(c.r), Mathf.Clamp01(c.g), Mathf.Clamp01(c.b), 1f);
        }
    }
}
