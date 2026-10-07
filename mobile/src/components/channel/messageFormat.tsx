// Message formatting for the room screen: forum posts, previews, message text
// with mentions and links, times, day labels and attachment sizes.

import { Text } from "react-native";
import { linkStyle, openLink } from "@/src/components/LinkifiedText";
import { styles } from "./channelScreen.styles";

export const FORUM_POST_PREFIX = "__DECAVE_FORUM_POST_V1__";

export type ForumPost = { title: string; body: string; tags: string[] };

/** Forum posts are stored as a prefixed JSON payload; see shared/forum.ts. */
export function parseForumPost(text: string): ForumPost | null {
  if (!text.startsWith(FORUM_POST_PREFIX)) return null;
  try {
    const raw = JSON.parse(text.slice(FORUM_POST_PREFIX.length)) as Record<string, unknown>;
    return {
      title: typeof raw.title === "string" ? raw.title : "Untitled post",
      body: typeof raw.body === "string" ? raw.body : "",
      tags: Array.isArray(raw.tags) ? raw.tags.filter((tag): tag is string => typeof tag === "string") : [],
    };
  } catch {
    return { title: "Forum post", body: "", tags: [] };
  }
}

export function messagePreviewText(text: string): string {
  return parseForumPost(text)?.title ?? text;
}

export const CHANNEL_REACTION_EMOJIS = ["👍","❤️","😂","🔥","🎉","😮","😢","😡","👏","💯","🎮","🏆"];

export function renderMessageText(text: string, username?: string) {
  const ownMention = username ? `@${username.toLowerCase()}` : "";

  return text.split(/(https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]]|@everyone|@[a-zA-Z0-9_.-]+)/gi).map((part, index) => {
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

export function formatMessageTime(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "";

  return new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
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

  if (sameDay(date, today)) return "Today";
  if (sameDay(date, yesterday)) return "Yesterday";

  return date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export function previewMessage(text: string): string {
  const preview = text.replace(/\s+/g, " ").trim();
  if (!preview) return "Message";
  return preview.length > 88 ? `${preview.slice(0, 85)}…` : preview;
}

export function formatAttachmentSize(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}
