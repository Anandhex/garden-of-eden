// Imports the Blender character system (art3d/characters, art3d/creatures) into Unity and builds what the runtime needs:
//   * AssetPostprocessor: every FBX under Assets/Game/Art/People and Art/Creatures gets the README's settings
//     (Normals = Import, Blend Shape Normals = None, Read/Write on, no mesh compression, max 4 bones per vertex, no cameras or
//     lights), decal and detail textures are readable and uncompressed;
//   * Build(): the Humanoid avatar of the base body with a T-pose reference (the rig rests in an A-pose, so the arm bones of the
//     avatar description are rotated to a T-pose, like "Enforce T-Pose" does), the PersonRig prefab (Armature + Animator only),
//     the cloth detail Texture2DArray, the shared materials, one prefab + controller per creature, and the CharacterKit asset in
//     Resources that the runtime (CharacterBuilder) loads.
// Idempotent: run it again any time (menu Garden of Eden/Build Character System, or
// `-executeMethod GardenOfEden.EditorTools.CharacterImport.Build`).
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
    public sealed class CharacterImportPostprocessor : AssetPostprocessor
    {
        const string People = "Assets/Game/Art/People/", Creatures = "Assets/Game/Art/Creatures/";

        /// <summary>Humanoid monsters on the shared 55-bone rig (the others are animals on generic rigs).</summary>
        public static readonly string[] Humanoids = { "goblin", "hobgoblin", "kobold", "gnoll", "lizardfolk", "minotaur", "ogre", "troll", "giant", "harpy" };

        public static bool IsHumanoidMonster(string path) => Humanoids.Contains(Path.GetFileNameWithoutExtension(path).ToLowerInvariant());

        void OnPreprocessModel()
        {
            string p = assetPath;
            bool people = p.StartsWith(People), creature = p.StartsWith(Creatures);
            if (!people && !creature) return;
            var mi = (ModelImporter)assetImporter;
            mi.importCameras = false; mi.importLights = false; mi.importVisibility = false; mi.importConstraints = false;
            mi.importBlendShapes = true;
            mi.importBlendShapeNormals = ModelImporterNormals.None;
            mi.importNormals = ModelImporterNormals.Import;
            mi.importTangents = ModelImporterTangents.None;
            mi.isReadable = true;
            mi.meshCompression = ModelImporterMeshCompression.Off;
            mi.optimizeGameObjects = false;
            mi.weldVertices = false;
            mi.skinWeights = ModelImporterSkinWeights.Custom;
            mi.maxBonesPerVertex = 4;
            mi.materialImportMode = ModelImporterMaterialImportMode.ImportViaMaterialDescription;
            mi.globalScale = 1f; mi.useFileScale = true;

            if (people)
            {
                bool isBase = Path.GetFileName(p) == "base_body.fbx";
                mi.importAnimation = false;
                if (isBase)
                {
                    mi.animationType = ModelImporterAnimationType.Human;
                    if (mi.avatarSetup != ModelImporterAvatarSetup.CreateFromThisModel) mi.avatarSetup = ModelImporterAvatarSetup.CreateFromThisModel;
                }
                else
                {
                    // parts and clothes: only their skinned meshes are used (bones re-pointed by name), so Generic without an avatar keeps the
                    // SkinnedMeshRenderers and bone weights (None would flatten them to static meshes)
                    mi.animationType = ModelImporterAnimationType.Generic;
                    mi.avatarSetup = ModelImporterAvatarSetup.NoAvatar;
                }
            }
            else
            {
                if (IsHumanoidMonster(p))
                {
                    mi.animationType = ModelImporterAnimationType.Human;
                    mi.importAnimation = false;
                    if (mi.avatarSetup != ModelImporterAvatarSetup.CreateFromThisModel) mi.avatarSetup = ModelImporterAvatarSetup.CreateFromThisModel;
                }
                else
                {
                    mi.animationType = ModelImporterAnimationType.Generic;
                    mi.importAnimation = true;
                    if (mi.avatarSetup != ModelImporterAvatarSetup.CreateFromThisModel) mi.avatarSetup = ModelImporterAvatarSetup.CreateFromThisModel;
                }
            }
        }

        public static bool IsAlbedoName(string n) => n.Contains("albedo") || n.Contains("basecolor") || n.Contains("base_color") || n.Contains("diffuse") || n.Contains("colour") || n.Contains("color");

        void OnPreprocessTexture()
        {
            string p = assetPath;
            var ti = (TextureImporter)assetImporter;
            if (p.StartsWith(People + "Resources/Decals/"))
            {
                // Decals are read on the CPU and painted into a small per-person atlas: keep every pixel, no mips, sRGB display values.
                ti.textureType = TextureImporterType.Default;
                ti.isReadable = true; ti.mipmapEnabled = false; ti.sRGBTexture = true;
                ti.textureCompression = TextureImporterCompression.Uncompressed;
                ti.maxTextureSize = 512; ti.alphaSource = TextureImporterAlphaSource.FromInput; ti.alphaIsTransparency = false;
                ti.npotScale = TextureImporterNPOTScale.None;
            }
            else if (p.StartsWith(People + "Base/textures/"))
            {
                // the skin texture set from the art pipeline: normal maps as normal maps, masks linear, albedo sRGB; readable for the bake
                string n = Path.GetFileNameWithoutExtension(p).ToLowerInvariant();
                ti.isReadable = true; ti.mipmapEnabled = true; ti.maxTextureSize = 2048; ti.wrapMode = TextureWrapMode.Clamp;
                if (n.Contains("normal") || n.EndsWith("_n") || n.EndsWith("_nrm")) { ti.textureType = TextureImporterType.NormalMap; ti.sRGBTexture = false; }
                else { ti.textureType = TextureImporterType.Default; ti.sRGBTexture = IsAlbedoName(n); }
                ti.textureCompression = TextureImporterCompression.Uncompressed;
            }
            else if (p.StartsWith(People + "Clothes/textures/"))
            {
                ti.textureType = TextureImporterType.Default;
                ti.isReadable = true; ti.mipmapEnabled = true; ti.sRGBTexture = false;
                ti.textureCompression = TextureImporterCompression.Uncompressed;
                ti.maxTextureSize = 512; ti.wrapMode = TextureWrapMode.Repeat; ti.alphaIsTransparency = false;
                ti.npotScale = TextureImporterNPOTScale.None;
            }
            else if (p.StartsWith(Creatures + "textures/"))
            {
                ti.textureType = TextureImporterType.Default;
                ti.sRGBTexture = true; ti.mipmapEnabled = true; ti.maxTextureSize = 1024; ti.wrapMode = TextureWrapMode.Clamp;
                ti.textureCompression = TextureImporterCompression.Compressed;
            }
        }
    }

    public static class CharacterImport
    {
        const string Art = "Assets/Game/Art/";
        const string PeopleDir = Art + "People/", CreatureDir = Art + "Creatures/";
        const string PeopleGen = PeopleDir + "Generated", CreatureGen = CreatureDir + "Generated";
        const string KitPath = "Assets/Game/World/Characters/Resources/CharacterKit.asset";
        const string BasePath = PeopleDir + "Base/base_body.fbx";

        [MenuItem("Garden of Eden/Build Character System")]
        public static void Build()
        {
            int copied = SyncFromArt3d();
            Debug.Log("CharacterImport: synced from art3d/, " + copied + " files changed.");
            Directory.CreateDirectory(PeopleGen + "/Materials"); Directory.CreateDirectory(CreatureGen + "/Materials");
            Directory.CreateDirectory(CreatureGen + "/Prefabs"); Directory.CreateDirectory(CreatureGen + "/Controllers");
            Directory.CreateDirectory("Assets/Game/World/Characters/Resources");
            AssetDatabase.Refresh();

            var kit = LoadOrCreate<CharacterKit>(KitPath);
            kit.fbx.Clear(); kit.creatures.Clear();

            // 1. the base rig: avatar with a T-pose reference, rig prefab
            ConfigureBase();
            kit.baseAvatar = AssetDatabase.LoadAllAssetsAtPath(BasePath).OfType<Avatar>().FirstOrDefault();
            Debug.Log("CharacterImport: base avatar valid=" + (kit.baseAvatar != null && kit.baseAvatar.isValid) + " human=" + (kit.baseAvatar != null && kit.baseAvatar.isHuman));
            kit.rigPrefab = BuildRigPrefab(kit.baseAvatar);

            // 2. FBX and data refs
            foreach (var f in Directory.GetFiles(PeopleDir, "*.fbx", SearchOption.AllDirectories).OrderBy(x => x))
            {
                string path = f.Replace('\\', '/');
                var go = AssetDatabase.LoadAssetAtPath<GameObject>(path);
                if (go != null) kit.fbx.Add(new CharacterKit.FbxRef { key = Path.GetFileNameWithoutExtension(path), fbx = go });
            }
            kit.partsManifest = Text(PeopleDir + "Parts/parts_manifest.json");
            kit.clothesManifest = Text(PeopleDir + "Clothes/clothes_manifest.json");
            kit.speciesPresets = Text(PeopleDir + "Base/species_presets.json");
            kit.jointOffsets = Text(PeopleDir + "Base/joint_offsets.json");
            kit.baseMeta = Text(PeopleDir + "Base/base_body_meta.json");

            // 3. the cloth detail array, shared materials
            kit.detailArray = BuildDetailArray();
            kit.clothMaterial = SharedMaterial(PeopleGen + "/Materials/PersonCloth.mat", true, kit.detailArray);
            kit.skinTemplate = SharedMaterial(PeopleGen + "/Materials/PersonSkin.mat", false, null);
            kit.hairTemplate = HairMaterial(PeopleGen + "/Materials/PersonHair.mat");
            BuildSkinSet(kit);

            // 4. animation: people share the KayKit humanoid controller (built by CharacterSetup)
            var peopleCtrl = AssetDatabase.LoadAssetAtPath<AnimatorController>("Assets/Game/Art/Characters/Generated/Controllers/KayKit.controller");
            if (peopleCtrl == null) Debug.LogWarning("CharacterImport: KayKit.controller missing; run Garden of Eden/Build Characters first.");
            kit.peopleController = peopleCtrl;
            var rogue = CharacterManifest.Instance != null && CharacterManifest.Instance.TryGet("rogue_hooded", out var rb) ? rb : null;
            if (rogue != null) { kit.walkSpeed = rogue.walkSpeed; kit.runSpeed = rogue.runSpeed; }

            // 5. creatures
            BuildCreatures(kit, peopleCtrl);

            EditorUtility.SetDirty(kit);
            AssetDatabase.SaveAssets();
            AssetDatabase.Refresh();
            Debug.Log("CharacterImport: kit built: " + kit.fbx.Count + " fbx, " + kit.creatures.Count + " creatures.");
        }

        static T LoadOrCreate<T>(string path) where T : ScriptableObject
        {
            var a = AssetDatabase.LoadAssetAtPath<T>(path);
            if (a == null) { a = ScriptableObject.CreateInstance<T>(); AssetDatabase.CreateAsset(a, path); }
            return a;
        }

        static TextAsset Text(string path)
        {
            // JSON files import as TextAssets already.
            return AssetDatabase.LoadAssetAtPath<TextAsset>(path);
        }

        // ------------------------------------------------------------------ copying the art3d exports

        /// <summary>The repository root (the Unity project is unity/GardenOfEden inside it).</summary>
        static string RepoRoot => Path.GetFullPath(Path.Combine(Application.dataPath, "..", "..", ".."));

        // (source dir under the repo, destination under Assets, file patterns, recursive)
        static readonly (string src, string dst, string[] pats, bool deep)[] SyncMap =
        {
            ("art3d/characters/export", PeopleDir + "Base", new[] { "*.fbx", "*.json" }, false),
            ("art3d/characters/export/textures", PeopleDir + "Base/textures", new[] { "*.png", "*.jpg", "*.tga", "*.exr", "*.json" }, true),
            ("art3d/characters/parts/export", PeopleDir + "Parts", new[] { "*.fbx", "parts_manifest.json" }, false),
            ("art3d/characters/parts/export/textures", PeopleDir + "Resources/Decals", new[] { "*.png" }, true),
            ("art3d/characters/clothes/export", PeopleDir + "Clothes", new[] { "*.fbx", "clothes_manifest.json" }, false),
            ("art3d/characters/clothes/export/textures", PeopleDir + "Clothes/textures", new[] { "*.png" }, true),
            ("art3d/creatures/export", CreatureDir, new[] { "*.fbx", "*_meta.json" }, false),
            ("art3d/creatures/export/textures", CreatureDir + "textures", new[] { "*.png" }, true),
        };

        static bool SameFile(string a, string b)
        {
            var fa = new FileInfo(a); var fb = new FileInfo(b);
            if (!fb.Exists || fa.Length != fb.Length) return false;
            using (var sa = fa.OpenRead()) using (var sb = fb.OpenRead())
            {
                var ba = new byte[1 << 16]; var bb = new byte[1 << 16];
                while (true)
                {
                    int na = sa.Read(ba, 0, ba.Length), nb = sb.Read(bb, 0, bb.Length);
                    if (na != nb) return false;
                    if (na == 0) return true;
                    for (int i = 0; i < na; i++) if (ba[i] != bb[i]) return false;
                }
            }
        }

        /// <summary>
        /// Mirror the Blender exports (base body, swappable parts, clothes, creatures, their textures and manifests) into Assets/Game/Art.
        /// Only changed files are copied (byte compare), so re-running costs nothing when nothing changed; files that disappeared upstream
        /// are left in place (the manifests decide what is used). Then refresh, which re-imports what changed with the postprocessor's settings.
        /// </summary>
        public static int SyncFromArt3d()
        {
            int n = 0;
            string root = RepoRoot;
            foreach (var m in SyncMap)
            {
                string src = Path.Combine(root, m.src);
                if (!Directory.Exists(src)) continue;
                string dst = Path.GetFullPath(Path.Combine(Application.dataPath, "..", m.dst));
                foreach (var pat in m.pats)
                    foreach (var f in Directory.GetFiles(src, pat, m.deep ? SearchOption.AllDirectories : SearchOption.TopDirectoryOnly))
                    {
                        string rel = f.Substring(src.Length).TrimStart('/', '\\');
                        string to = Path.Combine(dst, rel);
                        if (SameFile(f, to)) continue;
                        Directory.CreateDirectory(Path.GetDirectoryName(to));
                        File.Copy(f, to, true);
                        n++;
                    }
            }
            AssetDatabase.Refresh(ImportAssetOptions.ForceSynchronousImport);
            return n;
        }

        // ------------------------------------------------------------------ skin texture set (from the face pipeline, when present)

        /// <summary>
        /// The head skin texture set of the face pipeline (People/Base/textures/skin: head_normal, head_roughness, head_ao, head_cavity,
        /// head_albedo_&lt;tone&gt; with skin_tones.json). It is laid out on the head's own UVs (UV0 of Mesh_Head, nose, ears), with the
        /// legacy face-decal rect on UV1, so it is only wired when the imported base head has that second UV set; with an older base FBX
        /// it stays off (its single UV set is the shared atlas, the maps would land on the wrong places). Roughness and AO x cavity are
        /// packed into one mask (R roughness, G AO).
        /// </summary>
        static void BuildSkinSet(CharacterKit kit)
        {
            kit.skinNormal = null; kit.skinMask = null; kit.skinTones.Clear();
            string dir = PeopleDir + "Base/textures/skin";
            if (!AssetDatabase.IsValidFolder(dir)) return;
            var baseGo = AssetDatabase.LoadAssetAtPath<GameObject>(BasePath);
            Mesh head = null;
            if (baseGo != null) foreach (var smr in baseGo.GetComponentsInChildren<SkinnedMeshRenderer>(true)) if (smr.name == "Mesh_Head") head = smr.sharedMesh;
            bool headLayout = head != null && head.isReadable && head.uv2 != null && head.uv2.Length == head.vertexCount;
            if (!headLayout) { Debug.Log("CharacterImport: skin texture set found but the base head has no second UV set (older base_body.fbx): skin maps off."); return; }
            Texture2D Tex(string n) => AssetDatabase.LoadAssetAtPath<Texture2D>(dir + "/" + n + ".png");
            kit.skinNormal = Tex("head_normal");
            Texture2D rough = Tex("head_roughness"), ao = Tex("head_ao"), cav = Tex("head_cavity");
            if (rough != null || ao != null || cav != null)
            {
                const int size = 1024;
                var outT = new Texture2D(size, size, TextureFormat.RGBA32, true, true) { name = "SkinMask", wrapMode = TextureWrapMode.Clamp };
                var px = new Color32[size * size];
                for (int y = 0; y < size; y++)
                    for (int x = 0; x < size; x++)
                    {
                        float u = (x + 0.5f) / size, v = (y + 0.5f) / size;
                        float r = rough != null ? rough.GetPixelBilinear(u, v).r : 0.6f;
                        float a = (ao != null ? ao.GetPixelBilinear(u, v).r : 1f) * (cav != null ? Mathf.Lerp(0.6f, 1f, cav.GetPixelBilinear(u, v).r) : 1f);
                        px[y * size + x] = new Color32((byte)(r * 255f), (byte)(a * 255f), 0, 255);
                    }
                outT.SetPixels32(px); outT.Apply(true);
                string p = PeopleGen + "/SkinMask.asset";
                AssetDatabase.DeleteAsset(p); AssetDatabase.CreateAsset(outT, p);
                kit.skinMask = AssetDatabase.LoadAssetAtPath<Texture2D>(p);
            }
            var tonesJson = AssetDatabase.LoadAssetAtPath<TextAsset>(dir + "/skin_tones.json");
            if (tonesJson != null)
            {
                var jo = Newtonsoft.Json.Linq.JObject.Parse(tonesJson.text);
                foreach (var kv in jo)
                {
                    var b = kv.Value["base"] as Newtonsoft.Json.Linq.JArray;
                    string file = (string)kv.Value["albedo"];
                    if (b == null || string.IsNullOrEmpty(file)) continue;
                    kit.skinTones.Add(new CharacterKit.SkinTone { id = kv.Key, baseColour = new Color((float)b[0], (float)b[1], (float)b[2]), albedo = Tex(Path.GetFileNameWithoutExtension(file)) });
                }
            }
            Debug.Log("CharacterImport: skin set normal=" + (kit.skinNormal != null) + " mask=" + (kit.skinMask != null) + " tones=" + kit.skinTones.Count);
        }

        static Material HairMaterial(string path)
        {
            var shader = Shader.Find("GardenOfEden/Hair");
            if (shader == null) { Debug.LogError("CharacterImport: shader GardenOfEden/Hair not found"); return null; }
            var m = AssetDatabase.LoadAssetAtPath<Material>(path);
            if (m == null) { m = new Material(shader); AssetDatabase.CreateAsset(m, path); }
            m.shader = shader;
            ApplyLook(m, 2);
            m.enableInstancing = false;
            EditorUtility.SetDirty(m);
            return m;
        }

        /// <summary>
        /// The look values of the character materials (G8 + the user's reference: warm key, cool blue-teal rim, warm subsurface on skin,
        /// matte cloth), kept here so a rebuild re-applies them. kind: 0 skin, 1 cloth, 2 hair.
        /// </summary>
        static void ApplyLook(Material m, int kind)
        {
            m.SetColor("_ShadowColor", new Color(0.50f, 0.40f, 0.52f));
            m.SetFloat("_Wrap", kind == 0 ? 0.55f : 0.45f);
            m.SetFloat("_AmbientStrength", 0.8f);
            m.SetColor("_SssColor", new Color(0.98f, 0.34f, 0.24f));
            m.SetFloat("_SssStrength", kind == 0 ? 0.95f : 0f);
            m.SetColor("_RimColor", new Color(1.0f, 0.84f, 0.62f));
            m.SetFloat("_RimStrength", 0.22f);
            m.SetColor("_CoolRim", new Color(0.28f, 0.72f, 0.86f));
            m.SetFloat("_CoolRimStrength", kind == 0 ? 0.6f : 0.55f);
            m.SetFloat("_SpecStrength", kind == 1 ? 0.6f : 1f);
            if (kind == 1) m.SetFloat("_DetailStrength", 0.55f);
        }

        // ------------------------------------------------------------------ base avatar

        /// <summary>Lower limit of the arms' Down-Up muscle in degrees (Unity default -60); see ConfigureTPose.</summary>
        public const float ArmDownMin = -80f;

        static void ConfigureBase() => ConfigureTPose(BasePath);

        /// <summary>
        /// The rigs rest in an A-pose: write a T-pose reference into the avatar's skeleton description (upper arms rotated level), so
        /// Humanoid muscles and retargeted clips use the right zero. Keyed by the FBX's content hash: a new export is configured again.
        /// </summary>
        static void ConfigureTPose(string fbxPath)
        {
            var mi = AssetImporter.GetAtPath(fbxPath) as ModelImporter;
            if (mi == null) { Debug.LogError("CharacterImport: " + fbxPath + " not imported"); return; }
            string tag = "tpose-v4:" + Hash128.Compute(File.ReadAllBytes(fbxPath)).ToString();
            if (mi.userData == tag) return;
            var hd = mi.humanDescription;
            var go = AssetDatabase.LoadAssetAtPath<GameObject>(fbxPath);
            var inst = Object.Instantiate(go);
            try
            {
                var all = inst.GetComponentsInChildren<Transform>(true);
                Transform Find(string n) => all.FirstOrDefault(t => t.name == n);
                var skel = hd.skeleton;
                if (skel == null || skel.Length == 0) { Debug.LogError("CharacterImport: empty skeleton description"); return; }
                int changed = 0;
                foreach (var side in new[] { "Left", "Right" })
                {
                    var upper = Find(side + "UpperArm"); var lower = Find(side + "LowerArm");
                    if (upper == null || lower == null) continue;
                    Vector3 d = (lower.position - upper.position).normalized;
                    Vector3 target = d.x < 0 ? Vector3.left : Vector3.right;
                    var delta = Quaternion.FromToRotation(d, target);
                    var local = Quaternion.Inverse(upper.parent.rotation) * (delta * upper.rotation);
                    for (int i = 0; i < skel.Length; i++)
                        if (skel[i].name == upper.name) { skel[i].rotation = local; changed++; }
                    Debug.Log("CharacterImport: " + side + " arm direction " + d.ToString("F2") + " -> " + target);
                }
                hd.skeleton = skel;
                // The shared KayKit clips were made for chunky bodies and hold the arms about 40 degrees out from the sides. On our slender
                // bodies that reads as a scarecrow, so the "Arm Down-Up" muscle range is widened downwards (-60 -> ArmDownMin degrees):
                // the same muscle value then hangs the arms naturally, and every pose keeps its shape.
                var human = hd.human;
                for (int i = 0; i < human.Length; i++)
                {
                    if (human[i].humanName != "LeftUpperArm" && human[i].humanName != "RightUpperArm") continue;
                    var lim = human[i].limit;
                    lim.useDefaultValues = false;
                    lim.min = new Vector3(-90f, -100f, ArmDownMin);
                    lim.max = new Vector3(90f, 100f, 100f);
                    lim.center = Vector3.zero;
                    human[i].limit = lim;
                }
                hd.human = human;
                mi.humanDescription = hd;
                mi.userData = tag;
                mi.SaveAndReimport();
                Debug.Log("CharacterImport: T-pose reference written for " + changed + " arm bones.");
            }
            finally { Object.DestroyImmediate(inst); }
        }

        static GameObject BuildRigPrefab(Avatar avatar)
        {
            var go = AssetDatabase.LoadAssetAtPath<GameObject>(BasePath);
            var inst = (GameObject)PrefabUtility.InstantiatePrefab(go);
            try
            {
                PrefabUtility.UnpackPrefabInstance(inst, PrefabUnpackMode.Completely, InteractionMode.AutomatedAction);
                inst.name = "PersonRig";
                // Keep only the bone hierarchy: drop every renderer object and the socket empties.
                foreach (var smr in inst.GetComponentsInChildren<SkinnedMeshRenderer>(true).ToArray()) Object.DestroyImmediate(smr.gameObject);
                foreach (var mr in inst.GetComponentsInChildren<MeshRenderer>(true).ToArray()) Object.DestroyImmediate(mr.gameObject);
                foreach (var t in inst.GetComponentsInChildren<Transform>(true).ToArray())
                    if (t != null && t.name.StartsWith("Socket_")) Object.DestroyImmediate(t.gameObject);
                var anim = inst.GetComponent<Animator>();
                if (anim == null) anim = inst.AddComponent<Animator>();
                anim.avatar = avatar;
                anim.applyRootMotion = false;
                anim.cullingMode = AnimatorCullingMode.CullUpdateTransforms;
                string path = PeopleGen + "/PersonRig.prefab";
                var prefab = PrefabUtility.SaveAsPrefabAsset(inst, path);
                return prefab;
            }
            finally { Object.DestroyImmediate(inst); }
        }

        // ------------------------------------------------------------------ cloth detail array

        public static readonly string[] DetailNames = { "detail_weave", "detail_quilt", "trim_stitch", "detail_leather", "detail_metal", "detail_stripes", "detail_plaid", "detail_cord" };

        static Texture2DArray BuildDetailArray()
        {
            const int size = 512;
            var arr = new Texture2DArray(size, size, DetailNames.Length, TextureFormat.RGBA32, true, false) { name = "ClothDetail", wrapMode = TextureWrapMode.Repeat, filterMode = FilterMode.Bilinear, anisoLevel = 2 };
            for (int i = 0; i < DetailNames.Length; i++)
            {
                var t = AssetDatabase.LoadAssetAtPath<Texture2D>(PeopleDir + "Clothes/textures/" + DetailNames[i] + ".png");
                if (t == null) { Debug.LogWarning("CharacterImport: missing detail texture " + DetailNames[i]); continue; }
                Color32[] px;
                if (t.width == size && t.height == size) px = t.GetPixels32();
                else
                {
                    // resample (bilinear, wrapping) to the array's size: the tiling is in metres, so a smaller source just repeats finer detail
                    px = new Color32[size * size];
                    for (int y = 0; y < size; y++)
                        for (int x = 0; x < size; x++) px[y * size + x] = t.GetPixelBilinear((x + 0.5f) / size, (y + 0.5f) / size);
                }
                var tmp = new Texture2D(size, size, TextureFormat.RGBA32, true, true);
                tmp.SetPixels32(px); tmp.Apply(true);
                for (int m = 0; m < tmp.mipmapCount; m++) Graphics.CopyTexture(tmp, 0, m, arr, i, m);
                Object.DestroyImmediate(tmp);
            }
            string path = PeopleGen + "/ClothDetail.asset";
            AssetDatabase.DeleteAsset(path);
            AssetDatabase.CreateAsset(arr, path);
            return AssetDatabase.LoadAssetAtPath<Texture2DArray>(path);
        }

        static Material SharedMaterial(string path, bool cloth, Texture2DArray arr)
        {
            var m = AssetDatabase.LoadAssetAtPath<Material>(path);
            var shader = Shader.Find("GardenOfEden/Character");
            if (shader == null) { Debug.LogError("CharacterImport: shader GardenOfEden/Character not found"); return m; }
            if (m == null) { m = new Material(shader); AssetDatabase.CreateAsset(m, path); }
            m.shader = shader;
            m.SetFloat("_Cloth", cloth ? 1f : 0f);
            ApplyLook(m, cloth ? 1 : 0);
            if (arr != null) m.SetTexture("_DetailArray", arr);
            m.enableInstancing = false;
            EditorUtility.SetDirty(m);
            return m;
        }

        // ------------------------------------------------------------------ creatures

        static void BuildCreatures(CharacterKit kit, AnimatorController peopleCtrl)
        {
            foreach (var f in Directory.GetFiles(CreatureDir, "*.fbx").OrderBy(x => x))
            {
                string path = f.Replace('\\', '/');
                string id = Path.GetFileNameWithoutExtension(path);
                bool humanoid = CharacterImportPostprocessor.IsHumanoidMonster(path);
                try
                {
                    var body = humanoid ? BuildMonster(path, id, peopleCtrl, kit) : BuildAnimal(path, id);
                    if (body != null) kit.creatures.Add(body);
                }
                catch (Exception e) { Debug.LogError("CharacterImport: " + id + ": " + e); }
            }
        }

        static Material CreatureMaterial(string id, Material src, Texture atlas)
        {
            string slot = src != null ? src.name : "Material";
            string path = CreatureGen + "/Materials/" + id + "." + slot.Replace('/', '_') + ".mat";
            var shader = Shader.Find("GardenOfEden/Character");
            var m = AssetDatabase.LoadAssetAtPath<Material>(path);
            if (m == null) { m = new Material(shader); AssetDatabase.CreateAsset(m, path); }
            m.shader = shader;
            Color c = src != null && src.HasProperty("_BaseColor") ? src.GetColor("_BaseColor") : Color.white;
            if (atlas != null) c = Color.white;
            m.SetColor("_BaseColor", new Color(c.r, c.g, c.b, 1f));
            m.SetTexture("_BaseMap", atlas);
            m.SetFloat("_Cloth", 0f);
            m.SetFloat("_PlainBody", 0f);
            m.SetFloat("_UseVertexColor", 0f);
            m.enableInstancing = false;
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
            if (first) foreach (var mr in go.GetComponentsInChildren<MeshRenderer>()) { if (first) { b = mr.bounds; first = false; } else b.Encapsulate(mr.bounds); }
            return b;
        }

        static GameObject PrepareCreature(string path, string id, Texture atlas, out Avatar avatar, out Bounds bounds)
        {
            var fbx = AssetDatabase.LoadAssetAtPath<GameObject>(path);
            avatar = AssetDatabase.LoadAllAssetsAtPath(path).OfType<Avatar>().FirstOrDefault();
            var root = new GameObject(id);
            var model = Object.Instantiate(fbx, root.transform);
            model.name = "Model";
            foreach (var r in model.GetComponentsInChildren<Renderer>(true))
            {
                var src = r.sharedMaterials;
                var mats = new Material[src.Length];
                for (int i = 0; i < src.Length; i++) mats[i] = CreatureMaterial(id, src[i], atlas);
                r.sharedMaterials = mats;
                r.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.On;
                var smr = r as SkinnedMeshRenderer;
                if (smr != null) smr.updateWhenOffscreen = false;
            }
            bounds = BodyBounds(model);
            // feet on y = 0
            model.transform.localPosition = new Vector3(0, -bounds.min.y, 0);
            bounds = BodyBounds(model);
            return root;
        }

        static CharacterBody BuildAnimal(string path, string id)
        {
            var root = PrepareCreature(path, id, null, out var avatar, out var bounds);
            try
            {
                if (avatar == null || !avatar.isValid) { Debug.LogWarning("CharacterImport: no valid avatar for " + id); }
                var fam = AnimalFamily(id, path);
                var ctrlPath = CreatureGen + "/Controllers/" + id + ".controller";
                var ctrl = CharacterSetup.BuildControllerAt(fam, ctrlPath);
                var model = root.transform.Find("Model").gameObject;
                var anim = model.GetComponent<Animator>() ?? model.AddComponent<Animator>();
                anim.avatar = avatar;
                anim.runtimeAnimatorController = ctrl;
                anim.applyRootMotion = false;
                anim.cullingMode = AnimatorCullingMode.CullUpdateTransforms;
                var body = new CharacterBody { id = id, kind = BodyKind.Animal, height = bounds.size.y, radius = Mathf.Clamp(Mathf.Max(bounds.extents.x, bounds.extents.z) * 0.7f, 0.15f, 1.2f) };
                CharacterSetup.MeasureAnimal(model, anim, fam, body);
                CharacterSetup.ApplyThresholds(ctrl, body, fam);
                body.prefab = PrefabUtility.SaveAsPrefabAsset(root, CreatureGen + "/Prefabs/" + id + ".prefab");
                Debug.Log("CharacterImport: animal " + id + " h=" + body.height.ToString("0.00") + " walk=" + body.walkSpeed.ToString("0.00") + " run=" + body.runSpeed.ToString("0.00") + " clips=" + string.Join(",", AssetDatabase.LoadAllAssetsAtPath(path).OfType<AnimationClip>().Where(c => !c.name.StartsWith("__preview__")).Select(c => c.name)));
                return body;
            }
            finally { Object.DestroyImmediate(root); }
        }

        static CharacterSetup.Family AnimalFamily(string id, string fbx)
        {
            string[] Has(params string[] names) => names;
            var f = new CharacterSetup.Family
            {
                key = id, clipsFrom = fbx, humanoid = false, kind = BodyKind.Animal,
                idle = Has("idle"), walk = Has("walk", "slither"), run = Has("run", "slither", "walk"), dead = Has("death"),
                hit = Has("hitreact_l", "hit"), attack = Has("attack", "strike"), attackArmed = Has("attack", "strike"), talk = Has("eat"),
            };
            if (id == "crow" || id == "heron") { f.run = Has("walk"); f.talk = Has("peck"); }
            if (id == "adder") { f.idle = Has("idle"); f.walk = Has("slither"); f.run = Has("slither"); f.talk = null; }
            if (id == "spider") { f.hit = Has("hit", "jump"); f.talk = null; }
            return f;
        }

        static CharacterBody BuildMonster(string path, string id, AnimatorController peopleCtrl, CharacterKit kit)
        {
            ConfigureTPose(path);
            Texture2D atlas = AssetDatabase.LoadAssetAtPath<Texture2D>(CreatureDir + "textures/" + id + "_atlas.png");
            var root = PrepareCreature(path, id, atlas, out var avatar, out var bounds);
            try
            {
                if (avatar == null || !avatar.isValid || !avatar.isHuman) { Debug.LogWarning("CharacterImport: " + id + " has no valid humanoid avatar (valid=" + (avatar != null && avatar.isValid) + ")"); }
                var model = root.transform.Find("Model").gameObject;
                var anim = model.GetComponent<Animator>() ?? model.AddComponent<Animator>();
                anim.avatar = avatar;
                anim.runtimeAnimatorController = peopleCtrl;
                anim.applyRootMotion = false;
                anim.cullingMode = AnimatorCullingMode.CullUpdateTransforms;
                var layers = model.AddComponent<CreatureLayers>();
                var body = new CharacterBody { id = id, kind = BodyKind.Person, height = bounds.size.y, radius = Mathf.Clamp(bounds.extents.x * 0.9f, 0.25f, 1.2f), walkSpeed = kit.walkSpeed, runSpeed = kit.runSpeed, armed = false };
                body.bodyScale = body.height / 1.75f;
                body.prefab = PrefabUtility.SaveAsPrefabAsset(root, CreatureGen + "/Prefabs/" + id + ".prefab");
                Debug.Log("CharacterImport: monster " + id + " h=" + body.height.ToString("0.00") + " humanoid=" + (avatar != null && avatar.isHuman));
                return body;
            }
            finally { Object.DestroyImmediate(root); }
        }
    }
}
