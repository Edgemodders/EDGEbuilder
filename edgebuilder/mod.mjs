// EDGEbuilder's Node mod: the brain behind the editor page. B0: answers the page's hello.
// From B1 on this is built from src/ by esbuild; until then it is hand-written.
import { channel, game, pkg } from "rednode";

console.log(`EDGEbuilder ${pkg.id} starting; data folder ${pkg.dataDir}`);

async function hello() {
  let connected = false;
  let mainMenu = true;
  try {
    const s = await game.state();
    connected = s.connected;
    mainMenu = s.mainMenu;
  } catch {
    // The host is not linked to the game; say so.
  }
  channel.post({ type: "hello", connected, mainMenu });
}

channel.on((m) => {
  if (m?.type === "hello") void hello();
});

game.on("PlayerPuppet.OnGameAttached", () => {
  console.log("A save was loaded");
  void hello();
});
