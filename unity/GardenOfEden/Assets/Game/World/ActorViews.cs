// Actors in the world: one avatar per frame actor, moved smoothly along the server's routes (about stepMs per tile,
// never pathfinding), facing the way they walk, swinging limbs, with a name label that gets shorter with distance and
// a fade-out when the actor leaves. Positions are the server's tiles; heights are the drawn ground's.
// Bodies are real rigged characters (CharacterManifest / CharacterPuppet) driven by an Animator from the actor's smoothed
// ground speed; kinds the manifest does not cover fall back to the procedural models in ActorModels.
using System.Collections.Generic;
using UnityEngine;
using GardenOfEden.Net;

namespace GardenOfEden.World
{
    /// <summary>On every actor's root: lets picking code (raycasts) find which actor it hit.</summary>
    public sealed class ActorHandle : MonoBehaviour
    {
        public string id;
        public Actor data;
    }

    public sealed class ActorAvatar
    {
        public readonly string id;
        public Actor data;
        public GameObject root;
        public bool removing;

        readonly WorldView world;
        Transform visual;
        ActorModel model;
        GameObject prefabInstance;
        readonly List<Transform> limbTransforms = new List<Transform>();
        readonly List<GameObject> parts = new List<GameObject>();
        CharacterPuppet puppet;
        PersonTicket ticket;           // a person being built by PersonFactory (the Blender character system); puppet appears when it is ready
        bool legacyOnly;               // the new builder failed for this actor: use the placeholder bodies
        TextMesh label;
        /// <summary>What this actor's label would say this frame (UpdateLabel), for ActorViews to choose among.</summary>
        public string wantText;
        public float wantDist;
        public Vector3 wantPos;
        public bool wantTarget;
        string lookKey, shownText;
        bool labelOn, shown = true;

        Vector2 cur;                      // tile coordinates (the server's x, y; a tile's middle is +0.5)
        readonly List<Vector2> path = new List<Vector2>();
        float yaw, targetYaw, phase, walkAmt, walkTimer, lie, appear, removeT;
        float yawVel, leanRoll, leanPitch, lastSpeed;
        Vector2 nudge;
        float seed;
        float size = 1f;

        public Vector2 Tile => cur;

        public ActorAvatar(WorldView world, Actor a)
        {
            this.world = world;
            id = a.id;
            data = a;
            seed = (Hash.Str(a.id) % 1000) / 1000f * 6.28f;
            root = new GameObject("actor " + a.id);
            root.transform.SetParent(world.ActorRoot, false);
            var h = root.AddComponent<ActorHandle>();
            h.id = a.id;
            h.data = a;
            cur = new Vector2((float)a.x, (float)a.y);
            yaw = targetYaw = FacingYaw(a.facing, 0f);
            Rebuild(a);
            var p = WorldView.TileToWorld(cur.x, cur.y, 0f);
            root.transform.position = new Vector3(p.x, world.GroundHeightAt(p.x, p.z), p.z);
        }

        static string LookKey(Actor a, bool player) => (a.look?.sprite ?? "") + "|" + a.look?.tint + "|" + a.look?.trim + "|" + a.look?.size + "|" + a.kind + "|"
            + a.look?.species + a.look?.sex + a.look?.age + a.look?.cls + a.look?.job + a.look?.culture + "|"
            + a.HasFlag(ActorFlag.Noble) + a.HasFlag(ActorFlag.Hostile) + a.HasFlag(ActorFlag.Lowborn) + "|" + player;

        public static float FacingYaw(string f, float fallback)
        {
            switch (f)
            {
                case "n": return 180f;
                case "e": return 90f;
                case "s": return 0f;
                case "w": return 270f;
                default: return fallback;
            }
        }

        void Rebuild(Actor a)
        {
            bool player = id == world.PlayerActorId;
            lookKey = LookKey(a, player);
            if (visual != null) Object.Destroy(visual.gameObject);
            if (model != null && model.ownsBody && model.body != null) Object.Destroy(model.body);
            limbTransforms.Clear();
            parts.Clear();
            puppet = null;
            if (ticket != null) { PersonFactory.Release(ticket); ticket = null; }
            size = a.look != null && a.look.size.HasValue ? Mathf.Clamp((float)a.look.size.Value, 0.2f, 4f) : 1f;

            visual = new GameObject("visual").transform;
            visual.SetParent(root.transform, false);

            string sprite = a.look?.sprite;
            if (world.manifest != null && world.manifest.TryGet(sprite, out var entry))
            {
                prefabInstance = Object.Instantiate(entry.prefab, visual);
                prefabInstance.transform.localPosition = entry.offset;
                prefabInstance.transform.localScale = Vector3.one * entry.scale;
                model = new ActorModel { height = 1.8f, ownsBody = false };
            }
            else if (TryBuildBlender(a, player, out var cmade))
            {
                puppet = cmade;     // a creature (immediately), or null while a person is being built (ticket)
                model = ticket != null
                    ? new ActorModel { height = 1.75f, radius = 0.3f, upright = true, ownsBody = false }
                    : new ActorModel { height = cmade.body.height, radius = cmade.body.radius, upright = cmade.body.kind == BodyKind.Person, ownsBody = false };
            }
            else if (TryBuildPuppet(a, player, out var made))
            {
                puppet = made;
                var cb = made.body;
                model = new ActorModel { height = cb.height, radius = cb.radius, upright = cb.kind == BodyKind.Person, ownsBody = false };
            }
            else
            {
                model = ActorModels.For(a, player);
                var mat = Mats.Toon();
                var body = new GameObject("body");
                body.transform.SetParent(visual, false);
                body.AddComponent<MeshFilter>().sharedMesh = model.body;
                body.AddComponent<MeshRenderer>().sharedMaterial = mat;
                parts.Add(body);
                foreach (var limb in model.limbs)
                {
                    var go = new GameObject("limb");
                    go.transform.SetParent(visual, false);
                    go.transform.localPosition = limb.pivot;
                    go.AddComponent<MeshFilter>().sharedMesh = limb.mesh;
                    go.AddComponent<MeshRenderer>().sharedMaterial = mat;
                    limbTransforms.Add(go.transform);
                }
            }
            UpdateCollider();

            if (label == null)
            {
                var go = new GameObject("label");
                go.transform.SetParent(root.transform, false);
                label = go.AddComponent<TextMesh>();
                label.font = ActorViews.LabelFont;
                label.fontSize = 64;
                label.characterSize = 0.026f;
                label.anchor = TextAnchor.LowerCenter;
                label.alignment = TextAlignment.Center;
                var mr = go.GetComponent<MeshRenderer>();
                if (ActorViews.LabelFont != null) mr.sharedMaterial = ActorViews.LabelFont.material;
                mr.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
                mr.receiveShadows = false;
                go.SetActive(false);
            }
        }

        void UpdateCollider()
        {
            float s = size * model.scale;
            visual.localScale = Vector3.one * s;
            var col = root.GetComponent<CapsuleCollider>();
            if (col == null) col = root.AddComponent<CapsuleCollider>();
            float hgt = Mathf.Max(0.5f, model.height * s);
            col.height = hgt;
            col.radius = Mathf.Min(0.4f, model.radius * s);
            col.center = new Vector3(0, hgt * 0.5f, 0);
        }

        /// <summary>
        /// The Blender character system: creatures get their prefab at once; a person is requested from PersonFactory (built over a
        /// few frames, cached) and the puppet is made when the ticket is ready (PollTicket). False: use the placeholder bodies.
        /// </summary>
        bool TryBuildBlender(Actor a, bool player, out CharacterPuppet made)
        {
            made = null;
            if (legacyOnly) return false;
            var kit = CharacterKit.Instance;
            if (kit == null || !kit.Ready) return false;
            string sprite = a.look?.sprite;
            if (ArtIds.IsFx(sprite)) return false;
            string species = a.look?.species;
            uint seed = Hash.Str(a.id);
            bool person = sprite == "people/body" || sprite == "people/player" || (sprite != null && sprite.StartsWith("people/"));
            string cid = null;
            if (!person)
            {
                if (!string.IsNullOrEmpty(species) && kit.TryCreature(species, out _)) cid = species;
                else if (sprite != null && sprite.StartsWith("creature/")) cid = sprite.Substring("creature/".Length);
            }
            else if (!string.IsNullOrEmpty(species) && kit.TryCreature(species, out _) && CharacterImportMonsterIds.Contains(species)) { cid = species; person = false; }
            if (cid != null && kit.TryCreature(cid, out var cbody))
            {
                made = new CharacterPuppet(cbody, visual, seed);
                made.ApplyLook(a, seed);
                return true;
            }
            if (!person) return false;
            if (!PersonFactory.Available) return false;
            size = 1f;      // people are drawn at their true height (species, sex, age): the server's look.size was for sprites
            ticket = PersonFactory.Request(PersonSpec.From(a, player));
            return true;
        }

        static readonly HashSet<string> CharacterImportMonsterIds = new HashSet<string> { "goblin", "hobgoblin", "kobold", "gnoll", "lizardfolk", "minotaur", "ogre", "troll", "giant", "harpy" };

        /// <summary>A built person: make the rig instance and the puppet. A failed build falls back to the placeholder bodies.</summary>
        void PollTicket(Vector3 camPos, bool haveCam)
        {
            if (ticket == null || puppet != null) return;
            ticket.priority = id == world.PlayerActorId ? -1f : (haveCam ? Vector3.Distance(camPos, root.transform.position) : 50f);
            if (!ticket.Done) return;
            var t = ticket;
            if (t.failed || t.built == null) { ticket = null; legacyOnly = true; Rebuild(data); return; }
            var inst = PersonFactory.Create(t.built, visual, "person");
            if (inst == null) { PersonFactory.Release(t); ticket = null; legacyOnly = true; Rebuild(data); return; }
            var body = PersonFactory.BodyFor(t.built);
            puppet = new CharacterPuppet(body, inst, Hash.Str(id)) { baked = true };
            model.height = body.height; model.radius = body.radius;
            UpdateCollider();
            appear = 0f;      // grow in
        }

        bool TryBuildPuppet(Actor a, bool player, out CharacterPuppet made)
        {
            made = null;
            var cm = CharacterManifest.Instance;
            if (cm == null) return false;
            var body = cm.Pick(a, player);
            if (body == null) return false;
            uint seed = Hash.Str(a.id);
            made = new CharacterPuppet(body, visual, seed);
            made.ApplyLook(a, seed);
            return true;
        }

        /// <summary>A new state from the server: rebuild the look if it changed, and walk to the new place.</summary>
        public void Apply(Actor a, bool snap)
        {
            data = a;
            var h = root.GetComponent<ActorHandle>();
            if (h != null) h.data = a;
            if (LookKey(a, id == world.PlayerActorId) != lookKey) Rebuild(a);

            Vector2 end = new Vector2((float)a.x, (float)a.y);
            float far = Vector2.Distance(cur, end);
            if (snap || far > 8f)
            {
                cur = end;
                path.Clear();
                return;
            }
            path.Clear();
            if (a.route != null && a.route.Count > 0)
            {
                // Start from the route point nearest where we are, so repeated routes don't pull us backwards.
                int start = 0;
                float best = float.MaxValue;
                for (int i = 0; i < a.route.Count; i++)
                {
                    float d = Vector2.Distance(cur, new Vector2((float)a.route[i].x, (float)a.route[i].y));
                    if (d < best) { best = d; start = i; }
                }
                if (best < 0.6f) start++;
                else start = 0;
                for (int i = start; i < a.route.Count; i++) path.Add(new Vector2((float)a.route[i].x, (float)a.route[i].y));
            }
            if (path.Count == 0 || Vector2.Distance(path[path.Count - 1], end) > 0.01f) path.Add(end);
            // Drop leading points we are already standing on.
            while (path.Count > 1 && Vector2.Distance(cur, path[0]) < 0.02f) path.RemoveAt(0);
        }

        public void BeginRemove()
        {
            if (removing) return;
            removing = true;
            removeT = 0f;
            path.Clear();
        }

        float PathLength()
        {
            float len = 0f;
            Vector2 p = cur;
            foreach (var q in path) { len += Vector2.Distance(p, q); p = q; }
            return len;
        }

        /// <summary>Returns true when the avatar is finished (faded out) and should be destroyed.</summary>
        public bool Tick(float dt, Vector3 camPos, Quaternion camRot, bool haveCam, float labelNear, float labelFar, string promptTarget, string promptTone = null)
        {
            var a = data;
            if (removing)
            {
                removeT += dt;
                float k = Mathf.Clamp01(removeT / 0.5f);
                visual.localScale = Vector3.one * (size * model.scale) * (1f - k * k);
                if (label != null && labelOn) { labelOn = false; label.gameObject.SetActive(false); }   // a leaving actor shows no name (its replacement may carry the same one)
                return k >= 1f;
            }

            if (ticket != null) PollTicket(camPos, haveCam);

            // --- movement along the route
            // Constant walking pace per kind (tiles per second). The server's stepMs is only how often it accepts a step
            // (100 ms = 10 tiles/s, a blur), so the pace is capped by it but is normally the slower walking one.
            float speed = world.WalkTilesPerSecond(id == world.PlayerActorId, a.kind);
            // Only when well behind the server's tile (several queued tiles) hurry up a little so we never lag for long.
            float mult = 1f + Mathf.Clamp(PathLength() - 3f, 0f, 8f) * 0.25f;
            float step = speed * mult * dt, moved = 0f;
            Vector2 dir = Vector2.zero;
            while (step > 0f && path.Count > 0)
            {
                Vector2 to = path[0], d = to - cur;
                float len = d.magnitude;
                if (len <= step) { cur = to; path.RemoveAt(0); step -= len; moved += len; if (len > 1e-4f) dir = d / len; }
                else { cur += d / len * step; moved += step; dir = d / len; step = 0f; }
            }
            float groundSpeed = 0f;     // metres per second actually travelled this frame (held briefly across gaps between routes)
            if (moved > 1e-4f)
            {
                walkTimer = 0.2f;
                targetYaw = Mathf.Atan2(dir.x, dir.y) * Mathf.Rad2Deg;
                phase += moved * WorldView.TileSize / 0.55f * Mathf.PI;
                lastSpeed = moved * WorldView.TileSize / dt;
                groundSpeed = lastSpeed;
            }
            else
            {
                walkTimer -= dt;
                if (walkTimer <= 0f && a.facing != null) targetYaw = FacingYaw(a.facing, targetYaw);
                if (walkTimer > 0f) groundSpeed = lastSpeed;
                else lastSpeed = 0f;
            }
            // Turn with a short ease (never snap), and lean a little into the turn and the pace.
            yaw = Mathf.SmoothDampAngle(yaw, targetYaw, ref yawVel, 0.09f, 720f, dt);
            walkAmt = Mathf.MoveTowards(walkAmt, walkTimer > 0f ? 1f : 0f, dt * 8f);
            float leanK = 1f - Mathf.Exp(-7f * dt);
            leanRoll = Mathf.Lerp(leanRoll, Mathf.Clamp(-yawVel * 0.035f, -8f, 8f) * Mathf.Clamp01(groundSpeed), leanK);
            leanPitch = Mathf.Lerp(leanPitch, puppet != null && !puppet.IsAnimal ? Mathf.Clamp(groundSpeed * 0.9f, 0f, 4.5f) : 0f, leanK);

            // --- place
            Vector3 p = WorldView.TileToWorld(cur.x, cur.y, 0f);
            Vector2 want = Vector2.zero;
            if (!a.HasFlag(ActorFlag.Inside)) want = world.Buildings.NudgeOut(p.x, p.z);
            nudge = Vector2.Lerp(nudge, want, 1f - Mathf.Exp(-12f * dt));
            p.x += nudge.x;
            p.z += nudge.y;
            p.y = world.GroundHeightAt(p.x, p.z);
            root.transform.position = p;

            // --- appear, lie down, animate
            appear = Mathf.MoveTowards(appear, 1f, dt * 3.5f);
            bool down = a.HasFlag(ActorFlag.Dead) || a.HasFlag(ActorFlag.Unconscious);
            lie = Mathf.MoveTowards(lie, down ? 1f : 0f, dt * 3f);
            float s = size * model.scale * Mathf.Lerp(0.6f, 1f, appear * appear);
            visual.localScale = Vector3.one * s;
            if (puppet != null)
            {
                // The Animator lies the body down (Death / Lie clips); only the heading and the lean are ours.
                visual.localRotation = Quaternion.Euler(0, yaw, 0) * Quaternion.Euler(leanPitch * (1f - lie), 0, leanRoll * (1f - lie));
                visual.localPosition = Vector3.zero;
                if (shown) puppet.Tick(dt, groundSpeed, a, promptTarget == id, promptTone);
            }
            else
            {
            visual.localRotation = Quaternion.Euler(0, yaw, 0) * Quaternion.Euler(0, 0, 90f * lie);
            float bob = model.upright ? Mathf.Abs(Mathf.Sin(phase)) * 0.035f * walkAmt * (1f - lie) : Mathf.Sin(phase * 2f) * 0.012f * walkAmt;
            float breathe = Mathf.Sin(Time.time * 2f + seed) * 0.006f * (1f - walkAmt) * (1f - lie);
            visual.localPosition = new Vector3(0, bob + breathe + lie * 0.2f * size * (model.upright ? 1f : model.scale), 0);
            float swing = walkAmt * (1f - lie);
            for (int i = 0; i < limbTransforms.Count && i < model.limbs.Count; i++)
            {
                var limb = model.limbs[i];
                float ang = Mathf.Sin(phase + limb.phase) * limb.amp * swing;
                limbTransforms[i].localRotation = model.spider ? Quaternion.Euler(0, ang, 0) : Quaternion.Euler(ang, 0, 0);
            }
            }

            // --- visibility: someone indoors is hidden unless the player is indoors too
            bool show = !a.HasFlag(ActorFlag.Inside) || world.PlayerInside;
            if (show != shown) { shown = show; visual.gameObject.SetActive(show); }

            UpdateLabel(a, p, camPos, camRot, haveCam, labelNear, labelFar, show, promptTarget);
            return false;
        }

        // Labels are chosen by ActorViews (a few nearest, never overlapping, never twice for one actor): this only says
        // what the label would be.
        void UpdateLabel(Actor a, Vector3 p, Vector3 camPos, Quaternion camRot, bool haveCam, float near, float far, bool show, string promptTarget)
        {
            string text = null;
            wantText = null;
            if (show && haveCam && !IsPlayerAvatar)
            {
                float dist = Vector3.Distance(camPos, p);
                bool isTarget = promptTarget == id;
                if (dist < near || isTarget) text = !string.IsNullOrEmpty(a.label) ? a.label : a.shortLabel;
                else if (dist < far) text = a.shortLabel;
                if (ArtIds.IsFx(a.look?.sprite)) text = null;
                if (text != null)
                {
                    wantText = text; wantDist = dist; wantTarget = isTarget;
                    wantPos = p + Vector3.up * (model.height * size * model.scale + 0.25f);
                }
            }
            if (wantText == null) ApplyLabel(false, 0f, camRot, 0f);
        }

        bool IsPlayerAvatar => world.PlayerActorId == id;

        /// <summary>Show (or hide) this actor's label at its chosen strength.</summary>
        public void ApplyLabel(bool on, float alpha, Quaternion camRot, float dist)
        {
            on = on && alpha > 0.02f && wantText != null;
            if (on != labelOn) { labelOn = on; label.gameObject.SetActive(on); }
            if (!on) return;
            label.transform.rotation = camRot;
            label.transform.position = wantPos;
            label.transform.localScale = Vector3.one * Mathf.Clamp(dist / 10f, 0.45f, 2.4f);   // about the same size on screen at any distance
            if (wantText != shownText) { shownText = wantText; label.text = wantText; }
            // Soft cream (a warm tint for quest, a muted red for hostile), fading with distance.
            var a = data;
            Color c = a.HasFlag(ActorFlag.Hostile) ? new Color(1f, 0.70f, 0.64f) : a.HasFlag(ActorFlag.Quest) ? new Color(1f, 0.90f, 0.58f) : new Color(0.97f, 0.94f, 0.88f);
            c.a = alpha * 0.9f;
            label.color = c;
        }

        public void Destroy()
        {
            if (ticket != null) { PersonFactory.Release(ticket); ticket = null; }
            if (model != null && model.ownsBody && model.body != null) Object.Destroy(model.body);
            if (root != null) Object.Destroy(root);
        }
    }

    public sealed class ActorViews
    {
        public readonly Dictionary<string, ActorAvatar> avatars = new Dictionary<string, ActorAvatar>();
        readonly List<ActorAvatar> fading = new List<ActorAvatar>();
        readonly List<string> scratch = new List<string>();
        readonly WorldView world;
        GameObject ring;
        Material ringMat;
        static Font font;

        public static Font LabelFont
        {
            get
            {
                if (font == null)
                {
                    font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
                    if (font == null) font = Font.CreateDynamicFontFromOSFont("Arial", 32);
                }
                return font;
            }
        }

        /// <summary>Milliseconds per frame spent building people (PersonFactory); the nearest and the player are built first.</summary>
        public static float BuildBudgetMs = 4f;

        public ActorViews(WorldView world) { this.world = world; }

        public void Upsert(Actor a, ActorChange change)
        {
            if (!avatars.TryGetValue(a.id, out var av))
            {
                av = new ActorAvatar(world, a);
                avatars[a.id] = av;
                return;
            }
            av.Apply(a, false);
        }

        public void Remove(string id)
        {
            if (!avatars.TryGetValue(id, out var av)) return;
            avatars.Remove(id);
            av.BeginRemove();
            fading.Add(av);
        }

        public void Clear()
        {
            foreach (var av in avatars.Values) av.Destroy();
            avatars.Clear();
            foreach (var av in fading) av.Destroy();
            fading.Clear();
        }

        public bool TryGet(string id, out Transform t)
        {
            t = null;
            if (!avatars.TryGetValue(id, out var av) || av.root == null) return false;
            t = av.root.transform;
            return true;
        }

        public void Tick(float dt)
        {
            var cam = Camera.main;
            bool haveCam = cam != null;
            Vector3 cp = haveCam ? cam.transform.position : Vector3.zero;
            Quaternion cr = haveCam ? cam.transform.rotation : Quaternion.identity;
            string target = world.Mirror.prompt?.target;
            string tone = world.Mirror.prompt?.tone;
            foreach (var av in avatars.Values) av.Tick(dt, cp, cr, haveCam, world.labelNearDistance, world.labelFarDistance, target, tone);
            PersonFactory.Tick(BuildBudgetMs);
            ChooseLabels(cam, cp, cr);
            for (int i = fading.Count - 1; i >= 0; i--)
            {
                if (fading[i].Tick(dt, cp, cr, haveCam, 0, 0, null)) { fading[i].Destroy(); fading.RemoveAt(i); }
            }
            UpdateRing(target);
        }

        readonly List<ActorAvatar> want = new List<ActorAvatar>();
        readonly List<Vector2> placed = new List<Vector2>();
        readonly HashSet<string> labelled = new HashSet<string>();

        /// <summary>
        /// Name labels: only the nearest few (the interaction target first), faded by distance, each actor at most once,
        /// none that would sit on another label, none behind a building, and never the player's own.
        /// </summary>
        void ChooseLabels(Camera cam, Vector3 cp, Quaternion cr)
        {
            want.Clear(); placed.Clear(); labelled.Clear();
            foreach (var av in avatars.Values) if (av.wantText != null) want.Add(av);
            want.Sort((x, y) => (x.wantTarget ? -1000f : x.wantDist).CompareTo(y.wantTarget ? -1000f : y.wantDist));
            int shown = 0;
            const int maxLabels = 5;
            float maxDist = Mathf.Min(world.labelFarDistance, 28f);
            int mask = WorldLayers.BuildingMask;
            foreach (var av in want)
            {
                bool ok = shown < maxLabels && cam != null && (av.wantTarget || av.wantDist < maxDist) && labelled.Add(av.id);
                float alpha = av.wantTarget ? 1f : 1f - Mathf.SmoothStep(0f, 1f, Mathf.InverseLerp(maxDist * 0.45f, maxDist, av.wantDist));
                if (ok)
                {
                    Vector3 sp = cam.WorldToScreenPoint(av.wantPos);
                    if (sp.z <= 0f) ok = false;
                    else
                    {
                        var s2 = new Vector2(sp.x, sp.y);
                        float minX = Screen.height * 0.12f, minY = Screen.height * 0.035f;
                        foreach (var q in placed) if (Mathf.Abs(q.x - s2.x) < minX && Mathf.Abs(q.y - s2.y) < minY) { ok = false; break; }
                        if (ok && mask != 0 && Physics.Linecast(cp, av.wantPos, mask)) ok = false;
                        if (ok) placed.Add(s2);
                    }
                }
                if (ok) shown++;
                av.ApplyLabel(ok, alpha, cr, av.wantDist);
            }
        }

        void UpdateRing(string target)
        {
            if (string.IsNullOrEmpty(target) || !avatars.TryGetValue(target, out var av) || av.root == null)
            {
                if (ring != null) ring.SetActive(false);
                return;
            }
            if (ring == null)
            {
                var mb = new MeshBuilder();
                mb.Ring(Vector3.zero, 0.42f, 0.52f, 20, Color.white);
                var mesh = mb.ToMesh("target ring");
                ring = new GameObject("prompt ring");
                ring.transform.SetParent(world.ActorRoot, false);
                ring.AddComponent<MeshFilter>().sharedMesh = mesh;
                ringMat = new Material(Mats.Glow());
                var mr = ring.AddComponent<MeshRenderer>();
                mr.sharedMaterial = ringMat;
                mr.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            }
            string tone = world.Mirror.prompt?.tone;
            Color c = tone == "fight" ? new Color(1f, 0.4f, 0.35f) : tone == "danger" ? new Color(1f, 0.65f, 0.25f) : new Color(1f, 0.88f, 0.5f);
            if (ringMat.HasProperty("_BaseColor")) ringMat.SetColor("_BaseColor", c);
            if (ringMat.HasProperty("_Color")) ringMat.SetColor("_Color", c);
            ring.SetActive(true);
            Vector3 p = av.root.transform.position;
            ring.transform.position = new Vector3(p.x, p.y + 0.06f, p.z);
        }
    }
}
