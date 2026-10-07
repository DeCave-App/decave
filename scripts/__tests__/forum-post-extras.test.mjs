import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { readWorkerSource } from "./worker-source.mjs";
import {
  FORUM_POST_PREFIX,
  parseForumPostPayload,
  rawForumPostJson,
  validateForumPostExtras,
} from "../../shared/forum.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const NOW = 1_800_000_000_000;
const post = (extra) => ({ version: 1, title: "T", tags: [], body: "b", ...extra });

test("legacy forum payloads stay valid and parse without extensions", () => {
  assert.equal(validateForumPostExtras(post({}), NOW), null);
  const parsed = parseForumPostPayload(`${FORUM_POST_PREFIX}${JSON.stringify(post({ iconUrl: "/uploads/x.png" }))}`);
  assert.deepEqual(parsed, { version: 1, title: "T", tags: [], body: "b", iconUrl: "/uploads/x.png" });
});

test("typed posts round-trip through the V1 prefix and unknown fields are ignored", () => {
  const payload = post({
    type: "poll",
    poll: { options: ["A", "B"], multi: true, endsAt: NOW + 1000 },
    futureField: 1,
  });
  const text = `${FORUM_POST_PREFIX}${JSON.stringify(payload)}`;
  assert.equal(validateForumPostExtras(rawForumPostJson(text), NOW), null);
  const parsed = parseForumPostPayload(text);
  assert.equal(parsed.type, "poll");
  assert.deepEqual(parsed.poll, { options: ["A", "B"], multi: true, endsAt: NOW + 1000 });
  assert.equal("futureField" in parsed, false);
  // An unknown type from a newer client degrades to a plain post.
  assert.equal(parseForumPostPayload(`${FORUM_POST_PREFIX}${JSON.stringify(post({ type: "raid" }))}`).type, undefined);
});

test("poll validation enforces 2-6 unique options and a future end within 30 days", () => {
  assert.match(validateForumPostExtras(post({ type: "poll" }), NOW), /need poll options/);
  assert.match(validateForumPostExtras(post({ type: "poll", poll: { options: ["A"] } }), NOW), /2-6/);
  assert.match(
    validateForumPostExtras(post({ type: "poll", poll: { options: ["A", "B", "C", "D", "E", "F", "G"] } }), NOW),
    /2-6/,
  );
  assert.match(validateForumPostExtras(post({ type: "poll", poll: { options: ["A", " a "] } }), NOW), /different/);
  assert.match(validateForumPostExtras(post({ type: "poll", poll: { options: ["A", ""] } }), NOW), /empty/);
  assert.match(
    validateForumPostExtras(post({ type: "poll", poll: { options: ["A", "B"], endsAt: NOW - 1 } }), NOW),
    /future/,
  );
  assert.match(
    validateForumPostExtras(post({ type: "poll", poll: { options: ["A", "B"], endsAt: NOW + 31 * 86_400_000 } }), NOW),
    /30 days/,
  );
  // Edits keep a poll whose end time has passed.
  assert.equal(
    validateForumPostExtras(post({ type: "poll", poll: { options: ["A", "B"], endsAt: NOW - 1 } }), NOW, {
      isEdit: true,
    }),
    null,
  );
  assert.match(validateForumPostExtras(post({ type: "guide", poll: { options: ["A", "B"] } }), NOW), /Only poll posts/);
});

test("LFG, media and type validation", () => {
  assert.equal(
    validateForumPostExtras(
      post({ type: "lfg", lfg: { game: "Valorant", platform: "PC", slots: 3, startAt: NOW } }),
      NOW,
    ),
    null,
  );
  assert.match(validateForumPostExtras(post({ type: "lfg", lfg: { game: " ", slots: 2 } }), NOW), /need a game/);
  assert.match(validateForumPostExtras(post({ type: "lfg", lfg: { game: "X", slots: 0 } }), NOW), /Slots/);
  assert.match(validateForumPostExtras(post({ type: "lfg", lfg: { game: "X", slots: 1.5 } }), NOW), /Slots/);
  assert.match(validateForumPostExtras(post({ type: "lfg" }), NOW), /group details/);
  assert.equal(
    validateForumPostExtras(post({ type: "media", media: { url: "https://example.com/video" } }), NOW),
    null,
  );
  assert.equal(
    validateForumPostExtras(post({ type: "media", media: { url: "/uploads/a.mp4", mime: "video/mp4" } }), NOW),
    null,
  );
  assert.match(validateForumPostExtras(post({ type: "media", media: { url: "javascript:alert(1)" } }), NOW), /https/);
  assert.match(
    validateForumPostExtras(post({ type: "media", media: { url: "/uploads/a", mime: "<b>" } }), NOW),
    /media type/,
  );
  assert.match(validateForumPostExtras(post({ type: "wiki" }), NOW), /Unknown post type/);
  assert.match(validateForumPostExtras(post({ repliesLocked: "yes" }), NOW), /boolean/);
});

test("server wires extension validation into post create/edit and staff-only lock-on-create", () => {
  const hubRoom = read("worker/HubRoom.ts");
  const worker = readWorkerSource();
  assert.match(hubRoom, /validateForumPostExtras\(rawForumPostJson\(text\)\)/);
  assert.match(hubRoom, /payload\.repliesLocked && !\(await isForumStaff\(/);
  assert.match(hubRoom, /UPDATE decave_forum_post_state SET locked=1 WHERE message_id=\?/);
  assert.match(
    worker,
    /validateForumPostExtras\(rawForumPostJson\(text\),\s*Date\.now\(\),\s*\{\s*isEdit:\s*true\s*\}\)/,
  );
});
