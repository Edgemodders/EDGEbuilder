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

// src/arrange.ts
function groupChain(id, groups) {
  const chain = [];
  const seen2 = /* @__PURE__ */ new Set();
  for (let g = groups.find((x) => x.id === id); g && !seen2.has(g.id); g = groups.find((x) => x.id === g.parent)) {
    seen2.add(g.id);
    chain.push(g.id);
  }
  return chain;
}
function topGroup(o, groups) {
  const chain = groupChain(o.group, groups);
  return chain[chain.length - 1];
}
function membersOf(groupId, objects, groups) {
  return objects.filter((o) => groupChain(o.group, groups).includes(groupId));
}
function pickSelection(id, selected, objects, groups, opts = {}) {
  const o = objects.find((x) => x.id === id);
  if (!o) return opts.toggle ? selected : [];
  const top = opts.single ? void 0 : topGroup(o, groups);
  const ids = top ? membersOf(top, objects, groups).map((x) => x.id) : [o.id];
  return opts.toggle ? toggleIds(selected, ids) : ids;
}
function pickMany(ids, selected, objects, groups, opts = {}) {
  const out = new Set(opts.add ? selected : []);
  for (const id of ids) for (const x of pickSelection(id, [], objects, groups, { single: opts.single })) out.add(x);
  return objects.filter((o) => out.has(o.id)).map((o) => o.id);
}
function toggleIds(selected, ids) {
  const all = ids.every((id) => selected.includes(id));
  return all ? selected.filter((id) => !ids.includes(id)) : [...selected, ...ids.filter((id) => !selected.includes(id))];
}
function selectionUnits(selected, objects, groups) {
  const sel = new Set(selected);
  const whole = (g) => membersOf(g, objects, groups).every((o) => sel.has(o.id));
  const unitGroups = /* @__PURE__ */ new Set();
  const unitObjects = [];
  for (const o of objects) {
    if (!sel.has(o.id)) continue;
    const chain = groupChain(o.group, groups);
    let unit;
    for (const g of chain) {
      if (whole(g)) unit = g;
      else break;
    }
    if (unit) unitGroups.add(unit);
    else unitObjects.push(o.id);
  }
  return { groups: [...unitGroups], objects: unitObjects };
}
function centreOf(ts) {
  if (!ts.length) return [0, 0, 0];
  let c = [0, 0, 0];
  for (const t of ts) c = add(c, t.position);
  return mul(c, 1 / ts.length);
}
function applyChange(t, c, pivot) {
  let position = t.position;
  let rotation = t.rotation;
  let scale = t.scale;
  if (c.turn) {
    position = add(pivot, qRotate(c.turn, sub(position, pivot)));
    rotation = qNorm(qMul(c.turn, rotation));
  }
  if (c.scale) {
    const off = sub(position, pivot);
    position = add(pivot, [off[0] * c.scale[0], off[1] * c.scale[1], off[2] * c.scale[2]]);
    scale = [scale[0] * c.scale[0], scale[1] * c.scale[1], scale[2] * c.scale[2]];
  }
  if (c.move) position = add(position, c.move);
  return { position, rotation, scale };
}
function boxOf(objects) {
  let min;
  let max;
  for (const o of objects) {
    const b = o.bounds ?? { min: [-0.5, -0.5, 0], max: [0.5, 0.5, 1] };
    const t = o.transform;
    for (let i = 0; i < 8; i++) {
      const local = [(i & 1 ? b.max[0] : b.min[0]) * t.scale[0], (i & 2 ? b.max[1] : b.min[1]) * t.scale[1], (i & 4 ? b.max[2] : b.min[2]) * t.scale[2]];
      const p = add(t.position, qRotate(t.rotation, local));
      min = min ? [Math.min(min[0], p[0]), Math.min(min[1], p[1]), Math.min(min[2], p[2])] : p;
      max = max ? [Math.max(max[0], p[0]), Math.max(max[1], p[1]), Math.max(max[2], p[2])] : p;
    }
  }
  return min && max ? { min, max } : void 0;
}
function collisionKey(resource) {
  return (resource ?? "").replace(/\//g, "\\").toLowerCase();
}
function seenFromBySize(o) {
  if (o.kind === "light") return 40;
  if (!o.bounds) return void 0;
  const b = boxOf([o]);
  const size = Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]);
  return Math.round(Math.min(400, Math.max(40, size * 11)));
}
var SeenFromRange = [5, 2e3];

// src/app/held.ts
import { game } from "rednode";
var down = /* @__PURE__ */ new Set();
var eventsCarry = false;
for (const type of ["pointerdown", "pointermove", "wheel"]) {
  window.addEventListener(
    type,
    (e) => {
      const m = e;
      if (m.ctrlKey || m.shiftKey || m.altKey) eventsCarry = true;
    },
    true
  );
}
window.addEventListener(
  "keydown",
  (e) => {
    if (e.key === "Tab" && down.has("Alt")) return down.clear();
    down.add(e.key);
  },
  true
);
window.addEventListener("keyup", (e) => down.delete(e.key), true);
window.addEventListener("blur", () => down.clear());
game.onState((s) => {
  if (s.overlay !== "interactive") down.clear();
});
function held(e) {
  if (eventsCarry) return { ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey };
  return {
    ctrl: e.ctrlKey || down.has("Control"),
    shift: e.shiftKey || down.has("Shift"),
    alt: e.altKey || down.has("Alt")
  };
}

// src/app/viewport.ts
import { api, game as game2, world as world2 } from "rednode";

// src/move.ts
import { world } from "rednode";
async function movePreview(o, position, rotation) {
  if (!o.entityId || o.kind === "npc") return false;
  return world.move(o.entityId, { x: position[0], y: position[1], z: position[2] }, { i: rotation[0], j: rotation[1], k: rotation[2], r: rotation[3] });
}

// src/app/viewport.ts
var COLORS = { x: "#ff4d5e", y: "#5dffa1", z: "#4d9dff", ring: "#fcee0a" };
var HOT = "#ffffff";
var UNIT_BOX = { min: [-0.5, -0.5, 0], max: [0.5, 0.5, 1] };
function busyText(b) {
  const step = b.total ? `: ${Math.min(b.total, (b.done ?? 0) + 1)} of ${b.total}` : "";
  const secs = Math.round((Date.now() - b.since) / 1e3);
  return `${b.what}${step} \xB7 ${secs} s${b.waiting ? ` \xB7 ${b.waiting} more waiting` : ""}`;
}
var RightTapMs = 250;
var RightTapPx = 6;
var Viewport = class {
  constructor(canvas, hooks) {
    this.canvas = canvas;
    this.hooks = hooks;
    this.ctx = canvas.getContext("2d");
    const fit = () => {
      const w = Math.max(1, Math.round(window.innerWidth));
      const h = Math.max(1, Math.round(window.innerHeight));
      if (canvas.width === w && canvas.height === h) return;
      canvas.width = w;
      canvas.height = h;
      this.calib = void 0;
    };
    fit();
    window.addEventListener("resize", fit);
    window.addEventListener("pointermove", (e) => {
      this.overView = e.target === canvas;
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
    window.addEventListener("beforeunload", () => {
      if (this.builderAsked) this.hooks.builderStop();
    });
    game2.on("PlayerPuppet.OnGameAttached", () => this.forgetCamera());
    game2.onState((s) => {
      if (!s.menu) return;
      this.cancel();
      this.disarm();
      this.box = void 0;
      this.rmb = this.mmb = false;
      this.unlock();
      this.keys.clear();
    });
  }
  ctx;
  edit = false;
  objects = [];
  selected = [];
  /** A selection box being drawn with Shift held: where it started and where the cursor is. */
  box;
  cam;
  calib;
  fov = 0;
  fpp = null;
  camSys = null;
  frame = 0;
  running = false;
  hover;
  /** The mod is busy with a change: shown at the top of the view, so clicks that wait are not a surprise. */
  busyWith;
  /** The cursor was last over the view, not over a window. */
  overView = false;
  drag;
  mouse = [0, 0];
  /** The drag changed since the last frame: send the previews' new places. */
  pending = false;
  cameraError = "";
  // The editor camera (B2b): its entity, its component, and where the page wants it.
  camEntity;
  camComp = null;
  camPos;
  /** Where the camera was at the last frame, whichever camera it is (S1: Near the camera). */
  lastPos;
  look;
  flyAsk;
  camDirty = false;
  builderAsked = false;
  /** Builder mode paused: the overlay left interactive mode (F10), V has the view back; nothing moves or is drawn. */
  paused = false;
  rmb = false;
  mmb = false;
  last = [0, 0];
  keys = /* @__PURE__ */ new Set();
  speed = 6;
  lastTick = 0;
  /** Drop at click: what to do with the line through the next left click. */
  placing;
  /** Drop at click's outline: the bounds to draw, the last line asked about, and the answer. */
  outline;
  probeSeq = 0;
  probeAt = { x: NaN, y: NaN, t: 0 };
  probed;
  /**
   * Drop at click and the right button: a tap (released within RightTapMs, the mouse moved less than RightTapPx)
   * cancels, a hold looks and flies as anywhere else. Set while the right button is down during Drop at click.
   */
  rightTap;
  /** The tooltip beside the object picked in the world (the World tab's Show tooltip). */
  worldTip;
  /** The line through the cursor, for a paste, when the cursor is over the world in Edit. */
  cursorRay() {
    return this.edit && this.cam && this.overView ? rayFrom(this.cam, this.mouse[0], this.mouse[1]) : void 0;
  }
  setBusy(b) {
    this.busyWith = b;
  }
  /** The mod paused builder mode (the overlay is passive) or resumed it. */
  /** The camera's place at the last frame, if any frame was drawn. */
  cameraAt() {
    return this.lastPos;
  }
  setPaused(on) {
    if (on === this.paused) return;
    this.paused = on;
    if (on) this.cancel();
    this.calib = void 0;
    this.kick();
  }
  setEdit(on) {
    this.edit = on;
    this.canvas.classList.toggle("edit", on);
    if (!on) {
      this.cancel();
      this.disarm();
      this.box = void 0;
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
  /** EDGEbuilder is fetching what was clicked in the world: a turning disc at the top centre, from this time. */
  workingSince;
  setWorking(since) {
    this.workingSince = since;
    this.kick();
  }
  /** The tooltip beside the object picked in the world, or none. */
  setWorldTip(tip) {
    this.worldTip = tip;
    this.kick();
  }
  /** Drop at click: the next left click in the world gives the line from the camera through it. */
  armDrop(then, outline = {}) {
    this.cancel();
    this.placing = then;
    this.outline = outline;
    this.probed = void 0;
    this.probeAt = { x: NaN, y: NaN, t: 0 };
    this.canvas.style.cursor = "none";
    this.kick();
  }
  disarm() {
    this.placing = void 0;
    this.outline = void 0;
    this.probed = void 0;
    this.canvas.style.cursor = "";
  }
  /** The mod's answer to a probe: where a click would put the object. Older answers than the last one drawn are ignored. */
  setProbe(p) {
    if (!this.placing || this.probed && p.seq < this.probed.seq) return;
    this.probed = p;
  }
  /** While Drop at click waits: the line under the cursor, about 15 times a second while it moves, and now and then while it stays (the camera may fly). */
  probeIfMoved() {
    if (!this.placing || !this.cam || !this.overView) return;
    const now = performance.now();
    const [x, y] = this.mouse;
    const moved = x !== this.probeAt.x || y !== this.probeAt.y;
    if (now - this.probeAt.t < (moved || this.rmb || this.keys.size ? 66 : 400)) return;
    this.probeAt = { x, y, t: now };
    const r = rayFrom(this.cam, x, y);
    this.hooks.probe(++this.probeSeq, { o: r.o, d: r.d });
  }
  hoverAt = { x: NaN, y: NaN, t: 0, sent: false };
  /** Pick under the cursor: the line through it about seven times a second while the mouse moves over the world. */
  hoverWorldIfMoved() {
    if (!this.hooks.hoverWorld) return;
    const busy = !this.edit || !this.cam || !this.overView || this.placing || this.drag || this.box || this.rmb;
    if (busy) {
      if (this.hoverAt.sent) {
        this.hoverAt = { x: NaN, y: NaN, t: 0, sent: false };
        this.hooks.hoverWorld(null);
      }
      return;
    }
    const now = performance.now();
    const [x, y] = this.mouse;
    if (x === this.hoverAt.x && y === this.hoverAt.y || now - this.hoverAt.t < 140) return;
    const ray = rayFrom(this.cam, x, y);
    const own = this.objects.some((o) => o.entityId && rayHitsBox(ray, o.bounds ? { min: o.bounds.min, max: o.bounds.max } : UNIT_BOX, o.transform.position, o.transform.rotation, o.transform.scale) !== null);
    this.hoverAt = { x, y, t: now, sent: true };
    this.hooks.hoverWorld(own ? null : { o: ray.o, d: ray.d });
  }
  /** Drop at click's look: the object's box where a click would put it (white on a surface, amber 8 m along the line when nothing is there), and a white crosshair for the cursor. */
  drawPlacing() {
    const ctx = this.ctx;
    const p = this.probed;
    if (p && this.cam && this.probeSeq - p.seq < 30) {
      const colour = p.hit ? "rgba(255,255,255,0.9)" : "rgba(255,204,77,0.9)";
      const lines = this.outline?.edges?.();
      const scale = this.outline?.scale ?? [1, 1, 1];
      if (lines) this.drawEdges(lines, p.position, p.rotation, colour, scale);
      else {
        const b = this.outline?.bounds?.();
        const o = { id: "drop-outline", kind: "mesh", transform: { position: p.position, rotation: p.rotation, scale }, bounds: b ? { min: b.min, max: b.max } : void 0 };
        this.drawBox(o, colour, 1.5);
      }
    }
    if (!this.overView) return;
    const [x, y] = this.mouse;
    const arm = 11;
    const gap = 3;
    const cross2 = () => {
      ctx.beginPath();
      ctx.moveTo(x - arm, y);
      ctx.lineTo(x - gap, y);
      ctx.moveTo(x + gap, y);
      ctx.lineTo(x + arm, y);
      ctx.moveTo(x, y - arm);
      ctx.lineTo(x, y - gap);
      ctx.moveTo(x, y + gap);
      ctx.lineTo(x, y + arm);
      ctx.stroke();
    };
    ctx.lineCap = "round";
    ctx.strokeStyle = "rgba(0,0,0,0.7)";
    ctx.lineWidth = 4;
    cross2();
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2;
    cross2();
    ctx.lineCap = "butt";
  }
  setScene(objects, selected) {
    this.objects = objects;
    if (this.drag && selected.join("\n") !== this.selected.join("\n")) this.cancel();
    this.selected = selected;
    this.kick();
  }
  /** Edit is on and the camera is known: a drag can start. */
  get canDrag() {
    return this.edit && !!this.cam;
  }
  /** A drag, a box or Drop at click is under way: keys belong to it. */
  get busy() {
    return !!(this.drag || this.box || this.placing);
  }
  /** A duplicate's copies are selected: they follow the mouse until a click places them, Esc takes them back. */
  moveCopies() {
    if (!this.canDrag || this.drag) return;
    this.begin("move", true, void 0, false, true);
    this.kick();
  }
  /** The selected objects as the page shows them now, mid-drag included. */
  chosen() {
    const d = this.drag;
    return this.objects.filter((o) => this.selected.includes(o.id)).map((o) => d && d.starts.has(o.id) ? { ...o, transform: this.nowOf(d, o.id) } : o);
  }
  nowOf(d, id) {
    return applyChange(d.starts.get(id), d.change, d.pivot);
  }
  /** Where the gizmo sits: the middle of the selected previews. */
  gizmoAt() {
    const shown = this.chosen().filter((o) => o.entityId);
    return shown.length ? centreOf(shown.map((o) => o.transform)) : void 0;
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
        const player = await api.GetPlayer(game2.instance);
        if (!player) throw new Error("no player: load a save");
        this.fpp = await player.GetFPPCameraComponent();
        this.camSys = await api.GameInstance.GetCameraSystem(game2.instance);
        if (!this.fpp || !this.camSys) throw new Error("the camera is not available");
      }
      if (this.camEntity && !this.camComp) {
        const entity = await world2.entity(this.camEntity);
        this.camComp = entity ? await entity.FindComponentByName("edgebuilder_camera") : null;
      }
      const source = this.camEntity && this.camComp ? this.camComp : this.fpp;
      const b = basisFromMatrix(await source.GetLocalToWorld());
      this.lastPos = b.pos;
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
        this.wantEscape(false);
        this.running = false;
        this.clear();
        return;
      }
      if (this.paused) {
        this.wantEscape(false);
        this.clear();
        setTimeout(() => requestAnimationFrame(() => void tick()), 250);
        return;
      }
      this.frame++;
      this.wantEscape(!!(this.drag || this.placing || this.box));
      this.probeIfMoved();
      this.hoverWorldIfMoved();
      this.flushMove();
      this.flyWhenReady();
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
  escapeHeld = false;
  /**
   * Esc for the page while a drag, a Drop at click, a box or a copy is in progress, else Esc leaves
   * interactive mode as usual. REDnode 0.52.0 gives Esc to a page that asks with the web's Keyboard
   * Lock (REDnode #34); before that, Esc never reaches the page and a right-click cancels.
   */
  wantEscape(on) {
    if (on === this.escapeHeld) return;
    this.escapeHeld = on;
    const keyboard = navigator.keyboard;
    if (!keyboard) return;
    if (on) keyboard.lock(["Escape"]).catch(() => void 0);
    else keyboard.unlock();
  }
  clear() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }
  handleEnds(origin) {
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
    const chosen = this.chosen();
    const at = this.gizmoAt();
    if (!cameraOk || !cam) {
      if (this.edit) this.label(`No camera yet: ${this.cameraError || "load a save"}`);
      if (this.placing) this.drawPlacing();
      return;
    }
    for (const o of chosen) if (o.entityId) this.drawBox(o);
    if (this.placing) this.drawPlacing();
    if (at) {
      const { origin, size, tips } = this.handleEnds(at);
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
    if (this.worldTip && this.edit && !this.paused) this.drawWorldTip(this.worldTip);
    if (this.workingSince !== void 0 && performance.now() - this.workingSince > 15e3) this.workingSince = void 0;
    if (this.workingSince !== void 0 && performance.now() - this.workingSince > 150) this.drawWorking();
    else if (this.workingSince !== void 0) this.kick();
    if (this.drag) this.label(...this.dragText(this.drag).split("   "));
    else if (this.edit) {
      const camHelp = this.camEntity ? "Right mouse: look, fly with W A S D Q E (Shift faster).  Middle: orbit, Shift pan.  Wheel: closer.  F: frame." : "";
      const n = chosen.length;
      const help = this.placing ? `Drop at click: click where ${this.outline?.name ?? "it"} should go.  Esc or tap the right button: cancel.` : this.box ? "Release to select what is inside.  Ctrl: add to the selection." : n ? `${n > 1 ? `${n} selected. ` : ""}Drag an arrow to move, the ring to turn. G move, R turn, S scale, Ctrl+E floor, Delete. Ctrl+D duplicate, Ctrl+C copy, Ctrl+X cut, Ctrl+V paste at the cursor, Ctrl+G group, Ctrl+Z undo.` : "Click an object to select it (Alt: one out of its group, Ctrl: add). Shift+drag: select in a box.";
      this.label(help, camHelp);
    }
    if (this.busyWith) this.banner(`EDGEbuilder is busy: ${busyText(this.busyWith)}. What you do now waits its turn.`);
  }
  /** A line at the top centre of the view, for the busy state. */
  banner(text) {
    const ctx = this.ctx;
    ctx.font = "16px 'JetBrains Mono', Consolas, monospace";
    const w = ctx.measureText(text).width + 24;
    const left = this.canvas.width / 2 - w / 2;
    ctx.fillStyle = "rgba(8,9,13,0.9)";
    ctx.fillRect(left, 24, w, 32);
    const b = this.busyWith;
    const part = b.total ? Math.min(1, (b.done ?? 0) / b.total) : void 0;
    ctx.fillStyle = "#fcee0a";
    if (part !== void 0) ctx.fillRect(left, 52, w * part, 4);
    else {
      const t = performance.now() / 1200 % 1;
      ctx.fillRect(left + (w - w / 4) * t, 52, w / 4, 4);
    }
    ctx.fillText(text, left + 12, 46);
  }
  /** Drop at click's outline: the object's own edges (line pairs in its space, game axes) placed at `at`, turned by `q`. */
  drawEdges(lines, at, q, colour, s = [1, 1, 1]) {
    const cam = this.cam;
    const [x, y, z, w] = q;
    const m = [
      1 - 2 * (y * y + z * z),
      2 * (x * y - z * w),
      2 * (x * z + y * w),
      2 * (x * y + z * w),
      1 - 2 * (x * x + z * z),
      2 * (y * z - x * w),
      2 * (x * z - y * w),
      2 * (y * z + x * w),
      1 - 2 * (x * x + y * y)
    ];
    const place = (i) => {
      const a = lines[i] * s[0];
      const b = lines[i + 1] * s[1];
      const c = lines[i + 2] * s[2];
      return [at[0] + m[0] * a + m[1] * b + m[2] * c, at[1] + m[3] * a + m[4] * b + m[5] * c, at[2] + m[6] * a + m[7] * b + m[8] * c];
    };
    const ctx = this.ctx;
    ctx.strokeStyle = colour;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i + 5 < lines.length; i += 6) {
      const p = project(cam, place(i));
      const r = project(cam, place(i + 3));
      if (!p || !r) continue;
      ctx.moveTo(p[0], p[1]);
      ctx.lineTo(r[0], r[1]);
    }
    ctx.stroke();
  }
  drawBox(o, colour = "rgba(25,243,255,0.7)", width = 1) {
    const cam = this.cam;
    const b = o.bounds ? { min: o.bounds.min, max: o.bounds.max } : UNIT_BOX;
    const t = o.transform;
    const corners = [];
    for (let i = 0; i < 8; i++) {
      const local = [(i & 1 ? b.max[0] : b.min[0]) * t.scale[0], (i & 2 ? b.max[1] : b.min[1]) * t.scale[1], (i & 4 ? b.max[2] : b.min[2]) * t.scale[2]];
      corners.push(project(cam, add(t.position, qRotate(t.rotation, local))));
    }
    const edges = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
    this.ctx.strokeStyle = colour;
    this.ctx.lineWidth = width;
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
  /**
   * The picked object's tooltip, beside its box on screen and never over it: to its right, else its left,
   * else above or below; a thin line joins them. Only the world left of EDGEbuilder's window is used.
   */
  drawWorldTip(tip) {
    const cam = this.cam;
    if (!cam) return;
    const pts = tip.corners.map((c) => project(cam, c)).filter((p) => !!p);
    if (!pts.length) return;
    const r = { l: Math.min(...pts.map((p) => p[0])), r: Math.max(...pts.map((p) => p[0])), t: Math.min(...pts.map((p) => p[1])), b: Math.max(...pts.map((p) => p[1])) };
    const free = tip.area?.() ?? { left: 0, right: this.canvas.width - 24 - 624 };
    const L = free.left + 8;
    const W = free.right - 16;
    const H = this.canvas.height;
    if (r.r < L || r.l > W || r.b < 0 || r.t > H) return;
    const middle = tip.corners.reduce((a, c) => add(a, mul(c, 1 / tip.corners.length)), [0, 0, 0]);
    const far = this.lastPos ? Math.hypot(...sub(middle, this.lastPos)) : void 0;
    const lines = [...tip.lines, ...far !== void 0 ? [`${far.toFixed(1)} m from the camera`] : []];
    const ctx = this.ctx;
    ctx.font = "bold 13px 'JetBrains Mono', Consolas, monospace";
    const titleW = ctx.measureText(tip.title).width;
    ctx.font = "12px 'JetBrains Mono', Consolas, monospace";
    const w = Math.ceil(Math.max(titleW, ...lines.map((l) => ctx.measureText(l).width))) + 22;
    const h = 30 + lines.length * 17;
    const gap = 22;
    const clampY = (y2) => Math.max(8, Math.min(H - h - 8, y2));
    const clampX = (x2) => Math.max(L, Math.min(W - w, x2));
    let x;
    let y;
    if (r.r + gap + w <= W) [x, y] = [r.r + gap, clampY((r.t + r.b) / 2 - h / 2)];
    else if (r.l - gap - w >= L) [x, y] = [r.l - gap - w, clampY((r.t + r.b) / 2 - h / 2)];
    else if (r.t - gap - h >= 8) [x, y] = [clampX((r.l + r.r) / 2 - w / 2), r.t - gap - h];
    else if (r.b + gap + h <= H - 8) [x, y] = [clampX((r.l + r.r) / 2 - w / 2), r.b + gap];
    else [x, y] = [L, 8];
    const ax = x > r.r ? x : x + w < r.l ? x + w : x + w / 2;
    const ay = y > r.b ? y : y + h < r.t ? y + h : y + h / 2;
    const bx = Math.max(r.l, Math.min(r.r, ax));
    const by = Math.max(r.t, Math.min(r.b, ay));
    ctx.strokeStyle = "rgba(252,238,10,0.7)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
    ctx.fillStyle = "#fcee0a";
    ctx.beginPath();
    ctx.arc(bx, by, 2.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(8,9,13,0.9)";
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = "#fcee0a";
    ctx.fillRect(x, y, 2, h);
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.font = "bold 13px 'JetBrains Mono', Consolas, monospace";
    ctx.fillText(tip.title, x + 12, y + 8);
    ctx.font = "12px 'JetBrains Mono', Consolas, monospace";
    ctx.fillStyle = "#e8e8e8";
    lines.forEach((l, i) => ctx.fillText(l, x + 12, y + 28 + i * 17));
    ctx.textBaseline = "alphabetic";
  }
  /** A disc turning at the top centre, as the game's save spinner does, with what EDGEbuilder is doing. */
  drawWorking() {
    const ctx = this.ctx;
    const cx = (this.canvas.width - 24 - 624) / 2 + 12;
    const cy = 44;
    const a = performance.now() / 1e3 * Math.PI * 2 * 1.2;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.fillStyle = "rgba(8,9,13,0.85)";
    ctx.beginPath();
    ctx.arc(0, 0, 19, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(252,238,10,0.35)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, 15, 0, Math.PI * 2);
    ctx.stroke();
    ctx.rotate(a);
    ctx.strokeStyle = "#fcee0a";
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    for (const start of [0, Math.PI]) {
      ctx.beginPath();
      ctx.arc(0, 0, 11, start, start + Math.PI * 0.55);
      ctx.stroke();
    }
    ctx.lineCap = "butt";
    ctx.fillStyle = "#fcee0a";
    ctx.beginPath();
    ctx.arc(0, 0, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.font = "12px 'JetBrains Mono', Consolas, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillStyle = "rgba(8,9,13,0.85)";
    const text = "Picking...";
    const w = ctx.measureText(text).width + 12;
    ctx.fillRect(cx - w / 2, cy + 24, w, 18);
    ctx.fillStyle = "#fcee0a";
    ctx.fillText(text, cx, cy + 27);
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    this.kick();
  }
  label(...parts) {
    const ctx = this.ctx;
    ctx.font = "16px 'JetBrains Mono', Consolas, monospace";
    const centre = this.canvas.width / 2;
    const windowLeft = this.canvas.width - 24 - 624;
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
    const typed = d.typed ? `  [${d.typed}]` : "";
    const lock = d.axis ? ` ${d.axis.toUpperCase()}` : "";
    const many = d.ids.length > 1 ? ` ${d.ids.length} objects` : "";
    const keep = d.copy ? "Enter or click: place the copy \xB7 Esc or right-click: no copy" : "Enter or click: keep \xB7 Esc or right-click: undo";
    if (d.mode === "move") {
      const dx = d.change.move ?? [0, 0, 0];
      return `Move${many}${lock}  ${dx.map((n) => n.toFixed(2)).join(", ")} m${typed}   ${keep}`;
    }
    if (d.mode === "rotate") return `Turn${many}${lock || " Z"}  ${this.turnedDegrees(d).toFixed(1)}\xB0${typed}   ${keep}`;
    const f = d.change.scale ?? [1, 1, 1];
    const shown = d.ids.length === 1 ? this.nowOf(d, d.ids[0]).scale : f;
    return `Scale${many}${lock}  ${d.ids.length === 1 ? "" : "x "}${shown.map((n) => n.toFixed(2)).join(", ")}${typed}   ${keep}`;
  }
  turnedDegrees(d) {
    const q = d.change.turn ?? [0, 0, 0, 1];
    return 2 * Math.acos(Math.min(1, Math.abs(q[3]))) * 180 / Math.PI;
  }
  // ---- the mouse ---------------------------------------------------------------------------------
  pageXY(e) {
    const r = this.canvas.getBoundingClientRect();
    return [(e.clientX - r.left) / r.width * this.canvas.width, (e.clientY - r.top) / r.height * this.canvas.height];
  }
  handleAt(p) {
    const at = this.gizmoAt();
    const cam = this.cam;
    if (!at || !cam) return void 0;
    const { origin, size, tips } = this.handleEnds(at);
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
    if (this.rightTap) this.rightTap.moved += Math.abs(dx) + Math.abs(dy);
    if ((this.rmb || this.mmb) && this.camPos && this.look) {
      if (this.rmb) {
        this.look = { yaw: this.look.yaw - dx * 0.15, pitch: Math.max(-89, Math.min(89, this.look.pitch - dy * 0.15)) };
      } else if (held(e).shift) {
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
    if (this.box) {
      this.box.x1 = this.mouse[0];
      this.box.y1 = this.mouse[1];
    } else if (this.drag) this.dragTo(this.mouse, held(e).ctrl);
    else this.hover = this.handleAt(this.mouse);
  }
  /** What the camera orbits and dollies towards: the middle of the selection, else a point 10 m ahead. */
  pivot() {
    const at = this.gizmoAt();
    if (at) return at;
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
    world2.move(this.camEntity, { x: this.camPos[0], y: this.camPos[1], z: this.camPos[2] }, { i: q[0], j: q[1], k: q[2], r: q[3] }).catch((err) => this.hooks.log(`Camera move failed: ${err.message}`));
  }
  /** Puts the selection in front of the camera, at a distance that fits it. */
  frameSelected() {
    this.frameObjects(this.chosen());
  }
  frameObjects(objects) {
    const b = boxOf(objects);
    if (!b || !this.camPos || !this.look) return;
    const size = Math.max(...[0, 1, 2].map((i) => b.max[i] - b.min[i]));
    const centre = mul(add(b.min, b.max), 0.5);
    const fwd = lookAxes(this.look).fwd;
    this.camPos = sub(centre, mul(fwd, Math.max(2, size * 2.5)));
    this.camDirty = true;
  }
  /**
   * The Objects drawer: the camera in front of this object, keeping its heading and looking slightly
   * down. Waits for the camera, since Edit may just have gone on.
   */
  flyTo(object) {
    this.flyAsk = { object, until: performance.now() + 8e3 };
    this.kick();
  }
  flyWhenReady() {
    if (!this.flyAsk) return;
    if (performance.now() > this.flyAsk.until) this.flyAsk = void 0;
    else if (this.camEntity && this.camPos && this.look) {
      this.look = { yaw: this.look.yaw, pitch: Math.max(-35, Math.min(-5, this.look.pitch)) };
      this.frameObjects([this.flyAsk.object]);
      this.flyAsk = void 0;
    }
  }
  onDown(e) {
    if (!this.edit || !this.cam) return;
    this.mouse = this.pageXY(e);
    this.last = this.mouse;
    if (e.button === 2) {
      if (this.drag) this.cancel();
      else if (this.placing && this.camEntity) {
        this.rightTap = { at: performance.now(), moved: 0 };
        this.rmb = true;
        this.canvas.setPointerCapture(e.pointerId);
        this.lock();
      } else if (this.placing) {
        this.disarm();
        this.hooks.status("Drop at click cancelled.");
      } else if (this.box) this.box = void 0;
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
    const h = shift ? void 0 : this.handleAt(this.mouse);
    if (h) {
      this.canvas.setPointerCapture(e.pointerId);
      if (h === "ring") this.begin("rotate", false, void 0, true);
      else this.begin("move", false, h);
      return;
    }
    if (shift) {
      this.canvas.setPointerCapture(e.pointerId);
      this.box = { x0: this.mouse[0], y0: this.mouse[1], x1: this.mouse[0], y1: this.mouse[1] };
      return;
    }
    this.pick(this.mouse, e);
  }
  onUp(e) {
    if (e.button === 2 || e.button === 1) {
      if (e.button === 2) {
        this.rmb = false;
        const tap = this.rightTap;
        this.rightTap = void 0;
        if (tap && this.placing && performance.now() - tap.at < RightTapMs && tap.moved < RightTapPx) {
          this.disarm();
          this.hooks.status("Drop at click cancelled.");
        }
      } else this.mmb = false;
      if (!this.rmb && !this.mmb) this.unlock();
      try {
        this.canvas.releasePointerCapture(e.pointerId);
      } catch {
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
  endBox(e) {
    const b = this.box;
    this.box = void 0;
    const cam = this.cam;
    if (!cam) return;
    if (Math.abs(b.x1 - b.x0) < 4 && Math.abs(b.y1 - b.y0) < 4) return this.pick([b.x1, b.y1], e);
    const [l, r] = [Math.min(b.x0, b.x1), Math.max(b.x0, b.x1)];
    const [t, d] = [Math.min(b.y0, b.y1), Math.max(b.y0, b.y1)];
    const inside = this.objects.filter((o) => {
      if (!o.entityId) return false;
      const bb = o.bounds ? { min: o.bounds.min, max: o.bounds.max } : UNIT_BOX;
      const middle = add(o.transform.position, qRotate(o.transform.rotation, mul(add(bb.min, bb.max).map((v2, i) => v2 * o.transform.scale[i]), 0.5)));
      const p = project(cam, middle);
      return !!p && p[0] >= l && p[0] <= r && p[1] >= t && p[1] <= d;
    });
    this.hooks.pickBox(
      inside.map((o) => o.id),
      { add: held(e).ctrl, single: held(e).alt }
    );
  }
  /** Selects the nearest object under the cursor, or nothing. */
  pick(p, e) {
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
    const mods = held(e);
    this.hooks.pick(best?.id, { toggle: mods.ctrl, single: mods.alt }, best ? void 0 : { o: ray.o, d: ray.d });
  }
  // ---- drags and keys ------------------------------------------------------------------------------
  /**
   * Starts a drag of the selected previews. They all get the same change: moved by the same amount,
   * turned and scaled around their middle. `copy`: a duplicate's move.
   */
  begin(mode, modal, axis, ring = false, copy = false) {
    const shown = this.objects.filter((o) => this.selected.includes(o.id) && o.entityId);
    if (!shown.length) return;
    if (mode === "scale" && shown.some((o) => o.kind !== "mesh")) {
      this.hooks.status(shown.length === 1 ? "Only meshes scale; an entity keeps the size its template gives it." : "Only meshes scale, and the selection has an entity: an entity keeps the size its template gives it.");
      return;
    }
    const starts = new Map(shown.map((o) => [o.id, { position: [...o.transform.position], rotation: [...o.transform.rotation], scale: [...o.transform.scale] }]));
    const pivot = centreOf([...starts.values()]);
    this.drag = { ids: shown.map((o) => o.id), starts, mode, axis, ring, pivot, change: {}, copy, x0: this.mouse[0], y0: this.mouse[1], typed: "", modal, moves: 0, started: performance.now() };
    this.anchor();
  }
  /** Records where the drag starts, in the terms its constraint uses. */
  anchor() {
    const d = this.drag;
    const cam = this.cam;
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
  dragTo(p, snap) {
    const d = this.drag;
    const cam = this.cam;
    if (!cam || d.typed) return;
    const ray = rayFrom(cam, p[0], p[1]);
    const o = d.pivot;
    if (d.mode === "move") {
      let delta = [0, 0, 0];
      if (d.axis) {
        const t = closestOnAxis(ray, o, AXES[d.axis]);
        if (t === null) return;
        delta = mul(AXES[d.axis], t - (d.s0 ?? 0));
      } else {
        const q = rayOnPlaneZ(ray, o[2]);
        if (!q) return;
        delta = sub(q, d.p0 ?? o);
      }
      if (snap) delta = delta.map((n) => Math.round(n / 0.25) * 0.25);
      this.apply({ move: delta });
    } else if (d.mode === "rotate") {
      let deg;
      if (!d.axis || d.axis === "z") {
        const q = rayOnPlaneZ(ray, o[2]);
        const a = q ? Math.atan2(q[1] - o[1], q[0] - o[0]) : (d.a0 ?? 0) + (p[0] - d.x0) * Math.PI / 360;
        deg = (a - (d.a0 ?? 0)) * 180 / Math.PI;
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
  factor(f, axis) {
    if (!axis) return [f, f, f];
    const out = [1, 1, 1];
    out[axis === "x" ? 0 : axis === "y" ? 1 : 2] = f;
    return out;
  }
  /** A change from typed numbers: metres along the locked axis, degrees around it, or a factor. */
  typedChange(d) {
    const n = Number(d.typed);
    if (!d.typed || Number.isNaN(n)) return void 0;
    if (d.mode === "move") return { move: mul(AXES[d.axis ?? "z"], n) };
    if (d.mode === "rotate") return { turn: qAxisAngle(AXES[d.axis ?? "z"], n) };
    return { scale: this.factor(n || 1, d.axis) };
  }
  /** Shows a change on the previews: the newest places are sent once a frame, by the frame loop. */
  apply(c) {
    const d = this.drag;
    d.change = c;
    if (d.mode === "scale" && d.ids.length === 1) return;
    this.pending = true;
  }
  /**
   * Sends the previews' newest places without waiting for the answers. REDnode runs every call that
   * is waiting when a game frame starts in that frame, so one move a page frame keeps the objects with
   * the cursor; waiting for each answer let them fall a frame or two behind (B2a test).
   */
  flushMove() {
    const d = this.drag;
    if (!this.pending || !d) return;
    this.pending = false;
    for (const id of d.ids) {
      const o = this.objects.find((x) => x.id === id);
      if (!o?.entityId) continue;
      const p = this.nowOf(d, id);
      d.moves++;
      movePreview(o, p.position, p.rotation).catch((err) => this.hooks.log(`Move failed: ${err.message}`));
    }
  }
  confirm() {
    const d = this.drag;
    if (!d) return;
    if (d.typed) d.change = this.typedChange(d) ?? d.change;
    this.drag = void 0;
    this.hover = void 0;
    this.pending = false;
    const secs = (performance.now() - d.started) / 1e3;
    if (d.moves > 0) this.hooks.log(`Drag (${d.mode}${d.axis ? ` ${d.axis}` : ""}, ${d.ids.length} object${d.ids.length === 1 ? "" : "s"}): ${d.moves} moves in ${secs.toFixed(1)} s, ${(d.moves / Math.max(secs, 1e-3)).toFixed(0)} a second`);
    const items = d.ids.map((id) => ({ id, transform: this.nowOf(d, id) }));
    for (const i of items) {
      const o = this.objects.find((x) => x.id === i.id);
      if (o) o.transform = i.transform;
    }
    this.hooks.commit(items, d.copy);
  }
  cancel() {
    const d = this.drag;
    if (!d) return;
    this.drag = void 0;
    this.pending = false;
    if (d.copy) return this.hooks.undo();
    for (const [id, t] of d.starts) {
      const o = this.objects.find((x) => x.id === id);
      if (o?.entityId) void movePreview(o, t.position, t.rotation).catch(() => void 0);
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
    if (key === "escape" && this.box) {
      this.box = void 0;
      return;
    }
    if (key === "f" && !this.drag) return this.frameSelected();
    const d = this.drag;
    if (d) {
      if (e.ctrlKey && key.length === 1) return;
      if (key === "escape") return this.cancel();
      if (key === "enter") return this.confirm();
      if (key === "x" || key === "y" || key === "z") {
        d.axis = d.axis === key ? void 0 : key;
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
};

// src/worldedits.ts
function doorStateText(d) {
  if (!d) return "";
  return [d.open === void 0 ? "" : d.open ? "open" : "closed", d.locked === void 0 ? "" : d.locked ? "locked" : "unlocked"].filter(Boolean).join(", ");
}

// src/explore.ts
function exploreSegments(root, assetPath) {
  if (root !== "people") return assetPath.split("\\");
  const name = assetPath.replace(/^character\./i, "");
  const cut = name.indexOf("_");
  return cut > 0 ? [name.slice(0, cut).toLowerCase(), assetPath] : [assetPath];
}

// src/app/help.md
var help_default = '<h1>EDGEbuilder</h1>\n<p class="version">Version 0.14.0, for Cyberpunk 2077 2.5</p>\n\n<p>A world builder that runs inside the game. You find a model, drop it into the world, move it until it sits right, arrange a scene, and bake the scene into a mod, so the objects are part of Night City for anyone who installs it.</p>\n<p>Two words you will meet everywhere:</p>\n<ul>\n<li>A <strong>preview</strong> is an object you placed that is not baked yet. Only you see it, and only while EDGEbuilder runs.</li>\n<li>To <strong>bake</strong> a scene is to turn it into a mod: its objects then stand in the world without EDGEbuilder.</li>\n</ul>\n<h2>Before you start</h2>\n<p>The three pills at the top say whether everything is ready:</p>\n<table>\n<thead>\n<tr>\n<th>Pill</th>\n<th>Ready when it says</th>\n<th>If not</th>\n</tr>\n</thead>\n<tbody><tr>\n<td>World</td>\n<td><strong>World ready</strong></td>\n<td>Load a save</td>\n</tr>\n<tr>\n<td>REDbridge</td>\n<td><strong>REDbridge</strong> and its version, in green</td>\n<td>Hover it for why. It reads the game&#39;s files and bakes</td>\n</tr>\n<tr>\n<td>Index</td>\n<td>About <strong>31,600 assets</strong></td>\n<td>It says <strong>Indexing...</strong> for a few seconds the first time</td>\n</tr>\n</tbody></table>\n<h2>First scene in five steps</h2>\n<ol>\n<li><strong>Library</strong> tab: type a name in <strong>Name</strong>, pick a folder in the tree, press <strong>New scene here</strong>. The scene is saved after every change from now on.</li>\n<li><strong>Assets</strong> tab: type <code>crate</code>. Typing anywhere on the tab goes into the search box.</li>\n<li>Click a result. <strong>Picked</strong> shows its size and its looks (appearances): click one.</li>\n<li>Press <strong>Drop where I look</strong>, or <strong>Drop at click</strong> and click the spot in the world.</li>\n<li>Switch <strong>Edit</strong> on (top right of this window), click the crate, and drag its arrows.</li>\n</ol>\n<h2>Find something</h2>\n<ul>\n<li><strong>Search</strong> finds the game&#39;s meshes, entities and people by name. The tabs under the box narrow it by kind (<strong>Meshes</strong>, <strong>Entities</strong>, <strong>NPCs</strong>) and by where it comes from (<strong>Game</strong>, <strong>Mods</strong>, <strong>Project</strong>). The \u2715 in the box clears it.</li>\n<li><strong>Explorer</strong>: the folder button beside the search box. The game&#39;s own folders, each mod, the open REDcode project and the game&#39;s people, opened one folder at a time. Typing filters the folder clicked last; its arrows make it wider. A search result you click is found in it too. A pick shows the model in 3D beside it: drag to turn it, the wheel zooms. <strong>Drop</strong> starts Drop at click.</li>\n<li><strong>Preview</strong> switch, beside the result count: with it on, a click on a result shows it in that same 3D drawer.</li>\n<li><strong>Previews</strong>, the eye beside it: the results as small 3D pictures. Rest the mouse on one to turn it; a click shows its details beside them, with <strong>Drop</strong>. In Settings, <strong>A picture&#39;s details before Drop</strong> off makes a click start Drop at click at once.</li>\n</ul>\n<p>A <strong>mesh</strong> is a plain 3D model. An <strong>entity</strong> is a model with parts and behaviour, such as a device. A <strong>person</strong> (NPC) stands friendly and idle.</p>\n<h2>Drop it</h2>\n<ul>\n<li><strong>Drop where I look</strong> puts it in front of you, on what the camera looks at.</li>\n<li><strong>Drop at click</strong>: the cursor becomes a crosshair and the object&#39;s outline sits where a click would put it (amber over the sky). Click to drop. <kbd>Esc</kbd> or a quick tap of the right button cancels; hold the right button to look and fly as usual, and the outline follows the crosshair.</li>\n</ul>\n<h2>Edit mode and the camera</h2>\n<p>Switch <strong>Edit</strong> on to work in the world: the mouse works in the world, the game&#39;s HUD hides and EDGEbuilder looks through a camera of its own. V stays where V stood. Both can be switched off in <strong>Settings</strong>.</p>\n<table>\n<thead>\n<tr>\n<th>To</th>\n<th>Do</th>\n</tr>\n</thead>\n<tbody><tr>\n<td>Look around</td>\n<td>Hold the right mouse button and move the mouse</td>\n</tr>\n<tr>\n<td>Fly</td>\n<td>Right button held, <kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd>, <kbd>Q</kbd> down, <kbd>E</kbd> up; <kbd>Shift</kbd> faster, the wheel sets the speed</td>\n</tr>\n<tr>\n<td>Orbit the selection</td>\n<td>Middle button; with <kbd>Shift</kbd> it pans; the wheel moves closer</td>\n</tr>\n<tr>\n<td>Frame the selection</td>\n<td><kbd>F</kbd></td>\n</tr>\n</tbody></table>\n<p>A help line at the bottom of the screen always says what you can do next. <kbd>F10</kbd> hands the mouse back to the game: V\u2019s view and the HUD come back, and Edit picks up where it was at the next <kbd>F10</kbd>.</p>\n<h2>Position</h2>\n<p>Click an object to select it. Its <strong>gizmo</strong> has red, green and blue arrows (drag one to move along it) and a yellow ring (drag it to turn).</p>\n<table>\n<thead>\n<tr>\n<th>Key</th>\n<th>Does</th>\n</tr>\n</thead>\n<tbody><tr>\n<td><kbd>G</kbd> <kbd>R</kbd> <kbd>S</kbd></td>\n<td>Move, turn, scale (meshes) with the mouse</td>\n</tr>\n<tr>\n<td>then <kbd>X</kbd> <kbd>Y</kbd> <kbd>Z</kbd></td>\n<td>Lock to one axis; type a number for an exact amount</td>\n</tr>\n<tr>\n<td><kbd>Enter</kbd> or a click</td>\n<td>Keep it</td>\n</tr>\n<tr>\n<td><kbd>Esc</kbd> or a right-click</td>\n<td>Put it back</td>\n</tr>\n<tr>\n<td><kbd>Ctrl</kbd> while dragging</td>\n<td>Snap to steps</td>\n</tr>\n<tr>\n<td><kbd>Ctrl</kbd>+<kbd>E</kbd></td>\n<td>Drop to the floor</td>\n</tr>\n<tr>\n<td><kbd>Delete</kbd></td>\n<td>Remove it from the scene</td>\n</tr>\n</tbody></table>\n<p><strong>Selected</strong> on the Scene tab takes exact numbers: X, Y, Z, Heading, Scale, and <strong>Seen from</strong>, how far off it is seen once baked. <strong>Solid</strong> makes a mesh stop V once baked, when its mesh carries collision data.</p>\n<h2>Arrange</h2>\n<table>\n<thead>\n<tr>\n<th>Keys</th>\n<th>Does</th>\n</tr>\n</thead>\n<tbody><tr>\n<td><kbd>Ctrl</kbd>+click, <kbd>Shift</kbd>+drag, <kbd>Ctrl</kbd>+<kbd>A</kbd></td>\n<td>Add to the selection, select in a box, select all</td>\n</tr>\n<tr>\n<td><kbd>Ctrl</kbd>+<kbd>G</kbd>, <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>G</kbd></td>\n<td>Group, ungroup. A click selects the whole group, <kbd>Alt</kbd>+click one object</td>\n</tr>\n<tr>\n<td><kbd>Ctrl</kbd>+<kbd>D</kbd></td>\n<td>Duplicate: the copy follows the mouse until a click puts it down</td>\n</tr>\n<tr>\n<td><kbd>Ctrl</kbd>+<kbd>C</kbd>, <kbd>Ctrl</kbd>+<kbd>X</kbd>, <kbd>Ctrl</kbd>+<kbd>V</kbd></td>\n<td>Copy, cut, paste where the cursor points</td>\n</tr>\n<tr>\n<td><kbd>Ctrl</kbd>+<kbd>Z</kbd>, <kbd>Ctrl</kbd>+<kbd>Y</kbd></td>\n<td>Undo, redo (the last 100 changes)</td>\n</tr>\n</tbody></table>\n<p>A move, turn or scale acts on the whole selection, around its middle.</p>\n<h2>Scenes and the Library</h2>\n<ul>\n<li>The open scene is saved after every change. <kbd>Ctrl</kbd>+<kbd>S</kbd> confirms it, <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>S</kbd> saves a copy under a new name. Its name is at the top of the <strong>Scene</strong> tab (Enter renames it).</li>\n<li>The <strong>Library</strong> tab lists every scene: in the <strong>Library</strong> (your own folders, shared by the EDGE tools, <code>Documents\\EDGE Library</code> unless you choose another in Settings), in the open REDcode project, and on <strong>This PC</strong>.</li>\n<li>Pick a scene to <strong>Open</strong> it, <strong>Close</strong> it, or <strong>Show in world</strong> beside the one you are editing (shown, not editable). <strong>Objects</strong> lists a scene&#39;s objects in a drawer: two clicks fly the camera to one.</li>\n<li>The icon at the top right of the tree moves the Library out of the window into a drawer. The drawer&#39;s arrows make it wider or narrower. <strong>Objects</strong>: the eye on a row shows the object in 3D beside the drawer, with <strong>Drop a copy</strong> (its look, scale and settings kept).</li>\n<li>EDGEbuilder opens the last scene again when it starts.</li>\n</ul>\n<h2>Import a model of your own</h2>\n<ol>\n<li>Library tab: type the path of a <code>.glb</code> file in the box at the top, or press the folder button beside it to find it on your disk. Models in the Library, in the project&#39;s <code>source\\raw</code> and on EDGEfab&#39;s Desk are listed in the tree too.</li>\n<li>Pick it. The Import box asks for a <strong>Name</strong>, a <strong>Height</strong> (for a model with no real size) and how solid it is.</li>\n<li>Press <strong>Import</strong>. It goes into the open REDcode project, is packed and comes into the running game. Making textures takes most of the time; <strong>Stop</strong> ends it.</li>\n<li>It is then picked on the Assets tab, ready to drop.</li>\n</ol>\n<h2>The game&#39;s own objects</h2>\n<p>The <strong>World</strong> tab:</p>\n<ul>\n<li><strong>Nearby</strong> finds the doors near V (<strong>Scan Doors</strong>). With <strong>Edit</strong> on, a click picks a door. The switches choose what a click picks: doors, painted-on doors, meshes.</li>\n<li><strong>Pick under the cursor</strong> (in Picked in the world): what a click would pick is outlined as the mouse moves, and a click picks any mesh or door. Its details open in a drawer at the left of the screen: the model in 3D, its kind, size, place, node and sector, and whether it is <strong>solid</strong> where you clicked. <strong>Drop a copy</strong> puts a copy in your scene. <strong>Show tooltip</strong>, beside it, puts the picked object&#39;s name, kind, size and distance in a tooltip next to it in the world.</li>\n<li><strong>Remove from world</strong> takes a door, a painted-on door or a mesh out, kept in the scene. <strong>Restore</strong> or Undo brings it back. A bake removes it for good.</li>\n<li><strong>Open</strong>, <strong>Close</strong>, <strong>Lock</strong> keep a door that way while the scene is open.</li>\n<li><strong>Sectors</strong> lists the pieces the game streams the world in: near V, near the camera, or by name. A sector&#39;s drawer lists every entry in it: pick, fly to, hide for the session or remove.</li>\n</ul>\n<h2>Bake</h2>\n<ol>\n<li>Open a project in REDcode (VS Code). The <strong>Bake</strong> tab names it, and checks the scene.</li>\n<li>Press <strong>Bake</strong>. The scene becomes a streaming sector of its own in the project.</li>\n<li>In REDcode, <strong>Pack and Install</strong> (or add it in EDGEdeck and deploy), then start the game again: a bake comes in as the game starts.</li>\n</ol>\n<p>The previews of a scene whose bake is in the game stay off, so nothing stands twice. <strong>Bake into Library</strong>, on the Library tab, keeps a bake there that can hold several scenes; <strong>Include in project</strong> copies it into a project. People are not baked yet.</p>\n<h2>Settings</h2>\n<p>The REDbridge and game folders (found by themselves when empty), the editor camera and HUD switches, a picture&#39;s details before Drop, the Library folder, <strong>Rebuild asset index</strong> and <strong>Restart REDbridge</strong>.</p>\n<h2>More help</h2>\n<p>The full guide, with pictures: <code>edgemodders.ai/wiki/edgebuilder</code></p>\n<p>Questions and bugs: <code>github.com/Edgemodders/EDGEbuilder/issues</code></p>\n<p>EDGEbuilder is inspired by World Builder by keanuWheeze. It is its own design and uses none of World Builder&#39;s code, files or data.</p>\n';

// src/app/main.ts
var $ = (id) => document.getElementById(id);
var post = (m) => channel.post(m);
var esc = (s) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
var shortName = (p) => p.slice(p.lastIndexOf("\\") + 1);
var labelOf = (r) => r.kind === "npc" ? r.name ?? r.path.replace(/^Character\./, "") : shortName(r.path);
var labelFor = (p) => {
  const r = state?.results.find((x) => x.path === p);
  return r ? labelOf(r) : shortName(p);
};
var state;
var kind = "all";
var from = "all";
var lookedAt;
var appearance;
var lastMessage = "";
var closed = /* @__PURE__ */ new Set();
var copyAsked = false;
var lastCopy;
var dropAsked = false;
var knownIds = /* @__PURE__ */ new Set();
var busyNow;
var busyTick;
function renderBusy(b) {
  busyNow = b;
  viewport.setBusy(b);
  const row = $("busyRow");
  row.hidden = !b;
  if (!b) {
    if (busyTick) clearInterval(busyTick);
    busyTick = void 0;
    return;
  }
  const bar = $("busy");
  if (b.total) {
    bar.setAttribute("max", String(b.total));
    bar.setAttribute("value", String(b.done ?? 0));
  } else bar.removeAttribute("value");
  const label = () => busyNow && bar.setAttribute("label", `Busy: ${busyText(busyNow)}`);
  label();
  busyTick ??= setInterval(label, 1e3);
}
var importedAt;
function pickImported(s) {
  const at = s.imported?.at;
  if (importedAt === void 0) {
    importedAt = at ?? 0;
    return;
  }
  if (!s.imported || at === importedAt) return;
  importedAt = at;
  const path = s.imported.path;
  lookedAt = path;
  appearance = void 0;
  mainTabs().select?.(0);
  document.getElementById("kinds").select?.(0);
  document.getElementById("from").select?.(0);
  kind = "all";
  from = "all";
  const box = $("search");
  box.value = path.slice(path.lastIndexOf("\\") + 1).replace(/\.ent$/i, "");
  post({ type: "search", text: box.value, kind, from });
  post({ type: "look", path });
}
function render(s) {
  state = s;
  pickImported(s);
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
  $("progress").textContent = ix.status === "building" ? ix.progress ?? "" : s.npcs.status === "reading" ? s.npcs.progress ?? "" : "";
  const list = $("results");
  const keep = lookedAt;
  list.innerHTML = s.results.map((r) => `<rn-item value="${esc(r.path)}" title="${esc(rowTitle(r))}"${r.path === keep ? " selected" : ""}>${esc(labelOf(r))}<span slot="end">${esc(rowTag(r))}</span></rn-item>`).join("");
  const total = s.index.count + s.sources.mods.assets + (s.sources.project?.assets ?? 0);
  const listsAll = s.query.from === "mods" || s.query.from === "project";
  $("count").textContent = s.index.status === "ready" || s.results.length ? s.query.text || listsAll ? foundText(s) : `${total.toLocaleString()} assets${s.npcs.count ? ` and ${s.npcs.count.toLocaleString()} NPCs` : ""}: type a name to search` : "";
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
    $("lookedPath").textContent = looked.path === labelFor(looked.path) ? looked.path : `${labelFor(looked.path)}
${looked.path}`;
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
  $("objects").innerHTML = sceneRows(s);
  const groupCount = s.scene.groups.length;
  $("sceneCount").textContent = `${holds(s.scene.objects.length, editCount(s).removals, false, editCount(s).doors)}${groupCount ? `, ${groupCount} group${groupCount === 1 ? "" : "s"}` : ""}${s.selected.length > 1 ? `; ${s.selected.length} selected` : ""}`;
  $("needs").textContent = s.scene.needs.length ? `This scene needs: ${s.scene.needs.join(", ")}` : "";
  const sel = s.scene.objects.filter((o) => s.selected.includes(o.id));
  if (dropAsked && sel.length && sel.every((o) => !knownIds.has(o.id))) {
    dropAsked = false;
    showSceneTab();
  }
  knownIds = new Set(s.scene.objects.map((o) => o.id));
  renderSelected(sel, s);
  $("delete").toggleAttribute("disabled", !sel.length);
  $("floor").toggleAttribute("disabled", !sel.some((o) => o.entityId));
  $("apply").toggleAttribute("disabled", !sel.length);
  $("duplicate").toggleAttribute("disabled", !sel.length);
  $("group").toggleAttribute("disabled", !sel.length);
  $("ungroup").toggleAttribute("disabled", !sel.some((o) => o.group));
  $("undo").toggleAttribute("disabled", !s.history.undo);
  $("redo").toggleAttribute("disabled", !s.history.redo);
  $("undo").title = `Ctrl+Z (${s.history.undo} step${s.history.undo === 1 ? "" : "s"})`;
  $("redo").title = `Ctrl+Y (${s.history.redo} step${s.history.redo === 1 ? "" : "s"})`;
  viewport.setScene(s.scene.objects, s.selected);
  renderDrawer(s);
  renderWorld(s);
  renderSectors(s);
  renderSectorDrawer(s);
  renderPreviews(s);
  explorerFresh(s);
  renderLeft();
  renderExPreview(s);
  renderEdits(s);
  viewport.setCamera(s.camera?.entityId);
  viewport.setPaused(!!s.camera?.paused);
  if (lastCopy === void 0) lastCopy = s.duplicated?.seq ?? 0;
  if (s.duplicated && s.duplicated.seq !== lastCopy) {
    lastCopy = s.duplicated.seq;
    if (copyAsked) viewport.moveCopies();
    copyAsked = false;
  }
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
  renderLibrary(s);
  renderBake(s);
  renderBusy(s.busy);
  if (s.message && s.message.text !== lastMessage) {
    lastMessage = s.message.text;
    $("message").textContent = s.message.text;
    $("message").className = `message ${s.message.tone}`;
    if (s.message.tone === "error" && typeof RednodeUI !== "undefined") RednodeUI.notify(s.message.text, { title: "EDGEbuilder", type: "error" });
  }
}
function holds(objects, removals = 0, short = false, doors = 0) {
  const kept = doors ? short ? `, ${doors} door${doors === 1 ? "" : "s"}` : `, ${doors} door${doors === 1 ? "" : "s"} set` : "";
  return (short ? `+${objects} \u2212${removals}` : `${objects} added, ${removals} removed`) + kept;
}
function editCount(s) {
  const e = s.scene.worldEdits;
  return { removals: e.filter((x) => x.action === "remove").length, doors: e.filter((x) => x.action === "door").length };
}
function foundText(s) {
  const n = s.results.length;
  const q = s.query;
  const [one, many] = q.kind === "mesh" ? ["mesh", "meshes"] : q.kind === "entity" ? ["entity", "entities"] : q.kind === "npc" ? ["NPC", "NPCs"] : ["asset", "assets"];
  return `${n}${n >= 120 ? "+" : ""} ${n === 1 ? one : many} found${q.text ? ` for "${q.text}"` : ""}`;
}
function rowTag(r) {
  if (r.kind === "npc") return `${r.path} NPC`;
  const where = r.source ? r.source.kind === "project" ? `project ${r.source.name}` : r.source.name : r.path.toLowerCase().startsWith("ep1\\") ? "PL" : "";
  return [where, r.replaces ? "changes a game file" : "", r.kind].filter(Boolean).join(" ");
}
function rowTitle(r) {
  if (r.kind === "npc") return `${r.name ? `${r.name}
` : ""}${r.path}
${r.template ?? ""}`;
  return r.source ? `${r.path}
${r.source.file}` : r.path;
}
function sceneRows(s) {
  const { objects, groups } = s.scene;
  const rows = [];
  const pad = (depth) => ` style="padding-left:${12 + depth * 18}px"`;
  const walk = (parent, depth) => {
    for (const g of groups.filter((x) => x.parent === parent)) {
      const members = membersOf(g.id, objects, groups);
      const all = members.length > 0 && members.every((o) => s.selected.includes(o.id));
      rows.push(
        `<rn-item value="g:${esc(g.id)}"${all ? " selected" : ""}${pad(depth)}><span class="fold" data-group="${esc(g.id)}">${closed.has(g.id) ? "\u25B8" : "\u25BE"}</span>${esc(g.name)}<span slot="end">group of ${members.length}</span></rn-item>`
      );
      if (!closed.has(g.id)) walk(g.id, depth + 1);
    }
    for (const o of objects.filter((x) => (x.group ?? null) === parent)) {
      rows.push(`<rn-item value="o:${esc(o.id)}"${s.selected.includes(o.id) ? " selected" : ""}${pad(depth)}>${esc(o.id)}<span slot="end">${o.entityId ? o.kind : "not in world"}</span></rn-item>`);
    }
  };
  walk(null, 0);
  return rows.join("");
}
var fields = ["px", "py", "pz", "yaw", "scale"];
var field = (id) => $(id);
function renderSolid(sel, s) {
  const meshes = sel.filter((o) => o.kind === "mesh");
  $("solidRow").hidden = !meshes.length;
  if (!meshes.length) return;
  const none = new Set(s.noCollision);
  const able = meshes.filter((o) => !none.has(collisionKey(o.resource)));
  const solid = able.filter((o) => o.solid).length;
  const toggle = $("solid");
  toggle.checked = able.length > 0 && solid === able.length;
  toggle.toggleAttribute("disabled", !able.length);
  const cannot = meshes.length - able.length;
  const lines = [];
  if (meshes.length > 1 && solid && solid < able.length) lines.push(`${solid} of ${able.length} solid.`);
  if (cannot) lines.push(meshes.length === 1 ? "No collision data, so this mesh can't be solid." : cannot === 1 ? "1 of these has no collision data, so it can't be solid." : `${cannot} of these have no collision data, so they can't be solid.`);
  $("solidNote").textContent = lines.join(" ");
}
var seenShown = "";
function renderSeenFrom(sel) {
  const f = $("seenFrom");
  f.hidden = !sel.length || sel.every((o) => o.kind === "npc");
  if (f.hidden) return;
  const own = new Set(sel.map((o) => o.streaming?.primary ?? null));
  const one = own.size === 1 ? [...own][0] : void 0;
  seenShown = one == null ? "" : String(one);
  if (document.activeElement?.id !== "seenFrom") f.value = seenShown;
  const bySize = sel.length === 1 ? seenFromBySize(sel[0]) : void 0;
  f.setAttribute("placeholder", own.size > 1 ? "mixed" : bySize ? `${bySize} by size` : "by size");
}
function applySeenFrom() {
  if (!state) return;
  const text = $("seenFrom").value.trim();
  if (text === seenShown) return;
  const n = Number(text);
  if (text && (!Number.isFinite(n) || n <= 0)) {
    $("seenFrom").value = seenShown;
    return status(`Seen from takes metres, ${SeenFromRange[0]} to ${SeenFromRange[1]}, or empty for a distance by size.`);
  }
  seenShown = text;
  post({ type: "seenFrom", ids: state.selected, metres: text ? n : null });
}
function renderSelected(sel, s) {
  renderSolid(sel, s);
  renderSeenFrom(sel);
  const focused = document.activeElement?.id;
  const units = selectionUnits(s.selected, s.scene.objects, s.scene.groups);
  const oneGroup = units.groups.length === 1 && !units.objects.length ? s.scene.groups.find((g) => g.id === units.groups[0]) : void 0;
  const groupName = $("groupName");
  groupName.hidden = !oneGroup;
  groupName.dataset.group = oneGroup?.id ?? "";
  if (oneGroup && focused !== "groupName") groupName.value = oneGroup.name;
  field("yaw").setAttribute("label", sel.length > 1 ? "Turn by" : "Heading");
  field("scale").setAttribute("label", sel.length > 1 ? "Scale by" : "Scale");
  if (sel.length > 1) {
    const c = centreOf(sel.map((o2) => o2.transform));
    const values = { px: c[0].toFixed(2), py: c[1].toFixed(2), pz: c[2].toFixed(2), yaw: "0", scale: "1" };
    for (const f of fields) if (focused !== f) field(f).value = values[f];
    field("scale").hidden = sel.some((o2) => o2.kind !== "mesh");
    const shown = sel.filter((o2) => o2.entityId).length;
    $("selected").textContent = `${oneGroup ? `${oneGroup.name}: ` : ""}${sel.length} objects
middle at ${c.map((n) => n.toFixed(2)).join(", ")}${shown < sel.length ? `
${sel.length - shown} not in the world` : ""}`;
    return;
  }
  const o = sel[0];
  if (o) {
    const values = {
      px: o.transform.position[0].toFixed(2),
      py: o.transform.position[1].toFixed(2),
      pz: o.transform.position[2].toFixed(2),
      yaw: qYaw(o.transform.rotation).toFixed(1),
      scale: o.transform.scale[0].toFixed(2)
    };
    for (const f of fields) if (focused !== f) field(f).value = values[f];
    field("scale").hidden = o.kind !== "mesh";
  }
  if (!o) {
    $("selected").textContent = "Nothing selected";
    return;
  }
  const [x, y, z] = o.transform.position;
  $("selected").textContent = `${oneGroup ? `${oneGroup.name}: ` : ""}${o.id}
${o.resource ?? o.record ?? o.kind}
${o.appearance ? `appearance ${o.appearance}
` : ""}at ${x.toFixed(2)}, ${y.toFixed(2)}, ${z.toFixed(2)}${o.entityId ? `
entity ${o.entityId}` : "\nnot in the world"}`;
}
var searchTimer;
function search() {
  $("search").classList.toggle("empty", !($("search").value ?? ""));
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
    if (explorerOpen || filesOpen) {
      e.preventDefault();
      e.stopImmediatePropagation();
      const box2 = $(filesOpen ? "fileFilter" : "exFilter");
      box2.focus();
      box2.value = (box2.value ?? "") + e.key;
      box2.dispatchEvent(new Event("input"));
      return;
    }
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
  kind = ["all", "mesh", "entity", "npc"][e.detail.index] ?? "all";
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
  if (previewPick) previewResult(lookedAt);
  if (state) render(state);
});
$("appearances").addEventListener("select", (e) => {
  appearance = e.detail.value;
});
$("drop").addEventListener("click", () => {
  if (lookedAt) {
    dropAsked = true;
    post({ type: "drop", path: lookedAt, appearance });
  }
});
$("dropClick").addEventListener("click", () => {
  if (lookedAt) startDropAtClick(lookedAt, appearance);
});
function startDropAtClick(path, looks, label, like) {
  const edit = $("edit");
  if (!edit.checked) {
    edit.checked = true;
    viewport.setEdit(true);
  }
  const name = label ?? labelFor(path);
  viewport.armDrop(
    (ray) => {
      dropAsked = true;
      post({ type: "drop", path, appearance: looks, at: { origin: ray.o, dir: ray.d }, like });
    },
    { name, bounds: () => state?.looked?.path === path ? state.looked.info?.bounds : void 0, edges: () => edgesFor(path), scale: like?.scale }
  );
  edgesFor(path);
  $("message").textContent = `Drop at click is on: click in the world where ${name} should go. Esc or a tap of the right button cancels; hold it to look around.`;
  $("message").className = "message";
}
for (const panel of document.querySelectorAll(".pinnable")) {
  const pin = panel.querySelector(".pin");
  if (!pin) continue;
  const key = `edgebuilder.pinned.${panel.id}`;
  const note = panel.dataset.pinNote ?? "";
  const set = (on2) => {
    panel.classList.toggle("pinned", on2);
    pin.setAttribute("aria-pressed", String(on2));
    pin.title = on2 ? "Pinned to the bottom of the tab: click to let it scroll with the tab" : `Pin to the bottom of the tab, ${note}`;
    try {
      localStorage.setItem(key, on2 ? "1" : "0");
    } catch {
    }
  };
  let on = true;
  try {
    on = localStorage.getItem(key) !== "0";
  } catch {
  }
  set(on);
  pin.addEventListener("click", () => set(!panel.classList.contains("pinned")));
}
var listCtrl = false;
$("objects").addEventListener(
  "click",
  (e) => {
    listCtrl = held(e).ctrl;
    const fold = e.target.closest?.(".fold");
    if (!fold) return;
    e.stopPropagation();
    const g = fold.dataset.group;
    if (closed.has(g)) closed.delete(g);
    else closed.add(g);
    if (state) render(state);
  },
  true
);
$("objects").addEventListener("keydown", () => listCtrl = false, true);
$("objects").addEventListener("select", (e) => {
  if (!state) return;
  const value = e.detail.value;
  const { objects, groups } = state.scene;
  const ids = value.startsWith("g:") ? membersOf(value.slice(2), objects, groups).map((o) => o.id) : [value.slice(2)];
  const all = ids.every((id) => state.selected.includes(id));
  const next = !listCtrl ? ids : all ? state.selected.filter((id) => !ids.includes(id)) : [...state.selected, ...ids];
  post({ type: "select", ids: next });
});
var selection = () => state?.selected ?? [];
$("delete").addEventListener("click", () => selection().length && post({ type: "delete", ids: selection() }));
$("floor").addEventListener("click", () => selection().length && post({ type: "floor", ids: selection() }));
$("undo").addEventListener("click", () => post({ type: "undo" }));
$("stop").addEventListener("click", () => post({ type: "stop" }));
$("redo").addEventListener("click", () => post({ type: "redo" }));
$("group").addEventListener("click", () => selection().length && post({ type: "group", ids: selection() }));
$("ungroup").addEventListener("click", () => selection().length && post({ type: "ungroup", ids: selection() }));
$("duplicate").addEventListener("click", () => duplicate());
$("groupName").addEventListener("submit", () => {
  const g = $("groupName");
  if (g.dataset.group) post({ type: "rename", group: g.dataset.group, name: g.value ?? "" });
});
function duplicate() {
  if (!state || !state.selected.length) return;
  if (viewport.canDrag) {
    copyAsked = true;
    post({ type: "duplicate", ids: state.selected });
  } else {
    const b = boxOf(state.scene.objects.filter((o) => state.selected.includes(o.id)));
    const width = b ? b.max[0] - b.min[0] : 1;
    post({ type: "duplicate", ids: state.selected, offset: [width + 0.5, 0, 0] });
  }
}
function applyFields() {
  const sel = state?.scene.objects.filter((x) => state.selected.includes(x.id)) ?? [];
  if (!sel.length) return;
  const num = (f, fallback) => {
    const n = Number(field(f).value);
    return Number.isFinite(n) ? n : fallback;
  };
  if (sel.length > 1) {
    const c = centreOf(sel.map((o2) => o2.transform));
    const to = [num("px", c[0]), num("py", c[1]), num("pz", c[2])];
    const turn2 = num("yaw", 0);
    const f = sel.every((o2) => o2.kind === "mesh") ? num("scale", 1) || 1 : 1;
    const change = { move: sub(to, c), turn: Math.abs(turn2) > 1e-3 ? qAxisAngle(AXES.z, turn2) : void 0, scale: f !== 1 ? [f, f, f] : void 0 };
    post({ type: "transform", items: sel.map((o2) => ({ id: o2.id, transform: applyChange(o2.transform, change, c) })) });
    return;
  }
  const o = sel[0];
  const t = o.transform;
  const yawNow = qYaw(t.rotation);
  const turn = num("yaw", yawNow) - yawNow;
  const s = o.kind === "mesh" ? num("scale", t.scale[0]) || t.scale[0] : 1;
  const next = {
    position: [num("px", t.position[0]), num("py", t.position[1]), num("pz", t.position[2])],
    rotation: Math.abs(turn) > 1e-3 ? qNorm(qMul(qAxisAngle(AXES.z, turn), t.rotation)) : t.rotation,
    scale: o.kind === "mesh" ? [s, s, s] : t.scale
  };
  post({ type: "transform", items: [{ id: o.id, transform: next }] });
}
$("apply").addEventListener("click", () => {
  applyFields();
  applySeenFrom();
});
$("seenFrom").addEventListener("submit", () => {
  applySeenFrom();
  document.activeElement?.blur();
});
for (const f of fields)
  field(f).addEventListener("submit", () => {
    applyFields();
    document.activeElement?.blur();
  });
var picked;
var closedFolders = /* @__PURE__ */ new Set();
var TabLabels = { scene: 1, library: 2 };
var parentOf = (folder) => folder.includes("/") ? folder.slice(0, folder.lastIndexOf("/")) : "";
var lastPart = (folder) => folder.slice(folder.lastIndexOf("/") + 1);
var sameFile = (a, b) => a.toLowerCase() === b.toLowerCase();
function placeLabel(s, place) {
  return s.library.shelves.find((sh) => sh.place === place)?.label ?? "";
}
function whereLabel(s, place, folder) {
  const label = placeLabel(s, place);
  if (!label) return "";
  return folder ? `${label} > ${folder.replace(/\//g, " > ")}` : label;
}
function findBake(s, dir) {
  return s.library.bakes.find((b) => sameFile(b.dir, dir));
}
function bakeTags(b) {
  const tags = [];
  if (b.error) tags.push('<span class="tag warn">cannot be read</span>');
  if (b.scenes.some((x) => x.stale)) tags.push('<span class="tag warn">stale</span>');
  if (b.scenes.some((x) => x.missing)) tags.push('<span class="tag warn">scene missing</span>');
  if (b.collides.length) tags.push('<span class="tag warn">collides</span>');
  if (b.inGame) tags.push('<span class="tag">in game</span>');
  if (b.inProject !== void 0) tags.push(`<span class="tag${b.inProject < b.version ? " warn" : ""}">in project</span>`);
  return tags.join("");
}
function findScene(s, file) {
  for (const sh of s.library.shelves) for (const sc of sh.scenes) if (sameFile(sc.file, file)) return sc;
  return void 0;
}
function target(s) {
  const p = picked;
  if (p?.kind === "folder" && s.library.shelves.some((sh) => sh.place === p.place)) return { place: p.place, folder: p.folder };
  if (picked?.kind === "scene") {
    const sc = findScene(s, picked.file);
    if (sc) return { place: sc.place, folder: sc.folder };
  }
  if (picked?.kind === "bake") {
    const b = findBake(s, picked.dir);
    if (b) return { place: "library", folder: b.folder };
  }
  return { place: s.library.root ? "library" : "data", folder: "" };
}
var when = (ms) => {
  const d = new Date(ms);
  return `${d.toLocaleDateString(void 0, { day: "numeric", month: "short" })} ${d.toLocaleTimeString(void 0, { hour: "2-digit", minute: "2-digit" })}`;
};
function libraryRows(s) {
  const rows = [];
  const pad = (depth) => ` style="padding-left:${12 + depth * 18}px"`;
  const isOn = (file) => s.library.on.some((f) => sameFile(f, file));
  const isPicked = (v2) => !!picked && JSON.stringify(picked) === JSON.stringify(v2);
  for (const sh of s.library.shelves) {
    const walk = (folder, depth) => {
      for (const f of sh.folders.filter((x) => parentOf(x) === folder)) {
        const key2 = `${sh.place}|${f}`;
        rows.push(
          `<rn-item value="d:${esc(key2)}"${isPicked({ kind: "folder", place: sh.place, folder: f }) ? " selected" : ""}${pad(depth)}><span class="fold" data-folder="${esc(key2)}">${closedFolders.has(key2) ? "\u25B8" : "\u25BE"}</span>${esc(lastPart(f))}</rn-item>`
        );
        if (!closedFolders.has(key2)) walk(f, depth + 1);
      }
      for (const sc of sh.scenes.filter((x) => x.folder === folder)) {
        const open = sameFile(sc.file, s.scene.file ?? "");
        const tags = `${open ? '<span class="tag">open</span>' : ""}${isOn(sc.file) ? '<span class="tag">shown</span>' : ""}`;
        const end = sc.error ? "cannot be read" : `${open ? holds(s.scene.objects.length, editCount(s).removals, true, editCount(s).doors) : holds(sc.objects, sc.removals, true, sc.doors)} \xB7 ${when(sc.changed)}`;
        rows.push(
          `<rn-item value="f:${esc(sc.file)}" title="${esc(sc.error ? `${sc.file}
${sc.error}` : sc.file)}"${isPicked({ kind: "scene", file: sc.file }) ? " selected" : ""}${pad(depth)}><span class="fold"></span>${esc(sc.name)}${tags}<span slot="end">${esc(end)}</span></rn-item>`
        );
      }
      if (sh.place !== "library") return;
      for (const m of s.library.models.filter((x) => x.place === "library" && x.folder === folder)) rows.push(modelRow(m, depth));
      for (const b of s.library.bakes.filter((x) => x.folder === folder)) {
        const end = b.error ? "" : `${b.scenes.length} scene${b.scenes.length === 1 ? "" : "s"} \xB7 v${b.version}`;
        rows.push(
          `<rn-item value="b:${esc(b.dir)}" title="${esc(b.error ? `${b.dir}
${b.error}` : b.dir)}"${isPicked({ kind: "bake", dir: b.dir }) ? " selected" : ""}${pad(depth)}><span class="fold"></span>${esc(b.name)}<span class="tag dim">bake</span>${bakeTags(b)}<span slot="end">${esc(end)}</span></rn-item>`
        );
      }
    };
    const key = `${sh.place}|`;
    rows.push(
      `<rn-item value="d:${esc(key)}" title="${esc(sh.dir)}"${isPicked({ kind: "folder", place: sh.place, folder: "" }) ? " selected" : ""}${pad(0)}><span class="fold" data-folder="${esc(key)}">${closedFolders.has(key) ? "\u25B8" : "\u25BE"}</span><span class="section">${esc(sh.label)}</span><span slot="end">${sh.scenes.length} scene${sh.scenes.length === 1 ? "" : "s"}</span></rn-item>`
    );
    if (!closedFolders.has(key)) walk("", 1);
  }
  for (const mp of s.library.modelPlaces.filter((x) => x.place !== "library")) {
    const models2 = s.library.models.filter((x) => x.place === mp.place);
    const key = `model:${mp.place}|`;
    rows.push(
      `<rn-item value="x:${esc(key)}" title="${esc(mp.dir)}"${pad(0)}><span class="fold" data-folder="${esc(key)}">${closedFolders.has(key) ? "\u25B8" : "\u25BE"}</span><span class="section">${esc(mp.label)}</span><span slot="end">${models2.length} model${models2.length === 1 ? "" : "s"}</span></rn-item>`
    );
    if (!closedFolders.has(key)) for (const m of models2) rows.push(modelRow(m, 1, true));
  }
  return rows.join("");
  function modelRow(m, depth, withFolder = false) {
    const end = m.kind === "prop" ? "prepared" : m.bytes ? `${(m.bytes / 1e6).toFixed(1)} MB` : "";
    const label = withFolder && m.folder ? `${m.folder.replace(/\//g, " > ")} > ${m.name}` : m.name;
    return `<rn-item value="m:${esc(m.file)}" title="${esc(m.file)}"${isPicked({ kind: "model", file: m.file }) ? " selected" : ""}${pad(depth)}><span class="fold"></span>${esc(label)}<span class="tag dim">${m.kind === "prop" ? "prop" : "glb"}</span><span slot="end">${esc(end)}</span></rn-item>`;
  }
}
function findModel(s, file) {
  return s.library.models.find((m) => sameFile(m.file, file));
}
function renderModel(s, file) {
  $("importBox").hidden = !file;
  if (!file) return;
  const m = findModel(s, file);
  const where = m ? m.place === "library" ? whereLabel(s, "library", m.folder) : s.library.modelPlaces.find((x) => x.place === m.place)?.label ?? "" : "typed in";
  const what = (m?.kind ?? (file.toLowerCase().endsWith(".glb") ? "glb" : "prop")) === "prop" ? "A prop on EDGEfab's Desk or in the Library, already prepared" : "A GLB: Import prepares it (size, facing, levels of detail, textures) with EDGEfab's core";
  const into = s.bake.project ? `Import puts it into ${s.bake.project.name}, packs the project and swaps it into the game.` : "Open a REDcode project to import into (Refresh on the Bake tab asks again).";
  $("pickedText").textContent = `${m?.name ?? file.slice(file.search(/[^\\/]*$/))}
${where}${m?.bytes ? `, ${(m.bytes / 1e6).toFixed(1)} MB` : ""}
${what}.
${into}
${file}`;
  const name = $("importName");
  name.setAttribute("placeholder", propSlugOf(m?.name ?? file));
  $("importGo").toggleAttribute("disabled", !s.bake.project || !!s.busy);
}
function propSlugOf(name) {
  const base = name.replace(/^.*[\\/]/, "").toLowerCase().replace(/\.(glb|prop\.asset)$/, "");
  return base.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 48) || "prop";
}
var bakeHtml = "";
function bakeHolds(r, short = false) {
  const text = holds(r.objects ?? 0, r.removals ?? 0, short);
  return r.standIns && !short ? `${text} (and ${r.standIns === 1 ? "its stand-in" : `their ${r.standIns} stand-ins`})` : text;
}
var bakeConfirm;
function renderBake(s) {
  const b = s.bake;
  const n = s.scene.objects.length;
  $("bakeWhat").textContent = s.scene.file ? `${s.scene.name}: ${holds(n, editCount(s).removals, false, editCount(s).doors)}` : "No scene open";
  $("bakeInto").textContent = b.project ? `Into the REDcode project ${b.project.name}` : "";
  renderProjects("bakeProjects", s);
  renderProjects("importProjects", s);
  $("bakeInto").title = b.project?.dir ?? "";
  $("bakeListPanel").setAttribute("title", b.project ? `Bakes for ${b.project.name}` : "Bakes in this project");
  const checks = b.checks.map((c) => `<div class="check ${c.tone}">${esc(c.text)}</div>`).join("");
  if ($("bakeChecks").innerHTML !== checks) $("bakeChecks").innerHTML = checks;
  const when2 = (iso) => iso ? new Date(iso).toLocaleString() : "";
  const lines = [];
  if (b.current) lines.push(`Baked ${when2(b.current.date)}${b.current.objects === void 0 ? "" : `, ${bakeHolds(b.current)}`}.${b.stale ? " The scene changed since: bake again to bring it in." : ""}`);
  if (b.current?.library) lines.push(`This bake came from the Library's ${b.current.library.name} (version ${b.current.library.version}). Bake here makes it the project's own; to keep it the Library's, bake it on the Library tab and update it here.`);
  if (b.inGame) lines.push(`Its bake is in the game (${b.inGame}), so its previews stay off and nothing stands twice. Rebuild previews on the Scene tab brings them back to edit it.`);
  $("bakeState").textContent = lines.join("\n");
  $("bakeGo").toggleAttribute("disabled", b.checks.some((c) => c.tone === "error"));
  const last = b.last;
  $("bakeDone").toggleAttribute("hidden", !last);
  if (last) $("bakeFiles").textContent = [...last.files, ...last.warnings].join("\n");
  const html = b.list.map((r) => {
    const end = bakeConfirm === r.slug ? `<span slot="end" class="confirm">Take it out?<button data-act="yes" data-id="${esc(r.slug)}">Yes</button><button data-act="no">No</button></span>` : `<span slot="end">${r.library?.latest && r.library.dir ? `<button class="update" data-act="update" data-id="${esc(r.library.dir)}" title="The Library's ${esc(r.library.name)} is at version ${r.library.latest}; this project has version ${r.library.version}. Copies the new version in">Update to v${r.library.latest}</button>` : ""}<span class="grouptag">${r.library ? `from ${esc(r.library.name)} v${r.library.version} \xB7 ` : ""}${r.objects === void 0 ? "" : bakeHolds(r, true)}</span><button class="act" data-act="trash" data-id="${esc(r.slug)}" title="Take this bake out of the project. Its scene stays">${TrashIcon}</button></span>`;
    return `<rn-item value="${esc(r.slug)}" title="${esc([r.file, when2(r.date)].filter(Boolean).join("\n"))}">${esc(r.name)}${end}</rn-item>`;
  }).join("");
  if (html !== bakeHtml) $("bakeList").innerHTML = bakeHtml = html;
}
$("bakeGo").addEventListener("click", () => post({ type: "bake" }));
$("bakeLook").addEventListener("click", () => post({ type: "bake.refresh" }));
$("bakeList").addEventListener(
  "click",
  (e) => {
    const act = e.target.closest?.("[data-act]");
    if (!act) return;
    e.stopPropagation();
    const id = act.dataset.id;
    if (act.dataset.act === "update") {
      if (id) post({ type: "lbake.include", dir: id });
      return;
    }
    if (act.dataset.act === "trash") bakeConfirm = id;
    else {
      bakeConfirm = void 0;
      if (act.dataset.act === "yes" && id) post({ type: "bake.remove", slug: id });
    }
    if (state) render(state);
  },
  true
);
var lbakeAsking = false;
var lbakeDropping;
var lbakeHtml = "";
function bakeText(s, b) {
  if (b.error) return `${b.name}: cannot be read (${b.error})
${b.dir}`;
  const lines = [`${b.name}: a bake in ${whereLabel(s, "library", b.folder)}, version ${b.version}${b.date ? `, baked ${new Date(b.date).toLocaleString()}` : ""}`];
  const stale = b.scenes.filter((x) => x.stale).map((x) => x.name);
  const missing = b.scenes.filter((x) => x.missing).map((x) => x.name);
  if (!b.scenes.length) lines.push("Empty: Add open scene puts the open scene in it.");
  if (stale.length) lines.push(`Changed since the bake: ${stale.join(", ")}. Bake again to bring that in.`);
  if (missing.length) lines.push(`Not where it was baked from: ${missing.join(", ")}. Bake again keeps what was baked.`);
  if (b.collides.length) lines.push(`Shares a scene with ${b.collides.join(", ")}: in one game, the objects would stand twice. Keep one of them in your projects.`);
  if (b.inGame) lines.push("In the game: its scenes' previews stay off, so nothing stands twice.");
  if (b.inProject !== void 0) lines.push(b.inProject < b.version ? `The open project has version ${b.inProject}: Include in project brings it up to date.` : "In the open project.");
  else if (s.bake.project) lines.push(`Not in the open project, ${s.bake.project.name}.`);
  else lines.push("No REDcode project is open to include it in.");
  return lines.join("\n");
}
function renderLibraryBake(s, b) {
  $("lbakeRow").hidden = !b;
  $("lbakeScenes").hidden = !b || !b.scenes.length;
  $("lbakeAsk").hidden = !b || !lbakeAsking;
  if (!b) {
    lbakeAsking = false;
    lbakeDropping = void 0;
    return;
  }
  const inIt = !!s.scene.file && b.scenes.some((x) => sameFile(x.file, s.scene.file));
  $("lbakeAdd").textContent = inIt ? "Bake open scene again" : "Add open scene";
  $("lbakeAdd").toggleAttribute("disabled", !s.scene.file || !!b.error);
  $("lbakeRebake").toggleAttribute("disabled", !b.scenes.length || !!b.error);
  $("lbakeInclude").toggleAttribute("disabled", !s.bake.project || !b.scenes.length || !!b.error);
  $("lbakeInclude").textContent = b.inProject !== void 0 && b.inProject < b.version ? `Update in project to v${b.version}` : "Include in project";
  const html = b.scenes.map((x) => {
    const flags = `${x.stale ? '<span class="tag warn">changed</span>' : ""}${x.missing ? '<span class="tag warn">missing</span>' : ""}`;
    const end = lbakeDropping === x.slug ? `<span slot="end" class="confirm">Take it out of the bake?<button data-act="yes" data-id="${esc(x.slug)}">Yes</button><button data-act="no">No</button></span>` : `<span slot="end"><button class="act" data-act="trash" data-id="${esc(x.slug)}" title="Take this scene out of the bake. The scene stays">${TrashIcon}</button></span>`;
    return `<rn-item value="${esc(x.slug)}" title="${esc(x.file)}">${esc(x.name)}${flags}${end}</rn-item>`;
  }).join("");
  if (html !== lbakeHtml) $("lbakeScenes").innerHTML = lbakeHtml = html;
}
var renameTo;
function renderLibrary(s) {
  const name = $("sceneName");
  if (renameTo && renameTo.file !== s.scene.file) renameTo = void 0;
  if (document.activeElement?.id !== "sceneName" && !renameTo) name.value = s.scene.name;
  $("renameAsk").hidden = !renameTo;
  if (renameTo) {
    const baked = s.bake.current || s.bake.inGame ? " Its bake keeps the old name: bake again and take the old bake out, or both stand in the world." : "";
    $("renameText").textContent = `Rename ${s.scene.name} to ${renameTo.name}? Its file is renamed too.${baked}`;
  }
  const where = whereLabel(s, s.scene.place, s.scene.folder);
  const noScene = !s.scene.file;
  $("sceneWhere").textContent = noScene ? "No scene is open. Open one or make one on the Library tab." : where ? `In ${where}. Saved after every change.` : `In ${s.scene.file}. Saved after every change.`;
  for (const id of ["sceneName", "saveScene", "saveAsScene", "closeScene", "saveAsHere"]) $(id).toggleAttribute("disabled", noScene);
  $("sceneWhere").title = s.scene.file ?? "";
  const root = s.library.root;
  $("libraryInfo").textContent = root ? `Library: ${root}` : `No Library folder yet. Make one at ${s.library.suggested}, or pick another folder in Settings. Scenes can stay in the REDcode project or on This PC meanwhile.`;
  $("libraryMakeRow").hidden = !!root;
  $("libraryMake").title = s.library.suggested;
  if (picked?.kind === "scene" && !findScene(s, picked.file)) picked = void 0;
  if (picked?.kind === "bake" && !findBake(s, picked.dir)) picked = void 0;
  if (picked?.kind === "model" && !findModel(s, picked.file) && !typedModel) picked = void 0;
  $("shelves").innerHTML = libraryRows(s);
  const sc = picked?.kind === "scene" ? findScene(s, picked.file) : void 0;
  const lb = picked?.kind === "bake" ? findBake(s, picked.dir) : void 0;
  const open = !!sc && sameFile(sc.file, s.scene.file ?? "");
  const on = !!sc && s.library.on.some((f) => sameFile(f, sc.file));
  if (sc)
    $("pickedText").textContent = `${sc.name}${open ? " (open)" : on ? " (shown in the world)" : ""}
${whereLabel(s, sc.place, sc.folder)}
${sc.error ? `Cannot be read: ${sc.error}` : `${open ? holds(s.scene.objects.length, editCount(s).removals, false, editCount(s).doors) : holds(sc.objects, sc.removals, false, sc.doors)}, changed ${when(sc.changed)}`}
${sc.file}`;
  else if (picked?.kind === "folder") $("pickedText").textContent = `Folder: ${whereLabel(s, picked.place, picked.folder)}`;
  else if (lb) $("pickedText").textContent = bakeText(s, lb);
  else if (picked?.kind === "model") ;
  else $("pickedText").textContent = "Pick a scene to open or show it, or a folder for a new scene. A double-click opens a scene.";
  $("pickedOpen").toggleAttribute("disabled", !sc || open || !!sc.error);
  $("pickedClose").toggleAttribute("disabled", !open);
  $("pickedOn").toggleAttribute("disabled", !sc || open || !!sc.error);
  $("pickedOn").textContent = on ? "Hide from world" : "Show in world";
  for (const id of ["pickedOpen", "pickedClose", "pickedOn"]) $(id).hidden = !!lb || picked?.kind === "model";
  renderModel(s, picked?.kind === "model" ? picked.file : void 0);
  $("pickedBake").hidden = !sc || !root;
  $("pickedBake").toggleAttribute("disabled", !sc || !!sc.error || !sc.objects && !open);
  renderLibraryBake(s, lb);
  const t = target(s);
  $("newWhere").textContent = `In ${whereLabel(s, t.place, t.folder)}`;
  $("createScene").hidden = saveAsAsked;
  $("createFolder").hidden = saveAsAsked;
  $("createFolder").toggleAttribute("disabled", t.place !== "library");
  $("createFolder").title = t.place === "library" ? "A folder inside this one" : "Folders are made in the Library";
  const rootField = $("libraryRoot");
  if (document.activeElement?.id !== "libraryRoot") rootField.value = root ?? "";
  rootField.setAttribute("placeholder", s.library.suggested);
}
var mainTabs = () => document.getElementById("mainTabs");
var newName = () => $("newName");
function toLibrary(name, asCopy = false) {
  saveAsAsked = asCopy;
  mainTabs().select?.(TabLabels.library);
  const f = newName();
  f.value = name;
  f.focus();
  if (state) render(state);
}
var saveAsAsked = false;
function leaveSaveAs() {
  if (!saveAsAsked) return;
  saveAsAsked = false;
  newName().value = "";
}
$("mainTabs").addEventListener("change", (e) => {
  if (e.target !== $("mainTabs")) return;
  const label = e.detail.label;
  if (label === "Library") {
    post({ type: "library.refresh" });
    if (libraryOut && !drawerOpen && !previewsOpen && !state?.sectors.open) openLeft("library");
  } else leaveSaveAs();
  if (label === "Bake") post({ type: "bake.refresh" });
  if (label === "World") post({ type: "world.refresh" });
});
$("shelves").addEventListener(
  "click",
  (e) => {
    const fold = e.target.closest?.(".fold");
    const key = fold?.dataset.folder;
    if (!key) return;
    e.stopPropagation();
    if (closedFolders.has(key)) closedFolders.delete(key);
    else closedFolders.add(key);
    if (state) render(state);
  },
  true
);
$("shelves").addEventListener("select", (e) => {
  const value = e.detail.value;
  lbakeAsking = false;
  if (libraryOut) mainTabs().select?.(TabLabels.library);
  if (value.startsWith("f:")) picked = { kind: "scene", file: value.slice(2) };
  else if (value.startsWith("b:")) picked = { kind: "bake", dir: value.slice(2) };
  else if (value.startsWith("m:")) {
    typedModel = false;
    picked = { kind: "model", file: value.slice(2) };
  } else if (value.startsWith("x:")) return;
  else {
    const key = value.slice(2);
    const bar = key.indexOf("|");
    picked = { kind: "folder", place: key.slice(0, bar), folder: key.slice(bar + 1) };
  }
  if (state) render(state);
});
var lastRow = { value: "", at: 0 };
$("shelves").addEventListener(
  "click",
  (e) => {
    const value = e.target.closest?.("rn-item")?.getAttribute("value") ?? "";
    const twice = value.startsWith("f:") && value === lastRow.value && performance.now() - lastRow.at < 500;
    lastRow = twice ? { value: "", at: 0 } : { value, at: performance.now() };
    if (twice && state && !sameFile(value.slice(2), state.scene.file ?? "")) post({ type: "scene.open", file: value.slice(2) });
  },
  true
);
$("pickedClose").addEventListener("click", () => post({ type: "scene.close" }));
$("closeScene").addEventListener("click", () => post({ type: "scene.close" }));
$("pickedOpen").addEventListener("click", () => picked?.kind === "scene" && post({ type: "scene.open", file: picked.file }));
var lastShow = 0;
$("pickedOn").addEventListener("click", () => {
  if (picked?.kind !== "scene" || !state || performance.now() - lastShow < 600) return;
  lastShow = performance.now();
  const file = picked.file;
  post({ type: "scene.on", file, on: !state.library.on.some((f) => sameFile(f, file)) });
});
$("libraryRefresh").addEventListener("click", () => post({ type: "library.refresh" }));
$("pickedBake").addEventListener("click", () => {
  if (!state || picked?.kind !== "scene") return;
  const sc = findScene(state, picked.file);
  if (!sc) return;
  post({ type: "lbake.new", file: sc.file, name: newName().value?.trim() || sc.name, folder: sc.folder });
  newName().value = "";
});
var typedModel = false;
var Collisions = ["physical", "box", "none"];
var collision = "physical";
$("importCollision").addEventListener("change", (e) => {
  collision = Collisions[e.detail.index] ?? "physical";
});
function pickTyped() {
  const file = ($("importPath").value ?? "").trim().replace(/^"(.*)"$/, "$1");
  if (!file) return;
  typedModel = true;
  picked = { kind: "model", file };
  if (state) render(state);
}
$("importPathGo").addEventListener("click", pickTyped);
$("importPath").addEventListener("submit", pickTyped);
$("importGo").addEventListener("click", () => {
  if (picked?.kind !== "model") return;
  const height = Number(($("importHeight").value ?? "").replace(",", "."));
  post({ type: "import", file: picked.file, name: ($("importName").value ?? "").trim() || void 0, height: height > 0 ? height : void 0, collision });
});
$("lbakeInclude").addEventListener("click", () => picked?.kind === "bake" && post({ type: "lbake.include", dir: picked.dir }));
$("lbakeAdd").addEventListener("click", () => picked?.kind === "bake" && state?.scene.file && post({ type: "lbake.add", dir: picked.dir, file: state.scene.file }));
$("lbakeRebake").addEventListener("click", () => picked?.kind === "bake" && post({ type: "lbake.rebake", dir: picked.dir }));
$("lbakeDelete").addEventListener("click", () => {
  lbakeAsking = true;
  if (state) render(state);
});
$("lbakeNo").addEventListener("click", () => {
  lbakeAsking = false;
  if (state) render(state);
});
$("lbakeYes").addEventListener("click", () => {
  lbakeAsking = false;
  if (picked?.kind === "bake") post({ type: "lbake.delete", dir: picked.dir });
  if (state) render(state);
});
$("lbakeScenes").addEventListener(
  "click",
  (e) => {
    const act = e.target.closest?.("[data-act]");
    if (!act) return;
    e.stopPropagation();
    const slug = act.dataset.id;
    if (act.dataset.act === "trash") lbakeDropping = slug;
    else {
      lbakeDropping = void 0;
      if (act.dataset.act === "yes" && slug && picked?.kind === "bake") post({ type: "lbake.drop", dir: picked.dir, slug });
    }
    if (state) render(state);
  },
  true
);
$("libraryMake").addEventListener("click", () => state && post({ type: "library.root", root: state.library.suggested }));
$("setLibrary").addEventListener("click", () => {
  if (!state) return;
  post({ type: "library.root", root: $("libraryRoot").value?.trim() || state.library.suggested });
});
$("createScene").addEventListener("click", () => {
  if (!state) return;
  const name = newName().value?.trim();
  if (!name) return status("Type a name for the new scene first.");
  post({ type: "scene.new", name, ...target(state) });
  newName().value = "";
});
$("saveAsHere").addEventListener("click", () => {
  if (!state) return;
  const name = newName().value?.trim();
  if (!name) return status("Type a name for the copy first.");
  post({ type: "scene.saveAs", name, ...target(state) });
  newName().value = "";
  saveAsAsked = false;
});
$("createFolder").addEventListener("click", () => {
  if (!state) return;
  const name = newName().value?.trim();
  const t = target(state);
  if (!name) return status("Type a name for the new folder first.");
  if (t.place !== "library") return status("Folders are made in the Library: pick the Library or a folder in it.");
  post({ type: "library.folder", folder: t.folder, name });
  newName().value = "";
});
$("sceneName").addEventListener("submit", () => {
  if (!state?.scene.file) return;
  const name = ($("sceneName").value ?? "").trim();
  renameTo = name && name !== state.scene.name ? { file: state.scene.file, name } : void 0;
  document.activeElement?.blur();
  render(state);
});
$("sceneName").addEventListener("input", () => {
  if (!renameTo) return;
  renameTo = void 0;
  if (state) render(state);
});
$("renameYes").addEventListener("click", () => {
  if (!renameTo) return;
  post({ type: "scene.rename", name: renameTo.name });
  renameTo = void 0;
  if (state) render(state);
});
$("renameNo").addEventListener("click", () => {
  renameTo = void 0;
  if (state) render(state);
});
$("saveScene").addEventListener("click", () => post({ type: "scene.save" }));
$("saveAsScene").addEventListener("click", () => state && toLibrary(`${state.scene.name} copy`, true));
$("newScene").addEventListener("click", () => {
  leaveSaveAs();
  toLibrary("");
});
$("openScene").addEventListener("click", () => mainTabs().select?.(TabLabels.library));
var drawerOpen = false;
var peekAsked = "";
var confirming;
var lastDrawerRow = { id: "", at: 0 };
var pendingGo;
var drawerHtml = "";
var TrashIcon = `<svg viewBox="0 0 16 16"><path d="M2.5 4h11M6 4V2.5h4V4M4 4l.8 9.5h6.4L12 4M6.7 6.5v4.5M9.3 6.5v4.5"/></svg>`;
function drawerFile(s) {
  const sc = picked?.kind === "scene" ? findScene(s, picked.file) : void 0;
  return sc && !sc.error ? sc.file : s.scene.file ?? "";
}
function renderDrawer(s) {
  if (pendingGo && sameFile(pendingGo.file, s.scene.file ?? "")) {
    const id = pendingGo.id;
    pendingGo = void 0;
    goToObject(s, id);
  }
  $("drawer").classList.toggle("open", drawerOpen);
  if (!drawerOpen) return;
  const file = drawerFile(s);
  const isOpen = sameFile(file, s.scene.file ?? "");
  const peeked = s.library.peek && sameFile(s.library.peek.file, file) ? s.library.peek : void 0;
  if (isOpen) peekAsked = "";
  else if (peekAsked !== file) {
    peekAsked = file;
    post({ type: "scene.peek", file });
  }
  const shown = isOpen ? s.scene : peeked;
  $("drawerTitle").textContent = shown ? `Objects: ${shown.name}` : "Objects";
  $("drawerTitle").title = file;
  if (!shown) {
    $("drawerInfo").textContent = "Reading the scene...";
    $("drawerList").innerHTML = drawerHtml = "";
    return;
  }
  const n = shown.objects.length;
  $("drawerInfo").textContent = `${n} object${n === 1 ? "" : "s"}. ${isOpen ? "Two clicks fly the camera to an object and select it." : "Not the open scene: two clicks open it and fly there. A delete here has no Undo."}`;
  const groupName = (id) => shown.groups.find((g) => g.id === id)?.name;
  const html = shown.objects.map((o) => {
    const end = confirming === o.id ? `<span slot="end" class="confirm">${isOpen ? "Delete?" : "Delete for good?"}<button data-act="yes" data-id="${esc(o.id)}">Yes</button><button data-act="no">No</button></span>` : `<span slot="end">${o.group ? `<span class="grouptag">${esc(groupName(o.group) ?? "")}</span>` : ""}${o.resource || o.record ? `<button class="icon" data-act="eye" data-id="${esc(o.id)}" aria-pressed="${objectPreview && objectLike?.id === o.id}" title="Its preview beside this drawer, with Drop a copy">${EyeIcon}</button>` : ""}<button class="act" data-act="trash" data-id="${esc(o.id)}" title="Delete">${TrashIcon}</button></span>`;
    const [x, y, z] = o.transform.position.map((v2) => v2.toFixed(1));
    return `<rn-item value="${esc(o.id)}" title="${esc(`${o.resource}
${x}, ${y}, ${z}`)}"${isOpen && s.selected.includes(o.id) ? " selected" : ""}>${esc(o.id)}${end}</rn-item>`;
  }).join("");
  if (html !== drawerHtml) $("drawerList").innerHTML = drawerHtml = html;
}
function goToObject(s, id) {
  const o = s.scene.objects.find((x) => x.id === id);
  if (!o) return;
  if (s.world === "ready") {
    const edit = $("edit");
    if (!edit.checked) {
      edit.checked = true;
      viewport.setEdit(true);
    }
    if (s.settings.editorCamera !== false) viewport.flyTo(o);
  }
  post({ type: "scene.goTo", id });
}
$("pickedObjects").addEventListener("click", () => {
  openLeft(drawerOpen ? "none" : "objects");
  peekAsked = "";
  confirming = void 0;
  if (state) render(state);
});
$("drawerClose").addEventListener("click", () => {
  drawerOpen = false;
  if (state) render(state);
});
$("drawerList").addEventListener(
  "click",
  (e) => {
    if (!state) return;
    const file = drawerFile(state);
    const isOpen = sameFile(file, state.scene.file ?? "");
    const target2 = e.target;
    const act = target2.closest?.("[data-act]");
    if (act) {
      e.stopPropagation();
      const id2 = act.dataset.id;
      lastDrawerRow = { id: "", at: 0 };
      if (act.dataset.act === "eye") {
        const shown = isOpen ? state.scene : state.library.peek;
        const o = shown?.objects.find((x) => x.id === id2);
        if (objectPreview && objectLike?.id === id2) objectPreview = false;
        else if (o) previewObject(o);
        render(state);
        return;
      }
      if (act.dataset.act === "trash") confirming = id2;
      else {
        confirming = void 0;
        if (act.dataset.act === "yes" && id2) post(isOpen ? { type: "delete", ids: [id2] } : { type: "scene.removeFrom", file, id: id2 });
      }
      render(state);
      return;
    }
    const id = target2.closest?.("rn-item")?.getAttribute("value");
    if (!id) return;
    const twice = id === lastDrawerRow.id && performance.now() - lastDrawerRow.at < 500;
    lastDrawerRow = twice ? { id: "", at: 0 } : { id, at: performance.now() };
    if (!twice) {
      if (isOpen) post({ type: "select", ids: [id] });
    } else if (isOpen) goToObject(state, id);
    else {
      pendingGo = { file, id };
      post({ type: "scene.open", file });
    }
  },
  true
);
var KindToggles = [
  ["kindDoor", "door"],
  ["kindFakeDoor", "fakeDoor"],
  ["kindMesh", "mesh"]
];
var worldClickAt = 0;
var lastPickedKey;
var worldHtml = "";
var editsHtml = "";
var hoverKey = null;
var WorldTab = 3;
var DoorButtons = ["doorOpen", "doorClose", "doorLock", "doorRestore"];
function doorText(d) {
  if (!d) return "";
  return [d.open === void 0 ? "" : d.open ? "open" : "closed", d.locked ? "locked" : "", d.sealed ? "sealed" : "", d.lift ? "an elevator's door" : ""].filter(Boolean).join(", ");
}
function renderWorld(s) {
  const wo = s.worldObjects;
  if (pickWaitFrom !== void 0 && ((wo.picks ?? 0) > pickWaitFrom || performance.now() - worldClickAt > 15e3)) {
    pickWaitFrom = void 0;
    viewport.setWorking(void 0);
  }
  viewport.setWorldTip(worldTip && wo.picked ? tipFor(wo.picked) : void 0);
  for (const [id, k] of KindToggles) $(id).checked = wo.kinds.includes(k);
  const n = wo.things.length;
  const what = s.world !== "ready" ? "Load a save: the doors near V are listed here." : wo.status === "looking" ? "Looking for the doors near V..." : !wo.kinds.length ? "Switch a kind on to pick the game's own objects." : `${n} near V, within 30 m${n ? ", nearest first" : ""}. With Edit on, a click on one in the world picks it.`;
  $("worldInfo").textContent = [wo.note ?? "", what].filter(Boolean).join("\n");
  const picked2 = wo.picked;
  const rows = wo.things.map((t) => {
    const end = [t.removedBy ? '<span class="tag warn">removed</span>' : "", t.stateBy ? '<span class="tag">kept</span>' : "", esc(doorText(t.door)), t.distance !== void 0 ? `${t.distance.toFixed(1)} m` : ""].filter(Boolean).join(" ");
    return `<rn-item value="${esc(t.key)}" title="${esc([t.resource, t.appearance].filter(Boolean).join("\n"))}"${picked2?.key === t.key ? " selected" : ""}>${esc(t.label)}<span slot="end">${end}</span></rn-item>`;
  }).join("");
  if (rows !== worldHtml) $("worldList").innerHTML = worldHtml = rows;
  if (picked2?.key !== lastPickedKey) {
    lastPickedKey = picked2?.key;
    if (picked2 && performance.now() - worldClickAt < 5e3) {
      mainTabs().select?.(WorldTab);
      showWorldPreview();
    }
  }
  if (!picked2) {
    previewWorld = false;
    $("worldPicked").textContent = "Nothing picked. With Edit on, click a door, or pick one in the list.";
    $("worldWarnings").hidden = true;
    $("worldRemove").setAttribute("disabled", "");
    $("worldRemove").hidden = false;
    $("worldRestore").hidden = true;
    for (const id of DoorButtons) $(id).hidden = true;
    $("worldGo").setAttribute("disabled", "");
    return;
  }
  const node = picked2.node;
  const d = picked2.door;
  const kept = picked2.stateBy ? s.scene.worldEdits.find((e) => e.id === picked2.stateBy) : void 0;
  const where = node ? `${node.type}, entry ${node.entry} (node ${node.node}) in ${node.sector ? shortName(node.sector) : node.sectorHash}` : "";
  $("worldPicked").textContent = [
    picked2.label,
    picked2.resource ?? "",
    picked2.appearance ? `appearance ${picked2.appearance}` : "",
    d ? [doorText(d), d.initial ? `starts ${d.initial.toLowerCase()}` : "", d.closesItself ? "closes by itself" : ""].filter(Boolean).join("; ") : "",
    `at ${picked2.position.map((v2) => v2.toFixed(2)).join(", ")}`,
    where || picked2.note || "",
    picked2.ref ? `reference ${picked2.ref}` : "",
    picked2.proxies?.length ? `and its proxy mesh: ${picked2.proxies.map((p) => `entry ${p.entry} in ${p.sector ? shortName(p.sector) : p.sectorHash}`).join(", ")}` : "",
    picked2.removedBy ? `Removed by this scene (${picked2.removedBy}).` : "",
    kept ? `Kept ${doorStateText(kept.door)} by this scene (${kept.id}).` : ""
  ].filter(Boolean).join("\n");
  $("worldWarnings").textContent = picked2.warnings.join("\n");
  $("worldWarnings").hidden = !picked2.warnings.length;
  const removed = !!picked2.removedBy;
  $("worldRemove").hidden = removed;
  $("worldRemove").toggleAttribute("disabled", removed || !s.scene.file || wo.status === "unavailable" || !node && !!picked2.note && !picked2.note.startsWith("Looking"));
  $("worldRemove").title = !s.scene.file ? "Open a scene first: a removal is kept in the open scene" : "Delete. Hidden now, kept in the scene; Restore or Undo brings it back";
  $("worldRestore").hidden = !removed;
  const canSet = picked2.what === "door" && !!d && (d.open !== void 0 || d.locked !== void 0) && !removed;
  const off = !s.scene.file || s.world !== "ready" || !node && !!picked2.note && !picked2.note.startsWith("Looking");
  const want = kept?.door ?? {};
  for (const id of DoorButtons) $(id).hidden = !canSet;
  $("doorOpen").toggleAttribute("disabled", off || want.open === true && d?.open === true);
  $("doorClose").toggleAttribute("disabled", off || want.open === false && d?.open === false);
  const locked = want.locked ?? d?.locked ?? false;
  $("doorLock").textContent = locked ? "Unlock" : "Lock";
  $("doorLock").title = locked ? "Unlock the door, and keep it unlocked while this scene is open" : "Lock the door, and keep it locked while this scene is open";
  $("doorLock").toggleAttribute("disabled", off || d?.locked === void 0);
  $("doorRestore").hidden = !canSet || !kept;
  for (const id of ["doorOpen", "doorClose", "doorLock"]) if (!s.scene.file) $(id).title = "Open a scene first: a door's state is kept in the open scene";
  $("worldGo").toggleAttribute("disabled", s.world !== "ready");
}
function renderEdits(s) {
  const edits = s.scene.worldEdits;
  $("editsTitle").hidden = $("worldEdits").hidden = !edits.length;
  const c = editCount(s);
  $("editsTitle").textContent = `World edits, while this scene is open: ${[c.removals ? `${c.removals} of the game's own objects removed` : "", c.doors ? `${c.doors} door${c.doors === 1 ? "" : "s"} kept as set` : ""].filter(Boolean).join(", ")}`;
  const html = edits.map((e) => {
    const door = e.action === "door";
    const end = door ? `<span class="tag">${esc(doorStateText(e.door))}</span> ` : "";
    const tip = door ? "Take it out of the scene: the door goes back as it was" : "Take it out of the scene: it is back in the world";
    return `<rn-item value="${esc(e.id)}" title="${esc(`${e.node.sector || e.node.sectorHash}, entry ${e.node.entry}${e.ref ? `
${e.ref}` : ""}`)}">${esc(e.label)}<span slot="end">${end}<button data-restore="${esc(e.id)}" title="${tip}">Restore</button></span></rn-item>`;
  }).join("");
  if (html !== editsHtml) $("worldEdits").innerHTML = editsHtml = html;
}
function flyToThing(t) {
  if (!state || state.world !== "ready" || state.settings.editorCamera === false) return;
  const edit = $("edit");
  if (!edit.checked) {
    edit.checked = true;
    viewport.setEdit(true);
  }
  const box = { id: t.key, kind: "entity", transform: { position: t.position, rotation: [0, 0, 0, 1], scale: [1, 1, 1] }, bounds: { min: [-0.8, -0.8, 0], max: [0.8, 0.8, 2.2] } };
  viewport.flyTo(box);
}
for (const [id, k] of KindToggles) {
  $(id).addEventListener("change", (e) => {
    if (!state) return;
    const on = !!e.detail.checked;
    const kinds = new Set(state.worldObjects.kinds);
    if (on) kinds.add(k);
    else kinds.delete(k);
    post({ type: "world.kinds", kinds: KindToggles.map(([, x]) => x).filter((x) => kinds.has(x)) });
  });
}
$("worldRefresh").addEventListener("click", () => post({ type: "world.refresh" }));
$("worldList").addEventListener("select", (e) => {
  const key = e.detail.value;
  const t = state?.worldObjects.things.find((x) => x.key === key);
  if (!t) return;
  post({ type: "world.select", key });
  flyToThing(t);
});
$("worldList").addEventListener("mouseover", (e) => {
  const key = e.target.closest?.("rn-item")?.getAttribute("value") ?? null;
  if (key === hoverKey) return;
  hoverKey = key;
  post({ type: "world.hover", key });
});
$("worldList").addEventListener("mouseleave", () => {
  if (hoverKey === null) return;
  hoverKey = null;
  post({ type: "world.hover", key: null });
});
$("worldRemove").addEventListener("click", () => post({ type: "world.remove" }));
$("doorOpen").addEventListener("click", () => post({ type: "world.door", act: "open" }));
$("doorClose").addEventListener("click", () => post({ type: "world.door", act: "close" }));
$("doorLock").addEventListener("click", () => post({ type: "world.door", act: $("doorLock").textContent === "Unlock" ? "unlock" : "lock" }));
$("doorRestore").addEventListener("click", () => {
  const id = state?.worldObjects.picked?.stateBy;
  if (id) post({ type: "world.restore", id });
});
$("worldRestore").addEventListener("click", () => {
  const id = state?.worldObjects.picked?.removedBy;
  if (id) post({ type: "world.restore", id });
});
$("worldGo").addEventListener("click", () => {
  const p = state?.worldObjects.picked;
  if (p) flyToThing(p);
});
$("worldEdits").addEventListener(
  "click",
  (e) => {
    const id = e.target.closest?.("[data-restore]")?.dataset.restore;
    if (!id) return;
    e.stopPropagation();
    post({ type: "world.restore", id });
  },
  true
);
var SectorToggles = [
  ["secExterior", "exterior"],
  ["secInterior", "interior"],
  ["secQuest", "quest"],
  ["secOther", "other"]
];
var SectorLevels = [null, 0, 1, 2, 3];
var sectorsHtml = "";
var sectorRowsHtml = "";
var sectorSelShown = "";
var sectorLevel = null;
var sectorKindsShown = false;
var lastSector = "";
var lastSectorRow = { entry: -1, at: 0 };
var lastFly = -1;
var sectorsTyped;
var sectorFiltered;
var EyeIcon = `<svg viewBox="0 0 16 16"><path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8s-2.4 4.5-6.5 4.5S1.5 8 1.5 8z"/><circle cx="8" cy="8" r="2"/></svg>`;
var EyeOffIcon = `<svg viewBox="0 0 16 16"><path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8s-2.4 4.5-6.5 4.5S1.5 8 1.5 8zM2.5 13.5l11-11"/></svg>`;
function sectorKinds() {
  return SectorToggles.filter(([id]) => $(id).checked).map(([, k]) => k);
}
function findSectors(around) {
  const text = ($("sectorsText").value ?? "").trim();
  const at = around === "camera" ? viewport.cameraAt() : void 0;
  post({ type: "sectors.find", around, ...at ? { at } : {}, ...around === "text" ? { text } : {}, kinds: sectorKinds(), level: sectorLevel });
}
function renderSectors(s) {
  const sx = s.sectors;
  if (!sectorKindsShown) {
    sectorKindsShown = true;
    for (const [id, k] of SectorToggles) $(id).checked = sx.kinds.includes(k);
  }
  const n = sx.found.length;
  const where = sx.around === "text" ? `matching "${sx.text}"` : sx.around === "camera" ? "at the camera's place" : "at V's place";
  $("sectorsInfo").textContent = sx.status === "looking" ? "Looking for sectors... (the first time, REDbridge reads the game's list: a few seconds)" : sx.note ? sx.note : sx.around ? `${sx.total} sector${sx.total === 1 ? "" : "s"} ${where}${sx.total > n ? `, the first ${n} shown` : ""}. Finest level first. A click opens one beside this window.` : "Near V lists the sectors the game streams at V's place. Or type part of a name, or a grid cell.";
  const html = sx.found.map((r) => {
    const end = [
      r.streamed ? '<span class="tag streamed" title="Streamed in now">in</span>' : "",
      `<span class="tag">${esc(r.kind)}</span>`,
      `L${r.level}`,
      r.block === "ep1" ? '<span class="tag" title="Phantom Liberty">PL</span>' : "",
      r.distance !== void 0 && r.distance > 0 ? `${r.distance.toFixed(0)} m` : ""
    ].filter(Boolean).join(" ");
    return `<rn-item value="${esc(r.path)}" title="${esc(r.path)}"${s.sectors.open?.path === r.path ? " selected" : ""}>${esc(r.name)}<span slot="end">${end}</span></rn-item>`;
  }).join("");
  if (html !== sectorsHtml) $("sectorsList").innerHTML = sectorsHtml = html;
  if (lastFly < 0) lastFly = sx.fly?.seq ?? 0;
  if (sx.fly && sx.fly.seq !== lastFly) {
    lastFly = sx.fly.seq;
    mainTabs().select?.(WorldTab);
    document.getElementById("worldTabs").select?.(1);
    flyToPoint(sx.fly.position);
  }
}
function renderSectorDrawer(s) {
  const v2 = s.sectors.open;
  $("sectorDrawer").classList.toggle("open", !!v2);
  if (!v2) {
    lastSector = "";
    return;
  }
  if (v2.path !== lastSector) {
    lastSector = v2.path;
    drawerOpen = libraryDrawerOpen = previewsOpen = explorerOpen = previewAlone = previewWorld = filesOpen = false;
    renderLeft();
    $("sectorFilter").value = v2.filter;
  }
  const name = shortName(v2.path).replace(/\.streamingsector$/i, "");
  $("sectorTitle").textContent = `Sector: ${name}`;
  $("sectorTitle").title = v2.path;
  const streamed = v2.loaded === true ? "streamed in now" : v2.loaded === false ? "not streamed in now: go near it for its nodes to be in the game" : "";
  $("sectorInfo").textContent = v2.status === "reading" ? "Reading the sector through REDbridge..." : v2.status === "error" ? v2.error ?? "It could not be read." : [
    `${v2.kind}${v2.kind ? ", " : ""}level ${v2.level}. ${v2.total} entr${v2.total === 1 ? "y" : "ies"}${streamed ? `, ${streamed}` : ""}.`,
    v2.matching > v2.nodes.length ? `${v2.matching} match; the first ${v2.nodes.length} shown: the filter narrows them.` : v2.filter ? `${v2.matching} match.` : "",
    "A click picks one (Picked in the world, on the World tab); two clicks fly there. The eye hides one until EDGEbuilder stops."
  ].filter(Boolean).join("\n");
  const html = v2.nodes.map((r) => {
    const mark = r.streamed === true ? '<span class="streamed" title="Streamed in now">\u25CF</span>' : r.streamed === false ? '<span title="Not streamed in now">\u25CB</span>' : "";
    const end = [r.copies ? `<span class="tag" title="An instanced mesh: copies it places">\xD7${r.copies}</span>` : "", mark, `<button class="act${r.hidden ? " on" : ""}" data-act="hide" data-entry="${r.entry}" title="${r.hidden ? "Show it again" : "Hide it until EDGEbuilder stops (not kept in the scene)"}">${r.hidden ? EyeOffIcon : EyeIcon}</button>`].filter(Boolean).join(" ");
    const label = `#${r.entry} ${r.kind.replace(/^world/, "").replace(/Node$/, "")}${r.resource ? ` ${shortName(r.resource)}` : ""}`;
    const tip = [r.resource ?? "", r.ref ?? "", r.appearance ? `appearance ${r.appearance}` : "", `node ${r.node}, at ${r.position.map((x) => x.toFixed(1)).join(", ")}`].filter(Boolean).join("\n");
    return `<rn-item value="${r.entry}" title="${esc(tip)}"${v2.selected === r.entry ? " selected" : ""}>${esc(label)}<span slot="end">${end}</span></rn-item>`;
  }).join("");
  if (html !== sectorRowsHtml) $("sectorList").innerHTML = sectorRowsHtml = html;
  const sel = `${v2.path}:${v2.selected ?? ""}`;
  if (sel !== sectorSelShown) {
    sectorSelShown = sel;
    if (v2.selected !== void 0) $("sectorList").querySelector("rn-item[selected]")?.scrollIntoView({ block: "center" });
  }
}
function flyToPoint(position) {
  if (!state || state.world !== "ready" || state.settings.editorCamera === false) return;
  const edit = $("edit");
  if (!edit.checked) {
    edit.checked = true;
    viewport.setEdit(true);
  }
  const box = { id: "sector-node", kind: "entity", transform: { position, rotation: [0, 0, 0, 1], scale: [1, 1, 1] }, bounds: { min: [-1, -1, 0], max: [1, 1, 2] } };
  viewport.flyTo(box);
}
$("sectorsNearV").addEventListener("click", () => findSectors("V"));
$("sectorsNearCamera").addEventListener("click", () => findSectors("camera"));
$("sectorsText").addEventListener("input", () => {
  clearTimeout(sectorsTyped);
  sectorsTyped = setTimeout(() => findSectors("text"), 350);
});
for (const [id] of SectorToggles) $(id).addEventListener("change", () => state?.sectors.around && findSectors(state.sectors.around));
$("sectorLevel").addEventListener("change", (e) => {
  e.stopPropagation();
  sectorLevel = SectorLevels[e.detail.index] ?? null;
  if (state?.sectors.around) findSectors(state.sectors.around);
});
$("worldTabs").addEventListener("change", (e) => e.stopPropagation());
$("sectorsList").addEventListener("select", (e) => {
  const p = e.detail.value;
  if (p) post({ type: "sectors.open", path: p });
});
$("sectorClose").addEventListener("click", () => post({ type: "sectors.close" }));
$("sectorFilter").addEventListener("input", () => {
  clearTimeout(sectorFiltered);
  sectorFiltered = setTimeout(() => post({ type: "sectors.filter", text: $("sectorFilter").value ?? "" }), 250);
});
$("sectorList").addEventListener(
  "click",
  (e) => {
    const target2 = e.target;
    const hide = target2.closest?.("[data-act=hide]");
    if (hide) {
      e.stopPropagation();
      const entry2 = Number(hide.dataset.entry);
      const row = state?.sectors.open?.nodes.find((r) => r.entry === entry2);
      if (row) post({ type: "sectors.hide", entry: entry2, hidden: !row.hidden });
      return;
    }
    const v2 = target2.closest?.("rn-item")?.getAttribute("value");
    if (v2 === null || v2 === void 0) return;
    const entry = Number(v2);
    const twice = entry === lastSectorRow.entry && performance.now() - lastSectorRow.at < 500;
    lastSectorRow = twice ? { entry: -1, at: 0 } : { entry, at: performance.now() };
    if (!twice) {
      worldClickAt = 0;
      post({ type: "sectors.select", entry });
    } else {
      const row = state?.sectors.open?.nodes.find((r) => r.entry === entry);
      if (row) flyToPoint(row.position);
    }
  },
  true
);
var projectsHtml = {};
function renderProjects(id, s) {
  const list = s.sources.projects ?? [];
  $(id).hidden = list.length < 2;
  if (list.length < 2) return;
  const picked2 = s.sources.picked ?? null;
  const button = (dir, label, tip) => `<rn-button data-dir="${esc(dir ?? "")}"${dir === picked2 || dir && picked2 && sameFile(dir, picked2) ? "" : ' variant="ghost"'} title="${esc(tip)}">${esc(label)}</rn-button>`;
  const html = [`<span class="count">Project:</span>`, button(null, "Follow REDcode", "The project in the VS Code window used last"), ...list.map((p) => button(p.dir, p.name, p.dir))].join("");
  if (html !== projectsHtml[id]) $(id).innerHTML = projectsHtml[id] = html;
}
for (const id of ["bakeProjects", "importProjects"]) {
  $(id).addEventListener("click", (e) => {
    const b = e.target.closest?.("rn-button");
    if (!b) return;
    post({ type: "project.pick", dir: b.dataset.dir || null });
  });
}
var libraryDrawerOpen = false;
var previewsOpen = false;
var filesOpen = false;
var tileDetail = false;
var objectPreview = false;
var objectLike;
var exWidth = 480;
var tiles = /* @__PURE__ */ new Map();
function openLeft(which) {
  const wasFiles = filesOpen;
  filesOpen = which === "files";
  tileDetail = false;
  objectPreview = false;
  if (filesOpen && !wasFiles) askFiles(fileStart());
  previewAlone = which === "preview";
  previewWorld = which === "world";
  drawerOpen = which === "objects";
  libraryDrawerOpen = which === "library";
  previewsOpen = which === "previews";
  const wasExplorer = explorerOpen;
  explorerOpen = which === "explorer";
  if (explorerOpen && !wasExplorer) renderExplorer();
  if (which !== "none" && state?.sectors.open) post({ type: "sectors.close" });
  if (which === "objects") {
    peekAsked = "";
    confirming = void 0;
  }
  if (state) render(state);
  else renderLeft();
}
function renderLeft() {
  $("drawer").classList.toggle("open", drawerOpen);
  $("libraryDrawer").classList.toggle("open", libraryOut && libraryDrawerOpen);
  $("previewsDrawer").classList.toggle("open", previewsOpen);
  $("previewsEye").setAttribute("aria-pressed", String(previewsOpen));
  $("explorerDrawer").classList.toggle("open", explorerOpen);
  const worldOpen = previewWorld && !!state?.worldObjects.picked;
  const besideTiles = tileDetail && previewsOpen && !explorerOpen;
  const besideObjects = objectPreview && drawerOpen && !explorerOpen;
  $("exPreview").classList.toggle("open", worldOpen || (explorerOpen || previewAlone || besideTiles || besideObjects) && !!exPicked);
  $("exPreview").classList.toggle("alone", !explorerOpen && !previewWorld && !besideTiles && !besideObjects);
  $("exPreview").classList.toggle("besidePreviews", besideTiles);
  $("exPreview").classList.toggle("besideObjects", besideObjects);
  $("exPreview").style.right = explorerOpen && !previewWorld ? `${656 + exWidth + 8}px` : "";
  for (const t of tiles.values()) t.el.classList.toggle("picked", besideTiles && t.el.dataset.path === exPicked?.path);
  $("exPreview").classList.toggle("world", previewWorld);
  $("explorerOpen").setAttribute("aria-pressed", String(explorerOpen));
  $("fileDrawer").classList.toggle("open", filesOpen);
  $("importBrowse").setAttribute("aria-pressed", String(filesOpen));
  if (!worldOpen && (!explorerOpen && !previewAlone && !besideTiles && !besideObjects || !exPicked)) stopExView();
}
var libraryOut = false;
try {
  libraryOut = localStorage.getItem("edgebuilder.libraryOut") === "1";
} catch {
}
function placeLibrary() {
  const list = $("shelves");
  const home = libraryOut ? $("libraryDrawerBody") : $("libraryHome");
  if (list.parentElement !== home) home.appendChild(list);
  $("libraryLabel").hidden = libraryOut;
  $("libraryOpenRow").hidden = !libraryOut;
  const icon = $("libraryOut");
  icon.setAttribute("aria-pressed", String(libraryOut));
  icon.title = libraryOut ? "Back into the window: the Library here again, and no drawer" : "Out of the window: the Library in a drawer to the left, with more room";
  renderLeft();
}
function setLibraryOut(on) {
  libraryOut = on;
  try {
    localStorage.setItem("edgebuilder.libraryOut", on ? "1" : "0");
  } catch {
  }
  placeLibrary();
  openLeft(on ? "library" : drawerOpen ? "objects" : previewsOpen ? "previews" : "none");
}
$("libraryOut").addEventListener("click", () => setLibraryOut(!libraryOut));
$("libraryDrawerIn").addEventListener("click", () => setLibraryOut(false));
$("libraryDrawerClose").addEventListener("click", () => openLeft("none"));
$("libraryOpen").addEventListener("click", () => openLeft(libraryDrawerOpen ? "none" : "library"));
function drawerWidths(drawer, shrink, grow, widths, key, changed) {
  let step = 0;
  try {
    step = Number(localStorage.getItem(key) ?? 0) | 0;
  } catch {
  }
  const size = (n) => {
    step = Math.max(0, Math.min(widths.length - 1, n));
    $(drawer).style.width = `${widths[step]}px`;
    $(shrink).toggleAttribute("disabled", step === 0);
    $(grow).toggleAttribute("disabled", step === widths.length - 1);
    try {
      localStorage.setItem(key, String(step));
    } catch {
    }
    changed?.(widths[step]);
  };
  $(grow).addEventListener("click", () => size(step + 1));
  $(shrink).addEventListener("click", () => size(step - 1));
  size(step);
}
drawerWidths("libraryDrawer", "libraryShrink", "libraryGrow", [420, 540, 680, 840], "edgebuilder.libraryWidth");
drawerWidths("explorerDrawer", "exShrink", "exGrow", [480, 600, 720, 840], "edgebuilder.explorerWidth", (w) => {
  exWidth = w;
  renderLeft();
});
placeLibrary();
var fileSeq = 0;
var files;
var fileChosen;
var fileFilter = "";
function fileStart() {
  const typed = ($("importPath").value ?? "").trim().replace(/^"(.*)"$/, "$1");
  if (typed) return typed.toLowerCase().endsWith(".glb") || typed.toLowerCase().endsWith(".prop.asset") ? typed.replace(/[\\/][^\\/]*$/, "") : typed;
  try {
    return localStorage.getItem("edgebuilder.fileDir") ?? void 0;
  } catch {
    return void 0;
  }
}
function askFiles(dir) {
  post({ type: "files", seq: ++fileSeq, dir });
}
function filesCame(m) {
  if (m.seq !== fileSeq) return;
  if (m.why && files && !m.folders.length && !m.files.length) {
    $("fileInfo").textContent = m.why;
    return;
  }
  if (files?.dir !== m.dir) {
    fileFilter = "";
    $("fileFilter").value = "";
  }
  files = m;
  $("filePath").value = m.dir;
  if (!m.why) {
    try {
      localStorage.setItem("edgebuilder.fileDir", m.dir);
    } catch {
    }
  }
  renderFiles();
}
var fileWhen = (ms) => {
  if (!ms) return "";
  const d = new Date(ms);
  const two = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`;
};
var fileSize = (b) => b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`;
function renderFiles() {
  const f = files;
  const places = f?.places ?? [];
  const lower = (f?.dir ?? "").toLowerCase();
  const inPlace = places.filter((p) => lower === p.dir.toLowerCase().replace(/[\\/]$/, "") || lower.startsWith(p.dir.toLowerCase().replace(/[\\/]?$/, "\\")) || lower === p.dir.toLowerCase()).sort((a, b) => b.dir.length - a.dir.length)[0];
  const kinds = { known: "", user: "", drive: "drive" };
  $("filePlaces").innerHTML = places.map((p, i) => {
    const gap = i > 0 && places[i - 1].kind !== p.kind ? ' style="margin-top:8px"' : "";
    return `<rn-item value="${esc(p.dir)}" title="${esc(p.dir)}"${p === inPlace ? " selected" : ""}${gap}>${esc(p.label)}<span slot="end">${esc(kinds[p.kind] ?? "")}</span></rn-item>`;
  }).join("");
  $("fileUp").toggleAttribute("disabled", !f?.parent);
  if (!f) {
    $("fileList").innerHTML = `<rn-item disabled>reading...</rn-item>`;
    $("fileInfo").textContent = "";
    return;
  }
  const text = fileFilter.toLowerCase();
  const match = (name) => !text || name.toLowerCase().includes(text);
  const folders = f.folders.filter((d) => !d.prop && match(d.name));
  const props = f.folders.filter((d) => d.prop && match(`${d.name} ${d.prop}`));
  const glbs = f.files.filter((x) => match(x.name));
  const rows = [];
  for (const d of folders) rows.push(`<rn-item value="d:${esc(d.path)}" title="${esc(d.path)}"><span class="fold">\u25B8</span>${esc(d.name)}<span slot="end"><span class="when">${esc(fileWhen(d.changed))}</span></span></rn-item>`);
  for (const d of props) rows.push(`<rn-item value="f:${esc(d.path)}" title="${esc(d.path)}"${fileChosen === d.path ? " selected" : ""}><span class="fold"></span>${esc(d.prop ?? d.name)}<span slot="end">prop<span class="when">${esc(fileWhen(d.changed))}</span></span></rn-item>`);
  for (const x of glbs) rows.push(`<rn-item value="f:${esc(x.path)}" title="${esc(x.path)}"${fileChosen === x.path ? " selected" : ""}><span class="fold"></span>${esc(x.name)}<span slot="end"><span class="size">${esc(fileSize(x.bytes))}</span><span class="when">${esc(fileWhen(x.changed))}</span></span></rn-item>`);
  if (!rows.length) rows.push(`<rn-item disabled>${esc(f.why ?? (text ? "nothing here matches" : "no folders or GLB files here"))}</rn-item>`);
  $("fileList").innerHTML = rows.join("");
  const n = (k, one, many) => `${k.toLocaleString()} ${k === 1 ? one : many}`;
  $("fileInfo").textContent = f.why ?? `${n(folders.length, "folder", "folders")}, ${n(glbs.length, "GLB file", "GLB files")}${props.length ? `, ${n(props.length, "prop", "props")}` : ""}${text ? " match" : ""}${f.more ? " (a very big folder: only the first 3,000 entries)" : ""}. A click opens a folder or picks a file; a double-click on a file uses it.`;
  $("fileChosen").textContent = fileChosen ?? "Pick a .glb file, or a prop from EDGEfab's Desk";
  $("fileUse").toggleAttribute("disabled", !fileChosen);
}
function useFile(file) {
  $("importPath").value = file;
  openLeft("none");
  pickTyped();
}
$("importBrowse").addEventListener("click", () => openLeft(filesOpen ? "none" : "files"));
$("fileClose").addEventListener("click", () => openLeft("none"));
$("fileUp").addEventListener("click", () => files?.parent && askFiles(files.parent));
$("filePath").addEventListener("submit", () => {
  const dir = ($("filePath").value ?? "").trim().replace(/^"(.*)"$/, "$1");
  if (dir) askFiles(dir);
});
$("fileFilter").addEventListener("input", () => {
  fileFilter = ($("fileFilter").value ?? "").trim();
  renderFiles();
});
$("filePlaces").addEventListener("select", (e) => {
  const dir = e.detail.value;
  if (dir) askFiles(dir);
});
$("fileList").addEventListener("select", (e) => {
  const value = e.detail.value ?? "";
  if (value.startsWith("d:")) return askFiles(value.slice(2));
  if (!value.startsWith("f:")) return;
  fileChosen = value.slice(2);
  renderFiles();
});
var lastFileClick = { value: "", at: 0 };
$("fileList").addEventListener(
  "click",
  (e) => {
    const value = e.target.closest?.("rn-item")?.getAttribute("value") ?? "";
    const twice = value.startsWith("f:") && value === lastFileClick.value && performance.now() - lastFileClick.at < 500;
    lastFileClick = twice ? { value: "", at: 0 } : { value, at: performance.now() };
    if (twice) useFile(value.slice(2));
  },
  true
);
$("fileUse").addEventListener("click", () => fileChosen && useFile(fileChosen));
var previews;
var previewsWhy = "";
var previewsLoading;
var tilesKey = "";
var models = /* @__PURE__ */ new Map();
var spinning;
function loadPreviews() {
  previewsLoading ??= (async () => {
    try {
      const mod = await import(new URL("./previews.js", import.meta.url).href);
      previews = mod.createPreviews(256);
    } catch (err) {
      previewsWhy = `3D pictures cannot be drawn here (${err.message || "no WebGL"}); the tiles show names.`;
      post({ type: "log", text: `Previews: ${previewsWhy}` });
      if (state) render(state);
    }
  })();
  return previewsLoading;
}
$("previewsEye").addEventListener("click", () => {
  openLeft(previewsOpen ? "none" : "previews");
  if (previewsOpen) void loadPreviews().then(() => askVisible());
});
$("previewsClose").addEventListener("click", () => openLeft("none"));
function renderPreviews(s) {
  $("previewsEye").disabled = !s.results.length;
  if (!s.results.length && previewsOpen) previewsOpen = false;
  if (!previewsOpen) return;
  const people = s.results.filter((r) => r.kind === "npc").length;
  $("previewsTitle").textContent = s.query.text ? `Previews: ${s.query.text}` : "Previews";
  $("previewsInfo").textContent = [
    `${s.results.length} result${s.results.length === 1 ? "" : "s"}${people ? ` (NPCs by name for now)` : ""}. The mouse on a picture turns it; a click ${tileDetails ? "shows its details beside this, with Drop" : "starts Drop at click"}.`,
    previewsWhy,
    s.bridge.status !== "ready" && !previewsWhy ? "New pictures need REDbridge: those kept from before still show." : ""
  ].filter(Boolean).join(" ");
  const key = s.results.map((r) => r.path).join("\n");
  if (key === tilesKey) return;
  tilesKey = key;
  stopSpin();
  const grid = $("previewGrid");
  for (const t of tiles.values()) seen.unobserve(t.el);
  inView.clear();
  grid.innerHTML = "";
  const old = new Map(tiles);
  tiles.clear();
  for (const r of s.results) {
    const el = document.createElement("div");
    el.className = "tile";
    el.dataset.path = r.path;
    el.title = rowTitle(r);
    const drawn = r.kind !== "npc";
    const was = old.get(r.path);
    el.innerHTML = `<div class="pic">${was?.picture ? `<img alt="" src="${was.picture}">` : drawn ? "" : "NPC"}</div><div class="name">${esc(labelOf(r))}</div>`;
    grid.appendChild(el);
    tiles.set(r.path, { el, drawn, picture: was?.picture, error: was?.error });
    seen.observe(el);
  }
  grid.scrollTop = 0;
}
var inView = /* @__PURE__ */ new Set();
var askSoon;
var seen = new IntersectionObserver(
  (entries) => {
    for (const e of entries) {
      const p = e.target.dataset.path ?? "";
      if (e.isIntersecting) inView.add(p);
      else inView.delete(p);
    }
    clearTimeout(askSoon);
    askSoon = setTimeout(askVisible, 150);
  },
  { root: document.getElementById("previewGrid"), rootMargin: "200px 0px" }
);
function askVisible() {
  if (!previewsOpen || !previews) return;
  const now = performance.now();
  const paths = [...inView].filter((p) => {
    const t = tiles.get(p);
    return t && t.drawn && !t.picture && !t.error && (!t.asked || now - t.asked > 2e4);
  });
  if (!paths.length) return;
  for (const p of paths) {
    const t = tiles.get(p);
    t.asked = now;
    t.el.querySelector(".pic").textContent = "drawing...";
  }
  post({ type: "preview.ask", paths });
}
var fromBase64 = (b64) => {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
};
async function previewCame(m) {
  const t = tiles.get(m.path);
  const pic = t?.el.querySelector(".pic");
  if (m.error) {
    if (t && !t.picture) {
      t.error = m.error;
      if (pic) {
        pic.textContent = "no picture";
        pic.title = m.error;
      }
    }
    return;
  }
  let picture = m.png ? `data:image/png;base64,${m.png}` : void 0;
  if (m.parts) {
    const parts = m.parts.map((p) => ({ glb: fromBase64(p.glb), offset: p.offset, scale: p.scale }));
    models.set(m.path, parts);
    while (models.size > 40) models.delete(models.keys().next().value);
    if (!t?.picture && previews) {
      try {
        picture = await previews.picture(parts);
        post({ type: "preview.save", key: m.key, png: picture.slice(picture.indexOf(",") + 1) });
      } catch (err) {
        if (t) t.error = err.message;
        if (pic) pic.textContent = "no picture";
        return;
      }
    }
    if (spinning?.path === m.path && !spinning.stop) void startSpin(m.path);
  }
  if (t && picture && !t.picture) {
    t.picture = picture;
    if (pic) pic.innerHTML = `<img alt="" src="${picture}">`;
  }
}
async function startSpin(path) {
  const t = tiles.get(path);
  const parts = models.get(path);
  if (!t || !previews || spinning?.path !== path) return;
  if (!parts) return post({ type: "preview.ask", paths: [path], glb: true });
  const pic = t.el.querySelector(".pic");
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256;
  const stop = await previews.spin(parts, canvas);
  if (spinning?.path !== path) return stop();
  pic.appendChild(canvas);
  pic.classList.add("spinning");
  spinning.stop = () => {
    stop();
    canvas.remove();
    pic.classList.remove("spinning");
  };
}
function stopSpin() {
  spinning?.stop?.();
  spinning = void 0;
}
$("previewGrid").addEventListener("mouseover", (e) => {
  const tile = e.target.closest?.(".tile");
  const path = tile?.dataset.path;
  if (!path || spinning?.path === path) return;
  stopSpin();
  if (tiles.get(path)?.picture) {
    spinning = { path };
    void startSpin(path);
  }
});
$("previewGrid").addEventListener("mouseleave", () => stopSpin());
$("previewGrid").addEventListener("click", (e) => {
  const path = e.target.closest?.(".tile")?.dataset.path;
  if (!path) return;
  lookedAt = path;
  appearance = void 0;
  post({ type: "look", path });
  stopSpin();
  const r = state?.results.find((x) => x.path === path);
  if (tileDetails && r) {
    exPicked = r;
    tileDetail = true;
    if (state) render(state);
    else renderLeft();
    return;
  }
  openLeft("none");
  startDropAtClick(path, void 0);
});
var tileDetails = true;
try {
  tileDetails = localStorage.getItem("edgebuilder.tileDetails") !== "0";
} catch {
}
$("tileDetails").checked = tileDetails;
$("tileDetails").addEventListener("change", (e) => {
  tileDetails = !!e.detail.checked;
  try {
    localStorage.setItem("edgebuilder.tileDetails", tileDetails ? "1" : "0");
  } catch {
  }
  if (!tileDetails && tileDetail) {
    tileDetail = false;
    renderLeft();
  }
});
var explorerOpen = false;
var previewAlone = false;
var previewWorld = false;
var previewPick = false;
var freePick = false;
var hoverSent = false;
try {
  freePick = localStorage.getItem("edgebuilder.freePick") === "1";
} catch {
}
$("freePick").checked = freePick;
$("freePick").addEventListener("change", (e) => {
  freePick = !!e.detail.checked;
  try {
    localStorage.setItem("edgebuilder.freePick", freePick ? "1" : "0");
  } catch {
  }
  if (!freePick && hoverSent) {
    hoverSent = false;
    post({ type: "world.hoverRay", ray: null });
  }
});
var pickWaitFrom;
var worldTip = false;
try {
  worldTip = localStorage.getItem("edgebuilder.worldTip") === "1";
} catch {
}
$("worldTip").checked = worldTip;
$("worldTip").addEventListener("change", (e) => {
  worldTip = !!e.detail.checked;
  try {
    localStorage.setItem("edgebuilder.worldTip", worldTip ? "1" : "0");
  } catch {
  }
  if (state) render(state);
});
function tipFor(p) {
  const at = p.position;
  let corners;
  const box = p.box;
  const near = box && at.every((v2, i) => v2 >= box.min[i] - 1 && v2 <= box.max[i] + 1);
  const cornersOf = (min, max) => [0, 1, 2, 3, 4, 5, 6, 7].map((k) => [k & 1 ? max[0] : min[0], k & 2 ? max[1] : min[1], k & 4 ? max[2] : min[2]]);
  if (box && near) corners = cornersOf(box.min, box.max);
  else if (box) {
    const q = p.orientation ?? [0, 0, 0, 1];
    const sc = p.scale ?? [1, 1, 1];
    corners = cornersOf(box.min, box.max).map((c) => add(at, qRotateV(q, [c[0] * sc[0], c[1] * sc[1], c[2] * sc[2]])));
  } else corners = cornersOf([at[0] - 0.8, at[1] - 0.8, at[2]], [at[0] + 0.8, at[1] + 0.8, at[2] + 2.3]);
  const xs = corners.map((c) => c[0]);
  const ys = corners.map((c) => c[1]);
  const zs = corners.map((c) => c[2]);
  const size = [Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), Math.max(...zs) - Math.min(...zs)];
  const lines = [
    `${p.className}${p.what === "door" ? ", a door" : p.what === "fakeDoor" ? ", a painted-on door" : ""}`,
    box ? `about ${size.map((v2) => v2.toFixed(1)).join(" \xD7 ")} m` : "",
    p.ray ? p.ray.solid ? "solid where you clicked" : "not solid where you clicked" : "",
    p.door ? doorText(p.door) : "",
    p.removedBy ? `removed by this scene (${p.removedBy})` : ""
  ].filter(Boolean);
  return { corners, title: p.resource ? shortName(p.resource) : p.label, lines, area: freeArea };
}
function freeArea() {
  let left = 0;
  let right = window.innerWidth - 24 - 624;
  for (const id of ["drawer", "sectorDrawer", "libraryDrawer", "previewsDrawer", "explorerDrawer", "exPreview", "fileDrawer"]) {
    const el = document.getElementById(id);
    if (!el?.classList.contains("open")) continue;
    const b = el.getBoundingClientRect();
    if (b.left < window.innerWidth / 3) left = Math.max(left, b.right);
    else right = Math.min(right, b.left);
  }
  return { left, right };
}
function qRotateV(q, v2) {
  const [x, y, z, w] = q;
  const tx = 2 * (y * v2[2] - z * v2[1]);
  const ty = 2 * (z * v2[0] - x * v2[2]);
  const tz = 2 * (x * v2[1] - y * v2[0]);
  return [v2[0] + w * tx + (y * tz - z * ty), v2[1] + w * ty + (z * tx - x * tz), v2[2] + w * tz + (x * ty - y * tx)];
}
function showWorldPreview() {
  drawerOpen = libraryDrawerOpen = previewsOpen = explorerOpen = previewAlone = filesOpen = false;
  previewWorld = true;
  if (state?.sectors.open) post({ type: "sectors.close" });
}
var worldLookAsked = "";
function renderWorldPreview(s) {
  const p = s.worldObjects.picked;
  if (!p) {
    stopExView();
    return;
  }
  const res = p.resource && kindOfPath(p.resource) ? p.resource : void 0;
  $("exTitle").textContent = p.label;
  $("exTitle").title = p.resource ?? "";
  if (res) {
    void showExView(res);
    if (worldLookAsked !== res) {
      worldLookAsked = res;
      post({ type: "look", path: res });
    }
  } else {
    stopExView();
    $("exCanvas").getContext("2d")?.clearRect(0, 0, 378, 400);
    $("exNote").textContent = p.resource ? "No 3D preview for this kind of file." : "Its file is not known, so there is no 3D preview.";
  }
  const info = res && s.looked?.path === res ? s.looked.info : void 0;
  const b = info?.bounds;
  const sc = p.scale ?? [1, 1, 1];
  const node = p.node;
  const d = p.door;
  const solid = p.ray ? p.ray.solid ? `yes: the game's physics stopped the click's line on it${p.ray.distance !== void 0 ? ` (${p.ray.distance.toFixed(1)} m from the camera)` : ""}` : "no: the click's line went through it (walk-through here, or its collision is a separate node)" : p.what === "door" ? "a door: solid while it is closed" : "not known: pick it with the cursor to find out";
  const lines = [
    ["Name", p.label],
    ["Kind", `${p.className}${p.what === "door" ? " (a door that opens)" : p.what === "fakeDoor" ? " (a painted-on door)" : ""}`],
    ["Solid", solid]
  ];
  if (res && p.what === "mesh") lines.push(["Collision", info?.hasCollision === true ? "its mesh carries collision data" : info?.hasCollision === false ? "its mesh has no collision data" : "reading..."]);
  if (p.resource) lines.push(["Path", p.resource]);
  if (p.appearance) lines.push(["Look", p.appearance]);
  if (b) lines.push(["Size", `${((b.max[0] - b.min[0]) * sc[0]).toFixed(2)} \xD7 ${((b.max[1] - b.min[1]) * sc[1]).toFixed(2)} \xD7 ${((b.max[2] - b.min[2]) * sc[2]).toFixed(2)} m${sc.some((v2) => Math.abs(v2 - 1) > 1e-3) ? ` (scaled ${sc.map((v2) => v2.toFixed(2)).join(", ")})` : ""}`]);
  lines.push(["At", p.position.map((v2) => v2.toFixed(2)).join(", ")]);
  if (d) lines.push(["Door", [doorText(d), d.initial ? `starts ${d.initial.toLowerCase()}` : "", d.closesItself ? "closes by itself" : ""].filter(Boolean).join("; ")]);
  if (node) lines.push(["Node", `${node.type}, entry ${node.entry} (node ${node.node})`], ["Sector", node.sector ? shortName(node.sector) : node.sectorHash]);
  else if (p.note) lines.push(["Node", p.note]);
  if (p.ref) lines.push(["Ref", p.ref]);
  if (p.proxies?.length) lines.push(["Proxy", p.proxies.map((x) => `entry ${x.entry} in ${x.sector ? shortName(x.sector) : x.sectorHash}`).join(", ")]);
  if (p.removedBy) lines.push(["Scene", `removed by this scene (${p.removedBy})`]);
  $("exProps").innerHTML = lines.map(([k, v2]) => `<div class="prop"><span class="k">${esc(k)}</span><span class="v">${esc(v2)}</span></div>`).join("");
  $("exAppearances").hidden = true;
  $("exAppLabel").hidden = true;
  $("exDrop").textContent = "Drop a copy";
  $("exDrop").toggleAttribute("disabled", !res);
  $("exDrop").title = res ? "A copy of it in the open scene: Drop at click starts with its outline under the crosshair" : "Its file is not known";
}
try {
  previewPick = localStorage.getItem("edgebuilder.previewPick") === "1";
} catch {
}
$("previewPick").checked = previewPick;
function previewResult(path) {
  const r = state?.results.find((x) => x.path === path);
  if (!r) return;
  exPicked = r;
  if (explorerOpen) {
    revealInExplorer(r);
    renderLeft();
    if (state) render(state);
  } else if (previewsOpen) {
    tileDetail = true;
    if (state) render(state);
  } else openLeft("preview");
}
$("previewPick").addEventListener("change", (e) => {
  previewPick = !!e.detail.checked;
  try {
    localStorage.setItem("edgebuilder.previewPick", previewPick ? "1" : "0");
  } catch {
  }
  if (previewPick && lookedAt) previewResult(lookedAt);
  else if (!previewPick && previewAlone) openLeft("none");
});
var exPicked;
var exRoots = [];
var exCache = /* @__PURE__ */ new Map();
var exOpen = /* @__PURE__ */ new Set(["game|"]);
var exAsked = /* @__PURE__ */ new Set();
var exFolder = { root: "game", dir: "" };
var exFilter = "";
var exFound;
var exSeq = 0;
var exFilterSeq = 0;
var exCounts = "";
var exEntries = /* @__PURE__ */ new Map();
var exKey = (root, dir) => `${root}|${dir.toLowerCase()}`;
var exJoin = (dir, name) => dir ? `${dir}\\${name}` : name;
function exAsk(root, dir) {
  const key = exKey(root, dir);
  if (exAsked.has(key)) return;
  exAsked.add(key);
  post({ type: "explore", seq: ++exSeq, root, dir });
}
function explorerCame(m) {
  exRoots = m.roots;
  for (const e of m.items) exEntries.set(e.path, e);
  if (m.text) {
    if (m.seq === exFilterSeq) exFound = m;
  } else if (m.root) exCache.set(exKey(m.root, m.dir), m);
  if (!exFolder.root || !exRoots.some((r) => r.id === exFolder.root)) exFolder = { root: exRoots[0]?.id ?? "game", dir: "" };
  renderExplorer();
}
function explorerFresh(s) {
  const counts = `${s.index.count}|${s.sources.mods.assets}|${s.sources.project?.assets ?? 0}|${s.npcs.count}`;
  if (counts === exCounts) return;
  exCounts = counts;
  exCache.clear();
  exAsked.clear();
  exFound = void 0;
  if (explorerOpen) {
    post({ type: "explore", seq: ++exSeq, root: "", dir: "" });
    if (exFilter) askExFilter();
    renderExplorer();
  }
}
function askExFilter() {
  exFilterSeq = ++exSeq;
  post({ type: "explore", seq: exFilterSeq, root: exFolder.root, dir: exFolder.dir, text: exFilter });
}
function renderExplorer() {
  if (!explorerOpen) return;
  const rows = [];
  const pad = (depth) => ` style="padding-left:${8 + depth * 16}px"`;
  const itemRow = (e, depth, label) => `<rn-item value="i:${esc(e.path)}" title="${esc(rowTitle(e))}"${exPicked?.path === e.path ? " selected" : ""}${pad(depth)}><span class="fold"></span>${esc(label)}<span slot="end">${esc(e.kind === "npc" ? "NPC" : e.kind)}</span></rn-item>`;
  const folderLabel = exFolder.dir ? `${exRoots.find((r) => r.id === exFolder.root)?.label ?? exFolder.root} > ${exFolder.dir.replace(/\\/g, " > ")}` : exRoots.find((r) => r.id === exFolder.root)?.label ?? "";
  $("exFilter").setAttribute("placeholder", `Filter in ${folderLabel || "the game"}, e.g. crate`);
  if (exFilter) {
    const f = exFound;
    if (!f) rows.push(`<rn-item disabled${pad(0)}>looking...</rn-item>`);
    else {
      for (const e of f.items) rows.push(itemRow(e, 0, e.kind === "npc" ? labelOf(e) : f.dir && e.path.toLowerCase().startsWith(`${f.dir.toLowerCase()}\\`) ? e.path.slice(f.dir.length + 1) : e.path));
      if (!f.items.length) rows.push(`<rn-item disabled${pad(0)}>nothing here matches</rn-item>`);
    }
    $("exInfo").textContent = f ? `${f.total.toLocaleString()} match${f.total === 1 ? "" : "es"} in ${folderLabel}${f.total > f.items.length ? `, the first ${f.items.length} shown` : ""}` : "";
  } else {
    const walk = (root, dir, depth) => {
      const got = exCache.get(exKey(root, dir));
      if (!got) {
        exAsk(root, dir);
        rows.push(`<rn-item disabled${pad(depth)}><span class="fold"></span>reading...</rn-item>`);
        return;
      }
      for (const f of got.folders) {
        const sub2 = exJoin(dir, f.name);
        const key = exKey(root, sub2);
        const here = exFolder.root === root && exFolder.dir.toLowerCase() === sub2.toLowerCase();
        rows.push(`<rn-item value="d:${esc(root)}|${esc(sub2)}"${here ? ' class="here"' : ""}${pad(depth)}><span class="fold">${exOpen.has(key) ? "\u25BE" : "\u25B8"}</span>${esc(f.name)}<span slot="end">${f.count.toLocaleString()}</span></rn-item>`);
        if (exOpen.has(key)) walk(root, sub2, depth + 1);
      }
      for (const e of got.items) rows.push(itemRow(e, depth, e.kind === "npc" ? labelOf(e) : shortName(e.path)));
      if (got.total > got.items.length) rows.push(`<rn-item disabled${pad(depth)}><span class="fold"></span>${(got.total - got.items.length).toLocaleString()} more: filter to find them</rn-item>`);
    };
    if (!exRoots.length) {
      exAsk("", "");
      rows.push(`<rn-item disabled>reading...</rn-item>`);
    }
    for (const r of exRoots) {
      const key = exKey(r.id, "");
      const here = exFolder.root === r.id && !exFolder.dir;
      rows.push(`<rn-item value="d:${esc(r.id)}|"${here ? ' class="here"' : ""}${pad(0)}><span class="fold">${exOpen.has(key) ? "\u25BE" : "\u25B8"}</span><span class="section">${esc(r.label)}</span><span slot="end">${r.count.toLocaleString()}</span></rn-item>`);
      if (exOpen.has(key)) walk(r.id, "", 1);
    }
    $("exInfo").textContent = exRoots.length ? "A click opens a folder; a pick shows it beside this, in 3D. Typing filters in the folder clicked last." : "";
  }
  $("exList").innerHTML = rows.join("");
  if (exReveal) {
    const row = [...$("exList").querySelectorAll("rn-item")].find((x) => x.getAttribute("value") === `i:${exReveal}`);
    if (row) {
      row.scrollIntoView({ block: "center" });
      exReveal = void 0;
    }
  }
}
var exReveal;
function revealInExplorer(e) {
  const root = e.kind === "npc" ? "people" : e.source?.kind === "project" ? "project" : e.source?.kind === "mod" ? `mod:${e.source.name}` : "game";
  let dir = "";
  exOpen.add(exKey(root, ""));
  for (const seg of exploreSegments(root, e.path).slice(0, -1)) {
    dir = exJoin(dir, seg);
    exOpen.add(exKey(root, dir));
  }
  exFolder = { root, dir };
  if (exFilter) {
    exFilter = "";
    $("exFilter").value = "";
    exFound = void 0;
  }
  exReveal = e.path;
  renderExplorer();
}
$("explorerOpen").addEventListener("click", () => openLeft(explorerOpen ? "none" : "explorer"));
$("explorerClose").addEventListener("click", () => openLeft("none"));
$("exPreviewClose").addEventListener("click", () => {
  if (previewAlone || previewWorld) return openLeft("none");
  if (objectPreview) {
    objectPreview = false;
    if (state) render(state);
    else renderLeft();
    return;
  }
  if (tileDetail) {
    tileDetail = false;
    renderLeft();
    return;
  }
  exPicked = void 0;
  renderLeft();
  renderExplorer();
});
var exTyping;
$("exFilter").addEventListener("input", () => {
  clearTimeout(exTyping);
  exTyping = setTimeout(() => {
    exFilter = ($("exFilter").value ?? "").trim();
    exFound = void 0;
    if (exFilter) askExFilter();
    renderExplorer();
  }, 200);
});
$("exList").addEventListener("select", (e) => {
  const value = e.detail.value ?? "";
  if (value.startsWith("d:")) {
    const [root, ...rest] = value.slice(2).split("|");
    const dir = rest.join("|");
    const key = exKey(root, dir);
    if (exOpen.has(key) && exFolder.root === root && exFolder.dir.toLowerCase() === dir.toLowerCase()) exOpen.delete(key);
    else exOpen.add(key);
    exFolder = { root, dir };
    renderExplorer();
    return;
  }
  if (!value.startsWith("i:")) return;
  const entry = exEntries.get(value.slice(2));
  if (!entry) return;
  exPicked = entry;
  lookedAt = entry.path;
  appearance = void 0;
  post({ type: "look", path: entry.path });
  renderLeft();
  renderExplorer();
  if (state) render(state);
});
var exView;
var exGlbAsked = "";
var exErrors = /* @__PURE__ */ new Map();
function stopExView() {
  exView?.stop?.();
  exView = void 0;
}
async function showExView(path) {
  if (exView?.path === path) return;
  stopExView();
  const view = { path };
  exView = view;
  const note = $("exNote");
  const canvas = $("exCanvas");
  canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
  if (!kindOfPath(path)) {
    note.textContent = "People have no 3D preview yet.";
    return;
  }
  await loadPreviews();
  if (exView !== view) return;
  if (!previews) {
    note.textContent = previewsWhy;
    return;
  }
  const why = exErrors.get(path);
  if (why) {
    note.textContent = `No 3D preview: ${why}`;
    return;
  }
  const parts = models.get(path);
  if (!parts) {
    note.textContent = "drawing...";
    if (exGlbAsked !== path) {
      exGlbAsked = path;
      post({ type: "preview.ask", paths: [path], glb: true });
    }
    exView = void 0;
    return;
  }
  note.textContent = "";
  try {
    const v2 = await previews.view(parts, canvas);
    if (exView !== view) return v2.stop();
    view.stop = () => v2.stop();
  } catch (err) {
    note.textContent = `No 3D preview: ${err.message}`;
  }
}
var kindOfPath = (p) => /\.(mesh|ent)$/i.test(p);
function renderExPreview(s) {
  if (previewWorld) return renderWorldPreview(s);
  const copying = objectPreview && drawerOpen && !explorerOpen;
  $("exDrop").textContent = copying ? "Drop a copy" : "Drop";
  $("exDrop").removeAttribute("disabled");
  $("exDrop").title = copying ? "A copy of this object, with its look, scale, Solid and Seen from: the drawers close and Drop at click starts with its outline" : "Closes the drawers and starts Drop at click: the object's outline follows the cursor, a click puts it there, Esc cancels";
  const e = exPicked;
  if (!e || !explorerOpen && !previewAlone && !(tileDetail && previewsOpen) && !copying) {
    stopExView();
    return;
  }
  $("exTitle").textContent = labelOf(e);
  $("exTitle").title = e.path;
  void showExView(e.path);
  const info = s.looked?.path === e.path ? s.looked.info : void 0;
  const parts = models.get(e.path);
  const b = info?.bounds;
  const from2 = e.source ? e.source.kind === "project" ? `the project ${e.source.name}` : `the mod ${e.source.name}` : e.kind === "npc" ? "the game's TweakDB" : e.path.toLowerCase().startsWith("ep1\\") ? "the game (Phantom Liberty)" : "the game";
  const lines = [
    ["Name", e.kind === "npc" ? e.name ?? e.path : shortName(e.path)],
    ["Path", e.path],
    ["Kind", e.kind === "npc" ? "a person (NPC)" : e.kind === "entity" ? "an entity" : "a mesh"],
    ["From", from2 + (e.replaces ? ", changing the game's file" : "")],
    ["Size", b ? `${(b.max[0] - b.min[0]).toFixed(2)} \xD7 ${(b.max[1] - b.min[1]).toFixed(2)} \xD7 ${(b.max[2] - b.min[2]).toFixed(2)} m (width, depth, height)` : info?.error ? info.error : s.bridge.status === "ready" ? "reading..." : "needs REDbridge"]
  ];
  if (e.kind === "mesh") lines.push(["Solid", info?.hasCollision === true ? "yes: it has collision" : info?.hasCollision === false ? "no: it has no collision data" : "not known yet"]);
  if (e.kind === "entity" && parts) lines.push(["Draws", `${parts.length} mesh${parts.length === 1 ? "" : "es"}${parts.length >= 16 ? " (the first 16 shown)" : ""}`]);
  if (e.kind === "npc" && e.template) lines.push(["Template", e.template]);
  if (e.size) lines.push(["File", `${(e.size / 1024).toFixed(e.size < 10240 ? 1 : 0)} KB`]);
  if (e.source) lines.push(["Archive", e.source.file]);
  $("exProps").innerHTML = lines.map(([k, v2]) => `<div class="prop"><span class="k">${esc(k)}</span><span class="v">${esc(v2)}</span></div>`).join("");
  const apps = info?.appearances ?? [];
  const list = $("exAppearances");
  if (apps.length > 1) {
    if (!appearance || !apps.includes(appearance)) appearance = apps[0];
    list.innerHTML = apps.map((a) => `<rn-item value="${esc(a)}"${a === appearance ? " selected" : ""}>${esc(a)}</rn-item>`).join("");
    list.hidden = false;
    list.style.setProperty("--rn-list-height", `${Math.min(apps.length, 4) * 35 + 2}px`);
    $("exAppLabel").hidden = false;
  } else {
    if (lookedAt === e.path) appearance = apps[0];
    list.hidden = true;
    $("exAppLabel").hidden = true;
  }
}
$("exAppearances").addEventListener("select", (e) => {
  appearance = e.detail.value;
});
$("exDrop").addEventListener("click", () => {
  if (previewWorld) {
    const p = state?.worldObjects.picked;
    if (!p?.resource || !kindOfPath(p.resource)) return;
    openLeft("none");
    startDropAtClick(p.resource, p.appearance, shortName(p.resource));
    return;
  }
  const e = exPicked;
  if (!e) return;
  if (objectPreview && objectLike) {
    const o = objectLike;
    const like = { scale: o.transform.scale, solid: o.solid, streaming: o.streaming, props: o.props };
    openLeft("none");
    startDropAtClick(e.path, appearance ?? o.appearance, `a copy of ${o.id}`, like);
    return;
  }
  openLeft("none");
  startDropAtClick(e.path, appearance, labelOf(e));
});
function previewObject(o) {
  const path = o.resource ?? o.record;
  if (!path) return;
  objectPreview = true;
  objectLike = o;
  exPicked = { path, kind: o.kind === "npc" ? "npc" : o.kind === "entity" ? "entity" : "mesh", size: 0, appearance: o.appearance };
  appearance = o.appearance;
  if (o.kind !== "npc") post({ type: "look", path });
}
function modelCame(m) {
  if (m.error) exErrors.set(m.path, m.error);
  if (exPicked?.path === m.path && !exView) void showExView(m.path);
  if (m.parts && edgesWanted === m.path) void makeEdges(m.path);
}
var edgeCache = /* @__PURE__ */ new Map();
var edgesWanted = "";
function edgesFor(path) {
  const got = edgeCache.get(path);
  if (got !== void 0) return got ?? void 0;
  if (edgesWanted !== path) {
    edgesWanted = path;
    if (!kindOfPath(path)) return void 0;
    if (models.has(path)) void makeEdges(path);
    else post({ type: "preview.ask", paths: [path], glb: true });
  }
  return void 0;
}
async function makeEdges(path) {
  await loadPreviews();
  const parts = models.get(path);
  if (!previews || !parts || edgeCache.has(path)) return;
  try {
    const lines = await previews.edges(parts, 8e3) ?? null;
    edgeCache.set(path, lines);
    post({ type: "log", text: `Drop at click's outline for ${shortName(path)}: ${lines ? `${(lines.length / 6).toLocaleString()} edges` : "too many edges, its box instead"}` });
  } catch {
    edgeCache.set(path, null);
  }
  while (edgeCache.size > 20) edgeCache.delete(edgeCache.keys().next().value);
}
function status(text) {
  $("message").textContent = text;
  $("message").className = "message warn";
}
var showSceneTab = () => document.getElementById("mainTabs").select?.(1);
var viewport = new Viewport($("view"), {
  pick(id, opts, ray) {
    if (!state) return;
    const ids = pickSelection(id, state.selected, state.scene.objects, state.scene.groups, opts);
    post({ type: "select", ids });
    if (ids.length) showSceneTab();
    else if (ray) {
      worldClickAt = performance.now();
      pickWaitFrom = state.worldObjects.picks ?? 0;
      viewport.setWorking(worldClickAt);
      post({ type: "world.pick", origin: ray.o, dir: ray.d, free: freePick });
    }
  },
  pickBox(found, opts) {
    if (!state) return;
    const ids = pickMany(found, state.selected, state.scene.objects, state.scene.groups, opts);
    post({ type: "select", ids });
    if (ids.length) showSceneTab();
  },
  commit: (items, merge) => post({ type: "transform", items, merge }),
  // Delete: the scene's selected objects, else the game's own object picked (Remove from world).
  remove: (ids) => ids.length ? post({ type: "delete", ids }) : state?.worldObjects.picked && !state.worldObjects.picked.removedBy ? post({ type: "world.remove" }) : void 0,
  floor: (ids) => post({ type: "floor", ids }),
  undo: () => post({ type: "undo" }),
  log: (text) => post({ type: "log", text }),
  builderStart: (pose) => post({ type: "builder.start", pose }),
  builderStop: () => post({ type: "builder.stop" }),
  probe: (seq, ray) => post({ type: "drop.probe", seq, origin: ray.o, dir: ray.d }),
  hoverWorld: (ray) => {
    if (!freePick && !hoverSent) return;
    hoverSent = !!(freePick && ray);
    post({ type: "world.hoverRay", ray: freePick && ray ? { origin: ray.o, dir: ray.d } : null, free: true });
  },
  status(text) {
    $("message").textContent = text;
    $("message").className = "message warn";
  }
});
window.addEventListener("keydown", (e) => {
  if (!e.ctrlKey || e.altKey || e.metaKey) return;
  const tag = document.activeElement?.tagName;
  if (tag === "INPUT" || tag === "RN-INPUT" || viewport.busy) return;
  const key = e.key.toLowerCase();
  const ids = selection();
  if (key === "z" && !e.shiftKey) post({ type: "undo" });
  else if (key === "y" || key === "z" && e.shiftKey) post({ type: "redo" });
  else if (key === "a" && !e.shiftKey && state) post({ type: "select", ids: state.scene.objects.map((o) => o.id) });
  else if (key === "d") duplicate();
  else if (key === "c" && ids.length) post({ type: "copy", ids });
  else if (key === "x" && ids.length) post({ type: "cut", ids });
  else if (key === "v") {
    const ray = viewport.cursorRay();
    dropAsked = true;
    post({ type: "paste", at: ray ? { origin: ray.o, dir: ray.d } : void 0 });
  } else if (key === "g" && ids.length) post({ type: e.shiftKey ? "ungroup" : "group", ids });
  else if (key === "s" && e.shiftKey) state && toLibrary(`${state.scene.name} copy`);
  else if (key === "s") post({ type: "scene.save" });
  else return;
  e.preventDefault();
});
for (const id of ["editorCamera", "hideHud"]) {
  $(id).addEventListener("change", (e) => post({ type: "settings", [id]: !!e.detail.checked }));
}
$("edit").addEventListener("change", (e) => viewport.setEdit(!!e.detail.checked));
$("solid").addEventListener("change", (e) => {
  if (!state) return;
  const ids = state.scene.objects.filter((o) => o.kind === "mesh" && state.selected.includes(o.id)).map((o) => o.id);
  post({ type: "solid", ids, on: !!e.detail.checked });
});
$("rebuild").addEventListener("click", () => post({ type: "rebuild" }));
$("clear").addEventListener("click", () => post({ type: "clear" }));
$("buildIndex").addEventListener("click", () => post({ type: "index.build" }));
$("restartBridge").addEventListener("click", () => post({ type: "bridge.restart" }));
$("saveSettings").addEventListener(
  "click",
  () => post({ type: "settings", bridgePath: $("bridgePath").value?.trim() || void 0, gameDir: $("gameDir").value?.trim() || void 0 })
);
$("help").innerHTML = help_default;
channel.on((m) => {
  if (m?.type === "state" && m.state) render(m.state);
  else if (m?.type === "preview") void previewCame(m).then(() => modelCame(m));
  else if (m?.type === "explore") explorerCame(m);
  else if (m?.type === "files") filesCame(m);
  else if (m?.type === "probe") viewport.setProbe(m);
});
post({ type: "hello" });
