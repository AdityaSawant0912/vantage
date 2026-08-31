import { defineConfig } from "tsup";
import { defineLibConfig } from "@usevantage/config/tsup";

export default defineConfig(
  defineLibConfig({
    entry: ["src/index.ts"],
    format: ["esm", "iife"],
    globalName: "Vantage",
    target: "es2020",
  }),
);
