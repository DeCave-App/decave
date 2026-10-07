// Direct messages: conversations, messages, attachments and reactions.

import { requireUser } from "../lib/sessions";
import { json, idFromPath, bodyJson } from "../lib/http";
import { realtimeFetch, realtimeBroadcast } from "../lib/realtime";
import { type UserRow, publicUserWithPresence, userByReference, nowIso, publicIdOf } from "../db";
import { isBlockedEitherDirection } from "../trust-safety";
import { dmMessageForClient, dmMessagesForClient } from "../lib/messages";
import { historyCursor, HISTORY_PAGE_SIZE } from "../lib/social";
import { dmReadAt } from "../read-state";
import { decidePollVote, decideEncryptedPollVote } from "../pollVotes";
import { checkOutgoingDm, checkReactionEnvelope, dmE2eeEnabled } from "../lib/dm-e2ee";
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
    const mime = (
      request.headers.get("X-File-Type") ??
      request.headers.get("Content-Type") ??
      "application/octet-stream"
    ).slice(0, 160);
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
      const outgoing = await checkOutgoingDm(env.DB, {
        enabled: dmE2eeEnabled(env),
        sender: user,
        target,
        text: body.text,
        envelope: body.envelope,
        attachmentKeys: body.attachmentKeys,
      });
      if (!outgoing.ok) return json({ error: outgoing.error, code: outgoing.code }, outgoing.status);
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
      const id = outgoing.id ?? crypto.randomUUID();
      const createdAt = nowIso();
      const inserted = await env.DB.prepare(
        `INSERT INTO decave_direct_messages(id,from_user_id,to_user_id,text,envelope,created_at,reply_to_id,attachment_refs)
         VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING`,
      )
        .bind(
          id,
          user.id,
          targetId,
          outgoing.text,
          outgoing.envelope,
          createdAt,
          replyToId,
          outgoing.attachmentRefs || null,
        )
        .run();
      if (!inserted.meta.changes) return json({ error: "That message was already sent." }, 409);
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

    if (!row) return json({ error: "Message not found." }, 404);
    if (row.from_user_id !== user.id) {
      return json({ error: "You can only change messages you sent." }, 403);
    }

    if (method === "DELETE") {
      await env.DB.batch([
        env.DB.prepare("DELETE FROM decave_direct_messages WHERE id=?").bind(messageId),
        env.DB.prepare("DELETE FROM decave_dm_reactions WHERE message_id=?").bind(messageId),
        env.DB.prepare("DELETE FROM decave_dm_reaction_envelopes WHERE message_id=?").bind(messageId),
      ]);
      // Delete the files this message carried, not just the message. An encrypted
      // message lists them in attachment_refs.
      const carried = `${row.text} ${row.attachment_refs ?? ""}`;
      for (const key of new Set(carried.match(/attachments\/private\/[0-9a-f-]{36}/g) ?? [])) {
        const owned = await env.DB.prepare(
          "DELETE FROM decave_attachment_access WHERE r2_key=? AND kind='dm' AND owner_user_id=? RETURNING r2_key",
        )
          .bind(key, user.id)
          .first<{ r2_key: string }>();
        if (owned) await env.MEDIA.delete(key);
      }

      await realtimeBroadcast(env, { type: "DM_DELETED", messageId }, { userIds: [row.from_user_id, row.to_user_id] });

      return json({ success: true });
    }

    const body = await bodyJson(request);
    const target = await env.DB.prepare("SELECT * FROM decave_users WHERE id=?").bind(row.to_user_id).first<UserRow>();
    if (!target) return json({ error: "User not found" }, 404);
    const outgoing = await checkOutgoingDm(env.DB, {
      enabled: dmE2eeEnabled(env),
      sender: user,
      target,
      text: body.text,
      envelope: body.envelope,
      attachmentKeys: body.attachmentKeys,
      editing: row.id,
    });
    if (!outgoing.ok) return json({ error: outgoing.error, code: outgoing.code }, outgoing.status);
    // An encrypted message is never edited back into plaintext.
    if (row.envelope && !outgoing.envelope) {
      return json({ error: "Edits to an encrypted message must be encrypted too.", code: "DM_E2EE_REQUIRED" }, 409);
    }

    // An edit keeps the uploads the message already listed.
    const attachmentRefs = outgoing.envelope ? outgoing.attachmentRefs || row.attachment_refs || null : null;
    await env.DB.prepare("UPDATE decave_direct_messages SET text=?, envelope=?, attachment_refs=? WHERE id=?")
      .bind(outgoing.text, outgoing.envelope, attachmentRefs, messageId)
      .run();

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
      `SELECT id, from_user_id, to_user_id, text, envelope
         FROM decave_direct_messages
         WHERE id=?`,
    )
      .bind(messageId)
      .first<{ id: string; from_user_id: string; to_user_id: string; text: string | null; envelope: string | null }>();

    if (!row) return json({ error: "Message not found." }, 404);
    if (user.id !== row.from_user_id && user.id !== row.to_user_id) {
      return json({ error: "No access to this private message." }, 403);
    }
    if (await isBlockedEitherDirection(env.DB, row.from_user_id, row.to_user_id)) {
      return json({ error: "This user is blocked. Unblock them before interacting with private messages." }, 403);
    }

    const body = await bodyJson(request);
    const enabled = dmE2eeEnabled(env);

    // Encrypted reactions: one envelope with all of this account's reactions and
    // poll votes on the message, replacing the last one (null removes them).
    if ("envelope" in body) {
      if (!enabled) return json({ error: "Encrypted messages aren't available yet.", code: "DM_E2EE_DISABLED" }, 409);
      if (!row.envelope) return json({ error: "That message isn't encrypted.", code: "DM_E2EE_INVALID" }, 400);
      if (body.envelope === null) {
        await env.DB.prepare("DELETE FROM decave_dm_reaction_envelopes WHERE message_id=? AND user_id=?")
          .bind(messageId, user.id)
          .run();
      } else {
        const otherId = user.id === row.from_user_id ? row.to_user_id : row.from_user_id;
        const other = await env.DB.prepare("SELECT * FROM decave_users WHERE id=?").bind(otherId).first<UserRow>();
        if (!other) return json({ error: "User not found" }, 404);
        const checked = await checkReactionEnvelope(env.DB, {
          reactor: user,
          other,
          messageId,
          envelope: body.envelope,
        });
        if (!checked.ok) return json({ error: checked.error, code: checked.code }, checked.status);
        await env.DB.prepare(
          `INSERT INTO decave_dm_reaction_envelopes(message_id,user_id,envelope,updated_at) VALUES(?,?,?,?)
           ON CONFLICT(message_id,user_id) DO UPDATE SET envelope=excluded.envelope, updated_at=excluded.updated_at`,
        )
          .bind(messageId, user.id, checked.envelope, nowIso())
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

    const emoji = typeof body.emoji === "string" ? body.emoji.slice(0, 24) : "";
    if (!emoji) return json({ error: "Emoji required." }, 400);
    // Reactions to an encrypted message are encrypted too, once encryption is on.
    if (row.envelope && enabled) {
      return json(
        { error: "Reactions here are end-to-end encrypted. Update DeCave to react.", code: "DM_E2EE_REQUIRED" },
        409,
      );
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
