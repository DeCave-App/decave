// The DeCave icon file for windows and the tray, from the packaged resources or
// the build folder in development.

const { app, nativeImage } = require("electron");
const path = require("node:path");
const { existsSync } = require("node:fs");

function resolveAppIconPath() {
  const candidates = app.isPackaged
    ? [
        path.join(process.resourcesPath, process.platform === "win32" ? "decave.ico" : "decave-icon-512.png"),
        path.join(process.resourcesPath, "decave-icon-512.png"),
      ]
    : [
        // PNG is the most reliable BrowserWindow/taskbar source while running
        // from Electron in development. The ICO remains the installer master.
        path.join(__dirname, "..", "build", "decave-icon-512.png"),
        path.join(__dirname, "..", "build", "decave.ico"),
        path.join(__dirname, "..", "src", "assets", "decave-mark-reference.png"),
      ];

  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    try {
      const image = nativeImage.createFromPath(candidate);
      if (!image.isEmpty()) return candidate;
    } catch {
      // Try the next generated asset if this platform cannot decode the file.
    }
  }

  console.warn("DeCave desktop icon asset was not found; using Electron fallback.");
  return undefined;
}

module.exports = { resolveAppIconPath };
