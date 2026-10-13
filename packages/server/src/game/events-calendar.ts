import { config } from "../config.js";
import { seedFrom } from "./dice.js";
import { parseItem } from "./items.js";
import { dayOfYear, describeWeather, isCold, seasonOf, weatherOn } from "./weather.js";
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

/** What's on in town today. */
export function townEventsOn(world: Calendar): TownEvent[] {
  const events: TownEvent[] = [];
  if ((world.day + (world.marketOffset ?? 0)) % MARKET_EVERY === 0) events.push("market");
  // The first day of summer.
  if (seasonOf(world.day) === "summer" && (dayOfYear(world.day) === 0 || seasonOf(world.day - 1) !== "summer")) events.push("festival");
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

/**
 * Price multiplier for an item today: pelts are dear in the cold, weapons and armour
 * after a raid or while the kingdom is at war (food too), and iron ore while the mine
 * road is shut. 1 when nothing applies.
 */
export function priceFactor(item: string, world: Calendar & { atWar?: boolean }): number {
  const name = parseItem(item)?.name ?? item;
  let factor = 1;
  // The kingdom at war (N13.5): armies buy up blades, armour and food.
  if (world.atWar) {
    if (WEAPONS_AND_ARMOUR(name)) factor *= 1.25;
    if (FOOD.has(name)) factor *= 1.15;
  }
  if (PELTS.has(name) && isCold(world.day)) factor *= 1.5;
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
  festival: "it's the midsummer festival, and the village gathers in the square tonight",
  raid: "after the bandit raid the roads are shut, and weapons and ore are dear",
};

/** The news line about today: weather, season and anything on in town. */
export function describeToday(world: Calendar): string {
  const events = townEventsOn(world).map((e) => EVENT_WORDS[e]);
  return `Today: ${describeWeather(world.day)}${events.length > 0 ? `; ${events.join("; ")}` : ""}.`;
}

/** For tests and the browser: today's weather, season and events. */
export function todayInfo(world: Calendar) {
  return { weather: weatherOn(world.day), season: seasonOf(world.day), events: townEventsOn(world), daysPerYear: config.daysPerYear };
}
