// The T0 probe's tool (docs/tools.md): EDGEbuilder imports this file from the probe's own folder and
// calls mount(el, api) in a drawer, inside a shadow root of the tool's own.
import { service } from "rednode";

// Change this and save: EDGEbuilder mounts the tool again with the new file (the hot reload step).
const BUILD = "first";

export async function mount(el, api) {
  el.innerHTML = `
    <style>
      .line { font-size: 13px; margin: 2px 0; }
      .dim { color: var(--rn-dim, #999); }
      .row { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; margin-top: 6px; }
      pre { margin: 4px 0; white-space: pre-wrap; font: 12px ui-monospace, Consolas, monospace; }
      rn-list { --rn-list-height: 140px; }
      #results { color: var(--rn-accent, #fcee0a); }
    </style>
    <rn-panel title="Mounted">
      <div class="line">Build <b class="build"></b>, mounted at <span class="at"></span>, API version <span class="apiv"></span>.</div>
      <div class="line" id="results">This line has the id "results", as EDGEbuilder's result list does: in the tool's own shadow root the two do not meet.</div>
    </rn-panel>
    <rn-panel title="Its own service">
      <div class="row"><rn-button class="hello" title="Calls hello() in the probe's Node half, through REDnode">Ask my service</rn-button></div>
      <pre class="answer dim">Not asked yet.</pre>
      <div class="line">Events heard: <b class="ticks">0</b> <span class="dim">(its Node half sends a tick every 2 s)</span></div>
    </rn-panel>
    <rn-panel title="The UI kit">
      <rn-input class="name" label="Your name" placeholder="Type here: EDGEbuilder's keys stay quiet"></rn-input>
      <rn-toggle class="loud" label="Shout"></rn-toggle>
      <div class="line echo dim">Nothing typed yet.</div>
    </rn-panel>
    <rn-panel title="EDGEbuilder">
      <div class="line scene"></div>
      <rn-list class="sel"></rn-list>
      <div class="row">
        <rn-button class="count" variant="ghost" title="Sends the selection to the probe's Node half, which counts it by kind">Count by kind</rn-button>
        <rn-button class="say" variant="ghost" title="api.say: a line in the drawer's status and EDGEbuilder's log">Say</rn-button>
        <rn-button class="throw" variant="ghost" title="Throws in a click handler: the drawer shows it in red and EDGEbuilder goes on">Throw</rn-button>
        <rn-button class="reject" variant="ghost" title="A promise that fails with nobody to catch it">Reject</rn-button>
        <rn-button class="close" variant="ghost" title="api.close">Close</rn-button>
      </div>
    </rn-panel>`;
  const $ = (sel) => el.querySelector(sel);
  $(".build").textContent = BUILD;
  $(".at").textContent = new Date().toLocaleTimeString();
  $(".apiv").textContent = String(api.apiVersion);

  // Its own service: connected from EDGEbuilder's page, by the probe's package id.
  let svc;
  try {
    svc = await service.connect("edgebuilder-tool-probe");
  } catch (err) {
    $(".answer").textContent = `Could not connect: ${err.message}`;
  }
  let ticks = 0;
  const offTick = svc ? svc.$on("tick", () => ($(".ticks").textContent = String(++ticks))) : () => {};
  $(".hello").addEventListener("click", async () => {
    const who = $(".name").value || "EDGEbuilder";
    const started = performance.now();
    const answer = await svc.hello(who);
    $(".answer").textContent = `${JSON.stringify(answer, null, 1)}\n(${Math.round(performance.now() - started)} ms there and back)`;
  });

  // The UI kit.
  const echo = () => {
    const v = $(".name").value;
    $(".echo").textContent = v ? ($(".loud").checked ? v.toUpperCase() + "!" : v) : "Nothing typed yet.";
  };
  $(".name").addEventListener("input", echo);
  $(".loud").addEventListener("change", echo);

  // EDGEbuilder, through the API.
  const show = () => {
    const s = api.scene();
    const sel = api.selection();
    $(".scene").textContent = `Scene ${s.name || "(none open)"}: ${s.objects} object${s.objects === 1 ? "" : "s"}, ${sel.length} selected.`;
    $(".sel").innerHTML = sel.map((o) => `<rn-item value="${o.id}">${o.label}<span slot="end">${o.kind}</span></rn-item>`).join("");
  };
  show();
  const offChange = api.onChange(show);
  $(".count").addEventListener("click", async () => {
    const by = await svc.count(api.selection());
    api.say(`counted in Node: ${JSON.stringify(by)}`);
  });
  $(".say").addEventListener("click", () => api.say(`hello from build ${BUILD}`));
  $(".throw").addEventListener("click", () => {
    throw new Error("thrown on purpose by the probe's Throw button");
  });
  $(".reject").addEventListener("click", () => {
    void (async () => {
      throw new Error("rejected on purpose by the probe's Reject button");
    })();
  });
  $(".close").addEventListener("click", () => api.close());

  return {
    unmount() {
      offTick();
      offChange();
    },
  };
}
