// Builds everything the real 3D characters need from the FBX files in Assets/Game/Art/Characters:
//   1. import settings (Humanoid for the KayKit bodies that carry the shared animation library, Generic for the Quaternius
//      bodies and animals, which have IK foot bones Unity cannot map; clip names cleaned, loops set, root locked),
//   2. ToonLit materials (textures kept as _BaseMap) in Generated/Materials,
//   3. one AnimatorController per rig family in Generated/Controllers: a 1D blend tree Idle -> Walk -> Run on "Speed" (m/s)
//      plus Talk, Wave, Sit, Lie, Death, Attack and Hit states for the clips each family has,
//   4. one prefab per body variant in Generated/Prefabs (scaled so an adult is 1.75 m, feet at y = 0, accessories pruned),
//   5. the CharacterManifest asset in World/Characters/Resources.
// Idempotent: run it again any time (menu "Garden of Eden/Build Characters" or `-executeMethod GardenOfEden.EditorTools.CharacterSetup.Build`).
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using GardenOfEden.World;
using UnityEditor;
using UnityEditor.Animations;
using UnityEngine;
using Object = UnityEngine.Object;

namespace GardenOfEden.EditorTools
{
    public static class CharacterSetup
    {
        const string Root = "Assets/Game/Art/Characters";
        const string Gen = Root + "/Generated";
        const string ManifestDir = "Assets/Game/World/Characters/Resources";
        const string ImportTag = "charsetup-v3";

        // ------------------------------------------------------------------ the catalogue

        internal sealed class Family
        {
            public string key;          // controller name
            public string clipsFrom;    // FBX that carries the clips
            public bool humanoid;
            public BodyKind kind;
            // clip names (lowercase, without rig prefix); first that exists wins
            public string[] idle, walk, run, talk, wave, sitDown, sitIdle, lieDown, lieIdle, dead, hit, attack, attackArmed;
        }

        sealed class Spec
        {
            public string id, fbx, family;
            public float height;              // target height in metres (adults 1.75; animals whole body)
            public string[] keep;             // KayKit: accessory renderers to keep (everything else non-skinned is removed)
            public bool armed;
            public string[] clothes = new string[0], pants = new string[0], trim = new string[0], hair = new string[0], skin = new string[0], tintRenderers = new string[0];
            public bool pruneAccessories;     // true for KayKit bodies (they carry every weapon and shield at once)
        }

        static readonly string[] N = new string[0];

        static readonly Family[] Families =
        {
            new Family { key = "KayKit", clipsFrom = Root + "/KayKit/Knight.fbx", humanoid = true, kind = BodyKind.Person,
                idle = new[] { "idle" }, walk = new[] { "walking_a" }, run = new[] { "running_a" }, talk = new[] { "interact" }, wave = new[] { "cheer" },
                sitDown = new[] { "sit_floor_down" }, sitIdle = new[] { "sit_floor_idle" }, lieDown = new[] { "lie_down" }, lieIdle = new[] { "lie_idle" },
                dead = new[] { "death_a" }, hit = new[] { "hit_a" }, attack = new[] { "unarmed_melee_attack_punch_a" }, attackArmed = new[] { "1h_melee_attack_slice_diagonal" } },
            new Family { key = "Man", clipsFrom = Root + "/Quaternius/Humans/Man_Casual.fbx", humanoid = false, kind = BodyKind.Person,
                idle = new[] { "idle", "standing" }, walk = new[] { "walk" }, run = new[] { "run" }, wave = new[] { "clapping" }, sitIdle = new[] { "sitting" },
                dead = new[] { "death" }, attack = new[] { "punch" }, attackArmed = new[] { "swordslash" } },
            new Family { key = "Woman", clipsFrom = Root + "/Quaternius/Humans/Woman_Casual.fbx", humanoid = false, kind = BodyKind.Person,
                idle = new[] { "idle", "standing" }, walk = new[] { "walk" }, run = new[] { "run" }, wave = new[] { "clapping" }, sitIdle = new[] { "sitting" },
                dead = new[] { "death" }, attack = new[] { "punch" }, attackArmed = new[] { "swordslash" } },
            new Family { key = "CasualCharacter", clipsFrom = Root + "/Quaternius/Humans/Casual_Character.fbx", humanoid = false, kind = BodyKind.Person,
                idle = new[] { "idle_neutral", "idle" }, walk = new[] { "walk" }, run = new[] { "run" }, talk = new[] { "interact" }, wave = new[] { "wave" },
                dead = new[] { "death" }, hit = new[] { "hitrecieve" }, attack = new[] { "punch_right" }, attackArmed = new[] { "sword_slash" } },
            new Family { key = "CharacterAnimated", clipsFrom = Root + "/Quaternius/Humans/Character_Animated.fbx", humanoid = false, kind = BodyKind.Person,
                idle = new[] { "idle" }, walk = new[] { "walk" }, run = new[] { "run" }, talk = new[] { "pickup" },
                dead = new[] { "death" }, hit = new[] { "recievehit" }, attack = new[] { "punch" }, attackArmed = new[] { "dagger_attack" } },
            Animal("Horse"), Animal("Deer"), Animal("Stag"), Animal("Donkey"), Animal("Bull"), Animal("Wolf"),
        };

        static Family Animal(string name) => new Family
        {
            key = name, clipsFrom = Root + "/Quaternius/Animals/" + name + ".fbx", humanoid = false, kind = BodyKind.Animal,
            idle = new[] { "idle" }, walk = new[] { "walk" }, run = new[] { "gallop" },
            dead = new[] { "death" }, hit = new[] { "idle_hitreact_left" }, attack = new[] { "attack_headbutt", "attack" }, attackArmed = new[] { "attack_headbutt", "attack" },
        };

        static readonly string[] KayTint = { "_Body", "_ArmLeft", "_ArmRight", "_LegLeft", "_LegRight" };

        static Spec[] Specs()
        {
            string K = Root + "/KayKit/", Q = Root + "/Quaternius/Humans/", A = Root + "/Quaternius/Animals/";
            Spec Kay(string id, string fbx, string[] keep, bool armed) => new Spec { id = id, fbx = K + fbx, family = "KayKit", height = 1.75f, keep = keep, armed = armed, pruneAccessories = true, tintRenderers = KayTint };
            Spec Ani(string id, string name, float h) => new Spec { id = id, fbx = A + name + ".fbx", family = name, height = h };
            return new[]
            {
                // KayKit: one shared humanoid rig and animation library, atlas texture (tinted softly per renderer)
                Kay("rogue", "Rogue.fbx", new[] { "Rogue_Cape", "Knife" }, true),
                Kay("rogue_hooded", "Rogue_Hooded.fbx", N, false),
                Kay("rogue_hooded_bandit", "Rogue_Hooded.fbx", new[] { "Knife", "Knife_Offhand" }, true),
                Kay("knight_guard", "Knight.fbx", new[] { "Knight_Helmet", "1H_Sword", "Rectangle_Shield" }, true),
                Kay("knight_noble", "Knight.fbx", new[] { "Knight_Cape" }, false),
                Kay("barbarian_raider", "Barbarian.fbx", new[] { "1H_Axe", "Barbarian_Round_Shield", "Barbarian_Hat" }, true),
                Kay("barbarian_worker", "Barbarian.fbx", new[] { "Mug" }, false),
                Kay("mage_elder", "Mage.fbx", new[] { "Mage_Hat", "2H_Staff" }, false),
                Kay("mage_noble", "Mage.fbx", new[] { "Mage_Cape", "Spellbook" }, false),
                // Quaternius people: named material slots take the clothes, trim, hair and skin colours
                new Spec { id = "man_casual", fbx = Q + "Man_Casual.fbx", family = "Man", height = 1.75f, clothes = new[] { "Shirt" }, pants = new[] { "Pants" }, trim = new[] { "Socks" }, hair = new[] { "Hair" }, skin = new[] { "Skin" } },
                new Spec { id = "man_suit", fbx = Q + "Man_Suit.fbx", family = "Man", height = 1.78f, clothes = new[] { "Shirt" }, pants = new[] { "Pants" }, trim = new[] { "Details" }, hair = new[] { "Hair" }, skin = new[] { "Skin" } },
                new Spec { id = "woman_casual", fbx = Q + "Woman_Casual.fbx", family = "Woman", height = 1.66f, clothes = new[] { "Shirt" }, pants = new[] { "Pants" }, trim = new[] { "Shoes" }, hair = new[] { "Hair", "HairBase" }, skin = new[] { "Skin" } },
                new Spec { id = "casual_character", fbx = Q + "Casual_Character.fbx", family = "CasualCharacter", height = 1.72f, clothes = new[] { "LightBrown" }, pants = new[] { "LightBlue" }, trim = new[] { "Red_Dark" }, hair = new[] { "Hair" }, skin = new[] { "Skin", "Skin_Darker" } },
                new Spec { id = "character_animated", fbx = Q + "Character_Animated.fbx", family = "CharacterAnimated", height = 1.75f, clothes = new[] { "Shirt" }, pants = new[] { "Pants" }, trim = new[] { "UnderShirt" }, hair = new[] { "Hair" }, skin = new[] { "Skin" }, armed = true },
                // Quaternius animals (own coat colours; a server tint recolours the main coat)
                Ani("horse", "Horse", 2.15f), Ani("donkey", "Donkey", 1.55f), Ani("bull", "Bull", 1.75f), Ani("deer", "Deer", 1.55f), Ani("stag", "Stag", 1.95f), Ani("wolf", "Wolf", 0.95f),
            };
        }

        // ------------------------------------------------------------------ entry points

        [MenuItem("Garden of Eden/Build Characters")]
        public static void Build()
        {
            Directory.CreateDirectory(Gen + "/Materials");
            Directory.CreateDirectory(Gen + "/Prefabs");
            Directory.CreateDirectory(Gen + "/Controllers");
            Directory.CreateDirectory(ManifestDir);
            AssetDatabase.Refresh();

            ConfigureImports();
            measured.Clear();
            var controllers = new Dictionary<string, AnimatorController>();
            foreach (var f in Families) controllers[f.key] = BuildController(f);
            AssetDatabase.SaveAssets();

            var manifest = LoadOrCreateManifest();
            manifest.bodies.Clear();
            var famByKey = Families.ToDictionary(f => f.key);
            foreach (var spec in Specs())
            {
                try
                {
                    var body = BuildBody(spec, famByKey[spec.family], controllers[spec.family]);
                    if (body != null) manifest.bodies.Add(body);
                }
                catch (Exception e) { Debug.LogError("CharacterSetup: " + spec.id + ": " + e); }
            }
            EditorUtility.SetDirty(manifest);
            AssetDatabase.SaveAssets();
            AssetDatabase.Refresh();
            Debug.Log("CharacterSetup: built " + manifest.bodies.Count + " bodies, " + controllers.Count + " controllers.");
        }

        // ------------------------------------------------------------------ 1. import settings

        static string CleanClipName(string take)
        {
            string arm = take.Contains('|') ? take.Substring(0, take.IndexOf('|')) : "";
            string n = take.Contains('|') ? take.Substring(take.LastIndexOf('|') + 1) : take;
            if (arm.Length > 0 && n.EndsWith("_" + arm, StringComparison.OrdinalIgnoreCase)) n = n.Substring(0, n.Length - arm.Length - 1);
            return n;
        }

        internal static string Key(string clipName)
        {
            string n = CleanClipName(clipName).ToLowerInvariant();
            foreach (var pre in new[] { "man_", "female_" }) if (n.StartsWith(pre)) n = n.Substring(pre.Length);
            if (n.EndsWith("_rig")) n = n.Substring(0, n.Length - 4);
            return n;
        }

        static bool Loops(string key) =>
            key.Contains("idle") || key == "standing" || key.StartsWith("walk") || key.StartsWith("run") || key == "gallop" || key == "interact" || key == "blocking" || key == "sitting" || key == "working" || key == "spellcasting" || key == "clapping";

        static void ConfigureImports()
        {
            var families = Families.ToDictionary(f => f.clipsFrom);
            foreach (var guid in AssetDatabase.FindAssets("t:Model", new[] { Root }))
            {
                string path = AssetDatabase.GUIDToAssetPath(guid);
                if (path.StartsWith(Gen)) continue;
                var imp = AssetImporter.GetAtPath(path) as ModelImporter;
                if (imp == null) continue;
                bool human = path.Contains("/KayKit/");
                bool carriesClips = families.ContainsKey(path);
                string tag = ImportTag + (human ? "h" : "g") + (carriesClips ? "c" : "n");
                if (imp.userData == tag) continue;
                imp.importCameras = false; imp.importLights = false; imp.importBlendShapes = false; imp.importVisibility = false;
                imp.animationType = human ? ModelImporterAnimationType.Human : ModelImporterAnimationType.Generic;
                imp.avatarSetup = ModelImporterAvatarSetup.CreateFromThisModel;
                imp.optimizeGameObjects = false;
                imp.importAnimation = carriesClips;
                imp.meshCompression = ModelImporterMeshCompression.Off;
                imp.materialImportMode = ModelImporterMaterialImportMode.ImportViaMaterialDescription;
                if (carriesClips)
                {
                    var clips = imp.defaultClipAnimations;
                    foreach (var c in clips)
                    {
                        string key = Key(c.name);
                        c.name = CleanClipName(c.name);
                        c.loopTime = Loops(key);
                        c.loopPose = c.loopTime;
                        c.lockRootRotation = true; c.lockRootHeightY = true; c.lockRootPositionXZ = true;
                        c.keepOriginalOrientation = true; c.keepOriginalPositionY = true; c.keepOriginalPositionXZ = true;
                    }
                    imp.clipAnimations = clips;
                }
                imp.userData = tag;
                imp.SaveAndReimport();
            }
        }

        // ------------------------------------------------------------------ 3. controllers

        sealed class ClipSet
        {
            readonly Dictionary<string, AnimationClip> byKey = new Dictionary<string, AnimationClip>();
            public ClipSet(string fbx)
            {
                foreach (var c in AssetDatabase.LoadAllAssetsAtPath(fbx).OfType<AnimationClip>())
                {
                    if (c.name.StartsWith("__preview__")) continue;
                    string k = Key(c.name);
                    if (!byKey.ContainsKey(k)) byKey[k] = c;
                }
            }
            public AnimationClip Find(string[] names)
            {
                if (names == null) return null;
                foreach (var n in names) if (byKey.TryGetValue(n, out var c)) return c;
                return null;
            }
            public int Count => byKey.Count;
        }

        static AnimatorController BuildController(Family f) => BuildControllerAt(f, Gen + "/Controllers/" + f.key + ".controller");

        internal static AnimatorController BuildControllerAt(Family f, string path)
        {
            AssetDatabase.DeleteAsset(path);
            var clips = new ClipSet(f.clipsFrom);
            var ctrl = AnimatorController.CreateAnimatorControllerAtPath(path);
            ctrl.AddParameter("Speed", AnimatorControllerParameterType.Float);
            foreach (var b in new[] { "Dead", "Down", "Talking", "Sitting", "Armed" }) ctrl.AddParameter(b, AnimatorControllerParameterType.Bool);
            foreach (var t in new[] { "Wave", "Attack", "Hit" }) ctrl.AddParameter(t, AnimatorControllerParameterType.Trigger);
            var sm = ctrl.layers[0].stateMachine;

            var idle = clips.Find(f.idle); var walk = clips.Find(f.walk); var run = clips.Find(f.run);
            if (idle == null || walk == null) Debug.LogWarning("CharacterSetup: " + f.key + " lacks idle/walk (" + clips.Count + " clips)");

            // Locomotion: Idle -> Walk -> Run on Speed; thresholds are replaced with measured ground speeds in BuildBody.
            var loco = sm.AddState("Locomotion", new Vector3(300, 0));
            var tree = new BlendTree { name = "Locomotion", blendType = BlendTreeType.Simple1D, blendParameter = "Speed", useAutomaticThresholds = false };
            AssetDatabase.AddObjectToAsset(tree, ctrl);
            if (idle != null) tree.AddChild(idle, 0f);
            if (walk != null) tree.AddChild(walk, 1.4f);
            if (run != null) tree.AddChild(run, 4f);
            loco.motion = tree;
            sm.defaultState = loco;

            AnimatorState State(string name, AnimationClip clip, Vector3 pos)
            {
                var s = sm.AddState(name, pos);
                s.motion = clip;
                s.writeDefaultValues = true;
                return s;
            }
            AnimatorStateTransition ToLoco(AnimatorState s, bool exitTime, float exit = 0.92f)
            {
                var t = s.AddTransition(loco);
                t.hasExitTime = exitTime; t.exitTime = exit; t.duration = 0.2f; t.hasFixedDuration = true;
                return t;
            }
            AnimatorStateTransition Any(AnimatorState s, float dur = 0.12f)
            {
                var t = sm.AddAnyStateTransition(s);
                t.hasExitTime = false; t.duration = dur; t.hasFixedDuration = true; t.canTransitionToSelf = false;
                return t;
            }

            var dead = clips.Find(f.dead);
            // Death and Lie: Dead -> Death (holds the last frame); Down (unconscious) -> Lie, or Death where there is no Lie clip
            AnimatorState death = null;
            if (dead != null)
            {
                death = State("Death", dead, new Vector3(600, 120));
                var t = Any(death, 0.15f); t.AddCondition(AnimatorConditionMode.If, 0, "Dead");
                var back = ToLoco(death, false); back.AddCondition(AnimatorConditionMode.IfNot, 0, "Dead"); back.AddCondition(AnimatorConditionMode.IfNot, 0, "Down");
                back.duration = 0.35f;
            }
            var lieDown = clips.Find(f.lieDown); var lieIdle = clips.Find(f.lieIdle);
            if (lieIdle != null)
            {
                var ld = lieDown != null ? State("LieDown", lieDown, new Vector3(600, 200)) : null;
                var li = State("LieIdle", lieIdle, new Vector3(800, 200));
                var enter = Any(ld ?? li, 0.2f); enter.AddCondition(AnimatorConditionMode.If, 0, "Down"); enter.AddCondition(AnimatorConditionMode.IfNot, 0, "Dead");
                if (ld != null) { var toIdle = ld.AddTransition(li); toIdle.hasExitTime = true; toIdle.exitTime = 0.95f; toIdle.duration = 0.1f; }
                foreach (var s in new[] { ld, li }.Where(x => x != null))
                {
                    var back = ToLoco(s, false); back.AddCondition(AnimatorConditionMode.IfNot, 0, "Down"); back.duration = 0.4f;
                }
            }
            else if (death != null)
            {
                var t = Any(death, 0.2f); t.AddCondition(AnimatorConditionMode.If, 0, "Down");
            }

            // Sit
            var sitDown = clips.Find(f.sitDown); var sitIdle = clips.Find(f.sitIdle);
            if (sitIdle != null)
            {
                var sd = sitDown != null ? State("SitDown", sitDown, new Vector3(600, 300)) : null;
                var si = State("SitIdle", sitIdle, new Vector3(800, 300));
                var enter = loco.AddTransition(sd ?? si); enter.hasExitTime = false; enter.duration = 0.25f; enter.AddCondition(AnimatorConditionMode.If, 0, "Sitting");
                if (sd != null) { var toIdle = sd.AddTransition(si); toIdle.hasExitTime = true; toIdle.exitTime = 0.95f; toIdle.duration = 0.1f; }
                foreach (var s in new[] { sd, si }.Where(x => x != null))
                {
                    var back = ToLoco(s, false); back.AddCondition(AnimatorConditionMode.IfNot, 0, "Sitting");
                }
            }

            // Talk (looping gesture while someone is in conversation / busy)
            var talk = clips.Find(f.talk);
            if (talk != null)
            {
                var ts = State("Talk", talk, new Vector3(600, -120));
                var enter = loco.AddTransition(ts); enter.hasExitTime = false; enter.duration = 0.3f; enter.AddCondition(AnimatorConditionMode.If, 0, "Talking"); enter.AddCondition(AnimatorConditionMode.Less, 0.1f, "Speed");
                var back = ToLoco(ts, false); back.AddCondition(AnimatorConditionMode.IfNot, 0, "Talking");
            }

            // One-shots from any state (not while down)
            void OneShot(string name, string trigger, AnimationClip clip, Vector3 pos, Action<AnimatorStateTransition> extra = null)
            {
                if (clip == null) return;
                var s = State(name, clip, pos);
                var t = Any(s, 0.1f);
                t.AddCondition(AnimatorConditionMode.If, 0, trigger);
                t.AddCondition(AnimatorConditionMode.IfNot, 0, "Dead");
                t.AddCondition(AnimatorConditionMode.IfNot, 0, "Down");
                extra?.Invoke(t);
                ToLoco(s, true, 0.9f);
            }
            OneShot("Wave", "Wave", clips.Find(f.wave), new Vector3(600, -240));
            var atk = clips.Find(f.attack); var atkArmed = clips.Find(f.attackArmed) ?? atk;
            if (atk != null)
            {
                OneShot("Attack", "Attack", atk, new Vector3(600, -360), t => t.AddCondition(AnimatorConditionMode.IfNot, 0, "Armed"));
                if (atkArmed != null && atkArmed != atk) OneShot("AttackArmed", "Attack", atkArmed, new Vector3(800, -360), t => t.AddCondition(AnimatorConditionMode.If, 0, "Armed"));
                else if (atkArmed == atk) { /* one clip serves armed and unarmed: the unarmed transition above ignores Armed */ }
            }
            OneShot("Hit", "Hit", clips.Find(f.hit), new Vector3(600, -480));
            EditorUtility.SetDirty(ctrl);
            return ctrl;
        }

        // ------------------------------------------------------------------ 2 + 4. materials, prefabs

        static Shader Toon => Shader.Find("GardenOfEden/ToonLit");

        static Material ToonMaterial(string fbxName, Material src, Texture2D atlas)
        {
            string slot = src != null ? src.name : "Material";
            string path = Gen + "/Materials/" + fbxName + "." + slot.Replace('/', '_') + ".mat";
            var m = AssetDatabase.LoadAssetAtPath<Material>(path);
            if (m == null) { m = new Material(Toon); AssetDatabase.CreateAsset(m, path); }
            m.shader = Toon;
            Color c = src != null && src.HasProperty("_BaseColor") ? src.GetColor("_BaseColor") : Color.white;
            Texture tex = atlas != null ? atlas : (src != null ? src.mainTexture : null);
            if (atlas != null) c = Color.white;
            m.SetColor("_BaseColor", new Color(c.r, c.g, c.b, 1f));
            m.SetTexture("_BaseMap", tex);
            m.SetFloat("_RimStrength", 0.25f);
            m.enableInstancing = true;
            EditorUtility.SetDirty(m);
            return m;
        }

        static Bounds BodyBounds(GameObject go)
        {
            var b = new Bounds(); bool first = true;
            foreach (var smr in go.GetComponentsInChildren<SkinnedMeshRenderer>())
            {
                var bb = smr.bounds;
                if (first) { b = bb; first = false; } else b.Encapsulate(bb);
            }
            return b;
        }

        static CharacterBody BuildBody(Spec spec, Family fam, AnimatorController ctrl)
        {
            var fbx = AssetDatabase.LoadAssetAtPath<GameObject>(spec.fbx);
            if (fbx == null) { Debug.LogWarning("CharacterSetup: missing " + spec.fbx); return null; }
            string fbxName = Path.GetFileNameWithoutExtension(spec.fbx);
            var avatar = AssetDatabase.LoadAllAssetsAtPath(spec.fbx).OfType<Avatar>().FirstOrDefault();
            if (avatar == null || !avatar.isValid) { Debug.LogWarning("CharacterSetup: no valid avatar for " + spec.fbx); return null; }
            if (fam.humanoid && !avatar.isHuman) { Debug.LogWarning("CharacterSetup: " + spec.fbx + " is not humanoid"); return null; }

            Texture2D atlas = null;
            string texName = fbxName.ToLowerInvariant().Replace("_hooded", "") + "_texture";
            string texPath = Root + "/KayKit/Textures/" + texName + ".png";
            if (spec.pruneAccessories) atlas = AssetDatabase.LoadAssetAtPath<Texture2D>(texPath);

            var root = new GameObject(spec.id);
            var model = Object.Instantiate(fbx, root.transform);
            model.name = "Model";
            try
            {
                // Prune: the stray helper sphere, and (KayKit) every weapon, shield, hat and cape not wanted in this variant.
                foreach (var r in model.GetComponentsInChildren<Renderer>(true).ToArray())
                {
                    if (r == null) continue;
                    bool remove = r.name.StartsWith("Icosphere");
                    if (spec.pruneAccessories && !(r is SkinnedMeshRenderer) && !spec.keep.Contains(r.name)) remove = true;
                    if (remove) Object.DestroyImmediate(r.gameObject);
                }
                foreach (var r in model.GetComponentsInChildren<Renderer>(true))
                {
                    var src = r.sharedMaterials;
                    var mats = new Material[src.Length];
                    for (int i = 0; i < src.Length; i++) mats[i] = ToonMaterial(fbxName, src[i], atlas);
                    r.sharedMaterials = mats;
                    r.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.On;
                    var smr = r as SkinnedMeshRenderer;
                    if (smr != null) smr.updateWhenOffscreen = false;
                }
                // Scale to the target height and put the feet on y = 0.
                var bounds = BodyBounds(model);
                float s = spec.height / Mathf.Max(0.01f, bounds.size.y);
                model.transform.localScale = Vector3.one * s;
                var b2 = BodyBounds(model);
                model.transform.localPosition = new Vector3(0, -b2.min.y, 0);
                b2 = BodyBounds(model);

                var anim = model.GetComponent<Animator>();
                if (anim == null) anim = model.AddComponent<Animator>();
                anim.avatar = avatar;
                anim.runtimeAnimatorController = ctrl;
                anim.applyRootMotion = false;
                anim.cullingMode = AnimatorCullingMode.CullUpdateTransforms;

                var body = new CharacterBody
                {
                    id = spec.id, kind = fam.kind, armed = spec.armed,
                    height = spec.height, radius = fam.kind == BodyKind.Person ? 0.3f : Mathf.Max(b2.extents.x, b2.extents.z) * 0.9f,
                    clothes = spec.clothes, pants = spec.pants, trim = spec.trim, hair = spec.hair, skin = spec.skin,
                    tintRenderers = spec.tintRenderers,
                };
                MeasureSpeeds(model, anim, fam, body);
                ApplyThresholds(ctrl, body, fam);

                string prefabPath = Gen + "/Prefabs/" + spec.id + ".prefab";
                var prefab = PrefabUtility.SaveAsPrefabAsset(root, prefabPath);
                body.prefab = prefab;
                Debug.Log("CharacterSetup: " + spec.id + " h=" + spec.height.ToString("0.00") + " scale=" + s.ToString("0.000") + " walk=" + body.walkSpeed.ToString("0.00") + " run=" + body.runSpeed.ToString("0.00"));
                return body;
            }
            finally { Object.DestroyImmediate(root); }
        }

        // ------------------------------------------------------------------ ground speed of the clips

        static readonly Dictionary<string, Vector2> measured = new Dictionary<string, Vector2>();

        static void MeasureSpeeds(GameObject model, Animator anim, Family fam, CharacterBody body)
        {
            // One measurement per family: its bodies share the controller, so they share the blend tree thresholds.
            if (measured.TryGetValue(fam.key, out var known)) { body.walkSpeed = known.x; body.runSpeed = known.y; return; }
            body.walkSpeed = fam.kind == BodyKind.Animal ? 1.6f : 1.4f;
            body.runSpeed = fam.kind == BodyKind.Animal ? 3.6f : 4f;
            var clips = new ClipSet(fam.clipsFrom);
            var walk = clips.Find(fam.walk); var run = clips.Find(fam.run);
            float w = MeasureClip(model, walk, 0.62f), r = MeasureClip(model, run, fam.kind == BodyKind.Animal ? 0.45f : 0.4f);
            if (w > 0.3f && w < 6f) body.walkSpeed = w;
            if (r > body.walkSpeed * 1.3f && r < 14f) body.runSpeed = r;
            if (fam.kind == BodyKind.Animal) body.runSpeed = Mathf.Min(body.runSpeed, Mathf.Max(body.walkSpeed * 1.8f, 3.4f));
            // Measurements of humanoid clips and small animals come out too low (IK helper bones, stance guess): keep them sane.
            if (fam.kind == BodyKind.Person) { if (body.walkSpeed < 0.9f) body.walkSpeed = 1.4f; if (body.runSpeed < 2.5f) body.runSpeed = 4f; }
            else { body.walkSpeed = Mathf.Max(body.walkSpeed, 1.1f); body.runSpeed = Mathf.Max(body.runSpeed, 3.0f); }
            measured[fam.key] = new Vector2(body.walkSpeed, body.runSpeed);
        }

        /// <summary>
        /// Ground speed of a looping walk/run clip: the stance foot travels backwards at the ground speed, so the foot's travel
        /// along the heading over the cycle divided by the stance part of the cycle (about 60% walking, 40% running) is it.
        /// </summary>
        /// <summary>Walk and run speeds of an animal's clips (measured on the instance), written into the body.</summary>
        internal static void MeasureAnimal(GameObject model, Animator anim, Family fam, CharacterBody body)
        {
            body.walkSpeed = 1.3f; body.runSpeed = 3.6f;
            var clips = new ClipSet(fam.clipsFrom);
            float w = MeasureClip(model, clips.Find(fam.walk), 0.62f), r = MeasureClip(model, clips.Find(fam.run), 0.45f);
            // Small animals measure low (short strides at a quick cadence): keep to a believable range for the animal's size.
            float size = Mathf.Max(0.2f, body.height);
            float minWalk = Mathf.Lerp(0.5f, 1.3f, Mathf.Clamp01(size / 1.2f));
            if (w > 0.2f && w < 8f) body.walkSpeed = Mathf.Max(w, minWalk * 0.6f);
            if (r > body.walkSpeed * 1.2f && r < 16f) body.runSpeed = r; else body.runSpeed = body.walkSpeed * 2.6f;
            body.runSpeed = Mathf.Min(body.runSpeed, Mathf.Max(body.walkSpeed * 3f, 3f));
        }

        static float MeasureClip(GameObject model, AnimationClip clip, float stance)
        {
            if (clip == null || clip.length < 0.05f) return 0f;
            var feet = new List<Transform>();
            foreach (var t in model.GetComponentsInChildren<Transform>())
            {
                string n = t.name.ToLowerInvariant();
                if (n.Contains("pole") || n.Contains("control") || n.Contains("heel") || n.Contains("kneeik") || n.Contains("toe")) continue;
                if (n.Contains("foot") || n.Contains("lowerleg") || n.Contains("lowleg")) feet.Add(t);
            }
            if (feet.Count == 0) return 0f;
            const int steps = 24;
            var min = new float[feet.Count]; var max = new float[feet.Count];
            for (int i = 0; i < feet.Count; i++) { min[i] = float.MaxValue; max[i] = float.MinValue; }
            var parent = model.transform.parent;
            for (int s = 0; s < steps; s++)
            {
                clip.SampleAnimation(model, clip.length * s / steps);
                for (int i = 0; i < feet.Count; i++)
                {
                    float z = parent.InverseTransformPoint(feet[i].position).z;
                    min[i] = Mathf.Min(min[i], z); max[i] = Mathf.Max(max[i], z);
                }
            }
            float range = 0f;
            for (int i = 0; i < feet.Count; i++) range = Mathf.Max(range, max[i] - min[i]);
            Debug.Log("CharacterSetup: measure " + clip.name + " feet=" + feet.Count + " range=" + range.ToString("0.000") + " len=" + clip.length.ToString("0.00") + " -> " + (range / (stance * clip.length)).ToString("0.00") + " m/s");
            return range / (stance * clip.length);
        }

        internal static void ApplyThresholds(AnimatorController ctrl, CharacterBody body, Family fam)
        {
            // Controllers are shared by bodies of one family; the family's first body sets the thresholds.
            var sm = ctrl.layers[0].stateMachine;
            var loco = sm.states.Select(s => s.state).FirstOrDefault(s => s.name == "Locomotion");
            var tree = loco != null ? loco.motion as BlendTree : null;
            if (tree == null) return;
            var kids = tree.children;
            for (int i = 0; i < kids.Length; i++)
            {
                var m = kids[i].motion as AnimationClip;
                if (m == null) continue;
                string k = Key(m.name);
                if (Array.IndexOf(fam.walk, k) >= 0) kids[i].threshold = body.walkSpeed;
                else if (Array.IndexOf(fam.run, k) >= 0) kids[i].threshold = body.runSpeed;
                else kids[i].threshold = 0f;
            }
            tree.children = kids;
            EditorUtility.SetDirty(tree);
            EditorUtility.SetDirty(ctrl);
        }

        // ------------------------------------------------------------------ 5. manifest

        static CharacterManifest LoadOrCreateManifest()
        {
            string path = ManifestDir + "/CharacterManifest.asset";
            var m = AssetDatabase.LoadAssetAtPath<CharacterManifest>(path);
            if (m == null)
            {
                m = ScriptableObject.CreateInstance<CharacterManifest>();
                AssetDatabase.CreateAsset(m, path);
            }
            return m;
        }
    }
}
