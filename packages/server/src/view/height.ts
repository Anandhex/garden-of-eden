/**
 * The height of the land (G7 Part B), sent with each patch so every adapter draws the same hills: one small integer
 * a tile, in eighths of a tile (0 … HEIGHT_MAX). It is drawing, made from the map and the tile alone (integer noise,
 * the same on every machine), and no rule reads it: walking, sight and travel don't change.
 *
 * Open land rolls gently and rises over hills; water lies lowest, the land sloping down to it over a few tiles; fords
 * and marsh sit just above the water; a bridge's deck stands over it. In a place the land rolls less, and every
 * building's rectangle (and a tile round it) is levelled to one pad so its doors meet the ground. Interiors are flat.
 */
import { fractal, seedOf, valueNoise } from "@garden-of-eden/shared";

export const HEIGHT_MAX = 40;
export type LandKind = "water" | "ford" | "marsh" | "bridge" | "hill" | "land";

const WATER = 2;
/** How far (tiles) the land slopes down to water, and to the foot of a hill. */
const BANK = 3;
const HILL_R = 2;

export interface HeightCtx {
  seed: number;
  /** What the land is at a tile (anywhere: beyond the patch too). */
  kind: (x: number, y: number) => LandKind;
  /** Open land rolls more than a place. */
  open: boolean;
  /** Buildings' rectangles, levelled to pads. */
  pads?: Array<{ x: number; y: number; w: number; h: number }>;
  /** The place's size in tiles (a place only): its rim rises into hills round the town. */
  bounds?: { w: number; h: number };
}

const clamp = (v: number) => Math.max(0, Math.min(HEIGHT_MAX, Math.round(v)));

/** The land's own roll and hills at a tile, before water and pads. */
function rise(c: HeightCtx, x: number, y: number): number {
  const roll = fractal(c.seed, x, y, 16) / 1023;
  let h = c.open ? 6 + roll * 10 : 5 + roll * 4;
  if (c.open) {
    // Hills: how much of the ground round here is hill, so a hill swells rather than steps.
    let n = 0;
    for (let dy = -HILL_R; dy <= HILL_R; dy++) for (let dx = -HILL_R; dx <= HILL_R; dx++) if (c.kind(x + dx, y + dy) === "hill") n++;
    const share = n / (2 * HILL_R + 1) ** 2;
    h += share * (8 + (valueNoise(c.seed ^ 0x51ed, x, y, 5) / 1023) * 8);
  }
  return h;
}

/** Tiles to the nearest water within BANK (BANK + 1 when none). */
function toWater(c: HeightCtx, x: number, y: number): number {
  let best = BANK + 1;
  for (let dy = -BANK; dy <= BANK; dy++)
    for (let dx = -BANK; dx <= BANK; dx++) {
      const d = Math.max(Math.abs(dx), Math.abs(dy));
      if (d < best && c.kind(x + dx, y + dy) === "water") best = d;
    }
  return best;
}

/** The height of one tile (eighths of a tile). */
export function heightAt(c: HeightCtx, x: number, y: number): number {
  const pad = c.pads?.find((b) => x >= b.x - 1 && x <= b.x + b.w && y >= b.y - 1 && y <= b.y + b.h);
  if (pad) return clamp(landHeight(c, Math.floor(pad.x + pad.w / 2), Math.floor(pad.y + pad.h / 2)));
  return clamp(landHeight(c, x, y));
}

function landHeight(c: HeightCtx, x: number, y: number): number {
  const k = c.kind(x, y);
  if (k === "water") return WATER;
  if (k === "ford") return WATER + 1;
  if (k === "bridge") return WATER + 4;
  let h = rise(c, x, y);
  if (k === "marsh") h = Math.min(h, WATER + 2);
  const d = toWater(c, x, y);
  // The bank: down to just above the water at its edge.
  if (d <= BANK) h = WATER + 1 + (h - WATER - 1) * (d / (BANK + 1));
  return h;
}

/** The heights of a patch, row by row (all 0 inside a building). */
export function patchHeights(c: HeightCtx | null, x0: number, y0: number, w: number, h: number): number[] {
  const out: number[] = [];
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) out.push(c ? heightAt(c, x, y) : 0);
  return out;
}

export const heightSeed = (key: string): number => seedOf(`height|${key}`);


// ---------------------------------------------------------------------------------------------------------------
// Relief (Unity client): the same land with real depth. Same unit (eighths of a tile, so 1 = 0.15 m in the 3D client)
// but up to RELIEF_MAX (about 38 m): valleys and rolling hills in the open (tens of metres), a gentle roll inside a
// place (a few metres) rising into hills at its rim, softer banks, and every building's pad blended into the land over
// a few tiles so streets stay walkable and houses sit level. Still drawing only: no rule reads it. `height` (above) is
// unchanged for the other clients.

export const RELIEF_MAX = 255;
/** How far (tiles) the land eases down to water or marsh, and how far a pad blends into the land round it. */
const RELIEF_BANK = 22;
const PAD_BLEND = 4;

const sm = (a: number, b: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const n01 = (seed: number, x: number, y: number, cell: number): number => valueNoise(seed, x, y, cell) / 1023;
const reliefClamp = (v: number) => Math.max(0, Math.min(RELIEF_MAX, Math.round(v)));

/** The land's own shape at a tile, before water and pads. */
function reliefRise(c: HeightCtx, x: number, y: number): number {
  if (c.open) {
    const big = n01(c.seed ^ 0x9e37, x, y, 64);
    const mid = n01(c.seed ^ 0x51ed, x, y, 19);
    const small = n01(c.seed ^ 0x07a1, x, y, 7);
    const ridge = sm(0, 1, 1 - Math.abs(n01(c.seed ^ 0x0033, x, y, 31) * 2 - 1));
    let h = 22 + 8 * big + 124 * sm(0.3, 0.85, big) * (0.6 + 0.4 * ridge) + 28 * mid + 6 * small;
    let n = 0;
    for (let dy = -HILL_R; dy <= HILL_R; dy++) for (let dx = -HILL_R; dx <= HILL_R; dx++) if (c.kind(x + dx, y + dy) === "hill") n++;
    h += (n / (2 * HILL_R + 1) ** 2) * (30 + 24 * n01(c.seed ^ 0x2b, x, y, 5));
    return h;
  }
  // A place: a gentle roll a few metres across, and the rim lifting into hills.
  let h = 22 + 24 * n01(c.seed ^ 0x6a5, x, y, 30) + 8 * n01(c.seed ^ 0x1c3, x, y, 11) + 2 * n01(c.seed ^ 0x77, x, y, 4);
  if (c.bounds) {
    const r = Math.hypot((x - c.bounds.w / 2) / (c.bounds.w / 2), (y - c.bounds.h / 2) / (c.bounds.h / 2));
    h += sm(0.62, 1.2, r) * (46 + 30 * n01(c.seed ^ 0x3d9, x, y, 24));
  }
  return h;
}

/** Distance (tiles) to the nearest tile of a low kind within RELIEF_BANK, and which kind it is. */
function nearLow(c: HeightCtx, x: number, y: number): { d: number; low: number } {
  const R = RELIEF_BANK;
  // A coarse look first: most land has no water near, and that is the common case.
  let any = false;
  for (let dy = -R; dy <= R && !any; dy += 2)
    for (let dx = -R; dx <= R; dx += 2) {
      const k = c.kind(x + dx, y + dy);
      if (k === "water" || k === "marsh" || k === "ford") { any = true; break; }
    }
  if (!any) return { d: R + 1, low: 0 };
  let d = R + 1;
  let low = 0;
  for (let dy = -R; dy <= R; dy++)
    for (let dx = -R; dx <= R; dx++) {
      const dd = Math.hypot(dx, dy);
      if (dd >= d) continue;
      const k = c.kind(x + dx, y + dy);
      if (k === "water") { d = dd; low = WATER + 1; } else if (k === "marsh" || k === "ford") { d = dd; low = WATER + 3; }
    }
  return { d, low };
}

function reliefLand(c: HeightCtx, x: number, y: number): number {
  const k = c.kind(x, y);
  if (k === "water") return WATER;
  if (k === "ford") return WATER + 1;
  if (k === "bridge") return WATER + 4;
  if (k === "marsh") return WATER + 3;
  let h = reliefRise(c, x, y);
  const { d, low } = nearLow(c, x, y);
  // The land eases down to the water over the bank's width, as gently as the hills allow.
  if (d <= RELIEF_BANK) h = low + (h - low) * sm(0, RELIEF_BANK + 1, d);
  return h;
}

/** The relief of one tile (eighths of a tile, 0 … RELIEF_MAX). */
export function reliefAt(c: HeightCtx, x: number, y: number): number {
  const land = reliefLand(c, x, y);
  if (!c.pads || c.pads.length === 0) return reliefClamp(land);
  // Pads: a building's rectangle and a tile round it are level at the height of its middle; beyond, the pad fades into
  // the land over PAD_BLEND tiles (weights from every pad near, so a street between two houses has no seam).
  let wsum = 0;
  let hsum = 0;
  for (const b of c.pads) {
    const dx = Math.max(b.x - 1 - x, 0, x - (b.x + b.w));
    const dy = Math.max(b.y - 1 - y, 0, y - (b.y + b.h));
    const d = Math.hypot(dx, dy);
    if (d > PAD_BLEND) continue;
    const padH = reliefLand(c, Math.floor(b.x + b.w / 2), Math.floor(b.y + b.h / 2));
    if (d === 0) return reliefClamp(padH);
    const w = (1 - sm(0, PAD_BLEND, d)) ** 3;
    wsum += w;
    hsum += w * padH;
  }
  if (wsum === 0) return reliefClamp(land);
  const mix = Math.min(1, wsum);
  return reliefClamp((hsum / wsum) * mix + land * (1 - mix));
}

/** The relief of a patch, row by row (nothing inside a building). */
export function patchRelief(c: HeightCtx | null, x0: number, y0: number, w: number, h: number): number[] {
  const out: number[] = [];
  if (!c) return out;
  // Each tile's kind is asked about many times by its neighbours: remember within the patch.
  const memo = new Map<number, LandKind>();
  const cc: HeightCtx = {
    ...c,
    kind: (x, y) => {
      const key = (y + 100000) * 200003 + (x + 100000);
      let k = memo.get(key);
      if (k === undefined) { k = c.kind(x, y); memo.set(key, k); }
      return k;
    },
  };
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) out.push(reliefAt(cc, x, y));
  return out;
}
