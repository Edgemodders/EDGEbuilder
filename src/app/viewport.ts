// The viewport: a canvas over the whole game view. It follows the game's camera each frame, draws
// the gizmo at the middle of the selection, picks objects under the cursor (or in a box), and turns
// drags and keys into new transforms for every selected object. Previews move live through REDnode's
// world API; the mod keeps the result.

import { api, game, world, type GameRef } from "rednode";
import { applyChange, boxOf, centreOf, type Change } from "../arrange";
import { held } from "./held";
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
  type Look,
  type Q,
  type Ray,
  type V3,
  lookAxes,
  lookOf,
  qLook,
} from "../math";
import type { SceneObject, SceneTransform } from "../protocol";

type Axis = "x" | "y" | "z";
type Handle = Axis | "ring";
type Mode = "move" | "rotate" | "scale";

const COLORS: Record<Handle, string> = { x: "#ff4d5e", y: "#5dffa1", z: "#4d9dff", ring: "#fcee0a" };
const HOT = "#ffffff";
const UNIT_BOX = { min: [-0.5, -0.5, 0] as V3, max: [0.5, 0.5, 1] as V3 };

export interface ViewportHooks {
  /** A click on this object, or on nothing. `toggle`: Ctrl was held; `single`: Alt (one object, not its group). */
  pick(id: string | undefined, opts: { toggle: boolean; single: boolean }): void;
  /** A box (Shift+drag) took these objects. `add`: Ctrl was held. */
  pickBox(ids: string[], opts: { add: boolean; single: boolean }): void;
  /** The objects' new transforms, one undo step; `merge`: the move that places a duplicate. */
  commit(items: { id: string; transform: SceneTransform }[], merge: boolean): void;
  remove(ids: string[]): void;
  floor(ids: string[]): void;
  /** Esc on a duplicate's move: the copies go. */
  undo(): void;
  log(text: string): void;
  status(text: string): void;
  /** Edit went on: switch to EDGEbuilder's camera at this pose. */
  builderStart(pose: { position: V3; rotation: Q; fov: number }): void;
  /** Edit went off. */
  builderStop(): void;
}

interface Drag {
  /** The objects being moved, and where each started. */
  ids: string[];
  starts: Map<string, SceneTransform>;
  mode: Mode;
  /** The handle being dragged, or the axis a key locked. */
  axis?: Axis;
  ring?: boolean;
  /** The middle of the selection when the drag started: what it turns and scales around. */
  pivot: V3;
  /** The change so far, the same for every object. */
  change: Change;
  /** A duplicate's move: Esc takes the copies back, and keeping it joins the duplicate's undo step. */
  copy: boolean;
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
  private selected: string[] = [];
  /** A selection box being drawn with Shift held: where it started and where the cursor is. */
  private box: { x0: number; y0: number; x1: number; y1: number } | undefined;
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
  /** The drag changed since the last frame: send the previews' new places. */
  private pending = false;
  private cameraError = "";
  // The editor camera (B2b): its entity, its component, and where the page wants it.
  private camEntity: string | undefined;
  private camComp: GameRef | null = null;
  private camPos: V3 | undefined;
  private look: Look | undefined;
  private camDirty = false;
  private builderAsked = false;
  private rmb = false;
  private mmb = false;
  private last: [number, number] = [0, 0];
  private keys = new Set<string>();
  private speed = 6;
  private lastTick = 0;
  /** Drop at click: what to do with the line through the next left click. */
  private placing: ((ray: Ray) => void) | undefined;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly hooks: ViewportHooks,
  ) {
    this.ctx = canvas.getContext("2d")!;
    // Moves and releases are heard on the whole page: while looking, orbiting or dragging, the
    // cursor may cross the EDGEbuilder window, and the camera should keep following it (B2b test).
    window.addEventListener("pointermove", (e) => {
      if (e.target === canvas || this.rmb || this.mmb || this.drag || this.box) this.onMove(e);
    });
    canvas.addEventListener("pointerdown", (e) => this.onDown(e));
    window.addEventListener("pointerup", (e) => this.onUp(e));
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    window.addEventListener("keydown", (e) => {
      this.keys.add(e.key.toLowerCase());
      this.onKey(e);
    });
    window.addEventListener("keyup", (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener("blur", () => this.keys.clear());
    document.addEventListener("pointerlockchange", () => {
      if (!this.locked && (this.rmb || this.mmb)) this.rmb = this.mmb = false;
    });
    canvas.addEventListener("wheel", (e) => this.onWheel(e), { passive: false });
    // A page closing or reloading must not leave V looking through a camera nobody drives.
    window.addEventListener("beforeunload", () => {
      if (this.builderAsked) this.hooks.builderStop();
    });
    game.on("PlayerPuppet.OnGameAttached", () => this.forgetCamera());
  }

  setEdit(on: boolean): void {
    this.edit = on;
    this.canvas.classList.toggle("edit", on);
    if (!on) {
      this.cancel();
      this.disarm();
      this.box = undefined;
      this.rmb = this.mmb = false;
      this.unlock();
      if (this.builderAsked) this.hooks.builderStop();
      this.builderAsked = false;
    }
    this.kick();
  }

  /** The editor camera's entity from the mod's state, or none (V's camera). */
  setCamera(entityId: string | undefined): void {
    if (entityId === this.camEntity) return;
    this.camEntity = entityId;
    this.camComp = null;
    this.calib = undefined; // another camera: learn the screen again
    if (!entityId) {
      this.camPos = undefined;
      this.look = undefined;
      // Builder mode ended without Edit going off (a save loaded, or the camera failed): ask again on the next frame.
      if (this.edit && this.builderAsked) this.builderAsked = false;
    }
  }

  /** Drop at click: the next left click in the world gives the line from the camera through it. */
  armDrop(then: (ray: Ray) => void): void {
    this.cancel();
    this.placing = then;
    this.canvas.style.cursor = "crosshair";
    this.kick();
  }

  private disarm(): void {
    this.placing = undefined;
    this.canvas.style.cursor = "";
  }

  setScene(objects: SceneObject[], selected: string[]): void {
    this.objects = objects;
    if (this.drag && selected.join("\n") !== this.selected.join("\n")) this.cancel();
    this.selected = selected;
    this.kick();
  }

  /** Edit is on and the camera is known: a drag can start. */
  get canDrag(): boolean {
    return this.edit && !!this.cam;
  }

  /** A drag, a box or Drop at click is under way: keys belong to it. */
  get busy(): boolean {
    return !!(this.drag || this.box || this.placing);
  }

  /** A duplicate's copies are selected: they follow the mouse until a click places them, Esc takes them back. */
  moveCopies(): void {
    if (!this.canDrag || this.drag) return;
    this.begin("move", true, undefined, false, true);
    this.kick();
  }

  /** The selected objects as the page shows them now, mid-drag included. */
  private chosen(): SceneObject[] {
    const d = this.drag;
    return this.objects
      .filter((o) => this.selected.includes(o.id))
      .map((o) => (d && d.starts.has(o.id) ? { ...o, transform: this.nowOf(d, o.id) } : o));
  }

  private nowOf(d: Drag, id: string): SceneTransform {
    return applyChange(d.starts.get(id)!, d.change, d.pivot);
  }

  /** Where the gizmo sits: the middle of the selected previews. */
  private gizmoAt(): V3 | undefined {
    const shown = this.chosen().filter((o) => o.entityId);
    return shown.length ? centreOf(shown.map((o) => o.transform)) : undefined;
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
      // With the editor camera on, read its component; else V's first-person camera.
      if (this.camEntity && !this.camComp) {
        const entity = (await world.entity(this.camEntity)) as GameRef | null;
        this.camComp = entity ? ((await entity.FindComponentByName("edgebuilder_camera")) as GameRef | null) : null;
      }
      const source = this.camEntity && this.camComp ? this.camComp : this.fpp;
      const b = basisFromMatrix((await source.GetLocalToWorld()) as GameMatrix);
      if (this.camEntity && this.camComp && !this.camPos) {
        this.camPos = b.pos;
        this.look = lookOf(b.fwd);
      }
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

  /** The loop runs only in Edit: with Edit off nothing is drawn (the game's outline marks the selection) and the game is not asked for the camera. */
  private kick(): void {
    if (this.running || !this.edit) {
      if (!this.edit) this.clear();
      return;
    }
    this.running = true;
    const tick = async () => {
      if (!this.edit) {
        this.running = false;
        this.clear();
        return;
      }
      this.frame++;
      this.flushMove();
      this.flyAndSend();
      const ok = await this.updateCamera();
      if (ok && this.edit && !this.builderAsked && this.cam) {
        // Edit just went on: start the editor camera exactly where V's camera is.
        this.builderAsked = true;
        this.hooks.builderStart({ position: this.cam.pos, rotation: qLook(lookOf(this.cam.fwd)), fov: this.fov });
      }
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

  private handleEnds(origin: V3): { origin: V3; size: number; tips: Record<Axis, V3> } {
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
    const chosen = this.chosen();
    const at = this.gizmoAt();
    if (!cameraOk || !cam) {
      if (this.edit) this.label(`No camera yet: ${this.cameraError || "load a save"}`);
      return;
    }
    for (const o of chosen) if (o.entityId) this.drawBox(o);
    if (at) {
      const { origin, size, tips } = this.handleEnds(at);
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
    if (this.box) {
      const b = this.box;
      ctx.strokeStyle = COLORS.ring;
      ctx.lineWidth = 1;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(Math.min(b.x0, b.x1), Math.min(b.y0, b.y1), Math.abs(b.x1 - b.x0), Math.abs(b.y1 - b.y0));
      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(252,238,10,0.06)";
      ctx.fillRect(Math.min(b.x0, b.x1), Math.min(b.y0, b.y1), Math.abs(b.x1 - b.x0), Math.abs(b.y1 - b.y0));
    }
    if (this.drag) this.label(...this.dragText(this.drag).split("   "));
    else if (this.edit) {
      const camHelp = this.camEntity ? "Right mouse: look, fly with W A S D Q E (Shift faster).  Middle: orbit, Shift pan.  Wheel: closer.  F: frame." : "";
      const n = chosen.length;
      const help = this.placing
        ? "Click where it should go.  Right-click: cancel."
        : this.box
          ? "Release to select what is inside.  Ctrl: add to the selection."
          : n
            ? `${n > 1 ? `${n} selected. ` : ""}Drag an arrow to move, the ring to turn. G move, R turn, S scale, Ctrl+E floor, Delete. Ctrl+D copy, Ctrl+G group, Ctrl+Z undo.`
            : "Click an object to select it (Alt: one out of its group, Ctrl: add). Shift+drag: select in a box.";
      this.label(help, camHelp);
    }
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

  /**
   * The help lines, at the bottom centre of the screen (REDnode's launcher sits at the bottom left).
   * Each part starts a new line, and a part too wide to stay clear of the EDGEbuilder window wraps
   * at word breaks; lines stack upwards.
   */
  private label(...parts: string[]): void {
    const ctx = this.ctx;
    ctx.font = "16px 'JetBrains Mono', Consolas, monospace";
    const centre = this.canvas.width / 2;
    const windowLeft = this.canvas.width - 24 - 448;
    const max = 2 * (windowLeft - 24 - centre) - 24;
    const lines: string[] = [];
    for (const part of parts.filter(Boolean)) {
      let line = "";
      for (const word of part.split(" ")) {
        const next = line ? `${line} ${word}` : word;
        if (line && ctx.measureText(next).width > max) {
          lines.push(line);
          line = word;
        } else line = next;
      }
      if (line) lines.push(line);
    }
    const lineH = 24;
    const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 24;
    const top = this.canvas.height - 32 - lines.length * lineH - 8;
    const left = centre - w / 2;
    ctx.fillStyle = "rgba(8,9,13,0.85)";
    ctx.fillRect(left, top, w, lines.length * lineH + 8);
    ctx.fillStyle = "#fcee0a";
    lines.forEach((l, i) => ctx.fillText(l, left + 12, top + 22 + i * lineH));
  }

  private dragText(d: Drag): string {
    const typed = d.typed ? `  [${d.typed}]` : "";
    const lock = d.axis ? ` ${d.axis.toUpperCase()}` : "";
    const many = d.ids.length > 1 ? ` ${d.ids.length} objects` : "";
    const keep = d.copy ? "Enter or click: place the copy · Right-click: no copy" : "Enter or click: keep · Right-click: undo";
    if (d.mode === "move") {
      const dx = d.change.move ?? [0, 0, 0];
      return `Move${many}${lock}  ${dx.map((n) => n.toFixed(2)).join(", ")} m${typed}   ${keep}`;
    }
    if (d.mode === "rotate") return `Turn${many}${lock || " Z"}  ${this.turnedDegrees(d).toFixed(1)}°${typed}   ${keep}`;
    const f = d.change.scale ?? [1, 1, 1];
    const shown = d.ids.length === 1 ? this.nowOf(d, d.ids[0]).scale : f;
    return `Scale${many}${lock}  ${d.ids.length === 1 ? "" : "x "}${shown.map((n) => n.toFixed(2)).join(", ")}${typed}   ${keep}`;
  }

  private turnedDegrees(d: Drag): number {
    const q = d.change.turn ?? [0, 0, 0, 1];
    return (2 * Math.acos(Math.min(1, Math.abs(q[3]))) * 180) / Math.PI;
  }

  // ---- the mouse ---------------------------------------------------------------------------------

  private pageXY(e: PointerEvent): [number, number] {
    const r = this.canvas.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * this.canvas.width, ((e.clientY - r.top) / r.height) * this.canvas.height];
  }

  private handleAt(p: [number, number]): Handle | undefined {
    const at = this.gizmoAt();
    const cam = this.cam;
    if (!at || !cam) return undefined;
    const { origin, size, tips } = this.handleEnds(at);
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

  /**
   * While looking, orbiting or panning, the cursor stays where it is, hidden, and the mouse's own
   * movement turns the view: the web's Pointer Lock, which REDnode 0.22 gives overlay pages (B2b test:
   * the cursor otherwise crossed the screen and stopped at its edge). Without it, cursor positions.
   */
  private lock(): void {
    try {
      const r = (this.canvas.requestPointerLock as () => Promise<void> | void)?.call(this.canvas);
      if (r instanceof Promise) r.catch(() => undefined);
    } catch {
      // No pointer lock here: cursor positions still work.
    }
  }

  private unlock(): void {
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
  }

  private get locked(): boolean {
    return document.pointerLockElement === this.canvas;
  }

  private onMove(e: PointerEvent): void {
    const locked = this.locked;
    // Locked, the cursor is held still and the movement comes as movementX and movementY.
    if (!locked) this.mouse = this.pageXY(e);
    if (!this.edit) return;
    const dx = locked ? e.movementX : this.mouse[0] - this.last[0];
    const dy = locked ? e.movementY : this.mouse[1] - this.last[1];
    this.last = this.mouse;
    if ((this.rmb || this.mmb) && this.camPos && this.look) {
      if (this.rmb) {
        this.look = { yaw: this.look.yaw - dx * 0.15, pitch: Math.max(-89, Math.min(89, this.look.pitch - dy * 0.15)) };
      } else if (held(e).shift) {
        const a = lookAxes(this.look);
        const k = this.pivotDistance() * 0.0015;
        this.camPos = add(this.camPos, add(mul(a.right, -dx * k), mul(a.up, dy * k)));
      } else {
        const pivot = this.pivot();
        const dist = Math.hypot(...sub(this.camPos, pivot));
        this.look = { yaw: this.look.yaw - dx * 0.25, pitch: Math.max(-89, Math.min(89, this.look.pitch - dy * 0.25)) };
        this.camPos = sub(pivot, mul(lookAxes(this.look).fwd, dist));
      }
      this.camDirty = true;
      return;
    }
    if (this.box) {
      this.box.x1 = this.mouse[0];
      this.box.y1 = this.mouse[1];
    } else if (this.drag) this.dragTo(this.mouse, held(e).ctrl);
    else this.hover = this.handleAt(this.mouse);
  }

  /** What the camera orbits and dollies towards: the middle of the selection, else a point 10 m ahead. */
  private pivot(): V3 {
    const at = this.gizmoAt();
    if (at) return at;
    const a = lookAxes(this.look!);
    return add(this.camPos!, mul(a.fwd, 10));
  }

  private pivotDistance(): number {
    return this.camPos ? Math.max(1, Math.hypot(...sub(this.camPos, this.pivot()))) : 10;
  }

  private onWheel(e: WheelEvent): void {
    if (!this.edit || !this.camPos || !this.look) return;
    e.preventDefault();
    if (this.rmb) {
      this.speed = Math.max(0.5, Math.min(80, this.speed * (e.deltaY < 0 ? 1.25 : 0.8)));
      this.hooks.status(`Fly speed ${this.speed.toFixed(1)} m/s`);
      return;
    }
    const step = Math.max(0.25, this.pivotDistance() * 0.15) * (e.deltaY < 0 ? 1 : -1);
    this.camPos = add(this.camPos, mul(lookAxes(this.look).fwd, step));
    this.camDirty = true;
  }

  /** Moves the editor camera by the held keys, and sends it to the game when it moved. */
  private flyAndSend(): void {
    const now = performance.now();
    const dt = Math.min(0.1, (now - (this.lastTick || now)) / 1000);
    this.lastTick = now;
    if (!this.camEntity || !this.camPos || !this.look) return;
    if (this.rmb && this.keys.size) {
      const a = lookAxes(this.look);
      let v: V3 = [0, 0, 0];
      if (this.keys.has("w")) v = add(v, a.fwd);
      if (this.keys.has("s")) v = sub(v, a.fwd);
      if (this.keys.has("d")) v = add(v, a.right);
      if (this.keys.has("a")) v = sub(v, a.right);
      if (this.keys.has("e")) v = add(v, [0, 0, 1]);
      if (this.keys.has("q")) v = sub(v, [0, 0, 1]);
      const fast = this.keys.has("shift") ? 4 : this.keys.has("control") ? 0.25 : 1;
      if (v[0] || v[1] || v[2]) {
        this.camPos = add(this.camPos, mul(norm(v), this.speed * fast * dt));
        this.camDirty = true;
      }
    }
    if (!this.camDirty) return;
    this.camDirty = false;
    const q = qLook(this.look);
    world.move(this.camEntity, { x: this.camPos[0], y: this.camPos[1], z: this.camPos[2] }, { i: q[0], j: q[1], k: q[2], r: q[3] }).catch((err: Error) => this.hooks.log(`Camera move failed: ${err.message}`));
  }

  /** Puts the selection in front of the camera, at a distance that fits it. */
  private frameSelected(): void {
    const b = boxOf(this.chosen());
    if (!b || !this.camPos || !this.look) return;
    const size = Math.max(...[0, 1, 2].map((i) => b.max[i] - b.min[i]));
    const centre = mul(add(b.min, b.max), 0.5);
    const fwd = lookAxes(this.look).fwd;
    this.camPos = sub(centre, mul(fwd, Math.max(2, size * 2.5)));
    this.camDirty = true;
  }

  private onDown(e: PointerEvent): void {
    if (!this.edit || !this.cam) return;
    this.mouse = this.pageXY(e);
    this.last = this.mouse;
    // Right-click cancels what is in progress: in the game Esc never reaches the page (REDnode takes it
    // to leave interactive mode; B3-1 test).
    if (e.button === 2) {
      if (this.drag) this.cancel();
      else if (this.placing) {
        this.disarm();
        this.hooks.status("Drop at click cancelled.");
      } else if (this.box) this.box = undefined;
      else if (this.camEntity) {
        this.rmb = true;
        this.canvas.setPointerCapture(e.pointerId);
        this.lock();
      }
      return;
    }
    if (e.button === 1) {
      if (this.camEntity && !this.drag) {
        e.preventDefault();
        this.mmb = true;
        this.canvas.setPointerCapture(e.pointerId);
        this.lock();
      }
      return;
    }
    if (e.button !== 0) return;
    if (this.placing) {
      const then = this.placing;
      this.disarm();
      return then(rayFrom(this.cam, this.mouse[0], this.mouse[1]));
    }
    if (this.drag?.modal) return this.confirm();
    const shift = held(e).shift;
    const h = shift ? undefined : this.handleAt(this.mouse);
    if (h) {
      this.canvas.setPointerCapture(e.pointerId);
      if (h === "ring") this.begin("rotate", false, undefined, true);
      else this.begin("move", false, h);
      return;
    }
    if (shift) {
      // Shift+drag: a box; what is inside is selected on release.
      this.canvas.setPointerCapture(e.pointerId);
      this.box = { x0: this.mouse[0], y0: this.mouse[1], x1: this.mouse[0], y1: this.mouse[1] };
      return;
    }
    this.pick(this.mouse, e);
  }

  private onUp(e: PointerEvent): void {
    if (e.button === 2 || e.button === 1) {
      if (e.button === 2) this.rmb = false;
      else this.mmb = false;
      if (!this.rmb && !this.mmb) this.unlock();
      try {
        this.canvas.releasePointerCapture(e.pointerId);
      } catch {
        // Not captured.
      }
      return;
    }
    if (this.box && e.button === 0) {
      this.canvas.releasePointerCapture(e.pointerId);
      this.endBox(e);
      return;
    }
    if (this.drag && !this.drag.modal && e.button === 0) {
      this.canvas.releasePointerCapture(e.pointerId);
      this.confirm();
    }
  }

  /** The objects whose middle is inside the box on screen. A box a few pixels wide is a click. */
  private endBox(e: PointerEvent): void {
    const b = this.box!;
    this.box = undefined;
    const cam = this.cam;
    if (!cam) return;
    if (Math.abs(b.x1 - b.x0) < 4 && Math.abs(b.y1 - b.y0) < 4) return this.pick([b.x1, b.y1], e);
    const [l, r] = [Math.min(b.x0, b.x1), Math.max(b.x0, b.x1)];
    const [t, d] = [Math.min(b.y0, b.y1), Math.max(b.y0, b.y1)];
    const inside = this.objects.filter((o) => {
      if (!o.entityId) return false;
      const bb = o.bounds ? { min: o.bounds.min as V3, max: o.bounds.max as V3 } : UNIT_BOX;
      const middle = add(o.transform.position as V3, qRotate(o.transform.rotation as Q, mul(add(bb.min, bb.max).map((v, i) => v * o.transform.scale[i]) as V3, 0.5)));
      const p = project(cam, middle);
      return !!p && p[0] >= l && p[0] <= r && p[1] >= t && p[1] <= d;
    });
    this.hooks.pickBox(
      inside.map((o) => o.id),
      { add: held(e).ctrl, single: held(e).alt },
    );
  }

  /** Selects the nearest object under the cursor, or nothing. */
  private pick(p: [number, number], e: { ctrlKey: boolean; shiftKey: boolean; altKey: boolean }): void {
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
    const mods = held(e);
    this.hooks.pick(best?.id, { toggle: mods.ctrl, single: mods.alt });
  }

  // ---- drags and keys ------------------------------------------------------------------------------

  /**
   * Starts a drag of the selected previews. They all get the same change: moved by the same amount,
   * turned and scaled around their middle. `copy`: a duplicate's move.
   */
  private begin(mode: Mode, modal: boolean, axis?: Axis, ring = false, copy = false): void {
    const shown = this.objects.filter((o) => this.selected.includes(o.id) && o.entityId);
    if (!shown.length) return;
    if (mode === "scale" && shown.some((o) => o.kind !== "mesh")) {
      this.hooks.status(shown.length === 1 ? "Only meshes scale; an entity keeps the size its template gives it." : "Only meshes scale, and the selection has an entity: an entity keeps the size its template gives it.");
      return;
    }
    const starts = new Map(shown.map((o) => [o.id, { position: [...o.transform.position], rotation: [...o.transform.rotation], scale: [...o.transform.scale] } as SceneTransform]));
    const pivot = centreOf([...starts.values()]);
    this.drag = { ids: shown.map((o) => o.id), starts, mode, axis, ring, pivot, change: {}, copy, x0: this.mouse[0], y0: this.mouse[1], typed: "", modal, moves: 0, started: performance.now() };
    this.anchor();
  }

  /** Records where the drag starts, in the terms its constraint uses. */
  private anchor(): void {
    const d = this.drag!;
    const cam = this.cam!;
    const ray = rayFrom(cam, this.mouse[0], this.mouse[1]);
    const origin = d.pivot;
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
    const o = d.pivot;
    if (d.mode === "move") {
      let delta: V3 = [0, 0, 0];
      if (d.axis) {
        const t = closestOnAxis(ray, o, AXES[d.axis]);
        if (t === null) return;
        delta = mul(AXES[d.axis], t - (d.s0 ?? 0));
      } else {
        const q = rayOnPlaneZ(ray, o[2]);
        if (!q) return;
        delta = sub(q, d.p0 ?? o);
      }
      if (snap) delta = delta.map((n) => Math.round(n / 0.25) * 0.25) as V3;
      this.apply({ move: delta });
    } else if (d.mode === "rotate") {
      let deg: number;
      if (!d.axis || d.axis === "z") {
        const q = rayOnPlaneZ(ray, o[2]);
        const a = q ? Math.atan2(q[1] - o[1], q[0] - o[0]) : (d.a0 ?? 0) + ((p[0] - d.x0) * Math.PI) / 360;
        deg = ((a - (d.a0 ?? 0)) * 180) / Math.PI;
      } else {
        deg = (p[0] - d.x0) * 0.5;
      }
      if (snap) deg = Math.round(deg / 15) * 15;
      this.apply({ turn: qAxisAngle(AXES[d.axis ?? "z"], deg) });
    } else {
      const c = project(cam, o);
      if (!c) return;
      let f = Math.max(0.01, Math.hypot(p[0] - c[0], p[1] - c[1]) / (d.d0 ?? 100));
      if (snap) f = Math.round(f / 0.25) * 0.25 || 0.25;
      this.apply({ scale: this.factor(f, d.axis) });
    }
  }

  private factor(f: number, axis?: Axis): V3 {
    if (!axis) return [f, f, f];
    const out: V3 = [1, 1, 1];
    out[axis === "x" ? 0 : axis === "y" ? 1 : 2] = f;
    return out;
  }

  /** A change from typed numbers: metres along the locked axis, degrees around it, or a factor. */
  private typedChange(d: Drag): Change | undefined {
    const n = Number(d.typed);
    if (!d.typed || Number.isNaN(n)) return undefined;
    if (d.mode === "move") return { move: mul(AXES[d.axis ?? "z"], n) };
    if (d.mode === "rotate") return { turn: qAxisAngle(AXES[d.axis ?? "z"], n) };
    return { scale: this.factor(n || 1, d.axis) };
  }

  /** Shows a change on the previews: the newest places are sent once a frame, by the frame loop. */
  private apply(c: Change): void {
    const d = this.drag!;
    d.change = c;
    if (d.mode === "scale" && d.ids.length === 1) return; // the box shows a new scale; the mod rebuilds the preview on keep
    this.pending = true;
  }

  /**
   * Sends the previews' newest places without waiting for the answers. REDnode runs every call that
   * is waiting when a game frame starts in that frame, so one move a page frame keeps the objects with
   * the cursor; waiting for each answer let them fall a frame or two behind (B2a test).
   */
  private flushMove(): void {
    const d = this.drag;
    if (!this.pending || !d) return;
    this.pending = false;
    for (const id of d.ids) {
      const o = this.objects.find((x) => x.id === id);
      if (!o?.entityId) continue;
      const p = this.nowOf(d, id);
      d.moves++;
      world
        .move(o.entityId, { x: p.position[0], y: p.position[1], z: p.position[2] }, { i: p.rotation[0], j: p.rotation[1], k: p.rotation[2], r: p.rotation[3] })
        .catch((err: Error) => this.hooks.log(`Move failed: ${err.message}`));
    }
  }

  private confirm(): void {
    const d = this.drag;
    if (!d) return;
    if (d.typed) d.change = this.typedChange(d) ?? d.change;
    this.drag = undefined;
    this.hover = undefined;
    this.pending = false;
    const secs = (performance.now() - d.started) / 1000;
    if (d.moves > 0) this.hooks.log(`Drag (${d.mode}${d.axis ? ` ${d.axis}` : ""}, ${d.ids.length} object${d.ids.length === 1 ? "" : "s"}): ${d.moves} moves in ${secs.toFixed(1)} s, ${(d.moves / Math.max(secs, 0.001)).toFixed(0)} a second`);
    this.hooks.commit(
      d.ids.map((id) => ({ id, transform: this.nowOf(d, id) })),
      d.copy,
    );
  }

  private cancel(): void {
    const d = this.drag;
    if (!d) return;
    this.drag = undefined;
    this.pending = false;
    // A duplicate's move: no copy after all (one undo takes the copies out).
    if (d.copy) return this.hooks.undo();
    for (const [id, t] of d.starts) {
      const o = this.objects.find((x) => x.id === id);
      if (o?.entityId) void world.move(o.entityId, { x: t.position[0], y: t.position[1], z: t.position[2] }, { i: t.rotation[0], j: t.rotation[1], k: t.rotation[2], r: t.rotation[3] });
    }
  }

  private onKey(e: KeyboardEvent): void {
    if (!this.edit) return;
    const el = document.activeElement as HTMLElement | null;
    if (el && (el.tagName === "INPUT" || el.tagName === "RN-INPUT" || el.isContentEditable)) return;
    const key = e.key.toLowerCase();
    if (this.rmb && "wasdqe".includes(key)) return; // flying
    if (key === "escape" && this.placing) {
      this.disarm();
      return this.hooks.status("Drop at click cancelled.");
    }
    if (key === "escape" && this.box) {
      this.box = undefined;
      return;
    }
    if (key === "f" && !this.drag) return this.frameSelected();
    const d = this.drag;
    if (d) {
      if (e.ctrlKey && key.length === 1) return; // Ctrl snaps; Ctrl with a letter is not an axis
      if (key === "escape") return this.cancel();
      if (key === "enter") return this.confirm();
      if (key === "x" || key === "y" || key === "z") {
        d.axis = d.axis === key ? undefined : (key as Axis);
        this.anchor();
        this.apply({});
        return;
      }
      if (/^[0-9.\-]$/.test(e.key)) {
        d.typed += e.key;
        const c = this.typedChange(d);
        if (c) this.apply(c);
        return;
      }
      if (key === "backspace") {
        d.typed = d.typed.slice(0, -1);
        this.apply(this.typedChange(d) ?? {});
      }
      return;
    }
    if (!this.selected.length || !this.cam) return;
    // Ctrl with a letter is the page's (Ctrl+D, Ctrl+G, Ctrl+Z), except Ctrl+E.
    if (key === "e" && e.ctrlKey) {
      e.preventDefault();
      this.hooks.floor(this.selected);
      return;
    }
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    if (key === "g") this.begin("move", true);
    else if (key === "r") this.begin("rotate", true);
    else if (key === "s") this.begin("scale", true);
    else if (key === "delete") this.hooks.remove(this.selected);
  }
}

/** The direction a drag along an axis moves in, for tests and the panel. */
export const axisVector = (a: Axis): V3 => norm(AXES[a]);
