import { addRenown } from "../realm/figures.js";
import type { Figure, Realm, RealmFaction } from "../realm/types.js";
import { memberCount } from "./members.js";
import type { WorldStore } from "../db.js";
import { addRowRenown, effective, reputeOf } from "./repute.js";

/**
 * Prestige: belonging raises your name (N69 decision 6). A faction's prestige, 0..100, is made of its size (log-scaled), its halls,
 * its coffer, its leader's name (signed: an infamous guildmaster drags it down) and its recent deeds (`glory`: charters, raids won,
 * dungeons cleared, wars and ventures lost). Joining gives a member prestige/10 renown once; each year in a faction of prestige 40 or
 * more gives 1. A gang's prestige is a fearsome name, not a good one: its members lose renown for the weak it preys on (ventures.ts).
 */
export function prestigeOf(realm: Realm, fac: RealmFaction): number {
  const n = memberCount(realm, fac);
  const size = Math.min(40, 14 * Math.log(1 + n));
  const halls = Math.min(20, 4 * fac.branches.length);
  const coin = Math.min(15, fac.wealth / 400);
  const lead = fac.leader ? realm.figures[fac.leader] : undefined;
  const name = lead?.alive ? effective(lead) * 0.2 : 0;
  return Math.max(0, Math.min(100, Math.round(size + halls + coin + name + (fac.glory ?? 0))));
}

/** A deed of the faction, for or against its prestige (fading a season at a time). */
export function addGlory(fac: RealmFaction, n: number): void {
  fac.glory = Math.max(-30, Math.min(30, (fac.glory ?? 0) + n));
}

/** A season passes: deeds fade. */
export function fadeGlory(fac: RealmFaction): void {
  const g = fac.glory ?? 0;
  if (g !== 0) fac.glory = Math.abs(g) <= 2 ? 0 : g - Math.sign(g) * 2;
}

/** Renown for joining (once per faction): prestige/10. Gangs and rebels give none. */
export const joiningRenown = (fac: Pick<RealmFaction, "prestige" | "kind">): number => (fac.kind === "gang" || fac.kind === "rebels" ? 0 : Math.round((fac.prestige ?? 0) / 10));

/** A figure joined: their share of the faction's name, once. */
export function figureJoined(f: Figure, fac: RealmFaction): number {
  const r = reputeOf(f);
  if ((r.joined ?? []).includes(fac.id)) return 0;
  r.joined = [...(r.joined ?? []), fac.id].slice(-8);
  const n = joiningRenown(fac);
  if (n > 0) addRenown(f, n);
  return n;
}

/** A townsperson joined (in their place's day): their share of the faction's name. */
export function rowJoined(realm: Realm, store: WorldStore, person: string, fac: RealmFaction): number {
  const n = joiningRenown(fac);
  addRowRenown(realm, store, person, n);
  return n;
}
