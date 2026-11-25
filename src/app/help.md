# EDGEbuilder

<p class="version">Version {{version}}, for Cyberpunk 2077 2.5</p>

A world builder that runs inside the game. You find a model, drop it into the world, move it until it sits right, arrange a scene, and bake the scene into a mod, so the objects are part of Night City for anyone who installs it.

Two words you will meet everywhere:

- A **preview** is an object you placed that is not baked yet. Only you see it, and only while EDGEbuilder runs.
- To **bake** a scene is to turn it into a mod: its objects then stand in the world without EDGEbuilder.

## Before you start

The three pills at the top say whether everything is ready:

| Pill | Ready when it says | If not |
|---|---|---|
| World | **World ready** | Load a save |
| REDbridge | **REDbridge** and its version, in green | Hover it for why. It reads the game's files and bakes |
| Index | About **31,600 assets** | It says **Indexing...** for a few seconds the first time |

## First scene in five steps

1. **Library** tab: type a name in **Name**, pick a folder in the tree, press **New scene here**. The scene is saved after every change from now on.
2. **Assets** tab: type `crate`. Typing anywhere on the tab goes into the search box.
3. Click a result. **Selected Asset** shows its size and its looks (appearances): click one.
4. Press **Drop where I look**, or **Drop at click** and click the spot in the world.
5. Switch **Edit** on (top right of this window), click the crate, and drag its arrows.

## Find something

- **Search** finds the game's meshes, entities and people by name. The tabs under the box narrow it by kind (**Meshes**, **Entities**, **NPCs**) and by where it comes from (**Game**, **Mods**, **Project**). The ✕ in the box clears it.
- **Explorer**: the folder button beside the search box. The game's own folders, each mod, the open REDcode project and the game's people, opened one folder at a time. Typing filters the folder clicked last; its arrows make it wider. A search result you click is found in it too. A pick shows the model in 3D beside it: drag to turn it, the wheel zooms. **Drop** starts Drop at click.
- **Preview** switch, beside the result count: with it on, a click on a result shows it in that same 3D drawer.
- **Previews**, the eye beside it: the results as small 3D pictures. Rest the mouse on one to turn it; a click shows its details beside them, with **Drop**. In Settings, **A picture's details before Drop** off makes a click start Drop at click at once.

A **mesh** is a plain 3D model. An **entity** is a model with parts and behaviour, such as a device. A **person** (NPC) stands friendly and idle.

## Drop it

- **Drop where I look** puts it in front of you, on what the camera looks at.
- **Drop at click**: the object's outline sits under the cursor, where a click would put it (amber over the sky). Click to drop. <kbd>Esc</kbd> or a quick tap of the right button cancels; hold the right button to look and fly as usual, and the outline follows what is under the cursor.

## Edit mode and the camera

Switch **Edit** on to work in the world: the mouse works in the world, the game's HUD hides and EDGEbuilder looks through a camera of its own. V stays where V stood. Both can be switched off in **Settings**.

| To | Do |
|---|---|
| Look around | Hold the right mouse button and move the mouse |
| Fly | Right button held, <kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd>, <kbd>Q</kbd> down, <kbd>E</kbd> up; <kbd>Shift</kbd> faster, the wheel sets the speed |
| Orbit the selection | Middle button; with <kbd>Shift</kbd> it pans; the wheel moves closer |
| Frame the selection | <kbd>F</kbd> |

A help line at the bottom of the screen always says what you can do next. <kbd>F10</kbd> hands the mouse back to the game: V’s view and the HUD come back, and Edit picks up where it was at the next <kbd>F10</kbd>.

## Position

Click an object to select it. Its **gizmo** has red, green and blue arrows (drag one to move along it) and a yellow ring (drag it to turn).

| Key | Does |
|---|---|
| <kbd>G</kbd> <kbd>R</kbd> <kbd>S</kbd> | Move, turn, scale (meshes) with the mouse |
| then <kbd>X</kbd> <kbd>Y</kbd> <kbd>Z</kbd> | Lock to one axis; type a number for an exact amount |
| <kbd>Enter</kbd> or a click | Keep it |
| <kbd>Esc</kbd> or a right-click | Put it back |
| <kbd>Ctrl</kbd> while dragging | Snap to steps |
| <kbd>Ctrl</kbd>+<kbd>E</kbd> | Drop to the floor |
| <kbd>Delete</kbd> | Remove it from the scene |

**Selected Object** on the Scene tab takes exact numbers: X, Y, Z, Heading, Scale, and **Seen from**, how far off it is seen once baked. **Solid** makes a mesh stop V once baked, when its mesh carries collision data.

## Arrange

| Keys | Does |
|---|---|
| <kbd>Ctrl</kbd>+click, <kbd>Shift</kbd>+drag, <kbd>Ctrl</kbd>+<kbd>A</kbd> | Add to the selection, select in a box, select all |
| <kbd>Ctrl</kbd>+<kbd>G</kbd>, <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>G</kbd> | Group, ungroup. A click selects the whole group, <kbd>Alt</kbd>+click one object |
| <kbd>Ctrl</kbd>+<kbd>D</kbd> | Duplicate: the copy follows the mouse until a click puts it down |
| <kbd>Ctrl</kbd>+<kbd>C</kbd>, <kbd>Ctrl</kbd>+<kbd>X</kbd>, <kbd>Ctrl</kbd>+<kbd>V</kbd> | Copy, cut, paste where the cursor points |
| <kbd>Ctrl</kbd>+<kbd>Z</kbd>, <kbd>Ctrl</kbd>+<kbd>Y</kbd> | Undo, redo (the last 100 changes) |

A move, turn or scale acts on the whole selection, around its middle.

## Scenes and the Library

- The open scene is saved after every change. <kbd>Ctrl</kbd>+<kbd>S</kbd> confirms it, <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>S</kbd> saves a copy under a new name. Its name is at the top of the **Scene** tab (Enter renames it).
- The **Library** tab lists every scene: in the **Library** (your own folders, shared by the EDGE tools, `Documents\EDGE Library` unless you choose another in Settings), in the open REDcode project, and on **This PC**.
- Pick a scene to **Open** it, **Close** it, or **Show in world** beside the one you are editing (shown, not editable). **Objects** lists a scene's objects in a drawer: two clicks fly the camera to one.
- The icon at the top right of the tree moves the Library out of the window into a drawer. The drawer's arrows make it wider or narrower. **Objects**: the eye on a row shows the object in 3D beside the drawer, with **Drop a copy** (its look, scale and settings kept).
- EDGEbuilder opens the last scene again when it starts.

## Import a model of your own

1. Library tab: type the path of a `.glb` file in the box at the top, or press the folder button beside it to find it on your disk. Models in the Library, in the project's `source\raw` and on EDGEfab's Desk are listed in the tree too.
2. Pick it. The Import box asks for a **Name**, a **Height** (for a model with no real size) and how solid it is.
3. Press **Import**. It goes into the open REDcode project, is packed and comes into the running game. Making textures takes most of the time; **Stop** ends it.
4. It is then picked on the Assets tab, ready to drop.

## The game's own objects

The **World** tab:

- **Nearby** finds the doors near V (**Scan Doors**). With **Edit** on, a click picks a door. The switches choose what a click picks: doors, painted-on doors, meshes.
- **Pick under the cursor** (in Selected Node): what a click would pick is outlined as the mouse moves, and a click picks any mesh or door. Its details open in a drawer at the left of the screen: the model in 3D, its kind, size, place, node and sector, and whether it is **solid** where you clicked. **Drop a copy** puts a copy in your scene. **Show tooltip**, beside it, puts the name, kind, size and distance of whatever is under the mouse in a tooltip next to it in the world.
- **Remove from world** takes a door, a painted-on door or a mesh out, kept in the scene. **Restore** or Undo brings it back. A bake removes it for good.
- **Open**, **Close**, **Lock** keep a door that way while the scene is open.
- **Sectors** lists the pieces the game streams the world in: near V, near the camera, or by name. A sector's drawer lists every entry in it: pick, fly to, hide for the session or remove.

## Bake

1. Open a project in REDcode (VS Code). The **Bake** tab names it, and checks the scene.
2. Press **Bake**. The scene becomes a streaming sector of its own in the project.
3. In REDcode, **Pack and Install** (or add it in EDGEdeck and deploy), then start the game again: a bake comes in as the game starts.

The previews of a scene whose bake is in the game stay off, so nothing stands twice. **Bake into Library**, on the Library tab, keeps a bake there that can hold several scenes; **Include in project** copies it into a project. People are not baked yet.

## Settings

The REDbridge and game folders (found by themselves when empty), the editor camera and HUD switches, a picture's details before Drop, the Library folder, **Rebuild asset index** and **Restart REDbridge**.

## More help

The full guide, with pictures: `edgemodders.ai/wiki/edgebuilder`

Questions and bugs: `github.com/Edgemodders/EDGEbuilder/issues`

EDGEbuilder is inspired by World Builder by keanuWheeze. It is its own design and uses none of World Builder's code, files or data.
