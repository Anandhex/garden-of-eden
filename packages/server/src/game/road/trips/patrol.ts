import { nearby, roundPath, shortest } from "../paths.js";
import { REACH_DAYS, TRIPS } from "./config.js";
import { activeOf, athome, departureOn, go, sendersOf, take, traveller, tripRng, type TripCtx } from "./common.js";

/** The town's guards ride the crown's roads in their own kingdom, out and back. */
export function patrolTrips(ctx: TripCtx): void {
  const { realm, data, day } = ctx;
  for (const s of sendersOf(ctx)) {
    if ((s.buildings.barracks ?? 0) <= 0 || activeOf(realm, "patrol") >= TRIPS.patrol.cap) continue;
    const rng = tripRng(ctx, s.id, "patrol");
    if (rng() >= TRIPS.patrol.chance) continue;
    const to = nearby(data, s, rng, (id) => realm.settlements[id]!.kingdom === s.kingdom && !realm.settlements[id]!.abandoned, REACH_DAYS.patrol);
    const out = to ? shortest(data, s.id, to) : null;
    const guards = athome(ctx, s.id).filter((r) => r.job === "guard");
    if (!to || !out || guards.length < 3) continue;
    const party = take(rng, guards, Math.min(TRIPS.patrol.party, 2 + Math.floor(rng() * 3)));
    const { path, index } = roundPath(out);
    go(ctx, { kind: "patrol", party: party.map(traveller), path, turn: { index, stay: 90 }, depart: departureOn(day, rng()), purpose: `riding the roads for ${realm.kingdoms[s.kingdom ?? ""]?.name ?? "the crown"}`, guards: party.length });
  }
}
