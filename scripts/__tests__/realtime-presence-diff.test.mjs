import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";

register("../test-support/mobile-extensionless-loader.mjs", import.meta.url);

const { applyUsersDiff, applyPresenceHints, parseUsersDiff, liveHubOnlineCount } =
  await import("../../src/realtime/presence.ts");
const { handleHubEvent } = await import("../../src/realtime/events/hubs.ts");

function state(initial) {
  const box = { value: initial };
  box.set = (next) => {
    box.value = typeof next === "function" ? next(box.value) : next;
  };
  return box;
}

test("applyUsersDiff upserts by connection id and removes closed connections", () => {
  const a = { id: "c1", userId: "DC-A", username: "a", serverId: 1, channelId: 2 };
  const b = { id: "c2", userId: "DC-B", username: "b", serverId: 1, channelId: 2 };
  const moved = { ...a, channelId: 3 };
  assert.deepEqual(applyUsersDiff([a, b], { upsert: [moved], remove: [], presence: [] }), [b, moved]);
  assert.deepEqual(applyUsersDiff([a, b], { upsert: [], remove: ["c1"], presence: [] }), [b]);
  const same = [a];
  assert.equal(applyUsersDiff(same, { upsert: [], remove: [], presence: [] }), same, "no-op keeps identity");
});

test("applyPresenceHints patches only listed accounts and keeps identity when nothing changed", () => {
  const members = [
    { userId: "DC-A", online: false, status: "invisible" },
    { userId: "DC-B", online: true, status: "online" },
  ];
  const hint = { userId: "DC-A", online: true, status: "dnd", statusText: "busy", activityText: "" };
  const next = applyPresenceHints(members, [hint], (m) => m.userId);
  assert.equal(next[0].online, true);
  assert.equal(next[0].status, "dnd");
  assert.equal(next[1], members[1]);
  assert.equal(
    applyPresenceHints(next, [hint], (m) => m.userId),
    next,
  );
});

test("parseUsersDiff tolerates malformed frames", () => {
  assert.deepEqual(parseUsersDiff({ upsert: "x", remove: [1, "c"], presence: null }), {
    upsert: [],
    remove: ["c"],
    presence: [],
  });
});

test("USERS_DIFF updates roster, friends and Hub members without refetching", () => {
  const onlineUsers = state([]);
  const friends = state([{ id: "DC-A", username: "a", online: false, status: "invisible" }]);
  const hubMembers = state([{ userId: "DC-A", username: "a", role: "member", online: false }]);
  let refetches = 0;
  const handled = handleHubEvent(
    {
      type: "USERS_DIFF",
      upsert: [{ id: "c1", userId: "DC-A", username: "a", serverId: 1, channelId: 1, status: "online" }],
      remove: [],
      presence: [{ userId: "DC-A", online: true, status: "online", statusText: "", activityText: "" }],
    },
    {
      setOnlineUsers: onlineUsers.set,
      setFriends: friends.set,
      setHubMembers: hubMembers.set,
      loadHubMembers: async () => {
        refetches += 1;
      },
      loadServers: async () => {
        refetches += 1;
        return null;
      },
    },
  );
  assert.equal(handled, true);
  assert.equal(onlineUsers.value.length, 1);
  assert.equal(friends.value[0].online, true);
  assert.equal(hubMembers.value[0].online, true);
  assert.equal(refetches, 0);
});

test("liveHubOnlineCount counts distinct visible accounts viewing the Hub", () => {
  const users = [
    { id: "c1", userId: "DC-A", username: "a", serverId: 7, channelId: 1, status: "online" },
    { id: "c2", userId: "DC-A", username: "a", serverId: 7, channelId: 2, status: "online" },
    { id: "c3", userId: "DC-B", username: "b", serverId: 7, channelId: 1, status: "invisible" },
    { id: "c4", userId: "DC-C", username: "c", serverId: 8, channelId: 1, status: "online" },
  ];
  assert.equal(liveHubOnlineCount(users, 7), 1, "two devices count once; invisible accounts are not counted");
  assert.equal(liveHubOnlineCount(users, 0), 0);
});
