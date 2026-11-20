// World edits (D1): the game's own objects a scene changes, here removals of doors, painted-on doors and
// meshes. REDnode-free, so the smoke test runs it. The mod finds the objects through REDnode (world.near
// for doors, the world node registry for their nodes and for meshes) and hides them live with
// world.setVisible; the bake (D1b) writes them as ArchiveXL node deletions. See docs/world-objects.md,
// "Doors first", and D0's answers there.

import type { WorldEdit, WorldKind, WorldNodeRef } from "./protocol";

/** The game classes of interactive doors (shutter windows among them: they are `Door`s), from D0. */
export const DoorClasses = new Set(["Door", "BunkerDoor", "MovableWallScreen", "Window"]);

/** The node classes a mesh pick looks at: static meshes, as REDnode's registry knows them. */
export const MeshNodeKinds = ["worldMeshNode", "worldInstancedMeshNode", "worldCookedStaticMeshNode", "worldStaticMeshNode", "worldBendedMeshNode", "worldFoliageNode"];

/** Which kind of the picker's list a game class is, or none. */
export function kindOfClass(type: string): WorldKind | undefined {
  if (type === "FakeDoor") return "fakeDoor";
  if (DoorClasses.has(type) || /door/i.test(type)) return "door";
  return undefined;
}

/** What each kind is called on the World tab. */
export const KindLabels: Record<WorldKind, string> = { door: "Doors", fakeDoor: "Painted-on doors", mesh: "Meshes" };

/** The kinds a new player starts with: the doors. A click on a wall would pick a mesh, so meshes start off. */
export const DefaultKinds: WorldKind[] = ["door", "fakeDoor"];

/** The id REDnode's world node registry gives a node: `0x<sector path hash>:<node data entry>`. */
export function registryId(n: Pick<WorldNodeRef, "sectorHash" | "entry">): string {
  return `${n.sectorHash}:${n.entry}`;
}

/** A 64-bit id as a decimal string, from decimal, `0x` hex or a number; null when it is none. */
export function idText(id: unknown): string | null {
  if (id === null || id === undefined || id === "") return null;
  try {
    const n = BigInt(id as string | number);
    return n === 0n ? null : n.toString();
  } catch {
    return null;
  }
}

/** Whether two 64-bit ids are the same, whatever form each is in. */
export function sameId(a: unknown, b: unknown): boolean {
  const x = idText(a);
  return x !== null && x === idText(b);
}

/**
 * What the panel warns about before a removal: a door a quest addresses (a `q001_`-like part in its
 * node's reference, as V's door had), or a node in one of the game's quest sectors.
 */
export function questWarnings(ref: string | undefined, sector: string | undefined): string[] {
  const out: string[] = [];
  if (ref && /(^|[\\/#{_])(q|sq|mq|ep1_|mws_)\d{2,3}_/i.test(ref)) out.push("A quest addresses this object (its reference names a quest): removing it may break that mission or open unfinished space.");
  if (sector && /\\quest_[0-9a-f]+\.streamingsector$/i.test(sector)) out.push("It is in one of the game's quest sectors, which quests switch on and off: removing it may change a mission.");
  return out;
}

type V3 = [number, number, number];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

/**
 * The closest approach between a ray (origin, unit direction) and a segment from `a` to `b`: how far
 * apart they come, and how far along the ray. For a click near a door: a door's place is its pivot at
 * the floor, so the segment runs up through it.
 */
export function rayToSegment(origin: V3, dir: V3, a: V3, b: V3): { gap: number; along: number } {
  const u = dir;
  const v = sub(b, a);
  const w = sub(origin, a);
  const uu = dot(u, u);
  const uv = dot(u, v);
  const vv = dot(v, v);
  const uw = dot(u, w);
  const vw = dot(v, w);
  const d = uu * vv - uv * uv;
  // The segment's point nearest the ray's line, kept on the segment; then the ray's point nearest that.
  const t = Math.max(0, Math.min(1, d > 1e-9 ? (uu * vw - uv * uw) / d : vv > 0 ? vw / vv : 0));
  const s = Math.max(0, dot(sub(add(a, scale(v, t)), origin), u) / uu);
  const p = add(origin, scale(u, s));
  const q = add(a, scale(v, t));
  return { gap: Math.hypot(...sub(p, q)), along: s };
}
function add(a: V3, b: V3): V3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}
function scale(a: V3, k: number): V3 {
  return [a[0] * k, a[1] * k, a[2] * k];
}

/** How tall a door is taken to be above its pivot, and how far from that line a click still picks it. */
export const DoorHeight = 2.2;
export const DoorReach = 0.8;

/**
 * The door a click means: the first the line reaches, among those whose line comes within `DoorReach`
 * of the ray and no further along than the first solid surface (plus a little: a door is in a wall's
 * opening). Two about as far along: the one nearer the line.
 */
export function doorUnderRay<T extends { position: V3 }>(origin: V3, dir: V3, doors: T[], wallAt: number | undefined): T | undefined {
  let best: { door: T; gap: number; along: number } | undefined;
  for (const door of doors) {
    const top: V3 = [door.position[0], door.position[1], door.position[2] + DoorHeight];
    const r = rayToSegment(origin, dir, door.position, top);
    if (r.gap > DoorReach || r.along <= 0) continue;
    if (wallAt !== undefined && r.along > wallAt + 0.75) continue;
    const better = !best || r.along < best.along - 0.5 || (Math.abs(r.along - best.along) <= 0.5 && r.gap < best.gap);
    if (better) best = { door, ...r };
  }
  return best?.door;
}

/** A new edit's id: its label's file name, made unique among the scene's edits. */
export function editId(label: string, edits: WorldEdit[]): string {
  const base =
    (label.match(/([a-z0-9_]+)\.(ent|mesh)\b/i)?.[1] ?? label)
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40) || "edit";
  const taken = new Set(edits.map((e) => e.id));
  let id = `remove_${base}`;
  for (let n = 2; taken.has(id); n++) id = `remove_${base}_${n}`;
  return id;
}

/** The edit that already removes this node, if any. */
export function editFor(edits: WorldEdit[], node: Pick<WorldNodeRef, "sectorHash" | "entry">): WorldEdit | undefined {
  return edits.find((e) => e.node.sectorHash.toLowerCase() === node.sectorHash.toLowerCase() && e.node.entry === node.entry);
}

/** What changes between two lists of edits: the removals to hide (new) and to show again (gone). */
export function editsDiff(before: WorldEdit[], after: WorldEdit[]): { hide: WorldEdit[]; show: WorldEdit[] } {
  const key = (e: WorldEdit) => `${e.action}|${registryId(e.node).toLowerCase()}`;
  const was = new Set(before.map(key));
  const now = new Set(after.map(key));
  return { hide: after.filter((e) => !was.has(key(e))), show: before.filter((e) => !now.has(key(e))) };
}

/** Whether a scene file's edits are ones this version reads: removals with a node to name. */
export function readableEdits(edits: unknown): WorldEdit[] {
  if (!Array.isArray(edits)) return [];
  return edits.filter((e): e is WorldEdit => !!e && typeof e === "object" && (e as WorldEdit).action === "remove" && typeof (e as WorldEdit).node?.sectorHash === "string" && Number.isInteger((e as WorldEdit).node?.entry));
}
