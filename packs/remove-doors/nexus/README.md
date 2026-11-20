# Remove Doors on Nexus Mods

The source of Remove Doors' own Nexus Mods page, beside EDGEbuilder's (`nexus/` at the repo root). The page is [mod 39060](https://www.nexusmods.com/cyberpunk2077/mods/39060), made by the owner on 2026-11-19 and named **Remove Doors for REDnode**. Remove Doors is a small REDnode app in this repo (`packs/remove-doors/`, its own version in `pack.json`), released with the release workflow's **Release Remove Doors** box: its own GitHub release (tag `remove-doors-v<version>`) and, with **Update Nexus Mods**, its zip, changelog and this description on the page.

| File | What it is |
|---|---|
| `nexus.json` | The page id and how a new version is uploaded (the Nexus tool in EDGErepo writes the rest) |
| `description.bbcode` | The page's description, in Nexus's BBCode, pushed by the release run. Pull before changing it: `node ../EDGErepo/tools/nexus/nexus.mjs pull packs/remove-doors/nexus` |
| `brand/banner.png` | 2560 x 640, at the top of the description (loaded from GitHub) |
| `brand/nexus.png` | 1280 x 640, the page's primary image: the social layout moved down 55 px, with the top left empty for the EDGEmodders header, which the owner adds by hand, as on REDnode's packs. Drawing it again clears the header: add it again after |
| `brand/social.png` | 1280 x 640, for links shared on social sites |
| `brand/icon.png` | 256 x 256 |
| `brand/source.html` | What the images are drawn from: `electron tools/brand/render.cjs packs/remove-doors/nexus/brand/source.html packs/remove-doors/nexus/brand banner=2560x640` (one image a run; clear `ELECTRON_RUN_AS_NODE` first; Electron from REDnode's checkout) |
| `README.md` | This page |

## The Nexus form

| Field | Value |
|---|---|
| Mod name | Remove Doors for REDnode |
| Version | From `packs/remove-doors/pack.json`; the release run sets it |
| Category | Utilities |
| Brief overview | Remove any door near V from the world, with the stand-in the game shows in its place, and bring it back any time. A small REDnode app; kept in every save while it is on. (255 characters at most; this is 173) |
| Author | Edgemodders |
| Language | English |
| Primary image | `brand/nexus.png`, with the EDGEmodders header added. The banner is already at the top of the description |
| Requirements | REDnode (note: "0.67.3 or later"), Codeware |
| Permissions | MIT, as EDGEbuilder |
| Tags | Utility, Gameplay |

## Pictures for the description

After the in-game test passes: a picture of the window with doors listed, and one of a picked door with its red outline, uploaded to the page's Images tab and added to the description under "What it does" (`[img]<the image's Nexus URL>[/img]` with a one-line caption).

## The download

One main file: `RemoveDoors-<version>.zip` (`tools/release/pack-zip.mjs`), laid out like the game folder, so Vortex, EDGEdeck and an extract by hand put it in the same place: `red4ext/plugins/REDnode/apps/remove-doors/`. It holds only the app, never REDnode's or EDGEbuilder's files.
