import type { NpcPersona } from "./types.js";

/**
 * Build the NPC's system prompt from its persona.
 *
 * Rules of thumb for small models:
 * - Keep it short (under ~400 words) and direct.
 * - Keep it identical every turn: no mood, inventory, or time here.
 *   Changing state goes in the per-turn user message (NpcAgent.buildTurnMessage).
 * - Say plainly: "Saying you hand something over does nothing unless you call the tool."
 * - Say: "Reply in 1-2 short sentences. Speak only as <name>."
 */
export function buildSystemPrompt(persona: NpcPersona): string {
  // TODO(Step 5): turn the persona fields into a prompt.
  // Start with something like the prompt used in the model test:
  //   "You are Brena, a gruff village blacksmith in a fantasy game. Stay in character.
  //    Reply in 1-2 short sentences. Use tools to act in the world; saying you hand
  //    something over does nothing without a tool call. Never give items away for free."
  return `You are ${persona.name}, ${persona.role}. Stay in character. Reply in 1-2 short sentences.`;
}
