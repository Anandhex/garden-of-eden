import { readdirSync, readFileSync } from "node:fs";
import { z } from "zod";
import type { AnimalSpec, PlantSpec } from "@millbrook/shared";
import { ITEMS } from "../items.js";
import { ILLNESSES } from "../health.js";

/**
 * Species as data (N28 decision 1): `data/species/animals/*.json` and `data/species/plants/*.json`, one file a species,
 * checked here (and by `npm run check-npcs`): biomes are terrains, products are items, a promoted species has a creature
 * template, a lookalike is a real plant, a calendar covers the year. Add a species by adding a file.
 */
const BIOMES = ["valley", "hills", "forest", "plains", "coast", "marsh"] as const;
const SEASONS = ["spring", "summer", "autumn", "winter"] as const;
const range = z.tuple([z.number().min(0).max(2), z.number().min(0).max(2)]);
const product = z.object({ item: z.string(), qty: z.tuple([z.number().int().min(1), z.number().int().min(1)]), chance: z.number().min(0).max(1).optional() });
const lore = z.record(z.string(), z.string().nullable()).default({});

export const AnimalSchema = z.object({
  id: z.string().regex(/^[a-z_]+$/),
  kind: z.literal("animal"),
  name: z.string(),
  plural: z.string(),
  /** beast, bird or fish (fish are caught, never drawn). */
  class: z.enum(["beast", "bird", "fish"]),
  biomes: z.partialRecord(z.enum(BIOMES), z.number().min(0)),
  seasons: z.record(z.enum(SEASONS), z.number().min(0)),
  abundance: z.number().min(0).max(1),
  group: z.object({ min: z.number().int().min(1), max: z.number().int().min(1) }),
  active: z.enum(["day", "night", "dawn", "dawn-dusk", "always"]),
  flees: z.number().min(0),
  signs: z.array(z.string()),
  products: z.array(product),
  hunt: z.object({ skill: z.enum(["hunting", "fishing"]), difficulty: z.number().int() }).optional(),
  /** The creature template it becomes when hunted (a fight); without one, a hunt is a single check. */
  creature: z.string().optional(),
  water: z.boolean().optional(),
  /** Lives in villages and towns (strays, cats, rats): never out in the country. */
  village: z.boolean().optional(),
  small: z.boolean().optional(),
  closedSeason: z.array(z.enum(SEASONS)).optional(),
  /** The lord's game: hunting it near a lord's seat is poaching. */
  lordsGame: z.boolean().optional(),
  tame: z.object({ skill: z.literal("animal_handling"), difficulty: z.number().int(), days: z.number().int().min(1) }).optional(),
  rarity: z.enum(["common", "uncommon", "rare", "legendary"]),
  lore,
});
export type AnimalDef = z.infer<typeof AnimalSchema>;

const effect = z.object({
  when: z.enum(["eaten", "brewed", "applied"]),
  cures: z.string().optional(),
  causes: z.string().optional(),
  heals: z.number().optional(),
  food: z.number().optional(),
  water: z.number().optional(),
  rest: z.number().optional(),
});

export const PlantSchema = z.object({
  id: z.string().regex(/^[a-z_]+$/),
  kind: z.literal("plant"),
  name: z.string(),
  class: z.enum(["herb", "shrub", "tree", "grass", "fungus", "weed", "moss"]),
  biomes: z.partialRecord(z.enum(BIOMES), z.number().min(0)),
  calendar: z.object({ bud: range, flower: range, fruit: range, dormant: range }),
  cover: z.number().min(0).max(1),
  products: z.array(z.object({ stage: z.enum(["bud", "flower", "fruit", "dormant", "any"]), item: z.string(), qty: z.tuple([z.number().int().min(1), z.number().int().min(1)]) })),
  identify: z.object({ skill: z.literal("herbalism"), difficulty: z.number().int() }),
  regrowDays: z.number().int().min(1),
  rarity: z.enum(["common", "uncommon", "rare", "legendary"]),
  effects: z.array(effect),
  /** A plant it's easily taken for: a failed identification gives this one's product, believed to be the right one. */
  lookalike: z.string().optional(),
  lore,
});
export type PlantDef = z.infer<typeof PlantSchema>;

export interface SpeciesBook {
  animals: Record<string, AnimalDef>;
  plants: Record<string, PlantDef>;
}

const DIR = new URL("../../data/species/", import.meta.url);
let cached: SpeciesBook | null = null;

/** Every species file, parsed (once). */
export function loadSpecies(dir: URL = DIR): SpeciesBook {
  if (cached && dir === DIR) return cached;
  const read = <T>(sub: string, schema: z.ZodType<T>): T[] =>
    readdirSync(new URL(`${sub}/`, dir))
      .filter((f) => f.endsWith(".json"))
      .sort()
      .map((f) => {
        const r = schema.safeParse(JSON.parse(readFileSync(new URL(`${sub}/${f}`, dir), "utf8")));
        if (!r.success) throw new Error(`species ${sub}/${f}: ${r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
        return r.data;
      });
  const book: SpeciesBook = { animals: Object.fromEntries(read("animals", AnimalSchema).map((a) => [a.id, a])), plants: Object.fromEntries(read("plants", PlantSchema).map((p) => [p.id, p])) };
  if (dir === DIR) cached = book;
  return book;
}

/** What is wrong with the species files, as lines (empty: all good). `creatures`: the creature template ids. */
export function checkSpecies(book: SpeciesBook, creatures: string[]): string[] {
  const bad: string[] = [];
  const item = (where: string, i: string) => {
    if (!ITEMS[i]) bad.push(`${where}: "${i}" is not an item (game/items.ts)`);
  };
  for (const a of Object.values(book.animals)) {
    for (const p of a.products) item(`animal ${a.id}`, p.item);
    if (a.creature && !creatures.includes(a.creature)) bad.push(`animal ${a.id}: no creature template "${a.creature}"`);
    if (a.group.max < a.group.min) bad.push(`animal ${a.id}: group max below min`);
    if (!a.village && Object.keys(a.biomes).length === 0) bad.push(`animal ${a.id}: lives nowhere (no biomes and not a village animal)`);
  }
  const illness = (where: string, id?: string) => {
    if (id && !(id in ILLNESSES)) bad.push(`${where}: "${id}" is not an illness (game/health.ts)`);
  };
  for (const p of Object.values(book.plants)) {
    for (const x of p.products) item(`plant ${p.id}`, x.item);
    if (p.lookalike && !book.plants[p.lookalike]) bad.push(`plant ${p.id}: lookalike "${p.lookalike}" is not a plant`);
    for (const e of p.effects) {
      illness(`plant ${p.id}`, e.cures);
      illness(`plant ${p.id}`, e.causes);
    }
    if (Object.keys(p.biomes).length === 0) bad.push(`plant ${p.id}: grows nowhere`);
  }
  return bad;
}

/** The species a terrain can show as light wildlife (not fish, not village animals, not the realm's pack beasts). */
export function lightAnimals(book: SpeciesBook): AnimalSpec[] {
  return Object.values(book.animals).filter((a) => a.class !== "fish" && !a.village);
}

export function plantSpecs(book: SpeciesBook): PlantSpec[] {
  return Object.values(book.plants);
}

/** The animal or plant whose products include an item. */
export function plantOfItem(book: SpeciesBook, item: string): PlantDef | undefined {
  return Object.values(book.plants).find((p) => p.products.some((x) => x.item === item));
}
