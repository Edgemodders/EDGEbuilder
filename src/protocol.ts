// What the editor page and the Node mod say to each other over REDnode's channel.
// The page asks; the mod answers with a full state snapshot, so the page never keeps its own truth.

export type AssetKind = "mesh" | "entity";

/** Where Browse looks: everything, the game's own files, installed mods, or the open REDcode project. */
export type AssetFrom = "all" | "game" | "mods" | "project";

/** Where a file that is not the game's own comes from (B2c). */
export interface AssetSource {
  kind: "mod" | "project";
  /** The mod's name (its archive's, or its REDmod folder's), or the REDcode project's. */
  name: string;
  /** The .archive, or the loose file in the project's sourcerchive. */
  file: string;
}

/** One row of the asset index: a file an object can be made from. */
export interface AssetEntry {
  /** The game path, backslashes. */
  path: string;
  kind: AssetKind;
  size: number;
  /** Absent for the game's own files. */
  source?: AssetSource;
  /** A mod's file that has the path of a game file: it changes that file rather than adding one. */
  replaces?: boolean;
}

/** What is known about an asset once looked at: from REDbridge's mesh.info. */
export interface AssetInfo {
  bounds?: { min: number[]; max: number[] };
  appearances: string[];
  error?: string;
}

export interface SceneTransform {
  position: [number, number, number];
  /** A quaternion, x y z w. */
  rotation: [number, number, number, number];
  scale: [number, number, number];
}

/** One placed object, as the scene file keeps it (format 1) plus its live preview. */
export interface SceneObject {
  id: string;
  kind: "mesh" | "entity" | "light";
  resource?: string;
  appearance?: string;
  transform: SceneTransform;
  streaming?: { primary?: number; secondary?: number };
  ref?: string;
  bounds?: { min: number[]; max: number[] };
  group?: string;
  props?: Record<string, unknown>;
  /** The preview entity's id hash while it is in the world; not saved. */
  entityId?: string;
}

export interface Snapshot {
  /** The mod has started. */
  ready: boolean;
  /** REDnode's world support: Codeware installed and a game loaded. */
  /** no-game: the REDnode host is not linked to a running game (window mode, or the game closed). */
  world: "ready" | "no-game" | "no-save" | "no-codeware" | "unknown";
  /** blocked: REDnode has REDbridge but the player has not allowed EDGEbuilder to use it yet. */
  bridge: { status: "off" | "starting" | "ready" | "blocked" | "missing" | "failed"; path?: string; version?: string; detail?: string };
  index: { status: "none" | "building" | "ready" | "failed"; count: number; progress?: string; file?: string };
  results: AssetEntry[];
  query: { text: string; kind: AssetKind | "all"; from: AssetFrom };
  /** Mod archives and the open REDcode project, indexed beside the game (B2c). */
  sources: {
    mods: { archives: number; assets: number; reading?: string };
    /** The project REDcode has open, or null: none open, or REDcode's service is not there. */
    project: { name: string; dir: string; archive: string; assets: number } | null;
  };
  /** The asset the page last looked at, with what the bridge said about it. */
  looked?: { path: string; info?: AssetInfo };
  /** needs: the mods and the project whose files the scene uses; the game needs them too once baked. */
  scene: { name: string; objects: SceneObject[]; file?: string; needs: string[] };
  selected?: string;
  /** Builder mode: EDGEbuilder's own camera entity while Edit is on, and whether the game's HUD is hidden. */
  camera?: { entityId: string; hudHidden: boolean };
  /** The last thing worth telling the player. */
  message?: { text: string; tone: "info" | "ok" | "warn" | "error" };
  settings: { bridgePath?: string; gameDir?: string; hideHud?: boolean; editorCamera?: boolean; settingsFile: string };
  /** What is in use when a setting is left empty: the REDbridge found or shared, and the game folder found. */
  inUse: { bridge?: string; gameDir?: string };
}

export type PageMessage =
  | { type: "hello" }
  | { type: "search"; text: string; kind: AssetKind | "all"; from?: AssetFrom }
  | { type: "look"; path: string }
  /** `at`: a line from the camera through where the player clicked (Drop at click); else where the camera looks. */
  | { type: "drop"; path: string; appearance?: string; at?: { origin: [number, number, number]; dir: [number, number, number] } }
  | { type: "select"; id?: string }
  | { type: "delete"; id: string }
  | { type: "rebuild" }
  | { type: "clear" }
  | { type: "index.build" }
  | { type: "bridge.restart" }
  | { type: "settings"; bridgePath?: string; gameDir?: string; hideHud?: boolean; editorCamera?: boolean }
  /** Edit went on: switch to EDGEbuilder's camera at this pose, and hide the game's HUD. */
  | { type: "builder.start"; pose: { position: [number, number, number]; rotation: [number, number, number, number]; fov: number } }
  /** Edit went off: back to V's camera and HUD. */
  | { type: "builder.stop" }
  /** The page moved, turned or scaled an object; the mod saves it and places the preview. */
  | { type: "transform"; id: string; transform: SceneTransform }
  /** Drop the object onto whatever is below it. */
  | { type: "floor"; id: string }
  /** A line for the mod log, so the page's measurements land beside the mod's. */
  | { type: "log"; text: string };

export type ModMessage = { type: "state"; state: Snapshot };
