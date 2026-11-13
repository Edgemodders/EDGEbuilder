// B2d-0, the import probe (docs/design.md, "Import a model (B2d)"). No interface, nothing shipped:
// a GLB goes through EDGEfab's core (@edgemodders/edgefab-core) into a scratch project, REDbridge
// packs it, and the time of each step and the size the core adds to EDGEbuilder's mod are written
// down. The swap into the running game and a spawn are the in-game half, through REDnode's tools.
//
// Until edgefab-core is on npm (EDGEfab #5) it is loaded from an EDGEfab checkout next to this repo,
// built with `npm run build -w @edgemodders/edgefab-core` there. Development only, as the plan says.
//
//   node scripts/import-probe.mjs [--glb <file>] [--height <m>] [--out <folder>] [--core <edgefab-core folder>]
//
// --glb     the model; default the vending machine on EDGEfab's Desk (Tripo's original.glb)
// --height  for a model with no real size (Tripo's parts); default 2 m
// --out     a scratch folder for the Desk item and the project; default <temp>\edgebuilder-b2d-probe
// --core    default ../EDGEfab/packages/edgefab-core
//
// REDbridge and the game folder come from VS Code's REDcode settings, through the core's startBridge,
// as in EDGEfab's MCP server. In the game, EDGEbuilder passes REDnode's kernel.bridge() instead.

import * as esbuild from "esbuild";
import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const here = path.dirname(fileURLToPath(import.meta.url));
const coreDir = path.resolve(arg("core", path.join(here, "..", "..", "EDGEfab", "packages", "edgefab-core")));
const glb = path.resolve(arg("glb", path.join(process.env.LOCALAPPDATA ?? "", "EDGEfab", "desk", "vending_e2e.prop.asset", "source", "raw", "vending_e2e", "original.glb")));
const height = Number(arg("height", "2"));
const out = path.resolve(arg("out", path.join(os.tmpdir(), "edgebuilder-b2d-probe")));

if (!fs.existsSync(path.join(coreDir, "dist", "index.cjs"))) throw new Error(`No built edgefab-core at ${coreDir}: run npm run build -w @edgemodders/edgefab-core in EDGEfab.`);
if (!fs.existsSync(glb)) throw new Error(`No GLB at ${glb}: pass --glb.`);

const fab = createRequire(path.join(coreDir, "package.json"))(coreDir);
const version = `EDGEbuilder B2d-0 probe`;
const times = {};
async function timed(step, fn) {
  const t = performance.now();
  const r = await fn();
  times[step] = Math.round(performance.now() - t);
  console.log(`${step}: ${times[step]} ms`);
  return r;
}

// A fresh scratch project: a folder with source\archive is a WolvenKit project to the core.
fs.rmSync(out, { recursive: true, force: true });
const desk = path.join(out, "desk");
const projectDir = path.join(out, "B2dProbe");
fs.mkdirSync(desk, { recursive: true });
fs.mkdirSync(path.join(projectDir, "source", "archive"), { recursive: true });
fs.writeFileSync(path.join(projectDir, "B2dProbe.cpmodproj"), "");

console.log(`GLB: ${glb} (${(fs.statSync(glb).size / 1e6).toFixed(1)} MB)`);
const { client, call } = await timed("start REDbridge", () => fab.startBridge((l) => process.env.PROBE_VERBOSE && console.log(l)));
try {
  const made = await timed("prepare (makeModel)", () => fab.makeModel({ from: "file", file: glb, name: "b2d_probe" }, { version, base: desk }));
  let prepared = made.prepared;
  if (prepared.sizeUnknown) prepared = await timed("set size", () => fab.setSize(made.folder, height, { version }));
  const project = fab.projectFolders(projectDir);
  if (!project) throw new Error(`Not a project: ${projectDir}`);
  // EDGEfab's own log, with the time since Add to Project began, to see which part of it is slow.
  const t0 = performance.now();
  const steps = [];
  const log = (line) => steps.push(`${((performance.now() - t0) / 1000).toFixed(1)} s  ${line}`);
  const added = await timed("add to project", () => fab.addToProject({ item: made.folder, project, call, collision: fab.DefaultCollision, log }));
  console.log(steps.join("\n"));
  // Watch's case: the same model added again, nothing changed. Does it reuse the textures?
  const again = await timed("add to project again, unchanged", () => fab.addToProject({ item: made.folder, project, call, collision: fab.DefaultCollision }));
  if (!again.replaced) console.log("(the second add did not say it replaced the first)");
  const packed = path.join(projectDir, "packed", "archive", "pc", "mod");
  const pack = await timed("pack", () => call("project.pack", { dir: project.archive, outDir: packed, modName: "b2d_probe" }));

  // The size the core adds to EDGEbuilder's mod.mjs, bundled the way build.mjs bundles the mod.
  const bundle = await esbuild.build({
    stdin: { contents: `export * from ${JSON.stringify(path.join(coreDir, "dist", "index.cjs").replace(/\\/g, "/"))};`, resolveDir: here, loader: "js" },
    bundle: true, platform: "node", format: "esm", target: "node20", external: ["rednode"], legalComments: "none", write: false, metafile: true,
  });
  const bytes = bundle.outputFiles[0].contents.length;
  const modBytes = fs.statSync(path.join(here, "..", "edgebuilder", "mod.mjs")).size;

  const archive = fs.readdirSync(packed).find((f) => f.endsWith(".archive"));
  const result = {
    glb, megabytes: +(fs.statSync(glb).size / 1e6).toFixed(1),
    size: prepared.size, sizeUnknown: !!made.prepared.sizeUnknown, submeshes: prepared.submeshes.length, parts: prepared.parts?.length ?? 0, textures: prepared.textures.length,
    entity: added.entity, mesh: added.mesh, collision: added.collision, files: added.files.length,
    archive: archive ? path.join(packed, archive) : undefined, archiveBytes: archive ? fs.statSync(path.join(packed, archive)).size : undefined,
    pack, times, addSteps: steps,
    bundle: { coreBytes: bytes, modBytes, inputs: Object.keys(bundle.metafile.inputs).length },
    notes: [...prepared.notes, ...added.notes],
  };
  fs.writeFileSync(path.join(out, "probe-result.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  console.log(`\nFor the in-game half: swap ${result.archive} with REDnode's archives_reload, then world_spawn ${added.entity}.`);
} finally {
  client.stop?.();
}
