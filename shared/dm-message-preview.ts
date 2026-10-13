// Payload prefixes match the web client (src/app/message-payloads.ts) and the mobile app (src/lib/chat-media.ts).
const GIF_PREFIX = "__DECAVE_GIF__";
const DM_ATTACHMENT_PREFIX = "__DECAVE_DM_ATTACHMENT__";
const POLL_PREFIX = "__DECAVE_POLL__";

function parsePrefixed<T>(text: string, prefix: string): T | null {
  if (!text.startsWith(prefix)) return null;
  try {
    const value = JSON.parse(text.slice(prefix.length)) as unknown;
    return value && typeof value === "object" ? (value as T) : null;
  } catch {
    return null;
  }
}

/**
 * Words the previews add around the message. Apps that translate pass their own
 * (catalog keys under dm.preview); the English is the default.
 */
export type DmPreviewLabels = {
  gif: () => string;
  attachment: () => string;
  namedAttachment: (name: string) => string;
  poll: () => string;
  pollQuestion: (question: string) => string;
  message: () => string;
  encrypted: () => string;
};

export const ENGLISH_DM_PREVIEW_LABELS: DmPreviewLabels = {
  gif: () => "GIF",
  attachment: () => "📎 Attachment",
  namedAttachment: (name) => `📎 ${name}`,
  poll: () => "Poll",
  pollQuestion: (question) => `Poll: ${question}`,
  message: () => "Message",
  encrypted: () => "🔒 Encrypted message",
};

/** One-line list preview for a DM or group message, so payload JSON (and attachment file keys) never reach the UI. */
export function dmPreviewText(text: string, labels: DmPreviewLabels = ENGLISH_DM_PREVIEW_LABELS): string {
  if (parsePrefixed<{ url?: unknown }>(text, GIF_PREFIX)) return labels.gif();
  const attachment = parsePrefixed<{ name?: unknown }>(text, DM_ATTACHMENT_PREFIX);
  if (attachment)
    return typeof attachment.name === "string" && attachment.name
      ? labels.namedAttachment(attachment.name)
      : labels.attachment();
  const poll = parsePrefixed<{ question?: unknown }>(text, POLL_PREFIX);
  if (poll) return typeof poll.question === "string" ? labels.pollQuestion(poll.question) : labels.poll();
  if (text.startsWith("__DECAVE_")) return labels.message();
  return text;
}
