/**
 * T15: the blind voice test, and consistency checks, against the real model.
 *
 *   npm run bench:style                  # every NPC file
 *   npm run bench:style -- --npc <id>     # report one NPC (all still speak: the test needs them all)
 *
 * The same lines go to every NPC (a fresh conversation each, at their workplace, by
 * day). Then a code classifier, with no model involved, tries to tell who said each
 * reply: word and character-trigram profiles, nearest profile, each reply left out of
 * its own speaker's profile. An NPC "has a voice" when most of its replies are told
 * apart from everyone else's. Consistency: nobody mentions being an AI, nobody writes
 * a <situation> block, and a minor never says anything romantic (design rule 7).
 * Results go to saves/bench/style-<date>.json.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { config } from "../src/config.js";
import { OllamaProvider } from "../src/llm/ollama.js";
import { NpcAgent } from "../src/npc/NpcAgent.js";
import { generatedCast } from "./generated.js";
import { createNpcState } from "../src/npc/state.js";
import { workplaceOf, PLACE_NAMES, PLACE_NEARBY } from "../src/game/schedule.js";
import { createTestWorld } from "../src/world/world.js";
import { registerNpcNames } from "../src/world/names.js";
import { knownNameWords, unknownNames } from "../src/npc/knowledge.js";

const LINES = [
  "Hello there.",
  "What do you do around here?",
  "Have you heard any news lately?",
  "What do you think of the bandits on the mine road?",
  "Is there anything you need help with?",
  "Who's the most interesting person in town?",
  "What's the best thing about this village?",
  "I'm new here. Any advice?",
  "What would you do with a pocketful of gold?",
  "Goodbye for now.",
];
const PASS_SHARE = 0.6;
const AI_TALK = /\b(as an ai|language model|chatbot|i'?m an ai|artificial intelligence|openai|assistant)\b/i;
const ROMANCE = /\b(romance|romantic|kiss\w*|sweetheart|lover|flirt\w*|darling|marry me|in love)\b/i;

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const only = arg("npc");

const personas = Object.values(generatedCast(Number(process.env.CAST ?? 8)));
registerNpcNames(Object.fromEntries(personas.map((p) => [p.id, p.name])));

// ---- The classifier (code only) ----

type Profile = Map<string, number>;
const NAME_WORDS = new Set(personas.flatMap((p) => p.name.toLowerCase().split(" ")));

/** Words and character trigrams, minus every NPC's own name (saying their own name isn't a voice). */
function features(text: string): Profile {
  const f: Profile = new Map();
  const add = (k: string) => f.set(k, (f.get(k) ?? 0) + 1);
  const words = text.toLowerCase().match(/[a-z']+|[!?.,;—-]/g) ?? [];
  for (const w of words) if (!NAME_WORDS.has(w)) add(`w:${w}`);
  const flat = ` ${words.filter((w) => !NAME_WORDS.has(w)).join(" ")} `;
  for (let i = 0; i + 3 <= flat.length; i++) add(`c:${flat.slice(i, i + 3)}`);
  // Shape: how long the sentences run, how often they ask or exclaim.
  const sentences = Math.max(1, (text.match(/[.!?]+/g) ?? []).length);
  f.set("s:len", (words.length / sentences) * 0.2);
  f.set("s:ask", (text.match(/\?/g) ?? []).length * 2);
  f.set("s:bang", (text.match(/!/g) ?? []).length * 2);
  return f;
}

function addInto(into: Profile, f: Profile): void {
  for (const [k, v] of f) into.set(k, (into.get(k) ?? 0) + v);
}

function cosine(a: Profile, b: Profile): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const [k, v] of a) {
    na += v * v;
    const w = b.get(k);
    if (w) dot += v * w;
  }
  for (const v of b.values()) nb += v * v;
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

// ---- Run ----

const llm = new OllamaProvider();
console.log(`Warming up ${config.model}...`);
await llm.warmUp();
config.director = false;
config.planning = false;
config.summaries = false;

interface Reply {
  npc: string;
  line: string;
  text: string;
  ms: number;
}
const replies: Reply[] = [];
for (const p of personas) {
  process.stdout.write(`${p.name}: `);
  for (const line of LINES) {
    const world = createTestWorld();
    world.hour = 10;
    const place = workplaceOf(p);
    world.player.place = place;
    world.location = PLACE_NAMES[place];
    world.nearby = PLACE_NEARBY[place];
    const state = createNpcState(p, {}, world.day);
    state.dormant = false;
    const agent = new NpcAgent(p, llm, undefined, state);
    const t0 = Date.now();
    const r = await agent.respond(line, world);
    replies.push({ npc: p.id, line, text: r.text.trim(), ms: Date.now() - t0 });
    process.stdout.write(".");
  }
  process.stdout.write("\n");
}

// Leave-one-out nearest profile.
const feats = replies.map((r) => features(r.text));
const results = personas.map((p) => {
  const mine = replies.map((r, i) => ({ r, i })).filter(({ r }) => r.npc === p.id);
  let right = 0;
  const confusedWith: Record<string, number> = {};
  for (const { i } of mine) {
    const profiles = new Map<string, Profile>();
    replies.forEach((r, j) => {
      if (j === i) return;
      const prof = profiles.get(r.npc) ?? new Map();
      addInto(prof, feats[j]!);
      profiles.set(r.npc, prof);
    });
    let best = { npc: "", score: -1 };
    for (const [npc, prof] of profiles) {
      const score = cosine(feats[i]!, prof);
      if (score > best.score) best = { npc, score };
    }
    if (best.npc === p.id) right++;
    else confusedWith[best.npc] = (confusedWith[best.npc] ?? 0) + 1;
  }
  const texts = mine.map(({ r }) => r.text);
  const aiTalk = texts.filter((t) => AI_TALK.test(t)).length;
  const situationLeak = texts.filter((t) => /<\/?situation>/i.test(t)).length;
  const romance = p.minor ? texts.filter((t) => ROMANCE.test(t)).length : 0;
  // Facts (T15): names that are in no lore and no NPC file. Reported, not failed: every NPC does it a little.
  const known = knownNameWords(personas, ["Traveler", "Honest", "Mrs", "Mr", "Mistress", "Master"]);
  const madeUp = [...new Set(texts.flatMap((t) => unknownNames(t, known)))];
  const share = right / mine.length;
  const pass = share >= PASS_SHARE && aiTalk === 0 && situationLeak === 0 && romance === 0;
  return { npc: p.id, name: p.name, minor: p.minor === true, recognised: `${right}/${mine.length}`, share, confusedWith, aiTalk, situationLeak, romance, pass, madeUp, avgMs: Math.round(mine.reduce((s, { r }) => s + r.ms, 0) / mine.length) };
});

console.log(`\nBlind voice test: ${LINES.length} lines per NPC, told apart by a code classifier (pass at ${PASS_SHARE * 100}%).`);
for (const r of results.filter((r) => !only || r.npc === only)) {
  const confused = Object.entries(r.confusedWith).map(([n, c]) => `${n} ${c}`).join(", ");
  console.log(
    `  ${r.pass ? "PASS" : "FAIL"} ${r.name.padEnd(16)} recognised ${r.recognised}${confused ? ` (taken for: ${confused})` : ""}; AI talk ${r.aiTalk}, situation leaks ${r.situationLeak}${r.minor ? `, romance ${r.romance}` : ""}; made-up names: ${r.madeUp.join(", ") || "none"}; ${r.avgMs} ms a reply`,
  );
}
if (only) {
  console.log(`\n${only}'s replies:`);
  for (const r of replies.filter((r) => r.npc === only)) console.log(`  > ${r.line}\n    ${r.text}`);
}
const date = new Date().toISOString().slice(0, 10);
mkdirSync("saves/bench", { recursive: true });
writeFileSync(`saves/bench/style-${date}.json`, `${JSON.stringify({ date, model: config.model, lines: LINES, results, replies }, null, 2)}\n`);
console.log(`\nSaved saves/bench/style-${date}.json`);
const failed = results.filter((r) => (!only || r.npc === only) && !r.pass);
process.exit(failed.length > 0 ? 1 : 0);
