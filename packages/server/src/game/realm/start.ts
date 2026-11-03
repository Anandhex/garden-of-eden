import { streamFor } from "../dice.js";
import { distance, neighbours } from "./generate.js";
import type { Realm, Settlement } from "./types.js";

/**
 * Where a new game starts (N25a decision 5). Nothing in the realm is the home place: the start town is picked
 * from the seed, among villages and towns that make a good first hour: an inn, a smithy, at least two roads
 * (so there is a trader, a smith and somewhere to go), preferring ones with something to do near them (a beast
 * pack, a dungeon, a gang a road away). A new game may choose it instead (N39: `startCandidates`).
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

export interface StartChoice {
  id: string;
  name: string;
  kind: string;
  kingdom: string | null;
  /** One line about it, from what is true of it: what it is, where, and what's near it. */
  line: string;
}

/**
 * The towns a new game offers (N39 decision 1): the best of `startScore` among the startable, spread across kingdoms (the best of
 * each kingdom first, then the next best overall), at most `n`. The seed's own pick is always among them.
 */
export function startCandidates(realm: Realm, n = 5): StartChoice[] {
  const ok = Object.values(realm.settlements).filter(startable);
  const pool = ok.length > 0 ? ok : Object.values(realm.settlements).filter((s) => !s.abandoned && s.kind !== "capital" && !s.way);
  const order = [...pool].sort((a, b) => startScore(realm, b) - startScore(realm, a) || a.id.localeCompare(b.id));
  const out: Settlement[] = [];
  const seedPick = realm.settlements[pickStartSite(realm, realm.seed)];
  if (seedPick) out.push(seedPick);
  // The best of each kingdom, so the choice spans the realm's laws (a free kingdom, a slave kingdom...).
  for (const k of [...new Set(order.map((s) => s.kingdom ?? ""))].sort()) {
    const best = order.find((s) => (s.kingdom ?? "") === k && !out.includes(s));
    if (best && out.length < n) out.push(best);
  }
  for (const s of order) if (out.length < n && !out.includes(s)) out.push(s);
  return out.map((s) => ({ id: s.id, name: s.name, kind: s.kind, kingdom: s.kingdom ? (realm.kingdoms[s.kingdom]?.name ?? null) : null, line: startLine(realm, s) }));
}

const TERRAIN_WORDS: Record<string, string> = { valley: "in a valley", plains: "on the plains", hills: "in the hills", forest: "by the forest", coast: "on the coast", marsh: "by the marshes" };

/** "A mining village in the hills of Aldmark; wolves have been at the flocks." From what is true of the place. */
export function startLine(realm: Realm, s: Settlement): string {
  const what = (s.buildings.mine ?? 0) > 0 ? `A mining ${s.kind}` : (s.buildings.market ?? 0) > 0 ? `A market ${s.kind}` : (s.buildings.farms ?? 0) > 0 ? `A farming ${s.kind}` : `A ${s.kind}`;
  const k = s.kingdom ? realm.kingdoms[s.kingdom] : null;
  const where = `${TERRAIN_WORDS[s.terrain] ?? `in the ${s.terrain}`}${k ? ` of ${k.name}` : ", free of any crown"}`;
  const laws = k?.laws.slavery ? " Slaves are kept there." : k?.laws.serfdom ? " Its farmers are serfs." : "";
  const pack = Object.values(realm.packs).find((p) => p.near === s.id && p.count >= 2);
  const dungeon = Object.values(realm.dungeons).find((d) => d.near === s.id);
  const gang = Object.values(realm.factions).find((f) => f.kind === "gang" && f.dissolved === undefined && f.seat && (f.seat === s.id || s.roads.includes(f.seat)));
  const near = pack ? `${pack.species}s have been at the flocks` : gang ? `${gang.name} keep to the roads nearby` : dungeon ? `${dungeon.name} lies close by` : "a quiet place";
  return `${what} ${where}; ${near}.${laws}`;
}

/** Settlements nearest to `from` by map distance, nearest first (ties by id). */
export function nearestTo(realm: Realm, from: string, n = 1): string[] {
  return Object.values(realm.settlements)
    .filter((s) => s.id !== from && !s.abandoned)
    .sort((a, b) => distance(realm, from, a.id) - distance(realm, from, b.id) || a.id.localeCompare(b.id))
    .slice(0, n)
    .map((s) => s.id);
}
