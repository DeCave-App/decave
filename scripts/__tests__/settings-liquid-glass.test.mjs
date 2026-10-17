// Liquid Glass (Settings > Appearance > Glass effect): the stored setting, when
// it is actually drawn, and that it follows the account to other devices.
import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";

const { normalizeExtraSettings, activeGlass, isLowPowerDevice, DEFAULT_EXTRA_SETTINGS } =
  await import("../../src/features/settings/extraSettings.ts");
const { buildSyncedSettings } = await import("../../src/features/settings/settingsSync.ts");

const SKINS = ["nebula", "bright"];
const capable = { lowPowerDevice: false };

test("glass is off by default and keeps only known values", () => {
  const fresh = normalizeExtraSettings({}, SKINS);
  assert.equal(fresh.glassEffect, false);
  assert.equal(fresh.glassStyle, "clear");
  assert.equal(fresh.glassBackdrop, "hub");
  assert.equal(fresh.glassAutoOff, true);
  const odd = normalizeExtraSettings(
    { glassEffect: "yes", glassStyle: "neon", glassBackdrop: "space", glassAutoOff: 0 },
    SKINS,
  );
  assert.equal(odd.glassEffect, false);
  assert.equal(odd.glassStyle, "clear");
  assert.equal(odd.glassBackdrop, "hub");
  assert.equal(odd.glassAutoOff, true);
  const set = normalizeExtraSettings(
    { glassEffect: true, glassStyle: "tinted", glassBackdrop: "graphite", glassAutoOff: false },
    SKINS,
  );
  assert.deepEqual(
    [set.glassEffect, set.glassStyle, set.glassBackdrop, set.glassAutoOff],
    [true, "tinted", "graphite", false],
  );
});

test("glass is drawn only when it is on and nothing asks for solid panels", () => {
  const on = { ...DEFAULT_EXTRA_SETTINGS, glassEffect: true, glassStyle: "tinted" };
  assert.equal(activeGlass(DEFAULT_EXTRA_SETTINGS, capable), null);
  assert.equal(activeGlass(on, capable), "tinted");
  // High contrast keeps glass (drawn darker in CSS); it is the person's own choice.
  assert.equal(activeGlass({ ...on, highContrast: true }, capable), "tinted");
  assert.equal(activeGlass(on, { lowPowerDevice: true }), null);
  const always = { ...on, glassAutoOff: false };
  assert.equal(activeGlass(always, { lowPowerDevice: true }), "tinted");
  assert.equal(activeGlass({ ...always, highContrast: true }, capable), "tinted");
});

test("only clearly weak hardware counts as a low-power device", () => {
  assert.equal(isLowPowerDevice({}), false);
  assert.equal(isLowPowerDevice({ hardwareConcurrency: 8, deviceMemory: 8 }), false);
  assert.equal(isLowPowerDevice({ hardwareConcurrency: 4, deviceMemory: 4 }), false);
  // Safari on iPhone reports 2 cores whatever the hardware, so 2 is not "weak".
  assert.equal(isLowPowerDevice({ hardwareConcurrency: 2 }), false);
  assert.equal(isLowPowerDevice({ hardwareConcurrency: 1 }), true);
  assert.equal(isLowPowerDevice({ deviceMemory: 1 }), true);
});

test("the glass choices sync with the rest of Appearance", () => {
  const extra = { ...DEFAULT_EXTRA_SETTINGS, glassEffect: true, glassStyle: "tinted", glassBackdrop: "aurora" };
  const synced = buildSyncedSettings({
    appSkin: "nebula",
    textScale: 100,
    extra,
    notifications: {},
    notificationPreset: "default",
    sounds: {},
    privacy: { notificationPreview: "full", sendTypingIndicators: true },
    notifyLevels: {},
    mutedHubs: {},
    timeZone: "UTC",
  });
  assert.deepEqual(
    [synced.extra.glassEffect, synced.extra.glassStyle, synced.extra.glassBackdrop, synced.extra.glassAutoOff],
    [true, "tinted", "aurora", true],
  );
});

test("every glass rule is scoped to [data-glass], so skins are untouched when it is off", () => {
  const css = fs.readFileSync(new URL("../../src/styles/shell/liquid-glass.css", import.meta.url), "utf8");
  const selectors = css
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("}")
    .map((block) => block.split("{").slice(-2)[0].trim())
    .filter(Boolean);
  assert.ok(selectors.length > 5);
  // :root only defines the wallpaper pictures, which do nothing until glass is on.
  for (const selector of selectors.filter((s) => s !== ":root")) assert.match(selector, /\[data-glass/, selector);
});
