import { tilesFrom } from "@millbrook/shared";
import { roundPath, shortest } from "../paths.js";
import { journeysOf } from "../journeys.js";
import { COURIER_IMPORTANCE, TRIPS } from "./config.js";
import { activeOf, athome, departureOn, go, sendersOf, take, traveller, tripRng, type TripCtx } from "./common.js";

const MAX_STOPS = 6;
const FRESH_DAYS = 14;

/**
 * Great news (importance 7 and up) that has reached a capital or a city is sent on by its crown couriers to the
 * towns of the kingdom that have not heard: a tour of the nearest few, out and back. A king's death reaches every town of the kingdom
 * within days, even on quiet roads (Part E decision 6).
 */
export function courierTrips(ctx: TripCtx): void {
  const { realm, data, day } = ctx;
  for (const post of sendersOf(ctx)) {
    if (post.kind !== "capital" && post.kind !== "city") continue;
    const known = realm.heard[post.id] ?? {};
    for (const n of realm.news) {
      if (n.importance < COURIER_IMPORTANCE || n.day < day - FRESH_DAYS || !known[n.id]) continue;
      if (activeOf(realm, "courier") >= TRIPS.courier.cap) return;
      const active = journeysOf(realm).filter((j) => j.kind === "courier" && !j.closed && j.carries?.some((c) => c.id === n.id) && j.path[0] === post.id);
      if (active.length >= 2) continue;
      const covered = new Set(active.flatMap((j) => j.path));
      const dist = tilesFrom(data, post.id);
      const todo = Object.values(realm.settlements)
        .filter((s) => !s.way && !s.abandoned && s.kingdom === post.kingdom && s.id !== post.id && !realm.heard[s.id]?.[n.id] && !covered.has(s.id) && dist.has(s.id))
        .sort((a, b) => dist.get(a.id)! - dist.get(b.id)! || a.id.localeCompare(b.id))
        .slice(0, MAX_STOPS);
      if (todo.length === 0) continue;
      const rng = tripRng(ctx, post.id, "courier", n.id);
      const courier = take(rng, athome(ctx, post.id).filter((r) => r.job === "courier"), 1)[0];
      if (!courier) continue;
      // The tour: nearest first, each leg by the shortest road from the last.
      const out = [post.id];
      let from = post.id;
      for (const s of todo) {
        const leg = shortest(data, from, s.id);
        if (!leg) continue;
        out.push(...leg.slice(1));
        from = s.id;
      }
      if (out.length < 2) continue;
      const { path, index } = roundPath(out);
      go(ctx, { kind: "courier", party: [traveller(courier)], path, turn: { index, stay: 20 }, depart: departureOn(day, rng()), carries: [{ id: n.id, from: post.id }], purpose: `carrying great news from ${post.name} to the towns of ${realm.kingdoms[post.kingdom ?? ""]?.name ?? "the crown"}` });
    }
  }
}
