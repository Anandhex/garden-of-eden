/**
 * Deterministic trait simulation: how each NPC's traits turn into behaviour, with
 * seeded dice and a scripted model (no Ollama needed). Same seed, same numbers.
 *
 *   npm run sim                 # every NPC
 *   npm run sim -- hale pell    # some NPCs
 *   RUNS=5000 SEED=7 npm run sim
 */
import { readdirSync, readFileSync } from "node:fs";
import type { Rng } from "../src/game/dice.js";
import { passTime } from "../src/game/simulation.js";
import type { ChatRequest, ChatResult, LLMProvider } from "../src/llm/provider.js";
import { applyAction, giftableItems, parseAction } from "../src/npc/actions.js";
import { NpcAgent } from "../src/npc/NpcAgent.js";
import { parsePersona } from "../src/npc/personaSchema.js";
import { createNpcState } from "../src/npc/state.js";
import { fleeAt, giftTrust, grudgeFadePerDay, maxGiftValue, provokeLimit, traitsOf } from "../src/npc/traits.js";
import type { NpcPersona } from "../src/npc/types.js";
import { createDemoWorld } from "../src/world/world.js";

/** mulberry32: a small seeded Rng. */
function seeded(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Plays the model's part: gets angry at every insult, and attacks the moment the game
 * offers attack_player. So "insults before attacking" is exactly what the rules allow.
 */
class HotheadModel implements LLMProvider {
  async chat(req: ChatRequest, onText?: (delta: string) => void): Promise<ChatResult> {
    const last = req.messages.at(-1)!;
    const offered = new Set((req.tools ?? []).map((t) => t.name));
    if (offered.has("attack_player") && last.role !== "assistant") return { text: "", toolCalls: [{ name: "attack_player", arguments: {} }] };
    if (last.role === "user" && offered.has("change_mood")) return { text: "", toolCalls: [{ name: "change_mood", arguments: { mood: "angry" } }] };
    onText?.("...");
    return { text: "...", toolCalls: [] };
  }
}

/** Says a line and nothing else, so fights run on the rules alone. */
class QuietModel implements LLMProvider {
  async chat(_req: ChatRequest, onText?: (delta: string) => void): Promise<ChatResult> {
    onText?.("...");
    return { text: "...", toolCalls: [] };
  }
}

const NPC_DIR = new URL("../src/data/npcs/", import.meta.url);
const all = readdirSync(NPC_DIR).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, ""));
const wanted = process.argv.slice(2).length > 0 ? process.argv.slice(2) : all;
const runs = Number(process.env.RUNS ?? 1000);
const seed = Number(process.env.SEED ?? 1);

const pct = (n: number) => `${((100 * n) / runs).toFixed(0)}%`.padStart(4);

for (const id of wanted) {
  if (!all.includes(id)) throw new Error(`No NPC "${id}". Available: ${all.join(", ")}`);
  const persona: NpcPersona = parsePersona(JSON.parse(readFileSync(new URL(`${id}.json`, NPC_DIR), "utf8")), `${id}.json`);
  const t = traitsOf(persona);
  const rng = seeded(seed);

  // Temper: insults until the NPC attacks, and the trust they cost.
  const insulted = new NpcAgent(persona, new HotheadModel(), rng);
  const world = createDemoWorld();
  let insults = 0;
  while (!insulted.state.inCombat && insults < 10) {
    insults++;
    await insulted.respond("You're a worthless fool.", world);
  }
  const trustPerInsult = createNpcState(persona);
  const mood = parseAction("change_mood", { mood: "angry" });
  if (mood.ok) applyAction(mood, { persona, state: trustPerInsult, world: createDemoWorld(), rng });

  // Bravery: fights against a player with an iron sword, from full HP, until the fight ends.
  const ends = { fled: 0, begged: 0, died: 0, knockedOut: 0, other: 0 };
  let corneredFights = 0;
  for (let i = 0; i < runs; i++) {
    const npc = new NpcAgent(persona, new QuietModel(), rng);
    const w = createDemoWorld();
    w.player.inventory["iron sword [D]"] = 1;
    let begged = false;
    for (let round = 0; round < 50 && !npc.state.outcome && !begged; round++) {
      const r = await npc.attackedByPlayer(w);
      if (r.hit.message.includes("Cornered")) corneredFights++;
      begged = r.hit.message.includes("beg for mercy");
    }
    if (npc.state.outcome === "fled") ends.fled++;
    else if (npc.state.outcome === "dead") ends.died++;
    else if (npc.state.outcome === "knocked out") ends.knockedOut++;
    else if (begged) ends.begged++;
    else ends.other++;
  }

  // Honesty: how often a reveal at high trust is a lie.
  let lies = 0;
  if (persona.secrets[0]) {
    for (let i = 0; i < runs; i++) {
      const state = createNpcState(persona, { relationship: 80 });
      const reveal = parseAction("reveal_secret", { secret: persona.secrets[0].id });
      if (reveal.ok && applyAction(reveal, { persona, state, world: createDemoWorld(), rng }).lie) lies++;
    }
  }

  // Generosity: what they'd give at full trust.
  const gifts = giftableItems({ persona, state: createNpcState(persona, { relationship: 100 }), world: createDemoWorld() });

  // Forgiveness: trust after a bad fight (-60) and three nights.
  const grudge = createNpcState(persona, { relationship: -60 });
  passTime(persona, grudge, createDemoWorld(), 72, () => 0.99);

  console.log(`\n${persona.name} (${id})  traits ${JSON.stringify(t)}`);
  console.log(`  temper       attacks after ${insults} insults (limit ${provokeLimit(t)}); one insult costs ${-trustPerInsult.relationship} trust`);
  console.log(
    `  bravery      may flee at <=${Math.round(fleeAt(t) * 100)}% HP. ${runs} fights: fled ${pct(ends.fled)}, begged ${pct(ends.begged)}, died ${pct(ends.died)}, ` +
      `beat the player ${pct(ends.knockedOut)}${ends.other ? `, unfinished ${pct(ends.other)}` : ""}; fought on cornered in ${corneredFights} rounds`,
  );
  console.log(`  honesty      lies about a secret at trust 80: ${pct(lies)}`);
  console.log(`  generosity   gifts from trust ${giftTrust(t)}, worth up to ${maxGiftValue(t)} gold: ${gifts.join(", ") || "nothing in stock"}`);
  console.log(`  forgiveness  trust -60 → ${grudge.relationship} after three nights (+${grudgeFadePerDay(t)}/day)`);
}
