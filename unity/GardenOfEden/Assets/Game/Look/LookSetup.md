# Garden of Eden: look setup (URP 17, Unity 6000.3, M2 8GB)

## 1. URP asset (Project Settings > Graphics, and the asset itself)
- Rendering Path: **Forward+** (renderer asset). Lamps, windows and fires are point lights; Forward+ has no per-object limit.
- Quality > **Depth Texture: On** (ToonWater needs it). Opaque Texture: Off.
- HDR: On (R11G11B10 precision is enough). Render Scale: **1.0**; drop to 0.85 with Upscaling Filter FSR if frames dip.
- Anti-aliasing: MSAA **2x** (or MSAA off + SMAA on the camera). Avoid 4x/8x on 8 GB unified memory.
- Lighting: Main Light = Per Pixel, Cast Shadows on. Additional Lights = Per Pixel; **Additional Light Shadows off** (costly).
- Shadows: Max Distance **60-80**, Cascades **3** (splits about 8% / 22%), Depth Bias 1, Normal Bias 0.6, Soft Shadows **on** (Quality Medium or Low), resolution 2048.
- SRP Batcher: On. Dynamic Batching: Off. Disable Screen Space Shadows (not needed).
- Grass material: **Enable GPU Instancing** on.

## 2. Materials
| Material | Shader | Notes |
|---|---|---|
| buildings, props, terrain, characters | `GardenOfEden/ToonLit` | Base Map + colour. Bands 2, Softness 0.35, Shadow Tint blue-lilac. Tick Emission for lit windows. Optional ramp texture (Clamp). |
| meadow | `GardenOfEden/ToonGrass` | root/tip colours; Fade Start/End are set by GrassField. Wind amplitude 0.35. |
| skybox | `GardenOfEden/StylisedSky` | Assign to DayNight.skyMaterial (it sets RenderSettings.skybox). |
| lakes, rivers, sea | `GardenOfEden/ToonWater` | On a flat plane at water level. Needs Depth Texture. |

Mesh vertex colours multiply ToonLit (paint tint/AO into vertices).

## 3. Scene wiring
1. Directional Light (shadows Soft) -> `DayNight.sun`.
2. Empty object "Wind" + `Wind` component -> `DayNight.wind`.
3. Empty "Sky" object + `DayNight`; set sky material; optional rain/snow ParticleSystems (emission scales with weather).
4. Grass: `GrassField` on an object, set material; call `SetSpots(...)` (WorldView does). Clumps of ~7 blades, ~5/m2, drawDistance ~48.
5. Each frame from the server: `dayNight.ApplyAmbience(frame.ambience.light, timeOfDay, weather, season, snow)`. Or `SetTime(t01)` / `SetWeather("rain")`.
   Server values: weather clear/rain/storm/snow/fog; timeOfDay morning/afternoon/evening/night. Mapping is documented at the top of DayNight.cs.

## 4. Global Volume profile (one Global Volume)
- **Tonemapping**: Neutral (softer, painterly). ACES if you want richer contrast and punchier saturation.
- **Bloom**: Threshold 1.0, Intensity 0.25, Scatter 0.65, light warm tint. Subtle.
- **Color Adjustments**: Post Exposure 0, Contrast +8, Saturation +8 to +12, Colour Filter white.
- **Shadows Midtones Highlights** (optional): shadows slightly lavender, highlights slightly warm.
- **Vignette**: Intensity 0.18, Smoothness 0.4.
- **White Balance** temperature +6, tint +2; **Shadows Midtones Highlights** lavender shadows, warm highlights; saturation +2,
  contrast +12 (the G8 grade, 2026-11-22; built by `SceneBootstrap.BuildProfile`).
- **SSAO** renderer feature: Intensity 1.1, Radius 0.55, Direct 0.3, depth normals, downsampled, low samples. ToonLit reads it.
- Skip motion blur and film grain. Optional light Depth of Field is not needed.

## 5. Troubleshooting
- Pink shader: check the console for an include or keyword error. Forward+ keyword is `_FORWARD_PLUS` in 6.0 and `_CLUSTER_LIGHT_LOOP` in later 6.x; both are compiled.
- Water flat/opaque: Depth Texture is off in the URP asset.
- Grass static: no `Wind` in scene (globals default to 0), or instancing off on the material.
- Fog not visible: Lighting window must allow fog; DayNight.driveFog sets RenderSettings.fog.
