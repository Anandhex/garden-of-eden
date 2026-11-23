using UnityEngine;

namespace GardenOfEden.Look
{
    /// <summary>
    /// Sets the global wind shader properties read by ToonGrass (and anything else that sways):
    /// <c>_WindDirection</c> (xyz, the way the wind blows), <c>_WindStrength</c>, <c>_WindSpeed</c>, <c>_WindOffset</c> (xz: how far the pattern has travelled).
    /// DayNight multiplies the strength by the weather (calm when clear, gusty in a storm) through
    /// <see cref="weatherMultiplier"/>. Put one in the scene.
    /// </summary>
    [ExecuteAlways]
    [AddComponentMenu("GardenOfEden/Look/Wind")]
    public sealed class Wind : MonoBehaviour
    {
        [Tooltip("Compass heading the wind blows TOWARD, degrees (0 = +Z, 90 = +X).")]
        [Range(0f, 360f)] public float headingDegrees = 60f;
        [Tooltip("How far the heading wanders over time, degrees either side.")]
        [Range(0f, 90f)] public float headingWander = 25f;
        [Tooltip("Base strength (about 0..2). Grass tip sway scales with it.")]
        [Range(0f, 3f)] public float baseStrength = 0.8f;
        [Tooltip("How fast the noise pattern travels (shader _WindSpeed).")]
        [Range(0f, 5f)] public float speed = 1.2f;
        [Tooltip("How much the strength swells and drops over time (gusts).")]
        [Range(0f, 1f)] public float gustiness = 0.4f;
        [Tooltip("Set by DayNight from the weather; 1 = as authored.")]
        public float weatherMultiplier = 1f;

        static readonly int DirId = Shader.PropertyToID("_WindDirection");
        static readonly int StrengthId = Shader.PropertyToID("_WindStrength");
        static readonly int SpeedId = Shader.PropertyToID("_WindSpeed");
        static readonly int OffsetId = Shader.PropertyToID("_WindOffset");
        Vector2 _offset;
        float _lastT = -1f;

        /// <summary>The wind vector currently published (xz = direction, y = 0).</summary>
        public Vector3 Direction { get; private set; } = Vector3.right;
        public float Strength { get; private set; }

        void OnEnable() => Publish(Time.realtimeSinceStartup);

        void Update() => Publish(Application.isPlaying ? Time.time : Time.realtimeSinceStartup);

        void OnValidate() => Publish(Time.realtimeSinceStartup);

        void OnDisable()
        {
            Shader.SetGlobalFloat(StrengthId, 0f);
        }

        void Publish(float t)
        {
            float wander = (Mathf.PerlinNoise(t * 0.04f, 3.1f) * 2f - 1f) * headingWander;
            float heading = (headingDegrees + wander) * Mathf.Deg2Rad;
            Direction = new Vector3(Mathf.Sin(heading), 0f, Mathf.Cos(heading));

            float gust = 1f + gustiness * (Mathf.PerlinNoise(t * 0.17f, 9.7f) * 2f - 1f) * 0.8f;
            Strength = Mathf.Max(0f, baseStrength * weatherMultiplier * gust);

            // Where the wind pattern has travelled to: the integral of the wind's velocity, so a change of heading
            // bends the waves instead of making them jump.
            float dt = _lastT < 0f ? 0f : Mathf.Clamp(t - _lastT, 0f, 0.25f);
            _lastT = t;
            _offset += new Vector2(Direction.x, Direction.z) * (speed * Mathf.Max(0.2f, weatherMultiplier) * dt);
            Shader.SetGlobalVector(OffsetId, new Vector4(_offset.x, _offset.y, 0f, 0f));
            Shader.SetGlobalVector(DirId, new Vector4(Direction.x, 0f, Direction.z, 0f));
            Shader.SetGlobalFloat(StrengthId, Strength);
            Shader.SetGlobalFloat(SpeedId, speed);
        }
    }
}
