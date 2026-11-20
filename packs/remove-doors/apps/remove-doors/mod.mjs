// Remove Doors: a small REDnode app. It lists the game's doors near V, outlines them, and removes
// the one picked from the world, with its stand-in (the copy the game draws from afar), so the
// doorway is open. Removed doors are kept in this app's data folder and removed again after every
// load, for every save, while the app is on; switching it off brings them all back.
//
// It hides doors through REDnode's world node registry (world.setVisible), as EDGEbuilder does
// live, and needs neither REDbridge nor a project. What it knows comes from EDGEbuilder's D0 probe:
// a door's entity id is its node's global id, and a removed door's stand-in sits at its place.
// A small app of its own, shipped beside EDGEbuilder: https://www.nexusmods.com/cyberpunk2077/mods/39060
import * as fs from 'node:fs';
import * as path from 'node:path';
import { api, game, pkg, ui, world } from 'rednode';

const Radius = 30;
const MaxRows = 14;
/** The game's highlight colours: 3 is red (REDnode's VATS spike), 5 white. */
const Red = 3;
const White = 5;
const Kinds = {
  door: { label: 'Doors', classes: new Set(['Door', 'BunkerDoor', 'MovableWallScreen', 'Window']) },
  painted: { label: 'Painted-on doors', classes: new Set(['FakeDoor']) },
};
const Words = { Door: 'Door', Window: 'Shutter', BunkerDoor: 'Bunker door', MovableWallScreen: 'Moving wall', FakeDoor: 'Painted-on door' };

// ---- what is kept ---------------------------------------------------------------------------

const settingsFile = path.join(pkg.dataDir, 'settings.json');
const removedFile = path.join(pkg.dataDir, 'removed.json');
const readJson = (file, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
};
const writeJson = (file, data) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
};
let settings = { door: true, painted: true, showAll: false, ...readJson(settingsFile, {}) };
/**
 * Removed doors: `node` is the registry's id (`0x<sector hash>:<entry>`), `proxies` its stand-ins'.
 * `position` and `kind` check that the node is still that door before it is hidden again, so a game
 * patch that renumbers a sector never hides something else.
 */
let removed = readJson(removedFile, []).filter((r) => r && typeof r.node === 'string');
const saveRemoved = () => writeJson(removedFile, removed);

// ---- state ------------------------------------------------------------------------------------

let doors = []; // the doors near V, from the last look
let picked; // the entity id of the door picked in the list
let note = '';
let busy = false;
const pending = new Set(); // removed doors whose part of the world is not loaded: hidden when it is
let retry;

const big = (v) => {
  try {
    return v === null || v === undefined || v === '' ? null : BigInt(v);
  } catch {
    return null;
  }
};
const sameId = (a, b) => {
  const x = big(a);
  return x !== null && x !== 0n && x === big(b);
};
const near = (a, b, d) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < d;

async function worldReady() {
  try {
    return (await game.state()).world && (await world.available());
  } catch {
    return false;
  }
}

/** REDnode's world node registry: started before a save loads, it knows every part of the world that loads. */
async function startRegistry() {
  if (typeof world.nodeRegistry !== 'function' || typeof world.setVisible !== 'function') {
    note = 'Remove Doors needs REDnode 0.67.3 or later.';
    return false;
  }
  try {
    const s = await world.nodeRegistry();
    note = s.sectors || !(await worldReady()) ? '' : 'This app started after your save loaded: load the save again, or fast travel, and it can remove doors.';
    return true;
  } catch {
    return false; // no game yet: tried again when it connects
  }
}

/** A door's state from its device: open, locked, sealed. A painted-on door has none. */
async function stateOf(entity) {
  try {
    const ps = await entity.GetDevicePS();
    if (!ps) return '';
    const [open, locked, sealed] = await Promise.all([ps.IsOpen(), ps.IsLocked(), ps.IsSealed()].map((p) => p.catch(() => undefined)));
    return [open === true ? 'open' : open === false ? 'closed' : '', locked ? 'locked' : '', sealed ? 'sealed' : ''].filter(Boolean).join(', ');
  } catch {
    return '';
  }
}

/** The doors near V, nearest first, of the kinds switched on. */
async function look() {
  if (!(await worldReady()) || typeof world.near !== 'function') {
    doors = [];
    return;
  }
  const kinds = Object.entries(Kinds).filter(([k]) => settings[k]).flatMap(([, v]) => [...v.classes]);
  const found = [];
  for (const e of await world.near({ radius: Radius })) {
    if (!kinds.includes(e.type)) continue;
    const p = await e.entity.GetWorldPosition();
    found.push({
      id: e.id.hash,
      entity: e.entity,
      type: e.type,
      appearance: e.appearance || '',
      distance: e.distance,
      position: [p.X, p.Y, p.Z],
      state: e.type === 'FakeDoor' ? '' : await stateOf(e.entity),
    });
  }
  doors = found.slice(0, MaxRows);
}

async function outline(entity, colour) {
  try {
    const event = await api.$new('entRenderHighlightEvent', { seeThroughWalls: false, opacity: colour ? 1 : 0, outlineIndex: colour, fillIndex: 0 });
    await entity.QueueEvent(event);
  } catch {
    // Gone since the look (a load): nothing to outline.
  }
}

/** Outlines: the picked door red, the rest white with Show all on, none otherwise. */
async function outlines() {
  for (const d of doors) await outline(d.entity, d.id === picked ? Red : settings.showAll ? White : 0);
}

/** A door's node and its stand-ins: the registry along a short line down through its place. */
async function nodeOf(door) {
  const [x, y, z] = door.position;
  const { hits } = await world.pick({ from: { x, y, z: z + 3 }, dir: { x: 0, y: 0, z: -1 }, max: 6, limit: 40, all: true, physics: false, order: 'nearest', helpers: true });
  const node = hits.find((n) => sameId(n.nodeId, door.id) || sameId(n.entity, door.id));
  if (!node) return undefined;
  const proxies = hits.filter((h) => h.kind === 'worldEntityProxyMeshNode' && (sameId(h.nodeId, node.proxyId) || near(h.position, door.position, 0.05)));
  return { node, proxies };
}

const isRemoved = (door) => removed.some((r) => sameId(r.entity, door.id));
const nameOf = (type, appearance) => `${Words[type] ?? type}${appearance ? ` (${appearance})` : ''}`;

async function hide(id, visible) {
  try {
    return await world.setVisible(id, visible);
  } catch {
    return false;
  }
}

/** Hides a removed door again: only when its node is still the door it was (a game patch can renumber). */
async function hideAgain(r) {
  const node = await world.node(r.node).catch(() => null);
  if (!node) return false; // its part of the world is not loaded
  if (node.kind !== r.kind || !near(node.position, r.position, 0.5)) {
    r.mismatch = true;
    return true; // not that door any more: left alone, and said so in the list
  }
  let done = await hide(r.node, false);
  for (const p of r.proxies ?? []) if (!(await hide(p, false))) done = false;
  return done;
}

/** After a load, and while some wait: every removed door hidden again once its part of the world is in. */
async function applyAll() {
  if (!(await worldReady())) return;
  for (const r of removed) {
    if (await hideAgain(r)) pending.delete(r.node);
    else pending.add(r.node);
  }
  clearTimeout(retry);
  if (pending.size) retry = setTimeout(() => void applyAll(), 10_000);
}

// ---- actions ----------------------------------------------------------------------------------

async function run(what, fn) {
  if (busy) return;
  busy = true;
  try {
    await fn();
  } catch (err) {
    note = `${what}: ${err.message}`;
  } finally {
    busy = false;
    render();
  }
}

const refresh = () =>
  run('Look again', async () => {
    if (!note) await startRegistry();
    await look();
    if (picked && !doors.some((d) => d.id === picked)) picked = undefined;
    await outlines();
  });

const pick = (door) =>
  run('Pick', async () => {
    picked = picked === door.id ? undefined : door.id;
    await outlines();
  });

const remove = (door) =>
  run('Remove', async () => {
    const found = await nodeOf(door);
    if (!found) {
      note = 'That door was not found in REDnode\'s world node registry: load the save again, or fast travel, then try again.';
      return;
    }
    await outline(door.entity, 0);
    const entry = {
      node: found.node.id,
      kind: found.node.kind,
      position: found.node.position,
      proxies: found.proxies.map((p) => p.id),
      entity: door.id,
      label: nameOf(door.type, door.appearance),
      at: new Date().toISOString(),
    };
    removed.push(entry);
    saveRemoved();
    await hide(entry.node, false);
    for (const p of entry.proxies) await hide(p, false);
    note = `Removed: ${entry.label}. It stays removed while Remove Doors is on, in every save.`;
    picked = undefined;
  });

const bringBack = (r) =>
  run('Bring back', async () => {
    removed = removed.filter((x) => x !== r);
    saveRemoved();
    pending.delete(r.node);
    if (!r.mismatch) {
      await hide(r.node, true);
      for (const p of r.proxies ?? []) await hide(p, true);
    }
    const there = r.entity ? await world.entity(r.entity).catch(() => null) : null;
    note = there
      ? `Brought back: ${r.label}.`
      : `Brought back: ${r.label}. It shows as its stand-in, which doesn't open, until the area loads again: fast travel away and back, or load a save.`;
    await look();
  });

const bringAllBack = () =>
  run('Bring all back', async () => {
    const all = removed;
    removed = [];
    saveRemoved();
    pending.clear();
    for (const r of all) {
      if (r.mismatch) continue;
      await hide(r.node, true);
      for (const p of r.proxies ?? []) await hide(p, true);
    }
    note = `Brought back ${all.length} door${all.length === 1 ? '' : 's'}. Doors removed before your last load show as stand-ins until the area loads again.`;
    await look();
  });

function setKind(kind, on) {
  settings = { ...settings, [kind]: on };
  writeJson(settingsFile, settings);
  void refresh();
}

function setShowAll(on) {
  settings = { ...settings, showAll: on };
  writeJson(settingsFile, settings);
  void run('Show all', outlines);
}

// ---- the window ---------------------------------------------------------------------------------

function doorRows() {
  if (!doors.length) return [ui.text(`No doors within ${Radius} m of V. Walk closer, then Look again.`, { tone: 'dim' })];
  return doors.map((d) => {
    const gone = isRemoved(d);
    const text = `${d.distance.toFixed(1)} m  ${nameOf(d.type, d.appearance)}${d.state ? `, ${d.state}` : ''}${gone ? ', removed' : ''}`;
    return ui.row(
      ui.text(text, { tone: d.id === picked ? 'accent' : gone ? 'dim' : 'normal' }),
      ui.button(d.id === picked ? 'Picked' : 'Pick', () => pick(d), { variant: d.id === picked ? 'primary' : 'ghost', disabled: gone }),
    );
  });
}

function pickedRows() {
  const d = doors.find((x) => x.id === picked);
  if (!d) return [ui.text('Pick a door in the list: it gets a red outline in the game.', { tone: 'dim' })];
  return [
    ui.text(`${nameOf(d.type, d.appearance)}${d.state ? `, ${d.state}` : ''}, ${d.distance.toFixed(1)} m from V`, { tone: 'accent' }),
    ui.row(ui.button('Remove', () => remove(d), { variant: 'danger' })),
  ];
}

function removedRows() {
  if (!removed.length) return [ui.text('None yet.', { tone: 'dim' })];
  const rows = removed.map((r) =>
    ui.row(
      ui.text(`${r.label}${r.mismatch ? ', not found after a game update (left alone)' : pending.has(r.node) ? ', removed when you get near' : ''}`, { tone: r.mismatch ? 'danger' : 'normal' }),
      ui.button('Bring back', () => bringBack(r), { variant: 'ghost' }),
    ),
  );
  return [...rows, ui.row(ui.button('Bring all back', bringAllBack, { variant: 'ghost' }))];
}

const win = ui.window({
  title: 'Remove Doors',
  anchor: 'left',
  x: 40,
  y: 120,
  width: 480,
  height: 680,
  children: [],
});

function render() {
  win.set({
    children: [
      ...(note ? [ui.text(note, { tone: note.startsWith('Removed') || note.startsWith('Brought') ? 'normal' : 'danger' })] : []),
      ui.row(
        ui.toggle(Kinds.door.label, (on) => setKind('door', on), { checked: settings.door }),
        ui.toggle(Kinds.painted.label, (on) => setKind('painted', on), { checked: settings.painted }),
      ),
      ui.row(ui.button('Look again', refresh), ui.toggle('Show all', setShowAll, { checked: settings.showAll })),
      ui.heading('Doors near V'),
      ...doorRows(),
      ui.heading('Picked'),
      ...pickedRows(),
      ui.heading(`Removed doors (${removed.length})`),
      ...removedRows(),
      ui.text('Removed doors stay removed in every save while this app is on. Removing a door a mission uses can break that mission.', { tone: 'dim' }),
    ],
  });
}

// ---- life -------------------------------------------------------------------------------------

// As soon as the game is there, before a save loads, so the registry sees the world load.
let linked;
game.onState((s) => {
  if (s.connected === linked) return;
  linked = s.connected;
  if (s.connected) void startRegistry().then(render);
});

// A save loaded: the doors are new entities, and the removed ones are hidden again once V is in.
game.on('PlayerPuppet.OnGameAttached', () => {
  doors = [];
  picked = undefined;
  render();
  setTimeout(() => void startRegistry().then(applyAll).then(refresh), 3000);
});

render();
void startRegistry().then(async () => {
  await applyAll();
  await refresh();
});
console.log(`Remove Doors ready: ${removed.length} removed door${removed.length === 1 ? '' : 's'} kept in ${removedFile}`);
