// Hub bots: capabilities, the rooms a bot may post in, and bots as sent to the
// client.

import { getRoom, nowIso } from "../db";
import type { Env } from "./env";
import { canAccessRoom } from "./hubs";
import { messageForClient } from "./messages";
import { realtimeBroadcast } from "./realtime";

export const HUB_BOT_CAPABILITIES = [
  "send_messages",
  "create_polls",
  "create_events",
  "manage_roles",
  "manage_messages",
  "webhooks",
] as const;

export type HubBotCapability = (typeof HUB_BOT_CAPABILITIES)[number];

export function isHubBotCapability(value: unknown): value is HubBotCapability {
  return typeof value === "string" && (HUB_BOT_CAPABILITIES as readonly string[]).includes(value);
}

export function normalizeHubBotCapabilities(
  value: unknown,
  fallback: HubBotCapability[] = ["send_messages"],
): HubBotCapability[] {
  if (!Array.isArray(value)) return [...fallback];
  return Array.from(new Set(value.filter(isHubBotCapability))).slice(0, HUB_BOT_CAPABILITIES.length);
}

export function storedHubBotCapabilities(value: string | null | undefined): HubBotCapability[] {
  try {
    return normalizeHubBotCapabilities(JSON.parse(value || "[]"));
  } catch {
    return ["send_messages"];
  }
}

export function storedHubBotRoomIds(value: string | null | undefined): number[] {
  try {
    const parsed: unknown = JSON.parse(value || "[]");
    if (!Array.isArray(parsed)) return [];
    return Array.from(new Set(parsed.filter((item): item is number => Number.isSafeInteger(item) && item > 0)));
  } catch {
    return [];
  }
}

export async function validateHubBotRoomIds(
  db: D1Database,
  hubId: number,
  actorId: string,
  value: unknown,
): Promise<number[] | null> {
  if (!Array.isArray(value) || value.length > 100) return null;
  const requested = Array.from(new Set(value.filter((item): item is number => Number.isSafeInteger(item) && item > 0)));
  if (requested.length !== value.length) return null;
  const valid: number[] = [];
  for (const roomId of requested) {
    const room = await getRoom(db, roomId);
    if (!room || room.hub_id !== hubId || room.type !== "text" || !(await canAccessRoom(db, room, actorId)))
      return null;
    valid.push(roomId);
  }
  return valid;
}

export type HubBotRecord = {
  id: string;
  hub_id: number;
  name: string;
  description: string | null;
  enabled: number;
  capabilities: string | null;
  allowed_room_ids: string | null;
  created_at: string;
};

export function hubBotForClient(row: HubBotRecord) {
  return {
    id: row.id,
    hubId: Number(row.hub_id),
    name: row.name,
    description: row.description ?? "",
    enabled: row.enabled === 1,
    capabilities: storedHubBotCapabilities(row.capabilities),
    allowedRoomIds: storedHubBotRoomIds(row.allowed_room_ids),
    createdAt: row.created_at,
  };
}

export const BOT_MESSAGE_PREFIX = "__DECAVE_BOT__";

/** Plain bot text as stored: wrapped so current clients render it as a bot message. */
export function botMessageText(bot: { id: string; name: string }, text: string): string {
  return `${BOT_MESSAGE_PREFIX}${JSON.stringify({ botId: bot.id, name: bot.name, text })}`;
}

/**
 * Inserts a bot message and broadcasts it. `text` is stored as given (see
 * botMessageText). Callers have already checked the room, the author's access
 * and any rate limit. A private notice is broadcast only to its one viewer.
 * Never dispatches bot events: bot output must not re-trigger bots here.
 */
export async function postBotMessage(
  env: Env,
  input: {
    hubId: number;
    roomId: number;
    botId: string;
    authorUserId: string;
    text: string;
    card?: unknown;
    visibleToUserId?: string | null;
    replyToId?: string | null;
  },
) {
  const id = crypto.randomUUID();
  const visibleTo = input.visibleToUserId ?? null;
  await env.DB.prepare(
    `INSERT INTO decave_messages(id,room_id,hub_id,author_user_id,text,created_at,reply_to_id,bot_id,card_json,visible_to_user_id)
     VALUES(?,?,?,?,?,?,?,?,?,?)`,
  )
    .bind(
      id,
      input.roomId,
      input.hubId,
      input.authorUserId,
      input.text,
      nowIso(),
      input.replyToId ?? null,
      input.botId,
      input.card ? JSON.stringify(input.card) : null,
      visibleTo,
    )
    .run();
  const message = await messageForClient(env, id, visibleTo);
  if (!message) return null;
  await realtimeBroadcast(
    env,
    { type: "CHAT_MESSAGE", ...message },
    visibleTo ? { channelId: input.roomId, userIds: [visibleTo] } : { channelId: input.roomId },
  );
  return message;
}
