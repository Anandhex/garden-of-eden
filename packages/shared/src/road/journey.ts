import { cumulative, pointAt } from "./geometry.js";
import { DAY_ENDS, DAY_STARTS } from "./scale.js";
import type { RoadData, RoadPoint } from "./types.js";

/**
 * Journeys (N26 decision 6, reworked by Part E). Everyone met on the road is a real person (a row of the `people`
 * table) on a journey the realm made: a market trip, a caravan, a courier, a patrol, pilgrims, a party bound for a
 * dungeon, a household on the move. A journey is data, and where it is at
 * a minute is a pure function of that data (`positionAt`), exactly as the crowd's positions are of the clock
 * (crowd.ts): nothing is simulated step by step, the server and the browser agree, and nothing per step goes
 * over the wire. The timeline records the days the party walks (`DAY_STARTS`..`DAY_ENDS`), where they sleep
 * and the stops they make.
 */

export const JOURNEY_KINDS = ["market", "caravan", "kin", "work", "pilgrims", "patrol", "officials", "courier", "adventurers", "migrants", "refugees", "coach"] as const;
export type JourneyKind = (typeof JOURNEY_KINDS)[number];

/**
 * One person on a journey: the `people` row they are. Nobody is made up for a journey (Part E decision 1); `name`,
 * `role` and `gender` are a cache so that the road can be drawn without the table.
 */
export interface Traveller {
  /** The `people` row (`t_<place>_<n>`). */
  person: string;
  name: string;
  role: string;
  gender: "female" | "male";
}

/** A piece of news a traveller carries, and the place they learned it at. */
export interface Carry {
  id: string;
  from: string;
}

/** What `people.away` says of someone on a journey. */
export interface Away {
  journey: string;
  /** The absolute game minute they set out. */
  since: number;
  /** In words: "going to market in Ashby". */
  purpose: string;
  /** They come home (a round trip) or settle where they are going (a migration). */
  returns: boolean;
}

/** A stretch of the timeline: from minute `t0` to `t1` the party goes from distance `d0` to `d1` along its line (standing still when equal). `at` fixes where they stand while resting (an inn's gate). */
export interface Leg {
  t0: number;
  t1: number;
  d0: number;
  d1: number;
  at?: RoadPoint;
  /** The place (a settlement id: a town or an inn's hamlet) where they rest during this leg. */
  site?: string;
}

/** A realm road walked in one direction (`rev`: from b to a). */
export interface JourneyRoad {
  id: string;
  rev: boolean;
}

export interface Journey {
  id: string;
  kind: JourneyKind;
  party: Traveller[];
  /** Settlement ids from where they set out to where they are going, and the roads between. */
  path: string[];
  roads: JourneyRoad[];
  /** Absolute game minute they set out and arrive. */
  depart: number;
  arrive: number;
  timeline: Leg[];
  /** Tiles per game minute while walking. */
  pace: number;
  /** What for, in words: "carrying iron to Ashby". */
  purpose: string;
  /** Goods carried (item → qty), for a caravan. */
  cargo?: Record<string, number>;
  /** Realm news the party carries (filled when they set out, and at every stop: game/road/exchange.ts). */
  carries?: Carry[];
  /** A round trip comes back where it started; a one-way journey ends in a move (migrants) or a stay. */
  returns: boolean;
  /** For a round trip: how far along the line the turn is, the place, and when they get there and leave. */
  turn?: { d: number; site: string; arrive: number; leave: number };
  /** Whom they go to see (a person id), for a visit. */
  visit?: string;
  /** For migrants and refugees: the move applied when they arrive. */
  move?: { from: string; to: string; everyone: boolean };
  /** For adventurers: the dungeon they are bound for. The delve is resolved when they arrive. */
  dungeon?: string;
  /** Arrival has been dealt with (the move applied, the people home). */
  closed?: boolean;
  /** A caravan that was robbed or a party that was stopped never arrives. */
  ended?: { minute: number; why: string };
  /** The people are guards, or armed (a patrol, adventurers): bandits weigh them. */
  guards?: number;
}

/** The line a journey walks: its roads joined, with the distance of each place on it. */
export interface JourneyLine {
  pts: RoadPoint[];
  cum: number[];
  /** Places the party can stop at, in order of distance: settlements and waystations. */
  nodes: Array<{ d: number; id: string; kind: "settlement" | "waystation"; at: RoadPoint }>;
  length: number;
}

const lines = new WeakMap<RoadData, Map<string, JourneyLine>>();

/** Join the roads of a journey into one line, with the stopping places along it. */
export function journeyLine(data: RoadData, roads: JourneyRoad[], path: string[]): JourneyLine {
  let byKey = lines.get(data);
  if (!byKey) lines.set(data, (byKey = new Map()));
  const key = roads.map((r) => `${r.id}${r.rev ? "!" : ""}`).join("|") + `#${path.join(",")}`;
  const hit = byKey.get(key);
  if (hit) return hit;
  const pts: RoadPoint[] = [];
  const nodes: JourneyLine["nodes"] = [];
  let offset = 0;
  roads.forEach((jr, i) => {
    const road = data.roads.find((r) => r.id === jr.id);
    if (!road) return;
    const rp = jr.rev ? [...road.pts].reverse() : road.pts;
    const first = pts.length === 0 ? 0 : 1;
    for (let k = first; k < rp.length; k++) pts.push(rp[k]!);
    const startId = path[i];
    if (startId && (i === 0 || nodes.at(-1)?.id !== startId)) nodes.push({ d: offset, id: startId, kind: "settlement", at: rp[0]! });
    for (const p of data.places) {
      if (p.kind !== "waystation" || p.road !== road.id) continue;
      nodes.push({ d: offset + (jr.rev ? road.length - p.t : p.t), id: p.site ?? p.id, kind: "waystation", at: gateOfSite(data, p) });
    }
    offset += road.length;
    const endId = path[i + 1];
    if (endId) nodes.push({ d: offset, id: endId, kind: "settlement", at: rp[rp.length - 1]! });
  });
  // Waystations were added as their road came up, so the order along a reversed road needs sorting.
  nodes.sort((a, b) => a.d - b.d);
  const cum = cumulative(pts);
  const line = { pts, cum, nodes, length: cum.at(-1) ?? 0 };
  byKey.set(key, line);
  return line;
}

/** Where a waystation's door is: its settlement's gate on the spur, or the place's own tile. */
function gateOfSite(data: RoadData, p: { site?: string; at: RoadPoint }): RoadPoint {
  const fp = p.site ? data.footprints.find((f) => f.id === p.site) : undefined;
  const gate = fp ? Object.values(fp.gates)[0] : undefined;
  return gate ?? p.at;
}

const DAY = 1440;
const dayStart = (t: number) => Math.floor(t / DAY) * DAY;
const open = (t: number) => dayStart(t) + DAY_STARTS * 60;
const close = (t: number) => dayStart(t) + DAY_ENDS * 60;

/**
 * Work out when a party walks and sleeps: from `start` along a line of `length` tiles at `pace`, walking only in the
 * day's hours. When the day's walking ends the party sleeps at the farthest stopping place they can reach that
 * day (an inn or a town) if one is within reach and not too near, else in the open. They pause `stay` minutes at the
 * places they pass. Returns the legs and the minute they arrive.
 */
export function buildTimeline(start: number, line: Pick<JourneyLine, "nodes" | "length">, pace: number, opts: { stay?: number; sleepAt?: boolean } = {}): { timeline: Leg[]; arrive: number } {
  const stay = opts.stay ?? 20;
  const sleepAt = opts.sleepAt ?? true;
  const legs: Leg[] = [];
  let t = start;
  let d = 0;
  // Not before morning, not after the day's end.
  if (t < open(t)) t = open(t);
  else if (t >= close(t)) t = open(t + DAY);
  const total = line.length;
  const nodes = line.nodes.filter((n) => n.d > 1 && n.d < total - 1);
  let guard = 0;
  while (d < total - 1e-9 && guard++ < 400) {
    const canWalk = (close(t) - t) * pace;
    const next = nodes.find((n) => n.d > d + 1e-9);
    const target = Math.min(total, next ? next.d : total);
    const need = target - d;
    if (need <= canWalk + 1e-9) {
      legs.push({ t0: t, t1: t + need / pace, d0: d, d1: target });
      t += need / pace;
      d = target;
      if (next && target < total) {
        // Pass through a place: a short pause. At a waystation near the end of the day, stop there for the night.
        const left = (close(t) - t) * pace;
        const furtherToo = nodes.find((n) => n.d > d + 1e-9);
        const sleepHere = sleepAt && (!furtherToo || furtherToo.d - d > left) && left < (DAY_ENDS - DAY_STARTS) * 60 * pace * 0.55;
        if (sleepHere) {
          const wake = open(t + DAY);
          legs.push({ t0: t, t1: wake, d0: d, d1: d, at: next.at, site: next.id });
          t = wake;
        } else if (stay > 0) {
          legs.push({ t0: t, t1: t + stay, d0: d, d1: d, at: next.at, site: next.id });
          t += stay;
          if (t >= close(t)) t = open(t + DAY);
        }
      }
    } else {
      // The day runs out: walk as far as the light allows, then sleep where they are.
      if (canWalk > 0) {
        legs.push({ t0: t, t1: close(t), d0: d, d1: d + canWalk });
        d += canWalk;
      }
      const wake = open(t + DAY);
      legs.push({ t0: close(t), t1: wake, d0: d, d1: d });
      t = wake;
    }
  }
  return { timeline: legs, arrive: legs.at(-1)?.t1 ?? start };
}

/**
 * A round trip: out along the first `turnD` tiles of the line, `stay` minutes (at least) at the turning place, then back.
 * Returns the legs, when they get there and when they set out for home, and when they are home again.
 */
export function buildRoundTimeline(start: number, line: Pick<JourneyLine, "nodes" | "length">, pace: number, turnD: number, stay: number, opts: { stay?: number; sleepAt?: boolean } = {}): { timeline: Leg[]; arrive: number; turn: { arrive: number; leave: number } } {
  const turnNode = line.nodes.find((n) => Math.abs(n.d - turnD) < 1.5);
  const out = buildTimeline(start, { nodes: line.nodes.filter((n) => n.d < turnD - 1.5), length: turnD }, pace, opts);
  const back = buildTimeline(out.arrive + stay, { nodes: line.nodes.filter((n) => n.d > turnD + 1.5).map((n) => ({ ...n, d: n.d - turnD })), length: line.length - turnD }, pace, opts);
  const leave = back.timeline[0]?.t0 ?? out.arrive + stay;
  const timeline: Leg[] = [...out.timeline];
  timeline.push({ t0: out.arrive, t1: leave, d0: turnD, d1: turnD, ...(turnNode ? { at: turnNode.at, site: turnNode.id } : {}) });
  for (const l of back.timeline) timeline.push({ ...l, d0: l.d0 + turnD, d1: l.d1 + turnD });
  return { timeline, arrive: back.arrive, turn: { arrive: out.arrive, leave } };
}

export type JourneyState = "waiting" | "walking" | "resting" | "arrived" | "ended";

export interface JourneyPosition extends RoadPoint {
  state: JourneyState;
  /** Distance along the line. */
  d: number;
}

/** Where a journey is at an absolute game minute: a pure function of the journey, its line and the minute. */
export function positionAt(j: Journey, line: JourneyLine, minute: number): JourneyPosition {
  const stopped = j.ended && minute >= j.ended.minute ? j.ended.minute : null;
  const t = stopped ?? minute;
  const first = j.timeline[0];
  if (!first || t < j.depart) return { ...pointAt(line.pts, line.cum, 0), state: "waiting", d: 0 };
  let leg = j.timeline[j.timeline.length - 1]!;
  if (t < leg.t1) {
    let lo = 0;
    let hi = j.timeline.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (j.timeline[mid]!.t1 <= t) lo = mid + 1;
      else hi = mid;
    }
    leg = j.timeline[lo]!;
  } else if (!stopped) return { ...pointAt(line.pts, line.cum, leg.d1), state: "arrived", d: leg.d1 };
  const f = leg.t1 === leg.t0 ? 1 : Math.min(1, Math.max(0, (t - leg.t0) / (leg.t1 - leg.t0)));
  const d = leg.d0 + (leg.d1 - leg.d0) * f;
  const moving = leg.d1 > leg.d0;
  const p = !moving && leg.at ? { x: leg.at.x, y: leg.at.y } : pointAt(line.pts, line.cum, d);
  return { x: p.x, y: p.y, state: stopped ? "ended" : moving ? "walking" : "resting", d };
}

/** Is the journey still going at a minute (set out, not arrived, not stopped)? */
export const isOnTheRoad = (j: Journey, minute: number): boolean => minute >= j.depart && minute < (j.ended ? Math.min(j.ended.minute, j.arrive) : j.arrive);

/** Where each of the party is: the leader at the journey's position, the rest a step or two behind on the road (or standing about where they rest). Whole tiles. */
export function partyAt(j: Journey, line: JourneyLine, minute: number): JourneyPosition[] {
  const lead = positionAt(j, line, minute);
  return j.party.map((_, i) => {
    if (i === 0) return { ...lead, x: Math.round(lead.x), y: Math.round(lead.y) };
    if (lead.state === "walking") {
      const p = pointAt(line.pts, line.cum, Math.max(0, lead.d - i * 2));
      return { ...lead, x: Math.round(p.x), y: Math.round(p.y), d: Math.max(0, lead.d - i * 2) };
    }
    return { ...lead, x: Math.round(lead.x) + ((i % 3) - 1) * 2, y: Math.round(lead.y) + Math.floor(i / 3) * 2 + 1 };
  });
}


/** The leg a journey is in at a minute, or null before it sets out or after it ends. */
function legAt(j: Journey, minute: number): Leg | null {
  const last = j.timeline.at(-1);
  if (!last || minute < j.depart || minute >= last.t1) return null;
  let lo = 0;
  let hi = j.timeline.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (j.timeline[mid]!.t1 <= minute) lo = mid + 1;
    else hi = mid;
  }
  return j.timeline[lo]!;
}

/**
 * Where the party is, as a place: at a settlement or an inn (`site`) while they rest there, at home or at the end of the
 * line when it is over, or out on the road (`site` null). A pure function of the journey and the minute.
 */
export function placeAt(j: Journey, minute: number): { site: string | null; state: "waiting" | "walking" | "resting" | "arrived" | "ended" } {
  const stopped = j.ended && minute >= j.ended.minute ? j.ended.minute : null;
  const t = stopped ?? minute;
  if (t < j.depart) return { site: j.path[0] ?? null, state: "waiting" };
  const leg = legAt(j, t);
  if (!leg) return { site: stopped !== null ? null : (j.path.at(-1) ?? null), state: stopped !== null ? "ended" : "arrived" };
  if (leg.d1 > leg.d0) return { site: null, state: stopped !== null ? "ended" : "walking" };
  return { site: leg.site ?? null, state: stopped !== null ? "ended" : "resting" };
}

/** Every stop a journey makes: setting out, each rest at a town or an inn, and the end. News is swapped at these. In order. */
export function stopsOf(j: Journey): Array<{ minute: number; site: string }> {
  const out: Array<{ minute: number; site: string }> = [];
  const end = j.ended ? Math.min(j.ended.minute, j.arrive) : j.arrive;
  if (j.path[0]) out.push({ minute: j.depart, site: j.path[0] });
  for (const l of j.timeline) if (l.d0 === l.d1 && l.site && l.t0 < end) out.push({ minute: l.t0, site: l.site });
  if (!j.ended && j.path.at(-1)) out.push({ minute: j.arrive, site: j.returns ? j.path[0]! : j.path.at(-1)! });
  return out;
}
