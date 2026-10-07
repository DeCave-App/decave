// Presentation for the optional forum post extensions (type, poll, LFG, media).
import type { ForumLfg, ForumMedia, ForumPoll, ForumPostType } from "../../../shared/forum";
import { FORUM_TYPE_META, pollTallies } from "./forumModel";
import { Icon } from "../../components/Icon";
import { localeForLanguage, preferredTimeOptions } from "../../app/locale";

export function TypeBadge({ type, compact }: { type: ForumPostType; compact?: boolean }) {
  const meta = FORUM_TYPE_META[type];
  return (
    <span className={`fx-type-badge t-${type}`} title={meta.label}>
      <span aria-hidden="true">{meta.icon}</span>
      {compact ? <span className="fx-sr">{meta.label}</span> : meta.label}
    </span>
  );
}

const formatWhen = (time: number) =>
  new Date(time).toLocaleString(localeForLanguage(), {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    ...preferredTimeOptions(),
  });

function remaining(endsAt: number, now: number) {
  const minutes = Math.round((endsAt - now) / 60000);
  if (minutes < 60) return `${Math.max(1, minutes)}m left`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours}h left` : `${Math.round(hours / 24)}d left`;
}

export function PollBlock(props: {
  poll: ForumPoll;
  reactions?: Record<string, string[]>;
  viewerId: string;
  /** Omit for a read-only preview. */
  onVote?: (optionIndex: number) => void;
  compact?: boolean;
}) {
  const { poll } = props;
  const now = Date.now();
  const closed = poll.endsAt !== null && poll.endsAt <= now;
  const tally = pollTallies(props.reactions, poll.options.length, props.viewerId);
  const voted = tally.mine.some(Boolean);
  const showResults = closed || voted || !props.onVote;
  const options = props.compact ? poll.options.slice(0, 3) : poll.options;
  return (
    <div className={`fx-poll${props.compact ? " compact" : ""}`} onClick={(event) => event.stopPropagation()}>
      <div className="fx-poll-meta">
        <span>{poll.multi ? "Choose any" : "Choose one"}</span>
        <span>
          {tally.voters} voter{tally.voters === 1 ? "" : "s"}
        </span>
        {poll.endsAt !== null && (
          <span className={closed ? "closed" : ""}>{closed ? "Poll closed" : remaining(poll.endsAt, now)}</span>
        )}
      </div>
      <div className="fx-poll-options" role={props.onVote ? "group" : undefined} aria-label="Poll options">
        {options.map((option, index) => {
          const percent = tally.total ? Math.round((tally.counts[index] / tally.total) * 100) : 0;
          const content = (
            <>
              <span className="fx-poll-bar" style={{ width: showResults ? `${percent}%` : "0%" }} aria-hidden="true" />
              <span className="fx-poll-check" aria-hidden="true">
                {tally.mine[index] ? "✓" : poll.multi ? "□" : "○"}
              </span>
              <b>{option}</b>
              {showResults && (
                <em>
                  {tally.counts[index]} · {percent}%
                </em>
              )}
            </>
          );
          return props.onVote && !closed && !props.compact ? (
            <button
              key={index}
              type="button"
              className={`fx-poll-option${tally.mine[index] ? " mine" : ""}`}
              aria-pressed={tally.mine[index]}
              onClick={() => props.onVote!(index)}
            >
              {content}
            </button>
          ) : (
            <div key={index} className={`fx-poll-option${tally.mine[index] ? " mine" : ""}`}>
              {content}
            </div>
          );
        })}
        {props.compact && poll.options.length > options.length && (
          <small className="fx-muted">+{poll.options.length - options.length} more</small>
        )}
      </div>
    </div>
  );
}

export function LfgBlock({ lfg, compact }: { lfg: ForumLfg; compact?: boolean }) {
  return (
    <dl className={`fx-lfg${compact ? " compact" : ""}`}>
      <div>
        <dt>Game</dt>
        <dd>{lfg.game}</dd>
      </div>
      {lfg.platform && (
        <div>
          <dt>Platform</dt>
          <dd>{lfg.platform}</dd>
        </div>
      )}
      <div>
        <dt>Need</dt>
        <dd>
          {lfg.slots} player{lfg.slots === 1 ? "" : "s"}
        </dd>
      </div>
      {lfg.startAt !== null && (
        <div>
          <dt>Starts</dt>
          <dd>{formatWhen(lfg.startAt)}</dd>
        </div>
      )}
    </dl>
  );
}

/** Media attached to a Clip / Media post. `compact` (feed cards) always renders
    the link chip, never an inline player. */
export function MediaBlock({
  media,
  resolveUrl,
  compact,
}: {
  media: ForumMedia;
  resolveUrl(url: string): string | null;
  compact?: boolean;
}) {
  const local = resolveUrl(media.url);
  if (!compact && local && media.mime?.startsWith("image/"))
    return <img className="fx-media-img" src={local} alt="Post media" loading="lazy" />;
  if (!compact && local && media.mime?.startsWith("video/"))
    return <video className="fx-media-video" src={local} controls preload="metadata" />;
  let host = "";
  try {
    host = new URL(media.url).hostname.replace(/^www\./, "");
  } catch {
    /* local path */
  }
  const href = local ?? (media.url.startsWith("https://") ? media.url : null);
  if (!href) return null;
  return (
    <a
      className={`fx-media-link${compact ? " compact" : ""}`}
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      onClick={(event) => event.stopPropagation()}
    >
      <span aria-hidden="true">
        <Icon name={media.mime?.startsWith("image/") ? "image" : "video"} size="sm" />
      </span>
      <span>
        <strong>{host || "Media file"}</strong>
        <small>{media.url}</small>
      </span>
    </a>
  );
}
