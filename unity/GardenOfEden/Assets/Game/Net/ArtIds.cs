// Art ids the frame can send (packages/shared/src/view/art.ts). Ids name art, never an engine's keys: keep your own
// manifest from these ids to assets, with a fallback per family so an unknown id never draws as nothing.
namespace GardenOfEden.Net
{
    public static class ArtIds
    {
        /// <summary>Patch `ground` values index this list.</summary>
        public static readonly string[] TERRAIN_IDS =
        {
            "terrain/grass", "terrain/path", "terrain/water", "terrain/sand", "terrain/hill", "terrain/marsh",
            "terrain/field", "terrain/ford", "terrain/bridge", "terrain/town", "terrain/yard", "terrain/road",
        };

        /// <summary>Patch `objects` values index this list (0 is nothing, so element 0 is null).</summary>
        public static readonly string[] OBJECT_IDS =
        {
            null,
            "props/tree", "props/rock", "props/reeds", "props/milestone", "props/signpost", "props/shrine",
            "props/farmhouse", "props/bar", "props/thatch",
            "buildings/wall", "buildings/door", "buildings/gate",
            // Furniture inside buildings (N32).
            "props/bed", "props/table", "props/hearth", "props/chest", "props/shelf", "props/anvil", "props/altar",
            "props/barrel", "props/counter", "props/bench",
            // The stairs between a building's floors (G7 Part B).
            "buildings/stairs",
        };

        public static readonly string[] PEOPLE_IDS = { "people/body", "people/player" };
        public static readonly string[] CREATURE_IDS = { "creature/wolf", "creature/bear", "creature/boar", "creature/spider", "creature/horse", "creature/beast" };
        public static readonly string[] FX_IDS =
        {
            "fx/grave", "fx/shadow", "fx/marker", "fx/drop", "fx/flake", "fx/ripple", "fx/glow", "fx/firefly",
            "fx/dust", "fx/fog", "fx/shaft", "fx/leaves",
        };

        /// <summary>Mark kinds (frame.marks).</summary>
        public static readonly string[] MARK_KINDS = { "burned", "ruin", "scaffold", "grave", "stall_empty", "banner", "guards", "boarded", "memorial" };

        public const string FallbackTerrain = "terrain/grass";

        /// <summary>The terrain art id for a patch `ground` value; grass for an index out of range.</summary>
        public static string Terrain(int index) => index >= 0 && index < TERRAIN_IDS.Length ? TERRAIN_IDS[index] : FallbackTerrain;

        /// <summary>The object art id for a patch `objects` value; null for 0 or an index out of range.</summary>
        public static string Object(int index) => index > 0 && index < OBJECT_IDS.Length ? OBJECT_IDS[index] : null;

        /// <summary>The family of an art id: "terrain", "props", "buildings", "people", "creature", "fx"; "" if it has none.</summary>
        public static string Family(string id)
        {
            if (string.IsNullOrEmpty(id)) return "";
            int i = id.IndexOf('/');
            return i < 0 ? "" : id.Substring(0, i);
        }

        /// <summary>True when the id starts with the family prefix, e.g. IsFamily("people/body", "people/").</summary>
        public static bool IsFamily(string id, string prefix) => id != null && id.StartsWith(prefix, System.StringComparison.Ordinal);

        public static bool IsTerrain(string id) => IsFamily(id, "terrain/");
        public static bool IsPeople(string id) => IsFamily(id, "people/");
        public static bool IsCreature(string id) => IsFamily(id, "creature/");
        public static bool IsFx(string id) => IsFamily(id, "fx/");
        public static bool IsProp(string id) => IsFamily(id, "props/");
        public static bool IsBuildingPart(string id) => IsFamily(id, "buildings/");
    }
}
