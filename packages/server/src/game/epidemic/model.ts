import type { Realm } from "../realm/types.js";

/**
 * Epidemics (N61): the realm's outbreaks, kept in `realm.society.epidemics`. Defined here first because belief and magic (N50, N51) look for
 * someone to blame when a place is sick; N61's day (game/epidemic/day.ts) makes, spreads and ends them.
 */
export interface Outbreak {
  id: string;
  disease: string;
  /** Where it is now (a place it reached), and since when. */
  site: string;
  since: number;
  /** The place it began, and the outbreak it spread from. */
  origin: string;
  from?: string;
  /** 0..1: how many are sick there. */
  share: number;
  dead: number;
  ended?: number;
  /** Quarantined: the roads closed by the place's head. */
  quarantine?: number;
  /** Whom the place blamed. */
  blamed?: string;
}

export interface EpidemicState {
  outbreaks: Outbreak[];
  next: number;
}

export function epidemicsOf(realm: Realm): EpidemicState {
  const soc = (realm.society ??= {});
  return (soc.epidemics ??= { outbreaks: [], next: 0 }) as EpidemicState;
}
export const peekEpidemics = (realm: Realm): EpidemicState | undefined => realm.society?.epidemics as EpidemicState | undefined;

/** Places sick now (an open outbreak), with how badly. */
export function plagueAt(realm: Realm, site: string): number {
  return (peekEpidemics(realm)?.outbreaks ?? []).filter((o) => o.site === site && o.ended === undefined).reduce((a, o) => Math.max(a, o.share), 0);
}
export const sickPlaces = (realm: Realm): string[] => [...new Set((peekEpidemics(realm)?.outbreaks ?? []).filter((o) => o.ended === undefined).map((o) => o.site))].sort();
