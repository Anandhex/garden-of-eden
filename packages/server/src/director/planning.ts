import { z } from "zod";
import type { LLMProvider } from "../llm/provider.js";
import { knownNameWords, unknownNames } from "../npc/knowledge.js";
import { recall, describeMemory } from "../npc/memory.js";
import { traitsOf } from "../npc/traits.js";
import type { NpcPersona, NpcState, WorldSnapshot } from "../npc/types.js";
import { describeNeeds } from "../game/needs.js";
import { describeRevenge } from "./revenge.js";
import { describeArcs } from "../npc/arcs.js";
import { structured } from "./structured.js";

/**
 * Off-screen planning (optional, from the old living-world plan): once per in-game
 * day each NPC makes one short, low-priority call to set its plans from its memories,
 * goals and needs. The plans are flavour only: one situation line ("Today you mean
 * to ..."). Code never acts on them, and the call runs in the background, cancelled
 * the moment the player says anything (director/background.ts).
 */
export interface DailyPlan {
  day: number;
  /** 1-3 short intentions, in the NPC's own terms. */
  intentions: string[];
}

export const PlanSchema = z.object({ intentions: z.array(z.string().min(3).max(90)).min(1).max(3) });

/** The prompt: who they are, what's on their mind, what today holds. */
export function planningPrompt(persona: NpcPersona, state: NpcState, world: WorldSnapshot): { system: string; prompt: string } {
  const memories = recall(state, world.day, traitsOf(persona, state), 5).map((m) => describeMemory(m, world.day));
  const lines = [
    `You are ${persona.name}, ${persona.role}. Goals: ${persona.goals.join("; ")}.`,
    memories.length > 0 ? `On your mind: ${memories.join(" ")}` : null,
    describeNeeds(state.needs),
    describeRevenge(state),
    ...describeArcs(persona, state),
    `It's day ${world.day}. Write 1-3 short plans for today, each under 15 words, in the first person. Only mention people and places named above.`,
  ].filter((l): l is string => !!l);
  return { system: "You plan a village character's day. Reply as JSON: {\"intentions\": [\"...\"]}.", prompt: lines.join("\n") };
}

/**
 * Make today's plan. Checked: the right shape, and no invented names (a plan naming
 * someone nobody knows is dropped, not trusted). Returns null if it failed.
 */
export async function planDay(llm: LLMProvider, persona: NpcPersona, state: NpcState, world: WorldSnapshot, knownNames: string[] = []): Promise<DailyPlan | null> {
  if (state.outcome === "dead" || state.dormant) return null;
  const { system, prompt } = planningPrompt(persona, state, world);
  const out = await structured(llm, PlanSchema, { system, prompt, maxTokens: 120, temperature: 0.6 });
  if (!out) return null;
  const known = knownNameWords([persona], [world.player.name, ...knownNames]);
  const intentions = out.intentions.map((t) => t.trim()).filter((t) => unknownNames(t, known).length === 0);
  if (intentions.length === 0) return null;
  const plan = { day: world.day, intentions };
  state.plan = plan;
  return plan;
}

/** The situation line, for today's plan only. */
export function describePlan(state: NpcState, day: number): string | null {
  if (!state.plan || state.plan.day !== day) return null;
  return `What you meant to do today: ${state.plan.intentions.join("; ")}.`;
}

/** NPCs whose plan is out of date. */
export function needsPlan(state: NpcState, day: number): boolean {
  return state.outcome !== "dead" && !state.dormant && (state.plan?.day ?? 0) < day;
}
