// GardenOfEden/ToonGrass - GPU-instanced grass clumps for URP 17, used by GrassField (Graphics.RenderMeshInstanced).
// The mesh is a clump of soft rounded blades (uv.y = 0 at the root, 1 at the tip; vertex colour r = per-blade brightness,
// g = per-blade phase). GrassField draws clumps in a few colour groups; _GroundTint is the colour of the ground under a group, so the field and the earth under it match (root darker and cooler, tip lighter and warmer).
//
// Global shader properties (set by Wind.cs): _WindDirection (xz = direction), _WindStrength, _WindSpeed, _WindOffset.
// Wind: a slow wide wave front travels across the field (blades lean into it and its crest is brighter), with a finer
// ripple and a per-blade flutter on top. Blades shrink away between _FadeStart and _FadeEnd.
// Not included on purpose (cost): additional lights, shadow casting. Material must have "Enable GPU Instancing" on.
Shader "GardenOfEden/ToonGrass"
{
    Properties
    {
        [Header(Colour)]
        _BaseColor("Fallback Ground Colour", Color) = (0.30, 0.50, 0.22, 1)
        _GroundTint("Ground Colour (set per draw by GrassField)", Color) = (0, 0, 0, 0)
        _RootDark("Root Darkening", Range(0.2, 1)) = 1.0
        _RootCool("Root Cool Shift", Range(0, 0.5)) = 0.05
        _TipLight("Tip Lightening", Range(1, 1.8)) = 1.5
        _TipWarm("Tip Warm Shift", Range(0, 0.6)) = 0.32
        _GradientPower("Gradient Power", Range(0.2, 3)) = 0.75
        _Variation("Per-blade Variation", Range(0, 0.5)) = 0.09

        [Header(Toon lighting)]
        _ShadowColor("Shadow Tint", Color) = (0.62, 0.62, 0.86, 1)
        _Bands("Bands (steps)", Range(1, 6)) = 2
        _Softness("Band Softness", Range(0.01, 1)) = 0.6
        _Wrap("Light Wrap", Range(0, 1)) = 0.6
        _UpBias("Normal Up Bias", Range(0, 1)) = 0.85
        _AmbientStrength("Ambient Strength", Range(0, 2)) = 0.95
        _TipGlow("Tip Brightness", Range(0, 1)) = 0.2

        [Header(Wind)]
        _WindAmplitude("Wind Amplitude (m at tip)", Range(0, 1)) = 0.16
        _WaveLength("Gust Wave Length (m)", Range(4, 80)) = 22
        _WaveSpeed("Gust Wave Speed", Range(0, 8)) = 2.2
        _WaveLight("Gust Crest Brightness", Range(0, 0.6)) = 0.28

        [Header(Distance)]
        _FadeStart("Fade Start (m)", Float) = 34
        _FadeEnd("Fade End (m)", Float) = 48
    }

    SubShader
    {
        Tags
        {
            "RenderType" = "Opaque"
            "RenderPipeline" = "UniversalPipeline"
            "Queue" = "Geometry"
        }
        LOD 200

        HLSLINCLUDE
        #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"

        // Globals, set from script (outside UnityPerMaterial on purpose).
        float4 _WindDirection;
        float4 _WindOffset;
        float  _WindStrength;
        float  _WindSpeed;
        float  _SnowAmount;   // DayNight: snow lying on the ground (0..1)
        // The loaded land's rectangle (x0, z0, x1, z1) and how wide the grass fades out inside its edge; set by GrassField.
        float4 _GrassRect;
        float  _GrassEdgeFade;

        CBUFFER_START(UnityPerMaterial)
            half4  _BaseColor;
            half4  _GroundTint;
            half   _RootDark;
            half   _RootCool;
            half   _TipLight;
            half   _TipWarm;
            half   _GradientPower;
            half   _Variation;
            half4  _ShadowColor;
            half   _Bands;
            half   _Softness;
            half   _Wrap;
            half   _UpBias;
            half   _AmbientStrength;
            half   _TipGlow;
            float  _WindAmplitude;
            float  _WaveLength;
            float  _WaveSpeed;
            half   _WaveLight;
            float  _FadeStart;
            float  _FadeEnd;
        CBUFFER_END

        float GrassHash21(float2 p)
        {
            p = frac(p * float2(123.34, 456.21));
            p += dot(p, p + 45.32);
            return frac(p.x * p.y);
        }

        float GrassNoise(float2 p)
        {
            float2 i = floor(p);
            float2 f = frac(p);
            f = f * f * (3.0 - 2.0 * f);
            float a = GrassHash21(i);
            float b = GrassHash21(i + float2(1, 0));
            float c = GrassHash21(i + float2(0, 1));
            float d = GrassHash21(i + float2(1, 1));
            return lerp(lerp(a, b, f.x), lerp(c, d, f.x), f.y);
        }

        struct GrassAttributes
        {
            float4 positionOS : POSITION;
            float3 normalOS   : NORMAL;
            float2 uv         : TEXCOORD0;
            float4 color      : COLOR;
            UNITY_VERTEX_INPUT_INSTANCE_ID
        };

        // The blade's world position after distance shrink and wind; wave (0..1) = how much of a gust crest is here.
        float3 GrassWorldPosition(float3 positionOS, float tip, float3 originWS, float phase, out float wave)
        {
            float3 positionWS = TransformObjectToWorld(positionOS);

            // Distance fade: shrink toward the root so blades vanish smoothly instead of popping.
            float dist = distance(originWS, _WorldSpaceCameraPos);
            float fade = 1.0 - smoothstep(_FadeStart, max(_FadeEnd, _FadeStart + 0.01), dist);
            // ... and toward the edge of the loaded land, so the meadow thins out gradually instead of ending in a line.
            float inside = min(min(originWS.x - _GrassRect.x, _GrassRect.z - originWS.x), min(originWS.z - _GrassRect.y, _GrassRect.w - originWS.z));
            fade *= smoothstep(1.0, 1.0 + max(_GrassEdgeFade, 0.01), inside);
            positionWS = originWS + (positionWS - originWS) * fade;

            // Wind: a wide wave front travels along the wind (its crest is a gust), a finer ripple rides on it.
            float2 dir = _WindDirection.xz;
            float dl = length(dir);
            dir = dl > 1e-4 ? dir / dl : float2(1, 0);
            float2 perp = float2(-dir.y, dir.x);
            float2 q = originWS.xz - _WindOffset.xz * _WaveSpeed;
            float along = dot(q, dir);
            float warp = GrassNoise(originWS.xz * 0.045 + 3.7) * 2.2 + GrassNoise(originWS.xz * 0.13) * 0.7;
            float w = 0.5 + 0.5 * sin(along * (6.2831853 / _WaveLength) + warp);
            wave = w * w * (3.0 - 2.0 * w);
            float ripple = 0.5 + 0.5 * sin(dot(q, dir) * 1.15 + GrassNoise(originWS.xz * 0.3) * 4.0);
            float push = _WindStrength * (0.22 + 0.78 * wave + 0.18 * ripple);
            float flutter = sin(_Time.y * (2.6 + phase * 2.0) + phase * 25.0 + originWS.x * 1.7) * 0.12 * _WindStrength;
            float bend = tip * tip;
            float2 offset = (dir * push + perp * flutter) * (_WindAmplitude * bend) * fade;
            positionWS.xz += offset;
            positionWS.y -= length(offset) * 0.45;
            return positionWS;
        }
        ENDHLSL

        // ------------------------------------------------------------------------------------------------------
        Pass
        {
            Name "ForwardLit"
            Tags { "LightMode" = "UniversalForward" }

            Cull Off
            ZWrite On
            ZTest LEqual

            HLSLPROGRAM
            #pragma target 4.5
            #pragma exclude_renderers gles gles3 glcore
            #pragma vertex   Vert
            #pragma fragment Frag
            #pragma multi_compile_instancing
            #pragma multi_compile _ _MAIN_LIGHT_SHADOWS _MAIN_LIGHT_SHADOWS_CASCADE _MAIN_LIGHT_SHADOWS_SCREEN
            #pragma multi_compile_fragment _ _SHADOWS_SOFT _SHADOWS_SOFT_LOW _SHADOWS_SOFT_MEDIUM _SHADOWS_SOFT_HIGH
            #pragma multi_compile_fog

            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Lighting.hlsl"

            struct Varyings
            {
                float4 positionCS : SV_POSITION;
                float3 positionWS : TEXCOORD0;
                half3  normalWS   : TEXCOORD1;
                half4  color      : TEXCOORD2;   // rgb = blade colour, a = tip amount
                half   fogFactor  : TEXCOORD3;
            #if defined(_MAIN_LIGHT_SHADOWS_SCREEN)
                float4 shadowCoord : TEXCOORD4;
            #endif
            };

            half ToonRamp(half x)
            {
                half t  = saturate(x) * _Bands;
                half f  = floor(t);
                half fr = t - f;
                half w  = smoothstep(0.5h - 0.5h * _Softness, 0.5h + 0.5h * _Softness, fr);
                return saturate((f + w) / _Bands);
            }

            Varyings Vert(GrassAttributes i)
            {
                Varyings o;
                UNITY_SETUP_INSTANCE_ID(i);

                float tip = saturate(i.uv.y);
                float3 originWS = TransformObjectToWorld(float3(0, 0, 0));
                float wave;
                float3 positionWS = GrassWorldPosition(i.positionOS.xyz, tip, originWS, i.color.g, wave);

                // Colour: the ground's own colour, darker and cooler at the root, lighter and warmer at the tip, a little
                // per-blade brightness, and the crest of a gust shows lighter.
                half3 ground = _GroundTint.rgb;
                ground = lerp(_BaseColor.rgb, ground, step(0.0001, dot(ground, 1.0.xxx)));
                half3 root = ground * _RootDark * half3(1.0 - _RootCool * 0.4, 1.0, 1.0 + _RootCool * 0.5);
                half3 top = ground * _TipLight * half3(1.0 + _TipWarm, 1.0 + _TipWarm * 0.55, 1.0 - _TipWarm * 0.7);
                half3 col = lerp(root, top, pow(tip, _GradientPower));
                col *= lerp(1.0, i.color.r, _Variation * 4.0);
                col *= 1.0 + wave * _WaveLight * (0.3 + 0.7 * tip);

                // Soft, mostly-upward normal so the field is lit as one surface rather than as thousands of cards.
                half3 bladeN = normalize(TransformObjectToWorldDir(i.normalOS));
                half3 n = normalize(lerp(bladeN, half3(0, 1, 0), _UpBias));

                o.positionWS = positionWS;
                o.positionCS = TransformWorldToHClip(positionWS);
                o.normalWS = n;
                o.color = half4(col, tip);
                o.fogFactor = ComputeFogFactor(o.positionCS.z);
            #if defined(_MAIN_LIGHT_SHADOWS_SCREEN)
                VertexPositionInputs vp = (VertexPositionInputs)0;
                vp.positionWS = positionWS;
                vp.positionCS = o.positionCS;
                vp.positionNDC = ComputeScreenPos(o.positionCS);
                o.shadowCoord = GetShadowCoord(vp);
            #endif
                return o;
            }

            half4 Frag(Varyings i) : SV_Target
            {
                half3 n = normalize(i.normalWS);
            #if defined(_MAIN_LIGHT_SHADOWS_SCREEN)
                float4 shadowCoord = i.shadowCoord;
            #else
                float4 shadowCoord = TransformWorldToShadowCoord(i.positionWS);
            #endif
                half4 shadowMask = half4(1, 1, 1, 1);
                Light mainLight = GetMainLight(shadowCoord, i.positionWS, shadowMask);

                half ndl = saturate((dot(n, mainLight.direction) + _Wrap) / (1.0h + _Wrap));
                half atten = mainLight.shadowAttenuation * mainLight.distanceAttenuation;
                half ramp = ToonRamp(ndl * atten);
                half3 lit = lerp(_ShadowColor.rgb, half3(1, 1, 1), ramp) * mainLight.color;
                half3 ambient = SampleSH(n) * _AmbientStrength;

                half3 base = lerp(i.color.rgb, half3(0.80h, 0.84h, 0.90h), saturate(_SnowAmount) * 0.85h);
                half3 col = base * (lit + ambient);
                col *= 1.0h + i.color.a * _TipGlow * ramp;
                col = MixFog(col, i.fogFactor);
                return half4(col, 1);
            }
            ENDHLSL
        }

        // ------------------------------------------------------------------------------------------------------
        // Depth only (so the depth texture / water foam / SSAO see the grass with the same wind and fade).
        Pass
        {
            Name "DepthOnly"
            Tags { "LightMode" = "DepthOnly" }

            ZWrite On
            ColorMask R
            Cull Off

            HLSLPROGRAM
            #pragma target 4.5
            #pragma exclude_renderers gles gles3 glcore
            #pragma vertex   DepthVert
            #pragma fragment DepthFrag
            #pragma multi_compile_instancing

            struct DVaryings { float4 positionCS : SV_POSITION; };

            DVaryings DepthVert(GrassAttributes i)
            {
                DVaryings o;
                UNITY_SETUP_INSTANCE_ID(i);
                float3 originWS = TransformObjectToWorld(float3(0, 0, 0));
                float wave;
                float3 positionWS = GrassWorldPosition(i.positionOS.xyz, saturate(i.uv.y), originWS, i.color.g, wave);
                o.positionCS = TransformWorldToHClip(positionWS);
                return o;
            }

            float DepthFrag(DVaryings i) : SV_Target { return i.positionCS.z; }
            ENDHLSL
        }
    }

    FallBack Off
}
