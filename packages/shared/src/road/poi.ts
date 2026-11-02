import { seedOf } from "./noise.js";
import type { PlaceKind, RoadPath } from "./types.js";

/**
 * Places beside the road (N26F decision 8, the start of N27's points of interest): old things nobody owns, seeded by the
 * road and the country it runs through, about one every POI_EVERY tiles, a short way off the road and visible from it.
 * Standing stones (a landmark), an old ruin and a cave (searched; a cave inside a pack's stretch is its den), a herb patch
 * (gathered, regrows) and an ore outcrop (dug with a pick, regrows slowly). Anything with a person in it (a hermit) is a
 * real row's and comes later (N27 step 7). Pure: the server adds them to the road data, and the chunks draw them.
 */
export const POI_EVERY = 700;

export type PoiKind = Extract<PlaceKind, "stones" | "ruin" | "cave" | "herbs" | "ore">;

/** What each country tends to hold, with weights. */
const BY_COUNTRY: Record<string, Array<[PoiKind, number]>> = {
  forest: [["herbs", 4], ["cave", 2], ["ruin", 2], ["stones", 1]],
  hills: [["ore", 4], ["cave", 3], ["stones", 2], ["ruin", 1], ["herbs", 1]],
  marsh: [["herbs", 4], ["ruin", 2], ["stones", 1]],
  coast: [["ruin", 2], ["stones", 2], ["herbs", 1], ["cave", 1]],
  valley: [["herbs", 3], ["stones", 2], ["ruin", 2], ["ore", 1]],
  plains: [["stones", 3], ["ruin", 2], ["herbs", 2]],
};

export const POI_NAMES: Record<PoiKind, string> = {
  stones: "standing stones",
  ruin: "an old ruin",
  cave: "a cave",
  herbs: "a patch of herbs",
  ore: "an ore outcrop",
};

export interface PoiSpot {
  kind: PoiKind;
  /** Tiles along the road. */
  t: number;
  /** Tiles off the road, and which side (1 left, -1 right). */
  off: number;
  side: 1 | -1;
}

/** The places beside one road. `country`: the terrain of its two ends. */
export function roadsidePlaces(seed: number, road: RoadPath, country: [string, string]): PoiSpot[] {
  const out: PoiSpot[] = [];
  for (let t = Math.round(POI_EVERY / 2), k = 0; t < road.length - 150; t += POI_EVERY, k++) {
    const h = seedOf(`${seed}|poi|${road.id}|${k}`) >>> 0;
    if (h % 100 >= 80) continue;
    // The country of the nearer end.
    const weights = BY_COUNTRY[t < road.length / 2 ? country[0] : country[1]] ?? BY_COUNTRY.plains!;
    const total = weights.reduce((a, [, w]) => a + w, 0);
    let r = ((h >>> 7) % 1000) / 1000 * total;
    let kind: PoiKind = weights[0]![0];
    for (const [kk, w] of weights) {
      if (r < w) {
        kind = kk;
        break;
      }
      r -= w;
    }
    out.push({ kind, t: t + ((h >>> 17) % 240) - 120, off: 8 + ((h >>> 3) % 22), side: (h >>> 25) % 2 === 0 ? 1 : -1 });
  }
  return out;
}
