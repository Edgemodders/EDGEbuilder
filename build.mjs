// Bundles the two halves of the package into edgebuilder/: the Node mod (mod.mjs) and the
// editor page's script (app.js). `rednode` stays external: the REDnode host provides it to both.
import * as esbuild from "esbuild";
import * as fs from "node:fs";

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

const app = {
  entryPoints: ["src/app/main.ts"],
  outfile: "edgebuilder/app.js",
  bundle: true,
  platform: "browser",
  format: "esm",
  target: "chrome120",
  external: ["rednode"],
  legalComments: "none",
  banner: { js: "// Built from src/app/ by build.mjs; edit the TypeScript, not this file." },
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

// B2d: EDGEfab's core, which the mod loads only at the first Import (edgebuilder/fab.cjs, beside
// mod.mjs), so EDGEbuilder starts as fast as before. From npm once @edgemodders/edgefab-core is there
// (EDGEfab #5); until then from an EDGEfab checkout next to this repo, for development only. With
// neither, a stand-in that says Import is missing, so the build and the release workflow still run.
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
  const contexts = await Promise.all([esbuild.context(mod), esbuild.context(app), esbuild.context(core), esbuild.context(fab)]);
  await Promise.all(contexts.map((c) => c.watch()));
  console.log("watching src/ ...");
} else {
  await Promise.all([esbuild.build(mod), esbuild.build(app), esbuild.build(core), esbuild.build(fab)]);
  console.log(`built edgebuilder/mod.mjs and edgebuilder/app.js; edgebuilder/fab.cjs ${fabFrom ? `from ${fabFrom}` : "as a stand-in (no EDGEfab core)"}`);
}
