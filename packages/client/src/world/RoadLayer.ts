/**
 * The open road in the world view (N26): a pool of tile images that follows the camera over the global tile grid,
 * drawing whatever `chunkAt` made. Positions are relative to an origin tile so they stay small for the GPU.
 */
import * as Phaser from "phaser";
import { CHUNK, Ground, chunkOf } from "@millbrook/shared";
import { groundAt, land, makeChunk } from "../roadData";
import { GRASS_VARIANTS, TILE, tileHash } from "./textures";

const POOL_W = 30;
const POOL_H = 22;

/** Tiles drawn over grass (they stand up from the ground). */
const OBJECTS: Record<number, string> = {
  [Ground.tree]: "tree",
  [Ground.rock]: "rock",
  [Ground.reeds]: "reeds",
  [Ground.farmhouse]: "farmhouse",
  [Ground.milestone]: "milestone",
  [Ground.signpost]: "signpost",
  [Ground.shrine]: "shrine",
  [Ground.bar]: "bar",
};

function groundKey(g: number, x: number, y: number): string {
  const n = tileHash(x, y);
  switch (g) {
    case Ground.road:
      return `rpath${Math.floor(n * 3)}`;
    case Ground.water:
      return "water";
    case Ground.sand:
      return "sand";
    case Ground.hill:
      return "hill";
    case Ground.marsh:
      return "marsh";
    case Ground.field:
      return "field";
    case Ground.ford:
      return "ford";
    case Ground.bridge:
      return "bridge";
    case Ground.town:
      return "town";
    case Ground.thatch:
      return "thatch";
    case Ground.wall:
      return "stonewall";
    case Ground.gate:
      return "gate";
    case Ground.yard:
      return "yard";
    default:
      return `grass${Math.floor(n * GRASS_VARIANTS)}`;
  }
}

export class RoadLayer {
  private ground: Phaser.GameObjects.Image[] = [];
  private objects: Phaser.GameObjects.Image[] = [];
  private labels = new Map<string, Phaser.GameObjects.Text>();
  private at = { x: Number.NaN, y: Number.NaN };

  constructor(
    private readonly scene: Phaser.Scene,
    /** The global tile drawn at the scene's (0, 0). */
    readonly origin: { x: number; y: number },
  ) {
    for (let i = 0; i < POOL_W * POOL_H; i++) {
      this.ground.push(scene.add.image(0, 0, "grass0").setOrigin(0).setDepth(0));
      this.objects.push(scene.add.image(0, 0, "tree").setOrigin(0).setVisible(false));
    }
  }

  /** Scene pixels of a global tile's corner. */
  px(gx: number, gy: number): { x: number; y: number } {
    return { x: (gx - this.origin.x) * TILE, y: (gy - this.origin.y) * TILE };
  }

  /** Redraw round the global tile `cx, cy` (the camera's middle) when it has moved; make nearby chunks a few at a time. */
  update(cx: number, cy: number): void {
    // Chunks round the middle, one made per call at most.
    const ccx = chunkOf(cx);
    const ccy = chunkOf(cy);
    let made = false;
    for (let dy = -1; dy <= 1 && !made; dy++) for (let dx = -1; dx <= 1 && !made; dx++) if (!land.chunks.has(`${ccx + dx},${ccy + dy}`)) made = !!makeChunk(ccx + dx, ccy + dy) || true;
    if (cx === this.at.x && cy === this.at.y && !made) return;
    this.at = { x: cx, y: cy };
    const x0 = cx - POOL_W / 2;
    const y0 = cy - POOL_H / 2;
    for (let j = 0; j < POOL_H; j++) {
      for (let i = 0; i < POOL_W; i++) {
        const gx = x0 + i;
        const gy = y0 + j;
        const g = groundAt(gx, gy) ?? Ground.grass;
        const k = j * POOL_W + i;
        const p = this.px(gx, gy);
        this.ground[k]!.setTexture(g === Ground.tree || g === Ground.rock || g === Ground.reeds || g === Ground.farmhouse || g === Ground.milestone || g === Ground.signpost || g === Ground.shrine || g === Ground.bar ? `grass${Math.floor(tileHash(gx, gy) * GRASS_VARIANTS)}` : groundKey(g, gx, gy)).setPosition(p.x, p.y);
        const o = OBJECTS[g];
        const img = this.objects[k]!;
        if (o) img.setTexture(o).setPosition(p.x, p.y).setDepth(10 + gy - this.origin.y + 0.4).setVisible(true);
        else img.setVisible(false);
      }
    }
    this.labelPlaces(x0, y0);
  }

  /** Names over the settlements and inns in view. */
  private labelPlaces(x0: number, y0: number): void {
    const data = land.data;
    if (!data) return;
    const want = new Map<string, { x: number; y: number; text: string; color: string }>();
    for (const f of data.footprints) {
      if (f.x1 < x0 - 20 || f.x0 > x0 + POOL_W + 20 || f.y1 < y0 - 20 || f.y0 > y0 + POOL_H + 20) continue;
      want.set(f.id, { x: (f.x0 + f.x1 + 1) / 2, y: f.y0 - 0.2, text: f.name, color: "#ffe9b0" });
    }
    for (const [id, t] of this.labels) {
      if (!want.has(id)) {
        t.destroy();
        this.labels.delete(id);
      }
    }
    for (const [id, w] of want) {
      let t = this.labels.get(id);
      if (!t) {
        t = this.scene.add.text(0, 0, w.text, { fontFamily: "system-ui, sans-serif", fontSize: "13px", fontStyle: "bold", color: w.color, stroke: "#000000", strokeThickness: 3 }).setOrigin(0.5, 1).setDepth(460);
        this.labels.set(id, t);
      }
      const p = this.px(w.x, w.y);
      t.setPosition(p.x, p.y);
    }
  }

  destroy(): void {
    for (const t of this.labels.values()) t.destroy();
    this.labels.clear();
    for (const i of [...this.ground, ...this.objects]) i.destroy();
  }
}

export { CHUNK };
