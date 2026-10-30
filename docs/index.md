# EDGE<span class="y">builder</span> docs

EDGEbuilder is a world builder for Cyberpunk 2077 that runs inside the game on REDnode: pick an asset from the game's own files, drop it into the live world, put it in place, arrange a scene, and bake it into a streaming sector that loads like any other mod. These pages hold the design and the results of each phase.

| Document | What it covers |
|---|---|
| [Design](design.md) | The behaviours (Browse, Drop, Position, Arrange, Bake, Return), the runtime and project halves, the pieces, the preview in the game, the editor, files, baking, what it needs from REDnode, REDbridge, REDcode and EDGEdeck, risks, roadmap |
| [World objects](world-objects.md) | Picking, inspecting, copying and changing what the game already placed: the plan for B3b and B4b, with the probes that come first |
| [Library and world view](library.md) | Agreed: the Library, where scenes and bakes live and flow into projects, and EDGEbuilder for VS Code with a map of the whole world and a sector view |
| [World inspector](world-inspector.md) | Agreed: an inspector built into EDGEbuilder, like RED Hot Tools' World Inspector: inspect, scan and look up anything the game placed, hide it for the session; what it needs from REDnode |
| [Scene format](scene.md) | The scene file, format 1: the contract between the runtime builder, the project builder and REDbridge's bake |
| [Tests](testing.md) | Every test so far in one place: the automated ones, the page check in REDnode's host, and each in-game test with its result and what it found |
| [B1 test](b1-test.md) | The in-game test for Browse and drop: what to install, the steps, what the result decides |
| [B2a test](b2-test.md) | The in-game test for positioning: the Edit switch, the gizmo, keys, floor, scale; what to install and what the result decides |
| [B2b test](b2b-test.md) | The in-game test for the editor camera and builder mode |
| [World Builder study](study.md) | What a world builder does and which game systems it touches, learned from World Builder; behaviours only, nothing copied |
| [Changelog](changelog.md) | What changed in each release, newest first; the release notes come from it |
| [Dev setup](dev-setup.md) | How to build the package and put it in the game for development |
| Source | [github.com/Edgemodders/EDGEbuilder](https://github.com/Edgemodders/EDGEbuilder) |

## Roadmap status

As of 2026-10-30 (design draft 4): B2b passed in game on 2.31, the 0.3.4 check on game 2.5 on 2026-10-29, and the bake probe on 2026-10-30 (baked sectors load on 2.5). B2c-1 (0.4.0) is built and waits for its in-game test. After it: B3, B4, B3c, B3b, B4b, B4c. The scene format is pinned and REDbridge can already bake one (not yet loaded in game). The first public release (a preview) follows B4 and 1.0 follows B4b and B5's lights: see [Release stages](design.md#release-stages).

| Phase | Status |
|---|---|
| B0 Decide | Done: the design, the repo, the package |
| B1 Browse and drop | Built (EDGEbuilder 0.1.1): the asset index from the player's game through REDbridge (31,571 meshes and entities in 4 s), search, Drop in front of me through REDnode's world API with a base-game empty entity and a mesh component, select, delete, rebuild after a save loads, settings. The index, the search, the bridge client and the scene file pass the smoke test on real game files, and the page passed a check in REDnode's host without the game (three fixes in 0.1.1). **Passed in game on 2026-10-13**: drops land quickly, the game's outline shows on the selected preview, Rebuild restores the scene after a save loads. Results in [B1 test](b1-test.md) |
| B2a Position | Built (EDGEbuilder 0.2.0): the full-screen viewport with an Edit switch, the gizmo (arrows and a turn ring), picking in the world, drags, G R S with axis locks and typed numbers, the Selected panel's numbers, drop to floor, mesh scale; REDbridge through REDnode's `kernel.bridge()`, Codeware declared in `requires`. **Passed in game on 2026-10-14**: the projection lands 0.0 px from the game's, drags follow at the game's frame rate without lowering it, drop to floor and scale work. 0.2.2 hides the gizmo with Edit off and sends moves once a frame without waiting. Results in [B2a test](b2-test.md) |
| B2b Camera | **Passed in game on 2026-10-14** (EDGEbuilder 0.3.0; 0.3.1 fixes what it found): a camera of EDGEbuilder's own while Edit is on (V stays put), look and fly, orbit, pan, dolly, frame; builder mode hides the game's HUD through V's scene tier; drops land where the camera looks; the world stays loaded far from V. Results in [B2b test](b2b-test.md). 0.3.4 passed its check on game 2.5 on 2026-10-29 ([Tests](testing.md#034-check-on-game-25)) |
| Bake probe | **Passed 2026-10-30**: baked sectors load on 2.5, with the scene's streaming distances; entities are solid, plain meshes not ([Tests](testing.md#bake-probe)): one crate through REDbridge's `sector.build` (0.11.0 writes 2.5 sectors), packed, deployed, loaded with EDGEbuilder off |
| B2c Mod assets | **B2c-1 built 2026-10-30 (0.4.0), waiting for its in-game test** ([Tests](testing.md#b2c-1-mod-assets)): Browse lists installed mods' and the open REDcode project's meshes and entities, "This scene needs", solo mode in Edit, previews kept after an archive swap. B2c-2 (a mod file's size and appearances, baking mod files) after [REDbridge #12](https://github.com/Edgemodders/REDbridge/issues/12) ([issue #1](https://github.com/Edgemodders/EDGEbuilder/issues/1)) |
| B3 Arrange and save | Not started |
| B4 Bake | REDbridge side done (0.6.0; 2.5 sectors from 0.11.0): `sector.build` bakes a scene into a sector, a block and an `.xl`, not yet loaded in the game. EDGEdeck 0.20.0 installs REDnode packages. Left: the bake panel in EDGEbuilder, and the in-game test |
| B3c NPCs and scenes through REDnode | Agreed 2026-10-23 with REDnode's H2c: an `npc` kind ([format 2 draft](scene.md#format-2-draft-npcs)). REDnode's side passed in game on 2026-10-26 (0.40.1): `world.load` reads our scenes and the draft |
| B3b World objects | Agreed 2026-10-29: [World objects](world-objects.md). Starts with probes; probe 1 answered by REDnode's `world.near` |
| B4b Edit the world | Agreed with B3b: the game's own objects hidden or changed, baked as ArchiveXL sector edits |
| B4c Quest places | Planned for EDGEquest's Q4 ([issue #3](https://github.com/Edgemodders/EDGEbuilder/issues/3)): spots, trigger areas, map markers and NPC spawns with refs, listed through EDGEbuilder's service |
| B5 Lights and more kinds | Not started |
| B6 Comfort | Not started |
| B7 Project builder | Not started |
