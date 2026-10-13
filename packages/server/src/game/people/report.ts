import { config } from "../../config.js";
import type { WorldStore } from "../db.js";
import { speciesOf } from "../../world/species.js";
import { ageFrom, canCourtAt } from "./rules.js";

/**
 * How a realm's people are doing, in numbers (N25): what the balance bounds, `npm run sim:lives`, the admin
 * view and the tests read. Everything comes from the people table and the event table; nothing is remembered.
 */
export interface LifeStats {
  day: number;
  /** Living people in the places counted. */
  people: number;
  children: number;
  adults: number;
  elders: number;
  /** Share of each age group (0..1). */
  pyramid: { children: number; adults: number; elders: number };
  /** Of those old enough to court: how many are married. */
  courting: number;
  married: number;
  /** Births and deaths in the last year, per 1,000 people. */
  birthRate: number;
  deathRate: number;
  births: number;
  deaths: number;
  /** Deaths in the last year by cause. */
  causes: Record<string, number>;
  /** Marriages in the last year, and how many crossed two or more ranks of class. */
  marriages: number;
  crossClass: number;
}

export function lifeStats(store: WorldStore, day: number, sites?: ReadonlySet<string>): LifeStats {
  let children = 0;
  let adults = 0;
  let elders = 0;
  let courting = 0;
  let married = 0;
  for (const r of store.dumpTable("people")) {
    if (r.death !== null) continue;
    if (sites && !sites.has(String(r.site))) continue;
    const sp = speciesOf(String(r.species));
    const age = ageFrom(Number(r.born_day), day);
    if (age < sp.adultAge) children++;
    else if (age >= sp.elderAge) elders++;
    else adults++;
    if (canCourtAt(String(r.species), age)) {
      courting++;
      if (r.spouse !== null) married++;
    }
  }
  const people = children + adults + elders;
  const since = day - config.daysPerYear;
  const events = store.eventsOfKinds(["birth", "death", "marriage"], since).filter((e) => !sites || (e.site !== null && sites.has(e.site)));
  const births = events.filter((e) => e.kind === "birth").length;
  const dead = events.filter((e) => e.kind === "death" && e.actor.startsWith("t_"));
  const causes: Record<string, number> = {};
  for (const e of dead) {
    const m = /died (?:of old age|of an illness|\((\w[\w-]*)\))/.exec(e.details);
    const cause = e.details.includes("of old age") ? "old-age" : e.details.includes("of an illness") ? "illness" : (m?.[1] ?? "other");
    causes[cause] = (causes[cause] ?? 0) + 1;
  }
  const weddings = events.filter((e) => e.kind === "marriage");
  const per = (n: number) => (people > 0 ? Math.round((n / people) * 10000) / 10 : 0);
  return {
    day,
    people,
    children,
    adults,
    elders,
    pyramid: { children: people ? children / people : 0, adults: people ? adults / people : 0, elders: people ? elders / people : 0 },
    courting,
    married,
    birthRate: per(births),
    deathRate: per(dead.length),
    births,
    deaths: dead.length,
    causes,
    marriages: weddings.length,
    crossClass: weddings.filter((e) => e.details.includes("across a gap of rank")).length,
  };
}
