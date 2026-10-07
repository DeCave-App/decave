// Group chats: creating, messages, members and leaving.

import { requireUser } from "../lib/sessions";
import {
  ensureGroupChatSchema,
  type GroupChatRow,
  userByReference,
  type UserRow,
  usersAreFriends,
  nowIso,
  isGroupChatMember,
  groupChatMemberIds,
  publicIdOf,
} from "../db";
import { groupChatForClient, groupChatMessagesForClient } from "../lib/social";
import { json, bodyJson, idFromPath } from "../lib/http";
import { isBlockedEitherDirection } from "../trust-safety";
import { realtimeBroadcast } from "../lib/realtime";
import { ensureSquadFinderSchema } from "../lib/squad";
import { currentDmKey, dmE2eeEnabled } from "../lib/dm-e2ee";
import { ensureHubFeatureSchema } from "../lib/hub-schema";
import { ensureSoundboardSchema } from "../lib/soundboard";
import { attemptQueuedMediaDeletionIfQueued, hubMediaObjectKeys, queueHubMediaDeletionStatement } from "../lib/media";
import type { ApiContext } from "./context";

export async function handleGroupChatRoutes({ request, env, p, method }: ApiContext): Promise<Response | null> {
  if (method === "GET" && p === "/api/groups") {
    const user = await requireUser(request, env);
    if (user instanceof Response) return user;
    await ensureGroupChatSchema(env.DB);

    const rows = await env.DB.prepare(
      `SELECT g.*
         FROM decave_group_chats g
         JOIN decave_group_chat_members m ON m.group_id=g.id
         WHERE m.user_id=?
         ORDER BY g.updated_at DESC`,
    )
      .bind(user.id)
      .all<GroupChatRow>();

    const groups: Array<NonNullable<Awaited<ReturnType<typeof groupChatForClient>>>> = [];
    for (const row of rows.results) {
      const group = await groupChatForClient(env, row.id, true, user.id);
      if (group) groups.push(group);
    }
    return json({ groups });
  }

  if (method === "POST" && p === "/api/groups") {
    const user = await requireUser(request, env);
    if (user instanceof Response) return user;
    await ensureGroupChatSchema(env.DB);
    const body = await bodyJson(request);
    const rawIds = Array.isArray(body.memberIds)
      ? body.memberIds.filter((value): value is string => typeof value === "string")
      : [];
    const memberReferences = [...new Set(rawIds.map((value) => value.trim()).filter(Boolean))].slice(0, 19);
    const resolvedMembers = (
      await Promise.all(memberReferences.map((reference) => userByReference(env.DB, reference)))
    ).filter((value): value is UserRow => Boolean(value && !value.deleted_at && value.id !== user.id));
    const memberIds = [...new Set(resolvedMembers.map((value) => value.id))];

    if (memberIds.length < 2) {
      return json({ error: "Choose at least two friends for a group chat." }, 400);
    }

    for (const memberId of memberIds) {
      if (await isBlockedEitherDirection(env.DB, user.id, memberId)) {
        return json({ error: "A blocked user cannot be added to a group chat." }, 403);
      }
      if (!(await usersAreFriends(env.DB, user.id, memberId))) {
        return json({ error: "Group chats can only include your friends." }, 403);
      }
    }

    // An unnamed group is titled per viewer from the other members (see groupChatForClient).
    const name = typeof body.name === "string" ? body.name.trim().slice(0, 48) : "";

    const groupId = crypto.randomUUID();
    const createdAt = nowIso();
    const allMemberIds = [user.id, ...memberIds];
    const statements = [
      env.DB.prepare(
        `INSERT INTO decave_group_chats(id,name,owner_user_id,created_at,updated_at)
           VALUES(?,?,?,?,?)`,
      ).bind(groupId, name, user.id, createdAt, createdAt),
    ];
    for (const memberId of allMemberIds) {
      statements.push(
        env.DB.prepare(
          `INSERT INTO decave_group_chat_members(group_id,user_id,added_at)
             VALUES(?,?,?)`,
        ).bind(groupId, memberId, createdAt),
      );
    }
    await env.DB.batch(statements);

    await realtimeBroadcast(env, { type: "GROUP_CHAT_UPDATED", groupId }, { userIds: allMemberIds });
    return json({ group: await groupChatForClient(env, groupId, true, user.id) }, 201);
  }

  const groupBase = idFromPath(p, /^\/api\/groups\/([^/]+)$/);
  if (method === "GET" && groupBase) {
    const user = await requireUser(request, env);
    if (user instanceof Response) return user;
    const groupId = decodeURIComponent(groupBase[1]);
    if (!(await isGroupChatMember(env.DB, groupId, user.id))) {
      return json({ error: "You are not a member of this group chat." }, 403);
    }
    const group = await groupChatForClient(env, groupId, true, user.id);
    if (!group) return json({ error: "Group chat not found." }, 404);
    return json({
      group,
      messages: await groupChatMessagesForClient(env, groupId, new URL(request.url).searchParams.get("before")),
    });
  }

  if (method === "DELETE" && groupBase) {
    const user = await requireUser(request, env);
    if (user instanceof Response) return user;
    const groupId = decodeURIComponent(groupBase[1]);
    await ensureGroupChatSchema(env.DB);
    await ensureSquadFinderSchema(env);
    const group = await env.DB.prepare("SELECT * FROM decave_group_chats WHERE id=?")
      .bind(groupId)
      .first<GroupChatRow>();
    if (!group) return json({ error: "Group chat not found." }, 404);
    if (group.owner_user_id !== user.id) return json({ error: "Only the group owner can delete this group." }, 403);
    const memberIds = await groupChatMemberIds(env.DB, groupId);
    const squadRoom = await env.DB.prepare("SELECT hub_id FROM decave_squad_rooms WHERE group_id=?")
      .bind(groupId)
      .first<{ hub_id: number }>();
    let squadMediaKeys: string[] = [];
    if (squadRoom) {
      await ensureHubFeatureSchema(env);
      await ensureSoundboardSchema(env);
      squadMediaKeys = await hubMediaObjectKeys(env.DB, squadRoom.hub_id);
    }
    const statements = [
      env.DB.prepare("DELETE FROM decave_group_chat_messages WHERE group_id=?").bind(groupId),
      env.DB.prepare("DELETE FROM decave_group_chat_members WHERE group_id=?").bind(groupId),
      env.DB.prepare("DELETE FROM decave_group_chats WHERE id=?").bind(groupId),
    ];
    if (squadRoom) {
      statements.unshift(
        queueHubMediaDeletionStatement(
          env.DB,
          squadRoom.hub_id,
          nowIso(),
          "EXISTS(SELECT 1 FROM decave_group_chats WHERE id=? AND owner_user_id=?)",
          [groupId, user.id],
        ),
        env.DB.prepare("DELETE FROM decave_hubs WHERE id=?").bind(squadRoom.hub_id),
      );
    }
    await env.DB.batch(statements);
    if (squadRoom && squadMediaKeys.length) await attemptQueuedMediaDeletionIfQueued(env, squadMediaKeys);
    await realtimeBroadcast(env, { type: "GROUP_CHAT_REMOVED", groupId, deleted: true }, { userIds: memberIds });
    if (squadRoom) await realtimeBroadcast(env, { type: "SERVERS_REFRESH" }, { userIds: memberIds });
    return json({ success: true, deleted: true });
  }

  const groupMessage = idFromPath(p, /^\/api\/groups\/([^/]+)\/messages\/([^/]+)$/);
  if (method === "DELETE" && groupMessage) {
    const user = await requireUser(request, env);
    if (user instanceof Response) return user;
    const groupId = decodeURIComponent(groupMessage[1]);
    const messageId = decodeURIComponent(groupMessage[2]);
    await ensureGroupChatSchema(env.DB);

    const group = await env.DB.prepare("SELECT * FROM decave_group_chats WHERE id=?")
      .bind(groupId)
      .first<GroupChatRow>();
    if (!group) return json({ error: "Group chat not found." }, 404);
    if (!(await isGroupChatMember(env.DB, groupId, user.id))) {
      return json({ error: "You are not a member of this group chat." }, 403);
    }

    const message = await env.DB.prepare(
      "SELECT from_user_id FROM decave_group_chat_messages WHERE id=? AND group_id=?",
    )
      .bind(messageId, groupId)
      .first<{ from_user_id: string }>();
    if (!message) return json({ error: "Message not found." }, 404);
    if (message.from_user_id !== user.id && group.owner_user_id !== user.id) {
      return json({ error: "Only the message author or group owner can delete this message." }, 403);
    }

    await env.DB.batch([
      env.DB.prepare("DELETE FROM decave_group_chat_messages WHERE id=? AND group_id=?").bind(messageId, groupId),
      env.DB.prepare("UPDATE decave_group_chats SET updated_at=? WHERE id=?").bind(nowIso(), groupId),
    ]);
    const memberIds = await groupChatMemberIds(env.DB, groupId);
    await realtimeBroadcast(env, { type: "GROUP_CHAT_UPDATED", groupId }, { userIds: memberIds });
    return json({ success: true, messageId });
  }

  const groupMembers = idFromPath(p, /^\/api\/groups\/([^/]+)\/members$/);
  if (method === "POST" && groupMembers) {
    const user = await requireUser(request, env);
    if (user instanceof Response) return user;
    const groupId = decodeURIComponent(groupMembers[1]);
    await ensureGroupChatSchema(env.DB);
    if (!(await isGroupChatMember(env.DB, groupId, user.id))) {
      return json({ error: "You are not a member of this group chat." }, 403);
    }

    const body = await bodyJson(request);
    const targetReference = typeof body.userId === "string" ? body.userId.trim() : "";
    const targetUser = targetReference ? await userByReference(env.DB, targetReference) : null;
    const targetId = targetUser?.id ?? "";
    if (!targetId || targetId === user.id) return json({ error: "Choose a friend to add." }, 400);
    if (await isBlockedEitherDirection(env.DB, user.id, targetId)) {
      return json({ error: "This user is blocked. Unblock them before adding them to a group." }, 403);
    }
    if (!(await usersAreFriends(env.DB, user.id, targetId))) {
      return json({ error: "You can only add one of your friends." }, 403);
    }
    if (await isGroupChatMember(env.DB, groupId, targetId)) {
      return json({ error: "That friend is already in the group." }, 409);
    }

    const target = await env.DB.prepare("SELECT id FROM decave_users WHERE id=?")
      .bind(targetId)
      .first<{ id: string }>();
    if (!target) return json({ error: "User not found." }, 404);

    // An encrypted group stays encrypted: someone joining needs a key first.
    if (dmE2eeEnabled(env)) {
      const group = await env.DB.prepare("SELECT e2ee_since FROM decave_group_chats WHERE id=?")
        .bind(groupId)
        .first<{ e2ee_since: string | null }>();
      if (group?.e2ee_since && !(await currentDmKey(env.DB, targetId))) {
        return json(
          {
            error: "This group is end-to-end encrypted. Your friend needs to open an up-to-date DeCave first.",
            code: "DM_E2EE_MEMBER_NO_KEY",
          },
          409,
        );
      }
    }

    const now = nowIso();
    const addResults = await env.DB.batch([
      // Keep the capacity check in the INSERT write. A separate COUNT()
      // followed by INSERT lets concurrent requests both claim the twentieth
      // seat (or makes a group exceed its 20-member limit).
      env.DB.prepare(
        `INSERT OR IGNORE INTO decave_group_chat_members(group_id,user_id,added_at)
         SELECT ?,?,?
         WHERE EXISTS (SELECT 1 FROM decave_group_chats WHERE id=?)
           AND (SELECT COUNT(*) FROM decave_group_chat_members WHERE group_id=?) < 20`,
      ).bind(groupId, targetId, now, groupId, groupId),
      env.DB.prepare("UPDATE decave_group_chats SET updated_at=? WHERE id=?").bind(now, groupId),
    ]);
    if (Number(addResults[0]?.meta?.changes ?? 0) === 0) {
      if (await isGroupChatMember(env.DB, groupId, targetId)) {
        return json({ error: "That friend is already in the group." }, 409);
      }
      const count = await env.DB.prepare("SELECT COUNT(*) AS count FROM decave_group_chat_members WHERE group_id=?")
        .bind(groupId)
        .first<{ count: number }>();
      if (Number(count?.count ?? 0) >= 20) {
        return json({ error: "Group chats are limited to 20 members." }, 400);
      }
      return json({ error: "Group chat is no longer available." }, 404);
    }

    const memberIds = await groupChatMemberIds(env.DB, groupId);
    await realtimeBroadcast(
      env,
      { type: "GROUP_CHAT_UPDATED", groupId, addedUserId: targetUser ? publicIdOf(targetUser) : "" },
      { userIds: memberIds },
    );
    return json({ group: await groupChatForClient(env, groupId, true, user.id) });
  }

  const groupMember = idFromPath(p, /^\/api\/groups\/([^/]+)\/members\/([^/]+)$/);
  if (method === "DELETE" && groupMember) {
    const user = await requireUser(request, env);
    if (user instanceof Response) return user;
    const groupId = decodeURIComponent(groupMember[1]);
    const targetReference = decodeURIComponent(groupMember[2]);
    const targetUser = await userByReference(env.DB, targetReference);
    const targetId = targetUser?.id ?? "";
    if (!targetId) return json({ error: "That user is not in the group." }, 404);
    await ensureGroupChatSchema(env.DB);

    const group = await env.DB.prepare("SELECT * FROM decave_group_chats WHERE id=?")
      .bind(groupId)
      .first<GroupChatRow>();
    if (!group) return json({ error: "Group chat not found." }, 404);
    if (!(await isGroupChatMember(env.DB, groupId, user.id))) {
      return json({ error: "You are not a member of this group chat." }, 403);
    }
    if (!(await isGroupChatMember(env.DB, groupId, targetId))) {
      return json({ error: "That user is not in the group." }, 404);
    }
    if (targetId !== user.id && group.owner_user_id !== user.id) {
      return json({ error: "Only the group owner can remove another member." }, 403);
    }

    const beforeIds = await groupChatMemberIds(env.DB, groupId);
    if (targetId === group.owner_user_id) {
      if (beforeIds.length > 1) {
        return json({ error: "The group owner cannot leave while other members remain." }, 400);
      }
      await env.DB.batch([
        env.DB.prepare("DELETE FROM decave_group_chat_messages WHERE group_id=?").bind(groupId),
        env.DB.prepare("DELETE FROM decave_group_chat_members WHERE group_id=?").bind(groupId),
        env.DB.prepare("DELETE FROM decave_group_chats WHERE id=?").bind(groupId),
      ]);
      await realtimeBroadcast(
        env,
        { type: "GROUP_CHAT_REMOVED", groupId, userId: targetUser ? publicIdOf(targetUser) : "", deleted: true },
        { userIds: beforeIds },
      );
      return json({ success: true, deleted: true });
    }

    const now = nowIso();
    await env.DB.batch([
      env.DB.prepare("DELETE FROM decave_group_chat_members WHERE group_id=? AND user_id=?").bind(groupId, targetId),
      env.DB.prepare("UPDATE decave_group_chats SET updated_at=? WHERE id=?").bind(now, groupId),
    ]);
    const remainingIds = await groupChatMemberIds(env.DB, groupId);
    await realtimeBroadcast(
      env,
      { type: "GROUP_CHAT_REMOVED", groupId, userId: targetUser ? publicIdOf(targetUser) : "" },
      { userIds: [...new Set([...beforeIds, ...remainingIds])] },
    );
    return json({ success: true, group: await groupChatForClient(env, groupId, true, user.id) });
  }

  return null;
}
