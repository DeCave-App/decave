import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const { NAMESPACES } = await import("../../shared/i18n/namespaces.ts");
const runtime = await import("../../src/i18n/index.ts");
const { default: i18next } = await import("i18next");
const map = await import("../../src/features/settings/settingsMap.ts");

const readLocale = (locale) =>
  Object.fromEntries(
    NAMESPACES.map((ns) => [
      ns,
      JSON.parse(fs.readFileSync(path.join(root, "shared/i18n/locales", locale, `${ns}.json`), "utf8")),
    ]),
  );
runtime.setCatalogSource({ english: readLocale("en"), load: async (locale) => readLocale(locale) });
await runtime.initI18n("en");
const t = (key) => i18next.t(key);

test("groups and tabs follow the spec order and labels", () => {
  assert.deepEqual(
    map.SETTINGS_GROUPS.map((group) => [
      t(group.labelKey),
      group.tabs.map((tab) => t(map.SETTINGS_TABS[tab].labelKey)),
    ]),
    [
      ["You", ["Profile & status", "Account & devices", "Privacy & encryption", "Connections"]],
      ["In session", ["Gaming & overlay", "Voice & video", "Notifications & sounds"]],
      ["App", ["Chat", "Appearance & accessibility", "Language & region", "App & about"]],
    ],
  );
  assert.equal(t(map.SETTINGS_TABS.setup.labelKey), "Your setup");
  for (const [id, tab] of Object.entries(map.SETTINGS_TABS)) {
    for (const key of [tab.labelKey, tab.descriptionKey, tab.keywordsKey]) {
      assert.ok(i18next.exists(key), `${id}: ${key} has English text`);
    }
  }
});

test("old tab ids land on their new home", () => {
  const legacy = {
    activity: "gaming",
    sounds: "notifications",
    system: "app",
    keybinds: "gaming",
    support: "app",
    language: "language",
  };
  for (const [from, to] of Object.entries(legacy)) assert.equal(map.normalizeSettingsTab(from), to, from);
  for (const id of Object.keys(map.SETTINGS_TABS)) assert.equal(map.normalizeSettingsTab(id), id);
  assert.equal(map.normalizeSettingsTab("nope"), "profile");
  assert.equal(map.normalizeSettingsTab(null), "profile");
  assert.equal(map.normalizeSettingsTab(undefined), "profile");
});

test("search jumps to the setting itself", () => {
  const results = map.searchSettings("push to talk", t);
  assert.deepEqual(results[0], { tab: "gaming", anchor: "push-to-talk" });
  assert.deepEqual(map.searchSettings("phone", t), []);
  assert.deepEqual(map.searchSettings("obs streamlabs", t), []);
  assert.deepEqual(map.searchSettings("   ", t), []);
  assert.ok(map.searchSettings("two-factor", t).some((result) => result.tab === "account"));
  assert.ok(map.searchSettings("steam", t).some((result) => result.tab === "connections"));
});

test("every anchor belongs to a known tab and has a label", () => {
  for (const anchor of map.SETTINGS_ANCHORS) {
    assert.ok(map.SETTINGS_TABS[anchor.tab], anchor.id);
    assert.ok(i18next.exists(anchor.labelKey), anchor.labelKey);
  }
});
