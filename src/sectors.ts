// Sector Tools, stage S1 (EDGEbuilder #9): the game's streaming sectors on the World tab's Sectors
// sub-tab, and one sector's nodes in the Sector drawer. REDnode-free, so the smoke test runs it. The
// mod reads sectors through REDbridge (`sector.find`, `sector.nodes`) and marks what is streamed in
// through REDnode's world node registry, whose ids are `0x<sector path hash>:<node data entry>`.

import * as path from "node:path";
import type { SectorNodeRow, SectorRow } from "./protocol";

/** A sector as REDbridge's sector.find answers it. */
export interface FoundSector {
  path: string;
  kind: string;
  grid?: number[] | null;
  level: number;
  box: { min: number[]; max: number[] };
  block: string;
  archive?: string | null;
  replaces?: boolean;
  variants?: number;
}

/** One placed thing of a sector as REDbridge's sector.nodes answers it. */
export interface SectorItem {
  index: number;
  node: number;
  kind: string;
  ref?: string | null;
  hash?: string | null;
  resource?: string | null;
  resourceHash?: string | null;
  appearance?: string | null;
  transform: { position: number[]; rotation: number[]; scale: number[] };
  instances?: unknown[] | null;
  streaming?: { primary: number; secondary?: number | null };
  bounds?: { min: number[]; max: number[] } | null;
}

const FnvOffset = 0xcbf29ce484222325n;
const FnvPrime = 0x100000001b3n;
const Mask = 0xffffffffffffffffn;

/** The game's path hash of a depot path (FNV-1a 64 over the lowercased path), as REDnode's registry writes it in its ids: `0x` and the hex digits, no leading zeros. */
export function sectorHash(depotPath: string): string {
  let h = FnvOffset;
  for (const byte of Buffer.from(depotPath.toLowerCase().replace(/\//g, "\\"), "utf8")) {
    h ^= BigInt(byte);
    h = (h * FnvPrime) & Mask;
  }
  return `0x${h.toString(16)}`;
}

/** A sector's short name: its file name without `.streamingsector`. */
export function sectorName(depotPath: string): string {
  return path.win32.basename(depotPath).replace(/\.streamingsector$/i, "");
}

/** The kinds the Sectors sub-tab switches, and which of REDbridge's kinds each covers. */
export const SectorKinds: Record<string, string[]> = {
  exterior: ["exterior"],
  interior: ["interior"],
  quest: ["quest"],
  other: ["navigation", "alwaysLoaded", "unknown"],
};

/** REDbridge's kinds for the switches on. */
export function bridgeKinds(on: string[]): string[] {
  return on.flatMap((k) => SectorKinds[k] ?? []);
}

/** The levels a level choice means: all, one, or 3 and coarser. */
export function levelsOf(level: number | null): number[] | undefined {
  if (level === null || level === undefined) return undefined;
  return level >= 3 ? [3, 4, 5, 6, 7, 8] : [level];
}

/**
 * Whether a sector matches the typed text: words all in its path (`interior watson`), or a grid cell as
 * `-22 19`, `-22_19` or `-22,19` (the x and y of `exterior_-22_19_1_0`, any z and level).
 */
export function sectorMatches(s: Pick<FoundSector, "path" | "grid">, text: string): boolean {
  const t = text.trim().toLowerCase();
  if (!t) return true;
  const cell = t.match(/^(-?\d+)[\s_,]+(-?\d+)(?:[\s_,]+(-?\d+))?$/);
  if (cell) {
    if (!s.grid) return false;
    return s.grid[0] === Number(cell[1]) && s.grid[1] === Number(cell[2]) && (cell[3] === undefined || s.grid[2] === Number(cell[3]));
  }
  const p = s.path.toLowerCase();
  return t.split(/\s+/).every((w) => p.includes(w));
}

/** How far a point is from a box, 0 inside it. */
export function distanceToBox(p: number[], box: { min: number[]; max: number[] }): number {
  const d = [0, 1, 2].map((i) => Math.max(box.min[i] - p[i], 0, p[i] - box.max[i]));
  return Math.hypot(d[0], d[1], d[2]);
}

/** How far a point is from the middle of a box. */
export function distanceToMiddle(p: number[], box: { min: number[]; max: number[] }): number {
  return Math.hypot(...[0, 1, 2].map((i) => p[i] - (box.min[i] + box.max[i]) / 2));
}

/**
 * The Sectors list. Around a place: finest level first, then the sector whose box's middle is nearest
 * (streaming boxes overlap a lot: at V's flat about 3,000 contain V, and the nearest middle is V's own
 * grid cell); by name: finest level first, then exterior, interior, quest and the rest, then by name.
 */
export function sectorRows(found: FoundSector[], at: number[] | undefined, limit: number): SectorRow[] {
  const order = ["exterior", "interior", "quest"];
  const rank = (k: string) => (order.includes(k) ? order.indexOf(k) : order.length);
  const rows = found.map(
    (s): SectorRow => ({
      path: s.path,
      name: sectorName(s.path),
      kind: s.kind,
      level: s.level,
      ...(s.grid ? { grid: s.grid } : {}),
      block: s.block,
      ...(s.variants ? { variants: s.variants } : {}),
      ...(s.replaces ? { replaces: true } : {}),
      ...(at ? { distance: distanceToMiddle(at, s.box) } : {}),
    }),
  );
  rows.sort((a, b) => a.level - b.level || (at ? (a.distance ?? 0) - (b.distance ?? 0) : rank(a.kind) - rank(b.kind)) || a.name.localeCompare(b.name));
  return rows.slice(0, limit);
}

/** A node's class without `world` and `Node`: `CookedStaticMesh`. */
export function shortKind(kind: string): string {
  return kind.replace(/^world/, "").replace(/Node$/, "") || kind;
}

/** Whether a node matches the drawer's filter: words all in its class, resource, reference or entry number. */
export function nodeMatches(item: SectorItem, text: string): boolean {
  const t = text.trim().toLowerCase();
  if (!t) return true;
  const hay = [item.kind, item.resource ?? item.resourceHash ?? "", item.ref ?? "", item.appearance ?? "", `#${item.index}`].join(" ").toLowerCase();
  return t.split(/\s+/).every((w) => hay.includes(w));
}

/** The drawer's rows: the nodes matching the filter, in entry order, at most `limit`. */
export function nodeRows(items: SectorItem[], text: string, limit: number, keep?: number): { rows: SectorNodeRow[]; matching: number } {
  const hits = items.filter((i) => nodeMatches(i, text));
  // The picked entry is shown even past the limit, so the drawer can scroll to it.
  const shown = hits.slice(0, limit);
  const kept = keep === undefined ? undefined : hits.find((i) => i.index === keep);
  if (kept && !shown.includes(kept)) shown.push(kept);
  return {
    matching: hits.length,
    rows: shown.map(
      (i): SectorNodeRow => ({
        entry: i.index,
        node: i.node,
        kind: i.kind,
        ...(i.resource ? { resource: i.resource } : i.resourceHash ? { resource: i.resourceHash } : {}),
        ...(i.ref ? { ref: i.ref } : {}),
        ...(i.hash ? { hash: i.hash } : {}),
        ...(i.appearance ? { appearance: i.appearance } : {}),
        position: [i.transform.position[0] ?? 0, i.transform.position[1] ?? 0, i.transform.position[2] ?? 0],
        ...(i.instances?.length ? { copies: i.instances.length } : {}),
      }),
    ),
  };
}

/** Whether a node places an entity (a door, a device, a prop with its own logic): its stand-in goes with it. */
export function placesEntity(kind: string): boolean {
  return /Entity|Device/.test(kind) && kind !== "worldEntityProxyMeshNode";
}

/** How many of a scene file's removals name this sector, by its path or its path hash (door states are set live, so a replaced sector does not refuse them). */
export function editsInSector(edits: { action?: string; node?: { sector?: string; sectorHash?: string } }[] | undefined, depotPath: string): number {
  if (!Array.isArray(edits)) return 0;
  const p = depotPath.toLowerCase();
  const h = sectorHash(depotPath);
  return edits.filter((e) => e?.action === "remove" && ((e.node?.sector && e.node.sector.toLowerCase() === p) || e.node?.sectorHash?.toLowerCase() === h)).length;
}
