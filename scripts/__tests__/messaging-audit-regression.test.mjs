import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { mergeConversationHistory, restoreDraftIfUnchanged } from "../../src/app/actions/social-message-recovery.ts";

const root = path.resolve(import.meta.dirname, "..", "..");

test("history refresh keeps realtime messages and deduplicates by message id within one conversation", () => {
  const history = [
    { id: "old", groupId: "g1", text: "old", timestamp: "2026-10-01T10:00:00Z" },
    { id: "shared", groupId: "g1", text: "stale history", timestamp: "2026-10-01T10:01:00Z" },
  ];
  const current = [
    { id: "live", groupId: "g1", text: "arrived during fetch", timestamp: "2026-10-01T10:02:00Z" },
    { id: "shared", groupId: "g1", text: "realtime version", timestamp: "2026-10-01T10:01:00Z" },
    { id: "other-room", groupId: "g2", text: "must not leak", timestamp: "2026-10-01T10:03:00Z" },
  ];

  assert.deepEqual(
    mergeConversationHistory(history, current, (message) => message.groupId === "g1").map(({ id, text }) => [id, text]),
    [
      ["old", "old"],
      ["shared", "realtime version"],
      ["live", "arrived during fetch"],
    ],
  );
});

test("failed send restores its draft only while the destination has not changed", () => {
  assert.deepEqual(restoreDraftIfUnchanged(undefined, 2, 2, "unsent text"), {
    restored: true,
    value: "unsent text",
  });
  assert.deepEqual(restoreDraftIfUnchanged("new draft", 2, 2, "unsent text"), {
    restored: false,
    value: "new draft",
  });
  assert.deepEqual(restoreDraftIfUnchanged("", 3, 2, "unsent text"), {
    restored: false,
    value: "",
  });
});

test("DM and group send acknowledgements carry bounded client ids through server success and failure frames", async () => {
  const actions = await fs.readFile(path.join(root, "src/app/actions/direct-messages.ts"), "utf8");
  const sending = await fs.readFile(path.join(root, "shared/dm-e2ee-sending.ts"), "utf8");
  const worker = await fs.readFile(path.join(root, "worker/HubRoom.ts"), "utf8");
  const realtime = await fs.readFile(path.join(root, "src/realtime/events/social.ts"), "utf8");

  assert.match(actions, /frame = await dmSocketFrame\(/);
  assert.match(actions, /frame = await groupSocketFrame\(/);
  assert.match(sending, /type: "DM_MESSAGE",\s+clientMessageId/);
  assert.match(sending, /type: "GROUP_MESSAGE",\s+clientMessageId/);
  assert.match(worker, /const MAX_CLIENT_MESSAGE_ID_LENGTH = 128/);
  assert.match(
    worker,
    /function boundedClientMessageId\(value: unknown\): string \| null \{[\s\S]*?value\.length <= MAX_CLIENT_MESSAGE_ID_LENGTH/,
  );
  assert.match(worker, /type: "DM_ERROR",\s+targetUserId: targetReference,[\s\S]*?clientMessageId/);
  assert.match(worker, /type: "GROUP_ERROR",\s+groupId,[\s\S]*?clientMessageId/);
  assert.match(worker, /await this\.broadcastWithClientMessageId\([\s\S]*?type: "DM_MESSAGE"[\s\S]*?clientMessageId/);
  assert.match(
    worker,
    /await this\.broadcastWithClientMessageId\([\s\S]*?type: "GROUP_MESSAGE"[\s\S]*?clientMessageId/,
  );
  assert.match(
    worker,
    /clientMessageId && socketState\.userId === senderUserId \? \{ \.\.\.payload, clientMessageId \} : payload/,
  );
  assert.match(realtime, /conversationId !== pending\.conversationId/);
  assert.match(realtime, /pending\.draftRevision/);
});
