/**
 * A seeded run of the realm (N13), with no model and no talking NPCs: what happens
 * over DAYS days, for balance. Same seed, same realm, same story.
 *
 *   npm run sim:realm
 *   DAYS=200 SEED=7 npm run sim:realm
 *   VERBOSE=1 npm run sim:realm      # every piece of news, as it happens
 */
import { seededRng } from "../src/game/dice.js";
import { advanceRealm, realmDay } from "../src/game/realm/day.js";
import { titled } from "../src/game/realm/figures.js";
import { generateRealm } from "../src/game/realm/generate.js";
import { describeRealm } from "../src/game/realm/view.js";

const seed = Number(process.env.SEED ?? 1);
const days = Number(process.env.DAYS ?? 120);
const verbose = process.env.VERBOSE === "1";
const realm = generateRealm(seed, 1);
const rng = seededRng(seed * 7919 + 1);
const people = () => Object.values(realm.figures).filter((f) => f.alive).length;
console.log(`Realm seed ${seed}: ${Object.keys(realm.kingdoms).length} kingdoms, ${Object.keys(realm.settlements).length} settlements, ${people()} figures, ${Object.keys(realm.factions).length} factions.`);
if (verbose) {
  let seen = realm.news.length;
  for (let d = 2; d <= days + 1; d++) {
    realmDay(realm, d, rng);
    for (const n of realm.news.slice(seen)) if (n.importance >= 4) console.log(`  day ${n.day}: ${n.text}`);
    seen = realm.news.length;
  }
} else advanceRealm(realm, days + 1, rng);
console.log(`\nAfter ${days} days (day ${realm.day}):`);
for (const line of describeRealm(realm)) console.log(line);
console.log("\nCounts:", Object.entries(realm.stats).filter(([k]) => !k.startsWith("quest_")).map(([k, v]) => `${k} ${v}`).join(", "));
const top = Object.values(realm.figures).filter((f) => f.alive).sort((a, b) => b.renown - a.renown).slice(0, 8);
console.log("\nMost renowned:", top.map((f) => `${titled(f)} (${f.role}, rank ${f.life.tier}, renown ${f.renown})`).join("; "));
