// The Bake behaviour, without REDnode: what goes into REDbridge's sector.build, what is checked first,
// and the bakes a project holds and the game has. docs/design.md, "Baking", and docs/testing.md, "B4 Bake".

import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import type { BakeCheck, BakeRecord, SceneGroup, SceneObject } from "./protocol";
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

/** What changes a bake's result, and nothing else: moving a group in the tree or a preview coming and going does not. */
export function bakeHash(objects: SceneObject[]): string {
  const parts = objects
    .filter((o) => Bakeable.has(o.kind))
    .map((o) => [o.id, o.kind, o.resource ?? "", o.appearance ?? "", o.transform, o.streaming ?? null, o.ref ?? "", o.props ?? null]);
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
  if (scene.objects.some((o) => o.kind === "mesh")) say("info", "Meshes bake without collision for now: V walks through them. Entities keep theirs.");
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

/** The bakes in the game, by slug: every `.xl` in archive\pc\mod that adds an EDGEbuilder streaming block. */
export function deployedBakes(gameDir: string | undefined): Map<string, string> {
  const found = new Map<string, string>();
  if (!gameDir) return found;
  const dir = path.join(gameDir, "archive", "pc", "mod");
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return found;
  }
  for (const name of names) {
    if (!name.toLowerCase().endsWith(".xl")) continue;
    let text = "";
    try {
      text = fs.readFileSync(path.join(dir, name), "utf8");
    } catch {
      continue;
    }
    for (const m of text.matchAll(/edgebuilder[\\/]([a-z0-9_]+)[\\/]\1\.streamingblock/gi)) found.set(m[1].toLowerCase(), name);
  }
  return found;
}
