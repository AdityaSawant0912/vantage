import { defineConfig } from "tsup";
import { defineLibConfig } from "@usevantage/config/tsup";

export default defineConfig(
  defineLibConfig({
    entry: ["src/index.ts"],
    external: ["pg"],
  }),
);
