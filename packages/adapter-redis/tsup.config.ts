import { defineConfig } from "tsup";
import { defineLibConfig } from "@usevantage/config/tsup";

export default defineConfig(
  defineLibConfig({
    entry: ["src/index.ts"],
    // Real Node dependency — consumers install their own ioredis, it must
    // not get bundled into this package's published output.
    external: ["ioredis"],
  }),
);
