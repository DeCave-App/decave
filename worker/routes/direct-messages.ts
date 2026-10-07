// Direct messages: conversations, messages, attachments and reactions.

import { requireUser } from "../lib/sessions";
import { json, idFromPath, bodyJson } from "../lib/http";
import { realtimeFetch, realtimeBroadcast } from "../lib/realtime";
import { type UserRow, publicUserWithPresence, userByReference, nowIso, publicIdOf } from "../db";
import { isBlockedEitherDirection } from "../trust-safety";
import { dmMessageForClient, dmMessagesForClient } from "../lib/messages";
import { historyCursor, HISTORY_PAGE_SIZE } from "../lib/social";
import { dmReadAt } from "../read-state";
import { decidePollVote } from "../pollVotes";
import { attemptQueuedMediaDeletion, deleteUnlinkedMedia, safeUploadedContentType } from "../lib/media";
import type { ApiContext } from "./context";

export async function handleDirectMessageRoutes({ request, env, p, method }: ApiContext): Promise<Response | null> {
  if (method === "GET" && p === "/api/dms") {
    const user = await requireUser(request, env);
    if (user instanceof Response) return user;

    const friendshipRows = await env.DB.prepare(
      `SELECT CASE WHEN user_a=? THEN user_b ELSE user_a END AS friend_id
         FROM decave_friendships
         WHERE user_a=? OR user_b=?`,
    )
      .bind(user.id, user.id, user.id)
      .all<{ friend_id: string }>();

    const friendIds = new Set(friendshipRows.results.map((row) => row.friend_id));
    if (friendIds.size === 0) return json({ conversations: [] });

    const rows = await env.DB.prepare(
      `SELECT id, from_user_id, to_user_id, text, created_at
         FROM decave_direct_messages
         WHERE from_user_id=? OR to_user_id=?
         ORDER BY created_at DESC
         LIMIT 500`,
    )
      .bind(user.id, user.id)
      .all<{
        id: string;
        from_user_id: string;
        to_user_id: string;
        text: string;
        created_at: string;
      }>();

    const clearRows = await env.DB.prepare(
      `SELECT partner_id, cleared_at
         FROM decave_dm_conversation_clears
         WHERE user_id=?`,
    )
      .bind(user.id)
      .all<{ partner_id: string; cleared_at: string }>();
    const clearedAtByPartner = new Map(clearRows.results.map((row) => [row.partner_id, row.cleared_at]));

    const latestByPartner = new Map<string, { text: string; created_at: string }>();

    for (const row of rows.results) {
      const partnerId = row.from_user_id === user.id ? row.to_user_id : row.from_user_id;
      const clearedAt = clearedAtByPartner.get(partnerId);
      if (clearedAt && row.created_at <= clearedAt) continue;
      if (!friendIds.has(partnerId) || latestByPartner.has(partnerId)) continue;
      latestByPartner.set(partnerId, {
        text: row.text,
        created_at: row.created_at,
      });
    }

    const onlineResponse = await realtimeFetch(env, "/internal/online-users");
    const onlineData = onlineResponse.ok ? ((await onlineResponse.json()) as { userIds?: string[] }) : {};
    const onlineIds = new Set(onlineData.userIds ?? []);

    const conversations = [];
    for (const [partnerId, latest] of latestByPartner) {
      const target = await env.DB.prepare("SELECT * FROM decave_users WHERE id=?").bind(partnerId).first<UserRow>();
      if (!target) continue;

      conversations.push({
        user: {
          ...publicUserWithPresence(target, onlineIds.has(target.id), "friend"),
          online: onlineIds.has(target.id) && target.status !== "invisible",
        },
        latestMessage: latest.text,
        latestTimestamp: latest.created_at,
      });
    }

    conversations.sort((a, b) => new Date(b.latestTimestamp).getTime() - new Date(a.latestTimestamp).getTime());

    return json({ conversations });
  }

  const dmAttachmentRoute = idFromPath(p, /^\/api\/dms\/([^/]+)\/attachments$/);
  if (method === "POST" && dmAttachmentRoute) {
    const user = await requireUser(request, env);
    if (user instanceof Response) return user;
    const targetReference = decodeURIComponent(dmAttachmentRoute[1]);
    const targetUser = await userByReference(env.DB, targetReference);
    if (!targetUser || targetUser.id === user.id || targetUser.deleted_at)
      return json({ error: "Invalid conversation." }, 400);
    const targetId = targetUser.id;
    if (await isBlockedEitherDirection(env.DB, user.id, targetId)) {
      return json({ error: "This user is blocked. Unblock them before starting a private conversation." }, 403);
    }
    const pair = [user.id, targetId].sort();
    const friend = await env.DB.prepare("SELECT 1 FROM decave_friendships WHERE user_a=? AND user_b=?")
      .bind(pair[0], pair[1])
      .first();
    if (!friend) return json({ error: "Private messages are available between friends." }, 403);
    const declaredLength = Number(request.headers.get("content-length") ?? 0);
    if (declaredLength > 25 * 1024 * 1024) return json({ error: "Maximum attachment size is 25 MB" }, 413);
    const bytes = await request.arrayBuffer();
    if (!bytes.byteLength) return json({ error: "Attachment is empty" }, 400);
    if (bytes.byteLength > 25 * 1024 * 1024) return json({ error: "Maximum attachment size is 25 MB" }, 413);
    let name = "attachment";
    try {
      name =
        decodeURIComponent(request.headers.get("X-File-Name") ?? "attachment")
          .replace(/[\r\n]/g, "")
          .trim() || "attachment";
    } catch {}
    let mime: string;
    try {
      mime = safeUploadedContentType(
        request.headers.get("X-File-Type") ?? request.headers.get("Content-Type") ?? "application/octet-stream",
        new Uint8Array(bytes),
      );
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "Unsupported image data." }, 400);
    }
    const id = crypto.randomUUID();
    const key = `attachments/private/${id}`;
    await env.MEDIA.put(key, bytes, {
      httpMetadata: {
        contentType: mime,
        contentDisposition: `attachment; filename="${name.replace(/"/g, "")}"`,
      },
    });
    try {
      await env.DB.prepare(
        `INSERT INTO decave_attachment_access(r2_key,kind,owner_user_id,peer_user_id,hub_id,room_id,created_at)
         VALUES(?, 'dm', ?, ?, NULL, NULL, ?)`,
      )
        .bind(key, user.id, targetId, nowIso())
        .run();
    } catch (error) {
      await deleteUnlinkedMedia(env, key);
      throw error;
    }
    return json({
      attachment: {
        id,
        name: name.slice(0, 180),
        mimeType: mime,
        size: bytes.byteLength,
        url: `/uploads/${key}`,
      },
    });
  }

  const dmGet = idFromPath(p, /^\/api\/dms\/([^/]+)$/);
  if ((method === "GET" || method === "POST" || method === "DELETE") && dmGet) {
    const user = await requireUser(request, env);
    if (user instanceof Response) return user;
    const targetReference = decodeURIComponent(dmGet[1]);
    const targetUser = await userByReference(env.DB, targetReference);
    if (!targetUser || targetUser.deleted_at) return json({ error: "User not found" }, 404);
    const targetId = targetUser.id;
    if (method !== "DELETE" && (await isBlockedEitherDirection(env.DB, user.id, targetId))) {
      return json({ error: "This user is blocked. Unblock them before starting a private conversation." }, 403);
    }

    if (method === "POST") {
      if (targetId === user.id) return json({ error: "Invalid conversation." }, 400);
      const pair = [user.id, targetId].sort();
      const friend = await env.DB.prepare("SELECT 1 FROM decave_friendships WHERE user_a=? AND user_b=?")
        .bind(pair[0], pair[1])
        .first();
      if (!friend) return json({ error: "Private messages are available between friends." }, 403);
      const target = await env.DB.prepare("SELECT * FROM decave_users WHERE id=?").bind(targetId).first<UserRow>();
      if (!target) return json({ error: "User not found" }, 404);
      const body = await bodyJson(request);
      const text = typeof body.text === "string" ? body.text.trim().slice(0, 4000) : "";
      if (!text) return json({ error: "Message cannot be empty." }, 400);
      const replyToId = typeof body.replyToId === "string" ? body.replyToId : null;
      if (replyToId) {
        const replyTarget = await env.DB.prepare(
          `SELECT 1
             FROM decave_direct_messages
             WHERE id=? AND ((from_user_id=? AND to_user_id=?) OR (from_user_id=? AND to_user_id=?))
             LIMIT 1`,
        )
          .bind(replyToId, user.id, targetId, targetId, user.id)
          .first();
        if (!replyTarget) return json({ error: "The message you are replying to was not found." }, 400);
      }
      const id = crypto.randomUUID();
      const createdAt = nowIso();
      await env.DB.prepare(
        "INSERT INTO decave_direct_messages(id,from_user_id,to_user_id,text,created_at,reply_to_id) VALUES(?,?,?,?,?,?)",
      )
        .bind(id, user.id, targetId, text, createdAt, replyToId)
        .run();
      const message = await dmMessageForClient(env, id);
      if (!message) return json({ error: "Could not create private message." }, 500);
      await realtimeBroadcast(
        env,
        { type: "DM_MESSAGE", message, sender: { id: publicIdOf(user), username: user.username } },
        { userIds: [user.id, targetId] },
      );
      return json({ message }, 201);
    }

    if (method === "DELETE") {
      if (targetId === user.id) return json({ error: "Invalid conversation." }, 400);
      const target = await env.DB.prepare("SELECT 1 FROM decave_users WHERE id=?").bind(targetId).first();
      if (!target) return json({ error: "User not found" }, 404);

      await env.DB.prepare(
        `INSERT INTO decave_dm_conversation_clears(user_id,partner_id,cleared_at)
           VALUES(?,?,?)
           ON CONFLICT(user_id,partner_id)
           DO UPDATE SET cleared_at=excluded.cleared_at`,
      )
        .bind(user.id, targetId, nowIso())
        .run();

      return json({ success: true });
    }

    const pair = [user.id, targetId].sort();
    const friend = await env.DB.prepare("SELECT 1 FROM decave_friendships WHERE user_a=? AND user_b=?")
      .bind(pair[0], pair[1])
      .first();
    if (!friend) return json({ error: "Private messages are available between friends." }, 403);
    const target = await env.DB.prepare("SELECT * FROM decave_users WHERE id=?").bind(targetId).first<UserRow>();
    if (!target) return json({ error: "User not found" }, 404);

    const clearRow = await env.DB.prepare(
      "SELECT cleared_at FROM decave_dm_conversation_clears WHERE user_id=? AND partner_id=?",
    )
      .bind(user.id, targetId)
      .first<{ cleared_at: string }>();
    const clearedAt = clearRow?.cleared_at ?? "1970-01-01T00:00:00.000Z";

    const pairSql = "((from_user_id=? AND to_user_id=?) OR (from_user_id=? AND to_user_id=?))";
    const pairBindings = [user.id, targetId, targetId, user.id];
    const cursor = await historyCursor(
      env,
      "decave_direct_messages",
      new URL(request.url).searchParams.get("before"),
      pairSql,
      pairBindings,
    );
    const rows =
      cursor === false
        ? { results: [] as { id: string }[] }
        : await env.DB.prepare(
            `SELECT id
           FROM decave_direct_messages
           WHERE ${pairSql} AND created_at > ?${cursor ? " AND (created_at < ? OR (created_at = ? AND id < ?))" : ""}
           ORDER BY created_at DESC, id DESC LIMIT ${HISTORY_PAGE_SIZE}`,
          )
            .bind(...pairBindings, clearedAt, ...(cursor ? [cursor.createdAt, cursor.createdAt, cursor.id] : []))
            .all<{ id: string }>();
    const messages = await dmMessagesForClient(
      env,
      rows.results.reverse().map((m) => m.id),
    );
    const peerReadAt = await dmReadAt(env.DB, targetId, user.id);
    const onlineResponse = await realtimeFetch(env, "/internal/online-users");
    const onlineData = onlineResponse.ok ? ((await onlineResponse.json()) as { userIds?: string[] }) : {};
    const online = target.status !== "invisible" && (onlineData.userIds ?? []).includes(target.id);
    return json({ user: { ...publicUserWithPresence(target, online, "friend"), online }, messages, peerReadAt });
  }

  const dmMessageRoute = idFromPath(p, /^\/api\/dms\/messages\/([^/]+)$/);
  if (dmMessageRoute && (method === "PATCH" || method === "DELETE")) {
    const user = await requireUser(request, env);
    if (user instanceof Response) return user;

    const messageId = decodeURIComponent(dmMessageRoute[1]);
    const row = await env.DB.prepare(
      `SELECT id, from_user_id, to_user_id, text, created_at
         FROM decave_direct_messages
         WHERE id=?`,
    )
      .bind(messageId)
      .first<{
        id: string;
        from_user_id: string;
        to_user_id: string;
        text: string;
        created_at: string;
      }>();

    if (!row) return json({ error: "Message not found." }, 404);
    if (row.from_user_id !== user.id) {
      return json({ error: "You can only change messages you sent." }, 403);
    }

    if (method === "DELETE") {
      // Legacy DM rows may contain an attachment URL in their payload. Resolve
      // only objects shared with this exact conversation, then retain a durable
      // deletion reference if R2 is temporarily unavailable.
      const attachmentKeys = await env.DB.prepare(
        `SELECT r2_key AS object_key FROM decave_attachment_access
         WHERE kind='dm' AND ((owner_user_id=? AND peer_user_id=?) OR (owner_user_id=? AND peer_user_id=?))
           AND EXISTS(SELECT 1 FROM decave_direct_messages WHERE id=? AND instr(text,r2_key)>0)
           AND NOT EXISTS(SELECT 1 FROM decave_direct_messages other
             WHERE other.id<>? AND instr(other.text,r2_key)>0)`,
      )
        .bind(row.from_user_id, row.to_user_id, row.to_user_id, row.from_user_id, messageId, messageId)
        .all<{ object_key: string }>();
      const keys = attachmentKeys.results.map((item) => item.object_key);
      await env.DB.batch([
        env.DB.prepare(
          `INSERT OR IGNORE INTO decave_media_deletion_queue(object_key,queued_at,attempts,last_attempt_at)
           SELECT access.r2_key,?,0,NULL FROM decave_attachment_access access
           WHERE access.kind='dm'
             AND ((access.owner_user_id=? AND access.peer_user_id=?) OR (access.owner_user_id=? AND access.peer_user_id=?))
             AND EXISTS(SELECT 1 FROM decave_direct_messages WHERE id=? AND instr(text,access.r2_key)>0)
             AND NOT EXISTS(SELECT 1 FROM decave_direct_messages other
               WHERE other.id<>? AND instr(other.text,access.r2_key)>0)`,
        ).bind(nowIso(), row.from_user_id, row.to_user_id, row.to_user_id, row.from_user_id, messageId, messageId),
        env.DB.prepare("DELETE FROM decave_direct_messages WHERE id=?").bind(messageId),
        ...(keys.length
          ? [
              env.DB.prepare(
                `DELETE FROM decave_attachment_access WHERE r2_key IN (${[...new Set(keys)].map(() => "?").join(",")})
                 AND NOT EXISTS(SELECT 1 FROM decave_direct_messages WHERE instr(text,r2_key)>0)`,
              ).bind(...new Set(keys)),
            ]
          : []),
      ]);
      const queuedKeys = keys.length
        ? await env.DB.prepare(
            `SELECT object_key FROM decave_media_deletion_queue
             WHERE object_key IN (${[...new Set(keys)].map(() => "?").join(",")})`,
          )
            .bind(...new Set(keys))
            .all<{ object_key: string }>()
        : { results: [] as Array<{ object_key: string }> };
      await attemptQueuedMediaDeletion(
        env,
        queuedKeys.results.map((item) => item.object_key),
      );

      await realtimeBroadcast(env, { type: "DM_DELETED", messageId }, { userIds: [row.from_user_id, row.to_user_id] });

      return json({ success: true });
    }

    const body = await bodyJson(request);
    const text = typeof body.text === "string" ? body.text.trim().slice(0, 4000) : "";
    if (!text) return json({ error: "Message cannot be empty." }, 400);

    await env.DB.prepare("UPDATE decave_direct_messages SET text=? WHERE id=?").bind(text, messageId).run();

    const message = await dmMessageForClient(env, row.id);
    if (!message) return json({ error: "Message not found." }, 404);

    await realtimeBroadcast(env, { type: "DM_EDITED", message }, { userIds: [row.from_user_id, row.to_user_id] });

    return json({ message });
  }

  const dmReactionRoute = idFromPath(p, /^\/api\/dms\/messages\/([^/]+)\/reactions$/);
  if (method === "POST" && dmReactionRoute) {
    const user = await requireUser(request, env);
    if (user instanceof Response) return user;

    const messageId = decodeURIComponent(dmReactionRoute[1]);
    const row = await env.DB.prepare(
      `SELECT id, from_user_id, to_user_id, text
         FROM decave_direct_messages
         WHERE id=?`,
    )
      .bind(messageId)
      .first<{ id: string; from_user_id: string; to_user_id: string; text: string | null }>();

    if (!row) return json({ error: "Message not found." }, 404);
    if (user.id !== row.from_user_id && user.id !== row.to_user_id) {
      return json({ error: "No access to this private message." }, 403);
    }
    if (await isBlockedEitherDirection(env.DB, row.from_user_id, row.to_user_id)) {
      return json({ error: "This user is blocked. Unblock them before interacting with private messages." }, 403);
    }

    const body = await bodyJson(request);
    const emoji = typeof body.emoji === "string" ? body.emoji.slice(0, 24) : "";
    if (!emoji) return json({ error: "Emoji required." }, 400);

    const exists = await env.DB.prepare(
      `SELECT 1
         FROM decave_dm_reactions
         WHERE message_id=? AND user_id=? AND emoji=?`,
    )
      .bind(messageId, user.id, emoji)
      .first();

    const pollVote = decidePollVote(row.text, emoji, Boolean(exists), Date.now());
    if (pollVote.kind === "reject") return json({ error: pollVote.error, code: pollVote.code }, 400);

    if (exists) {
      await env.DB.prepare(
        `DELETE FROM decave_dm_reactions
           WHERE message_id=? AND user_id=? AND emoji=?`,
      )
        .bind(messageId, user.id, emoji)
        .run();
    } else {
      if (pollVote.kind === "allow" && pollVote.clearOtherPollVotes) {
        await env.DB.prepare(
          "DELETE FROM decave_dm_reactions WHERE message_id=? AND user_id=? AND substr(emoji,1,5)='poll_'",
        )
          .bind(messageId, user.id)
          .run();
      }
      await env.DB.prepare(
        `INSERT INTO decave_dm_reactions(message_id,user_id,emoji,created_at)
           VALUES(?,?,?,?)`,
      )
        .bind(messageId, user.id, emoji, nowIso())
        .run();
    }

    const message = await dmMessageForClient(env, messageId);
    if (!message) return json({ error: "Message not found." }, 404);

    await realtimeBroadcast(
      env,
      { type: "DM_REACTION_UPDATED", message },
      { userIds: [row.from_user_id, row.to_user_id] },
    );

    return json({ message });
  }

  return null;
}
