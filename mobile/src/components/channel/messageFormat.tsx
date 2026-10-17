// Message formatting for the room screen: forum posts, previews, message text
// with mentions and links, times, day labels and attachment sizes.

import { t } from "i18next";
import { Image, Text } from "react-native";
import { messageBotFields } from "../../../../shared/bots/card-view";
import { forumPostNotices } from "../../../../shared/forum";
import { noticeText } from "@/src/lib/server-notice";
import { linkStyle, openLink } from "@/src/components/LinkifiedText";
import { styles } from "./channelScreen.styles";
import { hour12Preference } from "@/src/lib/account-preferences-store";
import { dateLocale } from "@/src/lib/date-locale";
import { findEmote, parseSticker, type HubAsset } from "@/src/lib/hub-assets";
import { parsePoll } from "@/src/lib/polls";
import { parseChatEvent } from "@/src/lib/hub-events-model";
import { assetUrl } from "@/src/components/hub/hubShared";

export const FORUM_POST_PREFIX = "__DECAVE_FORUM_POST_V1__";

export type ForumPost = { title: string; body: string; tags: string[] };

/**
 * Forum posts are stored as a prefixed JSON payload; see shared/forum.ts.
 * Pass the message to show a bot's post (Twitch clips) with DeCave's wording
 * in the UI language; the clip title and members' posts stay as written.
 */
export function parseForumPost(text: string, message?: { bot?: unknown }): ForumPost | null {
  if (!text.startsWith(FORUM_POST_PREFIX)) return null;
  try {
    const raw = JSON.parse(text.slice(FORUM_POST_PREFIX.length)) as Record<string, unknown>;
    const notices = message && messageBotFields(message).bot ? forumPostNotices(text) : null;
    return {
      title:
        noticeText(notices?.title) ?? (typeof raw.title === "string" ? raw.title : t("forum.mobile.untitledPost")),
      body: noticeText(notices?.body) ?? (typeof raw.body === "string" ? raw.body : ""),
      tags: Array.isArray(raw.tags) ? raw.tags.filter((tag): tag is string => typeof tag === "string") : [],
    };
  } catch {
    return { title: t("hub.pins.kinds.forumPost"), body: "", tags: [] };
  }
}

export function messagePreviewText(text: string, message?: { bot?: unknown }): string {
  const event = parseChatEvent(text);
  if (event) return `${t("events.card.kicker")}: ${event.title}`;
  const poll = parsePoll(text);
  if (poll) return `${t("chat.actions.poll.kicker")}: ${poll.question}`;
  const sticker = parseSticker(text);
  if (sticker) return sticker.name ? `:${sticker.name}:` : t("chat.actions.emoji.hubAssets");
  return parseForumPost(text, message)?.title ?? text;
}

export const CHANNEL_REACTION_EMOJIS = ["👍","❤️","😂","🔥","🎉","😮","😢","😡","👏","💯","🎮","🏆"];

/** Message text with links, mentions and (in Hubs) the Hub's custom `:emotes:` inline. */
export function renderMessageText(text: string, username?: string, emotes: readonly HubAsset[] = []) {
  const ownMention = username ? `@${username.toLowerCase()}` : "";

  return text.split(messageTokenPattern()).map((part, index) => {
    const emote = emotes.length > 0 ? findEmote(emotes, part) : null;
    const emoteUri = emote ? assetUrl(emote.url) : null;
    if (emote && emoteUri) {
      return (
        <Image
          key={`${index}:${part}`}
          source={{ uri: emoteUri }}
          style={EMOTE_STYLE}
          accessibilityLabel={`:${emote.name}:`}
        />
      );
    }
    if (/^https?:\/\//i.test(part)) {
      return (
        <Text key={`${index}:${part}`} style={linkStyle} accessibilityRole="link" onPress={() => openLink(part)}>
          {part}
        </Text>
      );
    }
    const lower = part.toLowerCase();
    const isMention = part.startsWith("@");
    const isMine =
      lower === "@everyone" || (!!ownMention && lower === ownMention);

    return (
      <Text
        key={`${index}:${part}`}
        style={
          isMine
            ? styles.mentionMine
            : isMention
              ? styles.mention
              : undefined
        }
      >
        {part}
      </Text>
    );
  });
}

const EMOTE_STYLE = { width: 22, height: 22 } as const;

const LINK_AND_MENTION = String.raw`https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]]|@everyone|@[a-zA-Z0-9_.-]+`;
let tokenPattern: RegExp | undefined;

/**
 * Links, mentions and `:emote:` names (any letters, like the server allows).
 * Built on first use inside try, as in emoji-only.ts: a Unicode property
 * regex the engine rejected at import time would break every chat screen.
 */
function messageTokenPattern(): RegExp {
  if (tokenPattern) return tokenPattern;
  try {
    tokenPattern = new RegExp(String.raw`(${LINK_AND_MENTION}|:[\p{L}\p{N}_-]+:)`, "giu");
  } catch {
    tokenPattern = new RegExp(String.raw`(${LINK_AND_MENTION}|:[A-Za-z0-9_-]+:)`, "gi");
  }
  return tokenPattern;
}

export function formatMessageTime(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "";

  return new Date(timestamp).toLocaleTimeString(dateLocale(), {
    hour: "2-digit",
    minute: "2-digit",
    hour12: hour12Preference(),
  });
}

export function formatDayLabel(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "";

  const date = new Date(timestamp);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();

  if (sameDay(date, today)) return t("chat.social.today");
  if (sameDay(date, yesterday)) return t("chat.actions.dm.yesterday");

  return date.toLocaleDateString(dateLocale(), {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export function previewMessage(text: string): string {
  const preview = text.replace(/\s+/g, " ").trim();
  if (!preview) return t("hub.pins.kinds.message");
  return preview.length > 88 ? `${preview.slice(0, 85)}…` : preview;
}

export function formatAttachmentSize(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "";
  if (value < 1024) return t("chat.mobile.size.bytes", { size: value });
  if (value < 1024 * 1024) return t("forum.view.sizeKb", { size: Math.round(value / 1024) });
  return t("forum.view.sizeMb", { size: (value / (1024 * 1024)).toFixed(1) });
}
