import { config } from "../../config.js";
import { addRenown } from "../realm/figures.js";
import { realmNews, tally } from "../realm/log.js";
import type { Figure, Realm } from "../realm/types.js";
import { TITLES, type TitleDef, type TitleId } from "../titles.js";
import { effective, lastTwoYears, reputeOf } from "./repute.js";

/**
 * Names earned by how one leads (N69 decision 10). Epithets are titles (`TITLES` entries of kind "repute") held in the same
 * `life.titles` list as every title, heard by a talker in their situation line, and put after a figure's name by `titled`. They are
 * awarded in code only, from facts, never by the model: `epithetsDay` checks the facts each season. A leader can hold a good and a bad
 * one at once (a Bold but Cruel lord). One that rests on a state (the Good, the Bad, the Greedy...) is lost when the facts stop holding
 * for a year; one that rests on a deed (the Conqueror, Oathbreaker, the Thief, the Cruel for a sack) is kept for life. Each award is
 * news and moves renown once: +5 for a good name, −5 for a bad one (`quiet`: in a place's own day, where the caller tells it as the place's event).
 *
 * Townsfolk in office earn the office-fitting ones (the Just, the Generous, the Thief) on their row's `epithet`, which makes them rise.
 */
export const REPUTE: TitleId[] = (Object.keys(TITLES) as TitleId[]).filter((id) => (TITLES[id] as TitleDef).kind === "repute");

const year = () => config.daysPerYear;
/** Buildings raised under a head in two years before they are the Builder (places build often: it takes a run of them). */
export const BUILDER_WORKS = 6;
const has = (f: Figure, id: TitleId) => f.life.titles.some((t) => t.id === id);

/** Give a figure an epithet once: news, renown ±5. Returns true if it was new. */
export function awardEpithet(realm: Realm, f: Figure, id: TitleId, day: number, why: string, quiet = false): boolean {
  if (!f.alive || has(f, id)) return false;
  const def = TITLES[id] as TitleDef;
  f.life.titles.push({ id, day });
  addRenown(f, def.good ? 5 : -5);
  delete reputeOf(f).lapse?.[id];
  tally(realm, def.good ? "epithets_good" : "epithets_bad");
  const place = f.home ? realm.settlements[f.home] : undefined;
  if (!quiet) realmNews(realm, day, f.home, "epithet", `They call ${f.gender === "female" ? "her" : "him"} ${f.name} ${def.name}${place ? ` in ${place.name}` : ""} now.`, 4, [f.name, ...(place ? [place.name] : [])], { why, people: [f.id] });
  return true;
}

/** Take an epithet away (the facts stopped holding for a year). */
function loseEpithet(realm: Realm, f: Figure, id: TitleId, day: number): void {
  f.life.titles = f.life.titles.filter((t) => t.id !== id);
  tally(realm, "epithets_lost");
  realmNews(realm, day, f.home, "epithet", `Folk no longer call ${f.name} ${(TITLES[id] as TitleDef).name}.`, 2, [f.name], { people: [f.id] });
}

/** Is this figure a leader: the head of a place, or of a faction? */
export function isLeader(realm: Realm, f: Figure): boolean {
  return Object.values(realm.settlements).some((s) => s.leader === f.id && !s.abandoned) || Object.values(realm.factions).some((x) => x.leader === f.id && x.dissolved === undefined);
}

/** The facts each state epithet rests on, now. */
function holding(realm: Realm, f: Figure, day: number): Partial<Record<TitleId, boolean>> {
  const r = reputeOf(f);
  const ventures = (f.ventures ?? []).filter((v) => v.day > day - 2 * year());
  const ledWon = ventures.filter((v) => v.led && v.won).length;
  const ledLost = ventures.filter((v) => v.led && !v.won);
  const lead = isLeader(realm, f);
  return {
    the_good: lead && r.good !== undefined && day - r.good >= year(),
    the_bad: lead && r.bad !== undefined && day - r.bad >= year(),
    the_just: r.punished !== undefined && day - r.punished < 2 * year() && (f.support ?? 0) >= 0,
    the_generous: r.generous !== undefined && day - r.generous < 2 * year(),
    the_bold: ledWon >= 2,
    the_builder: lastTwoYears(r.built, day).length >= BUILDER_WORKS,
    the_cruel: lastTwoYears(r.weakRaids, day).length >= 3,
    the_coward: ledLost.filter((v) => v.routed).length >= 2,
    the_greedy: r.greedy !== undefined && day - r.greedy >= year(),
    the_unready: ledLost.length >= 3,
  };
}

/** Season by season: what each leader's name rests on now; epithets earned, and lost a year after their facts stopped. */
export function epithetsDay(realm: Realm, day: number): void {
  for (const f of Object.values(realm.figures).sort((a, b) => a.id.localeCompare(b.id))) {
    if (!f.alive || f.role === "beast") continue;
    const r = reputeOf(f);
    // The states a year of which earns a name.
    const eff = effective(f);
    const support = f.support ?? 0;
    if (eff >= 40 && support >= 10) r.good ??= day;
    else delete r.good;
    if (eff <= -40 && support <= -10) r.bad ??= day;
    else delete r.bad;
    const facts = holding(realm, f, day);
    for (const id of Object.keys(facts) as TitleId[]) {
      const def = TITLES[id] as TitleDef;
      if (facts[id]) {
        if (!has(f, id)) awardEpithet(realm, f, id, day, def.description);
        else if (r.lapse?.[id] !== undefined) delete r.lapse[id];
      } else if (has(f, id) && !def.forLife && !(id === "the_cruel" && r.sacked !== undefined)) {
        r.lapse ??= {};
        r.lapse[id] ??= day;
        if (day - r.lapse[id]! >= year()) {
          loseEpithet(realm, f, id, day);
          delete r.lapse[id];
        }
      }
    }
    // The deed ones, kept for life.
    if ((r.broke ?? 0) >= 2) awardEpithet(realm, f, "oathbreaker", day, "broke two treaties");
    if (r.sacked !== undefined) awardEpithet(realm, f, "the_cruel", day, "sacked a place that had given in");
  }
}

/** A figure broke a treaty: two and they are Oathbreaker. */
export function brokeOath(f: Figure): void {
  const r = reputeOf(f);
  r.broke = (r.broke ?? 0) + 1;
}
