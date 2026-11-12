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
| [Type check and build](#type-check-and-build) | Automated | B1 on | 2026-11-03 (0.6.0) | Pass |
| [Smoke test](#smoke-test) | Automated, needs REDbridge and the game files | B1 on | 2026-11-03 (0.6.0) | Pass (the scenes and Library part; the bridge part unchanged since 0.4.0) |
| [Page check in REDnode's host](#page-check-in-rednodes-host) | By hand, no game | B1 on | 2026-11-03 (0.6.0) | Pass |
| [B1 Browse and drop](#b1-browse-and-drop) | In the game | B1 | 2026-10-13 (0.1.1) | Pass |
| [B2a Position](#b2a-position) | In the game | B2a | 2026-10-14 (0.2.0) | Pass |
| [B2b Camera](#b2b-camera) | In the game | B2b | 2026-10-14 (0.3.0) | Pass |
| [B2b retest](#b2b-retest-in-032) | In the game | B2b | 2026-10-16 (0.3.2) | Pass |
| [0.3.4 check on game 2.5](#034-check-on-game-25) | In the game | B2b | 2026-10-29 (0.3.4) | Pass |
| [Bake probe](#bake-probe) | In the game, no EDGEbuilder | Bake probe | 2026-10-30 (REDbridge 0.11.0) | Pass (both rounds) |
| [B2c Mod assets](#b2c-mod-assets) | In the game | B2c | 2026-10-30 (0.4.1) | Pass |
| [B3-1 Arrange](#b3-1-arrange) | In the game | B3 | 2026-11-02 (0.5.8) | Pass (0.5.0 to 0.5.7 found and fixed: modifier keys, Esc, far-away previews, a busy bar, the Scene tab after a drop, copy, cut and paste) |
| [B3-2 Save](#b3-2-save) | In the game | B3 | 2026-11-04 (0.6.2) | Pass, but for step 19, which waits for REDnode #41; Close, steps 24 to 27, passed on 0.6.4; steps 19 and 28 to 31 passed on 0.6.5; 32 to 34 passed on 0.6.7; released as 0.6.7 |
| [B4 Bake](#b4-bake) | In the game | B4 | | Round 3, the solid probe, passed on 2026-11-05: a Kinematic instanced destructible mesh is solid; `worldCollisionNode` boxes as written did nothing. **B4-1, the Bake tab, passed in game on 2026-11-05 on 0.7.1**, all 16 steps; released as 0.7.3. **B4-2, the Solid switch, passed in game on 2026-11-08** on 0.8.0 and 0.8.1, all 22 steps; Seen from reaches its distance with REDbridge 0.12.1 |

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

**Round 3** (2026-11-05): moved to [B4 Bake](#b4-bake), where each crate answers a named question.

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

**0.5.0 tested on 2026-11-01: step 2 failed**, Ctrl+click selected only the clicked object. In the game REDnode passes Ctrl, Shift and Alt as keys but not on mouse events, so a click never says Ctrl is held (Shift+drag and Alt+click the same). **0.5.1** keeps those keys from the key events the page hears; REDnode #33 asks for them on mouse events. REDnode also keeps Ctrl+Z and Ctrl+Y for text fields, so step 9 uses the **Undo and Redo buttons** on the Scene tab until #33 is done. **0.5.1 tested on 2026-11-01, to step 9.** Ctrl+click adds (step 2 passed). Found:

| Finding | Cause | Done |
|---|---|---|
| A click on one crate of a group selected that crate, not the group (step 5) | Most likely Alt held in the page's eyes: after Alt+Tab the page hears Alt go down but never come up, so every click was an Alt+click | 0.5.2 forgets held keys on Alt+Tab and when interactive mode ends |
| Ctrl+D, move, Esc: REDnode closed and gave the game back; a right-click cancelled as meant (step 8) | REDnode takes Esc to leave interactive mode; a page never hears it | 0.5.2: a right-click cancels a drag, a Drop at click, a box and a copy, and the help says so; [REDnode #34](https://github.com/Edgemodders/REDnode/issues/34) asks for Esc |
| Ctrl+Z after typing a scale undid the number in the field, not the crate's scale; Ctrl+Z after a move did nothing (step 9) | REDnode keeps Ctrl+Z for text fields ([REDnode #33](https://github.com/Edgemodders/REDnode/issues/33)), as noted for 0.5.1 | The Undo and Redo buttons until #33 |

**0.5.3** uses REDnode 0.52.0 (#33 and #34 built there on 2026-11-02, waiting for their own in-game test): mouse events carry Ctrl, Shift and Alt (EDGEbuilder trusts them once one shows, and keeps its own tracking only for an older REDnode), Ctrl+Z and Ctrl+Y reach the page, and the page asks for Esc (Keyboard Lock) only while a drag, a Drop at click, a box or a copy is in progress; otherwise Esc leaves interactive mode as usual. Enter in a Selected field now leaves the field, so Ctrl+Z after it undoes the change. **0.5.3 in REDnode's keys test (REDnode 0.52.1, 2026-11-02, [REDnode's testing page](https://edgemodders.github.io/REDnode/testing.html#keys-and-modifiers-33-34)): passed** Ctrl+click adds (step 2), Shift+drag box-selects (3), Alt+click picks one object out of a group (5), Esc during a duplicate's move takes the copies back and the overlay stays, and Esc with nothing in progress leaves interactive mode (8); the host logged `edgebuilder: takes Esc` and `gives Esc back`. Steps 4, 6 and 7 passed with 0.5.1 and are unchanged since. **Left for the owner, with 0.5.3: step 5's plain click on a grouped crate selecting the group (the 0.5.1 finding), 9 with the typed scale, 10 to 13.** **0.5.3 tested on 2026-11-02 (the left steps).** Steps 5, 9 and 10 passed. Step 11: after Clear scene, Ctrl+Z seemed to do nothing, then Drop at click placed nothing, and a minute or two later all the crates showed up. Step 13: after a save loaded, Rebuild previews seemed to do nothing. Cause, from the log: the working scene held 9 objects from earlier sessions about 4 km away; the game never streams those in, so each spawn waited its 10 s, one after another, and every change behind them in the queue (the drops, the further Ctrl+Z presses, a second Rebuild) waited too; the further Ctrl+Z presses then undid the whole session. **0.5.4** places previews only within 300 m of V or the editor camera, says how many are far away, and logs each Undo and Redo. A spawn that times out leaves an untracked entity in the game: [REDnode #35](https://github.com/Edgemodders/REDnode/issues/35). **Retest on 2026-11-02: steps 11, 12 and 13 passed as written, but on 0.5.3** (0.5.4 was in EDGEdeck, not deployed; the log says `EDGEbuilder 0.5.3 starting`). Deleting leftover objects lagged again: a second Rebuild previews spent 80 s on the far objects and the delete waited behind it. The owner asked for a sign that EDGEbuilder is busy, since clicks made meanwhile wait without a word. **0.5.5** adds a busy bar (in the window, and at the top of the view in Edit) once a change runs for half a second: what, how far, how long, how many wait; and Stop. **0.5.5** was deployed; the owner found the Selected panel stayed out of sight after Drop at click (the page stayed on the Assets tab). **0.5.6** shows the Scene tab after a drop, as a click does. The owner then asked for copy and paste: Ctrl+C copies the selection, Ctrl+V pastes it where the cursor points, as Drop at click places. **0.5.7** (0.5.6 was not deployed) has both. **Step 14 passed on 0.5.5 (2026-11-02):** the busy indicator showed while a change ran. **Steps 15 and 16 passed on 0.5.7 (2026-11-02).** The owner asked for Ctrl+X as well: **0.5.8** cuts (copies, then deletes). **Step 17 passed on 0.5.8 (2026-11-02). B3-1 passed in game: every step, 1 to 17; 0.5.8 released.** Built on 2026-10-31 as EDGEbuilder 0.5.0, from `npm run package`, added in EDGEdeck. REDnode 0.41.0 or later. B3's first half: several objects at once, groups, duplicates, undo and redo ([design](design.md), B3). Saved scenes, the Library and the service are B3-2. Start somewhere open with Edit on.

| # | Check | Expected |
|---|---|---|
| 1 | The log's start line | `EDGEbuilder 0.5.4 starting`, REDnode 0.52.0 or later |
| 2 | Drop `cargo_crate_a.mesh` three times, a few metres apart (Drop at click). Click one, then Ctrl+click the other two | Each click adds one: three outlined, three boxes, one gizmo at their middle. The Scene tab says "3 selected", the Selected panel "3 objects" and their middle. A plain click on one selects it alone; a click on empty ground selects nothing |
| 3 | Shift+drag a box around all three | A dashed yellow box while dragging; on release all three are selected. Shift+drag around nothing selects nothing |
| 4 | Drag an arrow, then the ring; then G, R, S with X, Y or Z and a typed number; Esc once in the middle of one, a right-click in another | They move together, turn together around their middle (the outer ones swing round), and S spreads them and makes them bigger. Esc and the right-click put them back |
| 5 | Ctrl+G | "Grouped 3 objects as Group 1". The Scene list shows Group 1 with the crates under it. Click one crate in the world: all three are selected. Alt+click one: only that one |
| 6 | Rename the group in Group name, Enter; close and open it with its arrow | The new name in the list; the arrow folds the crates away and back |
| 7 | With the group selected, Ctrl+D; move the mouse; click | Three copies appear on top of the originals and follow the mouse; the click places them. The Scene list has a second group with the same name and three new crates (`cargo_crate_a_4` and on) |
| 8 | Ctrl+D again, then Esc; Ctrl+D, then a right-click; then Esc with nothing in progress | The copies follow the mouse, then go away, both times; the scene is as before and REDnode stays interactive. The last Esc leaves interactive mode as usual |
| 9 | Ctrl+Z several times, then Ctrl+Y; then the Undo and Redo buttons. Also: type a scale in the Selected panel, Enter, Ctrl+Z | Each Ctrl+Z (or Undo) takes one step back: the copies' place, the copies, the name, the group, the moves, the drops. Each Ctrl+Y (or Redo) does it again. The typed scale: Ctrl+Z puts the crate's size back. The message says what came back or went; Undo and Redo on the Scene tab show how many steps are left |
| 10 | Select a group and a crate outside it, Delete; Ctrl+Z | All selected go; Undo brings them back, in their group and where they were |
| 11 | Clear scene; Ctrl+Z | All gone; all back |
| 12 | Ctrl+Shift+G on a group | The group opens: its crates stay where they are and are on their own in the list |
| 13 | Make a group, then load a save (or restart the game) and Rebuild previews | The objects and the group come back; a click on one selects the group |
| 14 | 0.5.5: with objects far away in the scene (over 300 m), Rebuild previews; then near ones only, Rebuild previews with a dozen near objects removed from the world (load a save first), and click Delete or Drop while it runs; Stop | The far ones are skipped at once ("N far away"). For a change over half a second the bar shows "Busy: Rebuild previews: 3 of 12 · 2 s", at the top of the view in Edit too, and "1 more waiting" after the click; the click's change runs when it ends. Stop ends the placing: the message counts the rest as not placed |
| 15 | 0.5.7: on the Assets tab, Drop at click, then Drop where I look | After each drop the Scene tab shows, with the new object in the Selected panel |
| 16 | 0.5.7: select a group, Ctrl+C; point at the ground somewhere else, Ctrl+V; point elsewhere, Ctrl+V again; delete the originals, Ctrl+V once more; Ctrl+Z | "Copied N objects". Each Ctrl+V puts a copy of the group standing on the ground under the cursor, selected, the Scene tab showing it as a new group with the same name; the last works with the originals gone. Ctrl+Z takes the last paste back. With the cursor over the EDGEbuilder window, Ctrl+V pastes where the camera looks |
| 17 | 0.5.8: select a group, Ctrl+X; Ctrl+V somewhere else; Ctrl+Z twice | "Cut N objects": the group goes. Ctrl+V pastes it under the cursor. The first Ctrl+Z takes the paste back, the second brings the cut group back where it was |

### B3-2 Save

**Tested on 0.6.0 on 2026-11-04, findings so far.** Steps 14 and 15 passed (a scene made in the project showed in the Library tab and in the project; `scenes()` and `refs()` ran from Claude Code without asking). Found:

| Finding | Cause | State |
|---|---|---|
| Double-clicking a scene did not open it | The first click's `select` rebuilds the rows, so the browser never fires `dblclick` (2 clicks, 0 `dblclick` events, with real mouse events in REDnode's host; the first host check posted messages and missed it) | 0.6.1: two clicks on one row within 500 ms open it. Checked in the host |
| A save loaded and the open scene's crates did not come back | As built: a message asked for Rebuild previews, while shown scenes came back by themselves | 0.6.1: previews within 300 m come back by themselves 2 s after the save is in, far ones still wait for a Rebuild near them. Any earlier preview still standing is removed first, since OnGameAttached came twice at a game start, 14 s apart. Not checked outside the game |
| Step 10: Yard was not shown after the restart (`0 other scenes on`) | Yard's crate left within a second of each Show (18:17:21, 18:19:21) and the session then listed nothing. The only route without an Open is a second press on the button, which logged nothing. One click held in the host, where no world is loaded | Open. 0.6.1 takes a double-click on the button as one press and logs `No longer showing <file>`: retest |
| Step 11 made an empty scene | The log says New scene, not Save as: **New scene here** was pressed, with the name Ctrl+Shift+S fills in. No objects lost | 0.6.2: after Save as only **Save open scene here** is offered. Checked in the host |

The owner reports the other steps done on 0.6.0. Step 13 passed on 0.6.0: with the camera far off, Show in world on Market Corner answered at once (a brief busy bar; the log's `Showing market_corner.scene.json: 25 objects` at 18:54:19), and the crates appeared as the camera got near. That press stayed shown (`session.json` still lists the scene), so one press does hold in game, which points to a second press in step 10's two quick hides. Asked for at the same test: an **Objects** drawer, built as 0.6.2 (steps 17 to 22). Checked in REDnode's host with real mouse events on 2026-11-04: the drawer, the confirm row, a delete from the open scene and from one not open, two clicks opening a scene, Save as. Not checkable there, since no world is loaded: the flight, the outline, previews.

**On 0.6.2 (2026-11-04).** **Step 10, the gate, passed:** the restart logged `scene Yard (...)`, `1 other scene on`; with a save loaded near both, Yard's crate and Market Corner's near crates were in the world with no press. **Step 23 passed** the same way (`Yard: 1 of 1 object back in the world`, no crate twice, though the game sent OnGameAttached three times). **Step 19 found a limit:** the camera flew to a crate about 320 m from V as asked, but its preview and those near it did not appear, and there was no gizmo. The log: `the entity was created but not in the world after 10000 ms`. The game's dynamic entity system brings an entity in only near V, wherever the camera is. Codeware's `DynamicEntitySpec` has `alwaysSpawned`, which REDnode's `world.spawn` does not set: [REDnode #41](https://github.com/Edgemodders/REDnode/issues/41) asks for it (untried). The gizmo needs a preview, so the message in 0.6.2, "You can still move it", was wrong: 0.6.3 says the Selected panel's numbers still work.

**Retest on 0.6.2 passed (2026-11-04, the owner's report):** steps 9, 11, 17, 18, 20, 21 and 22, every one as written. **B3-2 passed in game on 0.6.2, but for step 19**, which waits for REDnode #41. 0.6.3 only changes the message for a preview the game did not place. The owner then asked for a **Close** button, which returns a scene to the unopened state: built as 0.6.4 (steps 24 to 27). **Steps 24, 25 and 27 passed in game on 2026-11-04** (the log has the Closes, the refusals and a new scene with nothing open). **Step 26 passed** after a full restart: the log says `no scene open` at 19:47:12, and no scene was open.

**REDnode #41 shipped in REDnode 0.58.0** and passed its own test on 2026-11-04: `alwaysSpawned` brought objects in at 300 m, 1 km and 4 km within 0.1 s, and 200 boxes spawned at about 46 ms each with the frame rate steady. **0.6.5** spawns every preview, shown scene and the editor camera with it, and drops the 300 m limit, so an open scene's objects are all in the world wherever V is. It needs REDnode 0.58.0. Retest: 19 and 28 to 31. The steps above that mention "far away" describe the builds before it.

**Retest on 0.6.5 (2026-11-04), the owner's report: passed.** The log agrees: `Opened Market Corner copy 2: 25 of 25 objects in the world`, no preview refused, Show and Hide far off, and after a save `25 of 25 objects back`. **Step 29 left one question:** Drop at click and Drop to floor found nothing, but the crates were at z 356 to 358, about 240 m above Market Corner's crates, past Drop to floor's 100 m reach. A check at ground level answered it: **the ground is solid near the camera, not only near V.** The same crate, about 320 m from where V stood, from the same height z 116.30: with the camera far off, all three surfaces missed (20:41:51); with the camera beside it, Static hit 115.81 and it dropped 0.45 m (20:42:12). V was not moved between them, as far as the test went. **0.6.6** says so in Drop to floor's message and looks 1000 m for a surface, where Drop to floor looked 100 m and Drop at click 200 m. Retest: 32 and 33.

**0.6.6 at a game start (2026-11-05, read from the log; the game was started twice with a scene open).** Both times the log says `0 of 25 objects back in the world; 25 the game did not place`, 25 lines of `V is not in the world yet`, and about 20 s later `25 of 25 objects back`. The first OnGameAttached of a game start comes during the load: REDnode's `world.available()` is already true, so the spawn works, but `FindEntityByID` afterwards refuses, and the game takes those entities away 7 s later. No crate was doubled: 50 attaches and 25 detaches. A false warning, from 0.6.5, which removed the check that stopped this; those builds' restarts had no scene open, so the test did not see it. **0.6.7** waits for `game.state().world`. Retest on 0.6.7: 32, 33, 34.

**Retest on 0.6.7 (2026-11-05, game 2.5, REDnode 0.58.0), the owner's report: passed, and B3-2 Save with it.** The log agrees.

| Step | Result | The log |
|---|---|---|
| 32 | Pass for what it tried. Flown far off, but with the floating crates still in sight, Drop to floor put all three on the ground, seen from close by. It found the ground, so the "fly closer" message did not show, and that message has not been seen in game | `Static: 79.12` at 02:47:17 and 02:48:24; `Dropped 3 objects to the floor` |
| 33 | Drop at click from high in the sky placed the crate on the ground, so Drop to floor had nothing left to do | `Dropped cargo_crate_a.mesh in 172 ms` at 02:49:55, with no `nothing there` line |
| 34 | Pass. After a full restart the open scene came back intact | `26 of 26 objects back in the world` at 02:52:43, after two OnGameAttached, with no `0 of` and no `Back ...` lines |

The same drop from the sky missed on 0.6.5 with a reach of 200 m, so that miss was the reach, and 1000 m cures it. The miss beside the crate at 20:41:51 on 0.6.5 was another matter: the ground 0.5 m below was not solid from where the camera was. How far from the camera the ground is solid is still not measured (the log does not say where the camera was).

Built on 2026-11-03 as EDGEbuilder 0.6.0 (`npm run package`, added in EDGEdeck). Needs REDnode 0.56.1 or later (scenes that are shown use `world.load` with `wait: false`). Named scenes saved after every change, in the Library, the open REDcode project or This PC; the Library tab; the last scene reopened at start; other scenes shown beside the open one; EDGEbuilder's service; the page on any screen width ([design](design.md#scenes-and-the-library-b3-2)). Checked before the game in REDnode's host on 2026-11-03: the tab, the folders, New, Save as, Rename, Open, the refusals (a name taken, a folder outside the Library), `scenes()` and `refs()` through the MCP server, and the page at 2580 x 1080. Start somewhere open with Edit on.

| # | Check | Expected |
|---|---|---|
| 1 | The log's start line | `EDGEbuilder 0.6.0 starting; ... scene Working scene (...), N objects; 0 other scenes on; Library not set`, then `Service ready: refs, scenes`. REDnode 0.56.1 or later |
| 2 | The Scene tab; Ctrl+S | The top shows **Scene: Working scene** and "In This PC. Saved after every change." Ctrl+S: "Saved Working scene in This PC" |
| 3 | The Library tab; **Make the Library** | Before: "No Library folder yet. Make one at ...\Documents\EDGE Library". After: "The Library is ...\EDGE Library"; the button goes; the tree shows LIBRARY (0 scenes) and THIS PC with Working scene marked OPEN. `%APPDATA%\EDGE\library.json` says `{ "root": ... }` and the folder is there in Explorer |
| 4 | Pick LIBRARY, type `Alleys` in Name, **New folder**; pick Alleys, type `Kabuki`, **New folder** | Both folders in the tree and in Explorer. "In Library > Alleys > Kabuki" under Name once Kabuki is picked |
| 5 | With Kabuki picked, type `Market`, **Save open scene here** | "Saved as Market in Library > Alleys > Kabuki; that is the open scene now". The Scene tab says Scene: Market. Working scene is still under THIS PC, no longer OPEN |
| 6 | Drop three crates. On the Scene tab, change the name to `Market Corner`, Enter | "Renamed the scene Market Corner (market_corner.scene.json)"; Explorer shows `market_corner.scene.json` and no `market.scene.json` |
| 7 | Library tab: pick Alleys, type `Yard`, **New scene here** | Market Corner's crates leave the world; "New scene Yard in Library > Alleys". The Scene list is empty, Undo is greyed out |
| 8 | Pick Market Corner, **Show in world** | Its three crates appear where they were; the row is marked SHOWN; with Edit on, a click on them selects nothing. **Hide from world** takes them away; show them again |
| 9 | Drop a crate in Yard. Then double-click Market Corner | Yard's crate leaves the world, Market Corner's crates come back as previews you can select and move ("Opened Market Corner ..."); its SHOWN mark goes. Undo starts empty |
| 10 | Pick Yard, **Show in world**. Quit the game, start it, load a save | The log: `scene Market Corner (...)`, `1 other scene on`. Once the save is in, Yard's crate shows and Market Corner's near crates come back by themselves (0.6.1), with "Market Corner: 3 of 25 objects back in the world; 22 far away" as the message. **The gate: a scene saved in a Library sub-folder reopens after a restart, with another shown beside it** |
| 11 | Ctrl+Shift+S | The Library tab, with "Market Corner copy" in Name and only **Save open scene here** offered (0.6.2): it saves a copy with all the objects, which becomes the open scene. Leaving the tab brings the other buttons back |
| 12 | A name taken: in Alleys, New scene here with the name `Yard` | A warning, "Library > Alleys already has a scene called yard.scene.json", and nothing changes |
| 13 | Far away: show a scene whose objects are more than 300 m away (or fly the camera 500 m off, then show Market Corner) | It answers at once, no busy bar that hangs; the crates appear when the camera or V gets near |
| 14 | With a REDcode project open (REDcode 0.10.5 or later) | A PROJECT: name section in the tree; New scene here in it writes `source\scenes\<name>.scene.json` in the project |
| 15 | The service: in Claude Code with REDnode's MCP server, ask for EDGEbuilder's scenes, then for Market Corner's refs | `edgebuilder__scenes` runs without asking and lists the scenes with place, folder, object count, open and on. `edgebuilder__refs` gives the three crates with refs `edgebuilder/market_corner/cargo_crate_a` and on, positions and rotations |
| 16 | Your usual screen: Edit on, select a crate | The gizmo sits on the crate as before; the window at the right edge. On a 21:9 or wider screen (or the game windowed at such a size), the same, and the view's tint covers the whole width |
| 17 | 0.6.2. The Library tab, with one scene open: pick another scene, **Objects** | A drawer slides out to the left of the window: that scene's objects, group names, a small trash icon at the right of each row. Pick another scene: the list follows. **Objects** again, or its X, closes it |
| 18 | Open Market Corner. Edit off. Two quick clicks on a crate near you in the drawer | Edit goes on, the camera lands in front of the crate, looking slightly down; the crate has the outline and the gizmo, and it moves as usual |
| 19 | Two quick clicks on a crate far from V (the `grp_1` crates, from where the `grp_4` ones are; 0.6.5) | The camera goes there, and the crate has its outline and gizmo; it moves as usual. The crates near it are there too, standing on the ground |
| 20 | Pick a scene that is not open, **Objects**, two quick clicks on an object | That scene opens, then the camera flies to the object |
| 21 | The open scene: the trash on an object that is not selected and out of view; **No**; the trash again, **Yes**; Ctrl+Z | "Delete?" in the row; No changes nothing; Yes takes it from the list and the world, with the camera staying put; Ctrl+Z brings it back |
| 22 | A scene that is not open: the trash, **Yes** | "Delete for good?"; "Removed ... Undo cannot bring it back"; the open scene unchanged; the scene's count in the tree one less. If that scene is shown in the world, its object goes too |
| 23 | Load a save with a scene open (0.6.1) | Its crates within 300 m come back by themselves about 2 s after the save is in; the message counts those far away. No crate twice |
| 24 | 0.6.4. With a scene open and its crates in the world: **Close** on the Scene tab | Its crates leave the world; "Closed ... the Library tab opens it again"; the Scene tab says no scene is open, with Save, Save as and the name greyed out; no scene marked OPEN in the Library tab; its file keeps its objects. A scene shown beside it stays |
| 25 | With no scene open: **Drop where I look**; Ctrl+V | "No scene is open: open one or make one on the Library tab"; nothing placed |
| 26 | Quit the game, start it, load a save | The log says `no scene open`; no crates come back, but for scenes still shown |
| 27 | Pick a scene, **Open** (or two quick clicks); then pick it and press **Close** in the Picked panel; **New scene here** | Opening brings its crates back; Close in the panel works only on the open scene; a new scene opens with no mention of a scene before it |
| 28 | 0.6.5. Fly far from V, then open a scene with objects near and far from V, and Rebuild previews | Every object comes in, wherever it is, with no message about far objects and no busy bar that hangs. Back near V, they are all still there |
| 29 | Far from V: select a crate, **Drop to floor**; Ctrl+Z; **Drop at click** on the ground there | The crate lands on the ground if the game has it loaded there; if not, a message says so. Note what happens: the ground's collision far from V is untried |
| 30 | Show a scene whose objects are far from V; fly there; Hide | Its objects are there from the first press, and Hide takes them out |
| 31 | Far from V, with Edit on, load a save | Edit stays on and the editor camera starts again at V's view; the open scene's objects all come back, none twice |
| 32 | 0.6.6. Far from a crate: select it, **Drop to floor**. Fly next to it and press it again | From afar: "Nothing solid below within 1000 m. The ground is solid only near the camera: fly closer and try again." Beside it: it lands |
| 33 | Fly high above the ground, about 200 m up: **Drop at click** on the ground, then **Drop to floor** on a crate lifted that high | Note how high it still works: how far the solid ground reaches from the camera is unknown. Where it misses, Drop at click places the crate 8 m along the line, and Drop to floor gives the message above |
| 34 | 0.6.7. Quit the game with a scene open, start it, load a save | The log has one line for the scene, `25 of 25 objects back in the world` or its own numbers, with no `0 of` line and no `Back ...: V is not in the world yet` lines before it. No crate twice |


### B4 Bake

Every question B4 has to settle, so nothing critical rests on an assumption. Each says what depends on it and which test proves it. A question moves to **Proven** only on what was seen in game or read in a log. Round 3's answers are under its results; the rest wait for their tests.

**What the game does, read with REDbridge's `sector.nodes` in the 40 sectors around the probe's street (2026-11-05).** Its solid static props are drawn by `worldCookedStaticMeshNode` (16,682 items), with collision apart in `worldCookedCollisionNode` (715 nodes), which holds shapes such as boxes at world positions, with presets such as `World Static` and materials such as `metal.physmat`. WolvenKit reads that node. `worldInstancedDestructibleMeshNode` (8,034 items) and `worldDynamicMeshNode` take physics from the mesh itself; their node data has the same flags and priority as a mesh node's. The game's `simulationType` there is Dynamic or Kinematic, never Static in these sectors. The older `worldCollisionNode` holds the same kind of shapes and WolvenKit writes it, but none of these sectors uses it. New shapes with exact mesh form would need cooked PhysX data, and whether anything in reach can make that is unknown.

#### Questions for the Solid switch: round 3, below

| # | Question | What depends on it | Answered by |
|---|---|---|---|
| S1 | Which nodes stop V, and can V stand on them? | Which route the Solid switch can use at all | Step 3 |
| S2 | Which stay put when shot, hit or driven into, and do any break? | A scene must not fall apart when a fight starts | Step 4 |
| S3 | Does a mesh's collision grow with its scale? | Scaling is in the editor: a scaled mesh must fit | Step 5 |
| S4 | Does collision follow a turned, leaning object? And does a bake place it turned as the scene says? **No baked object has ever been turned** | Almost every real object is turned | Step 6 |
| S5 | What does a mesh with no collision data do with mesh physics? Does it show? | Many meshes, some mod meshes among them: the switch must say what it will do | Step 7 |
| S6 | Does a box stand where the object is, at its size? It assumes the shape's size is a half size, and that the middle of the bounds is right for a mesh whose origin is off-centre (the sofa) | Whether a box from the bounds can be trusted | Steps 3, 7 |
| S7 | Do the new nodes look as a plain one does: same place and size, the chosen appearance, shadows, how far they are seen? **No baked object has ever had an appearance other than default** | Solid must not change the look | Step 2 |
| S8 | Do drawing and collision come and go together? Does a knocked object come back where it stood? | Walking through a thing not yet solid, or a scene slowly scattering | Step 8 |
| S9 | Is a save safe: a knocked object, saving, loading, and then the mod removed? | Players keep their saves. The worst outcome of the whole phase | Step 9 |
| S10 | Do bullets stop, do cars stop, do people walk around or through? People use a navigation mesh made ahead of time, so they probably walk through: to note, not a fail | What the public preview must say about solid objects | Step 10 |
| S11 | Does it all load cleanly: no crash, no errors in the logs? | A bad node could take the whole sector with it | Steps 1, 11 |

**What the answers decide:**

| What is seen | The Solid switch |
|---|---|
| A mesh-physics crate (`b` or `c`) stays put, and S3 and S4 hold | Uses mesh physics: the mesh's real shape |
| ...and the sofa (`j`) is not solid, but its box (`k`) is | Mesh physics where the mesh has data, a box where it has none; the panel says which |
| Boxes (`g`, `i`, `k`) do nothing on 2.5 | Mesh physics only; a mesh with no data is named as not solid, and the way to make it solid is an entity with a collider, as `crate_red.ent` in round 2 |
| Only `d` or `e` are solid | They move when hit, so Solid has to say so, and boxes become the first choice if they work |
| None of them is solid | Entities with colliders only, and B4-2 is planned again with the owner |

#### Round 3: the crates

`scripts/solid-probe.mjs` bakes these in one sector with REDbridge's main (0.12.0, unreleased), rewriting each node through CR2W JSON, so no REDbridge change is needed to learn the answer. WolvenKit's reader read everything back as written. The first build stood on the Watson street of rounds 1 and 2, where the row ran into a building, so the owner asked for it in the open: it now runs through the Badlands from (1840.9, -753.3, 51.8), 6 m ahead of where V stood, to (1871.3, -763.3, 53.0), east-south-east, streaming to 120 m. Each object stands at the height of the ground under it, asked of the game with a raycast. There are no people here, so S10's people wait for B4-1's test in the city.

| Crate | Metres along | What it is | For |
|---|---|---|---|
| `a_plain` | 0 | Plain `worldMeshNode`, the reference | V walks through it, as before |
| `b_kinematic` | 2.5 | Instanced destructible, Kinematic | S1, S2: the one hoped for |
| `c_static` | 5 | Instanced destructible, Static, which the game's own never use | Does it show? S1, S2 |
| `d_impulse` | 7.5 | Instanced destructible, Kinematic, turns dynamic on impulse, as many of the game's are | Solid until knocked? S2, S8 |
| `e_dynamic` | 10 | `worldDynamicMeshNode`, asleep at the start | Can be pushed? S2, S8 |
| `f_big` | 13.5 | As `b`, scale 2 | S3 |
| `g_box` | 17 | Plain mesh with a `worldCollisionNode` box | S1, S6: do boxes work on 2.5? |
| `h_turned` | 20 | As `b`, turned 40 degrees and leaning 20, lifted 0.5 m | S4 |
| `i_box_turned` | 23 | As `g`, turned and leaning the same | S4, for a box. It should lean exactly as `h` does |
| `j_sofa` | 26 | As `b`, on a sofa with no collision data | S5 |
| `k_sofa_box` | 29 | The same sofa, plain, with a box | S5, S6 |
| `l_red` | 32 | As `b`, appearance `red` | S7 |

**Should the game crash on loading:** nothing is harmed. Switch the mod off in EDGEdeck and deploy, and it is gone. Tell Claude; `--skip` builds the row again without the likely cause (`c`, then the boxes), and the rest still answers.

| # | Do | Note, for each crate | Answers |
|---|---|---|---|
| 1 | Game closed; `EDGEbuilder bake probe` on in EDGEdeck, deploy only it. Start the game, load a save | Does it load? | S11 |
| 2 | Go to the row's start and look along it. Compare each with `a_plain`, at night or day as it comes | All twelve there? Same look and shadows? Is `l_red` red, `f_big` double? Walk back along the row to about 100 m: does any go sooner than the others? | S7 |
| 3 | Walk into each, then jump on top | Does V stop? At the object's side, or short of it, or inside it? Stand on it? Does it move? | S1, S6 |
| 4 | Shoot each, then a melee hit. Then drive a car slowly into `b`, `c`, `g` and `d` | Does it move, break or stay? Does the car stop? | S2 |
| 5 | `f_big`: walk around it, jump on top | Does V stop at its doubled size, or walk into it? | S3 |
| 6 | `h_turned`, `i_box_turned`: walk around them, stand on them | Do they lean the same way? Does V follow the leaning shape, or an upright one? | S4 |
| 7 | `j_sofa`, `k_sofa_box`: look, walk into, sit or stand on them | Does `j` show? Is it solid? Does `k`'s box fit the sofa, on all sides? | S5, S6 |
| 8 | Knock what can be knocked. Walk 150 m away and come back, then run back fast or in a car | Is each back, and where: where it stood, or where it fell? Is any drawn but not yet solid when you reach it? | S8 |
| 9 | With something knocked: save. Load that save. Quit, start, load it again. Then quit, switch the mod off, deploy, and load the same save | Anything odd at each load? With the mod off: the crates gone and the save fine? | S9 |
| 10 | Mod on again. Note what shots do at each solid crate, if any people or cars pass | Do bullets stop? People, if any: around or through? | S10 |
| 11 | Quit. Claude reads the ArchiveXL, RED4ext and REDnode logs | `All streaming blocks merged`, no errors | S11 |

**Results (2026-11-05, game 2.5, REDnode 0.58.0, ArchiveXL 1.28.6, the owner's report and the logs): mesh physics works; these boxes do not.**

| Crate | Shows | V | Bullets | Melee | Car |
|---|---|---|---|---|---|
| `a_plain` | Yes | Walks through | Pass | Pass | |
| `b_kinematic` | Yes | Stops, stands on it | Hit | Hit | Stops |
| `c_static` | Yes | Stops; harder to get on top of, but stood on it | Hit | Hit | Stops |
| `d_impulse` | Yes | Walks through | Pass | Hit | Goes through |
| `e_dynamic` | Yes | Walks through | Pass * | Pass * | |
| `f_big` | Double | Stops at its doubled size, stands on it and can drop inside | Hit | Hit | |
| `g_box` | Yes | Walks through | Pass | Pass | Goes through |
| `h_turned` | Yes | Stops, stood on it | Hit | Hit | |
| `i_box_turned` | Yes | Walks through | Pass | Pass | |
| `j_sofa` | Yes | Walks through | Pass | Pass | |
| `k_sofa_box` | Yes | Walks through | Pass | Pass | |
| `l_red` | Red | Stops, stands on it | Hit | Hit | |

\* The note for step 4 says "Crate A" twice; the owner confirms the second, between D and F, is E.

The logs: all five game starts of the test loaded; ArchiveXL merged the block in the four with the mod on, with no warnings or errors in any of the five, and none in the latest RED4ext log; no crash report. The start with the mod off (08:22) loaded the save, and EDGEbuilder's scene came back.

| # | Answer | State |
|---|---|---|
| S1 | **Solid: instanced destructible, Kinematic or Static, no impulse.** Not solid: Kinematic with impulse, `worldDynamicMeshNode`, the plain mesh | Proven |
| S2 | `b` and `c` stay put and stop a car; nothing moved or broke under shots and melee | Proven for these; `f`, `h` and `l` not driven into |
| S3 | Collision grows with scale | Proven |
| S4 | A turned crate stands turned, and `h` and `i` lean alike, so a bake's rotation is right. `h` is solid, but V stays upright on anything, so whether the collision leans with the crate is **still open** | Half proven |
| S5 | A mesh with no collision data shows, and is not solid. Neither route makes it solid | Proven. Of 73 crate-sized meshes sampled among containers and furniture, 32 have no data, so this is common |
| S6 | Moot, as boxes did nothing | Open with them |
| S7 | Same look and shadows; `l_red` is red | Proven, but for how far each is seen, which the notes do not say |
| S8 | All stood where they were after 150 m away and back. Nothing could be knocked, so a knocked object's return does not arise for `b` or `c`. Drawn before solid: not noted | Mostly proven |
| S9 | Crates gone with the mod off, and the save loads | Proven for removal; nothing was knocked |
| S10 | Bullets and melee stop at solid crates, and cars too. People: for the city test, B4-1 | Part proven |
| S11 | No crash, no errors | Proven |

**What it decides.** The second row of "what the answers decide" did not quite come: boxes did nothing, so it is the third. **Solid means an instanced destructible mesh node, Kinematic, `isDestructible` 0, no impulse**: the mesh's real shape, as `f_big` shows with its open top; Kinematic rather than Static because the game's own nodes use it and V got onto it more easily. A mesh with no collision data cannot be made solid this way, so the panel must know which those are and say so. The way to make one solid is an entity with a collider, as `crate_red.ent` in round 2.

**Boxes are not ruled out for good:** only this form of them. `worldCollisionNode`'s `sectorHash`, `resourceVersion` and proxy type were best guesses from the cooked form, and no sector sampled uses the plain node.

#### The test of B4-2, the Solid switch, on 0.8.0

Round 3 proved the node by rewriting sectors by hand; here `sector.build` writes it (REDbridge 0.12.0, checked byte for byte against round 3's, and in the smoke test, never yet in the game). It answers what round 3 left open: S2's untouched crates, S4's lean, S7's distance, S8's drawn-before-solid, S10's people. Checked before the game in REDnode's host with real clicks: the switch for one object, several and a mesh with no data; Undo and Redo; the file; the Bake tab's lines; "changed since"; a bake with both node types in it. Ctrl+A was not tried there.

| # | Do | Expected | Answers |
|---|---|---|---|
| 1 | Open a new scene. Drop a cargo crate; select it | **Solid when baked** on. Hovering it says previews stay walk-through | |
| 2 | Drop the sofa `bar_sofa_02_k.mesh`, select it | The switch greyed out, "No collision data, so this mesh can't be solid." | S5 |
| 3 | Select a `crate_red.ent` entity | No switch | |
| 4 | Copy a crate and turn off **Solid** on the copy; Ctrl+Z, Ctrl+Y; leave it off | Undo and Redo flip it. Name it, or note where it stands | |
| 5 | Add a crate at scale 2, one turned and leaning, one with another appearance | They stand as placed, and the switch is on for each | S3, S4, S7 |
| 6 | Ctrl+A, with the sofa selected too; off and on again; then turn step 4's copy off again | Everything selected, the note says how many can't be solid. Off and on again leaves the sofa as it was | |
| 7 | **Bake** tab | It names the sofa as having no collision data, counts the one set not solid and the ones that will stop V; **Bake**. Then flip a switch: "The scene changed since"; flip it back | |
| 8 | Quit. REDcode **Pack and Install**; start; load near them | Everything stands, with no previews | |
| 9 | Walk into each | The solid crates stop V, and V can stand on one; the sofa and the crate set not solid let V through; `crate_red.ent` stops V | S1, S5 |
| 10 | Shoot, melee and drive into the solid crates, the scaled and leaning ones too | They stop all of it, stay put and nothing breaks | S2, S10 |
| 11 | Stand against the leaning crate's low side and walk around it, or jump at it. Claude can also send rays at it | The collision leans with what you see | S4 |
| 12 | Walk or drive far away and come back fast, watching a crate as it comes in | Note how far off it appears, and whether V can run through a crate that has drawn but is not yet solid | S7, S8 |
| 13 | Lead or wait for a person near a crate on a walkway | Note whether people walk through or around: people follow paths made ahead of time | S10 |
| 14 | **200 Crates** is 200 entities (`crate_blue.ent`), with collision of their own, so it has no switch. Claude wrote **200 Cargo Crates** beside it in the Library: 200 solid `cargo_crate_b` meshes on the same spots. Take 200 Crates' bake out on the Bake tab, open 200 Cargo Crates, Bake; Pack and Install; start. Load the save where V stood (-2013.3, -2877.6, 98.0). Claude reads the frame rate | Against 67 fps (200 entity crates) and 65 fps (none) in the same view | W14 |
| 15 | Save among solid crates, quit, turn the bake off, load the save | The save is fine, and V is not stuck | S9 |
| 16 | Turn `redcode.pack.redmod` off in VS Code. Pack and Install; start. Turn it back on after | The bake goes in `archive\\pc\\mod` and stands; EDGEbuilder says it is baked | W15 |
| 17 | Hover **New** on the Scene tab | The tooltip says `press "New Scene Here"` (0.7.3's wording, not looked at yet) | |

Found on 0.8.0 (2026-11-08): the Scale field took typing for an entity (the kit's `rn-input` does not read `disabled`; now hidden), step 14's 200 Crates are entities, which have no switch (Claude wrote 200 Cargo Crates, solid meshes on the same spots), and step 6 turned step 4's copy back on. Among 200 solid cargo crates: 75.2 and 75.9 fps, in a sandstorm in the morning, so not comparable with the 67 fps at night; step 15's load without the bake gives the same weather. Every baked crate came in at about 40 m, which the owner saw as pop-in: **0.8.1** adds **Seen from** (the scene's `streaming`, which round 2 proved reaches the game) and keeps the tab bar in place while a tab scrolls (the owner, 2026-11-08). Checked in REDnode's host with real clicks and keys; the smoke test bakes one at 300 m through REDbridge 0.12.0.

| # | On 0.8.1 | Expected |
|---|---|---|
| 18 | Select one crate in the Scene tab | **Seen from, m** is empty, its hint "40 by size"; the tooltip says what it does. An entity has no Scale field |
| 19 | Type 150 in Seen from and press Enter; Ctrl+Z, Ctrl+Y | The message says seen from 150 m; Undo empties it, Redo brings it back. The Bake tab says the scene changed since |
| 20 | Open **200 Cargo Crates**, Ctrl+A, Seen from 120; Bake; Pack and Install; start; load among them | Crates come in at about 120 m. Claude reads the frame rate against step 14's |
| 21 | Scroll down a long tab (the Scene tab with something selected) | The tab bar stays where it is |
| 22 | With REDbridge 0.12.1 (#16): Get REDbridge in EDGEdeck; rebake **200 Cargo Crates** (Seen from 120), Pack and Install; start, load among them, walk off and back | The Bake tab gives no Seen from warning; the crates show out to about 120 m, with no hand edit |

Step 22, first try (2026-11-08, REDbridge 0.12.1, the bake 120/96 from 0.8.1's Seen from): from EDGEbuilder's camera straight above the crates, all 200 were gone with the nearest 97.5 m from its middle, and came back 2.7 m lower, with the nearest inside 96 m. The game hides a node beyond its streaming distance **or** its secondary distance, so 120/96 reached 96 m. (Walking in on the ground they first showed at 94 m, over the crest V walked down; the hand-edited "about 120 m" was a reading made hard by terrain and haze.) Seen from now writes both the same.

**Step 22 passed on 2026-11-08** (the bake 120/120, REDbridge 0.12.1, the fixed 0.8.1): flying up from straight above the crates, the last ones vanished with the nearest 120.2 m from the camera, measured from its middle. Seen from reaches its distance with no hand edit. The Bake tab gave no Seen from warning.

**Results (2026-11-08, steps 1 to 15 and 17 on 0.8.0, then 0.8.1 for 16 and 18 to 21): every step passed as written.** Steps 8 to 13: solid crates stop V, bullets, melee and cars, the scaled and leaning ones too; the sofa and the crate set not solid let V through; nothing breaks, nothing moves, and the owner saw nothing strange coming in or with people. Step 15: the save loads without its solid crates and V moves freely. Step 16: with `redcode.pack.redmod` off the bakes went to `archive\pc\mod`, ArchiveXL merged them, and EDGEbuilder said 200 Cargo Crates was baked and in the game.

Found along the way: a scene's previews come back when its bake leaves the game (so the scene stays editable; Close takes them away), and the Bake tab bakes into whichever project REDcode has open (the owner had started from EDGEhack_Test1's window; nothing went there).

**W14, frame rate** (3840 x 2160, in a sandstorm, facing the palms where the crates stand):

| In view | fps |
|---|---|
| No crates | 75.9, 76.3 |
| 200 baked solid `cargo_crate_b` meshes, seen from 120 m | 77.2, 75.7 |
| 200 previews (EDGEbuilder's spawns, the open scene) | 70.0 |

Solid meshes cost nothing measurable, even at three times the distance; only the editing previews cost anything.

**S7, how far a baked mesh is seen.** Measured from V to each crate's middle:

| Bake | Crates appear or vanish at |
|---|---|
| By size (40 m for a crate) | about 40 m: streaming (the owner saw it as pop-in) |
| Seen from 120 | about 60 m: 0.94 m forward took the crates within 60.5 m from 3 to 8. The game hides a mesh of that size by itself |
| Seen from 120, `forceAutoHideDistance` 120 set by hand on the 200 nodes | the farthest crates vanished at about 120 m (from where 3 of 200 were beyond 120 m) |

So Seen from needs the node's `forceAutoHideDistance` too: [REDbridge #16](https://github.com/Edgemodders/REDbridge/issues/16), filed 2026-11-08. Until it ships, a small object is seen only as far as the game's own limit for its size.

#### Questions for the Bake panel: the test of B4-1

| # | Question | What depends on it |
|---|---|---|
| W1 | A baked scene loads with EDGEbuilder uninstalled, not just off | The release gate |
| W2 | A real scene comes out as placed: 26 objects of Market Corner against their previews, position, turn and scale, seen by showing both at once | The promise of the tool. Rounds 1 and 2 had three objects |
| W3 | Entities bake with their chosen appearance, and only meshes take a scale | Previews and bakes must agree; the panel warns of what differs |
| W4 | A mod's mesh bakes, and the panel names the mods the bake needs | Mods as assets, from B2c |
| W5 | With that mod missing, the game does not crash: the object is just absent | A modder's bake on a player's PC |
| W6 | Baking again replaces the bake, with no leftovers and no doubles. Does a change need a game restart, or can an archive swap show it? | The everyday loop, and how long it takes |
| W7 | Removing a bake leaves the world and the save fine | As S9, for a real scene |
| W8 | Objects far apart in one sector all stream right: one streaming box over a long scene | Scenes across a district, or one sector per area? |
| W9 | A bake inside a building, and in Dogtown: an `Exterior` sector in an interior, and Phantom Liberty's own streaming block | Half the places a modder wants |
| W10 | Previews and baked objects together show everything twice: what the panel does about it | The first thing anyone sees after a bake |
| W11 | What a scene with objects the bake cannot make does: lights, an unknown kind | A clear message, not a broken sector |
| W12 | No project open, and no Library: Bake says what to do. Project-only works without the Library | Never forced |
| W13 | The installed REDbridge, as a player gets it from EDGEdeck, does the bake | Tested so far only with a checkout's build; needs REDbridge 0.12.0 released |
| W14 | A large scene, some hundreds of objects: the game's frame rate near it, and how long the bake takes | Limits the preview must state |
| W15 | The project's name differs from the scene's: `<scene>.archive.xl` beside `<project>.archive` still loads, and packing carries the `.xl` | Every bake but one made for the purpose |
| W16 | Two scenes baked into one project both stand | One project, a whole district's scenes |

**The test of B4-1, on 0.7.1** (0.7.0 did not see a bake packed as a REDmod)**.** A project to bake into: `EDGEbuilder_Testing`, open in REDcode. REDbridge 0.12.0, released on 2026-11-05, as EDGEdeck installs it. With 0.11.0, which reads only the game's files and writes a form of `.xl` EDGEbuilder corrects, steps 10 and 11 cannot run.

| # | Do | Expected | Answers |
|---|---|---|---|
| 1 | Close the project in REDcode. Open **Bake** | "No REDcode project is open", and Bake greyed out | W12 |
| 2 | Open `EDGEbuilder_Testing` in REDcode, and open Market Corner copy 2. Press **Refresh** | The scene and its object count, "Into the REDcode project EDGEbuilder_Testing", the note about collision; Bake lit | W12 |
| 3 | First add to the scene: a `crate_red.ent` from the Assets tab, a crate with another appearance, and one turned and scaled, near the others | They stand as you placed them | |
| 4 | Press **Bake** | "Baked Market Corner copy 2: N objects", the three files, and it in the project's list. The busy bar if it takes a while: note how long | W14 |
| 5 | Move a crate, open Bake, then Ctrl+Z and open Bake again | "The scene changed since", then not | W6 |
| 6 | Quit. Pack and install the project: in REDcode, Pack; in EDGEdeck, Add from REDcode project, Deploy. Claude can deploy | The project's archive and `market_corner_copy_2.archive.xl` in `archive\pc\mod`, or in `mods\<project>\archives` with REDcode's `redcode.pack.redmod` on, which needs the game started with `-modded` | W15 |
| 7 | Start the game and load a save near Market Corner | The objects stand. The message says the scene is baked and its previews stay off; Bake says the same. Nothing twice | W10 |
| 8 | Press **Rebuild previews** | Each preview lands on its baked object, so they flicker in one place, with no offset, for the moved, turned and scaled ones too. `crate_red.ent` keeps its look, and is solid. The meshes are not, yet | W2, W3 |
| 9 | Walk or drive to the far objects, the `grp_1` ones about 320 m off, and back | They stand there, and come back | W8 |
| 10 | A new scene, with EvilClown's chicken and one crate: Bake | Bake names EvilClown as needed | W4 |
| 11 | Pack and install; then turn EvilClown off, deploy, and load | **No crash**: the chicken is absent, the crate stands | W5 |
| 12 | Move a crate in Market Corner, bake again, pack and install; start | It stands in its new place, with no copy at the old | W6 |
| 13 | Bake a scene inside a building, and one in Dogtown, into the same project; pack and install; start | Both stand, and neither stops the other | W9, W16 |
| 14 | Duplicate a scene to some 200 objects: Bake; pack and install; start | The time it takes, and the frame rate near them | W14 |
| 15 | Bake tab's trash on a bake: **No**, then **Yes**; pack and install; start with the same save | The bake is out of the project, the scene stays, the objects leave the world, and the save is fine | W7 |
| 16 | Turn EDGEbuilder off in EDGEdeck, deploy, start, load near a bake | It stands with EDGEbuilder uninstalled | W1 |

W11 is in the smoke test (a kind a bake cannot make is left out, and said so). Every step answers W13, since the bake runs on the copy EDGEdeck installed.

**Results, 2026-11-05, on 0.7.1 with REDbridge 0.12.0 as EDGEdeck installs it (game 2.5).** The owner ran all 16 steps: everything worked as written. The logs agree where they can speak.

| Question | Answer |
|---|---|
| W1 | A bake stands with EDGEbuilder off and deployed out: the 16:45 start merged the blocks, and EDGEbuilder wrote nothing |
| W2, W3 | Previews land on their baked objects, moved, turned and scaled ones too; `crate_red.ent` keeps its look and is solid; the meshes are not, as expected. Dragging a preview away shows its baked twin behind it |
| W4, W5 | Bake names EvilClown. With EvilClown off the game does not crash: the chicken is absent and the crate stands |
| W6 | Baking again replaces the bake, with no copy at the old place. A change came in with a game restart; an archive swap was not tried |
| W7 | Taking out a bake and packing again removes its objects, and the save is fine. An open scene whose bake is gone stands as previews again, as it should: the crate left when the scene was closed |
| W8 | The far objects, about 320 m off, stand and come back |
| W9 | A bake inside a building (VoodDoo Inside, one object) stands, and so does one in Dogtown (Market Corner copy 2, already there), from one project |
| W10 | The scene's previews stay off, the message and the tab say so, nothing stands twice until Rebuild previews |
| W12 | No project open says so, with Bake greyed out; with the project open, Bake is lit |
| W13 | The bake runs on the installed copy: the log says `REDbridge 0.12.0 ready (EDGEdeck (Code))` |
| W14 | 200 objects bake into a 12,634-byte sector, and the owner saw no real frame rate drop near them. REDnode's `perf`, at 3840 x 2160, V among them at (-2013.3, -2877.6, 98.0), yaw -132.3, Edit off: about 67 fps with crates in view (67.8, 67.5, 67.4, 67.1), about 93 looking at the sky (93.4, 93.1, 93.5). The same spot and view with the bakes out of the game, after a restart: about 65 fps (64.5, 63.6, 65.3, 65.8). **So 200 baked meshes cost nothing this can measure**: the rate was if anything higher with them, within what a restart, the time of day and crates hiding what is behind them can move. These are draw-only meshes: measure again with solid ones in B4-2 |
| W15 | Three bakes beside `EDGEbuilder_Testing.archive` load, each through its own `.xl`: `<scene>.archive.xl` needs no archive of its name |
| W16 | ArchiveXL merged four blocks from one project in one start |

**Found on the way.**

| Finding | What it was | Answer |
|---|---|---|
| A bake packed as a REDmod | With `redcode.pack.redmod` on, the `.xl` is in `mods\<project>\archives`, where 0.7.0 did not look, so previews would have stood on the bake. ArchiveXL reads it there, and the game needs `-modded` | 0.7.1 reads both places; this whole test ran as a REDmod. **The plain archive form was tested only by the probes** |
| The Scene tab's name field and New | The field reads as the name for New, and Enter there renames the open scene with no question. New only opens the Library tab | 0.7.2: labelled Open scene's name, Enter asks first, New's tooltip says what comes next. Passed in game on 2026-11-05: the label, the question, Keep the name, Rename and the tooltip. 0.7.3 puts "New Scene Here" in the tooltip in quotes, at the owner's request, so it does not read as pressing New. Released without its own test, by the owner's choice (only the wording changed): **look at that tooltip in the next round** |

#### Questions for Library bakes: the test of B4-3

| # | Question | What depends on it |
|---|---|---|
| L1 | Two scenes in one `.bake`, included in a project, stand in the world | The Library's promise |
| L2 | Two bakes deployed together both load: ArchiveXL takes several streaming blocks | Several mods from EDGEbuilder in one game, also from different modders |
| L3 | Two bakes with the same object show the collide flag; a scene changed after its bake shows stale | The flags in [the Library page](library.md) |
| L4 | Include in project writes the came-from note; a project with no Library still builds | The shared rules |

#### The test of B4-3, Library bakes, on 0.9.0

Built on 2026-11-08 (agreed the same day: bake files only, the scenes stay in the Library; made and changed on the Library tab). A Library bake is a folder `<name>.bake` in a Library folder, laid out like a small project: each scene in it is baked exactly as into a project, a sector of its own, with `bake.json` on top (`id`, `version`, the scenes with their hashes). Include in project copies its files and writes the came-from note `source/library.json`. Checked in REDnode's host with real clicks: Bake into Library, Add open scene, Include in project, the stale flag, Bake again and Update, a scene taken out (its copy leaves the project), a second bake of the same scene (both collide), Delete with its question. The smoke test bakes into a `.bake` folder through REDbridge 0.12.1.

Before: deploy 0.9.0 with the game closed; `redcode.pack.redmod` is off. The REDcode project is EDGEbuilder_Testing; 200 Cargo Crates is baked straight into it already.

| # | Do | Expected | Answers |
|---|---|---|---|
| 1 | Start, load a save. Library tab: pick **200 Cargo Crates**, type **Kabuki Bakes** in Name, press **Bake into Library** | The message says it is baked into the Library as Kabuki Bakes. The tree shows **Kabuki Bakes** with a BAKE tag, `1 scene · v1`, beside the scene | |
| 2 | Pick Kabuki Bakes | Picked says where it is, version 1, and that it is not in the open project. Include in project, Add open scene, Bake again and Delete; the scene list shows 200 Cargo Crates with a trash icon. Open, Close and Show in world are gone | |
| 3 | Open another scene with a few objects near the crates (or make one: New scene here, drop two crates), then pick Kabuki Bakes and press **Add open scene** | Version 2, 2 scenes | |
| 4 | Press **Include in project** | It stops: the project already has a bake of 200_cargo_crates that is not from Kabuki Bakes | |
| 5 | Bake tab: take out the 200 Cargo Crates bake (trash, Yes). Library tab: Kabuki Bakes, **Include in project** | Included, version 2, 2 scenes. The Bake tab lists both scenes with `from Kabuki Bakes v2`. The tree tags Kabuki Bakes IN PROJECT | L4 |
| 6 | Quit; **Pack and Install** in REDcode; start, load among the crates | The crates stand and are solid, seen from 120 m; the second scene's objects stand too. The other bakes of the project (Market Corner, Vooddoo Inside) still stand where they are. Kabuki Bakes is tagged IN GAME | L1, L2 |
| 7 | Open the second scene and move one object | Kabuki Bakes is tagged STALE; Picked names the scene that changed | L3 |
| 8 | Pick the second scene, Name **Corner Copy**, **Bake into Library** | Both bakes are tagged COLLIDES; Picked says which one it shares a scene with | L3 |
| 9 | Pick Corner Copy, **Delete**, Yes | It leaves the tree; Kabuki Bakes is no longer COLLIDES | |
| 10 | Pick Kabuki Bakes, **Bake again** | Version 3. The Bake tab shows **Update to v3** beside both scenes; press it: `from Kabuki Bakes v3` | |
| 11 | Pick Kabuki Bakes, the trash icon by the second scene, Yes; then **Update in project to v4** (Include in project, named so when the project has an older version) | Version 4, 1 scene; the project's copy of the second scene goes (the Bake tab lists only 200 Cargo Crates) | |
| 12 | Claude reads `source\library.json` in the project | One EDGEbuilder item: `kind` bake, its `id`, `path` `Alleys/Kabuki/kabuki_bakes.bake`, `version` 4, the four files of 200 Cargo Crates | L4 |
| 13 | Library tab: pick 200 Cargo Crates, **Open** (if it is not open already). Bake tab: press **Bake** (straight into the project) | It bakes, and the Bake tab no longer says it came from the Library: a project needs no Library | L4 |

**B4-3 passed in game on 2026-11-08 on 0.9.0** (game 2.5, REDnode 0.58.0, REDbridge 0.12.1, `redcode.pack.redmod` off, the project EDGEbuilder_Testing): all 13 steps as expected. Steps 11 and 13 were worded wrongly and are corrected above: the button reads **Update in project to v4** when the project has an older version, and a scene opens on the Library tab, not the Bake tab.

| Question | Answer |
|---|---|
| L1 | Kabuki Bakes v2, two scenes (200 Cargo Crates and Yard) in one `.bake`, included in the project and packed: both stand in the world, the crates solid and seen from 120 m |
| L2 | The included bake's two blocks loaded beside the project's own bakes (Market Corner copy 2, VoodDoo Inside), so ArchiveXL merged blocks from a Library bake and the project in one start. Two bakes from different mods in one game were not tried: each mod's blocks go through its own `.xl`, as W15 showed |
| L3 | Moving an object in Yard tagged Kabuki Bakes STALE; a second bake of Yard (Corner Copy) tagged both COLLIDES, and deleting it cleared the flag |
| L4 | After step 5 the note listed Kabuki Bakes v2 and its eight files, the project's copies identical to the bake's. After step 11: one item, `kind` bake, `id` 89b9385f65241231, `path` `Alleys/Kabuki/kabuki_bakes.bake`, `version` 4, the four files of 200 Cargo Crates; Yard's files gone from the project, the project's own bakes untouched. After step 13 the record has no `library` mark and the note has no items: the bake is the project's own again |

#### The check of 0.9.1, the preview candidate

Built on 2026-11-08: no change in the window or the mod since 0.9.0. The zip is now `EDGEbuilder-<version>.zip`, laid out like the game folder (`red4ext/plugins/REDnode/apps/edgebuilder/`, with README.txt and LICENSE.txt), for Vortex and Nexus. EDGEdeck took it as a new version of EDGEbuilder 0.9.0 and deployed its seven files.

| # | Do | Expected |
|---|---|---|
| 1 | Start, load a save, open EDGEbuilder | The pills go green; the log says EDGEbuilder 0.9.1 |
| 2 | On the wide monitor: Edit on, select a crate (B3-2 step 16) | The gizmo sits on the crate; the panel at the right edge; the view's tint covers the whole width |
| 3 | Click crates near the far left and the far right; box-select near each edge; drop at a click near each edge | Each click selects what it is on, the box takes what it covers, each drop lands where clicked |
| 4 | Look at the help line | At the bottom centre of the wide screen |

**Passed in game on 2026-11-08 on 0.9.1**, on the owner's wide monitor: every step as expected. EDGEdeck installed the new zip as a new version of EDGEbuilder. This also answers B3-2's step 16 (ultrawide), open since 0.6.7.

### 0.9.2 Menus

Found by the owner on 2026-11-08 with 0.9.1: the gizmo stayed on screen over the pause menu and Settings. 0.9.2 hides the whole window while a game menu is open (`"hideWith": ["menu"]` in the manifest: REDnode's plugin reads the game's own "in a menu" flag), and the page drops a move, look, box or Drop at click under way when a menu opens. Not hidden with REDnode's `scene` state: that is scene tier 4 or more, which Edit sets itself to hide the HUD.

| # | Do | Expected |
|---|---|---|
| 1 | Load a save, open EDGEbuilder, Edit on, select a crate | The log says EDGEbuilder 0.9.2; the gizmo on the crate |
| 2 | Open the pause menu, then Settings | No gizmo, no EDGEbuilder window over either |
| 3 | Close the menus | The window and the gizmo come back; Edit still on, the editor camera where it was |
| 4 | Start dragging the crate's arrow, open the pause menu mid-drag, close it | The crate is back where the drag started; no drag follows the mouse |
| 5 | Edit off, open the inventory and the map | EDGEbuilder hidden in both, back after |
| 6 | Edit on again, fly a little, move a crate | All as before: the HUD stays hidden, the window never blinks out in Edit without a menu |

**Passed in game on 2026-11-08 on 0.9.2**: every step as expected.

### B3c NPCs

Built on 2026-11-11 as 0.10.0, from the plan agreed with the owner the same day ([design, NPCs](design.md#npcs-b3c)). People from the game's `Character` records, dropped and arranged like entities, saved as the `npc` kind (scene format 2), loaded by REDnode's `world.load` without EDGEbuilder, and left out of bakes. Checked before the game: `npm run smoke` against REDbridge 0.12.1 and the game's own TweakDB read 6,591 people in 8.5 s (Judy Álvarez's template has 14 appearances); the rows, search, format 2, the bake's message and the upright turn are in the smoke test. **Not checked:** anything the game does with a person EDGEbuilder places.

**Questions the test answers:**

| # | Question | If no | Answered by |
|---|---|---|---|
| N1 | Does a holding NPC follow a gizmo drag and stay at the new spot? | Respawn the person at the end of a drag, as a mesh's scale does | Step 5 |
| N2 | Does an NPC far from V (the editor camera 300 m out) spawn and stand there? | Say so in the help line: people show only near V | Step 8 |
| N3 | Does a story character (`Character.Judy`) spawn and stand like a crowd NPC? | Note it in the wiki: some characters act on their own | Step 6 |
| N4 | Do people come back after a save loads, and after a restart, with the same appearance? | Fix before release | Step 10 |
| N5 | Does the scene load with EDGEbuilder off, through REDnode's `world_load`? | A REDnode request issue | Step 12 |
| N6 | Does the bake leave the people out with the warning, and the crate stand in the game? | Fix before release | Step 11 |

**Before:** REDnode 0.58.0 or later, REDbridge 0.12.1 (EDGEdeck: Get REDbridge), Codeware, a REDcode project open for step 11. Install 0.10.0 with EDGEdeck and deploy with the game closed. A quiet spot outdoors for the save.

| # | Do | Expected |
|---|---|---|
| 1 | Start the game, load the save, open EDGEbuilder | The log says EDGEbuilder 0.10.0. The first time, the line under the pills reads the Character records for a few seconds; then the Assets count says "... assets and 6,591 NPCs" |
| 2 | Assets tab: the **NPCs** kind tab, type `judy`. Pick **Judy Álvarez** | The row shows Judy Álvarez with `Character.Judy NPC` at its end. The panel shows the name and the record, 0.6 x 0.6 x 1.8 m, and an appearance list starting with "Any: the game picks" |
| 3 | On the Library tab, **New** scene "People test". Drop a cargo crate as before. Then NPCs: type `citizenrich`, pick **CitizenRichFemale**, leave "Any: the game picks", **Drop** | A woman stands in front of you. The message says "Dropped CitizenRichFemale (her appearance) in ... ms". The Selected panel shows the record and that appearance; no Scale, Solid or Seen from |
| 4 | Walk V into her, and watch her for 30 s | She stays where she is, is not hostile, and may chat when bumped |
| 5 | Edit on. Drag her arrow about 3 m, release, watch 30 s. Turn her with the ring about 90°. Then Ctrl+Z twice | She stays at the new spot, then faces the new way, upright. Undo puts her back each time |
| 6 | Drop Judy with an appearance from the list that is not the first | Judy in that appearance. Does she stand and stay put like the crowd woman? |
| 7 | Ctrl+D on the woman, place the copy; Ctrl+C, Ctrl+V; set one copy's Z 1 m higher in the Selected panel, then **Drop to floor** | Copies are people too, standing; the raised one comes down to the ground |
| 8 | Fly the editor camera about 300 m away, **Drop at click** a person there, look at her, fly back | She stands there and stays put |
| 9 | Ctrl+S, then open the scene file (`People test.scene.json`) in a text editor | `"format": 2`; each person has `"kind": "npc"`, `"record"`, `"appearance"` (the dropped woman's is the one she got) and `"props": { "behaviour": "idle" }` |
| 10 | Load the last save. Then quit the game, start it again and load the save | Each time the people come back where they were, in the same appearances, with the crate |
| 11 | Bake tab: read the checks, then **Bake**. In REDcode, Pack and Play (or pack and deploy). Then **Close** the scene in EDGEbuilder | The checks say the NPCs are not baked and show only while EDGEbuilder or another package loads the scene, by name. The bake has only the crate; after Close, the crate stands from the bake and the people are gone |
| 12 | Turn EDGEbuilder off in REDnode's Mod Manager. Ask Claude to load "People test" with REDnode's `world_load` (it asks first), then to unload it | The people stand again, friendly, without EDGEbuilder; unload removes them |
| 13 | Turn EDGEbuilder on, open another scene, and on the Library tab turn **People test** on beside it | Its people show beside the open scene |
| 14 | Ask Claude for People test's objects (EDGEbuilder's `refs` tool) | The people are listed with kind `npc` and their record |
| 15 | (0.10.4) Assets tab: search `crate`, pick one, scroll the list up and down. Click the pin at the Picked panel's top right, scroll again, then click it again. Close and reopen EDGEbuilder | Pinned (the pin filled, as it starts), Picked stays at the bottom of the tab with its Drop buttons while the list scrolls under it. Unpinned, it scrolls with the list. The choice is kept after reopening |

**Results, 2026-11-12 (on the laptop):** step 5 on 0.10.0: dragging a person moved only the gizmo (N1: no). REDnode's `world.move` sets the entity's transform, which the game does not apply to an NPC. 0.10.1 moves people through the game's teleportation facility (`src/move.ts`, `movePreview`, used by drags, undo, Esc and the move back after an archive swap), as REDnode teleports V, and still calls `world.move` so REDnode keeps the new place. Retest from step 5. 0.10.1 retest: still not moved by the facility teleport, and the gizmo jumped back to the start and forward again on release. 0.10.2: no live move for a person during a drag (the gizmo alone moves); on release the person's AI gets `AITeleportCommand` (position, yaw, no nav test; the call learned from what game API Appearance Menu Mod uses, no code taken), then the hold again, and if they are not within 0.3 m after 400 ms they are spawned again there (`movePerson`), the new one before the old goes; the log says which. The page keeps the dropped transforms until the mod answers, so the gizmo no longer jumps back.

Found on the laptop with 0.10.1, at a game start: People test was open on the Library tab, but its crate did not come back until the scene was closed and opened again. Two ways it could stay away, both fixed in 0.10.3: the change of `game.state().world` can be missed while previews wait for it, so they look again every 2 s as well; and a preview spawned while the save is still loading can be taken away as the load goes on (0.6.6), so a preview that leaves the world within 30 s of a load is put back. The log says which ("wait for V to be in the world", "left the world while the save was loading").
