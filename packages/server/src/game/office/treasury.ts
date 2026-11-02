import type { WorldStore } from "../db.js";
import { addGrievance } from "../chatter/grievance.js";
import { streamFor } from "../dice.js";
import { income } from "../realm/economy.js";
import { addDeed, addRenown, titled } from "../realm/figures.js";
import { balanceOf, mint, sink, transfer } from "../realm/ledger.js";
import { realmNews, tally } from "../realm/log.js";
import type { Figure, Office, Realm } from "../realm/types.js";
import { config } from "../../config.js";
import { CROWD, dismiss, TOWN } from "./appoint.js";
import { placeEvent } from "./rising.js";
import { awardEpithet } from "./epithets.js";
import { memberCount } from "./members.js";
import { cofferMod, factionInst, HEAD_WAGE, instName, officeFor, officesOf, placeInst, postDef, postWords, WAGE_SCALE } from "./posts.js";
import { rowDues } from "./recruit.js";
import { addRowRenown, owedOf, reputeOf } from "./repute.js";

/**
 * The treasury and the people who keep it (N69 decisions 3 and 4). Wages are paid first on tax day: officers, then the head. An officer
 * unpaid two periods running is out of heart (a figure's loyalty falls), three and they quit, with a grudge against the head, and a
 * head who leaves their officers unpaid loses renown 2 a period. A greedy keeper of the coffers skims a share of the day's income: the
 * true books show it as `stolen`, the public ones as upkeep. On tax day the head (or the magistrate) may audit the books: a thief found
 * out is dismissed, loses renown 20 (below zero if they had little), pays back what they have, is called the Thief, and the head bears
 * them a grudge; the head who punished them has a deed toward being called the Just.
 */

/** Wage a tax period of a post (or the head's), by the size of the place or faction. */
export function wageOf(realm: Realm, inst: string, postId: string | "head"): number {
  const id = inst.slice(2);
  // A place pays by how many it has to run (a hamlet's elder is paid in eggs; a capital's chancellor is not); a faction by its size.
  const s = realm.settlements[id];
  const scale = inst.startsWith("s:") ? Math.max(0.3, Math.min(WAGE_SCALE.capital, Math.sqrt((s?.population ?? 0) / 100))) : 1 + memberCount(realm, realm.factions[id] ?? { members: [], rows: 0 }) / 20;
  const base = postId === "head" ? HEAD_WAGE : (postDef(realm, inst, postId)?.wage ?? 0);
  return Math.round(base * scale);
}

/** Pay an officer from the institution's coffers: to a figure's purse, or (a townsperson or a nameless one) out of the books with their work. */
function payWage(realm: Realm, inst: string, holder: string, row: boolean, amount: number, words: string, day: number): number {
  if (amount <= 0) return 0;
  if (row || holder === CROWD || holder === TOWN) return sink(realm, inst, amount, `wages to the ${words}`, undefined, day);
  return transfer(realm, inst, `p:${holder}`, amount, `wages to the ${words}`, undefined, day);
}

/** The head of an institution (a figure), if alive. */
export function headOf(realm: Realm, inst: string): Figure | undefined {
  const id = inst.slice(2);
  const lead = inst.startsWith("s:") ? realm.settlements[id]?.leader : realm.factions[id]?.leader;
  const f = lead ? realm.figures[lead] : undefined;
  return f?.alive ? f : undefined;
}

/** Tax day: every institution pays its officers, then its head. Returns the officers who quit. */
export function wagesDay(realm: Realm, day: number, store?: WorldStore): Office[] {
  const quit: Office[] = [];
  const insts = [
    ...Object.values(realm.settlements).filter((s) => !s.abandoned && !s.fallen && !s.way).map((s) => placeInst(s.id)),
    ...Object.values(realm.factions).filter((f) => f.dissolved === undefined && !f.charter && f.kind !== "crown").map((f) => factionInst(f.id)),
  ].sort();
  for (const inst of insts) {
    const head = headOf(realm, inst);
    const offices = officesOf(realm, inst).filter((o) => o.holder);
    const total = offices.reduce((a, o) => a + wageOf(realm, inst, o.post), 0) + (head ? wageOf(realm, inst, "head") : 0);
    const before = balanceOf(realm, inst);
    let short = false;
    for (const o of offices) {
      const want = wageOf(realm, inst, o.post);
      const paid = payWage(realm, inst, o.holder!, !!o.row, want, postDef(realm, inst, o.post)?.title ?? o.post, day);
      if (paid >= want) {
        o.unpaid = 0;
        continue;
      }
      short = true;
      o.unpaid += 1;
      const f = o.row ? undefined : realm.figures[o.holder!];
      if (o.unpaid >= 2 && f) f.loyalty = Math.max(0, Math.round((f.loyalty - 0.1) * 100) / 100);
      if (o.unpaid >= 3 && o.holder !== CROWD && o.holder !== TOWN) {
        quit.push({ ...o });
        const key = `${inst}|${o.post}`;
        const words = postWords(realm, o);
        dismiss(realm, key, day, store);
        tally(realm, "officers_quit");
        if (head) oweGrievance(realm, instSite(realm, inst), day, f?.person ?? o.holder!, head.person ?? head.id, `wages:${key}:${day}`, 0.3);
        realmNews(realm, day, inst.startsWith("s:") ? inst.slice(2) : (realm.factions[inst.slice(2)]?.seat ?? null), "office", `${o.name ?? "The " + words} has given up being ${words}: three seasons unpaid.`, 3, o.name ? [o.name] : [], { why: `${instName(realm, inst)}'s coffers could not pay the wage` });
      }
    }
    if (head) payWage(realm, inst, head.id, false, wageOf(realm, inst, "head"), "head", day);
    if (head && short) addRenown(head, -2);
    // Paying every wage out of a thin coffer is a deed toward being called the Generous.
    if (head && !short && offices.length > 0 && before < total * 1.2) reputeOf(head).generous = day;
  }
  return quit;
}

/**
 * The day's skimming: a greedy keeper of the coffers takes a share of what came in today (decision 4). Hidden: booked as `stolen`. The
 * realm's day takes figures' share; a townsperson keeper's is taken in their place's own day (`site`).
 */
export function skimDay(realm: Realm, day: number, site?: string): number {
  let all = 0;
  for (const o of Object.values(realm.offices ?? {})) {
    if (!o.holder || o.skim <= 0 || o.holder === CROWD || o.holder === TOWN) continue;
    if (site === undefined ? !!o.town : !o.town || instSite(realm, o.inst) !== site) continue;
    const def = postDef(realm, o.inst, o.post);
    if (def?.duty !== "coffer") continue;
    const id = o.inst.slice(2);
    const s = o.inst.startsWith("s:") ? realm.settlements[id] : undefined;
    const fac = o.inst.startsWith("f:") ? realm.factions[id] : undefined;
    const came = s ? income(realm, s, day) * cofferMod(realm, o.inst) : fac ? rowDues(fac, 1) : 0;
    const want = Math.round(came * o.skim);
    if (want <= 0) continue;
    const took = o.row ? sink(realm, o.inst, want, `stolen by the ${def.title}`, undefined, day) : transfer(realm, o.inst, `p:${o.holder}`, want, `stolen by the ${def.title}`, undefined, day);
    o.took += took;
    all += took;
  }
  if (all > 0) tally(realm, "stolen", all);
  return all;
}

/** Chance a tax day the head audits the books: by their caution (a greedy head looks less), more with a magistrate. */
export function auditChance(realm: Realm, inst: string): number {
  const head = headOf(realm, inst);
  const magistrate = inst.startsWith("s:") ? officeFor(realm, inst, "law")?.office?.holder : null;
  return Math.min(0.95, 0.3 + 0.4 * (1 - (head?.greed ?? 0.5)) + (magistrate ? 0.2 : 0));
}

/**
 * Tax day: audits. A thief found out is dismissed and named. The realm's day audits figures; a townsperson keeper is audited in their place's
 * own day (`rows` with `site`), since only it changes their row. Returns the offices whose holders were found out.
 */
export function auditDay(realm: Realm, day: number, store?: WorldStore, opts: { rows: boolean; site?: string } = { rows: false }): Office[] {
  const found: Office[] = [];
  for (const [key, o] of Object.entries(realm.offices ?? {}).sort(([a], [b]) => a.localeCompare(b))) {
    if (!o.holder || o.took <= 0 || o.holder === CROWD || o.holder === TOWN) continue;
    if (!!o.town !== opts.rows || (opts.site !== undefined && instSite(realm, o.inst) !== opts.site)) continue;
    const rng = streamFor(realm.seed, "audit", key, day);
    if (rng() >= auditChance(realm, o.inst) * 0.8) continue;
    found.push({ ...o });
    caught(realm, key, o, day, store);
  }
  return found;
}

/** A thief found out: dismissed, renown −20, pays back what they can, called the Thief, the head's grudge, news. */
export function caught(realm: Realm, key: string, o: Office, day: number, store?: WorldStore): void {
  const head = headOf(realm, o.inst);
  const words = postWords(realm, o);
  const name = o.name ?? (o.row ? store?.people.get(o.holder!)?.name : realm.figures[o.holder!]?.name) ?? "the keeper of the coffers";
  let back = 0;
  if (o.row) {
    // What they had of it, they give back (the rest was spent). Called in their place's day: their row is theirs to change.
    back = mint(realm, o.inst, Math.floor(o.took / 2), "stolen coin paid back", undefined, day);
    if (store) {
      addRowRenown(realm, store, o.holder!, -20);
      const r = store.people.get(o.holder!);
      const f = r?.figure ? realm.figures[r.figure] : undefined;
      if (f) awardEpithet(realm, f, "the_thief", day, `caught stealing as ${words}`, true);
      else if (r) store.people.update(r.id, { epithet: "the_thief" });
    }
  } else {
    const f = realm.figures[o.holder!];
    if (f) {
      back = transfer(realm, `p:${f.id}`, o.inst, o.took, "stolen coin paid back", undefined, day);
      addRenown(f, -20);
      addDeed(f, `was caught stealing from the coffers of ${instName(realm, o.inst)}`);
      reputeOf(f).caught = day;
      awardEpithet(realm, f, "the_thief", day, `caught stealing as ${words}`, !!o.town);
    }
  }
  if (head) {
    const g = { who: head.person ?? head.id, against: realm.figures[o.holder!]?.person ?? o.holder!, cause: `audit:${key}:${day}`, weight: 0.5, day };
    if (o.town && store) addGrievance(store, g);
    else oweGrievance(realm, instSite(realm, o.inst), day, g.who, g.against, g.cause, g.weight);
  }
  if (head) reputeOf(head).punished = day;
  dismiss(realm, key, day, store);
  tally(realm, "embezzlers_caught");
  const at = o.inst.startsWith("s:") ? o.inst.slice(2) : (realm.factions[o.inst.slice(2)]?.seat ?? null);
  // A townsperson keeper is caught in their place's own day: told as the place's event.
  if (o.town && store && at) {
    placeEvent(realm, store, { kind: "caught-stealing", actor: o.holder!, ...(head ? { target: head.person ?? head.id } : {}), site: at, day, details: `an audit of ${instName(realm, o.inst)}'s books found that ${name}, the ${words.split(" of ")[0]}, had taken ${o.took} copper; ${head ? titled(head) : "the head"} has put them out (they are called the Thief now)`, importance: 5, key: `audit:${key}` });
    return;
  }
  realmNews(realm, day, at, "office", `An audit of ${instName(realm, o.inst)}'s books found that ${name}, the ${words.split(" of ")[0]}, had taken ${o.took} copper; ${head ? titled(head) : "the head"} has put them out${back > 0 ? `, and ${back} copper is paid back` : ""}.`, 5, [name, ...(head ? [head.name] : [])], { why: `the books showed ${o.took} copper stolen over ${Math.max(1, Math.round((day - o.since) / (config.daysPerYear / 2)))} seasons` });
}

/** The place an institution lives in: the place itself, or a faction's seat. */
export function instSite(realm: Realm, inst: string): string {
  return inst.startsWith("s:") ? inst.slice(2) : (realm.factions[inst.slice(2)]?.seat ?? "");
}

/** A grudge someone of a place will bear, owed until that place's day (grievances live in the people's tables). */
export function oweGrievance(realm: Realm, site: string, day: number, who: string, against: string, cause: string, weight: number): void {
  const owed = owedOf(realm);
  if (owed.grievances.length < 400) owed.grievances.push({ site, day, who, causes: [], against, cause, weight });
}
