import { roundPath, shortest } from "../paths.js";
import { TRIPS } from "./config.js";
import { activeOf, athome, departureOn, go, take, traveller, tripRng, type TripCtx } from "./common.js";

/** Tax day: the coin taken from a place goes up the road with a clerk, and the lord's coffers have it when he gets there (a day later, with nobody to send). */
export function officialsTrips(ctx: TripCtx): void {
  const { realm, data, day } = ctx;
  for (const t of realm.transit) {
    if (t.journey || t.day !== day || activeOf(realm, "officials") >= TRIPS.officials.cap) continue;
    const rng = tripRng(ctx, t.from, "officials", t.to);
    if (!ctx.live.has(t.from) || ctx.store.people.count(t.from) === 0) continue;
    const clerks = athome(ctx, t.from).filter((r) => r.job === "clerk");
    const out = shortest(data, t.from, t.to);
    const clerk = take(rng, clerks, 1)[0];
    if (!clerk || !out) continue;
    const { path, index } = roundPath(out);
    const j = go(ctx, { kind: "officials", party: [traveller(clerk)], path, turn: { index, stay: 120 }, depart: departureOn(day, rng()), purpose: `carrying the taxes of ${realm.settlements[t.from]!.name} to ${realm.settlements[t.to]!.name}` });
    if (j) t.journey = j.id;
  }
}
