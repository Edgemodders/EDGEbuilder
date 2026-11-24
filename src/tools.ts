// Tools (T0, docs/tools.md): REDnode packages that provide "edgebuilder-tool" and open in a drawer of
// EDGEbuilder's. This module is REDnode-free (in the smoke test): it finds them in the folders REDnode
// loads packages from, one level down, and reads what their manifests say.

import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

/** The role a tool's manifest names in "provides". */
export const ToolRole = "edgebuilder-tool";
/** The tool API's version this EDGEbuilder offers (0: T0's probe API; 1 is pinned at T3). */
export const ToolApiVersion = 0;
export const ToolWidths = { min: 320, max: 840, fallback: 420 };

/** An installed tool, as the Tools list and the drawer use it. */
export interface ToolInfo {
  /** The package's id. */
  id: string;
  name: string;
  version: string;
  /** The button's text: edgebuilderTool.label, else the package's name. */
  label: string;
  description: string;
  /** The package's folder. */
  dir: string;
  /** The module's file, absolute; empty when the manifest names none that exists. */
  ui: string;
  /** The module's file:// URL, with ?v= its time, so a changed file is a new module. */
  url: string;
  /** The drawer's width in pixels, within ToolWidths. */
  width: number;
  /** What it will use, from edgebuilderTool.wants. */
  wants: string[];
  /** Why it cannot open, when it cannot. */
  problem?: string;
}

interface Manifest {
  id?: unknown;
  name?: unknown;
  version?: unknown;
  description?: unknown;
  provides?: unknown;
  edgebuilderTool?: {
    label?: unknown;
    description?: unknown;
    ui?: unknown;
    width?: unknown;
    wants?: unknown;
  };
}

const text = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback);

/** One package folder read as a tool, or null when it does not provide the role. */
export function readTool(dir: string): ToolInfo | null {
  let m: Manifest;
  try {
    m = JSON.parse(fs.readFileSync(path.join(dir, "rednode-app.json"), "utf8")) as Manifest;
  } catch {
    return null;
  }
  if (!Array.isArray(m.provides) || !m.provides.includes(ToolRole)) return null;
  const t = m.edgebuilderTool ?? {};
  const id = text(m.id, path.basename(dir));
  const name = text(m.name, id);
  const width = typeof t.width === "number" && Number.isFinite(t.width) ? Math.round(t.width) : ToolWidths.fallback;
  const info: ToolInfo = {
    id,
    name,
    version: text(m.version, "?"),
    label: text(t.label, name),
    description: text(t.description, text(m.description)),
    dir,
    ui: "",
    url: "",
    width: Math.min(ToolWidths.max, Math.max(ToolWidths.min, width)),
    wants: Array.isArray(t.wants) ? t.wants.filter((w): w is string => typeof w === "string") : [],
  };
  const ui = text(t.ui);
  if (!m.edgebuilderTool) info.problem = `its rednode-app.json provides "${ToolRole}" but has no "edgebuilderTool" block`;
  else if (!ui) info.problem = `its "edgebuilderTool" names no "ui" module`;
  else if (!/\.(m?js)$/i.test(ui)) info.problem = `its "ui" (${ui}) is not a .js or .mjs module`;
  else {
    const file = path.resolve(dir, ui);
    if (!file.startsWith(path.resolve(dir) + path.sep)) info.problem = `its "ui" (${ui}) is outside its own folder`;
    else {
      try {
        const st = fs.statSync(file);
        info.ui = file;
        info.url = `${pathToFileURL(file).href}?v=${Math.round(st.mtimeMs)}`;
      } catch {
        info.problem = `its "ui" (${ui}) is not there`;
      }
    }
  }
  return info;
}

/**
 * The tools in REDnode's package folders (`pkg.appsDirs`: development folders first, then the apps
 * folder), one level down, sorted by label. The first of an id wins, as REDnode's own lookup does.
 */
export function findTools(dirs: readonly string[], skip?: string): ToolInfo[] {
  const found = new Map<string, ToolInfo>();
  for (const root of dirs) {
    let names: string[];
    try {
      names = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
    } catch {
      continue;
    }
    for (const n of names) {
      const dir = path.join(root, n);
      if (skip && path.resolve(dir) === path.resolve(skip)) continue;
      const t = readTool(dir);
      if (t && !found.has(t.id)) found.set(t.id, t);
    }
  }
  return [...found.values()].sort((a, b) => a.label.localeCompare(b.label));
}
