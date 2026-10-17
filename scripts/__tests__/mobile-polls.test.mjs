import test from "node:test";
import assert from "node:assert/strict";

const { POLL_PREFIX, isReactionChip, parsePoll, pollMessageText, pollVoteToggles, tallyPoll } =
  await import("../../mobile/src/lib/polls.ts");

test("poll text matches web's payload and limits", () => {
  assert.equal(POLL_PREFIX, "__DECAVE_POLL__");
  const text = pollMessageText("  Map?  ", [" Dust ", "", "Mirage", ...Array(10).fill("x")]);
  const poll = parsePoll(text);
  assert.equal(poll.question, "Map?");
  assert.deepEqual(poll.options.slice(0, 2), ["Dust", "Mirage"]);
  assert.equal(poll.options.length, 8);
  assert.equal(pollMessageText("Q", ["only one", " "]), null);
  assert.equal(pollMessageText("   ", ["a", "b"]), null);
  assert.equal(parsePoll(pollMessageText("x".repeat(500), ["a", "b"])).question.length, 180);
});

test("malformed polls are ignored", () => {
  assert.equal(parsePoll("hello"), null);
  assert.equal(parsePoll("__DECAVE_POLL__{bad"), null);
  assert.equal(parsePoll('__DECAVE_POLL__{"question":"q","options":["a"]}'), null);
});

test("tally counts poll_ reactions and finds my vote", () => {
  const poll = { question: "q", options: ["a", "b", "c"] };
  const tally = tallyPoll(poll, { poll_0: ["u1", "u2"], poll_2: ["me"], "🔥": ["me"] }, "me");
  assert.deepEqual(tally, { counts: [2, 0, 1], total: 3, mine: 2 });
  assert.equal(tallyPoll(poll, undefined, "me").mine, null);
});

test("moving a vote removes the old one first; re-picking does nothing", () => {
  assert.deepEqual(pollVoteToggles({ poll_0: ["me"] }, "me", 1), ["poll_0", "poll_1"]);
  assert.deepEqual(pollVoteToggles({ poll_1: ["me"] }, "me", 1), []);
  assert.deepEqual(pollVoteToggles({}, "me", 2), ["poll_2"]);
});

test("poll and forum votes are not emoji chips", () => {
  assert.equal(isReactionChip("poll_0"), false);
  assert.equal(isReactionChip("forum_vote_up"), false);
  assert.equal(isReactionChip("👍"), true);
});
