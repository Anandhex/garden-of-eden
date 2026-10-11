import { config } from "../config.js";
import { parseItem } from "./items.js";
import { dayOfYear, describeWeather, isCold, seasonOf, weatherOn } from "./weather.js";
import type { WorldSnapshot } from "../npc/types.js";

/**
 * Town events (N6.4): a market every seventh day, a midsummer festival, and a bandit
 * raid day whenever a raid made the news (game/underworld.ts). Each changes needs,
 * prices, schedules and the news line, all in code; the model only hears it in words.
 */
export const TOWN_EVENTS = ["market", "festival", "raid"] as const;
export type TownEvent = (typeof TOWN_EVENTS)[number];

/** A market comes to the square every this many days. */
export const MARKET_EVERY = 7;
/** Days a raid keeps the town shaken (the raid day and the day after). */
export const RAID_DAYS = 2;

/** What's on in town today. */
export function townEventsOn(world: Pick<WorldSnapshot, "day" | "recentEvents" | "lastRaidDay">): TownEvent[] {
  const events: TownEvent[] = [];
  if (world.day % MARKET_EVERY === 0) events.push("market");
  // The first day of summer.
  if (seasonOf(world.day) === "summer" && (dayOfYear(world.day) === 0 || seasonOf(world.day - 1) !== "summer")) events.push("festival");
  if (world.lastRaidDay !== undefined && world.day - world.lastRaidDay < RAID_DAYS && world.day >= world.lastRaidDay) events.push("raid");
  return events;
}

/** The mine road closes after a raid until the news is old. */
export function mineRoadClosed(world: Pick<WorldSnapshot, "day" | "recentEvents" | "lastRaidDay">): boolean {
  return townEventsOn(world).includes("raid");
}

const PELTS = new Set(["rabbit pelt", "wolf pelt"]);
const WEAPONS_AND_ARMOUR = (name: string) => {
  const def = parseItem(name)?.def;
  return def?.weapon !== undefined || def?.armor !== undefined;
};

/**
 * Price multiplier for an item today: pelts are dear in the cold, weapons and armour
 * after a raid, and iron ore while the mine road is shut. 1 when nothing applies.
 */
export function priceFactor(item: string, world: Pick<WorldSnapshot, "day" | "recentEvents" | "lastRaidDay">): number {
  const name = parseItem(item)?.name ?? item;
  let factor = 1;
  if (PELTS.has(name) && isCold(world.day)) factor *= 1.5;
  if (townEventsOn(world).includes("raid")) {
    if (WEAPONS_AND_ARMOUR(name)) factor *= 1.25;
    if (name === "iron ore") factor *= 1.5;
  }
  return factor;
}

/** Village sales are twice as likely on market day. */
export function saleChanceFactor(world: Pick<WorldSnapshot, "day" | "recentEvents" | "lastRaidDay">): number {
  return townEventsOn(world).includes("market") ? 2 : 1;
}

const EVENT_WORDS: Record<TownEvent, string> = {
  market: "it's market day, and the square is busy with traders",
  festival: "it's the midsummer festival, and the village gathers in the square tonight",
  raid: "after the bandit raid the mine road is shut, and weapons and ore are dear",
};

/** The news line about today: weather, season and anything on in town. */
export function describeToday(world: Pick<WorldSnapshot, "day" | "recentEvents" | "lastRaidDay">): string {
  const events = townEventsOn(world).map((e) => EVENT_WORDS[e]);
  return `Today: ${describeWeather(world.day)}${events.length > 0 ? `; ${events.join("; ")}` : ""}.`;
}

/** For tests and the browser: today's weather, season and events. */
export function todayInfo(world: Pick<WorldSnapshot, "day" | "recentEvents" | "lastRaidDay">) {
  return { weather: weatherOn(world.day), season: seasonOf(world.day), events: townEventsOn(world), daysPerYear: config.daysPerYear };
}
