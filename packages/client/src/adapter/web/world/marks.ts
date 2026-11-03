/**
 * Marks on a place's map (N31), all drawing: soot and a broken roofline over a burned house, timbers of scaffolding,
 * a grey stone for each grave, an empty trestle, a banner in its colour, and smoke from the chimneys of houses with
 * someone home and a fire lit. The words are the frame's (shown on hover by the scene).
 */
import * as Phaser from "phaser";
import type { Frame } from "@millbrook/shared/view";
import { DEPTH } from "./depth";
import { hexColor, TILE } from "./textures";

type Mark = NonNullable<Frame["marks"]>[number];
type Building = NonNullable<Frame["buildings"]>[number];

export class MarksLayer {
  private g: Phaser.GameObjects.Graphics;
  private smoke: Phaser.GameObjects.Graphics;
  private chimneys: Array<{ x: number; y: number; k: number }> = [];

  constructor(scene: Phaser.Scene) {
    this.g = scene.add.graphics().setDepth(DEPTH.roof + 5);
    this.smoke = scene.add.graphics().setDepth(DEPTH.fog - 1);
  }

  /** Draw the marks again (they change rarely: a raid, a death, a building finished). */
  draw(marks: Mark[], origin: { x: number; y: number }): void {
    const g = this.g.clear();
    for (const m of marks) {
      const x = (m.x - origin.x) * TILE;
      const y = (m.y - origin.y) * TILE;
      const w = m.w * TILE;
      const h = m.h * TILE;
      switch (m.kind) {
        case "burned":
        case "ruin":
          g.fillStyle(0x1a1410, m.kind === "ruin" ? 0.75 : 0.55).fillRect(x, y, w, h);
          g.lineStyle(2, 0x3a2a20, 0.9).strokeRect(x + 2, y + 2, w - 4, h - 4);
          for (let k = 0; k < m.w; k++) g.fillStyle(0xd4561c, 0.25).fillCircle(x + k * TILE + TILE / 2, y + h / 2, TILE / 5);
          break;
        case "scaffold":
          g.lineStyle(2, 0x9a7a4a, 0.95);
          for (let k = 0; k <= m.w; k++) g.lineBetween(x + k * TILE, y, x + k * TILE, y + h);
          for (let k = 0; k <= m.h; k++) g.lineBetween(x, y + k * TILE, x + w, y + k * TILE);
          g.lineBetween(x, y, x + w, y + h);
          break;
        case "grave":
          g.fillStyle(m.label?.startsWith("an old grave") ? 0x6f6a5c : 0x8f8a7e, 1).fillRoundedRect(x + TILE * 0.3, y + TILE * 0.2, TILE * 0.4, TILE * 0.55, 4);
          g.fillStyle(0x4a5a32, 0.6).fillRect(x + TILE * 0.2, y + TILE * 0.75, TILE * 0.6, TILE * 0.15);
          break;
        case "stall_empty":
          g.lineStyle(2, 0x7a5a3a, 0.9).strokeRect(x + 3, y + TILE * 0.4, w - 6, TILE * 0.3);
          break;
        case "banner":
          g.lineStyle(2, 0x5a4a3a, 1).lineBetween(x + TILE / 2, y, x + TILE / 2, y + h);
          g.fillStyle(hexColor(m.colour ?? "#b5763f"), 1).fillRect(x + TILE / 2, y + 2, TILE * 0.4, TILE * 0.5);
          break;
        default:
          g.lineStyle(2, 0xc0b090, 0.8).strokeRect(x + 2, y + 2, w - 4, h - 4);
      }
    }
  }

  /** The chimneys that smoke now (buildings with `smoke`). */
  setSmoke(buildings: Building[], origin: { x: number; y: number }): void {
    this.chimneys = buildings.filter((b) => b.smoke).map((b, k) => ({ x: (b.x - origin.x + b.w * 0.7) * TILE, y: (b.y - origin.y) * TILE, k }));
  }

  /** Smoke curling up, a few puffs a chimney. */
  update(time: number): void {
    const s = this.smoke.clear();
    for (const c of this.chimneys) {
      for (let p = 0; p < 3; p++) {
        const t = ((time / 2600 + p / 3 + c.k * 0.37) % 1 + 1) % 1;
        s.fillStyle(0xd8d8d8, 0.35 * (1 - t)).fillCircle(c.x + Math.sin(t * 6 + c.k) * 4 + t * 6, c.y - t * TILE * 1.4, 3 + t * 6);
      }
    }
  }
}
