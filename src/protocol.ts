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

/** A group in the scene tree (format 1's `groups`): groups can hold groups. */
export interface SceneGroup {
  id: string;
  name: string;
  parent: string | null;
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

// ---- scenes and the Library (B3-2) ----

/** Where a scene file is: a Library folder, the open REDcode project's source/scenes, or This PC (EDGEbuilder's data folder). */
export type Place = "library" | "project" | "data";

/** One of the three places: where it is on disk and what the Library tab calls it. */
export interface PlaceRoot {
  place: Place;
  dir: string;
  label: string;
}

/** A scene file as the Library tab lists it. */
export interface SceneEntry {
  place: Place;
  file: string;
  /** The folder under the place's root, with forward slashes; "" at the root. */
  folder: string;
  name: string;
  objects: number;
  /** When the file last changed, ms since 1970. */
  changed: number;
  /** Set when the file is not a scene EDGEbuilder can read. */
  error?: string;
}

/** A place with its folders and scenes. */
export interface Shelf extends PlaceRoot {
  folders: string[];
  scenes: SceneEntry[];
}

/** The Objects drawer's view of a scene that is not the open one, read from its file. */
export interface ScenePeek {
  file: string;
  name: string;
  objects: SceneObject[];
  groups: SceneGroup[];
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
  scene: { name: string; objects: SceneObject[]; groups: SceneGroup[]; file?: string; needs: string[]; place?: Place; folder?: string };
  /**
   * B3-2: the Library root (absent until the player sets one) and the folder offered for it; the
   * three places with their folders and scenes; the scenes switched on (shown, not edited), by file.
   */
  library: { root?: string; suggested: string; shelves: Shelf[]; on: string[]; peek?: ScenePeek };
  /** The selected objects (B3: several at once; a group selects all its objects). */
  selected: string[];
  /** How many steps Undo and Redo can take. */
  history: { undo: number; redo: number };
  /** The last Duplicate's copies, so the page can start moving them; `seq` counts duplicates. */
  duplicated?: { seq: number; ids: string[] };
  /** Builder mode: EDGEbuilder's own camera entity while Edit is on, and whether the game's HUD is hidden. */
  camera?: { entityId: string; hudHidden: boolean };
  /** The last thing worth telling the player. */
  message?: { text: string; tone: "info" | "ok" | "warn" | "error" };
  /**
   * A scene change that has run for more than half a second: what it is, how far (`done` of `total`
   * when it can say), when it started (ms since 1970), and how many changes wait behind it.
   */
  busy?: { what: string; done?: number; total?: number; since: number; waiting: number };
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
  | { type: "select"; ids: string[] }
  | { type: "delete"; ids: string[] }
  | { type: "rebuild" }
  | { type: "clear" }
  | { type: "index.build" }
  | { type: "bridge.restart" }
  | { type: "settings"; bridgePath?: string; gameDir?: string; hideHud?: boolean; editorCamera?: boolean }
  /** Edit went on: switch to EDGEbuilder's camera at this pose, and hide the game's HUD. */
  | { type: "builder.start"; pose: { position: [number, number, number]; rotation: [number, number, number, number]; fov: number } }
  /** Edit went off: back to V's camera and HUD. */
  | { type: "builder.stop" }
  /**
   * The page moved, turned or scaled objects; the mod saves them and places the previews. One undo
   * step; `merge` folds it into the step before (the move that places a duplicate).
   */
  | { type: "transform"; items: { id: string; transform: SceneTransform }[]; merge?: boolean }
  /** Drop the objects onto whatever is below each. */
  | { type: "floor"; ids: string[] }
  /** Group the selected objects; ungroup them; rename a group. */
  | { type: "group"; ids: string[] }
  | { type: "ungroup"; ids: string[] }
  | { type: "rename"; group: string; name: string }
  /** Copy the objects, their groups with them; `offset` moves the copies (none: the page moves them next). */
  | { type: "duplicate"; ids: string[]; offset?: [number, number, number] }
  /** Ctrl+C: keep copies of these for a paste. */
  | { type: "copy"; ids: string[] }
  /** Ctrl+X: copy these, then delete them. */
  | { type: "cut"; ids: string[] }
  /** Ctrl+V: the copies, standing where the line through the cursor meets a surface (`at`), else where Drop puts things. */
  | { type: "paste"; at?: { origin: [number, number, number]; dir: [number, number, number] } }
  /** B3-2: a new empty scene, opened; `folder` under the place's root ("" at its root). */
  | { type: "scene.new"; name: string; place: Place; folder?: string }
  | { type: "scene.open"; file: string }
  /** A copy of the open scene under a new name and place, which becomes the open scene. */
  | { type: "scene.saveAs"; name: string; place: Place; folder?: string }
  /** A new name for the open scene; its file is renamed to match. */
  | { type: "scene.rename"; name: string }
  /** Ctrl+S: the scene is saved after every change; this writes it once more and says so. */
  | { type: "scene.save" }
  /** Show a scene that is not open in the world (`on`), or take it away. */
  | { type: "scene.on"; file: string; on: boolean }
  | { type: "scene.close" }
  | { type: "scene.peek"; file: string }
  | { type: "scene.goTo"; id: string }
  | { type: "scene.removeFrom"; file: string; id: string }
  /** Set the Library root (made when missing), for every EDGE tool. */
  | { type: "library.root"; root: string }
  /** A new folder `name` inside `folder` of the Library. */
  | { type: "library.folder"; folder: string; name: string }
  /** Look at the folders again (a file changed outside EDGEbuilder). */
  | { type: "library.refresh" }
  | { type: "undo" }
  /** Stop placing the running change's previews; changes waiting still run. */
  | { type: "stop" }
  | { type: "redo" }
  /** A line for the mod log, so the page's measurements land beside the mod's. */
  | { type: "log"; text: string };

export type ModMessage = { type: "state"; state: Snapshot };
