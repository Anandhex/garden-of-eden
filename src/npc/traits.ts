import { z } from "zod";
import type { NpcPersona } from "./types.js";

/**
 * Personality traits, each 0 to 1. Code turns them into rules (one function per
 * rule below); the model only sees them as words (describeTraits), never numbers.
 * `greed` is not here: it's a top-level persona field because debts and training
 * already depend on it (see game/debts.ts).
 */
export const TRAITS = ["temper", "bravery", "honesty", "generosity", "sociability", "forgiveness"] as const;
export type Trait = (typeof TRAITS)[number];

const trait = z.number().min(0).max(1);
export const TraitsSchema = z
  .object({
    temper: trait,
    bravery: trait,
    honesty: trait,
    generosity: trait,
    sociability: trait,
    forgiveness: trait,
  })
  .partial()
  .strict();
export type Traits = Required<z.infer<typeof TraitsSchema>>;

export const DEFAULT_TRAIT = 0.5;

/** Fill in any trait the NPC file leaves out with the default. */
export function resolveTraits(partial: z.infer<typeof TraitsSchema> | undefined): Traits {
  const out = {} as Traits;
  for (const t of TRAITS) out[t] = partial?.[t] ?? DEFAULT_TRAIT;
  return out;
}

/** The NPC's traits with defaults filled in. */
export const traitsOf = (persona: Pick<NpcPersona, "traits">): Traits => resolveTraits(persona.traits);

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/** Mean comments in a row before the NPC may attack: 5 for a placid NPC, 2 for a hothead. */
export function provokeLimit(t: Pick<Traits, "temper">): number {
  return clamp(Math.round(5 - 3 * t.temper), 2, 5);
}

/** Share of max HP at or below which a fighting NPC may flee. Cowards break earlier (0.5), the brave later (0.3). */
export function fleeAt(t: Pick<Traits, "bravery">): number {
  return Math.round((0.3 + 0.2 * (1 - t.bravery)) * 100) / 100;
}

/** Willpower check target a badly hurt NPC must beat when hit: 10 for the fearless, 20 for the craven. */
export function moraleTarget(t: Pick<Traits, "bravery">): number {
  return Math.round(20 - 10 * t.bravery);
}

const LOW = 0.35;
const HIGH = 0.65;

/** "quick-tempered, cowardly, dishonest": only the notable traits, as words. Empty if all are middling. */
export function describeTraits(t: Traits): string {
  const words: string[] = [];
  const pick = (v: number, low: string, high: string) => {
    if (v <= LOW) words.push(low);
    else if (v >= HIGH) words.push(high);
  };
  pick(t.temper, "slow to anger", "quick-tempered");
  pick(t.bravery, "cowardly", "brave");
  pick(t.honesty, "dishonest", "honest");
  pick(t.generosity, "stingy", "generous");
  pick(t.sociability, "reserved", "sociable");
  pick(t.forgiveness, "grudge-holding", "forgiving");
  return words.join(", ");
}
