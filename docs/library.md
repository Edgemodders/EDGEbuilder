---
title: Library and world view
---

# The Library and EDGEbuilder for VS Code

Draft 3, 2026-11-04. Status: **agreed with the owner on 2026-10-29**, written from their idea and answers (draft 2: the root's default and Relocate, who keeps the rules; draft 3: the [shared rules](#shared-rules) for every EDGE tool, with assets, the came-from note, Use the game path and Desks, from the owner's directions of 2026-10-31 and 2026-11-02 through EDGEfab and EDGEwave, [issue #4](https://github.com/Edgemodders/EDGEbuilder/issues/4)). B3 builds the Library's first part. It changes where scenes and bakes live (B3, B4) and turns B7, the project builder, into an EDGEbuilder extension for VS Code with a map of the whole world.

## The idea

A modder building a large part of the city works on it for months and releases it in pieces: an extension of a district in phases, each phase its own mod. The vision should live in one place, not be spread over a dozen REDcode projects. That place is the **Library**: the long-term, organised warehouse of design-time and build-time work. Projects take from it what one mod needs.

The Library is a way of working, not a rule. A modder who keeps everything in one REDcode project and never opens the Library can do that, as today.

| | What it is | Lasts |
|---|---|---|
| **Library** | The warehouse: scenes, bakes, imported and made assets, organised in the modder's own folders | Long term; one root folder, so backup and restore are one copy |
| **A tool's Desk** | One tool's scratch area for the work in hand (EDGEmat, EDGEfab and EDGEwave have one) | Across restarts, but not organised and not kept for good |
| **REDcode project** | One mod: what gets packed, deployed and released, in the folders the game and REDcode expect (`source/scenes`, `source/archive`, ...) | As long as the mod |
| **EDGEdeck's mod library** | Installed mods, deployed into the game | As long as the mod is installed |

The name stays **Library**, as a real library holds books and tapes on every subject in one building. EDGEdeck's is "the mod library" in these docs. If the two get confused in use, the fallback name is **Stash**.

## The Library

**One root folder for the EDGE platform**, shared by every tool that uses it. The first tool to need it asks where to put it, offering `Documents\EDGE Library`. Its place is kept in one small file every tool reads, `%APPDATA%\EDGE\library.json` (`{ "root": ... }`), since the in-game Node mod cannot read VS Code's settings. **Relocate** moves the whole Library, to a bigger drive for example: it copies the root, checks the copy, updates `library.json` so every tool follows, and only then removes the old folder. A project's "came from" notes are relative to the root, so they survive the move. Any tool whose work belongs there offers a Library view: EDGEbuilder for scenes and bakes, EDGEfab for made and imported assets, EDGEmat for materials and appearances, perhaps others later. Each tool owns its own kinds of item; the root and the [shared rules](#shared-rules) below are shared.

## Shared rules

These rules are the same for every EDGE tool that uses the Library. Since 2026-11-04 the platform's wiki explains them for modders, [The EDGE Library](https://edgemodders.ai/wiki/library.html), as draft 2 planned once a second tool (EDGEfab) used the Library. This section stays the technical reference the wiki links to (`library.html#shared-rules`): the exact shapes of items and notes. A change here goes to the wiki page too.

| Rule | Why |
|---|---|
| **One root**, its place in `%APPDATA%\EDGE\library.json` (`{ "root": ... }`). The first tool to need it offers `Documents\EDGE Library`. A tool keeps other fields it finds in the file | Every tool, in game or out, finds the same Library |
| **The folders are the modder's.** Tools never make folders on their own (no `scenes/`, `meshes/` or game-path folders unasked); they offer the folder the modder last used | It is their warehouse. `Production/Meshes` and `Development/Meshes` are as good as any |
| **Use the game path** is the modder's choice, offered beside the folder picker of every Add to Library whose item has a game path. The item goes in its main file's game-path folders under the folder picked, each made if missing: `base\gameplay\...\comfy_rocker.mesh` becomes `<folder>\base\gameplay\...\comfy_rocker.mesh.asset\`. Each tool offers the last choice again. Not offered for items without a game path (scenes, bakes, plain model files, sounds made from scratch). When an item's game path changes (a game asset made new), the tool offers to move it to match | So the Library can be browsed in Explorer the way the game's files are, for those who want that. The folders are copies of the game's names under the root, not the game's folders |
| **Items describe themselves**, by their name: the ending says what an item is, and nothing comes from the folder it sits in. Items are in the [table below](#items) | Folders are free, so the kind cannot come from the folder |
| **Nothing in the Library is inside a game or package folder** | Deploys and REDnode's hot reload must never touch it. The in-game Node mod reads and writes it like any folder (REDnode does not limit a package's file access) |
| **An item copied into a project is noted** in the project's one [came-from note](#the-came-from-note), `source/library.json`, which every tool writes the same way | So a project can be refreshed from the Library, whichever tool added what |
| **A Desk is one tool's own**: a scratch workspace that lasts across restarts, where work in progress waits to be added to a project (Add to Project) or the Library (Add to Library). A norm for the EDGE tools that make things (the owner, 2026-11-02). Only the Library is shared; no tool reads another's Desk | The Library stays the organised store. A Desk may keep its items in the Library's shapes, as EDGEfab's does, so Add to Library is a copy |
| **The Library is never forced.** A modder without a root works in projects alone, and every tool still works | It is a way of working, not a requirement |

### Items

| Item | Tool | What it is |
|---|---|---|
| Scene `<name>.scene.json` | EDGEbuilder | The [scene format](scene.md). A scene can be shown in the game or not, and included in any number of bakes |
| Bake `<name>.bake/` | EDGEbuilder (B4) | `bake.json` plus the baked `.streamingsector`, `.streamingblock` and `.xl`. `bake.json` has an `id` (made once, never changed), a `version` raised by each rebake, the scenes it was baked from (name and content hash), the game and REDbridge versions, the date and the streaming boxes it covers. Several bakes of one place live side by side |
| Asset `<name>.<kind>.asset/` | EDGEfab, REDcode, EDGEmat, EDGEwave | A folder laid out like a small project: `asset.json`, `source/archive` (the game files at their game paths) and `source/raw` (what they were made from). The kind is in the name, so a search for `mesh` finds every mesh asset: a game file's type (`mesh`, `ent`, `app`, `mi`, `mlsetup`, `xbm`) or a tool's own (EDGEfab's `prop`, later `garment` and `character`; EDGEwave's `sound`). Lowercase, one word. When the kind changes, the tool renames the folder; the folder name wins over `asset.json` |
| Plain files | Any | A `.glb`, `.fbx`, `.blend`, images, `.wav`, `.ogg`, `.mp3`, `.flac` in any folder are items as they are, known by their extension |

**`asset.json`** is the asset's own and its tools' to shape; [EDGEfab's Library assets page](https://edgemodders.github.io/EDGEfab/library.html#the-asset-item-proposed) has the rest. Every tool relies on these:

| Field | Holds |
|---|---|
| `format` | 1 |
| `id` | A random id made once and never changed, so projects find the item after it is renamed or moved |
| `name` | The modder's name for it |
| `kind` | The same as in the folder name |
| `main` | The game path of the file a tool opens or places (a prop's `.ent`, a mesh's `.mesh`). For a sound, `render`: the WAV a project takes |
| `version` | A whole number, raised by each change |

### The came-from note

One file per project, `source/library.json`, written by every tool that copies a Library item into the project: EDGEbuilder's Include in project, EDGEfab's, EDGEmat's and EDGEwave's Add to Project. A tool rewrites only its own items' entries and keeps the rest.

```json
{
  "format": 1,
  "items": [
    {
      "id": "6f1c2a9e0b3d4c51",
      "kind": "prop",
      "path": "Production/Meshes/rusty_oil_drum.prop.asset",
      "version": 3,
      "added": "2026-11-04T10:12:00Z",
      "by": "edgefab",
      "files": ["source/archive/edgemodders/rusty_oil_drum/rusty_oil_drum.ent"]
    },
    {
      "kind": "scene",
      "path": "Alleys/Kabuki/market_square.scene.json",
      "hash": "sha256:3b7e...",
      "added": "2026-11-04T10:20:00Z",
      "by": "edgebuilder",
      "files": ["source/scenes/market_square.scene.json"]
    }
  ]
}
```

| Field | Holds |
|---|---|
| `id` | The item's id, for items that have one (assets, bakes). Refresh finds the item by it first, so a rename or move in the Library does not lose it |
| `kind` | The item's kind: an asset's, `bake` or `scene` |
| `path` | Where the item was, relative to the Library root with `/` between folders: a hint for speed, and the only key for items without an id. Relative, so a Relocate keeps it working |
| `version` | The item's version when it was copied, for items that have one |
| `hash` | For items without a version (scenes): the copied file's content hash, `sha256:` and hex |
| `added` | When it was copied |
| `by` | The tool that copied it, by its id |
| `files` | The files copied, relative to the project folder, with `/`. Refresh replaces these; a tool removing an item from the project removes these |

**Refresh from Library** reads the note, finds each item (by `id`, else `path`), and lists those whose `version` or `hash` changed since. A scene renamed or moved in the Library is lost to Refresh, since scenes have no id; Refresh says so and offers to forget it.

## Flows

| Flow | What happens |
|---|---|
| **Save** (in game or in VS Code) | The scene goes to a Library folder the modder picks. Without a Library root set, EDGEbuilder's data folder is used, as now |
| **Bake** | Picks one or more scenes and bakes them into a new `.bake` in the Library. Object references are already unique across scenes (`edgebuilder/<scene>/<id>`). REDbridge's `sector.build` already takes any target folder |
| **Include in project** | Copies a bake's files into the REDcode project (`source/archive`, `source/resources`, and each scene's record in `source/raw`), noted in the project's [came-from note](#the-came-from-note). The scenes stay in the Library, the one place they are edited (the owner, 2026-11-08: bake files only) |
| **Refresh from Library** | In a project, shows which included items changed in the Library since, and copies the new versions over on request |
| **Project only** | A modder without the Library saves scenes in `source/scenes` and bakes straight into the project, as B4 planned |
| **Rebake after a patch** | A bake records its game version. After a game update, the Library lists bakes made for an older version and rebakes them from their scenes; scenes are the source, bakes are products |

**What a bake is, in game terms.** A bake does not rewrite the game's sector file. It adds a new sector of our own at that place, patched into the world through ArchiveXL, and (from B4b) ArchiveXL edits that hide or change the game's own objects there. Rewriting the game's sector would clash with every other mod in the area and break with each patch. "Bake this sector" is fine wording in the interface; the result is "our sector and edits at this place".

## Flags

| Flag | When |
|---|---|
| **Bakes may collide** | Two bakes in one project, or deployed together, whose streaming boxes overlap and that share objects (same scene, or objects at the same spot). Shown in the Library, in a project's Include list, and in game when a deployed bake overlaps scenes that are on |
| **Baked and on** | A scene that is in a deployed bake also has its previews on in game: everything shows twice. The in-game page leaves such previews off unless asked |
| **Stale bake** | Made for an older game version, or its scenes changed since |
| **Not in the game yet** | A Library asset (an imported mesh, a new appearance) that is in no deployed archive. It can be placed in game only after it is packed and swapped in (REDcode's "Pack and Play", REDnode's `archives.reload`) |

## EDGEbuilder for VS Code

The out-of-game half. The design's B7 planned it inside REDcode; it becomes an EDGEbuilder extension that uses REDcode (projects, the three.js mesh viewer, the bridge) rather than adding to it.

### The world map

A bird's-eye editor view of the whole world, wireframe: every sector's streaming box, drawn from the game's sector lists.

| What the game has | Used for |
|---|---|
| `base\worlds\03_night_city\_compiled\default\blocks\all.streamingblock` (9.7 MB) | Every Night City sector with its streaming box |
| `...\default\ep1\blocks\all.streamingblock` | Phantom Liberty's sectors, some replacing base ones |
| Exterior sectors named `exterior_X_Y_Z_L` (about 15,000) | X, Y, Z a grid cell, L a level: coarser levels hold the distant detail of the finer ones, so levels overlap. Interior and quest sectors sit on top |

- **A level filter**, not one strict tree: show the finest exterior level, a coarser one, interiors, quest sectors, or Phantom Liberty's, alone or together.
- **Hover** highlights a box and fills a side panel: the sector's name, kind and level, its grid cell and size, the archive it comes from (base or Phantom Liberty), the installed mods that change it, and the Library scenes and bakes that overlap it. Node counts are read on demand.
- **Click** drills in: to a finer level's boxes inside it, or, at the bottom, opens the sector view.
- Our own scenes and bakes are drawn on the map in another colour.
- Perhaps later: the game's own map as an underlay.

### The sector view

The sector drawn in 3D with a flying camera, from its nodes: meshes and instanced meshes at their transforms, entities as their meshes or as boxes, lights and other kinds as markers. Each unique mesh is exported once through REDbridge and cached, so the first visit to a sector is slow; a progress bar says how many meshes are left and about how long. Flat colours first, textures and EDGEmat's materials later; terrain and full entities later still.

In it the modder can:

- turn Library scenes on and off over the sector, add objects to a scene and move them (the same gizmo and keys as in game);
- place Library assets: imported from Blender, made by EDGEfab or an AI service, with new appearances from EDGEmat;
- pick the game's own nodes, which is easier here than in game: the sector file gives each node directly, where in game 2.5 keeps only a hash of a node's path. B3b's "add a copy to the scene" and B4b's edits get a second home here;
- bake, open the scene in the running game (REDnode), and include a bake in a project.

## What it needs from the other repos

| Repo | Need | When |
|---|---|---|
| REDbridge, [REDbridge #11](https://github.com/Edgemodders/REDbridge/issues/11) | `sector.find`: the sectors from the streaming blocks, with box, kind, level and archive, Phantom Liberty's replacements resolved | The probe |
| REDbridge, [REDbridge #11](https://github.com/Edgemodders/REDbridge/issues/11) | `sector.nodes`: a sector's nodes with kind, resource, appearance and world transform, instanced meshes unpacked into one transform each | The probe |
| REDcode | Its mesh viewer usable from another extension for many meshes at once, or its three.js scene shared | The sector view |
| EDGEfab, EDGEmat, EDGEwave, REDcode | Their items in the Library under the [shared rules](#shared-rules), and a Library view where their work needs one | EDGEfab in its F1 (asset items, [issue #4](https://github.com/Edgemodders/EDGEbuilder/issues/4)); REDcode's Add to Library, [REDcode #19](https://github.com/Edgemodders/REDcode/issues/19); the others when each gets there |
| REDnode | Nothing new: Node mods have file access, `archives.reload` swaps archives in | |

Opened 2026-10-29: [REDbridge #11](https://github.com/Edgemodders/REDbridge/issues/11) for `sector.find` and `sector.nodes`.

## Roadmap

| Phase | Delivers | Ends with |
|---|---|---|
| **B3** (adds) | The Library root setting; scenes saved into and opened from Library folders; the in-game **Library** tab with folders; scenes on and off | A scene saved in a Library sub-folder reopens after a restart |
| **B4** (adds) | Bakes into the Library from one or more scenes, `bake.json`; Include in project; the collide and baked-and-on flags | Two scenes baked into one Library bake, included in a project, stand in Night City with EDGEbuilder off |
| **E0 Probe** | `sector.find` and `sector.nodes` in REDbridge; one sector drawn with REDcode's viewer from a script | How long a busy downtown sector takes the first time and after, and what it looks like |
| **E1 World map** | The extension; boxes, the level filter, hover and side panel, drill-down | Any sector found from the whole map in a few clicks |
| **E2 Sector view** | Nodes drawn, the cache and progress bar, the flying camera | A downtown sector flown through |
| **E3 Scenes outside the game** | Library scenes on the map and in the sector view; add, move, delete; Open in game | A scene edited with the game closed bakes the same as one edited in game (B7's test) |
| **E4 Library view** | Folders, bakes, Include in project and Refresh from Library, stale bakes and rebake, from VS Code | A rebake after a game patch from the Library alone |

E0 can run early, beside B2c or B3, since it touches only REDbridge and a script. E1 and later follow B4, when scenes save, load and bake. B4b's edits from the sector view follow B4b.

## Open

- **The rules' home** (agreed): this page keeps the [shared rules](#shared-rules) until a second tool uses the Library; then they move to the platform's wiki. Done on 2026-11-04: the wiki's [The EDGE Library](https://edgemodders.ai/wiki/library.html) explains them for modders, and this page keeps the exact shapes for tool makers.
- **Assets in the rules** (draft 3, 2026-11-04, [issue #4](https://github.com/Edgemodders/EDGEbuilder/issues/4)): EDGEfab's asset item and its `source/library.json` adopted for every tool, EDGEwave's `sound` kind, Use the game path, Desks. Browse and the sector view listing Library assets come later, with the "not in the game yet" flag.
- **The default folder** (agreed 2026-11-03): `Documents\EDGE Library`, as offered above. B3-2 builds the root setting, saving into and opening from Library folders, the Library tab and scenes on; see the design's [Scenes and the Library](design.md#scenes-and-the-library-b3-2). Relocate comes later.
- EDGEscene, an empty repo of 2026-10-27, was deleted by the owner: residue of early ideas, not a home for this.
