// Which phone notifications to send, decided on the server from the settings
// each account syncs (Settings → Notifications on any device): per-Hub and
// per-room levels, muted Hubs, quiet hours in the user's own time zone, the
// DM / mention switches, and how much of the message the preview may show.
// Missing or invalid preview preferences fail closed to hidden text.

export type PushKind = "dm" | "mention" | "room";
export type PushPreview = "full" | "sender" | "hidden";
type Level = "all" | "mentions" | "nothing";

export type PushSettings = {
  notifications: { enabled: boolean; dms: boolean; mentions: boolean; hubMessages: boolean };
  hubs: Record<string, Level>;
  rooms: Record<string, Level>;
  mutedHubs: Record<string, number>;
  quiet: { enabled: boolean; start: string; end: string; allowMentions: boolean };
  timeZone: string;
  preview: PushPreview;
};

const LEVELS = new Set(["all", "mentions", "nothing"]);
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

function obj(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function levels(value: unknown): Record<string, Level> {
  const out: Record<string, Level> = {};
  for (const [key, level] of Object.entries(obj(value)))
    if (/^\d{1,12}$/.test(key) && LEVELS.has(level as string)) out[key] = level as Level;
  return out;
}

function validTimeZone(value: unknown): string {
  if (typeof value !== "string" || !value || value.length > 64) return "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return value;
  } catch {
    return "UTC";
  }
}

/** Read an account's client_settings_json into the parts push cares about. */
export function pushSettingsFromJson(json: string | null | undefined): PushSettings {
  let raw: Record<string, unknown> = {};
  try {
    raw = obj(JSON.parse(json || "{}"));
  } catch {
    raw = {};
  }
  const notifications = obj(raw.notifications);
  const notifyLevels = obj(raw.notifyLevels);
  const quiet = obj(obj(raw.extra).quietHours);
  const mutedHubs: Record<string, number> = {};
  for (const [key, until] of Object.entries(obj(raw.mutedHubs))) {
    if (/^\d{1,12}$/.test(key) && Number.isFinite(Number(until))) mutedHubs[key] = Number(until);
  }
  const preview = obj(raw.privacy).notificationPreview;
  return {
    notifications: {
      enabled: notifications.enabled !== false,
      dms: notifications.dms !== false,
      mentions: notifications.mentions !== false,
      hubMessages: notifications.hubMessages !== false,
    },
    hubs: levels(notifyLevels.hubs),
    rooms: levels(notifyLevels.rooms),
    mutedHubs,
    quiet: {
      enabled: quiet.enabled === true,
      start: typeof quiet.start === "string" && TIME.test(quiet.start) ? quiet.start : "23:00",
      end: typeof quiet.end === "string" && TIME.test(quiet.end) ? quiet.end : "08:00",
      allowMentions: quiet.allowMentions !== false,
    },
    timeZone: validTimeZone(raw.timeZone),
    preview: preview === "sender" || preview === "full" ? preview : "hidden",
  };
}

/** Minutes since local midnight in `timeZone`. */
export function localMinutes(now: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? 0);
  return (hour % 24) * 60 + minute;
}

function inQuietHours(settings: PushSettings, now: Date): boolean {
  if (!settings.quiet.enabled) return false;
  const toMinutes = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
  const start = toMinutes(settings.quiet.start);
  const end = toMinutes(settings.quiet.end);
  const current = localMinutes(now, settings.timeZone);
  if (start === end) return true;
  return start < end ? current >= start && current < end : current >= start || current < end;
}

export type PushContext = { kind: PushKind; hubId?: number; roomId?: number; now?: Date };

/** Should this person's phones get this notification? */
export function shouldPush(settings: PushSettings, context: PushContext): boolean {
  const now = context.now ?? new Date();
  if (!settings.notifications.enabled) return false;
  if (context.kind === "dm") {
    if (!settings.notifications.dms) return false;
  } else {
    if (!settings.notifications.hubMessages) return false;
    const hubKey = String(context.hubId ?? "");
    const until = settings.mutedHubs[hubKey];
    if (until !== undefined && (until === -1 || until > now.getTime())) return false;
    const level = settings.rooms[String(context.roomId ?? "")] ?? settings.hubs[hubKey] ?? "mentions";
    if (level === "nothing") return false;
    if (context.kind === "room" && level !== "all") return false;
    if (context.kind === "mention" && !settings.notifications.mentions) return false;
  }
  if (inQuietHours(settings, now)) {
    const important = context.kind === "dm" || context.kind === "mention";
    if (!(important && settings.quiet.allowMentions)) return false;
  }
  return true;
}

/** Title and body as the person's preview setting allows. */
export function pushText(
  settings: PushSettings,
  sender: string,
  where: string | null,
  text: string,
): { title: string; body: string } {
  if (settings.preview === "hidden")
    return { title: "DeCave", body: where ? "New message in a Hub" : "You have a new message" };
  if (settings.preview === "sender")
    return { title: where ?? sender, body: where ? `${sender} sent a message` : `${sender} sent you a message` };
  return { title: where ? `${sender} in ${where}` : sender, body: text };
}

/** Load push settings for these accounts in one query. */
export async function loadPushSettings(db: D1Database, userIds: readonly string[]): Promise<Map<string, PushSettings>> {
  const out = new Map<string, PushSettings>();
  if (!userIds.length) return out;
  try {
    for (let i = 0; i < userIds.length; i += 90) {
      const chunk = userIds.slice(i, i + 90);
      const rows = await db
        .prepare(
          `SELECT user_id, client_settings_json FROM decave_account_preferences WHERE user_id IN (${chunk.map(() => "?").join(",")})`,
        )
        .bind(...chunk)
        .all<{ user_id: string; client_settings_json: string | null }>();
      for (const row of rows.results) out.set(row.user_id, pushSettingsFromJson(row.client_settings_json));
    }
  } catch {
    // Before migration 0061 there is nothing synced; everyone gets the defaults.
  }
  for (const id of userIds) if (!out.has(id)) out.set(id, pushSettingsFromJson(null));
  return out;
}

/**
 * Rows in decave_push_subscriptions for one account: the Hubs and rooms set to
 * "All messages", so a new message can find who wants every message without
 * reading every member's settings.
 */
export function allMessageSubscriptions(
  settings: PushSettings,
): Array<{ hubId: number | null; roomId: number | null }> {
  const rows: Array<{ hubId: number | null; roomId: number | null }> = [];
  for (const [hub, level] of Object.entries(settings.hubs))
    if (level === "all") rows.push({ hubId: Number(hub), roomId: null });
  for (const [room, level] of Object.entries(settings.rooms))
    if (level === "all") rows.push({ hubId: null, roomId: Number(room) });
  return rows.slice(0, 500);
}
