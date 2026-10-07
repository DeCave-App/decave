// Rooms: access, settings, messages, pins, search, reactions, attachments and
// Hub insights.

import { idFromPath, json, bodyJson } from "../lib/http";
import { requireUser } from "../lib/sessions";
import { getRoom, hasPermission, nowIso, getRole, canCreateForumPost, publicIdOf, audit } from "../db";
import {
  cleanRoomName,
  cleanRoomIcon,
  validatedHubRoleIds,
  validatedHubMemberPublicIds,
  replaceRoomMembers,
  canAccessRoom,
} from "../lib/hubs";
import {
  safeJsonStringArray,
  normalizeForumTags,
  structuredPrefixOf,
  FORUM_POST_PREFIX,
  validateForumPostExtras,
  rawForumPostJson,
} from "../../shared/forum";
import { realtimeRecheckAccess, realtimeBroadcast } from "../lib/realtime";
import { historyCursor, HISTORY_PAGE_SIZE } from "../lib/social";
import { messagesForClient, messageForClient } from "../lib/messages";
import {
  attemptQueuedMediaDeletion,
  deleteUnlinkedMedia,
  mediaDeletionQueueStatement,
  safeUploadedContentType,
} from "../lib/media";
import { requireHubPostingPermission } from "../lib/official-hubs";
import { decidePollVote } from "../pollVotes";
import type { ApiContext } from "./context";

export async function handleRoomRoutes({ request, env, url, p, method }: ApiContext): Promise<Response | null> {
  const roomAccess = idFromPath(p, /^\/api\/channels\/(\d+)\/access$/);
  if (method === "GET" && roomAccess) {
    const user = await requireUser(request, env);
    if (user instanceof Response) return user;
    const roomId = Number(roomAccess[1]);
    const room = await getRoom(env.DB, roomId);
    if (!room) return json({ error: "Room not found" }, 404);
    if (!(await hasPermission(env.DB, room.hub_id, user.id, "manageRooms")))
      return json({ error: "Missing manageRooms permission" }, 403);
    const rows = await env.DB.prepare(
      `SELECT u.public_id FROM decave_room_members rm JOIN decave_users u ON u.id=rm.user_id WHERE rm.room_id=? ORDER BY u.username`,
    )
      .bind(roomId)
      .all<{ public_id: string | null }>();
    return json({
      private: room.private === 1,
      memberIds: rows.results.map((row) => row.public_id).filter((id): id is string => Boolean(id)),
    });
  }

  const roomBase = idFromPath(p, /^\/api\/channels\/(\d+)$/);
  if (roomBase && (method === "PATCH" || method === "DELETE")) {
    const user = await requireUser(request, env);
    if (user instanceof Response) return user;
    const roomId = Number(roomBase[1]);
    const room = await getRoom(env.DB, roomId);
    if (!room) return json({ error: "Room not found" }, 404);
    if (!(await hasPermission(env.DB, room.hub_id, user.id, "manageRooms")))
      return json({ error: "Missing manageRooms permission" }, 403);
    if (method === "PATCH") {
      const body = await bodyJson(request);
      const name = body.name === undefined ? room.name : cleanRoomName(body.name);
      if (!name) return json({ error: "Room name is required" }, 400);
      // B8: same duplicate rule as room creation (excluding this room). The
      // position field is ignored; ordering goes through /channels/reorder.
      const dup = await env.DB.prepare(
        "SELECT 1 FROM decave_rooms WHERE hub_id=? AND name=? AND type=? AND kind=? AND id<>?",
      )
        .bind(room.hub_id, name, room.type, room.kind, roomId)
        .first();
      if (dup) return json({ error: "Room already exists" }, 409);
      const icon = body.icon === undefined ? room.icon : cleanRoomIcon(body.icon);
      const category = typeof body.category === "string" ? body.category.trim().slice(0, 40) : room.category;
      const priv = typeof body.private === "boolean" ? (body.private ? 1 : 0) : room.private;
      const forumGuidelines =
        room.kind === "forum" && typeof body.forumGuidelines === "string"
          ? body.forumGuidelines.trim().slice(0, 500)
          : room.forum_guidelines;
      const forumPostPolicy =
        room.kind === "forum" &&
        (body.forumPostPolicy === "everyone" ||
          body.forumPostPolicy === "staff" ||
          body.forumPostPolicy === "roles" ||
          body.forumPostPolicy === "members")
          ? body.forumPostPolicy
          : room.forum_post_policy;
      // B9: stored JSON is parsed defensively; B12: submitted ids must belong to this Hub.
      const forumPostRoleIds =
        forumPostPolicy === "roles" && body.forumPostRoleIds !== undefined
          ? await validatedHubRoleIds(env.DB, room.hub_id, body.forumPostRoleIds)
          : safeJsonStringArray(room.forum_post_role_ids_json);
      if (forumPostRoleIds === null)
        return json({ error: "Forum posting roles must be roles of this Hub", field: "forumPostRoleIds" }, 400);
      const forumPostMemberIds =
        forumPostPolicy === "members" && body.forumPostMemberIds !== undefined
          ? await validatedHubMemberPublicIds(env.DB, room.hub_id, body.forumPostMemberIds)
          : safeJsonStringArray(room.forum_post_member_ids_json);
      if (forumPostMemberIds === null)
        return json({ error: "Forum posting members must be members of this Hub", field: "forumPostMemberIds" }, 400);
      let forumTags = safeJsonStringArray(room.forum_tags_json);
      if (room.kind === "forum" && body.forumTags !== undefined) {
        const parsed = normalizeForumTags(body.forumTags);
        if (!parsed.ok) return json({ error: parsed.error, field: "forumTags" }, 400);
        forumTags = parsed.tags;
      }
      await env.DB.prepare(
        "UPDATE decave_rooms SET name=?,icon=?,category=?,private=?,forum_guidelines=?,forum_post_policy=?,forum_post_role_ids_json=?,forum_post_member_ids_json=?,forum_tags_json=?,updated_at=? WHERE id=?",
      )
        .bind(
          name,
          icon,
          category,
          priv,
          forumGuidelines,
          forumPostPolicy,
          JSON.stringify(forumPostRoleIds),
          JSON.stringify(forumPostMemberIds),
          JSON.stringify(forumTags),
          nowIso(),
          roomId,
        )
        .run();
      if (priv === 1 && body.memberIds !== undefined)
        await replaceRoomMembers(env.DB, roomId, room.hub_id, user.id, body.memberIds);
      else if (priv !== 1) await env.DB.prepare("DELETE FROM decave_room_members WHERE room_id=?").bind(roomId).run();
      await realtimeRecheckAccess(env, room.hub_id);
      await realtimeBroadcast(env, { type: "SERVERS_REFRESH" }, { hubId: room.hub_id });
      const { forum_tags_json: _storedTags, ...publicRoom } = room;
      return json({
        ...publicRoom,
        name,
        icon,
        category,
        private: priv === 1,
        position: room.position,
        forumGuidelines,
        forumPostPolicy,
        forumPostRoleIds,
        forumPostMemberIds,
        forumTags,
      });
    }
    const count = await env.DB.prepare(
      "SELECT COUNT(*) count,SUM(CASE WHEN type='text' THEN 1 ELSE 0 END) texts FROM decave_rooms WHERE hub_id=?",
    )
      .bind(room.hub_id)
      .first<{ count: number; texts: number }>();
    if (Number(count?.count ?? 0) <= 1) return json({ error: "A server must have at least one room" }, 400);
    if (room.type === "text" && Number(count?.texts ?? 0) <= 1)
      return json({ error: "A server must keep at least one text room" }, 400);
    const attachmentKeys = await env.DB.prepare(
      `SELECT attachment_key AS object_key FROM decave_messages WHERE room_id=? AND attachment_key IS NOT NULL
       UNION SELECT r2_key AS object_key FROM decave_attachment_access WHERE room_id=?`,
    )
      .bind(roomId, roomId)
      .all<{ object_key: string }>();
    const mediaKeys = [...new Set(attachmentKeys.results.map((row) => row.object_key))];
    await env.DB.batch([
      env.DB.prepare(
        `INSERT OR IGNORE INTO decave_media_deletion_queue(object_key,queued_at,attempts,last_attempt_at)
         SELECT object_key,?,0,NULL FROM (
           SELECT attachment_key AS object_key FROM decave_messages WHERE room_id=? AND attachment_key IS NOT NULL
           UNION SELECT r2_key AS object_key FROM decave_attachment_access WHERE room_id=?
         )`,
      ).bind(nowIso(), roomId, roomId),
      env.DB.prepare("DELETE FROM decave_rooms WHERE id=?").bind(roomId),
      env.DB.prepare("DELETE FROM decave_attachment_access WHERE room_id=?").bind(roomId),
    ]);
    await attemptQueuedMediaDeletion(env, mediaKeys);
    const fallback = await env.DB.prepare(
      "SELECT id FROM decave_rooms WHERE hub_id=? ORDER BY CASE WHEN type='text' THEN 0 ELSE 1 END,position,id LIMIT 1",
    )
      .bind(room.hub_id)
      .first<{ id: number }>();
    // B3: end voice sessions in the deleted room server-side before clients hear about it.
    await realtimeRecheckAccess(env, room.hub_id);
    await realtimeBroadcast(
      env,
      {
        type: "CHANNEL_DELETED",
        serverId: room.hub_id,
        channelId: roomId,
        fallbackChannelId: Number(fallback?.id ?? 0),
      },
      { hubId: room.hub_id },
    );
    return json({
      success: true,
      deletedChannelId: roomId,
      serverId: room.hub_id,
      fallbackChannelId: Number(fallback?.id ?? 0),
    });
  }

  const messagesRoute = idFromPath(p, /^\/api\/channels\/(\d+)\/messages$/);
  if (method === "GET" && messagesRoute) {
    const user = await requireUser(request, env);
    if (user instanceof Response) return user;
    const roomId = Number(messagesRoute[1]);
    const room = await getRoom(env.DB, roomId);
    if (!room) return json({ error: "Room not found" }, 404);
    if (!(await canAccessRoom(env.DB, room, user.id)))
      return json({ error: "You do not have access to this room" }, 403);
    const cursor = await historyCursor(
      env,
      "decave_messages",
      new URL(request.url).searchParams.get("before"),
      "room_id=?",
      [roomId],
    );
    if (cursor === false) return json([]);
    const rows = await env.DB.prepare(
      `SELECT id FROM decave_messages WHERE room_id=?${cursor ? " AND (created_at < ? OR (created_at = ? AND id < ?))" : ""} ORDER BY created_at DESC, id DESC LIMIT ${HISTORY_PAGE_SIZE}`,
    )
      .bind(roomId, ...(cursor ? [cursor.createdAt, cursor.createdAt, cursor.id] : []))
      .all<{ id: string }>();
    return json(
      await messagesForClient(
        env,
        rows.results.reverse().map((x) => x.id),
      ),
    );
  }

  // Pinned messages panel: every pinned message in a room, newest first.
  const pinsRoute = idFromPath(p, /^\/api\/channels\/(\d+)\/pins$/);
  if (method === "GET" && pinsRoute) {
    const user = await requireUser(request, env);
    if (user instanceof Response) return user;
    const roomId = Number(pinsRoute[1]);
    const room = await getRoom(env.DB, roomId);
    if (!room) return json({ error: "Room not found" }, 404);
    if (!(await canAccessRoom(env.DB, room, user.id)))
      return json({ error: "You do not have access to this room" }, 403);
    const rows = await env.DB.prepare(
      "SELECT id FROM decave_messages WHERE room_id=? AND pinned=1 ORDER BY created_at DESC, id DESC LIMIT 100",
    )
      .bind(roomId)
      .all<{ id: string }>();
    return json(
      {
        pins: await messagesForClient(
          env,
          rows.results.map((row) => row.id),
        ),
      },
      200,
      { "Cache-Control": "no-store, private" },
    );
  }

  // Hub insights for owners and admins: activity over the last weeks, busiest
  // hours and rooms nobody uses. Counts only; no message text leaves here.
  const insightsRoute = idFromPath(p, /^\/api\/servers\/(\d+)\/insights$/);
  if (method === "GET" && insightsRoute) {
    const user = await requireUser(request, env);
    if (user instanceof Response) return user;
    const hubId = Number(insightsRoute[1]);
    const role = await getRole(env.DB, hubId, user.id);
    if (role !== "owner" && role !== "admin")
      return json({ error: "Only the Hub owner and admins can see insights." }, 403);
    const now = Date.now();
    const iso = (daysAgo: number) => new Date(now - daysAgo * 86400000).toISOString();
    const one = async <T>(sql: string, ...binds: unknown[]) =>
      await env.DB.prepare(sql)
        .bind(...binds)
        .first<T>();
    const all = async <T>(sql: string, ...binds: unknown[]) =>
      (
        await env.DB.prepare(sql)
          .bind(...binds)
          .all<T>()
      ).results;
    const members = await one<{ total: number; recent: number }>(
      "SELECT COUNT(*) AS total, SUM(CASE WHEN joined_at>=? THEN 1 ELSE 0 END) AS recent FROM decave_hub_members WHERE hub_id=?",
      iso(7),
      hubId,
    );
    const week = await one<{ messages: number; people: number }>(
      "SELECT COUNT(*) AS messages, COUNT(DISTINCT author_user_id) AS people FROM decave_messages WHERE hub_id=? AND created_at>=?",
      hubId,
      iso(7),
    );
    const previous = await one<{ messages: number; people: number }>(
      "SELECT COUNT(*) AS messages, COUNT(DISTINCT author_user_id) AS people FROM decave_messages WHERE hub_id=? AND created_at>=? AND created_at<?",
      hubId,
      iso(14),
      iso(7),
    );
    const daily = await all<{ day: string; messages: number }>(
      "SELECT substr(created_at,1,10) AS day, COUNT(*) AS messages FROM decave_messages WHERE hub_id=? AND created_at>=? GROUP BY day ORDER BY day",
      hubId,
      iso(14),
    );
    const hours = await all<{ hour: string; messages: number }>(
      "SELECT substr(created_at,12,2) AS hour, COUNT(*) AS messages FROM decave_messages WHERE hub_id=? AND created_at>=? GROUP BY hour",
      hubId,
      iso(30),
    );
    const rooms = await all<{ id: number; name: string; type: string; messages: number; last: string | null }>(
      `SELECT r.id, r.name, r.type, COUNT(m.id) AS messages, MAX(m.created_at) AS last
       FROM decave_rooms r LEFT JOIN decave_messages m ON m.room_id=r.id AND m.created_at>=?
       WHERE r.hub_id=? GROUP BY r.id ORDER BY messages DESC, r.position`,
      iso(30),
      hubId,
    );
    const top = await all<{ username: string; messages: number }>(
      `SELECT u.username, COUNT(*) AS messages FROM decave_messages m JOIN decave_users u ON u.id=m.author_user_id
       WHERE m.hub_id=? AND m.created_at>=? AND u.deleted_at IS NULL GROUP BY m.author_user_id ORDER BY messages DESC LIMIT 5`,
      hubId,
      iso(30),
    );
    const byDay = new Map(daily.map((row) => [row.day, Number(row.messages)]));
    const days = Array.from({ length: 14 }, (_, index) => {
      const day = new Date(now - (13 - index) * 86400000).toISOString().slice(0, 10);
      return { day, messages: byDay.get(day) ?? 0 };
    });
    const byHour = new Map(hours.map((row) => [Number(row.hour), Number(row.messages)]));
    return json(
      {
        generatedAt: new Date(now).toISOString(),
        members: { total: Number(members?.total ?? 0), joinedThisWeek: Number(members?.recent ?? 0) },
        thisWeek: { messages: Number(week?.messages ?? 0), activePeople: Number(week?.people ?? 0) },
        lastWeek: { messages: Number(previous?.messages ?? 0), activePeople: Number(previous?.people ?? 0) },
        days,
        // UTC hours 0-23; the app shifts them to the viewer's time zone.
        hoursUtc: Array.from({ length: 24 }, (_, hour) => byHour.get(hour) ?? 0),
        rooms: rooms.map((row) => ({
          id: row.id,
          name: row.name,
          type: row.type,
          messages30d: Number(row.messages),
          lastMessageAt: row.last,
        })),
        topPosters: top.map((row) => ({ username: row.username, messages30d: Number(row.messages) })),
      },
      200,
      { "Cache-Control": "no-store, private" },
    );
  }

  const search = idFromPath(p, /^\/api\/channels\/(\d+)\/search$/);
  if (method === "GET" && search) {
    const user = await requireUser(request, env);
    if (user instanceof Response) return user;
    const roomId = Number(search[1]);
    const room = await getRoom(env.DB, roomId);
    if (!room) return json({ error: "Room not found" }, 404);
    if (!(await canAccessRoom(env.DB, room, user.id))) return json({ error: "No access" }, 403);
    const q = (url.searchParams.get("q") ?? "").trim();
    if (!q) return json([]);
    const rows = await env.DB.prepare(
      `SELECT m.id FROM decave_messages m JOIN decave_users u ON u.id=m.author_user_id WHERE m.room_id=? AND (LOWER(m.text) LIKE LOWER(?) OR LOWER(u.username) LIKE LOWER(?)) ORDER BY m.created_at DESC LIMIT 50`,
    )
      .bind(roomId, `%${q}%`, `%${q}%`)
      .all<{ id: string }>();
    const values = await Promise.all(rows.results.map((x) => messageForClient(env, x.id)));
    return json(values.filter(Boolean));
  }

  const messageItem = idFromPath(p, /^\/api\/channels\/(\d+)\/messages\/([^/]+)$/);
  if (messageItem && (method === "PATCH" || method === "DELETE")) {
    const user = await requireUser(request, env);
    if (user instanceof Response) return user;
    const roomId = Number(messageItem[1]);
    const messageId = decodeURIComponent(messageItem[2]);
    const room = await getRoom(env.DB, roomId);
    if (!room || !(await canAccessRoom(env.DB, room, user.id))) return json({ error: "No access" }, 403);
    const row = await env.DB.prepare(
      "SELECT hub_id,author_user_id,attachment_key,text,reply_to_id FROM decave_messages WHERE id=? AND room_id=?",
    )
      .bind(messageId, roomId)
      .first<{
        hub_id: number;
        author_user_id: string;
        attachment_key: string | null;
        text: string;
        reply_to_id: string | null;
      }>();
    if (!row) return json({ error: "Message not found" }, 404);
    if (method === "PATCH") {
      const postingError = await requireHubPostingPermission(env.DB, row.hub_id, user.id);
      if (postingError) return postingError;
      if (row.author_user_id !== user.id) return json({ error: "You can only edit your own messages" }, 403);
      const body = await bodyJson(request);
      const text = typeof body.text === "string" ? body.text.trim().slice(0, 4000) : "";
      if (!text) return json({ error: "Message cannot be empty" }, 400);
      // B10: edits cannot turn a message into (or out of) an event/forum post/poll/bot payload.
      if (structuredPrefixOf(row.text) !== structuredPrefixOf(text))
        return json(
          { error: "Structured messages cannot change type when edited", code: "STRUCTURED_TYPE_CHANGE" },
          400,
        );
      if (room.kind === "forum" && row.reply_to_id === null && text.startsWith(FORUM_POST_PREFIX)) {
        if (!(await canCreateForumPost(env.DB, room, user.id)))
          return json({ error: "Your role cannot create or edit posts in this forum" }, 403);
        const payloadOk = (() => {
          try {
            const v = JSON.parse(text.slice(FORUM_POST_PREFIX.length));
            return Boolean(v && typeof v === "object" && typeof v.title === "string" && v.title.trim());
          } catch {
            return false;
          }
        })();
        if (!payloadOk) return json({ error: "Forum posts need a title" }, 400);
        const extrasError = validateForumPostExtras(rawForumPostJson(text), Date.now(), { isEdit: true });
        if (extrasError) return json({ error: extrasError, code: "FORUM_POST_INVALID" }, 400);
        const roomTags = safeJsonStringArray(room.forum_tags_json);
        if (roomTags.length) {
          const allowedTags = new Set(roomTags.map((t) => t.toLowerCase()));
          const tags = safeJsonStringArray(
            JSON.stringify((JSON.parse(text.slice(FORUM_POST_PREFIX.length)) as { tags?: unknown }).tags ?? []),
          );
          if (tags.length > 5 || tags.some((t) => !allowedTags.has(t.trim().toLowerCase())))
            return json({ error: "Choose tags from this forum's tag list", code: "FORUM_TAG_INVALID" }, 400);
        }
      }
      await env.DB.prepare("UPDATE decave_messages SET text=?,edited_at=? WHERE id=?")
        .bind(text, nowIso(), messageId)
        .run();
      const message = await messageForClient(env, messageId);
      await realtimeBroadcast(env, { type: "MESSAGE_UPDATED", message }, { channelId: roomId });
      return json(message);
    }
    const role = await getRole(env.DB, row.hub_id, user.id);
    if (row.author_user_id !== user.id && role !== "owner" && role !== "admin")
      return json({ error: "You can only delete your own messages" }, 403);
    // Deleting a forum post deletes its thread; otherwise replies would become
    // orphaned top-level messages (reply_to_id is ON DELETE SET NULL).
    const threadReplies =
      room.kind === "forum" && row.reply_to_id === null
        ? (
            await env.DB.prepare("SELECT id,attachment_key FROM decave_messages WHERE reply_to_id=? AND room_id=?")
              .bind(messageId, roomId)
              .all<{ id: string; attachment_key: string | null }>()
          ).results
        : [];
    const attachmentKeys = [row.attachment_key, ...threadReplies.map((reply) => reply.attachment_key)].filter(
      (key): key is string => Boolean(key),
    );
    await env.DB.batch([
      ...[...new Set(attachmentKeys)].map((key) => mediaDeletionQueueStatement(env.DB, key, nowIso())),
      ...(threadReplies.length
        ? [env.DB.prepare("DELETE FROM decave_messages WHERE reply_to_id=? AND room_id=?").bind(messageId, roomId)]
        : []),
      env.DB.prepare("DELETE FROM decave_messages WHERE id=?").bind(messageId),
      ...(attachmentKeys.length
        ? [
            env.DB.prepare(
              `DELETE FROM decave_attachment_access WHERE r2_key IN (${[...new Set(attachmentKeys)].map(() => "?").join(",")})`,
            ).bind(...new Set(attachmentKeys)),
          ]
        : []),
    ]);
    await attemptQueuedMediaDeletion(env, attachmentKeys);
    await realtimeBroadcast(
      env,
      { type: "MESSAGE_DELETED", channelId: roomId, messageId, deletedByUserId: publicIdOf(user) },
      { channelId: roomId },
    );
    return json({ success: true, channelId: roomId, messageId });
  }

  const reaction = idFromPath(p, /^\/api\/channels\/(\d+)\/messages\/([^/]+)\/reactions$/);
  if (method === "POST" && reaction) {
    const user = await requireUser(request, env);
    if (user instanceof Response) return user;
    const roomId = Number(reaction[1]);
    const messageId = decodeURIComponent(reaction[2]);
    const room = await getRoom(env.DB, roomId);
    if (!room || !(await canAccessRoom(env.DB, room, user.id))) return json({ error: "No access" }, 403);
    const row = await env.DB.prepare("SELECT hub_id,reply_to_id,text FROM decave_messages WHERE id=? AND room_id=?")
      .bind(messageId, roomId)
      .first<{ hub_id: number; reply_to_id: string | null; text: string | null }>();
    if (!row) return json({ error: "Message not found" }, 404);
    const body = await bodyJson(request);
    const emoji = typeof body.emoji === "string" ? body.emoji.slice(0, 24) : "";
    if (!emoji) return json({ error: "Emoji required" }, 400);
    if (
      emoji.startsWith("forum_vote_") &&
      (room.kind !== "forum" || row.reply_to_id !== null || !(emoji === "forum_vote_up" || emoji === "forum_vote_down"))
    )
      return json({ error: "Invalid forum vote" }, 400);
    const exists = await env.DB.prepare(
      "SELECT 1 FROM decave_message_reactions WHERE message_id=? AND user_id=? AND emoji=?",
    )
      .bind(messageId, user.id, emoji)
      .first();
    const pollVote = decidePollVote(row.text, emoji, Boolean(exists), Date.now());
    if (pollVote.kind === "reject") return json({ error: pollVote.error, code: pollVote.code }, 400);
    if (exists)
      await env.DB.prepare("DELETE FROM decave_message_reactions WHERE message_id=? AND user_id=? AND emoji=?")
        .bind(messageId, user.id, emoji)
        .run();
    else {
      if (pollVote.kind === "allow" && pollVote.clearOtherPollVotes)
        await env.DB.prepare(
          "DELETE FROM decave_message_reactions WHERE message_id=? AND user_id=? AND substr(emoji,1,5)='poll_'",
        )
          .bind(messageId, user.id)
          .run();
      if (emoji === "forum_vote_up" || emoji === "forum_vote_down")
        await env.DB.prepare(
          "DELETE FROM decave_message_reactions WHERE message_id=? AND user_id=? AND emoji IN ('forum_vote_up','forum_vote_down')",
        )
          .bind(messageId, user.id)
          .run();
      await env.DB.prepare("INSERT INTO decave_message_reactions(message_id,user_id,emoji,created_at) VALUES(?,?,?,?)")
        .bind(messageId, user.id, emoji, nowIso())
        .run();
    }
    const message = await messageForClient(env, messageId);
    await realtimeBroadcast(env, { type: "MESSAGE_UPDATED", message }, { channelId: roomId });
    return json(message);
  }

  const pin = idFromPath(p, /^\/api\/channels\/(\d+)\/messages\/([^/]+)\/pin$/);
  if (method === "POST" && pin) {
    const user = await requireUser(request, env);
    if (user instanceof Response) return user;
    const roomId = Number(pin[1]);
    const messageId = decodeURIComponent(pin[2]);
    const room = await getRoom(env.DB, roomId);
    if (!room || !(await canAccessRoom(env.DB, room, user.id))) return json({ error: "No access" }, 403);
    const row = await env.DB.prepare(
      "SELECT hub_id,pinned,author_user_id FROM decave_messages WHERE id=? AND room_id=?",
    )
      .bind(messageId, roomId)
      .first<{ hub_id: number; pinned: number; author_user_id: string }>();
    if (!row) return json({ error: "Message not found" }, 404);
    if (!(await hasPermission(env.DB, row.hub_id, user.id, "moderateMessages")))
      return json({ error: "Moderate messages permission required" }, 403);
    const next = row.pinned ? 0 : 1;
    await env.DB.prepare("UPDATE decave_messages SET pinned=? WHERE id=?").bind(next, messageId).run();
    await audit(env.DB, row.hub_id, user.id, next ? "message.pin" : "message.unpin", row.author_user_id, messageId);
    const message = await messageForClient(env, messageId);
    await realtimeBroadcast(env, { type: "MESSAGE_UPDATED", message }, { channelId: roomId });
    return json(message);
  }

  const attachmentRoute = idFromPath(p, /^\/api\/channels\/(\d+)\/attachments$/);
  if (method === "POST" && attachmentRoute) {
    const user = await requireUser(request, env);
    if (user instanceof Response) return user;
    const roomId = Number(attachmentRoute[1]);
    const room = await getRoom(env.DB, roomId);
    if (!room) return json({ error: "Room not found" }, 404);
    if (!(await canAccessRoom(env.DB, room, user.id)))
      return json({ error: "You do not have access to this room" }, 403);
    const postingError = await requireHubPostingPermission(env.DB, room.hub_id, user.id);
    if (postingError) return postingError;
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
        request.headers.get("X-File-Type") ?? "application/octet-stream",
        new Uint8Array(bytes),
      );
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "Unsupported image data." }, 400);
    }
    const id = crypto.randomUUID();
    const key = `attachments/private/${id}`;
    await env.MEDIA.put(key, bytes, {
      httpMetadata: { contentType: mime, contentDisposition: `attachment; filename="${name.replace(/"/g, "")}"` },
    });
    try {
      await env.DB.prepare(
        `INSERT INTO decave_attachment_access(r2_key,kind,owner_user_id,peer_user_id,hub_id,room_id,created_at) VALUES(?, 'channel', ?, NULL, ?, ?, ?)`,
      )
        .bind(key, user.id, room.hub_id, roomId, nowIso())
        .run();
    } catch (error) {
      await deleteUnlinkedMedia(env, key);
      throw error;
    }
    return json({
      attachment: { id, name: name.slice(0, 180), mimeType: mime, size: bytes.byteLength, url: `/uploads/${key}` },
    });
  }

  return null;
}
