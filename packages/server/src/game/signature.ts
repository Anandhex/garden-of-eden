import { addEmotion } from "../npc/emotions.js";
import { remember } from "../npc/memory.js";
import { traitsOf } from "../npc/traits.js";
import type { CraftJob, NpcPersona, NpcState } from "../npc/types.js";
import { modifier, type Rng, rollDie } from "./dice.js";
import { ITEM_TIERS, itemKey, itemLabel, parseItem } from "./items.js";

/**
 * Signature moves (N6.1): one memorable, rule-based thing an NPC does reliably,
 * from a fixed set of triggers and effects, evaluated in code. The model only
 * narrates the result.
 * - good_work_day → masterwork: at the start of each working day they roll
 *   d20 + luck modifier; on GOOD_DAY_TARGET or more it's a good day, and the next
 *   thing they make comes out a tier better. With average luck that's 3 days in 20 (15%).
 * - trusted_regular → hidden_stock: items kept back from the shelf (and from
 *   villagers) that they'll sell only to someone they trust.
 */
export const SIGNATURE_TRIGGERS = ["good_work_day", "trusted_regular"] as const;
export const SIGNATURE_EFFECTS = ["masterwork", "hidden_stock"] as const;

export const GOOD_DAY_TARGET = 18;
/** Trust a trusted regular needs when the file doesn't say. */
export const REGULAR_TRUST = 50;

/** Chance of a good work day for a luck score: P(d20 + modifier >= GOOD_DAY_TARGET). */
export function goodDayChance(luck: number): number {
  const need = GOOD_DAY_TARGET - modifier(luck);
  return Math.max(0, Math.min(20, 21 - need)) / 20;
}

/** Start of a working day: roll for a good day. Returns a log line if it is one. */
export function rollWorkDay(persona: NpcPersona, state: NpcState, day: number, luck: number, rng: Rng): string | null {
  if (persona.signature?.trigger !== "good_work_day") return null;
  if (rollDie(rng, 20) + modifier(luck) < GOOD_DAY_TARGET) return null;
  state.goodDay = day;
  return `${persona.name} is having a good day at work.`;
}

/**
 * A good day's craft: the piece comes out a tier better (a masterwork). Used once.
 * Returns a log line, or null if it isn't a good day.
 */
export function applyMasterwork(persona: NpcPersona, state: NpcState, job: CraftJob, day: number): string | null {
  if (persona.signature?.effect !== "masterwork" || state.goodDay !== day) return null;
  const parsed = parseItem(job.output);
  if (!parsed) return null;
  const tier = ITEM_TIERS[Math.min(ITEM_TIERS.length - 1, ITEM_TIERS.indexOf(parsed.tier) + 1)]!;
  job.output = itemKey(parsed.name, tier);
  state.goodDay = null;
  addEmotion(state, "pride", 0.6, `the ${itemLabel(job.output)} you're making today`, day);
  remember(state, { id: `masterwork-${day}`, day, text: `you made ${persona.signature.describe}: a ${itemLabel(job.output)}`, importance: 5, valence: 0 }, traitsOf(persona, state));
  return `It's a good day: ${persona.name} is making ${persona.signature.describe}.`;
}

/** Is this item part of a hidden stock? */
export function isHiddenStock(persona: NpcPersona, item: string): boolean {
  const sig = persona.signature;
  if (sig?.effect !== "hidden_stock") return false;
  const name = parseItem(item)?.name;
  return (sig.items ?? []).some((i) => i === item || (parseItem(i)?.key ?? i) === item || (!/\[/.test(i) && i === name));
}

/** Does this NPC treat the player as a trusted regular (hidden stock comes out)? */
export function isTrustedRegular(persona: NpcPersona, state: Pick<NpcState, "relationship" | "metBefore">): boolean {
  if (persona.signature?.trigger !== "trusted_regular") return false;
  return state.metBefore && state.relationship >= (persona.signature.minTrust ?? REGULAR_TRUST);
}

/** Is this item held back from this player right now? */
export function heldBack(persona: NpcPersona, state: Pick<NpcState, "relationship" | "metBefore">, item: string): boolean {
  return isHiddenStock(persona, item) && !isTrustedRegular(persona, state);
}

/** The situation line when the hidden stock comes out, or null. */
export function describeSignature(persona: NpcPersona, state: NpcState, day: number): string | null {
  const sig = persona.signature;
  if (!sig) return null;
  if (sig.effect === "hidden_stock" && isTrustedRegular(persona, state)) {
    const have = Object.keys(state.inventory).some((k) => (state.inventory[k] ?? 0) > 0 && isHiddenStock(persona, k));
    return have ? `They're a trusted regular: you'll bring out ${sig.describe} for them.` : null;
  }
  if (sig.effect === "masterwork" && state.goodDay === day) return "It's a good day at work: whatever you make next will be your best.";
  return null;
}
