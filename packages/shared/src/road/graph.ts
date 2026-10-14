import type { JourneyRoad } from "./journey.js";
import type { RoadData } from "./types.js";

/**
 * The roads as a graph of places (N26): settlements joined by road polylines, with their real length in tiles.
 * Routes, how long a trip is, who travels where and when news arrives all read this one graph, so they agree with
 * what the player walks. (Waystations are not nodes: they stand beside a road.)
 */
export interface Edge {
  to: string;
  road: string;
  rev: boolean;
  len: number;
}

const graphs = new WeakMap<RoadData, Map<string, Edge[]>>();

export function graphOf(data: RoadData): Map<string, Edge[]> {
  let g = graphs.get(data);
  if (g) return g;
  g = new Map();
  const add = (from: string, e: Edge) => (g!.get(from) ?? g!.set(from, []).get(from)!).push(e);
  for (const r of data.roads) {
    if (r.id.startsWith("spur:")) continue;
    add(r.a, { to: r.b, road: r.id, rev: false, len: r.length });
    add(r.b, { to: r.a, road: r.id, rev: true, len: r.length });
  }
  graphs.set(data, g);
  return g;
}

export interface Way {
  /** Settlement ids, both ends included. */
  path: string[];
  roads: JourneyRoad[];
  /** Length in tiles. */
  tiles: number;
}

/** The shortest way between two places by road length, or null if the roads don't join them. `skip`: places not to pass through. */
export function shortestWay(data: RoadData, from: string, to: string, skip?: (id: string) => boolean): Way | null {
  if (from === to) return { path: [from], roads: [], tiles: 0 };
  const g = graphOf(data);
  if (!g.has(from) || !g.has(to)) return null;
  const best = new Map<string, number>([[from, 0]]);
  const prev = new Map<string, { id: string; edge: Edge }>();
  const open = new Set([from]);
  while (open.size > 0) {
    let cur = "";
    for (const id of open) if (!cur || best.get(id)! < best.get(cur)! || (best.get(id) === best.get(cur) && id < cur)) cur = id;
    open.delete(cur);
    if (cur === to) break;
    for (const e of g.get(cur) ?? []) {
      if (skip && e.to !== to && skip(e.to)) continue;
      const d = best.get(cur)! + e.len;
      if (!best.has(e.to) || d < best.get(e.to)!) {
        best.set(e.to, d);
        prev.set(e.to, { id: cur, edge: e });
        open.add(e.to);
      }
    }
  }
  if (!best.has(to)) return null;
  const path = [to];
  const roads: JourneyRoad[] = [];
  for (let c = to; c !== from; ) {
    const p = prev.get(c)!;
    roads.unshift({ id: p.edge.road, rev: p.edge.rev });
    path.unshift(p.id);
    c = p.id;
  }
  return { path, roads, tiles: best.get(to)! };
}

/** Tiles from one place to every other place it can reach (one search): for news that spreads. */
export function tilesFrom(data: RoadData, from: string): Map<string, number> {
  const g = graphOf(data);
  const best = new Map<string, number>([[from, 0]]);
  const open = new Set([from]);
  while (open.size > 0) {
    let cur = "";
    for (const id of open) if (!cur || best.get(id)! < best.get(cur)! || (best.get(id) === best.get(cur) && id < cur)) cur = id;
    open.delete(cur);
    for (const e of g.get(cur) ?? []) {
      const d = best.get(cur)! + e.len;
      if (!best.has(e.to) || d < best.get(e.to)!) {
        best.set(e.to, d);
        open.add(e.to);
      }
    }
  }
  return best;
}
