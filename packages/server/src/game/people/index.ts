import type { PeopleStore, PersonRow } from "../../store/peopleStore.js";
import type { WorldStore } from "../db.js";
import type { Realm } from "../realm/types.js";
import { parseTownsfolkId } from "../realm/townsfolk.js";
import { type DeathRecord, parseDeath, isDead } from "./death.js";
import { recordLifeEvent } from "./events.js";
import { ageFrom } from "./rules.js";

/**
 * One way to name a person (plans README section 6, N25). Three kinds of people exist, with three stores:
 * the cast (talking NPCs, `cast:<persona id>`), realm figures (`figure:<id>`), and townsfolk (rows of
 * `people`, `town:<id>`). The stores stay apart; this facade is how everything new (lineage, death records,
 * the admin view) asks about a person without caring which store they live in.
 */
export type PersonKind = "cast" | "figure" | "townsperson" | "creature";
export interface PersonRef {
  kind: PersonKind;
  id: string;
}

/** Which store an id belongs to, by its shape and what the world holds. */
export function personRef(id: string, realm?: Pick<Realm, "figures"> | null, castIds?: ReadonlySet<string>): PersonRef {
  if (parseTownsfolkId(id)) return { kind: "townsperson", id };
  if (realm?.figures[id]) return { kind: "figure", id };
  if (castIds?.has(id)) return { kind: "cast", id };
  return { kind: "cast", id };
}

/** A townsperson's row, or null. */
export const rowOf = (people: PeopleStore, id: string): PersonRow | null => people.get(id);

/** The people in a person's family, for the admin card and for the kin rules. */
export interface Lineage {
  mother: PersonRow | null;
  father: PersonRow | null;
  spouse: PersonRow | null;
  children: PersonRow[];
  siblings: PersonRow[];
}

export function lineageOf(people: PeopleStore, row: PersonRow): Lineage {
  const mother = row.mother ? people.get(row.mother) : null;
  const father = row.father ? people.get(row.father) : null;
  const spouse = row.spouse ? people.get(row.spouse) : null;
  const children = people.childrenOf(row.id);
  const siblings = new Map<string, PersonRow>();
  for (const parent of [row.mother, row.father]) if (parent) for (const c of people.childrenOf(parent)) if (c.id !== row.id) siblings.set(c.id, c);
  return { mother, father, spouse, children, siblings: [...siblings.values()].sort((a, b) => a.born_day - b.born_day || (a.id < b.id ? -1 : 1)) };
}

/** Alive: a row with no death, or one that is only missing. */
export const isAliveRow = (r: Pick<PersonRow, "death">): boolean => !isDead(parseDeath(r.death)) && (r.death === null || parseDeath(r.death)?.cause === "missing");

/** "Maud Reed, 34, a baker's wife": a line for a person in news and cards. */
export function describeRow(r: PersonRow, day: number): string {
  return `${r.name}, ${ageFrom(r.born_day, day)}, ${r.job}`;
}

/**
 * A townsperson died somewhere the daily step doesn't see: killed in play, or their talking-NPC self died. Marks the
 * row dead (once), widows their spouse, and records the death like any other. Returns true if they were alive.
 */
export function killPerson(realm: Realm, store: WorldStore, id: string, rec: Omit<DeathRecord, "site"> & { site?: string | null }): boolean {
  const people = store.people;
  const r = people.get(id);
  if (!r || r.death !== null) return false;
  const record: DeathRecord = { ...rec, site: rec.site ?? r.site };
  people.update(id, { death: JSON.stringify(record), expecting: null });
  const spouse = r.spouse ? people.get(r.spouse) : null;
  if (spouse && spouse.death === null) people.update(spouse.id, { spouse: null });
  recordLifeEvent(realm, store, { kind: "death", actor: id, target: rec.killer ?? "", site: r.site, day: rec.day, details: `${r.name} died (${record.cause}), aged ${ageFrom(r.born_day, rec.day)}`, importance: 4 + (rec.cause === "old-age" || rec.cause === "illness" ? 0 : 1) });
  return true;
}

export { parseDeath };
