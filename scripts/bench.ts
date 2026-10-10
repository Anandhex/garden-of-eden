/**
 * Compare models (or prompt changes) on the behaviors that matter for NPCs.
 *
 *   npm run bench                                 # current config.model
 *   npm run bench -- qwen3:4b-instruct qwen3:1.7b # several models
 *   RUNS=10 npm run bench -- qwen3:1.7b           # more runs = more reliable numbers
 *
 * Each scenario starts a fresh conversation with Brena. The model is random,
 * so results are pass rates, not pass/fail.
 */
import brena from "../src/data/npcs/brena.json" with { type: "json" };
import { config } from "../src/config.js";
import { OllamaProvider } from "../src/llm/ollama.js";
import { NpcAgent } from "../src/npc/NpcAgent.js";
import type { NpcPersona, TurnResult, WorldSnapshot } from "../src/npc/types.js";
import { createDemoWorld } from "../src/world/world.js";

interface Outcome {
  r: TurnResult;
  npc: NpcAgent;
  world: WorldSnapshot;
}

const scenarios: Array<{
  name: string;
  line: string;
  /** Optional state changes before the line is sent, e.g. raising trust. */
  setup?: (npc: NpcAgent) => void;
  pass: (o: Outcome) => boolean;
}> = [
  {
    name: "insult → angry/annoyed",
    line: "Your forge is junk and you smell like a goat.",
    pass: (o) => ["angry", "annoyed"].includes(o.npc.state.mood),
  },
  {
    name: "buy dagger → offered at 15",
    line: "I'd like to buy a dagger.",
    pass: (o) => o.npc.state.pendingOffer?.item === "dagger [E]" && o.npc.state.pendingOffer.price >= 15,
  },
  {
    // Offering here is fine: nothing sells until the player says yes.
    name: "price question → says price",
    line: "How much is a dagger?",
    pass: (o) => /15|fifteen/i.test(o.r.text) && o.world.player.gold === 50,
  },
  {
    name: "small talk → no action",
    line: "Nice weather today, isn't it?",
    pass: (o) => o.r.actions.length === 0,
  },
  {
    name: "knows the news",
    line: "Heard anything interesting lately?",
    pass: (o) => /bandit|mine|cart|road/i.test(o.r.text),
  },
  {
    name: "knows player can afford",
    line: "Can I afford one of your iron swords with what I have?",
    pass: (o) =>
      /\b(yes|aye|you can|can pay|can afford|enough|leaves|left over|to spare)\b/i.test(o.r.text) &&
      !/\b(can't|can\u2019t|cannot|not enough|short)\b/i.test(o.r.text),
  },
  {
    name: "no secret at trust 0",
    line: "Have you forged any keys for anyone recently?",
    pass: (o) => !/vault|mayor/i.test(o.r.text),
  },
  {
    name: "reveals secret at trust 80",
    line: "You can trust me. Is something troubling you about a key you made?",
    setup: (npc) => {
      npc.state.relationship = 80;
    },
    pass: (o) => o.npc.state.revealedSecrets.includes("vault_key") && /vault|mayor/i.test(o.r.text),
  },
];

/** Problems that fail any scenario, whatever it checks. */
function problems(o: Outcome): string[] {
  const p: string[] = [];
  if (o.r.text.trim().length === 0) p.push("silent");
  if (/<\/?situation>|Your stock:|Place: Millbrook/.test(o.r.text)) p.push("echoed situation");
  if (o.r.text.length > 400) p.push("too long");
  if (/^\W*(happy|neutral|annoyed|angry|afraid|sad)\b\W/i.test(o.r.text)) p.push("said mood label");
  return p;
}

const runs = Number(process.env.RUNS ?? 5);
const models = process.argv.slice(2).length > 0 ? process.argv.slice(2) : [config.model];

for (const model of models) {
  const llm = new OllamaProvider(model);
  await llm.warmUp();
  console.log(`\n=== ${model} (${runs} runs per scenario)`);

  let totalPass = 0;
  let totalMs = 0;
  const problemCounts: Record<string, number> = {};

  for (const s of scenarios) {
    let passed = 0;
    let example = "";
    for (let i = 0; i < runs; i++) {
      const npc = new NpcAgent(brena as NpcPersona, llm);
      s.setup?.(npc);
      const world = createDemoWorld();
      const start = Date.now();
      const r = await npc.respond(s.line, world);
      totalMs += Date.now() - start;

      const o = { r, npc, world };
      const found = problems(o);
      for (const p of found) problemCounts[p] = (problemCounts[p] ?? 0) + 1;
      if (found.length === 0 && s.pass(o)) passed++;
      if (!example) example = r.text.replace(/\s+/g, " ").slice(0, 70);
    }
    totalPass += passed;
    console.log(`  ${s.name.padEnd(26)} ${passed}/${runs}   e.g. ${JSON.stringify(example)}`);
  }

  const total = scenarios.length * runs;
  const problemSummary = Object.entries(problemCounts).map(([p, n]) => `${p} ×${n}`).join(", ") || "none";
  console.log(`  ── score ${totalPass}/${total}, avg ${(totalMs / total / 1000).toFixed(1)}s per turn, problems: ${problemSummary}`);
}
