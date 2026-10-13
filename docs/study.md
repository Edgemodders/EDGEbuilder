---
title: World Builder study
---

# What the World Builder study found

On 2026-10-13 we read keanuWheeze's World Builder (a Cyber Engine Tweaks mod, Nexus 20660, version 1.0.81) to learn what a world builder has to do and which game systems it uses. This page keeps the findings so later phases can draw on them. It describes behaviours and game systems only. None of World Builder's code, file formats, data lists or assets is used in EDGEbuilder, and nothing here is a specification of them. See the clean-room rule in the repo's CLAUDE.md.

## What a world builder does

| Area | Behaviours a user expects |
|---|---|
| Browse | Categories (entities, meshes, lights, decals, collision, markers, areas, AI spots), a search box, path or file-name display, hover previews, drag into the viewport, favourites with tags, a spawn popup under the cursor that lands the object on the surface and aligns it to the surface normal, repeat last spawn |
| Scene | A tree of groups and objects: rename, show or hide, drag to reorder or regroup, multi-select with Ctrl and Shift, box select by dragging, a depth list of everything under the cursor, copy, paste, duplicate, delete, group the selection, undo and redo with a long history |
| Position | A gizmo with three axis handles, Blender-style G, R, S with axis locks and typed numbers, Enter and Esc, drop to the floor with an optional surface alignment, position and rotation steps with a precision modifier, snapping |
| Groups | Plain groups; randomised groups (a seed and a rule for which children appear); scattered groups (instances spread over a rectangle, a cylinder or a polygon, with density, random rotation and scale, snap to ground) |
| Properties | Position, rotation as Euler angles, scale with an axis lock; the kind's own fields; per node a reference name, streaming ranges with an auto button, and a streaming reference point |
| Save | Scenes as files, reload, teleport to a scene, prefabs from groups, import from other tools |
| Export | A project name, one sector per top group with a category, a level, a streaming box, variants, validation (duplicate references, empty areas) and an export that a WolvenKit script turns into sector files |
| Camera | An orbit camera built from the player: the player is held at a pivot each frame and the first-person camera is offset back; middle mouse orbits, Shift pans, the wheel zooms; the player is protected from damage and put back on exit |

## The object kinds and the world nodes they bake to

| Kind | World node | Preview component |
|---|---|---|
| Entity template, device, TweakDB record | `worldEntityNode`, `worldDeviceNode`, `worldPopulationSpawnerNode` | the template itself |
| Static, rotating, cloth, dynamic, proxy mesh | `worldMeshNode`, `worldRotatingMeshNode`, `worldClothMeshNode`, `worldDynamicMeshNode`, `worldGenericProxyMeshNode` | `entMeshComponent`, `entPhysicalMeshComponent` |
| Light, reflection probe, light channel area, fog | `worldStaticLightNode`, `worldReflectionProbeNode`, `worldLightChannelVolumeNode`, `worldStaticFogVolumeNode` | `gameLightComponent`, `entEnvProbeComponent`, `entFogVolumeComponent` |
| Decal, particles, effect, sound, water | `worldStaticDecalNode`, `worldStaticParticleNode`, `worldEffectNode`, `worldStaticSoundEmitterNode`, `worldWaterPatchNode` | `entDecalComponent`, `entParticlesComponent`, `entEffectSpawnerComponent`, `gameaudioSoundComponent` |
| Collision shape, collision mesh | `worldCollisionNode` | `entColliderComponent` with a box, capsule or sphere |
| Occluder, marker, spline | `worldStaticOccluderMeshNode`, `worldStaticMarkerNode`, `worldSplineNode` | helper meshes |
| Trigger, ambient, conversation, kill, prevention-free, water-null and crowd-null areas | their area nodes, from an outline of markers | helper meshes |
| AI spot, community | `worldAISpotNode`, `worldCompiledCommunityAreaNode_Streamable` | a workspot entity and a preview NPC |

## Game systems it uses

| Purpose | Systems |
|---|---|
| Spawning previews | Codeware's static entity system (spawn, despawn, look up by id) with components created at runtime and attached while the entity assembles, through Codeware's `Entity/Initialize` and attach callbacks; the game's dynamic entity system for TweakDB records and preview NPCs |
| Resources | The resource depot and resource tokens, to read a mesh's bounds and appearance list, a workspot's rig, an entity's appearances |
| Transforms | `WorldTransform`, `Vector4`, `EulerAngles`, `Quaternion` and the game's operator functions |
| Screen and picking | `CameraSystem.ProjectPoint` for world to screen; a hand-built ray from the camera for screen to world; a physics raycast against the player-blocker group for surfaces; ray tests against oriented bounding boxes for picking, nearest first, an inner box preferred |
| Camera | The first-person camera component (field of view, local position, pitch limits), the teleportation facility, scene tier and camera bobbing settings, stats modifiers for knockdown immunity and breathing under water |
| Selection | The render highlight event on the entity |
| TweakDB | Reading records and their entity template paths |
| Reflection | Class and property introspection, to show and override any component property |

## How that shaped EDGEbuilder

- The preview is not the product; the baked sector is. EDGEbuilder bakes through REDbridge's `sector.build` instead of a WolvenKit script.
- Previews spawn through REDnode's world API, which wraps the same Codeware moment for attaching components.
- Mesh bounds and asset lists come from REDbridge reading the player's game files, not from lists shipped with the mod and not from loading resources in the game.
- The gizmo and selection outlines are drawn by the overlay, not as meshes in the world.
- The orbit camera built from the player is a verified approach and is EDGEbuilder's v1 camera too.
- Streaming ranges and references per node are not optional; the bake derives defaults from size and lets the user override them.
