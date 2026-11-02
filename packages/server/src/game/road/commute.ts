import { cumulative, pointAt, seedOf, WALK_PACE, type Plot, type RoadData, type RoadPlace, type RoadPoint } from "@millbrook/shared";
import type { PeopleStore, PersonRow } from "../../store/peopleStore.js";
import type { FarmStore } from "../../store/farmStore.js";
import { plotsOf } from "../farm/fields.js";
import type { Realm } from "../realm/types.js";
import { ageOn } from "../realm/who.js";
import type { Town } from "../town.js";
import { landOf } from "./ground.js";

/**
 * People going to work along the road (N26F decision 12). A town's miners walk out to its working mine and back, its
 * hunters to the edge of its woods, the mine watch with the miners (road/watch.ts), and a carter brings the day's ore to
 * town each afternoon. A commute isn't a journey (a town's miners every day would flood `realm.journeys`): it is worked
 * out from the town's own people rows, like the crowd, as a pure function of the day and the minute, only for places
 * near the player, and nothing is saved. To their town's crowd they are "out" all day as before (the routines'
 * `out:exit_road` and `out:exit_woods`); this only says where on the road they are while out.
 */
export interface Commute {
  person: string;
  name: string;
  job: "miner" | "hunter" | "carter" | "guard" | "farmer";
  // ("carter": a porter of the place driving the ore cart today.)
  /** Their town. */
  from: string;
  /** The place on the road they work at (a road place id). */
  to: string;
  /** Minutes of the day: when they leave the gate, and when they leave work to walk home. */
  out: number;
  back: number;
  /** What a carter carries in: the day's ore. */
  cargo?: Record<string, number>;
}

/** The working mine and the woods of a place, as places on the road. */
export function workPlacesOf(data: RoadData, site: string): { mine?: RoadPlace; woods?: RoadPlace } {
  return { mine: data.places.find((p) => p.id === `workings:${site}`), woods: data.places.find((p) => p.id === `woods:${site}`) };
}

/** Ore a mine of this level gives in a day (what its carter brings in). */
export const ORE_PER_LEVEL = 2;

const jitter = (id: string, day: number, span: number) => (seedOf(`${id}|commute|${day}`) >>> 0) % span;

/** Who of a place walks out to work along the road today, and when. */
export function commutesOf(realm: Realm, people: PeopleStore, site: string, day: number, data: RoadData, farm?: FarmStore): Commute[] {
  const s = realm.settlements[site];
  if (!s || s.abandoned || s.fallen) return [];
  const { mine, woods } = workPlacesOf(data, site);
  const rows = (people.loadSite(site, "full") as PersonRow[]).filter((r) => r.death === null && !r.away && ageOn(r, day) >= 14);
  const out: Commute[] = [];
  // Farmers walk out to a plot their household holds (N26G decision 5).
  const held = new Map<string, string[]>();
  if (farm && s.fields?.kept) for (const p of farm.plotsOf(site).values()) held.set(p.holder, [...(held.get(p.holder) ?? []), p.id]);
  for (const r of rows.sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const ours = r.home !== null ? held.get(`hh:${site}:${r.home}`) : undefined;
    if ((r.job === "farmer" || r.cls === "serf") && ours && ours.length > 0) {
      out.push({ person: r.id, name: r.name, job: "farmer", from: site, to: ours[jitter(r.id, day, ours.length)]!, out: 330 + jitter(r.id, day, 60), back: 990 + jitter(r.id, day + 1, 60) });
      continue;
    }
    if (r.job === "miner" && mine) out.push({ person: r.id, name: r.name, job: "miner", from: site, to: mine.id, out: 360 + jitter(r.id, day, 60), back: 960 + jitter(r.id, day + 1, 60) });
    else if (r.job === "hunter" && woods) out.push({ person: r.id, name: r.name, job: "hunter", from: site, to: woods.id, out: 330 + jitter(r.id, day, 90), back: 900 + jitter(r.id, day + 1, 120) });
  }
  // The day's ore comes to town on a cart: one carter of the place, the day's output aboard.
  const carter = mine && rows.filter((r) => r.job === "porter").sort((a, b) => (seedOf(`${a.id}|cart|${day}`) >>> 0) - (seedOf(`${b.id}|cart|${day}`) >>> 0))[0];
  if (carter && mine && out.some((c) => c.job === "miner")) out.push({ person: carter.id, name: carter.name, job: "carter", from: site, to: mine.id, out: 720 + jitter(carter.id, day, 60), back: 900, cargo: { "iron ore": ORE_PER_LEVEL * (s.buildings.mine ?? 1) } });
  return out;
}

/** The road between a place's gate and a work place on it: the points, gate first. */
function wayTo(data: RoadData, site: string, to: RoadPlace): RoadPoint[] | null {
  const road = data.roads.find((r) => r.id === to.road);
  if (!road) return null;
  const cum = cumulative(road.pts);
  const fromT = road.a === site ? 0 : road.length;
  const n = Math.max(2, Math.ceil(Math.abs(to.t - fromT) / 20));
  const pts: RoadPoint[] = [];
  for (let i = 0; i <= n; i++) pts.push(pointAt(road.pts, cum, fromT + ((to.t - fromT) * i) / n));
  pts.push(to.at);
  return pts;
}

/** Where a commuter is at a minute of the day: on the way, at work, or not out (null: at home, or in town). */
export function commuterAt(c: Commute, data: RoadData, minuteOfDay: number, plots?: Plot[]): { x: number; y: number; where: "going" | "working" | "coming back" } | null {
  const plot = c.to.startsWith("pl:") ? plots?.find((p) => p.id === c.to) : undefined;
  const to = plot ? ({ at: { x: plot.x + Math.floor(plot.w / 2), y: plot.y + Math.floor(plot.h / 2) } } as RoadPlace) : data.places.find((p) => p.id === c.to);
  const fp = plot ? data.footprints.find((f) => f.id === c.from) : undefined;
  // To a plot: out of the nearest gate and straight across the fields.
  const gate = fp ? Object.values(fp.gates).sort((a, b) => Math.hypot(a.x - to!.at.x, a.y - to!.at.y) - Math.hypot(b.x - to!.at.x, b.y - to!.at.y))[0] : undefined;
  const way = plot ? (gate ? [gate, to!.at] : null) : to ? wayTo(data, c.from, to) : null;
  if (!to || !way) return null;
  const cum = cumulative(way);
  const len = cum.at(-1)!;
  const walk = len / WALK_PACE;
  // A carter goes out empty after noon and comes back loaded; the rest go out in the morning and home after work.
  const goneAt = c.out;
  const there = goneAt + walk;
  const leave = Math.max(there, c.back);
  const home = leave + walk;
  if (minuteOfDay < goneAt || minuteOfDay >= home) return null;
  if (minuteOfDay < there) {
    const p = pointAt(way, cum, ((minuteOfDay - goneAt) / walk) * len);
    return { x: Math.round(p.x), y: Math.round(p.y), where: "going" };
  }
  if (minuteOfDay < leave) {
    const k = seedOf(c.person) >>> 0;
    return { x: to.at.x + ((k % 7) - 3), y: to.at.y + (((k >>> 3) % 5) - 2), where: "working" };
  }
  const p = pointAt(way, cum, len - ((minuteOfDay - leave) / walk) * len);
  return { x: Math.round(p.x), y: Math.round(p.y), where: "coming back" };
}

/** Commuters near the player on the road now: whose, where, doing what. */
export function commutersNear(town: Town, radius: number): Array<Commute & { x: number; y: number; where: string }> {
  const realm = town.world.realm;
  const road = town.world.player.road;
  if (!realm || !road || !town.store) return [];
  const data = landOf(realm).data;
  const minute = town.world.hour * 60 + (town.world.minute ?? 0);
  const out: Array<Commute & { x: number; y: number; where: string }> = [];
  // Only places whose work places could be in reach.
  const sites = new Set(data.places.filter((p) => (p.id.startsWith("workings:") || p.id.startsWith("woods:")) && Math.hypot(p.at.x - road.x, p.at.y - road.y) <= 1200).map((p) => p.id.split(":")[1]!));
  // Places whose fields could be in reach.
  for (const f of data.footprints) if (Math.hypot((f.x0 + f.x1) / 2 - road.x, (f.y0 + f.y1) / 2 - road.y) <= 900 && realm.settlements[f.id]?.fields?.kept) sites.add(f.id);
  for (const site of sites) {
    const plots = realm.settlements[site]?.fields?.kept ? plotsOf(realm, realm.settlements[site]!, town.world.day) : undefined;
    for (const c of commutesOf(realm, town.store.people, site, town.world.day, data, town.store.farm)) {
      const at = commuterAt(c, data, minute, plots);
      if (at && Math.hypot(at.x - road.x, at.y - road.y) <= radius) out.push({ ...c, ...at });
    }
  }
  return out;
}

/** The names of those at work at a place's mine now. */
export function minersAt(town: Town, site: string): string[] {
  const realm = town.world.realm;
  if (!realm || !town.store) return [];
  const data = landOf(realm).data;
  const minute = town.world.hour * 60 + (town.world.minute ?? 0);
  return commutesOf(realm, town.store.people, site, town.world.day, data)
    .filter((c) => c.job === "miner" && commuterAt(c, data, minute)?.where === "working")
    .map((c) => c.name);
}
