// Realtime: the global room Durable Object and broadcasts to connected clients.

import type { Env } from "./env";
import type { HubRoom } from "../HubRoom";
import { type UserRow, publicUserWithPresence, presenceOnline, activityVisibilityOf } from "../db";

export async function globalRoom(env: Env): Promise<DurableObjectStub<HubRoom>> {
  return env.HUB_ROOM.get(env.HUB_ROOM.idFromName("decave-global"));
}

export async function realtimeFetch(env: Env, path: string, payload?: unknown): Promise<Response> {
  const room = await globalRoom(env);
  return room.fetch(
    new Request(`https://internal.decave${path}`, {
      method: payload === undefined ? "GET" : "POST",
      headers: payload === undefined ? undefined : { "content-type": "application/json" },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    }),
  );
}

/**
 * Internal ids of accounts with a live socket. Presence projections
 * (publicUserWithPresence) need this so stored status/activity of a
 * disconnected account is never shown. Fails closed (nobody online).
 */
export async function connectedUserIds(env: Env): Promise<Set<string>> {
  try {
    const response = await realtimeFetch(env, "/internal/online-users");
    if (!response.ok) return new Set();
    const data = (await response.json()) as { userIds?: string[] };
    return new Set(data.userIds ?? []);
  } catch {
    return new Set();
  }
}

export async function realtimeBroadcast(env: Env, event: unknown, filter: Record<string, unknown> = {}): Promise<void> {
  await realtimeFetch(env, "/internal/broadcast", { event, filter });
}

/**
 * Tell connected clients a profile changed. Everyone gets the public view;
 * when the user shows their game to friends only, friends get a second copy
 * that carries it.
 */
export async function broadcastProfileUpdate(env: Env, user: UserRow): Promise<void> {
  const online = presenceOnline(user, (await connectedUserIds(env)).has(user.id));
  const pub = publicUserWithPresence(user, online, "other");
  // Match usersSharePublicContext: self, a friendship, any friend request, or
  // a shared Hub. The global room includes anonymous sockets, so always scope
  // profile events to this eligible set.
  const eligible = await env.DB.prepare(
    `SELECT id FROM decave_users WHERE id=?
     UNION SELECT CASE WHEN user_a=? THEN user_b ELSE user_a END
       FROM decave_friendships WHERE user_a=? OR user_b=?
     UNION SELECT sender_id FROM decave_friend_requests WHERE recipient_id=?
     UNION SELECT recipient_id FROM decave_friend_requests WHERE sender_id=?
     UNION SELECT a.user_id FROM decave_hub_members a
       JOIN decave_hub_members b ON b.hub_id=a.hub_id
       WHERE b.user_id=? AND a.user_id<>?`,
  )
    .bind(user.id, user.id, user.id, user.id, user.id, user.id, user.id, user.id)
    .all<{ id: string }>();
  const eligibleIds = [...new Set(eligible.results.map((row) => row.id))];
  if (eligibleIds.length)
    await realtimeBroadcast(env, { type: "PROFILE_UPDATED", user: pub }, { userIds: eligibleIds });
  if (!online || activityVisibilityOf(user) !== "friends" || !user.activity_text) return;
  const rows = await env.DB.prepare(
    "SELECT CASE WHEN user_a=? THEN user_b ELSE user_a END AS friend_id FROM decave_friendships WHERE user_a=? OR user_b=?",
  )
    .bind(user.id, user.id, user.id)
    .all<{ friend_id: string }>();
  const friendIds = rows.results.map((row) => row.friend_id);
  if (friendIds.length) {
    await realtimeBroadcast(
      env,
      { type: "PROFILE_UPDATED", user: { ...pub, activityText: user.activity_text } },
      { userIds: friendIds },
    );
  }
}

/**
 * Re-run room authorization for live sockets in a Hub after a permission
 * change (B1/B2/B3): drops text subscriptions and ends voice sessions that are
 * no longer allowed (lost access, room deleted, or timed out).
 */
export async function realtimeRecheckAccess(env: Env, hubId: number): Promise<void> {
  try {
    await realtimeFetch(env, "/internal/recheck-access", { hubId });
  } catch (error) {
    console.error("Realtime access recheck failed", error instanceof Error ? error.name : "UnknownError");
  }
}
