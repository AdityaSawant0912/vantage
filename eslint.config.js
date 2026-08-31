// @ts-check
import { baseConfig } from "./packages/config/eslint.config.js";

export default [
  { ignores: ["**/dist/**", "**/.astro/**", "**/node_modules/**"] },
  ...baseConfig,
];
