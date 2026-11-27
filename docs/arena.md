---
title: Arena maps
---

# <span class="y">Arena maps</span>: status

For the team building generated arena maps: where each of your requests to EDGEbuilder stands, what the tests of your scene showed, what comes next, and what we need from you. This page is updated with every change in this line of work.

Last updated 2026-11-27.

## At a glance

| | |
|---|---|
| **Built, not released yet** | The command line (`check`, `bake`, `--pack`, `--dry-run`, `--json`), a JSON Schema for each scene format, the rule for how the format may change, and `generator` and `meta` fields. Planned for EDGEbuilder **0.14.0**, which ships only after its test passes ([the test](testing.md#g1-the-command-line-and-the-scene-contract-0140)). The part of the test that runs without the game passed on 2026-11-27; the in-game steps are still to run |
| **Running now** | The in-game look at your club map, baked by the command line. It loads and draws. Not all of it has been checked yet |
| **Next** | Test the command line, finish the in-game look, release 0.14.0 once its tests pass, then **B4-4 Detail** (level of detail), then **B5-4 Colliders** (your boxes) |
| **Needed from you** | Your archives (asked on 2026-11-27). Later: a check under Mod Organizer 2. See [What we need from you](#what-we-need-from-you) |

## Your requests

The numbers are the ones on [Requests](requests.md), where each is explained.

| # | Request | Status |
|---|---|---|
| E1 | A versioned scene format with a schema and a changelog | **Built**, for 0.14.0 once tested. Schemas `scene-1`, `scene-2`, `scene-3`, the rule for change and the format changelog are on [Scene format](scene.md) |
| E2 | Check and bake from a command line, game closed, with a report | **Built**, for 0.14.0 once tested. See [The command line](#the-command-line). `npx` comes later |
| E3 | Decals and particles in the bake | Planned: B5-2 decals, B5-3 particles and effects. After the Sector Tools and world-object phases. Whether decals come earlier is still open |
| E4 | Forced LOD and a hide distance per object | **Hide distance works today** for meshes: Seen from, since 0.8.1. LOD is **B4-4 Detail**, which starts with a probe. It is next after 0.14.0 |
| E5 | Collision from your boxes, or none | **None works today**: leave `solid` out. **Boxes are B5-4**. On 2026-11-27 it moved up to come right after B4-4 |
| E6 | Hand edits back as a diff, by stable ids | Planned: G3, last. Ids are yours and stay stable today, and `meta` is kept on each object (built) |
| E7 | Validation: missing appearance, overlaps, floating | **Built** for appearance pairs and overlaps (`check`). Floating needs the game's collision and comes in G2, in the editor |
| E8 | A fixed "booth" scene with three lights | After B5-1 lights and REDnode's shot list |
| E9 | Decal preview: which faces, which way round | With B5-2 decals |
| E10 | Dry run | **Built**: `check`, and `bake --dry-run`. A dry run on the service's tools comes as they are added |
| E11 | Stable, versioned interfaces | **Written**: the rule on [Scene format](scene.md) also covers the service's tool names |
| E12 | Mod Organizer 2 | Half: `bake --out <folder> --pack` writes the `archive/pc/mod` layout MO2 wants, into any folder you name. What EDGEbuilder sees inside a game run by MO2 needs your check (G-6) |

## What your scene showed

All with your second sample: 4,965 objects, with `bounds` on the 1,191 objects that use your own files.

**Baking, game closed** (G-1, answered):

| | Objects | Time | Result |
|---|---|---|---|
| All three maps | 4,965 | 7.5 s | One sector, streaming box 454 × 361 × 352 m |
| The club map | 3,501 | 5.8 s; 9.2 s with the command line's checks and `--pack` | One sector |

The command line's `check` on the club map gave two warnings: 910 objects use 311 files that are not on our PC (yours, expected), and **two pairs of objects sit in nearly the same box**, one of them a door lintel placed twice. That may be worth a look in your generator.

**In the game, so far (2026-11-23, partly run):**

| Question | Answer so far |
|---|---|
| Does a sector baked by the command line load? | **Yes.** The club map draws: floor, walls, trusses, chains, sofas, crates, lights and clutter, with shadows. Only objects on the game's own files draw (2,591 of 3,501): the rest need your archives |
| G-2: does one sector of this size load, and what does it cost? | It loads. The hitch as it comes in and the frame rate inside are still to measure. All three maps in one sector are still to try |
| G-3: does the far side pop in? | The hall still draws from a few hundred metres away. Pop-in distances are still to measure |
| G-4: can the editor open the scene, one preview per object? | Still to run |
| G-5: does a new bake come into the running game without a restart? | An archive swap with the hall in view took 89 ms with no crash. Whether the game then uses the new sector is still to check |
| G-6: Mod Organizer 2 | Needs your setup (below) |

**Collision.** The map stands about 50 m above the desert below it (ground at z 62.4, objects at z 110 to 124). Nothing in the sample is solid, so V falls through, and the look is done with EDGEbuilder's free camera. We baked a copy with `solid` on every mesh to see how far the meshes' own collision gets you:

| Meshes in the club map | Count |
|---|---|
| Game meshes with collision data (can be solid) | 1,476 |
| Game meshes without collision data | 907 |
| Your own meshes (not checked: not on our PC) | 903 |

Three of the four floor pieces and many wall pieces have no collision data. **The map cannot be walked without your collision boxes**, which is why B5-4 moved up.

## The command line

It is planned for 0.14.0, in the package as `edgebuilder/cli.mjs`, once [its test](testing.md#g1-the-command-line-and-the-scene-contract-0140) passes. It runs with Node. It needs REDbridge and the game's folder (it was tested with REDbridge 0.17.0). Until 0.14.0 is released, it runs untested from the repository's `main` branch: `npm install`, `npm run build`.

```
node edgebuilder/cli.mjs check my_arena.scene.json
node edgebuilder/cli.mjs bake my_arena.scene.json --out build/arena --pack --json
```

| Option | Meaning |
|---|---|
| `--out <folder>` | Bake into a plain folder laid out like a project |
| `--project <path>` | Bake into a REDcode or WolvenKit project, as the Bake tab does |
| `--pack` | With `--out`: pack into `packed/archive/pc/mod/<name>.archive` with its `.xl`. `packed` is then a mod folder for a mod manager |
| `--dry-run` | Everything up to writing. The report lists what would be written |
| `--json` | One JSON report: counts, `errors`, `warnings`, `dropped` (id, kind, why), `needs`, `written`, the streaming box. Exit code 0, 1 for errors, 2 for bad usage |
| `--archive <file>`, `--root <folder>` | A mod's `.archive`, or loose files, to look in before the game's |
| `--overlap <share>` | Report objects that fill nearly the same box (0.98 by default, `off` for none) |
| `--offline` | `check` the file alone, without REDbridge or the game |

Every option, the report's fields and each error and warning code: [Generated scenes, The command line](generated-scenes.md#the-command-line-g1), its part "G1 as built".

In the scene file, `generator` (`name`, `version`, `build`) says which program wrote it, and `meta` on an object holds anything of yours. EDGEbuilder keeps both when it saves, copies `meta` to a duplicate, and never bakes either.

## What comes next

In order:

| # | Step | What it gives you |
|---|---|---|
| 1 | Finish the in-game look (G-2 to G-5): the hitch and frame rate, pop-in distances, opening the scene in the editor, all three maps in one sector, and whether a swapped-in bake is used | Whether a big scene must be baked as several sectors, and whether big scenes are edited in the game or in REDcode's sector view (G2) |
| 2 | Test the command line and the scene contract (11 steps), then release **0.14.0** once all its tests pass | The command line and the schemas, released |
| 3 | **B4-4 Detail**: a probe of what a baked mesh node can hold (it has no forced LOD field, and `lodLevelScales` is untried), then a Detail setting per object | Props that keep their finest shape at a distance (E4) |
| 4 | **B5-4 Colliders**: a probe of the nine fields where your `worldCollisionNode` differs from ours, then a `collider` kind in the scene and the bake | Your boxes baked by EDGEbuilder (E5), so the maps can be walked |
| 5 | Sector Tools (the 3D view and previews), world objects, editing the world, quest places | EDGEbuilder's other planned work |
| 6 | The rest of B5: lights, decals, particles and effects, sounds | E3, E8, E9 |
| 7 | **G2** big scenes in the editor, **G3** the round trip | E6, E7's floating check |

## What we need from you

| What | Why | State |
|---|---|---|
| **Your archives** for the meshes your scene uses | So the in-game look draws all 3,501 objects of the club map, not 2,591, and `check` can read your files | Asked on 2026-11-27 |
| **A check under Mod Organizer 2** (G-6), after 0.14.0 | We have no MO2 setup. The question: inside a game run by MO2, does EDGEbuilder see your mods (Assets tab, Mods), and does the Bake tab see a bake installed through MO2 as in the game? | Steps will follow with 0.14.0 |
| Your view on decals before world objects | Decals (B5-2) moving ahead of world objects is still open. You said decals decide whether you can leave your current tool | Welcome any time |
| Notes on the command line once you try it | Missing report fields, unclear codes, options you need | Welcome any time |

Nothing is needed for the collision probe: your account of your boxes is its starting list.

## More detail

- [Requests](requests.md): each request and where it lands.
- [Generated scenes](generated-scenes.md): the plan for G0 to G3, the command line, and collision.
- [Detail settings](detail.md): B4-4.
- [Scene format](scene.md): formats 1 to 3, the schemas, the rule for change, the format changelog.
- [Tests](testing.md#g0-generated-scenes-the-look): the in-game look's steps and results.
- [Changelog](changelog.md): what each release changes.
