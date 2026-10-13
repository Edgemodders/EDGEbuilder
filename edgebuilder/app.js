// Built from src/app/ by build.mjs; edit the TypeScript, not this file.

// src/app/main.ts
import { channel } from "rednode";
var $ = (id) => document.getElementById(id);
var post = (m) => channel.post(m);
var esc = (s) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
var shortName = (p) => p.slice(p.lastIndexOf("\\") + 1);
var state;
var kind = "all";
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
  $("bridge").textContent = b.status === "ready" ? `REDbridge ${b.version}` : b.status === "starting" ? "REDbridge starting" : b.status === "missing" ? "No REDbridge" : b.status === "failed" ? "REDbridge failed" : "REDbridge off";
  $("bridge").className = `pill ${b.status === "ready" ? "ok" : b.status === "starting" ? "" : "warn"}`;
  $("bridge").title = b.detail ?? b.path ?? "";
  const ix = s.index;
  $("index").textContent = ix.status === "ready" ? `${ix.count.toLocaleString()} assets` : ix.status === "building" ? "Indexing..." : ix.status === "failed" ? "Index failed" : "No index";
  $("index").className = `pill ${ix.status === "ready" ? "ok" : ix.status === "building" ? "" : "warn"}`;
  $("index").title = ix.progress ?? ix.file ?? "";
  $("progress").textContent = ix.status === "building" ? ix.progress ?? "" : "";
  const list = $("results");
  const keep = lookedAt;
  list.innerHTML = s.results.map((r) => `<rn-item value="${esc(r.path)}" title="${esc(r.path)}"${r.path === keep ? " selected" : ""}>${esc(shortName(r.path))}<span slot="end">${r.path.toLowerCase().startsWith("ep1\\") ? "PL " : ""}${r.kind}</span></rn-item>`).join("");
  $("count").textContent = s.index.status === "ready" ? s.query.text ? `${s.results.length}${s.results.length >= 120 ? "+" : ""} of ${s.index.count.toLocaleString()}` : `Type to search ${s.index.count.toLocaleString()} assets` : "";
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
  } else if (!lookedAt) {
    $("lookedPath").textContent = "Pick an asset";
    $("lookedSize").textContent = "";
    $("appearances").hidden = true;
    $("drop").setAttribute("disabled", "");
  }
  const objects = $("objects");
  objects.innerHTML = s.scene.objects.map((o) => `<rn-item value="${esc(o.id)}"${o.id === s.selected ? " selected" : ""}>${esc(o.id)}<span slot="end">${o.entityId ? o.kind : "not in world"}</span></rn-item>`).join("");
  $("sceneCount").textContent = `${s.scene.objects.length} object${s.scene.objects.length === 1 ? "" : "s"}`;
  const sel = s.scene.objects.find((o) => o.id === s.selected);
  renderSelected(sel);
  $("delete").toggleAttribute("disabled", !sel);
  const missing = s.scene.objects.some((o) => !o.entityId && o.kind !== "light");
  $("rebuild").toggleAttribute("disabled", !missing);
  if (document.activeElement?.id !== "bridgePath") $("bridgePath").value = s.settings.bridgePath ?? "";
  if (document.activeElement?.id !== "gameDir") $("gameDir").value = s.settings.gameDir ?? "";
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
function renderSelected(o) {
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
  searchTimer = setTimeout(() => post({ type: "search", text: $("search").value ?? "", kind }), 120);
}
$("search").addEventListener("input", search);
$("kinds").addEventListener("change", (e) => {
  kind = ["all", "mesh", "entity"][e.detail.index] ?? "all";
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
$("objects").addEventListener("select", (e) => post({ type: "select", id: e.detail.value }));
$("delete").addEventListener("click", () => state?.selected && post({ type: "delete", id: state.selected }));
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
