import assert from "node:assert/strict";
import test from "node:test";
import { FORUM_POST_PREFIX } from "../../shared/forum.ts";
import { CHAT_POLL_PREFIX, decidePollVote, pollRulesFromMessageText } from "../../worker/pollVotes.ts";
import { readWorkerSource } from "./worker-source.mjs";

const NOW = 1_800_000_000_000;
const forumPoll = (poll) =>
  `${FORUM_POST_PREFIX}${JSON.stringify({ version: 1, title: "T", tags: [], body: "b", type: "poll", poll })}`;
const chatPoll = `${CHAT_POLL_PREFIX}${JSON.stringify({ question: "Q", options: ["A", "B", "C"] })}`;

test("non-poll reactions are untouched", () => {
  assert.equal(decidePollVote("hello", "👍", false, NOW).kind, "not_poll_vote");
  assert.equal(
    decidePollVote(forumPoll({ options: ["A", "B"], endsAt: NOW - 1 }), "forum_vote_up", false, NOW).kind,
    "not_poll_vote",
  );
});

test("votes on ended forum polls are rejected (add and remove)", () => {
  const text = forumPoll({ options: ["A", "B"], multi: false, endsAt: NOW - 1 });
  assert.equal(decidePollVote(text, "poll_0", false, NOW).code, "POLL_ENDED");
  assert.equal(decidePollVote(text, "poll_0", true, NOW).code, "POLL_ENDED");
  assert.equal(decidePollVote(text, "poll_0", false, NOW - 10).kind, "allow");
});

test("out-of-range and malformed options are rejected", () => {
  const text = forumPoll({ options: ["A", "B"], multi: true, endsAt: null });
  for (const emoji of ["poll_2", "poll_-1", "poll_01", "poll_x", "poll_"]) {
    assert.equal(decidePollVote(text, emoji, false, NOW).code, "POLL_OPTION_INVALID", emoji);
  }
  assert.equal(decidePollVote(chatPoll, "poll_3", false, NOW).code, "POLL_OPTION_INVALID");
  assert.equal(decidePollVote("plain text", "poll_0", false, NOW).code, "POLL_INVALID");
  assert.equal(decidePollVote("plain text", "poll_0", true, NOW).kind, "allow");
});

test("single-choice polls clear other votes; multi-choice do not", () => {
  assert.deepEqual(decidePollVote(forumPoll({ options: ["A", "B"], multi: false }), "poll_1", false, NOW), {
    kind: "allow",
    clearOtherPollVotes: true,
  });
  assert.deepEqual(decidePollVote(forumPoll({ options: ["A", "B"], multi: true }), "poll_1", false, NOW), {
    kind: "allow",
    clearOtherPollVotes: false,
  });
  assert.deepEqual(decidePollVote(chatPoll, "poll_2", false, NOW), { kind: "allow", clearOtherPollVotes: true });
  assert.deepEqual(pollRulesFromMessageText(chatPoll), { optionCount: 3, multi: false, endsAt: null });
});

test("channel and DM reaction endpoints enforce poll rules", () => {
  const src = readWorkerSource();
  assert.equal(src.match(/decidePollVote\(row\.text,\s*emoji,\s*Boolean\(exists\),\s*Date\.now\(\)\)/g)?.length, 2);
  assert.equal(src.match(/substr\(emoji,1,5\)='poll_'/g)?.length, 2);
});
