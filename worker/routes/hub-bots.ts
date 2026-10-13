// Hub bots: managing bots and their tokens, and bots posting messages.

import { idFromPath, json, boundedBodyJson, apiError } from "../lib/http";
import { accountAccessError, requireUser } from "../lib/sessions";
import { hasPermission, createRawToken, nowIso, tokenHash, audit, getRoom, type UserRow } from "../db";
import {
  botMessageText,
  postBotMessage,
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
import { queueHubMessage } from "../bots/events";
import type { ApiContext } from "./context";

export async function handleHubBotRoutes({ request, env, p, method, ctx }: ApiContext): Promise<Response | null> {
  const hubBots = idFromPath(p, /^\/api\/servers\/(\d+)\/bots$/);
  if (hubBots && (method === "GET" || method === "POST")) {
    const user = await requireUser(request, env);
    if (user instanceof Response) return user;
    const hubId = Number(hubBots[1]);
    if (!(await hasPermission(env.DB, hubId, user.id, "manageRooms")))
      return apiError("common.manageRoomsRequired", 403);
    if (method === "GET") {
      const rows = await env.DB.prepare(
        "SELECT id,hub_id,name,description,enabled,capabilities,allowed_room_ids,created_at FROM decave_hub_bots WHERE hub_id=? AND kind='token' ORDER BY created_at DESC",
      )
        .bind(hubId)
        .all<HubBotRecord>();
      return json(rows.results.map(hubBotForClient), 200, { "Cache-Control": "no-store, private" });
    }
    const body = await boundedBodyJson(request, 16 * 1024);
    if (!body) return apiError("hubBots.configTooLarge", 413, undefined, { "Cache-Control": "no-store, private" });
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
    if (!name) return apiError("common.botNameRequired", 400);
    const capabilities = normalizeHubBotCapabilities(body.capabilities);
    if (!capabilities.length) return apiError("common.botActionRequired", 400);
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
      return apiError("common.manageRoomsRequired", 403);
    const botId = decodeURIComponent(hubBotChannel[2]);
    const roomId = Number(hubBotChannel[3]);
    const bot = await env.DB.prepare(
      "SELECT id,hub_id,name,description,enabled,capabilities,allowed_room_ids,created_at FROM decave_hub_bots WHERE id=? AND hub_id=? LIMIT 1",
    )
      .bind(botId, hubId)
      .first<HubBotRecord>();
    if (!bot) return apiError("common.botNotFound", 404);
    const body = await boundedBodyJson(request, 4 * 1024);
    if (!body) return apiError("hubBots.roomConfigTooLarge", 413, undefined, { "Cache-Control": "no-store, private" });
    if (typeof body.enabled !== "boolean") return apiError("common.enabledNotBoolean", 400);
    const room = await getRoom(env.DB, roomId);
    if (!room || room.hub_id !== hubId || room.type !== "text" || !(await canAccessRoom(env.DB, room, user.id)))
      return apiError("hubBots.textRoomNotFound", 404);
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
      return apiError("common.manageRoomsRequired", 403);
    const botId = decodeURIComponent(hubBotToken[2]);
    const bot = await env.DB.prepare("SELECT id,name FROM decave_hub_bots WHERE id=? AND hub_id=? LIMIT 1")
      .bind(botId, hubId)
      .first<{ id: string; name: string }>();
    if (!bot) return apiError("common.botNotFound", 404);
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
      return apiError("common.manageRoomsRequired", 403);
    const id = decodeURIComponent(hubBotItem[2]);
    const bot = await env.DB.prepare(
      "SELECT id,hub_id,name,description,enabled,capabilities,allowed_room_ids,created_at FROM decave_hub_bots WHERE id=? AND hub_id=? LIMIT 1",
    )
      .bind(id, hubId)
      .first<HubBotRecord>();
    if (!bot) return apiError("common.botNotFound", 404);
    if (method === "DELETE") {
      await env.DB.prepare("DELETE FROM decave_hub_bots WHERE id=? AND hub_id=?").bind(id, hubId).run();
      await audit(env.DB, hubId, user.id, "bot.delete", undefined, bot.name);
      return json({ success: true });
    }
    const body = await boundedBodyJson(request, 16 * 1024);
    if (!body) return apiError("hubBots.configTooLarge", 413, undefined, { "Cache-Control": "no-store, private" });
    const enabled = typeof body.enabled === "boolean" ? body.enabled : bot.enabled === 1;
    const capabilities =
      body.capabilities === undefined
        ? storedHubBotCapabilities(bot.capabilities)
        : normalizeHubBotCapabilities(body.capabilities);
    if (body.capabilities !== undefined && !Array.isArray(body.capabilities))
      return apiError("hubBots.capabilitiesInvalid", 400);
    if (!capabilities.length) return apiError("hubBots.actionRequired", 400);
    const allowedRoomIds =
      body.allowedRoomIds === undefined
        ? storedHubBotRoomIds(bot.allowed_room_ids)
        : await validateHubBotRoomIds(env.DB, hubId, user.id, body.allowedRoomIds);
    if (allowedRoomIds === null) return apiError("hubBots.roomsInaccessible", 400);
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
    if (!/^[a-f0-9]{64}$/i.test(rawToken)) return apiError("hubBots.tokenRequired", 401);
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
    if (!bot || bot.enabled !== 1) return apiError("hubBots.invalidBot", 401);
    const creator = await env.DB.prepare("SELECT * FROM decave_users WHERE id=? LIMIT 1")
      .bind(bot.created_by)
      .first<UserRow>();
    if (!creator) return apiError("hubBots.creatorLostAccess", 403);
    const creatorAccessError = accountAccessError(creator);
    if (creatorAccessError) return creatorAccessError;

    const body = await boundedBodyJson(request, 16 * 1024);
    if (!body) return apiError("hubBots.requestTooLarge", 413, undefined, { "Cache-Control": "no-store, private" });
    const action = body.action === undefined ? "send_message" : body.action;
    const requiredCapability: HubBotCapability | null =
      action === "create_event"
        ? "create_events"
        : action === "create_poll"
          ? "create_polls"
          : action === "send_message"
            ? "send_messages"
            : null;
    if (!requiredCapability) return apiError("hubBots.unknownAction", 400);
    if (!storedHubBotCapabilities(bot.capabilities).includes(requiredCapability))
      return apiError("hubBots.actionNotAllowed", 403);
    const roomId = Number(body.roomId);
    if (!Number.isSafeInteger(roomId) || roomId <= 0) return apiError("hubBots.roomIdRequired", 400);
    if (!storedHubBotRoomIds(bot.allowed_room_ids).includes(roomId)) return apiError("hubBots.notEnabledInRoom", 403);
    const room = await getRoom(env.DB, roomId);
    if (!room || room.hub_id !== bot.hub_id || room.type !== "text") return apiError("hubBots.textRoomNotFound", 404);
    if (!(await canAccessRoom(env.DB, room, bot.created_by))) return apiError("hubBots.creatorLostRoomAccess", 403);
    const text = typeof body.text === "string" ? body.text.normalize("NFC").trim().slice(0, 3800) : "";
    if (!text) return apiError("hubBots.textRequired", 400);
    const structuredPrefix =
      action === "create_event" ? "__DECAVE_EVENT__" : action === "create_poll" ? "__DECAVE_POLL__" : "";
    if (action !== "send_message" && !text.startsWith(structuredPrefix))
      return apiError("hubBots.payloadRequired", 400, { action: String(action) });
    if (action === "send_message" && (text.startsWith("__DECAVE_EVENT__") || text.startsWith("__DECAVE_POLL__")))
      return apiError("hubBots.useStructuredAction", 400);
    if (action !== "send_message") {
      try {
        const payload = JSON.parse(text.slice(structuredPrefix.length)) as Record<string, unknown>;
        if (!payload || typeof payload !== "object") return apiError("hubBots.payloadInvalid", 400);
        if (
          action === "create_event" &&
          (typeof payload.title !== "string" ||
            !payload.title.trim() ||
            typeof payload.startAt !== "string" ||
            Number.isNaN(Date.parse(payload.startAt)))
        )
          return apiError("hubBots.eventInvalid", 400);
        if (
          action === "create_poll" &&
          (typeof payload.question !== "string" ||
            !payload.question.trim() ||
            !Array.isArray(payload.options) ||
            payload.options.length < 2)
        )
          return apiError("hubBots.pollInvalid", 400);
      } catch {
        return apiError("hubBots.payloadInvalid", 400);
      }
    }
    const postingError = await requireHubPostingPermission(env.DB, bot.hub_id, bot.created_by);
    if (postingError) return postingError;
    const message = await postBotMessage(env, {
      hubId: bot.hub_id,
      roomId,
      botId: bot.id,
      authorUserId: bot.created_by,
      text: botMessageText(bot, text),
    });
    if (!message) return apiError("hubBots.messageLoadFailed", 500);
    // Builder bots that opt in to bot triggers see token-bot messages (chain depth 1).
    if (action === "send_message")
      queueHubMessage(
        env,
        {
          hubId: bot.hub_id,
          roomId,
          messageId: message.id,
          text,
          actorId: bot.created_by,
          actorIsBot: true,
          chainDepth: 1,
        },
        ctx ? (work) => ctx.waitUntil(work) : undefined,
      );
    return json({ message }, 201, { "Cache-Control": "no-store, private" });
  }

  return null;
}
