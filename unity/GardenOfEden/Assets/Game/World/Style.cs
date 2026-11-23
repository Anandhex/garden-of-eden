// The look's palette and shared materials. Colours are written as sRGB hex, as artists think of them; vertex colours
// are converted to linear when the project is in linear colour space (vertex colours are not converted by Unity).
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering;

namespace GardenOfEden.World
{
    public static class Pal
    {
        public static Color Rgb(int hex) => new Color(((hex >> 16) & 255) / 255f, ((hex >> 8) & 255) / 255f, (hex & 255) / 255f, 1f);

        public static Color Mul(Color c, float f) => new Color(Mathf.Clamp01(c.r * f), Mathf.Clamp01(c.g * f), Mathf.Clamp01(c.b * f), 1f);

        public static Color Lighten(Color c, float t) => Color.Lerp(c, Color.white, t);

        public static Color Hex(string s, Color fallback) => !string.IsNullOrEmpty(s) && ColorUtility.TryParseHtmlString(s, out var c) ? new Color(c.r, c.g, c.b, 1f) : fallback;

        /// <summary>The colour to write into a vertex so it looks like <paramref name="c"/> on screen.</summary>
        public static Color Vtx(Color c)
        {
            if (QualitySettings.activeColorSpace != ColorSpace.Linear) return c;
            var l = c.linear;
            return new Color(l.r, l.g, l.b, 1f);
        }

        // ---- terrain (ArtIds.TERRAIN_IDS order) ----
        static readonly Color[] TerrainColours =
        {
            Rgb(0x88b45a), // grass
            Rgb(0xbfa577), // path
            Rgb(0x9a9373), // water (the bed under the water plane)
            Rgb(0xe3d29a), // sand
            Rgb(0x9bb862), // hill
            Rgb(0x6f8f5a), // marsh
            Rgb(0xb89f55), // field (tilled)
            Rgb(0xa9b3a2), // ford (pebbles)
            Rgb(0x94714a), // bridge (planks)
            Rgb(0xbdb3a0), // town (cobbles)
            Rgb(0xab9774), // yard (packed earth)
            Rgb(0xb89d70), // road
        };

        /// <summary>The terrain's plain colour (sRGB), before the ground look varies it.</summary>
        public static Color TerrainBase(int ground) => ground >= 0 && ground < TerrainColours.Length ? TerrainColours[ground] : TerrainColours[0];

        public static Color Terrain(int ground, int x, int y)
        {
            Color c = ground >= 0 && ground < TerrainColours.Length ? TerrainColours[ground] : TerrainColours[0];
            bool grassy = ground == 0 || ground == 4 || ground == 5 || ground < 0;
            // Broad patches of lighter and darker ground, and a little per-tile variety.
            float broad = Hash.F(x >> 2, y >> 2, 11) - 0.5f;
            float tile = Hash.F(x, y, 5) - 0.5f;
            float v = 1f + (grassy ? 0.10f : 0.05f) * broad + 0.04f * tile;
            if (grassy)
            {
                // Nudge the hue between yellow-green and blue-green.
                float h = Hash.F(x >> 3, y >> 3, 23) - 0.5f;
                c = new Color(c.r * (1f + 0.07f * h), c.g, c.b * (1f - 0.12f * h), 1f);
            }
            return Mul(c, v);
        }

        public static bool IsWaterGround(int g) => g == 2;
        public static bool IsGrassGround(int g) => g == 0 || g == 4;
    }

    /// <summary>Materials shared by the world. The toon material is white: colour comes from vertex colours.</summary>
    public static class Mats
    {
        static Material toon, water, glowWhite;
        static bool warned;

        static Shader FindToon()
        {
            var s = Shader.Find("GardenOfEden/ToonLit");
            if (s != null) return s;
            if (!warned) { Debug.LogWarning("GardenOfEden/ToonLit not found: falling back to URP/Lit (vertex colours will not show)."); warned = true; }
            s = Shader.Find("Universal Render Pipeline/Lit");
            return s != null ? s : Shader.Find("Sprites/Default");
        }

        static void SetColor(Material m, Color c)
        {
            if (m.HasProperty("_BaseColor")) m.SetColor("_BaseColor", c);
            if (m.HasProperty("_Color")) m.SetColor("_Color", c);
        }

        public static Material Toon()
        {
            if (toon == null)
            {
                toon = new Material(FindToon()) { name = "GardenOfEden World Toon" };
                SetColor(toon, Color.white);
                SoftLook(toon);
                toon.enableInstancing = true;
            }
            return toon;
        }

        static Material foliageMat;
        /// <summary>Leaves, bushes, reeds, crops: Toon with wind sway (UV0.x weight) and sun shining through from behind.</summary>
        public static Material Foliage()
        {
            if (foliageMat == null)
            {
                foliageMat = new Material(Toon()) { name = "GardenOfEden World Foliage" };
                foliageMat.EnableKeyword("_SWAY");
                if (foliageMat.HasProperty("_UseSway")) foliageMat.SetFloat("_UseSway", 1f);
                if (foliageMat.HasProperty("_SwayAmount")) foliageMat.SetFloat("_SwayAmount", 0.16f);
                if (foliageMat.HasProperty("_Translucency")) foliageMat.SetFloat("_Translucency", 0.4f);
                if (foliageMat.HasProperty("_RimStrength")) foliageMat.SetFloat("_RimStrength", 0.12f);
            }
            return foliageMat;
        }

        static Material groundMat;
        /// <summary>The terrain's material: Toon without the rim glows (at the grazing angles you see far ground from, a rim washes it out to a pale veil).</summary>
        public static Material Ground()
        {
            if (groundMat == null)
            {
                groundMat = new Material(Toon()) { name = "GardenOfEden World Ground" };
                if (groundMat.HasProperty("_RimStrength")) groundMat.SetFloat("_RimStrength", 0f);
                if (groundMat.HasProperty("_CoolRimStrength")) groundMat.SetFloat("_CoolRimStrength", 0.12f);
                groundMat.EnableKeyword("_GROUND_DETAIL");
                if (groundMat.HasProperty("_UseGroundDetail")) groundMat.SetFloat("_UseGroundDetail", 1f);
                groundMat.enableInstancing = true;
            }
            return groundMat;
        }

        /// <summary>The art direction's soft matte look: smooth wrapped ramp, no ink outline (the option stays in the shader).</summary>
        public static void SoftLook(Material m)
        {
            if (m.HasProperty("_OutlineWidth")) m.SetFloat("_OutlineWidth", 0f);
            if (m.HasProperty("_Bands")) m.SetFloat("_Bands", 4f);
            if (m.HasProperty("_Softness")) m.SetFloat("_Softness", 1f);
            if (m.HasProperty("_Wrap")) m.SetFloat("_Wrap", 0.5f);
            // Shadows that read (they were faint): a deeper, still tinted shade, never black.
            if (m.HasProperty("_ShadowColor")) m.SetColor("_ShadowColor", new Color(0.50f, 0.46f, 0.64f, 1f));
        }

        /// <summary>A plain coloured toon material (not the vertex-coloured one).</summary>
        public static Material ToonColour(Color c)
        {
            var m = new Material(FindToon()) { name = "GardenOfEden Toon " + ColorUtility.ToHtmlStringRGB(c) };
            SetColor(m, c);
            SoftLook(m);
            return m;
        }

        public static Material Water()
        {
            if (water != null) return water;
            var s = Shader.Find("GardenOfEden/ToonWater");
            if (s != null)
            {
                water = new Material(s) { name = "GardenOfEden World Water" };
                return water;
            }
            s = Shader.Find("Universal Render Pipeline/Unlit");
            if (s == null) s = Shader.Find("Sprites/Default");
            water = new Material(s) { name = "GardenOfEden World Water (fallback)" };
            SetColor(water, new Color(0.25f, 0.55f, 0.75f, 0.65f));
            MakeTransparent(water);
            return water;
        }

        static void MakeTransparent(Material m)
        {
            if (m.HasProperty("_Surface")) m.SetFloat("_Surface", 1f);
            if (m.HasProperty("_SrcBlend")) m.SetFloat("_SrcBlend", (float)BlendMode.SrcAlpha);
            if (m.HasProperty("_DstBlend")) m.SetFloat("_DstBlend", (float)BlendMode.OneMinusSrcAlpha);
            if (m.HasProperty("_ZWrite")) m.SetFloat("_ZWrite", 0f);
            m.SetOverrideTag("RenderType", "Transparent");
            m.EnableKeyword("_SURFACE_TYPE_TRANSPARENT");
            m.renderQueue = (int)RenderQueue.Transparent;
        }

        /// <summary>Unlit warm colour for lit window panes and flames.</summary>
        public static Material Glow()
        {
            if (glowWhite != null) return glowWhite;
            var s = Shader.Find("Universal Render Pipeline/Unlit");
            if (s == null) s = Shader.Find("Sprites/Default");
            glowWhite = new Material(s) { name = "GardenOfEden World Glow" };
            SetColor(glowWhite, new Color(1f, 0.80f, 0.45f, 1f));
            return glowWhite;
        }
    }
}
