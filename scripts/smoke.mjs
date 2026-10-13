// Exercises the REDnode-free parts: the bridge client against a real REDbridge and game (skipped
// when neither is on this machine), the asset index, and the scene store.
//   npm run smoke
//   EDGEBUILDER_BRIDGE=<REDbridge.exe> EDGEBUILDER_GAME=<game folder> npm run smoke
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
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
  console.log("scene: ok");
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
