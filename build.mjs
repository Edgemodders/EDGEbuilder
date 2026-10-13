// Bundles the two halves of the package into edgebuilder/: the Node mod (mod.mjs) and the
// editor page's script (app.js). `rednode` stays external: the REDnode host provides it to both.
import * as esbuild from "esbuild";

const watch = process.argv.includes("--watch");

const mod = {
  entryPoints: ["src/mod.ts"],
  outfile: "edgebuilder/mod.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  external: ["rednode"],
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

if (watch) {
  const contexts = await Promise.all([esbuild.context(mod), esbuild.context(app), esbuild.context(core)]);
  await Promise.all(contexts.map((c) => c.watch()));
  console.log("watching src/ ...");
} else {
  await Promise.all([esbuild.build(mod), esbuild.build(app), esbuild.build(core)]);
  console.log("built edgebuilder/mod.mjs and edgebuilder/app.js");
}
