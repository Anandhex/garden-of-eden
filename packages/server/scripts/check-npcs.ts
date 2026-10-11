/**
 * T5: the NPC authoring check. Every NPC file and template, through the schema and the
 * lint (npc/lint.ts): unknown items, quests never offered, secrets that can't break,
 * personality words the traits contradict, ties to NPCs that don't exist or don't
 * name them back, and the content limits for minors.
 *
 *   npm run check-npcs
 */
import { readdirSync, readFileSync } from "node:fs";
import { parsePersona } from "../src/npc/personaSchema.js";
import { lintCast } from "../src/npc/lint.js";
import { loadTemplates } from "../src/npc/templates.js";
import type { NpcPersona } from "../src/npc/types.js";

const NPC_DIR = new URL("../src/data/npcs/", import.meta.url);
let failed = false;
const cast: Record<string, NpcPersona> = {};
for (const f of readdirSync(NPC_DIR).filter((f) => f.endsWith(".json"))) {
  try {
    const p = parsePersona(JSON.parse(readFileSync(new URL(f, NPC_DIR), "utf8")), f);
    if (`${p.id}.json` !== f) throw new Error(`${f}: id "${p.id}" doesn't match the file name`);
    cast[p.id] = p;
  } catch (err) {
    failed = true;
    console.error((err as Error).message);
  }
}
for (const [id, problems] of Object.entries(lintCast(cast))) {
  failed = true;
  console.error(`${id}.json:\n${problems.map((p) => `  ${p}`).join("\n")}`);
}
try {
  const templates = loadTemplates();
  console.log(`Templates: ${Object.keys(templates).join(", ")}`);
} catch (err) {
  failed = true;
  console.error((err as Error).message);
}
console.log(failed ? "Problems found." : `All ${Object.keys(cast).length} NPC files pass.`);
process.exit(failed ? 1 : 0);
