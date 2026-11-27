---
title: Generated scenes
---

# Generated scenes: a scene a program wrote

Draft 1, 2026-11-22. Status: **agreed with the owner on 2026-11-22**, all six recommendations at the end, for phases G0 to G3 of the [roadmap](design.md#roadmap). It answers the requests of 2026-11-22 ([Requests](requests.md)). Each phase is still planned in detail when it starts, and G0's answers may change G1 and G2.

Until now a scene comes from a person: Browse, Drop, Position, Arrange, then Bake. Some modders build a place with a program instead: a generator lays out rooms, props, lights and decals, thousands of them, and writes the result to a file. They want that file baked into the game with nobody clicking, on a build machine, with the game closed. A person then walks the result, moves a few things by eye, and wants those touches kept when the generator runs again.

## Behaviours

| Behaviour | What the modder does | Who does the work |
|---|---|---|
| **Write** | Their generator writes a scene file by the published format | The modder's program |
| **Check** | Runs a command; gets a list of what is wrong and what a bake would leave out | EDGEbuilder's command line, REDbridge |
| **Bake** | Runs a command; gets a sector, a block and an `.xl`, or a packed archive, and a report | EDGEbuilder's command line, REDbridge |
| **Open** | Opens the generated scene in EDGEbuilder in the game | The editor |
| **Touch up** | Moves, removes or adds a few objects by hand | The editor |
| **Take back** | Gets what they changed as a small file their generator, or a merge, can use | EDGEbuilder's command line |

Bake and Check never need the game running, only its files. Open and Touch up are the editor as it is, at a size it has not been tried at.

## What is there already

| Piece | State |
|---|---|
| The format | [Scene format](scene.md): format 1 pinned, 2 pinned (people), 3 a draft (world edits). Object ids are the writer's own and EDGEbuilder never renames one |
| The bake without the game | REDbridge's `sector.build` reads the game's files, not the running game. `scripts/bake-probe.mjs` bakes and packs a scene from a script |
| The bake's own rules | `src/bake.ts`, without REDnode: what is left out (`bakeInput`), which meshes cannot be solid (`solidForBake`), removals, the `.xl`, the bake record. Built into `dist/core.mjs` and run by the smoke test |
| Collision left out | A mesh without `solid` bakes draw-only. Only the editor sets `solid` on new meshes; a generator's file says what it wants |
| How far an object is seen | `streaming` per object ([Detail settings](detail.md)) |

## What is missing

| Gap | Why it matters to a generator |
|---|---|
| A schema | A program needs a file to validate against, not a page to read |
| A rule for change | Builds are frozen and run again months later. Before 1.0 the design only says "scene files may still change between previews" |
| A supported command | A probe script is not something to build on |
| A report | An automated build must know what was dropped, as data |
| Knowledge of size | The largest scene baked so far held about 200 objects. One sector per scene, and one preview spawn per object, were chosen for hand-made scenes |
| A way back | A hand edit to a generated scene is lost at the next generation |

## The team's sample (2026-11-22)

The team that asked sent one real build the same day, rewritten by their own script into scene format 1: a club map of 3,501 objects, and all three maps of the build in one scene of 4,965 (4,592 meshes, 364 lights, 9 entities, 481 different files). With it: a file of everything format 1 has no field for, their 1,370 collision boxes, and how they bake those. The sample is theirs and is not in this repo.

**It reads as format 1 without a change**: unique ids, no stray fields, one flat group per map. About a quarter of the meshes and seven entities are files of their own mod, which this PC does not have.

**The first numbers for G-1**, on the owner's PC with the game closed, through `sector.build` and `project.pack` from a script (REDbridge 0.17.0 from its checkout):

| Run | Result |
|---|---|
| The whole scene, 4,965 objects | Refused before writing, as it should be: each object whose file is not in the game's archives is named, with what to do (bounds in the scene, or the mod's archive) |
| The 3,774 objects that use the game's own files | Baked in 9.0 s after a 3.4 s start; packed in 26 ms. One sector of 368 KB, an archive of 123 KB, two warnings (two ladders with no bounds in their file) |
| **The second sample, 2026-11-23:** the whole scene, 4,965 objects, with `bounds` on the 1,191 objects that use the team's own files | Baked in 7.5 s after a 3.1 s start; packed in 20 ms. One sector of 488 KB, an archive of 156 KB. 1,193 warnings: one for each object whose bounds came from the scene ("the game needs the mod that has it") and the two ladders |
| The club map alone, 3,501 objects, 910 with `bounds` | Baked in 5.8 s; one sector of 337 KB, an archive of 111 KB, 912 warnings |

So the bake itself is not the problem at this size: **G-1 is answered for time** (memory was not measured). Whether the game is happy with 4,965 nodes in one sector (G-2 to G-5) is still the owner's look in the game.

**What the second sample showed:**

| Finding | What follows |
|---|---|
| `objects[].bounds` did what [the format](scene.md) says: the bake took the scene's box and never asked for the file. Nothing else differs from the first sample | A generator can bake against files that are not on the PC that bakes. G1's page says so, and that the game still needs the mod |
| All but two of the bake's 1,193 warnings say the same thing | The command line's report groups warnings by kind and by file, with the ids as a list: G1 |
| The three maps in one scene give one sector whose streaming box is 454 × 361 × 352 m | G-2's look uses the club map alone first (53 × 60 × 13 m), then all three: a box that size holds much of the city around it, so it also asks whether one scene should become one sector per group |
| The team's meshes do not draw without their archives | The look in the game shows only the 3,774 objects on the game's files unless the team sends the archives. They offered to; the owner decides |

**What the sample adds to the plan:**

| Finding | What follows |
|---|---|
| A generated scene leans on the modder's own archives | The command line needs `--archive` and `--root`, as the Bake tab passes them, and `sector.build` takes one mod at a time today: several archives is a question for REDbridge. Bounds in the scene file are the other way, and `check` should say which objects lack both |
| Every mesh has `streaming` 150 and no `solid` | Both work as documented. Nothing to add |
| Their "extras" file is a list of what the format lacks | Per mesh: detail and shadow casting. Per light: local shadows, the shadow fade, a hide distance, a source radius. Devices (a ladder with its controller). Decals (917), particles (168), fog volumes (3). The first two go to [Detail settings](detail.md); the rest are B5's kinds, and fog volumes are new to B5's list |
| A light's colour as 0 to 255 loses a little on dim, deep colours | B5's lights take a linear colour as well. The team keeps the exact one in the extras meanwhile |
| They think in Euler angles and convert to quaternions | The format stays quaternions. The page says which order the engine uses, since they had to work it out |
| Under Mod Organizer 2 every mod is a folder of its own, laid out `archive/pc/mod/...` | `bake --pack` writes exactly that layout, or a zip of it. That is G-6's answer for the bake. What EDGEbuilder's Node mod sees of such a game is still open |
| The scale on 1,182 objects is not uniform | Their walls are a cube mesh stretched. Worth one object in the G0 look: a stretched mesh with Solid |

## The contract (G1)

**The schema.** One JSON Schema file per format, in this repo and published with the docs site at a fixed address: `docs/schema/scene-1.schema.json`, `scene-2`, `scene-3`. The smoke test checks every scene the tests write against it, so the schema cannot drift from the code.

**The rule for change**, written on the scene format page:

| Change | What happens |
|---|---|
| A new optional field that an older reader can ignore safely | Same format number. Listed in the format's changelog with the EDGEbuilder version that first reads it |
| A new kind, a new list, or a field an older reader must not ignore | A new format number. As today, EDGEbuilder writes the new number only for a scene that uses the new thing |
| An older format | Every later EDGEbuilder reads it and bakes it the same. From 1.0 this is already promised; the proposal is to promise it from G1 for formats 1 and 2, which are pinned |
| Removing or renaming a field | Never within a format |

**A format changelog** on the scene format page: per format and per added field, the date, the EDGEbuilder version and the REDbridge version that bakes it.

**Fields for the writer.** Two additions, both optional and ignored by the bake:

| Field | Meaning |
|---|---|
| `generator` (top level) | `{ "name", "version", "build" }`: who wrote the file. Kept by EDGEbuilder when it saves |
| `objects[].meta` | Anything the writer wants to find again (a room id, a rule name). Kept untouched by EDGEbuilder, copied to a duplicate, never read |

Whether EDGEbuilder keeps unknown fields today when it saves a scene is not checked yet; G1 makes it a tested promise for these two.

**Interfaces.** The same rule binds the service's tool names (`scenes`, `refs`, `select`, `focus`, ...): a name or a field is not removed or renamed without a new name beside it for at least one release, and the changelog says so under **Changed**.

## The command line (G1)

A Node program built from the modules that need no REDnode, shipped in the package and run with Node: `node <...>/edgebuilder/cli.mjs`, or `npx` once it is on npm. It needs REDbridge and the game's folder, found as EDGEbuilder finds them or given as options.

| Command | Does | Writes |
|---|---|---|
| `check <scene>` | The schema, then everything the Bake tab checks, plus the checks below | Nothing. A report |
| `bake <scene> --out <folder>` | `check`, then the bake into a plain folder laid out like a project's `source` | The sector, the block, the `.xl`, the bake record. A report |
| `bake <scene> --project <.cpmodproj>` | The same into a REDcode project, exactly as the Bake tab does | As the Bake tab |
| `bake ... --pack` | Then packs with REDbridge's `project.pack` | An archive and its `.xl`, ready for a mod folder |
| `bake ... --dry-run` | Everything up to writing | Nothing. The report says what would be written |
| `diff <base> <edited>` | G3, below | A diff file |

Every command takes `--json` and then prints one JSON report: the scene's name and hash, counts by kind, **`dropped`** (id, kind, why), `warnings`, `errors`, the files written, the streaming box, the mods the scene needs, REDbridge's and EDGEbuilder's versions. The exit code is 0, 1 for errors, 2 for bad usage. `--out` names any folder, which is also the answer for a mod manager with virtual folders: the build decides where the files go.

**Checks beyond the Bake tab's:**

| Check | How | Where |
|---|---|---|
| A mesh and appearance pair that does not exist | `mesh.infoMany` already returns each mesh's appearances | `check`, offline |
| Objects that overlap | Each object's box from its size and transform, tested against its neighbours; reported above a share of overlap the caller sets, since props on a table overlap the table's box on purpose | `check`, offline |
| Objects that float or sink | Needs the world's collision, which only the running game has | Not offline. In the editor (G2): a raycast down from each object, listed in the Objects drawer |

### G1 as built (2026-11-23 on the `cosmic` branch; merged into `main` on 2026-11-27, for 0.14.0 once tested)

The first slice is built and checked outside the game: the schemas, `generator` and `meta`, `check`, and `bake` with `--out`, `--project`, `--pack`, `--dry-run` and `--json`. `diff` is G3. It runs from a checkout or from the installed package:

```
node edgebuilder/cli.mjs check my_arena.scene.json
node edgebuilder/cli.mjs bake my_arena.scene.json --out build/arena --pack --json
```

| Option | Meaning |
|---|---|
| `--out <folder>` | Bake into a plain folder laid out like a project: `source/archive/edgebuilder/<name>/`, `source/resources/archive/pc/mod/<name>.archive.xl`, `source/raw/edgebuilder/<name>.bake.json` |
| `--project <path>` | Bake into a REDcode or WolvenKit project (its folder or `.cpmodproj`), as the Bake tab does. The project's own loose files count as there |
| `--pack` | With `--out`: pack the folder's bakes into `packed/archive/pc/mod/<name>.archive` with every `.xl` beside it. `packed` is then a mod folder as a mod manager wants it. A project is packed by REDcode or WolvenKit |
| `--name <name>` | With `--pack`: the archive's name; the scene's when left out |
| `--dry-run` | Everything up to writing; the report lists the files a bake would write |
| `--json` | One JSON report and nothing else |
| `--archive <file>`, `--root <folder>` | A mod's `.archive`, or a folder of loose files, to look in before the game's. One of each: REDbridge reads one at a time |
| `--overlap <share>` | Report pairs of objects that fill nearly the same box: the share of the two boxes that both cover. 0.98 when left out, `off` for none |
| `--offline` | `check` only: the file itself, without REDbridge or the game |
| `--bridge <exe>`, `--game <folder>` | REDbridge and the game. Else `EDGEBUILDER_BRIDGE` and `EDGEBUILDER_GAME`, else the REDbridge EDGEdeck fetched, and the game in Steam's libraries or GOG's folders |

**The report** (`--json`): `ok`, `scene` (`file`, `name`, `slug`, `format`, `hash`, `generator`), `counts` by kind, `errors` and `warnings`, `dropped` (`id`, `kind`, `why`), `needs` (files REDbridge did not find: the game needs the mod that has them), `written`, `nodes`, `removals`, `streamingBox`, `packed`, `redbridge`, `checked` (`file` or `files`), `ms`. The same finding on many objects is one entry with the objects' `ids`; a finding about one file has `file`, one about many has `files`. The exit code is 0, 1 for errors, 2 for a command that cannot be read.

| Code | Error or warning | Means |
|---|---|---|
| `schema` | Error | The file does not match its format's schema |
| `duplicate-id`, `duplicate-ref` | Error | Two objects share an id or a node reference |
| `bad-number` | Error | A position, turn or scale is not a number |
| `nothing-to-bake` | Error | No object or removal a bake can write |
| `file-missing` | Error | A file that is not in the game's files nor the named mod, on an object without `bounds` |
| `unreadable`, `no-redbridge`, `no-game`, `redbridge`, `redbridge-old` | Error | The file, REDbridge or the game could not be used |
| `file-not-here` | Warning | A file that is not on this PC, on objects with `bounds`: baked, and the game needs the mod |
| `appearance` | Warning | A mesh or entity has no appearance by that name |
| `no-collision` | Warning | A solid mesh without collision data: baked to draw only |
| `same-place` | Warning | The same file at the same place, turn and scale twice |
| `overlap` | Warning | Two objects fill nearly the same box |
| `unknown-field`, `unknown-group`, `rotation-length`, `solid-not-mesh` | Warning | A field EDGEbuilder does not read, a group that is not listed, a rotation that is not a unit quaternion, `solid` on something that is not a mesh |
| `file-unread`, `removal-refused`, `not-checked`, `redbridge` | Warning | REDbridge could not read a file, did not write a removal, `--offline` skipped the file checks, or REDbridge said something else |

**Checked on the team's club map** (3,501 objects, REDbridge 0.17.0 from its checkout): the file checks take 1.3 s after REDbridge's 3.2 s start, and `bake --pack` 9.2 s in all. Two warnings instead of 912: 910 objects on 311 files that are not on this PC, and two pairs of objects in nearly the same box (a door lintel placed twice among them). The overlap measure was first "share of the smaller box" and found 6,288 pairs, since everything in the hall lies inside its outer shell; it is now the share of the space both boxes cover.

**Still to do in G1:** the Euler order on the format page, `npx`, a `dryRun` field on the service's tools that write, the Bake tab's own checks sharing these (the mod is untouched so far), and the look in the game of a scene baked this way (G0's look covers it).

## Size (G0, then G2)

Nothing here is known. G0 is a probe that answers it before anything is designed: a scene of about 5,000 objects is baked, and the owner looks at it in the game. The team's own scene is that scene: with the bounds of the second sample (2026-11-23) all 4,965 objects bake, and the 3,774 on the game's files draw without the team's archives.

| Question | What it decides |
|---|---|
| **G-1** How long does `sector.build` take for 5,000 objects, and how much memory? | Whether the command line needs progress, and whether REDbridge needs work |
| **G-2** Does one sector with 5,000 nodes load, and what does it cost when V walks in? | Whether a big scene must be baked as several sectors on a grid, each streaming on its own. The design's "one sector per scene" was for small scenes |
| **G-3** With every object at its own `streaming` distance, does the far side of an arena pop in? | What [Detail settings](detail.md) must offer |
| **G-4** How long does opening the scene in the editor take with one `world.spawn` per object, and what does the game's frame rate do? | G2's shape: all previews, or only the ones near the camera, or the baked sector with previews only for what is being edited |
| **G-5** Does a newly baked sector come into the running game through an archive swap, or only at a restart? | Whether "bake, look, change, bake" can loop without restarting the game |
| **G-6** Under Mod Organizer 2, what do EDGEbuilder's Node mod and REDbridge see: the real game folder or the joined one? | Whether "in game" flags, the mod index and Import need a chosen folder |

**G2** is then an editor's part, sized by those answers ([in the game or outside it](#outside-the-game-edgebuilder-for-vs-code)): opening a big scene without a long wait, the Objects drawer and the busy bar at thousands of rows, the float check, and a `scenes()` service that does not send 5,000 objects when asked for a list.

## Outside the game: EDGEbuilder for VS Code

The out-of-game half is already agreed: [EDGEbuilder for VS Code](library.md#edgebuilder-for-vs-code), phases E1 to E4. A generated scene is the use that needs it most, since its modder works with the game closed.

| Fact | What follows |
|---|---|
| The command line and the extension run the same code: the scene and bake modules that need no REDnode | G1 is the first slice of E3 ("a scene edited with the game closed bakes the same"), not a side track |
| REDcode has built the sector view (REDcode 0.10.15 and 0.10.16): a sector drawn in 3D with a flying camera, real materials, picking, box and volume selection, over the shared drawing package `@edgemodders/world-view` ([EDGEbuilder #8](https://github.com/Edgemodders/EDGEbuilder/issues/8)) | E2 is no longer EDGEbuilder's to build. EDGEbuilder's extension opens a sector with what REDcode built and draws its scene's objects on top |
| The package draws instanced plain meshes; E0 drew 605,801 copies of 6,522 meshes | 5,000 generated objects are small for it. In the game they are 5,000 preview spawns, which G-4 has yet to measure |
| Only the running game has the world's collision | The float check stays in the game. Overlaps, the diff and the bake work outside it |

So **G2 is decided after G0**: big scenes in the in-game editor, in the sector view outside the game, or both. If G-4 says the game cannot hold 5,000 previews, the sector view is where a generated scene is opened and touched up, and the game is where it is walked once baked.

**How the scene gets on top** is proposed, not agreed: EDGEbuilder as a plugin of REDcode's sector view, so the modder has one view and EDGEbuilder adds its layers, actions and panel to it. See [EDGEbuilder as a plugin of REDcode's sector view](library.md#edgebuilder-as-a-plugin-of-redcodes-sector-view). The other way, a second view of EDGEbuilder's own built on the package, stays possible if the plugin contract cannot carry editing.

## The round trip (G3)

The generator owns the scene; the person owns a few touches. Neither should overwrite the other.

| Rule | Detail |
|---|---|
| Ids are the key | The generator gives every object a stable id (the same object gets the same id in the next build). EDGEbuilder never changes an id it did not make |
| Hand-made objects are marked | An object the editor adds gets an id with a prefix the generator does not use (`hand_`), so both sides can tell |
| The base is kept | When EDGEbuilder first saves a change to a scene with a `generator` field, it keeps the file as it arrived beside it (`<name>.base.scene.json`) |
| The diff is a file | `diff` compares base and edited: `changed` (id, and only the fields that differ: transform, appearance, streaming, solid, group, props), `added` (whole objects), `removed` (ids), with the base's hash |
| Merging is the modder's | Their generator reads the diff and applies it to the next build. A `merge <new base> <diff>` command that does the obvious thing, and lists what no longer applies (a changed object the generator dropped), is a convenience on top |

The diff is a pure function over two scene files, so it lives beside `arrange.ts`, without REDnode, in the smoke test.

## Collision

| Wanted | Answer |
|---|---|
| No collision from the bake, the modder bakes their own | Works today: leave `solid` out. G1 documents it |
| Solid from the mesh's own collision data | Works today: `solid: true` |
| Their own boxes, baked | Not yet. The solid probe wrote `worldCollisionNode` boxes that did nothing in game, with three fields guessed. It becomes a `collider` kind in B5-4, and the team's account of their own baked boxes (below) is its first lead |

**The team's boxes against the probe's.** They bake one `worldCollisionNode` per box and report that V stands on them and that cover works in game. Their node differs from the one the solid probe wrote in the fields the probe guessed:

| Field | The solid probe (did nothing) | The team's (works for them) |
|---|---|---|
| `resourceVersion` | 0 | 2 |
| `lod` | 0 | 1 |
| `sectorHash` | 0 | The FNV-1a 64 of the sector's path with backslashes, `mod\rogue_arena_collision\ra_owned_collision.streamingsector`. Checked on 2026-11-23: it gives the number in their sample. The first check here read two `\r` in the path as line ends, an error of ours. They have not tested whether the game reads the field |
| `staticCollisionShapeCategories` | Absent | Five rows of six, two of them set |
| The buffer's flags | 7471104 | 4063232 |
| The box's turn | On the actor | On the shape, the actor unturned |
| Proxy type | 11, written as a number | `CharacterObstacle` |
| The buffer | Raw bytes | WolvenKit's typed collision buffer, as JSON |
| Streaming | By the object's size | 200 m, both distances |

So B5-4's probe has a short list: write the probe's box again with these values, one at a time where it is cheap, and see which one made the difference. The team cannot shorten it (2026-11-23): their recipe worked at its first test in the game, so no field was ever tried alone. **Clean room:** the team says World Builder's collider export was a reference for their first bake. EDGEbuilder takes none of these values on their word: each is checked against the game's own collision nodes and WolvenKit's writer before it is written, as the solid probe did.

## Not in this

| Left out | Why |
|---|---|
| Reading another editor's files | The clean-room rule, and "imports from other editors" is in the design's Not in v1 |
| Decals, particles, lights for a generator | They arrive with B5, kind by kind, in the same format and through the same command line |
| Running the generator | It stays the modder's program. EDGEbuilder only reads its file |

## Phases

| Phase | Delivers | Ends with |
|---|---|---|
| **G0** Probe | A script that writes and bakes a 5,000-object scene; answers G-1 to G-6 | The owner walks through it in the game, and the numbers are on the tests page |
| **G1** Contract and command line | The schemas, the rule for change, the format changelog, `generator` and `meta`, `check` and `bake` with reports and dry run | A scene written by a script is checked and baked on a PC with the game closed, and loads in the game |
| **G2** Big scenes in an editor | Decided after G0: the in-game editor, the sector view outside the game (E3), or both; and the float check in the game | A 5,000-object scene opens, one object is moved, and it is baked again |
| **G3** Round trip | The base copy, `diff`, `merge` | A hand edit survives a new generation |

## Recommendations, agreed on 2026-11-22

| # | Recommendation |
|---|---|
| 1 | Take generated scenes on as a use of EDGEbuilder, with phases G0 to G3 |
| 2 | G0 and G1 come right after 0.13.0's tests, before S2 and B3b: they are small, need little of the game, and G1 is work 1.0 needs anyway |
| 3 | Promise from G1 that formats 1 and 2 are read and baked the same by every later version; format 3 joins when D1 and D2 pin it |
| 4 | The command line ships inside the package and later on npm; REDcode's "Bake" command ([REDcode #2](https://github.com/Edgemodders/REDcode/issues/2)) can call it |
| 5 | `generator` and `meta` are added to the format as optional fields, without a new format number |
| 6 | Ask the team for one of their generated scenes and how they write collision boxes: a real file is a better probe than a made-up one. Done on 2026-11-22: see [The team's sample](#the-teams-sample-2026-11-22) |
