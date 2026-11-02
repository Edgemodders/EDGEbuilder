// Built from src/ by build.mjs; edit the TypeScript, not this file.

// src/mod.ts
import * as fs5 from "node:fs";
import * as path5 from "node:path";
import { api, channel, game, kernel, pkg, service, ui, world } from "rednode";

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
  meshInfoMany(paths, from) {
    return this.call("mesh.infoMany", { paths, ...from });
  }
  openMod(archivePath) {
    return this.call("archive.openMod", { path: archivePath });
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
    const pools = from === "game" ? [this.entries] : from === "all" ? [this.extra, this.entries] : [this.extra];
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
  /** How well an entry matches every term: 2 for the file name, 1 for the path or the source's name; -1 when a term misses. */
  score(e, terms) {
    const lower = e.path.toLowerCase();
    const name = lower.slice(lower.lastIndexOf("\\") + 1);
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
function unique(entries) {
  const seen = /* @__PURE__ */ new Set();
  return entries.filter((e) => {
    const key = e.path.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
function kindOf(file) {
  const lower = file.toLowerCase();
  if (lower.endsWith(".mesh")) return "mesh";
  if (lower.endsWith(".ent")) return "entity";
  return void 0;
}

// src/sources.ts
import * as fs3 from "node:fs";
import * as path3 from "node:path";
var NeedsNewerBridge = "Its size and appearances need REDbridge 0.12.0 or later (EDGEdeck: Get REDbridge); it can still be dropped, with a 1 m box for the gizmo.";
function modArchives(gameDir2) {
  const out = [];
  const loose = path3.join(gameDir2, "archive", "pc", "mod");
  for (const f of list(loose)) if (f.toLowerCase().endsWith(".archive")) out.push({ file: path3.join(loose, f), mod: f.slice(0, -".archive".length) });
  const redmods = path3.join(gameDir2, "mods");
  for (const m of list(redmods)) {
    const dir = path3.join(redmods, m, "archives");
    for (const f of list(dir)) if (f.toLowerCase().endsWith(".archive")) out.push({ file: path3.join(dir, f), mod: m });
  }
  return out;
}
function modFolders(gameDir2) {
  return [path3.join(gameDir2, "archive", "pc", "mod"), path3.join(gameDir2, "mods")];
}
function list(dir) {
  try {
    return fs3.readdirSync(dir);
  } catch {
    return [];
  }
}
var ModSources = class {
  constructor(cacheFile) {
    this.cacheFile = cacheFile;
    try {
      const data = JSON.parse(fs3.readFileSync(cacheFile, "utf8"));
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
  async refreshMods(bridge2, files, isGamePath, progress) {
    let changed = false;
    const failed = [];
    const seen = /* @__PURE__ */ new Set();
    for (const { file, mod } of files) {
      seen.add(file);
      let stat;
      try {
        stat = fs3.statSync(file);
      } catch {
        continue;
      }
      const known = this.archives[file];
      if (known && known.size === stat.size && known.mtime === stat.mtimeMs && known.mod === mod) continue;
      progress?.(`Reading ${path3.basename(file)}`);
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
        failed.push(`${path3.basename(file)}: ${err.message}`);
      }
    }
    for (const file of Object.keys(this.archives)) {
      if (!seen.has(file)) {
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
        names = fs3.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const d of names) {
        const full = path3.join(dir, d.name);
        const gamePath = rel ? `${rel}\\${d.name}` : d.name;
        if (d.isDirectory()) walk(full, gamePath);
        else {
          const kind = kindOf(d.name);
          if (!kind) continue;
          let size = 0;
          try {
            size = fs3.statSync(full).size;
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
      if (known && !known.error) return known;
    } else {
      let mtime = 0;
      try {
        mtime = fs3.statSync(from.file).mtimeMs;
      } catch {
        return { appearances: [], error: `${entry.path} is no longer in the project` };
      }
      key = `${from.file}|${mtime}`;
      cache = this.projectInfo;
      const known = cache.get(key);
      if (known && !known.error) return known;
    }
    let info;
    try {
      const [r] = await bridge2.meshInfoMany([entry.path], from.kind === "mod" ? { archive: from.file } : { root: this.projectRoot });
      if (r?.error && /not in the loaded archives/i.test(r.error)) info = { appearances: [], error: NeedsNewerBridge };
      else info = r?.error ? { appearances: [], error: r.error } : { bounds: r?.bounds ?? void 0, appearances: r?.appearances ?? [] };
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
      fs3.mkdirSync(path3.dirname(this.cacheFile), { recursive: true });
      const data = { format: 1, archives: this.archives };
      fs3.writeFileSync(this.cacheFile, JSON.stringify(data));
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

// src/scene.ts
import * as fs4 from "node:fs";
import * as path4 from "node:path";

// src/math.ts
var add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
var sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
var mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
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
  const seen = /* @__PURE__ */ new Set();
  for (let g = groups.find((x) => x.id === id); g && !seen.has(g.id); g = groups.find((x) => x.id === g.parent)) {
    seen.add(g.id);
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
    const copy = JSON.parse(JSON.stringify(rest));
    copy.id = id;
    copy.transform.position = add(o.transform.position, offset);
    const group2 = o.group && groupMap.get(o.group);
    if (group2) copy.group = group2;
    copies.push(copy);
  }
  return { objects: copies, groups: newGroups };
}

// src/scene.ts
var Scene = class {
  constructor(file) {
    this.file = file;
  }
  name = "Working scene";
  objects = [];
  groups = [];
  /** Where an unreadable scene file was moved, so the next save does not overwrite it. */
  setAside;
  load() {
    let text;
    try {
      text = fs4.readFileSync(this.file, "utf8");
    } catch {
      return false;
    }
    try {
      const data = JSON.parse(text);
      if (data.format !== 1 || !Array.isArray(data.objects)) throw new Error(`not a format 1 scene`);
      this.name = data.name || this.name;
      this.objects = data.objects.map((o) => ({ ...o }));
      this.groups = Array.isArray(data.groups) ? data.groups.map((g) => ({ id: g.id, name: g.name, parent: g.parent ?? null })) : [];
      for (const o of this.objects) if (o.group && !this.groups.some((g) => g.id === o.group)) delete o.group;
      return true;
    } catch (err) {
      this.setAside = `${this.file}.unreadable-${(/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-")}`;
      try {
        fs4.renameSync(this.file, this.setAside);
      } catch {
        this.setAside = void 0;
      }
      this.loadError = err.message;
      return false;
    }
  }
  loadError;
  save() {
    fs4.mkdirSync(path4.dirname(this.file), { recursive: true });
    const data = {
      format: 1,
      name: this.name,
      groups: this.groups,
      objects: this.objects.map(({ entityId: _live, ...rest }) => rest)
    };
    fs4.writeFileSync(this.file, JSON.stringify(data, null, 2));
  }
  add(kind, resource, transform, appearance) {
    const base = resource ? path4.basename(resource).replace(/\.[^.]+$/, "").replace(/[^a-z0-9_-]+/gi, "_").toLowerCase() : kind;
    const id = freshId(base, new Set(this.objects.map((o2) => o2.id)));
    const o = { id, kind, resource, appearance, transform };
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
      if (was.kind !== o.kind || was.resource !== o.resource || was.appearance !== o.appearance || !same(was.transform.scale, o.transform.scale)) out.respawn.push(o);
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
function yawToQuaternion(yawDegrees) {
  const half = yawDegrees * Math.PI / 360;
  return [0, 0, Math.sin(half), Math.cos(half)];
}

// src/mod.ts
var EmptyEntity = "base\\gameplay\\loot\\containers\\common_suitcases\\appearances\\suitcase_small_placeholder.ent";
var SpawnDistance = 3;
var ResultLimit = 120;
var settingsFile = path5.join(pkg.dataDir, "settings.json");
var settings = {};
try {
  settings = JSON.parse(fs5.readFileSync(settingsFile, "utf8"));
} catch {
}
var scene = new Scene(path5.join(pkg.dataDir, "scenes", "working.scene.json"));
scene.load();
var past = [];
var future = [];
var HistoryLength = 100;
var duplicates = 0;
var index = new AssetIndex(path5.join(pkg.dataDir, "index"));
var sources = new ModSources(path5.join(pkg.dataDir, "sources", "mods.json"));
index.extra = sources.entries();
var bridge;
var blockedRetry;
var ownBridge;
var gameKey = "";
var state = {
  ready: true,
  world: "unknown",
  bridge: { status: "off" },
  index: { status: "none", count: 0 },
  results: [],
  query: { text: "", kind: "all", from: "all" },
  sources: { mods: { archives: sources.archiveCount, assets: sources.modAssets }, project: null },
  scene: { name: scene.name, objects: scene.objects, groups: scene.groups, file: scene.file, needs: [] },
  selected: [],
  history: { undo: 0, redo: 0 },
  settings: { ...settings, settingsFile },
  inUse: {}
};
function publish() {
  state.scene = { name: scene.name, objects: scene.objects, groups: scene.groups, file: scene.file, needs: sceneNeeds(scene.objects.map((o) => o.resource), index.extra) };
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
    dir = path5.dirname(dir);
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
      modWatchers.push(fs5.watch(folder, { recursive: true }, changed));
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
        projectWatch = fs5.watch(next.archive, { recursive: true }, projectChanged);
      } catch {
      }
      console.log(`REDcode project: ${next.name} (${next.archive})`);
    } else if (project) {
      console.log("REDcode project closed");
    }
  }
  project = next;
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
  const away = scene.objects.filter((o) => !o.entityId && o.kind !== "light").length;
  if (state.world === "ready" && before !== "ready" && away) {
    say(`${away} object${away === 1 ? " is" : "s are"} in the scene but not in the world. Press Rebuild previews in the Scene tab to place ${away === 1 ? "it" : "them"}, or delete ${away === 1 ? "it" : "them"} there.`, "info");
    return;
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
async function dropPlace(at) {
  if (at) {
    const { hit } = await raycast(at.origin, add(at.origin, mul(at.dir, 200)));
    if (!hit) console.log("Drop at click: nothing there within 200 m; dropping 8 m along the line");
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
    ({ id } = await world.spawn({ mesh: o.resource, meshAppearance: o.appearance ?? "default", scale: { x: sx, y: sy, z: sz }, position, orientation, tags: ["edgebuilder"] }));
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
var toPoint = (p) => ({ x: p[0], y: p[1], z: p[2] });
var toQuat = (q) => ({ i: q[0], j: q[1], k: q[2], r: q[3] });
async function place(o, t) {
  if (o.kind !== "mesh") t = { ...t, scale: [1, 1, 1] };
  const scaled = t.scale.some((s, i) => Math.abs(s - o.transform.scale[i]) > 1e-6);
  o.transform = t;
  if (!o.entityId) return;
  if (scaled) await respawn(o);
  else await world.move(o.entityId, toPoint(t.position), toQuat(t.rotation));
}
async function respawn(o) {
  await removePreview(o);
  await trySpawn(o);
  if (state.selected.includes(o.id)) await highlight(o, true);
}
async function trySpawn(o) {
  if (o.kind === "light" || state.world !== "ready") return false;
  try {
    await spawnPreview(o);
    return true;
  } catch (err) {
    console.log(`Preview of ${o.id}: ${err.message}`);
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
  for (const o of ch.move) await world.move(o.entityId, toPoint(o.transform.position), toQuat(o.transform.rotation)).catch(() => void 0);
  let back = 0;
  for (const o of ch.spawn) if (await trySpawn(o)) back++;
  scene.save();
  const moved = ch.move.length + ch.respawn.length;
  const what = [
    moved ? `${moved} moved back` : "",
    ch.spawn.length ? `${ch.spawn.length} back${back < ch.spawn.length ? ` (${ch.spawn.length - back} not in the world: Rebuild previews)` : ""}` : "",
    ch.gone.length ? `${ch.gone.length} taken out` : ""
  ].filter(Boolean);
  state.message = { text: `${word}${what.length ? `: ${what.join(", ")}` : ""}.`, tone: "ok" };
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
  if (!items.length) return say(objects.length === 1 ? "Nothing below to drop onto within 100 m." : "Nothing below any of them to drop onto within 100 m.", "warn");
  await setTransforms(items);
  const missed = objects.length - items.length;
  if (objects.length === 1) say(`Dropped ${objects[0].id} to the floor, ${fell.toFixed(2)} m down.`, "ok");
  else say(`Dropped ${items.length} objects to the floor${missed ? `; ${missed} had nothing below within 100 m` : ""}.`, missed ? "warn" : "ok");
}
async function floorUnder(o) {
  const [x, y, z] = o.transform.position;
  const lowest = (o.bounds?.min[2] ?? 0) * o.transform.scale[2];
  const startZ = z + lowest + 0.05;
  const { hit, tried } = await raycast([x, y, startZ], [x, y, startZ - 100]);
  const floor = hit?.[2];
  console.log(`Drop to floor ${o.id} from z ${startZ.toFixed(2)}: ${tried.join("; ")}`);
  return floor === void 0 ? void 0 : { ...o.transform, position: [x, y, floor - lowest] };
}
var builderFile = path5.join(pkg.dataDir, "builder-mode.json");
var CameraName = "edgebuilder_camera";
var HudHiddenTier = 4;
var editorCam;
var tierWatch;
function readBuilderRecord() {
  try {
    return JSON.parse(fs5.readFileSync(builderFile, "utf8"));
  } catch {
    return void 0;
  }
}
function writeBuilderRecord(r) {
  fs5.mkdirSync(pkg.dataDir, { recursive: true });
  fs5.writeFileSync(builderFile, JSON.stringify(r));
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
function inTurn(op) {
  const run = async () => op();
  sceneQueue = sceneQueue.then(run, run);
  return sceneQueue;
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
  const { id, entity } = await world.spawn({ template: EmptyEntity, position: toPoint(pose.position), orientation: toQuat(pose.rotation), components: [component], tags: ["edgebuilder", CameraName] });
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
      await world.remove(camId);
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
    fs5.rmSync(builderFile, { force: true });
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
  const kind = kindOf(assetPath);
  if (!kind) return say(`${assetPath} is not a mesh or an entity template.`, "warn");
  if (state.world !== "ready") await checkWorld();
  if (state.world !== "ready") return say(worldBlocker(), "warn");
  let added;
  const before = scene.state();
  try {
    const place2 = await dropPlace(at);
    const o = scene.add(kind, assetPath, { position: place2.position, rotation: yawToQuaternion(place2.yaw), scale: [1, 1, 1] }, appearance);
    added = o;
    let sized = true;
    if (bridge?.running) {
      try {
        const info = await assetInfo(bridge, assetPath);
        if (info.bounds) o.bounds = info.bounds;
        else sized = false;
      } catch {
      }
    }
    const started = Date.now();
    await spawnPreview(o);
    scene.save();
    step(before);
    await select([o.id]);
    const from = sourceOf(assetPath)?.source;
    const note = from?.kind === "project" ? await inGameArchives(assetPath) ? ` From the REDcode project ${from.name}, at a game file's path: the game shows its own version until the project is packed and loaded (REDcode's Pack and Play).` : ` From the REDcode project ${from.name}: the game shows it once the project is packed and loaded (REDcode's Pack and Play).` : from?.kind === "mod" ? ` From ${from.name}.${sized ? "" : " Its size is not known, so the gizmo uses a 1 m box."}` : "";
    say(`Dropped ${path5.basename(assetPath)} in ${Date.now() - started} ms.${note}`, "ok");
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
  if (!scene.objects.length && !scene.groups.length) return say("The scene is already empty.", "info");
  step();
  for (const o of scene.objects) await removePreview(o);
  scene.clear();
  state.selected = [];
  say("Scene cleared. Undo brings it back.", "ok");
}
function saveSettings(next) {
  settings = { ...settings, ...next };
  for (const k of Object.keys(settings)) if (settings[k] === void 0 || settings[k] === "") delete settings[k];
  fs5.mkdirSync(pkg.dataDir, { recursive: true });
  fs5.writeFileSync(settingsFile, JSON.stringify(settings, null, 2));
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
        await inTurn(() => drop(m.path, m.appearance, m.at));
        break;
      case "select":
        await inTurn(() => select(m.ids));
        break;
      case "delete":
        await inTurn(() => remove(m.ids));
        break;
      case "group":
        await inTurn(() => group(m.ids));
        break;
      case "ungroup":
        await inTurn(() => ungroup2(m.ids));
        break;
      case "rename":
        await inTurn(() => rename(m.group, m.name));
        break;
      case "duplicate":
        await inTurn(() => duplicate2(m.ids, m.offset));
        break;
      case "undo":
        await inTurn(() => travel(past, future, "Undo"));
        break;
      case "redo":
        await inTurn(() => travel(future, past, "Redo"));
        break;
      case "rebuild":
        await inTurn(() => rebuild());
        break;
      case "clear":
        await inTurn(() => clear());
        break;
      case "index.build":
        await buildIndex();
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
        await inTurn(() => setTransforms(m.items, m.merge));
        break;
      case "floor":
        await inTurn(() => dropToFloor(m.ids));
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
var linked;
game.onState((s) => {
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
      fs5.rmSync(builderFile, { force: true });
    } catch {
    }
  }
  gone.clear();
  void setSolo(false);
  scene.forgetPreviews();
  state.selected = [];
  void checkWorld().then(() => {
    if (scene.objects.length) say(`A save loaded. ${scene.objects.length} object${scene.objects.length === 1 ? "" : "s"} in the scene; press Rebuild previews to see them.`, "info");
  });
});
var gone = /* @__PURE__ */ new Map();
world.on("Entity/Detach", (e) => {
  const o = scene.objects.find((x) => x.entityId === e.entityId);
  if (o) {
    if (e.entityId) gone.set(e.entityId, { id: o.id, selected: state.selected.includes(o.id) });
    delete o.entityId;
    state.selected = state.selected.filter((id) => id !== o.id);
    publish();
  }
});
if (typeof world.onRespawn === "function") {
  world.onRespawn((before, after) => {
    const was = gone.get(before.hash);
    gone.delete(before.hash);
    const o = scene.get(was?.id) ?? scene.objects.find((x) => x.entityId === before.hash);
    if (!o) return;
    o.entityId = after.hash;
    console.log(`${o.id} spawned again after an archive swap (${after.hash})`);
    void world.move(after.hash, toPoint(o.transform.position), toQuat(o.transform.rotation)).catch((err) => console.log(`${o.id} not moved back after the swap: ${err.message}`)).then(() => was?.selected ? select([...state.selected, o.id]) : publish());
  });
}
if (typeof ui?.onSolo === "function") {
  ui.onSolo((on) => {
    soloOn = on;
    if (!on && builderOn) console.log("Solo mode ended from the launcher; Edit stays on");
  });
}
console.log(`EDGEbuilder ${"0.5.2"} starting; data folder ${pkg.dataDir}; ${scene.objects.length} objects in the working scene`);
if (scene.loadError) {
  state.message = { text: `The scene file could not be read (${scene.loadError}). ${scene.setAside ? `It was kept as ${path5.basename(scene.setAside)}; ` : ""}starting with an empty scene.`, tone: "warn" };
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
