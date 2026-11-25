// The editor page: shows the mod's state and sends requests. No truth lives here.
import { channel } from "rednode";
import { applyChange, boxOf, centreOf, collisionKey, membersOf, seenFromBySize, SeenFromRange, pickMany, pickSelection, selectionUnits } from "../arrange";
import { AXES, add, qAxisAngle, qMul, qNorm, qYaw, sub, type Q, type V3 } from "../math";
import type { AssetEntry, AssetFrom, AssetKind, DropLike, ImportCollision, LibraryBake, ModelEntry, ExploreReply, ExploreRoot, FilesReply, ModMessage, PageMessage, Place, PreviewReply, SceneEntry, SceneObject, SceneTransform, Snapshot, WorldKind, WorldThing } from "../protocol";
import type { Part, Previews } from "./previews";
import { held } from "./held";
import { Viewport, busyText, fieldFocused, type WorldTip } from "./viewport";
import { ToolDrawer } from "./tools";
import { doorStateText } from "../worldedits";
import { exploreSegments } from "../explore";
import helpHtml from "./help.md";

declare const RednodeUI: { notify(text: string, options?: Record<string, unknown>): void } | undefined;

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const post = (m: PageMessage) => channel.post(m);
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const shortName = (p: string) => p.slice(p.lastIndexOf("\\") + 1);
/** What a result is called: a person by its in-game name (B3c), a file by its name. */
const labelOf = (r: AssetEntry) => (r.kind === "npc" ? (r.name ?? r.path.replace(/^Character\./, "")) : shortName(r.path));
/** The label of the result with this path, from the list on show. */
const labelFor = (p: string) => {
  const r = state?.results.find((x) => x.path === p);
  return r ? labelOf(r) : shortName(p);
};

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

/** B2d: when the last Import finished, as the page last saw it: a newer one picks its prop on the Assets tab. */
let importedAt: number | undefined;

function pickImported(s: Snapshot): void {
  const at = s.imported?.at;
  if (importedAt === undefined) {
    importedAt = at ?? 0;
    return;
  }
  if (!s.imported || at === importedAt) return;
  importedAt = at;
  const path = s.imported.path;
  lookedAt = path;
  appearance = undefined;
  mainTabs().select?.(0);
  (document.getElementById("kinds") as HTMLElement & { select?(i: number): void }).select?.(0);
  (document.getElementById("from") as HTMLElement & { select?(i: number): void }).select?.(0);
  kind = "all";
  from = "all";
  const box = $("search") as HTMLElement & { value: string };
  box.value = path.slice(path.lastIndexOf("\\") + 1).replace(/\.ent$/i, "");
  post({ type: "search", text: box.value, kind, from });
  post({ type: "look", path });
}

function render(s: Snapshot): void {
  state = s;
  pickImported(s);
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
  $("progress").textContent = ix.status === "building" ? (ix.progress ?? "") : s.npcs.status === "reading" ? (s.npcs.progress ?? "") : "";

  // Assets.
  const list = $("results");
  const keep = lookedAt;
  list.innerHTML = s.results
    .map((r) => `<rn-item value="${esc(r.path)}" title="${esc(rowTitle(r))}"${r.path === keep ? " selected" : ""}>${esc(labelOf(r))}<span slot="end">${esc(rowTag(r))}</span></rn-item>`)
    .join("");
  const total = s.index.count + s.sources.mods.assets + (s.sources.project?.assets ?? 0);
  const listsAll = s.query.from === "mods" || s.query.from === "project";
  $("count").textContent =
    s.index.status === "ready" || s.results.length
      ? s.query.text || listsAll
        ? foundText(s)
        : `${total.toLocaleString()} assets${s.npcs.count ? ` and ${s.npcs.count.toLocaleString()} NPCs` : ""}: type a name to search`
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
    $("lookedPath").textContent = looked.path === labelFor(looked.path) ? looked.path : `${labelFor(looked.path)}\n${looked.path}`;
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
  renderTools(s);
  renderLeft();
  renderExPreview(s);
  renderEdits(s);
  viewport.setCamera(s.camera?.entityId);
  viewport.setPaused(!!s.camera?.paused);
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

/**
 * What a scene or bake does to the world, both numbers always, so one that only removes the game's own
 * objects never reads as doing nothing (the owner's wording, 2026-11-20): `0 added, 2 removed`; short,
 * for list rows, `+0 −2`.
 */
function holds(objects: number, removals = 0, short = false, doors = 0): string {
  const kept = doors ? (short ? `, ${doors} door${doors === 1 ? "" : "s"}` : `, ${doors} door${doors === 1 ? "" : "s"} set`) : "";
  return (short ? `+${objects} −${removals}` : `${objects} added, ${removals} removed`) + kept;
}

/** The open scene's world edits counted: what it removes, and the doors whose state it keeps (D2). */
function editCount(s: Snapshot): { removals: number; doors: number } {
  const e = s.scene.worldEdits;
  return { removals: e.filter((x) => x.action === "remove").length, doors: e.filter((x) => x.action === "door").length };
}

/** The count in the kind's own word, so an empty list says why: `0 entities found`, `1 mesh found for "katana"`. The tab says where. */
function foundText(s: Snapshot): string {
  const n = s.results.length;
  const q = s.query;
  const [one, many] = q.kind === "mesh" ? ["mesh", "meshes"] : q.kind === "entity" ? ["entity", "entities"] : q.kind === "npc" ? ["NPC", "NPCs"] : ["asset", "assets"];
  return `${n}${n >= 120 ? "+" : ""} ${n === 1 ? one : many} found${q.text ? ` for "${q.text}"` : ""}`;
}

/** The tag at a result's end: the mod or project it comes from, and its kind; for a person, its record. */
function rowTag(r: AssetEntry): string {
  if (r.kind === "npc") return `${r.path} NPC`;
  const where = r.source ? (r.source.kind === "project" ? `project ${r.source.name}` : r.source.name) : r.path.toLowerCase().startsWith("ep1\\") ? "PL" : "";
  return [where, r.replaces ? "changes a game file" : "", r.kind].filter(Boolean).join(" ");
}

function rowTitle(r: AssetEntry): string {
  if (r.kind === "npc") return `${r.name ? `${r.name}\n` : ""}${r.path}\n${r.template ?? ""}`;
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

/** What the Seen from field showed last, so Apply sends it only when it was changed. */
let seenShown = "";

/** Seen from: the objects' own distance when they share one; empty, with the distance by size as its hint, when they have none. */
function renderSeenFrom(sel: SceneObject[]): void {
  const f = $<Field>("seenFrom");
  // A person is not baked (B3c), so how far off it is seen once baked does not apply.
  f.hidden = !sel.length || sel.every((o) => o.kind === "npc");
  if (f.hidden) return;
  const own = new Set(sel.map((o) => o.streaming?.primary ?? null));
  const one = own.size === 1 ? [...own][0] : undefined;
  seenShown = one == null ? "" : String(one);
  if (document.activeElement?.id !== "seenFrom") f.value = seenShown;
  const bySize = sel.length === 1 ? seenFromBySize(sel[0]) : undefined;
  f.setAttribute("placeholder", own.size > 1 ? "mixed" : bySize ? `${bySize} by size` : "by size");
}

/** Sends Seen from if it was changed: a number of metres, or empty for the distance by size. */
function applySeenFrom(): void {
  if (!state) return;
  const text = $<Field>("seenFrom").value.trim();
  if (text === seenShown) return;
  const n = Number(text);
  if (text && (!Number.isFinite(n) || n <= 0)) {
    $<Field>("seenFrom").value = seenShown;
    return status(`Seen from takes metres, ${SeenFromRange[0]} to ${SeenFromRange[1]}, or empty for a distance by size.`);
  }
  seenShown = text;
  post({ type: "seenFrom", ids: state.selected, metres: text ? n : null });
}

function renderSelected(sel: SceneObject[], s: Snapshot): void {
  renderSolid(sel, s);
  renderSeenFrom(sel);
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
  $("selected").textContent = `${oneGroup ? `${oneGroup.name}: ` : ""}${o.id}\n${o.resource ?? o.record ?? o.kind}\n${o.appearance ? `appearance ${o.appearance}\n` : ""}at ${x.toFixed(2)}, ${y.toFixed(2)}, ${z.toFixed(2)}${o.entityId ? `\nentity ${o.entityId}` : "\nnot in the world"}`;
}

// ---- wiring -----------------------------------------------------------------------------------

let searchTimer: ReturnType<typeof setTimeout> | undefined;
function search(): void {
  $("search").classList.toggle("empty", !(($("search") as HTMLInputElement & { value: string }).value ?? ""));
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
    // A field, or anything in a tool's drawer, keeps what is typed.
    if (fieldFocused() || document.activeElement?.closest("#toolDrawer")) return;
    if (lastDownInWorld && ($("edit") as HTMLElement & { checked: boolean }).checked) return;
    // With the Explorer or the Import file picker open, typing filters it.
    if (explorerOpen || filesOpen) {
      e.preventDefault();
      e.stopImmediatePropagation();
      const box = $(filesOpen ? "fileFilter" : "exFilter") as HTMLElement & { value: string; focus(): void };
      box.focus();
      box.value = (box.value ?? "") + e.key;
      box.dispatchEvent(new Event("input"));
      return;
    }
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
  kind = (["all", "mesh", "entity", "npc"] as const)[(e as CustomEvent<{ index: number }>).detail.index] ?? "all";
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
  // The Preview switch on: the result in 3D in the Preview drawer as well.
  if (previewPick) previewResult(lookedAt);
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
  if (lookedAt) startDropAtClick(lookedAt, appearance);
});

/**
 * Drop at click: Edit goes on and the object's outline shows where a
 * click would put it (its own edges once the page has its model, its box until then); the next left click drops it there.
 */
function startDropAtClick(path: string, looks: string | undefined, label?: string, like?: DropLike): void {
  const edit = $("edit") as HTMLElement & { checked: boolean };
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
    { name, bounds: () => (state?.looked?.path === path ? state.looked.info?.bounds : undefined), edges: () => edgesFor(path), scale: like?.scale },
  );
  // The outline's edges are worked out now, while the mouse finds its way to the world.
  edgesFor(path);
  $("message").textContent = `Drop at click is on: click in the world where ${name} should go. Esc or a tap of the right button cancels; hold it to look around.`;
  $("message").className = "message";
}
// A panel's pin (Picked on the Assets and Library tabs, Selected on the Scene tab): pinned, the panel stays at the
// bottom of its tab while the tab scrolls. Each panel's choice is kept in this page's storage; pinned
// unless turned off.
for (const panel of document.querySelectorAll<HTMLElement>(".pinnable")) {
  const pin = panel.querySelector<HTMLElement>(".pin");
  if (!pin) continue;
  const key = `edgebuilder.pinned.${panel.id}`;
  const note = panel.dataset.pinNote ?? "";
  const set = (on: boolean) => {
    panel.classList.toggle("pinned", on);
    pin.setAttribute("aria-pressed", String(on));
    pin.title = on ? "Pinned to the bottom of the tab: click to let it scroll with the tab" : `Pin to the bottom of the tab, ${note}`;
    try {
      localStorage.setItem(key, on ? "1" : "0");
    } catch {
      // No storage: for this session only.
    }
  };
  let on = true;
  try {
    on = localStorage.getItem(key) !== "0";
  } catch {
    // No storage: pinned.
  }
  set(on);
  pin.addEventListener("click", () => set(!panel.classList.contains("pinned")));
}
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
$("apply").addEventListener("click", () => {
  applyFields();
  applySeenFrom();
});
$<Field>("seenFrom").addEventListener("submit", () => {
  applySeenFrom();
  (document.activeElement as HTMLElement | null)?.blur();
});
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

type Picked = { kind: "scene"; file: string } | { kind: "folder"; place: Place; folder: string } | { kind: "bake"; dir: string } | { kind: "model"; file: string };
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

function findBake(s: Snapshot, dir: string): LibraryBake | undefined {
  return s.library.bakes.find((b) => sameFile(b.dir, dir));
}

/** A Library bake's flags, as tags for its row. */
function bakeTags(b: LibraryBake): string {
  const tags: string[] = [];
  if (b.error) tags.push('<span class="tag warn">cannot be read</span>');
  if (b.scenes.some((x) => x.stale)) tags.push('<span class="tag warn">stale</span>');
  if (b.scenes.some((x) => x.missing)) tags.push('<span class="tag warn">scene missing</span>');
  if (b.collides.length) tags.push('<span class="tag warn">collides</span>');
  if (b.inGame) tags.push('<span class="tag">in game</span>');
  if (b.inProject !== undefined) tags.push(`<span class="tag${b.inProject < b.version ? " warn" : ""}">in project</span>`);
  return tags.join("");
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
  if (picked?.kind === "bake") {
    const b = findBake(s, picked.dir);
    if (b) return { place: "library", folder: b.folder };
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
        const end = sc.error ? "cannot be read" : `${open ? holds(s.scene.objects.length, editCount(s).removals, true, editCount(s).doors) : holds(sc.objects, sc.removals, true, sc.doors)} · ${when(sc.changed)}`;
        rows.push(
          `<rn-item value="f:${esc(sc.file)}" title="${esc(sc.error ? `${sc.file}\n${sc.error}` : sc.file)}"${isPicked({ kind: "scene", file: sc.file }) ? " selected" : ""}${pad(depth)}><span class="fold"></span>${esc(sc.name)}${tags}<span slot="end">${esc(end)}</span></rn-item>`,
        );
      }
      if (sh.place !== "library") return;
      for (const m of s.library.models.filter((x) => x.place === "library" && x.folder === folder)) rows.push(modelRow(m, depth));
      for (const b of s.library.bakes.filter((x) => x.folder === folder)) {
        const end = b.error ? "" : `${b.scenes.length} scene${b.scenes.length === 1 ? "" : "s"} · v${b.version}`;
        rows.push(
          `<rn-item value="b:${esc(b.dir)}" title="${esc(b.error ? `${b.dir}\n${b.error}` : b.dir)}"${isPicked({ kind: "bake", dir: b.dir }) ? " selected" : ""}${pad(depth)}><span class="fold"></span>${esc(b.name)}<span class="tag dim">bake</span>${bakeTags(b)}<span slot="end">${esc(end)}</span></rn-item>`,
        );
      }
    };
    const key = `${sh.place}|`;
    rows.push(
      `<rn-item value="d:${esc(key)}" title="${esc(sh.dir)}"${isPicked({ kind: "folder", place: sh.place, folder: "" }) ? " selected" : ""}${pad(0)}><span class="fold" data-folder="${esc(key)}">${closedFolders.has(key) ? "▸" : "▾"}</span><span class="section">${esc(sh.label)}</span><span slot="end">${sh.scenes.length} scene${sh.scenes.length === 1 ? "" : "s"}</span></rn-item>`,
    );
    if (!closedFolders.has(key)) walk("", 1);
  }
  // B2d: the models beside the Library: the open project's source\raw and EDGEfab's Desk.
  for (const mp of s.library.modelPlaces.filter((x) => x.place !== "library")) {
    const models = s.library.models.filter((x) => x.place === mp.place);
    const key = `model:${mp.place}|`;
    rows.push(
      `<rn-item value="x:${esc(key)}" title="${esc(mp.dir)}"${pad(0)}><span class="fold" data-folder="${esc(key)}">${closedFolders.has(key) ? "▸" : "▾"}</span><span class="section">${esc(mp.label)}</span><span slot="end">${models.length} model${models.length === 1 ? "" : "s"}</span></rn-item>`,
    );
    if (!closedFolders.has(key)) for (const m of models) rows.push(modelRow(m, 1, true));
  }
  return rows.join("");

  function modelRow(m: ModelEntry, depth: number, withFolder = false): string {
    const end = m.kind === "prop" ? "prepared" : m.bytes ? `${(m.bytes / 1e6).toFixed(1)} MB` : "";
    const label = withFolder && m.folder ? `${m.folder.replace(/\//g, " > ")} > ${m.name}` : m.name;
    return `<rn-item value="m:${esc(m.file)}" title="${esc(m.file)}"${isPicked({ kind: "model", file: m.file }) ? " selected" : ""}${pad(depth)}><span class="fold"></span>${esc(label)}<span class="tag dim">${m.kind === "prop" ? "prop" : "glb"}</span><span slot="end">${esc(end)}</span></rn-item>`;
  }
}

function findModel(s: Snapshot, file: string): ModelEntry | undefined {
  return s.library.models.find((m) => sameFile(m.file, file));
}

/** B2d: the Picked panel's text for a model, and the Import box. */
function renderModel(s: Snapshot, file: string | undefined): void {
  $("importBox").hidden = !file;
  if (!file) return;
  const m = findModel(s, file);
  const where = m ? (m.place === "library" ? whereLabel(s, "library", m.folder) : s.library.modelPlaces.find((x) => x.place === m.place)?.label ?? "") : "typed in";
  const what = (m?.kind ?? (file.toLowerCase().endsWith(".glb") ? "glb" : "prop")) === "prop" ? "A prop on EDGEfab's Desk or in the Library, already prepared" : "A GLB: Import prepares it (size, facing, levels of detail, textures) with EDGEfab's core";
  const into = s.bake.project ? `Import puts it into ${s.bake.project.name}, packs the project and swaps it into the game.` : "Open a REDcode project to import into (Refresh on the Bake tab asks again).";
  $("pickedText").textContent = `${m?.name ?? file.slice(file.search(/[^\\/]*$/))}\n${where}${m?.bytes ? `, ${(m.bytes / 1e6).toFixed(1)} MB` : ""}\n${what}.\n${into}\n${file}`;
  const name = $<Field>("importName");
  name.setAttribute("placeholder", propSlugOf(m?.name ?? file));
  $("importGo").toggleAttribute("disabled", !s.bake.project || !!s.busy);
}

/** The name EDGEfab will give the prop, for the Name field's placeholder. */
function propSlugOf(name: string): string {
  const base = name.replace(/^.*[\\/]/, "").toLowerCase().replace(/\.(glb|prop\.asset)$/, "");
  return base.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 48) || "prop";
}

let bakeHtml = "";

/** What a bake holds: its objects, the game's objects it removes, and the stand-ins removed with them. */
function bakeHolds(r: { objects?: number; removals?: number; standIns?: number }, short = false): string {
  const text = holds(r.objects ?? 0, r.removals ?? 0, short);
  return r.standIns && !short ? `${text} (and ${r.standIns === 1 ? "its stand-in" : `their ${r.standIns} stand-ins`})` : text;
}
let bakeConfirm: string | undefined;

function renderBake(s: Snapshot): void {
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
  const when = (iso?: string) => (iso ? new Date(iso).toLocaleString() : "");
  const lines: string[] = [];
  if (b.current) lines.push(`Baked ${when(b.current.date)}${b.current.objects === undefined ? "" : `, ${bakeHolds(b.current)}`}.${b.stale ? " The scene changed since: bake again to bring it in." : ""}`);
  if (b.current?.library) lines.push(`This bake came from the Library's ${b.current.library.name} (version ${b.current.library.version}). Bake here makes it the project's own; to keep it the Library's, bake it on the Library tab and update it here.`);
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
          : `<span slot="end">${r.library?.latest && r.library.dir ? `<button class="update" data-act="update" data-id="${esc(r.library.dir)}" title="The Library's ${esc(r.library.name)} is at version ${r.library.latest}; this project has version ${r.library.version}. Copies the new version in">Update to v${r.library.latest}</button>` : ""}<span class="grouptag">${r.library ? `from ${esc(r.library.name)} v${r.library.version} · ` : ""}${r.objects === undefined ? "" : bakeHolds(r, true)}</span><button class="act" data-act="trash" data-id="${esc(r.slug)}" title="Take this bake out of the project. Its scene stays">${TrashIcon}</button></span>`;
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
    if (act.dataset.act === "update") {
      if (id) post({ type: "lbake.include", dir: id });
      return;
    }
    if (act.dataset.act === "trash") bakeConfirm = id;
    else {
      bakeConfirm = undefined;
      if (act.dataset.act === "yes" && id) post({ type: "bake.remove", slug: id });
    }
    if (state) render(state);
  },
  true,
);

// ---- a Library bake in the Picked panel (B4-3) ---------------------------------------------------------

let lbakeAsking = false;
let lbakeDropping: string | undefined;
let lbakeHtml = "";

/** What the Picked panel says about a Library bake: where, which version, and each flag in words. */
function bakeText(s: Snapshot, b: LibraryBake): string {
  if (b.error) return `${b.name}: cannot be read (${b.error})\n${b.dir}`;
  const lines = [`${b.name}: a bake in ${whereLabel(s, "library", b.folder)}, version ${b.version}${b.date ? `, baked ${new Date(b.date).toLocaleString()}` : ""}`];
  const stale = b.scenes.filter((x) => x.stale).map((x) => x.name);
  const missing = b.scenes.filter((x) => x.missing).map((x) => x.name);
  if (!b.scenes.length) lines.push("Empty: Add open scene puts the open scene in it.");
  if (stale.length) lines.push(`Changed since the bake: ${stale.join(", ")}. Bake again to bring that in.`);
  if (missing.length) lines.push(`Not where it was baked from: ${missing.join(", ")}. Bake again keeps what was baked.`);
  if (b.collides.length) lines.push(`Shares a scene with ${b.collides.join(", ")}: in one game, the objects would stand twice. Keep one of them in your projects.`);
  if (b.inGame) lines.push("In the game: its scenes' previews stay off, so nothing stands twice.");
  if (b.inProject !== undefined) lines.push(b.inProject < b.version ? `The open project has version ${b.inProject}: Include in project brings it up to date.` : "In the open project.");
  else if (s.bake.project) lines.push(`Not in the open project, ${s.bake.project.name}.`);
  else lines.push("No REDcode project is open to include it in.");
  return lines.join("\n");
}

function renderLibraryBake(s: Snapshot, b: LibraryBake | undefined): void {
  $("lbakeRow").hidden = !b;
  $("lbakeScenes").hidden = !b || !b.scenes.length;
  $("lbakeAsk").hidden = !b || !lbakeAsking;
  if (!b) {
    lbakeAsking = false;
    lbakeDropping = undefined;
    return;
  }
  const inIt = !!s.scene.file && b.scenes.some((x) => sameFile(x.file, s.scene.file!));
  $("lbakeAdd").textContent = inIt ? "Bake open scene again" : "Add open scene";
  $("lbakeAdd").toggleAttribute("disabled", !s.scene.file || !!b.error);
  $("lbakeRebake").toggleAttribute("disabled", !b.scenes.length || !!b.error);
  $("lbakeInclude").toggleAttribute("disabled", !s.bake.project || !b.scenes.length || !!b.error);
  $("lbakeInclude").textContent = b.inProject !== undefined && b.inProject < b.version ? `Update in project to v${b.version}` : "Include in project";
  const html = b.scenes
    .map((x) => {
      const flags = `${x.stale ? '<span class="tag warn">changed</span>' : ""}${x.missing ? '<span class="tag warn">missing</span>' : ""}`;
      const end =
        lbakeDropping === x.slug
          ? `<span slot="end" class="confirm">Take it out of the bake?<button data-act="yes" data-id="${esc(x.slug)}">Yes</button><button data-act="no">No</button></span>`
          : `<span slot="end"><button class="act" data-act="trash" data-id="${esc(x.slug)}" title="Take this scene out of the bake. The scene stays">${TrashIcon}</button></span>`;
      return `<rn-item value="${esc(x.slug)}" title="${esc(x.file)}">${esc(x.name)}${flags}${end}</rn-item>`;
    })
    .join("");
  if (html !== lbakeHtml) $("lbakeScenes").innerHTML = lbakeHtml = html;
}

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
  if (picked?.kind === "bake" && !findBake(s, picked.dir)) picked = undefined;
  if (picked?.kind === "model" && !findModel(s, picked.file) && !typedModel) picked = undefined;
  $("shelves").innerHTML = libraryRows(s);
  const sc = picked?.kind === "scene" ? findScene(s, picked.file) : undefined;
  const lb = picked?.kind === "bake" ? findBake(s, picked.dir) : undefined;
  const open = !!sc && sameFile(sc.file, s.scene.file ?? "");
  const on = !!sc && s.library.on.some((f) => sameFile(f, sc.file));
  if (sc)
    $("pickedText").textContent = `${sc.name}${open ? " (open)" : on ? " (shown in the world)" : ""}\n${whereLabel(s, sc.place, sc.folder)}\n${sc.error ? `Cannot be read: ${sc.error}` : `${open ? holds(s.scene.objects.length, editCount(s).removals, false, editCount(s).doors) : holds(sc.objects, sc.removals, false, sc.doors)}, changed ${when(sc.changed)}`}\n${sc.file}`;
  else if (picked?.kind === "folder") $("pickedText").textContent = `Folder: ${whereLabel(s, picked.place, picked.folder)}`;
  else if (lb) $("pickedText").textContent = bakeText(s, lb);
  else if (picked?.kind === "model") void 0;
  else $("pickedText").textContent = "Pick a scene to open or show it, or a folder for a new scene. A double-click opens a scene.";
  $("pickedOpen").toggleAttribute("disabled", !sc || open || !!sc.error);
  $("pickedClose").toggleAttribute("disabled", !open);
  $("pickedOn").toggleAttribute("disabled", !sc || open || !!sc.error);
  $("pickedOn").textContent = on ? "Hide from world" : "Show in world";
  // A picked bake or model is no scene to open, close or show.
  for (const id of ["pickedOpen", "pickedClose", "pickedOn"]) $(id).hidden = !!lb || picked?.kind === "model";
  renderModel(s, picked?.kind === "model" ? picked.file : undefined);
  // Bake into Library: a scene, with a Library to bake into.
  $("pickedBake").hidden = !sc || !root;
  $("pickedBake").toggleAttribute("disabled", !sc || !!sc.error || !sc.objects && !open);
  renderLibraryBake(s, lb);
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
  if (label === "Library") {
    post({ type: "library.refresh" });
    // Out of the window, the Library comes back into view with its tab, unless another drawer is open.
    if (libraryOut && !drawerOpen && !previewsOpen && !state?.sectors.open) openLeft("library");
  }
  else leaveSaveAs();
  if (label === "Bake") post({ type: "bake.refresh" });
  if (label === "World") post({ type: "world.refresh" });
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
  lbakeAsking = false;
  // In its drawer, a pick shows the Library tab, where the Picked panel and its buttons are.
  if (libraryOut) mainTabs().select?.(TabLabels.library);
  if (value.startsWith("f:")) picked = { kind: "scene", file: value.slice(2) };
  else if (value.startsWith("b:")) picked = { kind: "bake", dir: value.slice(2) };
  else if (value.startsWith("m:")) {
    typedModel = false;
    picked = { kind: "model", file: value.slice(2) };
  }
  else if (value.startsWith("x:")) return;
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
$("pickedBake").addEventListener("click", () => {
  if (!state || picked?.kind !== "scene") return;
  const sc = findScene(state, picked.file);
  if (!sc) return;
  post({ type: "lbake.new", file: sc.file, name: newName().value?.trim() || sc.name, folder: sc.folder });
  newName().value = "";
});
// B2d: Import. A path typed in is picked like a row; the Import box sends name, height and collision.
let typedModel = false;
const Collisions = ["physical", "box", "none"] as const;
let collision: ImportCollision = "physical";
$("importCollision").addEventListener("change", (e) => {
  collision = Collisions[(e as CustomEvent<{ index: number }>).detail.index] ?? "physical";
});
function pickTyped(): void {
  const file = ($<Field>("importPath").value ?? "").trim().replace(/^"(.*)"$/, "$1");
  if (!file) return;
  typedModel = true;
  picked = { kind: "model", file };
  if (state) render(state);
}
$("importPathGo").addEventListener("click", pickTyped);
$<Field>("importPath").addEventListener("submit", pickTyped);
$("importGo").addEventListener("click", () => {
  if (picked?.kind !== "model") return;
  const height = Number(($<Field>("importHeight").value ?? "").replace(",", "."));
  post({ type: "import", file: picked.file, name: ($<Field>("importName").value ?? "").trim() || undefined, height: height > 0 ? height : undefined, collision });
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
    const act = (e.target as HTMLElement).closest?.("[data-act]") as HTMLElement | null;
    if (!act) return;
    e.stopPropagation();
    const slug = act.dataset.id;
    if (act.dataset.act === "trash") lbakeDropping = slug;
    else {
      lbakeDropping = undefined;
      if (act.dataset.act === "yes" && slug && picked?.kind === "bake") post({ type: "lbake.drop", dir: picked.dir, slug });
    }
    if (state) render(state);
  },
  true,
);
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
          : `<span slot="end">${o.group ? `<span class="grouptag">${esc(groupName(o.group) ?? "")}</span>` : ""}${o.resource || o.record ? `<button class="icon" data-act="eye" data-id="${esc(o.id)}" aria-pressed="${objectPreview && objectLike?.id === o.id}" title="Its preview beside this drawer, with Drop a copy">${EyeIcon}</button>` : ""}<button class="act" data-act="trash" data-id="${esc(o.id)}" title="Delete">${TrashIcon}</button></span>`;
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
  openLeft(drawerOpen ? "none" : "objects");
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
      if (act.dataset.act === "eye") {
        const shown = isOpen ? state.scene : state.library.peek;
        const o = shown?.objects.find((x) => x.id === id);
        if (objectPreview && objectLike?.id === id) objectPreview = false;
        else if (o) previewObject(o);
        render(state);
        return;
      }
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


// ---- the World tab (D1) -----------------------------------------------------------------------------
//
// The game's own doors near V, and the one picked (by a click in the world with Edit on, or here), with
// Remove from world. What a scene removes is listed on the Scene tab, each with Restore.

const KindToggles: [string, WorldKind][] = [
  ["kindDoor", "door"],
  ["kindFakeDoor", "fakeDoor"],
  ["kindMesh", "mesh"],
];
/** When a click in the world last asked for a pick: what it finds shows on the World tab. */
let worldClickAt = 0;
let lastPickedKey: string | undefined;
let worldHtml = "";
let editsHtml = "";
let hoverKey: string | null = null;
const WorldTab = 3;
const DoorButtons = ["doorOpen", "doorClose", "doorLock", "doorRestore"];

/** A door's state in a few words: `closed, locked`. */
function doorText(d: WorldThing["door"]): string {
  if (!d) return "";
  return [d.open === undefined ? "" : d.open ? "open" : "closed", d.locked ? "locked" : "", d.sealed ? "sealed" : "", d.lift ? "an elevator's door" : ""].filter(Boolean).join(", ");
}

/**
 * Whether a thing in the world is solid, in a word and why: a door while closed, a mesh node our bake writes as solid,
 * or the game's physics stopping the click's line on it; not known for a mesh picked without the cursor.
 */
function solidOf(p: WorldThing & { node?: { type: string } }): { word: "Yes" | "No" | "Not known"; why: string } {
  if (p.what === "door") return p.door?.open ? { word: "No", why: "it is open" } : { word: "Yes", why: "while it is closed" };
  const type = p.node?.type ?? p.className;
  if (p.ray?.solid) return { word: "Yes", why: "the game's physics stops a line on it" };
  if (/^worldInstancedDestructibleMeshNode$/.test(type)) return { word: "Yes", why: `a ${type}` };
  if (p.ray) return { word: "No", why: "a line goes through it" };
  return { word: "Not known", why: "pick it with the cursor to find out" };
}

/** Whether a mesh's file carries collision data, so a copy can be made solid; empty for what is not a mesh. */
function collisionLine(p: WorldThing): string {
  if (p.what !== "mesh" || !p.resource || !/.mesh$/i.test(p.resource)) return "";
  if (p.collision === true) return "Collision data: Yes (a copy can be made solid)";
  if (p.collision === false) return "Collision data: No (a copy cannot be made solid: it needs a collision box)";
  return "";
}

function renderWorld(s: Snapshot): void {
  const wo = s.worldObjects;
  if (pickWaitFrom !== undefined && ((wo.picks ?? 0) > pickWaitFrom || performance.now() - worldClickAt > 15000)) {
    pickWaitFrom = undefined;
    viewport.setWorking(undefined);
  }
  for (const [id, k] of KindToggles) ($(id) as HTMLElement & { checked: boolean }).checked = wo.kinds.includes(k);
  const n = wo.things.length;
  const what =
    s.world !== "ready"
      ? "Load a save: the doors near V are listed here."
      : wo.status === "looking"
        ? "Looking for the doors near V..."
        : !wo.kinds.length
          ? "Switch a kind on to pick the game's own objects."
          : `${n} near V, within 30 m${n ? ", nearest first" : ""}. With Edit on, a click on one in the world picks it.`;
  $("worldInfo").textContent = [wo.note ?? "", what].filter(Boolean).join("\n");
  const picked = wo.picked;
  const rows = wo.things
    .map((t) => {
      const end = [t.removedBy ? '<span class="tag warn">removed</span>' : "", t.stateBy ? '<span class="tag">kept</span>' : "", esc(doorText(t.door)), t.distance !== undefined ? `${t.distance.toFixed(1)} m` : ""].filter(Boolean).join(" ");
      return `<rn-item value="${esc(t.key)}" title="${esc([t.resource, t.appearance].filter(Boolean).join("\n"))}"${picked?.key === t.key ? " selected" : ""}>${esc(t.label)}<span slot="end">${end}</span></rn-item>`;
    })
    .join("");
  if (rows !== worldHtml) $("worldList").innerHTML = worldHtml = rows;

  // A click in the world picked something new: show it here.
  if (picked?.key !== lastPickedKey) {
    lastPickedKey = picked?.key;
    if (picked && performance.now() - worldClickAt < 5000) {
      mainTabs().select?.(WorldTab);
      // Picked with the cursor: its details in the Preview drawer at the screen's left.
      showWorldPreview();
    }
  }
  if (!picked) {
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
  const node = picked.node;
  const d = picked.door;
  const kept = picked.stateBy ? s.scene.worldEdits.find((e) => e.id === picked.stateBy) : undefined;
  const where = node ? `${node.type}, entry ${node.entry} (node ${node.node}) in ${node.sector ? shortName(node.sector) : node.sectorHash}` : "";
  $("worldPicked").textContent = [
    picked.label,
    picked.resource ?? "",
    picked.appearance ? `appearance ${picked.appearance}` : "",
    d ? [doorText(d), d.initial ? `starts ${d.initial.toLowerCase()}` : "", d.closesItself ? "closes by itself" : ""].filter(Boolean).join("; ") : "",
    `at ${picked.position.map((v) => v.toFixed(2)).join(", ")}`,
    `Solid: ${solidOf(picked).word}`,
    collisionLine(picked) || (picked.what === "mesh" && picked.resource && /.mesh$/i.test(picked.resource) ? "Collision data: reading..." : ""),
    where || picked.note || "",
    picked.ref ? `reference ${picked.ref}` : "",
    picked.proxies?.length ? `and its proxy mesh: ${picked.proxies.map((p) => `entry ${p.entry} in ${p.sector ? shortName(p.sector) : p.sectorHash}`).join(", ")}` : "",
    picked.removedBy ? `Removed by this scene (${picked.removedBy}).` : "",
    kept ? `Kept ${doorStateText(kept.door)} by this scene (${kept.id}).` : "",
  ]
    .filter(Boolean)
    .join("\n");
  $("worldWarnings").textContent = picked.warnings.join("\n");
  $("worldWarnings").hidden = !picked.warnings.length;
  const removed = !!picked.removedBy;
  $("worldRemove").hidden = removed;
  $("worldRemove").toggleAttribute("disabled", removed || !s.scene.file || wo.status === "unavailable" || (!node && !!picked.note && !picked.note.startsWith("Looking")));
  $("worldRemove").title = !s.scene.file ? "Open a scene first: a removal is kept in the open scene" : "Delete. Hidden now, kept in the scene; Restore or Undo brings it back";
  $("worldRestore").hidden = !removed;
  // D2: a door that opens gets its actions; the scene keeps what they set.
  const canSet = picked.what === "door" && !!d && (d.open !== undefined || d.locked !== undefined) && !removed;
  const off = !s.scene.file || s.world !== "ready" || (!node && !!picked.note && !picked.note.startsWith("Looking"));
  const want = kept?.door ?? {};
  for (const id of DoorButtons) $(id).hidden = !canSet;
  $("doorOpen").toggleAttribute("disabled", off || (want.open === true && d?.open === true));
  $("doorClose").toggleAttribute("disabled", off || (want.open === false && d?.open === false));
  const locked = want.locked ?? d?.locked ?? false;
  $("doorLock").textContent = locked ? "Unlock" : "Lock";
  $("doorLock").title = locked ? "Unlock the door, and keep it unlocked while this scene is open" : "Lock the door, and keep it locked while this scene is open";
  $("doorLock").toggleAttribute("disabled", off || d?.locked === undefined);
  $("doorRestore").hidden = !canSet || !kept;
  for (const id of ["doorOpen", "doorClose", "doorLock"]) if (!s.scene.file) $(id).title = "Open a scene first: a door's state is kept in the open scene";
  $("worldGo").toggleAttribute("disabled", s.world !== "ready");
}

/** The Scene tab's world edits: what the open scene removes from the game's world, each with Restore. */
function renderEdits(s: Snapshot): void {
  const edits = s.scene.worldEdits;
  $("editsTitle").hidden = $("worldEdits").hidden = !edits.length;
  const c = editCount(s);
  $("editsTitle").textContent = `World edits, while this scene is open: ${[c.removals ? `${c.removals} of the game's own objects removed` : "", c.doors ? `${c.doors} door${c.doors === 1 ? "" : "s"} kept as set` : ""].filter(Boolean).join(", ")}`;
  const html = edits
    .map((e) => {
      const door = e.action === "door";
      const end = door ? `<span class="tag">${esc(doorStateText(e.door))}</span> ` : "";
      const tip = door ? "Take it out of the scene: the door goes back as it was" : "Take it out of the scene: it is back in the world";
      return `<rn-item value="${esc(e.id)}" title="${esc(`${e.node.sector || e.node.sectorHash}, entry ${e.node.entry}${e.ref ? `\n${e.ref}` : ""}`)}">${esc(e.label)}<span slot="end">${end}<button data-restore="${esc(e.id)}" title="${tip}">Restore</button></span></rn-item>`;
    })
    .join("");
  if (html !== editsHtml) $("worldEdits").innerHTML = editsHtml = html;
}

/** Edit on and the camera on its way to a world thing, as Go to does for the scene's objects. */
function flyToThing(t: WorldThing): void {
  if (!state || state.world !== "ready" || state.settings.editorCamera === false) return;
  const edit = $("edit") as HTMLElement & { checked: boolean };
  if (!edit.checked) {
    edit.checked = true;
    viewport.setEdit(true);
  }
  const box: SceneObject = { id: t.key, kind: "entity", transform: { position: t.position, rotation: [0, 0, 0, 1], scale: [1, 1, 1] }, bounds: { min: [-0.8, -0.8, 0], max: [0.8, 0.8, 2.2] } };
  viewport.flyTo(box);
}

for (const [id, k] of KindToggles) {
  $(id).addEventListener("change", (e) => {
    if (!state) return;
    const on = !!(e as CustomEvent<{ checked: boolean }>).detail.checked;
    const kinds = new Set(state.worldObjects.kinds);
    if (on) kinds.add(k);
    else kinds.delete(k);
    post({ type: "world.kinds", kinds: KindToggles.map(([, x]) => x).filter((x) => kinds.has(x)) });
  });
}
$("worldRefresh").addEventListener("click", () => post({ type: "world.refresh" }));
$("worldList").addEventListener("select", (e) => {
  const key = (e as CustomEvent<{ value: string }>).detail.value;
  const t = state?.worldObjects.things.find((x) => x.key === key);
  if (!t) return;
  post({ type: "world.select", key });
  flyToThing(t);
});
$("worldList").addEventListener("mouseover", (e) => {
  const key = (e.target as HTMLElement).closest?.("rn-item")?.getAttribute("value") ?? null;
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
    const id = ((e.target as HTMLElement).closest?.("[data-restore]") as HTMLElement | null)?.dataset.restore;
    if (!id) return;
    e.stopPropagation();
    post({ type: "world.restore", id });
  },
  true,
);

// ---- World > Sectors and the Sector drawer (S1, EDGEbuilder #9) --------------------------------------
//
// The game's streaming sectors around V, around the camera, or by name or grid cell (REDbridge's
// sector.find), and in a drawer to the left one sector's node data entries (sector.nodes), marked when
// streamed in. A row picked there goes into Picked in the world; two clicks fly there.

const SectorToggles: [string, string][] = [
  ["secExterior", "exterior"],
  ["secInterior", "interior"],
  ["secQuest", "quest"],
  ["secOther", "other"],
];
const SectorLevels = [null, 0, 1, 2, 3] as const;
let sectorsHtml = "";
let sectorRowsHtml = "";
/** The sector and entry the drawer last scrolled to. */
let sectorSelShown = "";
let sectorLevel: number | null = null;
let sectorKindsShown = false;
let lastSector = "";
let lastSectorRow = { entry: -1, at: 0 };
let lastFly = -1;
let sectorsTyped: ReturnType<typeof setTimeout> | undefined;
let sectorFiltered: ReturnType<typeof setTimeout> | undefined;
const EyeIcon = `<svg viewBox="0 0 16 16"><path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8s-2.4 4.5-6.5 4.5S1.5 8 1.5 8z"/><circle cx="8" cy="8" r="2"/></svg>`;
const EyeOffIcon = `<svg viewBox="0 0 16 16"><path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8s-2.4 4.5-6.5 4.5S1.5 8 1.5 8zM2.5 13.5l11-11"/></svg>`;

function sectorKinds(): string[] {
  return SectorToggles.filter(([id]) => ($(id) as HTMLElement & { checked: boolean }).checked).map(([, k]) => k);
}

function findSectors(around: "V" | "camera" | "text"): void {
  const text = (($("sectorsText") as HTMLInputElement).value ?? "").trim();
  const at = around === "camera" ? viewport.cameraAt() : undefined;
  post({ type: "sectors.find", around, ...(at ? { at } : {}), ...(around === "text" ? { text } : {}), kinds: sectorKinds(), level: sectorLevel });
}

function renderSectors(s: Snapshot): void {
  const sx = s.sectors;
  if (!sectorKindsShown) {
    sectorKindsShown = true;
    for (const [id, k] of SectorToggles) ($(id) as HTMLElement & { checked: boolean }).checked = sx.kinds.includes(k);
  }
  const n = sx.found.length;
  const where = sx.around === "text" ? `matching "${sx.text}"` : sx.around === "camera" ? "at the camera's place" : "at V's place";
  $("sectorsInfo").textContent =
    sx.status === "looking"
      ? "Looking for sectors... (the first time, REDbridge reads the game's list: a few seconds)"
      : sx.note
        ? sx.note
        : sx.around
          ? `${sx.total} sector${sx.total === 1 ? "" : "s"} ${where}${sx.total > n ? `, the first ${n} shown` : ""}. Finest level first. A click opens one beside this window.`
          : "Near V lists the sectors the game streams at V's place. Or type part of a name, or a grid cell.";
  const html = sx.found
    .map((r) => {
      const end = [
        r.streamed ? '<span class="tag streamed" title="Streamed in now">in</span>' : "",
        `<span class="tag">${esc(r.kind)}</span>`,
        `L${r.level}`,
        r.block === "ep1" ? '<span class="tag" title="Phantom Liberty">PL</span>' : "",
        r.distance !== undefined && r.distance > 0 ? `${r.distance.toFixed(0)} m` : "",
      ]
        .filter(Boolean)
        .join(" ");
      return `<rn-item value="${esc(r.path)}" title="${esc(r.path)}"${s.sectors.open?.path === r.path ? " selected" : ""}>${esc(r.name)}<span slot="end">${end}</span></rn-item>`;
    })
    .join("");
  if (html !== sectorsHtml) $("sectorsList").innerHTML = sectorsHtml = html;
  // The service's focus: fly there.
  if (lastFly < 0) lastFly = sx.fly?.seq ?? 0;
  if (sx.fly && sx.fly.seq !== lastFly) {
    lastFly = sx.fly.seq;
    mainTabs().select?.(WorldTab);
    (document.getElementById("worldTabs") as HTMLElement & { select?(i: number): void }).select?.(1);
    flyToPoint(sx.fly.position);
  }
}

function renderSectorDrawer(s: Snapshot): void {
  const v = s.sectors.open;
  $("sectorDrawer").classList.toggle("open", !!v);
  if (!v) {
    lastSector = "";
    return;
  }
  if (v.path !== lastSector) {
    lastSector = v.path;
    drawerOpen = libraryDrawerOpen = previewsOpen = explorerOpen = previewAlone = previewWorld = filesOpen = false;
    renderLeft();
    ($("sectorFilter") as HTMLInputElement).value = v.filter;
  }
  const name = shortName(v.path).replace(/\.streamingsector$/i, "");
  $("sectorTitle").textContent = `Sector: ${name}`;
  $("sectorTitle").title = v.path;
  const streamed = v.loaded === true ? "streamed in now" : v.loaded === false ? "not streamed in now: go near it for its nodes to be in the game" : "";
  $("sectorInfo").textContent =
    v.status === "reading"
      ? "Reading the sector through REDbridge..."
      : v.status === "error"
        ? (v.error ?? "It could not be read.")
        : [
            `${v.kind}${v.kind ? ", " : ""}level ${v.level}. ${v.total} entr${v.total === 1 ? "y" : "ies"}${streamed ? `, ${streamed}` : ""}.`,
            v.matching > v.nodes.length ? `${v.matching} match; the first ${v.nodes.length} shown: the filter narrows them.` : v.filter ? `${v.matching} match.` : "",
            "A click picks one (Picked in the world, on the World tab); two clicks fly there. The eye hides one until EDGEbuilder stops.",
          ]
            .filter(Boolean)
            .join("\n");
  const html = v.nodes
    .map((r) => {
      const mark = r.streamed === true ? '<span class="streamed" title="Streamed in now">●</span>' : r.streamed === false ? '<span title="Not streamed in now">○</span>' : "";
      const end = [r.copies ? `<span class="tag" title="An instanced mesh: copies it places">×${r.copies}</span>` : "", mark, `<button class="act${r.hidden ? " on" : ""}" data-act="hide" data-entry="${r.entry}" title="${r.hidden ? "Show it again" : "Hide it until EDGEbuilder stops (not kept in the scene)"}">${r.hidden ? EyeOffIcon : EyeIcon}</button>`].filter(Boolean).join(" ");
      const label = `#${r.entry} ${r.kind.replace(/^world/, "").replace(/Node$/, "")}${r.resource ? ` ${shortName(r.resource)}` : ""}`;
      const tip = [r.resource ?? "", r.ref ?? "", r.appearance ? `appearance ${r.appearance}` : "", `node ${r.node}, at ${r.position.map((x) => x.toFixed(1)).join(", ")}`].filter(Boolean).join("\n");
      return `<rn-item value="${r.entry}" title="${esc(tip)}"${v.selected === r.entry ? " selected" : ""}>${esc(label)}<span slot="end">${end}</span></rn-item>`;
    })
    .join("");
  if (html !== sectorRowsHtml) $("sectorList").innerHTML = sectorRowsHtml = html;
  // A newly picked entry (the service's select, a click in the world) is brought into view.
  const sel = `${v.path}:${v.selected ?? ""}`;
  if (sel !== sectorSelShown) {
    sectorSelShown = sel;
    if (v.selected !== undefined) $("sectorList").querySelector("rn-item[selected]")?.scrollIntoView({ block: "center" });
  }
}

/** Edit on and the camera on its way to a place, a few metres back. */
function flyToPoint(position: [number, number, number]): void {
  if (!state || state.world !== "ready" || state.settings.editorCamera === false) return;
  const edit = $("edit") as HTMLElement & { checked: boolean };
  if (!edit.checked) {
    edit.checked = true;
    viewport.setEdit(true);
  }
  const box: SceneObject = { id: "sector-node", kind: "entity", transform: { position, rotation: [0, 0, 0, 1], scale: [1, 1, 1] }, bounds: { min: [-1, -1, 0], max: [1, 1, 2] } };
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
  sectorLevel = SectorLevels[(e as CustomEvent<{ index: number }>).detail.index] ?? null;
  if (state?.sectors.around) findSectors(state.sectors.around);
});
$("worldTabs").addEventListener("change", (e) => e.stopPropagation());
$("sectorsList").addEventListener("select", (e) => {
  const p = (e as CustomEvent<{ value: string }>).detail.value;
  if (p) post({ type: "sectors.open", path: p });
});
$("sectorClose").addEventListener("click", () => post({ type: "sectors.close" }));
$("sectorFilter").addEventListener("input", () => {
  clearTimeout(sectorFiltered);
  sectorFiltered = setTimeout(() => post({ type: "sectors.filter", text: ($("sectorFilter") as HTMLInputElement).value ?? "" }), 250);
});
$("sectorList").addEventListener(
  "click",
  (e) => {
    const target = e.target as HTMLElement;
    const hide = target.closest?.("[data-act=hide]") as HTMLElement | null;
    if (hide) {
      e.stopPropagation();
      const entry = Number(hide.dataset.entry);
      const row = state?.sectors.open?.nodes.find((r) => r.entry === entry);
      if (row) post({ type: "sectors.hide", entry, hidden: !row.hidden });
      return;
    }
    const v = target.closest?.("rn-item")?.getAttribute("value");
    if (v === null || v === undefined) return;
    const entry = Number(v);
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
  true,
);

// ---- the project picker (REDcode #32) ----------------------------------------------------------------
//
// With projects open in more than one REDcode window, a row of buttons on the Bake tab and in the Import
// box: Follow REDcode (the window used last) or one project, which then stays EDGEbuilder's while it is open.

const projectsHtml: Record<string, string> = {};

function renderProjects(id: string, s: Snapshot): void {
  const list = s.sources.projects ?? [];
  $(id).hidden = list.length < 2;
  if (list.length < 2) return;
  const picked = s.sources.picked ?? null;
  const button = (dir: string | null, label: string, tip: string) =>
    `<rn-button data-dir="${esc(dir ?? "")}"${dir === picked || (dir && picked && sameFile(dir, picked)) ? "" : ' variant="ghost"'} title="${esc(tip)}">${esc(label)}</rn-button>`;
  const html = [`<span class="count">Project:</span>`, button(null, "Follow REDcode", "The project in the VS Code window used last"), ...list.map((p) => button(p.dir, p.name, p.dir))].join("");
  if (html !== projectsHtml[id]) $(id).innerHTML = projectsHtml[id] = html;
}

for (const id of ["bakeProjects", "importProjects"]) {
  $(id).addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest?.("rn-button") as HTMLElement | null;
    if (!b) return;
    post({ type: "project.pick", dir: b.dataset.dir || null });
  });
}

// ---- the left drawers (0.14.0) ------------------------------------------------------------------------
//
// One drawer at a time to the left of the window: Objects, the Library when it is out of the window,
// Previews, or the Sector drawer (which the mod keeps). Opening one closes the others.

let libraryDrawerOpen = false;
let previewsOpen = false;
/** The Import file picker, opened by the folder button beside the Import path. */
let filesOpen = false;
/** Tools (T0): a tool's drawer, and the tool mounted in it. */
let toolOpen = false;
const toolDrawer = new ToolDrawer({
  body: $("toolBody"),
  status: $("toolStatus"),
  state: () => state,
  log: (id, text, tone) => post({ type: "tools.log", id, text, tone }),
  close: () => openLeft("none"),
});
/** The Preview drawer beside the Previews drawer, for a picture clicked there (Settings: "A picture's details before Drop"). */
let tileDetail = false;
/** The Preview drawer beside the Objects drawer, for an object's eye there; the object it shows. */
let objectPreview = false;
let objectLike: SceneObject | undefined;
/** The Explorer's width (its head's arrows), which places its Preview drawer. */
let exWidth = 480;
/** The Previews drawer's pictures, by path (declared here: renderLeft marks the picked one). */
const tiles = new Map<string, { el: HTMLElement; drawn: boolean; picture?: string; error?: string; asked?: number }>();

function openLeft(which: "objects" | "library" | "previews" | "explorer" | "preview" | "world" | "files" | "tool" | "none"): void {
  // A tool runs only while its drawer is open.
  toolOpen = which === "tool";
  if (!toolOpen) toolDrawer.unmount();
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
    confirming = undefined;
  }
  if (state) render(state);
  else renderLeft();
}

function renderLeft(): void {
  $("drawer").classList.toggle("open", drawerOpen);
  $("libraryDrawer").classList.toggle("open", libraryOut && libraryDrawerOpen);
  $("previewsDrawer").classList.toggle("open", previewsOpen);
  $("previewsEye").setAttribute("aria-pressed", String(previewsOpen));
  $("explorerDrawer").classList.toggle("open", explorerOpen);
  const worldOpen = previewWorld && !!state?.worldObjects.picked;
  const besideTiles = tileDetail && previewsOpen && !explorerOpen;
  const besideObjects = objectPreview && drawerOpen && !explorerOpen;
  $("exPreview").classList.toggle("open", worldOpen || ((explorerOpen || previewAlone || besideTiles || besideObjects) && !!exPicked));
  $("exPreview").classList.toggle("alone", !explorerOpen && !previewWorld && !besideTiles && !besideObjects);
  $("exPreview").classList.toggle("besidePreviews", besideTiles);
  $("exPreview").classList.toggle("besideObjects", besideObjects);
  ($("exPreview") as HTMLElement).style.right = explorerOpen && !previewWorld ? `${656 + exWidth + 8}px` : "";
  for (const t of tiles.values()) t.el.classList.toggle("picked", besideTiles && t.el.dataset.path === exPicked?.path);
  $("exPreview").classList.toggle("world", previewWorld);
  $("explorerOpen").setAttribute("aria-pressed", String(explorerOpen));
  $("fileDrawer").classList.toggle("open", filesOpen);
  $("toolDrawer").classList.toggle("open", toolOpen);
  $("importBrowse").setAttribute("aria-pressed", String(filesOpen));
  if (!worldOpen && ((!explorerOpen && !previewAlone && !besideTiles && !besideObjects) || !exPicked)) stopExView();
}

// ---- the Library out of the window (0.14.0) ------------------------------------------------------------
//
// The icon at the top right of the Library tree moves the tree into a drawer to the left, with more room;
// a Library button and the same icon stay where it was. The Picked panel stays on the tab, and a pick in
// the drawer shows the tab. The choice is kept in this page's storage.

let libraryOut = false;
try {
  libraryOut = localStorage.getItem("edgebuilder.libraryOut") === "1";
} catch {
  // No storage: in the window.
}

function placeLibrary(): void {
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

function setLibraryOut(on: boolean): void {
  libraryOut = on;
  try {
    localStorage.setItem("edgebuilder.libraryOut", on ? "1" : "0");
  } catch {
    // No storage: for this session only.
  }
  placeLibrary();
  openLeft(on ? "library" : drawerOpen ? "objects" : previewsOpen ? "previews" : "none");
}

$("libraryOut").addEventListener("click", () => setLibraryOut(!libraryOut));
$("libraryDrawerIn").addEventListener("click", () => setLibraryOut(false));
$("libraryDrawerClose").addEventListener("click", () => openLeft("none"));
$("libraryOpen").addEventListener("click", () => openLeft(libraryDrawerOpen ? "none" : "library"));

/**
 * A drawer's width in steps: its head's two arrows make it wider (to the left) and back; the step is kept.
 * The Library drawer and the Explorer have them.
 */
function drawerWidths(drawer: string, shrink: string, grow: string, widths: number[], key: string, changed?: (w: number) => void): void {
  let step = 0;
  try {
    step = Number(localStorage.getItem(key) ?? 0) | 0;
  } catch {
    // No storage: the narrowest.
  }
  const size = (n: number) => {
    step = Math.max(0, Math.min(widths.length - 1, n));
    $(drawer).style.width = `${widths[step]}px`;
    $(shrink).toggleAttribute("disabled", step === 0);
    $(grow).toggleAttribute("disabled", step === widths.length - 1);
    try {
      localStorage.setItem(key, String(step));
    } catch {
      // No storage: for this session only.
    }
    changed?.(widths[step]);
  };
  $(grow).addEventListener("click", () => size(step + 1));
  $(shrink).addEventListener("click", () => size(step - 1));
  size(step);
}
drawerWidths("libraryDrawer", "libraryShrink", "libraryGrow", [420, 540, 680, 840], "edgebuilder.libraryWidth");
// The Explorer's Preview drawer stays beside it as it grows.
drawerWidths("explorerDrawer", "exShrink", "exGrow", [480, 600, 720, 840], "edgebuilder.explorerWidth", (w) => {
  exWidth = w;
  renderLeft();
});
placeLibrary();

// ---- the Import file picker (0.14.0) ---------------------------------------------------------------------
//
// The folder button beside the Import path opens a wide drawer that walks the disk one folder at a time
// (the mod lists it): the places on the left (the Library, the project's source\raw, EDGEfab's Desk, the
// user's folders, the drives), the folder's folders, GLB files and prop items on the right. Use this file
// (or a double-click on it) puts it in the Import path and picks it for Import. The last folder is kept.

let fileSeq = 0;
let files: FilesReply | undefined;
let fileChosen: string | undefined;
let fileFilter = "";

function fileStart(): string | undefined {
  // The folder of a path typed in, else the folder shown last.
  const typed = ($<Field>("importPath").value ?? "").trim().replace(/^"(.*)"$/, "$1");
  if (typed) return typed.toLowerCase().endsWith(".glb") || typed.toLowerCase().endsWith(".prop.asset") ? typed.replace(/[\\/][^\\/]*$/, "") : typed;
  try {
    return localStorage.getItem("edgebuilder.fileDir") ?? undefined;
  } catch {
    return undefined;
  }
}

function askFiles(dir: string | undefined): void {
  post({ type: "files", seq: ++fileSeq, dir });
}

function filesCame(m: FilesReply): void {
  if (m.seq !== fileSeq) return;
  // A folder that cannot be read keeps the one shown, with why.
  if (m.why && files && !m.folders.length && !m.files.length) {
    $("fileInfo").textContent = m.why;
    return;
  }
  if (files?.dir !== m.dir) {
    fileFilter = "";
    $<Field>("fileFilter").value = "";
  }
  files = m;
  $<Field>("filePath").value = m.dir;
  if (!m.why) {
    try {
      localStorage.setItem("edgebuilder.fileDir", m.dir);
    } catch {
      // No storage: from the first place next time.
    }
  }
  renderFiles();
}

const fileWhen = (ms: number) => {
  if (!ms) return "";
  const d = new Date(ms);
  const two = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`;
};
const fileSize = (b: number) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

function renderFiles(): void {
  const f = files;
  const places = f?.places ?? [];
  // The place the folder shown is in: the longest one it starts with.
  const lower = (f?.dir ?? "").toLowerCase();
  const inPlace = places.filter((p) => lower === p.dir.toLowerCase().replace(/[\\/]$/, "") || lower.startsWith(p.dir.toLowerCase().replace(/[\\/]?$/, "\\")) || lower === p.dir.toLowerCase()).sort((a, b) => b.dir.length - a.dir.length)[0];
  const kinds: Record<string, string> = { known: "", user: "", drive: "drive" };
  $("filePlaces").innerHTML = places
    .map((p, i) => {
      const gap = i > 0 && places[i - 1].kind !== p.kind ? ' style="margin-top:8px"' : "";
      return `<rn-item value="${esc(p.dir)}" title="${esc(p.dir)}"${p === inPlace ? " selected" : ""}${gap}>${esc(p.label)}<span slot="end">${esc(kinds[p.kind] ?? "")}</span></rn-item>`;
    })
    .join("");
  ($("fileUp") as HTMLElement).toggleAttribute("disabled", !f?.parent);
  if (!f) {
    $("fileList").innerHTML = `<rn-item disabled>reading...</rn-item>`;
    $("fileInfo").textContent = "";
    return;
  }
  const text = fileFilter.toLowerCase();
  const match = (name: string) => !text || name.toLowerCase().includes(text);
  const folders = f.folders.filter((d) => !d.prop && match(d.name));
  const props = f.folders.filter((d) => d.prop && match(`${d.name} ${d.prop}`));
  const glbs = f.files.filter((x) => match(x.name));
  const rows: string[] = [];
  for (const d of folders) rows.push(`<rn-item value="d:${esc(d.path)}" title="${esc(d.path)}"><span class="fold">▸</span>${esc(d.name)}<span slot="end"><span class="when">${esc(fileWhen(d.changed))}</span></span></rn-item>`);
  for (const d of props) rows.push(`<rn-item value="f:${esc(d.path)}" title="${esc(d.path)}"${fileChosen === d.path ? " selected" : ""}><span class="fold"></span>${esc(d.prop ?? d.name)}<span slot="end">prop<span class="when">${esc(fileWhen(d.changed))}</span></span></rn-item>`);
  for (const x of glbs) rows.push(`<rn-item value="f:${esc(x.path)}" title="${esc(x.path)}"${fileChosen === x.path ? " selected" : ""}><span class="fold"></span>${esc(x.name)}<span slot="end"><span class="size">${esc(fileSize(x.bytes))}</span><span class="when">${esc(fileWhen(x.changed))}</span></span></rn-item>`);
  if (!rows.length) rows.push(`<rn-item disabled>${esc(f.why ?? (text ? "nothing here matches" : "no folders or GLB files here"))}</rn-item>`);
  $("fileList").innerHTML = rows.join("");
  const n = (k: number, one: string, many: string) => `${k.toLocaleString()} ${k === 1 ? one : many}`;
  $("fileInfo").textContent = f.why ?? `${n(folders.length, "folder", "folders")}, ${n(glbs.length, "GLB file", "GLB files")}${props.length ? `, ${n(props.length, "prop", "props")}` : ""}${text ? " match" : ""}${f.more ? " (a very big folder: only the first 3,000 entries)" : ""}. A click opens a folder or picks a file; a double-click on a file uses it.`;
  $("fileChosen").textContent = fileChosen ?? "Pick a .glb file, or a prop from EDGEfab's Desk";
  $("fileUse").toggleAttribute("disabled", !fileChosen);
}

function useFile(file: string): void {
  $<Field>("importPath").value = file;
  openLeft("none");
  pickTyped();
}

// ---- tools (T0, docs/tools.md) ---------------------------------------------------------------------------
//
// Installed tools are listed in Settings until T1's Tools tab; Open mounts one in a drawer to the left.


function renderTools(s: Snapshot): void {
  const tools = s.tools ?? [];
  $("toolsBox").hidden = !tools.length;
  const html = tools
    .map(
      (t) =>
        `<div class="toolRow" title="${esc(`${t.description}${t.wants.length ? `\nWants: ${t.wants.join(", ")}` : ""}\n${t.dir}`)}"><span class="name">${esc(t.label)} <span class="dim">${esc(t.version)}</span>${t.problem ? `<br><span class="why">${esc(t.problem)}</span>` : ""}</span><rn-button variant="ghost" data-tool="${esc(t.id)}"${toolOpen && toolDrawer.id === t.id ? ' aria-pressed="true"' : ""}>${toolOpen && toolDrawer.id === t.id ? "Close" : "Open"}</rn-button></div>`,
    )
    .join("");
  const list = $("toolsList");
  if (list.dataset.html !== html) {
    list.innerHTML = html;
    list.dataset.html = html;
  }
  toolDrawer.sync(tools);
}

function openTool(id: string): void {
  const t = state?.tools.find((x) => x.id === id);
  if (!t) return;
  if (toolOpen && toolDrawer.id === id) return openLeft("none");
  $("toolTitle").textContent = t.label;
  $("toolTitle").title = `${t.name} ${t.version}: ${t.description}`;
  ($("toolDrawer") as HTMLElement).style.width = `${t.width}px`;
  openLeft("tool");
  void toolDrawer.open(t);
  if (state) renderTools(state);
}

$("toolsList").addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>("[data-tool]");
  if (b?.dataset.tool) openTool(b.dataset.tool);
});
$("toolsScan").addEventListener("click", () => post({ type: "tools.scan" }));
$("toolReload").addEventListener("click", () => toolDrawer.reload());
$("toolClose").addEventListener("click", () => openLeft("none"));

$("importBrowse").addEventListener("click", () => openLeft(filesOpen ? "none" : "files"));
$("fileClose").addEventListener("click", () => openLeft("none"));
$("fileUp").addEventListener("click", () => files?.parent && askFiles(files.parent));
$<Field>("filePath").addEventListener("submit", () => {
  const dir = ($<Field>("filePath").value ?? "").trim().replace(/^"(.*)"$/, "$1");
  if (dir) askFiles(dir);
});
$("fileFilter").addEventListener("input", () => {
  fileFilter = ($<Field>("fileFilter").value ?? "").trim();
  renderFiles();
});
$("filePlaces").addEventListener("select", (e) => {
  const dir = (e as CustomEvent<{ value: string }>).detail.value;
  if (dir) askFiles(dir);
});
$("fileList").addEventListener("select", (e) => {
  const value = (e as CustomEvent<{ value: string }>).detail.value ?? "";
  if (value.startsWith("d:")) return askFiles(value.slice(2));
  if (!value.startsWith("f:")) return;
  fileChosen = value.slice(2);
  renderFiles();
});
// A double-click on a file uses it. Not the browser's dblclick: the first click's select redraws the rows,
// so the second lands on a new element (as on the Library tab).
let lastFileClick = { value: "", at: 0 };
$("fileList").addEventListener(
  "click",
  (e) => {
    const value = (e.target as HTMLElement).closest?.("rn-item")?.getAttribute("value") ?? "";
    const twice = value.startsWith("f:") && value === lastFileClick.value && performance.now() - lastFileClick.at < 500;
    lastFileClick = twice ? { value: "", at: 0 } : { value, at: performance.now() };
    if (twice) useFile(value.slice(2));
  },
  true,
);
$("fileUse").addEventListener("click", () => fileChosen && useFile(fileChosen));

// ---- the Previews drawer (0.14.0) ------------------------------------------------------------------------
//
// The eye beside the result count opens the search results as tiles: a mesh as a small 3D picture (the mod
// exports a plain model through REDbridge and keeps the picture), an entity or a person by its name for now.
// Tiles are drawn as they scroll into view; the mouse on a picture turns it. A click picks the result,
// closes the drawer and starts Drop at click.

let previews: Previews | undefined;
let previewsWhy = "";
let previewsLoading: Promise<void> | undefined;
/** The tiles on show, by path, and what each has: a picture, an error, or when it was asked for. */
let tilesKey = "";
/** Models this session already has, for turning a picture under the mouse (the newest few). */
const models = new Map<string, Part[]>();
let spinning: { path: string; stop?: () => void } | undefined;

function loadPreviews(): Promise<void> {
  previewsLoading ??= (async () => {
    try {
      // A path esbuild leaves alone: previews.js is its own file beside app.js, loaded only now.
      const mod = (await import(new URL("./previews.js", import.meta.url).href)) as typeof import("./previews");
      previews = mod.createPreviews(256);
    } catch (err) {
      previewsWhy = `3D pictures cannot be drawn here (${(err as Error).message || "no WebGL"}); the tiles show names.`;
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

function renderPreviews(s: Snapshot): void {
  ($("previewsEye") as HTMLButtonElement).disabled = !s.results.length;
  if (!s.results.length && previewsOpen) previewsOpen = false;
  if (!previewsOpen) return;
  const people = s.results.filter((r) => r.kind === "npc").length;
  $("previewsTitle").textContent = s.query.text ? `Previews: ${s.query.text}` : "Previews";
  $("previewsInfo").textContent = [
    `${s.results.length} result${s.results.length === 1 ? "" : "s"}${people ? ` (NPCs by name for now)` : ""}. The mouse on a picture turns it; a click ${tileDetails ? "shows its details beside this, with Drop" : "starts Drop at click"}.`,
    previewsWhy,
    s.bridge.status !== "ready" && !previewsWhy ? "New pictures need REDbridge: those kept from before still show." : "",
  ]
    .filter(Boolean)
    .join(" ");
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
    // Meshes and entities get a picture; a person (a TweakDB record) by its name for now.
    const drawn = r.kind !== "npc";
    const was = old.get(r.path);
    el.innerHTML = `<div class="pic">${was?.picture ? `<img alt="" src="${was.picture}">` : drawn ? "" : "NPC"}</div><div class="name">${esc(labelOf(r))}</div>`;
    grid.appendChild(el);
    tiles.set(r.path, { el, drawn, picture: was?.picture, error: was?.error });
    seen.observe(el);
  }
  grid.scrollTop = 0;
}

/** Tiles that come into view are asked for, a moment after the scrolling stops. */
const inView = new Set<string>();
let askSoon: ReturnType<typeof setTimeout> | undefined;
const seen = new IntersectionObserver(
  (entries) => {
    for (const e of entries) {
      const p = (e.target as HTMLElement).dataset.path ?? "";
      if (e.isIntersecting) inView.add(p);
      else inView.delete(p);
    }
    clearTimeout(askSoon);
    askSoon = setTimeout(askVisible, 150);
  },
  { root: document.getElementById("previewGrid"), rootMargin: "200px 0px" },
);

function askVisible(): void {
  if (!previewsOpen || !previews) return;
  const now = performance.now();
  const paths = [...inView].filter((p) => {
    const t = tiles.get(p);
    // Asked and not answered: again after a while (REDbridge may have been busy or restarting).
    return t && t.drawn && !t.picture && !t.error && (!t.asked || now - t.asked > 20000);
  });
  if (!paths.length) return;
  for (const p of paths) {
    const t = tiles.get(p)!;
    t.asked = now;
    t.el.querySelector(".pic")!.textContent = "drawing...";
  }
  post({ type: "preview.ask", paths });
}

const fromBase64 = (b64: string): ArrayBuffer => {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
};

async function previewCame(m: PreviewReply): Promise<void> {
  const t = tiles.get(m.path);
  const pic = t?.el.querySelector(".pic") as HTMLElement | undefined;
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
  let picture = m.png ? `data:image/png;base64,${m.png}` : undefined;
  if (m.parts) {
    const parts: Part[] = m.parts.map((p) => ({ glb: fromBase64(p.glb), offset: p.offset, scale: p.scale }));
    models.set(m.path, parts);
    while (models.size > 40) models.delete(models.keys().next().value!);
    if (!t?.picture && previews) {
      try {
        picture = await previews.picture(parts);
        post({ type: "preview.save", key: m.key, png: picture.slice(picture.indexOf(",") + 1) });
      } catch (err) {
        if (t) t.error = (err as Error).message;
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

// The mouse on a picture turns the model, one turn every eight seconds, until the mouse leaves.
async function startSpin(path: string): Promise<void> {
  const t = tiles.get(path);
  const parts = models.get(path);
  if (!t || !previews || spinning?.path !== path) return;
  if (!parts) return post({ type: "preview.ask", paths: [path], glb: true });
  const pic = t.el.querySelector(".pic") as HTMLElement;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256;
  const stop = await previews.spin(parts, canvas);
  if (spinning?.path !== path) return stop();
  // The turning model's canvas is see-through: the still picture under it hides while it turns.
  pic.appendChild(canvas);
  pic.classList.add("spinning");
  spinning.stop = () => {
    stop();
    canvas.remove();
    pic.classList.remove("spinning");
  };
}

function stopSpin(): void {
  spinning?.stop?.();
  spinning = undefined;
}

$("previewGrid").addEventListener("mouseover", (e) => {
  const tile = (e.target as HTMLElement).closest?.(".tile") as HTMLElement | null;
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
  const path = ((e.target as HTMLElement).closest?.(".tile") as HTMLElement | null)?.dataset.path;
  if (!path) return;
  lookedAt = path;
  appearance = undefined;
  post({ type: "look", path });
  stopSpin();
  const r = state?.results.find((x) => x.path === path);
  if (tileDetails && r) {
    // Its details beside the pictures: the model in 3D, what is known, its looks, and Drop.
    exPicked = r;
    tileDetail = true;
    if (state) render(state);
    else renderLeft();
    return;
  }
  openLeft("none");
  startDropAtClick(path, undefined);
});

// Settings: a click on a picture opens its details first (on by default), or starts Drop at click at once.
let tileDetails = true;
try {
  tileDetails = localStorage.getItem("edgebuilder.tileDetails") !== "0";
} catch {
  // No storage: on.
}
($("tileDetails") as HTMLElement & { checked: boolean }).checked = tileDetails;
$("tileDetails").addEventListener("change", (e) => {
  tileDetails = !!(e as CustomEvent<{ checked: boolean }>).detail.checked;
  try {
    localStorage.setItem("edgebuilder.tileDetails", tileDetails ? "1" : "0");
  } catch {
    // No storage: for this session only.
  }
  if (!tileDetails && tileDetail) {
    tileDetail = false;
    renderLeft();
  }
});

// ---- the Explorer (0.14.0) ------------------------------------------------------------------------------
//
// The folder icon beside the search box opens the Explorer, a wider drawer to the left: the game's folders,
// each mod, the open project and the game's people, opened folder by folder (the mod answers from the asset
// index). A pick there opens the Preview drawer beside it: the object in 3D (the mouse turns it), what is known
// about it, and Drop, which starts Drop at click. The two open and close together.

let explorerOpen = false;
/**
 * The Preview drawer on its own, beside the window: a search result clicked with the Preview switch on (beside the
 * result count). With the Explorer open, a result shows beside the Explorer instead.
 */
let previewAlone = false;
/** The Preview drawer at the screen's left, for the thing picked in the world with the cursor. */
let previewWorld = false;
let previewPick = false;
/** Pick under the cursor (the World tab's switch): outlines what a click would pick, and a click picks any mesh. */
let freePick = false;
let hoverSent = false;
try {
  freePick = localStorage.getItem("edgebuilder.freePick") === "1";
} catch {
  // No storage: off.
}
($("freePick") as HTMLElement & { checked: boolean }).checked = freePick;
$("freePick").addEventListener("change", (e) => {
  freePick = !!(e as CustomEvent<{ checked: boolean }>).detail.checked;
  try {
    localStorage.setItem("edgebuilder.freePick", freePick ? "1" : "0");
  } catch {
    // No storage: for this session only.
  }
  if (!freePick && !worldTip && hoverSent) {
    hoverSent = false;
    post({ type: "world.hoverRay", ray: null });
  }
});

/** A pick in the world on its way: the mod's count of finished picks when it was asked (the spinner turns until it grows). */
let pickWaitFrom: number | undefined;

/** Show tooltip (the World tab's switch, beside Pick under the cursor): the picked object's details beside it in the world. */
let worldTip = false;
try {
  worldTip = localStorage.getItem("edgebuilder.worldTip") === "1";
} catch {
  // No storage: off.
}
($("worldTip") as HTMLElement & { checked: boolean }).checked = worldTip;
$("worldTip").addEventListener("change", (e) => {
  worldTip = !!(e as CustomEvent<{ checked: boolean }>).detail.checked;
  try {
    localStorage.setItem("edgebuilder.worldTip", worldTip ? "1" : "0");
  } catch {
    // No storage: for this session only.
  }
  if (!worldTip) viewport.setWorldTip(undefined);
  // On: the mod tells again what is under the cursor, even the same object as before.
  else post({ type: "world.hoverRay", ray: null });
  if (!freePick && !worldTip && hoverSent) {
    hoverSent = false;
    post({ type: "world.hoverRay", ray: null });
  }
});

/**
 * The tooltip for a thing picked in the world: its box's corners (REDnode's box for a mesh, in the world or, when the
 * node's place is not inside it, in the mesh's own space; a door-sized box at a door's place) and its details.
 */
function tipFor(p: WorldThing): WorldTip {
  const at = p.position as V3;
  let corners: V3[];
  const box = p.box;
  const near = box && at.every((v, i) => v >= box.min[i] - 1 && v <= box.max[i] + 1);
  const cornersOf = (min: number[], max: number[]): V3[] => [0, 1, 2, 3, 4, 5, 6, 7].map((k) => [k & 1 ? max[0] : min[0], k & 2 ? max[1] : min[1], k & 4 ? max[2] : min[2]] as V3);
  if (box && near) corners = cornersOf(box.min, box.max);
  else if (box) {
    // The mesh's own space: scaled, turned and moved to the node's place.
    const q = (p.orientation ?? [0, 0, 0, 1]) as Q;
    const sc = p.scale ?? [1, 1, 1];
    corners = cornersOf(box.min, box.max).map((c) => add(at, qRotateV(q, [c[0] * sc[0], c[1] * sc[1], c[2] * sc[2]])));
  } else corners = cornersOf([at[0] - 0.8, at[1] - 0.8, at[2]], [at[0] + 0.8, at[1] + 0.8, at[2] + 2.3]);
  const xs = corners.map((c) => c[0]);
  const ys = corners.map((c) => c[1]);
  const zs = corners.map((c) => c[2]);
  const size = [Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), Math.max(...zs) - Math.min(...zs)];
  const lines = [
    `${p.className}${p.what === "door" ? ", a door" : p.what === "fakeDoor" ? ", a painted-on door" : ""}`,
    box ? `about ${size.map((v) => v.toFixed(1)).join(" × ")} m` : "",
    p.what === "fakeDoor" && !p.ray ? "" : `Solid: ${solidOf(p).word}`,
    collisionLine(p),
    p.door ? doorText(p.door) : "",
    p.removedBy ? `removed by this scene (${p.removedBy})` : "",
  ].filter(Boolean);
  return { corners, title: p.resource ? shortName(p.resource) : p.label, lines, area: freeArea };
}

/** The screen between the open drawers: those beside the window on the right, the picked thing's drawer on the left. */
function freeArea(): { left: number; right: number } {
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

/** A vector turned by a quaternion. */
function qRotateV(q: Q, v: V3): V3 {
  const [x, y, z, w] = q;
  const tx = 2 * (y * v[2] - z * v[1]);
  const ty = 2 * (z * v[0] - x * v[2]);
  const tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)];
}

/** Opens the Preview drawer at the screen's left for the thing picked in the world; the other left drawers close. */
function showWorldPreview(): void {
  drawerOpen = libraryDrawerOpen = previewsOpen = explorerOpen = previewAlone = filesOpen = false;
  previewWorld = true;
  if (state?.sectors.open) post({ type: "sectors.close" });
}

let worldLookAsked = "";

/** The Preview drawer for the thing picked in the world: its model, what the game says of it, and whether it is solid there. */
function renderWorldPreview(s: Snapshot): void {
  const p = s.worldObjects.picked;
  if (!p) {
    stopExView();
    return;
  }
  const res = p.resource && kindOfPath(p.resource) ? p.resource : undefined;
  $("exTitle").textContent = p.label;
  $("exTitle").title = p.resource ?? "";
  if (res) {
    void showExView(res);
    // Its size, collision data and looks, from REDbridge's mesh.info (once per pick).
    if (worldLookAsked !== res) {
      worldLookAsked = res;
      post({ type: "look", path: res });
    }
  } else {
    stopExView();
    ($("exCanvas") as HTMLCanvasElement).getContext("2d")?.clearRect(0, 0, 378, 400);
    $("exNote").textContent = p.resource ? "No 3D preview for this kind of file." : "Its file is not known, so there is no 3D preview.";
  }
  const info = res && s.looked?.path === res ? s.looked.info : undefined;
  const b = info?.bounds;
  const sc = p.scale ?? [1, 1, 1];
  const node = p.node;
  const d = p.door;
  const so = solidOf(p);
  const solid =
    p.ray?.solid && p.ray.distance !== undefined
      ? `Yes: the game's physics stopped the click's line on it (${p.ray.distance.toFixed(1)} m from the camera)`
      : so.word === "No" && p.ray
        ? "No: the click's line went through it (walk-through here, or its collision is a separate node)"
        : `${so.word}: ${so.why}`;
  const coll = p.collision ?? info?.hasCollision;
  const lines: [string, string][] = [
    ["Name", p.label],
    ["Kind", `${p.className}${p.what === "door" ? " (a door that opens)" : p.what === "fakeDoor" ? " (a painted-on door)" : ""}`],
    ["Solid", solid],
  ];
  if (res && p.what === "mesh") lines.push(["Collision data", coll === true ? "Yes: a copy can be made solid" : coll === false ? "No: a copy cannot be made solid, it needs a collision box" : "reading..."]);
  if (p.resource) lines.push(["Path", p.resource]);
  if (p.appearance) lines.push(["Look", p.appearance]);
  if (b) lines.push(["Size", `${((b.max[0] - b.min[0]) * sc[0]).toFixed(2)} × ${((b.max[1] - b.min[1]) * sc[1]).toFixed(2)} × ${((b.max[2] - b.min[2]) * sc[2]).toFixed(2)} m${sc.some((v) => Math.abs(v - 1) > 1e-3) ? ` (scaled ${sc.map((v) => v.toFixed(2)).join(", ")})` : ""}`]);
  lines.push(["At", p.position.map((v) => v.toFixed(2)).join(", ")]);
  if (d) lines.push(["Door", [doorText(d), d.initial ? `starts ${d.initial.toLowerCase()}` : "", d.closesItself ? "closes by itself" : ""].filter(Boolean).join("; ")]);
  if (node) lines.push(["Node", `${node.type}, entry ${node.entry} (node ${node.node})`], ["Sector", node.sector ? shortName(node.sector) : node.sectorHash]);
  else if (p.note) lines.push(["Node", p.note]);
  if (p.ref) lines.push(["Ref", p.ref]);
  if (p.proxies?.length) lines.push(["Proxy", p.proxies.map((x) => `entry ${x.entry} in ${x.sector ? shortName(x.sector) : x.sectorHash}`).join(", ")]);
  if (p.removedBy) lines.push(["Scene", `removed by this scene (${p.removedBy})`]);
  $("exProps").innerHTML = lines.map(([k, v]) => `<div class="prop"><span class="k">${esc(k)}</span><span class="v">${esc(v)}</span></div>`).join("");
  $("exAppearances").hidden = true;
  $("exAppLabel").hidden = true;
  $("exDrop").textContent = "Drop a copy";
  $("exDrop").toggleAttribute("disabled", !res);
  $("exDrop").title = res ? "A copy of it in the open scene: Drop at click starts with its outline under the cursor" : "Its file is not known";
}
try {
  previewPick = localStorage.getItem("edgebuilder.previewPick") === "1";
} catch {
  // No storage: off.
}
($("previewPick") as HTMLElement & { checked: boolean }).checked = previewPick;

/** Shows a search result in the Preview drawer. */
function previewResult(path: string): void {
  const r = state?.results.find((x) => x.path === path);
  if (!r) return;
  exPicked = r;
  if (explorerOpen) {
    revealInExplorer(r);
    renderLeft();
    if (state) render(state);
  } else if (previewsOpen) {
    // The pictures are open: its details beside them.
    tileDetail = true;
    if (state) render(state);
  } else openLeft("preview");
}

$("previewPick").addEventListener("change", (e) => {
  previewPick = !!(e as CustomEvent<{ checked: boolean }>).detail.checked;
  try {
    localStorage.setItem("edgebuilder.previewPick", previewPick ? "1" : "0");
  } catch {
    // No storage: for this session only.
  }
  if (previewPick && lookedAt) previewResult(lookedAt);
  else if (!previewPick && previewAlone) openLeft("none");
});
/** The Preview drawer beside the Explorer, for the object picked there. */
let exPicked: AssetEntry | undefined;
let exRoots: ExploreRoot[] = [];
/** What each folder holds, by `root|dir`, once the mod has said. */
const exCache = new Map<string, ExploreReply>();
/** Open folders (and places), by `root|dir`; the game's top is open at first. */
const exOpen = new Set<string>(["game|"]);
const exAsked = new Set<string>();
/** The folder a filter looks in: the last one clicked. */
let exFolder = { root: "game", dir: "" };
let exFilter = "";
let exFound: ExploreReply | undefined;
let exSeq = 0;
let exFilterSeq = 0;
let exCounts = "";
const exEntries = new Map<string, AssetEntry>();

const exKey = (root: string, dir: string) => `${root}|${dir.toLowerCase()}`;
const exJoin = (dir: string, name: string) => (dir ? `${dir}\\${name}` : name);

function exAsk(root: string, dir: string): void {
  const key = exKey(root, dir);
  if (exAsked.has(key)) return;
  exAsked.add(key);
  post({ type: "explore", seq: ++exSeq, root, dir });
}

function explorerCame(m: ExploreReply): void {
  exRoots = m.roots;
  for (const e of m.items) exEntries.set(e.path, e);
  if (m.text) {
    if (m.seq === exFilterSeq) exFound = m;
  } else if (m.root) exCache.set(exKey(m.root, m.dir), m);
  if (!exFolder.root || !exRoots.some((r) => r.id === exFolder.root)) exFolder = { root: exRoots[0]?.id ?? "game", dir: "" };
  renderExplorer();
}

/** Asks again for what is open when the index, the mods or the project changed. */
function explorerFresh(s: Snapshot): void {
  const counts = `${s.index.count}|${s.sources.mods.assets}|${s.sources.project?.assets ?? 0}|${s.npcs.count}`;
  if (counts === exCounts) return;
  exCounts = counts;
  exCache.clear();
  exAsked.clear();
  exFound = undefined;
  if (explorerOpen) {
    post({ type: "explore", seq: ++exSeq, root: "", dir: "" });
    if (exFilter) askExFilter();
    renderExplorer();
  }
}

function askExFilter(): void {
  exFilterSeq = ++exSeq;
  post({ type: "explore", seq: exFilterSeq, root: exFolder.root, dir: exFolder.dir, text: exFilter });
}

function renderExplorer(): void {
  if (!explorerOpen) return;
  const rows: string[] = [];
  const pad = (depth: number) => ` style="padding-left:${8 + depth * 16}px"`;
  const itemRow = (e: AssetEntry, depth: number, label: string) =>
    `<rn-item value="i:${esc(e.path)}" title="${esc(rowTitle(e))}"${exPicked?.path === e.path ? " selected" : ""}${pad(depth)}><span class="fold"></span>${esc(label)}<span slot="end">${esc(e.kind === "npc" ? "NPC" : e.kind)}</span></rn-item>`;
  const folderLabel = exFolder.dir ? `${exRoots.find((r) => r.id === exFolder.root)?.label ?? exFolder.root} > ${exFolder.dir.replace(/\\/g, " > ")}` : exRoots.find((r) => r.id === exFolder.root)?.label ?? "";
  $<Field>("exFilter").setAttribute("placeholder", `Filter in ${folderLabel || "the game"}, e.g. crate`);
  if (exFilter) {
    const f = exFound;
    if (!f) rows.push(`<rn-item disabled${pad(0)}>looking...</rn-item>`);
    else {
      for (const e of f.items) rows.push(itemRow(e, 0, e.kind === "npc" ? labelOf(e) : f.dir && e.path.toLowerCase().startsWith(`${f.dir.toLowerCase()}\\`) ? e.path.slice(f.dir.length + 1) : e.path));
      if (!f.items.length) rows.push(`<rn-item disabled${pad(0)}>nothing here matches</rn-item>`);
    }
    $("exInfo").textContent = f ? `${f.total.toLocaleString()} match${f.total === 1 ? "" : "es"} in ${folderLabel}${f.total > f.items.length ? `, the first ${f.items.length} shown` : ""}` : "";
  } else {
    const walk = (root: string, dir: string, depth: number) => {
      const got = exCache.get(exKey(root, dir));
      if (!got) {
        exAsk(root, dir);
        rows.push(`<rn-item disabled${pad(depth)}><span class="fold"></span>reading...</rn-item>`);
        return;
      }
      for (const f of got.folders) {
        const sub = exJoin(dir, f.name);
        const key = exKey(root, sub);
        const here = exFolder.root === root && exFolder.dir.toLowerCase() === sub.toLowerCase();
        rows.push(`<rn-item value="d:${esc(root)}|${esc(sub)}"${here ? ' class="here"' : ""}${pad(depth)}><span class="fold">${exOpen.has(key) ? "▾" : "▸"}</span>${esc(f.name)}<span slot="end">${f.count.toLocaleString()}</span></rn-item>`);
        if (exOpen.has(key)) walk(root, sub, depth + 1);
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
      rows.push(`<rn-item value="d:${esc(r.id)}|"${here ? ' class="here"' : ""}${pad(0)}><span class="fold">${exOpen.has(key) ? "▾" : "▸"}</span><span class="section">${esc(r.label)}</span><span slot="end">${r.count.toLocaleString()}</span></rn-item>`);
      if (exOpen.has(key)) walk(r.id, "", 1);
    }
    $("exInfo").textContent = exRoots.length ? "A click opens a folder; a pick shows it beside this, in 3D. Typing filters in the folder clicked last." : "";
  }
  $("exList").innerHTML = rows.join("");
  // A result revealed: scrolled to once its folder's rows have come.
  if (exReveal) {
    const row = [...$("exList").querySelectorAll("rn-item")].find((x) => x.getAttribute("value") === `i:${exReveal}`);
    if (row) {
      row.scrollIntoView({ block: "center" });
      exReveal = undefined;
    }
  }
}

/** The row to scroll to when it comes: a search result revealed in the tree. */
let exReveal: string | undefined;

/** Opens the Explorer's folders down to a search result and picks it there (its row selected and scrolled to). */
function revealInExplorer(e: AssetEntry): void {
  const root = e.kind === "npc" ? "people" : e.source?.kind === "project" ? "project" : e.source?.kind === "mod" ? `mod:${e.source.name}` : "game";
  let dir = "";
  exOpen.add(exKey(root, ""));
  for (const seg of exploreSegments(root, e.path).slice(0, -1)) {
    dir = exJoin(dir, seg);
    exOpen.add(exKey(root, dir));
  }
  exFolder = { root, dir };
  if (exFilter) {
    // The tree, not a filter's matches, so the folders show.
    exFilter = "";
    $<Field>("exFilter").value = "";
    exFound = undefined;
  }
  exReveal = e.path;
  renderExplorer();
}

$("explorerOpen").addEventListener("click", () => openLeft(explorerOpen ? "none" : "explorer"));
$("explorerClose").addEventListener("click", () => openLeft("none"));
$("exPreviewClose").addEventListener("click", () => {
  if (previewAlone || previewWorld) return openLeft("none");
  if (objectPreview) {
    // Back to the Objects drawer alone.
    objectPreview = false;
    if (state) render(state);
    else renderLeft();
    return;
  }
  if (tileDetail) {
    // Back to the pictures alone.
    tileDetail = false;
    renderLeft();
    return;
  }
  exPicked = undefined;
  renderLeft();
  renderExplorer();
});

let exTyping: ReturnType<typeof setTimeout> | undefined;
$("exFilter").addEventListener("input", () => {
  clearTimeout(exTyping);
  exTyping = setTimeout(() => {
    exFilter = ($<Field>("exFilter").value ?? "").trim();
    exFound = undefined;
    if (exFilter) askExFilter();
    renderExplorer();
  }, 200);
});

$("exList").addEventListener("select", (e) => {
  const value = (e as CustomEvent<{ value: string }>).detail.value ?? "";
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
  appearance = undefined;
  post({ type: "look", path: entry.path });
  renderLeft();
  renderExplorer();
  if (state) render(state);
});

// The Preview drawer: the model turning in the top half (the mouse turns it), what is known below, and Drop.

let exView: { path: string; stop?: () => void } | undefined;
let exGlbAsked = "";
/** Models that could not be had, and why. */
const exErrors = new Map<string, string>();

function stopExView(): void {
  exView?.stop?.();
  exView = undefined;
}

async function showExView(path: string): Promise<void> {
  if (exView?.path === path) return;
  stopExView();
  const view: { path: string; stop?: () => void } = { path };
  exView = view;
  const note = $("exNote");
  const canvas = $("exCanvas") as HTMLCanvasElement;
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
    exView = undefined;
    return;
  }
  note.textContent = "";
  try {
    const v = await previews.view(parts, canvas);
    if (exView !== view) return v.stop();
    view.stop = () => v.stop();
  } catch (err) {
    note.textContent = `No 3D preview: ${(err as Error).message}`;
  }
}

const kindOfPath = (p: string) => /\.(mesh|ent)$/i.test(p);

function renderExPreview(s: Snapshot): void {
  if (previewWorld) return renderWorldPreview(s);
  const copying = objectPreview && drawerOpen && !explorerOpen;
  $("exDrop").textContent = copying ? "Drop a copy" : "Drop";
  $("exDrop").removeAttribute("disabled");
  $("exDrop").title = copying
    ? "A copy of this object, with its look, scale, Solid and Seen from: the drawers close and Drop at click starts with its outline"
    : "Closes the drawers and starts Drop at click: the object's outline follows the cursor, a click puts it there, Esc cancels";
  const e = exPicked;
  if (!e || (!explorerOpen && !previewAlone && !(tileDetail && previewsOpen) && !copying)) {
    stopExView();
    return;
  }
  $("exTitle").textContent = labelOf(e);
  $("exTitle").title = e.path;
  void showExView(e.path);
  const info = s.looked?.path === e.path ? s.looked.info : undefined;
  const parts = models.get(e.path);
  const b = info?.bounds;
  const from = e.source ? (e.source.kind === "project" ? `the project ${e.source.name}` : `the mod ${e.source.name}`) : e.kind === "npc" ? "the game's TweakDB" : e.path.toLowerCase().startsWith("ep1\\") ? "the game (Phantom Liberty)" : "the game";
  // The Objects drawer's eye: the scene object as it is now (its scale, look, Solid), not as it was when the eye was pressed.
  const live = copying && objectLike ? (s.scene.objects.find((o) => o.id === objectLike!.id) ?? s.library.peek?.objects.find((o) => o.id === objectLike!.id) ?? objectLike) : undefined;
  if (live) objectLike = live;
  const sc = (live?.transform.scale ?? [1, 1, 1]) as number[];
  const scaled = sc.some((v) => Math.abs(v - 1) > 1e-3);
  const lines: [string, string][] = [
    ["Name", e.kind === "npc" ? (e.name ?? e.path) : shortName(e.path)],
    ["Path", e.path],
    ["Kind", e.kind === "npc" ? "a person (NPC)" : e.kind === "entity" ? "an entity" : "a mesh"],
    ["From", from + (e.replaces ? ", changing the game's file" : "")],
    ["Size", b ? `${((b.max[0] - b.min[0]) * sc[0]).toFixed(2)} × ${((b.max[1] - b.min[1]) * sc[1]).toFixed(2)} × ${((b.max[2] - b.min[2]) * sc[2]).toFixed(2)} m (width, depth, height)${scaled ? `, at its scale` : ""}` : info?.error ? info.error : s.bridge.status === "ready" ? "reading..." : "needs REDbridge"],
  ];
  if (live) {
    // A scene object (the Objects drawer's eye): its own settings, as they are now.
    lines.splice(1, 0, ["Object", live.id]);
    if (scaled) lines.push(["Scale", sc.map((v) => v.toFixed(2)).join(", ")]);
    if (live.appearance) lines.push(["Look", live.appearance]);
    if (live.kind === "mesh") lines.push(["Solid", live.solid ? "on: solid once baked" : "off: walk-through once baked"]);
    lines.push(["Seen from", live.streaming?.primary ? `${live.streaming.primary} m` : "by its size"]);
    lines.push(["At", live.transform.position.map((v) => v.toFixed(2)).join(", ")]);
  }
  if (e.kind === "mesh") lines.push([live ? "Collision" : "Solid", info?.hasCollision === true ? (live ? "its mesh has collision data" : "yes: it has collision") : info?.hasCollision === false ? (live ? "its mesh has no collision data" : "no: it has no collision data") : "not known yet"]);
  if (e.kind === "entity" && parts) lines.push(["Draws", `${parts.length} mesh${parts.length === 1 ? "" : "es"}${parts.length >= 16 ? " (the first 16 shown)" : ""}`]);
  if (e.kind === "npc" && e.template) lines.push(["Template", e.template]);
  if (e.size) lines.push(["File", `${(e.size / 1024).toFixed(e.size < 10240 ? 1 : 0)} KB`]);
  if (e.source) lines.push(["Archive", e.source.file]);
  $("exProps").innerHTML = lines.map(([k, v]) => `<div class="prop"><span class="k">${esc(k)}</span><span class="v">${esc(v)}</span></div>`).join("");
  const apps = info?.appearances ?? [];
  const list = $("exAppearances");
  if (apps.length > 1) {
    if (!appearance || !apps.includes(appearance)) appearance = apps[0];
    list.innerHTML = apps.map((a) => `<rn-item value="${esc(a)}"${a === appearance ? " selected" : ""}>${esc(a)}</rn-item>`).join("");
    list.hidden = false;
    $("exAppLabel").hidden = false;
    // The list fills the drawer down to Drop, once laid out: Properties keeps its height above it. Small first, so
    // a taller list from the last object cannot push Drop out of the drawer before it is measured.
    if (exFitFor !== e.path) {
      exFitFor = e.path;
      list.style.setProperty("--rn-list-height", "72px");
    }
    requestAnimationFrame(fitAppearances);
  } else {
    if (lookedAt === e.path) appearance = apps[0];
    list.hidden = true;
    $("exAppLabel").hidden = true;
  }
}

/** The object the looks list was last fitted for. */
let exFitFor = "";

/** The looks list as tall as the room between it and Drop (at least about two rows), so the drawer has no gap. */
function fitAppearances(): void {
  const list = $("exAppearances");
  if (list.hidden) return;
  const top = list.getBoundingClientRect().top;
  const bottom = ($("exDrop").closest(".row") as HTMLElement).getBoundingClientRect().top;
  const h = Math.max(72, Math.floor(bottom - top - 10));
  if (list.style.getPropertyValue("--rn-list-height") !== `${h}px`) list.style.setProperty("--rn-list-height", `${h}px`);
}

$("exAppearances").addEventListener("select", (e) => {
  appearance = (e as CustomEvent<{ value: string }>).detail.value;
});
$("exDrop").addEventListener("click", () => {
  if (previewWorld) {
    // A copy of what the game placed, into the open scene.
    const p = state?.worldObjects.picked;
    if (!p?.resource || !kindOfPath(p.resource)) return;
    openLeft("none");
    startDropAtClick(p.resource, p.appearance, shortName(p.resource));
    return;
  }
  const e = exPicked;
  if (!e) return;
  if (objectPreview && objectLike) {
    // A copy of the scene object: its look (or the one picked here), scale, Solid, Seen from, a person's settings.
    const o = objectLike;
    const like: DropLike = { scale: o.transform.scale as [number, number, number], solid: o.solid, streaming: o.streaming, props: o.props };
    openLeft("none");
    startDropAtClick(e.path, appearance ?? o.appearance, `a copy of ${o.id}`, like);
    return;
  }
  openLeft("none");
  startDropAtClick(e.path, appearance, labelOf(e));
});

/** The Objects drawer's eye: the object in the Preview drawer beside it, with Drop a copy. */
function previewObject(o: SceneObject): void {
  const path = o.resource ?? o.record;
  if (!path) return;
  objectPreview = true;
  objectLike = o;
  exPicked = { path, kind: o.kind === "npc" ? "npc" : o.kind === "entity" ? "entity" : "mesh", size: 0, appearance: o.appearance } as AssetEntry;
  appearance = o.appearance;
  if (o.kind !== "npc") post({ type: "look", path });
}

/** A model came (or failed): the Explorer's preview and Drop at click's outline may have waited for it. */
function modelCame(m: PreviewReply): void {
  if (m.error) exErrors.set(m.path, m.error);
  if (exPicked?.path === m.path && !exView) void showExView(m.path);
  if (m.parts && edgesWanted === m.path) void makeEdges(m.path);
}

// Drop at click's outline: the object's own edges, worked out once per model from what Previews loaded.

const edgeCache = new Map<string, Float32Array | null>();
let edgesWanted = "";

function edgesFor(path: string): Float32Array | undefined {
  const got = edgeCache.get(path);
  if (got !== undefined) return got ?? undefined;
  if (edgesWanted !== path) {
    edgesWanted = path;
    if (!kindOfPath(path)) return undefined;
    if (models.has(path)) void makeEdges(path);
    else post({ type: "preview.ask", paths: [path], glb: true });
  }
  return undefined;
}

async function makeEdges(path: string): Promise<void> {
  await loadPreviews();
  const parts = models.get(path);
  if (!previews || !parts || edgeCache.has(path)) return;
  try {
    const lines = (await previews.edges(parts, 8000)) ?? null;
    edgeCache.set(path, lines);
    post({ type: "log", text: `Drop at click's outline for ${shortName(path)}: ${lines ? `${(lines.length / 6).toLocaleString()} edges` : "too many edges, its box instead"}` });
  } catch {
    edgeCache.set(path, null);
  }
  while (edgeCache.size > 20) edgeCache.delete(edgeCache.keys().next().value!);
}

function status(text: string): void {
  $("message").textContent = text;
  $("message").className = "message warn";
}

// ---- the viewport ------------------------------------------------------------------------------

const showSceneTab = () => (document.getElementById("mainTabs") as HTMLElement & { select?(i: number): void }).select?.(1);
const viewport = new Viewport($<HTMLCanvasElement>("view"), {
  pick(id, opts, ray) {
    if (!state) return;
    const ids = pickSelection(id, state.selected, state.scene.objects, state.scene.groups, opts);
    post({ type: "select", ids });
    if (ids.length) showSceneTab();
    else if (ray) {
      // None of the scene's objects: the game's own door (or mesh) there, if any (D1).
      worldClickAt = performance.now();
      // The spinner turns until the mod has finished this pick (or for 15 s at most).
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
  remove: (ids) => (ids.length ? post({ type: "delete", ids }) : state?.worldObjects.picked && !state.worldObjects.picked.removedBy ? post({ type: "world.remove" }) : undefined),
  floor: (ids) => post({ type: "floor", ids }),
  undo: () => post({ type: "undo" }),
  log: (text) => post({ type: "log", text }),
  builderStart: (pose) => post({ type: "builder.start", pose }),
  builderStop: () => post({ type: "builder.stop" }),
  probe: (seq, ray) => post({ type: "drop.probe", seq, origin: ray.o, dir: ray.d }),
  hoverWorld: (ray) => {
    // Pick under the cursor outlines what a click would pick; Show tooltip describes it. Either asks.
    const want = freePick || worldTip;
    if (!want && !hoverSent) return;
    hoverSent = !!(want && ray);
    post({ type: "world.hoverRay", ray: want && ray ? { origin: ray.o, dir: ray.d } : null, free: freePick, outline: freePick });
    if (!hoverSent) viewport.setWorldTip(undefined);
  },
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
  if (fieldFocused() || viewport.busy) return;
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

// The About tab: the quickstart in src/app/help.md, made into HTML by build.mjs.
$("help").innerHTML = helpHtml;

channel.on<ModMessage>((m) => {
  if (m?.type === "state" && m.state) render(m.state);
  else if (m?.type === "preview") void previewCame(m).then(() => modelCame(m));
  else if (m?.type === "explore") explorerCame(m);
  else if (m?.type === "files") filesCame(m);
  else if (m?.type === "hover") viewport.setWorldTip(worldTip && m.thing ? tipFor(m.thing) : undefined);
  else if (m?.type === "probe") viewport.setProbe(m);
});
post({ type: "hello" });
