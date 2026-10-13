import { CLASS_RANK, type SocialClass } from "@millbrook/shared";
import { config } from "../../config.js";
import type { PersonRow } from "../../store/peopleStore.js";
import { speciesOf } from "../../world/species.js";
import type { WorldStore } from "../db.js";
import { streamFor } from "../dice.js";
import type { GameEvent } from "../events.js";
import { kingdomLaws } from "../realm/townsfolk.js";
import type { Realm } from "../realm/types.js";
import { givenName } from "../realm/names.js";
import { pickCasualties } from "./casualties.js";
import { NEUTRAL_DAY, type SiteDay } from "./conditions.js";
import type { DeathRecord } from "./death.js";
import { recordLifeEvent } from "./events.js";
import { NO_RETIRING, occupationAtAdulthood } from "./jobs.js";
import { backgroundDaily, birthMultiplier, famineDaily, LIVES, oldAgeDaily } from "./rates.js";
import { ageFrom, ageGapTooWide, canCourtAt, closeKin, inheritRowTraits, isBirthday } from "./rules.js";
import { traitsOfRow } from "./traits.js";

/**
 * One place's people living one day (N25). The central rule: a day's step is a pure function of
 * `(the realm's seed, each person's row, the place's conditions that day)`. Every roll comes from a stream
 * named by who and when (`streamFor(seed, "life", personId, day)`), people are taken in roster order, and
 * nothing is read from outside the place but the day's conditions (`site_days`). So working a day out on the
 * day, in a batch, or years later in a catch-up, gives the same people the same lives.
 *
 * In this order: the day's casualties (fights) are picked and die; then each person in turn has a
 * birthday (coming of age, retiring), gives birth if their time has come, rolls the day's death and, if
 * married and able, may conceive; then the unmarried who look for a match meet candidates and some marry.
 */

export interface LifeCtx {
  realm: Realm;
  store: WorldStore;
}

/** Someone who died today, with what the rest of the game needs to know. */
export interface Passing {
  id: string;
  name: string;
  /** Their persona id, when they had become a talking NPC: the persona dies too. */
  persona: string | null;
  figure: string | null;
  record: DeathRecord;
}

/** What one place's day came to. */
export interface SiteStep {
  site: string;
  day: number;
  /** People alive after the step. */
  alive: number;
  births: string[];
  deaths: Passing[];
  marriages: Array<[string, string]>;
  grownUp: string[];
  /** Everything that happened, with its hour, for the player's view of the place at full detail. */
  events: GameEvent[];
}

export const surnameOf = (name: string): string => name.split(" ")[1] ?? name;

/** Class of a child by the kingdom's laws: a slave's child is a slave where slavery is allowed, a serf's a serf; otherwise the higher of the parents'. */
export function childClass(mother: SocialClass, father: SocialClass | null, laws: { slavery: boolean; serfdom: boolean }): SocialClass {
  const f = father ?? mother;
  if (laws.slavery && mother === "slave") return "slave";
  if (laws.serfdom && (mother === "serf" || f === "serf")) return "serf";
  const best = CLASS_RANK[mother] >= CLASS_RANK[f] ? mother : f;
  return best === "slave" || best === "serf" ? "commoner" : best;
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

export function stepSite(ctx: LifeCtx, site: string, day: number): SiteStep {
  const { realm, store } = ctx;
  const people = store.people;
  const s = realm.settlements[site];
  const seed = realm.seed;
  const out: SiteStep = { site, day, alive: 0, births: [], deaths: [], marriages: [], grownUp: [], events: [] };
  if (!s) return out;
  const sd = people.siteDay<SiteDay>(site, day) ?? NEUTRAL_DAY;
  const laws = kingdomLaws(realm, s.kingdom);
  const rows = people.loadSite(site, "full") as PersonRow[];

  // The working copy: patches are made here and written to the store once, at the end.
  const cur = new Map<string, PersonRow>(rows.map((r) => [r.id, r]));
  const alive = new Set<string>(cur.keys());
  const patches = new Map<string, Partial<PersonRow>>();
  const patch = (id: string, p: Partial<PersonRow>) => {
    cur.set(id, { ...cur.get(id)!, ...p });
    patches.set(id, { ...patches.get(id), ...p });
  };
  const newborn: PersonRow[] = [];
  const row = (id: string): PersonRow | null => cur.get(id) ?? people.get(id);
  const parentsOf = (id: string): string[] => {
    const r = row(id);
    return r ? [r.mother, r.father].filter((x): x is string => !!x) : [];
  };
  const emit = (e: Parameters<typeof recordLifeEvent>[2]) => out.events.push(recordLifeEvent(realm, store, e));

  /** Someone dies: marked dead, their spouse widowed, their unborn child's mother left expecting. */
  const die = (r: PersonRow, rec: Omit<DeathRecord, "day" | "site" | "hour">): void => {
    if (!alive.has(r.id)) return;
    const hour = Math.floor(streamFor(seed, "life-hour", r.id, day, "death")() * 24);
    const record: DeathRecord = { ...rec, day, hour, site };
    patch(r.id, { death: JSON.stringify(record), expecting: null });
    alive.delete(r.id);
    const spouse = r.spouse ? cur.get(r.spouse) : undefined;
    if (spouse && alive.has(spouse.id)) patch(spouse.id, { spouse: null });
    out.deaths.push({ id: r.id, name: r.name, persona: r.persona, figure: r.figure, record });
    const notable = r.persona || r.figure ? 4 : 0;
    const station = CLASS_RANK[r.cls as SocialClass] >= 5 ? 2 : 0;
    const violent = rec.cause === "old-age" || rec.cause === "illness" ? 0 : 1;
    emit({ kind: "death", actor: r.id, target: rec.killer ?? "", site, day, details: `${r.name} died ${rec.cause === "old-age" ? "of old age" : rec.cause === "illness" ? "of an illness" : `(${rec.cause})`}, aged ${ageFrom(r.born_day, day)}`, importance: 2 + notable + station + violent });
  };

  // ---- 1. The day's casualties ----
  for (const order of sd.casualties) {
    const living = [...alive].map((id) => cur.get(id)!).filter((r) => r.stepped_day < day);
    for (const id of pickCasualties(seed, living, order, day)) {
      const r = cur.get(id)!;
      die(r, { cause: order.cause, event: order.event, ...(order.killer ? { killer: order.killer } : {}), note: `killed in ${order.event}` });
    }
  }

  // ---- 2. Each person, in roster order ----
  const mult = birthMultiplier(sd.prosperity, sd.food, sd.crowding);
  const seekers: string[] = [];
  const due = rows.filter((r) => r.stepped_day < day);
  for (const r0 of due) {
    if (!alive.has(r0.id)) continue;
    let r = cur.get(r0.id)!;
    const sp = speciesOf(r.species);
    const age = ageFrom(r.born_day, day);
    const rng = streamFor(seed, "life", r.id, day);
    const d0 = rng();
    const d1 = rng();
    const d2 = rng();
    const d3 = rng();
    const d4 = rng();
    const d5 = rng();

    // Birthdays: coming of age, and retiring.
    if (isBirthday(r.born_day, day)) {
      if (age === sp.adultAge && r.job === "child") {
        const occ = occupationAtAdulthood(r.cls as SocialClass, r.gender === "female" ? "female" : "male", s.kind, streamFor(seed, "life-job", r.id, day));
        patch(r.id, { job: occ.job, work: occ.work });
        out.grownUp.push(r.id);
        if (CLASS_RANK[r.cls as SocialClass] >= 5) emit({ kind: "coming-of-age", actor: r.id, site, day, details: `${r.name} came of age`, importance: 3 });
        r = cur.get(r.id)!;
      } else if (age === sp.elderAge + LIVES.retireAfterElder && !NO_RETIRING.has(r.job as never) && r.job !== "child") {
        patch(r.id, { job: "elder", work: "home" });
        r = cur.get(r.id)!;
      }
    }

    // A child is born.
    if (r.expecting) {
      const exp = JSON.parse(r.expecting) as { father: string; due: number };
      if (exp.due <= day) {
        const baby = bear(r, exp.father);
        newborn.push(baby);
        patch(r.id, { expecting: null, last_birth: day });
        r = cur.get(r.id)!;
        if (d5 < LIVES.childbirthDeath) {
          die(r, { cause: "childbirth", note: "in childbirth" });
          continue;
        }
      }
    }

    // The day's chances of dying: old age, illness and accident, hunger, crowded houses, plague.
    const bg = backgroundDaily(r.species, age);
    const old = oldAgeDaily(r.species, age);
    const fam = famineDaily(sd.famine, r.cls, age, r.species);
    const crowd = sd.crowding > LIVES.crowded ? bg * 0.25 : 0;
    const pest = sd.plague * 0.02;
    const total = 1 - (1 - bg) * (1 - old) * (1 - fam) * (1 - crowd) * (1 - pest);
    if (d0 < total) {
      let cause: DeathRecord["cause"];
      if (old >= 1) cause = "old-age";
      else {
        const x = d1 * (old + fam + crowd + pest + bg);
        if (x < old) cause = "old-age";
        else if (x < old + fam) cause = "famine";
        else if (x < old + fam + crowd + pest) cause = "illness";
        else cause = d2 < 0.7 ? "illness" : "accident";
      }
      die(r, { cause, note: cause === "old-age" ? "old age" : cause });
      continue;
    }

    // Conceiving.
    if (config.content.npcMarriage && r.gender === "female" && r.spouse && !r.expecting && age >= sp.adultAge && age <= LIVES.fertileUntil && alive.has(r.spouse)) {
      const rested = r.last_birth === null || day - r.last_birth >= config.family.restDays;
      if (rested && d3 < LIVES.conception * mult && people.childCount(r.id, r.spouse) < LIVES.maxChildren) {
        patch(r.id, { expecting: JSON.stringify({ father: r.spouse, due: day + config.family.pregnancyDays }) });
      }
    }

    // Looking for a match.
    if (config.content.npcMarriage && !r.spouse && !r.expecting && canCourtAt(r.species, age) && d4 < LIVES.seeking) seekers.push(r.id);
  }

  // ---- 3. Matches ----
  if (seekers.length > 0) {
    const singles = (g: string) => [...alive].map((id) => cur.get(id)!).filter((r) => r.gender === g && !r.spouse && !r.expecting && r.job !== "child" && canCourtAt(r.species, ageFrom(r.born_day, day)));
    const pools = { female: singles("female"), male: singles("male") };
    const matched = new Set<string>();
    const mrng = streamFor(seed, "match", site, day);
    for (const id of seekers) {
      if (matched.has(id) || !alive.has(id)) continue;
      const a = cur.get(id)!;
      if (a.spouse) continue;
      const pool = a.gender === "female" ? pools.male : pools.female;
      if (pool.length === 0) continue;
      let best: { b: PersonRow; score: number } | null = null;
      for (let k = 0; k < LIVES.meets; k++) {
        const b = pool[Math.floor(mrng() * pool.length)]!;
        if (matched.has(b.id) || !alive.has(b.id) || b.spouse || b.id === a.id) continue;
        const score = matchScore(a, b);
        if (score > 0 && (!best || score > best.score)) best = { b, score };
      }
      if (!best || mrng() >= Math.min(1, best.score)) continue;
      if (!leave(a, best.b, mrng)) continue;
      const [husband, wife] = a.gender === "male" ? [a, best.b] : [best.b, a];
      matched.add(a.id).add(best.b.id);
      patch(husband.id, { spouse: wife.id });
      patch(wife.id, { spouse: husband.id, home: husband.home });
      out.marriages.push([husband.id, wife.id]);
      const gap = Math.abs(CLASS_RANK[husband.cls as SocialClass] - CLASS_RANK[wife.cls as SocialClass]);
      const known = husband.persona || husband.figure || wife.persona || wife.figure ? 3 : 0;
      emit({ kind: "marriage", actor: husband.id, target: wife.id, site, day, key: `${husband.id}+${wife.id}`, details: `${husband.name} married ${wife.name}${gap >= 2 ? `, across a gap of rank (${husband.cls} and ${wife.cls})` : ""}`, importance: 3 + (gap >= 2 ? 3 : 0) + known });
    }
  }

  // ---- 4. Write it all ----
  for (const [id, p] of patches) people.update(id, p);
  for (const b of newborn) people.add(b);
  people.setSeq(site, { stepped: day });
  out.alive = people.livingCount(site);
  return out;

  // ---- helpers that need the working copy ----

  /** A woman gives birth: the baby's row, made from both parents, and a birth event. */
  function bear(mother: PersonRow, fatherId: string): PersonRow {
    const father = row(fatherId);
    const rng = streamFor(seed, "birth", mother.id, day);
    const gender: "female" | "male" = rng() < 0.5 ? "female" : "male";
    const name = `${givenName(rng, gender)} ${surnameOf(father?.name ?? mother.name)}`;
    const traits = inheritRowTraits(traitsOfRow(mother), traitsOfRow(father ?? mother), rng, mother.species);
    const cls = childClass(mother.cls as SocialClass, (father?.cls as SocialClass | undefined) ?? null, laws);
    const seq = people.seq(site);
    const id = `t_${site}_${seq.next_id}`;
    const baby: PersonRow = {
      id,
      site,
      n: seq.next_n,
      name,
      gender,
      species: mother.species,
      born_day: day,
      cls,
      job: cls === "slave" ? "slave" : "child",
      home: mother.home,
      work: "home",
      master: cls === "slave" || cls === "serf" ? mother.master : null,
      master_id: cls === "slave" ? mother.master_id : null,
      faction: null,
      mother: mother.id,
      father: father ? father.id : null,
      spouse: null,
      figure: null,
      persona: null,
      traits: JSON.stringify(traits),
      death: null,
      expecting: null,
      last_birth: null,
      stepped_day: day,
      rev: 0,
    };
    people.setSeq(site, { next_id: seq.next_id + 1, next_n: seq.next_n + 1 });
    out.births.push(id);
    const notable = mother.persona || mother.figure || father?.persona || father?.figure ? 3 : 0;
    const station = CLASS_RANK[cls] >= 5 ? 2 : 0;
    emit({ kind: "birth", actor: mother.id, target: id, site, day, key: id, details: `${mother.name} bore a ${gender === "female" ? "daughter" : "son"}, ${name}`, importance: 2 + notable + station });
    return baby;
  }

  /** How well two people suit: class, age and factions; 0 if they may not wed. */
  function matchScore(a: PersonRow, b: PersonRow): number {
    const ageA = ageFrom(a.born_day, day);
    const ageB = ageFrom(b.born_day, day);
    if (ageGapTooWide(ageA, ageB)) return 0;
    if (closeKin(parentsOf, a.id, b.id, 2)) return 0;
    const gap = Math.abs(CLASS_RANK[a.cls as SocialClass] - CLASS_RANK[b.cls as SocialClass]);
    const byClass = gap === 0 ? 1 : gap === 1 ? 0.4 : 0.05;
    const byAge = 1 - Math.abs(ageA - ageB) / (config.family.maxAgeGap * 1.6);
    let byFaction = 1;
    if (a.faction && b.faction) byFaction = a.faction === b.faction ? 1.3 : clamp(1 + (realm.factions[a.faction]?.stances[b.faction] ?? 0) / 250, 0.6, 1.4);
    return byClass * byAge * byFaction;
  }

  /** A slave's marriage needs their master's leave, a roll weighted by the master's greed. True if there's no need or it was given. */
  function leave(a: PersonRow, b: PersonRow, rng: () => number): boolean {
    if (!laws.slavery) return true;
    const masters = new Set<string | null>();
    for (const x of [a, b]) if (x.cls === "slave") masters.add(x.master_id ?? x.master);
    for (const m of masters) {
      const boss = m ? row(m) : null;
      const p = boss ? clamp(0.75 - 0.5 * traitsOfRow(boss).greed, 0.15, 0.9) : 0.5;
      if (rng() >= p) return false;
    }
    return true;
  }
}
