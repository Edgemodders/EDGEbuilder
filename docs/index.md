# EDGE<span class="y">builder</span> docs

EDGEbuilder is a world builder for Cyberpunk 2077 that runs inside the game on REDnode: pick an asset from the game's own files, drop it into the live world, put it in place, arrange a scene, and bake it into a streaming sector that loads like any other mod. These pages hold the design and the results of each phase.

| Document | What it covers |
|---|---|
| [Design](design.md) | The behaviours (Browse, Drop, Position, Arrange, Bake, Return), the runtime and project halves, the pieces, the preview in the game, the editor, files, baking, what it needs from REDnode, REDbridge, REDcode and REDdeck, risks, roadmap |
| [Dev setup](dev-setup.md) | How to build the package and put it in the game for development |
| Source | [github.com/Edgemodders/EDGEbuilder](https://github.com/Edgemodders/EDGEbuilder) |

## Roadmap status

As of B0 (2026-10-13). Nothing places objects yet.

| Phase | Status |
|---|---|
| B0 Decide | Done: the design, the repo, a package that installs into REDnode and opens an empty window. Not yet seen in game |
| B1 Browse and drop | Waiting on three REDnode additions the design lists: constructing native objects and setting properties, Codeware's entity callbacks as events, resource references as arguments |
| B2 Position | Not started |
| B3 Arrange and save | Not started |
| B4 Bake | Not started. Needs `sector.build` in REDbridge |
| B5 Lights and more kinds | Not started |
| B6 Comfort | Not started |
| B7 Project builder | Not started |
