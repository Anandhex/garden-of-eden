// The frame: what to draw (packages/shared/src/view/schema.ts). Field names match the JSON so Newtonsoft maps them
// directly; unknown fields are ignored. Lists that can be absent (patches, buildings, lights, signs, marks, drop,
// sound) are left null when absent, because "absent" and "empty" mean different things.
using System;
using System.Collections.Generic;
using Newtonsoft.Json;

namespace GardenOfEden.Net
{
    public class Point
    {
        public double x;
        public double y;
    }

    public class MapInfo
    {
        public string id;
        public string name;
        /// <summary>"place" or "road".</summary>
        public string kind;
        /// <summary>Null on the road, which has no edge.</summary>
        public double? w;
        public double? h;
        /// <summary>The place's locale (G8 locality); null on the road, inside, or with no realm.</summary>
        public Locale locale;
        public bool IsRoad => kind == "road";
    }

    /// <summary>How the place lives, for how its buildings are built: culture template, land, wealth 0..1, size.</summary>
    public class Locale
    {
        public string culture;
        /// <summary>valley, hills, forest, plains, coast or marsh.</summary>
        public string terrain;
        public double wealth;
        /// <summary>hamlet, village, town, city or capital.</summary>
        public string size;
    }

    public class Box
    {
        public double x0, y0, x1, y1;
    }

    public class Patch
    {
        public string key;
        public int x0, y0, w, h;
        /// <summary>Indices into ArtIds.TERRAIN_IDS, row by row.</summary>
        public int[] ground = Array.Empty<int>();
        /// <summary>Indices into ArtIds.OBJECT_IDS (0 = nothing), row by row.</summary>
        public int[] objects = Array.Empty<int>();
        /// <summary>Land height in eighths of a tile, row by row; null means flat.</summary>
        public int[] height;
        /// <summary>Land relief in eighths of a tile (0..255) for this 3D client; null means use <see cref="height"/>.</summary>
        public int[] relief;

        /// <summary>The land's height at index i in eighths of a tile (relief when the server sent it, else height, else flat).</summary>
        public int EighthsAt(int i)
        {
            var a = relief ?? height;
            return a != null && i < a.Length ? a[i] : 0;
        }

        public bool Contains(int x, int y) => x >= x0 && y >= y0 && x < x0 + w && y < y0 + h;
        public int IndexOf(int x, int y) => (y - y0) * w + (x - x0);
    }

    public class Building
    {
        public int id;
        public double x, y, w, h;
        public string kind;
        public string color;
        public bool lit;
        public string label;
        public string tip;
        /// <summary>The template it is dressed in (templates.json).</summary>
        public string template;
        /// <summary>Its door's tile, if any.</summary>
        public Point door;
        public bool? smoke;
        /// <summary>Architecture of the town's culture: highland, river, coastal, forest, steppe, imperial. Null: default.</summary>
        public string style;
    }

    public class Light
    {
        public string id;
        public double x, y;
        /// <summary>window, lamp, fire, torch, forge, magic.</summary>
        public string kind;
        public bool on;
    }

    public class Sign
    {
        public string id;
        public double x, y;
        public string text;
        /// <summary>exit or place.</summary>
        public string kind;
    }

    /// <summary>A mark on a place's map (N31); see ArtIds.MARK_KINDS.</summary>
    public class Mark
    {
        public string id;
        public string kind;
        public double x, y, w, h;
        public string label;
        public string colour;
    }

    public class ActorLook
    {
        /// <summary>An art id (people/body, creature/wolf, fx/grave...).</summary>
        public string sprite;
        public string tint;
        public string trim;
        public double? size;
        /// <summary>Who this is, for building a body from parts (all optional). People: human, elf, dwarf, halfling, orc. Creatures: wolf, deer, goblin...</summary>
        public string species;
        /// <summary>"f" or "m"; null: pick from the id.</summary>
        public string sex;
        /// <summary>child, adult, elder, venerable.</summary>
        public string age;
        /// <summary>Social class (slave ... royal) of townsfolk.</summary>
        public string cls;
        /// <summary>Job or role (smith, innkeeper, guard, child...).</summary>
        public string job;
        /// <summary>Culture template of the place (highland, river, coastal, forest, steppe, imperial).</summary>
        public string culture;
    }

    public static class ActorKind
    {
        public const string Player = "player", Npc = "npc", Folk = "folk", Traveller = "traveller", Creature = "creature", Companion = "companion";
    }

    public static class ActorFlag
    {
        public const string Hostile = "hostile", Dead = "dead", Unconscious = "unconscious", Engaged = "engaged", Quest = "quest",
            Busy = "busy", Inside = "inside", Noble = "noble", Lowborn = "lowborn";
    }

    public class Actor
    {
        public string id;
        public string kind;
        public double x, y;
        /// <summary>n, e, s, w; null when not set.</summary>
        public string facing;
        public ActorLook look = new ActorLook();
        public string label;
        public string shortLabel;
        public string tip;
        public double? hp;
        public List<string> flags = new List<string>();
        /// <summary>The tiles to animate through (no pathfinding in the adapter).</summary>
        public List<Point> route;

        public bool HasFlag(string flag) => flags != null && flags.Contains(flag);
    }

    /// <summary>`[id, x, y]` in the JSON.</summary>
    [JsonConverter(typeof(MoveEntryConverter))]
    public class MoveEntry
    {
        public string id;
        public double x, y;
    }

    public class ActorRoute
    {
        public string id;
        public List<Point> route = new List<Point>();
    }

    public class ActorsDelta
    {
        public List<Actor> upsert = new List<Actor>();
        public List<MoveEntry> move;
        public List<ActorRoute> routes;
        public List<string> remove = new List<string>();
    }

    public class PlayerPos
    {
        public string id = "player";
        public double x, y;
    }

    public class Ambience
    {
        /// <summary>0 night ... 1 day.</summary>
        public double light = 1;
        public string timeOfDay = "day";
        public string weather = "clear";
        public string season = "spring";
        public bool? snow;
    }

    /// <summary>"E: talk to Ada Lowe", drawn under `target`.</summary>
    public class FramePrompt
    {
        public string text;
        public string target;
        public double x, y;
        /// <summary>talk, fight or danger.</summary>
        public string tone;
    }

    public class FightClock
    {
        public double secondsLeft;
        public double tick;
    }

    public class Chatter
    {
        public string a, b;
        /// <summary>lines[0] is said by a, lines[1] is b's answer.</summary>
        public string[] lines = new string[2];
        public bool hot;
        public bool bow;
    }

    public class Gossip
    {
        public string who;
        public string text;
    }

    public class Drop
    {
        public List<int> buildings = new List<int>();
        public List<string> lights = new List<string>();
    }

    // The soundscape inputs (sound.ts ScapeInput): plain facts, turned into beds and spots by the adapter.
    public class ScapeWhere { public string kind; public string area; public string biome; public string building; }
    public class ScapeNear { public double people; public Dictionary<string, double> working = new Dictionary<string, double>(); public double chatting; public double children; }
    public class ScapeBuilding { public string kind; public double d; public double dx; }
    public class ScapeWildlife { public string species; public double d; public double dx; }
    public class ScapeMood { public double grief, fear, joy; }
    public class ScapeInput
    {
        [JsonProperty("where")] public ScapeWhere place;
        public double minute;
        public string season;
        public string weather;
        public ScapeNear near;
        public List<ScapeBuilding> buildings = new List<ScapeBuilding>();
        public List<ScapeWildlife> wildlife;
        /// <summary>river or sea.</summary>
        public string water;
        public bool? predatorsNear;
        public ScapeMood mood;
        public bool? curfew;
        public List<string> events;
    }

    public class Frame
    {
        public MapInfo map;
        public Box box = new Box();
        public List<Patch> patches;
        public List<Building> buildings;
        public List<Light> lights;
        /// <summary>Present: buildings/lights are only the new or changed ones, and these ids are gone from view.</summary>
        public Drop drop;
        public List<Sign> signs;
        public ScapeInput sound;
        public List<Mark> marks;
        public ActorsDelta actors = new ActorsDelta();
        public PlayerPos player = new PlayerPos();
        public Ambience ambience = new Ambience();
        public FramePrompt prompt;
        public FightClock fight;
        public List<Chatter> chatter;
        public List<Gossip> gossip;
        public double stepMs = 100;
    }
}
