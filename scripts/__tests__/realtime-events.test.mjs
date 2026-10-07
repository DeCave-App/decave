import assert from "node:assert/strict";
import test from "node:test";
import { handleChatEvent } from "../../src/realtime/events/chat.ts";
import { handleHubEvent } from "../../src/realtime/events/hubs.ts";
import { handleSessionEvent } from "../../src/realtime/events/session.ts";
import { handleSocialEvent } from "../../src/realtime/events/social.ts";

// The voice handlers read the app's server address, which reads window.location.
globalThis.window ??= {
  location: { protocol: "http:", origin: "http://127.0.0.1:8787", host: "127.0.0.1:8787", pathname: "/" },
};
const { handleVoiceEvent } = await import("../../src/realtime/events/voice.ts");

const ref = (current) => ({ current });

// A React-style state setter over a plain value.
function state(initial) {
  const box = { value: initial };
  box.set = (next) => {
    box.value = typeof next === "function" ? next(box.value) : next;
  };
  return box;
}

test("each domain ignores frames it does not own", () => {
  for (const handle of [handleChatEvent, handleHubEvent, handleSessionEvent, handleSocialEvent, handleVoiceEvent]) {
    assert.equal(handle({ type: "SOMETHING_ELSE" }, {}), false);
  }
});

test("TYPING tracks other people in the open room only", () => {
  const typing = state({});
  const context = { currentUser: { id: "me" }, activeChannelRef: ref(16), setTypingUsers: typing.set };
  assert.equal(
    handleChatEvent({ type: "TYPING", channelId: 16, userId: "u2", username: "kim", active: true }, context),
    true,
  );
  assert.deepEqual(Object.keys(typing.value), ["u2:kim"]);
  assert.ok(typing.value["u2:kim"] > Date.now());
  handleChatEvent({ type: "TYPING", channelId: 16, userId: "me", username: "me", active: true }, context);
  handleChatEvent({ type: "TYPING", channelId: 99, userId: "u3", username: "lee", active: true }, context);
  assert.deepEqual(Object.keys(typing.value), ["u2:kim"], "own typing and other rooms are ignored");
  handleChatEvent({ type: "TYPING", channelId: 16, userId: "u2", username: "kim", active: false }, context);
  assert.deepEqual(typing.value, {});
});

test("MESSAGE_UPDATED replaces the message; MESSAGE_DELETED removes it from the open room", () => {
  const messages = state([
    { id: "a", text: "one" },
    { id: "b", text: "two" },
  ]);
  const removedFromCalendar = [];
  const context = {
    activeChannelRef: ref(16),
    setMessages: messages.set,
    removeHomeCalendarMessage: (id) => removedFromCalendar.push(id),
  };
  assert.equal(handleChatEvent({ type: "MESSAGE_UPDATED", message: { id: "a", text: "edited" } }, context), true);
  assert.deepEqual(
    messages.value.map((m) => m.text),
    ["edited", "two"],
  );
  handleChatEvent({ type: "MESSAGE_DELETED", channelId: 99, messageId: "b" }, context);
  assert.equal(messages.value.length, 2, "a deletion in another room leaves this list alone");
  handleChatEvent({ type: "MESSAGE_DELETED", channelId: 16, messageId: "b" }, context);
  assert.deepEqual(
    messages.value.map((m) => m.id),
    ["a"],
  );
  assert.deepEqual(removedFromCalendar, ["b", "b"], "calendar copies are removed wherever the room is");
});

test("DM_EDITED and DM_DELETED update the open conversation and refresh the list", () => {
  const dms = state([
    { id: "m1", text: "hi" },
    { id: "m2", text: "there" },
  ]);
  let reloads = 0;
  const context = {
    setDmMessages: dms.set,
    loadDmConversations: async () => {
      reloads += 1;
    },
  };
  assert.equal(handleSocialEvent({ type: "DM_EDITED", message: { id: "m1", text: "hello" } }, context), true);
  assert.deepEqual(
    dms.value.map((m) => m.text),
    ["hello", "there"],
  );
  assert.equal(handleSocialEvent({ type: "DM_DELETED", messageId: "m2" }, context), true);
  assert.deepEqual(
    dms.value.map((m) => m.id),
    ["m1"],
  );
  assert.equal(reloads, 2);
});

test("VOICE_KICKED leaves voice and explains why", () => {
  const calls = [];
  const context = {
    cleanupVoiceLocal: (presence) => calls.push(["cleanup", presence]),
    setVoiceError: (m) => calls.push(["error", m]),
  };
  assert.equal(handleVoiceEvent({ type: "VOICE_KICKED" }, context), true);
  assert.deepEqual(calls, [
    ["cleanup", false],
    ["error", "You were disconnected by a moderator."],
  ]);
  calls.length = 0;
  handleVoiceEvent({ type: "VOICE_KICKED", message: "Removed by staff" }, context);
  assert.deepEqual(calls[1], ["error", "Removed by staff"]);
});

test("SESSION_REVOKED stops reconnecting, forgets voice and logs out with a reason", async () => {
  const authErrors = [];
  const context = {
    realtimeReconnectEnabledRef: ref(true),
    voiceReconnectChannelRef: ref(7),
    logout: async () => {},
    setAuthError: (m) => authErrors.push(m),
  };
  assert.equal(handleSessionEvent({ type: "SESSION_REVOKED", reason: "same_client_replaced" }, context), true);
  assert.equal(context.realtimeReconnectEnabledRef.current, false);
  assert.equal(context.voiceReconnectChannelRef.current, null);
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(authErrors, ["Your session was ended."]);
});

test("ERROR marks the newest sending message failed and rejects a pending forum post", () => {
  const outbox = state([{ id: "o1", status: "sending" }]);
  const settled = [];
  const originalError = console.error;
  console.error = () => {};
  try {
    const context = {
      outboxRef: ref(outbox.value),
      setOutbox: outbox.set,
      pendingForumPublishRef: ref({ settle: (error) => settled.push(error.message) }),
    };
    handleSessionEvent({ type: "ERROR", message: "Slow mode is on." }, context);
  } finally {
    console.error = originalError;
  }
  assert.notEqual(outbox.value[0].status, "sending");
  assert.deepEqual(settled, ["Slow mode is on."]);
});

test("USERS_UPDATE keeps friends' presence in step with who is connected", async () => {
  const { applyFriendPresence } = await import("../../src/realtime/presence.ts");
  const friends = [
    { id: "DC-A", username: "ana", online: false, status: "invisible", statusText: "", activityText: "" },
    { id: "DC-B", username: "bo", online: true, status: "online", statusText: "here", activityText: "Playing X" },
    { id: "DC-C", username: "cy", online: true, status: "dnd", statusText: "", activityText: "" },
  ];
  const users = [
    {
      id: "c1",
      userId: "DC-A",
      username: "ana",
      serverId: 0,
      channelId: 0,
      status: "idle",
      statusText: "brb",
      activityText: "",
    },
    {
      id: "c2",
      userId: "DC-C",
      username: "cy",
      serverId: 0,
      channelId: 0,
      status: "invisible",
      statusText: "",
      activityText: "",
    },
  ];
  const next = applyFriendPresence(friends, users);
  assert.deepEqual(
    next.map((f) => [f.id, f.online, f.status, f.statusText, f.activityText]),
    [
      ["DC-A", true, "idle", "brb", ""],
      ["DC-B", false, "invisible", "", ""],
      ["DC-C", false, "invisible", "", ""],
    ],
    "signed-in friends turn online, signed-out and invisible friends turn offline without details",
  );
  assert.equal(applyFriendPresence(next, users), next, "no change keeps the same list");

  const friendsState = state(friends);
  const online = state([]);
  const context = { setOnlineUsers: online.set, setFriends: friendsState.set, activeServerRef: ref(0) };
  assert.equal(handleHubEvent({ type: "USERS_UPDATE", users }, context), true);
  assert.equal(online.value, users);
  assert.deepEqual(
    friendsState.value.map((f) => f.online),
    [true, false, false],
  );
});
