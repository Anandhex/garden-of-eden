/**
 * T5: the NPC authoring check. Every template through its schema, and the generated people of seeds 1..N through
 * the authoring lint (npc/lint.ts): unknown items, quests never offered, secrets that can't break, personality
 * words the traits contradict, ties to NPCs that don't exist or don't name them back, and the content limits for
 * minors. The game has no hand-written people (N25a); the ones the tests use are fixtures, checked by the tests.
 *
 *   npm run check-npcs            # seeds 1..10
 *   SEEDS=30 npm run check-npcs
 */
import { lintCast } from "../src/npc/lint.js";
import { loadTemplates } from "../src/npc/templates.js";
import { generatedCast } from "./generated.js";

let failed = false;
try {
  const templates = loadTemplates();
  console.log(`Templates: ${Object.keys(templates).join(", ")}`);
} catch (err) {
  failed = true;
  console.error((err as Error).message);
}
const seeds = Number(process.env.SEEDS ?? 10);
let checked = 0;
for (let seed = 1; seed <= seeds; seed++) {
  const cast = generatedCast(12, seed);
  checked += Object.keys(cast).length;
  for (const [id, problems] of Object.entries(lintCast(cast))) {
    failed = true;
    console.error(`${id} (seed ${seed}):\n${problems.map((p) => `  ${p}`).join("\n")}`);
  }
}
console.log(failed ? "Problems found." : `${checked} generated people pass.`);
process.exit(failed ? 1 : 0);
