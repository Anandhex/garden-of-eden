import { atWar, FAMINE, UNSAFE_DAYS } from "../realm/economy.js";
import { crowding, housesOf } from "../realm/houses.js";
import type { CasualtyOrder, Realm, Settlement } from "../realm/types.js";
import { factionDays, type FactionDay } from "../office/recruit.js";
import { vacantAt } from "../office/appoint.js";
import { seasonOf } from "../weather.js";

/**
 * A place's conditions on a day (N25): the part of the realm's state the lives of its people depend on.
 * `realmDay` runs first; then one of these is written per place per day (the `site_days` table), and both a
 * day's step and a lazy catch-up read them, so a day worked out later gives the result it would have
 * given on the day. Everything a step needs from outside the place's own people is in here.
 */
export interface SiteDay {
  food: number;
  prosperity: number;
  /** 0 (fed) to 1 (starving). */
  famine: number;
  /** People per house against what the place is built for. */
  crowding: number;
  houses: number;
  /** Raided in the last two days, at war, wolves at the door: what unsettles a place. */
  raided: boolean;
  atWar: boolean;
  besieged: boolean;
  beasts: boolean;
  /** 0..1; illness spreading (N61 fills it). */
  plague: number;
  /** Deaths ordered by fights on this day, for the step to pick the dead among the place's people. */
  casualties: Array<Pick<CasualtyOrder, "cause" | "count" | "event" | "killer">>;
  /** The factions that recruit here (seated or with a branch), as they stood on the day (N69): what asking townsfolk to join reads. */
  factions?: Record<string, FactionDay>;
  /** The posts of the place and its seated factions standing empty after the realm's day (N69): what its own day fills from its townsfolk. */
  vacant?: string[];
  /** The season (N30), and how the last harvest went (this year's once judged on the first day of winter, else last year's). */
  season?: string;
  harvest?: "poor" | "normal" | "good";
  /** The place's mood (N36): the six numbers, 0..100. */
  mood?: { grief: number; fear: number; anger: number; joy: number; hope: number; unease: number };
}

/** Days of conditions kept behind the day (the admin chart, a margin for catching up, and a review's look back), more for lazy places that are behind. */
export const KEEP_DAYS = 60;

/** A place with nothing on record for a day (a place newly alive, or a day pruned): ordinary times. */
export const NEUTRAL_DAY: SiteDay = { food: 50, prosperity: 50, famine: 0, crowding: 1, houses: 1, raided: false, atWar: false, besieged: false, beasts: false, plague: 0, casualties: [] };

const round = (n: number) => Math.round(n * 100) / 100;

/** The conditions of a settlement on a day, from the realm as it stands after the day's realm step. */
export function conditionsOf(realm: Realm, s: Settlement, day: number, casualties: CasualtyOrder[] = []): SiteDay {
  const war = atWar(realm, s);
  const recentlyRaided = s.lastRaided !== undefined && day - s.lastRaided <= 2;
  return {
    food: round(s.food),
    prosperity: round(s.prosperity),
    // A floor on the hunger of a famine, so a place just under the line still loses people.
    famine: s.food < FAMINE ? round(0.35 + (0.65 * (FAMINE - s.food)) / FAMINE) : 0,
    crowding: round(crowding(s)),
    houses: housesOf(s),
    raided: s.lastRaided !== undefined && day - s.lastRaided <= UNSAFE_DAYS,
    atWar: war,
    besieged: war && recentlyRaided,
    beasts: Object.values(realm.packs).some((p) => p.near === s.id && p.count >= p.cap * 0.7),
    plague: 0,
    casualties: casualties.map((c) => ({ cause: c.cause, count: c.count, event: c.event, ...(c.killer ? { killer: c.killer } : {}) })),
    factions: factionDays(realm, s.id),
    vacant: vacantAt(realm, s.id),
    season: seasonOf(day),
    harvest: s.harvest?.yield ?? s.harvest?.last ?? "normal",
    ...(s.mood ? { mood: { grief: s.mood.grief ?? 0, fear: s.mood.fear ?? 0, anger: s.mood.anger ?? 0, joy: s.mood.joy ?? 0, hope: s.mood.hope ?? 0, unease: s.mood.unease ?? 0 } } : {}),
  };
}
