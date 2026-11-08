// Builds the EDGEbuilder player zip, dist/EDGEbuilder-<version>.zip: the package laid out like the game
// folder, red4ext/plugins/REDnode/apps/edgebuilder/, as REDnode's and REDagent's zips are, so Vortex
// (Mod Manager Download), EDGEdeck and an extract by hand all put it in the same place. The same file
// goes on the GitHub release and on Nexus Mods (nexus/README.md).
//
//   node tools/release/zip.mjs        (npm run package builds first, then runs this)
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const pkgDir = join(repo, "edgebuilder");
const manifest = JSON.parse(readFileSync(join(pkgDir, "rednode-app.json"), "utf8"));
const npm = JSON.parse(readFileSync(join(repo, "package.json"), "utf8"));
if (manifest.version !== npm.version) throw new Error(`edgebuilder/rednode-app.json is ${manifest.version} but package.json is ${npm.version}`);
const version = manifest.version;
for (const f of ["mod.mjs", "app.js"]) statSync(join(pkgDir, f)); // built: npm run build first

const out = join(repo, "dist");
const stage = join(out, "stage");
const target = join(stage, "red4ext", "plugins", "REDnode", "apps", "edgebuilder");
const zip = join(out, `EDGEbuilder-${version}.zip`);
rmSync(stage, { recursive: true, force: true });
rmSync(zip, { force: true });
mkdirSync(target, { recursive: true });

cpSync(pkgDir, target, { recursive: true, filter: (src) => !src.endsWith(".bak") && !src.endsWith(".map") });
cpSync(join(repo, "LICENSE"), join(target, "LICENSE.txt"));
const need = Object.fromEntries(Object.entries(manifest.requires ?? {}).map(([k, v]) => [k, `${String(v).replace(/^>=\s*/, "")} or later`]));
writeFileSync(
  join(target, "README.txt"),
  [
    `EDGEbuilder ${version}: a world builder inside Cyberpunk 2077. Browse the game's assets, drop them`,
    "into the live world, position and arrange them, save scenes, and bake them into the world.",
    "",
    "For game version 2.5.",
    "",
    `Needs: REDnode ${need.rednode ?? ""} (https://www.nexusmods.com/cyberpunk2077/mods/35419) and Codeware ${need.codeware ?? ""}.`,
    "For the asset list and for baking: REDbridge 0.12.1 or later. Open EDGEdeck once and press",
    "Get REDbridge (https://www.nexusmods.com/cyberpunk2077/mods/35420). For what you bake: ArchiveXL,",
    "and a REDcode project to pack it into (https://www.nexusmods.com/cyberpunk2077/mods/35421).",
    "",
    "Install with Vortex or EDGEdeck, or extract this zip into the game folder, so EDGEbuilder lands in",
    "red4ext/plugins/REDnode/apps/edgebuilder/. In the game press F10, open the Mod Manager, switch",
    "EDGEbuilder on and Allowed on for REDbridge, and pin it to the launcher.",
    "",
    "Guide: https://edgemodders.ai/wiki/edgebuilder/",
    "Source: https://github.com/Edgemodders/EDGEbuilder",
    "",
  ].join("\r\n"),
);

// Windows' own tar writes zip files (-a picks the format from the name).
const tar = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe");
const packed = spawnSync(tar, ["-a", "-c", "-f", zip, "red4ext"], { cwd: stage, stdio: "inherit" });
if (packed.status !== 0) throw new Error("Zipping failed");
rmSync(stage, { recursive: true, force: true });

console.log(`${zip}: ${(statSync(zip).size / 1024).toFixed(0)} KB, EDGEbuilder ${version}, needs REDnode ${need.rednode ?? "?"}`);
