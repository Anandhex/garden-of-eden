import { config } from "../../config.js";
import type { LifeCtx, SiteStep } from "../people/step.js";
import { crimeSecrets, servantsLearn } from "./sources.js";
import { useDay } from "./use.js";

/** A place's secrets on a day (N46): hidden crimes become secrets, servants learn their masters', and demands and exposures follow. */
export function secretsSiteDay(ctx: LifeCtx, step: Pick<SiteStep, "site">, day: number): void {
  if (!config.society.secrets) return;
  crimeSecrets(ctx, step.site, day);
  if (day % 3 === 0) servantsLearn(ctx, step.site, day);
  useDay(ctx, step.site, day);
}
