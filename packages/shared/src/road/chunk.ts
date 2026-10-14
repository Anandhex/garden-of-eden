import { boundsOf, cumulative, pointAt } from "./geometry.js";
import { fractal, rand1024, valueNoise } from "./noise.js";
import { CHUNK } from "./scale.js";
import { Ground, type Anchor, type Footprint, type RiverPath, type RoadData, type RoadPath, type RoadPlace } from "./types.js";

/**
 * A chunk of the open road (N26): `CHUNK × CHUNK` tiles of the land between places, made from the road data
 * and nothing else. It is a pure function of `(data, cx, cy)`: the server makes it to check a step, the browser
 * makes it to draw, and they agree because nothing here is random and nothing is floating-point-sensitive in a
 * threshold. Everything is drawn in global tile coordinates and clipped to the chunk, never per chunk with local
 * choices, so chunk edges line up.
 */
export interface Chunk {
  cx: number;
  cy: number;
  /** Row by row: `tiles[y * CHUNK + x]` is a `Ground` kind. */
  tiles: Uint8Array;
}

interface Boxed<T> {
  item: T;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface Index {
  roads: Array<Boxed<RoadPath> & { cum: number[] }>;
  rivers: Array<Boxed<RiverPath>>;
  footprints: Array<Boxed<Footprint>>;
  places: Array<Boxed<RoadPlace>>;
  roadById: Map<string, RoadPath & { cum: number[] }>;
}

const indexes = new WeakMap<RoadData, Index>();

function indexOf(data: RoadData): Index {
  let ix = indexes.get(data);
  if (ix) return ix;
  const roads = data.roads.map((r) => {
    const b = boundsOf(r.pts, 6);
    return { item: r, ...b, cum: cumulative(r.pts) };
  });
  const roadById = new Map(roads.map((r) => [r.item.id, { ...r.item, cum: r.cum }]));
  ix = {
    roads,
    rivers: data.rivers.map((r) => ({ item: r, ...boundsOf(r.pts, r.half + 4) })),
    footprints: data.footprints.map((f) => ({ item: f, x0: f.x0 - 1, y0: f.y0 - 1, x1: f.x1 + 1, y1: f.y1 + 1 })),
    places: data.places.map((p) => ({ item: p, x0: p.at.x - 6, y0: p.at.y - 6, x1: p.at.x + 6, y1: p.at.y + 6 })),
    roadById,
  };
  indexes.set(data, ix);
  return ix;
}

/** Anchors farther than this from a chunk's middle can't be the nearest to any of its tiles (places are closer together than that). */
const ANCHOR_REACH = 9000;
/** Farmland lies within this many tiles of a place. */
const FARMLAND = 900;

const hits = (b: { x0: number; y0: number; x1: number; y1: number }, x0: number, y0: number, x1: number, y1: number) => b.x1 >= x0 && b.x0 <= x1 && b.y1 >= y0 && b.y0 <= y1;

/** The land's own tile at a point, by the terrain of the nearest place (bent by noise) and a roll. */
function land(seed: number, terrain: string, x: number, y: number, open: boolean): number {
  const r = rand1024(seed + 7, x, y);
  const wood = fractal(seed + 11, x, y, 40);
  switch (terrain) {
    case "forest": {
      // Dense in the middle of a wood, thin at its edge; a clearing now and then.
      const chance = Math.max(0, ((wood - 250) * 45) / 100);
      return r < chance ? Ground.tree : r > 1010 ? Ground.rock : Ground.grass;
    }
    case "hills": {
      if (r < 52) return Ground.rock;
      if (r < 110) return Ground.tree;
      return wood > 430 ? Ground.hill : Ground.grass;
    }
    case "marsh": {
      const pool = fractal(seed + 13, x, y, 30);
      if (pool > 820 && r < 700) return Ground.water;
      if (r < 120) return Ground.reeds;
      if (r < 140) return Ground.tree;
      return wood > 380 ? Ground.marsh : Ground.grass;
    }
    case "coast": {
      const shore = fractal(seed + 17, x, y, 60);
      if (shore > 780 && r < 500) return Ground.water;
      if (r < 80) return Ground.reeds;
      if (r < 100) return Ground.tree;
      return shore > 420 ? Ground.sand : Ground.grass;
    }
    case "valley":
      return r < 70 ? Ground.tree : r < 78 ? Ground.rock : open && wood > 450 ? Ground.field : Ground.grass;
    default:
      // plains
      return r < 28 ? Ground.tree : r < 33 ? Ground.rock : open && wood > 400 ? Ground.field : Ground.grass;
  }
}

/** The terrain of the nearest anchor to a point (and its squared distance), with the point bent by broad noise so borders wander. */
function terrainNear(seed: number, anchors: Anchor[], x: number, y: number): { terrain: string; d: number } {
  const wx = x + ((valueNoise(seed + 31, x, y, 700) - 512) * 420) / 512;
  const wy = y + ((valueNoise(seed + 37, x, y, 700) - 512) * 420) / 512;
  let best = { terrain: "plains", d: Infinity };
  for (const a of anchors) {
    const d = (a.x - wx) * (a.x - wx) + (a.y - wy) * (a.y - wy);
    if (d < best.d) best = { terrain: a.terrain, d };
  }
  return best;
}

export function chunkAt(data: RoadData, cx: number, cy: number): Chunk {
  const ix = indexOf(data);
  const seed = data.seed | 0;
  const X0 = cx * CHUNK;
  const Y0 = cy * CHUNK;
  const X1 = X0 + CHUNK - 1;
  const Y1 = Y0 + CHUNK - 1;
  const tiles = new Uint8Array(CHUNK * CHUNK);
  const set = (x: number, y: number, g: number) => {
    if (x >= X0 && x <= X1 && y >= Y0 && y <= Y1) tiles[(y - Y0) * CHUNK + (x - X0)] = g;
  };
  const get = (x: number, y: number): number => (x >= X0 && x <= X1 && y >= Y0 && y <= Y1 ? tiles[(y - Y0) * CHUNK + (x - X0)]! : 255);

  // 1. The land. Anchors that could be the nearest anywhere in this chunk (the centre's nearest plus slack for the noise bend).
  const mx = X0 + CHUNK / 2;
  const my = Y0 + CHUNK / 2;
  const near = data.anchors.filter((a) => (a.x - mx) * (a.x - mx) + (a.y - my) * (a.y - my) <= ANCHOR_REACH * ANCHOR_REACH);
  const anchors = near.length > 0 ? near : data.anchors;
  const cell = 8;
  for (let gy = Y0; gy <= Y1; gy += cell) {
    for (let gx = X0; gx <= X1; gx += cell) {
      const here = terrainNear(seed, anchors, gx + cell / 2, gy + cell / 2);
      // Farmland near the places people live.
      const open = here.d < FARMLAND * FARMLAND;
      for (let y = gy; y < gy + cell; y++) for (let x = gx; x < gx + cell; x++) set(x, y, land(seed, here.terrain, x, y, open));
    }
  }

  // 2. Rivers: banks first, so a river's water is never covered by another's bank.
  const rivers = ix.rivers.filter((r) => hits(r, X0, Y0, X1, Y1));
  const stamp = (x: number, y: number, radius: number, paint: (x: number, y: number) => void) => {
    const r = Math.ceil(radius);
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (dx * dx + dy * dy <= radius * radius) paint(x + dx, y + dy);
  };
  /** Visit every tile along a polyline (half-tile steps), skipping the stretches that can't reach the chunk. */
  const along = (pts: Array<{ x: number; y: number }>, margin: number, each: (x: number, y: number) => void) => {
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]!;
      const b = pts[i]!;
      if (Math.max(a.x, b.x) + margin < X0 || Math.min(a.x, b.x) - margin > X1 || Math.max(a.y, b.y) + margin < Y0 || Math.min(a.y, b.y) - margin > Y1) continue;
      const n = Math.max(1, Math.ceil(Math.sqrt((b.x - a.x) * (b.x - a.x) + (b.y - a.y) * (b.y - a.y)) * 2));
      for (let k = 0; k <= n; k++) each(Math.round(a.x + ((b.x - a.x) * k) / n), Math.round(a.y + ((b.y - a.y) * k) / n));
    }
  };
  for (const r of rivers) {
    along(r.item.pts, r.item.half + 3, (x, y) =>
      stamp(x, y, r.item.half + 2, (px, py) => {
        const g = get(px, py);
        if (g === 255 || g === Ground.water) return;
        const roll = rand1024(seed + 19, px, py);
        set(px, py, roll < 380 ? Ground.reeds : roll < 700 ? Ground.sand : Ground.grass);
      }),
    );
  }
  for (const r of rivers) along(r.item.pts, r.item.half + 1, (x, y) => stamp(x, y, r.item.half, (px, py) => set(px, py, Ground.water)));

  // 3. Roads over everything: on water, a bridge (main road) or a ford.
  const roads = ix.roads.filter((r) => hits(r, X0, Y0, X1, Y1));
  for (const r of roads) {
    const bridge = r.item.main ? Ground.bridge : Ground.ford;
    const radius = r.item.main ? 2 : 1;
    along(r.item.pts, radius + 1, (x, y) =>
      stamp(x, y, radius, (px, py) => {
        const g = get(px, py);
        if (g === 255) return;
        set(px, py, g === Ground.water ? bridge : g === Ground.bridge || g === Ground.ford ? g : Ground.road);
      }),
    );
  }

  // 4. Places beside the road (under the settlements, which are drawn over them).
  for (const p of ix.places.filter((q) => hits(q, X0, Y0, X1, Y1))) decorate(p.item, ix, set, get);

  // 5. Settlements: a block of town inside a wall, a gate for each road.
  for (const f of ix.footprints.filter((q) => hits(q, X0, Y0, X1, Y1))) {
    const fp = f.item;
    for (let y = Math.max(Y0, fp.y0); y <= Math.min(Y1, fp.y1); y++) {
      for (let x = Math.max(X0, fp.x0); x <= Math.min(X1, fp.x1); x++) {
        const border = x === fp.x0 || x === fp.x1 || y === fp.y0 || y === fp.y1;
        set(x, y, border ? Ground.wall : rand1024(seed + 23, x, y) < 380 ? Ground.thatch : Ground.town);
      }
    }
    for (const g of Object.values(fp.gates)) set(g.x, g.y, Ground.gate);
  }
  return { cx, cy, tiles };
}

/** Draw a place beside the road into the chunk (clipped by `set`). */
function decorate(p: RoadPlace, ix: Index, set: (x: number, y: number, g: number) => void, get: (x: number, y: number) => number): void {
  const { x, y } = p.at;
  switch (p.kind) {
    case "milestone":
      return set(x, y, Ground.milestone);
    case "signpost":
      return set(x, y, Ground.signpost);
    case "shrine": {
      set(x, y, Ground.shrine);
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, 1], [0, -1]] as const) if (get(x + dx, y + dy) !== Ground.road) set(x + dx, y + dy, Ground.yard);
      return;
    }
    case "farmstead": {
      for (let dy = -3; dy <= 3; dy++) for (let dx = -4; dx <= 4; dx++) if (get(x + dx, y + dy) !== Ground.road && get(x + dx, y + dy) !== 255) set(x + dx, y + dy, Ground.yard);
      for (let dy = -1; dy <= 0; dy++) for (let dx = -1; dx <= 1; dx++) set(x + dx, y + dy, Ground.farmhouse);
      return;
    }
    case "tollgate": {
      // A bar across both verges, the road itself left open.
      const road = ix.roadById.get(p.road);
      if (!road) return;
      const a = pointAt(road.pts, road.cum, p.t - 2);
      const b = pointAt(road.pts, road.cum, p.t + 2);
      const len = Math.sqrt((b.x - a.x) * (b.x - a.x) + (b.y - a.y) * (b.y - a.y)) || 1;
      const nx = -(b.y - a.y) / len;
      const ny = (b.x - a.x) / len;
      for (const side of [-1, 1]) for (let k = 4; k <= 8; k++) {
        const bx = Math.round(p.on.x + nx * k * side);
        const by = Math.round(p.on.y + ny * k * side);
        if (get(bx, by) !== 255) set(bx, by, Ground.bar);
      }
      set(p.at.x, p.at.y, Ground.signpost);
      return;
    }
    case "bridge":
    case "ferry": {
      // A keeper's hut on the bank.
      for (let dy = -1; dy <= 0; dy++) for (let dx = -1; dx <= 0; dx++) set(x + dx, y + dy, Ground.farmhouse);
      return;
    }
    case "waystation":
      return set(x, y, Ground.signpost);
  }
}

/** The tile kind at a global tile, from a chunk already made (`undefined` if the tile is outside it). */
export function groundIn(chunk: Chunk, x: number, y: number): number | undefined {
  const lx = x - chunk.cx * CHUNK;
  const ly = y - chunk.cy * CHUNK;
  return lx < 0 || ly < 0 || lx >= CHUNK || ly >= CHUNK ? undefined : chunk.tiles[ly * CHUNK + lx];
}
