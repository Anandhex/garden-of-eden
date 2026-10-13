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
      added += roster.people.length;
    }
  });
  // The rolled rosters were the generator's scratch; the table has the people now.
  forgetRosters();
  return added;
}
