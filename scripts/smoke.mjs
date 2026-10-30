// Exercises the REDnode-free parts: the bridge client against a real REDbridge and game (skipped
// when neither is on this machine), the asset index, and the scene store.
//   npm run smoke
//   EDGEBUILDER_BRIDGE=<REDbridge.exe> EDGEBUILDER_GAME=<game folder> npm run smoke
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import * as core from "../dist/core.mjs";
import { AssetIndex, BridgeClient, ModSources, NeedsNewerBridge, Scene, findBridge, isGameFolder, kindOf, modArchives, quaternionToYaw, sceneNeeds, yawToQuaternion } from "../dist/core.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "edgebuilder-smoke-"));

// Scene store: add, select ids, remove, save and load round trip, previews forgotten.
{
  const scene = new Scene(path.join(tmp, "scenes", "working.scene.json"));
  assert.equal(scene.load(), false);
  const a = scene.add("mesh", "base\\environment\\decoration\\containers\\cargo\\cargo_crate\\cargo_crate_a.mesh", { position: [1, 2, 3], rotation: yawToQuaternion(90), scale: [1, 1, 1] }, "default");
  const b = scene.add("mesh", "base\\environment\\decoration\\containers\\cargo\\cargo_crate\\cargo_crate_a.mesh", { position: [4, 5, 6], rotation: [0, 0, 0, 1], scale: [1, 1, 1] });
  assert.equal(a.id, "cargo_crate_a");
  assert.equal(b.id, "cargo_crate_a_1");
  a.entityId = "123";
  scene.save();
  const again = new Scene(scene.file);
  assert.equal(again.load(), true);
  assert.equal(again.objects.length, 2);
  assert.equal(again.objects[0].entityId, undefined, "previews are not saved");
  const file = JSON.parse(fs.readFileSync(scene.file, "utf8"));
  assert.equal(file.format, 1);
  assert.deepEqual(Object.keys(file.objects[0]).sort(), ["appearance", "id", "kind", "resource", "transform"]);
  assert.ok(Math.abs(quaternionToYaw(file.objects[0].transform.rotation) - 90) < 1e-6);
  assert.equal(scene.remove("cargo_crate_a_1")?.id, "cargo_crate_a_1");
  assert.equal(scene.remove("nope"), undefined);
  scene.forgetPreviews();
  assert.equal(scene.objects[0].entityId, undefined);
  scene.clear();
  assert.equal(scene.objects.length, 0);
  // A damaged file is set aside, not overwritten by the next save.
  fs.writeFileSync(scene.file, '{ "format": 1, "objects": [ { "id": "broken", "resource": ');
  const damaged = new Scene(scene.file);
  assert.equal(damaged.load(), false);
  assert.ok(damaged.loadError && damaged.setAside && fs.existsSync(damaged.setAside), "the unreadable file is kept");
  assert.ok(!fs.existsSync(scene.file));
  damaged.add("mesh", "base/a.mesh", { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] });
  assert.ok(fs.readFileSync(damaged.setAside, "utf8").includes("broken"), "the next save did not touch it");
  console.log("scene: ok");
}

// The viewport's geometry against a simulated game camera, for both ways ProjectPoint might answer.
{
  const m = core;
  const close = (a, b, eps, what) => assert.ok(Math.abs(a - b) < eps, `${what}: ${a} vs ${b}`);
  // A camera at a height, turned 30 degrees and pitched down 10.
  const q = m.qMul(m.qAxisAngle([0, 0, 1], 30), m.qAxisAngle([1, 0, 0], -10));
  const basis = { pos: [100, -50, 12], right: m.qRotate(q, [1, 0, 0]), fwd: m.qRotate(q, [0, 1, 0]), up: m.qRotate(q, [0, 0, 1]) };
  const W = 1920, H = 1080, vfov = (55 * Math.PI) / 180, aspect = 16 / 9;
  const camSpace = (p) => { const d = m.sub(p, basis.pos); return [m.dot(d, basis.right), m.dot(d, basis.up), m.dot(d, basis.fwd)]; };
  const games = {
    "-1..1, y up": (p) => { const [x, y, z] = camSpace(p); return { X: x / z / (aspect * Math.tan(vfov / 2)), Y: y / z / Math.tan(vfov / 2) }; },
    "pixels, y down": (p) => { const [x, y, z] = camSpace(p); return { X: 1920 + (x / z / (aspect * Math.tan(vfov / 2))) * 1920, Y: 1080 - (y / z / Math.tan(vfov / 2)) * 1080 }; },
  };
  const truthPx = (p) => { const [x, y, z] = camSpace(p); const nx = x / z / (aspect * Math.tan(vfov / 2)); const ny = y / z / Math.tan(vfov / 2); return [((nx + 1) / 2) * W, ((1 - ny) / 2) * H]; };
  for (const [name, projectPoint] of Object.entries(games)) {
    const cal = m.calibrate(m.calibrationPoints(basis).map(projectPoint));
    const cam = { ...basis, ...cal, pageW: W, pageH: H };
    for (const p of [[110, -40, 13], [95, -30, 5], [120, -20, 20]]) {
      const got = m.project(cam, p);
      const want = truthPx(p);
      close(got[0], want[0], 0.5, `${name} x`);
      close(got[1], want[1], 0.5, `${name} y`);
      const ray = m.rayFrom(cam, got[0], got[1]);
      const toP = m.norm(m.sub(p, basis.pos));
      close(m.dot(ray.d, toP), 1, 1e-6, `${name} ray through the point`);
    }
    assert.equal(m.project(cam, m.add(basis.pos, m.mul(basis.fwd, -5))), null, "behind the camera");
  }
  // Picking: a 2 x 2 x 2 box at (10, 0, 0), turned 45 degrees; a ray along +X hits its corner side.
  const hit = m.rayHitsBox({ o: [0, 0, 1], d: [1, 0, 0] }, { min: [-1, -1, 0], max: [1, 1, 2] }, [10, 0, 0], m.qAxisAngle([0, 0, 1], 45), [1, 1, 1]);
  close(hit, 10 - Math.SQRT2, 1e-6, "ray meets the turned box");
  assert.equal(m.rayHitsBox({ o: [0, 5, 1], d: [1, 0, 0] }, { min: [-1, -1, 0], max: [1, 1, 2] }, [10, 0, 0], [0, 0, 0, 1], [1, 1, 1]), null, "a ray beside the box misses");
  close(m.rayHitsBox({ o: [0, 0, 1], d: [1, 0, 0] }, { min: [-1, -1, 0], max: [1, 1, 2] }, [10, 0, 0], [0, 0, 0, 1], [2, 2, 2]), 8, 1e-6, "scale grows the box");
  // Dragging along an axis: a ray crossing the X axis at x = 3 gives 3.
  close(m.closestOnAxis({ o: [3, -5, 0], d: [0, 1, 0] }, [0, 0, 0], [1, 0, 0]), 3, 1e-9, "closest point on the axis");
  assert.equal(m.closestOnAxis({ o: [0, 0, 0], d: [1, 0, 0] }, [5, 0, 0], [1, 0, 0]), null, "looking along the axis");
  // Headings: a turn of 90 degrees left reads 90, and the scene file's yaw helper agrees.
  close(m.qYaw(m.qAxisAngle([0, 0, 1], 90)), 90, 1e-9, "yaw");
  close(m.qYaw(yawToQuaternion(-35)), -35, 1e-9, "yaw from the scene helper");
  const onFloor = m.rayOnPlaneZ({ o: [0, 0, 10], d: m.norm([1, 0, -1]) }, 0);
  close(onFloor[0], 10, 1e-9, "ray meets the floor plane");
  // The editor camera's look: heading and pitch to a rotation and back, and its axes.
  for (const l of [{ yaw: 0, pitch: 0 }, { yaw: 37, pitch: -20 }, { yaw: -150, pitch: 60 }]) {
    const a = m.lookAxes(l);
    const back = m.lookOf(a.fwd);
    close(back.yaw, l.yaw, 1e-9, "heading round trip");
    close(back.pitch, l.pitch, 1e-9, "pitch round trip");
    close(m.dot(a.fwd, a.right), 0, 1e-9, "forward and right are square");
    close(a.right[2], 0, 1e-9, "no roll: right stays level");
    close(m.qYaw(m.qLook(l)), l.yaw, 1e-9, "the gizmo's heading reads the same");
  }
  const at = m.lookAt([0, 0, 0], [0, 10, 10]);
  close(at.yaw, 0, 1e-9, "looking north");
  close(at.pitch, 45, 1e-9, "and up 45 degrees");
  console.log("viewport math: ok");
}

// Kinds and yaw.
assert.equal(kindOf("a\\b.mesh"), "mesh");
assert.equal(kindOf("a\\b.ENT"), "entity");
assert.equal(kindOf("a\\b.xbm"), undefined);
assert.deepEqual(yawToQuaternion(0), [0, 0, 0, 1]);

// B2c: mod archives (through a stand-in for REDbridge's archive.openMod), the project's loose files,
// the search over them, and what a scene needs.
{
  const game = path.join(tmp, "game");
  const modDir = path.join(game, "archive", "pc", "mod");
  fs.mkdirSync(modDir, { recursive: true });
  fs.mkdirSync(path.join(game, "mods", "redmod_props", "archives"), { recursive: true });
  fs.writeFileSync(path.join(modDir, "chickens.archive"), "1234");
  fs.writeFileSync(path.join(modDir, "readme.txt"), "not an archive");
  fs.writeFileSync(path.join(game, "mods", "redmod_props", "archives", "props.archive"), "12");
  const files = modArchives(game);
  assert.deepEqual(files.map((f) => f.mod).sort(), ["chickens", "redmod_props"]);
  const contents = {
    "chickens.archive": [
      { hash: "1", name: "base\\toys\\rubber_chicken.mesh", size: 10, archive: "chickens" },
      { hash: "2", name: "base\\toys\\rubber_chicken_d.xbm", size: 10, archive: "chickens" },
      { hash: "3", name: "base\\environment\\box_a.mesh", size: 10, archive: "chickens" },
    ],
    "props.archive": [{ hash: "4", name: "redmod_props\\lamp.ent", size: 10, archive: "props" }],
  };
  let reads = 0;
  const fake = { openMod: async (file) => (reads++, { path: file, name: path.basename(file), count: 0, items: contents[path.basename(file)] }) };
  const isGame = (p) => p.toLowerCase() === "base\\environment\\box_a.mesh";
  const sources = new ModSources(path.join(tmp, "sources", "mods.json"));
  let r = await sources.refreshMods(fake, files, isGame);
  assert.equal(r.changed, true);
  assert.equal(reads, 2);
  assert.equal(sources.modAssets, 3, "meshes and entities only");
  const box = sources.entries().find((e) => e.path.endsWith("box_a.mesh"));
  assert.equal(box.replaces, true, "a mod file with a game file's path changes that file");
  assert.equal(sources.entries().find((e) => e.path.endsWith("lamp.ent")).source.name, "redmod_props");
  r = await sources.refreshMods(fake, files, isGame);
  assert.equal(r.changed, false);
  assert.equal(reads, 2, "unchanged archives are not read again");
  const again = new ModSources(sources.cacheFile);
  assert.equal(again.modAssets, 3, "the cache survives a restart");
  fs.writeFileSync(path.join(modDir, "chickens.archive"), "123456");
  r = await again.refreshMods(fake, modArchives(game), isGame);
  assert.equal(reads, 3, "a changed archive is read again, only that one");
  fs.rmSync(path.join(game, "mods"), { recursive: true });
  r = await again.refreshMods(fake, modArchives(game), isGame);
  assert.equal(r.changed, true);
  assert.equal(again.modAssets, 2, "a removed mod is forgotten");

  // The project's loose files, as the game paths they get once packed.
  const archive = path.join(tmp, "project", "source", "archive");
  fs.mkdirSync(path.join(archive, "edgefab", "chair"), { recursive: true });
  fs.writeFileSync(path.join(archive, "edgefab", "chair", "chair.mesh"), "m");
  fs.writeFileSync(path.join(archive, "edgefab", "chair", "chair.ent"), "e");
  fs.writeFileSync(path.join(archive, "edgefab", "chair", "chair_d.xbm"), "t");
  again.scanProject({ name: "FabChair", archive }, isGame);
  assert.deepEqual(again.project.map((e) => e.path), ["edgefab\\chair\\chair.ent", "edgefab\\chair\\chair.mesh"]);
  assert.equal(again.project[0].source.kind, "project");

  // Search: mods and the project beside the game, by source, and by the mod's name.
  const index = new AssetIndex(path.join(tmp, "index-b2c"));
  index.entries = [
    { path: "base\\environment\\box_a.mesh", kind: "mesh", size: 1 },
    { path: "base\\environment\\chair_b.mesh", kind: "mesh", size: 1 },
  ];
  index.extra = again.entries();
  assert.ok(index.isGamePath("base/environment/box_a.mesh"));
  assert.equal(index.search("chair", "all", 10)[0].source?.name, "FabChair", "mods and the project first");
  assert.deepEqual(index.search("chair", "all", 10, "game").map((e) => e.path), ["base\\environment\\chair_b.mesh"]);
  assert.equal(index.search("", "all", 10, "project").length, 2, "Project lists all of its files without text");
  assert.ok(index.search("", "all", 10, "mods").every((e) => e.source?.kind === "mod"));
  assert.deepEqual(index.search("chickens", "all", 10, "mods").map((e) => e.source.name), ["chickens", "chickens"], "a mod's name finds its files");
  assert.equal(index.search("chickens", "entity", 10, "mods").length, 0);

  // What a scene needs: mods and projects by name; a replaced game file needs nothing.
  assert.deepEqual(sceneNeeds(["base/toys/rubber_chicken.mesh", "edgefab\\chair\\chair.ent", "base\\environment\\box_a.mesh", "base\\environment\\chair_b.mesh", undefined], index.extra), [
    "chickens",
    "FabChair (REDcode project)",
  ]);
  // B2c-2: sizes and appearances of a mod's and the project's files, through mesh.info with archive or root.
  const asked = [];
  const answers = (from) => ({ path: "x", type: "mesh", bounds: { min: [0, 0, 0], max: [1, 2, 3] }, appearances: ["default", from.archive ? "mod" : "loose"], error: null });
  const newer = { meshInfoMany: async (paths, from) => (asked.push(from), paths.map(() => answers(from))) };
  const chicken = again.entries().find((e) => e.path.endsWith("rubber_chicken.mesh"));
  let info = await again.lookAt(newer, chicken);
  assert.deepEqual(info.appearances, ["default", "mod"]);
  assert.equal(asked[0].archive, chicken.source.file, "a mod's file is read from its archive");
  await again.lookAt(newer, chicken);
  assert.equal(asked.length, 1, "asked once");
  info = await again.lookAt(newer, again.project[1]);
  assert.deepEqual(info.appearances, ["default", "loose"]);
  assert.equal(asked[1].root, archive, "a project's file is read from its source\\archive");
  fs.writeFileSync(again.project[1].source.file, "changed");
  fs.utimesSync(again.project[1].source.file, new Date(), new Date(Date.now() + 5000));
  await again.lookAt(newer, again.project[1]);
  assert.equal(asked.length, 3, "a changed project file is asked again");
  const older = { meshInfoMany: async (paths) => paths.map((p) => ({ path: p, type: "", bounds: null, appearances: [], error: `'${p}' is not in the loaded archives` })) };
  const fresh = new ModSources(path.join(tmp, "sources-old", "mods.json"));
  fresh.scanProject({ name: "FabChair", archive }, isGame);
  assert.equal((await fresh.lookAt(older, fresh.project[0])).error, NeedsNewerBridge, "an older REDbridge says what is needed");
  const refuses = { meshInfoMany: async () => { throw new Error("Unexpected parameter: archive"); } };
  assert.equal((await fresh.lookAt(refuses, fresh.project[0])).error, NeedsNewerBridge);
  console.log("mods and project: ok");
}

// The bridge and the index, against the real thing when it is here.
const exe = process.env.EDGEBUILDER_BRIDGE || findBridge() || [path.join(here, "..", "..", "REDbridge", "dist", "publish", "REDbridge.exe"), path.join(here, "..", "..", "REDbridge", "src", "REDbridge", "bin", "Release", "net10.0", "REDbridge.exe")].find((p) => fs.existsSync(p));
const game = [process.env.EDGEBUILDER_GAME, "C:\\Program Files (x86)\\Steam\\steamapps\\common\\Cyberpunk 2077"].find(isGameFolder);
if (!exe || !game) {
  console.log(`bridge and index: skipped (${exe ? "" : "no REDbridge.exe; "}${game ? "" : "no game folder"})`);
} else {
  const bridge = new BridgeClient(exe, game);
  bridge.start();
  const info = await bridge.info();
  assert.ok(info.gameLoaded && info.files > 100000, JSON.stringify(info));
  console.log(`bridge: ok (REDbridge ${info.version}, ${info.files} files)`);
  const index = new AssetIndex(path.join(tmp, "index"));
  const key = `${info.archives}-${info.files}`;
  assert.equal(index.load(key), false);
  const t = Date.now();
  let last = "";
  await index.build(bridge, key, (text) => (last = text));
  assert.ok(index.entries.length > 1000, `only ${index.entries.length} assets`);
  assert.ok(index.entries.every((e) => e.kind === "mesh" || e.kind === "entity"));
  assert.equal(new Set(index.entries.map((e) => e.path.toLowerCase())).size, index.entries.length, "one entry per path, though some files are in two archives");
  assert.ok(fs.existsSync(index.file));
  console.log(`index: ok (${index.entries.length} assets in ${((Date.now() - t) / 1000).toFixed(1)} s; last progress: ${last})`);
  const crates = index.search("cargo crate", "mesh", 20);
  assert.ok(crates.length > 0 && crates.every((e) => e.kind === "mesh" && /cargo/i.test(e.path) && /crate/i.test(e.path)), JSON.stringify(crates.slice(0, 3)));
  assert.ok(index.search("cargo crate", "entity", 20).every((e) => e.kind === "entity"));
  assert.equal(index.search("zzzz_nothing_here", "all").length, 0);
  const info1 = await index.lookAt(bridge, crates[0].path);
  assert.ok(info1.bounds && info1.bounds.min.length === 3 && info1.appearances.length >= 1, JSON.stringify(info1));
  const newest = new AssetIndex(index.dir);
  assert.equal(newest.loadNewest(), true, "the newest index loads without knowing the game");
  assert.equal(newest.entries.length, index.entries.length);
  const reloaded = new AssetIndex(index.dir);
  assert.equal(reloaded.load(key), true);
  assert.equal(reloaded.entries.length, index.entries.length);
  assert.deepEqual(reloaded.info[crates[0].path], info1, "looked-at info is kept");
  // A real mod archive, when the game has one: names come from the archive itself.
  const real = modArchives(game).find((a) => /evilclown/i.test(a.file)) ?? modArchives(game)[0];
  if (real) {
    const mods = new ModSources(path.join(tmp, "sources-real", "mods.json"));
    const { failed } = await mods.refreshMods(bridge, [real], (p) => index.isGamePath(p));
    assert.deepEqual(failed, []);
    const first = mods.entries().find((e) => e.kind === "mesh");
    if (first) {
      const looked = await mods.lookAt(bridge, first);
      if (looked.error === NeedsNewerBridge) console.log(`mod archive: sizes skipped (REDbridge before 0.12.0)`);
      else assert.ok(looked.bounds && looked.appearances.length, JSON.stringify(looked));
    }
    console.log(`mod archive: ok (${real.mod}: ${mods.modAssets} meshes and entities${first ? `; ${first.path.split("\\").pop()} looked at` : ""})`);
  }
  const bad = await index.lookAt(bridge, "base\\nope.mesh");
  assert.ok(bad.error);
  console.log(`search: ok (${crates.length} cargo crate meshes; first ${crates[0].path}, ${info1.appearances.length} appearances)`);
  bridge.stop();
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log("smoke: all passed");
