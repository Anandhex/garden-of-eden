import { besideRoad, type RoadData, type RoadPoint, type Territory } from "@millbrook/shared";
import { territoriesNow } from "./territories.js";
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
  /** The territory it stands for (N26F). */
  territory: Territory;
}

/**
 * Each territory as a threat with a centre and a reach (N26F step 1: threats are a wrapper over territories, kept for the
 * off-screen meetings' geometry until every caller reads territories). The reach covers the whole stretch.
 */
export function threatsOf(realm: Realm, data: RoadData): Threat[] {
  return territoriesNow(realm, data).flatMap((t) => {
    const road = data.roads.find((r) => r.id === t.road);
    if (!road) return [];
    const at = besideRoad(road, (t.t0 + t.t1) / 2, 0);
    return [{ id: t.id, kind: t.kind, at, range: Math.round((t.t1 - t.t0) / 2 + t.width), near: t.near, territory: t }];
  });
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
    const id = t.territory.owner;
    const pack = t.kind === "pack" ? realm.packs[id] : undefined;
    const gang = t.kind === "gang" ? realm.factions[id] : undefined;
    if (t.kind === "pack" && (!pack || pack.count < pack.cap * 0.6)) continue;
    if (t.kind === "gang" && (!gang || gang.dissolved !== undefined || gang.members.length === 0)) continue;
    road.met[t.id] = day;
    const foe = pack ? packFoe(realm, pack) : gangFoe(realm, gang!, rng);
    if (!foe) continue;
    lines.push(...fightOnRoad(realm, p, foe, realm.settlements[t.near]?.name ?? "the road", day, rng, town.companionPower()));
  }
  for (const k of Object.keys(road.met)) if (road.met[k]! < day - 2) delete road.met[k];
  return lines;
}
