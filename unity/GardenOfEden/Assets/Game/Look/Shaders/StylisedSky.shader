// GardenOfEden/StylisedSky - procedural skybox for URP: horizon/zenith gradient, sun and moon discs with a soft halo,
// soft painterly two-tone clouds (noise, toon-stepped), stars at night. Every look parameter is a material property so
// DayNight.cs can drive it from script (set colours/amounts with Material.SetColor/SetFloat/SetVector).
// Assign the material in Lighting > Environment > Skybox Material (DayNight does it for you).
Shader "GardenOfEden/StylisedSky"
{
    Properties
    {
        [Header(Gradient)]
        _HorizonColor("Horizon Colour", Color) = (0.74, 0.80, 0.88, 1)
        _ZenithColor("Zenith Colour", Color) = (0.30, 0.56, 0.92, 1)
        _GroundColor("Below-horizon Colour", Color) = (0.55, 0.60, 0.66, 1)
        _GradientPower("Gradient Power", Range(0.1, 2)) = 0.55
        _GroundBlend("Below-horizon Blend", Range(1, 40)) = 12

        [Header(Sun and moon)]
        _SunDirection("Sun Direction (to sun)", Vector) = (0.3, 0.8, 0.5, 0)
        [HDR] _SunColor("Sun Colour", Color) = (1.6, 1.45, 1.15, 1)
        _SunSize("Sun Radius (radians)", Range(0.005, 0.2)) = 0.045
        _SunSoftness("Sun Edge Softness (radians)", Range(0.001, 0.1)) = 0.015
        _SunHalo("Sun Halo Strength", Range(0, 2)) = 0.45
        _SunHaloPower("Sun Halo Tightness", Range(2, 256)) = 24
        _SunVisibility("Sun Visibility (weather)", Range(0, 1)) = 1
        _MoonDirection("Moon Direction (to moon)", Vector) = (-0.3, -0.8, -0.5, 0)
        _MoonColor("Moon Colour", Color) = (0.85, 0.9, 1.0, 1)
        _MoonSize("Moon Radius (radians)", Range(0.005, 0.2)) = 0.035

        [Header(Clouds)]
        _CloudColor("Cloud Lit Colour", Color) = (1, 1, 1, 1)
        _CloudShadowColor("Cloud Shade Colour", Color) = (0.62, 0.68, 0.82, 1)
        _CloudCover("Cloud Cover", Range(0, 1)) = 0.45
        _CloudSoftness("Cloud Edge Softness", Range(0.01, 0.5)) = 0.08
        _CloudOpacity("Cloud Opacity", Range(0, 1)) = 0.95
        _CloudScale("Cloud Scale", Range(0.1, 6)) = 1.4
        _CloudSpeed("Cloud Speed", Range(0, 0.2)) = 0.012
        _CloudHorizonLift("Cloud Horizon Lift", Range(0.05, 1)) = 0.3

        [Header(Night)]
        _StarAmount("Star Amount (0 day .. 1 night)", Range(0, 1)) = 0
        _StarScale("Star Grid Scale", Range(20, 300)) = 110
        _StarDensity("Star Density", Range(0, 0.3)) = 0.07
        _StarSize("Star Size", Range(0.02, 0.4)) = 0.14
        _StarBrightness("Star Brightness", Range(0, 4)) = 1.6
    }

    SubShader
    {
        Tags
        {
            "RenderType" = "Background"
            "Queue" = "Background"
            "RenderPipeline" = "UniversalPipeline"
            "PreviewType" = "Skybox"
        }
        Cull Off
        ZWrite Off

        Pass
        {
            Name "Sky"

            HLSLPROGRAM
            #pragma target 3.5
            #pragma vertex   Vert
            #pragma fragment Frag

            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"

            CBUFFER_START(UnityPerMaterial)
                half4  _HorizonColor;
                half4  _ZenithColor;
                half4  _GroundColor;
                half   _GradientPower;
                half   _GroundBlend;
                float4 _SunDirection;
                half4  _SunColor;
                half   _SunSize;
                half   _SunSoftness;
                half   _SunHalo;
                half   _SunHaloPower;
                half   _SunVisibility;
                float4 _MoonDirection;
                half4  _MoonColor;
                half   _MoonSize;
                half4  _CloudColor;
                half4  _CloudShadowColor;
                half   _CloudCover;
                half   _CloudSoftness;
                half   _CloudOpacity;
                half   _CloudScale;
                half   _CloudSpeed;
                half   _CloudHorizonLift;
                half   _StarAmount;
                half   _StarScale;
                half   _StarDensity;
                half   _StarSize;
                half   _StarBrightness;
            CBUFFER_END

            struct Attributes { float4 positionOS : POSITION; };
            struct Varyings
            {
                float4 positionCS : SV_POSITION;
                float3 dir        : TEXCOORD0;
            };

            Varyings Vert(Attributes i)
            {
                Varyings o;
                o.positionCS = TransformObjectToHClip(i.positionOS.xyz);
                o.dir = i.positionOS.xyz;
                return o;
            }

            float SkyHash21(float2 p)
            {
                p = frac(p * float2(123.34, 456.21));
                p += dot(p, p + 45.32);
                return frac(p.x * p.y);
            }

            float3 SkyHash33(float3 p3)
            {
                p3 = frac(p3 * float3(0.1031, 0.1030, 0.0973));
                p3 += dot(p3, p3.yxz + 33.33);
                return frac((p3.xxy + p3.yxx) * p3.zyx);
            }

            float SkyNoise(float2 p)
            {
                float2 i = floor(p);
                float2 f = frac(p);
                f = f * f * (3.0 - 2.0 * f);
                float a = SkyHash21(i);
                float b = SkyHash21(i + float2(1, 0));
                float c = SkyHash21(i + float2(0, 1));
                float d = SkyHash21(i + float2(1, 1));
                return lerp(lerp(a, b, f.x), lerp(c, d, f.x), f.y);
            }

            float SkyFbm(float2 p)
            {
                float v = 0.0;
                float a = 0.5;
                [unroll] for (int k = 0; k < 4; k++)
                {
                    v += a * SkyNoise(p);
                    p = p * 2.03 + 11.7;
                    a *= 0.5;
                }
                return v / 0.9375; // sum of amplitudes, so the result is roughly 0..1
            }

            float Stars(float3 dir)
            {
                float3 sp = dir * _StarScale;
                float3 id = floor(sp);
                float3 f = frac(sp);
                float3 h = SkyHash33(id);
                float exists = step(1.0 - _StarDensity, h.x);
                float3 centre = 0.25 + 0.5 * SkyHash33(id + 7.7);
                float d = length(f - centre);
                float twinkle = 0.7 + 0.3 * sin(_Time.y * (1.0 + h.z * 3.0) + h.y * 20.0);
                return exists * smoothstep(_StarSize, 0.0, d) * twinkle * (0.4 + 0.6 * h.z);
            }

            half4 Frag(Varyings i) : SV_Target
            {
                float3 dir = normalize(i.dir);
                float up = saturate(dir.y);

                // ---- gradient, with a firm ground tone below the horizon ----
                half3 sky = lerp(_HorizonColor.rgb, _ZenithColor.rgb, pow(up, _GradientPower));
                sky = lerp(sky, _GroundColor.rgb, smoothstep(0.0, 1.0, saturate(-dir.y * _GroundBlend)));

                // ---- sun halo (warm glow near the sun, also colours the horizon at dawn and dusk) ----
                float3 sunDir = normalize(_SunDirection.xyz);
                float sd = dot(dir, sunDir);
                float halo = pow(saturate(sd), _SunHaloPower) * _SunHalo * _SunVisibility;
                sky += _SunColor.rgb * halo * 0.35;

                // ---- clouds: noise on a plane above the viewer, two-tone toon shading ----
                float2 cuv = dir.xz / (max(dir.y, 0.0) + _CloudHorizonLift);
                cuv = cuv * _CloudScale + _Time.y * _CloudSpeed * float2(1.0, 0.35);
                float n  = SkyFbm(cuv);
                // A second sample shifted toward the sun: where density falls toward the sun, the cloud edge is lit.
                float n2 = SkyFbm(cuv + sunDir.xz * 0.10);
                float thresh = 1.0 - _CloudCover;
                float mask = smoothstep(thresh - _CloudSoftness, thresh + _CloudSoftness, n);
                mask *= smoothstep(0.0, 0.22, dir.y);
                float lit = smoothstep(0.38, 0.62, 0.5 + (n - n2) * 3.0);
                lit = saturate(lit + pow(saturate(sd), 8.0) * 0.35 * _SunVisibility);
                half3 cloud = lerp(_CloudShadowColor.rgb, _CloudColor.rgb, lit);
                float cloudA = mask * _CloudOpacity;
                sky = lerp(sky, cloud, cloudA);

                // ---- stars (night only), hidden behind clouds ----
                if (_StarAmount > 0.001 && dir.y > 0.0)
                {
                    float s = Stars(dir) * _StarAmount * smoothstep(0.0, 0.25, dir.y) * (1.0 - cloudA);
                    sky += s * _StarBrightness;
                }

                // ---- sun and moon discs (soft edge; dimmed by clouds and weather) ----
                float sunAng = acos(clamp(sd, -1.0, 1.0));
                float sunDisc = 1.0 - smoothstep(_SunSize, _SunSize + _SunSoftness, sunAng);
                sunDisc *= smoothstep(-0.03, 0.01, dir.y) * _SunVisibility * (1.0 - cloudA * 0.85);
                sky = lerp(sky, _SunColor.rgb, saturate(sunDisc));

                float3 moonDir = normalize(_MoonDirection.xyz);
                float moonAng = acos(clamp(dot(dir, moonDir), -1.0, 1.0));
                float moonDisc = 1.0 - smoothstep(_MoonSize, _MoonSize + 0.008, moonAng);
                moonDisc *= smoothstep(-0.03, 0.01, dir.y) * _StarAmount * (1.0 - cloudA * 0.9);
                sky = lerp(sky, _MoonColor.rgb, saturate(moonDisc));

                return half4(sky, 1);
            }
            ENDHLSL
        }
    }

    FallBack Off
}
