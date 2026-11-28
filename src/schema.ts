// The scene format as JSON Schema (G1), one schema per format, and a small validator for the parts of
// JSON Schema they use. build.mjs writes them to docs/schema/, where the docs site publishes them; the
// smoke test checks that the files there are these. No REDnode, no dependencies.

export type Schema = { [key: string]: unknown };

const Site = "https://edgemodders.github.io/EDGEbuilder/schema";

const vec = (n: number, what: string): Schema => ({ type: "array", items: { type: "number" }, minItems: n, maxItems: n, description: what });

/** The schema of scene format 1, 2 or 3. A later format only adds to the one before. */
export function sceneSchema(format: 1 | 2 | 3): Schema {
  const kinds = format === 1 ? ["mesh", "entity", "light"] : ["mesh", "entity", "light", "npc"];
  const object: Schema = {
    type: "object",
    required: ["id", "kind", "transform"],
    properties: {
      id: { type: "string", pattern: "^[A-Za-z0-9_-]+$", description: "Unique in the scene. The writer's own: EDGEbuilder never renames it." },
      kind: { enum: kinds },
      resource: { type: "string", minLength: 1, description: "The game path of the mesh or entity template. Forward or backward slashes." },
      ...(format >= 2 ? { record: { type: "string", minLength: 1, description: "A person's TweakDB record, Character.*" } } : {}),
      appearance: { type: "string" },
      solid: { type: "boolean", description: "A mesh that stops V, bullets and cars once baked. Absent means not solid." },
      transform: {
        type: "object",
        required: ["position", "rotation", "scale"],
        properties: {
          position: vec(3, "x, y, z in metres, world space: X east, Y north, Z up"),
          rotation: vec(4, "A quaternion x, y, z, w"),
          scale: vec(3, "x, y, z"),
        },
      },
      streaming: {
        type: "object",
        properties: { primary: { type: "number", exclusiveMinimum: 0 }, secondary: { type: "number", exclusiveMinimum: 0 } },
        description: "How far off the baked object is seen, in metres. The game hides it beyond either distance.",
      },
      ref: { type: "string", minLength: 1, description: "The node reference, unique in the scene. edgebuilder/<scene>/<id> when missing." },
      bounds: {
        type: "object",
        required: ["min", "max"],
        properties: { min: vec(3, "The file's local box, lowest corner"), max: vec(3, "The file's local box, highest corner") },
        description: "The resource's local bounding box. With it, a bake does not need the file on the PC that bakes.",
      },
      group: { type: "string" },
      props: { type: "object", description: "The kind's own fields." },
      meta: { description: "The writer's own. Kept untouched, copied to a duplicate, never read, never baked." },
    },
    allOf: [
      { if: { properties: { kind: { enum: ["mesh", "entity"] } } }, then: { required: ["resource"] } },
      ...(format >= 2 ? [{ if: { properties: { kind: { const: "npc" } } }, then: { oneOf: [{ required: ["record"] }, { required: ["resource"] }] } }] : []),
    ],
  };
  const nodeRef: Schema = {
    type: "object",
    required: ["sectorHash", "entry"],
    properties: {
      sector: { type: "string" },
      sectorHash: { type: "string" },
      entry: { type: "integer", minimum: 0 },
      node: { type: "integer", minimum: 0 },
      type: { type: "string" },
      globalId: { type: "string" },
    },
  };
  const doorState: Schema = { type: "object", properties: { open: { type: "boolean" }, locked: { type: "boolean" }, closesItself: { type: "boolean" } } };
  const worldEdit: Schema = {
    type: "object",
    required: ["id", "action", "node"],
    properties: {
      id: { type: "string", minLength: 1 },
      action: { enum: ["remove", "door"] },
      what: { enum: ["door", "fakeDoor", "mesh"] },
      label: { type: "string" },
      node: { $ref: "#/$defs/nodeRef" },
      fingerprint: { type: "object", properties: { resource: { type: "string" }, appearance: { type: "string" }, position: vec(3, "Where the node is") } },
      proxies: { type: "array", items: { $ref: "#/$defs/nodeRef" } },
      ref: { type: "string" },
      door: { $ref: "#/$defs/doorState" },
      before: { $ref: "#/$defs/doorState" },
    },
    allOf: [{ if: { properties: { action: { const: "door" } } }, then: { required: ["door"] } }],
  };
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: `${Site}/scene-${format}.schema.json`,
    title: `EDGEbuilder scene, format ${format}`,
    description:
      "A scene file as EDGEbuilder reads, writes and bakes it. Fields the schema does not name are allowed: a later EDGEbuilder may add optional ones within a format. https://edgemodders.github.io/EDGEbuilder/scene.html",
    type: "object",
    required: ["format", "name", "objects"],
    properties: {
      format: { const: format },
      name: { type: "string", minLength: 1 },
      id: {
        type: "string",
        minLength: 1,
        description: "The scene's own id, made once when EDGEbuilder first saves it and never changed (Save as makes a new scene, with a new id). Lets other tools find a scene after a rename or a move. A writer may set its own.",
      },
      game: { type: "string", description: "The game version the scene was made against, for information." },
      generator: {
        type: "object",
        required: ["name"],
        properties: { name: { type: "string" }, version: { type: ["string", "number"] }, build: { type: ["string", "number"] } },
        description: "The program that wrote the file. Kept by EDGEbuilder when it saves.",
      },
      groups: {
        type: "array",
        items: { type: "object", required: ["id", "name"], properties: { id: { type: "string", minLength: 1 }, name: { type: "string" }, parent: { type: ["string", "null"] } } },
      },
      objects: { type: "array", items: { $ref: "#/$defs/object" } },
      ...(format === 3 ? { worldEdits: { type: "array", items: { $ref: "#/$defs/worldEdit" } } } : {}),
    },
    $defs: { object, ...(format === 3 ? { nodeRef, doorState, worldEdit } : {}) },
  };
}

export interface SchemaError {
  /** Where in the file, such as `objects[12].transform.position`. */
  path: string;
  text: string;
}

const typeOf = (v: unknown): string => (v === null ? "null" : Array.isArray(v) ? "array" : typeof v === "number" && Number.isInteger(v) ? "integer" : typeof v);

/**
 * Checks a value against a schema: type, const, enum, required, properties, items, minItems, maxItems,
 * minLength, pattern, minimum, exclusiveMinimum, $ref into $defs, allOf, oneOf, if/then. That is all the
 * scene schemas use; any JSON Schema validator reads the published files in full.
 */
export function validate(schema: Schema, value: unknown, limit = 200): SchemaError[] {
  const out: SchemaError[] = [];
  const defs = (schema.$defs ?? {}) as Record<string, Schema>;
  const walk = (s: Schema, v: unknown, at: string, into: SchemaError[]): void => {
    if (into.length >= limit) return;
    const say = (text: string): void => {
      into.push({ path: at || "the file", text });
    };
    if (typeof s.$ref === "string") return walk(defs[s.$ref.replace("#/$defs/", "")], v, at, into);
    const t = typeOf(v);
    if (s.type !== undefined) {
      const want = Array.isArray(s.type) ? (s.type as string[]) : [s.type as string];
      if (!want.includes(t) && !(t === "integer" && want.includes("number"))) return say(`is ${t === "array" || t === "object" || t === "integer" ? "an" : "a"} ${t}, not ${want.join(" or ")}`);
    }
    if ("const" in s && v !== s.const) return say(`is ${JSON.stringify(v)}, not ${JSON.stringify(s.const)}`);
    if (Array.isArray(s.enum) && !s.enum.includes(v)) return say(`is ${JSON.stringify(v)}, not one of ${(s.enum as unknown[]).join(", ")}`);
    if (typeof v === "string") {
      if (typeof s.minLength === "number" && v.length < s.minLength) say("is empty");
      if (typeof s.pattern === "string" && !new RegExp(s.pattern).test(v)) say(`${JSON.stringify(v)} does not match ${s.pattern}`);
    }
    if (typeof v === "number") {
      if (typeof s.minimum === "number" && v < s.minimum) say(`is ${v}, below ${s.minimum}`);
      if (typeof s.exclusiveMinimum === "number" && v <= s.exclusiveMinimum) say(`is ${v}, not above ${s.exclusiveMinimum}`);
    }
    if (Array.isArray(v)) {
      if (typeof s.minItems === "number" && v.length < s.minItems) say(`has ${v.length} numbers, not ${s.minItems}`);
      else if (typeof s.maxItems === "number" && v.length > s.maxItems) say(`has ${v.length} numbers, not ${s.maxItems}`);
      if (s.items) v.forEach((item, i) => walk(s.items as Schema, item, `${at}[${i}]`, into));
    }
    if (t === "object") {
      const o = v as Record<string, unknown>;
      for (const key of (s.required as string[] | undefined) ?? []) if (!(key in o)) say(`has no ${key}`);
      for (const [key, sub] of Object.entries((s.properties as Record<string, Schema> | undefined) ?? {})) if (key in o) walk(sub, o[key], at ? `${at}.${key}` : key, into);
    }
    for (const sub of (s.allOf as Schema[] | undefined) ?? []) walk(sub, v, at, into);
    if (Array.isArray(s.oneOf)) {
      const passing = (s.oneOf as Schema[]).filter((sub) => {
        const errs: SchemaError[] = [];
        walk(sub, v, at, errs);
        return errs.length === 0;
      }).length;
      if (passing !== 1) say(`needs exactly one of: ${(s.oneOf as Schema[]).map((sub) => ((sub.required as string[] | undefined) ?? []).join(" and ")).join("; ")}`);
    }
    if (s.if && s.then) {
      const errs: SchemaError[] = [];
      walk(s.if as Schema, v, at, errs);
      if (errs.length === 0) walk(s.then as Schema, v, at, into);
    }
  };
  walk(schema, value, "", out);
  return out;
}

/** The fields each part of a scene has in this EDGEbuilder, for the "not read" warning on any other. */
export function knownFields(format: 1 | 2 | 3): { top: string[]; object: string[]; group: string[] } {
  const s = sceneSchema(format);
  const object = (s.$defs as Record<string, Schema>).object;
  return { top: Object.keys(s.properties as object), object: Object.keys(object.properties as object), group: ["id", "name", "parent"] };
}
