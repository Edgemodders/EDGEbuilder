// The REDnode-free parts of the mod, bundled on their own for the smoke test.
export {
  bakeFilesOf,
  bakeFolderProject,
  bakeHash,
  bakeInput,
  bakesIn,
  checkBake,
  deployedBakes,
  forgetInNote,
  freeBakeDir,
  fromLibraryPath,
  includeBake,
  includeClashes,
  libraryBakesIn,
  libraryPath,
  newBakeId,
  readBakeMeta,
  readNote,
  removeBake,
  scanBakes,
  settleXl,
  solidForBake,
  writeBakeMeta,
  writeRecord,
} from "./bake";
export { BridgeClient, BridgeError, defaultDotnetRoot, findBridge, isGameFolder } from "./bridge";
export { applyChange, collisionKey, boxOf, centreOf, copyOf, duplicate, makeGroup, membersOf, pasteOf, pickMany, pickSelection, pruneGroups, seenFromBySize, selectionUnits, standPoint, streamingFor, ungroup, upright } from "./arrange";
export { NpcList, PersonBounds, isRecord, npcEntry } from "./npcs";
export { AssetIndex, IndexPrefixes, kindOf } from "./index";
export { Scene, quaternionToYaw, readSceneFile, yawToQuaternion } from "./scene";
export { cleanFolderName, fileNameOf, folderIn, freeFileName, libraryConfigFile, readLibraryRoot, refOf, scanShelf, slugOf, whereIs, writeLibraryRoot } from "./scenes";
export { ModSources, NeedsNewerBridge, modArchives, sceneNeeds } from "./sources";
export * from "./math";
export type * from "./protocol";
