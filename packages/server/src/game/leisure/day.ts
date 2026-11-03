import { config } from "../../config.js";
import { timed } from "../../metrics/timing.js";
import type { LifeCtx, SiteStep } from "../people/step.js";
import { contestDay } from "./contests.js";
import { tavernNight } from "./tavern.js";

/**
 * A place's leisure in its day (N41): tonight's tables at the inn, and yesterday's contest day if there was one (so a festival's games are
 * settled whole, with everyone who came). The place the player is in plays its tavern night by the hour as the evening comes (town.ts).
 */
export function leisureDay(ctx: LifeCtx, step: Pick<SiteStep, "site">, day: number, opts: { hourly?: boolean } = {}): void {
  if (!config.leisure) return;
  timed("leisure.day", () => {
    ctx.store.social.transaction(() => {
      if (!opts.hourly) tavernNight(ctx, step.site, day);
      contestDay(ctx, step.site, day - 1, day);
    });
  });
}
