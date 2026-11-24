// The asset index: every mesh and entity template under the game's environment and item folders,
// read once from the player's own game through REDbridge and kept as JSON in the package's data
// folder. Nothing is shipped; the player's game is the source.

import * as fs from "node:fs";
import * as path from "node:path";
import type { Bridge } from "./bridge";
import { exploreSegments } from "./explore";
import type { AssetEntry, AssetFrom, AssetInfo, AssetKind, ExploreFolder, ExploreRoot } from "./protocol";

/** The folders worth indexing for world building. Characters, weapons and UI are left out. */
export const IndexPrefixes = ["base\\environment", "ep1\\environment", "base\\items", "ep1\\items", "base\\gameplay\\devices"];

const PageSize = 5000;

export interface IndexFile {
  format: 1;
  /** The bridge's archive and file counts, which change with the game version. */
  game: string;
  built: string;
  entries: AssetEntry[];
  /** What mesh.info said about the assets looked at so far. */
  info: Record<string, AssetInfo>;
}

export class AssetIndex {
  entries: AssetEntry[] = [];
  info: Record<string, AssetInfo> = {};
  game = "";
  file = "";
  /** Mods' and the open project's assets (B2c), searched beside the game's. */
  extra: AssetEntry[] = [];
  /** The game's people (B3c, npcs.ts), searched with the game's own files. */
  npcs: AssetEntry[] = [];
  private gamePaths: Set<string> | undefined;

  constructor(readonly dir: string) {}

  /** Loads the index for this game, if one was built. */
  load(game: string): boolean {
    this.game = game;
    this.file = path.join(this.dir, `${game}.json`);
    try {
      const data = JSON.parse(fs.readFileSync(this.file, "utf8")) as IndexFile;
      if (data.format !== 1 || !Array.isArray(data.entries)) return false;
      this.entries = unique(data.entries);
      this.info = data.info ?? {};
      this.gamePaths = undefined;
      return true;
    } catch {
      return false;
    }
  }

  /** Loads the newest index on disk, for searching before REDbridge says which game this is. */
  loadNewest(): boolean {
    let newest: { game: string; t: number } | undefined;
    try {
      for (const f of fs.readdirSync(this.dir)) {
        if (!f.endsWith(".json")) continue;
        const t = fs.statSync(path.join(this.dir, f)).mtimeMs;
        if (!newest || t > newest.t) newest = { game: f.slice(0, -5), t };
      }
    } catch {
      return false;
    }
    return newest ? this.load(newest.game) : false;
  }

  save(): void {
    fs.mkdirSync(this.dir, { recursive: true });
    const data: IndexFile = { format: 1, game: this.game, built: new Date().toISOString(), entries: this.entries, info: this.info };
    fs.writeFileSync(this.file, JSON.stringify(data));
  }

  /** Reads the index from the game through the bridge. Pages of 5,000 files per folder prefix. */
  async build(bridge: Bridge, game: string, progress?: (text: string) => void): Promise<void> {
    this.game = game;
    this.file = path.join(this.dir, `${game}.json`);
    const entries: AssetEntry[] = [];
    for (const prefix of IndexPrefixes) {
      let offset = 0;
      let total = 0;
      do {
        const page = await bridge.list(prefix, offset, PageSize);
        total = page.total;
        for (const f of page.items) {
          const kind = kindOf(f.name);
          if (kind) entries.push({ path: f.name, kind, size: f.size });
        }
        offset += page.items.length;
        progress?.(`${prefix}: ${Math.min(offset, total).toLocaleString()} of ${total.toLocaleString()} files, ${entries.length.toLocaleString()} assets so far`);
        if (page.items.length === 0) break;
      } while (offset < total);
    }
    entries.sort((a, b) => a.path.localeCompare(b.path));
    this.entries = unique(entries);
    this.gamePaths = undefined;
    this.save();
  }

  /** Whether a path is one of the indexed game files. */
  isGamePath(p: string): boolean {
    this.gamePaths ??= new Set(this.entries.map((e) => e.path.toLowerCase()));
    return this.gamePaths.has(p.replace(/\//g, "\\").toLowerCase());
  }

  /**
   * Substring search over paths, file-name matches first. Mods' and the project's files come first
   * and also match by their mod's or project's name. With no text, `from` other than game lists them all.
   */
  search(text: string, kind: AssetKind | "all", limit = 200, from: AssetFrom = "all"): AssetEntry[] {
    const terms = text.toLowerCase().split(/\s+/).filter(Boolean);
    const out: { e: AssetEntry; score: number }[] = [];
    const pools = from === "game" ? [this.entries, this.npcs] : from === "all" ? [this.extra, this.entries, this.npcs] : [this.extra];
    for (const pool of pools) {
      for (const e of pool) {
        if (kind !== "all" && e.kind !== kind) continue;
        if (from === "mods" && e.source?.kind !== "mod") continue;
        if (from === "project" && e.source?.kind !== "project") continue;
        const score = this.score(e, terms);
        if (score < 0) continue;
        out.push({ e, score: score + (e.source ? 0.5 : 0) });
        if (out.length > limit * 20) break;
      }
    }
    out.sort((a, b) => b.score - a.score || a.e.path.length - b.e.path.length);
    return out.slice(0, limit).map((x) => x.e);
  }

  /**
   * How well an entry matches every term: 2 for the file name (a person's record or in-game name), 1 for
   * the path or the source's name; -1 when a term misses.
   */
  private score(e: AssetEntry, terms: string[]): number {
    // A person's record without its `Character.`, which every one has.
    const lower = e.kind === "npc" ? e.path.toLowerCase().replace(/^character\./, "") : e.path.toLowerCase();
    const name = e.kind === "npc" ? `${lower} ${(e.name ?? "").toLowerCase()}` : lower.slice(lower.lastIndexOf("\\") + 1);
    const source = e.source?.name.toLowerCase() ?? "";
    let score = 0;
    for (const t of terms) {
      if (name.includes(t)) score += 2;
      else if (lower.includes(t) || source.includes(t)) score += 1;
      else return -1;
    }
    return score;
  }

  /**
   * The Explorer's places (0.14.0): the game's own files, each mod, the open project, and the game's people,
   * with how many assets each holds.
   */
  exploreRoots(): ExploreRoot[] {
    const roots: ExploreRoot[] = [];
    if (this.entries.length) roots.push({ id: "game", label: "Game", count: this.entries.length });
    const mods = new Map<string, number>();
    let project: { name: string; count: number } | undefined;
    for (const e of this.extra) {
      if (e.source?.kind === "mod") mods.set(e.source.name, (mods.get(e.source.name) ?? 0) + 1);
      else if (e.source?.kind === "project") project = { name: e.source.name, count: (project?.count ?? 0) + 1 };
    }
    if (project) roots.push({ id: "project", label: `Project ${project.name}`, count: project.count });
    for (const [name, count] of [...mods].sort((x, y) => x[0].localeCompare(y[0]))) roots.push({ id: `mod:${name}`, label: `Mod ${name}`, count });
    if (this.npcs.length) roots.push({ id: "people", label: "People", count: this.npcs.length });
    return roots;
  }

  /**
   * One folder of an Explorer place: its folders, each with how many assets are under it, and the files
   * directly in it (the first `limit`). With `text`, every file under the folder that matches, as the search does.
   * `dir` is the folder's path inside the place, backslashes, any case; empty for the top.
   */
  explore(root: string, dir: string, text = "", limit = 400): { folders: ExploreFolder[]; items: AssetEntry[]; total: number } {
    const want = dir ? dir.toLowerCase().split("\\").filter(Boolean) : [];
    const terms = text.toLowerCase().split(/\s+/).filter(Boolean);
    const folders = new Map<string, ExploreFolder>();
    const items: AssetEntry[] = [];
    let total = 0;
    for (const e of this.poolOf(root)) {
      const seg = exploreSegments(root, e.path);
      if (seg.length <= want.length) continue;
      let under = true;
      for (let i = 0; i < want.length && under; i++) under = seg[i].toLowerCase() === want[i];
      if (!under) continue;
      if (terms.length) {
        if (this.score(e, terms) < 0) continue;
      } else if (seg.length > want.length + 1) {
        const key = seg[want.length].toLowerCase();
        const f = folders.get(key);
        if (f) f.count++;
        else folders.set(key, { name: seg[want.length], count: 1 });
        continue;
      }
      total++;
      if (items.length < limit) items.push(e);
    }
    const byName = (x: string, y: string) => x.localeCompare(y, undefined, { sensitivity: "base", numeric: true });
    items.sort((x, y) => byName(x.path, y.path));
    return { folders: [...folders.values()].sort((x, y) => byName(x.name, y.name)), items, total };
  }

  private poolOf(root: string): AssetEntry[] {
    if (root === "game") return this.entries;
    if (root === "people") return this.npcs;
    if (root === "project") return this.extra.filter((e) => e.source?.kind === "project");
    if (root.startsWith("mod:")) {
      const name = root.slice(4);
      return this.extra.filter((e) => e.source?.kind === "mod" && e.source.name === name);
    }
    return [];
  }

  /** What the bridge knows about an asset, asked once and remembered. */
  async lookAt(bridge: Bridge, assetPath: string): Promise<AssetInfo> {
    const known = this.info[assetPath];
    // An answer from before `hasCollision` (B4-2) is asked again.
    if (known && !known.error && known.hasCollision !== undefined) return known;
    const [r] = await bridge.meshInfoMany([assetPath]);
    const info: AssetInfo = r?.error ? { appearances: [], error: r.error } : { bounds: r?.bounds ?? undefined, appearances: r?.appearances ?? [], hasCollision: r?.hasCollision ?? null };
    this.info[assetPath] = info;
    try {
      this.save();
    } catch {
      // The index folder may be read-only; the answer still stands for this session.
    }
    return info;
  }
}

/** One entry per path: a file the game ships in two archives (a base archive and a patch) is one asset. */
function unique(entries: AssetEntry[]): AssetEntry[] {
  const seen = new Set<string>();
  return entries.filter((e) => {
    const key = e.path.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}


export function kindOf(file: string): AssetKind | undefined {
  const lower = file.toLowerCase();
  if (lower.endsWith(".mesh")) return "mesh";
  if (lower.endsWith(".ent")) return "entity";
  return undefined;
}

export { exploreSegments };
