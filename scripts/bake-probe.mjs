// The bake probe (design draft 4): one crate baked by REDbridge's sector.build, packed into an
// archive with its ArchiveXL file, as a mod folder for EDGEdeck. No EDGEbuilder in the loop.
//   npm run build
//   node scripts/bake-probe.mjs <out folder> [--x X --y Y --z Z]
// EDGEBUILDER_BRIDGE (REDbridge 0.11.0 or later, for game 2.5 sectors) and EDGEBUILDER_GAME as for the smoke test.
// Writes <out>/project (the REDcode project the bake goes into) and <out>/mod (archive\pc\mod\...).
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { BridgeClient, findBridge, isGameFolder } from "../dist/core.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const out = args.find((a) => !a.startsWith("--") && !/^-?[\d.]+$/.test(a));
if (!out) {
  console.error("usage: node scripts/bake-probe.mjs <out folder> [--x X --y Y --z Z]");
  process.exit(2);
}
const num = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : fallback;
};
// Default: 2 m east of a crate the owner dropped on a Watson street in B2b's test.
const position = [num("x", -1439.15), num("y", 1214.04), num("z", 23.07)];

const exe = process.env.EDGEBUILDER_BRIDGE || [path.join(here, "..", "..", "REDbridge", "src", "REDbridge", "bin", "Release", "net10.0", "REDbridge.exe")].find((p) => fs.existsSync(p)) || findBridge();
const game = [process.env.EDGEBUILDER_GAME, "E:\\SteamLibrary\\steamapps\\common\\Cyberpunk 2077", "C:\\Program Files (x86)\\Steam\\steamapps\\common\\Cyberpunk 2077"].find(isGameFolder);
if (!exe || !game) {
  console.error(`missing ${exe ? "" : "REDbridge.exe "}${game ? "" : "game folder"}`);
  process.exit(1);
}

const name = "edgebuilder_bake_probe";
const project = path.resolve(out, "project");
const mod = path.resolve(out, "mod");
fs.rmSync(path.resolve(out), { recursive: true, force: true });
fs.mkdirSync(project, { recursive: true });

const scene = {
  format: 1,
  name,
  game: "2.5",
  groups: [],
  objects: [
    {
      id: "crate",
      kind: "mesh",
      resource: "base\\environment\\decoration\\containers\\cargo\\cargo_crate\\cargo_crate_a.mesh",
      appearance: "default",
      transform: { position, rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
    },
  ],
};
fs.mkdirSync(path.join(project, "source", "scenes"), { recursive: true });
fs.writeFileSync(path.join(project, "source", "scenes", `${name}.scene.json`), JSON.stringify(scene, null, 2));

const bridge = new BridgeClient(exe, game);
bridge.start();
try {
  const info = await bridge.info();
  console.log(`REDbridge ${info.version}, game ${info.gameVersion ?? "?"}, ${info.files} files`);
  const built = await bridge.call("sector.build", { project, scene });
  console.log("sector.build:", JSON.stringify(built, null, 2));

  // ArchiveXL adds a streaming block to the world under streaming: blocks (ArchiveXL 1.28's
  // WorldStreaming), not as a resource patch, which REDbridge 0.11.0 writes. Written here until
  // REDbridge changes; the .xl beside the archive takes the archive's name.
  fs.rmSync(built.xl ?? built.xlFile, { force: true });
  const xl = `# EDGEbuilder bake probe: the streaming block that adds the baked sector to the world.\nstreaming:\n  blocks:\n    - ${built.blockPath}\n`;

  const archiveDir = path.join(mod, "archive", "pc", "mod");
  fs.mkdirSync(archiveDir, { recursive: true });
  const packed = await bridge.call("project.pack", { dir: path.join(project, "source", "archive"), outDir: archiveDir, modName: name });
  console.log("project.pack:", JSON.stringify(packed, null, 2));
  fs.writeFileSync(path.join(archiveDir, `${name}.archive.xl`), xl);
  console.log(`mod folder: ${mod}`);
  for (const f of fs.readdirSync(archiveDir)) console.log(`  archive\\pc\\mod\\${f} (${fs.statSync(path.join(archiveDir, f)).size} bytes)`);
} catch (e) {
  console.error(String(e?.message ?? e));
  console.error(bridge.log.slice(-20).join("\n"));
  process.exitCode = 1;
} finally {
  bridge.stop();
}
