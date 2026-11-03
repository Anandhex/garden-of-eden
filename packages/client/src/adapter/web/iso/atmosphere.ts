/**
 * Atmosphere in the 2.5D view (G7), all drawing. The weather always shows: rain streaks and snowflakes falling
 * round the camera, and snow lying as a white cover. The rest is the ✨ setting: a haze that thickens with
 * distance (fog in wet weather, on cold mornings and on autumn and winter nights), fireflies on warm clear nights,
 * dust in summer and autumn sun, smoke from the chimneys the server says are lit, and the post-processing that
 * gives HD-2D its look: a soft bloom on lights and a tilt-shift blur that keeps the band round the player sharp.
 */
import * as THREE from "three";
import type { Frame } from "@millbrook/shared/view";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { HorizontalTiltShiftShader } from "three/examples/jsm/shaders/HorizontalTiltShiftShader.js";
import { VerticalTiltShiftShader } from "three/examples/jsm/shaders/VerticalTiltShiftShader.js";
import { CAMERA_DISTANCE } from "./camera";
import type { IsoCtx } from "./ctx";

const RAIN = 700;
const SNOW = 700;
const FLIES = 40;
const MOTES = 70;
/** The box round the camera's target that weather falls in (tiles). */
const BOX = { w: 40, h: 14 };
const HAZE = new THREE.Color(0.74, 0.8, 0.88);

const rnd = (n: number) => Math.random() * n;

function points(n: number, material: THREE.PointsMaterial, spread: number, height: number): THREE.Points {
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) pos.set([rnd(spread) - spread / 2, rnd(height), rnd(spread) - spread / 2], i * 3);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const p = new THREE.Points(g, material);
  p.frustumCulled = false;
  return p;
}

let puff: THREE.CanvasTexture | null = null;
function puffTexture(): THREE.CanvasTexture {
  if (puff) return puff;
  const c = document.createElement("canvas");
  c.width = c.height = 32;
  const g = c.getContext("2d")!;
  const r = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  r.addColorStop(0, "rgba(230,230,230,0.9)");
  r.addColorStop(1, "rgba(230,230,230,0)");
  g.fillStyle = r;
  g.fillRect(0, 0, 32, 32);
  puff = new THREE.CanvasTexture(c);
  return puff;
}

export class IsoAtmosphere {
  readonly composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private tiltH: ShaderPass;
  private tiltV: ShaderPass;
  private rain: THREE.LineSegments;
  private snow: THREE.Points;
  private flies: THREE.Points;
  private motes: THREE.Points;
  private cover: THREE.Mesh;
  private smoke: THREE.Sprite[] = [];
  private chimneys: Array<{ x: number; y: number; z: number }> = [];
  private a: Frame["ambience"] = { light: 1, timeOfDay: "day", weather: "clear", season: "spring" };
  private on: boolean;
  private blur: boolean;
  private fade = { flies: 0, motes: 0, fog: 0 };

  constructor(
    private readonly ctx: IsoCtx,
    renderer: THREE.WebGLRenderer,
    camera: THREE.Camera,
    look: { atmosphere: boolean; blur: boolean },
    surface: THREE.Mesh,
  ) {
    this.on = look.atmosphere;
    this.blur = look.blur;
    const size = renderer.getSize(new THREE.Vector2());
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(ctx.scene, camera));
    this.bloom = new UnrealBloomPass(size, 0.45, 0.55, 0.82);
    this.composer.addPass(this.bloom);
    this.tiltH = new ShaderPass(HorizontalTiltShiftShader);
    this.tiltV = new ShaderPass(VerticalTiltShiftShader);
    this.composer.addPass(this.tiltH);
    this.composer.addPass(this.tiltV);
    this.composer.addPass(new OutputPass());
    this.resize(size.x, size.y);

    const pos = new Float32Array(RAIN * 6);
    const rain = new THREE.BufferGeometry();
    rain.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    for (let i = 0; i < RAIN; i++) this.dropAt(pos, i, rnd(BOX.h));
    this.rain = new THREE.LineSegments(rain, new THREE.LineBasicMaterial({ color: 0xb8c8e0, transparent: true, opacity: 0.55, depthWrite: false }));
    this.rain.frustumCulled = false;
    this.snow = points(SNOW, new THREE.PointsMaterial({ color: 0xffffff, size: 3, sizeAttenuation: false, transparent: true, opacity: 0.9, depthWrite: false }), BOX.w, BOX.h);
    this.flies = points(FLIES, new THREE.PointsMaterial({ color: 0xdfff8a, size: 4, sizeAttenuation: false, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }), 30, 2);
    this.motes = points(MOTES, new THREE.PointsMaterial({ color: 0xfff0c8, size: 2.5, sizeAttenuation: false, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }), 30, 4);
    // Snow lies on the land itself: the ground's own mesh again, white and see-through, a hair above it.
    this.cover = new THREE.Mesh(surface.geometry, new THREE.MeshLambertMaterial({ color: 0xf4f8ff, transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }));
    this.cover.position.y = 0.006;
    this.cover.receiveShadow = true;
    for (const o of [this.rain, this.snow, this.flies, this.motes, this.cover]) {
      o.visible = false;
      ctx.scene.add(o);
    }
    ctx.scene.fog = new THREE.Fog(HAZE, CAMERA_DISTANCE, CAMERA_DISTANCE + 60);
    this.setOn(this.on, this.blur);
  }

  private dropAt(pos: Float32Array, i: number, y: number): void {
    const x = rnd(BOX.w) - BOX.w / 2;
    const z = rnd(BOX.w) - BOX.w / 2;
    pos.set([x, y, z, x - 0.12, y + 0.7, z - 0.05], i * 6);
  }

  setOn(on: boolean, blur: boolean): void {
    this.on = on;
    this.blur = blur;
    this.bloom.enabled = on;
    this.tiltH.enabled = this.tiltV.enabled = on && blur;
  }

  resize(w: number, h: number): void {
    this.composer.setSize(w, h);
    this.bloom.resolution.set(w, h);
    // The blur grows away from the screen's middle row (where the player is).
    this.tiltH.uniforms.h!.value = 2.2 / w;
    this.tiltV.uniforms.v!.value = 2.2 / h;
    this.tiltH.uniforms.r!.value = this.tiltV.uniforms.r!.value = 0.5;
  }

  setAmbience(a: Frame["ambience"]): void {
    this.a = a;
    this.cover.visible = !!a.snow;
  }

  setChimneys(list: Array<{ x: number; y: number; z: number }>): void {
    this.chimneys = list;
    while (this.smoke.length < list.length * 3) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: puffTexture(), transparent: true, depthWrite: false }));
      this.ctx.scene.add(s);
      this.smoke.push(s);
    }
    this.smoke.forEach((s, i) => (s.visible = i < list.length * 3));
  }

  update(time: number, delta: number, target: { x: number; y: number; z: number }, ambient: THREE.Color): void {
    const a = this.a;
    const rainy = a.weather === "rain" || a.weather === "storm";
    const clear = a.weather === "clear";
    const warm = a.season === "summer" || a.season === "spring";
    const want = {
      flies: this.on && clear && warm && a.light < 0.5,
      motes: this.on && clear && (a.season === "summer" || a.season === "autumn") && a.light >= 0.8,
      fog: this.on && (rainy || a.weather === "fog" || ((a.season === "autumn" || a.season === "winter") && a.timeOfDay === "morning") || (a.timeOfDay === "night" && a.season !== "summer")),
    };
    const k = Math.min(1, delta / 1500);
    for (const key of ["flies", "motes", "fog"] as const) this.fade[key] += ((want[key] ? 1 : 0) - this.fade[key]) * k;
    const dt = delta / 1000;
    // Rain and snow fall round the target, whatever the setting.
    this.rain.visible = rainy;
    this.rain.position.set(target.x, target.y, target.z);
    if (rainy) {
      const pos = this.rain.geometry.getAttribute("position") as THREE.BufferAttribute;
      const arr = pos.array as Float32Array;
      const fall = (a.weather === "storm" ? 26 : 20) * dt;
      for (let i = 0; i < RAIN; i++) {
        const y = arr[i * 6 + 1]! - fall;
        if (y < 0) this.dropAt(arr, i, BOX.h);
        else {
          arr[i * 6 + 1] = y;
          arr[i * 6 + 4] = y + 0.7;
          arr[i * 6] = arr[i * 6]! + 0.15 * fall * 0.1;
          arr[i * 6 + 3] = arr[i * 6]! - 0.12;
        }
      }
      pos.needsUpdate = true;
    }
    this.snow.visible = a.weather === "snow";
    this.snow.position.set(target.x, target.y, target.z);
    if (this.snow.visible) {
      const pos = this.snow.geometry.getAttribute("position") as THREE.BufferAttribute;
      const arr = pos.array as Float32Array;
      for (let i = 0; i < SNOW; i++) {
        let y = arr[i * 3 + 1]! - 1.2 * dt;
        if (y < 0) y += BOX.h;
        arr[i * 3 + 1] = y;
        arr[i * 3] = arr[i * 3]! + Math.sin(time / 900 + i) * 0.3 * dt;
      }
      pos.needsUpdate = true;
    }
    // Fireflies wander low; motes drift in the sun.
    this.drift(this.flies, this.fade.flies, target, time, 0.6, 2);
    (this.flies.material as THREE.PointsMaterial).opacity = this.fade.flies * (0.55 + 0.45 * Math.sin(time / 300));
    this.drift(this.motes, this.fade.motes, target, time, 0.25, 4);
    (this.motes.material as THREE.PointsMaterial).opacity = this.fade.motes * 0.5;
    // The haze: always a little with distance, thick in fog; its colour is the sky's in the ambient light.
    const fog = this.ctx.scene.fog as THREE.Fog;
    const base = this.on ? 1 : 0;
    fog.near = CAMERA_DISTANCE - 4 - 10 * this.fade.fog;
    fog.far = base ? CAMERA_DISTANCE + 70 - 48 * this.fade.fog : 1e6;
    fog.color.copy(HAZE).multiply(ambient);
    this.ctx.scene.background = fog.color;
    // Smoke: three puffs a chimney, rising and fading.
    this.chimneys.forEach((c, n) => {
      for (let p = 0; p < 3; p++) {
        const s = this.smoke[n * 3 + p]!;
        s.visible = this.on;
        const t = (((time / 2600 + p / 3 + n * 0.37) % 1) + 1) % 1;
        s.position.set(c.x + Math.sin(t * 6 + n) * 0.15 + t * 0.3, c.y + t * 1.6, c.z);
        s.scale.setScalar(0.25 + t * 0.6);
        s.material.opacity = 0.5 * (1 - t);
        s.material.color.copy(ambient);
      }
    });
  }

  private drift(p: THREE.Points, fade: number, target: { x: number; y: number; z: number }, time: number, speed: number, height: number): void {
    p.visible = fade > 0.01;
    if (!p.visible) return;
    p.position.set(target.x, target.y, target.z);
    const pos = p.geometry.getAttribute("position") as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    for (let i = 0; i < pos.count; i++) {
      arr[i * 3] = arr[i * 3]! + Math.sin(time / 1300 + i * 1.7) * 0.004 * speed;
      arr[i * 3 + 1] = Math.max(0.15, Math.min(height, arr[i * 3 + 1]! + Math.cos(time / 900 + i) * 0.003 * speed));
      arr[i * 3 + 2] = arr[i * 3 + 2]! + Math.cos(time / 1100 + i * 2.3) * 0.004 * speed;
    }
    pos.needsUpdate = true;
  }
}
