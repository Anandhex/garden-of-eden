import { shortestWay, wildlifeAt, WALK_PACE, type RoadData } from "@millbrook/shared";
import type { PeopleStore } from "../../store/peopleStore.js";
import type { Realm } from "../realm/types.js";
import { rollSegment, STRETCH } from "./situations.js";
import { territoriesNow } from "./territories.js";

/**
 * The beats of a day's walk (N26F decision 1, the `road-beats` bound): everything there is to see or do along a road walked
 * from a gate at 06:00: situations on its stretches, wildlife, places beside the road, territories (a sign, maybe a
 * meeting). Beats closer than BEAT_GAP tiles count as one. The target is 5 to 10 on a day's walk (4,200 tiles).
 */
export const BEAT_GAP = 300;
export const DAY_WALK = 4200;

export interface Beat {
  /** Tiles from the start of the walk. */
  d: number;
  kind: "situation" | "wildlife" | "place" | "territory";
  what: string;
}

const PLACE_KINDS = new Set(["shrine", "farmstead", "stones", "ruin", "cave", "herbs", "ore", "woods", "mine", "waystation", "bridge", "ferry", "tollgate"]);

/** Every beat along the way from `from` to `to`, as walked on `day` from 06:00 (the first DAY_WALK tiles). */
export function beatsAlong(realm: Realm, data: RoadData, from: string, to: string, day: number, people?: PeopleStore): Beat[] {
  const way = shortestWay(data, from, to);
  if (!way) return [];
  const beats: Beat[] = [];
  let base = 0;
  for (const jr of way.roads) {
    const road = data.roads.find((r) => r.id === jr.id);
    if (!road) continue;
    const toD = (t: number) => base + (jr.rev ? road.length - t : t);
    for (let seg = 0; seg * STRETCH < road.length; seg++) {
      const r = rollSegment(realm, data, road, seg, day, people);
      if (r) beats.push({ d: toD(r.t), kind: "situation", what: r.def.id });
    }
    for (const p of data.places) if (p.road === road.id && PLACE_KINDS.has(p.kind)) beats.push({ d: toD(p.t), kind: "place", what: p.kind });
    // Wildlife at the hour the walker is there.
    for (let t = 0; t < road.length; t += 160) {
      const d = toD(t);
      const hour = Math.min(23, 6 + Math.floor(d / WALK_PACE / 60));
      for (const w of wildlifeAt(realm.seed, road, t, t + 159, day, hour)) beats.push({ d, kind: "wildlife", what: w.kind });
    }
    for (const t of territoriesNow(realm, data)) if (t.road === road.id) beats.push({ d: toD((t.t0 + t.t1) / 2), kind: "territory", what: t.id });
    base += road.length;
  }
  return beats.filter((b) => b.d <= DAY_WALK).sort((a, b) => a.d - b.d);
}

/** Beats spaced at least BEAT_GAP apart (the rest merge into the one before). */
export function spaced(beats: Beat[]): Beat[] {
  const out: Beat[] = [];
  for (const b of beats) if (out.length === 0 || b.d - out.at(-1)!.d >= BEAT_GAP) out.push(b);
  return out;
}
