import { DAY_ENDS, DAY_STARTS, WALK_PACE, buildTimeline, graphOf, isOnTheRoad, journeyLine, positionAt, type Journey, type JourneyKind, type JourneyPosition, type JourneyRoad, type RoadData, type Traveller } from "@millbrook/shared";
import type { SavedWorld } from "../save.js";

/**
 * The journeys (N26 decision 6). They are kept in the save (`world.journeys`): a few hundred at most, each a small
 * record whose position at any minute is a formula (shared/road/journey.ts). Made by the realm's day from what the
 * realm is doing (sources.ts), pruned a day after they finish.
 */

/** Most journeys on the road at once. */
export const MAX_JOURNEYS = 320;
/** A finished journey is kept this many minutes (so a place's news can still point at it), then dropped. */
const KEEP_AFTER = 1440;

export const journeysOf = (world: Pick<SavedWorld, "journeys">): Journey[] => (world.journeys ??= []);

/** The minute a day starts. */
export const dayStartMinute = (day: number): number => (day - 1) * 1440;
/** A departure minute in the first hours of a day's walking. */
export const departureOn = (day: number, r: number): number => dayStartMinute(day) + DAY_STARTS * 60 + Math.floor(r * 4 * 60);

/** The roads that join a path of settlements, or null if any two are not joined. */
export function roadsAlong(data: RoadData, path: string[]): JourneyRoad[] | null {
  const g = graphOf(data);
  const out: JourneyRoad[] = [];
  for (let i = 1; i < path.length; i++) {
    const e = (g.get(path[i - 1]!) ?? []).find((x) => x.to === path[i]);
    if (!e) return null;
    out.push({ id: e.road, rev: e.rev });
  }
  return out;
}

export interface Launch {
  kind: JourneyKind;
  party: Traveller[];
  path: string[];
  depart: number;
  pace?: number;
  purpose: string;
  cargo?: Record<string, number>;
  carries?: string[];
  guards?: number;
  stay?: number;
}

/** Start a journey: its roads, its timeline, an id. Null if the roads don't join the places. */
export function launch(world: SavedWorld, data: RoadData, o: Launch): Journey | null {
  const roads = roadsAlong(data, o.path);
  if (!roads || roads.length === 0) return null;
  const list = journeysOf(world);
  if (list.length >= MAX_JOURNEYS) return null;
  const pace = o.pace ?? WALK_PACE;
  const line = journeyLine(data, roads, o.path);
  const { timeline, arrive } = buildTimeline(o.depart, line, pace, { stay: o.stay ?? 20 });
  world.nextJourney = (world.nextJourney ?? 0) + 1;
  const j: Journey = {
    id: `j${world.nextJourney}`,
    kind: o.kind,
    party: o.party,
    path: o.path,
    roads,
    depart: timeline[0]?.t0 ?? o.depart,
    arrive,
    timeline,
    pace,
    purpose: o.purpose,
    ...(o.cargo ? { cargo: o.cargo } : {}),
    ...(o.carries ? { carries: o.carries } : {}),
    ...(o.guards ? { guards: o.guards } : {}),
  };
  list.push(j);
  return j;
}

/** Drop the journeys that finished a day ago. */
export function pruneJourneys(world: SavedWorld, minute: number): void {
  const list = journeysOf(world);
  const keep = list.filter((j) => minute < (j.ended ? Math.min(j.ended.minute, j.arrive) : j.arrive) + KEEP_AFTER);
  if (keep.length !== list.length) world.journeys = keep;
}

export const lineOf = (data: RoadData, j: Journey) => journeyLine(data, j.roads, j.path);

export interface Seen {
  journey: Journey;
  at: JourneyPosition;
}

/** The journeys on the road at `minute` within `radius` tiles of a point. */
export function journeysNear(world: SavedWorld, data: RoadData, p: { x: number; y: number }, radius: number, minute: number): Seen[] {
  const out: Seen[] = [];
  for (const journey of journeysOf(world)) {
    if (!isOnTheRoad(journey, minute)) continue;
    const at = positionAt(journey, lineOf(data, journey), minute);
    if (Math.abs(at.x - p.x) <= radius && Math.abs(at.y - p.y) <= radius && Math.hypot(at.x - p.x, at.y - p.y) <= radius) out.push({ journey, at });
  }
  return out;
}

/** "Merchant caravan of the Gold Road, to Ashcross": what to say about a party. */
export function describeJourney(j: Journey, name: (id: string) => string): string {
  const to = name(j.path.at(-1)!);
  const from = name(j.path[0]!);
  const lead = j.party[0]?.name ?? "someone";
  switch (j.kind) {
    case "caravan":
      return `${lead}'s caravan from ${from}, bound for ${to}`;
    case "messenger":
      return `${lead}, a messenger from ${from} to ${to}`;
    case "patrol":
      return `a patrol of ${from}, under ${lead}`;
    case "pilgrims":
      return `pilgrims from ${from} bound for ${to}`;
    case "adventurers":
      return `${lead}'s band of adventurers, from ${from} toward ${to}`;
    case "refugees":
    case "migrants":
      return `${lead} and ${j.party.length > 1 ? `${j.party.length - 1} more` : "family"}, leaving ${from} for ${to}`;
    case "coach":
      return `the coach from ${from} to ${to}`;
  }
}

export { DAY_ENDS };
