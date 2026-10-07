// Friends and group chats: social state and group chat messages as sent to the
// client.

import type { Env } from "./env";
import { type UserRow, publicUserWithPresence, ensureGroupChatSchema, type GroupChatRow, publicIdOf } from "../db";
import { realtimeFetch } from "./realtime";
import { DM_GROUP_MAX_WRAPS, parseDmEnvelope } from "../../shared/dm-e2ee-format";

export async function usersHaveMutualFriend(db: D1Database, firstId: string, secondId: string): Promise<boolean> {
  const mutual = await db
    .prepare(
      `WITH first_friends AS (
       SELECT CASE WHEN user_a=? THEN user_b ELSE user_a END AS friend_id
       FROM decave_friendships
       WHERE user_a=? OR user_b=?
     ),
     second_friends AS (
       SELECT CASE WHEN user_a=? THEN user_b ELSE user_a END AS friend_id
       FROM decave_friendships
       WHERE user_a=? OR user_b=?
     )
     SELECT 1
     FROM first_friends a
     JOIN second_friends b ON b.friend_id=a.friend_id
     LIMIT 1`,
    )
    .bind(firstId, firstId, firstId, secondId, secondId, secondId)
    .first();
  return Boolean(mutual);
}

export async function socialState(env: Env, userId: string) {
  const friends = await env.DB.prepare(
    `SELECT u.*
       FROM decave_friendships f
       JOIN decave_users u
       ON u.id = CASE WHEN f.user_a = ? THEN f.user_b ELSE f.user_a END
       WHERE f.user_a = ? OR f.user_b = ?
       ORDER BY u.username`,
  )
    .bind(userId, userId, userId)
    .all<UserRow>();

  const incoming = await env.DB.prepare(
    `SELECT u.* FROM decave_friend_requests r
       JOIN decave_users u ON u.id = r.sender_id
       WHERE r.recipient_id = ? ORDER BY r.created_at`,
  )
    .bind(userId)
    .all<UserRow>();

  const outgoing = await env.DB.prepare(
    `SELECT u.* FROM decave_friend_requests r
       JOIN decave_users u ON u.id = r.recipient_id
       WHERE r.sender_id = ? ORDER BY r.created_at`,
  )
    .bind(userId)
    .all<UserRow>();

  const onlineResponse = await realtimeFetch(env, "/internal/online-users");
  const onlineData = onlineResponse.ok ? ((await onlineResponse.json()) as { userIds?: string[] }) : {};
  const onlineIds = new Set(onlineData.userIds ?? []);

  const decorate = (row: UserRow, relation: "friend" | "other") => {
    const online = row.status !== "invisible" && onlineIds.has(row.id);
    return {
      ...publicUserWithPresence(row, online, relation),
      online,
    };
  };
  return {
    friends: friends.results.map((row) => decorate(row, "friend")),
    incoming: incoming.results.map((row) => decorate(row, "other")),
    outgoing: outgoing.results.map((row) => decorate(row, "other")),
  };
}

export async function groupChatForClient(
  env: Env,
  groupId: string,
  includeLatestMessage = true,
  viewerUserId?: string,
) {
  await ensureGroupChatSchema(env.DB);
  const group = await env.DB.prepare("SELECT * FROM decave_group_chats WHERE id=?").bind(groupId).first<GroupChatRow>();
  if (!group) return null;

  const memberRows = await env.DB.prepare(
    `SELECT u.*
       FROM decave_group_chat_members m
       JOIN decave_users u ON u.id=m.user_id
       WHERE m.group_id=?
       ORDER BY CASE WHEN u.id=? THEN 0 ELSE 1 END, u.username`,
  )
    .bind(groupId, group.owner_user_id)
    .all<UserRow>();

  const latest = await env.DB.prepare(
    includeLatestMessage
      ? `SELECT text, envelope, created_at
           FROM decave_group_chat_messages
           WHERE group_id=?
           ORDER BY created_at DESC
           LIMIT 1`
      : `SELECT created_at
           FROM decave_group_chat_messages
           WHERE group_id=?
           ORDER BY created_at DESC
           LIMIT 1`,
  )
    .bind(groupId)
    .first<{ text?: string; envelope?: string | null; created_at: string }>();

  const onlineResponse = await realtimeFetch(env, "/internal/online-users");
  const onlineData = onlineResponse.ok ? ((await onlineResponse.json()) as { userIds?: string[] }) : {};
  const onlineIds = new Set(onlineData.userIds ?? []);
  const members = memberRows.results.map((row) =>
    publicUserWithPresence(row, row.status !== "invisible" && onlineIds.has(row.id)),
  );
  const ownerRow = memberRows.results.find((row) => row.id === group.owner_user_id);

  // Unnamed groups are titled from the other members, so nobody sees their own name in the title.
  const others = memberRows.results.filter((row) => row.id !== viewerUserId).map((row) => row.username);
  const name =
    group.name || others.slice(0, 3).join(", ") + (others.length > 3 ? ` +${others.length - 3}` : "") || "Group chat";

  return {
    id: group.id,
    name,
    ownerUserId: ownerRow ? publicIdOf(ownerRow) : "",
    members,
    memberCount: members.length,
    latestMessage: includeLatestMessage ? (latest?.text ?? "") : "",
    /** The latest message's envelope when it is encrypted; the app decrypts the preview. */
    latestEnvelope:
      includeLatestMessage && latest?.envelope ? parseDmEnvelope(latest.envelope, DM_GROUP_MAX_WRAPS) : null,
    latestTimestamp: latest?.created_at ?? group.updated_at,
    /** Messages are end-to-end encrypted (for good, once they are). */
    e2ee: Boolean(group.e2ee_since),
  };
}

/**
 * Resolve a `?before=<messageId>` history cursor inside one conversation scope.
 * Returns null for an absent cursor; `false` for a cursor that is not in scope.
 */
export async function historyCursor(
  env: Env,
  table: "decave_messages" | "decave_direct_messages" | "decave_group_chat_messages",
  before: string | null,
  scopeSql: string,
  scopeBindings: unknown[],
): Promise<{ createdAt: string; id: string } | null | false> {
  if (!before) return null;
  const row = await env.DB.prepare(`SELECT id, created_at FROM ${table} WHERE id=? AND ${scopeSql} LIMIT 1`)
    .bind(before, ...scopeBindings)
    .first<{ id: string; created_at: string }>();
  return row ? { createdAt: row.created_at, id: row.id } : false;
}

export const HISTORY_PAGE_SIZE = 100;

export async function groupChatMessagesForClient(env: Env, groupId: string, before: string | null = null) {
  await ensureGroupChatSchema(env.DB);
  const cursor = await historyCursor(env, "decave_group_chat_messages", before, "group_id=?", [groupId]);
  if (cursor === false) return [];
  const rows = await env.DB.prepare(
    `SELECT m.id, m.group_id, m.from_user_id, m.text, m.envelope, m.created_at, m.reply_to_id,
              u.public_id, u.username, u.avatar_key, u.avatar_updated_at
       FROM decave_group_chat_messages m
       JOIN decave_users u ON u.id=m.from_user_id
       WHERE m.group_id=?${cursor ? " AND (m.created_at < ? OR (m.created_at = ? AND m.id < ?))" : ""}
       ORDER BY m.created_at DESC, m.id DESC
       LIMIT ${HISTORY_PAGE_SIZE}`,
  )
    .bind(groupId, ...(cursor ? [cursor.createdAt, cursor.createdAt, cursor.id] : []))
    .all<{
      id: string;
      group_id: string;
      from_user_id: string;
      text: string;
      envelope: string | null;
      created_at: string;
      reply_to_id: string | null;
      public_id: string | null;
      username: string;
      avatar_key: string | null;
      avatar_updated_at: string | null;
    }>();

  return rows.results.reverse().map((row) => ({
    id: row.id,
    groupId: row.group_id,
    fromUserId: row.public_id ?? "",
    username: row.username,
    avatarUrl: row.avatar_key
      ? `/api/users/${encodeURIComponent(row.public_id ?? row.username)}/avatar?v=${encodeURIComponent(row.avatar_updated_at ?? "")}`
      : null,
    text: row.text,
    envelope: row.envelope ? parseDmEnvelope(row.envelope, DM_GROUP_MAX_WRAPS) : null,
    timestamp: row.created_at,
    replyToId: row.reply_to_id,
  }));
}
