// Built from src/ by build.mjs; edit the TypeScript, not this file.

// src/cli.ts
import * as fs3 from "node:fs";
import * as path3 from "node:path";

// src/bake.ts
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

// src/math.ts
var add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
var mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
var cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
function qRotate(q, v) {
  const u = [q[0], q[1], q[2]];
  const t = mul(cross(u, v), 2);
  return add(add(v, mul(t, q[3])), cross(u, t));
}

// src/arrange.ts
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

// src/scenes.ts
function slugOf(name) {
  return name.trim().toLowerCase().replace(/[^a-z0-9]/g, "_").replace(/^_+|_+$/g, "") || "scene";
}
function refOf(sceneName, o) {
  return o.ref ?? `edgebuilder/${slugOf(sceneName)}/${o.id}`;
}

// src/bake.ts
var Bakeable = /* @__PURE__ */ new Set(["mesh", "entity", "light"]);
function bakeInput(name, game, groups, objects) {
  const kept = objects.filter((o) => Bakeable.has(o.kind));
  return {
    scene: {
      format: 1,
      name,
      ...game ? { game } : {},
      groups,
      // A writer's own `meta` (G1) is never baked.
      objects: kept.map(({ entityId: _entityId, meta: _meta, ...o }) => o)
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
function bakeRemovals(edits = []) {
  const named = edits.filter((e) => e.action === "remove" && e.node.sector);
  const removalsAsked = edits.filter((e) => e.action === "remove");
  return {
    removals: named.map((e) => ({ sector: e.node.sector, index: e.node.entry, kind: e.node.type, ...e.node.globalId ? { hash: e.node.globalId } : {} })),
    unnamed: removalsAsked.filter((e) => !named.includes(e))
  };
}
function bakeHash(objects, edits = []) {
  const parts = objects.filter((o) => Bakeable.has(o.kind)).map((o) => [o.id, o.kind, o.resource ?? "", o.appearance ?? "", o.transform, o.streaming ?? null, o.ref ?? "", o.props ?? null, ...o.kind === "mesh" && o.solid ? ["solid"] : []]);
  const removals = edits.filter((e) => e.action === "remove").map((e) => [e.action, e.node.sector.toLowerCase(), e.node.entry, e.node.type]);
  return createHash("sha256").update(JSON.stringify(removals.length ? [parts, removals] : parts)).digest("hex").slice(0, 16);
}
function settleXl(xlFile, slug, blockPath) {
  const text = fs.readFileSync(xlFile, "utf8");
  if (/^streaming:/m.test(text)) return xlFile;
  const file = path.join(path.dirname(xlFile), `${slug}.archive.xl`);
  fs.writeFileSync(file, `# Written by EDGEbuilder: adds the baked sector to the world.
streaming:
  blocks:
    - ${blockPath}
`);
  if (path.resolve(file) !== path.resolve(xlFile)) fs.rmSync(xlFile, { force: true });
  return file;
}
var recordFile = (project, slug) => path.join(project.raw, "edgebuilder", `${slug}.bake.json`);
function writeRecord(project, record) {
  const file = recordFile(project, record.slug);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(record, null, 2));
}
function bakeFilesOf(slug) {
  return [
    `source/archive/edgebuilder/${slug}/${slug}.streamingsector`,
    `source/archive/edgebuilder/${slug}/${slug}.streamingblock`,
    `source/resources/archive/pc/mod/${slug}.archive.xl`,
    `source/raw/edgebuilder/${slug}.bake.json`
  ];
}
var noteFile = (projectDir) => path.join(projectDir, "source", "library.json");
function readNote(projectDir) {
  try {
    const data = JSON.parse(fs.readFileSync(noteFile(projectDir), "utf8"));
    if (Array.isArray(data?.items)) return { ...data, format: 1, items: data.items };
  } catch {
  }
  return { format: 1, items: [] };
}
function writeNote(projectDir, note) {
  fs.mkdirSync(path.dirname(noteFile(projectDir)), { recursive: true });
  fs.writeFileSync(noteFile(projectDir), JSON.stringify(note, null, 2));
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

// src/bridge.ts
import { spawn } from "node:child_process";
import * as fs2 from "node:fs";
import * as path2 from "node:path";
var BridgeError = class extends Error {
};
var BridgeClient = class {
  constructor(exe, gameDir, dotnetRoot = defaultDotnetRoot()) {
    this.exe = exe;
    this.gameDir = gameDir;
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
    return new Promise((resolve3, reject) => {
      this.pending.set(id, { resolve: resolve3, reject });
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
  const root = path2.join(process.env.LOCALAPPDATA ?? "", "Microsoft", "dotnet");
  try {
    const has10 = fs2.readdirSync(path2.join(root, "shared", "Microsoft.NETCore.App")).some((v) => v.startsWith("10."));
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
  if (setting && fs2.existsSync(setting)) return setting;
  const appData = process.env.APPDATA ?? "";
  for (const code of ["Code", "Code - Insiders", "VSCodium"]) {
    const dir = path2.join(appData, code, "User", "globalStorage", "edgemodders.edgedeck", "bridge");
    try {
      const tags = fs2.readdirSync(dir).filter((t) => fs2.existsSync(path2.join(dir, t, "REDbridge.exe")));
      tags.sort(compareTags);
      if (tags.length) return path2.join(dir, tags[0], "REDbridge.exe");
    } catch {
    }
  }
  return void 0;
}
function isGameFolder(dir) {
  return !!dir && fs2.existsSync(path2.join(dir, "bin", "x64", "Cyberpunk2077.exe"));
}

// src/schema.ts
var Site = "https://edgemodders.github.io/EDGEbuilder/schema";
var vec = (n, what) => ({ type: "array", items: { type: "number" }, minItems: n, maxItems: n, description: what });
function sceneSchema(format) {
  const kinds = format === 1 ? ["mesh", "entity", "light"] : ["mesh", "entity", "light", "npc"];
  const object = {
    type: "object",
    required: ["id", "kind", "transform"],
    properties: {
      id: { type: "string", pattern: "^[A-Za-z0-9_-]+$", description: "Unique in the scene. The writer's own: EDGEbuilder never renames it." },
      kind: { enum: kinds },
      resource: { type: "string", minLength: 1, description: "The game path of the mesh or entity template. Forward or backward slashes." },
      ...format >= 2 ? { record: { type: "string", minLength: 1, description: "A person's TweakDB record, Character.*" } } : {},
      appearance: { type: "string" },
      solid: { type: "boolean", description: "A mesh that stops V, bullets and cars once baked. Absent means not solid." },
      transform: {
        type: "object",
        required: ["position", "rotation", "scale"],
        properties: {
          position: vec(3, "x, y, z in metres, world space: X east, Y north, Z up"),
          rotation: vec(4, "A quaternion x, y, z, w"),
          scale: vec(3, "x, y, z")
        }
      },
      streaming: {
        type: "object",
        properties: { primary: { type: "number", exclusiveMinimum: 0 }, secondary: { type: "number", exclusiveMinimum: 0 } },
        description: "How far off the baked object is seen, in metres. The game hides it beyond either distance."
      },
      ref: { type: "string", minLength: 1, description: "The node reference, unique in the scene. edgebuilder/<scene>/<id> when missing." },
      bounds: {
        type: "object",
        required: ["min", "max"],
        properties: { min: vec(3, "The file's local box, lowest corner"), max: vec(3, "The file's local box, highest corner") },
        description: "The resource's local bounding box. With it, a bake does not need the file on the PC that bakes."
      },
      group: { type: "string" },
      props: { type: "object", description: "The kind's own fields." },
      meta: { description: "The writer's own. Kept untouched, copied to a duplicate, never read, never baked." }
    },
    allOf: [
      { if: { properties: { kind: { enum: ["mesh", "entity"] } } }, then: { required: ["resource"] } },
      ...format >= 2 ? [{ if: { properties: { kind: { const: "npc" } } }, then: { oneOf: [{ required: ["record"] }, { required: ["resource"] }] } }] : []
    ]
  };
  const nodeRef = {
    type: "object",
    required: ["sectorHash", "entry"],
    properties: {
      sector: { type: "string" },
      sectorHash: { type: "string" },
      entry: { type: "integer", minimum: 0 },
      node: { type: "integer", minimum: 0 },
      type: { type: "string" },
      globalId: { type: "string" }
    }
  };
  const doorState = { type: "object", properties: { open: { type: "boolean" }, locked: { type: "boolean" }, closesItself: { type: "boolean" } } };
  const worldEdit = {
    type: "object",
    required: ["id", "action", "node"],
    properties: {
      id: { type: "string", minLength: 1 },
      action: { enum: ["remove", "door"] },
      what: { enum: ["door", "fakeDoor", "mesh"] },
      label: { type: "string" },
      node: { $ref: "#/$defs/nodeRef" },
      fingerprint: { type: "object", properties: { resource: { type: "string" }, appearance: { type: "string" }, position: vec(3, "Where the node is") } },
      proxies: { type: "array", items: { $ref: "#/$defs/nodeRef" } },
      ref: { type: "string" },
      door: { $ref: "#/$defs/doorState" },
      before: { $ref: "#/$defs/doorState" }
    },
    allOf: [{ if: { properties: { action: { const: "door" } } }, then: { required: ["door"] } }]
  };
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: `${Site}/scene-${format}.schema.json`,
    title: `EDGEbuilder scene, format ${format}`,
    description: "A scene file as EDGEbuilder reads, writes and bakes it. Fields the schema does not name are allowed: a later EDGEbuilder may add optional ones within a format. https://edgemodders.github.io/EDGEbuilder/scene.html",
    type: "object",
    required: ["format", "name", "objects"],
    properties: {
      format: { const: format },
      name: { type: "string", minLength: 1 },
      game: { type: "string", description: "The game version the scene was made against, for information." },
      generator: {
        type: "object",
        required: ["name"],
        properties: { name: { type: "string" }, version: { type: ["string", "number"] }, build: { type: ["string", "number"] } },
        description: "The program that wrote the file. Kept by EDGEbuilder when it saves."
      },
      groups: {
        type: "array",
        items: { type: "object", required: ["id", "name"], properties: { id: { type: "string", minLength: 1 }, name: { type: "string" }, parent: { type: ["string", "null"] } } }
      },
      objects: { type: "array", items: { $ref: "#/$defs/object" } },
      ...format === 3 ? { worldEdits: { type: "array", items: { $ref: "#/$defs/worldEdit" } } } : {}
    },
    $defs: { object, ...format === 3 ? { nodeRef, doorState, worldEdit } : {} }
  };
}
var typeOf = (v) => v === null ? "null" : Array.isArray(v) ? "array" : typeof v === "number" && Number.isInteger(v) ? "integer" : typeof v;
function validate(schema, value, limit = 200) {
  const out = [];
  const defs = schema.$defs ?? {};
  const walk = (s, v, at, into) => {
    if (into.length >= limit) return;
    const say = (text) => {
      into.push({ path: at || "the file", text });
    };
    if (typeof s.$ref === "string") return walk(defs[s.$ref.replace("#/$defs/", "")], v, at, into);
    const t = typeOf(v);
    if (s.type !== void 0) {
      const want = Array.isArray(s.type) ? s.type : [s.type];
      if (!want.includes(t) && !(t === "integer" && want.includes("number"))) return say(`is ${t === "array" || t === "object" || t === "integer" ? "an" : "a"} ${t}, not ${want.join(" or ")}`);
    }
    if ("const" in s && v !== s.const) return say(`is ${JSON.stringify(v)}, not ${JSON.stringify(s.const)}`);
    if (Array.isArray(s.enum) && !s.enum.includes(v)) return say(`is ${JSON.stringify(v)}, not one of ${s.enum.join(", ")}`);
    if (typeof v === "string") {
      if (typeof s.minLength === "number" && v.length < s.minLength) say("is empty");
      if (typeof s.pattern === "string" && !new RegExp(s.pattern).test(v)) say(`${JSON.stringify(v)} does not match ${s.pattern}`);
    }
    if (typeof v === "number") {
      if (typeof s.minimum === "number" && v < s.minimum) say(`is ${v}, below ${s.minimum}`);
      if (typeof s.exclusiveMinimum === "number" && v <= s.exclusiveMinimum) say(`is ${v}, not above ${s.exclusiveMinimum}`);
    }
    if (Array.isArray(v)) {
      if (typeof s.minItems === "number" && v.length < s.minItems) say(`has ${v.length} numbers, not ${s.minItems}`);
      else if (typeof s.maxItems === "number" && v.length > s.maxItems) say(`has ${v.length} numbers, not ${s.maxItems}`);
      if (s.items) v.forEach((item, i) => walk(s.items, item, `${at}[${i}]`, into));
    }
    if (t === "object") {
      const o = v;
      for (const key of s.required ?? []) if (!(key in o)) say(`has no ${key}`);
      for (const [key, sub2] of Object.entries(s.properties ?? {})) if (key in o) walk(sub2, o[key], at ? `${at}.${key}` : key, into);
    }
    for (const sub2 of s.allOf ?? []) walk(sub2, v, at, into);
    if (Array.isArray(s.oneOf)) {
      const passing = s.oneOf.filter((sub2) => {
        const errs = [];
        walk(sub2, v, at, errs);
        return errs.length === 0;
      }).length;
      if (passing !== 1) say(`needs exactly one of: ${s.oneOf.map((sub2) => (sub2.required ?? []).join(" and ")).join("; ")}`);
    }
    if (s.if && s.then) {
      const errs = [];
      walk(s.if, v, at, errs);
      if (errs.length === 0) walk(s.then, v, at, into);
    }
  };
  walk(schema, value, "", out);
  return out;
}
function knownFields(format) {
  const s = sceneSchema(format);
  const object = s.$defs.object;
  return { top: Object.keys(s.properties), object: Object.keys(object.properties), group: ["id", "name", "parent"] };
}

// src/worldedits.ts
function readableEdits(edits) {
  if (!Array.isArray(edits)) return [];
  return edits.filter(
    (e) => !!e && typeof e === "object" && (e.action === "remove" || e.action === "door" && typeof e.door === "object") && typeof e.node?.sectorHash === "string" && Number.isInteger(e.node?.entry)
  );
}

// src/check.ts
var Findings = class {
  list = [];
  byKey = /* @__PURE__ */ new Map();
  add(code, text, more = {}) {
    const key = `${code}
${text}
${more.file ?? ""}`;
    let f = this.byKey.get(key);
    if (!f) {
      f = { code, text, ...more.file ? { file: more.file } : {} };
      this.byKey.set(key, f);
      this.list.push(f);
    }
    if (more.id !== void 0) (f.ids ??= []).push(more.id);
    if (more.among !== void 0 && !f.files?.includes(more.among)) (f.files ??= []).push(more.among);
  }
};
function checkSceneData(data) {
  const errors = new Findings();
  const warnings = new Findings();
  const dropped = [];
  const done = () => ({ errors: errors.list, warnings: warnings.list, dropped });
  const d = data;
  if (!d || typeof d !== "object" || Array.isArray(d)) {
    errors.add("schema", "The file is not a JSON object.");
    return done();
  }
  if (d.format !== 1 && d.format !== 2 && d.format !== 3) {
    errors.add("schema", `format is ${JSON.stringify(d.format)}: this EDGEbuilder reads formats 1, 2 and 3.`);
    return done();
  }
  const objects = Array.isArray(d.objects) ? d.objects : [];
  const idAt = (path4) => {
    const m = /^objects\[(\d+)\]/.exec(path4);
    const id = m ? objects[Number(m[1])]?.id : void 0;
    return typeof id === "string" ? id : void 0;
  };
  for (const e of validate(sceneSchema(d.format), data)) {
    const id = idAt(e.path);
    errors.add("schema", id ? `${e.path.replace(/^objects\[\d+\]\.?/, "") || "The object"} ${e.text}` : `${e.path} ${e.text}`, { id });
  }
  if (errors.list.length) return done();
  const known = knownFields(d.format);
  for (const key of Object.keys(d)) if (!known.top.includes(key)) warnings.add("unknown-field", `${key} (top level) is not a field of format ${d.format}: EDGEbuilder does not read it, and drops it when it saves the scene.`);
  const groups = new Set((Array.isArray(d.groups) ? d.groups : []).map((g) => g.id));
  const ids = /* @__PURE__ */ new Set();
  const refs = /* @__PURE__ */ new Map();
  const name = String(d.name);
  for (const o of objects) {
    for (const key of Object.keys(o)) if (!known.object.includes(key)) warnings.add("unknown-field", `${key} is not a field of an object in format ${d.format}: EDGEbuilder does not read it. A writer's own data goes in meta.`, { id: o.id });
    if (ids.has(o.id)) errors.add("duplicate-id", "Two objects have this id.", { id: o.id });
    ids.add(o.id);
    const ref = refOf(name, o);
    const other = refs.get(ref);
    if (other !== void 0 && other !== o.id) errors.add("duplicate-ref", `The reference ${ref} is used twice.`, { id: o.id });
    refs.set(ref, o.id);
    if (o.group !== void 0 && !groups.has(o.group)) warnings.add("unknown-group", `The group ${o.group} is not in groups: its objects stand on their own.`, { id: o.id });
    const numbers = [...o.transform.position, ...o.transform.rotation, ...o.transform.scale];
    if (numbers.some((n) => !Number.isFinite(n))) errors.add("bad-number", "A position, turn or scale is not a number.", { id: o.id });
    const q = o.transform.rotation;
    const length = Math.hypot(q[0], q[1], q[2], q[3]);
    if (Math.abs(length - 1) > 0.01) warnings.add("rotation-length", "The rotation is not a unit quaternion (its length is not 1): the object may bake skewed or scaled.", { id: o.id });
    if (o.solid && o.kind !== "mesh") warnings.add("solid-not-mesh", `solid is for a mesh: a ${o.kind}'s collision comes from what it is made of.`, { id: o.id });
    if (o.kind === "npc") dropped.push({ id: o.id, kind: "npc", why: "A bake cannot place people: they show only while EDGEbuilder or another package loads the scene." });
  }
  const edits = readableEdits(d.worldEdits);
  const { unnamed } = bakeRemovals(edits);
  for (const e of edits) if (e.action === "door") dropped.push({ id: e.id, kind: "door state", why: "A bake cannot set a door's state: EDGEbuilder keeps it in the running game." });
  for (const e of unnamed) dropped.push({ id: e.id, kind: "removal", why: "Its sector has no name, so the bake cannot find the entry." });
  const baked = objects.filter((o) => o.kind !== "npc").length + edits.filter((e) => e.action === "remove").length - unnamed.length;
  if (!baked) errors.add("nothing-to-bake", "The scene has nothing a bake can write.");
  return done();
}
var pathKey = collisionKey;
function checkFiles(objects, infos, where) {
  const errors = new Findings();
  const warnings = new Findings();
  const needs = /* @__PURE__ */ new Set();
  const noCollision = /* @__PURE__ */ new Set();
  for (const o of objects) {
    if (!o.resource || o.kind === "npc" || o.kind === "light") continue;
    const info = infos.get(pathKey(o.resource));
    if (!info) continue;
    if (info.error) {
      const missing = /not in |not found|no such/i.test(info.error);
      if (!missing) {
        warnings.add("file-unread", `REDbridge could not read it: ${info.error}`, { file: o.resource, id: o.id });
        continue;
      }
      needs.add(o.resource.replace(/\//g, "\\"));
      if (o.bounds) warnings.add("file-not-here", `Not in ${where}. The scene's bounds are used, and the game needs the mod that has the files.`, { among: o.resource, id: o.id });
      else errors.add("file-missing", `Not in ${where}, and the objects have no bounds. Give each object its bounds, or name the mod's archive (--archive) or folder of loose files (--root).`, { among: o.resource, id: o.id });
      continue;
    }
    const wanted = o.appearance;
    if (wanted && wanted !== "default" && info.appearances.length && !info.appearances.includes(wanted)) {
      const have = info.appearances.slice(0, 8).join(", ") + (info.appearances.length > 8 ? `, and ${info.appearances.length - 8} more` : "");
      warnings.add("appearance", `It has no appearance ${wanted}. It has: ${have}.`, { file: o.resource, id: o.id });
    }
    if (o.kind === "mesh" && o.solid && info.hasCollision === false) {
      noCollision.add(pathKey(o.resource));
      warnings.add("no-collision", "It has no collision data, so V walks through it: it is baked to draw only.", { file: o.resource, id: o.id });
    }
  }
  return { errors: errors.list, warnings: warnings.list, needs: [...needs].sort(), noCollision };
}
function findOverlaps(objects, boundsOf, share) {
  const Thin = 0.01;
  const boxes = [];
  for (const o of objects) {
    if (o.kind === "light" || o.kind === "npc") continue;
    const bounds = boundsOf(o);
    if (!bounds) continue;
    const box = boxOf([{ ...o, bounds }]);
    if (!box) continue;
    const size = [0, 1, 2].map((i) => Math.max(box.max[i] - box.min[i], Thin));
    boxes.push({ id: o.id, min: box.min, max: box.min.map((v, i) => v + size[i]), volume: size[0] * size[1] * size[2] });
  }
  boxes.sort((a, b) => a.min[0] - b.min[0]);
  const out = [];
  for (let i = 0; i < boxes.length; i++) {
    const a = boxes[i];
    for (let j = i + 1; j < boxes.length && boxes[j].min[0] < a.max[0]; j++) {
      const b = boxes[j];
      let inside = 1;
      for (let k = 0; k < 3 && inside > 0; k++) inside *= Math.max(0, Math.min(a.max[k], b.max[k]) - Math.max(a.min[k], b.min[k]));
      const s = inside / (a.volume + b.volume - inside);
      if (s >= share) out.push({ a: a.id, b: b.id, share: Math.round(s * 1e3) / 1e3 });
    }
  }
  return out.sort((x, y) => y.share - x.share);
}
function overlapFindings(pairs, objects, share) {
  const byId = new Map(objects.map((o) => [o.id, o]));
  const same = (p) => {
    const a = byId.get(p.a);
    const b = byId.get(p.b);
    return !!a && !!b && pathKey(a.resource) === pathKey(b.resource) && JSON.stringify(a.transform) === JSON.stringify(b.transform);
  };
  const out = [];
  const twins = pairs.filter(same);
  const rest = pairs.filter((p) => !same(p));
  if (twins.length) out.push({ code: "same-place", text: `${twins.length === 1 ? "Two objects are" : `${twins.length} pairs of objects are`} the same file at the same place, turn and scale: one of each pair is likely not meant.`, ids: twins.map((p) => `${p.a} = ${p.b}`) });
  if (rest.length) out.push({ code: "overlap", text: `${rest.length === 1 ? "Two objects fill" : `${rest.length} pairs of objects fill`} nearly the same box (${Math.round(share * 100)} % or more of it is shared).`, ids: rest.map((p) => `${p.a} + ${p.b} (${Math.round(p.share * 100)} %)`) });
  return out;
}
function groupBridgeWarnings(lines) {
  const out = new Findings();
  for (const line of lines) {
    const label = /^object (?:\d+ \(([^)]*)\)|'([^']*)'):\s*/.exec(line);
    const id = label ? label[1] ?? label[2] : void 0;
    let text = label ? line.slice(label[0].length) : line;
    const file = /'([^']+\.[a-z0-9]+)'/i.exec(text)?.[1] ?? /^([^\s:']+\.[a-z0-9]+):\s/i.exec(text)?.[1];
    if (file) text = text.replace(`'${file}'`, "the file").replace(new RegExp(`^${file.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:\\s*`), "");
    out.add("redbridge", text.charAt(0).toUpperCase() + text.slice(1), { file, id });
  }
  return out.list;
}
function editsOf(data) {
  return readableEdits(data.worldEdits);
}

// src/cli.ts
var Usage = `EDGEbuilder ${"0.14.0"}: check and bake a scene file with the game closed.

  check <scene>                    Checks the file and says what a bake would leave out. Writes nothing.
  bake <scene> --out <folder>      Bakes into a plain folder laid out like a project (source/archive/...).
  bake <scene> --project <path>    Bakes into a REDcode or WolvenKit project (its folder or .cpmodproj).

Options:
  --pack             With --out: also packs the folder's bakes into packed/archive/pc/mod/, with the .xl.
  --name <name>      With --pack: the archive's name. The scene's name when left out.
  --dry-run          bake: everything up to writing. The report says what would be written.
  --json             Prints one JSON report and nothing else.
  --archive <file>   A mod's .archive to look in before the game's files.
  --root <folder>    A folder of loose files (a project's source/archive) to look in before the game's.
  --overlap <share>  Report pairs of objects that fill nearly the same box: the share of the two
                     boxes that both cover, 0 to 1 (0.98 when left out; off for no overlap check).
  --offline          check: only the file itself, without REDbridge and the game's files.
  --bridge <exe>     REDbridge.exe. Else EDGEBUILDER_BRIDGE, else the one EDGEdeck fetched.
  --game <folder>    The game's folder. Else EDGEBUILDER_GAME, else Steam's default folder.

Exit code: 0 when nothing stops a bake, 1 for errors in the scene or the bake, 2 for a command that cannot be read.`;
var UsageError = class extends Error {
};
function readArgs(argv) {
  const [command, ...rest] = argv;
  if (command !== "check" && command !== "bake") throw new UsageError(command ? `${command} is not a command: check or bake.` : "Name a command: check or bake.");
  const o = { command, scene: "", pack: false, dryRun: false, json: false, overlap: 0.98, offline: false };
  const flags = { "--pack": "pack", "--dry-run": "dryRun", "--json": "json", "--offline": "offline" };
  const values = { "--out": "out", "--project": "project", "--name": "name", "--archive": "archive", "--root": "root", "--bridge": "bridge", "--game": "game" };
  const seen = /* @__PURE__ */ new Set();
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a in flags) o[flags[a]] = true;
    else if (a in values || a === "--overlap") {
      const v = rest[++i];
      if (v === void 0 || v.startsWith("--")) throw new UsageError(`${a} needs a value.`);
      if (seen.has(a)) throw new UsageError(a === "--archive" || a === "--root" ? `${a} was given twice: REDbridge looks in one ${a === "--archive" ? "mod archive" : "folder"} at a time.` : `${a} was given twice.`);
      seen.add(a);
      if (a === "--overlap") {
        o.overlap = v === "off" ? void 0 : Number(v);
        if (o.overlap !== void 0 && !(o.overlap > 0 && o.overlap <= 1)) throw new UsageError("--overlap takes a share above 0 and up to 1, or off.");
      } else o[values[a]] = v;
    } else if (a.startsWith("--")) throw new UsageError(`${a} is not an option.`);
    else if (o.scene) throw new UsageError(`One scene at a time: ${o.scene} and ${a} were both given.`);
    else o.scene = a;
  }
  if (!o.scene) throw new UsageError("Name the scene file.");
  if (o.command === "bake") {
    if (o.offline) throw new UsageError("--offline is for check: a bake needs REDbridge.");
    if (!o.out === !o.project) throw new UsageError("bake needs where to write: --out <folder> or --project <path>, one of them.");
    if (o.pack && !o.out) throw new UsageError("--pack goes with --out. A project is packed by REDcode or WolvenKit, which know its settings.");
  } else if (o.out || o.project || o.pack || o.dryRun) throw new UsageError("--out, --project, --pack and --dry-run are for bake.");
  if (o.name && !o.pack) throw new UsageError("--name goes with --pack.");
  return o;
}
function projectOf(given) {
  const full = path3.resolve(given);
  const dir = /\.cpmodproj$/i.test(full) ? path3.dirname(full) : full;
  const source = path3.join(dir, "source");
  return { name: path3.basename(dir), dir, archive: path3.join(source, "archive"), raw: path3.join(source, "raw"), resources: path3.join(source, "resources") };
}
async function run(o) {
  const started = Date.now();
  const file = path3.resolve(o.scene);
  const report = { edgebuilder: "0.14.0", command: o.command, ok: false, scene: { file }, counts: {}, errors: [], warnings: [], dropped: [], needs: [], checked: "file", written: [], ms: {} };
  const stop = (code, text) => {
    report.errors.push({ code, text });
    return report;
  };
  let data;
  try {
    data = JSON.parse(fs3.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
  } catch (err) {
    return stop("unreadable", `The scene file could not be read: ${err.message}`);
  }
  const first = checkSceneData(data);
  report.errors.push(...first.errors);
  report.warnings.push(...first.warnings);
  report.dropped.push(...first.dropped);
  if (data && typeof data === "object") {
    const objects2 = Array.isArray(data.objects) ? data.objects : [];
    report.scene = { file, name: typeof data.name === "string" ? data.name : void 0, slug: typeof data.name === "string" ? slugOf(data.name) : void 0, format: data.format, ...data.generator ? { generator: data.generator } : {} };
    for (const obj of objects2) if (obj && typeof obj.kind === "string") report.counts[obj.kind] = (report.counts[obj.kind] ?? 0) + 1;
  }
  if (report.errors.length) return report;
  const objects = data.objects;
  const edits = editsOf(data);
  const { removals } = bakeRemovals(edits);
  if (edits.length) report.counts.worldEdits = edits.length;
  report.scene.hash = bakeHash(objects, edits);
  if (o.offline) {
    report.warnings.push({ code: "not-checked", text: "--offline: files, appearances, collision data and overlaps were not checked." });
    report.ok = true;
    return report;
  }
  const exe = findBridge(o.bridge ?? process.env.EDGEBUILDER_BRIDGE);
  if (o.bridge && exe !== o.bridge) return stop("no-redbridge", `${o.bridge} is not there.`);
  if (!exe) return stop("no-redbridge", "REDbridge was not found: name it with --bridge or EDGEBUILDER_BRIDGE, or fetch it with EDGEdeck (Get REDbridge). check --offline looks at the file alone.");
  const named = o.game ?? (process.env.EDGEBUILDER_GAME || void 0);
  const game = named ?? findGame();
  if (!isGameFolder(game)) return stop("no-game", `The game was not found${named ? ` in ${named}` : " in Steam's libraries or GOG's folders"}: name its folder with --game or EDGEBUILDER_GAME.`);
  const from = { ...o.archive ? { archive: path3.resolve(o.archive) } : {}, ...o.root ? { root: path3.resolve(o.root) } : {} };
  for (const [what, p] of Object.entries(from)) if (!fs3.existsSync(p)) return stop("usage", `--${what}: ${p} is not there.`);
  const target = o.project ? projectOf(o.project) : o.out ? projectOf(o.out) : void 0;
  if (o.project && !fs3.existsSync(target.dir)) return stop("usage", `--project: ${target.dir} is not there.`);
  if (o.project && !from.root && fs3.existsSync(target.archive)) from.root = target.archive;
  const bridge = new BridgeClient(exe, game);
  bridge.start();
  try {
    let t = Date.now();
    const info = await bridge.info();
    report.ms.start = Date.now() - t;
    report.redbridge = { version: info.version, exe, game: info.gameDir };
    if (!info.gameLoaded) return stop("no-game", `REDbridge did not load the game from ${game}.`);
    t = Date.now();
    const paths = [...new Map(objects.filter((x) => x.resource && (x.kind === "mesh" || x.kind === "entity")).map((x) => [collisionKey(x.resource), x.resource.replace(/\//g, "\\")])).values()];
    const infos = /* @__PURE__ */ new Map();
    for (let i = 0; i < paths.length; i += 200) {
      const chunk = paths.slice(i, i + 200);
      const answers = await bridge.meshInfoMany(chunk, from);
      answers.forEach((a, n) => infos.set(collisionKey(chunk[n]), a));
    }
    report.ms.files = Date.now() - t;
    report.checked = "files";
    const where = [from.archive ? path3.basename(from.archive) : "", from.root ? from.root : "", "the game's archives"].filter(Boolean).join(", nor in ");
    const files = checkFiles(objects, infos, where);
    report.errors.push(...files.errors);
    report.warnings.push(...files.warnings);
    report.needs = files.needs;
    if (o.overlap !== void 0) {
      const pairs = findOverlaps(objects, (x) => x.bounds ?? infos.get(collisionKey(x.resource))?.bounds ?? void 0, o.overlap);
      report.warnings.push(...overlapFindings(pairs, objects, o.overlap));
    }
    if (removals.length && !atLeast(info.version, [0, 16, 0])) report.errors.push({ code: "redbridge-old", text: `REDbridge ${info.version} cannot bake removals: it needs 0.16.0 or later.` });
    if (report.errors.length) return report;
    if (o.command === "check") {
      report.ok = true;
      return report;
    }
    const slug = report.scene.slug;
    const { scene: input } = bakeInput(data.name, data.game, data.groups ?? [], solidForBake(objects, files.noCollision));
    const wouldWrite = (input.objects.length ? bakeFilesOf(slug) : bakeFilesOf(slug).slice(2)).map((rel) => path3.join(target.dir, ...rel.split("/")));
    if (o.dryRun) {
      report.dryRun = true;
      report.written = wouldWrite;
      report.nodes = input.objects.length;
      report.removals = removals.length;
      report.ok = true;
      return report;
    }
    t = Date.now();
    let built;
    try {
      fs3.mkdirSync(target.dir, { recursive: true });
      built = await bridge.sectorBuild({ project: target.dir, scene: input, ...from, ...removals.length ? { removals } : {} });
    } catch (err) {
      return stop("redbridge", `REDbridge refused the bake: ${err.message}`);
    }
    report.ms.bake = Date.now() - t;
    const said = /the scene's bounds are used|has no collision data|solid is for a mesh/;
    report.warnings.push(...groupBridgeWarnings(built.warnings.filter((w) => !said.test(w))));
    for (const r of built.refused ?? []) report.warnings.push({ code: "removal-refused", text: `A removal was not written (${path3.win32.basename(r.sector)} entry ${r.index}): ${r.why}` });
    if (!built.xl) return stop("redbridge", "Nothing was written.");
    const xl = built.blockPath ? settleXl(built.xl, built.name, built.blockPath) : built.xl;
    const gone = (built.removed ?? []).filter((r) => !r.proxyOf).length;
    const record = {
      slug: built.name,
      name: data.name,
      file,
      hash: report.scene.hash,
      objects: built.nodes,
      ...built.removed?.length ? { removals: gone, standIns: built.removed.length - gone } : {},
      date: (/* @__PURE__ */ new Date()).toISOString(),
      bridge: info.version,
      box: built.streamingBox ?? void 0,
      needs: files.needs
    };
    writeRecord(target, record);
    if (o.project) forgetInNote(target.dir, built.name);
    report.written = [built.sector, built.block, xl, path3.join(target.raw, "edgebuilder", `${built.name}.bake.json`)].filter((f) => !!f);
    report.nodes = built.nodes;
    report.removals = gone;
    report.streamingBox = built.streamingBox;
    if (o.pack) {
      t = Date.now();
      const outDir = path3.join(target.dir, "packed", "archive", "pc", "mod");
      if (fs3.existsSync(target.archive)) {
        try {
          report.packed = await bridge.call("project.pack", { dir: target.archive, outDir, modName: slugOf(o.name ?? data.name) });
        } catch (err) {
          return stop("redbridge", `REDbridge could not pack the bake: ${err.message}`);
        }
        report.written.push(report.packed.archive);
      } else fs3.mkdirSync(outDir, { recursive: true });
      const xlDir = path3.join(target.resources, "archive", "pc", "mod");
      for (const name of fs3.existsSync(xlDir) ? fs3.readdirSync(xlDir) : []) {
        if (!name.toLowerCase().endsWith(".xl")) continue;
        fs3.copyFileSync(path3.join(xlDir, name), path3.join(outDir, name));
        report.written.push(path3.join(outDir, name));
      }
      report.ms.pack = Date.now() - t;
    }
    report.ok = true;
    return report;
  } catch (err) {
    const tail = bridge.log.slice(-6).join(" | ");
    return stop("redbridge", `REDbridge failed: ${err.message}${tail ? ` (${tail.slice(0, 600)})` : ""}`);
  } finally {
    bridge.stop();
    report.ms.total = Date.now() - started;
  }
}
function findGame() {
  const dirs = [];
  for (const steam of [path3.join(process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)", "Steam"), path3.join(process.env.ProgramFiles ?? "C:\\Program Files", "Steam")]) {
    dirs.push(path3.join(steam, "steamapps", "common", "Cyberpunk 2077"));
    try {
      const vdf = fs3.readFileSync(path3.join(steam, "steamapps", "libraryfolders.vdf"), "utf8");
      for (const m of vdf.matchAll(/"path"\s+"([^"]+)"/g)) dirs.push(path3.join(m[1].replace(/\\\\/g, "\\"), "steamapps", "common", "Cyberpunk 2077"));
    } catch {
    }
  }
  for (const drive of ["C", "D", "E", "F"]) dirs.push(`${drive}:\\GOG Games\\Cyberpunk 2077`, `${drive}:\\Program Files (x86)\\GOG Galaxy\\Games\\Cyberpunk 2077`);
  return dirs.find(isGameFolder);
}
function atLeast(version, min) {
  const v = version.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < min.length; i++) if ((v[i] ?? 0) !== min[i]) return (v[i] ?? 0) > min[i];
  return true;
}
function textOf(r) {
  const lines = [];
  const many = (n, one, more = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : more}`;
  const s = r.scene;
  const counts = Object.entries(r.counts).map(([k, n]) => `${n.toLocaleString("en-US")} ${k}`).join(", ");
  lines.push(`${s.name ?? path3.basename(s.file)}${s.format ? ` (format ${s.format})` : ""}${counts ? `: ${counts}` : ""}`);
  if (r.redbridge) lines.push(`REDbridge ${r.redbridge.version}, game in ${r.redbridge.game}`);
  const show = (title, list) => {
    if (!list.length) return;
    lines.push("", `${title}:`);
    for (const f of list) {
      const ids = f.ids ?? [];
      const pairs = f.code === "overlap" || f.code === "same-place";
      const n = pairs ? "" : ids.length > 1 ? `${ids.length.toLocaleString("en-US")} objects: ` : ids.length === 1 ? `${ids[0]}: ` : "";
      const files = f.files?.length ? `${f.files.length.toLocaleString("en-US")} file${f.files.length === 1 ? "" : "s"}, ` : "";
      lines.push(`  [${f.code}] ${f.file ? `${f.file}: ` : ""}${files}${n}${f.text}`);
      if (f.files?.length) lines.push(`      ${f.files.slice(0, 3).join(", ")}${f.files.length > 3 ? `, and ${f.files.length - 3} more` : ""}`);
      if (ids.length > 1 || pairs && ids.length) lines.push(`      ${ids.slice(0, 6).join(", ")}${ids.length > 6 ? `, and ${ids.length - 6} more` : ""}`);
    }
  };
  show(many(r.errors.length, "error"), r.errors);
  show(many(r.warnings.length, "kind of warning", "kinds of warning"), r.warnings);
  if (r.dropped.length) {
    lines.push("", `Left out of a bake (${r.dropped.length}):`);
    const byWhy = /* @__PURE__ */ new Map();
    for (const d of r.dropped) byWhy.set(d.why, [...byWhy.get(d.why) ?? [], d.id]);
    for (const [why, ids] of byWhy) lines.push(`  ${ids.slice(0, 6).join(", ")}${ids.length > 6 ? `, and ${ids.length - 6} more` : ""}: ${why}`);
  }
  if (r.needs.length) lines.push("", `The game needs the mod with ${many(r.needs.length, "file")} that ${r.needs.length === 1 ? "is" : "are"} not on this PC: ${r.needs.slice(0, 4).join(", ")}${r.needs.length > 4 ? `, and ${r.needs.length - 4} more` : ""}`);
  if (r.written.length) {
    lines.push("", r.dryRun ? "A bake would write:" : "Written:");
    for (const f of r.written) lines.push(`  ${f}`);
  }
  if (r.nodes !== void 0) lines.push("", `${r.dryRun ? "Would bake" : "Baked"} ${many(r.nodes, "object")}${r.removals ? ` and ${many(r.removals, "removal")}` : ""}${r.ms.bake ? ` in ${(r.ms.bake / 1e3).toFixed(1)} s` : ""}.`);
  if (r.streamingBox) lines.push(`Streaming box: ${r.streamingBox.max.map((v, i) => Math.round(v - r.streamingBox.min[i])).join(" x ")} m.`);
  lines.push("", r.ok ? r.command === "check" ? "Nothing stops a bake." : r.dryRun ? "Nothing was written (--dry-run)." : "Done." : "Stopped: see the errors above.");
  return lines.join("\n");
}
async function main() {
  const argv = process.argv.slice(2);
  if (!argv.length || argv.includes("--help") || argv.includes("-h")) {
    console.log(Usage);
    return argv.length ? 0 : 2;
  }
  if (argv.includes("--version")) {
    console.log("0.14.0");
    return 0;
  }
  let options;
  try {
    options = readArgs(argv);
  } catch (err) {
    if (!(err instanceof UsageError)) throw err;
    if (argv.includes("--json")) console.log(JSON.stringify({ edgebuilder: "0.14.0", ok: false, errors: [{ code: "usage", text: err.message }] }, null, 2));
    else console.error(`${err.message}

${Usage}`);
    return 2;
  }
  const report = await run(options);
  console.log(options.json ? JSON.stringify(report, null, 2) : textOf(report));
  return report.ok ? 0 : report.errors.some((e) => e.code === "usage") ? 2 : 1;
}
main().then(
  (code) => {
    process.exitCode = code;
  },
  (err) => {
    console.error(err);
    process.exitCode = 1;
  }
);
