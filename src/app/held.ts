// Which of Ctrl, Shift and Alt are held, for clicks and drags. In the game, REDnode passes these as
// keys of their own but not on mouse events (a click's ctrlKey is always false there; B3-1 test), so
// the page keeps them from the key events it hears. The mock host and a browser set both.
//
// A release the page never hears leaves a key held: Alt+Tab (the Tab comes, then the game loses the
// keyboard, so Alt's release goes elsewhere; likely why, in the 0.5.1 test, a click picked one
// object out of its group), or leaving interactive mode with a key down. Both forget what is held.

import { game } from "rednode";

const down = new Set<string>();
window.addEventListener(
  "keydown",
  (e) => {
    if (e.key === "Tab" && down.has("Alt")) return down.clear();
    down.add(e.key);
  },
  true,
);
window.addEventListener("keyup", (e) => down.delete(e.key), true);
window.addEventListener("blur", () => down.clear());
game.onState((s) => {
  if (s.overlay !== "interactive") down.clear();
});

export interface Held {
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
}

export function held(e: { ctrlKey: boolean; shiftKey: boolean; altKey: boolean }): Held {
  return {
    ctrl: e.ctrlKey || down.has("Control"),
    shift: e.shiftKey || down.has("Shift"),
    alt: e.altKey || down.has("Alt"),
  };
}
