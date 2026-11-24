---
title: Tools
---

# Tools: plugins for EDGE<span class="y">builder</span>

Draft 1, 2026-11-24. **A proposal, not yet agreed.** Asked for by the owner on 2026-11-24: a **Tools** tab before About, with a button for each installed tool. A tool is a REDnode package written in JavaScript or TypeScript with REDnode's UI kit. It opens in a drawer of EDGEbuilder's and works on EDGEbuilder's scene through an API EDGEbuilder offers.

## What a player sees

| Where | What |
|---|---|
| **Tools** tab, before About | A button per installed tool: its icon, name and one line on what it does. A tool switched off in the tab, or one that failed, is greyed out, with why |
| A press | The tool's drawer slides out to the left of the window, as the Explorer does. One left drawer at a time, so the others close |
| In the drawer | The tool's own controls, built from REDnode's UI kit, so they look like EDGEbuilder's. Its work shows in the world and in EDGEbuilder's panels: new objects in the scene, a changed selection, lines drawn in the viewport |
| Undo | Whatever a tool does to the scene is one step in EDGEbuilder's undo, named by the tool: "Undo Grid array" |
| First use | A one-time question: "*Grid array* wants to change your scenes. Allow?", with what it asked for. The answer is kept, and the Tools tab can take it back |

## What a tool is

A REDnode package like any other: installed with EDGEdeck, listed in the Mod Manager, hot-reloaded while it is being written. What makes it a tool is one block in its manifest.

```json
{
  "id": "grid-array",
  "name": "Grid array",
  "version": "0.1.0",
  "kind": "none",
  "requires": { "edgebuilder": ">=0.15" },
  "provides": ["edgebuilder-tool"],
  "edgebuilderTool": {
    "label": "Grid array",
    "description": "Copies the selection in rows and columns",
    "icon": "icon.svg",
    "ui": "tool.js",
    "width": 420,
    "wants": ["scene.write", "viewport.draw"]
  },
  "main": "mod.mjs",
  "service": "service.mjs"
}
```

| Part | Needed | What it is |
|---|---|---|
| `edgebuilderTool.ui` | Yes | An ES module EDGEbuilder loads into its own page when the button is pressed. Its default export mounts the tool into the drawer and gets the API |
| `edgebuilderTool.wants` | Yes | What it will use, shown in the first-use question: `scene.read`, `scene.write`, `world.read`, `viewport.draw`, `camera` |
| `main`, `service` | No | The tool's own Node half, for heavy work or files: a REDnode Node mod and service, as any package has. The UI module calls it with `service.connect('<its id>')`, which REDnode pages can already do |
| `requires.edgebuilder` | Yes | The lowest EDGEbuilder version with the API the tool uses. The Mod Manager shows a tool as waiting for a newer EDGEbuilder |

```js
// tool.js: the tool's drawer, in EDGEbuilder's page
export default function mount(el, eb) {
  el.innerHTML = `
    <rn-input id="rows" label="Rows" value="3"></rn-input>
    <rn-input id="cols" label="Columns" value="3"></rn-input>
    <rn-input id="gap" label="Gap, m" value="0.5"></rn-input>
    <rn-button id="go">Make grid</rn-button>`;
  el.querySelector('#go').addEventListener('click', async () => {
    const sel = await eb.selection();
    if (!sel.length) return eb.say('Select something first.', 'warn');
    const [rows, cols, gap] = ['rows', 'cols', 'gap'].map((id) => Number(el.querySelector('#' + id).value));
    await eb.change('Grid array', async (tx) => {
      // tx.copy, tx.move and the rest land as one undo step, saved once at the end.
      for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++)
          if (r || c) await tx.copy(sel, { offset: [c * gap, r * gap, 0], relative: 'size' });
    });
  });
  return () => {}; // unmount: called when the drawer closes or the tool reloads
}
```

## Where a tool's drawer runs

| Choice | How | For | Against |
|---|---|---|---|
| **A. A module in EDGEbuilder's page (recommended)** | EDGEbuilder's Node mod finds the tool's folder; the page `import()`s `tool.js` and calls `mount(drawer, api)` | Looks and feels native: the UI kit, EDGEbuilder's styles and keys are already there. Fast: no second page, no messages in between. The viewport can draw for it. Simple to write | The tool's code runs inside EDGEbuilder's page: a tool that hangs or throws can upset EDGEbuilder, and it could reach more than its API. Answered by the first-use question and by catching what it throws (below) |
| B. A sandboxed frame | The drawer holds an `<iframe>` of the tool's page; it talks to EDGEbuilder by messages | Isolated: a broken tool breaks only its frame | Whether a framed file page gets REDnode's `window.rednode` (for its own service, the UI kit) is unknown: a probe. Every call becomes a message. Styles and keys do not carry over |
| C. The tool's own REDnode window | The tool opens a window of its own beside EDGEbuilder's, and calls EDGEbuilder's service | Nothing new in EDGEbuilder but the API | Not a drawer: EDGEbuilder cannot place another package's window. Edit turns on solo mode, which hides every other window, the tool's too |

**Recommendation: A**, the way an editor loads its extensions. A tool is code the player chose to install, as any REDnode package is, and every change it makes to a scene still goes through EDGEbuilder, so it is checked, saved and undoable. B stays open as a later choice for tools from strangers, if one is ever needed.

**When a tool fails.** EDGEbuilder catches what `mount` and every API call throw. The drawer then says what went wrong and offers **Reload**, the button turns red, and the error goes to EDGEbuilder's log with the tool's name. EDGEbuilder never waits on a tool: a call that has not answered in 30 s gives up, as REDnode's service calls do.

## The API

What `mount` gets as its second argument. Every call returns a promise. The same functions are offered to other packages' Node mods through EDGEbuilder's service, where that makes sense, so a tool's Node half can do what its drawer does.

| Group | Calls | Needs |
|---|---|---|
| About | `eb.version`, `eb.apiVersion` | |
| The scene | `scene()`: its name, file, objects (id, kind, resource, appearance, transform, group, solid, seenFrom, bounds); `on('scene-changed')` | `scene.read` |
| Selection | `selection()`, `select(ids)`, `on('selection-changed')` | `scene.read` |
| Changing the scene | `change(label, fn)`: everything `fn` does through `tx` is one undo step, saved once. `tx.add(kind, resource, transform, props)`, `tx.copy(ids, offset)`, `tx.move(id, transform)`, `tx.remove(ids)`, `tx.group(ids, name)`, `tx.set(id, { appearance, solid, seenFrom })` | `scene.write` |
| Assets | `search(text, { kind, from })`, `look(path)`: size, appearances, collision, as EDGEbuilder's Picked panel shows them | `scene.read` |
| Placing | `dropAtClick(resource, appearance)`: EDGEbuilder's own Drop at click, with its outline; resolves with the new object's id, or null when cancelled | `scene.write` |
| The world | `raycast(origin, dir)`: what the game's physics hits; `pickPoint(prompt)`: waits for a click in the world and gives the point and the surface's normal; `cameraRay(x, y)` | `world.read` |
| The viewport | `draw(name, shapes)`: lines, boxes, points and labels in game coordinates, drawn every frame until `draw(name, [])`; gone when the drawer closes | `viewport.draw` |
| The camera | `camera()`: position and heading; `flyTo(position or id)` | `camera` |
| Messages | `say(text, 'ok' or 'warn')` on EDGEbuilder's message line; `busy(label, progress)` with Stop | |

Rules:

| Rule | Why |
|---|---|
| Ids and plain JSON only: no game references, no direct file access to scenes | Scenes stay EDGEbuilder's: checked, saved, undoable, and in the format its bake and REDnode's `world.load` read |
| `apiVersion` is a number that grows when calls are added. A call never changes shape; a different shape is a new name, and the old one keeps working for a year | Tools keep working across EDGEbuilder releases |
| A tool's drawer and drawings go when it closes, when Edit goes off, and when the tool reloads | Nothing left behind on screen |
| A typed API, `@edgemodders/edgebuilder-tool` on npm: TypeScript types and a template package | Tools written in TypeScript get the API checked as they type |

## Finding the tools

EDGEbuilder needs every installed package that provides `edgebuilder-tool`, with its manifest. REDnode's `use(role)` gives one provider, for a role a single package answers; tools need them all.

| Way | Notes |
|---|---|
| **A REDnode addition (asked for)**: `service.providers(role)`, every package providing a role, with its manifest, its folder and whether it is switched on, and an event when that changes | The clean answer. A [request](https://github.com/Edgemodders/REDnode/issues) to file, with the owner's yes |
| Meanwhile: EDGEbuilder's Node mod reads the manifests in REDnode's app folders | Works today for installed packages, but misses REDnode's development folders and needs EDGEbuilder to know REDnode's layout. Kept only until the addition ships |

## Phases

| Phase | Builds | Its test shows |
|---|---|---|
| **T0 Probe** | A sample tool's `tool.js` loaded from another package's folder into EDGEbuilder's page, using the UI kit and `service.connect` to its own Node half; the manifests found | A module from another package mounts in a drawer, its UI kit elements work, it reaches its own service, hot reload of the tool remounts it |
| **T1 Tools tab** | The tab and its buttons, the drawer, first-use question, failure handling; the read API, `say`, `select`; one sample tool (Align: line up and space out the selection) | A tool installed with EDGEdeck shows in the tab, opens, reads the selection and selects; a tool that throws shows red and does not upset EDGEbuilder |
| **T2 Changes** | `change` with one undo step, `dropAtClick`, `raycast`, `pickPoint`, `draw`; the same through EDGEbuilder's service; two more sample tools (Grid array, Scatter on a surface) | A grid of crates made and undone in one step; a scatter drawn in the viewport before it is made |
| **T3 For modders** | The npm types and template, a page in EDGEbuilder's wiki, `apiVersion` 1 pinned | A modder's tool from the template, written without reading EDGEbuilder's source |

B6 Comfort's scatter and snapping can be built as tools from T2 on, which tests the API on real work.

## Questions for the owner

| Question | Recommendation |
|---|---|
| Where the drawer runs: A, B or C | A, a module in EDGEbuilder's page |
| Ask on first use, or trust every installed tool | Ask once, with what it wants |
| Can a tool's calls also reach AI assistants (as `@tool`s in EDGEbuilder's service)? | Not at first: tools first, assistants later and only for read calls |
| Is a tool allowed to add buttons elsewhere (the Selected panel, a right-click menu)? | Not in T1 to T3: the Tools tab only, so EDGEbuilder's layout stays its own |
| File the REDnode request for `service.providers(role)` | Yes, with T0 |

Clean room: World Builder has nothing like this to copy from; the design follows REDnode's own services and roles, and how code editors load extensions.
