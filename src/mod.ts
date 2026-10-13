// EDGEbuilder's Node mod: the brain behind the editor page. It owns the scene, the asset index,
// the REDbridge process and the preview entities; the page only shows state and sends requests.
// Phase B1: browse the game's assets, drop one in front of V, select it, delete it.

import * as fs from "node:fs";
import * as path from "node:path";
import { api, channel, game, pkg, world, type GameRef } from "rednode";
import { BridgeClient, findBridge, isGameFolder } from "./bridge";
import { AssetIndex, kindOf } from "./index";
import { Scene, yawToQuaternion } from "./scene";
import type { AssetKind, PageMessage, SceneObject, Snapshot } from "./protocol";

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
let bridge: BridgeClient | undefined;
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
    state.bridge = { status: "ready", path: exe, version: info.version };
    gameKey = `${info.archives}-${info.files}`;
    console.log(`REDbridge ${info.version} ready, ${info.files} files in ${info.archives} archives`);
    publish();
    if (index.load(gameKey)) {
      state.index = { status: "ready", count: index.entries.length, file: index.file };
      publish();
    } else {
      await buildIndex();
    }
  } catch (err) {
    state.bridge = { status: "failed", path: exe, detail: `${(err as Error).message}. ${b.log.slice(-3).join(" | ")}` };
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

// ---- the world --------------------------------------------------------------------------------

async function checkWorld(): Promise<void> {
  try {
    if (await world.available()) state.world = "ready";
    else state.world = (await game.state()).mainMenu ? "no-save" : "no-codeware";
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

// ---- requests from the page -------------------------------------------------------------------

function runSearch(): void {
  state.results = index.entries.length ? index.search(state.query.text, state.query.kind, ResultLimit) : [];
  publish();
}

async function drop(assetPath: string, appearance?: string): Promise<void> {
  const kind = kindOf(assetPath);
  if (!kind) return say(`${assetPath} is not a mesh or an entity template.`, "warn");
  if (state.world !== "ready") await checkWorld();
  if (state.world !== "ready") return say(state.world === "no-save" ? "Load a save first." : "The world API is not available: REDnode needs Codeware 1.14 or later.", "warn");
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
  if (state.world !== "ready") return say("Load a save first.", "warn");
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
      case "settings":
        saveSettings({ bridgePath: m.bridgePath, gameDir: m.gameDir });
        say("Settings saved; restarting REDbridge.", "info");
        await startBridge();
        break;
    }
  })().catch((err) => say(`${m.type}: ${(err as Error).message}`, "error"));
});

// ---- lifecycle --------------------------------------------------------------------------------

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
publish();
void checkWorld();
void startBridge();
