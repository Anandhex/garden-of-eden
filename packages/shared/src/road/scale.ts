/**
 * The scale of the open road (N26 decision 2). Three numbers are chosen, the rest follow, so changing
 * one recomputes the others:
 *
 * - `REAL_MINUTES_PER_DAY_WALK`: how long a day's walk takes to play (user's call, 2026-10-13: about 7).
 * - `STEPS_PER_SECOND`: how fast a player walks holding a direction key (about 10 including the round trip).
 * - `WALK_HOURS_PER_DAY`: hours of a game day a traveller spends walking (the rest is rest and meals).
 *
 * A day's walk is `DAY_WALK_UNITS` realm map units (45), and takes `7 × 60 × 10 = 4,200` steps, so a unit is
 * `TILES_PER_UNIT = 93` tiles. Those 4,200 steps pass 10 game hours (600 minutes), so a road step is a seventh
 * of a game minute (`STEPS_PER_GAME_MINUTE = 7`): shorter than a village step (a whole minute), which is how
 * the clock runs faster on the road. (The stage file once said road tiles take longer; that can't hold at the
 * same walking speed. See the plan.)
 */
export const DAY_WALK_UNITS = 45;
export const REAL_MINUTES_PER_DAY_WALK = 7;
export const STEPS_PER_SECOND = 10;
export const WALK_HOURS_PER_DAY = 10;

/** Steps in a day's walk. */
export const STEPS_PER_DAY_WALK = REAL_MINUTES_PER_DAY_WALK * 60 * STEPS_PER_SECOND;
/** Tiles in one realm map unit. */
export const TILES_PER_UNIT = Math.round(STEPS_PER_DAY_WALK / DAY_WALK_UNITS);
/** Road steps that pass one game minute. */
export const STEPS_PER_GAME_MINUTE = STEPS_PER_DAY_WALK / (WALK_HOURS_PER_DAY * 60);
/** A walker's pace, in tiles per game minute (the same number as `STEPS_PER_GAME_MINUTE`). */
export const WALK_PACE = STEPS_PER_GAME_MINUTE;

/** Tiles along a chunk's side. */
export const CHUNK = 64;
/** The hour a day's travel starts and ends (a walker walks `WALK_HOURS_PER_DAY` hours from here). */
export const DAY_STARTS = 6;
export const DAY_ENDS = DAY_STARTS + WALK_HOURS_PER_DAY;

/** The tile a realm map position is on. */
export const tileOf = (unit: number): number => Math.round(unit * TILES_PER_UNIT);
/** Realm map units a number of tiles is. */
export const unitsOf = (tiles: number): number => tiles / TILES_PER_UNIT;
/** The chunk a tile is in, and the tile within it (negative tiles wrap the right way). */
export const chunkOf = (t: number): number => Math.floor(t / CHUNK);
export const within = (t: number): number => ((t % CHUNK) + CHUNK) % CHUNK;

/** Game hours a number of tiles takes at a pace (tiles per game minute). */
export const hoursFor = (tiles: number, pace = WALK_PACE): number => tiles / pace / 60;
/** "about 5 hours", "about a day", "about 2 days": the way to say how far it is. */
export function describeWalk(tiles: number, pace = WALK_PACE): string {
  const hours = hoursFor(tiles, pace);
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} minutes`;
  if (hours < 11) return `${Math.round(hours)} hour${Math.round(hours) === 1 ? "" : "s"}`;
  const days = hours / WALK_HOURS_PER_DAY;
  if (days < 1.25) return "a day";
  if (days < 1.75) return "a day and a half";
  return `${Math.round(days)} days`;
}
