/**
 * The ground and what stands on it (G6): a pool of tiles round the camera, filled from the frame's patches. Soft
 * grounds (path, road, water, sand) meet grass on a second grid offset by half a tile, whose 16 corner tiles (the
 * Wang sets `npm run art` makes) round their edges. Trees, rocks, signposts and town walls are y-sorted with the
 * people; a town wall shows its face unless more wall stands south of it. A water tile shimmers between frames.
 */
import * as Phaser from "phaser";
import type { Core } from "../../../core";
import { pickArt, pickFrame, SHEET_ART, type Pick } from "../art";
import { DEPTH, sortDepth } from "./depth";
import { TILE, tileHash } from "./textures";

/** Which soft grounds blend with grass, by terrain id. */
const SOFT: Record<string, string> = { "terrain/path": "path", "terrain/road": "road", "terrain/water": "water", "terrain/sand": "sand" };
const GRASS = "terrain/grass";
const WATER_MS = 900;

function setPick(img: Phaser.GameObjects.Image, p: Pick): Phaser.GameObjects.Image {
  return img.setTexture(p.sheet ?? p.frame, p.sheet ? p.frame : undefined).setOrigin(p.ox, p.oy).setScale(p.scale);
}

export interface GroundScene extends Phaser.Scene {
  core: Core;
  origin: { x: number; y: number };
  lit<T extends Phaser.GameObjects.GameObject & { setPipeline(p: string): unknown }>(o: T): T;
}

export class GroundLayer {
  private tiles: Phaser.GameObjects.Image[] = [];
  private blends: Phaser.GameObjects.Image[] = [];
  private objects: Phaser.GameObjects.Image[] = [];
  private at = { x: Number.NaN, y: Number.NaN };
  private water = 0;
  dirty = true;
  /** Door tiles a building's template draws (so the map's door object isn't drawn twice). */
  dressedDoors = new Set<string>();
  /** The pool's water tiles, so the shimmer swaps only them. */
  private waterTiles: Array<{ k: number; gx: number; gy: number }> = [];
  /** Tree tiles drawn last time, for the foreground layer. */
  trees: Array<{ x: number; y: number }> = [];

  constructor(
    private readonly scene: GroundScene,
    private readonly w: number,
    private readonly h: number,
  ) {
    for (let i = 0; i < w * h; i++) {
      this.tiles.push(scene.lit(scene.add.image(0, 0, "grass0").setOrigin(0).setDepth(DEPTH.ground)));
      this.objects.push(scene.lit(scene.add.image(0, 0, "tree").setVisible(false)));
    }
    for (let i = 0; i < (w + 1) * (h + 1); i++) this.blends.push(scene.lit(scene.add.image(0, 0, "grass0").setOrigin(0).setDepth(DEPTH.blend).setVisible(false)));
  }

  /** Redraw round the camera's tile when it moved a tile, the patches changed, or the water's frame turned. */
  draw(cx: number, cy: number, time: number): void {
    const water = Math.floor(time / WATER_MS) % 2;
    if (!this.dirty && cx === this.at.x && cy === this.at.y) {
      if (water !== this.water) {
        this.water = water;
        for (const w of this.waterTiles) setPick(this.tiles[w.k]!, pickArt("terrain/water", (tileHash(w.gx, w.gy) + water * 0.5) % 1)).setOrigin(0);
      }
      return;
    }
    this.dirty = false;
    this.waterTiles = [];
    this.at = { x: cx, y: cy };
    this.water = water;
    const m = this.scene.core.frame;
    const o = this.scene.origin;
    const x0 = cx - Math.floor(this.w / 2);
    const y0 = cy - Math.floor(this.h / 2);
    const off = (gx: number, gy: number) => m.map?.kind === "place" && (gx < 0 || gy < 0 || gx >= (m.map.w ?? 0) || gy >= (m.map.h ?? 0));
    const groundAt = (gx: number, gy: number) => (off(gx, gy) ? null : (m.tileAt(gx, gy)?.ground ?? GRASS));
    this.trees = [];
    for (let j = 0; j < this.h; j++) {
      for (let i = 0; i < this.w; i++) {
        const gx = x0 + i;
        const gy = y0 + j;
        const k = j * this.w + i;
        const t = m.tileAt(gx, gy);
        const sx = (gx - o.x) * TILE;
        const sy = (gy - o.y) * TILE;
        const gone = off(gx, gy);
        const ground = t?.ground ?? GRASS;
        // Water swaps its two frames; everything else keeps its variant by the tile's hash.
        const hash = ground === "terrain/water" ? (tileHash(gx, gy) + water * 0.5) % 1 : tileHash(gx, gy);
        if (ground === "terrain/water") this.waterTiles.push({ k, gx, gy });
        const g = pickArt(ground, hash);
        setPick(this.tiles[k]!, g).setOrigin(0).setPosition(sx, sy).setVisible(!gone);
        const obj = this.objects[k]!;
        const what = t?.object;
        if (!what || gone || (what === "buildings/door" && this.dressedDoors.has(`${gx},${gy}`))) {
          obj.setVisible(false);
          continue;
        }
        if (what === "props/tree") this.trees.push({ x: gx, y: gy });
        let p: Pick | null = null;
        const wall = SHEET_ART["buildings/wall"].wall!;
        if (what === "buildings/wall") p = pickFrame(m.tileAt(gx, gy + 1)?.object === "buildings/wall" ? wall.top : wall.face);
        p ??= pickArt(what, tileHash(gx, gy));
        setPick(obj, p);
        if (p.sheet) obj.setPosition(sx + TILE / 2, sy + TILE);
        else obj.setOrigin(0).setPosition(sx, sy);
        obj.setDepth(sortDepth(gy - o.y + 0.9)).setVisible(true);
      }
    }
    // The half-tile grid: each corner point takes the four tiles round it.
    for (let j = 0; j <= this.h; j++) {
      for (let i = 0; i <= this.w; i++) {
        const gx = x0 + i;
        const gy = y0 + j;
        const b = this.blends[j * (this.w + 1) + i]!;
        const corners = [groundAt(gx - 1, gy - 1), groundAt(gx, gy - 1), groundAt(gx, gy), groundAt(gx - 1, gy)];
        let soft: string | null = null;
        let mask = 0;
        let ok = true;
        corners.forEach((c, n) => {
          if (c === GRASS) return;
          const s = c ? SOFT[c] : undefined;
          if (!s || (soft && s !== soft)) ok = false;
          else {
            soft = s;
            mask |= [1, 2, 4, 8][n]!;
          }
        });
        const p = ok && soft && mask !== 0 && mask !== 15 ? pickFrame(`terrain/wang/${soft}_${mask}`) : null;
        if (!p) {
          b.setVisible(false);
          continue;
        }
        setPick(b, p).setOrigin(0).setPosition((gx - o.x - 0.5) * TILE, (gy - o.y - 0.5) * TILE).setVisible(true);
      }
    }
  }
}
