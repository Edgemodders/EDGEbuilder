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
    overlay: "passive" | "interactive" | "hidden";
  }

  export const game: {
    readonly instance: unknown;
    state(): Promise<GameState>;
    onState(handler: (state: GameState) => void): () => void;
    on<T = GameEvent>(name: string, handler: (event: T) => void | Promise<void>): () => void;
    player: { position(): Promise<{ x: number; y: number; z: number }> };
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
    appearance?: string;
    position: WorldPoint;
    orientation?: WorldRotation;
    yaw?: number;
    components?: GameRef[];
    tags?: string[];
    timeoutMs?: number;
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

  export const secrets: {
    get(name: string): Promise<string | null>;
    set(name: string, value: string): Promise<void>;
    delete(name: string): Promise<void>;
  };
}
