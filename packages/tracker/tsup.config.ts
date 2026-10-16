import { defineConfig } from "tsup";
import { defineLibConfig } from "@usevantage/config/tsup";

export default defineConfig([
  // ESM: the main entry plus the optional modules (`/visibility`, `/items`).
  // splitting lets items and visibility share one chunk instead of each
  // bundling its own copy.
  defineLibConfig({
    entry: ["src/index.ts", "src/visibility.ts", "src/items.ts"],
    format: ["esm"],
    splitting: true,
    target: "es2020",
  }),
  // IIFE: the core tracker only, exposed as the `Vantage` global. Built
  // separately so the extra entries don't collide on the same global name
  // and the optional modules stay out of the drop-in script.
  defineLibConfig({
    entry: ["src/index.ts"],
    format: ["iife"],
    globalName: "Vantage",
    target: "es2020",
    dts: false,
    clean: false,
  }),
]);
