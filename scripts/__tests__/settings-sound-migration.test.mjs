import assert from "node:assert/strict";
import { test } from "node:test";

const { migrateSoundToggles, VOICE_SOUND_EVENTS, OTHER_SOUND_EVENTS } =
  await import("../../src/features/settings/soundMigration.ts");

const allOn = () => Object.fromEntries([...VOICE_SOUND_EVENTS, ...OTHER_SOUND_EVENTS].map((event) => [event, true]));
const notifications = (patch = {}) => ({
  desktop: true,
  sounds: true,
  friendRequests: true,
  dms: true,
  groups: true,
  mentions: true,
  voiceEvents: true,
  ...patch,
});

test("old 'Notification sounds' off turns every non-voice sound event off", () => {
  const result = migrateSoundToggles(notifications({ sounds: false }), { theme: "soft", ...allOn() });
  assert.equal(result.changed, true);
  for (const event of OTHER_SOUND_EVENTS) assert.equal(result.sounds[event], false, event);
  for (const event of VOICE_SOUND_EVENTS) assert.equal(result.sounds[event], true, event);
  assert.equal(result.notifications.sounds, true, "the old switch no longer silences anything");
  assert.equal(result.sounds.theme, "soft");
});

test("old 'Voice join / leave sounds' off turns voiceJoin and voiceLeave off", () => {
  const result = migrateSoundToggles(notifications({ voiceEvents: false }), { theme: "pulse", ...allOn() });
  assert.equal(result.sounds.voiceJoin, false);
  assert.equal(result.sounds.voiceLeave, false);
  assert.equal(result.sounds.receive, true);
  assert.equal(result.notifications.voiceEvents, true);
});

test("nothing changes when both old toggles were on, and running twice is harmless", () => {
  const sounds = { theme: "soft", ...allOn(), mute: false };
  const untouched = migrateSoundToggles(notifications(), sounds);
  assert.equal(untouched.changed, false);
  assert.deepEqual(untouched.sounds, sounds);
  const once = migrateSoundToggles(notifications({ sounds: false, voiceEvents: false }), { theme: "soft", ...allOn() });
  const twice = migrateSoundToggles(once.notifications, once.sounds);
  assert.equal(twice.changed, false);
  assert.deepEqual(twice.sounds, once.sounds);
});
