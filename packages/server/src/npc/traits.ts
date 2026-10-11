import { z } from "zod";
import type { NpcPersona, NpcState } from "./types.js";
import { driftedTraits } from "./growth.js";

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

/**
 * The NPC's traits with defaults filled in, plus any drift from growth (npc/growth.ts)
 * when their state is given. Rules should pass the state.
 */
export const traitsOf = (persona: Pick<NpcPersona, "traits">, state?: Pick<NpcState, "growth"> | null): Traits =>
  driftedTraits(resolveTraits(persona.traits), state?.growth);

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

/**
 * Scales the trust an annoyed or angry mood costs: x0.5 for a placid NPC, x1.25 for a hothead.
 * Brena (0.67) stays at x1, so her old -5/-15 is unchanged.
 */
export function insultTrustFactor(t: Pick<Traits, "temper">): number {
  return 0.5 + 0.75 * t.temper;
}

/**
 * A scared NPC (failed morale) tries to run. If they're cut off, a coward begs
 * for mercy and the fight stops; anyone braver fights on, cornered.
 */
export function begsWhenCornered(t: Pick<Traits, "bravery">): boolean {
  return t.bravery < 0.5;
}

/** Chance a dishonest NPC lies instead of revealing a secret: 0 at honesty 0.5 and up, 0.75 at honesty 0. */
export function lieChance(t: Pick<Traits, "honesty">): number {
  return clamp(0.75 * (1 - 2 * t.honesty), 0, 0.75);
}

/** Trust needed before the NPC gives gifts: 30 for the most generous, 90 for the stingiest. */
export function giftTrust(t: Pick<Traits, "generosity">): number {
  return Math.round(90 - 60 * t.generosity);
}

/** Most a gift may be worth, in copper: up to 2 silver for the most generous. */
export function maxGiftValue(t: Pick<Traits, "generosity">): number {
  return Math.round(200 * t.generosity);
}

/** Extra share a generous NPC adds to quest rewards: nothing at 0.5 or below, +25% at 1. */
export function questRewardBonus(t: Pick<Traits, "generosity">): number {
  return Math.max(0, t.generosity - 0.5) * 0.5;
}

/** Reply token budget multiplier: sociable NPCs may talk for longer (up to x1.5); others keep the default. */
export function replyTokenFactor(t: Pick<Traits, "sociability">): number {
  return 1 + Math.max(0, t.sociability - 0.5);
}

/** How long replies should be, for the system prompt. */
export function replyLength(t: Pick<Traits, "sociability">): string {
  return t.sociability >= HIGH ? "2-3 short sentences" : "1-2 short sentences";
}

/** Trust a grudge recovers each in-game day (towards 0, never above): 4 for the grudge-holding, 20 for the forgiving. */
export function grudgeFadePerDay(t: Pick<Traits, "forgiveness">): number {
  return Math.round(4 + 16 * t.forgiveness);
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
