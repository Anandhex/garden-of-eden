import { WALK_PACE, graphOf, tilesFrom, type Journey, type JourneyKind, type RoadData, type Traveller } from "@millbrook/shared";
import { streamFor, type Rng } from "../dice.js";
import { tradeTreaties } from "../realm/economy.js";
import { takenNames } from "../realm/figures.js";
import { personName, pick } from "../realm/names.js";
import type { Realm, Settlement } from "../realm/types.js";
import type { SavedWorld } from "../save.js";
import { departureOn, journeysOf, launch } from "./journeys.js";
import { takeMoves } from "./moves.js";
import { roadDataOf } from "./generateRoads.js";
import { relayOf } from "./relay.js";

/**
 * Where the people on the road come from (N26 B2): the realm's own doings. Each source is a small function that
 * looks at the realm on a day and sets journeys going, from a stream of its own, so adding one never changes
 * another's. Caravans go where trade goes; messengers carry what happened; patrols walk a crown's roads;
 * pilgrims go to temples; adventurers to the dungeons; households that left a place walk to the one they chose.
 */

/** A day's journeys are made for the day's departures; a world that jumps days makes them for each. */
export function launchDay(world: SavedWorld, day: number): number {
  const realm = world.realm;
  if (!realm) return 0;
  const data = roadDataOf(realm);
  const before = journeysOf(world).length;
  caravans(world, realm, data, day);
  patrols(world, realm, data, day);
  pilgrims(world, realm, data, day);
  adventurers(world, realm, data, day);
  messengers(world, realm, data, day);
  walkers(world, realm, data, day);
  return journeysOf(world).length - before;
}

const hand = (rng: Rng, role: string, taken: Set<string>): Traveller => {
  const gender = rng() < 0.5 ? "female" : "male";
  return { name: personName(rng, gender, taken), role, gender };
};

const active = (world: SavedWorld, kind: JourneyKind) => journeysOf(world).filter((j) => j.kind === kind && !j.ended).length;

/** Settlements a party could set out from: real places, not inns beside the road. */
const places = (realm: Realm) => Object.values(realm.settlements).filter((s) => !s.way && !s.abandoned).sort((a, b) => a.id.localeCompare(b.id));

/** A place within a few days' walk of `s` by road, picked from the nearest few. */
function nearby(data: RoadData, s: Settlement, rng: Rng, ok: (id: string) => boolean, days = 5): string | null {
  const tiles = tilesFrom(data, s.id);
  const near = [...tiles].filter(([id, t]) => id !== s.id && t <= days * 4200 && ok(id)).sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 5);
  return near.length > 0 ? pick(rng, near)[0] : null;
}

const GOODS: Array<[string, [number, number]]> = [["turnips", [20, 50]], ["bread loaf", [15, 40]], ["eggs", [20, 60]], ["wool", [8, 24]], ["ale", [8, 20]], ["horseshoe", [6, 18]], ["iron ore", [6, 16]]];

function caravans(world: SavedWorld, realm: Realm, data: RoadData, day: number): void {
  const rng = streamFor(realm.seed, "journeys", day, "caravan");
  const taken = takenNames(realm);
  for (const s of places(realm)) {
    if (!(s.kind !== "hamlet" && ((s.buildings.market ?? 0) > 0 || s.kind !== "village"))) continue;
    if (active(world, "caravan") >= 40) return;
    const p = 0.05 + 0.04 * Math.min(2, tradeTreaties(realm, s, day)) + (s.prosperity > 55 ? 0.03 : 0);
    if (rng() >= p) continue;
    const to = nearby(data, s, rng, (id) => (realm.settlements[id]!.kind !== "hamlet") && !realm.settlements[id]!.abandoned);
    if (!to) continue;
    const goods = [pick(rng, GOODS), pick(rng, GOODS)];
    const cargo: Record<string, number> = {};
    for (const [item, [lo, hi]] of goods) cargo[item] = (cargo[item] ?? 0) + lo + Math.floor(rng() * (hi - lo));
    const party = [hand(rng, "merchant", taken), ...Array.from({ length: 1 + Math.floor(rng() * 2) }, () => hand(rng, "carter", taken))];
    const guards = rng() < 0.7 ? 1 + Math.floor(rng() * 3) : 0;
    for (let i = 0; i < guards; i++) party.push(hand(rng, "guard", taken));
    const way = shortest(data, s.id, to);
    if (!way) continue;
    launch(world, data, { kind: "caravan", party, path: way, depart: departureOn(day, rng()), pace: WALK_PACE * 0.85, purpose: `carrying ${Object.keys(cargo).join(" and ")} to ${realm.settlements[to]!.name}`, cargo, guards });
  }
}

function patrols(world: SavedWorld, realm: Realm, data: RoadData, day: number): void {
  const rng = streamFor(realm.seed, "journeys", day, "patrol");
  const taken = takenNames(realm);
  for (const s of places(realm)) {
    if ((s.buildings.barracks ?? 0) <= 0 || rng() >= 0.12 || active(world, "patrol") >= 12) continue;
    const to = nearby(data, s, rng, (id) => realm.settlements[id]!.kingdom === s.kingdom, 3);
    const way = to ? shortest(data, s.id, to) : null;
    if (!way) continue;
    const n = 2 + Math.floor(rng() * 3);
    const party = [hand(rng, "captain", taken), ...Array.from({ length: n }, () => hand(rng, "guard", taken))];
    launch(world, data, { kind: "patrol", party, path: way, depart: departureOn(day, rng()), purpose: `riding the roads for ${realm.kingdoms[s.kingdom ?? ""]?.name ?? "the crown"}`, guards: n + 1 });
  }
}

function pilgrims(world: SavedWorld, realm: Realm, data: RoadData, day: number): void {
  const rng = streamFor(realm.seed, "journeys", day, "pilgrim");
  const taken = takenNames(realm);
  for (const s of places(realm)) {
    if ((s.buildings.temple ?? 0) <= 0 || rng() >= 0.05 || active(world, "pilgrims") >= 10) continue;
    const to = nearby(data, s, rng, (id) => (realm.settlements[id]!.buildings.temple ?? 0) >= 1, 6);
    const way = to ? shortest(data, s.id, to) : null;
    if (!way) continue;
    const party = Array.from({ length: 2 + Math.floor(rng() * 4) }, () => hand(rng, "pilgrim", taken));
    launch(world, data, { kind: "pilgrims", party, path: way, depart: departureOn(day, rng()), purpose: `going to pray at the temple of ${realm.settlements[to!]!.name}` });
  }
}

function adventurers(world: SavedWorld, realm: Realm, data: RoadData, day: number): void {
  const rng = streamFor(realm.seed, "journeys", day, "adventurers");
  const taken = takenNames(realm);
  const dungeons = Object.values(realm.dungeons).filter((d) => d.clearedUntil === undefined || day >= d.clearedUntil).sort((a, b) => a.id.localeCompare(b.id));
  if (dungeons.length === 0) return;
  for (const s of places(realm)) {
    if ((s.buildings.guildhall ?? 0) <= 0 || rng() >= 0.05 || active(world, "adventurers") >= 8) continue;
    const d = pick(rng, dungeons);
    if (d.near === s.id || !realm.settlements[d.near] || realm.settlements[d.near]!.abandoned) continue;
    const way = shortest(data, s.id, d.near);
    if (!way) continue;
    const party = Array.from({ length: 2 + Math.floor(rng() * 3) }, () => hand(rng, "adventurer", taken));
    launch(world, data, { kind: "adventurers", party, path: way, depart: departureOn(day, rng()), purpose: `going to delve ${d.name}`, guards: party.length });
  }
}

/** News of the day's weight is carried out along every road by messengers: one hop at a time, from the same search that tells each place when it hears. */
function messengers(world: SavedWorld, realm: Realm, data: RoadData, day: number): void {
  const taken = takenNames(realm);
  for (const n of realm.news) {
    if (n.day !== day || n.importance < 5 || !n.at) continue;
    if (journeysOf(world).some((j) => j.carries?.includes(n.id))) continue;
    const rng = streamFor(realm.seed, "journeys", day, "messenger", n.id);
    const relay = relayOf(realm, n);
    // The more it matters, the further messengers are sent: the rest hears it by word of mouth, at the same times.
    const hops = relay.hops.slice(0, Math.min(14, Math.round(n.importance * 1.5)));
    for (const h of hops) {
      const way = [h.from, h.to];
      if (!graphOf(data).get(h.from)?.some((e) => e.to === h.to)) continue;
      launch(world, data, { kind: "messenger", party: [hand(rng, "messenger", taken)], path: way, depart: h.depart, purpose: `carrying the news from ${realm.settlements[n.at]?.name ?? "afar"}`, carries: [n.id], stay: 0 });
    }
  }
}

/** Households that left a place walk the road to the one they chose. */
function walkers(world: SavedWorld, realm: Realm, data: RoadData, day: number): void {
  const rng = streamFor(realm.seed, "journeys", day, "walkers");
  for (const m of takeMoves(realm)) {
    const way = shortest(data, m.from, m.to);
    if (!way) continue;
    launch(world, data, { kind: m.kind, party: m.party.slice(0, 8), path: way, depart: departureOn(day, rng()), pace: WALK_PACE * 0.8, purpose: `leaving ${realm.settlements[m.from]?.name ?? "home"} for ${realm.settlements[m.to]?.name ?? "somewhere new"}` });
  }
}

/** The shortest road path of settlement ids between two places. */
function shortest(data: RoadData, from: string, to: string): string[] | null {
  const g = graphOf(data);
  if (from === to || !g.has(from) || !g.has(to)) return null;
  const best = new Map<string, number>([[from, 0]]);
  const prev = new Map<string, string>();
  const open = new Set([from]);
  while (open.size > 0) {
    let cur = "";
    for (const id of open) if (!cur || best.get(id)! < best.get(cur)! || (best.get(id) === best.get(cur) && id < cur)) cur = id;
    open.delete(cur);
    if (cur === to) break;
    for (const e of g.get(cur) ?? []) {
      const d = best.get(cur)! + e.len;
      if (!best.has(e.to) || d < best.get(e.to)!) {
        best.set(e.to, d);
        prev.set(e.to, cur);
        open.add(e.to);
      }
    }
  }
  if (!best.has(to)) return null;
  const path = [to];
  while (path[0] !== from) path.unshift(prev.get(path[0]!)!);
  return path;
}

export type { Journey };
