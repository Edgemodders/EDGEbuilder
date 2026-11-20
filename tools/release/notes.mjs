// Release notes from docs/changelog.md, the one changelog (the same way as REDnode's and EDGEchat's
// tools/release/notes.mjs). The release workflow uses it, and stops when the version has no section.
//
//   node tools/release/notes.mjs [version]              markdown for the GitHub release, with the install lines
//   node tools/release/notes.mjs [version] --nexus      plain lines for Nexus's changelog field
//   --out <file>                                        writes the notes to a file (UTF-8)
//   --pack <id>                                         an app pack's (packs/<id>): its changelog, version and install line
//
// The version defaults to the package's, in edgebuilder/rednode-app.json.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const args = process.argv.slice(2);
const nexus = args.includes("--nexus");
const outAt = args.indexOf("--out");
const out = outAt >= 0 ? args.splice(outAt, 2)[1] : null;
const packAt = args.indexOf("--pack");
const packId = packAt >= 0 ? args.splice(packAt, 2)[1] : null;
const pack = packId ? JSON.parse(readFileSync(`${root}packs/${packId}/pack.json`, "utf8")) : null;
const version = args.find((a) => !a.startsWith("--")) ?? (pack ? pack.version : JSON.parse(readFileSync(root + "edgebuilder/rednode-app.json", "utf8")).version);
const changelogFile = pack ? `packs/${packId}/changelog.md` : "docs/changelog.md";
const lines = readFileSync(root + changelogFile, "utf8").split(/\r?\n/);
const Docs = pack ? `https://github.com/Edgemodders/EDGEbuilder/blob/main/packs/${packId}/` : "https://edgemodders.github.io/EDGEbuilder/";

// "## 0.1.0" or "## 0.1.0 (2026-10-26)"
const heading = new RegExp(`^## ${version.replace(/\./g, "\\.")}(\\s|,|$)`);
const start = lines.findIndex((line) => heading.test(line));
if (start < 0) {
  console.error(`${changelogFile} has no section for ${version}: rename Unreleased to "## ${version} (date)" first`);
  process.exit(1);
}
let end = lines.findIndex((line, i) => i > start && line.startsWith("## "));
if (end < 0) end = lines.length;
const section = lines.slice(start + 1, end);
if (!section.some((line) => line.trim())) {
  console.error(`docs/changelog.md: the section for ${version} is empty`);
  process.exit(1);
}

// A section's Nexus summary, as EDGEmat's notes.mjs reads it (EDGEmat #14): short lines written by
// hand in an HTML comment under the heading, so GitHub and the docs site show none of it.
//
//   <!-- nexus
//   New: Import a model: a textured GLB becomes a prop in the running game
//   -->
//
// Each line starts with New:, Changed:, Fixed:, Removed:, Other: or Needs:, has no markdown and at most
// NexusLine characters; at most NexusLines lines, then a "Full changelog" line. Sections from before
// 0.11.1 have none: Nexus then gets their bullets as plain lines, as before.
const NexusLine = 120;
const NexusLines = 12;
const open = section.findIndex((line) => line.trim() === "<!-- nexus");
const close = open < 0 ? -1 : section.findIndex((line, i) => i > open && line.trim() === "-->");
if (open >= 0 && close < 0) {
  console.error(`docs/changelog.md: the Nexus summary for ${version} has no closing "-->"`);
  process.exit(1);
}
const github = open < 0 ? section : [...section.slice(0, open), ...section.slice(close + 1)];

if (nexus && open >= 0) {
  const summary = section.slice(open + 1, close).map((line) => line.trim()).filter(Boolean);
  const wrong = [];
  if (!summary.length) wrong.push("it is empty");
  if (summary.length > NexusLines) wrong.push(`${summary.length} lines, at most ${NexusLines}`);
  for (const line of summary) {
    if (!/^(New|Changed|Fixed|Removed|Other|Needs): \S/.test(line)) wrong.push(`"${line}" does not start with New:, Changed:, Fixed:, Removed:, Other: or Needs:`);
    if (line.length > NexusLine) wrong.push(`"${line.slice(0, 50)}..." is ${line.length} characters, at most ${NexusLine}`);
    if (/`|\*\*|\]\(|^#|^- /.test(line)) wrong.push(`"${line.slice(0, 50)}..." has markdown`);
  }
  if (wrong.length) {
    console.error(`docs/changelog.md: the Nexus summary for ${version}:\n- ${wrong.join("\n- ")}`);
    process.exit(1);
  }
  write([...summary, `Full changelog: ${pack ? `${Docs}changelog.md` : `${Docs}changelog.html`}`].join("\n"));
} else if (nexus) {
  // No summary: Nexus's changelog takes one plain line per change: no markdown, links as "text (url)".
  const plain = (text) => text
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1");
  const result = [];
  let group = "";
  for (const line of section) {
    const groupHeading = line.match(/^\*\*(.+)\*\*$/);
    if (groupHeading) group = groupHeading[1];
    else if (line.startsWith("- ")) result.push((group ? `${group}: ` : "") + plain(line.slice(2)));
    else if (line.trim()) result.push(plain(line.trim()));
  }
  write(result.join("\n"));
} else if (pack) {
  write(`${github.join("\n").trim()}

**Install:** \`${pack.name.replace(/\s+/g, "")}-${version}.zip\` below, the same file as on Nexus Mods, is laid out like the game folder: add it in EDGEdeck or Vortex and deploy with the game closed, or extract it into the game folder. Then switch **${pack.name}** on in REDnode's Mod Manager, before loading a save. Needs REDnode ${pack.rednode.replace(">=", "")} or later and Codeware, on game 2.5.${pack.guide ? `\n\nGuide: ${pack.guide}` : ""}`);
} else {
  write(`${github.join("\n").trim()}

**Install:** \`EDGEbuilder-${version}.zip\` below, the same file as on Nexus Mods (https://www.nexusmods.com/cyberpunk2077/mods/36627), is laid out like the game folder: add it in EDGEdeck or Vortex and deploy with the game closed, or extract it into the game folder. Then allow REDbridge and Archives for EDGEbuilder in REDnode's Mod Manager (EDGEbuilder, Permissions). Needs REDnode 0.58.0 or later, Codeware and REDbridge 0.16.0 or later: https://edgemodders.ai/wiki/edgebuilder/install.html

Docs: ${Docs} (changelog: ${Docs}changelog.html)`);
}

function write(text) {
  if (out) writeFileSync(out, text + "\n", "utf8");
  else console.log(text);
}
