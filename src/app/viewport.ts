// The viewport: a canvas over the whole game view. It follows the game's camera each frame, draws
// the gizmo on the selected object, picks objects under the cursor, and turns drags and keys into
// new transforms. Previews move live through REDnode's world API; the mod keeps the result.

import { api, game, world, type GameRef } from "rednode";
import {
  AXES,
  add,
  basisFromMatrix,
  calibrate,
  calibrationPoints,
  closestOnAxis,
  distToSegment,
  mul,
  norm,
  project,
  qAxisAngle,
  qMul,
  qNorm,
  qRotate,
  rayFrom,
  rayHitsBox,
  rayOnPlaneZ,
  sub,
  type Calibration,
  type Camera,
  type GameMatrix,
  type Q,
  type V3,
} from "../math";
import type { SceneObject, SceneTransform } from "../protocol";

type Axis = "x" | "y" | "z";
type Handle = Axis | "ring";
type Mode = "move" | "rotate" | "scale";

const COLORS: Record<Handle, string> = { x: "#ff4d5e", y: "#5dffa1", z: "#4d9dff", ring: "#fcee0a" };
const HOT = "#ffffff";
const UNIT_BOX = { min: [-0.5, -0.5, 0] as V3, max: [0.5, 0.5, 1] as V3 };

export interface ViewportHooks {
  select(id: string | undefined): void;
  commit(id: string, t: SceneTransform): void;
  remove(id: string): void;
  floor(id: string): void;
  log(text: string): void;
  status(text: string): void;
}

interface Drag {
  id: string;
  mode: Mode;
  /** The handle being dragged, or the axis a key locked. */
  axis?: Axis;
  ring?: boolean;
  start: SceneTransform;
  now: SceneTransform;
  /** Where the drag started: on the axis (metres), on the floor plane, the angle, or the cursor distance. */
  s0?: number;
  p0?: V3;
  a0?: number;
  d0?: number;
  x0: number;
  y0: number;
  typed: string;
  /** Started by a key (G, R, S) rather than a handle: confirmed by a click or Enter. */
  modal: boolean;
  moves: number;
  started: number;
}

export class Viewport {
  private ctx: CanvasRenderingContext2D;
  private edit = false;
  private objects: SceneObject[] = [];
  private selected: string | undefined;
  private cam: Camera | undefined;
  private calib: Calibration | undefined;
  private fov = 0;
  private fpp: GameRef | null = null;
  private camSys: GameRef | null = null;
  private frame = 0;
  private running = false;
  private hover: Handle | undefined;
  private drag: Drag | undefined;
  private mouse: [number, number] = [0, 0];
  private pending: SceneTransform | undefined;
  private inflight = false;
  private cameraError = "";

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly hooks: ViewportHooks,
  ) {
    this.ctx = canvas.getContext("2d")!;
    canvas.addEventListener("pointermove", (e) => this.onMove(e));
    canvas.addEventListener("pointerdown", (e) => this.onDown(e));
    canvas.addEventListener("pointerup", (e) => this.onUp(e));
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    window.addEventListener("keydown", (e) => this.onKey(e));
    game.on("PlayerPuppet.OnGameAttached", () => this.forgetCamera());
  }

  setEdit(on: boolean): void {
    this.edit = on;
    this.canvas.classList.toggle("edit", on);
    if (!on) this.cancel();
    this.kick();
  }

  setScene(objects: SceneObject[], selected: string | undefined): void {
    this.objects = objects;
    if (selected !== this.selected && this.drag) this.cancel();
    this.selected = selected;
    this.kick();
  }

  /** The selected object, as the page shows it now (mid-drag included). */
  private current(): SceneObject | undefined {
    const o = this.objects.find((x) => x.id === this.selected);
    if (!o) return undefined;
    return this.drag && this.drag.id === o.id ? { ...o, transform: this.drag.now } : o;
  }

  // ---- the camera ----------------------------------------------------------------------------

  private forgetCamera(): void {
    this.fpp = null;
    this.camSys = null;
    this.cam = undefined;
    this.calib = undefined;
  }

  /** One call a frame: the first-person camera's matrix. FOV and calibration only when they change. */
  private async updateCamera(): Promise<boolean> {
    try {
      if (!this.fpp || !this.camSys) {
        const player = await api.GetPlayer(game.instance);
        if (!player) throw new Error("no player: load a save");
        this.fpp = (await player.GetFPPCameraComponent()) as GameRef | null;
        this.camSys = (await api.GameInstance.GetCameraSystem(game.instance)) as GameRef | null;
        if (!this.fpp || !this.camSys) throw new Error("the camera is not available");
      }
      const b = basisFromMatrix((await this.fpp.GetLocalToWorld()) as GameMatrix);
      if (this.frame % 30 === 0 || !this.calib) {
        const fov = (await this.camSys.GetActiveCameraFOV()) as number;
        if (!this.calib || Math.abs(fov - this.fov) > 0.01) {
          const pts = calibrationPoints(b);
          const projected = (await Promise.all(pts.map((p) => this.camSys!.ProjectPoint({ X: p[0], Y: p[1], Z: p[2], W: 1 })))) as { X: number; Y: number }[];
          this.calib = calibrate(projected);
          this.fov = fov;
          this.hooks.log(`Viewport calibrated: FOV ${fov.toFixed(1)}, kx ${this.calib.kx.toFixed(3)}, ky ${this.calib.ky.toFixed(3)}, centre ${this.calib.cx.toFixed(3)},${this.calib.cy.toFixed(3)}, span ${this.calib.spanX.toFixed(1)}x${this.calib.spanY.toFixed(1)}, y ${this.calib.yDown ? "down" : "up"}`);
          await this.checkCalibration(b);
        }
      }
      this.cam = { ...b, ...this.calib!, pageW: this.canvas.width, pageH: this.canvas.height };
      this.cameraError = "";
      return true;
    } catch (err) {
      const why = (err as Error).message;
      if (why !== this.cameraError) this.hooks.log(`Viewport camera: ${why}`);
      this.cameraError = why;
      this.forgetCamera();
      return false;
    }
  }

  /** Projects a fourth point both ways and logs the difference in page pixels, for the test. */
  private async checkCalibration(b: { pos: V3; right: V3; fwd: V3; up: V3 }): Promise<void> {
    const p = add(add(add(b.pos, mul(b.fwd, 8)), mul(b.right, -1.5)), mul(b.up, 0.8));
    const g = (await this.camSys!.ProjectPoint({ X: p[0], Y: p[1], Z: p[2], W: 1 })) as { X: number; Y: number };
    const cam: Camera = { ...b, ...this.calib!, pageW: this.canvas.width, pageH: this.canvas.height };
    const mine = project(cam, p);
    const c = this.calib!;
    const gx = cam.pageW / 2 + ((g.X - c.cx) / c.spanX) * cam.pageW;
    const gyOff = ((g.Y - c.cy) / c.spanY) * cam.pageH;
    const gy = cam.pageH / 2 + (c.yDown ? gyOff : -gyOff);
    if (mine) this.hooks.log(`Viewport check: a test point lands ${Math.hypot(mine[0] - gx, mine[1] - gy).toFixed(1)} px from where the game projects it`);
  }

  // ---- the frame loop ----------------------------------------------------------------------------

  private kick(): void {
    if (this.running || !(this.edit || this.selected)) {
      if (!this.edit && !this.selected) this.clear();
      return;
    }
    this.running = true;
    const tick = async () => {
      if (!(this.edit || this.selected)) {
        this.running = false;
        this.clear();
        return;
      }
      this.frame++;
      const ok = await this.updateCamera();
      this.draw(ok);
      // Without a camera, try again once a second rather than every frame.
      if (ok) requestAnimationFrame(() => void tick());
      else setTimeout(() => requestAnimationFrame(() => void tick()), 1000);
    };
    requestAnimationFrame(() => void tick());
  }

  private clear(): void {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  private handleEnds(o: SceneObject): { origin: V3; size: number; tips: Record<Axis, V3> } {
    const origin = o.transform.position;
    const dist = this.cam ? Math.max(1, Math.hypot(...sub(origin, this.cam.pos))) : 5;
    const size = dist * 0.12; // the same size on screen at any distance
    return { origin, size, tips: { x: add(origin, mul(AXES.x, size)), y: add(origin, mul(AXES.y, size)), z: add(origin, mul(AXES.z, size)) } };
  }

  private ringPoints(origin: V3, radius: number): V3[] {
    const pts: V3[] = [];
    for (let i = 0; i <= 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      pts.push(add(origin, [Math.cos(a) * radius, Math.sin(a) * radius, 0]));
    }
    return pts;
  }

  private draw(cameraOk: boolean): void {
    this.clear();
    const ctx = this.ctx;
    const cam = this.cam;
    const o = this.current();
    if (!cameraOk || !cam) {
      if (this.edit) this.label(`No camera yet: ${this.cameraError || "load a save"}`);
      return;
    }
    if (o && o.entityId) {
      this.drawBox(o);
      const { origin, size, tips } = this.handleEnds(o);
      const c = project(cam, origin);
      // The turn ring, flat around the object.
      const ring = this.ringPoints(origin, size * 0.8).map((p) => project(cam, p));
      ctx.lineWidth = this.hover === "ring" || this.drag?.ring ? 4 : 2;
      ctx.strokeStyle = this.hover === "ring" || this.drag?.ring ? HOT : COLORS.ring;
      ctx.beginPath();
      let pen = false;
      for (const p of ring) {
        if (!p) {
          pen = false;
          continue;
        }
        if (pen) ctx.lineTo(p[0], p[1]);
        else ctx.moveTo(p[0], p[1]);
        pen = true;
      }
      ctx.stroke();
      if (c) {
        for (const ax of ["x", "y", "z"] as Axis[]) {
          const t = project(cam, tips[ax]);
          if (!t) continue;
          const hot = this.hover === ax || this.drag?.axis === ax;
          ctx.strokeStyle = hot ? HOT : COLORS[ax];
          ctx.fillStyle = ctx.strokeStyle;
          ctx.lineWidth = hot ? 5 : 3;
          ctx.beginPath();
          ctx.moveTo(c[0], c[1]);
          ctx.lineTo(t[0], t[1]);
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(t[0], t[1], hot ? 8 : 6, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.arc(c[0], c[1], 4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    if (this.drag) this.label(this.dragText(this.drag));
    else if (this.edit) this.label(o ? "Drag an arrow to move, the ring to turn. G move, R turn, S scale, Ctrl+E floor, Delete." : "Click an object to select it.");
  }

  private drawBox(o: SceneObject): void {
    const cam = this.cam!;
    const b = o.bounds ? { min: o.bounds.min as V3, max: o.bounds.max as V3 } : UNIT_BOX;
    const t = o.transform;
    const corners: ([number, number] | null)[] = [];
    for (let i = 0; i < 8; i++) {
      const local: V3 = [(i & 1 ? b.max[0] : b.min[0]) * t.scale[0], (i & 2 ? b.max[1] : b.min[1]) * t.scale[1], (i & 4 ? b.max[2] : b.min[2]) * t.scale[2]];
      corners.push(project(cam, add(t.position, qRotate(t.rotation as Q, local))));
    }
    const edges = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
    this.ctx.strokeStyle = "rgba(25,243,255,0.7)";
    this.ctx.lineWidth = 1;
    this.ctx.beginPath();
    for (const [a, z] of edges) {
      const p = corners[a];
      const q = corners[z];
      if (!p || !q) continue;
      this.ctx.moveTo(p[0], p[1]);
      this.ctx.lineTo(q[0], q[1]);
    }
    this.ctx.stroke();
  }

  private label(text: string): void {
    const ctx = this.ctx;
    ctx.font = "16px 'JetBrains Mono', Consolas, monospace";
    const w = ctx.measureText(text).width + 24;
    ctx.fillStyle = "rgba(8,9,13,0.85)";
    ctx.fillRect(24, this.canvas.height - 64, w, 32);
    ctx.fillStyle = "#fcee0a";
    ctx.fillText(text, 36, this.canvas.height - 42);
  }

  private dragText(d: Drag): string {
    const t = d.now;
    const typed = d.typed ? `  [${d.typed}]` : "";
    const lock = d.axis ? ` ${d.axis.toUpperCase()}` : "";
    if (d.mode === "move") {
      const dx = sub(t.position, d.start.position);
      return `Move${lock}  ${dx.map((n) => n.toFixed(2)).join(", ")} m${typed}   Enter or click: keep · Esc or right-click: undo`;
    }
    if (d.mode === "rotate") return `Turn${lock || " Z"}  ${this.turnedDegrees(d).toFixed(1)}°${typed}   Enter or click: keep · Esc: undo`;
    return `Scale${lock}  ${t.scale.map((n) => n.toFixed(2)).join(", ")}${typed}   Enter or click: keep · Esc: undo`;
  }

  private turnedDegrees(d: Drag): number {
    const q = qMul(d.now.rotation as Q, [-d.start.rotation[0], -d.start.rotation[1], -d.start.rotation[2], d.start.rotation[3]]);
    const deg = (2 * Math.acos(Math.min(1, Math.abs(q[3]))) * 180) / Math.PI;
    return deg;
  }

  // ---- the mouse ---------------------------------------------------------------------------------

  private pageXY(e: PointerEvent): [number, number] {
    const r = this.canvas.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * this.canvas.width, ((e.clientY - r.top) / r.height) * this.canvas.height];
  }

  private handleAt(p: [number, number]): Handle | undefined {
    const o = this.current();
    const cam = this.cam;
    if (!o || !o.entityId || !cam) return undefined;
    const { origin, size, tips } = this.handleEnds(o);
    const c = project(cam, origin);
    if (!c) return undefined;
    let best: Handle | undefined;
    let bestD = 10;
    for (const ax of ["x", "y", "z"] as Axis[]) {
      const t = project(cam, tips[ax]);
      if (!t) continue;
      const d = distToSegment(p, c, t);
      if (d < bestD) {
        bestD = d;
        best = ax;
      }
    }
    if (best) return best;
    const ring = this.ringPoints(origin, size * 0.8).map((q) => project(cam, q));
    for (let i = 0; i + 1 < ring.length; i++) {
      const a = ring[i];
      const b = ring[i + 1];
      if (a && b && distToSegment(p, a, b) < 8) return "ring";
    }
    return undefined;
  }

  private onMove(e: PointerEvent): void {
    this.mouse = this.pageXY(e);
    if (!this.edit) return;
    if (this.drag) this.dragTo(this.mouse, e.ctrlKey);
    else this.hover = this.handleAt(this.mouse);
  }

  private onDown(e: PointerEvent): void {
    if (!this.edit || !this.cam) return;
    this.mouse = this.pageXY(e);
    if (e.button === 2) {
      if (this.drag) this.cancel();
      return;
    }
    if (e.button !== 0) return;
    if (this.drag?.modal) return this.confirm();
    const h = this.handleAt(this.mouse);
    const o = this.current();
    if (h && o) {
      this.canvas.setPointerCapture(e.pointerId);
      if (h === "ring") this.begin(o, "rotate", false, undefined, true);
      else this.begin(o, "move", false, h);
      return;
    }
    this.pick(this.mouse);
  }

  private onUp(e: PointerEvent): void {
    if (this.drag && !this.drag.modal && e.button === 0) {
      this.canvas.releasePointerCapture(e.pointerId);
      this.confirm();
    }
  }

  /** Selects the nearest object under the cursor, or nothing. */
  private pick(p: [number, number]): void {
    const cam = this.cam!;
    const ray = rayFrom(cam, p[0], p[1]);
    let best: SceneObject | undefined;
    let bestT = Infinity;
    for (const o of this.objects) {
      if (!o.entityId) continue;
      const box = o.bounds ? { min: o.bounds.min as V3, max: o.bounds.max as V3 } : UNIT_BOX;
      const t = rayHitsBox(ray, box, o.transform.position, o.transform.rotation as Q, o.transform.scale as V3);
      if (t !== null && t < bestT) {
        bestT = t;
        best = o;
      }
    }
    this.hooks.select(best?.id);
  }

  // ---- drags and keys ------------------------------------------------------------------------------

  private begin(o: SceneObject, mode: Mode, modal: boolean, axis?: Axis, ring = false): void {
    if (mode === "scale" && o.kind !== "mesh") {
      this.hooks.status("Only meshes scale; an entity keeps the size its template gives it.");
      return;
    }
    const t: SceneTransform = { position: [...o.transform.position], rotation: [...o.transform.rotation], scale: [...o.transform.scale] };
    this.drag = { id: o.id, mode, axis, ring, start: t, now: t, x0: this.mouse[0], y0: this.mouse[1], typed: "", modal, moves: 0, started: performance.now() };
    this.anchor();
  }

  /** Records where the drag starts, in the terms its constraint uses. */
  private anchor(): void {
    const d = this.drag!;
    const cam = this.cam!;
    const ray = rayFrom(cam, this.mouse[0], this.mouse[1]);
    const origin = d.start.position;
    d.x0 = this.mouse[0];
    d.y0 = this.mouse[1];
    if (d.mode === "move") {
      if (d.axis) d.s0 = closestOnAxis(ray, origin, AXES[d.axis]) ?? 0;
      else d.p0 = rayOnPlaneZ(ray, origin[2]) ?? origin;
    } else if (d.mode === "rotate") {
      const p = rayOnPlaneZ(ray, origin[2]);
      d.a0 = p ? Math.atan2(p[1] - origin[1], p[0] - origin[0]) : 0;
    } else {
      const c = project(cam, origin);
      d.d0 = c ? Math.max(8, Math.hypot(this.mouse[0] - c[0], this.mouse[1] - c[1])) : 100;
    }
  }

  private dragTo(p: [number, number], snap: boolean): void {
    const d = this.drag!;
    const cam = this.cam;
    if (!cam || d.typed) return;
    const ray = rayFrom(cam, p[0], p[1]);
    const s = d.start;
    let next: SceneTransform = d.now;
    if (d.mode === "move") {
      let delta: V3 = [0, 0, 0];
      if (d.axis) {
        const t = closestOnAxis(ray, s.position, AXES[d.axis]);
        if (t === null) return;
        delta = mul(AXES[d.axis], t - (d.s0 ?? 0));
      } else {
        const q = rayOnPlaneZ(ray, s.position[2]);
        if (!q) return;
        delta = sub(q, d.p0 ?? s.position);
      }
      if (snap) delta = delta.map((n) => Math.round(n / 0.25) * 0.25) as V3;
      next = { ...s, position: add(s.position, delta) };
    } else if (d.mode === "rotate") {
      let deg: number;
      if (!d.axis || d.axis === "z") {
        const q = rayOnPlaneZ(ray, s.position[2]);
        const a = q ? Math.atan2(q[1] - s.position[1], q[0] - s.position[0]) : (d.a0 ?? 0) + ((p[0] - d.x0) * Math.PI) / 360;
        deg = ((a - (d.a0 ?? 0)) * 180) / Math.PI;
      } else {
        deg = (p[0] - d.x0) * 0.5;
      }
      if (snap) deg = Math.round(deg / 15) * 15;
      next = { ...s, rotation: qNorm(qMul(qAxisAngle(AXES[d.axis ?? "z"], deg), s.rotation as Q)) };
    } else {
      const c = project(cam, s.position);
      if (!c) return;
      let f = Math.max(0.01, Math.hypot(p[0] - c[0], p[1] - c[1]) / (d.d0 ?? 100));
      if (snap) f = Math.round(f / 0.25) * 0.25 || 0.25;
      next = { ...s, scale: this.scaled(s.scale as V3, f, d.axis) };
    }
    this.apply(next);
  }

  private scaled(base: V3, f: number, axis?: Axis): V3 {
    if (!axis) return mul(base, f);
    const i = axis === "x" ? 0 : axis === "y" ? 1 : 2;
    const out: V3 = [...base];
    out[i] = base[i] * f;
    return out;
  }

  /** A transform from typed numbers: metres along the locked axis, degrees around it, or a factor. */
  private typedTransform(d: Drag): SceneTransform | undefined {
    const n = Number(d.typed);
    if (!d.typed || Number.isNaN(n)) return undefined;
    const s = d.start;
    if (d.mode === "move") return { ...s, position: add(s.position, mul(AXES[d.axis ?? "z"], n)) };
    if (d.mode === "rotate") return { ...s, rotation: qNorm(qMul(qAxisAngle(AXES[d.axis ?? "z"], n), s.rotation as Q)) };
    return { ...s, scale: this.scaled(s.scale as V3, n || 1, d.axis) };
  }

  /** Shows a transform on the preview: at most one move waits for the game at a time, the newest wins. */
  private apply(t: SceneTransform): void {
    const d = this.drag!;
    d.now = t;
    if (d.mode === "scale") return; // the box shows a new scale; the mod rebuilds the preview on keep
    const o = this.objects.find((x) => x.id === d.id);
    if (!o?.entityId) return;
    this.pending = t;
    if (this.inflight) return;
    this.inflight = true;
    void (async () => {
      while (this.pending) {
        const p = this.pending;
        this.pending = undefined;
        try {
          await world.move(o.entityId!, { x: p.position[0], y: p.position[1], z: p.position[2] }, { i: p.rotation[0], j: p.rotation[1], k: p.rotation[2], r: p.rotation[3] });
          if (this.drag) this.drag.moves++;
        } catch (err) {
          this.hooks.log(`Move failed: ${(err as Error).message}`);
        }
      }
      this.inflight = false;
    })();
  }

  private confirm(): void {
    const d = this.drag;
    if (!d) return;
    const t = (d.typed && this.typedTransform(d)) || d.now;
    this.drag = undefined;
    this.hover = undefined;
    const secs = (performance.now() - d.started) / 1000;
    if (d.moves > 0) this.hooks.log(`Drag (${d.mode}${d.axis ? ` ${d.axis}` : ""}): ${d.moves} moves in ${secs.toFixed(1)} s, ${(d.moves / Math.max(secs, 0.001)).toFixed(0)} a second`);
    this.hooks.commit(d.id, t);
  }

  private cancel(): void {
    const d = this.drag;
    if (!d) return;
    this.drag = undefined;
    const o = this.objects.find((x) => x.id === d.id);
    if (o?.entityId && d.mode !== "scale") {
      this.pending = undefined;
      void world.move(o.entityId, { x: d.start.position[0], y: d.start.position[1], z: d.start.position[2] }, { i: d.start.rotation[0], j: d.start.rotation[1], k: d.start.rotation[2], r: d.start.rotation[3] });
    }
  }

  private onKey(e: KeyboardEvent): void {
    if (!this.edit) return;
    const el = document.activeElement as HTMLElement | null;
    if (el && (el.tagName === "INPUT" || el.tagName === "RN-INPUT" || el.isContentEditable)) return;
    const key = e.key.toLowerCase();
    const d = this.drag;
    if (d) {
      if (key === "escape") return this.cancel();
      if (key === "enter") return this.confirm();
      if (key === "x" || key === "y" || key === "z") {
        d.axis = d.axis === key ? undefined : (key as Axis);
        d.now = d.start;
        this.anchor();
        if (d.mode !== "scale") this.apply(d.start);
        return;
      }
      if (/^[0-9.\-]$/.test(e.key)) {
        d.typed += e.key;
        const t = this.typedTransform(d);
        if (t) this.apply(t);
        return;
      }
      if (key === "backspace") {
        d.typed = d.typed.slice(0, -1);
        const t = this.typedTransform(d) ?? d.start;
        this.apply(t);
      }
      return;
    }
    const o = this.current();
    if (!o?.entityId || !this.cam) return;
    if (key === "g") this.begin(o, "move", true);
    else if (key === "r") this.begin(o, "rotate", true);
    else if (key === "s") this.begin(o, "scale", true);
    else if (key === "e" && e.ctrlKey) {
      e.preventDefault();
      this.hooks.floor(o.id);
    } else if (key === "delete") this.hooks.remove(o.id);
  }
}

/** The direction a drag along an axis moves in, for tests and the panel. */
export const axisVector = (a: Axis): V3 => norm(AXES[a]);
