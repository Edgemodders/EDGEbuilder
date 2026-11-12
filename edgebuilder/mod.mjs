// Built from src/ by build.mjs; edit the TypeScript, not this file.

// src/mod.ts
import * as fs8 from "node:fs";
import * as path8 from "node:path";
import { api, channel, game, kernel, pkg, service, ui, world as world2 } from "rednode";

// src/bridge.ts
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
var BridgeError = class extends Error {
};
var KernelBridge = class {
  constructor(handle) {
    this.handle = handle;
  }
  running = true;
  info() {
    return this.handle.call("bridge.info");
  }
  list(prefix, offset, limit = 5e3) {
    return this.handle.call("archive.list", { prefix, offset, limit });
  }
  meshInfoMany(paths, from) {
    return this.handle.call("mesh.infoMany", { paths, ...from });
  }
  openMod(archivePath) {
    return this.handle.call("archive.openMod", { path: archivePath });
  }
  sectorBuild(params) {
    return this.handle.call("sector.build", { ...params });
  }
  tweakRecords(query) {
    return this.handle.call("tweakdb.records", { ...query });
  }
  stop() {
  }
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
    return new Promise((resolve4, reject) => {
      this.pending.set(id, { resolve: resolve4, reject });
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
  meshInfoMany(paths, from) {
    return this.call("mesh.infoMany", { paths, ...from });
  }
  openMod(archivePath) {
    return this.call("archive.openMod", { path: archivePath });
  }
  sectorBuild(params) {
    return this.call("sector.build", { ...params });
  }
  tweakRecords(query) {
    return this.call("tweakdb.records", { ...query });
  }
};
function defaultDotnetRoot() {
  const root = path.join(process.env.LOCALAPPDATA ?? "", "Microsoft", "dotnet");
  try {
    const has10 = fs.readdirSync(path.join(root, "shared", "Microsoft.NETCore.App")).some((v2) => v2.startsWith("10."));
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
    const dir = path.join(appData, code, "User", "globalStorage", "edgemodders.edgedeck", "bridge");
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
  /** Mods' and the open project's assets (B2c), searched beside the game's. */
  extra = [];
  /** The game's people (B3c, npcs.ts), searched with the game's own files. */
  npcs = [];
  gamePaths;
  /** Loads the index for this game, if one was built. */
  load(game2) {
    this.game = game2;
    this.file = path2.join(this.dir, `${game2}.json`);
    try {
      const data = JSON.parse(fs2.readFileSync(this.file, "utf8"));
      if (data.format !== 1 || !Array.isArray(data.entries)) return false;
      this.entries = unique(data.entries);
      this.info = data.info ?? {};
      this.gamePaths = void 0;
      return true;
    } catch {
      return false;
    }
  }
  /** Loads the newest index on disk, for searching before REDbridge says which game this is. */
  loadNewest() {
    let newest;
    try {
      for (const f of fs2.readdirSync(this.dir)) {
        if (!f.endsWith(".json")) continue;
        const t = fs2.statSync(path2.join(this.dir, f)).mtimeMs;
        if (!newest || t > newest.t) newest = { game: f.slice(0, -5), t };
      }
    } catch {
      return false;
    }
    return newest ? this.load(newest.game) : false;
  }
  save() {
    fs2.mkdirSync(this.dir, { recursive: true });
    const data = { format: 1, game: this.game, built: (/* @__PURE__ */ new Date()).toISOString(), entries: this.entries, info: this.info };
    fs2.writeFileSync(this.file, JSON.stringify(data));
  }
  /** Reads the index from the game through the bridge. Pages of 5,000 files per folder prefix. */
  async build(bridge2, game2, progress2) {
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
        progress2?.(`${prefix}: ${Math.min(offset, total).toLocaleString()} of ${total.toLocaleString()} files, ${entries.length.toLocaleString()} assets so far`);
        if (page.items.length === 0) break;
      } while (offset < total);
    }
    entries.sort((a, b) => a.path.localeCompare(b.path));
    this.entries = unique(entries);
    this.gamePaths = void 0;
    this.save();
  }
  /** Whether a path is one of the indexed game files. */
  isGamePath(p) {
    this.gamePaths ??= new Set(this.entries.map((e) => e.path.toLowerCase()));
    return this.gamePaths.has(p.replace(/\//g, "\\").toLowerCase());
  }
  /**
   * Substring search over paths, file-name matches first. Mods' and the project's files come first
   * and also match by their mod's or project's name. With no text, `from` other than game lists them all.
   */
  search(text, kind, limit = 200, from = "all") {
    const terms = text.toLowerCase().split(/\s+/).filter(Boolean);
    const out = [];
    const pools = from === "game" ? [this.entries, this.npcs] : from === "all" ? [this.extra, this.entries, this.npcs] : [this.extra];
    for (const pool of pools) {
      for (const e of pool) {
        if (kind !== "all" && e.kind !== kind) continue;
        if (from === "mods" && e.source?.kind !== "mod") continue;
        if (from === "project" && e.source?.kind !== "project") continue;
        const score = this.score(e, terms);
        if (score < 0) continue;
        out.push({ e, score: score + (e.source ? 0.5 : 0) });
        if (out.length > limit * 20) break;
      }
    }
    out.sort((a, b) => b.score - a.score || a.e.path.length - b.e.path.length);
    return out.slice(0, limit).map((x) => x.e);
  }
  /**
   * How well an entry matches every term: 2 for the file name (a person's record or in-game name), 1 for
   * the path or the source's name; -1 when a term misses.
   */
  score(e, terms) {
    const lower = e.kind === "npc" ? e.path.toLowerCase().replace(/^character\./, "") : e.path.toLowerCase();
    const name = e.kind === "npc" ? `${lower} ${(e.name ?? "").toLowerCase()}` : lower.slice(lower.lastIndexOf("\\") + 1);
    const source = e.source?.name.toLowerCase() ?? "";
    let score = 0;
    for (const t of terms) {
      if (name.includes(t)) score += 2;
      else if (lower.includes(t) || source.includes(t)) score += 1;
      else return -1;
    }
    return score;
  }
  /** What the bridge knows about an asset, asked once and remembered. */
  async lookAt(bridge2, assetPath) {
    const known = this.info[assetPath];
    if (known && !known.error && known.hasCollision !== void 0) return known;
    const [r] = await bridge2.meshInfoMany([assetPath]);
    const info = r?.error ? { appearances: [], error: r.error } : { bounds: r?.bounds ?? void 0, appearances: r?.appearances ?? [], hasCollision: r?.hasCollision ?? null };
    this.info[assetPath] = info;
    try {
      this.save();
    } catch {
    }
    return info;
  }
};
function unique(entries) {
  const seen2 = /* @__PURE__ */ new Set();
  return entries.filter((e) => {
    const key = e.path.toLowerCase();
    if (seen2.has(key)) return false;
    seen2.add(key);
    return true;
  });
}
function kindOf(file) {
  const lower = file.toLowerCase();
  if (lower.endsWith(".mesh")) return "mesh";
  if (lower.endsWith(".ent")) return "entity";
  return void 0;
}

// src/npcs.ts
import * as fs3 from "node:fs";
import * as path3 from "node:path";
var PersonBounds = { min: [-0.3, -0.3, 0], max: [0.3, 0.3, 1.8] };
var Flats = ["fullDisplayName", "displayName", "entityTemplatePath", "appearanceName"];
var PageSize2 = 2e3;
function isRecord(assetPath) {
  return /^Character\./i.test(assetPath);
}
function textOf(v2) {
  if (typeof v2 === "string") return v2;
  if (v2 && typeof v2 === "object" && "text" in v2) return String(v2.text ?? "");
  return "";
}
function npcEntry(item) {
  const record = item.path;
  if (!record || !isRecord(record) || record.includes("_inline")) return void 0;
  const f = item.flats ?? {};
  const template = typeof f.entityTemplatePath === "string" ? f.entityTemplatePath : "";
  if (!template) return void 0;
  const name = textOf(f.fullDisplayName) || textOf(f.displayName);
  const look = typeof f.appearanceName === "string" && f.appearanceName !== "None" ? f.appearanceName : "";
  return { path: record, kind: "npc", size: 0, template, ...name && !/^LocKey#/i.test(name) ? { name } : {}, ...look ? { appearance: look } : {} };
}
var NpcList = class {
  /** `dir` is the asset index's folder; the list lives in its `npcs` folder, so the index never reads it. */
  constructor(dir) {
    this.dir = dir;
  }
  entries = [];
  game = "";
  byRecord;
  fileFor(game2) {
    return path3.join(this.dir, "npcs", `${game2}.json`);
  }
  /** Loads the list for this game, if one was read. */
  load(game2) {
    try {
      const data = JSON.parse(fs3.readFileSync(this.fileFor(game2), "utf8"));
      if (data.format !== 1 || !Array.isArray(data.entries)) return false;
      this.take(game2, data.entries);
      return true;
    } catch {
      return false;
    }
  }
  /** Reads every `Character` record from the game's TweakDB, in pages. The first TweakDB call takes about 12 s. */
  async build(bridge2, game2, progress2) {
    const entries = [];
    let offset = 0;
    let total = 0;
    do {
      const page = await bridge2.tweakRecords({ type: "Character", flats: Flats, offset, limit: PageSize2, resolveLocKeys: true });
      total = page.total;
      for (const item of page.items) {
        const e = npcEntry(item);
        if (e) entries.push(e);
      }
      offset += page.items.length;
      progress2?.(`Character records: ${Math.min(offset, total).toLocaleString()} of ${total.toLocaleString()}, ${entries.length.toLocaleString()} people so far`);
      if (!page.items.length) break;
    } while (offset < total);
    entries.sort((a, b) => a.path.localeCompare(b.path));
    this.take(game2, entries);
    fs3.mkdirSync(path3.dirname(this.fileFor(game2)), { recursive: true });
    const data = { format: 1, game: game2, built: (/* @__PURE__ */ new Date()).toISOString(), entries };
    fs3.writeFileSync(this.fileFor(game2), JSON.stringify(data));
  }
  /** The row for a record, any case. */
  find(record) {
    if (!record) return void 0;
    this.byRecord ??= new Map(this.entries.map((e) => [e.path.toLowerCase(), e]));
    return this.byRecord.get(record.toLowerCase());
  }
  take(game2, entries) {
    this.game = game2;
    this.entries = entries;
    this.byRecord = void 0;
  }
};

// src/sources.ts
import * as fs4 from "node:fs";
import * as path4 from "node:path";
var NeedsNewerBridge = "Its size and appearances need REDbridge 0.12.0 or later (EDGEdeck: Get REDbridge); it can still be dropped, with a 1 m box for the gizmo.";
function modArchives(gameDir2) {
  const out = [];
  const loose = path4.join(gameDir2, "archive", "pc", "mod");
  for (const f of list(loose)) if (f.toLowerCase().endsWith(".archive")) out.push({ file: path4.join(loose, f), mod: f.slice(0, -".archive".length) });
  const redmods = path4.join(gameDir2, "mods");
  for (const m of list(redmods)) {
    const dir = path4.join(redmods, m, "archives");
    for (const f of list(dir)) if (f.toLowerCase().endsWith(".archive")) out.push({ file: path4.join(dir, f), mod: m });
  }
  return out;
}
function modFolders(gameDir2) {
  return [path4.join(gameDir2, "archive", "pc", "mod"), path4.join(gameDir2, "mods")];
}
function list(dir) {
  try {
    return fs4.readdirSync(dir);
  } catch {
    return [];
  }
}
var ModSources = class {
  constructor(cacheFile) {
    this.cacheFile = cacheFile;
    try {
      const data = JSON.parse(fs4.readFileSync(cacheFile, "utf8"));
      if (data.format === 1 && data.archives) this.archives = data.archives;
    } catch {
    }
  }
  /** By archive path. */
  archives = {};
  /** The open project's loose files. */
  project = [];
  /** The project's source\archive, where its loose files are read from. */
  projectRoot;
  /** What mesh.info said about the project's files, by file and its time: they change while the modder works. */
  projectInfo = /* @__PURE__ */ new Map();
  get archiveCount() {
    return Object.keys(this.archives).length;
  }
  /** Every mod entry, then the project's. */
  entries() {
    const out = [];
    for (const a of Object.values(this.archives)) out.push(...a.entries);
    out.push(...this.project);
    return out;
  }
  get modAssets() {
    let n = 0;
    for (const a of Object.values(this.archives)) n += a.entries.length;
    return n;
  }
  /**
   * Reads the mod archives that are new or changed since last time and forgets the ones gone.
   * `isGamePath` says whether a path is one of the game's own files (a mod's file then replaces it).
   * Returns whether anything changed. One unreadable archive is skipped and named in `failed`.
   */
  async refreshMods(bridge2, files, isGamePath, progress2) {
    let changed = false;
    const failed = [];
    const seen2 = /* @__PURE__ */ new Set();
    for (const { file, mod } of files) {
      seen2.add(file);
      let stat;
      try {
        stat = fs4.statSync(file);
      } catch {
        continue;
      }
      const known = this.archives[file];
      if (known && known.size === stat.size && known.mtime === stat.mtimeMs && known.mod === mod) continue;
      progress2?.(`Reading ${path4.basename(file)}`);
      try {
        const archive = await bridge2.openMod(file);
        const entries = [];
        for (const item of archive.items) {
          const kind = kindOf(item.name);
          if (!kind) continue;
          const entry = { path: item.name, kind, size: item.size, source: { kind: "mod", name: mod, file } };
          if (isGamePath(item.name)) entry.replaces = true;
          entries.push(entry);
        }
        entries.sort((a, b) => a.path.localeCompare(b.path));
        this.archives[file] = { mod, size: stat.size, mtime: stat.mtimeMs, entries };
        changed = true;
      } catch (err) {
        failed.push(`${path4.basename(file)}: ${err.message}`);
      }
    }
    for (const file of Object.keys(this.archives)) {
      if (!seen2.has(file)) {
        delete this.archives[file];
        changed = true;
      }
    }
    if (changed) this.save();
    return { changed, failed };
  }
  /** Reads the meshes and entities among the project's loose files, as the game paths they will have once packed. */
  scanProject(project2, isGamePath) {
    this.project = [];
    if (project2?.archive !== this.projectRoot) this.projectInfo.clear();
    this.projectRoot = project2?.archive;
    if (!project2) return;
    const walk = (dir, rel) => {
      let names;
      try {
        names = fs4.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const d of names) {
        const full = path4.join(dir, d.name);
        const gamePath = rel ? `${rel}\\${d.name}` : d.name;
        if (d.isDirectory()) walk(full, gamePath);
        else {
          const kind = kindOf(d.name);
          if (!kind) continue;
          let size = 0;
          try {
            size = fs4.statSync(full).size;
          } catch {
          }
          const entry = { path: gamePath, kind, size, source: { kind: "project", name: project2.name, file: full } };
          if (isGamePath(gamePath)) entry.replaces = true;
          this.project.push(entry);
        }
      }
    };
    walk(project2.archive, "");
    this.project.sort((a, b) => a.path.localeCompare(b.path));
  }
  /**
   * The size and appearances of a mod's or the project's file, through REDbridge's mesh.info with
   * the archive or the project folder (REDbridge 0.12.0 and later), asked once per version of the file.
   * An older REDbridge answers with NeedsNewerBridge as the error.
   */
  async lookAt(bridge2, entry) {
    const from = entry.source;
    if (!from) throw new Error(`${entry.path} is a game file`);
    let cache;
    let key = entry.path;
    if (from.kind === "mod") {
      const archive = this.archives[from.file];
      if (!archive) return { appearances: [], error: `${from.name} is no longer installed` };
      cache = archive.info ??= {};
      const known = cache[key];
      if (known && !known.error && known.hasCollision !== void 0) return known;
    } else {
      let mtime = 0;
      try {
        mtime = fs4.statSync(from.file).mtimeMs;
      } catch {
        return { appearances: [], error: `${entry.path} is no longer in the project` };
      }
      key = `${from.file}|${mtime}`;
      cache = this.projectInfo;
      const known = cache.get(key);
      if (known && !known.error && known.hasCollision !== void 0) return known;
    }
    let info;
    try {
      const [r] = await bridge2.meshInfoMany([entry.path], from.kind === "mod" ? { archive: from.file } : { root: this.projectRoot });
      if (r?.error && /not in the loaded archives/i.test(r.error)) info = { appearances: [], error: NeedsNewerBridge };
      else info = r?.error ? { appearances: [], error: r.error } : { bounds: r?.bounds ?? void 0, appearances: r?.appearances ?? [], hasCollision: r?.hasCollision ?? null };
    } catch (err) {
      const why = err.message;
      info = { appearances: [], error: /param|argument|signature|method/i.test(why) ? NeedsNewerBridge : why };
    }
    if (cache instanceof Map) cache.set(key, info);
    else {
      cache[key] = info;
      if (!info.error) this.save();
    }
    return info;
  }
  save() {
    try {
      fs4.mkdirSync(path4.dirname(this.cacheFile), { recursive: true });
      const data = { format: 1, archives: this.archives };
      fs4.writeFileSync(this.cacheFile, JSON.stringify(data));
    } catch {
    }
  }
};
function sceneNeeds(resources, sources2) {
  const byPath = /* @__PURE__ */ new Map();
  for (const e of sources2) if (!e.replaces) byPath.set(e.path.toLowerCase(), e);
  const needs = /* @__PURE__ */ new Set();
  for (const r of resources) {
    if (!r) continue;
    const e = byPath.get(r.replace(/\//g, "\\").toLowerCase());
    if (e?.source) needs.add(e.source.kind === "project" ? `${e.source.name} (REDcode project)` : e.source.name);
  }
  return [...needs].sort((a, b) => a.localeCompare(b));
}

// src/math.ts
var add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
var sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
var mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
var cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
var len = (a) => Math.hypot(a[0], a[1], a[2]);
var norm = (a) => {
  const l = len(a);
  return l > 1e-9 ? mul(a, 1 / l) : [0, 0, 0];
};
function qMul(a, b) {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [aw * bx + ax * bw + ay * bz - az * by, aw * by - ax * bz + ay * bw + az * bx, aw * bz + ax * by - ay * bx + az * bw, aw * bw - ax * bx - ay * by - az * bz];
}
function qNorm(q) {
  const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
}
function qAxisAngle(axis, degrees) {
  const n = norm(axis);
  const h = degrees * Math.PI / 360;
  const s = Math.sin(h);
  return [n[0] * s, n[1] * s, n[2] * s, Math.cos(h)];
}
function qRotate(q, v2) {
  const u = [q[0], q[1], q[2]];
  const t = mul(cross(u, v2), 2);
  return add(add(v2, mul(t, q[3])), cross(u, t));
}
var v = (r) => [r.X, r.Y, r.Z];
function basisFromMatrix(m) {
  return { pos: v(m.W), right: norm(v(m.X)), fwd: norm(v(m.Y)), up: norm(v(m.Z)) };
}
function qLook(l) {
  return qNorm(qMul(qAxisAngle([0, 0, 1], l.yaw), qAxisAngle([1, 0, 0], l.pitch)));
}
function lookOf(fwd) {
  const f = norm(fwd);
  return { yaw: Math.atan2(-f[0], f[1]) * 180 / Math.PI, pitch: Math.asin(Math.max(-1, Math.min(1, f[2]))) * 180 / Math.PI };
}

// src/arrange.ts
function groupChain(id, groups) {
  const chain = [];
  const seen2 = /* @__PURE__ */ new Set();
  for (let g = groups.find((x) => x.id === id); g && !seen2.has(g.id); g = groups.find((x) => x.id === g.parent)) {
    seen2.add(g.id);
    chain.push(g.id);
  }
  return chain;
}
function membersOf(groupId, objects, groups) {
  return objects.filter((o) => groupChain(o.group, groups).includes(groupId));
}
function selectionUnits(selected, objects, groups) {
  const sel = new Set(selected);
  const whole = (g) => membersOf(g, objects, groups).every((o) => sel.has(o.id));
  const unitGroups = /* @__PURE__ */ new Set();
  const unitObjects = [];
  for (const o of objects) {
    if (!sel.has(o.id)) continue;
    const chain = groupChain(o.group, groups);
    let unit;
    for (const g of chain) {
      if (whole(g)) unit = g;
      else break;
    }
    if (unit) unitGroups.add(unit);
    else unitObjects.push(o.id);
  }
  return { groups: [...unitGroups], objects: unitObjects };
}
function freshId(base, taken) {
  if (!taken.has(base)) return base;
  const stem = base.replace(/_\d+$/, "");
  for (let n = 2; ; n++) if (!taken.has(`${stem}_${n}`)) return `${stem}_${n}`;
}
function nextGroupName(groups) {
  const names = new Set(groups.map((g) => g.name));
  for (let n = 1; ; n++) if (!names.has(`Group ${n}`)) return `Group ${n}`;
}
function makeGroup(selected, objects, groups, name = nextGroupName(groups)) {
  const units = selectionUnits(selected, objects, groups);
  if (units.groups.length + units.objects.length < 1) return void 0;
  const parents = /* @__PURE__ */ new Set([
    ...units.groups.map((g) => groups.find((x) => x.id === g).parent),
    ...units.objects.map((id2) => objects.find((o) => o.id === id2).group ?? null)
  ]);
  const id = freshId("grp_1", new Set(groups.map((g) => g.id)));
  groups.push({ id, name, parent: parents.size === 1 ? [...parents][0] : null });
  for (const g of units.groups) groups.find((x) => x.id === g).parent = id;
  for (const oid of units.objects) objects.find((o) => o.id === oid).group = id;
  return id;
}
function ungroup(selected, objects, groups) {
  const units = selectionUnits(selected, objects, groups);
  for (const gid of units.groups) {
    const g = groups.find((x) => x.id === gid);
    for (const o of objects) if (o.group === gid) o.group = g.parent ?? void 0;
    for (const inner of groups) if (inner.parent === gid) inner.parent = g.parent;
    groups.splice(groups.indexOf(g), 1);
  }
  for (const oid of units.objects) {
    const o = objects.find((x) => x.id === oid);
    if (o.group) o.group = groups.find((x) => x.id === o.group)?.parent ?? void 0;
  }
  for (const o of objects) if (!o.group) delete o.group;
  return units.groups.length;
}
function pruneGroups(objects, groups) {
  for (let changed = true; changed; ) {
    changed = false;
    for (const g of [...groups]) {
      const used = objects.some((o) => o.group === g.id) || groups.some((x) => x.parent === g.id);
      if (!used) {
        groups.splice(groups.indexOf(g), 1);
        changed = true;
      }
    }
  }
}
function duplicate(selected, objects, groups, offset = [0, 0, 0]) {
  const units = selectionUnits(selected, objects, groups);
  const takenObjects = new Set(objects.map((o) => o.id));
  const takenGroups = new Set(groups.map((g) => g.id));
  const newGroups = [];
  const groupMap = /* @__PURE__ */ new Map();
  const copyGroup = (gid, parent) => {
    const g = groups.find((x) => x.id === gid);
    const id = freshId(g.id, takenGroups);
    takenGroups.add(id);
    groupMap.set(gid, id);
    newGroups.push({ id, name: g.name, parent });
    for (const inner of groups) if (inner.parent === gid) copyGroup(inner.id, id);
  };
  for (const gid of units.groups) copyGroup(gid, groups.find((x) => x.id === gid).parent);
  const copies = [];
  const sel = new Set(selected);
  for (const o of objects) {
    if (!sel.has(o.id)) continue;
    const id = freshId(o.id, takenObjects);
    takenObjects.add(id);
    const { entityId: _live, ...rest } = o;
    const copy2 = JSON.parse(JSON.stringify(rest));
    copy2.id = id;
    copy2.transform.position = add(o.transform.position, offset);
    const group2 = o.group && groupMap.get(o.group);
    if (group2) copy2.group = group2;
    copies.push(copy2);
  }
  return { objects: copies, groups: newGroups };
}
function copyOf(selected, objects, groups) {
  const c = duplicate(selected, objects, groups);
  const copied = new Set(c.groups.map((g) => g.id));
  for (const g of c.groups) if (g.parent && !copied.has(g.parent)) g.parent = null;
  for (const o of c.objects) if (o.group && !copied.has(o.group)) delete o.group;
  return c;
}
function pasteOf(clip, objects, groups, offset) {
  const takenObjects = new Set(objects.map((o) => o.id));
  const takenGroups = new Set(groups.map((g) => g.id));
  const groupMap = /* @__PURE__ */ new Map();
  const newGroups = clip.groups.map((g) => {
    const id = freshId(g.id, takenGroups);
    takenGroups.add(id);
    groupMap.set(g.id, id);
    return { ...g, id };
  });
  for (const g of newGroups) g.parent = g.parent ? groupMap.get(g.parent) ?? null : null;
  const newObjects = clip.objects.map((o) => {
    const id = freshId(o.id, takenObjects);
    takenObjects.add(id);
    const copy2 = JSON.parse(JSON.stringify(o));
    copy2.id = id;
    copy2.transform.position = add(o.transform.position, offset);
    const group2 = o.group && groupMap.get(o.group);
    if (group2) copy2.group = group2;
    else delete copy2.group;
    return copy2;
  });
  return { objects: newObjects, groups: newGroups };
}
function standPoint(objects) {
  const b = boxOf(objects);
  if (!b) return centreOf(objects.map((o) => o.transform));
  return [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, b.min[2]];
}
function centreOf(ts) {
  if (!ts.length) return [0, 0, 0];
  let c = [0, 0, 0];
  for (const t of ts) c = add(c, t.position);
  return mul(c, 1 / ts.length);
}
function upright(q) {
  const [x, y, z, w] = q;
  const fx = 2 * (x * y - w * z);
  const fy = 1 - 2 * (x * x + z * z);
  const half = Math.atan2(-fx, fy) / 2;
  return [0, 0, Math.sin(half), Math.cos(half)];
}
function boxOf(objects) {
  let min;
  let max;
  for (const o of objects) {
    const b = o.bounds ?? { min: [-0.5, -0.5, 0], max: [0.5, 0.5, 1] };
    const t = o.transform;
    for (let i = 0; i < 8; i++) {
      const local = [(i & 1 ? b.max[0] : b.min[0]) * t.scale[0], (i & 2 ? b.max[1] : b.min[1]) * t.scale[1], (i & 4 ? b.max[2] : b.min[2]) * t.scale[2]];
      const p = add(t.position, qRotate(t.rotation, local));
      min = min ? [Math.min(min[0], p[0]), Math.min(min[1], p[1]), Math.min(min[2], p[2])] : p;
      max = max ? [Math.max(max[0], p[0]), Math.max(max[1], p[1]), Math.max(max[2], p[2])] : p;
    }
  }
  return min && max ? { min, max } : void 0;
}
function collisionKey(resource) {
  return (resource ?? "").replace(/\//g, "\\").toLowerCase();
}
var SeenFromRange = [5, 2e3];
function streamingFor(metres) {
  if (metres === null) return void 0;
  const m = Math.round(Math.min(SeenFromRange[1], Math.max(SeenFromRange[0], metres)));
  return { primary: m, secondary: m };
}

// src/bake.ts
import { createHash } from "node:crypto";
import * as fs6 from "node:fs";
import * as path6 from "node:path";

// src/scenes.ts
import { execFileSync } from "node:child_process";
import * as fs5 from "node:fs";
import * as os from "node:os";
import * as path5 from "node:path";
var SceneEnding = ".scene.json";
function libraryConfigFile() {
  return path5.join(process.env.APPDATA ?? path5.join(os.homedir(), "AppData", "Roaming"), "EDGE", "library.json");
}
function readLibraryRoot(file = libraryConfigFile()) {
  try {
    const root = JSON.parse(fs5.readFileSync(file, "utf8")).root;
    return typeof root === "string" && root.trim() ? root.trim() : void 0;
  } catch {
    return void 0;
  }
}
function writeLibraryRoot(root, file = libraryConfigFile()) {
  root = path5.resolve(root);
  fs5.mkdirSync(root, { recursive: true });
  let data = {};
  try {
    data = JSON.parse(fs5.readFileSync(file, "utf8"));
  } catch {
  }
  fs5.mkdirSync(path5.dirname(file), { recursive: true });
  fs5.writeFileSync(file, JSON.stringify({ ...data, root }, null, 2));
}
function documentsFolder() {
  const fallback = path5.join(os.homedir(), "Documents");
  if (process.platform !== "win32") return fallback;
  try {
    const out = execFileSync("reg", ["query", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders", "/v", "Personal"], { encoding: "utf8", windowsHide: true, timeout: 5e3 });
    const m = /Personal\s+REG_(?:EXPAND_)?SZ\s+(.+)/.exec(out);
    if (!m) return fallback;
    return m[1].trim().replace(/%([^%]+)%/g, (all, name) => process.env[name] ?? all);
  } catch {
    return fallback;
  }
}
function suggestedLibraryRoot() {
  return path5.join(documentsFolder(), "EDGE Library");
}
function slugOf(name) {
  return name.trim().toLowerCase().replace(/[^a-z0-9]/g, "_").replace(/^_+|_+$/g, "") || "scene";
}
function refOf(sceneName, o) {
  return o.ref ?? `edgebuilder/${slugOf(sceneName)}/${o.id}`;
}
function fileNameOf(name) {
  return slugOf(name) + SceneEnding;
}
function folderIn(root, folder) {
  const full = path5.resolve(root, folder ?? "");
  const rel = path5.relative(path5.resolve(root), full);
  if (rel.startsWith("..") || path5.isAbsolute(rel)) throw new Error(`${folder} is outside ${root}`);
  return full;
}
function cleanFolderName(name) {
  const clean = name.replace(/[<>:"/\\|?*\x00-\x1f]+/g, " ").replace(/\s+/g, " ").trim().replace(/[. ]+$/, "");
  if (!clean || clean === "." || clean === "..") throw new Error("Give the folder a name");
  return clean;
}
function whereIs(file, roots) {
  for (const r of roots) {
    const rel = path5.relative(path5.resolve(r.dir), path5.resolve(file));
    if (!rel.startsWith("..") && !path5.isAbsolute(rel)) return { place: r.place, folder: path5.dirname(rel).replace(/\\/g, "/").replace(/^\.$/, "") };
  }
  return void 0;
}
var MaxDepth = 8;
var MaxScenes = 2e3;
var seen = /* @__PURE__ */ new Map();
function describe(file, st) {
  const known = seen.get(file);
  if (known && known.size === st.size && known.mtime === st.mtimeMs) return known;
  let out;
  const fallback = path5.basename(file).slice(0, -SceneEnding.length);
  try {
    const data = JSON.parse(fs5.readFileSync(file, "utf8"));
    if (typeof data.format !== "number" || !Array.isArray(data.objects)) throw new Error("not an EDGEbuilder scene");
    out = { name: typeof data.name === "string" && data.name.trim() ? data.name : fallback, objects: data.objects.length };
  } catch (err) {
    out = { name: fallback, objects: 0, error: err.message };
  }
  seen.set(file, { size: st.size, mtime: st.mtimeMs, ...out });
  return out;
}
function scanShelf(root) {
  const shelf = { ...root, folders: [], scenes: [] };
  const walk = (dir, rel, depth) => {
    let names;
    try {
      names = fs5.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    names.sort((a, b) => a.name.localeCompare(b.name, void 0, { sensitivity: "base" }));
    for (const d of names) {
      if (shelf.scenes.length >= MaxScenes) return;
      const full = path5.join(dir, d.name);
      const sub2 = rel ? `${rel}/${d.name}` : d.name;
      if (d.isDirectory()) {
        if (d.name.startsWith(".") || d.name.toLowerCase().endsWith(".bake") || d.name === "node_modules" || depth >= MaxDepth) continue;
        shelf.folders.push(sub2);
        walk(full, sub2, depth + 1);
      } else if (d.isFile() && d.name.toLowerCase().endsWith(SceneEnding)) {
        let st;
        try {
          st = fs5.statSync(full);
        } catch {
          continue;
        }
        shelf.scenes.push({ place: root.place, file: full, folder: rel, changed: st.mtimeMs, ...describe(full, st) });
      }
    }
  };
  walk(root.dir, "", 0);
  return shelf;
}

// src/bake.ts
var Bakeable = /* @__PURE__ */ new Set(["mesh", "entity", "light"]);
function bakeInput(name, game2, groups, objects) {
  const kept = objects.filter((o) => Bakeable.has(o.kind));
  return {
    scene: {
      format: 1,
      name,
      ...game2 ? { game: game2 } : {},
      groups,
      objects: kept.map(({ entityId: _entityId, ...o }) => o)
    },
    skipped: objects.filter((o) => !Bakeable.has(o.kind)).map((o) => ({ id: o.id, kind: o.kind }))
  };
}
function solidForBake(objects, noCollision) {
  return objects.map((o) => {
    if (!o.solid || !noCollision.has(collisionKey(o.resource))) return o;
    const { solid: _solid, ...rest } = o;
    return rest;
  });
}
function atLeast(version, min) {
  if (!version) return true;
  const v2 = version.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < min.length; i++) if ((v2[i] ?? 0) !== min[i]) return (v2[i] ?? 0) > min[i];
  return true;
}
function bakeHash(objects) {
  const parts = objects.filter((o) => Bakeable.has(o.kind)).map((o) => [o.id, o.kind, o.resource ?? "", o.appearance ?? "", o.transform, o.streaming ?? null, o.ref ?? "", o.props ?? null, ...o.kind === "mesh" && o.solid ? ["solid"] : []]);
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 16);
}
function checkBake(input) {
  const out = [];
  const say2 = (tone, text) => out.push({ tone, text });
  if (!input.file) {
    say2("error", "No scene is open: open one or make one on the Library tab.");
    return out;
  }
  const { skipped, scene: scene2 } = bakeInput(input.name, void 0, [], input.objects);
  if (!scene2.objects.length) say2("error", "The scene has nothing to bake yet.");
  if (!input.project) say2("error", "No REDcode project is open. A bake goes into a project: open or make one in REDcode (VS Code), and this tab picks it up.");
  if (!input.bridgeReady) say2("error", "REDbridge is not ready, and it writes the bake. The pills at the top say why.");
  const ids = /* @__PURE__ */ new Set();
  for (const o of scene2.objects) {
    if (o.kind !== "light" && !o.resource) say2("error", `${o.id} has no resource.`);
    if (ids.has(o.id)) say2("error", `Two objects are called ${o.id}.`);
    ids.add(o.id);
    const numbers = [...o.transform.position, ...o.transform.rotation, ...o.transform.scale];
    if (numbers.some((n) => !Number.isFinite(n))) say2("error", `${o.id} has a position, turn or scale that is not a number.`);
  }
  const people = skipped.filter((s) => s.kind === "npc");
  const others = skipped.filter((s) => s.kind !== "npc");
  if (people.length) say2("warn", `${people.length === 1 ? "An NPC is" : `${people.length} NPCs are`} not baked: ${people.length === 1 ? "it shows" : "they show"} only while EDGEbuilder or another package loads the scene. ${people.map((s) => s.id).join(", ")}.`);
  if (others.length) say2("warn", `Left out, since a bake cannot make them yet: ${others.map((s) => s.id).join(", ")}.`);
  if (input.sameNameFrom) say2("warn", `This project has a bake with this name, from ${input.sameNameFrom}. Baking replaces it. A different name keeps both.`);
  if (input.needs.length) say2("warn", `Anyone playing this bake needs: ${input.needs.join(", ")}.`);
  const meshes = scene2.objects.filter((o) => o.kind === "mesh");
  const noData = meshes.filter((o) => o.solid && input.noCollision?.has(collisionKey(o.resource)));
  const solid = meshes.filter((o) => o.solid && !noData.includes(o));
  const plain = meshes.length - solid.length - noData.length;
  if (noData.length) {
    const names = [...new Set(noData.map((o) => path6.win32.basename(o.resource ?? o.id)))];
    say2("warn", `${noData.length === 1 ? "A mesh has" : `${noData.length} meshes have`} no collision data, so V walks through ${noData.length === 1 ? "it" : "them"}: ${names.slice(0, 5).join(", ")}${names.length > 5 ? ` and ${names.length - 5} more` : ""}. An entity with a collider can stand in.`);
  }
  if (solid.length && !atLeast(input.bridgeVersion, [0, 12, 0])) say2("warn", `REDbridge ${input.bridgeVersion} writes no solid meshes: V walks through all of them. Update it to 0.12.0 or later (EDGEdeck: Get REDbridge).`);
  const seenFar = meshes.filter((o) => o.streaming);
  if (seenFar.length && !atLeast(input.bridgeVersion, [0, 12, 1])) say2("warn", `REDbridge ${input.bridgeVersion} does not pass Seen from on to the game's own hide distance: ${seenFar.length === 1 ? "a mesh with Seen from shows" : `${seenFar.length} meshes with Seen from show`} only as far as the game allows for ${seenFar.length === 1 ? "its" : "their"} size (about 60 m for a crate). Update it to 0.12.1 or later (EDGEdeck: Get REDbridge).`);
  if (plain) say2("info", `${plain} mesh${plain === 1 ? " is" : "es are"} set not solid: V walks through ${plain === 1 ? "it" : "them"}. The Solid switch on the Scene tab changes that.`);
  if (solid.length) say2("info", `${solid.length} mesh${solid.length === 1 ? "" : "es"} will stop V, bullets and cars. Entities keep their own collision.`);
  return out;
}
function settleXl(xlFile, slug, blockPath) {
  const text = fs6.readFileSync(xlFile, "utf8");
  if (/^streaming:/m.test(text)) return xlFile;
  const file = path6.join(path6.dirname(xlFile), `${slug}.archive.xl`);
  fs6.writeFileSync(file, `# Written by EDGEbuilder: adds the baked sector to the world.
streaming:
  blocks:
    - ${blockPath}
`);
  if (path6.resolve(file) !== path6.resolve(xlFile)) fs6.rmSync(xlFile, { force: true });
  return file;
}
var recordFile = (project2, slug) => path6.join(project2.raw, "edgebuilder", `${slug}.bake.json`);
function writeRecord(project2, record) {
  const file = recordFile(project2, record.slug);
  fs6.mkdirSync(path6.dirname(file), { recursive: true });
  fs6.writeFileSync(file, JSON.stringify(record, null, 2));
}
function bakesIn(project2) {
  if (!project2) return [];
  const root = path6.join(project2.archive, "edgebuilder");
  let names;
  try {
    names = fs6.readdirSync(root);
  } catch {
    return [];
  }
  const out = [];
  for (const slug of names) {
    if (!fs6.existsSync(path6.join(root, slug, `${slug}.streamingsector`))) continue;
    let record = { slug, name: slug };
    try {
      record = { ...record, ...JSON.parse(fs6.readFileSync(recordFile(project2, slug), "utf8")) };
    } catch {
    }
    out.push(record);
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
function removeBake(project2, slug) {
  if (slugOf(slug) !== slug) throw new Error(`${slug} is not a bake's name`);
  fs6.rmSync(path6.join(project2.archive, "edgebuilder", slug), { recursive: true, force: true });
  for (const name of [`${slug}.archive.xl`, `${slug}.xl`]) fs6.rmSync(path6.join(project2.resources, "archive", "pc", "mod", name), { force: true });
  fs6.rmSync(recordFile(project2, slug), { force: true });
}
function deployedBakes(gameDir2) {
  const found = /* @__PURE__ */ new Map();
  if (!gameDir2) return found;
  const redmods = path6.join(gameDir2, "mods");
  const dirs = [path6.join(gameDir2, "archive", "pc", "mod"), ...namesIn(redmods).map((m) => path6.join(redmods, m, "archives"))];
  for (const dir of dirs) {
    for (const name of namesIn(dir)) {
      if (!name.toLowerCase().endsWith(".xl")) continue;
      let text = "";
      try {
        text = fs6.readFileSync(path6.join(dir, name), "utf8");
      } catch {
        continue;
      }
      for (const m of text.matchAll(/edgebuilder[\\/]([a-z0-9_]+)[\\/]\1\.streamingblock/gi)) found.set(m[1].toLowerCase(), name);
    }
  }
  return found;
}
function namesIn(dir) {
  try {
    return fs6.readdirSync(dir);
  } catch {
    return [];
  }
}
var BakeFolderEnding = ".bake";
function bakeFolderProject(dir) {
  const source = path6.join(dir, "source");
  return { name: path6.basename(dir).replace(/\.bake$/i, ""), dir, archive: path6.join(source, "archive"), raw: path6.join(source, "raw"), resources: path6.join(source, "resources") };
}
function newBakeId() {
  return createHash("sha256").update(`${Date.now()}-${Math.random()}-${process.pid}`).digest("hex").slice(0, 16);
}
function readBakeMeta(dir) {
  const data = JSON.parse(fs6.readFileSync(path6.join(dir, "bake.json"), "utf8"));
  if (data.format !== 1 || typeof data.id !== "string" || !Array.isArray(data.scenes)) throw new Error("not an EDGEbuilder bake");
  return data;
}
function writeBakeMeta(dir, meta) {
  fs6.mkdirSync(dir, { recursive: true });
  fs6.writeFileSync(path6.join(dir, "bake.json"), JSON.stringify(meta, null, 2));
}
function freeBakeDir(parent, name) {
  const base = slugOf(name);
  for (let n = 1; ; n++) {
    const dir = path6.join(parent, `${base}${n === 1 ? "" : `_${n}`}${BakeFolderEnding}`);
    if (!fs6.existsSync(dir)) return dir;
  }
}
function libraryPath(root, file) {
  const rel = path6.relative(root, file);
  return rel.startsWith("..") || path6.isAbsolute(rel) ? file : rel.replace(/\\/g, "/");
}
function fromLibraryPath(root, p) {
  return path6.isAbsolute(p) ? p : path6.join(root, ...p.split("/"));
}
function scanBakes(root) {
  const out = [];
  if (!root) return out;
  const walk = (dir, rel, depth) => {
    let names;
    try {
      names = fs6.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const d of names) {
      if (!d.isDirectory() || d.name.startsWith(".") || d.name === "node_modules") continue;
      const full = path6.join(dir, d.name);
      if (d.name.toLowerCase().endsWith(BakeFolderEnding)) {
        try {
          out.push({ dir: full, folder: rel, meta: readBakeMeta(full) });
        } catch (err) {
          out.push({ dir: full, folder: rel, error: err.message });
        }
      } else if (depth < 8) walk(full, rel ? `${rel}/${d.name}` : d.name, depth + 1);
    }
  };
  walk(root, "", 0);
  return out.sort((a, b) => a.dir.localeCompare(b.dir));
}
function bakeFilesOf(slug) {
  return [
    `source/archive/edgebuilder/${slug}/${slug}.streamingsector`,
    `source/archive/edgebuilder/${slug}/${slug}.streamingblock`,
    `source/resources/archive/pc/mod/${slug}.archive.xl`,
    `source/raw/edgebuilder/${slug}.bake.json`
  ];
}
var noteFile = (projectDir) => path6.join(projectDir, "source", "library.json");
function readNote(projectDir) {
  try {
    const data = JSON.parse(fs6.readFileSync(noteFile(projectDir), "utf8"));
    if (Array.isArray(data?.items)) return { ...data, format: 1, items: data.items };
  } catch {
  }
  return { format: 1, items: [] };
}
function writeNote(projectDir, note) {
  fs6.mkdirSync(path6.dirname(noteFile(projectDir)), { recursive: true });
  fs6.writeFileSync(noteFile(projectDir), JSON.stringify(note, null, 2));
}
function libraryBakesIn(projectDir) {
  const out = /* @__PURE__ */ new Map();
  for (const item of readNote(projectDir).items) {
    if (item.by !== "edgebuilder" || item.kind !== "bake" || !item.id) continue;
    for (const f of item.files) {
      const m = /^source\/archive\/edgebuilder\/([^/]+)\//.exec(f);
      if (m) out.set(m[1], { id: item.id, version: item.version, path: item.path });
    }
  }
  return out;
}
function includeClashes(project2, meta) {
  const fromLibrary = libraryBakesIn(project2.dir);
  const have = new Set(bakesIn(project2).map((b) => b.slug));
  return meta.scenes.map((s) => s.slug).filter((slug) => have.has(slug) && fromLibrary.get(slug)?.id !== meta.id);
}
function includeBake(dir, meta, project2, libraryRoot2) {
  const note = readNote(project2.dir);
  const before = note.items.find((i) => i.by === "edgebuilder" && i.kind === "bake" && i.id === meta.id);
  const files = [];
  for (const s of meta.scenes) {
    for (const rel of bakeFilesOf(s.slug)) {
      const from = path6.join(dir, ...rel.split("/"));
      if (!fs6.existsSync(from)) continue;
      const to = path6.join(project2.dir, ...rel.split("/"));
      fs6.mkdirSync(path6.dirname(to), { recursive: true });
      if (rel.endsWith(".bake.json")) {
        const record = JSON.parse(fs6.readFileSync(from, "utf8"));
        fs6.writeFileSync(to, JSON.stringify({ ...record, library: { id: meta.id, name: meta.name, version: meta.version } }, null, 2));
      } else fs6.copyFileSync(from, to);
      files.push(rel);
    }
  }
  for (const old of before?.files ?? []) {
    if (files.includes(old) || !/^source\/(archive\/edgebuilder|resources\/archive\/pc\/mod|raw\/edgebuilder)\//.test(old)) continue;
    const file = path6.join(project2.dir, ...old.split("/"));
    fs6.rmSync(file, { force: true });
    if (/^source\/archive\/edgebuilder\/[^/]+\//.test(old)) {
      try {
        fs6.rmdirSync(path6.dirname(file));
      } catch {
      }
    }
  }
  const item = { id: meta.id, kind: "bake", path: libraryPath(libraryRoot2, dir), version: meta.version, added: (/* @__PURE__ */ new Date()).toISOString(), by: "edgebuilder", files };
  note.items = [...note.items.filter((i) => i !== before), item];
  writeNote(project2.dir, note);
  return files;
}
function forgetInNote(projectDir, slug) {
  const note = readNote(projectDir);
  const mine = new Set(bakeFilesOf(slug));
  let changed = false;
  note.items = note.items.flatMap((i) => {
    if (i.by !== "edgebuilder" || i.kind !== "bake" || !i.files.some((f) => mine.has(f))) return [i];
    changed = true;
    const files = i.files.filter((f) => !mine.has(f));
    return files.length ? [{ ...i, files }] : [];
  });
  if (changed) writeNote(projectDir, note);
}

// src/scene.ts
import * as fs7 from "node:fs";
import * as path7 from "node:path";
function readSceneFile(file) {
  const data = JSON.parse(fs7.readFileSync(file, "utf8"));
  if (!knownFormat(data)) throw new Error(`not a format 1 or 2 scene`);
  return data;
}
var Scene = class {
  /** The file the scene is saved to after every change; another scene opened (B3-2) changes it. */
  constructor(file) {
    this.file = file;
  }
  name = "Working scene";
  /** The game version the file says it was made against; kept, not set (B3-2). */
  game;
  objects = [];
  groups = [];
  /** Where an unreadable scene file was moved, so the next save does not overwrite it. */
  setAside;
  load() {
    let text;
    try {
      text = fs7.readFileSync(this.file, "utf8");
    } catch {
      return false;
    }
    try {
      const data = JSON.parse(text);
      if (!knownFormat(data)) throw new Error(`not a format 1 or 2 scene`);
      this.take(data);
      return true;
    } catch (err) {
      this.setAside = `${this.file}.unreadable-${(/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-")}`;
      try {
        fs7.renameSync(this.file, this.setAside);
      } catch {
        this.setAside = void 0;
      }
      this.loadError = err.message;
      return false;
    }
  }
  loadError;
  /** Makes this the scene in `data`, saved to `file` from now on. */
  take(data, file = this.file) {
    this.file = file;
    this.name = data.name || path7.basename(file).replace(/\.scene\.json$/i, "");
    this.game = typeof data.game === "string" ? data.game : void 0;
    this.objects = data.objects.map((o) => ({ ...o }));
    this.groups = Array.isArray(data.groups) ? data.groups.map((g) => ({ id: g.id, name: g.name, parent: g.parent ?? null })) : [];
    for (const o of this.objects) if (o.group && !this.groups.some((g) => g.id === o.group)) delete o.group;
  }
  /** The scene as its file keeps it. */
  data() {
    return {
      format: this.objects.some((o) => o.kind === "npc") ? 2 : 1,
      name: this.name,
      ...this.game ? { game: this.game } : {},
      groups: this.groups,
      objects: this.objects.map(({ entityId: _live, ...rest }) => rest)
    };
  }
  /** Called after each save, for the service's scene-changed event. */
  onSave;
  /** No file: the scene was closed, and nothing is open. */
  save() {
    if (!this.file) return;
    fs7.mkdirSync(path7.dirname(this.file), { recursive: true });
    fs7.writeFileSync(this.file, JSON.stringify(this.data(), null, 2));
    this.onSave?.();
  }
  /** A new object; `record` for a person (the `npc` kind), whose id comes from the record's name. */
  add(kind, resource, transform, appearance, record) {
    const from = resource ? path7.basename(resource).replace(/\.[^.]+$/, "") : record ? record.replace(/^Character\./i, "") : "";
    const base = from ? from.replace(/[^a-z0-9_-]+/gi, "_").toLowerCase() : kind;
    const id = freshId(base, new Set(this.objects.map((o2) => o2.id)));
    const o = { id, kind, ...resource ? { resource } : {}, ...record ? { record } : {}, appearance, transform };
    this.objects.push(o);
    this.save();
    return o;
  }
  remove(id) {
    const i = this.objects.findIndex((o) => o.id === id);
    if (i < 0) return void 0;
    const [gone2] = this.objects.splice(i, 1);
    pruneGroups(this.objects, this.groups);
    this.save();
    return gone2;
  }
  /** A copy of the scene as it is now, for Undo. */
  state() {
    return JSON.parse(JSON.stringify({ objects: this.objects.map(({ entityId: _live, ...rest }) => rest), groups: this.groups }));
  }
  /**
   * Puts the scene back to `s`, keeping the previews of objects that are still there (by id). Returns
   * what the mod has to do: spawn objects that came back, spawn again those whose file, appearance or
   * scale changed, move those that moved, and remove the previews of objects that are gone.
   */
  restore(s) {
    const before = new Map(this.objects.map((o) => [o.id, o]));
    const out = { spawn: [], respawn: [], move: [], gone: [] };
    this.objects = s.objects.map((saved) => {
      const o = JSON.parse(JSON.stringify(saved));
      const was = before.get(o.id);
      before.delete(o.id);
      if (!was) out.spawn.push(o);
      if (!was?.entityId) return o;
      o.entityId = was.entityId;
      const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
      if (was.kind !== o.kind || was.resource !== o.resource || was.record !== o.record || was.appearance !== o.appearance || !same(was.transform.scale, o.transform.scale)) out.respawn.push(o);
      else if (!same(was.transform.position, o.transform.position) || !same(was.transform.rotation, o.transform.rotation)) out.move.push(o);
      return o;
    });
    out.gone = [...before.values()].filter((o) => o.entityId);
    this.groups = JSON.parse(JSON.stringify(s.groups));
    this.save();
    return out;
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
    this.groups = [];
    this.save();
  }
};
function knownFormat(data) {
  return (data.format === 1 || data.format === 2) && Array.isArray(data.objects);
}
function yawToQuaternion(yawDegrees) {
  const half = yawDegrees * Math.PI / 360;
  return [0, 0, Math.sin(half), Math.cos(half)];
}

// src/move.ts
import { world } from "rednode";
async function movePreview(o, position, rotation) {
  if (!o.entityId || o.kind === "npc") return false;
  return world.move(o.entityId, { x: position[0], y: position[1], z: position[2] }, { i: rotation[0], j: rotation[1], k: rotation[2], r: rotation[3] });
}
function sameTransform(a, b) {
  const near = (x, y) => x.every((v2, i) => Math.abs(v2 - y[i]) < 1e-5);
  return near(a.position, b.position) && near(a.rotation, b.rotation) && near(a.scale, b.scale);
}

// src/protocol.ts
var AnyLook = "Any: the game picks";

// src/mod.ts
var EmptyEntity = "base\\gameplay\\loot\\containers\\common_suitcases\\appearances\\suitcase_small_placeholder.ent";
var SpawnDistance = 3;
var ResultLimit = 120;
var settingsFile = path8.join(pkg.dataDir, "settings.json");
var settings = {};
try {
  settings = JSON.parse(fs8.readFileSync(settingsFile, "utf8"));
} catch {
}
var dataScenes = path8.join(pkg.dataDir, "scenes");
var WorkingScene = path8.join(dataScenes, "working.scene.json");
var sessionFile = path8.join(pkg.dataDir, "session.json");
var session = {};
try {
  session = JSON.parse(fs8.readFileSync(sessionFile, "utf8"));
} catch {
}
var lastGone = session.open && !fs8.existsSync(session.open) && path8.resolve(session.open).toLowerCase() !== WorkingScene.toLowerCase() ? session.open : void 0;
var scene = new Scene(session.open === "" ? "" : session.open && !lastGone ? session.open : WorkingScene);
if (scene.file) scene.load();
else scene.name = "";
var onScenes = new Map((session.on ?? []).filter((f) => fs8.existsSync(f) && f !== scene.file).map((f) => [f, 0]));
var libraryRoot = readLibraryRoot();
var suggestedRoot = suggestedLibraryRoot();
var past = [];
var future = [];
var HistoryLength = 100;
var duplicates = 0;
var index = new AssetIndex(path8.join(pkg.dataDir, "index"));
var npcs = new NpcList(path8.join(pkg.dataDir, "index"));
var sources = new ModSources(path8.join(pkg.dataDir, "sources", "mods.json"));
index.extra = sources.entries();
var bridge;
var blockedRetry;
var ownBridge;
var gameKey = "";
var state = {
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
  inUse: {}
};
function publish() {
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
function say(text, tone = "info") {
  state.message = { text, tone };
  console.log(text);
  publish();
}
function gameDir() {
  if (isGameFolder(settings.gameDir)) return settings.gameDir;
  let dir = pkg.dir;
  for (let i = 0; i < 6; i++) {
    dir = path8.dirname(dir);
    if (isGameFolder(dir)) return dir;
  }
  return void 0;
}
async function startBridge() {
  bridge?.stop();
  bridge = void 0;
  clearTimeout(blockedRetry);
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
    await bridgeReady(info, exe);
  } catch (err) {
    state.bridge = { status: "failed", path: exe, detail: `${err.message}. ${b.log.slice(-3).join(" | ")}` };
    publish();
  }
}
async function startKernelBridge(get) {
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
    bridge = void 0;
    const why = err.message;
    if (/allow/i.test(why)) {
      state.bridge = { status: "blocked", detail: "Allow REDbridge for EDGEbuilder in REDnode's Mod Manager: select EDGEbuilder, Permissions, switch Allowed on." };
      publish();
      blockedRetry = setTimeout(() => void startBridge(), 5e3);
    } else if (/not installed/i.test(why)) {
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
async function bridgeReady(info, source) {
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
async function readNpcs(again = false) {
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
    state.npcs = { status: "failed", count: 0, progress: err.message };
    say(`NPCs are not listed: ${err.message}. They need REDbridge 0.8.0 or later.`, "warn");
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
var modsBusy = false;
var modsAgain = false;
async function refreshMods() {
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
    say(`The mod archives could not be read: ${err.message}`, "warn");
  } finally {
    modsBusy = false;
  }
}
function sourcesChanged() {
  index.extra = sources.entries();
  runSearch();
}
function debounced(run, ms = 1500) {
  let timer;
  return () => {
    clearTimeout(timer);
    timer = setTimeout(run, ms);
  };
}
var modWatchers = [];
function watchMods() {
  const dir = gameDir();
  if (!dir || modWatchers.length) return;
  const changed = debounced(() => void refreshMods());
  for (const folder of modFolders(dir)) {
    try {
      modWatchers.push(fs8.watch(folder, { recursive: true }, changed));
    } catch {
    }
  }
}
var project = null;
var projectWatch;
var projectChanged = debounced(() => scanProject());
function scanProject() {
  sources.scanProject(project, (p) => index.isGamePath(p));
  state.sources.project = project ? { name: project.name, dir: project.dir, archive: project.archive, assets: sources.project.length } : null;
  sourcesChanged();
}
function setProject(next) {
  if (next?.archive !== project?.archive) {
    projectWatch?.close();
    projectWatch = void 0;
    if (next) {
      try {
        projectWatch = fs8.watch(next.archive, { recursive: true }, projectChanged);
      } catch {
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
async function connectRedcode() {
  if (typeof service?.connect !== "function") return;
  try {
    const redcode = await service.connect("redcode");
    redcode.$on("project-changed", (p) => setProject(p));
    setProject(await redcode.project());
  } catch (err) {
    console.log(`REDcode's service is not there (${err.message}); looking again in a minute. Browse lists the game and mods meanwhile.`);
    setTimeout(() => void connectRedcode(), 6e4);
  }
}
function sourceOf(assetPath) {
  const lower = assetPath.toLowerCase();
  return index.extra.find((e) => !e.replaces && e.path.toLowerCase() === lower);
}
async function inGameArchives(assetPath) {
  if (index.isGamePath(assetPath)) return true;
  if (!bridge?.running) return false;
  try {
    const page = await bridge.list(assetPath.replace(/\//g, "\\"), 0, 1);
    return page.items.some((f) => f.name.toLowerCase() === assetPath.replace(/\//g, "\\").toLowerCase());
  } catch {
    return false;
  }
}
async function lookAtPerson(record) {
  const e = npcs.find(record);
  if (!e?.template) return { appearances: [], bounds: PersonBounds, error: `${record} is not in the NPC list` };
  const own = e.appearance ? [e.appearance] : [AnyLook];
  if (!bridge?.running) return { appearances: own, bounds: PersonBounds };
  const info = await index.lookAt(bridge, e.template);
  const rest = (info.appearances ?? []).filter((a) => a !== e.appearance);
  return { appearances: [...own, ...rest], bounds: PersonBounds, ...info.error ? { error: info.error } : {} };
}
async function currentLook(entityId) {
  try {
    const entity = await world2.entity(entityId);
    const name = entity ? await entity.GetCurrentAppearanceName() : "";
    return name && name !== "None" ? name : void 0;
  } catch {
    return void 0;
  }
}
function assetInfo(b, assetPath) {
  const entry = sourceOf(assetPath);
  return entry ? sources.lookAt(b, entry) : index.lookAt(b, assetPath);
}
function worldBlocker() {
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
async function checkWorld() {
  const before = state.world;
  try {
    const s = await game.state();
    if (!s.connected) state.world = "no-game";
    else if (await world2.available()) state.world = "ready";
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
async function inFrontOfPlayer() {
  const player = await api.GetPlayer(game.instance);
  if (!player) throw new Error("No player: load a save first");
  const p = await player.GetWorldPosition();
  const f = await player.GetWorldForward();
  const yaw = Math.atan2(f.X, -f.Y) * 180 / Math.PI;
  return { position: [p.X + f.X * SpawnDistance, p.Y + f.Y * SpawnDistance, p.Z], yaw };
}
var SurfaceReach = 1e3;
var NoSurface = `within ${SurfaceReach} m. The ground is solid only near the camera: fly closer and try again.`;
async function dropPlace(at) {
  if (at) {
    const { hit } = await raycast(at.origin, add(at.origin, mul(at.dir, SurfaceReach)));
    if (!hit) console.log(`Drop at click: nothing there within ${SurfaceReach} m; dropping 8 m along the line`);
    return { position: hit ?? add(at.origin, mul(at.dir, 8)), yaw: Math.atan2(at.dir[0], -at.dir[1]) * 180 / Math.PI };
  }
  if (editorCam) {
    try {
      const b = basisFromMatrix(await editorCam.component.GetLocalToWorld());
      const { hit } = await raycast(b.pos, add(b.pos, mul(b.fwd, 60)));
      const position = hit ?? add(b.pos, mul(b.fwd, 6));
      const yaw = Math.atan2(b.fwd[0], -b.fwd[1]) * 180 / Math.PI;
      return { position, yaw };
    } catch (err) {
      console.log(`Drop at the camera: ${err.message}; dropping in front of V`);
    }
  }
  return inFrontOfPlayer();
}
async function spawnPreview(o) {
  const [x, y, z] = o.transform.position;
  const [i, j, k, r] = o.transform.rotation;
  const position = { x, y, z };
  const orientation = { i, j, k, r };
  let id;
  if (o.kind === "mesh") {
    const [sx, sy, sz] = o.transform.scale;
    ({ id } = await world2.spawn({ mesh: o.resource, meshAppearance: o.appearance ?? "default", scale: { x: sx, y: sy, z: sz }, position, orientation, alwaysSpawned: true, tags: ["edgebuilder"] }));
  } else if (o.kind === "entity") {
    ({ id } = await world2.spawn({ template: o.resource, position, orientation, appearance: o.appearance, alwaysSpawned: true, tags: ["edgebuilder"] }));
  } else if (o.kind === "npc") {
    const from = o.record ? { record: o.record } : { template: o.resource };
    ({ id } = await world2.spawn({ ...from, position, orientation, appearance: o.appearance, npc: true, alwaysSpawned: true, tags: ["edgebuilder"] }));
  } else {
    throw new Error(`Previews of ${o.kind} objects come in a later phase`);
  }
  o.entityId = id.hash;
}
async function removePreview(o) {
  if (!o.entityId) return;
  try {
    await world2.remove(o.entityId);
  } catch (err) {
    console.log(`Remove ${o.id}: ${err.message}`);
  }
  delete o.entityId;
}
async function highlight(o, on) {
  if (!o?.entityId) return;
  try {
    const entity = await world2.entity(o.entityId);
    if (!entity) return;
    const event = await api.$new("entRenderHighlightEvent", { seeThroughWalls: true, opacity: on ? 1 : 0, outlineIndex: on ? 1 : 0, fillIndex: 0 });
    await entity.QueueEvent(event);
  } catch (err) {
    console.log(`Highlight ${o.id} ${on ? "on" : "off"}: ${err.message}`);
  }
}
var toPoint = (p) => ({ x: p[0], y: p[1], z: p[2] });
var toQuat = (q) => ({ i: q[0], j: q[1], k: q[2], r: q[3] });
async function place(o, t) {
  if (o.kind !== "mesh") t = { ...t, scale: [1, 1, 1] };
  if (o.kind === "npc") t = { ...t, rotation: upright(t.rotation) };
  const scaled = t.scale.some((s, i) => Math.abs(s - o.transform.scale[i]) > 1e-6);
  const same = sameTransform(o.transform, t);
  o.transform = t;
  if (!o.entityId) return;
  if (o.kind === "npc") {
    if (!same) await movePerson(o);
  } else if (scaled) await respawn(o);
  else await movePreview(o, t.position, t.rotation);
}
async function movePerson(o) {
  const [x, y, z] = o.transform.position;
  const yaw = 2 * Math.atan2(o.transform.rotation[2], o.transform.rotation[3]) * 180 / Math.PI;
  try {
    const entity = o.entityId ? await world2.entity(o.entityId) : null;
    const ai = entity ? await entity.GetAIControllerComponent() : null;
    if (entity && ai) {
      await ai.SendCommand(await api.$new("AITeleportCommand", { position: { X: x, Y: y, Z: z, W: 1 }, rotation: yaw, doNavTest: false }));
      await new Promise((r) => setTimeout(r, 400));
      const p = await entity.GetWorldPosition();
      const off = Math.hypot(p.X - x, p.Y - y);
      if (off < 0.3) {
        await ai.SendCommand(await api.$new("AIHoldPositionCommand", { duration: 86400 }));
        console.log(`${o.id} moved by the AI's teleport command`);
        return;
      }
      console.log(`${o.id} not moved by the AI's teleport command (${off.toFixed(1)} m off): spawned again`);
    }
  } catch (err) {
    console.log(`${o.id}: the AI's teleport command failed (${err.message}): spawned again`);
  }
  await respawn(o);
}
async function respawn(o) {
  if (o.kind === "npc" && o.entityId) {
    const old = o.entityId;
    if (await trySpawn(o)) await world2.remove(old).catch((err) => console.log(`Remove ${o.id}: ${err.message}`));
    else o.entityId = old;
    if (state.selected.includes(o.id)) await highlight(o, true);
    return;
  }
  await removePreview(o);
  await trySpawn(o);
  if (state.selected.includes(o.id)) await highlight(o, true);
}
async function spawnAll(objects, logWord = "Preview of") {
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
async function trySpawn(o, logWord = "Preview of") {
  if (o.kind === "light" || state.world !== "ready") return false;
  try {
    await spawnPreview(o);
    return true;
  } catch (err) {
    console.log(`${logWord} ${o.id}: ${err.message}`);
    return false;
  }
}
async function setTransforms(items, merge = false) {
  const known = items.filter((i) => scene.get(i.id));
  if (!known.length) return;
  if (!merge || !past.length) step();
  for (const i of known) await place(scene.get(i.id), i.transform);
  scene.save();
  publish();
}
function step(before = scene.state()) {
  past.push({ ...before, selected: before.selected ?? [...state.selected] });
  if (past.length > HistoryLength) past.shift();
  future.length = 0;
}
async function travel(from, to, word) {
  const s = from.pop();
  if (!s) return say(`Nothing to ${word.toLowerCase()}.`, "info");
  to.push({ ...scene.state(), selected: [...state.selected] });
  const ch = scene.restore(s);
  for (const o of ch.gone) await removePreview(o);
  for (const o of ch.respawn) await respawn(o);
  for (const o of ch.move) {
    if (o.kind === "npc") await movePerson(o);
    else await movePreview(o, o.transform.position, o.transform.rotation).catch(() => void 0);
  }
  const spawned = await spawnAll(ch.spawn);
  scene.save();
  const moved = ch.move.length + ch.respawn.length;
  const missing = spawned.failed ? [`${spawned.failed} not in the world: Rebuild previews`] : [];
  const what = [
    moved ? `${moved} moved back` : "",
    ch.spawn.length ? `${ch.spawn.length} back${missing.length ? ` (${missing.join("; ")})` : ""}` : "",
    ch.gone.length ? `${ch.gone.length} taken out` : ""
  ].filter(Boolean);
  state.message = { text: `${word}${what.length ? `: ${what.join(", ")}` : ""}.`, tone: "ok" };
  console.log(state.message.text);
  const changed = [...ch.spawn, ...ch.respawn, ...ch.move].map((o) => o.id);
  await select(changed.length ? changed : s.selected ?? state.selected);
}
var FloorGroups = ["Static", "Terrain", "PlayerBlocker"];
async function raycast(start, end) {
  const queries = await api.GameInstance.GetSpatialQueriesSystem(game.instance);
  if (!queries) return { tried: ["no spatial queries"] };
  let hit;
  let best = Infinity;
  const tried = [];
  for (const group2 of FloorGroups) {
    try {
      const r = await queries.SyncRaycastByCollisionGroup({ X: start[0], Y: start[1], Z: start[2], W: 1 }, { X: end[0], Y: end[1], Z: end[2], W: 1 }, group2, null, false, false);
      const p = r.out?.result?.position;
      tried.push(`${group2}: ${r.result && p ? p.Z.toFixed(2) : "miss"}`);
      if (r.result && p) {
        const at = [p.X, p.Y, p.Z];
        const d = Math.hypot(...sub(at, start));
        if (d < best) {
          best = d;
          hit = at;
        }
      }
    } catch (err) {
      tried.push(`${group2}: ${err.message}`);
    }
  }
  return { hit, tried };
}
async function dropToFloor(ids) {
  const objects = ids.map((id) => scene.get(id)).filter((o) => !!o);
  if (!objects.length) return;
  if (state.world !== "ready") return say(worldBlocker(), "warn");
  const items = [];
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
async function floorUnder(o) {
  const [x, y, z] = o.transform.position;
  const lowest = (o.bounds?.min[2] ?? 0) * o.transform.scale[2];
  const startZ = z + lowest + 0.05;
  const { hit, tried } = await raycast([x, y, startZ], [x, y, startZ - SurfaceReach]);
  const floor = hit?.[2];
  console.log(`Drop to floor ${o.id} from z ${startZ.toFixed(2)}: ${tried.join("; ")}`);
  return floor === void 0 ? void 0 : { ...o.transform, position: [x, y, floor - lowest] };
}
var builderFile = path8.join(pkg.dataDir, "builder-mode.json");
var CameraName = "edgebuilder_camera";
var HudHiddenTier = 4;
var editorCam;
var tierWatch;
function readBuilderRecord() {
  try {
    return JSON.parse(fs8.readFileSync(builderFile, "utf8"));
  } catch {
    return void 0;
  }
}
function writeBuilderRecord(r) {
  fs8.mkdirSync(pkg.dataDir, { recursive: true });
  fs8.writeFileSync(builderFile, JSON.stringify(r));
}
async function sceneTierBoard() {
  const player = await api.GetPlayer(game.instance);
  if (!player) throw new Error("no player");
  const defs = await api.GetAllBlackboardDefs();
  const psm = await defs.$get("PlayerStateMachine");
  const system = await api.GameInstance.GetBlackboardSystem(game.instance);
  const board = await system.GetLocalInstanced(await player.GetEntityID(), psm);
  if (!board) throw new Error("V's player-state blackboard is not there");
  return { board, id: await psm.$get("SceneTier") };
}
async function setSceneTier(value) {
  try {
    const { board, id } = await sceneTierBoard();
    const before = await board.GetInt(id);
    await board.SetInt(id, value, true);
    const now = await board.GetInt(id);
    console.log(`Scene tier ${before} -> ${value}${now === value ? "" : `, but it reads ${now}`}`);
    return before;
  } catch (err) {
    console.log(`Scene tier not set: ${err.message}`);
    return void 0;
  }
}
function watchTier() {
  stopTierWatch();
  let busy = false;
  tierWatch = setInterval(() => {
    if (busy) return;
    busy = true;
    void (async () => {
      try {
        const { board, id } = await sceneTierBoard();
        const now = await board.GetInt(id);
        if (now === HudHiddenTier) return;
        const record = readBuilderRecord() ?? {};
        record.sceneTier = now;
        writeBuilderRecord(record);
        console.log(`The game set scene tier ${now}; hiding the HUD again`);
        await board.SetInt(id, HudHiddenTier, true);
      } catch {
      } finally {
        busy = false;
      }
    })();
  }, 1e3);
}
function stopTierWatch() {
  if (tierWatch) clearInterval(tierWatch);
  tierWatch = void 0;
}
async function playerCameraBack() {
  try {
    const player = await api.GetPlayer(game.instance);
    const fpp = player ? await player.GetFPPCameraComponent() : null;
    if (fpp) await fpp.Activate(0, false);
  } catch (err) {
    console.log(`V's camera: ${err.message}`);
  }
}
var builderOn = false;
var soloOn = false;
var soloAsked = false;
async function setSolo(on) {
  if (typeof ui?.solo !== "function" || on === soloOn) return;
  try {
    await ui.solo(on);
    soloOn = on;
  } catch (err) {
    if (on && !soloAsked) {
      soloAsked = true;
      say(`Other windows stay while editing (${err.message.replace(/^rednode:\s*/, "")}). To hide them, allow Solo for EDGEbuilder in REDnode's Mod Manager.`, "info");
    }
  }
}
var builderQueue = Promise.resolve();
function queued(op) {
  builderQueue = builderQueue.then(op, op);
  return builderQueue;
}
var sceneQueue = Promise.resolve();
var waiting = 0;
var running;
var BusyAfter = 500;
function inTurn(what, op) {
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
      running = void 0;
      waiting--;
      if (state.busy) {
        state.busy = void 0;
        publish();
      }
    }
  };
  sceneQueue = sceneQueue.then(run, run);
  return sceneQueue;
}
function showBusy() {
  if (!running) return;
  state.busy = { ...running, waiting: Math.max(0, waiting - 1) };
  publish();
}
var stopAsked = false;
function progress(done, total) {
  if (!running) return;
  running.done = done;
  running.total = total;
  if (state.busy) showBusy();
}
async function playerPose() {
  const player = await api.GetPlayer(game.instance);
  const fpp = player ? await player.GetFPPCameraComponent() : null;
  if (!fpp) throw new Error("V's camera is not available");
  const b = basisFromMatrix(await fpp.GetLocalToWorld());
  const camSys = await api.GameInstance.GetCameraSystem(game.instance);
  const fov = camSys ? await camSys.GetActiveCameraFOV() : 0;
  return { position: b.pos, rotation: qLook(lookOf(b.fwd)), fov };
}
async function cameraOn(pose) {
  if (editorCam) return;
  const component = await api.$new("gameCameraComponent", { name: CameraName });
  const { id, entity } = await world2.spawn({ template: EmptyEntity, position: toPoint(pose.position), orientation: toQuat(pose.rotation), components: [component], alwaysSpawned: true, tags: ["edgebuilder", CameraName] });
  writeBuilderRecord({ ...readBuilderRecord(), entityId: id.hash });
  const attached = entity ? await entity.FindComponentByName(CameraName) : null;
  const cam = attached ?? component;
  if (pose.fov > 1) await cam.SetFOV(pose.fov);
  await cam.Activate(0, false);
  editorCam = { id: id.hash, component: cam };
}
async function cameraOff() {
  const record = readBuilderRecord();
  const camId = editorCam?.id ?? record?.entityId;
  if (editorCam) {
    try {
      await editorCam.component.Deactivate(0, false);
    } catch {
    }
  }
  if (camId) {
    try {
      await world2.remove(camId);
    } catch {
    }
  }
  if (camId || editorCam) await playerCameraBack();
  editorCam = void 0;
  if (record?.entityId) {
    delete record.entityId;
    writeBuilderRecord(record);
  }
}
async function hudOff() {
  if (tierWatch) return true;
  const before = await setSceneTier(HudHiddenTier);
  if (before === void 0) return false;
  writeBuilderRecord({ ...readBuilderRecord(), sceneTier: before === HudHiddenTier || before === 0 ? 1 : before });
  watchTier();
  return true;
}
async function hudOn() {
  stopTierWatch();
  const record = readBuilderRecord();
  if (record?.sceneTier === void 0) return;
  await setSceneTier(record.sceneTier);
  delete record.sceneTier;
  writeBuilderRecord(record);
}
function publishCamera() {
  state.camera = editorCam ? { entityId: editorCam.id, hudHidden: !!tierWatch } : void 0;
  publish();
}
function switchesNote() {
  const off = [settings.editorCamera === false ? "EDGEbuilder's own camera" : "", settings.hideHud === false ? "hiding the game's HUD" : ""].filter(Boolean);
  if (!off.length) return void 0;
  return `${settings.editorCamera === false ? "Editing from V's camera" : "Editing"}: ${off.join(" and ")} ${off.length === 1 ? "is" : "are"} off in Settings.`;
}
async function builderStart(pose) {
  if (builderOn) return;
  if (state.world !== "ready") return say(worldBlocker(), "warn");
  builderOn = true;
  try {
    if (settings.editorCamera !== false) await cameraOn(pose);
  } catch (err) {
    say(`The editor camera could not start (${err.message}); editing with V's camera.`, "warn");
    await cameraOff();
  }
  const hidden = settings.hideHud !== false && await hudOff();
  await setSolo(true);
  console.log(`Builder mode on: ${editorCam ? `editor camera ${editorCam.id}` : "V's camera"}${hidden ? ", HUD hidden" : ""}`);
  const note = switchesNote();
  if (note) say(note, "info");
  publishCamera();
}
async function builderSwitches() {
  if (!builderOn) return;
  try {
    if (settings.editorCamera === false && editorCam) {
      await cameraOff();
      console.log("Editor camera off from Settings");
    } else if (settings.editorCamera !== false && !editorCam) {
      await cameraOn(await playerPose());
      console.log(`Editor camera ${editorCam.id} on from Settings`);
    }
  } catch (err) {
    say(`The editor camera could not start (${err.message}); editing with V's camera.`, "warn");
    await cameraOff();
  }
  if (settings.hideHud === false && tierWatch) await hudOn();
  else if (settings.hideHud !== false && !tierWatch) await hudOff();
  publishCamera();
}
async function builderStop() {
  const record = readBuilderRecord();
  const wasOn = builderOn || !!record;
  builderOn = false;
  await cameraOff();
  await hudOn();
  stopTierWatch();
  await setSolo(false);
  state.camera = void 0;
  try {
    fs8.rmSync(builderFile, { force: true });
  } catch {
  }
  if (wasOn) console.log("Builder mode off");
  publish();
}
function runSearch() {
  state.results = index.entries.length || index.extra.length ? index.search(state.query.text, state.query.kind, ResultLimit, state.query.from) : [];
  publish();
}
async function drop(assetPath, appearance, at) {
  if (!scene.file) return say(NoScene, "warn");
  const person = isRecord(assetPath) ? npcs.find(assetPath) : void 0;
  if (isRecord(assetPath) && !person) return say(`${assetPath} is not in the NPC list.`, "warn");
  const kind = person ? "npc" : kindOf(assetPath);
  if (!kind) return say(`${assetPath} is not a mesh or an entity template.`, "warn");
  const look = person ? appearance === AnyLook ? void 0 : appearance ?? person.appearance : appearance;
  if (state.world !== "ready") await checkWorld();
  if (state.world !== "ready") return say(worldBlocker(), "warn");
  let added;
  const before = scene.state();
  try {
    const place2 = await dropPlace(at);
    const t = { position: place2.position, rotation: yawToQuaternion(place2.yaw), scale: [1, 1, 1] };
    const o = person ? scene.add("npc", void 0, t, look, person.path) : scene.add(kind, assetPath, t, look);
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
      }
    }
    const started = Date.now();
    await spawnPreview(o);
    if (person && !o.appearance && o.entityId) o.appearance = await currentLook(o.entityId);
    scene.save();
    step(before);
    await select([o.id]);
    const from = sourceOf(assetPath)?.source;
    const note = from?.kind === "project" ? await inGameArchives(assetPath) ? ` From the REDcode project ${from.name}, at a game file's path: the game shows its own version until the project is packed and loaded (REDcode's Pack and Play).` : ` From the REDcode project ${from.name}: the game shows it once the project is packed and loaded (REDcode's Pack and Play).` : from?.kind === "mod" ? ` From ${from.name}.${sized ? "" : " Its size is not known, so the gizmo uses a 1 m box."}` : "";
    const what = person ? `${person.name ?? person.path}${o.appearance ? ` (${o.appearance})` : ""}` : path8.basename(assetPath);
    say(`Dropped ${what} in ${Date.now() - started} ms.${note}`, "ok");
  } catch (err) {
    if (added) {
      await removePreview(added);
      scene.remove(added.id);
    }
    say(`Drop failed, nothing was added: ${err.message}`, "error");
  }
}
async function select(ids) {
  ids = ids.filter((id, i) => scene.get(id) && ids.indexOf(id) === i);
  const off = state.selected.filter((id) => !ids.includes(id));
  const on = ids.filter((id) => !state.selected.includes(id));
  state.selected = ids;
  for (const id of off) await highlight(scene.get(id), false);
  for (const id of on) await highlight(scene.get(id), true);
  publish();
}
async function remove(ids) {
  const objects = ids.map((id) => scene.get(id)).filter((o) => !!o);
  if (!objects.length) return;
  step();
  for (const o of objects) {
    await removePreview(o);
    scene.remove(o.id);
  }
  say(objects.length === 1 ? `Removed ${objects[0].id}. Undo brings it back.` : `Removed ${objects.length} objects. Undo brings them back.`, "ok");
}
function group(ids) {
  const before = scene.state();
  const id = makeGroup(ids.filter((x) => scene.get(x)), scene.objects, scene.groups);
  if (!id) return say("Select something to group first.", "warn");
  step(before);
  scene.save();
  const g = scene.groups.find((x) => x.id === id);
  say(`Grouped ${ids.length} object${ids.length === 1 ? "" : "s"} as ${g.name}. A click on one now selects the group; Alt+click picks one.`, "ok");
}
function ungroup2(ids) {
  const before = scene.state();
  const opened = ungroup(ids.filter((x) => scene.get(x)), scene.objects, scene.groups);
  if (JSON.stringify(before) === JSON.stringify(scene.state())) return say("Nothing selected is in a group.", "info");
  step(before);
  scene.save();
  say(opened ? `Ungrouped ${opened} group${opened === 1 ? "" : "s"}.` : "Taken out of the group.", "ok");
}
function rename(groupId, name) {
  const g = scene.groups.find((x) => x.id === groupId);
  name = name.trim();
  if (!g || !name || name === g.name) return publish();
  step();
  g.name = name;
  scene.save();
  say(`Renamed the group ${name}.`, "ok");
}
var clipboard;
function copy(ids) {
  ids = ids.filter((x) => scene.get(x));
  if (!ids.length) return say("Select something to copy first.", "warn");
  clipboard = copyOf(ids, scene.objects, scene.groups);
  const n = clipboard.objects.length;
  say(`Copied ${n} object${n === 1 ? "" : "s"}. Ctrl+V pastes ${n === 1 ? "it" : "them"} where the cursor points.`, "ok");
}
async function cut(ids) {
  ids = ids.filter((x) => scene.get(x));
  if (!ids.length) return say("Select something to cut first.", "warn");
  clipboard = copyOf(ids, scene.objects, scene.groups);
  await remove(ids);
  const n = clipboard.objects.length;
  say(`Cut ${n} object${n === 1 ? "" : "s"}. Ctrl+V pastes ${n === 1 ? "it" : "them"} where the cursor points; Ctrl+Z puts ${n === 1 ? "it" : "them"} back.`, "ok");
}
async function paste(at) {
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
async function duplicate2(ids, offset) {
  ids = ids.filter((x) => scene.get(x));
  if (!ids.length) return say("Select something to copy first.", "warn");
  if (state.world !== "ready") await checkWorld();
  if (state.world !== "ready") return say(worldBlocker(), "warn");
  step();
  const copies = duplicate(ids, scene.objects, scene.groups, offset);
  scene.groups.push(...copies.groups);
  scene.objects.push(...copies.objects);
  let shown = 0;
  for (const o of copies.objects) if (await trySpawn(o)) shown++;
  scene.save();
  state.duplicated = { seq: ++duplicates, ids: copies.objects.map((o) => o.id) };
  const n = copies.objects.length;
  state.message = {
    text: `Copied ${n} object${n === 1 ? "" : "s"}${shown < n ? ` (${n - shown} not in the world)` : ""}.${offset ? "" : " Move the copy and click to place it; Esc takes it back."}`,
    tone: shown < n ? "warn" : "ok"
  };
  await select(state.duplicated.ids);
}
async function rebuild() {
  if (state.world !== "ready") await checkWorld();
  if (state.world !== "ready") return say(worldBlocker(), "warn");
  const r = await spawnAll(
    scene.objects.filter((o) => !o.entityId),
    "Rebuild"
  );
  scene.save();
  const n = r.shown;
  say(`${n} preview${n === 1 ? "" : "s"} back in the world${r.failed ? `; ${r.failed} the game did not place (the log says why)` : ""}.`, r.failed ? "warn" : "ok");
}
var PreviewsBackDelay = 2e3;
var previewsTimer;
var backWhenIn = false;
function previewsBackSoon(delay = PreviewsBackDelay) {
  clearTimeout(previewsTimer);
  previewsTimer = setTimeout(() => void inTurn("Put previews back", () => previewsBack()), delay);
}
var RetryFor = 9e4;
var RetryEvery = 5e3;
async function previewsBack() {
  if (state.world !== "ready") return;
  const away = scene.objects.filter((o) => !o.entityId && o.kind !== "light");
  if (!away.length) return void (backWhenIn = false);
  if (!(await game.state()).world) {
    backWhenIn = true;
    console.log(`${scene.name}: ${away.length} object${away.length === 1 ? "" : "s"} wait for V to be in the world`);
    previewsBackSoon();
    return;
  }
  backWhenIn = false;
  lookAtBakes();
  if (state.bake.inGame) return say(BakedOff(scene.name, state.bake.inGame), "info");
  const kept = new Set(scene.objects.map((o) => o.entityId));
  kept.add(editorCam?.id);
  for (const s of world2.spawned?.() ?? []) if (!s.scene && s.attached && !kept.has(s.id.hash)) await world2.remove(s.id).catch(() => false);
  const r = await spawnAll(away, "Back");
  const again = r.failed > 0 && !stopAsked && Date.now() - attachedAt < RetryFor;
  if (again) {
    console.log(`${scene.name}: ${r.failed} not placed yet; trying again in ${RetryEvery / 1e3} s`);
    previewsBackSoon(RetryEvery);
  }
  say(`${scene.name}: ${r.shown} of ${away.length} object${away.length === 1 ? "" : "s"} back in the world${r.failed ? `; ${r.failed} the game did not place${again ? " yet, trying again" : " (the log says why)"}` : ""}.`, r.failed && !again ? "warn" : "ok");
}
async function goTo(id) {
  const o = scene.get(id);
  if (!o) return;
  if (state.world !== "ready") return say(worldBlocker(), "warn");
  const noCamera = state.settings.editorCamera === false ? " The editor camera is off in Settings, so the view stayed where it is." : "";
  if (!o.entityId && o.kind !== "light") {
    try {
      await spawnPreview(o);
    } catch (err) {
      console.log(`Go to ${id}: ${err.message}`);
      await select([id]);
      return say(`${id} is selected, but the game did not place its preview (the log says why). There is no gizmo without a preview; its numbers in the Selected panel still work.${noCamera}`, "warn");
    }
  }
  await select([id]);
  await highlight(o, true);
  await spawnAll(scene.objects.filter((x) => !x.entityId));
  say(`${id} is selected.${noCamera}`, "ok");
}
function peek(file) {
  try {
    const d = readSceneFile(file);
    state.library.peek = { file, name: d.name, objects: d.objects, groups: d.groups ?? [] };
  } catch (err) {
    delete state.library.peek;
    say(`${path8.basename(file)} cannot be read: ${err.message}.`, "error");
  }
  publish();
}
async function removeFromScene(file, id) {
  if (sameFile(file, scene.file)) return remove([id]);
  const other = new Scene(file);
  try {
    other.load();
    if (!other.remove(id)) return peek(file);
  } catch (err) {
    return say(`${path8.basename(file)}: ${err.message}.`, "error");
  }
  const shown = [...onScenes.keys()].find((f) => sameFile(f, file));
  if (shown && state.world === "ready") await loadOn(shown).catch((err) => console.log(`${path8.basename(shown)} not shown: ${err.message}`));
  scanLibrary();
  peek(file);
  say(`Removed ${id} from ${other.name}. That scene is not open, so Undo cannot bring it back.`, "ok");
}
async function clear() {
  if (!scene.objects.length && !scene.groups.length) return say("The scene is already empty.", "info");
  step();
  for (const o of scene.objects) await removePreview(o);
  scene.clear();
  state.selected = [];
  say("Scene cleared. Undo brings it back.", "ok");
}
function placeRoots() {
  const out = [];
  if (libraryRoot) out.push({ place: "library", dir: libraryRoot, label: "Library" });
  if (project) out.push({ place: "project", dir: path8.join(path8.dirname(project.archive), "scenes"), label: `Project: ${project.name}` });
  out.push({ place: "data", dir: dataScenes, label: "This PC" });
  return out;
}
function rootOf(place2) {
  const r = placeRoots().find((x) => x.place === place2);
  if (r) return r;
  throw new Error(place2 === "library" ? "Set the Library folder in Settings first." : "No REDcode project is open.");
}
function scanLibrary() {
  state.library.shelves = placeRoots().map(scanShelf);
  libraryBakeDirs = scanBakes(libraryRoot).map(({ dir, folder }) => ({ dir, folder }));
  lookAtLibraryBakes();
}
function whereText(file) {
  const roots = placeRoots();
  const at = whereIs(file, roots);
  if (!at) return file;
  const label = roots.find((r) => r.place === at.place).label;
  return at.folder ? `${label} > ${at.folder.replace(/\//g, " > ")}` : label;
}
function writeSession() {
  try {
    fs8.mkdirSync(pkg.dataDir, { recursive: true });
    fs8.writeFileSync(sessionFile, JSON.stringify({ open: scene.file, on: [...onScenes.keys()] }, null, 2));
  } catch (err) {
    console.log(`session.json not written: ${err.message}`);
  }
}
var sameFile = (a, b) => path8.resolve(a).toLowerCase() === path8.resolve(b).toLowerCase();
async function switchTo(data, file) {
  for (const o of scene.objects) await removePreview(o);
  state.selected = [];
  state.duplicated = void 0;
  past.length = 0;
  future.length = 0;
  scene.take(data, file);
  writeSession();
}
var NoScene = "No scene is open: open one or make one on the Library tab.";
async function closeScene() {
  if (!scene.file) return say("No scene is open.", "info");
  const was = scene.name;
  const where = whereText(scene.file);
  await switchTo({ format: 1, name: "", groups: [], objects: [] }, "");
  scanLibrary();
  scene.onSave?.();
  say(`Closed ${was}. It is saved in ${where}; the Library tab opens it again.`, "ok");
}
async function openScene(file) {
  if (sameFile(file, scene.file)) return say(`${scene.name} is already open.`, "info");
  let data;
  try {
    data = readSceneFile(file);
  } catch (err) {
    return say(`${path8.basename(file)} cannot be opened: ${err.message}.`, "error");
  }
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
function newFile(name, place2, folder) {
  name = name.trim();
  if (!name) throw new Error("Give the scene a name.");
  const dir = folderIn(rootOf(place2).dir, folder);
  const file = path8.join(dir, fileNameOf(name));
  if (fs8.existsSync(file)) throw new Error(`${whereText(file)} already has a scene called ${path8.basename(file)}: open it, or pick another name.`);
  return { name, file };
}
function attempt(make) {
  try {
    return make();
  } catch (err) {
    say(err.message, "warn");
    return void 0;
  }
}
async function newScene(name, place2, folder) {
  const t = attempt(() => newFile(name, place2, folder));
  if (!t) return;
  const was = scene.name;
  await switchTo({ format: 1, name: t.name, groups: [], objects: [] }, t.file);
  scene.save();
  scanLibrary();
  say(`New scene ${t.name} in ${whereText(t.file)}.${was ? ` ${was} is saved where it was; the Library tab opens it again.` : ""}`, "ok");
}
function saveAs(name, place2, folder) {
  if (!scene.file) return say(NoScene, "warn");
  const t = attempt(() => newFile(name, place2, folder));
  if (!t) return;
  const was = scene.file;
  scene.file = t.file;
  scene.name = t.name;
  scene.save();
  writeSession();
  scanLibrary();
  say(`Saved as ${t.name} in ${whereText(t.file)}; that is the open scene now. The one before is still in ${whereText(was)}.`, "ok");
}
function renameScene(name) {
  if (!scene.file) return publish();
  name = name.trim();
  if (!name || name === scene.name) return publish();
  const was = scene.file;
  const file = path8.join(path8.dirname(was), fileNameOf(name));
  const sameName = sameFile(file, was);
  if (!sameName && fs8.existsSync(file)) return say(`${whereText(file)} already has a scene called ${path8.basename(file)}. Pick another name.`, "warn");
  scene.name = name;
  scene.file = file;
  scene.save();
  if (!sameName) {
    try {
      fs8.rmSync(was, { force: true });
    } catch (err) {
      console.log(`The old file ${was} was not removed: ${err.message}`);
    }
  }
  writeSession();
  scanLibrary();
  say(`Renamed the scene ${name}${sameName ? "" : ` (${path8.basename(file)})`}.`, "ok");
}
function saveNow() {
  scene.save();
  scanLibrary();
  say(`Saved ${scene.name} in ${whereText(scene.file)}. (EDGEbuilder saves after every change.)`, "ok");
}
async function loadOn(file) {
  if (typeof world2.load !== "function") throw new Error("Showing other scenes needs REDnode 0.40.1 or later");
  const r = await world2.load(readSceneFile(file), { name: file, wait: false, alwaysSpawned: true });
  for (const s of r.skipped) console.log(`${path8.basename(file)}: ${s.object} not shown: ${s.why}`);
  onScenes.set(file, r.spawned.length);
  return r.spawned.length;
}
async function sceneOn(file) {
  if (sameFile(file, scene.file)) return say("That is the open scene: its objects are in the world already.", "info");
  try {
    readSceneFile(file);
  } catch (err) {
    return say(`${path8.basename(file)} cannot be shown: ${err.message}.`, "error");
  }
  onScenes.set(file, 0);
  writeSession();
  if (state.world !== "ready") return say(`${path8.basename(file)} is on; it shows once a save is loaded.`, "info");
  const n = await loadOn(file);
  say(`Showing ${path8.basename(file)}: ${n} object${n === 1 ? "" : "s"}. They cannot be selected: open the scene to change it.`, "ok");
}
async function sceneOff(file) {
  const known = [...onScenes.keys()].find((f) => sameFile(f, file)) ?? file;
  onScenes.delete(known);
  writeSession();
  console.log(`No longer showing ${path8.basename(known)}`);
  if (typeof world2.unload === "function") await world2.unload(known).catch((err) => console.log(`Unload ${known}: ${err.message}`));
  publish();
}
async function reloadOn() {
  if (!onScenes.size || state.world !== "ready") return;
  let n = 0;
  for (const file of [...onScenes.keys()]) {
    if (!fs8.existsSync(file)) {
      onScenes.delete(file);
      continue;
    }
    try {
      if (inGameNow.has(slugOf(readSceneFile(file).name))) continue;
      n += await loadOn(file);
    } catch (err) {
      console.log(`${path8.basename(file)} not shown: ${err.message}`);
    }
  }
  writeSession();
  console.log(`Scenes on: ${onScenes.size}, ${n} objects placed`);
  publish();
}
function setLibraryRoot(root) {
  root = root.trim().replace(/^"(.*)"$/, "$1");
  if (!root || !path8.isAbsolute(root)) return say(`Give the Library a full folder path, such as ${suggestedRoot}.`, "warn");
  const inside = (dir) => {
    if (!dir) return false;
    const rel = path8.relative(path8.resolve(dir), path8.resolve(root));
    return !rel.startsWith("..") && !path8.isAbsolute(rel);
  };
  if (inside(gameDir()) || inside(pkg.dir) || inside(pkg.dataDir)) return say("The Library cannot be inside the game's folder or EDGEbuilder's own folders: deploys and reloads would touch it. Pick another folder.", "warn");
  try {
    writeLibraryRoot(root);
  } catch (err) {
    return say(`The Library folder could not be made: ${err.message}`, "error");
  }
  libraryRoot = path8.resolve(root);
  scanLibrary();
  say(`The Library is ${libraryRoot}. Every EDGE tool uses this folder.`, "ok");
}
function newFolder(folder, name) {
  if (!libraryRoot) return say("Set the Library folder in Settings first.", "warn");
  const root = libraryRoot;
  const dir = attempt(() => path8.join(folderIn(root, folder), cleanFolderName(name)));
  if (!dir) return;
  fs8.mkdirSync(dir, { recursive: true });
  scanLibrary();
  say(`Made the folder ${whereText(path8.join(dir, "x"))}.`, "ok");
}
function listScenes() {
  scanLibrary();
  publish();
  return state.library.shelves.flatMap(
    (sh) => sh.scenes.filter((s) => !s.error).map((s) => ({
      name: s.name,
      file: s.file,
      place: s.place,
      folder: s.folder,
      objects: sameFile(s.file, scene.file) ? scene.objects.length : s.objects,
      changed: new Date(s.changed).toISOString(),
      open: sameFile(s.file, scene.file),
      on: [...onScenes.keys()].some((f) => sameFile(f, s.file))
    }))
  );
}
function sceneRefs(which) {
  let data;
  let file = scene.file;
  if (!which && !scene.file) throw new Error("No scene is open: name one, as scenes() gives them");
  if (!which || sameFile(which, scene.file) || which.toLowerCase() === scene.name.toLowerCase()) data = scene.data();
  else {
    const all = listScenes();
    const found = all.find((s) => path8.isAbsolute(which) && sameFile(s.file, which)) ?? all.find((s) => s.name.toLowerCase() === which.toLowerCase());
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
      ...o.resource ? { resource: o.resource } : {},
      ...o.record ? { record: o.record } : {},
      ...o.appearance ? { appearance: o.appearance } : {},
      ...o.group ? { group: o.group } : {},
      position: o.transform.position,
      rotation: o.transform.rotation
    }))
  };
}
var changedTimer;
scene.onSave = () => {
  bakeSoon();
  if (typeof service?.emit !== "function") return;
  clearTimeout(changedTimer);
  changedTimer = setTimeout(() => service.emit("scene-changed", { name: scene.name, file: scene.file, objects: scene.objects.length }), 500);
};
function saveSettings(next) {
  settings = { ...settings, ...next };
  for (const k of Object.keys(settings)) if (settings[k] === void 0 || settings[k] === "") delete settings[k];
  fs8.mkdirSync(pkg.dataDir, { recursive: true });
  fs8.writeFileSync(settingsFile, JSON.stringify(settings, null, 2));
}
channel.on((m) => {
  void (async () => {
    switch (m.type) {
      case "hello":
        publish();
        break;
      case "search":
        state.query = { text: m.text, kind: m.kind, from: m.from ?? state.query.from };
        runSearch();
        break;
      case "look":
        state.looked = { path: m.path };
        if (isRecord(m.path)) {
          state.looked = { path: m.path, info: await lookAtPerson(m.path).catch((err) => ({ appearances: [], bounds: PersonBounds, error: err.message })) };
          publish();
          break;
        }
        if (!bridge?.running) state.looked.info = (sourceOf(m.path) ? void 0 : index.info[m.path]) ?? { appearances: [], error: "Size and appearances need REDbridge; it can still be dropped." };
        publish();
        if (bridge?.running) {
          try {
            state.looked = { path: m.path, info: await assetInfo(bridge, m.path) };
          } catch (err) {
            state.looked = { path: m.path, info: { appearances: [], error: err.message } };
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
        await inTurn("Ungroup", () => ungroup2(m.ids));
        break;
      case "rename":
        await inTurn("Rename", () => rename(m.group, m.name));
        break;
      case "duplicate":
        await inTurn("Copy", () => duplicate2(m.ids, m.offset));
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
        await inTurn(m.on ? "Show scene" : "Hide scene", () => m.on ? sceneOn(m.file) : sceneOff(m.file));
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
        scanLibrary();
        publish();
        break;
      case "bake":
        await inTurn("Bake", () => bakeOpenScene());
        break;
      case "bake.refresh":
        lookAtBakes();
        publish();
        break;
      case "bake.remove":
        await inTurn("Remove bake", () => removeBake2(m.slug));
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
          const bridgeChanged = "bridgePath" in m && m.bridgePath !== settings.bridgePath || "gameDir" in m && m.gameDir !== settings.gameDir;
          const next = {};
          for (const k of ["bridgePath", "gameDir", "hideHud", "editorCamera"]) if (k in m) next[k] = m[k];
          saveSettings(next);
          say(bridgeChanged ? "Settings saved; restarting REDbridge." : "Settings saved.", "info");
          if ("hideHud" in m || "editorCamera" in m) await queued(() => builderSwitches());
          if (bridgeChanged) await startBridge();
        }
        break;
    }
  })().catch((err) => say(`${m.type}: ${err.message}`, "error"));
});
var inGameNow = /* @__PURE__ */ new Map();
var BakedOff = (name, xl) => `${name} is baked and in the game (${xl}), so its previews stay off and nothing stands twice. Rebuild previews on the Scene tab brings them back to edit it.`;
function bakeProject() {
  return project ? { name: project.name, dir: project.dir, archive: project.archive, raw: project.raw, resources: project.resources } : null;
}
var needsOf = () => sceneNeeds(scene.objects.map((o) => o.resource), index.extra);
function setSolid(ids, on) {
  const meshes = ids.map((id) => scene.get(id)).filter((o) => o?.kind === "mesh");
  const none = new Set(state.noCollision);
  const change = meshes.filter((o) => on ? !o.solid && !none.has(collisionKey(o.resource)) : o.solid);
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
function setSeenFrom(ids, metres) {
  const next = streamingFor(metres);
  const objects = ids.map((id) => scene.get(id)).filter((o) => !!o && o.kind !== "npc");
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
var collisionAsked = "";
var collisionBusy = false;
async function lookAtCollision() {
  const b = bridge;
  if (!b?.running || state.bridge.status !== "ready" || collisionBusy) return;
  const paths = [...new Set(scene.objects.filter((o) => o.kind === "mesh" && o.resource).map((o) => o.resource))];
  const asked = paths.map(collisionKey).sort().join("|");
  if (asked === collisionAsked) return;
  collisionBusy = true;
  try {
    const none = [];
    for (const p of paths) {
      const info = await assetInfo(b, p).catch(() => void 0);
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
function lookAtBakes() {
  const target = bakeProject();
  const slug = slugOf(scene.name);
  const list2 = bakesIn(target);
  const current = scene.file ? list2.find((b) => b.slug === slug) : void 0;
  inGameNow = deployedBakes(gameDir());
  lookAtLibraryBakes();
  for (const r of list2) {
    const lib = r.library && state.library.bakes.find((b) => b.id === r.library.id);
    if (lib && r.library && lib.version > r.library.version) r.library = { ...r.library, latest: lib.version, dir: lib.dir };
  }
  const fromElsewhere = current?.file && !sameFile(current.file, scene.file) ? current : void 0;
  state.bake = {
    ...state.bake,
    project: target ? { name: target.name, dir: target.dir } : null,
    checks: checkBake({
      file: scene.file,
      name: scene.name,
      objects: scene.objects,
      project: target,
      bridgeReady: !!bridge?.running && state.bridge.status === "ready",
      needs: needsOf(),
      sameNameFrom: fromElsewhere ? whereText(fromElsewhere.file) : void 0,
      noCollision: new Set(state.noCollision),
      bridgeVersion: state.bridge.version
    }),
    current,
    stale: !!current?.hash && !fromElsewhere && current.hash !== bakeHash(scene.objects),
    inGame: scene.file ? inGameNow.get(slug) : void 0,
    list: list2
  };
}
var bakeSoon = debounced(() => {
  lookAtBakes();
  publish();
  void lookAtCollision();
});
async function noCollisionFor(b, objects) {
  const none = /* @__PURE__ */ new Set();
  for (const p of new Set(objects.filter((o) => o.kind === "mesh" && o.solid && o.resource).map((o) => o.resource))) {
    const info = await assetInfo(b, p).catch(() => void 0);
    if (info?.hasCollision === false) none.add(collisionKey(p));
  }
  return none;
}
function sceneToBake(file) {
  if (scene.file && sameFile(file, scene.file)) return { name: scene.name, game: scene.game, groups: scene.groups, objects: scene.objects };
  const d = readSceneFile(file);
  return { name: d.name, game: d.game, groups: d.groups ?? [], objects: d.objects };
}
async function bakeSceneInto(target, file, root) {
  const src = sceneToBake(file);
  const b = bridge;
  const { scene: input } = bakeInput(src.name, src.game, src.groups, solidForBake(src.objects, await noCollisionFor(b, src.objects)));
  const byPath = new Map(index.extra.map((e) => [e.path.toLowerCase(), e]));
  for (const o of input.objects) {
    if (o.bounds || !o.resource) continue;
    const entry = byPath.get(o.resource.replace(/\//g, "\\").toLowerCase());
    if (!entry?.source) continue;
    const info = await sources.lookAt(b, entry);
    if (info.bounds) o.bounds = info.bounds;
  }
  let built;
  try {
    built = await b.sectorBuild({ project: target.dir, scene: input, ...root ? { root } : {} });
  } catch (err) {
    if (!root || !/param|argument|signature|method/i.test(err.message)) throw err;
    built = await b.sectorBuild({ project: target.dir, scene: input });
  }
  const xl = settleXl(built.xl, built.name, built.blockPath);
  const record = {
    slug: built.name,
    name: src.name,
    file,
    hash: bakeHash(src.objects),
    objects: built.nodes,
    date: (/* @__PURE__ */ new Date()).toISOString(),
    bridge: state.bridge.version,
    box: built.streamingBox,
    needs: sceneNeeds(src.objects.map((o) => o.resource), index.extra)
  };
  writeRecord(target, record);
  console.log(`Baked ${src.name}: ${built.nodes} objects into ${target.dir} (${built.sector})${built.warnings.length ? `; ${built.warnings.length} warnings: ${built.warnings.join(" | ")}` : ""}`);
  return { built, xl, record };
}
async function bakeOpenScene() {
  await lookAtCollision();
  lookAtBakes();
  const stop = state.bake.checks.find((c) => c.tone === "error");
  if (stop) {
    publish();
    return say(stop.text, "warn");
  }
  const target = bakeProject();
  let done;
  try {
    done = await bakeSceneInto(target, scene.file, target.archive);
  } catch (err) {
    console.log(`Bake ${scene.name}: ${err.message}`);
    state.bake.last = void 0;
    lookAtBakes();
    return say(`The bake did not go through: ${err.message}`, "error");
  }
  forgetInNote(target.dir, done.built.name);
  state.bake.last = { slug: done.built.name, files: [done.built.sector, done.built.block, done.xl].map((f) => path8.relative(target.dir, f)), warnings: done.built.warnings };
  lookAtBakes();
  const n = done.built.nodes;
  say(`Baked ${scene.name}: ${n} object${n === 1 ? "" : "s"} into ${target.name}. Pack and install the project, and start the game again.`, "ok");
}
async function removeBake2(slug) {
  const target = bakeProject();
  if (!target) return say("No REDcode project is open.", "warn");
  try {
    removeBake(target, slug);
    forgetInNote(target.dir, slug);
  } catch (err) {
    return say(`${slug} could not be removed: ${err.message}`, "error");
  }
  if (state.bake.last?.slug === slug) state.bake.last = void 0;
  lookAtBakes();
  const stillIn = inGameNow.get(slug);
  say(`Took the bake ${slug} out of ${target.name}. Its scene is untouched.${stillIn ? ` It stays in the game (${stillIn}) until you pack and install the project again.` : ""}`, "ok");
}
var libraryBakeDirs = [];
var sceneHashes = /* @__PURE__ */ new Map();
function sceneNow(file) {
  if (scene.file && sameFile(file, scene.file)) return { name: scene.name, hash: bakeHash(scene.objects) };
  let st;
  try {
    st = fs8.statSync(file);
  } catch {
    return void 0;
  }
  const known = sceneHashes.get(file);
  if (known && known.size === st.size && known.mtime === st.mtimeMs) return known;
  try {
    const d = readSceneFile(file);
    const now = { size: st.size, mtime: st.mtimeMs, name: d.name, hash: bakeHash(d.objects) };
    sceneHashes.set(file, now);
    return now;
  } catch {
    return void 0;
  }
}
function lookAtLibraryBakes() {
  const root = libraryRoot ?? "";
  const versions = /* @__PURE__ */ new Map();
  if (project) for (const v2 of libraryBakesIn(project.dir).values()) versions.set(v2.id, v2.version);
  const out = [];
  for (const { dir, folder } of libraryBakeDirs) {
    let meta;
    try {
      meta = readBakeMeta(dir);
    } catch (err) {
      out.push({ dir, folder, name: path8.basename(dir), id: "", version: 0, scenes: [], inGame: false, collides: [], error: err.message });
      continue;
    }
    const scenes = meta.scenes.map((s) => {
      const file = fromLibraryPath(root, s.path);
      const now = sceneNow(file);
      return { name: s.name, slug: s.slug, file, ...now ? {} : { missing: true }, ...now && s.hash && now.hash !== s.hash ? { stale: true } : {} };
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
      ...versions.has(meta.id) ? { inProject: versions.get(meta.id) ?? 0 } : {}
    });
  }
  for (const a of out) a.collides = out.filter((b) => b !== a && b.scenes.some((s) => a.scenes.some((t) => t.slug === s.slug || sameFile(t.file, s.file)))).map((b) => b.name);
  state.library.bakes = out;
}
function libraryBakeDir(dir) {
  if (!libraryRoot) throw new Error("Set the Library folder first (Library tab or Settings).");
  const rel = path8.relative(path8.resolve(libraryRoot), path8.resolve(dir));
  if (rel.startsWith("..") || path8.isAbsolute(rel) || !dir.toLowerCase().endsWith(BakeFolderEnding)) throw new Error("That is not a bake in the Library.");
  return path8.resolve(dir);
}
async function changeLibraryBake(dir, meta, files, drop2 = []) {
  const root = libraryRoot;
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
  const warnings = [];
  const isNew = !fs8.existsSync(dir);
  fs8.mkdirSync(dir, { recursive: true });
  for (const { file } of plan) {
    let done;
    try {
      done = await bakeSceneInto(target, file, project?.archive);
    } catch (err) {
      if (isNew) fs8.rmSync(dir, { recursive: true, force: true });
      throw err;
    }
    const { record, built } = done;
    warnings.push(...built.warnings);
    const at = libraryPath(root, file);
    meta.scenes = [...meta.scenes.filter((s) => s.path !== at && s.slug !== record.slug), { name: record.name, slug: record.slug, path: at, hash: record.hash }];
  }
  for (const slug of drop2) {
    removeBake(target, slug);
    meta.scenes = meta.scenes.filter((s) => s.slug !== slug);
  }
  meta.version += 1;
  meta.date = (/* @__PURE__ */ new Date()).toISOString();
  meta.bridge = state.bridge.version;
  writeBakeMeta(dir, meta);
  scanLibrary();
  lookAtBakes();
  return warnings;
}
var warned = (w) => w.length ? ` REDbridge says: ${w.slice(0, 3).join(" ")}${w.length > 3 ? ` (and ${w.length - 3} more)` : ""}` : "";
async function newLibraryBake(file, name, folder) {
  try {
    if (!libraryRoot) throw new Error("Set the Library folder first (Library tab or Settings).");
    const src = sceneToBake(file);
    const bakeName = name.trim() || src.name;
    const dir = freeBakeDir(folderIn(libraryRoot, folder), bakeName);
    const meta = { format: 1, id: newBakeId(), name: bakeName, version: 0, scenes: [] };
    const w = await changeLibraryBake(dir, meta, [file]);
    say(`Baked ${src.name} into the Library as ${bakeName} (${libraryPath(libraryRoot, dir)}). Include it in a REDcode project to put it in the game.${warned(w)}`, "ok");
  } catch (err) {
    say(`The bake did not go through: ${err.message}`, "error");
  }
}
async function editLibraryBake(dir, what, arg) {
  try {
    dir = libraryBakeDir(dir);
    const meta = readBakeMeta(dir);
    const root = libraryRoot;
    if (what === "add") {
      const w2 = await changeLibraryBake(dir, meta, [arg]);
      return say(`${sceneToBake(arg).name} is baked into ${meta.name} (version ${meta.version}).${meta.version > 1 ? " Projects that include it can update it on their Bake tab." : ""}${warned(w2)}`, "ok");
    }
    if (what === "drop") {
      const gone2 = meta.scenes.find((s) => s.slug === arg);
      if (!gone2) return say(`${meta.name} has no scene ${arg}.`, "warn");
      await changeLibraryBake(dir, meta, [], [arg]);
      return say(`${gone2.name} is out of ${meta.name} (version ${meta.version}); the scene itself stays.${meta.scenes.length ? "" : " The bake is empty now: add a scene or delete it."}`, "ok");
    }
    const here = meta.scenes.map((s) => fromLibraryPath(root, s.path)).filter((f) => fs8.existsSync(f));
    const missing = meta.scenes.filter((s) => !fs8.existsSync(fromLibraryPath(root, s.path))).map((s) => s.name);
    if (!here.length) return say(`None of ${meta.name}'s scenes is where it was: ${missing.join(", ")}.`, "warn");
    const w = await changeLibraryBake(dir, meta, here);
    say(`Baked ${meta.name} again (version ${meta.version}).${missing.length ? ` Not found, so kept as baked before: ${missing.join(", ")}.` : ""}${warned(w)}`, missing.length ? "warn" : "ok");
  } catch (err) {
    lookAtBakes();
    say(`${what === "drop" ? "The scene could not be taken out" : "The bake did not go through"}: ${err.message}`, "error");
  }
}
async function includeLibraryBake(dir) {
  try {
    dir = libraryBakeDir(dir);
    const target = bakeProject();
    if (!target) throw new Error("No REDcode project is open. Open one in REDcode (VS Code), and include the bake there.");
    const meta = readBakeMeta(dir);
    if (!meta.scenes.length) throw new Error(`${meta.name} is empty: add a scene to it first.`);
    const clashes = includeClashes(target, meta);
    if (clashes.length) throw new Error(`${target.name} already has a bake of ${clashes.join(", ")} that is not from ${meta.name}. Take it out on the Bake tab first, or the two would overwrite each other.`);
    const before = libraryBakesIn(target.dir);
    const had = [...before.values()].find((v2) => v2.id === meta.id)?.version;
    includeBake(dir, meta, target, libraryRoot);
    lookAtBakes();
    const scenes = `${meta.scenes.length} scene${meta.scenes.length === 1 ? "" : "s"}`;
    const what = had === void 0 ? `Included ${meta.name} (version ${meta.version}, ${scenes}) in ${target.name}.` : had === meta.version ? `Copied ${meta.name} (version ${meta.version}) into ${target.name} again.` : `Updated ${meta.name} in ${target.name} from version ${had} to ${meta.version} (${scenes}).`;
    say(`${what} Pack and install the project, and start the game again.`, "ok");
  } catch (err) {
    say(`The bake was not included: ${err.message}`, "error");
  }
}
function deleteLibraryBake(dir) {
  try {
    dir = libraryBakeDir(dir);
    const name = (() => {
      try {
        return readBakeMeta(dir).name;
      } catch {
        return path8.basename(dir);
      }
    })();
    fs8.rmSync(dir, { recursive: true, force: true });
    scanLibrary();
    lookAtBakes();
    say(`Deleted the bake ${name} from the Library. Its scenes stay, and projects that included it keep their copies.`, "ok");
  } catch (err) {
    say(`The bake could not be deleted: ${err.message}`, "error");
  }
}
var linked;
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
    editorCam = void 0;
    state.camera = void 0;
    try {
      fs8.rmSync(builderFile, { force: true });
    } catch {
    }
  }
  attachedAt = Date.now();
  gone.clear();
  void setSolo(false);
  scene.forgetPreviews();
  state.selected = [];
  void checkWorld().then(() => {
    void inTurn("Show scenes that are on", () => reloadOn());
    previewsBackSoon();
  });
});
var attachedAt = 0;
var LoadSettles = 9e4;
var gone = /* @__PURE__ */ new Map();
world2.on("Entity/Detach", (e) => {
  const o = scene.objects.find((x) => x.entityId === e.entityId);
  if (o) {
    if (e.entityId) gone.set(e.entityId, { id: o.id, selected: state.selected.includes(o.id) });
    delete o.entityId;
    state.selected = state.selected.filter((id) => id !== o.id);
    publish();
    if (Date.now() - attachedAt < LoadSettles) {
      console.log(`${o.id} left the world while the save was loading: it comes back in a moment`);
      previewsBackSoon();
    }
  }
});
if (typeof world2.onRespawn === "function") {
  world2.onRespawn((before, after) => {
    const was = gone.get(before.hash);
    gone.delete(before.hash);
    const o = scene.get(was?.id) ?? scene.objects.find((x) => x.entityId === before.hash);
    if (!o) return;
    o.entityId = after.hash;
    console.log(`${o.id} spawned again after an archive swap (${after.hash})`);
    void movePreview(o, o.transform.position, o.transform.rotation).catch((err) => console.log(`${o.id} not moved back after the swap: ${err.message}`)).then(() => was?.selected ? select([...state.selected, o.id]) : publish());
  });
}
if (typeof ui?.onSolo === "function") {
  ui.onSolo((on) => {
    soloOn = on;
    if (!on && builderOn) console.log("Solo mode ended from the launcher; Edit stays on");
  });
}
console.log(`EDGEbuilder ${"0.10.6"} starting; data folder ${pkg.dataDir}; ${scene.file ? `scene ${scene.name} (${scene.file}), ${scene.objects.length} objects` : "no scene open"}; ${onScenes.size} other scene${onScenes.size === 1 ? "" : "s"} on; Library ${libraryRoot ?? "not set"}`);
if (!fs8.existsSync(scene.file) && !scene.loadError) scene.save();
scanLibrary();
if (lastGone) {
  state.message = { text: `The scene open last time (${lastGone}) is no longer there; opened ${scene.name} instead.`, tone: "warn" };
  console.log(state.message.text);
}
writeSession();
if (scene.loadError) {
  state.message = { text: `The scene file could not be read (${scene.loadError}). ${scene.setAside ? `It was kept as ${path8.basename(scene.setAside)}; ` : ""}starting with an empty scene.`, tone: "warn" };
  console.log(state.message.text);
}
if (index.loadNewest()) {
  state.index = { status: "ready", count: index.entries.length, file: index.file, progress: "From the last time REDbridge read the game" };
  runSearch();
}
publish();
void checkWorld();
void startBridge();
watchMods();
void connectRedcode();
export {
  listScenes,
  sceneRefs
};
