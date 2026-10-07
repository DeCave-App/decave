// Game activity detection for the desktop app: running processes (macOS and
// Windows), installed Steam and Epic games, and game icons.

const { app } = require("electron");
const { execFile } = require("node:child_process");
const fs = require("node:fs/promises");
const { existsSync } = require("node:fs");
const path = require("node:path");
const { promisify } = require("node:util");
const { steamAppTypes, isGameProduct, isGameProcess } = require("./game-classification.cjs");

const execFileAsync = promisify(execFile);

function normalized(value) {
  try {
    return path
      .resolve(value)
      .replace(/[\\\\/]+$/, "")
      .toLowerCase();
  } catch {
    return String(value || "")
      .replace(/[\\\\/]+$/, "")
      .toLowerCase();
  }
}

function isInside(child, parent) {
  const childPath = normalized(child);
  const parentPath = normalized(parent);
  return childPath === parentPath || childPath.startsWith(`${parentPath}${path.sep}`);
}

async function canRead(value) {
  try {
    await fs.access(value);
    return true;
  } catch {
    return false;
  }
}

function parseQuotedVdfValue(text, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = text.match(new RegExp(`"${escaped}"\\s+"([^"]*)"`, "i"));
  return match?.[1]?.replace(/\\\\/g, "\\") ?? "";
}

async function macProcesses() {
  if (process.platform !== "darwin") return [];
  try {
    // lstart is a fixed five-token timestamp, so everything after it is the full executable path.
    const { stdout } = await execFileAsync("/bin/ps", ["-axww", "-o", "pid=,lstart=,comm="], {
      maxBuffer: 8 * 1024 * 1024,
      env: { ...process.env, LC_ALL: "C" },
    });
    return stdout
      .split("\n")
      .map((line) => line.trim().match(/^(\d+)\s+(\S+\s+\S+\s+\d+\s+[\d:]+\s+\d{4})\s+(.+)$/))
      .filter(Boolean)
      .map(([, pid, started, command]) => {
        const startedAt = new Date(started);
        return {
          name: path.basename(command),
          executablePath: path.isAbsolute(command) ? command : "",
          processId: Number(pid) || 0,
          startedAt: Number.isNaN(startedAt.getTime()) ? null : startedAt.toISOString(),
        };
      })
      .filter((row) => row.processId > 0 && row.name);
  } catch (error) {
    console.error("DeCave activity scan could not read macOS processes:", error);
    throw new Error(
      error instanceof Error ? `Could not read macOS processes: ${error.message}` : "Could not read macOS processes.",
      { cause: error },
    );
  }
}

function runningProcesses() {
  return process.platform === "darwin" ? macProcesses() : windowsProcesses();
}

async function windowsProcesses() {
  if (process.platform !== "win32") return [];
  const script = `
$ErrorActionPreference = 'SilentlyContinue'
$processes = Get-CimInstance Win32_Process
$result = foreach ($process in $processes) {
  [PSCustomObject]@{
    Name = [string]$process.Name
    ExecutablePath = [string]$process.ExecutablePath
    ProcessId = [int]$process.ProcessId
    CreationDate = if ($process.CreationDate) {
      $process.CreationDate.ToUniversalTime().ToString('o')
    } else {
      $null
    }
  }
}
$result | ConvertTo-Json -Compress
`.trim();
  const encodedScript = Buffer.from(script, "utf16le").toString("base64");
  try {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", encodedScript],
      { windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
    );
    if (!stdout.trim()) return [];
    const parsed = JSON.parse(stdout);
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    return rows
      .map((row) => ({
        name: typeof row?.Name === "string" ? row.Name : "",
        executablePath: typeof row?.ExecutablePath === "string" ? row.ExecutablePath : "",
        processId: Number(row?.ProcessId) || 0,
        startedAt: typeof row?.CreationDate === "string" && row.CreationDate ? row.CreationDate : null,
      }))
      .filter((row) => row.processId > 0 && row.name);
  } catch (error) {
    console.error("DeCave activity scan could not read Windows processes:", error);
    throw new Error(
      error instanceof Error
        ? `Could not read Windows processes: ${error.message}`
        : "Could not read Windows processes.",
      { cause: error },
    );
  }
}

async function steamRoots(processes) {
  const roots = new Set();
  const defaults = [
    process.env["ProgramFiles(x86)"] ? path.join(process.env["ProgramFiles(x86)"], "Steam") : "",
    process.env.ProgramFiles ? path.join(process.env.ProgramFiles, "Steam") : "",
    process.platform === "darwin" ? path.join(app.getPath("home"), "Library", "Application Support", "Steam") : "",
  ].filter(Boolean);
  for (const item of defaults) {
    if (await canRead(path.join(item, "steamapps"))) roots.add(path.resolve(item));
  }
  for (const processInfo of processes) {
    if (String(processInfo.name).toLowerCase() !== "steam.exe") continue;
    const root = path.dirname(processInfo.executablePath);
    if (await canRead(path.join(root, "steamapps"))) roots.add(path.resolve(root));
  }
  const libraryRoots = new Set(roots);
  for (const root of roots) {
    try {
      const vdf = await fs.readFile(path.join(root, "steamapps", "libraryfolders.vdf"), "utf8");
      for (const match of vdf.matchAll(/"path"\s+"([^"]+)"/gi)) {
        const library = match[1].replace(/\\\\/g, "\\");
        if (await canRead(path.join(library, "steamapps"))) libraryRoots.add(path.resolve(library));
      }
    } catch {}
  }
  return [...libraryRoots];
}

async function steamGames(processes) {
  const result = [];
  const roots = await steamRoots(processes);
  const types = new Map();
  for (const root of roots) {
    try {
      for (const [id, type] of steamAppTypes(await fs.readFile(path.join(root, "appcache", "appinfo.vdf"))))
        types.set(id, type);
    } catch {}
  }
  for (const root of roots) {
    const steamApps = path.join(root, "steamapps");
    let entries = [];
    try {
      entries = await fs.readdir(steamApps);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!/^appmanifest_\d+\.acf$/i.test(entry)) continue;
      try {
        const text = await fs.readFile(path.join(steamApps, entry), "utf8");
        const appId = parseQuotedVdfValue(text, "appid");
        const gameName = parseQuotedVdfValue(text, "name");
        const installDir = parseQuotedVdfValue(text, "installdir");
        if (!gameName || !installDir || !isGameProduct("steam", appId, gameName, types.get(appId))) continue;
        result.push({
          source: "steam",
          gameName,
          appId,
          installPath: path.join(steamApps, "common", installDir),
        });
      } catch {}
    }
  }
  return result;
}

async function epicGames() {
  const epicRoot =
    process.platform === "darwin"
      ? path.join(app.getPath("home"), "Library", "Application Support", "Epic")
      : path.join(process.env.ProgramData || "C:\\ProgramData", "Epic");
  const manifestsDir = path.join(epicRoot, "EpicGamesLauncher", "Data", "Manifests");
  let entries = [];
  try {
    entries = await fs.readdir(manifestsDir);
  } catch {
    return [];
  }
  const result = [];
  for (const entry of entries) {
    if (!entry.toLowerCase().endsWith(".item")) continue;
    try {
      const value = JSON.parse(await fs.readFile(path.join(manifestsDir, entry), "utf8"));
      const gameName = typeof value.DisplayName === "string" ? value.DisplayName.trim() : "";
      const installLocation = typeof value.InstallLocation === "string" ? value.InstallLocation.trim() : "";
      const appId =
        typeof value.CatalogItemId === "string"
          ? value.CatalogItemId
          : typeof value.AppName === "string"
            ? value.AppName
            : "";
      if (!gameName || !installLocation || !isGameProduct("epic", appId, gameName, value.AppType)) continue;
      result.push({ source: "epic", gameName, appId, installPath: installLocation });
    } catch {}
  }
  return result;
}

const GAME_CACHE_MS = 120_000;
let gamesCache = null;
const gameIconCache = new Map();

async function installedGames(processes) {
  if (gamesCache && gamesCache.expiresAt > Date.now()) return gamesCache.games;
  const [steam, epic] = await Promise.all([steamGames(processes), epicGames()]);
  const games = [...steam, ...epic].sort((a, b) => normalized(b.installPath).length - normalized(a.installPath).length);
  gamesCache = { expiresAt: Date.now() + GAME_CACHE_MS, games };
  return games;
}

function processMatchesKnownGame(processInfo, game) {
  const processName = String(processInfo.name || "")
    .trim()
    .toLowerCase();
  if (!processName) return false;
  if (
    game.source === "steam" &&
    game.appId === "578080" &&
    (processName === "tslgame.exe" || processName === "execpubg.exe" || processName === "tslgame_be.exe")
  ) {
    return true;
  }
  return false;
}

async function detectedGameIconDataUrl(detected, games) {
  const cacheKey = `${detected.source}:${detected.appId || detected.gameName}`;
  const cached = gameIconCache.get(cacheKey);
  if (cached) return cached;
  const matchedInstall = games.find((game) => game.source === detected.source && game.appId === detected.appId);
  const candidates = [];
  if (path.isAbsolute(detected.executable) && existsSync(detected.executable)) {
    // On macOS the executable's own icon is generic; the enclosing .app bundle carries the game icon.
    const bundle = process.platform === "darwin" ? detected.executable.match(/^(.*?\.app)(?:\/|$)/i)?.[1] : null;
    if (bundle) candidates.push(bundle);
    candidates.push(detected.executable);
  }
  if (matchedInstall?.source === "steam" && matchedInstall.appId === "578080") {
    candidates.push(
      path.join(matchedInstall.installPath, "TslGame", "Binaries", "Win64", "TslGame.exe"),
      path.join(matchedInstall.installPath, "ExecPubg.exe"),
    );
  }
  if (matchedInstall && !candidates.length) {
    try {
      const entries = await fs.readdir(matchedInstall.installPath, { withFileTypes: true });
      for (const entry of entries) {
        if (
          process.platform === "darwin"
            ? entry.isDirectory() && entry.name.toLowerCase().endsWith(".app")
            : entry.isFile() && entry.name.toLowerCase().endsWith(".exe")
        ) {
          candidates.push(path.join(matchedInstall.installPath, entry.name));
        }
      }
    } catch {}
  }
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    try {
      const image = await app.getFileIcon(candidate, { size: "large" });
      if (!image.isEmpty()) {
        const dataUrl = image.toDataURL();
        if (dataUrl) gameIconCache.set(cacheKey, dataUrl);
        return dataUrl;
      }
    } catch {}
  }
  return "";
}

async function scanActivity() {
  const scannedAt = new Date().toISOString();
  if (process.platform !== "win32" && process.platform !== "darwin") {
    return { supported: false, platform: process.platform, game: null, scannedAt };
  }
  const processes = await runningProcesses();
  const games = await installedGames(processes);
  const ignoredNames = new Set([
    "steam.exe",
    "steamwebhelper.exe",
    "gameoverlayui.exe",
    "epicgameslauncher.exe",
    "epicwebhelper.exe",
    "unrealcefsubprocess.exe",
    "crashreportclient.exe",
    "steam_osx",
    "steamwebhelper",
    "steam helper",
    "epicgameslauncher",
    "epicwebhelper",
    "unrealcefsubprocess",
    "crashreportclient",
  ]);
  const candidates = [];
  for (const game of games) {
    for (const processInfo of processes) {
      if (ignoredNames.has(String(processInfo.name).toLowerCase()) || !isGameProcess(processInfo.name)) continue;
      const pathMatch = Boolean(processInfo.executablePath) && isInside(processInfo.executablePath, game.installPath);
      if (!pathMatch && !processMatchesKnownGame(processInfo, game)) continue;
      candidates.push({
        source: game.source,
        gameName: game.gameName,
        appId: game.appId,
        executable: processInfo.executablePath || processInfo.name,
        processId: processInfo.processId,
        startedAt: processInfo.startedAt,
      });
    }
  }
  candidates.sort((a, b) => {
    const aTime = a.startedAt ? Date.parse(a.startedAt) : 0;
    const bTime = b.startedAt ? Date.parse(b.startedAt) : 0;
    return bTime - aTime;
  });
  const detected = candidates[0] ?? null;
  if (detected) {
    const iconDataUrl = await detectedGameIconDataUrl(detected, games);
    if (iconDataUrl) detected.iconDataUrl = iconDataUrl;
    // The full path (user folder, drive layout) stays in the main process; the
    // renderer only needs the file name.
    detected.executable = path.basename(detected.executable);
  }
  console.log(
    `[DeCave activity] scanned ${processes.length} ${process.platform === "darwin" ? "macOS" : "Windows"} processes, ${games.length} installed Steam/Epic games; ` +
      (detected ? `detected ${detected.gameName}` : "no running game detected"),
  );
  return { supported: true, platform: process.platform, game: detected, scannedAt };
}

module.exports = { scanActivity };
