// The Bake behaviour, without REDnode: what goes into REDbridge's sector.build, what is checked first,
// and the bakes a project holds and the game has. docs/design.md, "Baking", and docs/testing.md, "B4 Bake".

import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import type { BakeCheck, BakeRecord, SceneGroup, SceneObject } from "./protocol";
import { collisionKey } from "./arrange";
import { slugOf } from "./scenes";

/** The folders of a REDcode project a bake uses. */
export interface BakeProject {
  name: string;
  dir: string;
  archive: string;
  raw: string;
  resources: string;
}

/** The kinds sector.build can write. Anything else stays out of the bake, and the panel says so. */
const Bakeable = new Set(["mesh", "entity", "light"]);

/** A scene as sector.build reads it: format 1, no previews, and without what it cannot make. */
export function bakeInput(name: string, game: string | undefined, groups: SceneGroup[], objects: SceneObject[]) {
  const kept = objects.filter((o) => Bakeable.has(o.kind));
  return {
    scene: {
      format: 1 as const,
      name,
      ...(game ? { game } : {}),
      groups,
      objects: kept.map(({ entityId: _entityId, ...o }) => o),
    },
    skipped: objects.filter((o) => !Bakeable.has(o.kind)).map((o) => ({ id: o.id, kind: o.kind as string })),
  };
}

/**
 * The meshes a bake can make solid: `solid`, and not known to have no collision data. REDbridge would write
 * those anyway, with a warning, as a node that only draws; the Bake tab has already named them.
 */
export function solidForBake<T extends { kind: string; resource?: string; solid?: boolean }>(objects: T[], noCollision: ReadonlySet<string>): T[] {
  return objects.map((o) => {
    if (!o.solid || !noCollision.has(collisionKey(o.resource))) return o;
    const { solid: _solid, ...rest } = o;
    return rest as T;
  });
}

/** Whether a version is `min` or later, numbers compared one by one. Unknown counts as later: REDbridge itself warns. */
function atLeast(version: string | undefined, min: number[]): boolean {
  if (!version) return true;
  const v = version.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < min.length; i++) if ((v[i] ?? 0) !== min[i]) return (v[i] ?? 0) > min[i];
  return true;
}

/**
 * What changes a bake's result, and nothing else: moving a group in the tree or a preview coming and going does not.
 * `solid` joins only when set, so a bake from before the Solid switch does not read as changed.
 */
export function bakeHash(objects: SceneObject[]): string {
  const parts = objects
    .filter((o) => Bakeable.has(o.kind))
    .map((o) => [o.id, o.kind, o.resource ?? "", o.appearance ?? "", o.transform, o.streaming ?? null, o.ref ?? "", o.props ?? null, ...(o.kind === "mesh" && o.solid ? ["solid"] : [])]);
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 16);
}

/** What the panel says before a bake. A check with tone "error" stops it. */
export function checkBake(input: {
  /** The open scene's file: empty when no scene is open. */
  file: string;
  name: string;
  objects: SceneObject[];
  project: BakeProject | null;
  bridgeReady: boolean;
  /** The mods and the project whose files the scene uses. */
  needs: string[];
  /** A bake with this scene's file name in the project, that came from another scene. */
  sameNameFrom?: string;
  /** The meshes known to have no collision data: `collisionKey` of each. */
  noCollision?: ReadonlySet<string>;
  /** REDbridge's version: before 0.12.0 it writes no solid meshes, before 0.12.1 no hide distance from Seen from. */
  bridgeVersion?: string;
}): BakeCheck[] {
  const out: BakeCheck[] = [];
  const say = (tone: BakeCheck["tone"], text: string) => out.push({ tone, text });
  if (!input.file) {
    say("error", "No scene is open: open one or make one on the Library tab.");
    return out;
  }
  const { skipped, scene } = bakeInput(input.name, undefined, [], input.objects);
  if (!scene.objects.length) say("error", "The scene has nothing to bake yet.");
  if (!input.project) say("error", "No REDcode project is open. A bake goes into a project: open or make one in REDcode (VS Code), and this tab picks it up.");
  if (!input.bridgeReady) say("error", "REDbridge is not ready, and it writes the bake. The pills at the top say why.");
  const ids = new Set<string>();
  for (const o of scene.objects) {
    if (o.kind !== "light" && !o.resource) say("error", `${o.id} has no resource.`);
    if (ids.has(o.id)) say("error", `Two objects are called ${o.id}.`);
    ids.add(o.id);
    const numbers = [...o.transform.position, ...o.transform.rotation, ...o.transform.scale];
    if (numbers.some((n) => !Number.isFinite(n))) say("error", `${o.id} has a position, turn or scale that is not a number.`);
  }
  if (skipped.length) say("warn", `Left out, since a bake cannot make them yet: ${skipped.map((s) => s.id).join(", ")}.`);
  if (input.sameNameFrom) say("warn", `This project has a bake with this name, from ${input.sameNameFrom}. Baking replaces it. A different name keeps both.`);
  if (input.needs.length) say("warn", `Anyone playing this bake needs: ${input.needs.join(", ")}.`);
  const meshes = scene.objects.filter((o) => o.kind === "mesh");
  const noData = meshes.filter((o) => o.solid && input.noCollision?.has(collisionKey(o.resource)));
  const solid = meshes.filter((o) => o.solid && !noData.includes(o));
  const plain = meshes.length - solid.length - noData.length;
  if (noData.length) {
    const names = [...new Set(noData.map((o) => path.win32.basename(o.resource ?? o.id)))];
    say("warn", `${noData.length === 1 ? "A mesh has" : `${noData.length} meshes have`} no collision data, so V walks through ${noData.length === 1 ? "it" : "them"}: ${names.slice(0, 5).join(", ")}${names.length > 5 ? ` and ${names.length - 5} more` : ""}. An entity with a collider can stand in.`);
  }
  if (solid.length && !atLeast(input.bridgeVersion, [0, 12, 0])) say("warn", `REDbridge ${input.bridgeVersion} writes no solid meshes: V walks through all of them. Update it to 0.12.0 or later (EDGEdeck: Get REDbridge).`);
  const seenFar = meshes.filter((o) => o.streaming);
  if (seenFar.length && !atLeast(input.bridgeVersion, [0, 12, 1])) say("warn", `REDbridge ${input.bridgeVersion} does not pass Seen from on to the game's own hide distance: ${seenFar.length === 1 ? "a mesh with Seen from shows" : `${seenFar.length} meshes with Seen from show`} only as far as the game allows for ${seenFar.length === 1 ? "its" : "their"} size (about 60 m for a crate). Update it to 0.12.1 or later (EDGEdeck: Get REDbridge).`);
  if (plain) say("info", `${plain} mesh${plain === 1 ? " is" : "es are"} set not solid: V walks through ${plain === 1 ? "it" : "them"}. The Solid switch on the Scene tab changes that.`);
  if (solid.length) say("info", `${solid.length} mesh${solid.length === 1 ? "" : "es"} will stop V, bullets and cars. Entities keep their own collision.`);
  return out;
}

/** A sector.build's `.xl` in ArchiveXL's `streaming: blocks:` form, beside `<slug>.archive`. REDbridge before 0.12.0 writes a resource patch. */
export function settleXl(xlFile: string, slug: string, blockPath: string): string {
  const text = fs.readFileSync(xlFile, "utf8");
  if (/^streaming:/m.test(text)) return xlFile;
  const file = path.join(path.dirname(xlFile), `${slug}.archive.xl`);
  fs.writeFileSync(file, `# Written by EDGEbuilder: adds the baked sector to the world.\nstreaming:\n  blocks:\n    - ${blockPath}\n`);
  if (path.resolve(file) !== path.resolve(xlFile)) fs.rmSync(xlFile, { force: true });
  return file;
}

const recordFile = (project: BakeProject, slug: string) => path.join(project.raw, "edgebuilder", `${slug}.bake.json`);

/** What a bake came from, kept in the project's source/raw, which is not packed. */
export function writeRecord(project: BakeProject, record: BakeRecord): void {
  const file = recordFile(project, record.slug);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(record, null, 2));
}

/** The bakes in a project: every folder under source/archive/edgebuilder with a sector, and what its record says. */
export function bakesIn(project: BakeProject | null): BakeRecord[] {
  if (!project) return [];
  const root = path.join(project.archive, "edgebuilder");
  let names: string[];
  try {
    names = fs.readdirSync(root);
  } catch {
    return [];
  }
  const out: BakeRecord[] = [];
  for (const slug of names) {
    if (!fs.existsSync(path.join(root, slug, `${slug}.streamingsector`))) continue;
    let record: BakeRecord = { slug, name: slug };
    try {
      record = { ...record, ...(JSON.parse(fs.readFileSync(recordFile(project, slug), "utf8")) as BakeRecord) };
    } catch {
      // Baked by something else, or the record is gone: the sector is still there.
    }
    out.push(record);
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Takes a bake out of a project: its sector and block, its `.xl` and its record. The scene is untouched. */
export function removeBake(project: BakeProject, slug: string): void {
  if (slugOf(slug) !== slug) throw new Error(`${slug} is not a bake's name`);
  fs.rmSync(path.join(project.archive, "edgebuilder", slug), { recursive: true, force: true });
  for (const name of [`${slug}.archive.xl`, `${slug}.xl`]) fs.rmSync(path.join(project.resources, "archive", "pc", "mod", name), { force: true });
  fs.rmSync(recordFile(project, slug), { force: true });
}

/**
 * The bakes in the game, by slug: every `.xl` that adds an EDGEbuilder streaming block, in archive\pc\mod
 * and in each REDmod's archives folder, where REDcode's pack puts it with `redcode.pack.redmod` on.
 */
export function deployedBakes(gameDir: string | undefined): Map<string, string> {
  const found = new Map<string, string>();
  if (!gameDir) return found;
  const redmods = path.join(gameDir, "mods");
  const dirs = [path.join(gameDir, "archive", "pc", "mod"), ...namesIn(redmods).map((m) => path.join(redmods, m, "archives"))];
  for (const dir of dirs) {
    for (const name of namesIn(dir)) {
      if (!name.toLowerCase().endsWith(".xl")) continue;
      let text = "";
      try {
        text = fs.readFileSync(path.join(dir, name), "utf8");
      } catch {
        continue;
      }
      for (const m of text.matchAll(/edgebuilder[\\/]([a-z0-9_]+)[\\/]\1\.streamingblock/gi)) found.set(m[1].toLowerCase(), name);
    }
  }
  return found;
}

function namesIn(dir: string): string[] {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

// ---- Library bakes (B4-3) ------------------------------------------------------------------------------
//
// A bake in the Library is a folder `<name>.bake`, laid out like a small project: each of its scenes is
// baked into it exactly as into a project (source/archive/edgebuilder/<slug>/, the `.xl`, the record),
// with `bake.json` on top. Include in project copies those files over and notes them in the project's
// came-from note, `source/library.json` (docs/library.md, "Shared rules"). The scenes stay in the Library.

export const BakeFolderEnding = ".bake";

/** `bake.json`: what a Library bake is made of. `id` is made once; `version` goes up with each change. */
export interface BakeMeta {
  format: 1;
  id: string;
  name: string;
  version: number;
  date?: string;
  game?: string;
  bridge?: string;
  /** Each scene: its name and slug when baked, where it is under the Library root (with `/`), and `bakeHash` then. */
  scenes: { name: string; slug: string; path: string; hash?: string }[];
}

/** The folders of a Library bake, in a project's shape, so a project bake's code bakes into it as it is. */
export function bakeFolderProject(dir: string): BakeProject {
  const source = path.join(dir, "source");
  return { name: path.basename(dir).replace(/\.bake$/i, ""), dir, archive: path.join(source, "archive"), raw: path.join(source, "raw"), resources: path.join(source, "resources") };
}

export function newBakeId(): string {
  return createHash("sha256").update(`${Date.now()}-${Math.random()}-${process.pid}`).digest("hex").slice(0, 16);
}

export function readBakeMeta(dir: string): BakeMeta {
  const data = JSON.parse(fs.readFileSync(path.join(dir, "bake.json"), "utf8")) as BakeMeta;
  if (data.format !== 1 || typeof data.id !== "string" || !Array.isArray(data.scenes)) throw new Error("not an EDGEbuilder bake");
  return data;
}

export function writeBakeMeta(dir: string, meta: BakeMeta): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "bake.json"), JSON.stringify(meta, null, 2));
}

/** A folder for a new bake in `parent` that no bake there has yet: `name.bake`, `name_2.bake`, ... */
export function freeBakeDir(parent: string, name: string): string {
  const base = slugOf(name);
  for (let n = 1; ; n++) {
    const dir = path.join(parent, `${base}${n === 1 ? "" : `_${n}`}${BakeFolderEnding}`);
    if (!fs.existsSync(dir)) return dir;
  }
}

/** A path under the Library root with `/`, as the shared rules keep paths; the file itself when it is outside. */
export function libraryPath(root: string, file: string): string {
  const rel = path.relative(root, file);
  return rel.startsWith("..") || path.isAbsolute(rel) ? file : rel.replace(/\\/g, "/");
}

export function fromLibraryPath(root: string, p: string): string {
  return path.isAbsolute(p) ? p : path.join(root, ...p.split("/"));
}

/** Every `.bake` folder under the Library root, with its folder there and what its `bake.json` says. */
export function scanBakes(root: string | undefined): { dir: string; folder: string; meta?: BakeMeta; error?: string }[] {
  const out: { dir: string; folder: string; meta?: BakeMeta; error?: string }[] = [];
  if (!root) return out;
  const walk = (dir: string, rel: string, depth: number) => {
    let names: fs.Dirent[];
    try {
      names = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const d of names) {
      if (!d.isDirectory() || d.name.startsWith(".") || d.name === "node_modules") continue;
      const full = path.join(dir, d.name);
      if (d.name.toLowerCase().endsWith(BakeFolderEnding)) {
        try {
          out.push({ dir: full, folder: rel, meta: readBakeMeta(full) });
        } catch (err) {
          out.push({ dir: full, folder: rel, error: (err as Error).message });
        }
      } else if (depth < 8) walk(full, rel ? `${rel}/${d.name}` : d.name, depth + 1);
    }
  };
  walk(root, "", 0);
  return out.sort((a, b) => a.dir.localeCompare(b.dir));
}

/** The files one scene's bake has, relative to a project-shaped folder, with `/`. */
export function bakeFilesOf(slug: string): string[] {
  return [
    `source/archive/edgebuilder/${slug}/${slug}.streamingsector`,
    `source/archive/edgebuilder/${slug}/${slug}.streamingblock`,
    `source/resources/archive/pc/mod/${slug}.archive.xl`,
    `source/raw/edgebuilder/${slug}.bake.json`,
  ];
}

// ---- the came-from note -------------------------------------------------------------------------------

/** One item of a project's `source/library.json`. Other tools' items are kept as they are. */
export interface NoteItem {
  id?: string;
  kind: string;
  path: string;
  version?: number;
  hash?: string;
  added: string;
  by: string;
  files: string[];
  [more: string]: unknown;
}

const noteFile = (projectDir: string) => path.join(projectDir, "source", "library.json");

export function readNote(projectDir: string): { format: 1; items: NoteItem[] } {
  try {
    const data = JSON.parse(fs.readFileSync(noteFile(projectDir), "utf8"));
    if (Array.isArray(data?.items)) return { ...data, format: 1, items: data.items };
  } catch {
    // None yet, or not readable: a new one is written.
  }
  return { format: 1, items: [] };
}

function writeNote(projectDir: string, note: { format: 1; items: NoteItem[] }): void {
  fs.mkdirSync(path.dirname(noteFile(projectDir)), { recursive: true });
  fs.writeFileSync(noteFile(projectDir), JSON.stringify(note, null, 2));
}

/** The project's bakes that came from the Library, by slug: the bake's id, version and Library path. */
export function libraryBakesIn(projectDir: string): Map<string, { id: string; version?: number; path: string }> {
  const out = new Map<string, { id: string; version?: number; path: string }>();
  for (const item of readNote(projectDir).items) {
    if (item.by !== "edgebuilder" || item.kind !== "bake" || !item.id) continue;
    for (const f of item.files) {
      const m = /^source\/archive\/edgebuilder\/([^/]+)\//.exec(f);
      if (m) out.set(m[1], { id: item.id, version: item.version, path: item.path });
    }
  }
  return out;
}

/**
 * The project's bakes a Library bake would replace that are not from it: baked straight into the project,
 * or from another Library bake. Include in project stops on these.
 */
export function includeClashes(project: BakeProject, meta: BakeMeta): string[] {
  const fromLibrary = libraryBakesIn(project.dir);
  const have = new Set(bakesIn(project).map((b) => b.slug));
  return meta.scenes.map((s) => s.slug).filter((slug) => have.has(slug) && fromLibrary.get(slug)?.id !== meta.id);
}

/**
 * Include in project: copies a Library bake's files into the project, takes out what an older version of
 * it had and this one has not, and notes it in `source/library.json`. Returns the files copied.
 */
export function includeBake(dir: string, meta: BakeMeta, project: BakeProject, libraryRoot: string): string[] {
  const note = readNote(project.dir);
  const before = note.items.find((i) => i.by === "edgebuilder" && i.kind === "bake" && i.id === meta.id);
  const files: string[] = [];
  for (const s of meta.scenes) {
    for (const rel of bakeFilesOf(s.slug)) {
      const from = path.join(dir, ...rel.split("/"));
      if (!fs.existsSync(from)) continue;
      const to = path.join(project.dir, ...rel.split("/"));
      fs.mkdirSync(path.dirname(to), { recursive: true });
      if (rel.endsWith(".bake.json")) {
        // The record says where it came from, for the Bake tab.
        const record = JSON.parse(fs.readFileSync(from, "utf8")) as BakeRecord;
        fs.writeFileSync(to, JSON.stringify({ ...record, library: { id: meta.id, name: meta.name, version: meta.version } }, null, 2));
      } else fs.copyFileSync(from, to);
      files.push(rel);
    }
  }
  // What the older version had and this one has not: a scene taken out of the bake since.
  for (const old of before?.files ?? []) {
    if (files.includes(old) || !/^source\/(archive\/edgebuilder|resources\/archive\/pc\/mod|raw\/edgebuilder)\//.test(old)) continue;
    const file = path.join(project.dir, ...old.split("/"));
    fs.rmSync(file, { force: true });
    if (/^source\/archive\/edgebuilder\/[^/]+\//.test(old)) {
      try {
        fs.rmdirSync(path.dirname(file));
      } catch {
        // Not empty yet, or gone already.
      }
    }
  }
  const item: NoteItem = { id: meta.id, kind: "bake", path: libraryPath(libraryRoot, dir), version: meta.version, added: new Date().toISOString(), by: "edgebuilder", files };
  note.items = [...note.items.filter((i) => i !== before), item];
  writeNote(project.dir, note);
  return files;
}

/** A bake taken out of the project: its files leave the came-from note, and an item with none left goes. */
export function forgetInNote(projectDir: string, slug: string): void {
  const note = readNote(projectDir);
  const mine = new Set(bakeFilesOf(slug));
  let changed = false;
  note.items = note.items.flatMap((i) => {
    if (i.by !== "edgebuilder" || i.kind !== "bake" || !i.files.some((f) => mine.has(f))) return [i];
    changed = true;
    const files = i.files.filter((f) => !mine.has(f));
    return files.length ? [{ ...i, files }] : [];
  });
  if (changed) writeNote(projectDir, note);
}
