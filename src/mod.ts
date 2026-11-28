// EDGEbuilder's Node mod: the brain behind the editor page. It owns the scene, the asset index,
// REDbridge and the preview entities; the page shows state, draws the gizmo and sends requests.
// B1: browse the game's assets, drop one in front of V, select it, delete it.
// B2a: move, turn and scale with the page's gizmo and keys, drop to the floor.
// B2c: Browse also lists installed mods' and the open REDcode project's meshes and entities.
// B3-2: named scenes in the Library, the REDcode project or This PC; other scenes shown; a service.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { api, archives, channel, game, kernel, pkg, service, ui, world, type GameRef, type WorldNode } from "rednode";
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
  bakeRemovals,
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
import { Scene, forReader, readSceneFile, yawToQuaternion, type SceneFile, type SceneState } from "./scene";
import { SectorKinds, bridgeKinds, editsInSector, levelsOf, nodeRows, placesEntity, sectorHash, sectorMatches, sectorName, sectorRows, shortKind, type FoundSector, type SectorItem } from "./sectors";
import { DefaultKinds, KindLabels, MeshNodeKinds, boxHolds, doorActions, doorAfter, doorStateText, doorUnderRay, editFor, editId, idText, kindOfClass, questWarnings, readableEdits, registryId, sameId } from "./worldedits";
import { movePreview, sameTransform } from "./move";
import { checkModelPath, deskDir, filePlaces, listFolder, scanModels } from "./models";
import { findTools } from "./tools";
import { isTextureLine, loadFab, type BridgeCall, type FabCore, type FabPrepared } from "./fab";
import { cleanFolderName, fileNameOf, folderIn, readLibraryRoot, refOf, scanShelf, slugOf, suggestedLibraryRoot, whereIs, writeLibraryRoot } from "./scenes";
import { copyOf, duplicate as copySelection, makeGroup, pasteOf, standPoint, ungroup as openGroups, upright, type Clip } from "./arrange";
import { add, basisFromMatrix, lookOf, mul, qLook, sub, type GameMatrix, type V3 } from "./math";
import { AnyLook, Features, type PreviewPart, type AssetEntry, type AssetFrom, type AssetInfo, type AssetKind, type BakeRecord, type LibraryBake, type PageMessage, type DropLike, type Place, type PlaceRoot, type SceneObject, type SceneTransform, type Snapshot, type DoorState, type SectorView, type WorldEdit, type WorldKind, type WorldNodeRef, type WorldPicked, type WorldThing } from "./protocol";

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
  /** D1: the kinds of the game's own objects a click picks. Default the doors. */
  worldKinds?: WorldKind[];
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
  scene: { name: scene.name, objects: scene.objects, groups: scene.groups, worldEdits: scene.worldEdits, file: scene.file, needs: [] },
  worldObjects: { kinds: settings.worldKinds ?? DefaultKinds, status: "idle", things: [] },
  sectors: { status: "idle", text: "", kinds: ["exterior", "interior", "quest"], level: null, found: [], total: 0 },
  library: { root: libraryRoot, suggested: suggestedRoot, shelves: [], on: [], bakes: [], models: [], modelPlaces: [] },
  bake: { project: null, checks: [], stale: false, list: [] },
  selected: [],
  history: { undo: 0, redo: 0 },
  settings: { ...settings, settingsFile },
  inUse: {},
  tools: [],
};

function publish(): void {
  const at = whereIs(scene.file, placeRoots());
  state.scene = { name: scene.name, objects: scene.objects, groups: scene.groups, worldEdits: scene.worldEdits, file: scene.file, needs: sceneNeeds(scene.objects.map((o) => o.resource), index.extra), place: at?.place, folder: at?.folder };
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

// ---- tools (T0, docs/tools.md) -----------------------------------------------------------------------
//
// Packages that provide "edgebuilder-tool", found in REDnode's package folders (pkg.appsDirs) until REDnode
// can list a role's providers. Each tool's folder is watched: a change looks again, so a changed module has
// a new URL and the page mounts it again.

const toolWatchers = new Map<string, fs.FSWatcher>();

function scanTools(): void {
  if (!Features.tools) {
    // Switched off until T0's test passes: no tools listed, no folders watched.
    state.tools = [];
    return;
  }
  let dirs: readonly string[] = [];
  try {
    dirs = pkg.appsDirs ?? [];
  } catch {
    // An older REDnode: no package folders known.
  }
  if (!dirs.length) dirs = [path.dirname(pkg.dir)];
  state.tools = findTools(dirs, pkg.dir);
  const want = new Set(state.tools.map((t) => t.dir));
  for (const [dir, w] of toolWatchers) {
    if (want.has(dir)) continue;
    w.close();
    toolWatchers.delete(dir);
  }
  for (const dir of want) {
    if (toolWatchers.has(dir)) continue;
    try {
      toolWatchers.set(dir, fs.watch(dir, { recursive: true }, toolsChanged));
    } catch {
      // A folder that cannot be watched: Look again finds its changes.
    }
  }
}

const toolsChanged = debounced(() => {
  scanTools();
  publish();
}, 300);

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

/**
 * Every project open in REDcode's windows (REDcode 0.10.15 and later: projects(), projects-changed), the
 * last-focused first; the one REDcode calls its project (the window used last); and the one the player
 * picked on the Bake tab or the Import box, kept while it stays open. EDGEbuilder works with the picked
 * one, else the last-focused.
 */
let redcodeProjects: RedcodeProject[] = [];
let focusedProject: RedcodeProject | null = null;
let pickedDir: string | null = null;

function applyProjects(): void {
  const picked = pickedDir ? redcodeProjects.find((p) => sameFile(p.dir, pickedDir!)) : undefined;
  if (pickedDir && !picked && redcodeProjects.length) {
    console.log(`The picked REDcode project (${pickedDir}) is no longer open: following the window used last`);
    pickedDir = null;
  }
  state.sources.projects = redcodeProjects.length > 1 ? redcodeProjects.map((p) => ({ name: p.name, dir: p.dir })) : undefined;
  state.sources.picked = pickedDir;
  setProject(picked ?? focusedProject ?? redcodeProjects[0] ?? null);
}

function pickProject(dir: string | null): void {
  pickedDir = dir && redcodeProjects.some((p) => sameFile(p.dir, dir)) ? dir : null;
  applyProjects();
  say(pickedDir ? `Working with the REDcode project ${project?.name ?? dir}: bakes and imports go into it.` : "Following REDcode: the project in the VS Code window used last.", "ok");
}

/** The project open in REDcode, through REDcode's REDnode service (REDcode 0.10.5 and later). Without it, mods only. */
let redcode: { project(): Promise<RedcodeProject | null>; $call(fn: string, ...args: unknown[]): Promise<unknown> } | undefined;
let redcodeRetry: ReturnType<typeof setTimeout> | undefined;
/** The last try to reach REDcode's service failed: its package is not in the game. */
let redcodeFailed = false;
async function connectRedcode(): Promise<void> {
  if (typeof service?.connect !== "function") return;
  clearTimeout(redcodeRetry);
  try {
    const handle = await service.connect<{ project(): RedcodeProject | null }>("redcode");
    handle.$on("project-changed", (p: RedcodeProject | null) => {
      focusedProject = p;
      applyProjects();
    });
    handle.$on("projects-changed", (list: RedcodeProject[] | null) => {
      redcodeProjects = Array.isArray(list) ? list : [];
      applyProjects();
    });
    redcode = handle as unknown as { project(): Promise<RedcodeProject | null>; $call(fn: string, ...args: unknown[]): Promise<unknown> };
    redcodeFailed = false;
    state.sources.redcode = true;
    await readRedcodeProjects();
  } catch (err) {
    redcode = undefined;
    redcodeFailed = true;
    state.sources.redcode = false;
    console.log(`REDcode's service is not there (${(err as Error).message}); looking again in a minute, or at Refresh. Browse lists the game and mods meanwhile.`);
    redcodeRetry = setTimeout(() => void connectRedcode(), 60_000);
    lookAtBakes();
    publish();
  }
}

/** REDcode's projects and its last-focused one. An older REDcode has no projects(): its one project. */
async function readRedcodeProjects(): Promise<void> {
  if (!redcode) return;
  focusedProject = await redcode.project();
  const list = await redcode.$call("projects").catch(() => null);
  redcodeProjects = Array.isArray(list) ? (list as RedcodeProject[]) : focusedProject ? [focusedProject] : [];
  applyProjects();
}

/**
 * Open in REDcode (EDGEbuilder #11): REDcode's openSector, in its `redcode` package 0.4.0 (REDcode 0.10.18), opens
 * the sector in the 3D sector view of the REDcode window used last with a project, with the entry picked. It
 * answers within about 4 seconds; VS Code does not come to the front.
 */
async function openInRedcode(sector: string, entry?: number): Promise<void> {
  if (!Features.openInRedcode) return; // Switched off until its test passes (Features); the page shows no button.
  if (!sector) return say("This node's sector is not known yet: REDbridge names it once it has read the sector.", "warn");
  if (!redcode) await connectRedcode();
  if (!redcode) return say("REDcode is not there: its REDnode package comes with REDcode, in VS Code. Open in REDcode needs REDcode 0.10.18 or later.", "warn");
  const name = sector.split(/[\\/]/).pop()?.replace(/\.streamingsector$/i, "") ?? sector;
  const where = entry === undefined ? name : `${name}, entry #${entry}`;
  try {
    const answer = (await redcode.$call("openSector", { sector, entry })) as { opened?: boolean; window?: number; why?: string } | null;
    if (answer?.opened) say(`Opened in REDcode: ${where}. VS Code does not come to the front by itself.`, "ok");
    else say(`REDcode did not open ${where}: ${(answer?.why ?? "no answer").replace(/\.$/, "")}.`, "warn");
  } catch (err) {
    // REDnode 0.66.0 and later ask the player once for a call that changes something (manifest "calls").
    const text = (err as Error).message ?? String(err);
    if (/has no function "openSector"/.test(text)) say("This REDcode cannot open a sector from the game yet: Open in REDcode needs REDcode 0.10.18 or later.", "warn");
    else if (/not allowed/i.test(text)) say("Open in REDcode needs your OK once: in REDnode's Mod Manager, EDGEbuilder, Calls, allow redcode.openSector.", "warn");
    else if (/switched off/i.test(text)) say("REDcode's openSector is switched off for mods: switch it on in REDnode's Tools Manager.", "warn");
    else say(`REDcode did not open ${where}: ${text}`, "warn");
  }
}

/** Refresh on the Bake and Library tabs: ask REDcode for its project again, now (B3c test on the laptop). */
async function askRedcodeAgain(): Promise<void> {
  if (!redcode) return connectRedcode();
  try {
    await readRedcodeProjects();
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
    void startRegistry().then(() => applyEdits());
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

// ---- Drop at click's outline (0.14.0) -----------------------------------------------------------------
//
// While Drop at click waits for its click, the page sends the line under the cursor a few times a second
// and draws the object's box where a click would put it: the same raycast and rule as dropPlace. Only the
// newest line waits; older ones are dropped.

let probeNext: { seq: number; origin: V3; dir: V3 } | undefined;
let probing = false;

async function runProbes(): Promise<void> {
  if (probing) return;
  probing = true;
  try {
    while (probeNext) {
      const m = probeNext;
      probeNext = undefined;
      try {
        const { hit } = await raycast(m.origin, add(m.origin, mul(m.dir, SurfaceReach)));
        const yaw = (Math.atan2(m.dir[0], -m.dir[1]) * 180) / Math.PI;
        const rotation = yawToQuaternion(yaw) as [number, number, number, number];
        channel.post({ type: "probe", seq: m.seq, position: hit ?? add(m.origin, mul(m.dir, 8)), rotation, hit: !!hit });
      } catch {
        // No world yet: no outline.
      }
    }
  } finally {
    probing = false;
  }
}

// ---- previews of search results (0.14.0) ----------------------------------------------------------------
//
// The Previews drawer shows the search results' meshes as small pictures. For each mesh, REDbridge exports
// a plain model (a GLB, no materials, the most detailed LOD, as REDcode's mesh viewer does: 20 to 35 ms a
// mesh in E0) and the page draws it with three.js; the page sends the picture back and it is kept here, so
// the next time the tile shows at once. Kept by the file it came from: a mod or a project file that changes
// gets a new key. Only the newest ask waits: the page asks for the tiles in view.

const previewDir = path.join(pkg.dataDir, "previews");
let previewQueue: { path: string; glb: boolean }[] = [];
let previewing = false;

function previewKey(assetPath: string): { key: string; from?: AssetEntry["source"] } {
  const from = sourceOf(assetPath)?.source;
  let stamp = "game";
  if (from) {
    try {
      const st = fs.statSync(from.file);
      stamp = `${from.file}|${st.size}|${Math.round(st.mtimeMs)}`;
    } catch {
      stamp = from.file;
    }
  }
  return { key: createHash("sha1").update(`${stamp}|${assetPath.toLowerCase()}`).digest("hex").slice(0, 24), from };
}

/** The plain GLB of a mesh, exported once into the data folder. */
async function previewModel(assetPath: string, key: string, from: AssetEntry["source"]): Promise<Buffer> {
  const glb = path.join(previewDir, "glb", `${key}.glb`);
  if (fs.existsSync(glb)) return fs.readFileSync(glb);
  if (!bridge?.running) throw new Error("Previews need REDbridge");
  const work = path.join(previewDir, "work", key);
  const archiveDir = path.join(work, "archive");
  const rawDir = path.join(work, "raw");
  const file = path.join(archiveDir, ...assetPath.split("\\"));
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (from?.kind === "project") fs.copyFileSync(from.file, file);
    else if (from?.kind === "mod") {
      const r = await bridge.call<{ failed?: string[] }>("archive.extractFromMod", { archivePath: from.file, items: [{ path: assetPath, outFile: file }] });
      if (r.failed?.length || !fs.existsSync(file)) throw new Error(`not found in ${path.basename(from.file)}`);
    } else await bridge.call("archive.extract", { path: assetPath, outFile: file });
    const r = await bridge.call<{ ok?: boolean; written?: string[] }>("project.export", { file, archiveDir, rawDir, options: { meshBinary: true, meshMaterials: false, meshLodFilter: true } });
    const out = path.join(rawDir, ...assetPath.replace(/\.mesh$/i, ".glb").split("\\"));
    const made = fs.existsSync(out) ? out : r.written?.find((w) => /\.glb$/i.test(w) && fs.existsSync(w));
    if (!made) throw new Error("REDbridge made no model from it");
    fs.mkdirSync(path.dirname(glb), { recursive: true });
    fs.copyFileSync(made, glb);
    return fs.readFileSync(glb);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

/** An entity's mesh parts, as REDbridge's mesh.info lists them: the meshes its components draw, with their offsets. */
const PreviewPartsMax = 16;

async function previewParts(assetPath: string, key: string, from: AssetEntry["source"]): Promise<PreviewPart[]> {
  if (kindOf(assetPath) === "mesh") return [{ glb: (await previewModel(assetPath, key, from)).toString("base64") }];
  if (!bridge?.running) throw new Error("Previews need REDbridge");
  const where = from?.kind === "mod" ? { archive: from.file } : from?.kind === "project" && project ? { root: project.archive } : {};
  const info = await bridge.call<{ error?: string; parts?: { mesh: string; offset?: number[]; scale?: number[]; error?: string }[] }>("mesh.info", { path: assetPath, ...where });
  if (info.error) throw new Error(info.error);
  const meshes = (info.parts ?? []).filter((p) => p.mesh && !p.error).slice(0, PreviewPartsMax);
  if (!meshes.length) throw new Error("it draws no mesh");
  const parts: PreviewPart[] = [];
  let why = "";
  for (const p of meshes) {
    try {
      const k = previewKey(p.mesh);
      parts.push({ glb: (await previewModel(p.mesh, k.key, k.from)).toString("base64"), offset: p.offset, scale: p.scale });
    } catch (err) {
      why ||= `${path.basename(p.mesh)}: ${(err as Error).message}`;
    }
  }
  if (!parts.length) throw new Error(why || "none of its meshes could be read");
  return parts;
}

async function runPreviews(): Promise<void> {
  if (previewing) return;
  previewing = true;
  try {
    for (let next = previewQueue.shift(); next; next = previewQueue.shift()) {
      const { key, from } = previewKey(next.path);
      const png = path.join(previewDir, "png", `${key}.png`);
      try {
        if (!next.glb && fs.existsSync(png)) channel.post({ type: "preview", path: next.path, key, png: fs.readFileSync(png).toString("base64") });
        else channel.post({ type: "preview", path: next.path, key, parts: await previewParts(next.path, key, from) });
      } catch (err) {
        channel.post({ type: "preview", path: next.path, key, error: (err as Error).message });
      }
    }
  } finally {
    previewing = false;
  }
}

function savePreview(key: string, png: string): void {
  if (!/^[0-9a-f]{24}$/.test(key)) return;
  try {
    fs.mkdirSync(path.join(previewDir, "png"), { recursive: true });
    fs.writeFileSync(path.join(previewDir, "png", `${key}.png`), Buffer.from(png, "base64"));
  } catch (err) {
    console.log(`A preview picture could not be kept: ${(err as Error).message}`);
  }
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

/** Edit went off: the selection stays, but its outline (drawn through walls) waits until Edit or a new selection. */
let outlinesOff = false;

/** The game's own outline on the preview, or off. Best effort: the preview is selected either way. */
async function highlight(o: SceneObject | undefined, on: boolean): Promise<void> {
  if (!o?.entityId || (on && outlinesOff)) return;
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
  const standIns = await changeEdits(ch.show, ch.hide);
  const count = (edits: WorldEdit[], action: WorldEdit["action"]) => edits.filter((e) => e.action === action).length;
  const doorsChanged = new Set([...ch.show, ...ch.hide].filter((e) => e.action === "door").map((e) => registryId(e.node))).size;
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
    count(ch.hide, "remove") ? `${count(ch.hide, "remove")} removed from the world again` : "",
    count(ch.show, "remove") ? `${count(ch.show, "remove")} back in the world` : "",
    doorsChanged ? `${doorsChanged} door${doorsChanged === 1 ? "" : "s"} ${word === "Undo" ? "set back" : "set again"}` : "",
  ].filter(Boolean);
  state.message = { text: `${word}${what.length ? `: ${what.join(", ")}` : ""}.${standInNote(standIns)}`, tone: "ok" };
  console.log(state.message.text);
  const changed = [...ch.spawn, ...ch.respawn, ...ch.move].map((o) => o.id);
  // What changed, to see it; else what was selected then (Esc on a copy: the originals again).
  await select(changed.length ? changed : (s.selected ?? state.selected));
}

/**
 * The collision groups a floor can be in. The first that answers is not always the nearest, so all are asked.
 * Dynamic: a bake's solid objects (instanced destructibles, Kinematic, preset "World Dynamic") answer only there.
 */
const FloorGroups = ["Static", "Terrain", "PlayerBlocker", "Dynamic"];

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

/** How far below the editor camera Bring V looks for a floor. */
const BringReach = 300;

/**
 * Bring V: V stands on the first floor under the editor camera, facing the way it looks, so the author can try
 * what they placed as V. Edit stays on (switched off, V's own camera comes back where V now is). Not an undo
 * step: it changes no scene.
 */
async function bringV(): Promise<void> {
  if (state.world !== "ready") return say(worldBlocker(), "warn");
  if (!editorCam) return say("Bring V needs the editor camera: switch Edit on (Settings: Editor camera) and fly where V should stand.", "warn");
  const b = basisFromMatrix((await editorCam.component.GetLocalToWorld()) as GameMatrix);
  const { hit } = await raycast(b.pos, add(b.pos, [0, 0, -BringReach]));
  if (!hit) return say(`No floor under the camera within ${BringReach} m, so V stays where V is. The ground is solid only near the camera: fly lower and try again.`, "warn");
  // The game's yaw turns +Y towards -X; V faces the camera's heading.
  const yaw = (Math.atan2(-b.fwd[0], b.fwd[1]) * 180) / Math.PI;
  await game.player.teleport({ x: hit[0], y: hit[1], z: hit[2] + 0.05, yaw });
  console.log(`Bring V: to ${hit.map((v) => v.toFixed(2)).join(", ")}, ${(b.pos[2] - hit[2]).toFixed(1)} m below the camera`);
  say(`V is on the floor under the camera, ${(b.pos[2] - hit[2]).toFixed(1)} m below it. Switch Edit off to play V there.`, "ok");
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
  state.camera = editorCam || builderPaused ? { entityId: editorCam?.id, hudHidden: !!tierWatch, paused: builderPaused } : undefined;
  publish();
}

/**
 * Builder mode paused: the overlay left interactive mode (F10) while Edit is on, so the keys go to the
 * game. V gets the view and the HUD back and plays; the editor camera stays where it was, switched off.
 */
let builderPaused = false;

async function pauseBuilder(): Promise<void> {
  if (!builderOn || builderPaused) return;
  builderPaused = true;
  if (editorCam) {
    try {
      await editorCam.component.Deactivate(0, false);
    } catch {
      // Gone with a save load: V's camera comes back below either way.
    }
    await playerCameraBack();
  }
  await hudOn();
  // The outlines go too, as with Edit off (found in game on 2026-11-27: a dropped object kept its
  // green outline through F10); resumeBuilder puts them back.
  for (const id of state.selected) await highlight(scene.get(id), false);
  outlinesOff = true;
  if (state.worldObjects.picked) await outlineThing(state.worldObjects.picked.key, 0);
  if (hovered) await hoverThing(null);
  console.log("Builder mode paused (the overlay is not interactive): V's camera and HUD are back");
  publishCamera();
}

/** F10 again: the editor camera where it was, and the HUD hidden again. */
async function resumeBuilder(): Promise<void> {
  if (!builderOn || !builderPaused) return;
  builderPaused = false;
  if (editorCam) {
    try {
      await editorCam.component.Activate(0, false);
    } catch (err) {
      console.log(`The editor camera did not come back (${(err as Error).message}): V's camera stays`);
      await cameraOff();
    }
  }
  if (settings.hideHud !== false) await hudOff();
  outlinesOff = false;
  for (const id of state.selected) await highlight(scene.get(id), true);
  if (state.worldObjects.picked) await outlineThing(state.worldObjects.picked.key, WorldOutline);
  console.log("Builder mode resumed");
  publishCamera();
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
  outlinesOff = false;
  for (const id of state.selected) await highlight(scene.get(id), true);
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
  builderPaused = false;
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
  for (const id of state.selected) await highlight(scene.get(id), false);
  outlinesOff = true;
  if (state.worldObjects.picked) await outlineThing(state.worldObjects.picked.key, 0);
  if (hovered) await hoverThing(null);
  publish();
}

// ---- world edits (D1) -------------------------------------------------------------------------------
//
// The game's own doors (and, with Meshes on, its meshes), picked with Edit on and removed from the
// world as part of the scene: hidden live through REDnode's world node registry (world.setVisible; D0:
// the door and its collision go, and stay gone after its area streams back in), kept in the scene's
// worldEdits (format 3), baked by D1b. Doors come from world.near, around V: a point of EDGEbuilder's
// own (the camera) waits on REDnode's N2.

/** How far around V the World tab and a click look for doors, in metres. */
const NearRadius = 30;
/** How old the list of doors may be when a click looks for one, in ms. */
const NearFresh = 4000;
/** The game's highlight colours: the scene's own objects use 1; a picked world object and a hovered row others. */
const WorldOutline = 2;
const HoverOutline = 3;

/** The entities of the last look, by id, for outlines and states. */
const liveThings = new Map<string, GameRef>();
let nearAt = 0;
let hovered: string | undefined;
/** Removals the game did not take yet (their sector was not in), tried again while the world is in. */
const pendingHides = new Map<string, WorldEdit>();
let hideTimer: ReturnType<typeof setTimeout> | undefined;
/** The removals of scenes that are on, by file: EDGEbuilder applies them, since REDnode's reader skips them. */
const onEdits = new Map<string, WorldEdit[]>();
/** Depot paths by path hash, from REDbridge. */
const pathNames = new Map<string, string>();
/** Counts picks, so a slow look for a node never lands on a newer pick. */
let pickSeq = 0;

async function pathOf(hash: string | null | undefined): Promise<string> {
  if (!hash) return "";
  const known = pathNames.get(hash);
  if (known !== undefined) return known;
  // Without REDbridge nothing is known yet: asked again next time, not kept as unknown for the session.
  if (!bridge?.running) return "";
  let name = "";
  try {
    name = (await bridge.call<{ path?: string }>("hash.resolve", { hash }))?.path ?? "";
  } catch {
    // Not known to REDbridge's hash list: the hash stays.
  }
  pathNames.set(hash, name);
  return name;
}

/** Starts REDnode's world node registry. It knows only the sectors that load after it starts. */
async function startRegistry(): Promise<boolean> {
  const wo = state.worldObjects;
  if (typeof world.nodeRegistry !== "function" || typeof world.setVisible !== "function") {
    wo.status = "unavailable";
    wo.note = "Picking and removing the game's own objects needs REDnode 0.67.3 or later.";
    return false;
  }
  try {
    const s = await world.nodeRegistry();
    wo.registry = { sectors: s.sectors, nodes: s.setups };
    if (wo.status === "unavailable") wo.status = "idle";
    wo.note =
      state.world === "ready" && !s.sectors
        ? "REDnode's world node registry started after this save loaded, so it knows no part of the world yet: load the save again, or fast travel, and doors can be removed."
        : !s.canHide
          ? "REDnode's world node registry cannot hide nodes in this game version, so removals cannot show in the game."
          : undefined;
    return true;
  } catch (err) {
    // No game yet (the host on its own, or the game still starting): it starts when the world is ready.
    if (state.world !== "ready") {
      console.log(`REDnode's world node registry waits for the game: ${(err as Error).message}`);
      return false;
    }
    wo.status = "unavailable";
    wo.note = `REDnode's world node registry did not start: ${(err as Error).message}`;
    console.log(wo.note);
    return false;
  }
}

/** A door's state from its device. Best effort: a painted-on door has none. */
async function doorStateOf(entity: GameRef): Promise<WorldThing["door"]> {
  try {
    const ps = (await entity.GetDevicePS()) as GameRef | null;
    if (!ps) return undefined;
    const ask = (p: Promise<unknown>) => p.then((v) => (typeof v === "boolean" ? v : undefined)).catch(() => undefined);
    const [open, lock, sealed, lift] = await Promise.all([ask(ps.IsOpen()), ask(ps.IsLocked()), ask(ps.IsSealed()), ask(ps.IsLiftDoor())]);
    // An elevator's door is locked whenever its elevator is elsewhere, and the elevator unlocks it by force
    // as it arrives (D2 step 12). Only a seal holds against that, so for such a door locked means sealed.
    const locked = lift ? sealed : lock;
    // Older or other devices have no setup: the state alone.
    const setup = (await ps.$get("doorProperties").catch(() => null)) as { initialDoorState?: unknown; automaticallyClosesItself?: unknown } | null;
    const initial = typeof setup?.initialDoorState === "string" ? setup.initialDoorState : undefined;
    const closesItself = typeof setup?.automaticallyClosesItself === "boolean" ? setup.automaticallyClosesItself : undefined;
    return { open, locked, sealed, initial, closesItself, ...(lift ? { lift } : {}) };
  } catch {
    return undefined;
  }
}

/** The doors (and painted-on doors) near V, by the kinds on: the World tab's list. */
async function lookNear(): Promise<WorldThing[]> {
  const wo = state.worldObjects;
  if (state.world !== "ready" || typeof world.near !== "function") return wo.things;
  wo.status = "looking";
  publish();
  const kinds = new Set(wo.kinds);
  const things: WorldThing[] = [];
  liveThings.clear();
  try {
    for (const e of await world.near({ radius: NearRadius })) {
      const what = kindOfClass(e.type);
      if (!what || !kinds.has(what)) continue;
      liveThings.set(e.id.hash, e.entity);
      let template = "";
      try {
        template = await pathOf((await world.files!(e.entity)).template);
      } catch {
        // Without its template the row says less.
      }
      const p = (await e.entity.GetWorldPosition()) as { X: number; Y: number; Z: number };
      const word = what === "fakeDoor" ? "Painted-on door" : e.type;
      const label = [word, template ? path.basename(template) : "", e.appearance ? `(${e.appearance})` : ""].filter(Boolean).join(" ");
      things.push({
        key: e.id.hash,
        what,
        className: e.type,
        label,
        resource: template || undefined,
        appearance: e.appearance || undefined,
        position: [p.X, p.Y, p.Z],
        distance: e.distance,
        door: what === "door" ? await doorStateOf(e.entity) : undefined,
        removedBy: scene.worldEdits.find((x) => x.action === "remove" && sameId(x.node.globalId, e.id.hash))?.id,
        stateBy: scene.worldEdits.find((x) => x.action === "door" && sameId(x.node.globalId, e.id.hash))?.id,
      });
    }
  } catch (err) {
    console.log(`Doors near V: ${(err as Error).message}`);
  }
  nearAt = Date.now();
  wo.things = things;
  wo.status = "ready";
  return things;
}

/** Outlines a world thing (a door by its entity, a mesh by its node), or takes the outline off with 0. */
async function outlineThing(key: string, colour: number): Promise<void> {
  try {
    if (key.includes(":")) {
      if (typeof world.highlight === "function") await world.highlight(key, colour ? { outline: colour, fill: 1 } : null);
      return;
    }
    const entity = liveThings.get(key) ?? (await world.entity(key));
    if (!entity) return;
    const event = await api.$new("entRenderHighlightEvent", { seeThroughWalls: false, opacity: colour ? 1 : 0, outlineIndex: colour, fillIndex: 0 });
    await entity.QueueEvent(event);
  } catch (err) {
    // A door from before a save loaded is gone: nothing to outline, nothing to say.
    if (!/no longer exists/.test((err as Error).message)) console.log(`Outline ${key}: ${(err as Error).message}`);
  }
}

async function clearPicked(): Promise<void> {
  const p = state.worldObjects.picked;
  if (!p) return;
  state.worldObjects.picked = undefined;
  await outlineThing(p.key, 0);
}

/** A node of the registry as a world edit names it. */
function refOfNode(n: WorldNode, sector: string): WorldNodeRef {
  const id = idText(n.nodeId);
  return { sector, sectorHash: n.sector, entry: n.instance, node: n.index, type: n.kind, ...(id ? { globalId: id } : {}) };
}

/** What the registry has along a short line down through a place (entity nodes have a 1 m box there, S24). */
async function nodesAt(position: [number, number, number]): Promise<WorldNode[]> {
  if (typeof world.pick !== "function") return [];
  const [x, y, z] = position;
  return (await world.pick({ from: { x, y, z: z + 3 }, dir: { x: 0, y: 0, z: -1 }, max: 6, limit: 40, all: true, physics: false, order: "nearest", helpers: true })).hits;
}

/**
 * An entity's proxy meshes among those nodes: by the entity node's proxy id when the registry gives one,
 * else at the entity's own place (D0 found V's door's proxy at 0.00 m from it, in another sector).
 */
function proxiesAmong(hits: WorldNode[], owner: WorldNode | undefined, position: [number, number, number]): WorldNode[] {
  const proxies = hits.filter((h) => h.kind === "worldEntityProxyMeshNode");
  const byId = owner?.proxyId ? proxies.filter((h) => sameId(h.nodeId, owner.proxyId)) : [];
  if (byId.length) return byId;
  return proxies.filter((h) => Math.hypot(h.position[0] - position[0], h.position[1] - position[1], h.position[2] - position[2]) < 0.05);
}

/**
 * A door's node: the registry along a short line down through its place (entity nodes have a 1 m box
 * there, S24), the one whose global id is the entity's (D0: they are the same). Then its sector's name
 * and its reference, from REDbridge, for the warnings.
 */
async function findNode(p: WorldPicked, seq: number): Promise<void> {
  if (typeof world.pick !== "function" || typeof world.node !== "function") {
    p.note = "Finding its node needs REDnode 0.67.3 or later.";
    return;
  }
  try {
    let node: WorldNode | undefined;
    const hits: WorldNode[] = [];
    if (p.what === "mesh") {
      node = (await world.node(p.key)) ?? undefined;
    } else {
      hits.push(...(await nodesAt(p.position)));
      node = hits.find((n) => sameId(n.nodeId, p.key) || sameId(n.entity, p.key));
    }
    if (seq !== pickSeq) return;
    if (!node) {
      p.note = state.worldObjects.registry?.sectors
        ? "Its node was not found in REDnode's world node registry, so it cannot be removed yet. Move away and back, or load the save again."
        : "REDnode's world node registry knows no part of the world yet: load the save again, or fast travel, then pick it again.";
      return;
    }
    const found = node;
    const sector = await pathOf(found.sector);
    p.node = refOfNode(found, sector);
    // Its proxy mesh, when the registry has it loaded. Hidden with it: a hidden entity does not come in
    // after a save loads, and the game then shows its proxy in its place (D1a test, step 9). The bake removes it too (D0).
    if (p.what === "mesh" && placesEntity(found.kind)) hits.push(...(await nodesAt(p.position)));
    const proxies = p.what === "mesh" && !placesEntity(found.kind) ? [] : proxiesAmong(hits, found, p.position);
    if (proxies.length) p.proxies = await Promise.all(proxies.map(async (h) => refOfNode(h, await pathOf(h.sector))));
    p.note = undefined;
    if (bridge?.running && sector) {
      try {
        const r = await bridge.call<{ items?: { index?: number; ref?: string | null; resource?: string | null; appearance?: string | null }[] }>("sector.nodes", { path: sector });
        const item = (r.items ?? []).find((i) => i.index === found.instance);
        if (item?.ref) p.ref = item.ref;
        // REDnode's registry names no file for some kinds (a worldCookedStaticMeshNode, found in game on
        // 2026-11-27): the sector's own record does, so the drawer can draw it and Drop a copy has a file.
        if (!p.resource && item?.resource) {
          p.resource = item.resource;
          if (!p.appearance && item.appearance) p.appearance = item.appearance;
          if (p.what === "mesh") p.label = `${found.kind.replace(/^world|Node$/g, "")} ${path.basename(item.resource)}`;
          if (p.what === "mesh" && p.collision === undefined) {
            const c = await meshCollision(item.resource).catch(() => undefined);
            if (c !== undefined) p.collision = c;
          }
        }
      } catch (err) {
        console.log(`${p.label}: its sector record was not read (${(err as Error).message})`);
      }
    }
    if (seq !== pickSeq) return;
    p.warnings = [...questWarnings(p.ref, sector), ...(/Cooked|Instanced|Foliage/.test(found.kind) ? ["This node holds several meshes as one: removing it removes all of them."] : [])];
  } catch (err) {
    p.note = `Its node was not found: ${(err as Error).message}`;
  }
}

/**
 * Picks a door from the list or a click: the scene's selection goes, the door is outlined, its node is looked up.
 * `late`: details that come later (a mesh's collision data), added while it is still the picked thing.
 */
async function pickThing(t: WorldThing, late?: Promise<Partial<WorldThing> | undefined>): Promise<void> {
  const seq = ++pickSeq;
  await clearPicked();
  if (state.selected.length) await select([]);
  const p: WorldPicked = { ...t, warnings: [], note: "Looking for its node..." };
  state.worldObjects.picked = p;
  void late?.then((x) => {
    if (!x || seq !== pickSeq || state.worldObjects.picked !== p) return;
    Object.assign(p, x);
    publish();
  });
  await outlineThing(t.key, WorldOutline);
  publish();
  await findNode(p, seq);
  if (seq === pickSeq) publish();
}

/** Whether a mesh's file carries collision data, from REDbridge's mesh.info (kept in the asset index); undefined without REDbridge. */
async function meshCollision(resource: string | undefined): Promise<boolean | null | undefined> {
  if (!resource || !/.mesh$/i.test(resource)) return undefined;
  const known = sourceOf(resource) ? undefined : index.info[resource];
  if (known && !known.error && known.hasCollision !== undefined) return known.hasCollision;
  const b = bridge;
  if (!b?.running || state.bridge.status !== "ready") return undefined;
  const info = await assetInfo(b, resource).catch(() => undefined);
  return info && !info.error ? (info.hasCollision ?? null) : undefined;
}

/** A mesh the registry's pick found: the World panel shows it as a thing of its own. */
async function pickMesh(n: WorldNode, physicsHit?: { distance: number } | null): Promise<void> {
  const resource = await pathOf(n.resource);
  const collision = meshCollision(resource).then((c) => (c === undefined ? undefined : { collision: c }));
  await pickThing({
    // The game's physics stopped the line inside its bounds: solid there.
    ray: { solid: !!n.holdsHit, distance: n.holdsHit ? physicsHit?.distance : undefined },
    scale: n.scale,
    box: n.bounds,
    orientation: n.orientation,
    key: n.id,
    what: "mesh",
    className: n.kind,
    label: `${n.kind.replace(/^world|Node$/g, "")} ${resource ? path.basename(resource) : n.id}`,
    resource: resource || undefined,
    appearance: n.appearance ?? undefined,
    position: n.position,
    removedBy: editFor(scene.worldEdits, { sectorHash: n.sector, entry: n.instance })?.id,
  }, collision);
}

/** Pick under the cursor (0.14.0): the kinds switched on, and meshes whatever their switch says. */
const freeKinds = (): WorldKind[] => [...new Set<WorldKind>([...state.worldObjects.kinds, "mesh"])];

/** What a click along this line would pick: a door along it, else (Meshes on) the mesh it hits. */
async function pickTarget(origin: V3, dir: V3, kinds: WorldKind[]): Promise<{ door?: WorldThing; node?: WorldNode; physicsHit?: { distance: number } | null } | undefined> {
  if (kinds.includes("door") || kinds.includes("fakeDoor")) {
    if (Date.now() - nearAt > NearFresh) await lookNear();
    const { hit } = await raycast(origin, add(origin, mul(dir, 80)));
    const door = doorUnderRay(origin, dir, state.worldObjects.things.filter((t) => t.what !== "mesh" && kinds.includes(t.what)), hit ? Math.hypot(...sub(hit, origin)) : undefined);
    if (door) return { door };
  }
  if (kinds.includes("mesh") && typeof world.pick === "function") {
    try {
      const r = await world.pick({ from: toPoint(origin), dir: toPoint(dir), max: 80, limit: 8, kinds: MeshNodeKinds });
      let n = r.hits.find((h) => h.holdsHit);
      let physicsHit = r.physicsHit;
      if (!n) {
        // REDnode's physics line is the Static group alone, which a bake's solid objects are not in: our own line,
        // over every floor group, and the node whose box holds where it stopped.
        const { hit } = await raycast(origin, add(origin, mul(dir, 80)));
        const d = hit ? Math.hypot(...sub(hit, origin)) : undefined;
        if (hit && (!physicsHit || d! < physicsHit.distance - 0.05)) {
          const holder = r.hits.find((h) => boxHolds(hit, h.bounds, h.position, h.orientation, h.scale));
          physicsHit = { point: hit, distance: d! };
          if (holder) n = { ...holder, holdsHit: true };
        }
      }
      n ??= physicsHit ? undefined : r.hits[0];
      if (n) return { node: n, physicsHit };
    } catch (err) {
      console.log(`Mesh pick: ${(err as Error).message}`);
    }
  }
  return undefined;
}

/** A click on none of the scene's objects: a door along the line, else (Meshes on) the mesh it hits, else nothing. `free`: every kind. */
async function worldPick(origin: V3, dir: V3, free = false): Promise<void> {
  const kinds = free ? freeKinds() : state.worldObjects.kinds;
  if (state.world !== "ready" || !kinds.length || state.worldObjects.status === "unavailable") {
    await clearPicked();
    return publish();
  }
  const t = await pickTarget(origin, dir, kinds);
  if (t?.door) return pickThing(t.door);
  if (t?.node) return pickMesh(t.node, t.physicsHit);
  await clearPicked();
  publish();
}

// Pick under the cursor: what a click would pick is outlined while the mouse moves; one look at a time, the newest line next.
let hoverNext: { origin: V3; dir: V3; free: boolean; outline: boolean } | null | undefined;
/** The key of the thing under the cursor last told to the page (Show tooltip). */
let hoverSentKey: string | null = null;
let hoverLooking = false;

async function runHover(): Promise<void> {
  if (hoverLooking) return;
  hoverLooking = true;
  try {
    while (hoverNext !== undefined) {
      const next = hoverNext;
      hoverNext = undefined;
      if (!next || state.world !== "ready" || state.worldObjects.status === "unavailable") {
        await hoverThing(null);
        await tellHover(null);
        continue;
      }
      const t = await pickTarget(next.origin, next.dir, next.free ? freeKinds() : state.worldObjects.kinds);
      // The outline only with Pick under the cursor; the page's tooltip either way.
      await hoverThing(next.outline ? (t?.door?.key ?? t?.node?.id ?? null) : null);
      await tellHover(t);
    }
  } finally {
    hoverLooking = false;
  }
}

/** Tells the page what is under the cursor (Show tooltip), when it changed: a door as listed, a mesh from REDnode's registry. */
async function tellHover(t: { door?: WorldThing; node?: WorldNode } | undefined | null): Promise<void> {
  const key = t?.door?.key ?? t?.node?.id ?? null;
  if (key === hoverSentKey) return;
  hoverSentKey = key;
  let thing: WorldThing | null = null;
  if (t?.door) thing = t.door;
  else if (t?.node) {
    const n = t.node;
    const resource = await pathOf(n.resource);
    thing = {
      key: n.id,
      what: "mesh",
      className: n.kind,
      label: `${n.kind.replace(/^world|Node$/g, "")} ${resource ? path.basename(resource) : n.id}`,
      resource: resource || undefined,
      appearance: n.appearance ?? undefined,
      position: n.position,
      scale: n.scale,
      box: n.bounds,
      orientation: n.orientation,
      ray: { solid: !!n.holdsHit },
      collision: sourceOf(resource) ? undefined : index.info[resource]?.hasCollision,
      removedBy: editFor(scene.worldEdits, { sectorHash: n.sector, entry: n.instance })?.id,
    };
  }
  channel.post({ type: "hover", thing });
  // Its collision data not read yet: told again once REDbridge has read the mesh, if the cursor is still on it.
  if (thing && thing.what === "mesh" && thing.collision === undefined) {
    const c = await meshCollision(thing.resource);
    if (c !== undefined && hoverSentKey === key) channel.post({ type: "hover", thing: { ...thing, collision: c } });
  }
}

async function hoverThing(key: string | null): Promise<void> {
  const picked = state.worldObjects.picked?.key;
  if (hovered && hovered !== key) await outlineThing(hovered, hovered === picked ? WorldOutline : 0);
  hovered = key ?? undefined;
  if (key && key !== picked) await outlineThing(key, HoverOutline);
}

/** How many times a removal saved without its entity's proxy looks for it (every 10 s while the world is in). */
const ProxyLooks = 30;
const proxyLooks = new Map<string, number>();

/** A removal of an entity saved without its proxy (0.12.0): looks for it at the entity's place, and keeps it. */
async function findProxies(e: WorldEdit): Promise<void> {
  if ((e.what === "mesh" && !placesEntity(e.node.type)) || e.proxies?.length) return;
  const id = registryId(e.node);
  const tries = proxyLooks.get(id) ?? 0;
  if (tries >= ProxyLooks) return;
  proxyLooks.set(id, tries + 1);
  try {
    const hits = await nodesAt(e.fingerprint.position);
    const owner = hits.find((h) => h.sector.toLowerCase() === e.node.sectorHash.toLowerCase() && h.instance === e.node.entry);
    const found = proxiesAmong(hits, owner, e.fingerprint.position);
    if (!found.length) return;
    e.proxies = await Promise.all(found.map(async (h) => refOfNode(h, await pathOf(h.sector))));
    if (scene.worldEdits.includes(e)) scene.save();
    console.log(`${e.id}: its proxy mesh found (${e.proxies.map((x) => registryId(x)).join(", ")})`);
  } catch (err) {
    console.log(`${e.id}: looking for its proxy: ${(err as Error).message}`);
  }
}

/** Hides one node; true when the game took it. */
async function hideNode(id: string, what: string): Promise<boolean> {
  try {
    return await world.setVisible!(id, false);
  } catch (err) {
    console.log(`Remove ${what}: ${(err as Error).message}`);
    return false;
  }
}

/**
 * Hides what an edit removes, and an entity's proxy mesh with it. False while the game has not taken all
 * of it (a sector not in yet, a proxy not found yet): tried again while the world is in.
 */
async function hideEdit(e: WorldEdit): Promise<boolean> {
  if (typeof world.setVisible !== "function" || state.world !== "ready") return false;
  const id = registryId(e.node);
  let done = await hideNode(id, e.id);
  await findProxies(e);
  for (const p of e.proxies ?? []) if (!(await hideNode(registryId(p), `the proxy of ${e.id}`))) done = false;
  const proxyMissing = (e.what !== "mesh" || placesEntity(e.node.type)) && !e.proxies?.length && (proxyLooks.get(id) ?? 0) < ProxyLooks;
  if (done && !proxyMissing) pendingHides.delete(id);
  else {
    pendingHides.set(id, e);
    hideAgainSoon();
  }
  return done;
}

/**
 * Shows again what an edit removed, unless another scene in the world still removes it. False when it
 * was an entity that is not in the game: removed before a save loaded, it never came in, so its proxy
 * stands in its place until its area loads again (D1a test, step 10; REDnode #52).
 */
async function showEdit(e: WorldEdit): Promise<boolean> {
  const id = registryId(e.node);
  pendingHides.delete(id);
  const others = [...scene.worldEdits, ...[...onEdits.values()].flat()];
  if (others.some((x) => x.action === "remove" && registryId(x.node).toLowerCase() === id.toLowerCase())) return true;
  if (typeof world.setVisible !== "function") return true;
  for (const n of [e.node, ...(e.proxies ?? [])]) {
    try {
      await world.setVisible(registryId(n), true);
    } catch (err) {
      console.log(`Restore ${e.id}: ${(err as Error).message}`);
    }
  }
  if (e.what === "mesh" || !e.node.globalId || state.world !== "ready") return true;
  const there = await world.entity(e.node.globalId).catch(() => null);
  if (!there) console.log(`${e.id}: its entity is not in the game, so its stand-in shows until its area loads again`);
  return !!there;
}

/** What to add when doors came back as their stand-ins. */
function standInNote(n: number): string {
  return n ? ` ${n === 1 ? "It shows as its stand-in" : `${n} show as their stand-ins`} until the area loads again (fast travel away and back, or load a save): removed before the last load, the working ${n === 1 ? "door is" : "doors are"} not in the game yet.` : "";
}

function hideAgainSoon(): void {
  if (hideTimer) return;
  hideTimer = setTimeout(() => {
    hideTimer = undefined;
    if (!pendingHides.size || state.world !== "ready") return;
    void (async () => {
      for (const e of [...pendingHides.values()]) await hideEdit(e);
      if (pendingHides.size) console.log(`${pendingHides.size} removal${pendingHides.size === 1 ? "" : "s"} wait for their part of the world to load`);
    })();
  }, 10_000);
}

/** The open scene's removals, and those of the scenes that are on, in the game again (a save loaded, a scene opened). */
async function applyEdits(): Promise<void> {
  if (state.world !== "ready") return;
  // Door states are never baked (D5): they are kept whether the scene's bake is in the game or not.
  doorsIn.clear();
  await keepDoors();
  const removals = (edits: WorldEdit[]) => edits.filter((e) => e.action === "remove");
  if (state.bake.inGame && removals(scene.worldEdits).length) {
    console.log(`World edits: ${scene.name}'s bake is in the game (${state.bake.inGame}), which removes them; nothing to hide`);
    for (const e of removals(scene.worldEdits)) pendingHides.delete(registryId(e.node));
  }
  const all = removals([...(state.bake.inGame ? [] : scene.worldEdits), ...[...onEdits.values()].flat()]);
  if (!all.length) return;
  let done = 0;
  for (const e of all) if (await hideEdit(e)) done++;
  console.log(`World edits: ${done} of ${all.length} removal${all.length === 1 ? "" : "s"} in the game${done < all.length ? "; the rest when their part of the world loads" : ""}`);
}

/** Remove from world: the picked door (or mesh) hidden now and kept in the scene. One undo step. */
async function removePicked(): Promise<void> {
  const p = state.worldObjects.picked;
  if (!scene.file) return say(NoScene, "warn");
  if (!p) return say("Pick a door first: with Edit on, click one, or pick it on the World tab.", "warn");
  if (!p.node) {
    await findNode(p, pickSeq);
    if (!p.node) return say(`${p.label}: ${p.note ?? "its node was not found"}`, "warn");
  }
  const already = editFor(scene.worldEdits, p.node);
  if (already) return say(`${p.label} is removed already (${already.id}). Restore on the Scene tab brings it back.`, "info");
  step();
  const edit: WorldEdit = {
    id: editId(p.label, scene.worldEdits),
    action: "remove",
    what: p.what,
    label: p.label,
    node: p.node,
    fingerprint: { ...(p.resource ? { resource: p.resource } : {}), ...(p.appearance ? { appearance: p.appearance } : {}), position: p.position },
    ...(p.proxies?.length ? { proxies: p.proxies } : {}),
    ...(p.ref ? { ref: p.ref } : {}),
  };
  scene.worldEdits.push(edit);
  scene.save();
  await outlineThing(p.key, 0);
  const hidden = await hideEdit(edit);
  p.removedBy = edit.id;
  for (const t of state.worldObjects.things) if (t.key === p.key) t.removedBy = edit.id;
  say(
    hidden
      ? `Removed ${p.label} from the world. It stays gone while this scene is open in EDGEbuilder; Restore on the Scene tab, or Undo, brings it back.`
      : `${p.label} is in the scene's removals, but the game did not hide it yet (the log says why); it is tried again while you play.`,
    hidden ? "ok" : "warn",
  );
}

/** Restore: a removal taken out of the scene, and what it removed back in the world. One undo step. */
async function restoreEdit(id: string): Promise<void> {
  const e = scene.worldEdits.find((x) => x.id === id);
  if (!e) return publish();
  step();
  scene.worldEdits = scene.worldEdits.filter((x) => x !== e);
  scene.save();
  const working = await unapplyEdit(e);
  for (const t of [...state.worldObjects.things, ...(state.worldObjects.picked ? [state.worldObjects.picked] : [])]) {
    if (t.removedBy === id) t.removedBy = undefined;
    if (t.stateBy === id) t.stateBy = undefined;
  }
  if (e.action === "door") {
    void refreshPickedDoor();
    return say(`${e.label} is no longer kept ${doorStateText(e.door)}${e.before ? `: it is back as it was (${doorStateText(e.before)})` : ""}. Undo keeps it again.`, "ok");
  }
  say(`Restored ${e.label}: it is back in the world. Undo removes it again.${standInNote(working ? 0 : 1)}`, working ? "ok" : "info");
}

// ---- door states (D2) ----------------------------------------------------------------------------
// A scene can keep a door open, closed, locked or unlocked. A bake cannot set a door's state (D5), so
// EDGEbuilder sets it in the running game: when the scene opens or a save loads, and each time the door
// comes into the world again. In between the player is free to use the door, except that a door kept
// open does not close itself (its setup's `automaticallyClosesItself` is switched off while it is kept).
// The state is the door's own, kept in the player's save (D4); Restore and Undo put back how it was.

/** How often the doors a scene keeps are looked at, in ms: whether each is in the world, newly or still. */
const DoorWatch = 4000;
let doorTimer: ReturnType<typeof setInterval> | undefined;
/** The door edits whose door was in the world at the last look, and has its state already. */
const doorsIn = new Set<string>();
/** Doors kept open whose closing by itself could not be switched off: opened again when they close. */
const autoCloses = new Set<string>();

function doorEdits(): WorldEdit[] {
  return [...scene.worldEdits, ...[...onEdits.values()].flat()].filter((e) => e.action === "door");
}

async function doorEntity(e: Pick<WorldEdit, "node">): Promise<GameRef | null> {
  if (!e.node.globalId || state.world !== "ready") return null;
  return world.entity(e.node.globalId).catch(() => null);
}

/** Switches a door's closing by itself on or off; true when its setup says so afterwards. */
async function setClosesItself(entity: GameRef, value: boolean): Promise<boolean> {
  try {
    const ps = (await entity.GetDevicePS()) as GameRef | null;
    const setup = (await ps?.$get("doorProperties")) as Record<string, unknown> | null | undefined;
    if (!ps || !setup || typeof setup !== "object") return false;
    if (setup.automaticallyClosesItself === value) return true;
    await ps.$set("doorProperties", { ...setup, automaticallyClosesItself: value });
    const back = (await ps.$get("doorProperties")) as Record<string, unknown> | null;
    return back?.automaticallyClosesItself === value;
  } catch (err) {
    console.log(`A door's closing by itself was not changed: ${(err as Error).message}`);
    return false;
  }
}

/** Runs the door's own actions (as its terminals and quickhacks do) that bring it from `now` to `want`. */
async function runDoorActions(entity: GameRef, now: DoorState & { lift?: boolean }, want: DoorState): Promise<number> {
  const acts = doorActions(now, want);
  if (!acts.length) return 0;
  const ps = (await entity.GetDevicePS()) as GameRef;
  const persistency = (await api.GameInstance.GetPersistencySystem(game.instance)) as GameRef;
  const run = async (a: string) => persistency.QueuePSDeviceEvent(await (ps[a] as () => Promise<unknown>)());
  if (!now.lift || !acts.includes("ActionToggleLock")) {
    for (const a of acts) await run(a);
    return acts.length;
  }
  // An elevator's door: sealed or unsealed in place of locked. A sealed door refuses to open or close, so
  // it is closed before the seal goes on, and opened only after the seal comes off.
  const seal = want.locked === true;
  if (seal && now.open) await run("ActionSetClosed");
  await setSealed(ps, persistency, seal);
  if (!seal && want.open === true && !now.open) await run("ActionSetOpened");
  return acts.length;
}

/** Seals or unseals a door: by its own action, and if the game has not taken that half a second later, on its state. */
async function setSealed(ps: GameRef, persistency: GameRef, sealed: boolean): Promise<void> {
  try {
    await persistency.QueuePSDeviceEvent(await (ps.ActionToggleSeal as () => Promise<unknown>)());
  } catch (err) {
    console.log(`A door's seal action was refused (${(err as Error).message}): its state is set instead`);
  }
  await new Promise((r) => setTimeout(r, 500));
  if ((await ps.IsSealed()) !== sealed) await ps.SetIsSealed(sealed);
}

/** Puts a door in the state its edit keeps. False when the door is not in the world, or has no state. */
async function enforceDoor(e: WorldEdit, entity?: GameRef | null): Promise<boolean> {
  if (!e.door) return false;
  const door = entity ?? (await doorEntity(e));
  if (!door) return false;
  const now = await doorStateOf(door);
  if (!now) return false;
  const id = registryId(e.node).toLowerCase();
  try {
    if (e.door.open === true && now.closesItself !== false) {
      if (await setClosesItself(door, false)) autoCloses.delete(id);
      else autoCloses.add(id);
    }
    const n = await runDoorActions(door, now, e.door);
    if (n) console.log(`${e.id}: ${doorStateText(now)} → ${doorStateText({ ...now, ...e.door })}`);
    return true;
  } catch (err) {
    console.log(`${e.id}: its state was not set: ${(err as Error).message}`);
    return false;
  }
}

/** Puts a door back as it was before its edit, unless another scene that is open or on keeps it too. */
async function revertDoor(e: WorldEdit): Promise<boolean> {
  const id = registryId(e.node).toLowerCase();
  doorsIn.delete(id);
  autoCloses.delete(id);
  if (doorEdits().some((x) => registryId(x.node).toLowerCase() === id)) return true;
  const door = await doorEntity(e);
  if (!door) {
    if (state.world === "ready") console.log(`${e.id}: its door is not in the world, so it stays as the save has it`);
    return true;
  }
  const now = await doorStateOf(door);
  if (!now || !e.before) return true;
  if (e.before.closesItself !== undefined) await setClosesItself(door, e.before.closesItself);
  try {
    await runDoorActions(door, now, { open: e.door?.open === undefined ? undefined : e.before.open, locked: e.door?.locked === undefined ? undefined : e.before.locked });
  } catch (err) {
    console.log(`${e.id}: it was not put back: ${(err as Error).message}`);
  }
  return true;
}

/** One look at the doors the scenes keep: a door that came into the world gets its state. */
async function keepDoors(): Promise<void> {
  const edits = doorEdits();
  if (!edits.length || state.world !== "ready") {
    if (!edits.length && doorTimer) {
      clearInterval(doorTimer);
      doorTimer = undefined;
    }
    if (!edits.length) doorsIn.clear();
    return;
  }
  if (!doorTimer) doorTimer = setInterval(() => void keepDoors(), DoorWatch);
  for (const e of edits) {
    const id = registryId(e.node).toLowerCase();
    const door = await doorEntity(e);
    if (!door) {
      doorsIn.delete(id);
      continue;
    }
    if (!doorsIn.has(id)) {
      if (await enforceDoor(e, door)) doorsIn.add(id);
    } else if (autoCloses.has(id)) {
      // It closes itself and that could not be switched off: open it again.
      await enforceDoor(e, door);
    }
  }
}

/** Applies an edit in the game: a removal hidden, a door's state set. */
async function applyEdit(e: WorldEdit): Promise<boolean> {
  if (e.action !== "door") return hideEdit(e);
  const done = await enforceDoor(e);
  if (done) doorsIn.add(registryId(e.node).toLowerCase());
  void keepDoors();
  return done;
}

/** Takes an edit back in the game. False only for a door brought back as its stand-in. */
async function unapplyEdit(e: WorldEdit): Promise<boolean> {
  const done = e.action === "door" ? await revertDoor(e) : await showEdit(e);
  void keepDoors();
  return done;
}

/** Edits taken back and applied (Undo, Redo): a door whose kept state only changed is not put back first. Returns how many doors came back as stand-ins. */
async function changeEdits(back: WorldEdit[], on: WorldEdit[]): Promise<number> {
  const staying = new Set(on.filter((e) => e.action === "door").map((e) => registryId(e.node).toLowerCase()));
  let standIns = 0;
  for (const e of back) {
    if (e.action === "door" && staying.has(registryId(e.node).toLowerCase())) continue;
    if (!(await unapplyEdit(e))) standIns++;
  }
  for (const e of on) await applyEdit(e);
  return standIns;
}

/** The picked door's state read again, a moment after its actions ran (the game moves it within 1.5 s, D4). */
async function refreshPickedDoor(): Promise<void> {
  const p = state.worldObjects.picked;
  if (!p || p.what !== "door") return;
  await new Promise((r) => setTimeout(r, 1500));
  if (state.worldObjects.picked !== p) return;
  const entity = liveThings.get(p.key) ?? (await world.entity(p.key).catch(() => null));
  if (!entity) return;
  p.door = await doorStateOf(entity);
  for (const t of state.worldObjects.things) if (t.key === p.key) t.door = p.door;
  publish();
}

/** Open, Close, Lock, Unlock on the picked door: done now, and kept in the scene. One undo step. */
async function doorAction(act: "open" | "close" | "lock" | "unlock"): Promise<void> {
  const p = state.worldObjects.picked;
  if (!scene.file) return say(NoScene, "warn");
  if (!p || p.what !== "door") return say("Pick a door that opens first: with Edit on, click one, or pick it on the World tab.", "warn");
  if (!p.node) {
    await findNode(p, pickSeq);
    if (!p.node) return say(`${p.label}: ${p.note ?? "its node was not found"}`, "warn");
  }
  const removed = editFor(scene.worldEdits, p.node);
  if (removed) return say(`${p.label} is removed from the world (${removed.id}): Restore it on the Scene tab first.`, "info");
  const entity = liveThings.get(p.key) ?? (await world.entity(p.key).catch(() => null));
  if (!entity) return say(`${p.label} is not in the world now: go near it, then pick it again.`, "warn");
  const now = await doorStateOf(entity);
  if (!now || (now.open === undefined && now.locked === undefined)) return say(`${p.label} has no state the game lets EDGEbuilder set.`, "warn");
  const old = editFor(scene.worldEdits, p.node, "door");
  const want = doorAfter(old?.door ?? {}, act);
  step();
  let e: WorldEdit;
  if (old) {
    // The past keeps its own copy (scene.state() copies the edits), so this one can change.
    old.door = want;
    e = old;
  } else {
    e = {
      id: editId(p.label, scene.worldEdits, "door"),
      action: "door",
      what: "door",
      label: p.label,
      node: p.node,
      fingerprint: { ...(p.resource ? { resource: p.resource } : {}), ...(p.appearance ? { appearance: p.appearance } : {}), position: p.position },
      door: want,
      before: { open: now.open, locked: now.locked, ...(now.closesItself !== undefined ? { closesItself: now.closesItself } : {}) },
      ...(p.ref ? { ref: p.ref } : {}),
    };
    scene.worldEdits.push(e);
  }
  scene.save();
  // A door kept open no longer closes itself; one only kept closed or locked gets it back.
  if (want.open !== true && e.before?.closesItself === true) await setClosesItself(entity, true);
  const done = await applyEdit(e);
  p.stateBy = e.id;
  for (const t of state.worldObjects.things) if (t.key === p.key) t.stateBy = e.id;
  say(
    done
      ? `${p.label}: kept ${doorStateText(want)} while this scene is open in EDGEbuilder (the door's state is also in your save).${now.lift && want.locked ? " It is an elevator's door, so it is sealed: the elevator cannot open it." : ""} Restore on the Scene tab, or Undo, puts it back as it was.`
      : `${p.label}: kept ${doorStateText(want)} in the scene, but the game did not take it yet (the log says why); it is tried again when the door comes into the world.`,
    done ? "ok" : "warn",
  );
  void refreshPickedDoor();
}

function setKinds(kinds: WorldKind[]): void {
  const known = kinds.filter((k): k is WorldKind => k in KindLabels);
  state.worldObjects.kinds = known;
  saveSettings({ worldKinds: known });
  if (state.worldObjects.picked && !state.worldObjects.picked.fromSector && !known.includes(state.worldObjects.picked.what)) void clearPicked();
}

// ---- sectors (S1, EDGEbuilder #9) ----------------------------------------------------------------
// The World tab's Sectors sub-tab lists the game's streaming sectors (REDbridge's sector.find) around V,
// around the camera, or by name or grid; the Sector drawer lists one sector's node data entries
// (sector.nodes), marked when REDnode's registry has them streamed in. A row picked there goes into
// Selected Node, with the same actions as a door near V. REDcode calls the same through the
// service (select, focus, scenesEditing).

/** At most this many sectors in the list, and node rows in the drawer (the filter narrows them). */
const SectorRowsShown = 200;
const SectorNodesShown = 300;
/** The open sector's entries, as REDbridge read them. */
let sectorItems: SectorItem[] = [];
let sectorFindSeq = 0;
let sectorOpenSeq = 0;
let flySeq = 0;
/** The registry ids hidden for the session from the drawer (not kept in a scene). */
const sessionHidden = new Set<string>();

async function vPosition(): Promise<V3 | undefined> {
  try {
    const player = (await api.GetPlayer(game.instance)) as GameRef | null;
    if (!player) return undefined;
    const p = (await player.GetWorldPosition()) as { X: number; Y: number; Z: number };
    return [p.X, p.Y, p.Z];
  } catch {
    return undefined;
  }
}

/** Whether REDnode's registry has a sector loaded now: undefined when it cannot say. */
async function sectorLoaded(hash: string): Promise<boolean | undefined> {
  if (typeof world.node !== "function" || state.world !== "ready") return undefined;
  try {
    return !!(await world.node(`${hash}:0`));
  } catch {
    return undefined;
  }
}

const noBridgeForSectors = "REDbridge is not running, and it reads the game's sectors. The pills at the top say why.";

async function findSectors(m: Extract<PageMessage, { type: "sectors.find" }>): Promise<void> {
  const sx = state.sectors;
  sx.kinds = m.kinds.filter((k) => k in SectorKinds);
  sx.level = m.level;
  sx.around = m.around;
  sx.text = m.text ?? "";
  if (!bridge?.running) {
    sx.status = "unavailable";
    sx.note = noBridgeForSectors;
    return publish();
  }
  const empty = (note: string) => {
    sx.found = [];
    sx.total = 0;
    sx.status = "ready";
    sx.note = note;
    publish();
  };
  if (!sx.kinds.length) return empty("Switch a kind on.");
  if (m.around === "text" && !sx.text.trim()) return empty("Type part of a sector's name, such as watson or interior, or a grid cell, such as -22 19.");
  let at: V3 | undefined;
  if (m.around !== "text") {
    if (state.world !== "ready") return empty("Load a save: the sectors around V or the camera are listed then.");
    at = m.around === "camera" && m.at ? m.at : await vPosition();
    if (!at) return empty("V's place is not known yet.");
  }
  const seq = ++sectorFindSeq;
  sx.status = "looking";
  sx.note = undefined;
  publish();
  try {
    const started = Date.now();
    const levels = levelsOf(sx.level);
    const r = await bridge.call<{ total: number; sectors: FoundSector[] }>("sector.find", {
      kinds: bridgeKinds(sx.kinds),
      ...(levels ? { levels } : {}),
      ...(at ? { box: { min: [at[0] - 1, at[1] - 1, at[2] - 1], max: [at[0] + 1, at[1] + 1, at[2] + 1] } } : {}),
    });
    if (seq !== sectorFindSeq) return;
    const hits = m.around === "text" ? r.sectors.filter((s) => sectorMatches(s, sx.text)) : r.sectors;
    sx.found = sectorRows(hits, at, SectorRowsShown);
    sx.total = hits.length;
    await Promise.all(
      sx.found.map(async (row) => {
        const on = await sectorLoaded(sectorHash(row.path));
        if (on !== undefined) row.streamed = on;
      }),
    );
    if (seq !== sectorFindSeq) return;
    sx.status = "ready";
    console.log(`Sectors ${m.around === "text" ? `matching "${sx.text}"` : `around ${m.around === "V" ? "V" : "the camera"}`}: ${hits.length} (${Date.now() - started} ms)`);
  } catch (err) {
    if (seq !== sectorFindSeq) return;
    const msg = (err as Error).message;
    sx.status = "ready";
    sx.found = [];
    sx.total = 0;
    sx.note = /not found|unknown method/i.test(msg) ? "This REDbridge cannot list sectors: it needs 0.12.0 or later (EDGEdeck: Get REDbridge)." : `REDbridge could not list the sectors: ${msg}`;
  }
  publish();
}

/** The drawer's rows from the open sector's entries and filter, with the registry's marks. */
async function showSectorRows(): Promise<void> {
  const view = state.sectors.open;
  if (!view || view.status !== "ready") return;
  const { rows, matching } = nodeRows(sectorItems, view.filter, SectorNodesShown, view.selected);
  view.matching = matching;
  view.loaded = await sectorLoaded(view.hash);
  for (const r of rows) {
    if (sessionHidden.has(`${view.hash}:${r.entry}`)) r.hidden = true;
    r.streamed = null;
  }
  if (view.loaded && typeof world.node === "function") {
    for (let i = 0; i < rows.length; i += 40) {
      await Promise.all(
        rows.slice(i, i + 40).map(async (r) => {
          try {
            const n = await world.node!(`${view.hash}:${r.entry}`);
            r.streamed = n ? n.streamed : null;
          } catch {
            r.streamed = null;
          }
        }),
      );
    }
  }
  if (state.sectors.open === view) view.nodes = rows;
}

/** Opens the Sector drawer on a sector: its entries read through REDbridge. */
async function openSector(depotPath: string): Promise<SectorView> {
  const known = state.sectors.open;
  if (known && known.path.toLowerCase() === depotPath.toLowerCase() && known.status === "ready") return known;
  const seq = ++sectorOpenSeq;
  const row = state.sectors.found.find((r) => r.path.toLowerCase() === depotPath.toLowerCase());
  const view: SectorView = { path: depotPath, hash: sectorHash(depotPath), kind: row?.kind ?? "", level: row?.level ?? 0, status: "reading", total: 0, matching: 0, filter: "", nodes: [] };
  state.sectors.open = view;
  sectorItems = [];
  publish();
  if (!bridge?.running) {
    view.status = "error";
    view.error = noBridgeForSectors;
    publish();
    return view;
  }
  try {
    const started = Date.now();
    const r = await bridge.call<{ kind?: string; level?: number; items: SectorItem[]; warnings?: string[] }>("sector.nodes", { path: depotPath });
    if (seq !== sectorOpenSeq) return view;
    sectorItems = r.items ?? [];
    if (r.kind) view.kind = r.kind;
    if (typeof r.level === "number") view.level = r.level;
    view.total = sectorItems.length;
    view.status = "ready";
    for (const w of r.warnings ?? []) console.log(`${sectorName(depotPath)}: ${w}`);
    console.log(`${sectorName(depotPath)}: ${view.total} entries (${Date.now() - started} ms)`);
    await showSectorRows();
  } catch (err) {
    if (seq !== sectorOpenSeq) return view;
    view.status = "error";
    view.error = `REDbridge could not read it: ${(err as Error).message}`;
  }
  publish();
  return view;
}

async function filterSector(text: string): Promise<void> {
  const view = state.sectors.open;
  if (!view) return;
  view.filter = text;
  await showSectorRows();
  publish();
}

/** The world thing a sector's entry is: a door by its entity when one is in the world, else a node by its registry id. */
async function sectorThing(view: SectorView, item: SectorItem): Promise<WorldThing> {
  const key = `${view.hash}:${item.index}`;
  const resource = item.resource ?? undefined;
  const position: V3 = [item.transform.position[0] ?? 0, item.transform.position[1] ?? 0, item.transform.position[2] ?? 0];
  if (placesEntity(item.kind) && item.hash) {
    const entity = await world.entity(item.hash).catch(() => null);
    const cls = entity ? String(await (entity.GetClassName as () => Promise<unknown>)().catch(() => "")) : "";
    const what = kindOfClass(cls);
    if (entity && what) {
      liveThings.set(item.hash, entity);
      return {
        key: item.hash,
        what,
        fromSector: view.path,
        className: cls,
        label: [what === "fakeDoor" ? "Painted-on door" : cls, resource ? path.basename(resource) : "", item.appearance ? `(${item.appearance})` : ""].filter(Boolean).join(" "),
        resource,
        appearance: item.appearance ?? undefined,
        position,
        door: what === "door" ? await doorStateOf(entity) : undefined,
        removedBy: scene.worldEdits.find((x) => x.action === "remove" && sameId(x.node.globalId, item.hash))?.id,
        stateBy: scene.worldEdits.find((x) => x.action === "door" && sameId(x.node.globalId, item.hash))?.id,
      };
    }
  }
  return {
    key,
    what: "mesh",
    fromSector: view.path,
    className: item.kind,
    label: `${shortKind(item.kind)} ${resource ? path.basename(resource) : `#${item.index}`}`,
    resource,
    appearance: item.appearance ?? undefined,
    position,
    removedBy: editFor(scene.worldEdits, { sectorHash: view.hash, entry: item.index })?.id,
  };
}

/** Picks one of the open sector's entries into Selected Node; whether it is streamed in now. */
async function selectSectorEntry(entry: number): Promise<{ selected: boolean; streamed: boolean }> {
  const view = state.sectors.open;
  const item = sectorItems.find((i) => i.index === entry);
  if (!view || !item) return { selected: false, streamed: false };
  view.selected = entry;
  // An entry past the rows shown joins them, so the drawer can show it picked.
  if (!view.nodes.some((r) => r.entry === entry)) await showSectorRows();
  const t = await sectorThing(view, item);
  await pickThing(t);
  const n = typeof world.node === "function" ? await world.node(`${view.hash}:${entry}`).catch(() => null) : null;
  const p = state.worldObjects.picked;
  if (p && !p.node && !n) p.note = "Not streamed in now: go near it (or fly there) for the game to load it, then pick it again.";
  publish();
  return { selected: true, streamed: !!n?.streamed };
}

async function hideSectorEntry(entry: number, hidden: boolean): Promise<void> {
  const view = state.sectors.open;
  if (!view || typeof world.setVisible !== "function") return;
  const id = `${view.hash}:${entry}`;
  try {
    const done = await world.setVisible(id, !hidden);
    if (hidden && done) sessionHidden.add(id);
    if (!hidden) sessionHidden.delete(id);
    if (hidden && !done) say(`Entry ${entry} was not hidden: it is not streamed in now.`, "info");
  } catch (err) {
    say(`Entry ${entry}: ${(err as Error).message}`, "warn");
  }
  for (const r of view.nodes) if (r.entry === entry) r.hidden = sessionHidden.has(id);
  publish();
}

/** The service's select: opens the drawer on the sector with the entry picked. */
export async function serviceSelect(where: { sector: string; entry: number }): Promise<{ selected: boolean; streamed: boolean; why?: string }> {
  if (!where?.sector || !Number.isInteger(where.entry)) throw new Error("select takes { sector, entry }: the sector's depot path and a node data entry");
  const view = await openSector(where.sector);
  if (view.status !== "ready") return { selected: false, streamed: false, why: view.error ?? "the sector is not read yet" };
  if (!sectorItems.some((i) => i.index === where.entry)) return { selected: false, streamed: false, why: `the sector has no entry ${where.entry} (it has ${view.total})` };
  return selectSectorEntry(where.entry);
}

/** The service's focus: as select, then the camera flies there with Edit on. */
export async function serviceFocus(where: { sector: string; entry: number }): Promise<{ focused: boolean; streamed?: boolean; why?: string }> {
  if (state.world !== "ready") return { focused: false, why: "No save is loaded in the game." };
  const r = await serviceSelect(where);
  if (!r.selected) return { focused: false, why: r.why };
  const item = sectorItems.find((i) => i.index === where.entry);
  if (item) state.sectors.fly = { seq: ++flySeq, position: [item.transform.position[0] ?? 0, item.transform.position[1] ?? 0, item.transform.position[2] ?? 0] };
  publish();
  return { focused: true, streamed: r.streamed };
}

/** The sectors a scene removes from that the project has a file of its own for: ArchiveXL refuses those removals (the entry count changes). */
function replacedSectors(project: { archive: string }, edits: WorldEdit[]): string[] {
  const sectors = [...new Set(edits.filter((e) => e.action === "remove" && e.node.sector).map((e) => e.node.sector))];
  return sectors.filter((p) => fs.existsSync(path.join(project.archive, ...p.split(/[\/]/))));
}

/** The service's scenesEditing: the scenes whose removals name the sector. */
export function serviceScenesEditing(sector: string): { name: string; file: string; place: string; removals: number }[] {
  if (!sector) throw new Error("scenesEditing takes a sector's depot path");
  const out: { name: string; file: string; place: string; removals: number }[] = [];
  for (const sc of listScenes()) {
    let removals = 0;
    try {
      removals = sc.open ? editsInSector(scene.worldEdits, sector) : editsInSector((JSON.parse(fs.readFileSync(sc.file, "utf8")) as { worldEdits?: [] }).worldEdits, sector);
    } catch {
      continue;
    }
    if (removals) out.push({ name: sc.name, file: sc.file, place: sc.place, removals });
  }
  return out;
}

// ---- requests from the page -------------------------------------------------------------------

function runSearch(): void {
  // No text: nothing, as after the search box's ✕; Mods and Project still list all they hold.
  const blank = !state.query.text.trim() && (state.query.from === "all" || state.query.from === "game");
  state.results = !blank && (index.entries.length || index.extra.length) ? index.search(state.query.text, state.query.kind, ResultLimit, state.query.from) : [];
  publish();
}

async function drop(assetPath: string, appearance?: string, at?: { origin: V3; dir: V3 }, like?: DropLike): Promise<void> {
  if (!scene.file) return say(NoScene, "warn");
  const person = isRecord(assetPath) ? npcs.find(assetPath) : undefined;
  if (isRecord(assetPath) && !person) return say(`${assetPath} is not in the NPC list.`, "warn");
  const kind = person ? "npc" : kindOf(assetPath);
  if (!kind) return say(`${assetPath} is not a mesh or an entity template.`, "warn");
  // A person's look: the one picked, the record's own, or none (the game picks, and the drop keeps it).
  const look = person ? (appearance === AnyLook ? undefined : (appearance ?? person.appearance)) : appearance;
  if (state.world !== "ready") await checkWorld();
  if (state.world !== "ready") return say(worldBlocker(), "warn");
  const waiting = unswapped.get(assetKey(assetPath));
  if (waiting) {
    const why = await swapIn(waiting);
    if (why) return say(`${path.basename(assetPath, ".ent")} was imported, but it is not in the game yet: ${why}. Then press Drop again.`, "warn");
    unswapped.delete(assetKey(assetPath));
    console.log(`Swapped ${path.basename(waiting)} in for ${assetPath}`);
  }
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
    // A copy of another object (the Objects drawer's eye): its scale, Solid, Seen from and a person's settings.
    if (like) {
      if (like.scale && !person) o.transform.scale = [...like.scale] as V3;
      if (kind === "mesh" && like.solid !== undefined) o.solid = like.solid;
      if (like.streaming) o.streaming = { ...like.streaming };
      if (person && like.props) o.props = { ...like.props };
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
  if (ids.length) await clearPicked();
  const off = state.selected.filter((id) => !ids.includes(id));
  // After Edit went off the kept ones lost their outline too, so all of them get it back.
  const on = outlinesOff ? ids : ids.filter((id) => !state.selected.includes(id));
  state.selected = ids;
  outlinesOff = false;
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
      return say(`${id} is selected, but the game did not place its preview (the log says why). There is no gizmo without a preview; its numbers in the Selected Object panel still work.${noCamera}`, "warn");
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
  scanModelPlaces();
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

/** How many doors the last scene switch brought back as their stand-ins, for its message. */
let switchStandIns = 0;

/** Takes the open scene's previews out and makes `data` the open scene, saved to `file`, with a fresh history. */
async function switchTo(data: SceneFile, file: string): Promise<void> {
  for (const o of scene.objects) await removePreview(o);
  // Its removals go with it (unless a scene that is on keeps one); the next scene's come.
  const leaving = scene.worldEdits;
  scene.worldEdits = [];
  switchStandIns = 0;
  for (const e of leaving) if (!(await unapplyEdit(e))) switchStandIns++;
  await clearPicked();
  state.selected = [];
  state.duplicated = undefined;
  past.length = 0;
  future.length = 0;
  scene.take(data, file);
  writeSession();
  await applyEdits();
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
  say(`Closed ${was}. It is saved in ${where}; the Library tab opens it again.${standInNote(switchStandIns)}`, "ok");
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
  scene.id = undefined; // a new scene: save gives it its own id
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
  const data = readSceneFile(file);
  // REDnode reads formats 1 and 2: it gets the objects, and EDGEbuilder applies the scene's removals.
  const r = await world.load(forReader(data), { name: file, wait: false, alwaysSpawned: true });
  for (const s of r.skipped) console.log(`${path.basename(file)}: ${s.object} not shown: ${s.why}`);
  onScenes.set(file, r.spawned.length);
  const edits = readableEdits(data.worldEdits);
  if (edits.length) {
    onEdits.set(file, edits);
    for (const e of edits) await applyEdit(e);
  } else onEdits.delete(file);
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
  const edits = onEdits.get(known) ?? [];
  onEdits.delete(known);
  for (const e of edits) await unapplyEdit(e);
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
  /** The scene's own id, made at its first save; kept through a rename or a move. Absent on a scene EDGEbuilder has not saved yet. */
  id?: string;
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
        ...(sameFile(s.file, scene.file) && scene.id ? { id: scene.id } : s.id ? { id: s.id } : {}),
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
  if (!which || sameFile(which, scene.file) || which.toLowerCase() === scene.name.toLowerCase() || which === scene.id) data = scene.data();
  else {
    const all = listScenes();
    const found =
      all.find((s) => path.isAbsolute(which) && sameFile(s.file, which)) ?? all.find((s) => s.id === which) ?? all.find((s) => s.name.toLowerCase() === which.toLowerCase());
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
  changedTimer = setTimeout(() => service.emit("scene-changed", { name: scene.name, id: scene.file ? (scene.id ?? "") : "", file: scene.file, objects: scene.objects.length }), 500);
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
        await inTurn("Drop", () => drop(m.path, m.appearance, m.at, m.like));
        break;
      case "drop.probe":
        probeNext = { seq: m.seq, origin: m.origin, dir: m.dir };
        await runProbes();
        break;
      case "preview.ask":
      {
        // Tiles in view replace what still waits; a model asked for under the mouse goes first and keeps the rest.
        const asked = m.paths.filter((p) => kindOf(p)).map((p) => ({ path: p, glb: !!m.glb }));
        // Models asked for (the Explorer's preview, a picture turning, Drop at click's outline) stay asked when tiles scroll.
        previewQueue = m.glb ? [...asked, ...previewQueue.filter((q) => !asked.some((a) => a.path === q.path))] : [...previewQueue.filter((q) => q.glb), ...asked];
      }
        await runPreviews();
        break;
      case "explore": {
        // The Explorer (0.14.0): one folder of a place, from the asset index alone (REDbridge is not asked).
        const found = index.explore(m.root, m.dir, m.text ?? "");
        channel.post({ type: "explore", seq: m.seq, root: m.root, dir: m.dir, text: m.text ?? "", roots: index.exploreRoots(), ...found });
        break;
      }
      case "tools.scan":
        scanTools();
        publish();
        break;
      case "tools.log": {
        const t = state.tools.find((x) => x.id === m.id);
        const line = `Tool "${t?.label ?? m.id}": ${m.text}`;
        if (m.tone === "error") console.error(line);
        else if (m.tone === "warn") console.warn(line);
        else console.log(line);
        break;
      }
      case "files": {
        // The Import file picker (0.14.0): one folder of the disk, its folders and GLB files.
        const places = filePlaces(state.library.modelPlaces.map((p) => ({ label: p.label, dir: p.dir })));
        const dir = m.dir || places[0]?.dir || os.homedir();
        channel.post({ type: "files", seq: m.seq, places, ...listFolder(dir) });
        break;
      }
      case "preview.save":
        savePreview(m.key, m.png);
        break;
      case "select":
        await inTurn("Select", () => select(m.ids));
        break;
      case "world.pick":
        try {
          await worldPick(m.origin, m.dir, !!m.free);
        } finally {
          // Done, found or not: the page's spinner stops.
          state.worldObjects.picks = (state.worldObjects.picks ?? 0) + 1;
          publish();
        }
        break;
      case "world.hoverRay":
        hoverNext = m.ray ? { origin: m.ray.origin, dir: m.ray.dir, free: !!m.free, outline: m.outline !== false } : null;
        await runHover();
        break;
      case "world.select": {
        const t = state.worldObjects.things.find((x) => x.key === m.key);
        if (t) await pickThing(t);
        break;
      }
      case "world.hover":
        await hoverThing(m.key);
        break;
      case "world.clear":
        await clearPicked();
        publish();
        break;
      case "world.refresh":
        if (!state.worldObjects.registry?.sectors) await startRegistry();
        await lookNear();
        publish();
        break;
      case "world.kinds":
        setKinds(m.kinds);
        await lookNear();
        publish();
        break;
      case "world.remove":
        await inTurn("Remove from world", () => removePicked());
        break;
      case "project.pick":
        pickProject(m.dir);
        break;
      case "sectors.find":
        await findSectors(m);
        break;
      case "sectors.open":
        await openSector(m.path);
        break;
      case "sectors.close":
        state.sectors.open = undefined;
        sectorItems = [];
        sectorOpenSeq++;
        publish();
        break;
      case "sectors.filter":
        await filterSector(m.text);
        break;
      case "sectors.select":
        await selectSectorEntry(m.entry);
        break;
      case "sectors.hide":
        await hideSectorEntry(m.entry, m.hidden);
        break;
      case "redcode.openSector":
        await openInRedcode(m.sector, m.entry);
        break;
      case "world.door":
        await inTurn("Door", () => doorAction(m.act));
        break;
      case "world.restore":
        await inTurn("Restore", () => restoreEdit(m.id));
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
      case "import":
        await inTurn("Import", () => importModel(m));
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
      case "bringV":
        await inTurn("Bring V", () => bringV());
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
      worldEdits: scene.worldEdits,
      replacedSectors: target ? replacedSectors(target, scene.worldEdits) : [],
    }),
    current,
    stale: !!current?.hash && !fromElsewhere && current.hash !== bakeHash(scene.objects, scene.worldEdits),
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
function sceneToBake(file: string): { name: string; id?: string; game?: string; groups: SceneFile["groups"]; objects: SceneObject[]; worldEdits: WorldEdit[] } {
  if (scene.file && sameFile(file, scene.file)) return { name: scene.name, id: scene.id, game: scene.game, groups: scene.groups, objects: scene.objects, worldEdits: scene.worldEdits };
  const d = readSceneFile(file);
  return { name: d.name, id: typeof d.id === "string" && d.id ? d.id : undefined, game: d.game, groups: d.groups ?? [], objects: d.objects as SceneObject[], worldEdits: readableEdits(d.worldEdits) };
}

/**
 * Where a Library bake's scene is now: where it was baked from, else (moved or renamed inside the Library)
 * the Library scene with its id. Undefined when neither is there.
 */
function bakeSceneFile(root: string, s: { path: string; id?: string }): string | undefined {
  const at = fromLibraryPath(root, s.path);
  if (fs.existsSync(at)) return at;
  if (!s.id) return undefined;
  return state.library.shelves.filter((sh) => sh.place === "library").flatMap((sh) => sh.scenes).find((x) => x.id === s.id && fs.existsSync(x.file))?.file;
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
  // D1b: the game's own objects the scene removes, with their stand-ins (REDbridge finds those).
  const { removals } = bakeRemovals(src.worldEdits);
  let built: SectorBuilt;
  try {
    built = await b.sectorBuild({ project: target.dir, scene: input, ...(root ? { root } : {}), ...(removals.length ? { removals } : {}) });
  } catch (err) {
    const signature = /param|argument|signature|method/i.test((err as Error).message);
    // REDbridge 0.15.0 and before know no `removals` (#18).
    if (removals.length && signature) throw new Error("baking removals needs REDbridge 0.16.0 or later: update it in EDGEdeck (Get REDbridge) or REDnode's Mod Manager");
    // REDbridge before 0.12.0 takes no `root`, and reads only the game's files.
    if (!root || !signature) throw err;
    built = await b.sectorBuild({ project: target.dir, scene: input });
  }
  if (!built.xl) throw new Error(`nothing was written${built.refused?.length ? `: ${built.refused.map((r) => r.why).join("; ")}` : ""}`);
  const xl = built.blockPath ? settleXl(built.xl, built.name, built.blockPath) : built.xl;
  for (const r of built.refused ?? []) console.log(`Bake ${src.name}: a removal was not written (${r.sector} entry ${r.index}): ${r.why}`);
  const record: BakeRecord = {
    slug: built.name,
    name: src.name,
    file,
    hash: bakeHash(src.objects, src.worldEdits),
    objects: built.nodes,
    ...(built.removed?.length ? { removals: built.removed.filter((r) => !r.proxyOf).length, standIns: built.removed.filter((r) => r.proxyOf).length } : {}),
    date: new Date().toISOString(),
    bridge: state.bridge.version,
    box: built.streamingBox ?? undefined,
    needs: sceneNeeds(src.objects.map((o) => o.resource), index.extra),
  };
  writeRecord(target, record);
  const removedText = built.removed?.length ? `, ${built.removed.filter((r) => !r.proxyOf).length} removals with ${built.removed.filter((r) => r.proxyOf).length} stand-ins` : "";
  console.log(`Baked ${src.name}: ${built.nodes} objects${removedText} into ${target.dir} (${built.sector ?? built.xl})${built.warnings.length ? `; ${built.warnings.length} warnings: ${built.warnings.join(" | ")}` : ""}`);
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
  const refused = done.built.refused ?? [];
  state.bake.last = {
    slug: done.built.name,
    files: [done.built.sector, done.built.block, done.xl].filter((f): f is string => !!f).map((f) => path.relative(target.dir, f)),
    warnings: [...done.built.warnings, ...refused.map((r) => `A removal was not written (${path.win32.basename(r.sector)} entry ${r.index}): ${r.why}`)],
  };
  lookAtBakes();
  const n = done.built.nodes;
  const gone = (done.built.removed ?? []).filter((r) => !r.proxyOf).length;
  const standIns = (done.built.removed ?? []).filter((r) => r.proxyOf).length;
  const what = [n ? `${n} object${n === 1 ? "" : "s"}` : "", gone ? `${gone} removal${gone === 1 ? "" : "s"} of the game's own objects${standIns ? ` (and ${standIns} stand-in${standIns === 1 ? "" : "s"})` : ""}` : ""].filter(Boolean).join(" and ");
  say(`Baked ${scene.name}: ${what} into ${target.name}.${refused.length ? ` ${refused.length} removal${refused.length === 1 ? " was" : "s were"} not written (the Bake tab says why).` : ""} Pack and install the project, and start the game again.`, refused.length ? "warn" : "ok");
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
  if (scene.file && sameFile(file, scene.file)) return { name: scene.name, hash: bakeHash(scene.objects, scene.worldEdits) };
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
    const now = { size: st.size, mtime: st.mtimeMs, name: d.name, hash: bakeHash(d.objects as SceneObject[], readableEdits(d.worldEdits)) };
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
      const file = bakeSceneFile(root, s) ?? fromLibraryPath(root, s.path);
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
    // The same scene moved or renamed (its id) is not another scene.
    const other =
      meta.scenes.find((s) => s.slug === slug && !(src.id && s.id === src.id) && !sameFile(fromLibraryPath(root, s.path), file)) ?? plan.find((p) => p.file !== file && slugOf(p.src.name) === slug);
    if (other) throw new Error(`Two scenes called ${src.name} can't be in one bake: a bake's files go by the scene's name. Rename one first.`);
    const stop = checkBake({ file, name: src.name, objects: src.objects, project: target, bridgeReady: true, needs: [], bridgeVersion: state.bridge.version, worldEdits: src.worldEdits }).find((c) => c.tone === "error");
    if (stop) throw new Error(`${src.name}: ${stop.text}`);
  }
  const warnings: string[] = [];
  const isNew = !fs.existsSync(dir);
  // sector.build wants the folder to be there; a new bake that fails leaves nothing behind.
  fs.mkdirSync(dir, { recursive: true });
  for (const { file, src } of plan) {
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
    // A scene renamed since its last bake here: its files under the old name go.
    for (const s of meta.scenes) if (src.id && s.id === src.id && s.slug !== record.slug) removeBakeFiles(target, s.slug);
    meta.scenes = [
      ...meta.scenes.filter((s) => s.path !== at && s.slug !== record.slug && !(src.id && s.id === src.id)),
      { name: record.name, slug: record.slug, path: at, hash: record.hash, ...(src.id ? { id: src.id } : {}) },
    ];
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
    const here = meta.scenes.map((s) => bakeSceneFile(root, s)).filter((f): f is string => !!f);
    const missing = meta.scenes.filter((s) => !bakeSceneFile(root, s)).map((s) => s.name);
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

// ---- import a model (B2d) --------------------------------------------------------------------
//
// A GLB, or a prop on EDGEfab's Desk, into the open REDcode project through EDGEfab's core (fab.cjs,
// loaded at the first Import), then REDbridge packs the project and REDnode swaps the archive into the
// game, and the page picks the new prop on the Assets tab. The steps and their times are in the B2d-0
// probe (docs/testing.md, "B2d Import a model"); most of the wait is making textures.

/** The models Import offers: in the Library, the open project's source\raw and EDGEfab's Desk. */
function scanModelPlaces(): void {
  const raw = project?.raw && fs.existsSync(project.raw) ? project.raw : undefined;
  const desk = deskDir();
  state.library.models = [...scanModels("library", libraryRoot), ...scanModels("raw", raw), ...scanModels("desk", desk)];
  state.library.modelPlaces = [
    ...(libraryRoot ? [{ place: "library" as const, label: "Library", dir: libraryRoot }] : []),
    ...(raw && project ? [{ place: "raw" as const, label: `${project.name}: source\\raw`, dir: raw }] : []),
    { place: "desk" as const, label: "EDGEfab's Desk", dir: desk },
  ];
}

async function importModel(m: { file: string; name?: string; height?: number; collision: "physical" | "box" | "none" }): Promise<void> {
  const checked = checkModelPath(m.file);
  if (!checked.ok) return say(checked.why, "warn");
  if (!project) return say("Import puts the model into the open REDcode project, and none is open. Open or make one in REDcode (VS Code); Refresh on the Bake tab asks again.", "warn");
  const b = bridge;
  if (!b?.running || state.bridge.status !== "ready") return say("REDbridge is not ready, and Import needs it. The pills at the top say why.", "warn");
  let fab: FabCore;
  try {
    fab = loadFab(pkg.dir);
  } catch (err) {
    return say(`Import is not available: ${(err as Error).message}`, "error");
  }
  const target = project;
  const version = `EDGEbuilder ${__VERSION__}`;
  // Stop: the core makes every texture inside one call, so the REDbridge call it is handed refuses
  // the next request once Stop is pressed, and the Import ends within one texture.
  const call: BridgeCall = (method, params) => (stopAsked ? Promise.reject(new Error(ImportStopped)) : b.call(method, params));
  const began = Date.now();
  const step = (text: string) => {
    console.log(`Import: ${text}`);
    if (!running) return;
    running.what = `Import: ${text}`;
    delete running.done;
    delete running.total;
    showBusy();
  };
  const stopped = (after: string) => say(`Import stopped after ${after}.`, "info");
  try {
    let item = checked.file;
    let prepared: FabPrepared;
    if (checked.kind === "glb") {
      step(`preparing ${path.basename(checked.file)} (size, facing, levels of detail, textures)`);
      const made = await fab.makeModel({ from: "file", file: checked.file, ...(m.name ? { name: m.name } : {}) }, { version });
      item = made.folder;
      prepared = made.prepared;
    } else prepared = fab.readItem(item).prepared;
    if (stopAsked) return stopped("preparing: the model waits on EDGEfab's Desk");
    if (m.height && m.height > 0) {
      step(`setting its height to ${m.height} m`);
      prepared = await fab.setSize(item, m.height, { version });
    }
    const folders = fab.projectFolders(target.dir);
    if (!folders) throw new Error(`${target.dir} is not a project EDGEfab's core can read.`);
    let textures = 0;
    step("adding the mesh to the project");
    const added = await fab.addToProject({
      item,
      project: folders,
      call,
      collision: m.collision,
      ...(m.name ? { name: m.name } : {}),
      log: (line) => {
        if (isTextureLine(line)) step(`making textures: ${++textures} done (a large one takes about 10 s)`);
        else if (/making the materials/i.test(line)) step("making the materials and their textures (the long part)");
      },
    });
    if (stopAsked) return stopped("adding it to the project: pack and swap it from REDcode, or Import again");
    step("packing the project");
    const packed = await b.call<{ archive: string; bytes: number; files: number }>("project.pack", { dir: folders.archive, outDir: path.join(target.dir, "packed", "archive", "pc", "mod"), modName: target.modName || target.name });
    scanProject();
    step("swapping it into the game");
    const why = await swapIn(packed.archive);
    const key = assetKey(added.entity);
    if (why) unswapped.set(key, packed.archive);
    else unswapped.delete(key);
    const tone: "ok" | "warn" = why ? "warn" : "ok";
    const swap = why ? ` It is not in the game yet: ${why}. Then press Drop: it tries the swap again.` : " It is in the game now.";
    state.imported = { path: added.entity, at: Date.now() };
    scanModelPlaces();
    const guess = prepared.sizeUnknown && !m.height ? ` Its file has no real size, so its height of ${prepared.size.height.toFixed(2)} m is a guess: type Height and Import again.` : "";
    const secs = Math.round((Date.now() - began) / 1000);
    say(`Imported ${path.basename(added.entity, ".ent")} into ${target.name} in ${secs} s${added.replaced ? ", replacing the earlier one" : ""}${textures ? ` (${textures} textures)` : ""}.${swap}${guess} It is picked on the Assets tab.`, guess ? "warn" : tone);
  } catch (err) {
    if (stopAsked) {
      return say("Import stopped while it added the model to the project, so the project holds part of it. Import it again to finish it, or delete its folder under the project's source\\archive.", "info");
    }
    say(`Import failed: ${(err as Error).message}`, "error");
  }
}

const ImportStopped = "Stopped.";

/** Imported props whose archive is packed but not in the game yet, by entity path: Drop tries the swap again. */
const unswapped = new Map<string, string>();
const assetKey = (p: string) => p.replace(/\//g, "\\").toLowerCase();

/** Swaps a packed archive into the running game. Answers why not, or undefined when it is in. */
async function swapIn(archive: string): Promise<string | undefined> {
  if (state.world !== "ready" || !(await game.state()).world) return "the world is not loaded; load a save";
  try {
    const r = await archives.reload([archive]);
    return r.failed.length ? `the game did not take the archive (${r.failed.map((f) => f.why).join("; ")})` : undefined;
  } catch (err) {
    const message = (err as Error).message;
    // REDnode's refusal names its launcher; one instruction, in EDGEbuilder's words, is enough.
    if (/allow|permission/i.test(message)) return "EDGEbuilder may not swap archives yet. Allow Archives in REDnode's Mod Manager (EDGEbuilder, Permissions)";
    return message;
  }
}

// ---- lifecycle --------------------------------------------------------------------------------

// The host links to the game, or loses it: the world may have become usable, or not.
let linked: boolean | undefined;
/** The overlay's mode as last seen: builder mode pauses when it leaves interactive and resumes when it comes back. */
let overlayMode: string | undefined;
game.onState((s) => {
  if (s.overlay && s.overlay !== overlayMode) {
    overlayMode = s.overlay;
    void queued(() => (s.overlay === "interactive" ? resumeBuilder() : pauseBuilder()));
  }
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
  // As soon as the game is there, before a save loads: the registry knows only sectors that load after it starts (D0).
  else void startRegistry();
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
  liveThings.clear();
  hovered = undefined;
  state.worldObjects.things = [];
  state.worldObjects.picked = undefined;
  publish();
  void checkWorld().then(() => {
    // The registry keeps running across loads; the removals are hidden again once V is in, and the
    // World tab lists the doors around V's new place.
    setTimeout(
      () =>
        void startRegistry()
          .then(() => applyEdits())
          .then(() => lookNear())
          .then(() => publish()),
      PreviewsBackDelay,
    );
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
scanTools();
publish();
// Before a save loads, so the registry knows the sectors that load with it (D0, step 1).
void startRegistry();
void checkWorld();
void startBridge();
watchMods();
void connectRedcode();
