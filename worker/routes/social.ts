// Friends and DM preferences.

import { requireUser } from "../lib/sessions";
import { ensureCollaborationSchema } from "../lib/hub-schema";
import { json, idFromPath, bodyJson } from "../lib/http";
import { userByReference, usersAreFriends, nowIso, publicIdOf, publicUser } from "../db";
import { socialState, usersHaveMutualFriend } from "../lib/social";
import { isBlockedEitherDirection } from "../trust-safety";
import { accountPreferencesRow } from "../lib/account-preferences";
import { realtimeBroadcast } from "../lib/realtime";
import type { ApiContext } from "./context";

export async function handleDmPreferenceRoutes({ request, env, p, method }: ApiContext): Promise<Response | null> {
  if (method === "GET" && p === "/api/social/dm-preferences") {
    const user = await requireUser(request, env);
    if (user instanceof Response) return user;
    await ensureCollaborationSchema(env);
    const rows = await env.DB.prepare(
      `SELECT peer.public_id AS userId, pref.favorite, pref.archived
       FROM decave_dm_preferences pref
       JOIN decave_users peer ON peer.id=pref.peer_user_id
       WHERE pref.user_id=?
       ORDER BY pref.updated_at DESC`,
    )
      .bind(user.id)
      .all<{ userId: string | null; favorite: number; archived: number }>();
    return json({
      preferences: rows.results
        .filter((row) => Boolean(row.userId))
        .map((row) => ({
          userId: row.userId ?? "",
          favorite: row.favorite === 1,
          archived: row.archived === 1,
        })),
    });
  }

  const dmPreferenceRoute = idFromPath(p, /^\/api\/social\/dm-preferences\/([^/]+)$/);
  if (method === "PATCH" && dmPreferenceRoute) {
    const user = await requireUser(request, env);
    if (user instanceof Response) return user;
    await ensureCollaborationSchema(env);
    const peer = await userByReference(env.DB, decodeURIComponent(dmPreferenceRoute[1]));
    if (!peer || peer.id === user.id) return json({ error: "User not found" }, 404);

    const areFriends = await usersAreFriends(env.DB, user.id, peer.id);
    const hasConversation = await env.DB.prepare(
      `SELECT 1 FROM decave_direct_messages
       WHERE (from_user_id=? AND to_user_id=?) OR (from_user_id=? AND to_user_id=?)
       LIMIT 1`,
    )
      .bind(user.id, peer.id, peer.id, user.id)
      .first();
    if (!areFriends && !hasConversation) {
      return json({ error: "You do not have a conversation with this user" }, 403);
    }

    const body = await bodyJson(request);
    const existing = await env.DB.prepare(
      "SELECT favorite,archived FROM decave_dm_preferences WHERE user_id=? AND peer_user_id=?",
    )
      .bind(user.id, peer.id)
      .first<{ favorite: number; archived: number }>();
    const favorite = typeof body.favorite === "boolean" ? (body.favorite ? 1 : 0) : Number(existing?.favorite ?? 0);
    const archived = typeof body.archived === "boolean" ? (body.archived ? 1 : 0) : Number(existing?.archived ?? 0);
    await env.DB.prepare(
      `INSERT INTO decave_dm_preferences(user_id,peer_user_id,favorite,archived,updated_at)
       VALUES(?,?,?,?,?)
       ON CONFLICT(user_id,peer_user_id) DO UPDATE SET
         favorite=excluded.favorite,archived=excluded.archived,updated_at=excluded.updated_at`,
    )
      .bind(user.id, peer.id, favorite, archived, nowIso())
      .run();
    return json({ userId: publicIdOf(peer), favorite: favorite === 1, archived: archived === 1 });
  }

  return null;
}

export async function handleFriendRoutes({ request, env, p, method }: ApiContext): Promise<Response | null> {
  if (method === "GET" && p === "/api/social") {
    const user = await requireUser(request, env);
    return user instanceof Response
      ? user
      : json(await socialState(env, user.id), 200, { "Cache-Control": "no-store, private" });
  }

  const friendRoute = idFromPath(p, /^\/api\/friends\/([^/]+)(?:\/(request|accept|reject))?$/);
  if (friendRoute && (method === "POST" || method === "DELETE")) {
    const user = await requireUser(request, env);
    if (user instanceof Response) return user;
    const targetReference = decodeURIComponent(friendRoute[1]).trim();
    const action = friendRoute[2] ?? (method === "DELETE" ? "remove" : "");
    if (!/^DC-[A-F0-9]{16}$/i.test(targetReference)) return json({ error: "Enter a valid public DeCave ID." }, 400);
    const target = await userByReference(env.DB, targetReference);
    if (!target || target.id === user.id || target.deleted_at) return json({ error: "User not found" }, 404);
    const targetId = target.id;

    const pair = [user.id, targetId].sort();
    if ((action === "request" || action === "accept") && (await isBlockedEitherDirection(env.DB, user.id, targetId))) {
      return json({ error: "This user is blocked. Unblock them before connecting." }, 403);
    }
    if (action === "request") {
      const incoming = await env.DB.prepare("SELECT 1 FROM decave_friend_requests WHERE sender_id=? AND recipient_id=?")
        .bind(targetId, user.id)
        .first();
      if (incoming) {
        await env.DB.batch([
          env.DB.prepare("DELETE FROM decave_friend_requests WHERE sender_id=? AND recipient_id=?").bind(
            targetId,
            user.id,
          ),
          env.DB.prepare("INSERT OR IGNORE INTO decave_friendships(user_a,user_b,created_at) VALUES(?,?,?)").bind(
            pair[0],
            pair[1],
            nowIso(),
          ),
        ]);
      } else {
        const targetPreferences = await accountPreferencesRow(env, targetId);
        const policy =
          targetPreferences.friend_request_policy === "friends_of_friends" ||
          targetPreferences.friend_request_policy === "none"
            ? targetPreferences.friend_request_policy
            : "everyone";
        if (policy === "none") {
          return json({ error: "This user is not accepting friend requests." }, 403);
        }
        if (policy === "friends_of_friends" && !(await usersHaveMutualFriend(env.DB, user.id, targetId))) {
          return json({ error: "This user only accepts friend requests from friends of friends." }, 403);
        }
        await env.DB.prepare(
          "INSERT OR IGNORE INTO decave_friend_requests(sender_id,recipient_id,created_at) VALUES(?,?,?)",
        )
          .bind(user.id, targetId, nowIso())
          .run();
      }
    } else if (action === "accept") {
      const incoming = await env.DB.prepare("SELECT 1 FROM decave_friend_requests WHERE sender_id=? AND recipient_id=?")
        .bind(targetId, user.id)
        .first();
      if (!incoming) return json({ error: "Friend request not found" }, 404);
      await env.DB.batch([
        env.DB.prepare("DELETE FROM decave_friend_requests WHERE sender_id=? AND recipient_id=?").bind(
          targetId,
          user.id,
        ),
        env.DB.prepare("INSERT OR IGNORE INTO decave_friendships(user_a,user_b,created_at) VALUES(?,?,?)").bind(
          pair[0],
          pair[1],
          nowIso(),
        ),
      ]);
    } else if (action === "reject") {
      await env.DB.prepare("DELETE FROM decave_friend_requests WHERE sender_id=? AND recipient_id=?")
        .bind(targetId, user.id)
        .run();
    } else if (action === "remove") {
      await env.DB.batch([
        env.DB.prepare("DELETE FROM decave_friendships WHERE user_a=? AND user_b=?").bind(pair[0], pair[1]),
        env.DB.prepare(
          "DELETE FROM decave_friend_requests WHERE (sender_id=? AND recipient_id=?) OR (sender_id=? AND recipient_id=?)",
        ).bind(user.id, targetId, targetId, user.id),
      ]);
    }
    await realtimeBroadcast(env, { type: "SOCIAL_REFRESH" }, { userIds: [user.id, targetId] });
    return json({ success: true, target: publicUser(target) });
  }

  return null;
}
