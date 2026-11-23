// Shared soft stylised lighting for GardenOfEden/Character and GardenOfEden/Hair (G8 art direction): a wide wrap-light gradient
// from a tinted (never black) shadow to the warm key, a warm reddish terminator on skin (fake subsurface), a soft low specular,
// a gentle cool blue-teal rim and bounce on the shadow side, and lamps/fires through the URP Forward / Forward+ light loop.
// Expects the including shader to declare (in its UnityPerMaterial CBUFFER): _ShadowColor, _Wrap, _SssColor, _SssStrength,
// _AmbientStrength, _AdditionalStrength, _RimColor, _RimStrength, _CoolRim, _CoolRimStrength, _SpecStrength.
#ifndef GOE_CHARACTER_LIGHTING_INCLUDED
#define GOE_CHARACTER_LIGHTING_INCLUDED

#include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Lighting.hlsl"

#if USE_CLUSTER_LIGHT_LOOP
    #define GOE_CLUSTER 1
#endif
#if defined(_ADDITIONAL_LIGHTS) || defined(GOE_CLUSTER)
    #define GOE_ADDITIONAL 1
#endif

struct CharSurface
{
    half3 albedo;
    half3 normalWS;
    half  skin;        // 0..1: how much of the warm subsurface terminator
    half  gloss;       // 0..1: specular strength (eyes high, skin low, cloth almost none)
    half  smoothness;  // 0..1: specular tightness
    half  ao;          // 0..1 ambient occlusion / cavity
};

half GoeWrap(half ndl, half w) { return saturate((ndl + w) / (1.0h + w)); }

half3 GoeAdditional(Light l, half3 n)
{
    half atten = l.distanceAttenuation * l.shadowAttenuation;
    half d = GoeWrap(dot(n, l.direction), 0.5h);
    return l.color * (atten * d * d);
}

half3 CharacterShade(CharSurface s, float3 positionWS, float4 positionCS, half3 viewDir)
{
    half3 n = s.normalWS;
    float4 shadowCoord = TransformWorldToShadowCoord(positionWS);
    half4 shadowMask = half4(1, 1, 1, 1);
    Light mainLight = GetMainLight(shadowCoord, positionWS, shadowMask);
    half atten = mainLight.shadowAttenuation * mainLight.distanceAttenuation;
    half ndl = dot(n, mainLight.direction);

    // Soft gradient: a wide wrap, eased, so the terminator is long and smooth (no cel bands).
    half wrap = GoeWrap(ndl, _Wrap);
    half lit = smoothstep(0.0h, 1.0h, wrap) * lerp(0.35h, 1.0h, atten);
    half3 diffuse = lerp(_ShadowColor.rgb, half3(1, 1, 1), lit) * mainLight.color;

    // Fake subsurface: the light bleeds warm and red just past the terminator.
    half wide = GoeWrap(ndl, 0.65h);
    half band = saturate(wide - saturate(ndl)) * (1.0h - saturate(-ndl * 1.5h));
    half3 sss = _SssColor.rgb * (band * _SssStrength * s.skin) * mainLight.color * lerp(0.5h, 1.0h, atten);

    half3 ambient = SampleSH(n) * _AmbientStrength * s.ao;

    half3 extra = 0;
#if defined(GOE_ADDITIONAL)
    InputData inputData = (InputData)0;
    inputData.positionWS = positionWS;
    inputData.normalWS = n;
    inputData.viewDirectionWS = viewDir;
    inputData.normalizedScreenSpaceUV = GetNormalizedScreenSpaceUV(positionCS);
    uint pixelLightCount = GetAdditionalLightsCount();
    #if defined(GOE_CLUSTER)
        for (uint dirIndex = 0u; dirIndex < min(URP_FP_DIRECTIONAL_LIGHTS_COUNT, MAX_VISIBLE_LIGHTS); dirIndex++)
        {
            Light dl = GetAdditionalLight(dirIndex, positionWS, shadowMask);
            extra += GoeAdditional(dl, n);
        }
    #endif
    LIGHT_LOOP_BEGIN(pixelLightCount)
        Light l = GetAdditionalLight(lightIndex, positionWS, shadowMask);
        extra += GoeAdditional(l, n);
    LIGHT_LOOP_END
#endif

    half3 col = s.albedo * (diffuse + ambient + extra * _AdditionalStrength) + s.albedo * sss;

    // Soft specular (matte look: broad and weak, except the eyes).
    half3 h = normalize(mainLight.direction + viewDir);
    half power = exp2(3.0h + s.smoothness * 8.0h);
    half spec = pow(saturate(dot(n, h)), power) * lerp(0.35h, 1.0h, s.smoothness);
    col += mainLight.color * (spec * s.gloss * _SpecStrength * atten * saturate(ndl * 4.0h));

    // Rims: a faint warm one on the lit side, a cool blue-teal one and a bounce on the side away from the key.
    half fres = 1.0h - saturate(dot(n, viewDir));
    half f2 = fres * fres;
    half litSide = saturate(ndl * 0.5h + 0.5h);
    col += _RimColor.rgb * (smoothstep(0.45h, 0.9h, fres) * litSide * _RimStrength) * mainLight.color * s.albedo;
    half away = 1.0h - litSide * lerp(0.35h, 1.0h, atten);
    half cool = smoothstep(0.4h, 0.95h, fres) * (0.35h + 0.65h * away) + away * 0.08h;
    col += _CoolRim.rgb * (cool * _CoolRimStrength) * lerp(half3(0.45h, 0.45h, 0.45h), s.albedo * 1.8h, 0.6h);
    return col;
}
#endif
