---
title: B2b test
---

# B2b Camera: the in-game test

What B2b built: with Edit on, EDGEbuilder looks through a camera of its own and V stays where V is. Builder mode hides the game's HUD while Edit is on. The camera starts exactly where V's view is. Hold the right mouse button to look around and fly with W, A, S, D (Q down, E up, Shift faster, Ctrl slower, the wheel changes the speed while flying). The middle mouse orbits the selected object, and with Shift pans. The wheel moves closer or further, and F frames the selection. **Drop where I look** (it was "Drop in front of me") puts an asset on the first surface the camera looks at. Switch Edit off and the view and the HUD are V's again. Settings has a switch for each half, in case one misbehaves.

Built on 2026-10-14. Outside the game: the camera's heading and pitch math passes `npm run smoke`, the page and the new switches were checked in REDnode's host. Everything that touches the game's camera, HUD and streaming needs the game.

## Before you start

| Need | Why |
|---|---|
| EDGEbuilder 0.3.0 | With REDdeck 0.21.1 it takes 0.2.x's place in the same row. Deploy |
| REDnode 0.17 or later, Codeware, REDbridge allowed | As for B2a |

**About the Test timer:** while Edit is on, EDGEbuilder's layer covers it ([REDnode #10](https://github.com/Edgemodders/REDnode/issues/10)), and switching Edit off to press Mark would end builder mode. So skip the marks this time: the log has the times.

**If V's view gets stuck** (EDGEbuilder stopped while Edit was on): load a save, which gives V's camera back. EDGEbuilder also puts the camera and the HUD back by itself the next time it starts.

## Steps

1. Load a save outdoors, F10, open EDGEbuilder, switch **Edit** on. Expected: the view does not jump; the game's HUD (minimap, quest tracker, crosshair) disappears; the line at the bottom left now also lists the camera keys.
2. Hold the right mouse button and move the mouse: the view turns. Keep holding it and press W, A, S, D, Q, E: the camera flies. Shift faster; the wheel while holding changes the speed (the message line says it). Fly a few metres away and look back: **V is still standing where V was.**
3. Assets tab: pick a cargo crate, **Drop where I look** while looking at the ground some metres away. Expected: the crate lands on that spot, facing the camera.
4. Select it (click it), then: middle mouse drag orbits around it; Shift with the middle mouse pans; the wheel moves closer and further; **F** frames it. Drag its arrows from a few angles: the gizmo and the box still sit on the crate.
5. Fly about 200 m away along a street, then look around. **Say what the world looks like there**: buildings and streets as usual, or missing or low-detail. (The game loads the world around V; this shows whether that follows the camera.)
6. Fly back near the crate. Switch **Edit** off. Expected: the view snaps back to V's eyes and the HUD returns. Switch Edit on again: the camera starts at V's view again.
7. With Edit on, load a save. Expected: after loading, Edit is still on and the camera starts from V's view; switching Edit off gives the HUD back.
8. Settings tab: switch off **Hide the game's HUD**, Edit off and on: the HUD stays. Switch off **Use EDGEbuilder's own camera**, Edit off and on: editing works from V's camera as in B2a. Switch both back on.
9. Quit the game and send `red4ext/logs/rednode-mods.log` and `red4ext/logs/rednode-overlay.log`. The `[edgebuilder]` lines now include `Builder mode on`, `Scene tier ... -> 4`, `Builder mode off` and `Viewport calibrated` once per camera switch.

## What the test decides

| Question | Decides |
|---|---|
| Does the HUD hide, and does everything come back with Edit off | Builder mode through the scene tier is sound, or another way is needed |
| Does the world stay loaded 200 m from V | Whether the camera can roam freely, or EDGEbuilder must bring V along (teleport V under the camera now and then) |
| Do drops land where the camera looks | Placing from the editor camera works without V |
| Does the frame rate hold while flying | One camera move a frame is cheap enough |

## Results

**Passed in game on 2026-10-14** (EDGEbuilder 0.3.0, REDnode overlay host 0.19.0). The editor camera, builder mode, drops where the camera looks, orbit, pan, dolly and frame, Edit off and on, and both Settings switches worked. The world stayed loaded when the camera flew away from V, so the camera roams freely and V need not follow. The viewport stayed exact through every camera switch (0.0 to 0.2 px off the game's own projection in the log).

| Found | Cause | Done |
|---|---|---|
| Loading a save with Edit on brought the HUD back | Edit came back on about two seconds after the load, while the save was still settling: the scene tier read 0, EDGEbuilder raised it to 4, and the game then set its own tier 1 as it handed control to V. The log shows `Scene tier 0 -> 4`, then on Edit off `Scene tier 1 -> 0`, so the game had changed it in between | 0.3.1: while builder mode hides the HUD, EDGEbuilder checks the tier every second; when the game has set its own, it remembers that one for Edit off and raises the tier again. A tier of 0 read at the start is remembered as 1 (play) |
| Holding the right mouse button to look, the cursor still moves across the screen; over the EDGEbuilder window the camera stops | The page only heard mouse moves over its viewport. The cursor itself is the REDnode plugin's, and it keeps moving while a button is held | 0.3.1: moves and releases are heard on the whole page while looking, orbiting, panning or dragging, so crossing the window no longer stops the camera. The cursor still stops at the screen edge: holding it in place needs pointer lock from REDnode, asked in [REDnode #11](https://github.com/Edgemodders/REDnode/issues/11) |
| The help line at the bottom was sometimes wider than the room left of the window | One line held the selection help and the camera keys | 0.3.1: one line each, wrapping at word breaks to the room left of the EDGEbuilder window; a drag's line puts its keys on a second line |
| The cursor disappeared from time to time | Not found in these logs: the plugin's own log was not taken. Earlier REDnode tests traced this to interactive mode ending by itself | Next time it happens, send `red4ext/logs/rednode-<date>.log` too. Noted in REDnode #11 |

**Retest in 0.3.2** (with REDnode 0.22.0 or later for the cursor lock):

1. Load a save with Edit on. The HUD should stay hidden, and come back with Edit off. The log says `The game set scene tier 1; hiding the HUD again` once after the load.
2. Hold the right mouse button and look around in big sweeps. The cursor should vanish and stay put, and the view should keep turning however far you move the mouse, including across the EDGEbuilder window. Release: the cursor is back where it was. Same for the middle mouse (orbit) and Shift with it (pan).
3. Press Esc while holding the right button: the lock ends and looking stops, without leaving Edit.
4. With REDnode older than 0.22, looking still works as in 0.3.1 (the cursor moves and stops at the screen edge).

**The 0.3.2 retest passed in game on 2026-10-16** (EDGEbuilder 0.3.2, REDnode 0.24.0): the HUD stays hidden after a save loads, the cursor stays put while looking, orbiting and panning, and Esc ends the lock without leaving Edit.

| Found | Cause | Done |
|---|---|---|
| The first try showed the HUD and right mouse did nothing | Both Settings switches were still off from step 8 of the first test; the log said `Builder mode on: V's camera` | 0.3.3 says so on screen when Edit goes on with a switch off, and the log's start line names the version |
| Switching **Hide the game's HUD** on while Edit was on did nothing | The switches were read only as Edit went on | 0.3.3: both switches apply at once while Edit is on |
| The help line sat under REDnode's launcher at the bottom left | The launcher's default place | 0.3.3: the help lines are at the bottom centre |
| "Type to search" did not search when typing | It meant the search box | 0.3.3: typing on the Assets tab goes to the search box |
| Settings showed empty REDbridge and game folder fields | Empty means automatic, but what was found was not shown | 0.3.3: an empty field shows `Automatic: ...` with what is in use |
| Asked for: drop where the next click lands | | 0.3.3: **Drop at click** |

## 0.3.3 check

1. Settings: the REDbridge and game folder fields read `Automatic: ...`.
2. With Edit on, switch **Hide the game's HUD** off and on: the HUD comes and goes at once. Switch **Use EDGEbuilder's own camera** off: the view goes to V's eyes; on: the camera starts where V looks. Switching Edit on with a switch off says so in the message line.
3. Click the Assets tab's list and type `crate`: it lands in the search box and searches.
4. Pick a crate, **Drop at click** (it switches Edit on), click a spot on the ground: the crate lands there, facing the camera. Again, then Esc: nothing is dropped.
5. The help lines are at the bottom centre, clear of the launcher and the EDGEbuilder window.
