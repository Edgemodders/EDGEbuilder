// E0's viewer, run in Electron (REDnode's checkout has one):
//   electron --remote-debugging-port=9224 probes/e0-view/main.cjs --manifest=<manifest-<run>.json>
// It shows one sector drawn from E0's GLB cache (scripts/e0-probe.mjs). A probe, not EDGEbuilder code.
const { app, BrowserWindow } = require("electron");
const path = require("node:path");

const manifest = process.argv.find((a) => a.startsWith("--manifest="))?.slice("--manifest=".length);
// Measured flights need frames while the window is behind others: no throttling of hidden windows.
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
app.commandLine.appendSwitch("disable-background-timer-throttling");
// Frame rates above the display's, so a measurement shows the headroom.
app.commandLine.appendSwitch("disable-frame-rate-limit");
app.commandLine.appendSwitch("disable-gpu-vsync");
app.whenReady().then(() => {
  const win = new BrowserWindow({ width: 1600, height: 900, title: "E0 sector view", backgroundColor: "#0b0d12", webPreferences: { webSecurity: false, backgroundThrottling: false } });
  win.loadFile(path.join(__dirname, "index.html"), { query: { manifest: manifest ?? "" } });
});
app.on("window-all-closed", () => app.quit());
