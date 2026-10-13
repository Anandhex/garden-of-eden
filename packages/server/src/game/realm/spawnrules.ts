import type { SpawnRule } from "../spawning.js";
import { gangOf } from "./haunts.js";
import type { Realm } from "./types.js";

/**
 * Spawn rules for a place, made from what the realm says is there (N25a decision 9), by den kind. Every map has
 * dens by kind (`square`, `gate_road`, `paddock`, `woods_edge`, `deep_woods`, `camp`, `road_ambush`,
 * `mine_mouth`), and the rules use only the kinds the place's areas have. The pack's beasts and the gang's
 * named members are put on the map by `stockHaunts`; these rules are the rest: what turns up at night, what
 * spills out of a dungeon, the horse in the paddock. Rules made in play (the director's, a quest's quarry) go in
 * `SiteState.rules`.
 */
export function rulesFor(realm: Realm | undefined, site: string): SpawnRule[] {
  const s = realm?.settlements[site];
  if (!realm || !s) return [];
  const out: SpawnRule[] = [];
  if ((s.buildings.farms ?? 0) > 0) out.push({ id: `gen_horse_${site}`, creature: "horse", count: 1, place: "paddock" });
  for (const p of Object.values(realm.packs).filter((x) => x.near === site && x.count >= 2)) {
    // A hungry pack comes to the edge of the woods by night.
    if (p.count >= p.cap * 0.5) out.push({ id: `gen_night_${p.id}`, creature: p.species, count: Math.min(3, Math.max(1, Math.round(p.count / 4))), place: "woods_edge", hours: [21, 4] });
  }
  const d = Object.values(realm.dungeons).find((x) => x.near === site);
  if (d && d.danger >= 75) out.push({ id: `gen_spill_${d.id}`, creature: "spider", count: 2, place: "mine_mouth" });
  const gang = gangOf(realm, site);
  if (gang && gang.members.length >= 3) out.push({ id: `gen_lookout_${gang.id}`, creature: "bandit", count: 1, place: "road_ambush", hours: [18, 5] });
  return out;
}
