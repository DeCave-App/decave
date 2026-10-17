import test from "node:test";
import assert from "node:assert/strict";

const { isHubMuted, liveMutedHubs, mutedRoomIds, withHubMuted, withRoomLevel } =
  await import("../../mobile/src/lib/hub-mutes.ts");

const NOW = 1_800_000_000_000;

test("hub mutes use web's synced format and drop expired ones", () => {
  const settings = { mutedHubs: { 1: -1, 2: NOW + 60_000, 3: NOW - 1 } };
  assert.deepEqual(liveMutedHubs(settings, NOW), { 1: -1, 2: NOW + 60_000 });
  assert.equal(isHubMuted(settings, 3, NOW), false);
  assert.deepEqual(withHubMuted(settings, 4, true, NOW), { mutedHubs: { 1: -1, 2: NOW + 60_000, 4: -1 } });
  assert.deepEqual(withHubMuted(settings, 1, false, NOW), { mutedHubs: { 2: NOW + 60_000 } });
});

test("a room is muted at level nothing, and unmuting returns it to the Hub level", () => {
  const settings = { notifyLevels: { hubs: { 9: "all" }, rooms: { 10: "nothing", 11: "all" } } };
  assert.deepEqual(mutedRoomIds(settings), [10]);
  assert.deepEqual(withRoomLevel(settings, 10, null), { notifyLevels: { hubs: { 9: "all" }, rooms: { 11: "all" } } });
  assert.deepEqual(withRoomLevel({}, 12, "nothing"), { notifyLevels: { hubs: {}, rooms: { 12: "nothing" } } });
});
