// How each culture builds (the table behind BuildingBuilder). The server puts a style id on every building in the frame
// (`style`, the culture template id of the town: highland, river, coastal, forest, steppe, imperial; see
// packages/server/src/data/cultures/templates.json). Each id here is a complete, distinct architecture: wall material and
// palette, roof form and covering, storey height, window shape, shutters, doors, chimneys, foundations, porches,
// awnings, balconies and trim. Within a style BuildingBuilder varies each building by its id hash (colour shift,
// shutter colour, flower boxes, size). Kinds (inn, temple, hall, smithy...) lift the same style to a grander or plainer form.
//
// Stylised fantasy, warm and readable; all shapes are code-built, colours are sRGB hex.
using System.Collections.Generic;

namespace GardenOfEden.World
{
    public enum WallMat { Plaster, HalfTimber, Stone, Adobe, Logs, Boards, Ashlar }
    public enum RoofForm { Gable, Hip, Flat, Curved }
    public enum RoofMat { Thatch, Tile, Shingle, Slate, Turf, Flat }
    public enum WinShape { Rect, Arch, Round, Slit }
    public enum ChimKind { None, Stone, Brick, Capped, Pot }

    public sealed class Arch
    {
        public string id;
        public string description;

        public WallMat wall;
        public RoofForm roofForm;
        public RoofMat roofMat;
        public WinShape window;
        public ChimKind chimney;

        // Palettes (sRGB hex). One of each is picked per building by its id hash.
        public int[] walls;        // main wall colour
        public int[] walls2;       // second tone (upper storeys, panels, the stone behind the plaster)
        public int[] roofs;
        public int[] trims;        // frames, beams, posts
        public int[] shutters;
        public int[] accents;      // awnings, painted bands, door colours, flowers' leaf
        public int plinth;         // foundation stone
        public int doorColor;

        // Proportions.
        public float storeyH = 3f;
        public float pitch = 0.8f;       // roof rise over half-depth
        public float overhang = 0.45f;
        public float winW = 0.9f, winH = 1.1f, winBottom = 1.0f, winSpacing = 2.4f;
        public float doorW = 1.15f, doorH = 2.15f;
        public float foundation = 0.5f;

        // Features: chance 0..1 per building (1 = always).
        public float shuttersP, flowersP, awningP, porchP, balconyP, stepsP;
        public bool jetty;        // band/beam between storeys with brackets
        public bool cornice;      // projecting cornice + dentils under the eaves
        public bool quoins;       // alternating corner blocks
        public bool pilasters;    // flat columns on the front
        public bool parapet;      // flat roofs: low wall round the roof
        public bool vigas;        // log ends poking out under the roof
        public bool bargeboard;   // carved board on the gable edge
        public bool paintedBand;  // zig-zag painted frieze under the roof
        public bool buttress;     // sloped stone footing/buttress at corners
        public bool archDoor;     // round-topped door
    }

    public static class ArchitectureStyle
    {
        public const string Default = "river";

        static readonly Dictionary<string, Arch> table = Build();

        public static Arch Get(string id)
        {
            if (!string.IsNullOrEmpty(id) && table.TryGetValue(id, out var a)) return a;
            return table[Default];
        }

        public static bool Known(string id) => !string.IsNullOrEmpty(id) && table.ContainsKey(id);

        public static IEnumerable<string> Ids => table.Keys;

        static Dictionary<string, Arch> Build()
        {
            var t = new Dictionary<string, Arch>();

            // HIGHLAND (hills, clans): squat, thick dry-stone walls under heavy turf or heather roofs, deep little windows,
            // big stone chimneys at the gable end, no frills. Slate for the laird's hall.
            t["highland"] = new Arch
            {
                id = "highland",
                description = "dry-stone, turf roofs, small deep windows, gable chimney",
                wall = WallMat.Stone, roofForm = RoofForm.Gable, roofMat = RoofMat.Turf, window = WinShape.Slit, chimney = ChimKind.Stone,
                walls = new[] { 0x9a9283, 0x948a78, 0x979184, 0x827f78 },
                walls2 = new[] { 0x6f6c64, 0x78746a },
                roofs = new[] { 0x6f8a4a, 0x7a8f4e, 0x5f7a45, 0x6a5a45 },
                trims = new[] { 0x4a3a2c, 0x3f3226 },
                shutters = new[] { 0x4a5a6a, 0x5a4a3a },
                accents = new[] { 0x8a4a3a, 0x4b5d3a, 0x3c4f6b },
                plinth = 0x6a675f, doorColor = 0x4a3524,
                storeyH = 2.6f, pitch = 0.80f, overhang = 0.34f,
                winW = 0.42f, winH = 0.8f, winBottom = 1.1f, winSpacing = 2.9f, doorW = 1.0f, doorH = 1.95f, foundation = 0.35f,
                shuttersP = 0f, flowersP = 0.1f, awningP = 0f, porchP = 0.25f, balconyP = 0f, stepsP = 0.2f,
                buttress = true, archDoor = false,
            };

            // RIVER (valleys, plains, the old heartland): half-timbered plaster, steep thatch or red clay tile, jettied upper
            // storeys, shutters and flower boxes, brick chimneys. The generic cosy village.
            t["river"] = new Arch
            {
                id = "river",
                description = "half-timbered plaster, steep thatch or tile, shutters, flower boxes",
                wall = WallMat.HalfTimber, roofForm = RoofForm.Gable, roofMat = RoofMat.Thatch, window = WinShape.Rect, chimney = ChimKind.Brick,
                walls = new[] { 0xe9dcbc, 0xe3cfa0, 0xeadfc8, 0xdcc4a0, 0xe6d2b4 },
                walls2 = new[] { 0xcdb88f, 0xc8a98a },
                roofs = new[] { 0xcaa955, 0xb8944a, 0xc4663a, 0xb5573a, 0xd1a94e },
                trims = new[] { 0x5a3f28, 0x4f3822, 0x68482c },
                shutters = new[] { 0x4f7a58, 0x4f8a8a, 0x9a4a3a, 0x3f5f7a },
                accents = new[] { 0xc9503f, 0xe0b040, 0x7a4fa0, 0xe87a8a },
                plinth = 0x8d8b84, doorColor = 0x6a4a35,
                storeyH = 2.8f, pitch = 1.18f, overhang = 0.54f,
                winW = 0.85f, winH = 1.05f, winBottom = 0.95f, winSpacing = 2.3f, doorW = 1.1f, doorH = 2.1f, foundation = 0.45f,
                shuttersP = 0.85f, flowersP = 0.55f, awningP = 0f, porchP = 0.15f, balconyP = 0f, stepsP = 0.1f,
                jetty = true, archDoor = false,
            };

            // COASTAL (coast and marsh): whitewashed and pastel plaster, shallow terracotta hip roofs, arched openings, blue
            // shutters, striped awnings and little balconies, capped chimneys; flat parapet roofs for the better houses.
            t["coastal"] = new Arch
            {
                id = "coastal",
                description = "whitewash and pastel plaster, terracotta hip roofs, awnings, balconies",
                wall = WallMat.Plaster, roofForm = RoofForm.Hip, roofMat = RoofMat.Tile, window = WinShape.Arch, chimney = ChimKind.Capped,
                walls = new[] { 0xf2ece0, 0xf0e2c6, 0xe9c9a8, 0xcfe0e0, 0xf1d3c4, 0xf4e8b8 },
                walls2 = new[] { 0xe4d8c4, 0xd8c7ad },
                roofs = new[] { 0xc65a38, 0xd06a3e, 0xb94c32, 0xd47a48 },
                trims = new[] { 0xf4efe4, 0xe8dcc6 },
                shutters = new[] { 0x2a6b8a, 0x3a8aa5, 0x2f7a6a, 0x8a2a3a },
                accents = new[] { 0x2a6b8a, 0xc8a24a, 0x8a2a3a, 0xf2ece0 },
                plinth = 0xb9b0a0, doorColor = 0x2a6b8a,
                storeyH = 2.9f, pitch = 0.68f, overhang = 0.67f,
                winW = 0.8f, winH = 1.3f, winBottom = 0.9f, winSpacing = 2.2f, doorW = 1.15f, doorH = 2.3f, foundation = 0.4f,
                shuttersP = 0.9f, flowersP = 0.5f, awningP = 0.55f, porchP = 0f, balconyP = 0.4f, stepsP = 0.2f,
                archDoor = true,
            };

            // FOREST (forest folk): dark notched-log cabins, steep wooden-shingle roofs with carved bargeboards, deep porches,
            // squat stone chimneys. Everything leans on timber.
            t["forest"] = new Arch
            {
                id = "forest",
                description = "dark notched logs, steep shingle roofs, carved bargeboards, porches",
                wall = WallMat.Logs, roofForm = RoofForm.Gable, roofMat = RoofMat.Shingle, window = WinShape.Rect, chimney = ChimKind.Stone,
                walls = new[] { 0x6a4a2e, 0x5f4328, 0x74522f, 0x56402a },
                walls2 = new[] { 0x4a3420, 0x3f2c1c },
                roofs = new[] { 0x9a7440, 0x6f8450, 0xa8693a, 0x5f7a6a },
                trims = new[] { 0x2f2217, 0x3b2a1b },
                shutters = new[] { 0x6a8a4a, 0x9a4a3a, 0x3b2a1b },
                accents = new[] { 0xc9a23f, 0x9a4a3a, 0x6a8a4a },
                plinth = 0x6f6a5c, doorColor = 0x3b2a1b,
                storeyH = 2.5f, pitch = 1.33f, overhang = 0.82f,
                winW = 0.62f, winH = 0.78f, winBottom = 1.05f, winSpacing = 2.6f, doorW = 1.0f, doorH = 1.95f, foundation = 0.3f,
                shuttersP = 0.35f, flowersP = 0.1f, awningP = 0f, porchP = 0.8f, balconyP = 0f, stepsP = 0f,
                bargeboard = true, archDoor = false,
            };

            // STEPPE (open plains): sun-baked adobe and mud brick with flat parapet roofs and projecting roof beams, painted
            // red, blue and gold geometric bands, cloth awnings, round-topped doors, a smoke pot instead of a chimney.
            t["steppe"] = new Arch
            {
                id = "steppe",
                description = "adobe, flat parapet roofs, roof beams, painted bands, cloth awnings",
                wall = WallMat.Adobe, roofForm = RoofForm.Flat, roofMat = RoofMat.Flat, window = WinShape.Round, chimney = ChimKind.Pot,
                walls = new[] { 0xd2a878, 0xc89a68, 0xd9b384, 0xc0905f },
                walls2 = new[] { 0xb98a5c, 0xa87c52 },
                roofs = new[] { 0xb88a5a, 0xa87c52 },
                trims = new[] { 0x6a4026, 0x5a351f },
                shutters = new[] { 0xa83a2a, 0x2a4a8a, 0xc8882a },
                accents = new[] { 0xa83a2a, 0xc8882a, 0x2a4a8a, 0xe8d8b8 },
                plinth = 0xa07a54, doorColor = 0x2a4a8a,
                storeyH = 2.7f, pitch = 0.00f, overhang = 0.22f,
                winW = 0.62f, winH = 0.62f, winBottom = 1.25f, winSpacing = 2.5f, doorW = 1.05f, doorH = 2.0f, foundation = 0.3f,
                shuttersP = 0.15f, flowersP = 0.1f, awningP = 0.7f, porchP = 0f, balconyP = 0f, stepsP = 0f,
                parapet = true, vigas = true, paintedBand = true, archDoor = true,
            };

            // IMPERIAL (valley, hills and coast of the old empire): cut-stone ashlar and marble, red tile hip roofs, symmetrical
            // arched window rows, pilasters, cornices with dentils, steps up to a framed door, balconies on the grand houses.
            t["imperial"] = new Arch
            {
                id = "imperial",
                description = "ashlar and marble, red tile hip roofs, pilasters, cornices, steps",
                wall = WallMat.Ashlar, roofForm = RoofForm.Hip, roofMat = RoofMat.Tile, window = WinShape.Arch, chimney = ChimKind.Capped,
                walls = new[] { 0xe2d8c4, 0xd8cdb6, 0xe8e0ce, 0xd2c6ae },
                walls2 = new[] { 0xefe6d2, 0xe0d4bc },
                roofs = new[] { 0x9a3a2a, 0x8a2a2a, 0xa8452e },
                trims = new[] { 0xf2ead6, 0xe6dcc4 },
                shutters = new[] { 0x4a3a6a, 0x6a2a2a },
                accents = new[] { 0x8a2a2a, 0x4a3a6a, 0xd8b75a },
                plinth = 0xa8a090, doorColor = 0x4a3a6a,
                storeyH = 3.2f, pitch = 0.63f, overhang = 0.62f,
                winW = 0.85f, winH = 1.55f, winBottom = 0.85f, winSpacing = 2.5f, doorW = 1.3f, doorH = 2.5f, foundation = 0.55f,
                shuttersP = 0.1f, flowersP = 0.15f, awningP = 0f, porchP = 0f, balconyP = 0.45f, stepsP = 0.9f,
                cornice = true, quoins = true, pilasters = true, archDoor = true,
            };

            return t;
        }
    }
}
