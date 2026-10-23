import type { AmbitionRow } from "../../store/careerStore.js";
import type { PersonRow } from "../../store/peopleStore.js";
import type { WorldStore } from "../db.js";
import { feelings } from "../chatter/rel.js";
import { temperOf } from "../chatter/person.js";
import { streamFor } from "../dice.js";
import { ageFrom } from "../people/rules.js";
import { traitsOfRow } from "../people/traits.js";
import type { Realm } from "../realm/types.js";
import { speciesOf } from "../../world/species.js";
import { standingOf } from "./careers.js";
import { councilClass } from "./pick.js";

/**
 * Scarce seats (N40): a guild's officers and master in a place, the council, the captain of the guard. A seat is derived from the place (its
 * guilds, its size, its walls), so it needs no table; who holds it is an open `jobs_held` row `seat:<id>`. When one falls free, everyone
 * whose ambition is that seat and whose standing qualifies is a candidate; the seat's rule picks (a guild votes by what its members think
 * of each candidate, a council seat or a captaincy is the head's appointment); the losers bear the winner a grievance.
 */
export type SeatKind = "guild_officer" | "guild_master" | "council" | "captain";

export interface Seat {
  id: string;
  site: string;
  kind: SeatKind;
  /** The guild, for a guild's seats. */
  faction?: string;
  /** "an officer of the Smiths' Guild", for the words. */
  title: string;
  rule: "vote" | "appointed";
}

const COUNCIL: Record<string, number> = { hamlet: 0, village: 2, town: 3, city: 4, capital: 5 };

/** The seats of a place, in a fixed order. `members`: a guild's members living there (by faction). */
export function seatsOf(realm: Realm, site: string, guilds: ReadonlySet<string>, members: ReadonlyMap<string, number>): Seat[] {
  const s = realm.settlements[site];
  if (!s) return [];
  const out: Seat[] = [];
  for (const fac of [...guilds].sort()) {
    const f = realm.factions[fac];
    const n = members.get(fac) ?? 0;
    if (!f || n < 4) continue;
    out.push({ id: `g:${fac}:${site}:master`, site, kind: "guild_master", faction: fac, title: `master of the ${f.name} in ${s.name}`, rule: "vote" });
    for (let k = 1; k <= (n >= 10 ? 2 : 1); k++) out.push({ id: `g:${fac}:${site}:officer:${k}`, site, kind: "guild_officer", faction: fac, title: `an officer of the ${f.name} in ${s.name}`, rule: "vote" });
  }
  for (let k = 1; k <= (COUNCIL[s.kind] ?? 0); k++) out.push({ id: `council:${site}:${k}`, site, kind: "council", title: `a councillor of ${s.name}`, rule: "appointed" });
  if ((s.buildings.walls ?? 0) > 0 || (s.buildings.barracks ?? 0) > 0) out.push({ id: `captain:${site}`, site, kind: "captain", title: `captain of the guard of ${s.name}`, rule: "appointed" });
  return out;
}

/** The seat a holder's `seat:` job names, as a seat id. */
export const seatIdOf = (job: string): string => job.slice("seat:".length);

/**
 * Who may stand for a seat. With `ambitious`, only those whose ambition is the seat and whose progress qualifies (a seat falling free);
 * without, anyone the seat's rule would take (a place's first day: its seats were held before the story began).
 */
export function mayStand(seat: Seat, r: PersonRow, amb: AmbitionRow | null, held: readonly string[], day: number, kind: string, ambitious: boolean): boolean {
  const grown = ageFrom(r.born_day, day) - speciesOf(r.species).adultAge;
  if (r.job === "child" || r.job === "elder" || r.away || grown < 2) return false;
  if (held.some((h) => h === seat.id)) return false;
  const officerOf = (fac: string) => held.some((h) => h.startsWith(`g:${fac}:`) && h.includes(":officer"));
  switch (seat.kind) {
    case "guild_officer":
      if (r.faction !== seat.faction || officerOf(seat.faction!) || held.some((h) => h.startsWith(`g:${seat.faction}:`) && h.endsWith(":master"))) return false;
      return !ambitious || (amb?.kind === "guild_seat" && amb.target === seat.faction && amb.step === 0 && amb.progress >= 0.5);
    case "guild_master":
      if (r.faction !== seat.faction) return false;
      if (!ambitious) return grown >= 6;
      return amb?.kind === "guild_seat" && amb.target === seat.faction && amb.step === 1 && officerOf(seat.faction!);
    case "council":
      if (standingOf(r) < councilClass(kind) || held.some((h) => h.startsWith("council:")) || grown < 6) return false;
      return !ambitious || (amb?.kind === "office" && amb.step === 0 && amb.progress >= 0.5);
    case "captain":
      if (r.job !== "guard" && r.job !== "knight") return false;
      if ((r.skill ?? 0) < 3) return false;
      return !ambitious || amb?.kind === "knighthood" || amb?.kind === "office";
  }
}

export interface Contest {
  seat: Seat;
  winner: string;
  /** Every candidate's score, best first. */
  scores: Array<{ who: string; score: number; parts: Array<[string, number]> }>;
  /** Who decided: the members (a vote), or the head's person id. */
  decider: string;
}

const round = (n: number) => Math.round(n * 1000) / 1000;
const regard = (store: WorldStore, a: string, b: string, day: number): number => {
  const f = feelings(store.social.rel(a, b), day);
  return (f.trust + f.affection + f.respect) / 300;
};

/**
 * Pick the winner of a seat by its rule. A guild's vote: what its members here think of each candidate (trust, affection and respect),
 * their skill and years, and a little luck. An appointment: what the head thinks of them, their class and skill, how many respect them, and
 * a little luck. Pure in `(seed, rows, relationships, day)`.
 */
export function decideSeat(store: WorldStore, realm: Realm, seat: Seat, candidates: readonly PersonRow[], voters: readonly PersonRow[], day: number): Contest {
  const head = realm.settlements[seat.site]?.leader ? realm.figures[realm.settlements[seat.site]!.leader!] : undefined;
  const decider = seat.rule === "vote" ? "members" : (head?.person ?? head?.id ?? "the head");
  const scores = candidates.map((c) => {
    const roll = streamFor(realm.seed, "seat", seat.id, c.id, day)();
    const grown = Math.min(20, ageFrom(c.born_day, day) - speciesOf(c.species).adultAge);
    const parts: Array<[string, number]> = [["skill", 0.12 * (c.skill ?? 0)], ["years", 0.02 * grown], ["luck", 0.3 * roll]];
    if (seat.rule === "vote") {
      const others = voters.filter((v) => v.id !== c.id).slice(0, 40);
      const sum = others.reduce((s, v) => s + regard(store, v.id, c.id, day), 0);
      parts.push(["the members' regard", others.length > 0 ? (2 * sum) / others.length : 0]);
    } else {
      if (head?.person) parts.push(["the head's regard", 1.5 * regard(store, head.person, c.id, day)]);
      const respected = store.social.relsAbout(c.id).filter((r) => feelings(r, day).respect >= 15).length;
      parts.push(["respected", Math.min(0.5, 0.05 * respected)], ["class", 0.08 * standingOf(c)]);
    }
    return { who: c.id, score: round(parts.reduce((s, [, v]) => s + v, 0)), parts: parts.map(([l, v]): [string, number] => [l, round(v)]) };
  });
  scores.sort((a, b) => b.score - a.score || (a.who < b.who ? -1 : 1));
  return { seat, winner: scores[0]!.who, scores, decider };
}

/** How hard a loss lands: how close they came, and their pride and ambition. */
export function lossWeight(loser: PersonRow, mine: number, best: number): number {
  const closeness = best > 0 ? Math.max(0, Math.min(1, mine / best)) : 1;
  const pride = 0.5 * temperOf(loser).pride + 0.5 * traitsOfRow(loser).ambition;
  return round(Math.min(1, 0.25 + 0.55 * closeness * pride + 0.1 * closeness));
}

/**
 * Whose say decides the next rung of someone's seat ambition (the menu's flatter and petition go to them): a guild's master and officers
 * here (its vote is theirs to sway), or the person behind the head of the place (a council seat, the captaincy).
 */
export function decidersOf(store: WorldStore, realm: Realm, row: Pick<PersonRow, "id" | "site">, amb: Pick<AmbitionRow, "kind" | "target" | "step"> | null): string[] {
  if (!amb) return [];
  const out = new Set<string>();
  if (amb.kind === "guild_seat" && amb.target) {
    for (const h of store.careers.holdersOf(`seat:g:${amb.target}:${row.site}:`)) out.add(h.who);
  } else if (amb.kind === "office" || amb.kind === "knighthood") {
    const head = realm.settlements[row.site]?.leader ? realm.figures[realm.settlements[row.site]!.leader!] : undefined;
    if (head?.person) out.add(head.person);
    if (amb.kind === "office") for (const h of store.careers.holdersOf(`seat:council:${row.site}:`)) out.add(h.who);
    else for (const h of store.careers.holdersOf(`seat:captain:${row.site}`)) out.add(h.who);
  } else if (amb.kind === "master_trade" && amb.step === 1 && amb.target) {
    // The masters of the trade here decide who is one of them.
    for (const h of store.careers.holdersOf(`shop:${row.site}:${amb.target}`)) out.add(h.who);
  }
  out.delete(row.id);
  return [...out].sort();
}

/** Does someone hold any seat now? */
export const holdsSeat = (store: WorldStore, who: string): boolean => store.careers.openJobs(who).some((j) => j.job.startsWith("seat:"));
