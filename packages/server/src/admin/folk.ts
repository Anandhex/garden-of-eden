import { type ClassCounts, CrowdSim, type CrowdDay, type CrowdRoster, type Townsperson } from "@millbrook/shared";
import { townEventsOn } from "../game/events-calendar.js";
import { figureClass } from "../game/realm/townsfolk.js";
import { weatherOn } from "../game/weather.js";
import { siteMap, type SiteMap } from "../web/sites.js";
import type { AdminContext } from "./context.js";

/**
 * The townsfolk of any settlement, for the admin view (N17). They are read from the database
 * (N18; a world without one rolls them with `rosterFor`), `CrowdSim` says where they are.
 * The simulations are kept per place, and the class counts per (place, size, day).
 */

export interface Folk {
  site: string;
  map: SiteMap;
  roster: CrowdRoster;
  sim: CrowdSim;
}

const sims = new Map<string, Folk>();

/** The people of a settlement and the map they live on, or null (no such place, abandoned, no realm). */
export function folkOf(ctx: AdminContext, site: string): Folk | null {
  const world = ctx.world();
  const realm = world.realm;
  const s = realm?.settlements[site];
  if (!realm || !s) return null;
  const map = siteMap(s, "village", realm);
  const roster = ctx.town().rosterAt(site, map, world.day, { readOnly: true });
  if (!roster) return null;
  const hit = sims.get(site);
  if (hit && hit.map === map && hit.roster.people === roster.people) {
    hit.roster = roster;
    hit.sim.roster = roster;
    return hit;
  }
  const folk: Folk = { site, map, roster, sim: new CrowdSim({ id: map.id, w: map.w, h: map.h, tiles: map.tiles, buildings: map.buildings, zones: map.zones }, roster) };
  sims.set(site, folk);
  return folk;
}

/** Today's conditions for where the townsfolk go. */
export function crowdDay(ctx: AdminContext): CrowdDay {
  const world = ctx.world();
  return { weather: weatherOn(world.day), festival: townEventsOn(world).includes("festival") };
}

/** One of the townsfolk by id (`t_<site>_<n>`), with the place they live in. */
export function townsperson(ctx: AdminContext, site: string, id: string): { folk: Folk; person: Townsperson } | null {
  const folk = folkOf(ctx, site);
  const i = folk?.sim.index.get(id);
  if (!folk || i === undefined) return null;
  return { folk, person: folk.roster.people[i]! };
}

const counts = new Map<string, { key: string; counts: ClassCounts }>();

/** People by social class in a settlement: the townsfolk and its notable figures. Cached per (place, size, day). */
export function classCounts(ctx: AdminContext, site: string, cached = false): ClassCounts | null {
  const world = ctx.world();
  const realm = world.realm;
  const s = realm?.settlements[site];
  if (!realm || !s) return null;
  const key = `${s.population}|${world.day}|${s.leader ?? ""}`;
  const hit = counts.get(site);
  if (hit?.key === key) return hit.counts;
  if (cached) return null;
  const folk = folkOf(ctx, site);
  const out: ClassCounts = {};
  // Visitors (N26 Part E) are not the place's people; those of its own away on a journey are not about, but still its people.
  const own = ctx.store ? new Set((ctx.store.people.loadSite(site, "coarse") as Array<{ id: string }>).map((r) => r.id)) : null;
  for (const p of folk?.roster.people ?? []) if (!own || own.has(p.id)) out[p.cls] = (out[p.cls] ?? 0) + 1;
  if (ctx.store) for (const r of ctx.store.people.loadSite(site, "coarse") as Array<{ id: string; cls: string; away: string | null }>) if (r.away !== null) out[r.cls as keyof ClassCounts] = (out[r.cls as keyof ClassCounts] ?? 0) + 1;
  for (const f of Object.values(realm.figures)) if (f.alive && f.home === site && f.role !== "beast") out[figureClass(f.role)] = (out[figureClass(f.role)] ?? 0) + 1;
  counts.set(site, { key, counts: out });
  return out;
}
