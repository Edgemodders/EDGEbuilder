---
title: Changelog
---

# Changelog

What changed in each EDGEbuilder release, newest first. The release workflow takes a release's notes from its section here (`tools/release/notes.mjs`). From the public preview on, the Nexus page's changelog gets the same section as plain lines.

With each change a player or modder would notice, add a line under **Unreleased** in the same commit, grouped **New**, **Changed**, **Fixed**, **Other**. Before a release, rename **Unreleased** to `## <version> (<date>)` (the version in `edgebuilder/rednode-app.json`) and start a new empty one.

## Unreleased

**New**

- NPCs: the game's people are on the Assets tab, under the new NPCs tab. Search by their in-game name ("Judy") or their record (`Character.Judy`), pick an appearance or let the game pick one, and drop them like an entity. They stand where you put them and stay friendly to V.
- People move and turn with the gizmo and the keys, and copy, paste, group and undo like any object. They stay upright when turned. While you drag, the gizmo moves on its own; the person goes to the new place when you let go.
- Scenes keep their people, with the appearance each one got, and bring them back after a save loads or the game restarts. A scene with people is saved as scene format 2; scenes without stay format 1.
- Other packages, and assistants through REDnode's `world_load`, can load a scene's people too, without EDGEbuilder running.

**Changed**

- The Picked panels on the Assets and Library tabs and the Scene tab's Selected panel have a pin in their top right corner. Pinned, the panel stays at the bottom of its tab while you scroll, so its buttons (Drop; Open, Close, Show in world; the selection's numbers) are always in view. They start pinned; click a pin to let that panel scroll with the tab again, and EDGEbuilder remembers your choice for each.
- The Bake tab notes which NPCs a bake leaves out (people are never baked): they show only while EDGEbuilder or another package loads the scene.

**Fixed**

- After a game start, the open scene's objects sometimes did not come back, on slower PCs most of all, until the scene was closed and opened again. They now come back once the save has finished loading.
- The gizmo no longer jumps back to where a drag started for a moment after you let go.
- Refresh on the Bake and Library tabs asks REDcode again for the open project, so a project opened or made after the game started shows at once. When REDcode's REDnode package is not in the game, the Bake tab says so and how REDcode puts it in, instead of "No REDcode project is open".

## 0.9.2 (2026-11-08)

Tested on game 2.5 with REDnode 0.58.0 and REDbridge 0.12.1.

**Fixed**

- The gizmo and the EDGEbuilder window no longer show over the game's menus (pause, Settings, inventory, map): the window hides while a menu is open and comes back when it closes. A move or a look under way when the menu opened stops there.

## 0.9.1 (2026-11-08)

The first public preview, on Nexus Mods (https://www.nexusmods.com/cyberpunk2077/mods/36627). The same EDGEbuilder as 0.9.0, tested on game 2.5 with REDnode 0.58.0 and REDbridge 0.12.1, and now checked on a wide screen too.

**Other**

- The editor covers a screen wider than 16:9 as it should: checked on an ultrawide monitor, with the gizmo, clicks, box select and drops lining up to both edges.
- The download is now EDGEbuilder-<version>.zip, laid out like the game folder (red4ext/plugins/REDnode/apps/edgebuilder), with a README.txt and the license, so Vortex, EDGEdeck and an extract by hand all install it.

## 0.9.0 (2026-11-08)

B4-3, Library bakes, the last phase before the public preview. Tested on game 2.5 with REDnode 0.58.0 and REDbridge 0.12.1.

**New**

- Bakes in the Library: pick a scene on the Library tab and press Bake into Library. The bake is a folder of its own beside your scenes, named by the Name field, and needs no REDcode project.
- A Library bake can hold several scenes: pick it and press Add open scene. Each scene stays a sector of its own, so it loads only near its own place. The trash icon by a scene takes it out of the bake; the scene stays.
- Include in project copies a Library bake into the REDcode project open in VS Code; pack and install it there. The project notes where it came from in `source\library.json`, the file every EDGE tool shares (https://edgemodders.ai/wiki/library.html).
- Bake again, on a Library bake, bakes its scenes as they are now and raises its version. The Bake tab then shows Update next to that bake in each project that includes it, and the Library tab's Include in project becomes Update in project to the new version.
- Flags on Library bakes, in the tree and the Picked panel: stale (a scene changed since the bake), scene missing, collides (two bakes hold the same scene, so it would stand twice), in game, and in project.
- The Bake tab says when a project's bake came from the Library.

**Fixed**

- The last bake's note says Pack and Install, not Pack and Play: a bake comes in only as the game starts.
- The New button's tooltip names the button as it is labelled, New scene here.

## 0.8.1 (2026-11-08)

B4-2, the Solid switch. Tested on game 2.5 with REDnode 0.58.0 and REDbridge 0.12.1. 0.8.0 was a test build only. Solid meshes need REDbridge 0.12.0 or later, and Seen from on small meshes 0.12.1 or later.

**New**

- The Solid switch: on the Scene tab, for one mesh, several or a group. A solid mesh stops V, bullets and cars once baked. New meshes start solid; meshes already in your scenes stay as they were until you switch them.
- EDGEbuilder says which meshes can't be solid, because they have no collision data, on the Scene tab and the Bake tab.
- Ctrl+A selects the whole scene.
- Seen from: how far off an object is seen once baked, in metres, on the Scene tab for one object, several or a group. Empty, it goes by the object's size: 40 m for small things, up to 400 m for big ones. Small meshes are seen that far only with REDbridge 0.12.1 or later (EDGEdeck: Get REDbridge); the Bake tab says so with an older one.

**Changed**

- The tab bar stays in place: a long tab scrolls under it.

**Fixed**

- The Scale field is hidden when an entity is selected. It took typing before, though an entity keeps its template's size.

## 0.7.3 (2026-11-05)

**New**

- The Bake tab: bake the open scene into the REDcode project open in VS Code, as a streaming sector of its own. It checks the scene first, names the mods it needs, says when the scene changed since the last bake, and lists the project's bakes, which you can take out again. Pack and install the project, and the objects stand in the world from the next game start, with EDGEbuilder off.
- A scene whose bake is in the game places no previews by itself, so nothing stands twice, whether the project was packed as a plain archive or a REDmod. Rebuild previews brings them back to edit it.

**Changed**

- The window is a little wider, for the sixth tab.
- The Scene tab's name field is labelled Open scene's name, and pressing Enter after changing it asks before renaming the scene and its file. The New button's tooltip says what comes next.

## 0.6.7 (2026-11-05)

B3-2 Save. Tested on game 2.5 with REDnode 0.58.0. 0.6.0 to 0.6.6 were test builds only. Needs REDnode 0.58.0 or later.

**New**

- Drop at click and Drop to floor look up to 1000 m for a surface. The game's ground is solid only near the camera, and Drop to floor's message now says to fly closer when it finds nothing.
- A scene's objects are all in the world wherever V is, so you can fly to any of them and work there; the old 300 m limit is gone. Needs REDnode 0.58.0.
- Close on the Scene tab and the Library tab's Picked panel: the scene's objects leave the world and no scene is open, also at the next start. The scene stays saved.
- An Objects drawer beside the window, from the Library tab: every object of the picked scene or the open one. Two quick clicks fly the camera to an object and select it, opening its scene first if needed; a trash icon on each row deletes it after asking, wherever it and the camera are.
- After Save as (Ctrl+Shift+S), only Save open scene here is offered, so a copy cannot come out empty by mistake.
- The open scene's objects come back by themselves when a save loads.
- Two quick clicks on a scene in the Library tab open it.
- Named scenes. The Scene tab shows the open scene's name (Enter renames it and its file) and where it is, with Save, Save as, New and Open. Every change is still saved at once; Ctrl+S confirms it and Ctrl+Shift+S saves a copy under a new name, which becomes the open scene.
- The Library: one folder for the EDGE tools' work, kept in `%APPDATA%\EDGE\library.json`, offered at `Documents\EDGE Library` (Make the Library on the Library tab, or any folder in Settings). Make your own folders in it and keep scenes there. The Library is never needed: scenes can stay in the open REDcode project (`source\scenes`) or on This PC.
- The Library tab: every scene in the Library, the open REDcode project and This PC as one tree of folders, with each scene's object count and when it changed. Pick a scene to open it (or double-click), a folder for New scene here, Save open scene here or New folder.
- Show a scene in the world beside the one you are editing (Show in world on the Library tab). Its objects cannot be selected; open the scene to change it. Needs REDnode 0.58.0 or later.
- EDGEbuilder opens the scene you had open last time when it starts, and shows again the scenes that were shown, once a save is loaded.
- A service for other packages and AI assistants: `scenes()` lists every scene with its place, folder, object count and whether it is open or shown; `refs(scene)` gives a scene's objects with the node references the bake gives them (`edgebuilder/<scene>/<id>`), kinds, positions and rotations, for EDGEquest (https://github.com/Edgemodders/EDGEbuilder/issues/3). Both read without asking (`edgebuilder__scenes`, `edgebuilder__refs`). The event `scene-changed` follows the open scene.

**Changed**

- The page covers the whole game view at any width (REDnode's `"fill": "screen"`, REDnode 0.50.0 and later), so the viewport and gizmo work on 21:9 and wider screens; the window stays at the right edge.
- A long message keeps its lines and pushes the tabs down instead of running into them.

## 0.5.8 (2026-11-02)

B3-1 Arrange. Tested on game 2.5 with REDnode 0.52.1. 0.5.0 to 0.5.7 were test builds only. In the game, Ctrl+Z, Ctrl+Y, Ctrl+C, Ctrl+X, Ctrl+V and Esc need REDnode 0.52.0 or later.

**New**

- A busy bar when a scene change takes more than half a second: what it is, how far (`Rebuild previews: 3 of 9`), how long, and how many of your later clicks wait behind it. In Edit it also shows at the top of the view. Stop places no more previews for that change; what waits still runs.
- Esc or a right-click cancels what is in progress in the viewport: a drag, a Drop at click, a box, a copy's move. In the game Esc needs REDnode 0.52.0 or later; with an older REDnode, Esc leaves interactive mode and a right-click cancels.
- Enter in a field of the Selected panel applies it and leaves the field, so Ctrl+Z then undoes the change rather than the field's text.
- Several objects at once: Ctrl+click adds an object to the selection (in the world and in the Scene list), Shift+drag selects everything in a box. Moving, turning and scaling act on all of them, around their middle; G, R, S, the axis keys, typed numbers and Ctrl snapping work as for one. Delete and Drop to floor act on each.
- Groups: Ctrl+G groups the selection, Ctrl+Shift+G ungroups. A click on an object in a group selects the whole group; Alt+click picks just that object. Groups can hold groups, have a name you can change, and open and close in the Scene list, which is now a tree.
- Duplicate: Ctrl+D copies the selection, its groups with it, and the copy follows the mouse until a click places it; a right-click takes it back. With Edit off the copy goes beside the original.
- Undo and redo: Ctrl+Z and Ctrl+Y (or Ctrl+Shift+Z), and buttons on the Scene tab, for the last 100 changes of the session: drops, moves, turns, scales, Apply, Drop to floor, deletes, copies, grouping, renaming and Clear scene. In the game, Ctrl+Z and Ctrl+Y need REDnode 0.52.0 or later; with an older REDnode, use the buttons.
- Copy, cut and paste: Ctrl+C copies the selection, groups included, and Ctrl+X cuts it (copies, then deletes; Ctrl+Z puts it back); Ctrl+V pastes it where the cursor points, standing on the surface there (with Edit off, where Drop where I look puts things). Paste as often as you like; the copy stays for the session, even after the originals are deleted.
- A drop shows the Scene tab with the new object in the Selected panel, as a click on an object does.
- With several objects selected, the Selected panel shows their middle: Apply moves them there, Turn by turns them around it, Scale by scales them from it.

**Changed**

- Undo, Redo and Rebuild previews place previews only for objects within 300 m of V or the editor camera. Farther objects stay in the scene, and the message says how many; Rebuild previews near them places them. Before, each one far away held everything else up for 10 seconds, drops included.
- The found count is shorter and in the kind's own word: `1 mesh found`, `4 entities found`, `0 assets found for "chair"`. The tab already says where.

## 0.4.1 (2026-10-30)

Tested on game 2.5 with REDnode 0.48.1 and REDbridge's build with mod reading (https://github.com/Edgemodders/REDbridge/issues/12, released in REDbridge 0.12.0). 0.4.0 was a test build only.

**New**

- Browse lists the meshes and entities of installed mods (`archive\pc\mod` and REDmod's `mods\<name>\archives`), tagged with the mod's name, and of the project open in REDcode (0.10.5 or later). New tabs: Everywhere, Game, Mods, Project. A mod's name in the search box finds its files. A mod file with a game file's path says it changes that file.
- Mod archives are read once and again only when one changes; a project's new files show up as they are saved.
- The Scene tab says which mods and which REDcode project the scene needs.
- The found count says what it is filtered by (the search text, meshes or entities only, the game, mods or the project), so an empty list says why.
- While Edit is on, other packages' windows are hidden (REDnode's solo mode). Allow Solo for EDGEbuilder in REDnode's Mod Manager; without it they stay, and EDGEbuilder says so once.
- After an archive swap (REDcode's Pack and Play), previews that use a swapped file come back showing the new version, where the scene has them, and stay selected.
- A mod's or project's mesh or entity shows its size and appearances in Picked, and drops with its own box for the gizmo. Needs REDbridge 0.12.0 or later (EDGEdeck: Get REDbridge); with an older one it drops with a 1 m box and says so.

**Changed**

- Mesh previews are REDnode's own mesh props (`world.spawn` with `mesh`), which REDnode can spawn again after an archive swap.

## 0.3.4 (2026-10-29)

Tested on game 2.5 with REDnode 0.45.0.

**Changed**

- REDdeck is now EDGEdeck: EDGEbuilder finds the REDbridge EDGEdeck fetched, under `globalStorage\edgemodders.edgedeck`.

**Fixed**

- With a REDnode from before its EDGEdeck update, which says REDbridge is not installed, EDGEbuilder runs the copy it finds itself instead of stopping.

## 0.3.3 (2026-10-16)

**New**

- Drop at click: the next click in the world places the picked asset there, facing the camera. Esc cancels.
- The Settings fields show the REDbridge and game folder in use (`Automatic: ...`).

**Changed**

- The two Settings switches (the editor camera, hiding the HUD) apply at once while Edit is on, and Edit says when one is off.
- Typing on the Assets tab searches.
- The help lines sit at the bottom centre, clear of REDnode's launcher.
- The log names EDGEbuilder's version.

## 0.3.2 (2026-10-15)

**Changed**

- With REDnode 0.22.0 or later, the cursor stays put and hidden while you look, orbit or pan with the right or middle mouse button, so the view keeps turning however far the mouse moves. Esc ends it.

## 0.3.1 (2026-10-14)

**Fixed**

- The game's HUD stays hidden when a save loads with Edit on.
- Looking, orbiting and dragging keep going when the cursor crosses the EDGEbuilder window.
- The help line wraps instead of running off the screen.

## 0.3.0 (2026-10-14)

**New**

- The editor camera: with Edit on, EDGEbuilder looks through a camera of its own and V stays put. Right mouse to look and fly (W A S D Q E), middle mouse to orbit and pan, the wheel to dolly, F to frame.
- Builder mode hides the game's HUD while Edit is on.
- Drop where I look puts an asset on the surface the camera looks at.

## 0.2.2 (2026-10-14)

**Fixed**

- The gizmo is drawn only while Edit is on.
- A dragged object follows the cursor more closely.

## 0.2.1 (2026-10-14)

**Fixed**

- A failed drop no longer leaves an invisible object in the scene.
- The asset index from last time loads at once, so search works before REDbridge is allowed.
- Objects in the scene but not in the world are pointed out when the game is ready.

## 0.2.0 (2026-10-14)

**New**

- Position: an Edit switch turns the game view into a viewport. Click to select; drag the gizmo's arrows and ring; G, R and S with axis locks and typed numbers; Ctrl+E to the floor; mesh scale; numbers in the Selected panel.

**Changed**

- REDbridge comes from REDnode (0.17.0 or later): allow it for EDGEbuilder in the Mod Manager. Codeware 1.14 or later is declared as a requirement.

## 0.1.1 (2026-10-13)

**Fixed**

- A "No game" state instead of a wrong Codeware warning.
- The message line sits under the status pills, so it is always visible.
- Each asset is listed once (31,571 instead of 32,416).

## 0.1.0 (2026-10-13)

**New**

- Browse and drop: the asset index from the player's own game files through REDbridge, search, Drop in front of me, select, delete, Rebuild previews after a save loads.
