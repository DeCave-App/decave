// Polls travel as prefixed JSON in the message text and votes are reactions
// named `poll_<option index>`, one per person, exactly like web
// (src/app/message-payloads.ts, src/app/actions/hub-chat.tsx).

export const POLL_PREFIX = "__DECAVE_POLL__";
export const POLL_QUESTION_MAX = 180;
export const POLL_OPTION_MAX = 100;
export const POLL_MIN_OPTIONS = 2;
export const POLL_MAX_OPTIONS = 8;

export type PollPayload = { question: string; options: string[] };
export type Reactions = Record<string, string[]> | null | undefined;

export function parsePoll(text: string | null | undefined): PollPayload | null {
  if (!text || !text.startsWith(POLL_PREFIX)) return null;
  try {
    const raw = JSON.parse(text.slice(POLL_PREFIX.length)) as Partial<PollPayload>;
    if (typeof raw.question !== "string" || !Array.isArray(raw.options)) return null;
    const options = raw.options.filter((option): option is string => typeof option === "string").slice(0, POLL_MAX_OPTIONS);
    if (options.length < POLL_MIN_OPTIONS) return null;
    return { question: raw.question, options };
  } catch {
    return null;
  }
}

/** The message text for a new poll, trimmed to web's limits; null until it has a question and two options. */
export function pollMessageText(question: string, options: readonly string[]): string | null {
  const q = question.trim().slice(0, POLL_QUESTION_MAX);
  const choices = options
    .map((option) => option.trim().slice(0, POLL_OPTION_MAX))
    .filter(Boolean)
    .slice(0, POLL_MAX_OPTIONS);
  if (!q || choices.length < POLL_MIN_OPTIONS) return null;
  return `${POLL_PREFIX}${JSON.stringify({ question: q, options: choices } satisfies PollPayload)}`;
}

export type PollTally = { counts: number[]; total: number; mine: number | null };

export function tallyPoll(poll: PollPayload, reactions: Reactions, userId: string | null | undefined): PollTally {
  const counts = poll.options.map((_option, index) => reactions?.[`poll_${index}`]?.length ?? 0);
  const mineIndex = userId ? poll.options.findIndex((_option, index) => reactions?.[`poll_${index}`]?.includes(userId)) : -1;
  return { counts, total: counts.reduce((sum, count) => sum + count, 0), mine: mineIndex >= 0 ? mineIndex : null };
}

/**
 * The reaction toggles that move my vote to `optionIndex`: earlier votes are
 * removed first, and choosing my current option again changes nothing.
 */
export function pollVoteToggles(reactions: Reactions, userId: string, optionIndex: number): string[] {
  const next = `poll_${optionIndex}`;
  const mine = Object.entries(reactions ?? {})
    .filter(([key, users]) => key.startsWith("poll_") && users.includes(userId))
    .map(([key]) => key);
  return [...mine.filter((key) => key !== next), ...(mine.includes(next) ? [] : [next])];
}

/** Poll votes and forum votes are stored as reactions but are not emoji chips. */
export function isReactionChip(key: string): boolean {
  return !key.startsWith("poll_") && !key.startsWith("forum_vote_");
}
