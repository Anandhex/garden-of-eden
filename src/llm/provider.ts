/**
 * The only contract the game uses to talk to a model.
 * Nothing outside src/llm/ should import "ollama". Swapping to Groq, Gemini,
 * Claude, etc. later means writing one new class that implements LLMProvider.
 */

export type ChatMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: ToolCall[] }
  | { role: "tool"; toolName: string; content: string };

export interface ToolDef {
  name: string;
  description: string;
  /** JSON Schema for the arguments (e.g. from z.toJSONSchema). */
  parameters: Record<string, unknown>;
}

export interface ToolCall {
  name: string;
  /** Untrusted model output. Always validate before using. */
  arguments: Record<string, unknown>;
}

export interface ChatRequest {
  system: string;
  messages: ChatMessage[];
  tools?: ToolDef[];
}

export interface ChatResult {
  text: string;
  toolCalls: ToolCall[];
  /** Useful for Phase 6 performance logging. */
  stats?: { inputTokens: number; outputTokens: number; durationMs: number };
}

export interface LLMProvider {
  /** Send one request. Calls onText with each chunk of text as it streams in. */
  chat(req: ChatRequest, onText?: (delta: string) => void): Promise<ChatResult>;
}
