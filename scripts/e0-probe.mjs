// E0, the probe before EDGEbuilder for VS Code's sector view (docs/library.md, "E0 Probe"; EDGEbuilder #8,
// REDcode's proposal). Outside the game: REDbridge's sector.find and sector.nodes pick the busiest
// sector in a box (downtown by default), count what it holds, and export its unique meshes to GLB the
// way REDcode's mesh viewer does (archive.extract into a cache, then project.export), timed. Writes a
// manifest for probes/e0-view, which draws the sector. Nothing here is EDGEbuilder's code.
//
//   node scripts/e0-probe.mjs [--box minX,minY,maxX,maxY] [--sector <depot path>] [--textured 20]
//                             [--cache <folder>] [--limit <meshes>] [--name <run>]
//
// The cache holds files extracted from the player's game: it stays outside the repo
// (%LOCALAPPDATA%\EDGEbuilder\e0-cache by default) and is never committed.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { BridgeClient, findBridge } from "../dist/core.mjs";

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const gameDir = process.env.EDGEBUILDER_GAME ?? "E:\\SteamLibrary\\steamapps\\common\\Cyberpunk 2077";
const exe = process.env.EDGEBUILDER_BRIDGE ?? findBridge();
if (!exe) throw new Error("No REDbridge found: set EDGEBUILDER_BRIDGE");
const cache = path.resolve(arg("cache", path.join(process.env.LOCALAPPDATA ?? os.tmpdir(), "EDGEbuilder", "e0-cache")));
// City Center (Corpo Plaza and around), in metres, as x and y.
const [bx0, by0, bx1, by1] = (arg("box", "-2100,-600,-1100,400")).split(",").map(Number);
const texturedSample = Number(arg("textured", "20"));
const meshLimit = Number(arg("limit", "100000"));
/** A name for this run: its result and manifest files are e0-<name>.json and manifest-<name>.json. */
const run = arg("name", "run");

const bridge = new BridgeClient(exe, gameDir);
bridge.start();
const call = (m, p) => bridge.call(m, p);
const t0 = performance.now();
const ms = (since) => Math.round(performance.now() - since);
const out = { when: new Date().toISOString(), bridge: null, box: [bx0, by0, bx1, by1], find: {}, sectors: [], chosen: null, meshes: {}, exports: {}, textured: {}, notes: [] };

try {
  out.bridge = (await call("bridge.info")).version;
  console.log(`REDbridge ${out.bridge} (${exe}); cache ${cache}`);

  // 1. Every level-0 exterior sector whose box meets the area.
  let s = performance.now();
  const all = await call("sector.find", { box: { min: [bx0, by0, -500], max: [bx1, by1, 1500] }, kinds: ["exterior"], levels: [0] });
  out.find = { total: all.total, ms: ms(s) };
  console.log(`sector.find: ${all.total} level-0 exterior sectors in the box, ${out.find.ms} ms`);

  // 2. How full each is: sector.nodes on every one, the busiest by placed copies.
  let chosenPath = arg("sector");
  if (!chosenPath) {
    s = performance.now();
    // The whole area as well: its unique meshes size a district's first export.
    const districtMeshes = new Set();
    let districtCopies = 0;
    for (const [i, sec] of all.sectors.entries()) {
      try {
        const r = await call("sector.nodes", { path: sec.path });
        const copies = r.items.reduce((n, it) => n + (it.instances?.length ?? 1), 0);
        for (const it of r.items) if (/.mesh$/i.test(it.resource ?? "")) {
          districtMeshes.add(it.resource.toLowerCase());
          districtCopies += it.instances?.length ?? 1;
        }
        out.sectors.push({ path: sec.path, entries: r.items.length, copies });
      } catch (err) {
        out.sectors.push({ path: sec.path, error: err.message });
      }
      if ((i + 1) % 25 === 0) console.log(`  read ${i + 1} of ${all.sectors.length}`);
    }
    out.find.nodesMs = ms(s);
    out.district = { sectors: all.sectors.length, uniqueMeshes: districtMeshes.size, meshCopies: districtCopies };
    console.log(`the area: ${districtMeshes.size} unique meshes in ${districtCopies} copies over ${all.sectors.length} sectors`);
    out.sectors.sort((a, b) => (b.copies ?? 0) - (a.copies ?? 0));
    chosenPath = out.sectors[0]?.path;
    console.log(`sector.nodes on ${all.sectors.length} sectors: ${out.find.nodesMs} ms; busiest ${chosenPath} (${out.sectors[0]?.copies} copies)`);
  }

  // 3. The chosen sector in full, with mesh boxes.
  s = performance.now();
  const sector = await call("sector.nodes", { path: chosenPath, bounds: true });
  const readMs = ms(s);
  const kinds = {};
  for (const it of sector.items) kinds[it.kind] = (kinds[it.kind] ?? 0) + 1;
  const byMesh = new Map();
  const markers = [];
  for (const it of sector.items) {
    const placements = it.instances?.length ? it.instances : [it.transform];
    const res = it.resource ?? "";
    if (/\.mesh$/i.test(res)) {
      const m = byMesh.get(res) ?? { mesh: res, copies: [], kinds: new Set() };
      for (const p of placements) m.copies.push({ ...p, range: it.streaming?.primary ?? null, entry: it.index });
      m.kinds.add(it.kind);
      byMesh.set(res, m);
    } else {
      for (const p of placements) markers.push({ kind: it.kind, resource: res || it.resourceHash || null, position: p.position, range: it.streaming?.primary ?? null, entry: it.index });
    }
  }
  const copies = [...byMesh.values()].reduce((n, m) => n + m.copies.length, 0);
  out.chosen = { path: chosenPath, kind: sector.kind, nodes: sector.nodes, entries: sector.items.length, readMs, kinds, uniqueMeshes: byMesh.size, meshCopies: copies, markers: markers.length, warnings: sector.warnings.length };
  console.log(`${chosenPath}: ${sector.nodes} nodes, ${sector.items.length} entries, ${byMesh.size} unique meshes in ${copies} copies, ${markers.length} other things; read in ${readMs} ms`);

  // 4. The unique meshes to GLB, as REDcode's viewer (no materials), most detailed LOD only: cold, then warm.
  const archiveDir = path.join(cache, "game", "archive");
  const rawDir = path.join(cache, "raw", "plain");
  const meshes = [...byMesh.values()].slice(0, meshLimit);
  const exportOne = async (mesh, raw, options) => {
    const file = path.join(archiveDir, ...mesh.split("\\"));
    const glb = path.join(raw, mesh.replace(/\.mesh$/i, ".glb").split("\\").join(path.sep));
    const mtime = (f) => (fs.existsSync(f) ? fs.statSync(f).mtimeMs : -1);
    let extracted = false;
    if (!fs.existsSync(file)) {
      await call("archive.extract", { path: mesh, outFile: file });
      extracted = true;
    }
    if (mtime(glb) > mtime(file)) return { glb, cached: true, extracted };
    const r = await call("project.export", { file, archiveDir, rawDir: raw, options });
    if (!r.ok || !fs.existsSync(glb)) throw new Error(`no GLB${r.written?.length ? ` (wrote ${r.written.join(", ")})` : ""}`);
    return { glb, cached: false, extracted };
  };
  const pass = async (label, raw, options, list) => {
    const st = performance.now();
    let made = 0, cached = 0, failed = 0, bytes = 0;
    const failures = [];
    for (const [i, m] of list.entries()) {
      try {
        const r = await exportOne(m.mesh, raw, options);
        if (r.cached) cached++;
        else made++;
        bytes += fs.statSync(r.glb).size;
        m.glb = path.relative(cache, r.glb).split(path.sep).join("/");
      } catch (err) {
        failed++;
        if (failures.length < 10) failures.push(`${m.mesh}: ${err.message}`);
      }
      if ((i + 1) % 50 === 0) console.log(`  ${label}: ${i + 1} of ${list.length}`);
    }
    const r = { meshes: list.length, made, cached, failed, ms: ms(st), mb: +(bytes / 1e6).toFixed(1), failures };
    console.log(`${label}: ${made} exported, ${cached} from the cache, ${failed} failed, ${r.ms} ms, ${r.mb} MB`);
    return r;
  };
  const plain = { meshBinary: true, meshMaterials: false, meshLodFilter: true };
  out.exports.first = await pass("export", rawDir, plain, meshes);
  out.exports.again = await pass("export again", rawDir, plain, meshes);

  // 5. A sample with materials and textures, to see what textures would cost.
  if (texturedSample > 0) {
    const sample = meshes.slice(0, texturedSample).map((m) => ({ mesh: m.mesh }));
    out.textured = await pass(`textured sample of ${sample.length}`, path.join(cache, "raw", "textured"), { meshBinary: true, meshMaterials: true, meshLodFilter: true, textureFormat: "png", materialTextureFormat: "png" }, sample);
  }

  // 6. The manifest for probes/e0-view.
  const manifest = {
    sector: chosenPath,
    cache,
    meshes: meshes.filter((m) => m.glb).map((m) => ({ mesh: m.mesh, glb: m.glb, kinds: [...m.kinds], copies: m.copies })),
    markers,
  };
  fs.mkdirSync(cache, { recursive: true });
  fs.writeFileSync(path.join(cache, `manifest-${run}.json`), JSON.stringify(manifest));
  out.manifest = path.join(cache, `manifest-${run}.json`);
} catch (err) {
  out.notes.push(`stopped: ${err.message}`);
  console.error(err);
} finally {
  out.totalMs = ms(t0);
  fs.mkdirSync(cache, { recursive: true });
  fs.writeFileSync(path.join(cache, `e0-${run}.json`), JSON.stringify(out, null, 2));
  console.log(`result: ${path.join(cache, `e0-${run}.json`)} (${out.totalMs} ms)`);
  bridge.stop();
}
