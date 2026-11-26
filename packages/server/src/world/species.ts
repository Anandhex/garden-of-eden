import { readdirSync, readFileSync } from "node:fs";
import { z } from "zod";
import { ITEM_TIERS, type ItemTier } from "../game/items.js";

/**
 * The peoples and animals of the world (N54 Part A). Every NPC and creature belongs to one. Each is a data file,
 * `data/peoples/<id>.json`: body and life (size, strength, toughness, age bands, rank limit, learning), mind (`beast`,
 * `cunning` or `reasoning`, and for beast and cunning kinds the share of individuals clever enough to talk), how it
 * lives (settled, nomadic, solitary, on a hoard, in a hive, or wild for plain animals), where (terrains, a climate band,
 * under the mountains), temperament, an N53 culture template, an N51 school, a fight template for when one is met, a
 * size class for maps, a word list for names, and a stance toward each other people.
 *
 * Ages are in years. See config.daysPerYear for how fast a year passes. The individual's own stats live in its NPC or
 * creature file.
 */
const TIER = z.enum(ITEM_TIERS as unknown as [ItemTier, ...ItemTier[]]);
const unit = z.number().min(0).max(1);
export const SIZES = ["tiny", "small", "medium", "large", "huge", "gargantuan"] as const;
export const MINDS = ["beast", "cunning", "reasoning"] as const;
export const LIVINGS = ["settled", "nomadic", "solitary", "hoard", "hive", "wild"] as const;
export const CLIMATES = ["any", "cold", "temperate", "warm"] as const;
/** Terrains a people can call home: realm/types.ts TERRAINS (kept here as strings so this file stays a leaf). */
const HABITATS = ["valley", "hills", "forest", "plains", "coast", "marsh"] as const;
const CULTURES = ["highland", "river", "coastal", "forest", "steppe", "imperial"] as const;
const SCHOOLS = ["healing", "fire", "water", "earth", "air", "illusion", "divination", "warding", "beast_speech", "growth", "necromancy", "blood"] as const;

export const PeopleSchema = z
  .object({
    id: z.string().regex(/^[a-z_]+$/),
    /** "a human", "an elf": for descriptions. */
    name: z.string().min(1),
    body: z
      .object({
        size: z.enum(SIZES),
        strength: z.number().min(1).max(30),
        toughness: z.number().min(1).max(30),
        /** Age they count as grown (before this they're "young"). */
        adultAge: z.number().min(0),
        /** Age old age begins: stats start to fade and natural death becomes possible. */
        elderAge: z.number().min(0),
        /** Nobody of this species lives past this age. */
        maxAge: z.number().min(1),
        /** Highest rank any member can reach. */
        maxTier: TIER,
        /** XP multiplier: quick learners grow faster. */
        learnRate: z.number().positive(),
      })
      .strict(),
    mind: z.enum(MINDS),
    /** The share of individuals clever enough to talk with anyone: 1 for most reasoning peoples, under 1 for dragons (the young ones). */
    cleverShare: unit,
    living: z.enum(LIVINGS),
    habitat: z.array(z.enum(HABITATS)).min(1),
    climate: z.enum(CLIMATES),
    underMountain: z.boolean().optional(),
    temperament: z.object({ aggression: unit, greed: unit, sociability: unit, xenophobia: unit }).strict(),
    /** An N53 culture template (data/cultures/templates.json). Plain animals have none. */
    culture: z.enum(CULTURES).optional(),
    /** An N51 school their wise ones know. */
    magic: z.enum(SCHOOLS).optional(),
    /** A fight template in data/creatures/ for when one is met (checked by check-npcs). */
    creature: z.string().optional(),
    /** Map footprint in tiles a side: a giant is 2, a dragon 3. */
    sizeClass: z.number().int().min(1).max(3),
    /** Names their people give (the invented-name check and new residents use them). */
    names: z.array(z.string().min(1)).optional(),
    /** How this people sees each other one, -100..100. Missing means 0. */
    stances: z.record(z.string(), z.number().min(-100).max(100)),
  })
  .strict()
  .superRefine((p, ctx) => {
    if (!(p.body.adultAge < p.body.elderAge && p.body.elderAge < p.body.maxAge)) ctx.addIssue({ code: "custom", path: ["body"], message: "ages must run adult < elder < max" });
    if (p.mind !== "beast" && !p.culture) ctx.addIssue({ code: "custom", path: ["culture"], message: "a people that talks needs a culture" });
  });
export type PeopleDef = z.infer<typeof PeopleSchema>;

/** What life rules read of a species (game/life.ts, people rows, creatures). */
export interface SpeciesDef {
  name: string;
  /** Can talk (and so can be a full LLM NPC). Animals and beast-minded peoples can't (their clever few aside). */
  talks: boolean;
  adultAge: number;
  elderAge: number;
  maxAge: number;
  maxTier: ItemTier;
  learnRate: number;
}

/** Reads every people file in a folder (sorted by file name: the order never depends on the disk). */
export function loadPeoples(dir: URL = new URL("../data/peoples/", import.meta.url)): PeopleDef[] {
  const out: PeopleDef[] = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".json")).sort()) {
    const r = PeopleSchema.safeParse(JSON.parse(readFileSync(new URL(f, dir), "utf8")));
    if (!r.success) throw new Error(`data/peoples/${f}: ${r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
    if (`${r.data.id}.json` !== f) throw new Error(`data/peoples/${f}: id "${r.data.id}" doesn't match the file name`);
    out.push(r.data);
  }
  return out;
}

/** Problems a loaded set has that one file can't show: stances toward unknown peoples, fight templates that don't exist. */
export function checkPeoples(peoples: PeopleDef[], creatureIds: string[]): string[] {
  const ids = new Set(peoples.map((p) => p.id));
  const known = new Set(creatureIds);
  const bad: string[] = [];
  for (const p of peoples) {
    for (const other of Object.keys(p.stances)) if (!ids.has(other)) bad.push(`data/peoples/${p.id}.json: a stance toward unknown people "${other}"`);
    if (p.creature && !known.has(p.creature)) bad.push(`data/peoples/${p.id}.json: no fight template "${p.creature}" in data/creatures/`);
    if (p.mind !== "beast" && !p.creature && p.id !== "human" && !["elf", "dwarf", "halfling", "orc"].includes(p.id)) bad.push(`data/peoples/${p.id}.json: a people met in the wild needs a fight template`);
  }
  return bad;
}

const ALL = loadPeoples();
const BY_ID = new Map(ALL.map((p) => [p.id, p]));

export const SPECIES: Record<string, SpeciesDef> = Object.fromEntries(
  ALL.map((p) => [p.id, { name: p.name, talks: p.mind !== "beast", adultAge: p.body.adultAge, elderAge: p.body.elderAge, maxAge: p.body.maxAge, maxTier: p.body.maxTier, learnRate: p.body.learnRate }]),
);
export const SPECIES_IDS = Object.keys(SPECIES);

export function speciesOf(id: string | undefined): SpeciesDef {
  const def = SPECIES[id ?? "human"];
  if (!def) throw new Error(`Unknown species "${id}". Known: ${SPECIES_IDS.join(", ")}.`);
  return def;
}

/** The lower of two ranks. */
export function minTier(a: ItemTier, b: ItemTier): ItemTier {
  return ITEM_TIERS.indexOf(a) <= ITEM_TIERS.indexOf(b) ? a : b;
}

/** Every people and animal as data. */
export const PEOPLES: readonly PeopleDef[] = ALL;
export const peopleOf = (id: string): PeopleDef | undefined => BY_ID.get(id);
/** The peoples who aren't plain animals (they have minds of their own, or a clever few). */
export const peoplesNotBeasts = (): PeopleDef[] => ALL.filter((p) => p.living !== "wild");

/** How one people sees another, -100..100 (both directions are kept: a dwarf's view of goblins, a goblin's of dwarves). */
export function stanceOf(a: string, b: string): number {
  if (a === b) return 50;
  return BY_ID.get(a)?.stances[b] ?? 0;
}
