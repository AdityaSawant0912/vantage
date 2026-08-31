import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import starlightTypeDoc, { typeDocSidebarGroup } from "starlight-typedoc";

export default defineConfig({
  integrations: [
    starlight({
      title: "Vantage",
      sidebar: [
        { label: "Guides", autogenerate: { directory: "guides" } },
        typeDocSidebarGroup,
      ],
      plugins: [
        // Generates API docs from TSDoc comments at build/dev time — no
        // hand-written markdown to drift from the code. Add another
        // starlightTypeDoc() call here when tracker/adapter-* ship docs.
        starlightTypeDoc({
          entryPoints: ["../../packages/core/src/index.ts"],
          tsconfig: "../../packages/core/tsconfig.json",
          output: "api/core",
          sidebar: { label: "usevantage" },
        }),
      ],
    }),
  ],
});
