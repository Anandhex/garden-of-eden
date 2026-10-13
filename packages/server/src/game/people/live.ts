import { config } from "../../config.js";
import { HOME_ID, distance } from "../realm/generate.js";
import type { Realm } from "../realm/types.js";

/**
 * Which places have people who live (N25): rows in the database that age, marry, have children, move and
 * die, with the settlement's population a count of them. Elsewhere the realm keeps its population as a
 * number, as before. `config.peopleLive` is "all", "off", "slice" (Millbrook and its nearest neighbour: the
 * vertical slice) or a comma-separated list of settlement ids, so widening is a setting, not a code change.
 */
export function liveSites(realm: Pick<Realm, "settlements">, spec: string = config.peopleLive): Set<string> {
  const all = Object.keys(realm.settlements);
  const text = spec.trim().toLowerCase();
  if (text === "off" || text === "") return new Set();
  if (text === "all") return new Set(all);
  if (text === "slice") {
    const home = realm.settlements[HOME_ID];
    if (!home) return new Set();
    const near = home.roads
      .filter((id) => realm.settlements[id] && !realm.settlements[id]!.abandoned)
      .sort((a, b) => distance(realm as Realm, HOME_ID, a) - distance(realm as Realm, HOME_ID, b) || a.localeCompare(b))[0];
    return new Set(near ? [HOME_ID, near] : [HOME_ID]);
  }
  return new Set(spec.split(",").map((s) => s.trim()).filter((id) => realm.settlements[id]));
}

/** Places whose days are only worked out when something needs them (`config.peopleLazy`). */
export function lazySites(spec: string = config.peopleLazy): Set<string> {
  return new Set(spec.split(",").map((s) => s.trim()).filter(Boolean));
}
