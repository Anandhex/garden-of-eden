/**
 * How much of the realm is on the road, in one table (N26 Part E, decision 4). Each trip kind has a daily chance for
 * a place that could send one, a cap on how many such journeys are out at once, and the most people in one party.
 * N22's bounds (road/bounds.ts) keep the roads neither empty nor clogged; tune here.
 */
export interface TripConfig {
  /** Chance a place that qualifies sends one on a given day. */
  chance: number;
  /** Most of this kind out at once. */
  cap: number;
  /** Most people in a party. */
  party: number;
}

export const TRIPS = {
  market: { chance: 1, cap: 90, party: 5 },
  caravan: { chance: 0.07, cap: 40, party: 7 },
  kin: { chance: 0.04, cap: 40, party: 1 },
  work: { chance: 0.03, cap: 20, party: 2 },
  pilgrims: { chance: 0.04, cap: 12, party: 5 },
  patrol: { chance: 0.12, cap: 14, party: 5 },
  officials: { chance: 1, cap: 40, party: 1 },
  courier: { chance: 1, cap: 30, party: 1 },
} satisfies Record<string, TripConfig>;

/** News this important is sent out by crown couriers. */
export const COURIER_IMPORTANCE = 7;
/** Longest trips, in days of walking one way, by kind. */
export const REACH_DAYS = { market: 3, caravan: 5, kin: 4, work: 4, pilgrims: 6, patrol: 3 } as const;
