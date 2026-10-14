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
| EDGEbuilder 0.2.0 installed | With REDdeck: Add mod, pick `edgebuilder-0.2.0.zip` from the [releases page](https://github.com/Edgemodders/EDGEbuilder/releases); REDdeck replaces 0.1.1 in the same row. Deploy |
| REDbridge allowed | First start: the second pill says **Allow REDbridge**. In REDnode's Mod Manager select EDGEbuilder, Permissions, switch **Allowed** on; the pill turns green by itself within a few seconds |

If the EDGEbuilder window sits in the wrong place (it is full-screen now; a position saved from dragging the B1 window would move it), close the game and remove the `"edgebuilder"` entry from `%APPDATA%\@rednode\overlay\window-positions.json`. REDnode is asked to stop applying a saved position after a window's size changes ([REDnode #8](https://github.com/Edgemodders/REDnode/issues/8)).

Other overlay windows and the game's HUD stay on screen during Edit; windows under EDGEbuilder's tint cannot be clicked until Edit is off. Builder mode, which hides them, comes with B2b.

Use the **Test timer**: Start, then Mark after each step.

## Steps

1. Load a save in an open spot, F10, open EDGEbuilder. Expected: the panel at the right as before; the pills say **World ready**, **REDbridge 0.6.0** and about 31,500 assets. In the Mod Manager, EDGEbuilder's **Requires** lists Codeware with a tick. Mark.
2. Drop a cargo crate in front of V (Assets tab, as in B1). Switch **Edit** on in the panel's title bar. Expected: the screen darkens very slightly, and a line at the bottom left says what to do. Mark.
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

### In the game

Not run yet.
