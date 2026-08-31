import { mergeConfig, defineConfig } from "vitest/config";
import { baseConfig } from "@vantage/config/vitest";

export default mergeConfig(baseConfig, defineConfig({}));
