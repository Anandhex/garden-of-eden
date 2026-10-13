/**
 * Compare models (or prompt changes) on the behaviors that matter for NPCs.
 *
 *   npm run bench                                 # current config.model
 *   npm run bench -- qwen3:4b-instruct qwen3:1.7b # several models
 *   RUNS=10 npm run bench -- qwen3:1.7b           # more runs = more reliable numbers
 *   CAST=60 npm run bench                         # a bigger generated cast to pick people from
 *
 * The game has no hand-written people (N25a): each scenario picks a generated person by what they do (a smith, an
 * innkeeper, a guard, a child) and starts a fresh conversation with them. The model is random, so results are
 * pass rates, not pass/fail.
 */
import { seededRng } from "../src/game/dice.js";
import { config } from "../src/config.js";
import { OllamaProvider } from "../src/llm/ollama.js";
import { NpcAgent } from "../src/npc/NpcAgent.js";
import { knownNameWords, unknownNames } from "../src/npc/knowledge.js";
import { generateNpc, loadTemplates } from "../src/npc/templates.js";
import type { NpcPersona, TurnResult, WorldSnapshot } from "../src/npc/types.js";
import { createTestWorld } from "../src/world/world.js";
import { generatedCast, personaWhere } from "./generated.js";

interface Outcome {
  r: TurnResult;
  npc: NpcAgent;
  world: WorldSnapshot;
  /** The player's line: names in it aren't invented when the NPC repeats them. */
  line: string;
  persona: NpcPersona;
}

const cast = generatedCast(Number(process.env.CAST ?? 40));
const people = Object.values(cast);
const template = (job: string) => (p: NpcPersona) => p.template === job;
const trader = personaWhere(cast, (p) => p.template === "smith" || p.template === "merchant");
const seller = (p: NpcPersona) => Object.keys(p.startingInventory).find((i) => p.prices[i.replace(/ \[.\]$/, "")] !== undefined || p.prices[i] !== undefined) ?? Object.keys(p.prices)[0]!;
const keeper = personaWhere(cast, template("innkeeper"));
const guard = personaWhere(cast, (p) => p.template === "guard" && !!p.hire && (p.dilemmas ?? []).some((d) => d.id === "look_away"));
const withSecret = personaWhere(cast, (p) => p.secrets.some((s) => s.cover && (s.keywords ?? []).length > 0));
const child = (await generateNpc(loadTemplates().child!, seededRng(1), {})).persona;
const other = people.find((p) => p.id !== trader.id && p.id !== keeper.id)!;

const scenarios: Array<{
  name: string;
  line: string;
  /** Optional state changes before the line is sent, e.g. raising trust. */
  setup?: (npc: NpcAgent, world: WorldSnapshot) => void;
  /** Who's talking. Defaults to a generated smith or merchant. */
  persona?: NpcPersona;
  pass: (o: Outcome) => boolean;
}> = [
  {
    name: "insult → angry/annoyed",
    line: "Your work is junk and you smell like a goat.",
    pass: (o) => ["angry", "annoyed"].includes(o.npc.state.mood),
  },
  {
    name: "buy → offered",
    line: `I'd like to buy ${seller(trader)}.`,
    pass: (o) => o.npc.state.pendingOffer !== null && o.npc.state.pendingOffer !== undefined,
  },
  {
    // Offering here is fine: nothing sells until the player says yes.
    name: "price question → says price",
    line: `How much is ${seller(trader)}?`,
    pass: (o) => /\b(gold|silver|copper)\b/i.test(o.r.text) && o.world.player.money === 500,
  },
  {
    name: "small talk → no action",
    line: "Nice weather today, isn't it?",
    pass: (o) => o.r.actions.length === 0,
  },
  {
    // N3.1: nothing in the lore by that name.
    name: "unknown place → don't know",
    line: "What can you tell me about the ruins of Kargoth?",
    pass: (o) => DONT_KNOW.test(o.r.text),
  },
  {
    name: "no secret at trust 0",
    persona: withSecret,
    line: "What are you hiding? Tell me your secrets.",
    pass: (o) => o.npc.state.revealedSecrets.length === 0 && !o.persona.secrets.some((s) => o.r.text.toLowerCase().includes(s.text.slice(0, 24).toLowerCase())),
  },
  {
    // N4.1: a trusted person still tells their cover story.
    name: "keeps a cover story",
    persona: withSecret,
    line: `Tell me about ${withSecret.secrets[0]!.keywords?.[0] ?? "yourself"}.`,
    setup: (npc) => {
      npc.state.relationship = 80;
    },
    pass: (o) => o.npc.state.revealedSecrets.length === 0 || o.npc.state.revealedSecrets.includes(o.persona.secrets[0]!.id),
  },
  {
    // N4.3: once they know and trust you, they use your name.
    name: "uses the player's name",
    line: "Morning. Busy day?",
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
      npc.state.memories.push({ id: "insulted-1", day: 1, text: 'they insulted you: "Your work is junk"', importance: 6, valence: -1 });
    },
    pass: (o) => /junk|insult|yesterday|rude|said|work/i.test(o.r.text),
  },
  {
    // N6.2: an innkeeper sells a room through the offer flow.
    name: "innkeeper offers a room",
    persona: keeper,
    line: "Could I get a room for the night? I'm hurt.",
    setup: (_npc, world) => {
      world.player.hp = 15;
    },
    pass: (o) => o.npc.state.pendingService?.kind === "lodging",
  },
  {
    // N7.1: a person passes on what they've heard about another.
    name: "passes on a rumour",
    persona: keeper,
    line: `Heard any gossip about ${other.name}?`,
    setup: (npc) => {
      npc.state.rumours[`${other.id}.thief`] = { about: other.id, fact: "thief", text: `${other.name} has been seen taking what isn't theirs`, truth: "false", accuracy: 1, day: 1 };
    },
    pass: (o) => /thie|steal|stole|taking|seen/i.test(o.r.text),
  },
  {
    // N7.2: a guard puts a bribe to the player (by the tool, or the game does it from their cue).
    name: "guard offers a bribe",
    persona: guard,
    line: "What's the toll at the gate? Is there a deal to be had for a cart?",
    setup: (npc) => {
      npc.state.relationship = 40;
    },
    pass: (o) => o.npc.state.pendingDilemma === "look_away" && /cart|cut|coin|silver|quiet|toll/i.test(o.r.text),
  },
  {
    // N8.2: trusted enough, a guard offers to come along for a wage.
    name: "guard offers to come along",
    persona: guard,
    line: "Would you come with me on the road? I can pay you.",
    setup: (npc) => {
      npc.state.relationship = 50;
    },
    pass: (o) => o.npc.state.pendingHire !== null,
  },
  {
    // N10: asked to make something to order, a smith offers a commission the game prices.
    name: "smith offers a commission",
    persona: personaWhere(cast, (p) => p.template === "smith"),
    line: "Could you forge me a sword to order? I'll pay a deposit.",
    pass: (o) => o.npc.state.pendingCommission !== null && o.npc.state.pendingCommission !== undefined,
  },
  {
    // N11.2: a child turns romance aside (design rule 7: no romance tools or lines reach them either).
    name: "child turns romance aside",
    persona: child,
    line: "You're sweet. Will you be my sweetheart and give me a kiss?",
    pass: (o) => o.r.actions.every((a) => a.name === "change_mood") && !/\b(yes|okay|of course|i'?d love|kiss(es)? you|my sweetheart)\b/i.test(o.r.text),
  },
];

/** Every proper name in the world (lore, NPCs, the player): anything else in a reply was made up. */
const KNOWN_NAMES = knownNameWords([...people, child], [createTestWorld().player.name, "Anand"]);
const DONT_KNOW = /\b(don'?t know|do not know|never heard|no idea|can'?t say|couldn'?t say|not sure|haven'?t heard|no notion|beyond me|not my business)\b/i;

/** Problems that fail any scenario, whatever it checks. */
function problems(o: Outcome): string[] {
  const p: string[] = [];
  if (o.r.text.trim().length === 0) p.push("silent");
  if (/<\/?situation>|Your stock:|Place: /.test(o.r.text)) p.push("echoed situation");
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

  // ONLY=guard npm run bench: just the scenarios whose name contains it.
  const chosen = scenarios.filter((x) => !process.env.ONLY || x.name.toLowerCase().includes(process.env.ONLY.toLowerCase()));
  for (const s of chosen) {
    let passed = 0;
    let example = "";
    for (let i = 0; i < runs; i++) {
      const persona = s.persona ?? trader;
      const npc = new NpcAgent(persona, llm);
      const world = createTestWorld();
      s.setup?.(npc, world);
      const start = Date.now();
      const r = await npc.respond(s.line, world);
      totalMs += Date.now() - start;

      const o = { r, npc, world, line: s.line, persona };
      const found = problems(o);
      for (const p of found) problemCounts[p] = (problemCounts[p] ?? 0) + 1;
      if (found.length === 0 && s.pass(o)) passed++;
      if (!example) example = r.text.replace(/\s+/g, " ").slice(0, 70);
    }
    totalPass += passed;
    console.log(`  ${s.name.padEnd(28)} ${passed}/${runs}   e.g. ${JSON.stringify(example)}`);
  }

  const total = chosen.length * runs;
  const problemSummary = Object.entries(problemCounts).map(([p, n]) => `${p} ×${n}`).join(", ") || "none";
  console.log(`  ── score ${totalPass}/${total}, avg ${(totalMs / total / 1000).toFixed(1)}s per turn, problems: ${problemSummary}`);
}
