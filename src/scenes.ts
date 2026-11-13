// Where scenes live (B3-2): the Library (any folder under the EDGE tools' shared root), the open
// REDcode project's source/scenes, and This PC (scenes/ in EDGEbuilder's data folder). A scene is
// any *.scene.json; folders are the modder's own (docs/library.md). REDnode-free, for the smoke test.

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Place, PlaceRoot, SceneEntry, Shelf } from "./protocol";

export type { Place, PlaceRoot, SceneEntry, Shelf };

export const SceneEnding = ".scene.json";

/** Where the EDGE tools keep the Library's root: `%APPDATA%\EDGE\library.json`, `{ "root": ... }`. */
export function libraryConfigFile(): string {
  return path.join(process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming"), "EDGE", "library.json");
}

export function readLibraryRoot(file = libraryConfigFile()): string | undefined {
  try {
    const root = (JSON.parse(fs.readFileSync(file, "utf8")) as { root?: unknown }).root;
    return typeof root === "string" && root.trim() ? root.trim() : undefined;
  } catch {
    return undefined;
  }
}

/** Makes the root folder and records it for every EDGE tool, keeping any other fields the file has. */
export function writeLibraryRoot(root: string, file = libraryConfigFile()): void {
  root = path.resolve(root);
  fs.mkdirSync(root, { recursive: true });
  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    // First tool to set it.
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ ...data, root }, null, 2));
}

/** The player's Documents folder, wherever Windows keeps it (OneDrive or another drive), else the usual place. */
export function documentsFolder(): string {
  const fallback = path.join(os.homedir(), "Documents");
  if (process.platform !== "win32") return fallback;
  try {
    const out = execFileSync("reg", ["query", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders", "/v", "Personal"], { encoding: "utf8", windowsHide: true, timeout: 5000 });
    const m = /Personal\s+REG_(?:EXPAND_)?SZ\s+(.+)/.exec(out);
    if (!m) return fallback;
    return m[1].trim().replace(/%([^%]+)%/g, (all, name: string) => process.env[name] ?? all);
  } catch {
    return fallback;
  }
}

/** The Library folder offered the first time: `Documents\EDGE Library`. */
export function suggestedLibraryRoot(): string {
  return path.join(documentsFolder(), "EDGE Library");
}

/**
 * A scene name as the bake writes it into file names and refs (REDbridge's `SafeName`): lowercase,
 * every character but an ASCII letter or digit an `_`, no `_` at either end.
 */
export function slugOf(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "_")
      .replace(/^_+|_+$/g, "") || "scene"
  );
}

/** An object's node reference: its own, or the one the bake gives it, `edgebuilder/<scene>/<id>`. */
export function refOf(sceneName: string, o: { id: string; ref?: string }): string {
  return o.ref ?? `edgebuilder/${slugOf(sceneName)}/${o.id}`;
}

export function fileNameOf(name: string): string {
  return slugOf(name) + SceneEnding;
}

/** A folder under a root from a relative path the page sent; refuses one that leaves the root. */
export function folderIn(root: string, folder: string | undefined): string {
  const full = path.resolve(root, folder ?? "");
  const rel = path.relative(path.resolve(root), full);
  if (rel.startsWith("..") || path.isAbsolute(rel)) throw new Error(`${folder} is outside ${root}`);
  return full;
}

/** A new folder's name: no path separators or characters Windows refuses. */
export function cleanFolderName(name: string): string {
  const clean = name.replace(/[<>:"/\\|?*\x00-\x1f]+/g, " ").replace(/\s+/g, " ").trim().replace(/[. ]+$/, "");
  if (!clean || clean === "." || clean === "..") throw new Error("Give the folder a name");
  return clean;
}

/** Which place and folder a file is in, or undefined when it is in none of them. */
export function whereIs(file: string, roots: PlaceRoot[]): { place: Place; folder: string } | undefined {
  for (const r of roots) {
    const rel = path.relative(path.resolve(r.dir), path.resolve(file));
    if (!rel.startsWith("..") && !path.isAbsolute(rel)) return { place: r.place, folder: path.dirname(rel).replace(/\\/g, "/").replace(/^\.$/, "") };
  }
  return undefined;
}

const MaxDepth = 8;
const MaxScenes = 2000;

/** What a scene file says about itself, kept until the file changes. */
const seen = new Map<string, { size: number; mtime: number; name: string; objects: number; error?: string }>();

function describe(file: string, st: fs.Stats): { name: string; objects: number; error?: string } {
  const known = seen.get(file);
  if (known && known.size === st.size && known.mtime === st.mtimeMs) return known;
  let out: { name: string; objects: number; error?: string };
  const fallback = path.basename(file).slice(0, -SceneEnding.length);
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8")) as { format?: unknown; name?: unknown; objects?: unknown };
    if (typeof data.format !== "number" || !Array.isArray(data.objects)) throw new Error("not an EDGEbuilder scene");
    out = { name: typeof data.name === "string" && data.name.trim() ? data.name : fallback, objects: data.objects.length };
  } catch (err) {
    out = { name: fallback, objects: 0, error: (err as Error).message };
  }
  seen.set(file, { size: st.size, mtime: st.mtimeMs, ...out });
  return out;
}

/** The folders and scenes under a place's root. A missing root is an empty shelf. */
export function scanShelf(root: PlaceRoot): Shelf {
  const shelf: Shelf = { ...root, folders: [], scenes: [] };
  const walk = (dir: string, rel: string, depth: number) => {
    let names: fs.Dirent[];
    try {
      names = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    names.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
    for (const d of names) {
      if (shelf.scenes.length >= MaxScenes) return;
      const full = path.join(dir, d.name);
      const sub = rel ? `${rel}/${d.name}` : d.name;
      if (d.isDirectory()) {
        // Bakes (B4), asset items (B2d: a `.prop.asset` is one model) and hidden folders are not scene folders.
        if (d.name.startsWith(".") || d.name.toLowerCase().endsWith(".bake") || d.name.toLowerCase().endsWith(".asset") || d.name === "node_modules" || depth >= MaxDepth) continue;
        shelf.folders.push(sub);
        walk(full, sub, depth + 1);
      } else if (d.isFile() && d.name.toLowerCase().endsWith(SceneEnding)) {
        let st: fs.Stats;
        try {
          st = fs.statSync(full);
        } catch {
          continue;
        }
        shelf.scenes.push({ place: root.place, file: full, folder: rel, changed: st.mtimeMs, ...describe(full, st) });
      }
    }
  };
  walk(root.dir, "", 0);
  return shelf;
}

/** A file name for a new scene in `dir` that no scene there has yet: `name.scene.json`, `name_2.scene.json`, ... */
export function freeFileName(dir: string, name: string): string {
  const base = slugOf(name);
  for (let n = 1; ; n++) {
    const file = path.join(dir, `${base}${n === 1 ? "" : `_${n}`}${SceneEnding}`);
    if (!fs.existsSync(file)) return file;
  }
}
