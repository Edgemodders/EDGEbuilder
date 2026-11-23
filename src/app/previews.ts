// The Previews drawer's pictures (0.14.0): a search result's mesh, drawn from the plain GLB REDbridge
// exported, in light grey under a soft light, framed to fit. Built into edgebuilder/previews.js with
// three.js, and loaded only when the drawer first opens, so the window starts as fast as before.
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

/** One model: a mesh's GLB, and for an entity's part its offset and scale in the entity, in the game's axes (Z up). */
export interface Part {
  glb: ArrayBuffer;
  offset?: number[];
  scale?: number[];
}

export interface Previews {
  /** A still picture of the models together, as a PNG data URL. */
  picture(parts: Part[]): Promise<string>;
  /** The models turning slowly in this canvas until the returned function is called. */
  spin(parts: Part[], into: HTMLCanvasElement): Promise<() => void>;
}

/** Throws when the page has no WebGL: the drawer then shows names only. */
export function createPreviews(size = 256): Previews {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(size, size, false);
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x2a2e36, 1.5));
  const key = new THREE.DirectionalLight(0xffffff, 2.4);
  const fill = new THREE.DirectionalLight(0xbfd4ff, 0.7);
  scene.add(key, fill);
  const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 100000);
  const material = new THREE.MeshStandardMaterial({ color: 0xc9cdd6, roughness: 0.75, metalness: 0.05, side: THREE.DoubleSide });
  const loader = new GLTFLoader();
  /** The model turning under the mouse, hidden while a still picture of another is taken. */
  let spinning: THREE.Object3D | undefined;

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

  const dispose = (root: THREE.Object3D) => {
    scene.remove(root);
    root.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
  };

  /** A three-quarter view from above, turned `turn` radians around the model's middle. */
  const shoot = (root: THREE.Object3D, turn: number) => {
    const box = new THREE.Box3().setFromObject(root);
    const middle = box.getCenter(new THREE.Vector3());
    const radius = Math.max(0.01, box.getBoundingSphere(new THREE.Sphere()).radius);
    const distance = (radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2))) * 1.05;
    const from = new THREE.Vector3(Math.sin(turn + Math.PI / 4), 0.55, Math.cos(turn + Math.PI / 4)).normalize();
    camera.position.copy(middle).addScaledVector(from, distance);
    camera.near = distance / 100;
    camera.far = distance * 10;
    camera.updateProjectionMatrix();
    camera.lookAt(middle);
    key.position.copy(camera.position).add(new THREE.Vector3(radius, radius * 2, 0));
    fill.position.copy(middle).addScaledVector(from, -distance).add(new THREE.Vector3(0, radius, 0));
    renderer.render(scene, camera);
  };

  return {
    async picture(parts) {
      const root = await load(parts);
      scene.add(root);
      if (spinning) spinning.visible = false;
      try {
        shoot(root, 0);
        return canvas.toDataURL("image/png");
      } finally {
        dispose(root);
        if (spinning) spinning.visible = true;
      }
    },
    async spin(parts, into) {
      const root = await load(parts);
      if (spinning) spinning.visible = false;
      spinning = root;
      scene.add(root);
      const ctx = into.getContext("2d")!;
      let stopped = false;
      const start = performance.now();
      const frame = () => {
        if (stopped) return;
        // One turn every eight seconds; the model stays in this scene only while it turns.
        shoot(root, ((performance.now() - start) / 8000) * Math.PI * 2);
        ctx.clearRect(0, 0, into.width, into.height);
        ctx.drawImage(canvas, 0, 0, into.width, into.height);
        requestAnimationFrame(frame);
      };
      frame();
      return () => {
        stopped = true;
        if (spinning === root) spinning = undefined;
        dispose(root);
      };
    },
  };
}
