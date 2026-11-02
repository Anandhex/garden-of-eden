import { MARK, STAGE, type CropDef, type FieldEvent, type Plot, type Sowing } from "./types.js";

/**
 * How a plot stands on a day, tile by tile (N26G decision 3): from its sowing, the crop's calendar and what happened to it.
 * Nothing is stored per tile per day; the server and the browser work out the same field from the same events.
 */
export function growthAt(plot: Pick<Plot, "w" | "h">, sowing: Sowing | undefined, crop: CropDef | undefined, events: FieldEvent[], day: number): Uint8Array {
  const n = plot.w * plot.h;
  const out = new Uint8Array(n);
  if (!sowing || !crop || day < sowing.day) return out;
  const d = day - sowing.day;
  const f = d / Math.max(1, crop.grow);
  const base = f < 0.12 ? STAGE.sown : f < 0.35 ? STAGE.shoots : f < 0.65 ? STAGE.grown : f < 1 ? STAGE.tall : d < crop.grow + crop.ripe ? STAGE.ripe : STAGE.rotting;
  out.fill(base);
  // What happened since it was sown, in order: marks where they fell, stubble where it was reaped.
  for (const e of events.filter((x) => x.day >= sowing.day && x.day <= day).sort((a, b) => a.day - b.day)) {
    const tiles = e.tiles.length > 0 ? e.tiles : Array.from({ length: n }, (_, i) => i);
    if (e.kind === "harvest") {
      for (const i of tiles) if (i < n && out[i]! < 10) out[i] = STAGE.stubble;
      continue;
    }
    const mark = MARK[e.kind];
    if (mark === undefined) continue;
    for (const i of tiles) if (i < n && out[i] !== STAGE.stubble) out[i] = mark;
  }
  return out;
}

/** The day of the year (1..daysPerYear). */
export const dayOfYear = (day: number, daysPerYear: number): number => ((((day - 1) % daysPerYear) + daysPerYear) % daysPerYear) + 1;
/** Which year it is (0 is the first). */
export const yearOf = (day: number, daysPerYear: number): number => Math.floor((day - 1) / daysPerYear);
