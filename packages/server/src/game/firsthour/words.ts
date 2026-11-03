import { z } from "zod";
import { structured } from "../../director/structured.js";
import type { LLMProvider } from "../../llm/provider.js";
import { knownNameWords, unknownNames } from "../../npc/knowledge.js";
import type { FirstHour } from "./run.js";
import { incidentOf } from "./run.js";

/**
 * The opening told in a voice (N39 decision 8): the model may rewrite the incident's opening words (`incident-line`, high priority:
 * the first minutes matter), keeping every fact, with only the names the incident already has. The template's words stand until it
 * answers, and for good if what it wrote names anyone or anything new (the invented-name check).
 */
export const TellingSchema = z.object({ text: z.string().min(30).max(420) });

export async function writeIncidentLine(llm: LLMProvider, fh: FirstHour, place: string): Promise<string | null> {
  const def = incidentOf(fh);
  if (!def) return null;
  const plain = def.text.replace(/\{([a-z_]+)\}/g, (m, k: string) => fh.names[k] ?? fh.words[k] ?? m);
  const system = "You retell a moment in a medieval fantasy town in two or three vivid sentences of plain English, present tense, second person where it fits. Reply as JSON: {\"text\": ...}. Keep every fact. Add no people, places or names.";
  const prompt = `In ${place}, on the player's first morning: ${plain}`;
  const out = await structured(llm, TellingSchema, { kind: "incident-line", system, prompt, maxTokens: 160, temperature: 0.8 });
  if (!out) return null;
  const allowed = [place, ...Object.values(fh.names), ...Object.values(fh.words), def.title];
  return unknownNames(out.text, knownNameWords([], allowed)).length === 0 ? out.text.trim() : null;
}
