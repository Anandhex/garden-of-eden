import { HOME_ID, travelDays } from "./generate.js";
import type { DirectorPush, Realm } from "./types.js";

/** Realm news kept (oldest go first). */
export const MAX_NEWS = 200;
/** Director decisions kept. */
export const MAX_PUSHES = 80;

/**
 * Something happened in the realm: a line of news, dated, with where it happened,
 * so it reaches Millbrook after the days a traveller takes (game/realm/news.ts).
 * `names`: proper names in it, for the lore's invented-name check.
 */
export function realmNews(realm: Realm, day: number, at: string | null, kind: string, text: string, importance: number, names: string[] = [], extra: { why?: string; people?: string[] } = {}): void {
  const reaches = day + (at === HOME_ID ? 0 : travelDays(realm, at, HOME_ID));
  const all = [...new Set([...names, ...namesIn(realm, text)])];
  const people = [...new Set([...(extra.people ?? []), ...peopleNamed(realm, all)])];
  realm.news.push({
    id: `rn${realm.next++}`,
    day,
    text,
    at,
    kind,
    importance: Math.max(1, Math.min(10, importance)),
    reaches,
    names: all,
    ...(people.length > 0 ? { people } : {}),
    ...(extra.why ? { why: extra.why } : {}),
  });
  if (realm.news.length > MAX_NEWS) {
    // Drop the least important delivered (or old) one first.
    let drop = 0;
    for (let i = 1; i < realm.news.length; i++) if (realm.news[i]!.importance < realm.news[drop]!.importance) drop = i;
    realm.news.splice(drop, 1);
  }
}

/** The figures (ids) whose names are among `names`. Names are unique in a realm (takenNames), so a name is enough. */
function peopleNamed(realm: Realm, names: string[]): string[] {
  if (names.length === 0) return [];
  const want = new Set(names);
  return Object.values(realm.figures).filter((f) => want.has(f.name)).map((f) => f.id);
}

/** Every realm name the text mentions (places, kingdoms, people, factions, dungeons). */
export function namesIn(realm: Realm, text: string): string[] {
  const all = [
    ...Object.values(realm.settlements).map((s) => s.name),
    ...Object.values(realm.kingdoms).map((k) => k.name),
    ...Object.values(realm.figures).map((f) => f.name),
    ...Object.values(realm.factions).map((f) => f.name.replace(/^the /, "")),
    ...Object.values(realm.dungeons).map((d) => d.name.replace(/^the /, "")),
  ];
  return all.filter((n) => text.includes(n));
}

/** Count something that happened (the sim and tests read these). */
export function tally(realm: Realm, key: string, n = 1): void {
  realm.stats[key] = (realm.stats[key] ?? 0) + n;
}

/** The director's decision log. */
export function logPush(realm: Realm, push: DirectorPush): void {
  realm.director.push(push);
  if (realm.director.length > MAX_PUSHES) realm.director.shift();
}
