import { ITEM_TIERS, type ItemTier } from "../game/items.js";

/**
 * The peoples and animals of the world. Every NPC and creature belongs to one.
 * Species set how long a life lasts and how far its members can grow; the
 * individual's own stats live in its NPC or creature file.
 *
 * Ages are in years. See config.daysPerYear for how fast a year passes.
 */
export interface SpeciesDef {
  /** "a human", "an elf": for descriptions. */
  name: string;
  /** Can talk (and so can be a full LLM NPC). Animals can't. */
  talks: boolean;
  /** Age they count as grown (before this they're "young"). */
  adultAge: number;
  /** Age old age begins: stats start to fade and natural death becomes possible. */
  elderAge: number;
  /** Nobody of this species lives past this age. */
  maxAge: number;
  /** Highest rank any member can reach. */
  maxTier: ItemTier;
  /** XP multiplier: quick learners grow faster. */
  learnRate: number;
}

export const SPECIES: Record<string, SpeciesDef> = {
  // Peoples
  human: { name: "a human", talks: true, adultAge: 16, elderAge: 60, maxAge: 95, maxTier: "SSS", learnRate: 1 },
  elf: { name: "an elf", talks: true, adultAge: 30, elderAge: 500, maxAge: 750, maxTier: "SSS", learnRate: 0.6 },
  dwarf: { name: "a dwarf", talks: true, adultAge: 25, elderAge: 200, maxAge: 320, maxTier: "SS", learnRate: 0.8 },
  halfling: { name: "a halfling", talks: true, adultAge: 20, elderAge: 80, maxAge: 130, maxTier: "S", learnRate: 1 },
  orc: { name: "an orc", talks: true, adultAge: 12, elderAge: 40, maxAge: 65, maxTier: "SS", learnRate: 1.3 },
  // Animals
  wolf: { name: "a wolf", talks: false, adultAge: 2, elderAge: 8, maxAge: 14, maxTier: "B", learnRate: 1.2 },
  horse: { name: "a horse", talks: false, adultAge: 4, elderAge: 20, maxAge: 32, maxTier: "D", learnRate: 0.8 },
  bear: { name: "a bear", talks: false, adultAge: 4, elderAge: 20, maxAge: 32, maxTier: "A", learnRate: 0.9 },
  boar: { name: "a boar", talks: false, adultAge: 2, elderAge: 10, maxAge: 18, maxTier: "C", learnRate: 1.1 },
  spider: { name: "a giant spider", talks: false, adultAge: 1, elderAge: 6, maxAge: 10, maxTier: "B", learnRate: 1.2 },
  // Light wildlife (N26F decision 7): nobody's, drawn along the road and made a creature only when hunted.
  deer: { name: "a deer", talks: false, adultAge: 2, elderAge: 10, maxAge: 18, maxTier: "F", learnRate: 0.8 },
  hare: { name: "a hare", talks: false, adultAge: 1, elderAge: 4, maxAge: 7, maxTier: "G", learnRate: 0.8 },
  fox: { name: "a fox", talks: false, adultAge: 1, elderAge: 6, maxAge: 10, maxTier: "F", learnRate: 0.9 },
  adder: { name: "an adder", talks: false, adultAge: 2, elderAge: 10, maxAge: 18, maxTier: "F", learnRate: 0.7 },
  heron: { name: "a heron", talks: false, adultAge: 2, elderAge: 12, maxAge: 20, maxTier: "G", learnRate: 0.7 },
  crow: { name: "a crow", talks: false, adultAge: 1, elderAge: 8, maxAge: 14, maxTier: "G", learnRate: 0.8 },
  // Fauna (N28): hunted on the hills, and tamed in the villages.
  goat: { name: "a wild goat", talks: false, adultAge: 1, elderAge: 9, maxAge: 15, maxTier: "F", learnRate: 0.8 },
  dog: { name: "a dog", talks: false, adultAge: 1, elderAge: 9, maxAge: 15, maxTier: "F", learnRate: 1 },
};

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

/**
 * Peoples and monsters (N54): the rest of the realm's species are data (`data/peoples/peoples.json`: body and life, mind, how they live,
 * where, their temperament and their stances toward other peoples), added to SPECIES so every rule that reads a species' ages reads theirs.
 */
import { readFileSync as readPeoples } from "node:fs";
export interface PeopleDef {
  id: string;
  name: string;
  body: { adultAge: number; elderAge: number; maxAge: number; maxTier: string; learnRate: number };
  mind: "beast" | "cunning" | "reasoning";
  cleverShare: number;
  living: "settled" | "nomadic" | "solitary" | "hoard" | "hive";
  habitat: string[];
  temperament: { aggression: number; greed: number };
  culture: string;
  stances: Record<string, number>;
}
export const PEOPLES: { peoples: PeopleDef[]; stances: Record<string, Record<string, number>> } = JSON.parse(readPeoples(new URL("../data/peoples/peoples.json", import.meta.url), "utf8"));
for (const p of PEOPLES.peoples) {
  if (SPECIES[p.id]) continue;
  SPECIES[p.id] = { name: p.name, talks: p.mind !== "beast", adultAge: p.body.adultAge, elderAge: p.body.elderAge, maxAge: p.body.maxAge, maxTier: p.body.maxTier as ItemTier, learnRate: p.body.learnRate };
}
/** How one people sees another, -100..100 (both directions are kept: a dwarf's view of goblins, a goblin's of dwarves). */
export function stanceOf(a: string, b: string): number {
  if (a === b) return 50;
  return PEOPLES.stances[a]?.[b] ?? PEOPLES.peoples.find((p) => p.id === a)?.stances[b] ?? 0;
}
export const peopleOf = (id: string): PeopleDef | undefined => PEOPLES.peoples.find((p) => p.id === id);
