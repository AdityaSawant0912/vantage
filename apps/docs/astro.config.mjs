import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import { createStarlightTypeDocPlugin } from "starlight-typedoc";

// Each published package gets its own plugin + sidebar-group pair —
// starlightTypeDoc's default export shares one singleton placeholder, so
// reusing it across packages would collide their reflection sets.
const apiPackages = [
  { label: "@usevantage/core", dir: "core", output: "api/core" },
  { label: "@usevantage/tracker", dir: "tracker", output: "api/tracker" },
  { label: "@usevantage/adapter-memory", dir: "adapter-memory", output: "api/adapter-memory" },
  { label: "@usevantage/adapter-redis", dir: "adapter-redis", output: "api/adapter-redis" },
  { label: "@usevantage/adapter-postgres", dir: "adapter-postgres", output: "api/adapter-postgres" },
];

const apiDocs = apiPackages.map(({ label, dir, output }) => {
  const [plugin, sidebarGroup] = createStarlightTypeDocPlugin();
  return {
    sidebarGroup,
    plugin: plugin({
      entryPoints: [`../../packages/${dir}/src/index.ts`],
      // A dedicated docs tsconfig (src only, no test/) — TypeDoc type-checks
      // the whole program a tsconfig resolves, not just entryPoints, so
      // pointing it at the package's real tsconfig.json (include: src+test)
      // fails the docs build on any test-file type issue that has nothing
      // to do with the public API being documented.
      tsconfig: `../../packages/${dir}/tsconfig.docs.json`,
      output,
      sidebar: { label },
    }),
  };
});

export default defineConfig({
  integrations: [
    starlight({
      title: "Vantage",
      sidebar: [{ label: "Guides", autogenerate: { directory: "guides" } }, ...apiDocs.map((d) => d.sidebarGroup)],
      // Generates API docs from TSDoc comments at build/dev time — no
      // hand-written markdown to drift from the code. Add a package to
      // apiPackages above when it ships docs.
      plugins: apiDocs.map((d) => d.plugin),
    }),
  ],
});
