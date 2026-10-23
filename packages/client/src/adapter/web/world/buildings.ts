/**
 * Buildings (G6), dressed in their templates (shared templates.json): the front wall y-sorted with the people, the
 * roof above them, fading while the player is under it or behind it, chimneys and signs, a porch for a door the roof
 * would hide, and the lit-window frames the server's window lights turn on. A building whose template is unknown
 * is drawn as a plain block, never as nothing.
 */
import * as Phaser from "phaser";
import { dress, TEMPLATES, templateFor, type Frame } from "@millbrook/shared/view";
import type { Core } from "../../../core";
import { pickFrame, warnMissing, type Pick } from "../art";
import { DPR, font } from "./actors";
import { DEPTH, sortDepth } from "./depth";
import { hexColor, TILE } from "./textures";

type BuildingData = NonNullable<Frame["buildings"]>[number];

/** Roofs under or in front of the player fade to this. */
const FADED = 0.28;

function setPick(img: Phaser.GameObjects.Image, p: Pick): Phaser.GameObjects.Image {
  return img.setTexture(p.sheet ?? p.frame, p.sheet ? p.frame : undefined).setOrigin(p.ox, p.oy).setScale(p.scale);
}

/** A colour moved towards white, so a tinted roof keeps its shading. */
function lighten(c: number, k: number): number {
  const ch = (s: number) => Math.round(((c >> s) & 255) + (255 - ((c >> s) & 255)) * k);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

export interface BuildingScene extends Phaser.Scene {
  core: Core;
  origin: { x: number; y: number };
  lit<T extends Phaser.GameObjects.GameObject & { setPipeline(p: string): unknown }>(o: T): T;
}

interface Drawn {
  b: BuildingData;
  roof: Phaser.GameObjects.GameObject[];
  rest: Phaser.GameObjects.GameObject[];
  alpha: number;
  windows: Map<string, Phaser.GameObjects.Image>;
}

export class BuildingLayer {
  private drawn: Drawn[] = [];
  private plain!: Phaser.GameObjects.Graphics;
  /** Door tiles the templates drew, as "x,y" (the ground layer skips the map's own door there). */
  doors = new Set<string>();

  constructor(private readonly scene: BuildingScene) {
    this.plain = scene.add.graphics().setDepth(DEPTH.sort);
  }

  private shape = "";

  /** Draw again on the next `draw` (a new map, or the scene's origin moved). */
  invalidate(): void {
    this.shape = "";
  }

  /** Dress the buildings; false (and nothing redrawn) when only their tips or lit windows changed. */
  draw(list: BuildingData[]): boolean {
    const shape = JSON.stringify(list.map((b) => [b.id, b.x, b.y, b.w, b.h, b.template, b.door, b.color, b.label]));
    if (shape === this.shape && this.drawn.length === list.length) {
      list.forEach((b, i) => (this.drawn[i]!.b = b));
      return false;
    }
    this.shape = shape;
    for (const d of this.drawn) for (const o of [...d.roof, ...d.rest]) o.destroy();
    this.drawn = [];
    this.doors.clear();
    this.plain.clear();
    const m = this.scene.core.frame;
    const o = this.scene.origin;
    const at = (x: number, y: number) => ({ x: (x - o.x) * TILE, y: (y - o.y) * TILE });
    for (const b of list) {
      const id = b.template ?? templateFor(b.kind, b.label, `${m.map?.id}:${b.id}`);
      const t = TEMPLATES[id];
      const door = b.door !== undefined ? b.door : findDoor(m, b);
      if (!t) {
        warnMissing(`template/${id}`);
        const p = at(b.x, b.y);
        this.plain.fillStyle(hexColor(b.color)).fillRect(p.x, p.y, b.w * TILE, b.h * TILE).lineStyle(2, 0x000000, 0.45).strokeRect(p.x + 1, p.y + 1, b.w * TILE - 2, b.h * TILE - 2);
        this.drawn.push({ b, roof: [], rest: [], alpha: 1, windows: new Map() });
        continue;
      }
      const dressed = dress(t, { x: b.x, y: b.y, w: b.w, h: b.h, door });
      const d: Drawn = { b, roof: [], rest: [], alpha: 1, windows: new Map() };
      const front = sortDepth(b.y + b.h - o.y - 0.2);
      const roofTint = t.roofTint ? lighten(hexColor(b.color), 0.35) : 0xffffff;
      const tile = (frame: string, x: number, y: number) => {
        const p = pickFrame(frame);
        if (!p) warnMissing(frame);
        const q = at(x, y);
        return p ? setPick(this.scene.add.image(q.x, q.y, ""), p).setOrigin(0) : this.scene.add.image(q.x, q.y, "town").setOrigin(0);
      };
      for (const r of dressed.roof) d.roof.push(this.scene.lit(tile(r.frame, r.x, r.y)).setDepth(DEPTH.roof).setTint(roofTint));
      for (const w of dressed.walls) d.rest.push(this.scene.lit(tile(w.frame, w.x, w.y)).setDepth(front));
      if (dressed.door?.front) this.doors.add(`${dressed.door.x},${dressed.door.y}`);
      else if (dressed.door) {
        // A door on a side the roof hides: a porch on the roof's edge shows where it is.
        const porch = this.scene.lit(tile(t.porch, dressed.door.x, dressed.door.y)).setDepth(DEPTH.porch);
        d.roof.push(porch);
        this.doors.add(`${dressed.door.x},${dressed.door.y}`);
      }
      for (const p of dressed.props) {
        const pick = pickFrame(p.frame);
        if (!pick) {
          warnMissing(p.frame);
          continue;
        }
        const q = at(p.x, p.y);
        const img = this.scene.lit(setPick(this.scene.add.image(q.x, q.y, ""), pick));
        if (p.layer === "roof") d.roof.push(img.setDepth(DEPTH.roofProp));
        else d.rest.push(img.setDepth(front + 0.01));
      }
      dressed.windows.forEach((w, k) => {
        const pick = pickFrame(w.glow);
        if (!pick) return;
        const q = at(Math.floor(w.x), Math.floor(w.y));
        const img = setPick(this.scene.add.image(q.x, q.y, ""), pick).setOrigin(0).setBlendMode(Phaser.BlendModes.ADD).setDepth(front + 0.02).setVisible(false);
        d.windows.set(`win:${b.id}:${k}`, img);
        d.rest.push(img);
      });
      if (b.label) {
        const q = at(b.x + b.w / 2, b.y + (b.h - 1) / 2);
        d.roof.push(this.scene.add.text(q.x, q.y, b.label, font(12, "#f3e9d2")).setOrigin(0.5, 0.5).setDepth(DEPTH.roofProp + 1).setResolution(DPR));
      }
      this.drawn.push(d);
    }
    return true;
  }

  /** The window lights the server says are on show their lit frame. */
  setLights(lights: NonNullable<Frame["lights"]>): void {
    const on = new Set(lights.filter((l) => l.on && l.kind === "window").map((l) => l.id));
    for (const d of this.drawn) for (const [id, img] of d.windows) img.setVisible(on.has(id));
  }

  /** Each frame: fade the roofs the player is under or behind (drawing only: no rule asks where the player is). */
  update(me: { x: number; y: number } | null, delta: number): void {
    const px = me ? Math.round(me.x) : Number.NaN;
    const py = me ? Math.round(me.y) : Number.NaN;
    const ease = Math.min(1, delta / 160);
    for (const d of this.drawn) {
      const b = d.b;
      const under = px >= b.x && px < b.x + b.w && py >= b.y - 1 && py <= b.y + b.h - 2;
      const want = under ? FADED : 1;
      if (Math.abs(d.alpha - want) < 0.005) continue;
      d.alpha += (want - d.alpha) * ease;
      for (const r of d.roof) (r as Phaser.GameObjects.Image).setAlpha(d.alpha);
    }
  }
}

/** A building's door from the patches: the map's door object inside its rectangle (frames from before G6 don't say). */
function findDoor(m: Core["frame"], b: BuildingData): { x: number; y: number } | null {
  for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) if (m.tileAt(x, y)?.object === "buildings/door") return { x, y };
  return null;
}
