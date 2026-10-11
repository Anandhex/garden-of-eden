/**
 * N11.1: a new NPC from a template. Code rolls the numbers (seeded); the model writes
 * the name, personality, voice, backstory, looks and goals (or the template does, if
 * the model fails twice or isn't running). The file is checked by the full schema and
 * the authoring lint (T5) before it's written, and becomes an ordinary NPC file.
 *
 *   npm run gen -- farmer                  # a random seed, words from the model
 *   npm run gen -- child --seed 7          # the same numbers every time
 *   npm run gen -- guard --no-model        # template words only (no Ollama)
 *   npm run gen -- merchant --dry          # print, don't write
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { seededRng } from "../src/game/dice.js";
import { OllamaProvider } from "../src/llm/ollama.js";
import { lintCast } from "../src/npc/lint.js";
import { parsePersona } from "../src/npc/personaSchema.js";
import { generateNpc, loadTemplates } from "../src/npc/templates.js";
import type { NpcPersona } from "../src/npc/types.js";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const value = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const templates = loadTemplates();
const which = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--seed");
if (!which || !templates[which]) {
  console.error(`Usage: npm run gen -- <template> [--seed N] [--no-model] [--dry]. Templates: ${Object.keys(templates).join(", ")}`);
  process.exit(1);
}
const seed = Number(value("seed") ?? Math.floor(Math.random() * 1_000_000));

const NPC_DIR = new URL("../src/data/npcs/", import.meta.url);
const cast: Record<string, NpcPersona> = Object.fromEntries(
  readdirSync(NPC_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => [f.replace(/\.json$/, ""), parsePersona(JSON.parse(readFileSync(new URL(f, NPC_DIR), "utf8")), f)]),
);

const llm = flag("no-model") ? undefined : new OllamaProvider();
const t0 = Date.now();
const { persona, words } = await generateNpc(templates[which]!, seededRng(seed), {
  ...(llm ? { llm } : {}),
  takenIds: Object.keys(cast),
  takenNames: Object.values(cast).map((p) => p.name),
});
// The full checks: schema, then the lint with the new NPC in the cast.
const checked = parsePersona(JSON.parse(JSON.stringify(persona)), `${persona.id}.json`);
const problems = lintCast({ ...cast, [checked.id]: checked })[checked.id] ?? [];
if (problems.length > 0) {
  console.error(`${checked.id}.json fails the authoring check:\n${problems.map((p) => `  ${p}`).join("\n")}`);
  process.exit(1);
}
const file = new URL(`${checked.id}.json`, NPC_DIR);
console.log(`${checked.name} (${checked.id}), ${checked.role}. Seed ${seed}; words by the ${words} in ${((Date.now() - t0) / 1000).toFixed(1)} s.`);
if (flag("dry")) {
  console.log(JSON.stringify(persona, null, 2));
} else if (existsSync(file)) {
  console.error(`${checked.id}.json already exists; not overwriting.`);
  process.exit(1);
} else {
  writeFileSync(file, `${JSON.stringify(persona, null, 2)}\n`);
  console.log(`Wrote src/data/npcs/${checked.id}.json. Talk to them with: npm run chat -- ${checked.id}`);
}
