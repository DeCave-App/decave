// What the pinned-messages panel shows for each pin.

type Previewable = { text: string; attachment?: { name: string; mimeType: string } | null };

const STRUCTURED: Array<[string, string]> = [
  ["__DECAVE_FORUM_POST_V1__", "Forum post"],
  ["__DECAVE_EVENT__", "Event"],
  ["__DECAVE_POLL__", "Poll"],
  ["__DECAVE_BOT__", "Bot message"],
  ["__DECAVE_GIF__", "GIF"],
  ["__DECAVE_STICKER__", "Sticker"],
];

/** Text to show for a pin: plain text, or what kind of special message it is. */
export function pinPreview(message: Previewable, full = false): string {
  const text = message.text ?? "";
  for (const [prefix, label] of STRUCTURED) {
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
        return title ? `${label}: ${String(title).trim()}` : label;
      } catch {
        return label;
      }
    }
  }
  if (text.trim()) return !full && text.length > 280 ? `${text.slice(0, 280)}…` : text;
  if (message.attachment)
    return message.attachment.mimeType.startsWith("image/")
      ? `Image · ${message.attachment.name}`
      : `File · ${message.attachment.name}`;
  return "Message";
}
