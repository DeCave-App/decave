// Direct messages: conversations, messages, attachments and reactions.

import { requireUser } from "../lib/sessions";
import { safeUploadedContentType, UploadTypeError } from "../lib/upload-content-type";
import { boundedBodyBytes, json, idFromPath, bodyJson, apiError, apiErrorLegacy } from "../lib/http";
import { connectedUserIds, realtimeBroadcast } from "../lib/realtime";
import { type UserRow, publicUserWithPresence, presenceOnline, userByReference, nowIso, publicIdOf } from "../db";
import { isBlockedEitherDirection } from "../trust-safety";
import { dmMessageForClient, dmMessagesForClient } from "../lib/messages";
import { historyCursor, HISTORY_PAGE_SIZE } from "../lib/social";
import { dmReadAt } from "../read-state";
import { decidePollVote, decideEncryptedPollVote } from "../pollVotes";
import {
  checkOutgoingDm,
  checkReactionEnvelope,
  dmE2eeEnabled,
  insertDirectMessageWithAttachmentGuard,
  updateDirectMessageWithAttachmentGuard,
} from "../lib/dm-e2ee";
import { DM_UPLOAD_REFERENCED_SQL, deleteQueuedMedia, ensureMediaDeletionQueueSchema } from "../lib/media";
import { parseDmEnvelope } from "../../shared/dm-e2ee-format";
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
      `SELECT id, from_user_id, to_user_id, text, envelope, created_at
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
        envelope: string | null;
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

    const latestByPartner = new Map<
      string,
      { id: string; text: string; envelope: string | null; created_at: string }
    >();

    for (const row of rows.results) {
      const partnerId = row.from_user_id === user.id ? row.to_user_id : row.from_user_id;
      const clearedAt = clearedAtByPartner.get(partnerId);
      if (clearedAt && row.created_at <= clearedAt) continue;
      if (!friendIds.has(partnerId) || latestByPartner.has(partnerId)) continue;
      latestByPartner.set(partnerId, {
        id: row.id,
        text: row.text,
        envelope: row.envelope,
        created_at: row.created_at,
      });
    }

    const onlineIds = await connectedUserIds(env);

    const conversations = [];
    for (const [partnerId, latest] of latestByPartner) {
      const target = await env.DB.prepare("SELECT * FROM decave_users WHERE id=?").bind(partnerId).first<UserRow>();
      if (!target) continue;

      conversations.push({
        user: {
          ...publicUserWithPresence(target, onlineIds.has(target.id), "friend"),
          online: presenceOnline(target, onlineIds.has(target.id)),
        },
        latestMessage: latest.text,
        latestMessageId: latest.id,
        // Encrypted previews are decrypted by the client.
        latestEnvelope: latest.envelope ? parseDmEnvelope(latest.envelope) : null,
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
      return apiError("dm.invalidConversation", 400);
    const targetId = targetUser.id;
    if (await isBlockedEitherDirection(env.DB, user.id, targetId)) {
      return apiError("dm.blockedStart", 403);
    }
    const pair = [user.id, targetId].sort();
    const friend = await env.DB.prepare("SELECT 1 FROM decave_friendships WHERE user_a=? AND user_b=?")
      .bind(pair[0], pair[1])
      .first();
    if (!friend) return apiError("dm.friendsOnly", 403);
    const bytes = await boundedBodyBytes(request, 25 * 1024 * 1024);
    if (!bytes) return apiError("dm.attachmentTooLarge", 413);
    if (!bytes.byteLength) return apiError("dm.attachmentEmpty", 400);
    let name = "attachment";
    try {
      name =
        decodeURIComponent(request.headers.get("X-File-Name") ?? "attachment")
          .replace(/[\r\n]/g, "")
          .trim() || "attachment";
    } catch {}
    // Encrypted attachments are declared application/octet-stream and stay opaque.
    let mime: string;
    try {
      mime = safeUploadedContentType(request.headers.get("X-File-Type") ?? "", new Uint8Array(bytes));
    } catch (error) {
      if (error instanceof UploadTypeError) return apiError("rooms.attachmentImageType", 415);
      throw error;
    }
    const id = crypto.randomUUID();
    const key = `attachments/private/${id}`;
    await env.MEDIA.put(key, bytes, {
      httpMetadata: {
        contentType: mime,
        contentDisposition: `attachment; filename="${name.replace(/"/g, "")}"`,
      },
    });
    await env.DB.prepare(
      `INSERT INTO decave_attachment_access(r2_key,kind,owner_user_id,peer_user_id,hub_id,room_id,created_at)
       VALUES(?, 'dm', ?, ?, NULL, NULL, ?)`,
    )
      .bind(key, user.id, targetId, nowIso())
      .run();
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
    if (!targetUser || targetUser.deleted_at) return apiError("common.userNotFound", 404);
    const targetId = targetUser.id;
    if (method !== "DELETE" && (await isBlockedEitherDirection(env.DB, user.id, targetId))) {
      return apiError("dm.blockedStart", 403);
    }

    if (method === "POST") {
      if (targetId === user.id) return apiError("dm.invalidConversation", 400);
      const pair = [user.id, targetId].sort();
      const friend = await env.DB.prepare("SELECT 1 FROM decave_friendships WHERE user_a=? AND user_b=?")
        .bind(pair[0], pair[1])
        .first();
      if (!friend) return apiError("dm.friendsOnly", 403);
      const target = await env.DB.prepare("SELECT * FROM decave_users WHERE id=?").bind(targetId).first<UserRow>();
      if (!target) return apiError("common.userNotFound", 404);
      const body = await bodyJson(request);
      const outgoing = await checkOutgoingDm(env.DB, {
        enabled: dmE2eeEnabled(env),
        sender: user,
        target,
        text: body.text,
        envelope: body.envelope,
        attachmentKeys: body.attachmentKeys,
      });
      if (!outgoing.ok) return apiErrorLegacy(outgoing.code, outgoing.i18nKey, outgoing.status);
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
        if (!replyTarget) return apiError("dm.replyTargetNotFound", 400);
      }
      const id = outgoing.id ?? crypto.randomUUID();
      const createdAt = nowIso();
      const inserted = await insertDirectMessageWithAttachmentGuard(env.DB, {
        id,
        fromUserId: user.id,
        toUserId: targetId,
        text: outgoing.text,
        envelope: outgoing.envelope,
        createdAt,
        replyToId,
        attachmentRefs: outgoing.attachmentRefs || null,
      });
      if (!inserted.meta.changes) {
        const duplicate = await env.DB.prepare("SELECT 1 FROM decave_direct_messages WHERE id=? LIMIT 1")
          .bind(id)
          .first();
        return duplicate
          ? apiError("dm.alreadySent", 409)
          : apiErrorLegacy("DM_E2EE_INVALID", "dmE2ee.attachmentUnavailable", 400);
      }
      const message = await dmMessageForClient(env, id);
      if (!message) return apiError("dm.createFailed", 500);
      await realtimeBroadcast(
        env,
        { type: "DM_MESSAGE", message, sender: { id: publicIdOf(user), username: user.username } },
        { userIds: [user.id, targetId] },
      );
      return json({ message }, 201);
    }

    if (method === "DELETE") {
      if (targetId === user.id) return apiError("dm.invalidConversation", 400);
      const target = await env.DB.prepare("SELECT 1 FROM decave_users WHERE id=?").bind(targetId).first();
      if (!target) return apiError("common.userNotFound", 404);

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
    if (!friend) return apiError("dm.friendsOnly", 403);
    const target = await env.DB.prepare("SELECT * FROM decave_users WHERE id=?").bind(targetId).first<UserRow>();
    if (!target) return apiError("common.userNotFound", 404);

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
    const online = presenceOnline(target, (await connectedUserIds(env)).has(target.id));
    return json({ user: { ...publicUserWithPresence(target, online, "friend"), online }, messages, peerReadAt });
  }

  const dmMessageRoute = idFromPath(p, /^\/api\/dms\/messages\/([^/]+)$/);
  if (dmMessageRoute && (method === "PATCH" || method === "DELETE")) {
    const user = await requireUser(request, env);
    if (user instanceof Response) return user;

    const messageId = decodeURIComponent(dmMessageRoute[1]);
    const row = await env.DB.prepare(
      `SELECT id, from_user_id, to_user_id, text, envelope, created_at, attachment_refs
         FROM decave_direct_messages
         WHERE id=?`,
    )
      .bind(messageId)
      .first<{
        id: string;
        from_user_id: string;
        to_user_id: string;
        text: string;
        envelope: string | null;
        created_at: string;
        attachment_refs: string | null;
      }>();

    if (!row) return apiError("common.messageNotFound", 404);
    if (row.from_user_id !== user.id) {
      return apiError("dm.notYourMessage", 403);
    }

    if (method === "DELETE") {
      // Delete the files this message carried, not just the message. An encrypted
      // message lists them in attachment_refs. A file goes only when it is this
      // sender's upload and no other DM still carries it; its key is queued in
      // the same batch so a failed R2 delete is retried (worker/retention.ts).
      await ensureMediaDeletionQueueSchema(env.DB);
      const carried = `${row.text} ${row.attachment_refs ?? ""}`;
      const keys = [...new Set(carried.match(/attachments\/private\/[0-9a-f-]{36}/g) ?? [])];
      const now = nowIso();
      const fileStatements = keys.flatMap((key) => [
        env.DB.prepare(
          `INSERT OR IGNORE INTO decave_media_deletion_queue(object_key,queued_at,attempts)
           SELECT access.r2_key,?,0 FROM decave_attachment_access access
           WHERE access.r2_key=? AND access.kind='dm' AND access.owner_user_id=?
             AND NOT EXISTS (SELECT 1 FROM decave_direct_messages WHERE id=?)
             AND NOT ${DM_UPLOAD_REFERENCED_SQL}`,
        ).bind(now, key, user.id, messageId),
        env.DB.prepare(
          `DELETE FROM decave_attachment_access
             WHERE r2_key=? AND kind='dm' AND owner_user_id=?
             AND NOT EXISTS (SELECT 1 FROM decave_direct_messages WHERE id=?)
             AND NOT EXISTS (
               SELECT 1 FROM decave_direct_messages dm
               WHERE (dm.from_user_id=decave_attachment_access.owner_user_id
                      OR (decave_attachment_access.peer_user_id IS NOT NULL
                          AND dm.from_user_id=decave_attachment_access.peer_user_id
                          AND dm.to_user_id=decave_attachment_access.owner_user_id))
                 AND (instr(dm.text, decave_attachment_access.r2_key)>0
                      OR instr(COALESCE(dm.attachment_refs, ''), decave_attachment_access.r2_key)>0)
             )
             AND r2_key IN (SELECT object_key FROM decave_media_deletion_queue WHERE object_key=?)`,
        ).bind(key, user.id, messageId, key),
      ]);
      const deletion = await env.DB.batch([
        // The attachment cleanup below uses the refs from the read above. Make
        // the delete conditional on that exact set (including plaintext refs in
        // text), so a concurrent edit cannot be deleted while its newer upload
        // access row is left behind. D1 batches run in order as one transaction.
        env.DB.prepare(
          `DELETE FROM decave_direct_messages
           WHERE id=? AND from_user_id=? AND to_user_id=? AND text=? AND attachment_refs IS ?`,
        ).bind(messageId, row.from_user_id, row.to_user_id, row.text, row.attachment_refs),
        env.DB.prepare(
          `DELETE FROM decave_dm_reactions WHERE message_id=?
           AND NOT EXISTS (SELECT 1 FROM decave_direct_messages WHERE id=?)`,
        ).bind(messageId, messageId),
        env.DB.prepare(
          `DELETE FROM decave_dm_reaction_envelopes WHERE message_id=?
           AND NOT EXISTS (SELECT 1 FROM decave_direct_messages WHERE id=?)`,
        ).bind(messageId, messageId),
        ...fileStatements,
      ]);
      if (!deletion[0]?.meta.changes) {
        return apiError("dm.changedWhileDeleting", 409);
      }
      if (keys.length) {
        const queued = await env.DB.prepare(
          `SELECT object_key FROM decave_media_deletion_queue WHERE object_key IN (${keys.map(() => "?").join(",")})`,
        )
          .bind(...keys)
          .all<{ object_key: string }>();
        await deleteQueuedMedia(
          env,
          queued.results.map((item) => item.object_key),
        );
      }

      await realtimeBroadcast(env, { type: "DM_DELETED", messageId }, { userIds: [row.from_user_id, row.to_user_id] });

      return json({ success: true });
    }

    if (await isBlockedEitherDirection(env.DB, row.from_user_id, row.to_user_id)) {
      return apiError("dm.blockedStart", 403);
    }
    const pair = [row.from_user_id, row.to_user_id].sort();
    const friend = await env.DB.prepare("SELECT 1 FROM decave_friendships WHERE user_a=? AND user_b=?")
      .bind(pair[0], pair[1])
      .first();
    if (!friend) return apiError("dm.friendsOnly", 403);

    const body = await bodyJson(request);
    const target = await env.DB.prepare("SELECT * FROM decave_users WHERE id=?").bind(row.to_user_id).first<UserRow>();
    if (!target) return apiError("common.userNotFound", 404);
    const outgoing = await checkOutgoingDm(env.DB, {
      enabled: dmE2eeEnabled(env),
      sender: user,
      target,
      text: body.text,
      envelope: body.envelope,
      attachmentKeys: body.attachmentKeys,
      editing: row.id,
    });
    if (!outgoing.ok) return apiErrorLegacy(outgoing.code, outgoing.i18nKey, outgoing.status);
    // An encrypted message is never edited back into plaintext.
    if (row.envelope && !outgoing.envelope) {
      return apiErrorLegacy("DM_E2EE_REQUIRED", "dm.editMustBeEncrypted", 409);
    }

    // An edit keeps the uploads the message already listed.
    const attachmentRefs = outgoing.envelope ? outgoing.attachmentRefs || row.attachment_refs || null : null;
    const updated = await updateDirectMessageWithAttachmentGuard(env.DB, {
      id: messageId,
      fromUserId: row.from_user_id,
      toUserId: row.to_user_id,
      text: outgoing.text,
      envelope: outgoing.envelope,
      attachmentRefs,
    });
    if (!updated.meta.changes) return apiErrorLegacy("DM_E2EE_INVALID", "dmE2ee.attachmentUnavailable", 400);

    const message = await dmMessageForClient(env, row.id);
    if (!message) return apiError("common.messageNotFound", 404);

    await realtimeBroadcast(env, { type: "DM_EDITED", message }, { userIds: [row.from_user_id, row.to_user_id] });

    return json({ message });
  }

  const dmReactionRoute = idFromPath(p, /^\/api\/dms\/messages\/([^/]+)\/reactions$/);
  if (method === "POST" && dmReactionRoute) {
    const user = await requireUser(request, env);
    if (user instanceof Response) return user;

    const messageId = decodeURIComponent(dmReactionRoute[1]);
    const row = await env.DB.prepare(
      `SELECT id, from_user_id, to_user_id, text, envelope
         FROM decave_direct_messages
         WHERE id=?`,
    )
      .bind(messageId)
      .first<{ id: string; from_user_id: string; to_user_id: string; text: string | null; envelope: string | null }>();

    if (!row) return apiError("common.messageNotFound", 404);
    if (user.id !== row.from_user_id && user.id !== row.to_user_id) {
      return apiError("dm.noAccess", 403);
    }
    if (await isBlockedEitherDirection(env.DB, row.from_user_id, row.to_user_id)) {
      return apiError("dm.blockedInteract", 403);
    }

    const body = await bodyJson(request);
    const enabled = dmE2eeEnabled(env);

    // Encrypted reactions: one envelope with all of this account's reactions and
    // poll votes on the message, replacing the last one (null removes them).
    if ("envelope" in body) {
      if (!enabled) return apiErrorLegacy("DM_E2EE_DISABLED", "dmE2ee.disabled", 409);
      if (!row.envelope) return apiErrorLegacy("DM_E2EE_INVALID", "dm.notEncrypted", 400);
      if (body.envelope === null) {
        await env.DB.prepare("DELETE FROM decave_dm_reaction_envelopes WHERE message_id=? AND user_id=?")
          .bind(messageId, user.id)
          .run();
      } else {
        const otherId = user.id === row.from_user_id ? row.to_user_id : row.from_user_id;
        const other = await env.DB.prepare("SELECT * FROM decave_users WHERE id=?").bind(otherId).first<UserRow>();
        if (!other) return apiError("common.userNotFound", 404);
        const checked = await checkReactionEnvelope(env.DB, {
          reactor: user,
          other,
          messageId,
          envelope: body.envelope,
        });
        if (!checked.ok) return apiErrorLegacy(checked.code, checked.i18nKey, checked.status);
        await env.DB.prepare(
          `INSERT INTO decave_dm_reaction_envelopes(message_id,user_id,envelope,updated_at) VALUES(?,?,?,?)
           ON CONFLICT(message_id,user_id) DO UPDATE SET envelope=excluded.envelope, updated_at=excluded.updated_at`,
        )
          .bind(messageId, user.id, checked.envelope, nowIso())
          .run();
      }
      const message = await dmMessageForClient(env, messageId);
      if (!message) return apiError("common.messageNotFound", 404);
      await realtimeBroadcast(
        env,
        { type: "DM_REACTION_UPDATED", message },
        { userIds: [row.from_user_id, row.to_user_id] },
      );
      return json({ message });
    }

    const emoji = typeof body.emoji === "string" ? body.emoji.slice(0, 24) : "";
    if (!emoji) return apiError("dm.emojiRequired", 400);
    // Reactions to an encrypted message are encrypted too, once encryption is on.
    if (row.envelope && enabled) {
      return apiErrorLegacy("DM_E2EE_REQUIRED", "dm.reactionsEncrypted", 409);
    }

    const exists = await env.DB.prepare(
      `SELECT 1
         FROM decave_dm_reactions
         WHERE message_id=? AND user_id=? AND emoji=?`,
    )
      .bind(messageId, user.id, emoji)
      .first();

    // The server can't read an encrypted poll; see decideEncryptedPollVote.
    const pollVote = row.envelope
      ? decideEncryptedPollVote(emoji, Boolean(exists))
      : decidePollVote(row.text, emoji, Boolean(exists), Date.now());
    if (pollVote.kind === "reject") return apiErrorLegacy(pollVote.code, pollVote.i18nKey, 400);

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
    if (!message) return apiError("common.messageNotFound", 404);

    await realtimeBroadcast(
      env,
      { type: "DM_REACTION_UPDATED", message },
      { userIds: [row.from_user_id, row.to_user_id] },
    );

    return json({ message });
  }

  return null;
}
