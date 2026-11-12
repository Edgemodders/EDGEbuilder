// Moving a preview, for the page's drags and the mod's changes alike. REDnode's world.move sets the
// entity's transform, which places a prop. A person does not move that way, nor through the game's
// teleportation facility (B3c test, step 5, 0.10.0 and 0.10.1): the game keeps an NPC where it stands.
// So a person is not moved here at all: when a drag ends the mod gives the person's AI a teleport command,
// or spawns them again there (`movePerson` in mod.ts), and the page moves only the gizmo meanwhile.

import { world } from "rednode";
import type { SceneObject } from "./protocol";

/** Puts an object's preview at a place. False for a person, which only a respawn moves. */
export async function movePreview(o: Pick<SceneObject, "kind" | "entityId">, position: [number, number, number], rotation: [number, number, number, number]): Promise<boolean> {
  if (!o.entityId || o.kind === "npc") return false;
  return world.move(o.entityId, { x: position[0], y: position[1], z: position[2] }, { i: rotation[0], j: rotation[1], k: rotation[2], r: rotation[3] });
}

/** Whether two transforms put an object in the same place, the same way round and at the same size. */
export function sameTransform(a: { position: number[]; rotation: number[]; scale: number[] }, b: { position: number[]; rotation: number[]; scale: number[] }): boolean {
  const near = (x: number[], y: number[]) => x.every((v, i) => Math.abs(v - y[i]) < 1e-5);
  return near(a.position, b.position) && near(a.rotation, b.rotation) && near(a.scale, b.scale);
}
