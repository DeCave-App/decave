// Hub bots: managing bots and their tokens, and bots posting messages.

import { idFromPath, json, boundedBodyJson } from "../lib/http";
import { requireUser } from "../lib/sessions";
import { hasPermission, createRawToken, nowIso, tokenHash, audit, getRoom } from "../db";
import {
  type HubBotRecord,
  hubBotForClient,
  normalizeHubBotCapabilities,
  storedHubBotRoomIds,
  storedHubBotCapabilities,
  validateHubBotRoomIds,
  type HubBotCapability,
} from "../lib/hub-bots";
import { canAccessRoom } from "../lib/hubs";
import { requireHubPostingPermission } from "../lib/official-hubs";
import { messageForClient } from "../lib/messages";
import { realtimeBroadcast } from "../lib/realtime";
import type { ApiContext } from "./context";

export async function handleHubBotRoutes({ request, env, p, method }: ApiContext): Promise<Response | null> {
  const hubBots = idFromPath(p, /^\/api\/servers\/(\d+)\/bots$/);
  if (hubBots && (method === "GET" || method === "POST")) {
    const user = await requireUser(request, env);
    if (user instanceof Response) return user;
    const hubId = Number(hubBots[1]);
    if (!(await hasPermission(env.DB, hubId, user.id, "manageRooms")))
      return json({ error: "Manage Rooms permission required" }, 403);
    if (method === "GET") {
      const rows = await env.DB.prepare(
        "SELECT id,hub_id,name,description,enabled,capabilities,allowed_room_ids,created_at FROM decave_hub_bots WHERE hub_id=? ORDER BY created_at DESC",
      )
        .bind(hubId)
        .all<HubBotRecord>();
      return json(rows.results.map(hubBotForClient), 200, { "Cache-Control": "no-store, private" });
    }
    const body = await boundedBodyJson(request, 16 * 1024);
    if (!body) return json({ error: "Bot configuration is too large" }, 413, { "Cache-Control": "no-store, private" });
    const name =
      typeof body.name === "string"
        ? body.name
            .normalize("NFC")
            .replace(/[\u0000-\u001f\u007f]/g, " ")
            .trim()
            .slice(0, 32)
        : "";
    const description =
      typeof body.description === "string"
        ? body.description
            .normalize("NFC")
            .replace(/[\u0000-\u001f\u007f]/g, " ")
            .trim()
            .slice(0, 180)
        : "";
    if (!name) return json({ error: "Bot name is required" }, 400);
    const capabilities = normalizeHubBotCapabilities(body.capabilities);
    if (!capabilities.length) return json({ error: "Select at least one bot action" }, 400);
    const rawToken = createRawToken();
    const id = crypto.randomUUID();
    const createdAt = nowIso();
    await env.DB.prepare(
      "INSERT INTO decave_hub_bots(id,hub_id,name,description,token_hash,created_by,capabilities,allowed_room_ids,enabled,created_at) VALUES(?,?,?,?,?,?,?,?,'1',?)",
    )
      .bind(id, hubId, name, description, tokenHash(rawToken), user.id, JSON.stringify(capabilities), "[]", createdAt)
      .run();
    await audit(env.DB, hubId, user.id, "bot.create", undefined, name);
    return json(
      { id, hubId, name, description, enabled: true, capabilities, allowedRoomIds: [], createdAt, token: rawToken },
      201,
      { "Cache-Control": "no-store, private" },
    );
  }

  const hubBotChannel = idFromPath(p, /^\/api\/servers\/(\d+)\/bots\/([^/]+)\/channels\/(\d+)$/);
  if (method === "PUT" && hubBotChannel) {
    const user = await requireUser(request, env);
    if (user instanceof Response) return user;
    const hubId = Number(hubBotChannel[1]);
    if (!(await hasPermission(env.DB, hubId, user.id, "manageRooms")))
      return json({ error: "Manage Rooms permission required" }, 403);
    const botId = decodeURIComponent(hubBotChannel[2]);
    const roomId = Number(hubBotChannel[3]);
    const bot = await env.DB.prepare(
      "SELECT id,hub_id,name,description,enabled,capabilities,allowed_room_ids,created_at FROM decave_hub_bots WHERE id=? AND hub_id=? LIMIT 1",
    )
      .bind(botId, hubId)
      .first<HubBotRecord>();
    if (!bot) return json({ error: "Bot not found in this Hub" }, 404);
    const body = await boundedBodyJson(request, 4 * 1024);
    if (!body)
      return json({ error: "Bot room configuration is too large" }, 413, { "Cache-Control": "no-store, private" });
    if (typeof body.enabled !== "boolean") return json({ error: "enabled must be a boolean" }, 400);
    const room = await getRoom(env.DB, roomId);
    if (!room || room.hub_id !== hubId || room.type !== "text" || !(await canAccessRoom(env.DB, room, user.id)))
      return json({ error: "Text Room not found in this Hub" }, 404);
    const allowedRoomIds = storedHubBotRoomIds(bot.allowed_room_ids).filter((id) => id !== roomId);
    if (body.enabled) allowedRoomIds.push(roomId);
    await env.DB.prepare("UPDATE decave_hub_bots SET allowed_room_ids=? WHERE id=? AND hub_id=?")
      .bind(JSON.stringify(Array.from(new Set(allowedRoomIds))), botId, hubId)
      .run();
    await audit(
      env.DB,
      hubId,
      user.id,
      "bot.rooms.update",
      undefined,
      `${bot.name}:${roomId}:${body.enabled ? "enabled" : "disabled"}`,
    );
    return json({ ...hubBotForClient(bot), allowedRoomIds: Array.from(new Set(allowedRoomIds)) });
  }

  const hubBotToken = idFromPath(p, /^\/api\/servers\/(\d+)\/bots\/([^/]+)\/token$/);
  if (method === "POST" && hubBotToken) {
    const user = await requireUser(request, env);
    if (user instanceof Response) return user;
    const hubId = Number(hubBotToken[1]);
    if (!(await hasPermission(env.DB, hubId, user.id, "manageRooms")))
      return json({ error: "Manage Rooms permission required" }, 403);
    const botId = decodeURIComponent(hubBotToken[2]);
    const bot = await env.DB.prepare("SELECT id,name FROM decave_hub_bots WHERE id=? AND hub_id=? LIMIT 1")
      .bind(botId, hubId)
      .first<{ id: string; name: string }>();
    if (!bot) return json({ error: "Bot not found in this Hub" }, 404);
    const rawToken = createRawToken();
    await env.DB.prepare("UPDATE decave_hub_bots SET token_hash=? WHERE id=? AND hub_id=?")
      .bind(tokenHash(rawToken), botId, hubId)
      .run();
    await audit(env.DB, hubId, user.id, "bot.token.rotate", undefined, bot.name);
    return json({ id: bot.id, name: bot.name, token: rawToken }, 200, { "Cache-Control": "no-store, private" });
  }

  const hubBotItem = idFromPath(p, /^\/api\/servers\/(\d+)\/bots\/([^/]+)$/);
  if (hubBotItem && (method === "PATCH" || method === "DELETE")) {
    const user = await requireUser(request, env);
    if (user instanceof Response) return user;
    const hubId = Number(hubBotItem[1]);
    if (!(await hasPermission(env.DB, hubId, user.id, "manageRooms")))
      return json({ error: "Manage Rooms permission required" }, 403);
    const id = decodeURIComponent(hubBotItem[2]);
    const bot = await env.DB.prepare(
      "SELECT id,hub_id,name,description,enabled,capabilities,allowed_room_ids,created_at FROM decave_hub_bots WHERE id=? AND hub_id=? LIMIT 1",
    )
      .bind(id, hubId)
      .first<HubBotRecord>();
    if (!bot) return json({ error: "Bot not found in this Hub" }, 404);
    if (method === "DELETE") {
      await env.DB.prepare("DELETE FROM decave_hub_bots WHERE id=? AND hub_id=?").bind(id, hubId).run();
      await audit(env.DB, hubId, user.id, "bot.delete", undefined, bot.name);
      return json({ success: true });
    }
    const body = await boundedBodyJson(request, 16 * 1024);
    if (!body) return json({ error: "Bot configuration is too large" }, 413, { "Cache-Control": "no-store, private" });
    const enabled = typeof body.enabled === "boolean" ? body.enabled : bot.enabled === 1;
    const capabilities =
      body.capabilities === undefined
        ? storedHubBotCapabilities(bot.capabilities)
        : normalizeHubBotCapabilities(body.capabilities);
    if (body.capabilities !== undefined && !Array.isArray(body.capabilities))
      return json({ error: "capabilities must be an array" }, 400);
    if (!capabilities.length) return json({ error: "A bot must keep at least one allowed action" }, 400);
    const allowedRoomIds =
      body.allowedRoomIds === undefined
        ? storedHubBotRoomIds(bot.allowed_room_ids)
        : await validateHubBotRoomIds(env.DB, hubId, user.id, body.allowedRoomIds);
    if (allowedRoomIds === null) return json({ error: "Choose only accessible text rooms from this Hub" }, 400);
    await env.DB.prepare(
      "UPDATE decave_hub_bots SET enabled=?,capabilities=?,allowed_room_ids=? WHERE id=? AND hub_id=?",
    )
      .bind(enabled ? 1 : 0, JSON.stringify(capabilities), JSON.stringify(allowedRoomIds), id, hubId)
      .run();
    await audit(env.DB, hubId, user.id, "bot.update", undefined, bot.name);
    return json(
      hubBotForClient({
        ...bot,
        enabled: enabled ? 1 : 0,
        capabilities: JSON.stringify(capabilities),
        allowed_room_ids: JSON.stringify(allowedRoomIds),
      }),
    );
  }

  if (method === "POST" && p === "/api/bots/messages") {
    const authorization = request.headers.get("authorization") ?? "";
    const rawToken = authorization.startsWith("Bot ") ? authorization.slice(4).trim() : "";
    if (!/^[a-f0-9]{64}$/i.test(rawToken)) return json({ error: "Bot token required" }, 401);
    const bot = await env.DB.prepare(
      "SELECT id,hub_id,name,created_by,enabled,capabilities,allowed_room_ids FROM decave_hub_bots WHERE token_hash=?",
    )
      .bind(tokenHash(rawToken))
      .first<{
        id: string;
        hub_id: number;
        name: string;
        created_by: string;
        enabled: number;
        capabilities: string | null;
        allowed_room_ids: string | null;
      }>();
    if (!bot || bot.enabled !== 1) return json({ error: "Invalid or disabled bot" }, 401);
    const body = await boundedBodyJson(request, 16 * 1024);
    if (!body) return json({ error: "Bot request is too large" }, 413, { "Cache-Control": "no-store, private" });
    const action = body.action === undefined ? "send_message" : body.action;
    const requiredCapability: HubBotCapability | null =
      action === "create_event"
        ? "create_events"
        : action === "create_poll"
          ? "create_polls"
          : action === "send_message"
            ? "send_messages"
            : null;
    if (!requiredCapability) return json({ error: "Unknown bot action" }, 400);
    if (!storedHubBotCapabilities(bot.capabilities).includes(requiredCapability))
      return json({ error: "This bot is not allowed to use that action" }, 403);
    const roomId = Number(body.roomId);
    if (!Number.isSafeInteger(roomId) || roomId <= 0) return json({ error: "A valid roomId is required" }, 400);
    if (!storedHubBotRoomIds(bot.allowed_room_ids).includes(roomId))
      return json({ error: "This bot is not enabled in that room" }, 403);
    const room = await getRoom(env.DB, roomId);
    if (!room || room.hub_id !== bot.hub_id || room.type !== "text")
      return json({ error: "Text Room not found in this Hub" }, 404);
    if (!(await canAccessRoom(env.DB, room, bot.created_by)))
      return json({ error: "Bot creator no longer has access to this room" }, 403);
    const text = typeof body.text === "string" ? body.text.normalize("NFC").trim().slice(0, 3800) : "";
    if (!text) return json({ error: "Message text is required" }, 400);
    const structuredPrefix =
      action === "create_event" ? "__DECAVE_EVENT__" : action === "create_poll" ? "__DECAVE_POLL__" : "";
    if (action !== "send_message" && !text.startsWith(structuredPrefix))
      return json({ error: `${action} requires its structured DeCave payload` }, 400);
    if (action === "send_message" && (text.startsWith("__DECAVE_EVENT__") || text.startsWith("__DECAVE_POLL__")))
      return json({ error: "Use the matching structured action for events or polls" }, 400);
    if (action !== "send_message") {
      try {
        const payload = JSON.parse(text.slice(structuredPrefix.length)) as Record<string, unknown>;
        if (!payload || typeof payload !== "object") return json({ error: "Invalid structured bot payload" }, 400);
        if (
          action === "create_event" &&
          (typeof payload.title !== "string" ||
            !payload.title.trim() ||
            typeof payload.startAt !== "string" ||
            Number.isNaN(Date.parse(payload.startAt)))
        )
          return json({ error: "Events require a title and valid startAt" }, 400);
        if (
          action === "create_poll" &&
          (typeof payload.question !== "string" ||
            !payload.question.trim() ||
            !Array.isArray(payload.options) ||
            payload.options.length < 2)
        )
          return json({ error: "Polls require a question and at least two options" }, 400);
      } catch {
        return json({ error: "Invalid structured bot payload" }, 400);
      }
    }
    const id = crypto.randomUUID();
    const stored = `__DECAVE_BOT__${JSON.stringify({ botId: bot.id, name: bot.name, text })}`;
    const postingError = await requireHubPostingPermission(env.DB, bot.hub_id, bot.created_by);
    if (postingError) return postingError;
    await env.DB.prepare(
      "INSERT INTO decave_messages(id,room_id,hub_id,author_user_id,text,created_at) VALUES(?,?,?,?,?,?)",
    )
      .bind(id, roomId, bot.hub_id, bot.created_by, stored, nowIso())
      .run();
    const message = await messageForClient(env, id);
    if (!message) return json({ error: "Could not load bot message" }, 500);
    await realtimeBroadcast(env, { type: "CHAT_MESSAGE", ...message }, { channelId: roomId });
    return json({ message }, 201, { "Cache-Control": "no-store, private" });
  }

  return null;
}
