---
title: B1 test
---

# B1 Browse and drop: the in-game test

What B1 built: the asset index read from your game through REDbridge, an Assets tab that searches it, Drop in front of me, a Scene tab with select, delete, rebuild and clear, and a Settings tab. Built on 2026-10-13. Outside the game, the index, the search, the bridge client and the scene file pass `npm run smoke` against the real game files, and the page was checked in REDnode's host without the game (results below). The drop itself needs the game.

## Before you start

| Need | Why |
|---|---|
| REDnode 0.15.1 or later deployed | `api.$new`, `world.spawn` and the entity events (W1) |
| Codeware 1.14 or later | REDnode's world support compiles only with it |
| REDbridge 0.6.0 | `mesh.infoMany` for the asset details. EDGEdeck's Get REDbridge or Update REDbridge fetches it; EDGEbuilder finds that copy by itself |
| EDGEbuilder 0.1.1 installed | With EDGEdeck 0.20.0 or later: Add mod, pick `edgebuilder-0.1.1.zip` from the [releases page](https://github.com/Edgemodders/EDGEbuilder/releases), turn it on, Deploy. Or `tools\deploy.ps1` from the repo |

Use REDnode's **Test timer**: Start, then Mark after each step, so the log lines line up with what you did.

## Steps

1. Start the game and load a save in an open spot, for example outside V's apartment building. Press F10, open the Mod Manager, switch **EDGEbuilder** on and pin it to the launcher. The window opens at the top right. Mark.
2. Read the three pills at the top. Expected: **World ready**, **REDbridge 0.6.0**, and either **Indexing...** with progress lines for a few seconds, then a count around 31,500 assets. If the REDbridge pill is red, hover it for the reason and check the Settings tab. Mark.
3. Assets tab: type `cargo crate`. Expected: a list of meshes and entities within a moment, file names with the kind at the right. Click `cargo_crate_a.mesh`. Expected: the Picked panel shows the path, a size in metres, and a list of appearances (cargo_crate_a has 18). Mark.
4. Face an open spot and press **Drop in front of me**. Expected: a crate appears about 3 metres in front of V, facing V, within about half a second; the message line says how long it took; the Scene tab lists `cargo_crate_a` with its kind. The game's outline may or may not show on it: say which. Mark.
5. Pick another appearance in the Picked panel, press Drop again. Expected: a second crate with that appearance beside the first (both spawn at the same spot in front of V, so step a little between drops). Mark.
6. Switch to **Entities** and search `vending` or `atm`. Click one, Drop. Expected: the entity appears as it does in the game, with its own appearance. Mark.
7. Scene tab: click a crate in the list, then **Delete**. Expected: it vanishes from the world and the list. Mark.
8. Load another save, or the same one again. Expected: the previews are gone; the message says how many objects the scene has and to press **Rebuild previews**. Press it. Expected: the crates and the entity come back where they were. Mark.
9. Press **Clear scene**. Expected: everything goes. Mark.
10. Quit the game. Send `red4ext/logs/rednode-mods.log` (the `[edgebuilder]` lines), `red4ext/logs/rednode-overlay.log` and, if anything failed, `red4ext/logs/redscript_rCURRENT.log`.

## What the test decides

| Question | Decides |
|---|---|
| Does the drop take under a second and land where expected | B2 can rely on `world.spawn` as is |
| Does the game's outline show on a selected preview | B2 draws its own selection on the overlay canvas if not |
| Does the frame rate hold with ten previews in the world | Whether B2 needs to throttle moves |
| Does Rebuild bring everything back after a save loads | The scene file is the truth, as designed |

## Results

### Before the game: the page in REDnode's host, 2026-10-13

REDnode host 0.15.1 off-screen on the laptop, no game, REDbridge 0.6.0 against the game's files. The page was driven through Chromium's DevTools protocol and looked at with the kernel MCP server's `window_image`.

| Check | Result |
|---|---|
| Start | The mod started, REDbridge came up in about 6 s, the index built in about 5 s and loaded from its cache on the next start |
| Search | `cargo crate` gave 20 results in about a second; the Meshes and Entities tabs filter as expected |
| Pick | `cargo_crate_a.mesh` showed its path, 1.2 x 1.5 x 1.2 m and 18 appearances |
| Drop without a game | Refused with "Not connected to the game. Start the game with REDnode, then load a save." |

Fixed before the in-game test, in 0.1.1:

| Problem | Fix |
|---|---|
| Without a game, the first pill said "Needs Codeware 1.14+" | A "No game" state; the mod rechecks whenever the host links to the game or loses it |
| The page overflowed the window: the Drop button was cut off and the message line, the only feedback after a drop, was below the edge | The message sits under the status pills; the lists are shorter |
| Some assets were listed twice | A file the game ships in two archives (base and patch) is one asset now: 31,571 instead of 32,416 |

### In the game, 2026-10-13: passed

On the owner's PC, EDGEbuilder 0.1.1 installed with EDGEdeck 0.20.1 after Vortex was purged and RED4ext, redscript and Codeware were added to EDGEdeck; REDnode 0.15.1; REDbridge 0.6.0. All ten steps behaved as expected, as the owner reported them.

| Step | Result |
|---|---|
| 1 to 2: open, status pills | As expected |
| 3: search and pick `cargo_crate_a.mesh` | As expected |
| 4 to 5: drop two crates, two appearances | Both appeared in front of V, in 357 and 443 ms from the click. "Not instant, but no real noticeable lag" |
| 6: drop an entity | Two vending machines (`v_vending_machine.ent`, `vending_machine_weapons_1.ent`) in 418 and 416 ms: no slower to spawn than the crates. The owner saw them take a fraction longer, most likely the larger model's textures streaming in after the entity was there |
| 7: delete | As expected |
| 8: rebuild after a save loads | On the load all four previews detached and the mod said "4 objects in the scene; press Rebuild previews"; Rebuild brought all four back in the same second, where they were |
| 9: clear scene | As expected |
| 10: logs | `rednode-mods.log` and `rednode-overlay.log` (host 0.16.0): no errors or warnings from EDGEbuilder. REDbridge was ready 4 s after the mod started and the index built 2 s later. The mod process peaked at 166 MB while building the index and settled at 144 MB; the other mods sat at 100 to 120 MB |

| Question | Answer | What it decides |
|---|---|---|
| Does the drop land quickly where expected | Yes, without noticeable lag | B2 relies on `world.spawn` as it is |
| Does the game's outline show on a selected preview | **Yes** | B2 uses the game's own highlight for selection; the overlay canvas draws only the gizmo and helpers |
| Does the frame rate hold with ten previews | Yes. Game calls stayed at about 33 a second and under 1 ms a frame all session, before and after EDGEbuilder opened, with one blip to 45 a second at a drop. The game ran at 230 to 310 fps with the overlay passive and flipped between about 30 and 65 fps whenever it was interactive (F10), from the first F10, before EDGEbuilder was open: the game's or the driver's frame limit while the cursor is up, not the mod | B2 measures it again while dragging, the heavier case |
| Does Rebuild bring everything back after a save loads | Yes | The scene file is the truth, as designed |

**B1 passed.** Next: B2 Position.
