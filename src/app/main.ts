// The editor page: shows the mod's state and sends requests. No truth lives here.
import { channel } from "rednode";
import { AXES, qAxisAngle, qMul, qNorm, qYaw, type Q } from "../math";
import type { AssetEntry, AssetFrom, AssetKind, PageMessage, SceneObject, SceneTransform, Snapshot } from "../protocol";
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
        ? `${s.results.length}${s.results.length >= 120 ? "+" : ""} found`
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
  const objects = $("objects");
  objects.innerHTML = s.scene.objects
    .map((o) => `<rn-item value="${esc(o.id)}"${o.id === s.selected ? " selected" : ""}>${esc(o.id)}<span slot="end">${o.entityId ? o.kind : "not in world"}</span></rn-item>`)
    .join("");
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

/** The tag at a result's end: the mod or project it comes from, and its kind. */
function rowTag(r: AssetEntry): string {
  const where = r.source ? (r.source.kind === "project" ? `project ${r.source.name}` : r.source.name) : r.path.toLowerCase().startsWith("ep1\\") ? "PL" : "";
  return [where, r.replaces ? "changes a game file" : "", r.kind].filter(Boolean).join(" ");
}

function rowTitle(r: AssetEntry): string {
  return r.source ? `${r.path}\n${r.source.file}` : r.path;
}

type Field = HTMLElement & { value: string };
const fields = ["px", "py", "pz", "yaw", "scale"] as const;
const field = (id: (typeof fields)[number]) => $<Field>(id);

function renderSelected(o: SceneObject | undefined): void {
  const focused = document.activeElement?.id;
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
  $("selected").textContent = `${o.id}\n${o.resource ?? o.kind}\n${o.appearance ? `appearance ${o.appearance}\n` : ""}at ${x.toFixed(2)}, ${y.toFixed(2)}, ${z.toFixed(2)}${o.entityId ? `\nentity ${o.entityId}` : "\nnot in the world"}`;
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
$("objects").addEventListener("select", (e) => post({ type: "select", id: (e as CustomEvent<{ value: string }>).detail.value }));
$("delete").addEventListener("click", () => state?.selected && post({ type: "delete", id: state.selected }));
$("floor").addEventListener("click", () => state?.selected && post({ type: "floor", id: state.selected }));

/** The numbers in the Selected panel as a transform: position, a new heading, a uniform scale for meshes. */
function applyFields(): void {
  const o = state?.scene.objects.find((x) => x.id === state?.selected);
  if (!o) return;
  const num = (f: (typeof fields)[number], fallback: number) => {
    const n = Number(field(f).value);
    return Number.isFinite(n) ? n : fallback;
  };
  const t = o.transform;
  const yawNow = qYaw(t.rotation as Q);
  const turn = num("yaw", yawNow) - yawNow;
  const s = o.kind === "mesh" ? num("scale", t.scale[0]) || t.scale[0] : 1;
  const next: SceneTransform = {
    position: [num("px", t.position[0]), num("py", t.position[1]), num("pz", t.position[2])],
    rotation: Math.abs(turn) > 1e-3 ? qNorm(qMul(qAxisAngle(AXES.z, turn), t.rotation as Q)) : t.rotation,
    scale: o.kind === "mesh" ? [s, s, s] : t.scale,
  };
  post({ type: "transform", id: o.id, transform: next });
}
$("apply").addEventListener("click", applyFields);
for (const f of fields) field(f).addEventListener("submit", applyFields);

// ---- the viewport ------------------------------------------------------------------------------

const viewport = new Viewport($<HTMLCanvasElement>("view"), {
  select(id) {
    post({ type: "select", id });
    if (id) (document.getElementById("mainTabs") as HTMLElement & { select?(i: number): void }).select?.(1);
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
  },
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
