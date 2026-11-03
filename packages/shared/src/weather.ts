import { DAYS_PER_YEAR, daysInSeason, seasonAt, seasonDay, type SeasonName } from "./calendar.js";
import { hash2 } from "./road/noise.js";

/**
 * Regional weather (N30 decision 2): still a pure hash of the realm's seed and the day, so it is the same every time it
 * is asked for, on the server and in the browser, and needs nothing in the save. Each point has a climate from where it
 * lies (the north of the realm is colder, hills colder still, the coast and marsh wetter) and the day's roll mixes a
 * realm-wide part with the part of its region (a 4×3 grid over the realm map), so neighbouring places share the weather
 * on most days and a storm can lie over one region and not the next.
 */
export const WEATHER_KINDS = ["clear", "rain", "storm", "snow", "fog"] as const;
export type WeatherKind = (typeof WEATHER_KINDS)[number];

/** The realm map's size in map units (game/realm/generate.ts REALM_W × REALM_H). */
export const REALM_MAP = { w: 1000, h: 700 } as const;

export interface Climate {
  /** 0 (the warm south) to 1 (the cold north, high up). */
  cold: number;
  /** 0 (dry) to 1 (wet: coast and marsh). */
  wet: number;
  /** Fog lies here on autumn mornings (marsh, coast, river valleys). */
  foggy: boolean;
}

/** The climate of a point on the realm map (map units) with the terrain around it. */
export function climateOf(pos: { x: number; y: number }, terrain = "plains"): Climate {
  const north = 1 - Math.max(0, Math.min(1, pos.y / REALM_MAP.h));
  const high = terrain === "hills" ? 0.25 : 0;
  return {
    cold: Math.max(0, Math.min(1, north * 0.85 + high)),
    wet: terrain === "coast" || terrain === "marsh" ? 0.8 : terrain === "forest" || terrain === "valley" ? 0.5 : 0.35,
    foggy: terrain === "marsh" || terrain === "coast" || terrain === "valley",
  };
}

/** 0..1 from a hash of the seed, the day and a cell (-1 for the realm-wide roll). */
const unit = (seed: number, day: number, cell: number, salt: number) => hash2(seed ^ salt, day, cell) / 4294967296;

/** The region a point is in: a cell of a 4×3 grid over the realm map. */
export const regionOf = (pos: { x: number; y: number }): number => Math.max(0, Math.min(3, Math.floor((pos.x / REALM_MAP.w) * 4))) + 4 * Math.max(0, Math.min(2, Math.floor((pos.y / REALM_MAP.h) * 3)));

/** The realm's base odds by season (the weather before region and climate: N6's, tuned against everything since). */
const BASE: Record<SeasonName, Record<WeatherKind, number>> = {
  spring: { clear: 0.55, rain: 0.35, storm: 0.1, snow: 0, fog: 0 },
  summer: { clear: 0.75, rain: 0.15, storm: 0.1, snow: 0, fog: 0 },
  autumn: { clear: 0.45, rain: 0.4, storm: 0.15, snow: 0, fog: 0 },
  winter: { clear: 0.4, rain: 0.05, storm: 0.1, snow: 0.45, fog: 0 },
};

/** How far a region leans the realm's roll (either way, half of this). */
const REGION_LEAN = 0.24;

/** A number in [0, 1) that depends only on `n` (a small integer hash): the base roll of a day. */
export function hashUnit(n: number): number {
  let t = Math.imul(n, 0x9e3779b9) >>> 0;
  t = Math.imul(t ^ (t >>> 16), 0x21f0aaad);
  t = Math.imul(t ^ (t >>> 15), 0x735a2d97);
  t ^= t >>> 15;
  return (t >>> 0) / 4294967296;
}

/** Pick from odds with a roll in [0, 1). */
function pick(odds: Record<WeatherKind, number>, roll: number): WeatherKind {
  let r = roll;
  for (const w of WEATHER_KINDS) {
    r -= odds[w];
    if (r < 0) return w;
  }
  return "clear";
}

/** The realm-wide weather of a day, before region and climate (the old one-weather-for-all roll). */
export const baseWeather = (day: number, dpy = DAYS_PER_YEAR): WeatherKind => pick(BASE[seasonAt(day, dpy)], hashUnit(day));

type Override = (day: number, pos: { x: number; y: number } | null) => WeatherKind | undefined;
let override: Override | null = null;
/** For tests: force the weather (return undefined to leave a day alone). `null` clears it. */
export function overrideWeather(fn: Override | null): void {
  override = fn;
}

/**
 * The weather at a point on a day. `seed` is the realm's; `dpy` the length of the year. The realm's base roll leant a
 * little by the region; then the climate: in the cold north rain falls as snow in winter, at
 * the end of autumn and the start of spring; in the warm south snow falls as rain; fog lies on clear autumn and winter
 * days by marsh, coast and river valley.
 */
export function weatherAt(seed: number, day: number, pos: { x: number; y: number }, terrain = "plains", dpy = DAYS_PER_YEAR): WeatherKind {
  const forced = override?.(day, pos);
  if (forced) return forced;
  const c = climateOf(pos, terrain);
  const season = seasonAt(day, dpy);
  const region = regionOf(pos);
  // The region's own lean on the realm's roll: near a border between two kinds of day (fair and wet, wet and stormy)
  // one region gets one and its neighbour the other.
  const roll = Math.min(0.999999, Math.max(0, hashUnit(day) + (unit(seed, day, region, 0x5eed) - 0.5) * REGION_LEAN));
  let w = pick(BASE[season], roll);
  const sd = seasonDay(day, dpy);
  const spd = daysInSeason(dpy);
  if (w === "snow" && c.cold < 0.35) w = "rain";
  else if (w === "rain" && c.cold > 0.7 && (season === "winter" || (season === "autumn" && sd > spd - Math.max(1, Math.round(spd / 4))) || (season === "spring" && sd <= Math.max(1, Math.round(spd / 6))))) w = "snow";
  if (w === "clear" && c.foggy && (season === "autumn" || season === "winter") && unit(seed, day, region, 0xf06) < 0.25) w = "fog";
  return w;
}

/** Did it snow at this point on any of the `days` days up to and including `day` (for snow on the ground)? */
export function snowedWithin(seed: number, day: number, pos: { x: number; y: number }, terrain = "plains", days = 2, dpy = DAYS_PER_YEAR): boolean {
  for (let d = day; d > day - days; d--) if (weatherAt(seed, d, pos, terrain, dpy) === "snow") return true;
  return false;
}

/** The forced weather for a day with no position (the server's old `weatherOn`), if a test set one. */
export const forcedWeather = (day: number): WeatherKind | undefined => override?.(day, null);
