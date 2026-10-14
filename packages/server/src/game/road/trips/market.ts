import { WALK_PACE } from "@millbrook/shared";
import { MARKET_EVERY, marketOffsetOf } from "../../events-calendar.js";
import { DAY_TILES, placesWithin, roundPath, shortest } from "../paths.js";
import { REACH_DAYS, TRIPS } from "./config.js";
import { activeOf, athome, departureOn, go, sendersOf, take, traveller, tripRng, type TripCtx } from "./common.js";

/** Farmers and craftspeople of the villages and hamlets who walk to the market of the liege town on its market day, and come home. */
const SELLERS = new Set(["farmer", "stallholder", "weaver", "potter", "baker", "cobbler", "tailor"]);

export function marketTrips(ctx: TripCtx): void {
  const { realm, data, day } = ctx;
  for (const s of sendersOf(ctx)) {
    if (s.kind !== "hamlet" && s.kind !== "village") continue;
    if (activeOf(realm, "market") >= TRIPS.market.cap) return;
    const ok = (id: string) => ["town", "city", "capital"].includes(realm.settlements[id]?.kind ?? "") && !realm.settlements[id]!.abandoned;
    const liege = s.liege && ok(s.liege) ? s.liege : null;
    const near = placesWithin(data, s, REACH_DAYS.market, ok);
    const pick1 = liege ? near.find(([id]) => id === liege) ?? near[0] : near[0];
    const dest = pick1?.[0];
    // They set out so as to get there on its market day.
    const walk = pick1 ? Math.ceil(pick1[1] / (DAY_TILES * 0.85)) : 0;
    if (!dest || (day + walk + marketOffsetOf(dest)) % MARKET_EVERY !== 0) continue;
    const rng = tripRng(ctx, s.id, "market");
    const sellers = athome(ctx, s.id).filter((r) => SELLERS.has(r.job));
    if (sellers.length === 0) continue;
    const n = Math.min(TRIPS.market.party, Math.max(1, Math.round(sellers.length / 8)));
    const out = shortest(data, s.id, dest);
    if (!out) continue;
    const { path, index } = roundPath(out);
    go(ctx, { kind: "market", party: take(rng, sellers, n).map(traveller), path, turn: { index, stay: 360 }, depart: departureOn(day, rng()), pace: WALK_PACE * 0.9, purpose: `going to market in ${realm.settlements[dest]!.name}` });
  }
}
