// The scene: the objects placed so far, in EDGEbuilder's scene format 1, saved after every change.
// The preview entities in the game are not the truth; this file is. See docs/scene.md.

import * as fs from "node:fs";
import * as path from "node:path";
import { freshId, pruneGroups } from "./arrange";
import type { SceneGroup, SceneObject, SceneTransform } from "./protocol";

export interface SceneFile {
  format: 1;
  name: string;
  game?: string;
  groups: SceneGroup[];
  objects: Omit<SceneObject, "entityId">[];
}

/** The scene at one moment, without previews: what Undo goes back to. */
export interface SceneState {
  objects: Omit<SceneObject, "entityId">[];
  groups: SceneGroup[];
  /** What was selected then, for Undo to select again when nothing it changes is still there to show. */
  selected?: string[];
}

export class Scene {
  name = "Working scene";
  objects: SceneObject[] = [];
  groups: SceneGroup[] = [];

  constructor(readonly file: string) {}

  /** Where an unreadable scene file was moved, so the next save does not overwrite it. */
  setAside: string | undefined;

  load(): boolean {
    let text: string;
    try {
      text = fs.readFileSync(this.file, "utf8");
    } catch {
      return false; // no scene yet
    }
    try {
      const data = JSON.parse(text) as SceneFile;
      if (data.format !== 1 || !Array.isArray(data.objects)) throw new Error(`not a format 1 scene`);
      this.name = data.name || this.name;
      this.objects = data.objects.map((o) => ({ ...o }));
      this.groups = Array.isArray(data.groups) ? data.groups.map((g) => ({ id: g.id, name: g.name, parent: g.parent ?? null })) : [];
      // An object in a group the file does not have stands on its own.
      for (const o of this.objects) if (o.group && !this.groups.some((g) => g.id === o.group)) delete o.group;
      return true;
    } catch (err) {
      // A damaged or hand-edited file: keep it beside, start empty, and let the mod say so.
      this.setAside = `${this.file}.unreadable-${new Date().toISOString().replace(/[:.]/g, "-")}`;
      try {
        fs.renameSync(this.file, this.setAside);
      } catch {
        this.setAside = undefined;
      }
      this.loadError = (err as Error).message;
      return false;
    }
  }

  loadError: string | undefined;

  save(): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const data: SceneFile = {
      format: 1,
      name: this.name,
      groups: this.groups,
      objects: this.objects.map(({ entityId: _live, ...rest }) => rest),
    };
    fs.writeFileSync(this.file, JSON.stringify(data, null, 2));
  }

  add(kind: SceneObject["kind"], resource: string | undefined, transform: SceneTransform, appearance?: string): SceneObject {
    const base = resource ? path.basename(resource).replace(/\.[^.]+$/, "").replace(/[^a-z0-9_-]+/gi, "_").toLowerCase() : kind;
    const id = freshId(base, new Set(this.objects.map((o) => o.id)));
    const o: SceneObject = { id, kind, resource, appearance, transform };
    this.objects.push(o);
    this.save();
    return o;
  }

  remove(id: string): SceneObject | undefined {
    const i = this.objects.findIndex((o) => o.id === id);
    if (i < 0) return undefined;
    const [gone] = this.objects.splice(i, 1);
    pruneGroups(this.objects, this.groups);
    this.save();
    return gone;
  }

  /** A copy of the scene as it is now, for Undo. */
  state(): SceneState {
    return JSON.parse(JSON.stringify({ objects: this.objects.map(({ entityId: _live, ...rest }) => rest), groups: this.groups }));
  }

  /**
   * Puts the scene back to `s`, keeping the previews of objects that are still there (by id). Returns
   * what the mod has to do: spawn objects that came back, spawn again those whose file, appearance or
   * scale changed, move those that moved, and remove the previews of objects that are gone.
   */
  restore(s: SceneState): { spawn: SceneObject[]; respawn: SceneObject[]; move: SceneObject[]; gone: SceneObject[] } {
    const before = new Map(this.objects.map((o) => [o.id, o]));
    const out = { spawn: [] as SceneObject[], respawn: [] as SceneObject[], move: [] as SceneObject[], gone: [] as SceneObject[] };
    this.objects = s.objects.map((saved) => {
      const o: SceneObject = JSON.parse(JSON.stringify(saved));
      const was = before.get(o.id);
      before.delete(o.id);
      // Back in the scene: spawn it. Still there without a preview (a save loaded): Rebuild brings it.
      if (!was) out.spawn.push(o);
      if (!was?.entityId) return o;
      o.entityId = was.entityId;
      const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
      if (was.kind !== o.kind || was.resource !== o.resource || was.appearance !== o.appearance || !same(was.transform.scale, o.transform.scale)) out.respawn.push(o);
      else if (!same(was.transform.position, o.transform.position) || !same(was.transform.rotation, o.transform.rotation)) out.move.push(o);
      return o;
    });
    out.gone = [...before.values()].filter((o) => o.entityId);
    this.groups = JSON.parse(JSON.stringify(s.groups));
    this.save();
    return out;
  }

  get(id: string | undefined): SceneObject | undefined {
    return id ? this.objects.find((o) => o.id === id) : undefined;
  }

  /** Forgets every preview: after a save loads, the entities are gone. */
  forgetPreviews(): void {
    for (const o of this.objects) delete o.entityId;
  }

  clear(): void {
    this.objects = [];
    this.groups = [];
    this.save();
  }
}

/** A quaternion for a turn around the vertical axis, in degrees. */
export function yawToQuaternion(yawDegrees: number): [number, number, number, number] {
  const half = (yawDegrees * Math.PI) / 360;
  return [0, 0, Math.sin(half), Math.cos(half)];
}

/** The yaw of a quaternion that only turns around the vertical axis, in degrees. */
export function quaternionToYaw(q: [number, number, number, number]): number {
  return (2 * Math.atan2(q[2], q[3]) * 180) / Math.PI;
}
