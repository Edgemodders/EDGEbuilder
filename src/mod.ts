// EDGEbuilder's Node mod: the brain behind the editor page. It owns the scene, the asset index,
// REDbridge and the preview entities; the page shows state, draws the gizmo and sends requests.
// B1: browse the game's assets, drop one in front of V, select it, delete it.
// B2a: move, turn and scale with the page's gizmo and keys, drop to the floor.
// B2c: Browse also lists installed mods' and the open REDcode project's meshes and entities.
// B3-2: named scenes in the Library, the REDcode project or This PC; other scenes shown; a service.

import * as fs from "node:fs";
import * as path from "node:path";
import { api, channel, game, kernel, pkg, service, ui, world, type GameRef } from "rednode";
import { BridgeClient, KernelBridge, findBridge, isGameFolder, type Bridge, type SectorBuilt } from "./bridge";
import { AssetIndex, kindOf } from "./index";
import { NpcList, PersonBounds, isRecord } from "./npcs";
import { ModSources, modArchives, modFolders, sceneNeeds } from "./sources";
import { collisionKey, streamingFor } from "./arrange";
import {
  BakeFolderEnding,
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
  removeBake as removeBakeFiles,
  scanBakes,
  settleXl,
  solidForBake,
  writeBakeMeta,
  writeRecord,
  type BakeMeta,
  type BakeProject,
} from "./bake";
import { Scene, readSceneFile, yawToQuaternion, type SceneFile, type SceneState } from "./scene";
import { movePreview, sameTransform } from "./move";
import { cleanFolderName, fileNameOf, folderIn, readLibraryRoot, refOf, scanShelf, slugOf, suggestedLibraryRoot, whereIs, writeLibraryRoot } from "./scenes";
import { copyOf, duplicate as copySelection, makeGroup, pasteOf, standPoint, ungroup as openGroups, upright, type Clip } from "./arrange";
import { add, basisFromMatrix, lookOf, mul, qLook, sub, type GameMatrix, type V3 } from "./math";
import { AnyLook, type AssetEntry, type AssetFrom, type AssetInfo, type AssetKind, type BakeRecord, type LibraryBake, type PageMessage, type Place, type PlaceRoot, type SceneObject, type SceneTransform, type Snapshot } from "./protocol";

/** A base-game entity template that is a bare entity: no components, no appearances. The editor camera is this with a camera component attached. */
const EmptyEntity = "base\\gameplay\\loot\\containers\\common_suitcases\\appearances\\suitcase_small_placeholder.ent";
/** EDGEbuilder's version, from the package manifest at build time. */
declare const __VERSION__: string;
const SpawnDistance = 3;
const ResultLimit = 120;

interface Settings {
  bridgePath?: string;
  gameDir?: string;
  /** Hide the game's HUD while Edit is on. Default true. */
  hideHud?: boolean;
  /** Switch to EDGEbuilder's own camera while Edit is on. Default true. */
  editorCamera?: boolean;
}

const settingsFile = path.join(pkg.dataDir, "settings.json");
let settings: Settings = {};
try {
  settings = JSON.parse(fs.readFileSync(settingsFile, "utf8"));
} catch {
  // First run.
}

/** This PC: scenes in EDGEbuilder's data folder; the working scene is the one B1 to B3-1 had. */
const dataScenes = path.join(pkg.dataDir, "scenes");
const WorkingScene = path.join(dataScenes, "working.scene.json");
/** B3-2: the open scene and the scenes that are on, so the next start is back where this one was. */
const sessionFile = path.join(pkg.dataDir, "session.json");
interface Session {
  open?: string;
  on?: string[];
}
let session: Session = {};
try {
  session = JSON.parse(fs.readFileSync(sessionFile, "utf8"));
} catch {
  // First start with B3-2.
}
// A Library or project scene moved or deleted since; a working scene not written yet is no news.
const lastGone = session.open && !fs.existsSync(session.open) && path.resolve(session.open).toLowerCase() !== WorkingScene.toLowerCase() ? session.open : undefined;
// An empty `open`: the player closed the scene, and none is open (a first start opens the working scene).
const scene = new Scene(session.open === "" ? "" : session.open && !lastGone ? session.open : WorkingScene);
if (scene.file) scene.load();
else scene.name = "";
/** Scenes shown but not edited (B3-2), by file: how many objects REDnode's world.load placed, once the world is ready. */
const onScenes = new Map<string, number>((session.on ?? []).filter((f) => fs.existsSync(f) && f !== scene.file).map((f) => [f, 0]));
let libraryRoot = readLibraryRoot();
const suggestedRoot = suggestedLibraryRoot();
/** Undo and redo (B3): the scene before each change, for this session, the last 100. */
const past: SceneState[] = [];
const future: SceneState[] = [];
const HistoryLength = 100;
/** Counts duplicates, so the page knows a new one's copies are there to move. */
let duplicates = 0;
const index = new AssetIndex(path.join(pkg.dataDir, "index"));
/** The game's people (B3c), read from TweakDB once per game version; searched with the index. */
const npcs = new NpcList(path.join(pkg.dataDir, "index"));
/** Mods' archives and the project's loose files; kept out of the index folder, whose newest file is taken as the game's index. */
const sources = new ModSources(path.join(pkg.dataDir, "sources", "mods.json"));
index.extra = sources.entries();
let bridge: Bridge | undefined;
let blockedRetry: ReturnType<typeof setTimeout> | undefined;
/** REDnode found no REDbridge, but EDGEbuilder's own lookup did: run that one. */
let ownBridge: string | undefined;
let gameKey = "";

const state: Snapshot = {
  noCollision: [],
  ready: true,
  world: "unknown",
  bridge: { status: "off" },
  index: { status: "none", count: 0 },
  npcs: { status: "none", count: 0 },
  results: [],
  query: { text: "", kind: "all", from: "all" },
  sources: { mods: { archives: sources.archiveCount, assets: sources.modAssets }, project: null },
  scene: { name: scene.name, objects: scene.objects, groups: scene.groups, file: scene.file, needs: [] },
  library: { root: libraryRoot, suggested: suggestedRoot, shelves: [], on: [], bakes: [] },
  bake: { project: null, checks: [], stale: false, list: [] },
  selected: [],
  history: { undo: 0, redo: 0 },
  settings: { ...settings, settingsFile },
  inUse: {},
};

function publish(): void {
  const at = whereIs(scene.file, placeRoots());
  state.scene = { name: scene.name, objects: scene.objects, groups: scene.groups, file: scene.file, needs: sceneNeeds(scene.objects.map((o) => o.resource), index.extra), place: at?.place, folder: at?.folder };
  state.library.root = libraryRoot;
  state.library.on = [...onScenes.keys()];
  state.selected = state.selected.filter((id) => scene.get(id));
  state.history = { undo: past.length, redo: future.length };
  state.settings = { ...settings, settingsFile };
  state.inUse.gameDir = gameDir();
  channel.post({ type: "state", state });
}

function say(text: string, tone: Snapshot["message"] extends infer M ? (M extends { tone: infer T } ? T : never) : never = "info"): void {
  state.message = { text, tone };
  console.log(text);
  publish();
}

// ---- the game folder and the bridge ---------------------------------------------------------

function gameDir(): string | undefined {
  if (isGameFolder(settings.gameDir)) return settings.gameDir;
  let dir = pkg.dir;
  for (let i = 0; i < 6; i++) {
    dir = path.dirname(dir);
    if (isGameFolder(dir)) return dir;
  }
  return undefined;
}

async function startBridge(): Promise<void> {
  bridge?.stop();
  bridge = undefined;
  clearTimeout(blockedRetry);
  // REDnode 0.17 and later share one REDbridge between packages, behind the "bridge" permission the
  // player grants in the Mod Manager. A REDbridge named in the settings, or an older REDnode, means
  // EDGEbuilder runs its own.
  if (!settings.bridgePath && !ownBridge && typeof kernel?.bridge === "function") return startKernelBridge(kernel.bridge);
  const exe = findBridge(settings.bridgePath) ?? ownBridge;
  if (!exe) {
    state.bridge = { status: "missing", detail: `No REDbridge found. Install it with EDGEdeck (Get REDbridge), or put its path in ${settingsFile} as "bridgePath".` };
    state.index = { status: "none", count: 0 };
    publish();
    return;
  }
  const dir = gameDir();
  state.inUse.bridge = exe;
  state.bridge = { status: "starting", path: exe, detail: dir ? undefined : "The game folder was not found; set gameDir in the settings" };
  publish();
  const b = new BridgeClient(exe, dir);
  b.onExit = (code) => {
    if (bridge === b) {
      state.bridge = { status: "failed", path: exe, detail: `REDbridge exited (${code ?? "signal"}). ${b.log.slice(-3).join(" | ")}` };
      bridge = undefined;
      publish();
    }
  };
  try {
    b.start();
    bridge = b;
    const info = await b.info();
    if (!info.gameLoaded) throw new Error("the bridge has no game loaded; set gameDir in the settings");
    await bridgeReady(info, exe);
  } catch (err) {
    state.bridge = { status: "failed", path: exe, detail: `${(err as Error).message}. ${b.log.slice(-3).join(" | ")}` };
    publish();
  }
}

async function startKernelBridge(get: () => Promise<{ version: string | null; source: string | null; call<T = any>(method: string, params?: Record<string, unknown>): Promise<T> }>): Promise<void> {
  state.bridge = { status: "starting", detail: "Asking REDnode for REDbridge" };
  publish();
  try {
    const handle = await get();
    state.inUse.bridge = `Shared by REDnode${handle.source ? `: the copy from ${handle.source}` : ""}${handle.version ? `, ${handle.version}` : ""}`;
    const b = new KernelBridge(handle);
    bridge = b;
    const info = await b.info();
    if (!info.gameLoaded) throw new Error("REDnode's REDbridge has no game loaded");
    await bridgeReady(info, handle.source ?? "REDnode");
  } catch (err) {
    bridge = undefined;
    const why = (err as Error).message;
    if (/allow/i.test(why)) {
      // Not allowed yet: ask once, then look again every few seconds so allowing it is enough.
      state.bridge = { status: "blocked", detail: "Allow REDbridge for EDGEbuilder in REDnode's Mod Manager: select EDGEbuilder, Permissions, switch Allowed on." };
      publish();
      blockedRetry = setTimeout(() => void startBridge(), 5000);
    } else if (/not installed/i.test(why)) {
      // REDnode releases before EDGEdeck look only where REDdeck and REDcode kept REDbridge.
      ownBridge = findBridge();
      if (ownBridge) {
        console.log(`REDnode found no REDbridge; running the one EDGEdeck fetched: ${ownBridge}`);
        return startBridge();
      }
      state.bridge = { status: "missing", detail: why };
      publish();
    } else {
      state.bridge = { status: "failed", detail: why };
      publish();
    }
  }
}

async function bridgeReady(info: { version: string; archives: number; files: number }, source: string): Promise<void> {
  state.bridge = { status: "ready", path: source, version: info.version };
  bakeSoon();
  gameKey = `${info.archives}-${info.files}`;
  console.log(`REDbridge ${info.version} ready (${source}), ${info.files} files in ${info.archives} archives`);
  publish();
  if (index.load(gameKey)) {
    state.index = { status: "ready", count: index.entries.length, file: index.file };
    publish();
  } else {
    await buildIndex();
  }
  await refreshMods();
  await readNpcs();
}

/** The game's people for Browse (B3c): from the list kept for this game, or read from TweakDB through REDbridge. */
async function readNpcs(again = false): Promise<void> {
  if (!again && npcs.load(gameKey)) {
    index.npcs = npcs.entries;
    state.npcs = { status: "ready", count: npcs.entries.length };
    return runSearch();
  }
  if (!bridge?.running || !gameKey) return;
  state.npcs = { status: "reading", count: 0, progress: "Reading the game's people from TweakDB (about 15 s the first time)" };
  publish();
  try {
    await npcs.build(bridge, gameKey, (text) => {
      state.npcs = { status: "reading", count: 0, progress: text };
      publish();
    });
    index.npcs = npcs.entries;
    state.npcs = { status: "ready", count: npcs.entries.length };
    console.log(`NPC list read: ${npcs.entries.length.toLocaleString()} people from the game's Character records`);
    runSearch();
  } catch (err) {
    // REDbridge before 0.8.0 reads no TweakDB: Browse goes on without people.
    state.npcs = { status: "failed", count: 0, progress: (err as Error).message };
    say(`NPCs are not listed: ${(err as Error).message}. They need REDbridge 0.8.0 or later.`, "warn");
    publish();
  }
}

async function buildIndex(): Promise<void> {
  if (!bridge?.running || !gameKey) return say("REDbridge is not running; the index needs it.", "warn");
  state.index = { status: "building", count: 0, progress: "starting" };
  publish();
  try {
    await index.build(bridge, gameKey, (text) => {
      state.index = { status: "building", count: index.entries.length, progress: text };
      publish();
    });
    state.index = { status: "ready", count: index.entries.length, file: index.file };
    say(`Asset index built: ${index.entries.length.toLocaleString()} meshes and entities.`, "ok");
    runSearch();
  } catch (err) {
    state.index = { status: "failed", count: 0, progress: (err as Error).message };
    say(`The asset index failed: ${(err as Error).message}`, "error");
  }
}

// ---- mods and the REDcode project (B2c) ------------------------------------------------------------

let modsBusy = false;
let modsAgain = false;

/** Reads the mod archives that are new or changed since last time. One read at a time; a change during one reads again after. */
async function refreshMods(): Promise<void> {
  const dir = gameDir();
  if (!bridge?.running || !dir) return;
  if (modsBusy) {
    modsAgain = true;
    return;
  }
  modsBusy = true;
  try {
    do {
      modsAgain = false;
      const { changed, failed } = await sources.refreshMods(bridge, modArchives(dir), (p) => index.isGamePath(p), (text) => {
        state.sources.mods.reading = text;
        publish();
      });
      if (failed.length) console.log(`Mod archives not read: ${failed.join("; ")}`);
      state.sources.mods = { archives: sources.archiveCount, assets: sources.modAssets };
      if (changed) console.log(`Mods: ${sources.modAssets} meshes and entities in ${sources.archiveCount} archives`);
      sourcesChanged();
    } while (modsAgain && bridge?.running);
  } catch (err) {
    state.sources.mods = { archives: sources.archiveCount, assets: sources.modAssets };
    say(`The mod archives could not be read: ${(err as Error).message}`, "warn");
  } finally {
    modsBusy = false;
  }
}

function sourcesChanged(): void {
  index.extra = sources.entries();
  runSearch();
}

/** Calls `run` once things have been quiet for a moment: a copy or a pack writes a file in many steps. */
function debounced(run: () => void, ms = 1500): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return () => {
    clearTimeout(timer);
    timer = setTimeout(run, ms);
  };
}

const modWatchers: fs.FSWatcher[] = [];
function watchMods(): void {
  const dir = gameDir();
  if (!dir || modWatchers.length) return;
  const changed = debounced(() => void refreshMods());
  for (const folder of modFolders(dir)) {
    try {
      modWatchers.push(fs.watch(folder, { recursive: true }, changed));
    } catch {
      // No such folder: no mods there.
    }
  }
}

interface RedcodeProject {
  name: string;
  modName: string;
  dir: string;
  archive: string;
  raw: string;
  resources: string;
}

let project: RedcodeProject | null = null;
let projectWatch: fs.FSWatcher | undefined;
const projectChanged = debounced(() => scanProject());

function scanProject(): void {
  sources.scanProject(project, (p) => index.isGamePath(p));
  state.sources.project = project ? { name: project.name, dir: project.dir, archive: project.archive, assets: sources.project.length } : null;
  sourcesChanged();
}

function setProject(next: RedcodeProject | null): void {
  if (next?.archive !== project?.archive) {
    projectWatch?.close();
    projectWatch = undefined;
    if (next) {
      try {
        projectWatch = fs.watch(next.archive, { recursive: true }, projectChanged);
      } catch {
        // No source\archive yet: the next project-changed or a restart picks it up.
      }
      console.log(`REDcode project: ${next.name} (${next.archive})`);
    } else if (project) {
      console.log("REDcode project closed");
    }
  }
  bakeSoon();
  project = next;
  scanLibrary();
  scanProject();
}

/** The project open in REDcode, through REDcode's REDnode service (REDcode 0.10.5 and later). Without it, mods only. */
let redcode: { project(): Promise<RedcodeProject | null> } | undefined;
let redcodeRetry: ReturnType<typeof setTimeout> | undefined;
/** The last try to reach REDcode's service failed: its package is not in the game. */
let redcodeFailed = false;
async function connectRedcode(): Promise<void> {
  if (typeof service?.connect !== "function") return;
  clearTimeout(redcodeRetry);
  try {
    const handle = await service.connect<{ project(): RedcodeProject | null }>("redcode");
    handle.$on("project-changed", (p: RedcodeProject | null) => setProject(p));
    redcode = handle as unknown as { project(): Promise<RedcodeProject | null> };
    redcodeFailed = false;
    setProject(await redcode.project());
  } catch (err) {
    redcode = undefined;
    redcodeFailed = true;
    console.log(`REDcode's service is not there (${(err as Error).message}); looking again in a minute, or at Refresh. Browse lists the game and mods meanwhile.`);
    redcodeRetry = setTimeout(() => void connectRedcode(), 60_000);
    lookAtBakes();
    publish();
  }
}

/** Refresh on the Bake and Library tabs: ask REDcode for its project again, now (B3c test on the laptop). */
async function askRedcodeAgain(): Promise<void> {
  if (!redcode) return connectRedcode();
  try {
    setProject(await redcode.project());
  } catch {
    redcode = undefined;
    await connectRedcode();
  }
}

/** The mod or project entry for a path that is not a game file. */
function sourceOf(assetPath: string): AssetEntry | undefined {
  const lower = assetPath.toLowerCase();
  return index.extra.find((e) => !e.replaces && e.path.toLowerCase() === lower);
}

/**
 * Whether the game's own archives have this path, beyond the folders the index covers (a project's
 * copy of a weapon mesh, say). Asked of REDbridge; false when it cannot answer.
 */
async function inGameArchives(assetPath: string): Promise<boolean> {
  if (index.isGamePath(assetPath)) return true;
  if (!bridge?.running) return false;
  try {
    const page = await bridge.list(assetPath.replace(/\//g, "\\"), 0, 1);
    return page.items.some((f) => f.name.toLowerCase() === assetPath.replace(/\//g, "\\").toLowerCase());
  } catch {
    return false;
  }
}

/**
 * What Browse shows for a person (B3c): its template's appearances, the record's own first when it names one,
 * else "the game picks" first; and a person's box.
 */
async function lookAtPerson(record: string): Promise<AssetInfo> {
  const e = npcs.find(record);
  if (!e?.template) return { appearances: [], bounds: PersonBounds, error: `${record} is not in the NPC list` };
  const own = e.appearance ? [e.appearance] : [AnyLook];
  if (!bridge?.running) return { appearances: own, bounds: PersonBounds };
  const info = await index.lookAt(bridge, e.template);
  const rest = (info.appearances ?? []).filter((a) => a !== e.appearance);
  return { appearances: [...own, ...rest], bounds: PersonBounds, ...(info.error ? { error: info.error } : {}) };
}

/** The appearance a person's entity shows, for one dropped with "the game picks": kept, so it looks the same next time. */
async function currentLook(entityId: string): Promise<string | undefined> {
  try {
    const entity = (await world.entity(entityId)) as (GameRef & { GetCurrentAppearanceName(): Promise<string> }) | null;
    const name = entity ? await entity.GetCurrentAppearanceName() : "";
    return name && name !== "None" ? name : undefined;
  } catch {
    return undefined;
  }
}

/** What REDbridge knows about an asset: from the game's archives, or from its mod's archive or the project (B2c-2). */
function assetInfo(b: Bridge, assetPath: string): Promise<AssetInfo> {
  const entry = sourceOf(assetPath);
  return entry ? sources.lookAt(b, entry) : index.lookAt(b, assetPath);
}

// ---- the world --------------------------------------------------------------------------------

/** Why the world cannot take a drop right now, in the player's words. */
function worldBlocker(): string {
  switch (state.world) {
    case "no-game":
      return "Not connected to the game. Start the game with REDnode, then load a save.";
    case "no-save":
      return "Load a save first.";
    case "no-codeware":
      return "The world API is not available: REDnode needs Codeware 1.14 or later in the game.";
    default:
      return "The world is not ready yet; try again in a moment.";
  }
}

async function checkWorld(): Promise<void> {
  const before = state.world;
  try {
    const s = await game.state();
    if (!s.connected) state.world = "no-game";
    else if (await world.available()) state.world = "ready";
    else state.world = s.mainMenu ? "no-save" : "no-codeware";
  } catch {
    state.world = "unknown";
  }
  if (state.world === "ready" && before !== "ready" && !editorCam && readBuilderRecord()) {
    await builderStop();
    say("Builder mode was still on from last time (EDGEbuilder stopped while Edit was on); V's camera and HUD are back.", "info");
    return;
  }
  if (state.world === "ready" && before !== "ready") {
    lookAtBakes();
    void inTurn("Show scenes that are on", () => reloadOn());
    previewsBackSoon();
  }
  publish();
}

interface Placement {
  position: [number, number, number];
  yaw: number;
}

/** A spot a few metres in front of V, facing V. */
async function inFrontOfPlayer(): Promise<Placement> {
  const player = await api.GetPlayer(game.instance);
  if (!player) throw new Error("No player: load a save first");
  const p = (await player.GetWorldPosition()) as { X: number; Y: number; Z: number };
  const f = (await player.GetWorldForward()) as { X: number; Y: number; Z: number };
  const yaw = (Math.atan2(f.X, -f.Y) * 180) / Math.PI;
  return { position: [p.X + f.X * SpawnDistance, p.Y + f.Y * SpawnDistance, p.Z], yaw };
}

/** How far Drop at click and Drop to floor look for a surface. */
const SurfaceReach = 1000;
/** The game's ground is solid only near the camera (B3-2 test, step 29), so a miss may not mean there is no ground. */
const NoSurface = `within ${SurfaceReach} m. The ground is solid only near the camera: fly closer and try again.`;

/**
 * Where a drop lands. Drop at click: on the first surface along the line through the clicked spot
 * (or 8 m along it when there is none). Else, with the editor camera, on the first surface the camera
 * looks at within 60 m (or 6 m ahead), else in front of V. Turned to face the camera either way.
 */
async function dropPlace(at?: { origin: V3; dir: V3 }): Promise<Placement> {
  if (at) {
    const { hit } = await raycast(at.origin, add(at.origin, mul(at.dir, SurfaceReach)));
    if (!hit) console.log(`Drop at click: nothing there within ${SurfaceReach} m; dropping 8 m along the line`);
    return { position: hit ?? add(at.origin, mul(at.dir, 8)), yaw: (Math.atan2(at.dir[0], -at.dir[1]) * 180) / Math.PI };
  }
  if (editorCam) {
    try {
      const b = basisFromMatrix((await editorCam.component.GetLocalToWorld()) as GameMatrix);
      const { hit } = await raycast(b.pos, add(b.pos, mul(b.fwd, 60)));
      const position = hit ?? add(b.pos, mul(b.fwd, 6));
      // Face the camera: the object's forward points back along the camera's heading.
      const yaw = (Math.atan2(b.fwd[0], -b.fwd[1]) * 180) / Math.PI;
      return { position, yaw };
    } catch (err) {
      console.log(`Drop at the camera: ${(err as Error).message}; dropping in front of V`);
    }
  }
  return inFrontOfPlayer();
}

/** Puts an object's preview in the world and remembers the entity. */
async function spawnPreview(o: SceneObject): Promise<void> {
  const [x, y, z] = o.transform.position;
  const [i, j, k, r] = o.transform.rotation;
  const position = { x, y, z };
  const orientation = { i, j, k, r };
  let id: { hash: string };
  if (o.kind === "mesh") {
    // REDnode's own mesh prop (0.39.0 and later), which REDnode can spawn again after an archive swap.
    const [sx, sy, sz] = o.transform.scale;
    ({ id } = await world.spawn({ mesh: o.resource, meshAppearance: o.appearance ?? "default", scale: { x: sx, y: sy, z: sz }, position, orientation, alwaysSpawned: true, tags: ["edgebuilder"] }));
  } else if (o.kind === "entity") {
    ({ id } = await world.spawn({ template: o.resource, position, orientation, appearance: o.appearance, alwaysSpawned: true, tags: ["edgebuilder"] }));
  } else if (o.kind === "npc") {
    // A person (B3c): REDnode holds a Character record where it stands and keeps it friendly to V.
    const from = o.record ? { record: o.record } : { template: o.resource };
    ({ id } = await world.spawn({ ...from, position, orientation, appearance: o.appearance, npc: true, alwaysSpawned: true, tags: ["edgebuilder"] }));
  } else {
    throw new Error(`Previews of ${o.kind} objects come in a later phase`);
  }
  o.entityId = id.hash;
}

async function removePreview(o: SceneObject): Promise<void> {
  if (!o.entityId) return;
  try {
    await world.remove(o.entityId);
  } catch (err) {
    console.log(`Remove ${o.id}: ${(err as Error).message}`);
  }
  delete o.entityId;
}

/** The game's own outline on the preview, or off. Best effort: the preview is selected either way. */
async function highlight(o: SceneObject | undefined, on: boolean): Promise<void> {
  if (!o?.entityId) return;
  try {
    const entity = await world.entity(o.entityId);
    if (!entity) return;
    const event = await api.$new("entRenderHighlightEvent", { seeThroughWalls: true, opacity: on ? 1 : 0, outlineIndex: on ? 1 : 0, fillIndex: 0 });
    await entity.QueueEvent(event);
  } catch (err) {
    console.log(`Highlight ${o.id} ${on ? "on" : "off"}: ${(err as Error).message}`);
  }
}

// ---- positioning (B2a) -----------------------------------------------------------------------------

const toPoint = (p: [number, number, number]) => ({ x: p[0], y: p[1], z: p[2] });
const toQuat = (q: [number, number, number, number]) => ({ i: q[0], j: q[1], k: q[2], r: q[3] });

/** Gives an object a new transform and puts its preview there. The caller saves and publishes. */
async function place(o: SceneObject, t: SceneTransform): Promise<void> {
  if (o.kind !== "mesh") t = { ...t, scale: [1, 1, 1] }; // an entity template keeps its own size
  if (o.kind === "npc") t = { ...t, rotation: upright(t.rotation) }; // a person stands upright
  const scaled = t.scale.some((s, i) => Math.abs(s - o.transform.scale[i]) > 1e-6);
  const same = sameTransform(o.transform, t);
  o.transform = t;
  if (!o.entityId) return;
  // The game keeps a person where they stand: no move or teleport takes (B3c test step 5), so a
  // person is spawned again at the new place.
  if (o.kind === "npc") {
    if (!same) await movePerson(o);
  } else if (scaled) await respawn(o);
  else await movePreview(o, t.position, t.rotation);
}

/**
 * Puts a person at their scene transform. Neither world.move nor the teleportation facility moves an NPC
 * (B3c test, step 5): the person's AI gets a teleport command, then the hold again; if they are not there
 * after a moment, they are spawned again there. The log says which way it went.
 */
async function movePerson(o: SceneObject): Promise<void> {
  const [x, y, z] = o.transform.position;
  const yaw = (2 * Math.atan2(o.transform.rotation[2], o.transform.rotation[3]) * 180) / Math.PI;
  try {
    const entity = o.entityId ? await world.entity(o.entityId) : null;
    const ai = entity ? ((await entity.GetAIControllerComponent()) as GameRef | null) : null;
    if (entity && ai) {
      await ai.SendCommand(await api.$new("AITeleportCommand", { position: { X: x, Y: y, Z: z, W: 1 }, rotation: yaw, doNavTest: false }));
      await new Promise((r) => setTimeout(r, 400));
      const p = (await entity.GetWorldPosition()) as { X: number; Y: number; Z: number };
      const off = Math.hypot(p.X - x, p.Y - y);
      if (off < 0.3) {
        await ai.SendCommand(await api.$new("AIHoldPositionCommand", { duration: 86400 }));
        console.log(`${o.id} moved by the AI's teleport command`);
        return;
      }
      console.log(`${o.id} not moved by the AI's teleport command (${off.toFixed(1)} m off): spawned again`);
    }
  } catch (err) {
    console.log(`${o.id}: the AI's teleport command failed (${(err as Error).message}): spawned again`);
  }
  await respawn(o);
}

/** A mesh component's scale is set when it is built, so a new scale (or file) means a new preview. */
async function respawn(o: SceneObject): Promise<void> {
  if (o.kind === "npc" && o.entityId) {
    // The new person first, then the old one goes, so there is no gap where nobody stands.
    const old = o.entityId;
    if (await trySpawn(o)) await world.remove(old).catch((err) => console.log(`Remove ${o.id}: ${(err as Error).message}`));
    else o.entityId = old;
    if (state.selected.includes(o.id)) await highlight(o, true);
    return;
  }
  await removePreview(o);
  await trySpawn(o);
  if (state.selected.includes(o.id)) await highlight(o, true);
}

/**
 * Spawns these objects' previews, wherever they are. `alwaysSpawned` (REDnode 0.58, #41) brings an object
 * in far from V, where the game would otherwise wait for V to come near.
 */
async function spawnAll(objects: SceneObject[], logWord = "Preview of"): Promise<{ shown: number; failed: number }> {
  const out = { shown: 0, failed: 0 };
  const todo = objects.filter((o) => o.kind !== "light");
  for (const [i, o] of todo.entries()) {
    if (stopAsked) {
      out.failed += todo.length - i;
      console.log(`Stopped: ${todo.length - i} preview${todo.length - i === 1 ? "" : "s"} not placed`);
      break;
    }
    progress(i, todo.length);
    if (await trySpawn(o, logWord)) out.shown++;
    else out.failed++;
  }
  return out;
}

/** Spawns a preview; the log says why when the game will not. */
async function trySpawn(o: SceneObject, logWord = "Preview of"): Promise<boolean> {
  if (o.kind === "light" || state.world !== "ready") return false;
  try {
    await spawnPreview(o);
    return true;
  } catch (err) {
    console.log(`${logWord} ${o.id}: ${(err as Error).message}`);
    return false;
  }
}

/** The page moved, turned or scaled objects: one undo step, or part of the one before (`merge`). */
async function setTransforms(items: { id: string; transform: SceneTransform }[], merge = false): Promise<void> {
  const known = items.filter((i) => scene.get(i.id));
  if (!known.length) return;
  if (!merge || !past.length) step();
  for (const i of known) await place(scene.get(i.id)!, i.transform);
  scene.save();
  publish();
}

// ---- undo and redo (B3) ------------------------------------------------------------------------------
//
// The scene as it was before each change (`past`, `future`, at the top). Undo puts one back and
// changes only the previews that differ; Redo the other way. Selecting and previews are not steps.

/** Call before a change: remembers the scene as it is, and forgets what Redo had. */
function step(before: SceneState = scene.state()): void {
  past.push({ ...before, selected: before.selected ?? [...state.selected] });
  if (past.length > HistoryLength) past.shift();
  future.length = 0;
}

async function travel(from: SceneState[], to: SceneState[], word: "Undo" | "Redo"): Promise<void> {
  const s = from.pop();
  if (!s) return say(`Nothing to ${word.toLowerCase()}.`, "info");
  to.push({ ...scene.state(), selected: [...state.selected] });
  const ch = scene.restore(s);
  for (const o of ch.gone) await removePreview(o);
  for (const o of ch.respawn) await respawn(o);
  for (const o of ch.move) {
    if (o.kind === "npc") await movePerson(o);
    else await movePreview(o, o.transform.position, o.transform.rotation).catch(() => undefined);
  }
  const spawned = await spawnAll(ch.spawn);
  scene.save();
  const moved = ch.move.length + ch.respawn.length;
  const missing = spawned.failed ? [`${spawned.failed} not in the world: Rebuild previews`] : [];
  const what = [
    moved ? `${moved} moved back` : "",
    ch.spawn.length ? `${ch.spawn.length} back${missing.length ? ` (${missing.join("; ")})` : ""}` : "",
    ch.gone.length ? `${ch.gone.length} taken out` : "",
  ].filter(Boolean);
  state.message = { text: `${word}${what.length ? `: ${what.join(", ")}` : ""}.`, tone: "ok" };
  console.log(state.message.text);
  const changed = [...ch.spawn, ...ch.respawn, ...ch.move].map((o) => o.id);
  // What changed, to see it; else what was selected then (Esc on a copy: the originals again).
  await select(changed.length ? changed : (s.selected ?? state.selected));
}

/** The collision groups a floor can be in. The first that answers is not always the nearest, so all are asked. */
const FloorGroups = ["Static", "Terrain", "PlayerBlocker"];

/** The nearest thing a straight line from `start` to `end` hits, across the floor groups, and what each said. */
async function raycast(start: V3, end: V3): Promise<{ hit?: V3; tried: string[] }> {
  const queries = (await api.GameInstance.GetSpatialQueriesSystem(game.instance)) as GameRef | null;
  if (!queries) return { tried: ["no spatial queries"] };
  let hit: V3 | undefined;
  let best = Infinity;
  const tried: string[] = [];
  for (const group of FloorGroups) {
    try {
      const r = (await queries.SyncRaycastByCollisionGroup({ X: start[0], Y: start[1], Z: start[2], W: 1 }, { X: end[0], Y: end[1], Z: end[2], W: 1 }, group, null, false, false)) as {
        result: boolean;
        out: { result: { position: { X: number; Y: number; Z: number } } };
      };
      const p = r.out?.result?.position;
      tried.push(`${group}: ${r.result && p ? p.Z.toFixed(2) : "miss"}`);
      if (r.result && p) {
        const at: V3 = [p.X, p.Y, p.Z];
        const d = Math.hypot(...sub(at, start));
        if (d < best) {
          best = d;
          hit = at;
        }
      }
    } catch (err) {
      tried.push(`${group}: ${(err as Error).message}`);
    }
  }
  return { hit, tried };
}

/** Puts each object's lowest point on whatever is below it: one undo step. */
async function dropToFloor(ids: string[]): Promise<void> {
  const objects = ids.map((id) => scene.get(id)).filter((o): o is SceneObject => !!o);
  if (!objects.length) return;
  if (state.world !== "ready") return say(worldBlocker(), "warn");
  const items: { id: string; transform: SceneTransform }[] = [];
  let fell = 0;
  for (const o of objects) {
    const t = await floorUnder(o);
    if (!t) continue;
    fell = o.transform.position[2] - t.position[2];
    items.push({ id: o.id, transform: t });
  }
  if (!items.length) return say(objects.length === 1 ? `Nothing solid below ${NoSurface}` : `Nothing solid below any of them ${NoSurface}`, "warn");
  await setTransforms(items);
  const missed = objects.length - items.length;
  if (objects.length === 1) say(`Dropped ${objects[0].id} to the floor, ${fell.toFixed(2)} m down.`, "ok");
  else say(`Dropped ${items.length} objects to the floor${missed ? `; ${missed} had nothing solid below ${NoSurface}` : ""}.`, missed ? "warn" : "ok");
}

/** Where an object would stand on whatever is below it, or nothing within reach. */
async function floorUnder(o: SceneObject): Promise<SceneTransform | undefined> {
  const [x, y, z] = o.transform.position;
  const lowest = (o.bounds?.min[2] ?? 0) * o.transform.scale[2];
  // Start just above the object's base, so an entity's own colliders above it are not hit.
  const startZ = z + lowest + 0.05;
  const { hit, tried } = await raycast([x, y, startZ], [x, y, startZ - SurfaceReach]);
  const floor = hit?.[2];
  console.log(`Drop to floor ${o.id} from z ${startZ.toFixed(2)}: ${tried.join("; ")}`);
  return floor === undefined ? undefined : { ...o.transform, position: [x, y, floor - lowest] };
}

// ---- builder mode (B2b) -----------------------------------------------------------------------------
//
// While Edit is on, the view comes from a camera of EDGEbuilder's own: an empty entity with a camera
// component, switched on with Activate. V stays where V is. The game's HUD is hidden by raising V's
// scene tier, as cutscenes do. What was changed is written to builder-mode.json first, so if
// EDGEbuilder stops while Edit is on, its next start puts V's camera and scene tier back.

const builderFile = path.join(pkg.dataDir, "builder-mode.json");
const CameraName = "edgebuilder_camera";
/** The scene tier that hides the HUD: SceneTier4, as the game's scenes use. */
const HudHiddenTier = 4;
let editorCam: { id: string; component: GameRef } | undefined;
/** Keeps the HUD hidden while builder mode is on: the game sets its own scene tier as a save finishes loading (B2b test). */
let tierWatch: ReturnType<typeof setInterval> | undefined;

interface BuilderRecord {
  entityId?: string;
  /** V's scene tier before EDGEbuilder raised it. */
  sceneTier?: number;
}

function readBuilderRecord(): BuilderRecord | undefined {
  try {
    return JSON.parse(fs.readFileSync(builderFile, "utf8")) as BuilderRecord;
  } catch {
    return undefined;
  }
}

function writeBuilderRecord(r: BuilderRecord): void {
  fs.mkdirSync(pkg.dataDir, { recursive: true });
  fs.writeFileSync(builderFile, JSON.stringify(r));
}

/** V's player-state blackboard and its SceneTier field. */
async function sceneTierBoard(): Promise<{ board: GameRef; id: unknown }> {
  const player = await api.GetPlayer(game.instance);
  if (!player) throw new Error("no player");
  const defs = (await api.GetAllBlackboardDefs()) as GameRef;
  const psm = (await defs.$get("PlayerStateMachine")) as GameRef;
  const system = (await api.GameInstance.GetBlackboardSystem(game.instance)) as GameRef;
  const board = (await system.GetLocalInstanced(await player.GetEntityID(), psm)) as GameRef | null;
  if (!board) throw new Error("V's player-state blackboard is not there");
  return { board, id: await psm.$get("SceneTier") };
}

/** Sets V's scene tier and returns the one before, or undefined when it could not be set. */
async function setSceneTier(value: number): Promise<number | undefined> {
  try {
    const { board, id } = await sceneTierBoard();
    const before = (await board.GetInt(id)) as number;
    await board.SetInt(id, value, true);
    const now = (await board.GetInt(id)) as number;
    console.log(`Scene tier ${before} -> ${value}${now === value ? "" : `, but it reads ${now}`}`);
    return before;
  } catch (err) {
    console.log(`Scene tier not set: ${(err as Error).message}`);
    return undefined;
  }
}

/**
 * Every second while builder mode hides the HUD: when the game has put its own scene tier back
 * (it does as a loading save hands control to the player), remember that one for later and raise
 * the tier again.
 */
function watchTier(): void {
  stopTierWatch();
  let busy = false;
  tierWatch = setInterval(() => {
    if (busy) return;
    busy = true;
    void (async () => {
      try {
        const { board, id } = await sceneTierBoard();
        const now = (await board.GetInt(id)) as number;
        if (now === HudHiddenTier) return;
        const record = readBuilderRecord() ?? {};
        record.sceneTier = now;
        writeBuilderRecord(record);
        console.log(`The game set scene tier ${now}; hiding the HUD again`);
        await board.SetInt(id, HudHiddenTier, true);
      } catch {
        // No player for a moment, as during a load; try again next second.
      } finally {
        busy = false;
      }
    })();
  }, 1000);
}

function stopTierWatch(): void {
  if (tierWatch) clearInterval(tierWatch);
  tierWatch = undefined;
}

/** V's own first-person camera, switched back on. */
async function playerCameraBack(): Promise<void> {
  try {
    const player = await api.GetPlayer(game.instance);
    const fpp = player ? ((await player.GetFPPCameraComponent()) as GameRef | null) : null;
    if (fpp) await fpp.Activate(0, false);
  } catch (err) {
    console.log(`V's camera: ${(err as Error).message}`);
  }
}

/** Builder mode is on: Edit is on and the mod has done what the switches ask. */
let builderOn = false;
/** Solo mode: other packages' windows hidden while Edit is on. Said once when it is not allowed. */
let soloOn = false;
let soloAsked = false;

async function setSolo(on: boolean): Promise<void> {
  if (typeof ui?.solo !== "function" || on === soloOn) return;
  try {
    await ui.solo(on);
    soloOn = on;
  } catch (err) {
    if (on && !soloAsked) {
      soloAsked = true;
      say(`Other windows stay while editing (${(err as Error).message.replace(/^rednode:\s*/, "")}). To hide them, allow Solo for EDGEbuilder in REDnode's Mod Manager.`, "info");
    }
  }
}
/** Builder changes one at a time: Edit on and off and the switches may arrive close together. */
let builderQueue: Promise<void> = Promise.resolve();
function queued(op: () => Promise<void>): Promise<void> {
  builderQueue = builderQueue.then(op, op);
  return builderQueue;
}

/**
 * Scene changes one at a time (B3): each awaits the game for its previews, and Ctrl+Z held down or a
 * drag's keep followed by an undo must not interleave. A failed change does not stop the next.
 */
let sceneQueue: Promise<void> = Promise.resolve();
/** Changes asked for and not finished, the running one included. */
let waiting = 0;
/** The running change, for the page's busy bar once it has run for `BusyAfter` ms. */
let running: { what: string; done?: number; total?: number; since: number } | undefined;
const BusyAfter = 500;

function inTurn(what: string, op: () => Promise<void> | void): Promise<void> {
  waiting++;
  if (state.busy) showBusy();
  const run = async () => {
    running = { what, since: Date.now() };
    stopAsked = false;
    const timer = setTimeout(showBusy, BusyAfter);
    try {
      await op();
    } finally {
      clearTimeout(timer);
      running = undefined;
      waiting--;
      if (state.busy) {
        state.busy = undefined;
        publish();
      }
    }
  };
  sceneQueue = sceneQueue.then(run, run);
  return sceneQueue;
}

function showBusy(): void {
  if (!running) return;
  state.busy = { ...running, waiting: Math.max(0, waiting - 1) };
  publish();
}

/** Stop asked for: the running change places no more previews. */
let stopAsked = false;

/** How far the running change is: `done` of `total`. */
function progress(done: number, total: number): void {
  if (!running) return;
  running.done = done;
  running.total = total;
  if (state.busy) showBusy();
}

type Pose = { position: [number, number, number]; rotation: [number, number, number, number]; fov: number };

/** Where V looks from now, for an editor camera switched on while Edit is already on. */
async function playerPose(): Promise<Pose> {
  const player = await api.GetPlayer(game.instance);
  const fpp = player ? ((await player.GetFPPCameraComponent()) as GameRef | null) : null;
  if (!fpp) throw new Error("V's camera is not available");
  const b = basisFromMatrix((await fpp.GetLocalToWorld()) as GameMatrix);
  const camSys = (await api.GameInstance.GetCameraSystem(game.instance)) as GameRef | null;
  const fov = camSys ? ((await camSys.GetActiveCameraFOV()) as number) : 0;
  return { position: b.pos, rotation: qLook(lookOf(b.fwd)), fov };
}

async function cameraOn(pose: Pose): Promise<void> {
  if (editorCam) return;
  const component = (await api.$new("gameCameraComponent", { name: CameraName })) as GameRef;
  const { id, entity } = await world.spawn({ template: EmptyEntity, position: toPoint(pose.position), orientation: toQuat(pose.rotation), components: [component], alwaysSpawned: true, tags: ["edgebuilder", CameraName] });
  writeBuilderRecord({ ...readBuilderRecord(), entityId: id.hash });
  const attached = entity ? ((await entity.FindComponentByName(CameraName)) as GameRef | null) : null;
  const cam = attached ?? component;
  if (pose.fov > 1) await cam.SetFOV(pose.fov);
  await cam.Activate(0, false);
  editorCam = { id: id.hash, component: cam };
}

/** Back to V's camera; the record keeps the scene tier if the HUD is still hidden. */
async function cameraOff(): Promise<void> {
  const record = readBuilderRecord();
  const camId = editorCam?.id ?? record?.entityId;
  if (editorCam) {
    try {
      await editorCam.component.Deactivate(0, false);
    } catch {
      // Gone with a save load, or already off.
    }
  }
  if (camId) {
    try {
      await world.remove(camId);
    } catch {
      // Already gone.
    }
  }
  if (camId || editorCam) await playerCameraBack();
  editorCam = undefined;
  if (record?.entityId) {
    delete record.entityId;
    writeBuilderRecord(record);
  }
}

/** Hides the game's HUD; true when it is hidden. */
async function hudOff(): Promise<boolean> {
  if (tierWatch) return true;
  const before = await setSceneTier(HudHiddenTier);
  if (before === undefined) return false;
  // Tier 0 is what a save reads while it is still loading; play is tier 1.
  writeBuilderRecord({ ...readBuilderRecord(), sceneTier: before === HudHiddenTier || before === 0 ? 1 : before });
  watchTier();
  return true;
}

async function hudOn(): Promise<void> {
  stopTierWatch();
  const record = readBuilderRecord();
  if (record?.sceneTier === undefined) return;
  await setSceneTier(record.sceneTier);
  delete record.sceneTier;
  writeBuilderRecord(record);
}

function publishCamera(): void {
  state.camera = editorCam ? { entityId: editorCam.id, hudHidden: !!tierWatch } : undefined;
  publish();
}

/** What the switches leave as the game has it, said once as Edit goes on. */
function switchesNote(): string | undefined {
  const off = [settings.editorCamera === false ? "EDGEbuilder's own camera" : "", settings.hideHud === false ? "hiding the game's HUD" : ""].filter(Boolean);
  if (!off.length) return undefined;
  return `${settings.editorCamera === false ? "Editing from V's camera" : "Editing"}: ${off.join(" and ")} ${off.length === 1 ? "is" : "are"} off in Settings.`;
}

async function builderStart(pose: Pose): Promise<void> {
  if (builderOn) return;
  if (state.world !== "ready") return say(worldBlocker(), "warn");
  builderOn = true;
  try {
    if (settings.editorCamera !== false) await cameraOn(pose);
  } catch (err) {
    say(`The editor camera could not start (${(err as Error).message}); editing with V's camera.`, "warn");
    await cameraOff();
  }
  const hidden = settings.hideHud !== false && (await hudOff());
  await setSolo(true);
  console.log(`Builder mode on: ${editorCam ? `editor camera ${editorCam.id}` : "V's camera"}${hidden ? ", HUD hidden" : ""}`);
  const note = switchesNote();
  if (note) say(note, "info");
  publishCamera();
}

/** A Settings switch changed: apply it now when Edit is on. */
async function builderSwitches(): Promise<void> {
  if (!builderOn) return;
  try {
    if (settings.editorCamera === false && editorCam) {
      await cameraOff();
      console.log("Editor camera off from Settings");
    } else if (settings.editorCamera !== false && !editorCam) {
      await cameraOn(await playerPose());
      console.log(`Editor camera ${editorCam!.id} on from Settings`);
    }
  } catch (err) {
    say(`The editor camera could not start (${(err as Error).message}); editing with V's camera.`, "warn");
    await cameraOff();
  }
  if (settings.hideHud === false && tierWatch) await hudOn();
  else if (settings.hideHud !== false && !tierWatch) await hudOff();
  publishCamera();
}

/** Back to V's camera and scene tier; also cleans up after a builder mode left on by a stopped EDGEbuilder. */
async function builderStop(): Promise<void> {
  const record = readBuilderRecord();
  const wasOn = builderOn || !!record;
  builderOn = false;
  await cameraOff();
  await hudOn();
  stopTierWatch();
  await setSolo(false);
  state.camera = undefined;
  try {
    fs.rmSync(builderFile, { force: true });
  } catch {
    // Nothing to remove.
  }
  if (wasOn) console.log("Builder mode off");
  publish();
}

// ---- requests from the page -------------------------------------------------------------------

function runSearch(): void {
  state.results = index.entries.length || index.extra.length ? index.search(state.query.text, state.query.kind, ResultLimit, state.query.from) : [];
  publish();
}

async function drop(assetPath: string, appearance?: string, at?: { origin: V3; dir: V3 }): Promise<void> {
  if (!scene.file) return say(NoScene, "warn");
  const person = isRecord(assetPath) ? npcs.find(assetPath) : undefined;
  if (isRecord(assetPath) && !person) return say(`${assetPath} is not in the NPC list.`, "warn");
  const kind = person ? "npc" : kindOf(assetPath);
  if (!kind) return say(`${assetPath} is not a mesh or an entity template.`, "warn");
  // A person's look: the one picked, the record's own, or none (the game picks, and the drop keeps it).
  const look = person ? (appearance === AnyLook ? undefined : (appearance ?? person.appearance)) : appearance;
  if (state.world !== "ready") await checkWorld();
  if (state.world !== "ready") return say(worldBlocker(), "warn");
  let added: SceneObject | undefined;
  const before = scene.state();
  try {
    const place = await dropPlace(at);
    const t: SceneTransform = { position: place.position, rotation: yawToQuaternion(place.yaw), scale: [1, 1, 1] };
    const o = person ? scene.add("npc", undefined, t, look, person.path) : scene.add(kind, assetPath, t, look);
    added = o;
    if (kind === "mesh") o.solid = true;
    if (person) {
      o.bounds = PersonBounds;
      o.props = { behaviour: "idle" };
    }
    let sized = true;
    if (bridge?.running && !person) {
      try {
        const info = await assetInfo(bridge, assetPath);
        if (info.bounds) o.bounds = info.bounds;
        else sized = false;
      } catch {
        // Bounds are a nicety for the bake; the drop goes ahead without them.
      }
    }
    const started = Date.now();
    await spawnPreview(o);
    if (person && !o.appearance && o.entityId) o.appearance = await currentLook(o.entityId);
    scene.save();
    step(before);
    await select([o.id]);
    const from = sourceOf(assetPath)?.source;
    const note =
      from?.kind === "project"
        ? (await inGameArchives(assetPath))
          ? ` From the REDcode project ${from.name}, at a game file's path: the game shows its own version until the project is packed and loaded (REDcode's Pack and Play).`
          : ` From the REDcode project ${from.name}: the game shows it once the project is packed and loaded (REDcode's Pack and Play).`
        : from?.kind === "mod"
          ? ` From ${from.name}.${sized ? "" : " Its size is not known, so the gizmo uses a 1 m box."}`
          : "";
    const what = person ? `${person.name ?? person.path}${o.appearance ? ` (${o.appearance})` : ""}` : path.basename(assetPath);
    say(`Dropped ${what} in ${Date.now() - started} ms.${note}`, "ok");
  } catch (err) {
    // The object went into the scene before the game was asked to spawn it: take it out again,
    // so a failed drop leaves nothing behind.
    if (added) {
      await removePreview(added);
      scene.remove(added.id);
    }
    say(`Drop failed, nothing was added: ${(err as Error).message}`, "error");
  }
}

/** Selects these objects: the game's outline goes on them and off the others. */
async function select(ids: string[]): Promise<void> {
  ids = ids.filter((id, i) => scene.get(id) && ids.indexOf(id) === i);
  const off = state.selected.filter((id) => !ids.includes(id));
  const on = ids.filter((id) => !state.selected.includes(id));
  state.selected = ids;
  for (const id of off) await highlight(scene.get(id), false);
  for (const id of on) await highlight(scene.get(id), true);
  publish();
}

async function remove(ids: string[]): Promise<void> {
  const objects = ids.map((id) => scene.get(id)).filter((o): o is SceneObject => !!o);
  if (!objects.length) return;
  step();
  for (const o of objects) {
    await removePreview(o);
    scene.remove(o.id);
  }
  say(objects.length === 1 ? `Removed ${objects[0].id}. Undo brings it back.` : `Removed ${objects.length} objects. Undo brings them back.`, "ok");
}

/** Groups the selection (Ctrl+G). */
function group(ids: string[]): void {
  const before = scene.state();
  const id = makeGroup(ids.filter((x) => scene.get(x)), scene.objects, scene.groups);
  if (!id) return say("Select something to group first.", "warn");
  step(before);
  scene.save();
  const g = scene.groups.find((x) => x.id === id)!;
  say(`Grouped ${ids.length} object${ids.length === 1 ? "" : "s"} as ${g.name}. A click on one now selects the group; Alt+click picks one.`, "ok");
}

/** Opens the selected groups, or takes picked objects out of theirs (Ctrl+Shift+G). */
function ungroup(ids: string[]): void {
  const before = scene.state();
  const opened = openGroups(ids.filter((x) => scene.get(x)), scene.objects, scene.groups);
  if (JSON.stringify(before) === JSON.stringify(scene.state())) return say("Nothing selected is in a group.", "info");
  step(before);
  scene.save();
  say(opened ? `Ungrouped ${opened} group${opened === 1 ? "" : "s"}.` : "Taken out of the group.", "ok");
}

function rename(groupId: string, name: string): void {
  const g = scene.groups.find((x) => x.id === groupId);
  name = name.trim();
  if (!g || !name || name === g.name) return publish();
  step();
  g.name = name;
  scene.save();
  say(`Renamed the group ${name}.`, "ok");
}

/** Copies the selection (Ctrl+D) and selects the copies; without `offset` the page moves them next. */
/** What Ctrl+C kept, for Ctrl+V. For the session; a paste can come after the originals are gone. */
let clipboard: Clip | undefined;

function copy(ids: string[]): void {
  ids = ids.filter((x) => scene.get(x));
  if (!ids.length) return say("Select something to copy first.", "warn");
  clipboard = copyOf(ids, scene.objects, scene.groups);
  const n = clipboard.objects.length;
  say(`Copied ${n} object${n === 1 ? "" : "s"}. Ctrl+V pastes ${n === 1 ? "it" : "them"} where the cursor points.`, "ok");
}

/** Ctrl+X: a copy for Ctrl+V, then a delete (one undo step, as Delete is). */
async function cut(ids: string[]): Promise<void> {
  ids = ids.filter((x) => scene.get(x));
  if (!ids.length) return say("Select something to cut first.", "warn");
  clipboard = copyOf(ids, scene.objects, scene.groups);
  await remove(ids);
  const n = clipboard.objects.length;
  say(`Cut ${n} object${n === 1 ? "" : "s"}. Ctrl+V pastes ${n === 1 ? "it" : "them"} where the cursor points; Ctrl+Z puts ${n === 1 ? "it" : "them"} back.`, "ok");
}

/** Ctrl+V: the copies, their box's bottom middle where the line through the cursor meets a surface. */
async function paste(at?: { origin: V3; dir: V3 }): Promise<void> {
  if (!scene.file) return say(NoScene, "warn");
  if (!clipboard) return say("Nothing copied yet: select something and press Ctrl+C.", "warn");
  if (state.world !== "ready") await checkWorld();
  if (state.world !== "ready") return say(worldBlocker(), "warn");
  const spot = await dropPlace(at);
  step();
  const p = pasteOf(clipboard, scene.objects, scene.groups, sub(spot.position, standPoint(clipboard.objects)));
  scene.groups.push(...p.groups);
  scene.objects.push(...p.objects);
  const r = await spawnAll(p.objects);
  scene.save();
  const n = p.objects.length;
  const missing = n - r.shown;
  state.message = { text: `Pasted ${n} object${n === 1 ? "" : "s"}${missing ? ` (${missing} not in the world)` : ""}.`, tone: missing ? "warn" : "ok" };
  console.log(state.message.text);
  await select(p.objects.map((o) => o.id));
}

async function duplicate(ids: string[], offset?: V3): Promise<void> {
  ids = ids.filter((x) => scene.get(x));
  if (!ids.length) return say("Select something to copy first.", "warn");
  if (state.world !== "ready") await checkWorld();
  if (state.world !== "ready") return say(worldBlocker(), "warn");
  step();
  const copies = copySelection(ids, scene.objects, scene.groups, offset);
  scene.groups.push(...copies.groups);
  scene.objects.push(...copies.objects);
  let shown = 0;
  for (const o of copies.objects) if (await trySpawn(o)) shown++;
  scene.save();
  state.duplicated = { seq: ++duplicates, ids: copies.objects.map((o) => o.id) };
  const n = copies.objects.length;
  state.message = {
    text: `Copied ${n} object${n === 1 ? "" : "s"}${shown < n ? ` (${n - shown} not in the world)` : ""}.${offset ? "" : " Move the copy and click to place it; Esc takes it back."}`,
    tone: shown < n ? "warn" : "ok",
  };
  await select(state.duplicated.ids);
}

async function rebuild(): Promise<void> {
  if (state.world !== "ready") await checkWorld();
  if (state.world !== "ready") return say(worldBlocker(), "warn");
  const r = await spawnAll(
    scene.objects.filter((o) => !o.entityId),
    "Rebuild",
  );
  scene.save();
  const n = r.shown;
  say(`${n} preview${n === 1 ? "" : "s"} back in the world${r.failed ? `; ${r.failed} the game did not place (the log says why)` : ""}.`, r.failed ? "warn" : "ok");
}

/**
 * The open scene's previews come back by themselves once a save is in (0.6.1, the B3-2 test), as the
 * scenes that are on do. Waits a moment: the game says OnGameAttached more than once as a save comes in
 * (twice, 14 s apart, at a game start).
 */
const PreviewsBackDelay = 2000;
let previewsTimer: ReturnType<typeof setTimeout> | undefined;
/** Previews are waiting for V to be in the world: `game.onState` starts them. */
let backWhenIn = false;
function previewsBackSoon(delay = PreviewsBackDelay): void {
  clearTimeout(previewsTimer);
  previewsTimer = setTimeout(() => void inTurn("Put previews back", () => previewsBack()), delay);
}
/** How long after a save loads previews the game would not place yet are tried again, and how often. */
const RetryFor = 90_000;
const RetryEvery = 5_000;

async function previewsBack(): Promise<void> {
  if (state.world !== "ready") return;
  const away = scene.objects.filter((o) => !o.entityId && o.kind !== "light");
  if (!away.length) return void (backWhenIn = false);
  // The first OnGameAttached of a game start comes during the load: REDnode can spawn by then, but what
  // it spawns goes again as the load goes on, and it cannot find the entity (0.6.6, game start).
  if (!(await game.state()).world) {
    // game.onState starts them when V is in. Its change can come while the state above was on its way,
    // and is then missed (B3c test, a game start on the laptop: the open scene stayed empty), so look
    // again in a moment as well, until the world is in or gone.
    backWhenIn = true;
    console.log(`${scene.name}: ${away.length} object${away.length === 1 ? "" : "s"} wait for V to be in the world`);
    previewsBackSoon();
    return;
  }
  backWhenIn = false;
  lookAtBakes();
  if (state.bake.inGame) return say(BakedOff(scene.name, state.bake.inGame), "info");
  // Never two of one object: previews from before a repeated OnGameAttached may still stand.
  const kept = new Set(scene.objects.map((o) => o.entityId));
  kept.add(editorCam?.id);
  for (const s of world.spawned?.() ?? []) if (!s.scene && s.attached && !kept.has(s.id.hash)) await world.remove(s.id).catch(() => false);
  const r = await spawnAll(away, "Back");
  // People in particular are not placed while the save still settles (B3c test, a game start on the
  // laptop: both stayed away until Go to spawned them): try those again for a while.
  const again = r.failed > 0 && !stopAsked && Date.now() - attachedAt < RetryFor;
  if (again) {
    console.log(`${scene.name}: ${r.failed} not placed yet; trying again in ${RetryEvery / 1000} s`);
    previewsBackSoon(RetryEvery);
  }
  say(`${scene.name}: ${r.shown} of ${away.length} object${away.length === 1 ? "" : "s"} back in the world${r.failed ? `; ${r.failed} the game did not place${again ? " yet, trying again" : " (the log says why)"}` : ""}.`, r.failed && !again ? "warn" : "ok");
}

/**
 * The Objects drawer's two clicks: the object selected and in the world. The page moves the camera
 * (it owns the pose).
 */
async function goTo(id: string): Promise<void> {
  const o = scene.get(id);
  if (!o) return;
  if (state.world !== "ready") return say(worldBlocker(), "warn");
  const noCamera = state.settings.editorCamera === false ? " The editor camera is off in Settings, so the view stayed where it is." : "";
  if (!o.entityId && o.kind !== "light") {
    try {
      await spawnPreview(o);
    } catch (err) {
      console.log(`Go to ${id}: ${(err as Error).message}`);
      await select([id]);
      return say(`${id} is selected, but the game did not place its preview (the log says why). There is no gizmo without a preview; its numbers in the Selected panel still work.${noCamera}`, "warn");
    }
  }
  await select([id]);
  await highlight(o, true);
  await spawnAll(scene.objects.filter((x) => !x.entityId));
  say(`${id} is selected.${noCamera}`, "ok");
}

/** The Objects drawer's view of a scene that is not open. */
function peek(file: string): void {
  try {
    const d = readSceneFile(file);
    state.library.peek = { file, name: d.name, objects: d.objects, groups: d.groups ?? [] };
  } catch (err) {
    delete state.library.peek;
    say(`${path.basename(file)} cannot be read: ${(err as Error).message}.`, "error");
  }
  publish();
}

/** The drawer's trash: from the open scene with Undo, from another scene's file without. */
async function removeFromScene(file: string, id: string): Promise<void> {
  if (sameFile(file, scene.file)) return remove([id]);
  const other = new Scene(file);
  try {
    other.load();
    if (!other.remove(id)) return peek(file);
  } catch (err) {
    return say(`${path.basename(file)}: ${(err as Error).message}.`, "error");
  }
  const shown = [...onScenes.keys()].find((f) => sameFile(f, file));
  if (shown && state.world === "ready") await loadOn(shown).catch((err) => console.log(`${path.basename(shown)} not shown: ${(err as Error).message}`));
  scanLibrary();
  peek(file);
  say(`Removed ${id} from ${other.name}. That scene is not open, so Undo cannot bring it back.`, "ok");
}

async function clear(): Promise<void> {
  if (!scene.objects.length && !scene.groups.length) return say("The scene is already empty.", "info");
  step();
  for (const o of scene.objects) await removePreview(o);
  scene.clear();
  state.selected = [];
  say("Scene cleared. Undo brings it back.", "ok");
}

// ---- scenes and the Library (B3-2) -----------------------------------------------------------------
//
// The open scene is a file in one of three places; every change is saved to it at once. Other scenes
// can be on: REDnode's world.load places them, and EDGEbuilder neither selects nor changes them.

/** The places scenes live, the Library first when it has a root. */
function placeRoots(): PlaceRoot[] {
  const out: PlaceRoot[] = [];
  if (libraryRoot) out.push({ place: "library", dir: libraryRoot, label: "Library" });
  // REDcode gives source\archive; scenes sit beside it, in source\scenes.
  if (project) out.push({ place: "project", dir: path.join(path.dirname(project.archive), "scenes"), label: `Project: ${project.name}` });
  out.push({ place: "data", dir: dataScenes, label: "This PC" });
  return out;
}

function rootOf(place: Place): PlaceRoot {
  const r = placeRoots().find((x) => x.place === place);
  if (r) return r;
  throw new Error(place === "library" ? "Set the Library folder in Settings first." : "No REDcode project is open.");
}

/** Reads the three places again, for the Library tab. */
function scanLibrary(): void {
  state.library.shelves = placeRoots().map(scanShelf);
  libraryBakeDirs = scanBakes(libraryRoot).map(({ dir, folder }) => ({ dir, folder }));
  lookAtLibraryBakes();
}

/** Where a scene file is, for messages: "Library > Alleys", "This PC", or the file itself. */
function whereText(file: string): string {
  const roots = placeRoots();
  const at = whereIs(file, roots);
  if (!at) return file;
  const label = roots.find((r) => r.place === at.place)!.label;
  return at.folder ? `${label} > ${at.folder.replace(/\//g, " > ")}` : label;
}

function writeSession(): void {
  try {
    fs.mkdirSync(pkg.dataDir, { recursive: true });
    fs.writeFileSync(sessionFile, JSON.stringify({ open: scene.file, on: [...onScenes.keys()] }, null, 2));
  } catch (err) {
    console.log(`session.json not written: ${(err as Error).message}`);
  }
}

const sameFile = (a: string, b: string) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

/** Takes the open scene's previews out and makes `data` the open scene, saved to `file`, with a fresh history. */
async function switchTo(data: SceneFile, file: string): Promise<void> {
  for (const o of scene.objects) await removePreview(o);
  state.selected = [];
  state.duplicated = undefined;
  past.length = 0;
  future.length = 0;
  scene.take(data, file);
  writeSession();
}

const NoScene = "No scene is open: open one or make one on the Library tab.";

/** Its objects leave the world and nothing is open; the file is already saved. Undo starts again with the next scene. */
async function closeScene(): Promise<void> {
  if (!scene.file) return say("No scene is open.", "info");
  const was = scene.name;
  const where = whereText(scene.file);
  await switchTo({ format: 1, name: "", groups: [], objects: [] }, "");
  scanLibrary();
  scene.onSave?.();
  say(`Closed ${was}. It is saved in ${where}; the Library tab opens it again.`, "ok");
}

async function openScene(file: string): Promise<void> {
  if (sameFile(file, scene.file)) return say(`${scene.name} is already open.`, "info");
  let data: SceneFile;
  try {
    data = readSceneFile(file);
  } catch (err) {
    return say(`${path.basename(file)} cannot be opened: ${(err as Error).message}.`, "error");
  }
  // A scene that is on becomes the open one: its shown copy goes, its previews come.
  const wasOn = [...onScenes.keys()].find((f) => sameFile(f, file));
  if (wasOn) await sceneOff(wasOn);
  await switchTo(data, file);
  scanLibrary();
  scene.onSave?.();
  const n = scene.objects.length;
  if (state.world !== "ready") return say(`Opened ${scene.name} (${whereText(file)}), ${n} object${n === 1 ? "" : "s"}. Rebuild previews once a save is loaded.`, "ok");
  lookAtBakes();
  if (state.bake.inGame) return say(BakedOff(scene.name, state.bake.inGame), "info");
  const r = await spawnAll(scene.objects);
  const rest = r.failed ? [`${r.failed} the game did not place`] : [];
  say(`Opened ${scene.name} (${whereText(file)}): ${r.shown} of ${n} object${n === 1 ? "" : "s"} in the world${rest.length ? `; ${rest.join("; ")}` : ""}.`, r.failed ? "warn" : "ok");
}

/** The file a new or saved-as scene goes to; refuses a name another scene there already has. */
function newFile(name: string, place: Place, folder: string | undefined): { name: string; file: string } {
  name = name.trim();
  if (!name) throw new Error("Give the scene a name.");
  const dir = folderIn(rootOf(place).dir, folder);
  const file = path.join(dir, fileNameOf(name));
  if (fs.existsSync(file)) throw new Error(`${whereText(file)} already has a scene called ${path.basename(file)}: open it, or pick another name.`);
  return { name, file };
}

/** A refusal the player can act on (a name taken, no Library yet): a warning, not an error. */
function attempt<T>(make: () => T): T | undefined {
  try {
    return make();
  } catch (err) {
    say((err as Error).message, "warn");
    return undefined;
  }
}

async function newScene(name: string, place: Place, folder?: string): Promise<void> {
  const t = attempt(() => newFile(name, place, folder));
  if (!t) return;
  const was = scene.name;
  await switchTo({ format: 1, name: t.name, groups: [], objects: [] }, t.file);
  scene.save();
  scanLibrary();
  say(`New scene ${t.name} in ${whereText(t.file)}.${was ? ` ${was} is saved where it was; the Library tab opens it again.` : ""}`, "ok");
}

/** A copy of the open scene, which becomes the open scene; its previews and history stay. */
function saveAs(name: string, place: Place, folder?: string): void {
  if (!scene.file) return say(NoScene, "warn");
  const t = attempt(() => newFile(name, place, folder));
  if (!t) return;
  const was = scene.file;
  scene.file = t.file;
  scene.name = t.name;
  scene.save();
  writeSession();
  scanLibrary();
  say(`Saved as ${t.name} in ${whereText(t.file)}; that is the open scene now. The one before is still in ${whereText(was)}.`, "ok");
}

/** A new name, and the file renamed to match (in the same folder). */
function renameScene(name: string): void {
  if (!scene.file) return publish();
  name = name.trim();
  if (!name || name === scene.name) return publish();
  const was = scene.file;
  const file = path.join(path.dirname(was), fileNameOf(name));
  const sameName = sameFile(file, was);
  if (!sameName && fs.existsSync(file)) return say(`${whereText(file)} already has a scene called ${path.basename(file)}. Pick another name.`, "warn");
  scene.name = name;
  scene.file = file;
  scene.save();
  if (!sameName) {
    try {
      fs.rmSync(was, { force: true });
    } catch (err) {
      console.log(`The old file ${was} was not removed: ${(err as Error).message}`);
    }
  }
  writeSession();
  scanLibrary();
  say(`Renamed the scene ${name}${sameName ? "" : ` (${path.basename(file)})`}.`, "ok");
}

/** Ctrl+S. Every change is saved already; this writes the file once more and says where it is. */
function saveNow(): void {
  scene.save();
  scanLibrary();
  say(`Saved ${scene.name} in ${whereText(scene.file)}. (EDGEbuilder saves after every change.)`, "ok");
}

/** Places a scene that is on, through REDnode. Far objects are created at once and come into the world when V or the camera gets near. */
async function loadOn(file: string): Promise<number> {
  if (typeof world.load !== "function") throw new Error("Showing other scenes needs REDnode 0.40.1 or later");
  const r = await world.load(readSceneFile(file), { name: file, wait: false, alwaysSpawned: true });
  for (const s of r.skipped) console.log(`${path.basename(file)}: ${s.object} not shown: ${s.why}`);
  onScenes.set(file, r.spawned.length);
  return r.spawned.length;
}

async function sceneOn(file: string): Promise<void> {
  if (sameFile(file, scene.file)) return say("That is the open scene: its objects are in the world already.", "info");
  try {
    readSceneFile(file);
  } catch (err) {
    return say(`${path.basename(file)} cannot be shown: ${(err as Error).message}.`, "error");
  }
  onScenes.set(file, 0);
  writeSession();
  if (state.world !== "ready") return say(`${path.basename(file)} is on; it shows once a save is loaded.`, "info");
  const n = await loadOn(file);
  say(`Showing ${path.basename(file)}: ${n} object${n === 1 ? "" : "s"}. They cannot be selected: open the scene to change it.`, "ok");
}

async function sceneOff(file: string): Promise<void> {
  const known = [...onScenes.keys()].find((f) => sameFile(f, file)) ?? file;
  onScenes.delete(known);
  writeSession();
  console.log(`No longer showing ${path.basename(known)}`);
  if (typeof world.unload === "function") await world.unload(known).catch((err) => console.log(`Unload ${known}: ${(err as Error).message}`));
  publish();
}

/** After the world becomes ready, or a save loads: the scenes that are on, placed again. */
async function reloadOn(): Promise<void> {
  if (!onScenes.size || state.world !== "ready") return;
  let n = 0;
  for (const file of [...onScenes.keys()]) {
    if (!fs.existsSync(file)) {
      onScenes.delete(file);
      continue;
    }
    try {
      // Its bake is in the game: shown again it would stand twice. Show in world still asks for it.
      if (inGameNow.has(slugOf(readSceneFile(file).name))) continue;
      n += await loadOn(file);
    } catch (err) {
      console.log(`${path.basename(file)} not shown: ${(err as Error).message}`);
    }
  }
  writeSession();
  console.log(`Scenes on: ${onScenes.size}, ${n} objects placed`);
  publish();
}

/** Sets the Library root for every EDGE tool; never inside the game or a package folder (deploys and hot reload must not touch it). */
function setLibraryRoot(root: string): void {
  root = root.trim().replace(/^"(.*)"$/, "$1");
  if (!root || !path.isAbsolute(root)) return say(`Give the Library a full folder path, such as ${suggestedRoot}.`, "warn");
  const inside = (dir: string | undefined) => {
    if (!dir) return false;
    const rel = path.relative(path.resolve(dir), path.resolve(root));
    return !rel.startsWith("..") && !path.isAbsolute(rel);
  };
  if (inside(gameDir()) || inside(pkg.dir) || inside(pkg.dataDir)) return say("The Library cannot be inside the game's folder or EDGEbuilder's own folders: deploys and reloads would touch it. Pick another folder.", "warn");
  try {
    writeLibraryRoot(root);
  } catch (err) {
    return say(`The Library folder could not be made: ${(err as Error).message}`, "error");
  }
  libraryRoot = path.resolve(root);
  scanLibrary();
  say(`The Library is ${libraryRoot}. Every EDGE tool uses this folder.`, "ok");
}

function newFolder(folder: string, name: string): void {
  if (!libraryRoot) return say("Set the Library folder in Settings first.", "warn");
  const root = libraryRoot;
  const dir = attempt(() => path.join(folderIn(root, folder), cleanFolderName(name)));
  if (!dir) return;
  fs.mkdirSync(dir, { recursive: true });
  scanLibrary();
  say(`Made the folder ${whereText(path.join(dir, "x"))}.`, "ok");
}

// ---- EDGEbuilder's service (B3-2): service.mjs imports these -----------------------------------------

/** A scene for other packages and assistants. */
export interface ServiceScene {
  name: string;
  file: string;
  place: Place;
  folder: string;
  objects: number;
  changed: string;
  open: boolean;
  on: boolean;
}

export function listScenes(): ServiceScene[] {
  scanLibrary();
  publish();
  return state.library.shelves.flatMap((sh) =>
    sh.scenes
      .filter((s) => !s.error)
      .map((s) => ({
        name: s.name,
        file: s.file,
        place: s.place,
        folder: s.folder,
        objects: sameFile(s.file, scene.file) ? scene.objects.length : s.objects,
        changed: new Date(s.changed).toISOString(),
        open: sameFile(s.file, scene.file),
        on: [...onScenes.keys()].some((f) => sameFile(f, s.file)),
      })),
  );
}

/** One object of a scene, with the node reference the bake gives it. */
export interface ServiceRef {
  id: string;
  ref: string;
  kind: string;
  resource?: string;
  /** A person's `Character` record (the `npc` kind). */
  record?: string;
  appearance?: string;
  group?: string;
  position: [number, number, number];
  rotation: [number, number, number, number];
}

/** The open scene's objects, or another scene's by file or name. */
export function sceneRefs(which?: string): { scene: string; file: string; refs: ServiceRef[] } {
  let data: SceneFile;
  let file = scene.file;
  if (!which && !scene.file) throw new Error("No scene is open: name one, as scenes() gives them");
  if (!which || sameFile(which, scene.file) || which.toLowerCase() === scene.name.toLowerCase()) data = scene.data();
  else {
    const all = listScenes();
    const found = all.find((s) => path.isAbsolute(which) && sameFile(s.file, which)) ?? all.find((s) => s.name.toLowerCase() === which.toLowerCase());
    if (!found) throw new Error(`No scene "${which}": scenes() lists them`);
    file = found.file;
    data = readSceneFile(file);
  }
  return {
    scene: data.name,
    file,
    refs: data.objects.map((o) => ({
      id: o.id,
      ref: refOf(data.name, o),
      kind: o.kind,
      ...(o.resource ? { resource: o.resource } : {}),
      ...(o.record ? { record: o.record } : {}),
      ...(o.appearance ? { appearance: o.appearance } : {}),
      ...(o.group ? { group: o.group } : {}),
      position: o.transform.position,
      rotation: o.transform.rotation,
    })),
  };
}

/** scene-changed for connected packages, half a second after the last save. */
let changedTimer: ReturnType<typeof setTimeout> | undefined;
scene.onSave = () => {
  bakeSoon();
  if (typeof service?.emit !== "function") return;
  clearTimeout(changedTimer);
  changedTimer = setTimeout(() => service.emit("scene-changed", { name: scene.name, file: scene.file, objects: scene.objects.length }), 500);
};

function saveSettings(next: Settings): void {
  settings = { ...settings, ...next };
  for (const k of Object.keys(settings) as (keyof Settings)[]) if (settings[k] === undefined || settings[k] === "") delete settings[k];
  fs.mkdirSync(pkg.dataDir, { recursive: true });
  fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2));
}

channel.on<PageMessage>((m) => {
  void (async () => {
    switch (m.type) {
      case "hello":
        publish();
        break;
      case "search":
        state.query = { text: m.text, kind: m.kind as AssetKind | "all", from: (m.from ?? state.query.from) as AssetFrom };
        runSearch();
        break;
      case "look":
        state.looked = { path: m.path };
        if (isRecord(m.path)) {
          state.looked = { path: m.path, info: await lookAtPerson(m.path).catch((err) => ({ appearances: [], bounds: PersonBounds, error: (err as Error).message })) };
          publish();
          break;
        }
        if (!bridge?.running) state.looked.info = (sourceOf(m.path) ? undefined : index.info[m.path]) ?? { appearances: [], error: "Size and appearances need REDbridge; it can still be dropped." };
        publish();
        if (bridge?.running) {
          try {
            state.looked = { path: m.path, info: await assetInfo(bridge, m.path) };
          } catch (err) {
            state.looked = { path: m.path, info: { appearances: [], error: (err as Error).message } };
          }
          publish();
        }
        break;
      case "drop":
        await inTurn("Drop", () => drop(m.path, m.appearance, m.at));
        break;
      case "select":
        await inTurn("Select", () => select(m.ids));
        break;
      case "delete":
        await inTurn("Delete", () => remove(m.ids));
        break;
      case "group":
        await inTurn("Group", () => group(m.ids));
        break;
      case "ungroup":
        await inTurn("Ungroup", () => ungroup(m.ids));
        break;
      case "rename":
        await inTurn("Rename", () => rename(m.group, m.name));
        break;
      case "duplicate":
        await inTurn("Copy", () => duplicate(m.ids, m.offset));
        break;
      case "copy":
        await inTurn("Copy", () => copy(m.ids));
        break;
      case "cut":
        await inTurn("Cut", () => cut(m.ids));
        break;
      case "paste":
        await inTurn("Paste", () => paste(m.at));
        break;
      case "stop":
        // Not in turn: it is for the change that is running.
        if (running) stopAsked = true;
        break;
      case "undo":
        await inTurn("Undo", () => travel(past, future, "Undo"));
        break;
      case "scene.open":
        await inTurn("Open scene", () => openScene(m.file));
        break;
      case "scene.new":
        await inTurn("New scene", () => newScene(m.name, m.place, m.folder));
        break;
      case "scene.close":
        await inTurn("Close scene", () => closeScene());
        break;
      case "scene.saveAs":
        await inTurn("Save as", () => saveAs(m.name, m.place, m.folder));
        break;
      case "scene.rename":
        await inTurn("Rename scene", () => renameScene(m.name));
        break;
      case "scene.save":
        await inTurn("Save", () => saveNow());
        break;
      case "scene.on":
        await inTurn(m.on ? "Show scene" : "Hide scene", () => (m.on ? sceneOn(m.file) : sceneOff(m.file)));
        break;
      case "scene.peek":
        peek(m.file);
        break;
      case "scene.goTo":
        await inTurn("Go to object", () => goTo(m.id));
        break;
      case "scene.removeFrom":
        await inTurn("Delete", () => removeFromScene(m.file, m.id));
        break;
      case "library.root":
        setLibraryRoot(m.root);
        break;
      case "library.folder":
        newFolder(m.folder, m.name);
        break;
      case "library.refresh":
        await askRedcodeAgain();
        scanLibrary();
        publish();
        break;
      case "bake":
        await inTurn("Bake", () => bakeOpenScene());
        break;
      case "bake.refresh":
        await askRedcodeAgain();
        lookAtBakes();
        publish();
        break;
      case "bake.remove":
        await inTurn("Remove bake", () => removeBake(m.slug));
        break;
      case "lbake.new":
        await inTurn("Bake into the Library", () => newLibraryBake(m.file, m.name, m.folder));
        break;
      case "lbake.add":
        await inTurn("Bake into the Library", () => editLibraryBake(m.dir, "add", m.file));
        break;
      case "lbake.drop":
        await inTurn("Take a scene out of a bake", () => editLibraryBake(m.dir, "drop", m.slug));
        break;
      case "lbake.rebake":
        await inTurn("Bake again", () => editLibraryBake(m.dir, "rebake"));
        break;
      case "lbake.include":
        await inTurn("Include in project", () => includeLibraryBake(m.dir));
        break;
      case "lbake.delete":
        await inTurn("Delete bake", () => deleteLibraryBake(m.dir));
        break;
      case "redo":
        await inTurn("Redo", () => travel(future, past, "Redo"));
        break;
      case "rebuild":
        await inTurn("Rebuild previews", () => rebuild());
        break;
      case "clear":
        await inTurn("Clear scene", () => clear());
        break;
      case "index.build":
        await buildIndex();
        await readNpcs(true);
        break;
      case "bridge.restart":
        await startBridge();
        break;
      case "builder.start":
        await queued(() => builderStart(m.pose));
        break;
      case "builder.stop":
        await queued(() => builderStop());
        break;
      case "transform":
        await inTurn("Move", () => setTransforms(m.items, m.merge));
        break;
      case "floor":
        await inTurn("Drop to floor", () => dropToFloor(m.ids));
        break;
      case "solid":
        await inTurn("Solid", () => setSolid(m.ids, m.on));
        break;
      case "seenFrom":
        await inTurn("Seen from", () => setSeenFrom(m.ids, m.metres));
        break;
      case "log":
        console.log(m.text);
        break;
      case "settings":
      {
        const bridgeChanged = ("bridgePath" in m && m.bridgePath !== settings.bridgePath) || ("gameDir" in m && m.gameDir !== settings.gameDir);
        const next: Settings = {};
        for (const k of ["bridgePath", "gameDir", "hideHud", "editorCamera"] as const) if (k in m) (next as Record<string, unknown>)[k] = m[k];
        saveSettings(next);
        say(bridgeChanged ? "Settings saved; restarting REDbridge." : "Settings saved.", "info");
        if ("hideHud" in m || "editorCamera" in m) await queued(() => builderSwitches());
        if (bridgeChanged) await startBridge();
      }
        break;
    }
  })().catch((err) => say(`${m.type}: ${(err as Error).message}`, "error"));
});

// ---- the bake (B4) --------------------------------------------------------------------------------
//
// One scene into the open REDcode project, through REDbridge's sector.build. bake.ts has what needs no
// REDnode. A bake stands in the world from the next game start, as a sector of our own.

/** The bakes in the game, by slug, as last looked at. */
let inGameNow = new Map<string, string>();

const BakedOff = (name: string, xl: string) => `${name} is baked and in the game (${xl}), so its previews stay off and nothing stands twice. Rebuild previews on the Scene tab brings them back to edit it.`;

function bakeProject(): BakeProject | null {
  return project ? { name: project.name, dir: project.dir, archive: project.archive, raw: project.raw, resources: project.resources } : null;
}

const needsOf = () => sceneNeeds(scene.objects.map((o) => o.resource), index.extra);

/** The Solid switch: a mesh with no collision data cannot turn on, and any can turn off. */
function setSolid(ids: string[], on: boolean): void {
  const meshes = ids.map((id) => scene.get(id)).filter((o): o is SceneObject => o?.kind === "mesh");
  const none = new Set(state.noCollision);
  const change = meshes.filter((o) => (on ? !o.solid && !none.has(collisionKey(o.resource)) : o.solid));
  if (!change.length) return publish();
  step();
  for (const o of change) {
    if (on) o.solid = true;
    else delete o.solid;
  }
  scene.save();
  lookAtBakes();
  say(`${change.length === 1 ? change[0].id : `${change.length} meshes`}: ${on ? "solid" : "not solid"} once baked.`, "ok");
}

/** Seen from: how far off the objects are seen once baked, or null for REDbridge's rule by size. */
function setSeenFrom(ids: string[], metres: number | null): void {
  const next = streamingFor(metres);
  // People are not baked (B3c): how far off a baked object is seen does not apply to them.
  const objects = ids.map((id) => scene.get(id)).filter((o): o is SceneObject => !!o && o.kind !== "npc");
  const change = objects.filter((o) => JSON.stringify(o.streaming ?? null) !== JSON.stringify(next ?? null));
  if (!change.length) return publish();
  step();
  for (const o of change) {
    if (next) o.streaming = { ...next };
    else delete o.streaming;
  }
  scene.save();
  lookAtBakes();
  const what = change.length === 1 ? change[0].id : `${change.length} objects`;
  say(next ? `${what}: seen from ${next.primary} m once baked.` : `${what}: seen from a distance by size once baked.`, "ok");
}

/** Which of the scene's meshes have no collision data, asked in the background: REDbridge reads each mesh once. */
let collisionAsked = "";
let collisionBusy = false;
async function lookAtCollision(): Promise<void> {
  const b = bridge;
  if (!b?.running || state.bridge.status !== "ready" || collisionBusy) return;
  const paths = [...new Set(scene.objects.filter((o) => o.kind === "mesh" && o.resource).map((o) => o.resource!))];
  const asked = paths.map(collisionKey).sort().join("|");
  if (asked === collisionAsked) return;
  collisionBusy = true;
  try {
    const none: string[] = [];
    for (const p of paths) {
      const info = await assetInfo(b, p).catch(() => undefined);
      if (info?.hasCollision === false) none.push(collisionKey(p));
    }
    collisionAsked = asked;
    state.noCollision = none;
    lookAtBakes();
    publish();
  } finally {
    collisionBusy = false;
  }
}

/** What the Bake tab shows, from the project's files and the game's. */
function lookAtBakes(): void {
  const target = bakeProject();
  const slug = slugOf(scene.name);
  const list = bakesIn(target);
  const current = scene.file ? list.find((b) => b.slug === slug) : undefined;
  inGameNow = deployedBakes(gameDir());
  lookAtLibraryBakes();
  // A bake from the Library: whether the Library has a newer version of it now.
  for (const r of list) {
    const lib = r.library && state.library.bakes.find((b) => b.id === r.library!.id);
    if (lib && r.library && lib.version > r.library.version) r.library = { ...r.library, latest: lib.version, dir: lib.dir };
  }
  const fromElsewhere = current?.file && !sameFile(current.file, scene.file) ? current : undefined;
  state.bake = {
    ...state.bake,
    project: target ? { name: target.name, dir: target.dir } : null,
    checks: checkBake({
      file: scene.file,
      name: scene.name,
      objects: scene.objects,
      project: target,
      bridgeReady: !!bridge?.running && state.bridge.status === "ready",
      redcodeMissing: redcodeFailed,
      needs: needsOf(),
      sameNameFrom: fromElsewhere ? whereText(fromElsewhere.file!) : undefined,
      noCollision: new Set(state.noCollision),
      bridgeVersion: state.bridge.version,
    }),
    current,
    stale: !!current?.hash && !fromElsewhere && current.hash !== bakeHash(scene.objects),
    inGame: scene.file ? inGameNow.get(slug) : undefined,
    list,
  };
}

const bakeSoon = debounced(() => {
  lookAtBakes();
  publish();
  void lookAtCollision();
});

/** The meshes among `objects` set solid that have no collision data, as `collisionKey`s: REDbridge reads each once. */
async function noCollisionFor(b: Bridge, objects: Omit<SceneObject, "entityId">[]): Promise<Set<string>> {
  const none = new Set<string>();
  for (const p of new Set(objects.filter((o) => o.kind === "mesh" && o.solid && o.resource).map((o) => o.resource!))) {
    const info = await assetInfo(b, p).catch(() => undefined);
    if (info?.hasCollision === false) none.add(collisionKey(p));
  }
  return none;
}

/** A scene to bake: the open one as it is now, any other from its file. */
function sceneToBake(file: string): { name: string; game?: string; groups: SceneFile["groups"]; objects: SceneObject[] } {
  if (scene.file && sameFile(file, scene.file)) return { name: scene.name, game: scene.game, groups: scene.groups, objects: scene.objects };
  const d = readSceneFile(file);
  return { name: d.name, game: d.game, groups: d.groups ?? [], objects: d.objects as SceneObject[] };
}

/**
 * Bakes one scene into a project-shaped folder (a project, or a Library bake's folder) through REDbridge's
 * sector.build, and writes its record there. `root`: a project's source\archive, for the project's own files.
 */
async function bakeSceneInto(target: BakeProject, file: string, root?: string): Promise<{ built: SectorBuilt; xl: string; record: BakeRecord }> {
  const src = sceneToBake(file);
  const b = bridge!;
  const { scene: input } = bakeInput(src.name, src.game, src.groups, solidForBake(src.objects, await noCollisionFor(b, src.objects)));
  // A file that is not the game's needs its size from where it is; sector.build reads the game's itself.
  const byPath = new Map(index.extra.map((e) => [e.path.toLowerCase(), e]));
  for (const o of input.objects) {
    if (o.bounds || !o.resource) continue;
    const entry = byPath.get(o.resource.replace(/\//g, "\\").toLowerCase());
    if (!entry?.source) continue;
    const info = await sources.lookAt(b, entry);
    if (info.bounds) o.bounds = info.bounds;
  }
  let built: SectorBuilt;
  try {
    built = await b.sectorBuild({ project: target.dir, scene: input, ...(root ? { root } : {}) });
  } catch (err) {
    // REDbridge before 0.12.0 takes no `root`, and reads only the game's files.
    if (!root || !/param|argument|signature|method/i.test((err as Error).message)) throw err;
    built = await b.sectorBuild({ project: target.dir, scene: input });
  }
  const xl = settleXl(built.xl, built.name, built.blockPath);
  const record: BakeRecord = {
    slug: built.name,
    name: src.name,
    file,
    hash: bakeHash(src.objects),
    objects: built.nodes,
    date: new Date().toISOString(),
    bridge: state.bridge.version,
    box: built.streamingBox,
    needs: sceneNeeds(src.objects.map((o) => o.resource), index.extra),
  };
  writeRecord(target, record);
  console.log(`Baked ${src.name}: ${built.nodes} objects into ${target.dir} (${built.sector})${built.warnings.length ? `; ${built.warnings.length} warnings: ${built.warnings.join(" | ")}` : ""}`);
  return { built, xl, record };
}

async function bakeOpenScene(): Promise<void> {
  await lookAtCollision();
  lookAtBakes();
  const stop = state.bake.checks.find((c) => c.tone === "error");
  if (stop) {
    publish();
    return say(stop.text, "warn");
  }
  const target = bakeProject()!;
  let done: Awaited<ReturnType<typeof bakeSceneInto>>;
  try {
    done = await bakeSceneInto(target, scene.file, target.archive);
  } catch (err) {
    console.log(`Bake ${scene.name}: ${(err as Error).message}`);
    state.bake.last = undefined;
    lookAtBakes();
    return say(`The bake did not go through: ${(err as Error).message}`, "error");
  }
  // Baked straight into the project: no longer the copy of a Library bake, if it was one.
  forgetInNote(target.dir, done.built.name);
  state.bake.last = { slug: done.built.name, files: [done.built.sector, done.built.block, done.xl].map((f) => path.relative(target.dir, f)), warnings: done.built.warnings };
  lookAtBakes();
  const n = done.built.nodes;
  say(`Baked ${scene.name}: ${n} object${n === 1 ? "" : "s"} into ${target.name}. Pack and install the project, and start the game again.`, "ok");
}

async function removeBake(slug: string): Promise<void> {
  const target = bakeProject();
  if (!target) return say("No REDcode project is open.", "warn");
  try {
    removeBakeFiles(target, slug);
    forgetInNote(target.dir, slug);
  } catch (err) {
    return say(`${slug} could not be removed: ${(err as Error).message}`, "error");
  }
  if (state.bake.last?.slug === slug) state.bake.last = undefined;
  lookAtBakes();
  const stillIn = inGameNow.get(slug);
  say(`Took the bake ${slug} out of ${target.name}. Its scene is untouched.${stillIn ? ` It stays in the game (${stillIn}) until you pack and install the project again.` : ""}`, "ok");
}

// ---- Library bakes (B4-3) -------------------------------------------------------------------------------
//
// A bake in the Library holds one or more scenes, each baked as into a project, in a `<name>.bake` folder
// (bake.ts). The Library tab makes and changes them; Include in project copies one into the open project.

/** The Library's `.bake` folders, as the last scan found them. */
let libraryBakeDirs: { dir: string; folder: string }[] = [];

/** What a scene file holds now, for the stale flag, kept until the file changes. */
const sceneHashes = new Map<string, { size: number; mtime: number; name: string; hash: string }>();

function sceneNow(file: string): { name: string; hash: string } | undefined {
  if (scene.file && sameFile(file, scene.file)) return { name: scene.name, hash: bakeHash(scene.objects) };
  let st: fs.Stats;
  try {
    st = fs.statSync(file);
  } catch {
    return undefined;
  }
  const known = sceneHashes.get(file);
  if (known && known.size === st.size && known.mtime === st.mtimeMs) return known;
  try {
    const d = readSceneFile(file);
    const now = { size: st.size, mtime: st.mtimeMs, name: d.name, hash: bakeHash(d.objects as SceneObject[]) };
    sceneHashes.set(file, now);
    return now;
  } catch {
    return undefined;
  }
}

/** The Library's bakes with their flags: stale, missing scenes, in the game, colliding, in the open project. */
function lookAtLibraryBakes(): void {
  const root = libraryRoot ?? "";
  const versions = new Map<string, number | undefined>();
  if (project) for (const v of libraryBakesIn(project.dir).values()) versions.set(v.id, v.version);
  const out: LibraryBake[] = [];
  for (const { dir, folder } of libraryBakeDirs) {
    let meta: BakeMeta;
    try {
      meta = readBakeMeta(dir);
    } catch (err) {
      out.push({ dir, folder, name: path.basename(dir), id: "", version: 0, scenes: [], inGame: false, collides: [], error: (err as Error).message });
      continue;
    }
    const scenes = meta.scenes.map((s) => {
      const file = fromLibraryPath(root, s.path);
      const now = sceneNow(file);
      return { name: s.name, slug: s.slug, file, ...(now ? {} : { missing: true }), ...(now && s.hash && now.hash !== s.hash ? { stale: true } : {}) };
    });
    out.push({
      dir,
      folder,
      name: meta.name,
      id: meta.id,
      version: meta.version,
      date: meta.date,
      bridge: meta.bridge,
      scenes,
      inGame: scenes.some((s) => inGameNow.has(s.slug)),
      collides: [],
      ...(versions.has(meta.id) ? { inProject: versions.get(meta.id) ?? 0 } : {}),
    });
  }
  // Two bakes with the same scene, or scenes of one name (their files are named by it), both put it in the world.
  for (const a of out) a.collides = out.filter((b) => b !== a && b.scenes.some((s) => a.scenes.some((t) => t.slug === s.slug || sameFile(t.file, s.file)))).map((b) => b.name);
  state.library.bakes = out;
}

/** A Library bake's folder, checked to be one: inside the Library and named `.bake`. */
function libraryBakeDir(dir: string): string {
  if (!libraryRoot) throw new Error("Set the Library folder first (Library tab or Settings).");
  const rel = path.relative(path.resolve(libraryRoot), path.resolve(dir));
  if (rel.startsWith("..") || path.isAbsolute(rel) || !dir.toLowerCase().endsWith(BakeFolderEnding)) throw new Error("That is not a bake in the Library.");
  return path.resolve(dir);
}

/**
 * Bakes `files` into a Library bake (each replacing its earlier bake there) and takes `drop` (slugs) out,
 * then raises its version. Every scene is checked first: nothing is written when one cannot be baked.
 */
async function changeLibraryBake(dir: string, meta: BakeMeta, files: string[], drop: string[] = []): Promise<string[]> {
  const root = libraryRoot!;
  const target = bakeFolderProject(dir);
  if (files.length && (!bridge?.running || state.bridge.status !== "ready")) throw new Error("REDbridge is not ready, and it writes the bake. The pills at the top say why.");
  const plan = files.map((file) => ({ file, src: sceneToBake(file) }));
  for (const { file, src } of plan) {
    const slug = slugOf(src.name);
    const other = meta.scenes.find((s) => s.slug === slug && !sameFile(fromLibraryPath(root, s.path), file)) ?? plan.find((p) => p.file !== file && slugOf(p.src.name) === slug);
    if (other) throw new Error(`Two scenes called ${src.name} can't be in one bake: a bake's files go by the scene's name. Rename one first.`);
    const stop = checkBake({ file, name: src.name, objects: src.objects, project: target, bridgeReady: true, needs: [], bridgeVersion: state.bridge.version }).find((c) => c.tone === "error");
    if (stop) throw new Error(`${src.name}: ${stop.text}`);
  }
  const warnings: string[] = [];
  const isNew = !fs.existsSync(dir);
  // sector.build wants the folder to be there; a new bake that fails leaves nothing behind.
  fs.mkdirSync(dir, { recursive: true });
  for (const { file } of plan) {
    let done: Awaited<ReturnType<typeof bakeSceneInto>>;
    try {
      done = await bakeSceneInto(target, file, project?.archive);
    } catch (err) {
      if (isNew) fs.rmSync(dir, { recursive: true, force: true });
      throw err;
    }
    const { record, built } = done;
    warnings.push(...built.warnings);
    const at = libraryPath(root, file);
    meta.scenes = [...meta.scenes.filter((s) => s.path !== at && s.slug !== record.slug), { name: record.name, slug: record.slug, path: at, hash: record.hash }];
  }
  for (const slug of drop) {
    removeBakeFiles(target, slug);
    meta.scenes = meta.scenes.filter((s) => s.slug !== slug);
  }
  meta.version += 1;
  meta.date = new Date().toISOString();
  meta.bridge = state.bridge.version;
  writeBakeMeta(dir, meta);
  scanLibrary();
  lookAtBakes();
  return warnings;
}

const warned = (w: string[]) => (w.length ? ` REDbridge says: ${w.slice(0, 3).join(" ")}${w.length > 3 ? ` (and ${w.length - 3} more)` : ""}` : "");

async function newLibraryBake(file: string, name: string, folder: string): Promise<void> {
  try {
    if (!libraryRoot) throw new Error("Set the Library folder first (Library tab or Settings).");
    const src = sceneToBake(file);
    const bakeName = name.trim() || src.name;
    const dir = freeBakeDir(folderIn(libraryRoot, folder), bakeName);
    const meta: BakeMeta = { format: 1, id: newBakeId(), name: bakeName, version: 0, scenes: [] };
    const w = await changeLibraryBake(dir, meta, [file]);
    say(`Baked ${src.name} into the Library as ${bakeName} (${libraryPath(libraryRoot, dir)}). Include it in a REDcode project to put it in the game.${warned(w)}`, "ok");
  } catch (err) {
    say(`The bake did not go through: ${(err as Error).message}`, "error");
  }
}

async function editLibraryBake(dir: string, what: "add" | "drop" | "rebake", arg?: string): Promise<void> {
  try {
    dir = libraryBakeDir(dir);
    const meta = readBakeMeta(dir);
    const root = libraryRoot!;
    if (what === "add") {
      const w = await changeLibraryBake(dir, meta, [arg!]);
      return say(`${sceneToBake(arg!).name} is baked into ${meta.name} (version ${meta.version}).${meta.version > 1 ? " Projects that include it can update it on their Bake tab." : ""}${warned(w)}`, "ok");
    }
    if (what === "drop") {
      const gone = meta.scenes.find((s) => s.slug === arg);
      if (!gone) return say(`${meta.name} has no scene ${arg}.`, "warn");
      await changeLibraryBake(dir, meta, [], [arg!]);
      return say(`${gone.name} is out of ${meta.name} (version ${meta.version}); the scene itself stays.${meta.scenes.length ? "" : " The bake is empty now: add a scene or delete it."}`, "ok");
    }
    const here = meta.scenes.map((s) => fromLibraryPath(root, s.path)).filter((f) => fs.existsSync(f));
    const missing = meta.scenes.filter((s) => !fs.existsSync(fromLibraryPath(root, s.path))).map((s) => s.name);
    if (!here.length) return say(`None of ${meta.name}'s scenes is where it was: ${missing.join(", ")}.`, "warn");
    const w = await changeLibraryBake(dir, meta, here);
    say(`Baked ${meta.name} again (version ${meta.version}).${missing.length ? ` Not found, so kept as baked before: ${missing.join(", ")}.` : ""}${warned(w)}`, missing.length ? "warn" : "ok");
  } catch (err) {
    lookAtBakes();
    say(`${what === "drop" ? "The scene could not be taken out" : "The bake did not go through"}: ${(err as Error).message}`, "error");
  }
}

async function includeLibraryBake(dir: string): Promise<void> {
  try {
    dir = libraryBakeDir(dir);
    const target = bakeProject();
    if (!target) throw new Error("No REDcode project is open. Open one in REDcode (VS Code), and include the bake there.");
    const meta = readBakeMeta(dir);
    if (!meta.scenes.length) throw new Error(`${meta.name} is empty: add a scene to it first.`);
    const clashes = includeClashes(target, meta);
    if (clashes.length) throw new Error(`${target.name} already has a bake of ${clashes.join(", ")} that is not from ${meta.name}. Take it out on the Bake tab first, or the two would overwrite each other.`);
    const before = libraryBakesIn(target.dir);
    const had = [...before.values()].find((v) => v.id === meta.id)?.version;
    includeBake(dir, meta, target, libraryRoot!);
    lookAtBakes();
    const scenes = `${meta.scenes.length} scene${meta.scenes.length === 1 ? "" : "s"}`;
    const what =
      had === undefined
        ? `Included ${meta.name} (version ${meta.version}, ${scenes}) in ${target.name}.`
        : had === meta.version
          ? `Copied ${meta.name} (version ${meta.version}) into ${target.name} again.`
          : `Updated ${meta.name} in ${target.name} from version ${had} to ${meta.version} (${scenes}).`;
    say(`${what} Pack and install the project, and start the game again.`, "ok");
  } catch (err) {
    say(`The bake was not included: ${(err as Error).message}`, "error");
  }
}

function deleteLibraryBake(dir: string): void {
  try {
    dir = libraryBakeDir(dir);
    const name = (() => {
      try {
        return readBakeMeta(dir).name;
      } catch {
        return path.basename(dir);
      }
    })();
    fs.rmSync(dir, { recursive: true, force: true });
    scanLibrary();
    lookAtBakes();
    say(`Deleted the bake ${name} from the Library. Its scenes stay, and projects that included it keep their copies.`, "ok");
  } catch (err) {
    say(`The bake could not be deleted: ${(err as Error).message}`, "error");
  }
}

// ---- lifecycle --------------------------------------------------------------------------------

// The host links to the game, or loses it: the world may have become usable, or not.
let linked: boolean | undefined;
game.onState((s) => {
  if (s.world && backWhenIn) {
    backWhenIn = false;
    previewsBackSoon();
  }
  if (s.connected === linked) return;
  linked = s.connected;
  if (!s.connected) {
    scene.forgetPreviews();
    state.selected = [];
  }
  void checkWorld();
});

game.on("PlayerPuppet.OnGameAttached", () => {
  stopTierWatch();
  builderOn = false;
  if (editorCam || readBuilderRecord()) {
    editorCam = undefined;
    state.camera = undefined;
    try {
      fs.rmSync(builderFile, { force: true });
    } catch {
      // Nothing to remove.
    }
  }
  // A save loaded: every preview entity of the old session is gone.
  attachedAt = Date.now();
  gone.clear();
  void setSolo(false);
  scene.forgetPreviews();
  state.selected = [];
  void checkWorld().then(() => {
    // The scenes that are on went with the old session's entities: place them again.
    void inTurn("Show scenes that are on", () => reloadOn());
    previewsBackSoon();
  });
});

/** When the last save loaded, and how long after it a preview that leaves the world is put back. */
let attachedAt = 0;
const LoadSettles = 90_000;

/** Previews that left the world, by entity: an archive swap spawns them again under a new id. */
const gone = new Map<string, { id: string; selected: boolean }>();

world.on("Entity/Detach", (e) => {
  const o = scene.objects.find((x) => x.entityId === e.entityId);
  if (o) {
    if (e.entityId) gone.set(e.entityId, { id: o.id, selected: state.selected.includes(o.id) });
    delete o.entityId;
    state.selected = state.selected.filter((id) => id !== o.id);
    publish();
    // Spawned while a save was still loading, then taken away as the load went on (0.6.6; B3c test on
    // the laptop, where the crate stayed away): put it back once the load settles.
    if (Date.now() - attachedAt < LoadSettles) {
      console.log(`${o.id} left the world while the save was loading: it comes back in a moment`);
      previewsBackSoon();
    }
  }
});

// After an archive swap (REDcode's Pack and Play, REDnode's archives.reload), REDnode spawns again the
// previews that use a swapped file: they show the new version and keep their place in the scene.
if (typeof world.onRespawn === "function") {
  world.onRespawn((before, after) => {
    const was = gone.get(before.hash);
    gone.delete(before.hash);
    const o = scene.get(was?.id) ?? scene.objects.find((x) => x.entityId === before.hash);
    if (!o) return;
    o.entityId = after.hash;
    console.log(`${o.id} spawned again after an archive swap (${after.hash})`);
    // REDnode spawns it again with the options it was first spawned with, so a preview moved since
    // comes back where it was dropped (B2c test, 2026-10-30): put it where the scene has it.
    void movePreview(o, o.transform.position, o.transform.rotation)
      .catch((err) => console.log(`${o.id} not moved back after the swap: ${(err as Error).message}`))
      .then(() => (was?.selected ? select([...state.selected, o.id]) : publish()));
  });
}

if (typeof ui?.onSolo === "function") {
  ui.onSolo((on) => {
    soloOn = on;
    if (!on && builderOn) console.log("Solo mode ended from the launcher; Edit stays on");
  });
}

console.log(`EDGEbuilder ${__VERSION__} starting; data folder ${pkg.dataDir}; ${scene.file ? `scene ${scene.name} (${scene.file}), ${scene.objects.length} objects` : "no scene open"}; ${onScenes.size} other scene${onScenes.size === 1 ? "" : "s"} on; Library ${libraryRoot ?? "not set"}`);
// The open scene is always a file, so the Library tab lists it from the start.
if (!fs.existsSync(scene.file) && !scene.loadError) scene.save();
scanLibrary();
if (lastGone) {
  state.message = { text: `The scene open last time (${lastGone}) is no longer there; opened ${scene.name} instead.`, tone: "warn" };
  console.log(state.message.text);
}
writeSession();
if (scene.loadError) {
  state.message = { text: `The scene file could not be read (${scene.loadError}). ${scene.setAside ? `It was kept as ${path.basename(scene.setAside)}; ` : ""}starting with an empty scene.`, tone: "warn" };
  console.log(state.message.text);
}
// The index built last time loads at once, so search works before REDbridge answers (or is allowed).
if (index.loadNewest()) {
  state.index = { status: "ready", count: index.entries.length, file: index.file, progress: "From the last time REDbridge read the game" };
  runSearch();
}
publish();
void checkWorld();
void startBridge();
watchMods();
void connectRedcode();
