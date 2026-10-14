// The geometry of the editor: vectors, quaternions, the camera (world to page pixels and back),
// picking (a ray against an object's box) and the constraints a drag follows. No game calls here;
// the page feeds it the camera matrix and the game's own ProjectPoint for calibration.

export type V3 = [number, number, number];
/** A quaternion, x y z w, as the scene file stores rotations. */
export type Q = [number, number, number, number];

export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mul = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
export const norm = (a: V3): V3 => {
  const l = len(a);
  return l > 1e-9 ? mul(a, 1 / l) : [0, 0, 0];
};

export const AXES: Record<"x" | "y" | "z", V3> = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };

export function qMul(a: Q, b: Q): Q {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [aw * bx + ax * bw + ay * bz - az * by, aw * by - ax * bz + ay * bw + az * bx, aw * bz + ax * by - ay * bx + az * bw, aw * bw - ax * bx - ay * by - az * bz];
}

export function qNorm(q: Q): Q {
  const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
}

/** A turn of `degrees` around a world axis. */
export function qAxisAngle(axis: V3, degrees: number): Q {
  const n = norm(axis);
  const h = (degrees * Math.PI) / 360;
  const s = Math.sin(h);
  return [n[0] * s, n[1] * s, n[2] * s, Math.cos(h)];
}

/** Rotates a vector by a unit quaternion. */
export function qRotate(q: Q, v: V3): V3 {
  const u: V3 = [q[0], q[1], q[2]];
  const t = mul(cross(u, v), 2);
  return add(add(v, mul(t, q[3])), cross(u, t));
}

/** The heading of a rotation, in degrees: the angle of its forward (+Y) around the vertical, 0 = north. */
export function qYaw(q: Q): number {
  const f = qRotate(q, [0, 1, 0]);
  return (Math.atan2(-f[0], f[1]) * 180) / Math.PI;
}

// ---- the camera ----------------------------------------------------------------------------------

/** What one frame needs to know about the game's camera. */
export interface Camera {
  pos: V3;
  right: V3;
  fwd: V3;
  up: V3;
  /** Screen units per unit of (side / depth), learned from ProjectPoint. */
  kx: number;
  ky: number;
  /** Where the screen centre is, in ProjectPoint's units, and how they map to the page. */
  cx: number;
  cy: number;
  /** ProjectPoint units across the whole screen, and whether its y grows downwards. */
  spanX: number;
  spanY: number;
  yDown: boolean;
  /** The page's size in its own pixels. */
  pageW: number;
  pageH: number;
}

/** A 4x4 matrix as the game gives it: rows X, Y, Z (axes) and W (position). */
export interface GameMatrix {
  X: { X: number; Y: number; Z: number };
  Y: { X: number; Y: number; Z: number };
  Z: { X: number; Y: number; Z: number };
  W: { X: number; Y: number; Z: number };
}

const v = (r: { X: number; Y: number; Z: number }): V3 => [r.X, r.Y, r.Z];

/** The camera's place and axes from its local-to-world matrix. REDengine: X right, Y forward, Z up. */
export function basisFromMatrix(m: GameMatrix): { pos: V3; right: V3; fwd: V3; up: V3 } {
  return { pos: v(m.W), right: norm(v(m.X)), fwd: norm(v(m.Y)), up: norm(v(m.Z)) };
}

/** What calibration learned: everything in Camera except the per-frame basis. */
export type Calibration = Pick<Camera, "kx" | "ky" | "cx" | "cy" | "spanX" | "spanY" | "yDown">;

/**
 * The points calibration asks the game to project: straight ahead, to the right and above, at 10 m.
 * Returns them with the camera-space offsets they were made from.
 */
export function calibrationPoints(b: { pos: V3; right: V3; fwd: V3; up: V3 }): V3[] {
  const ahead = add(b.pos, mul(b.fwd, 10));
  return [ahead, add(ahead, mul(b.right, 2)), add(ahead, mul(b.up, 2))];
}

/**
 * Learns how the game's ProjectPoint maps camera space to the screen from the three points above.
 * ProjectPoint may answer in -1..1 or in pixels, with y up or down; this finds out which, so the
 * page can project locally without asking the game for every point.
 */
export function calibrate(projected: { X: number; Y: number }[]): Calibration {
  const [c, r, u] = projected;
  const kx = (r.X - c.X) / 0.2; // 2 m to the side at 10 m depth
  const kyRaw = (u.Y - c.Y) / 0.2;
  const yDown = kyRaw < 0;
  const ndc = Math.abs(c.X) < 0.5 && Math.abs(c.Y) < 0.5;
  const spanX = ndc ? 2 : Math.max(1, c.X * 2);
  const spanY = ndc ? 2 : Math.max(1, c.Y * 2);
  return { kx, ky: Math.abs(kyRaw), cx: c.X, cy: c.Y, spanX, spanY, yDown };
}

/** A world point in page pixels, or null when it is behind the camera. */
export function project(cam: Camera, p: V3): [number, number] | null {
  const d = sub(p, cam.pos);
  const z = dot(d, cam.fwd);
  if (z < 0.05) return null;
  const sx = cam.cx + (cam.kx * dot(d, cam.right)) / z;
  const upward = (cam.ky * dot(d, cam.up)) / z;
  const sy = cam.yDown ? cam.cy - upward : cam.cy + upward;
  // From ProjectPoint units to the page: the centre is the page centre, the span is the page size.
  const px = cam.pageW / 2 + ((sx - cam.cx) / cam.spanX) * cam.pageW;
  const pyOff = ((sy - cam.cy) / cam.spanY) * cam.pageH;
  const py = cam.pageH / 2 + (cam.yDown ? pyOff : -pyOff);
  return [px, py];
}

export interface Ray {
  o: V3;
  d: V3;
}

/** The ray from the camera through a page pixel. */
export function rayFrom(cam: Camera, px: number, py: number): Ray {
  const a = (((px - cam.pageW / 2) / cam.pageW) * cam.spanX) / cam.kx;
  const b = ((-(py - cam.pageH / 2) / cam.pageH) * cam.spanY) / cam.ky;
  return { o: cam.pos, d: norm(add(add(cam.fwd, mul(cam.right, a)), mul(cam.up, b))) };
}

// ---- picking and constraints ------------------------------------------------------------------------

export interface Box {
  min: V3;
  max: V3;
}

/**
 * Where a ray enters an object's box, as a distance along the ray, or null when it misses.
 * The box is the asset's local bounds, scaled, rotated and placed as the object is.
 */
export function rayHitsBox(ray: Ray, box: Box, position: V3, rotation: Q, scale: V3): number | null {
  // Into the object's frame: undo the placement and rotation, then test an axis-aligned box.
  const inv: Q = [-rotation[0], -rotation[1], -rotation[2], rotation[3]];
  const o = qRotate(inv, sub(ray.o, position));
  const d = qRotate(inv, ray.d);
  let tMin = -Infinity;
  let tMax = Infinity;
  for (let i = 0; i < 3; i++) {
    const lo = box.min[i] * scale[i];
    const hi = box.max[i] * scale[i];
    const a = Math.min(lo, hi);
    const b = Math.max(lo, hi);
    if (Math.abs(d[i]) < 1e-9) {
      if (o[i] < a || o[i] > b) return null;
      continue;
    }
    let t1 = (a - o[i]) / d[i];
    let t2 = (b - o[i]) / d[i];
    if (t1 > t2) [t1, t2] = [t2, t1];
    tMin = Math.max(tMin, t1);
    tMax = Math.min(tMax, t2);
    if (tMin > tMax) return null;
  }
  if (tMax < 0) return null;
  return tMin >= 0 ? tMin : 0;
}

/** The distance along an axis line (through `origin`, along unit `axis`) closest to a ray. */
export function closestOnAxis(ray: Ray, origin: V3, axis: V3): number | null {
  const w = sub(origin, ray.o);
  const b = dot(axis, ray.d);
  const denom = 1 - b * b;
  if (denom < 1e-6) return null; // looking straight down the axis
  return (b * dot(ray.d, w) - dot(axis, w)) / denom;
}

/** Where a ray meets the horizontal plane at height `z`, or null when it runs parallel or away. */
export function rayOnPlaneZ(ray: Ray, z: number): V3 | null {
  if (Math.abs(ray.d[2]) < 1e-6) return null;
  const t = (z - ray.o[2]) / ray.d[2];
  return t > 0 ? add(ray.o, mul(ray.d, t)) : null;
}

/** Distance from a point to a segment, in page pixels. */
export function distToSegment(p: [number, number], a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

// ---- the editor camera (B2b) -------------------------------------------------------------------------

/** A camera's heading and pitch, in degrees: heading 0 looks north (+Y), positive pitch looks up. */
export interface Look {
  yaw: number;
  pitch: number;
}

/** The rotation of a camera that looks with this heading and pitch (forward is +Y, as REDengine has it). */
export function qLook(l: Look): Q {
  return qNorm(qMul(qAxisAngle([0, 0, 1], l.yaw), qAxisAngle([1, 0, 0], l.pitch)));
}

/** Heading and pitch of a forward direction. */
export function lookOf(fwd: V3): Look {
  const f = norm(fwd);
  return { yaw: (Math.atan2(-f[0], f[1]) * 180) / Math.PI, pitch: (Math.asin(Math.max(-1, Math.min(1, f[2]))) * 180) / Math.PI };
}

/** The forward, right and up of a heading and pitch. */
export function lookAxes(l: Look): { fwd: V3; right: V3; up: V3 } {
  const q = qLook(l);
  return { fwd: qRotate(q, [0, 1, 0]), right: qRotate(q, [1, 0, 0]), up: qRotate(q, [0, 0, 1]) };
}

/** The look from a point towards another. */
export function lookAt(from: V3, to: V3): Look {
  return lookOf(sub(to, from));
}
