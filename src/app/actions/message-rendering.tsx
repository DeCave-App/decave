import { Icon } from "../../components/Icon";
import { downloadLegacyAttachmentDesktop } from "../../features/media/attachment-download";
import { InlineImage, canShowInline } from "../../features/media/InlineImage";
import {
  EventChatCard,
  apiEventToItem,
  type CalendarItem,
  type HubEvent as ApiHubEvent,
  type HubEventsStore,
  type EventsApiContext,
} from "../../features/events";
import type {
  Channel,
  HubAsset,
  PollPayload,
  GifPayload,
  Server,
  AccountUser,
  AttachmentMeta,
  ChatMessage,
  DirectMessage,
  GroupChatMessage,
} from "../types";
import { HTTP_URL } from "../env";
import {
  POLL_PREFIX,
  EVENT_PREFIX,
  DM_ATTACHMENT_PREFIX,
  STICKER_PREFIX,
  BOT_PREFIX,
  GIF_PREFIX,
  parsePrefixedJson,
  parseHubCalendarEvent,
  safeGiphyUrl,
} from "../message-payloads";
import type { ComposerState } from "../state/composer";

export type MessageRenderingDeps = {
  currentUser: AccountUser;
  hubAssets: HubAsset[];
  currentServer: Server;
  currentChannel: Channel;
  authorizedFetch: (url: string, init?: RequestInit) => Promise<Response>;
  hubEventsApi: EventsApiContext;
  hubEvents: HubEventsStore;
  voteInHubPoll: (message: ChatMessage, optionIndex: number) => Promise<void>;
  voteInDmPoll: (message: DirectMessage, optionIndex: number) => Promise<void>;
  findApiHubEvent: (eventId: string) => ApiHubEvent | null;
  openCalendarItem: (item: CalendarItem) => void;
  composer: ComposerState;
  changeChannel: (channelId: number) => void;
};

/** Called once per render with that render's values. */
export function createMessageRendering(deps: MessageRenderingDeps) {
  const {
    currentUser,
    hubAssets,
    currentServer,
    currentChannel,
    authorizedFetch,
    hubEventsApi,
    hubEvents,
    voteInHubPoll,
    voteInDmPoll,
    findApiHubEvent,
    openCalendarItem,
    composer,
    changeChannel,
  } = deps;
  const { setAttachmentError } = composer;

  /** Opener for a #room in the current Hub, or null when the Hub has no room by that name. */
  const roomLink = (name: string): (() => void) | null => {
    const wanted = name.toLowerCase();
    const channel = currentServer.channels.find((item) => item.name.trim().toLowerCase() === wanted);
    return channel ? () => changeChannel(channel.id) : null;
  };

  const renderRoomLink = (token: string, key: number) => {
    const match = /^#([\p{L}\p{N}_-]+)([.,!?;:)]*)$/u.exec(token);
    const open = match ? roomLink(match[1]) : null;
    if (!match || !open) return null;
    return (
      <span key={key}>
        <button type="button" className="room-link" onClick={open}>
          #{match[1]}
        </button>
        {match[2]}
      </span>
    );
  };

  const renderRichMessageText = (text: string) => {
    const tokens = text.split(/(\s+|:[\p{L}\p{N}_-]+:)/gu);
    return tokens.map((token, index) => {
      const customName = token.startsWith(":") && token.endsWith(":") ? token.slice(1, -1) : "";
      const asset = customName
        ? hubAssets.find((item) => item.kind === "emote" && item.name.toLowerCase() === customName.toLowerCase())
        : undefined;
      if (asset)
        return (
          <img
            key={index}
            className="dc-inline-emote"
            src={`${HTTP_URL}${asset.url}`}
            alt={`:${asset.name}:`}
            title={`:${asset.name}:`}
          />
        );
      if (token.startsWith("#")) {
        const room = renderRoomLink(token, index);
        if (room) return room;
      }
      const url = /^(https:\/\/[^\s<]+?)([.,!?;:)]*)$/.exec(token);
      if (url)
        return (
          <span key={index}>
            <a href={url[1]} target="_blank" rel="noreferrer">
              {url[1]}
            </a>
            {url[2]}
          </span>
        );
      const normalized = token.replace(/[.,!?;:]+$/, "");
      if (normalized.startsWith("@")) {
        const mine =
          normalized.toLowerCase() === `@${currentUser.username.toLowerCase()}` ||
          normalized.toLowerCase() === "@everyone";
        return (
          <span key={index} className={mine ? "chat-mention mine" : "chat-mention"}>
            {token}
          </span>
        );
      }
      return token;
    });
  };

  const renderForumRichText = (text: string) => {
    const parts = text.split(
      /(\*\*[^*\n]+\*\*|\[[^\]\n]+\]\(https:\/\/[^\s)]+\)|https:\/\/[^\s]+|(?<![\w&/#])#[\p{L}\p{N}_-]+)/gu,
    );
    return parts.map((part, index) => {
      const bold = /^\*\*([^*\n]+)\*\*$/.exec(part);
      if (bold) return <strong key={index}>{bold[1]}</strong>;
      const markdownLink = /^\[([^\]\n]+)\]\((https:\/\/[^\s)]+)\)$/.exec(part);
      if (markdownLink)
        return (
          <a key={index} href={markdownLink[2]} target="_blank" rel="noreferrer">
            {markdownLink[1]}
          </a>
        );
      if (/^https:\/\/[^\s]+$/.test(part))
        return (
          <a key={index} href={part} target="_blank" rel="noreferrer">
            {part}
          </a>
        );
      return (part.startsWith("#") && renderRoomLink(part, index)) || part;
    });
  };

  const renderPoll = (
    poll: PollPayload,
    reactions: Record<string, string[]> | undefined,
    vote: (index: number) => void,
  ) => {
    const total = poll.options.reduce((sum, _option, index) => sum + (reactions?.[`poll_${index}`]?.length ?? 0), 0);
    return (
      <div className="dc-poll-card">
        <div className="dc-poll-kicker">POLL</div>
        <strong>{poll.question}</strong>
        <div className="dc-poll-options">
          {poll.options.map((option, index) => {
            const count = reactions?.[`poll_${index}`]?.length ?? 0;
            const selected = reactions?.[`poll_${index}`]?.includes(currentUser.id) ?? false;
            const percent = total ? Math.round((count / total) * 100) : 0;
            return (
              <button key={index} type="button" className={selected ? "selected" : ""} onClick={() => vote(index)}>
                <span style={{ width: `${percent}%` }} />
                <b>{option}</b>
                <em>
                  {count} · {percent}%
                </em>
              </button>
            );
          })}
        </div>
        <small>
          {total} vote{total === 1 ? "" : "s"}
        </small>
      </div>
    );
  };

  const downloadLegacyAttachment = async (attachment: AttachmentMeta) => {
    try {
      await downloadLegacyAttachmentDesktop({
        url: attachment.url,
        filename: attachment.name,
        baseUrl: HTTP_URL,
        authorizedFetch,
      });
    } catch (error) {
      setAttachmentError(error instanceof Error ? error.message : "Could not download attachment.");
    }
  };

  const renderHubMessageBody = (item: ChatMessage) => {
    const gif = parsePrefixedJson<GifPayload>(item.text, GIF_PREFIX);
    const gifUrl = safeGiphyUrl(gif?.url);
    if (gif && gifUrl)
      return (
        <a className="dc-gif-message" data-alt={gif.title || "GIF"} href={gifUrl} target="_blank" rel="noreferrer">
          <img src={gifUrl} alt={gif.title || "GIF"} loading="lazy" />
        </a>
      );
    const poll = parsePrefixedJson<PollPayload>(item.text, POLL_PREFIX);
    if (poll) return renderPoll(poll, item.reactions, (index) => void voteInHubPoll(item, index));
    const event = parseHubCalendarEvent(item.text);
    if (event) {
      const announcedId = parsePrefixedJson<{ eventId?: unknown }>(item.text, EVENT_PREFIX)?.eventId;
      const apiEvent = typeof announcedId === "string" ? findApiHubEvent(announcedId) : null;
      return (
        <EventChatCard
          messageId={item.id}
          hubId={currentServer.id}
          hubName={currentServer.name}
          title={event.title}
          startAt={event.startAt}
          description={event.description}
          inviteLabel={
            event.inviteMode === "all"
              ? "Invited: All Hub members"
              : `Invited: ${event.invitedUsernames.join(", ") || "Selected members"}`
          }
          event={apiEvent}
          api={hubEventsApi}
          onChanged={hubEvents.applyEvent}
          onOpen={() =>
            openCalendarItem(
              apiEvent
                ? apiEventToItem(apiEvent, currentServer.name)
                : {
                    key: `legacy:${item.id}`,
                    source: "legacy",
                    id: item.id,
                    hubId: currentServer.id,
                    hubName: currentServer.name,
                    title: event.title,
                    description: event.description,
                    start: Date.parse(event.startAt),
                    end: null,
                    channelId: item.channelId ?? currentChannel.id,
                    voiceChannelId: null,
                    coverUrl: null,
                    timezone: null,
                    gameTag: null,
                    cancelled: false,
                    event: null,
                    legacy: {
                      id: item.id,
                      hubId: currentServer.id,
                      hubName: currentServer.name,
                      channelId: item.channelId ?? currentChannel.id,
                      channelName: currentChannel.name,
                      title: event.title,
                      startAt: event.startAt,
                      description: event.description,
                      authorName: item.username,
                    },
                  },
            )
          }
        />
      );
    }
    const sticker = parsePrefixedJson<HubAsset>(item.text, STICKER_PREFIX);
    if (sticker)
      return (
        <div className="dc-sticker-message">
          <img src={`${HTTP_URL}${sticker.url}`} alt={sticker.name} />
          <small>{sticker.name}</small>
        </div>
      );
    const bot = parsePrefixedJson<{ botId: string; name: string; text: string }>(item.text, BOT_PREFIX);
    if (bot)
      return (
        <div className="dc-bot-message">
          <span>BOT</span>
          <strong>{bot.name}</strong>
          <p>{renderRichMessageText(bot.text)}</p>
        </div>
      );
    return (
      <>
        {renderRichMessageText(item.text)}
        {item.editedAt ? <em className="chat-edited"> · edited</em> : null}
      </>
    );
  };

  const dmPreviewText = (text: string) => {
    const gif = parsePrefixedJson<GifPayload>(text, GIF_PREFIX);
    if (gif && safeGiphyUrl(gif.url)) return "GIF";
    const attachment = parsePrefixedJson<AttachmentMeta>(text, DM_ATTACHMENT_PREFIX);
    if (attachment) return `📎 ${attachment.name}`;
    const poll = parsePrefixedJson<PollPayload>(text, POLL_PREFIX);
    if (poll) return `Poll: ${poll.question}`;
    return text;
  };

  const replyPreviewText = (text: string) => {
    const preview = dmPreviewText(text).replace(/\s+/g, " ").trim();
    if (!preview || preview.startsWith("__DECAVE_")) return "Message";
    return preview.length > 96 ? `${preview.slice(0, 93)}…` : preview;
  };

  const scrollToMessage = (messageId: string) => {
    const target = Array.from(document.querySelectorAll<HTMLElement>("[data-message-id]")).find(
      (element) => element.dataset.messageId === messageId,
    );
    target?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const renderDmMessageBody = (message: DirectMessage) => {
    const gif = parsePrefixedJson<GifPayload>(message.text, GIF_PREFIX);
    const gifUrl = safeGiphyUrl(gif?.url);
    if (gif && gifUrl)
      return (
        <a className="dc-gif-message" data-alt={gif.title || "GIF"} href={gifUrl} target="_blank" rel="noreferrer">
          <img src={gifUrl} alt={gif.title || "GIF"} loading="lazy" />
        </a>
      );
    const poll = parsePrefixedJson<PollPayload>(message.text, POLL_PREFIX);
    if (poll) return renderPoll(poll, message.reactions, (index) => void voteInDmPoll(message, index));
    const attachment = parsePrefixedJson<AttachmentMeta>(message.text, DM_ATTACHMENT_PREFIX);
    if (attachment && canShowInline(attachment))
      return (
        <InlineImage
          attachment={attachment}
          baseUrl={HTTP_URL}
          authorizedFetch={authorizedFetch}
          onDownload={() => void downloadLegacyAttachment(attachment)}
        />
      );
    if (attachment)
      return (
        <button type="button" className="dc-dm-attachment" onClick={() => void downloadLegacyAttachment(attachment)}>
          <span>
            <Icon name="external" size="sm" />
          </span>
          <span>
            <strong>{attachment.name}</strong>
            <small>
              {attachment.mimeType || "Attachment"} · {(attachment.size / 1024 / 1024).toFixed(2)} MB · Authenticated
              legacy download
            </small>
          </span>
        </button>
      );
    return message.text;
  };

  return {
    roomLink,
    renderForumRichText,
    downloadLegacyAttachment,
    renderHubMessageBody,
    dmPreviewText,
    replyPreviewText,
    scrollToMessage,
    renderDmMessageBody,
  };
}

export const renderGroupMessageBody = (message: GroupChatMessage) => {
  const gif = parsePrefixedJson<GifPayload>(message.text, GIF_PREFIX);
  const gifUrl = safeGiphyUrl(gif?.url);
  if (gif && gifUrl)
    return (
      <a className="dc-gif-message" data-alt={gif.title || "GIF"} href={gifUrl} target="_blank" rel="noreferrer">
        <img src={gifUrl} alt={gif.title || "GIF"} loading="lazy" />
      </a>
    );
  return message.text;
};

export type MessageRendering = ReturnType<typeof createMessageRendering>;
