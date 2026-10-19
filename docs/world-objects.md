---
title: World objects
---

# World objects: picking what the game already placed

Draft 1, 2026-10-18. Status: **proposed**, for phases B3b and B4b of the [roadmap](design.md#roadmap). Agree this page before B3b is built; its first step is the probes at the end.

Until now EDGEbuilder picks only what it placed itself: a click is tested against the boxes of its own previews. A modder also wants to point at something the game put there, a vending machine, a bench, a building's sign, and ask what it is, take a copy into the scene, or change the original. This page is how.

## Behaviours

| Behaviour | What the modder does | What happens |
|---|---|---|
| **Pick** | With Edit on, clicks anything in the world | EDGEbuilder's own objects win as now. When the click hits none of them, the game's object under the cursor is picked and outlined in another colour. **Tab** steps through everything else along the click's line, nearest first |
| **Inspect** | Looks at the Selected panel | Kind (entity, device, mesh, decal, light, ...), resource path, appearance, position, rotation, size, the sector and node it comes from, and the mod it comes from when a mod placed it |
| **Add to scene** | Presses **Add to scene** | A copy becomes an EDGEbuilder object with the same asset, appearance and transform, exactly over the original, and is selected. It then moves, turns, scales and bakes like any other object |
| **Try a look** (entities) | Picks another appearance in the Selected panel | The game's entity changes appearance at once. Nothing is saved: to keep it, add it to the scene, or change the original (B4b) |
| **Change the original** (B4b) | Hides, replaces, moves or rescales the game's object | The edit is kept in the scene and baked with it, so the original stays changed with EDGEbuilder off |

Appearance Menu Mod and similar mods pick what V's crosshair looks at. That works for V standing in front of a device, but EDGEbuilder's camera flies free and the cursor is rarely the screen's centre, so picking follows the cursor, as everything else in Edit does.

## Two kinds of world object

| | Examples | Is there a game object to ask? |
|---|---|---|
| **Entities** | Vending machines and other devices, doors, vehicles, NPCs, many props | Yes: a live entity with an id, a template, an appearance and a transform. Its appearance can change while the game runs |
| **Static nodes** | Most buildings, street furniture, decals, lights, foliage, placed in streaming sectors | No. The game streams them in from sector files and draws them; nothing the game API offers names the node a click hit |

## Picking, step by step

1. **The ray.** From the click through the camera: already built for Drop at click (`math.ts`, the page's `armDrop`).
2. **Where it stops.** The game's physics raycast along the ray, across the collision groups: already built for drops (`raycast()` in `mod.ts`), widened to the groups devices, vehicles and NPCs are in (probe 2). The hit says where the ray stops, not what it hit; anything further along is behind a wall and does not count.
3. **What is there.** Candidates near the ray up to that point:
   - **entities** the game has near the hit (probe 1), each with its bounds;
   - **static nodes** from a **sector index**: REDbridge reads the game's streaming blocks and the sectors around the camera, and lists each node's kind, resource, appearance, transform and bounds (mesh bounds from `mesh.info`, as the asset index does). Read once per game version per sector, and cached, like the asset index.
4. **Which one.** The ray is tested against each candidate's oriented box, as EDGEbuilder's own picking does. A candidate whose box holds the physics hit point is preferred; then the nearest. Nodes without collision, such as decals, lights and small props, have no physics hit of their own but still have a box, so they can be picked.
5. **The outline.** An entity is outlined with the game's render highlight; a static node with its box, drawn by the page as for EDGEbuilder's objects.

The sector index also tells which mod placed a node, when ArchiveXL streams that mod's sector: such sectors come from the mod archives B2c indexes.

## Keeping a reference to the original

A world edit has to find its object again after a restart or a game patch. It is stored in the scene file by the sector's path and the node's index, **with a fingerprint**: the node's kind, resource path and transform. Patches can renumber nodes; when the index no longer matches the fingerprint, EDGEbuilder looks for the fingerprint in the same sector and, failing that, says which edits lost their object instead of changing the wrong one. Entities placed by sectors are the same: a node with an entity template. Entities spawned at run time (NPCs from crowds, traffic) have no node and cannot be edited, only copied.

The scene format gets a `worldEdits` list for B4b. That is a format change: it goes into the [scene format](scene.md) page as format 2 when B4b is planned, and B3b's copies need no change.

## Baking the changes (B4b)

The bake writes the scene's own objects into a new sector, as B4 does, and the world edits as **ArchiveXL sector edits** in the same mod's `.xl` file: remove a node, or change it. Replacing an object is a removal plus a new object in the scene. The baked mod then requires ArchiveXL at the version that has those edits, and its install through EDGEdeck says so.

## What it needs

| From | Need | When |
|---|---|---|
| REDbridge | **`sector.near`**: the nodes of the sectors around a position, with kind, resource, appearance, transform, bounds and the sector's source (game or mod); from the streaming blocks and sector files, cached per game version | B3b. A `request` issue once this page is agreed |
| REDnode | Nothing expected. If probe 1 finds no way to list entities near a point through the game API, an ask goes to REDnode then | B3b |
| ArchiveXL | Sector node removal and mutation, at a known minimum version | B4b |
| Scene format | Format 2 with `worldEdits` | B4b |

## Probes before building

B3b starts with these, in the game and in REDbridge, and records the answers on this page:

| # | Question | Decides |
|---|---|---|
| 1 | Which game API call lists the entities near a point or along a ray, from a free camera rather than V's crosshair | How entities become candidates, or whether REDnode is asked for help |
| 2 | Which collision groups devices, doors, vehicles and NPCs answer in | Which groups the pick's raycast asks |
| 3 | How many nodes the sectors around a typical street hold, and how long REDbridge takes to read them | Whether the sector index is read on demand or built ahead per area |
| 4 | Whether a node's sector path and index are stable between two game versions, on a sample | How much the fingerprint matters |
| 5 | Which node edits ArchiveXL supports (remove; change transform, scale, appearance), and from which version | What "change the original" can offer in B4b |
| 6 | Whether an entity's appearance can be switched live through the game API, for devices as well as props | Whether Try a look is in B3b |

## Not in this plan

Editing NPCs from crowds and traffic, which have no node; changing a node's materials or components beyond its appearance; and editing objects in other mods' sectors beyond hiding them, until the owner decides how a scene should depend on another author's mod.
