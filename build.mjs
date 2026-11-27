// Bundles the two halves of the package into edgebuilder/: the Node mod (mod.mjs) and the
// editor page's script (app.js). `rednode` stays external: the REDnode host provides it to both.
import * as esbuild from "esbuild";
import * as fs from "node:fs";
import { marked } from "marked";

const watch = process.argv.includes("--watch");
// The version players see in the log comes from the package manifest.
const version = JSON.parse(fs.readFileSync("edgebuilder/rednode-app.json", "utf8")).version;

const mod = {
  entryPoints: ["src/mod.ts"],
  outfile: "edgebuilder/mod.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  external: ["rednode"],
  define: { __VERSION__: JSON.stringify(version) },
  legalComments: "none",
  banner: { js: "// Built from src/ by build.mjs; edit the TypeScript, not this file." },
};

// 0.14.0: the About tab, written in src/app/help.md and made into HTML here, so the page needs no
// Markdown reader. Links show their address as text: the overlay cannot open a browser.
const helpMarkdown = {
  name: "help-markdown",
  setup(build) {
    build.onLoad({ filter: /.md$/ }, async (args) => {
      const renderer = new marked.Renderer();
      renderer.link = ({ href, text }) => `${text} <code>${href}</code>`;
      const md = fs.readFileSync(args.path, "utf8").replaceAll("{{version}}", version);
      return { contents: `export default ${JSON.stringify(await marked.parse(md, { renderer, gfm: true }))};`, loader: "js" };
    });
  },
};

const app = {
  entryPoints: ["src/app/main.ts"],
  outfile: "edgebuilder/app.js",
  bundle: true,
  platform: "browser",
  format: "esm",
  target: "chrome120",
  external: ["rednode"],
  plugins: [helpMarkdown],
  legalComments: "none",
  banner: { js: "// Built from src/app/ by build.mjs; edit the TypeScript, not this file." },
};

// 0.14.0: the Previews drawer's pictures, with three.js. The page loads it only when the drawer first opens.
// three.js is MIT: its licence comment stays at the end of the file.
const previews = {
  entryPoints: ["src/app/previews.ts"],
  outfile: "edgebuilder/previews.js",
  bundle: true,
  platform: "browser",
  format: "esm",
  target: "chrome120",
  minify: true,
  legalComments: "eof",
  banner: { js: "// Built from src/app/previews.ts by build.mjs, with three.js (MIT, https://threejs.org)." },
};

// The REDnode-free parts on their own, for scripts/smoke.mjs.
const core = {
  entryPoints: ["src/core.ts"],
  outfile: "dist/core.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  legalComments: "none",
};

// G1: the command line, check and bake with the game closed, from the same REDnode-free parts.
const cli = {
  entryPoints: ["src/cli.ts"],
  outfile: "edgebuilder/cli.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  define: { __VERSION__: JSON.stringify(version) },
  legalComments: "none",
  banner: { js: "// Built from src/ by build.mjs; edit the TypeScript, not this file." },
};

// G1: the scene schemas the docs site publishes are written from src/schema.ts, so they cannot drift.
async function writeSchemas() {
  const { sceneSchema } = await import(`./dist/core.mjs?${Date.now()}`);
  fs.mkdirSync("docs/schema", { recursive: true });
  for (const format of [1, 2, 3]) fs.writeFileSync(`docs/schema/scene-${format}.schema.json`, JSON.stringify(sceneSchema(format), null, 2) + "\n");
}

// B2d: EDGEfab's core, which the mod loads only at the first Import (edgebuilder/fab.cjs, beside
// mod.mjs), so EDGEbuilder starts as fast as before. From npm (@edgemodders/edgefab-core, a
// devDependency since 0.11.1); without node_modules, from an EDGEfab checkout next to this repo, for
// development only. With neither, a stand-in that says Import is missing.
const fabPackage = "node_modules/@edgemodders/edgefab-core";
const fabCheckout = "../EDGEfab/packages/edgefab-core";
const fabFrom = fs.existsSync(fabPackage) ? fabPackage : fs.existsSync(`${fabCheckout}/dist/index.cjs`) ? fabCheckout : undefined;
const fab = {
  stdin: {
    contents: fabFrom
      ? 'module.exports = require("@edgemodders/edgefab-core");'
      : 'throw new Error("This EDGEbuilder was built without EDGEfab\'s core (@edgemodders/edgefab-core), so it cannot import models.");',
    resolveDir: ".",
    loader: "js",
  },
  ...(fabFrom === fabCheckout ? { alias: { "@edgemodders/edgefab-core": `./${fabCheckout}/dist/index.cjs` } } : {}),
  outfile: "edgebuilder/fab.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  legalComments: "none",
};
// The licenses of what the core bundles go with it.
if (fabFrom && fs.existsSync(`${fabFrom}/dist/THIRD-PARTY-NOTICES.txt`)) fs.copyFileSync(`${fabFrom}/dist/THIRD-PARTY-NOTICES.txt`, "edgebuilder/fab-notices.txt");

if (watch) {
  const contexts = await Promise.all([esbuild.context(mod), esbuild.context(app), esbuild.context(previews), esbuild.context(core), esbuild.context(fab), esbuild.context(cli)]);
  await Promise.all(contexts.map((c) => c.watch()));
  console.log("watching src/ ...");
} else {
  await Promise.all([esbuild.build(mod), esbuild.build(app), esbuild.build(previews), esbuild.build(core), esbuild.build(fab), esbuild.build(cli)]);
  await writeSchemas();
  console.log(`built edgebuilder/mod.mjs, edgebuilder/app.js, edgebuilder/previews.js and edgebuilder/cli.mjs; docs/schema written; edgebuilder/fab.cjs ${fabFrom ? `from ${fabFrom}` : "as a stand-in (no EDGEfab core)"}`);
}
