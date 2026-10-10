export const config = {
  ollamaHost: process.env.OLLAMA_HOST ?? "http://localhost:11434",
  // Tested on an 8 GB M2: fast (~1-3 s) and the most reliable small model at tool calls.
  model: process.env.NPC_MODEL ?? "qwen3:4b-instruct",
  // Ollama's default context is small; anything beyond it is silently dropped.
  numCtx: 8192,
  temperature: 0.7,
  // Keeps NPC replies short.
  maxReplyTokens: 150,
  // Keep the model loaded between turns so replies start fast.
  keepAlive: "30m",
  // Safety valve: max model round-trips (speech + tool calls) per player line.
  maxStepsPerTurn: 4,
};
