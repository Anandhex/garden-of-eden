import { z } from "zod";
import type { ChatMessage, LLMProvider } from "../llm/provider.js";
import { knownNameWords, unknownNames } from "../npc/knowledge.js";
import { remember } from "../npc/memory.js";
import { traitsOf } from "../npc/traits.js";
import type { NpcPersona, NpcState } from "../npc/types.js";
import { structured } from "./structured.js";

/**
 * Conversation summaries (optional, N0/N5): when old exchanges drop out of the
 * context window, or a conversation ends, one structured call turns them into 1-5
 * short facts the NPC remembers ("they asked about my brother", "they seemed in a
 * hurry"). Code events stay the source of truth: summary facts are marked as such,
 * capped at low importance, never gossiped, and change no state. They also go into
 * the long-term store with an embedding (game/db.ts), so a later conversation can
 * recall them by meaning.
 */
export const SummarySchema = z.object({
  facts: z
    .array(z.object({ text: z.string().min(3).max(120), importance: z.number().int().min(1).max(5), feeling: z.enum(["good", "bad", "neutral"]) }))
    .min(1)
    .max(5),
  tone: z.enum(["friendly", "neutral", "tense", "hostile"]),
});
export type Summary = z.infer<typeof SummarySchema>;

/** Most importance a summary fact gets: less than any event code wrote. */
export const SUMMARY_IMPORTANCE_CAP = 4;

/** The conversation as plain lines: "Traveler: ...", "Brena: ...". Situation blocks and tool chatter are left out. */
export function transcriptLines(messages: readonly ChatMessage[], npcName: string, playerName: string): string[] {
  const lines: string[] = [];
  for (const m of messages) {
    if (m.role === "user") {
      const said = m.content.match(/says: "([\s\S]*)"\s*$/);
      const event = m.content.match(/\n\n\(([\s\S]*)\)\s*$/);
      if (said) lines.push(`${playerName}: ${said[1]}`);
      else if (event) lines.push(`(${event[1]})`);
    } else if (m.role === "assistant" && m.content.trim()) lines.push(`${npcName}: ${m.content.trim()}`);
  }
  return lines;
}

/**
 * Summarise a stretch of conversation from the NPC's side. Returns the facts it
 * stored as memories, or [] if there was nothing to say or the call failed.
 */
export async function summariseConversation(
  llm: LLMProvider,
  persona: NpcPersona,
  state: NpcState,
  messages: readonly ChatMessage[],
  playerName: string,
  day: number,
): Promise<Summary | null> {
  const lines = transcriptLines(messages, persona.name, playerName);
  if (lines.length < 2) return null;
  const prompt = `${lines.slice(-24).join("\n")}\n\nAs ${persona.name}, note 1-5 short facts worth remembering about ${playerName} from this talk (what they wanted, said or seemed like), and the tone. Only facts from the talk; never invent names.`;
  const out = await structured(llm, SummarySchema, { system: "You summarise a conversation into a character's memories. Reply as JSON.", prompt, maxTokens: 220, temperature: 0.2 });
  if (!out) return null;
  const known = knownNameWords([persona], [playerName]);
  const facts = out.facts.filter((f) => unknownNames(f.text, known).length === 0);
  const t = traitsOf(persona, state);
  facts.forEach((f, i) => {
    const text = f.text.replace(new RegExp(`\\b${playerName}\\b`, "g"), "they").replace(/\.$/, "");
    remember(
      state,
      { id: `summary-${day}-${i}-${text.slice(0, 16).replace(/\W+/g, "_")}`, day, text: `(from talking) ${text}`, importance: Math.min(SUMMARY_IMPORTANCE_CAP, f.importance), valence: f.feeling === "good" ? 1 : f.feeling === "bad" ? -1 : 0, summary: true },
      t,
    );
  });
  return { ...out, facts };
}
