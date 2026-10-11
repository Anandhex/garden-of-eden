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
  /** Most tokens to generate for the reply. Defaults to config.maxReplyTokens. */
  maxTokens?: number;
}

export interface ChatResult {
  text: string;
  toolCalls: ToolCall[];
  /** Useful for Phase 6 performance logging. */
  stats?: { inputTokens: number; outputTokens: number; durationMs: number };
}

/** A request for structured output: the reply must be JSON matching `schema`. */
export interface GenerateRequest {
  system: string;
  prompt: string;
  /** JSON Schema the reply must follow (e.g. from z.toJSONSchema). */
  schema: Record<string, unknown>;
  maxTokens?: number;
  /** Lower for summaries and checks. */
  temperature?: number;
}

/** Turns text into vectors, for recall by meaning (game/db.ts). */
export interface Embedder {
  embed(texts: string[]): Promise<number[][]>;
  readonly name: string;
}

export interface LLMProvider {
  /** Send one request. Calls onText with each chunk of text as it streams in. */
  chat(req: ChatRequest, onText?: (delta: string) => void): Promise<ChatResult>;
  /**
   * Structured output (Ollama's `format`): returns the raw JSON text. Optional: callers
   * fall back to chat() and parse its text (director/structured.ts).
   */
  generate?(req: GenerateRequest): Promise<string>;
  /** Cancel anything in flight (background work makes way for the player). */
  abort?(): void;
}
