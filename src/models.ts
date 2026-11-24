// B2d: the models Import offers on the Library tab. GLB files in the Library and the open project's
// source\raw, and the props on EDGEfab's Desk, already prepared. REDnode-free, so the smoke test runs it.
// Listing needs nothing from EDGEfab: the Desk's place and its `<name>.prop.asset` items with
// `asset.json` are kept stable by EDGEfab (EDGEfab #5).

import * as fs from "node:fs";
import * as path from "node:path";
import type { FilePlace, FolderListing, ModelEntry, ModelPlace } from "./protocol";

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

// ---- the file picker (0.14.0) ----------------------------------------------------------------------------
//
// The Library tab's folder icon beside the Import path opens a drawer that walks the disk one folder at a
// time: its folders, its `.glb` files and its `.prop.asset` items (picked whole, never walked into).

const MaxListed = 3000;

/** Where the file picker starts: the places Import already knows, the user's own folders, and the drives. */
export function filePlaces(known: { label: string; dir: string }[], env: NodeJS.ProcessEnv = process.env): FilePlace[] {
  const home = env.USERPROFILE ?? env.HOME ?? "";
  const out: FilePlace[] = [];
  const add = (label: string, dir: string | undefined, kind: FilePlace["kind"]) => {
    if (!dir || out.some((p) => p.dir.toLowerCase() === dir.toLowerCase())) return;
    if (isDir(dir)) out.push({ label, dir, kind });
  };
  for (const k of known) add(k.label, k.dir, "known");
  if (home) {
    add("Desktop", path.join(home, "Desktop"), "user");
    add("Documents", path.join(home, "Documents"), "user");
    add("Downloads", path.join(home, "Downloads"), "user");
  }
  if (process.platform === "win32") for (const c of "CDEFGHIJKLMNOPQRSTUVWXYZ") add(`${c}:`, `${c}:\\`, "drive");
  else add("/", "/", "drive");
  return out;
}

/** One folder for the file picker: its folders (prop items marked), its `.glb` files, or why it cannot be read. */
export function listFolder(dir: string): FolderListing {
  const at = path.resolve(dir);
  const parent = path.dirname(at);
  const listing: FolderListing = { dir: at, parent: parent !== at ? parent : undefined, folders: [], files: [] };
  let names: fs.Dirent[];
  try {
    names = fs.readdirSync(at, { withFileTypes: true });
  } catch (err) {
    listing.why = (err as NodeJS.ErrnoException).code === "ENOENT" ? `There is no folder at ${at}.` : `This folder cannot be read (${(err as NodeJS.ErrnoException).code ?? "an error"}).`;
    return listing;
  }
  names.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true }));
  for (const d of names) {
    if (listing.folders.length + listing.files.length >= MaxListed) {
      listing.more = true;
      break;
    }
    const full = path.join(at, d.name);
    const lower = d.name.toLowerCase();
    // A junction or a link to a folder (Windows' "My Music" in Documents, for one) counts as a folder when it can be read.
    const folder = d.isDirectory() || (d.isSymbolicLink() && isDir(full));
    if (folder) {
      if (d.name.startsWith(".") || d.name.startsWith("$") || d.name === "System Volume Information") continue;
      if (lower.endsWith(PropEnding)) listing.folders.push({ name: d.name, path: full, prop: propName(full), changed: mtime(full) });
      else listing.folders.push({ name: d.name, path: full, changed: mtime(full) });
    } else if (d.isFile() && lower.endsWith(".glb")) {
      let st: fs.Stats;
      try {
        st = fs.statSync(full);
      } catch {
        continue;
      }
      listing.files.push({ name: d.name, path: full, bytes: st.size, changed: st.mtimeMs });
    }
  }
  return listing;
}

function isDir(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
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
