import { describeWalk, shortestWay, type RoadPath } from "@millbrook/shared";
import type { PlayerState } from "../../npc/types.js";
import type { Realm } from "../realm/types.js";
import { landOf, nearestRoad } from "./ground.js";

/** What the header says about where the player is on the road (N26): the road, how far each way, and how far to where they are going. */
export interface RoadHud {
  /** "the road from Ashby to Brenmere", or "the open country". */
  where: string;
  /** Off the road by this many tiles (null when on it). */
  off: number | null;
  /** The places at the two ends of the road they are on, with the walk to each. */
  ends: Array<{ id: string; name: string; tiles: number; walk: string }>;
  /** Where they are bound for, and the walk to it by road. */
  dest: { id: string; name: string; tiles: number; walk: string } | null;
  /** A waystation within sight (the lane to it is close). */
  inn: { id: string; name: string; tiles: number } | null;
}

const nameOf = (realm: Realm, id: string) => realm.settlements[id]?.name ?? id;

export function hudOf(realm: Realm, player: PlayerState): RoadHud | null {
  const state = player.road;
  if (!state) return null;
  const land = landOf(realm);
  const near = nearestRoad(land, state, 400);
  if (!near) return { where: "the open country", off: null, ends: [], dest: null, inn: null };
  const r: RoadPath = near.road;
  const spur = r.id.startsWith("spur:");
  const ends = spur
    ? [{ id: r.a, name: nameOf(realm, r.a), tiles: Math.round(near.t), walk: describeWalk(near.t) }]
    : [
        { id: r.a, name: nameOf(realm, r.a), tiles: Math.round(near.t), walk: describeWalk(near.t) },
        { id: r.b, name: nameOf(realm, r.b), tiles: Math.round(r.length - near.t), walk: describeWalk(r.length - near.t) },
      ];
  let dest: RoadHud["dest"] = null;
  if (state.dest && !spur) {
    // Go by whichever end is on the shortest way.
    let best: { tiles: number } | null = null;
    for (const e of ends) {
      const w = shortestWay(land.data, e.id, state.dest);
      if (w && (!best || e.tiles + w.tiles < best.tiles)) best = { tiles: e.tiles + w.tiles };
    }
    if (best) dest = { id: state.dest, name: nameOf(realm, state.dest), tiles: Math.round(best.tiles), walk: describeWalk(best.tiles) };
  }
  const way = land.data.places.find((p) => p.kind === "waystation" && Math.hypot(p.on.x - state.x, p.on.y - state.y) < 500);
  return {
    where: near.d > 40 ? "the open country" : spur ? `the lane to ${nameOf(realm, r.a)}` : `the road from ${nameOf(realm, r.a)} to ${nameOf(realm, r.b)}`,
    off: near.d > 12 ? Math.round(near.d) : null,
    ends,
    dest,
    inn: way ? { id: way.site ?? way.id, name: way.name, tiles: Math.round(Math.hypot(way.on.x - state.x, way.on.y - state.y)) } : null,
  };
}
