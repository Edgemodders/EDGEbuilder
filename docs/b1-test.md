---
title: B1 test
---

# B1 Browse and drop: the in-game test

What B1 built: the asset index read from your game through REDbridge, an Assets tab that searches it, Drop in front of me, a Scene tab with select, delete, rebuild and clear, and a Settings tab. Built on 2026-10-13 and checked outside the game only: the index, the search, the bridge client and the scene file pass `npm run smoke` against the real game files; the drop itself needs the game.

## Before you start

| Need | Why |
|---|---|
| REDnode 0.15.1 or later deployed | `api.$new`, `world.spawn` and the entity events (W1) |
| Codeware 1.14 or later | REDnode's world support compiles only with it |
| REDbridge 0.6.0 | `mesh.infoMany` for the asset details. REDdeck's Get REDbridge or Update REDbridge fetches it; EDGEbuilder finds that copy by itself |
| EDGEbuilder 0.1.0 installed | With REDdeck 0.20.0 or later: Add mod, pick `edgebuilder-0.1.0.zip` from the [releases page](https://github.com/Edgemodders/EDGEbuilder/releases), turn it on, Deploy. Or `tools\deploy.ps1` from the repo |

Use REDnode's **Test timer**: Start, then Mark after each step, so the log lines line up with what you did.

## Steps

1. Start the game and load a save in an open spot, for example outside V's apartment building. Press F10, open the Mod Manager, switch **EDGEbuilder** on and pin it to the launcher. The window opens at the top right. Mark.
2. Read the three pills at the top. Expected: **World ready**, **REDbridge 0.6.0**, and either **Indexing...** with progress lines for a few seconds, then a count around 32,000 assets. If the REDbridge pill is red, hover it for the reason and check the Settings tab. Mark.
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

Not run yet.
