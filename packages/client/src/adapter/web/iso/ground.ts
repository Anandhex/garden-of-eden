/**
 * The ground of the 2.5D view (G7): a square of tiles round the player as one mesh, filled from the frame's
 * patches with the same art and variants as the flat view; the Wang corner tiles where soft grounds meet grass,
 * on a grid half a tile off; water shimmering between its two frames. What stands on a tile is a sprite
 * (billboards.ts), except the town walls: blocks, cut down where they would stand between the camera and the player
 * (so a walled yard or a room is seen into). Off a place's map is a plain dark ground.
 */
import * as THREE from "three";
import { SHEET_ART, type SheetArt } from "../art";
import { pixelTexture, tileHash } from "./atlas";
import { Billboards, type Standing } from "./billboards";
import type { IsoCtx } from "./ctx";
import { hasModel } from "./models";

/** Tiles each way from the player that are drawn. */
export const POOL_R = 24;
const SOFT: Record<string, string> = { "terrain/path": "path", "terrain/road": "road", "terrain/water": "water", "terrain/sand": "sand" };
const GRASS = "terrain/grass";
const WATER_MS = 900;
const WALL_H = 1.5;
/** Walls nearer the camera than the player, within this many tiles of them, are cut down to CUT_H. */
const CUT_AHEAD = 4.5;
const CUT_SIDE = 3;
const CUT_H = 0.3;
/** A tile whose corners differ by more than this (tiles) is a bank: bare earth. */
const STEEP = 0.45;
/** Bare earth on a steep slope: art only this view picks (the server never sends it). */
const BANK = ["terrain/bank_0", "terrain/bank_1"];
/** Grounds that keep their own art on a slope. */
const HARD = new Set(["terrain/water", "terrain/path", "terrain/road", "terrain/town", "terrain/yard", "terrain/bridge", "terrain/ford"]);

const framesOf = (id: string): string[] => (SHEET_ART as Record<string, SheetArt>)[id]?.frames ?? [];
const variant = (id: string, hash: number): string | null => {
  const f = framesOf(id);
  return f.length ? f[Math.min(f.length - 1, Math.floor(hash * f.length))]! : null;
};

/** A tile's four corners, top-left, top-right, bottom-left, bottom-right: height and normal (x, z of the slope). */
export type Corners = [number, number, number, number];

/** A mesh of up to `n` quads on the land, rebuilt in place. */
export class QuadMesh {
  readonly mesh: THREE.Mesh;
  private pos: Float32Array;
  private uv: Float32Array;
  private normal: Float32Array;
  private used = 0;

  constructor(
    material: THREE.Material,
    private readonly n: number,
    y: number,
  ) {
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(n * 4 * 3);
    this.uv = new Float32Array(n * 4 * 2);
    const normal = new Float32Array(n * 4 * 3);
    for (let i = 0; i < n * 4; i++) normal[i * 3 + 1] = 1;
    this.normal = normal;
    const index = new Uint32Array(n * 6);
    for (let q = 0; q < n; q++) index.set([q * 4, q * 4 + 2, q * 4 + 1, q * 4 + 1, q * 4 + 2, q * 4 + 3], q * 6);
    g.setAttribute("position", new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute("uv", new THREE.BufferAttribute(this.uv, 2));
    g.setAttribute("normal", new THREE.BufferAttribute(normal, 3));
    g.setIndex(new THREE.BufferAttribute(index, 1));
    this.mesh = new THREE.Mesh(g, material);
    this.mesh.position.y = y;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
  }

  begin(): void {
    this.used = 0;
  }

  /** A quad from (x, z) one tile each way at its corners' heights, showing `r` of the texture. Returns its index. */
  add(x: number, z: number, r: { u0: number; v0: number; u1: number; v1: number }, h: Corners = [0, 0, 0, 0], slope?: Array<{ dx: number; dy: number }>): number {
    if (this.used >= this.n) return -1;
    const q = this.used++;
    this.pos.set([x, h[0], z, x + 1, h[1], z, x, h[2], z + 1, x + 1, h[3], z + 1], q * 12);
    for (let k = 0; k < 4; k++) {
      const s = slope?.[k] ?? { dx: 0, dy: 0 };
      const len = Math.hypot(s.dx, 1, s.dy);
      this.normal.set([-s.dx / len, 1 / len, -s.dy / len], q * 12 + k * 3);
    }
    this.setUv(q, r);
    return q;
  }

  setUv(q: number, r: { u0: number; v0: number; u1: number; v1: number }): void {
    this.uv.set([r.u0, r.v1, r.u1, r.v1, r.u0, r.v0, r.u1, r.v0], q * 8);
  }

  end(): void {
    const g = this.mesh.geometry;
    g.setDrawRange(0, this.used * 6);
    g.getAttribute("position").needsUpdate = true;
    g.getAttribute("uv").needsUpdate = true;
    g.getAttribute("normal").needsUpdate = true;
    g.computeBoundingSphere();
  }

  touchUv(): void {
    this.mesh.geometry.getAttribute("uv").needsUpdate = true;
  }
}

export class IsoGround {
  private tiles: QuadMesh;
  private blends: QuadMesh;
  private base: THREE.Mesh;
  readonly props: Billboards;
  private walls: THREE.InstancedMesh;
  private wallCap = 0;
  private wallTiles: Array<{ x: number; z: number; lo: number; hi: number }> = [];
  private at = { x: Number.NaN, y: Number.NaN };
  private water = 0;
  private waterQuads: Array<{ q: number; gx: number; gy: number }> = [];
  private cutYaw = Number.NaN;
  private cutAt = { x: Number.NaN, z: Number.NaN };
  dirty = true;
  /** Door tiles a building's template draws (so the map's own door isn't drawn twice), as "x,y". */
  dressedDoors = new Set<string>();
  /** Tree tiles in the pool (for fireflies). */
  trees: Array<{ x: number; y: number }> = [];

  constructor(private readonly ctx: IsoCtx) {
    const tex = ctx.atlas.texture("terrain");
    const n = (POOL_R * 2 + 1) ** 2;
    this.tiles = new QuadMesh(new THREE.MeshLambertMaterial({ map: tex, color: tex ? 0xffffff : 0x4a7a3f }), n, 0);
    this.blends = new QuadMesh(new THREE.MeshLambertMaterial({ map: tex, alphaTest: 0.5, color: tex ? 0xffffff : 0x4a7a3f }), (POOL_R * 2 + 2) ** 2, 0.003);
    this.base = new THREE.Mesh(new THREE.PlaneGeometry(400, 400).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x24391f }));
    this.base.position.y = -0.02;
    this.base.receiveShadow = true;
    ctx.scene.add(this.base, this.tiles.mesh, this.blends.mesh);
    this.props = new Billboards(ctx);
    this.walls = this.makeWalls(64);
  }

  private wallMaterials: THREE.Material[] | null = null;

  /** Town wall blocks: the wall's face on the sides (a face and a half high), its top on top. */
  private makeWalls(cap: number): THREE.InstancedMesh {
    if (!this.wallMaterials) {
      const side = document.createElement("canvas");
      side.width = 16;
      side.height = 24;
      const s = side.getContext("2d")!;
      this.ctx.atlas.draw(s, "buildings/wall_face", 0, 8);
      this.ctx.atlas.draw(s, "buildings/wall_face", 0, 0, 16, 8);
      const top = document.createElement("canvas");
      top.width = top.height = 16;
      this.ctx.atlas.draw(top.getContext("2d")!, "buildings/wall_top", 0, 0);
      const sideM = new THREE.MeshLambertMaterial({ map: pixelTexture(new THREE.CanvasTexture(side)) });
      const topM = new THREE.MeshLambertMaterial({ map: pixelTexture(new THREE.CanvasTexture(top)) });
      this.wallMaterials = [sideM, sideM, topM, topM, sideM, sideM];
    }
    const g = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    const mesh = new THREE.InstancedMesh(g, this.wallMaterials, cap);
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    mesh.count = 0;
    this.wallCap = cap;
    this.ctx.scene.add(mesh);
    return mesh;
  }

  /** Redraw round the player's tile when it moved a tile or the patches changed; else just turn the water. */
  draw(cx: number, cy: number, time: number): void {
    const water = Math.floor(time / WATER_MS) % 2;
    this.base.position.x = cx - this.ctx.origin.x;
    this.base.position.z = cy - this.ctx.origin.y;
    if (!this.dirty && cx === this.at.x && cy === this.at.y) {
      if (water !== this.water) {
        this.water = water;
        for (const w of this.waterQuads) this.tiles.setUv(w.q, this.uvOf(variant("terrain/water", (tileHash(w.gx, w.gy) + water * 0.5) % 1)));
        this.tiles.touchUv();
      }
      this.cutWalls(false);
      return;
    }
    this.dirty = false;
    this.at = { x: cx, y: cy };
    this.water = water;
    const H = this.ctx.height;
    H.build(cx, cy, POOL_R + 1);
    const cornersOf = (x: number, y: number): Corners => [H.cornerAt(x, y), H.cornerAt(x + 1, y), H.cornerAt(x, y + 1), H.cornerAt(x + 1, y + 1)];
    const slopesOf = (x: number, y: number) => [H.slopeAt(x, y), H.slopeAt(x + 1, y), H.slopeAt(x, y + 1), H.slopeAt(x + 1, y + 1)];
    this.waterQuads = [];
    this.trees = [];
    const m = this.ctx.core.frame;
    const o = this.ctx.origin;
    const off = (gx: number, gy: number) => m.map?.kind === "place" && (gx < 0 || gy < 0 || gx >= (m.map.w ?? 0) || gy >= (m.map.h ?? 0));
    const groundAt = (gx: number, gy: number) => (off(gx, gy) ? null : (m.tileAt(gx, gy)?.ground ?? GRASS));
    const standing: Standing[] = [];
    this.wallTiles = [];
    this.tiles.begin();
    for (let gy = cy - POOL_R; gy <= cy + POOL_R; gy++) {
      for (let gx = cx - POOL_R; gx <= cx + POOL_R; gx++) {
        if (off(gx, gy)) continue;
        const t = m.tileAt(gx, gy);
        const ground = t?.ground ?? GRASS;
        const isWater = ground === "terrain/water";
        const hash = isWater ? (tileHash(gx, gy) + water * 0.5) % 1 : tileHash(gx, gy);
        const h = cornersOf(gx, gy);
        // A steep slope shows bare earth (the bank art), unless it is water or a made way.
        const steep = Math.max(...h) - Math.min(...h) > STEEP && !HARD.has(ground);
        const art = (steep ? BANK[Math.floor(hash * BANK.length)]! : null) ?? variant(ground, hash) ?? variant(GRASS, hash);
        const q = this.tiles.add(gx - o.x, gy - o.y, this.uvOf(art), h, slopesOf(gx, gy));
        if (isWater) this.waterQuads.push({ q, gx, gy });
        // A bridge's plank deck, its rails along the way across (the water is to its sides).
        if (ground === "terrain/bridge") {
          const across = groundAt(gx - 1, gy) === "terrain/water" || groundAt(gx + 1, gy) === "terrain/water";
          standing.push({ frame: "model/bridge", x: gx - o.x + 0.5, y: H.at(gx + 0.5, gy + 0.5), z: gy - o.y + 0.5, rot: across ? 0 : Math.PI / 2 });
        }
        const what = t?.object;
        if (!what || (what === "buildings/door" && this.dressedDoors.has(`${gx},${gy}`))) continue;
        if (what === "buildings/wall") {
          this.wallTiles.push({ x: gx - o.x, z: gy - o.y, lo: Math.min(...h), hi: Math.max(...h) });
          continue;
        }
        if (what === "props/tree") this.trees.push({ x: gx, y: gy });
        const frame = variant(what, tileHash(gx, gy));
        // Rocks lie any way round; furniture faces the room's front.
        // A sprite's foot is a little forward of the tile's middle (as the flat view draws it); a model stands in it.
        const fz = hasModel(frame ?? "") ? 0.5 : 0.62;
        if (frame) standing.push({ frame, x: gx - o.x + 0.5, y: H.at(gx + 0.5, gy + fz), z: gy - o.y + fz, rot: what === "props/rock" ? Math.floor(tileHash(gy, gx) * 4) * (Math.PI / 2) + 0.4 : 0 });
      }
    }
    this.tiles.end();
    // The half-tile grid: each corner point takes the four tiles round it (as the flat view does).
    this.blends.begin();
    for (let gy = cy - POOL_R; gy <= cy + POOL_R + 1; gy++) {
      for (let gx = cx - POOL_R; gx <= cx + POOL_R + 1; gx++) {
        const corners = [groundAt(gx - 1, gy - 1), groundAt(gx, gy - 1), groundAt(gx, gy), groundAt(gx - 1, gy)];
        let soft: string | null = null;
        let mask = 0;
        let ok = true;
        corners.forEach((c, k) => {
          if (c === GRASS) return;
          const s = c ? SOFT[c] : undefined;
          if (!s || (soft && s !== soft)) ok = false;
          else {
            soft = s;
            mask |= [1, 2, 4, 8][k]!;
          }
        });
        if (!ok || !soft || mask === 0 || mask === 15) continue;
        const f = this.ctx.atlas.frame(`terrain/wang/${soft}_${mask}`);
        if (f) this.blends.add(gx - o.x - 0.5, gy - o.y - 0.5, this.ctx.atlas.uv(f), [H.at(gx - 0.5, gy - 0.5), H.at(gx + 0.5, gy - 0.5), H.at(gx - 0.5, gy + 0.5), H.at(gx + 0.5, gy + 0.5)], [H.slopeAt(gx, gy), H.slopeAt(gx, gy), H.slopeAt(gx, gy), H.slopeAt(gx, gy)]);
      }
    }
    this.blends.end();
    this.props.set(standing);
    if (this.wallTiles.length > this.wallCap) {
      this.ctx.scene.remove(this.walls);
      this.walls.dispose();
      this.walls = this.makeWalls(Math.ceil(this.wallTiles.length * 1.5));
    }
    this.cutWalls(true);
  }

  private uvOf(frame: string | null): { u0: number; v0: number; u1: number; v1: number } {
    const f = frame ? this.ctx.atlas.frame(frame) : null;
    return f ? this.ctx.atlas.uv(f) : { u0: 0, v0: 0, u1: 0.001, v1: 0.001 };
  }

  private readonly mat = new THREE.Matrix4();

  /** Place the wall blocks, the ones between the camera and the player cut down; again when either moved. */
  private cutWalls(force: boolean): void {
    const me = this.ctx.core.frame.player;
    const px = me.x - this.ctx.origin.x + 0.5;
    const pz = me.y - this.ctx.origin.y + 0.5;
    if (!force && this.cutYaw === this.ctx.yaw && this.cutAt.x === px && this.cutAt.z === pz) return;
    this.cutYaw = this.ctx.yaw;
    this.cutAt = { x: px, z: pz };
    const dx = Math.sin(this.ctx.yaw);
    const dz = Math.cos(this.ctx.yaw);
    this.wallTiles.forEach((w, k) => {
      const vx = w.x + 0.5 - px;
      const vz = w.z + 0.5 - pz;
      const ahead = vx * dx + vz * dz;
      const side = Math.abs(vx * dz - vz * dx);
      const cut = ahead > 0.2 && ahead < CUT_AHEAD && side < CUT_SIDE;
      // From below the lowest corner, so a wall on a slope never floats.
      this.mat.makeScale(1, (cut ? CUT_H : WALL_H) + (w.hi - w.lo) + 0.1, 1).setPosition(w.x + 0.5, w.lo - 0.1, w.z + 0.5);
      this.walls.setMatrixAt(k, this.mat);
    });
    this.walls.count = this.wallTiles.length;
    this.walls.instanceMatrix.needsUpdate = true;
  }

  update(): void {
    this.props.update();
  }

  /** The land's mesh (clicks hit it; snow lies on it). */
  get surface(): THREE.Mesh {
    return this.tiles.mesh;
  }
}
