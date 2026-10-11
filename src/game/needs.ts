import type { Mood } from "../npc/types.js";
import type { Activity } from "./schedule.js";

/**
 * Needs (N6): hunger and energy tick every hour and are met by what the NPC does.
 * Eating fills hunger, sleep restores energy, work tires them. Money is the third
 * need; it's read straight from the purse (see schedule.ts, "broke").
 * All numbers live here; the model only hears "You're tired and hungry."
 */
export interface Needs {
  /** 0 (full) .. 100 (starving). */
  hunger: number;
  /** 0 (exhausted) .. 100 (rested). */
  energy: number;
}

export const FRESH_NEEDS: Needs = { hunger: 20, energy: 80 };

/** At or above this, hunger overrides the schedule (they go and eat). */
export const STARVING = 70;
/** At or above this, they feel hungry (a situation line, and a worse mood). */
export const HUNGRY = 65;
/** At or below this, they feel tired. */
export const TIRED = 25;
/** At or below this, energy overrides the schedule (they go to sleep). */
export const EXHAUSTED = 15;

/** Hunger gained per hour by activity; asleep you get hungry slowly. Cold weather adds 1. */
const HUNGER_PER_HOUR: Record<Activity, number> = { work: 4, eat: 0, socialise: 3, sleep: 1, travel: 4 };
/** Energy change per hour by activity. */
const ENERGY_PER_HOUR: Record<Activity, number> = { work: -4, eat: -2, socialise: -3, sleep: 12, travel: -4 };
/** Hunger an hour of eating takes away. */
export const MEAL = 60;

const clamp = (n: number) => Math.max(0, Math.min(100, n));

/** One hour of an activity. `cold`: winter or snow makes everyone hungrier. */
export function tickNeeds(needs: Needs, activity: Activity, { cold = false } = {}): void {
  needs.hunger = clamp(needs.hunger + HUNGER_PER_HOUR[activity] + (cold && activity !== "eat" ? 1 : 0) - (activity === "eat" ? MEAL : 0));
  needs.energy = clamp(needs.energy + ENERGY_PER_HOUR[activity]);
}

/** "You're tired and hungry." or null when they're fine. */
export function describeNeeds(needs: Needs): string | null {
  const parts: string[] = [];
  if (needs.energy <= EXHAUSTED) parts.push("exhausted");
  else if (needs.energy <= TIRED) parts.push("tired");
  if (needs.hunger >= STARVING) parts.push("starving");
  else if (needs.hunger >= HUNGRY) parts.push("hungry");
  if (parts.length === 0) return null;
  return `You're ${parts.join(" and ")}${needs.hunger >= STARVING ? "; food is all you can think about" : ""}.`;
}

/** Hungry or tired NPCs drift towards annoyed. Null when needs are met. */
export function needsMood(needs: Needs): Mood | null {
  return needs.hunger >= HUNGRY || needs.energy <= TIRED ? "annoyed" : null;
}
