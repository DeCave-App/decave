/** Shared, dependency-free contracts for DeCave's opt-in Streamer hub layout. */
export const STREAMER_LAYOUT = "streamer" as const;
export type HubLayout = "standard" | typeof STREAMER_LAYOUT;
export type HubRole = "owner" | "admin" | "member";
export type QueueStatus = "waiting" | "called" | "ready" | "playing" | "done" | "skipped" | "left";
export type SessionStatus = "open" | "paused" | "ended";
export type FeatureFlags = { giveaways: boolean };

export type StreamerConfig = {
  creatorName: string;
  tagline: string;
  streamTitle: string;
  game: string;
  language: string;
  /** Manual, expiring community status; it does not connect to a broadcast service. */
  liveUntil: string | null;
  queueRules: string;
  onboarding: string;
  version: number;
};
export type CommunitySession = {
  id: string;
  title: string;
  game: string;
  status: SessionStatus;
  partySize: number;
  readySeconds: number;
  createdAt: string;
  version: number;
};
export type QueueEntry = {
  id: string;
  name: string;
  status: QueueStatus;
  joinedAt: string;
  callExpiresAt: string | null;
  position: number | null;
};
export type QueueSummary = {
  waiting: number;
  called: number;
  ready: number;
  playing: number;
  mine: QueueEntry | null;
};
export type Giveaway = {
  id: string;
  title: string;
  rules: string;
  closesAt: string;
  status: "open" | "drawn" | "cancelled";
  entryCount: number;
  entered: boolean;
  winnerName: string | null;
};
export type StreamerStats = {
  memberCount: number;
  joinedLast7Days: number;
  sessionsLast7Days: number;
  playersLast7Days: number;
  seatsCompletedLast7Days: number;
};
export type StreamerSnapshot = {
  enabled: boolean;
  role: HubRole;
  config: StreamerConfig;
  session: CommunitySession | null;
  queue: QueueSummary;
  giveaways: Giveaway[];
  /** Absent from member responses, not merely hidden with CSS. */
  stats?: StreamerStats;
  features: FeatureFlags;
  serverTime: string;
};
export type StreamerEvent = {
  id: string;
  title: string;
  startAt: string;
  description?: string;
  /** Adapter to the existing Hub calendar; no second event database. */
  channelId?: number;
};
export type QueuePage = { entries: QueueEntry[]; nextCursor: string | null };

export const DEFAULT_STREAMER_CONFIG: StreamerConfig = {
  creatorName: "",
  tagline: "Good games. Better people.",
  streamTitle: "",
  game: "",
  language: "",
  liveUntil: null,
  queueRules: "Be ready when called. Accept the ready check before joining voice. One turn per session.",
  onboarding: "Welcome! Read this hub's rules, introduce yourself, and join a community activity.",
  version: 1,
};

/** Structurally compatible with shared/hub-templates.ts; add this to its existing array. */
export const STREAMER_HUB_TEMPLATE = {
  id: "streamer" as const,
  name: "Streamer Mode · Overview layout",
  description: "Creator Overview, community sessions, events, and a full-height Hub banner.",
  rooms: [
    { name: "announcements", type: "text" as const, category: "STREAMER HUB", icon: "📣" },
    { name: "general", type: "text" as const, category: "STREAMER HUB", icon: "💬" },
    { name: "clips", type: "forum" as const, category: "STREAMER HUB", icon: "🎬" },
    { name: "suggestions", type: "forum" as const, category: "STREAMER HUB", icon: "💡" },
    { name: "Streamer Room", type: "voice" as const, category: "VOICE ROOMS", icon: "🎙️", private: true },
    { name: "General Voice", type: "voice" as const, category: "VOICE ROOMS", icon: "🔊" },
  ],
};

export class StreamerInputError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "StreamerInputError";
    this.status = status;
  }
}
export function objectBody(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new StreamerInputError("Expected a JSON object.");
  return value as Record<string, unknown>;
}
export function text(value: unknown, field: string, max: number, required = true): string {
  if (typeof value !== "string") throw new StreamerInputError(`${field} must be text.`);
  const result = value.trim();
  if ((required && !result) || result.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(result)) {
    throw new StreamerInputError(`${field} must be ${required ? "1" : "0"}–${max} characters.`);
  }
  return result;
}
export function integer(value: unknown, field: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new StreamerInputError(`${field} must be an integer from ${min} to ${max}.`);
  }
  return value;
}
export function identifier(value: unknown): string {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{1,80}$/.test(value))
    throw new StreamerInputError("Invalid identifier.");
  return value;
}
export function isCreator(role: HubRole): boolean {
  return role === "owner" || role === "admin";
}
export function isLive(config: StreamerConfig, now = Date.now()): boolean {
  return Boolean(config.liveUntil && Date.parse(config.liveUntil) > now);
}
/** Existing DeCave media only. It must additionally pass the host's media-access check. */
export function localMediaPath(value: unknown): string {
  const raw = text(value, "Image", 600, false);
  if (!raw) return "";
  if (!/^\/api\/media\/[a-zA-Z0-9_./%~-]+(?:\?v=[a-zA-Z0-9_.:-]+)?$/.test(raw)) {
    throw new StreamerInputError("Choose an image already uploaded to this DeCave Hub.");
  }
  let key: string;
  try {
    key = decodeURIComponent(raw.split("?")[0].slice("/api/media/".length));
  } catch {
    throw new StreamerInputError("Invalid media path.");
  }
  // Existing DeCave routes encode R2 keys using encodeURIComponent, including slashes.
  // Decode once, reject traversal and double-encoding, then retain the original URL.
  if (!/^[a-zA-Z0-9_./~-]+$/.test(key) || key.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new StreamerInputError("Invalid media path.");
  }
  return raw;
}
export function configInput(body: Record<string, unknown>, now: number): Omit<StreamerConfig, "version"> {
  const liveHours = integer(body.liveHours ?? 0, "Live duration", 0, 12);
  return {
    creatorName: text(body.creatorName, "Creator name", 80, false),
    tagline: text(body.tagline, "Tagline", 160, false),
    streamTitle: text(body.streamTitle, "Stream title", 140, false),
    game: text(body.game, "Game", 80, false),
    language: text(body.language, "Language", 40, false),
    liveUntil: liveHours ? new Date(now + liveHours * 3_600_000).toISOString() : null,
    queueRules: text(body.queueRules, "Queue rules", 1600, false),
    onboarding: text(body.onboarding, "Welcome text", 1600, false),
  };
}
export function sessionInput(body: Record<string, unknown>) {
  return {
    title: text(body.title, "Session title", 100),
    game: text(body.game, "Game", 80),
    partySize: integer(body.partySize, "Viewer slots", 1, 16),
    readySeconds: integer(body.readySeconds, "Ready-check time", 30, 300),
  };
}
export function futureDate(value: unknown, field: string, now: number, maxDays = 30): string {
  const raw = text(value, field, 40);
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms) || ms < now + 60_000 || ms > now + maxDays * 86_400_000) {
    throw new StreamerInputError(`${field} must be between one minute and ${maxDays} days from now.`);
  }
  return new Date(ms).toISOString();
}
/** Rejection sampling avoids modulo bias. Injectable only for deterministic tests. */
export function unbiasedIndex(length: number, random = () => crypto.getRandomValues(new Uint32Array(1))[0]): number {
  integer(length, "Entry count", 1, 5000);
  const ceiling = Math.floor(0x1_0000_0000 / length) * length;
  let value: number;
  do {
    value = random();
  } while (value >= ceiling);
  return value % length;
}
