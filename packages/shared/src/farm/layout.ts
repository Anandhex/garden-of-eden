import { nearestOnSegment } from "../road/geometry.js";
import { seedOf } from "../road/noise.js";
import type { Footprint, RoadData } from "../road/types.js";
import type { Plot, PlotKind } from "./types.js";

/**
 * Laying out the land (N26G decision 1): a settlement's farmland lies around its footprint in rings that follow the
 * country: infield strips nearest the walls, then closes and paddocks, meadow by water, an orchard for a village and up.
 * How much land there is comes from the people and the farms (about PER_HEAD plots a head, more on plains, less in hills
 * and marsh). Plots keep clear of roads (a verge either side), rivers and other places. Pure, from the road data, so the
 * same seed lays out the same fields on the server and in the browser.
 */
export const STRIP = { w: 4, h: 16 } as const;
export const CLOSE = { w: 8, h: 8 } as const;
/** Gap between plots (a balk, a hedge line). */
const GAP = 1;
/** Tiles kept clear either side of a road. */
export const VERGE = 3;
/** Rings at most (a capital's fields reach a long way, but not for ever). */
const MAX_RINGS = 60;

export const PER_HEAD: Record<string, number> = { plains: 0.5, valley: 0.48, coast: 0.4, forest: 0.34, hills: 0.3, marsh: 0.3 };

export interface FieldsInput {
  site: string;
  terrain: string;
  population: number;
  /** The `farms` building level: each clears more land. */
  farms: number;
  kind: string;
}

/** How many plots a place has. */
export function plotCount(o: FieldsInput): number {
  if (o.population <= 0) return 0;
  return Math.max(4, Math.ceil(o.population * (PER_HEAD[o.terrain] ?? 0.4) * (1 + 0.15 * o.farms)));
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const segDist = (pts: Array<{ x: number; y: number }>, p: { x: number; y: number }) => {
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) best = Math.min(best, nearestOnSegment(pts[i - 1]!, pts[i]!, p).d);
  return best;
};

const cache = new WeakMap<RoadData, Map<string, Plot[]>>();

/**
 * Layouts that outlive the road data they were made from. The road data is made again whenever anything in the realm it is built from
 * changes (a mine dug anywhere, the centaur herd moving on), and every place's fields were then laid out again: a tenth of a whole-realm
 * day. A layout reads only the footprints, roads and rivers near enough to its rings, so it is kept with the region it looked at and what
 * was in it, and served again while that is unchanged.
 */
interface Laid {
  key: string;
  region: { x0: number; y0: number; x1: number; y1: number };
  sig: string;
  plots: Plot[];
}
const laid = new Map<string, Laid[]>();
const KEEP_LAID = 4;

const meets = (a: { x0: number; y0: number; x1: number; y1: number }, b: { x0: number; y0: number; x1: number; y1: number }, pad = 0) =>
  a.x0 - pad <= b.x1 && a.x1 + pad >= b.x0 && a.y0 - pad <= b.y1 && a.y1 + pad >= b.y0;
const boxOf = (pts: ReadonlyArray<{ x: number; y: number }>) => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  return { x0, y0, x1, y1 };
};

/** What a layout of `site` over `region` reads from the road data, as a string: equal strings, the same layout. */
function regionSig(data: RoadData, site: string, region: Laid["region"]): string {
  const parts: string[] = [];
  for (const f of data.footprints) if (f.id === site || meets(f, region)) parts.push(`f${f.id}:${f.x0},${f.y0},${f.x1},${f.y1}`);
  for (const rd of data.roads) if (!rd.id.startsWith("spur:") && meets(boxOf(rd.pts), region)) parts.push(`r${rd.id}:${rd.pts.map((p) => `${p.x},${p.y}`).join(" ")}`);
  data.rivers.forEach((rv, i) => {
    if (meets(boxOf(rv.pts), region, rv.half + 40)) parts.push(`v${i}:${rv.half}:${rv.pts.map((p) => `${p.x},${p.y}`).join(" ")}`);
  });
  return parts.join("|");
}

/** The plots of a place. */
export function fieldsOf(o: FieldsInput, data: RoadData): Plot[] {
  let byKey = cache.get(data);
  if (!byKey) cache.set(data, (byKey = new Map()));
  // Everything the layout reads: a place that grows or falls (its kind) is laid out again, not served a stale layout.
  const key = `${o.site}:${plotCount(o)}:${o.terrain}:${o.kind}`;
  const hit = byKey.get(key);
  if (hit) return hit;
  for (const l of laid.get(o.site) ?? []) {
    if (l.key !== key || regionSig(data, o.site, l.region) !== l.sig) continue;
    byKey.set(key, l.plots);
    return l.plots;
  }
  const fp = data.footprints.find((f) => f.id === o.site);
  const want = plotCount(o);
  const out: Plot[] = [];
  if (!fp || want === 0) return out;
  const roads = data.roads.filter((r) => !r.id.startsWith("spur:"));
  const others = data.footprints.filter((f) => f.id !== o.site);
  const boxes = roads.map((rd) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of rd.pts) {
      x0 = Math.min(x0, p.x);
      y0 = Math.min(y0, p.y);
      x1 = Math.max(x1, p.x);
      y1 = Math.max(y1, p.y);
    }
    return { rd, x0, y0, x1, y1 };
  });
  /** Not on a road's verge, a river, or another place. */
  const clear = (r: Rect): boolean => {
    for (const f of others) if (r.x + r.w + 2 > f.x0 && r.x - 2 < f.x1 && r.y + r.h + 2 > f.y0 && r.y - 2 < f.y1) return false;
    const pts: Array<{ x: number; y: number }> = [];
    for (let y = r.y; y < r.y + r.h; y += 2) for (let x = r.x; x < r.x + r.w; x += 2) pts.push({ x, y });
    pts.push({ x: r.x + r.w - 1, y: r.y + r.h - 1 });
    for (const b of boxes) {
      if (r.x + r.w + VERGE < b.x0 || r.x - VERGE > b.x1 || r.y + r.h + VERGE < b.y0 || r.y - VERGE > b.y1) continue;
      for (const p of pts) if (segDist(b.rd.pts, p) <= VERGE + 1) return false;
    }
    for (const rv of data.rivers) if (segDist(rv.pts, { x: r.x + r.w / 2, y: r.y + r.h / 2 }) <= rv.half + 2 + Math.max(r.w, r.h) / 2) return false;
    return true;
  };
  const taken: Rect[] = [];
  const overlaps = (r: Rect) => taken.some((t) => r.x < t.x + t.w + GAP && r.x + r.w + GAP > t.x && r.y < t.y + t.h + GAP && r.y + r.h + GAP > t.y);
  const hills = o.terrain === "hills" || o.terrain === "forest";
  const orchard = o.kind !== "hamlet";
  let n = 0;
  /** How far out from the footprint the rings looked. */
  let reach = 0;
  for (let ring = 0; ring < MAX_RINGS && n < want; ring++) {
    // Infields are strips in open country; further out, and in hills and woods, closes and paddocks.
    const outer = ring >= 3 || hills;
    const size = outer ? CLOSE : STRIP;
    const m = 3 + ring * (STRIP.h + GAP);
    reach = m + size.h + size.w;
    const box = { x0: fp.x0 - m - size.h, y0: fp.y0 - m - size.h, x1: fp.x1 + m, y1: fp.y1 + m };
    const cands: Rect[] = [];
    // Along the top and bottom: strips run north-south; along the sides: east-west.
    for (let x = box.x0; x + size.w <= box.x1 + size.h; x += size.w + GAP) {
      cands.push({ x, y: box.y0, w: size.w, h: size.h });
      cands.push({ x, y: box.y1, w: size.w, h: size.h });
    }
    for (let y = box.y0 + size.h + GAP; y + size.w <= box.y1; y += size.w + GAP) {
      cands.push({ x: box.x0, y, w: size.h, h: size.w });
      cands.push({ x: box.x1, y, w: size.h, h: size.w });
    }
    for (const r of cands) {
      if (n >= want) break;
      if (overlaps(r) || !clear(r)) continue;
      taken.push(r);
      const h = seedOf(`${o.site}|plot|${n}`) >>> 0;
      const nearWater = data.rivers.some((rv) => segDist(rv.pts, { x: r.x + r.w / 2, y: r.y + r.h / 2 }) <= rv.half + 30);
      let kind: PlotKind = outer ? (n % 4 === 3 ? "paddock" : "close") : "strip";
      if (nearWater && n % 5 === 0) kind = "meadow";
      if (orchard && n === 2) kind = "orchard";
      out.push({ id: `pl:${o.site}:${n}`, site: o.site, ...r, kind, field: (h >>> 4) % 3, ring });
      n++;
    }
  }
  byKey.set(key, out);
  // Kept with what it read: the rings' reach, and past it the verges, a neighbour's edge and a river's banks (regionSig pads for those).
  const pad = reach + VERGE + GAP + 8;
  const region = { x0: fp.x0 - pad, y0: fp.y0 - pad, x1: fp.x1 + pad, y1: fp.y1 + pad };
  laid.set(o.site, [{ key, region, sig: regionSig(data, o.site, region), plots: out }, ...(laid.get(o.site) ?? []).filter((l) => l.key !== key)].slice(0, KEEP_LAID));
  return out;
}

/** The plot under a tile, if any, and the tile's index in it. */
export function plotAt(plots: Plot[], x: number, y: number): { plot: Plot; i: number } | null {
  for (const p of plots) if (x >= p.x && x < p.x + p.w && y >= p.y && y < p.y + p.h) return { plot: p, i: (y - p.y) * p.w + (x - p.x) };
  return null;
}

/** The footprint a place's fields are around (for callers with only the data). */
export const footprintOf = (data: RoadData, site: string): Footprint | undefined => data.footprints.find((f) => f.id === site);
