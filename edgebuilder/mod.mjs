// Built from src/ by build.mjs; edit the TypeScript, not this file.

// src/mod.ts
import * as fs4 from "node:fs";
import * as path4 from "node:path";
import { api, channel, game, pkg, world } from "rednode";

// src/bridge.ts
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
var BridgeError = class extends Error {
};
var BridgeClient = class {
  constructor(exe, gameDir2, dotnetRoot = defaultDotnetRoot()) {
    this.exe = exe;
    this.gameDir = gameDir2;
    this.dotnetRoot = dotnetRoot;
  }
  process;
  buffer = Buffer.alloc(0);
  nextId = 1;
  pending = /* @__PURE__ */ new Map();
  log = [];
  onExit;
  get running() {
    return this.process !== void 0 && this.process.exitCode === null && !this.process.killed;
  }
  start() {
    if (this.running) return;
    const env = { ...process.env };
    if (this.dotnetRoot) env.DOTNET_ROOT = this.dotnetRoot;
    const args = this.gameDir ? ["--game", this.gameDir] : [];
    const child = spawn(this.exe, args, { env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    this.process = child;
    child.stderr.on("data", (chunk) => {
      for (const line of chunk.toString("utf8").split(/\r?\n/)) {
        if (line.trim()) {
          this.log.push(line);
          if (this.log.length > 200) this.log.shift();
        }
      }
    });
    child.stdout.on("data", (chunk) => this.receive(chunk));
    child.on("exit", (code) => {
      for (const p of this.pending.values()) p.reject(new BridgeError(`REDbridge exited (${code ?? "signal"})`));
      this.pending.clear();
      this.onExit?.(code);
    });
    child.on("error", (err) => {
      for (const p of this.pending.values()) p.reject(err);
      this.pending.clear();
    });
  }
  stop() {
    if (this.process && this.process.exitCode === null) {
      this.process.stdin?.end();
      const p = this.process;
      setTimeout(() => {
        if (p.exitCode === null) p.kill();
      }, 2e3).unref();
    }
    this.process = void 0;
  }
  call(method, params) {
    if (!this.running) return Promise.reject(new BridgeError("REDbridge is not running"));
    const id = this.nextId++;
    const body = Buffer.from(JSON.stringify({ jsonrpc: "2.0", id, method, params: params ?? {} }), "utf8");
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.process.stdin.write(Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r
\r
`, "ascii"), body]));
    });
  }
  receive(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (; ; ) {
      const headerEnd = this.buffer.indexOf("\r\n\r\n");
      if (headerEnd < 0) return;
      const header = this.buffer.subarray(0, headerEnd).toString("ascii");
      const m = /content-length:\s*(\d+)/i.exec(header);
      if (!m) {
        this.buffer = this.buffer.subarray(headerEnd + 4);
        continue;
      }
      const length = Number(m[1]);
      const start = headerEnd + 4;
      if (this.buffer.length < start + length) return;
      const text = this.buffer.subarray(start, start + length).toString("utf8");
      this.buffer = this.buffer.subarray(start + length);
      let msg;
      try {
        msg = JSON.parse(text);
      } catch {
        continue;
      }
      if (typeof msg.id !== "number") continue;
      const p = this.pending.get(msg.id);
      if (!p) continue;
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new BridgeError(msg.error.message ?? "REDbridge error"));
      else p.resolve(msg.result);
    }
  }
  info() {
    return this.call("bridge.info");
  }
  list(prefix, offset, limit = 5e3) {
    return this.call("archive.list", { prefix, offset, limit });
  }
  meshInfoMany(paths) {
    return this.call("mesh.infoMany", { paths });
  }
};
function defaultDotnetRoot() {
  const root = path.join(process.env.LOCALAPPDATA ?? "", "Microsoft", "dotnet");
  try {
    const has10 = fs.readdirSync(path.join(root, "shared", "Microsoft.NETCore.App")).some((v) => v.startsWith("10."));
    return has10 ? root : void 0;
  } catch {
    return void 0;
  }
}
function compareTags(a, b) {
  const pa = a.replace(/^v/, "").split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.replace(/^v/, "").split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) if ((pb[i] ?? 0) !== (pa[i] ?? 0)) return (pb[i] ?? 0) - (pa[i] ?? 0);
  return 0;
}
function findBridge(setting) {
  if (setting && fs.existsSync(setting)) return setting;
  const appData = process.env.APPDATA ?? "";
  for (const code of ["Code", "Code - Insiders", "VSCodium"]) {
    const dir = path.join(appData, code, "User", "globalStorage", "edgemodders.reddeck", "bridge");
    try {
      const tags = fs.readdirSync(dir).filter((t) => fs.existsSync(path.join(dir, t, "REDbridge.exe")));
      tags.sort(compareTags);
      if (tags.length) return path.join(dir, tags[0], "REDbridge.exe");
    } catch {
    }
  }
  return void 0;
}
function isGameFolder(dir) {
  return !!dir && fs.existsSync(path.join(dir, "bin", "x64", "Cyberpunk2077.exe"));
}

// src/index.ts
import * as fs2 from "node:fs";
import * as path2 from "node:path";
var IndexPrefixes = ["base\\environment", "ep1\\environment", "base\\items", "ep1\\items", "base\\gameplay\\devices"];
var PageSize = 5e3;
var AssetIndex = class {
  constructor(dir) {
    this.dir = dir;
  }
  entries = [];
  info = {};
  game = "";
  file = "";
  /** Loads the index for this game, if one was built. */
  load(game2) {
    this.game = game2;
    this.file = path2.join(this.dir, `${game2}.json`);
    try {
      const data = JSON.parse(fs2.readFileSync(this.file, "utf8"));
      if (data.format !== 1 || !Array.isArray(data.entries)) return false;
      this.entries = data.entries;
      this.info = data.info ?? {};
      return true;
    } catch {
      return false;
    }
  }
  save() {
    fs2.mkdirSync(this.dir, { recursive: true });
    const data = { format: 1, game: this.game, built: (/* @__PURE__ */ new Date()).toISOString(), entries: this.entries, info: this.info };
    fs2.writeFileSync(this.file, JSON.stringify(data));
  }
  /** Reads the index from the game through the bridge. Pages of 5,000 files per folder prefix. */
  async build(bridge2, game2, progress) {
    this.game = game2;
    this.file = path2.join(this.dir, `${game2}.json`);
    const entries = [];
    for (const prefix of IndexPrefixes) {
      let offset = 0;
      let total = 0;
      do {
        const page = await bridge2.list(prefix, offset, PageSize);
        total = page.total;
        for (const f of page.items) {
          const kind = kindOf(f.name);
          if (kind) entries.push({ path: f.name, kind, size: f.size });
        }
        offset += page.items.length;
        progress?.(`${prefix}: ${Math.min(offset, total).toLocaleString()} of ${total.toLocaleString()} files, ${entries.length.toLocaleString()} assets so far`);
        if (page.items.length === 0) break;
      } while (offset < total);
    }
    entries.sort((a, b) => a.path.localeCompare(b.path));
    this.entries = entries;
    this.save();
  }
  /** Substring search over paths, file-name matches first. */
  search(text, kind, limit = 200) {
    const terms = text.toLowerCase().split(/\s+/).filter(Boolean);
    const out = [];
    for (const e of this.entries) {
      if (kind !== "all" && e.kind !== kind) continue;
      const lower = e.path.toLowerCase();
      const name = lower.slice(lower.lastIndexOf("\\") + 1);
      let score = 0;
      let ok = true;
      for (const t of terms) {
        if (name.includes(t)) score += 2;
        else if (lower.includes(t)) score += 1;
        else {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      out.push({ e, score });
      if (out.length > limit * 20) break;
    }
    out.sort((a, b) => b.score - a.score || a.e.path.length - b.e.path.length);
    return out.slice(0, limit).map((x) => x.e);
  }
  /** What the bridge knows about an asset, asked once and remembered. */
  async lookAt(bridge2, assetPath) {
    const known = this.info[assetPath];
    if (known && !known.error) return known;
    const [r] = await bridge2.meshInfoMany([assetPath]);
    const info = r?.error ? { appearances: [], error: r.error } : { bounds: r?.bounds ?? void 0, appearances: r?.appearances ?? [] };
    this.info[assetPath] = info;
    try {
      this.save();
    } catch {
    }
    return info;
  }
};
function kindOf(file) {
  const lower = file.toLowerCase();
  if (lower.endsWith(".mesh")) return "mesh";
  if (lower.endsWith(".ent")) return "entity";
  return void 0;
}

// src/scene.ts
import * as fs3 from "node:fs";
import * as path3 from "node:path";
var Scene = class {
  constructor(file) {
    this.file = file;
  }
  name = "Working scene";
  objects = [];
  counter = 0;
  load() {
    try {
      const data = JSON.parse(fs3.readFileSync(this.file, "utf8"));
      if (data.format !== 1 || !Array.isArray(data.objects)) return false;
      this.name = data.name || this.name;
      this.objects = data.objects.map((o) => ({ ...o }));
      this.counter = this.objects.length;
      return true;
    } catch {
      return false;
    }
  }
  save() {
    fs3.mkdirSync(path3.dirname(this.file), { recursive: true });
    const data = {
      format: 1,
      name: this.name,
      groups: [],
      objects: this.objects.map(({ entityId: _live, ...rest }) => rest)
    };
    fs3.writeFileSync(this.file, JSON.stringify(data, null, 2));
  }
  add(kind, resource, transform, appearance) {
    const base = resource ? path3.basename(resource).replace(/\.[^.]+$/, "").replace(/[^a-z0-9_-]+/gi, "_").toLowerCase() : kind;
    let id = base;
    while (this.objects.some((o2) => o2.id === id)) id = `${base}_${++this.counter}`;
    const o = { id, kind, resource, appearance, transform };
    this.objects.push(o);
    this.save();
    return o;
  }
  remove(id) {
    const i = this.objects.findIndex((o) => o.id === id);
    if (i < 0) return void 0;
    const [gone] = this.objects.splice(i, 1);
    this.save();
    return gone;
  }
  get(id) {
    return id ? this.objects.find((o) => o.id === id) : void 0;
  }
  /** Forgets every preview: after a save loads, the entities are gone. */
  forgetPreviews() {
    for (const o of this.objects) delete o.entityId;
  }
  clear() {
    this.objects = [];
    this.save();
  }
};
function yawToQuaternion(yawDegrees) {
  const half = yawDegrees * Math.PI / 360;
  return [0, 0, Math.sin(half), Math.cos(half)];
}

// src/mod.ts
var EmptyEntity = "base\\gameplay\\loot\\containers\\common_suitcases\\appearances\\suitcase_small_placeholder.ent";
var SpawnDistance = 3;
var ResultLimit = 120;
var settingsFile = path4.join(pkg.dataDir, "settings.json");
var settings = {};
try {
  settings = JSON.parse(fs4.readFileSync(settingsFile, "utf8"));
} catch {
}
var scene = new Scene(path4.join(pkg.dataDir, "scenes", "working.scene.json"));
scene.load();
var index = new AssetIndex(path4.join(pkg.dataDir, "index"));
var bridge;
var gameKey = "";
var state = {
  ready: true,
  world: "unknown",
  bridge: { status: "off" },
  index: { status: "none", count: 0 },
  results: [],
  query: { text: "", kind: "all" },
  scene: { name: scene.name, objects: scene.objects, file: scene.file },
  settings: { ...settings, settingsFile }
};
function publish() {
  state.scene = { name: scene.name, objects: scene.objects, file: scene.file };
  state.settings = { ...settings, settingsFile };
  channel.post({ type: "state", state });
}
function say(text, tone = "info") {
  state.message = { text, tone };
  console.log(text);
  publish();
}
function gameDir() {
  if (isGameFolder(settings.gameDir)) return settings.gameDir;
  let dir = pkg.dir;
  for (let i = 0; i < 6; i++) {
    dir = path4.dirname(dir);
    if (isGameFolder(dir)) return dir;
  }
  return void 0;
}
async function startBridge() {
  bridge?.stop();
  bridge = void 0;
  const exe = findBridge(settings.bridgePath);
  if (!exe) {
    state.bridge = { status: "missing", detail: `No REDbridge found. Install it with REDdeck (Get REDbridge), or put its path in ${settingsFile} as "bridgePath".` };
    state.index = { status: "none", count: 0 };
    publish();
    return;
  }
  const dir = gameDir();
  state.bridge = { status: "starting", path: exe, detail: dir ? void 0 : "The game folder was not found; set gameDir in the settings" };
  publish();
  const b = new BridgeClient(exe, dir);
  b.onExit = (code) => {
    if (bridge === b) {
      state.bridge = { status: "failed", path: exe, detail: `REDbridge exited (${code ?? "signal"}). ${b.log.slice(-3).join(" | ")}` };
      bridge = void 0;
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
    state.bridge = { status: "failed", path: exe, detail: `${err.message}. ${b.log.slice(-3).join(" | ")}` };
    publish();
  }
}
async function buildIndex() {
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
    state.index = { status: "failed", count: 0, progress: err.message };
    say(`The asset index failed: ${err.message}`, "error");
  }
}
async function checkWorld() {
  try {
    if (await world.available()) state.world = "ready";
    else state.world = (await game.state()).mainMenu ? "no-save" : "no-codeware";
  } catch {
    state.world = "unknown";
  }
  publish();
}
async function inFrontOfPlayer() {
  const player = await api.GetPlayer(game.instance);
  if (!player) throw new Error("No player: load a save first");
  const p = await player.GetWorldPosition();
  const f = await player.GetWorldForward();
  const yaw = Math.atan2(f.X, -f.Y) * 180 / Math.PI;
  return { position: [p.X + f.X * SpawnDistance, p.Y + f.Y * SpawnDistance, p.Z], yaw };
}
async function spawnPreview(o) {
  const [x, y, z] = o.transform.position;
  const [i, j, k, r] = o.transform.rotation;
  const position = { x, y, z };
  const orientation = { i, j, k, r };
  let id;
  if (o.kind === "mesh") {
    const component = await api.$new("entMeshComponent", {
      name: "edgebuilder_mesh",
      mesh: o.resource,
      meshAppearance: o.appearance ?? "default",
      visualScale: { X: o.transform.scale[0], Y: o.transform.scale[1], Z: o.transform.scale[2] }
    });
    ({ id } = await world.spawn({ template: EmptyEntity, position, orientation, components: [component], tags: ["edgebuilder"] }));
  } else if (o.kind === "entity") {
    ({ id } = await world.spawn({ template: o.resource, position, orientation, appearance: o.appearance, tags: ["edgebuilder"] }));
  } else {
    throw new Error(`Previews of ${o.kind} objects come in a later phase`);
  }
  o.entityId = id.hash;
}
async function removePreview(o) {
  if (!o.entityId) return;
  try {
    await world.remove(o.entityId);
  } catch (err) {
    console.log(`Remove ${o.id}: ${err.message}`);
  }
  delete o.entityId;
}
async function highlight(o, on) {
  if (!o?.entityId) return;
  try {
    const entity = await world.entity(o.entityId);
    if (!entity) return;
    const event = await api.$new("entRenderHighlightEvent", { seeThroughWalls: true, opacity: on ? 1 : 0, outlineIndex: on ? 1 : 0, fillIndex: 0 });
    await entity.QueueEvent(event);
  } catch (err) {
    console.log(`Highlight ${o.id} ${on ? "on" : "off"}: ${err.message}`);
  }
}
function runSearch() {
  state.results = index.entries.length ? index.search(state.query.text, state.query.kind, ResultLimit) : [];
  publish();
}
async function drop(assetPath, appearance) {
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
      }
    }
    const started = Date.now();
    await spawnPreview(o);
    scene.save();
    await select(o.id);
    say(`Dropped ${path4.basename(assetPath)} in ${Date.now() - started} ms.`, "ok");
  } catch (err) {
    say(`Drop failed: ${err.message}`, "error");
  }
}
async function select(id) {
  if (state.selected && state.selected !== id) await highlight(scene.get(state.selected), false);
  state.selected = id;
  await highlight(scene.get(id), true);
  publish();
}
async function remove(id) {
  const o = scene.get(id);
  if (!o) return;
  await removePreview(o);
  scene.remove(id);
  if (state.selected === id) state.selected = void 0;
  say(`Removed ${o.id}.`, "ok");
}
async function rebuild() {
  if (state.world !== "ready") await checkWorld();
  if (state.world !== "ready") return say("Load a save first.", "warn");
  let n = 0;
  for (const o of scene.objects) {
    if (o.entityId || o.kind === "light") continue;
    try {
      await spawnPreview(o);
      n++;
    } catch (err) {
      console.log(`Rebuild ${o.id}: ${err.message}`);
    }
  }
  scene.save();
  say(`${n} preview${n === 1 ? "" : "s"} back in the world.`, "ok");
}
async function clear() {
  for (const o of scene.objects) await removePreview(o);
  scene.clear();
  state.selected = void 0;
  say("Scene cleared.", "ok");
}
function saveSettings(next) {
  settings = { ...settings, ...next };
  for (const k of Object.keys(settings)) if (!settings[k]) delete settings[k];
  fs4.mkdirSync(pkg.dataDir, { recursive: true });
  fs4.writeFileSync(settingsFile, JSON.stringify(settings, null, 2));
}
channel.on((m) => {
  void (async () => {
    switch (m.type) {
      case "hello":
        publish();
        break;
      case "search":
        state.query = { text: m.text, kind: m.kind };
        runSearch();
        break;
      case "look":
        state.looked = { path: m.path };
        publish();
        if (bridge?.running) {
          try {
            state.looked = { path: m.path, info: await index.lookAt(bridge, m.path) };
          } catch (err) {
            state.looked = { path: m.path, info: { appearances: [], error: err.message } };
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
  })().catch((err) => say(`${m.type}: ${err.message}`, "error"));
});
game.on("PlayerPuppet.OnGameAttached", () => {
  scene.forgetPreviews();
  state.selected = void 0;
  void checkWorld().then(() => {
    if (scene.objects.length) say(`A save loaded. ${scene.objects.length} object${scene.objects.length === 1 ? "" : "s"} in the scene; press Rebuild previews to see them.`, "info");
  });
});
world.on("Entity/Detach", (e) => {
  const o = scene.objects.find((x) => x.entityId === e.entityId);
  if (o) {
    delete o.entityId;
    if (state.selected === o.id) state.selected = void 0;
    publish();
  }
});
console.log(`EDGEbuilder starting; data folder ${pkg.dataDir}; ${scene.objects.length} objects in the working scene`);
publish();
void checkWorld();
void startBridge();
