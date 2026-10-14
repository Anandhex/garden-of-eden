import { graphOf, tilesFrom, type RoadData } from "@millbrook/shared";
import type { Rng } from "../dice.js";
import type { Realm, Settlement } from "../realm/types.js";

/** The shortest road path of settlement ids between two places, or null. */
export function shortest(data: RoadData, from: string, to: string): string[] | null {
  const g = graphOf(data);
  if (from === to || !g.has(from) || !g.has(to)) return null;
  const best = new Map<string, number>([[from, 0]]);
  const prev = new Map<string, string>();
  const open = new Set([from]);
  while (open.size > 0) {
    let cur = "";
    for (const id of open) if (!cur || best.get(id)! < best.get(cur)! || (best.get(id) === best.get(cur) && id < cur)) cur = id;
    open.delete(cur);
    if (cur === to) break;
    for (const e of g.get(cur) ?? []) {
      const d = best.get(cur)! + e.len;
      if (!best.has(e.to) || d < best.get(e.to)!) {
        best.set(e.to, d);
        prev.set(e.to, cur);
        open.add(e.to);
      }
    }
  }
  if (!best.has(to)) return null;
  const path = [to];
  while (path[0] !== from) path.unshift(prev.get(path[0]!)!);
  return path;
}

/** Out and back: [a, b, c] becomes [a, b, c, b, a]; the turn is the last place of the way out. */
export const roundPath = (out: string[]): { path: string[]; index: number } => ({ path: [...out, ...out.slice(0, -1).reverse()], index: out.length - 1 });

/** Tiles a day's walk covers (the pace is fixed: shared/road/scale.ts). */
export const DAY_TILES = 4200;

/** Places within `days` days' walk of `s`, nearest first, that pass `ok`. */
export function placesWithin(data: RoadData, s: Settlement, days: number, ok: (id: string) => boolean): Array<[string, number]> {
  return [...tilesFrom(data, s.id)].filter(([id, t]) => id !== s.id && t <= days * DAY_TILES && ok(id)).sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : 1));
}

/** One of the nearest few places that pass `ok`. */
export function nearby(data: RoadData, s: Settlement, rng: Rng, ok: (id: string) => boolean, days = 5, among = 5): string | null {
  const near = placesWithin(data, s, days, ok).slice(0, among);
  return near.length > 0 ? near[Math.floor(rng() * near.length)]![0] : null;
}

/** Real places (not inns beside the road) that still stand. */
export const standing = (realm: Realm): Settlement[] => Object.values(realm.settlements).filter((s) => !s.way && !s.abandoned).sort((a, b) => a.id.localeCompare(b.id));
