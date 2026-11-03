import { hash2, seedOf } from "../road/noise.js";
import { CHUNK } from "../road/scale.js";

/**
 * Fauna and flora (N28): where the realm's light animals and plants are, as pure functions of the seed, the chunk, the
 * day and the minute, so the server (which draws them into the frame and checks every hunt and gathering) gets the same
 * answer every time and nothing per animal or plant is saved. Species are data (server/src/data/species); these
 * functions take the parts of a species they need. Realm packs (wolves, bears, boars in packs, spiders) are never light.
 */

export type Stage = "bud" | "flower" | "fruit" | "dormant";

export interface AnimalSpec {
  id: string;
  name: string;
  plural: string;
  biomes: Record<string, number>;
  seasons: Record<string, number>;
  abundance: number;
  group: { min: number; max: number };
  /** day, night, dawn, dawn-dusk, always. */
  active: string;
  /** Tiles at which it runs from the player (0: it doesn't). */
  flees: number;
  /** Needs water near (herons, ducks, otters). */
  water?: boolean;
  /** A small creature (songbirds, mice): falls quiet near a predator. */
  small?: boolean;
}

export interface PlantSpec {
  id: string;
  name: string;
  biomes: Record<string, number>;
  /** Stages as shares of the year [from, to); a range past 1 runs into the next year. */
  calendar: Record<Stage, [number, number]>;
  /** How thickly it grows (0..1). */
  cover: number;
}

/** A group of animals now. */
export interface AnimalGroup {
  /** `n:<cx>:<cy>:<k>:<day>`: stable through the day. */
  id: string;
  species: string;
  n: number;
  x: number;
  y: number;
  /** Where it ranges about (its home), for signs and tracking. */
  home: { x: number; y: number };
}

/** A patch of a plant. */
export interface PlantPatch {
  /** `f:<x>:<y>`: a patch stays where it is year after year. */
  id: string;
  species: string;
  x: number;
  y: number;
  stage: Stage;
}

/** What the caller knows of the place. */
export interface NatureCtx {
  /** The country here (the terrain of the nearest place). */
  terrain: string;
  season: string;
  /** Share of the year (0..1). */
  frac: number;
  /** Is there water within a few tiles of a tile? */
  water?: (x: number, y: number) => boolean;
}

/** Is a species about at a minute of the day? */
export function activeAt(active: string, minute: number): number {
  const h = minute / 60;
  const dawn = h >= 4.5 && h < 8;
  const dusk = h >= 18 && h < 21;
  const night = h >= 21 || h < 4.5;
  switch (active) {
    case "night":
      return night ? 1 : dusk || dawn ? 0.4 : 0;
    case "dawn":
      // Songbirds: loud at dawn, about all day.
      return dawn ? 2 : night ? 0 : 0.6;
    case "dawn-dusk":
      return dawn || dusk ? 1.5 : night ? 0.2 : 0.5;
    case "always":
      return 1;
    default:
      return night ? 0 : 1;
  }
}

/** The stage of a plant at a share of the year. */
export function stageOf(cal: PlantSpec["calendar"], frac: number): Stage {
  const f = ((frac % 1) + 1) % 1;
  for (const s of ["fruit", "flower", "bud", "dormant"] as const) {
    const [a, b] = cal[s];
    if ((f >= a && f < b) || (f + 1 >= a && f + 1 < b)) return s;
  }
  return "dormant";
}

/** Groups of light animals in a chunk at a minute of a day (at most two; most chunks one or none). */
export function animalsInChunk(seed: number, specs: AnimalSpec[], cx: number, cy: number, day: number, minute: number, ctx: NatureCtx): AnimalGroup[] {
  const out: AnimalGroup[] = [];
  const part = Math.floor(minute / 360);
  for (let k = 0; k < 2; k++) {
    const h = hash2((seed ^ seedOf(`fauna|${day}|${part}|${k}`)) | 0, cx, cy);
    if (h % 100 >= (k === 0 ? 45 : 20)) continue;
    const hx = cx * CHUNK + 6 + ((h >>> 7) % (CHUNK - 12));
    const hy = cy * CHUNK + 6 + ((h >>> 14) % (CHUNK - 12));
    const nearWater = ctx.water?.(hx, hy) ?? false;
    const weights = specs.map((s) => (s.water && !nearWater ? 0 : (s.biomes[ctx.terrain] ?? 0) * (s.seasons[ctx.season] ?? 1) * s.abundance * activeAt(s.active, minute)));
    const total = weights.reduce((a, b) => a + b, 0);
    if (total <= 0) continue;
    let r = ((h >>> 3) % 10000) / 10000 * total;
    let i = 0;
    for (; i < specs.length - 1; i++) {
      if (r < weights[i]!) break;
      r -= weights[i]!;
    }
    const s = specs[i]!;
    // It ranges round its home through the day: a slow loop, a different one for each group.
    const phase = ((h >>> 11) % 628) / 100;
    const radius = 4 + ((h >>> 19) % 9);
    const a = phase + (minute / 1440) * Math.PI * 4;
    const x = Math.round(hx + Math.cos(a) * radius);
    const y = Math.round(hy + Math.sin(a) * radius * 0.7);
    out.push({ id: `n:${cx}:${cy}:${k}:${day}:${part}`, species: s.id, n: s.group.min + ((h >>> 23) % (s.group.max - s.group.min + 1)), x, y, home: { x: hx, y: hy } });
  }
  return out;
}

/** Patches of plants in a chunk (one 16-tile cell in three or so holds one), at their stage on a share of the year. */
export function plantsInChunk(seed: number, specs: PlantSpec[], cx: number, cy: number, ctx: NatureCtx): PlantPatch[] {
  const out: PlantPatch[] = [];
  for (let gy = 0; gy < CHUNK; gy += 16) for (let gx = 0; gx < CHUNK; gx += 16) {
    const x0 = cx * CHUNK + gx;
    const y0 = cy * CHUNK + gy;
    const h = hash2((seed ^ seedOf("flora")) | 0, x0, y0);
    const weights = specs.map((s) => (s.biomes[ctx.terrain] ?? 0) * s.cover);
    const total = weights.reduce((a, b) => a + b, 0);
    if (total <= 0 || h % 100 >= 34) continue;
    let r = ((h >>> 7) % 10000) / 10000 * total;
    let i = 0;
    for (; i < specs.length - 1; i++) {
      if (r < weights[i]!) break;
      r -= weights[i]!;
    }
    const s = specs[i]!;
    const x = x0 + 2 + ((h >>> 13) % 12);
    const y = y0 + 2 + ((h >>> 18) % 12);
    out.push({ id: `f:${x}:${y}`, species: s.id, x, y, stage: stageOf(s.calendar, ctx.frac) });
  }
  return out;
}
