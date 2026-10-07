import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const root = process.cwd();

function fail(message) {
  console.error(`[DeCave desktop] ${message}`);
  process.exit(1);
}

console.log("[DeCave desktop] Building the packaged local renderer...");
const npmExecutable = process.platform === "win32" ? "npm.cmd" : "npm";
const rendererBuild = spawnSync(npmExecutable, ["run", "build:web"], {
  cwd: root,
  stdio: "inherit",
  shell: false,
});
if (rendererBuild.error) throw rendererBuild.error;
if (rendererBuild.status !== 0) {
  fail(`Local renderer build failed with exit code ${rendererBuild.status ?? "unknown"}.`);
}

const require = createRequire(import.meta.url);
const electronPath = require("electron");
if (typeof electronPath !== "string" || !electronPath) {
  fail("Could not resolve the installed Electron executable.");
}

console.log("[DeCave desktop] Launching the production-equivalent local-renderer boundary.");

const electronProcess = spawn(electronPath, [root], {
  cwd: root,
  stdio: "inherit",
  windowsHide: false,
  env: process.env,
});

let closing = false;

function shutdown(exitCode = 0) {
  if (closing) return;
  closing = true;

  try {
    if (!electronProcess.killed && electronProcess.exitCode === null) {
      electronProcess.kill();
    }
  } catch {
    // Electron may already be closed.
  }

  process.exit(exitCode);
}

electronProcess.on("error", (error) => {
  console.error("[DeCave desktop] Electron failed to start:", error);
  shutdown(1);
});

electronProcess.on("exit", (code, signal) => {
  const result = signal ? `signal ${signal}` : `code ${code ?? "unknown"}`;
  console.log(`[DeCave desktop] Desktop app exited with ${result}.`);
  shutdown(code ?? (signal ? 1 : 0));
});

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
