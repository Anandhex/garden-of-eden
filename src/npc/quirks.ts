import { isTooHurtToWork } from "../game/healing.js";
import { currentPlan, inHours } from "../game/schedule.js";
import type { NpcPersona, NpcState, Quirk, WorldSnapshot } from "./types.js";

/**
 * Quirks and tells (N4.2): a few habits per NPC, each a situation line shown only
 * when its condition holds. Conditions are a fixed set of checks in code (what
 * they're doing, where, the topic, who's nearby, mood, the hour, being hurt).
 * At most MAX_QUIRK_LINES a turn (design rule 3); topic quirks go first, since
 * they answer what the player just said.
 */
export const MAX_QUIRK_LINES = 2;

const mentions = (line: string, word: string) =>
  new RegExp(`\\b${word.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(line.toLowerCase());

/** Does every condition the quirk sets hold right now? */
export function quirkHolds(persona: NpcPersona, quirk: Quirk, state: NpcState, world: WorldSnapshot, playerLine?: string): boolean {
  const w = quirk.when;
  const plan = currentPlan(persona, state, world);
  if (w.activity && !w.activity.includes(plan.activity)) return false;
  if (w.place && !w.place.includes(plan.place)) return false;
  if (w.topic && !(playerLine !== undefined && w.topic.some((word) => mentions(playerLine, word)))) return false;
  if (w.nearby && !w.nearby.some((id) => (world.present ?? []).includes(id))) return false;
  if (w.mood && !w.mood.includes(state.mood)) return false;
  if (w.hours && !inHours(world.hour, w.hours[0], w.hours[1])) return false;
  if (w.hurt !== undefined && w.hurt !== isTooHurtToWork(persona, state)) return false;
  return true;
}

/** The quirk lines for this turn: topic quirks first, then the rest, at most MAX_QUIRK_LINES. */
export function activeQuirks(persona: NpcPersona, state: NpcState, world: WorldSnapshot, playerLine?: string): string[] {
  const holding = (persona.quirks ?? []).filter((q) => quirkHolds(persona, q, state, world, playerLine));
  holding.sort((a, b) => Number(b.when.topic !== undefined) - Number(a.when.topic !== undefined));
  return holding.slice(0, MAX_QUIRK_LINES).map((q) => q.line);
}
