// Mobile reads typing indicators, time format and large emoji from the synced
// account preferences, with desktop's defaults until they load.
import assert from "node:assert/strict";
import { test } from "node:test";

const store = await import("../../mobile/src/lib/account-preferences-store.ts");

const prefs = (overrides) => ({
  loginAlerts: true,
  activityVisibility: "everyone",
  friendRequestPolicy: "everyone",
  streamerMode: false,
  allowStreamPreviews: true,
  timeFormat: "system",
  clientSettings: null,
  clientSettingsUpdatedAt: null,
  ...overrides,
});

test("defaults before preferences load match desktop", () => {
  store.setAccountPreferencesSnapshot(null);
  assert.equal(store.sendsTypingIndicators(), true);
  assert.equal(store.showsLargeEmoji(), true);
  assert.equal(store.hour12Preference(), undefined);
});

test("synced settings switch typing indicators and large emoji off", () => {
  store.setAccountPreferencesSnapshot(
    prefs({ clientSettings: { privacy: { sendTypingIndicators: false }, chat: { largeEmoji: false } } }),
  );
  assert.equal(store.sendsTypingIndicators(), false);
  assert.equal(store.showsLargeEmoji(), false);
  store.setAccountPreferencesSnapshot(null);
  assert.equal(store.sendsTypingIndicators(), true, "signing out forgets the previous account's choice");
});

test("time format forces 12 or 24 hours, system follows the language", () => {
  assert.equal(store.hour12Preference(prefs({ timeFormat: "12h" })), true);
  assert.equal(store.hour12Preference(prefs({ timeFormat: "24h" })), false);
  assert.equal(store.hour12Preference(prefs({ timeFormat: "system" })), undefined);
});
