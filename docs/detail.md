---
title: Detail settings
---

# Detail settings: how far and how finely an object is drawn

Draft 1, 2026-11-22. Status: **agreed with the owner on 2026-11-22**, all four recommendations at the end, as phase B4-4 of the [roadmap](design.md#roadmap). It answers one of the requests of 2026-11-22 ([Requests](requests.md), E4). It starts with a probe, because what the game does with these fields is not known.

A modder's playtesters complained about pop-in: objects appearing, or switching from a rough shape to a fine one, as the player walks towards them. They ask for two settings on every baked object, for one object or a whole group: a forced level of detail, and the distance at which it hides.

## Three different things pop

"Pop-in" is three engine behaviours, and each has its own setting. In plain terms:

| What the player sees | The engine's reason | Set by |
|---|---|---|
| An object is not there, then it is | **Streaming**: the game loads a node only within its streaming distance | The node data's streaming distance. In a scene: `streaming` |
| An object is there but vanishes at a distance, although its sector is loaded | **Auto-hide**: the game stops drawing small things far away, by their size | The node's own hide distance |
| An object changes shape as the player nears | **LOD** (level of detail): a mesh holds several versions, rough to fine, and the game swaps them by distance | Unknown for a baked node: the probe below |

**What the team found (2026-11-22, with their sample).** Their pop-in had three causes in the other tool, which draws objects as entities at run time, and a fourth row belongs in the table above:

| What popped in | Their fix there | For a baked node |
|---|---|---|
| Mesh detail | A forced LOD level of 0 on the mesh component | The probe below. They agree the field is not on a node: they want the effect, full detail everywhere inside a small map |
| Lights, decals and particles vanishing at 40 to 45 m | A hide distance of 150 | Each node has its own field and its own default (below) |
| **Shadows switching on as the player nears**, the one players noticed most | The light's shadow fade: distance 60, range 15 | `worldStaticLightNode` has `shadowFadeDistance` 10 and `shadowFadeRange` 5 by default, which is exactly what they saw. A light setting, for B5's lights |

## What is there already

**Seen from** (EDGEbuilder 0.8.1, B4-2) covers the first two for meshes. It sets an object's `streaming` in the scene file, both distances the same, and REDbridge 0.12.1 writes the node's `forceAutoHideDistance` to match ([REDbridge #16](https://github.com/Edgemodders/REDbridge/issues/16)). Measured in game: a crate is otherwise hidden at about 60 m whatever its streaming distance. Left empty, REDbridge uses its rule by size: the largest side × 11 m, between 40 and 400.

So a generator can already write `streaming` on every mesh and have it seen that far. What is missing: a level-of-detail setting, the same for lights, decals and particles (which EDGEbuilder does not bake yet), and setting a whole group at once.

## What the nodes offer

Read from the game's own type data on 2026-11-22 (REDcode's `cr2w_describe_type`). What each field does in the game is **not** verified, except where noted.

| Node | Field | Default | Note |
|---|---|---|---|
| `worldMeshNode` | `forceAutoHideDistance` | 0 | Verified in game (B4-2): the mesh is drawn to this distance |
| `worldMeshNode` | `lodLevelScales` | all bits set | The only LOD field on the node. A packed number; its meaning is the probe's first question |
| `worldMeshNode` | `occluderAutohideDistanceScale` | 255 | About the mesh as an occluder (what it hides behind it) |
| `worldStaticDecalNode` | `autoHideDistance`, `forcedAutoHideDistance` | 20, 0 | A decal is hidden at 20 m unless told otherwise: likely much of a club's pop-in |
| `worldStaticLightNode` | `autoHideDistance` | 5 | A light's own hide distance; also `shadowFadeDistance` 10, `allowDistantLight` |
| `worldStaticParticleNode` | `forcedAutoHideDistance`, `forcedAutoHideRange` | -1, -1 | A distance and a fade range |

There is **no `forceLODLevel` on a mesh node.** The name in the request belongs to the mesh component of an entity, which is how a world builder draws objects at run time. A baked mesh is a node, not a component, so the request's setting does not carry over as it stands: either `lodLevelScales` does the job, or an object that must hold its finest LOD is baked as an entity with a mesh component, or the answer is in the mesh file itself.

## The probe (B4-4's first step)

A script like the solid probe: one mesh with clear LODs, baked a dozen times in a row, one setting each, and the owner walks away from the row.

| Question | Decides |
|---|---|
| **L-1** What does `lodLevelScales` hold, and which values keep a mesh at its finest LOD at any distance? | Whether a Detail setting is one field on the node |
| **L-2** If the node cannot hold a LOD: does an entity node whose mesh component has a forced LOD level keep it once baked? | The fallback, and its cost (an entity per object is heavier than a node) |
| **L-3** What does a forced finest LOD cost at 200, 1,000 and 5,000 objects? | What the editor warns about. Read with REDnode's `perf` |
| **L-4** Do previews in the editor show the setting, or only the bake? | Whether the Selected panel says "after the bake", as Solid does |
| **L-5** Does a decal's `forcedAutoHideDistance` and a light's `autoHideDistance` behave as the mesh's does? | Carried into B5's decals and lights, not built in B4-4 |

## Proposal

| Part | Detail |
|---|---|
| **In the scene file** | An optional `detail` on an object: `{ "lod": "full" }` or `{ "lod": <level> }`, absent meaning the game decides. An older reader can ignore it safely, so no new format number ([the rule for change](generated-scenes.md#the-contract-g1)). `streaming` stays as it is: it is already the hide distance |
| **In the editor** | A **Detail** row under Seen from in the Selected panel: Game decides, or Always full. With several objects or a group selected it sets all of them, as Seen from does; mixed values show as mixed |
| **Per group** | Stored per object, set through the selection. A value kept on the group and inherited by what is in it would be new machinery in the scene file; not proposed unless the probe or a modder shows the need |
| **In the bake** | `sector.build` writes what L-1 or L-2 finds. A `request` issue to REDbridge once the probe says which field |
| **The Bake tab** | Counts objects held at full detail and says so above a number the probe gives (L-3) |
| **Lights, decals, particles** | Their hide distances become fields of those kinds when B5 adds each, with the defaults above shown, since a 5 m light and a 20 m decal surprise people. A light also gets its shadow fade (distance and range) and local shadows: the team's most noticed pop-in. EDGEbuilder bakes lights today without any of these, so B5-1 should check what a baked light does at 10 m |

## Phase

| Phase | Delivers | Ends with |
|---|---|---|
| **B4-4 Detail** | The probe (L-1 to L-5), then `detail.lod` in the scene file, the Detail row, the bake through REDbridge | A row of baked props keeps its finest shape from across a square, and the same row without the setting does not |

## Recommendations, agreed on 2026-11-22

| # | Recommendation |
|---|---|
| 1 | Run the probe before promising the setting: the request names a field a baked mesh does not have |
| 2 | B4-4 follows G1 ([Generated scenes](generated-scenes.md)), so the new field arrives under the format's rule for change |
| 3 | Tell the team now that `streaming` already sets the hide distance for meshes: it may solve part of their pop-in today. Said in the reply to their sample, 2026-11-22 |
| 4 | Hide distances for lights, decals and particles are designed with B5, not here |
