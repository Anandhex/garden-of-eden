import { config } from "../../config.js";
import type { PeopleStore, PersonRow } from "../../store/peopleStore.js";
import { fame } from "../office/repute.js";
import type { SocialStore } from "../../store/socialStore.js";
import type { BeastStore } from "../../store/beastStore.js";
import { seedFrom } from "../dice.js";
import type { Who } from "../spawning.js";
import type { Figure, Realm } from "./types.js";

/**
 * Picking real people for a scene (N26F step 0b, plans README section 21): every raider, ambusher, lookout or deserter
 * met on a map is a realm figure or a row of the `people` table, picked by job and place, never made for the scene.
 * The picks are stable for a seed string, so the same raid brings the same people however often it is looked at.
 */

/** Jobs that fight first, best first. */
const FIGHTING_JOBS = ["guard", "soldier", "sellsword", "hunter", "smith", "miner", "labourer", "carter", "farmer"];

/** Age in years on `day`. */
export const ageOn = (r: Pick<PersonRow, "born_day">, day: number): number => (day - r.born_day) / config.daysPerYear;

/** A stable order for a seed: each id's hash with the seed. */
function shuffleKey(seed: string, id: string): number {
  return seedFrom(`${seed}:${id}`);
}

/** Living, at home, grown and not old: who can go and fight. */
export function ableBodied(rows: PersonRow[], day: number): PersonRow[] {
  return rows.filter((r) => r.death === null && !r.away && r.persona === null && ageOn(r, day) >= 16 && ageOn(r, day) <= 55);
}

/**
 * Up to `n` fighters of a place, as people: those whose job fights first, then the rest, stable for `seed`.
 * Talkers (rows with a persona) aren't taken: they are on the map as themselves.
 */
export function pickFighters(people: PeopleStore, site: string, n: number, day: number, seed: string): Who[] {
  if (n <= 0) return [];
  const rows = ableBodied(people.loadSite(site, "full") as PersonRow[], day);
  const rank = (r: PersonRow) => {
    const i = FIGHTING_JOBS.indexOf(r.job);
    return i < 0 ? FIGHTING_JOBS.length : i;
  };
  return rows
    .sort((a, b) => rank(a) - rank(b) || shuffleKey(seed, a.id) - shuffleKey(seed, b.id))
    .slice(0, n)
    .map((r) => ({ name: r.name, person: r.id, ...(r.figure ? { figure: r.figure } : {}) }));
}

/** Living figures by id, as people who can come (not talkers: they come as themselves). */
export function whoOfFigures(realm: Realm, ids: string[]): Who[] {
  return ids
    .map((id) => realm.figures[id])
    .filter((f): f is Figure => !!f && f.alive && !f.talks && !f.away)
    .map((f) => ({ name: f.name, figure: f.id }));
}

/** The members of a gang who are about (alive, not away, not talking), the chief first, then by renown. */
export function gangMembers(realm: Realm, gangId: string): Figure[] {
  const g = realm.factions[gangId];
  if (!g) return [];
  return g.members
    .map((id) => realm.figures[id])
    .filter((f): f is Figure => !!f && f.alive && !f.talks && !f.away)
    .sort((a, b) => (b.id === g.leader ? 1 : 0) - (a.id === g.leader ? 1 : 0) || fame(b) - fame(a) || (a.id < b.id ? -1 : 1));
}

/** One gang member for a duty today (a lookout), turn and turn about, stable for the day. */
export function memberOnDuty(realm: Realm, gangId: string, day: number, duty: string): Figure | null {
  const all = gangMembers(realm, gangId).filter((f) => f.id !== realm.factions[gangId]?.leader);
  const pool = all.length > 0 ? all : gangMembers(realm, gangId);
  if (pool.length === 0) return null;
  const sorted = [...pool].sort((a, b) => shuffleKey(`${duty}:${gangId}`, a.id) - shuffleKey(`${duty}:${gangId}`, b.id));
  return sorted[day % sorted.length]!;
}

/**
 * Who comes with someone to settle a score (a revenge ambush): their kin and friends who like them well enough (N37
 * relationships), else members of a gang seated where they live. Never more than `n`, never made up.
 */
export function helpersOf(realm: Realm, people: PeopleStore, social: SocialStore | null, who: string, n: number, day: number): Who[] {
  const row = people.get(who);
  if (!row) return [];
  const out: Who[] = [];
  const able = (r: PersonRow | null): r is PersonRow => !!r && r.death === null && !r.away && r.persona === null && ageOn(r, day) >= 16 && ageOn(r, day) <= 60;
  const add = (r: PersonRow) => {
    if (out.length < n && r.id !== who && !out.some((w) => w.person === r.id)) out.push({ name: r.name, person: r.id });
  };
  // Kin first: grown children, siblings, the spouse.
  const kin = [row.spouse, ...people.childrenOf(who).map((c) => c.id)].filter((x): x is string => !!x).map((id) => people.get(id));
  for (const r of kin) if (able(r)) add(r);
  // Then friends who'd go for them.
  if (social) {
    const friends = social
      .relsOf(who)
      .filter((rel) => rel.affection >= 30 && rel.trust >= 20)
      .sort((a, b) => b.affection - a.affection || (a.b < b.b ? -1 : 1));
    for (const rel of friends) {
      const r = people.get(rel.b);
      if (able(r) && r.site === row.site) add(r);
    }
  }
  // Then hired men: a gang of the place.
  if (out.length < n) {
    const gang = Object.values(realm.factions).find((f) => f.kind === "gang" && f.dissolved === undefined && (f.seat === row.site || f.branches.includes(row.site)));
    if (gang) for (const f of gangMembers(realm, gang.id)) if (out.length < n) out.push({ name: f.name, figure: f.id });
  }
  return out;
}

/** Is this person still there to come: a figure alive and at hand, a row alive and at home? */
export function stillThere(realm: Realm | undefined, people: PeopleStore | null | undefined, beasts?: BeastStore | null): (w: Who) => boolean {
  return (w) => {
    if (w.beast && beasts) {
      const b = beasts.get(w.beast);
      if (!b || b.died !== null) return false;
    }
    if (w.figure && realm) {
      const f = realm.figures[w.figure];
      if (!f || !f.alive) return false;
    }
    if (w.person && people) {
      const r = people.get(w.person);
      if (!r || r.death !== null) return false;
    }
    return true;
  };
}
