import { defineConfig } from "vitest/config";

/**
 * Two projects, so the suite is fast and does not fail by crowding:
 * - `fast`: everything else, in parallel;
 * - `heavy`: the files that simulate weeks of a whole realm, one file at a time, after the fast ones (`groupOrder`), so they never fight each
 *   other for the cores. Their long versions (LONG=1, the nightly job) are in tests/long.ts.
 * A test slower than `slowTestThreshold` is flagged in the report, so a creeping one is seen before it times out.
 */
const HEAVY = ["n17", "n18", "n25", "n25b", "n26", "n26e", "n37", "n12", "n19", "n33", "n40"].map((n) => `packages/server/tests/${n}.test.ts`);

const shared = {
  // A generated realm has its waystation inns (N26) and a world takes a few seconds to roll; a loaded machine more.
  testTimeout: 120_000,
  slowTestThreshold: 20_000,
  // Wall-clock budgets (PERF_SLACK multiplies them) assume a quiet machine; the whole suite is not one. `PERF_SLACK=1 vitest run <file>` is the strict run.
  env: { PERF_SLACK: process.env.PERF_SLACK ?? "8" },
  setupFiles: ["packages/server/tests/setup.ts"],
};

export default defineConfig({
  test: {
    projects: [
      { test: { ...shared, name: "fast", include: ["packages/*/tests/**/*.test.ts"], exclude: HEAVY, sequence: { groupOrder: 1 } } },
      { test: { ...shared, name: "heavy", include: HEAVY, fileParallelism: false, sequence: { groupOrder: 2 } } },
    ],
  },
});
