import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);
const desktopI18n = require("../../electron/i18n.cjs");
const { LOCALES } = await import("../../shared/i18n/languages.ts");
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");
const english = JSON.parse(read("shared/i18n/locales/en/desktop.json"));
const lookup = (catalog, key) =>
  key
    .split(".")
    .slice(1)
    .reduce((node, part) => node?.[part], catalog);

test("Electron main supports the same languages as the app", () => {
  assert.deepEqual(desktopI18n.LOCALES, [...LOCALES]);
  assert.equal(desktopI18n.resolveLocale(["el-GR", "en-US"]), "el");
  assert.equal(desktopI18n.resolveLocale(["pt-PT"]), "pt-BR");
  assert.equal(desktopI18n.resolveLocale(["ja-JP"]), "en");
  assert.equal(desktopI18n.resolveLocale([]), "en");
});

test("tMain returns the English catalog text unchanged and follows the reported language", () => {
  const seen = [];
  const stop = desktopI18n.onMainLocaleChange((locale) => seen.push(locale));
  try {
    assert.equal(desktopI18n.tMain("desktop.tray.open"), "Open DeCave");
    assert.equal(desktopI18n.tMain("desktop.picker.windowTitle"), "Choose what to share · DeCave");
    assert.equal(desktopI18n.setMainLocale("xx"), false, "unsupported values are ignored");
    assert.equal(desktopI18n.setMainLocale("el"), true);
    assert.equal(desktopI18n.currentLocale(), "el");
    // Keys not yet translated fall back to English.
    const greek = JSON.parse(read("shared/i18n/locales/el/desktop.json"));
    assert.equal(desktopI18n.tMain("desktop.tray.quit"), lookup(greek, "desktop.tray.quit") ?? "Quit DeCave");
    assert.deepEqual(seen, ["el"]);
  } finally {
    desktopI18n.setMainLocale("en");
    stop();
  }
});

test("native desktop text comes from the desktop catalog", () => {
  const main = read("electron/main.cjs");
  const picker = read("electron/source-picker.cjs");
  const turnstile = read("electron/turnstile.cjs");
  for (const literal of ["Open DeCave", "Quit DeCave", "Mute / Unmute", "could not check for updates"]) {
    assert.ok(!main.includes(literal), `electron/main.cjs still hard-codes "${literal}"`);
  }
  for (const literal of ["Choose what to share", "Entire Screen", ">Cancel<"]) {
    assert.ok(!picker.includes(literal), `electron/source-picker.cjs still hard-codes "${literal}"`);
  }
  assert.ok(!turnstile.includes('"DeCave security verification"'));
  const used = new Set();
  for (const file of ["electron/main.cjs", "electron/source-picker.cjs", "electron/turnstile.cjs"]) {
    for (const match of read(file).matchAll(/"(desktop\.[\w.]+)"/g)) used.add(match[1]);
  }
  assert.ok(used.size > 10);
  for (const key of used) {
    assert.equal(typeof lookup(english, key), "string", `${key} is missing from en/desktop.json`);
  }
});

test("the renderer reports its language through a guarded preload call", () => {
  const main = read("electron/main.cjs");
  const preload = read("electron/preload.cjs");
  assert.match(preload, /setLocale:\s*\(locale\)\s*=>\s*ipcRenderer\.invoke\("decave:desktop:set-locale", locale\)/);
  assert.match(
    main,
    /ipcMain\.handle\("decave:desktop:set-locale"[\s\S]*?trustedMainRenderer\(event\)[\s\S]*?isLocale\(rawLocale\)/,
  );
});

test("the desktop catalogs ship with the app", () => {
  const files = JSON.parse(read("package.json")).build.files;
  assert.ok(files.includes("electron/i18n.cjs"));
  assert.ok(files.includes("shared/i18n/locales/*/desktop.json"));
});

test("the Windows installer offers the app's ten languages", () => {
  const nsis = JSON.parse(read("package.json")).build.nsis;
  assert.equal(nsis.multiLanguageInstaller, true);
  assert.deepEqual(nsis.installerLanguages, [
    "en_US",
    "el_GR",
    "es_ES",
    "pt_BR",
    "fr_FR",
    "nl_NL",
    "de_DE",
    "it_IT",
    "pl_PL",
    "uk_UA",
  ]);
});
