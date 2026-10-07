// Per-Hub and per-room notification levels (Settings → Notifications).
// A room can override its Hub; a Hub without a choice uses "mentions", which is
// how DeCave behaved before levels existed.

export type NotifyLevel = "all" | "mentions" | "nothing";
export type RoomNotifyLevel = NotifyLevel | "default";

export type NotifyLevels = {
  hubs: Record<string, NotifyLevel>;
  rooms: Record<string, NotifyLevel>;
};

export const DEFAULT_NOTIFY_LEVEL: NotifyLevel = "mentions";
export const EMPTY_NOTIFY_LEVELS: NotifyLevels = { hubs: {}, rooms: {} };

const LEVELS: readonly NotifyLevel[] = ["all", "mentions", "nothing"];

function cleanMap(value: unknown, limit: number): Record<string, NotifyLevel> {
  const out: Record<string, NotifyLevel> = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return out;
  for (const [key, level] of Object.entries(value as Record<string, unknown>).slice(0, limit)) {
    if (/^\d{1,12}$/.test(key) && LEVELS.includes(level as NotifyLevel)) out[key] = level as NotifyLevel;
  }
  return out;
}

export function normalizeNotifyLevels(value: unknown): NotifyLevels {
  const raw = (value && typeof value === "object" ? value : {}) as Partial<Record<"hubs" | "rooms", unknown>>;
  return { hubs: cleanMap(raw.hubs, 500), rooms: cleanMap(raw.rooms, 2000) };
}

export function hubNotifyLevel(levels: NotifyLevels, hubId: number): NotifyLevel {
  return levels.hubs[String(hubId)] ?? DEFAULT_NOTIFY_LEVEL;
}

export function roomNotifyOverride(levels: NotifyLevels, roomId: number): RoomNotifyLevel {
  return levels.rooms[String(roomId)] ?? "default";
}

/** The level that applies to a message in this room of this Hub. */
export function effectiveNotifyLevel(levels: NotifyLevels, hubId: number, roomId: number): NotifyLevel {
  return levels.rooms[String(roomId)] ?? hubNotifyLevel(levels, hubId);
}

/**
 * What a new Hub message should do. `mentioned` covers @you and @everyone.
 * Badges are counted separately and are never affected by levels.
 */
export function notifyDecision(level: NotifyLevel, mentioned: boolean): { notify: boolean; sound: boolean } {
  if (level === "nothing") return { notify: false, sound: false };
  if (level === "all") return { notify: true, sound: true };
  return { notify: mentioned, sound: mentioned };
}

export function withHubLevel(levels: NotifyLevels, hubId: number, level: NotifyLevel): NotifyLevels {
  const hubs = { ...levels.hubs };
  if (level === DEFAULT_NOTIFY_LEVEL) delete hubs[String(hubId)];
  else hubs[String(hubId)] = level;
  return { ...levels, hubs };
}

export function withRoomLevel(levels: NotifyLevels, roomId: number, level: RoomNotifyLevel): NotifyLevels {
  const rooms = { ...levels.rooms };
  if (level === "default") delete rooms[String(roomId)];
  else rooms[String(roomId)] = level;
  return { ...levels, rooms };
}
