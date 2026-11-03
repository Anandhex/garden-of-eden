import { z } from "zod";
import { structured } from "../../director/structured.js";
import type { LLMProvider } from "../../llm/provider.js";
import { knownNameWords, unknownNames } from "../../npc/knowledge.js";

/**
 * Table talk (N41 decision 8): one line of banter at a game the player is at, from the model at the lowest priority of all (`banter`).
 * Under load or with the model off there is simply no line: the game is the same without it. Only the names at the table may appear.
 */
export const BanterSchema = z.object({ line: z.string().min(6).max(110) });

export async function writeBanter(llm: LLMProvider, about: { game: string; speaker: string; others: string[]; how: string }): Promise<string | null> {
  const system = "You write one line of table talk in a medieval fantasy inn. Reply as JSON: {\"line\": ...}. One short sentence, period speech, no profanity, no real-world references. Invent no names.";
  const prompt = `At ${about.game}, ${about.speaker} says something to ${about.others.join(" and ")}: ${about.how}. Under 16 words.`;
  const out = await structured(llm, BanterSchema, { kind: "banter", system, prompt, maxTokens: 60, temperature: 1 });
  if (!out) return null;
  const line = out.line.trim().replace(/^"|"$/g, "");
  if (/\n/.test(line) || unknownNames(line, knownNameWords([], [about.speaker, ...about.others])).length > 0) return null;
  return `${about.speaker}: "${line}"`;
}
