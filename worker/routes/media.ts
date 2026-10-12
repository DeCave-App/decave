// Stored media files and Hub icon, banner, header image and chat background uploads.

import { serveR2 } from "../lib/media";
import { sniffedImageMime } from "../lib/upload-content-type";
import { boundedBodyBytes, idFromPath, json } from "../lib/http";
import { requireUser } from "../lib/sessions";
import { getHub, nowIso, audit } from "../db";
import { realtimeBroadcast } from "../lib/realtime";
import { readImageDimensions, validateHubMediaDimensions, type HubMediaKind } from "../../shared/hub-media-specs";
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
    if (!hub) return json({ error: "Hub not found" }, 404);
    if (hub.owner_id !== user.id) return json({ error: "Only the Hub owner can change Hub artwork" }, 403);
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
  if (method === "POST" && mediaRoute) {
    const user = await requireUser(request, env);
    if (user instanceof Response) return user;
    const hubId = Number(mediaRoute[1]);
    const kind = mediaRoute[2];
    const hub = await getHub(env.DB, hubId);
    if (!hub) return json({ error: "Hub not found" }, 404);
    if (hub.owner_id !== user.id) return json({ error: "Only the Hub owner can change Hub artwork" }, 403);
    const limit = kind === "icon" ? 3 * 1024 * 1024 : 8 * 1024 * 1024;
    const bytes = await boundedBodyBytes(request, limit);
    if (!bytes || !bytes.byteLength) return json({ error: "Hub artwork exceeds the size limit" }, 413);
    const mime = sniffedImageMime(bytes, ["image/png", "image/jpeg", "image/webp", "image/gif"]);
    if (!mime) return json({ error: "Hub artwork must be PNG, JPG, WebP or GIF" }, 400);
    if (kind !== "icon") {
      const dims = readImageDimensions(bytes);
      const dimError = dims
        ? validateHubMediaDimensions(kind as HubMediaKind, dims.width, dims.height)
        : validateHubMediaDimensions(kind as HubMediaKind, NaN, NaN);
      if (dimError) return json({ error: dimError }, 400);
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
