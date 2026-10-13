# EDGEbuilder: notes for Claude sessions

EDGEbuilder is a world builder for Cyberpunk 2077 that runs as a REDnode package: pick an asset from the game's own files, drop it into the live game, position it, arrange a scene, bake it into a streaming sector. Read [docs/design.md](docs/design.md) first: the behaviours, the two halves, the pieces, what it needs from the other repos, and the roadmap B0 to B7.

## Current status and next step

- **B0 Decide (2026-10-13):** the design is written, the repo is in the house style, and `edgebuilder/` is a package that installs into REDnode and opens an empty window. Not yet tested in game.
- **Next: B1 Browse and drop.** It needs REDnode additions first: constructing native objects and setting properties through `api`, Codeware's entity callbacks as events, and resource references as arguments. The design's "What EDGEbuilder needs from the other repos" table is the list to hand to the REDnode session. REDbridge's `archive.search` already covers the asset list. Stop after each phase for the owner's in-game test and record the results in a `docs/b<N>-results.md` page, as REDnode does.

## Clean room

The idea comes from World Builder by keanuWheeze (Nexus 20660), a CET mod whose license reserves its code, forks and competing versions. The owner's rule (2026-10-13): study it to understand functionality and which game systems it uses, then write our own from scratch. **Never copy** its Lua, classes, file formats, data lists (its path lists are extracted game data) or archive assets. Design from behaviours and the game API; when a feature looks like it is drifting into World Builder's shapes, stop and redesign.

## Conventions

- **Commits:** commit straight to `main` and push, in small logical commits. Agree the plan in chat first. A PR only for large or risky changes, and ask before opening one.
- **Git identity:** per repo, `CyberbuildsAI` with the GitHub no-reply email. Never change the global identity.
- **Never commit game files** or data extracted from them: archives, meshes, entities, DLLs, the asset index, scenes with the owner's paths. `.gitignore` covers the common cases. The one shipped archive, EDGEbuilder's empty entity, is authored as JSON in this repo and built by REDbridge; the built `.archive` is never committed.
- **House style:** the README with the HUD banner, badges and a status callout; `docs/` rendered by Jekyll with the HUD layout and deployed by `.github/workflows/pages.yml` (Settings > Pages > Source must be GitHub Actions); `tools/brand/` generates the images (`.\tools\brand\render.ps1`, needs Chrome or Edge; `python -I tools/brand/badges.py docs/assets/brand/badges` for the badges alone). REDnode's CLAUDE.md is the canonical source of these idioms.
- **Writing style:** plain, short sentences, tables for comparisons. The behaviours are Browse, Drop, Position, Arrange, Bake, Return; use those words. REDnode's terms: package, overlay app, Node mod, the host, the plugin, `api`.
- **Package layout:** `edgebuilder/` is what deploys; `src/` is TypeScript built into it. `tools/deploy.ps1` mirrors `edgebuilder/` into `<game>\red4ext\plugins\REDnode\apps\edgebuilder` for development (REDnode deployed first, game closed). Players will install it with REDdeck once REDdeck knows the `rednode` kind.
- **Data:** scenes live in the REDcode project (`source/scenes/<name>.scene.json`) or, without one, in `pkg.dataDir`; the asset index and settings always in `pkg.dataDir`. Never write into the package folder: hot reload watches it.

## Docs site

- `docs/` is published at https://edgemodders.github.io/EDGEbuilder/. `index.md` is the landing page with the document ledger and the roadmap status table; keep that table current with every phase.
- `docs/design.md` is the design; bump its draft number when it changes materially. Results pages per phase go beside it and into the ledger and `nav` in `docs/_config.yml`.
