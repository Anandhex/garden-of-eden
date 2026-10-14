import type { PersonRow } from "../../../store/peopleStore.js";
import { lineageOf } from "../../people/index.js";
import { placesWithin, roundPath, shortest } from "../paths.js";
import { REACH_DAYS, TRIPS } from "./config.js";
import { activeOf, athome, departureOn, go, sendersOf, take, traveller, tripRng, type TripCtx } from "./common.js";

/** Someone with family living in another place goes to see them for a few days, and comes home. */
export function kinTrips(ctx: TripCtx): void {
  const { realm, data, day, store } = ctx;
  for (const s of sendersOf(ctx)) {
    if (activeOf(realm, "kin") >= TRIPS.kin.cap) return;
    const rng = tripRng(ctx, s.id, "kin");
    if (rng() >= TRIPS.kin.chance) continue;
    const who = take(rng, athome(ctx, s.id), 1)[0];
    if (!who) continue;
    const l = lineageOf(store.people, who);
    const reach = new Set(placesWithin(data, s, REACH_DAYS.kin, () => true).map(([id]) => id));
    const there = [l.spouse, l.mother, l.father, ...l.children, ...l.siblings].filter((k): k is PersonRow => !!k && k.site !== s.id && reach.has(k.site));
    // Their place is brought up to date before we ask whether they are alive and at home.
    for (const k of there) ctx.ensure(k.site);
    const kin = there.map((k) => store.people.get(k.id)).filter((k): k is PersonRow => !!k && k.death === null && k.away === null);
    const target = kin[0];
    const out = target ? shortest(data, s.id, target.site) : null;
    if (!target || !out) continue;
    const { path, index } = roundPath(out);
    const days = 2 + Math.floor(rng() * 3);
    go(ctx, { kind: "kin", party: [traveller(who)], path, turn: { index, stay: days * 1440 }, depart: departureOn(day, rng()), visit: target.id, purpose: `visiting ${target.name} in ${realm.settlements[target.site]?.name ?? "another place"}` });
  }
}
