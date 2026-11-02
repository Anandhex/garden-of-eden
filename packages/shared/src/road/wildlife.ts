import { seedOf } from "./noise.js";
import { besideRoad } from "./territory.js";
import type { RoadPath } from "./types.js";

/**
 * Light wildlife (N26F decision 7, N28 decision 2): realistic animals that nobody owns, drawn along the road and never
 * simulated or saved one by one. Which animals are where on a stretch of road at an hour of a day is a pure function of
 * the seed, so the server and the browser see the same deer by the same bend. Hunting one makes it a real creature
 * (the server checks it is really there, and remembers it was taken that day).
 */
export const WILD_KINDS = ["deer", "hare", "fox", "crow", "heron", "adder", "boar"] as const;
export type WildKind = (typeof WILD_KINDS)[number];

export interface Wild {
  /** `a:<road>:<cell>:<part of the day>:<day>`, stable while it is there. */
  id: string;
  kind: WildKind;
  x: number;
  y: number;
  /** How many: a herd of deer, a flock of crows, a lone fox. */
  n: number;
}

/** What the caller knows of the land, so the animals are where they would be. */
export interface WildLand {
  /** Water within a few tiles (herons stand in it). */
  water?: (x: number, y: number) => boolean;
  /** A warm day (adders bask). */
  warm?: boolean;
  /** Winter: no adders, fewer of everything. */
  winter?: boolean;
}

/** Tiles of road per cell; each cell may hold one group. */
export const WILD_CELL = 160;

/** The kinds that are about at an hour, with their weights. */
function weightsAt(hour: number, land: WildLand): Array<[WildKind, number]> {
  const dawn = hour >= 5 && hour < 8;
  const dusk = hour >= 18 && hour < 21;
  const night = hour >= 21 || hour < 5;
  return [
    ["deer", dawn || dusk ? 5 : night ? 1 : 2],
    ["hare", night ? 1 : 4],
    ["fox", dusk || night ? 3 : 0.5],
    ["crow", night ? 0 : 5],
    ["heron", night || !land.water ? 0 : 3],
    ["adder", land.warm && !land.winter && !night && hour >= 10 && hour < 17 ? 2 : 0],
    ["boar", dusk || dawn ? 1 : 0.2],
  ];
}

const GROUP: Record<WildKind, [number, number]> = { deer: [1, 5], hare: [1, 2], fox: [1, 1], crow: [3, 9], heron: [1, 1], adder: [1, 1], boar: [1, 1] };

/** The animals along `road` between `t0` and `t1` tiles, on `day` at `hour`. */
export function wildlifeAt(seed: number, road: RoadPath, t0: number, t1: number, day: number, hour: number, land: WildLand = {}): Wild[] {
  const out: Wild[] = [];
  const lo = Math.max(0, Math.floor(t0 / WILD_CELL));
  const hi = Math.min(Math.floor(road.length / WILD_CELL), Math.floor(t1 / WILD_CELL));
  // Animals move about through a day, so the roll is by the day and the time of it (four parts).
  const part = hour < 5 || hour >= 21 ? 0 : hour < 11 ? 1 : hour < 17 ? 2 : 3;
  for (let cell = lo; cell <= hi; cell++) {
    const h = seedOf(`${seed}|wild|${road.id}|${cell}|${day}|${part}`) >>> 0;
    // About one cell in five has something by day (two to four sightings on a day's walk); fewer at night and in winter.
    const chance = (part === 0 ? 90 : 200) * (land.winter ? 0.6 : 1);
    if (h % 1000 >= chance) continue;
    const t = cell * WILD_CELL + ((h >>> 10) % WILD_CELL);
    const side = ((h >>> 20) % 2 === 0 ? 1 : -1) * (8 + ((h >>> 21) % 34));
    const at = besideRoad(road, Math.min(road.length, t), side);
    const weights = weightsAt(hour, { ...land, water: land.water && land.water(at.x, at.y) ? land.water : undefined });
    const total = weights.reduce((a, [, w]) => a + w, 0);
    if (total <= 0) continue;
    let r = ((h >>> 3) % 1000) / 1000 * total;
    let kind: WildKind = weights[0]![0];
    for (const [k, w] of weights) {
      if (r < w) {
        kind = k;
        break;
      }
      r -= w;
    }
    const [a, b] = GROUP[kind];
    out.push({ id: `a:${road.id}:${cell}:${part}:${day}`, kind, x: at.x, y: at.y, n: a + ((h >>> 13) % (b - a + 1)) });
  }
  return out;
}
