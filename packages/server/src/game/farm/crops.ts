import { readdirSync, readFileSync } from "node:fs";
import { z } from "zod";
import type { CropDef } from "@millbrook/shared";

/** The crops (N26G decision 4): data/crops/*.json, checked on load (and by `npm run check-npcs`). */
export const CropSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9_]+$/),
    name: z.string().min(1),
    sow: z.tuple([z.number().int().min(1), z.number().int().min(1)]),
    grow: z.number().int().positive(),
    ripe: z.number().int().positive(),
    yield: z.number().positive(),
    likes: z.array(z.string()),
    dislikes: z.array(z.string()),
    eatenBy: z.array(z.string()),
    frost: z.boolean(),
    flood: z.boolean(),
    on: z.enum(["field", "meadow", "orchard"]),
  })
  .strict();

const DIR = new URL("../../data/crops/", import.meta.url);
let loaded: Record<string, CropDef> | null = null;

export function loadCrops(): Record<string, CropDef> {
  if (loaded) return loaded;
  const out: Record<string, CropDef> = {};
  for (const f of readdirSync(DIR).filter((x) => x.endsWith(".json")).sort()) {
    const r = CropSchema.safeParse(JSON.parse(readFileSync(new URL(f, DIR), "utf8")));
    if (!r.success) throw new Error(`crops/${f} is invalid:\n${r.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n")}`);
    if (r.data.id !== f.replace(/\.json$/, "")) throw new Error(`crops/${f}: the id should be the file's name`);
    out[r.data.id] = r.data;
  }
  return (loaded = out);
}

/** The three-field rotation (N26G decision 4): the crop a plot in field `field` carries in `year` (null: lying fallow, grazed). */
export function cropFor(kind: string, field: number, year: number, terrain: string, plotHash: number): string | null {
  if (kind === "meadow") return "hay";
  if (kind === "orchard") return "fruit";
  if (kind === "paddock") return null;
  const course = (field + year) % 3;
  if (course === 2) return null;
  const crops = loadCrops();
  const pool = course === 0 ? ["wheat", "rye"] : ["barley", "oats", "beans", "turnips", "cabbages", "flax"];
  const liked = pool.filter((c) => crops[c]?.likes.includes(terrain));
  const choose = liked.length > 0 && plotHash % 3 !== 0 ? liked : pool.filter((c) => !crops[c]?.dislikes.includes(terrain));
  return choose[plotHash % Math.max(1, choose.length)] ?? pool[0]!;
}
