import { forgetRosters, rosterFor, rowOfTownsperson } from "../game/realm/townsfolk.js";
import type { Realm } from "../game/realm/types.js";
import { siteMap } from "../web/sites.js";
import type { PeopleStore } from "./peopleStore.js";

/**
 * Roll every settlement's people once, when the world is made, and keep them in the database (N18).
 * From then on the table is the truth and `rosterFor` is only the generator: re-rolling an unchanged
 * person later could give a different person (it reads the realm's factions, population and
 * buildings as they are then), so nothing is ever diffed against a roll.
 *
 * One transaction, one prepared statement: about 24,500 people (seed 1) in a few hundred ms.
 */
export function materialisePeople(realm: Realm, people: PeopleStore, day: number): number {
  let added = 0;
  people.transaction(() => {
    for (const s of Object.values(realm.settlements).sort((a, b) => a.id.localeCompare(b.id))) {
      if (s.abandoned) continue;
      const roster = rosterFor(realm, s.id, siteMap(s, "village", realm), day);
      if (!roster) continue;
      people.insertMany(roster.people.map((p) => rowOfTownsperson(p, s.id, day)));
      // Their lives start today: there is no past to live.
      people.setSeq(s.id, { stepped: day });
      added += roster.people.length;
    }
  });
  // The rolled rosters were the generator's scratch; the table has the people now.
  forgetRosters();
  return added;
}

/**
 * Roll the people of any live place that has none yet (a world made without a database, or a place that came
 * to exist later), so that a day's life step never sees an empty place that is really full. Cheap when there is
 * nothing to do. Returns how many people were rolled.
 */
export function ensureLivePeople(realm: Realm, people: PeopleStore, live: ReadonlySet<string>, day: number): number {
  let added = 0;
  for (const id of [...live].sort()) {
    const s = realm.settlements[id];
    if (!s || s.abandoned || s.population <= 0 || people.count(id) > 0) continue;
    const roster = rosterFor(realm, id, siteMap(s, "village", realm), day);
    if (!roster) continue;
    people.insertMany(roster.people.map((p) => rowOfTownsperson(p, id, day)));
    people.setSeq(id, { stepped: day });
    added += roster.people.length;
  }
  if (added > 0) forgetRosters();
  return added;
}
