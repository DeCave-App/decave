import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..", "..");
const read = (name) => fs.readFile(path.join(root, name), "utf8");

test("desktop updater uses a fixed packaged feed and guarded IPC", async () => {
  const [main, preload, packageText] = await Promise.all([
    read("electron/main.cjs"),
    read("electron/preload.cjs"),
    read("package.json"),
  ]);
  const packageJson = JSON.parse(packageText);

  assert.equal(packageJson.build.publish?.[0]?.provider, "generic");
  assert.equal(packageJson.build.publish?.[0]?.url, "https://downloads.de-cave.com/updates/windows/");
  assert.match(main, /case "\.mjs":\s*return "text\/javascript; charset=utf-8"/);
  assert.doesNotMatch(main, /setFeedURL\s*\(/);
  assert.match(main, /autoUpdater\.disableWebInstaller\s*=\s*true/);
  assert.match(main, /autoUpdater\.allowPrerelease\s*=\s*false/);
  assert.match(main, /readUnsignedWindowsUpdatesOptIn\(path\.join\(app\.getAppPath\(\), "package\.json"\)\)/);
  assert.match(main, /configureWindowsUpdateTrust\(\{[\s\S]*?allowUnsignedUpdates,[\s\S]*?autoUpdater/);
  assert.match(main, /updates are not publisher-authenticated; integrity relies on update-feed hashes/i);
  assert.match(main, /ipcMain\.handle\("decave:update:check"[\s\S]*?trustedMainRenderer\(event\)/);
  assert.match(main, /ipcMain\.handle\("decave:update:restart"[\s\S]*?trustedMainRenderer\(event\)/);
  assert.match(preload, /checkForUpdates:\s*\(\)\s*=>\s*ipcRenderer\.invoke\("decave:update:check"\)/);
  assert.doesNotMatch(preload, /setFeedURL|feedUrl|updateUrl/i);
});

test("release upload publishes immutable artifacts before latest.yml", async () => {
  const upload = await read("website/scripts/upload-release.mjs");
  const installerUpload = upload.indexOf("Uploading versioned update installer");
  const blockmapUpload = upload.indexOf("Uploading differential-update blockmap");
  const manifestUpload = upload.indexOf("Publishing update manifest last");

  assert.ok(installerUpload >= 0);
  assert.ok(blockmapUpload > installerUpload);
  assert.ok(manifestUpload > blockmapUpload);
  assert.match(upload, /no-store, max-age=0/);
  assert.match(upload, /max-age=31536000, immutable/);
  assert.match(upload, /DeCave-Setup\.exe\?v=\$\{encodeURIComponent\(packageJson\.version\)\}/);
  assert.match(upload, /updates\/windows\/\$\{encodeURIComponent\(installer\.name\)\}/);
});

test("closing the visible desktop window cannot leave an invisible single-instance process", async () => {
  const main = await read("electron/main.cjs");
  assert.match(main, /mainWindow\.on\("closed"[\s\S]*?!desktopSettings\.closeToTray[\s\S]*?app\.quit\(\)/);
  assert.match(main, /app\.on\("second-instance"[\s\S]*?createMainWindow\(\)/);
});

test("macOS updater uses its own fixed feed and the upload publishes notarized DMGs before latest-mac.yml", async () => {
  const [main, upload, packageText, hook] = await Promise.all([
    read("electron/main.cjs"),
    read("website/scripts/upload-release-mac.mjs"),
    read("package.json"),
    read("scripts/release/notarize-dmg.cjs"),
  ]);
  const packageJson = JSON.parse(packageText);

  assert.equal(packageJson.build.mac.publish?.[0]?.provider, "generic");
  assert.equal(packageJson.build.mac.publish?.[0]?.url, "https://downloads.de-cave.com/updates/mac/");
  assert.equal(packageJson.build.mac.hardenedRuntime, true);
  assert.equal(packageJson.build.dmg.sign, true);
  assert.equal(packageJson.build.afterAllArtifactBuild, "scripts/release/notarize-dmg.cjs");
  assert.match(main, /process\.platform !== "win32" && process\.platform !== "darwin"\)\) return;/);
  assert.match(hook, /\["stapler", "staple", dmg\]/);

  const archiveUpload = upload.indexOf("Uploading versioned update archive");
  const dmgUpload = upload.indexOf("Uploading versioned disk image");
  const manifestUpload = upload.indexOf("Publishing macOS update manifest last");
  assert.ok(archiveUpload >= 0);
  assert.ok(dmgUpload > archiveUpload);
  assert.ok(manifestUpload > dmgUpload);
  assert.ok(upload.indexOf('stapler", ["validate"') < archiveUpload);
  assert.match(upload, /updates\/mac/);
});
