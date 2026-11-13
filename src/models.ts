// B2d: the models Import offers on the Library tab. GLB files in the Library and the open project's
// source\raw, and the props on EDGEfab's Desk, already prepared. REDnode-free, so the smoke test runs it.
// Listing needs nothing from EDGEfab: the Desk's place and its `<name>.prop.asset` items with
// `asset.json` are kept stable by EDGEfab (EDGEfab #5).

import * as fs from "node:fs";
import * as path from "node:path";
import type { ModelEntry, ModelPlace } from "./protocol";

const MaxModels = 2000;
const MaxDepth = 8;
export const PropEnding = ".prop.asset";

/** EDGEfab's Desk: `%LOCALAPPDATA%\EDGEfab\desk`, where EDGEfab keeps what it made and what was imported. */
export function deskDir(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(env.LOCALAPPDATA ?? path.join(env.USERPROFILE ?? "", "AppData", "Local"), "EDGEfab", "desk");
}

/** A Desk or Library prop's name: its asset.json's `name`, else its folder's name without `.prop.asset`. */
export function propName(folder: string): string {
  try {
    const a = JSON.parse(fs.readFileSync(path.join(folder, "asset.json"), "utf8")) as { name?: unknown };
    if (typeof a.name === "string" && a.name) return a.name;
  } catch {
    // No asset.json, or not one EDGEbuilder can read: the folder's name.
  }
  return path.basename(folder).slice(0, -PropEnding.length);
}

/**
 * The models under one root: `.glb` files, and `.prop.asset` folders (whole items: never walked
 * into). Bakes and hidden folders are skipped. `folder` is relative to the root, with forward slashes.
 */
export function scanModels(place: ModelPlace, root: string | undefined): ModelEntry[] {
  const out: ModelEntry[] = [];
  if (!root) return out;
  const walk = (dir: string, rel: string, depth: number) => {
    let names: fs.Dirent[];
    try {
      names = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    names.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
    for (const d of names) {
      if (out.length >= MaxModels) return;
      const full = path.join(dir, d.name);
      const lower = d.name.toLowerCase();
      if (d.isDirectory()) {
        if (lower.endsWith(PropEnding)) {
          out.push({ place, file: full, folder: rel, name: propName(full), kind: "prop", changed: mtime(full) });
          continue;
        }
        if (d.name.startsWith(".") || lower.endsWith(".bake") || lower.endsWith(".asset") || d.name === "node_modules" || depth >= MaxDepth) continue;
        walk(full, rel ? `${rel}/${d.name}` : d.name, depth + 1);
      } else if (d.isFile() && lower.endsWith(".glb")) {
        let st: fs.Stats;
        try {
          st = fs.statSync(full);
        } catch {
          continue;
        }
        out.push({ place, file: full, folder: rel, name: d.name.slice(0, -4), kind: "glb", bytes: st.size, changed: st.mtimeMs });
      }
    }
  };
  walk(root, "", 0);
  return out;
}

function mtime(p: string): number {
  try {
    return fs.statSync(p).mtimeMs;
  } catch {
    return 0;
  }
}

/** The file name EDGEfab will give a prop: lowercase letters, digits and underscores, as its slug does. */
export function propSlug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/\.(glb|prop\.asset)$/, "")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 48) || "prop"
  );
}

/** A path typed in for Import: a `.glb` or a `.prop.asset` folder that is there, else why not. */
export function checkModelPath(p: string): { ok: true; kind: "glb" | "prop"; file: string } | { ok: false; why: string } {
  const file = p.trim().replace(/^"(.*)"$/, "$1");
  if (!file) return { ok: false, why: "Type the full path of a .glb file." };
  const lower = file.toLowerCase();
  if (lower.endsWith(PropEnding.toLowerCase()) && fs.existsSync(path.join(file, "asset.json"))) return { ok: true, kind: "prop", file };
  if (!lower.endsWith(".glb")) return { ok: false, why: "Import takes a .glb file (a textured glTF in one file), or a prop from EDGEfab's Desk." };
  if (!fs.existsSync(file)) return { ok: false, why: `There is no file at ${file}.` };
  return { ok: true, kind: "glb", file };
}
