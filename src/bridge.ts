// A small REDbridge client: starts the bridge with the game folder and speaks JSON-RPC 2.0 over its
// stdio, Content-Length framed. REDbridge is GPL-3.0 and its own program; this protocol is the
// only contract. No dependencies, so the package ships without node_modules.

import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

export interface BridgeInfo {
  version: string;
  wolvenKit: string;
  gameDir: string | null;
  gameLoaded: boolean;
  archives: number;
  files: number;
}

export interface BridgeFile {
  hash: string;
  name: string;
  size: number;
  archive: string;
}

export interface FileList {
  total: number;
  items: BridgeFile[];
}

export interface MeshInfoResult {
  path: string;
  type: string;
  bounds: { min: number[]; max: number[] } | null;
  appearances: string[];
  parts?: unknown[] | null;
  error: string | null;
}

export class BridgeError extends Error {}

export class BridgeClient {
  private process: ChildProcess | undefined;
  private buffer = Buffer.alloc(0);
  private nextId = 1;
  private readonly pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  readonly log: string[] = [];
  onExit?: (code: number | null) => void;

  constructor(
    readonly exe: string,
    readonly gameDir: string | undefined,
    readonly dotnetRoot: string | undefined = defaultDotnetRoot(),
  ) {}

  get running(): boolean {
    return this.process !== undefined && this.process.exitCode === null && !this.process.killed;
  }

  start(): void {
    if (this.running) return;
    const env = { ...process.env };
    if (this.dotnetRoot) env.DOTNET_ROOT = this.dotnetRoot;
    const args = this.gameDir ? ["--game", this.gameDir] : [];
    const child = spawn(this.exe, args, { env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    this.process = child;
    child.stderr!.on("data", (chunk: Buffer) => {
      for (const line of chunk.toString("utf8").split(/\r?\n/)) {
        if (line.trim()) {
          this.log.push(line);
          if (this.log.length > 200) this.log.shift();
        }
      }
    });
    child.stdout!.on("data", (chunk: Buffer) => this.receive(chunk));
    child.on("exit", (code) => {
      for (const p of this.pending.values()) p.reject(new BridgeError(`REDbridge exited (${code ?? "signal"})`));
      this.pending.clear();
      this.onExit?.(code);
    });
    child.on("error", (err) => {
      for (const p of this.pending.values()) p.reject(err);
      this.pending.clear();
    });
  }

  stop(): void {
    if (this.process && this.process.exitCode === null) {
      this.process.stdin?.end();
      const p = this.process;
      setTimeout(() => {
        if (p.exitCode === null) p.kill();
      }, 2000).unref();
    }
    this.process = undefined;
  }

  call<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
    if (!this.running) return Promise.reject(new BridgeError("REDbridge is not running"));
    const id = this.nextId++;
    const body = Buffer.from(JSON.stringify({ jsonrpc: "2.0", id, method, params: params ?? {} }), "utf8");
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.process!.stdin!.write(Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, "ascii"), body]));
    });
  }

  private receive(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      const headerEnd = this.buffer.indexOf("\r\n\r\n");
      if (headerEnd < 0) return;
      const header = this.buffer.subarray(0, headerEnd).toString("ascii");
      const m = /content-length:\s*(\d+)/i.exec(header);
      if (!m) {
        this.buffer = this.buffer.subarray(headerEnd + 4);
        continue;
      }
      const length = Number(m[1]);
      const start = headerEnd + 4;
      if (this.buffer.length < start + length) return;
      const text = this.buffer.subarray(start, start + length).toString("utf8");
      this.buffer = this.buffer.subarray(start + length);
      let msg: { id?: number; result?: unknown; error?: { message?: string } };
      try {
        msg = JSON.parse(text);
      } catch {
        continue;
      }
      if (typeof msg.id !== "number") continue;
      const p = this.pending.get(msg.id);
      if (!p) continue;
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new BridgeError(msg.error.message ?? "REDbridge error"));
      else p.resolve(msg.result);
    }
  }

  info(): Promise<BridgeInfo> {
    return this.call<BridgeInfo>("bridge.info");
  }

  list(prefix: string, offset: number, limit = 5000): Promise<FileList> {
    return this.call<FileList>("archive.list", { prefix, offset, limit });
  }

  meshInfoMany(paths: string[]): Promise<MeshInfoResult[]> {
    return this.call<MeshInfoResult[]>("mesh.infoMany", { paths });
  }
}

/**
 * Where a per-user .NET 10 runtime lives when there is one, for the bridge process only. Never set
 * DOTNET_ROOT for the user: every .NET program on the machine would then look only there.
 */
export function defaultDotnetRoot(): string | undefined {
  const root = path.join(process.env.LOCALAPPDATA ?? "", "Microsoft", "dotnet");
  try {
    const has10 = fs.readdirSync(path.join(root, "shared", "Microsoft.NETCore.App")).some((v) => v.startsWith("10."));
    return has10 ? root : undefined;
  } catch {
    return undefined;
  }
}

/** Newest first: "v0.10.0" before "v0.6.0". */
function compareTags(a: string, b: string): number {
  const pa = a.replace(/^v/, "").split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.replace(/^v/, "").split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) if ((pb[i] ?? 0) !== (pa[i] ?? 0)) return (pb[i] ?? 0) - (pa[i] ?? 0);
  return 0;
}

/**
 * The REDbridge to run: the setting, else the newest copy REDdeck fetched (REDdeck keeps them under
 * VS Code's storage for its extension), else none. REDnode may hand one out itself one day
 * (kernel.bridge, REDnode issue #4); until then this is the lookup.
 */
export function findBridge(setting?: string): string | undefined {
  if (setting && fs.existsSync(setting)) return setting;
  const appData = process.env.APPDATA ?? "";
  for (const code of ["Code", "Code - Insiders", "VSCodium"]) {
    const dir = path.join(appData, code, "User", "globalStorage", "edgemodders.reddeck", "bridge");
    try {
      const tags = fs.readdirSync(dir).filter((t) => fs.existsSync(path.join(dir, t, "REDbridge.exe")));
      tags.sort(compareTags);
      if (tags.length) return path.join(dir, tags[0], "REDbridge.exe");
    } catch {
      // Not installed there.
    }
  }
  return undefined;
}

/** True when the folder holds the game. */
export function isGameFolder(dir: string | undefined): dir is string {
  return !!dir && fs.existsSync(path.join(dir, "bin", "x64", "Cyberpunk2077.exe"));
}
