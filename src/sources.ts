// B2c: assets that are not the game's own. Installed mods' archives (archive\pc\mod, and REDmod's
// mods\<name>\archives), read through REDbridge's archive.openMod, and the loose files of the open
// REDcode project's source\archive, read from disk. An archive is read again only when its size or
// time changes; what was read is kept in the data folder beside the game's index.

import * as fs from "node:fs";
import * as path from "node:path";
import type { Bridge } from "./bridge";
import { kindOf } from "./index";
import type { AssetEntry } from "./protocol";

interface CachedArchive {
  mod: string;
  size: number;
  mtime: number;
  entries: AssetEntry[];
}

interface CacheFile {
  format: 1;
  archives: Record<string, CachedArchive>;
}

/** A mod archive in the game folder, and the mod it belongs to. */
export interface ModArchiveFile {
  file: string;
  mod: string;
}

/** Every .archive the game loads from mods: archive\pc\mod\*.archive, and each REDmod's archives folder. */
export function modArchives(gameDir: string): ModArchiveFile[] {
  const out: ModArchiveFile[] = [];
  const loose = path.join(gameDir, "archive", "pc", "mod");
  for (const f of list(loose)) if (f.toLowerCase().endsWith(".archive")) out.push({ file: path.join(loose, f), mod: f.slice(0, -".archive".length) });
  const redmods = path.join(gameDir, "mods");
  for (const m of list(redmods)) {
    const dir = path.join(redmods, m, "archives");
    for (const f of list(dir)) if (f.toLowerCase().endsWith(".archive")) out.push({ file: path.join(dir, f), mod: m });
  }
  return out;
}

/** The folders modArchives reads, for watching. */
export function modFolders(gameDir: string): string[] {
  return [path.join(gameDir, "archive", "pc", "mod"), path.join(gameDir, "mods")];
}

function list(dir: string): string[] {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

export class ModSources {
  /** By archive path. */
  private archives: Record<string, CachedArchive> = {};
  /** The open project's loose files. */
  project: AssetEntry[] = [];

  constructor(readonly cacheFile: string) {
    try {
      const data = JSON.parse(fs.readFileSync(cacheFile, "utf8")) as CacheFile;
      if (data.format === 1 && data.archives) this.archives = data.archives;
    } catch {
      // First run.
    }
  }

  get archiveCount(): number {
    return Object.keys(this.archives).length;
  }

  /** Every mod entry, then the project's. */
  entries(): AssetEntry[] {
    const out: AssetEntry[] = [];
    for (const a of Object.values(this.archives)) out.push(...a.entries);
    out.push(...this.project);
    return out;
  }

  get modAssets(): number {
    let n = 0;
    for (const a of Object.values(this.archives)) n += a.entries.length;
    return n;
  }

  /**
   * Reads the mod archives that are new or changed since last time and forgets the ones gone.
   * `isGamePath` says whether a path is one of the game's own files (a mod's file then replaces it).
   * Returns whether anything changed. One unreadable archive is skipped and named in `failed`.
   */
  async refreshMods(bridge: Bridge, files: ModArchiveFile[], isGamePath: (p: string) => boolean, progress?: (text: string) => void): Promise<{ changed: boolean; failed: string[] }> {
    let changed = false;
    const failed: string[] = [];
    const seen = new Set<string>();
    for (const { file, mod } of files) {
      seen.add(file);
      let stat: fs.Stats;
      try {
        stat = fs.statSync(file);
      } catch {
        continue;
      }
      const known = this.archives[file];
      if (known && known.size === stat.size && known.mtime === stat.mtimeMs && known.mod === mod) continue;
      progress?.(`Reading ${path.basename(file)}`);
      try {
        const archive = await bridge.openMod(file);
        const entries: AssetEntry[] = [];
        for (const item of archive.items) {
          const kind = kindOf(item.name);
          if (!kind) continue;
          const entry: AssetEntry = { path: item.name, kind, size: item.size, source: { kind: "mod", name: mod, file } };
          if (isGamePath(item.name)) entry.replaces = true;
          entries.push(entry);
        }
        entries.sort((a, b) => a.path.localeCompare(b.path));
        this.archives[file] = { mod, size: stat.size, mtime: stat.mtimeMs, entries };
        changed = true;
      } catch (err) {
        failed.push(`${path.basename(file)}: ${(err as Error).message}`);
      }
    }
    for (const file of Object.keys(this.archives)) {
      if (!seen.has(file)) {
        delete this.archives[file];
        changed = true;
      }
    }
    if (changed) this.save();
    return { changed, failed };
  }

  /** Reads the meshes and entities among the project's loose files, as the game paths they will have once packed. */
  scanProject(project: { name: string; archive: string } | null, isGamePath: (p: string) => boolean): void {
    this.project = [];
    if (!project) return;
    const walk = (dir: string, rel: string) => {
      let names: fs.Dirent[];
      try {
        names = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const d of names) {
        const full = path.join(dir, d.name);
        const gamePath = rel ? `${rel}\\${d.name}` : d.name;
        if (d.isDirectory()) walk(full, gamePath);
        else {
          const kind = kindOf(d.name);
          if (!kind) continue;
          let size = 0;
          try {
            size = fs.statSync(full).size;
          } catch {
            // Gone already.
          }
          const entry: AssetEntry = { path: gamePath, kind, size, source: { kind: "project", name: project.name, file: full } };
          if (isGamePath(gamePath)) entry.replaces = true;
          this.project.push(entry);
        }
      }
    };
    walk(project.archive, "");
    this.project.sort((a, b) => a.path.localeCompare(b.path));
  }

  private save(): void {
    try {
      fs.mkdirSync(path.dirname(this.cacheFile), { recursive: true });
      const data: CacheFile = { format: 1, archives: this.archives };
      fs.writeFileSync(this.cacheFile, JSON.stringify(data));
    } catch {
      // A read-only data folder: the archives are read again next time.
    }
  }
}

/**
 * The mods and the project a scene's objects come from, by name, for "This scene needs". An object
 * whose file is both the game's and a mod's (a replacement) needs nothing: the game has the file.
 */
export function sceneNeeds(resources: (string | undefined)[], sources: AssetEntry[]): string[] {
  const byPath = new Map<string, AssetEntry>();
  for (const e of sources) if (!e.replaces) byPath.set(e.path.toLowerCase(), e);
  const needs = new Set<string>();
  for (const r of resources) {
    if (!r) continue;
    const e = byPath.get(r.replace(/\//g, "\\").toLowerCase());
    if (e?.source) needs.add(e.source.kind === "project" ? `${e.source.name} (REDcode project)` : e.source.name);
  }
  return [...needs].sort((a, b) => a.localeCompare(b));
}
