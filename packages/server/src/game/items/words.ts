import { z } from "zod";
import { structured } from "../../director/structured.js";
import type { LLMProvider } from "../../llm/provider.js";
import { inventedWords } from "../realm/director.js";

/**
 * Words for famous items (N43 decision 5): a name (`item-name`) and a two-sentence legend (`item-legend`), each from the facts, low
 * priority, through the invented-name check. The template's name and legend stand without them (game/items/notable.ts).
 */
export const ItemNameSchema = z.object({ name: z.string().min(3).max(32) });
export const LegendSchema = z.object({ legend: z.string().min(30).max(320) });

export async function writeItemName(llm: LLMProvider, about: { base: string; deed: string; names: string[] }): Promise<string | null> {
  const system = "You name a famous weapon or treasure in a medieval fantasy realm. Reply as JSON: {\"name\": ...}. Two to four words, like \"Greyfang's Bane\" or \"the Widow's Oath\". Use only the names given, or none.";
  const out = await structured(llm, ItemNameSchema, { kind: "item-name", system, prompt: `A ${about.base}, famous because ${about.deed}.`, maxTokens: 30, temperature: 0.9 });
  if (!out) return null;
  const name = out.name.trim().replace(/^"|"$/g, "");
  return inventedWords(name, about.names).length === 0 ? name : null;
}

export async function writeItemLegend(llm: LLMProvider, about: { name: string; facts: string; names: string[] }): Promise<string | null> {
  const system = "You tell the legend of a famous item in two sentences, plainly, in a medieval fantasy realm. Reply as JSON: {\"legend\": ...}. Keep to the facts given. Add no names.";
  const out = await structured(llm, LegendSchema, { kind: "item-legend", system, prompt: `${about.name}: ${about.facts}`, maxTokens: 120, temperature: 0.8 });
  if (!out) return null;
  return inventedWords(out.legend, [about.name, ...about.names]).length === 0 ? out.legend.trim() : null;
}
