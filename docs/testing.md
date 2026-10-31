---
title: Tests
---

# <span class="y">Tests</span>

Every test run on EDGEbuilder so far: how to run it again, what to expect, and what it showed. Each phase ends with the owner's in-game test on the dev PC. The phase pages ([B1](b1-test.md), [B2a](b2-test.md), [B2b](b2b-test.md)) keep the full steps and every log reading; this page gathers them in one place. New tests are added here when they are first run.

EDGEdeck was called REDdeck up to 0.26.6; this page uses the new name throughout.

Last updated 2026-10-30.

## At a glance

| Test | Kind | Phase | Last run | Result |
|---|---|---|---|---|
| [Type check and build](#type-check-and-build) | Automated | B1 on | 2026-10-31 (0.5.0) | Pass |
| [Smoke test](#smoke-test) | Automated, needs REDbridge and the game files | B1 on | 2026-10-31 (0.5.0) | Pass (the arrange part; the bridge part unchanged since 0.4.0) |
| [Page check in REDnode's host](#page-check-in-rednodes-host) | By hand, no game | B1 on | 2026-10-31 (0.5.0) | Pass |
| [B1 Browse and drop](#b1-browse-and-drop) | In the game | B1 | 2026-10-13 (0.1.1) | Pass |
| [B2a Position](#b2a-position) | In the game | B2a | 2026-10-14 (0.2.0) | Pass |
| [B2b Camera](#b2b-camera) | In the game | B2b | 2026-10-14 (0.3.0) | Pass |
| [B2b retest](#b2b-retest-in-032) | In the game | B2b | 2026-10-16 (0.3.2) | Pass |
| [0.3.4 check on game 2.5](#034-check-on-game-25) | In the game | B2b | 2026-10-29 (0.3.4) | Pass |
| [Bake probe](#bake-probe) | In the game, no EDGEbuilder | Bake probe | 2026-10-30 (REDbridge 0.11.0) | Pass (both rounds) |
| [B2c Mod assets](#b2c-mod-assets) | In the game | B2c | 2026-10-30 (0.4.1) | Pass |
| [B3-1 Arrange](#b3-1-arrange) | In the game | B3 | Built 2026-10-31 (0.5.0) | Waiting for the owner |

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
| 2026-10-30, 0.4.0 | With REDcode's service package beside it (`--apps-dir` also `<REDcode>\extensions\redcode\rednode`, `--apps=edgebuilder,redcode`) and `LOCALAPPDATA` pointed at a scratch folder with a stand-in `REDcode\project.json`: the five mod archives on the dev PC read (17 meshes and entities); `chicken` finds EvilClown's `kratoes_rubber_chicken` mesh and entity first, tagged EvilClown, the archive in the tooltip; the Project tab lists the stand-in project's files, a file added to it shows up within 2 s, picking one explains that its size comes later and Drop stays on; the project closed: "No REDcode project open". Electron must start without `ELECTRON_RUN_AS_NODE` (VS Code's terminals set it) | |
| 2026-10-31, 0.5.0 | With a working scene of four objects and a group written beforehand (no game, so no previews): the Scene list as a tree, the group's row selects its two objects and shows its name in Group name; Ctrl+click adds the barrel ("3 objects", Turn by and Scale by); Group nests the old group in Group 1; rename; Undo twice and Redo once step through the changes and their counts; the group's arrow closes it; Apply with X 12 and Turn by 90 moves the group's middle and turns it around it (the barrel at 12, 2); Clear scene, then Ctrl+Z from the keyboard brings the four back. Drops, the gizmo, the box and Duplicate need the game | The five arrange buttons wrap onto two rows and the window scrolls: left as is |

## In the game

All on the owner's PC (game on `E:`, installed with EDGEdeck, Vortex purged). Logs to send after each: `red4ext/logs/rednode-mods.log` (the `[edgebuilder]` lines) and `red4ext/logs/rednode-overlay.log`; from 0.3.2 also `red4ext/logs/rednode-<date>.log` when the cursor misbehaves.

### Before any in-game test

| Need | Why |
|---|---|
| REDnode deployed: 0.15.1+ for B1, 0.17+ from B2a, 0.22+ for the cursor lock in 0.3.2 | The world API, `kernel.bridge()` and `requires`, pointer lock |
| Codeware 1.14 or later | REDnode's world support |
| REDbridge 0.6.0 or later, fetched by EDGEdeck or by REDnode's Mod Manager (**Get REDbridge**, REDnode 0.25.0 and later) | The asset index and details |
| **REDbridge allowed** for EDGEbuilder (from 0.2.0) | F10, Mod Manager, EDGEbuilder, Permissions, Allowed on. Until then the pill says "Allow REDbridge" |
| EDGEbuilder's zip, added in EDGEdeck and deployed with the game closed | EDGEdeck 0.21.1 and later put a new version in the old one's row. A version under test comes from the release workflow's artifact (Actions, Release, the run, `edgebuilder-build`) or `npm run package`; it gets a GitHub release on the [releases page](https://github.com/Edgemodders/EDGEbuilder/releases) once its test passed |
| Both Settings switches on, unless a step says otherwise | They persist: a test that turns them off leaves them off (this cost a retest on 2026-10-16) |
| A save outdoors, in an open spot | Room to drop and fly |
| From 0.4.0: **Solo allowed** for EDGEbuilder | F10, Mod Manager, EDGEbuilder, Permissions. Without it other windows stay while editing and the message line says so once |

The Test timer cannot be pressed while Edit is on: REDnode has a tool layer for that now ([REDnode #10](https://github.com/Edgemodders/REDnode/issues/10)), which EDGEbuilder does not use yet; from B2b the steps skip the marks and the log has the times. If V's view gets stuck after EDGEbuilder stopped with Edit on, load a save.

### B1 Browse and drop

Full steps: [B1 test](b1-test.md). **Passed 2026-10-13** with EDGEbuilder 0.1.1, EDGEdeck 0.20.1, REDnode 0.15.1, REDbridge 0.6.0.

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
| Two EDGEbuilder versions on | EDGEdeck 0.21.1 |
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

### 0.3.4 check on game 2.5

**Passed on 2026-10-29**, on game 2.5 with REDnode 0.45.0: every step as expected (the owner's report). The first EDGEbuilder run on 2.5. EDGEbuilder 0.3.4 (0.3.3's changes, and it finds the REDbridge EDGEdeck fetched), EDGEdeck 0.27.0 or later with Get REDbridge done (REDbridge 0.10.0 or later; 0.11.0 for 2.5's sectors), **REDnode 0.41.0 or later on game 2.5** (REDnode 0.38.1 and later load only on 2.5). Every earlier test ran on 2.31, so steps 8 to 11 repeat the basics on 2.5. EDGEbuilder 0.3.4 came from the release workflow's artifact, and is released after this pass.

| # | Check | Expected |
|---|---|---|
| 1 | Settings | The REDbridge and game folder fields read `Automatic: ...`; the REDbridge one is under `globalStorage\edgemodders.edgedeck` |
| 2 | With Edit on, Hide the game's HUD off and on; Use EDGEbuilder's own camera off and on; Edit on with a switch off | The HUD comes and goes at once; the view goes to V's eyes, then the camera starts where V looks; the message line says which switch is off |
| 3 | Click the Assets list, type `crate` | It lands in the search box and searches |
| 4 | Pick a crate, Drop at click, click the ground; again, then Esc | The crate lands on the spot, facing the camera; Esc drops nothing |
| 5 | The help lines | Bottom centre, clear of the launcher and the window |
| 6 | The B2b basics: look, fly, orbit, Edit off and on | As in B2b (the camera code was reorganised for the live switches) |
| 7 | The log's start line | `EDGEbuilder 0.3.4 starting` |
| 8 | 2.5: Drop in front of me, a crate (`cargo_crate_a.mesh`) and an entity (a vending machine) | Both appear within about half a second; the crate is EDGEbuilder's empty entity with a mesh, so this checks that entity on 2.5 |
| 9 | 2.5: select the crate, drag an arrow and the ring, S 2 | The gizmo stays on the crate; it follows; it is rebuilt at twice the size |
| 10 | 2.5: Ctrl+E on a crate lifted off the ground | It drops to the ground; the log's `Drop to floor` line says which collision groups hit |
| 11 | 2.5: fly 200 m away and back | The world stays loaded, the previews are still there |

### Bake probe

**Passed on 2026-10-30**, both rounds (results below). The first baked sector in the game: one crate, baked by REDbridge's `sector.build` from a script, packed by REDbridge's `project.pack`, deployed by EDGEdeck. EDGEbuilder is not involved, so it stays off for the whole test.

How it was made: `npm run build`, then `node scripts/bake-probe.mjs <out folder>` with REDbridge 0.11.0 (the one built in the REDbridge checkout; EDGEdeck had fetched 0.10.0, which writes 2.31 sectors). It writes `<out>/project`, the REDcode project the bake goes into, and `<out>/mod` with `archive\pc\mod\edgebuilder_bake_probe.archive` and `edgebuilder_bake_probe.archive.xl`. The crate is `cargo_crate_a.mesh` at (-1439.15, 1214.04, 23.07), not turned, scale 1: 2 m east of a crate dropped on a Watson street in B2b's test. The streaming box reaches 100 m around it.

One change by hand: REDbridge 0.11.0 writes the `.xl` as a resource patch of the world's streaming block. ArchiveXL 1.28 adds blocks to the world under `streaming: blocks:` (its WorldStreaming part), so the script writes that instead:

```yaml
streaming:
  blocks:
    - edgebuilder\edgebuilder_bake_probe\edgebuilder_bake_probe.streamingblock
```

| # | Check | Expected |
|---|---|---|
| 1 | Game closed; in EDGEdeck, `EDGEbuilder bake probe` on, deploy | Two files in `archive\pc\mod` |
| 2 | Turn EDGEbuilder off in REDnode's Mod Manager (or leave the game's REDnode overlay closed), start the game, load a save | Loads as usual |
| 3 | Go to (-1439, 1214, 23): beside the spot of the Watson street crate from B2b's test | One cargo crate stands there, on the ground, not turned |
| 4 | Walk 150 m away and come back | It goes and comes back with the street |
| 5 | Walk into it, shoot it | Whether it has collision (a mesh node may not: this is to learn, not a fail) |
| 6 | `red4ext/plugins/ArchiveXL/ArchiveXL-<date>.log` | `[WorldStreaming] Merging streaming block "edgebuilder\...\edgebuilder_bake_probe.streamingblock"...` and `All streaming blocks merged`, no errors |
| 7 | Afterwards: the mod off in EDGEdeck and deploy, or leave it for the next bakes | |

**Round 1 results (2026-10-30, the owner's report):** steps 1 to 7 as expected. ArchiveXL 1.28.6 loaded `edgebuilder_bake_probe.archive.xl` and logged `[ResourcePatch] Merging streaming block "edgebuilder\edgebuilder_bake_probe\edgebuilder_bake_probe.streamingblock"...` and `All streaming blocks merged`, no errors: **a baked sector loads in game 2.5.**

| Seen | Why |
|---|---|
| The crate goes when V walks away while people and cars stay, and comes back on the way in | The bake gives a node a streaming distance from its size: `max(40, 11 x size)`, so 40 m for a crate. The game's own crates in the sectors around it stream at 20 to 60 m (`delivery_crate_*` as instanced destructible meshes, `crate_small.ent` at 50 m); trash at 8 to 15 m. People and vehicles are spawned by other systems. Normal for a small prop; a scene can set a longer one per object (`streaming.primary`) |
| No collision: V walks through it | The bake writes a mesh as `worldMeshNode`, which only draws. The mesh has collision data (`meshMeshParamPhysics`), but the game's solid props come as other node types: instanced destructible meshes (4,550 in the 12 nearest finest-level sectors), entity nodes, or separate cooked collision nodes. Only 92 plain mesh nodes there |

**Round 2** (baked and passed the same day): the same mod, three objects in a row going west, 2 m apart, all on the ground at y 1214, z 23:

| Object | Where | Tests |
|---|---|---|
| `crate`: `cargo_crate_a.mesh`, as in round 1 | x -1439 | The reference |
| `crate_far`: the same mesh, `streaming: { primary: 120, secondary: 96 }` | x -1441 | That a scene's own streaming distance reaches the game |
| `crate_entity`: `base\gameplay\devices\disposal\appearances\crate_red.ent` (an `entMeshComponent` and an `entPhysicalMeshComponent`) | x -1443 | The bake's entity node, and collision through an entity |

| # | Check | Expected |
|---|---|---|
| 1 | Game closed; deploy in EDGEdeck (the library entry was replaced with round 2) | The two files replaced |
| 2 | Teleport as in round 1, look west | Three crates in a row: two alike, then a red one |
| 3 | Walk into each; shoot each | The two mesh crates: no collision. The red one: solid (it may be pushed or fall over: `entPhysicalMeshComponent` can be dynamic) |
| 4 | Walk east along the street, looking back, to about 150 m, then back | `crate` goes at about 40 m, `crate_far` stays to about 120 m, the red one goes when its entity streams out. Rough distances are enough |
| 5 | The ArchiveXL log | As in round 1 |

**Round 2 results (2026-10-30, the owner's report):** every step as written. The ArchiveXL log is as in round 1. So:

| Question | Answer |
|---|---|
| Does a scene's `streaming` reach the game? | Yes: `crate_far` stayed to about 120 m while `crate` went at about 40 m |
| Does `sector.build`'s entity node work? | Yes: `crate_red.ent` stands as a `worldEntityNode` |
| Collision | Through an entity with an `entPhysicalMeshComponent`: solid. A `worldMeshNode`: none. Solid meshes need another node type; see the design's Bake section |

### B2c Mod assets

**Passed on 2026-10-30**: 0.4.0 passed steps 1 to 8, step 9 found a fix, and 0.4.1 passed the retest (results below the steps). EDGEbuilder 0.4.0, from `npm run package`, added in EDGEdeck (it goes into the old row). REDnode 0.41.0 or later; **REDbridge with #12** (0.12.0, or the build from REDbridge's main the REDnode session deployed on 2026-10-30) for sizes and appearances; REDcode 0.10.5 or later for the Project steps. The smoke test passed with both REDbridge 0.11.0 (sizes skipped, the "needs 0.12.0" answer) and the main build (EvilClown's meshes read from its archive). Browse lists installed mods' and the open REDcode project's meshes and entities; mesh previews are now REDnode's mesh props, so steps 1 and 2 repeat the basics.

| # | Check | Expected |
|---|---|---|
| 1 | The log's start line, then a few seconds later | `EDGEbuilder 0.4.0 starting`; `Mods: 17 meshes and entities in 5 archives` (the dev PC's mods: EvilClown, EDGEmatA, SkippySkippy, `zzz_rednode_box`, the bake probe) |
| 2 | The basics with the new mesh previews: drop `cargo_crate_a.mesh`, select it, drag an arrow, S 2, Ctrl+E | As in 0.3.4: it appears in about half a second with the outline, follows the gizmo, comes back twice the size, drops to the ground |
| 3 | Assets: the Mods tab; then Everywhere and type `chicken` | Mods lists the mods' files with their mod's name; `kratoes_rubber_chicken` (mesh and entity) first, tagged EvilClown. `cardboard_box_a_closed` says `zzz_rednode_box changes a game file` |
| 4 | Pick `kratoes_rubber_chicken.mesh` | Its size, about 0.1 x 0.1 x 0.6 m, and its appearance `default` |
| 5 | Drop it, and the `.ent` beside it | Both appear (a rubber chicken). The mesh's gizmo and outline box fit the chicken. The `.ent` has no size (its meshes are in its appearance file, as for many game entities): the message says the gizmo uses a 1 m box |
| 6 | The Scene tab | "This scene needs: EvilClown" |
| 7 | Edit on with another package's window open (the coords app, for example); Edit off | The other window goes while Edit is on and comes back; the Test timer and the launcher stay. Without Solo allowed: they stay and the message line says how to allow it |
| 8 | With REDcode open on a project that has a mesh or entity under `source\archive` (EDGEfab's first prop when it exists): the Project tab, pick a mesh | Its files, tagged `project <name>`; the picked mesh's size and appearances. Save a new mesh into it: it appears within a few seconds. Close the project in REDcode: "No REDcode project open" |
| 9 | Drop the project's file before packing; then REDcode's Pack and Play | Before: the message says the game shows it once packed and loaded. After Pack and Play: it shows; the log has `<id> spawned again after an archive swap` for a preview that uses a swapped file, and a selected one stays selected |

**Results with 0.4.0 (2026-10-30, the owner's report):**

| # | Result |
|---|---|
| 1 to 7 | As expected: the mods indexed, the rubber chicken found, sized and dropped, "This scene needs: EvilClown", solo mode with Edit |
| 8 | As expected, with REDcode on the project `EDGEwave_Katana` (a copy of the game's `w_katana__common__grip1_02.mesh` at its game path). At first "0 found" on the Project tab: the Entities tab was on and the project has only a mesh. **0.4.1:** the count names its filters (`0 found, entities only, in the project`) |
| 9 | The grip dropped before packing showed at once: the game has a file at that path. **0.4.1:** the message says so for a project file at a game file's path (asked of REDbridge, since the index does not cover weapons). After Pack and Play the grip came back and stayed selected, but at its drop spot and heading: it had been moved and turned since, and REDnode spawns again with the first spawn's options ([REDnode #27](https://github.com/Edgemodders/REDnode/issues/27)). **0.4.1:** EDGEbuilder moves a respawned preview to its scene transform |

**Retest in 0.4.1:** step 9 again (drop the grip, move and turn it, select it, Pack and Play: it stays where it was, selected, and the log has `spawned again after an archive swap`), and the two messages: the Project tab with Entities on, and the drop message for the grip.

**Retest with 0.4.1 (2026-10-30, the owner's report): passed.** The grip, moved and turned, stayed where it was and selected after Pack and Play; the Project tab with Entities on and the drop message read as written. The owner asked for a shorter count: `1 mesh found`, `4 entities found`, without the tab's own name; that wording comes after 0.4.1.

### B3-1 Arrange

**Built on 2026-10-31, waiting for the owner's test.** EDGEbuilder 0.5.0, from `npm run package`, added in EDGEdeck. REDnode 0.41.0 or later. B3's first half: several objects at once, groups, duplicates, undo and redo ([design](design.md), B3). Saved scenes, the Library and the service are B3-2. Start somewhere open with Edit on.

| # | Check | Expected |
|---|---|---|
| 1 | The log's start line | `EDGEbuilder 0.5.0 starting` |
| 2 | Drop `cargo_crate_a.mesh` three times, a few metres apart (Drop at click). Click one, then Ctrl+click the other two | Each click adds one: three outlined, three boxes, one gizmo at their middle. The Scene tab says "3 selected", the Selected panel "3 objects" and their middle. A plain click on one selects it alone; a click on empty ground selects nothing |
| 3 | Shift+drag a box around all three | A dashed yellow box while dragging; on release all three are selected. Shift+drag around nothing selects nothing |
| 4 | Drag an arrow, then the ring; then G, R, S with X, Y or Z and a typed number; Esc once in the middle of one | They move together, turn together around their middle (the outer ones swing round), and S spreads them and makes them bigger. Esc puts them back |
| 5 | Ctrl+G | "Grouped 3 objects as Group 1". The Scene list shows Group 1 with the crates under it. Click one crate in the world: all three are selected. Alt+click one: only that one |
| 6 | Rename the group in Group name, Enter; close and open it with its arrow | The new name in the list; the arrow folds the crates away and back |
| 7 | With the group selected, Ctrl+D; move the mouse; click | Three copies appear on top of the originals and follow the mouse; the click places them. The Scene list has a second group with the same name and three new crates (`cargo_crate_a_4` and on) |
| 8 | Ctrl+D again, then Esc | The copies follow the mouse, then go away; the scene is as before |
| 9 | Ctrl+Z several times, then Ctrl+Y | Each Ctrl+Z takes one step back: the copies' place, the copies, the name, the group, the moves, the drops. Each Ctrl+Y does it again. The message says what came back or went; Undo and Redo on the Scene tab show how many steps are left |
| 10 | Select a group and a crate outside it, Delete; Ctrl+Z | All selected go; Ctrl+Z brings them back, in their group and where they were |
| 11 | Clear scene; Ctrl+Z | All gone; all back |
| 12 | Ctrl+Shift+G on a group | The group opens: its crates stay where they are and are on their own in the list |
| 13 | Make a group, then load a save (or restart the game) and Rebuild previews | The objects and the group come back; a click on one selects the group |

