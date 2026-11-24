// The T0 probe's Node half (docs/tools.md): what its tool, mounted in EDGEbuilder's page, calls.
import { service } from "rednode";

const started = Date.now();
let calls = 0;
let ticks = 0;

/**
 * Says hello: the probe's check that a tool's page half reaches its own Node half.
 * @param {string} [name] who to greet
 */
export function hello(name = "you") {
  calls++;
  return {
    greeting: `Hello, ${name}, from the tool probe's Node half`,
    calls,
    pid: process.pid,
    upSeconds: Math.round((Date.now() - started) / 1000),
  };
}

/**
 * Counts objects by kind: plain data from the page, worked on in Node.
 * @param {{ kind: string }[]} [items] the selection, as the tool API gives it
 */
export function count(items = []) {
  const by = {};
  for (const i of items) by[i.kind] = (by[i.kind] ?? 0) + 1;
  return by;
}

// @event tick: every 2 s, { n }, to every package that connected (here, EDGEbuilder's page).
setInterval(() => {
  ticks++;
  try {
    service.emit("tick", { n: ticks });
  } catch {
    // The service file is still loading.
  }
}, 2000);
