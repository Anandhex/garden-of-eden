/**
 * Depth and atmosphere (G6), all drawing: rain and snow by the weather; and, unless the player turns atmosphere
 * off, fireflies on warm clear nights, dust in summer and autumn sun, fog in wet weather and on cold mornings, light
 * shafts on clear mornings and evenings, and a near foreground of leaves: the canopies of the trees at the bottom
 * of the view, drifting a little against the camera and softly blurred, as if nearer the eye than the street.
 */
import * as Phaser from "phaser";
import type { Frame } from "@millbrook/shared/view";
import { pickFrame, type Pick } from "../art";
import { DEPTH } from "./depth";
import { TILE } from "./textures";

const FIREFLIES = 16;
const MOTES = 22;
const FOGS = 7;
const SHAFTS = 4;
const LEAVES = 8;
/** How far the foreground drifts against the camera (share of its distance from the view's middle). */
const PARALLAX = 0.14;

function setPick(img: Phaser.GameObjects.Image, p: Pick | null, fallback: string): Phaser.GameObjects.Image {
  return p ? img.setTexture(p.sheet!, p.frame).setScale(p.scale) : img.setTexture(fallback);
}

interface Mote {
  img: Phaser.GameObjects.Image;
  x: number;
  y: number;
  vx: number;
  vy: number;
  phase: number;
}

export class Atmosphere {
  private rain: Phaser.GameObjects.Particles.ParticleEmitter;
  private snow: Phaser.GameObjects.Particles.ParticleEmitter;
  private flies: Mote[] = [];
  private motes: Mote[] = [];
  private fogs: Mote[] = [];
  private shafts: Phaser.GameObjects.Image[] = [];
  private leaves: Array<{ img: Phaser.GameObjects.Image; wx: number; wy: number }> = [];
  private want = { flies: false, dust: false, fog: false, shafts: false };
  private fade = { flies: 0, dust: 0, fog: 0, shafts: 0 };
  private blurred = false;
  on: boolean;
  blur: boolean;

  constructor(
    private readonly scene: Phaser.Scene,
    prefs: { atmosphere: boolean; blur: boolean },
  ) {
    this.on = prefs.atmosphere;
    this.blur = prefs.blur;
    const w = scene.scale.width;
    const h = scene.scale.height;
    const drop = pickFrame("fx/drop");
    const flake = pickFrame("fx/flake");
    this.rain = scene.add.particles(0, -10, drop?.sheet ?? "drop", { frame: drop?.frame, scale: drop ? drop.scale : 1, x: { min: 0, max: w + 120 }, speedY: { min: 380, max: 480 }, speedX: { min: -90, max: -60 }, lifespan: 1600, quantity: 3, frequency: 25, alpha: { start: 0.7, end: 0.3 }, emitting: false });
    this.rain.setDepth(DEPTH.weather).setScrollFactor(0);
    this.snow = scene.add.particles(0, -10, flake?.sheet ?? "flake", { frame: flake?.frame, x: { min: 0, max: w }, speedY: { min: 30, max: 60 }, speedX: { min: -20, max: 20 }, lifespan: 12000, quantity: 1, frequency: 90, scale: { min: (flake?.scale ?? 1) * 0.6, max: (flake?.scale ?? 1) * 1.1 }, alpha: 0.85, emitting: false });
    this.snow.setDepth(DEPTH.weather).setScrollFactor(0);
    const mk = (id: string, fallback: string, depth: number, add: boolean) => {
      const img = setPick(scene.add.image(0, 0, fallback), pickFrame(id), fallback).setScrollFactor(0).setDepth(depth).setAlpha(0).setVisible(false);
      if (add) img.setBlendMode(Phaser.BlendModes.ADD);
      return img;
    };
    const rnd = (n: number) => Math.random() * n;
    for (let i = 0; i < FIREFLIES; i++) this.flies.push({ img: mk("fx/firefly", "spark", DEPTH.glow, true).setTint(0xd8ff8a), x: rnd(w), y: rnd(h), vx: 0, vy: 0, phase: rnd(10) });
    for (let i = 0; i < MOTES; i++) this.motes.push({ img: mk("fx/dust", "spark", DEPTH.fog, true).setTint(0xfff0c8), x: rnd(w), y: rnd(h), vx: 4 + rnd(6), vy: -2 + rnd(4), phase: rnd(10) });
    for (let i = 0; i < FOGS; i++) {
      const f = mk("fx/fog", "flake", DEPTH.fog, false);
      f.setScale((pickFrame("fx/fog")?.scale ?? 1) * (5 + rnd(3)));
      this.fogs.push({ img: f, x: rnd(w), y: rnd(h), vx: 3 + rnd(5), vy: 0, phase: rnd(10) });
    }
    for (let i = 0; i < SHAFTS; i++) this.shafts.push(mk("fx/shaft", "spark", DEPTH.fog + 1, true).setTint(0xfff0c0).setScale((pickFrame("fx/shaft")?.scale ?? 1) * 3).setOrigin(0.5, 0));
    for (let i = 0; i < LEAVES; i++) {
      const img = scene.add.image(0, 0, "tree").setDepth(DEPTH.fore).setVisible(false);
      setPick(img, pickFrame("fx/leaves"), "tree").setScale((pickFrame("fx/leaves")?.scale ?? 1) * 2.2).setOrigin(0.5, 0.35);
      this.leaves.push({ img, wx: 0, wy: 0 });
    }
  }

  /** What the weather, season and hour call for. */
  setAmbience(a: Frame["ambience"]): void {
    const rainy = a.weather === "rain" || a.weather === "storm";
    if (rainy !== this.rain.emitting) rainy ? this.rain.start() : this.rain.stop();
    const snowy = a.weather === "snow";
    if (snowy !== this.snow.emitting) snowy ? this.snow.start() : this.snow.stop();
    this.rain.frequency = a.weather === "storm" ? 10 : 25;
    const clear = a.weather === "clear";
    const warm = a.season === "summer" || a.season === "spring";
    this.want.flies = clear && warm && a.light < 0.5;
    this.want.dust = clear && (a.season === "summer" || a.season === "autumn") && a.light >= 0.8;
    this.want.fog = rainy || ((a.season === "autumn" || a.season === "winter") && a.timeOfDay === "morning") || (a.timeOfDay === "night" && a.season !== "summer");
    this.want.shafts = clear && a.light >= 0.6 && (a.timeOfDay === "morning" || a.timeOfDay === "evening");
  }

  setOn(on: boolean, blur: boolean): void {
    this.on = on;
    this.blur = blur;
  }

  /** The trees in view: those nearest the bottom of the view get a canopy in the foreground. */
  setTrees(trees: Array<{ x: number; y: number }>, origin: { x: number; y: number }): void {
    const v = this.scene.cameras.main.worldView;
    const bottom = (v.bottom / TILE) + origin.y;
    const near = trees.filter((t) => t.y >= bottom - 2.2 && t.y <= bottom + 1).sort((a, b) => b.y - a.y || a.x - b.x).slice(0, LEAVES);
    this.leaves.forEach((l, i) => {
      const t = near[i];
      if (!t) return void l.img.setVisible(false);
      l.wx = (t.x - origin.x + 0.5) * TILE;
      l.wy = (t.y - origin.y + 1.6) * TILE;
      l.img.setVisible(this.on);
    });
  }

  update(time: number, delta: number, ambient: number): void {
    const cam = this.scene.cameras.main;
    const w = this.scene.scale.width;
    const h = this.scene.scale.height;
    const dt = delta / 1000;
    for (const k of ["flies", "dust", "fog", "shafts"] as const) {
      const target = this.on && this.want[k] ? 1 : 0;
      this.fade[k] += (target - this.fade[k]) * Math.min(1, dt * 0.8);
    }
    const wrap = (m: Mote, pad: number) => {
      if (m.x < -pad) m.x += w + pad * 2;
      if (m.x > w + pad) m.x -= w + pad * 2;
      if (m.y < -pad) m.y += h + pad * 2;
      if (m.y > h + pad) m.y -= h + pad * 2;
    };
    const t = time / 1000;
    for (const f of this.flies) {
      f.vx += (Math.sin(t * 0.7 + f.phase) * 14 - f.vx) * dt;
      f.vy += (Math.cos(t * 0.9 + f.phase * 1.7) * 10 - f.vy) * dt;
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      wrap(f, 10);
      const blink = Math.max(0, Math.sin(t * 2.1 + f.phase * 3));
      f.img.setPosition(f.x, f.y).setAlpha(this.fade.flies * blink).setVisible(this.fade.flies > 0.01);
    }
    for (const m of this.motes) {
      m.x += m.vx * dt + Math.sin(t + m.phase) * 0.1;
      m.y += m.vy * dt + Math.cos(t * 0.8 + m.phase) * 0.1;
      wrap(m, 4);
      m.img.setPosition(m.x, m.y).setAlpha(this.fade.dust * (0.35 + 0.35 * Math.sin(t * 1.3 + m.phase))).setVisible(this.fade.dust > 0.01);
    }
    for (const f of this.fogs) {
      // Fog drifts with the wind and a little against the camera, so it feels between you and the street.
      f.x += f.vx * dt;
      wrap(f, 200);
      f.img.setPosition(f.x - ((cam.scrollX * 0.25) % (w + 400)), f.y - ((cam.scrollY * 0.25) % (h + 400))).setAlpha(this.fade.fog * 0.5).setTint(ambient).setVisible(this.fade.fog > 0.01);
    }
    this.shafts.forEach((s, i) => {
      const x = ((i + 0.5) / SHAFTS) * w + Math.sin(t * 0.05 + i) * 30 - ((cam.scrollX * 0.1) % 80);
      s.setPosition(x, -20).setAlpha(this.fade.shafts * (0.1 + 0.05 * Math.sin(t * 0.4 + i * 2))).setVisible(this.fade.shafts > 0.01);
    });
    // The near leaves: they sit where their tree is, pushed away from the view's middle a little (parallax).
    const cx = cam.worldView.centerX;
    const cy = cam.worldView.centerY;
    for (const l of this.leaves) {
      if (!this.on) {
        l.img.setVisible(false);
        continue;
      }
      if (!l.img.visible) continue;
      l.img.setPosition(l.wx + (l.wx - cx) * PARALLAX, l.wy + (l.wy - cy) * PARALLAX).setTint(ambient).setAlpha(0.92);
    }
    this.setBlur(this.on && this.blur);
  }

  /** A soft blur on the near leaves (Phaser's FX pipeline, WebGL only). */
  private setBlur(on: boolean): void {
    if (on === this.blurred || this.scene.sys.game.renderer.type !== Phaser.WEBGL) return;
    this.blurred = on;
    for (const l of this.leaves) {
      if (on) l.img.preFX?.addBlur(1, 1, 1, 1.2);
      else l.img.preFX?.clear();
    }
  }
}
