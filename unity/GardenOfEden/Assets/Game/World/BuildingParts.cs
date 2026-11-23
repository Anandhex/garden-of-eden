// The architecture of a building: walls (stone courses, logs, planks, half-timber, adobe, ashlar), openings (windows with
// shutters and flower boxes, doors with porches, awnings and steps), roofs (gable, hip, flat with parapet, curved eaves, in
// thatch, tile, shingle, slate and turf) and the extras (chimneys, balconies, banners, turrets, domes). Everything is chosen
// from the building's culture style (ArchitectureStyle), its kind and its id hash.
//
// Closed exteriors: every wall is a solid slab (core + outer courses), wall tops are capped by the roof frieze, every roof
// has a soffit (underside), rake and eave edge faces and gable fills; roof planes meet at the ridge with a cap, so no
// interior is visible from outside at any camera angle.
using System.Collections.Generic;
using UnityEngine;
using GardenOfEden.Net;

namespace GardenOfEden.World
{
    public sealed partial class BuildingBuilder
    {
        struct Opening { public float u, w, bottom, height; public bool door; }

        sealed class Style
        {
            public Arch a;
            public uint h;
            public string kind;
            public Color wall, wall2, plinth, trim, roof, glass, floorCol, sign, shutter, accent, door, stone;
            public WallMat wm;
            public RoofForm rf;
            public RoofMat rm;
            public WinShape ws;
            public ChimKind ck;
            public float floorH = 3f, pitch = 0.8f, overhang = 0.45f, winSpacing = 2.4f, winW = 0.9f, winH = 1.1f, winBottom = 1.0f, doorW = 1.15f, doorH = 2.15f, foundation = 0.5f;
            public int floors = 1, chimneys = 1;
            public bool shutters, flowers, awning, porch, balcony, steps, jetty, cornice, quoins, pilasters, parapet, vigas, bargeboard, paintedBand, buttress, archDoor, surround;
            public bool bigDoor, hanging, crenel, turrets, dome, banner, crown, hut, upperTone;
            /// <summary>G8 locality: floor on posts this high, and a stone footing raised this much above the ground (metres).</summary>
            public float stilts, footing;
        }

        static readonly Color Cream = new Color(0.953f, 0.906f, 0.769f, 1f);

        static Color Jit(Color c, uint seed, float amt) => Pal.Mul(c, 1f + amt * (Hash.F((int)seed, 7, 3) - 0.5f) * 2f);
        static float F(uint h, int a, int b = 0) => Hash.F((int)h, a, b);
        static T Pick<T>(T[] arr, uint h, int salt) => arr[(int)((h >> (salt & 7)) * 2654435761u % (uint)arr.Length)];

        // ------------------------------------------------------------------ style

        Style MakeStyle(Building b, uint h, float w, float d)
        {
            var a = ArchitectureStyle.Get(b.style);
            uint hh = h * 2246822519u + 3266489917u;
            var s = new Style
            {
                a = a, h = h, kind = b.kind,
                wm = a.wall, rf = a.roofForm, rm = a.roofMat, ws = a.window, ck = a.chimney,
                wall = Jit(Pal.Rgb(Pick(a.walls, hh, 0)), h, 0.035f), wall2 = Pal.Rgb(Pick(a.walls2, hh, 3)), roof = Jit(Pal.Rgb(Pick(a.roofs, hh, 5)), h >> 3, 0.05f),
                trim = Pal.Rgb(Pick(a.trims, hh, 1)), plinth = Pal.Rgb(a.plinth), shutter = Pal.Rgb(Pick(a.shutters, hh, 2)), accent = Pal.Rgb(Pick(a.accents, hh, 4)),
                door = Pal.Rgb(a.doorColor), glass = Pal.Rgb(0x34455f), floorCol = Pal.Rgb(0x94754f), stone = Pal.Rgb(0x8f8a82),
                sign = Pal.Rgb(new[] { 0xb9503f, 0x4f7ab0, 0x5f9a5a, 0xc9a23f }[(h >> 8) % 4]),
                floorH = a.storeyH * (0.96f + 0.08f * F(h, 11)), pitch = a.pitch * (0.92f + 0.16f * F(h, 12)), overhang = a.overhang,
                winW = a.winW, winH = a.winH, winBottom = a.winBottom, winSpacing = a.winSpacing, doorW = a.doorW, doorH = a.doorH, foundation = a.foundation,
                shutters = F(h, 21) < a.shuttersP, flowers = F(h, 22) < a.flowersP, awning = F(h, 23) < a.awningP, porch = F(h, 24) < a.porchP,
                balcony = F(h, 25) < a.balconyP, steps = F(h, 26) < a.stepsP,
                jetty = a.jetty, cornice = a.cornice, quoins = a.quoins, pilasters = a.pilasters, parapet = a.parapet, vigas = a.vigas, bargeboard = a.bargeboard,
                paintedBand = a.paintedBand, buttress = a.buttress, archDoor = a.archDoor, surround = a.cornice,
            };
            Color tint = Pal.Hex(b.color, Color.clear);
            bool hasTint = tint.a > 0f && Pal.Hex(b.color, Color.magenta) != Color.magenta;
            Color Tinted(Color c, float t) => hasTint ? Color.Lerp(c, tint, t) : c;

            switch (b.kind)
            {
                case "hut":
                    s.hut = true; s.floors = 1; s.floorH = Mathf.Min(s.floorH, 2.4f); s.shutters = false; s.flowers = false; s.awning = false; s.balcony = false; s.steps = false;
                    s.wall = Pal.Mul(s.wall, 0.86f); s.winW *= 0.75f; s.winH *= 0.75f; s.doorW = 0.95f; s.doorH = 1.9f; s.winSpacing += 0.6f; s.cornice = false; s.quoins = false; s.pilasters = false; s.surround = false;
                    if (s.rf != RoofForm.Flat) { s.rm = RoofMat.Thatch; s.roof = Pal.Mul(Pal.Rgb(0xc9a85a), 0.95f + 0.1f * F(h, 5)); s.pitch = Mathf.Max(s.pitch, 0.9f); }
                    break;
                case "inn":
                    s.floors = 2; s.hanging = true; s.awning = s.a.awningP > 0f || F(h, 3) < 0.4f; s.bigDoor = false; s.doorW *= 1.1f; s.flowers = s.flowers || F(h, 5) < 0.5f; s.chimneys = 2; s.shutters = s.a.shuttersP > 0f;
                    s.balcony = s.a.balconyP > 0f || s.balcony; s.porch = s.a.porchP > 0.5f;
                    break;
                case "hall": case "guildhall": case "manor":
                    s.floors = 2; s.chimneys = 2; s.banner = true; s.awning = false; s.flowers = false; s.steps = true; s.surround = true; s.doorW *= 1.2f; s.doorH *= 1.1f; s.winH *= 1.1f;
                    s.roof = Tinted(s.roof, 0.18f); s.pitch *= 0.9f;
                    if (s.wm == WallMat.HalfTimber || s.wm == WallMat.Plaster || s.wm == WallMat.Boards || s.wm == WallMat.Logs) { s.upperTone = false; }
                    if (b.kind == "manor") { s.floors = F(h, 40) < 0.5f ? 3 : 2; s.cornice = true; s.shutters = s.shutters && F(h, 41) < 0.5f; }
                    if (s.rf == RoofForm.Gable && s.a.id == "river") s.rm = RoofMat.Tile;
                    break;
                case "palace": case "castle":
                    s.floors = b.kind == "palace" ? 3 : 3; s.floorH *= 1.08f; s.chimneys = 0; s.banner = true; s.turrets = true; s.crenel = true; s.parapet = true; s.rf = RoofForm.Flat; s.rm = RoofMat.Flat;
                    s.dome = b.kind == "palace" && (s.a.id == "imperial" || s.a.id == "coastal" || s.a.id == "steppe"); s.steps = true; s.surround = true; s.shutters = false; s.flowers = false; s.awning = false; s.balcony = b.kind == "palace";
                    s.doorW *= 1.4f; s.doorH *= 1.15f; s.winH *= 1.15f; s.cornice = s.a.id != "forest" && s.a.id != "highland";
                    if (s.wm != WallMat.Stone && s.wm != WallMat.Ashlar) { s.wm = s.a.id == "steppe" ? WallMat.Adobe : WallMat.Ashlar; s.wall = Pal.Rgb(s.wm == WallMat.Ashlar ? 0xd9cfba : 0xc89a68); }
                    s.roof = Tinted(s.roof, 0.25f);
                    break;
                case "temple":
                    s.floors = 1; s.floorH = 5.2f; s.chimneys = 0; s.crown = true; s.porch = false; s.awning = false; s.flowers = false; s.balcony = false; s.shutters = false;
                    s.doorW = 1.6f; s.doorH = 2.8f; s.winW = 0.7f; s.winH = 2.2f; s.winBottom = 1.7f; s.winSpacing = 3f; s.overhang += 0.15f; s.surround = true; s.steps = true;
                    if (s.ws != WinShape.Slit) s.ws = WinShape.Arch;
                    s.wall = Pal.Lighten(s.wall, 0.18f); s.wall2 = Pal.Lighten(s.wall2, 0.18f);
                    if (s.wm == WallMat.HalfTimber || s.wm == WallMat.Logs || s.wm == WallMat.Boards) { /* keep: a timber temple */ }
                    s.roof = Tinted(s.roof, 0.2f);
                    s.pitch *= 1.05f;
                    break;
                case "barracks":
                    s.floors = 2; s.banner = true; s.awning = false; s.flowers = false; s.shutters = false; s.winW *= 0.8f; s.winH *= 0.85f; s.chimneys = 2; s.crenel = s.rf == RoofForm.Flat;
                    if (s.wm != WallMat.Stone && s.wm != WallMat.Adobe && s.wm != WallMat.Ashlar && s.wm != WallMat.Logs) { s.wm = WallMat.Stone; s.wall = Pal.Rgb(0x9d998f); s.plinth = Pal.Rgb(0x6f6d68); }
                    s.roof = Pal.Mul(s.roof, 0.72f);
                    break;
                case "smithy":
                    s.chimneys = 1; s.ck = ChimKind.Stone; s.hanging = true; s.shutters = false; s.flowers = false; s.awning = false; s.winSpacing += 0.6f;
                    if (s.wm != WallMat.Stone && s.wm != WallMat.Adobe && s.wm != WallMat.Ashlar && s.wm != WallMat.Logs) { s.wm = WallMat.Stone; s.wall = Pal.Rgb(0x8f8c86); s.plinth = Pal.Rgb(0x6f6d68); }
                    s.roof = Pal.Mul(s.roof, 0.7f); s.trim = Pal.Mul(s.trim, 0.8f); s.sign = Pal.Rgb(0x4d5057);
                    break;
                case "farm": case "granary":
                    s.bigDoor = true; s.doorW = 1.9f; s.doorH = 2.5f; s.winSpacing = 99f; s.floorH = Mathf.Max(s.floorH, 3.2f); s.shutters = false; s.flowers = false; s.awning = false; s.balcony = false; s.steps = false; s.chimneys = 0;
                    if (s.wm != WallMat.Adobe && s.wm != WallMat.Logs && s.wm != WallMat.Stone) { s.wm = WallMat.Boards; s.wall = Pal.Rgb(h % 2 == 0 ? 0xa8573a : 0x9a7a52); s.trim = Pal.Rgb(0xe8dcc0); }
                    if (s.rf == RoofForm.Hip || s.rf == RoofForm.Curved) s.rf = RoofForm.Gable;
                    s.pitch = Mathf.Max(s.pitch, 0.7f);
                    if (s.rm == RoofMat.Tile) s.roof = Pal.Mul(s.roof, 0.8f);
                    break;
                default:   // house and anything unknown
                {
                    bool big = w * d >= 9f * WorldView.TileSize * WorldView.TileSize * 0.8f;   // roughly 3x3 tiles and more (a 2x3 cottage stays one storey: no towers)
                    float twoStorey = s.a.id == "coastal" || s.a.id == "imperial" ? 0.5f : s.a.id == "river" ? 0.34f : s.a.id == "highland" ? 0.12f : 0.2f;
                    if (b.kind == "house" && big && F(h, 31) < twoStorey * 1.6f) s.floors = 2;
                    s.chimneys = F(h, 32) < 0.78f ? 1 : 0;
                    // The server's tint colours richer houses' roofs a little (house_b), as before.
                    if (b.template == "house_b" && hasTint) s.roof = Tinted(s.roof, 0.22f);
                    if (b.kind != "house" && hasTint) s.wall = Tinted(s.wall, 0.22f);
                    // The cottage's lower sibling: a thatched or turfed cottage in the gable cultures.
                    if (b.template == "house_c" && b.kind == "house" && s.rf == RoofForm.Gable && s.rm != RoofMat.Turf) { s.rm = RoofMat.Thatch; s.roof = Pal.Rgb(0xcaa955); s.pitch = Mathf.Max(s.pitch, 0.95f); }
                    // Coastal and imperial: the better houses (two storeys) get flat parapet roofs in the coast, hip tile in the empire.
                    if (s.a.id == "coastal" && s.floors == 2 && F(h, 33) < 0.35f) { s.rf = RoofForm.Flat; s.rm = RoofMat.Flat; s.parapet = true; s.roof = Pal.Mul(s.wall, 0.9f); }
                    break;
                }
            }
            // The tall plain walls of a big building get a second tone on the storeys above the ground (stucco over stone).
            if (s.wm == WallMat.Ashlar && s.floors > 1) s.upperTone = true;
            if (s.wm == WallMat.Stone && s.floors > 1 && s.a.id != "highland") s.upperTone = F(h, 50) < 0.5f;
            if (s.wm == WallMat.Logs && s.floors > 1) s.upperTone = true;
            ApplyLocale(s, b, h, w, d);
            s.winH = Mathf.Min(s.winH, s.floorH - s.winBottom - 0.35f);
            if (s.shutters && (s.ws == WinShape.Round || s.ws == WinShape.Slit)) s.shutters = false;
            // G8 art direction: chunky, slightly exaggerated forms - steeper roofs and deeper eaves than the tables say
            // (the roof thickness is exaggerated in BuildingRoof.Thick). Hip roofs rise less so they keep their shape.
            if (s.rf != RoofForm.Flat)
            {
                s.pitch = Mathf.Clamp(s.pitch * (s.rf == RoofForm.Hip ? 1.3f : 1.22f), 0.75f, 1.75f);
                s.overhang += 0.16f;
            }
            return s;
        }

        /// <summary>The place's locale (G8: its land, wealth and size) changes the culture's way of building (LocaleArch).</summary>
        void ApplyLocale(Style s, Building b, uint h, float w, float d)
        {
            var loc = world.Mirror != null && world.Mirror.map != null ? world.Mirror.map.locale : null;
            if (loc == null) return;
            float tile = WorldView.TileSize;
            var m = LocaleArch.For(s.a.id, loc.terrain, loc.wealth, loc.size, b.kind, s.wm.ToString(), s.rf.ToString(), s.floors, w * d / (tile * tile), salt => F(h, 60 + salt));
            s.stilts = m.stilts;
            s.footing = m.footing;
            s.pitch *= m.pitchMul;
            s.overhang = Mathf.Max(0.1f, s.overhang + m.overhangAdd);
            s.floorH *= m.floorHMul;
            if (m.floors > 0 && !s.hut) s.floors = m.floors;
            if (m.wall == "Logs") { s.wm = WallMat.Logs; s.upperTone = false; }
            else if (m.wall == "Boards") { s.wm = WallMat.Boards; s.upperTone = false; }
            else if (m.wall == "Stone") s.wm = WallMat.Stone;
            if (m.wallColor != 0) s.wall = Jit(Pal.Rgb(m.wallColor), h, 0.06f);
            if (m.whitewash > 0f) { s.wall = Pal.Lighten(s.wall, m.whitewash); s.wall2 = Pal.Lighten(s.wall2, m.whitewash); }
            if (m.roof == "Thatch" && s.rf != RoofForm.Flat && s.rm != RoofMat.Turf) { s.rm = RoofMat.Thatch; s.roof = Jit(Pal.Rgb(m.roofColor), h >> 2, 0.05f); s.pitch = Mathf.Max(s.pitch, 0.95f); }
            else if (m.roof == "Tile" && s.rf != RoofForm.Flat) { s.rm = RoofMat.Tile; s.roof = Jit(Pal.Rgb(m.roofColor), h >> 2, 0.05f); }
            if (m.plain) { s.shutters = false; s.flowers = false; s.awning = false; s.balcony = false; s.cornice = false; s.surround = false; if (F(h, 70) < 0.4f) s.chimneys = 0; }
            if (m.fine) { s.shutters = s.shutters || s.a.shuttersP > 0.3f; s.flowers = s.flowers || s.a.flowersP > 0.3f; }
            if (s.stilts > 0f || s.footing > 0.3f) s.steps = false;   // the stoop below replaces the door's own steps
        }

        /// <summary>Posts under a floor raised over the marsh, with a deck along the door's side.</summary>
        static void Stilts(MeshBuilder mb, float x0, float x1, float z0, float z1, float groundY, float floorY, int doorFace, Color wood)
        {
            const float pw = 0.18f, step = 1.6f;
            int nx = Mathf.Max(2, Mathf.RoundToInt((x1 - x0) / step) + 1), nz = Mathf.Max(2, Mathf.RoundToInt((z1 - z0) / step) + 1);
            for (int i = 0; i < nx; i++)
                for (int j = 0; j < nz; j++)
                {
                    if (i != 0 && i != nx - 1 && j != 0 && j != nz - 1) continue;
                    float px = Mathf.Lerp(x0 + 0.05f, x1 - pw - 0.05f, i / (float)(nx - 1)), pz = Mathf.Lerp(z0 + 0.05f, z1 - pw - 0.05f, j / (float)(nz - 1));
                    mb.Box(new Vector3(px, groundY - 0.3f, pz), new Vector3(px + pw, floorY - 0.18f, pz + pw), Pal.Mul(wood, 0.85f + 0.1f * ((i + j) % 2)));
                }
            // Cross-braces on the long sides.
            for (int i = 0; i < nx - 1; i++)
            {
                float a = Mathf.Lerp(x0, x1, i / (float)(nx - 1)), c = Mathf.Lerp(x0, x1, (i + 1) / (float)(nx - 1));
                foreach (float z in new[] { z0 + 0.02f, z1 - 0.1f })
                    mb.Box(new Vector3(a, groundY + (floorY - groundY) * 0.45f, z), new Vector3(c, groundY + (floorY - groundY) * 0.45f + 0.1f, z + 0.08f), Pal.Mul(wood, 0.8f));
            }
            // The deck (a platform the house sits on, reaching out on the door's side).
            float ex = doorFace == 2 ? 0.9f : doorFace == 3 ? 0.9f : 0f, ez = doorFace <= 1 ? 0.9f : 0f;
            float dx0 = x0 - (doorFace == 2 ? ex : 0.1f), dx1 = x1 + (doorFace == 3 ? ex : 0.1f), dz0 = z0 - (doorFace == 1 ? ez : 0.1f), dz1 = z1 + (doorFace == 0 ? ez : 0.1f);
            mb.Box(new Vector3(dx0, floorY - 0.2f, dz0), new Vector3(dx1, floorY - 0.04f, dz1), Pal.Mul(wood, 0.95f), Pal.Lighten(wood, 0.1f));
        }

        /// <summary>A flight of steps from the ground up to a raised door, running out from the door's face.</summary>
        static void Stoop(MeshBuilder mb, int doorFace, float dwx, float dwz, float x0, float x1, float z0, float z1, float groundY, float floorY, float out0, float width, Color top, Color side)
        {
            float rise = floorY - groundY;
            if (rise < 0.25f) return;
            int n = Mathf.Clamp(Mathf.CeilToInt(rise / 0.22f), 1, 8);
            float tread = 0.32f, hw = width * 0.5f;
            for (int k = 0; k < n; k++)
            {
                float yTop = floorY - (k + 1) * rise / n + 0.02f, o0 = out0 + k * tread, o1 = out0 + (k + 1) * tread;
                Vector3 a, b;
                switch (doorFace)
                {
                    case 0: a = new Vector3(dwx - hw, groundY - 0.2f, z1 + o0); b = new Vector3(dwx + hw, yTop, z1 + o1); break;
                    case 1: a = new Vector3(dwx - hw, groundY - 0.2f, z0 - o1); b = new Vector3(dwx + hw, yTop, z0 - o0); break;
                    case 2: a = new Vector3(x0 - o1, groundY - 0.2f, dwz - hw); b = new Vector3(x0 - o0, yTop, dwz + hw); break;
                    default: a = new Vector3(x1 + o0, groundY - 0.2f, dwz - hw); b = new Vector3(x1 + o1, yTop, dwz + hw); break;
                }
                mb.Box(a, b, side, top);
            }
        }

        // ------------------------------------------------------------------ the house

        BuildingView BuildHouse(BuildingView view, Building b, uint h, float x0, float x1, float z0, float z1, float baseY, float drop, List<Mesh> meshes)
        {
            float cx = (x0 + x1) * 0.5f, cz = (z0 + z1) * 0.5f;
            var st = MakeStyle(b, h, x1 - x0, z1 - z0);
            view.floorCount = st.floors;
            var body = new MeshBuilder();
            var glow = new MeshBuilder();
            var floorMb = new List<MeshBuilder>();
            for (int f = 1; f < st.floors; f++) floorMb.Add(new MeshBuilder());
            var roofMb = new MeshBuilder();

            int doorFace = 0;   // 0 front(+z) 1 back(-z) 2 left(-x) 3 right(+x)
            float dwx = cx, dwz = z1;
            if (b.door != null)
            {
                dwx = ((float)b.door.x + 0.5f) * WorldView.TileSize;
                dwz = ((float)b.door.y + 0.5f) * WorldView.TileSize;
                if (b.door.y >= b.y + b.h - 1) doorFace = 0;
                else if (b.door.y <= b.y) doorFace = 1;
                else if (b.door.x <= b.x) doorFace = 2;
                else doorFace = 3;
            }
            bool alongX = (x1 - x0) >= (z1 - z0);
            bool gableRoof = st.rf == RoofForm.Gable || st.rf == RoofForm.Curved;

            // G8 locality: a floor raised on posts (the marsh) or on a tall stone footing (the hills), with steps up to the door.
            float groundY = baseY;
            if (st.stilts > 0f)
            {
                baseY += st.stilts;
                Stilts(body, x0, x1, z0, z1, groundY - drop + 0.45f, baseY, doorFace, Pal.Rgb(0x5a4330));
                drop = 0.05f;
                Stoop(body, doorFace, dwx, dwz, x0, x1, z0, z1, groundY - 0.1f, baseY, 0.9f, st.doorW + 0.3f, Pal.Rgb(0x8a6a48), Pal.Rgb(0x5a4330));
            }
            else if (st.footing > 0f)
            {
                baseY += st.footing;
                drop += st.footing;
                Stoop(body, doorFace, dwx, dwz, x0, x1, z0, z1, groundY, baseY, 0.05f, st.doorW + 0.5f, Pal.Lighten(st.plinth, 0.15f), st.plinth);
            }

            for (int f = 0; f < st.floors; f++)
            {
                MeshBuilder mb = f == 0 ? body : floorMb[f - 1];
                float yb = baseY + f * st.floorH;
                // floor slab (the ceiling of the floor below for f >= 1)
                if (f == 0) mb.Box(new Vector3(x0 + T, baseY - 0.2f, z0 + T), new Vector3(x1 - T, baseY + 0.08f, z1 - T), st.floorCol);
                else mb.Box(new Vector3(x0 + T, yb - 0.16f, z0 + T), new Vector3(x1 - T, yb, z1 - T), st.floorCol, Pal.Mul(st.floorCol, 1.1f), true);

                for (int face = 0; face < 4; face++)
                {
                    float len; Vector3 origin; float yaw; float dU;
                    switch (face)
                    {
                        case 0: len = x1 - x0; origin = new Vector3(x0, 0, z1); yaw = 0f; dU = dwx - x0; break;
                        case 1: len = x1 - x0; origin = new Vector3(x1, 0, z0); yaw = 180f; dU = x1 - dwx; break;
                        case 2: len = (z1 - z0) - 2 * T; origin = new Vector3(x0, 0, z0 + T); yaw = 270f; dU = dwz - (z0 + T); break;
                        default: len = (z1 - z0) - 2 * T; origin = new Vector3(x1, 0, z1 - T); yaw = 90f; dU = (z1 - T) - dwz; break;
                    }
                    var ops = new List<Opening>();
                    bool hasDoor = f == 0 && face == doorFace;
                    float dHalf = st.doorW * 0.5f + 0.3f;
                    if (hasDoor)
                    {
                        dU = Mathf.Clamp(dU, dHalf, Mathf.Max(dHalf, len - dHalf));
                        if (len < st.doorW + 0.6f) dU = len * 0.5f;
                        ops.Add(new Opening { u = dU, w = st.doorW, bottom = 0f, height = st.doorH, door = true });
                    }
                    float margin = 0.3f + (st.shutters ? st.winW * 0.55f : 0f) + (st.flowers ? 0.1f : 0f);
                    int n = Mathf.Clamp(Mathf.FloorToInt((len - 0.8f) / st.winSpacing), 0, 4);
                    if (n == 0 && len > 2.2f && st.winSpacing < 50f) n = 1;
                    for (int i = 0; i < n; i++)
                    {
                        float u = (i + 0.5f) * len / n;
                        if (hasDoor && Mathf.Abs(u - dU) < st.doorW * 0.5f + st.winW * 0.5f + margin) continue;
                        ops.Add(new Opening { u = u, w = st.winW, bottom = st.winBottom, height = Mathf.Min(st.winH, st.floorH - st.winBottom - 0.35f) });
                    }
                    bool gableEnd = gableRoof && (alongX ? face >= 2 : face < 2);
                    var m = Matrix4x4.TRS(origin, Quaternion.Euler(0, yaw, 0), Vector3.one);
                    WallRun(mb, glow, m, len, yb, f == 0 ? drop : 0f, ops, st, f, face, gableEnd, hasDoor, face < 2);
                }
            }

            float eaveY = baseY + st.floors * st.floorH;
            BuildRoof(roofMb, st, x0, x1, z0, z1, eaveY, h, out float ridgeY, out Vector3 chim);
            view.top = ridgeY;
            view.chimney = chim;

            view.meshes = new Mesh[0];
            AddPart(view, body, "body", meshes, false);
            for (int f = 0; f < floorMb.Count; f++) view.floors.Add(AddPart(view, floorMb[f], "floor" + (f + 1), meshes, false));
            view.roof = AddPart(view, roofMb, "roof", meshes, false);
            view.glow = AddPart(view, glow, "glow", meshes, true);
            if (view.glow != null) view.glow.SetActive(b.lit);
            return Finish(view, meshes, x0, x1, z0, z1, baseY, ridgeY - baseY);
        }

        // ------------------------------------------------------------------ walls

        // Wall space: u along the wall, v up from the storey's base (yb), z outward (the outer face is z = 0, the inner face z = -T).
        void WallRun(MeshBuilder mb, MeshBuilder glow, Matrix4x4 m, float len, float yb, float below, List<Opening> ops, Style st, int fl, int face, bool gableEnd, bool hasDoor, bool longFace)
        {
            mb.SetTransform(m);
            glow.SetTransform(m);
            ops.Sort((a, b) => a.u.CompareTo(b.u));
            bool ground = fl == 0;
            bool top = fl == st.floors - 1;
            float h = st.floorH;
            uint sd = st.h * 31u + (uint)face * 977u + (uint)fl * 131u;
            float cur = 0f;
            foreach (var op in ops)
            {
                float l = Mathf.Max(cur, op.u - op.w * 0.5f), r = Mathf.Min(len, op.u + op.w * 0.5f);
                if (r <= l + 0.05f) continue;
                if (l > cur) Panel(mb, cur, l, -below, h, yb, st, fl, ground, sd + 1);
                if (op.bottom > 0f) Panel(mb, l, r, -below, op.bottom, yb, st, fl, ground, sd + 2);
                float topV = op.bottom + op.height;
                if (topV < h) Panel(mb, l, r, topV, h, yb, st, fl, ground, sd + 3);
                if (op.door) DrawDoor(mb, l, r, yb, below, op.height, st, sd, len);
                else DrawWindow(mb, glow, l, r, yb, op.bottom, topV, st, sd + (uint)(l * 10f), fl, len);
                cur = r;
            }
            if (cur < len) Panel(mb, cur, len, -below, h, yb, st, fl, ground, sd + 4);

            // Frame, bands and features that run along the wall.
            Detailing(mb, ops, len, yb, below, st, fl, face, gableEnd, hasDoor, longFace, ground, top, sd);
            mb.ResetTransform();
            glow.ResetTransform();
        }

        Color WallCol(Style st, int fl) => fl > 0 && st.upperTone ? st.wall2 : st.wall;

        /// <summary>A solid stretch of wall between u0..u1 and v0..v1 (v relative to the storey base), in the style's wall material.</summary>
        void Panel(MeshBuilder mb, float u0, float u1, float v0, float v1, float yb, Style st, int fl, bool ground, uint sd)
        {
            if (u1 <= u0 + 0.01f || v1 <= v0 + 0.01f) return;
            if (ground && v0 < st.foundation)
            {
                float pv = Mathf.Min(v1, st.foundation);
                Color pc = Jit(st.plinth, sd, 0.05f);
                mb.Box(new Vector3(u0, yb + v0, -T), new Vector3(u1, yb + pv, 0.04f), pc, Pal.Mul(pc, 1.14f));
                v0 = pv;
                if (v1 <= v0 + 0.01f) return;
            }
            Color c = WallCol(st, fl);
            WallMat wm = st.wm;
            // Ashlar ground floor, stucco above.
            if (wm == WallMat.Ashlar && fl > 0 && st.upperTone) wm = WallMat.Plaster;
            if (wm == WallMat.Stone && fl > 0 && st.upperTone) wm = WallMat.Plaster;
            if (wm == WallMat.Logs && fl > 0 && st.upperTone) wm = WallMat.Boards;
            switch (wm)
            {
                case WallMat.Stone: StonePanel(mb, u0, u1, v0, v1, yb, c, sd, 0.3f, 0.5f, 0.28f); break;
                case WallMat.Ashlar: StonePanel(mb, u0, u1, v0, v1, yb, c, sd, 0.52f, 1.0f, 0.1f); break;
                case WallMat.Logs: LogPanel(mb, u0, u1, v0, v1, yb, c, sd); break;
                case WallMat.Boards: BoardPanel(mb, u0, u1, v0, v1, yb, c, sd); break;
                case WallMat.Adobe: AdobePanel(mb, u0, u1, v0, v1, yb, c, st, sd); break;
                case WallMat.HalfTimber: PlasterPanel(mb, u0, u1, v0, v1, yb, c, sd, true, st); break;
                default: PlasterPanel(mb, u0, u1, v0, v1, yb, c, sd, false, st); break;
            }
        }

        static void PlasterPanel(MeshBuilder mb, float u0, float u1, float v0, float v1, float yb, Color c, uint sd, bool timber, Style st)
        {
            // Hand-washed plaster: stretches of slightly different tone.
            float u = u0; int i = 0;
            while (u < u1 - 0.01f)
            {
                float e = Mathf.Min(u1, u + 1.1f + 0.6f * F(sd, i, 1));
                if (u1 - e < 0.4f) e = u1;
                mb.Box(new Vector3(u, yb + v0, -T), new Vector3(e, yb + v1, 0f), Pal.Mul(c, 0.975f + 0.05f * F(sd, i, 2)));
                u = e; i++;
            }
            if (!timber) return;
            // Timber frame: posts at the panel's edges (and between, for a long one), rails, and a brace in the blank bays.
            Color tc = st.trim;
            float pw = 0.13f, pz = 0.045f;
            mb.Box(new Vector3(u0, yb + v0, -T - 0.01f), new Vector3(u0 + pw, yb + v1, pz), tc);
            mb.Box(new Vector3(u1 - pw, yb + v0, -T - 0.01f), new Vector3(u1, yb + v1, pz), tc);
            int bays = Mathf.Max(1, Mathf.RoundToInt((u1 - u0) / 1.7f));
            for (int k = 1; k < bays; k++)
            {
                float uu = u0 + (u1 - u0) * k / bays;
                mb.Box(new Vector3(uu - pw * 0.5f, yb + v0, -T - 0.01f), new Vector3(uu + pw * 0.5f, yb + v1, pz), tc);
            }
            mb.Box(new Vector3(u0, yb + v1 - 0.12f, -T - 0.01f), new Vector3(u1, yb + v1, pz), tc);
            if (v0 > 0.3f) mb.Box(new Vector3(u0, yb + v0, -T - 0.01f), new Vector3(u1, yb + v0 + 0.1f, pz), tc);
            if (v1 - v0 > 1.4f) mb.Box(new Vector3(u0, yb + v0 + (v1 - v0) * 0.5f - 0.05f, -T - 0.01f), new Vector3(u1, yb + v0 + (v1 - v0) * 0.5f + 0.05f, pz * 0.8f), tc);
            for (int k = 0; k < bays; k++)
            {
                float a = u0 + (u1 - u0) * k / bays + pw, bb = u0 + (u1 - u0) * (k + 1) / bays - pw;
                float va = yb + v0 + (v0 > 0.3f ? 0.1f : 0f), vb = yb + v1 - 0.12f;
                if (bb - a < 0.5f || vb - va < 0.6f || F(sd, k, 9) < 0.35f) continue;
                bool flip = F(sd, k, 10) < 0.5f;
                float x0 = flip ? bb : a, x1 = flip ? a : bb;
                float dx = flip ? -0.11f : 0.11f;
                mb.Quad(new Vector3(x0, va, pz + 0.002f), new Vector3(x0 + dx, va, pz + 0.002f), new Vector3(x1 + dx, vb, pz + 0.002f), new Vector3(x1, vb, pz + 0.002f), tc, Vector3.forward);
            }
        }

        static void StonePanel(MeshBuilder mb, float u0, float u1, float v0, float v1, float yb, Color c, uint sd, float courseH, float blockL, float jitter)
        {
            // The core (mortar) fills the thickness; blocks stand proud of it in courses with offset joints.
            mb.Box(new Vector3(u0, yb + v0, -T), new Vector3(u1, yb + v1, -0.03f), Pal.Mul(c, 0.62f));
            float y = v0; int ci = 0;
            while (y < v1 - 0.02f)
            {
                float ch = courseH * (0.85f + 0.3f * F(sd, ci, 1));
                float y1 = Mathf.Min(v1, y + ch);
                if (v1 - y1 < 0.12f) y1 = v1;
                float u = u0; int bi = 0;
                float firstCut = blockL * (ci % 2 == 0 ? 1f : 0.5f) * (0.6f + 0.5f * F(sd, ci, 2));
                while (u < u1 - 0.01f)
                {
                    float bl = (bi == 0 ? firstCut : blockL * (0.65f + 0.7f * F(sd, ci, bi + 7)));
                    float e = Mathf.Min(u1, u + bl);
                    if (u1 - e < 0.25f) e = u1;
                    float prot = 0.015f + 0.03f * F(sd + 5u, ci, bi);
                    Color bc = Pal.Mul(c, 1f - jitter * 0.5f + jitter * F(sd + 9u, ci, bi));
                    float gap = e >= u1 - 0.001f || u <= u0 + 0.001f ? 0f : 0.015f;
                    mb.Box(new Vector3(u + gap, yb + y + 0.012f, -0.06f), new Vector3(e - gap, yb + y1 - 0.012f, prot), bc, Pal.Mul(bc, 1.12f));
                    u = e; bi++;
                }
                y = y1; ci++;
            }
        }

        static void LogPanel(MeshBuilder mb, float u0, float u1, float v0, float v1, float yb, Color c, uint sd)
        {
            mb.Box(new Vector3(u0, yb + v0, -T), new Vector3(u1, yb + v1, -0.04f), Pal.Mul(c, 0.5f));
            float y = v0; int i = 0;
            while (y < v1 - 0.02f)
            {
                float y1 = Mathf.Min(v1, y + 0.3f);
                if (v1 - y1 < 0.1f) y1 = v1;
                Color lc = Pal.Mul(c, 0.9f + 0.2f * F(sd, i, 1));
                mb.Box(new Vector3(u0, yb + y, -T), new Vector3(u1, yb + y1 - 0.012f, 0.07f), lc, Pal.Mul(lc, 1.15f));
                // the dark underside seam of each log
                mb.Box(new Vector3(u0, yb + y, -0.02f), new Vector3(u1, yb + y + 0.04f, 0.075f), Pal.Mul(lc, 0.55f));
                y = y1; i++;
            }
        }

        static void BoardPanel(MeshBuilder mb, float u0, float u1, float v0, float v1, float yb, Color c, uint sd)
        {
            mb.Box(new Vector3(u0, yb + v0, -T), new Vector3(u1, yb + v1, -0.03f), Pal.Mul(c, 0.5f));
            float u = u0; int i = 0;
            while (u < u1 - 0.01f)
            {
                float e = Mathf.Min(u1, u + 0.28f);
                if (u1 - e < 0.12f) e = u1;
                Color bc = Pal.Mul(c, 0.9f + 0.2f * F(sd, i, 3));
                mb.Box(new Vector3(u + 0.008f, yb + v0, -0.06f), new Vector3(e - 0.008f, yb + v1, 0.02f + 0.012f * (i % 2)), bc, Pal.Mul(bc, 1.1f));
                u = e; i++;
            }
        }

        static void AdobePanel(MeshBuilder mb, float u0, float u1, float v0, float v1, float yb, Color c, Style st, uint sd)
        {
            float u = u0; int i = 0;
            while (u < u1 - 0.01f)
            {
                float e = Mathf.Min(u1, u + 1.2f + 0.5f * F(sd, i, 1));
                if (u1 - e < 0.4f) e = u1;
                mb.Box(new Vector3(u, yb + v0, -T), new Vector3(e, yb + v1, 0f), Pal.Mul(c, 0.96f + 0.08f * F(sd, i, 2)));
                u = e; i++;
            }
            // Weathered patches where the wash has flaked, and the darker splashed band at the foot.
            for (int k = 0; k < 3; k++)
            {
                float pu = Mathf.Lerp(u0, u1, F(sd, k, 20)), pv = Mathf.Lerp(v0, v1, F(sd, k, 21));
                float pw = 0.25f + 0.35f * F(sd, k, 22), ph = 0.2f + 0.3f * F(sd, k, 23);
                if (pu + pw > u1 || pv + ph > v1 - 0.05f) continue;
                mb.Quad(new Vector3(pu, yb + pv, 0.004f), new Vector3(pu + pw, yb + pv, 0.004f), new Vector3(pu + pw, yb + pv + ph, 0.004f), new Vector3(pu, yb + pv + ph, 0.004f), Pal.Mul(c, 0.88f), Vector3.forward);
            }
        }

        // ------------------------------------------------------------------ openings

        void DrawWindow(MeshBuilder mb, MeshBuilder glow, float l, float r, float yb, float bottom, float top, Style st, uint sd, int fl, float len)
        {
            float w = r - l;
            Color wallC = WallCol(st, fl);
            float gz = st.ws == WinShape.Slit ? -T + 0.04f : -T * 0.5f;
            mb.Quad(new Vector3(l, yb + bottom, gz), new Vector3(r, yb + bottom, gz), new Vector3(r, yb + top, gz), new Vector3(l, yb + top, gz), st.glass, Vector3.forward);
            glow.Quad(new Vector3(l + 0.04f, yb + bottom + 0.04f, gz + 0.02f), new Vector3(r - 0.04f, yb + bottom + 0.04f, gz + 0.02f), new Vector3(r - 0.04f, yb + top - 0.04f, gz + 0.02f), new Vector3(l + 0.04f, yb + top - 0.04f, gz + 0.02f), Color.white, Vector3.forward);
            Color fc = st.trim;
            bool stoneish = st.wm == WallMat.Stone || st.wm == WallMat.Ashlar;
            if (st.wm == WallMat.Adobe) fc = Pal.Lighten(st.wall, 0.35f);
            if (stoneish && st.ws != WinShape.Rect) fc = Pal.Lighten(st.wall, 0.3f);
            if (st.wm == WallMat.Plaster && st.a.id == "coastal") fc = Pal.Rgb(0xf6f1e6);
            float fw = st.ws == WinShape.Slit ? 0.1f : 0.075f;

            // Reveal sides and frame.
            mb.Box(new Vector3(l - fw, yb + bottom - 0.08f, 0f), new Vector3(l, yb + top + fw, 0.05f), fc);
            mb.Box(new Vector3(r, yb + bottom - 0.08f, 0f), new Vector3(r + fw, yb + top + fw, 0.05f), fc);
            mb.Box(new Vector3(l - fw, yb + top, 0f), new Vector3(r + fw, yb + top + fw * (st.ws == WinShape.Slit ? 1.6f : 1f), 0.05f), fc);
            // Sill
            mb.Box(new Vector3(l - fw * 1.6f, yb + bottom - 0.15f, 0f), new Vector3(r + fw * 1.6f, yb + bottom - 0.04f, 0.12f), Pal.Lighten(fc, 0.18f));

            switch (st.ws)
            {
                case WinShape.Arch:
                {
                    float c = Mathf.Min(w * 0.42f, 0.34f);
                    CornerTri(mb, l, yb + top, c, true, wallC);
                    CornerTri(mb, r, yb + top, c, false, wallC);
                    // keystone and crossbar
                    mb.Box(new Vector3((l + r) * 0.5f - 0.07f, yb + top - 0.03f, 0.005f), new Vector3((l + r) * 0.5f + 0.07f, yb + top + fw + 0.07f, 0.075f), Pal.Lighten(fc, 0.1f));
                    float mid = (l + r) * 0.5f;
                    mb.Box(new Vector3(mid - 0.025f, yb + bottom, gz), new Vector3(mid + 0.025f, yb + top - 0.1f, gz + 0.03f), fc);
                    mb.Box(new Vector3(l, yb + bottom + (top - bottom) * 0.55f, gz), new Vector3(r, yb + bottom + (top - bottom) * 0.55f + 0.04f, gz + 0.03f), fc);
                    break;
                }
                case WinShape.Round:
                {
                    float c = Mathf.Min(w, top - bottom) * 0.3f;
                    CornerTri(mb, l, yb + top, c, true, wallC);
                    CornerTri(mb, r, yb + top, c, false, wallC);
                    CornerTri(mb, l, yb + bottom, c, true, wallC, true);
                    CornerTri(mb, r, yb + bottom, c, false, wallC, true);
                    float mid = (l + r) * 0.5f;
                    mb.Box(new Vector3(mid - 0.02f, yb + bottom, gz), new Vector3(mid + 0.02f, yb + top, gz + 0.03f), fc);
                    break;
                }
                case WinShape.Slit:
                    break;
                default:
                {
                    float mid = (l + r) * 0.5f;
                    mb.Box(new Vector3(mid - 0.025f, yb + bottom, gz), new Vector3(mid + 0.025f, yb + top, gz + 0.03f), fc);
                    if (top - bottom > 0.9f) mb.Box(new Vector3(l, yb + (bottom + top) * 0.5f - 0.02f, gz), new Vector3(r, yb + (bottom + top) * 0.5f + 0.02f, gz + 0.03f), fc);
                    break;
                }
            }

            // Shutters flat against the wall, a little slatted.
            if (st.shutters)
            {
                float sw = w * 0.5f - 0.005f;
                float sh0 = yb + bottom - 0.05f, sh1 = yb + top + 0.03f;
                if (l - sw - fw - 0.04f > 0.04f)
                    Shutter(mb, l - fw - 0.03f - sw, l - fw - 0.03f, sh0, sh1, st.shutter);
                if (r + sw + fw + 0.04f < len - 0.04f)
                    Shutter(mb, r + fw + 0.03f, r + fw + 0.03f + sw, sh0, sh1, st.shutter);
            }
            // Flower box under the sill.
            if (st.flowers && st.ws != WinShape.Slit && fl <= 1)
            {
                Color wood = Pal.Mul(st.trim, 1.1f);
                float by = yb + bottom - 0.43f;
                mb.Box(new Vector3(l - 0.04f, by, 0f), new Vector3(r + 0.04f, by + 0.24f, 0.26f), wood, Pal.Rgb(0x4a6a35));
                int n = Mathf.Max(3, Mathf.RoundToInt(w / 0.2f));
                for (int i = 0; i < n; i++)
                {
                    float u = Mathf.Lerp(l + 0.06f, r - 0.06f, (i + 0.5f) / n);
                    Color fc2 = i % 3 == 1 ? Pal.Rgb(0x4f8a3f) : Pal.Rgb(Pick(st.a.accents, st.h + (uint)i, 2));
                    if (st.a.id == "river" || st.a.id == "forest") fc2 = i % 3 == 1 ? Pal.Rgb(0x4f8a3f) : Pal.Rgb(new[] { 0xd9453f, 0xf0c040, 0xb06ac0, 0xf08aa0 }[(st.h + (uint)i) % 4]);
                    mb.Blob(new Vector3(u, by + 0.3f, 0.14f), new Vector3(0.1f, 0.1f, 0.1f), fc2, 5, 3, 0.15f, i + (int)sd);
                }
            }
        }

        // A right triangle in the corner of an opening, used to chamfer it into an arch (top) or an octagon (bottom too).
        static void CornerTri(MeshBuilder mb, float u, float y, float c, bool leftSide, Color col, bool bottom = false)
        {
            float su = leftSide ? 1f : -1f, sv = bottom ? 1f : -1f;
            // Corner at (u, y); the triangle covers the opening's corner (inside the opening), pointing inwards.
            Vector3 a = new Vector3(u, y, 0.012f), b = new Vector3(u + su * c, y, 0.012f), d = new Vector3(u, y + sv * c, 0.012f);
            mb.Tri(a, b, d, col, Vector3.forward);
        }

        static void Shutter(MeshBuilder mb, float u0, float u1, float y0, float y1, Color c)
        {
            mb.Box(new Vector3(u0, y0, 0f), new Vector3(u1, y1, 0.045f), c, Pal.Mul(c, 1.1f));
            Color slat = Pal.Mul(c, 0.78f);
            int n = Mathf.Max(2, Mathf.RoundToInt((y1 - y0) / 0.16f));
            for (int i = 1; i < n; i++)
            {
                float y = Mathf.Lerp(y0, y1, i / (float)n);
                mb.Box(new Vector3(u0 + 0.025f, y - 0.012f, 0.045f), new Vector3(u1 - 0.025f, y + 0.012f, 0.056f), slat);
            }
        }

        void DrawDoor(MeshBuilder mb, float l, float r, float yb, float below, float dh, Style st, uint sd, float len)
        {
            float w = r - l, mid = (l + r) * 0.5f;
            Color wallC = st.wall;
            Color leaf = Jit(st.door, sd, 0.06f);
            mb.Box(new Vector3(l + 0.04f, yb, -T * 0.7f), new Vector3(r - 0.04f, yb + dh - 0.04f, -T * 0.7f + 0.07f), leaf);
            // planks / panels
            Color seam = Pal.Mul(leaf, 0.7f);
            int pn = st.bigDoor ? 5 : 3;
            for (int i = 1; i < pn; i++)
            {
                float u = Mathf.Lerp(l + 0.04f, r - 0.04f, i / (float)pn);
                mb.Box(new Vector3(u - 0.012f, yb, -T * 0.7f + 0.07f), new Vector3(u + 0.012f, yb + dh - 0.04f, -T * 0.7f + 0.085f), seam);
            }
            if (st.bigDoor)
            {
                // a barn door's cross-bar
                mb.Box(new Vector3(l + 0.04f, yb + dh * 0.5f - 0.07f, -T * 0.7f + 0.07f), new Vector3(r - 0.04f, yb + dh * 0.5f + 0.07f, -T * 0.7f + 0.1f), Pal.Mul(leaf, 0.8f));
            }
            // handle
            mb.Box(new Vector3(r - 0.22f, yb + 1.0f, -T * 0.7f + 0.07f), new Vector3(r - 0.15f, yb + 1.1f, -T * 0.7f + 0.11f), Pal.Rgb(0xd8b75a));

            Color fc = st.trim;
            if (st.wm == WallMat.Adobe) fc = st.accent;
            if (st.wm == WallMat.Ashlar || st.a.id == "coastal") fc = Pal.Rgb(0xf3ecdb);
            if (st.wm == WallMat.Stone && st.a.id == "highland") fc = Pal.Lighten(st.wall, 0.25f);
            float fw = 0.09f;
            mb.Box(new Vector3(l - fw, yb, 0f), new Vector3(l + 0.03f, yb + dh + 0.07f, 0.06f), fc);
            mb.Box(new Vector3(r - 0.03f, yb, 0f), new Vector3(r + fw, yb + dh + 0.07f, 0.06f), fc);
            mb.Box(new Vector3(l - fw, yb + dh, 0f), new Vector3(r + fw, yb + dh + 0.12f, 0.06f), fc);
            if (st.archDoor)
            {
                float c = Mathf.Min(w * 0.34f, 0.4f);
                CornerTri(mb, l, yb + dh, c, true, wallC);
                CornerTri(mb, r, yb + dh, c, false, wallC);
                mb.Box(new Vector3(mid - 0.08f, yb + dh - 0.02f, 0.005f), new Vector3(mid + 0.08f, yb + dh + 0.2f, 0.08f), Pal.Lighten(fc, 0.05f));
            }
            // threshold stone, deeper when the ground falls away
            if (below > 0.5f) mb.Box(new Vector3(l - 0.1f, yb - below, 0f), new Vector3(r + 0.1f, yb + 0.05f, 0.5f), st.plinth, Pal.Mul(st.plinth, 1.1f));
            else mb.Box(new Vector3(l - 0.1f, yb - 0.1f, 0f), new Vector3(r + 0.1f, yb + 0.06f, 0.4f), st.plinth, Pal.Mul(st.plinth, 1.1f));

            if (st.steps)
            {
                mb.Box(new Vector3(l - 0.25f, yb - 0.14f, 0f), new Vector3(r + 0.25f, yb + 0.02f, 0.55f), Pal.Lighten(st.plinth, 0.12f), Pal.Lighten(st.plinth, 0.25f));
                mb.Box(new Vector3(l - 0.4f, yb - 0.3f, 0f), new Vector3(r + 0.4f, yb - 0.1f, 0.95f), Pal.Lighten(st.plinth, 0.08f), Pal.Lighten(st.plinth, 0.2f));
            }
            if (st.surround)
            {
                // pilasters and a pediment round the door (grand houses, halls, temples)
                Color pc = Pal.Rgb(0xf0e8d6);
                if (st.wm != WallMat.Ashlar && st.wm != WallMat.Plaster) pc = Pal.Lighten(st.wall, 0.3f);
                float pw = 0.2f;
                foreach (float side in new[] { l - fw - pw, r + fw })
                {
                    mb.Box(new Vector3(side, yb, 0f), new Vector3(side + pw, yb + dh + 0.12f, 0.15f), pc, Pal.Mul(pc, 1.08f));
                    mb.Box(new Vector3(side - 0.04f, yb, 0f), new Vector3(side + pw + 0.04f, yb + 0.14f, 0.18f), Pal.Mul(pc, 0.92f));
                    mb.Box(new Vector3(side - 0.04f, yb + dh + 0.04f, 0f), new Vector3(side + pw + 0.04f, yb + dh + 0.16f, 0.18f), Pal.Mul(pc, 0.95f));
                }
                float ly = yb + dh + 0.16f;
                mb.Box(new Vector3(l - fw - pw - 0.08f, ly, 0f), new Vector3(r + fw + pw + 0.08f, ly + 0.14f, 0.2f), pc, Pal.Mul(pc, 1.1f));
                float pe = (r - l) * 0.5f + fw + pw + 0.08f;
                mb.Tri(new Vector3(mid - pe, ly + 0.14f, 0.1f), new Vector3(mid + pe, ly + 0.14f, 0.1f), new Vector3(mid, ly + 0.14f + pe * 0.42f, 0.1f), pc, Vector3.forward);
                mb.Tri(new Vector3(mid - pe * 0.7f, ly + 0.2f, 0.115f), new Vector3(mid + pe * 0.7f, ly + 0.2f, 0.115f), new Vector3(mid, ly + 0.2f + pe * 0.3f, 0.115f), Pal.Mul(WallCol(st, 0), 0.9f), Vector3.forward);
            }
            if (st.awning)
            {
                Awning(mb, l - 0.35f, r + 0.35f, yb + dh + 0.35f, 1.15f, st, sd);
            }
            if (st.porch)
            {
                float pz = 1.25f;
                float ph = dh + 0.55f;
                Color wood = st.wm == WallMat.Logs ? Pal.Mul(st.wall, 0.8f) : st.trim;
                mb.Box(new Vector3(l - 0.55f, yb - 0.1f, 0f), new Vector3(r + 0.55f, yb + 0.03f, pz + 0.1f), Pal.Mul(wood, 1.15f), Pal.Mul(wood, 1.3f));
                foreach (float pu in new[] { l - 0.4f, r + 0.4f })
                {
                    mb.Box(new Vector3(pu - 0.07f, yb, pz - 0.07f), new Vector3(pu + 0.07f, yb + ph, pz + 0.07f), wood);
                    mb.Box(new Vector3(pu - 0.1f, yb, pz - 0.1f), new Vector3(pu + 0.1f, yb + 0.12f, pz + 0.1f), st.plinth);
                }
                mb.Box(new Vector3(l - 0.5f, yb + ph - 0.12f, pz - 0.08f), new Vector3(r + 0.5f, yb + ph + 0.04f, pz + 0.08f), wood);
                // lean-to roof from the wall down to the front beam
                float yWall = yb + ph + 0.55f, yFront = yb + ph + 0.12f, uu0 = l - 0.65f, uu1 = r + 0.65f, zFront = pz + 0.25f;
                Color rc = Pal.Mul(st.roof, 0.95f);
                mb.Quad(new Vector3(uu0, yWall, 0f), new Vector3(uu1, yWall, 0f), new Vector3(uu1, yFront, zFront), new Vector3(uu0, yFront, zFront), rc, new Vector3(0, 1, 0.5f));
                mb.Quad(new Vector3(uu0, yWall - 0.1f, 0f), new Vector3(uu1, yWall - 0.1f, 0f), new Vector3(uu1, yFront - 0.1f, zFront), new Vector3(uu0, yFront - 0.1f, zFront), Pal.Mul(rc, 0.6f), Vector3.down);
                mb.Quad(new Vector3(uu0, yFront, zFront), new Vector3(uu1, yFront, zFront), new Vector3(uu1, yFront - 0.1f, zFront), new Vector3(uu0, yFront - 0.1f, zFront), Pal.Mul(rc, 0.75f), Vector3.forward);
                mb.Quad(new Vector3(uu0, yWall, 0f), new Vector3(uu0, yFront, zFront), new Vector3(uu0, yFront - 0.1f, zFront), new Vector3(uu0, yWall - 0.1f, 0f), Pal.Mul(rc, 0.8f), Vector3.left);
                mb.Quad(new Vector3(uu1, yWall, 0f), new Vector3(uu1, yFront, zFront), new Vector3(uu1, yFront - 0.1f, zFront), new Vector3(uu1, yWall - 0.1f, 0f), Pal.Mul(rc, 0.8f), Vector3.right);
            }
            if (st.hanging)
            {
                float su = mid + 1.5f < len - 0.5f ? mid + 1.5f : mid - 1.5f;
                float sy = yb + 2.1f + (st.kind == "smithy" ? 0f : 0.5f);
                mb.Box(new Vector3(su - 0.04f, sy + 0.55f, 0f), new Vector3(su + 0.04f, sy + 0.63f, 0.75f), st.trim);
                if (st.kind == "smithy")
                {
                    // a horseshoe on an iron bracket
                    mb.Box(new Vector3(su - 0.22f, sy - 0.05f, 0.68f), new Vector3(su - 0.14f, sy + 0.45f, 0.72f), Pal.Rgb(0x3a3a3e));
                    mb.Box(new Vector3(su + 0.14f, sy - 0.05f, 0.68f), new Vector3(su + 0.22f, sy + 0.45f, 0.72f), Pal.Rgb(0x3a3a3e));
                    mb.Box(new Vector3(su - 0.22f, sy - 0.05f, 0.68f), new Vector3(su + 0.22f, sy + 0.03f, 0.72f), Pal.Rgb(0x3a3a3e));
                }
                else
                {
                    mb.Box(new Vector3(su - 0.38f, sy, 0.66f), new Vector3(su + 0.38f, sy + 0.5f, 0.72f), st.sign);
                    mb.Box(new Vector3(su - 0.3f, sy + 0.07f, 0.72f), new Vector3(su + 0.3f, sy + 0.13f, 0.74f), Pal.Rgb(0xf3e7c4));
                }
            }
        }

        static void Awning(MeshBuilder mb, float u0, float u1, float y, float projection, Style st, uint sd)
        {
            Color a = st.accent, c = Cream;
            if (st.a.id == "river") a = Pal.Rgb(new[] { 0xb9503f, 0x4f7ab0, 0x5f9a5a }[sd % 3]);
            int stripes = Mathf.Max(3, Mathf.RoundToInt((u1 - u0) / 0.28f));
            float sw = (u1 - u0) / stripes;
            for (int i = 0; i < stripes; i++)
            {
                Color col = i % 2 == 0 ? a : c;
                float x = u0 + i * sw;
                mb.Quad(new Vector3(x, y + 0.25f, 0.02f), new Vector3(x + sw, y + 0.25f, 0.02f), new Vector3(x + sw, y - 0.12f, projection), new Vector3(x, y - 0.12f, projection), col, new Vector3(0, 1, 0.6f));
                mb.Quad(new Vector3(x, y + 0.25f, 0.02f), new Vector3(x + sw, y + 0.25f, 0.02f), new Vector3(x + sw, y + 0.18f, 0.03f), new Vector3(x, y + 0.18f, 0.03f), Pal.Mul(col, 0.8f), Vector3.down);
                // scalloped valance
                mb.Tri(new Vector3(x, y - 0.12f, projection), new Vector3(x + sw, y - 0.12f, projection), new Vector3(x + sw * 0.5f, y - 0.3f, projection), col, Vector3.forward);
                // underside
                mb.Quad(new Vector3(x, y + 0.18f, 0.03f), new Vector3(x + sw, y + 0.18f, 0.03f), new Vector3(x + sw, y - 0.14f, projection - 0.02f), new Vector3(x, y - 0.14f, projection - 0.02f), Pal.Mul(col, 0.55f), Vector3.down);
            }
            mb.Box(new Vector3(u0 - 0.02f, y - 0.14f, 0.5f * projection - 0.02f), new Vector3(u0 + 0.02f, y + 0.2f, 0.5f * projection + 0.02f), Pal.Rgb(0x3a2e24));
            mb.Box(new Vector3(u1 - 0.02f, y - 0.14f, 0.5f * projection - 0.02f), new Vector3(u1 + 0.02f, y + 0.2f, 0.5f * projection + 0.02f), Pal.Rgb(0x3a2e24));
        }

        // ------------------------------------------------------------------ wall detailing

        void Detailing(MeshBuilder mb, List<Opening> ops, float len, float yb, float below, Style st, int fl, int face, bool gableEnd, bool hasDoor, bool longFace, bool ground, bool top, uint sd)
        {
            float h = st.floorH;
            float yTop = yb + h;

            // Between storeys: a jetty beam with brackets (river), or a string course.
            if (fl > 0 && (st.jetty || st.cornice || st.wm == WallMat.Ashlar))
            {
                Color bc = st.jetty ? st.trim : Pal.Mul(st.wall2, 1.05f);
                float proj = st.jetty ? 0.15f : 0.1f;
                mb.Box(new Vector3(-0.04f, yb - 0.2f, -T), new Vector3(len + 0.04f, yb + 0.02f, proj), bc, Pal.Lighten(bc, 0.1f));
                if (st.jetty)
                {
                    int nb = Mathf.Max(2, Mathf.RoundToInt(len / 1.0f));
                    for (int i = 0; i <= nb; i++)
                    {
                        float u = Mathf.Lerp(0.15f, len - 0.15f, i / (float)nb);
                        mb.Quad(new Vector3(u - 0.04f, yb - 0.2f, proj), new Vector3(u + 0.04f, yb - 0.2f, proj), new Vector3(u + 0.04f, yb - 0.5f, 0.02f), new Vector3(u - 0.04f, yb - 0.5f, 0.02f), bc, Vector3.forward);
                    }
                }
            }
            // Cornice with dentils under the eaves.
            if (st.cornice && top)
            {
                Color cc = Pal.Lighten(st.wm == WallMat.Ashlar && fl > 0 && st.upperTone ? st.wall2 : st.wall, 0.2f);
                mb.Box(new Vector3(-0.1f, yTop - 0.26f, -T), new Vector3(len + 0.1f, yTop, 0.2f), cc, Pal.Lighten(cc, 0.1f));
                int nd = Mathf.Max(4, Mathf.RoundToInt(len / 0.26f));
                for (int i = 0; i < nd; i++)
                {
                    float u = Mathf.Lerp(0.05f, len - 0.05f, (i + 0.5f) / nd);
                    mb.Box(new Vector3(u - 0.05f, yTop - 0.42f, 0f), new Vector3(u + 0.05f, yTop - 0.26f, 0.12f), Pal.Mul(cc, 0.95f));
                }
            }
            // Quoins: alternating dressed blocks at the corners.
            if (st.quoins && longFace)
            {
                Color qc = Pal.Lighten(st.wall, 0.22f);
                int qi = 0;
                for (float y = ground ? st.foundation : 0f; y < h - 0.5f; y += 0.5f, qi++)
                {
                    float qw = qi % 2 == 0 ? 0.5f : 0.32f;
                    mb.Box(new Vector3(0f, yb + y + 0.01f, -T), new Vector3(qw, yb + y + 0.49f, 0.035f), Pal.Mul(qc, 0.97f + 0.06f * F(sd, qi, 4)));
                    mb.Box(new Vector3(len - qw, yb + y + 0.01f, -T), new Vector3(len, yb + y + 0.49f, 0.035f), Pal.Mul(qc, 0.97f + 0.06f * F(sd, qi, 5)));
                }
            }
            // Pilasters between the openings on the long faces of grand buildings.
            if (st.pilasters && longFace)
            {
                Color pc = Pal.Lighten(WallCol(st, fl), 0.28f);
                var xs = new List<float> { 0f, len };
                for (int i = 0; i + 1 < ops.Count; i++) xs.Add((ops[i].u + ops[i].w * 0.5f + ops[i + 1].u - ops[i + 1].w * 0.5f) * 0.5f);
                if (ops.Count > 0) { xs.Add(ops[0].u - ops[0].w * 0.5f - 0.35f); xs.Add(ops[ops.Count - 1].u + ops[ops.Count - 1].w * 0.5f + 0.35f); }
                foreach (var u in xs)
                {
                    float pw = 0.18f;
                    float uu = Mathf.Clamp(u, pw, len - pw);
                    float y0 = ground ? st.foundation : 0f;
                    if (Overlaps(ops, uu, pw + 0.05f)) continue;
                    mb.Box(new Vector3(uu - pw, yb + y0, 0f), new Vector3(uu + pw, yb + h - 0.28f, 0.1f), pc, Pal.Mul(pc, 1.08f));
                    mb.Box(new Vector3(uu - pw - 0.04f, yb + y0, 0f), new Vector3(uu + pw + 0.04f, yb + y0 + 0.14f, 0.13f), Pal.Mul(pc, 0.93f));
                    mb.Box(new Vector3(uu - pw - 0.04f, yb + h - 0.4f, 0f), new Vector3(uu + pw + 0.04f, yb + h - 0.28f, 0.13f), Pal.Mul(pc, 0.95f));
                }
            }
            // Corner posts and a head plate for timber framing, corner stones for stone buttress, corner log ends for logs.
            if (st.wm == WallMat.HalfTimber || st.jetty)
            {
                mb.Box(new Vector3(0f, yTop - 0.2f, -T - 0.02f), new Vector3(len, yTop, 0.045f), st.trim);
            }
            if (st.wm == WallMat.Logs)
            {
                int courses = Mathf.FloorToInt(h / 0.3f);
                Color lc = Pal.Mul(st.wall, 0.82f);
                for (int i = (face % 2); i < courses; i += 2)
                {
                    float y = (ground ? 0f : 0f) + i * 0.3f;
                    float yy = yb + y;
                    mb.Box(new Vector3(-0.15f, yy, -T - 0.12f), new Vector3(0.0f, yy + 0.28f, 0.07f), Pal.Mul(lc, 0.9f + 0.2f * F(sd, i, 6)), Pal.Mul(lc, 1.2f));
                    mb.Box(new Vector3(len, yy, -T - 0.12f), new Vector3(len + 0.15f, yy + 0.28f, 0.07f), Pal.Mul(lc, 0.9f + 0.2f * F(sd, i, 7)), Pal.Mul(lc, 1.2f));
                }
                if (top) mb.Box(new Vector3(-0.15f, yTop - 0.08f, -T - 0.12f), new Vector3(len + 0.15f, yTop, 0.09f), Pal.Mul(st.trim, 1.1f));
            }
            if (st.buttress && ground && longFace)
            {
                Color bc = Pal.Mul(st.wall, 0.82f);
                foreach (float u in new[] { 0f, len - 0.4f })
                {
                    mb.Box(new Vector3(u, yb - below, -T), new Vector3(u + 0.4f, yb + 0.7f, 0.2f), bc, Pal.Mul(bc, 1.12f));
                    mb.Box(new Vector3(u + 0.04f, yb + 0.7f, -T), new Vector3(u + 0.36f, yb + 1.15f, 0.12f), bc, Pal.Mul(bc, 1.12f));
                }
            }
            // Adobe: projecting roof beams and a painted frieze under the roof.
            if (st.vigas && top)
            {
                Color vc = Pal.Mul(st.trim, 1.2f);
                int nv = Mathf.Max(3, Mathf.RoundToInt(len / 0.62f));
                for (int i = 0; i < nv; i++)
                {
                    float u = Mathf.Lerp(0.25f, len - 0.25f, (i + 0.5f) / nv);
                    mb.Box(new Vector3(u - 0.07f, yTop - 0.38f, -T), new Vector3(u + 0.07f, yTop - 0.24f, 0.28f), vc, Pal.Lighten(vc, 0.2f));
                }
            }
            if (st.paintedBand && top)
            {
                Color a = st.accent, b2 = Pal.Rgb(0xe8d8b8);
                mb.Box(new Vector3(0f, yTop - 0.62f, 0f), new Vector3(len, yTop - 0.56f, 0.012f), a);
                int nt = Mathf.Max(4, Mathf.RoundToInt(len / 0.3f));
                for (int i = 0; i < nt; i++)
                {
                    float u0 = len * i / nt, u1 = len * (i + 1) / nt;
                    mb.Tri(new Vector3(u0, yTop - 0.56f, 0.014f), new Vector3(u1, yTop - 0.56f, 0.014f), new Vector3((u0 + u1) * 0.5f, yTop - 0.38f, 0.014f), i % 2 == 0 ? b2 : a, Vector3.forward);
                }
            }
            // Painted door-side stripe for steppe: an accent line at the foundation.
            if (st.wm == WallMat.Adobe && ground)
                mb.Box(new Vector3(0f, yb + st.foundation, 0f), new Vector3(len, yb + st.foundation + 0.07f, 0.012f), st.accent);
            // Balcony on the first storey above the door side.
            if (st.balcony && fl == 1 && longFace && face == 0 && ops.Count > 0)
            {
                foreach (var op in ops)
                {
                    if (op.door) continue;
                    float bw = op.w + 0.7f;
                    float u0 = op.u - bw * 0.5f, u1 = op.u + bw * 0.5f;
                    if (u0 < 0.1f || u1 > len - 0.1f) continue;
                    Color wood = st.wm == WallMat.Ashlar ? Pal.Rgb(0xefe6d2) : st.trim;
                    mb.Box(new Vector3(u0, yb + st.winBottom - 0.15f, 0f), new Vector3(u1, yb + st.winBottom - 0.02f, 0.55f), wood, Pal.Lighten(wood, 0.15f));
                    // rail
                    float ry = yb + st.winBottom - 0.02f;
                    int np = Mathf.Max(6, Mathf.RoundToInt(bw / 0.15f));
                    for (int i = 0; i <= np; i++)
                    {
                        float u = Mathf.Lerp(u0 + 0.03f, u1 - 0.03f, i / (float)np);
                        mb.Box(new Vector3(u - 0.015f, ry, 0.5f), new Vector3(u + 0.015f, ry + 0.75f, 0.53f), Pal.Mul(wood, 0.9f));
                    }
                    mb.Box(new Vector3(u0, ry + 0.75f, 0.47f), new Vector3(u1, ry + 0.82f, 0.56f), wood);
                    mb.Box(new Vector3(u0, ry, 0.5f), new Vector3(u0 + 0.04f, ry + 0.82f, 0.56f), wood);
                    mb.Box(new Vector3(u1 - 0.04f, ry, 0.5f), new Vector3(u1, ry + 0.82f, 0.56f), wood);
                    break;
                }
            }
            // A banner on a pole beside the door of a hall or barracks.
            if (st.banner && hasDoor)
            {
                float pu = Mathf.Min(len - 0.25f, ops.Count > 0 ? ops[0].u + ops[0].w * 0.5f + 0.9f : len * 0.8f);
                if (pu > 0.5f && pu < len - 0.2f)
                {
                    mb.Box(new Vector3(pu - 0.03f, yb, 0.1f), new Vector3(pu + 0.03f, yb + 3.3f, 0.16f), Pal.Rgb(0x5a3f2b));
                    Color bc = st.accent;
                    mb.Quad(new Vector3(pu + 0.03f, yb + 3.2f, 0.12f), new Vector3(pu + 0.6f, yb + 3.2f, 0.12f), new Vector3(pu + 0.6f, yb + 2.35f, 0.12f), new Vector3(pu + 0.03f, yb + 2.35f, 0.12f), bc, Vector3.forward);
                    mb.Tri(new Vector3(pu + 0.03f, yb + 2.35f, 0.12f), new Vector3(pu + 0.6f, yb + 2.35f, 0.12f), new Vector3(pu + 0.315f, yb + 2.08f, 0.12f), bc, Vector3.forward);
                    mb.Quad(new Vector3(pu + 0.14f, yb + 2.9f, 0.125f), new Vector3(pu + 0.49f, yb + 2.9f, 0.125f), new Vector3(pu + 0.49f, yb + 2.6f, 0.125f), new Vector3(pu + 0.14f, yb + 2.6f, 0.125f), Pal.Rgb(0xe8c25a), Vector3.forward);
                }
            }
        }

        static bool Overlaps(List<Opening> ops, float u, float half)
        {
            foreach (var o in ops) if (Mathf.Abs(u - o.u) < o.w * 0.5f + half) return true;
            return false;
        }
    }
}
