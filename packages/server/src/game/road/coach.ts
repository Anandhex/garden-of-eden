import { buildTimeline, graphOf, journeyLine, type JourneyRoad, type RoadData } from "@millbrook/shared";
import { formatMoney } from "../money.js";
import type { Town } from "../town.js";
import { landOf } from "./ground.js";
import { topUp } from "./needs.js";

/**
 * The in-world way to skip a stretch (N26 D3): a paid coach between towns, along main roads only. It goes at twice a
 * walker's pace in the walking hours, sleeps at the inns beside the road, and stops only at its own stops (the places on
 * the way and the inns it sleeps at): not for what the road throws up, which the passengers sit through.
 */
export const COACH_PACE = 14;
/** Copper for each 40 tiles of road. */
export const COACH_FARE_PER = 1 / 40;

export interface CoachQuote {
  ok: boolean;
  message: string;
  price: number;
  /** Game minutes to get there, and the place names it stops at. */
  minutes: number;
  stops: string[];
  path: string[];
  roads: JourneyRoad[];
}

const no = (message: string): CoachQuote => ({ ok: false, message, price: 0, minutes: 0, stops: [], path: [], roads: [] });

/** The shortest way over main roads only. */
function mainWay(data: RoadData, from: string, to: string): { path: string[]; roads: JourneyRoad[]; tiles: number } | null {
  const g = graphOf(data);
  const main = new Set(data.roads.filter((r) => r.main).map((r) => r.id));
  const best = new Map<string, number>([[from, 0]]);
  const prev = new Map<string, { id: string; road: string; rev: boolean }>();
  const open = new Set([from]);
  while (open.size > 0) {
    let cur = "";
    for (const id of open) if (!cur || best.get(id)! < best.get(cur)! || (best.get(id) === best.get(cur) && id < cur)) cur = id;
    open.delete(cur);
    if (cur === to) break;
    for (const e of g.get(cur) ?? []) {
      if (!main.has(e.road)) continue;
      const d = best.get(cur)! + e.len;
      if (!best.has(e.to) || d < best.get(e.to)!) {
        best.set(e.to, d);
        prev.set(e.to, { id: cur, road: e.road, rev: e.rev });
        open.add(e.to);
      }
    }
  }
  if (!best.has(to)) return null;
  const path = [to];
  const roads: JourneyRoad[] = [];
  for (let c = to; c !== from; ) {
    const p = prev.get(c)!;
    roads.unshift({ id: p.road, rev: p.rev });
    path.unshift(p.id);
    c = p.id;
  }
  return { path, roads, tiles: best.get(to)! };
}

/** What a ride to `to` would cost and take, from the place the player is in. */
export function quoteCoach(town: Town, to: string, minute: number): CoachQuote {
  const realm = town.world.realm;
  if (!realm) return no("There are no coaches in this world.");
  if (town.world.player.road) return no("The coach runs from a town's inn, not from the open road.");
  const here = realm.settlements[town.site()];
  const dest = realm.settlements[to] ?? Object.values(realm.settlements).find((s) => !s.way && s.name.toLowerCase() === to.toLowerCase());
  if (!here || !dest || dest.way) return no(`There's no place called "${to}".`);
  if (dest.id === here.id) return no(`You're already in ${dest.name}.`);
  if (here.kind === "hamlet" || here.kind === "village") return no(`${here.name} is too small to have a coach: there's one from the larger towns.`);
  const data: RoadData = landOf(realm).data;
  const way = mainWay(data, here.id, dest.id);
  if (!way) return no(`No coach runs from ${here.name} to ${dest.name}: it is not on the main roads.`);
  const line = journeyLine(data, way.roads, way.path);
  const { timeline, arrive } = buildTimeline(minute, line, COACH_PACE, { stay: 15 });
  void timeline;
  const price = Math.max(5, Math.round(way.tiles * COACH_FARE_PER));
  const stops = [...line.nodes.filter((n) => n.d > 1 && n.d < line.length - 1).map((n) => realm.settlements[n.id]?.name ?? n.id), dest.name];
  return { ok: true, message: `A coach to ${dest.name} costs ${formatMoney(price)} and takes ${Math.round((arrive - minute) / 60)} hours, stopping at ${stops.join(", ")}.`, price, minutes: arrive - minute, stops, path: way.path, roads: way.roads };
}

/** Pay and ride. */
export function takeCoach(town: Town, to: string, minute: number): { ok: boolean; lines: string[] } {
  const q = quoteCoach(town, to, minute);
  if (!q.ok) return { ok: false, lines: [q.message] };
  const p = town.world.player;
  if (p.money < q.price) return { ok: false, lines: [`${q.message} You can't pay it.`] };
  p.money -= q.price;
  town.walkMinutes(Math.max(1, Math.round(q.minutes)));
  const lines = [`You pay ${formatMoney(q.price)} and take the coach.`];
  lines.push(...town.arriveAt(q.path.at(-1)!));
  // Meals and a bed at the inns it sleeps at.
  topUp(p, minute + q.minutes);
  return { ok: true, lines };
}
