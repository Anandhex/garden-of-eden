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
