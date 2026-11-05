// Bake probe, round 3 (B4): which node type gives a mesh its collision. The same crate in a row, one node
// type or setting each. sector.build writes plain mesh nodes; this rewrites them through CR2W JSON, so
// no REDbridge change is needed to find the answer. The node-data entries stay as sector.build wrote them:
// the game's own instanced destructible and dynamic mesh nodes have the same flags and priority.
//   npm run build
//   node scripts/solid-probe.mjs <out folder> [--x X --y Y --z Z]
// EDGEBUILDER_BRIDGE (REDbridge with sector.nodes, 0.12.0 or later) and EDGEBUILDER_GAME as for the smoke test.
// Writes <out>/project and <out>/mod (archive\pc\mod\...), for EDGEdeck.
import * as fs from "node:fs";
import * as path from "node:path";
import { BridgeClient, isGameFolder } from "../dist/core.mjs";

const args = process.argv.slice(2);
const out = args.find((a) => !a.startsWith("--") && !/^-?[\d.]+$/.test(a));
const exe = process.env.EDGEBUILDER_BRIDGE;
const game = [process.env.EDGEBUILDER_GAME, "E:\\SteamLibrary\\steamapps\\common\\Cyberpunk 2077", "C:\\Program Files (x86)\\Steam\\steamapps\\common\\Cyberpunk 2077"].find((p) => p && isGameFolder(p));
if (!out || !exe || !game) {
  console.error("usage: EDGEBUILDER_BRIDGE=<REDbridge.exe> node scripts/solid-probe.mjs <out folder> [--x X --y Y --z Z]");
  process.exit(2);
}
const num = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : fallback;
};
// Default: the Watson street of rounds 1 and 2, going west.
const start = [num("x", -1439.15), num("y", 1214.04), num("z", 23.07)];

const name = "edgebuilder_bake_probe";
const resource = "base\\environment\\decoration\\containers\\cargo\\cargo_crate\\cargo_crate_a.mesh";
const ref = (path) => ({ DepotPath: { $type: "ResourcePath", $storage: path ? "string" : "uint64", $value: path ?? "0" }, Flags: "Soft" });
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

// Going west. `make` turns sector.build's plain mesh node into the one under test.
const row = [
  { id: "a_plain", west: 0, note: "worldMeshNode, the reference: no collision", make: (n) => n },
  { id: "b_kinematic", west: 3, note: "instanced destructible, Kinematic", make: (n, h) => destructible(n, h, { simulationType: "Kinematic" }) },
  { id: "c_static", west: 6, note: "instanced destructible, Static", make: (n, h) => destructible(n, h, { simulationType: "Static" }) },
  { id: "d_impulse", west: 9, note: "instanced destructible, Kinematic, turns dynamic on impulse", make: (n, h) => destructible(n, h, { simulationType: "Kinematic", turnDynamicOnImpulse: true }) },
  { id: "e_dynamic", west: 12, note: "worldDynamicMeshNode, asleep at the start", make: (n) => dynamic(n) },
  { id: "f_big", west: 16, scale: 2, note: "as b_kinematic, scale 2: does the collision grow with it?", make: (n, h) => destructible(n, h, { simulationType: "Kinematic" }) },
];

const project = path.resolve(out, "project");
const mod = path.resolve(out, "mod");
fs.rmSync(path.resolve(out), { recursive: true, force: true });
fs.mkdirSync(project, { recursive: true });

const scene = {
  format: 1,
  name,
  game: "2.5",
  groups: [],
  objects: row.map((r) => {
    const s = r.scale ?? 1;
    return {
      id: r.id,
      kind: "mesh",
      resource,
      appearance: "default",
      transform: { position: [start[0] - r.west, start[1], start[2]], rotation: [0, 0, 0, 1], scale: [s, s, s] },
      streaming: { primary: 120, secondary: 96 },
    };
  }),
};

const bridge = new BridgeClient(exe, game);
bridge.start();
try {
  const info = await bridge.info();
  console.log(`REDbridge ${info.version}, game ${info.gameVersion ?? "?"}, ${info.files} files`);
  const built = await bridge.call("sector.build", { project, scene });
  console.log(`sector.build: ${built.nodes} nodes; warnings: ${built.warnings.length ? built.warnings.join("; ") : "none"}`);

  const jsonFile = path.resolve(out, "sector.json");
  await bridge.call("cr2w.fileToJson", { file: built.sector, outFile: jsonFile });
  const doc = JSON.parse(fs.readFileSync(jsonFile, "utf8"));
  const nodes = doc.Data.RootChunk.nodes;
  if (nodes.length !== row.length) throw new Error(`expected ${row.length} nodes, found ${nodes.length}`);
  row.forEach((r, i) => {
    nodes[i].Data = r.make(nodes[i].Data, 9000 + i);
  });
  fs.writeFileSync(jsonFile, JSON.stringify(doc));
  await bridge.call("cr2w.fromJson", { outFile: built.sector, jsonFile });

  // It reads back as written, and each object is where the scene says.
  const back = await bridge.call("sector.nodes", { path: built.sectorPath, root: path.join(project, "source", "archive") });
  back.items.forEach((n, i) => console.log(`  ${row[i].id}: ${n.kind}, x ${n.transform.position[0].toFixed(2)}, scale ${n.transform.scale[0]} (${row[i].note})`));
  if (back.items.length !== row.length) throw new Error(`read back ${back.items.length} items`);
  fs.rmSync(jsonFile);

  const archiveDir = path.join(mod, "archive", "pc", "mod");
  fs.mkdirSync(archiveDir, { recursive: true });
  await bridge.call("project.pack", { dir: path.join(project, "source", "archive"), outDir: archiveDir, modName: name });
  fs.copyFileSync(built.xl, path.join(archiveDir, `${name}.archive.xl`));
  console.log(`mod folder: ${mod}`);
  for (const f of fs.readdirSync(archiveDir)) console.log(`  archive\\pc\\mod\\${f} (${fs.statSync(path.join(archiveDir, f)).size} bytes)`);
} catch (e) {
  console.error(String(e?.message ?? e));
  console.error(bridge.log.slice(-20).join("\n"));
  process.exitCode = 1;
} finally {
  bridge.stop();
}
