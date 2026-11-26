/**
 * G8 locality: what a place is like, for how its buildings are built. The culture says how its people build; the land
 * (marsh, hills, forest, coast...), how well the place lives (prosperity) and how big it is say what the place does to
 * that. Sent with every frame as `map.locale`; the Unity builder (LocaleArch.cs) turns it into stilts, footings, eaves,
 * whitewash and taller or plainer houses.
 */
import type { Frame } from "@garden-of-eden/shared/view";
import { cultureAt } from "../game/culture/model.js";
import type { Realm } from "../game/realm/types.js";

export type Locale = NonNullable<Frame["map"]["locale"]>;

/** The locale of a settlement, or null when the realm doesn't have it. */
export function localeOf(realm: Realm | null | undefined, site: string | null | undefined): Locale | null {
  const s = realm && site ? realm.settlements[site] : undefined;
  if (!realm || !s) return null;
  const wealth = Math.round(Math.max(0, Math.min(1, s.prosperity / 100)) * 100) / 100;
  const c = cultureAt(realm, s.id);
  return { culture: c?.template ?? "", terrain: s.terrain, wealth, size: s.kind, ...(c ? { colours: c.colours } : {}) };
}
