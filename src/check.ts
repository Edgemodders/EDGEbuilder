// Checking a scene a program wrote (G1), without REDnode: the schema, what the Bake tab checks, the
// files and appearances against what REDbridge reads, and objects that overlap. The command line
// (cli.ts) prints what these find; docs/generated-scenes.md, "The command line".

import type { MeshInfoResult } from "./bridge";
import type { SceneObject, WorldEdit } from "./protocol";
import { boxOf, collisionKey } from "./arrange";
import { bakeRemovals } from "./bake";
import { knownFields, sceneSchema, validate } from "./schema";
import { refOf } from "./scenes";
import { readableEdits } from "./worldedits";

/** One thing a check found. The same finding on many objects is one Finding with their ids. */
export interface Finding {
  /** A stable word for the kind of finding, for a build script to switch on. */
  code: string;
  text: string;
  /** The game path it is about, when it is about a file. */
  file?: string;
  /** The game paths it is about, when it is one finding about many files. */
  files?: string[];
  /** The objects it is about. */
  ids?: string[];
}

/** An object or edit a bake leaves out. */
export interface Dropped {
  id: string;
  kind: string;
  why: string;
}

export interface SceneCheck {
  errors: Finding[];
  warnings: Finding[];
  dropped: Dropped[];
}

type Obj = Omit<SceneObject, "entityId">;

/** Collects findings, joining those with the same code, text and file into one with every id. */
class Findings {
  readonly list: Finding[] = [];
  private readonly byKey = new Map<string, Finding>();
  add(code: string, text: string, more: { file?: string; id?: string; among?: string } = {}): void {
    const key = `${code}\n${text}\n${more.file ?? ""}`;
    let f = this.byKey.get(key);
    if (!f) {
      f = { code, text, ...(more.file ? { file: more.file } : {}) };
      this.byKey.set(key, f);
      this.list.push(f);
    }
    if (more.id !== undefined) (f.ids ??= []).push(more.id);
    // `among`: one finding about many files, each named once.
    if (more.among !== undefined && !f.files?.includes(more.among)) (f.files ??= []).push(more.among);
  }
}

/**
 * The file on its own: the schema of its format, ids and references used twice, groups that are not
 * there, numbers that are not numbers, fields this EDGEbuilder does not read, and what a bake leaves out.
 */
export function checkSceneData(data: unknown): SceneCheck {
  const errors = new Findings();
  const warnings = new Findings();
  const dropped: Dropped[] = [];
  const done = () => ({ errors: errors.list, warnings: warnings.list, dropped });
  const d = data as { format?: unknown; name?: unknown; objects?: unknown; groups?: unknown; worldEdits?: unknown };
  if (!d || typeof d !== "object" || Array.isArray(d)) {
    errors.add("schema", "The file is not a JSON object.");
    return done();
  }
  if (d.format !== 1 && d.format !== 2 && d.format !== 3) {
    errors.add("schema", `format is ${JSON.stringify(d.format)}: this EDGEbuilder reads formats 1, 2 and 3.`);
    return done();
  }
  const objects = Array.isArray(d.objects) ? (d.objects as Obj[]) : [];
  const idAt = (path: string): string | undefined => {
    const m = /^objects\[(\d+)\]/.exec(path);
    const id = m ? objects[Number(m[1])]?.id : undefined;
    return typeof id === "string" ? id : undefined;
  };
  for (const e of validate(sceneSchema(d.format), data)) {
    const id = idAt(e.path);
    // With an id, the path's index goes: the same fault on a thousand objects is then one finding.
    errors.add("schema", id ? `${e.path.replace(/^objects\[\d+\]\.?/, "") || "The object"} ${e.text}` : `${e.path} ${e.text}`, { id });
  }
  if (errors.list.length) return done();

  const known = knownFields(d.format);
  for (const key of Object.keys(d)) if (!known.top.includes(key)) warnings.add("unknown-field", `${key} (top level) is not a field of format ${d.format}: EDGEbuilder does not read it, and drops it when it saves the scene.`);
  const groups = new Set((Array.isArray(d.groups) ? (d.groups as { id: string }[]) : []).map((g) => g.id));
  const ids = new Set<string>();
  const refs = new Map<string, string>();
  const name = String(d.name);
  for (const o of objects) {
    for (const key of Object.keys(o)) if (!known.object.includes(key)) warnings.add("unknown-field", `${key} is not a field of an object in format ${d.format}: EDGEbuilder does not read it. A writer's own data goes in meta.`, { id: o.id });
    if (ids.has(o.id)) errors.add("duplicate-id", "Two objects have this id.", { id: o.id });
    ids.add(o.id);
    const ref = refOf(name, o);
    const other = refs.get(ref);
    if (other !== undefined && other !== o.id) errors.add("duplicate-ref", `The reference ${ref} is used twice.`, { id: o.id });
    refs.set(ref, o.id);
    if (o.group !== undefined && !groups.has(o.group)) warnings.add("unknown-group", `The group ${o.group} is not in groups: its objects stand on their own.`, { id: o.id });
    const numbers = [...o.transform.position, ...o.transform.rotation, ...o.transform.scale];
    if (numbers.some((n) => !Number.isFinite(n))) errors.add("bad-number", "A position, turn or scale is not a number.", { id: o.id });
    const q = o.transform.rotation;
    const length = Math.hypot(q[0], q[1], q[2], q[3]);
    if (Math.abs(length - 1) > 0.01) warnings.add("rotation-length", "The rotation is not a unit quaternion (its length is not 1): the object may bake skewed or scaled.", { id: o.id });
    if (o.solid && o.kind !== "mesh") warnings.add("solid-not-mesh", `solid is for a mesh: a ${o.kind}'s collision comes from what it is made of.`, { id: o.id });
    if (o.kind === "npc") dropped.push({ id: o.id, kind: "npc", why: "A bake cannot place people: they show only while EDGEbuilder or another package loads the scene." });
  }
  const edits = readableEdits(d.worldEdits);
  const { unnamed } = bakeRemovals(edits);
  for (const e of edits) if (e.action === "door") dropped.push({ id: e.id, kind: "door state", why: "A bake cannot set a door's state: EDGEbuilder keeps it in the running game." });
  for (const e of unnamed) dropped.push({ id: e.id, kind: "removal", why: "Its sector has no name, so the bake cannot find the entry." });
  const baked = objects.filter((o) => o.kind !== "npc").length + edits.filter((e) => e.action === "remove").length - unnamed.length;
  if (!baked) errors.add("nothing-to-bake", "The scene has nothing a bake can write.");
  return done();
}

/** How a path is compared: backslashes, lowercase. */
const pathKey = collisionKey;

/**
 * The scene's files against what REDbridge found (`mesh.infoMany`, by path): files that are not there,
 * appearances a file does not have, and solid meshes without collision data. `where` names where
 * REDbridge looked, for the texts.
 */
export function checkFiles(objects: Obj[], infos: Map<string, MeshInfoResult>, where: string): { errors: Finding[]; warnings: Finding[]; needs: string[]; noCollision: Set<string> } {
  const errors = new Findings();
  const warnings = new Findings();
  const needs = new Set<string>();
  const noCollision = new Set<string>();
  for (const o of objects) {
    if (!o.resource || o.kind === "npc" || o.kind === "light") continue;
    const info = infos.get(pathKey(o.resource));
    if (!info) continue;
    if (info.error) {
      const missing = /not in |not found|no such/i.test(info.error);
      if (!missing) {
        warnings.add("file-unread", `REDbridge could not read it: ${info.error}`, { file: o.resource, id: o.id });
        continue;
      }
      needs.add(o.resource.replace(/\//g, "\\"));
      if (o.bounds) warnings.add("file-not-here", `Not in ${where}. The scene's bounds are used, and the game needs the mod that has the files.`, { among: o.resource, id: o.id });
      else errors.add("file-missing", `Not in ${where}, and the objects have no bounds. Give each object its bounds, or name the mod's archive (--archive) or folder of loose files (--root).`, { among: o.resource, id: o.id });
      continue;
    }
    const wanted = o.appearance;
    if (wanted && wanted !== "default" && info.appearances.length && !info.appearances.includes(wanted)) {
      const have = info.appearances.slice(0, 8).join(", ") + (info.appearances.length > 8 ? `, and ${info.appearances.length - 8} more` : "");
      warnings.add("appearance", `It has no appearance ${wanted}. It has: ${have}.`, { file: o.resource, id: o.id });
    }
    if (o.kind === "mesh" && o.solid && info.hasCollision === false) {
      noCollision.add(pathKey(o.resource));
      warnings.add("no-collision", "It has no collision data, so V walks through it: it is baked to draw only.", { file: o.resource, id: o.id });
    }
  }
  return { errors: errors.list, warnings: warnings.list, needs: [...needs].sort(), noCollision };
}

export interface Overlap {
  a: string;
  b: string;
  /** How much of the space the two boxes cover is covered by both, 0 to 1: 1 is the same box. */
  share: number;
}

/**
 * Pairs of objects whose boxes are nearly the same box: the part both cover is `share` or more of what
 * the two cover together. A prop inside a room's box scores low, as it should. Each object's box is the
 * world box around its turned and scaled bounds, so it is exact for objects that are not turned and
 * generous for those that are. Objects without bounds (lights, files not read) are left out.
 */
export function findOverlaps(objects: Obj[], boundsOf: (o: Obj) => { min: number[]; max: number[] } | undefined, share: number): Overlap[] {
  const Thin = 0.01; // a flat object still has a box to overlap with
  const boxes: { id: string; min: number[]; max: number[]; volume: number }[] = [];
  for (const o of objects) {
    if (o.kind === "light" || o.kind === "npc") continue;
    const bounds = boundsOf(o);
    if (!bounds) continue;
    const box = boxOf([{ ...o, bounds } as SceneObject]);
    if (!box) continue;
    const size = [0, 1, 2].map((i) => Math.max(box.max[i] - box.min[i], Thin));
    boxes.push({ id: o.id, min: box.min, max: box.min.map((v, i) => v + size[i]), volume: size[0] * size[1] * size[2] });
  }
  boxes.sort((a, b) => a.min[0] - b.min[0]);
  const out: Overlap[] = [];
  for (let i = 0; i < boxes.length; i++) {
    const a = boxes[i];
    for (let j = i + 1; j < boxes.length && boxes[j].min[0] < a.max[0]; j++) {
      const b = boxes[j];
      let inside = 1;
      for (let k = 0; k < 3 && inside > 0; k++) inside *= Math.max(0, Math.min(a.max[k], b.max[k]) - Math.max(a.min[k], b.min[k]));
      const s = inside / (a.volume + b.volume - inside);
      if (s >= share) out.push({ a: a.id, b: b.id, share: Math.round(s * 1000) / 1000 });
    }
  }
  return out.sort((x, y) => y.share - x.share);
}

/** Overlaps as findings: same-place twins (the same file, the same box) apart from the rest. */
export function overlapFindings(pairs: Overlap[], objects: Obj[], share: number): Finding[] {
  const byId = new Map(objects.map((o) => [o.id, o]));
  const same = (p: Overlap) => {
    const a = byId.get(p.a);
    const b = byId.get(p.b);
    return !!a && !!b && pathKey(a.resource) === pathKey(b.resource) && JSON.stringify(a.transform) === JSON.stringify(b.transform);
  };
  const out: Finding[] = [];
  const twins = pairs.filter(same);
  const rest = pairs.filter((p) => !same(p));
  if (twins.length) out.push({ code: "same-place", text: `${twins.length === 1 ? "Two objects are" : `${twins.length} pairs of objects are`} the same file at the same place, turn and scale: one of each pair is likely not meant.`, ids: twins.map((p) => `${p.a} = ${p.b}`) });
  if (rest.length) out.push({ code: "overlap", text: `${rest.length === 1 ? "Two objects fill" : `${rest.length} pairs of objects fill`} nearly the same box (${Math.round(share * 100)} % or more of it is shared).`, ids: rest.map((p) => `${p.a} + ${p.b} (${Math.round(p.share * 100)} %)`) });
  return out;
}

/**
 * REDbridge's warnings, grouped: the same sentence about many objects or files becomes one finding.
 * Quoted names and "object N (id)" labels are taken out of the sentence and kept as the ids.
 */
export function groupBridgeWarnings(lines: string[]): Finding[] {
  const out = new Findings();
  for (const line of lines) {
    const label = /^object (?:\d+ \(([^)]*)\)|'([^']*)'):\s*/.exec(line);
    const id = label ? (label[1] ?? label[2]) : undefined;
    let text = label ? line.slice(label[0].length) : line;
    const file = /'([^']+\.[a-z0-9]+)'/i.exec(text)?.[1] ?? /^([^\s:']+\.[a-z0-9]+):\s/i.exec(text)?.[1];
    if (file) text = text.replace(`'${file}'`, "the file").replace(new RegExp(`^${file.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:\\s*`), "");
    out.add("redbridge", text.charAt(0).toUpperCase() + text.slice(1), { file, id });
  }
  return out.list;
}

/** The world edits of a scene file that a bake writes, as `bakeHash` and `bakeRemovals` take them. */
export function editsOf(data: { worldEdits?: unknown }): WorldEdit[] {
  return readableEdits(data.worldEdits);
}
