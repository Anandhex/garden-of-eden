import { z } from "zod";
import { structured } from "../../director/structured.js";
import type { LLMProvider } from "../../llm/provider.js";
import { knownNameWords, unknownNames } from "../../npc/knowledge.js";

/**
 * A nemesis's taunt (N44 decision 6) in their own voice: the model's `taunt` kind, kept only if it still names the day and the place of the
 * meeting it is about and invents nobody. The template (model.ts `templateTaunt`) stands otherwise.
 */
export const TauntSchema = z.object({ line: z.string().min(12).max(160) });

export async function writeTaunt(llm: LLMProvider, about: { name: string; player: string; place: string; when: string; how: string }): Promise<string | null> {
  const system = "You write one line a vengeful outlaw says to an old enemy before a fight, in a medieval fantasy realm. Reply as JSON: {\"line\": ...}. Name the place and the day given. One or two short sentences. Invent no names.";
  const prompt = `${about.name} faces ${about.player} again. They first met on ${about.place}'s road, ${about.when}: ${about.how}.`;
  const out = await structured(llm, TauntSchema, { kind: "taunt", system, prompt, maxTokens: 70, temperature: 0.9 });
  if (!out) return null;
  const line = out.line.trim().replace(/^"|"$/g, "");
  if (!line.includes(about.place) || !line.toLowerCase().includes(about.when.split(" ").slice(-1)[0]!.toLowerCase())) return null;
  return unknownNames(line, knownNameWords([], [about.name, about.player, about.place])).length === 0 ? line : null;
}
