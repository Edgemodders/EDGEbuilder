---
title: Changelog
---

# Changelog

What changed in each EDGEbuilder release, newest first. The release workflow takes a release's notes from its section here (`tools/release/notes.mjs`). From the public preview on, the Nexus page's changelog gets the same section as plain lines.

With each change a player or modder would notice, add a line under **Unreleased** in the same commit, grouped **New**, **Changed**, **Fixed**, **Other**. Before a release, rename **Unreleased** to `## <version> (<date>)` (the version in `edgebuilder/rednode-app.json`) and start a new empty one.

## Unreleased

**New**

- Browse lists the meshes and entities of installed mods (`archive\pc\mod` and REDmod's `mods\<name>\archives`), tagged with the mod's name, and of the project open in REDcode (0.10.5 or later). New tabs: Everywhere, Game, Mods, Project. A mod's name in the search box finds its files. A mod file with a game file's path says it changes that file.
- Mod archives are read once and again only when one changes; a project's new files show up as they are saved.
- The Scene tab says which mods and which REDcode project the scene needs.
- While Edit is on, other packages' windows are hidden (REDnode's solo mode). Allow Solo for EDGEbuilder in REDnode's Mod Manager; without it they stay, and EDGEbuilder says so once.
- After an archive swap (REDcode's Pack and try), previews that use a swapped file come back showing the new version, and stay selected.
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
