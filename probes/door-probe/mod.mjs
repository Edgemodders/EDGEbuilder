// EDGEbuilder's D0 doors probe (docs/testing.md, "D0 Doors probe"; docs/world-objects.md, "Doors
// first"). No EDGEbuilder code: each button is one question, logged with what it called and what
// came back. What shows in the world is for the player to say.
//
//   0 Start      REDnode's world node registry (#24), before a save loads
//   1 Doors      world.near, the doors among the entities around V, with their state (Q6)
//   2 Its node   the sector node that placed the chosen door: its sector, index and reference (Q1)
//   3 Hide       two ways: REDnode's world.setVisible on the node, and the entity's components (Q2)
//   4 State      open, close and lock through the door's own actions (Q4); its starting state (Q5)
//   5 Removal    an ArchiveXL .xl that deletes the chosen nodes, for a mod deployed with the game
//                closed (Q3). Fake doors (plain meshes) are added from a pick at the crosshair
//
// With the bridge permission, sector and file hashes are named through REDbridge and the sector's
// own record of the node is read (sector.nodes, REDbridge 0.12.0).

import fs from 'node:fs';
import path from 'node:path';
import { api, game, kernel, pkg, ui, world } from 'rednode';

/** The game's door classes: Door and what derives from it (game 2.5's RTTI). */
const DoorTypes = new Set(['Door', 'BunkerDoor', 'MovableWallScreen', 'Window']);

let radius = 25;
let busy = '';
let bridge = null;
let doors = []; // the last list: { e: NearEntity, label }
let chosen = null; // { e, node, sectorPath, item }
const removal = []; // { sectorPath, expectedNodes, index, type, label }
const hiddenNodes = new Set();
const hiddenParts = new Map(); // entity hash -> component names it had on
let rehide = true;

const state = ui.text('Press Start, then load a save.', { tone: 'dim' });
const target = ui.text('No door chosen.', { tone: 'dim' });
const removalText = ui.text('Removal list: empty.', { tone: 'dim' });
const log = ui.list({ keep: 800 });

function say(text) {
  log.push(`${new Date().toLocaleTimeString()}  ${text}`);
  console.log(text);
}

async function step(label, fn) {
  if (busy) return say(`${label}: not run, ${busy} is still running`);
  busy = label;
  const started = performance.now();
  try {
    const note = await fn();
    say(`${label}: ${note ?? 'done'} (${(performance.now() - started).toFixed(0)} ms)`);
  } catch (err) {
    say(`${label} failed: ${err.message}`);
  } finally {
    busy = '';
  }
}

async function bridgeCall(method, params) {
  bridge ??= await kernel.bridge();
  return bridge.call(method, params);
}

const names = new Map();
async function nameOf(hash) {
  if (!hash) return '';
  if (names.has(hash)) return names.get(hash);
  let name = '';
  try {
    const r = await bridgeCall('hash.resolve', { hash });
    name = r?.path ?? r?.Path ?? '';
  } catch {
    // no bridge permission, or REDbridge not found: hashes only
  }
  names.set(hash, name);
  return name;
}

const big = (h) => {
  try {
    return h === null || h === undefined || h === '' ? null : BigInt(h);
  } catch {
    return null;
  }
};
const f1 = (n) => (typeof n === 'number' ? n.toFixed(2) : '?');
const xyz = (p) => (p ? `${f1(p.X ?? p.x ?? p[0])}, ${f1(p.Y ?? p.y ?? p[1])}, ${f1(p.Z ?? p.z ?? p[2])}` : '?');
const pick = (o, ...keys) => {
  for (const k of keys) if (o && o[k] !== undefined) return o[k];
  return undefined;
};

async function doorState(entity) {
  const ps = await entity.GetDevicePS();
  if (!ps) return { text: 'no device PS' };
  const [open, locked, sealed] = await Promise.all([ps.IsOpen(), ps.IsLocked(), ps.IsSealed()].map((p) => p.catch(() => '?')));
  let initial = '?';
  try {
    const setup = await ps.$get('doorProperties');
    initial = setup?.initialDoorState ?? JSON.stringify(setup)?.slice(0, 200);
  } catch (err) {
    initial = `unread (${err.message})`;
  }
  return { ps, text: `open ${open}, locked ${locked}, sealed ${sealed}; starting state ${initial}` };
}

// ---- 0. Start -------------------------------------------------------------------------------

const start = () =>
  step('Start', async () => {
    const s = await world.nodeRegistry();
    showState(s);
    return `hooks ${s.attached.join(', ') || 'none'}; ${s.sectors} sectors, ${s.setups} nodes. Load a save now if none is loaded`;
  });

function showState(s) {
  state.set({
    text: `Registry: ${s.sectors} sectors (${s.badSectors} bad), ${s.setups} nodes, ${s.instances} live, ${s.hidden} hidden, ${s.refused} refused reads. Hide ${s.canHide ? 'yes' : 'NO'}, outline ${s.canHighlight ? 'yes' : 'no'}.`,
    tone: s.badSectors ? 'danger' : 'normal',
  });
}

const refresh = () =>
  step('State', async () => {
    const s = await world.nodeRegistry();
    showState(s);
    return JSON.stringify(s);
  });

// ---- 1. Doors near V (Q6) -------------------------------------------------------------------

const findDoors = () =>
  step(`Doors within ${radius} m`, async () => {
    const all = await world.near({ radius });
    const types = new Map();
    for (const e of all) types.set(e.type, (types.get(e.type) ?? 0) + 1);
    say(`  every class near V: ${[...types].sort((a, b) => b[1] - a[1]).map(([t, n]) => `${t} ${n}`).join(', ')}`);
    doors = [];
    for (const e of all.filter((x) => DoorTypes.has(x.type) || /door/i.test(x.type))) {
      let template = '';
      try {
        const f = await world.files(e.entity);
        template = ((await nameOf(f.template)) || f.template || '').split('\\').pop();
      } catch {
        template = '?';
      }
      const s = await doorState(e.entity).catch((err) => ({ text: `state unread: ${err.message}` }));
      const label = `${e.type} ${template} (${e.appearance})`;
      doors.push({ e, label });
      say(`  ${doors.length}. ${f1(e.distance)} m  ${label}  entity ${e.id.hash}  ${s.text}`);
    }
    return `${doors.length} doors among ${all.length} entities`;
  });

// ---- 2. Its node (Q1) -----------------------------------------------------------------------

const chooseDoor = (i) =>
  step(`Choose ${i + 1}`, async () => {
    const d = doors[i];
    if (!d) throw new Error(`no door ${i + 1}: press Doors first`);
    chosen = { e: d.e, label: d.label, node: null, sectorPath: '', item: null };
    target.set({ text: `Chosen: ${d.label}`, tone: 'accent' });
    await outline(d.e.entity, true);
    const pos = await d.e.entity.GetWorldPosition();
    say(`  entity ${d.e.id.hash} at ${xyz(pos)}; persistent id ${JSON.stringify(await d.e.entity.GetPersistentID().catch(() => '?'))}`);

    // The registry along a short vertical ray through the door's place: entity nodes have a 1 m
    // box at their place (S24), so the ray crosses it.
    const r = await world.pick({ from: { x: pos.X, y: pos.Y, z: pos.Z + 3 }, dir: { x: 0, y: 0, z: -1 }, max: 6, limit: 40, all: true, physics: false, order: 'nearest', helpers: true });
    const id = big(d.e.id.hash);
    const scored = r.hits.map((n) => {
      const byId = id !== null && (big(n.nodeId) === id || big(n.entity) === id);
      const gap = Math.hypot(n.position[0] - pos.X, n.position[1] - pos.Y, n.position[2] - pos.Z);
      return { n, byId, gap };
    });
    for (const s of scored.filter((s) => /Entity|Device/.test(s.n.kind) || s.byId).slice(0, 8))
      say(`  candidate ${s.n.kind} ${s.n.id} node ${s.n.index}/${s.n.nodeCount} nodeId ${s.n.nodeId} entity ${s.n.entity ?? '-'}; ${f1(s.gap)} m from the door${s.byId ? '  SAME ID' : ''}`);
    const best = scored.find((s) => s.byId) ?? scored.filter((s) => /Entity|Device/.test(s.n.kind) && s.gap < 0.1).sort((a, b) => a.gap - b.gap)[0];
    if (!best) return `no entity node found at the door's place among ${r.hits.length} hits: Q1 needs another way`;
    chosen.node = best.n;
    chosen.sectorPath = await nameOf(best.n.sector);
    say(`  Q1: ${best.byId ? 'the entity id IS the node id' : `matched by place only (${f1(best.gap)} m); ids differ: entity ${d.e.id.hash}, node ${best.n.nodeId}`}`);
    say(`  node ${best.n.kind} index ${best.n.index} of ${best.n.nodeCount}, instance ${best.n.instance}; sector ${chosen.sectorPath || best.n.sector}`);
    await readSectorRecord();
    return `${best.n.kind} in ${(chosen.sectorPath || best.n.sector).split('\\').pop()}`;
  });

// The sector's own record of the node, from the file (REDbridge): its reference (a door a quest
// addresses has one) and its template.
async function readSectorRecord() {
  if (!chosen?.node || !chosen.sectorPath) return say('  sector record: no sector path (REDbridge needed)');
  try {
    const r = await bridgeCall('sector.nodes', { path: chosen.sectorPath });
    const items = pick(r, 'items', 'Items') ?? [];
    const item = items.find((x) => pick(x, 'index', 'Index') === chosen.node.instance) ?? items.find((x) => pick(x, 'node', 'Node') === chosen.node.index);
    chosen.item = item ?? null;
    const nodes = pick(r, 'nodes', 'Nodes');
    say(`  sector file: ${nodes} nodes (registry says ${chosen.node.nodeCount}), ${items.length} entries; kind ${pick(r, 'kind', 'Kind')}`);
    if (!item) return say('  sector record: no entry with that index');
    say(`  entry: kind ${pick(item, 'kind', 'Kind')}, node ${pick(item, 'node', 'Node')}, ref ${pick(item, 'ref', 'Ref') ?? 'NONE'}, hash ${pick(item, 'hash', 'Hash')}, resource ${pick(item, 'resource', 'Resource')}`);
    const hash = big(pick(item, 'hash', 'Hash'));
    if (hash !== null) say(`  Q1 again: the file's global node id ${hash === big(chosen.e.id.hash) ? 'IS' : 'is NOT'} the entity id`);
  } catch (err) {
    say(`  sector record failed: ${err.message}`);
  }
}

async function outline(entity, on) {
  try {
    const event = await api.$new('entRenderHighlightEvent', { seeThroughWalls: true, opacity: on ? 1 : 0, outlineIndex: on ? 1 : 0, fillIndex: 0 });
    await entity.QueueEvent(event);
  } catch (err) {
    say(`  outline: ${err.message}`);
  }
}

const need = () => {
  if (!chosen) throw new Error('choose a door first');
  return chosen;
};

// ---- 3. Hide (Q2) ---------------------------------------------------------------------------

const hideNode = () =>
  step('Hide its node (REDnode)', async () => {
    const c = need();
    if (!c.node) throw new Error('its node was not found');
    const done = await world.setVisible(c.node.id, false);
    if (done) hiddenNodes.add(c.node.id);
    return `${c.node.id}: ${done ? 'hidden; is the door gone? its collision?' : 'not done (the warning line says why)'}`;
  });

const showNodes = () =>
  step('Show hidden nodes', async () => {
    let n = 0;
    for (const id of hiddenNodes) if (await world.setVisible(id, true)) n += 1;
    hiddenNodes.clear();
    return `${n} shown`;
  });

async function partsOff(entity, hash) {
  const parts = (await entity.GetComponents().catch(() => null)) ?? [];
  const was = [];
  const kinds = new Map();
  for (const c of parts) {
    const cls = await c.GetClassName().catch(() => '?');
    kinds.set(String(cls), (kinds.get(String(cls)) ?? 0) + 1);
    if (await c.IsEnabled().catch(() => false)) {
      was.push(String(await c.GetName()));
      await c.Toggle(false).catch(() => {});
    }
  }
  hiddenParts.set(hash, was);
  say(`  components: ${[...kinds].map(([k, n]) => `${k} ${n}`).join(', ')}`);
  return was.length;
}

const hideParts = () =>
  step('Hide its components', async () => {
    const c = need();
    await outline(c.e.entity, false);
    const n = await partsOff(c.e.entity, c.e.id.hash);
    return `${n} components switched off; is the door gone? Walk into the doorway: its collision?`;
  });

const showParts = () =>
  step('Show its components', async () => {
    const c = need();
    const entity = (await world.entity(c.e.id).catch(() => null)) ?? c.e.entity;
    const was = hiddenParts.get(c.e.id.hash) ?? [];
    let n = 0;
    for (const name of was) {
      const comp = await entity.FindComponentByName(name).catch(() => null);
      if (comp) {
        await comp.Toggle(true).catch(() => {});
        n += 1;
      }
    }
    hiddenParts.delete(c.e.id.hash);
    return `${n} of ${was.length} switched back on`;
  });

// Q2's second half: a door that streams out and back in. Walk 150 m away and back.
world.on('Entity/Detach', (e) => {
  if (hiddenParts.has(String(e.entityId))) say(`The hidden door ${e.entityId} left the world (streamed out)`);
});
world.on('Entity/AfterAttach', async (e) => {
  const hash = String(e.entityId);
  if (!hiddenParts.has(hash)) return;
  say(`The hidden door ${hash} came back into the world${rehide ? ': hiding it again' : ' (not hidden again: is it visible?)'}`);
  if (!rehide) return;
  const entity = await world.entity({ hash }).catch(() => null);
  if (entity) say(`  ${await partsOff(entity, hash)} components switched off again`);
});

// ---- 4. State (Q4, Q5) ----------------------------------------------------------------------

const act = (label, action) =>
  step(label, async () => {
    const c = need();
    const s = await doorState(c.e.entity);
    if (!s.ps) throw new Error(s.text);
    const a = await s.ps[action]();
    const persistency = await api.GameInstance.GetPersistencySystem(game.instance);
    await persistency.QueuePSDeviceEvent(a);
    await new Promise((r) => setTimeout(r, 1500));
    return `before: ${s.text}; after 1.5 s: ${(await doorState(c.e.entity)).text}`;
  });

const readState = () =>
  step('Read state', async () => (await doorState(need().e.entity)).text);

// ---- 5. Removal (Q3) ------------------------------------------------------------------------

function showRemoval() {
  removalText.set({
    text: removal.length ? `Removal list: ${removal.map((r) => `${r.label} (${r.type} ${r.index} in ${r.sectorPath.split('\\').pop()})`).join('; ')}` : 'Removal list: empty.',
    tone: removal.length ? 'accent' : 'dim',
  });
}

function addNode(n, sectorPath, label) {
  if (!sectorPath) throw new Error('no sector path: REDbridge must name the sector (the bridge permission)');
  if (removal.some((r) => r.sectorPath === sectorPath && r.index === n.index)) return 'already listed';
  removal.push({ sectorPath, expectedNodes: n.nodeCount, index: n.index, type: n.kind, label });
  showRemoval();
  return `listed ${n.kind} ${n.index} of ${n.nodeCount}`;
}

const addChosen = () =>
  step('Add the chosen door', async () => {
    const c = need();
    if (!c.node) throw new Error('its node was not found');
    return addNode(c.node, c.sectorPath, c.label);
  });

// A fake door, or any plain mesh: what the camera looks at.
let lastPick = null;
const pickHere = () =>
  step('Pick at the crosshair', async () => {
    const r = await world.pick({ max: 40, limit: 6 });
    lastPick = r.hits[0] ?? null;
    for (const [i, n] of r.hits.entries()) say(`  ${i + 1}. ${n.kind} ${n.id} node ${n.index}/${n.nodeCount} ${n.boundsFrom}${n.holdsHit ? ' HOLDS THE HIT' : ''} ${((await nameOf(n.resource)) || '').split('\\').pop()}`);
    if (lastPick) await world.highlight(lastPick.id, { outline: 1 }).catch(() => false);
    return lastPick ? `first: ${lastPick.kind}` : 'nothing';
  });

const addPick = () =>
  step('Add the pick', async () => {
    if (!lastPick) throw new Error('pick first');
    return addNode(lastPick, await nameOf(lastPick.sector), `${lastPick.kind} ${((await nameOf(lastPick.resource)) || '').split('\\').pop()}`);
  });

const writeRemoval = () =>
  step('Write the removal mod', async () => {
    if (!removal.length) throw new Error('the list is empty');
    const bySector = new Map();
    for (const r of removal) bySector.set(r.sectorPath, [...(bySector.get(r.sectorPath) ?? []), r]);
    const lines = ['# EDGEbuilder D0 doors probe: ArchiveXL sector node deletions', 'streaming:', '  sectors:'];
    for (const [sector, list] of bySector) {
      lines.push(`    - path: ${sector}`, `      expectedNodes: ${list[0].expectedNodes}`, '      nodeDeletions:');
      for (const r of list) lines.push(`        - index: ${r.index}`, `          type: ${r.type}`);
    }
    // In the data folder: a file in pkg.dir would hot reload this package.
    const root = path.join(pkg.dataDir, 'door-probe-removal');
    const dir = path.join(root, 'archive', 'pc', 'mod');
    fs.rmSync(root, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'edgebuilder_door_probe.xl'), lines.join('\n') + '\n');
    fs.writeFileSync(path.join(pkg.dataDir, 'door-probe-removal.json'), JSON.stringify(removal, null, 2));
    say(lines.join('\n'));
    return `written to ${root}: tell Claude, quit the game, and it adds that folder with EDGEdeck`;
  });

const clearRemoval = () => {
  removal.length = 0;
  showRemoval();
  say('Removal list cleared');
};

// ---- Window ---------------------------------------------------------------------------------

ui.window({
  title: 'EDGEbuilder door probe',
  anchor: 'left',
  x: 40,
  y: 60,
  width: 780,
  height: 900,
  closable: true,
  children: [
    state,
    ui.row(ui.button('Start', start), ui.button('State', refresh, { variant: 'ghost' })),
    ui.heading('1. Doors near V'),
    ui.slider('Radius (m)', (v) => (radius = v), { min: 5, max: 100, step: 5, value: radius }),
    ui.row(ui.button('Doors', findDoors)),
    ui.row(...[1, 2, 3, 4, 5, 6].map((i) => ui.button(`Choose ${i}`, () => chooseDoor(i - 1), { variant: 'ghost' }))),
    target,
    ui.heading('2. Hide the chosen door'),
    ui.row(
      ui.button('Hide its node (REDnode)', hideNode),
      ui.button('Show hidden nodes', showNodes, { variant: 'ghost' }),
    ),
    ui.row(
      ui.button('Hide its components', hideParts),
      ui.button('Show its components', showParts, { variant: 'ghost' }),
    ),
    ui.toggle('Hide it again when it streams back in', (on) => (rehide = on), { checked: true }),
    ui.heading('3. Its state'),
    ui.row(
      ui.button('Read state', readState, { variant: 'ghost' }),
      ui.button('Open', () => act('Open', 'ActionSetOpened')),
      ui.button('Close', () => act('Close', 'ActionSetClosed')),
      ui.button('Lock / unlock', () => act('Lock / unlock', 'ActionToggleLock')),
    ),
    ui.heading('4. Removal mod'),
    ui.row(
      ui.button('Add the chosen door', addChosen),
      ui.button('Pick at the crosshair', pickHere, { variant: 'ghost' }),
      ui.button('Add the pick', addPick, { variant: 'ghost' }),
    ),
    removalText,
    ui.row(
      ui.button('Write the removal mod', writeRemoval),
      ui.button('Clear the list', clearRemoval, { variant: 'ghost' }),
    ),
    log,
  ],
});

say(`Door probe ready. Data folder: ${pkg.dataDir}. Press Start, then load a save.`);
