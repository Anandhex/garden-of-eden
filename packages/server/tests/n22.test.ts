/**
 * N22 (the cut playtest pack 1 needs, plans README section 22): `npm run sim:years` runs fresh worlds for years with no
 * model, samples them daily and checks every bound in src/balance/bounds.ts. A deliberately broken stabiliser is caught.
 * The full run (10 seeds × 10 years, everyone living) is `YEARS=10 SEEDS=1..10 LIVE=all npm run sim:years`.
 */
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BOUNDS } from "../src/balance/bounds.js";
import { runYears } from "../src/balance/run.js";
import { config } from "../src/config.js";

vi.setConfig({ testTimeout: 600_000 });
afterEach(() => config.balance.break.clear());

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");

describe("N22: long-run balance", () => {
  it("every bound names the phase that added it", () => {
    for (const b of BOUNDS) expect(b.phase).toMatch(/^N\d+/);
    expect(BOUNDS.map((b) => b.id)).toEqual(expect.arrayContaining(["population-band", "food-band", "coin-conserved", "fallen-band", "packs-band"]));
  });

  it("the same seed twice gives the same world and the same series", () => {
    const a = runYears({ seed: 4, years: 1 });
    const b = runYears({ seed: 4, years: 1 });
    expect(a.hash).toBe(b.hash);
    expect(a.series).toEqual(b.series);
  });

  it("three seeds for two years stay inside every bound, with every coin accounted for", () => {
    for (const seed of [1, 2, 3]) {
      const r = runYears({ seed, years: 2 });
      const bad = r.bounds.filter((b) => !b.ok);
      expect(bad, `seed ${seed}: ${bad.map((b) => `${b.id}: ${b.detail}`).join("; ")}`).toEqual([]);
      expect(Math.abs(r.series.at(-1)!.coin.unaccounted)).toBeLessThanOrEqual(Math.max(10, r.series.at(-1)!.coin.total * 0.001));
    }
  });

  it("with famine relief broken, the food bound fails", () => {
    config.balance.break.add("no-famine-relief");
    const r = runYears({ seed: 1, years: 5 });
    expect(r.bounds.find((b) => b.id === "food-band")!.ok).toBe(false);
  });

  it("sim:years exits 1 when a bound fails", () => {
    let code = 0;
    try {
      execFileSync("npx", ["tsx", "packages/server/scripts/sim-years.ts", "--bound", "food-band"], { cwd: root, env: { ...process.env, SEEDS: "1", YEARS: "5", BALANCE_BREAK: "no-famine-relief" }, stdio: "pipe" });
    } catch (e) {
      code = (e as { status: number }).status;
    }
    expect(code).toBe(1);
  });
});
