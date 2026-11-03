/**
 * The height of the land (G7 Part B), sent with each patch so every adapter draws the same hills: one small integer
 * a tile, in eighths of a tile (0 … HEIGHT_MAX). It is drawing, made from the map and the tile alone (integer noise,
 * the same on every machine), and no rule reads it: walking, sight and travel don't change.
 *
 * Open land rolls gently and rises over hills; water lies lowest, the land sloping down to it over a few tiles; fords
 * and marsh sit just above the water; a bridge's deck stands over it. In a place the land rolls less, and every
 * building's rectangle (and a tile round it) is levelled to one pad so its doors meet the ground. Interiors are flat.
 */
import { fractal, seedOf, valueNoise } from "@millbrook/shared";

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
