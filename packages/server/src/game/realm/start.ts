import { streamFor } from "../dice.js";
import { distance, neighbours } from "./generate.js";
import type { Realm, Settlement } from "./types.js";

/**
 * Where a new game starts (N25a decision 5). Nothing in the realm is the home place: the start town is picked
 * from the seed, among villages and towns that make a good first hour: an inn, a smithy, at least two roads
 * (so there is a trader, a smith and somewhere to go), preferring ones with something to do near them (a beast
 * pack, a dungeon, a gang a road away). Choosing it yourself comes with N39.
 */

/** Does this place make a good first hour? */
export function startable(s: Settlement): boolean {
  return !s.abandoned && (s.kind === "village" || s.kind === "town") && (s.buildings.inn ?? 0) > 0 && (s.buildings.smithy ?? 0) > 0 && s.roads.length >= 2;
}

/** How much there is to do near a place: villages first (a small place is a better first hour), then packs, dungeons and gangs. */
export function startScore(realm: Realm, s: Settlement): number {
  let score = s.kind === "village" ? 2 : 0;
  if (Object.values(realm.packs).some((p) => p.near === s.id && p.count >= 2)) score += 1;
  if (Object.values(realm.dungeons).some((d) => d.near === s.id)) score += 1;
  const roadAway = new Set([s.id, ...neighbours(realm, s.id).map((n) => n.id)]);
  if (Object.values(realm.factions).some((f) => f.kind === "gang" && f.dissolved === undefined && f.seat && roadAway.has(f.seat))) score += 1;
  return score;
}

/** The start town for a seed: the same realm and seed always give the same one. */
export function pickStartSite(r: Realm, seed: number): string {
  const ok = Object.values(r.settlements).filter(startable);
  const pool = ok.length > 0 ? ok : Object.values(r.settlements).filter((s) => !s.abandoned && s.kind !== "capital");
  const best = Math.max(...pool.map((s) => startScore(r, s)));
  const top = pool.filter((s) => startScore(r, s) === best).sort((a, b) => a.id.localeCompare(b.id));
  const pick = streamFor(seed, "start", "site");
  return top[Math.floor(pick() * top.length)]!.id;
}

/** Settlements nearest to `from` by map distance, nearest first (ties by id). */
export function nearestTo(realm: Realm, from: string, n = 1): string[] {
  return Object.values(realm.settlements)
    .filter((s) => s.id !== from && !s.abandoned)
    .sort((a, b) => distance(realm, from, a.id) - distance(realm, from, b.id) || a.id.localeCompare(b.id))
    .slice(0, n)
    .map((s) => s.id);
}
