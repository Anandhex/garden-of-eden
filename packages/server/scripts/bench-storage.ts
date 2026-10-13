/**
 * Storage benchmark (N18): a realm of about 50,000 people in a real database file. Times
 * what a save and a load cost, and exits non-zero when one is over its budget.
 *
 *   npm run bench:storage
 *   PEOPLE=100000 npm run bench:storage
 *
 * Budgets (N19 moves these into its budget config): a normal save 1 s, the player's place
 * loaded from a cold database 2 s.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WorldStore } from "../src/game/db.js";
import { rosterFromStore } from "../src/game/realm/townsfolk.js";
import { newWorld, saveWorld } from "../src/game/save.js";
import { biggestSite, bigRealm } from "../src/store/bench.js";
import { materialisePeople } from "../src/store/materialise.js";
import { siteMap } from "../src/web/sites.js";

const SAVE_BUDGET_MS = 1000;
const LOAD_BUDGET_MS = 2000;
const target = Number(process.env.PEOPLE ?? 50_000);

const dir = mkdtempSync(join(tmpdir(), "bench-storage-"));
const ms = (t: number) => Math.round(performance.now() - t);
let failed = false;
const check = (what: string, took: number, budget: number) => {
  const ok = took <= budget;
  failed ||= !ok;
  console.log(`${ok ? "ok  " : "SLOW"} ${what}: ${took} ms (budget ${budget} ms)`);
};

try {
  const realm = bigRealm(target);
  const world = { ...newWorld({}, {}, () => 0.5, 1), realm };
  const store = new WorldStore(join(dir, "world.db"));
  let t = performance.now();
  const n = materialisePeople(realm, store.people, world.day);
  console.log(`${n.toLocaleString()} people in ${Object.keys(realm.settlements).length} places, rolled and stored in ${ms(t)} ms.`);

  const file = join(dir, "world.json");
  const rows = store.people.loadSite(biggestSite(realm), "full");
  // A normal save: an hour's worth of changes (a few hundred people), then the file.
  for (const r of rows.slice(0, 300)) store.people.update(r.id, { job: "labourer" });
  t = performance.now();
  saveWorld(file, world, store);
  check("save, 300 people changed", ms(t), SAVE_BUDGET_MS);
  // The worst case: everyone changed at once.
  for (const r of store.people.search("", { limit: 100000 })) store.people.update(r.id, { job: "labourer" });
  t = performance.now();
  saveWorld(file, world, store);
  check(`save, ${store.people.count().toLocaleString()} people changed`, ms(t), SAVE_BUDGET_MS);
  store.close();

  // A cold start: a new connection, nothing cached, the player's place read and turned into a roster.
  const cold = new WorldStore(join(dir, "world.db"));
  const site = biggestSite(realm);
  const map = siteMap(realm.settlements[site]!, "village", realm);
  t = performance.now();
  const roster = rosterFromStore(cold.people, realm, site, map, world.day);
  check(`load the player's place (${roster?.people.length.toLocaleString()} people)`, ms(t), LOAD_BUDGET_MS);
  cold.close();
} finally {
  rmSync(dir, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
