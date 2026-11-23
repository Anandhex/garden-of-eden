// Which real (rigged, animated) body a server actor gets. The asset lives at Resources/CharacterManifest and is written by
// the editor menu "Garden of Eden > Build Characters" (CharacterSetup). The choice is a pure function of the actor id and
// look, so the same person always gets the same body, and different townsfolk differ.
//
// Server look -> body:
//   look.sprite  creature/wolf -> wolf, creature/horse -> horse (1 in 5 a donkey), creature/beast -> bull,
//                creature/deer|stag|donkey|bull -> that animal; bear, boar, spider (and anything unknown) -> null (the
//                procedural model in ActorModels is used, it has its own limb swing).
//   people/player -> the rogue;  flag hostile -> raiders;  flag noble -> suit / robed / caped bodies;
//   label with guard/watch/soldier... -> guard;  everyone else -> a pool picked by a stable hash of the actor id.
using System;
using System.Collections.Generic;
using UnityEngine;
using GardenOfEden.Net;

namespace GardenOfEden.World
{
    public enum BodyKind { Person, Animal }

    [Serializable]
    public sealed class CharacterBody
    {
        public string id;
        public BodyKind kind;
        /// <summary>Root at the feet, facing +Z, already scaled (an adult person is 1.75 m), with an Animator and the shared controller.</summary>
        public GameObject prefab;
        /// <summary>Measured ground speed (m/s) at which the walk and the run / gallop clips look right (the blend tree thresholds).</summary>
        public float walkSpeed = 1.4f, runSpeed = 4f;
        public bool armed;
        /// <summary>Standing height and body radius in metres (at scale 1), for the picking capsule and the name label.</summary>
        public float height = 1.75f, radius = 0.3f;
        /// <summary>Body size against a 1.75 m human (the Animator speed parameter is the ground speed divided by this, so strides match the scale).</summary>
        public float bodyScale = 1f;
        /// <summary>Material slot names (the part after the last '.' in the material name) that carry each role.</summary>
        public string[] clothes = new string[0], pants = new string[0], trim = new string[0], hair = new string[0], skin = new string[0];
        /// <summary>Atlas-textured bodies have no clothes slot: these renderers (name contains) are tinted softly instead.</summary>
        public string[] tintRenderers = new string[0];
    }

    [CreateAssetMenu(menuName = "Garden of Eden/Character Manifest", fileName = "CharacterManifest")]
    public sealed class CharacterManifest : ScriptableObject
    {
        public const string ResourceName = "CharacterManifest";
        public List<CharacterBody> bodies = new List<CharacterBody>();

        static CharacterManifest instance;
        static bool loaded;
        readonly Dictionary<string, CharacterBody> byId = new Dictionary<string, CharacterBody>();

        public static CharacterManifest Instance
        {
            get
            {
                if (!loaded || instance == null)
                {
                    loaded = true;
                    instance = Resources.Load<CharacterManifest>(ResourceName);
                    if (instance != null) instance.Index();
                }
                return instance;
            }
        }

        void Index()
        {
            byId.Clear();
            foreach (var b in bodies) if (b != null && b.prefab != null && !string.IsNullOrEmpty(b.id)) byId[b.id] = b;
        }

        public bool TryGet(string id, out CharacterBody body)
        {
            if (byId.Count == 0 && bodies.Count > 0) Index();
            return byId.TryGetValue(id, out body);
        }

        // ------------------------------------------------------------------ choosing

        // Pools hold ids (repeats make a body more common). Ids missing from the manifest are skipped.
        static readonly string[] Everyone = { "man_casual", "woman_casual", "casual_character", "character_animated", "man_casual", "woman_casual", "casual_character", "rogue_hooded", "barbarian_worker", "mage_elder" };
        static readonly string[] Lowborn = { "man_casual", "woman_casual", "casual_character", "barbarian_worker", "character_animated", "rogue_hooded", "woman_casual", "man_casual" };
        static readonly string[] Nobles = { "man_suit", "mage_noble", "knight_noble", "man_suit" };
        static readonly string[] Hostiles = { "barbarian_raider", "rogue_hooded_bandit", "barbarian_raider", "character_animated" };
        static readonly string[] GuardWords = { "guard", "watch", "soldier", "knight", "captain", "sheriff", "militia", "sentry", "constable", "warden" };

        string PickFrom(string[] pool, uint h)
        {
            for (int i = 0; i < pool.Length; i++)
            {
                string id = pool[(int)((h + (uint)i) % (uint)pool.Length)];
                if (byId.ContainsKey(id)) return id;
            }
            return null;
        }

        static bool IsGuard(Actor a)
        {
            string t = ((a.label ?? "") + " " + (a.shortLabel ?? "")).ToLowerInvariant();
            foreach (var w in GuardWords) if (t.Contains(w)) return true;
            return false;
        }

        /// <summary>The body for this actor, or null when the procedural model should be used.</summary>
        public CharacterBody Pick(Actor a, bool isPlayer)
        {
            if (byId.Count == 0 && bodies.Count > 0) Index();
            if (byId.Count == 0 || a == null) return null;
            string sprite = a.look != null ? a.look.sprite : null;
            uint h = Hash.Str(a.id);
            string id = null;
            if (ArtIds.IsFx(sprite)) return null;
            if (ArtIds.IsCreature(sprite) || a.kind == ActorKind.Creature)
            {
                switch (sprite)
                {
                    case "creature/wolf": id = "wolf"; break;
                    case "creature/horse": id = h % 5 == 0 ? "donkey" : "horse"; break;
                    case "creature/beast": id = "bull"; break;
                    case "creature/deer": id = "deer"; break;
                    case "creature/stag": id = "stag"; break;
                    case "creature/donkey": id = "donkey"; break;
                    case "creature/bull": id = "bull"; break;
                    default: return null;
                }
            }
            else if (isPlayer || sprite == "people/player") id = "rogue";
            else if (a.HasFlag(ActorFlag.Hostile)) id = PickFrom(Hostiles, h >> 4);
            else if (a.HasFlag(ActorFlag.Noble)) id = PickFrom(Nobles, h >> 4);
            else if (IsGuard(a)) id = "knight_guard";
            else if (a.HasFlag(ActorFlag.Lowborn)) id = PickFrom(Lowborn, h >> 4);
            else id = PickFrom(Everyone, h >> 4);
            if (id != null && byId.TryGetValue(id, out var body)) return body;
            return null;
        }
    }
}
