import { dominant, type Mood } from "./mood/model.js";
import { REALM_MAP, daylight, daysInSeason, seasonDay, type CrowdDay } from "@millbrook/shared";
import { config } from "../config.js";
import { seedFrom } from "./dice.js";
import { parseItem } from "./items.js";
import { describeWeather, isCold, seasonOf, weatherOn, whereOf } from "./weather.js";
import type { Realm } from "./realm/types.js";
import type { WorldSnapshot } from "../npc/types.js";

/**
 * Town events (N6.4): a market every seventh day (on a day of the week that is each place's own, N25a), a
 * midsummer festival, and a bandit raid day whenever a raid made the news (game/underworld.ts). Each changes needs,
 * prices, schedules and the news line, all in code; the model only hears it in words.
 */
export const TOWN_EVENTS = ["market", "festival", "raid"] as const;
export type TownEvent = (typeof TOWN_EVENTS)[number];

/** A market comes to the square every this many days. */
export const MARKET_EVERY = 7;
/** Days a raid keeps the town shaken (the raid day and the day after). */
export const RAID_DAYS = 2;

/** The town the world is about (game/site.ts gives a saved world its place's `marketOffset`): a market day of the week of its own. */
type Calendar = Pick<WorldSnapshot, "day" | "recentEvents" | "lastRaidDay"> & { marketOffset?: number };

/** The offset of a place's market day, from its id: not every place has its market on the same day. */
export const marketOffsetOf = (site: string): number => seedFrom(`market:${site}`) % MARKET_EVERY;

/** The four festivals of the year (N30 decision 8), one on the second day of each season. */
export const FESTIVALS = { spring: "planting", summer: "midsummer", autumn: "harvest home", winter: "midwinter" } as const;
export type Festival = (typeof FESTIVALS)[keyof typeof FESTIVALS];

/** The festival on a day, if there is one: the second day of each season (the first in a year too short for that). */
export function festivalOn(day: number): Festival | null {
  const sd = seasonDay(day, config.daysPerYear);
  const want = daysInSeason(config.daysPerYear) >= 2 ? 2 : 1;
  return sd === want ? FESTIVALS[seasonOf(day)] : null;
}

/** What's on in town today. */
export function townEventsOn(world: Calendar): TownEvent[] {
  const events: TownEvent[] = [];
  if ((world.day + (world.marketOffset ?? 0)) % MARKET_EVERY === 0) events.push("market");
  // The festivals: one a season (N30).
  if (festivalOn(world.day)) events.push("festival");
  if (world.lastRaidDay !== undefined && world.day - world.lastRaidDay < RAID_DAYS && world.day >= world.lastRaidDay) events.push("raid");
  return events;
}

/** The mine road closes after a raid until the news is old. */
export function mineRoadClosed(world: Calendar): boolean {
  return townEventsOn(world).includes("raid");
}

const PELTS = new Set(["rabbit pelt", "wolf pelt"]);
const FOOD = new Set(["bread loaf", "stew", "eggs", "turnips"]);
const WEAPONS_AND_ARMOUR = (name: string) => {
  const def = parseItem(name)?.def;
  return def?.weapon !== undefined || def?.armor !== undefined;
};

/** How full the granaries are where the player is (0..100), or null with no realm (a bare town). */
export function storesHere(world: object): number | null {
  const w = world as { realm?: Realm | null; player?: { site?: string } };
  const s = w.player?.site ? w.realm?.settlements[w.player.site] : undefined;
  return s ? s.food : null;
}

/** The mood of the place the player is in (N36), or null. */
export function moodHere(world: object): Partial<Record<string, number>> | null {
  const w = world as { realm?: Realm | null; player?: { site?: string } };
  const s = w.player?.site ? w.realm?.settlements[w.player.site] : undefined;
  return (s?.mood as Partial<Record<string, number>> | undefined) ?? null;
}

/** What the stores do to the price of food (N30 decision 4): dear as they run low (up to twice near empty), down to a tenth cheaper when full. */
export function storesFactor(food: number): number {
  const f = Math.max(0, Math.min(100, food));
  return f < 50 ? 1 + (50 - f) / 50 : 1 - (0.1 * (f - 50)) / 50;
}

/**
 * Price multiplier for an item today: pelts are dear in the cold, weapons and armour
 * after a raid or while the kingdom is at war (food too), iron ore while the mine
 * road is shut, and food as the place's stores run low (N30). 1 when nothing applies.
 */
export function priceFactor(item: string, world: Calendar & { atWar?: boolean }): number {
  const name = parseItem(item)?.name ?? item;
  let factor = 1;
  // The kingdom at war (N13.5): armies buy up blades, armour and food.
  if (world.atWar) {
    if (WEAPONS_AND_ARMOUR(name)) factor *= 1.25;
    if (FOOD.has(name)) factor *= 1.15;
  }
  if (PELTS.has(name) && isCold(world.day, whereOf(world))) factor *= 1.5;
  const stores = FOOD.has(name) ? storesHere(world) : null;
  if (stores !== null) factor *= storesFactor(stores);
  // The place's mood (N36): grief and fear make drink and blades dearer; a glad town pours cheaper.
  const mood = moodHere(world);
  if (mood) {
    if ((name === "ale" || WEAPONS_AND_ARMOUR(name)) && Math.max(mood.grief ?? 0, mood.fear ?? 0) >= 40) factor *= 1.1;
    if (name === "ale" && (mood.joy ?? 0) >= 40) factor *= 0.9;
  }
  if (townEventsOn(world).includes("raid")) {
    if (WEAPONS_AND_ARMOUR(name)) factor *= 1.25;
    if (name === "iron ore") factor *= 1.5;
  }
  return factor;
}

/** Village sales are twice as likely on market day. */
export function saleChanceFactor(world: Calendar): number {
  return townEventsOn(world).includes("market") ? 2 : 1;
}

const EVENT_WORDS: Record<TownEvent, string> = {
  market: "it's market day, and the square is busy with traders",
  festival: "it's a festival, and the village gathers in the square tonight",
  raid: "after the bandit raid the roads are shut, and weapons and ore are dear",
};

/** The news line about today: weather, season and anything on in town. */
export function describeToday(world: Calendar): string {
  const fest = festivalOn(world.day);
  const events = townEventsOn(world).map((e) => (e === "festival" && fest ? `it's the ${fest} festival, and the village gathers in the square tonight` : EVENT_WORDS[e]));
  return `Today: ${describeWeather(world.day, whereOf(world))}${events.length > 0 ? `; ${events.join("; ")}` : ""}.`;
}

/** For tests and the browser: today's weather, season and events. */
export function todayInfo(world: Calendar) {
  const where = whereOf(world);
  const snow = weatherOn(world.day, where) === "snow" || weatherOn(world.day - 1, where) === "snow";
  return { weather: weatherOn(world.day, where), season: seasonOf(world.day), events: townEventsOn(world), daysPerYear: config.daysPerYear, snow, festival: festivalOn(world.day) };
}

/**
 * Today's conditions for where the townsfolk of `site` go (N16, N30): the weather there, a festival, the light (sunrise and
 * sunset by the season and how far north the place lies), the season, and whether it is harvest time.
 */
export function crowdDayAt(world: Calendar & { realm?: Realm | null }, site: string | null): CrowdDay {
  const s = site ? world.realm?.settlements[site] : undefined;
  const north = s ? 1 - s.pos.y / REALM_MAP.h : 0.5;
  const { rise, set } = daylight(world.day, config.daysPerYear, north);
  const season = seasonOf(world.day);
  const mood = dominant(s?.mood as Mood | undefined);
  return {
    weather: weatherOn(world.day, { realm: world.realm ?? null, site }),
    festival: townEventsOn(world).includes("festival"),
    ...(mood ? { mood } : {}),
    rise,
    set,
    season,
    harvest: season === "autumn",
  };
}
