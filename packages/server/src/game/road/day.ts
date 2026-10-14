import type { Journey } from "@millbrook/shared";
import { timed } from "../../metrics/timing.js";
import { arriveHouseholds, type Catcher } from "../people/migration.js";
import type { LifeCtx } from "../people/step.js";
import { roadDataOf } from "./generateRoads.js";
import { encountersDay } from "./encounters.js";
import { exchangeNews } from "./exchange.js";
import { dayStartMinute, journeysOf, pruneJourneys } from "./journeys.js";
import { caravanTrips } from "./trips/caravan.js";
import type { TripCtx } from "./trips/common.js";
import { courierTrips } from "./trips/couriers.js";
import { kinTrips } from "./trips/kin.js";
import { marketTrips } from "./trips/market.js";
import { officialsTrips } from "./trips/officials.js";
import { patrolTrips } from "./trips/patrol.js";
import { pilgrimageTrips } from "./trips/pilgrimage.js";
import { workTrips } from "./trips/work.js";

/**
 * The road's day (N26 Part E), part of everyone's day (people/world.ts `lifeDay`), realm-wide so that level of detail
 * never changes what happens: first the journeys that ended yesterday are dealt with (`roadArrivals`: the move applied, the
 * people home, the coin handed over, the delve fought), then, after the day's migrations set out, the day's trips go out
 * (`roadTrips`) and the day's stops swap news (`exchangeNews`).
 */

/** Deal with the journeys that finished before today. */
export function roadArrivals(ctx: LifeCtx, day: number, ensureCurrent: Catcher): void {
  const { realm, store } = ctx;
  const today = dayStartMinute(day);
  // Coin handed over when the clerk reaches the lord (or lost with the clerk).
  realm.transit = realm.transit.filter((t) => {
    if (!t.journey) return true;
    const j = journeysOf(realm).find((x) => x.id === t.journey);
    if (j?.ended) return false;
    if (j && !(j.turn && j.turn.arrive < today)) return true;
    const to = realm.settlements[t.to];
    if (to) to.treasury += t.amount;
    return false;
  });
  for (const j of journeysOf(realm)) {
    if (j.closed) continue;
    const over = j.ended ? Math.min(j.ended.minute, j.arrive) : j.arrive;
    if (over >= today) continue;
    j.closed = true;
    const rows = j.party.filter((t) => !realm.figures[t.person]);
    if (j.move && !j.ended) arriveHouseholds(ctx, j, day, ensureCurrent);
    else {
      // Their place has lived the days they were away (with them away) before they are home.
      for (const site of new Set(rows.map((t) => store.people.get(t.person)?.site).filter((x): x is string => !!x))) ensureCurrent(site, day - 1);
      store.people.returnHome(rows.map((t) => t.person));
    }
    for (const t of j.party) {
      const f = realm.figures[t.person];
      if (f?.away === j.id) delete f.away;
    }
  }
}

/** The day's departures, then the day's swaps of news. */
export function roadTrips(ctx: LifeCtx, day: number, live: ReadonlySet<string>, ensureCurrent: Catcher): void {
  const { realm, store } = ctx;
  const tc: TripCtx = { realm, store, data: roadDataOf(realm), day, live, ensure: (site) => ensureCurrent(site, day - 1) };
  timed("road.trips", () => {
    marketTrips(tc);
    caravanTrips(tc);
    kinTrips(tc);
    workTrips(tc);
    pilgrimageTrips(tc);
    patrolTrips(tc);
    officialsTrips(tc);
    courierTrips(tc);
  });
  timed("road.encounters", () => encountersDay(realm, store, tc.data, day, tc.ensure));
  timed("road.news", () => exchangeNews(realm, day, store, (site) => void (live.has(site) && tc.ensure(site))));
  pruneJourneys(realm, dayStartMinute(day) + 1440);
}

export type { Journey };
