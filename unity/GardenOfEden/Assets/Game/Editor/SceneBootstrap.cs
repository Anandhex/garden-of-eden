using System.Collections.Generic;
using System.IO;
using GardenOfEden.Look;
using GardenOfEden.Net;
using GardenOfEden.Play;
using GardenOfEden.World;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;
using UnityEngine.SceneManagement;
using Light = UnityEngine.Light;

namespace GardenOfEden.EditorTools
{
    /// <summary>Builds Assets/Game/Scenes/Main.unity and the assets it needs. Idempotent: run it again any time.</summary>
    public static class SceneBootstrap
    {
        const string ScenePath = "Assets/Game/Scenes/Main.unity";
        const string MatDir = "Assets/Game/Look/Materials";
        const string ProfilePath = "Assets/Game/Look/GardenOfEdenVolume.asset";

        [MenuItem("Garden of Eden/Build Main Scene")]
        public static void Build()
        {
            Directory.CreateDirectory("Assets/Game/Scenes");
            Directory.CreateDirectory(MatDir);
            AssetDatabase.Refresh();

            EnsureLayers();
            ConfigureUrp();
            var ground = MakeMat("ToonLit", "GardenOfEden/ToonLit", m => { ResetToDefaults(m); m.SetColor("_BaseColor", Color.white); Mats.SoftLook(m); });
            var water = MakeMat("ToonWater", "GardenOfEden/ToonWater", null);
            var grass = MakeMat("ToonGrass", "GardenOfEden/ToonGrass", m => { m.enableInstancing = true; ResetToDefaults(m); });
            grass.enableInstancing = true;
            EditorUtility.SetDirty(grass);
            var sky = MakeMat("StylisedSky", "GardenOfEden/StylisedSky", null);
            var weather = WeatherMaterial();
            AssetDatabase.SaveAssets();

            var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);

            var client = new GameObject("GameClient").AddComponent<GameClient>();
            client.host = "localhost"; client.port = 3000;
            client.viewW = 64; client.viewH = 44;   // land and relief out to the horizon ring: ask the server for a wide view

            var wind = new GameObject("Wind").AddComponent<Wind>();

            var sunGo = new GameObject("Sun");
            sunGo.transform.rotation = Quaternion.Euler(50, -30, 0);
            var sun = sunGo.AddComponent<Light>();
            sun.type = LightType.Directional; sun.shadows = LightShadows.Soft; sun.intensity = 1.2f;
            sunGo.AddComponent<UniversalAdditionalLightData>();
            RenderSettings.sun = sun;

            var dn = new GameObject("DayNight").AddComponent<DayNight>();
            dn.sun = sun; dn.wind = wind; dn.skyMaterial = sky; dn.weatherMaterial = weather;
            RenderSettings.skybox = sky;
            RenderSettings.ambientMode = AmbientMode.Skybox;

            var grassField = new GameObject("GrassField").AddComponent<GrassField>();
            grassField.material = grass;

            var wv = new GameObject("WorldView").AddComponent<WorldView>();
            wv.client = client; wv.dayNight = dn; wv.grass = grassField;

            var camGo = new GameObject("Main Camera") { tag = "MainCamera" };
            var cam = camGo.AddComponent<Camera>();
            cam.clearFlags = CameraClearFlags.Skybox; cam.nearClipPlane = 0.1f; cam.farClipPlane = 3200f;
            camGo.AddComponent<AudioListener>();
            var uacd = camGo.AddComponent<UniversalAdditionalCameraData>();
            uacd.renderPostProcessing = true; uacd.antialiasing = AntialiasingMode.None;
            var rig = camGo.AddComponent<CameraRig>();
            rig.world = wv; rig.cam = cam;

            var occ = camGo.AddComponent<Occlusion>();
            occ.world = wv; occ.cam = cam;

            var hudGo = new GameObject("Hud");
            var hud = hudGo.AddComponent<Hud>();
            hud.client = client; hud.world = wv; hud.cam = cam;

            var pcGo = new GameObject("PlayerControl");
            var pc = pcGo.AddComponent<PlayerControl>();
            pc.client = client; pc.world = wv; pc.cameraRig = rig; pc.hud = hud; pc.cam = cam;

            var volGo = new GameObject("Global Volume");
            var vol = volGo.AddComponent<Volume>();
            vol.isGlobal = true; vol.priority = 1;
            vol.sharedProfile = BuildProfile();

            EditorSceneManager.SaveScene(scene, ScenePath);
            EditorBuildSettings.scenes = new[] { new EditorBuildSettingsScene(ScenePath, true) };
            AssetDatabase.SaveAssets();
            Debug.Log("[Bootstrap] Built " + ScenePath + " and materials in " + MatDir + ". Build settings now list only Main.");
        }

        static Material MakeMat(string name, string shaderName, System.Action<Material> init)
        {
            var path = MatDir + "/" + name + ".mat";
            var shader = Shader.Find(shaderName);
            if (shader == null) { Debug.LogError("[Bootstrap] shader not found: " + shaderName); return null; }
            var m = AssetDatabase.LoadAssetAtPath<Material>(path);
            if (m == null) { m = new Material(shader); AssetDatabase.CreateAsset(m, path); }
            else m.shader = shader;
            init?.Invoke(m);
            EditorUtility.SetDirty(m);
            return m;
        }

        /// <summary>Put every property of a material back to its shader's default (so a changed look reaches existing material assets).</summary>
        static void ResetToDefaults(Material m)
        {
            var sh = m.shader;
            for (int i = 0; i < sh.GetPropertyCount(); i++)
            {
                string n = sh.GetPropertyName(i);
                switch (sh.GetPropertyType(i))
                {
                    case UnityEngine.Rendering.ShaderPropertyType.Float:
                    case UnityEngine.Rendering.ShaderPropertyType.Range: m.SetFloat(n, sh.GetPropertyDefaultFloatValue(i)); break;
                    case UnityEngine.Rendering.ShaderPropertyType.Color: m.SetColor(n, sh.GetPropertyDefaultVectorValue(i)); break;
                    case UnityEngine.Rendering.ShaderPropertyType.Vector: m.SetVector(n, sh.GetPropertyDefaultVectorValue(i)); break;
                }
            }
        }

        static VolumeProfile BuildProfile()
        {
            var p = AssetDatabase.LoadAssetAtPath<VolumeProfile>(ProfilePath);
            if (p == null) { p = ScriptableObject.CreateInstance<VolumeProfile>(); AssetDatabase.CreateAsset(p, ProfilePath); }
            p.components.Clear();
            var tm = p.Add<Tonemapping>(true); tm.mode.Override(TonemappingMode.Neutral);
            var bl = p.Add<Bloom>(true);
            bl.threshold.Override(1f); bl.intensity.Override(0.25f); bl.scatter.Override(0.65f); bl.tint.Override(new Color(1f, 0.95f, 0.88f));
            var ca = p.Add<ColorAdjustments>(true);
            ca.postExposure.Override(0.05f); ca.contrast.Override(12f); ca.saturation.Override(2f); ca.colorFilter.Override(Color.white);
            // The G8 grade: a touch warm, lavender shadows, warm highlights (soft film look, not neon greens).
            var wb = p.Add<WhiteBalance>(true); wb.temperature.Override(6f); wb.tint.Override(2f);
            var smh = p.Add<ShadowsMidtonesHighlights>(true);
            smh.shadows.Override(new Vector4(0.96f, 0.95f, 1.06f, -0.02f));
            smh.midtones.Override(new Vector4(1.0f, 0.99f, 0.97f, 0f));
            smh.highlights.Override(new Vector4(1.04f, 1.01f, 0.95f, 0f));
            var vg = p.Add<Vignette>(true); vg.intensity.Override(0.18f); vg.smoothness.Override(0.4f);
            foreach (var c in p.components) { c.hideFlags = HideFlags.HideInInspector | HideFlags.HideInHierarchy; AssetDatabase.AddObjectToAsset(c, p); }
            EditorUtility.SetDirty(p);
            return p;
        }

        static void ConfigureUrp()
        {
            var assets = new HashSet<UniversalRenderPipelineAsset>();
            if (GraphicsSettings.defaultRenderPipeline is UniversalRenderPipelineAsset d) assets.Add(d);
            for (int i = 0; i < QualitySettings.names.Length; i++)
                if (QualitySettings.GetRenderPipelineAssetAt(i) is UniversalRenderPipelineAsset a) assets.Add(a);
            foreach (var a in assets) ConfigureAsset(a);
        }

        static void ConfigureAsset(UniversalRenderPipelineAsset a)
        {
            var so = new SerializedObject(a);
            void SetInt(string n, int v) { var p = so.FindProperty(n); if (p != null) p.intValue = v; else Debug.LogWarning("[Bootstrap] missing URP property " + n); }
            void SetFloat(string n, float v) { var p = so.FindProperty(n); if (p != null) p.floatValue = v; else Debug.LogWarning("[Bootstrap] missing URP property " + n); }
            void SetBool(string n, bool v) { var p = so.FindProperty(n); if (p != null) p.boolValue = v; else Debug.LogWarning("[Bootstrap] missing URP property " + n); }
            SetBool("m_RequireDepthTexture", true);
            SetBool("m_RequireOpaqueTexture", false);
            SetBool("m_SupportsHDR", true);
            SetFloat("m_RenderScale", 1f);
            SetInt("m_MSAA", 2);
            SetInt("m_MainLightRenderingMode", 1);
            SetBool("m_MainLightShadowsSupported", true);
            SetInt("m_MainLightShadowmapResolution", 2048);
            SetInt("m_AdditionalLightsRenderingMode", 1);
            SetBool("m_AdditionalLightShadowsSupported", false);
            SetFloat("m_ShadowDistance", 70f);
            SetInt("m_ShadowCascadeCount", 3);
            SetFloat("m_ShadowDepthBias", 1f);
            SetFloat("m_ShadowNormalBias", 0.6f);
            SetBool("m_SoftShadowsSupported", true);
            SetInt("m_SoftShadowQuality", 2);
            SetBool("m_UseSRPBatcher", true);
            SetBool("m_SupportsDynamicBatching", false);
            so.ApplyModifiedPropertiesWithoutUndo();
            // Cascade 3 splits (x,y) as fractions; property type is Vector2.
            var c3 = so.FindProperty("m_Cascade3Split");
            if (c3 != null && c3.propertyType == SerializedPropertyType.Vector2) { c3.vector2Value = new Vector2(0.08f, 0.22f); so.ApplyModifiedPropertiesWithoutUndo(); }

            // The player-behind-walls silhouette (Render Objects feature on every renderer).
            // Forward+ on every renderer.
            var list = so.FindProperty("m_RendererDataList");
            for (int i = 0; list != null && i < list.arraySize; i++)
            {
                var rd = list.GetArrayElementAtIndex(i).objectReferenceValue as UniversalRendererData;
                if (rd == null) continue;
                rd.renderingMode = RenderingMode.ForwardPlus;
                EnsureSilhouette(rd);
                EnsureSsao(rd);
                EditorUtility.SetDirty(rd);
            }
            EditorUtility.SetDirty(a);
            Debug.Log("[Bootstrap] configured URP asset " + AssetDatabase.GetAssetPath(a));
        }

        /// <summary>Adds the "Building" and "Player" layers (first free user layers) when missing.</summary>
        public static void EnsureLayers()
        {
            var tm = new SerializedObject(AssetDatabase.LoadAllAssetsAtPath("ProjectSettings/TagManager.asset")[0]);
            var layers = tm.FindProperty("layers");
            foreach (var name in new[] { WorldLayers.BuildingName, WorldLayers.PlayerName })
            {
                bool have = false; int free = -1;
                for (int i = 8; i < layers.arraySize; i++)
                {
                    var v = layers.GetArrayElementAtIndex(i).stringValue;
                    if (v == name) { have = true; break; }
                    if (string.IsNullOrEmpty(v) && free < 0) free = i;
                }
                if (!have && free >= 0) layers.GetArrayElementAtIndex(free).stringValue = name;
            }
            tm.ApplyModifiedPropertiesWithoutUndo();
            AssetDatabase.SaveAssets();
        }

        /// <summary>Screen-space ambient occlusion (soft contact darkening under eaves, round trunks, at wall feet). ToonLit reads it.</summary>
        static void EnsureSsao(UniversalRendererData rd)
        {
            var type = typeof(UniversalRendererData).Assembly.GetType("UnityEngine.Rendering.Universal.ScreenSpaceAmbientOcclusion");
            if (type == null) { Debug.LogWarning("[Bootstrap] SSAO feature type not found"); return; }
            ScriptableRendererFeature feat = null;
            foreach (var f in rd.rendererFeatures) if (f != null && f.GetType() == type) feat = f;
            if (feat == null)
            {
                feat = (ScriptableRendererFeature)ScriptableObject.CreateInstance(type);
                feat.name = "SSAO";
                AssetDatabase.AddObjectToAsset(feat, rd);
                var rso = new SerializedObject(rd);
                var feats = rso.FindProperty("m_RendererFeatures");
                feats.arraySize++;
                feats.GetArrayElementAtIndex(feats.arraySize - 1).objectReferenceValue = feat;
                var map = rso.FindProperty("m_RendererFeatureMap");
                map.arraySize++;
                AssetDatabase.TryGetGUIDAndLocalFileIdentifier(feat, out _, out long fileId);
                map.GetArrayElementAtIndex(map.arraySize - 1).longValue = fileId;
                rso.ApplyModifiedPropertiesWithoutUndo();
                Debug.Log("[Bootstrap] added SSAO feature to " + rd.name);
            }
            var so = new SerializedObject(feat);
            var st = so.FindProperty("m_Settings");
            void F(string n, float v) { var q = st?.FindPropertyRelative(n); if (q != null) q.floatValue = v; }
            void B(string n, bool v) { var q = st?.FindPropertyRelative(n); if (q != null) q.boolValue = v; }
            void E(string n, int v) { var q = st?.FindPropertyRelative(n); if (q != null) q.enumValueIndex = v; }
            F("Intensity", 1.1f); F("Radius", 0.55f); F("DirectLightingStrength", 0.3f); F("Falloff", 70f);
            B("Downsample", true); B("AfterOpaque", false);
            E("Source", 1);          // depth normals (ToonLit has a DepthNormals pass)
            E("NormalSamples", 1);   // medium
            E("Samples", 2);         // low sample count: the M2 budget
            E("BlurQuality", 1);     // medium
            so.ApplyModifiedPropertiesWithoutUndo();
            EditorUtility.SetDirty(feat);
            EditorUtility.SetDirty(rd);
            AssetDatabase.SaveAssets();
        }

        /// <summary>The rain/snow particle material (an asset, so the URP particle shader is kept in builds).</summary>
        static Material WeatherMaterial() => MakeMat("Weather", "Universal Render Pipeline/Particles/Unlit", m =>
        {
            m.SetFloat("_Surface", 1f); m.SetFloat("_Blend", 0f);
            m.SetOverrideTag("RenderType", "Transparent");
            m.SetInt("_SrcBlend", (int)BlendMode.SrcAlpha); m.SetInt("_DstBlend", (int)BlendMode.OneMinusSrcAlpha); m.SetInt("_ZWrite", 0);
            m.EnableKeyword("_SURFACE_TYPE_TRANSPARENT");
            m.renderQueue = (int)RenderQueue.Transparent;
        });

        /// <summary>Puts this pass's look values into the open Main scene (weather material, night light, camera start) and saves it.</summary>
        [MenuItem("Garden of Eden/Update Main Scene Look")]
        public static void UpdateSceneLook()
        {
            var scene = EditorSceneManager.OpenScene(ScenePath);
            var dn = Object.FindFirstObjectByType<DayNight>();
            if (dn != null)
            {
                dn.weatherMaterial = WeatherMaterial();
                dn.moonIntensity = 0.3f;
                dn.nightAmbientSky = new Color(0.12f, 0.15f, 0.30f);
                dn.nightAmbientEquator = new Color(0.09f, 0.11f, 0.22f);
                EditorUtility.SetDirty(dn);
            }
            var rig = Object.FindFirstObjectByType<CameraRig>();
            if (rig != null) { rig.startZoom = 0.2f; EditorUtility.SetDirty(rig); }
            EditorSceneManager.MarkSceneDirty(scene);
            EditorSceneManager.SaveScene(scene);
            AssetDatabase.SaveAssets();
        }

        /// <summary>Re-applies the URP settings and the post profile without rebuilding the scene.</summary>
        [MenuItem("Garden of Eden/Apply World Look")]
        public static void ApplyLook()
        {
            ConfigureUrp();
            BuildProfile();
            var ground = MakeMat("ToonLit", "GardenOfEden/ToonLit", m => { ResetToDefaults(m); m.SetColor("_BaseColor", Color.white); Mats.SoftLook(m); });
            AssetDatabase.SaveAssets();
        }

        static void EnsureSilhouette(UniversalRendererData rd)
        {
            foreach (var f in rd.rendererFeatures) if (f != null && f.name == "PlayerSilhouette") return;
            var shader = Shader.Find("GardenOfEden/PlayerSilhouette");
            if (shader == null) { Debug.LogError("[Bootstrap] PlayerSilhouette shader missing"); return; }
            var mat = MakeMat("PlayerSilhouette", "GardenOfEden/PlayerSilhouette", null);
            var ro = ScriptableObject.CreateInstance<RenderObjects>();
            ro.name = "PlayerSilhouette";
            var s = ro.settings;
            s.passTag = "PlayerSilhouette";
            s.Event = RenderPassEvent.AfterRenderingTransparents;
            s.filterSettings.RenderQueueType = RenderQueueType.Opaque;
            s.filterSettings.LayerMask = WorldLayers.PlayerMask;
            s.overrideMaterial = mat;
            s.overrideMaterialPassIndex = 0;
            s.overrideDepthState = true;
            s.depthCompareFunction = CompareFunction.Greater;
            s.enableWrite = false;
            AssetDatabase.AddObjectToAsset(ro, rd);
            var so = new SerializedObject(rd);
            var feats = so.FindProperty("m_RendererFeatures");
            feats.arraySize++;
            feats.GetArrayElementAtIndex(feats.arraySize - 1).objectReferenceValue = ro;
            var map = so.FindProperty("m_RendererFeatureMap");
            map.arraySize++;
            AssetDatabase.TryGetGUIDAndLocalFileIdentifier(ro, out _, out long fileId);
            map.GetArrayElementAtIndex(map.arraySize - 1).longValue = fileId;
            so.ApplyModifiedPropertiesWithoutUndo();
            EditorUtility.SetDirty(rd);
            AssetDatabase.SaveAssets();
            Debug.Log("[Bootstrap] added PlayerSilhouette feature to " + rd.name);
        }

        /// <summary>Compiles (and reports on) every GardenOfEden shader. Fails the batch run if any has errors.</summary>
        [MenuItem("Garden of Eden/Check Shaders")]
        public static void CheckShaders()
        {
            int bad = 0;
            foreach (var guid in AssetDatabase.FindAssets("t:Shader", new[] { "Assets/Game" }))
            {
                var path = AssetDatabase.GUIDToAssetPath(guid);
                var shader = AssetDatabase.LoadAssetAtPath<Shader>(path);
                if (shader == null) continue;
                ShaderUtil.RegisterShader(shader);
                var msgs = ShaderUtil.GetShaderMessages(shader);
                bool err = ShaderUtil.ShaderHasError(shader);
                Debug.Log("[ShaderCheck] " + shader.name + " supported=" + shader.isSupported + " hasError=" + err + " messages=" + msgs.Length);
                foreach (var m in msgs)
                    Debug.Log("[ShaderCheck]   " + m.severity + " " + m.file + ":" + m.line + " (" + m.platform + ") " + m.message + " " + m.messageDetails);
                if (err) bad++;
            }
            Debug.Log("[ShaderCheck] shaders with errors: " + bad);
        }

        public static void BuildAndCheck() { CheckShaders(); Build(); CheckShaders(); }
    }
}
