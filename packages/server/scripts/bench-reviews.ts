/**
 * N25b: how well does the model review a life? A generated town, a few things happen to its people (a robbery, a killing,
 * a famine), and each talker is reviewed by the real model, three to a call. Reports what the checks did with the
 * proposals: how many changes were accepted, clipped and rejected, and why (the rejection reasons say what to fix in the
 * prompt; they are not to be loosened). Code's rules are run on the same inputs for comparison.
 *
 *   npm run bench:reviews                 # seed 1, 3 rounds
 *   SEED=7 ROUNDS=5 npm run bench:reviews
 */
import { config } from "../src/config.js";
import { loadCreatureTemplates } from "../src/game/creatures.js";
import { WorldStore } from "../src/game/db.js";
import { recordEvent } from "../src/game/events.js";
import { newWorld } from "../src/game/save.js";
import { Town } from "../src/game/town.js";
import { OllamaProvider } from "../src/llm/ollama.js";
import { reviewInput } from "../src/npc/review/inputs.js";
import { modelReviews } from "../src/npc/review/model.js";
import { ruleProposal } from "../src/npc/review/rules.js";
import { checkProposal } from "../src/npc/review/validate.js";
import { seededRng } from "../src/game/dice.js";

const seed = Number(process.env.SEED ?? 1);
const rounds = Number(process.env.ROUNDS ?? 3);
config.director = false;
config.planning = false;
config.summaries = false;
const llm = new OllamaProvider();
console.log(`Loading ${config.model}...`);
await llm.warmUp();

const templates = loadCreatureTemplates();
const store = new WorldStore(":memory:");
const town = new Town({ personas: {}, creatureTemplates: templates, world: newWorld({}, templates, seededRng(seed), seed), llm, store });
const site = town.site();
const ids = town.talkersAt(site).filter((id) => !town.agents[id]!.isDead);
const rng = seededRng(seed + 1);
console.log(`${town.world.realm!.settlements[site]!.name}: ${ids.length} talkers\n`);

const tally = { model: { accepted: 0, clipped: 0, rejected: 0, missing: 0, calls: 0, ms: 0 }, code: { accepted: 0, clipped: 0, rejected: 0 } };
const reasons = new Map<string, number>();
const examples: string[] = [];
const kinds = new Map<string, number>();
for (let round = 0; round < rounds; round++) {
  town.world.day += 3;
  // Something happens to someone, and the people near them hear of it.
  const [victim, other] = [ids[Math.floor(rng() * ids.length)]!, ids[Math.floor(rng() * ids.length)]!];
  const what = [
    { kind: "looted" as const, actor: "player", target: victim, details: `the player robbed ${town.personas[victim]!.name}`, importance: 8 },
    { kind: "attacked" as const, actor: other, target: victim, details: `${town.personas[other]!.name} attacked ${town.personas[victim]!.name} in the street`, importance: 7 },
    { kind: "gift" as const, actor: "player", target: victim, details: `the player gave ${town.personas[victim]!.name} a gift`, importance: 5 },
  ][round % 3]!;
  recordEvent(town.world, { ...what, witnesses: ids.slice(0, 4), knownBy: ids.slice(0, 4) });
  const ctx = { world: town.world, store, personas: town.personas, states: Object.fromEntries(Object.entries(town.agents).map(([id, a]) => [id, a.state])) };
  for (let i = 0; i < ids.length; i += config.review.batch) {
    const inputs = await Promise.all(ids.slice(i, i + config.review.batch).map((id) => reviewInput(ctx, id)));
    const t0 = Date.now();
    const out = await modelReviews(llm, inputs);
    tally.model.ms += Date.now() - t0;
    tally.model.calls++;
    for (const input of inputs) {
      const p = out?.[input.who.id];
      const rules = checkProposal(ruleProposal(input), input);
      tally.code.accepted += rules.accepted.length;
      tally.code.clipped += rules.clipped.length;
      tally.code.rejected += rules.rejected.length;
      if (!p) {
        tally.model.missing++;
        continue;
      }
      const r = checkProposal(p, input);
      tally.model.accepted += r.accepted.length;
      tally.model.clipped += r.clipped.length;
      tally.model.rejected += r.rejected.length;
      for (const c of r.accepted) kinds.set(c.kind, (kinds.get(c.kind) ?? 0) + 1);
      for (const x of r.rejected) if (examples.length < 8) examples.push(`${x.reason}\n      ${JSON.stringify(x.change).slice(0, 260)}`);
      for (const x of r.rejected) reasons.set(x.reason.replace(/"[^"]*"/g, '"…"').replace(/\b(e|m|p|c|r|k|a):[\w.-]+/g, "$1:…"), (reasons.get(x.reason.replace(/"[^"]*"/g, '"…"').replace(/\b(e|m|p|c|r|k|a):[\w.-]+/g, "$1:…")) ?? 0) + 1);
    }
  }
}
const m = tally.model;
console.log(`model: ${m.calls} calls, ${(m.ms / Math.max(1, m.calls) / 1000).toFixed(1)} s each; ${m.accepted} changes accepted, ${m.clipped} clipped, ${m.rejected} rejected, ${m.missing} people missing from replies`);
console.log(`  accepted by kind: ${[...kinds].map(([k, n]) => `${k} ${n}`).join(", ") || "none"}`);
console.log(`  rejection rate: ${m.accepted + m.rejected > 0 ? Math.round((100 * m.rejected) / (m.accepted + m.rejected)) : 0}%`);
for (const [r, n] of [...reasons].sort((a, b) => b[1] - a[1]).slice(0, 8)) console.log(`    ${n}×  ${r}`);
if (examples.length > 0) console.log("  examples of what was rejected:\n    " + examples.join("\n    "));
console.log(`code's rules on the same inputs: ${tally.code.accepted} accepted, ${tally.code.clipped} clipped, ${tally.code.rejected} rejected`);
process.exit(0);
