import { nearby, roundPath, shortest } from "../paths.js";
import { REACH_DAYS, TRIPS } from "./config.js";
import { activeOf, athome, departureOn, go, sendersOf, take, traveller, tripRng, type TripCtx } from "./common.js";
import { config } from "../../../config.js";
import { beliefOf, peekFaith } from "../../faith/model.js";
import { isFaithFestival } from "../../faith/day.js";

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

/**
 * A faith's festival (N50 decision 7): on the season's festival day the devout of each place near a faith's holy site set out for it, to be
 * there for the rites, and come home after.
 */
export function festivalPilgrims(ctx: TripCtx): number {
  const { realm, data, day } = ctx;
  if (!config.society.belief || !isFaithFestival(day)) return 0;
  const faiths = peekFaith(realm)?.faiths ?? {};
  let sent = 0;
  for (const s of sendersOf(ctx)) {
    const rng = tripRng(ctx, s.id, "festival-pilgrims");
    const folk = athome(ctx, s.id).filter((r) => (beliefOf(r)?.devotion ?? 0) >= 0.7);
    const byFaith = new Map<string, typeof folk>();
    for (const r of folk) {
      const f = faiths[beliefOf(r)!.faith];
      if (!f?.holy || f.holy === s.id || !realm.settlements[f.holy]) continue;
      byFaith.set(f.id, [...(byFaith.get(f.id) ?? []), r]);
    }
    for (const [fid, devout] of [...byFaith].sort((a, b) => a[0].localeCompare(b[0]))) {
      const holy = faiths[fid]!.holy!;
      const out = shortest(data, s.id, holy);
      if (!out || out.length > 60) continue;
      const party = take(rng, devout, Math.min(4, devout.length)).map(traveller);
      if (party.length === 0) continue;
      const { path, index } = roundPath(out);
      go(ctx, { kind: "pilgrims", party, path, turn: { index, stay: 720 }, depart: departureOn(day, rng()), purpose: `for the festival at the holy site of ${realm.factions[fid]?.name ?? "their faith"} in ${realm.settlements[holy]!.name}` });
      sent++;
    }
  }
  return sent;
}
