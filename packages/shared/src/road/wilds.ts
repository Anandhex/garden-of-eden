import { hash2, seedOf } from "./noise.js";
import { CHUNK } from "./scale.js";
import type { Anchor, RoadData, RoadPath } from "./types.js";

/**
 * The wilds off the road (N27 step 1): seeded places in the chunk world away from every road, a few to a day's walk of
 * open country. Caves, ruins, standing stones, groves, herb patches, ore outcrops and hermits' huts, by the country. They
 * are a pure function of the road data and the chunk, so the browser draws them as the server knows them; secrets
 * (a gang's camp, a pack's lair) are not here, they come from the realm through the server (game/road/wildPlaces.ts).
 */
export const WILD_PLACE_KINDS = ["cave", "ruin", "stones", "grove", "herbs", "ore", "hut"] as const;
export type WildPlaceKind = (typeof WILD_PLACE_KINDS)[number];

export interface WildPoi {
  /** `w:<cx>:<cy>`. */
  id: string;
  kind: WildPlaceKind;
  /** The tile at its heart (global tiles). */
  x: number;
  y: number;
  name: string;
  /** The country it lies in. */
  terrain: string;
  /** 0..1: how hard it is to spot (a cave mouth in the brush, herbs in long grass). */
  hidden: number;
}

/** One chunk in this many holds a place (about one every 400 tiles walked across country). */
const ONE_IN = 7;
/** No wild place within this many tiles of a road or a settlement (those are N26F's roadside places). */
const OFF_ROAD = 160;

const BY_COUNTRY: Record<string, Array<[WildPlaceKind, number]>> = {
  forest: [["grove", 4], ["herbs", 3], ["cave", 2], ["ruin", 2], ["hut", 2], ["stones", 1]],
  hills: [["cave", 5], ["ore", 4], ["stones", 2], ["ruin", 1], ["hut", 1]],
  marsh: [["herbs", 4], ["ruin", 2], ["hut", 1], ["stones", 1], ["grove", 1]],
  coast: [["cave", 2], ["ruin", 2], ["stones", 2], ["herbs", 1]],
  valley: [["herbs", 3], ["grove", 2], ["stones", 2], ["ruin", 2], ["ore", 1], ["hut", 1]],
  plains: [["stones", 3], ["ruin", 3], ["grove", 2], ["herbs", 2], ["cave", 1]],
};

const HIDDEN: Record<WildPlaceKind, number> = { cave: 0.35, ruin: 0.1, stones: 0, grove: 0.15, herbs: 0.45, ore: 0.4, hut: 0.2 };

const ADJ = ["Grey", "Old", "Hollow", "Black", "Long", "High", "Weeping", "Crow's", "Mossy", "Quiet", "Red", "Broken"];
const NOUN: Record<WildPlaceKind, string[]> = {
  cave: ["Cave", "Hole", "Hollow"],
  ruin: ["Walls", "Tower", "Steading"],
  stones: ["Stones", "Ring", "Stone"],
  grove: ["Grove", "Copse", "Wood"],
  herbs: ["Herb-bed", "Simples"],
  ore: ["Outcrop", "Seam"],
  hut: ["Hut", "Bothy"],
};

/** The name a wild place goes by (code's words: the model may better it through N19's budget, never needed). */
export function wildName(kind: WildPlaceKind, h: number): string {
  const nouns = NOUN[kind];
  return `the ${ADJ[h % ADJ.length]} ${nouns[(h >>> 5) % nouns.length]}`;
}

/** The country at a point: the terrain of the nearest anchor. */
export function countryAt(anchors: Anchor[], x: number, y: number): string {
  let best = "plains";
  let d = Infinity;
  for (const a of anchors) {
    const e = (a.x - x) * (a.x - x) + (a.y - y) * (a.y - y);
    if (e < d) {
      d = e;
      best = a.terrain;
    }
  }
  return best;
}

const boxes = new WeakMap<RoadData, Array<{ r: RoadPath; x0: number; y0: number; x1: number; y1: number }>>();

/**
 * Is a point at least `OFF_ROAD` tiles from every settlement and every road's points (they lie no more than 48 tiles
 * apart)? Integer arithmetic only, so every engine agrees.
 */
export function offRoad(data: RoadData, x: number, y: number): boolean {
  for (const f of data.footprints) if (x >= f.x0 - OFF_ROAD && x <= f.x1 + OFF_ROAD && y >= f.y0 - OFF_ROAD && y <= f.y1 + OFF_ROAD) return false;
  let list = boxes.get(data);
  if (!list) {
    list = data.roads.map((r) => ({ r, x0: Math.min(...r.pts.map((p) => p.x)), y0: Math.min(...r.pts.map((p) => p.y)), x1: Math.max(...r.pts.map((p) => p.x)), y1: Math.max(...r.pts.map((p) => p.y)) }));
    boxes.set(data, list);
  }
  const far = OFF_ROAD * OFF_ROAD;
  for (const b of list) {
    if (x < b.x0 - OFF_ROAD || x > b.x1 + OFF_ROAD || y < b.y0 - OFF_ROAD || y > b.y1 + OFF_ROAD) continue;
    for (const p of b.r.pts) if ((p.x - x) * (p.x - x) + (p.y - y) * (p.y - y) < far) return false;
  }
  return true;
}

const memo = new WeakMap<RoadData, Map<string, WildPoi | null>>();

/** The wild place in a chunk, or null (most chunks have none). */
export function wildPoiIn(data: RoadData, cx: number, cy: number): WildPoi | null {
  let m = memo.get(data);
  if (!m) memo.set(data, (m = new Map()));
  const key = `${cx}:${cy}`;
  if (m.has(key)) return m.get(key)!;
  const out = rollChunk(data, cx, cy);
  m.set(key, out);
  if (m.size > 20000) m.delete(m.keys().next().value!);
  return out;
}

function rollChunk(data: RoadData, cx: number, cy: number): WildPoi | null {
  const h = hash2((data.seed ^ seedOf("wilds")) | 0, cx, cy);
  if (h % ONE_IN !== 0) return null;
  // Kept 8 tiles inside its chunk, so it is drawn whole by its own chunk.
  const x = cx * CHUNK + 8 + ((h >>> 4) % (CHUNK - 16));
  const y = cy * CHUNK + 8 + ((h >>> 12) % (CHUNK - 16));
  if (!offRoad(data, x, y)) return null;
  const terrain = countryAt(data.anchors, x, y);
  const weights = BY_COUNTRY[terrain] ?? BY_COUNTRY.plains!;
  const total = weights.reduce((a, [, w]) => a + w, 0);
  let r = (h >>> 20) % total;
  let kind: WildPlaceKind = weights[0]![0];
  for (const [k, w] of weights) {
    if (r < w) {
      kind = k;
      break;
    }
    r -= w;
  }
  return { id: `w:${cx}:${cy}`, kind, x, y, name: wildName(kind, h >>> 3), terrain, hidden: HIDDEN[kind] };
}

/** The wild places within `r` tiles of a point (the chunks round it). */
export function wildPoisNear(data: RoadData, x: number, y: number, r: number): WildPoi[] {
  const out: WildPoi[] = [];
  const c0x = Math.floor((x - r) / CHUNK);
  const c1x = Math.floor((x + r) / CHUNK);
  const c0y = Math.floor((y - r) / CHUNK);
  const c1y = Math.floor((y + r) / CHUNK);
  for (let cy = c0y; cy <= c1y; cy++) for (let cx = c0x; cx <= c1x; cx++) {
    const p = wildPoiIn(data, cx, cy);
    if (p && (p.x - x) * (p.x - x) + (p.y - y) * (p.y - y) <= r * r) out.push(p);
  }
  return out;
}
