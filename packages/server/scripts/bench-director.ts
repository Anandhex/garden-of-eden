/**
 * The world director's benchmark (N12.3): seeded event days against the real model.
 * Each day something happens (a fight, a theft, a gift, a raid driven off), the
 * village lives the day, and the nightly chronicle runs. Counts what the validator
 * accepted and rejected, invented names that got through (should be none: the
 * validator checks), and near-contradictions with the world's own lore.
 *
 *   npm run bench:director              # 20 days, seed 1
 *   DAYS=30 SEED=7 npm run bench:director
 */
import { config } from "../src/config.js";
import { runChronicle } from "../src/director/chronicle.js";
import { similarity } from "../src/director/validator.js";
import { loadCreatureTemplates } from "../src/game/creatures.js";
import type { Rng } from "../src/game/dice.js";
import { recordEvent } from "../src/game/events.js";
import { newWorld } from "../src/game/save.js";
import { Town } from "../src/game/town.js";
import { OllamaProvider } from "../src/llm/ollama.js";
import { knownNameWords, unknownNames, worldLore } from "../src/npc/knowledge.js";
import { generatedCast } from "./generated.js";

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

const days = Number(process.env.DAYS ?? 20);
const rng = seeded(Number(process.env.SEED ?? 1));
const personas = generatedCast(Number(process.env.CAST ?? 8));
const templates = loadCreatureTemplates();
const llm = new OllamaProvider();
config.director = false; // the bench runs the chronicle itself, and waits for it
config.planning = false;
config.summaries = false;
const world = newWorld(personas, templates, rng);
const town = new Town({ personas, creatureTemplates: templates, world, llm, rng });
const fileLore = worldLore().entries.map((e) => e.text);

console.log(`Loading ${config.model}...`);
await llm.warmUp();

/** The day's happening, seeded: who did what to whom, and who saw. */
const KINDS = ["attacked", "theft-caught", "gift", "quest-done", "raid-repelled", "insulted"] as const;
const ids = Object.keys(personas).filter((id) => !personas[id]!.successorOf);
let accepted = 0;
let rejected = 0;
let invented = 0;
let contradictions = 0;
const reasons = new Map<string, number>();
for (let d = 0; d < days; d++) {
  const kind = KINDS[Math.floor(rng() * KINDS.length)]!;
  const target = ids[Math.floor(rng() * ids.length)]!;
  const witness = ids.filter((x) => x !== target)[Math.floor(rng() * (ids.length - 1))]!;
  recordEvent(world, { kind, actor: "player", target, details: kind, importance: 7, witnesses: [target, witness] });
  const day = world.day;
  town.passHours(24);
  const r = await runChronicle({ llm, world, personas, states: Object.fromEntries(ids.map((id) => [id, town.agents[id]!.state])), creatures: templates }, day);
  accepted += r.accepted.length;
  rejected += r.rejected.length;
  for (const e of r.rejected) {
    const why = e.reason.replace(/".*"|: .*/g, "").trim();
    reasons.set(why, (reasons.get(why) ?? 0) + 1);
  }
  for (const line of r.log) console.log(`  day ${day}: ${line}`);
}
const known = knownNameWords(Object.values(personas), [world.player.name, ...Object.values(templates).map((t) => t.name)]);
for (const l of world.lore ?? []) {
  if (unknownNames(`${l.name}. ${l.text}`, known).length > 0) invented++;
  if (fileLore.some((t) => similarity(t, l.text) >= 0.4)) contradictions++;
}
const drift = Object.values(town.agents).map((a) => `${a.persona.name.split(" ").at(-1)} ${Object.entries(a.state.growth.traits).filter(([, v]) => v).map(([k, v]) => `${k} ${v! > 0 ? "+" : ""}${v}`).join(", ") || "-"}`);
console.log(`\n${days} days on ${config.model}: ${accepted} proposals accepted, ${rejected} rejected.`);
console.log(`Rejections: ${[...reasons.entries()].map(([k, v]) => `${k} ×${v}`).join("; ") || "none"}.`);
console.log(`Grown lore: ${(world.lore ?? []).length} entries; invented names that got through: ${invented}; close to (possibly contradicting) the world file: ${contradictions}.`);
console.log(`Director quests on boards: ${Object.values(town.agents).flatMap((a) => a.state.questBoard.filter((q) => q.director)).length}. Trait drift: ${drift.join("; ")}.`);
