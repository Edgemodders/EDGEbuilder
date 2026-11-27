// EDGEbuilder's command line (G1): check and bake a scene file with the game closed.
//   node edgebuilder/cli.mjs check <scene> [options]
//   node edgebuilder/cli.mjs bake <scene> --out <folder> | --project <folder or .cpmodproj> [options]
// Built from the modules that need no REDnode; it runs REDbridge as its own process.
// docs/generated-scenes.md, "The command line".

import * as fs from "node:fs";
import * as path from "node:path";
import { bakeFilesOf, bakeHash, bakeInput, bakeRemovals, forgetInNote, settleXl, solidForBake, writeRecord, type BakeProject } from "./bake";
import { BridgeClient, findBridge, isGameFolder, type InfoFrom, type MeshInfoResult, type SectorBuilt } from "./bridge";
import { checkFiles, checkSceneData, editsOf, findOverlaps, groupBridgeWarnings, overlapFindings, type Dropped, type Finding } from "./check";
import { collisionKey } from "./arrange";
import type { BakeRecord, SceneObject } from "./protocol";
import type { SceneFile } from "./scene";
import { slugOf } from "./scenes";

declare const __VERSION__: string;

const Usage = `EDGEbuilder ${__VERSION__}: check and bake a scene file with the game closed.

  check <scene>                    Checks the file and says what a bake would leave out. Writes nothing.
  bake <scene> --out <folder>      Bakes into a plain folder laid out like a project (source/archive/...).
  bake <scene> --project <path>    Bakes into a REDcode or WolvenKit project (its folder or .cpmodproj).

Options:
  --pack             With --out: also packs the folder's bakes into packed/archive/pc/mod/, with the .xl.
  --name <name>      With --pack: the archive's name. The scene's name when left out.
  --dry-run          bake: everything up to writing. The report says what would be written.
  --json             Prints one JSON report and nothing else.
  --archive <file>   A mod's .archive to look in before the game's files.
  --root <folder>    A folder of loose files (a project's source/archive) to look in before the game's.
  --overlap <share>  Report pairs of objects that fill nearly the same box: the share of the two
                     boxes that both cover, 0 to 1 (0.98 when left out; off for no overlap check).
  --offline          check: only the file itself, without REDbridge and the game's files.
  --bridge <exe>     REDbridge.exe. Else EDGEBUILDER_BRIDGE, else the one EDGEdeck fetched.
  --game <folder>    The game's folder. Else EDGEBUILDER_GAME, else Steam's default folder.

Exit code: 0 when nothing stops a bake, 1 for errors in the scene or the bake, 2 for a command that cannot be read.`;

class UsageError extends Error {}

interface Options {
  command: "check" | "bake";
  scene: string;
  out?: string;
  project?: string;
  pack: boolean;
  name?: string;
  dryRun: boolean;
  json: boolean;
  archive?: string;
  root?: string;
  overlap: number | undefined;
  offline: boolean;
  bridge?: string;
  game?: string;
}

function readArgs(argv: string[]): Options {
  const [command, ...rest] = argv;
  if (command !== "check" && command !== "bake") throw new UsageError(command ? `${command} is not a command: check or bake.` : "Name a command: check or bake.");
  const o: Options = { command, scene: "", pack: false, dryRun: false, json: false, overlap: 0.98, offline: false };
  const flags: Record<string, keyof Options> = { "--pack": "pack", "--dry-run": "dryRun", "--json": "json", "--offline": "offline" };
  const values: Record<string, keyof Options> = { "--out": "out", "--project": "project", "--name": "name", "--archive": "archive", "--root": "root", "--bridge": "bridge", "--game": "game" };
  const seen = new Set<string>();
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a in flags) (o as unknown as Record<string, unknown>)[flags[a]] = true;
    else if (a in values || a === "--overlap") {
      const v = rest[++i];
      if (v === undefined || v.startsWith("--")) throw new UsageError(`${a} needs a value.`);
      if (seen.has(a)) throw new UsageError(a === "--archive" || a === "--root" ? `${a} was given twice: REDbridge looks in one ${a === "--archive" ? "mod archive" : "folder"} at a time.` : `${a} was given twice.`);
      seen.add(a);
      if (a === "--overlap") {
        o.overlap = v === "off" ? undefined : Number(v);
        if (o.overlap !== undefined && !(o.overlap > 0 && o.overlap <= 1)) throw new UsageError("--overlap takes a share above 0 and up to 1, or off.");
      } else (o as unknown as Record<string, unknown>)[values[a]] = v;
    } else if (a.startsWith("--")) throw new UsageError(`${a} is not an option.`);
    else if (o.scene) throw new UsageError(`One scene at a time: ${o.scene} and ${a} were both given.`);
    else o.scene = a;
  }
  if (!o.scene) throw new UsageError("Name the scene file.");
  if (o.command === "bake") {
    // An option that cannot go with bake is named before what is missing (G1 test, step 7).
    if (o.offline) throw new UsageError("--offline is for check: a bake needs REDbridge.");
    if (!o.out === !o.project) throw new UsageError("bake needs where to write: --out <folder> or --project <path>, one of them.");
    if (o.pack && !o.out) throw new UsageError("--pack goes with --out. A project is packed by REDcode or WolvenKit, which know its settings.");
  } else if (o.out || o.project || o.pack || o.dryRun) throw new UsageError("--out, --project, --pack and --dry-run are for bake.");
  if (o.name && !o.pack) throw new UsageError("--name goes with --pack.");
  return o;
}

/** The report: what `--json` prints, and what the plain text is made from. */
interface Report {
  edgebuilder: string;
  command: string;
  ok: boolean;
  scene: { file: string; name?: string; slug?: string; format?: number; hash?: string; generator?: unknown };
  counts: Record<string, number>;
  errors: Finding[];
  warnings: Finding[];
  dropped: Dropped[];
  /** Files the scene uses that REDbridge did not find: the game needs the mod that has them. */
  needs: string[];
  redbridge?: { version: string; exe: string; game: string | null };
  /** What was looked at: `file` alone with --offline, `files` with REDbridge. */
  checked: "file" | "files";
  dryRun?: boolean;
  /** The files written, or with --dry-run the ones a bake would write. */
  written: string[];
  nodes?: number;
  removals?: number;
  streamingBox?: { min: number[]; max: number[] } | null;
  packed?: { archive: string; bytes: number; files: number };
  ms: Record<string, number>;
}

function projectOf(given: string): BakeProject {
  const full = path.resolve(given);
  const dir = /\.cpmodproj$/i.test(full) ? path.dirname(full) : full;
  const source = path.join(dir, "source");
  return { name: path.basename(dir), dir, archive: path.join(source, "archive"), raw: path.join(source, "raw"), resources: path.join(source, "resources") };
}

async function run(o: Options): Promise<Report> {
  const started = Date.now();
  const file = path.resolve(o.scene);
  const report: Report = { edgebuilder: __VERSION__, command: o.command, ok: false, scene: { file }, counts: {}, errors: [], warnings: [], dropped: [], needs: [], checked: "file", written: [], ms: {} };
  const stop = (code: string, text: string): Report => {
    report.errors.push({ code, text });
    return report;
  };

  let data: SceneFile;
  try {
    data = JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
  } catch (err) {
    return stop("unreadable", `The scene file could not be read: ${(err as Error).message}`);
  }
  const first = checkSceneData(data);
  report.errors.push(...first.errors);
  report.warnings.push(...first.warnings);
  report.dropped.push(...first.dropped);
  if (data && typeof data === "object") {
    const objects = Array.isArray(data.objects) ? data.objects : [];
    report.scene = { file, name: typeof data.name === "string" ? data.name : undefined, slug: typeof data.name === "string" ? slugOf(data.name) : undefined, format: data.format, ...(data.generator ? { generator: data.generator } : {}) };
    for (const obj of objects) if (obj && typeof obj.kind === "string") report.counts[obj.kind] = (report.counts[obj.kind] ?? 0) + 1;
  }
  if (report.errors.length) return report;

  const objects = data.objects as SceneObject[];
  const edits = editsOf(data);
  const { removals } = bakeRemovals(edits);
  if (edits.length) report.counts.worldEdits = edits.length;
  report.scene.hash = bakeHash(objects, edits);
  if (o.offline) {
    report.warnings.push({ code: "not-checked", text: "--offline: files, appearances, collision data and overlaps were not checked." });
    report.ok = true;
    return report;
  }

  const exe = findBridge(o.bridge ?? process.env.EDGEBUILDER_BRIDGE);
  if (o.bridge && exe !== o.bridge) return stop("no-redbridge", `${o.bridge} is not there.`);
  if (!exe) return stop("no-redbridge", "REDbridge was not found: name it with --bridge or EDGEBUILDER_BRIDGE, or fetch it with EDGEdeck (Get REDbridge). check --offline looks at the file alone.");
  const named = o.game ?? (process.env.EDGEBUILDER_GAME || undefined);
  const game = named ?? findGame();
  if (!isGameFolder(game)) return stop("no-game", `The game was not found${named ? ` in ${named}` : " in Steam's libraries or GOG's folders"}: name its folder with --game or EDGEBUILDER_GAME.`);
  const from: InfoFrom = { ...(o.archive ? { archive: path.resolve(o.archive) } : {}), ...(o.root ? { root: path.resolve(o.root) } : {}) };
  for (const [what, p] of Object.entries(from)) if (!fs.existsSync(p)) return stop("usage", `--${what}: ${p} is not there.`);
  const target = o.project ? projectOf(o.project) : o.out ? projectOf(o.out) : undefined;
  if (o.project && !fs.existsSync(target!.dir)) return stop("usage", `--project: ${target!.dir} is not there.`);
  // As the Bake tab does: a project's own loose files count as there.
  if (o.project && !from.root && fs.existsSync(target!.archive)) from.root = target!.archive;

  const bridge = new BridgeClient(exe, game);
  bridge.start();
  try {
    let t = Date.now();
    const info = await bridge.info();
    report.ms.start = Date.now() - t;
    report.redbridge = { version: info.version, exe, game: info.gameDir };
    if (!info.gameLoaded) return stop("no-game", `REDbridge did not load the game from ${game}.`);

    // Every file the scene uses, asked once.
    t = Date.now();
    const paths = [...new Map(objects.filter((x) => x.resource && (x.kind === "mesh" || x.kind === "entity")).map((x) => [collisionKey(x.resource), x.resource!.replace(/\//g, "\\")])).values()];
    const infos = new Map<string, MeshInfoResult>();
    for (let i = 0; i < paths.length; i += 200) {
      const chunk = paths.slice(i, i + 200);
      const answers = await bridge.meshInfoMany(chunk, from);
      answers.forEach((a, n) => infos.set(collisionKey(chunk[n]), a));
    }
    report.ms.files = Date.now() - t;
    report.checked = "files";
    const where = [from.archive ? path.basename(from.archive) : "", from.root ? from.root : "", "the game's archives"].filter(Boolean).join(", nor in ");
    const files = checkFiles(objects, infos, where);
    report.errors.push(...files.errors);
    report.warnings.push(...files.warnings);
    report.needs = files.needs;
    if (o.overlap !== undefined) {
      const pairs = findOverlaps(objects, (x) => x.bounds ?? infos.get(collisionKey(x.resource))?.bounds ?? undefined, o.overlap);
      report.warnings.push(...overlapFindings(pairs, objects, o.overlap));
    }
    if (removals.length && !atLeast(info.version, [0, 16, 0])) report.errors.push({ code: "redbridge-old", text: `REDbridge ${info.version} cannot bake removals: it needs 0.16.0 or later.` });
    if (report.errors.length) return report;
    if (o.command === "check") {
      report.ok = true;
      return report;
    }

    const slug = report.scene.slug!;
    const { scene: input } = bakeInput(data.name, data.game, data.groups ?? [], solidForBake(objects, files.noCollision));
    const wouldWrite = (input.objects.length ? bakeFilesOf(slug) : bakeFilesOf(slug).slice(2)).map((rel) => path.join(target!.dir, ...rel.split("/")));
    if (o.dryRun) {
      report.dryRun = true;
      report.written = wouldWrite;
      report.nodes = input.objects.length;
      report.removals = removals.length;
      report.ok = true;
      return report;
    }

    t = Date.now();
    let built: SectorBuilt;
    try {
      fs.mkdirSync(target!.dir, { recursive: true });
      built = await bridge.sectorBuild({ project: target!.dir, scene: input, ...from, ...(removals.length ? { removals } : {}) });
    } catch (err) {
      return stop("redbridge", `REDbridge refused the bake: ${(err as Error).message}`);
    }
    report.ms.bake = Date.now() - t;
    // What checkFiles already said, REDbridge says again for each object: once is enough.
    const said = /the scene's bounds are used|has no collision data|solid is for a mesh/;
    report.warnings.push(...groupBridgeWarnings(built.warnings.filter((w) => !said.test(w))));
    for (const r of built.refused ?? []) report.warnings.push({ code: "removal-refused", text: `A removal was not written (${path.win32.basename(r.sector)} entry ${r.index}): ${r.why}` });
    if (!built.xl) return stop("redbridge", "Nothing was written.");
    const xl = built.blockPath ? settleXl(built.xl, built.name, built.blockPath) : built.xl;
    const gone = (built.removed ?? []).filter((r) => !r.proxyOf).length;
    const record: BakeRecord = {
      slug: built.name,
      name: data.name,
      file,
      hash: report.scene.hash,
      objects: built.nodes,
      ...(built.removed?.length ? { removals: gone, standIns: built.removed.length - gone } : {}),
      date: new Date().toISOString(),
      bridge: info.version,
      box: built.streamingBox ?? undefined,
      needs: files.needs,
    };
    writeRecord(target!, record);
    // Baked straight into the project: no longer the copy of a Library bake, if it was one.
    if (o.project) forgetInNote(target!.dir, built.name);
    report.written = [built.sector, built.block, xl, path.join(target!.raw, "edgebuilder", `${built.name}.bake.json`)].filter((f): f is string => !!f);
    report.nodes = built.nodes;
    report.removals = gone;
    report.streamingBox = built.streamingBox;

    if (o.pack) {
      t = Date.now();
      const outDir = path.join(target!.dir, "packed", "archive", "pc", "mod");
      if (fs.existsSync(target!.archive)) {
        try {
          report.packed = await bridge.call<{ archive: string; bytes: number; files: number }>("project.pack", { dir: target!.archive, outDir, modName: slugOf(o.name ?? data.name) });
        } catch (err) {
          return stop("redbridge", `REDbridge could not pack the bake: ${(err as Error).message}`);
        }
        report.written.push(report.packed.archive);
      } else fs.mkdirSync(outDir, { recursive: true });
      // Every bake's .xl in the folder goes beside the archive, as a project's resources do.
      const xlDir = path.join(target!.resources, "archive", "pc", "mod");
      for (const name of fs.existsSync(xlDir) ? fs.readdirSync(xlDir) : []) {
        if (!name.toLowerCase().endsWith(".xl")) continue;
        fs.copyFileSync(path.join(xlDir, name), path.join(outDir, name));
        report.written.push(path.join(outDir, name));
      }
      report.ms.pack = Date.now() - t;
    }
    report.ok = true;
    return report;
  } catch (err) {
    const tail = bridge.log.slice(-6).join(" | ");
    return stop("redbridge", `REDbridge failed: ${(err as Error).message}${tail ? ` (${tail.slice(0, 600)})` : ""}`);
  } finally {
    bridge.stop();
    report.ms.total = Date.now() - started;
  }
}

/** The game's folder when nobody names it: every Steam library, then GOG's usual folders. */
function findGame(): string | undefined {
  const dirs: string[] = [];
  for (const steam of [path.join(process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)", "Steam"), path.join(process.env.ProgramFiles ?? "C:\\Program Files", "Steam")]) {
    dirs.push(path.join(steam, "steamapps", "common", "Cyberpunk 2077"));
    try {
      // libraryfolders.vdf lists each library as "path" "D:\\SteamLibrary".
      const vdf = fs.readFileSync(path.join(steam, "steamapps", "libraryfolders.vdf"), "utf8");
      for (const m of vdf.matchAll(/"path"\s+"([^"]+)"/g)) dirs.push(path.join(m[1].replace(/\\\\/g, "\\"), "steamapps", "common", "Cyberpunk 2077"));
    } catch {
      // No Steam there.
    }
  }
  for (const drive of ["C", "D", "E", "F"]) dirs.push(`${drive}:\\GOG Games\\Cyberpunk 2077`, `${drive}:\\Program Files (x86)\\GOG Galaxy\\Games\\Cyberpunk 2077`);
  return dirs.find(isGameFolder);
}

function atLeast(version: string, min: number[]): boolean {
  const v = version.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < min.length; i++) if ((v[i] ?? 0) !== min[i]) return (v[i] ?? 0) > min[i];
  return true;
}

/** The report as lines for a person. */
function textOf(r: Report): string {
  const lines: string[] = [];
  const many = (n: number, one: string, more = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : more}`;
  const s = r.scene;
  const counts = Object.entries(r.counts).map(([k, n]) => `${n.toLocaleString("en-US")} ${k}`).join(", ");
  lines.push(`${s.name ?? path.basename(s.file)}${s.format ? ` (format ${s.format})` : ""}${counts ? `: ${counts}` : ""}`);
  if (r.redbridge) lines.push(`REDbridge ${r.redbridge.version}, game in ${r.redbridge.game}`);
  const show = (title: string, list: Finding[]) => {
    if (!list.length) return;
    lines.push("", `${title}:`);
    for (const f of list) {
      const ids = f.ids ?? [];
      const pairs = f.code === "overlap" || f.code === "same-place";
      const n = pairs ? "" : ids.length > 1 ? `${ids.length.toLocaleString("en-US")} objects: ` : ids.length === 1 ? `${ids[0]}: ` : "";
      const files = f.files?.length ? `${f.files.length.toLocaleString("en-US")} file${f.files.length === 1 ? "" : "s"}, ` : "";
      lines.push(`  [${f.code}] ${f.file ? `${f.file}: ` : ""}${files}${n}${f.text}`);
      if (f.files?.length) lines.push(`      ${f.files.slice(0, 3).join(", ")}${f.files.length > 3 ? `, and ${f.files.length - 3} more` : ""}`);
      if (ids.length > 1 || (pairs && ids.length)) lines.push(`      ${ids.slice(0, 6).join(", ")}${ids.length > 6 ? `, and ${ids.length - 6} more` : ""}`);
    }
  };
  show(many(r.errors.length, "error"), r.errors);
  show(many(r.warnings.length, "kind of warning", "kinds of warning"), r.warnings);
  if (r.dropped.length) {
    lines.push("", `Left out of a bake (${r.dropped.length}):`);
    const byWhy = new Map<string, string[]>();
    for (const d of r.dropped) byWhy.set(d.why, [...(byWhy.get(d.why) ?? []), d.id]);
    for (const [why, ids] of byWhy) lines.push(`  ${ids.slice(0, 6).join(", ")}${ids.length > 6 ? `, and ${ids.length - 6} more` : ""}: ${why}`);
  }
  if (r.needs.length) lines.push("", `The game needs the mod with ${many(r.needs.length, "file")} that ${r.needs.length === 1 ? "is" : "are"} not on this PC: ${r.needs.slice(0, 4).join(", ")}${r.needs.length > 4 ? `, and ${r.needs.length - 4} more` : ""}`);
  if (r.written.length) {
    lines.push("", r.dryRun ? "A bake would write:" : "Written:");
    for (const f of r.written) lines.push(`  ${f}`);
  }
  if (r.nodes !== undefined) lines.push("", `${r.dryRun ? "Would bake" : "Baked"} ${many(r.nodes, "object")}${r.removals ? ` and ${many(r.removals, "removal")}` : ""}${r.ms.bake ? ` in ${(r.ms.bake / 1000).toFixed(1)} s` : ""}.`);
  if (r.streamingBox) lines.push(`Streaming box: ${r.streamingBox.max.map((v, i) => Math.round(v - r.streamingBox!.min[i])).join(" x ")} m.`);
  lines.push("", r.ok ? (r.command === "check" ? "Nothing stops a bake." : r.dryRun ? "Nothing was written (--dry-run)." : "Done.") : "Stopped: see the errors above.");
  return lines.join("\n");
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  if (!argv.length || argv.includes("--help") || argv.includes("-h")) {
    console.log(Usage);
    return argv.length ? 0 : 2;
  }
  if (argv.includes("--version")) {
    console.log(__VERSION__);
    return 0;
  }
  let options: Options;
  try {
    options = readArgs(argv);
  } catch (err) {
    if (!(err instanceof UsageError)) throw err;
    if (argv.includes("--json")) console.log(JSON.stringify({ edgebuilder: __VERSION__, ok: false, errors: [{ code: "usage", text: err.message }] }, null, 2));
    else console.error(`${err.message}\n\n${Usage}`);
    return 2;
  }
  const report = await run(options);
  console.log(options.json ? JSON.stringify(report, null, 2) : textOf(report));
  return report.ok ? 0 : report.errors.some((e) => e.code === "usage") ? 2 : 1;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (err) => {
    console.error(err);
    process.exitCode = 1;
  },
);
