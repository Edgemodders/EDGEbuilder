// The scene: the objects placed so far, in EDGEbuilder's scene format 1, saved after every change.
// The preview entities in the game are not the truth; this file is. See docs/scene.md.

import * as fs from "node:fs";
import * as path from "node:path";
import type { SceneObject, SceneTransform } from "./protocol";

export interface SceneFile {
  format: 1;
  name: string;
  game?: string;
  groups: { id: string; name: string; parent: string | null }[];
  objects: Omit<SceneObject, "entityId">[];
}

export class Scene {
  name = "Working scene";
  objects: SceneObject[] = [];
  private counter = 0;

  constructor(readonly file: string) {}

  load(): boolean {
    try {
      const data = JSON.parse(fs.readFileSync(this.file, "utf8")) as SceneFile;
      if (data.format !== 1 || !Array.isArray(data.objects)) return false;
      this.name = data.name || this.name;
      this.objects = data.objects.map((o) => ({ ...o }));
      this.counter = this.objects.length;
      return true;
    } catch {
      return false;
    }
  }

  save(): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const data: SceneFile = {
      format: 1,
      name: this.name,
      groups: [],
      objects: this.objects.map(({ entityId: _live, ...rest }) => rest),
    };
    fs.writeFileSync(this.file, JSON.stringify(data, null, 2));
  }

  add(kind: SceneObject["kind"], resource: string | undefined, transform: SceneTransform, appearance?: string): SceneObject {
    const base = resource ? path.basename(resource).replace(/\.[^.]+$/, "").replace(/[^a-z0-9_-]+/gi, "_").toLowerCase() : kind;
    let id = base;
    while (this.objects.some((o) => o.id === id)) id = `${base}_${++this.counter}`;
    const o: SceneObject = { id, kind, resource, appearance, transform };
    this.objects.push(o);
    this.save();
    return o;
  }

  remove(id: string): SceneObject | undefined {
    const i = this.objects.findIndex((o) => o.id === id);
    if (i < 0) return undefined;
    const [gone] = this.objects.splice(i, 1);
    this.save();
    return gone;
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
