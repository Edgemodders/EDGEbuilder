# Remove Doors changelog

What changed in each release of Remove Doors, a small REDnode app shipped beside EDGEbuilder, for its Nexus page (https://www.nexusmods.com/cyberpunk2077/mods/39060) and its GitHub release. The same rules as EDGEbuilder's changelog (`docs/changelog.md`): a line under **Unreleased** with each change a player would notice, grouped **New**, **Changed**, **Fixed**, **Other**; before a release, rename **Unreleased** to `## <version> (<date>)`, with the version from `pack.json`, and add the short Nexus summary under the heading (`<!-- nexus` ... `-->`).

## Unreleased

## 0.1.0 (2026-11-19)

<!-- nexus
New: Scan Doors lists the doors near V, numbered, and picks the one V is looking at
New: Remove takes the picked door out of the world with its stand-in, so V walks through
New: Removed doors stay removed in every save while the app is on; Bring back returns them
New: Jump takes V to a door you can't reach, in front of it on the floor
Needs: REDnode 0.67.3 or later and Codeware, on game 2.5
-->

For REDnode 0.67.3 or later and Codeware, on game 2.5.

**New**

- The first version: **Scan Doors** lists the game's doors near V (working doors and painted-on doors, each with a switch), numbered, with their state, and marks the one V is looking at with an eye, picked at once. **Jump** takes V to a door, in front of it on the floor. **Show all** outlines and numbers them in the game; the picked one gets an outline and a red PICKED pin.
- **Remove** takes the picked door out of the world, with the stand-in the game shows in its place, so the doorway is open and V walks through.
- Removed doors are listed, each with **Bring back**, and stay removed in every save while the app is on. **Bring all back**, or switching the app off, returns them.
