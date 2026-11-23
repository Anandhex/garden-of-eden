/**
 * How a place is built (G8): its style (shared styles.ts) from the people who live there, its kingdom's culture, its
 * land and its size; and its culture's colours, for painted roofs and market awnings. Read by the view, never stored:
 * the same place looks the same on every visit, and a place that changes hands is rebuilt in its new masters' colours.
 */
import { styleIdFor } from "@millbrook/shared/view";
import type { Realm } from "../realm/types.js";
import { cultureAt } from "./model.js";

export interface BuildLook {
  style?: string;
  colours?: string[];
}

export function buildLookOf(realm: Realm, site: string): BuildLook | null {
  const s = realm.settlements[site];
  if (!s) return null;
  // Another people's hold builds its own way; a human place, or one of them living among humans, its kingdom's.
  const k = s.kingdom ? realm.kingdoms[s.kingdom] : undefined;
  const species = s.species ?? (k?.species && k.capital === s.id ? k.species : undefined);
  const culture = cultureAt(realm, site);
  const style = styleIdFor({ culture: culture?.template, terrain: s.terrain, species, kind: s.kind });
  return { ...(style ? { style } : {}), ...(culture && !(species && species !== "human") ? { colours: culture.colours } : {}) };
}
