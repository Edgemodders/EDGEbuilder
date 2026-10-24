---
title: B2a test
---

# B2a Position: the in-game test

What B2a built: the page now covers the game view, with the panel at the right. An **Edit** switch in the panel's title bar turns the rest of the screen into a viewport: click an object to select it, drag the gizmo's arrows to move it along an axis or its ring to turn it, use G, R and S with axis locks and typed numbers, drop it to the floor, scale meshes. The Selected panel gains X, Y, Z, Heading and Scale fields. REDbridge now comes from REDnode (`kernel.bridge()`), and the manifest says EDGEbuilder needs Codeware 1.14 or later.

Built on 2026-10-13. Outside the game: the geometry (camera projection learned from the game's `ProjectPoint`, picking, drags) passes `npm run smoke` against simulated cameras of both kinds `ProjectPoint` might be; the page, the Edit layer, the fields, Apply, REDnode's REDbridge and the permission prompt were checked in REDnode's host without the game. The gizmo against the real camera needs the game.

## Before you start

| Need | Why |
|---|---|
| REDnode 0.17.0 or later deployed | `kernel.bridge()` and `requires`. With an older REDnode, EDGEbuilder starts its own REDbridge as before |
| Codeware 1.14 or later, REDbridge 0.6.0 | As for B1 |
| EDGEbuilder 0.2.0 installed | With EDGEdeck: Add mod, pick `edgebuilder-0.2.0.zip` from the [releases page](https://github.com/Edgemodders/EDGEbuilder/releases); With EDGEdeck 0.21.1 or later, 0.2.0 takes 0.1.1's place in the same row and 0.1.1 goes off; with an older EDGEdeck, turn the old EDGEbuilder off yourself, or both deploy the same files and conflict. Deploy |
| REDbridge allowed | **New in 0.2.0, do this first.** The second pill says **Allow REDbridge** until you allow it: F10, open the **Mod Manager** from the REDNODE launcher tab, select **EDGEbuilder**, and under **Permissions** switch **Allowed** on. Within about five seconds the pill turns green and the third shows about 31,500 assets. (From 0.2.1 the index from last time loads at once, so search works even before this) |

If the EDGEbuilder window sits in the wrong place (it is full-screen now; a position saved from dragging the B1 window would move it), close the game and remove the `"edgebuilder"` entry from `%APPDATA%\@rednode\overlay\window-positions.json`. REDnode was asked to stop applying a saved position after a window's size changes ([REDnode #8](https://github.com/Edgemodders/REDnode/issues/8), since closed).

Other overlay windows and the game's HUD stay on screen during Edit; windows under EDGEbuilder's tint cannot be clicked until Edit is off. Builder mode, which hides them, comes with B2b.

Use the **Test timer**: Start, then Mark after each step. While Edit is on, EDGEbuilder's layer covers the Timer: switch Edit off to press Mark (REDnode #10).

## Steps

1. Load a save in an open spot, F10, open EDGEbuilder. Expected: the panel at the right as before; the pills say **World ready**, **REDbridge 0.6.0** and about 31,500 assets. In the Mod Manager, EDGEbuilder's **Requires** lists Codeware with a tick. Mark.
2. Drop a cargo crate in front of V (Assets tab, as in B1). Switch **Edit** on: in EDGEbuilder's window at the right of the screen, the top bar that says EDGEBUILDER has a small switch at its right end labelled Edit OFF; click it so it says ON (the overlay must be interactive, F10). Expected: the screen darkens very slightly, and a line at the bottom left says what to do. Mark.
3. Look at the crate. Expected: three arrows from its base (red X, green Y, blue Z), a yellow ring around it, and a thin cyan box around the crate. **Say how well the box fits the crate**: on it, a little off, or far off. Press F10 to passive and walk around it: the gizmo should stay on the crate. Mark.
4. Back in interactive mode (F10), drag the red arrow: the crate slides along X under the cursor, and stays when you let go. The same with green and blue. Hold Ctrl while dragging: it moves in 0.25 m steps. Mark.
5. Drag the yellow ring: the crate turns around the vertical. Ctrl gives 15° steps. Mark.
6. Keys, with the crate selected: **G**, move the mouse, click (keeps); **G**, **Z**, type `1.5`, Enter (up 1.5 m); **R**, type `90`, Enter (a quarter turn); **S**, type `2`, Enter (twice the size: the crate is rebuilt, so it blinks); **G**, move, **Esc** (goes back). Mark.
7. **Ctrl+E**: the crate drops onto the ground below. Mark.
8. Drop a vending machine (Entities). Click it in the world: the outline moves to it and the Scene tab opens with its numbers. Press **S**: a note says only meshes scale. Mark.
9. In the Selected panel, type new X, Y, Z or Heading values and press Apply (or Enter in a field): the object moves there. Mark.
10. Press **Delete**: the selected object goes. Switch **Edit** off: the mouse works in the game again. Mark.
11. For the frame rate: with Edit on, drag an arrow back and forth for about 10 seconds without letting go, and note how smooth it feels. Mark.
12. Quit the game. Send `red4ext/logs/rednode-mods.log` and `red4ext/logs/rednode-overlay.log`. The `[edgebuilder]` lines now include `Viewport calibrated`, `Viewport check: ... px`, `Drag (...): N moves in T s` and `Drop to floor ...`.

## What the test decides

| Question | Decides |
|---|---|
| Does the cyan box fit the object, and does `Viewport check` say a few pixels or less | The projection is right. If not, the calibration is fixed before anything builds on it |
| Do drags follow the cursor without lag | One move per frame through `world.move` is enough for editing |
| Does the frame rate hold while dragging | Whether moves need throttling |
| Which collision group Ctrl+E hit | The floor query B2b's camera and B6's snapping use |
| Do clicks on the tinted layer reach the page | The 4% tint (alpha 10) is above REDnode's click-through threshold, as designed |

## Results

### Before the game, 2026-10-13

| Check | Result |
|---|---|
| Geometry | `npm run smoke`: projection within 0.5 px of a simulated camera, for a `ProjectPoint` answering in -1..1 with y up and one answering in pixels with y down; the picking ray passes through the point it was made from; a turned and a scaled box are hit at the right distance; dragging along an axis and turning read back exactly |
| Page | REDnode host 0.17 off-screen, no game: the page is 1920 x 1080 with the panel at x 1448; Edit tints the viewport `rgba(0,0,0,0.04)`; the label says "No camera yet: Not connected to the game"; the Selected fields show a stored 45° rotation as heading 45.0; Apply with X, heading 90 and scale 2 saved `[0, 0, 0.7071, 0.7071]` and `[2, 2, 2]` |
| REDbridge | Through `kernel.bridge()`: REDbridge 0.6.0 from REDnode, the index loaded from its cache. Without the permission: the pill says "Allow REDbridge" with where to switch it on, and EDGEbuilder looks again every 5 s |
| Requires | REDnode's host found Codeware 1.20.3 for EDGEbuilder's `>=1.14` |
| Found on the way | An unreadable scene file was replaced by an empty scene on the next save. Now it is kept beside as `working.scene.json.unreadable-<time>` and the message line says so |

### In the game, 2026-10-14: passed

On the owner's PC with EDGEbuilder 0.2.0, REDnode host 0.17.0, Codeware 1.20.3 and REDbridge 0.6.0. "Everything seemed to work fine." The owner could not press Mark in the Test timer while Edit was on, so the steps have no marks; the logs give the times.

| What | Result |
|---|---|
| The projection | Calibrated from three `ProjectPoint` calls: FOV 51 (the game's FOV is vertical: `ky` 2.096 = 1 / tan(25.5°), and `kx` / `ky` = 16:9), `ProjectPoint` answers in -1..1 with y up. The check point landed **0.0 px** from where the game projects it, and the owner saw the box and gizmo sit on the crate |
| REDbridge through REDnode | "Allow REDbridge" until the owner allowed it in the Mod Manager; EDGEbuilder picked it up by itself within five seconds, from EDGEdeck's copy |
| Drags | 14 to 28 moves a second on arrows and the ring, at about 38 fps. The object and its outline trailed the cursor "a little bit, but it wasn't too bad": each move waited for the game's answer before the next was sent |
| Frame rate | The same 38 to 39 fps in interactive mode with and without dragging, and 68 to 73 in passive mode. Game calls went from 33 a second without EDGEbuilder to about 72 with Edit on (the camera each frame) and up to 105 while dragging; their cost peaked at 1.6 ms a frame. Dragging does not lower the frame rate |
| Drop to floor | Static and PlayerBlocker hit at z 119.08, Terrain missed; the crate went down 1.00 m onto the ground |
| Scale | S, 2, Enter rebuilt the crate's preview at twice the size |
| Selecting in the world, keys, numbers, Delete | As expected |
| Save loaded mid-session | The viewport logged once that its camera reference was gone and picked up the new one by itself |

| Found | What happened about it |
|---|---|
| Other windows cannot be clicked while Edit is on: the Test timer's Mark, the launcher, the Mod log | EDGEbuilder's layer covers them. Asked of REDnode: tool windows above packages' windows ([REDnode #10](https://github.com/Edgemodders/REDnode/issues/10)); a solo mode that hides the rest ([REDnode #7](https://github.com/Edgemodders/REDnode/issues/7)). Until then: switch Edit off to press Mark |
| The gizmo stayed on the selected object after Edit was switched off | **0.2.2**: nothing is drawn and the camera is not read with Edit off; the game's outline still marks the selection |
| The object trailed the cursor while dragging | **0.2.2**: the newest position is sent once a frame without waiting for the answer, as REDnode measured calls batch per frame. To confirm in B2b's test |
| An object the owner did not remember placing was in the scene | The log shows a drop at 03:49:49 in an earlier session; the scene file kept it, as designed. 0.2.1 now says so when the game is ready, and a drop that fails no longer leaves an object behind |
| Two EDGEbuilder versions on in EDGEdeck after installing 0.2.0 | EDGEdeck 0.21.1: a new version takes the old one's place |

**B2a passed.** Next: B2b, the editor camera and builder mode.
