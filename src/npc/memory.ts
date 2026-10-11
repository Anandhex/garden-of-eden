import type { Traits } from "./traits.js";
import type { NpcMemory, NpcState } from "./types.js";

/**
 * Memory (N5): facts an NPC witnessed, written by code. Each has an importance
 * (1-10) that fades with time; bad memories fade at the NPC's forgiveness, so a
 * grudge-holder keeps an insult for longer. The few that weigh most right now go
 * into the situation block as short lines ("Yesterday, they insulted your forge."),
 * with no model call.
 */

/** Memories shown to the model each turn (design rule 3). */
export const RECALL_LINES = 3;
/** Below this weight a memory no longer comes to mind. */
export const RECALL_THRESHOLD = 1;
/** Importance given to memories from before importance existed. */
const DEFAULT_IMPORTANCE = 5;
/** Most memories kept per NPC; the weakest go first. */
export const MAX_MEMORIES = 40;

/** Days for a good or neutral memory to fade to half. */
const GOOD_HALF_LIFE = 10;

/** Days for a bad memory to fade to half: 3 for the most forgiving, 12 for the most grudge-holding. */
export function badHalfLife(t: Pick<Traits, "forgiveness">): number {
  return 3 + 9 * (1 - t.forgiveness);
}

/** How strongly a memory comes to mind today: importance × freshness. */
export function memoryWeight(memory: NpcMemory, today: number, traits: Pick<Traits, "forgiveness">): number {
  const importance = memory.importance ?? DEFAULT_IMPORTANCE;
  const age = Math.max(0, today - memory.day);
  const halfLife = (memory.valence ?? 0) < 0 ? badHalfLife(traits) : GOOD_HALF_LIFE;
  return importance * 0.5 ** (age / halfLife);
}

/**
 * Store a memory. A memory with the same id replaces the old one (so "insulted you
 * today" is kept once a day, not once per insult). Past MAX_MEMORIES the weakest goes.
 */
export function remember(state: NpcState, memory: NpcMemory, traits?: Pick<Traits, "forgiveness">): void {
  const at = state.memories.findIndex((m) => m.id === memory.id);
  if (at >= 0) state.memories.splice(at, 1);
  state.memories.push(memory);
  if (state.memories.length > MAX_MEMORIES) {
    const t = traits ?? { forgiveness: 0.5 };
    let weakest = 0;
    for (let i = 1; i < state.memories.length; i++) {
      if (memoryWeight(state.memories[i]!, memory.day, t) < memoryWeight(state.memories[weakest]!, memory.day, t)) weakest = i;
    }
    state.memories.splice(weakest, 1);
  }
}

/** "Today", "Yesterday", "Two days ago", "5 days ago". */
export function whenPhrase(day: number, today: number): string {
  const ago = today - day;
  if (ago <= 0) return "Today";
  if (ago === 1) return "Yesterday";
  if (ago === 2) return "Two days ago";
  if (ago === 3) return "Three days ago";
  if (ago < 7) return `${ago} days ago`;
  if (ago < 14) return "Last week";
  return "A while back";
}

/** One memory as a line for the model. */
export function describeMemory(memory: NpcMemory, today: number): string {
  if (memory.importance === undefined) return memory.text; // an older memory that already says when
  const heard = memory.heardFrom ? ` (${memory.heardFrom} told you)` : "";
  return `${whenPhrase(memory.day, today)}, ${memory.text}${heard}.`;
}

/** The memories that come to mind today, strongest first. */
export function recall(state: NpcState, today: number, traits: Pick<Traits, "forgiveness">, max = RECALL_LINES): NpcMemory[] {
  return state.memories
    .map((m, i) => ({ m, i, w: memoryWeight(m, today, traits) }))
    .filter((x) => x.w >= RECALL_THRESHOLD)
    // Strongest first; between equals, the newer one.
    .sort((a, b) => b.w - a.w || b.i - a.i)
    .slice(0, max)
    .map((x) => x.m);
}

/** The situation line: "You remember: Yesterday, they insulted your forge. ..." or null. */
export function describeRecall(state: NpcState, today: number, traits: Pick<Traits, "forgiveness">): string | null {
  const memories = recall(state, today, traits);
  if (memories.length === 0) return null;
  return `You remember: ${memories.map((m) => describeMemory(m, today)).join(" ")}`;
}
