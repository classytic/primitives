// `vitest/config`, NOT `vitest/config.js` — a package SUBPATH is matched against
// the exports map literally, and vitest publishes `./config` only. The trailing
// `.js` (right for a relative ESM import, wrong here) made every run in this
// package die at startup with ERR_MODULE_NOT_FOUND, which reads as a broken
// install rather than a typo.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["tests/unit/**/*.test.ts"],
          testTimeout: 10_000,
          hookTimeout: 10_000,
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          testTimeout: 30_000,
          hookTimeout: 30_000,
        },
      },
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**/*.ts"],
      exclude: ["src/index.ts"],
    },
  },
});
