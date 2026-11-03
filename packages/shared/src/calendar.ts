/**
 * The calendar (N30 decision 1), shared so the server and the browser agree on where in the year a day falls. A year is
 * `dpy` days (48 by default: four 12-day seasons, spring first); day 1 is the first day of spring of year 1. Every rule
 * reads these (a share of the year, a day of the season), never a literal day, so the length of the year can change.
 * The server's `game/weather.ts` wraps them with `config.daysPerYear` under its old names (`dayOfYear`, `seasonOf`).
 */
export const SEASON_NAMES = ["spring", "summer", "autumn", "winter"] as const;
export type SeasonName = (typeof SEASON_NAMES)[number];

/** The default length of a year in days. */
export const DAYS_PER_YEAR = 48;

/** Day of the year, 0-based (days before day 1 wrap into the year before). */
export const yearDay = (day: number, dpy = DAYS_PER_YEAR): number => (((day - 1) % dpy) + dpy) % dpy;

/** The year a day falls in: 1 for days 1..dpy. */
export const yearNumber = (day: number, dpy = DAYS_PER_YEAR): number => Math.floor((day - 1) / dpy) + 1;

/** How far through the year a day is, 0 (first day of spring) to just under 1. */
export const yearFraction = (day: number, dpy = DAYS_PER_YEAR): number => yearDay(day, dpy) / dpy;

/** Days in a season (a quarter of the year, at least one). */
export const daysInSeason = (dpy = DAYS_PER_YEAR): number => Math.max(1, Math.floor(dpy / 4));

/** The season of a day. */
export function seasonAt(day: number, dpy = DAYS_PER_YEAR): SeasonName {
  return SEASON_NAMES[Math.min(3, Math.floor((yearDay(day, dpy) * 4) / dpy))]!;
}

/** The day of its season, 1-based (the 1st, 2nd... day of spring). */
export function seasonDay(day: number, dpy = DAYS_PER_YEAR): number {
  const doy = yearDay(day, dpy);
  const start = Math.ceil((SEASON_NAMES.indexOf(seasonAt(day, dpy)) * dpy) / 4);
  return doy - start + 1;
}

/** The first day of the season `season` in the year of `day`. */
export function seasonStart(day: number, season: SeasonName, dpy = DAYS_PER_YEAR): number {
  const yearStart = (yearNumber(day, dpy) - 1) * dpy + 1;
  return yearStart + Math.ceil((SEASON_NAMES.indexOf(season) * dpy) / 4);
}

/**
 * Sunrise and sunset (minutes from midnight) on a day, at `north` (0 south edge of the realm, 1 north edge): longest at
 * midsummer (the middle of summer, three-eighths of the way through the year), shortest at midwinter, and the swing is
 * wider in the north.
 */
export function daylight(day: number, dpy = DAYS_PER_YEAR, north = 0.5): { rise: number; set: number } {
  const swing = 150 + 90 * Math.max(0, Math.min(1, north));
  const len = 720 + swing * Math.cos(2 * Math.PI * (yearFraction(day, dpy) - 0.375));
  return { rise: Math.round(720 - len / 2), set: Math.round(720 + len / 2) };
}
