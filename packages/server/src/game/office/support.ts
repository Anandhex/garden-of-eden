import type { WorldStore } from "../db.js";
import { hateOn } from "../chatter/grievance.js";
import { feelings } from "../chatter/rel.js";
import { streamFor } from "../dice.js";
import { outlookOf } from "../people/outlook.js";
import { foundFaction, membersOf, split, standing } from "../realm/factions.js";
import { addDeed, addRenown, residents, titled } from "../realm/figures.js";
import { realmNews, tally } from "../realm/log.js";
import { install } from "../realm/politics.js";
import type { Figure, Realm, RealmFaction, Settlement } from "../realm/types.js";
import type { PersonRow } from "../../store/peopleStore.js";
import { atWar } from "../realm/economy.js";
import { officesOf, placeInst, factionInst } from "./posts.js";
import { effective, fame, oweRenown, reputeOf } from "./repute.js";
import { seasonDays } from "../weather.js";

/**
 * Support: followers make (and unmake) a leader (N69 decision 9). A leader's renown has two parts: their deeds (`renown`, kept) and
 * `support` (−20..20, recomputed each season): what their followers think of them. Followers are the residents of a head's place (its
 * figures, and up to `SAMPLE` of its townsfolk picked by stream), the members of a faction head's faction, and for a lord or a ruler the
 * heads of the places under them (weighted by their size). Each follower's **regard** (−1..1) is their loyalty and their N37
 * relationship to the leader (respect and trust, less half their fear), or, for townsfolk with none, how they see whoever rules them
 * (their outlook), less the weight of their grievances against the leader; each counts by their own fame, `1 + |renown| / 20`.
 *
 * Effective renown is renown + support. A season of support at ±10 or more moves stored renown too (a name their people speak well or
 * ill of sticks). A season at −10 or below and the strongest rival among the followers **challenges**: a place's head is put out for
 * them, a guild's masters vote their master out, a gang or an order splits; at a capital, a pretender raises rebels. Followers get some
 * back: each year under a leader of effective renown +10 or more they gain 1; under one of −10 or less they lose 1.
 */
export const SAMPLE = 50;
/** Support at or under which a season brings a challenge. */
export const CHALLENGE_AT = -10;

const clamp1 = (n: number) => Math.max(-1, Math.min(1, n));
const ref = (f: Figure) => f.person ?? f.id;

/** What a figure who follows them thinks of a leader, −1..1. */
export function figureRegard(realm: Realm, store: WorldStore | undefined, follower: Figure, leader: Figure, day: number): number {
  let r = (follower.loyalty - 0.5) * 1.2;
  if (store) {
    const rel = store.social.rel(ref(follower), ref(leader));
    if (rel) {
      const v = feelings(rel, day);
      r += (v.respect + v.trust - v.fear / 2) / 250;
    }
    r -= hateOn(store, ref(follower), ref(leader), day);
  }
  return clamp1(r);
}

/** What a townsperson thinks of a leader, −1..1: their relationship to them if they have one, else (their place's head) their outlook. */
export function rowRegard(store: WorldStore, r: PersonRow, leader: Figure, headOfTheirs: boolean, day: number): number {
  const rel = store.social.rel(r.id, ref(leader));
  let x = 0;
  if (rel) {
    const v = feelings(rel, day);
    x = (v.respect + v.trust - v.fear / 2) / 250;
  } else if (headOfTheirs) {
    const lord = outlookOf(r).lord;
    x = (lord.e + lord.t - lord.f / 2) / 250;
  }
  return clamp1(x - hateOn(store, r.id, ref(leader), day));
}

interface Voice {
  regard: number;
  weight: number;
  who: string;
}

/** Up to `SAMPLE` townsfolk of a place, picked by the leader's own stream (the same however the place was worked out). */
function sampleRows(realm: Realm, store: WorldStore, site: string, inst: string, day: number, faction?: string): PersonRow[] {
  if (store.people.count(site) === 0) return [];
  const all = (store.people.loadSite(site, "coarse") as PersonRow[]).filter((r) => r.job !== "child" && (faction === undefined || r.faction === faction));
  if (all.length <= SAMPLE) return all.map((c) => store.people.get(c.id)!).filter(Boolean);
  const rng = streamFor(realm.seed, "support", inst, day);
  const pool = [...all];
  const out: PersonRow[] = [];
  while (out.length < SAMPLE && pool.length > 0) out.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]!);
  return out.map((c) => store.people.get(c.id)!).filter(Boolean);
}

/** The places that answer to a head's place: for a ruler, every place of the kingdom; for a lord, those whose liege it is. */
function vassalsOf(realm: Realm, s: Settlement): Settlement[] {
  if (s.kind === "capital" && s.kingdom) return Object.values(realm.settlements).filter((x) => x.kingdom === s.kingdom && x.id !== s.id && !x.abandoned && x.leader);
  return Object.values(realm.settlements).filter((x) => x.liege === s.id && !x.abandoned && x.leader);
}

const VASSAL_WEIGHT: Record<string, number> = { hamlet: 0.5, village: 1, town: 2, city: 3, capital: 4 };

/** Every voice a leader hears from those who follow them. */
export function voicesOf(realm: Realm, leader: Figure, day: number, store?: WorldStore): Voice[] {
  const out: Voice[] = [];
  for (const s of Object.values(realm.settlements).filter((x) => x.leader === leader.id && !x.abandoned)) {
    for (const f of residents(realm, s.id)) if (f.id !== leader.id && !f.talks) out.push({ regard: figureRegard(realm, store, f, leader, day), weight: 1 + fame(f) / 20, who: f.id });
    if (store) for (const r of sampleRows(realm, store, s.id, placeInst(s.id), day)) out.push({ regard: rowRegard(store, r, leader, true, day), weight: 1 + Math.abs(r.renown ?? 0) / 20, who: r.id });
    // A lord's or a ruler's followers are also the heads under them; a war tax or arrears sour them.
    for (const v of vassalsOf(realm, s)) {
      const h = realm.figures[v.leader!];
      if (!h?.alive) continue;
      const strain = (v.taxRate > 0.25 ? 0.3 : 0) + (v.arrears > 0 ? 0.3 : 0) + (atWar(realm, v) ? 0.2 : 0);
      out.push({ regard: clamp1(figureRegard(realm, store, h, leader, day) - strain), weight: (VASSAL_WEIGHT[v.kind] ?? 1) * (1 + fame(h) / 20), who: h.id });
    }
  }
  for (const fac of Object.values(realm.factions).filter((x) => x.leader === leader.id && x.dissolved === undefined && x.kind !== "crown")) {
    for (const f of membersOf(realm, fac)) if (f.id !== leader.id && !f.talks) out.push({ regard: figureRegard(realm, store, f, leader, day), weight: 1 + fame(f) / 20, who: f.id });
    if (store && fac.seat) for (const r of sampleRows(realm, store, fac.seat, factionInst(fac.id), day, fac.id)) out.push({ regard: rowRegard(store, r, leader, false, day), weight: 1 + Math.abs(r.renown ?? 0) / 20, who: r.id });
  }
  return out;
}

/** Support from a set of voices: their weighted regard, −20..20, less when few speak. */
export function supportFrom(voices: readonly Voice[]): number {
  const w = voices.reduce((a, v) => a + v.weight, 0);
  if (w <= 0) return 0;
  const mean = voices.reduce((a, v) => a + v.weight * v.regard, 0) / w;
  const few = Math.min(1, voices.length / 3);
  return Math.max(-20, Math.min(20, Math.round(20 * mean * few)));
}

/** Leaders: heads of places and of factions (not crowns: a ruler leads as the head of their capital). */
export function leaders(realm: Realm): Figure[] {
  const ids = new Set<string>();
  for (const s of Object.values(realm.settlements)) if (s.leader && !s.abandoned) ids.add(s.leader);
  for (const f of Object.values(realm.factions)) if (f.leader && f.dissolved === undefined && f.kind !== "crown") ids.add(f.leader);
  return [...ids].sort().map((id) => realm.figures[id]!).filter((f) => f?.alive);
}

/** The season's support for every leader: set, moving their stored renown, marking a season under −10, and challenges. */
export function supportDay(realm: Realm, day: number, store?: WorldStore): Figure[] {
  const challenged: Figure[] = [];
  for (const f of leaders(realm)) {
    const support = supportFrom(voicesOf(realm, f, day, store));
    f.support = support;
    if (Math.abs(support) >= 10) addRenown(f, Math.trunc(support / 4));
    const r = reputeOf(f);
    // The Greedy: hard taxes for a year while the place grows poorer.
    const home = Object.values(realm.settlements).find((s) => s.leader === f.id);
    if (home) {
      if (home.taxRate > 0.4 && r.was !== undefined && home.prosperity < r.was) r.greedy ??= day;
      else delete r.greedy;
      r.was = home.prosperity;
    }
    if (support <= CHALLENGE_AT) {
      r.low ??= day;
      if (day - r.low >= seasonDays() && challenge(realm, f, day, store, `a season of their people's scorn`)) challenged.push(f);
    } else delete r.low;
  }
  return challenged;
}

/** Each year: followers share their leader's name, for good or ill (decision 9). */
export function reflectedDay(realm: Realm, day: number, store?: WorldStore): void {
  for (const lead of leaders(realm)) {
    const eff = effective(lead);
    const n = eff >= 10 ? 1 : eff <= -10 ? -1 : 0;
    if (!n) continue;
    const seen = new Set<string>();
    for (const s of Object.values(realm.settlements).filter((x) => x.leader === lead.id)) {
      for (const f of residents(realm, s.id)) if (f.id !== lead.id && !seen.has(f.id)) (seen.add(f.id), addRenown(f, n));
      for (const o of officesOf(realm, placeInst(s.id))) if (o.holder && o.row && !seen.has(o.holder)) (seen.add(o.holder), oweRenown(realm, o.holder, n, s.id, day));
    }
    for (const fac of Object.values(realm.factions).filter((x) => x.leader === lead.id && x.dissolved === undefined)) {
      for (const f of membersOf(realm, fac)) if (f.id !== lead.id && !seen.has(f.id)) (seen.add(f.id), addRenown(f, n));
      if (store) for (const r of store.people.ofFaction(fac.id)) if (!seen.has(r.id)) (seen.add(r.id), oweRenown(realm, r.id, n, r.site, day));
    }
  }
}

/**
 * A leader is challenged by the strongest rival among their followers: at a place, the best-standing resident (or townsperson, who rises)
 * takes the seat, or at a capital raises rebels for the crown; in a guild the masters vote their master out; a gang, rebels, an order or a
 * cult splits. Returns true if anything came of it.
 */
export function challenge(realm: Realm, f: Figure, day: number, store: WorldStore | undefined, why: string): boolean {
  const r = reputeOf(f);
  delete r.low;
  const s = Object.values(realm.settlements).find((x) => x.leader === f.id && !x.abandoned);
  if (s) {
    // The rival is a named figure of the place (a townsperson rises only in their place's own day; one who has is a figure now).
    const rival = residents(realm, s.id).filter((x) => x.id !== f.id && !x.talks && x.life.stage !== "young" && !["bandit", "bandit chief", "beast"].includes(x.role)).sort((a, b) => standing(b) - standing(a))[0];
    if (!rival) return false;
    tally(realm, "challenges");
    if (s.kind === "capital") {
      foundFaction(realm, streamFor(realm.seed, "challenge", f.id, day), { kind: "rebels", founder: rival, seat: s.id, creed: `${rival.name} for the crown`, why: `${rival.name} would no longer bow to ${f.name}: ${why}` }, day);
      return true;
    }
    addRenown(f, -5);
    addDeed(f, `was put out of the headship of ${s.name}`);
    const was = titled(f);
    install(realm, s, rival, day);
    f.role = "commoner";
    addDeed(rival, `took ${s.name} from ${f.name}`);
    realmNews(realm, day, s.id, "challenge", `${was} has been put out as head of ${s.name}: ${rival.name} stood against them, and ${s.name} stood with ${rival.name}.`, 6, [f.name, rival.name, s.name], { why });
    return true;
  }
  const fac = Object.values(realm.factions).find((x) => x.leader === f.id && x.dissolved === undefined && x.kind !== "crown");
  if (!fac) return false;
  const rival = membersOf(realm, fac).find((x) => x.id !== f.id && !x.talks);
  if (!rival) return false;
  tally(realm, "challenges");
  if (fac.kind === "guild" || fac.kind === "association") {
    voteOut(realm, fac, f, rival, day, why);
    return true;
  }
  split(realm, fac, rival, day, streamFor(realm.seed, "challenge", f.id, day), `${rival.name} would no longer follow ${f.name}: ${why}`);
  return true;
}

/** A guild's masters vote their master out: the best-standing of them takes the chair. */
function voteOut(realm: Realm, fac: RealmFaction, old: Figure, by: Figure, day: number, why: string): void {
  fac.leader = by.id;
  if (fac.kind === "guild") by.role = "guildmaster";
  by.superior = null;
  for (const m of membersOf(realm, fac)) if (m.id !== by.id) m.superior = by.id;
  if (old.role === "guildmaster") old.role = "merchant";
  addRenown(old, -5);
  addRenown(by, 5);
  addDeed(old, `was voted out as master of ${fac.name}`);
  addDeed(by, `was voted master of ${fac.name}`);
  realmNews(realm, day, fac.seat, "challenge", `The masters of ${fac.name} have voted ${old.name} out; ${by.name} leads it now.`, 5, [fac.name, old.name, by.name], { why });
}

