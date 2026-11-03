import { seasonDays, seasonOf, weatherAtSite, yearNo } from "../weather.js";
import { realmNews } from "./log.js";
import type { Realm, Settlement } from "./types.js";

/**
 * The farming year (N30 decision 3). Where a place's food is still a formula (no fields kept, N26G), what its land
 * makes follows the year: a little in spring (sowing costs seed), gardens and milk in summer, the harvest in autumn,
 * nothing in winter. Bad weather on a harvest day (a storm, or rain two days running) loses that day's crop, and a
 * kingdom at war has fewer hands in the fields. Where the fields are kept, the harvest is what is reaped from them
 * (`game/farm/day.ts` notes it here). On the first day of winter each place's harvest is judged: poor, normal or good,
 * with news when it was not normal.
 */

/** What a place's land makes in each season, as a share of what is eaten (the mean over a year is the old formula's). */
export const SEASON_YIELD: Record<string, number> = { spring: 0.95, summer: 1.0, autumn: 1.45, winter: 0.75 };
/** A harvest day lost to the weather makes only this. */
const LOST_DAY = 1.0;
/** Hands in the fields when the kingdom is at war (men levied). */
const WAR_HANDS = 0.85;
/** A harvest under this share of what it could be is poor; over GOOD it is a bumper year. */
export const POOR = 0.8;
export const GOOD = 1.12;

/** Is a day's harvest lost to the weather at this place (a storm, or rain on it and the day before)? */
export function harvestSpoiled(realm: Realm, s: Settlement, day: number): boolean {
  const w = weatherAtSite(realm, s.id, day);
  if (w === "storm") return true;
  const wet = (x: string) => x === "rain" || x === "storm";
  return wet(w) && wet(weatherAtSite(realm, s.id, day - 1));
}

/**
 * The season's share for a place on a day (the formula's seasonal factor), and what it would have been with fair weather
 * and every hand at home (`ideal`), so the harvest can be judged.
 */
export function seasonYield(realm: Realm, s: Settlement, day: number, war: boolean): { now: number; ideal: number } {
  const season = seasonOf(day);
  const ideal = SEASON_YIELD[season] ?? 1;
  if (season !== "autumn") return { now: ideal, ideal };
  let now = harvestSpoiled(realm, s, day) ? LOST_DAY : ideal;
  if (war) now = 1 + (now - 1) * WAR_HANDS;
  return { now, ideal };
}

/** Note food brought in from the land (`got`), against what fair weather would have brought (`could`). */
export function noteHarvest(s: Settlement, day: number, got: number, could: number): void {
  const year = yearNo(day);
  if (!s.harvest || s.harvest.year !== year) s.harvest = { year, got: 0, could: 0, ...(s.harvest?.yield ? { last: s.harvest.yield } : {}) };
  s.harvest.got += got;
  s.harvest.could += could;
}

/** Food points a place whose fields are kept should bring in over a year (what its people eat from the granary). */
export const KEPT_EXPECTED = 70;

/**
 * Judge the year's harvest on the first day of winter: `poor`, `normal` or `good`, with news when it was poor or good.
 * Returns the verdict, or null on other days.
 */
export function judgeHarvest(realm: Realm, s: Settlement, day: number): "poor" | "normal" | "good" | null {
  if (seasonOf(day) !== "winter" || seasonOf(day - 1) === "winter") return null;
  const h = s.harvest;
  if (!h || h.year !== yearNo(day)) return null;
  const could = s.fields?.kept ? KEPT_EXPECTED : h.could;
  if (could <= 0) return null;
  const share = h.got / could;
  const verdict = share < POOR ? "poor" : share > GOOD ? "good" : "normal";
  h.yield = verdict;
  h.after = Math.round(s.food * 10) / 10;
  h.share = Math.round(share * 100) / 100;
  if (verdict === "poor") realmNews(realm, day, s.id, "harvest", `A poor harvest at ${s.name}: the granaries are thin going into winter.`, 4, [s.name]);
  else if (verdict === "good" && s.kind !== "hamlet") realmNews(realm, day, s.id, "harvest", `A bumper harvest at ${s.name}: the barns are full.`, 3, [s.name]);
  return verdict;
}

/** Days of autumn (for spreading the harvest). */
export const harvestDays = (): number => seasonDays();
