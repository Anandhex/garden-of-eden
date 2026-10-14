import { STEPS_PER_GAME_MINUTE, type Footprint, type RoadData, type RoadPath, type RoadPoint } from "@millbrook/shared";
import type { PlayerState } from "../../npc/types.js";
import { formatMoney } from "../money.js";
import type { Realm } from "../realm/types.js";
import { gateAt, groundAt, landOf, nearestRoad, placesNear, walkableAt } from "./ground.js";
import type { RoadState } from "./state.js";

/**
 * Walking the open road (N26 Part A3). One step is one tile; seven make a game minute (scale.ts). The server
 * checks every step against the same chunk the browser draws, enters a settlement by its gate, takes tolls, and
 * records the stretches of road the player has walked (for fast travel). `player.site` stays where the player set
 * out from; arriving is `Town.arriveAt` (the caller's job when `entered` comes back).
 */

/** How close (tiles) to the road counts as being on it for recording walked stretches. */
const ON_ROAD = 10;
/** Tiles of give when deciding a stretch was walked end to end. */
const SLACK = 30;
/** A toll is asked within this many tiles of its gate. */
export const TOLL_REACH = 3.5;

export interface RoadStep {
  ok: boolean;
  reason?: string;
  /** A whole game minute has passed (the caller lets the world live it). */
  minute: boolean;
  /** The player walked onto this settlement's gate. */
  entered?: string;
  /** Lines for the log: tolls paid, a stretch of road reached. */
  lines: string[];
}

/** The tile a settlement's gate toward a road leads out to (a couple of tiles beyond the wall). */
function outside(f: Footprint, g: RoadPoint, by = 2): RoadPoint {
  if (g.x === f.x0) return { x: g.x - by, y: g.y };
  if (g.x === f.x1) return { x: g.x + by, y: g.y };
  if (g.y === f.y0) return { x: g.x, y: g.y - by };
  return { x: g.x, y: g.y + by };
}

/** Put the player on the road outside a settlement, at the gate of the road toward `toward` (a settlement id) if there is one. */
export function startRoad(realm: Realm, player: PlayerState, site: string, toward?: string): RoadState | null {
  const land = landOf(realm);
  const f = land.footprints.get(site);
  if (!f) return null;
  const gates = Object.entries(f.gates).filter(([id]) => !id.startsWith("spur:")).sort(([a], [b]) => a.localeCompare(b));
  const pick = (toward && gates.find(([id]) => id.split("~").includes(toward))) || gates[0] || Object.entries(f.gates)[0];
  if (!pick) return null;
  const at = outside(f, pick[1]);
  const state: RoadState = { x: at.x, y: at.y, steps: 0, from: site, ...(toward ? { dest: toward } : {}), paid: player.road?.paid ?? {}, met: player.road?.met ?? {}, seen: player.road?.seen ?? {} };
  player.road = state;
  return state;
}

/** Take one step on the road. `today`: the game day, for tolls. */
export function stepOnRoad(realm: Realm, player: PlayerState, dx: number, dy: number, today: number, speed = 1): RoadStep {
  const road = player.road;
  if (!road) return { ok: false, reason: "You're not on the road.", minute: false, lines: [] };
  if (Math.abs(dx) + Math.abs(dy) !== 1) return { ok: false, reason: "One step at a time.", minute: false, lines: [] };
  const land = landOf(realm);
  const nx = road.x + dx;
  const ny = road.y + dy;
  if (!walkableAt(land, nx, ny)) return { ok: false, minute: false, lines: [] };
  const lines: string[] = [];
  // A toll asked on stepping into a gate's reach (once a day).
  for (const p of placesNear(land, { x: nx, y: ny }, TOLL_REACH)) {
    if (!p.toll || road.paid[p.id] === today) continue;
    if (Math.hypot(p.on.x - road.x, p.on.y - road.y) <= TOLL_REACH) continue; // already inside its reach
    if (player.money < p.toll) return { ok: false, reason: `${cap(p.name)} wants ${formatMoney(p.toll)} to pass, and you can't pay it.`, minute: false, lines };
    player.money -= p.toll;
    road.paid[p.id] = today;
    lines.push(`You pay ${formatMoney(p.toll)} at ${p.name}.`);
  }
  road.x = nx;
  road.y = ny;
  const gate = gateAt(land, nx, ny);
  if (gate) {
    commitTrack(realm, player);
    return { ok: true, minute: false, entered: gate, lines: [...lines] };
  }
  road.steps += speed;
  let minute = false;
  if (road.steps >= STEPS_PER_GAME_MINUTE) {
    road.steps -= STEPS_PER_GAME_MINUTE;
    minute = true;
  }
  track(realm, player);
  return { ok: true, minute, lines };
}

const cap = (t: string) => t.replace(/^./, (c) => c.toUpperCase());

// ---- Walked stretches (for fast travel) ----

/** The waypoints of a road, as distances along it: both ends, waystations and crossings. Segments run between them. */
export function waypointsOf(data: RoadData, road: RoadPath): number[] {
  const ts = [0, road.length];
  for (const p of data.places) if (p.road === road.id && p.kind === "waystation") ts.push(p.t);
  for (const c of data.crossings) if (c.road === road.id) ts.push(c.t);
  ts.sort((a, b) => a - b);
  return ts.filter((t, i) => i === 0 || t - ts[i - 1]! >= 30);
}

/** Segment ids of a road: `road#0`, `road#1`... one for each stretch between waypoints. */
export const segmentId = (road: string, i: number) => `${road}#${i}`;

/** Follow the player along the road they are on, noting how much of it they have walked without a break. */
function track(realm: Realm, player: PlayerState): void {
  const road = player.road!;
  const near = nearestRoad(landOf(realm), road, ON_ROAD);
  if (!near || near.road.id.startsWith("spur:")) {
    if (road.track) commitTrack(realm, player);
    return;
  }
  if (!road.track || road.track.road !== near.road.id) {
    commitTrack(realm, player);
    road.track = { road: near.road.id, lo: near.t, hi: near.t };
    return;
  }
  // A jump of more than a few tiles along the road (a coach, a fall) is not walked.
  if (near.t < road.track.lo - 12 || near.t > road.track.hi + 12) {
    commitTrack(realm, player);
    road.track = { road: near.road.id, lo: near.t, hi: near.t };
    return;
  }
  road.track.lo = Math.min(road.track.lo, near.t);
  road.track.hi = Math.max(road.track.hi, near.t);
}

/** Write down the stretches the player has walked end to end since they last left the road. */
export function commitTrack(realm: Realm, player: PlayerState): void {
  const road = player.road;
  const tr = road?.track;
  if (!road || !tr) return;
  delete road.track;
  const land = landOf(realm);
  const r = land.byRoad.get(tr.road);
  if (!r) return;
  const wp = waypointsOf(land.data, r);
  const walked = (player.walked ??= []);
  for (let i = 0; i + 1 < wp.length; i++) {
    if (tr.lo <= wp[i]! + SLACK && tr.hi >= wp[i + 1]! - SLACK) {
      const id = segmentId(r.id, i);
      if (!walked.includes(id)) walked.push(id);
    }
  }
}

export { groundAt };
