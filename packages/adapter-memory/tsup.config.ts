import { defineConfig } from "tsup";
import { defineLibConfig } from "@vantage/config/tsup";

export default defineConfig(defineLibConfig({ entry: ["src/index.ts"] }));
