import { config } from "../../config.js";
import { join, leave } from "../realm/factions.js";
import { addDeed, addRenown, titled } from "../realm/figures.js";
import { neighbours } from "../realm/generate.js";
import { transfer } from "../realm/ledger.js";
import { realmNews, tally } from "../realm/log.js";
import type { Realm, RealmFaction } from "../realm/types.js";
import { seasonDays } from "../weather.js";
import { CHARTERED, memberCount, minMembers } from "./members.js";
import { addGlory } from "./prestige.js";

/**
 * Guilds need people (N69 decision 5). A guild, association, order or cult is founded as a **charter**: it has no income and no
 * halls, and its founder and warden recruit at double the rate, until `need` members have pledged (it is **chartered**: news, the
 * founder's renown, its posts filled) or its year runs out first (it **fails**: its members go back to none, the founder loses
 * renown 6, and the coin goes back to them). Gangs and rebels skip the charter (a band of two is a band).
 *
 * Once chartered, a guild-like faction must keep its minimum: under it for a whole season, it **folds**: into the strongest of its
 * trade within two roads (its members join, its halls pass, its old leader becomes one of the members), or it dissolves.
 */

/** Days a charter has to gather its members: a year. */
export const CHARTER_DAYS = (): number => config.daysPerYear;

/** Begin a charter for a new faction of a kind that needs one. */
export function startCharter(realm: Realm, fac: RealmFaction, day: number): void {
  if (!CHARTERED.has(fac.kind)) return;
  fac.charter = { until: day + CHARTER_DAYS(), need: minMembers(realm, fac) };
}

/** A charter's day: chartered when enough have pledged, failed when its year is out. Returns what happened. */
export function charterDay(realm: Realm, fac: RealmFaction, day: number): "chartered" | "failed" | null {
  const c = fac.charter;
  if (!c || fac.dissolved !== undefined) return null;
  const n = memberCount(realm, fac);
  const founder = fac.leader ? realm.figures[fac.leader] : undefined;
  const seat = fac.seat ? realm.settlements[fac.seat] : undefined;
  if (n >= c.need) {
    delete fac.charter;
    addGlory(fac, 5);
    tally(realm, "chartered");
    if (founder) {
      addRenown(founder, 4);
      addDeed(founder, `saw ${fac.name} chartered`);
    }
    realmNews(realm, day, fac.seat, "faction", `${cap(fac.name)} is chartered${seat ? ` in ${seat.name}` : ""}: ${n} have pledged to it${founder ? ` under ${titled(founder)}` : ""}.`, 4, [fac.name, ...(seat ? [seat.name] : []), ...(founder ? [founder.name] : [])], { why: `${n} members, of the ${c.need} a charter needs` });
    return "chartered";
  }
  if (day < c.until) return null;
  // The year is out: those who pledged go back to none, the coin to the founder.
  for (const id of [...fac.members]) {
    const f = realm.figures[id];
    if (f) leave(realm, f);
  }
  if (founder) {
    transfer(realm, `f:${fac.id}`, `p:${founder.id}`, fac.wealth, "a failed charter", undefined, day);
    addRenown(founder, -6);
    addDeed(founder, `could not get ${fac.name} chartered`);
  }
  fac.dissolved = day;
  fac.leader = null;
  tally(realm, "charter_failed");
  const trade = fac.trade ? `${fac.trade.replace(/s$/, "")}s` : "others";
  realmNews(realm, day, fac.seat, "faction", `${cap(fac.name)} never got its charter: ${founder ? `${founder.name} could not find ${c.need} ${trade} to stand with them` : "too few would stand with it"}.`, 3, [fac.name, ...(founder ? [founder.name] : [])], { why: `${n} of the ${c.need} members a charter needs, in a year` });
  return "failed";
}

/** Years a place waits after a charter of a trade failed there before anyone tries again: those who would not pledge have not changed. */
export const RETRY_YEARS = 2;

/** Did a charter of this trade fail in this place lately? (A failed charter is dissolved with its charter still on it.) */
export function charterFailedLately(realm: Realm, seat: string, trade: string, day: number): boolean {
  return Object.values(realm.factions).some((f) => f.seat === seat && f.trade === trade && f.charter && f.dissolved !== undefined && day - f.dissolved < RETRY_YEARS * config.daysPerYear);
}

/** A chartered guild-like faction under its minimum: noted the day it fell under, folded after a season. Returns the faction it folded into, "dissolved", or null. */
export function minimumDay(realm: Realm, fac: RealmFaction, day: number): RealmFaction | "dissolved" | null {
  if (fac.dissolved !== undefined || fac.charter || !CHARTERED.has(fac.kind)) return null;
  const n = memberCount(realm, fac);
  if (n >= minMembers(realm, fac)) {
    delete fac.belowMin;
    return null;
  }
  fac.belowMin ??= day;
  if (day - fac.belowMin < seasonDays()) return null;
  const into = foldTarget(realm, fac);
  if (into) {
    merge(realm, fac, into, day);
    return into;
  }
  for (const id of [...fac.members]) {
    const f = realm.figures[id];
    if (f) leave(realm, f);
  }
  fac.dissolved = day;
  fac.leader = null;
  tally(realm, "folded");
  realmNews(realm, day, fac.seat, "faction", `${cap(fac.name)} has folded: too few were left to keep it going.`, 3, [fac.name], { why: `${n} members, under the ${minMembers(realm, fac)} it needs, for a season` });
  return "dissolved";
}

/** The strongest faction of the same kind and trade within two roads of its seat, if any. */
function foldTarget(realm: Realm, fac: RealmFaction): RealmFaction | null {
  if (!fac.seat) return null;
  const near = new Set<string>([fac.seat]);
  for (const a of neighbours(realm, fac.seat)) {
    near.add(a.id);
    for (const b of neighbours(realm, a.id)) near.add(b.id);
  }
  const options = Object.values(realm.factions).filter((o) => o.id !== fac.id && o.dissolved === undefined && !o.charter && o.kind === fac.kind && o.trade === fac.trade && [o.seat, ...o.branches].some((b) => b !== null && near.has(b)));
  options.sort((a, b) => memberCount(realm, b) - memberCount(realm, a) || b.wealth - a.wealth || a.id.localeCompare(b.id));
  return options[0] ?? null;
}

/**
 * One faction folds into another: its figures join, its halls pass, its coin goes with them; its stances go, but its enemies stay
 * enemies of the merged one at half; its townsfolk follow (the store's side moves their rows: `mergedInto`).
 */
export function merge(realm: Realm, fac: RealmFaction, into: RealmFaction, day: number, why = "too few were left to keep it going"): void {
  const old = fac.leader ? realm.figures[fac.leader] : undefined;
  for (const id of [...fac.members]) {
    const f = realm.figures[id];
    if (f?.alive) join(realm, f, into);
  }
  into.branches = [...new Set([...into.branches, ...fac.branches])];
  transfer(realm, `f:${fac.id}`, `f:${into.id}`, fac.wealth, "a takeover", undefined, day);
  for (const [other, s] of Object.entries(fac.stances)) {
    if (other === into.id || s >= 0) continue;
    into.stances[other] = Math.min(into.stances[other] ?? 0, Math.round(s / 2));
    const o = realm.factions[other];
    if (o) o.stances[into.id] = Math.min(o.stances[into.id] ?? 0, Math.round(s / 2));
  }
  into.rows = (into.rows ?? 0) + (fac.rows ?? 0);
  fac.rows = 0;
  fac.mergedInto = into.id;
  fac.dissolved = day;
  fac.leader = null;
  fac.members = [];
  tally(realm, "merged");
  realmNews(realm, day, fac.seat, "faction", `${cap(fac.name)} has been folded into ${into.name}${old ? `; ${old.name} serves under ${into.leader ? (realm.figures[into.leader]?.name ?? "its master") : "its masters"} now` : ""}.`, 4, [fac.name, into.name, ...(old ? [old.name] : [])], { why });
}

const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1);
