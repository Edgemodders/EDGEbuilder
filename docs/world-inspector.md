---
title: World inspector
---

# World inspector

Draft 1, 2026-10-29. Status: **proposed**, at the owner's request: a world inspector built into EDGEbuilder, like RED Hot Tools' World Inspector. It grows phase B3b ([World objects](world-objects.md)) into a full inspector, and gives B4b a way to try an edit live before baking it. To be agreed with the Library proposal.

## What RED Hot Tools has

[RED Hot Tools](https://github.com/psiberx/cp2077-red-hot-tools) by psiberx is a RED4ext plugin with a Cyber Engine Tweaks window. Its World Inspector, studied on 2026-10-29 from the Edgemodders fork's source (`src/App/World/`, `support/cet/modules/world/`), is a CET window with seven tabs:

| Tab | What it does |
|---|---|
| **Inspect** | What V's crosshair points at, with every candidate along the line (cycle through them). Two ways to aim: the game's physics (what has collision, at the level of a collision actor or of each shape) or the static bounds of every streamed node (finds what has no collision: decals, lights, small props). The target is outlined and its box drawn on screen, with its origin and, as an option, the distance to each corner |
| **Scan** | Every node streamed in within a distance of the camera, sorted by distance, filtered by group and text. Hovering a row outlines the object in the world. **Copy sectors** copies the sectors they come from |
| **Watch** | The entities around the player, kept in a list |
| **Lookup** | Finds a node, resource or record from a hash, a node reference, a path or a TweakDB id |
| **Streaming** | The observer override: the world streams around a chosen point instead of around V |
| **Settings, Hotkeys** | Colours, distances, what to highlight; keys to toggle the overlay, cycle targets and aim modes, toggle a target's visibility |

What it shows for a target: the node's type, id, reference (resolved from 2.5's hash), proxy and parent, position, orientation and scale, **the sector it comes from with the node's index** (and the instance index for instanced meshes), debug name and source prefab. For entities: id, type, record, template, appearance, device class, components (mesh and appearance, rig, chunk mask, ...), attachments, loot tables. For NPCs from a community: the community and its entry and phase. Resources it uses: mesh, material, particle, effect, workspot, foliage.

What it can change: **only a node's visibility**, live and for the session. It does not move, add or save anything.

**How it knows which node is which.** Its native part watches the game stream sectors in and out, and records for each live node instance the sector and index it came from. That is exact, works for nodes from mods' sectors too, and does not depend on matching files to what is on screen. From the same hooks it lists the streamed nodes in the camera's view, tests them against a ray, draws the game's outline on a node's render proxies, and hides or shows one.

**Status on game 2.5:** RED Hot Tools has no 2.5 build yet. The address list for 2.5 no longer names a function it uses, which is why REDnode made [REDswap](https://edgemodders.github.io/REDnode/redswap.html), a 2.5 port of its archive swap. Its world hooks need the same kind of porting.

**License:** MIT. EDGEbuilder's clean-room rule is about World Builder, whose license reserves its code. RED Hot Tools' code may be learned from and ported with its license notice, as REDswap was. EDGEbuilder's inspector is still designed from behaviours, in EDGEbuilder's own window and words.

## EDGEbuilder's inspector

Part of Edit, not a separate tool: the same cursor, camera, gizmo and Selected panel.

| Behaviour | What the modder does | What happens |
|---|---|---|
| **Inspect** | With Edit on, hovers or clicks anything in the world (Inspect switch on, or a modifier key) | It is outlined and its box drawn; the Selected panel shows what it is (the fields above, in plain words, with copy buttons). The cursor aims, not the crosshair: the camera is free. **Tab** steps through everything along the line, nearest first |
| **Aim mode** | Picks Solid (physics) or All (bounds) | Solid hits what you see first; All also finds decals, lights, triggers and other things without collision |
| **Scan** | Opens the **World** tab | Everything streamed near the camera, filtered by kind (meshes, entities, lights, decals, collision, ...) and text, sorted by distance. Hover outlines it; click selects and frames it; the sector column links to the sector |
| **Look up** | Types a node reference, hash, path or record | Finds it if it is streamed in, and frames it |
| **Hide** | Hides the selected game object | Gone for the session only, to judge the place without it. Kept as a world edit in the scene only if the modder says so (B4b), then baked |
| **Add to scene** | As in [World objects](world-objects.md) | A copy becomes an EDGEbuilder object over the original |
| **Stream around the camera** | Automatic in Edit, with a switch | The world streams around EDGEbuilder's camera, not around V, so a far street has its full detail (B2b found the world stays loaded far from V, but at V's level of detail) |

Moving or rescaling a game object is B4b's "change the original": a world edit in the scene, shown live by hiding the original and placing a copy where the edit puts it, then baked as an ArchiveXL edit.

**In VS Code** (the [Library and world view](library.md) proposal): the sector view gets the same Selected panel for a sector's nodes, read from the sector file, and the same Look up. "Show in game" frames a node in the running game; "Show in VS Code" opens a node picked in game in the sector view.

## What it needs

| From | Need | Notes |
|---|---|---|
| **REDnode** | A **world node registry** in its plugin: for each streamed node instance, its sector and node index, instance index, type, reference, transform and bounds; the streamed nodes within a distance or along a ray; the game's outline on a node; a node's visibility; the streaming observer at a chosen point | The native part, ported from RED Hot Tools' MIT code to 2.5 with its license, as REDswap was. It belongs in REDnode, not EDGEbuilder: native hooks are the plugin's, and other packages can use it. A `request` issue once this page is agreed |
| REDnode | `world.near` from a point other than V's | Probe 1 of World objects |
| REDbridge | `sector.nodes` (from the Library proposal) | Full node data from the sector file when the live node does not have it, and the same data in VS Code. It replaces World objects' `sector.near` |

With the registry, [World objects](world-objects.md)' picking step 3 changes: static nodes come from REDnode's registry of what is streamed in, exactly, rather than from a REDbridge index matched by position. Its reference rules (sector path, node index, 2.5 hash, fingerprint) stay.

## Roadmap

B3b becomes **B3b World objects and the inspector**:

| Step | Delivers |
|---|---|
| Probe | Whether REDnode's port of the registry works on 2.5: one node's sector and index from a click, its outline, hide and show |
| B3b-1 Inspect | Hover and click, both aim modes, Tab, outline and box, the Selected panel's fields, copy |
| B3b-2 World tab | Scan, filters, hover outline, frame; Look up |
| B3b-3 Hide and copy | Hide for the session; Add to scene; try an entity's appearances |
| B3b-4 Stream around the camera | The streaming observer follows the camera in Edit |

B4b then keeps hides and changes as world edits and bakes them. The order of B3b among the other phases is unchanged: after B3c.
