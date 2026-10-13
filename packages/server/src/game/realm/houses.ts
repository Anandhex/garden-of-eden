import type { Realm, Settlement, SettlementKind } from "./types.js";

/**
 * Houses are buildings, not a formula (N25). Each place's house count is fixed when its realm is made (the
 * old formula on the population of the day), the map draws exactly that many, and it only grows when the
 * place builds more (`housesDay` in game/realm/economy.ts, when its people crowd). A person's `home` is an
 * index into the map's buildings, so a map must not shift under them as the population moves.
 */

/** People a house holds comfortably, by size of place. */
export const PER_HOUSE: Record<SettlementKind, number> = { hamlet: 4, village: 5, town: 8, city: 11, capital: 13 };

/** The houses a place of this size starts with. */
export function startingHouses(kind: SettlementKind, population: number): number {
  return Math.max(2, Math.ceil(population / (PER_HOUSE[kind] ?? 5)));
}

/** The houses a settlement has: frozen in the realm, or (an older realm) what the old formula gives. */
export function housesOf(s: Pick<Settlement, "houses" | "kind" | "population">): number {
  return s.houses ?? startingHouses(s.kind, s.population);
}

/** People per house against what the place is built for: 1 is comfortable, 1.5 is packed. */
export function crowding(s: Pick<Settlement, "houses" | "kind" | "population">): number {
  return s.population / (housesOf(s) * PER_HOUSE[s.kind]);
}

/** Give every settlement its house count, once (a new realm, or an older save). */
export function freezeHouses(realm: Pick<Realm, "settlements">): void {
  for (const s of Object.values(realm.settlements)) if (s.houses === undefined) s.houses = startingHouses(s.kind, s.population);
}
