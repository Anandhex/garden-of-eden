/**
 * Light (G6): Phaser's Light2D for everything on the ground, standing or on a roof. The ambient colour follows the
 * frame's `ambience`; each light the server says is on glows with a soft halo, and the nearest few (Phaser's limit
 * per camera) are real lights that light the sprites round them, fires and torches flickering. Labels and bubbles
 * are not lit, so they stay readable at night.
 */
import * as Phaser from "phaser";
import type { Frame } from "@millbrook/shared/view";
import { pickFrame } from "../art";
import { DEPTH } from "./depth";
import { ambientOf, darkness, flicker, LIGHT_LOOK, nearestLights, rgbToInt, type Rgb } from "./lightPlan";
import { TILE } from "./textures";

/** Real lights at once (the pipeline's limit, set in the game config). */
export const LIGHT_BUDGET = 24;

export class Lighting {
  readonly on: boolean;
  private pool: Phaser.GameObjects.Light[] = [];
  private assigned: Array<{ kind: keyof typeof LIGHT_LOOK; seed: number } | null> = [];
  private halos = new Map<string, Phaser.GameObjects.Image>();
  private ambient: Rgb = [1, 1, 1];
  private shown: Rgb = [1, 1, 1];
  private light = 1;

  constructor(private readonly scene: Phaser.Scene & { px(x: number, y: number): { x: number; y: number } }) {
    this.on = scene.sys.game.renderer.type === Phaser.WEBGL;
    if (!this.on) return;
    scene.lights.enable().setAmbientColor(0xffffff);
    for (let i = 0; i < LIGHT_BUDGET; i++) {
      this.pool.push(scene.lights.addLight(0, 0, TILE * 3, 0xffffff, 0).setVisible(false));
      this.assigned.push(null);
    }
  }

  /** Light this object (no-op without WebGL). */
  lit<T extends Phaser.GameObjects.GameObject & { setPipeline(p: string): unknown }>(o: T): T {
    if (this.on) o.setPipeline("Light2D");
    return o;
  }

  /** The current ambient colour (for things drawn unlit that should still darken at night). */
  get tint(): number {
    return rgbToInt(this.shown);
  }

  setAmbience(a: Frame["ambience"]): void {
    this.ambient = ambientOf(a);
    this.light = a.light;
  }

  /** The lights in view: halos for every one that's on, a real light for the nearest (to `me`, in tiles). */
  setLights(lights: NonNullable<Frame["lights"]>, me: { x: number; y: number }): void {
    const want = new Set<string>();
    const k = darkness(this.light);
    for (const l of lights) {
      if (!l.on || l.kind === "window") continue;
      want.add(l.id);
      let h = this.halos.get(l.id);
      if (!h) {
        const p = pickFrame("fx/glow");
        h = this.scene.add.image(0, 0, p?.sheet ?? "lantern", p?.frame).setBlendMode(Phaser.BlendModes.ADD).setDepth(DEPTH.glow);
        this.halos.set(l.id, h);
      }
      const look = LIGHT_LOOK[l.kind];
      const at = this.scene.px(l.x - 0.5, l.y - 0.5);
      h.setPosition(at.x, at.y).setTint(look.color).setScale((look.radius * TILE * 0.9) / 64).setAlpha(0.35 * k).setVisible(true);
      h.setData("flicker", look.flicker).setData("seed", hashId(l.id)).setData("alpha", 0.35 * k);
    }
    for (const [id, h] of this.halos) if (!want.has(id)) (h.destroy(), this.halos.delete(id));
    if (!this.on) return;
    const near = nearestLights(lights, me, LIGHT_BUDGET);
    this.pool.forEach((light, i) => {
      const l = near[i];
      if (!l) {
        light.setVisible(false).setIntensity(0);
        this.assigned[i] = null;
        return;
      }
      const look = LIGHT_LOOK[l.kind];
      const at = this.scene.px(l.x - 0.5, l.y - 0.5);
      light.setPosition(at.x, at.y).setRadius(look.radius * TILE).setColor(look.color).setIntensity(look.intensity * k).setVisible(true);
      this.assigned[i] = { kind: l.kind, seed: hashId(l.id) };
    });
  }

  /** Each frame: ease the ambient towards its target, and flicker the fires. */
  update(time: number, delta: number): void {
    const ease = Math.min(1, delta / 600);
    this.shown = [0, 1, 2].map((i) => this.shown[i]! + (this.ambient[i]! - this.shown[i]!) * ease) as Rgb;
    if (this.on) this.scene.lights.setAmbientColor(rgbToInt(this.shown));
    const k = darkness(this.light);
    this.pool.forEach((light, i) => {
      const a = this.assigned[i];
      if (!a) return;
      const look = LIGHT_LOOK[a.kind];
      if (look.flicker) light.setIntensity(look.intensity * k * flicker(time, a.seed, look.flicker));
    });
    for (const h of this.halos.values()) {
      const f = h.getData("flicker") as number;
      if (f) h.setAlpha((h.getData("alpha") as number) * flicker(time, h.getData("seed") as number, f));
    }
  }

  clear(): void {
    for (const h of this.halos.values()) h.destroy();
    this.halos.clear();
    this.pool.forEach((l, i) => {
      l.setVisible(false).setIntensity(0);
      this.assigned[i] = null;
    });
  }
}

function hashId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return (h % 1000) / 37;
}
