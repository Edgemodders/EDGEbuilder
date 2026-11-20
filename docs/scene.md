---
title: Scene format
---

# The scene file

A scene is the contract between EDGEbuilder's two halves and the input to REDbridge's `sector.build`. Format 1, pinned 2026-10-13. It lives in any folder of the [Library](library.md), at `source/scenes/<name>.scene.json` in a REDcode project, or in EDGEbuilder's data folder ("This PC"); B3-2 lets the player choose. The file name is the scene's name by the bake's rule (lowercase, every character but a letter or digit an `_`).

```json
{
  "format": 1,
  "name": "My Alley",
  "game": "2.31",
  "groups": [
    { "id": "grp_crates", "name": "Crates", "parent": null }
  ],
  "objects": [
    {
      "id": "crate_a",
      "kind": "mesh",
      "resource": "base/environment/decoration/containers/cargo/cargo_crate/cargo_crate_a.mesh",
      "appearance": "default",
      "transform": { "position": [-1200.0, 1500.0, 20.0], "rotation": [0, 0, 0.3826834, 0.9238795], "scale": [1, 1, 1] },
      "streaming": { "primary": 60, "secondary": 48 },
      "ref": "edgebuilder/my_alley/crate_a",
      "bounds": { "min": [-0.58, -0.73, 0.0], "max": [0.58, 0.73, 1.24] },
      "group": "grp_crates",
      "props": {}
    },
    {
      "id": "lamp",
      "kind": "light",
      "transform": { "position": [-1199.0, 1500.0, 23.0], "rotation": [0, 0, 0, 1], "scale": [1, 1, 1] },
      "props": { "type": "spot", "color": [255, 200, 120], "intensity": 800, "radius": 12, "innerAngle": 30, "outerAngle": 60 }
    }
  ]
}
```

| Field | Meaning |
|---|---|
| `format` | Always 1 for this page |
| `name` | The scene's name. The bake lowercases it and keeps letters, digits and `_` for file names |
| `game` | The game version the scene was made against, for information |
| `groups` | The scene tree: id, name and parent id. Groups organise the editor; the bake flattens them into one sector |
| `objects[].id` | Unique in the scene. Letters, digits, `_` and `-` |
| `objects[].kind` | `mesh`, `entity` or `light`. More kinds come with phase B5 |
| `objects[].resource` | The game path of the mesh or entity template. Forward or backward slashes. None for a light |
| `objects[].appearance` | The appearance name, default `default` |
| `objects[].solid` | For a mesh, optional: `true` bakes a node that stops V, bullets and cars (REDbridge 0.12.0 and later). A mesh with no collision data stays draw-only. EDGEbuilder sets it on new meshes; absent means not solid |
| `objects[].transform` | `position` [x, y, z] in metres, world space; `rotation` a quaternion [x, y, z, w]; `scale` [x, y, z] |
| `objects[].streaming` | `primary`: the distance in metres the node streams in at; `secondary`: a second distance, from the node's secondary reference point (its middle, as REDbridge writes it). The game hides the node beyond either, so the nearer one is how far it is seen (measured in game on 2026-11-08: 120/96 reached 96 m). EDGEbuilder's Seen from writes both the same. Both optional: the bake derives them from the object's size |
| `objects[].ref` | The node reference, unique in the scene. Generated as `edgebuilder/<scene>/<id>` when missing |
| `objects[].bounds` | The resource's local bounding box, from the asset index, so the bake need not read the game. Read from the game when missing |
| `objects[].group` | The group the object belongs to |
| `objects[].props` | The kind's own fields. Lights: `type` (`point`, `spot`, `area`), `color` [r, g, b] 0 to 255, `intensity`, `radius`, `innerAngle`, `outerAngle`, `ev`, `temperature` |

Positions are the game's world coordinates in metres: X east, Y north, Z up. A rotation of [0, 0, 0, 1] is no rotation.

## What the bake makes of it

REDbridge's `sector.build` turns the objects into one `worldStreamingSector` with a node per object (`worldMeshNode`, `worldEntityNode`, `worldStaticLightNode`), one `worldStreamingBlock` whose descriptor holds a streaming box around every node, and an ArchiveXL file that patches the block into the world. The files land in the REDcode project under `source/archive/edgebuilder/<name>/` and `source/resources/archive/pc/mod/<name>.xl`. Every node's reference goes into its node data, so the game can find it by name.

## Format 2 draft: NPCs

Drafted on 2026-10-23 for phase B3c. **Pinned on 2026-11-12, when B3c passed in game on EDGEbuilder 0.10.9** (the heading keeps its name, so links to it hold): EDGEbuilder writes `format: 2` only for a scene that holds a person, format 1 otherwise, and REDbridge still gets format 1 (a bake leaves people out). EDGEbuilder writes `record`, never `resource`, for the people it places, and `props.behaviour: "idle"`. REDnode 0.40.1 already reads this draft in `world.load` (H2c-b passed in game on 2026-10-26): it takes `format` up to 2, an `npc` with exactly one of `record` and `resource`, and notes any `props.behaviour` other than `idle`; it ignores `ref`, `groups`, `streaming`, `bounds` and an entity's scale. A change to these fields goes to REDnode's reader in step. Agreed with the owner the same day, with REDnode's H2c ([World API, H2c](https://edgemodders.github.io/REDnode/world.html#h2c-world-objects-plan)): REDnode reads scene files itself (`world.load`), so EDGEquest and other packages can load a scene without EDGEbuilder running, and the format stays EDGEbuilder's to pin.

Format 2 adds one kind and changes nothing else. A format 1 file is a valid format 2 file once its `format` says 2.

```json
{
  "id": "wakako_spot",
  "kind": "npc",
  "record": "Character.CitizenRichFemale",
  "appearance": "default",
  "transform": { "position": [-1200.0, 1502.0, 20.0], "rotation": [0, 0, 1, 0], "scale": [1, 1, 1] },
  "ref": "edgebuilder/my_alley/wakako_spot",
  "props": { "behaviour": "idle" }
}
```

| Field | For `npc` |
|---|---|
| `record` | The character's TweakDB record (`Character.*`). One of `record` and `resource` |
| `resource` | An entity template (`.ent`) instead of a record |
| `appearance` | The appearance name; the record's own when missing |
| `transform` | As for every kind. `scale` is ignored |
| `props.behaviour` | `idle` (the default): stands where it was placed and stays friendly to V. Other behaviours (walk, talk, fight) are a later phase |

**Baking NPCs is open.** The game places people through community and population spawner nodes, not `worldEntityNode`, and nothing here has been tried. Until a bake is planned, an `npc` object loads in the running game (EDGEbuilder's previews, REDnode's `world.load`) and the bake skips it with a warning.

## Format 3 draft: world edits

Drafted on 2026-11-19 for D1, the Doors slice ([World objects, "Doors first"](world-objects.md#doors-first-d0-to-d2)); built in EDGEbuilder 0.12.0 (D1a), **not pinned until D1 passes in game**. A scene can change the game's own world: D1 removes doors, painted-on doors and meshes the game placed. EDGEbuilder writes `format: 3` only for a scene with at least one world edit, and format 2 or 1 otherwise, as before. Format 3 adds one list, `worldEdits`, and changes nothing else.

```json
"worldEdits": [
  {
    "id": "remove_single_door",
    "action": "remove",
    "what": "door",
    "label": "Door single_door.ent (doors_single_kitsch_g_frameless)",
    "node": {
      "sector": "base\worlds\03_night_city\_compiled\default\exterior_-22_19_1_0.streamingsector",
      "sectorHash": "0x3c9117867951bc5a",
      "entry": 288,
      "node": 271,
      "type": "worldEntityNode",
      "globalId": "6132383399567759307"
    },
    "fingerprint": { "resource": "base\gameplay\devices\doors\final\single_door.ent", "appearance": "doors_single_kitsch_g_frameless", "position": [-1388.56, 1271.94, 123.07] },
    "ref": "$/03_night_city/c_watson/little_china/.../#q001_door_v_flat"
  }
]
```

| Field | Meaning |
|---|---|
| `id` | Unique in the scene |
| `action` | `remove` (D1). Later edits (move, rescale, an appearance, a door's state in D2) get their own actions |
| `what` | The picker's kind: `door`, `fakeDoor` or `mesh` |
| `label` | What the Scene tab shows |
| `node.sector`, `node.sectorHash` | The sector's depot path (empty if REDbridge did not name it) and its path hash, as REDnode's world node registry gives it |
| `node.entry` | The node data entry: what ArchiveXL's `nodeDeletions` names, and what REDnode's registry calls the instance. ArchiveXL counts a sector's entries, not its nodes (D0) |
| `node.node`, `node.type` | The node the entry places and its class; ArchiveXL checks the class |
| `node.globalId` | The node's global id in decimal, when it has one; for a door, its entity's id (D0) |
| `fingerprint` | The file, appearance and place, to find the node again if a game patch renumbers the sector |
| `proxies` | An entity's proxy meshes seen in the game (`worldEntityProxyMeshNode`s whose `ownerGlobalId` is the entity): the bake removes them too, and finds them itself when absent |
| `ref` | The node's reference, when it has one: a quest can address a node that has one |

**Who reads it.** EDGEbuilder hides each removal live through REDnode's world node registry (`world.setVisible`) while the scene is open or on, and the bake (D1b) writes them as ArchiveXL node deletions through REDbridge's `sector.build`. REDnode's own reader (`world.load`) takes formats 1 and 2, so EDGEbuilder hands it a format 2 copy without `worldEdits` for the scenes that are on; other packages loading a format 3 scene through REDnode need its reader to take format 3 (a request for REDnode).
