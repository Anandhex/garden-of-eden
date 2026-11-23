// The 3D world. Subscribes to a GameClient's Mirror and builds what it says: terrain patches (smooth ground, water,
// props, grass), buildings (massing with interiors), actors (people and creatures that walk), lights, and the
// day/night + weather. Draws only - every rule stays on the server.
//
// The contract other code relies on:
//   WorldView.TileSize, HeightScale, TileToWorld(x, y, height)   - tile <-> metres (TileToWorld gives the tile's MIDDLE)
//   GroundHeightAt(worldX, worldZ)                               - the drawn ground's height, metres
//   TryGetActor(id, out Transform), PlayerActorId, PlayerChanged - find actors; who "you" are
// See README.md for the rest.
using System.Collections.Generic;
using UnityEngine;
using GardenOfEden.Look;
using GardenOfEden.Net;

namespace GardenOfEden.World
{
    [AddComponentMenu("Garden of Eden/World View")]
    public sealed class WorldView : MonoBehaviour
    {
        // ---------------------------------------------------------------- units

        /// <summary>Metres per tile. A person is about 1.75 m, so a tile is a little under one person wide.</summary>
        public const float TileSize = 1.5f;

        /// <summary>
        /// Metres per tile of height. The server sends heights in eighths of a tile (height.ts, 0..40 = 0..5 tiles);
        /// Mirror.HeightAt divides by 8 to tiles, and this scales tiles of height to metres (0..6 m).
        /// </summary>
        public const float HeightScale = 1.2f;

        /// <summary>How far lake beds sink below the shore (m).</summary>
        public const float WaterDepth = 0.9f;

        /// <summary>The water surface (m): just over the server's water height (2/8 tile).</summary>
        public const float WaterY = 0.25f * HeightScale + 0.3f;

        /// <summary>
        /// A tile position to metres: x -> X, y -> Z, height (in tiles of height, as Mirror.HeightAt gives) -> Y.
        /// Returns the MIDDLE of the tile, so the server's integer tile (x, y) maps to where someone stands on it.
        /// </summary>
        public static Vector3 TileToWorld(float x, float y, float height) => new Vector3((x + 0.5f) * TileSize, height * HeightScale, (y + 0.5f) * TileSize);

        /// <summary>The tile coordinates (continuous, a tile's middle is its integer) of a world point.</summary>
        public static Vector2 WorldToTile(Vector3 w) => new Vector2(w.x / TileSize - 0.5f, w.z / TileSize - 0.5f);

        /// <summary>The tile a world point is over.</summary>
        public static Vector2Int WorldToTileIndex(Vector3 w) => new Vector2Int(Mathf.FloorToInt(w.x / TileSize), Mathf.FloorToInt(w.z / TileSize));

        // ---------------------------------------------------------------- settings

        [Header("Wiring (found in the scene when empty)")]
        public GameClient client;
        public DayNight dayNight;
        [Tooltip("Optional: grass is fed to it from the grass-like tiles.")]
        public GrassField grass;
        [Tooltip("Art id -> prefab overrides. Empty = everything procedural.")]
        public PropManifest manifest;

        [Header("Ground")]
        public bool generateColliders = true;
        [Range(0f, 0.2f)] public float decorDensity = 0.06f;
        [Tooltip("Grass clumps per grass tile fed to GrassField (0 = none). A tile is 2.25 m2; a clump is about 7 blades.")]
        [Range(0f, 30f)] public float grassClumpsPerTile = 17f;
        [Tooltip("Milliseconds per frame spent building patches.")]
        public float patchBudgetMs = 6f;

        [Header("Buildings")]
        public bool buildingColliders = true;

        [Header("Actors")]
        [Tooltip("Metres: closer than this shows the full name.")]
        public float labelNearDistance = 16f;
        [Tooltip("Metres: closer than this shows the short label (beyond it, nothing).")]
        public float labelFarDistance = 45f;

        [Header("Lights")]
        [Range(0, 32)] public int maxPointLights = 16;

        // ---------------------------------------------------------------- public state

        public Mirror Mirror => client != null ? client.Mirror : null;
        [Header("Walking pace (tiles per second)")]
        public float playerTilesPerSecond = 3.2f;
        public float creatureTilesPerSecond = 2.5f;
        public float folkTilesPerSecond = 1.6f;

        /// <summary>The visual walking pace of an actor (1 tile = TileSize metres). Never faster than the server's step cadence.</summary>
        public float WalkTilesPerSecond(bool player, string kind)
        {
            float pace = player ? playerTilesPerSecond : kind == "creature" ? creatureTilesPerSecond : folkTilesPerSecond;
            return Mathf.Min(pace, 1000f / Mathf.Max(30f, (float)StepMs));
        }

        public double StepMs => Mirror != null ? Mirror.stepMs : 100.0;
        public BuildingBuilder Buildings { get; private set; }
        public Transform ActorRoot { get; private set; }
        /// <summary>True while the player is inside a building (its roof and storeys above are hidden) and, with it, anyone else indoors is drawn.</summary>
        public bool PlayerInside { get; private set; }
        /// <summary>The storey the player is on (0 = ground). Set by SetPlayerFloor when the server says so; stairs carry no floor yet.</summary>
        public int PlayerFloor { get; private set; }
        public event System.Action<string> PlayerChanged;

        /// <summary>The actor that is the player: the frame's player id if that actor exists, else the first actor of kind "player".</summary>
        public string PlayerActorId => playerId;

        /// <summary>Where the world looks from: the player, or the camera before the player exists.</summary>
        public Vector3 FocusPoint
        {
            get
            {
                if (actors != null && actors.TryGet(playerId, out var t)) return t.position;
                var cam = Camera.main;
                return cam != null ? cam.transform.position : Vector3.zero;
            }
        }

        /// <summary>The loaded land (for the horizon ring).</summary>
        public TileGrid Grid => grid;

        public float GroundHeightAt(float worldX, float worldZ) => grid.GroundY(worldX, worldZ);

        public bool TryGetActor(string id, out Transform t)
        {
            t = null;
            return actors != null && !string.IsNullOrEmpty(id) && actors.TryGet(id, out t);
        }

        /// <summary>Say which storey the player is on (call when the server tells you).</summary>
        public void SetPlayerFloor(int floor) { PlayerFloor = Mathf.Max(0, floor); insideKey = int.MinValue; }

        /// <summary>True if a building (any, with a margin of one tile) stands at this tile: decor and grass keep off.</summary>
        public bool BuildingNear(int tx, int ty)
        {
            var m = Mirror;
            if (m == null) return false;
            var list = m.buildings;
            for (int i = 0; i < list.Count; i++)
            {
                var b = list[i];
                if (tx >= b.x - 1 && tx < b.x + b.w + 1 && ty >= b.y - 1 && ty < b.y + b.h + 1) return true;
            }
            return false;
        }

        /// <summary>The id of the building whose footprint (with a margin of one tile) holds this tile, or -1.</summary>
        public int BuildingIdAt(int tx, int ty)
        {
            var m = Mirror;
            if (m == null) return -1;
            var list = m.buildings;
            for (int i = 0; i < list.Count; i++)
            {
                var b = list[i];
                if (tx >= b.x - 1 && tx < b.x + b.w + 1 && ty >= b.y - 1 && ty < b.y + b.h + 1) return b.id;
            }
            return -1;
        }

        // ---------------------------------------------------------------- internals

        static readonly int FocusId = Shader.PropertyToID("_GoeFocus");
        readonly TileGrid grid = new TileGrid();
        PatchBuilder patches;
        ActorViews actors;
        LightPool lights;
        Transform terrainRoot, buildingRoot, lightRoot;
        string playerId = "player";
        int insideKey = int.MinValue;
        readonly List<string> queue = new List<string>();
        readonly HashSet<string> queued = new HashSet<string>();
        readonly HashSet<int> litBuildings = new HashSet<int>();
        bool buildingsDirty = true, lightsDirty = true, grassDirty;
        float nextGrass;
        bool subscribed;
        readonly List<GrassSpot> grassAll = new List<GrassSpot>();

        void Awake()
        {
            if (client == null) client = FindFirstObjectByType<GameClient>();
            if (dayNight == null) dayNight = FindFirstObjectByType<DayNight>();
            if (grass == null) grass = FindFirstObjectByType<GrassField>();
            terrainRoot = new GameObject("Terrain").transform; terrainRoot.SetParent(transform, false);
            buildingRoot = new GameObject("Buildings").transform; buildingRoot.SetParent(transform, false);
            ActorRoot = new GameObject("Actors").transform; ActorRoot.SetParent(transform, false);
            lightRoot = new GameObject("Lights").transform; lightRoot.SetParent(transform, false);
            grid.NearBuilding = BuildingNear;
            patches = new PatchBuilder(this, grid, terrainRoot);
            Buildings = new BuildingBuilder(this, grid, buildingRoot);
            actors = new ActorViews(this);
            lights = new LightPool(this, lightRoot, maxPointLights);
            if (GetComponent<HorizonRing>() == null) gameObject.AddComponent<HorizonRing>();
        }

        void OnEnable()
        {
            if (client == null) client = FindFirstObjectByType<GameClient>();
            if (client == null) { Debug.LogWarning("WorldView: no GameClient in the scene."); return; }
            Subscribe();
            FullSync();
        }

        void OnDisable() => Unsubscribe();

        void Subscribe()
        {
            if (subscribed || client == null) return;
            var m = client.Mirror;
            m.PatchAdded += OnPatchAdded;
            m.PatchesCleared += OnPatchesCleared;
            m.ActorChanged += OnActorChanged;
            m.ActorRemoved += OnActorRemoved;
            m.BuildingsChanged += OnBuildingsChanged;
            m.LightsChanged += OnLightsChanged;
            m.AmbienceChanged += OnAmbienceChanged;
            client.OnFrame += OnFrame;
            client.OnSpeech += OnSpeech;
            subscribed = true;
        }

        void Unsubscribe()
        {
            if (!subscribed || client == null) { subscribed = false; return; }
            var m = client.Mirror;
            m.PatchAdded -= OnPatchAdded;
            m.PatchesCleared -= OnPatchesCleared;
            m.ActorChanged -= OnActorChanged;
            m.ActorRemoved -= OnActorRemoved;
            m.BuildingsChanged -= OnBuildingsChanged;
            m.LightsChanged -= OnLightsChanged;
            m.AmbienceChanged -= OnAmbienceChanged;
            client.OnFrame -= OnFrame;
            client.OnSpeech -= OnSpeech;
            subscribed = false;
        }

        /// <summary>Draw everything the mirror already holds (this view was enabled after frames arrived).</summary>
        public void FullSync()
        {
            var m = Mirror;
            if (m == null) return;
            ClearAll();
            foreach (var p in m.patches.Values) OnPatchAdded(p);
            foreach (var a in m.actors.Values) actors.Upsert(a, ActorChange.Added);
            buildingsDirty = true;
            lightsDirty = true;
            RefreshPlayer();
            OnAmbienceChanged();
        }

        void ClearAll()
        {
            grid.Clear();
            patches.Clear();
            Buildings.Clear();
            actors.Clear();
            lights.Clear();
            queue.Clear();
            queued.Clear();
            litBuildings.Clear();
            grassAll.Clear();
            if (grass != null) grass.Clear();
            insideKey = int.MinValue;
        }

        // ---------------------------------------------------------------- mirror events

        void OnPatchesCleared() => ClearAll();

        void OnPatchAdded(Patch p)
        {
            grid.Set(p);
            Enqueue(Mirror.PatchKey(p.x0, p.y0));
            // Corners and colours blend across patch edges: the neighbours that are already drawn redo themselves.
            for (int dy = -1; dy <= 1; dy++)
                for (int dx = -1; dx <= 1; dx++)
                {
                    if (dx == 0 && dy == 0) continue;
                    string k = Mirror.PatchKey(p.x0 + dx * Mirror.PATCH, p.y0 + dy * Mirror.PATCH);
                    if (patches.views.ContainsKey(k)) Enqueue(k);
                }
            buildingsDirty = true;
        }

        void Enqueue(string key)
        {
            if (queued.Add(key)) queue.Add(key);
        }

        void OnActorChanged(Actor a, ActorChange change)
        {
            actors.Upsert(a, change);
            if (change == ActorChange.Added) RefreshPlayer();
        }

        void OnActorRemoved(string id)
        {
            actors.Remove(id);
            RefreshPlayer();
        }

        void OnBuildingsChanged()
        {
            buildingsDirty = true;
            foreach (var v in patches.views.Values) if (v.orphanDoors) Enqueue(v.key);
        }

        void OnLightsChanged()
        {
            lightsDirty = true;
            lights.dirty = true;
        }

        void OnFrame(Frame f, FrameChange change)
        {
            RefreshPlayer();
            Speaking.FromFrame(f);
        }

        void OnSpeech(SpeechMsg s) => Speaking.FromSpeech(s);

        void OnAmbienceChanged()
        {
            var m = Mirror;
            if (m == null) return;
            if (dayNight == null) dayNight = FindFirstObjectByType<DayNight>();
            if (dayNight == null) return;
            var a = m.ambience;
            dayNight.ApplyAmbience((float)a.light, a.timeOfDay, a.weather, a.season, a.snow ?? false);
        }

        // ---------------------------------------------------------------- the player

        void RefreshPlayer()
        {
            var m = Mirror;
            if (m == null) return;
            string id = null;
            if (m.player != null && !string.IsNullOrEmpty(m.player.id) && m.actors.ContainsKey(m.player.id)) id = m.player.id;
            if (id == null)
                foreach (var a in m.actors.Values) if (a.kind == ActorKind.Player) { id = a.id; break; }
            if (id == null) id = m.player != null && !string.IsNullOrEmpty(m.player.id) ? m.player.id : "player";
            if (id == playerId) return;
            string old = playerId;
            playerId = id;
            // The player's body is drawn differently (cloak and pack).
            foreach (var key in new[] { old, id })
                if (m.actors.TryGetValue(key, out var actor) && actors.avatars.ContainsKey(key)) actors.Upsert(actor, ActorChange.Updated);
            PlayerChanged?.Invoke(id);
        }

        // ---------------------------------------------------------------- per frame

        void Update()
        {
            if (client == null) return;
            ProcessPatches();
            if (buildingsDirty)
            {
                buildingsDirty = false;
                Buildings.Sync(client.Mirror.buildings);
                Buildings.AttachProps(patches.views.Values);
                if (Buildings.dirty) buildingsDirty = true;   // some wait for their land
                lightsDirty = true;
                insideKey = int.MinValue;
            }
            if (lightsDirty) { lightsDirty = false; ApplyLit(); }
            actors.Tick(Time.deltaTime);
            // Foliage between the camera and the player dissolves (ToonLit _SWAY reads it); off while the player is unknown.
            if (actors.TryGet(playerId, out var pt)) Shader.SetGlobalVector(FocusId, new Vector4(pt.position.x, pt.position.y + 1.1f, pt.position.z, 1f));
            else Shader.SetGlobalVector(FocusId, Vector4.zero);
            UpdateInside();
            lights.Tick(Time.deltaTime);
            UpdateGrass();
        }

        void ProcessPatches()
        {
            if (queue.Count == 0) return;
            var sw = System.Diagnostics.Stopwatch.StartNew();
            Vector3 focus = FocusPoint;
            int built = 0;
            while (queue.Count > 0)
            {
                // The nearest first.
                int best = 0;
                float bd = float.MaxValue;
                for (int i = 0; i < queue.Count; i++)
                {
                    if (!client.Mirror.patches.TryGetValue(queue[i], out var q)) { bd = -1f; best = i; break; }
                    float dx = (q.x0 + q.w * 0.5f) * TileSize - focus.x, dz = (q.y0 + q.h * 0.5f) * TileSize - focus.z;
                    float d = dx * dx + dz * dz;
                    if (d < bd) { bd = d; best = i; }
                }
                string key = queue[best];
                queue.RemoveAt(best);
                queued.Remove(key);
                if (client.Mirror.patches.TryGetValue(key, out var p))
                {
                    patches.Build(p);
                    built++;
                    grassDirty = true;
                    nextGrass = Time.unscaledTime + 0.4f;
                    buildingsDirty = true;
                }
                if (sw.Elapsed.TotalMilliseconds > patchBudgetMs && built > 0) break;
            }
        }

        void UpdateGrass()
        {
            if (!grassDirty || grass == null || queue.Count > 0 || Time.unscaledTime < nextGrass) return;
            grassDirty = false;
            grassAll.Clear();
            foreach (var v in patches.views.Values) grassAll.AddRange(v.grass);
            if (grid.LoadedRect(out Vector4 lr)) grass.SetLoadedRect(lr);
            grass.SetSpots(grassAll);
        }

        void ApplyLit()
        {
            litBuildings.Clear();
            foreach (var l in client.Mirror.lights)
            {
                if (!l.on || l.kind != "window" || l.id == null || !l.id.StartsWith("win:")) continue;
                int a = l.id.IndexOf(':', 4);
                if (a > 4 && int.TryParse(l.id.Substring(4, a - 4), out int bid)) litBuildings.Add(bid);
            }
            foreach (var v in Buildings.views.Values) v.SetLit(v.data.lit || litBuildings.Contains(v.data.id));
        }

        void UpdateInside()
        {
            var m = client.Mirror;
            double tx = m.player.x, ty = m.player.y;
            Actor me = null;
            m.actors.TryGetValue(playerId, out me);
            if (actors.avatars.TryGetValue(playerId, out var av)) { tx = av.Tile.x; ty = av.Tile.y; }
            else if (me != null) { tx = me.x; ty = me.y; }
            var bv = Buildings.AtTile(tx + 0.5, ty + 0.5);
            bool inBuilding = bv != null && bv.floorCount > 0;
            bool flagged = me != null && me.HasFlag(ActorFlag.Inside);
            PlayerInside = inBuilding || flagged;
            int key = inBuilding ? bv.data.id * 8 + Mathf.Min(PlayerFloor, 7) : int.MinValue + 1;
            if (key == insideKey) return;
            insideKey = key;
            foreach (var v in Buildings.views.Values)
                v.SetInside(inBuilding && v == bv, PlayerFloor);
        }

        void OnDestroy()
        {
            Unsubscribe();
        }
    }
}
