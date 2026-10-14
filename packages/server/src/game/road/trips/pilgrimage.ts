import { nearby, roundPath, shortest } from "../paths.js";
import { REACH_DAYS, TRIPS } from "./config.js";
import { activeOf, athome, departureOn, go, sendersOf, take, traveller, tripRng, type TripCtx } from "./common.js";

/** Clergy and devout commoners of a place with a temple go to pray at a bigger one, and come home. */
export function pilgrimageTrips(ctx: TripCtx): void {
  const { realm, data, day } = ctx;
  for (const s of sendersOf(ctx)) {
    if ((s.buildings.temple ?? 0) <= 0 || activeOf(realm, "pilgrims") >= TRIPS.pilgrims.cap) continue;
    const rng = tripRng(ctx, s.id, "pilgrims");
    if (rng() >= TRIPS.pilgrims.chance) continue;
    const to = nearby(data, s, rng, (id) => (realm.settlements[id]!.buildings.temple ?? 0) > (s.buildings.temple ?? 0) && !realm.settlements[id]!.abandoned, REACH_DAYS.pilgrims);
    const out = to ? shortest(data, s.id, to) : null;
    if (!to || !out) continue;
    const folk = athome(ctx, s.id);
    const clergy = folk.filter((r) => r.cls === "clergy" && r.job !== "priest");
    const devout = folk.filter((r) => r.cls === "commoner");
    const party = [...take(rng, clergy, 1), ...take(rng, devout, 1 + Math.floor(rng() * (TRIPS.pilgrims.party - 1)))].map(traveller);
    if (party.length === 0) continue;
    const { path, index } = roundPath(out);
    go(ctx, { kind: "pilgrims", party, path, turn: { index, stay: 600 }, depart: departureOn(day, rng()), purpose: `going to pray at the temple of ${realm.settlements[to]!.name}` });
  }
}
