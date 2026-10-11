import { config } from "../config.js";

/**
 * Weather and seasons (N6.4). The year (config.daysPerYear days) has four seasons;
 * each day's weather is rolled from its season. The roll is a hash of the day, so
 * it's the same every time it's asked for and needs nothing in the save.
 */
export const SEASONS = ["spring", "summer", "autumn", "winter"] as const;
export type Season = (typeof SEASONS)[number];

export const WEATHERS = ["clear", "rain", "storm", "snow"] as const;
export type Weather = (typeof WEATHERS)[number];

/** Chance of each weather by season, in the order of WEATHERS. */
const ODDS: Record<Season, Record<Weather, number>> = {
  spring: { clear: 0.55, rain: 0.35, storm: 0.1, snow: 0 },
  summer: { clear: 0.75, rain: 0.15, storm: 0.1, snow: 0 },
  autumn: { clear: 0.45, rain: 0.4, storm: 0.15, snow: 0 },
  winter: { clear: 0.4, rain: 0.05, storm: 0.1, snow: 0.45 },
};

/** Day of the year, 0-based. */
export function dayOfYear(day: number): number {
  return (day - 1) % config.daysPerYear;
}

/** The season on a day: the year splits into four equal parts, spring first. */
export function seasonOf(day: number): Season {
  return SEASONS[Math.min(3, Math.floor((dayOfYear(day) * 4) / config.daysPerYear))]!;
}

/** A number in [0, 1) that depends only on `n` (a small integer hash). */
export function hashUnit(n: number): number {
  let t = Math.imul(n, 0x9e3779b9) >>> 0;
  t = Math.imul(t ^ (t >>> 16), 0x21f0aaad);
  t = Math.imul(t ^ (t >>> 15), 0x735a2d97);
  t ^= t >>> 15;
  return (t >>> 0) / 4294967296;
}

/** The weather on a day: rolled from the season, the same every time. */
export function weatherOn(day: number): Weather {
  const odds = ODDS[seasonOf(day)];
  let roll = hashUnit(day);
  for (const w of WEATHERS) {
    roll -= odds[w];
    if (roll < 0) return w;
  }
  return "clear";
}

/** Winter, or a snowy day: everyone gets hungrier (needs.ts) and pelts are in demand. */
export function isCold(day: number): boolean {
  return seasonOf(day) === "winter" || weatherOn(day) === "snow";
}

const WEATHER_WORDS: Record<Weather, string> = {
  clear: "clear skies",
  rain: "steady rain",
  storm: "a storm, too wild for outdoor work",
  snow: "snow",
};

/** "snow, in winter" for the situation and the browser. */
export function describeWeather(day: number): string {
  return `${WEATHER_WORDS[weatherOn(day)]}, in ${seasonOf(day)}`;
}
