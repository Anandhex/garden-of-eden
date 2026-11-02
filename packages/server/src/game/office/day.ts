import { config } from "../../config.js";
import type { WorldStore } from "../db.js";
import { addGrievance } from "../chatter/grievance.js";
import { parseDeath } from "../people/death.js";
import { addRenown } from "../realm/figures.js";
import { tally } from "../realm/log.js";
import { isTaxDay } from "../realm/politics.js";
import type { Realm } from "../realm/types.js";
import type { PersonRow } from "../../store/peopleStore.js";
import type { SiteDay } from "../people/conditions.js";
import { TITLES } from "../titles.js";
import { seasonDays } from "../weather.js";
import { appointDay, fillSitePosts, vacate } from "./appoint.js";
import { epithetsDay } from "./epithets.js";
import { figureDues, recruitRows } from "./recruit.js";
import { addRowRenown, fadeRenown, oweRenown } from "./repute.js";
import { RISE_FAME, raiseRow } from "./rising.js";
import { reflectedDay, supportDay } from "./support.js";
import { auditDay, skimDay, wagesDay } from "./treasury.js";
import { takeoversDay } from "./ventures.js";

/**
 * The offices' days (N69). The realm's day has two entries: `officesDay` after the economy (townsfolk members counted, posts emptied and,
 * where a place's people are a count, filled; the day's skimming; on tax days wages, audits of figures and dues, before the taxes climb the
 * chain) and `reputeDay` at its end (each season takeovers, support, challenges and epithets; each year renown fades and followers share
 * their leaders' names). Both read townsfolk rows but never change them.
 *
 * Everything that changes a townsperson's row (appointing them, asking them to join, auditing a townsperson keeper, what the realm owes
 * them, rising) is in `officesSiteDay`, run in each living place's own day after its careers, and in a lazy place's catch-up the same way:
 * "level of detail never changes outcomes" (people/world.ts). `store` is absent where people are a number (a realm-only run).
 */
export function officesDay(realm: Realm, day: number, store?: WorldStore, live: ReadonlySet<string> = new Set()): void {
  if (store) countRows(realm, store);
  vacate(realm, day, store, live);
  appointDay(realm, day, store, live);
  skimDay(realm, day);
  if (isTaxDay(day)) {
    wagesDay(realm, day, store);
    auditDay(realm, day, store);
    for (const fac of Object.values(realm.factions).sort((a, b) => a.id.localeCompare(b.id))) if (fac.dissolved === undefined) figureDues(realm, fac, day);
  }
}

export function reputeDay(realm: Realm, day: number, store?: WorldStore, live: ReadonlySet<string> = new Set()): void {
  if (day % seasonDays() === 0) {
    takeoversDay(realm, day);
    supportDay(realm, day, store);
    epithetsDay(realm, day);
  }
  if (day % config.daysPerYear === 0) {
    fadeRenown(realm);
    reflectedDay(realm, day, store);
    belongingYear(realm, day, store);
  }
  // Debts to places whose people are not living rows can never be paid: dropped.
  const owed = realm.owed;
  if (owed) {
    const payable = (site: string) => !!store && live.has(site);
    owed.renown = owed.renown.filter((x) => payable(x.site)).slice(-4000);
    owed.grievances = owed.grievances.filter((x) => payable(x.site)).slice(-400);
  }
}

/**
 * A living place's own offices day (after its careers): rows sworn to a faction that is no more follow it or go back to none; what the realm
 * owes its people is paid; its empty posts (and its seated factions') are filled from its figures and townsfolk; the factions here ask its
 * townsfolk to join; on tax days its townsfolk keepers are audited; and those whose name is known rise.
 */
export function officesSiteDay(realm: Realm, store: WorldStore, site: string, day: number): void {
  if (!realm.settlements[site] || store.people.count(site) === 0) return;
  const rows = () => (store.people.loadSite(site, "full") as PersonRow[]).filter((r) => r.death === null);
  releaseRows(realm, store, rows());
  payOwed(realm, store, site, day);
  // The posts the place's conditions say were waiting for a townsperson that day, and the factions recruiting here as they were that
  // day: not the realm as it is now, so a place worked out later does the same.
  const today = store.people.siteDay<SiteDay>(site, day);
  fillSitePosts(realm, site, day, store, today?.vacant ?? []);
  const facs = today?.factions ?? {};
  for (const [id, snap] of Object.entries(facs).sort(([a], [b]) => a.localeCompare(b))) recruitRows(realm, id, snap, site, day, store);
  skimDay(realm, day, site);
  if (isTaxDay(day)) auditDay(realm, day, store, { rows: true, site });
  riseByRepute(realm, store, rows(), day);
  leadersFromRows(realm, store, site, day);
}

/** Each faction's townsfolk members, counted from the people table (read only). */
export function countRows(realm: Realm, store: WorldStore): void {
  const sworn = store.people.swornByFaction();
  for (const f of Object.values(realm.factions)) if (f.dissolved === undefined) f.rows = 0;
  for (const [fac, n] of sworn) {
    const f = realm.factions[fac];
    if (f && f.dissolved === undefined) f.rows = n;
  }
}

/** Townsfolk of a place sworn to a faction that is no more: they follow it where it was folded, or go back to none. */
function releaseRows(realm: Realm, store: WorldStore, rows: readonly PersonRow[]): void {
  for (const r of rows) {
    if (!r.faction) continue;
    const f = realm.factions[r.faction];
    if (f && f.dissolved === undefined) continue;
    const to = f?.mergedInto && realm.factions[f.mergedInto]?.dissolved === undefined ? f.mergedInto : null;
    store.people.update(r.id, { faction: to });
    tally(realm, "rows_released");
  }
}

/** Each year in a faction of prestige 40 or more: renown +1 (decision 6). */
function belongingYear(realm: Realm, day: number, store?: WorldStore): void {
  for (const fac of Object.values(realm.factions)) {
    if (fac.dissolved !== undefined || (fac.prestige ?? 0) < 40 || fac.kind === "gang" || fac.kind === "rebels") continue;
    for (const id of fac.members) {
      const f = realm.figures[id];
      if (f?.alive) addRenown(f, 1);
    }
    if (store) for (const r of store.people.ofFaction(fac.id)) oweRenown(realm, r.id, 1, r.site, day);
  }
}

/** What the realm owes this place's people from before today: renown, and grudges (a named one, or the families of those a leader led to their deaths). */
function payOwed(realm: Realm, store: WorldStore, site: string, day: number): void {
  const owed = realm.owed;
  if (!owed) return;
  const due = (x: { site: string; day: number }) => x.site === site && x.day < day;
  for (const x of owed.renown.filter(due)) addRowRenown(realm, store, x.who, x.n);
  for (const g of owed.grievances.filter(due)) {
    if (g.who) {
      const r = store.people.get(g.who);
      if (!r || r.death === null) addGrievance(store, { who: g.who, against: g.against, cause: g.cause, weight: g.weight, day });
      continue;
    }
    // The dead are rows by the day after the fight: their families' grudges are borne then.
    for (const dead of diedOf(store, g.site, g.day, g.causes)) {
      const kin = [dead.spouse, dead.mother, dead.father, ...store.people.childrenOf(dead.id).map((c) => c.id)].filter((x): x is string => !!x);
      for (const k of kin) {
        const r = store.people.get(k);
        if (r && r.death === null && k !== g.against) addGrievance(store, { who: k, against: g.against, cause: g.cause, weight: g.weight, day });
      }
    }
  }
  owed.renown = owed.renown.filter((x) => !due(x));
  owed.grievances = owed.grievances.filter((x) => !due(x));
}

/** Rows of a place that died of a venture: their death's event matches a cause (`*` matches anything), within a year before `day`. */
function diedOf(store: WorldStore, site: string, day: number, causes: readonly string[]) {
  const pats = causes.map((c) => new RegExp(`^${c.split("*").map((x) => x.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`));
  return store.people.diedAt(site, day - config.daysPerYear).filter((r) => {
    const d = parseDeath(r.death);
    return !!d?.event && d.day <= day && pats.some((p) => p.test(d.event!));
  });
}

/** Townsfolk whose name is known (fame 25 or more), or who earned an epithet, rise to figures (decision 10): an epithet at once, a name each season. */
function riseByRepute(realm: Realm, store: WorldStore, rows: readonly PersonRow[], day: number): void {
  const season = day % seasonDays() === 0;
  for (const r of rows) {
    if (r.figure || (!r.epithet && !(season && Math.abs(r.renown ?? 0) >= RISE_FAME))) continue;
    const why = r.epithet ? `folk call them ${(TITLES as Record<string, { name: string }>)[r.epithet]?.name ?? "by a name"}` : (r.renown ?? 0) > 0 ? "their name is well spoken of" : "their name is spoken with scorn";
    raiseRow(realm, store, r.id, day, why);
  }
}

/** A faction seated here, left with townsfolk but no named members, raises the best of them here to lead it. */
function leadersFromRows(realm: Realm, store: WorldStore, site: string, day: number): void {
  for (const fac of Object.values(realm.factions).sort((a, b) => a.id.localeCompare(b.id))) {
    if (fac.dissolved !== undefined || fac.kind === "crown" || fac.seat !== site || (fac.rows ?? 0) === 0) continue;
    if (fac.members.some((m) => realm.figures[m]?.alive)) continue;
    const best = (store.people.loadSite(site, "full") as PersonRow[]).filter((r) => r.faction === fac.id && r.death === null && !r.figure && r.job !== "child").sort((a, b) => (b.renown ?? 0) - (a.renown ?? 0) || (b.skill ?? 0) - (a.skill ?? 0) || (a.id < b.id ? -1 : 1))[0];
    if (best) raiseRow(realm, store, best.id, day, `took up the lead of ${fac.name}`);
  }
}
