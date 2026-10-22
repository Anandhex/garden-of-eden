import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // A generated realm has its waystation inns (N26) and a world takes a few seconds to roll; a loaded machine more.
    // The 30-day worlds are the slowest tests, and a whole-suite run shares the cores between files: wait longer than a file alone needs.
    testTimeout: 120_000,
    // Wall-clock budgets (PERF_SLACK multiplies them) assume a quiet machine; the whole suite is not one. `PERF_SLACK=1 vitest run <file>` is the strict run.
    env: { PERF_SLACK: process.env.PERF_SLACK ?? "8" },
    include: ["packages/*/tests/**/*.test.ts"],
    setupFiles: ["packages/server/tests/setup.ts"],
  },
});
