import { generateRealm } from "../game/realm/generate.js";
import { MAX_TOWNSFOLK } from "../game/realm/townsfolk.js";
import type { Realm } from "../game/realm/types.js";

/**
 * A realm with about `people` townsfolk, for the storage benchmark and its test (N18): seed 1's
 * settlements with their populations scaled up (a place holds at most MAX_TOWNSFOLK, so it takes a
 * few rounds to reach the target). Not for play.
 */
export function bigRealm(people: number, seed = 1): Realm {
  const realm = generateRealm(seed, 1);
  const folk = () => Object.values(realm.settlements).reduce((a, s) => a + Math.min(MAX_TOWNSFOLK, s.population), 0);
  for (let round = 0; round < 8 && folk() < people; round++) {
    const factor = Math.min(4, (people / folk()) * 1.06);
    for (const s of Object.values(realm.settlements)) s.population = Math.round(s.population * factor);
  }
  return realm;
}

/** The place with the most townsfolk. */
export function biggestSite(realm: Realm): string {
  return Object.values(realm.settlements).sort((a, b) => b.population - a.population || a.id.localeCompare(b.id))[0]!.id;
}
