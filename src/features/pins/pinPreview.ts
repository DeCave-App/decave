// What the pinned-messages panel shows for each pin.

type Previewable = { text: string; attachment?: { name: string; mimeType: string } | null };

/** Kinds of pin that are described rather than quoted. */
export type PinKind = "forumPost" | "event" | "poll" | "bot" | "gif" | "sticker" | "image" | "file" | "message";

/**
 * Turns a pin kind into display text. `detail` is the post/poll/event title or
 * the attachment's file name, when there is one. The panel passes one built on
 * t() (hub.pins.kinds.*); the English one below is the default.
 */
export type PinLabel = (kind: PinKind, detail?: string) => string;

const STRUCTURED: Array<[string, PinKind]> = [
  ["__DECAVE_FORUM_POST_V1__", "forumPost"],
  ["__DECAVE_EVENT__", "event"],
  ["__DECAVE_POLL__", "poll"],
  ["__DECAVE_BOT__", "bot"],
  ["__DECAVE_GIF__", "gif"],
  ["__DECAVE_STICKER__", "sticker"],
];

const ENGLISH: Record<PinKind, string> = {
  forumPost: "Forum post",
  event: "Event",
  poll: "Poll",
  bot: "Bot message",
  gif: "GIF",
  sticker: "Sticker",
  image: "Image",
  file: "File",
  message: "Message",
};

const englishLabel: PinLabel = (kind, detail) => {
  if (detail === undefined) return ENGLISH[kind];
  return kind === "image" || kind === "file" ? `${ENGLISH[kind]} · ${detail}` : `${ENGLISH[kind]}: ${detail}`;
};

/** Text to show for a pin: plain text, or what kind of special message it is. */
export function pinPreview(message: Previewable, full = false, label: PinLabel = englishLabel): string {
  const text = message.text ?? "";
  for (const [prefix, kind] of STRUCTURED) {
    if (text.startsWith(prefix)) {
      try {
        const payload = JSON.parse(text.slice(prefix.length)) as {
          title?: unknown;
          question?: unknown;
          name?: unknown;
        };
        const title = [payload.title, payload.question, payload.name].find(
          (value) => typeof value === "string" && value.trim(),
        );
        return title ? label(kind, String(title).trim()) : label(kind);
      } catch {
        return label(kind);
      }
    }
  }
  if (text.trim()) return !full && text.length > 280 ? `${text.slice(0, 280)}…` : text;
  if (message.attachment)
    return label(message.attachment.mimeType.startsWith("image/") ? "image" : "file", message.attachment.name);
  return label("message");
}
