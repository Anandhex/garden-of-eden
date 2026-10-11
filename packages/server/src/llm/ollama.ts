import { Ollama, type Message, type Tool } from "ollama";
import { config } from "../config.js";
import type {
  ChatMessage,
  ChatRequest,
  ChatResult,
  Embedder,
  GenerateRequest,
  LLMProvider,
  ToolCall,
  ToolDef,
} from "./provider.js";

export class OllamaProvider implements LLMProvider {
  private readonly client = new Ollama({ host: config.ollamaHost });

  constructor(private readonly model = config.model) {}

  async chat(
    req: ChatRequest,
    onText?: (delta: string) => void,
  ): Promise<ChatResult> {
    const messages: Message[] = [
      { role: "system", content: req.system },
      ...req.messages.map(toOllamaMessage),
    ];
    const tools = req.tools?.map(toOllamaTool);

    const stream = await this.client.chat({
      model: this.model,
      messages,
      tools,
      stream: true,
      // Hybrid models like qwen3:1.7b otherwise reason for seconds before every line.
      // Models without a thinking mode ignore this.
      think: false,
      options: {
        num_ctx: config.numCtx,
        temperature: config.temperature,
        num_predict: req.maxTokens ?? config.maxReplyTokens,
      },
      keep_alive: config.keepAlive,
    });

    let text = "";
    const toolCalls: ToolCall[] = [];
    let stats: ChatResult["stats"];

    for await (const chunk of stream) {
      const delta = chunk.message.content;
      if (delta) {
        text += delta;
        onText?.(delta);
      }
      // Tool calls can arrive in any chunk, usually whole rather than split.
      for (const c of chunk.message.tool_calls ?? []) {
        toolCalls.push({ name: c.function.name, arguments: c.function.arguments });
      }
      if (chunk.done) {
        stats = {
          inputTokens: chunk.prompt_eval_count,
          outputTokens: chunk.eval_count,
          durationMs: chunk.total_duration / 1_000_000,
        };
      }
    }

    return { text, toolCalls, stats };
  }

  /** Structured output: the reply is JSON following `req.schema` (Ollama's `format`). */
  async generate(req: GenerateRequest): Promise<string> {
    const res = await this.client.chat({
      model: this.model,
      messages: [
        { role: "system", content: req.system },
        { role: "user", content: req.prompt },
      ],
      format: req.schema,
      stream: false,
      think: false,
      options: { num_ctx: config.numCtx, temperature: req.temperature ?? 0.3, num_predict: req.maxTokens ?? 300 },
      keep_alive: config.keepAlive,
    });
    return res.message.content;
  }

  /** Cancel every request this provider has in flight. Background work uses its own provider, so this never cuts off a conversation. */
  abort(): void {
    this.client.abort();
  }

  /** Load the model into memory ahead of time so the first NPC reply is fast. */
  async warmUp(): Promise<void> {
    // Empty `messages` loads the model without generating. (Generating a cut-off
    // reply here leaked stray tokens like ":end" into the next real reply.)
    await this.client.chat({
      model: this.model,
      messages: [],
      options: { num_ctx: config.numCtx },
      keep_alive: config.keepAlive,
    });
  }
}

function toOllamaMessage(m: ChatMessage): Message {
  switch (m.role) {
    case "user":
      return { role: "user", content: m.content };
    case "assistant":
      return {
        role: "assistant",
        content: m.content,
        tool_calls: m.toolCalls?.map((c) => ({
          function: { name: c.name, arguments: c.arguments },
        })),
      };
    case "tool":
      return { role: "tool", tool_name: m.toolName, content: m.content };
  }
}

function toOllamaTool(t: ToolDef): Tool {
  return {
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters as Tool["function"]["parameters"],
    },
  };
}

/**
 * Embeddings from a local Ollama model (config.embedModel, e.g. nomic-embed-text).
 * If the model isn't pulled, `available()` is false and callers use the hashed
 * fallback (game/embeddings.ts).
 */
export class OllamaEmbedder implements Embedder {
  private readonly client = new Ollama({ host: config.ollamaHost });
  constructor(readonly name = config.embedModel) {}

  async available(): Promise<boolean> {
    try {
      const list = await this.client.list();
      return list.models.some((m) => m.name === this.name || m.name.startsWith(`${this.name}:`));
    } catch {
      return false;
    }
  }

  async embed(texts: string[]): Promise<number[][]> {
    const res = await this.client.embed({ model: this.name, input: texts, keep_alive: config.keepAlive });
    return res.embeddings;
  }
}
