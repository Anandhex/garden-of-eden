/**
 * Light in the 2.5D view (G7): a sky light in the ambient colour of the frame's `ambience` (lightPlan.ts, the same
 * as the flat view's), a sun whose height and warmth follow the daylight and whose shadows fall away from the
 * camera, a moon's faint blue at night; the nearest lights the server says are on get a real point light (fires
 * flicker), and every one that is on glows with a soft halo. Three.js divides light by π, so intensities are in π.
 */
import * as THREE from "three";
import type { Frame } from "@millbrook/shared/view";
import { ambientOf, darkness, flicker, LIGHT_LOOK, nearestLights, type Rgb } from "../world/lightPlan";
import type { IsoCtx } from "./ctx";

/** Real point lights at once (each costs every lit pixel). */
export const POINT_BUDGET = 8;
/** How high each kind of light hangs (tiles). */
const HEIGHT: Record<keyof typeof LIGHT_LOOK, number> = { window: 1.1, lamp: 1.4, fire: 0.45, torch: 1.2, forge: 0.7, magic: 1.0 };
/** Half the sun's shadow box (tiles round the player). */
const SHADOW_R = 22;

let haloTexture: THREE.CanvasTexture | null = null;

/** A soft round glow for halos (not pixel art: light should bloom smoothly). */
function halo(): THREE.CanvasTexture {
  if (haloTexture) return haloTexture;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, "rgba(255,255,255,1)");
  r.addColorStop(0.35, "rgba(255,255,255,0.45)");
  r.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = r;
  g.fillRect(0, 0, 64, 64);
  haloTexture = new THREE.CanvasTexture(c);
  haloTexture.colorSpace = THREE.SRGBColorSpace;
  return haloTexture;
}

export class IsoLights {
  readonly sky: THREE.HemisphereLight;
  readonly sun: THREE.DirectionalLight;
  private pool: THREE.PointLight[] = [];
  private assigned: Array<{ kind: keyof typeof LIGHT_LOOK; seed: number; base: number } | null> = [];
  private halos = new Map<string, { s: THREE.Sprite; flicker: number; seed: number; alpha: number }>();
  private ambient: Rgb = [1, 1, 1];
  private shown: Rgb = [1, 1, 1];
  private light = 1;
  private timeOfDay = "day";

  constructor(private readonly ctx: IsoCtx) {
    this.sky = new THREE.HemisphereLight(0xffffff, 0x88806a, Math.PI * 0.62);
    this.sun = new THREE.DirectionalLight(0xfff4e0, Math.PI * 0.55);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const cam = this.sun.shadow.camera;
    cam.left = cam.bottom = -SHADOW_R;
    cam.right = cam.top = SHADOW_R;
    cam.near = 1;
    cam.far = 120;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.03;
    ctx.scene.add(this.sky, this.sun, this.sun.target);
    for (let i = 0; i < POINT_BUDGET; i++) {
      // Always in the scene, dark when unused: a change in the number of lights would rebuild every shader.
      const p = new THREE.PointLight(0xffffff, 0, 4, 1);
      ctx.scene.add(p);
      this.pool.push(p);
      this.assigned.push(null);
    }
  }

  /** The ambient colour now, as a Three.js colour (for fog and things that follow the light). */
  get ambientColor(): THREE.Color {
    return new THREE.Color(this.shown[0], this.shown[1], this.shown[2]);
  }

  get daylight(): number {
    return this.light;
  }

  setAmbience(a: Frame["ambience"]): void {
    this.ambient = ambientOf(a);
    this.light = a.light;
    this.timeOfDay = a.timeOfDay;
  }

  /** The lights in view: halos for every one that's on, a real light for the nearest few. */
  setLights(lights: NonNullable<Frame["lights"]>, me: { x: number; y: number }): void {
    const o = this.ctx.origin;
    const k = darkness(this.light);
    const want = new Set<string>();
    for (const l of lights) {
      if (!l.on) continue;
      want.add(l.id);
      let h = this.halos.get(l.id);
      const look = LIGHT_LOOK[l.kind];
      if (!h) {
        const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: halo(), color: look.color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
        s.renderOrder = 2;
        this.ctx.scene.add(s);
        h = { s, flicker: look.flicker, seed: hashId(l.id), alpha: 0 };
        this.halos.set(l.id, h);
      }
      // Windows glow smaller and on the wall's face; the rest round the flame.
      const size = l.kind === "window" ? 1.3 : look.radius * 0.8;
      h.s.position.set(l.x - o.x, this.ctx.height.at(l.x, l.y) + HEIGHT[l.kind], l.y - o.y + (l.kind === "window" ? 0.15 : 0));
      h.s.scale.set(size, size, 1);
      h.alpha = (l.kind === "window" ? 0.45 : 0.5) * k;
    }
    for (const [id, h] of this.halos) {
      if (want.has(id)) continue;
      this.ctx.scene.remove(h.s);
      h.s.material.dispose();
      this.halos.delete(id);
    }
    const near = nearestLights(lights, me, POINT_BUDGET);
    this.pool.forEach((p, i) => {
      const l = near[i];
      if (!l) {
        p.intensity = 0;
        this.assigned[i] = null;
        return;
      }
      const look = LIGHT_LOOK[l.kind];
      p.position.set(l.x - o.x, this.ctx.height.at(l.x, l.y) + HEIGHT[l.kind], l.y - o.y + (l.kind === "window" ? 0.4 : 0));
      p.color.setHex(look.color);
      p.distance = look.radius * 1.6;
      const base = look.intensity * k * 3.2;
      p.intensity = base;
      this.assigned[i] = { kind: l.kind, seed: hashId(l.id), base };
    });
  }

  /** Each frame: ease the ambient, move the sun with the camera and the player, flicker the fires. */
  update(time: number, delta: number, target: { x: number; y: number; z: number }): void {
    const ease = Math.min(1, delta / 600);
    this.shown = [0, 1, 2].map((i) => this.shown[i]! + (this.ambient[i]! - this.shown[i]!) * ease) as Rgb;
    const amb = this.ambientColor;
    const day = Math.max(0, Math.min(1, this.light));
    this.sky.color.copy(amb);
    this.sky.groundColor.copy(amb).multiplyScalar(0.55);
    this.sky.intensity = Math.PI * (0.62 + 0.38 * (1 - day));
    // The sun from the camera's side, so shadows fall back into the scene: low and warm early and late.
    const low = this.timeOfDay === "morning" || this.timeOfDay === "evening";
    const side = this.timeOfDay === "morning" ? 1.1 : this.timeOfDay === "evening" ? -1.1 : 0.45;
    const az = this.ctx.yaw + side;
    const el = ((low ? 28 : 55) * Math.PI) / 180;
    // Snap the shadow box to whole tiles so the shadows don't swim as the player walks.
    const tx = Math.round(target.x);
    const tz = Math.round(target.z);
    const ty = Math.round(target.y);
    this.sun.target.position.set(tx, ty, tz);
    this.sun.position.set(tx + Math.sin(az) * Math.cos(el) * 50, ty + Math.sin(el) * 50, tz + Math.cos(az) * Math.cos(el) * 50);
    if (day > 0.15) {
      this.sun.color.setRGB(1, low ? 0.82 : 0.97, low ? 0.62 : 0.9);
      this.sun.intensity = Math.PI * 0.55 * day;
    } else {
      // The moon: faint and blue, still casting a shadow.
      this.sun.color.setRGB(0.55, 0.65, 1);
      this.sun.intensity = Math.PI * 0.12;
    }
    this.pool.forEach((p, i) => {
      const a = this.assigned[i];
      if (!a) return;
      const f = LIGHT_LOOK[a.kind].flicker;
      if (f) p.intensity = a.base * flicker(time, a.seed, f);
    });
    for (const h of this.halos.values()) h.s.material.opacity = h.flicker ? h.alpha * flicker(time, h.seed, h.flicker) : h.alpha;
  }

  clear(): void {
    for (const h of this.halos.values()) {
      this.ctx.scene.remove(h.s);
      h.s.material.dispose();
    }
    this.halos.clear();
    this.pool.forEach((p, i) => {
      p.intensity = 0;
      this.assigned[i] = null;
    });
  }
}

function hashId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return (h % 1000) / 37;
}
