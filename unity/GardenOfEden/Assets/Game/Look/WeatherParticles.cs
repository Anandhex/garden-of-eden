using UnityEngine;

namespace GardenOfEden.Look
{
    /// <summary>
    /// Rain and snow made in code when the scene has none: two particle systems that ride with the camera (world-space
    /// particles, so walking does not drag them), soft round sprites, pale and thin so they read as weather, not as a
    /// screen effect. DayNight sets their emission from the weather (<c>Emit</c>). Cheap: a few thousand particles at most.
    /// </summary>
    public static class WeatherParticles
    {
        static Texture2D dot;

        static Texture2D Dot()
        {
            if (dot != null) return dot;
            const int n = 32;
            dot = new Texture2D(n, n, TextureFormat.RGBA32, false) { name = "weather dot", wrapMode = TextureWrapMode.Clamp, hideFlags = HideFlags.DontSave };
            var px = new Color32[n * n];
            for (int y = 0; y < n; y++)
                for (int x = 0; x < n; x++)
                {
                    float dx = (x + 0.5f) / n * 2f - 1f, dy = (y + 0.5f) / n * 2f - 1f;
                    float a = Mathf.Clamp01(1f - Mathf.Sqrt(dx * dx + dy * dy));
                    a = a * a * (3f - 2f * a);
                    px[y * n + x] = new Color32(255, 255, 255, (byte)(a * 255));
                }
            dot.SetPixels32(px);
            dot.Apply();
            return dot;
        }

        static Material Mat(Material given, Color tint)
        {
            var m = given != null ? new Material(given) : null;
            if (m == null)
            {
                var sh = Shader.Find("Universal Render Pipeline/Particles/Unlit");
                if (sh == null) return null;
                m = new Material(sh);
                m.SetFloat("_Surface", 1f);
                m.SetFloat("_Blend", 0f);
                m.SetOverrideTag("RenderType", "Transparent");
                m.SetInt("_SrcBlend", (int)UnityEngine.Rendering.BlendMode.SrcAlpha);
                m.SetInt("_DstBlend", (int)UnityEngine.Rendering.BlendMode.OneMinusSrcAlpha);
                m.SetInt("_ZWrite", 0);
                m.EnableKeyword("_SURFACE_TYPE_TRANSPARENT");
                m.renderQueue = (int)UnityEngine.Rendering.RenderQueue.Transparent;
            }
            m.name = "weather " + (tint.b > 0.99f ? "snow" : "rain");
            m.mainTexture = Dot();
            if (m.HasProperty("_BaseMap")) m.SetTexture("_BaseMap", Dot());
            if (m.HasProperty("_BaseColor")) m.SetColor("_BaseColor", tint);
            return m;
        }

        /// <summary>Make the rain system under <paramref name="parent"/> (the camera).</summary>
        public static ParticleSystem MakeRain(Transform parent, Material material)
        {
            var go = new GameObject("Rain");
            go.transform.SetParent(parent, false);
            go.transform.localPosition = new Vector3(0f, 14f, 8f);
            var ps = go.AddComponent<ParticleSystem>();
            ps.Stop(true, ParticleSystemStopBehavior.StopEmittingAndClear);
            var main = ps.main;
            main.loop = true;
            main.playOnAwake = false;
            main.startLifetime = 1.3f;
            main.startSpeed = 0f;
            main.startSize = new ParticleSystem.MinMaxCurve(0.035f, 0.05f);
            main.startColor = new Color(0.78f, 0.84f, 0.95f, 0.42f);
            main.simulationSpace = ParticleSystemSimulationSpace.World;
            main.maxParticles = 5000;
            var vel = ps.velocityOverLifetime;
            vel.enabled = true;
            vel.space = ParticleSystemSimulationSpace.World;
            vel.x = new ParticleSystem.MinMaxCurve(-1.2f, -0.6f);
            vel.y = new ParticleSystem.MinMaxCurve(-17f, -14f);
            vel.z = new ParticleSystem.MinMaxCurve(-0.4f, 0.4f);
            var shape = ps.shape;
            shape.shapeType = ParticleSystemShapeType.Box;
            shape.scale = new Vector3(44f, 1f, 44f);
            var em = ps.emission; em.rateOverTime = 0f;
            var r = go.GetComponent<ParticleSystemRenderer>();
            r.renderMode = ParticleSystemRenderMode.Stretch;
            r.velocityScale = 0.045f;
            r.lengthScale = 1f;
            r.sharedMaterial = Mat(material, new Color(0.85f, 0.9f, 1f, 0.5f));
            r.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            r.receiveShadows = false;
            return ps;
        }

        /// <summary>Make the snow system under <paramref name="parent"/> (the camera).</summary>
        public static ParticleSystem MakeSnow(Transform parent, Material material)
        {
            var go = new GameObject("Snow");
            go.transform.SetParent(parent, false);
            go.transform.localPosition = new Vector3(0f, 10f, 6f);
            var ps = go.AddComponent<ParticleSystem>();
            ps.Stop(true, ParticleSystemStopBehavior.StopEmittingAndClear);
            var main = ps.main;
            main.loop = true;
            main.playOnAwake = false;
            main.startLifetime = 9f;
            main.startSpeed = 0f;
            main.startSize = new ParticleSystem.MinMaxCurve(0.06f, 0.12f);
            main.startColor = new Color(1f, 1f, 1f, 0.9f);
            main.simulationSpace = ParticleSystemSimulationSpace.World;
            main.maxParticles = 6000;
            var vel = ps.velocityOverLifetime;
            vel.enabled = true;
            vel.space = ParticleSystemSimulationSpace.World;
            vel.x = new ParticleSystem.MinMaxCurve(-0.5f, 0.3f);
            vel.y = new ParticleSystem.MinMaxCurve(-1.6f, -1.0f);
            vel.z = new ParticleSystem.MinMaxCurve(-0.3f, 0.3f);
            var noise = ps.noise;
            noise.enabled = true;
            noise.strength = 0.6f;
            noise.frequency = 0.35f;
            noise.quality = ParticleSystemNoiseQuality.Low;
            var shape = ps.shape;
            shape.shapeType = ParticleSystemShapeType.Box;
            shape.scale = new Vector3(40f, 1f, 40f);
            var em = ps.emission; em.rateOverTime = 0f;
            var r = go.GetComponent<ParticleSystemRenderer>();
            r.renderMode = ParticleSystemRenderMode.Billboard;
            r.sharedMaterial = Mat(material, new Color(1f, 1f, 1f, 1f));
            r.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            r.receiveShadows = false;
            return ps;
        }
    }
}
