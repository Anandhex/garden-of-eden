import type { ChatMessage, ToolDef } from "./provider.js";

/**
 * Rough token counts, for keeping requests inside the context window without a
 * tokenizer. About 3.5 characters per token for English and JSON, rounded up:
 * deliberately on the high side, since over-counting only trims a little early.
 */
const CHARS_PER_TOKEN = 3.5;
/** Role markers and separators each message adds in the chat template. */
const PER_MESSAGE = 4;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export function estimateMessage(m: ChatMessage): number {
  const calls = m.role === "assistant" && m.toolCalls?.length ? estimateTokens(JSON.stringify(m.toolCalls)) : 0;
  return PER_MESSAGE + estimateTokens(m.content) + calls;
}

/** The whole request: system prompt, tool definitions and every message. */
export function estimateRequest(system: string, messages: ChatMessage[], tools: ToolDef[] = []): number {
  return (
    PER_MESSAGE +
    estimateTokens(system) +
    (tools.length > 0 ? estimateTokens(JSON.stringify(tools)) : 0) +
    messages.reduce((sum, m) => sum + estimateMessage(m), 0)
  );
}
