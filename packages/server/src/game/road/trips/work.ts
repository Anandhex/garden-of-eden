import { crowding } from "../../realm/houses.js";
import { placesWithin, roundPath, shortest } from "../paths.js";
import { REACH_DAYS, TRIPS } from "./config.js";
import { activeOf, athome, departureOn, go, sendersOf, take, traveller, tripRng, type TripCtx } from "./common.js";

const IDLE = new Set(["labourer", "porter", "beggar", "apprentice", "washer"]);

/** In a poor or crowded place, grown labourers go looking for work in a richer town. Some find it and stay (a migration); the rest come home. */
export function workTrips(ctx: TripCtx): void {
  const { realm, data, day } = ctx;
  for (const s of sendersOf(ctx)) {
    if (activeOf(realm, "work") >= TRIPS.work.cap) return;
    if (s.prosperity >= 50 && crowding(s) <= 1) continue;
    const rng = tripRng(ctx, s.id, "work");
    if (rng() >= TRIPS.work.chance) continue;
    const idle = athome(ctx, s.id).filter((r) => IDLE.has(r.job) && r.master_id === null);
    const better = placesWithin(data, s, REACH_DAYS.work, (id) => {
      const o = realm.settlements[id]!;
      return o.kind !== "hamlet" && !o.abandoned && o.prosperity > s.prosperity + 10 && o.food > 35;
    })[0];
    const out = better ? shortest(data, s.id, better[0]) : null;
    if (idle.length === 0 || !better || !out) continue;
    const party = take(rng, idle, 1 + Math.floor(rng() * TRIPS.work.party)).map(traveller);
    const dest = realm.settlements[better[0]]!;
    // Found work: they stay. Otherwise they look about for a day or two and come back.
    if (rng() < 0.3) go(ctx, { kind: "work", party, path: out, depart: departureOn(day, rng()), move: { from: s.id, to: dest.id, everyone: false }, purpose: `going to find work in ${dest.name}` });
    else {
      const { path, index } = roundPath(out);
      go(ctx, { kind: "work", party, path, turn: { index, stay: (1 + Math.floor(rng() * 2)) * 1440 }, depart: departureOn(day, rng()), purpose: `looking for work in ${dest.name}` });
    }
  }
}
