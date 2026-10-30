// Built from src/app/ by build.mjs; edit the TypeScript, not this file.

// src/app/main.ts
import { channel } from "rednode";

// src/math.ts
var add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
var sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
var mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
var dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
var cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
var len = (a) => Math.hypot(a[0], a[1], a[2]);
var norm = (a) => {
  const l = len(a);
  return l > 1e-9 ? mul(a, 1 / l) : [0, 0, 0];
};
var AXES = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
function qMul(a, b) {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [aw * bx + ax * bw + ay * bz - az * by, aw * by - ax * bz + ay * bw + az * bx, aw * bz + ax * by - ay * bx + az * bw, aw * bw - ax * bx - ay * by - az * bz];
}
function qNorm(q) {
  const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
}
function qAxisAngle(axis, degrees) {
  const n = norm(axis);
  const h = degrees * Math.PI / 360;
  const s = Math.sin(h);
  return [n[0] * s, n[1] * s, n[2] * s, Math.cos(h)];
}
function qRotate(q, v2) {
  const u = [q[0], q[1], q[2]];
  const t = mul(cross(u, v2), 2);
  return add(add(v2, mul(t, q[3])), cross(u, t));
}
function qYaw(q) {
  const f = qRotate(q, [0, 1, 0]);
  return Math.atan2(-f[0], f[1]) * 180 / Math.PI;
}
var v = (r) => [r.X, r.Y, r.Z];
function basisFromMatrix(m) {
  return { pos: v(m.W), right: norm(v(m.X)), fwd: norm(v(m.Y)), up: norm(v(m.Z)) };
}
function calibrationPoints(b) {
  const ahead = add(b.pos, mul(b.fwd, 10));
  return [ahead, add(ahead, mul(b.right, 2)), add(ahead, mul(b.up, 2))];
}
function calibrate(projected) {
  const [c, r, u] = projected;
  const kx = (r.X - c.X) / 0.2;
  const kyRaw = (u.Y - c.Y) / 0.2;
  const yDown = kyRaw < 0;
  const ndc = Math.abs(c.X) < 0.5 && Math.abs(c.Y) < 0.5;
  const spanX = ndc ? 2 : Math.max(1, c.X * 2);
  const spanY = ndc ? 2 : Math.max(1, c.Y * 2);
  return { kx, ky: Math.abs(kyRaw), cx: c.X, cy: c.Y, spanX, spanY, yDown };
}
function project(cam, p) {
  const d = sub(p, cam.pos);
  const z = dot(d, cam.fwd);
  if (z < 0.05) return null;
  const sx = cam.cx + cam.kx * dot(d, cam.right) / z;
  const upward = cam.ky * dot(d, cam.up) / z;
  const sy = cam.yDown ? cam.cy - upward : cam.cy + upward;
  const px = cam.pageW / 2 + (sx - cam.cx) / cam.spanX * cam.pageW;
  const pyOff = (sy - cam.cy) / cam.spanY * cam.pageH;
  const py = cam.pageH / 2 + (cam.yDown ? pyOff : -pyOff);
  return [px, py];
}
function rayFrom(cam, px, py) {
  const a = (px - cam.pageW / 2) / cam.pageW * cam.spanX / cam.kx;
  const b = -(py - cam.pageH / 2) / cam.pageH * cam.spanY / cam.ky;
  return { o: cam.pos, d: norm(add(add(cam.fwd, mul(cam.right, a)), mul(cam.up, b))) };
}
function rayHitsBox(ray, box, position, rotation, scale) {
  const inv = [-rotation[0], -rotation[1], -rotation[2], rotation[3]];
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
function closestOnAxis(ray, origin, axis) {
  const w = sub(origin, ray.o);
  const b = dot(axis, ray.d);
  const denom = 1 - b * b;
  if (denom < 1e-6) return null;
  return (b * dot(ray.d, w) - dot(axis, w)) / denom;
}
function rayOnPlaneZ(ray, z) {
  if (Math.abs(ray.d[2]) < 1e-6) return null;
  const t = (z - ray.o[2]) / ray.d[2];
  return t > 0 ? add(ray.o, mul(ray.d, t)) : null;
}
function distToSegment(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}
function qLook(l) {
  return qNorm(qMul(qAxisAngle([0, 0, 1], l.yaw), qAxisAngle([1, 0, 0], l.pitch)));
}
function lookOf(fwd) {
  const f = norm(fwd);
  return { yaw: Math.atan2(-f[0], f[1]) * 180 / Math.PI, pitch: Math.asin(Math.max(-1, Math.min(1, f[2]))) * 180 / Math.PI };
}
function lookAxes(l) {
  const q = qLook(l);
  return { fwd: qRotate(q, [0, 1, 0]), right: qRotate(q, [1, 0, 0]), up: qRotate(q, [0, 0, 1]) };
}

// src/app/viewport.ts
import { api, game, world } from "rednode";
var COLORS = { x: "#ff4d5e", y: "#5dffa1", z: "#4d9dff", ring: "#fcee0a" };
var HOT = "#ffffff";
var UNIT_BOX = { min: [-0.5, -0.5, 0], max: [0.5, 0.5, 1] };
var Viewport = class {
  constructor(canvas, hooks) {
    this.canvas = canvas;
    this.hooks = hooks;
    this.ctx = canvas.getContext("2d");
    window.addEventListener("pointermove", (e) => {
      if (e.target === canvas || this.rmb || this.mmb || this.drag) this.onMove(e);
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
    window.addEventListener("beforeunload", () => {
      if (this.builderAsked) this.hooks.builderStop();
    });
    game.on("PlayerPuppet.OnGameAttached", () => this.forgetCamera());
  }
  ctx;
  edit = false;
  objects = [];
  selected;
  cam;
  calib;
  fov = 0;
  fpp = null;
  camSys = null;
  frame = 0;
  running = false;
  hover;
  drag;
  mouse = [0, 0];
  pending;
  cameraError = "";
  // The editor camera (B2b): its entity, its component, and where the page wants it.
  camEntity;
  camComp = null;
  camPos;
  look;
  camDirty = false;
  builderAsked = false;
  rmb = false;
  mmb = false;
  last = [0, 0];
  keys = /* @__PURE__ */ new Set();
  speed = 6;
  lastTick = 0;
  /** Drop at click: what to do with the line through the next left click. */
  placing;
  setEdit(on) {
    this.edit = on;
    this.canvas.classList.toggle("edit", on);
    if (!on) {
      this.cancel();
      this.disarm();
      this.rmb = this.mmb = false;
      this.unlock();
      if (this.builderAsked) this.hooks.builderStop();
      this.builderAsked = false;
    }
    this.kick();
  }
  /** The editor camera's entity from the mod's state, or none (V's camera). */
  setCamera(entityId) {
    if (entityId === this.camEntity) return;
    this.camEntity = entityId;
    this.camComp = null;
    this.calib = void 0;
    if (!entityId) {
      this.camPos = void 0;
      this.look = void 0;
      if (this.edit && this.builderAsked) this.builderAsked = false;
    }
  }
  /** Drop at click: the next left click in the world gives the line from the camera through it. */
  armDrop(then) {
    this.cancel();
    this.placing = then;
    this.canvas.style.cursor = "crosshair";
    this.kick();
  }
  disarm() {
    this.placing = void 0;
    this.canvas.style.cursor = "";
  }
  setScene(objects, selected) {
    this.objects = objects;
    if (selected !== this.selected && this.drag) this.cancel();
    this.selected = selected;
    this.kick();
  }
  /** The selected object, as the page shows it now (mid-drag included). */
  current() {
    const o = this.objects.find((x) => x.id === this.selected);
    if (!o) return void 0;
    return this.drag && this.drag.id === o.id ? { ...o, transform: this.drag.now } : o;
  }
  // ---- the camera ----------------------------------------------------------------------------
  forgetCamera() {
    this.fpp = null;
    this.camSys = null;
    this.cam = void 0;
    this.calib = void 0;
  }
  /** One call a frame: the first-person camera's matrix. FOV and calibration only when they change. */
  async updateCamera() {
    try {
      if (!this.fpp || !this.camSys) {
        const player = await api.GetPlayer(game.instance);
        if (!player) throw new Error("no player: load a save");
        this.fpp = await player.GetFPPCameraComponent();
        this.camSys = await api.GameInstance.GetCameraSystem(game.instance);
        if (!this.fpp || !this.camSys) throw new Error("the camera is not available");
      }
      if (this.camEntity && !this.camComp) {
        const entity = await world.entity(this.camEntity);
        this.camComp = entity ? await entity.FindComponentByName("edgebuilder_camera") : null;
      }
      const source = this.camEntity && this.camComp ? this.camComp : this.fpp;
      const b = basisFromMatrix(await source.GetLocalToWorld());
      if (this.camEntity && this.camComp && !this.camPos) {
        this.camPos = b.pos;
        this.look = lookOf(b.fwd);
      }
      if (this.frame % 30 === 0 || !this.calib) {
        const fov = await this.camSys.GetActiveCameraFOV();
        if (!this.calib || Math.abs(fov - this.fov) > 0.01) {
          const pts = calibrationPoints(b);
          const projected = await Promise.all(pts.map((p) => this.camSys.ProjectPoint({ X: p[0], Y: p[1], Z: p[2], W: 1 })));
          this.calib = calibrate(projected);
          this.fov = fov;
          this.hooks.log(`Viewport calibrated: FOV ${fov.toFixed(1)}, kx ${this.calib.kx.toFixed(3)}, ky ${this.calib.ky.toFixed(3)}, centre ${this.calib.cx.toFixed(3)},${this.calib.cy.toFixed(3)}, span ${this.calib.spanX.toFixed(1)}x${this.calib.spanY.toFixed(1)}, y ${this.calib.yDown ? "down" : "up"}`);
          await this.checkCalibration(b);
        }
      }
      this.cam = { ...b, ...this.calib, pageW: this.canvas.width, pageH: this.canvas.height };
      this.cameraError = "";
      return true;
    } catch (err) {
      const why = err.message;
      if (why !== this.cameraError) this.hooks.log(`Viewport camera: ${why}`);
      this.cameraError = why;
      this.forgetCamera();
      return false;
    }
  }
  /** Projects a fourth point both ways and logs the difference in page pixels, for the test. */
  async checkCalibration(b) {
    const p = add(add(add(b.pos, mul(b.fwd, 8)), mul(b.right, -1.5)), mul(b.up, 0.8));
    const g = await this.camSys.ProjectPoint({ X: p[0], Y: p[1], Z: p[2], W: 1 });
    const cam = { ...b, ...this.calib, pageW: this.canvas.width, pageH: this.canvas.height };
    const mine = project(cam, p);
    const c = this.calib;
    const gx = cam.pageW / 2 + (g.X - c.cx) / c.spanX * cam.pageW;
    const gyOff = (g.Y - c.cy) / c.spanY * cam.pageH;
    const gy = cam.pageH / 2 + (c.yDown ? gyOff : -gyOff);
    if (mine) this.hooks.log(`Viewport check: a test point lands ${Math.hypot(mine[0] - gx, mine[1] - gy).toFixed(1)} px from where the game projects it`);
  }
  // ---- the frame loop ----------------------------------------------------------------------------
  /** The loop runs only in Edit: with Edit off nothing is drawn (the game's outline marks the selection) and the game is not asked for the camera. */
  kick() {
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
        this.builderAsked = true;
        this.hooks.builderStart({ position: this.cam.pos, rotation: qLook(lookOf(this.cam.fwd)), fov: this.fov });
      }
      this.draw(ok);
      if (ok) requestAnimationFrame(() => void tick());
      else setTimeout(() => requestAnimationFrame(() => void tick()), 1e3);
    };
    requestAnimationFrame(() => void tick());
  }
  clear() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }
  handleEnds(o) {
    const origin = o.transform.position;
    const dist = this.cam ? Math.max(1, Math.hypot(...sub(origin, this.cam.pos))) : 5;
    const size = dist * 0.12;
    return { origin, size, tips: { x: add(origin, mul(AXES.x, size)), y: add(origin, mul(AXES.y, size)), z: add(origin, mul(AXES.z, size)) } };
  }
  ringPoints(origin, radius) {
    const pts = [];
    for (let i = 0; i <= 48; i++) {
      const a = i / 48 * Math.PI * 2;
      pts.push(add(origin, [Math.cos(a) * radius, Math.sin(a) * radius, 0]));
    }
    return pts;
  }
  draw(cameraOk) {
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
        for (const ax of ["x", "y", "z"]) {
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
    if (this.drag) this.label(...this.dragText(this.drag).split("   "));
    else if (this.edit) {
      const camHelp = this.camEntity ? "Right mouse: look, fly with W A S D Q E (Shift faster).  Middle: orbit, Shift pan.  Wheel: closer.  F: frame." : "";
      const help = this.placing ? "Click where it should go.  Esc: cancel." : o ? "Drag an arrow to move, the ring to turn. G move, R turn, S scale, Ctrl+E floor, Delete." : "Click an object to select it.";
      this.label(help, camHelp);
    }
  }
  drawBox(o) {
    const cam = this.cam;
    const b = o.bounds ? { min: o.bounds.min, max: o.bounds.max } : UNIT_BOX;
    const t = o.transform;
    const corners = [];
    for (let i = 0; i < 8; i++) {
      const local = [(i & 1 ? b.max[0] : b.min[0]) * t.scale[0], (i & 2 ? b.max[1] : b.min[1]) * t.scale[1], (i & 4 ? b.max[2] : b.min[2]) * t.scale[2]];
      corners.push(project(cam, add(t.position, qRotate(t.rotation, local))));
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
  label(...parts) {
    const ctx = this.ctx;
    ctx.font = "16px 'JetBrains Mono', Consolas, monospace";
    const centre = this.canvas.width / 2;
    const windowLeft = this.canvas.width - 24 - 448;
    const max = 2 * (windowLeft - 24 - centre) - 24;
    const lines = [];
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
  dragText(d) {
    const t = d.now;
    const typed = d.typed ? `  [${d.typed}]` : "";
    const lock = d.axis ? ` ${d.axis.toUpperCase()}` : "";
    if (d.mode === "move") {
      const dx = sub(t.position, d.start.position);
      return `Move${lock}  ${dx.map((n) => n.toFixed(2)).join(", ")} m${typed}   Enter or click: keep \xB7 Esc or right-click: undo`;
    }
    if (d.mode === "rotate") return `Turn${lock || " Z"}  ${this.turnedDegrees(d).toFixed(1)}\xB0${typed}   Enter or click: keep \xB7 Esc: undo`;
    return `Scale${lock}  ${t.scale.map((n) => n.toFixed(2)).join(", ")}${typed}   Enter or click: keep \xB7 Esc: undo`;
  }
  turnedDegrees(d) {
    const q = qMul(d.now.rotation, [-d.start.rotation[0], -d.start.rotation[1], -d.start.rotation[2], d.start.rotation[3]]);
    const deg = 2 * Math.acos(Math.min(1, Math.abs(q[3]))) * 180 / Math.PI;
    return deg;
  }
  // ---- the mouse ---------------------------------------------------------------------------------
  pageXY(e) {
    const r = this.canvas.getBoundingClientRect();
    return [(e.clientX - r.left) / r.width * this.canvas.width, (e.clientY - r.top) / r.height * this.canvas.height];
  }
  handleAt(p) {
    const o = this.current();
    const cam = this.cam;
    if (!o || !o.entityId || !cam) return void 0;
    const { origin, size, tips } = this.handleEnds(o);
    const c = project(cam, origin);
    if (!c) return void 0;
    let best;
    let bestD = 10;
    for (const ax of ["x", "y", "z"]) {
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
    return void 0;
  }
  /**
   * While looking, orbiting or panning, the cursor stays where it is, hidden, and the mouse's own
   * movement turns the view: the web's Pointer Lock, which REDnode 0.22 gives overlay pages (B2b test:
   * the cursor otherwise crossed the screen and stopped at its edge). Without it, cursor positions.
   */
  lock() {
    try {
      const r = this.canvas.requestPointerLock?.call(this.canvas);
      if (r instanceof Promise) r.catch(() => void 0);
    } catch {
    }
  }
  unlock() {
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
  }
  get locked() {
    return document.pointerLockElement === this.canvas;
  }
  onMove(e) {
    const locked = this.locked;
    if (!locked) this.mouse = this.pageXY(e);
    if (!this.edit) return;
    const dx = locked ? e.movementX : this.mouse[0] - this.last[0];
    const dy = locked ? e.movementY : this.mouse[1] - this.last[1];
    this.last = this.mouse;
    if ((this.rmb || this.mmb) && this.camPos && this.look) {
      if (this.rmb) {
        this.look = { yaw: this.look.yaw - dx * 0.15, pitch: Math.max(-89, Math.min(89, this.look.pitch - dy * 0.15)) };
      } else if (e.shiftKey) {
        const a = lookAxes(this.look);
        const k = this.pivotDistance() * 15e-4;
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
    if (this.drag) this.dragTo(this.mouse, e.ctrlKey);
    else this.hover = this.handleAt(this.mouse);
  }
  /** What the camera orbits and dollies towards: the selected object, else a point 10 m ahead. */
  pivot() {
    const o = this.current();
    if (o?.entityId) return o.transform.position;
    const a = lookAxes(this.look);
    return add(this.camPos, mul(a.fwd, 10));
  }
  pivotDistance() {
    return this.camPos ? Math.max(1, Math.hypot(...sub(this.camPos, this.pivot()))) : 10;
  }
  onWheel(e) {
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
  flyAndSend() {
    const now = performance.now();
    const dt = Math.min(0.1, (now - (this.lastTick || now)) / 1e3);
    this.lastTick = now;
    if (!this.camEntity || !this.camPos || !this.look) return;
    if (this.rmb && this.keys.size) {
      const a = lookAxes(this.look);
      let v2 = [0, 0, 0];
      if (this.keys.has("w")) v2 = add(v2, a.fwd);
      if (this.keys.has("s")) v2 = sub(v2, a.fwd);
      if (this.keys.has("d")) v2 = add(v2, a.right);
      if (this.keys.has("a")) v2 = sub(v2, a.right);
      if (this.keys.has("e")) v2 = add(v2, [0, 0, 1]);
      if (this.keys.has("q")) v2 = sub(v2, [0, 0, 1]);
      const fast = this.keys.has("shift") ? 4 : this.keys.has("control") ? 0.25 : 1;
      if (v2[0] || v2[1] || v2[2]) {
        this.camPos = add(this.camPos, mul(norm(v2), this.speed * fast * dt));
        this.camDirty = true;
      }
    }
    if (!this.camDirty) return;
    this.camDirty = false;
    const q = qLook(this.look);
    world.move(this.camEntity, { x: this.camPos[0], y: this.camPos[1], z: this.camPos[2] }, { i: q[0], j: q[1], k: q[2], r: q[3] }).catch((err) => this.hooks.log(`Camera move failed: ${err.message}`));
  }
  /** Puts the selected object in front of the camera, at a distance that fits it. */
  frameSelected() {
    const o = this.current();
    if (!o || !this.camPos || !this.look) return;
    const b = o.bounds ? { min: o.bounds.min, max: o.bounds.max } : UNIT_BOX;
    const size = Math.max(...[0, 1, 2].map((i) => (b.max[i] - b.min[i]) * o.transform.scale[i]));
    const centre = add(o.transform.position, mul(add(b.min, b.max), 0.5));
    const fwd = lookAxes(this.look).fwd;
    this.camPos = sub(centre, mul(fwd, Math.max(2, size * 2.5)));
    this.camDirty = true;
  }
  onDown(e) {
    if (!this.edit || !this.cam) return;
    this.mouse = this.pageXY(e);
    this.last = this.mouse;
    if (e.button === 2) {
      if (this.drag) this.cancel();
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
    const h = this.handleAt(this.mouse);
    const o = this.current();
    if (h && o) {
      this.canvas.setPointerCapture(e.pointerId);
      if (h === "ring") this.begin(o, "rotate", false, void 0, true);
      else this.begin(o, "move", false, h);
      return;
    }
    this.pick(this.mouse);
  }
  onUp(e) {
    if (e.button === 2 || e.button === 1) {
      if (e.button === 2) this.rmb = false;
      else this.mmb = false;
      if (!this.rmb && !this.mmb) this.unlock();
      try {
        this.canvas.releasePointerCapture(e.pointerId);
      } catch {
      }
      return;
    }
    if (this.drag && !this.drag.modal && e.button === 0) {
      this.canvas.releasePointerCapture(e.pointerId);
      this.confirm();
    }
  }
  /** Selects the nearest object under the cursor, or nothing. */
  pick(p) {
    const cam = this.cam;
    const ray = rayFrom(cam, p[0], p[1]);
    let best;
    let bestT = Infinity;
    for (const o of this.objects) {
      if (!o.entityId) continue;
      const box = o.bounds ? { min: o.bounds.min, max: o.bounds.max } : UNIT_BOX;
      const t = rayHitsBox(ray, box, o.transform.position, o.transform.rotation, o.transform.scale);
      if (t !== null && t < bestT) {
        bestT = t;
        best = o;
      }
    }
    this.hooks.select(best?.id);
  }
  // ---- drags and keys ------------------------------------------------------------------------------
  begin(o, mode, modal, axis, ring = false) {
    if (mode === "scale" && o.kind !== "mesh") {
      this.hooks.status("Only meshes scale; an entity keeps the size its template gives it.");
      return;
    }
    const t = { position: [...o.transform.position], rotation: [...o.transform.rotation], scale: [...o.transform.scale] };
    this.drag = { id: o.id, mode, axis, ring, start: t, now: t, x0: this.mouse[0], y0: this.mouse[1], typed: "", modal, moves: 0, started: performance.now() };
    this.anchor();
  }
  /** Records where the drag starts, in the terms its constraint uses. */
  anchor() {
    const d = this.drag;
    const cam = this.cam;
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
  dragTo(p, snap) {
    const d = this.drag;
    const cam = this.cam;
    if (!cam || d.typed) return;
    const ray = rayFrom(cam, p[0], p[1]);
    const s = d.start;
    let next = d.now;
    if (d.mode === "move") {
      let delta = [0, 0, 0];
      if (d.axis) {
        const t = closestOnAxis(ray, s.position, AXES[d.axis]);
        if (t === null) return;
        delta = mul(AXES[d.axis], t - (d.s0 ?? 0));
      } else {
        const q = rayOnPlaneZ(ray, s.position[2]);
        if (!q) return;
        delta = sub(q, d.p0 ?? s.position);
      }
      if (snap) delta = delta.map((n) => Math.round(n / 0.25) * 0.25);
      next = { ...s, position: add(s.position, delta) };
    } else if (d.mode === "rotate") {
      let deg;
      if (!d.axis || d.axis === "z") {
        const q = rayOnPlaneZ(ray, s.position[2]);
        const a = q ? Math.atan2(q[1] - s.position[1], q[0] - s.position[0]) : (d.a0 ?? 0) + (p[0] - d.x0) * Math.PI / 360;
        deg = (a - (d.a0 ?? 0)) * 180 / Math.PI;
      } else {
        deg = (p[0] - d.x0) * 0.5;
      }
      if (snap) deg = Math.round(deg / 15) * 15;
      next = { ...s, rotation: qNorm(qMul(qAxisAngle(AXES[d.axis ?? "z"], deg), s.rotation)) };
    } else {
      const c = project(cam, s.position);
      if (!c) return;
      let f = Math.max(0.01, Math.hypot(p[0] - c[0], p[1] - c[1]) / (d.d0 ?? 100));
      if (snap) f = Math.round(f / 0.25) * 0.25 || 0.25;
      next = { ...s, scale: this.scaled(s.scale, f, d.axis) };
    }
    this.apply(next);
  }
  scaled(base, f, axis) {
    if (!axis) return mul(base, f);
    const i = axis === "x" ? 0 : axis === "y" ? 1 : 2;
    const out = [...base];
    out[i] = base[i] * f;
    return out;
  }
  /** A transform from typed numbers: metres along the locked axis, degrees around it, or a factor. */
  typedTransform(d) {
    const n = Number(d.typed);
    if (!d.typed || Number.isNaN(n)) return void 0;
    const s = d.start;
    if (d.mode === "move") return { ...s, position: add(s.position, mul(AXES[d.axis ?? "z"], n)) };
    if (d.mode === "rotate") return { ...s, rotation: qNorm(qMul(qAxisAngle(AXES[d.axis ?? "z"], n), s.rotation)) };
    return { ...s, scale: this.scaled(s.scale, n || 1, d.axis) };
  }
  /** Shows a transform on the preview: the newest one is sent once a frame, by the frame loop. */
  apply(t) {
    const d = this.drag;
    d.now = t;
    if (d.mode === "scale") return;
    this.pending = t;
  }
  /**
   * Sends the newest pending transform without waiting for the answer. REDnode runs every call that
   * is waiting when a game frame starts in that frame, so one move a page frame keeps the object with
   * the cursor; waiting for each answer let it fall a frame or two behind (B2a test).
   */
  flushMove() {
    const p = this.pending;
    const d = this.drag;
    if (!p || !d) return;
    this.pending = void 0;
    const o = this.objects.find((x) => x.id === d.id);
    if (!o?.entityId) return;
    d.moves++;
    world.move(o.entityId, { x: p.position[0], y: p.position[1], z: p.position[2] }, { i: p.rotation[0], j: p.rotation[1], k: p.rotation[2], r: p.rotation[3] }).catch((err) => this.hooks.log(`Move failed: ${err.message}`));
  }
  confirm() {
    const d = this.drag;
    if (!d) return;
    const t = d.typed && this.typedTransform(d) || d.now;
    this.drag = void 0;
    this.hover = void 0;
    const secs = (performance.now() - d.started) / 1e3;
    if (d.moves > 0) this.hooks.log(`Drag (${d.mode}${d.axis ? ` ${d.axis}` : ""}): ${d.moves} moves in ${secs.toFixed(1)} s, ${(d.moves / Math.max(secs, 1e-3)).toFixed(0)} a second`);
    this.hooks.commit(d.id, t);
  }
  cancel() {
    const d = this.drag;
    if (!d) return;
    this.drag = void 0;
    const o = this.objects.find((x) => x.id === d.id);
    if (o?.entityId && d.mode !== "scale") {
      this.pending = void 0;
      void world.move(o.entityId, { x: d.start.position[0], y: d.start.position[1], z: d.start.position[2] }, { i: d.start.rotation[0], j: d.start.rotation[1], k: d.start.rotation[2], r: d.start.rotation[3] });
    }
  }
  onKey(e) {
    if (!this.edit) return;
    const el = document.activeElement;
    if (el && (el.tagName === "INPUT" || el.tagName === "RN-INPUT" || el.isContentEditable)) return;
    const key = e.key.toLowerCase();
    if (this.rmb && "wasdqe".includes(key)) return;
    if (key === "escape" && this.placing) {
      this.disarm();
      return this.hooks.status("Drop at click cancelled.");
    }
    if (key === "f" && !this.drag) return this.frameSelected();
    const d = this.drag;
    if (d) {
      if (key === "escape") return this.cancel();
      if (key === "enter") return this.confirm();
      if (key === "x" || key === "y" || key === "z") {
        d.axis = d.axis === key ? void 0 : key;
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
};

// src/app/main.ts
var $ = (id) => document.getElementById(id);
var post = (m) => channel.post(m);
var esc = (s) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
var shortName = (p) => p.slice(p.lastIndexOf("\\") + 1);
var state;
var kind = "all";
var from = "all";
var lookedAt;
var appearance;
var lastMessage = "";
function render(s) {
  state = s;
  const worldText = { ready: "World ready", "no-game": "No game", "no-save": "Load a save", "no-codeware": "Needs Codeware 1.14+", unknown: "World: checking" }[s.world];
  $("world").textContent = worldText;
  $("world").className = `pill ${s.world === "ready" ? "ok" : s.world === "unknown" || s.world === "no-game" ? "" : "warn"}`;
  $("world").title = s.world === "no-game" ? "REDnode is not linked to a running game. Browsing works; dropping needs the game with a save loaded." : "";
  const b = s.bridge;
  $("bridge").textContent = b.status === "ready" ? `REDbridge ${b.version}` : b.status === "starting" ? "REDbridge starting" : b.status === "blocked" ? "Allow REDbridge (hover)" : b.status === "missing" ? "No REDbridge" : b.status === "failed" ? "REDbridge failed" : "REDbridge off";
  $("bridge").className = `pill ${b.status === "ready" ? "ok" : b.status === "starting" ? "" : "warn"}`;
  $("bridge").title = b.detail ?? b.path ?? "";
  const ix = s.index;
  $("index").textContent = ix.status === "ready" ? `${ix.count.toLocaleString()} assets` : ix.status === "building" ? "Indexing..." : ix.status === "failed" ? "Index failed" : "No index";
  $("index").className = `pill ${ix.status === "ready" ? "ok" : ix.status === "building" ? "" : "warn"}`;
  $("index").title = ix.progress ?? ix.file ?? "";
  $("progress").textContent = ix.status === "building" ? ix.progress ?? "" : "";
  const list = $("results");
  const keep = lookedAt;
  list.innerHTML = s.results.map((r) => `<rn-item value="${esc(r.path)}" title="${esc(rowTitle(r))}"${r.path === keep ? " selected" : ""}>${esc(shortName(r.path))}<span slot="end">${esc(rowTag(r))}</span></rn-item>`).join("");
  const total = s.index.count + s.sources.mods.assets + (s.sources.project?.assets ?? 0);
  const listsAll = s.query.from === "mods" || s.query.from === "project";
  $("count").textContent = s.index.status === "ready" || s.results.length ? s.query.text || listsAll ? `${s.results.length}${s.results.length >= 120 ? "+" : ""} found` : `${total.toLocaleString()} assets: type a name to search` : "";
  const mods = s.sources.mods;
  const project2 = s.sources.project;
  $("sources").textContent = [
    mods.reading ? `Mods: ${mods.reading}` : `Mods: ${mods.assets.toLocaleString()} in ${mods.archives} archive${mods.archives === 1 ? "" : "s"}`,
    project2 ? `Project ${project2.name}: ${project2.assets}` : "No REDcode project open"
  ].join("  |  ");
  $("sources").title = project2 ? project2.archive : "Open a project in REDcode (0.10.5 or later) to list its meshes and entities here.";
  const looked = s.looked;
  if (looked && looked.path === lookedAt) {
    const info = looked.info;
    const size = info?.bounds ? `${(info.bounds.max[0] - info.bounds.min[0]).toFixed(1)} x ${(info.bounds.max[1] - info.bounds.min[1]).toFixed(1)} x ${(info.bounds.max[2] - info.bounds.min[2]).toFixed(1)} m` : info ? "no bounds" : "reading...";
    $("lookedPath").textContent = looked.path;
    $("lookedSize").textContent = info?.error ? info.error : size;
    const apps = info?.appearances ?? [];
    const appList = $("appearances");
    if (apps.length > 1) {
      if (!appearance || !apps.includes(appearance)) appearance = apps[0];
      appList.innerHTML = apps.map((a) => `<rn-item value="${esc(a)}"${a === appearance ? " selected" : ""}>${esc(a)}</rn-item>`).join("");
      appList.hidden = false;
    } else {
      appearance = apps[0];
      appList.hidden = true;
    }
    $("drop").removeAttribute("disabled");
    $("dropClick").removeAttribute("disabled");
  } else if (!lookedAt) {
    $("lookedPath").textContent = "Pick an asset";
    $("lookedSize").textContent = "";
    $("appearances").hidden = true;
    $("drop").setAttribute("disabled", "");
    $("dropClick").setAttribute("disabled", "");
  }
  const objects = $("objects");
  objects.innerHTML = s.scene.objects.map((o) => `<rn-item value="${esc(o.id)}"${o.id === s.selected ? " selected" : ""}>${esc(o.id)}<span slot="end">${o.entityId ? o.kind : "not in world"}</span></rn-item>`).join("");
  $("sceneCount").textContent = `${s.scene.objects.length} object${s.scene.objects.length === 1 ? "" : "s"}`;
  $("needs").textContent = s.scene.needs.length ? `This scene needs: ${s.scene.needs.join(", ")}` : "";
  const sel = s.scene.objects.find((o) => o.id === s.selected);
  renderSelected(sel);
  $("delete").toggleAttribute("disabled", !sel);
  $("floor").toggleAttribute("disabled", !sel?.entityId);
  $("apply").toggleAttribute("disabled", !sel);
  viewport.setScene(s.scene.objects, s.selected);
  viewport.setCamera(s.camera?.entityId);
  const missing = s.scene.objects.some((o) => !o.entityId && o.kind !== "light");
  $("rebuild").toggleAttribute("disabled", !missing);
  if (document.activeElement?.id !== "bridgePath") $("bridgePath").value = s.settings.bridgePath ?? "";
  if (document.activeElement?.id !== "gameDir") $("gameDir").value = s.settings.gameDir ?? "";
  $("bridgePath").setAttribute("placeholder", s.inUse.bridge ? `Automatic: ${s.inUse.bridge}` : "Empty: the copy EDGEdeck fetched");
  $("gameDir").setAttribute("placeholder", s.inUse.gameDir ? `Automatic: ${s.inUse.gameDir}` : "Empty: found from where REDnode runs");
  $("editorCamera").checked = s.settings.editorCamera !== false;
  $("hideHud").checked = s.settings.hideHud !== false;
  $("settingsFile").textContent = s.settings.settingsFile;
  $("bridgeDetail").textContent = [b.path, b.detail].filter(Boolean).join("\n");
  $("indexDetail").textContent = ix.file ?? "";
  if (s.message && s.message.text !== lastMessage) {
    lastMessage = s.message.text;
    $("message").textContent = s.message.text;
    $("message").className = `message ${s.message.tone}`;
    if (s.message.tone === "error" && typeof RednodeUI !== "undefined") RednodeUI.notify(s.message.text, { title: "EDGEbuilder", type: "error" });
  }
}
function rowTag(r) {
  const where = r.source ? r.source.kind === "project" ? `project ${r.source.name}` : r.source.name : r.path.toLowerCase().startsWith("ep1\\") ? "PL" : "";
  return [where, r.replaces ? "changes a game file" : "", r.kind].filter(Boolean).join(" ");
}
function rowTitle(r) {
  return r.source ? `${r.path}
${r.source.file}` : r.path;
}
var fields = ["px", "py", "pz", "yaw", "scale"];
var field = (id) => $(id);
function renderSelected(o) {
  const focused = document.activeElement?.id;
  if (o) {
    const values = {
      px: o.transform.position[0].toFixed(2),
      py: o.transform.position[1].toFixed(2),
      pz: o.transform.position[2].toFixed(2),
      yaw: qYaw(o.transform.rotation).toFixed(1),
      scale: o.transform.scale[0].toFixed(2)
    };
    for (const f of fields) if (focused !== f) field(f).value = values[f];
    field("scale").toggleAttribute("disabled", o.kind !== "mesh");
  }
  if (!o) {
    $("selected").textContent = "Nothing selected";
    return;
  }
  const [x, y, z] = o.transform.position;
  $("selected").textContent = `${o.id}
${o.resource ?? o.kind}
${o.appearance ? `appearance ${o.appearance}
` : ""}at ${x.toFixed(2)}, ${y.toFixed(2)}, ${z.toFixed(2)}${o.entityId ? `
entity ${o.entityId}` : "\nnot in the world"}`;
}
var searchTimer;
function search() {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => post({ type: "search", text: $("search").value ?? "", kind, from }), 120);
}
$("search").addEventListener("input", search);
var lastDownInWorld = false;
window.addEventListener("pointerdown", (e) => lastDownInWorld = e.target === $("view"), true);
window.addEventListener(
  "keydown",
  (e) => {
    if (e.key.length !== 1 || e.ctrlKey || e.altKey || e.metaKey) return;
    const tag = document.activeElement?.tagName;
    if (tag === "INPUT" || tag === "RN-INPUT") return;
    if (lastDownInWorld && $("edit").checked) return;
    if (!document.querySelector("#mainTabs > rn-tab")?.hasAttribute("active")) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const box = $("search");
    box.focus();
    box.value = (box.value ?? "") + e.key;
    search();
  },
  true
);
$("kinds").addEventListener("change", (e) => {
  kind = ["all", "mesh", "entity"][e.detail.index] ?? "all";
  search();
});
$("from").addEventListener("change", (e) => {
  from = ["all", "game", "mods", "project"][e.detail.index] ?? "all";
  search();
});
$("results").addEventListener("select", (e) => {
  lookedAt = e.detail.value;
  appearance = void 0;
  post({ type: "look", path: lookedAt });
  if (state) render(state);
});
$("appearances").addEventListener("select", (e) => {
  appearance = e.detail.value;
});
$("drop").addEventListener("click", () => {
  if (lookedAt) post({ type: "drop", path: lookedAt, appearance });
});
$("dropClick").addEventListener("click", () => {
  const path = lookedAt;
  const looks = appearance;
  if (!path) return;
  const edit = $("edit");
  if (!edit.checked) {
    edit.checked = true;
    viewport.setEdit(true);
  }
  viewport.armDrop((ray) => post({ type: "drop", path, appearance: looks, at: { origin: ray.o, dir: ray.d } }));
  $("message").textContent = `Click where ${shortName(path)} should go; Esc cancels.`;
  $("message").className = "message";
});
$("objects").addEventListener("select", (e) => post({ type: "select", id: e.detail.value }));
$("delete").addEventListener("click", () => state?.selected && post({ type: "delete", id: state.selected }));
$("floor").addEventListener("click", () => state?.selected && post({ type: "floor", id: state.selected }));
function applyFields() {
  const o = state?.scene.objects.find((x) => x.id === state?.selected);
  if (!o) return;
  const num = (f, fallback) => {
    const n = Number(field(f).value);
    return Number.isFinite(n) ? n : fallback;
  };
  const t = o.transform;
  const yawNow = qYaw(t.rotation);
  const turn = num("yaw", yawNow) - yawNow;
  const s = o.kind === "mesh" ? num("scale", t.scale[0]) || t.scale[0] : 1;
  const next = {
    position: [num("px", t.position[0]), num("py", t.position[1]), num("pz", t.position[2])],
    rotation: Math.abs(turn) > 1e-3 ? qNorm(qMul(qAxisAngle(AXES.z, turn), t.rotation)) : t.rotation,
    scale: o.kind === "mesh" ? [s, s, s] : t.scale
  };
  post({ type: "transform", id: o.id, transform: next });
}
$("apply").addEventListener("click", applyFields);
for (const f of fields) field(f).addEventListener("submit", applyFields);
var viewport = new Viewport($("view"), {
  select(id) {
    post({ type: "select", id });
    if (id) document.getElementById("mainTabs").select?.(1);
  },
  commit: (id, transform) => post({ type: "transform", id, transform }),
  remove: (id) => post({ type: "delete", id }),
  floor: (id) => post({ type: "floor", id }),
  log: (text) => post({ type: "log", text }),
  builderStart: (pose) => post({ type: "builder.start", pose }),
  builderStop: () => post({ type: "builder.stop" }),
  status(text) {
    $("message").textContent = text;
    $("message").className = "message warn";
  }
});
for (const id of ["editorCamera", "hideHud"]) {
  $(id).addEventListener("change", (e) => post({ type: "settings", [id]: !!e.detail.checked }));
}
$("edit").addEventListener("change", (e) => viewport.setEdit(!!e.detail.checked));
$("rebuild").addEventListener("click", () => post({ type: "rebuild" }));
$("clear").addEventListener("click", () => post({ type: "clear" }));
$("buildIndex").addEventListener("click", () => post({ type: "index.build" }));
$("restartBridge").addEventListener("click", () => post({ type: "bridge.restart" }));
$("saveSettings").addEventListener(
  "click",
  () => post({ type: "settings", bridgePath: $("bridgePath").value?.trim() || void 0, gameDir: $("gameDir").value?.trim() || void 0 })
);
channel.on((m) => {
  if (m?.type === "state" && m.state) render(m.state);
});
post({ type: "hello" });
