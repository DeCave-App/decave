import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { readAppSource } from "./app-source.mjs";
import { readWorkerSource } from "./worker-source.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("forum channels use an extensible room kind without changing the channel transport", () => {
  const migration = read("migrations/0022_structured_channel_kinds.sql");
  const worker = readWorkerSource();
  assert.match(migration, /ADD COLUMN kind TEXT NOT NULL DEFAULT 'chat'/);
  assert.match(migration, /CHECK\(kind IN \('chat', 'forum'\)\)/);
  assert.match(worker, /requestedType === "forum" \? "text"/);
  assert.match(worker, /kind = requestedType === "forum" \? "forum" : "chat"/);
  assert.match(worker, /type: room\.kind === "forum" \? "forum" : room\.type/);
});

test("forum posts travel as ordinary channel messages", () => {
  const app = readAppSource();
  const worker = readWorkerSource();
  // The wire prefix is defined once in shared/forum.ts and used by the forum feature.
  assert.match(read("shared/forum.ts"), /FORUM_POST_PREFIX = "__DECAVE_FORUM_POST_V1__"/);
  assert.match(
    app,
    /publishForumText[\s\S]*sendSocket\(\{\s*type: "CHAT_MESSAGE",\s*text,\s*channelId: selectedChannel/,
  );
  // Posts are still created over CHAT_MESSAGE; the Worker only indexes them
  // (decave_forum_post_state) and never exposes a bespoke post-creation API.
  assert.doesNotMatch(worker, /forumPostTitle|forumPostBody/);
});
