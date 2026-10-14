import { WALK_PACE } from "@millbrook/shared";
import { tradeTreaties } from "../../realm/economy.js";
import { pick } from "../../realm/names.js";
import { nearby, roundPath, shortest } from "../paths.js";
import { REACH_DAYS, TRIPS } from "./config.js";
import { activeOf, athome, departureOn, go, sendersOf, take, traveller, tripRng, type TripCtx } from "./common.js";

const GOODS: Array<[string, [number, number]]> = [["turnips", [20, 50]], ["bread loaf", [15, 40]], ["eggs", [20, 60]], ["wool", [8, 24]], ["ale", [8, 20]], ["horseshoe", [6, 18]], ["iron ore", [6, 16]]];

/** A merchant of a town, with carters of the same town and guards hired from it, taking goods where trade goes and coming back. */
export function caravanTrips(ctx: TripCtx): void {
  const { realm, data, day } = ctx;
  for (const s of sendersOf(ctx)) {
    if (s.kind === "hamlet" || (s.kind === "village" && (s.buildings.market ?? 0) <= 0)) continue;
    if (activeOf(realm, "caravan") >= TRIPS.caravan.cap) return;
    const rng = tripRng(ctx, s.id, "caravan");
    const p = TRIPS.caravan.chance + 0.04 * Math.min(2, tradeTreaties(realm, s, day)) + (s.prosperity > 55 ? 0.03 : 0);
    if (rng() >= p) continue;
    const folk = athome(ctx, s.id);
    const merchants = folk.filter((r) => r.job === "merchant" || r.job === "stallholder");
    if (merchants.length === 0) continue;
    const to = nearby(data, s, rng, (id) => realm.settlements[id]!.kind !== "hamlet" && !realm.settlements[id]!.abandoned, REACH_DAYS.caravan);
    const out = to ? shortest(data, s.id, to) : null;
    if (!to || !out) continue;
    const merchant = take(rng, merchants, 1)[0]!;
    const carters = take(rng, folk.filter((r) => r.id !== merchant.id && (r.job === "porter" || r.job === "labourer")), 1 + Math.floor(rng() * 2));
    const guards = rng() < 0.7 ? take(rng, folk.filter((r) => r.job === "guard"), 1 + Math.floor(rng() * 3)) : [];
    const cargo: Record<string, number> = {};
    for (const [item, [lo, hi]] of [pick(rng, GOODS), pick(rng, GOODS)]) cargo[item] = (cargo[item] ?? 0) + lo + Math.floor(rng() * (hi - lo));
    const { path, index } = roundPath(out);
    go(ctx, { kind: "caravan", party: [merchant, ...carters, ...guards].slice(0, TRIPS.caravan.party).map(traveller), path, turn: { index, stay: 480 }, depart: departureOn(day, rng()), pace: WALK_PACE * 0.85, purpose: `carrying ${Object.keys(cargo).join(" and ")} to ${realm.settlements[to]!.name}`, cargo, guards: guards.length });
  }
}
