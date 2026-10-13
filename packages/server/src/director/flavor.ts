import { z } from "zod";
import type { LLMProvider } from "../llm/provider.js";
import { knownNameWords, unknownNames } from "../npc/knowledge.js";
import type { NpcPersona, QuestDef } from "../npc/types.js";
import { describeObjective } from "../game/quests.js";
import { structured } from "./structured.js";

/**
 * Quest flavour (N9): code picks a quest's structure (goal, tier, reward from the
 * giver's needs); the model only writes the title and the reason, through structured
 * output, and the result is checked. A failed check keeps the template text
 * ("Iron ore wanted"), so the quest always works.
 */
export const FlavorSchema = z.object({ title: z.string().min(3).max(50), reason: z.string().min(10).max(220) });

export async function generateQuestFlavor(llm: LLMProvider, persona: NpcPersona, quest: QuestDef, extraNames: string[] = []): Promise<{ title: string; description: string } | null> {
  const prompt = [
    `You are ${persona.name}, ${persona.role}. Speech: ${persona.speechStyle}`,
    `You need someone to ${describeObjective(quest)}. Why, in plain terms: ${quest.description}`,
    "Give the job a short title (under 6 words) and one or two sentences, in your own voice, on why you need it. Name no one new.",
  ].join("\n");
  const out = await structured(llm, FlavorSchema, { kind: "quest-flavor", system: "You write a job posting for a village character. Reply as JSON: {\"title\": ..., \"reason\": ...}.", prompt, maxTokens: 120, temperature: 0.7 });
  if (!out) return null;
  const known = knownNameWords([persona], extraNames);
  if (unknownNames(`${out.title}. ${out.reason}`, known).length > 0) return null;
  return { title: out.title.replace(/^"|"$/g, ""), description: out.reason };
}

/** Flavour every template quest on a board that hasn't been written up yet. Returns how many changed. */
export async function flavorBoard(llm: LLMProvider, persona: NpcPersona, board: QuestDef[], extraNames: string[] = []): Promise<number> {
  let n = 0;
  for (const q of board) {
    if (q.flavored || q.favour) continue;
    const f = await generateQuestFlavor(llm, persona, q, extraNames);
    q.flavored = true;
    if (!f) continue;
    q.title = f.title;
    q.description = f.description;
    n++;
  }
  return n;
}
