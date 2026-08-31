import { defineConfig } from "vitest/config";

/** Shared vitest config fragment; merge into per-package vitest.config.ts via mergeConfig. */
export const baseConfig = defineConfig({
  test: {
    environment: "node",
    coverage: {
      provider: "v8",
    },
  },
});
