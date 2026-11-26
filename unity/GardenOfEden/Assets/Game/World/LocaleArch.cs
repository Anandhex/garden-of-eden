// How the place changes its culture's way of building (G8 locality). ArchitectureStyle says how a culture builds; this
// says what the place itself does to that: the land (stilts and boards in the marsh, tall stone footings on the hills,
// logs and deep eaves under the forest, whitewash on the coast) and how well and how big the place lives (low thatched
// cottages in a poor hamlet, a storey more and finer roofs in a rich town or city, the hall the grandest thing there).
// The server sends the place's locale with every frame (map.locale: culture, terrain, wealth 0..1, size); BuildingParts
// applies these mods to the Style it made from the culture and the kind.
//
// Pure C# with no engine types, so it can be checked outside Unity. Chances come in as 0..1 draws from the building's
// id hash, so a building looks the same on every visit.
using System;

namespace GardenOfEden.World
{
    public sealed class LocaleMods
    {
        /// <summary>Floor raised on posts this high (metres); 0 for none.</summary>
        public float stilts;
        /// <summary>Added to the stone footing showing above the ground (metres).</summary>
        public float footing;
        public float pitchMul = 1f;
        public float overhangAdd;
        public float floorHMul = 1f;
        /// <summary>Storeys: -1 keep, else this many.</summary>
        public int floors = -1;
        /// <summary>Walls lightened towards white by this much (0..1): whitewash.</summary>
        public float whitewash;
        /// <summary>Walls rebuilt in this material ("" keep): Logs, Boards, Stone.</summary>
        public string wall = "";
        /// <summary>Wall colour to go with a new material (sRGB hex), 0 for none.</summary>
        public int wallColor;
        /// <summary>Roof re-laid ("" keep): Thatch, Tile.</summary>
        public string roof = "";
        public int roofColor;
        /// <summary>Plain living: no shutters, flowers or awnings, fewer chimneys.</summary>
        public bool plain;
        /// <summary>Well-off living: shutters and flowers where the culture has them.</summary>
        public bool fine;
        /// <summary>A short line for the tip/debug view.</summary>
        public string why = "";
    }

    public static class LocaleArch
    {
        static float SizeBonus(string size)
        {
            switch (size)
            {
                case "hamlet": return -0.15f;
                case "village": return -0.05f;
                case "town": return 0.05f;
                case "city": return 0.15f;
                case "capital": return 0.25f;
                default: return 0f;
            }
        }

        /// <summary>How grand a place is: its wealth (0..1) lifted by its size.</summary>
        public static float Standing(double wealth, string size) => (float)Math.Max(0.0, Math.Min(1.0, wealth)) + SizeBonus(size ?? "");

        public static bool IsHome(string kind) => kind == "house" || kind == "hut" || string.IsNullOrEmpty(kind);
        public static bool IsCivic(string kind) => kind == "hall" || kind == "guildhall" || kind == "manor" || kind == "temple" || kind == "inn" || kind == "barracks" || kind == "palace" || kind == "castle";
        public static bool IsWork(string kind) => kind == "smithy" || kind == "farm" || kind == "granary";

        /// <summary>
        /// The place's mods for one building. <paramref name="arch"/> is the culture style id, <paramref name="wall"/> and
        /// <paramref name="roofForm"/> the culture's own (by enum name), <paramref name="floors"/> the storeys the kind gave it,
        /// <paramref name="area"/> its footprint in tiles, and <paramref name="draw"/> a stable 0..1 draw per salt.
        /// </summary>
        public static LocaleMods For(string arch, string terrain, double wealth, string size, string kind, string wall, string roofForm, int floors, float area, Func<int, float> draw)
        {
            var m = new LocaleMods();
            if (string.IsNullOrEmpty(terrain) && string.IsNullOrEmpty(size)) return m;
            bool home = IsHome(kind), civic = IsCivic(kind), work = IsWork(kind);
            float standing = Standing(wealth, size);
            bool poor = standing < 0.42f, rich = standing > 0.66f;
            bool timber = wall == "HalfTimber" || wall == "Plaster" || wall == "Boards";
            bool pitched = roofForm == "Gable" || roofForm == "Curved";

            // ---- the land ----
            switch (terrain)
            {
                case "marsh":
                    if (civic) { m.footing += 0.6f; m.why += "raised on a stone platform above the marsh; "; }
                    else
                    {
                        m.stilts = 0.9f + 0.25f * draw(1);
                        if (wall != "Stone" && wall != "Ashlar" && wall != "Logs" && wall != "Adobe") { m.wall = "Boards"; m.wallColor = 0x8a7a5e; }
                        if (pitched && (home || work)) { m.roof = "Thatch"; m.roofColor = 0xb59a5a; }
                        m.why += "on stilts over the marsh, boards and reed thatch; ";
                    }
                    break;
                case "hills":
                    m.footing += 0.55f;
                    m.pitchMul *= 1.08f;
                    m.why += "tall stone footing on the slope; ";
                    break;
                case "forest":
                    m.overhangAdd += 0.25f;
                    m.pitchMul *= 1.06f;
                    if (home && timber && !rich) { m.wall = "Logs"; m.wallColor = 0x74522f; }
                    m.why += "deep eaves under the trees" + (m.wall == "Logs" ? ", log walls" : "") + "; ";
                    break;
                case "coast":
                    m.whitewash = 0.18f;
                    m.overhangAdd -= 0.08f;
                    m.why += "salt-whitened walls; ";
                    break;
                case "plains":
                    m.overhangAdd -= 0.06f;
                    m.pitchMul *= 0.95f;
                    break;
            }

            // ---- how well the place lives ----
            if (home)
            {
                if (poor || draw(2) < Math.Min(0.6f, (0.56f - standing) * 1.6f))
                {
                    m.plain = true;
                    m.floors = 1;
                    m.floorHMul *= 0.92f;
                    if (pitched && m.roof == "") { m.roof = "Thatch"; m.roofColor = 0xc6a356; }
                    m.why += "a plain low cottage; ";
                }
                else if (rich)
                {
                    m.fine = true;
                    if (area >= 6f && floors < 2 && draw(3) < 0.65f) m.floors = 2;
                    if (area >= 12f && draw(4) < 0.25f) m.floors = 3;
                    m.floorHMul *= 1.05f;
                    if (pitched && m.roof == "" && arch == "river" && draw(5) < 0.6f) { m.roof = "Tile"; m.roofColor = 0xb5573a; }
                    m.why += "a well-off house, taller; ";
                }
            }
            else if (civic)
            {
                if (rich && (kind == "hall" || kind == "guildhall" || kind == "inn") && floors < 3 && draw(6) < 0.6f) m.floors = floors + 1;
                if (poor && (kind == "inn" || kind == "hall") && floors > 1) m.floors = floors - 1;
                m.floorHMul *= rich ? 1.06f : 1f;
            }
            else if (work && poor && pitched && m.roof == "")
            {
                m.roof = "Thatch"; m.roofColor = 0xc6a356;
            }
            return m;
        }
    }
}
