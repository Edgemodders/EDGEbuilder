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

Not run yet.
