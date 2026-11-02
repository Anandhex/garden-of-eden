import { cumulative, pointAt, project } from "./geometry.js";
import { seedOf } from "./noise.js";
import type { RoadData, RoadPath, RoadPoint } from "./types.js";

/**
 * Territories (N26F decision 3): packs and gangs hold stretches of road, not points. A territory is a stretch of one
 * road, from `t0` to `t1` tiles along it (from its `a` end), with a band `width` tiles either side. A pack's is one or two
 * stretches on roads out of the place whose woods it roams, picked by its id and favouring the country its kind likes; a
 * gang's is one stretch, 600 to 1,500 tiles long, on a road out of its seat, with its camp off the road inside the band.
 * Pure: the server (hostiles, off-screen meetings) and the admin view work them out the same way from the same ids.
 */
export interface Territory {
  /** "pack:<id>" or "gang:<id>", with "#2" for a pack's second stretch. */
  id: string;
  kind: "pack" | "gang";
  /** The pack or gang id. */
  owner: string;
  road: string;
  t0: number;
  t1: number;
  /** Tiles either side of the road. */
  width: number;
  /** The settlement it is near. */
  near: string;
  /** Gangs: where the camp is (off the road, inside the band). */
  camp?: RoadPoint;
  /** Packs: the den (a cave place beside the road inside the stretch), when there is one (filled by the caller). */
  den?: string;
}

export interface TerritoryInput {
  packs: Array<{ id: string; species: string; near: string; count: number; cap: number }>;
  gangs: Array<{ id: string; seat: string }>;
}

/** The country each kind likes best. */
export const LIKED: Record<string, string[]> = {
  wolf: ["forest", "hills"],
  boar: ["forest", "valley"],
  bear: ["hills", "forest"],
  spider: ["forest", "marsh"],
};

/** No territory covers more than this share of its road (so a road is never all danger). */
export const MAX_COVER = 0.4;
/** Tiles kept clear of a territory at each end of a road: the gates, their fields and their watch (so near a town, hardly anything comes out). */
export const GATE_CLEAR = 400;
export const PACK_WIDTH = 70;
export const GANG_WIDTH = 45;

const hashOf = (...parts: Array<string | number>) => seedOf(parts.join("|")) >>> 0;

/** The stretch of `road` that starts `from` tiles out of `site`'s end and is `len` long, in the road's own t. */
function stretchFrom(road: RoadPath, site: string, from: number, len: number): { t0: number; t1: number } | null {
  const usable = road.length - 2 * GATE_CLEAR;
  if (usable < 200) return null;
  const L = Math.max(150, Math.min(len, road.length * MAX_COVER, usable));
  const start = GATE_CLEAR + Math.min(Math.max(0, from), Math.max(0, usable - L));
  return road.a === site ? { t0: start, t1: start + L } : { t0: road.length - start - L, t1: road.length - start };
}

/** A point beside a road: `t` tiles along, `side` tiles off to the left (negative: right). */
export function besideRoad(road: RoadPath, t: number, side: number): RoadPoint {
  const cum = cumOf(road);
  const a = pointAt(road.pts, cum, Math.max(0, t - 3));
  const b = pointAt(road.pts, cum, Math.min(road.length, t + 3));
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const on = pointAt(road.pts, cum, t);
  return { x: Math.round(on.x + (-(b.y - a.y) / len) * side), y: Math.round(on.y + ((b.x - a.x) / len) * side) };
}

/** The terrain a road runs through: its two ends' country. */
function countryOf(data: RoadData, road: RoadPath): string[] {
  return [road.a, road.b].map((id) => data.footprints.find((f) => f.id === id)?.terrain ?? "plains");
}

/** Every territory of the living packs and gangs. */
export function territoriesOf(input: TerritoryInput, data: RoadData): Territory[] {
  const out: Territory[] = [];
  // How much of each road is held already: together they never hold more than MAX_COVER of it.
  const held = new Map<string, number>();
  const room = (r: RoadPath) => r.length * MAX_COVER - (held.get(r.id) ?? 0);
  const take = (r: RoadPath, s: { t0: number; t1: number }) => held.set(r.id, (held.get(r.id) ?? 0) + (s.t1 - s.t0));
  const roadsOut = (site: string) => data.roads.filter((r) => (r.a === site || r.b === site) && !r.id.startsWith("spur:")).sort((a, b) => (a.id < b.id ? -1 : 1));
  for (const p of [...input.packs].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    if (p.count <= 0) continue;
    const liked = LIKED[p.species] ?? [];
    const roads = roadsOut(p.near)
      .map((r) => ({ r, score: countryOf(data, r).filter((c) => liked.includes(c)).length * 1000 + (hashOf(p.id, r.id) % 1000) }))
      .sort((a, b) => b.score - a.score || (a.r.id < b.r.id ? -1 : 1));
    const n = roads.length >= 2 && p.count >= Math.ceil(p.cap * 0.6) ? 2 : Math.min(1, roads.length);
    const before = out.length;
    for (let k = 0; k < n; k++) {
      const r = roads[k]!.r;
      const h = hashOf(p.id, r.id, "stretch");
      const s = stretchFrom(r, p.near, 150 + (h % 1400), Math.min(room(r), 700 + ((h >>> 11) % 900)));
      if (!s || s.t1 - s.t0 > room(r) + 1e-6) continue;
      take(r, s);
      out.push({ id: `pack:${p.id}${k > 0 ? `#${k + 1}` : ""}`, kind: "pack", owner: p.id, road: r.id, ...s, width: PACK_WIDTH, near: p.near });
    }
    // Its roads already full: it shares a stretch another holds (two packs in the same woods), which covers no more road.
    if (out.length === before) {
      const shared = roads.map(({ r }) => out.find((t) => t.road === r.id)).find(Boolean);
      if (shared) out.push({ id: `pack:${p.id}`, kind: "pack", owner: p.id, road: shared.road, t0: shared.t0, t1: shared.t1, width: PACK_WIDTH, near: p.near });
    }
  }
  for (const g of [...input.gangs].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const roads = roadsOut(g.seat);
    if (roads.length === 0) continue;
    const r = roads[hashOf(g.id) % roads.length]!;
    const h = hashOf(g.id, r.id, "stretch");
    let s = stretchFrom(r, g.seat, 100 + (h % 900), Math.min(room(r), 600 + ((h >>> 9) % 900)));
    if (s && s.t1 - s.t0 > room(r) + 1e-6) {
      // The road is held already: the gang works the same stretch (it covers no more of it).
      const other = out.find((t) => t.road === r.id);
      s = other ? { t0: other.t0, t1: other.t1 } : null;
    } else if (s) take(r, s);
    if (!s) continue;
    const side = (h >>> 20) % 2 === 0 ? 1 : -1;
    const camp = besideRoad(r, (s.t0 + s.t1) / 2, side * (28 + ((h >>> 3) % 10)));
    out.push({ id: `gang:${g.id}`, kind: "gang", owner: g.id, road: r.id, ...s, width: GANG_WIDTH, near: g.seat, camp });
  }
  return out;
}

const cums = new WeakMap<RoadPath, number[]>();
const cumOf = (r: RoadPath) => {
  let c = cums.get(r);
  if (!c) cums.set(r, (c = cumulative(r.pts)));
  return c;
};

/** Is a tile inside a territory: on its road between t0 and t1, within its band? Returns how far along, or null. */
export function inTerritory(data: RoadData, t: Territory, at: RoadPoint): number | null {
  const road = data.roads.find((r) => r.id === t.road);
  if (!road) return null;
  // Far from the stretch's box: not in it (cheap, before projecting).
  const a = pointAt(road.pts, cumOf(road), t.t0);
  const b = pointAt(road.pts, cumOf(road), t.t1);
  const pad = t.width + (t.t1 - t.t0);
  if (at.x < Math.min(a.x, b.x) - pad || at.x > Math.max(a.x, b.x) + pad || at.y < Math.min(a.y, b.y) - pad || at.y > Math.max(a.y, b.y) + pad) return null;
  const pr = project(road.pts, cumOf(road), at);
  return pr.d <= t.width && pr.t >= t.t0 && pr.t <= t.t1 ? pr.t : null;
}

/** The share of each road covered by territories (for the `territories-sane` bound). */
export function coverOf(data: RoadData, ts: Territory[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of data.roads) {
    const spans = ts.filter((t) => t.road === r.id).map((t) => [t.t0, t.t1] as const).sort((a, b) => a[0] - b[0]);
    let covered = 0;
    let end = -Infinity;
    for (const [a, b] of spans) {
      if (b <= end) continue;
      covered += b - Math.max(a, end);
      end = b;
    }
    if (spans.length > 0) out.set(r.id, covered / Math.max(1, r.length));
  }
  return out;
}
