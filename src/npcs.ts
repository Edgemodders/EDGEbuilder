// The people Browse offers (B3c): the game's `Character` records, read once from the player's own
// TweakDB through REDbridge (tweakdb.records, 0.8.0 and later) and kept as JSON beside the asset index.
// Nothing is shipped; the player's game is the source. docs/design.md, "NPCs (B3c)".

import * as fs from "node:fs";
import * as path from "node:path";
import type { Bridge, TweakRecords } from "./bridge";
import type { AssetEntry } from "./protocol";

/** A person's selection box, standing on its position: the game puts an NPC's origin at its feet. */
export const PersonBounds = { min: [-0.3, -0.3, 0], max: [0.3, 0.3, 1.8] };

/** The flats Browse needs from each record. */
const Flats = ["fullDisplayName", "displayName", "entityTemplatePath", "appearanceName"];

const PageSize = 2000;

/** Whether an asset path is a `Character` record rather than a file. */
export function isRecord(assetPath: string): boolean {
  return /^Character\./i.test(assetPath);
}

interface NpcFile {
  format: 1;
  game: string;
  built: string;
  entries: AssetEntry[];
}

/** A LocKey flat's text, or a plain string; empty when there is none. */
function textOf(v: unknown): string {
  if (typeof v === "string") return v;
  if (v && typeof v === "object" && "text" in v) return String((v as { text?: unknown }).text ?? "");
  return "";
}

/**
 * The Browse row for one record, or none: records without a template cannot be spawned, and the
 * `_inline` ones are parts of other records (a weapon, a loot table), not people.
 */
export function npcEntry(item: TweakRecords["items"][number]): AssetEntry | undefined {
  const record = item.path;
  if (!record || !isRecord(record) || record.includes("_inline")) return undefined;
  const f = item.flats ?? {};
  const template = typeof f.entityTemplatePath === "string" ? f.entityTemplatePath : "";
  if (!template) return undefined;
  const name = textOf(f.fullDisplayName) || textOf(f.displayName);
  const look = typeof f.appearanceName === "string" && f.appearanceName !== "None" ? f.appearanceName : "";
  return { path: record, kind: "npc", size: 0, template, ...(name && !/^LocKey#/i.test(name) ? { name } : {}), ...(look ? { appearance: look } : {}) };
}

export class NpcList {
  entries: AssetEntry[] = [];
  game = "";
  private byRecord: Map<string, AssetEntry> | undefined;

  /** `dir` is the asset index's folder; the list lives in its `npcs` folder, so the index never reads it. */
  constructor(readonly dir: string) {}

  private fileFor(game: string): string {
    return path.join(this.dir, "npcs", `${game}.json`);
  }

  /** Loads the list for this game, if one was read. */
  load(game: string): boolean {
    try {
      const data = JSON.parse(fs.readFileSync(this.fileFor(game), "utf8")) as NpcFile;
      if (data.format !== 1 || !Array.isArray(data.entries)) return false;
      this.take(game, data.entries);
      return true;
    } catch {
      return false;
    }
  }

  /** Reads every `Character` record from the game's TweakDB, in pages. The first TweakDB call takes about 12 s. */
  async build(bridge: Bridge, game: string, progress?: (text: string) => void): Promise<void> {
    const entries: AssetEntry[] = [];
    let offset = 0;
    let total = 0;
    do {
      const page = await bridge.tweakRecords({ type: "Character", flats: Flats, offset, limit: PageSize, resolveLocKeys: true });
      total = page.total;
      for (const item of page.items) {
        const e = npcEntry(item);
        if (e) entries.push(e);
      }
      offset += page.items.length;
      progress?.(`Character records: ${Math.min(offset, total).toLocaleString()} of ${total.toLocaleString()}, ${entries.length.toLocaleString()} people so far`);
      if (!page.items.length) break;
    } while (offset < total);
    entries.sort((a, b) => a.path.localeCompare(b.path));
    this.take(game, entries);
    fs.mkdirSync(path.dirname(this.fileFor(game)), { recursive: true });
    const data: NpcFile = { format: 1, game, built: new Date().toISOString(), entries };
    fs.writeFileSync(this.fileFor(game), JSON.stringify(data));
  }

  /** The row for a record, any case. */
  find(record: string | undefined): AssetEntry | undefined {
    if (!record) return undefined;
    this.byRecord ??= new Map(this.entries.map((e) => [e.path.toLowerCase(), e]));
    return this.byRecord.get(record.toLowerCase());
  }

  private take(game: string, entries: AssetEntry[]): void {
    this.game = game;
    this.entries = entries;
    this.byRecord = undefined;
  }
}
