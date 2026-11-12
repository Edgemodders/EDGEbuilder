// Moving a preview, for the page's drags and the mod's changes alike. REDnode's world.move sets the
// entity's transform, which places a prop but not a person: the game keeps an NPC where its movement
// puts it, so a person goes through the game's teleportation facility, as REDnode teleports V
// (B3c test step 5). world.move still runs for a person, so REDnode keeps the new place for a respawn
// after an archive swap.

import { api, game, world, type GameRef } from "rednode";
import { upright } from "./arrange";
import type { SceneObject } from "./protocol";

type Calls = Record<string, (...args: unknown[]) => Promise<unknown>>;

/** Puts an object's preview at a place, without waiting on the game for more than the calls themselves. */
export async function movePreview(o: Pick<SceneObject, "kind" | "entityId">, position: [number, number, number], rotation: [number, number, number, number]): Promise<boolean> {
  if (!o.entityId) return false;
  const r = o.kind === "npc" ? upright(rotation) : rotation;
  const moved = await world.move(o.entityId, { x: position[0], y: position[1], z: position[2] }, { i: r[0], j: r[1], k: r[2], r: r[3] });
  if (o.kind !== "npc") return moved;
  const [entity, facility] = await Promise.all([
    world.entity(o.entityId) as Promise<GameRef | null>,
    api.GameInstance.GetTeleportationFacility(game.instance) as Promise<unknown>,
  ]);
  if (!entity || !facility) return false;
  const yaw = (2 * Math.atan2(r[2], r[3]) * 180) / Math.PI;
  await (facility as Calls).Teleport(entity, { X: position[0], Y: position[1], Z: position[2], W: 1 }, { Roll: 0, Pitch: 0, Yaw: yaw });
  return true;
}
