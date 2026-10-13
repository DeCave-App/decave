// Stored media files, Hub icon, banner, header image and chat background
// uploads, and per-room chat backgrounds.

import { serveR2 } from "../lib/media";
import { sniffedImageMime } from "../lib/upload-content-type";
import { apiError, boundedBodyBytes, idFromPath, json } from "../lib/http";
import { requireUser } from "../lib/sessions";
import { getHub, getRoom, hasPermission, nowIso, audit } from "../db";
import { realtimeBroadcast } from "../lib/realtime";
import { hubMediaDimensionProblem, readImageDimensions, type HubMediaKind } from "../../shared/hub-media-specs";
import type { ApiContext } from "./context";

export async function handleMediaRoutes({ request, env, p, method }: ApiContext): Promise<Response | null> {
  // Streamer package thumbnails use encoded existing-media paths. Keep this
  // adapter on the API router so it inherits the same authenticated serveR2
  // authorization as legacy /uploads/* URLs.
  if (p.startsWith("/api/media/")) return serveR2(request, env);

  const mediaRoute = idFromPath(p, /^\/api\/servers\/(\d+)\/media\/(icon|banner|header|chat-background)$/);
  if (method === "DELETE" && mediaRoute && mediaRoute[2] !== "icon") {
    const user = await requireUser(request, env);
    if (user instanceof Response) return user;
    const hubId = Number(mediaRoute[1]);
    const kind = mediaRoute[2];
    const hub = await getHub(env.DB, hubId);
    if (!hub) return apiError("hubMedia.hubNotFound", 404);
    if (hub.owner_id !== user.id) return apiError("hubMedia.ownerOnly", 403);
    const old = kind === "banner" ? hub.banner_key : kind === "header" ? hub.header_key : hub.chat_background_key;
    if (old) await env.MEDIA.delete(old);
    if (kind === "header")
      await env.DB.prepare("UPDATE decave_hubs SET header_key=NULL,updated_at=? WHERE id=?")
        .bind(nowIso(), hubId)
        .run();
    else if (kind === "banner")
      await env.DB.prepare("UPDATE decave_hubs SET banner_key=NULL,use_banner_background=0,updated_at=? WHERE id=?")
        .bind(nowIso(), hubId)
        .run();
    else
      await env.DB.prepare(
        "UPDATE decave_hubs SET chat_background_key=NULL,use_chat_background=0,updated_at=? WHERE id=?",
      )
        .bind(nowIso(), hubId)
        .run();
    await audit(env.DB, hubId, user.id, `hub.${kind}.remove`);
    await realtimeBroadcast(env, { type: "SERVERS_REFRESH" }, { hubId });
    return json({ ok: true });
  }
  const roomBackground = idFromPath(p, /^\/api\/channels\/(\d+)\/media\/background$/);
  if (roomBackground && (method === "POST" || method === "DELETE")) {
    const user = await requireUser(request, env);
    if (user instanceof Response) return user;
    const roomId = Number(roomBackground[1]);
    const room = await getRoom(env.DB, roomId);
    if (!room) return apiError("hubMedia.roomNotFound", 404);
    if (!(await hasPermission(env.DB, room.hub_id, user.id, "manageRooms")))
      return apiError("hubMedia.manageRoomsRequired", 403);
    const old = room.background_key ?? null;
    let key: string | null = null;
    if (method === "POST") {
      const bytes = await boundedBodyBytes(request, 8 * 1024 * 1024);
      if (!bytes || !bytes.byteLength) return apiError("hubMedia.roomBackgroundTooLarge", 413);
      const mime = sniffedImageMime(bytes, ["image/png", "image/jpeg", "image/webp", "image/gif"]);
      if (!mime) return apiError("hubMedia.roomBackgroundType", 400);
      const dims = readImageDimensions(bytes);
      const dimError = hubMediaDimensionProblem("chat-background", dims?.width ?? NaN, dims?.height ?? NaN);
      if (dimError) return apiError(dimError.code, 400, dimError.params);
      key = `hub-media/${room.hub_id}/room-background/${roomId}/${crypto.randomUUID()}`;
      await env.MEDIA.put(key, bytes, { httpMetadata: { contentType: mime } });
    }
    await env.DB.prepare("UPDATE decave_rooms SET background_key=?,updated_at=? WHERE id=?")
      .bind(key, nowIso(), roomId)
      .run();
    if (old) await env.MEDIA.delete(old);
    await audit(
      env.DB,
      room.hub_id,
      user.id,
      `room.background.${key ? "update" : "remove"}`,
      undefined,
      `room ${roomId}`,
    );
    await realtimeBroadcast(env, { type: "SERVERS_REFRESH" }, { hubId: room.hub_id });
    return json({ url: key ? `/uploads/${key}` : null });
  }

  if (method === "POST" && mediaRoute) {
    const user = await requireUser(request, env);
    if (user instanceof Response) return user;
    const hubId = Number(mediaRoute[1]);
    const kind = mediaRoute[2];
    const hub = await getHub(env.DB, hubId);
    if (!hub) return apiError("hubMedia.hubNotFound", 404);
    if (hub.owner_id !== user.id) return apiError("hubMedia.ownerOnly", 403);
    const limit = kind === "icon" ? 3 * 1024 * 1024 : 8 * 1024 * 1024;
    const bytes = await boundedBodyBytes(request, limit);
    if (!bytes || !bytes.byteLength) return apiError("hubMedia.artworkTooLarge", 413);
    const mime = sniffedImageMime(bytes, ["image/png", "image/jpeg", "image/webp", "image/gif"]);
    if (!mime) return apiError("hubMedia.artworkType", 400);
    if (kind !== "icon") {
      const dims = readImageDimensions(bytes);
      const dimError = hubMediaDimensionProblem(kind as HubMediaKind, dims?.width ?? NaN, dims?.height ?? NaN);
      if (dimError) return apiError(dimError.code, 400, dimError.params);
    }
    const key = `hub-media/${hubId}/${kind}/${crypto.randomUUID()}`;
    await env.MEDIA.put(key, bytes, { httpMetadata: { contentType: mime } });
    const column = {
      icon: "icon_key",
      banner: "banner_key",
      header: "header_key",
      "chat-background": "chat_background_key",
    }[kind as "icon" | "banner" | "header" | "chat-background"];
    const old = {
      icon: hub.icon_key,
      banner: hub.banner_key,
      header: hub.header_key,
      "chat-background": hub.chat_background_key,
    }[kind as "icon" | "banner" | "header" | "chat-background"];
    if (old) await env.MEDIA.delete(old);
    await env.DB.prepare(`UPDATE decave_hubs SET ${column}=?,updated_at=? WHERE id=?`).bind(key, nowIso(), hubId).run();
    await audit(env.DB, hubId, user.id, `hub.${kind}.update`);
    await realtimeBroadcast(env, { type: "SERVERS_REFRESH" }, { hubId });
    return json({ url: `/uploads/${key}` });
  }

  return null;
}
