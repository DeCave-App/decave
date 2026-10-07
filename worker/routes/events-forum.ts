// Hub events and forum posts (handled by worker/hub-events.ts and
// worker/forum-posts.ts).

import { matchHubEventRoute, handleHubEventRoute } from "../hub-events";
import { json, bodyJson } from "../lib/http";
import { requireUser } from "../lib/sessions";
import { canAccessRoom } from "../lib/hubs";
import { realtimeBroadcast } from "../lib/realtime";
import { matchForumRoute, handleForumRoute } from "../forum-posts";
import { messagesForClient } from "../lib/messages";
import type { ApiContext } from "./context";

export async function handleEventAndForumRoutes({ request, env, p }: ApiContext): Promise<Response | null> {
  const hubEventRoute = matchHubEventRoute(p);
  if (hubEventRoute) {
    const handled = await handleHubEventRoute(request, env, hubEventRoute, {
      json,
      requireUser: (req) => requireUser(req, env),
      canAccessRoom: (room, userId) => canAccessRoom(env.DB, room, userId),
      bodyJson,
      broadcast: (event, filter) => realtimeBroadcast(env, event, filter),
    });
    if (handled) return handled;
  }

  const forumRoute = matchForumRoute(p);
  if (forumRoute) {
    const handled = await handleForumRoute(request, env, forumRoute, {
      json,
      requireUser: (req) => requireUser(req, env),
      canAccessRoom: (room, userId) => canAccessRoom(env.DB, room, userId),
      bodyJson,
      broadcast: (event, filter) => realtimeBroadcast(env, event, filter),
      messagesForClient: (ids) => messagesForClient(env, ids),
    });
    if (handled) return handled;
  }

  return null;
}
