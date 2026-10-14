# EDGE<span class="y">builder</span> docs

EDGEbuilder is a world builder for Cyberpunk 2077 that runs inside the game on REDnode: pick an asset from the game's own files, drop it into the live world, put it in place, arrange a scene, and bake it into a streaming sector that loads like any other mod. These pages hold the design and the results of each phase.

| Document | What it covers |
|---|---|
| [Design](design.md) | The behaviours (Browse, Drop, Position, Arrange, Bake, Return), the runtime and project halves, the pieces, the preview in the game, the editor, files, baking, what it needs from REDnode, REDbridge, REDcode and REDdeck, risks, roadmap |
| [Scene format](scene.md) | The scene file, format 1: the contract between the runtime builder, the project builder and REDbridge's bake |
| [B1 test](b1-test.md) | The in-game test for Browse and drop: what to install, the steps, what the result decides |
| [B2a test](b2-test.md) | The in-game test for positioning: the Edit switch, the gizmo, keys, floor, scale; what to install and what the result decides |
| [B2b test](b2b-test.md) | The in-game test for the editor camera and builder mode |
| [World Builder study](study.md) | What a world builder does and which game systems it touches, learned from World Builder; behaviours only, nothing copied |
| [Dev setup](dev-setup.md) | How to build the package and put it in the game for development |
| Source | [github.com/Edgemodders/EDGEbuilder](https://github.com/Edgemodders/EDGEbuilder) |

## Roadmap status

As of B2b passed in game (2026-10-14); 0.3.1 fixes what the test found. Next: B3, its plan to be agreed first. The scene format is pinned and REDbridge can already bake one.

| Phase | Status |
|---|---|
| B0 Decide | Done: the design, the repo, the package |
| B1 Browse and drop | Built (EDGEbuilder 0.1.1): the asset index from the player's game through REDbridge (31,571 meshes and entities in 4 s), search, Drop in front of me through REDnode's world API with a base-game empty entity and a mesh component, select, delete, rebuild after a save loads, settings. The index, the search, the bridge client and the scene file pass the smoke test on real game files, and the page passed a check in REDnode's host without the game (three fixes in 0.1.1). **Passed in game on 2026-10-13**: drops land quickly, the game's outline shows on the selected preview, Rebuild restores the scene after a save loads. Results in [B1 test](b1-test.md) |
| B2a Position | Built (EDGEbuilder 0.2.0): the full-screen viewport with an Edit switch, the gizmo (arrows and a turn ring), picking in the world, drags, G R S with axis locks and typed numbers, the Selected panel's numbers, drop to floor, mesh scale; REDbridge through REDnode's `kernel.bridge()`, Codeware declared in `requires`. **Passed in game on 2026-10-14**: the projection lands 0.0 px from the game's, drags follow at the game's frame rate without lowering it, drop to floor and scale work. 0.2.2 hides the gizmo with Edit off and sends moves once a frame without waiting. Results in [B2a test](b2-test.md) |
| B2b Camera | **Passed in game on 2026-10-14** (EDGEbuilder 0.3.0; 0.3.1 fixes what it found): a camera of EDGEbuilder's own while Edit is on (V stays put), look and fly, orbit, pan, dolly, frame; builder mode hides the game's HUD through V's scene tier; drops land where the camera looks; the world stays loaded far from V. Results in [B2b test](b2b-test.md) |
| B3 Arrange and save | Not started |
| B4 Bake | REDbridge side done (0.6.0): `sector.build` bakes a scene into a sector, a block and an `.xl`, verified by the probe but not yet loaded in the game. REDdeck 0.20.0 installs REDnode packages. Left: the bake panel in EDGEbuilder, and the in-game test |
| B5 Lights and more kinds | Not started |
| B6 Comfort | Not started |
| B7 Project builder | Not started |
