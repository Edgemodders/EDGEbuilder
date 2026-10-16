---
title: Tests
---

# <span class="y">Tests</span>

Every test run on EDGEbuilder so far: how to run it again, what to expect, and what it showed. Each phase ends with the owner's in-game test on the dev PC. The phase pages ([B1](b1-test.md), [B2a](b2-test.md), [B2b](b2b-test.md)) keep the full steps and every log reading; this page gathers them in one place. New tests are added here when they are first run.

Last updated 2026-10-16.

## At a glance

| Test | Kind | Phase | Last run | Result |
|---|---|---|---|---|
| [Type check and build](#type-check-and-build) | Automated | B1 on | 2026-10-16 (0.3.3) | Pass |
| [Smoke test](#smoke-test) | Automated, needs REDbridge and the game files | B1 on | 2026-10-16 (0.3.3) | Pass |
| [Page check in REDnode's host](#page-check-in-rednodes-host) | By hand, no game | B1 on | 2026-10-16 (0.3.3) | Pass |
| [B1 Browse and drop](#b1-browse-and-drop) | In the game | B1 | 2026-10-13 (0.1.1) | Pass |
| [B2a Position](#b2a-position) | In the game | B2a | 2026-10-14 (0.2.0) | Pass |
| [B2b Camera](#b2b-camera) | In the game | B2b | 2026-10-14 (0.3.0) | Pass |
| [B2b retest](#b2b-retest-in-032) | In the game | B2b | 2026-10-16 (0.3.2) | Pass |
| [0.3.3 check](#033-check) | In the game | B2b | Not run yet | |

## Automated

### Type check and build

```powershell
npm install
npm run build
```

`build` type-checks with `tsc --noEmit` and bundles with esbuild. Expected: no errors; `edgebuilder/mod.mjs`, `edgebuilder/app.js` and `dist/core.mjs` written.

### Smoke test

```powershell
npm run smoke
# or, with a REDbridge and game folder it does not find by itself:
$env:EDGEBUILDER_BRIDGE = "<REDbridge.exe>"; $env:EDGEBUILDER_GAME = "<game folder>"; npm run smoke
```

It builds, then runs `scripts/smoke.mjs` against the REDnode-free parts. The bridge and index checks are skipped when no REDbridge or game folder is found.

| Check | Expected |
|---|---|
| Scene store | Add, unique ids (`cargo_crate_a`, `cargo_crate_a_1`), save and load round trip in format 1, previews not saved, remove. An unreadable scene file is kept beside as `.unreadable-<time>` and never overwritten |
| Viewport math | Projection within 0.5 px of a simulated camera, for both kinds of `ProjectPoint` answer (-1..1 with y up, and pixels with y down); nothing behind the camera projects; the picking ray goes through its point; turned and scaled boxes are hit at the right distance; axis drags and turns read back exactly; the camera's heading and pitch round-trip |
| Kinds | `.mesh` and `.ent` known, other files not |
| REDbridge | Starts with the game loaded, over 100,000 files |
| Asset index | Builds in a few seconds: 31,571 meshes and entities on game 2.31, one entry per path though some files are in two archives |
| Search | `cargo crate` gives 19 cargo crate meshes; the first, `cargo_crate_a.mesh`, has bounds and 18 appearances; an entity search returns only entities; nonsense returns nothing |
| Index cache | The newest index loads without knowing the game; a reload keeps the looked-at details |

Run 2026-10-16 on 0.3.3: all passed (REDbridge 0.6.0, 583,798 files, index in 3.4 s).

## By hand, without the game

### Page check in REDnode's host

Runs EDGEbuilder's page in REDnode's overlay host on the dev laptop, with no game. Setup in [dev setup](dev-setup.md) and CLAUDE.md, "Picking this up on another machine":

```powershell
# from <REDnode>\packages\overlay
..\..\node_modules\electron\dist\electron.exe --remote-debugging-port=9223 . --render=cpu "--apps-dir=<REDnode>\packages\overlay\apps;<this repo>" --apps=edgebuilder "--data-dir=<scratch folder>"
```

Drive the page by evaluating scripts through the DevTools protocol on 127.0.0.1:9223, and type with `Input.dispatchKeyEvent` (synthetic `KeyboardEvent`s do not type into fields). Look with the kernel MCP server's `window_image` or `Page.captureScreenshot`. Never a full-screen capture. The host does not grant REDbridge, so the bridge pill says "Allow REDbridge" and the index comes from the saved one.

| Run | Checked | Found and fixed |
|---|---|---|
| 2026-10-13, 0.1.0 | Start, REDbridge in about 6 s, index in about 5 s and from its cache after; search `cargo crate`; pick `cargo_crate_a.mesh` (1.2 x 1.5 x 1.2 m, 18 appearances); drop refused without a game | 0.1.1: a "No game" state instead of "Needs Codeware"; the page no longer overflowed its window; assets in two archives listed once |
| 2026-10-13, 0.2.0 | The page is 1920 x 1080 with the panel at x 1448; the Edit tint; "No camera yet" without a game; Selected fields and Apply; REDbridge through `kernel.bridge()` and the "Allow REDbridge" prompt; `requires` found Codeware | An unreadable scene file was replaced on the next save; now kept beside |
| 2026-10-14, 0.3.0 | The page and the two new Settings switches | |
| 2026-10-16, 0.3.3 | Typing `crate` with real key events lands in the search box and searches (95 results); Drop at click switches Edit on, shows the crosshair and its message, Esc cancels; the help line sits at the bottom centre | |

## In the game

All on the owner's PC (game on `E:`, installed with REDdeck, Vortex purged). Logs to send after each: `red4ext/logs/rednode-mods.log` (the `[edgebuilder]` lines) and `red4ext/logs/rednode-overlay.log`; from 0.3.2 also `red4ext/logs/rednode-<date>.log` when the cursor misbehaves.

### Before any in-game test

| Need | Why |
|---|---|
| REDnode deployed: 0.15.1+ for B1, 0.17+ from B2a, 0.22+ for the cursor lock in 0.3.2 | The world API, `kernel.bridge()` and `requires`, pointer lock |
| Codeware 1.14 or later | REDnode's world support |
| REDbridge 0.6.0 or later, fetched by REDdeck | The asset index and details |
| **REDbridge allowed** for EDGEbuilder (from 0.2.0) | F10, Mod Manager, EDGEbuilder, Permissions, Allowed on. Until then the pill says "Allow REDbridge" |
| EDGEbuilder from the [releases page](https://github.com/Edgemodders/EDGEbuilder/releases), added in REDdeck and deployed with the game closed | REDdeck 0.21.1 and later put a new version in the old one's row |
| Both Settings switches on, unless a step says otherwise | They persist: a test that turns them off leaves them off (this cost a retest on 2026-10-16) |
| A save outdoors, in an open spot | Room to drop and fly |

The Test timer cannot be pressed while Edit is on: REDnode has a tool layer for that now ([REDnode #10](https://github.com/Edgemodders/REDnode/issues/10)), which EDGEbuilder does not use yet; from B2b the steps skip the marks and the log has the times. If V's view gets stuck after EDGEbuilder stopped with Edit on, load a save.

### B1 Browse and drop

Full steps: [B1 test](b1-test.md). **Passed 2026-10-13** with EDGEbuilder 0.1.1, REDdeck 0.20.1, REDnode 0.15.1, REDbridge 0.6.0.

| Step | Expected | Result |
|---|---|---|
| Open, the three pills | World ready, REDbridge, about 31,500 assets | As expected; REDbridge ready 4 s after start, index 2 s later |
| Search `cargo crate`, pick `cargo_crate_a.mesh` | Path, size, 18 appearances | As expected |
| Drop two crates with two appearances | In front of V within about half a second | 357 and 443 ms, "no real noticeable lag" |
| Drop an entity (vending machine) | As in the game | 416 and 418 ms |
| The game's outline on a selected preview | Shows or not | **Shows**: B2 uses the game's highlight |
| Delete | Gone from the world and the list | As expected |
| Load a save, Rebuild previews | Previews gone, then back where they were | All four back in the same second |
| Clear scene | Everything goes | As expected |
| Frame rate | Holds with previews | Game calls about 33 a second, under 1 ms a frame. The 30 to 65 fps flip in interactive mode is the game's, from before EDGEbuilder opened |

### B2a Position

Full steps: [B2a test](b2-test.md). **Passed 2026-10-14** with EDGEbuilder 0.2.0, REDnode 0.17.0, Codeware 1.20.3, REDbridge 0.6.0. "Everything seemed to work fine."

| Step | Expected | Result |
|---|---|---|
| Edit on | A slight tint, help line | As expected |
| The gizmo and box on a crate, walking around it | They stay on the crate | `Viewport check` **0.0 px**; FOV 51, the game's FOV is vertical |
| Drag arrows and the ring, Ctrl snaps | The crate follows; 0.25 m and 15° steps | 14 to 28 moves a second at about 38 fps; trailed "a little bit" (fixed in 0.2.2) |
| Keys G, R, S with axis locks, typed numbers, Esc | As typed; Esc undoes | As expected; S 2 rebuilt the crate at twice the size |
| Ctrl+E | Drops to the ground | Static and PlayerBlocker hit, Terrain missed; down 1.00 m |
| An entity: select in the world, S | Only meshes scale | As expected |
| Selected fields, Apply, Delete, Edit off | As expected | As expected |
| Frame rate while dragging | Holds | The same 38 to 39 fps with and without dragging |

| Found | Fixed in |
|---|---|
| The gizmo stayed after Edit off | 0.2.2 |
| The object trailed the cursor | 0.2.2: moves sent once a frame without waiting |
| A forgotten object from an earlier session | 0.2.1 says so; a failed drop leaves nothing |
| Two EDGEbuilder versions on | REDdeck 0.21.1 |
| Other windows unclickable under Edit | REDnode #7, #10 (since done in REDnode) |

### B2b Camera

Full steps: [B2b test](b2b-test.md). **Passed 2026-10-14** with EDGEbuilder 0.3.0, REDnode host 0.19.0.

| Step | Expected | Result |
|---|---|---|
| Edit on | No jump; the HUD hides; camera keys in the help | As expected |
| Right mouse look, W A S D Q E fly, Shift, wheel speed | The camera flies; V stays put | As expected |
| Drop where I look | Lands where the camera looks, facing it | As expected |
| Middle mouse orbit, Shift pan, wheel dolly, F frame, drag from several angles | All work; the gizmo stays on | As expected; the viewport stayed 0.0 to 0.2 px off through every camera switch |
| Fly 200 m away | The world stays loaded or not | **Stays loaded**: the camera roams freely |
| Edit off and on | V's view and HUD back, then the camera from V's view | As expected |
| Load a save with Edit on | Edit stays on, HUD hidden | **The HUD came back** (fixed in 0.3.1) |
| Settings switches off | Edit works from V's camera, HUD stays | As expected |

| Found | Fixed in |
|---|---|
| The HUD came back after a save loaded with Edit on | 0.3.1: the scene tier is checked every second |
| The cursor kept moving while looking, and the camera stopped over the EDGEbuilder window | 0.3.1 hears moves on the whole page; 0.3.2 locks the cursor (REDnode #11) |
| The help line was wider than the room | 0.3.1 wraps it |
| The cursor vanished now and then | Not found; send the plugin's own log next time |

### B2b retest in 0.3.2

**Passed 2026-10-16** with EDGEbuilder 0.3.2, REDnode 0.24.0.

| Step | Expected | Result |
|---|---|---|
| Load a save with Edit on | The HUD stays hidden; `The game set scene tier 1; hiding the HUD again` once | As expected |
| Right mouse and middle mouse in big sweeps | The cursor vanishes and stays put; the view keeps turning across the EDGEbuilder window; the cursor comes back on release | As expected |
| Esc while holding the right button | The lock ends, Edit stays on | As expected |

| Found | Fixed in |
|---|---|
| First try: the HUD stayed and right mouse did nothing. The log said `Builder mode on: V's camera`: both switches were still off from the B2b test | 0.3.3 says when a switch is off, and the log names the version |
| Switching Hide the game's HUD on with Edit on did nothing | 0.3.3: the switches apply at once |
| The help line under REDnode's launcher | 0.3.3: bottom centre |
| "Type to search" did not search when typing | 0.3.3: typing on the Assets tab searches |
| Empty REDbridge and game folder fields in Settings | 0.3.3 shows `Automatic: ...` |
| Asked for: drop where the next click lands | 0.3.3: Drop at click |

### 0.3.3 check

Not run yet. EDGEbuilder 0.3.3, REDnode 0.22 or later.

| # | Check | Expected |
|---|---|---|
| 1 | Settings | The REDbridge and game folder fields read `Automatic: ...` |
| 2 | With Edit on, Hide the game's HUD off and on; Use EDGEbuilder's own camera off and on; Edit on with a switch off | The HUD comes and goes at once; the view goes to V's eyes, then the camera starts where V looks; the message line says which switch is off |
| 3 | Click the Assets list, type `crate` | It lands in the search box and searches |
| 4 | Pick a crate, Drop at click, click the ground; again, then Esc | The crate lands on the spot, facing the camera; Esc drops nothing |
| 5 | The help lines | Bottom centre, clear of the launcher and the window |
| 6 | The B2b basics: look, fly, orbit, Edit off and on | As in B2b (the camera code was reorganised for the live switches) |
| 7 | The log's start line | `EDGEbuilder 0.3.3 starting` |
