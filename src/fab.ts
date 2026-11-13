// B2d: EDGEfab's core, as EDGEbuilder uses it. build.mjs bundles @edgemodders/edgefab-core into
// edgebuilder/fab.cjs, which the mod loads at the first Import only. These types are the part of the
// package's own that Import calls (its README, EDGEfab #5); keep them in step with it.

import { createRequire } from "node:module";
import * as path from "node:path";
import type { ImportCollision } from "./protocol";

export interface FabPrepared {
  /** Height, width and depth in metres. */
  size: { height: number; width: number; depth: number };
  /** No real size in the file (Tripo's models in parts): the height is a guess until set. */
  sizeUnknown?: boolean;
  submeshes: unknown[];
  textures: unknown[];
  parts?: unknown[];
  notes: string[];
}

export interface FabProject {
  dir: string;
  name: string;
  archive: string;
  raw: string;
}

export type BridgeCall = (method: string, params?: Record<string, unknown>) => Promise<unknown>;

export interface FabCore {
  makeModel(req: { from: "file"; file: string; name?: string }, opts: { version: string; base?: string }): Promise<{ folder: string; name: string; prepared: FabPrepared }>;
  setSize(folder: string, height: number, opts: { version: string }): Promise<FabPrepared>;
  readItem(item: string): { name: string; prepared: FabPrepared };
  projectFolders(dir: string): FabProject | undefined;
  addToProject(req: {
    item: string;
    project: FabProject;
    call: BridgeCall;
    name?: string;
    collision?: ImportCollision;
    log?: (line: string) => void;
  }): Promise<{ mesh: string; entity: string; replaced: boolean; collision: ImportCollision; files: string[]; notes: string[] }>;
}

let loaded: FabCore | undefined;

/** EDGEfab's core from `fab.cjs` in the package folder, loaded once. Throws with a reason a player can read. */
export function loadFab(packageDir: string): FabCore {
  if (loaded) return loaded;
  const require = createRequire(path.join(packageDir, "mod.mjs"));
  const core = require("./fab.cjs") as Partial<FabCore>;
  if (typeof core.makeModel !== "function" || typeof core.addToProject !== "function") throw new Error("fab.cjs is not EDGEfab's core.");
  loaded = core as FabCore;
  return loaded;
}

/** Counts Add to Project's texture lines (`  <name>.xbm`), for the progress line. */
export function isTextureLine(line: string): boolean {
  return /\.xbm\s*$/i.test(line.trim());
}
