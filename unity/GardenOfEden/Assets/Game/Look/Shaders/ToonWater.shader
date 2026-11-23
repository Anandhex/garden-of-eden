// GardenOfEden/ToonWater - simple stylised water for URP 17.
//  * colour by depth (shallow -> deep) and alpha by depth, from the camera depth texture
//  * toon highlights: two scrolling noise layers, thresholded into soft white glints (no normal map)
//  * foam where the water meets anything solid (depth difference), wobbled by noise
// REQUIRES the URP asset's "Depth Texture" option (Quality > Depth Texture) to be on. Perspective cameras only.
Shader "GardenOfEden/ToonWater"
{
    Properties
    {
        [Header(Depth colour)]
        _ShallowColor("Shallow Colour", Color) = (0.38, 0.80, 0.78, 1)
        _DeepColor("Deep Colour", Color) = (0.08, 0.30, 0.52, 1)
        _DepthMax("Depth For Full Deep (m)", Range(0.1, 20)) = 3.5
        _ShallowAlpha("Shallow Alpha", Range(0, 1)) = 0.55
        _DeepAlpha("Deep Alpha", Range(0, 1)) = 0.92

        [Header(Highlights)]
        [HDR] _HighlightColor("Highlight Colour", Color) = (1, 1, 1, 1)
        _HighlightScale("Highlight Scale (1/m)", Range(0.05, 4)) = 0.7
        _HighlightSpeed("Highlight Speed", Range(0, 1)) = 0.12
        _HighlightThreshold("Highlight Threshold", Range(0.3, 0.9)) = 0.64
        _HighlightSoftness("Highlight Softness", Range(0.005, 0.3)) = 0.05
        _HighlightStrength("Highlight Strength", Range(0, 1)) = 0.55

        [Header(Foam)]
        _FoamColor("Foam Colour", Color) = (1, 1, 1, 1)
        _FoamWidth("Foam Width (m)", Range(0.02, 2)) = 0.45
        _FoamNoiseScale("Foam Noise Scale (1/m)", Range(0.1, 8)) = 1.8
        _FoamSpeed("Foam Speed", Range(0, 2)) = 0.35

        [Header(Light)]
        _SunInfluence("Sun Influence", Range(0, 1.5)) = 0.7
        _AmbientStrength("Ambient Strength", Range(0, 2)) = 0.7
    }

    SubShader
    {
        Tags
        {
            "RenderType" = "Transparent"
            "RenderPipeline" = "UniversalPipeline"
            "Queue" = "Transparent"
        }

        Pass
        {
            Name "ForwardLit"
            Tags { "LightMode" = "UniversalForward" }

            Blend SrcAlpha OneMinusSrcAlpha
            ZWrite Off
            ZTest LEqual
            Cull Back

            HLSLPROGRAM
            #pragma target 3.5
            #pragma vertex   Vert
            #pragma fragment Frag
            #pragma multi_compile_fog

            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Lighting.hlsl"
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/DeclareDepthTexture.hlsl"

            CBUFFER_START(UnityPerMaterial)
                half4 _ShallowColor;
                half4 _DeepColor;
                half  _DepthMax;
                half  _ShallowAlpha;
                half  _DeepAlpha;
                half4 _HighlightColor;
                half  _HighlightScale;
                half  _HighlightSpeed;
                half  _HighlightThreshold;
                half  _HighlightSoftness;
                half  _HighlightStrength;
                half4 _FoamColor;
                half  _FoamWidth;
                half  _FoamNoiseScale;
                half  _FoamSpeed;
                half  _SunInfluence;
                half  _AmbientStrength;
            CBUFFER_END

            struct Attributes { float4 positionOS : POSITION; };
            struct Varyings
            {
                float4 positionCS : SV_POSITION;
                float3 positionWS : TEXCOORD0;
                half   fogFactor  : TEXCOORD1;
            };

            float WaterHash21(float2 p)
            {
                p = frac(p * float2(123.34, 456.21));
                p += dot(p, p + 45.32);
                return frac(p.x * p.y);
            }

            float WaterNoise(float2 p)
            {
                float2 i = floor(p);
                float2 f = frac(p);
                f = f * f * (3.0 - 2.0 * f);
                float a = WaterHash21(i);
                float b = WaterHash21(i + float2(1, 0));
                float c = WaterHash21(i + float2(0, 1));
                float d = WaterHash21(i + float2(1, 1));
                return lerp(lerp(a, b, f.x), lerp(c, d, f.x), f.y);
            }

            Varyings Vert(Attributes i)
            {
                Varyings o;
                VertexPositionInputs vp = GetVertexPositionInputs(i.positionOS.xyz);
                o.positionCS = vp.positionCS;
                o.positionWS = vp.positionWS;
                o.fogFactor = ComputeFogFactor(vp.positionCS.z);
                return o;
            }

            half4 Frag(Varyings i) : SV_Target
            {
                // Water thickness along the view ray: scene depth behind the surface minus the surface's own depth.
                float2 suv = GetNormalizedScreenSpaceUV(i.positionCS);
                float sceneEye = LinearEyeDepth(SampleSceneDepth(suv), _ZBufferParams);
                float surfEye = -TransformWorldToView(i.positionWS).z;
                float diff = max(sceneEye - surfEye, 0.0);

                float t = saturate(diff / max(_DepthMax, 0.01));
                half3 water = lerp(_ShallowColor.rgb, _DeepColor.rgb, t);
                half alpha = lerp(_ShallowAlpha, _DeepAlpha, t);

                // Toon highlights: two noise layers drifting in different directions, thresholded.
                float2 wuv = i.positionWS.xz * _HighlightScale;
                float tm = _Time.y * _HighlightSpeed;
                float h1 = WaterNoise(wuv + float2(tm, tm * 0.6));
                float h2 = WaterNoise(wuv * 1.7 + float2(-tm * 0.8, tm * 0.5) + 7.1);
                half hl = smoothstep(_HighlightThreshold, _HighlightThreshold + _HighlightSoftness, (h1 + h2) * 0.5);

                // Foam at the shore (and round anything standing in the water), its edge wobbled by noise.
                float fn = WaterNoise(i.positionWS.xz * _FoamNoiseScale + float2(_Time.y * _FoamSpeed, -_Time.y * _FoamSpeed * 0.7));
                float width = _FoamWidth * (0.55 + 0.9 * fn);
                half foam = 1.0 - smoothstep(width * 0.7, width, diff);

                // Lit by the sun's colour and the sky ambient, so it darkens at night with everything else.
                Light mainLight = GetMainLight();
                half3 L = mainLight.color * _SunInfluence + SampleSH(half3(0, 1, 0)) * _AmbientStrength;
                L = min(L, half3(1.3, 1.3, 1.3));

                half3 col = water * L;
                col = lerp(col, _HighlightColor.rgb * saturate(L), hl * _HighlightStrength);
                col = lerp(col, _FoamColor.rgb * saturate(L + 0.2), foam);
                alpha = saturate(max(alpha, foam * _FoamColor.a));

                col = MixFog(col, i.fogFactor);
                return half4(col, alpha);
            }
            ENDHLSL
        }
    }

    FallBack Off
}
