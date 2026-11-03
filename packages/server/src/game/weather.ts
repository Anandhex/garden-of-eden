import { TILES_PER_UNIT, baseWeather, daysInSeason, forcedWeather, hashUnit, seasonAt, weatherAt, yearDay, yearNumber, type WeatherKind } from "@millbrook/shared";
import { config } from "../config.js";
import type { Realm } from "./realm/types.js";

/**
 * Weather and seasons (N6.4). The year (config.daysPerYear days) has four seasons;
 * each day's weather is rolled from its season. The roll is a hash of the day, so
 * it's the same every time it's asked for and needs nothing in the save.
 */
export const SEASONS = ["spring", "summer", "autumn", "winter"] as const;
export type Season = (typeof SEASONS)[number];

export const WEATHERS = ["clear", "rain", "storm", "snow", "fog"] as const;
export type Weather = WeatherKind;

/** Day of the year, 0-based. */
export function dayOfYear(day: number): number {
  // Days before the first (day 0, "yesterday" on day 1) wrap into the year before.
  return yearDay(day, config.daysPerYear);
}

/** The season on a day: the year splits into four equal parts, spring first (shared/calendar.ts). */
export function seasonOf(day: number): Season {
  return seasonAt(day, config.daysPerYear);
}

/** The year a day falls in (1 for the first `daysPerYear` days). */
export const yearNo = (day: number): number => yearNumber(day, config.daysPerYear);

/** Days in a season (a quarter of the year, at least one). */
export const seasonDays = (): number => daysInSeason(config.daysPerYear);

/**
 * Rules that follow the calendar are stated over a year and turned into a day's part here, so changing the length of
 * the year (config.daysPerYear) leaves what happens in a year the same. `dailyChance` is for a chance (0.3 a year is
 * about 0.0074 a day at 48 days); `perDay` is for an amount (a store that falls 120 over a year falls 2.5 a day).
 */
export const dailyChance = (yearly: number): number => 1 - (1 - Math.min(1, Math.max(0, yearly))) ** (1 / config.daysPerYear);
export const perDay = (perYear: number): number => perYear / config.daysPerYear;

/** A number in [0, 1) that depends only on `n` (a small integer hash): shared/weather.ts. */
export { hashUnit };

/**
 * Where to ask the weather of (N30): a realm and a place in it, or a tile of the open road. The weather is regional
 * (shared/weather.ts): the north is colder, hills colder still, the coast wetter.
 */
export interface WeatherWhere {
  realm?: Realm | null;
  /** A settlement id. */
  site?: string | null;
  /** A road tile (global tile coordinates), which wins over `site`. */
  tile?: { x: number; y: number } | null;
}

/** The weather at a settlement on a day. */
export function weatherAtSite(realm: Realm, site: string, day: number): Weather {
  const s = realm.settlements[site];
  if (!s) return weatherOn(day);
  return weatherAt(realm.seed, day, s.pos, s.terrain, config.daysPerYear);
}

/** The terrain of the nearest settlement to a map point (the land the weather comes over). */
function terrainNear(realm: Realm, pos: { x: number; y: number }): string {
  let best = "plains";
  let d = Infinity;
  for (const s of Object.values(realm.settlements)) {
    const e = (s.pos.x - pos.x) ** 2 + (s.pos.y - pos.y) ** 2;
    if (e < d) {
      d = e;
      best = s.terrain;
    }
  }
  return best;
}

/**
 * The weather on a day: at a place in the realm when `where` says which (regional, N30), else the old realm-wide roll
 * from the season (a world with no realm, the CLI's town). The same every time.
 */
export function weatherOn(day: number, where?: WeatherWhere | null): Weather {
  const realm = where?.realm;
  if (realm && where.tile) {
    const pos = { x: where.tile.x / TILES_PER_UNIT, y: where.tile.y / TILES_PER_UNIT };
    return weatherAt(realm.seed, day, pos, terrainNear(realm, pos), config.daysPerYear);
  }
  if (realm && where.site && realm.settlements[where.site]) return weatherAtSite(realm, where.site, day);
  return forcedWeather(day) ?? baseWeather(day, config.daysPerYear);
}

/** Winter, or a snowy day: everyone gets hungrier (needs.ts) and pelts are in demand. */
export function isCold(day: number, where?: WeatherWhere | null): boolean {
  return seasonOf(day) === "winter" || weatherOn(day, where) === "snow";
}

/** Where the world's player is, for the weather: on the road, or in the place they are at. */
export function whereOf(world: object): WeatherWhere {
  // Any world-like thing: a bare test world or a calendar without a realm gives the realm-wide weather.
  const w = world as { realm?: Realm | null; player?: { site?: string | null; road?: { x: number; y: number } | null } };
  return { realm: w.realm ?? null, site: w.player?.site ?? null, tile: w.player?.road ? { x: w.player.road.x, y: w.player.road.y } : null };
}

const WEATHER_WORDS: Record<Weather, string> = {
  clear: "clear skies",
  rain: "steady rain",
  storm: "a storm, too wild for outdoor work",
  snow: "snow",
  fog: "a thick fog",
};

/** "snow, in winter" for the situation and the browser. */
export function describeWeather(day: number, where?: WeatherWhere | null): string {
  return `${WEATHER_WORDS[weatherOn(day, where)]}, in ${seasonOf(day)}`;
}
