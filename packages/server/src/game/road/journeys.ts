import { DAY_ENDS, DAY_STARTS, WALK_PACE, buildRoundTimeline, buildTimeline, graphOf, isOnTheRoad, journeyLine, placeAt, positionAt, type Away, type Carry, type Journey, type JourneyKind, type JourneyPosition, type JourneyRoad, type RoadData, type Traveller } from "@millbrook/shared";
import type { PeopleStore } from "../../store/peopleStore.js";
import type { Realm } from "../realm/types.js";

/**
 * The journeys (N26 decision 6, Part E). They are kept in the realm (`realm.journeys`): a few hundred at most, each a
 * small record whose position at any minute is a formula (shared/road/journey.ts). Every member of a party is a row of
 * the `people` table, marked `away` while the journey lasts; made by the day's trips (road/trips/), closed when they
 * arrive (road/day.ts), pruned a day after.
 */

/** Most journeys at once. */
export const MAX_JOURNEYS = 500;
/** A finished journey is kept this many minutes (so the road can still point at it), then dropped. */
const KEEP_AFTER = 1440;

export const journeysOf = (realm: Pick<Realm, "journeys">): Journey[] => realm.journeys as unknown as Journey[];
export const journeyOf = (realm: Pick<Realm, "journeys">, id: string): Journey | undefined => journeysOf(realm).find((j) => j.id === id);

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
  /** Settlement ids from where they set out to where they are going. For a round trip, out and back: [home, ..., there, ..., home]. */
  path: string[];
  depart: number;
  pace?: number;
  purpose: string;
  cargo?: Record<string, number>;
  carries?: Carry[];
  guards?: number;
  stay?: number;
  /** A round trip: the index in `path` of the place they turn round at, and the minutes they stay there at least. */
  turn?: { index: number; stay: number };
  visit?: string;
  move?: { from: string; to: string; everyone: boolean };
  dungeon?: string;
}

/** Start a journey: its roads, its timeline, an id, and its people away. Null if the roads don't join the places or the party is empty. */
export function launch(realm: Realm, data: RoadData, o: Launch, people?: PeopleStore): Journey | null {
  const roads = roadsAlong(data, o.path);
  if (!roads || roads.length === 0 || o.party.length === 0) return null;
  const list = journeysOf(realm);
  if (list.length >= MAX_JOURNEYS) return null;
  const pace = o.pace ?? WALK_PACE;
  const line = journeyLine(data, roads, o.path);
  let timeline;
  let arrive: number;
  let turn: Journey["turn"];
  if (o.turn) {
    const turnD = roads.slice(0, o.turn.index).reduce((a, r) => a + (data.roads.find((x) => x.id === r.id)?.length ?? 0), 0);
    const built = buildRoundTimeline(o.depart, line, pace, turnD, o.turn.stay, { stay: o.stay ?? 20 });
    timeline = built.timeline;
    arrive = built.arrive;
    turn = { d: turnD, site: o.path[o.turn.index]!, arrive: built.turn.arrive, leave: built.turn.leave };
  } else {
    const built = buildTimeline(o.depart, line, pace, { stay: o.stay ?? 20 });
    timeline = built.timeline;
    arrive = built.arrive;
  }
  realm.nextJourney += 1;
  const j: Journey = {
    id: `j${realm.nextJourney}`,
    kind: o.kind,
    party: o.party,
    path: o.path,
    roads,
    depart: timeline[0]?.t0 ?? o.depart,
    arrive,
    timeline,
    pace,
    purpose: o.purpose,
    returns: !!o.turn,
    ...(turn ? { turn } : {}),
    ...(o.cargo ? { cargo: o.cargo } : {}),
    ...(o.carries ? { carries: o.carries } : {}),
    ...(o.guards ? { guards: o.guards } : {}),
    ...(o.visit ? { visit: o.visit } : {}),
    ...(o.move ? { move: o.move } : {}),
    ...(o.dungeon ? { dungeon: o.dungeon } : {}),
  };
  list.push(j);
  if (people) people.depart(o.party.map((t) => t.person), awayFor(j));
  return j;
}

/** What `people.away` says of the members of a journey. */
export const awayFor = (j: Journey): Away => ({ journey: j.id, since: j.depart, purpose: j.purpose, returns: j.returns || !j.move });

/** Drop the journeys that finished a day ago and were dealt with. */
export function pruneJourneys(realm: Realm, minute: number): void {
  const list = journeysOf(realm);
  const keep = list.filter((j) => !j.closed || minute < (j.ended ? Math.min(j.ended.minute, j.arrive) : j.arrive) + KEEP_AFTER);
  if (keep.length !== list.length) realm.journeys = keep as unknown as Realm["journeys"];
}

export const lineOf = (data: RoadData, j: Journey) => journeyLine(data, j.roads, j.path);

export interface Seen {
  journey: Journey;
  at: JourneyPosition;
}

/** The journeys on the road at `minute` within `radius` tiles of a point. */
export function journeysNear(realm: Realm, data: RoadData, p: { x: number; y: number }, radius: number, minute: number): Seen[] {
  const out: Seen[] = [];
  for (const journey of journeysOf(realm)) {
    if (!isOnTheRoad(journey, minute)) continue;
    const at = positionAt(journey, lineOf(data, journey), minute);
    if (Math.abs(at.x - p.x) <= radius && Math.abs(at.y - p.y) <= radius && Math.hypot(at.x - p.x, at.y - p.y) <= radius) out.push({ journey, at });
  }
  return out;
}

/** "Merchant caravan of the Gold Road, to Ashcross": what to say about a party. */
export function describeJourney(j: Journey, name: (id: string) => string): string {
  const turnTo = j.turn ? name(j.turn.site) : name(j.path.at(-1)!);
  const from = name(j.path[0]!);
  const lead = j.party[0]?.name ?? "someone";
  const more = j.party.length > 1 ? `${j.party.length - 1} more` : "family";
  switch (j.kind) {
    case "market":
      return `${lead}${j.party.length > 1 ? ` and ${j.party.length - 1} more` : ""} of ${from}, going to market in ${turnTo}`;
    case "caravan":
      return `${lead}'s caravan from ${from}, bound for ${turnTo}`;
    case "kin":
      return `${lead} of ${from}, going to see family in ${turnTo}`;
    case "work":
      return `${lead} of ${from}, looking for work in ${turnTo}`;
    case "courier":
      return `${lead}, a crown courier from ${from} to ${turnTo}`;
    case "officials":
      return `${lead} of ${from}, on the lord's business in ${turnTo}`;
    case "patrol":
      return `a patrol of ${from}, under ${lead}`;
    case "pilgrims":
      return `pilgrims from ${from} bound for ${turnTo}`;
    case "adventurers":
      return `${lead}'s band of adventurers, from ${from} toward ${turnTo}`;
    case "refugees":
    case "migrants":
      return `${lead} and ${more}, leaving ${from} for ${turnTo}`;
    case "coach":
      return `the coach from ${from} to ${turnTo}`;
  }
}

export { DAY_ENDS };

/** Where a journey has its people at noon of a day: a town or an inn, or null on the open road (or once the journey is gone). */
export function awaySite(realm: Realm, journeyId: string, day: number): string | null {
  const j = journeyOf(realm, journeyId);
  return j ? placeAt(j, dayStartMinute(day) + 720).site : null;
}
