import { WALK_PACE, buildTimeline, cumulative, describeWalk, journeyLine, pointAt, shortestWay, type JourneyLine, type JourneyRoad, type RoadData, type RoadPath, type RoadPoint } from "@millbrook/shared";
import { formatMoney } from "../money.js";
import type { Town } from "../town.js";
import { weatherOn } from "../weather.js";
import { landOf, nearestRoad, placesNear } from "./ground.js";
import { describeJourney, journeysNear } from "./journeys.js";
import { tickMount } from "./mounts.js";
import { LOW, needsOf, tickNeeds } from "./needs.js";
import { rollSegment } from "./situations.js";
import { threatsOf } from "./threats.js";
import { waypointsOf, segmentId } from "./walk.js";
import { streamFor } from "../dice.js";

/**
 * Fast travel only as a choice (N26 D3): along roads already walked, and it still stops for anything worth stopping
 * for. The player's destination is walked for them by the clock: it runs the world forward over the stretch (nights at
 * inns, days of walking), and stops where something is: a party on the road, a situation rolled for that stretch that
 * day, a threat's ground, nightfall in the open, an empty belly, a toll they cannot pay, or the end of what they have
 * walked. Where it stops, the player is on the road, and walks on from there.
 */

interface Seg {
  id: string;
  d0: number;
  d1: number;
  road: RoadPath;
  /** Index among the road's segments, and the road's own distances at both ends. */
  index: number;
  t0: number;
  t1: number;
}

interface Route {
  line: JourneyLine;
  segs: Seg[];
  path: string[];
  roads: JourneyRoad[];
  dest: string;
}

const SAMPLE = 250;

/** The way from where the player stands to their destination, as one line with its walkable stretches. */
export function routeFromHere(town: Town): Route | null {
  const realm = town.world.realm;
  const p = town.world.player;
  const state = p.road;
  if (!realm || !state?.dest) return null;
  const land = landOf(realm);
  const data = land.data;
  const near = nearestRoad(land, state, 30);
  if (!near || near.road.id.startsWith("spur:")) return null;
  const r = near.road;
  // Whichever end is on the shortest way.
  let best: { rev: boolean; toward: string; way: ReturnType<typeof shortestWay>; cost: number } | null = null;
  for (const [end, rev, along] of [[r.b, false, r.length - near.t], [r.a, true, near.t]] as const) {
    const way = end === state.dest ? { path: [end], roads: [], tiles: 0 } : shortestWay(data, end, state.dest, (id) => id === (rev ? r.b : r.a));
    if (way && (!best || along + way.tiles < best.cost)) best = { rev, toward: end, way, cost: along + way.tiles };
  }
  if (!best || !best.way) return null;
  const first: JourneyRoad = { id: r.id, rev: best.rev };
  const roads: JourneyRoad[] = [first, ...best.way.roads];
  const path = [best.rev ? r.b : r.a, best.toward, ...best.way.path.slice(1)];
  // The line: the rest of the first road from the player, then each road whole.
  const pts: RoadPoint[] = [];
  const fullPts = best.rev ? [...r.pts].reverse() : r.pts;
  const fullCum = cumulative(fullPts);
  const startD = best.rev ? r.length - near.t : near.t;
  pts.push({ x: state.x, y: state.y });
  for (let i = 0; i < fullPts.length; i++) if (fullCum[i]! > startD + 1) pts.push(fullPts[i]!);
  const offsets: number[] = [-startD];
  let acc = r.length - startD;
  const segs: Seg[] = [];
  const addSegs = (road: RoadPath, rev: boolean, base: number) => {
    const wp = waypointsOf(data, road);
    const n = wp.length - 1;
    for (let k = 0; k < n; k++) {
      const i = rev ? n - 1 - k : k;
      const a = rev ? road.length - wp[i + 1]! : wp[i]!;
      const b = rev ? road.length - wp[i]! : wp[i + 1]!;
      const d0 = base + a;
      const d1 = base + b;
      if (d1 <= 1) continue;
      segs.push({ id: segmentId(road.id, i), d0: Math.max(0, d0), d1, road, index: i, t0: wp[i]!, t1: wp[i + 1]! });
    }
  };
  addSegs(r, best.rev, -startD);
  for (const jr of best.way.roads) {
    const road = data.roads.find((x) => x.id === jr.id)!;
    const rp = jr.rev ? [...road.pts].reverse() : road.pts;
    for (let i = 1; i < rp.length; i++) pts.push(rp[i]!);
    offsets.push(acc);
    addSegs(road, jr.rev, acc);
    acc += road.length;
  }
  void offsets;
  const cum = cumulative(pts);
  // Places to sleep: the inns beside the roads along the way, and the settlements on it.
  const full = journeyLine(data, roads, path);
  const nodes = full.nodes.map((n) => ({ ...n, d: n.d - startD })).filter((n) => n.d > 1 && n.d < (cum.at(-1) ?? 0) - 1);
  return { line: { pts, cum, nodes, length: cum.at(-1) ?? 0 }, segs, path, roads, dest: state.dest };
}

/** Can the player fast travel from here (the first stretch ahead has been walked)? */
export function canFast(town: Town): boolean {
  const r = routeFromHere(town);
  const walked = town.world.player.walked ?? [];
  return !!r && !!r.segs[0] && walked.includes(r.segs[0].id);
}

/** The minute the timeline has the party at distance d. */
function etaAt(timeline: ReturnType<typeof buildTimeline>["timeline"], d: number): number {
  for (const leg of timeline) if (leg.d1 > leg.d0 && d >= leg.d0 && d <= leg.d1) return leg.t0 + ((d - leg.d0) / (leg.d1 - leg.d0)) * (leg.t1 - leg.t0);
  for (const leg of timeline) if (d <= leg.d1) return leg.t0;
  return timeline.at(-1)?.t1 ?? 0;
}

export interface FastResult {
  ok: boolean;
  lines: string[];
}

/** Run the clock along the walked stretch toward the destination; stop at the first thing worth stopping for. */
export function fastTravel(town: Town, minute: number): FastResult {
  const world = town.world;
  const realm = world.realm;
  const p = world.player;
  const state = p.road;
  if (!realm || !state) return { ok: false, lines: ["You're not on the road."] };
  if (!state.dest) return { ok: false, lines: ["Fast travel needs a destination: choose where you're going first."] };
  if (state.pending) return { ok: false, lines: ["Deal with what's in front of you first."] };
  const route = routeFromHere(town);
  if (!route) return { ok: false, lines: ["You can't see the way from here. Get back to the road."] };
  const walked = new Set(p.walked ?? []);
  const data: RoadData = landOf(realm).data;
  // How far the walked stretch runs from here.
  let limit = 0;
  let unknown: Seg | undefined;
  for (const s of route.segs) {
    if (!walked.has(s.id)) {
      unknown = s;
      break;
    }
    limit = s.d1;
  }
  if (limit <= 1) return { ok: false, lines: ["You haven't walked this stretch of road before: fast travel only goes where you have already been. Walk it first."] };
  const total = Math.min(limit, route.line.length);
  const pace = p.mount && !p.mount.lame ? WALK_PACE / (p.mount.kind === "horse" ? 0.5 : 0.77) : WALK_PACE;
  const sub = { nodes: route.line.nodes.filter((n) => n.d < total - 1), length: total };
  const { timeline, arrive } = buildTimeline(minute, sub, pace, { stay: 0 });
  const day = (m: number) => Math.floor(m / 1440) + 1;
  // Look along the way for what is worth stopping for, nearest first.
  interface Stop {
    d: number;
    why: string;
  }
  let stop: Stop | null = null;
  const consider = (s: Stop) => {
    if (!stop || s.d < stop.d) stop = s;
  };
  const noted = new Set<string>();
  const tolls: Array<{ d: number; toll: number; id: string; name: string }> = [];
  // Sleeping in the open.
  for (const leg of timeline) {
    if (leg.d0 === leg.d1 && !leg.at && leg.t1 - leg.t0 > 300 && leg.d0 > 1 && leg.d0 < total - 1) consider({ d: leg.d0, why: "Night falls, with no roof within reach. You stop where you are." });
  }
  const threats = threatsOf(realm, data);
  for (let d = SAMPLE; d < total; d += SAMPLE) {
    const eta = etaAt(timeline, d);
    const at = pointAt(route.line.pts, route.line.cum, d);
    for (const { journey } of journeysNear(realm, data, at, 45, eta)) {
      const key = `ft:${journey.id}`;
      if (state.seen[key] === world.day) continue;
      noted.add(key);
      consider({ d, why: `You slow: ${describeJourney(journey, (id) => realm.settlements[id]?.name ?? id)} is on the road ahead.` });
    }
    for (const t of threats) {
      if (Math.hypot(t.at.x - at.x, t.at.y - at.y) <= t.range + 40 && state.met[t.id] !== day(eta)) consider({ d: Math.max(1, d - 60), why: `You stop: the road ahead runs near ${t.kind === "pack" ? "where beasts hunt" : "a place outlaws are known to lie in wait"}.` });
    }
    for (const pl of placesNear(landOf(realm), at, SAMPLE)) if (pl.toll && Math.hypot(pl.on.x - at.x, pl.on.y - at.y) < SAMPLE / 2 && !tolls.some((x) => x.id === pl.id)) tolls.push({ d, toll: pl.toll, id: pl.id, name: pl.name });
  }
  // A situation rolled for a stretch on the day they would pass it.
  for (const s of route.segs) {
    if (s.d0 >= total) break;
    const eta = etaAt(timeline, Math.min(total, (s.d0 + s.d1) / 2));
    const rolled = rollSegment(realm, data, s.road, s.index, day(eta), town.store?.people);
    if (!rolled) continue;
    const t = s.d0 + (rolled.t - s.t0);
    if (t > 1 && t < total && state.seen[rolled.key] !== day(eta)) consider({ d: Math.max(1, t - 25), why: `You stop: there's something on the road ahead (${rolled.def.title.toLowerCase()}).` });
  }
  // Tolls: paid on the way if they can; a toll they can't pay is a stop before it.
  let money = p.money;
  for (const t of tolls.sort((a, b) => a.d - b.d)) {
    if (money < t.toll) consider({ d: Math.max(1, t.d - 20), why: `You stop: ${t.name} wants ${formatMoney(t.toll)} and you can't pay it.` });
    else money -= t.toll;
  }
  // Supplies: they go down as the time passes; running low is a stop.
  const needs = structuredClone(needsOf(p, minute));
  let lastEta = minute;
  for (let d = SAMPLE; d <= total; d += SAMPLE) {
    const eta = etaAt(timeline, d);
    const mins = eta - lastEta;
    lastEta = eta;
    needs.food -= (3.2 * mins) / 60;
    needs.water -= (4.6 * mins) / 60;
    if (needs.food < LOW || needs.water < LOW) {
      consider({ d, why: `You stop: you are ${needs.water < LOW ? "thirsty" : "hungry"}, and have not eaten or drunk in a long while.` });
      break;
    }
  }
  const stopped = stop as Stop | null;
  const endD = stopped ? stopped.d : total;
  const endMinute = stopped ? etaAt(timeline, endD) : arrive;
  // Live the time: nights asleep, days walking.
  const lines: string[] = [];
  let walkingMin = 0;
  let restingMin = 0;
  for (const leg of timeline) {
    const a = Math.max(leg.t0, minute);
    const b = Math.min(leg.t1, endMinute);
    if (b <= a) continue;
    if (leg.d1 > leg.d0) walkingMin += b - a;
    else restingMin += b - a;
  }
  const weather = weatherOn(world.day);
  lines.push(...tickNeeds(p, Math.round(walkingMin), minute, { weather }));
  lines.push(...tickNeeds(p, Math.round(restingMin), minute, { resting: true, weather }));
  lines.push(...tickMount(p, walkingMin / 60, { riding: true, rng: streamFor(world.seed, "mount", world.day, "fast") }));
  const paid = tolls.filter((t) => t.d <= endD);
  for (const t of paid) {
    p.money -= t.toll;
    state.paid[t.id] = day(endMinute);
    lines.push(`You pay ${formatMoney(t.toll)} at ${t.name}.`);
  }
  for (const k of noted) state.seen[k] = day(endMinute);
  town.walkMinutes(Math.max(1, Math.round(endMinute - minute)));
  const arrived = !stopped && limit >= route.line.length - 1;
  if (arrived) {
    lines.push(`You are there. ${describeWalk(total)} of road behind you.`);
    lines.push(...town.arriveAt(route.dest));
    return { ok: true, lines: ["You take the road you know, and let the miles go by.", ...lines] };
  }
  const at = pointAt(route.line.pts, route.line.cum, endD);
  state.x = Math.round(at.x);
  state.y = Math.round(at.y);
  state.steps = 0;
  delete state.track;
  if (stopped) lines.push(stopped.why);
  else if (unknown) lines.push("You stop where the road you know ends: the stretch ahead you have not walked.");
  return { ok: true, lines: ["You take the road you know, and let the miles go by.", ...lines] };
}
