// The editor page: shows the mod's state and sends requests. No truth lives here.
import { channel } from "rednode";
import { applyChange, boxOf, centreOf, collisionKey, membersOf, pickMany, pickSelection, selectionUnits } from "../arrange";
import { AXES, qAxisAngle, qMul, qNorm, qYaw, sub, type Q, type V3 } from "../math";
import type { AssetEntry, AssetFrom, AssetKind, PageMessage, Place, SceneEntry, SceneObject, SceneTransform, Snapshot } from "../protocol";
import { held } from "./held";
import { Viewport, busyText } from "./viewport";

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

// A drop or a paste selects what it placed; the page then shows the Scene tab, where the Selected panel
// is, as a click in the world does (B3-1 test: after Drop at click the panel stayed out of sight).
let dropAsked = false;
let knownIds = new Set<string>();

let busyNow: Snapshot["busy"];
let busyTick: ReturnType<typeof setInterval> | undefined;
function renderBusy(b: Snapshot["busy"]): void {
  busyNow = b;
  viewport.setBusy(b);
  const row = $("busyRow");
  row.hidden = !b;
  if (!b) {
    if (busyTick) clearInterval(busyTick);
    busyTick = undefined;
    return;
  }
  const bar = $("busy");
  if (b.total) {
    bar.setAttribute("max", String(b.total));
    bar.setAttribute("value", String(b.done ?? 0));
  } else bar.removeAttribute("value");
  const label = () => busyNow && bar.setAttribute("label", `Busy: ${busyText(busyNow)}`);
  label();
  busyTick ??= setInterval(label, 1000);
}

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

  // Scenes and the Library (B3-2).
  renderLibrary(s);
  renderBake(s);

  // Busy: a change that takes a while, and the ones waiting behind it.
  renderBusy(s.busy);

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
/** The Solid switch, for the meshes selected: on when all that can be solid are. */
function renderSolid(sel: SceneObject[], s: Snapshot): void {
  const meshes = sel.filter((o) => o.kind === "mesh");
  $("solidRow").hidden = !meshes.length;
  if (!meshes.length) return;
  const none = new Set(s.noCollision);
  const able = meshes.filter((o) => !none.has(collisionKey(o.resource)));
  const solid = able.filter((o) => o.solid).length;
  const toggle = $("solid") as HTMLElement & { checked: boolean };
  toggle.checked = able.length > 0 && solid === able.length;
  toggle.toggleAttribute("disabled", !able.length);
  const cannot = meshes.length - able.length;
  const lines: string[] = [];
  if (meshes.length > 1 && solid && solid < able.length) lines.push(`${solid} of ${able.length} solid.`);
  if (cannot) lines.push(meshes.length === 1 ? "No collision data, so this mesh can't be solid." : cannot === 1 ? "1 of these has no collision data, so it can't be solid." : `${cannot} of these have no collision data, so they can't be solid.`);
  $("solidNote").textContent = lines.join(" ");
}

function renderSelected(sel: SceneObject[], s: Snapshot): void {
  renderSolid(sel, s);
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
    // Hidden, not disabled: the kit's rn-input does not read `disabled`.
    field("scale").hidden = sel.some((o) => o.kind !== "mesh");
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
    field("scale").hidden = o.kind !== "mesh";
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
  if (lookedAt) {
    dropAsked = true;
    post({ type: "drop", path: lookedAt, appearance });
  }
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
  viewport.armDrop((ray) => {
    dropAsked = true;
    post({ type: "drop", path, appearance: looks, at: { origin: ray.o, dir: ray.d } });
  });
  $("message").textContent = `Click where ${shortName(path)} should go; Esc or right-click cancels.`;
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
$("stop").addEventListener("click", () => post({ type: "stop" }));
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
// Enter applies and leaves the field, so a Ctrl+Z next undoes the change, not the field's text.
for (const f of fields)
  field(f).addEventListener("submit", () => {
    applyFields();
    (document.activeElement as HTMLElement | null)?.blur();
  });

// ---- scenes and the Library (B3-2) -------------------------------------------------------------------
//
// The Library tab: the three places (Library, the REDcode project, This PC) as one tree of folders and
// scenes. What is picked there says which scene Open and Show act on, and which folder New, Save as and
// New folder use.

type Picked = { kind: "scene"; file: string } | { kind: "folder"; place: Place; folder: string };
let picked: Picked | undefined;
/** Folders closed in the tree, as `place|folder` (open by default). */
const closedFolders = new Set<string>();
const TabLabels = { scene: 1, library: 2 } as const;

const parentOf = (folder: string) => (folder.includes("/") ? folder.slice(0, folder.lastIndexOf("/")) : "");
const lastPart = (folder: string) => folder.slice(folder.lastIndexOf("/") + 1);
const sameFile = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

function placeLabel(s: Snapshot, place: Place | undefined): string {
  return s.library.shelves.find((sh) => sh.place === place)?.label ?? "";
}

/** "Library > Alleys > Kabuki", "This PC". */
function whereLabel(s: Snapshot, place: Place | undefined, folder: string | undefined): string {
  const label = placeLabel(s, place);
  if (!label) return "";
  return folder ? `${label} > ${folder.replace(/\//g, " > ")}` : label;
}

function findScene(s: Snapshot, file: string): SceneEntry | undefined {
  for (const sh of s.library.shelves) for (const sc of sh.scenes) if (sameFile(sc.file, file)) return sc;
  return undefined;
}

/** Where New, Save as and New folder go: the picked folder, the picked scene's folder, else the Library (or This PC). */
function target(s: Snapshot): { place: Place; folder: string } {
  const p = picked;
  if (p?.kind === "folder" && s.library.shelves.some((sh) => sh.place === p.place)) return { place: p.place, folder: p.folder };
  if (picked?.kind === "scene") {
    const sc = findScene(s, picked.file);
    if (sc) return { place: sc.place, folder: sc.folder };
  }
  return { place: s.library.root ? "library" : "data", folder: "" };
}

const when = (ms: number) => {
  const d = new Date(ms);
  return `${d.toLocaleDateString(undefined, { day: "numeric", month: "short" })} ${d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`;
};

function libraryRows(s: Snapshot): string {
  const rows: string[] = [];
  const pad = (depth: number) => ` style="padding-left:${12 + depth * 18}px"`;
  const isOn = (file: string) => s.library.on.some((f) => sameFile(f, file));
  const isPicked = (v: Picked) => !!picked && JSON.stringify(picked) === JSON.stringify(v);
  for (const sh of s.library.shelves) {
    const walk = (folder: string, depth: number) => {
      for (const f of sh.folders.filter((x) => parentOf(x) === folder)) {
        const key = `${sh.place}|${f}`;
        rows.push(
          `<rn-item value="d:${esc(key)}"${isPicked({ kind: "folder", place: sh.place, folder: f }) ? " selected" : ""}${pad(depth)}><span class="fold" data-folder="${esc(key)}">${closedFolders.has(key) ? "▸" : "▾"}</span>${esc(lastPart(f))}</rn-item>`,
        );
        if (!closedFolders.has(key)) walk(f, depth + 1);
      }
      for (const sc of sh.scenes.filter((x) => x.folder === folder)) {
        const open = sameFile(sc.file, s.scene.file ?? "");
        const tags = `${open ? '<span class="tag">open</span>' : ""}${isOn(sc.file) ? '<span class="tag">shown</span>' : ""}`;
        const end = sc.error ? "cannot be read" : `${open ? s.scene.objects.length : sc.objects} obj · ${when(sc.changed)}`;
        rows.push(
          `<rn-item value="f:${esc(sc.file)}" title="${esc(sc.error ? `${sc.file}\n${sc.error}` : sc.file)}"${isPicked({ kind: "scene", file: sc.file }) ? " selected" : ""}${pad(depth)}><span class="fold"></span>${esc(sc.name)}${tags}<span slot="end">${esc(end)}</span></rn-item>`,
        );
      }
    };
    const key = `${sh.place}|`;
    rows.push(
      `<rn-item value="d:${esc(key)}" title="${esc(sh.dir)}"${isPicked({ kind: "folder", place: sh.place, folder: "" }) ? " selected" : ""}${pad(0)}><span class="fold" data-folder="${esc(key)}">${closedFolders.has(key) ? "▸" : "▾"}</span><span class="section">${esc(sh.label)}</span><span slot="end">${sh.scenes.length} scene${sh.scenes.length === 1 ? "" : "s"}</span></rn-item>`,
    );
    if (!closedFolders.has(key)) walk("", 1);
  }
  return rows.join("");
}

let bakeHtml = "";
let bakeConfirm: string | undefined;

function renderBake(s: Snapshot): void {
  const b = s.bake;
  const n = s.scene.objects.length;
  $("bakeWhat").textContent = s.scene.file ? `${s.scene.name}: ${n} object${n === 1 ? "" : "s"}` : "No scene open";
  $("bakeInto").textContent = b.project ? `Into the REDcode project ${b.project.name}` : "";
  $("bakeInto").title = b.project?.dir ?? "";
  const checks = b.checks.map((c) => `<div class="check ${c.tone}">${esc(c.text)}</div>`).join("");
  if ($("bakeChecks").innerHTML !== checks) $("bakeChecks").innerHTML = checks;
  const when = (iso?: string) => (iso ? new Date(iso).toLocaleString() : "");
  const lines: string[] = [];
  if (b.current) lines.push(`Baked ${when(b.current.date)}${b.current.objects === undefined ? "" : `, ${b.current.objects} object${b.current.objects === 1 ? "" : "s"}`}.${b.stale ? " The scene changed since: bake again to bring it in." : ""}`);
  if (b.inGame) lines.push(`Its bake is in the game (${b.inGame}), so its previews stay off and nothing stands twice. Rebuild previews on the Scene tab brings them back to edit it.`);
  $("bakeState").textContent = lines.join("\n");
  $("bakeGo").toggleAttribute("disabled", b.checks.some((c) => c.tone === "error"));
  const last = b.last;
  $("bakeDone").toggleAttribute("hidden", !last);
  if (last) $("bakeFiles").textContent = [...last.files, ...last.warnings].join("\n");
  const html = b.list
    .map((r) => {
      const end =
        bakeConfirm === r.slug
          ? `<span slot="end" class="confirm">Take it out?<button data-act="yes" data-id="${esc(r.slug)}">Yes</button><button data-act="no">No</button></span>`
          : `<span slot="end"><span class="grouptag">${r.objects === undefined ? "" : `${r.objects} object${r.objects === 1 ? "" : "s"}`}</span><button class="act" data-act="trash" data-id="${esc(r.slug)}" title="Take this bake out of the project. Its scene stays">${TrashIcon}</button></span>`;
      return `<rn-item value="${esc(r.slug)}" title="${esc([r.file, when(r.date)].filter(Boolean).join("\n"))}">${esc(r.name)}${end}</rn-item>`;
    })
    .join("");
  if (html !== bakeHtml) $("bakeList").innerHTML = bakeHtml = html;
}

$("bakeGo").addEventListener("click", () => post({ type: "bake" }));
$("bakeLook").addEventListener("click", () => post({ type: "bake.refresh" }));
$("bakeList").addEventListener(
  "click",
  (e) => {
    const act = (e.target as HTMLElement).closest?.("[data-act]") as HTMLElement | null;
    if (!act) return;
    e.stopPropagation();
    const id = act.dataset.id;
    if (act.dataset.act === "trash") bakeConfirm = id;
    else {
      bakeConfirm = undefined;
      if (act.dataset.act === "yes" && id) post({ type: "bake.remove", slug: id });
    }
    if (state) render(state);
  },
  true,
);

/** A new name typed for the open scene, waiting for Rename or Keep the name. */
let renameTo: { file: string; name: string } | undefined;

function renderLibrary(s: Snapshot): void {
  // The scene at the top of the Scene tab.
  const name = $<Field>("sceneName");
  if (renameTo && renameTo.file !== s.scene.file) renameTo = undefined;
  if (document.activeElement?.id !== "sceneName" && !renameTo) name.value = s.scene.name;
  $("renameAsk").hidden = !renameTo;
  if (renameTo) {
    // Bakes go by the scene's name, so the old bake is not this scene's any more.
    const baked = s.bake.current || s.bake.inGame ? " Its bake keeps the old name: bake again and take the old bake out, or both stand in the world." : "";
    $("renameText").textContent = `Rename ${s.scene.name} to ${renameTo.name}? Its file is renamed too.${baked}`;
  }
  const where = whereLabel(s, s.scene.place, s.scene.folder);
  const noScene = !s.scene.file;
  $("sceneWhere").textContent = noScene ? "No scene is open. Open one or make one on the Library tab." : where ? `In ${where}. Saved after every change.` : `In ${s.scene.file}. Saved after every change.`;
  for (const id of ["sceneName", "saveScene", "saveAsScene", "closeScene", "saveAsHere"]) $(id).toggleAttribute("disabled", noScene);
  $("sceneWhere").title = s.scene.file ?? "";

  // The Library tab.
  const root = s.library.root;
  $("libraryInfo").textContent = root ? `Library: ${root}` : `No Library folder yet. Make one at ${s.library.suggested}, or pick another folder in Settings. Scenes can stay in the REDcode project or on This PC meanwhile.`;
  $("libraryMakeRow").hidden = !!root;
  $("libraryMake").title = s.library.suggested;
  if (picked?.kind === "scene" && !findScene(s, picked.file)) picked = undefined;
  $("shelves").innerHTML = libraryRows(s);
  const sc = picked?.kind === "scene" ? findScene(s, picked.file) : undefined;
  const open = !!sc && sameFile(sc.file, s.scene.file ?? "");
  const on = !!sc && s.library.on.some((f) => sameFile(f, sc.file));
  if (sc)
    $("pickedText").textContent = `${sc.name}${open ? " (open)" : on ? " (shown in the world)" : ""}\n${whereLabel(s, sc.place, sc.folder)}\n${sc.error ? `Cannot be read: ${sc.error}` : `${open ? s.scene.objects.length : sc.objects} objects, changed ${when(sc.changed)}`}\n${sc.file}`;
  else if (picked?.kind === "folder") $("pickedText").textContent = `Folder: ${whereLabel(s, picked.place, picked.folder)}`;
  else $("pickedText").textContent = "Pick a scene to open or show it, or a folder for a new scene. A double-click opens a scene.";
  $("pickedOpen").toggleAttribute("disabled", !sc || open || !!sc.error);
  $("pickedClose").toggleAttribute("disabled", !open);
  $("pickedOn").toggleAttribute("disabled", !sc || open || !!sc.error);
  $("pickedOn").textContent = on ? "Hide from world" : "Show in world";
  const t = target(s);
  $("newWhere").textContent = `In ${whereLabel(s, t.place, t.folder)}`;
  $("createScene").hidden = saveAsAsked;
  $("createFolder").hidden = saveAsAsked;
  $("createFolder").toggleAttribute("disabled", t.place !== "library");
  $("createFolder").title = t.place === "library" ? "A folder inside this one" : "Folders are made in the Library";

  // Settings.
  const rootField = $<Field>("libraryRoot");
  if (document.activeElement?.id !== "libraryRoot") rootField.value = root ?? "";
  rootField.setAttribute("placeholder", s.library.suggested);
}

const mainTabs = () => document.getElementById("mainTabs") as HTMLElement & { select?(i: number): void };
const newName = () => $<Field>("newName");

/** The Library tab with the name field ready: for Save as (Ctrl+Shift+S) and New. */
function toLibrary(name: string, asCopy = false): void {
  saveAsAsked = asCopy;
  mainTabs().select?.(TabLabels.library);
  const f = newName();
  f.value = name;
  (f as HTMLElement & { focus(): void }).focus();
  if (state) render(state);
}

/**
 * Save as came here (Ctrl+Shift+S or the button): only Save open scene here is offered, since New scene
 * here with the copy's name makes an empty scene (B3-2 test, step 11).
 */
let saveAsAsked = false;
function leaveSaveAs(): void {
  if (!saveAsAsked) return;
  saveAsAsked = false;
  newName().value = "";
}

$("mainTabs").addEventListener("change", (e) => {
  if (e.target !== $("mainTabs")) return;
  const label = (e as CustomEvent<{ label: string }>).detail.label;
  if (label === "Library") post({ type: "library.refresh" });
  else leaveSaveAs();
  if (label === "Bake") post({ type: "bake.refresh" });
});
$("shelves").addEventListener(
  "click",
  (e) => {
    const fold = (e.target as HTMLElement).closest?.(".fold") as HTMLElement | null;
    const key = fold?.dataset.folder;
    if (!key) return;
    e.stopPropagation();
    if (closedFolders.has(key)) closedFolders.delete(key);
    else closedFolders.add(key);
    if (state) render(state);
  },
  true,
);
$("shelves").addEventListener("select", (e) => {
  const value = (e as CustomEvent<{ value: string }>).detail.value;
  if (value.startsWith("f:")) picked = { kind: "scene", file: value.slice(2) };
  else {
    const key = value.slice(2);
    const bar = key.indexOf("|");
    picked = { kind: "folder", place: key.slice(0, bar) as Place, folder: key.slice(bar + 1) };
  }
  if (state) render(state);
});
// Two clicks on a scene's row open it. Not the browser's dblclick: the first click's select rebuilds the
// rows, so the second lands on a new element and dblclick never fires (B3-2 test).
let lastRow = { value: "", at: 0 };
$("shelves").addEventListener(
  "click",
  (e) => {
    const value = (e.target as HTMLElement).closest?.("rn-item")?.getAttribute("value") ?? "";
    const twice = value.startsWith("f:") && value === lastRow.value && performance.now() - lastRow.at < 500;
    lastRow = twice ? { value: "", at: 0 } : { value, at: performance.now() };
    if (twice && state && !sameFile(value.slice(2), state.scene.file ?? "")) post({ type: "scene.open", file: value.slice(2) });
  },
  true,
);
$("pickedClose").addEventListener("click", () => post({ type: "scene.close" }));
$("closeScene").addEventListener("click", () => post({ type: "scene.close" }));
$("pickedOpen").addEventListener("click", () => picked?.kind === "scene" && post({ type: "scene.open", file: picked.file }));
// The label flips under the cursor, so a double-click would show and hide at once: one press.
let lastShow = 0;
$("pickedOn").addEventListener("click", () => {
  if (picked?.kind !== "scene" || !state || performance.now() - lastShow < 600) return;
  lastShow = performance.now();
  const file = picked.file;
  post({ type: "scene.on", file, on: !state.library.on.some((f) => sameFile(f, file)) });
});
$("libraryRefresh").addEventListener("click", () => post({ type: "library.refresh" }));
$("libraryMake").addEventListener("click", () => state && post({ type: "library.root", root: state.library.suggested }));
$("setLibrary").addEventListener("click", () => {
  if (!state) return;
  post({ type: "library.root", root: $<Field>("libraryRoot").value?.trim() || state.library.suggested });
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
  const name = ($<Field>("sceneName").value ?? "").trim();
  renameTo = name && name !== state.scene.name ? { file: state.scene.file, name } : undefined;
  (document.activeElement as HTMLElement | null)?.blur();
  render(state);
});
// Typing again takes back the name that was asked about, until Enter asks about the new one.
$("sceneName").addEventListener("input", () => {
  if (!renameTo) return;
  renameTo = undefined;
  if (state) render(state);
});
$("renameYes").addEventListener("click", () => {
  if (!renameTo) return;
  post({ type: "scene.rename", name: renameTo.name });
  renameTo = undefined;
  if (state) render(state);
});
$("renameNo").addEventListener("click", () => {
  renameTo = undefined;
  if (state) render(state);
});
$("saveScene").addEventListener("click", () => post({ type: "scene.save" }));
$("saveAsScene").addEventListener("click", () => state && toLibrary(`${state.scene.name} copy`, true));
$("newScene").addEventListener("click", () => {
  leaveSaveAs();
  toLibrary("");
});
$("openScene").addEventListener("click", () => mainTabs().select?.(TabLabels.library));

// ---- the Objects drawer -------------------------------------------------------------------------------
//
// Every object of the picked scene (or the open one), beside the window. Two clicks on a row put the
// camera in front of the object and select it, opening its scene first when another is open. The trash
// asks, then deletes, wherever the object and the camera are.

let drawerOpen = false;
let peekAsked = "";
let confirming: string | undefined;
let lastDrawerRow = { id: "", at: 0 };
let pendingGo: { file: string; id: string } | undefined;
let drawerHtml = "";
const TrashIcon = `<svg viewBox="0 0 16 16"><path d="M2.5 4h11M6 4V2.5h4V4M4 4l.8 9.5h6.4L12 4M6.7 6.5v4.5M9.3 6.5v4.5"/></svg>`;

function drawerFile(s: Snapshot): string {
  const sc = picked?.kind === "scene" ? findScene(s, picked.file) : undefined;
  return sc && !sc.error ? sc.file : (s.scene.file ?? "");
}

function renderDrawer(s: Snapshot): void {
  if (pendingGo && sameFile(pendingGo.file, s.scene.file ?? "")) {
    const id = pendingGo.id;
    pendingGo = undefined;
    goToObject(s, id);
  }
  $("drawer").classList.toggle("open", drawerOpen);
  if (!drawerOpen) return;
  const file = drawerFile(s);
  const isOpen = sameFile(file, s.scene.file ?? "");
  const peeked = s.library.peek && sameFile(s.library.peek.file, file) ? s.library.peek : undefined;
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
  const groupName = (id: string | undefined) => shown.groups.find((g) => g.id === id)?.name;
  const html = shown.objects
    .map((o) => {
      const end =
        confirming === o.id
          ? `<span slot="end" class="confirm">${isOpen ? "Delete?" : "Delete for good?"}<button data-act="yes" data-id="${esc(o.id)}">Yes</button><button data-act="no">No</button></span>`
          : `<span slot="end">${o.group ? `<span class="grouptag">${esc(groupName(o.group) ?? "")}</span>` : ""}<button class="act" data-act="trash" data-id="${esc(o.id)}" title="Delete">${TrashIcon}</button></span>`;
      const [x, y, z] = o.transform.position.map((v) => v.toFixed(1));
      return `<rn-item value="${esc(o.id)}" title="${esc(`${o.resource}\n${x}, ${y}, ${z}`)}"${isOpen && s.selected.includes(o.id) ? " selected" : ""}>${esc(o.id)}${end}</rn-item>`;
    })
    .join("");
  if (html !== drawerHtml) $("drawerList").innerHTML = drawerHtml = html;
}

/** Edit on, the camera on its way (the page owns it), and the mod selects the object and places its preview. */
function goToObject(s: Snapshot, id: string): void {
  const o = s.scene.objects.find((x) => x.id === id);
  if (!o) return;
  if (s.world === "ready") {
    const edit = $("edit") as HTMLElement & { checked: boolean };
    if (!edit.checked) {
      edit.checked = true;
      viewport.setEdit(true);
    }
    if (s.settings.editorCamera !== false) viewport.flyTo(o);
  }
  post({ type: "scene.goTo", id });
}

$("pickedObjects").addEventListener("click", () => {
  drawerOpen = !drawerOpen;
  peekAsked = "";
  confirming = undefined;
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
    const target = e.target as HTMLElement;
    const act = target.closest?.("[data-act]") as HTMLElement | null;
    if (act) {
      e.stopPropagation();
      const id = act.dataset.id;
      lastDrawerRow = { id: "", at: 0 };
      if (act.dataset.act === "trash") confirming = id;
      else {
        confirming = undefined;
        if (act.dataset.act === "yes" && id) post(isOpen ? { type: "delete", ids: [id] } : { type: "scene.removeFrom", file, id });
      }
      render(state);
      return;
    }
    const id = target.closest?.("rn-item")?.getAttribute("value");
    if (!id) return;
    // Not the browser's dblclick: a selection redraws the rows between the clicks, as in the Library tab.
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
  true,
);

function status(text: string): void {
  $("message").textContent = text;
  $("message").className = "message warn";
}

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
// Select all, undo, redo, duplicate, copy, cut, paste, group and save: Ctrl+A, Ctrl+Z, Ctrl+Y (or Ctrl+Shift+Z), Ctrl+D, Ctrl+C, Ctrl+X, Ctrl+V,
// Ctrl+G, Ctrl+Shift+G, Ctrl+S, Ctrl+Shift+S. Not while
// typing in a field (the field undoes its own text), and not in the middle of a drag or a box.
window.addEventListener("keydown", (e) => {
  if (!e.ctrlKey || e.altKey || e.metaKey) return;
  const tag = document.activeElement?.tagName;
  if (tag === "INPUT" || tag === "RN-INPUT" || viewport.busy) return;
  const key = e.key.toLowerCase();
  const ids = selection();
  if (key === "z" && !e.shiftKey) post({ type: "undo" });
  else if (key === "y" || (key === "z" && e.shiftKey)) post({ type: "redo" });
  else if (key === "a" && !e.shiftKey && state) post({ type: "select", ids: state.scene.objects.map((o) => o.id) });
  else if (key === "d") duplicate();
  else if (key === "c" && ids.length) post({ type: "copy", ids });
  else if (key === "x" && ids.length) post({ type: "cut", ids });
  else if (key === "v") {
    const ray = viewport.cursorRay();
    dropAsked = true;
    post({ type: "paste", at: ray ? { origin: ray.o, dir: ray.d } : undefined });
  }
  else if (key === "g" && ids.length) post({ type: e.shiftKey ? "ungroup" : "group", ids });
  else if (key === "s" && e.shiftKey) state && toLibrary(`${state.scene.name} copy`);
  else if (key === "s") post({ type: "scene.save" });
  else return;
  e.preventDefault();
});
for (const id of ["editorCamera", "hideHud"] as const) {
  $(id).addEventListener("change", (e) => post({ type: "settings", [id]: !!(e as CustomEvent<{ checked: boolean }>).detail.checked }));
}
$("edit").addEventListener("change", (e) => viewport.setEdit(!!(e as CustomEvent<{ checked: boolean }>).detail.checked));
$("solid").addEventListener("change", (e) => {
  if (!state) return;
  const ids = state.scene.objects.filter((o) => o.kind === "mesh" && state!.selected.includes(o.id)).map((o) => o.id);
  post({ type: "solid", ids, on: !!(e as CustomEvent<{ checked: boolean }>).detail.checked });
});
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
