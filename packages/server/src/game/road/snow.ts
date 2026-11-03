import { closedRoads, type RoadData, type RoadPath } from "@millbrook/shared";
import { config } from "../../config.js";
import type { Realm } from "../realm/types.js";
import { shortest } from "./paths.js";

/**
 * Snowed-in high roads (N30 decision 6), for the server: which roads are shut today, and journeys and the player's way
 * that go round them. The rule itself is shared (shared/road/passes.ts), so it is the same in the browser.
 */

/** How near the pass (tiles) the drift stops a walker. */
export const DRIFT = 8;

const memo = new WeakMap<RoadData, { day: number; seed: number; set: Set<string> }>();

/** The roads closed by snow on a day. */
export function closedOn(realm: Realm, data: RoadData, day: number): Set<string> {
  const hit = memo.get(data);
  if (hit && hit.day === day && hit.seed === realm.seed) return hit.set;
  const set = closedRoads(realm.seed, data.roads, day, config.daysPerYear);
  memo.set(data, { day, seed: realm.seed, set });
  return set;
}

/** The snowed-in road whose drift is at a tile, if any. */
export function driftAt(realm: Realm, data: RoadData, day: number, x: number, y: number): RoadPath | null {
  const shut = closedOn(realm, data, day);
  if (shut.size === 0) return null;
  for (const r of data.roads) if (shut.has(r.id) && r.pass && Math.hypot(r.pass.x - x, r.pass.y - y) <= DRIFT) return r;
  return null;
}

/** Words for a snowed-in road: "the high road from Ashby to Brenmere". */
export const highRoadWords = (realm: Realm, r: RoadPath): string => `the high road from ${realm.settlements[r.a]?.name ?? r.a} to ${realm.settlements[r.b]?.name ?? r.b}`;

/**
 * A path of places that avoids the roads shut today, from `path[0]` to `path.at(-1)` (or, for a round trip, to the turn
 * and back), or null when there is no way round: then they wait. The path unchanged when none of its roads is shut.
 */
export function pathAround(realm: Realm, data: RoadData, path: string[], roads: Array<{ id: string }>, day: number, turn?: number): { path: string[]; turn?: number } | null {
  const shut = closedOn(realm, data, day);
  if (!roads.some((r) => shut.has(r.id))) return { path, ...(turn !== undefined ? { turn } : {}) };
  const to = turn !== undefined ? path[turn]! : path.at(-1)!;
  const out = shortest(data, path[0]!, to, shut);
  if (!out) return null;
  if (turn === undefined) return { path: out };
  return { path: [...out, ...out.slice(0, -1).reverse()], turn: out.length - 1 };
}
