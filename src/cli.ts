import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import brena from "./data/npcs/brena.json" with { type: "json" };
import { config } from "./config.js";
import { OllamaProvider } from "./llm/ollama.js";
import { NpcAgent } from "./npc/NpcAgent.js";
import type { NpcPersona } from "./npc/types.js";
import { createDemoWorld } from "./world/world.js";

const llm = new OllamaProvider();
const npc = new NpcAgent(brena as NpcPersona, llm);
const world = createDemoWorld();
const rl = createInterface({ input: stdin, output: stdout });

console.log(`Loading ${config.model}...`);
try {
  await llm.warmUp();
} catch (err) {
  console.error(`Could not reach Ollama at ${config.ollamaHost}. Is it running? (${(err as Error).message})`);
  process.exit(1);
}
console.log(`Talking to ${npc.persona.name}. Commands: /state, /quit\n`);

while (!npc.state.conversationOver) {
  const line = (await rl.question("You: ")).trim();
  if (!line) continue;
  if (line === "/quit") break;
  if (line === "/state") {
    console.log({ npc: npc.state, player: world.player });
    continue;
  }

  stdout.write(`${npc.persona.name}: `);
  try {
    const { actions } = await npc.respond(line, world, (delta) => stdout.write(delta));
    stdout.write("\n");
    for (const a of actions) {
      console.log(`  [${a.ok ? "ok" : "failed"}] ${a.name} -> ${a.message}`);
    }
  } catch (err) {
    console.error(`\n[error] ${(err as Error).message}`);
  }
}

console.log(`\n${npc.persona.name} turns back to the forge.`);
rl.close();
