import { config } from "../../config.js";
import { timed } from "../../metrics/timing.js";
import { realmDay } from "../realm/day.js";
import type { CasualtyOrder, Realm } from "../realm/types.js";
import { conditionsOf, KEEP_DAYS } from "./conditions.js";
import { reviewDay } from "./outlook.js";
import { lazySites, liveSites } from "./live.js";
import { riseDay, syncRisen } from "./rising.js";
import { migrationDay } from "./migration.js";
import { chatterDay } from "../chatter/day.js";
import { gossipDay } from "../gossip/day.js";
import { choiceDay } from "../choice/day.js";
import { ambitionDay } from "../ambition/day.js";
import { roadArrivals, roadTrips } from "../road/day.js";
import { stepSite, type LifeCtx, type SiteStep } from "./step.js";

/**
 * A day of everyone's lives (N25), run after the realm's day. In this order:
 *
 * 1. The conditions of every place are written for the day (`site_days`), and the day's casualty orders
 *    (raids, battles, beasts) go into them.
 * 2. The road (road/day.ts): journeys that ended are dealt with; moves between places, by household (people/migration.ts), set out as
 *    journeys and arrive days later; the day's trips go out and swap news.
 * 3. Each live place's people live the day (people/step.ts), then are reviewed (people/outlook.ts), then meet and quarrel and seek
 *    revenge (chatter/day.ts, N37), then gossip (gossip/day.ts), then choose what to do with the day (choice/day.ts, N38), then their careers move (ambition/day.ts, N40) — all of them in a batch (coarse), with the
 *    ones the player is watching at full detail (their events keep their hours to be shown), except places
 *    marked lazy, which are only worked out when something needs them (`catchUp`): the same function over the
 *    same stored conditions, so the result is the same.
 * 4. Each place's population is set to the count of its living people.
 *
 * "Level of detail never changes outcomes" is the rule this module keeps. `peopleDay` is the same code
 * whether it runs on the day or years later.
 */

export { KEEP_DAYS };

export interface LifeOptions {
  /** Places with living people (default: `liveSites(realm)`). */
  live?: ReadonlySet<string>;
  /** Places worked out only on demand (default: `lazySites()`). */
  lazy?: ReadonlySet<string>;
  /** Places the player is watching (or pins): worked out first, and their events keep their hour. */
  watched?: ReadonlySet<string>;
}

export interface DayLife {
  day: number;
  steps: SiteStep[];
  moved: number;
}

/** Bring a place's people up to `toDay`, one day after another (a year at a time is timed against `yearCatchupMs`). */
export function catchUp(ctx: LifeCtx, site: string, toDay: number): SiteStep[] {
  const people = ctx.store.people;
  const out: SiteStep[] = [];
  let seq = people.seq(site);
  // A place never worked out starts from where it is: its people have no past to live.
  if (seq.stepped === 0) seq = people.setSeq(site, { stepped: toDay });
  while (seq.stepped < toDay) {
    const from = seq.stepped;
    const to = Math.min(toDay, from + config.daysPerYear);
    timed("catchup.year", () => {
      for (let d = from + 1; d <= to; d++) {
        const step = stepSite(ctx, site, d);
        riseDay(ctx, step, d);
        reviewDay(ctx, step, d);
        chatterDay(ctx, step, d);
        gossipDay(ctx, step, d);
        choiceDay(ctx, step, d);
        ambitionDay(ctx, step, d);
        out.push(step);
      }
    });
    seq = people.seq(site);
  }
  return out;
}

/** Write the day's conditions for every place, taking the casualty orders for the places that are live. */
function writeConditions(ctx: LifeCtx, day: number, live: ReadonlySet<string>): void {
  const { realm, store } = ctx;
  const orders = new Map<string, CasualtyOrder[]>();
  const rest: CasualtyOrder[] = [];
  for (const o of realm.casualties) {
    if (live.has(o.site)) orders.set(o.site, [...(orders.get(o.site) ?? []), o]);
    else rest.push(o);
  }
  realm.casualties = rest;
  for (const s of Object.values(realm.settlements).sort((a, b) => a.id.localeCompare(b.id))) {
    if (!live.has(s.id)) continue;
    store.people.putSiteDay(s.id, day, conditionsOf(realm, s, day, orders.get(s.id) ?? []));
  }
}

/** The people's day for the whole realm. Call after `realmDay(realm, day)`. */
export function lifeDay(ctx: LifeCtx, day: number, opts: LifeOptions = {}): DayLife {
  const { realm, store } = ctx;
  const live = opts.live ?? liveSites(realm);
  const lazy = opts.lazy ?? lazySites();
  const watched = opts.watched ?? new Set<string>();
  const result: DayLife = { day, steps: [], moved: 0 };
  if (live.size === 0) return result;
  timed("people.day", () => {
    writeConditions(ctx, day, live);
    const ensureCurrent = (site: string, toDay: number) => void catchUp(ctx, site, toDay);
    // A place that has never been worked out starts yesterday, so that today is its first day.
    for (const id of live) if (store.people.seq(id).stepped === 0) store.people.setSeq(id, { stepped: day - 1 });
    // The road (N26 Part E): yesterday's journeys end, then households set out, then the day's trips go and swap news.
    timed("road.arrivals", () => roadArrivals(ctx, day, ensureCurrent));
    result.moved = timed("people.moves", () => migrationDay(ctx, day, live, ensureCurrent));
    roadTrips(ctx, day, live, ensureCurrent);
    const sites = [...live].filter((id) => realm.settlements[id]).sort((a, b) => Number(watched.has(b)) - Number(watched.has(a)) || a.localeCompare(b));
    for (const id of sites) {
      if (lazy.has(id) && !watched.has(id)) continue;
      // Anything behind is brought up to yesterday first (a place that was lazy, or newly live).
      const behind = catchUp(ctx, id, day - 1);
      const step = stepSite(ctx, id, day);
      result.steps.push(...behind, step);
      riseDay(ctx, step, day);
      reviewDay(ctx, step, day);
      // The place the player is watching talks and quarrels hour by hour as the day passes (town.ts), not all at once.
      chatterDay(ctx, step, day, { hourly: watched.has(id) });
      gossipDay(ctx, step, day, { hourly: watched.has(id) });
      choiceDay(ctx, step, day);
      ambitionDay(ctx, step, day);
      // A place whose people were never rolled keeps its number (ensureLivePeople makes them first).
      if (store.people.count(id) > 0) realm.settlements[id]!.population = store.people.livingCount(id);
    }
    syncRisen(ctx, day);
    // Conditions older than this are no longer needed by any place.
    const behind = Math.min(day, ...[...live].map((id) => store.people.seq(id).stepped));
    store.people.pruneSiteDays(Math.min(day - KEEP_DAYS, behind));
  });
  return result;
}

/** Work out a lazy place now, and set its population. Returns what happened. */
export function settle(ctx: LifeCtx, site: string, day: number): SiteStep[] {
  const steps = catchUp(ctx, site, day);
  const s = ctx.realm.settlements[site];
  if (s) s.population = ctx.store.people.livingCount(site);
  return steps;
}

/**
 * Run the realm and its people from the realm's last day to `toDay`: the realm's day, then everyone's.
 * What a simulation, a test and a long skip all use. Lazy places are left behind unless `settleLazy`.
 */
export function advanceWorld(realm: Realm, store: LifeCtx["store"], toDay: number, opts: LifeOptions & { settleLazy?: boolean } = {}): DayLife[] {
  const ctx: LifeCtx = { realm, store };
  const live = opts.live ?? liveSites(realm);
  const out: DayLife[] = [];
  for (let d = realm.day + 1; d <= toDay; d++) {
    realmDay(realm, d, undefined, { live });
    out.push(lifeDay(ctx, d, { ...opts, live }));
  }
  if (opts.settleLazy) for (const id of [...live].sort()) if (realm.settlements[id]) settle(ctx, id, toDay);
  return out;
}
