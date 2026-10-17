import test from "node:test";
import assert from "node:assert/strict";

const { EMPTY_FORUM_DRAFT, buildForumPayload, forumDraftError, toggleDraftTag } =
  await import("../../mobile/src/lib/forum-compose.ts");
const { canMarkSolved, canPinOrLock, isForumStaff, postRestriction } =
  await import("../../mobile/src/lib/forum-viewer.ts");
const { forumPostExtrasProblem } = await import("../../shared/forum.ts");

const NOW = 1_800_000_000_000;
const draft = (patch) => ({ ...EMPTY_FORUM_DRAFT, ...patch });

test("drafts need what web needs", () => {
  assert.equal(forumDraftError(draft({ title: " " })), "title");
  assert.equal(forumDraftError(draft({ title: "T" })), "body");
  assert.equal(forumDraftError(draft({ title: "T", type: "poll", pollOptions: ["a", ""] })), "pollOptions");
  assert.equal(forumDraftError(draft({ title: "T", type: "poll", pollOptions: ["a", "A"] })), "pollDuplicate");
  assert.equal(forumDraftError(draft({ title: "T", type: "lfg" })), "lfgGame");
  assert.equal(forumDraftError(draft({ title: "T", type: "media" })), "media");
  assert.equal(forumDraftError(draft({ title: "T", type: "media", mediaUrl: "http://x" })), "mediaHttps");
  assert.equal(forumDraftError(draft({ title: "T", type: "media", mediaUrl: "/uploads/a.png" })), null);
  assert.equal(forumDraftError(draft({ title: "T", body: "B" })), null);
});

test("every post type builds a payload the server accepts", () => {
  const cases = [
    draft({ title: "Hi", body: "Body", tags: ["a"] }),
    draft({ type: "question", title: "Q?", body: "help" }),
    draft({ type: "poll", title: "P", pollOptions: ["x", "y", " "], pollMulti: true, pollDurationMs: 3_600_000 }),
    draft({ type: "lfg", title: "L", lfgGame: "Valorant", lfgPlatform: "PC", lfgSlots: 99, lfgStartMs: 3_600_000 }),
    draft({ type: "media", title: "M", mediaUrl: "/uploads/clip.mp4", mediaMime: "video/mp4" }),
    draft({ type: "media", title: "M", mediaUrl: "https://example.com/clip" }),
  ];
  for (const item of cases) {
    const payload = buildForumPayload(item, NOW, { canLockReplies: false });
    assert.equal(forumPostExtrasProblem(payload, NOW), null, JSON.stringify(payload));
  }
  const poll = buildForumPayload(cases[2], NOW, { canLockReplies: false }).poll;
  assert.deepEqual(poll, { options: ["x", "y"], multi: true, endsAt: NOW + 3_600_000 });
  const lfg = buildForumPayload(cases[3], NOW, { canLockReplies: false }).lfg;
  assert.equal(lfg.slots, 64, "slots are clamped to the server's max");
  assert.equal(lfg.startAt, NOW + 3_600_000);
});

test("only staff can create a post with replies locked", () => {
  const locked = draft({ title: "News", body: "x", repliesLocked: true });
  assert.equal(buildForumPayload(locked, NOW, { canLockReplies: false }).repliesLocked, undefined);
  assert.equal(buildForumPayload(locked, NOW, { canLockReplies: true }).repliesLocked, true);
});

test("tags toggle case-insensitively and stop at five", () => {
  assert.deepEqual(toggleDraftTag(["Help"], "help"), []);
  assert.deepEqual(toggleDraftTag(["a", "b", "c", "d", "e"], "f"), ["a", "b", "c", "d", "e"]);
  assert.deepEqual(toggleDraftTag([], "  news "), ["news"]);
});

const viewer = (patch) => ({ userId: "me", hubRole: "member", customRoles: [], canPostInHub: true, ...patch });

test("forum staff, pin/lock and solve match web", () => {
  assert.equal(isForumStaff(viewer({ hubRole: "admin" })), true);
  assert.equal(isForumStaff(viewer({ customRoles: [{ id: "r", name: "Moderator", permissions: [] }] })), true);
  assert.equal(
    isForumStaff(viewer({ customRoles: [{ id: "r", name: "VIP", permissions: ["moderateMessages"] }] })),
    true,
  );
  assert.equal(isForumStaff(viewer()), false);
  assert.equal(canPinOrLock(viewer({ customRoles: [{ id: "r", name: "Moderator", permissions: [] }] })), false);
  assert.equal(canPinOrLock(viewer({ customRoles: [{ id: "r", name: "x", permissions: ["manageRooms"] }] })), true);
  assert.equal(canMarkSolved(viewer(), "me"), true);
  assert.equal(canMarkSolved(viewer(), "someone"), false);
});

test("post restrictions follow the room policy", () => {
  assert.equal(postRestriction({}, viewer(), {}), null);
  assert.deepEqual(postRestriction({}, viewer({ canPostInHub: false }), {}), { key: "ownerOnly" });
  assert.deepEqual(postRestriction({ forumPostPolicy: "staff" }, viewer(), {}), { key: "staff" });
  assert.equal(postRestriction({ forumPostPolicy: "staff" }, viewer({ hubRole: "owner" }), {}), null);
  assert.deepEqual(
    postRestriction({ forumPostPolicy: "roles", forumPostRoleIds: ["r1"] }, viewer(), { r1: "Writers" }),
    {
      key: "namedRoles",
      roles: "Writers",
      count: 1,
    },
  );
  assert.equal(
    postRestriction(
      { forumPostPolicy: "roles", forumPostRoleIds: ["r1"] },
      viewer({ customRoles: [{ id: "r1", name: "W", permissions: [] }] }),
      {},
    ),
    null,
  );
  assert.deepEqual(postRestriction({ forumPostPolicy: "members", forumPostMemberIds: [] }, viewer(), {}), {
    key: "members",
  });
});
