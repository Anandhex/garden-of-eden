import { beforeEach, describe, expect, it, vi } from "vitest";

// Replace the real Ollama client with a fake whose chat() we control.
const { mockChat } = vi.hoisted(() => ({ mockChat: vi.fn() }));
vi.mock("ollama", () => ({
  Ollama: class {
    chat = mockChat;
  },
}));

const { OllamaProvider } = await import("../src/llm/ollama.js");
const { config } = await import("../src/config.js");

/** Build a fake stream that yields the given chunks like Ollama does. */
function fakeStream(chunks: Array<{ content?: string; tool_calls?: unknown[]; done?: boolean }>) {
  return (async function* () {
    for (const c of chunks) {
      yield {
        message: { role: "assistant", content: c.content ?? "", tool_calls: c.tool_calls },
        done: c.done ?? false,
        prompt_eval_count: 120,
        eval_count: 30,
        total_duration: 2_500_000_000, // nanoseconds
      };
    }
  })();
}

beforeEach(() => mockChat.mockReset());

describe("OllamaProvider.chat", () => {
  it("streams text to onText chunk by chunk and returns the full text", async () => {
    mockChat.mockResolvedValue(fakeStream([{ content: "My " }, { content: "forge." }, { done: true }]));
    const deltas: string[] = [];

    const result = await new OllamaProvider().chat(
      { system: "sys", messages: [{ role: "user", content: "hi" }] },
      (d) => deltas.push(d),
    );

    expect(deltas).toEqual(["My ", "forge."]);
    expect(result.text).toBe("My forge.");
    expect(result.toolCalls).toEqual([]);
  });

  it("collects tool calls from any chunk", async () => {
    mockChat.mockResolvedValue(
      fakeStream([
        { tool_calls: [{ function: { name: "change_mood", arguments: { mood: "angry" } } }] },
        { done: true },
      ]),
    );

    const result = await new OllamaProvider().chat({ system: "sys", messages: [{ role: "user", content: "x" }] });

    expect(result.text).toBe("");
    expect(result.toolCalls).toEqual([{ name: "change_mood", arguments: { mood: "angry" } }]);
  });

  it("reads stats from the final chunk (durations in ms)", async () => {
    mockChat.mockResolvedValue(fakeStream([{ content: "Hm." }, { done: true }]));
    const result = await new OllamaProvider().chat({ system: "sys", messages: [{ role: "user", content: "x" }] });
    expect(result.stats).toEqual({ inputTokens: 120, outputTokens: 30, durationMs: 2500 });
  });

  it("sends the system prompt first and converts messages and tools to Ollama's format", async () => {
    mockChat.mockResolvedValue(fakeStream([{ done: true }]));

    await new OllamaProvider("test-model").chat({
      system: "You are Brena.",
      messages: [
        { role: "user", content: "insult" },
        { role: "assistant", content: "", toolCalls: [{ name: "change_mood", arguments: { mood: "angry" } }] },
        { role: "tool", toolName: "change_mood", content: "Your mood is now angry." },
      ],
      tools: [{ name: "change_mood", description: "Change mood", parameters: { type: "object" } }],
    });

    const req = mockChat.mock.calls[0]![0];
    expect(req.model).toBe("test-model");
    expect(req.stream).toBe(true);
    expect(req.options).toMatchObject({ num_ctx: config.numCtx, num_predict: config.maxReplyTokens });
    expect(req.messages).toEqual([
      { role: "system", content: "You are Brena." },
      { role: "user", content: "insult" },
      { role: "assistant", content: "", tool_calls: [{ function: { name: "change_mood", arguments: { mood: "angry" } } }] },
      { role: "tool", tool_name: "change_mood", content: "Your mood is now angry." },
    ]);
    expect(req.tools).toEqual([
      { type: "function", function: { name: "change_mood", description: "Change mood", parameters: { type: "object" } } },
    ]);
  });
});

describe("OllamaProvider.warmUp", () => {
  it("loads the model without generating (empty messages)", async () => {
    mockChat.mockResolvedValue({});
    await new OllamaProvider("test-model").warmUp();
    expect(mockChat).toHaveBeenCalledWith(expect.objectContaining({ model: "test-model", messages: [] }));
  });
});
