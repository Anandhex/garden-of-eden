import { CLASS_RANK, type SocialClass } from "@millbrook/shared";
import type { WorldStore } from "../db.js";
import { feelings } from "../chatter/rel.js";
import { streamFor } from "../dice.js";
import { tierIndex, type Tier } from "../life.js";
import { ageFrom } from "../people/rules.js";
import { traitsOfRow } from "../people/traits.js";
import { addDeed, addRenown } from "../realm/figures.js";
import { realmNews, tally } from "../realm/log.js";
import type { Figure, Office, Realm } from "../realm/types.js";
import type { PersonRow } from "../../store/peopleStore.js";
import { speciesOf } from "../../world/species.js";
import { factionInst, officeKey, placeInst, postsOf, postWords, type Duty, type PostDef } from "./posts.js";
import { memberCount } from "./members.js";
import { addRowRenown } from "./repute.js";
import { placeEvent, raiseRow } from "./rising.js";

/**
 * Who gets a post (N69 decision 2). When a post is empty (a new institution, a death, a dismissal, a resignation) the head appoints:
 * the candidates are residents (or members) of age and of a class that may hold office (no slave or serf), scored by the post's skill
 * (a treasurer: an honest hand and a trade of reckoning; a captain: a fighter and nerve; a warden: ambition and a name), the head's
 * feeling for them (N37 respect and trust; kin count), their standing, the seat they already hold (N40: a councillor is the natural
 * treasurer, the captain of the guard the natural captain) and a little luck. Each post's pick has its own stream. A head with no
 * candidates leaves it empty.
 *
 * Townsfolk hold most village posts. One appointed above a village's posts rises to a figure (rising.ts). Nobody holds two posts.
 */

const NO_OFFICE: ReadonlySet<string> = new Set(["slave", "serf"]);
/** The holder of a post in a place whose people are a count, not rows: one of them, nameless like the rest. */
export const CROWD = "crowd";
/** The holder of a living place's post left for its townsfolk, until the place's own day names who (N69). */
export const TOWN = "townsfolk";
const HEADS: ReadonlySet<string> = new Set(["ruler", "lord", "mayor", "village head", "elder", "bandit chief", "beast", "child"]);

/** How well someone's work and nature fit a duty, 0..1: what their skill at the post will be. */
function fitness(duty: Duty, o: { job: string; greed: number; bravery: number; loyalty: number; ambition: number; skill: number; cls: number; name: number }): number {
  const job = (...jobs: string[]) => (jobs.includes(o.job) ? 1 : 0);
  let fit: number;
  switch (duty) {
    case "coffer":
      fit = 0.4 * (1 - o.greed) + 0.35 * job("merchant", "stallholder", "clerk", "scholar") + 0.25 * o.skill;
      break;
    case "watch":
    case "levy":
      fit = 0.45 * job("guard", "knight", "sellsword", "captain", "adventurer", "noble") + 0.3 * o.bravery + 0.25 * o.skill;
      break;
    case "law":
      fit = 0.3 * (1 - o.greed) + 0.35 * Math.min(1, o.cls / 5) + 0.2 * job("clerk", "scholar", "priest", "noble") + 0.15 * o.loyalty;
      break;
    case "works":
      fit = 0.3 * job("clerk", "carpenter", "merchant", "scholar", "smith") + 0.35 * o.skill + 0.35 * (1 - o.greed);
      break;
    case "council":
      fit = 0.4 * Math.min(1, o.cls / 6) + 0.3 * o.ambition + 0.3 * o.loyalty;
      break;
    case "spies":
      fit = 0.4 * o.ambition + 0.3 * Math.min(1, o.cls / 5) + 0.3 * (1 - o.loyalty);
      break;
    case "recruit":
      fit = 0.4 * o.ambition + 0.3 * Math.min(1, Math.max(0, o.name) / 40) + 0.3 * o.bravery;
      break;
    case "master":
      fit = 0.7 * o.skill + 0.3 * Math.min(1, Math.max(0, o.name) / 40);
      break;
  }
  return Math.max(0, Math.min(1, Math.round(fit * 100) / 100));
}

/** Share of income a keeper of the coffers skims (decision 4): none for the honest or the loyal, up to 5% for the greedy and disloyal. */
export function skimOf(greed: number, loyalty: number): number {
  if (greed <= 0.7 || loyalty >= 0.6) return 0;
  return Math.round(((greed - 0.7) / 0.3) * 0.05 * (1 - 0.5 * loyalty) * 10000) / 10000;
}

const FIGHT_ROLES: Record<string, string> = { captain: "captain", adventurer: "adventurer", hunter: "guard", noble: "noble", merchant: "merchant", smith: "smith", priest: "priest", guard: "guard" };

interface Candidate {
  id: string;
  row: boolean;
  name: string;
  score: number;
  skill: number;
  skim: number;
}

/** The person behind the head (their row, when they rose from one), for relationships. */
const headRef = (head: Figure | undefined): string | undefined => head?.person ?? head?.id;

/** Who holds a post now, as a set (one post each). */
function holders(realm: Realm): Set<string> {
  return new Set(Object.values(realm.offices ?? {}).map((o) => o.holder).filter((x): x is string => !!x));
}

/** Heads of places and factions: they hold no other post. */
function heads(realm: Realm): Set<string> {
  const out = new Set<string>();
  for (const s of Object.values(realm.settlements)) if (s.leader) out.add(s.leader);
  for (const f of Object.values(realm.factions)) if (f.leader && f.dissolved === undefined) out.add(f.leader);
  return out;
}

/** Score a figure for a post. */
function scoreFigure(realm: Realm, store: WorldStore | undefined, def: PostDef, f: Figure, head: Figure | undefined, day: number, inst: string): Candidate {
  const skill = fitness(def.duty, { job: FIGHT_ROLES[f.role] ?? f.role, greed: f.greed, bravery: f.bravery, loyalty: f.loyalty, ambition: f.ambition, skill: Math.min(1, tierIndex(f.life.tier as Tier) / 4), cls: f.role === "noble" ? 6 : 3, name: f.renown });
  const roll = streamFor(realm.seed, "office", inst, def.id, f.id, day)();
  const rel = store && head ? store.social.rel(headRef(head)!, f.person ?? f.id) : null;
  const regard = rel ? (feelings(rel, day).respect + feelings(rel, day).trust) / 400 : 0;
  const kin = head && (f.parents?.includes(head.id) || head.parents?.includes(f.id)) ? 0.3 : 0;
  return { id: f.id, row: false, name: f.name, skill, skim: def.duty === "coffer" ? skimOf(f.greed, f.loyalty) : 0, score: skill + regard + kin + 0.1 + Math.max(-0.3, Math.min(0.3, f.renown / 100)) + 0.2 * roll };
}

/** Score a townsperson for a post. */
function scoreRow(realm: Realm, store: WorldStore, def: PostDef, r: PersonRow, head: Figure | undefined, day: number, inst: string, seats: readonly string[]): Candidate {
  const t = traitsOfRow(r);
  const skill = fitness(def.duty, { job: r.job, greed: t.greed, bravery: t.bravery, loyalty: t.loyalty, ambition: t.ambition, skill: (r.skill ?? 0) / 5, cls: CLASS_RANK[r.cls as SocialClass] ?? 2, name: r.renown ?? 0 });
  const roll = streamFor(realm.seed, "office", inst, def.id, r.id, day)();
  const rel = head ? store.social.rel(headRef(head)!, r.id) : null;
  const regard = rel ? (feelings(rel, day).respect + feelings(rel, day).trust) / 400 : 0;
  const hp = head?.person ? store.people.get(head.person) : null;
  const kin = hp && [hp.spouse, hp.mother, hp.father].includes(r.id) ? 0.3 : hp && (r.mother === hp.id || r.father === hp.id) ? 0.3 : 0;
  // A seat they already hold (N40): a councillor for the coffers and the law, the captain of the guard for the watch, a guild's officers for its posts.
  const seat = seats.some((x) => (def.duty === "watch" || def.duty === "levy" ? x.startsWith("seat:captain:") : def.duty === "master" || def.duty === "recruit" || inst.startsWith("f:") ? x.startsWith(`seat:g:${inst.slice(2)}:`) : x.startsWith("seat:council:"))) ? 0.3 : 0;
  return { id: r.id, row: true, name: r.name, skill, skim: def.duty === "coffer" ? skimOf(t.greed, t.loyalty) : 0, score: skill + regard + kin + seat + Math.max(-0.3, Math.min(0.3, (r.renown ?? 0) / 100)) + 0.2 * roll };
}

/** A place's people are rows living their days (worked out up to yesterday): only then are they asked to hold office. */
const rowsCurrent = (store: WorldStore, site: string, day: number): boolean => store.people.count(site) > 0 && store.people.seq(site).stepped >= day - 1;

/** Townsfolk who may hold office in a place (of age, free, at home, of a class above serfdom); `faction`: only its members. */
function eligibleRows(store: WorldStore, site: string, day: number, faction?: string): PersonRow[] {
  if (!rowsCurrent(store, site, day)) return [];
  return (store.people.loadSite(site, "full") as PersonRow[]).filter((r) => {
    if (r.death !== null || r.figure || r.away || r.captive || NO_OFFICE.has(r.cls) || r.job === "child" || r.job === "elder") return false;
    if (faction !== undefined && r.faction !== faction) return false;
    return ageFrom(r.born_day, day) >= speciesOf(r.species).adultAge + 2;
  });
}

/**
 * Fill the empty posts of an institution. `rows`: townsfolk of the place (a faction's seat) may be appointed: only in that place's own day,
 * since rows are changed only by their place's step. `crowd`: a place with no one to appoint has its posts held by one of its nameless
 * people (where its people are a count, not living rows). Returns the offices filled.
 */
export function fillPosts(realm: Realm, inst: string, day: number, store?: WorldStore, opts: FillOpts = { rows: !!store, crowd: !store }): Office[] {
  const id = inst.slice(2);
  const place = inst.startsWith("s:") ? realm.settlements[id] : undefined;
  const fac = inst.startsWith("f:") ? realm.factions[id] : undefined;
  const defs = postsOf(realm, inst, fac ? memberCount(realm, fac) : 0);
  if (defs.length === 0) return [];
  const offices = (realm.offices ??= {});
  const head = place?.leader ? realm.figures[place.leader] : fac?.leader ? realm.figures[fac.leader] : undefined;
  const taken = holders(realm);
  const leaders = heads(realm);
  const filled: Office[] = [];
  let figs: Figure[] | null = null;
  let rows: PersonRow[] | null = null;
  for (const def of defs) {
    const key = officeKey(inst, def.id);
    const cur = offices[key];
    if ((cur?.holder && !(opts.rows && cur.holder === TOWN)) || (opts.only && !opts.only.has(key))) continue;
    figs ??= place
      ? Object.values(realm.figures).filter((f) => f.alive && f.home === id && !f.away && f.life.stage !== "young" && !HEADS.has(f.role) && f.role !== "bandit")
      : fac!.members.map((m) => realm.figures[m]!).filter((f) => f?.alive && !f.away && f.life.stage !== "young");
    rows ??= store && opts.rows ? (place ? eligibleRows(store, id, day) : fac!.seat ? eligibleRows(store, fac!.seat, day, fac!.id) : []) : [];
    const cands: Candidate[] = [];
    if (opts.figures !== false) for (const f of figs) if (!taken.has(f.id) && !leaders.has(f.id)) cands.push(scoreFigure(realm, store, def, f, head, day, inst));
    // Named figures get first refusal where the place's townsfolk may stand too: only one fit for the work is taken now.
    if (opts.minFit !== undefined) for (let i = cands.length - 1; i >= 0; i--) if (cands[i]!.skill < opts.minFit) cands.splice(i, 1);
    for (const r of rows) if (!taken.has(r.id)) cands.push(scoreRow(realm, store!, def, r, head, day, inst, store!.careers.openJobs(r.id).map((j) => j.job)));
    if (cands.length === 0) {
      // No named figure fit for it: it is left to the place's townsfolk, held for now by one of them (named in the place's own day).
      if (opts.minFit !== undefined) {
        offices[key] = { inst, post: def.id, holder: TOWN, town: true, since: day, skill: 0.5, skim: 0, took: 0, unpaid: 0 };
        continue;
      }
      if (opts.rows && cur?.holder === TOWN) continue;
      // Where a place's people (or a faction's townsfolk) are a number, not rows, its posts are held by one of them, nameless like the rest (`CROWD`).
      if (opts.crowd && ((place && place.population > 0) || (fac && (fac.rows ?? 0) > 0))) {
        offices[key] = { inst, post: def.id, holder: CROWD, since: day, skill: 0.5, skim: 0, took: 0, unpaid: 0 };
        continue;
      }
      offices[key] = { inst, post: def.id, holder: null, since: day, skill: 0, skim: 0, took: 0, unpaid: 0, vacant: cur?.vacant ?? day };
      continue;
    }
    cands.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1));
    const pick = cands[0]!;
    const o: Office = { inst, post: def.id, holder: pick.id, ...(pick.row ? { row: true } : {}), ...(opts.rows ? { town: true } : {}), name: pick.name, since: day, skill: pick.skill, skim: pick.skim, took: 0, unpaid: 0 };
    offices[key] = o;
    taken.add(pick.id);
    filled.push(o);
    tally(realm, "appointed");
    if (pick.row) {
      if (store) addRowRenown(realm, store, pick.id, def.renown);
      // A post above a village's makes a name the realm knows (decision 10).
      const above = place ? place.kind !== "village" && place.kind !== "hamlet" : !!fac?.seat && !["village", "hamlet"].includes(realm.settlements[fac.seat]?.kind ?? "village");
      if (above && store) raiseRow(realm, store, pick.id, day, `was made ${postWords(realm, o)}`);
    } else {
      const f = realm.figures[pick.id]!;
      addRenown(f, def.renown);
      addDeed(f, `was made ${postWords(realm, o)}`);
    }
    if (def.duty !== "master") {
      const at = place?.id ?? fac?.seat ?? null;
      const words = `${pick.name} is made ${postWords(realm, o)}${head ? ` by ${head.name}` : ""}`;
      const why = `${head?.name ?? "the head"} thought them the best fit (${Math.round(pick.skill * 100)}% for the work)`;
      // In a place's own day it is the place's event (realm news would not be the same when the place is worked out later).
      if (opts.rows && store && at) placeEvent(realm, store, { kind: "appointed", actor: pick.id, ...(head ? { target: head.person ?? head.id } : {}), site: at, day, details: words, importance: place && place.kind !== "village" ? 3 : 2, key: key, why });
      else realmNews(realm, day, at, "office", `${words}.`, place && place.kind !== "village" ? 3 : 2, [pick.name], { why });
    }
  }
  return filled;
}

/**
 * Empty the posts whose holders are gone: dead, moved away, out of the faction, raised to a head's seat, or risen to a figure (the post
 * follows them to their figure). Rows are only checked where the store is. Returns the keys emptied.
 */
export function vacate(realm: Realm, day: number, store?: WorldStore, live: ReadonlySet<string> = NO_SITES): string[] {
  const out: string[] = [];
  const leaders = heads(realm);
  for (const [key, o] of Object.entries(realm.offices ?? {})) {
    if (!o.holder) continue;
    const id = o.inst.slice(2);
    const place = o.inst.startsWith("s:") ? realm.settlements[id] : undefined;
    const fac = o.inst.startsWith("f:") ? realm.factions[id] : undefined;
    let gone: string | null = null;
    if ((place && (place.abandoned || place.fallen)) || (fac && (fac.dissolved !== undefined || fac.charter)) || (!place && !fac)) gone = "gone";
    else if (o.holder === TOWN) {
      // Waiting for the place's day to name one of its townsfolk; given up if the place's people are no longer living rows.
      if (!place || !live.has(place.id)) gone = "not living";
      else continue;
    } else if (o.holder === CROWD) {
      // The place's people became rows: one of them is appointed by name.
      if (store && place && live.has(place.id) && store.people.count(place.id) > 0) gone = "named";
      else continue;
    } else if (!o.row) {
      const f = realm.figures[o.holder];
      if (!f?.alive) gone = "died";
      else if (leaders.has(f.id)) gone = "raised";
      else if (place && f.home !== place.id) gone = "moved";
      else if (fac && f.faction !== fac.id) gone = "left";
    } else if (store) {
      const r = store.people.get(o.holder);
      if (!r || r.death !== null) gone = "died";
      else if (r.figure && realm.figures[r.figure]) {
        o.holder = r.figure;
        delete o.row;
        continue;
      } else if (place && r.site !== place.id) gone = "moved";
      else if (fac && r.faction !== fac.id) gone = "left";
    }
    if (!gone) continue;
    // A townsperson's post in a living place goes back to its townsfolk at once (the realm's numbers don't wait for the place's day).
    const toTown = o.town && place && live.has(place.id) && gone !== "gone";
    realm.offices[key] = { ...o, holder: toTown ? TOWN : null, unpaid: 0, took: 0, skim: 0, skill: toTown ? 0.5 : o.skill, ...(toTown ? {} : { vacant: day }) };
    delete realm.offices[key]!.row;
    delete realm.offices[key]!.name;
    if (!toTown) delete realm.offices[key]!.town;
    out.push(key);
  }
  // Posts an institution no longer has (a guild shrank and has fewer masters; a place that fell): dropped.
  for (const [key, o] of Object.entries(realm.offices ?? {})) {
    const fac = o.inst.startsWith("f:") ? realm.factions[o.inst.slice(2)] : undefined;
    const defs = postsOf(realm, o.inst, fac ? memberCount(realm, fac) : 0);
    if (!defs.some((d) => d.id === o.post)) delete realm.offices[key];
  }
  return out;
}

/** Dismiss an officer (an audit, a quarrel): the post is empty for the head to fill. Returns the office as it was. */
export function dismiss(realm: Realm, key: string, day: number, store?: WorldStore): Office | null {
  const o = realm.offices?.[key];
  if (!o?.holder) return null;
  const was = { ...o };
  void store;
  // A townsperson's post goes back to the place's townsfolk (named again in its day); another stands empty for the head to fill.
  realm.offices[key] = o.town ? { inst: o.inst, post: o.post, holder: TOWN, town: true, since: day, skill: 0.5, skim: 0, took: 0, unpaid: 0 } : { inst: o.inst, post: o.post, holder: null, since: day, skill: 0, skim: 0, took: 0, unpaid: 0, vacant: day };
  return was;
}

export interface FillOpts {
  /** Townsfolk may be appointed (only in the place's own day). */
  rows: boolean;
  /** One of a place's nameless people holds a post nobody can (where its people are a count). */
  crowd: boolean;
  /** Figures may be appointed (default yes). */
  figures?: boolean;
  /** Only candidates this fit for the work; with nobody, the post waits (for the place's townsfolk). */
  minFit?: number;
  /** Only these posts (keys). */
  only?: ReadonlySet<string>;
}

/** How fit a named figure must be to take a post a living place's townsfolk could hold, on the realm's day. */
export const FIGURE_FIRST_FIT = 0.5;

/**
 * The realm's day: fill the empty posts of every place whose people are a count (and the factions seated there) with its figures, or one of
 * its nameless people. In a place whose people are living rows (`live`), named figures fit for the work get first refusal; what is left
 * waits for the place's own day, which fills it from its townsfolk (`fillSitePosts`).
 */
export function appointDay(realm: Realm, day: number, store?: WorldStore, live: ReadonlySet<string> = NO_SITES): Office[] {
  const out: Office[] = [];
  for (const s of Object.values(realm.settlements).sort((a, b) => a.id.localeCompare(b.id))) {
    out.push(...fillPosts(realm, placeInst(s.id), day, store, live.has(s.id) ? { rows: false, crowd: false, minFit: FIGURE_FIRST_FIT } : { rows: false, crowd: true }));
  }
  for (const f of Object.values(realm.factions).sort((a, b) => a.id.localeCompare(b.id))) {
    if (f.dissolved !== undefined) continue;
    const rowsMay = !!f.seat && live.has(f.seat) && f.kind !== "gang";
    // Seated where nobody is lived day by day, a faction with townsfolk members has one of them, nameless, in a post no figure takes (as such a place does).
    out.push(...fillPosts(realm, factionInst(f.id), day, store, rowsMay ? { rows: false, crowd: false, minFit: FIGURE_FIRST_FIT } : { rows: false, crowd: f.kind !== "gang" && (f.rows ?? 0) > 0 }));
  }
  return out;
}

/** The posts of a living place, and of the factions seated there that take townsfolk, waiting for a townsperson after the realm's day (for its conditions). */
export function vacantAt(realm: Realm, site: string): string[] {
  const insts = [placeInst(site), ...Object.values(realm.factions).filter((f) => f.dissolved === undefined && f.seat === site && f.kind !== "gang").map((f) => factionInst(f.id))];
  const out: string[] = [];
  for (const inst of insts.sort()) {
    const fac = inst.startsWith("f:") ? realm.factions[inst.slice(2)] : undefined;
    for (const def of postsOf(realm, inst, fac ? memberCount(realm, fac) : 0)) {
      const h = realm.offices?.[officeKey(inst, def.id)]?.holder;
      if (!h || h === TOWN) out.push(officeKey(inst, def.id));
    }
  }
  return out;
}

/**
 * A living place's own day: the posts its conditions say stood empty that day (and still do), from its townsfolk. Reading the vacancies of
 * the day, not the realm's now, a place worked out later fills the same posts on the same days.
 */
export function fillSitePosts(realm: Realm, site: string, day: number, store: WorldStore, vacant: readonly string[]): Office[] {
  if (vacant.length === 0) return [];
  const only = new Set(vacant);
  const out: Office[] = [];
  for (const inst of [...new Set(vacant.map((k) => k.split("|")[0]!))].sort()) out.push(...fillPosts(realm, inst, day, store, { rows: true, crowd: false, figures: false, only }));
  return out;
}

const NO_SITES: ReadonlySet<string> = new Set();
