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

/** One-line list preview for a DM or group message, so payload JSON (and attachment file keys) never reach the UI. */
export function dmPreviewText(text: string): string {
  if (parsePrefixed<{ url?: unknown }>(text, GIF_PREFIX)) return "GIF";
  const attachment = parsePrefixed<{ name?: unknown }>(text, DM_ATTACHMENT_PREFIX);
  if (attachment)
    return typeof attachment.name === "string" && attachment.name ? `📎 ${attachment.name}` : "📎 Attachment";
  const poll = parsePrefixed<{ question?: unknown }>(text, POLL_PREFIX);
  if (poll) return typeof poll.question === "string" ? `Poll: ${poll.question}` : "Poll";
  if (text.startsWith("__DECAVE_")) return "Message";
  return text;
}
