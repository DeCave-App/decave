// Streaming and recording apps that turn on DeCave's Streamer mode
// automatically (Settings → Privacy & safety → Streamer mode). Only process
// names are read; nothing about the processes leaves this computer except the
// app's display name, which the renderer shows in a toast.

const { execFile } = require("node:child_process");

const CAPTURE_APPS = [
  { name: "OBS Studio", processes: ["obs64.exe", "obs32.exe", "obs.exe", "obs"] },
  {
    name: "Streamlabs",
    processes: ["streamlabs obs.exe", "streamlabs desktop.exe", "streamlabs obs", "streamlabs desktop"],
  },
  { name: "XSplit", processes: ["xsplit.core.exe", "xsplit broadcaster.exe", "xsplitbroadcaster.exe"] },
  { name: "Meld Studio", processes: ["meld studio.exe", "meldstudio.exe", "meld studio"] },
  { name: "PRISM Live Studio", processes: ["prismlivestudio.exe", "prism live studio"] },
  { name: "vMix", processes: ["vmix64.exe", "vmix.exe"] },
  { name: "Elgato Capture", processes: ["4k capture utility.exe", "elgato 4k capture utility", "game capture hd.exe"] },
];

const LOOKUP = new Map();
for (const app of CAPTURE_APPS) for (const processName of app.processes) LOOKUP.set(processName, app.name);

/** Display names of capture apps found among these process names (deduplicated, stable order). */
function matchCaptureApps(processNames) {
  const found = new Set();
  for (const raw of processNames || []) {
    const name = String(raw || "")
      .trim()
      .toLowerCase();
    const base = name.split(/[\\/]/).pop() || name;
    const match = LOOKUP.get(name) || LOOKUP.get(base);
    if (match) found.add(match);
  }
  return CAPTURE_APPS.map((app) => app.name).filter((name) => found.has(name));
}

/** Parse `tasklist /FO CSV /NH` output into process names. */
function parseTasklistCsv(stdout) {
  return String(stdout || "")
    .split(/\r?\n/)
    .map((line) => /^"([^"]+)"/.exec(line.trim()))
    .filter(Boolean)
    .map((match) => match[1]);
}

function run(command, args) {
  return new Promise((resolve) => {
    execFile(command, args, { windowsHide: true, maxBuffer: 4 * 1024 * 1024, timeout: 8000 }, (error, stdout) => {
      resolve(error ? "" : String(stdout || ""));
    });
  });
}

/** Running capture apps on this computer, or { supported: false } elsewhere. */
async function scanCaptureApps(platform = process.platform) {
  if (platform === "win32") {
    return {
      supported: true,
      apps: matchCaptureApps(parseTasklistCsv(await run("tasklist.exe", ["/FO", "CSV", "/NH"]))),
    };
  }
  if (platform === "darwin") {
    return { supported: true, apps: matchCaptureApps((await run("/bin/ps", ["-axco", "comm"])).split(/\r?\n/)) };
  }
  return { supported: false, apps: [] };
}

module.exports = { CAPTURE_APPS, matchCaptureApps, parseTasklistCsv, scanCaptureApps };
