// The latest of what the server sent: the frame applied change by change (actors, the patch cache, buildings,
// lights, signs, marks) and the UI model panel by panel. A port of packages/client/src/core/mirror.ts.
// No rules: it only keeps what it was told. Events fire after a whole frame has been applied, so handlers always
// see a consistent mirror. Everything here runs on the thread that calls Apply* (Unity's main thread).
using System;
using System.Collections.Generic;
using System.Diagnostics;

namespace GardenOfEden.Net
{
    public class FrameChange
    {
        /// <summary>A new map (or the first frame): everything was replaced.</summary>
        public bool whole;
        public List<string> added = new List<string>();
        public List<string> updated = new List<string>();
        public List<string> moved = new List<string>();
        public List<string> removed = new List<string>();
        public List<Patch> patches = new List<Patch>();
        public bool buildings, lights, signs, marks;
    }

    public enum ActorChange { Added, Updated, Moved }

    public class Mirror
    {
        public const int PATCH = 16;
        const int FeedMax = 200;

        static readonly Stopwatch Clock = Stopwatch.StartNew();
        /// <summary>Seconds since the process started on a monotonic clock (engine-free stand-in for performance.now).</summary>
        public static double Now => Clock.Elapsed.TotalSeconds;

        public MapInfo map;
        public Box box = new Box();
        public readonly Dictionary<string, Actor> actors = new Dictionary<string, Actor>();
        public readonly Dictionary<string, Patch> patches = new Dictionary<string, Patch>();
        public List<Building> buildings = new List<Building>();
        public List<Light> lights = new List<Light>();
        public List<Sign> signs = new List<Sign>();
        /// <summary>The place's marks (N31): burned houses, scaffolding, graves, banners, empty stalls.</summary>
        public List<Mark> marks = new List<Mark>();
        /// <summary>What there is to hear (N29), kept until it changes.</summary>
        public ScapeInput sound;
        public PlayerPos player = new PlayerPos();
        public Ambience ambience = new Ambience();
        public FramePrompt prompt;
        /// <summary>The fight clock; count down locally from <see cref="fightHeardAt"/> between frames.</summary>
        public FightClock fight;
        public double fightHeardAt;
        public double stepMs = 100;
        public List<Chatter> chatter = new List<Chatter>();
        public List<Gossip> gossip = new List<Gossip>();
        public UiModel ui;

        // ---- change events ----
        public event Action<Patch> PatchAdded;
        /// <summary>The patch cache was dropped (a new map). Raised before the new frame's PatchAdded events.</summary>
        public event Action PatchesCleared;
        public event Action<Actor, ActorChange> ActorChanged;
        public event Action<string> ActorRemoved;
        public event Action BuildingsChanged;
        public event Action LightsChanged;
        public event Action SignsChanged;
        public event Action MarksChanged;
        public event Action AmbienceChanged;
        public event Action<IReadOnlyList<string>> UiChanged;

        /// <summary>Seconds left on the fight clock, counted down from when it was heard (never below 0); -1 when no fight.</summary>
        public double FightSecondsLeft => fight == null ? -1 : Math.Max(0, fight.secondsLeft - (Now - fightHeardAt));

        public FrameChange ApplyFrame(Frame f, bool whole)
        {
            var change = new FrameChange
            {
                whole = whole,
                patches = f.patches ?? new List<Patch>(),
                buildings = f.buildings != null,
                lights = f.lights != null,
                signs = f.signs != null,
                marks = f.marks != null,
            };
            var oldAmbience = ambience;
            if (whole)
            {
                marks = new List<Mark>();
                actors.Clear();
                patches.Clear();
                buildings = new List<Building>();
                lights = new List<Light>();
                signs = new List<Sign>();
                sound = null;
            }
            map = f.map;
            box = f.box;
            foreach (var p in change.patches) patches[PatchKey(p.x0, p.y0)] = p;

            var a = f.actors;
            if (a != null)
            {
                foreach (var actor in a.upsert)
                {
                    (actors.ContainsKey(actor.id) ? change.updated : change.added).Add(actor.id);
                    actors[actor.id] = actor;
                }
                Dictionary<string, List<Point>> routes = null;
                if (a.routes != null)
                {
                    routes = new Dictionary<string, List<Point>>();
                    foreach (var r in a.routes) routes[r.id] = r.route;
                }
                if (a.move != null)
                {
                    foreach (var m in a.move)
                    {
                        if (!actors.TryGetValue(m.id, out var actor)) continue;
                        actor.x = m.x;
                        actor.y = m.y;
                        if (routes != null && routes.TryGetValue(m.id, out var route)) actor.route = route;
                        else actor.route = null;
                        change.moved.Add(m.id);
                    }
                }
                foreach (var id in a.remove) if (actors.Remove(id)) change.removed.Add(id);
            }

            if (f.drop != null)
            {
                // Changes only: drop what left the view, then put in the new and changed by id.
                buildings = MergeById(buildings, f.buildings ?? new List<Building>(), f.drop.buildings, b => b.id);
                lights = MergeById(lights, f.lights ?? new List<Light>(), f.drop.lights, l => l.id);
                change.buildings = (f.buildings != null && f.buildings.Count > 0) || f.drop.buildings.Count > 0;
                change.lights = (f.lights != null && f.lights.Count > 0) || f.drop.lights.Count > 0;
            }
            else
            {
                if (f.buildings != null) buildings = f.buildings;
                if (f.lights != null) lights = f.lights;
            }
            if (f.signs != null) signs = f.signs;
            if (f.marks != null) marks = f.marks;
            if (f.sound != null) sound = f.sound;
            player = f.player ?? player;
            ambience = f.ambience ?? ambience;
            prompt = f.prompt;
            fight = f.fight;
            fightHeardAt = Now;
            chatter = f.chatter ?? new List<Chatter>();
            gossip = f.gossip ?? new List<Gossip>();
            stepMs = f.stepMs;

            // Events, now that the mirror is consistent.
            if (whole) PatchesCleared?.Invoke();
            foreach (var p in change.patches) PatchAdded?.Invoke(p);
            foreach (var id in change.added) if (actors.TryGetValue(id, out var x)) ActorChanged?.Invoke(x, ActorChange.Added);
            foreach (var id in change.updated) if (actors.TryGetValue(id, out var x)) ActorChanged?.Invoke(x, ActorChange.Updated);
            foreach (var id in change.moved) if (actors.TryGetValue(id, out var x)) ActorChanged?.Invoke(x, ActorChange.Moved);
            foreach (var id in change.removed) ActorRemoved?.Invoke(id);
            if (change.buildings || whole) BuildingsChanged?.Invoke();
            if (change.lights || whole) LightsChanged?.Invoke();
            if (change.signs || whole) SignsChanged?.Invoke();
            if (change.marks || whole) MarksChanged?.Invoke();
            if (whole || AmbienceDiffers(oldAmbience, ambience)) AmbienceChanged?.Invoke();
            return change;
        }

        static bool AmbienceDiffers(Ambience a, Ambience b) =>
            a == null || b == null || a.light != b.light || a.timeOfDay != b.timeOfDay || a.weather != b.weather || a.season != b.season || a.snow != b.snow;

        /// <summary>The patch cache key for a tile (or a patch origin): which 16x16 piece holds it.</summary>
        public static string PatchKey(int x, int y) => FloorDiv(x, PATCH) + ":" + FloorDiv(y, PATCH);

        static int FloorDiv(int a, int b) => (int)Math.Floor(a / (double)b);

        public Patch PatchAt(int x, int y) => patches.TryGetValue(PatchKey(x, y), out var p) ? p : null;

        /// <summary>The art at a tile; false until its patch has come.</summary>
        public bool TileAt(int x, int y, out string ground, out string obj)
        {
            ground = null;
            obj = null;
            var p = PatchAt(x, y);
            if (p == null || !p.Contains(x, y)) return false;
            int i = p.IndexOf(x, y);
            ground = ArtIds.Terrain(i < p.ground.Length ? p.ground[i] : 0);
            obj = ArtIds.Object(i < p.objects.Length ? p.objects[i] : 0);
            return true;
        }

        /// <summary>The land's height at a tile, in tiles (eighths / 8), if its patch has come; a patch without heights is flat.</summary>
        public float? HeightAt(int x, int y)
        {
            var p = PatchAt(x, y);
            if (p == null || !p.Contains(x, y)) return null;
            int i = p.IndexOf(x, y);
            return p.EighthsAt(i) / 8f;
        }

        /// <summary>A mark on a tile, if any (its words go in the hover).</summary>
        public Mark MarkAt(double x, double y)
        {
            foreach (var m in marks) if (x >= m.x && x < m.x + m.w && y >= m.y && y < m.y + m.h) return m;
            return null;
        }

        /// <summary>Someone to point at on a tile: the nearest actor within 0.75 tiles (travellers stand between tiles).</summary>
        public Actor ActorAt(double x, double y)
        {
            Actor best = null;
            double bd = 0.75;
            foreach (var a in actors.Values)
            {
                if (a.id == "player") continue;
                double d = Math.Sqrt((a.x - x) * (a.x - x) + (a.y - y) * (a.y - y));
                if (d < bd) { bd = d; best = a; }
            }
            return best;
        }

        public Building BuildingAt(double x, double y)
        {
            foreach (var b in buildings) if (x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h) return b;
            return null;
        }

        /// <summary>Replace the panels named in <paramref name="msg"/>.keys; returns those keys.</summary>
        public IReadOnlyList<string> ApplyUi(UiMsg msg)
        {
            if (ui == null) ui = new UiModel();
            var p = msg.ui;
            foreach (var key in msg.keys)
            {
                switch (key)
                {
                    case UiKeys.Header: ui.header = p.header; break;
                    case UiKeys.Feed: ui.feed = p.feed; break;
                    case UiKeys.Chat: ui.chat = p.chat; break;
                    case UiKeys.Sheet: ui.sheet = p.sheet; break;
                    case UiKeys.Roadbar: ui.roadbar = p.roadbar; break;
                    case UiKeys.Realm: ui.realm = p.realm; break;
                    case UiKeys.Modal: ui.modal = p.modal; break;
                    case UiKeys.Cast: ui.cast = p.cast; break;
                }
            }
            UiChanged?.Invoke(msg.keys);
            return msg.keys;
        }

        /// <summary>Append new lines to ui.feed.lines, keeping the last 200.</summary>
        public void AppendFeed(List<FeedLine> lines)
        {
            if (ui == null) return;
            var all = new List<FeedLine>(ui.feed?.lines ?? new List<FeedLine>());
            all.AddRange(lines);
            if (all.Count > FeedMax) all.RemoveRange(0, all.Count - FeedMax);
            ui.feed = new FeedPanel { lines = all };
        }

        /// <summary>A list with `gone` taken out and `upsert` put in by id (in place where it was, at the end if new).</summary>
        static List<T> MergeById<T, K>(List<T> list, List<T> upsert, List<K> gone, Func<T, K> id)
        {
            var drop = new HashSet<K>(gone);
            var byId = new Dictionary<K, T>();
            foreach (var x in upsert) byId[id(x)] = x;
            var outList = new List<T>();
            var have = new HashSet<K>();
            foreach (var x in list)
            {
                var k = id(x);
                if (drop.Contains(k)) continue;
                outList.Add(byId.TryGetValue(k, out var replaced) ? replaced : x);
                have.Add(k);
            }
            foreach (var x in upsert) if (have.Add(id(x))) outList.Add(x);
            return outList;
        }
    }
}
