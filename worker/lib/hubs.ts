// Hubs and rooms: access checks, room members, Hubs as sent to the client,
// voice counts, discovery signals and custom roles.

import {
  canAccessRoom as dbCanAccessRoom,
  getRole,
  userByReference,
  publicIdOf,
  nowIso,
  type HubRow,
  ensureGroupChatSchema,
  getOfficialHubPostingPolicy,
} from "../db";
import { safeJsonStringArray } from "../../shared/forum";
import type { Env } from "./env";
import { ensureHubFeatureSchema } from "./hub-schema";
import { ensureSquadFinderSchema } from "./squad";
import { ensureOfficialHubSchema, officialHubMembershipPrivate } from "./official-hubs";
import { streamerHubsEnabled } from "./streamer";
import { streamerMigrationExists, streamerLayoutForHub } from "../streamer/index.ts";
import { mediaUrl } from "./media";
import { type HubHomeConfig, normalizeHubHomeConfig } from "../../shared/hub-home";
import { realtimeFetch } from "./realtime";

export function cleanRoomName(value: unknown): string {
  if (typeof value !== "string") return "";
  return Array.from(
    value
      .normalize("NFC")
      .replace(/[\u0000-\u001f\u007f]/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  )
    .slice(0, 48)
    .join("");
}

export function cleanRoomIcon(value: unknown): string {
  if (typeof value !== "string") return "";
  return Array.from(
    value
      .normalize("NFC")
      .replace(/[\u0000-\u001f\u007f\s]/g, "")
      .trim(),
  )
    .slice(0, 4)
    .join("");
}

export async function ownedHubCount(db: D1Database, userId: string): Promise<number> {
  const row = await db
    .prepare("SELECT COUNT(*) AS count FROM decave_hubs WHERE owner_id=?")
    .bind(userId)
    .first<{ count: number }>();
  return Number(row?.count ?? 0);
}

export async function nextIntegerId(db: D1Database, table: "decave_hubs" | "decave_rooms"): Promise<number> {
  const row = await db.prepare(`SELECT COALESCE(MAX(id), 0) + 1 AS id FROM ${table}`).first<{ id: number }>();
  return Number(row?.id ?? 1);
}

export async function tagsForHub(db: D1Database, hubId: number): Promise<string[]> {
  const result = await db
    .prepare("SELECT tag FROM decave_hub_tags WHERE hub_id = ? ORDER BY tag")
    .bind(hubId)
    .all<{ tag: string }>();
  return result.results.map((row) => row.tag);
}

export async function canAccessRoom(
  db: D1Database,
  room: { id: number; hub_id: number; private: number },
  userId: string,
): Promise<boolean> {
  if (await dbCanAccessRoom(db, room as never, userId)) return true;
  if (room.private !== 1) return false;
  const role = await getRole(db, room.hub_id, userId);
  if (!role) return false;
  if (role === "owner" || role === "admin") return true;
  const grant = await db
    .prepare("SELECT 1 FROM decave_room_members WHERE room_id=? AND user_id=? LIMIT 1")
    .bind(room.id, userId)
    .first();
  return Boolean(grant);
}

export async function normalizedRoomMemberIds(db: D1Database, hubId: number, value: unknown): Promise<string[]> {
  if (!Array.isArray(value)) return [];
  const requested = Array.from(
    new Set(value.filter((item): item is string => typeof item === "string" && item.length <= 128)),
  );
  if (!requested.length) return [];
  const valid: string[] = [];
  for (const publicId of requested.slice(0, 500)) {
    const user = await userByReference(db, publicId);
    if (!user) continue;
    const role = await getRole(db, hubId, user.id);
    if (role === "member") valid.push(user.id);
  }
  return Array.from(new Set(valid));
}

export async function normalizedForumPostMemberIds(db: D1Database, hubId: number, value: unknown): Promise<string[]> {
  if (!Array.isArray(value)) return [];
  const requested = Array.from(
    new Set(value.filter((item): item is string => typeof item === "string" && item.length <= 128)),
  ).slice(0, 50);
  const valid: string[] = [];
  for (const publicId of requested) {
    const candidate = await userByReference(db, publicId);
    if (candidate && (await getRole(db, hubId, candidate.id))) valid.push(publicIdOf(candidate));
  }
  return valid;
}

export async function replaceRoomMembers(
  db: D1Database,
  roomId: number,
  hubId: number,
  actorId: string,
  value: unknown,
): Promise<void> {
  const ids = await normalizedRoomMemberIds(db, hubId, value);
  const statements = [db.prepare("DELETE FROM decave_room_members WHERE room_id=?").bind(roomId)];
  const stamp = nowIso();
  for (const id of ids)
    statements.push(
      db
        .prepare("INSERT INTO decave_room_members(room_id,user_id,granted_by,created_at) VALUES(?,?,?,?)")
        .bind(roomId, id, actorId, stamp),
    );
  await db.batch(statements);
}

export async function roomsForHub(db: D1Database, hubId: number, userId: string) {
  const result = await db
    .prepare(
      `SELECT id, hub_id, name, type, category, position, private, icon, kind,forum_guidelines,forum_post_policy,forum_post_role_ids_json,forum_post_member_ids_json,forum_tags_json
       FROM decave_rooms
       WHERE hub_id = ?
       ORDER BY position, id`,
    )
    .bind(hubId)
    .all<{
      id: number;
      hub_id: number;
      name: string;
      type: "text" | "voice";
      kind: "chat" | "forum";
      category: string;
      position: number;
      private: number;
      icon: string;
      forum_guidelines: string;
      forum_post_policy: "everyone" | "staff" | "roles" | "members";
      forum_post_role_ids_json: string;
      forum_post_member_ids_json: string;
      forum_tags_json: string;
    }>();
  const visible = [];
  for (const room of result.results) {
    if (await canAccessRoom(db, room, userId))
      visible.push({
        ...room,
        type: room.kind === "forum" ? "forum" : room.type,
        private: room.private === 1,
        forumGuidelines: room.forum_guidelines,
        forumPostPolicy: room.forum_post_policy,
        forumPostRoleIds: safeJsonStringArray(room.forum_post_role_ids_json),
        forumPostMemberIds: safeJsonStringArray(room.forum_post_member_ids_json),
        forumTags: safeJsonStringArray(room.forum_tags_json),
      });
  }
  return visible;
}

export async function memberCount(db: D1Database, hubId: number): Promise<number> {
  const row = await db
    .prepare("SELECT COUNT(*) AS count FROM decave_hub_members WHERE hub_id = ?")
    .bind(hubId)
    .first<{ count: number }>();
  return Number(row?.count ?? 0);
}

export async function hubForUser(env: Env, hub: HubRow, userId: string, streamerHubIds?: ReadonlySet<number>) {
  await ensureHubFeatureSchema(env);
  await ensureGroupChatSchema(env.DB);
  await ensureSquadFinderSchema(env);
  await ensureOfficialHubSchema(env);
  const ringRow = await env.DB.prepare(
    "SELECT icon_ring,theme,use_banner_background,chat_background_key,use_chat_background FROM decave_hubs WHERE id=?",
  )
    .bind(hub.id)
    .first<{
      icon_ring: number;
      theme: string;
      use_banner_background: number;
      chat_background_key: string | null;
      use_chat_background: number;
    }>();
  const home = await hubHomeConfig(env, hub.id);
  const squadRow = await env.DB.prepare("SELECT 1 AS found FROM decave_squad_rooms WHERE hub_id=? LIMIT 1")
    .bind(hub.id)
    .first<{ found: number }>();
  const myRole = await getRole(env.DB, hub.id, userId);
  const membershipPrivate = await officialHubMembershipPrivate(env.DB, hub.id);
  const postingPolicy = await getOfficialHubPostingPolicy(env.DB, hub.id);
  const canSeeMembership = !membershipPrivate || myRole === "owner";
  let layout: "standard" | "streamer" = "standard";
  if (streamerHubIds) {
    layout = streamerHubIds.has(hub.id) ? "streamer" : "standard";
  } else if (streamerHubsEnabled(env) && (await streamerMigrationExists(env.DB))) {
    try {
      layout = await streamerLayoutForHub(env.DB, hub.id);
    } catch (error) {
      console.error("Could not read Streamer Hub layout", error instanceof Error ? error.name : "UnknownError");
    }
  }
  return {
    id: hub.id,
    name: hub.name,
    icon: hub.icon,
    channels: await roomsForHub(env.DB, hub.id, userId),
    ownerId:
      (
        await env.DB.prepare("SELECT public_id FROM decave_users WHERE id=?")
          .bind(hub.owner_id)
          .first<{ public_id: string | null }>()
      )?.public_id ?? "",
    myRole,
    visibility: hub.visibility,
    memberCount: canSeeMembership ? await memberCount(env.DB, hub.id) : null,
    onlineCount: canSeeMembership ? await onlineCountForHub(env, hub.id) : null,
    description: hub.description,
    accent: hub.accent,
    category: hub.category,
    tags: await tagsForHub(env.DB, hub.id),
    slowModeSeconds: hub.slow_mode_seconds,
    iconUrl: mediaUrl(hub.icon_key),
    bannerUrl: mediaUrl(hub.banner_key),
    chatBackgroundUrl: mediaUrl(ringRow?.chat_background_key ?? null),
    iconRing: Number(ringRow?.icon_ring ?? 0) === 1,
    theme: ringRow?.theme ?? "midnight",
    useBannerBackground: Number(ringRow?.use_banner_background ?? 0) === 1,
    useChatBackground: Number(ringRow?.use_chat_background ?? 0) === 1,
    isSquad: Boolean(squadRow?.found),
    ownerOnlyPosting: postingPolicy.status === "unavailable" ? true : postingPolicy.ownerOnly,
    membershipPrivate,
    layout,
    home,
  };
}

/** The Hub Home layout, Welcome message and Rules (defaults when never edited). */
export async function hubHomeConfig(env: Env, hubId: number): Promise<HubHomeConfig> {
  try {
    const row = await env.DB.prepare("SELECT sections_json, welcome, rules FROM decave_hub_home WHERE hub_id=?")
      .bind(hubId)
      .first<{ sections_json: string; welcome: string; rules: string }>();
    let sections: unknown = [];
    try {
      sections = row ? JSON.parse(row.sections_json) : [];
    } catch {
      sections = [];
    }
    return normalizeHubHomeConfig({ sections, welcome: row?.welcome ?? "", rules: row?.rules ?? "" });
  } catch (error) {
    console.warn("Hub Home config unavailable", error instanceof Error ? error.name : "UnknownError");
    return normalizeHubHomeConfig({});
  }
}

/** Distinct users in each voice room, from the realtime Durable Object. Empty on failure. */
export async function voiceCountsForRooms(env: Env, channelIds: number[]): Promise<Map<number, number>> {
  const counts = new Map<number, number>();
  if (!channelIds.length) return counts;
  try {
    const response = await realtimeFetch(env, "/internal/voice-counts", { channelIds });
    if (!response.ok) return counts;
    const data = (await response.json()) as { counts?: Record<string, number> };
    for (const [id, n] of Object.entries(data.counts ?? {})) counts.set(Number(id), Number(n) || 0);
  } catch (error) {
    console.warn("Voice counts unavailable", error instanceof Error ? error.name : "UnknownError");
  }
  return counts;
}

/**
 * Discover signals for a set of Hubs: which of the viewer's friends are
 * members (usernames, alphabetical) and how many people are in non-private
 * voice rooms right now. Each part fails soft so Discover still loads.
 */
export async function discoverSignals(
  env: Env,
  userId: string,
  hubIds: number[],
): Promise<{ friends: Map<number, string[]>; voice: Map<number, number> }> {
  const friends = new Map<number, string[]>();
  const voice = new Map<number, number>();
  if (!hubIds.length) return { friends, voice };
  const wanted = new Set(hubIds);
  try {
    const rows = await env.DB.prepare(
      `SELECT hm.hub_id AS hub_id, u.username AS username
       FROM decave_hub_members hm
       JOIN decave_users u ON u.id=hm.user_id
       WHERE hm.user_id IN (
         SELECT CASE WHEN user_a=? THEN user_b ELSE user_a END FROM decave_friendships WHERE user_a=? OR user_b=?
       )
       ORDER BY hm.hub_id, u.username COLLATE NOCASE`,
    )
      .bind(userId, userId, userId)
      .all<{ hub_id: number; username: string }>();
    for (const row of rows.results) {
      const hubId = Number(row.hub_id);
      if (!wanted.has(hubId) || !row.username) continue;
      const list = friends.get(hubId) ?? [];
      list.push(row.username);
      friends.set(hubId, list);
    }
  } catch (error) {
    console.warn("Discover: friend signals unavailable", error instanceof Error ? error.name : "UnknownError");
  }
  try {
    const rooms = await env.DB.prepare(
      `SELECT id, hub_id FROM decave_rooms WHERE type='voice' AND private=0 AND hub_id IN (${hubIds.map(() => "?").join(",")})`,
    )
      .bind(...hubIds)
      .all<{ id: number; hub_id: number }>();
    const hubByRoom = new Map(rooms.results.map((room) => [Number(room.id), Number(room.hub_id)] as const));
    const counts = await voiceCountsForRooms(env, [...hubByRoom.keys()]);
    for (const [roomId, n] of counts) {
      const hubId = hubByRoom.get(roomId);
      if (hubId !== undefined) voice.set(hubId, (voice.get(hubId) ?? 0) + n);
    }
  } catch (error) {
    console.warn("Discover: voice signals unavailable", error instanceof Error ? error.name : "UnknownError");
  }
  return { friends, voice };
}

export async function onlineCountForHub(env: Env, hubId: number): Promise<number> {
  const response = await realtimeFetch(env, "/internal/count", { hubId });
  if (!response.ok) return 0;
  const data = (await response.json()) as { count?: number };
  return Number(data.count ?? 0);
}

export const CUSTOM_ROLE_PERMISSIONS = [
  "manageRooms",
  "moderateMessages",
  "moderateMembers",
  "voiceModerate",
  "createInvites",
  "viewAudit",
  "manageEvents",
] as const;

/** B12: forum policy role ids must be custom roles of this Hub. Returns null when any id is foreign. */
export async function validatedHubRoleIds(
  db: D1Database,
  hubId: number,
  value: unknown,
  max = 12,
): Promise<string[] | null> {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return null;
  const ids = Array.from(
    new Set(value.filter((x): x is string => typeof x === "string" && x.length > 0 && x.length <= 128)),
  );
  if (ids.length !== value.length || ids.length > max) return null;
  if (!ids.length) return [];
  const rows = await db
    .prepare(`SELECT id FROM decave_custom_roles WHERE hub_id=? AND id IN (${ids.map(() => "?").join(",")})`)
    .bind(hubId, ...ids)
    .all<{ id: string }>();
  return rows.results.length === ids.length ? ids : null;
}

/** B12: forum policy member ids must be public ids of current Hub members. */
export async function validatedHubMemberPublicIds(
  db: D1Database,
  hubId: number,
  value: unknown,
  max = 50,
): Promise<string[] | null> {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return null;
  const requested = Array.from(
    new Set(value.filter((x): x is string => typeof x === "string" && x.length > 0 && x.length <= 128)),
  );
  if (requested.length !== value.length || requested.length > max) return null;
  const valid = await normalizedForumPostMemberIds(db, hubId, requested);
  return valid.length === requested.length ? valid : null;
}
