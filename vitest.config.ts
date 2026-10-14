import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // A generated realm has its waystation inns (N26) and a world takes a few seconds to roll; a loaded machine more.
    testTimeout: 30_000,
    include: ["packages/*/tests/**/*.test.ts"],
    setupFiles: ["packages/server/tests/setup.ts"],
  },
});
