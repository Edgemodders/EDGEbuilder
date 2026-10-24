---
title: Scene format
---

# The scene file

A scene is the contract between EDGEbuilder's two halves and the input to REDbridge's `sector.build`. Format 1, pinned 2026-10-13. It lives at `source/scenes/<name>.scene.json` in a REDcode project, or in EDGEbuilder's data folder when there is no project.

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
| `objects[].transform` | `position` [x, y, z] in metres, world space; `rotation` a quaternion [x, y, z, w]; `scale` [x, y, z] |
| `objects[].streaming` | `primary`: the distance in metres the node streams in at; `secondary`: its maximum streaming distance. Both optional: the bake derives them from the object's size |
| `objects[].ref` | The node reference, unique in the scene. Generated as `edgebuilder/<scene>/<id>` when missing |
| `objects[].bounds` | The resource's local bounding box, from the asset index, so the bake need not read the game. Read from the game when missing |
| `objects[].group` | The group the object belongs to |
| `objects[].props` | The kind's own fields. Lights: `type` (`point`, `spot`, `area`), `color` [r, g, b] 0 to 255, `intensity`, `radius`, `innerAngle`, `outerAngle`, `ev`, `temperature` |

Positions are the game's world coordinates in metres: X east, Y north, Z up. A rotation of [0, 0, 0, 1] is no rotation.

## What the bake makes of it

REDbridge's `sector.build` turns the objects into one `worldStreamingSector` with a node per object (`worldMeshNode`, `worldEntityNode`, `worldStaticLightNode`), one `worldStreamingBlock` whose descriptor holds a streaming box around every node, and an ArchiveXL file that patches the block into the world. The files land in the REDcode project under `source/archive/edgebuilder/<name>/` and `source/resources/archive/pc/mod/<name>.xl`. Every node's reference goes into its node data, so the game can find it by name.

## Format 2 draft: NPCs

Draft, 2026-10-23, for phase B3c. **Not pinned:** format 1 above stays what EDGEbuilder writes and REDbridge bakes until B3c is built and passes in game. Agreed with the owner the same day, with REDnode's H2c ([World API, H2c](https://edgemodders.github.io/REDnode/world.html#h2c-world-objects-plan)): REDnode reads scene files itself (`world.load`), so EDGEquest and other packages can load a scene without EDGEbuilder running, and the format stays EDGEbuilder's to pin.

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

What H2c's spike finds may change these fields before they are pinned: whether a spawned character holds its place, whether a save keeps it, and which of `record` and `resource` spawns reliably.

**Baking NPCs is open.** The game places people through community and population spawner nodes, not `worldEntityNode`, and nothing here has been tried. Until a bake is planned, an `npc` object loads in the running game (EDGEbuilder's previews, REDnode's `world.load`) and the bake skips it with a warning.
