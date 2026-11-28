// EDGEbuilder's service in REDnode (B3-2): other packages call it by this package's id,
// "edgebuilder", and assistants see each function as the tool edgebuilder__<name>.
//
// Written by hand, not built from src/: REDnode reads the JSDoc below for the descriptions, the
// argument checks and the MCP tools, and a bundler drops comments. It runs in EDGEbuilder's Node
// mod after mod.mjs, so the import below is the same running module: the same open scene.

import { listScenes, sceneRefs, serviceFocus, serviceScenesEditing, serviceSelect } from './mod.mjs';

/**
 * @event scene-changed {{ name: string, id: string, file: string, objects: number }} The open scene changed: an edit was saved, or another scene was opened, made, renamed or closed (then name, id and file are empty). id is the scene's own id, kept through a rename or a move. Sent half a second after the last save.
 */

/**
 * Every scene EDGEbuilder can open: in the Library's folders, the open REDcode project's source/scenes, and EDGEbuilder's data folder ("This PC"). For each, its name, its id (made when EDGEbuilder first saves it and kept through a rename or a move, so a link to a scene can find it again; absent on a scene not saved since), file, place ("library", "project" or "data"), folder under that place, object count, when it last changed, whether it is the open scene, and whether it is shown in the world (on).
 * @tool
 * @readonly
 * @returns {{ name: string, id?: string, file: string, place: string, folder: string, objects: number, changed: string, open: boolean, on: boolean }[]} The scenes.
 */
export function scenes() {
  return listScenes();
}

/**
 * A scene's objects with their node references, for placing quest steps against them: the id, the ref the bake gives the node (edgebuilder/<scene>/<id> when the object has none of its own), kind (mesh, entity, light or npc), resource, a person's Character record, appearance, group, world position [x, y, z] in metres and rotation as a quaternion [x, y, z, w].
 * @tool
 * @readonly
 * @param {string} [scene] The scene's name, id or full file path, as scenes() gives them. Leave it out for the scene open in EDGEbuilder (none may be open).
 * @returns {{ scene: string, file: string, refs: { id: string, ref: string, kind: string, resource: string, record: string, appearance: string, group: string, position: number[], rotation: number[] }[] }} The scene's name, its file and its objects.
 */
export function refs(scene) {
  return sceneRefs(scene || undefined);
}

/**
 * Opens EDGEbuilder's Sector drawer (World tab, Sectors) on a game sector with one node data entry picked, and outlines it in the game when it is streamed in. Needs REDbridge running: it reads the sector.
 * @tool
 * @param {string | { sector: string, entry: number }} sector The sector's depot path (base\worlds\...\name.streamingsector), or { sector, entry }.
 * @param {number} [entry] The node data entry's index, when sector is the path.
 * @returns {{ selected: boolean, streamed: boolean, why?: string }} Whether it was picked, whether it is streamed in now, and why not.
 */
export function select(sector, entry) {
  return serviceSelect(typeof sector === 'object' && sector ? sector : { sector, entry });
}

/**
 * As select, then flies EDGEbuilder's camera to the entry with Edit on. A node far from V may not be streamed in yet.
 * @tool
 * @param {string | { sector: string, entry: number }} sector The sector's depot path, or { sector, entry }.
 * @param {number} [entry] The node data entry's index, when sector is the path.
 * @returns {{ focused: boolean, streamed?: boolean, why?: string }} Whether the camera went there; when not, why (no save loaded, no such entry).
 */
export function focus(sector, entry) {
  return serviceFocus(typeof sector === 'object' && sector ? sector : { sector, entry });
}

/**
 * The scenes (in the Library, the open REDcode project and This PC) whose world edits remove nodes from this sector. A project that replaces the sector changes its entry count, and ArchiveXL then refuses those removals: name these scenes in a warning.
 * @tool
 * @readonly
 * @param {string} sector The sector's depot path.
 * @returns {{ name: string, file: string, place: string, removals: number }[]} Each scene, where it is, and how many of its removals are in that sector.
 */
export function scenesEditing(sector) {
  return serviceScenesEditing(sector);
}
