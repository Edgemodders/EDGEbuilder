// Arrange (B3): groups, what a click selects, duplicates, and moving, turning and scaling several
// objects around their centre. No game calls and no files: the page and the mod both use it, and
// scripts/smoke.mjs tests it.

import { add, mul, qMul, qNorm, qRotate, sub, type Q, type V3 } from "./math";
import type { SceneGroup, SceneObject, SceneTransform } from "./protocol";

// ---- groups ----------------------------------------------------------------------------------------

/** A group and every group above it, nearest first. */
export function groupChain(id: string | undefined, groups: SceneGroup[]): string[] {
  const chain: string[] = [];
  const seen = new Set<string>();
  for (let g = groups.find((x) => x.id === id); g && !seen.has(g.id); g = groups.find((x) => x.id === g!.parent)) {
    seen.add(g.id);
    chain.push(g.id);
  }
  return chain;
}

/** The outermost group an object is in, or none. */
export function topGroup(o: SceneObject, groups: SceneGroup[]): string | undefined {
  const chain = groupChain(o.group, groups);
  return chain[chain.length - 1];
}

/** The objects in a group, its inner groups' included. */
export function membersOf(groupId: string, objects: SceneObject[], groups: SceneGroup[]): SceneObject[] {
  return objects.filter((o) => groupChain(o.group, groups).includes(groupId));
}

/**
 * What a click on an object selects: its outermost group's objects, or with `single` (Alt) the one
 * object. With `toggle` (Ctrl) those are added to the selection, or taken out if all were in it.
 */
export function pickSelection(id: string | undefined, selected: string[], objects: SceneObject[], groups: SceneGroup[], opts: { toggle?: boolean; single?: boolean } = {}): string[] {
  const o = objects.find((x) => x.id === id);
  if (!o) return opts.toggle ? selected : [];
  const top = opts.single ? undefined : topGroup(o, groups);
  const ids = top ? membersOf(top, objects, groups).map((x) => x.id) : [o.id];
  return opts.toggle ? toggleIds(selected, ids) : ids;
}

/** Several objects at once (a box): each brings its group unless `single`. */
export function pickMany(ids: string[], selected: string[], objects: SceneObject[], groups: SceneGroup[], opts: { add?: boolean; single?: boolean } = {}): string[] {
  const out = new Set(opts.add ? selected : []);
  for (const id of ids) for (const x of pickSelection(id, [], objects, groups, { single: opts.single })) out.add(x);
  return objects.filter((o) => out.has(o.id)).map((o) => o.id);
}

function toggleIds(selected: string[], ids: string[]): string[] {
  const all = ids.every((id) => selected.includes(id));
  return all ? selected.filter((id) => !ids.includes(id)) : [...selected, ...ids.filter((id) => !selected.includes(id))];
}

/**
 * What the selection is made of: whole groups (the outermost group all of whose objects are
 * selected) and the objects left over.
 */
export function selectionUnits(selected: string[], objects: SceneObject[], groups: SceneGroup[]): { groups: string[]; objects: string[] } {
  const sel = new Set(selected);
  const whole = (g: string) => membersOf(g, objects, groups).every((o) => sel.has(o.id));
  const unitGroups = new Set<string>();
  const unitObjects: string[] = [];
  for (const o of objects) {
    if (!sel.has(o.id)) continue;
    const chain = groupChain(o.group, groups);
    let unit: string | undefined;
    for (const g of chain) {
      if (whole(g)) unit = g;
      else break;
    }
    if (unit) unitGroups.add(unit);
    else unitObjects.push(o.id);
  }
  return { groups: [...unitGroups], objects: unitObjects };
}

/** A new id from a base, not one of `taken`: `crate`, then `crate_2`, `crate_3`. */
export function freshId(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  const stem = base.replace(/_\d+$/, "");
  for (let n = 2; ; n++) if (!taken.has(`${stem}_${n}`)) return `${stem}_${n}`;
}

/** The next free group name: Group 1, Group 2... */
export function nextGroupName(groups: SceneGroup[]): string {
  const names = new Set(groups.map((g) => g.name));
  for (let n = 1; ; n++) if (!names.has(`Group ${n}`)) return `Group ${n}`;
}

/**
 * Groups the selection. Whole groups go into the new group as they are; loose objects, or objects
 * picked out of a group, go in on their own. The new group sits where all its parts were, if they
 * shared a parent group. Changes `objects` and `groups`; returns the new group's id, or none.
 */
export function makeGroup(selected: string[], objects: SceneObject[], groups: SceneGroup[], name = nextGroupName(groups)): string | undefined {
  const units = selectionUnits(selected, objects, groups);
  if (units.groups.length + units.objects.length < 1) return undefined;
  const parents = new Set<string | null>([
    ...units.groups.map((g) => groups.find((x) => x.id === g)!.parent),
    ...units.objects.map((id) => objects.find((o) => o.id === id)!.group ?? null),
  ]);
  const id = freshId("grp_1", new Set(groups.map((g) => g.id)));
  groups.push({ id, name, parent: parents.size === 1 ? [...parents][0] : null });
  for (const g of units.groups) groups.find((x) => x.id === g)!.parent = id;
  for (const oid of units.objects) objects.find((o) => o.id === oid)!.group = id;
  return id;
}

/**
 * Ungroups: whole groups in the selection open, their parts going to the group above; objects picked
 * out of a group step out of it. Changes `objects` and `groups`; returns how many groups opened.
 */
export function ungroup(selected: string[], objects: SceneObject[], groups: SceneGroup[]): number {
  const units = selectionUnits(selected, objects, groups);
  for (const gid of units.groups) {
    const g = groups.find((x) => x.id === gid)!;
    for (const o of objects) if (o.group === gid) o.group = g.parent ?? undefined;
    for (const inner of groups) if (inner.parent === gid) inner.parent = g.parent;
    groups.splice(groups.indexOf(g), 1);
  }
  for (const oid of units.objects) {
    const o = objects.find((x) => x.id === oid)!;
    if (o.group) o.group = groups.find((x) => x.id === o.group)?.parent ?? undefined;
  }
  for (const o of objects) if (!o.group) delete o.group;
  return units.groups.length;
}

/** Takes out groups that hold nothing any more (after a delete). Changes `groups`. */
export function pruneGroups(objects: SceneObject[], groups: SceneGroup[]): void {
  for (let changed = true; changed; ) {
    changed = false;
    for (const g of [...groups]) {
      const used = objects.some((o) => o.group === g.id) || groups.some((x) => x.parent === g.id);
      if (!used) {
        groups.splice(groups.indexOf(g), 1);
        changed = true;
      }
    }
  }
}

/**
 * Copies the selection: objects get new ids, whole groups are copied as new groups with the same
 * names and structure, under the same parent. `offset` moves the copies. Returns the copies without
 * previews, and the new groups; the caller adds them.
 */
export function duplicate(selected: string[], objects: SceneObject[], groups: SceneGroup[], offset: V3 = [0, 0, 0]): { objects: SceneObject[]; groups: SceneGroup[] } {
  const units = selectionUnits(selected, objects, groups);
  const takenObjects = new Set(objects.map((o) => o.id));
  const takenGroups = new Set(groups.map((g) => g.id));
  const newGroups: SceneGroup[] = [];
  const groupMap = new Map<string, string>();
  const copyGroup = (gid: string, parent: string | null) => {
    const g = groups.find((x) => x.id === gid)!;
    const id = freshId(g.id, takenGroups);
    takenGroups.add(id);
    groupMap.set(gid, id);
    newGroups.push({ id, name: g.name, parent });
    for (const inner of groups) if (inner.parent === gid) copyGroup(inner.id, id);
  };
  for (const gid of units.groups) copyGroup(gid, groups.find((x) => x.id === gid)!.parent);
  const copies: SceneObject[] = [];
  const sel = new Set(selected);
  for (const o of objects) {
    if (!sel.has(o.id)) continue;
    const id = freshId(o.id, takenObjects);
    takenObjects.add(id);
    const { entityId: _live, ...rest } = o;
    const copy: SceneObject = JSON.parse(JSON.stringify(rest));
    copy.id = id;
    copy.transform.position = add(o.transform.position as V3, offset);
    const group = o.group && groupMap.get(o.group);
    if (group) copy.group = group;
    copies.push(copy);
  }
  return { objects: copies, groups: newGroups };
}

// ---- several objects at once ----------------------------------------------------------------------

/** The middle of the objects' positions: the gizmo's place and what they turn and scale around. */
export function centreOf(ts: SceneTransform[]): V3 {
  if (!ts.length) return [0, 0, 0];
  let c: V3 = [0, 0, 0];
  for (const t of ts) c = add(c, t.position as V3);
  return mul(c, 1 / ts.length);
}

/** One change to a selection: moved by `move`, turned by `turn` around `pivot`, scaled by `scale` from `pivot`. */
export interface Change {
  move?: V3;
  turn?: Q;
  scale?: V3;
}

/** A transform after a change. Scaling several objects also spreads their places from the pivot. */
export function applyChange(t: SceneTransform, c: Change, pivot: V3): SceneTransform {
  let position = t.position as V3;
  let rotation = t.rotation as Q;
  let scale = t.scale as V3;
  if (c.turn) {
    position = add(pivot, qRotate(c.turn, sub(position, pivot)));
    rotation = qNorm(qMul(c.turn, rotation));
  }
  if (c.scale) {
    const off = sub(position, pivot);
    position = add(pivot, [off[0] * c.scale[0], off[1] * c.scale[1], off[2] * c.scale[2]]);
    scale = [scale[0] * c.scale[0], scale[1] * c.scale[1], scale[2] * c.scale[2]];
  }
  if (c.move) position = add(position, c.move);
  return { position, rotation, scale };
}

/** The world box around the objects, from their bounds (a 1 m box when unknown). */
export function boxOf(objects: SceneObject[]): { min: V3; max: V3 } | undefined {
  let min: V3 | undefined;
  let max: V3 | undefined;
  for (const o of objects) {
    const b = o.bounds ?? { min: [-0.5, -0.5, 0], max: [0.5, 0.5, 1] };
    const t = o.transform;
    for (let i = 0; i < 8; i++) {
      const local: V3 = [(i & 1 ? b.max[0] : b.min[0]) * t.scale[0], (i & 2 ? b.max[1] : b.min[1]) * t.scale[1], (i & 4 ? b.max[2] : b.min[2]) * t.scale[2]];
      const p = add(t.position as V3, qRotate(t.rotation as Q, local));
      min = min ? [Math.min(min[0], p[0]), Math.min(min[1], p[1]), Math.min(min[2], p[2])] : p;
      max = max ? [Math.max(max[0], p[0]), Math.max(max[1], p[1]), Math.max(max[2], p[2])] : p;
    }
  }
  return min && max ? { min, max } : undefined;
}
