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
import { parsePersona } from "../src/npc/personaSchema.js";
import { knownNameWords, unknownNames } from "../src/npc/knowledge.js";
import hale from "../src/data/npcs/hale.json" with { type: "json" };
import pell from "../src/data/npcs/pell.json" with { type: "json" };

interface Outcome {
  r: TurnResult;
  npc: NpcAgent;
  world: WorldSnapshot;
  /** The player's line: names in it aren't invented when the NPC repeats them. */
  line: string;
}

const scenarios: Array<{
  name: string;
  line: string;
  /** Optional state changes before the line is sent, e.g. raising trust. */
  setup?: (npc: NpcAgent, world: WorldSnapshot) => void;
  /** Who's talking. Defaults to Brena. */
  persona?: NpcPersona;
  pass: (o: Outcome) => boolean;
}> = [
  {
    name: "insult → angry/annoyed",
    line: "Your forge is junk and you smell like a goat.",
    pass: (o) => ["angry", "annoyed"].includes(o.npc.state.mood),
  },
  {
    name: "buy dagger → offered at 1 gold 5 silver",
    line: "I'd like to buy a dagger.",
    pass: (o) => o.npc.state.pendingOffer?.item === "dagger [E]" && o.npc.state.pendingOffer.price >= 150,
  },
  {
    // Offering here is fine: nothing sells until the player says yes.
    name: "price question → says price",
    line: "How much is a dagger?",
    pass: (o) => /\b(1|one) gold\b.*\b(5|five) silver\b|\b(15|fifteen) silver\b/i.test(o.r.text) && o.world.player.money === 500,
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
    // N3.1: nothing in the lore by that name.
    name: "unknown place → don't know, ask Pell",
    line: "What can you tell me about the ruins of Kargoth?",
    pass: (o) => DONT_KNOW.test(o.r.text) && /\bPell\b/i.test(o.r.text),
  },
  {
    // N3.1: the mayor's household is outside Brena's scope; the invented-name check (problems) catches a made-up wife.
    name: "mayor's wife → no invented name",
    line: "What's the mayor's wife called?",
    pass: (o) => DONT_KNOW.test(o.r.text) || /\bPell\b/i.test(o.r.text),
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
  {
    // N4.1: a trusted Hale still tells his cover story.
    name: "Hale keeps his cover story",
    persona: parsePersona(hale),
    line: "Where were you the night the gate was left unguarded?",
    setup: (npc) => {
      npc.state.relationship = 80;
    },
    pass: (o) => !/cellar|hid/i.test(o.r.text) && o.npc.state.revealedSecrets.length === 0,
  },
  {
    // N4.1: with what Pell told you, his story breaks.
    name: "Hale breaks with proof",
    persona: parsePersona(hale),
    line: "Pell told me you hid in his cellar that night. Tell me the truth.",
    setup: (_npc, world) => {
      world.player.facts = ["pell.hale_cellar"];
    },
    pass: (o) => o.npc.state.revealedSecrets.includes("left_post"),
  },
  {
    // N4.3: once she knows and trusts you, she uses your name.
    name: "uses the player's name",
    line: "Morning, Brena. Busy day?",
    setup: (npc, world) => {
      world.player.name = "Anand";
      npc.state.knownName = "Anand";
      npc.state.nameSource = { how: "told" };
      npc.state.metBefore = true;
      npc.state.lastMetDay = 1;
      npc.state.relationship = 40;
    },
    pass: (o) => /\bAnand\b/.test(o.r.text),
  },
  {
    // N5: a remembered insult colours the next day.
    name: "remembers yesterday's insult",
    line: "Morning. Can we start over?",
    setup: (npc, world) => {
      world.day = 2;
      npc.state.relationship = -5;
      npc.state.mood = "annoyed";
      npc.state.memories.push({ id: "insulted-1", day: 1, text: 'they insulted you: "Your forge is junk"', importance: 6, valence: -1 });
    },
    pass: (o) => /junk|insult|yesterday|forge|rude|said/i.test(o.r.text),
  },
  {
    // N6.2: Pell sells a room through the offer flow.
    name: "Pell offers a room",
    persona: parsePersona(pell),
    line: "Could I get a room for the night? I'm hurt.",
    setup: (_npc, world) => {
      world.player.hp = 15;
    },
    pass: (o) => o.npc.state.pendingService?.kind === "lodging",
  },
];

/** Every proper name in the world (lore, NPCs, the player): anything else in a reply was made up. */
const KNOWN_NAMES = knownNameWords([brena, pell, hale].map((p) => parsePersona(p)), [createDemoWorld().player.name, "Anand"]);
const DONT_KNOW = /\b(don'?t know|do not know|never heard|no idea|can'?t say|couldn'?t say|not sure|haven'?t heard|no notion|beyond me|not my business)\b/i;

/** Problems that fail any scenario, whatever it checks. */
function problems(o: Outcome): string[] {
  const p: string[] = [];
  if (o.r.text.trim().length === 0) p.push("silent");
  if (/<\/?situation>|Your stock:|Place: Millbrook/.test(o.r.text)) p.push("echoed situation");
  if (o.r.text.length > 400) p.push("too long");
  if (/^\W*(happy|neutral|annoyed|angry|afraid|sad)\b\W/i.test(o.r.text)) p.push("said mood label");
  const known = new Set([...KNOWN_NAMES, ...o.line.split(/\W+/)]);
  const invented = unknownNames(o.r.text, known);
  if (invented.length > 0) p.push(`invented name (${invented.join(", ")})`);
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

  // ONLY=hale npm run bench: just the scenarios whose name contains it.
  for (const s of scenarios.filter((x) => !process.env.ONLY || x.name.toLowerCase().includes(process.env.ONLY.toLowerCase()))) {
    let passed = 0;
    let example = "";
    for (let i = 0; i < runs; i++) {
      const npc = new NpcAgent(s.persona ?? parsePersona(brena), llm);
      const world = createDemoWorld();
      s.setup?.(npc, world);
      const start = Date.now();
      const r = await npc.respond(s.line, world);
      totalMs += Date.now() - start;

      const o = { r, npc, world, line: s.line };
      const found = problems(o);
      for (const p of found) problemCounts[p] = (problemCounts[p] ?? 0) + 1;
      if (found.length === 0 && s.pass(o)) passed++;
      if (!example) example = r.text.replace(/\s+/g, " ").slice(0, 70);
    }
    totalPass += passed;
    console.log(`  ${s.name.padEnd(26)} ${passed}/${runs}   e.g. ${JSON.stringify(example)}`);
  }

  const total = scenarios.filter((x) => !process.env.ONLY || x.name.toLowerCase().includes(process.env.ONLY.toLowerCase())).length * runs;
  const problemSummary = Object.entries(problemCounts).map(([p, n]) => `${p} ×${n}`).join(", ") || "none";
  console.log(`  ── score ${totalPass}/${total}, avg ${(totalMs / total / 1000).toFixed(1)}s per turn, problems: ${problemSummary}`);
}
