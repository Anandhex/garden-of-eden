import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/tests/**/*.test.ts"],
    setupFiles: ["packages/server/tests/setup.ts"],
  },
});
