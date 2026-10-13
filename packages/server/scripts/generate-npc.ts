/**
 * N11.1: a person from a template, printed (nothing is written: people are generated in play, N25a). Code rolls
 * the numbers (seeded); the model writes the name, personality, voice, backstory, looks and goals (or the template
 * does, if the model fails twice or isn't running). The result goes through the full schema and the authoring lint.
 *
 *   npm run gen -- farmer                  # a random seed, words from the model
 *   npm run gen -- child --seed 7          # the same numbers every time
 *   npm run gen -- guard --no-model        # template words only (no Ollama)
 */
import { seededRng } from "../src/game/dice.js";
import { OllamaProvider } from "../src/llm/ollama.js";
import { lintCast } from "../src/npc/lint.js";
import { parsePersona } from "../src/npc/personaSchema.js";
import { generateNpc, loadTemplates } from "../src/npc/templates.js";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const value = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const templates = loadTemplates();
const which = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--seed");
if (!which || !templates[which]) {
  console.error(`Usage: npm run gen -- <template> [--seed N] [--no-model]. Templates: ${Object.keys(templates).join(", ")}`);
  process.exit(1);
}
const seed = Number(value("seed") ?? Math.floor(Math.random() * 1_000_000));

const llm = flag("no-model") ? undefined : new OllamaProvider();
const t0 = Date.now();
const { persona, words } = await generateNpc(templates[which]!, seededRng(seed), { ...(llm ? { llm } : {}), takenIds: [], takenNames: [] });
const checked = parsePersona(JSON.parse(JSON.stringify(persona)), `${persona.id}.json`);
const problems = lintCast({ [checked.id]: checked })[checked.id] ?? [];
console.log(`${checked.name} (${checked.id}), ${checked.role}. Seed ${seed}; words by the ${words} in ${((Date.now() - t0) / 1000).toFixed(1)} s.`);
console.log(JSON.stringify(persona, null, 2));
if (problems.length > 0) {
  console.error(`Fails the authoring check:\n${problems.map((p) => `  ${p}`).join("\n")}`);
  process.exit(1);
}
