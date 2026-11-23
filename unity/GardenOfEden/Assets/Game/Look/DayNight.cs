using System;
using UnityEngine;
using UnityEngine.Rendering;

namespace GardenOfEden.Look
{
    /// <summary>The weather looks the game can show. The server sends clear / rain / storm / snow / fog; "cloudy" is local.</summary>
    public enum WeatherKind { Clear, Cloudy, Rain, Fog, Snow, Storm }

    /// <summary>Everything the weather changes, blended smoothly toward the target look.</summary>
    [Serializable]
    public struct WeatherLook
    {
        public float sunDim;       // multiplies the sun's intensity (and shadow strength)
        public float ambientDim;   // multiplies the ambient light
        public float cloudCover;   // sky shader _CloudCover
        public float cloudDark;    // 0..1, darkens clouds (storm)
        public float skyGrey;      // 0..1, how far the sky turns to flat grey
        public float fogDensity;   // fog strength; DayNight turns it into a linear fog range (end = 3.6 / density)
        public float wind;         // Wind.weatherMultiplier
        public float rain;         // 0..1 precipitation amounts
        public float snow;
        public Color tint;         // multiplies light colour (lightPlan.ts WEATHER table)

        public static WeatherLook Lerp(in WeatherLook a, in WeatherLook b, float t) => new WeatherLook
        {
            sunDim = Mathf.Lerp(a.sunDim, b.sunDim, t),
            ambientDim = Mathf.Lerp(a.ambientDim, b.ambientDim, t),
            cloudCover = Mathf.Lerp(a.cloudCover, b.cloudCover, t),
            cloudDark = Mathf.Lerp(a.cloudDark, b.cloudDark, t),
            skyGrey = Mathf.Lerp(a.skyGrey, b.skyGrey, t),
            fogDensity = Mathf.Lerp(a.fogDensity, b.fogDensity, t),
            wind = Mathf.Lerp(a.wind, b.wind, t),
            rain = Mathf.Lerp(a.rain, b.rain, t),
            snow = Mathf.Lerp(a.snow, b.snow, t),
            tint = Color.Lerp(a.tint, b.tint, t),
        };

        /// <summary>
        /// tint = packages/client/src/adapter/web/world/lightPlan.ts WEATHER (clear 1,1,1; rain .8,.82,.88; storm .62,.64,.72;
        /// snow .94,.96,1; fog .86,.87,.9). fogDensity echoes iso/atmosphere.ts: a little haze always, much thicker in
        /// rain, storm and fog (there: fog far 70 -> 22 tiles).
        /// </summary>
        public static WeatherLook For(WeatherKind k)
        {
            switch (k)
            {
                case WeatherKind.Cloudy: return new WeatherLook { sunDim = 0.55f, ambientDim = 0.95f, cloudCover = 0.8f, cloudDark = 0.15f, skyGrey = 0.45f, fogDensity = 0.004f, wind = 1.1f, tint = new Color(0.90f, 0.91f, 0.94f) };
                case WeatherKind.Rain:   return new WeatherLook { sunDim = 0.35f, ambientDim = 0.85f, cloudCover = 1.0f, cloudDark = 0.45f, skyGrey = 0.8f, fogDensity = 0.009f, wind = 1.5f, rain = 1f, tint = new Color(0.80f, 0.82f, 0.88f) };
                case WeatherKind.Storm:  return new WeatherLook { sunDim = 0.2f, ambientDim = 0.7f, cloudCover = 1.0f, cloudDark = 0.8f, skyGrey = 0.95f, fogDensity = 0.013f, wind = 2.6f, rain = 1.6f, tint = new Color(0.62f, 0.64f, 0.72f) };
                case WeatherKind.Snow:   return new WeatherLook { sunDim = 0.5f, ambientDim = 0.95f, cloudCover = 0.9f, cloudDark = 0.1f, skyGrey = 0.6f, fogDensity = 0.01f, wind = 0.8f, snow = 1f, tint = new Color(0.94f, 0.96f, 1.0f) };
                case WeatherKind.Fog:    return new WeatherLook { sunDim = 0.4f, ambientDim = 0.9f, cloudCover = 0.7f, cloudDark = 0.05f, skyGrey = 0.7f, fogDensity = 0.022f, wind = 0.4f, tint = new Color(0.86f, 0.87f, 0.90f) };
                default:                 return new WeatherLook { sunDim = 1f, ambientDim = 1f, cloudCover = 0.42f, cloudDark = 0f, skyGrey = 0f, fogDensity = 0.0016f, wind = 1f, tint = Color.white };
            }
        }
    }

    /// <summary>
    /// Drives the sun (a directional Light), ambient gradient, fog and the StylisedSky material from a time of day and a
    /// weather, blending smoothly. The game server sends, every frame, <c>ambience: { light, timeOfDay, weather, season, snow? }</c>
    /// (packages/shared/src/view/schema.ts, FrameSchema). Feed it with <see cref="ApplyAmbience"/> (all five fields at once),
    /// or drive it yourself with <see cref="SetTime"/> and <see cref="SetWeather(string)"/>.
    ///
    /// MAPPING (faithful to the web client):
    ///  * <c>light</c> 0..1 is the server's daylight curve (server/src/view/frame.ts daylight()): 0 before 05:00 and after
    ///    21:00, rising to 1 by 06:30 and falling from 19:00. It sets how much sun there is and where the sky sits between
    ///    night, twilight and day. <see cref="DaylightAt"/> repeats that curve so <see cref="SetTime"/> alone looks the same.
    ///  * <c>timeOfDay</c> morning (05-12) / afternoon (12-17) / evening (17-21) / night: morning is the warm DAWN colour at
    ///    low light, every other time is the DUSK colour; evening keeps an 18% DUSK cast at full light, morning an 8% DAWN
    ///    cast (lightPlan.ts ambientOf).
    ///  * Colour ramp (lightPlan.ts): NIGHT (.2,.25,.45) -> warm (DAWN 1,.8,.66 / DUSK 1,.66,.42) up to light 0.6 -> white
    ///    NOON by light 1. That colour times the weather tint (WeatherLook.tint = lightPlan WEATHER) times the season cast
    ///    (spring/summer 1; autumn 1,.94,.84; winter .9,.94,1) is the light's colour; its brightness is the Light intensity
    ///    and ambient strength (so night, bad weather and winter are dim as on the web).
    ///  * <c>weather</c> clear / rain / storm / snow / fog (+ cloudy): see <see cref="WeatherLook.For"/>. Fog: iso/atmosphere.ts
    ///    thickens the haze in rain, storm, fog, on autumn/winter mornings and on non-summer nights; that is repeated here.
    ///  * <c>snow</c> (snow lies on the ground) is published as the global shader float <c>_SnowAmount</c> (0..1) for any
    ///    material that wants a white cover; the lit shaders here do not use it yet.
    ///  * The fog colour is the sky's horizon colour so the distance melts into the sky (the web uses HAZE .74,.8,.88 times
    ///    the ambient colour; the clear-noon horizon here is that same colour).
    /// The sun crosses the sky between 05:45 and 20:00 (the middle of the server's dawn and dusk ramps); after dark the same
    /// Light becomes a faint blue moon on the opposite arc.
    /// </summary>
    [ExecuteAlways]
    [AddComponentMenu("GardenOfEden/Look/Day Night")]
    public sealed class DayNight : MonoBehaviour
    {
        [Header("Scene objects")]
        public Light sun;
        [Tooltip("A material using GardenOfEden/StylisedSky. Also assigned to RenderSettings.skybox.")]
        public Material skyMaterial;
        public Wind wind;
        [Tooltip("Optional particle systems; their emission rate follows the weather.")]
        public ParticleSystem rainParticles;
        public ParticleSystem snowParticles;
        [Tooltip("Play mode: make rain and snow under the main camera when none are assigned (WeatherParticles).")]
        public bool autoWeatherParticles = true;
        [Tooltip("Optional particle material (URP Particles/Unlit, transparent); one is made when empty.")]
        public Material weatherMaterial;
        public float rainMaxRate = 1800f;
        public float snowMaxRate = 700f;

        [Header("Time")]
        [Tooltip("Hour of day to start at (0..24).")]
        [Range(0f, 24f)] public float initialHour = 10f;
        [Tooltip("If on, time runs by itself (handy in a test scene); leave off when the server drives it.")]
        public bool autoAdvance = false;
        public float autoAdvanceHoursPerSecond = 0.25f;
        [Tooltip("Seconds to ease toward a new time sent by the server.")]
        public float timeBlendSeconds = 1.5f;

        [Header("Weather")]
        public float weatherBlendSeconds = 6f;

        [Header("Sun")]
        public float sunMaxIntensity = 1.3f;
        public float moonIntensity = 0.3f;
        [Range(20f, 80f)] public float maxSunElevationDegrees = 62f;
        [Tooltip("Turns the whole sun arc about the vertical axis.")]
        public float arcAzimuthDegrees = 25f;
        public Color moonColor = new Color(0.55f, 0.65f, 1.0f);

        [Header("Sky colours (lightPlan.ts-like ramp: night / dawn / dusk / day)")]
        public Color nightHorizon = new Color(0.07f, 0.10f, 0.22f);
        public Color dawnHorizon = new Color(1.00f, 0.74f, 0.58f);
        public Color duskHorizon = new Color(1.00f, 0.60f, 0.40f);
        public Color dayHorizon = new Color(0.74f, 0.80f, 0.88f);   // = iso/atmosphere.ts HAZE
        public Color nightZenith = new Color(0.02f, 0.04f, 0.13f);
        public Color dawnZenith = new Color(0.40f, 0.50f, 0.82f);
        public Color duskZenith = new Color(0.33f, 0.38f, 0.72f);
        public Color dayZenith = new Color(0.30f, 0.56f, 0.92f);
        public Color overcastHorizon = new Color(0.70f, 0.74f, 0.80f);
        public Color overcastZenith = new Color(0.52f, 0.58f, 0.68f);

        [Header("Ambient (sky / equator / ground) by night and by day")]
        public Color nightAmbientSky = new Color(0.12f, 0.15f, 0.30f);
        public Color nightAmbientEquator = new Color(0.09f, 0.11f, 0.22f);
        public Color nightAmbientGround = new Color(0.04f, 0.04f, 0.07f);
        public Color dayAmbientSky = new Color(0.46f, 0.72f, 0.95f);       // cool cyan-blue skylight: the shadow side
        public Color dayAmbientEquator = new Color(0.52f, 0.62f, 0.68f);
        public Color dayAmbientGround = new Color(0.30f, 0.38f, 0.38f);    // cool teal bounce from the earth
        public float ambientIntensity = 0.85f;

        [Header("Fog")]
        public bool driveFog = true;
        [Tooltip("Fog end distance (m) = this / fog density.")] public float fogEndScale = 3.6f;
        [Tooltip("Fog start as a fraction of the end distance (0.09 = 200 m on a clear day).")] [Range(0f, 0.5f)] public float fogStartFraction = 0.09f;
        [Tooltip("How far the fog colour leans from the horizon colour toward the zenith colour (distant land turns blue-ish).")] [Range(0f, 0.6f)] public float fogBlue = 0.2f;

        // ---- lightPlan.ts colours ----
        static readonly Color Night = new Color(0.2f, 0.25f, 0.45f);
        static readonly Color Dawn = new Color(1.0f, 0.8f, 0.66f);
        static readonly Color Dusk = new Color(1.0f, 0.66f, 0.42f);
        static readonly Color Noon = Color.white;
        static readonly Color Autumn = new Color(1f, 0.94f, 0.84f);
        static readonly Color Winter = new Color(0.9f, 0.94f, 1f);

        const float Sunrise = 5.75f, Sunset = 20f;

        // shader ids
        static readonly int HorizonId = Shader.PropertyToID("_HorizonColor");
        static readonly int ZenithId = Shader.PropertyToID("_ZenithColor");
        static readonly int GroundId = Shader.PropertyToID("_GroundColor");
        static readonly int SunDirId = Shader.PropertyToID("_SunDirection");
        static readonly int MoonDirId = Shader.PropertyToID("_MoonDirection");
        static readonly int SunColorId = Shader.PropertyToID("_SunColor");
        static readonly int MoonColorId = Shader.PropertyToID("_MoonColor");
        static readonly int SunVisId = Shader.PropertyToID("_SunVisibility");
        static readonly int CloudCoverId = Shader.PropertyToID("_CloudCover");
        static readonly int CloudColorId = Shader.PropertyToID("_CloudColor");
        static readonly int CloudShadeId = Shader.PropertyToID("_CloudShadowColor");
        static readonly int StarAmountId = Shader.PropertyToID("_StarAmount");
        static readonly int SnowAmountId = Shader.PropertyToID("_SnowAmount");

        // ---- state (all smoothed) ----
        float _hour, _hourTarget;
        float _light, _lightTarget;
        float _dawn, _dawnTarget;                 // 1 = the warm colour is DAWN, 0 = DUSK
        float _extraDawn, _extraDusk;             // the 8% / 18% full-light casts
        bool _morning, _night;
        string _season = "spring";
        Color _seasonTint = Color.white;
        float _snow, _snowTarget;
        float _fogBoost;
        WeatherKind _kind = WeatherKind.Clear;
        WeatherLook _cur, _target;
        bool _initialised;

        // ------------------------------------------------------------------------------------------------------
        // Public API

        /// <summary>Normalised time of day: 0 = midnight, 0.25 = 06:00, 0.5 = noon, 0.75 = 18:00.</summary>
        public void SetTime(float t01) => SetHour(Mathf.Repeat(t01, 1f) * 24f);

        /// <summary>Time of day in hours (0..24). Light, warmth and time-of-day name follow the server's rules.</summary>
        public void SetHour(float hour)
        {
            Init();
            _hourTarget = Mathf.Repeat(hour, 24f);
            _lightTarget = DaylightAt(_hourTarget);
            ApplyTimeOfDayName(TimeOfDayAt(_hourTarget));
        }

        /// <summary>Weather by the server's id: clear, rain, storm, snow, fog (also cloudy / overcast). Unknown = clear.</summary>
        public void SetWeather(string id) => SetWeather(ParseWeather(id));

        public void SetWeather(WeatherKind kind)
        {
            Init();
            _kind = kind;
            _target = WeatherLook.For(kind);
        }

        /// <summary>Season by the server's id: spring, summer, autumn, winter.</summary>
        public void SetSeason(string id)
        {
            Init();
            _season = string.IsNullOrEmpty(id) ? "spring" : id;
        }

        /// <summary>Snow lying on the ground (server <c>ambience.snow</c>).</summary>
        public void SetSnowCover(bool lying)
        {
            Init();
            _snowTarget = lying ? 1f : 0f;
        }

        /// <summary>
        /// Everything the server's <c>frame.ambience</c> holds, in one call (call it every frame; it is cheap and
        /// the look eases toward the values). timeOfDay: morning / afternoon / evening / night.
        /// </summary>
        public void ApplyAmbience(float light, string timeOfDay, string weather, string season, bool snow = false)
        {
            Init();
            _lightTarget = Mathf.Clamp01(light);
            ApplyTimeOfDayName(timeOfDay);
            _hourTarget = HourFor(_lightTarget, timeOfDay, _hourTarget);
            SetWeather(weather);
            SetSeason(season);
            SetSnowCover(snow);
        }

        public static WeatherKind ParseWeather(string id)
        {
            switch ((id ?? "").Trim().ToLowerInvariant())
            {
                case "cloudy": case "overcast": return WeatherKind.Cloudy;
                case "rain": return WeatherKind.Rain;
                case "storm": return WeatherKind.Storm;
                case "snow": return WeatherKind.Snow;
                case "fog": return WeatherKind.Fog;
                default: return WeatherKind.Clear;
            }
        }

        /// <summary>server/src/view/frame.ts daylight(): 0 night .. 1 day, for an hour (fractional) of the day.</summary>
        public static float DaylightAt(float h)
        {
            h = Mathf.Repeat(h, 24f);
            float dark = (h < 5f || h >= 21f) ? 0.45f
                       : h < 6.5f ? 0.45f * (6.5f - h) / 1.5f
                       : h >= 19f ? 0.45f * (h - 19f) / 2f
                       : 0f;
            return 1f - dark / 0.45f;
        }

        /// <summary>server/src/game/clock.ts timeOfDayAt().</summary>
        public static string TimeOfDayAt(float hour)
        {
            hour = Mathf.Repeat(hour, 24f);
            if (hour >= 5f && hour < 12f) return "morning";
            if (hour >= 12f && hour < 17f) return "afternoon";
            if (hour >= 17f && hour < 21f) return "evening";
            return "night";
        }

        public float Hour => _hour;
        public float Light01 => _light;
        public WeatherKind Weather => _kind;

        // ------------------------------------------------------------------------------------------------------

        void ApplyTimeOfDayName(string tod)
        {
            _morning = tod == "morning";
            _night = tod == "night";
            _dawnTarget = _morning ? 1f : 0f;
            _extraDawnTarget = _morning ? 1f : 0f;
            _extraDuskTarget = tod == "evening" ? 1f : 0f;
        }

        float _extraDawnTarget, _extraDuskTarget;

        // Invert the server's daylight ramps to get an hour, keeping the current hour when it already fits.
        static float HourFor(float light, string tod, float current)
        {
            switch (tod)
            {
                case "morning": return light < 1f ? 5f + 1.5f * light : (InRange(current, 6.5f, 12f) ? current : 9f);
                case "afternoon": return InRange(current, 12f, 17f) ? current : 14.5f;
                case "evening": return light < 1f ? 21f - 2f * light : (InRange(current, 17f, 19f) ? current : 18f);
                default: return (current >= 21f || current < 5f) ? current : 23f;
            }
        }

        static bool InRange(float h, float a, float b) => h >= a && h < b;

        void Init()
        {
            if (_initialised) return;
            _initialised = true;
            _hour = _hourTarget = Mathf.Repeat(initialHour, 24f);
            _light = _lightTarget = DaylightAt(_hour);
            string tod = TimeOfDayAt(_hour);
            _morning = tod == "morning";
            _night = tod == "night";
            _dawn = _dawnTarget = _morning ? 1f : 0f;
            _extraDawn = _extraDawnTarget = _morning ? 1f : 0f;
            _extraDusk = _extraDuskTarget = tod == "evening" ? 1f : 0f;
            _cur = _target = WeatherLook.For(_kind);
            _seasonTint = SeasonTint(_season);
        }

        void Start()
        {
            if (!Application.isPlaying || !autoWeatherParticles) return;
            var cam = Camera.main;
            if (cam == null) return;
            if (rainParticles == null) rainParticles = WeatherParticles.MakeRain(cam.transform, weatherMaterial);
            if (snowParticles == null) snowParticles = WeatherParticles.MakeSnow(cam.transform, weatherMaterial);
        }

        void OnEnable()
        {
            _initialised = false;
            Init();
            Tick(1000f);
        }

        void OnValidate()
        {
            if (!isActiveAndEnabled) return;
            _initialised = false;
            Init();
            Tick(1000f);
        }

        void Update()
        {
            Init();
            float dt = Application.isPlaying ? Time.deltaTime : 1000f;
            if (autoAdvance && Application.isPlaying) SetHour(_hourTarget + autoAdvanceHoursPerSecond * dt);
            Tick(dt);
        }

        // ------------------------------------------------------------------------------------------------------

        void Tick(float dt)
        {
            float kt = 1f - Mathf.Exp(-dt / Mathf.Max(0.01f, timeBlendSeconds));
            float kw = 1f - Mathf.Exp(-3f * dt / Mathf.Max(0.05f, weatherBlendSeconds));

            // time: shortest way round the clock
            float dh = Mathf.DeltaAngle(_hour * 15f, _hourTarget * 15f) / 15f;
            _hour = Mathf.Repeat(_hour + dh * kt, 24f);
            _light = Mathf.Lerp(_light, _lightTarget, kt);
            _dawn = Mathf.Lerp(_dawn, _dawnTarget, kt);
            _extraDawn = Mathf.Lerp(_extraDawn, _extraDawnTarget, kt);
            _extraDusk = Mathf.Lerp(_extraDusk, _extraDuskTarget, kt);
            _seasonTint = Color.Lerp(_seasonTint, SeasonTint(_season), kt);
            _snow = Mathf.Lerp(_snow, _snowTarget, kw);
            _cur = WeatherLook.Lerp(_cur, _target, kw);

            // atmosphere.ts: extra haze on cold mornings and on nights outside summer
            bool cold = _season == "autumn" || _season == "winter";
            float boostTarget = (cold && _morning ? 0.006f : 0f) + (_night && _season != "summer" ? 0.004f : 0f);
            _fogBoost = Mathf.Lerp(_fogBoost, boostTarget, kw);

            Apply();
        }

        static Color SeasonTint(string s) => s == "autumn" ? Autumn : s == "winter" ? Winter : Color.white;

        // lightPlan.ts ambientOf(): the colour of the light for a daylight value k.
        Color LightColour(float k)
        {
            Color warm = Color.Lerp(Dusk, Dawn, _dawn);
            Color c = k < 0.6f ? Color.Lerp(Night, warm, k / 0.6f) : Color.Lerp(warm, Noon, (k - 0.6f) / 0.4f);
            float full = Mathf.SmoothStep(0.9f, 1f, k);              // the web applies these only at k >= 1
            c = Color.Lerp(c, Dusk, 0.18f * _extraDusk * full);
            c = Color.Lerp(c, Dawn, 0.08f * _extraDawn * full);
            c.r *= _cur.tint.r * _seasonTint.r;
            c.g *= _cur.tint.g * _seasonTint.g;
            c.b *= _cur.tint.b * _seasonTint.b;
            c.a = 1f;
            return c;
        }

        static Color Normalised(Color c)
        {
            float m = Mathf.Max(0.001f, Mathf.Max(c.r, Mathf.Max(c.g, c.b)));
            return new Color(c.r / m, c.g / m, c.b / m, 1f);
        }

        Color Ramp(Color night, Color dawn, Color dusk, Color day, float k)
        {
            Color warm = Color.Lerp(dusk, dawn, _dawn);
            return k < 0.6f ? Color.Lerp(night, warm, k / 0.6f) : Color.Lerp(warm, day, (k - 0.6f) / 0.4f);
        }

        void Apply()
        {
            float k = Mathf.Clamp01(_light);
            Color lightCol = LightColour(k);
            Color hue = Normalised(lightCol);
            float bright = Mathf.Max(lightCol.r, Mathf.Max(lightCol.g, lightCol.b)); // 0.45 at night .. 1 at noon

            // ---- sun position: an arc in a tilted plane; after sunset the moon takes the opposite arc ----
            float h = _hour;
            float a;
            if (h >= Sunrise && h <= Sunset) a = (h - Sunrise) / (Sunset - Sunrise) * Mathf.PI;
            else
            {
                float nightLen = 24f - (Sunset - Sunrise);
                float nh = h < Sunrise ? h + 24f - Sunset : h - Sunset;
                a = Mathf.PI + nh / nightLen * Mathf.PI;
            }
            float sinMax = Mathf.Sin(maxSunElevationDegrees * Mathf.Deg2Rad);
            float cosMax = Mathf.Cos(maxSunElevationDegrees * Mathf.Deg2Rad);
            Vector3 toSun = new Vector3(Mathf.Cos(a), Mathf.Sin(a) * sinMax, -Mathf.Sin(a) * cosMax);
            toSun = Quaternion.AngleAxis(arcAzimuthDegrees, Vector3.up) * toSun;
            toSun.Normalize();
            float sunE = Mathf.Sin(a);                    // -1 .. 1, sign = above/below the horizon
            Vector3 toMoon = -toSun;

            // ---- the one directional light ----
            if (sun != null)
            {
                bool dayLight = sunE >= 0f;
                Vector3 toLight = dayLight ? toSun : toMoon;
                sun.transform.rotation = Quaternion.LookRotation(-toLight, Vector3.up);
                float dayI = sunMaxIntensity * Mathf.SmoothStep(0f, 0.22f, sunE) * _cur.sunDim * k;
                float nightI = moonIntensity * Mathf.SmoothStep(0f, 0.22f, -sunE) * (1f - k) * (1f - 0.5f * _cur.skyGrey);
                sun.color = dayLight ? SunTint(hue) : moonColor;
                sun.intensity = Mathf.Max(dayI, nightI);
                sun.shadowStrength = dayLight ? Mathf.Lerp(0.3f, 0.78f, _cur.sunDim) : 0.45f;   // soft, tinted by the cool ambient, never black
                sun.shadows = LightShadows.Soft;
                RenderSettings.sun = sun;
            }

            // ---- ambient (trilight, which URP bakes into SH for the toon shaders' SampleSH) ----
            float amb = Mathf.Lerp(0.0f, 1f, k) * _cur.ambientDim * ambientIntensity;
            Color nightSky = nightAmbientSky, dayAmbSky = dayAmbientSky;
            RenderSettings.ambientMode = AmbientMode.Trilight;
            RenderSettings.ambientSkyColor = Color.Lerp(nightSky, Tint(dayAmbSky, hue), k) * Mathf.Lerp(1f, amb, k);
            RenderSettings.ambientEquatorColor = Color.Lerp(nightAmbientEquator, Tint(dayAmbientEquator, hue), k) * Mathf.Lerp(1f, amb, k);
            RenderSettings.ambientGroundColor = Color.Lerp(nightAmbientGround, Tint(dayAmbientGround, hue), k) * Mathf.Lerp(1f, amb, k);

            // ---- sky colours ----
            Color horizon = Ramp(nightHorizon, dawnHorizon, duskHorizon, dayHorizon, k);
            Color zenith = Ramp(nightZenith, dawnZenith, duskZenith, dayZenith, k);
            float dayness = Mathf.Lerp(0.10f, 1f, k);
            Color greyTint = Color.Lerp(Color.white, hue, 0.5f);
            horizon = Color.Lerp(horizon, overcastHorizon * dayness * greyTint, _cur.skyGrey);
            zenith = Color.Lerp(zenith, overcastZenith * dayness * greyTint, _cur.skyGrey);
            horizon.a = zenith.a = 1f;
            Color ground = Color.Lerp(horizon, new Color(0.35f, 0.38f, 0.42f) * dayness, 0.08f);   // below the horizon the sky is the fog's colour: no seam behind the far hills

            // ---- fog: the same colour as the horizon so the distance melts into the sky ----
            if (driveFog)
            {
                // Linear, not exp2: nothing is hazed near the camera, the haze builds slowly (clear day: starts ~130 m, strong only
                // out at the far mountains ~2 km), and weather pulls both ends in. The colour is the horizon pulled a little toward the
                // zenith, so distant land goes blue-ish (aerial perspective) instead of a flat grey veil.
                float density = Mathf.Max(0.0005f, _cur.fogDensity + _fogBoost);
                float fogEnd = fogEndScale / density;                    // clear 0.0016 -> 2250 m, rain 0.009 -> 400 m, fog 0.022 -> 160 m
                RenderSettings.fog = true;
                RenderSettings.fogMode = FogMode.Linear;
                RenderSettings.fogColor = Color.Lerp(horizon, zenith, fogBlue);
                RenderSettings.fogStartDistance = fogEnd * fogStartFraction;
                RenderSettings.fogEndDistance = fogEnd;
            }

            // ---- sky material ----
            if (skyMaterial != null)
            {
                if (RenderSettings.skybox != skyMaterial) RenderSettings.skybox = skyMaterial;
                skyMaterial.SetColor(HorizonId, horizon);
                skyMaterial.SetColor(ZenithId, zenith);
                skyMaterial.SetColor(GroundId, ground);
                skyMaterial.SetVector(SunDirId, toSun);
                skyMaterial.SetVector(MoonDirId, toMoon);
                skyMaterial.SetColor(SunColorId, Color.Lerp(new Color(1.6f, 1.45f, 1.15f), hue * 1.6f, 0.5f));
                skyMaterial.SetColor(MoonColorId, new Color(0.85f, 0.9f, 1f));
                skyMaterial.SetFloat(SunVisId, Mathf.Clamp01(1f - _cur.cloudCover * 0.6f) * _cur.sunDim);
                skyMaterial.SetFloat(CloudCoverId, _cur.cloudCover);
                Color litCloud = Color.Lerp(Color.white, hue, 0.45f) * Mathf.Lerp(0.14f, 1f, k) * (1f - 0.35f * _cur.cloudDark);
                litCloud.a = 1f;
                Color shadeCloud = litCloud * Color.Lerp(new Color(0.62f, 0.68f, 0.82f), new Color(0.38f, 0.40f, 0.48f), _cur.cloudDark);
                shadeCloud.a = 1f;
                skyMaterial.SetColor(CloudColorId, litCloud);
                skyMaterial.SetColor(CloudShadeId, shadeCloud);
                float stars = (1f - k) * (1f - k) * (1f - Mathf.Clamp01(_cur.cloudCover * 0.8f + _cur.skyGrey * 0.4f));
                skyMaterial.SetFloat(StarAmountId, stars);
            }

            if (wind != null) wind.weatherMultiplier = _cur.wind;
            Shader.SetGlobalFloat(SnowAmountId, _snow);
            Emit(rainParticles, _cur.rain, rainMaxRate);
            Emit(snowParticles, _cur.snow, snowMaxRate);
        }

        /// <summary>Art direction: a warm golden key light by day (the hue of the hour, pulled toward gold, never white).</summary>
        static Color SunTint(Color hue)
        {
            var golden = new Color(1f, 0.90f, 0.70f);
            return new Color(hue.r * golden.r, hue.g * golden.g, hue.b * golden.b, 1f);
        }

        static Color Tint(Color c, Color hue)
        {
            // a gentle cast: half-way between the base colour and the base colour tinted by the light's hue
            Color t = new Color(c.r * hue.r, c.g * hue.g, c.b * hue.b, 1f);
            return Color.Lerp(c, t, 0.6f);
        }

        static void Emit(ParticleSystem ps, float amount, float maxRate)
        {
            if (ps == null) return;
            var e = ps.emission;
            e.rateOverTimeMultiplier = Mathf.Max(0f, amount) * maxRate;
            if (amount > 0.01f)
            {
                if (!ps.isPlaying) ps.Play();
            }
            else if (ps.isPlaying)
            {
                ps.Stop(true, ParticleSystemStopBehavior.StopEmitting);
            }
        }
    }
}
