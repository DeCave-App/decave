// Hub bots: capabilities, the rooms a bot may post in, and bots as sent to the
// client.

import { getRoom } from "../db";
import { canAccessRoom } from "./hubs";

export const HUB_BOT_CAPABILITIES = ["send_messages", "create_polls", "create_events"] as const;

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
