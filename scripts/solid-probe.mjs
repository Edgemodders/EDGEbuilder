// Bake probe, round 3 (B4): how a baked mesh gets its collision, and that a baked object stands as it
// was placed. docs/testing.md, "B4 Bake", says which question each crate answers. sector.build writes plain
// mesh nodes; this rewrites them through CR2W JSON, so no REDbridge change is needed to find the answer.
// The node-data entries stay as sector.build wrote them, but for the collision boxes: the game's own
// instanced destructible and dynamic mesh nodes have the same flags and priority as a mesh node.
//   npm run build
//   node scripts/solid-probe.mjs <out folder> [--x X --y Y --z Z] [--skip id,id]
// --skip leaves crates out, should one of them stop the game from loading.
// EDGEBUILDER_BRIDGE (REDbridge with sector.nodes, 0.12.0 or later) and EDGEBUILDER_GAME as for the smoke test.
// Writes <out>/project and <out>/mod (archive\pc\mod\...), for EDGEdeck.
import * as fs from "node:fs";
import * as path from "node:path";
import { BridgeClient, isGameFolder } from "../dist/core.mjs";

const args = process.argv.slice(2);
const out = args.find((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1].startsWith("--")));
const skip = args.includes("--skip") ? args[args.indexOf("--skip") + 1].split(",") : [];
const exe = process.env.EDGEBUILDER_BRIDGE;
const game = [process.env.EDGEBUILDER_GAME, "E:\\SteamLibrary\\steamapps\\common\\Cyberpunk 2077", "C:\\Program Files (x86)\\Steam\\steamapps\\common\\Cyberpunk 2077"].find((p) => p && isGameFolder(p));
if (!out || !exe || !game) {
  console.error("usage: EDGEBUILDER_BRIDGE=<REDbridge.exe> node scripts/solid-probe.mjs <out folder> [--x X --y Y --z Z] [--skip id,id]");
  process.exit(2);
}
const num = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : fallback;
};
// Default: the Watson street of rounds 1 and 2, going west.
const start = [num("x", -1439.15), num("y", 1214.04), num("z", 23.07)];

const name = "edgebuilder_bake_probe";
const crate = "base\\environment\\decoration\\containers\\cargo\\cargo_crate\\cargo_crate_a.mesh";
// A sofa with no meshMeshParamPhysics, checked below: what does a mesh without collision data do?
const sofa = "base\\environment\\decoration\\furniture\\restaurant\\bar_sofa_02\\bar_sofa_02_k.mesh";
const ref = (p) => ({ DepotPath: { $type: "ResourcePath", $storage: p ? "string" : "uint64", $value: p ?? "0" }, Flags: "Soft" });
const cname = (value) => ({ $type: "CName", $storage: "string", $value: value });

// What the game's own "World Dynamic" nodes have (the filter masks are that preset's).
const filter = (handle) => ({
  HandleId: String(handle),
  Data: {
    $type: "physicsFilterData",
    customFilterData: null,
    preset: cname("World Dynamic"),
    queryFilter: { $type: "physicsQueryFilter", mask1: "0", mask2: "143753224" },
    simulationFilter: { $type: "physicsSimulationFilter", mask1: "114696", mask2: "9223372036854780879" },
  },
});
const oneInstance = [{ $type: "Transform", orientation: { $type: "Quaternion", i: 0, j: 0, k: 0, r: 1 }, position: { $type: "Vector4", W: 0, X: 0, Y: 0, Z: 0 } }];
const navigation = { $type: "NavGenNavigationSetting", navmeshImpact: "Blocking" };

function destructible(node, handle, { simulationType, turnDynamicOnImpulse }) {
  return {
    ...node,
    $type: "worldInstancedDestructibleMeshNode",
    accumulateDamage: 1,
    damageEndurance: 30,
    damageThreshold: 1,
    enableSelfCollisionInAggregate: 0,
    filterData: filter(handle),
    filterDataSource: "Parent",
    fracturingEffect: ref(),
    idleEffect: ref(),
    impulseToDamage: 1,
    instanceTransforms: oneInstance,
    isDestructible: 0,
    isPierceable: 0,
    isWorkspot: 0,
    navigationSetting: navigation,
    simulationType,
    startInactive: 0,
    staticMesh: ref(),
    staticMeshAppearance: cname("None"),
    systemsToNotifyFlags: 14,
    turnDynamicOnImpulse: turnDynamicOnImpulse ? 1 : 0,
    useAggregate: 0,
    useMeshNavmeshSettings: 1,
  };
}

function dynamic(node) {
  return {
    ...node,
    $type: "worldDynamicMeshNode",
    dynamicTrafficSetting: { $type: "TrafficGenDynamicTrafficSetting", impact: "Ignored" },
    initialGuess: 0,
    isDebris: 0,
    navigationSetting: navigation,
    startAsleep: 1,
    useMeshNavmeshSettings: 1,
  };
}

// A turn of 40 degrees around the vertical and a lean of 20: a box that ignored it would show.
const axis = (x, y, z, degrees) => {
  const h = (degrees * Math.PI) / 360;
  return [x * Math.sin(h), y * Math.sin(h), z * Math.sin(h), Math.cos(h)];
};
const times = ([ax, ay, az, aw], [bx, by, bz, bw]) => [
  aw * bx + ax * bw + ay * bz - az * by,
  aw * by - ax * bz + ay * bw + az * bx,
  aw * bz + ax * by - ay * bx + az * bw,
  aw * bw - ax * bx - ay * by - az * bz,
];
const turned = times(axis(0, 0, 1, 40), axis(1, 0, 0, 20));
const rotate = ([x, y, z, w], v) => {
  const t = [2 * (y * v[2] - z * v[1]), 2 * (z * v[0] - x * v[2]), 2 * (x * v[1] - y * v[0])];
  return [v[0] + w * t[0] + y * t[2] - z * t[1], v[1] + w * t[1] + z * t[0] - x * t[2], v[2] + w * t[2] + x * t[1] - y * t[0]];
};

const kinematic = (n, h) => destructible(n, h, { simulationType: "Kinematic" });

// Going west. `make` turns sector.build's plain mesh node into the one under test. `box` also bakes a
// worldCollisionNode around the object's bounds, as an object of its own, `<id>_collider`.
const row = [
  { id: "a_plain", west: 0, note: "worldMeshNode, the reference", make: (n) => n },
  { id: "b_kinematic", west: 2.5, note: "instanced destructible, Kinematic", make: kinematic },
  { id: "c_static", west: 5, note: "instanced destructible, Static", make: (n, h) => destructible(n, h, { simulationType: "Static" }) },
  { id: "d_impulse", west: 7.5, note: "instanced destructible, Kinematic, turns dynamic on impulse", make: (n, h) => destructible(n, h, { simulationType: "Kinematic", turnDynamicOnImpulse: true }) },
  { id: "e_dynamic", west: 10, note: "worldDynamicMeshNode, asleep at the start", make: dynamic },
  { id: "f_big", west: 13.5, scale: 2, note: "as b_kinematic, scale 2", make: kinematic },
  { id: "g_box", west: 17, note: "plain mesh with a collision box", make: (n) => n, box: true },
  { id: "h_turned", west: 20, rotation: turned, lift: 0.5, note: "as b_kinematic, turned and leaning", make: kinematic },
  { id: "i_box_turned", west: 23, rotation: turned, lift: 0.5, note: "as g_box, turned and leaning", make: (n) => n, box: true },
  { id: "j_sofa", west: 26, resource: sofa, note: "as b_kinematic, a mesh with no collision data", make: kinematic },
  { id: "k_sofa_box", west: 29, resource: sofa, note: "the same mesh, plain, with a collision box", make: (n) => n, box: true },
  { id: "l_red", west: 32, appearance: "red", note: "as b_kinematic, appearance red", make: kinematic },
].filter((r) => !skip.includes(r.id));

// A name as the game hashes it (CName: FNV-1a, 64 bits).
function hashName(text) {
  let h = 0xcbf29ce484222325n;
  for (const c of Buffer.from(text, "utf8")) h = BigInt.asUintN(64, (h ^ BigInt(c)) * 0x100000001b3n);
  return h;
}

// One actor with one box, laid out as worldCollisionNode's compiledData is (WolvenKit's CollisionWriter):
// 48 bytes an actor, 32 a shape, then the materials, the presets, the shape indices and the material indices.
function collisionBytes(at, q, half) {
  const b = Buffer.alloc(48 + 32 + 8 + 8 + 4 + 1);
  let o = 0;
  for (const v of at) o = b.writeInt32LE(Math.round(v * 131072), o);
  o = b.writeInt32LE(0, o);
  for (const v of q) o = b.writeFloatLE(v, o);
  o = b.writeUInt16LE(0, o); // first shape
  o = b.writeUInt16LE(1, o); // shapes
  o = b.writeInt16LE(-1, o); // no scale
  o = b.writeInt16LE(0, o);
  o = b.writeBigUInt64LE(0n, o);
  for (const v of half) o = b.writeFloatLE(v, o);
  o = b.writeInt16LE(0, o); // physicsShapeType.Box
  o = b.writeInt16LE(0, o);
  o = b.writeInt16LE(0, o); // first material index
  o = b.writeInt16LE(1, o); // materials
  o = b.writeInt16LE(-1, o); // no shape position
  o = b.writeInt16LE(-1, o); // no shape rotation
  o = b.writeUInt8(0, o); // preset
  o = b.writeUInt8(11, o); // proxy type, as on the game's shapes
  o = b.writeUInt16LE(0, o);
  o = b.writeUInt32LE(0, o);
  o = b.writeBigUInt64LE(hashName("metal.physmat"), o);
  o = b.writeBigUInt64LE(hashName("World Static"), o);
  o = b.writeUInt32LE(0, o); // shape index
  b.writeUInt8(0, o); // material index
  return b;
}

// The game's own collision: world positions, a box's half sizes, the World Static preset, a material.
function collisionNode(r, info, bufferId) {
  const scale = r.scale ?? 1;
  const q = r.rotation ?? [0, 0, 0, 1];
  const { min, max } = info.bounds;
  const middle = [0, 1, 2].map((k) => ((min[k] + max[k]) / 2) * scale);
  const half = [0, 1, 2].map((k) => ((max[k] - min[k]) / 2) * scale);
  const moved = rotate(q, middle);
  const at = [0, 1, 2].map((k) => r.position[k] + moved[k]);
  return {
    $type: "worldCollisionNode",
    // Raw bytes: CR2W JSON cannot read this buffer's structure, though it writes it. WolvenKit's own reader checks them below.
    compiledData: { BufferId: bufferId, Flags: 7471104, Bytes: collisionBytes(at, q, half).toString("base64") },
    debugName: cname(`${r.id}_collider`),
    extents: { $type: "Vector4", W: 0, X: half[0], Y: half[1], Z: half[2] },
    isHostOnly: 0,
    isVisibleInGame: 1,
    lod: 0,
    numActors: 1,
    numMaterialIndices: 1,
    numMaterials: 1,
    numPresets: 1,
    numScales: 0,
    numShapeIndices: 1,
    numShapeInfos: 1,
    numShapePositions: 0,
    numShapeRotations: 0,
    proxyScale: null,
    resourceVersion: 0,
    sectorHash: "0",
    sourcePrefabHash: "0",
    tag: "None",
    tagExt: "None",
  };
}

const project = path.resolve(out, "project");
const mod = path.resolve(out, "mod");
fs.rmSync(path.resolve(out), { recursive: true, force: true });
fs.mkdirSync(project, { recursive: true });

for (const r of row) r.position = [start[0] - r.west, start[1], start[2] + (r.lift ?? 0)];
const object = (r, id) => {
  const s = r.scale ?? 1;
  return {
    id,
    kind: "mesh",
    resource: r.resource ?? crate,
    appearance: r.appearance ?? "default",
    transform: { position: r.position, rotation: r.rotation ?? [0, 0, 0, 1], scale: [s, s, s] },
    streaming: { primary: 120, secondary: 96 },
  };
};
const scene = {
  format: 1,
  name,
  game: "2.5",
  groups: [],
  objects: row.flatMap((r) => [object(r, r.id), ...(r.box ? [object(r, `${r.id}_collider`)] : [])]),
};

const bridge = new BridgeClient(exe, game);
bridge.start();
try {
  const info = await bridge.info();
  console.log(`REDbridge ${info.version}, game ${info.gameVersion ?? "?"}, ${info.files} files`);
  const built = await bridge.call("sector.build", { project, scene });
  console.log(`sector.build: ${built.nodes} nodes; warnings: ${built.warnings.length ? built.warnings.join("; ") : "none"}`);

  const sofaFile = path.resolve(out, "sofa.json");
  await bridge.call("cr2w.toJson", { path: sofa, outFile: sofaFile });
  const sofaParams = (JSON.parse(fs.readFileSync(sofaFile, "utf8")).Data.RootChunk.parameters ?? []).map((x) => (x.Data ?? x).$type);
  fs.rmSync(sofaFile);
  if (sofaParams.includes("meshMeshParamPhysics")) throw new Error("the sofa has collision data after all: pick another mesh");

  const jsonFile = path.resolve(out, "sector.json");
  await bridge.call("cr2w.fileToJson", { file: built.sector, outFile: jsonFile });
  const doc = JSON.parse(fs.readFileSync(jsonFile, "utf8"));
  const sector = doc.Data.RootChunk;
  const nodes = sector.nodes;
  if (nodes.length !== scene.objects.length) throw new Error(`expected ${scene.objects.length} nodes, found ${nodes.length}`);
  const expected = [];
  let n = 0;
  for (const r of row) {
    nodes[n].Data = r.make(nodes[n].Data, 9000 + n);
    expected.push({ id: r.id, node: nodes[n].Data.$type, note: r.note });
    n++;
    if (r.box) {
      const boxOf = await bridge.call("mesh.info", { path: r.resource ?? crate });
      nodes[n].Data = collisionNode(r, boxOf, String(100 + n));
      sector.nodeData.Data[n].nodeFlags = "FLAG_Building";
      expected.push({ id: `${r.id}_collider`, node: "worldCollisionNode", note: "its collision box" });
      n++;
    }
  }
  fs.writeFileSync(jsonFile, JSON.stringify(doc));
  await bridge.call("cr2w.fromJson", { outFile: built.sector, jsonFile });

  // It reads back as written: each node's class and place, and the boxes' counts and sizes.
  const back = await bridge.call("sector.nodes", { path: built.sectorPath, root: path.join(project, "source", "archive") });
  if (back.warnings?.length) console.log(`  sector.nodes warnings: ${back.warnings.join("; ")}`);
  if (back.items.length !== expected.length) throw new Error(`read back ${back.items.length} items, expected ${expected.length}`);
  back.items.forEach((item, k) => {
    const e = expected[k];
    if (item.kind !== e.node) throw new Error(`${e.id}: read back ${item.kind}, wrote ${e.node}`);
    const p = item.transform.position;
    console.log(`  ${e.id}: ${item.kind}, at ${p[0].toFixed(2)} ${p[1].toFixed(2)} ${p[2].toFixed(2)}, scale ${item.transform.scale[0]} (${e.note})`);
  });
  await bridge.call("cr2w.fileToJson", { file: built.sector, outFile: jsonFile });
  const again = JSON.parse(fs.readFileSync(jsonFile, "utf8")).Data.RootChunk.nodes.map((x) => x.Data);
  for (const c of again.filter((x) => x.$type === "worldCollisionNode")) {
    const a = c.compiledData?.Data?.Actors?.[0];
    const size = a?.Shapes?.[0]?.Size;
    if (c.numActors !== 1 || !size) throw new Error(`${c.debugName?.$value}: the collision did not read back: ${JSON.stringify(c).slice(0, 500)}`);
    console.log(`  ${c.debugName.$value}: ${JSON.stringify(a.Shapes[0].ShapeType)} half size ${size.X.toFixed(2)} ${size.Y.toFixed(2)} ${size.Z.toFixed(2)}, centre ${(a.Position.x.Bits / 131072).toFixed(2)} ${(a.Position.y.Bits / 131072).toFixed(2)} ${(a.Position.z.Bits / 131072).toFixed(2)}, preset ${a.Shapes[0].Preset?.$value}, material ${a.Shapes[0].Materials?.[0]?.$value}, proxy ${a.Shapes[0].ProxyType}`);
  }
  fs.rmSync(jsonFile);

  const archiveDir = path.join(mod, "archive", "pc", "mod");
  fs.mkdirSync(archiveDir, { recursive: true });
  await bridge.call("project.pack", { dir: path.join(project, "source", "archive"), outDir: archiveDir, modName: name });
  fs.copyFileSync(built.xl, path.join(archiveDir, `${name}.archive.xl`));
  console.log(`mod folder: ${mod}`);
  for (const f of fs.readdirSync(archiveDir)) console.log(`  archive\\pc\\mod\\${f} (${fs.statSync(path.join(archiveDir, f)).size} bytes)`);
} catch (e) {
  console.error(String(e?.message ?? e).slice(0, 1500));
  console.error(bridge.log.slice(-12).join("\n").slice(0, 1500));
  process.exitCode = 1;
} finally {
  bridge.stop();
}
