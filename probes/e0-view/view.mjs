// E0's viewer page: one sector from E0's manifest, each unique mesh loaded once from its GLB and drawn as
// instances at every copy's place, copies beyond their streaming distance left out (checked a few times a
// second), entities and lights as markers. window.e0.fly() flies a fixed path and measures the frames,
// for the numbers on EDGEbuilder #8. Right-drag looks, WASD moves (Shift faster), Q and E go down and up.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const hud = document.getElementById("hud");
const params = new URLSearchParams(location.search);
const manifestFile = params.get("manifest");
const fileUrl = (p) => "file:///" + p.replace(/\\/g, "/").split("/").map(encodeURIComponent).join("/").replace(/^([A-Za-z])%3A/, "$1:");

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(1);
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0d12);
scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x30281e, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 1.4);
sun.position.set(0.4, 1, 0.3);
scene.add(sun);
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 3000);
addEventListener("resize", () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});

// Cyberpunk is Z-up; WolvenKit's GLBs are Y-up: (x, y, z) in the game is (x, z, -y) here.
const C = new THREE.Matrix4().set(1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1);
const Cinv = C.clone().invert();
const toThree = (p) => new THREE.Vector3(p[0], p[2], -p[1]);
function placementMatrix(t) {
  const m = new THREE.Matrix4().compose(new THREE.Vector3(...t.position), new THREE.Quaternion(...t.rotation), new THREE.Vector3(...(t.scale ?? [1, 1, 1])));
  return new THREE.Matrix4().multiplyMatrices(C, m).multiply(Cinv);
}
const colourOf = (name) => {
  let h = 2166136261;
  for (const c of name) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return new THREE.Color().setHSL(((h >>> 0) % 360) / 360, 0.35, 0.55);
};

/** Each mesh: its copies' places (here, Y-up) and ranges, and one InstancedMesh per primitive. */
const groups = [];
let markerGroups = [];
let totalCopies = 0;
let cull = true;

async function load() {
  if (!manifestFile) throw new Error("No manifest: start with --manifest=<file>");
  const manifest = await (await fetch(fileUrl(manifestFile))).json();
  const loader = new GLTFLoader();
  const started = performance.now();
  let loaded = 0;
  for (const m of manifest.meshes) {
    let gltf;
    try {
      gltf = await loader.loadAsync(fileUrl(`${manifest.cache}/${m.glb}`));
    } catch (err) {
      console.warn(m.mesh, err.message);
      continue;
    }
    gltf.scene.updateMatrixWorld(true);
    const places = m.copies.map((c) => ({ m: placementMatrix(c), at: toThree(c.position), range: c.range ?? Infinity }));
    const material = new THREE.MeshLambertMaterial({ color: colourOf(m.mesh) });
    const parts = [];
    gltf.scene.traverse((o) => {
      if (!o.isMesh) return;
      const inst = new THREE.InstancedMesh(o.geometry, material, places.length);
      inst.frustumCulled = false;
      const local = o.matrixWorld.clone();
      const all = places.map((p) => new THREE.Matrix4().multiplyMatrices(p.m, local));
      all.forEach((mm, i) => inst.setMatrixAt(i, mm));
      scene.add(inst);
      parts.push({ inst, all });
    });
    groups.push({ mesh: m.mesh, places, parts });
    totalCopies += places.length;
    loaded++;
    if (loaded % 25 === 0) hud.textContent = `Loading ${loaded} of ${manifest.meshes.length} meshes...`;
  }
  // Markers: entities and lights, which E0 does not export.
  const kinds = { worldEntityNode: 0xf4d03f, worldStaticLightNode: 0xffffff };
  markerGroups = Object.entries(kinds).map(([kind, colour]) => {
    const list = manifest.markers.filter((x) => x.kind === kind);
    const geo = kind === "worldEntityNode" ? new THREE.BoxGeometry(0.8, 2, 0.8) : new THREE.SphereGeometry(0.25, 8, 6);
    const inst = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color: colour }), Math.max(1, list.length));
    list.forEach((x, i) => inst.setMatrixAt(i, new THREE.Matrix4().makeTranslation(toThree(x.position).add(new THREE.Vector3(0, kind === "worldEntityNode" ? 1 : 0, 0)))));
    inst.count = list.length;
    scene.add(inst);
    return { kind, count: list.length };
  });
  // The camera above the middle of everything, looking down at it.
  const box = new THREE.Box3();
  for (const g of groups) for (const p of g.places) box.expandByPoint(p.at);
  const mid = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  camera.position.set(mid.x - size.x * 0.6, mid.y + Math.max(40, size.y), mid.z + size.z * 0.6);
  camera.lookAt(mid);
  return { sector: manifest.sector, meshes: groups.length, parts: groups.reduce((n, g) => n + g.parts.length, 0), copies: totalCopies, markers: markerGroups, loadMs: Math.round(performance.now() - started), box: { min: box.min.toArray(), max: box.max.toArray() } };
}

/** Leaves out the copies beyond their streaming distance (all of them with cull off). */
function applyCull() {
  let shown = 0;
  const eye = camera.position;
  for (const g of groups) {
    const keep = [];
    g.places.forEach((p, i) => {
      if (!cull || p.at.distanceTo(eye) <= p.range) keep.push(i);
    });
    shown += keep.length;
    for (const part of g.parts) {
      keep.forEach((i, j) => part.inst.setMatrixAt(j, part.all[i]));
      part.inst.count = keep.length;
      part.inst.instanceMatrix.needsUpdate = true;
    }
  }
  return shown;
}

// ---- flying -------------------------------------------------------------------------------------
const keys = new Set();
addEventListener("keydown", (e) => keys.add(e.key.toLowerCase()));
addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));
let looking = false;
let yaw = 0;
let pitch = 0;
renderer.domElement.addEventListener("contextmenu", (e) => e.preventDefault());
renderer.domElement.addEventListener("mousedown", (e) => {
  if (e.button !== 2) return;
  looking = true;
  const d = camera.getWorldDirection(new THREE.Vector3());
  yaw = Math.atan2(-d.x, -d.z);
  pitch = Math.asin(d.y);
});
addEventListener("mouseup", () => (looking = false));
addEventListener("mousemove", (e) => {
  if (!looking) return;
  yaw -= e.movementX * 0.003;
  pitch = Math.max(-1.5, Math.min(1.5, pitch - e.movementY * 0.003));
  camera.quaternion.setFromEuler(new THREE.Euler(pitch, yaw, 0, "YXZ"));
});

let flight = null;
let shownNow = 0;
let lastCull = 0;
let frames = [];
let lastFrame = performance.now();
function frame(now) {
  const dt = Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;
  if (flight) {
    const t = Math.min(1, (now - flight.start) / flight.ms);
    camera.position.lerpVectors(flight.from, flight.to, t);
    camera.lookAt(flight.look(t));
    frames.push({ at: now, calls: renderer.info.render.calls, tris: renderer.info.render.triangles });
    if (t >= 1) {
      const done = flight;
      flight = null;
      done.resolve(summary(done));
    }
  } else {
    const speed = keys.has("shift") ? 60 : 15;
    const move = new THREE.Vector3((keys.has("d") ? 1 : 0) - (keys.has("a") ? 1 : 0), (keys.has("e") ? 1 : 0) - (keys.has("q") ? 1 : 0), (keys.has("s") ? 1 : 0) - (keys.has("w") ? 1 : 0));
    if (move.lengthSq()) camera.position.add(move.multiplyScalar(speed * dt).applyQuaternion(camera.quaternion));
  }
  if (now - lastCull > 250) {
    shownNow = applyCull();
    lastCull = now;
  }
  renderer.render(scene, camera);
  hud.textContent = `${info?.sector?.split("\\").pop() ?? ""}\n${info ? `${info.meshes} meshes, ${info.copies} copies; ${shownNow} shown${cull ? " (by streaming distance)" : " (all)"}` : ""}\ndraw calls ${renderer.info.render.calls}, triangles ${renderer.info.render.triangles.toLocaleString()}\nright-drag look, WASD QE move, Shift faster`;
  requestAnimationFrame(frame);
}

function summary(f) {
  const list = frames.filter((x) => x.at >= f.start);
  const gaps = list.slice(1).map((x, i) => x.at - list[i].at).sort((a, b) => a - b);
  const avg = gaps.reduce((a, b) => a + b, 0) / Math.max(1, gaps.length);
  const p95 = gaps[Math.floor(gaps.length * 0.95)] ?? 0;
  const calls = Math.max(...list.map((x) => x.calls));
  const tris = Math.max(...list.map((x) => x.tris));
  return { path: f.name, cull, frames: list.length, fps: +(1000 / avg).toFixed(1), avgMs: +avg.toFixed(2), p95Ms: +p95.toFixed(2), maxDrawCalls: calls, maxTriangles: tris };
}

let info;
window.e0 = {
  ready: load().then((r) => (info = r)),
  info: () => info,
  setCull: (on) => {
    cull = on;
    lastCull = 0;
  },
  /** Flies a path for `seconds`: "street" through the middle at 2 m above the ground, or "above" across at 80 m looking down. */
  fly(name = "street", seconds = 10) {
    const b = new THREE.Box3(new THREE.Vector3(...info.box.min), new THREE.Vector3(...info.box.max));
    const mid = b.getCenter(new THREE.Vector3());
    const ground = b.min.y + 2;
    const from = name === "street" ? new THREE.Vector3(b.min.x, ground, mid.z) : new THREE.Vector3(b.min.x, b.max.y + 80, b.min.z);
    const to = name === "street" ? new THREE.Vector3(b.max.x, ground, mid.z) : new THREE.Vector3(b.max.x, b.max.y + 80, b.max.z);
    frames = [];
    return new Promise((resolve) => {
      flight = { name, from, to, ms: seconds * 1000, start: performance.now(), resolve, look: (t) => (name === "street" ? new THREE.Vector3().lerpVectors(from, to, Math.min(1, t + 0.1)) : mid) };
    });
  },
};
requestAnimationFrame(frame);
window.e0.ready.catch((err) => (hud.textContent = `Failed: ${err.message}`));
