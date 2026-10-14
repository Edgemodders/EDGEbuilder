// EDGEbuilder's Node mod: the brain behind the editor page. It owns the scene, the asset index,
// REDbridge and the preview entities; the page shows state, draws the gizmo and sends requests.
// B1: browse the game's assets, drop one in front of V, select it, delete it.
// B2a: move, turn and scale with the page's gizmo and keys, drop to the floor.

import * as fs from "node:fs";
import * as path from "node:path";
import { api, channel, game, kernel, pkg, world, type GameRef } from "rednode";
import { BridgeClient, KernelBridge, findBridge, isGameFolder, type Bridge } from "./bridge";
import { AssetIndex, kindOf } from "./index";
import { Scene, yawToQuaternion } from "./scene";
import type { AssetKind, PageMessage, SceneObject, SceneTransform, Snapshot } from "./protocol";

/** A base-game entity template that is a bare entity: no components, no appearances. The preview of a mesh is this with a mesh component attached. */
const EmptyEntity = "base\\gameplay\\loot\\containers\\common_suitcases\\appearances\\suitcase_small_placeholder.ent";
const SpawnDistance = 3;
const ResultLimit = 120;

interface Settings {
  bridgePath?: string;
  gameDir?: string;
}

const settingsFile = path.join(pkg.dataDir, "settings.json");
let settings: Settings = {};
try {
  settings = JSON.parse(fs.readFileSync(settingsFile, "utf8"));
} catch {
  // First run.
}

const scene = new Scene(path.join(pkg.dataDir, "scenes", "working.scene.json"));
scene.load();
const index = new AssetIndex(path.join(pkg.dataDir, "index"));
let bridge: Bridge | undefined;
let blockedRetry: ReturnType<typeof setTimeout> | undefined;
let gameKey = "";

const state: Snapshot = {
  ready: true,
  world: "unknown",
  bridge: { status: "off" },
  index: { status: "none", count: 0 },
  results: [],
  query: { text: "", kind: "all" },
  scene: { name: scene.name, objects: scene.objects, file: scene.file },
  settings: { ...settings, settingsFile },
};

function publish(): void {
  state.scene = { name: scene.name, objects: scene.objects, file: scene.file };
  state.settings = { ...settings, settingsFile };
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
  if (!settings.bridgePath && typeof kernel?.bridge === "function") return startKernelBridge(kernel.bridge);
  const exe = findBridge(settings.bridgePath);
  if (!exe) {
    state.bridge = { status: "missing", detail: `No REDbridge found. Install it with REDdeck (Get REDbridge), or put its path in ${settingsFile} as "bridgePath".` };
    state.index = { status: "none", count: 0 };
    publish();
    return;
  }
  const dir = gameDir();
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
  gameKey = `${info.archives}-${info.files}`;
  console.log(`REDbridge ${info.version} ready (${source}), ${info.files} files in ${info.archives} archives`);
  publish();
  if (index.load(gameKey)) {
    state.index = { status: "ready", count: index.entries.length, file: index.file };
    publish();
  } else {
    await buildIndex();
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
  try {
    const s = await game.state();
    if (!s.connected) state.world = "no-game";
    else if (await world.available()) state.world = "ready";
    else state.world = s.mainMenu ? "no-save" : "no-codeware";
  } catch {
    state.world = "unknown";
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

/** Puts an object's preview in the world and remembers the entity. */
async function spawnPreview(o: SceneObject): Promise<void> {
  const [x, y, z] = o.transform.position;
  const [i, j, k, r] = o.transform.rotation;
  const position = { x, y, z };
  const orientation = { i, j, k, r };
  let id: { hash: string };
  if (o.kind === "mesh") {
    const component = (await api.$new("entMeshComponent", {
      name: "edgebuilder_mesh",
      mesh: o.resource,
      meshAppearance: o.appearance ?? "default",
      visualScale: { X: o.transform.scale[0], Y: o.transform.scale[1], Z: o.transform.scale[2] },
    })) as GameRef;
    ({ id } = await world.spawn({ template: EmptyEntity, position, orientation, components: [component], tags: ["edgebuilder"] }));
  } else if (o.kind === "entity") {
    ({ id } = await world.spawn({ template: o.resource, position, orientation, appearance: o.appearance, tags: ["edgebuilder"] }));
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

/** The page moved, turned or scaled an object: keep it, and put the preview there. */
async function setTransform(id: string, t: SceneTransform): Promise<void> {
  const o = scene.get(id);
  if (!o) return;
  if (o.kind !== "mesh") t = { ...t, scale: [1, 1, 1] }; // an entity template keeps its own size
  const scaled = t.scale.some((s, i) => Math.abs(s - o.transform.scale[i]) > 1e-6);
  o.transform = t;
  scene.save();
  if (o.entityId) {
    if (scaled) {
      // A mesh component's scale is set when it is built, so a new scale means a new preview.
      await removePreview(o);
      await spawnPreview(o);
      scene.save();
      if (state.selected === o.id) await highlight(o, true);
    } else {
      await world.move(o.entityId, toPoint(t.position), toQuat(t.rotation));
    }
  }
  publish();
}

/** The collision groups a floor can be in. The first that answers is not always the nearest, so all are asked. */
const FloorGroups = ["Static", "Terrain", "PlayerBlocker"];

/** Puts an object's lowest point on whatever is below it. */
async function dropToFloor(id: string): Promise<void> {
  const o = scene.get(id);
  if (!o) return;
  if (state.world !== "ready") return say(worldBlocker(), "warn");
  const [x, y, z] = o.transform.position;
  const lowest = (o.bounds?.min[2] ?? 0) * o.transform.scale[2];
  // Start just above the object's base, so an entity's own colliders above it are not hit.
  const startZ = z + lowest + 0.05;
  const queries = await api.GameInstance.GetSpatialQueriesSystem(game.instance);
  if (!queries) return say("The game's spatial queries are not available right now.", "warn");
  let floor: number | undefined;
  const tried: string[] = [];
  for (const group of FloorGroups) {
    try {
      const r = (await queries.SyncRaycastByCollisionGroup({ X: x, Y: y, Z: startZ, W: 1 }, { X: x, Y: y, Z: startZ - 100, W: 1 }, group, null, false, false)) as {
        result: boolean;
        out: { result: { position: { X: number; Y: number; Z: number } } };
      };
      tried.push(`${group}: ${r.result ? r.out.result.position.Z.toFixed(2) : "miss"}`);
      if (r.result && (floor === undefined || r.out.result.position.Z > floor)) floor = r.out.result.position.Z;
    } catch (err) {
      tried.push(`${group}: ${(err as Error).message}`);
    }
  }
  console.log(`Drop to floor ${o.id} from z ${startZ.toFixed(2)}: ${tried.join("; ")}`);
  if (floor === undefined) return say("Nothing below to drop onto within 100 m.", "warn");
  await setTransform(id, { ...o.transform, position: [x, y, floor - lowest] });
  say(`Dropped ${o.id} to the floor, ${(z - (floor - lowest)).toFixed(2)} m down.`, "ok");
}

// ---- requests from the page -------------------------------------------------------------------

function runSearch(): void {
  state.results = index.entries.length ? index.search(state.query.text, state.query.kind, ResultLimit) : [];
  publish();
}

async function drop(assetPath: string, appearance?: string): Promise<void> {
  const kind = kindOf(assetPath);
  if (!kind) return say(`${assetPath} is not a mesh or an entity template.`, "warn");
  if (state.world !== "ready") await checkWorld();
  if (state.world !== "ready") return say(worldBlocker(), "warn");
  try {
    const at = await inFrontOfPlayer();
    const o = scene.add(kind, assetPath, { position: at.position, rotation: yawToQuaternion(at.yaw), scale: [1, 1, 1] }, appearance);
    if (bridge?.running) {
      try {
        const info = await index.lookAt(bridge, assetPath);
        if (info.bounds) o.bounds = info.bounds;
      } catch {
        // Bounds are a nicety for the bake; the drop goes ahead without them.
      }
    }
    const started = Date.now();
    await spawnPreview(o);
    scene.save();
    await select(o.id);
    say(`Dropped ${path.basename(assetPath)} in ${Date.now() - started} ms.`, "ok");
  } catch (err) {
    say(`Drop failed: ${(err as Error).message}`, "error");
  }
}

async function select(id: string | undefined): Promise<void> {
  if (state.selected && state.selected !== id) await highlight(scene.get(state.selected), false);
  state.selected = id;
  await highlight(scene.get(id), true);
  publish();
}

async function remove(id: string): Promise<void> {
  const o = scene.get(id);
  if (!o) return;
  await removePreview(o);
  scene.remove(id);
  if (state.selected === id) state.selected = undefined;
  say(`Removed ${o.id}.`, "ok");
}

async function rebuild(): Promise<void> {
  if (state.world !== "ready") await checkWorld();
  if (state.world !== "ready") return say(worldBlocker(), "warn");
  let n = 0;
  for (const o of scene.objects) {
    if (o.entityId || o.kind === "light") continue;
    try {
      await spawnPreview(o);
      n++;
    } catch (err) {
      console.log(`Rebuild ${o.id}: ${(err as Error).message}`);
    }
  }
  scene.save();
  say(`${n} preview${n === 1 ? "" : "s"} back in the world.`, "ok");
}

async function clear(): Promise<void> {
  for (const o of scene.objects) await removePreview(o);
  scene.clear();
  state.selected = undefined;
  say("Scene cleared.", "ok");
}

function saveSettings(next: Settings): void {
  settings = { ...settings, ...next };
  for (const k of Object.keys(settings) as (keyof Settings)[]) if (!settings[k]) delete settings[k];
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
        state.query = { text: m.text, kind: m.kind as AssetKind | "all" };
        runSearch();
        break;
      case "look":
        state.looked = { path: m.path };
        publish();
        if (bridge?.running) {
          try {
            state.looked = { path: m.path, info: await index.lookAt(bridge, m.path) };
          } catch (err) {
            state.looked = { path: m.path, info: { appearances: [], error: (err as Error).message } };
          }
          publish();
        }
        break;
      case "drop":
        await drop(m.path, m.appearance);
        break;
      case "select":
        await select(m.id);
        break;
      case "delete":
        await remove(m.id);
        break;
      case "rebuild":
        await rebuild();
        break;
      case "clear":
        await clear();
        break;
      case "index.build":
        await buildIndex();
        break;
      case "bridge.restart":
        await startBridge();
        break;
      case "transform":
        await setTransform(m.id, m.transform);
        break;
      case "floor":
        await dropToFloor(m.id);
        break;
      case "log":
        console.log(m.text);
        break;
      case "settings":
        saveSettings({ bridgePath: m.bridgePath, gameDir: m.gameDir });
        say("Settings saved; restarting REDbridge.", "info");
        await startBridge();
        break;
    }
  })().catch((err) => say(`${m.type}: ${(err as Error).message}`, "error"));
});

// ---- lifecycle --------------------------------------------------------------------------------

// The host links to the game, or loses it: the world may have become usable, or not.
let linked: boolean | undefined;
game.onState((s) => {
  if (s.connected === linked) return;
  linked = s.connected;
  if (!s.connected) {
    scene.forgetPreviews();
    state.selected = undefined;
  }
  void checkWorld();
});

game.on("PlayerPuppet.OnGameAttached", () => {
  // A save loaded: every preview entity of the old session is gone.
  scene.forgetPreviews();
  state.selected = undefined;
  void checkWorld().then(() => {
    if (scene.objects.length) say(`A save loaded. ${scene.objects.length} object${scene.objects.length === 1 ? "" : "s"} in the scene; press Rebuild previews to see them.`, "info");
  });
});

world.on("Entity/Detach", (e) => {
  const o = scene.objects.find((x) => x.entityId === e.entityId);
  if (o) {
    delete o.entityId;
    if (state.selected === o.id) state.selected = undefined;
    publish();
  }
});

console.log(`EDGEbuilder starting; data folder ${pkg.dataDir}; ${scene.objects.length} objects in the working scene`);
if (scene.loadError) {
  state.message = { text: `The scene file could not be read (${scene.loadError}). ${scene.setAside ? `It was kept as ${path.basename(scene.setAside)}; ` : ""}starting with an empty scene.`, tone: "warn" };
  console.log(state.message.text);
}
publish();
void checkWorld();
void startBridge();
