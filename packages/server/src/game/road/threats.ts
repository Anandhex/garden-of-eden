import { graphOf, pointAt, seedOf, type RoadData, type RoadPoint } from "@millbrook/shared";
import type { Rng } from "../dice.js";
import { fightOnRoad, gangFoe, packFoe } from "../realm/travel.js";
import type { Realm } from "../realm/types.js";
import type { Town } from "../town.js";
import { landOf } from "./ground.js";

/**
 * What waits on the road (N26 decision 8): the old two rolls a trip are gone. A pack's hunting ground is a place near
 * the settlement whose woods it roams; a gang's ambush is a bend on the road out of its seat; walking into
 * their range starts the same fight (fought in code like a delve, with the player's companions). One is met once a day.
 * Where they are is fixed by the realm's ids, so they are in the same place every time and for every walker.
 */
export interface Threat {
  id: string;
  kind: "pack" | "gang";
  at: RoadPoint;
  range: number;
  /** The settlement they are near. */
  near: string;
}

const cache = new WeakMap<Realm, { key: string; threats: Threat[] }>();

/** Where each live pack's ground and each gang's ambush is. */
export function threatsOf(realm: Realm, data: RoadData): Threat[] {
  const key = `${Object.keys(realm.packs).length}:${Object.keys(realm.factions).length}`;
  const hit = cache.get(realm);
  if (hit && hit.key === key) return hit.threats;
  const g = graphOf(data);
  /** A point on a road leaving `site`, `d` tiles from it, `side` tiles to one side. */
  const outFrom = (site: string, d: number, side: number): RoadPoint | null => {
    const edge = [...(g.get(site) ?? [])].sort((a, b) => a.road.localeCompare(b.road))[0];
    const road = edge && data.roads.find((r) => r.id === edge.road);
    if (!edge || !road) return null;
    const along = Math.min(road.length * 0.6, d);
    const cum = [0];
    for (let i = 1; i < road.pts.length; i++) cum.push(cum[i - 1]! + Math.hypot(road.pts[i]!.x - road.pts[i - 1]!.x, road.pts[i]!.y - road.pts[i - 1]!.y));
    const t = edge.rev ? road.length - along : along;
    const a = pointAt(road.pts, cum, t - 3);
    const b = pointAt(road.pts, cum, t + 3);
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const on = pointAt(road.pts, cum, t);
    return { x: Math.round(on.x + (-(b.y - a.y) / len) * side), y: Math.round(on.y + ((b.x - a.x) / len) * side) };
  };
  const threats: Threat[] = [];
  for (const p of Object.values(realm.packs)) {
    const at = outFrom(p.near, 500 + (seedOf(p.id) % 1200), 26);
    if (at) threats.push({ id: `pack:${p.id}`, kind: "pack", at, range: 20, near: p.near });
  }
  for (const f of Object.values(realm.factions)) {
    if (f.kind !== "gang" || !f.seat) continue;
    const at = outFrom(f.seat, 350 + (seedOf(f.id) % 900), 0);
    if (at) threats.push({ id: `gang:${f.id}`, kind: "gang", at, range: 11, near: f.seat });
  }
  cache.set(realm, { key, threats });
  return threats;
}

/** The player has come near something that waits: it's faced, and what happened is returned. */
export function meetThreats(town: Town, rng: Rng): string[] {
  const realm = town.world.realm!;
  const p = town.world.player;
  const road = p.road!;
  const day = town.world.day;
  const lines: string[] = [];
  for (const t of threatsOf(realm, landOf(realm).data)) {
    if (Math.abs(t.at.x - road.x) > t.range || Math.abs(t.at.y - road.y) > t.range || Math.hypot(t.at.x - road.x, t.at.y - road.y) > t.range) continue;
    if (road.met[t.id] === day) continue;
    // Alive and strong enough to be out.
    const id = t.id.slice(t.id.indexOf(":") + 1);
    const pack = t.kind === "pack" ? realm.packs[id] : undefined;
    const gang = t.kind === "gang" ? realm.factions[id] : undefined;
    if (t.kind === "pack" && (!pack || pack.count < pack.cap * 0.6)) continue;
    if (t.kind === "gang" && (!gang || gang.dissolved !== undefined || gang.members.length === 0)) continue;
    road.met[t.id] = day;
    const foe = pack ? packFoe(realm, pack) : gangFoe(realm, gang!);
    lines.push(...fightOnRoad(realm, p, foe, realm.settlements[t.near]?.name ?? "the road", day, rng, town.companionPower()));
  }
  for (const k of Object.keys(road.met)) if (road.met[k]! < day - 2) delete road.met[k];
  return lines;
}
