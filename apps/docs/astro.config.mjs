import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import { createStarlightTypeDocPlugin } from "starlight-typedoc";

// Each published package gets its own plugin + sidebar-group pair —
// starlightTypeDoc's default export shares one singleton placeholder, so
// reusing it across packages would collide their reflection sets.
const apiPackages = [
  { label: "usevantage", dir: "core", output: "api/core" },
  { label: "@vantage/tracker", dir: "tracker", output: "api/tracker" },
  { label: "@vantage/adapter-redis", dir: "adapter-redis", output: "api/adapter-redis" },
  { label: "@vantage/adapter-postgres", dir: "adapter-postgres", output: "api/adapter-postgres" },
];

const apiDocs = apiPackages.map(({ label, dir, output }) => {
  const [plugin, sidebarGroup] = createStarlightTypeDocPlugin();
  return {
    sidebarGroup,
    plugin: plugin({
      entryPoints: [`../../packages/${dir}/src/index.ts`],
      tsconfig: `../../packages/${dir}/tsconfig.json`,
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
