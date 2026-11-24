// Tools (T0, docs/tools.md): a tool's module, from another package's folder, mounted in a drawer of
// EDGEbuilder's page. Each mount gets a shadow root of its own, so the tool's ids and styles cannot meet
// EDGEbuilder's; the UI kit's elements work there, and the theme's colours come through. What a tool
// throws is caught and shown in red in the drawer, and EDGEbuilder goes on.

import type { Snapshot, ToolInfo } from "../protocol";

/** What a tool's `mount` gets: T0's probe API (apiVersion 0). T1 and T2 grow it; T3 pins version 1. */
export interface ToolApi {
  readonly apiVersion: number;
  readonly tool: { id: string; name: string; version: string; label: string };
  /** The selected objects, as the Scene tab lists them. */
  selection(): { id: string; label: string; kind: string; resource?: string; record?: string }[];
  /** The open scene: its name and how many objects it holds. */
  scene(): { name: string; objects: number };
  /** Calls `fn` after each change EDGEbuilder shows. Returns a function that stops it. */
  onChange(fn: () => void): () => void;
  /** A line in the drawer's status and in EDGEbuilder's log. */
  say(text: string, tone?: "info" | "warn" | "error"): void;
  /** Closes the drawer. */
  close(): void;
}

/**
 * What a tool's module exports: `mount` as its default export or by name. It may return (or resolve to)
 * the unmount function, or an object with `unmount`; else the module's own `unmount` export is used.
 */
interface ToolModule {
  default?: (el: HTMLElement, api: ToolApi) => unknown;
  mount?: (el: HTMLElement, api: ToolApi) => unknown;
  unmount?: () => void;
}

interface Mounted {
  tool: ToolInfo;
  url: string;
  host: HTMLElement;
  unmount?: () => void;
  listeners: Set<() => void>;
}

export interface ToolDrawerHost {
  body: HTMLElement;
  status: HTMLElement;
  state(): Snapshot | undefined;
  log(id: string, text: string, tone?: "info" | "warn" | "error"): void;
  close(): void;
}

/** The base of a tool's shadow root: EDGEbuilder's font and colours, nothing of its layout. */
const BaseStyle = `:host { display: block; color: var(--rn-fg, #eee); font: inherit; }
.tool-root { display: flex; flex-direction: column; gap: 8px; }`;

export class ToolDrawer {
  private mounted: Mounted | undefined;
  /** Each mount's number: a slow import that finishes after another mount began is dropped. */
  private turn = 0;

  constructor(private readonly host: ToolDrawerHost) {
    // Errors the tool throws later, in its own handlers: told apart by the file they came from.
    window.addEventListener("error", (e) => {
      if (this.isMine(e.filename) || this.isMine(e.error?.stack)) this.failed(e.error ?? e.message, "threw");
    });
    window.addEventListener("unhandledrejection", (e) => {
      const r = e.reason as { stack?: string } | undefined;
      if (this.isMine(r?.stack)) this.failed(e.reason, "failed");
    });
  }

  /** The tool shown, if any. */
  get id(): string | undefined {
    return this.mounted?.tool.id;
  }

  /** Mounts the tool shown again, its module loaded afresh. */
  reload(): void {
    const m = this.mounted;
    if (m) void this.open(m.tool, true);
  }

  /** Mounts a tool, after unmounting the one before; `fresh` loads its module again even when unchanged. */
  async open(tool: ToolInfo, fresh = false): Promise<void> {
    this.unmount();
    const turn = ++this.turn;
    this.say(tool.problem ? "" : `Loading ${tool.label}...`);
    const body = this.host.body;
    const host = document.createElement("div");
    host.className = "toolHost";
    body.replaceChildren(host);
    const m: Mounted = { tool, url: tool.url, host, listeners: new Set() };
    this.mounted = m;
    if (tool.problem) {
      this.say(`${tool.label} cannot open: ${tool.problem}.`, "error");
      return;
    }
    const shadow = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = BaseStyle;
    const root = document.createElement("div");
    root.className = "tool-root";
    shadow.append(style, root);
    const started = performance.now();
    try {
      const mod = (await import(/* a tool's own file, never bundled */ fresh ? `${tool.url}&r=${Date.now()}` : tool.url)) as ToolModule;
      if (turn !== this.turn) return;
      const mount = typeof mod.default === "function" ? mod.default : mod.mount;
      if (typeof mount !== "function") throw new Error("its module exports no mount(el, api) function, as its default export or by name");
      const handle = (await mount(root, this.api(m))) as (() => void) | { unmount?: () => void } | undefined;
      if (turn !== this.turn) return;
      m.unmount = typeof handle === "function" ? handle : typeof handle?.unmount === "function" ? () => handle.unmount!() : mod.unmount;
      const ms = Math.round(performance.now() - started);
      this.say(`${tool.label} ${tool.version}, mounted in ${ms} ms.`);
      this.host.log(tool.id, `mounted in ${ms} ms from ${tool.url}`);
    } catch (err) {
      if (turn === this.turn) this.failed(err, "did not mount");
    }
  }

  /** After each snapshot: a changed module mounts again (hot reload); a tool that went away closes. */
  sync(tools: ToolInfo[]): void {
    const m = this.mounted;
    for (const fn of m?.listeners ?? []) this.guard(fn);
    if (!m) return;
    const now = tools.find((t) => t.id === m.tool.id);
    if (!now) {
      this.unmount();
      this.host.body.replaceChildren();
      this.say(`${m.tool.label} is not installed any more.`, "warn");
      return;
    }
    if (now.url !== m.url || now.problem !== m.tool.problem) void this.open(now);
  }

  /** Unmounts the tool shown, if any. */
  unmount(): void {
    const m = this.mounted;
    if (!m) return;
    this.mounted = undefined;
    this.turn++;
    m.listeners.clear();
    try {
      m.unmount?.();
    } catch (err) {
      this.host.log(m.tool.id, `unmount threw: ${text(err)}`, "warn");
    }
    m.host.remove();
  }

  private api(m: Mounted): ToolApi {
    const live = () => this.mounted === m;
    return {
      apiVersion: 0,
      tool: { id: m.tool.id, name: m.tool.name, version: m.tool.version, label: m.tool.label },
      selection: () => {
        const s = this.host.state();
        if (!s) return [];
        return s.selected
          .map((id) => s.scene.objects.find((o) => o.id === id))
          .filter((o) => !!o)
          .map((o) => {
            const name = o.resource ?? o.record ?? o.id;
            return { id: o.id, label: name.slice(name.lastIndexOf("\\") + 1), kind: o.kind, resource: o.resource, record: o.record };
          });
      },
      scene: () => {
        const s = this.host.state();
        return { name: s?.scene.name ?? "", objects: s?.scene.objects.length ?? 0 };
      },
      onChange: (fn) => {
        if (!live()) return () => undefined;
        m.listeners.add(fn);
        return () => m.listeners.delete(fn);
      },
      say: (t, tone = "info") => {
        if (!live()) return;
        this.say(`${m.tool.label}: ${t}`, tone);
        this.host.log(m.tool.id, String(t), tone);
      },
      close: () => {
        if (live()) this.host.close();
      },
    };
  }

  private guard(fn: () => void): void {
    try {
      fn();
    } catch (err) {
      this.failed(err, "threw");
    }
  }

  private isMine(where: string | undefined): boolean {
    const m = this.mounted;
    if (!m || !where) return false;
    // Windows paths: Node writes file:///e:/..., Chromium reports file:///E:/..., so case is ignored.
    const dir = m.url.slice(0, m.url.lastIndexOf("/") + 1).toLowerCase();
    const at = where.toLowerCase();
    return at.includes(dir) || at.includes(decodeURI(dir));
  }

  private failed(err: unknown, what: string): void {
    const m = this.mounted;
    if (!m) return;
    const line = `${m.tool.label} ${what}: ${text(err)}`;
    this.say(line, "error");
    this.host.log(m.tool.id, `${what}: ${err instanceof Error && err.stack ? err.stack : text(err)}`, "error");
  }

  private say(line: string, tone: "info" | "warn" | "error" = "info"): void {
    const el = this.host.status;
    el.textContent = line;
    el.className = `toolStatus ${tone}`;
  }
}

function text(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
