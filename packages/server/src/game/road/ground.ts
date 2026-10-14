import { CHUNK, Ground, chunkAt, chunkOf, cumulative, isSolidGround, project, type Chunk, type Footprint, type RoadData, type RoadPath, type RoadPlace, type RoadPoint } from "@millbrook/shared";
import type { Realm } from "../realm/types.js";
import { roadDataOf } from "./generateRoads.js";

/**
 * The server's view of the land (N26): chunks made on demand from the road data (the same `chunkAt` the browser
 * runs) and kept while they are near, plus the indexes a step needs: which gate a tile is, which places are near.
 */

interface Land {
  data: RoadData;
  chunks: Map<string, Chunk>;
  gates: Map<string, string>;
  byRoad: Map<string, RoadPath & { cum: number[] }>;
  footprints: Map<string, Footprint>;
  placesAt: Map<string, RoadPlace[]>;
  roadsAt: Map<string, Set<string>>;
}

const lands = new WeakMap<RoadData, Land>();
/** Chunks kept per world: the nine round the player and a few behind. */
const KEEP = 36;

export function landOf(realm: Realm): Land {
  const data = roadDataOf(realm);
  let land = lands.get(data);
  if (!land) {
    const gates = new Map<string, string>();
    for (const f of data.footprints) for (const g of Object.values(f.gates)) gates.set(`${g.x},${g.y}`, f.id);
    const byRoad = new Map(data.roads.map((r) => [r.id, { ...r, cum: cumulative(r.pts) }]));
    const placesAt = new Map<string, RoadPlace[]>();
    for (const p of data.places) {
      const k = `${chunkOf(p.on.x)},${chunkOf(p.on.y)}`;
      (placesAt.get(k) ?? placesAt.set(k, []).get(k)!).push(p);
    }
    const roadsAt = new Map<string, Set<string>>();
    for (const r of data.roads) for (const q of r.pts) {
      const k = `${chunkOf(q.x)},${chunkOf(q.y)}`;
      (roadsAt.get(k) ?? roadsAt.set(k, new Set()).get(k)!).add(r.id);
    }
    land = { data, chunks: new Map(), gates, byRoad, footprints: new Map(data.footprints.map((f) => [f.id, f])), placesAt, roadsAt };
    lands.set(data, land);
  }
  return land;
}

/** A chunk, made once and kept. */
export function chunkOfLand(land: Land, cx: number, cy: number): Chunk {
  const key = `${cx},${cy}`;
  let c = land.chunks.get(key);
  if (c) {
    // Most recently used last.
    land.chunks.delete(key);
    land.chunks.set(key, c);
    return c;
  }
  c = chunkAt(land.data, cx, cy);
  land.chunks.set(key, c);
  if (land.chunks.size > KEEP) land.chunks.delete(land.chunks.keys().next().value!);
  return c;
}

/** The kind of tile at a global tile. */
export function groundAt(land: Land, x: number, y: number): number {
  const c = chunkOfLand(land, chunkOf(x), chunkOf(y));
  return c.tiles[(y - c.cy * CHUNK) * CHUNK + (x - c.cx * CHUNK)]!;
}

export const walkableAt = (land: Land, x: number, y: number): boolean => !isSolidGround(groundAt(land, x, y));

/** The settlement whose gate is at this tile, if any. */
export const gateAt = (land: Land, x: number, y: number): string | undefined => land.gates.get(`${x},${y}`);

/** Places beside the road within `r` tiles of a point (looks in the chunks round it). */
export function placesNear(land: Land, p: RoadPoint, r: number): RoadPlace[] {
  const out: RoadPlace[] = [];
  const cx = chunkOf(p.x);
  const cy = chunkOf(p.y);
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) for (const pl of land.placesAt.get(`${cx + dx},${cy + dy}`) ?? []) if (Math.hypot(pl.on.x - p.x, pl.on.y - p.y) <= r) out.push(pl);
  return out;
}

/** The nearest road to a point within `within` tiles: which, how far along it, how far off. */
export function nearestRoad(land: Land, p: RoadPoint, within = 40): { road: RoadPath & { cum: number[] }; t: number; d: number } | null {
  let best: { road: RoadPath & { cum: number[] }; t: number; d: number } | null = null;
  const cx = chunkOf(p.x);
  const cy = chunkOf(p.y);
  const ids = new Set<string>();
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) for (const id of land.roadsAt.get(`${cx + dx},${cy + dy}`) ?? []) ids.add(id);
  for (const id of ids) {
    const r = land.byRoad.get(id)!;
    const pr = project(r.pts, r.cum, p);
    if (pr.d <= within && (!best || pr.d < best.d)) best = { road: r, t: pr.t, d: pr.d };
  }
  return best;
}

export { Ground };
