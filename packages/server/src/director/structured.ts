import { z } from "zod";
import type { LLMProvider } from "../llm/provider.js";

/**
 * One structured-output call, checked by a Zod schema. Uses the provider's
 * `generate` (Ollama's `format`) when it has one, else a plain chat whose text is
 * parsed as JSON. Retries once; null if both tries fail, so the caller falls back
 * to template text. The model's JSON is never trusted until it passes the schema.
 */
export async function structured<T extends z.ZodType>(
  llm: LLMProvider,
  schema: T,
  req: { system: string; prompt: string; maxTokens?: number; temperature?: number },
  tries = 2,
): Promise<z.infer<T> | null> {
  for (let i = 0; i < tries; i++) {
    try {
      const text = llm.generate
        ? await llm.generate({ ...req, schema: z.toJSONSchema(schema) as Record<string, unknown> })
        : (await llm.chat({ system: `${req.system}\nReply with JSON only.`, messages: [{ role: "user", content: req.prompt }], ...(req.maxTokens ? { maxTokens: req.maxTokens } : {}) })).text;
      const parsed = schema.safeParse(JSON.parse(extractJson(text)));
      if (parsed.success) return parsed.data;
    } catch {
      // Try again, then give up.
    }
  }
  return null;
}

/** The first {...} block in a reply (models sometimes wrap JSON in prose or fences). */
export function extractJson(text: string): string {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  return start >= 0 && end > start ? text.slice(start, end + 1) : text;
}
