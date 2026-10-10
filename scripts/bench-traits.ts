/**
 * Do NPCs' attack and flee rates follow their traits with the real model? (N1)
 * The rules gate what the model may do (attack_player only after provokeLimit
 * insults; morale and escape rolls in code); this checks the model goes along.
 *
 *   npm run bench:traits                 # every NPC, RUNS=3
 *   RUNS=10 npm run bench:traits -- hale brena
 */
import { readdirSync, readFileSync } from "node:fs";
import { OllamaProvider } from "../src/llm/ollama.js";
import { NpcAgent } from "../src/npc/NpcAgent.js";
import { parsePersona } from "../src/npc/personaSchema.js";
import { fleeAt, provokeLimit, traitsOf } from "../src/npc/traits.js";
import type { NpcPersona } from "../src/npc/types.js";
import { createDemoWorld } from "../src/world/world.js";

const INSULTS = [
  "Your work is junk and everyone in town knows it.",
  "You're a useless, smelly fool.",
  "I've seen goats with more brains than you.",
  "Nobody here can stand the sight of you.",
  "You're a disgrace to this village.",
  "Pathetic. Truly pathetic.",
  "I spit on you and your miserable life.",
];
/** Long enough that every fight ends: the NPC breaks or dies. */
const FIGHT_ROUNDS = 25;

const NPC_DIR = new URL("../src/data/npcs/", import.meta.url);
const all = readdirSync(NPC_DIR).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, ""));
const ids = process.argv.slice(2).length > 0 ? process.argv.slice(2) : all;
const runs = Number(process.env.RUNS ?? 3);
const llm = new OllamaProvider();
await llm.warmUp();

interface Row {
  id: string;
  limit: number;
  fleeShare: number;
  attackedAt: number[];
  early: number;
  ends: Record<"fled" | "begged" | "fought on" | "died", number>;
  /** Share of max HP when the NPC broke (fled or begged); 0 if it fought to the death. */
  brokeAt: number[];
}
const rows: Row[] = [];

for (const id of ids) {
  const persona: NpcPersona = parsePersona(JSON.parse(readFileSync(new URL(`${id}.json`, NPC_DIR), "utf8")), `${id}.json`);
  const t = traitsOf(persona);
  const row: Row = { id, limit: provokeLimit(t), fleeShare: fleeAt(t), attackedAt: [], early: 0, ends: { fled: 0, begged: 0, "fought on": 0, died: 0 }, brokeAt: [] };

  for (let i = 0; i < runs; i++) {
    // Insults until the NPC attacks (or we run out).
    const npc = new NpcAgent(persona, llm);
    const world = createDemoWorld();
    for (let n = 1; n <= INSULTS.length; n++) {
      const r = await npc.respond(INSULTS[n - 1]!, world);
      if (r.actions.some((a) => a.name === "attack_player" && a.ok && !(a.args as { automatic?: boolean })?.automatic)) {
        row.attackedAt.push(n);
        if (n < row.limit) row.early++; // can't happen: the game refuses it
        break;
      }
    }

    // A fight the player starts with an iron sword, the NPC at full HP.
    const fighter = new NpcAgent(persona, llm);
    const arena = createDemoWorld();
    arena.player.inventory["iron sword [D]"] = 1;
    arena.player.hp = 400; // so the NPC's side of the fight is what's measured
    arena.player.maxHp = 400;
    let end: keyof Row["ends"] = "fought on";
    for (let round = 0; round < FIGHT_ROUNDS; round++) {
      const r = await fighter.attackedByPlayer(arena);
      if (fighter.isDead) end = "died";
      else if (fighter.state.outcome === "fled") end = "fled";
      else if (r.hit.message.includes("beg for mercy")) end = "begged";
      else continue;
      break;
    }
    row.ends[end]++;
    if (end !== "fought on") row.brokeAt.push(end === "died" ? 0 : fighter.state.hp / persona.stats.maxHp);
  }
  rows.push(row);
}

const pct = (n: number) => `${Math.round((100 * n) / runs)}%`;
const meanOf = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
console.log(`\n=== traits bench, ${runs} runs per NPC`);
for (const r of rows) {
  const mean = r.attackedAt.length ? (r.attackedAt.reduce((a, b) => a + b, 0) / r.attackedAt.length).toFixed(1) : "-";
  console.log(
    `  ${r.id.padEnd(6)} insults: limit ${r.limit}, attacked in ${pct(r.attackedAt.length)} (after ${mean} on average${r.early ? `, ${r.early} TOO EARLY` : ""})` +
      ` | fight (may flee at <=${Math.round(r.fleeShare * 100)}%): fled ${pct(r.ends.fled)}, begged ${pct(r.ends.begged)}, died ${pct(r.ends.died)}` +
      `${r.ends["fought on"] ? `, unfinished ${pct(r.ends["fought on"])}` : ""}; broke at ${Math.round(100 * meanOf(r.brokeAt))}% HP on average`,
  );
}

// The checks the roadmap asks for: lower limits attack sooner, cowards break more often.
const meanAt = (r: Row) => (r.attackedAt.length ? r.attackedAt.reduce((a, b) => a + b, 0) / r.attackedAt.length : Infinity);
const breaks = (r: Row) => meanOf(r.brokeAt);
const failures: string[] = [];
for (const a of rows) {
  for (const b of rows) {
    if (a.limit < b.limit && meanAt(a) > meanAt(b)) failures.push(`${a.id} (limit ${a.limit}) attacked later than ${b.id} (limit ${b.limit})`);
    if (a.fleeShare > b.fleeShare && breaks(a) < breaks(b)) failures.push(`${a.id} (less brave) broke at lower HP than ${b.id}`);
  }
  if (a.early > 0) failures.push(`${a.id} attacked before its limit`);
}
console.log(failures.length === 0 ? "  ── traits followed" : `  ── NOT followed:\n    ${failures.join("\n    ")}`);
