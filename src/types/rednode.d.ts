// The slice of REDnode's `rednode` package that EDGEbuilder uses, declared here so the build
// needs no copy of the SDK. The host provides the real module to the mod and to the page.
// Source of truth: https://edgemodders.github.io/REDnode/api/ and packages/rednode/src in the REDnode repo.
declare module "rednode" {
  export interface GameRef {
    readonly $ref: number;
    readonly $type: string;
    $get(prop: string): Promise<unknown>;
    $set(prop: string, value: unknown): Promise<void>;
    $call(fn: string, ...args: unknown[]): Promise<unknown>;
    [method: string]: any;
  }

  export interface GameEvent {
    name: string;
    value: number;
    frame: number;
    entityId?: string;
    entityType?: string;
  }

  export interface GameState {
    connected: boolean;
    menu: boolean;
    photoMode: boolean;
    scene: boolean;
    mainMenu: boolean;
    /** V is in the world: a save has loaded and no other load has started (REDnode 0.47.0 and later). */
    world: boolean;
    overlay: "passive" | "interactive" | "hidden";
  }

  export const game: {
    readonly instance: unknown;
    state(): Promise<GameState>;
    onState(handler: (state: GameState) => void): () => void;
    on<T = GameEvent>(name: string, handler: (event: T) => void | Promise<void>): () => void;
    player: {
      position(): Promise<{ x: number; y: number; z: number }>;
      /** Moves V: `yaw` in degrees, the game's way (0 faces +Y, turning +Y towards -X). REDnode 0.32.0 and later. */
      teleport(to: { x: number; y: number; z: number; yaw?: number }): Promise<void>;
    };
    audio: { play(name: string): Promise<void> };
  };

  export const api: {
    $new(className: string, props?: Record<string, unknown>): Promise<GameRef | Record<string, unknown>>;
    $call(fn: string, ...args: unknown[]): Promise<unknown>;
    $static(className: string, fn: string, ...args: unknown[]): Promise<unknown>;
    GetPlayer(instance: unknown): Promise<GameRef | null>;
    [name: string]: any;
  };

  export interface EntityId {
    hash: string;
  }
  export interface WorldPoint {
    x: number;
    y: number;
    z: number;
  }
  export interface WorldRotation {
    i: number;
    j: number;
    k: number;
    r: number;
  }
  export interface SpawnOptions {
    template?: string;
    record?: string;
    /** A mesh's depot path: a prop with just that mesh, on a bare entity (REDnode 0.39.0 and later). */
    mesh?: string;
    meshAppearance?: string;
    scale?: WorldPoint;
    appearance?: string;
    /** For a person: stand where placed and stay friendly to V. On by default for a `Character.*` record. */
    npc?: boolean | { hold?: boolean; friendly?: boolean };
    position: WorldPoint;
    orientation?: WorldRotation;
    yaw?: number;
    components?: GameRef[];
    tags?: string[];
    timeoutMs?: number;
    /** false: resolve once created, without waiting for it to be in the world (REDnode 0.56.1 and later). */
    wait?: boolean;
    /** In the world wherever V is, until removed (REDnode 0.58.0 and later, #41). */
    alwaysSpawned?: boolean;
  }
  /** What world.load did (REDnode 0.40.1 and later). */
  export interface LoadResult {
    name: string;
    spawned: { object: string; id: EntityId }[];
    skipped: { object: string; why: string }[];
    notes: string[];
    ms: number;
  }
  export interface Spawned {
    id: EntityId;
    entity: GameRef | null;
  }
  export type EntityEventName = "Entity/Initialize" | "Entity/AfterAttach" | "Entity/Attached" | "Entity/Detach";
  export const world: {
    available(): Promise<boolean>;
    spawn(options: SpawnOptions): Promise<Spawned>;
    move(id: EntityId | string, position: WorldPoint, orientation?: WorldRotation, yaw?: number): Promise<boolean>;
    remove(id: EntityId | string): Promise<boolean>;
    watch(id: EntityId | string): Promise<boolean>;
    entity(id: EntityId | string): Promise<GameRef | null>;
    on(name: EntityEventName, handler: (event: GameEvent) => void): () => void;
    /** After an archive swap, this package's spawns that use a swapped file are spawned again (REDnode 0.40.1 and later). */
    onRespawn(handler: (before: EntityId, after: EntityId) => void): () => void;
    /** Spawns a scene file's objects (a path, or the parsed scene); loading a name again replaces it (REDnode 0.40.1 and later). */
    load?(scene: unknown, options?: { name?: string; wait?: boolean; alwaysSpawned?: boolean }): Promise<LoadResult>;
    /** Removes what world.load spawned under that name; resolves with how many. */
    unload?(name: string): Promise<number>;
    /** This package's spawns still listed; `attached` while in the world, `scene` when world.load made it (REDnode 0.53.0 and later). */
    spawned?(): { id: EntityId; attached: boolean; scene?: string }[];
    /** The entities near V, nearest first (REDnode 0.4x and later). */
    near?(options?: { radius?: number; files?: boolean; uses?: string[] }): Promise<NearEntity[]>;
    /** The files an entity uses: its template's path hash and the rest. */
    files?(entity: GameRef | EntityId | string): Promise<{ template: string | null; components: number; files: string[] }>;
    /** Starts the world node registry (#24) and answers its state; it knows sectors that load after it starts (REDnode 0.67.3 and later, experimental). */
    nodeRegistry?(options?: { instances?: boolean }): Promise<NodeRegistryState>;
    /** The world's nodes along a ray, nearest first (experimental). */
    pick?(options?: PickOptions): Promise<{ hits: WorldNode[]; found: number; physicsHit: { point: [number, number, number]; distance: number } | null; looked: number; ms: number }>;
    /** One node again by its id, or null when its sector is not loaded. */
    node?(id: string): Promise<WorldNode | null>;
    /** Outlines a node, or takes the outline off with null. */
    highlight?(id: string, style?: { outline?: number; fill?: number; seeThrough?: boolean; opacity?: number } | null): Promise<boolean>;
    /** Hides a node for the session, or shows it again; a hidden node that streams back in is hidden again. */
    setVisible?(id: string, visible: boolean): Promise<boolean>;
  };

  /** An entity near V, as world.near finds it. */
  export interface NearEntity {
    entity: GameRef;
    id: EntityId;
    /** Its game class, such as `Door`. */
    type: string;
    /** Metres from V. */
    distance: number;
    appearance: string;
    files?: string[];
  }
  /** A node of the world as REDnode's registry recorded it (#24). */
  export interface WorldNode {
    /** `0x<sector path hash>:<instance index>`. */
    id: string;
    kind: string;
    instanceKind: string | null;
    sector: string;
    /** Its node data entry, and how many the sector has. */
    instance: number;
    instanceCount: number;
    /** Its node's index, and how many nodes the sector has. */
    index: number;
    nodeCount: number;
    nodeId: string | null;
    proxyId: string | null;
    flags: number;
    position: [number, number, number];
    orientation: [number, number, number, number];
    scale: [number, number, number];
    bounds: { min: [number, number, number]; max: [number, number, number] };
    boundsFrom: "mesh" | "scale" | "place";
    resource: string | null;
    appearance: string | null;
    streamed: boolean;
    attached: boolean | null;
    visible: boolean | null;
    hidden: boolean;
    distance?: number;
    holdsHit?: boolean;
    volume?: number;
    entity?: string;
  }
  export interface PickOptions {
    from?: WorldPoint;
    dir?: WorldPoint;
    max?: number;
    limit?: number;
    kinds?: string[];
    all?: boolean;
    physics?: boolean;
    order?: "fit" | "nearest";
    helpers?: boolean;
  }
  export interface NodeRegistryState {
    attached: string[];
    layout: string | null;
    sectors: number;
    badSectors: number;
    setups: number;
    instances: number;
    hidden: number;
    refused: number;
    canHide: boolean;
    canHighlight: boolean;
  }

  /** Solo mode needs the "solo" permission (REDnode 0.18.0 and later). */
  export const ui: {
    solo(on: boolean): Promise<void>;
    onSolo(handler: (on: boolean) => void): () => void;
  };

  export type ServiceHandle<T = Record<string, (...args: any[]) => any>> = {
    [K in keyof T]: T[K] extends (...args: infer A) => infer R ? (...args: A) => Promise<Awaited<R>> : never;
  } & {
    $call(fn: string, ...args: unknown[]): Promise<any>;
    $on(name: string, handler: (data: any) => void): () => void;
  };
  /** Services between packages (REDnode 0.34.0 and later). */
  export const service: {
    connect<T = Record<string, (...args: any[]) => any>>(id: string): Promise<ServiceHandle<T>>;
    /** Sends an event to every package connected to this one's service. */
    emit(name: string, data?: unknown): void;
  };

  export const pkg: {
    readonly id: string;
    readonly dir: string;
    readonly dataDir: string;
    readonly appsDirs: string[];
  };

  export const channel: {
    post(data: unknown): void;
    on<T = any>(handler: (data: T) => void): () => void;
  };

  export interface KernelBridgeHandle {
    readonly version: string | null;
    readonly source: string | null;
    call<T = any>(method: string, params?: Record<string, unknown>): Promise<T>;
  }
  export interface Requirement {
    name: string;
    wants: string;
    found: string | null;
    installed: boolean;
    ok: boolean;
    note: string;
  }
  /** REDnode 0.17 and later have bridge() and requirements(); older hosts do not. */
  export const kernel: {
    bridge?: () => Promise<KernelBridgeHandle>;
    requirements?: () => Promise<Requirement[]>;
  };

  export const secrets: {
    get(name: string): Promise<string | null>;
    set(name: string, value: string): Promise<void>;
    delete(name: string): Promise<void>;
  };

  /** REDnode 0.41.0 and later, behind the `archives` permission: swapping archives into the running game (B2d). */
  export const archives: {
    reload(files: string[], options?: { refresh?: boolean }): Promise<{
      reloaded: string[];
      failed: { file: string; why: string }[];
      via: string;
      ms: number;
      world?: { entity: string; how: "respawn" | "appearance"; package?: string }[];
    }>;
  };
}
