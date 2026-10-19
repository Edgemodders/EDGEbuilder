---
title: Design
---

# EDGEbuilder design

Draft 2, 2026-10-18 (draft 1 2026-10-13). Status: **B0 to B2b passed in game**; the roadmap below adds B2c and the release stages.

EDGEbuilder is a world builder for Cyberpunk 2077: pick an asset from the game's own files, drop it into the live game, move it into place, arrange a scene, and bake the scene into a streaming sector that loads like any other mod. It runs as a [REDnode](https://github.com/Edgemodders/REDnode) package, so the editor is a web page over the game and the logic is Node. [REDbridge](https://github.com/Edgemodders/REDbridge) supplies the asset list and does the baking, [REDcode](https://github.com/Edgemodders/REDcode) holds the project the bake lands in, and [EDGEdeck](https://github.com/Edgemodders/EDGEdeck) installs both EDGEbuilder and what it bakes.

## Where the idea comes from

World Builder by keanuWheeze, a Cyber Engine Tweaks mod, showed that a world editor can live inside the running game, and that its real product is not the preview but the exported streaming sector. EDGEbuilder is a from-scratch design of that idea for the EDGE platform. It uses none of World Builder's code, files, data lists or file formats, which its license reserves. What we took from studying it is understanding (the full findings are on the [study](study.md) page):

| Lesson | What it means for EDGEbuilder |
|---|---|
| The preview is not the product | Objects placed in the live game are previews. The bake is what players install. Preview fidelity matters less than bake correctness |
| The game's own API does the work | Codeware's static entity system spawns preview entities; native components give them a mesh, a light, a decal. Streaming sectors are plain game files. No engine patching |
| The editing model is table stakes | A scene tree with groups, select and multi-select, a gizmo, drop to floor, undo and redo, save and load. Nobody wants less |
| Streaming needs care | Every baked node needs streaming ranges and a stable reference. Get that right or the objects pop or vanish |
| Lists of game paths are a dependency, not an asset | World Builder ships 265,000 lines of extracted paths. REDbridge can read the same from the player's own game files on demand |

## Behaviours

EDGEbuilder is six behaviours. Each is described by what the player does and what happens underneath.

| Behaviour | The player | Underneath | Done by |
|---|---|---|---|
| **Browse** | Searches the game's assets by kind: meshes, entities, lights, decals, effects, sounds | REDbridge lists the game's archives by extension and path, once per game version, cached in the package's data folder. No shipped lists | REDbridge, Node mod |
| **Drop** | Picks an asset and it appears in front of the camera, or on the surface under the cursor | A preview entity spawns through the game API with a component for the kind. Entities from the game's templates spawn as they are | REDnode `api`, Codeware |
| **Position** | Moves, rotates and scales with a gizmo or the keys G, R and S; types numbers; drops to the floor; snaps | The overlay draws the gizmo over the game from projected positions. Each change sets the preview's world transform. Drop to floor is a physics raycast | Overlay app, REDnode `api` |
| **Arrange** | Groups, duplicates, hides, renames; selects many; undoes and redoes | The Node mod owns the scene tree and the history. Saved as a scene file | Node mod |
| **Bake** | Names the scene and presses Bake; after a restart the objects are part of the world | REDbridge writes a streaming sector, a streaming block and an ArchiveXL file into a REDcode project. EDGEdeck installs it | REDbridge, REDcode, EDGEdeck |
| **Return** | Loads a scene, keeps working, bakes again | Scene files are the truth; the preview is rebuilt from them | Node mod |

Everything else, favourites, prefabs, scattering, splines, areas, AI, is a later behaviour built on these.

## Two halves

A world builder has a runtime half and a project-time half. World Builder is only the first; EDGEbuilder is both, around one scene file.

| | Runtime builder | Project builder |
|---|---|---|
| Where | In the game, as a REDnode package | In REDcode, with the game closed |
| The viewport | The game itself: what you see is what you get | None in v1; a tree, a property grid and a map of the sector. A 3D view from meshes REDbridge exports is a later phase |
| Good for | Placing and judging: does the crate sit right in that alley at dusk | Tidying and shipping: renaming, ranges, validation, the bake, versioning the scene with the project, editing without a 2-minute game start |
| Owns | The preview entities and the editing session | The scene file in the project and the baked files |
| Talks to | REDbridge for assets and the bake | REDbridge for the bake, REDnode for "open this scene in the game" |

The scene file is the contract. Saved in a REDcode project it is a project file like a mesh or a script; the runtime builder opens it from there and saves back to it, and the project builder reads and bakes the same file. Without a project the runtime builder keeps scenes in its own data folder, and Bake asks for a project to put them in. "Open in game" from REDcode hands the scene to the running EDGEbuilder through REDnode, the same loop REDcode uses for mods.

The runtime half is v1. The project half starts with what costs little and pays at once: the scene file in the project, validation, Bake from the command palette, and the tree. Its 3D view waits until REDbridge exports meshes.

## The pieces

```
 ┌──────────────────────────── the game ────────────────────────────┐
 │  REDnode plugin ── spawns previews, sets transforms, projects     │
 │        ▲                        points, raycasts, draws windows   │
 └────────┼─────────────────────────────────────────────────────────┘
          │ pipe
 ┌────────┴──────────── REDnode host (outside the game) ────────────┐
 │  EDGEbuilder package                                              │
 │   overlay app ──── editor window: assets, scene, properties, bake │
 │     │ channel          and a transparent canvas for the gizmo     │
 │   Node mod ─────── scene tree, history, scene files, asset index  │
 │     │ JSON-RPC         and the bake                               │
 └─────┼─────────────────────────────────────────────────────────────┘
       ▼
   REDbridge ──── lists assets, reads mesh bounds, writes the sector
       ▼
   REDcode project ──── source/archive/<scene>.streamingsector, .xl
       ▼
   EDGEdeck ──── packs and deploys it; next start, it is the world
```

| Piece | Role in EDGEbuilder | Exists today |
|---|---|---|
| Overlay app (`entry`) | The editor: a panel docked to the right edge with Assets, Scene, Properties and Bake, and a full-screen transparent canvas behind it for the gizmo and selection outlines. Built with the REDnode UI kit | The host, windows, the kit, input, `channel`: yes |
| Node mod (`main`) | Scene state, undo history, scene files in `pkg.dataDir`, the asset index, the REDbridge client, the bake | Node mods, `pkg.dataDir`: yes |
| REDnode `api` | Spawn and despawn previews, set transforms, project world points to the screen, raycast, read the camera | Calls and property reads: yes. Object construction, property writes, game callbacks, resource references: **no**, see the asks |
| Codeware | The static entity system that spawns a preview entity at a transform and reports when it is assembled, so components can be attached | A dependency the player installs, as for most mods |
| REDbridge | `archive.search` for the asset list, CR2W reads for mesh bounds, and a new `sector.build` for the bake | Search and CR2W: yes. `sector.build`: **no** |
| REDcode | The project the bake lands in; packs it | Projects and REDbridge integration: yes. Pack: in progress |
| EDGEdeck | Installs EDGEbuilder as a `rednode` package, and installs the baked mod from the REDcode project | Add from REDcode project: yes. The `rednode` kind: **no**, small |
| ArchiveXL | Loads the baked streaming block into the world | A dependency of the baked mod, as for every custom sector |

EDGEbuilder is a **combined** package: a manifest with both `entry` and `main`. The page is the face, the mod is the brain, and they talk over `channel`. The page never touches files or the bridge; the mod never draws.

## The preview in the game

Every placed object is a preview entity. For the game's own entity templates the preview is the template itself, spawned at a transform with an appearance. For every other kind the preview is EDGEbuilder's own empty entity with one component attached when the entity assembles:

| Kind | Bakes to | Preview component | v1 |
|---|---|---|---|
| Mesh | `worldMeshNode` | `entMeshComponent` with the mesh, an appearance and a scale | yes |
| Entity | `worldEntityNode` | The `.ent` itself, with an appearance | yes |
| Light | `worldStaticLightNode` | `gameLightComponent`: type, colour, intensity, radius, angles | yes |
| Decal | `worldStaticDecalNode` | `entDecalComponent` from a material instance | later |
| Particles | `worldStaticParticleNode` | `entParticlesComponent` | later |
| Effect | `worldEffectNode` | `entEffectSpawnerComponent` | later |
| Sound | `worldStaticSoundEmitterNode` | `gameaudioSoundComponent` | later |
| Collider | `worldCollisionNode` | `entColliderComponent` with a box, capsule or sphere; drawn by the overlay too | later |
| Reflection probe, fog, occluder | their world nodes | their components | later |
| Areas, splines, AI spots, communities, devices | their world nodes | helpers | not planned for v1 |

The empty entity, and nothing else, ships in a tiny archive of EDGEbuilder's own, authored as JSON in this repo and built by REDbridge. No gizmo meshes: the gizmo is drawn by the overlay.

Rules learned from the game, to be verified in B1:

- Components can be attached only while the entity assembles. The spawn is therefore event-driven: spawn, wait for assemble, attach, wait for attached, then the object is live. Moves requested earlier are queued.
- A moved preview gets a new world transform on the entity. The component follows.
- Selection shows as the game's own render highlight on the entity.
- Mesh bounds come from REDbridge reading the mesh file, not from loading the resource in the game. They are cached with the asset index. Entity bounds are the union of their mesh components' bounds, read the same way.

## The editor

| Part | What it shows |
|---|---|
| **Assets** | A kind picker and a search box over the asset index. Hover shows the path and size; a click or a drag into the viewport drops it. Recent and favourite assets at the top |
| **Scene** | The tree: groups and objects, with visibility and selection. Drag to reorder or regroup |
| **Properties** | The selected object or group: name, position, rotation, scale, appearance, the kind's own fields, streaming ranges with an auto button, the node reference |
| **Bake** | Scene name, the target REDcode project, the sector's streaming box computed from the contents, validation results, the Bake button |

The panel docks to the right edge. The rest of the screen is the viewport: in REDnode's interactive mode the page gets the mouse and keys, and the transparent canvas behind the panel draws the gizmo, the selection box and the outlines of colliders. In passive mode the game has the controls and the panel stays visible.

| Key or mouse | Does |
|---|---|
| Click | Select. Ctrl+click adds. Click empty space clears |
| Ctrl+drag | Box select |
| G, R, S | Grab, rotate, scale the selection; X, Y, Z lock an axis; digits type a value; Enter confirms; Esc cancels |
| Gizmo handle drag | Move or rotate along that axis |
| Ctrl+E | Drop to the surface below |
| Ctrl+D, Delete | Duplicate, remove |
| Ctrl+G | Group the selection |
| Ctrl+Z, Ctrl+Y | Undo, redo |
| Ctrl+S | Save the scene |
| Shift+A | Drop the last asset under the cursor |

**Viewport (B2a).** The page covers the game view (1920 x 1080 reference pixels) with the panel at the right. An **Edit** switch in the panel's title bar tints the rest by 4%, which puts it above REDnode's click-through threshold (alpha 8 of 255), so the viewport takes the mouse; with Edit off it is see-through and the game has the mouse. Each frame the page reads one value from the game, the first-person camera's local-to-world matrix, and projects everything itself; how the game's screen maps camera space is learned from three `CameraSystem.ProjectPoint` calls whenever the field of view changes, so the gizmo lines up whatever units `ProjectPoint` answers in. Picking is a ray from the cursor against each object's box from the asset index. Moves go to the preview with `world.move`, one waiting at a time; the mod saves the result. A mesh's scale is fixed when its component is built, so a new scale rebuilds the preview.

**Builder mode (B2b).** With Edit on, the screen should show only the world and the editor. EDGEbuilder hides the game's own HUD (minimap, quest tracker, crosshair) through the game API, the way photo mode and scenes do; raising the scene tier is the known route, and it also changes what V can do, so it is tested with the camera. Other packages' overlay windows and HUD widgets need the host: a solo mode asked of REDnode ([REDnode #7](https://github.com/Edgemodders/REDnode/issues/7)). Everything comes back when Edit is switched off.

**Camera (B2b).** While Edit is on, EDGEbuilder looks through a camera of its own: an empty entity with a `gameCameraComponent` built by `api.$new`, switched on with `Activate()` at V's view, so nothing jumps. V stays where V is: unlike moving the player as an orbit camera (the approach World Builder verified), nothing happens to V, and V's own camera comes back with `Activate()` on V's first-person camera component. The page flies it (right mouse to look, W A S D Q E to move, the middle mouse to orbit and pan, the wheel to dolly, F to frame) and sends one move a frame; the viewport reads the camera's own matrix, so the gizmo stays true. Drops land where the camera looks. What builder mode changed is written down first, so a stopped EDGEbuilder puts V's camera and scene tier back when it starts again. Unknown until the B2b test: whether the world stays loaded far from V.

**Picking.** A ray from the cursor, built from the camera's transform and field of view, tested against each object's oriented bounds in the Node mod. The nearest hit wins; an object whose bounds sit inside another's is preferred. Surface hits use the game's physics raycast.

## Files

| File | Where | What |
|---|---|---|
| `<name>.scene.json` | The REDcode project, under `source/scenes/`; or `scenes/` in `pkg.dataDir` when there is no project | A scene: format version, game version, name, groups and objects. The contract between the two halves |
| `index/<game version>.json` | `pkg.dataDir` | The asset index: path, kind, size and, for meshes, bounds and appearances |
| `settings.json` | `pkg.dataDir` | Editor settings |
| `<scene>.streamingsector`, `<scene>.streamingblock`, `<scene>.xl` | The REDcode project, under `source/archive/` and `source/resources/` | The bake |

A scene object, in EDGEbuilder's own shape:

```json
{
  "id": "obj_01J9",
  "kind": "mesh",
  "resource": "base/environment/decoration/.../crate_a.mesh",
  "appearance": "default",
  "transform": { "position": [x, y, z], "rotation": [x, y, z, w], "scale": [1, 1, 1] },
  "streaming": { "primary": 60, "secondary": 48 },
  "ref": "edgebuilder/my_scene/crate_a_01",
  "props": { "shadows": "default" },
  "group": "grp_01J8"
}
```

Rotation is a quaternion in the file and Euler angles in the panel. Streaming ranges default to a function of the object's size and can be edited. The reference is generated and unique within the scene.

## Baking

`sector.build` is a REDbridge method (0.6.0): it takes a scene file and a target folder and writes, with WolvenKit's own writers, one `worldStreamingSector` with a node per object and a node-data entry carrying position, orientation, scale, bounds and streaming distances; one `worldStreamingBlock` whose descriptor holds the sector's streaming box; and an ArchiveXL `.xl` that registers the block. Into a REDcode project they go under `source/archive` as game files, so the project packs them without conversion.

Validation before the bake: every object has a resource that exists in the game, a unique reference, and finite streaming ranges; the scene is not empty; the target project exists. The bake is repeatable: the same scene bakes to the same files.

After the bake, EDGEdeck's Add from REDcode project puts the packed mod in the library, deploy links it into the game, and the next game start shows the objects for real, with the preview entities gone.

## What EDGEbuilder needs from the other repos

For REDnode, the design's assumptions that are not in the SDK today, in the order B1 hits them:

| Need | Why | Shape that would work |
|---|---|---|
| Construct native objects and set properties ([REDnode #1](https://github.com/Edgemodders/REDnode/issues/1)) | A mesh component is `entMeshComponent` with `mesh`, `meshAppearance` and `visualScale` set before it is attached | `api.$new("entMeshComponent", { mesh: "...", visualScale: {...} })` and `ref.$set(prop, value)` |
| Game callbacks as events ([REDnode #2](https://github.com/Edgemodders/REDnode/issues/2)) | Components attach during Codeware's `Entity/Initialize` callback; the mod must hear it for the entity it spawned | `game.on("Entity/Initialize", handler)` with the entity in the event, or a plugin-side spawn that attaches a given component and resolves when attached |
| Resource references as arguments ([REDnode #3](https://github.com/Edgemodders/REDnode/issues/3)) | The mesh component's `mesh` is a resource reference, which the bridge refuses today | Accept a path string where a `ResRef`, `raRef` or `rRef` is expected |
| Known per-frame budget | Dragging sets one transform per frame; the gizmo projects a few points per frame | A measured number for round trips per frame, and a batched `api.$batch([...])` if one call per frame is tight |
| A REDbridge the host can hand out ([REDnode #4](https://github.com/Edgemodders/REDnode/issues/4)) | The asset index and the bake need the bridge | Shipped in REDnode 0.17.0 as `kernel.bridge()` behind the `bridge` permission; EDGEbuilder uses it from 0.2.0, and starts its own REDbridge only with an older REDnode or a path in its settings |
| Dependencies in the manifest ([REDnode #5](https://github.com/Edgemodders/REDnode/issues/5)) | EDGEbuilder needs Codeware at a minimum version | Shipped in REDnode 0.17.0; EDGEbuilder 0.2.0 declares `"requires": { "codeware": ">=1.14" }` |

For REDbridge: `sector.build` as above ([REDbridge #1](https://github.com/Edgemodders/REDbridge/issues/1), done in 0.6.0), a read of a mesh file's bounds and appearances ([REDbridge #2](https://github.com/Edgemodders/REDbridge/issues/2), done in 0.6.0 as `mesh.info`), and building EDGEbuilder's support archive from JSON, which is `project.pack` on a one-file project. The scene file is pinned on the [scene format](scene.md) page.

For REDcode, later: the scene file as a project file, Bake from the command palette, validation ([REDcode #2](https://github.com/Edgemodders/REDcode/issues/2)).

For EDGEdeck: the `rednode` kind, so a zip or folder with `rednode-app.json` deploys to `red4ext/plugins/REDnode/apps/<id>/`. Done in EDGEdeck 0.20.0.

## Risks

| Risk | Plan |
|---|---|
| Round trips make dragging feel late | One transform call per frame is one round trip; measure in B2. Batch if needed. The gizmo itself is drawn locally, so it never lags |
| Attaching components at the wrong moment crashes the game | B1 proves the spawn sequence on one mesh before anything else is built |
| Driving the player as the camera has side effects | Restore everything on exit; block damage while editing; test with saves, menus and fast travel |
| REDbridge beside the game is heavy | WolvenKit in process is a few hundred MB; the game wants 12 to 16 GB. Start the bridge on demand, stop it after the bake |
| The baked sector does not load, or streams wrongly | Bake one crate first and load it; compare the files with a sector WolvenKit made; derive ranges from bounds the way the game's own sectors do |
| Drifting into World Builder's shapes | Design from behaviours and the game API, as this page does; review for it at each phase |

## Roadmap

| Phase | Delivers | Ends with |
|---|---|---|
| **B0 Decide** | This page, the repo, a package that installs and opens an empty window | The user sees EDGEbuilder in the REDnode launcher |
| **B1 Browse and drop** | The asset index from REDbridge; drop a mesh and an entity in front of the camera; select, delete | A crate spawns and despawns in game |
| **B2a Position** | The viewport layer and Edit switch, the gizmo, picking in the world, G R S with axis locks and typed numbers, the Selected panel's numbers, drop to floor, mesh scale | A crate goes where it is put |
| **B2b Camera** | The editor camera (split from B2 on 2026-10-13: it moves V every frame, the riskiest part), and builder mode: the game's HUD and other overlay windows hidden while Edit is on | A crate can be placed from any angle, with nothing else on screen |
| **B2c Mod assets** | Browse also indexes mod archives (`archive\pc\mod`) and the open REDcode project's `source\archive`, marked with the mod's name; appearances from a mod's mesh; the bake names the mods a scene needs ([issue #1](https://github.com/Edgemodders/EDGEbuilder/issues/1), from EDGEfab and EDGEmat) | A custom object from EDGEfab is placed in game |
| **B3 Arrange and save** | Groups, multi-select, duplicate, undo and redo, scene files, return to a scene | A scene survives a restart |
| **B3b World objects** | Pick anything the game placed with the cursor, inspect it, add a copy to the scene; try an entity's appearances live. A sector index from REDbridge for static nodes. See [World objects](world-objects.md) | A vending machine is picked, inspected and copied into a scene with its appearance |
| **B4 Bake** | `sector.build` in REDbridge, the bake panel, the scene file in the REDcode project, Bake from REDcode's command palette, install through EDGEdeck | A baked crate stands in Night City with EDGEbuilder off, baked once from the game and once from REDcode |
| **B4b Edit the world** | Hide, replace, move or rescale the game's own objects, kept in the scene (format 2) and baked as ArchiveXL sector edits. See [World objects](world-objects.md) | A vending machine removed in the editor stays gone with EDGEbuilder off |
| **B5 Lights and more kinds** | Lights, decals, particles, effects, sounds, colliders | Each kind bakes and loads |
| **B6 Comfort** | Favourites, prefabs, scatter, snapping, templates | Daily use |
| **B7 Project builder** | The scene tree and properties in REDcode, "Open in game", then a 3D view from meshes REDbridge exports | A scene edited with the game closed bakes the same |

Each phase ends with an in-game test on the owner's PC, with the steps written down in a results page, as REDnode does.

## Release stages

Agreed with the owner on 2026-10-18 (B3b and B4b added the same day). Before the bake, nothing EDGEbuilder places outlasts the session, so there is nothing worth offering players; the first public release follows B4.

| Stage | After | Where | What it promises |
|---|---|---|---|
| **Test builds** (0.1 to 0.x) | Every phase up to B4 | The owner's PC; a GitHub release per tested version | Nothing: each build is for one in-game test |
| **Public preview** (0.x, marked PREVIEW) | B4 Bake | GitHub release and a Nexus page, installed with EDGEdeck | Place game and mod meshes and entities, pick and copy the game's own objects, arrange and save scenes, bake them into a sector that loads with EDGEbuilder off. Scene files may still change between previews; a preview that changes them says so and converts older ones |
| **1.0** | B4b and B5's lights | As the preview, without the PREVIEW mark | Every v1 kind (mesh, entity, light) places and bakes, and the game's own objects can be hidden or changed. The scene format is frozen: every later version opens 1.0 scenes |
| **1.x** | The rest of B5, then B6 and B7 | As 1.0 | Each phase is a minor version; nothing in a 1.x breaks a 1.0 scene or a baked mod |

**Gates for every public release** (the preview, 1.0 and each 1.x):

| Gate | How it is checked |
|---|---|
| The phase's in-game test passed | Its results page, on the owner's PC |
| A baked mod loads with EDGEbuilder uninstalled | Bake a scene, remove EDGEbuilder through EDGEdeck, load a save: the objects are there |
| EDGEdeck installs it from the release zip | Add the zip as a mod, deploy, open it from REDnode's launcher |
| Older scenes open | From 1.0 on: the previous release's scene files open and bake the same. In previews: they open, or are converted, as the release notes say |
| Requirements are declared | The manifest's `requires` (REDnode, Codeware, and any other minimum), and the same list on the Nexus page |
| The clean-room review | Nothing in the release drifts into World Builder's shapes (see the notes for Claude sessions); done at each phase, confirmed before a release |
| Docs | A player guide on the docs site, the changelog, and the Nexus description in the repo, as EDGEdeck keeps its own |

## Not in v1

Communities and AI spots, devices and persistent state, splines, areas, variants, imports from other editors, and anything that needs an engine hook rather than the game API.
