// GardenOfEden/Hair - alpha-tested hair, brow and lash cards for the Blender characters (URP 17, SRP Batcher compatible).
// _BaseMap alpha = coverage (clipped at _Cutoff), RGB = strand shading; tinted by the vertex colour (the person's hair colour, baked
// by the builder) times _BaseColor. Two-sided, soft wrap light, a soft anisotropic-looking sheen band and the cool rim, all from
// CharacterLighting.hlsl so it sits with GardenOfEden/Character. Without a texture it renders solid (hair shells of the current parts).
Shader "GardenOfEden/Hair"
{
    Properties
    {
        [MainTexture] _BaseMap("Strands (A = coverage)", 2D) = "white" {}
        [MainColor] _BaseColor("Tint", Color) = (1,1,1,1)
        _Cutoff("Alpha cutoff", Range(0, 1)) = 0.4
        _Sheen("Sheen", Range(0, 2)) = 0.5
        _SheenShift("Sheen shift", Range(-1, 1)) = 0.15

        [Header(Light)]
        _ShadowColor("Shadow tint (warm purple-brown, never black)", Color) = (0.56, 0.45, 0.55, 1)
        _Wrap("Light wrap (soft terminator)", Range(0, 1)) = 0.55
        _AmbientStrength("Ambient", Range(0, 2)) = 0.75
        _AdditionalStrength("Lamps and fires", Range(0, 3)) = 1
        _SpecStrength("Specular", Range(0, 2)) = 1
        [Header(Skin)]
        _SssColor("Terminator warmth (fake subsurface)", Color) = (0.95, 0.36, 0.26, 1)
        _SssStrength("Terminator strength", Range(0, 1.5)) = 0.7
        [Header(Rim)]
        _RimColor("Warm rim", Color) = (1.0, 0.86, 0.68, 1)
        _RimStrength("Warm rim strength", Range(0, 2)) = 0.25
        _CoolRim("Cool rim and bounce (blue-teal)", Color) = (0.30, 0.72, 0.84, 1)
        _CoolRimStrength("Cool rim strength", Range(0, 1.5)) = 0.45
        [Header(Occlusion fade)]
        _Fade("Fade (screen-door dither)", Range(0, 1)) = 0
        [HideInInspector] _CutPlane("Cut plane (nx,ny,nz,d)", Vector) = (0,0,0,100000)
        [HideInInspector] _CutFade("Cut fade", Range(0, 1)) = 0

        [Enum(UnityEngine.Rendering.CullMode)] _Cull("Cull", Float) = 0
    }
    SubShader
    {
        Tags { "RenderType" = "TransparentCutout" "RenderPipeline" = "UniversalPipeline" "Queue" = "AlphaTest" }
        HLSLINCLUDE
        #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
        TEXTURE2D(_BaseMap); SAMPLER(sampler_BaseMap);
        CBUFFER_START(UnityPerMaterial)
            float4 _BaseMap_ST;
            half4  _BaseColor;
            half   _Cutoff;
            half   _Sheen;
            half   _SheenShift;
            float  _Cull;

            half4  _ShadowColor;
            half   _Wrap;
            half   _AmbientStrength;
            half   _AdditionalStrength;
            half   _SpecStrength;
            half4  _SssColor;
            half   _SssStrength;
            half4  _RimColor;
            half   _RimStrength;
            half4  _CoolRim;
            half   _CoolRimStrength;
            half   _Fade;
            float4 _CutPlane;
            half   _CutFade;

        CBUFFER_END

        half DitherThreshold(float4 positionCS)
        {
            static const float bayer[16] = { 0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0 };
            uint2 p = uint2(positionCS.xy) & 3u;
            return (bayer[p.y * 4u + p.x] + 0.5) / 16.0;
        }
        void FadeClip(float4 positionCS, float3 positionWS, half3 normalWS)
        {
            half f = _Fade;
            if (_CutFade > 0.001h && abs(normalWS.y) < 0.5h && dot(positionWS, _CutPlane.xyz) > _CutPlane.w) f = max(f, _CutFade);
            if (f > 0.001h) clip(DitherThreshold(positionCS) - f);
        }

        ENDHLSL
        Pass
        {
            Name "ForwardLit"
            Tags { "LightMode" = "UniversalForward" }
            Cull [_Cull] ZWrite On ZTest LEqual
            HLSLPROGRAM

            #pragma target 4.5
            #pragma exclude_renderers gles gles3 glcore
            #pragma multi_compile _ _MAIN_LIGHT_SHADOWS _MAIN_LIGHT_SHADOWS_CASCADE _MAIN_LIGHT_SHADOWS_SCREEN
            #pragma multi_compile _ _CLUSTER_LIGHT_LOOP
            #pragma multi_compile _ _ADDITIONAL_LIGHTS
            #pragma multi_compile_fragment _ _ADDITIONAL_LIGHT_SHADOWS
            #pragma multi_compile_fragment _ _SHADOWS_SOFT _SHADOWS_SOFT_LOW _SHADOWS_SOFT_MEDIUM _SHADOWS_SOFT_HIGH
            #pragma multi_compile_fog

            #pragma vertex Vert
            #pragma fragment Frag
            #include "CharacterLighting.hlsl"
            struct Attributes { float4 positionOS : POSITION; float3 normalOS : NORMAL; float4 tangentOS : TANGENT; float2 uv : TEXCOORD0; half4 color : COLOR; };
            struct Varyings { float4 positionCS : SV_POSITION; float2 uv : TEXCOORD0; float3 positionWS : TEXCOORD1; half3 normalWS : TEXCOORD2; half fogFactor : TEXCOORD3; half4 color : TEXCOORD4; half3 tangentWS : TEXCOORD5; };
            Varyings Vert(Attributes i)
            {
                Varyings o;
                VertexPositionInputs vp = GetVertexPositionInputs(i.positionOS.xyz);
                VertexNormalInputs vn = GetVertexNormalInputs(i.normalOS, i.tangentOS);
                o.positionCS = vp.positionCS; o.positionWS = vp.positionWS; o.normalWS = vn.normalWS; o.tangentWS = vn.tangentWS;
                o.uv = TRANSFORM_TEX(i.uv, _BaseMap); o.fogFactor = ComputeFogFactor(vp.positionCS.z); o.color = i.color;
                return o;
            }
            half4 Frag(Varyings i, bool front : SV_IsFrontFace) : SV_Target
            {
                half4 tex = SAMPLE_TEXTURE2D(_BaseMap, sampler_BaseMap, i.uv);
                clip(tex.a - _Cutoff);
                half3 n = normalize(i.normalWS) * (front ? 1.0h : -1.0h);
                FadeClip(i.positionCS, i.positionWS, n);
                half3 viewDir = GetWorldSpaceNormalizeViewDir(i.positionWS);
                CharSurface s;
                s.albedo = tex.rgb * i.color.rgb * _BaseColor.rgb; s.normalWS = n; s.skin = 0; s.gloss = 0.1h; s.smoothness = 0.3h; s.ao = 1;
                half3 col = CharacterShade(s, i.positionWS, i.positionCS, viewDir);
                // strand sheen (Kajiya-Kay lite) along the card tangent
                Light ml = GetMainLight();
                half3 t = normalize(i.tangentWS + n * _SheenShift);
                half3 h = normalize(ml.direction + viewDir);
                half th = dot(t, h);
                half sheen = pow(sqrt(saturate(1.0h - th * th)), 40.0h);
                col += ml.color * s.albedo * (sheen * _Sheen);
                return half4(MixFog(col, i.fogFactor), 1);
            }
            ENDHLSL
        }

        Pass
        {
            Name "ShadowCaster"
            Tags { "LightMode" = "ShadowCaster" }
            ZWrite On ZTest LEqual ColorMask 0 Cull [_Cull]
            HLSLPROGRAM
            #pragma target 3.5
            #pragma exclude_renderers gles gles3 glcore
            #pragma vertex ShadowVert
            #pragma fragment ShadowFrag
            #pragma multi_compile_vertex _ _CASTING_PUNCTUAL_LIGHT_SHADOW
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Shadows.hlsl"
            float3 _LightDirection; float3 _LightPosition;
            struct Attributes { float4 positionOS : POSITION; float3 normalOS : NORMAL; float2 uv : TEXCOORD0; };
            struct Varyings { float4 positionCS : SV_POSITION; float2 uv : TEXCOORD0; };
            Varyings ShadowVert(Attributes i)
            {
                Varyings o;
                float3 positionWS = TransformObjectToWorld(i.positionOS.xyz);
                float3 normalWS = TransformObjectToWorldNormal(i.normalOS);
            #if _CASTING_PUNCTUAL_LIGHT_SHADOW
                float3 ld = normalize(_LightPosition - positionWS);
            #else
                float3 ld = _LightDirection;
            #endif
                float4 cs = TransformWorldToHClip(ApplyShadowBias(positionWS, normalWS, ld));
            #if UNITY_REVERSED_Z
                cs.z = min(cs.z, UNITY_NEAR_CLIP_VALUE);
            #else
                cs.z = max(cs.z, UNITY_NEAR_CLIP_VALUE);
            #endif
                o.positionCS = cs; o.uv = TRANSFORM_TEX(i.uv, _BaseMap);
                return o;
            }
            half4 ShadowFrag(Varyings i) : SV_Target { half a = SAMPLE_TEXTURE2D(_BaseMap, sampler_BaseMap, i.uv).a; clip(a - _Cutoff); return 0; }
            ENDHLSL
        }
        Pass
        {
            Name "DepthOnly"
            Tags { "LightMode" = "DepthOnly" }
            ZWrite On ColorMask R Cull [_Cull]
            HLSLPROGRAM
            #pragma target 3.5
            #pragma exclude_renderers gles gles3 glcore
            #pragma vertex DepthVert
            #pragma fragment DepthFrag
            struct Attributes { float4 positionOS : POSITION; float3 normalOS : NORMAL; float2 uv : TEXCOORD0; };
            struct Varyings { float4 positionCS : SV_POSITION; float3 positionWS : TEXCOORD6; half3 normalWS : TEXCOORD7; float2 uv : TEXCOORD0; };
            Varyings DepthVert(Attributes i)
            {
                Varyings o;
                o.positionCS = TransformObjectToHClip(i.positionOS.xyz);
                o.positionWS = TransformObjectToWorld(i.positionOS.xyz);
                o.normalWS = TransformObjectToWorldNormal(i.normalOS); o.uv = TRANSFORM_TEX(i.uv, _BaseMap);
                return o;
            }
            float DepthFrag(Varyings i) : SV_Target { half a = SAMPLE_TEXTURE2D(_BaseMap, sampler_BaseMap, i.uv).a; clip(a - _Cutoff); FadeClip(i.positionCS, i.positionWS, normalize(i.normalWS)); return i.positionCS.z; }
            ENDHLSL
        }
        Pass
        {
            Name "DepthNormals"
            Tags { "LightMode" = "DepthNormals" }
            ZWrite On Cull [_Cull]
            HLSLPROGRAM
            #pragma target 3.5
            #pragma exclude_renderers gles gles3 glcore
            #pragma vertex DNVert
            #pragma fragment DNFrag
            #pragma multi_compile_fragment _ _GBUFFER_NORMALS_OCT
            struct Attributes { float4 positionOS : POSITION; float3 normalOS : NORMAL; float2 uv : TEXCOORD0; };
            struct Varyings { float4 positionCS : SV_POSITION; half3 normalWS : TEXCOORD6; float3 positionWS : TEXCOORD7; float2 uv : TEXCOORD0; };
            Varyings DNVert(Attributes i)
            {
                Varyings o;
                o.positionCS = TransformObjectToHClip(i.positionOS.xyz);
                o.positionWS = TransformObjectToWorld(i.positionOS.xyz);
                o.normalWS = TransformObjectToWorldNormal(i.normalOS); o.uv = TRANSFORM_TEX(i.uv, _BaseMap);
                return o;
            }
            half4 DNFrag(Varyings i) : SV_Target
            {
                half a = SAMPLE_TEXTURE2D(_BaseMap, sampler_BaseMap, i.uv).a; clip(a - _Cutoff);
                half3 n = normalize(i.normalWS);
                FadeClip(i.positionCS, i.positionWS, n);
            #if defined(_GBUFFER_NORMALS_OCT)
                float2 oct = PackNormalOctQuadEncode(n);
                return half4(PackFloat2To888(saturate(oct * 0.5 + 0.5)), 0.0);
            #else
                return half4(n, 0.0);
            #endif
            }
            ENDHLSL
        }

    }
    FallBack Off
}
