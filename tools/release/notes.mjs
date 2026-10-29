// Release notes from docs/changelog.md, the one changelog (the same way as REDnode's and EDGEchat's
// tools/release/notes.mjs). The release workflow uses it, and stops when the version has no section.
//
//   node tools/release/notes.mjs [version]              markdown for the GitHub release, with the install lines
//   node tools/release/notes.mjs [version] --nexus      plain lines for Nexus's changelog field
//   --out <file>                                        writes the notes to a file (UTF-8)
//
// The version defaults to the package's, in edgebuilder/rednode-app.json.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const args = process.argv.slice(2);
const nexus = args.includes("--nexus");
const outAt = args.indexOf("--out");
const out = outAt >= 0 ? args.splice(outAt, 2)[1] : null;
const version = args.find((a) => !a.startsWith("--")) ?? JSON.parse(readFileSync(root + "edgebuilder/rednode-app.json", "utf8")).version;
const lines = readFileSync(root + "docs/changelog.md", "utf8").split(/\r?\n/);
const Docs = "https://edgemodders.github.io/EDGEbuilder/";

// "## 0.1.0" or "## 0.1.0 (2026-10-26)"
const heading = new RegExp(`^## ${version.replace(/\./g, "\\.")}(\\s|,|$)`);
const start = lines.findIndex((line) => heading.test(line));
if (start < 0) {
  console.error(`docs/changelog.md has no section for ${version}: rename Unreleased to "## ${version} (date)" first`);
  process.exit(1);
}
let end = lines.findIndex((line, i) => i > start && line.startsWith("## "));
if (end < 0) end = lines.length;
const section = lines.slice(start + 1, end);
if (!section.some((line) => line.trim())) {
  console.error(`docs/changelog.md: the section for ${version} is empty`);
  process.exit(1);
}

if (nexus) {
  // Nexus's changelog takes one plain line per change: no markdown, links as "text (url)".
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
} else {
  write(`${section.join("\n").trim()}

**Install:** in EDGEdeck, add \`edgebuilder-${version}.zip\` below as a mod, turn it on and deploy with the game closed. Then allow REDbridge for EDGEbuilder in REDnode's Mod Manager (EDGEbuilder, Permissions). Needs REDnode, Codeware and REDbridge: ${Docs}testing.html#before-any-in-game-test

Docs: ${Docs} (changelog: ${Docs}changelog.html)`);
}

function write(text) {
  if (out) writeFileSync(out, text + "\n", "utf8");
  else console.log(text);
}
