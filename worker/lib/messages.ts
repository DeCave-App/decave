// Room and direct messages as sent to the client, with reactions and history
// paging.

import type { Env } from "./env";
import type { ServerRole } from "../db";
import { parseDmEnvelope, type DmEnvelope } from "../../shared/dm-e2ee-format";

// D1 caps bound parameters per statement; keep IN (...) lists below that.
export const D1_IN_CHUNK = 90;

export function chunked<T>(values: readonly T[], size = D1_IN_CHUNK): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) chunks.push(values.slice(index, index + size));
  return chunks;
}

export async function reactionMapsFor(
  env: Env,
  table: "decave_message_reactions" | "decave_dm_reactions",
  messageIds: readonly string[],
): Promise<Map<string, Record<string, string[]>>> {
  const maps = new Map<string, Record<string, string[]>>();
  for (const ids of chunked([...new Set(messageIds)])) {
    const rows = await env.DB.prepare(
      `SELECT r.message_id, r.emoji, u.public_id
         FROM ${table} r
         JOIN decave_users u ON u.id=r.user_id
         WHERE r.message_id IN (${ids.map(() => "?").join(",")})`,
    )
      .bind(...ids)
      .all<{ message_id: string; emoji: string; public_id: string | null }>();
    for (const reaction of rows.results) {
      if (!reaction.public_id) continue;
      const map = maps.get(reaction.message_id) ?? {};
      (map[reaction.emoji] ??= []).push(reaction.public_id);
      maps.set(reaction.message_id, map);
    }
  }
  return maps;
}

export type ChannelMessageRow = {
  id: string;
  room_id: number;
  hub_id: number;
  author_user_id: string;
  text: string;
  created_at: string;
  edited_at: string | null;
  reply_to_id: string | null;
  pinned: number;
  attachment_id: string | null;
  attachment_name: string | null;
  attachment_mime: string | null;
  attachment_size: number | null;
  attachment_key: string | null;
  public_id: string | null;
  username: string;
  avatar_key: string | null;
  avatar_updated_at: string | null;
  role: ServerRole | null;
};

/** Load and format channel messages in two queries, preserving the order of `messageIds`. */
export async function messagesForClient(env: Env, messageIds: readonly string[]) {
  const rowsById = new Map<string, ChannelMessageRow>();
  for (const ids of chunked([...new Set(messageIds)])) {
    const rows = await env.DB.prepare(
      `SELECT m.*, u.public_id, u.username, u.avatar_key, u.avatar_updated_at,
                hm.role
         FROM decave_messages m
         JOIN decave_users u ON u.id = m.author_user_id
         LEFT JOIN decave_hub_members hm
           ON hm.hub_id = m.hub_id AND hm.user_id = m.author_user_id
         WHERE m.id IN (${ids.map(() => "?").join(",")})`,
    )
      .bind(...ids)
      .all<ChannelMessageRow>();
    for (const row of rows.results) rowsById.set(row.id, row);
  }
  const reactions = await reactionMapsFor(env, "decave_message_reactions", [...rowsById.keys()]);
  return messageIds.flatMap((id) => {
    const row = rowsById.get(id);
    if (!row) return [];
    return [
      {
        id: row.id,
        userId: row.public_id ?? "",
        username: row.username,
        avatarUrl: row.avatar_key
          ? `/api/users/${encodeURIComponent(row.public_id ?? row.username)}/avatar?v=${encodeURIComponent(row.avatar_updated_at ?? "")}`
          : null,
        text: row.text,
        timestamp: row.created_at,
        channelId: row.room_id,
        role: row.role,
        editedAt: row.edited_at,
        replyToId: row.reply_to_id,
        reactions: reactions.get(row.id) ?? {},
        pinned: row.pinned === 1,
        attachment:
          row.attachment_id && row.attachment_key
            ? {
                id: row.attachment_id,
                name: row.attachment_name ?? "attachment",
                mimeType: row.attachment_mime ?? "application/octet-stream",
                size: Number(row.attachment_size ?? 0),
                url: `/uploads/${row.attachment_key}`,
              }
            : null,
      },
    ];
  });
}

export async function messageForClient(env: Env, messageId: string) {
  return (await messagesForClient(env, [messageId]))[0] ?? null;
}

export type ClientDirectMessage = {
  id: string;
  fromUserId: string;
  toUserId: string;
  /** Empty for an encrypted message; the client decrypts `envelope`. */
  text: string;
  envelope: DmEnvelope | null;
  timestamp: string;
  replyToId: string | null;
  reactions: Record<string, string[]>;
  /** Encrypted reactions (one envelope per account), for an encrypted message. */
  reactionEnvelopes: DmEnvelope[];
};

async function reactionEnvelopesFor(env: Env, messageIds: readonly string[]): Promise<Map<string, DmEnvelope[]>> {
  const envelopes = new Map<string, DmEnvelope[]>();
  for (const ids of chunked([...new Set(messageIds)])) {
    const rows = await env.DB.prepare(
      `SELECT message_id, envelope FROM decave_dm_reaction_envelopes
         WHERE message_id IN (${ids.map(() => "?").join(",")})
         ORDER BY updated_at`,
    )
      .bind(...ids)
      .all<{ message_id: string; envelope: string }>();
    for (const row of rows.results) {
      const envelope = parseDmEnvelope(row.envelope);
      if (!envelope) continue;
      const list = envelopes.get(row.message_id) ?? [];
      list.push(envelope);
      envelopes.set(row.message_id, list);
    }
  }
  return envelopes;
}

/** Load and format direct messages in two queries, preserving the order of `messageIds`. */
export async function dmMessagesForClient(env: Env, messageIds: readonly string[]): Promise<ClientDirectMessage[]> {
  type Row = {
    id: string;
    from_user_id: string;
    to_user_id: string;
    text: string;
    envelope: string | null;
    created_at: string;
    reply_to_id: string | null;
    from_public_id: string | null;
    to_public_id: string | null;
  };
  const rowsById = new Map<string, Row>();
  for (const ids of chunked([...new Set(messageIds)])) {
    const rows = await env.DB.prepare(
      `SELECT m.id,m.from_user_id,m.to_user_id,m.text,m.envelope,m.created_at,m.reply_to_id,
                fu.public_id AS from_public_id,tu.public_id AS to_public_id
         FROM decave_direct_messages m
         JOIN decave_users fu ON fu.id=m.from_user_id
         JOIN decave_users tu ON tu.id=m.to_user_id
         WHERE m.id IN (${ids.map(() => "?").join(",")})`,
    )
      .bind(...ids)
      .all<Row>();
    for (const row of rows.results) rowsById.set(row.id, row);
  }
  const reactions = await reactionMapsFor(env, "decave_dm_reactions", [...rowsById.keys()]);
  const encryptedIds = [...rowsById.values()].filter((row) => row.envelope).map((row) => row.id);
  const reactionEnvelopes = encryptedIds.length ? await reactionEnvelopesFor(env, encryptedIds) : new Map();
  return messageIds.flatMap((id) => {
    const row = rowsById.get(id);
    if (!row) return [];
    return [
      {
        id: row.id,
        fromUserId: row.from_public_id ?? "",
        toUserId: row.to_public_id ?? "",
        text: row.text,
        envelope: row.envelope ? parseDmEnvelope(row.envelope) : null,
        timestamp: row.created_at,
        replyToId: row.reply_to_id,
        reactions: reactions.get(row.id) ?? {},
        reactionEnvelopes: reactionEnvelopes.get(row.id) ?? [],
      },
    ];
  });
}

export async function dmMessageForClient(env: Env, messageId: string): Promise<ClientDirectMessage | null> {
  return (await dmMessagesForClient(env, [messageId]))[0] ?? null;
}

export function isLegacyHistoryReadRoute(pathname: string, method: string): boolean {
  if (method.toUpperCase() !== "GET") return false;
  return (
    pathname === "/api/dms" ||
    /^\/api\/dms\/[^/]+$/.test(pathname) ||
    /^\/api\/groups\/[^/]+$/.test(pathname) ||
    /^\/api\/channels\/\d+\/(?:messages|search)$/.test(pathname)
  );
}
