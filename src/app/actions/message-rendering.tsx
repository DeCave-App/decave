import { Icon } from "../../components/Icon";
import { downloadLegacyAttachmentDesktop } from "../../features/media/attachment-download";
import { InlineImage, canShowInline } from "../../features/media/InlineImage";
import { BotCard } from "../../features/bot-cards";
import { botRenderMode, messageBotFields } from "../../../shared/bots/card-view";
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
import { i18next } from "../../i18n/index.ts";
import { noticeText } from "../../i18n/notice.ts";
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
  giphyMediaProxyUrl,
} from "../message-payloads";
import { translatedDmPreview as dmPreviewText } from "../../i18n/dmPreview.ts";
import type { ComposerState } from "../state/composer";
import { attachmentDecrypter } from "../../e2ee/dm-e2ee-client";
import { unreadableMessageText } from "../../e2ee/DmEncryptionUi";
import { isEmojiOnly } from "../../features/settings/chatPrefs";
import { ChatAnimatedImage, LargeEmoji } from "../../features/settings/ChatMedia";

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
    const parts = renderRichTokens(text);
    // Settings → Chat: a message of one to three emoji renders large.
    return isEmojiOnly(text) ? [<LargeEmoji key="large-emoji">{parts}</LargeEmoji>] : parts;
  };

  const renderRichTokens = (text: string) => {
    const tokens = text.split(/(\s+|:[\p{L}\p{N}_-]+:)/gu);
    return tokens.map((token, index) => {
      const customName = token.startsWith(":") && token.endsWith(":") ? token.slice(1, -1) : "";
      const asset = customName
        ? hubAssets.find((item) => item.kind === "emote" && item.name.toLowerCase() === customName.toLowerCase())
        : undefined;
      if (asset)
        return (
          <ChatAnimatedImage
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
        <div className="dc-poll-kicker">{i18next.t("chat.actions.poll.kicker")}</div>
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
        <small>{i18next.t("chat.actions.poll.votes", { count: total })}</small>
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
        decrypt: attachmentDecrypter(attachment),
        contentType: attachment.mimeType,
      });
    } catch (error) {
      setAttachmentError(error instanceof Error ? error.message : i18next.t("chat.actions.message.downloadFailed"));
    }
  };

  const renderHubMessageBody = (item: ChatMessage) => {
    const gif = parsePrefixedJson<GifPayload>(item.text, GIF_PREFIX);
    const gifSrc = giphyMediaProxyUrl(gif?.url);
    if (gif && gifSrc)
      return (
        <a
          className="dc-gif-message"
          data-alt={gif.title || i18next.t("chat.actions.gif.fallbackTitle")}
          href={gifSrc}
          target="_blank"
          rel="noreferrer"
        >
          <ChatAnimatedImage
            src={gifSrc}
            alt={gif.title || i18next.t("chat.actions.gif.fallbackTitle")}
            loading="lazy"
          />
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
              ? i18next.t("chat.actions.event.invitedAll")
              : i18next.t("chat.actions.event.invited", {
                  names: event.invitedUsernames.join(", ") || i18next.t("chat.actions.event.selectedMembers"),
                })
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
          <ChatAnimatedImage src={`${HTTP_URL}${sticker.url}`} alt={sticker.name} />
          <small>{sticker.name}</small>
        </div>
      );
    const bot = parsePrefixedJson<{ botId: string; name: string; text: string; notice?: unknown }>(
      item.text,
      BOT_PREFIX,
    );
    // Builder bots: the API adds `bot`, `card` and `privateNotice` to the message.
    // Bot posts that aren't bot-wrapped (forum posts, token-bot text) fall through
    // to the normal pipeline; the author row adds the BOT badge for those.
    const builder = botRenderMode(item) === "card" ? messageBotFields(item) : {};
    if (builder.bot)
      return (
        <BotCard
          messageId={item.id}
          roomId={item.channelId ?? currentChannel.id}
          bot={builder.bot}
          card={builder.card}
          privateNotice={builder.privateNotice}
          // Text DeCave wrote for the bot (usage hints, Twitch clips) in the reader's language.
          body={bot ? renderRichMessageText(noticeText(bot.notice) ?? bot.text) : null}
          baseUrl={HTTP_URL}
          authorizedFetch={authorizedFetch}
          showHead={false}
        />
      );
    if (bot)
      return (
        <div className="dc-bot-message">
          <span>{i18next.t("chat.actions.message.botBadge")}</span>
          <strong>{bot.name}</strong>
          <p>{renderRichMessageText(bot.text)}</p>
        </div>
      );
    return (
      <>
        {renderRichMessageText(item.text)}
        {item.editedAt ? <em className="chat-edited"> · {i18next.t("chat.actions.message.edited")}</em> : null}
      </>
    );
  };

  const replyPreviewText = (text: string) => {
    const preview = dmPreviewText(text).replace(/\s+/g, " ").trim();
    if (!preview || preview.startsWith("__DECAVE_")) return i18next.t("dm.preview.message");
    return preview.length > 96 ? `${preview.slice(0, 93)}…` : preview;
  };

  const scrollToMessage = (messageId: string) => {
    const target = Array.from(document.querySelectorAll<HTMLElement>("[data-message-id]")).find(
      (element) => element.dataset.messageId === messageId,
    );
    target?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const renderDmMessageBody = (message: DirectMessage) => {
    if (message.e2ee === "locked" || message.e2ee === "failed")
      return (
        <span className="dc-dm-e2ee-placeholder">
          <Icon name="lock" size="sm" />
          {unreadableMessageText(message.e2ee, "dm")}
        </span>
      );
    const gif = parsePrefixedJson<GifPayload>(message.text, GIF_PREFIX);
    const gifSrc = giphyMediaProxyUrl(gif?.url);
    if (gif && gifSrc)
      return (
        <a
          className="dc-gif-message"
          data-alt={gif.title || i18next.t("chat.actions.gif.fallbackTitle")}
          href={gifSrc}
          target="_blank"
          rel="noreferrer"
        >
          <ChatAnimatedImage
            src={gifSrc}
            alt={gif.title || i18next.t("chat.actions.gif.fallbackTitle")}
            loading="lazy"
          />
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
          decrypt={attachmentDecrypter(attachment)}
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
              {i18next.t("chat.actions.attachment.details", {
                type: attachment.mimeType || i18next.t("chat.actions.attachment.fallbackType"),
                size: (attachment.size / 1024 / 1024).toFixed(2),
                security: attachment.fileKey
                  ? i18next.t("chat.actions.attachment.encrypted")
                  : i18next.t("chat.actions.attachment.legacy"),
              })}
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
  if (message.e2ee === "locked" || message.e2ee === "failed")
    return (
      <span className="dc-dm-e2ee-placeholder">
        <Icon name="lock" size="sm" />
        {unreadableMessageText(message.e2ee, "group")}
      </span>
    );
  const gif = parsePrefixedJson<GifPayload>(message.text, GIF_PREFIX);
  const gifSrc = giphyMediaProxyUrl(gif?.url);
  if (gif && gifSrc)
    return (
      <a
        className="dc-gif-message"
        data-alt={gif.title || i18next.t("chat.actions.gif.fallbackTitle")}
        href={gifSrc}
        target="_blank"
        rel="noreferrer"
      >
        <ChatAnimatedImage src={gifSrc} alt={gif.title || i18next.t("chat.actions.gif.fallbackTitle")} loading="lazy" />
      </a>
    );
  return message.text;
};

export type MessageRendering = ReturnType<typeof createMessageRendering>;
