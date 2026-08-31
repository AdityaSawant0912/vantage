// @ts-check
import tseslint from "typescript-eslint";

/** Shared flat-config rules for every package. Consumed once from the root eslint.config.js. */
// ponytail: non-type-checked rules only; switch to recommendedTypeChecked + parserOptions.project once real logic exists to check
export const baseConfig = tseslint.config(
  tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", destructuredArrayIgnorePattern: "^_" },
      ],
    },
  },
);
