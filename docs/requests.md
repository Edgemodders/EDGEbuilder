---
title: Requests
---

# Requests from modders

Feature requests that reach EDGEbuilder from people using it, and where each one lands in the [roadmap](design.md#roadmap). A request is placed, not promised: a placement says when it is built only once its phase is planned.

## 2026-11-22: a team building generated arena maps

**Status: placed on 2026-11-22 and agreed with the owner the same day**: the new phases G0 to G3 and B4-4, B5 split by kind, and the order below. Whether decals (B5-2) move ahead of B3b is not decided.

**Who asked.** A team building two arena maps for a roguelike mode. A generator of their own writes about 5,000 placements per build; two AI agents build and check through REDcode's MCP server and REDbridge; a person tests in the game under Mod Organizer 2. Today they place everything with another world builder at run time, which spawns the 5,000 objects every session. Their document covers every EDGE tool; the requests are ranked by the test time each would save them.

**What it means for EDGEbuilder.** They do not place by hand. For them EDGEbuilder is a **file format and a bake**, and the editor is for touch-ups afterwards. That is a use the design did not plan for, and most of it is close: the scene file is already the contract, `sector.build` already runs without the game, and the bake code already runs without REDnode. What is missing is a promise about the format, a supported command line, knowledge of what happens at 5,000 objects, and a way back from hand edits to the generator.

**Their sample, the same day.** The team sent one real build as scene format 1 (4,965 objects), the fields the format lacks, their collision boxes and how they bake them. It read as format 1 unchanged, and the 3,774 objects that use the game's own files baked in 9 s with the game closed. What it showed is on [Generated scenes](generated-scenes.md#the-teams-sample-2026-11-22); it moved E5 and E4 below. A second sample on 2026-11-23 added bounds for the objects on their own files, and the whole scene baked in 7.5 s.

### The requests for EDGEbuilder

| # | Request | Today | Where it lands | Needs a document |
|---|---|---|---|---|
| E1 | A documented, versioned scene format with a JSON schema and a changelog | [Scene format](scene.md) documents formats 1 to 3. No schema file, no format changelog, no written rule for what a later version may change before 1.0 | **G1** (new), [Generated scenes](generated-scenes.md) | Yes: written |
| E2 | Import and bake from a command line with the game closed, with a report of what was dropped | Possible but not offered: `scripts/bake-probe.mjs` does it for a probe. The bake's checks and skips live in `src/bake.ts`, which needs no REDnode | **G1** (new) | Yes: the same page |
| E3 | Decals and particles in the bake (about 900 decals and 85 emitters a map) | Not started: B5 | **B5**, split so each kind has its own step (below). Their numbers make decals the kind that decides whether they can leave the other tool | B5's own plan, when B5 starts; this page's notes feed it |
| E4 | Per-object detail: a forced LOD level and a hide distance, on meshes, lights, decals and effects, per object or per group | Half there: **Seen from** (0.8.1) sets how far a baked mesh is seen, per object, and REDbridge writes the node's `forceAutoHideDistance` from it. No LOD setting. Lights, decals and effects are B5 | **B4-4 Detail** (new, small), [Detail settings](detail.md) | Yes: written |
| E5 | Collision from their own list of boxes, or collision left out | Left out works today: a mesh without `solid` bakes draw-only. Boxes do not: the solid probe's `worldCollisionNode` boxes did nothing in game ([Tests](testing.md#b4-bake)) | Left out: **G1** documents it. Boxes: **B5**'s collider step, which starts with a probe. The team sent how they bake theirs: it differs from the probe's box in nine fields, [listed here](generated-scenes.md#collision), which is the probe's list | No: a probe in B5 |
| E6 | Hand-edit round trip: what a person changed in the editor, as a diff against the generated scene, by stable ids | Object ids are stable and the generator's own. No diff | **G3** (new) | Yes: [Generated scenes](generated-scenes.md) |
| E7 | Validation on import: overlapping, floating, or a mesh and appearance pair that does not exist | The Bake tab checks resources, ids and numbers. No appearance check, no overlap or float check | Appearance pairs and overlaps: **G1** (offline, from sizes). Floating needs the game's collision: **G2**, in the editor | Yes: the same page |
| E8 | A fixed "booth" scene with three standard lights for comparing appearances, photographed by REDnode | Nothing | **After B5's lights and REDnode's shot list**: a scene EDGEbuilder ships as a template. Small | No |
| E9 | Decal preview: which faces a decal lands on, and which way round it reads | Nothing | **B5 decals**: the editor draws the decal's box and its reading direction. The node has `horizontalFlip` and `verticalFlip`, so a mirrored decal can be turned in place | In B5's plan |
| E10 | Dry run: every write says what it would do without doing it | The Bake tab's checks run before a bake. No dry run from outside | **G1**: `check` and `bake --dry-run`. The service's tools that write get a `dryRun` field as they are added | No |
| E11 | Stable, versioned interfaces: tool names, scene format, changelog | The changelog exists. No written rule | **G1**: the rule goes on the [scene format](scene.md) page and binds the service's tool names too | Yes: the same page |
| E12 | Mod Organizer 2: Library and bake paths that work under its virtual folders | Untested. A bake goes into a REDcode project or the Library, both plain folders, so writing should work. Reading "is this bake in the game" looks in the real `archive\pc\mod`, which under MO2 may be empty | **G0** asks it as a probe question; the fix is a chosen folder. The larger part (hot swap, installs) is REDnode's and EDGEdeck's | No |

### Requests for other tools that touch EDGEbuilder

The document's other requests belong to REDnode, REDcode, REDbridge and EDGEmat. They are listed here only where EDGEbuilder's plan meets them. Passing them on as `request` issues in those repos is the owner's call; not done.

| Request (tool) | Where it meets EDGEbuilder |
|---|---|
| Shot list in one approval, settle, A/B capture (REDnode) | EDGEbuilder's editor camera already holds a pose. Once REDnode has a shot list, a scene could carry named camera spots that become the list. Not planned; noted for B6 |
| Raycast, walkability and luminance probes (REDnode) | E7's "floating" check and Drop's floor search use the same raycasts. EDGEbuilder would use a batched raycast if REDnode offers one |
| Shared-clock effects (REDnode) | A baked light has `flicker` with a `positionOffset`. Whether that is a phase two lights can share is a question for B5's lights probe |
| Search by size, and where used (REDcode) | The asset index reads a mesh's box only when the mesh is looked at, so a size filter in Browse (B6) first needs every mesh's box read once through `mesh.infoMany`. "Where used" is the sector index B3b plans, and the same data as [the world view](library.md) |
| Sector region dump (REDcode, REDbridge) | REDbridge's `sector.find` and `sector.nodes` already answer most of it, and S1 shows it in the game. "Copy the game's own arrangement into my scene" is B3b's copy, and the first step towards [tiles](design.md#the-long-term-goal-new-interiors): the team calls them donor clusters |
| Entity flattening (REDcode) | B3b's Inspect wants the same list of an entity's parts |
| Decal, particle and material previews (EDGEmat, REDcode) | B5 places these kinds; a particle system's real size is what its box in the editor needs |

### Where it goes in the order

The agreed order stays. Two new pieces go in where they cost least, and B5 is split.

| Step | What | Why here |
|---|---|---|
| 1 | 0.13.0's in-game tests (D2, S1, the project picker) | Already built and waiting |
| 2 | **G0**, a probe: one generated scene of 5,000 objects through the bake and into the game | A script and one in-game look. It decides G1's and G2's shape, and whether the bake must split a big scene into several sectors |
| 3 | **G1** The contract and the command line | No interface in the game, so no long test. It also delivers what 1.0 promises anyway (a frozen format) and what [REDcode #2](https://github.com/Edgemodders/REDcode/issues/2) wants (a bake from outside the game) |
| 4 | **B4-4 Detail** | A probe and one row in the Selected panel. Pop-in was their top playtest complaint |
| 5 | S2, S3, B3b, B4b, B4c | As agreed |
| 6 | **B5**, split: **B5-1** lights (1.0 needs them), **B5-2** decals, **B5-3** particles and effects, **B5-4** colliders, **B5-5** sounds | Each kind is its own probe, bake change and test. Whether B5-2 moves ahead of B3b for this team is the owner's choice |
| 7 | **G2** Big scenes in the editor, **G3** the round trip | G2 needs G0's answers; G3 is worth most once decals exist, since those are what a person adjusts by eye |

### What is not taken up

| Request | Why |
|---|---|
| Reading another world builder's saved files | The [clean room](design.md#where-the-idea-comes-from) rule: EDGEbuilder never reads World Builder's formats. The team's generator writes EDGEbuilder's scene file directly, which is what they ask for |
| Baked collision that EDGEbuilder computes from meshes | Out of reach now. Solid uses a mesh's own collision data; boxes are B5-4 |
