import { placeAt } from "@millbrook/shared";
import { parseAway, type PeopleStore, type PersonRow } from "../../store/peopleStore.js";
import type { Realm } from "../realm/types.js";
import { journeyOf } from "./journeys.js";

/**
 * Where people on journeys are (N26 Part E decision 3): a person with `people.away` is not in their home town's crowd; they are on the
 * road, or resting at an inn, or visiting a town, as their journey's formula says at that minute. These read that
 * for a town: who is visiting it now.
 */
export interface Visitor {
  row: PersonRow;
  journey: string;
  /** Whom they came to see (a person id), when they did. */
  visit?: string;
  kind: string;
  /** Their own place is this one (a round trip that has got home but is not closed yet). */
  home: boolean;
}

/** The people of journeys who are in a place at a minute: visitors, and the homecomers not yet counted at home. */
export function visitorsAt(people: PeopleStore, realm: Realm, site: string, minute: number): Visitor[] {
  const out: Visitor[] = [];
  for (const row of people.awayRows()) {
    const away = parseAway(row.away);
    const j = away ? journeyOf(realm, away.journey) : undefined;
    if (!away || !j) continue;
    if (placeAt(j, minute).site !== site) continue;
    out.push({ row, journey: j.id, ...(j.visit ? { visit: j.visit } : {}), kind: j.kind, home: row.site === site });
  }
  return out.sort((a, b) => (a.row.id < b.row.id ? -1 : 1));
}

/** Where someone is now, as the road has it: a place (with the journey), the open road (with the journey), or home (null). */
export function whereNow(people: PeopleStore, realm: Realm, id: string, minute: number): { site: string | null; journey: string; state: string } | null {
  const row = people.get(id);
  const away = row ? parseAway(row.away) : null;
  const j = away ? journeyOf(realm, away.journey) : undefined;
  if (!row || !away || !j) return null;
  const p = placeAt(j, minute);
  return { site: p.site, journey: j.id, state: p.state };
}
