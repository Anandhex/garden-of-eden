import { WALK_PACE, buildTimeline, graphOf, type JourneyLine, type RoadData } from "@millbrook/shared";
import type { Realm, RealmNews } from "../realm/types.js";
import { roadDataOf } from "./generateRoads.js";

/**
 * How news travels (N26 B2). A piece of news is carried place to place by messengers along the roads: each hop is a
 * fresh messenger who sets out after a handover, walks the day's hours and sleeps where they must (the timeline of
 * shared/road/journey.ts). So where a messenger is on the road and the day a place hears the news are the same
 * thing: `reachesAt` (game/realm/log.ts) reads these arrivals, and the carriers on the road (sources.ts) are made
 * from the same search. A pure function of the realm's roads and the news.
 */

/** Minutes a messenger takes to hand the news on and set out again. */
export const HANDOVER = 45;
/** What hour of its day a piece of news is taken to begin. */
const NEWS_HOUR = 12;

export interface Hop {
  from: string;
  to: string;
  depart: number;
  arrive: number;
}

export interface Relay {
  /** The minute the news reaches each place (absolute game minute), the place it began included. */
  at: Map<string, number>;
  /** The hops, in order of arrival: who carried it where. */
  hops: Hop[];
}

const cache = new WeakMap<Realm, Map<string, Relay>>();

/** A messenger's walk along one road from a minute: the minute they arrive. */
function hopMinutes(data: RoadData, from: string, to: string, depart: number, edge: { road: string; rev: boolean; len: number }): { depart: number; arrive: number } {
  void from;
  void to;
  const road = data.roads.find((r) => r.id === edge.road)!;
  // Only the inns beside this road matter to when they sleep; build the line the way a journey would.
  const nodes = data.places.filter((p) => p.kind === "waystation" && p.road === road.id).map((p) => ({ d: edge.rev ? road.length - p.t : p.t, id: p.site ?? p.id, kind: "waystation" as const, at: p.at }));
  nodes.sort((a, b) => a.d - b.d);
  const line: Pick<JourneyLine, "nodes" | "length"> = { nodes, length: road.length };
  const { timeline, arrive } = buildTimeline(depart, line, WALK_PACE, { stay: 0 });
  return { depart: timeline[0]?.t0 ?? depart, arrive };
}

/** The relay of a piece of news: the earliest each place can hear it by messenger. */
export function relayOf(realm: Realm, n: Pick<RealmNews, "id" | "day" | "at">): Relay {
  let byNews = cache.get(realm);
  if (!byNews) cache.set(realm, (byNews = new Map()));
  const key = `${n.id}:${n.day}:${n.at}`;
  const hit = byNews.get(key);
  if (hit) return hit;
  const data = roadDataOf(realm);
  const g = graphOf(data);
  // News from an inn beside the road starts from the place it is nearest.
  const origin = n.at ? (realm.settlements[n.at]?.way ? (realm.settlements[n.at]!.liege ?? n.at) : n.at) : null;
  const start = origin && g.has(origin) ? origin : null;
  const at = new Map<string, number>();
  const hops: Hop[] = [];
  if (start) {
    const t0 = (n.day - 1) * 1440 + NEWS_HOUR * 60;
    at.set(start, t0);
    const done = new Set<string>();
    for (;;) {
      let cur: string | null = null;
      for (const [id, t] of at) if (!done.has(id) && (cur === null || t < at.get(cur)! || (t === at.get(cur)! && id < cur))) cur = id;
      if (cur === null) break;
      done.add(cur);
      for (const e of g.get(cur) ?? []) {
        const h = hopMinutes(data, cur, e.to, at.get(cur)! + HANDOVER, e);
        if (!at.has(e.to) || h.arrive < at.get(e.to)!) {
          at.set(e.to, h.arrive);
          // The hop that got it there first replaces any earlier slower one.
          const i = hops.findIndex((x) => x.to === e.to);
          const hop = { from: cur, to: e.to, depart: h.depart, arrive: h.arrive };
          if (i >= 0) hops[i] = hop;
          else hops.push(hop);
        }
      }
    }
    hops.sort((a, b) => a.arrive - b.arrive);
  }
  const relay = { at, hops };
  byNews.set(key, relay);
  return relay;
}

/** The game day a place hears a piece of news by the relay, or null if no road leads there from where it happened. */
export function relayDay(realm: Realm, n: Pick<RealmNews, "id" | "day" | "at">, site: string): number | null {
  const s = realm.settlements[site];
  // An inn beside the road hears what its nearer end hears.
  const place = s?.way ? (s.liege ?? site) : site;
  const t = relayOf(realm, n).at.get(place);
  return t === undefined ? null : Math.floor(t / 1440) + 1;
}
