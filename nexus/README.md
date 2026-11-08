# EDGEbuilder on Nexus Mods

The source of EDGEbuilder's Nexus Mods page lives here, so updates are edits in the repo, not in Nexus's text box, as REDnode's and REDagent's are.

| File | What it is |
|---|---|
| `description.bbcode` | The page's description, in Nexus's BBCode. Placeholders in parentheses, in cyan italics (SCREENSHOT), are replaced before the first release |
| `nexus.json` | The page, the main file's upload settings (`upload`), and after a pull the ids found and the hash of the description last pulled |
| `README.md` | This page: the other fields of the Nexus form, the download, and how to update |

## The page

The page is [36627](https://www.nexusmods.com/cyberpunk2077/mods/36627), made by the owner (mod id 14315126034195 in `nexus.json`). It has no files yet. Pulled on 2026-11-08, its description was still Nexus's template for a new page, so `description.bbcode` keeps EDGEbuilder's own draft. The pull's fingerprint of the template is in `nexus.json`, which lets the first release push the draft over it.

From the first release on, the Release workflow's **Update Nexus Mods** box uploads each release: the zip as the main file (the first one on a new page, then a new version with the old one archived), the version's changelog, and `description.bbcode`. It stops first if the description was edited on Nexus since the last pull: then `npm run nexus:pull`, merge with `git diff nexus/`, commit, and run it again.

## The pictures

Done on 2026-11-08: the owner uploaded the six pictures to the page and put them in the description on Nexus, and `npm run nexus:pull` brought them back here. For a new picture, the same way:

| In `description.bbcode` | Replace with |
|---|---|
| Each `(SCREENSHOT: <file>, ...)` line | Upload the picture to the page's Images tab, then replace its line with `[img]<the image's Nexus URL>[/img]` and a one-line caption |

The pictures are the owner's wiki screenshots: full size in `Documents\EDGE Screenshots originals\edgebuilder\`, 1920 wide in EDGEweb's `docs/assets/shots/edgebuilder/` (the same names, `.png` and `.webp`). If pictures are added on Nexus by hand instead, run `npm run nexus:pull` afterwards and commit, so the next release does not stop.

## The Nexus form

| Field | Value |
|---|---|
| Mod name | EDGEbuilder |
| Version | EDGEbuilder's version, from `edgebuilder/rednode-app.json`; the release sets it |
| Category | Modders Resources and Tutorials, as REDnode's and REDagent's |
| Brief overview | A world builder inside Cyberpunk 2077: pick any mesh or entity from your game or mods, drop it into the live world, position and arrange it from a free camera, save scenes, and bake them into the world as a real mod. Runs on REDnode. (255 characters at most; this is 233) |
| Author | Edgemodders |
| Language | English |
| Primary image | `docs/assets/brand/nexus.png` (1280 x 640, `tools/brand/render.ps1`): the social layout with room at the top for the EDGEmodders header the owner adds by hand, as REDnode's and REDsave's. The banner (`docs/assets/brand/banner.png`) is already at the top of the description |
| Requirements | REDnode (its Nexus page; note: "0.58.0 or later"), Codeware (note: "1.14 or later"), EDGEdeck (note: "For REDbridge 0.12.1 or later: open EDGEdeck once and press Get REDbridge."). Optional, noted as such: REDcode (note: "To bake: a project to bake into, 0.10.5 or later."), ArchiveXL (note: "In the game, for what you bake.") |
| Permissions | MIT: open source, free to modify and redistribute with the license notice |
| Tags | Modders resource, utility, world editing |

Tags cannot be set through Nexus's v3 API (only read): set them by hand on the page.

## The download

One main file: `EDGEbuilder-<version>.zip` (`tools/release/zip.mjs`, run by `npm run package`), the same file as on the GitHub release. It is laid out like the game folder, so Vortex, EDGEdeck and an extract by hand put it in the same place:

```
red4ext/plugins/REDnode/apps/edgebuilder/
  rednode-app.json, index.html, app.js, mod.mjs, service.mjs
  LICENSE.txt, README.txt
```

**Mod Manager Download is on** (`"modManager": true`): EDGEbuilder is a game mod, a REDnode package in the game folder. EDGEbuilder bundles no third-party code (esbuild and TypeScript only build it), so the zip needs no notices file.

### File description on Nexus

The release workflow sets it from `upload.description` in `nexus.json` ({version} is replaced):

> EDGEbuilder {version} for game 2.5, a world builder inside the game. Needs REDnode 0.58.0 or later and Codeware; REDbridge 0.12.1 or later (Get REDbridge in EDGEdeck) for the asset list and baking. Install with Vortex or EDGEdeck, or extract into the game folder.

## Updating the page

The page is kept through Nexus's v3 API (`tools/nexus/nexus.mjs`, on top of `tools/nexus/api.mjs`, both copied unchanged from REDnode: keep the copies the same, and copy them again when REDnode's change) with the owner's key: on the dev PC a file in `%APPDATA%\Edgemodders` that Windows encrypts for the owner's user (see `api.mjs`), in CI the organization's `NEXUS_KEY` secret.

| Command | What it does |
|---|---|
| `npm run nexus:status` | The page's version, the main file's versions, and whether the description changed on Nexus since the last pull |
| `npm run nexus:pull` | Writes the live description into `description.bbcode` and the ids and hash into `nexus.json`. Read only on Nexus. Then `git diff nexus/` and merge |
| `node tools/nexus/nexus.mjs check --version <v>` | What a release would do, and whether it may |
| `node tools/nexus/nexus.mjs release --version <v> --zip <zip> --notes <file> [--dry-run]` | What the workflow runs: the upload, the changelog and the description. It skips the upload and changelog when the version is already on Nexus |
| `node tools/check-bbcode.mjs nexus/description.bbcode` | Checks the BBCode's tags (REDnode's checker, copied unchanged). The workflow runs it before the Nexus check |

To change the description:

1. `npm run nexus:pull` first, and commit what it changed, so an edit made on Nexus is not lost.
2. Edit `description.bbcode`, check it with `node tools/check-bbcode.mjs nexus/description.bbcode`, commit, push.
3. The next release pushes it.

For a new version, first the release gate: every in-game test of the builds since the last release has passed (`docs/testing.md`). Untested or failed means no release. Then:

1. In `docs/changelog.md`, rename **Unreleased** to `## <version> (<date>)` and start a new empty **Unreleased** above it. Update README.md's status line and badge (CLAUDE.md, "README at each release"). Commit and push.
2. Run the **Release** workflow with **Make a release** and **Update Nexus Mods** ticked:
   `gh workflow run release.yml --repo Edgemodders/EDGEbuilder --ref main -f release=true -f nexus=true`.
   It checks the page first, builds, makes the GitHub release, then uploads the zip to Nexus (the old version archived, the page's version set), adds that version's changelog from `node tools/release/notes.mjs <version> --nexus`, and pushes the description.
3. If the Nexus step fails after the GitHub release, download the release's zip and run `node tools/nexus/nexus.mjs release --version <v> --zip <zip> --notes <file>` on the dev PC (the notes from `node tools/release/notes.mjs <v> --nexus --out <file>`).

Keep these in step with the repo's status (README, docs/index.md):

| Where in the description | Update when |
|---|---|
| The STATUS box near the top | The preview ends, or the tested game version changes |
| "What you can do" | A phase adds something a player or modder would notice (B5 lights and more kinds, B3c NPCs) |
| "Requirements" | A required mod or its minimum version changes (`requires` in `edgebuilder/rednode-app.json`, REDbridge for baking) |

## BBCode used

Nexus's BBCode has no tables or Markdown, so the page uses only: `[b]`, `[i]`, `[size=2..5]`, `[color=#hex]`, `[center]`, `[quote]`, `[line]`, `[list]` with `[*]`, `[url=...]` and `[img]`. Square brackets that are not tags confuse the checker, so placeholders use parentheses. The banner is linked from this repo's `main` branch on GitHub, so it must stay at its path. The colours are the house palette: yellow `#fcee0a` for headings, cyan `#19f3ff` for highlights.
