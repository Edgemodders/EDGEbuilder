// Which of Ctrl, Shift and Alt are held, for clicks and drags. In the game, REDnode passes these as
// keys of their own but not on mouse events (a click's ctrlKey is always false there; B3-1 test), so
// the page keeps them from the key events it hears. The mock host and a browser set both.

const down = new Set<string>();
window.addEventListener("keydown", (e) => down.add(e.key), true);
window.addEventListener("keyup", (e) => down.delete(e.key), true);
window.addEventListener("blur", () => down.clear());

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
