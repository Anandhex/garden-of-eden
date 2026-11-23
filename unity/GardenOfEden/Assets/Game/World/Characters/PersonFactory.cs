// Builds people progressively and caches them. ActorViews asks for a person (Request), a few milliseconds per frame are spent on
// the queue (Tick; nearest and the player first), and when a ticket is ready the avatar makes an instance (Create): the 55-bone rig
// with the baked mesh. Built people are cached by their spec (id, species, sex, age, class, culture, tint, trim), so a person who walks
// out of the view box and back, or is rebuilt after a look change elsewhere, costs nothing the second time.
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using UnityEngine;

namespace GardenOfEden.World
{
    public sealed class PersonTicket
    {
        public PersonSpec spec;
        public BuiltPerson built;
        public bool failed, cancelled;
        public float priority;           // lower builds first (distance to the camera; the player is -1)
        public bool Ready => built != null;
        public bool Done => built != null || failed;
    }

    public static class PersonFactory
    {
        public const int CacheMax = 300;

        static CharacterKit kit;
        static PersonCatalog catalog;
        static PartLibrary library;
        static bool tried, ok;
        static readonly Dictionary<string, BuiltPerson> cache = new Dictionary<string, BuiltPerson>();
        static readonly List<Job> queue = new List<Job>();
        static Job current;
        static int clock;

        sealed class Job { public PersonTicket ticket; public IEnumerator it; public string key; }

        /// <summary>Counters for the tests and the report.</summary>
        public static int Built, CacheHits, Failed;
        public static double BuildMsTotal;
        public static int Pending => queue.Count + (current != null ? 1 : 0);
        public static int CachedCount => cache.Count;

        public static bool Available
        {
            get
            {
                if (!tried)
                {
                    tried = true;
                    try
                    {
                        kit = CharacterKit.Instance;
                        if (kit != null && kit.Ready)
                        {
                            catalog = PersonCatalog.Get(kit);
                            library = new PartLibrary(kit);
                            ok = catalog != null;
                        }
                        else if (kit != null) UnityEngine.Debug.LogWarning("PersonFactory: CharacterKit is incomplete; run Garden of Eden > Build Character System.");
                    }
                    catch (System.Exception e) { UnityEngine.Debug.LogError("PersonFactory: " + e); ok = false; }
                }
                return ok;
            }
        }

        public static CharacterKit Kit => kit;
        public static PersonCatalog Catalog => catalog;

        /// <summary>Forget everything (tests).</summary>
        public static void Reset()
        {
            foreach (var b in cache.Values) b.Destroy();
            cache.Clear(); queue.Clear(); current = null; Built = CacheHits = Failed = 0; BuildMsTotal = 0;
        }

        public static PersonTicket Request(PersonSpec spec)
        {
            var t = new PersonTicket { spec = spec };
            if (!Available) { t.failed = true; return t; }
            string key = spec.Key();
            if (cache.TryGetValue(key, out var b)) { t.built = b; b.refs++; b.lastUse = ++clock; CacheHits++; return t; }
            // already being built for another ticket? (two avatars of one person do not happen, but a rebuild can race)
            queue.Add(new Job { ticket = t, key = key });
            return t;
        }

        /// <summary>The avatar is done with the ticket (rebuilt or removed).</summary>
        public static void Release(PersonTicket t)
        {
            if (t == null) return;
            t.cancelled = true;
            if (t.built != null) { t.built.refs = Mathf.Max(0, t.built.refs - 1); t.built.lastUse = ++clock; }
        }

        /// <summary>Spend up to budgetMs on queued builds.</summary>
        public static void Tick(float budgetMs)
        {
            if (!ok || (queue.Count == 0 && current == null)) return;
            var sw = Stopwatch.StartNew();
            while (sw.Elapsed.TotalMilliseconds < budgetMs)
            {
                if (current == null)
                {
                    if (!NextJob()) break;
                }
                var cur = current;
                bool more;
                try { more = cur.it.MoveNext(); }
                catch (System.Exception e) { UnityEngine.Debug.LogError("PersonFactory: building " + cur.ticket.spec.id + ": " + e); cur.ticket.failed = true; Failed++; current = null; continue; }
                if (!more) current = null;
            }
            BuildMsTotal += sw.Elapsed.TotalMilliseconds;
            Evict();
        }

        static bool NextJob()
        {
            while (queue.Count > 0)
            {
                int best = 0;
                for (int i = 1; i < queue.Count; i++) if (queue[i].ticket.priority < queue[best].ticket.priority) best = i;
                var job = queue[best];
                queue.RemoveAt(best);
                if (job.ticket.cancelled) continue;
                if (cache.TryGetValue(job.key, out var hit)) { job.ticket.built = hit; hit.refs++; CacheHits++; continue; }
                var recipe = PersonRecipe.Make(job.ticket.spec, catalog);
                var j = job;
                job.it = PersonBuilder.Build(recipe, catalog, library, kit, built =>
                {
                    if (built == null) { j.ticket.failed = true; Failed++; return; }
                    Built++;
                    built.lastUse = ++clock;
                    if (cache.TryGetValue(j.key, out var old)) { old.Destroy(); }
                    cache[j.key] = built;
                    if (!j.ticket.cancelled) { j.ticket.built = built; built.refs++; }
                });
                current = job;
                return true;
            }
            return false;
        }

        static void Evict()
        {
            if (cache.Count <= CacheMax) return;
            var drop = new List<KeyValuePair<string, BuiltPerson>>();
            foreach (var kv in cache) if (kv.Value.refs <= 0) drop.Add(kv);
            drop.Sort((a, b) => a.Value.lastUse.CompareTo(b.Value.lastUse));
            for (int i = 0; i < drop.Count && cache.Count > CacheMax - 20; i++) { drop[i].Value.Destroy(); cache.Remove(drop[i].Key); }
        }

        /// <summary>Make a person: the rig (Animator with the shared Humanoid controller) with the baked mesh, placed at the parent's origin.</summary>
        public static GameObject Create(BuiltPerson b, Transform parent, string name)
        {
            var rig = library.rig;
            var root = Object.Instantiate(kit.rigPrefab, parent);
            root.name = name;
            root.transform.localPosition = Vector3.zero; root.transform.localRotation = Quaternion.identity;
            root.transform.localScale = Vector3.one * b.rootScale;
            var ts = root.GetComponentsInChildren<Transform>(true);
            if (ts.Length != rig.names.Length) { UnityEngine.Debug.LogError("PersonFactory: rig mismatch " + ts.Length + " vs " + rig.names.Length); Object.Destroy(root); return null; }
            for (int i = 0; i < ts.Length; i++)
            {
                int p = rig.parent[i];
                if (p < 0) continue;
                var s = rig.restScale[p];
                var local = Quaternion.Inverse(rig.restRot[p]) * (b.bonePos[i] - b.bonePos[p]);
                ts[i].localPosition = new Vector3(local.x / s.x, local.y / s.y, local.z / s.z);
            }
            var go = new GameObject("body");
            go.transform.SetParent(root.transform, false);
            var smr = go.AddComponent<SkinnedMeshRenderer>();
            smr.sharedMesh = b.mesh;
            smr.bones = ts;
            smr.rootBone = ts[0];
            var mats = new Material[b.subKinds.Length];
            for (int i = 0; i < mats.Length; i++) mats[i] = b.subKinds[i] == 0 ? b.skinMat : b.subKinds[i] == 1 ? kit.clothMaterial : (b.hairMat != null ? b.hairMat : kit.clothMaterial);
            smr.sharedMaterials = mats;
            smr.localBounds = b.mesh.bounds;
            smr.updateWhenOffscreen = false;
            smr.quality = SkinQuality.Bone4;
            smr.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.On;
            smr.receiveShadows = true;
            smr.skinnedMotionVectors = false;
            var anim = root.GetComponent<Animator>();
            anim.runtimeAnimatorController = kit.peopleController;
            anim.avatar = kit.baseAvatar;
            anim.applyRootMotion = false;
            var face = root.AddComponent<PersonFace>();
            face.Init(b, smr, ts);
            return root;
        }

        /// <summary>The body record the puppet and the avatar use (height for the label and capsule, speeds for the blend tree).</summary>
        public static CharacterBody BodyFor(BuiltPerson b) => new CharacterBody
        {
            id = b.recipe != null ? b.recipe.species : "person", kind = BodyKind.Person, height = b.height, radius = Mathf.Clamp(0.3f * b.rootScale, 0.2f, 0.45f),
            walkSpeed = kit.walkSpeed, runSpeed = kit.runSpeed, bodyScale = Mathf.Max(0.4f, b.rootScale),
        };
    }
}
