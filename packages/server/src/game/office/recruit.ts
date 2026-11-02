import type { WorldStore } from "../db.js";
import { feelings } from "../chatter/rel.js";
import { streamFor, type Rng } from "../dice.js";
import { ageFrom } from "../people/rules.js";
import { traitsOfRow } from "../people/traits.js";
import { join, leave } from "../realm/factions.js";
import { addRenown } from "../realm/figures.js";
import { transfer } from "../realm/ledger.js";
import { realmNews, tally } from "../realm/log.js";
import type { FactionKind, Figure, GuildTrade, Realm, RealmFaction, Role } from "../realm/types.js";
import type { PersonRow } from "../../store/peopleStore.js";
import { perDay } from "../weather.js";
import { speciesOf } from "../../world/species.js";
import { memberCount, minMembers } from "./members.js";
import { recruiterSkill } from "./posts.js";
import { joiningRenown } from "./prestige.js";
import { addRowRenown, reputeOf } from "./repute.js";

/**
 * Recruiting is a drive, not a lottery (N69 decision 5). Each day a faction makes some tries (a year's worth spread over the days:
 * more with a skilled recruiter, twice as many while chartering, more when rich or short of members); each try picks the best-suited
 * figure or townsperson near a branch, who **chooses** by the faction's prestige, its pay, their trade, what they think of its leader,
 * and what they would leave. Refusals are fine. Rows are only asked in places worked out up to yesterday (a lazy place's people are
 * not touched before they have lived the days before).
 *
 * Dues: figure members pay theirs on tax day (from their purse); a member who can't pay two periods running is put out, in disgrace.
 * Townsfolk members' dues come in each day with their work (minted: their wages come from outside the realm's books).
 */

/** Tries a year, before the recruiter's skill and need. */
export const DRIVES_PER_YEAR = 6;
/** Copper a figure member pays a tax period at the usual dues (5%). */
export const FIGURE_DUES = 20;
/** Copper a townsperson member brings in a day at the usual dues. */
export const ROW_DUES = 0.6;

/** Townsfolk jobs that suit each trade and kind. */
const TRADE_JOBS: Record<GuildTrade, readonly string[]> = {
  adventurers: ["adventurer", "hunter", "sellsword", "guard"],
  merchants: ["merchant", "stallholder"],
  smiths: ["smith"],
  thieves: ["beggar", "labourer", "porter"],
  farmers: ["farmer"],
  healers: ["priest", "acolyte"],
  hunters: ["hunter"],
};
const KIND_JOBS: Partial<Record<FactionKind, readonly string[]>> = { order: ["knight", "guard", "noble"], cult: ["acolyte", "priest", "beggar", "labourer"] };
const TRADE_ROLES: Record<GuildTrade, Role[]> = { adventurers: ["adventurer", "hunter"], merchants: ["merchant"], smiths: ["smith"], thieves: ["bandit"], farmers: ["farmer"], healers: ["priest"], hunters: ["hunter"] };
const HEADS: ReadonlySet<Role> = new Set(["ruler", "lord", "mayor", "village head", "elder"]);

/** Does a townsperson's work suit the faction? */
export function rowSuits(fac: { kind: FactionKind; trade?: GuildTrade | undefined }, r: Pick<PersonRow, "job" | "id" | "cls" | "traits">): boolean {
  if (fac.kind === "guild" || fac.kind === "association") return TRADE_JOBS[fac.trade ?? "merchants"].includes(r.job);
  if (fac.kind === "rebels") return traitsOfRow(r).loyalty < 0.35 && r.job !== "child";
  if (fac.kind === "order" || fac.kind === "cult") return (KIND_JOBS[fac.kind] ?? []).includes(r.job);
  return false;
}

/** Does a figure suit the faction (they may already belong to another: they weigh leaving it)? */
export function figureSuits(realm: Realm, fac: RealmFaction, f: Figure): boolean {
  if (!f.alive || f.talks || f.role === "beast" || f.faction === fac.id || HEADS.has(f.role) || f.away) return false;
  const cur = f.faction ? realm.factions[f.faction] : undefined;
  if (cur && (cur.kind === "crown" || cur.leader === f.id)) return false;
  const local = f.home !== null && (fac.branches.includes(f.home) || fac.seat === f.home);
  const home = f.home ? realm.settlements[f.home] : undefined;
  switch (fac.kind) {
    case "guild":
    case "association":
      return local && TRADE_ROLES[fac.trade ?? "merchants"].includes(f.role);
    case "gang":
      return !cur && (f.role === "bandit" || (local && f.greed > 0.7 && (home?.prosperity ?? 50) < 35 && ["farmer", "hunter"].includes(f.role)));
    case "rebels":
      return local && f.loyalty < 0.4;
    case "cult":
      return local && (f.role === "priest" || f.loyalty < 0.3);
    case "order":
      return local && (f.role === "captain" || f.role === "noble");
    case "crown":
      return false;
  }
}

/** Is the faction short: chartering, or under its minimum? */
const needy = (realm: Realm, fac: RealmFaction): boolean => !!fac.charter || (fac.kind !== "gang" && fac.kind !== "rebels" && memberCount(realm, fac) < minMembers(realm, fac));

/** What the faction offers someone, 0..1-ish: its name, its need of them, its pay (dues against what it pays out). */
function offer(realm: Realm, fac: RealmFaction): number {
  return ((fac.prestige ?? 0) / 100) * 0.5 + (needy(realm, fac) ? 0.3 : 0) + (0.05 - (fac.dues ?? 0.05)) * 2 + (fac.wealth > 1500 ? 0.1 : 0);
}

/** What they think of its leader, -1..1: a row from N37 relationships (if they have one), a figure from their loyalty. */
function leaderRegard(realm: Realm, store: WorldStore | undefined, who: string, fac: RealmFaction, day: number): number {
  const lead = fac.leader ? realm.figures[fac.leader] : undefined;
  if (!lead) return 0;
  const rel = store?.social.rel(who, lead.person ?? lead.id);
  if (!rel) return (lead.support ?? 0) / 40;
  const v = feelings(rel, day);
  return (v.trust + v.respect - v.fear / 2) / 250;
}

/** How many tries today, by the faction's own stream. */
function triesToday(realm: Realm, fac: RealmFaction, rng: Rng): number {
  const perYear = (DRIVES_PER_YEAR + 8 * recruiterSkill(realm, fac)) * (fac.charter ? 2 : 1) + (fac.wealth > 1500 ? 4 : 0) + (needy(realm, fac) ? 4 : 0);
  const x = perDay(perYear);
  return Math.floor(x) + (rng() < x - Math.floor(x) ? 1 : 0);
}

/**
 * One faction's drive for the day among the realm's named figures. `store` is read only (what a figure thinks of the leader); townsfolk are
 * asked in their own place's day (`recruitRows`). Returns the figures who joined.
 */
export function recruitDrive(realm: Realm, fac: RealmFaction, day: number, store?: WorldStore): string[] {
  if (fac.dissolved !== undefined || fac.kind === "crown") return [];
  const rng = streamFor(realm.seed, "recruit", fac.id, day);
  const tries = triesToday(realm, fac, rng);
  const joined: string[] = [];
  for (let t = 0; t < tries; t++) {
    const figs = Object.values(realm.figures).filter((f) => !joined.includes(f.id) && figureSuits(realm, fac, f));
    if (figs.length === 0) break;
    const f = figs[Math.floor(rng() * figs.length)]!;
    const cur = f.faction ? realm.factions[f.faction] : undefined;
    const score = offer(realm, fac) + 0.3 + 0.2 * f.ambition + 0.3 * leaderRegard(realm, store, f.id, fac, day) - (cur ? offer(realm, cur) + 0.2 + 0.3 * f.loyalty : 0);
    if (score + 0.3 * rng() <= 0.6) continue;
    join(realm, f, fac);
    joined.push(f.id);
    tally(realm, "recruited");
    if (rng() < 0.3 || cur) realmNews(realm, day, f.home, "faction", cur ? `${f.name} has left ${cur.name} for ${fac.name}.` : `${f.name} has joined ${fac.name}.`, 2, [f.name, fac.name, ...(cur ? [cur.name] : [])]);
  }
  return joined;
}

/** What a faction recruiting in a place is, on a day (N69): written into the place's conditions, so a place worked out later asks the same. */
export interface FactionDay {
  kind: FactionKind;
  trade?: GuildTrade;
  /** What it offers (its name, need and pay). */
  offer: number;
  /** Its need of members (chartering, or under its minimum), for N38's recruit. */
  need: number;
  /** Tries a year. */
  perYear: number;
  prestige: number;
  /** Its leader's person (or figure id), for what townsfolk think of them. */
  leader: string | null;
}

/** The factions that recruit in a place (seated or with a branch there), as they stand now. */
export function factionDays(realm: Realm, site: string): Record<string, FactionDay> | undefined {
  const out: Record<string, FactionDay> = {};
  for (const fac of Object.values(realm.factions).sort((a, b) => a.id.localeCompare(b.id))) {
    if (fac.dissolved !== undefined || fac.kind === "crown" || (fac.seat !== site && !fac.branches.includes(site))) continue;
    const lead = fac.leader ? realm.figures[fac.leader] : undefined;
    out[fac.id] = {
      kind: fac.kind,
      ...(fac.trade ? { trade: fac.trade } : {}),
      offer: Math.round(offer(realm, fac) * 1000) / 1000,
      need: needy(realm, fac) ? 0.3 : 0,
      perYear: (DRIVES_PER_YEAR + 8 * recruiterSkill(realm, fac)) * (fac.charter ? 2 : 1) + (fac.wealth > 1500 ? 4 : 0) + (needy(realm, fac) ? 4 : 0),
      prestige: fac.prestige ?? 0,
      leader: lead ? (lead.person ?? lead.id) : null,
    };
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * A faction's drive among the townsfolk of a place, in that place's own day, from what the faction was that day (`snap`, the place's
 * conditions): rows are only changed by their place's step, so a place worked out later is asked the same. Returns who joined.
 */
export function recruitRows(realm: Realm, facId: string, snap: FactionDay, site: string, day: number, store: WorldStore): string[] {
  if (snap.kind === "gang") return [];
  const rng = streamFor(realm.seed, "recruit-rows", facId, site, day);
  const x = perDay(snap.perYear);
  const tries = Math.floor(x) + (rng() < x - Math.floor(x) ? 1 : 0);
  const joined: string[] = [];
  const pool = (store.people.loadSite(site, "full") as PersonRow[]).filter((r) => r.faction !== facId && !r.figure && !r.persona && !r.away && !r.captive && r.death === null && ageFrom(r.born_day, day) >= speciesOf(r.species).adultAge && rowSuits(snap, r));
  for (let t = 0; t < tries && pool.length > 0; t++) {
    const r = pool.splice(Math.floor(rng() * pool.length), 1)[0]!;
    const cur = r.faction ? store.people.siteDay<{ factions?: Record<string, FactionDay> }>(site, day)?.factions?.[r.faction] : undefined;
    const traits = traitsOfRow(r);
    const rel = snap.leader ? store.social.rel(r.id, snap.leader) : null;
    const regard = rel ? (feelings(rel, day).trust + feelings(rel, day).respect - feelings(rel, day).fear / 2) / 250 : 0;
    const score = snap.offer + 0.3 + 0.2 * traits.ambition + 0.3 * regard - (cur ? cur.offer + 0.2 + 0.3 * traits.loyalty : r.faction ? 0.2 + 0.3 * traits.loyalty : 0);
    if (score + 0.3 * rng() <= 0.6) continue;
    // The faction's count follows on the realm's next day (`countRows`): a place's day changes its rows, not the realm's numbers.
    store.people.update(r.id, { faction: facId });
    addRowRenown(realm, store, r.id, joiningRenown(snap));
    joined.push(r.id);
    tally(realm, "recruited_rows");
  }
  return joined;
}

/** The daily dues of townsfolk members (minted with their work), and a faction's coin from its halls. Returns what came in. */
export function rowDues(fac: RealmFaction, cofferMod: number): number {
  if (fac.charter || fac.kind === "crown" || fac.kind === "gang") return 0;
  const share = (fac.dues ?? 0.05) / 0.05;
  const halls = fac.kind === "guild" || fac.kind === "association" ? fac.branches.length * 8 : 0;
  return Math.round(((fac.rows ?? 0) * ROW_DUES * share + halls) * cofferMod);
}

/**
 * Tax day: each figure member pays their dues from their purse (less while the faction is shaken by a defeat). One who can't pay two
 * periods running is put out, and leaving in disgrace costs them renown 5. Returns those put out.
 */
export function figureDues(realm: Realm, fac: RealmFaction, day: number): Figure[] {
  if (fac.charter || fac.kind === "crown" || fac.kind === "gang" || fac.kind === "rebels") return [];
  const due = Math.round(FIGURE_DUES * ((fac.dues ?? 0.05) / 0.05) * (fac.shaken !== undefined && day < fac.shaken ? 0.6 : 1));
  const out: Figure[] = [];
  for (const id of [...fac.members]) {
    const f = realm.figures[id];
    if (!f?.alive || f.id === fac.leader) continue;
    const r = reputeOf(f);
    const paid = transfer(realm, `p:${f.id}`, `f:${fac.id}`, due, "members' dues", undefined, day);
    if (paid >= due) {
      delete r.owes;
      continue;
    }
    r.owes = (r.owes ?? 0) + 1;
    if (r.owes >= 2) {
      leave(realm, f);
      delete r.owes;
      addRenown(f, -5);
      out.push(f);
      tally(realm, "put_out");
      realmNews(realm, day, f.home, "faction", `${f.name} has been put out of ${fac.name}: two seasons of dues unpaid.`, 2, [f.name, fac.name]);
    }
  }
  return out;
}

/** What a faction's need of members adds to a recruiter's will to ask (N69): chartering or under its minimum, 0.3. */
export function recruitNeed(realm: Realm, faction: string): number {
  const fac = realm.factions[faction];
  return fac && fac.dissolved === undefined && needy(realm, fac) ? 0.3 : 0;
}

/**
 * A townsperson talked into joining (N38's `recruit`): their row is sworn, the faction counts them, and they have their share of its name.
 * `prestige`: the faction's that day, from the place's conditions (a townsperson's day reads no realm state that may have moved since).
 */
export function joinedByRecruit(realm: Realm, store: WorldStore, person: string, faction: string, prestige?: number): void {
  store.people.update(person, { faction });
  const fac = realm.factions[faction];
  if (fac || prestige !== undefined) addRowRenown(realm, store, person, joiningRenown({ kind: fac?.kind ?? "guild", prestige: prestige ?? fac?.prestige ?? 0 }));
}
