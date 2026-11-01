// The editor page: shows the mod's state and sends requests. No truth lives here.
import { channel } from "rednode";
import { applyChange, boxOf, centreOf, membersOf, pickMany, pickSelection, selectionUnits } from "../arrange";
import { AXES, qAxisAngle, qMul, qNorm, qYaw, sub, type Q, type V3 } from "../math";
import type { AssetEntry, AssetFrom, AssetKind, PageMessage, SceneObject, SceneTransform, Snapshot } from "../protocol";
import { held } from "./held";
import { Viewport } from "./viewport";

declare const RednodeUI: { notify(text: string, options?: Record<string, unknown>): void } | undefined;

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const post = (m: PageMessage) => channel.post(m);
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const shortName = (p: string) => p.slice(p.lastIndexOf("\\") + 1);

let state: Snapshot | undefined;
let kind: AssetKind | "all" = "all";
let from: AssetFrom = "all";
let lookedAt: string | undefined;
let appearance: string | undefined;
let lastMessage = "";
/** Groups closed in the Scene list (open by default). */
const closed = new Set<string>();
/** Ctrl+D with Edit on: the copies follow the mouse once the mod has made them. */
let copyAsked = false;
let lastCopy: number | undefined;

// ---- rendering --------------------------------------------------------------------------------

function render(s: Snapshot): void {
  state = s;
  // Status strip.
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

  // Assets.
  const list = $("results");
  const keep = lookedAt;
  list.innerHTML = s.results
    .map((r) => `<rn-item value="${esc(r.path)}" title="${esc(rowTitle(r))}"${r.path === keep ? " selected" : ""}>${esc(shortName(r.path))}<span slot="end">${esc(rowTag(r))}</span></rn-item>`)
    .join("");
  const total = s.index.count + s.sources.mods.assets + (s.sources.project?.assets ?? 0);
  const listsAll = s.query.from === "mods" || s.query.from === "project";
  $("count").textContent =
    s.index.status === "ready" || s.results.length
      ? s.query.text || listsAll
        ? foundText(s)
        : `${total.toLocaleString()} assets: type a name to search`
      : "";
  const mods = s.sources.mods;
  const project = s.sources.project;
  $("sources").textContent = [
    mods.reading ? `Mods: ${mods.reading}` : `Mods: ${mods.assets.toLocaleString()} in ${mods.archives} archive${mods.archives === 1 ? "" : "s"}`,
    project ? `Project ${project.name}: ${project.assets}` : "No REDcode project open",
  ].join("  |  ");
  $("sources").title = project ? project.archive : "Open a project in REDcode (0.10.5 or later) to list its meshes and entities here.";
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

  // Scene.
  $("objects").innerHTML = sceneRows(s);
  const groupCount = s.scene.groups.length;
  $("sceneCount").textContent = `${s.scene.objects.length} object${s.scene.objects.length === 1 ? "" : "s"}${groupCount ? `, ${groupCount} group${groupCount === 1 ? "" : "s"}` : ""}${s.selected.length > 1 ? `; ${s.selected.length} selected` : ""}`;
  $("needs").textContent = s.scene.needs.length ? `This scene needs: ${s.scene.needs.join(", ")}` : "";
  const sel = s.scene.objects.filter((o) => s.selected.includes(o.id));
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
  viewport.setCamera(s.camera?.entityId);
  // A duplicate asked for with Edit on: its copies are selected now, and follow the mouse.
  if (lastCopy === undefined) lastCopy = s.duplicated?.seq ?? 0;
  if (s.duplicated && s.duplicated.seq !== lastCopy) {
    lastCopy = s.duplicated.seq;
    if (copyAsked) viewport.moveCopies();
    copyAsked = false;
  }
  const missing = s.scene.objects.some((o) => !o.entityId && o.kind !== "light");
  $("rebuild").toggleAttribute("disabled", !missing);

  // Settings.
  if (document.activeElement?.id !== "bridgePath") ($("bridgePath") as HTMLInputElement & { value: string }).value = s.settings.bridgePath ?? "";
  if (document.activeElement?.id !== "gameDir") ($("gameDir") as HTMLInputElement & { value: string }).value = s.settings.gameDir ?? "";
  // Empty means found automatically: the field shows what was found.
  $("bridgePath").setAttribute("placeholder", s.inUse.bridge ? `Automatic: ${s.inUse.bridge}` : "Empty: the copy EDGEdeck fetched");
  $("gameDir").setAttribute("placeholder", s.inUse.gameDir ? `Automatic: ${s.inUse.gameDir}` : "Empty: found from where REDnode runs");
  ($("editorCamera") as HTMLElement & { checked: boolean }).checked = s.settings.editorCamera !== false;
  ($("hideHud") as HTMLElement & { checked: boolean }).checked = s.settings.hideHud !== false;
  $("settingsFile").textContent = s.settings.settingsFile;
  $("bridgeDetail").textContent = [b.path, b.detail].filter(Boolean).join("\n");
  $("indexDetail").textContent = ix.file ?? "";

  // Message.
  if (s.message && s.message.text !== lastMessage) {
    lastMessage = s.message.text;
    $("message").textContent = s.message.text;
    $("message").className = `message ${s.message.tone}`;
    if (s.message.tone === "error" && typeof RednodeUI !== "undefined") RednodeUI.notify(s.message.text, { title: "EDGEbuilder", type: "error" });
  }
}

/** The count in the kind's own word, so an empty list says why: `0 entities found`, `1 mesh found for "katana"`. The tab says where. */
function foundText(s: Snapshot): string {
  const n = s.results.length;
  const q = s.query;
  const [one, many] = q.kind === "mesh" ? ["mesh", "meshes"] : q.kind === "entity" ? ["entity", "entities"] : ["asset", "assets"];
  return `${n}${n >= 120 ? "+" : ""} ${n === 1 ? one : many} found${q.text ? ` for "${q.text}"` : ""}`;
}

/** The tag at a result's end: the mod or project it comes from, and its kind. */
function rowTag(r: AssetEntry): string {
  const where = r.source ? (r.source.kind === "project" ? `project ${r.source.name}` : r.source.name) : r.path.toLowerCase().startsWith("ep1\\") ? "PL" : "";
  return [where, r.replaces ? "changes a game file" : "", r.kind].filter(Boolean).join(" ");
}

function rowTitle(r: AssetEntry): string {
  return r.source ? `${r.path}\n${r.source.file}` : r.path;
}

/** The Scene list as a tree: each group (with an arrow to open or close it), then its objects, indented. */
function sceneRows(s: Snapshot): string {
  const { objects, groups } = s.scene;
  const rows: string[] = [];
  const pad = (depth: number) => ` style="padding-left:${12 + depth * 18}px"`;
  const walk = (parent: string | null, depth: number) => {
    for (const g of groups.filter((x) => x.parent === parent)) {
      const members = membersOf(g.id, objects, groups);
      const all = members.length > 0 && members.every((o) => s.selected.includes(o.id));
      rows.push(
        `<rn-item value="g:${esc(g.id)}"${all ? " selected" : ""}${pad(depth)}><span class="fold" data-group="${esc(g.id)}">${closed.has(g.id) ? "▸" : "▾"}</span>${esc(g.name)}<span slot="end">group of ${members.length}</span></rn-item>`,
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

type Field = HTMLElement & { value: string };
const fields = ["px", "py", "pz", "yaw", "scale"] as const;
const field = (id: (typeof fields)[number]) => $<Field>(id);

/** The Selected panel: one object's numbers, or for several their middle, a turn and a factor. */
function renderSelected(sel: SceneObject[], s: Snapshot): void {
  const focused = document.activeElement?.id;
  const units = selectionUnits(s.selected, s.scene.objects, s.scene.groups);
  const oneGroup = units.groups.length === 1 && !units.objects.length ? s.scene.groups.find((g) => g.id === units.groups[0]) : undefined;
  const groupName = $<Field>("groupName");
  groupName.hidden = !oneGroup;
  groupName.dataset.group = oneGroup?.id ?? "";
  if (oneGroup && focused !== "groupName") groupName.value = oneGroup.name;
  field("yaw").setAttribute("label", sel.length > 1 ? "Turn by" : "Heading");
  field("scale").setAttribute("label", sel.length > 1 ? "Scale by" : "Scale");
  if (sel.length > 1) {
    const c = centreOf(sel.map((o) => o.transform));
    const values: Record<(typeof fields)[number], string> = { px: c[0].toFixed(2), py: c[1].toFixed(2), pz: c[2].toFixed(2), yaw: "0", scale: "1" };
    for (const f of fields) if (focused !== f) field(f).value = values[f];
    field("scale").toggleAttribute("disabled", sel.some((o) => o.kind !== "mesh"));
    const shown = sel.filter((o) => o.entityId).length;
    $("selected").textContent = `${oneGroup ? `${oneGroup.name}: ` : ""}${sel.length} objects\nmiddle at ${c.map((n) => n.toFixed(2)).join(", ")}${shown < sel.length ? `\n${sel.length - shown} not in the world` : ""}`;
    return;
  }
  const o = sel[0];
  if (o) {
    const values: Record<(typeof fields)[number], string> = {
      px: o.transform.position[0].toFixed(2),
      py: o.transform.position[1].toFixed(2),
      pz: o.transform.position[2].toFixed(2),
      yaw: qYaw(o.transform.rotation as Q).toFixed(1),
      scale: o.transform.scale[0].toFixed(2),
    };
    for (const f of fields) if (focused !== f) field(f).value = values[f];
    field("scale").toggleAttribute("disabled", o.kind !== "mesh");
  }
  if (!o) {
    $("selected").textContent = "Nothing selected";
    return;
  }
  const [x, y, z] = o.transform.position;
  $("selected").textContent = `${oneGroup ? `${oneGroup.name}: ` : ""}${o.id}\n${o.resource ?? o.kind}\n${o.appearance ? `appearance ${o.appearance}\n` : ""}at ${x.toFixed(2)}, ${y.toFixed(2)}, ${z.toFixed(2)}${o.entityId ? `\nentity ${o.entityId}` : "\nnot in the world"}`;
}

// ---- wiring -----------------------------------------------------------------------------------

let searchTimer: ReturnType<typeof setTimeout> | undefined;
function search(): void {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => post({ type: "search", text: ($("search") as HTMLInputElement & { value: string }).value ?? "", kind, from }), 120);
}

$("search").addEventListener("input", search);

// Typing on the Assets tab searches, wherever the focus is in the window. A key pressed after a
// click in the world is the viewport's (G, R, S and the camera keys).
let lastDownInWorld = false;
window.addEventListener("pointerdown", (e) => (lastDownInWorld = e.target === $("view")), true);
window.addEventListener(
  "keydown",
  (e) => {
    if (e.key.length !== 1 || e.ctrlKey || e.altKey || e.metaKey) return;
    const tag = document.activeElement?.tagName;
    if (tag === "INPUT" || tag === "RN-INPUT") return;
    if (lastDownInWorld && ($("edit") as HTMLElement & { checked: boolean }).checked) return;
    if (!document.querySelector("#mainTabs > rn-tab")?.hasAttribute("active")) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const box = $("search") as HTMLElement & { value: string; focus(): void };
    box.focus();
    box.value = (box.value ?? "") + e.key;
    search();
  },
  true,
);
$("kinds").addEventListener("change", (e) => {
  kind = (["all", "mesh", "entity"] as const)[(e as CustomEvent<{ index: number }>).detail.index] ?? "all";
  search();
});
$("from").addEventListener("change", (e) => {
  from = (["all", "game", "mods", "project"] as const)[(e as CustomEvent<{ index: number }>).detail.index] ?? "all";
  search();
});
$("results").addEventListener("select", (e) => {
  lookedAt = (e as CustomEvent<{ value: string }>).detail.value;
  appearance = undefined;
  post({ type: "look", path: lookedAt });
  if (state) render(state);
});
$("appearances").addEventListener("select", (e) => {
  appearance = (e as CustomEvent<{ value: string }>).detail.value;
});
$("drop").addEventListener("click", () => {
  if (lookedAt) post({ type: "drop", path: lookedAt, appearance });
});
// Drop at click: Edit goes on if it is off, and the next click in the world says where.
$("dropClick").addEventListener("click", () => {
  const path = lookedAt;
  const looks = appearance;
  if (!path) return;
  const edit = $("edit") as HTMLElement & { checked: boolean };
  if (!edit.checked) {
    edit.checked = true;
    viewport.setEdit(true);
  }
  viewport.armDrop((ray) => post({ type: "drop", path, appearance: looks, at: { origin: ray.o, dir: ray.d } }));
  $("message").textContent = `Click where ${shortName(path)} should go; Esc cancels.`;
  $("message").className = "message";
});
// The Scene list: a group's arrow opens or closes it; a group's row selects the group, an object's
// row that object; Ctrl adds to the selection or takes out.
let listCtrl = false;
$("objects").addEventListener(
  "click",
  (e) => {
    listCtrl = held(e).ctrl;
    const fold = (e.target as HTMLElement).closest?.(".fold") as HTMLElement | null;
    if (!fold) return;
    e.stopPropagation();
    const g = fold.dataset.group!;
    if (closed.has(g)) closed.delete(g);
    else closed.add(g);
    if (state) render(state);
  },
  true,
);
$("objects").addEventListener("keydown", () => (listCtrl = false), true);
$("objects").addEventListener("select", (e) => {
  if (!state) return;
  const value = (e as CustomEvent<{ value: string }>).detail.value;
  const { objects, groups } = state.scene;
  const ids = value.startsWith("g:") ? membersOf(value.slice(2), objects, groups).map((o) => o.id) : [value.slice(2)];
  const all = ids.every((id) => state!.selected.includes(id));
  const next = !listCtrl ? ids : all ? state.selected.filter((id) => !ids.includes(id)) : [...state.selected, ...ids];
  post({ type: "select", ids: next });
});
const selection = () => state?.selected ?? [];
$("delete").addEventListener("click", () => selection().length && post({ type: "delete", ids: selection() }));
$("floor").addEventListener("click", () => selection().length && post({ type: "floor", ids: selection() }));
$("undo").addEventListener("click", () => post({ type: "undo" }));
$("redo").addEventListener("click", () => post({ type: "redo" }));
$("group").addEventListener("click", () => selection().length && post({ type: "group", ids: selection() }));
$("ungroup").addEventListener("click", () => selection().length && post({ type: "ungroup", ids: selection() }));
$("duplicate").addEventListener("click", () => duplicate());
$("groupName").addEventListener("submit", () => {
  const g = $<Field>("groupName");
  if (g.dataset.group) post({ type: "rename", group: g.dataset.group, name: g.value ?? "" });
});

/**
 * Copies the selection. With Edit on the copies follow the mouse until a click places them; with
 * Edit off they go beside the originals, the selection's width to the east.
 */
function duplicate(): void {
  if (!state || !state.selected.length) return;
  if (viewport.canDrag) {
    copyAsked = true;
    post({ type: "duplicate", ids: state.selected });
  } else {
    const b = boxOf(state.scene.objects.filter((o) => state!.selected.includes(o.id)));
    const width = b ? b.max[0] - b.min[0] : 1;
    post({ type: "duplicate", ids: state.selected, offset: [width + 0.5, 0, 0] });
  }
}

/**
 * The numbers in the Selected panel. One object: position, a new heading, a uniform scale for meshes.
 * Several: their middle moves to X, Y, Z; Turn by turns them around it; Scale by scales them from it.
 */
function applyFields(): void {
  const sel = state?.scene.objects.filter((x) => state!.selected.includes(x.id)) ?? [];
  if (!sel.length) return;
  const num = (f: (typeof fields)[number], fallback: number) => {
    const n = Number(field(f).value);
    return Number.isFinite(n) ? n : fallback;
  };
  if (sel.length > 1) {
    const c = centreOf(sel.map((o) => o.transform));
    const to: V3 = [num("px", c[0]), num("py", c[1]), num("pz", c[2])];
    const turn = num("yaw", 0);
    const f = sel.every((o) => o.kind === "mesh") ? num("scale", 1) || 1 : 1;
    const change = { move: sub(to, c), turn: Math.abs(turn) > 1e-3 ? qAxisAngle(AXES.z, turn) : undefined, scale: f !== 1 ? ([f, f, f] as V3) : undefined };
    post({ type: "transform", items: sel.map((o) => ({ id: o.id, transform: applyChange(o.transform, change, c) })) });
    return;
  }
  const o = sel[0];
  const t = o.transform;
  const yawNow = qYaw(t.rotation as Q);
  const turn = num("yaw", yawNow) - yawNow;
  const s = o.kind === "mesh" ? num("scale", t.scale[0]) || t.scale[0] : 1;
  const next: SceneTransform = {
    position: [num("px", t.position[0]), num("py", t.position[1]), num("pz", t.position[2])],
    rotation: Math.abs(turn) > 1e-3 ? qNorm(qMul(qAxisAngle(AXES.z, turn), t.rotation as Q)) : t.rotation,
    scale: o.kind === "mesh" ? [s, s, s] : t.scale,
  };
  post({ type: "transform", items: [{ id: o.id, transform: next }] });
}
$("apply").addEventListener("click", applyFields);
for (const f of fields) field(f).addEventListener("submit", applyFields);

// ---- the viewport ------------------------------------------------------------------------------

const showSceneTab = () => (document.getElementById("mainTabs") as HTMLElement & { select?(i: number): void }).select?.(1);
const viewport = new Viewport($<HTMLCanvasElement>("view"), {
  pick(id, opts) {
    if (!state) return;
    const ids = pickSelection(id, state.selected, state.scene.objects, state.scene.groups, opts);
    post({ type: "select", ids });
    if (ids.length) showSceneTab();
  },
  pickBox(found, opts) {
    if (!state) return;
    const ids = pickMany(found, state.selected, state.scene.objects, state.scene.groups, opts);
    post({ type: "select", ids });
    if (ids.length) showSceneTab();
  },
  commit: (items, merge) => post({ type: "transform", items, merge }),
  remove: (ids) => post({ type: "delete", ids }),
  floor: (ids) => post({ type: "floor", ids }),
  undo: () => post({ type: "undo" }),
  log: (text) => post({ type: "log", text }),
  builderStart: (pose) => post({ type: "builder.start", pose }),
  builderStop: () => post({ type: "builder.stop" }),
  status(text) {
    $("message").textContent = text;
    $("message").className = "message warn";
  },
});
// Undo, redo, copy and group: Ctrl+Z, Ctrl+Y (or Ctrl+Shift+Z), Ctrl+D, Ctrl+G, Ctrl+Shift+G. Not while
// typing in a field (the field undoes its own text), and not in the middle of a drag or a box.
window.addEventListener("keydown", (e) => {
  if (!e.ctrlKey || e.altKey || e.metaKey) return;
  const tag = document.activeElement?.tagName;
  if (tag === "INPUT" || tag === "RN-INPUT" || viewport.busy) return;
  const key = e.key.toLowerCase();
  const ids = selection();
  if (key === "z" && !e.shiftKey) post({ type: "undo" });
  else if (key === "y" || (key === "z" && e.shiftKey)) post({ type: "redo" });
  else if (key === "d") duplicate();
  else if (key === "g" && ids.length) post({ type: e.shiftKey ? "ungroup" : "group", ids });
  else return;
  e.preventDefault();
});
for (const id of ["editorCamera", "hideHud"] as const) {
  $(id).addEventListener("change", (e) => post({ type: "settings", [id]: !!(e as CustomEvent<{ checked: boolean }>).detail.checked }));
}
$("edit").addEventListener("change", (e) => viewport.setEdit(!!(e as CustomEvent<{ checked: boolean }>).detail.checked));
$("rebuild").addEventListener("click", () => post({ type: "rebuild" }));
$("clear").addEventListener("click", () => post({ type: "clear" }));
$("buildIndex").addEventListener("click", () => post({ type: "index.build" }));
$("restartBridge").addEventListener("click", () => post({ type: "bridge.restart" }));
$("saveSettings").addEventListener("click", () =>
  post({ type: "settings", bridgePath: ($("bridgePath") as HTMLInputElement & { value: string }).value?.trim() || undefined, gameDir: ($("gameDir") as HTMLInputElement & { value: string }).value?.trim() || undefined }),
);

channel.on<{ type: string; state?: Snapshot }>((m) => {
  if (m?.type === "state" && m.state) render(m.state);
});
post({ type: "hello" });
