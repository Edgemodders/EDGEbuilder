# Remove Doors changelog

What changed in each release of Remove Doors, a small REDnode app shipped beside EDGEbuilder, for its Nexus page (https://www.nexusmods.com/cyberpunk2077/mods/39060) and its GitHub release. The same rules as EDGEbuilder's changelog (`docs/changelog.md`): a line under **Unreleased** with each change a player would notice, grouped **New**, **Changed**, **Fixed**, **Other**; before a release, rename **Unreleased** to `## <version> (<date>)`, with the version from `pack.json`, and add the short Nexus summary under the heading (`<!-- nexus` ... `-->`).

## Unreleased

**New**

- The first version: the game's doors near V in a list (working doors and painted-on doors, each with a switch), with their state; **Show all** outlines them in the game, and a picked one gets a red outline.
- **Remove** takes the picked door out of the world, with the stand-in the game shows in its place, so the doorway is open and V walks through.
- Removed doors are listed, each with **Bring back**, and stay removed in every save while the app is on. **Bring all back**, or switching the app off, returns them.
