// Exercises the REDnode-free parts: the bridge client against a real REDbridge and game (skipped
// when neither is on this machine), the asset index, and the scene store.
//   npm run smoke
//   EDGEBUILDER_BRIDGE=<REDbridge.exe> EDGEBUILDER_GAME=<game folder> npm run smoke
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import * as core from "../dist/core.mjs";
import { cleanFolderName, fileNameOf, folderIn, freeFileName, readLibraryRoot, readSceneFile, refOf, scanShelf, slugOf, whereIs, writeLibraryRoot } from "../dist/core.mjs";
import { bakeHash, bakeInput, bakesIn, checkBake, collisionKey, deployedBakes, removeBake, seenFromBySize, settleXl, solidForBake, streamingFor, writeRecord } from "../dist/core.mjs";
import { AssetIndex, BridgeClient, applyChange, centreOf, copyOf, duplicate, makeGroup, pasteOf, standPoint, pickMany, pickSelection, pruneGroups, selectionUnits, ungroup, ModSources, NeedsNewerBridge, Scene, findBridge, isGameFolder, kindOf, modArchives, quaternionToYaw, sceneNeeds, yawToQuaternion } from "../dist/core.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "edgebuilder-smoke-"));

// The bake's checks and its files in a project, without REDbridge.
{
  const crate = { id: "c", kind: "mesh", resource: "base\\c.mesh", transform: { position: [1, 2, 3], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }, entityId: "77" };
  const person = { id: "p", kind: "npc", transform: crate.transform };
  const { scene: input, skipped } = bakeInput("Yard", "2.5", [], [crate, person]);
  assert.deepEqual(input.objects.map((o) => o.id), ["c"]);
  assert.equal(input.objects[0].entityId, undefined, "previews stay out of a bake");
  assert.deepEqual(skipped, [{ id: "p", kind: "npc" }]);
  assert.equal(bakeHash([crate]), bakeHash([{ ...crate, entityId: "other" }]), "a preview does not make a scene stale");
  assert.notEqual(bakeHash([crate]), bakeHash([{ ...crate, transform: { ...crate.transform, position: [9, 2, 3] } }]), "a move does");

  const dir = path.join(tmp, "bake-project");
  const target = { name: "P", dir, archive: path.join(dir, "source", "archive"), raw: path.join(dir, "source", "raw"), resources: path.join(dir, "source", "resources") };
  const tones = (over) => checkBake({ file: "f", name: "Yard", objects: [crate], project: target, bridgeReady: true, needs: [], ...over }).filter((c) => c.tone === "error");
  assert.deepEqual(tones({}), [], "nothing stops a good scene");
  assert.equal(tones({ file: "" }).length, 1, "no scene open");
  assert.equal(tones({ objects: [] }).length, 1, "nothing to bake");
  assert.equal(tones({ project: null }).length, 1, "no project");
  assert.equal(tones({ bridgeReady: false }).length, 1, "no REDbridge");
  assert.equal(tones({ objects: [{ ...crate, resource: undefined }] }).length, 1, "no resource");
  assert.equal(tones({ objects: [{ ...crate, transform: { ...crate.transform, position: [NaN, 0, 0] } }] }).length, 1, "a bad number");
  assert.equal(tones({ objects: [crate, { ...crate }] }).length, 1, "the same id twice");
  const all = checkBake({ file: "f", name: "Yard", objects: [crate, person], project: target, bridgeReady: true, needs: ["Mod"], sameNameFrom: "elsewhere" });
  assert.ok(all.some((c) => /An NPC is never baked.*\bp\b/.test(c.text)) && all.some((c) => /needs: Mod/.test(c.text)) && all.some((c) => /from elsewhere/.test(c.text)));
  assert.ok(!all.some((c) => /Left out/.test(c.text)), "a person is named as an NPC, not as left out");

  // An old REDbridge's resource patch becomes streaming: blocks; a new one's stays.
  const xlDir = path.join(target.resources, "archive", "pc", "mod");
  fs.mkdirSync(xlDir, { recursive: true });
  const old = path.join(xlDir, "yard.xl");
  fs.writeFileSync(old, "resource:\n  patch:\n");
  const settled = settleXl(old, "yard", "edgebuilder\\yard\\yard.streamingblock");
  assert.equal(path.basename(settled), "yard.archive.xl");
  assert.ok(!fs.existsSync(old));
  assert.match(fs.readFileSync(settled, "utf8"), /^streaming:\n {2}blocks:\n {4}- edgebuilder\\yard\\yard\.streamingblock/m);
  assert.equal(settleXl(settled, "yard", "x"), settled);

  // The project's bakes, and the game's.
  assert.deepEqual(bakesIn(null), []);
  assert.deepEqual(bakesIn(target), []);
  fs.mkdirSync(path.join(target.archive, "edgebuilder", "yard"), { recursive: true });
  fs.writeFileSync(path.join(target.archive, "edgebuilder", "yard", "yard.streamingsector"), "x");
  assert.deepEqual(bakesIn(target), [{ slug: "yard", name: "yard" }], "a bake without a record still shows");
  writeRecord(target, { slug: "yard", name: "Yard", objects: 1, hash: "h" });
  assert.equal(bakesIn(target)[0].name, "Yard");
  const game = path.join(tmp, "bake-game");
  assert.equal(deployedBakes(game).size, 0);
  const mods = path.join(game, "archive", "pc", "mod");
  fs.mkdirSync(mods, { recursive: true });
  fs.copyFileSync(settled, path.join(mods, "anymod.archive.xl"));
  fs.writeFileSync(path.join(mods, "other.xl"), "streaming:\n  blocks:\n    - elsewhere\\x.streamingblock\n");
  assert.deepEqual([...deployedBakes(game)], [["yard", "anymod.archive.xl"]]);
  const redmod = path.join(game, "mods", "SomeRedmod", "archives");
  fs.mkdirSync(redmod, { recursive: true });
  fs.writeFileSync(path.join(redmod, "corner.archive.xl"), "streaming:\n  blocks:\n    - edgebuilder\\corner\\corner.streamingblock\n");
  fs.writeFileSync(path.join(game, "mods", "a_loose_file.txt"), "not a REDmod");
  assert.deepEqual([...deployedBakes(game)], [["yard", "anymod.archive.xl"], ["corner", "corner.archive.xl"]], "a bake packed as a REDmod counts");
  assert.throws(() => removeBake(target, "..\\..\\evil"));
  removeBake(target, "yard");
  assert.deepEqual(bakesIn(target), []);
  assert.ok(!fs.existsSync(settled), "its .xl goes too");
  // The Solid switch (B4-2).
  const plainCrate = { id: "c", kind: "mesh", resource: "base\\a\\Crate.mesh", transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] } };
  const solidCrate = { ...plainCrate, solid: true };
  const beforeSwitch = bakeHash([plainCrate]);
  assert.notEqual(bakeHash([solidCrate]), beforeSwitch, "the switch counts as a change");
  assert.equal(bakeHash([{ ...plainCrate, solid: false }]), beforeSwitch, "off is as absent");
  const entity = { ...plainCrate, kind: "entity", resource: "base\\a\\b.ent" };
  assert.equal(bakeHash([{ ...entity, solid: true }]), bakeHash([entity]), "solid means nothing on an entity");
  assert.equal(collisionKey("base/A/Crate.mesh"), "base\\a\\crate.mesh");
  // Seen from: REDbridge's rule by size, and what a typed distance writes.
  const box = (s) => ({ id: "b", kind: "mesh", resource: "a.mesh", bounds: { min: [-s / 2, -s / 2, 0], max: [s / 2, s / 2, s] }, transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] } });
  assert.equal(seenFromBySize(box(1.4)), 40, "a crate is seen from the 40 m floor");
  assert.equal(seenFromBySize(box(10)), 110, "10 m across: 110 m");
  assert.equal(seenFromBySize({ ...box(10), transform: { ...box(10).transform, scale: [2, 2, 2] } }), 220, "scale counts");
  assert.equal(seenFromBySize(box(100)), 400, "kept to 400 m");
  assert.equal(seenFromBySize({ ...box(1), bounds: undefined }), undefined, "no bounds: REDbridge reads the file");
  assert.deepEqual(streamingFor(150), { primary: 150, secondary: 150 }, "both the same: the game hides a node beyond either");
  assert.deepEqual(streamingFor(1), { primary: 5, secondary: 5 }, "kept to 5 m at least");
  assert.equal(streamingFor(null), undefined);
  assert.notEqual(bakeHash([box(1)]), bakeHash([{ ...box(1), streaming: streamingFor(150) }]), "a new distance is a change to bake");
  const none = new Set([collisionKey(plainCrate.resource)]);
  const [stripped] = solidForBake([solidCrate], none);
  assert.ok(!("solid" in stripped), "no data: bakes as a plain mesh");
  assert.ok(solidCrate.solid, "and the scene keeps its setting");
  assert.equal(solidForBake([solidCrate], new Set())[0].solid, true);
  assert.equal(bakeInput("n", undefined, [], [solidCrate]).scene.objects[0].solid, true, "solid reaches sector.build");
  const says = (objects, over = {}) => checkBake({ file: "f", name: "Yard", objects, project: target, bridgeReady: true, needs: [], ...over }).map((c) => `${c.tone}: ${c.text}`).join("\n");
  assert.match(says([solidCrate]), /info: 1 mesh will stop V/);
  assert.match(says([plainCrate]), /info: 1 mesh is set not solid/);
  assert.match(says([solidCrate], { noCollision: none }), /warn: A mesh has no collision data.*Crate\.mesh/);
  assert.doesNotMatch(says([solidCrate], { noCollision: none }), /will stop V/);
  assert.match(says([solidCrate], { bridgeVersion: "0.11.0" }), /warn: REDbridge 0\.11\.0 writes no solid meshes/);
  assert.doesNotMatch(says([solidCrate], { bridgeVersion: "0.12.0" }), /writes no solid/);
  assert.doesNotMatch(says([plainCrate], { bridgeVersion: "0.11.0" }), /writes no solid/);
  const farCrate = { ...plainCrate, streaming: { primary: 120, secondary: 96 } };
  assert.match(says([farCrate], { bridgeVersion: "0.12.0" }), /warn: REDbridge 0.12.0 does not pass Seen from on/);
  assert.doesNotMatch(says([farCrate], { bridgeVersion: "0.12.1" }), /Seen from on/);
  assert.doesNotMatch(says([plainCrate], { bridgeVersion: "0.12.0" }), /Seen from on/);
  assert.doesNotMatch(says([entity]), /solid/i, "an entity is no mesh to speak of");
  console.log("bake: ok");

  // Library bakes (B4-3): a .bake folder shaped like a project, Include in project, the came-from note.
  {
    const lib = path.join(tmp, "lib-root");
    const dir = core.freeBakeDir(path.join(lib, "Alleys"), "Kabuki Night");
    assert.equal(path.basename(dir), "kabuki_night.bake");
    const folder = core.bakeFolderProject(dir);
    assert.equal(folder.name, "kabuki_night");
    // Two scenes baked into it, as sector.build would write them.
    const fake = (into, slug) => {
      fs.mkdirSync(path.join(into.archive, "edgebuilder", slug), { recursive: true });
      for (const end of ["streamingsector", "streamingblock"]) fs.writeFileSync(path.join(into.archive, "edgebuilder", slug, `${slug}.${end}`), slug);
      fs.mkdirSync(path.join(into.resources, "archive", "pc", "mod"), { recursive: true });
      fs.writeFileSync(path.join(into.resources, "archive", "pc", "mod", `${slug}.archive.xl`), `streaming:\n  blocks:\n    - edgebuilder\\${slug}\\${slug}.streamingblock\n`);
      writeRecord(into, { slug, name: slug, hash: "h" });
    };
    fake(folder, "yard");
    fake(folder, "corner");
    const meta = { format: 1, id: core.newBakeId(), name: "Kabuki Night", version: 1, scenes: [{ name: "Yard", slug: "yard", path: "Alleys/yard.scene.json", hash: "h" }, { name: "Corner", slug: "corner", path: "Alleys/corner.scene.json", hash: "h" }] };
    core.writeBakeMeta(dir, meta);
    assert.equal(core.freeBakeDir(path.join(lib, "Alleys"), "Kabuki Night"), path.join(lib, "Alleys", "kabuki_night_2.bake"));
    assert.equal(core.libraryPath(lib, path.join(lib, "Alleys", "yard.scene.json")), "Alleys/yard.scene.json");
    assert.equal(core.fromLibraryPath(lib, "Alleys/yard.scene.json"), path.join(lib, "Alleys", "yard.scene.json"));
    fs.mkdirSync(path.join(lib, "broken.bake"), { recursive: true });
    const found = core.scanBakes(lib);
    assert.deepEqual(found.map((b) => [path.basename(b.dir), b.folder, b.meta?.name ?? b.error]), [["kabuki_night.bake", "Alleys", "Kabuki Night"], ["broken.bake", "", found[1].error]]);
    assert.ok(found[1].error, "a .bake without bake.json says why");
    assert.deepEqual(core.scanBakes(undefined), []);
    // Bakes are not scene folders.
    fs.writeFileSync(path.join(lib, "Alleys", "yard.scene.json"), JSON.stringify({ format: 1, name: "Yard", groups: [], objects: [] }));
    assert.deepEqual(scanShelf({ place: "library", dir: lib, label: "Library" }).folders, ["Alleys"]);

    // Include in project: the files, the record's "from", the came-from note; another tool's item is kept.
    const proj = path.join(tmp, "lib-project");
    const target = { name: "P", dir: proj, archive: path.join(proj, "source", "archive"), raw: path.join(proj, "source", "raw"), resources: path.join(proj, "source", "resources") };
    fs.mkdirSync(path.join(proj, "source"), { recursive: true });
    fs.writeFileSync(path.join(proj, "source", "library.json"), JSON.stringify({ format: 1, items: [{ id: "x", kind: "prop", path: "Props/a.prop.asset", version: 2, added: "t", by: "edgefab", files: ["source/archive/a.ent"] }] }));
    assert.deepEqual(core.includeClashes(target, meta), []);
    const files = core.includeBake(dir, meta, target, lib);
    assert.equal(files.length, 8, "two scenes, four files each");
    assert.deepEqual(bakesIn(target).map((b) => [b.slug, b.library?.name, b.library?.version]), [["corner", "Kabuki Night", 1], ["yard", "Kabuki Night", 1]]);
    const note = core.readNote(proj);
    assert.equal(note.items.length, 2, "EDGEfab's item stays");
    const mine = note.items.find((i) => i.by === "edgebuilder");
    assert.deepEqual([mine.kind, mine.id, mine.path, mine.version], ["bake", meta.id, "Alleys/kabuki_night.bake", 1]);
    assert.ok(mine.files.every((f) => !f.includes("\\")), "paths with /");
    assert.deepEqual([...core.libraryBakesIn(proj).keys()].sort(), ["corner", "yard"]);
    // Version 2 without Corner: the project's copy of Corner goes, Yard's version goes up.
    removeBake(folder, "corner");
    const v2 = { ...meta, version: 2, scenes: meta.scenes.filter((x) => x.slug !== "corner") };
    core.writeBakeMeta(dir, v2);
    core.includeBake(dir, v2, target, lib);
    assert.deepEqual(bakesIn(target).map((b) => [b.slug, b.library?.version]), [["yard", 2]]);
    assert.ok(!fs.existsSync(path.join(target.archive, "edgebuilder", "corner")), "a scene taken out of the bake leaves the project");
    assert.equal(core.readNote(proj).items.length, 2, "one item per bake");
    // A bake of the same name baked straight into the project clashes; one from this bake does not.
    fake(target, "corner");
    assert.deepEqual(core.includeClashes(target, meta), ["corner"]);
    assert.deepEqual(core.includeClashes(target, v2), []);
    // Taking a bake out of the project forgets it in the note; the item goes with its last files.
    removeBake(target, "yard");
    core.forgetInNote(proj, "yard");
    assert.deepEqual(core.readNote(proj).items.map((i) => i.by), ["edgefab"]);
    assert.equal(core.libraryBakesIn(proj).size, 0);
    console.log("library bakes: ok");
  }
}

// People (B3c): rows from TweakDB, search by name or record, a scene with one is format 2, upright turns.
{
  const row = (path, flats) => ({ id: "0x1", path, type: "gamedataCharacter_Record", flats });
  const judy = core.npcEntry(row("Character.Judy", { fullDisplayName: { key: "LocKey#34480", text: "Judy Álvarez" }, displayName: { key: "LocKey#34479", text: "Judy" }, entityTemplatePath: "base\\quest\\secondary_characters\\judy.ent", appearanceName: "None" }));
  assert.deepEqual(judy, { path: "Character.Judy", kind: "npc", size: 0, template: "base\\quest\\secondary_characters\\judy.ent", name: "Judy Álvarez" });
  assert.equal(core.npcEntry(row("Character.Judy_inline2", { entityTemplatePath: "a.ent" })), undefined, "inline records are parts of others");
  assert.equal(core.npcEntry(row("Character.Base", { entityTemplatePath: null })), undefined, "no template: nothing to spawn");
  assert.equal(core.npcEntry(row(null, { entityTemplatePath: "a.ent" })), undefined, "a record with no known name");
  const rich = core.npcEntry(row("Character.CitizenRichFemale", { displayName: { key: "LocKey#0", text: null }, entityTemplatePath: "base\\rich.ent", appearanceName: "rich_04" }));
  assert.equal(rich.name, undefined, "no in-game name: the record names it");
  assert.equal(rich.appearance, "rich_04", "the record's own appearance");
  assert.ok(core.isRecord("Character.Judy") && !core.isRecord("base\\judy.ent"));

  const people = new AssetIndex(path.join(tmp, "index-npc"));
  people.entries = [{ path: "base\\environment\\judy_poster.mesh", kind: "mesh", size: 1 }];
  people.npcs = [judy, rich];
  assert.deepEqual(people.search("álvarez", "all", 10).map((e) => e.path), ["Character.Judy"], "the in-game name finds a person");
  assert.deepEqual(people.search("judy", "npc", 10).map((e) => e.path), ["Character.Judy"]);
  assert.deepEqual(people.search("judy", "all", 10, "game").map((e) => e.kind).sort(), ["mesh", "npc"], "people are among the game's own");
  assert.equal(people.search("judy", "all", 10, "mods").length, 0, "no person comes from a mod yet");
  assert.equal(people.search("character", "npc", 10).length, 0, "the record's prefix is not a match");

  // The Explorer (0.14.0): folders with their counts, the files in one, a filter under one, and the people by their record's first word.
  const ex = new AssetIndex(path.join(tmp, "index-ex"));
  ex.entries = ["base\\environment\\crates\\crate_a.mesh", "base\\environment\\crates\\crate_b.ent", "base\\environment\\crates\\big\\crate_c.mesh", "base\\items\\can.mesh", "ep1\\environment\\sign.mesh"].map((p) => ({ path: p, kind: kindOf(p), size: 1 }));
  ex.extra = [{ path: "mymod\\props\\chicken.mesh", kind: "mesh", size: 1, source: { kind: "mod", name: "Chicken", file: "C:\\x.archive" } }];
  ex.npcs = [judy, rich];
  assert.deepEqual(ex.exploreRoots().map((r) => [r.id, r.count]), [["game", 5], ["mod:Chicken", 1], ["people", 2]]);
  assert.deepEqual(ex.explore("game", "").folders, [{ name: "base", count: 4 }, { name: "ep1", count: 1 }]);
  const crates = ex.explore("game", "BASE\\environment\\crates");
  assert.deepEqual(crates.folders, [{ name: "big", count: 1 }], "any case");
  assert.deepEqual(crates.items.map((e) => e.path.split("\\").pop()), ["crate_a.mesh", "crate_b.ent"]);
  assert.equal(crates.total, 2);
  assert.deepEqual(ex.explore("game", "base", "crate").items.map((e) => e.path.split("\\").pop()), ["crate_c.mesh", "crate_a.mesh", "crate_b.ent"], "a filter looks under the folder, in path order");
  assert.equal(ex.explore("game", "base", "crate").total, 3);
  assert.equal(ex.explore("game", "ep1", "crate").total, 0);
  assert.deepEqual(ex.explore("mod:Chicken", "mymod\\props").items.map((e) => e.path), ["mymod\\props\\chicken.mesh"]);
  assert.deepEqual(core.exploreSegments("people", "Character.afterlife_merc_01"), ["afterlife", "Character.afterlife_merc_01"]);
  assert.deepEqual(core.exploreSegments("people", "Character.Judy"), ["Character.Judy"]);
  assert.equal(ex.explore("nowhere", "").total, 0);

  const list = new core.NpcList(path.join(tmp, "index-npc"));
  assert.equal(list.load("g"), false);

  const scene = new Scene(path.join(tmp, "people.scene.json"));
  const crate = scene.add("mesh", "base\\c.mesh", { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] });
  scene.save();
  assert.equal(JSON.parse(fs.readFileSync(scene.file, "utf8")).format, 1, "no person: format 1 as before");
  const p = scene.add("npc", undefined, { position: [1, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }, "rich_04", "Character.CitizenRichFemale");
  assert.equal(p.id, "citizenrichfemale");
  assert.equal(p.resource, undefined);
  const saved = JSON.parse(fs.readFileSync(scene.file, "utf8"));
  assert.equal(saved.format, 2, "a person makes it format 2");
  assert.deepEqual(saved.objects[1], { id: "citizenrichfemale", kind: "npc", record: "Character.CitizenRichFemale", appearance: "rich_04", transform: p.transform });
  const back = new Scene(scene.file);
  assert.equal(back.load(), true, "format 2 opens");
  assert.equal(back.objects[1].record, "Character.CitizenRichFemale");
  assert.deepEqual(readSceneFile(scene.file).objects.map((o) => o.kind), ["mesh", "npc"]);
  const before = scene.state();
  scene.objects[1].entityId = "9";
  scene.objects[1].record = "Character.Judy";
  assert.deepEqual(scene.restore(before).respawn.map((o) => o.id), ["citizenrichfemale"], "another record is another person");
  const { scene: baked } = bakeInput("People", undefined, [], scene.objects);
  assert.equal(baked.format, 1, "REDbridge still reads format 1");
  assert.deepEqual(baked.objects.map((o) => o.id), [crate.id]);
  scene.remove(p.id);
  assert.equal(JSON.parse(fs.readFileSync(scene.file, "utf8")).format, 1, "back to format 1 without people");

  const tilted = core.qMul(core.qAxisAngle([0, 0, 1], 90), core.qAxisAngle([1, 0, 0], 23));
  const up = core.upright(tilted);
  assert.ok(Math.abs(up[0]) < 1e-9 && Math.abs(up[1]) < 1e-9, "no tilt left");
  assert.ok(Math.abs(quaternionToYaw(up) - 90) < 1e-6, "the heading kept: " + quaternionToYaw(up));
  assert.ok(Math.abs(quaternionToYaw(core.upright(yawToQuaternion(-135))) + 135) < 1e-6);
  console.log("people: ok");
}

// B2d: the models Import offers, and a path typed in.
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "edgebuilder-models-"));
  fs.mkdirSync(path.join(root, "Props", "Street"), { recursive: true });
  fs.writeFileSync(path.join(root, "Props", "Street", "Bin Big.glb"), "glTF");
  fs.writeFileSync(path.join(root, "notes.txt"), "");
  const prop = path.join(root, "Props", "drum.prop.asset");
  fs.mkdirSync(path.join(prop, "source", "raw", "drum"), { recursive: true });
  fs.writeFileSync(path.join(prop, "asset.json"), JSON.stringify({ id: "x", kind: "prop", name: "Rusty drum" }));
  fs.writeFileSync(path.join(prop, "source", "raw", "drum", "drum.glb"), "glTF");
  fs.mkdirSync(path.join(root, "Alley.bake"));
  fs.writeFileSync(path.join(root, "Alley.bake", "inside.glb"), "glTF");
  const models = core.scanModels("library", root);
  assert.deepEqual(models.map((m) => [m.kind, m.folder, m.name]), [["prop", "Props", "Rusty drum"], ["glb", "Props/Street", "Bin Big"]], "a prop is one item, never walked into; bakes are skipped");
  assert.equal(core.scanModels("desk", undefined).length, 0);
  assert.equal(core.scanModels("desk", path.join(root, "missing")).length, 0);
  // A prop item is not a scene folder.
  assert.ok(!scanShelf({ place: "library", dir: root, label: "Library" }).folders.some((f) => f.endsWith(".prop.asset")));
  assert.equal(core.propSlug("Bin Big.glb"), "bin_big");
  assert.equal(core.propSlug("drum.prop.asset"), "drum");
  assert.ok(core.checkModelPath(`"${path.join(root, "Props", "Street", "Bin Big.glb")}"`).ok, "quotes from Copy as path are taken off");
  assert.ok(core.checkModelPath(prop).ok);
  assert.match(core.checkModelPath(path.join(root, "notes.txt")).why, /\.glb/);
  assert.match(core.checkModelPath(path.join(root, "none.glb")).why, /no file/);
  assert.ok(core.deskDir({ LOCALAPPDATA: "C:\\L" }).endsWith(path.join("EDGEfab", "desk")));
  assert.ok(core.isTextureLine("    b2d_probe_front_d01.xbm") && !core.isTextureLine("b2d_probe_front:"));
  // The Import file picker: one folder at a time, its folders (a prop item marked), its GLB files only.
  fs.mkdirSync(path.join(root, ".hidden"));
  const props = core.listFolder(path.join(root, "Props"));
  assert.deepEqual(props.folders.map((f) => [f.name, f.prop]), [["drum.prop.asset", "Rusty drum"], ["Street", undefined]]);
  assert.deepEqual(props.files, []);
  assert.equal(props.parent, root);
  const top = core.listFolder(root);
  assert.deepEqual(top.folders.map((f) => f.name), ["Alley.bake", "Props"], "hidden folders are left out");
  assert.deepEqual(core.listFolder(path.join(root, "Props", "Street")).files.map((f) => f.name), ["Bin Big.glb"]);
  assert.match(core.listFolder(path.join(root, "missing")).why, /no folder/);
  const places = core.filePlaces([{ label: "Library", dir: root }, { label: "Gone", dir: path.join(root, "gone") }]);
  assert.equal(places[0].dir, root, "the places Import knows come first");
  assert.ok(!places.some((p) => p.label === "Gone"), "a place that is not there is left out");
  assert.ok(places.some((p) => p.kind === "drive"));
  fs.rmSync(root, { recursive: true, force: true });
  console.log("models: ok");
}

{
  // Tools (T0): packages that provide "edgebuilder-tool", one level down in REDnode's package folders.
  const dev = fs.mkdtempSync(path.join(os.tmpdir(), "eb-tools-dev-"));
  const apps = fs.mkdtempSync(path.join(os.tmpdir(), "eb-tools-apps-"));
  const pack = (root, dir, manifest, files = {}) => {
    fs.mkdirSync(path.join(root, dir), { recursive: true });
    fs.writeFileSync(path.join(root, dir, "rednode-app.json"), JSON.stringify(manifest));
    for (const [f, body] of Object.entries(files)) fs.writeFileSync(path.join(root, dir, f), body);
  };
  const tool = (id, extra = {}) => ({ id, name: id, version: "1.0.0", service: "service.mjs", provides: ["edgebuilder-tool"], edgebuilderTool: { label: id.toUpperCase(), ui: "tool.js", width: 2000, wants: ["scene.read", 7] }, ...extra });
  pack(dev, "align", tool("align"), { "tool.js": "export function mount() {}" });
  pack(apps, "align", tool("align", { version: "0.9.0" }), { "tool.js": "" });
  pack(apps, "grid", tool("grid", { edgebuilderTool: { ui: "missing.js" } }));
  pack(apps, "outside", tool("outside", { edgebuilderTool: { ui: "../x.js" } }));
  pack(apps, "plain", { id: "plain", name: "Plain", main: "mod.mjs" });
  pack(apps, "noblock", { id: "noblock", provides: ["edgebuilder-tool"], service: "s.mjs" });
  fs.mkdirSync(path.join(apps, "empty"));
  const found = core.findTools([dev, apps, path.join(apps, "gone")]);
  assert.deepEqual(found.map((t) => t.id), ["align", "grid", "noblock", "outside"], "tools only, sorted by label, the first of an id wins");
  const align = found[0];
  assert.equal(align.version, "1.0.0", "a development folder comes before the apps folder");
  assert.equal(align.label, "ALIGN");
  assert.equal(align.width, core.ToolWidths.max, "the width is kept within the drawer's");
  assert.deepEqual(align.wants, ["scene.read"]);
  assert.match(align.url, /^file:\/\/\/.*\/align\/tool\.js\?v=\d+$/);
  assert.ok(!align.problem);
  assert.match(found[1].problem, /not there/);
  assert.equal(found[1].label, "grid", "no label: the package's name");
  assert.match(found[2].problem, /no "edgebuilderTool"/);
  assert.match(found[3].problem, /outside its own folder/);
  assert.deepEqual(core.findTools([dev], path.join(dev, "align")), [], "EDGEbuilder's own folder is skipped");
  fs.rmSync(dev, { recursive: true, force: true });
  fs.rmSync(apps, { recursive: true, force: true });
  console.log("tools: ok");
}

// Scene store: add, select ids, remove, save and load round trip, previews forgotten.
{
  const scene = new Scene(path.join(tmp, "scenes", "working.scene.json"));
  assert.equal(scene.load(), false);
  const a = scene.add("mesh", "base\\environment\\decoration\\containers\\cargo\\cargo_crate\\cargo_crate_a.mesh", { position: [1, 2, 3], rotation: yawToQuaternion(90), scale: [1, 1, 1] }, "default");
  const b = scene.add("mesh", "base\\environment\\decoration\\containers\\cargo\\cargo_crate\\cargo_crate_a.mesh", { position: [4, 5, 6], rotation: [0, 0, 0, 1], scale: [1, 1, 1] });
  assert.equal(a.id, "cargo_crate_a");
  assert.equal(b.id, "cargo_crate_a_2");
  a.entityId = "123";
  scene.save();
  const again = new Scene(scene.file);
  assert.equal(again.load(), true);
  assert.equal(again.objects.length, 2);
  assert.equal(again.objects[0].entityId, undefined, "previews are not saved");
  const file = JSON.parse(fs.readFileSync(scene.file, "utf8"));
  assert.equal(file.format, 1);
  assert.deepEqual(Object.keys(file.objects[0]).sort(), ["appearance", "id", "kind", "resource", "transform"]);
  assert.ok(Math.abs(quaternionToYaw(file.objects[0].transform.rotation) - 90) < 1e-6);
  assert.equal(scene.remove("cargo_crate_a_2")?.id, "cargo_crate_a_2");
  assert.equal(scene.remove("nope"), undefined);
  scene.forgetPreviews();
  assert.equal(scene.objects[0].entityId, undefined);
  scene.clear();
  assert.equal(scene.objects.length, 0);
  // A damaged file is set aside, not overwritten by the next save.
  fs.writeFileSync(scene.file, '{ "format": 1, "objects": [ { "id": "broken", "resource": ');
  const damaged = new Scene(scene.file);
  assert.equal(damaged.load(), false);
  assert.ok(damaged.loadError && damaged.setAside && fs.existsSync(damaged.setAside), "the unreadable file is kept");
  assert.ok(!fs.existsSync(scene.file));
  damaged.add("mesh", "base/a.mesh", { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] });
  assert.ok(fs.readFileSync(damaged.setAside, "utf8").includes("broken"), "the next save did not touch it");
  {
    const undoScene = new Scene(path.join(tmp, "undo.scene.json"));
    const o = undoScene.add("mesh", "a.mesh", { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] });
    const before = undoScene.state();
    o.solid = true;
    undoScene.save();
    const on = undoScene.state();
    assert.equal(undoScene.restore(before).move.length, 0, "the switch moves nothing");
    assert.ok(!undoScene.get(o.id).solid, "Undo takes it back");
    undoScene.restore(on);
    assert.equal(undoScene.get(o.id).solid, true, "Redo too");
    assert.equal(JSON.parse(fs.readFileSync(undoScene.file, "utf8")).objects[0].solid, true, "and the file keeps it");
  }
  console.log("scene: ok");
}

// Scenes and the Library (B3-2): names as the bake writes them, the three places, the Library's root file.
{
  assert.equal(slugOf("My Alley"), "my_alley");
  assert.equal(slugOf("  Kabuki -- Market!  "), "kabuki____market", "each character but a letter or digit is one _, as REDbridge's SafeName");
  assert.equal(slugOf("***"), "scene");
  assert.equal(fileNameOf("My Alley"), "my_alley.scene.json");
  assert.equal(refOf("My Alley", { id: "crate_a" }), "edgebuilder/my_alley/crate_a");
  assert.equal(refOf("My Alley", { id: "crate_a", ref: "quest/spot" }), "quest/spot");
  assert.equal(cleanFolderName(" Kabuki: market? "), "Kabuki market");
  assert.throws(() => cleanFolderName(" .. "));
  const lib = path.join(tmp, "Library");
  assert.throws(() => folderIn(lib, "../outside"), /outside/);
  assert.equal(folderIn(lib, "Alleys/Kabuki"), path.join(lib, "Alleys", "Kabuki"));
  // The root file every EDGE tool reads; other fields in it are kept.
  const conf = path.join(tmp, "EDGE", "library.json");
  assert.equal(readLibraryRoot(conf), undefined);
  fs.mkdirSync(path.dirname(conf), { recursive: true });
  fs.writeFileSync(conf, JSON.stringify({ other: 1 }));
  writeLibraryRoot(lib, conf);
  assert.equal(readLibraryRoot(conf), lib);
  assert.equal(JSON.parse(fs.readFileSync(conf, "utf8")).other, 1);
  assert.ok(fs.statSync(lib).isDirectory(), "the root is made");
  // Scenes in folders; bakes and hidden folders are not scene folders; a damaged file is listed with why.
  const a = new Scene(path.join(lib, "Alleys", "Kabuki", "market.scene.json"));
  a.name = "Market";
  a.game = "2.5";
  a.add("mesh", "base/a.mesh", { position: [1, 2, 3], rotation: [0, 0, 0, 1], scale: [1, 1, 1] });
  fs.mkdirSync(path.join(lib, "Old.bake"), { recursive: true });
  fs.writeFileSync(path.join(lib, "Old.bake", "x.scene.json"), "{}");
  fs.mkdirSync(path.join(lib, "Empty"), { recursive: true });
  fs.writeFileSync(path.join(lib, "broken.scene.json"), "{ nope");
  const shelf = scanShelf({ place: "library", dir: lib, label: "Library" });
  assert.deepEqual(shelf.folders, ["Alleys", "Alleys/Kabuki", "Empty"]);
  assert.deepEqual(shelf.scenes.map((x) => [x.folder, x.name, x.objects, !!x.error]).sort(), [["", "broken", 0, true], ["Alleys/Kabuki", "Market", 1, false]]);
  assert.equal(scanShelf({ place: "data", dir: path.join(tmp, "nowhere"), label: "This PC" }).scenes.length, 0, "a missing place is an empty shelf");
  assert.deepEqual(whereIs(a.file, [{ place: "library", dir: lib, label: "Library" }]), { place: "library", folder: "Alleys/Kabuki" });
  assert.equal(whereIs(path.join(tmp, "x.scene.json"), [{ place: "library", dir: lib, label: "Library" }]), undefined);
  assert.equal(path.basename(freeFileName(path.join(lib, "Alleys", "Kabuki"), "Market")), "market_2.scene.json");
  // take() and data(): another file becomes the scene; game is kept, previews are not saved.
  const data = readSceneFile(a.file);
  assert.equal(data.game, "2.5");
  const b = new Scene(path.join(tmp, "scenes", "working.scene.json"));
  b.take(data, path.join(lib, "Empty", "copy.scene.json"));
  b.objects[0].entityId = "1";
  let saved = 0;
  b.onSave = () => saved++;
  b.save();
  assert.equal(saved, 1);
  const copy = readSceneFile(b.file);
  assert.equal(copy.name, "Market");
  assert.equal(copy.game, "2.5");
  assert.equal(copy.objects[0].entityId, undefined);
  assert.throws(() => readSceneFile(path.join(lib, "broken.scene.json")));
  // Closed: no file, and a save writes nothing.
  const closed = new Scene("");
  closed.save();
  assert.equal(closed.file, "");
  console.log("scenes and the Library: ok");
}

// Arrange (B3): what a click selects, groups, duplicates, several objects around their middle, undo's restore.
{
  const T = (x, y = 0) => ({ position: [x, y, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] });
  const objects = ["a", "b", "c", "d"].map((id, i) => ({ id, kind: "mesh", resource: "base/x.mesh", transform: T(i * 2) }));
  const groups = [];
  const ids = (list) => list.map((o) => o.id);
  // Grouping a and b; a click on a then selects both, Alt picks a alone, Ctrl toggles.
  const g1 = makeGroup(["a", "b"], objects, groups);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].name, "Group 1");
  assert.deepEqual(pickSelection("a", [], objects, groups), ["a", "b"]);
  assert.deepEqual(pickSelection("a", [], objects, groups, { single: true }), ["a"]);
  assert.deepEqual(pickSelection("c", ["a", "b"], objects, groups, { toggle: true }), ["a", "b", "c"]);
  assert.deepEqual(pickSelection("a", ["a", "b", "c"], objects, groups, { toggle: true }), ["c"]);
  assert.deepEqual(pickSelection(undefined, ["a"], objects, groups), []);
  assert.deepEqual(pickMany(["b", "d"], [], objects, groups), ["a", "b", "d"]);
  // A group of the group and c: the new group holds the old one whole.
  const g2 = makeGroup(["a", "b", "c"], objects, groups);
  assert.equal(groups.find((g) => g.id === g1).parent, g2);
  assert.equal(objects.find((o) => o.id === "c").group, g2);
  assert.deepEqual(selectionUnits(["a", "b", "c"], objects, groups), { groups: [g2], objects: [] });
  assert.deepEqual(pickSelection("a", [], objects, groups), ["a", "b", "c"], "a click selects the outermost group");
  assert.deepEqual(selectionUnits(["a", "b"], objects, groups), { groups: [g1], objects: [] });
  // Duplicating the outer group copies both groups and three objects, offset.
  const copy = duplicate(["a", "b", "c"], objects, groups, [0, 10, 0]);
  assert.deepEqual(ids(copy.objects), ["a_2", "b_2", "c_2"]);
  assert.equal(copy.groups.length, 2);
  assert.deepEqual(copy.objects[0].transform.position, [0, 10, 0]);
  assert.equal(copy.objects[0].entityId, undefined);
  const outerCopy = copy.groups.find((g) => g.parent === null);
  assert.equal(copy.objects[2].group, outerCopy.id);
  assert.equal(copy.groups.find((g) => g.parent === outerCopy.id).name, "Group 1");
  // Ctrl+C of the inner group and a loose d: the copy keeps the group, d stands alone. Pasting twice gives
  // new ids each time, moved so the box's bottom middle is at the spot.
  const clip = copyOf(["a", "b", "d"], objects, groups);
  assert.equal(clip.groups.length, 1);
  assert.equal(clip.groups[0].parent, null, "a copied group whose parent was not copied stands at the top");
  assert.equal(clip.objects.find((o) => o.resource && o.id.startsWith("d")).group, undefined);
  const at = standPoint(clip.objects);
  assert.equal(at[2], 0);
  const p1 = pasteOf(clip, objects, groups, [100, 0, 5]);
  objects.push(...p1.objects);
  groups.push(...p1.groups);
  const p2 = pasteOf(clip, objects, groups, [200, 0, 5]);
  assert.equal(new Set([...ids(p1.objects), ...ids(p2.objects), ...ids(objects)]).size, ids(objects).length + 3, "each paste has new ids");
  assert.notEqual(p1.groups[0].id, p2.groups[0].id);
  assert.equal(p2.objects[0].group, p2.groups[0].id);
  assert.deepEqual(p2.objects[0].transform.position, [200, 0, 5]);
  for (const o of p1.objects) objects.splice(objects.indexOf(o), 1);
  groups.splice(groups.indexOf(p1.groups[0]), 1);
  // Ungrouping the outer group: the inner group and c step up to the top.
  assert.equal(ungroup(["a", "b", "c"], objects, groups), 1);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].parent, null);
  assert.equal(objects.find((o) => o.id === "c").group, undefined);
  // An object picked out of a group steps out of it; the empty group then goes.
  ungroup(["a"], objects, groups);
  assert.equal(objects.find((o) => o.id === "a").group, undefined);
  objects.find((o) => o.id === "b").group = undefined;
  pruneGroups(objects, groups);
  assert.equal(groups.length, 0);
  // Turning two objects 90 degrees around their middle swaps their places; scaling spreads them.
  const two = [T(-1), T(1)];
  const mid = centreOf(two);
  assert.deepEqual(mid, [0, 0, 0]);
  const q = [0, 0, Math.SQRT1_2, Math.SQRT1_2];
  const turned = two.map((t) => applyChange(t, { turn: q }, mid));
  assert.ok(Math.abs(turned[0].position[1] + 1) < 1e-9 && Math.abs(turned[0].position[0]) < 1e-9);
  const spread = applyChange(T(1), { scale: [2, 2, 2], move: [0, 0, 1] }, mid);
  assert.deepEqual(spread.position, [2, 0, 1]);
  assert.deepEqual(spread.scale, [2, 2, 2]);
  // The scene keeps its groups, and restore says which previews change.
  const scene = new Scene(path.join(tmp, "scenes", "arrange.scene.json"));
  const x = scene.add("mesh", "base/x.mesh", T(0));
  const y = scene.add("mesh", "base/x.mesh", T(2));
  const z = scene.add("mesh", "base/y.mesh", T(4));
  x.entityId = "1";
  y.entityId = "2";
  z.entityId = "3";
  makeGroup([x.id, y.id], scene.objects, scene.groups);
  scene.save();
  const back = new Scene(scene.file);
  back.load();
  assert.equal(back.groups.length, 1);
  assert.equal(back.objects[0].group, back.groups[0].id);
  const before = scene.state();
  assert.equal(before.objects[0].entityId, undefined, "a state has no previews");
  y.transform = T(3);
  z.transform.scale = [2, 2, 2];
  scene.remove(x.id);
  assert.equal(scene.groups.length, 1, "y still holds the group");
  const w = scene.add("mesh", "base/w.mesh", T(9));
  w.entityId = "4";
  const ch = scene.restore(before);
  assert.deepEqual(ids(ch.spawn), [x.id]);
  assert.deepEqual(ids(ch.move), [y.id]);
  assert.deepEqual(ids(ch.respawn), [z.id]);
  assert.deepEqual(ids(ch.gone), [w.id]);
  assert.equal(scene.get(y.id).entityId, "2", "a moved preview keeps its entity");
  assert.equal(scene.get(x.id).entityId, undefined);
  assert.equal(scene.objects.length, 3);
  const solidOne = { id: "s", kind: "mesh", resource: "a.mesh", solid: true, transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] } };
  assert.equal(duplicate(["s"], [solidOne], []).objects[0].solid, true, "a copy of a solid mesh is solid");
  console.log("arrange: ok");
}

// World edits (D1): which door a click means, the scene's removals, format 3, and REDnode's copy.
{
  const m = core;
  assert.equal(m.kindOfClass("Door"), "door");
  assert.equal(m.kindOfClass("Window"), "door", "shutter windows are doors");
  assert.equal(m.kindOfClass("FakeDoor"), "fakeDoor");
  assert.equal(m.kindOfClass("VendingMachine"), undefined);
  assert.ok(m.sameId("6132383399567759307", "0x551a9a360dbd17cb"), "a door's id in decimal and hex");
  assert.ok(!m.sameId("0", "0"), "0 is no id");
  assert.equal(m.idText("0x551a9a360dbd17cb"), "6132383399567759307");

  // A ray along x at 1 m high, and doors at x = 5 (on the line), x = 5 but 2 m aside, and x = 20 behind a wall at 10 m.
  const o = [0, 0, 1];
  const dir = [1, 0, 0];
  const near = { key: "a", position: [5, 0.3, 0] };
  const aside = { key: "b", position: [5, 2, 0] };
  const far = { key: "c", position: [20, 0, 0] };
  const seg = m.rayToSegment(o, dir, [5, 0.3, 0], [5, 0.3, 2.2]);
  assert.ok(Math.abs(seg.gap - 0.3) < 1e-9 && Math.abs(seg.along - 5) < 1e-9, `the gap and the distance along: ${JSON.stringify(seg)}`);
  assert.equal(m.doorUnderRay(o, dir, [aside, near, far], undefined)?.key, "a", "the door on the line");
  assert.equal(m.doorUnderRay(o, dir, [aside], undefined), undefined, "2 m aside is no pick");
  assert.equal(m.doorUnderRay(o, dir, [far], 10), undefined, "a door behind a wall is no pick");
  assert.equal(m.doorUnderRay(o, dir, [far], 19.6)?.key, "c", "a door in the wall's opening");
  assert.equal(m.doorUnderRay(o, [-1, 0, 0], [near], undefined), undefined, "a door behind the camera");
  // A node's box holding a physics hit: in the world, or in the mesh's own space (turned 90 degrees, scaled 2).
  const worldBox = { min: [9, -1, 0], max: [11, 1, 1] };
  assert.ok(m.boxHolds([10, 0, 1.02], worldBox, [10, 0, 0]), "a world box holds a hit on its top");
  assert.ok(!m.boxHolds([10, 0, 1.5], worldBox, [10, 0, 0]), "not half a metre above it");
  const meshBox = { min: [-1, -0.25, 0], max: [1, 0.25, 0.5] };
  const turned = [0, 0, Math.SQRT1_2, Math.SQRT1_2];
  assert.ok(m.boxHolds([100, 101.5, 50.5], meshBox, [100, 100, 50], turned, [2, 2, 2]), "a mesh box, turned and scaled, holds a point along its long side");
  assert.ok(!m.boxHolds([101.5, 100, 50.5], meshBox, [100, 100, 50], turned, [2, 2, 2]), "but not across it");

  assert.deepEqual(m.questWarnings("$/03_night_city/c_watson/little_china/.../{q001_door_v_flat}_prefab4EOA7RA/#q001_door_v_flat", "base\\worlds\\03_night_city\\_compiled\\default\\exterior_-22_19_1_0.streamingsector").length, 1, "V's door: a quest's");
  assert.equal(m.questWarnings("$/03_night_city/c_watson/lift_door_2", "base\\worlds\\03_night_city\\_compiled\\default\\quest_acd280b2b73c4d5b.streamingsector").length, 1, "a quest sector");
  assert.equal(m.questWarnings(undefined, "base\\worlds\\03_night_city\\_compiled\\default\\interior_-22_20_1_1.streamingsector").length, 0);

  const door = { id: "x", action: "remove", what: "door", label: "Door single_door.ent (doors_single_kitsch_g_frameless)", node: { sector: "base\\worlds\\03_night_city\\_compiled\\default\\exterior_-22_19_1_0.streamingsector", sectorHash: "0x3c9117867951bc5a", entry: 288, node: 271, type: "worldEntityNode", globalId: "6132383399567759307" }, fingerprint: { position: [-1388.56, 1271.94, 123.07] } };
  assert.equal(m.registryId(door.node), "0x3c9117867951bc5a:288", "the registry's id: the sector hash and the entry");
  assert.equal(m.editId(door.label, []), "remove_single_door");
  assert.equal(m.editId(door.label, [{ ...door, id: "remove_single_door" }]), "remove_single_door_2");
  assert.equal(m.editFor([door], { sectorHash: "0x3C9117867951BC5A", entry: 288 }), door, "found again by sector and entry");
  const lift = { ...door, id: "y", node: { ...door.node, sectorHash: "0xf497a66f9954b74b", entry: 175 } };
  const diff = m.editsDiff([door], [lift]);
  assert.deepEqual([diff.hide.map((e) => e.id), diff.show.map((e) => e.id)], [["y"], ["x"]]);
  assert.equal(m.readableEdits([door, { action: "move" }, null]).length, 1, "only removals with a node");

  const scene = new Scene(path.join(tmp, "scenes", "doors.scene.json"));
  const crate = scene.add("mesh", "base\\c.mesh", { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] });
  assert.equal(scene.data().format, 1, "no edits: format 1 as before");
  const before = scene.state();
  scene.worldEdits.push(door);
  scene.save();
  const file = readSceneFile(scene.file);
  assert.equal(file.format, 3, "a removal makes it format 3");
  assert.equal(file.worldEdits.length, 1);
  const copy = m.forReader(file);
  assert.equal(copy.format, 1, "REDnode's reader gets format 1 or 2");
  assert.equal(copy.worldEdits, undefined, "without the edits");
  assert.deepEqual(copy.objects.map((x) => x.id), [crate.id]);
  const again = new Scene(scene.file);
  assert.ok(again.load());
  assert.equal(again.worldEdits[0].node.entry, 288, "edits come back from the file");
  const undo = scene.restore(before);
  assert.deepEqual([undo.show.map((e) => e.id), undo.hide.length, scene.worldEdits.length], [["x"], 0, 0], "Undo shows the door again");
  assert.equal(scene.data().format, 1);
  // D1b: removals into the bake, the bake's hash and its checks.
  const { removals, unnamed } = m.bakeRemovals([door, { ...door, id: "z", node: { ...door.node, sector: "" } }]);
  assert.deepEqual(removals, [{ sector: door.node.sector, index: 288, kind: "worldEntityNode", hash: "6132383399567759307" }], "a removal as sector.build takes it");
  assert.deepEqual(unnamed.map((e) => e.id), ["z"], "one with no sector name is left out");
  const plainCrate = [{ id: "c", kind: "mesh", resource: "base\c.mesh", transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] } }];
  assert.equal(m.bakeHash(plainCrate, []), m.bakeHash(plainCrate), "no removals: the hash as before");
  assert.notEqual(m.bakeHash(plainCrate, [door]), m.bakeHash(plainCrate), "a removal makes a bake stale");
  const project = { name: "P", dir: tmp, archive: tmp, raw: tmp, resources: tmp };
  const onlyRemovals = m.checkBake({ file: "f", name: "Doors", objects: [], project, bridgeReady: true, needs: [], worldEdits: [door] });
  assert.ok(!onlyRemovals.some((x) => x.tone === "error"), "removals alone are something to bake");
  assert.ok(onlyRemovals.some((x) => x.tone === "info" && /ArchiveXL/.test(x.text)), "the bake says it needs ArchiveXL");
  assert.ok(m.checkBake({ file: "f", name: "Doors", objects: [], project, bridgeReady: true, needs: [], worldEdits: [door], bridgeVersion: "0.15.0" }).some((x) => x.tone === "error" && /0.16.0/.test(x.text)), "REDbridge 0.15.0 cannot bake removals");
  assert.ok(!m.checkBake({ file: "f", name: "Doors", objects: [], project, bridgeReady: true, needs: [], worldEdits: [door], bridgeVersion: "0.16.0" }).some((x) => x.tone === "error"), "0.16.0 can");
  assert.ok(m.checkBake({ file: "f", name: "Doors", objects: [], project, bridgeReady: true, needs: [] }).some((x) => x.tone === "error"), "nothing at all is still nothing");
  // A bake of removals alone: listed in its project and seen in the game by its .xl.
  const rp = path.join(tmp, "removals-project");
  const rproj = { name: "R", dir: rp, archive: path.join(rp, "source", "archive"), raw: path.join(rp, "source", "raw"), resources: path.join(rp, "source", "resources") };
  writeRecord(rproj, { slug: "d1b_doors", name: "D1b doors", removals: 4 });
  const xlDir = path.join(rproj.resources, "archive", "pc", "mod");
  fs.mkdirSync(xlDir, { recursive: true });
  fs.writeFileSync(path.join(xlDir, "d1b_doors.archive.xl"), '# Written by REDbridge sector.build for the EDGEbuilder scene "d1b_doors".\nstreaming:\n  sectors: []\n');
  assert.deepEqual(bakesIn(rproj).map((b) => [b.slug, b.removals]), [["d1b_doors", 4]], "a bake of removals alone is listed");
  const fakeGame = path.join(tmp, "game-removals");
  fs.mkdirSync(path.join(fakeGame, "archive", "pc", "mod"), { recursive: true });
  fs.copyFileSync(path.join(xlDir, "d1b_doors.archive.xl"), path.join(fakeGame, "archive", "pc", "mod", "d1b_doors.archive.xl"));
  assert.equal(deployedBakes(fakeGame).get("d1b_doors"), "d1b_doors.archive.xl", "and seen in the game");
  // D2: a door kept open, closed or locked.
  const kept = { ...door, id: "door_single_door", action: "door", door: { open: true }, before: { open: false, locked: false, closesItself: true } };
  assert.equal(m.editId(door.label, [], "door"), "door_single_door");
  assert.equal(m.editFor([door, kept], door.node, "door"), kept, "a door state is found by its action");
  assert.equal(m.editFor([kept], door.node), undefined, "and is not a removal");
  assert.deepEqual(m.doorAfter({}, "open"), { open: true });
  assert.deepEqual(m.doorAfter({ open: true }, "lock"), { open: true, locked: true }, "lock keeps what was set");
  assert.deepEqual(m.doorAfter({ open: true, locked: true }, "close"), { open: false, locked: true });
  assert.deepEqual(m.doorActions({ open: false, locked: false }, { open: true }), ["ActionSetOpened"]);
  assert.deepEqual(m.doorActions({ open: true, locked: false }, { open: false, locked: true }), ["ActionToggleLock", "ActionSetClosed"], "lock first, then close");
  assert.deepEqual(m.doorActions({ open: true, locked: true }, { open: true, locked: true }), [], "nothing when it is so already");
  assert.deepEqual(m.doorActions({ open: undefined }, { open: true }), [], "nothing to do without a known state");
  assert.equal(m.doorStateText({ open: false, locked: true }), "closed, locked");
  const reopened = m.editsDiff([kept], [{ ...kept, door: { open: false } }]);
  assert.deepEqual([reopened.hide.length, reopened.show.length], [1, 1], "a changed state is taken back and applied again");
  assert.equal(m.editsDiff([kept], [kept]).hide.length, 0);
  assert.equal(m.readableEdits([kept, { ...kept, door: undefined }]).length, 1, "a door edit needs its state");
  assert.deepEqual(m.editCounts([door, kept]), { removals: 1, doors: 1 });
  assert.equal(m.bakeHash(plainCrate, [kept]), m.bakeHash(plainCrate), "a door state never makes a bake stale");
  assert.deepEqual(m.bakeRemovals([kept]).removals, [], "nor goes into one");
  const onlyDoors = m.checkBake({ file: "f", name: "Doors", objects: [], project, bridgeReady: true, needs: [], worldEdits: [kept] });
  assert.ok(onlyDoors.some((x) => x.tone === "error" && /nothing to bake/.test(x.text)), "door states alone are nothing to bake");
  assert.ok(onlyDoors.some((x) => x.tone === "info" && /state is kept/.test(x.text)), "and the bake says why");
  console.log("world edits: ok");
}

// S1 Sectors (EDGEbuilder #9): finding sectors, a sector's rows, and the scenes that remove from one.
{
  const m = core;
  const v = String.raw`base\worlds\03_night_city\_compiled\default\exterior_-22_19_1_0.streamingsector`;
  assert.equal(m.sectorHash(v), "0x3c9117867951bc5a", "the registry's sector hash (D0's V's door)");
  assert.equal(m.sectorHash(v.toUpperCase()), m.sectorHash(v), "case does not matter");
  assert.equal(m.sectorName(v), "exterior_-22_19_1_0");
  const ext = { path: v, kind: "exterior", grid: [-22, 19, 1], level: 0, box: { min: [-1400, 1260, 100], max: [-1380, 1280, 140] }, block: "base" };
  const int = { path: String.raw`base\worlds\03_night_city\_compiled\default\interior_-22_19_1_1.streamingsector`, kind: "interior", grid: [-22, 19, 1], level: 1, box: { min: [-1500, 1200, 90], max: [-1300, 1300, 150] }, block: "ep1" };
  const quest = { path: String.raw`base\worlds\03_night_city\_compiled\default\quest_acd280b2b73c4d5b.streamingsector`, kind: "quest", grid: null, level: 0, box: { min: [0, 0, 0], max: [1, 1, 1] }, block: "base" };
  assert.ok(m.sectorMatches(ext, "-22 19") && m.sectorMatches(ext, "-22_19") && m.sectorMatches(ext, "-22, 19, 1"), "a grid cell, written three ways");
  assert.ok(!m.sectorMatches(ext, "-22 18") && !m.sectorMatches(quest, "-22 19"), "another cell, or none");
  assert.ok(m.sectorMatches(int, "interior -22") && !m.sectorMatches(int, "exterior"), "words in its path");
  assert.deepEqual(m.bridgeKinds(["exterior", "other"]), ["exterior", "navigation", "alwaysLoaded", "unknown"]);
  assert.deepEqual([m.levelsOf(null), m.levelsOf(1), m.levelsOf(3)?.[0]], [undefined, [1], 3]);
  assert.equal(m.distanceToBox([-1390, 1270, 120], ext.box), 0, "inside its box");
  assert.equal(m.distanceToBox([-1370, 1270, 120], ext.box), 10);
  const rows = m.sectorRows([int, quest, ext], [-1390, 1270, 120], 2);
  assert.deepEqual(rows.map((r) => r.name), ["exterior_-22_19_1_0", "quest_acd280b2b73c4d5b"], "finest level first, then the nearest middle, cut to the limit");
  assert.deepEqual(m.sectorRows([int, quest, ext], undefined, 3).map((r) => r.kind), ["exterior", "quest", "interior"], "by name: level, then exterior before quest");
  assert.equal(Math.round(m.distanceToMiddle([-1390, 1270, 120], ext.box)), 0);
  assert.equal(rows[0].grid?.[0], -22);
  const items = [
    { index: 0, node: 0, kind: "worldInstancedMeshNode", resource: String.raw`base\props\crate.mesh`, transform: { position: [1, 2, 3], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }, instances: [{}, {}, {}] },
    { index: 288, node: 271, kind: "worldEntityNode", resource: String.raw`base\gameplay\devices\doors\final\single_door.ent`, ref: "$/q001_door_v_flat", hash: "6132383399567759307", transform: { position: [-1388.56, 1271.94, 123.07], rotation: [0, 0, 0, 1], scale: [1, 1, 1] } },
  ];
  assert.deepEqual(m.nodeRows(items, "", 10).rows.map((r) => [r.entry, r.copies ?? 0]), [[0, 3], [288, 0]]);
  assert.deepEqual(m.nodeRows(items, "door", 10).rows.map((r) => r.entry), [288], "the filter: its file");
  assert.deepEqual(m.nodeRows(items, "#288", 10).rows.map((r) => r.entry), [288], "or its entry");
  assert.deepEqual([m.nodeRows(items, "", 1).rows.length, m.nodeRows(items, "", 1).matching], [1, 2], "cut, with how many match");
  assert.ok(m.placesEntity("worldEntityNode") && m.placesEntity("worldDeviceNode") && !m.placesEntity("worldEntityProxyMeshNode") && !m.placesEntity("worldMeshNode"));
  assert.equal(m.shortKind("worldCookedStaticMeshNode"), "CookedStaticMesh");
  const edits = [
    { action: "remove", node: { sector: v, sectorHash: "0x3c9117867951bc5a", entry: 288 } },
    { action: "remove", node: { sector: "", sectorHash: "0x3c9117867951bc5a", entry: 12 } },
    { action: "door", node: { sector: v, sectorHash: "0x3c9117867951bc5a", entry: 288 } },
    { action: "remove", node: { sector: int.path, sectorHash: "0x1", entry: 1 } },
  ];
  assert.equal(m.editsInSector(edits, v), 2, "removals by path or hash; door states are not counted");
  assert.equal(m.editsInSector(undefined, v), 0);
  const project = { name: "P", dir: "x", archive: "x", raw: "x", resources: "x" };
  const replaced = checkBake({ file: "f", name: "Doors", objects: [], project, bridgeReady: true, needs: [], worldEdits: [{ ...edits[0], id: "a", what: "door", label: "V's door", fingerprint: { position: [0, 0, 0] } }], replacedSectors: [v] });
  assert.ok(replaced.some((c) => c.tone === "warn" && /ArchiveXL refuses the removal/.test(c.text)), "a project that replaces a sector it removes from is warned about");
  console.log("sectors: ok");
}

// The viewport's geometry against a simulated game camera, for both ways ProjectPoint might answer.
{
  const m = core;
  const close = (a, b, eps, what) => assert.ok(Math.abs(a - b) < eps, `${what}: ${a} vs ${b}`);
  // A camera at a height, turned 30 degrees and pitched down 10.
  const q = m.qMul(m.qAxisAngle([0, 0, 1], 30), m.qAxisAngle([1, 0, 0], -10));
  const basis = { pos: [100, -50, 12], right: m.qRotate(q, [1, 0, 0]), fwd: m.qRotate(q, [0, 1, 0]), up: m.qRotate(q, [0, 0, 1]) };
  const W = 1920, H = 1080, vfov = (55 * Math.PI) / 180, aspect = 16 / 9;
  const camSpace = (p) => { const d = m.sub(p, basis.pos); return [m.dot(d, basis.right), m.dot(d, basis.up), m.dot(d, basis.fwd)]; };
  const games = {
    "-1..1, y up": (p) => { const [x, y, z] = camSpace(p); return { X: x / z / (aspect * Math.tan(vfov / 2)), Y: y / z / Math.tan(vfov / 2) }; },
    "pixels, y down": (p) => { const [x, y, z] = camSpace(p); return { X: 1920 + (x / z / (aspect * Math.tan(vfov / 2))) * 1920, Y: 1080 - (y / z / Math.tan(vfov / 2)) * 1080 }; },
  };
  const truthPx = (p) => { const [x, y, z] = camSpace(p); const nx = x / z / (aspect * Math.tan(vfov / 2)); const ny = y / z / Math.tan(vfov / 2); return [((nx + 1) / 2) * W, ((1 - ny) / 2) * H]; };
  for (const [name, projectPoint] of Object.entries(games)) {
    const cal = m.calibrate(m.calibrationPoints(basis).map(projectPoint));
    const cam = { ...basis, ...cal, pageW: W, pageH: H };
    for (const p of [[110, -40, 13], [95, -30, 5], [120, -20, 20]]) {
      const got = m.project(cam, p);
      const want = truthPx(p);
      close(got[0], want[0], 0.5, `${name} x`);
      close(got[1], want[1], 0.5, `${name} y`);
      const ray = m.rayFrom(cam, got[0], got[1]);
      const toP = m.norm(m.sub(p, basis.pos));
      close(m.dot(ray.d, toP), 1, 1e-6, `${name} ray through the point`);
    }
    assert.equal(m.project(cam, m.add(basis.pos, m.mul(basis.fwd, -5))), null, "behind the camera");
  }
  // Picking: a 2 x 2 x 2 box at (10, 0, 0), turned 45 degrees; a ray along +X hits its corner side.
  const hit = m.rayHitsBox({ o: [0, 0, 1], d: [1, 0, 0] }, { min: [-1, -1, 0], max: [1, 1, 2] }, [10, 0, 0], m.qAxisAngle([0, 0, 1], 45), [1, 1, 1]);
  close(hit, 10 - Math.SQRT2, 1e-6, "ray meets the turned box");
  assert.equal(m.rayHitsBox({ o: [0, 5, 1], d: [1, 0, 0] }, { min: [-1, -1, 0], max: [1, 1, 2] }, [10, 0, 0], [0, 0, 0, 1], [1, 1, 1]), null, "a ray beside the box misses");
  close(m.rayHitsBox({ o: [0, 0, 1], d: [1, 0, 0] }, { min: [-1, -1, 0], max: [1, 1, 2] }, [10, 0, 0], [0, 0, 0, 1], [2, 2, 2]), 8, 1e-6, "scale grows the box");
  // Dragging along an axis: a ray crossing the X axis at x = 3 gives 3.
  close(m.closestOnAxis({ o: [3, -5, 0], d: [0, 1, 0] }, [0, 0, 0], [1, 0, 0]), 3, 1e-9, "closest point on the axis");
  assert.equal(m.closestOnAxis({ o: [0, 0, 0], d: [1, 0, 0] }, [5, 0, 0], [1, 0, 0]), null, "looking along the axis");
  // Headings: a turn of 90 degrees left reads 90, and the scene file's yaw helper agrees.
  close(m.qYaw(m.qAxisAngle([0, 0, 1], 90)), 90, 1e-9, "yaw");
  close(m.qYaw(yawToQuaternion(-35)), -35, 1e-9, "yaw from the scene helper");
  const onFloor = m.rayOnPlaneZ({ o: [0, 0, 10], d: m.norm([1, 0, -1]) }, 0);
  close(onFloor[0], 10, 1e-9, "ray meets the floor plane");
  // The editor camera's look: heading and pitch to a rotation and back, and its axes.
  for (const l of [{ yaw: 0, pitch: 0 }, { yaw: 37, pitch: -20 }, { yaw: -150, pitch: 60 }]) {
    const a = m.lookAxes(l);
    const back = m.lookOf(a.fwd);
    close(back.yaw, l.yaw, 1e-9, "heading round trip");
    close(back.pitch, l.pitch, 1e-9, "pitch round trip");
    close(m.dot(a.fwd, a.right), 0, 1e-9, "forward and right are square");
    close(a.right[2], 0, 1e-9, "no roll: right stays level");
    close(m.qYaw(m.qLook(l)), l.yaw, 1e-9, "the gizmo's heading reads the same");
  }
  const at = m.lookAt([0, 0, 0], [0, 10, 10]);
  close(at.yaw, 0, 1e-9, "looking north");
  close(at.pitch, 45, 1e-9, "and up 45 degrees");
  console.log("viewport math: ok");
}

// Kinds and yaw.
assert.equal(kindOf("a\\b.mesh"), "mesh");
assert.equal(kindOf("a\\b.ENT"), "entity");
assert.equal(kindOf("a\\b.xbm"), undefined);
assert.deepEqual(yawToQuaternion(0), [0, 0, 0, 1]);

// B2c: mod archives (through a stand-in for REDbridge's archive.openMod), the project's loose files,
// the search over them, and what a scene needs.
{
  const game = path.join(tmp, "game");
  const modDir = path.join(game, "archive", "pc", "mod");
  fs.mkdirSync(modDir, { recursive: true });
  fs.mkdirSync(path.join(game, "mods", "redmod_props", "archives"), { recursive: true });
  fs.writeFileSync(path.join(modDir, "chickens.archive"), "1234");
  fs.writeFileSync(path.join(modDir, "readme.txt"), "not an archive");
  fs.writeFileSync(path.join(game, "mods", "redmod_props", "archives", "props.archive"), "12");
  const files = modArchives(game);
  assert.deepEqual(files.map((f) => f.mod).sort(), ["chickens", "redmod_props"]);
  const contents = {
    "chickens.archive": [
      { hash: "1", name: "base\\toys\\rubber_chicken.mesh", size: 10, archive: "chickens" },
      { hash: "2", name: "base\\toys\\rubber_chicken_d.xbm", size: 10, archive: "chickens" },
      { hash: "3", name: "base\\environment\\box_a.mesh", size: 10, archive: "chickens" },
    ],
    "props.archive": [{ hash: "4", name: "redmod_props\\lamp.ent", size: 10, archive: "props" }],
  };
  let reads = 0;
  const fake = { openMod: async (file) => (reads++, { path: file, name: path.basename(file), count: 0, items: contents[path.basename(file)] }) };
  const isGame = (p) => p.toLowerCase() === "base\\environment\\box_a.mesh";
  const sources = new ModSources(path.join(tmp, "sources", "mods.json"));
  let r = await sources.refreshMods(fake, files, isGame);
  assert.equal(r.changed, true);
  assert.equal(reads, 2);
  assert.equal(sources.modAssets, 3, "meshes and entities only");
  const box = sources.entries().find((e) => e.path.endsWith("box_a.mesh"));
  assert.equal(box.replaces, true, "a mod file with a game file's path changes that file");
  assert.equal(sources.entries().find((e) => e.path.endsWith("lamp.ent")).source.name, "redmod_props");
  r = await sources.refreshMods(fake, files, isGame);
  assert.equal(r.changed, false);
  assert.equal(reads, 2, "unchanged archives are not read again");
  const again = new ModSources(sources.cacheFile);
  assert.equal(again.modAssets, 3, "the cache survives a restart");
  fs.writeFileSync(path.join(modDir, "chickens.archive"), "123456");
  r = await again.refreshMods(fake, modArchives(game), isGame);
  assert.equal(reads, 3, "a changed archive is read again, only that one");
  fs.rmSync(path.join(game, "mods"), { recursive: true });
  r = await again.refreshMods(fake, modArchives(game), isGame);
  assert.equal(r.changed, true);
  assert.equal(again.modAssets, 2, "a removed mod is forgotten");

  // The project's loose files, as the game paths they get once packed.
  const archive = path.join(tmp, "project", "source", "archive");
  fs.mkdirSync(path.join(archive, "edgefab", "chair"), { recursive: true });
  fs.writeFileSync(path.join(archive, "edgefab", "chair", "chair.mesh"), "m");
  fs.writeFileSync(path.join(archive, "edgefab", "chair", "chair.ent"), "e");
  fs.writeFileSync(path.join(archive, "edgefab", "chair", "chair_d.xbm"), "t");
  again.scanProject({ name: "FabChair", archive }, isGame);
  assert.deepEqual(again.project.map((e) => e.path), ["edgefab\\chair\\chair.ent", "edgefab\\chair\\chair.mesh"]);
  assert.equal(again.project[0].source.kind, "project");

  // The project's own packed archive in the game's mods: one row per file, the project's, marked in game.
  const ownDir = path.join(tmp, "own-mods");
  fs.mkdirSync(ownDir, { recursive: true });
  const ownFile = path.join(ownDir, "FabChairMod.archive");
  fs.writeFileSync(ownFile, "a");
  const ownFake = { openMod: async (file) => ({ path: file, name: path.basename(file), count: 2, items: [{ hash: "5", name: "edgefab\\chair\\chair.ent", size: 1 }, { hash: "6", name: "edgefab\\old\\old.ent", size: 1 }] }) };
  const own = new ModSources(path.join(tmp, "sources-own", "mods.json"));
  await own.refreshMods(ownFake, [{ file: ownFile, mod: "FabChairMod" }], isGame);
  own.scanProject({ name: "FabChair", modName: "FabChairMod", archive }, isGame);
  const ownRows = own.entries().filter((e) => e.path.endsWith("chair.ent"));
  assert.equal(ownRows.length, 1, "a packed project file is one row");
  assert.equal(ownRows[0].source.kind, "project");
  assert.equal(ownRows[0].source.inGame, true);
  assert.equal(own.entries().find((e) => e.path.endsWith("chair.mesh")).source.inGame, undefined, "not packed yet: no mark");
  assert.equal(own.entries().find((e) => e.path.endsWith("old.ent")).source.kind, "mod", "a packed file no longer in the project stays the mod's");
  own.scanProject({ name: "Other", archive }, isGame);
  assert.equal(own.entries().filter((e) => e.path.endsWith("chair.ent")).length, 2, "another project's files are not merged with this mod");

  // Search: mods and the project beside the game, by source, and by the mod's name.
  const index = new AssetIndex(path.join(tmp, "index-b2c"));
  index.entries = [
    { path: "base\\environment\\box_a.mesh", kind: "mesh", size: 1 },
    { path: "base\\environment\\chair_b.mesh", kind: "mesh", size: 1 },
  ];
  index.extra = again.entries();
  assert.ok(index.isGamePath("base/environment/box_a.mesh"));
  assert.equal(index.search("chair", "all", 10)[0].source?.name, "FabChair", "mods and the project first");
  assert.deepEqual(index.search("chair", "all", 10, "game").map((e) => e.path), ["base\\environment\\chair_b.mesh"]);
  assert.equal(index.search("", "all", 10, "project").length, 2, "Project lists all of its files without text");
  assert.ok(index.search("", "all", 10, "mods").every((e) => e.source?.kind === "mod"));
  assert.deepEqual(index.search("chickens", "all", 10, "mods").map((e) => e.source.name), ["chickens", "chickens"], "a mod's name finds its files");
  assert.equal(index.search("chickens", "entity", 10, "mods").length, 0);

  // What a scene needs: mods and projects by name; a replaced game file needs nothing.
  assert.deepEqual(sceneNeeds(["base/toys/rubber_chicken.mesh", "edgefab\\chair\\chair.ent", "base\\environment\\box_a.mesh", "base\\environment\\chair_b.mesh", undefined], index.extra), [
    "chickens",
    "FabChair (REDcode project)",
  ]);
  // B2c-2: sizes and appearances of a mod's and the project's files, through mesh.info with archive or root.
  const asked = [];
  const answers = (from) => ({ path: "x", type: "mesh", bounds: { min: [0, 0, 0], max: [1, 2, 3] }, appearances: ["default", from.archive ? "mod" : "loose"], error: null });
  const newer = { meshInfoMany: async (paths, from) => (asked.push(from), paths.map(() => answers(from))) };
  const chicken = again.entries().find((e) => e.path.endsWith("rubber_chicken.mesh"));
  let info = await again.lookAt(newer, chicken);
  assert.deepEqual(info.appearances, ["default", "mod"]);
  assert.equal(asked[0].archive, chicken.source.file, "a mod's file is read from its archive");
  await again.lookAt(newer, chicken);
  assert.equal(asked.length, 1, "asked once");
  info = await again.lookAt(newer, again.project[1]);
  assert.deepEqual(info.appearances, ["default", "loose"]);
  assert.equal(asked[1].root, archive, "a project's file is read from its source\\archive");
  fs.writeFileSync(again.project[1].source.file, "changed");
  fs.utimesSync(again.project[1].source.file, new Date(), new Date(Date.now() + 5000));
  await again.lookAt(newer, again.project[1]);
  assert.equal(asked.length, 3, "a changed project file is asked again");
  const older = { meshInfoMany: async (paths) => paths.map((p) => ({ path: p, type: "", bounds: null, appearances: [], error: `'${p}' is not in the loaded archives` })) };
  const fresh = new ModSources(path.join(tmp, "sources-old", "mods.json"));
  fresh.scanProject({ name: "FabChair", archive }, isGame);
  assert.equal((await fresh.lookAt(older, fresh.project[0])).error, NeedsNewerBridge, "an older REDbridge says what is needed");
  const refuses = { meshInfoMany: async () => { throw new Error("Unexpected parameter: archive"); } };
  assert.equal((await fresh.lookAt(refuses, fresh.project[0])).error, NeedsNewerBridge);
  console.log("mods and project: ok");
}

// G1: the schemas, the checks on a scene a program wrote, and the command line without REDbridge.
{
  const { checkFiles, checkSceneData, findOverlaps, groupBridgeWarnings, overlapFindings, sceneSchema, validate } = core;
  const { spawnSync } = await import("node:child_process");
  for (const format of [1, 2, 3]) {
    const published = fs.readFileSync(path.join(here, "..", "docs", "schema", `scene-${format}.schema.json`), "utf8").replace(/\r\n/g, "\n");
    assert.equal(published, JSON.stringify(sceneSchema(format), null, 2) + "\n", `docs/schema/scene-${format}.schema.json is what the code checks against`);
  }
  const t = { position: [1, 2, 3], rotation: [0, 0, 0, 1], scale: [1, 1, 1] };
  const crate = { id: "crate_a", kind: "mesh", resource: "base\\c.mesh", transform: t, meta: { room: 7 } };
  const good = { format: 1, name: "Gen", generator: { name: "arena-gen", version: "27", build: 1193 }, groups: [{ id: "g", name: "G", parent: null }], objects: [{ ...crate, group: "g" }, { id: "lamp", kind: "light", transform: t, props: { type: "point" } }] };
  assert.deepEqual(validate(sceneSchema(1), good), []);
  assert.deepEqual(checkSceneData(good), { errors: [], warnings: [], dropped: [] });
  const bad = (change) => checkSceneData(change(JSON.parse(JSON.stringify(good))));
  const codes = (c) => c.errors.map((e) => e.code);
  assert.deepEqual(codes(bad((s) => ((s.format = 4), s))), ["schema"], "an unknown format");
  assert.deepEqual(codes(bad((s) => (delete s.objects[0].resource, s))), ["schema"], "a mesh needs a resource");
  assert.match(bad((s) => ((s.objects[0].transform.rotation = [0, 0, 1]), s)).errors[0].text, /transform\.rotation has 3 numbers, not 4/);
  assert.deepEqual(bad((s) => ((s.objects[0].transform.rotation = [0, 0, 1]), s)).errors[0].ids, ["crate_a"], "a schema error names the object by its id");
  assert.deepEqual(codes(bad((s) => ((s.objects[0].id = "has space"), s))), ["schema"], "an id's characters");
  assert.deepEqual(codes(bad((s) => ((s.objects[0].kind = "npc"), s))), ["schema"], "format 1 has no people");
  assert.deepEqual(codes(bad((s) => (s.objects.push({ ...crate }), s))), ["duplicate-id"]);
  assert.deepEqual(codes(bad((s) => (s.objects.push({ ...crate, id: "other", ref: "edgebuilder/gen/crate_a" }), s))), ["duplicate-ref"]);
  assert.deepEqual(codes(bad((s) => ((s.objects = []), s))), ["nothing-to-bake"]);
  const many = bad((s) => {
    for (let i = 0; i < 500; i++) s.objects.push({ id: `x${i}`, kind: "mesh", transform: t });
    return s;
  });
  assert.equal(many.errors.length, 1, "the same fault on many objects is one finding");
  assert.equal(many.errors[0].ids.length, 200, "up to the validator's limit");
  const warned = bad((s) => ((s.extra = 1), (s.objects[0].apperance = "x"), (s.objects[0].group = "nope"), (s.objects[1].solid = true), (s.objects[0].transform.rotation = [0, 0, 1, 1]), s));
  assert.deepEqual(warned.errors, []);
  assert.deepEqual(warned.warnings.map((w) => w.code).sort(), ["rotation-length", "solid-not-mesh", "unknown-field", "unknown-field", "unknown-group"]);
  const people = checkSceneData({ format: 2, name: "P", objects: [crate, { id: "p", kind: "npc", record: "Character.X", transform: t }] });
  assert.deepEqual(people.errors, []);
  assert.deepEqual(people.dropped.map((d) => d.id), ["p"], "a person is left out of a bake, and the report says so");
  assert.deepEqual(codes(checkSceneData({ format: 2, name: "P", objects: [{ id: "p", kind: "npc", record: "Character.X", resource: "a.ent", transform: t }] })), ["schema"], "a person has a record or a resource, not both");
  const edit = { id: "r", action: "remove", what: "door", label: "Door", node: { sector: "base\\s.streamingsector", sectorHash: "0x1", entry: 3, node: 2, type: "worldEntityNode" }, fingerprint: { position: [0, 0, 0] } };
  const withEdits = checkSceneData({ format: 3, name: "E", objects: [], worldEdits: [edit, { ...edit, id: "d", action: "door", door: { open: true } }, { ...edit, id: "u", node: { ...edit.node, sector: "" } }] });
  assert.deepEqual(withEdits.errors, [], "removals alone are something to bake");
  assert.deepEqual(withEdits.dropped.map((d) => d.kind), ["door state", "removal"]);
  assert.deepEqual(codes(checkSceneData({ format: 3, name: "E", objects: [], worldEdits: [{ ...edit, action: "door" }] })), ["schema"], "a door edit needs its state");

  // The files, as REDbridge answers for them.
  const info = (over) => ({ path: "", type: "mesh", bounds: { min: [-1, -1, 0], max: [1, 1, 2] }, appearances: ["default", "red"], hasCollision: true, error: null, ...over });
  const objs = [
    { ...crate, id: "ok", appearance: "red" },
    { ...crate, id: "look", appearance: "blue" },
    { ...crate, id: "soft", resource: "base/soft.mesh", solid: true },
    { ...crate, id: "theirs", resource: "mod\\a.mesh", bounds: { min: [0, 0, 0], max: [1, 1, 1] } },
    { ...crate, id: "theirs2", resource: "mod\\a.mesh", bounds: { min: [0, 0, 0], max: [1, 1, 1] } },
    { ...crate, id: "lost", resource: "mod\\b.mesh" },
  ];
  const infos = new Map([["base\\c.mesh", info({})], ["base\\soft.mesh", info({ hasCollision: false })], ["mod\\a.mesh", info({ error: "not in the loaded archives" })], ["mod\\b.mesh", info({ error: "not in the loaded archives" })]]);
  const files = checkFiles(objs, infos, "the game's archives");
  assert.deepEqual(files.errors.map((e) => [e.code, e.ids, e.files]), [["file-missing", ["lost"], ["mod\\b.mesh"]]]);
  assert.deepEqual(files.warnings.map((w) => [w.code, w.ids]), [["appearance", ["look"]], ["no-collision", ["soft"]], ["file-not-here", ["theirs", "theirs2"]]]);
  assert.deepEqual(files.warnings[2].files, ["mod\\a.mesh"], "a file is named once however many objects use it");
  assert.deepEqual(files.needs, ["mod\\a.mesh", "mod\\b.mesh"]);
  assert.deepEqual([...files.noCollision], ["base\\soft.mesh"]);

  // Overlaps: the same box counts, a prop inside a room's box does not.
  const at = (id, x, bounds, more = {}) => ({ id, kind: "mesh", resource: "base\\c.mesh", transform: { ...t, position: [x, 0, 0] }, bounds, ...more });
  const unit = { min: [0, 0, 0], max: [1, 1, 1] };
  const room = { min: [-10, -10, 0], max: [10, 10, 5] };
  const set = [at("a", 0, unit), at("twin", 0, unit), at("near", 0.005, unit, { resource: "base\\d.mesh" }), at("far", 5, unit), at("room", 0, room), at("lamp", 0, undefined, { kind: "light" })];
  const pairs = findOverlaps(set, (o) => o.bounds, 0.98);
  assert.deepEqual(pairs.map((p) => [p.a, p.b].sort().join("+")).sort(), ["a+near", "a+twin", "near+twin"]);
  const found = overlapFindings(pairs, set, 0.98);
  assert.deepEqual(found.map((f) => [f.code, f.ids.length]), [["same-place", 1], ["overlap", 2]]);
  assert.equal(findOverlaps(set, (o) => o.bounds, 0.5).length, 3, "a looser share finds no more here");

  // REDbridge's warnings, grouped.
  const grouped = groupBridgeWarnings([
    "object 4 (crate_a): 'mod/a.mesh' is not in the game's archives; the scene's bounds are used, and the game needs the mod that has it",
    "object 9 (crate_b): 'mod/a.mesh' is not in the game's archives; the scene's bounds are used, and the game needs the mod that has it",
    "base/ladder.ent: no bounds in the file; a 1 m box is used",
    "No game loaded: resources were not checked",
  ]);
  assert.deepEqual(grouped.map((g) => [g.file, g.ids]), [["mod/a.mesh", ["crate_a", "crate_b"]], ["base/ladder.ent", undefined], [undefined, undefined]]);
  assert.equal(grouped[1].text, "No bounds in the file; a 1 m box is used");

  // The writer's fields: kept by a save, copied to a duplicate, never baked.
  const file = path.join(tmp, "gen", "gen.scene.json");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(good));
  const s = new Scene(file);
  assert.equal(s.load(), true);
  s.objects[0].transform.position = [4, 5, 6];
  s.save();
  const saved = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.deepEqual(saved.generator, good.generator, "the generator is kept by a save");
  assert.deepEqual(saved.objects[0].meta, { room: 7 }, "an object's meta is kept by a save");
  assert.deepEqual(validate(sceneSchema(1), saved), [], "what EDGEbuilder saves is valid");
  assert.deepEqual(duplicate(["crate_a"], s.objects, s.groups).objects[0].meta, { room: 7 }, "a duplicate has its meta");
  assert.equal(bakeInput("Gen", undefined, [], s.objects).scene.objects[0].meta, undefined, "meta is never baked");
  const fresh = new Scene(path.join(tmp, "gen", "other.scene.json"));
  fresh.take({ format: 1, name: "Other", groups: [], objects: [] });
  assert.equal(fresh.data().generator, undefined, "a hand-made scene has no generator");

  // The scene's own id: made at the first save, kept by later saves and a reload, valid in every format's schema.
  assert.equal(typeof saved.id, "string", "a save gives a scene without one its id");
  assert.match(saved.id, /^[0-9a-f]{16}$/);
  for (const f of [1, 2, 3]) assert.deepEqual(validate(sceneSchema(f), { ...saved, format: f }), [], `id is valid in format ${f}`);
  assert.deepEqual(checkSceneData(saved).warnings.filter((w) => w.code === "unknown-field"), [], "check knows id");
  const again = new Scene(file);
  again.load();
  again.save();
  assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).id, saved.id, "the id is kept");
  assert.equal(new Scene(path.join(tmp, "gen", "none.scene.json")).data().id, undefined, "a scene not saved yet has no id");
  const theirs = path.join(tmp, "gen", "theirs.scene.json");
  fs.writeFileSync(theirs, JSON.stringify({ ...good, id: "arena-r27" }));
  const kept = new Scene(theirs);
  kept.load();
  kept.save();
  assert.equal(JSON.parse(fs.readFileSync(theirs, "utf8")).id, "arena-r27", "a writer's own id is kept");
  assert.equal(scanShelf({ place: "library", dir: path.join(tmp, "gen"), label: "Gen" }).scenes.find((x) => x.file === theirs)?.id, "arena-r27", "the Library list has the id");

  // The command line, as far as it goes without REDbridge.
  const cli = path.join(here, "..", "edgebuilder", "cli.mjs");
  const run = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });
  assert.equal(run().status, 2, "no command");
  assert.equal(run("bake", file).status, 2, "a bake needs --out or --project");
  assert.equal(run("check", file, "--pack").status, 2);
  assert.equal(run("check", file, "--archive", "a", "--archive", "b").status, 2);
  const off = run("check", file, "--offline", "--json");
  assert.equal(off.status, 0, off.stdout + off.stderr);
  const report = JSON.parse(off.stdout);
  assert.equal(report.ok, true);
  assert.deepEqual([report.scene.name, report.scene.slug, report.scene.format, report.counts.mesh, report.counts.light, report.checked], ["Gen", "gen", 1, 1, 1, "file"]);
  assert.equal(report.scene.hash, bakeHash(saved.objects), "the report's hash is the bake's");
  const broken = path.join(tmp, "gen", "broken.scene.json");
  fs.writeFileSync(broken, JSON.stringify({ ...good, objects: [{ id: "x", kind: "mesh", transform: t }] }));
  const no = run("check", broken, "--offline", "--json");
  assert.equal(no.status, 1);
  assert.equal(JSON.parse(no.stdout).errors[0].code, "schema");
  assert.equal(run("check", path.join(tmp, "gen", "none.scene.json"), "--offline").status, 1, "no such file");
  console.log("generated scenes (G1): ok");
}

// Every scene file the tests above wrote is valid by the published schema of its format.
{
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : e.name.endsWith(".scene.json") ? [path.join(dir, e.name)] : []));
  let n = 0;
  for (const f of walk(tmp)) {
    let data;
    try {
      data = JSON.parse(fs.readFileSync(f, "utf8"));
    } catch {
      continue; // the tests write a damaged file on purpose
    }
    if (![1, 2, 3].includes(data?.format) || !Array.isArray(data.objects) || f.endsWith("broken.scene.json")) continue;
    assert.deepEqual(core.validate(core.sceneSchema(data.format), data), [], `${f} is valid`);
    n++;
  }
  console.log(`schemas: ok (${n} scene files the tests wrote)`);
}

// The bridge and the index, against the real thing when it is here.
const exe = process.env.EDGEBUILDER_BRIDGE || findBridge() || [path.join(here, "..", "..", "REDbridge", "dist", "publish", "REDbridge.exe"), path.join(here, "..", "..", "REDbridge", "src", "REDbridge", "bin", "Release", "net10.0", "REDbridge.exe")].find((p) => fs.existsSync(p));
const game = [process.env.EDGEBUILDER_GAME, "C:\\Program Files (x86)\\Steam\\steamapps\\common\\Cyberpunk 2077"].find(isGameFolder);
if (!exe || !game) {
  console.log(`bridge and index: skipped (${exe ? "" : "no REDbridge.exe; "}${game ? "" : "no game folder"})`);
} else {
  const bridge = new BridgeClient(exe, game);
  bridge.start();
  const info = await bridge.info();
  assert.ok(info.gameLoaded && info.files > 100000, JSON.stringify(info));
  console.log(`bridge: ok (REDbridge ${info.version}, ${info.files} files)`);
  const bridgeAtLeast0121 = info.version.split(".").map(Number).reduce((a, n, i) => a + n * [10000, 100, 1][i], 0) >= 1201;
  const bridgeAtLeast012 = info.version.split(".").map(Number).reduce((a, n, i) => a + n * [10000, 100, 1][i], 0) >= 1200;
  const index = new AssetIndex(path.join(tmp, "index"));
  const key = `${info.archives}-${info.files}`;
  assert.equal(index.load(key), false);
  const t = Date.now();
  let last = "";
  await index.build(bridge, key, (text) => (last = text));
  assert.ok(index.entries.length > 1000, `only ${index.entries.length} assets`);
  assert.ok(index.entries.every((e) => e.kind === "mesh" || e.kind === "entity"));
  assert.equal(new Set(index.entries.map((e) => e.path.toLowerCase())).size, index.entries.length, "one entry per path, though some files are in two archives");
  assert.ok(fs.existsSync(index.file));
  console.log(`index: ok (${index.entries.length} assets in ${((Date.now() - t) / 1000).toFixed(1)} s; last progress: ${last})`);
  const crates = index.search("cargo crate", "mesh", 20);
  assert.ok(crates.length > 0 && crates.every((e) => e.kind === "mesh" && /cargo/i.test(e.path) && /crate/i.test(e.path)), JSON.stringify(crates.slice(0, 3)));
  assert.ok(index.search("cargo crate", "entity", 20).every((e) => e.kind === "entity"));
  assert.equal(index.search("zzzz_nothing_here", "all").length, 0);
  const info1 = await index.lookAt(bridge, crates[0].path);
  assert.ok(info1.bounds && info1.bounds.min.length === 3 && info1.appearances.length >= 1, JSON.stringify(info1));
  const newest = new AssetIndex(index.dir);
  assert.equal(newest.loadNewest(), true, "the newest index loads without knowing the game");
  assert.equal(newest.entries.length, index.entries.length);
  const reloaded = new AssetIndex(index.dir);
  assert.equal(reloaded.load(key), true);
  assert.equal(reloaded.entries.length, index.entries.length);
  assert.deepEqual(reloaded.info[crates[0].path], info1, "looked-at info is kept");
  // A real mod archive, when the game has one: names come from the archive itself.
  const real = modArchives(game).find((a) => /evilclown/i.test(a.file)) ?? modArchives(game)[0];
  if (real) {
    const mods = new ModSources(path.join(tmp, "sources-real", "mods.json"));
    const { failed } = await mods.refreshMods(bridge, [real], (p) => index.isGamePath(p));
    assert.deepEqual(failed, []);
    const first = mods.entries().find((e) => e.kind === "mesh");
    if (first) {
      const looked = await mods.lookAt(bridge, first);
      if (looked.error === NeedsNewerBridge) console.log(`mod archive: sizes skipped (REDbridge before 0.12.0)`);
      else assert.ok(looked.bounds && looked.appearances.length, JSON.stringify(looked));
    }
    console.log(`mod archive: ok (${real.mod}: ${mods.modAssets} meshes and entities${first ? `; ${first.path.split("\\").pop()} looked at` : ""})`);
  }
  // A real bake: the files sector.build writes, for a project the Bake tab would use.
  {
    const dir = path.join(tmp, "real-bake");
    const target = { name: "P", dir, archive: path.join(dir, "source", "archive"), raw: path.join(dir, "source", "raw"), resources: path.join(dir, "source", "resources") };
    fs.mkdirSync(dir, { recursive: true });
    const object = { id: "crate", kind: "mesh", resource: crates[0].path, transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] } };
    const built = await bridge.sectorBuild({ project: dir, scene: bakeInput("Smoke Bake", undefined, [], [object]).scene });
    assert.equal(built.nodes, 1);
    const plainBytes = fs.readFileSync(built.sector);
    assert.equal(built.name, "smoke_bake");
    const xl = settleXl(built.xl, built.name, built.blockPath);
    assert.match(fs.readFileSync(xl, "utf8"), /^streaming:/m);
    assert.deepEqual(bakesIn(target).map((b) => b.slug), ["smoke_bake"]);
    // The Solid switch through a real bake: the node type is in the file's names, plain or solid.
    if (bridgeAtLeast012) {
      assert.ok(!fs.readFileSync(built.sector).includes("worldInstancedDestructibleMeshNode"), "a plain mesh stays a plain node");
      const solid = await bridge.sectorBuild({ project: dir, scene: bakeInput("Smoke Bake", undefined, [], [{ ...object, solid: true }]).scene });
      assert.ok(fs.readFileSync(solid.sector).includes("worldInstancedDestructibleMeshNode"), "a solid mesh writes the node round 3 proved");
      // Seen from reaches the bake: the sector's streaming box reaches as far as its farthest distance.
      const far = await bridge.sectorBuild({ project: dir, scene: bakeInput("Smoke Bake", undefined, [], [{ ...object, streaming: streamingFor(300) }]).scene });
      assert.ok(far.streamingBox.max[0] - far.streamingBox.min[0] >= 600, "seen from 300 m: the box reaches 300 m each way");
      if (bridgeAtLeast0121) assert.ok(fs.readFileSync(far.sector).includes("forceAutoHideDistance"), "seen from is also the node's hide distance (REDbridge 0.12.1, #16)");
      assert.ok(!plainBytes.includes("forceAutoHideDistance"), "by size: the game decides");
      const [looked] = await bridge.meshInfoMany([crates[0].path]);
      assert.equal(typeof looked.hasCollision, "boolean", "mesh.info says whether a mesh has collision data");
      console.log(`solid through REDbridge: ok (hasCollision ${looked.hasCollision})`);
    }
    // The same scene into a Library bake's folder: sector.build takes any project-shaped folder.
    const libBake = core.bakeFolderProject(path.join(tmp, "lib-real", "smoke.bake"));
    fs.mkdirSync(libBake.dir, { recursive: true });
    const intoLib = await bridge.sectorBuild({ project: libBake.dir, scene: bakeInput("Smoke Bake", undefined, [], [object]).scene });
    settleXl(intoLib.xl, intoLib.name, intoLib.blockPath);
    writeRecord(libBake, { slug: intoLib.name, name: "Smoke Bake" });
    assert.deepEqual(core.bakeFilesOf("smoke_bake").map((f) => fs.existsSync(path.join(libBake.dir, ...f.split("/")))), [true, true, true, true], "a Library bake has a project bake's files");
    removeBake(target, "smoke_bake");
    assert.deepEqual(bakesIn(target), []);
    console.log(`bake through REDbridge: ok (${built.nodes} node)`);
  }
  // People from the real TweakDB (REDbridge 0.8.0 and later).
  {
    const list = new core.NpcList(index.dir);
    const t = Date.now();
    await list.build(bridge, key);
    assert.ok(list.entries.length > 500, `only ${list.entries.length} people`);
    const judy = list.find("character.judy");
    assert.ok(judy?.template?.endsWith(".ent") && judy.name, JSON.stringify(judy));
    assert.ok(list.entries.every((e) => e.kind === "npc" && e.template && !e.path.includes("_inline")));
    const again = new core.NpcList(index.dir);
    assert.equal(again.load(key), true, "kept for this game");
    assert.equal(again.entries.length, list.entries.length);
    assert.equal(newest.loadNewest(), true, "the people's list does not confuse the index");
    const looked = await index.lookAt(bridge, judy.template);
    console.log(`people from TweakDB: ok (${list.entries.length} in ${((Date.now() - t) / 1000).toFixed(1)} s; ${judy.name}: ${looked.appearances.length} appearances)`);
  }
  const bad = await index.lookAt(bridge, "base\\nope.mesh");
  assert.ok(bad.error);
  console.log(`search: ok (${crates.length} cargo crate meshes; first ${crates[0].path}, ${info1.appearances.length} appearances)`);
  bridge.stop();

  // G1: the command line through REDbridge: check, a dry run, a bake into a plain folder, packed.
  {
    const { spawnSync } = await import("node:child_process");
    const cli = path.join(here, "..", "edgebuilder", "cli.mjs");
    const run = (...args) => spawnSync(process.execPath, [cli, ...args, "--json", "--bridge", exe, "--game", game], { encoding: "utf8" });
    const t = (x) => ({ position: [x, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] });
    const file = path.join(tmp, "cli", "cli_yard.scene.json");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const sceneOf = (objects) => fs.writeFileSync(file, JSON.stringify({ format: 1, name: "CLI Yard", generator: { name: "smoke" }, groups: [], objects }));
    sceneOf([
      { id: "a", kind: "mesh", resource: crates[0].path, transform: t(0), meta: { n: 1 } },
      { id: "b", kind: "mesh", resource: crates[0].path, appearance: "no_such_look", transform: t(5) },
      { id: "theirs", kind: "mesh", resource: "smoke_mod\\not_here.mesh", transform: t(10), bounds: { min: [0, 0, 0], max: [1, 1, 1] } },
      { id: "lost", kind: "mesh", resource: "smoke_mod\\lost.mesh", transform: t(15) },
    ]);
    const refused = run("check", file);
    assert.equal(refused.status, 1, refused.stdout + refused.stderr);
    assert.deepEqual(JSON.parse(refused.stdout).errors.map((e) => [e.code, e.ids]), [["file-missing", ["lost"]]]);
    sceneOf(JSON.parse(fs.readFileSync(file, "utf8")).objects.filter((o) => o.id !== "lost"));
    const checked = JSON.parse(run("check", file).stdout);
    assert.equal(checked.ok, true, JSON.stringify(checked.errors));
    assert.deepEqual(checked.warnings.map((w) => w.code).sort(), ["appearance", "file-not-here"]);
    assert.deepEqual(checked.needs, ["smoke_mod\\not_here.mesh"]);
    const out = path.join(tmp, "cli", "out");
    const dry = JSON.parse(run("bake", file, "--out", out, "--dry-run").stdout);
    assert.equal(dry.ok && dry.dryRun, true);
    assert.equal(dry.written.length, 4);
    assert.equal(fs.existsSync(out), false, "a dry run writes nothing");
    const baked = run("bake", file, "--out", out, "--pack");
    assert.equal(baked.status, 0, baked.stdout + baked.stderr);
    const done = JSON.parse(baked.stdout);
    assert.equal(done.nodes, 3);
    for (const f of done.written) assert.ok(fs.existsSync(f), `${f} was written`);
    assert.deepEqual(done.written.slice(0, 4).map((f) => path.relative(out, f).replace(/\\/g, "/")), dry.written.map((f) => path.relative(out, f).replace(/\\/g, "/")), "a dry run names what a bake writes");
    assert.deepEqual(fs.readdirSync(path.join(out, "packed", "archive", "pc", "mod")).sort(), ["cli_yard.archive", "cli_yard.archive.xl"]);
    assert.equal(done.warnings.filter((w) => w.code === "redbridge" && /bounds are used/.test(w.text)).length, 0, "REDbridge does not repeat what the check said");
    assert.equal(bakesIn({ name: "out", dir: out, archive: path.join(out, "source", "archive"), raw: path.join(out, "source", "raw"), resources: path.join(out, "source", "resources") })[0].hash, done.scene.hash, "the bake's record is the Bake tab's");
    console.log(`command line through REDbridge: ok (3 objects baked and packed in ${done.ms.total} ms)`);
  }
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log("smoke: all passed");
