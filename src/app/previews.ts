// The 3D pictures (0.14.0): a mesh, or an entity's meshes, drawn from the plain GLBs REDbridge exported, in
// light grey under a soft light, framed to fit. The Previews drawer's tiles, the Explorer's preview (turned with
// the mouse), and the edges Drop at click draws where the object would land. Built into edgebuilder/previews.js
// with three.js, and loaded only when first needed, so the window starts as fast as before.
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

/** One model: a mesh's GLB, and for an entity's part its offset and scale in the entity, in the game's axes (Z up). */
export interface Part {
  glb: ArrayBuffer;
  offset?: number[];
  scale?: number[];
}

/** The Explorer's preview while it shows: the mouse turns it (drag) and brings it nearer (wheel). */
export interface View {
  stop(): void;
}

export interface Previews {
  /** A still picture of the models together, as a PNG data URL. */
  picture(parts: Part[]): Promise<string>;
  /** The models turning slowly in this canvas until the returned function is called. */
  spin(parts: Part[], into: HTMLCanvasElement): Promise<() => void>;
  /** The models in this canvas, turning slowly until the mouse takes them: drag turns, the wheel brings them nearer. */
  view(parts: Part[], into: HTMLCanvasElement): Promise<View>;
  /**
   * The models' sharp edges as line pairs in the object's own space, game axes (x, y, z, x, y, z per line), for
   * Drop at click's outline. Undefined when even the sharpest edges are more than `max` lines.
   */
  edges(parts: Part[], max?: number): Promise<Float32Array | undefined>;
}

interface Stage {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  key: THREE.DirectionalLight;
  fill: THREE.DirectionalLight;
}

function makeRenderer(width: number, height: number): THREE.WebGLRenderer {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(width, height, false);
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  return renderer;
}

function makeStage(): Stage {
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x2a2e36, 1.5));
  const key = new THREE.DirectionalLight(0xffffff, 2.4);
  const fill = new THREE.DirectionalLight(0xbfd4ff, 0.7);
  scene.add(key, fill);
  return { scene, camera: new THREE.PerspectiveCamera(30, 1, 0.01, 100000), key, fill };
}

/** Throws when the page has no WebGL: the drawers then show names only. */
export function createPreviews(size = 256): Previews {
  const renderer = makeRenderer(size, size);
  const stage = makeStage();
  const material = new THREE.MeshStandardMaterial({ color: 0xc9cdd6, roughness: 0.75, metalness: 0.05, side: THREE.DoubleSide });
  const loader = new GLTFLoader();
  /** The model turning under the mouse, hidden while a still picture of another is taken. */
  let spinning: THREE.Object3D | undefined;
  /** The Explorer's preview draws with its own renderer and stage, made at its first use. */
  let big: { renderer: THREE.WebGLRenderer; stage: Stage; showing?: THREE.Object3D } | undefined;

  // A GLB is in glTF's axes (Y up): the game's (x, y, z) is glTF's (x, z, -y), as in REDcode's world-view.
  const load = async (parts: Part[]): Promise<THREE.Object3D> => {
    const root = new THREE.Group();
    for (const p of parts) {
      const gltf = await loader.parseAsync(p.glb.slice(0), "");
      gltf.scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) mesh.material = material;
      });
      const [x, y, z] = p.offset ?? [0, 0, 0];
      const [sx, sy, sz] = p.scale ?? [1, 1, 1];
      gltf.scene.position.set(x, z, -y);
      gltf.scene.scale.set(sx || 1, sz || 1, sy || 1);
      root.add(gltf.scene);
    }
    return root;
  };

  const dispose = (root: THREE.Object3D, from: THREE.Scene) => {
    from.remove(root);
    root.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
  };

  /** A view from above (`tilt` 0.55 is three-quarters), turned `turn` radians around the model's middle, `zoom` 1 to fit. */
  const shoot = (on: THREE.WebGLRenderer, st: Stage, root: THREE.Object3D, turn: number, tilt = 0.55, zoom = 1) => {
    const box = new THREE.Box3().setFromObject(root);
    const middle = box.getCenter(new THREE.Vector3());
    const radius = Math.max(0.01, box.getBoundingSphere(new THREE.Sphere()).radius);
    const { camera, key, fill } = st;
    const fov = Math.min(camera.fov, camera.fov * camera.aspect);
    const distance = ((radius / Math.sin(THREE.MathUtils.degToRad(fov / 2))) * 1.05) / zoom;
    const from = new THREE.Vector3(Math.sin(turn + Math.PI / 4), tilt, Math.cos(turn + Math.PI / 4)).normalize();
    camera.position.copy(middle).addScaledVector(from, distance);
    camera.near = distance / 100;
    camera.far = distance * 10;
    camera.updateProjectionMatrix();
    camera.lookAt(middle);
    key.position.copy(camera.position).add(new THREE.Vector3(radius, radius * 2, 0));
    fill.position.copy(middle).addScaledVector(from, -distance).add(new THREE.Vector3(0, radius, 0));
    on.render(st.scene, camera);
  };

  return {
    async picture(parts) {
      const root = await load(parts);
      stage.scene.add(root);
      if (spinning) spinning.visible = false;
      try {
        shoot(renderer, stage, root, 0);
        return renderer.domElement.toDataURL("image/png");
      } finally {
        dispose(root, stage.scene);
        if (spinning) spinning.visible = true;
      }
    },

    async spin(parts, into) {
      const root = await load(parts);
      if (spinning) spinning.visible = false;
      spinning = root;
      stage.scene.add(root);
      const ctx = into.getContext("2d")!;
      let stopped = false;
      const start = performance.now();
      const frame = () => {
        if (stopped) return;
        // One turn every eight seconds; the model stays in this scene only while it turns.
        shoot(renderer, stage, root, ((performance.now() - start) / 8000) * Math.PI * 2);
        ctx.clearRect(0, 0, into.width, into.height);
        ctx.drawImage(renderer.domElement, 0, 0, into.width, into.height);
        requestAnimationFrame(frame);
      };
      frame();
      return () => {
        stopped = true;
        if (spinning === root) spinning = undefined;
        dispose(root, stage.scene);
      };
    },

    async view(parts, into) {
      const root = await load(parts);
      if (!big || big.renderer.domElement.width !== into.width || big.renderer.domElement.height !== into.height) {
        big?.renderer.dispose();
        big = { renderer: makeRenderer(into.width, into.height), stage: makeStage() };
        big.stage.camera.aspect = into.width / into.height;
      }
      const b = big;
      if (b.showing) dispose(b.showing, b.stage.scene);
      b.showing = root;
      b.stage.scene.add(root);
      const ctx = into.getContext("2d")!;
      let stopped = false;
      let turn = 0;
      let tilt = 0.55;
      let zoom = 1;
      let held: { x: number; y: number } | undefined;
      let idleSince = performance.now();
      let last = performance.now();
      const down = (e: PointerEvent) => {
        held = { x: e.clientX, y: e.clientY };
        into.setPointerCapture(e.pointerId);
      };
      const move = (e: PointerEvent) => {
        if (!held) return;
        turn -= (e.clientX - held.x) * 0.012;
        tilt = Math.max(-1.2, Math.min(2.5, tilt + (e.clientY - held.y) * 0.01));
        held = { x: e.clientX, y: e.clientY };
      };
      const up = () => {
        held = undefined;
        idleSince = performance.now();
      };
      const wheel = (e: WheelEvent) => {
        e.preventDefault();
        zoom = Math.max(0.5, Math.min(6, zoom * Math.exp(-e.deltaY * 0.0015)));
      };
      into.addEventListener("pointerdown", down);
      into.addEventListener("pointermove", move);
      into.addEventListener("pointerup", up);
      into.addEventListener("pointercancel", up);
      into.addEventListener("wheel", wheel, { passive: false });
      const frame = () => {
        if (stopped) return;
        const now = performance.now();
        // It turns by itself (one turn in twelve seconds) until the mouse takes it, and again two seconds after.
        if (!held && now - idleSince > 2000) turn += ((now - last) / 12000) * Math.PI * 2;
        last = now;
        shoot(b.renderer, b.stage, root, turn, tilt, zoom);
        ctx.clearRect(0, 0, into.width, into.height);
        ctx.drawImage(b.renderer.domElement, 0, 0);
        requestAnimationFrame(frame);
      };
      idleSince = -Infinity;
      frame();
      return {
        stop() {
          stopped = true;
          into.removeEventListener("pointerdown", down);
          into.removeEventListener("pointermove", move);
          into.removeEventListener("pointerup", up);
          into.removeEventListener("pointercancel", up);
          into.removeEventListener("wheel", wheel);
          if (b.showing === root) {
            dispose(root, b.stage.scene);
            b.showing = undefined;
          }
        },
      };
    },

    async edges(parts, max = 12000) {
      const root = await load(parts);
      root.updateMatrixWorld(true);
      const meshes: THREE.Mesh[] = [];
      root.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
      });
      try {
        // Edges where faces meet at more than this angle; a busy model gets only its sharpest.
        for (const angle of [30, 50, 75]) {
          const lines: THREE.BufferGeometry[] = [];
          let count = 0;
          for (const m of meshes) {
            const g = new THREE.EdgesGeometry(m.geometry, angle);
            g.applyMatrix4(m.matrixWorld);
            count += g.getAttribute("position").count / 2;
            lines.push(g);
            if (count > max) break;
          }
          if (count > max) {
            for (const g of lines) g.dispose();
            continue;
          }
          const out = new Float32Array(count * 6);
          let i = 0;
          for (const g of lines) {
            const a = g.getAttribute("position");
            for (let v = 0; v < a.count; v++) {
              // glTF's (x, y, z) is the game's (x, -z, y).
              out[i++] = a.getX(v);
              out[i++] = -a.getZ(v);
              out[i++] = a.getY(v);
            }
            g.dispose();
          }
          return out;
        }
        return undefined;
      } finally {
        root.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
      }
    },
  };
}
