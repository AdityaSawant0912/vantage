import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import starlightTypeDoc, { createStarlightTypeDocPlugin, typeDocSidebarGroup } from "starlight-typedoc";

// starlightTypeDoc's default export shares one sidebar-group placeholder,
// so a second package's docs need their own via createStarlightTypeDocPlugin —
// reusing the default export twice would collide the two reflection sets.
const [trackerTypeDoc, trackerSidebarGroup] = createStarlightTypeDocPlugin();

export default defineConfig({
  integrations: [
    starlight({
      title: "Vantage",
      sidebar: [
        { label: "Guides", autogenerate: { directory: "guides" } },
        typeDocSidebarGroup,
        trackerSidebarGroup,
      ],
      plugins: [
        // Generates API docs from TSDoc comments at build/dev time — no
        // hand-written markdown to drift from the code. Add another
        // createStarlightTypeDocPlugin() pair here when adapter-redis/
        // adapter-postgres ship docs.
        starlightTypeDoc({
          entryPoints: ["../../packages/core/src/index.ts"],
          tsconfig: "../../packages/core/tsconfig.json",
          output: "api/core",
          sidebar: { label: "usevantage" },
        }),
        trackerTypeDoc({
          entryPoints: ["../../packages/tracker/src/index.ts"],
          tsconfig: "../../packages/tracker/tsconfig.json",
          output: "api/tracker",
          sidebar: { label: "@vantage/tracker" },
        }),
      ],
    }),
  ],
});
