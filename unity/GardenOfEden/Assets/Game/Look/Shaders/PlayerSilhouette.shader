// GardenOfEden/PlayerSilhouette - the player seen through walls, as a soft tinted shape.
// Used as the override material of a URP Render Objects feature that draws only the "Player" layer, after the opaque
// pass, with depth test Greater: it paints exactly the pixels where the player is BEHIND something. The global
// _SilhouetteOn (0..1, set by World/Occlusion.cs) switches it on while a building hides the player.
Shader "GardenOfEden/PlayerSilhouette"
{
    Properties
    {
        _Tint("Tint", Color) = (0.55, 0.78, 1.0, 1)
        _Alpha("Alpha", Range(0, 1)) = 0.5
        _RimBoost("Rim Boost", Range(0, 1)) = 0.5
    }
    SubShader
    {
        Tags { "RenderType" = "Transparent" "RenderPipeline" = "UniversalPipeline" "Queue" = "Transparent" }
        Pass
        {
            Name "Silhouette"
            Tags { "LightMode" = "UniversalForward" }
            ZTest Greater
            ZWrite Off
            Cull Back
            Blend SrcAlpha OneMinusSrcAlpha

            HLSLPROGRAM
            #pragma target 3.5
            #pragma exclude_renderers gles gles3 glcore
            #pragma vertex Vert
            #pragma fragment Frag
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"

            CBUFFER_START(UnityPerMaterial)
                half4 _Tint;
                half  _Alpha;
                half  _RimBoost;
            CBUFFER_END
            half _SilhouetteOn;

            struct Attributes { float4 positionOS : POSITION; float3 normalOS : NORMAL; };
            struct Varyings { float4 positionCS : SV_POSITION; float3 positionWS : TEXCOORD0; half3 normalWS : TEXCOORD1; };

            Varyings Vert(Attributes i)
            {
                Varyings o;
                o.positionWS = TransformObjectToWorld(i.positionOS.xyz);
                o.positionCS = TransformWorldToHClip(o.positionWS);
                o.normalWS = TransformObjectToWorldNormal(i.normalOS);
                return o;
            }

            half4 Frag(Varyings i) : SV_Target
            {
                half on = saturate(_SilhouetteOn);
                if (on < 0.01h) discard;
                half3 n = normalize(i.normalWS);
                half3 v = GetWorldSpaceNormalizeViewDir(i.positionWS);
                half rim = pow(1.0h - saturate(dot(n, v)), 1.6h);
                half a = _Alpha * lerp(1.0h - _RimBoost * 0.6h, 1.0h, rim) * on;
                half3 c = lerp(_Tint.rgb, half3(1, 1, 1), rim * 0.35h);
                return half4(c, a);
            }
            ENDHLSL
        }
    }
    FallBack Off
}
