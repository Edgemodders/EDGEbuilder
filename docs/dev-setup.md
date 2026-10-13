---
title: Dev setup
---

# Dev setup

EDGEbuilder is a REDnode package. To work on it you need REDnode deployed in the game first; its [dev setup](https://edgemodders.github.io/REDnode/dev-setup.html) covers the game, RED4ext, the plugin and the overlay host. This page covers only what EDGEbuilder adds.

| Step | Command or action |
|---|---|
| Node 22 or later | As for REDnode |
| Clone | `git clone https://github.com/Edgemodders/EDGEbuilder` beside the REDnode checkout |
| Install | `npm install` in the repo root |
| Build | `npm run build` type-checks and bundles `src/` into `edgebuilder/` (esbuild; `rednode` stays external). `npm run watch` rebuilds on save, which the REDnode host hot-reloads |
| Test | `npm run smoke` runs the bridge client, the asset index and the scene store against a real REDbridge and game when they are on the machine (`EDGEBUILDER_BRIDGE` and `EDGEBUILDER_GAME` point at them; otherwise it finds REDdeck's copy and the Steam game folder, or skips) |
| Package | `npm run package` writes `dist\edgebuilder-<version>.zip` for REDdeck |
| Deploy for development | `.\tools\deploy.ps1 -GameDir '<game folder>'` mirrors `edgebuilder/` into `<game>\red4ext\plugins\REDnode\apps\edgebuilder`. Close the game first; REDnode's apps folder must exist |
| Run from the repo instead | From `<REDnode>\packages\overlay`: `node start.js --render=cpu "--apps-dir=<REDnode>\packages\overlay\apps;<this repo>" --apps=edgebuilder` runs the host with EDGEbuilder beside REDnode's own apps. `--apps-dir` names folders whose subfolders are packages: this repo's root, not `edgebuilder\`. Without the game the page works for browsing; the kernel MCP server's `window_image` tool shows it (not in `--window` mode) |
| See it | In game, F10, the REDNODE launcher tab, Mod Manager, switch EDGEbuilder on |
| Logs | `red4ext/logs/rednode-mods.log` for the Node mod, tagged `[edgebuilder]`; the Mod log app shows it live |

Dependencies in the game, from B1 on: Codeware 1.16 or later, and ArchiveXL for the baked sectors. REDbridge for the asset index and the bake: EDGEbuilder starts the copy REDdeck or REDcode fetched, or one named in its settings.

Record every tool you install or step you change here, with versions and commands.
