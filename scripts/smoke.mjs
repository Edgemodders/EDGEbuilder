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
import { AssetIndex, BridgeClient, Scene, findBridge, isGameFolder, kindOf, quaternionToYaw, yawToQuaternion } from "../dist/core.mjs";

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
  const bad = await index.lookAt(bridge, "base\\nope.mesh");
  assert.ok(bad.error);
  console.log(`search: ok (${crates.length} cargo crate meshes; first ${crates[0].path}, ${info1.appearances.length} appearances)`);
  bridge.stop();
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log("smoke: all passed");
