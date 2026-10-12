// Is a game the window in front right now? Drives the in-game voice overlay,
// which should only appear over games, not over the desktop, a browser or
// DeCave itself.
//
// Windows: one long-lived, hidden PowerShell helper polls the foreground
// window (user32 GetForegroundWindow) twice a second and prints a JSON line
// only when the foreground process or its fullscreen state changes. It runs
// only while the overlay could be shown (in voice, overlay enabled).
// macOS: no foreground hook; a running Steam/Epic game counts.

const { spawn } = require("node:child_process");
const { isGameProcess } = require("./game-classification.cjs");

/** Apps that are never games even when fullscreen (browsers, players, chat, the shell, DeCave). */
const NEVER_GAMES =
  /^(explorer|decave|electron|chrome|msedge|firefox|opera|opera_gx|brave|vivaldi|arc|iexplore|discord|slack|teams|ms-teams|zoom|spotify|vlc|mpc-hc64|mpc-hc|potplayermini64|wmplayer|applicationframehost|textinputhost|searchhost|shellexperiencehost|startmenuexperiencehost|lockapp|code|devenv|obs64|obs32|steam|steamwebhelper|epicgameslauncher|powerpnt|winword|excel|outlook|notepad|taskmgr|systemsettings)(\.exe)?$/i;

/**
 * Pure decision: the foreground window is a game when it is a detected
 * Steam/Epic game process, or a fullscreen window of an app that looks like a game.
 */
function isGameForeground(foreground, gameProcessIds) {
  if (!foreground || !foreground.name || NEVER_GAMES.test(foreground.name)) return false;
  if (gameProcessIds.has(foreground.pid)) return true;
  return foreground.fullscreen === true && isGameProcess(foreground.name);
}

const WINDOWS_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class DcFg {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [StructLayout(LayoutKind.Sequential)] public struct MONITORINFO { public int cbSize; public RECT rcMonitor; public RECT rcWork; public int dwFlags; }
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern IntPtr MonitorFromWindow(IntPtr h, uint flags);
  [DllImport("user32.dll")] public static extern bool GetMonitorInfo(IntPtr m, ref MONITORINFO mi);
}
"@
$last = ''
while ($true) {
  $h = [DcFg]::GetForegroundWindow()
  $procId = [uint32]0
  [void][DcFg]::GetWindowThreadProcessId($h, [ref]$procId)
  $full = $false
  $r = New-Object DcFg+RECT
  if ([DcFg]::GetWindowRect($h, [ref]$r)) {
    $mi = New-Object DcFg+MONITORINFO
    $mi.cbSize = [System.Runtime.InteropServices.Marshal]::SizeOf($mi)
    if ([DcFg]::GetMonitorInfo([DcFg]::MonitorFromWindow($h, 2), [ref]$mi)) {
      $m = $mi.rcMonitor
      $full = ($r.L -le $m.L) -and ($r.T -le $m.T) -and ($r.R -ge $m.R) -and ($r.B -ge $m.B)
    }
  }
  $name = ''
  if ($procId -gt 0) { $p = Get-Process -Id $procId; if ($p) { $name = [string]$p.ProcessName } }
  $line = (@{ pid = [int]$procId; name = $name; fullscreen = $full } | ConvertTo-Json -Compress)
  if ($line -ne $last) { [Console]::Out.WriteLine($line); [Console]::Out.Flush(); $last = $line }
  Start-Sleep -Milliseconds 500
}
`.trim();

/**
 * Starts watching; `onChange(isGame)` fires with the current answer and on every change.
 * `listGameProcessIds()` returns the running Steam/Epic game PIDs (refreshed periodically).
 * Returns stop().
 */
function watchForegroundGame({ onChange, listGameProcessIds, spawnProcess = spawn, platform = process.platform }) {
  let stopped = false;
  let gamePids = new Set();
  let foreground = null;
  let current = null;
  const emit = () => {
    const next = platform === "darwin" ? gamePids.size > 0 : isGameForeground(foreground, gamePids);
    if (next !== current) {
      current = next;
      onChange(next);
    }
  };
  const refreshGames = async () => {
    try {
      gamePids = await listGameProcessIds();
    } catch {
      gamePids = new Set();
    }
    if (!stopped) emit();
  };
  void refreshGames();
  const gamesTimer = setInterval(() => void refreshGames(), 20_000);

  let child = null;
  if (platform === "win32") {
    child = spawnProcess(
      "powershell.exe",
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-EncodedCommand",
        Buffer.from(WINDOWS_SCRIPT, "utf16le").toString("base64"),
      ],
      { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] },
    );
    let buffer = "";
    child.stdout?.on("data", (chunk) => {
      buffer += String(chunk);
      let newline;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        try {
          const parsed = JSON.parse(line);
          foreground = {
            pid: Number(parsed.pid) || 0,
            name: typeof parsed.name === "string" ? parsed.name : "",
            fullscreen: parsed.fullscreen === true,
          };
          // A new foreground process might be a game that started after the last scan.
          if (foreground.pid && !gamePids.has(foreground.pid) && foreground.fullscreen) void refreshGames();
          emit();
        } catch {
          /* ignore a partial or malformed line */
        }
      }
    });
    child.on?.("error", () => {
      foreground = null;
      emit();
    });
  } else {
    emit();
  }

  return function stop() {
    stopped = true;
    clearInterval(gamesTimer);
    try {
      child?.kill();
    } catch {
      /* already exited */
    }
  };
}

module.exports = { isGameForeground, watchForegroundGame, NEVER_GAMES };
