/**
 * Long-run balance (N22): run fresh worlds for years over several seeds with no model, check every bound, write a report.
 *
 *   npm run sim:years                          # 3 seeds × 5 years, people living in the start town and its neighbour
 *   YEARS=10 SEEDS=1..10 npm run sim:years     # the nightly run
 *   SEEDS=1,4,9 LIVE=all npm run sim:years     # everyone living, everywhere (slow: ~1 s a day)
 *   npm run sim:years -- --bound coin-conserved
 *   npm run sim:years -- --list
 *   BALANCE_BREAK=no-famine-relief npm run sim:years   # prove a bound catches a broken world
 *
 * Exits 1 if any bound fails. Writes saves/balance-report.json.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { BOUNDS } from "../src/balance/bounds.js";
import { runYears } from "../src/balance/run.js";

const args = process.argv.slice(2);
if (args.includes("--list")) {
  for (const b of BOUNDS) console.log(`${b.id.padEnd(22)} ${b.phase.padEnd(7)} ${b.describe}`);
  process.exit(0);
}
const only = args.includes("--bound") ? args[args.indexOf("--bound") + 1] : undefined;

function parseSeeds(spec: string): number[] {
  if (spec.includes("..")) {
    const [a, b] = spec.split("..").map(Number);
    return Array.from({ length: b! - a! + 1 }, (_, i) => a! + i);
  }
  return spec.split(",").map(Number).filter((n) => Number.isFinite(n));
}

const seeds = parseSeeds(process.env.SEEDS ?? "1..3");
const years = Number(process.env.YEARS ?? 5);
const live = process.env.LIVE ?? "slice";
const report: unknown[] = [];
let failed = 0;
for (const seed of seeds) {
  const r = runYears({ seed, years, live });
  const bounds = r.bounds.filter((b) => !only || b.id === only);
  console.log(`\nSeed ${seed}: ${r.days} days in ${(r.ms / 1000).toFixed(1)} s (${Math.round(r.ms / r.days)} ms a day), hash ${r.hash.slice(0, 12)}`);
  const last = r.series.at(-1)!;
  console.log(`  people ${last.population}, food ${last.food.mean.toFixed(0)}, prosperity ${last.prosperity.mean.toFixed(0)}, wars ${last.wars}, factions ${last.factions}, abandoned ${last.abandoned}, fallen ${last.fallen}, coin ${last.coin.total}`);
  for (const b of bounds) {
    console.log(`  ${b.ok ? "ok  " : "FAIL"} ${b.id.padEnd(24)} ${b.phase.padEnd(7)} ${b.detail}`);
    if (!b.ok) failed++;
  }
  report.push({ seed, days: r.days, ms: Math.round(r.ms), hash: r.hash, last, bounds });
}
const out = join(dirname(fileURLToPath(import.meta.url)), "../../../saves/balance-report.json");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ years, live, seeds, report }, null, 2));
console.log(`\n${failed === 0 ? "All bounds held." : `${failed} bound(s) failed.`} Report: saves/balance-report.json`);
process.exit(failed === 0 ? 0 : 1);
