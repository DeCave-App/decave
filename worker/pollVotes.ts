// Server-side rules for poll votes, which are stored as `poll_<index>` reactions.
import { FORUM_POST_PREFIX, parseForumPostPayload } from "../shared/forum";

export const CHAT_POLL_PREFIX = "__DECAVE_POLL__";

export type PollRules = { optionCount: number; multi: boolean; endsAt: number | null };

export type PollVoteDecision =
  | { kind: "not_poll_vote" }
  | { kind: "reject"; error: string; code: string }
  | { kind: "allow"; clearOtherPollVotes: boolean };

const POLL_EMOJI = /^poll_(0|[1-9]\d{0,2})$/;

export function pollRulesFromMessageText(text: string | null | undefined): PollRules | null {
  if (typeof text !== "string") return null;
  if (text.startsWith(FORUM_POST_PREFIX)) {
    const post = parseForumPostPayload(text);
    if (!post || post.type !== "poll" || !post.poll) return null;
    return { optionCount: post.poll.options.length, multi: post.poll.multi, endsAt: post.poll.endsAt };
  }
  if (text.startsWith(CHAT_POLL_PREFIX)) {
    try {
      const raw = JSON.parse(text.slice(CHAT_POLL_PREFIX.length)) as { options?: unknown };
      if (!Array.isArray(raw?.options) || raw.options.length < 1) return null;
      // Chat/DM polls have no end time and are single-choice.
      return { optionCount: raw.options.length, multi: false, endsAt: null };
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Decide whether toggling `emoji` on a message is a legal poll vote.
 * `removing` is true when the user already has this reaction (toggle off).
 */
export function decidePollVote(
  messageText: string | null | undefined,
  emoji: string,
  removing: boolean,
  now: number,
): PollVoteDecision {
  if (!emoji.startsWith("poll_")) return { kind: "not_poll_vote" };
  const rules = pollRulesFromMessageText(messageText);
  if (!rules) {
    // Allow cleaning up a stray legacy vote, but never add one to a non-poll.
    return removing
      ? { kind: "allow", clearOtherPollVotes: false }
      : { kind: "reject", error: "This message is not a poll.", code: "POLL_INVALID" };
  }
  if (rules.endsAt !== null && now >= rules.endsAt)
    return { kind: "reject", error: "This poll has ended.", code: "POLL_ENDED" };
  if (removing) return { kind: "allow", clearOtherPollVotes: false };
  const match = POLL_EMOJI.exec(emoji);
  if (!match || Number(match[1]) >= rules.optionCount)
    return { kind: "reject", error: "Invalid poll option.", code: "POLL_OPTION_INVALID" };
  return { kind: "allow", clearOtherPollVotes: !rules.multi };
}
