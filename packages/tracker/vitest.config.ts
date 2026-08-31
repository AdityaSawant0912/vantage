import { mergeConfig, defineConfig } from "vitest/config";
import { baseConfig } from "@usevantage/config/vitest";

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      environment: "jsdom",
      environmentOptions: { jsdom: { url: "https://example.test/landing" } },
    },
  }),
);
