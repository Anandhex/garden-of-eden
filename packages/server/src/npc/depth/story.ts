import { z } from "zod";
import { structured } from "../../director/structured.js";
import { holds, loadPools, tagsOf } from "./pools.js";
import type { LLMProvider } from "../../llm/provider.js";
import type { FactsSheet } from "./facts.js";
import type { NpcPersona } from "../types.js";

/**
 * The model writes a talker's story and depth (N25a step 5b): one structured call, made in the background the moment
 * they become a talker, from the facts sheet only. It chooses and phrases; it never sets a number. Code checks every
 * field (validate.ts) and keeps its own for any that fails. Each field of the reply is read on its own, so one bad
 * field costs only itself.
 */
export const DILEMMA_KINDS = ["bribe", "favour_lie", "debt_plea", "faction_order", "family_plea", "condition", "reputation"] as const;
export const ARC_KINDS = ["grief", "ambition", "freedom", "reconcile", "duty"] as const;

const words = z.array(z.string().min(1).max(40)).min(1).max(6);
const line = (max: number) => z.string().min(1).max(max);

export const StorySchema = z.object({
  backstory: line(600).optional().catch(undefined),
  personality: z.array(z.string().min(1).max(24)).min(2).max(5).optional().catch(undefined),
  speechStyle: line(300).optional().catch(undefined),
  appearance: line(240).optional().catch(undefined),
  quirks: z.array(z.object({ line: line(200), topic: words })).max(3).catch([]),
  fears: z.array(z.object({ name: line(80), words, because: line(160) })).max(3).catch([]),
  loves: z.array(z.object({ name: line(80), words, because: line(160) })).max(3).catch([]),
  secrets: z.array(z.object({ candidate: z.string(), about: line(140), text: line(400), cover: line(200) })).max(2).catch([]),
  dilemmas: z.array(z.object({ kind: z.enum(DILEMMA_KINDS), target: z.string().optional(), offer: line(240), yes: line(80), no: line(80) })).max(2).catch([]),
  arcs: z.array(z.object({ kind: z.enum(ARC_KINDS), about: z.string().optional(), name: line(60), lines: z.array(line(200)).min(2).max(3) })).max(1).catch([]),
  goals: z.array(line(100)).min(2).max(3).optional().catch(undefined),
  reputationFacts: z.array(z.object({ text: line(200), keywords: words })).max(3).catch([]),
});
export type Story = z.infer<typeof StorySchema>;

function sheetText(s: FactsSheet): string {
  const rel = s.family.length > 0 ? s.family.map((r) => `${r.name} (${r.kind}, ${r.alive ? "alive" : `dead of ${r.cause ?? "unknown"}`})`).join("; ") : "none known";
  return [
    `Name: ${s.name}, ${s.gender}, age ${s.age}. ${s.role}. Trade: ${s.job}. Class: ${s.cls}${s.law !== "free" ? ` (a ${s.law})` : ""}.`,
    `Lives in ${s.siteName}, a ${s.siteKind}${s.kingdom ? ` of the kingdom of ${s.kingdom}` : ""}.${s.lord ? ` The head of the place: ${s.lord}.` : ""}${s.master ? ` Answers to: ${s.master}.` : ""}`,
    s.faction ? `Belongs to ${s.faction.name} (${s.faction.rank}).` : "",
    `Family: ${rel}.`,
    s.deeds.length > 0 ? `Known for: ${s.deeds.join("; ")}.` : "",
    s.conditions.length > 0 ? `In the place just now: ${s.conditions.join("; ")}.` : "",
    s.history.length > 0 ? `What has happened to them: ${s.history.join("; ")}.` : "",
    s.feelings.length > 0 ? `How they have come to feel: ${s.feelings.join("; ")}.` : "",
    s.neighbours.length > 0 ? `Other people of the place: ${s.neighbours.map((n) => `${n.name} (${n.job})`).join(", ")}.` : "",
    s.secrets.length > 0 ? `Possible secrets (choose by id, only those that fit): ${s.secrets.map((c) => `${c.id} = ${c.fact}`).join("; ")}.` : "No possible secrets: write none.",
  ]
    .filter(Boolean)
    .join("\n");
}

/** The prompt for one talker. Nothing in it but the sheet and the template's own words. */
export function storyPrompt(sheet: FactsSheet, persona: NpcPersona): { system: string; prompt: string } {
  // Only the kinds of dilemma and arc that hold for them (code's pools say which): a kind that doesn't is rejected, so the model isn't offered it.
  const tags = tagsOf(sheet);
  const pools = loadPools();
  const dilemmaKinds = [...new Set(pools.dilemmas.filter((d) => holds(d.requires, sheet, persona, tags)).map((d) => d.kind))];
  const arcKinds = [...new Set(pools.arcs.filter((a) => holds(a.requires, sheet, persona, tags)).map((a) => a.kind))];
  const system =
    `You write the inner life of one person in a small fantasy world, from the facts you are given. Reply with JSON only. Keep it grounded and plain: no magic powers, no royalty, no famous ancestors. ` +
    `Use only the people and places named in the facts; never invent another named person or place. Never contradict a fact (a living relative is not dead; a dead one is not alive). ` +
    `You choose and phrase; you never set numbers.` +
    (persona.minor ? " This is a child: keep everything gentle and age-appropriate; no romance, drink or violence." : "");
  const prompt =
    `Write for this person:\n- backstory (3 to 5 sentences, from their facts), personality (3 to 5 short words), speechStyle (one or two sentences with a habit of speech), appearance (one sentence)\n` +
    `- quirks (2 or 3: a habit, a line written to them in the second person "You...", and a few topic words that bring it out)\n` +
    `- fears and loves (2 or 3 each: a name, a few lower-case words that count as a mention, and the reason, which must be a fact above)\n` +
    `- secrets (0 to 2): choose from the possible secrets by id; write what the secret is about, the secret itself, and the cover story they tell instead\n` +
    `- dilemmas (${dilemmaKinds.length > 0 ? `0 or 1): a choice they might put to a stranger they trust. kind is one of ${dilemmaKinds.join(", ")}` : "none: write an empty list"}; target is a name from the facts if one is involved; offer is what they ask, written to them; yes and no are what the two choices are called\n` +
    `- arcs (${arcKinds.length > 0 ? `0 or 1): something they want over the coming weeks. kind is one of ${arcKinds.join(", ")}` : "none: write an empty list"}; three short lines of how it goes, in the second person\n` +
    `- goals (2 or 3), reputationFacts (0 to 3: what the town says of them, true to their deeds only, naming them, with a few keywords)\n\n` +
    `Their words so far: personality ${persona.personality.join(", ")}; speaks: ${persona.speechStyle}.\n\n${sheetText(sheet)}`;
  return { system, prompt };
}

/** Ask the model. Null if it fails twice or the call is over the day's cap. */
export async function writeStory(llm: LLMProvider, sheet: FactsSheet, persona: NpcPersona): Promise<Story | null> {
  const { system, prompt } = storyPrompt(sheet, persona);
  return structured(llm, StorySchema, { kind: "persona-story", system, prompt, maxTokens: 900, temperature: 0.9 }, 2);
}
