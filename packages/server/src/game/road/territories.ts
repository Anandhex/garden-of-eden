import { inTerritory, territoriesOf, type RoadData, type RoadPoint, type Territory } from "@millbrook/shared";
import type { Realm } from "../realm/types.js";
import { roadDataOf } from "./generateRoads.js";

/**
 * The realm's territories now (N26F decision 3): the living packs' and gangs' stretches of road, worked out from their ids
 * and the road data (shared code) and cached while the packs and gangs stay as they are. A wiped-out pack, or a gang with
 * nobody left, has none. Used by the player's walk (road/hostiles.ts), off-screen meetings (road/encounters.ts), and the
 * admin view.
 */
const cache = new WeakMap<Realm, { key: string; ts: Territory[] }>();

/** What changes a territory: who is alive and where gangs sit. */
function keyOf(realm: Realm): string {
  const packs = Object.values(realm.packs).map((p) => `${p.id}:${p.near}:${p.count > 0 ? 1 : 0}:${p.count >= Math.ceil(p.cap * 0.6) ? 1 : 0}`);
  const gangs = Object.values(realm.factions).filter((f) => f.kind === "gang").map((f) => `${f.id}:${f.seat}:${f.dissolved ?? ""}:${f.members.length > 0 ? 1 : 0}`);
  return `${packs.join(",")}|${gangs.join(",")}`;
}

export function territoriesNow(realm: Realm, data: RoadData = roadDataOf(realm)): Territory[] {
  const key = keyOf(realm);
  const hit = cache.get(realm);
  if (hit && hit.key === key) return hit.ts;
  const ts = territoriesOf(
    {
      packs: Object.values(realm.packs).filter((p) => realm.settlements[p.near]).map((p) => ({ id: p.id, species: p.species, near: p.near, count: p.count, cap: p.cap })),
      gangs: Object.values(realm.factions)
        .filter((f) => f.kind === "gang" && f.dissolved === undefined && f.seat && f.members.some((m) => realm.figures[m]?.alive))
        .map((f) => ({ id: f.id, seat: f.seat! })),
    },
    data,
  );
  cache.set(realm, { key, ts });
  return ts;
}

/** The territories a tile is inside, with how far along each. */
export function territoriesAt(realm: Realm, data: RoadData, at: RoadPoint): Array<{ t: Territory; along: number }> {
  const out: Array<{ t: Territory; along: number }> = [];
  for (const t of territoriesNow(realm, data)) {
    const along = inTerritory(data, t, at);
    if (along !== null) out.push({ t, along });
  }
  return out;
}

/** The pack or gang behind a territory, if it's still about. */
export function ownerOf(realm: Realm, t: Territory) {
  return t.kind === "pack" ? { pack: realm.packs[t.owner], gang: undefined } : { pack: undefined, gang: realm.factions[t.owner] };
}
