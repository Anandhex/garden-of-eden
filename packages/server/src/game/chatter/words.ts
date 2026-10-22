import { z } from "zod";
import { structured } from "../../director/structured.js";
import type { LLMProvider } from "../../llm/provider.js";
import { knownNameWords, unknownNames } from "../../npc/knowledge.js";
import type { InteractionKind } from "./types.js";

/**
 * The words of an insult (N37, the last step and the least important): code has already decided what happened; the model may write the
 * line the one who did it says, once, for a hostile exchange the player can see. The kind `chatter-line` is the lowest-priority flavour
 * (game/budgets): under load or with the model off the table's lines (shared/crowd.ts `kindLines`) stand, and the game is the same.
 * The line may use only the two names, so nothing invented gets into the world.
 */
export const LineSchema = z.object({ line: z.string().min(8).max(90) });

const WHAT: Partial<Record<InteractionKind, string>> = {
  sneer: "sneers at",
  insult: "insults",
  humiliate: "humiliates, in front of everyone,",
  refuse_bow: "refuses to bow to",
  refuse_order: "refuses an order from",
  threaten: "threatens",
};

export interface LineAbout {
  kind: InteractionKind;
  actor: string;
  actorClass: string;
  target: string;
  targetClass: string;
  place: string;
}

/** A line for the one who did it, or null if the model gave nothing usable. */
export async function writeChatterLine(llm: LLMProvider, about: LineAbout): Promise<string | null> {
  const what = WHAT[about.kind];
  if (!what) return null;
  const system = "You write one line of dialogue for a medieval fantasy village. Reply as JSON: {\"line\": ...}. One short sentence, in period speech, no profanity, no slurs, no real-world references. Invent no names.";
  const prompt = `A ${about.actorClass} named ${about.actor} ${what} a ${about.targetClass} named ${about.target} in ${about.place}. Write what ${about.actor} says, under 14 words.`;
  const out = await structured(llm, LineSchema, { kind: "chatter-line", system, prompt, maxTokens: 50, temperature: 0.9 });
  if (!out) return null;
  const line = out.line.trim().replace(/^"|"$/g, "");
  if (/\d|\n/.test(line)) return null;
  const known = knownNameWords([], [about.actor, about.target, about.place]);
  if (unknownNames(line, known).length > 0) return null;
  return line;
}
