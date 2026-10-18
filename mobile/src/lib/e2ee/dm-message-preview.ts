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

// Mirrors parseVoiceNoteMeta/formatVoiceDuration in voice-note.ts; kept inline because this file is
// copied byte-for-byte into the mobile app, where voice-note.ts sits in a different folder.
function voiceDuration(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const { ms, wave } = value as { ms?: unknown; wave?: unknown };
  // Same bounds as parseVoiceNoteMeta: a hostile sender can't show a silly duration.
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms <= 0 || ms > 120000 || typeof wave !== "string") return null;
  const total = Math.ceil(ms / 1000);
  const seconds = total % 60;
  return `${Math.floor(total / 60)}:${seconds < 10 ? "0" : ""}${seconds}`;
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
  voice: (duration: string) => string;
  message: () => string;
  encrypted: () => string;
};

export const ENGLISH_DM_PREVIEW_LABELS: DmPreviewLabels = {
  gif: () => "GIF",
  attachment: () => "📎 Attachment",
  namedAttachment: (name) => `📎 ${name}`,
  poll: () => "Poll",
  pollQuestion: (question) => `Poll: ${question}`,
  voice: (duration) => `🎤 Voice message (${duration})`,
  message: () => "Message",
  encrypted: () => "🔒 Encrypted message",
};

/** One-line list preview for a DM or group message, so payload JSON (and attachment file keys) never reach the UI. */
export function dmPreviewText(text: string, labels: DmPreviewLabels = ENGLISH_DM_PREVIEW_LABELS): string {
  if (parsePrefixed<{ url?: unknown }>(text, GIF_PREFIX)) return labels.gif();
  const attachment = parsePrefixed<{ name?: unknown; voice?: unknown }>(text, DM_ATTACHMENT_PREFIX);
  const duration = attachment ? voiceDuration(attachment.voice) : null;
  if (duration) return labels.voice(duration);
  if (attachment)
    return typeof attachment.name === "string" && attachment.name
      ? labels.namedAttachment(attachment.name)
      : labels.attachment();
  const poll = parsePrefixed<{ question?: unknown }>(text, POLL_PREFIX);
  if (poll) return typeof poll.question === "string" ? labels.pollQuestion(poll.question) : labels.poll();
  if (text.startsWith("__DECAVE_")) return labels.message();
  return text;
}
