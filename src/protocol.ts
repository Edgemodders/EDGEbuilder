// What the editor page and the Node mod say to each other over REDnode's channel.
// The page asks; the mod answers with a full state snapshot, so the page never keeps its own truth.

/** `npc`: a `Character` record from TweakDB (B3c); its `path` is the record, such as `Character.Judy`. */
export type AssetKind = "mesh" | "entity" | "npc";

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
  /** An NPC's in-game name, such as `Judy Álvarez` (B3c). */
  name?: string;
  /** An NPC's entity template, where its appearances are. */
  template?: string;
  /** The appearance an NPC's record names, when it names one. */
  appearance?: string;
}

/** What is known about an asset once looked at: from REDbridge's mesh.info. */
export interface AssetInfo {
  bounds?: { min: number[]; max: number[] };
  appearances: string[];
  /** Whether a mesh has collision data, which it needs to be solid. Null: not a mesh, or a REDbridge before 0.12.0. Absent: not asked yet. */
  hasCollision?: boolean | null;
  error?: string;
}

/** The first choice in a person's appearance list when the record names none: the game picks one, and EDGEbuilder keeps what it picked. */
export const AnyLook = "Any: the game picks";

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
  kind: "mesh" | "entity" | "light" | "npc";
  resource?: string;
  /** A person's `Character` record (the `npc` kind, scene format 2). One of `record` and `resource`. */
  record?: string;
  appearance?: string;
  /** A mesh that stops V, bullets and cars once baked (B4-2). A new mesh starts solid; absent means not solid, as in older scenes. */
  solid?: boolean;
  transform: SceneTransform;
  /** How far off it is seen once baked, in metres (the Seen from field). Absent: REDbridge's rule by size. */
  streaming?: { primary?: number; secondary?: number };
  ref?: string;
  bounds?: { min: number[]; max: number[] };
  group?: string;
  props?: Record<string, unknown>;
  /** The preview entity's id hash while it is in the world; not saved. */
  entityId?: string;
}

// ---- world edits (D1) ----

/** The kinds of the game's own objects the picker knows, in its list of kinds (doors first, D1). */
export type WorldKind = "door" | "fakeDoor" | "mesh";

/**
 * A node of the game's sectors, as a world edit names it. ArchiveXL counts a sector's node data
 * entries, and a deletion names an entry (D0): `entry` is that, `node` the node it places.
 */
export interface WorldNodeRef {
  /** The sector's depot path, when REDbridge named it; empty until then. */
  sector: string;
  /** The sector's path hash, `0x...`, as REDnode's registry gives it. */
  sectorHash: string;
  entry: number;
  node: number;
  /** The node's class, such as `worldEntityNode`. */
  type: string;
  /** Its global node id (decimal), when it has one; for a door, its entity's id (D0, D1). */
  globalId?: string;
}

/** A door's state as a scene sets it (D2): open or closed, locked or not; absent means as the game has it. */
export interface DoorState {
  open?: boolean;
  locked?: boolean;
}

/** One change a scene makes to the game's own world (scene format 3). D1: removals; D2: a door's state. */
export interface WorldEdit {
  id: string;
  /** `remove`: out of the world (D1). `door`: a door kept open, closed or locked (D2), in the running game only. */
  action: "remove" | "door";
  what: WorldKind;
  /** What the panel and the Scene tab call it, such as `Door single_door.ent (doors_single_kitsch_g)`. */
  label: string;
  node: WorldNodeRef;
  /** What finds the node again after a game patch renumbers it: its file, appearance and place. */
  fingerprint: { resource?: string; appearance?: string; position: [number, number, number] };
  /** An entity's proxy meshes seen in the game (D0: deleting the entity leaves its proxy). The bake finds them too. */
  proxies?: WorldNodeRef[];
  /** The node's reference, when it has one: a quest can address a node that has one. */
  ref?: string;
  /** D2, `door` only: the state the scene keeps the door in. */
  door?: DoorState;
  /** D2, `door` only: how the door was before, which Restore and Undo put back. */
  before?: DoorState & { closesItself?: boolean };
}

/** A door near V, or a mesh picked, as the World tab lists it. */
export interface WorldThing {
  /** The entity's id for a door, the registry's node id for a mesh. */
  key: string;
  /** S1: picked from the Sector drawer, this sector's path (the kind switches do not take it away). */
  fromSector?: string;
  what: WorldKind;
  /** The game class, such as `Door` or `FakeDoor`, or the node class for a mesh. */
  className: string;
  label: string;
  /** The entity template or mesh, when known. */
  resource?: string;
  appearance?: string;
  position: [number, number, number];
  /** Metres from V, for the list. */
  distance?: number;
  /** A door's state from its device: open, locked, sealed and how it starts. */
  door?: { open?: boolean; locked?: boolean; sealed?: boolean; initial?: string; closesItself?: boolean; lift?: boolean };
  /** The edit that removes it, when one does. */
  removedBy?: string;
  /** D2: the edit that keeps its state, when one does. */
  stateBy?: string;
}

/** The thing picked in the world, with its node once found and what to warn about. */
export interface WorldPicked extends WorldThing {
  node?: WorldNodeRef;
  proxies?: WorldNodeRef[];
  ref?: string;
  warnings: string[];
  /** Still looking for its node or its reference, or why it has none. */
  note?: string;
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
  /** D1: the game's own objects it removes (format 3's worldEdits). */
  removals?: number;
  /** D2: the doors whose state it keeps. */
  doors?: number;
  /** When the file last changed, ms since 1970. */
  changed: number;
  /** Set when the file is not a scene EDGEbuilder can read. */
  error?: string;
}

/** B2d: where a model for Import is: a Library folder, the open project's source\raw, or EDGEfab's Desk. */
export type ModelPlace = "library" | "raw" | "desk";

/** B2d: a model Import offers on the Library tab. */
export interface ModelEntry {
  place: ModelPlace;
  /** A `.glb` file, or a `.prop.asset` folder (prepared by EDGEfab). */
  file: string;
  /** The folder under the place's root, with forward slashes; "" at the root. */
  folder: string;
  name: string;
  kind: "glb" | "prop";
  bytes?: number;
  changed: number;
}

/** The import options the Picked panel sends. */
export type ImportCollision = "physical" | "box" | "none";

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

/** One thing the Bake tab says before a bake; "error" stops it. */
export interface BakeCheck {
  tone: "error" | "warn" | "info";
  text: string;
}

/** A bake in a project: what it came from, as far as its record says. */
export interface BakeRecord {
  /** The scene's name as the bake's files have it. */
  slug: string;
  name: string;
  /** The scene file it came from. */
  file?: string;
  /** What was in the scene then (`bakeHash`): another hash now means the scene changed since. */
  hash?: string;
  objects?: number;
  /** When, ISO 8601. */
  date?: string;
  bridge?: string;
  /** The sector's streaming box. */
  box?: { min: number[]; max: number[] };
  /** The mods and the project its objects need. */
  needs?: string[];
  /** D1b: how many of the game's own objects it removes, and the stand-in meshes removed with them. */
  removals?: number;
  standIns?: number;
  /**
   * B4-3: the Library bake it came from, by Include in project. `latest` and `dir`: the version the
   * Library has now and where, when that is newer.
   */
  library?: { id: string; name: string; version: number; latest?: number; dir?: string };
}

/** B4-3: a bake in the Library, `<name>.bake`: one or more scenes, each baked as into a project. */
export interface LibraryBake {
  dir: string;
  /** Its folder under the Library root, with forward slashes; "" at the root. */
  folder: string;
  name: string;
  id: string;
  version: number;
  date?: string;
  bridge?: string;
  /** `file`: where the scene is now; `missing`: not there; `stale`: changed since the bake. */
  scenes: { name: string; slug: string; file: string; missing?: boolean; stale?: boolean }[];
  /** Any of its scenes' bakes is in the game, from this bake or another. */
  inGame: boolean;
  /** Other Library bakes holding one of its scenes: both would put it in the world. */
  collides: string[];
  /** The version the open REDcode project holds, when it holds this bake. */
  inProject?: number;
  error?: string;
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
  /** The game's people for Browse (B3c), read from TweakDB through REDbridge. */
  npcs: { status: "none" | "reading" | "ready" | "failed"; count: number; progress?: string };
  results: AssetEntry[];
  query: { text: string; kind: AssetKind | "all"; from: AssetFrom };
  /** Mod archives and the open REDcode project, indexed beside the game (B2c). */
  sources: {
    mods: { archives: number; assets: number; reading?: string };
    /** The project REDcode has open, or null: none open, or REDcode's service is not there. */
    project: { name: string; dir: string; archive: string; assets: number } | null;
    /**
     * Every project open in REDcode's windows (REDcode 0.10.15 and later), the last-focused first, and the
     * one the player picked by its folder (null: EDGEbuilder follows the window used last).
     */
    projects?: { name: string; dir: string }[];
    picked?: string | null;
  };
  /** The asset the page last looked at, with what the bridge said about it. */
  looked?: { path: string; info?: AssetInfo };
  /** needs: the mods and the project whose files the scene uses; the game needs them too once baked. */
  scene: { name: string; objects: SceneObject[]; groups: SceneGroup[]; worldEdits: WorldEdit[]; file?: string; needs: string[]; place?: Place; folder?: string };
  /**
   * D1: the World tab. The kinds the picker takes; the doors near V; the thing picked in the world;
   * the world node registry's count (REDnode 0.67.3 and later), which knows only sectors that loaded
   * after it started.
   */
  worldObjects: {
    kinds: WorldKind[];
    status: "idle" | "looking" | "ready" | "unavailable";
    things: WorldThing[];
    picked?: WorldPicked;
    registry?: { sectors: number; nodes: number };
    note?: string;
  };
  /** S1 (EDGEbuilder #9): the World tab's Sectors sub-tab and the Sector drawer. */
  sectors: Sectors;
  /**
   * B3-2: the Library root (absent until the player sets one) and the folder offered for it; the
   * three places with their folders and scenes; the scenes switched on (shown, not edited), by file.
   */
  library: {
    root?: string;
    suggested: string;
    shelves: Shelf[];
    on: string[];
    peek?: ScenePeek;
    bakes: LibraryBake[];
    /** B2d: models for Import, and the labels of the two places beside the Library (the project's source\raw, EDGEfab's Desk). */
    models: ModelEntry[];
    modelPlaces: { place: ModelPlace; label: string; dir: string }[];
  };
  /** B2d: the last Import's result: the new prop's entity, picked on the Assets tab when it changes. */
  imported?: { path: string; at: number };
  /**
   * B4: the Bake tab. The project a bake goes into, what the checks say, the open scene's bake in that
   * project and whether the scene changed since, the `.xl` that has its bake in the game, every bake in
   * the project, and what the last bake wrote.
   */
  bake: {
    project: { name: string; dir: string } | null;
    checks: BakeCheck[];
    current?: BakeRecord;
    stale: boolean;
    inGame?: string;
    list: BakeRecord[];
    last?: { slug: string; files: string[]; warnings: string[] };
  };
  /** The scene's meshes known to have no collision data, which cannot be solid: `collisionKey` of each. */
  noCollision: string[];
  /** The selected objects (B3: several at once; a group selects all its objects). */
  selected: string[];
  /** How many steps Undo and Redo can take. */
  history: { undo: number; redo: number };
  /** The last Duplicate's copies, so the page can start moving them; `seq` counts duplicates. */
  duplicated?: { seq: number; ids: string[] };
  /** Builder mode: EDGEbuilder's own camera entity while Edit is on, and whether the game's HUD is hidden. */
  camera?: { entityId?: string; hudHidden: boolean; paused?: boolean };
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

/** One streaming sector on the Sectors sub-tab, from REDbridge's sector.find. */
export interface SectorRow {
  path: string;
  name: string;
  /** exterior, interior, quest, navigation or alwaysLoaded. */
  kind: string;
  level: number;
  grid?: number[];
  /** "base" or "ep1": the streaming block that lists it. */
  block: string;
  variants?: number;
  /** A Phantom Liberty sector that the base game lists too: the game streams Phantom Liberty's. */
  replaces?: boolean;
  /** Metres from the place looked around to its streaming box, 0 inside it. */
  distance?: number;
  /** Whether REDnode's world node registry has it loaded now. */
  streamed?: boolean;
}

/** One node data entry of the open sector, a row of the Sector drawer. */
export interface SectorNodeRow {
  entry: number;
  node: number;
  kind: string;
  resource?: string;
  ref?: string;
  /** Its global node id, decimal. */
  hash?: string;
  appearance?: string;
  position: [number, number, number];
  /** An instanced mesh: how many copies the entry places. */
  copies?: number;
  /** Streamed in now (REDnode's registry); null when the sector is not loaded or the registry cannot say. */
  streamed?: boolean | null;
  /** Hidden for the session from the drawer. */
  hidden?: boolean;
}

export interface SectorView {
  path: string;
  hash: string;
  kind: string;
  level: number;
  status: "reading" | "ready" | "error";
  error?: string;
  /** Entries in the sector, those matching the filter, and the rows shown (at most a few hundred). */
  total: number;
  matching: number;
  filter: string;
  nodes: SectorNodeRow[];
  /** Whether REDnode's registry has the sector loaded now. */
  loaded?: boolean;
  /** The entry picked from the drawer. */
  selected?: number;
}

export interface Sectors {
  status: "idle" | "looking" | "ready" | "unavailable";
  note?: string;
  /** What the last find looked for. */
  around?: "V" | "camera" | "text";
  text: string;
  /** The kinds switched on (exterior, interior, quest, other) and the level chosen (null: all; 3 means 3 and coarser). */
  kinds: string[];
  level: number | null;
  found: SectorRow[];
  /** How many matched, before the list was cut. */
  total: number;
  open?: SectorView;
  /** The service's focus: the page flies the camera there when seq changes. */
  fly?: { seq: number; position: [number, number, number] };
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
  /** Solid or not once baked, for the meshes among `ids`. One undo step. */
  | { type: "solid"; ids: string[]; on: boolean }
  /** How far off the objects are seen once baked, in metres; null for REDbridge's rule by size. One undo step. */
  | { type: "seenFrom"; ids: string[]; metres: number | null }
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
  /** The project EDGEbuilder works with, by its folder; null follows the REDcode window used last. */
  | { type: "project.pick"; dir: string | null }
  /** B4: bake the open scene into the open REDcode project. */
  | { type: "bake" }
  /** Look at the project's bakes and the game's again. */
  | { type: "bake.refresh" }
  /** B2d: import a `.glb` or a Desk prop into the open project, pack it and swap it into the game. */
  | { type: "import"; file: string; name?: string; height?: number; collision: ImportCollision }
  /** Take a bake out of the project, by its slug. */
  | { type: "bake.remove"; slug: string }
  /** B4-3: a new bake in the Library folder `folder`, of the scene `file`. */
  | { type: "lbake.new"; file: string; name: string; folder: string }
  /** Add a scene to a Library bake, or take one out; either bakes it again. */
  | { type: "lbake.add"; dir: string; file: string }
  | { type: "lbake.drop"; dir: string; slug: string }
  /** Bake every scene of a Library bake again. */
  | { type: "lbake.rebake"; dir: string }
  /** Copy a Library bake into the open REDcode project (or bring the project's copy up to date). */
  | { type: "lbake.include"; dir: string }
  /** Delete a Library bake's folder. Projects that include it keep their copies. */
  | { type: "lbake.delete"; dir: string }
  /** Set the Library root (made when missing), for every EDGE tool. */
  | { type: "library.root"; root: string }
  /** A new folder `name` inside `folder` of the Library. */
  | { type: "library.folder"; folder: string; name: string }
  /** Look at the folders again (a file changed outside EDGEbuilder). */
  | { type: "library.refresh" }
  /** D1: a click that hit none of the scene's objects: the game's door (or mesh) along this line, if any. */
  | { type: "world.pick"; origin: [number, number, number]; dir: [number, number, number] }
  /** The World tab's row: pick it; hover outlines it (null: the outline goes). */
  | { type: "world.select"; key: string }
  | { type: "world.hover"; key: string | null }
  /** Nothing picked in the world any more. */
  | { type: "world.clear" }
  /** Look for the doors near V again. */
  | { type: "world.refresh" }
  /** The kinds the picker takes. */
  | { type: "world.kinds"; kinds: WorldKind[] }
  /** Remove the picked thing from the world: hidden now, kept in the scene. One undo step. */
  | { type: "world.remove" }
  /** D2: open, close, lock or unlock the picked door, kept in the scene. One undo step. */
  | { type: "world.door"; act: "open" | "close" | "lock" | "unlock" }
  /** S1: find sectors around V, around the camera (at its place) or by name or grid. */
  | { type: "sectors.find"; around: "V" | "camera" | "text"; at?: [number, number, number]; text?: string; kinds: string[]; level: number | null }
  | { type: "sectors.open"; path: string }
  | { type: "sectors.close" }
  | { type: "sectors.filter"; text: string }
  /** Picks the open sector's entry into Picked in the world. */
  | { type: "sectors.select"; entry: number }
  /** Hides an entry for the session (not kept in the scene), or shows it again. */
  | { type: "sectors.hide"; entry: number; hidden: boolean }
  /** Take a world edit out of the scene: what it removed is back. One undo step. */
  | { type: "world.restore"; id: string }
  | { type: "undo" }
  /** Stop placing the running change's previews; changes waiting still run. */
  | { type: "stop" }
  | { type: "redo" }
  /** A line for the mod log, so the page's measurements land beside the mod's. */
  | { type: "log"; text: string }
  /**
   * Previews of search results (0.14.0): the meshes whose tiles are in view. The mod answers each with a
   * `preview` message, the newest ask first; `glb` asks for the model even when a picture is kept.
   */
  | { type: "preview.ask"; paths: string[]; glb?: boolean }
  /** The picture the page drew from a preview's model, kept in the data folder for next time. */
  | { type: "preview.save"; key: string; png: string }
  /** Drop at click, while it waits: where a click through this line would put the object. */
  | { type: "drop.probe"; seq: number; origin: [number, number, number]; dir: [number, number, number] };

/** One model of a preview: a mesh's plain GLB (base64), and for an entity's part its offset and scale in the entity (game axes). */
export interface PreviewPart {
  glb: string;
  offset?: number[];
  scale?: number[];
}

/** One preview: a picture kept from before (`png`, base64), or the models to draw one from (a mesh: one; an entity: its mesh parts). */
export interface PreviewReply {
  type: "preview";
  path: string;
  key: string;
  png?: string;
  parts?: PreviewPart[];
  error?: string;
}

/** Where a click through the probe's line would drop: on a surface (`hit`), or 8 m along it. */
export interface ProbeReply {
  type: "probe";
  seq: number;
  position: [number, number, number];
  rotation: [number, number, number, number];
  hit: boolean;
}

export type ModMessage = { type: "state"; state: Snapshot } | PreviewReply | ProbeReply;
