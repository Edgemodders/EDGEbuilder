// EDGEbuilder's service in REDnode (B3-2): other packages call it by this package's id,
// "edgebuilder", and assistants see each function as the tool edgebuilder__<name>.
//
// Written by hand, not built from src/: REDnode reads the JSDoc below for the descriptions, the
// argument checks and the MCP tools, and a bundler drops comments. It runs in EDGEbuilder's Node
// mod after mod.mjs, so the import below is the same running module: the same open scene.

import { listScenes, sceneRefs } from './mod.mjs';

/**
 * @event scene-changed {{ name: string, file: string, objects: number }} The open scene changed: an edit was saved, or another scene was opened, made or renamed. Sent half a second after the last save.
 */

/**
 * Every scene EDGEbuilder can open: in the Library's folders, the open REDcode project's source/scenes, and EDGEbuilder's data folder ("This PC"). For each, its name, file, place ("library", "project" or "data"), folder under that place, object count, when it last changed, whether it is the open scene, and whether it is shown in the world (on).
 * @tool
 * @readonly
 * @returns {{ name: string, file: string, place: string, folder: string, objects: number, changed: string, open: boolean, on: boolean }[]} The scenes.
 */
export function scenes() {
  return listScenes();
}

/**
 * A scene's objects with their node references, for placing quest steps against them: the id, the ref the bake gives the node (edgebuilder/<scene>/<id> when the object has none of its own), kind, resource, appearance, group, world position [x, y, z] in metres and rotation as a quaternion [x, y, z, w].
 * @tool
 * @readonly
 * @param {string} [scene] The scene's name or full file path, as scenes() gives them. Leave it out for the scene open in EDGEbuilder.
 * @returns {{ scene: string, file: string, refs: { id: string, ref: string, kind: string, resource: string, appearance: string, group: string, position: number[], rotation: number[] }[] }} The scene's name, its file and its objects.
 */
export function refs(scene) {
  return sceneRefs(scene || undefined);
}
