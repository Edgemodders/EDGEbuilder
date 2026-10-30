---
title: Library and world view
---

# The Library and EDGEbuilder for VS Code

Draft 2, 2026-10-29. Status: **agreed with the owner on 2026-10-29**, written from their idea and answers (draft 2: the root's default and Relocate, who keeps the rules). B3 builds the Library's first part. It changes where scenes and bakes live (B3, B4) and turns B7, the project builder, into an EDGEbuilder extension for VS Code with a map of the whole world.

## The idea

A modder building a large part of the city works on it for months and releases it in pieces: an extension of a district in phases, each phase its own mod. The vision should live in one place, not be spread over a dozen REDcode projects. That place is the **Library**: the long-term, organised warehouse of design-time and build-time work. Projects take from it what one mod needs.

The Library is a way of working, not a rule. A modder who keeps everything in one REDcode project and never opens the Library can do that, as today.

| | What it is | Lasts |
|---|---|---|
| **Library** | The warehouse: scenes, bakes, imported and made assets, organised in the modder's own folders | Long term; one root folder, so backup and restore are one copy |
| **EDGEmat's Desk** | A scratch area for the work in hand | Across reloads, but not organised and not kept for good |
| **REDcode project** | One mod: what gets packed, deployed and released, in the folders the game and REDcode expect (`source/scenes`, `source/archive`, ...) | As long as the mod |
| **EDGEdeck's mod library** | Installed mods, deployed into the game | As long as the mod is installed |

The name stays **Library**, as a real library holds books and tapes on every subject in one building. EDGEdeck's is "the mod library" in these docs. If the two get confused in use, the fallback name is **Stash**.

## The Library

**One root folder for the EDGE platform**, shared by every tool that uses it. The first tool to need it asks where to put it, offering `Documents\EDGE Library`. Its place is kept in one small file every tool reads, `%APPDATA%\EDGE\library.json` (`{ "root": ... }`), since the in-game Node mod cannot read VS Code's settings. **Relocate** moves the whole Library, to a bigger drive for example: it copies the root, checks the copy, updates `library.json` so every tool follows, and only then removes the old folder. A project's "came from" notes are relative to the root, so they survive the move. Any tool whose work belongs there offers a Library view: EDGEbuilder for scenes and bakes, EDGEfab for made and imported assets, EDGEmat for materials and appearances, perhaps others later. Each tool owns its own kinds of item; the root and the few rules below are shared.

| Rule | Why |
|---|---|
| The modder makes folders and sub-folders as they like | It is their warehouse. The Library never imposes `scenes/` or `meshes/` folders |
| Items describe themselves: a scene is a `*.scene.json`, a bake a `*.bake` folder with its `bake.json`, other tools' items by their own extension or manifest | Folders are free, so the kind cannot come from the folder |
| Nothing in the Library is inside a game or package folder | Deploys and REDnode's hot reload must never touch it. The in-game Node mod reads and writes it like any folder (REDnode does not limit a package's file access) |
| An item copied into a project records where it came from | So the project can be refreshed from the Library (below) |

**EDGEbuilder's items:**

| Item | What | Notes |
|---|---|---|
| Scene `<name>.scene.json` | The [scene format](scene.md) as now | A scene can be on or off in the game (previews shown or not) and included in any number of bakes |
| Bake `<name>.bake/` | `bake.json` plus the baked `.streamingsector`, `.streamingblock` and `.xl` | `bake.json`: the scenes it was baked from (name and content hash), the game and REDbridge versions, the date, the streaming boxes it covers. Several bakes of the same place live side by side |

## Flows

| Flow | What happens |
|---|---|
| **Save** (in game or in VS Code) | The scene goes to a Library folder the modder picks. Without a Library root set, EDGEbuilder's data folder is used, as now |
| **Bake** | Picks one or more scenes and bakes them into a new `.bake` in the Library. Object references are already unique across scenes (`edgebuilder/<scene>/<id>`). REDbridge's `sector.build` already takes any target folder |
| **Include in project** | Copies a bake's files into the REDcode project (`source/archive`, `source/resources`) and its scenes into `source/scenes`, each with a note of the Library item and version it came from |
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
| EDGEfab, EDGEmat | Their items in the Library: kinds, manifests, and a Library view where their work needs one | When each tool gets there |
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

- **The rules' home** (agreed): this page keeps the shared Library rules (the root and `library.json`, self-describing items, the "came from" note) until a second tool uses the Library; then they move to the platform's wiki.
- **The default folder**: `Documents\EDGE Library` as offered above, unless the owner prefers another; Relocate makes the first choice cheap to change.
- EDGEscene, an empty repo of 2026-10-27, was deleted by the owner: residue of early ideas, not a home for this.
