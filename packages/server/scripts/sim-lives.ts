/**
 * A seeded run of the realm with its people living (N25): what happens to every person over DAYS days, for balance.
 * No model, no talking NPCs. Same seed, same story.
 *
 *   npm run sim:lives                       # ten years (10 × config.daysPerYear days)
 *   DAYS=960 SEED=7 npm run sim:lives
 *   PEOPLE_LIVE=slice npm run sim:lives     # only the start town and its neighbour
 *   npm run sim:lives -- --check            # also print each step's timing against its budget; exit 1 if one is over
 */
import { perfSlack } from "../src/budgets.js";
import { config } from "../src/config.js";
import { WorldStore } from "../src/game/db.js";
import { worldHash } from "../src/game/hash.js";
import { checkLifeBounds } from "../src/game/people/bounds.js";
import { liveSites } from "../src/game/people/live.js";
import { lifeStats } from "../src/game/people/report.js";
import { advanceWorld } from "../src/game/people/world.js";
import { generateRealm } from "../src/game/realm/generate.js";
import { checkBudgets } from "../src/metrics/budget.js";
import { snapshot } from "../src/metrics/timing.js";
import { materialisePeople } from "../src/store/materialise.js";

const seed = Number(process.env.SEED ?? 1);
const days = Number(process.env.DAYS ?? 10 * config.daysPerYear);
const every = Number(process.env.EVERY ?? config.daysPerYear * 2);
const realm = generateRealm(seed, 1);
const store = new WorldStore(":memory:");
const t0 = performance.now();
materialisePeople(realm, store.people, 1);
console.log(`Realm seed ${seed}: ${Object.keys(realm.settlements).length} settlements, ${store.people.count()} people rolled in ${Math.round(performance.now() - t0)} ms. Live: ${[...liveSites(realm)].length} places.`);
const show = (label: string) => {
  const s = lifeStats(store, realm.day, liveSites(realm));
  console.log(
    `${label.padEnd(9)} people ${String(s.people).padStart(6)}  kids ${(s.pyramid.children * 100).toFixed(0).padStart(2)}% adults ${(s.pyramid.adults * 100).toFixed(0).padStart(2)}% elders ${(s.pyramid.elders * 100).toFixed(0).padStart(2)}%  married ${s.courting ? ((s.married / s.courting) * 100).toFixed(0) : 0}% of ${s.courting}  births ${s.birthRate}/1000 deaths ${s.deathRate}/1000  causes ${JSON.stringify(s.causes)}  weddings ${s.marriages} (cross-class ${s.crossClass})`,
  );
};
show("day 1");
const start = performance.now();
for (let d = realm.day + 1; d <= days + 1; d += every) {
  advanceWorld(realm, store, Math.min(days + 1, d + every - 1));
  show(`day ${realm.day}`);
}
const ms = performance.now() - start;
console.log(`\n${days} days in ${(ms / 1000).toFixed(1)} s (${Math.round(ms / days)} ms a day, the whole realm). Hash ${worldHash({ realm }, store).slice(0, 12)}.`);
const biggest = Object.values(realm.settlements).sort((a, b) => b.population - a.population).slice(0, 3);
console.log("Biggest:", biggest.map((s) => `${s.name} ${s.population} (${s.houses} houses)`).join(", "));
const dead = Object.values(realm.settlements).filter((s) => s.abandoned).length;
console.log(`Abandoned: ${dead}. Counts:`, Object.entries(realm.stats).filter(([k]) => ["migrants", "starved", "houses", "promotions", "abandoned"].includes(k)).map(([k, v]) => `${k} ${v}`).join(", "));

for (const b of checkLifeBounds(realm, store)) console.log(`bound ${b.name.padEnd(26)} ${b.ok ? "ok  " : "FAIL"} ${b.detail}`);

if (process.argv.includes("--check")) {
  const timings = snapshot();
  console.log("\nTimings (ms):");
  for (const [name, t] of Object.entries(timings).sort()) console.log(`  ${name.padEnd(20)} median ${String(t.p50).padStart(7)}  95th ${String(t.p95).padStart(7)}  calls ${t.count}`);
  const rows = checkBudgets(timings, perfSlack());
  let over = 0;
  for (const r of rows) {
    console.log(`  budget ${r.label.padEnd(40)} ${r.status === "idle" ? "not measured here" : `${r.p95Ms} ms of ${r.budgetMs} (${r.status})`}`);
    if (r.status === "over") over++;
  }
  if (over > 0) process.exit(1);
}
