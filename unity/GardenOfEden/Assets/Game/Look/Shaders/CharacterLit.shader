// GardenOfEden/Character - soft stylised skin and cloth for the Blender characters (URP 17, SRP Batcher compatible).
// Look: roadmap/game/plans/g8-art-direction.md and the user's reference (warm key, cool blue-teal rim, smooth matte skin with a warm
// subsurface terminator, matte layered cloth with warm gold accents). Lighting is shared with GardenOfEden/Hair (CharacterLighting.hlsl).
//
// Two modes (the person builder makes one submesh of each per person, two draw calls):
//   Skin (_Cloth = 0): the per-person atlas (skin colour + face decals + irises baked in), optional skin texture set from the art
//     pipeline (_SkinNormal tangent-space normal map, _SkinMask R = roughness, G = AO/cavity, B = detail/blush), all on the shared 0..1
//     atlas UVs. Vertex colour marks special areas: alpha 0 = eyeball (glossy; _Blink lerps it to closed-lid skin), alpha ~0.5 = mouth
//     interior/teeth/tongue (albedo = vertex colour), alpha 1 = skin.
//   Cloth (_Cloth = 1): vertex colour = the garment colour (look.tint / look.trim baked in by the builder); vertex alpha picks a slice of
//     the shared detail Texture2DArray (weave, quilt, stitch, leather, metal, stripes, plaid, cord) that modulates it; slice 15 = hair
//     (flat colour with a soft sheen band). Matte, metals a little glossier.
Shader "GardenOfEden/Character"
{
    Properties
    {
        [MainTexture] _BaseMap("Atlas (skin mode)", 2D) = "white" {}
        [MainColor] _BaseColor("Base colour", Color) = (1,1,1,1)
        [Toggle] _Cloth("Cloth mode (vertex colour x detail array)", Float) = 0
        _DetailArray("Cloth detail array", 2DArray) = "white" {}
        _DetailStrength("Detail contrast", Range(0, 1)) = 0.55
        _DetailScale("Detail tiling", Float) = 1
        _PlainBody("Plain body (vertex colour, no atlas)", Float) = 0
        _UseVertexColor("Read vertex colours (0 for meshes without them: creatures)", Float) = 1
        [Toggle(_SKINMAPS)] _UseSkinMaps("Use skin texture set", Float) = 0
        [NoScaleOffset][Normal] _SkinNormal("Skin normal map", 2D) = "bump" {}
        [NoScaleOffset] _SkinMask("Skin mask (R rough, G AO, B blush)", 2D) = "white" {}
        [NoScaleOffset] _SkinAlbedo("Head albedo of the skin tone (head UVs)", 2D) = "white" {}
        _SkinAlbedoBase("That tone's base colour", Color) = (1,1,1,1)
        _NormalStrength("Normal strength", Range(0, 2)) = 1
        _SkinGloss("Skin gloss", Range(0, 1)) = 0.22
        _EyeGloss("Eye gloss", Range(0, 4)) = 2.5
        _Blink("Blink (0 open, 1 closed)", Range(0, 1)) = 0
        _LidColor("Closed lid colour (x atlas skin)", Color) = (0.86, 0.72, 0.68, 1)

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

        [Enum(UnityEngine.Rendering.CullMode)] _Cull("Cull", Float) = 2
    }

    SubShader
    {
        Tags { "RenderType" = "Opaque" "RenderPipeline" = "UniversalPipeline" "UniversalMaterialType" = "SimpleLit" "Queue" = "Geometry" }
        LOD 200

        HLSLINCLUDE
        #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
        TEXTURE2D(_BaseMap);      SAMPLER(sampler_BaseMap);
        TEXTURE2D_ARRAY(_DetailArray); SAMPLER(sampler_DetailArray);
        TEXTURE2D(_SkinNormal);   SAMPLER(sampler_SkinNormal);
        TEXTURE2D(_SkinMask);     SAMPLER(sampler_SkinMask);
        TEXTURE2D(_SkinAlbedo);   SAMPLER(sampler_SkinAlbedo);
        CBUFFER_START(UnityPerMaterial)
            float4 _BaseMap_ST;
            half4  _BaseColor;
            half   _Cloth;
            half   _DetailStrength;
            float  _DetailScale;
            half   _PlainBody;
            half   _UseVertexColor;
            half   _NormalStrength;
            half   _SkinGloss;
            half   _EyeGloss;
            half   _Blink;
            half4  _LidColor;
            half4  _SkinAlbedoBase;
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

            #pragma shader_feature_local_fragment _SKINMAPS
            #pragma vertex Vert
            #pragma fragment Frag
            #include "CharacterLighting.hlsl"

            struct Attributes { float4 positionOS : POSITION; float3 normalOS : NORMAL; float4 tangentOS : TANGENT; float2 uv : TEXCOORD0; float2 uv1 : TEXCOORD1; half4 color : COLOR; };
            struct Varyings
            {
                float4 positionCS : SV_POSITION;
                float2 uv : TEXCOORD0;
                float2 uv1 : TEXCOORD6;
                float3 positionWS : TEXCOORD1;
                half3 normalWS : TEXCOORD2;
                half fogFactor : TEXCOORD3;
                half4 color : TEXCOORD4;
                half4 tangentWS : TEXCOORD5;
            };

            Varyings Vert(Attributes i)
            {
                Varyings o;
                VertexPositionInputs vp = GetVertexPositionInputs(i.positionOS.xyz);
                VertexNormalInputs vn = GetVertexNormalInputs(i.normalOS, i.tangentOS);
                o.positionCS = vp.positionCS;
                o.positionWS = vp.positionWS;
                o.normalWS = vn.normalWS;
                o.tangentWS = half4(vn.tangentWS, i.tangentOS.w * GetOddNegativeScale());
                o.uv = TRANSFORM_TEX(i.uv, _BaseMap);
                o.uv1 = i.uv1;
                o.fogFactor = ComputeFogFactor(vp.positionCS.z);
                o.color = i.color;
                return o;
            }

            half4 Frag(Varyings i) : SV_Target
            {
                half3 n = normalize(i.normalWS);
                FadeClip(i.positionCS, i.positionWS, n);
                half3 viewDir = GetWorldSpaceNormalizeViewDir(i.positionWS);
                i.color = lerp(half4(1, 1, 1, 1), i.color, _UseVertexColor);
                CharSurface s;
                s.skin = 0; s.gloss = 0.05h; s.smoothness = 0.2h; s.ao = 1;
                if (_Cloth > 0.5h)
                {
                    int slice = (int)floor(i.color.a * 255.0h / 16.0h);
                    half m = 1;
                    if (slice < 8)
                    {
                        half3 d = SAMPLE_TEXTURE2D_ARRAY(_DetailArray, sampler_DetailArray, i.uv * _DetailScale, slice).rgb;
                        half lum = dot(d, half3(0.333h, 0.333h, 0.333h));
                        m = lerp(1.0h, saturate(lum * 2.0h), _DetailStrength);
                        if (slice == 4) { s.gloss = 0.6h; s.smoothness = 0.55h; }          // metal: soft warm sheen
                        else if (slice == 3) { s.gloss = 0.18h; s.smoothness = 0.35h; }   // leather
                    }
                    else
                    {
                        // hair: a soft broad sheen along the strands' facing (no texture), slightly glossier than cloth
                        s.gloss = 0.35h; s.smoothness = 0.4h;
                    }
                    s.albedo = i.color.rgb * m * _BaseColor.rgb;
                    s.normalWS = n;
                }
                else
                {
                    half4 tex = SAMPLE_TEXTURE2D(_BaseMap, sampler_BaseMap, i.uv);
                    half3 albedo = tex.rgb * _BaseColor.rgb;
                    if (_PlainBody > 0.5h) albedo *= i.color.rgb;
                    half a = i.color.a;
                    half eye = 1.0h - saturate(a * 4.0h);                 // alpha 0
                    half mouth = saturate(1.0h - abs(a - 0.5h) * 6.0h);   // alpha ~0.5
                    half skinK = saturate((a - 0.75h) * 4.0h);            // alpha 1
                    s.normalWS = n;
                    s.ao = 1;
                    s.smoothness = 0.35h;
                #if defined(_SKINMAPS)
                    // the head's own texture set on UV1 (the builder writes -1 there for every vertex outside the head)
                    // tangent frame from screen derivatives of the position and the head UVs (no mesh tangents needed); computed outside
                    // the branch so the derivatives are well defined, and the samples inside use explicit gradients
                    float2 hu = i.uv1;
                    float3 dp1 = ddx(i.positionWS), dp2 = ddy(i.positionWS);
                    float2 du1 = ddx(hu), du2 = ddy(hu);
                    if (skinK > 0.5h && i.uv1.x >= 0.0)
                    {
                        half3 tn = UnpackNormalScale(SAMPLE_TEXTURE2D_GRAD(_SkinNormal, sampler_SkinNormal, hu, du1, du2), _NormalStrength);
                        float3 dp2perp = cross(dp2, n), dp1perp = cross(n, dp1);
                        float3 T = dp2perp * du1.x + dp1perp * du2.x;
                        float3 B = dp2perp * du1.y + dp1perp * du2.y;
                        float inv = rsqrt(max(max(dot(T, T), dot(B, B)), 1e-12));
                        s.normalWS = normalize(tn.x * T * inv + tn.y * B * inv + tn.z * n);
                        half4 mk = SAMPLE_TEXTURE2D_GRAD(_SkinMask, sampler_SkinMask, hu, du1, du2);
                        s.smoothness = 1.0h - mk.r;
                        s.ao = mk.g;
                        half3 ha = SAMPLE_TEXTURE2D_GRAD(_SkinAlbedo, sampler_SkinAlbedo, hu, du1, du2).rgb;
                        albedo *= saturate(ha / max(_SkinAlbedoBase.rgb, half3(0.05h, 0.05h, 0.05h)) * 0.5h) * 2.0h;
                    }
                #endif
                    // the closed lid during a blink: the eyeball takes the lid's skin colour
                    half3 lid = SAMPLE_TEXTURE2D(_BaseMap, sampler_BaseMap, float2(0.78, 0.2)).rgb * _LidColor.rgb;
                    albedo = lerp(albedo, lid, eye * _Blink);
                    albedo = lerp(albedo, i.color.rgb, mouth);
                    s.albedo = albedo;
                    s.skin = skinK + eye * _Blink;
                    s.gloss = skinK * _SkinGloss + eye * (1.0h - _Blink) * _EyeGloss + mouth * 0.4h;
                    s.smoothness = lerp(s.smoothness, 0.95h, eye);
                }
                half3 col = CharacterShade(s, i.positionWS, i.positionCS, viewDir);
                col = MixFog(col, i.fogFactor);
                return half4(col, 1);
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
            struct Attributes { float4 positionOS : POSITION; float3 normalOS : NORMAL;  };
            struct Varyings { float4 positionCS : SV_POSITION;  };
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
                o.positionCS = cs; 
                return o;
            }
            half4 ShadowFrag(Varyings i) : SV_Target {  return 0; }
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
            struct Attributes { float4 positionOS : POSITION; float3 normalOS : NORMAL;  };
            struct Varyings { float4 positionCS : SV_POSITION; float3 positionWS : TEXCOORD6; half3 normalWS : TEXCOORD7;  };
            Varyings DepthVert(Attributes i)
            {
                Varyings o;
                o.positionCS = TransformObjectToHClip(i.positionOS.xyz);
                o.positionWS = TransformObjectToWorld(i.positionOS.xyz);
                o.normalWS = TransformObjectToWorldNormal(i.normalOS); 
                return o;
            }
            float DepthFrag(Varyings i) : SV_Target {  FadeClip(i.positionCS, i.positionWS, normalize(i.normalWS)); return i.positionCS.z; }
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
            struct Attributes { float4 positionOS : POSITION; float3 normalOS : NORMAL;  };
            struct Varyings { float4 positionCS : SV_POSITION; half3 normalWS : TEXCOORD6; float3 positionWS : TEXCOORD7;  };
            Varyings DNVert(Attributes i)
            {
                Varyings o;
                o.positionCS = TransformObjectToHClip(i.positionOS.xyz);
                o.positionWS = TransformObjectToWorld(i.positionOS.xyz);
                o.normalWS = TransformObjectToWorldNormal(i.normalOS); 
                return o;
            }
            half4 DNFrag(Varyings i) : SV_Target
            {
                
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
