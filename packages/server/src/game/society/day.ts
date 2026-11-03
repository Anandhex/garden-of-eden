import type { Rng } from "../dice.js";
import type { WorldStore } from "../db.js";
import { timed } from "../../metrics/timing.js";
import type { LifeCtx, SiteStep } from "../people/step.js";
import { policyRealmDay } from "../realm/policy.js";
import type { Realm } from "../realm/types.js";
import { figureEstatesDay } from "../kin/estate.js";
import { kinSiteDay } from "../kin/day.js";
import { secretsSiteDay } from "../secrets/day.js";
import { courtDaySecrets } from "../secrets/court.js";
import { foundGuilds } from "../thieves/guilds.js";
import { crackdownsDay } from "../thieves/crime.js";
import { thievesRealmDay, thievesSiteDay } from "../thieves/day.js";
import { faithRealmDay, faithSiteDay } from "../faith/day.js";
import { magicRealmDay, magicSiteDay } from "../magic/day.js";
import { rumoursDay } from "../shaping/rumours.js";
import { cultureRealmDay } from "../culture/day.js";
import { peoplesRealmDay, residentsSiteDay } from "../peoples/day.js";
import { armiesRealmDay, soldiersSiteDay } from "../war/armies.js";

/**
 * Stages 4–6 (N45–N64): society, power and a changing world, hooked into the day in two places.
 *
 * - `societySiteDay` is a place's own day, run after its careers and offices, both when the day is lived and in a lazy catch-up (the same
 *   function over the same stored rows and conditions, so the result is the same): families, secrets, crime, trials, faith, magic...
 * - `societyRealmDay` is the realm's day, run after the realm's own steps and before the mood is worked out: laws, estates of figures,
 *   spies, armies, unrest, outbreaks, disasters, exploration, new kingdoms.
 */
export function societySiteDay(ctx: LifeCtx, step: SiteStep, day: number): void {
  timed("society.kin", () => kinSiteDay(ctx, step, day));
  timed("society.secrets", () => secretsSiteDay(ctx, step, day));
  timed("society.thieves", () => thievesSiteDay(ctx, step.site, day));
  timed("society.faith", () => faithSiteDay(ctx, step, day));
  timed("society.magic", () => magicSiteDay(ctx, step, day));
  timed("society.residents", () => residentsSiteDay(ctx, step.site, day));
  timed("society.soldiers", () => soldiersSiteDay(ctx, step, day));
  if (ctx.store.records.count("fabrication") > 0) timed("society.rumours", () => rumoursDay(ctx, step.site, day));
}

export interface SocietyRealmOptions {
  store?: WorldStore;
  live?: ReadonlySet<string>;
}

export function societyRealmDay(realm: Realm, day: number, rng: (step: string) => Rng, opts: SocietyRealmOptions = {}): void {
  void rng;
  timed("society.policy", () => policyRealmDay(realm, day));
  timed("society.cultures", () => cultureRealmDay(realm, day));
  timed("society.peoples", () => peoplesRealmDay(realm, day));
  timed("society.armies", () => armiesRealmDay(realm, day));
  timed("society.estates", () => figureEstatesDay(realm, day, opts.store));
  timed("society.faith", () => faithRealmDay(realm, day));
  timed("society.magic", () => magicRealmDay(realm, day));
  timed("society.court", () => courtDaySecrets(realm, day));
  timed("society.guilds", () => foundGuilds(realm, day));
  timed("society.crackdowns", () => crackdownsDay(realm, opts.store, day));
  if (opts.store) timed("society.smuggling", () => thievesRealmDay({ realm, store: opts.store! }, day));
}
