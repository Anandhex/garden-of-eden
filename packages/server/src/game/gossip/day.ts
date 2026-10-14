import { config } from "../../config.js";
import { timed } from "../../metrics/timing.js";
import type { LifeCtx, SiteStep } from "../people/step.js";
import { seedDay } from "./seed.js";
import { spreadSite } from "./spread.js";

/** The share of a day's talk that the day's step does in the place the player is watching; the rest is done by the hour (town.ts). */
export const WATCHED_SHARE = 0.5;

/**
 * A place's day of gossip (N33), after its people's day (people/world.ts calls this next to the other things a day brings). The
 * day's deaths and local news are known to the people they touch, then everyone who knows something tells a few others. The place the
 * player is watching skips the daily spread: its talk runs by the hour (spreadSite with an hour) as the day passes.
 */
export function gossipDay(ctx: LifeCtx, step: SiteStep, day: number, opts: { hourly?: boolean } = {}): void {
  if (!config.gossip) return;
  timed("gossip.day", () => {
    seedDay(ctx, step, day);
    spreadSite(ctx, step.site, day, opts.hourly ? { share: WATCHED_SHARE } : {});
  });
}
