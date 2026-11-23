// GardenOfEden/ToonLit - soft matte gradient shading for URP 17 (Unity 6). Hand-written HLSL, SRP Batcher compatible.
//
// Look: a gentle 2-3 step ramp (procedural, or a 1-row ramp texture), a TINTED shadow colour instead of black,
// sun shadows (cascades, soft), point/spot lights (lamps, windows, fires) in Forward and Forward+, a soft rim light,
// base colour * base map * vertex colour, optional emission. Passes: ForwardLit, ShadowCaster, DepthOnly, DepthNormals.
//
// Notes:
//  * Ramp texture (optional): tick "Use Ramp Texture"; 1 row, colour left->right = dark->light, Wrap Mode = Clamp.
//    Its RGB multiplies the light directly (bake your shadow tint into it).
//  * Bands = number of steps (2 gives three tones: shadow / mid / lit). Softness = width of each step's blend.
Shader "GardenOfEden/ToonLit"
{
    Properties
    {
        [MainTexture] _BaseMap("Base Map", 2D) = "white" {}
        [MainColor] _BaseColor("Base Colour", Color) = (1,1,1,1)

        [Header(Toon ramp)]
        _ShadowColor("Shadow Tint (soft warm purple / cool blue)", Color) = (0.62, 0.56, 0.72, 1)
        _Bands("Bands (steps; 4+ with high softness = smooth ramp)", Range(1, 6)) = 4
        _Softness("Band Softness", Range(0.01, 1)) = 1
        _Wrap("Light Wrap", Range(0, 1)) = 0.5
        [Toggle(_RAMPTEX)] _UseRampTex("Use Ramp Texture", Float) = 0
        _RampTex("Ramp Texture (clamp)", 2D) = "white" {}

        [Header(Lights)]
        _AmbientStrength("Ambient Strength", Range(0, 2)) = 0.6
        _AdditionalStrength("Point Light Strength", Range(0, 3)) = 1

        [Header(Rim)]
        [HDR] _RimColor("Rim Colour", Color) = (1.0, 0.95, 0.85, 1)
        _RimStrength("Rim Strength", Range(0, 2)) = 0.22
        _RimThreshold("Rim Threshold", Range(0, 1)) = 0.55
        _RimSoftness("Rim Softness", Range(0.01, 0.6)) = 0.25

        [Header(Cool rim on the shadow side)]
        [HDR] _CoolRim("Cool Rim Colour", Color) = (0.30, 0.78, 0.82, 1)
        _CoolRimStrength("Cool Rim Strength", Range(0, 1.5)) = 0.38

        [Header(Outline inverted hull)]
        _OutlineWidth("Outline Width (m) - off by default", Range(0, 0.08)) = 0
        _OutlineColor("Outline Tint (x surface colour)", Color) = (0.45, 0.34, 0.40, 1)
        _OutlineFadeEnd("Outline Fade Distance", Float) = 90

        [Header(Emission)]
        [Toggle(_EMISSION)] _UseEmission("Use Emission", Float) = 0
        [HDR] _EmissionColor("Emission Colour", Color) = (0,0,0,1)
        _EmissionMap("Emission Map", 2D) = "white" {}

        [Header(Foliage)]
        // Leaves and grass-like props: UV0.x is the sway weight (0 at the root, 1 at the tips); wind from Wind.cs globals.
        [Toggle(_SWAY)] _UseSway("Wind Sway (UV0.x = weight)", Float) = 0
        _SwayAmount("Sway Amount (m at weight 1)", Range(0, 0.6)) = 0.12
        _Translucency("Back-light Translucency", Range(0, 1)) = 0.35

        [Header(Ground detail)]
        // World-space painterly breakup for the terrain (no textures): soft blotches and fine grain, faded with distance.
        [Toggle(_GROUND_DETAIL)] _UseGroundDetail("Ground Detail", Float) = 0
        _DetailStrength("Detail Strength", Range(0, 1)) = 0.55

        [Header(Rendering)]
        [Enum(UnityEngine.Rendering.CullMode)] _Cull("Cull", Float) = 2

        [Header(Occlusion fade)]
        // 0 = solid, 1 = fully dithered away. Driven per renderer by a MaterialPropertyBlock (World/Occlusion.cs).
        _Fade("Fade (screen-door dither)", Range(0, 1)) = 0
        // Walls (vertical surfaces) on the camera side of this plane are dithered away: xyz = unit normal, w = offset.
        // Default: a plane at infinity, i.e. nothing is cut. Used while the player is inside a building.
        [HideInInspector] _CutPlane("Cut plane (nx,ny,nz,d)", Vector) = (0,0,0,100000)
        [HideInInspector] _CutFade("Cut fade", Range(0, 1)) = 0
    }

    SubShader
    {
        Tags
        {
            "RenderType" = "Opaque"
            "RenderPipeline" = "UniversalPipeline"
            "UniversalMaterialType" = "SimpleLit"
            "Queue" = "Geometry"
        }
        LOD 200

        HLSLINCLUDE
        #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"

        TEXTURE2D(_BaseMap);     SAMPLER(sampler_BaseMap);
        TEXTURE2D(_RampTex);     SAMPLER(sampler_RampTex);
        TEXTURE2D(_EmissionMap); SAMPLER(sampler_EmissionMap);

        CBUFFER_START(UnityPerMaterial)
            float4 _BaseMap_ST;
            half4  _BaseColor;
            half4  _ShadowColor;
            half   _Bands;
            half   _Softness;
            half   _Wrap;
            half   _AmbientStrength;
            half   _AdditionalStrength;
            half4  _RimColor;
            half   _RimStrength;
            half   _RimThreshold;
            half   _RimSoftness;
            half4  _EmissionColor;
            float  _Cull;
            half   _Fade;
            float4 _CutPlane;
            half   _CutFade;
            half4  _CoolRim;
            half   _CoolRimStrength;
            half   _OutlineWidth;
            half4  _OutlineColor;
            float  _OutlineFadeEnd;
            half   _SwayAmount;
            half   _Translucency;
            half   _DetailStrength;
        CBUFFER_END

        // The player's chest (xyz) and on/off (w), set by WorldView: foliage in the line of sight dissolves.
        float4 _GoeFocus;

        // Snow lying on the ground (DayNight, 0..1): it settles on whatever faces up.
        float  _SnowAmount;

        // Wind globals (Look/Wind.cs).
        float4 _WindDirection;
        float  _WindStrength;

        // Leaves sway as a whole with the gusts and flutter a little at the tips. w = 0 at the root.
        float3 SwayWS(float3 p, float w)
        {
            float phase = dot(floor(p.xz * 0.5), float2(0.37, 0.61)) + dot(p.xz, float2(0.11, 0.07));
            float t = _Time.y;
            float s = _WindStrength * w;
            float gust = 0.55 + 0.45 * sin(t * 1.15 + phase) + 0.2 * sin(t * 2.7 + phase * 1.7);
            p.xz += _WindDirection.xz * (s * _SwayAmount * gust);
            float flutter = sin(t * 5.3 + dot(p, float3(2.1, 1.7, 2.9)));
            p.y += flutter * s * _SwayAmount * 0.18;
            p.xz += flutter * s * _SwayAmount * 0.12 * float2(0.7, -0.7);
            return p;
        }

        float Hash21(float2 p) { p = frac(p * float2(123.34, 456.21)); p += dot(p, p + 45.32); return frac(p.x * p.y); }
        float VNoise(float2 p)
        {
            float2 i = floor(p), f = frac(p);
            f = f * f * (3.0 - 2.0 * f);
            float a = Hash21(i), b = Hash21(i + float2(1, 0)), c = Hash21(i + float2(0, 1)), d = Hash21(i + float2(1, 1));
            return lerp(lerp(a, b, f.x), lerp(c, d, f.x), f.y);
        }

        float3 WorldPos(float3 positionOS, float2 uv)
        {
            float3 p = TransformObjectToWorld(positionOS);
        #if defined(_SWAY)
            p = SwayWS(p, uv.x);
        #endif
            return p;
        }

        // Screen-door transparency: a 4x4 Bayer matrix compared with the fade amount. Cheap, no blending, no sorting.
        half DitherThreshold(float4 positionCS)
        {
            static const float bayer[16] = { 0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0 };
            uint2 p = uint2(positionCS.xy) & 3u;
            return (bayer[p.y * 4u + p.x] + 0.5) / 16.0;
        }

        void FadeClip(float4 positionCS, float3 positionWS, half3 normalWS)
        {
            half f = _Fade;
        #if defined(_SWAY)
            // Leaves and trunks right in front of the camera dissolve instead of filling the screen.
            float camD = distance(_WorldSpaceCameraPos.xyz, positionWS);
            f = max(f, saturate((3.2 - camD) / 2.0));
            // ...and so do the ones between the camera and the player (a soft tube round the line of sight).
            if (_GoeFocus.w > 0.5)
            {
                float3 cam = _WorldSpaceCameraPos.xyz;
                float3 seg = _GoeFocus.xyz - cam;
                float L = max(length(seg), 0.01);
                float3 dir = seg / L;
                float t = dot(positionWS - cam, dir);
                float r = distance(positionWS, cam + dir * t);
                float radius = 1.4 + 0.07 * t;
                float along = saturate(t / 1.0) * saturate((L - 0.6 - t) / 1.5);
                f = max(f, saturate((radius - r) / 0.9) * along);
            }
        #endif
            // Walls on the camera side of the cut plane (the player is inside): vertical faces only, so floors stay.
            if (_CutFade > 0.001h && abs(normalWS.y) < 0.5h && dot(positionWS, _CutPlane.xyz) > _CutPlane.w) f = max(f, _CutFade);
            if (f > 0.001h) clip(DitherThreshold(positionCS) - f);
        }
        ENDHLSL

        // ------------------------------------------------------------------------------------------------------
        Pass
        {
            Name "ForwardLit"
            Tags { "LightMode" = "UniversalForward" }

            Cull [_Cull]
            ZWrite On
            ZTest LEqual

            HLSLPROGRAM
            #pragma target 4.5
            #pragma exclude_renderers gles gles3 glcore

            #pragma vertex   Vert
            #pragma fragment Frag

            #pragma shader_feature_local_fragment _RAMPTEX
            #pragma shader_feature_local_fragment _EMISSION
            #pragma shader_feature_local _SWAY
            #pragma shader_feature_local_fragment _GROUND_DETAIL
            #pragma multi_compile_fragment _ _SCREEN_SPACE_OCCLUSION

            #pragma multi_compile _ _MAIN_LIGHT_SHADOWS _MAIN_LIGHT_SHADOWS_CASCADE _MAIN_LIGHT_SHADOWS_SCREEN
            // Unity 6000.3 (URP 17.3) names the Forward+ keyword _CLUSTER_LIGHT_LOOP (_FORWARD_PLUS is deprecated and warns).
            #pragma multi_compile _ _CLUSTER_LIGHT_LOOP
            #pragma multi_compile _ _ADDITIONAL_LIGHTS
            #pragma multi_compile_fragment _ _ADDITIONAL_LIGHT_SHADOWS
            #pragma multi_compile_fragment _ _SHADOWS_SOFT _SHADOWS_SOFT_LOW _SHADOWS_SOFT_MEDIUM _SHADOWS_SOFT_HIGH
            #pragma multi_compile_fog

            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Lighting.hlsl"

            #if USE_CLUSTER_LIGHT_LOOP
                #define MB_CLUSTER 1
            #endif
            #if defined(_ADDITIONAL_LIGHTS) || defined(MB_CLUSTER)
                #define MB_ADDITIONAL 1
            #endif

            struct Attributes
            {
                float4 positionOS : POSITION;
                float3 normalOS   : NORMAL;
                float2 uv         : TEXCOORD0;
                half4  color      : COLOR;
            };

            struct Varyings
            {
                float4 positionCS : SV_POSITION;
                float2 uv         : TEXCOORD0;
                float3 positionWS : TEXCOORD1;
                half3  normalWS   : TEXCOORD2;
                half   fogFactor  : TEXCOORD3;
                half4  color      : TEXCOORD4;
            #if defined(_MAIN_LIGHT_SHADOWS_SCREEN)
                float4 shadowCoord : TEXCOORD5;
            #endif
            };

            // Quantise x (0..1) into _Bands steps with soft edges. Continuous: plateau, smooth rise, plateau...
            half ToonRamp(half x)
            {
                half t  = saturate(x) * _Bands;
                half f  = floor(t);
                half fr = t - f;
                half w  = smoothstep(0.5h - 0.5h * _Softness, 0.5h + 0.5h * _Softness, fr);
                return saturate((f + w) / _Bands);
            }

            // What the light does to the surface at ramp position x: lit = 1, shadowed = the tint.
            half3 RampColor(half x)
            {
            #if defined(_RAMPTEX)
                return SAMPLE_TEXTURE2D_LOD(_RampTex, sampler_RampTex, float2(saturate(x), 0.5), 0).rgb;
            #else
                return lerp(_ShadowColor.rgb, half3(1, 1, 1), ToonRamp(x));
            #endif
            }

            half WrapNdL(half3 n, half3 l)
            {
                return saturate((dot(n, l) + _Wrap) / (1.0h + _Wrap));
            }

            // Lamps, windows, fires: a toon-stepped, attenuated, shadowed contribution.
            half3 AdditionalToon(Light l, half3 n)
            {
                half atten = l.distanceAttenuation * l.shadowAttenuation;
                half r = ToonRamp(WrapNdL(n, l.direction));
                return l.color * (atten * r);
            }

            Varyings Vert(Attributes i)
            {
                Varyings o;
                VertexPositionInputs vp = GetVertexPositionInputs(i.positionOS.xyz);
                VertexNormalInputs   vn = GetVertexNormalInputs(i.normalOS);
            #if defined(_SWAY)
                vp.positionWS = SwayWS(vp.positionWS, i.uv.x);
                vp.positionCS = TransformWorldToHClip(vp.positionWS);
            #endif
                o.positionCS = vp.positionCS;
                o.positionWS = vp.positionWS;
                o.normalWS   = vn.normalWS;
                o.uv         = TRANSFORM_TEX(i.uv, _BaseMap);
                o.fogFactor  = ComputeFogFactor(vp.positionCS.z);
                o.color      = i.color;
            #if defined(_MAIN_LIGHT_SHADOWS_SCREEN)
                o.shadowCoord = GetShadowCoord(vp);
            #endif
                return o;
            }

            half4 Frag(Varyings i) : SV_Target
            {
                half3 n = normalize(i.normalWS);
                FadeClip(i.positionCS, i.positionWS, n);
                half3 viewDir = GetWorldSpaceNormalizeViewDir(i.positionWS);

                half4 tex = SAMPLE_TEXTURE2D(_BaseMap, sampler_BaseMap, i.uv);
                half3 albedo = tex.rgb * _BaseColor.rgb * i.color.rgb;
            #if defined(_GROUND_DETAIL)
                {
                    float2 w = i.positionWS.xz;
                    float camDist = distance(_WorldSpaceCameraPos.xyz, i.positionWS);
                    half nearK = saturate(1.0 - camDist / 70.0);
                    half blotch = VNoise(w * 0.45) * 0.6 + VNoise(w * 1.3) * 0.4;          // soft painted patches
                    half grain = VNoise(w * 4.1) * 0.6 + VNoise(w * 9.7) * 0.4;           // fine grain, near only
                    half lum = dot(albedo, half3(0.3, 0.59, 0.11));
                    half greenness = saturate((albedo.g - max(albedo.r, albedo.b)) * 6.0);
                    half k = _DetailStrength;
                    half broad = VNoise(w * 0.055) * 0.65 + VNoise(w * 0.15) * 0.35;      // big meadow-wide drifts, read from far
                    albedo *= 1.0h + k * ((broad - 0.5h) * 0.42h + (blotch - 0.5h) * 0.32h + (grain - 0.5h) * 0.24h * nearK);
                    // earth: darker pebbly specks and lighter dust streaks; grass: lighter tips drifting in blotches
                    half speck = smoothstep(0.78h, 0.86h, VNoise(w * 6.3 + 17.0)) * (1.0h - greenness) * nearK;
                    albedo *= 1.0h - speck * 0.22h * k;
                    half dust = smoothstep(0.55h, 0.8h, VNoise(float2(w.x * 0.6, w.y * 2.4) + 5.0)) * (1.0h - greenness);
                    albedo = lerp(albedo, albedo * 1.12h + 0.02h, dust * 0.35h * k);
                    albedo = lerp(albedo, albedo * half3(1.08h, 1.06h, 0.92h), greenness * smoothstep(0.55h, 0.9h, blotch) * 0.5h * k);
                    // meadow-wide hue drifts on grass, readable from the far camera: warm straw-olive and deep cool green
                    half drift = VNoise(w * 0.022 + 31.0) * 0.6 + VNoise(w * 0.07 + 7.0) * 0.4;
                    half3 straw = albedo * half3(1.16h, 1.04h, 0.72h);
                    half3 deepG = albedo * half3(0.78h, 0.9h, 0.86h);
                    albedo = lerp(albedo, straw, greenness * smoothstep(0.58h, 0.8h, drift) * 0.75h * k);
                    albedo = lerp(albedo, deepG, greenness * smoothstep(0.42h, 0.2h, drift) * 0.8h * k);
                }
            #endif

            #if defined(_MAIN_LIGHT_SHADOWS_SCREEN)
                float4 shadowCoord = i.shadowCoord;
            #else
                float4 shadowCoord = TransformWorldToShadowCoord(i.positionWS);
            #endif
                half4 shadowMask = half4(1, 1, 1, 1);
                Light mainLight = GetMainLight(shadowCoord, i.positionWS, shadowMask);

                half atten = mainLight.shadowAttenuation * mainLight.distanceAttenuation;
                half lightIn = WrapNdL(n, mainLight.direction) * atten;
                half3 sunTerm = RampColor(lightIn) * mainLight.color;
                half3 ambient = SampleSH(n) * _AmbientStrength;
                if (_SnowAmount > 0.001)
                {
                    half edge = (VNoise(i.positionWS.xz * 0.8) - 0.5h) * 0.35h;
                    half sn = saturate(_SnowAmount) * smoothstep(0.42h, 0.78h, n.y + edge);
                    albedo = lerp(albedo, half3(0.86h, 0.89h, 0.95h), sn);
                }
            #if defined(_SCREEN_SPACE_OCCLUSION)
                AmbientOcclusionFactor aoF = GetScreenSpaceAmbientOcclusion(GetNormalizedScreenSpaceUV(i.positionCS));
            #if defined(_SWAY)
                // leaves overlap a lot: half strength, or the canopies go blotchy
                aoF.indirectAmbientOcclusion = lerp(1.0h, aoF.indirectAmbientOcclusion, 0.5h);
                aoF.directAmbientOcclusion = lerp(1.0h, aoF.directAmbientOcclusion, 0.5h);
            #endif
                ambient *= aoF.indirectAmbientOcclusion;
                sunTerm *= lerp(1.0h, aoF.directAmbientOcclusion, 0.6h);
            #endif

                // Point lights. Written for Forward and Forward+; the loop macros read `inputData` by name.
                half3 extra = 0;
            #if defined(MB_ADDITIONAL)
                InputData inputData = (InputData)0;
                inputData.positionWS = i.positionWS;
                inputData.normalWS = n;
                inputData.viewDirectionWS = viewDir;
                inputData.normalizedScreenSpaceUV = GetNormalizedScreenSpaceUV(i.positionCS);

                uint pixelLightCount = GetAdditionalLightsCount();
                #if defined(MB_CLUSTER)
                    // Forward+ keeps directional "additional" lights apart from the clustered point/spot lights.
                    for (uint dirIndex = 0u; dirIndex < min(URP_FP_DIRECTIONAL_LIGHTS_COUNT, MAX_VISIBLE_LIGHTS); dirIndex++)
                    {
                        Light dl = GetAdditionalLight(dirIndex, i.positionWS, shadowMask);
                        extra += AdditionalToon(dl, n);
                    }
                #endif
                LIGHT_LOOP_BEGIN(pixelLightCount)
                    Light l = GetAdditionalLight(lightIndex, i.positionWS, shadowMask);
                    extra += AdditionalToon(l, n);
                LIGHT_LOOP_END
            #endif

                half3 col = albedo * (sunTerm + ambient + extra * _AdditionalStrength);

                // Rim: a soft edge glow, strongest on the sunlit side.
                half fres = 1.0h - saturate(dot(n, viewDir));
                half rim = smoothstep(_RimThreshold, _RimThreshold + _RimSoftness, fres);
                rim *= saturate(dot(n, mainLight.direction) * 0.5h + 0.5h);
                col += _RimColor.rgb * (rim * _RimStrength) * (mainLight.color * 0.5h + ambient);
                // Cool cyan rim and bounce where the sun does not reach.
                half shade = 1.0h - saturate(dot(n, mainLight.direction) * 0.5h + 0.5h + (1.0h - atten) * 0.5h);
                half coolRim = smoothstep(0.35h, 0.85h, fres) * shade + shade * 0.12h;
                // scaled by the sky light, so it is a bounce by day and does not glow at night
                half skyLum = saturate(dot(ambient, half3(0.33h, 0.33h, 0.33h)) * 3.0h);
                col += _CoolRim.rgb * coolRim * _CoolRimStrength * albedo * 1.6h * skyLum;

            #if defined(_SWAY)
                // Sun through the leaves when looking toward it.
                half back = pow(saturate(dot(viewDir, -mainLight.direction)), 3.0h);
                col += albedo * mainLight.color * (back * _Translucency * (0.35h + 0.65h * atten));
            #endif

            #if defined(_EMISSION)
                col += SAMPLE_TEXTURE2D(_EmissionMap, sampler_EmissionMap, i.uv).rgb * _EmissionColor.rgb;
            #endif

                col = MixFog(col, i.fogFactor);
                return half4(col, 1);
            }
            ENDHLSL
        }

        // ------------------------------------------------------------------------------------------------------
        // Thin outline: the mesh pushed out along its normals, back faces only, in a darker shade of the surface colour.
        // Fades (thins) with distance. Width 0 collapses it. Meshes are flat-shaded, so the line has tiny notches at hard corners.
        Pass
        {
            Name "Outline"
            Tags { "LightMode" = "SRPDefaultUnlit" }
            Cull Front
            ZWrite On
            ZTest LEqual

            HLSLPROGRAM
            #pragma target 3.5
            #pragma exclude_renderers gles gles3 glcore
            #pragma vertex   OutVert
            #pragma fragment OutFrag
            #pragma multi_compile_fog

            struct Attributes { float4 positionOS : POSITION; float3 normalOS : NORMAL; half4 color : COLOR; };
            struct Varyings { float4 positionCS : SV_POSITION; float3 positionWS : TEXCOORD0; half3 normalWS : TEXCOORD1; half4 color : TEXCOORD2; half fog : TEXCOORD3; };

            Varyings OutVert(Attributes i)
            {
                Varyings o;
                float3 pws = TransformObjectToWorld(i.positionOS.xyz);
                float3 nws = TransformObjectToWorldNormal(i.normalOS);
                float dist = distance(_WorldSpaceCameraPos, pws);
                float keep = saturate(1.0 - (dist - _OutlineFadeEnd * 0.5) / (_OutlineFadeEnd * 0.5));
                float w = _OutlineWidth * keep * (1.0 + dist * 0.025);
                o.positionWS = pws + nws * w;
                o.positionCS = TransformWorldToHClip(o.positionWS);
                o.normalWS = nws;
                o.color = i.color;
                o.fog = ComputeFogFactor(o.positionCS.z);
                if (w <= 0.0001) o.positionCS = float4(2, 2, 2, 1);   // outside the clip volume: nothing drawn
                return o;
            }

            half4 OutFrag(Varyings i) : SV_Target
            {
                FadeClip(i.positionCS, i.positionWS, normalize(i.normalWS));
                half3 c = _BaseColor.rgb * i.color.rgb * _OutlineColor.rgb;
                c = MixFog(c, i.fog);
                return half4(c, 1);
            }
            ENDHLSL
        }

        // ------------------------------------------------------------------------------------------------------
        Pass
        {
            Name "ShadowCaster"
            Tags { "LightMode" = "ShadowCaster" }

            ZWrite On
            ZTest LEqual
            ColorMask 0
            Cull [_Cull]

            HLSLPROGRAM
            #pragma target 3.5
            #pragma exclude_renderers gles gles3 glcore
            #pragma vertex   ShadowVert
            #pragma fragment ShadowFrag
            #pragma multi_compile_vertex _ _CASTING_PUNCTUAL_LIGHT_SHADOW
            #pragma shader_feature_local _SWAY

            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Shadows.hlsl"

            float3 _LightDirection;
            float3 _LightPosition;

            struct Attributes { float4 positionOS : POSITION; float3 normalOS : NORMAL; float2 uv : TEXCOORD0; };
            struct Varyings   { float4 positionCS : SV_POSITION; };

            Varyings ShadowVert(Attributes i)
            {
                Varyings o;
                float3 positionWS = WorldPos(i.positionOS.xyz, i.uv);
                float3 normalWS   = TransformObjectToWorldNormal(i.normalOS);
            #if _CASTING_PUNCTUAL_LIGHT_SHADOW
                float3 lightDirectionWS = normalize(_LightPosition - positionWS);
            #else
                float3 lightDirectionWS = _LightDirection;
            #endif
                float4 positionCS = TransformWorldToHClip(ApplyShadowBias(positionWS, normalWS, lightDirectionWS));
            #if UNITY_REVERSED_Z
                positionCS.z = min(positionCS.z, UNITY_NEAR_CLIP_VALUE);
            #else
                positionCS.z = max(positionCS.z, UNITY_NEAR_CLIP_VALUE);
            #endif
                o.positionCS = positionCS;
                return o;
            }

            half4 ShadowFrag(Varyings i) : SV_Target { return 0; }
            ENDHLSL
        }

        // ------------------------------------------------------------------------------------------------------
        Pass
        {
            Name "DepthOnly"
            Tags { "LightMode" = "DepthOnly" }

            ZWrite On
            ColorMask R
            Cull [_Cull]

            HLSLPROGRAM
            #pragma target 3.5
            #pragma exclude_renderers gles gles3 glcore
            #pragma vertex   DepthVert
            #pragma fragment DepthFrag
            #pragma shader_feature_local _SWAY

            struct Attributes { float4 positionOS : POSITION; float3 normalOS : NORMAL; float2 uv : TEXCOORD0; };
            struct Varyings   { float4 positionCS : SV_POSITION; float3 positionWS : TEXCOORD0; half3 normalWS : TEXCOORD1; };

            Varyings DepthVert(Attributes i)
            {
                Varyings o;
                o.positionWS = WorldPos(i.positionOS.xyz, i.uv);
                o.positionCS = TransformWorldToHClip(o.positionWS);
                o.normalWS = TransformObjectToWorldNormal(i.normalOS);
                return o;
            }

            float DepthFrag(Varyings i) : SV_Target
            {
                FadeClip(i.positionCS, i.positionWS, normalize(i.normalWS));
                return i.positionCS.z;
            }
            ENDHLSL
        }

        // ------------------------------------------------------------------------------------------------------
        Pass
        {
            Name "DepthNormals"
            Tags { "LightMode" = "DepthNormals" }

            ZWrite On
            Cull [_Cull]

            HLSLPROGRAM
            #pragma target 3.5
            #pragma exclude_renderers gles gles3 glcore
            #pragma vertex   DNVert
            #pragma fragment DNFrag
            #pragma multi_compile_fragment _ _GBUFFER_NORMALS_OCT
            #pragma shader_feature_local _SWAY

            struct Attributes { float4 positionOS : POSITION; float3 normalOS : NORMAL; float2 uv : TEXCOORD0; };
            struct Varyings   { float4 positionCS : SV_POSITION; half3 normalWS : TEXCOORD0; float3 positionWS : TEXCOORD1; };

            Varyings DNVert(Attributes i)
            {
                Varyings o;
                o.positionWS = WorldPos(i.positionOS.xyz, i.uv);
                o.positionCS = TransformWorldToHClip(o.positionWS);
                o.normalWS = TransformObjectToWorldNormal(i.normalOS);
                return o;
            }

            half4 DNFrag(Varyings i) : SV_Target
            {
                half3 n = normalize(i.normalWS);
                FadeClip(i.positionCS, i.positionWS, n);
            #if defined(_GBUFFER_NORMALS_OCT)
                float2 oct = PackNormalOctQuadEncode(n);
                float2 remapped = saturate(oct * 0.5 + 0.5);
                return half4(PackFloat2To888(remapped), 0.0);
            #else
                return half4(n, 0.0);
            #endif
            }
            ENDHLSL
        }
    }

    FallBack Off
}
